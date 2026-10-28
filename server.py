#!/usr/bin/env python3
"""Local MXCHIP Modbus to SSE bridge. Run with --demo to simulate readings."""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import logging
import math
import sqlite3
import threading
import time
import uuid
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from device_reader import HEALTH_NAMES, read_latest
from history import HistoryStore
from projects import project_catalog

HERE = Path(__file__).resolve().parent
LOG = logging.getLogger("aura")
DEFAULT_ROOM = json.loads(
    (HERE / "projects" / "meeting-room" / "room.json").read_text(encoding="utf-8")
)


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def load_room(path=None):
    room = {**DEFAULT_ROOM, "sensor_position": dict(DEFAULT_ROOM["sensor_position"])}
    if path:
        supplied = json.loads(Path(path).read_text(encoding="utf-8"))
        if not isinstance(supplied, dict) or set(supplied) - set(room):
            raise ValueError("Room configuration must contain only supported room fields")
        room.update(supplied)
    for key in ("name", "code", "location"):
        if not isinstance(room[key], str) or not 1 <= len(room[key].strip()) <= 120:
            raise ValueError(f"Room {key} must be a nonempty string of at most 120 characters")
    for key, low, high in (("width_m", 4, 30), ("depth_m", 3, 30), ("height_m", 2, 8)):
        value = room[key]
        if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f"Room {key} must be between {low} and {high}")
    pos = room["sensor_position"]
    if not isinstance(pos, dict) or set(pos) != {"x", "y", "z"}:
        raise ValueError("sensor_position requires x, y, and z in metres")
    for key, low, high in (
        ("x", -room["width_m"] / 2, room["width_m"] / 2),
        ("y", 0, room["height_m"]),
        ("z", -room["depth_m"] / 2, room["depth_m"] / 2),
    ):
        value = pos[key]
        if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f"Sensor {key} must be inside the room")
    return room


class TelemetryHub:
    def __init__(self, ip, port, unit, interval, timeout, demo, store=None, stale_after=None, room=None):
        self.ip, self.port, self.unit = ip, port, unit
        self.interval, self.timeout, self.demo = interval, timeout, demo
        self.stale_after = stale_after if stale_after is not None else max(5.0, interval * 3)
        self.room = room or load_room()
        self.store = store or HistoryStore(":memory:")
        self.source = json.dumps([self.room["code"], "demo" if demo else "live", ip if not demo else "simulator", port, unit])
        self.condition = threading.Condition()
        self.stream_id = uuid.uuid4().hex
        self.version = 0
        self.payload = None
        self.published_monotonic = None
        self.events = deque(maxlen=1000)
        self.evicted_event_version = 0
        self.stop = threading.Event()
        self.alarm_demo = False
        self.last_alarm = False if demo else None
        self.last_seen = None
        self.sample_id = 0
        self.sequence = None
        self.sequence_changed_at = None
        self.last_uptime = None
        self.measurement_id = None
        self.sampled_at = None
        self.was_offline = False
        self.storage_error = None

    def settings(self):
        return {
            "demo": self.demo,
            "target": self.ip if not self.demo else "SIMULATED",
            "interval_seconds": self.interval,
            "stale_after_seconds": self.stale_after,
            "room": self.room,
            "source": self.source,
        }

    def _store(self, method, item):
        try:
            getattr(self.store, method)(self.source, item)
            self.storage_error = None
        except (sqlite3.Error, OSError) as exc:
            self.storage_error = str(exc)
            LOG.error("Could not save local history: %s", exc)

    def publish(self, data, event=None):
        with self.condition:
            if event:
                self.version += 1
                event = {**event, "id": f"{self.stream_id}:{self.version}"}
                if len(self.events) == self.events.maxlen:
                    self.evicted_event_version = self.events[0][0]
                self.events.append((self.version, event))
                self._store("add_alarm", event)
            self.version += 1
            self.payload = {
                **data,
                "id": f"{self.stream_id}:{self.version}",
                "stream_id": self.stream_id,
                "version": self.version,
                "simulated": self.demo,
                "interval_seconds": self.interval,
                "stale_after_seconds": self.stale_after,
                "history_error": self.storage_error,
            }
            self.published_monotonic = time.monotonic()
            self.condition.notify_all()

    def latest(self):
        with self.condition:
            if self.payload is None:
                return self.version, None
            return self.version, {
                **self.payload,
                "publication_age_seconds": max(0, time.monotonic() - self.published_monotonic),
            }

    def demo_read(self):
        now = time.monotonic()
        self.sample_id += 1

        def jitter(value, amplitude, rate):
            return round(value + amplitude * math.sin(now * rate), 1)

        temperature = jitter(24.2, 1.5, 0.12)
        return {
            "online": True,
            "mode": "demo",
            "simulated": True,
            "observed_at": utc_now(),
            "device": {"ip": "SIMULATOR", "port": 502, "unit_id": 1, "protocol": "SIMULATED / DEMO"},
            "environment": {
                "temperature_c": temperature,
                "humidity_pct": jitter(46.2, 3.6, 0.05),
                "pressure_hpa": jitter(1013.2, 0.8, 0.04),
                "pressure_temperature_c": round(temperature + 0.6, 1),
            },
            "motion": {
                "acceleration_mg": {"x": 8, "y": -11, "z": 1006},
                "gyroscope_tenth_dps": {"x": 0, "y": 0, "z": 0},
                "magnetic_mgauss": {"x": 290, "y": 102, "z": -155},
                "steps": 0,
            },
            "status": {
                "alarm_on": self.alarm_demo,
                "wifi_connected": True,
                "wifi_rssi_dbm": -48,
                "uptime_seconds_16bit": int(now) % 65536,
                "sample_age_seconds": 0,
                "sample_sequence_16bit": self.sample_id % 65536,
                "register_map_version": 2,
                "sensor_health": [{"id": key, "name": name, "ok": True} for key, name in HEALTH_NAMES],
            },
            "registers": [],
        }

    def process_reading(self, data):
        """Track device sampling independently of successful network reads."""
        now = time.monotonic()
        status = data.get("status", {})
        sequence = status.get("sample_sequence_16bit")
        uptime = status.get("uptime_seconds_16bit")
        reboot = uptime is not None and self.last_uptime is not None and uptime < self.last_uptime
        new_sample = sequence is None or sequence != self.sequence or reboot or self.measurement_id is None
        age = status.get("sample_age_seconds")
        if new_sample:
            self.sequence, self.sequence_changed_at = sequence, now
            self.measurement_id = uuid.uuid4().hex
            observed = dt.datetime.fromisoformat(data["observed_at"].replace("Z", "+00:00"))
            self.sampled_at = (observed - dt.timedelta(seconds=age or 0)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        self.last_uptime = uptime
        frozen = sequence is not None and now - self.sequence_changed_at > self.stale_after
        health = status.get("sensor_health", [])
        failed = [item["name"] for item in health if item.get("ok") is False]
        if (age is not None and age > self.stale_after) or frozen:
            state, reason = "stale", "Sample sequence stopped advancing" if frozen else f"Sensor sample is {age}s old"
        elif failed:
            state, reason = "fault", "Sensor fault: " + ", ".join(failed)
        elif data.get("environment", {}).get("temperature_c") is None:
            state, reason = "unavailable", "Temperature is unavailable"
        elif age is None or not health or any(item.get("ok") is None for item in health):
            state, reason = "unknown", "Sensor freshness or health is unverified"
        else:
            state, reason = "fresh", "Sensor sample is current"
        data.update({
            "simulated": self.demo,
            "online": True,
            "sample_id": self.measurement_id,
            "sampled_at": self.sampled_at,
            "quality": {"state": state, "reason": reason},
        })
        self.last_seen = data["observed_at"]
        self.was_offline = False
        sample = {
            "id": self.measurement_id,
            "session_id": self.stream_id,
            "observed_at": data["observed_at"],
            "sampled_at": self.sampled_at,
            "temperature_c": data.get("environment", {}).get("temperature_c"),
            "quality": state,
            "reason": reason,
            "simulated": self.demo,
        }
        data["sample"] = sample
        self._store("add_sample", sample)
        alarm = status.get("alarm_on") if state != "stale" else None
        event = None
        if alarm is not None and self.last_alarm is not None and alarm != self.last_alarm:
            event = {
                "kind": "alarm", "alarm_on": alarm, "at": data["observed_at"],
                "simulated": self.demo,
                "message": "DEMO alarm activated" if alarm else "DEMO alarm cleared",
            }
            LOG.info("Button A / alarm register changed: %s", "ON" if alarm else "OFF")
        self.last_alarm = alarm
        self.publish({"kind": "telemetry", "data": data}, event)

    def mark_offline(self, reason):
        gap = None
        if not self.was_offline:
            stamp = utc_now()
            gap = {
                "id": uuid.uuid4().hex, "session_id": self.stream_id,
                "observed_at": stamp, "sampled_at": stamp,
                "temperature_c": None, "quality": "offline", "reason": reason, "simulated": self.demo,
            }
            self._store("add_sample", gap)
        self.was_offline = True
        self.last_alarm = None
        self.publish({"kind": "offline", "reason": reason, "last_seen": self.last_seen, "sample": gap})

    def poll(self):
        while not self.stop.is_set():
            started = time.monotonic()
            try:
                if self.demo:
                    with self.condition:
                        self.process_reading(self.demo_read())
                else:
                    self.process_reading(read_latest(self.ip, self.port, self.unit, self.timeout))
            except Exception as exc:
                LOG.warning("MXCHIP Modbus read failed: %s", exc)
                self.mark_offline(str(exc))
            self.stop.wait(max(0.1, self.interval - (time.monotonic() - started)))

    def toggle_demo_alarm(self):
        if not self.demo:
            raise PermissionError("Demo controls are disabled for the real device")
        with self.condition:
            self.alarm_demo = not self.alarm_demo
            # Publish immediately, preserving transitions even between polls.
            self.process_reading(self.demo_read())
            return self.alarm_demo


def make_handler(hub):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def response_headers(self, status, mime, count=None, attachment=None):
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.close_connection = mime != "text/event-stream"
            self.send_header("Connection", "close" if self.close_connection else "keep-alive")
            if attachment:
                self.send_header("Content-Disposition", f'attachment; filename="{attachment}"')
            if count is not None:
                self.send_header("Content-Length", str(count))
            self.end_headers()

        def json_response(self, status, body):
            raw = json.dumps(body, allow_nan=False).encode("utf-8")
            self.response_headers(status, "application/json; charset=utf-8", len(raw))
            self.wfile.write(raw)

        def do_GET(self):
            route = urlsplit(self.path).path
            static = {"/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/telemetry.js": "telemetry.js", "/style.css": "style.css", "/viewer-fullscreen.js": "viewer-fullscreen.js"}
            for filename in ("building-viewer.js", "project-ui.js", "vendor/three.module.js", "vendor/three.core.js", "vendor/OrbitControls.js", "projects/meeting-room/model.js", "projects/atrium-building/model.js", "projects/atrium-building/layout.js", "projects/atrium-building/interiors.js", "projects/atrium-building/geometry.js", "projects/atrium-building/architecture.js", "projects/atrium-building/services.js", "projects/atrium-building/visibility.js", "projects/atrium-building/stairs.js", "projects/atrium-building/egress.js", "projects/atrium-building/egress-plan.js", "projects/atrium-building/reference/means-of-egress-e01.pdf", "projects/meeting-room/preview.svg", "projects/atrium-building/preview.svg"):
                static["/" + filename] = filename
            if route in static:
                filename = static[route]
                content = (HERE / filename).read_bytes()
                mime = {"html": "text/html", "js": "text/javascript", "css": "text/css", "svg": "image/svg+xml", "pdf": "application/pdf"}[filename.rsplit(".", 1)[1]]
                self.response_headers(200, mime + ("; charset=utf-8" if mime != "application/pdf" else ""), len(content))
                self.wfile.write(content)
                return
            if route == "/api/projects":
                self.json_response(200, project_catalog(hub.room))
                return
            if route == "/api/state":
                version, data = hub.latest()
                self.json_response(200, {"version": version, "message": data, **hub.settings()})
                return
            if route == "/api/history":
                try:
                    self.json_response(200, {"samples": hub.store.samples(hub.source), "events": hub.store.alarms(hub.source)})
                except sqlite3.Error:
                    self.json_response(503, {"error": "Local history is unavailable"})
                return
            if route == "/api/history.csv":
                try:
                    samples = hub.store.samples(hub.source, hub.store.retention)
                except sqlite3.Error:
                    self.json_response(503, {"error": "Local history is unavailable"})
                    return
                output = io.StringIO(newline="")
                fields = ["id", "session_id", "observed_at", "sampled_at", "temperature_c", "quality", "reason", "simulated"]
                writer = csv.DictWriter(output, fieldnames=fields)
                writer.writeheader()
                for sample in samples:
                    # Avoid spreadsheet formulas if a device error starts with a formula prefix.
                    row = {key: ("'" + value if isinstance(value, str) and value.startswith(("=", "+", "-", "@")) else value) for key, value in sample.items()}
                    writer.writerow(row)
                raw = output.getvalue().encode("utf-8")
                self.response_headers(200, "text/csv; charset=utf-8", len(raw), "aura-history.csv")
                self.wfile.write(raw)
                return
            if route == "/api/events":
                self.stream()
                return
            self.json_response(404, {"error": "Not found"})

        def stream(self):
            self.response_headers(200, "text/event-stream")
            self.wfile.write(b"retry: 2000\n\n")
            self.wfile.flush()
            version, payload = hub.latest()
            cursor = self.headers.get("Last-Event-ID", "")
            initial = True
            last = version
            if cursor:
                try:
                    session, number = cursor.rsplit(":", 1)
                    number = int(number)
                    if session == hub.stream_id and 0 <= number <= version:
                        last, initial = number, False
                except ValueError:
                    pass
            try:
                self.sse("config", hub.settings())
                if initial and payload is not None:
                    self.sse("state", payload, payload["id"])
                while not hub.stop.is_set():
                    with hub.condition:
                        if hub.version <= last:
                            hub.condition.wait(timeout=12)
                        version, payload = hub.latest()
                        events = [(v, e) for v, e in hub.events if last < v <= version]
                        missed = last < hub.evicted_event_version
                    if payload is not None and version > last:
                        if missed:
                            self.sse("resync", {"reason": "Reload retained history to fill the event gap"})
                        for _, event in events:
                            self.sse("alarm", event, event["id"])
                        self.sse("state", payload, payload["id"])
                    else:
                        self.wfile.write(b": keepalive\n\n")
                        self.wfile.flush()
                    last = version
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                self.close_connection = True

        def sse(self, kind, payload, event_id=None):
            raw = json.dumps(payload, allow_nan=False, separators=(",", ":"))
            prefix = f"id: {event_id}\n" if event_id is not None else ""
            self.wfile.write(f"{prefix}event: {kind}\ndata: {raw}\n\n".encode("utf-8"))
            self.wfile.flush()

        def do_POST(self):
            if urlsplit(self.path).path != "/api/demo/toggle-alarm":
                self.json_response(404, {"error": "Not found"})
            elif not hub.demo:
                self.json_response(403, {"error": "Only available in --demo mode"})
            else:
                self.json_response(200, {"alarm_on": hub.toggle_demo_alarm(), "simulated": True})

        def log_message(self, fmt, *args):
            LOG.debug("http: " + fmt, *args)

    return Handler


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="aura MXCHIP room digital twin")
    parser.add_argument("--device", default="192.168.1.26", help="MXCHIP Modbus TCP host")
    parser.add_argument("--device-port", type=int, default=502)
    parser.add_argument("--unit", type=int, default=1)
    parser.add_argument("--interval", type=float, default=1.0, help="Polling interval: 0.5–60 seconds")
    parser.add_argument("--timeout", type=float, default=2.5, help="Connection/read timeout: >0–30 seconds")
    parser.add_argument("--stale-after", type=float, help="Freshness deadline, seconds (default: max(5, 3 × interval))")
    parser.add_argument("--web-port", type=int, default=8090)
    parser.add_argument("--history-db", default=str(HERE / "data" / "aura.sqlite3"))
    parser.add_argument("--room-config", type=Path, help="Optional room JSON file; see room.example.json")
    parser.add_argument("--demo", action="store_true", help="SIMULATED data, no MXCHIP required")
    args = parser.parse_args(argv)
    if not (0 <= args.unit <= 255 and 1 <= args.device_port <= 65535 and 1 <= args.web_port <= 65535):
        parser.error("Unit must be 0–255 and ports must be 1–65535")
    if not (math.isfinite(args.interval) and 0.5 <= args.interval <= 60):
        parser.error("Interval must be 0.5–60 seconds")
    if not (math.isfinite(args.timeout) and 0 < args.timeout <= 30):
        parser.error("Timeout must be greater than zero and at most 30 seconds")
    if args.stale_after is not None and not (math.isfinite(args.stale_after) and max(1, args.interval * 2) <= args.stale_after <= 3600):
        parser.error("Stale deadline must be at least max(1, 2 × interval) and at most 3600 seconds")
    if not args.device.strip():
        parser.error("Device host cannot be empty")
    return args


def main():
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
    try:
        room = load_room(args.room_config)
        store = HistoryStore(args.history_db)
    except (OSError, ValueError, sqlite3.Error) as exc:
        raise SystemExit(f"Could not load room configuration or local history: {exc}") from exc
    hub = TelemetryHub(args.device, args.device_port, args.unit, args.interval, args.timeout, args.demo, store, args.stale_after, room)
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.web_port), make_handler(hub))
    except OSError:
        store.close()
        raise
    server.daemon_threads = True
    worker = threading.Thread(target=hub.poll, name="modbus-poll", daemon=True)
    worker.start()
    print("\nAURA · ROOM DIGITAL TWIN")
    print("  Source:", "SIMULATED DEMO" if args.demo else f"MXCHIP {args.device}:{args.device_port} (FC04)")
    print(f"  Dashboard: http://127.0.0.1:{args.web_port}")
    print(f"  Polling: {args.interval}s; sensor freshness deadline: {hub.stale_after}s")
    print(f"  Local history: {args.history_db}\n  Stop: Ctrl+C\n")
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        hub.stop.set()
        with hub.condition:
            hub.condition.notify_all()
        server.server_close()
        worker.join(timeout=min(10, args.timeout * 4 + 1))
        if not worker.is_alive():
            store.close()


if __name__ == "__main__":
    main()

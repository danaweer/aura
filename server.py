#!/usr/bin/env python3
"""Local MXCHIP Modbus -> push (SSE) -> aura room digital twin.
No firmware changes, MQTT installation, CDN, or API keys required.
"""
from __future__ import annotations
import argparse
import datetime as dt
import json
import logging
import math
import random
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from device_reader import read_latest

HERE = Path(__file__).resolve().parent
LOG = logging.getLogger("aura")

class TelemetryHub:
    def __init__(self, ip, port, unit, interval, timeout, demo):
        self.ip, self.port, self.unit = ip, port, unit
        self.interval, self.timeout, self.demo = interval, timeout, demo
        self.condition = threading.Condition()
        self.version = 0
        self.payload = None
        self.events = []
        self.stop = threading.Event()
        self.alarm_demo = False
        self.last_alarm = None
        self.fresh_since = None
        self.sample_id = 0

    def publish(self, data, event=None):
        with self.condition:
            self.version += 1
            if event:
                self.events.append((self.version, event))
                self.events = self.events[-100:]
            self.payload = data
            self.condition.notify_all()

    def latest(self):
        with self.condition:
            return self.version, self.payload

    def demo_read(self):
        t = time.monotonic()
        self.sample_id += 1
        def jitter(value, amplitude, rate):
            return round(value + amplitude * math.sin(t * rate), 1)
        temp = jitter(24.2, 1.5, 0.12)
        humidity = jitter(46.2, 3.6, 0.05)
        pressure = jitter(1013.2, 0.8, 0.04)
        alarm = self.alarm_demo
        ts = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        return {
            "online": True, "mode": "demo", "simulated": True, "observed_at": ts,
            "device": {"ip": "SIMULATOR", "port": 502, "unit_id": 1, "protocol": "SIMULATED / DEMO"},
            "environment": {"temperature_c": temp, "humidity_pct": humidity, "pressure_hpa": pressure, "pressure_temperature_c": temp + 0.6},
            "motion": {"acceleration_mg": {"x": 8, "y": -11, "z": 1006},
                       "gyroscope_tenth_dps": {"x": 0, "y": 0, "z": 0},
                       "magnetic_mgauss": {"x": 290, "y": 102, "z": -155}, "steps": 0},
            "status": {"alarm_on": alarm, "wifi_connected": True, "wifi_rssi_dbm": -48,
                       "sample_age_seconds": 0, "sample_sequence_16bit": self.sample_id % 65536,
                       "sensor_health": [{"name": n, "ok": True} for n in
                                         ["Temperature / humidity", "Pressure / temperature", "Accelerometer", "Gyroscope", "Magnetometer"]]},
            "registers": []}

    def poll(self):
        while not self.stop.is_set():
            started = time.monotonic()
            try:
                data = self.demo_read() if self.demo else read_latest(self.ip, self.port, self.unit, self.timeout)
                data["simulated"] = self.demo
                data["online"] = True
                self.fresh_since = time.monotonic()
                alarm = data.get("status", {}).get("alarm_on")
                event = None
                if alarm is not None and self.last_alarm is not None and alarm != self.last_alarm:
                    event = {"kind": "alarm", "alarm_on": alarm, "at": data["observed_at"], "simulated": self.demo,
                             "message": "DEMO alarm activated" if alarm else "DEMO alarm cleared"}
                    LOG.info("Button A / alarm register changed: %s", "ON" if alarm else "OFF")
                if alarm is not None: self.last_alarm = alarm
                self.publish({"kind": "telemetry", "data": data, "simulated": self.demo}, event)
            except Exception as exc:
                LOG.warning("MXCHIP Modbus read failed: %s", exc)
                self.publish({"kind": "offline", "reason": str(exc), "last_seen": self.fresh_since, "simulated": self.demo})
            elapsed = time.monotonic() - started
            self.stop.wait(max(0.10, self.interval - elapsed))

    def toggle_demo_alarm(self):
        if not self.demo:
            raise PermissionError("Demo controls are disabled when connected to the real device")
        with self.condition:
            self.alarm_demo = not self.alarm_demo
            return self.alarm_demo


def make_handler(hub):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def response_headers(self, status, mime, count=None):
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Connection", "close" if mime != "text/event-stream" else "keep-alive")
            if count is not None:
                self.send_header("Content-Length", str(count))
            self.end_headers()

        def json_response(self, status, body):
            raw = json.dumps(body, allow_nan=False).encode("utf-8")
            self.response_headers(status, "application/json; charset=utf-8", len(raw))
            self.wfile.write(raw)

        def do_GET(self):
            route = urlsplit(self.path).path
            if route in ("/", "/index.html", "/app.js", "/style.css"):
                filename = "index.html" if route == "/" else route[1:]
                content = (HERE / filename).read_bytes()
                mime = {"html": "text/html", "js": "text/javascript", "css": "text/css"}[filename.split(".")[-1]]
                self.response_headers(200, mime + "; charset=utf-8", len(content))
                self.wfile.write(content)
                return
            if route == "/api/state":
                version, data = hub.latest()
                self.json_response(200, {"version": version, "message": data,
                                         "demo": hub.demo, "target": hub.ip if not hub.demo else "SIMULATED"})
                return
            if route == "/api/events":
                self.response_headers(200, "text/event-stream")
                self.wfile.write(b"retry: 2000\n\n")
                self.wfile.flush()
                last = -1
                while not hub.stop.is_set():
                    try:
                        with hub.condition:
                            if hub.version <= last:
                                hub.condition.wait(timeout=12)
                            ver = hub.version
                            msg = hub.payload
                            new_events = [(v, e) for v, e in hub.events if last < v <= ver]
                        if msg is not None and ver > last:
                            # Events are sent first so the UI logs transitions even if both arrive quickly.
                            for _, event in new_events:
                                self.sse("alarm", event)
                            self.sse("state", msg)
                        else:
                            self.wfile.write(b": keepalive\n\n")
                            self.wfile.flush()
                        last = ver
                    except (BrokenPipeError, ConnectionResetError, OSError):
                        break
                return
            self.json_response(404, {"error": "Not found"})

        def sse(self, typ, payload):
            raw = json.dumps(payload, allow_nan=False, separators=(",", ":"))
            self.wfile.write(f"event: {typ}\ndata: {raw}\n\n".encode("utf-8"))
            self.wfile.flush()

        def do_POST(self):
            if urlsplit(self.path).path != "/api/demo/toggle-alarm":
                return self.json_response(404, {"error": "Not found"})
            if not hub.demo:
                return self.json_response(403, {"error": "Only available in --demo mode"})
            new_state = hub.toggle_demo_alarm()
            return self.json_response(200, {"alarm_on": new_state, "simulated": True})

        def log_message(self, fmt, *args):
            if not self.path.startswith("/api/events"):
                LOG.debug("http: " + fmt, *args)
    return Handler


def main():
    parser = argparse.ArgumentParser(description="aura MXCHIP 3D Digital Twin demo")
    parser.add_argument("--device", default="192.168.1.26", help="MXCHIP Modbus TCP IP")
    parser.add_argument("--device-port", type=int, default=502)
    parser.add_argument("--unit", type=int, default=1)
    parser.add_argument("--interval", type=float, default=1.0, help="Modbus polling seconds (default: 1)")
    parser.add_argument("--timeout", type=float, default=2.5)
    parser.add_argument("--web-port", type=int, default=8090)
    parser.add_argument("--demo", action="store_true", help="SIMULATED data, no MXCHIP required")
    args = parser.parse_args()
    if not (0.5 <= args.interval <= 60 and 0 < args.device_port <= 65535 and 1 <= args.web_port <= 65535):
        parser.error("Invalid port or interval. Interval must be >=0.5 seconds")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
    hub = TelemetryHub(args.device, args.device_port, args.unit, args.interval, args.timeout, args.demo)
    worker = threading.Thread(target=hub.poll, name="modbus-poll", daemon=True)
    worker.start()
    server = ThreadingHTTPServer(("127.0.0.1", args.web_port), make_handler(hub))
    server.daemon_threads = True
    print("\nAURA · ROOM DIGITAL TWIN")
    print("  Source:", "SIMULATED DEMO" if args.demo else f"MXCHIP {args.device}:{args.device_port} (FC04)")
    print("  Live 3D page: http://127.0.0.1:" + str(args.web_port))
    print("  Updates: one Modbus read every", args.interval, "seconds -> browser SSE push")
    print("  Stop: Ctrl+C\n")
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        hub.stop.set()
        with hub.condition: hub.condition.notify_all()
        server.server_close()

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Connect the user's PyModbus temperature example to their HTML dashboard.

Each /api/telemetry request performs a fresh Modbus FC04 read. First try the
26-register map; if unavailable, read only register 30001 (temperature).
No fabricated measurements, no browser access to raw TCP ports.
"""
import argparse
import datetime as dt
import json
import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
REG_COUNT = 26
REGS = [
    ("Temperature", "°C", "signed", 0.1, 0),
    ("Relative humidity", "%RH", "unsigned", 0.1, 0),
    ("Atmospheric pressure", "hPa", "unsigned", 0.1, 1),
    ("Wi-Fi RSSI", "dBm", "signed", 1, None),
    ("Uptime (16-bit)", "s", "unsigned", 1, None),
    ("Demo alarm", "", "unsigned", 1, None),
    ("Successful Modbus reads (16-bit)", "", "unsigned", 1, None),
    ("Wi-Fi connected", "", "unsigned", 1, None),
    ("Pressure sensor temperature", "°C", "signed", 0.1, 1),
    ("Acceleration X", "mg", "signed", 1, 2),
    ("Acceleration Y", "mg", "signed", 1, 2),
    ("Acceleration Z", "mg", "signed", 1, 2),
    ("Gyroscope X", "0.1 °/s", "signed", 1, 3),
    ("Gyroscope Y", "0.1 °/s", "signed", 1, 3),
    ("Gyroscope Z", "0.1 °/s", "signed", 1, 3),
    ("Magnetic field X", "mGauss", "signed", 1, 4),
    ("Magnetic field Y", "mGauss", "signed", 1, 4),
    ("Magnetic field Z", "mGauss", "signed", 1, 4),
    ("Step counter (16-bit)", "steps", "unsigned", 1, 5),
    ("Sensor validity mask", "", "unsigned", 1, None),
    ("Sample sequence (16-bit)", "", "unsigned", 1, None),
    ("Button A currently held", "", "unsigned", 1, None),
    ("Button B currently held", "", "unsigned", 1, None),
    ("Cumulative sensor errors (16-bit)", "", "unsigned", 1, None),
    ("Sample age", "s", "unsigned", 1, None),
    ("Register map version", "", "unsigned", 1, None),
]
HEALTH_NAMES = [
    ("hts221", "Temperature / humidity"),
    ("lps22hb", "Pressure / temperature"),
    ("accelerometer", "Accelerometer"),
    ("gyroscope", "Gyroscope"),
    ("magnetometer", "Magnetometer"),
    ("pedometer", "Pedometer"),
]


# Many MXCHIP builds handle only one TCP client at a time.
# This lock serializes simultaneous browser refreshes.
MODBUS_LOCK = threading.Lock()


def read_fc04(ip, port, unit=1, timeout=3.0, count=26):
    """The SAME steps as the uploaded simple modbus.py, just configurable.

    1. Make a ModbusTcpClient (IP, port 502).
    2. Connect to MXCHIP.
    3. Read FC04 input registers starting at offset 0.
    4. Return raw register values; always close the socket.
    """
    from pymodbus.client import ModbusTcpClient
    client = ModbusTcpClient(ip, port=port, timeout=timeout)
    try:
        if not client.connect():
            raise ConnectionError(f"Could not connect to MXCHIP at {ip}:{port}")
        result = client.read_input_registers(
            address=0,
            count=count,
            device_id=unit,
        )
        if result.isError():
            raise ValueError(f"Modbus FC04 read returned: {result}")
        if len(result.registers) != count:
            raise ValueError(f"Expected {count} registers, received {len(result.registers)}")
        return list(result.registers)
    finally:
        client.close()


def decode_temperature_only(raw, ip, port, unit):
    """Fallback when the device offers only input register 30001."""
    reg = raw[0]
    valid = reg != 0x8000
    signed = reg - 65536 if reg >= 32768 else reg
    temp = signed / 10 if valid else None
    timestamp = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    return {
        "online": True,
        "mode": "temperature-only",
        "observed_at": timestamp,
        "device": {"ip": ip, "port": port, "unit_id": unit, "protocol": "Modbus TCP / FC04"},
        "environment": {
            "temperature_c": temp,
            "humidity_pct": None,
            "pressure_hpa": None,
            "pressure_temperature_c": None,
        },
        "motion": {
            "acceleration_mg": {"x": None, "y": None, "z": None},
            "gyroscope_tenth_dps": {"x": None, "y": None, "z": None},
            "magnetic_mgauss": {"x": None, "y": None, "z": None},
            "steps": None,
        },
        "status": {
            "wifi_connected": None, "wifi_rssi_dbm": None,
            "alarm_on": None, "uptime_seconds_16bit": None,
            "successful_reads_16bit": None, "sample_sequence_16bit": None,
            "button_a_down": None, "button_b_down": None,
            "sensor_error_count_16bit": None, "sample_age_seconds": None,
            "validity_mask": None, "register_map_version": None,
            "sensor_health": [
                {"id": key, "name": label, "ok": None}
                for key, label in HEALTH_NAMES
            ],
        },
        "registers": [{
            "reference": 30001, "offset": 0, "name": "Temperature",
            "raw": reg, "value": temp, "unit": "°C", "valid": valid,
        }],
    }


def read_latest(ip, port, unit, timeout):
    """Prefer complete firmware map; gracefully fall back to temperature."""
    with MODBUS_LOCK:
        try:
            all_registers = read_fc04(ip, port, unit, timeout, count=26)
            # The existing 26-register MXCHIP firmware identifies map version as 2.
            # Don't interpret an unknown register layout as known measurements.
            if all_registers[25] != 2:
                return decode_temperature_only(all_registers[:1], ip, port, unit)
            full = decode(all_registers, ip, port)
            full["mode"] = "full"
            full["device"]["unit_id"] = unit
            return full
        except Exception as full_error:
            logging.info("Full 26-register read failed: %s; trying temperature", full_error)
            try:
                one = read_fc04(ip, port, unit, timeout, count=1)
                return decode_temperature_only(one, ip, port, unit)
            except Exception as temp_error:
                raise ConnectionError(
                    f"26-register read failed ({full_error}); "
                    f"temperature read also failed ({temp_error})"
                ) from temp_error


def decode(raw, ip, port):
    if len(raw) != REG_COUNT:
        raise ValueError("Expected exactly 26 input registers")
    mask = raw[19]
    registers = []
    for i, (name, unit, number_format, scale, valid_bit) in enumerate(REGS):
        integer = raw[i]
        signed_value = integer - 65536 if (integer & 0x8000) else integer
        invalid_sentinel = 0x8000 if number_format == "signed" else 0xFFFF
        valid = integer != invalid_sentinel
        if valid_bit is not None and not (mask & (1 << valid_bit)):
            valid = False
        value = (signed_value if number_format == "signed" else integer) * scale if valid else None
        if isinstance(value, float) and value.is_integer():
            value = int(value)
        registers.append({
            "reference": 30001 + i,
            "offset": i,
            "name": name,
            "raw": integer,
            "value": value,
            "unit": unit,
            "valid": valid,
        })

    def v(i):
        return registers[i]["value"]

    return {
        "online": True,
        "observed_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "device": {"ip": ip, "port": port, "unit_id": 1, "protocol": "Modbus TCP / FC04"},
        "environment": {
            "temperature_c": v(0),
            "humidity_pct": v(1),
            "pressure_hpa": v(2),
            "pressure_temperature_c": v(8),
        },
        "motion": {
            "acceleration_mg": {"x": v(9), "y": v(10), "z": v(11)},
            "gyroscope_tenth_dps": {"x": v(12), "y": v(13), "z": v(14)},
            "magnetic_mgauss": {"x": v(15), "y": v(16), "z": v(17)},
            "steps": v(18),
        },
        "status": {
            "wifi_connected": v(7) == 1,
            "wifi_rssi_dbm": v(3),
            "alarm_on": v(5) == 1,
            "uptime_seconds_16bit": v(4),
            "successful_reads_16bit": v(6),
            "sample_sequence_16bit": v(20),
            "button_a_down": v(21) == 1,
            "button_b_down": v(22) == 1,
            "sensor_error_count_16bit": v(23),
            "sample_age_seconds": v(24),
            "validity_mask": mask,
            "register_map_version": v(25),
            "sensor_health": [
                {"id": key, "name": label, "ok": bool(mask & (1 << bit))}
                for bit, (key, label) in enumerate(HEALTH_NAMES)
            ],
        },
        "registers": registers,
    }


def make_handler(ip, port, unit, timeout):
    class Handler(BaseHTTPRequestHandler):
        def reply_json(self, status, payload):
            body = json.dumps(payload, allow_nan=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = urlparse(self.path).path
            if path in ("/", "/index.html"):
                content = (HERE / "index.html").read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(content)))
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                self.wfile.write(content)
                return
            if path == "/api/info":
                self.reply_json(200, {"device_ip": ip, "device_port": port, "unit_id": unit, "register_count": REG_COUNT})
                return
            if path == "/api/telemetry":
                try:
                    data = read_latest(ip, port, unit, timeout)
                    self.reply_json(200, data)
                except Exception as exc:
                    logging.warning("Modbus request failed: %s", exc)
                    self.reply_json(503, {"online": False, "error": str(exc), "device": {"ip": ip, "port": port}})
                return
            self.reply_json(404, {"error": "Not found"})

        def log_message(self, fmt, *args):
            logging.info("%s - %s", self.address_string(), fmt % args)

    return Handler


def main():
    parser = argparse.ArgumentParser(description="MXCHIP local Modbus TCP to web dashboard bridge")
    parser.add_argument("--device", default="192.168.1.26", help="MXCHIP IP address (default: 192.168.1.26)")
    parser.add_argument("--device-port", type=int, default=502, help="Modbus TCP port (default: 502)")
    parser.add_argument("--unit", type=int, default=1, help="Modbus unit identifier 0-255 (default: 1)")
    parser.add_argument("--web-port", type=int, default=8080, help="Local dashboard HTTP port (default: 8080)")
    parser.add_argument("--timeout", type=float, default=3, help="Device timeout in seconds (default: 3)")
    args = parser.parse_args()
    if not (0 <= args.unit <= 255 and 0 < args.device_port <= 65535 and 0 < args.web_port <= 65535 and 0 < args.timeout <= 30):
        parser.error("Invalid unit, port or timeout")
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s: %(message)s")
    server = ThreadingHTTPServer(("127.0.0.1", args.web_port), make_handler(args.device, args.device_port, args.unit, args.timeout))
    server.daemon_threads = True
    print("MXCHIP MODBUS WEB CLIENT - press Refresh in browser for a fresh read")
    print(f"  Target Modbus server: {args.device}:{args.device_port}, unit={args.unit}")
    print(f"  Dashboard: http://127.0.0.1:{args.web_port}")
    print("  Press Ctrl+C to stop. Read-only, bound to localhost.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

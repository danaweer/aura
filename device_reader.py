#!/usr/bin/env python3
"""Read and decode MXCHIP Modbus registers. Run server.py for the dashboard."""
import datetime as dt
import logging
import threading

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
# Share the lock if another local consumer reads through this module.
MODBUS_LOCK = threading.Lock()


def read_fc04(ip, port, unit=1, timeout=3.0, count=26):
    """Read FC04 at offset zero and always close the device connection."""
    from pymodbus.client import ModbusTcpClient
    client = ModbusTcpClient(ip, port=port, timeout=timeout, retries=0)
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
    timestamp = dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
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
    if any(type(value) is not int or not 0 <= value <= 65535 for value in raw):
        raise ValueError("Registers must be unsigned 16-bit integers")
    mask = None if raw[19] == 0xFFFF else raw[19]
    registers = []
    for i, (name, unit, number_format, scale, valid_bit) in enumerate(REGS):
        integer = raw[i]
        signed_value = integer - 65536 if (integer & 0x8000) else integer
        invalid_sentinel = 0x8000 if number_format == "signed" else 0xFFFF
        valid = integer != invalid_sentinel
        if valid_bit is not None and (mask is None or not (mask & (1 << valid_bit))):
            valid = False
        if i in (5, 7, 21, 22) and integer not in (0, 1):
            valid = False
        value = (signed_value if number_format == "signed" else integer) * scale if valid else None
        if isinstance(value, float):
            value = round(value, 6)
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

    def boolean(i):
        return None if v(i) is None else v(i) == 1

    return {
        "online": True,
        "observed_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
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
            "wifi_connected": boolean(7),
            "wifi_rssi_dbm": v(3),
            "alarm_on": boolean(5),
            "uptime_seconds_16bit": v(4),
            "successful_reads_16bit": v(6),
            "sample_sequence_16bit": v(20),
            "button_a_down": boolean(21),
            "button_b_down": boolean(22),
            "sensor_error_count_16bit": v(23),
            "sample_age_seconds": v(24),
            "validity_mask": mask,
            "register_map_version": v(25),
            "sensor_health": [
                {"id": key, "name": label, "ok": None if mask is None else bool(mask & (1 << bit))}
                for bit, (key, label) in enumerate(HEALTH_NAMES)
            ],
        },
        "registers": registers,
    }



if __name__ == "__main__":
    raise SystemExit("Run python server.py (or python server.py --demo) to start the dashboard.")

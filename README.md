# aura — MXCHIP Meeting Room Digital Twin (working prototype)

This is a **runnable 3D meeting-room demonstrator**. A Python server polls your existing MXCHIP AZ3166 Modbus TCP Server; telemetry is **pushed to the web page** using Server-Sent Events (SSE). The page contains a lightweight, mouse-orbitable 3D model **without external 3D libraries or CDNs**.

**No MXCHIP C++ firmware changes are required. No Mosquitto installation is required.** It uses the connection that was already working in your earlier dashboard.

## A. Run it on Windows with your MXCHIP

1. Unzip this project into one folder. Open PowerShell in that folder.
2. Install Python dependency:

   ```powershell
   py -m pip install -r requirements.txt
   ```
3. Confirm the physical board is connected to the same LAN and its Modbus port is reachable:

   ```powershell
   Test-NetConnection 192.168.1.26 -Port 502
   ```
4. Start the twin:

   ```powershell
   py server.py --device 192.168.1.26
   ```
5. Open **http://127.0.0.1:8090** in Chrome or Edge. Do **not** double-click `index.html`: it must be served through `server.py`.

**Note:** It uses port **8090**, not 8080, so it can run alongside your previous dashboard. For best results, close the old dashboard Python script and any Modbus clients, because some MXCHIP firmware versions support only one TCP client at a time. The board's IP can change after reconnection—use the IP currently displayed on the MXCHIP OLED.

## B. Try it without the device (clearly labeled simulation)

```powershell
py server.py --demo
```

Open http://127.0.0.1:8090. **SIMULATED MODE** is displayed prominently. You can activate/deactivate a demo alarm using the button on the right. None of this data is claimed to be from the physical device.

## What the prototype demonstrates

| Object or behavior | Source | Behavior |
| --- | --- | --- |
| Room geometry, chairs, meeting table, wall display | Procedural 3D canvas | Schematic/demo objects, clickable and orbitable |
| MXCHIP digital sensor | Modbus FC04 input register 30001 etc. | Temperature, humidity, pressure, RSSI, uptime, acceleration |
| Alarm marker and room visual change | Input register **30006** from MXCHIP Button A | UI turns red and logs a demo alarm transition |
| Smoke detector, FACP, HVAC diffuser, room fixtures | Decorative 3D model only | **Not physically connected**; no fabricated telemetry |
| 1-second data stream | Python background Modbus polling | Python SSE pushes readings into the website, no Refresh |
| Offline state | Modbus read exceptions | UI marks device offline, previous readings labeled stale |
| Demo mode | Local Python simulator | Clearly flagged **SIMULATED** with toggle button |

The **physical Button A must actually toggle register 30006** for alarm visualization to change in live mode. Some earlier firmware revisions had Button A/B issues; if your button is not working, the site cannot invent an alarm event.

This is *near real time* (one Modbus polling cycle + network/render latency), not hardware interrupt-driven MQTT push. Because existing firmware uses Modbus TCP, the MXCHIP is answering requests rather than initiating them. Future MQTT integration can replace the data ingestion layer while the 3D room remains unchanged.

## Learning the flow

```text
MXCHIP sensors (real hardware)
  -> MXCHIP Modbus TCP Server 192.168.1.26:502
  -> server.py (PyModbus FC04, every 1 second)
  -> Python normalizes data into structured JSON
  -> /api/events (SSE, server pushes data to browser)
  -> app.js updates 3D model markers, status panels, timeline, graph
```

Browser has no raw TCP access to Modbus. Python performs that communication. `/api/state` returns the most recent reading and `/api/events` streams updates.

## Testing and troubleshooting

- **OFFLINE / stale:** Check board IP, port 502, Wi-Fi, and Modbus server. Run `Test-NetConnection <device IP> -Port 502`. Stop other clients.
- **Register map mismatch:** The backend uses the existing *26-register* map version 2 when available, with a fallback to just temperature (30001). Missing measurements show as unavailable; alarms show UNKNOWN if not mapped.
- **Buttons:** If physical A doesn't change alarm register 30006, fix firmware input handling separately. The dashboard cannot toggle live alarm over FC04 (read-only).
- **3D missing:** The 3D is rendered with HTML canvas, no CDN; supported in modern Chromium browsers. Check browser console for JavaScript errors.
- **Local only:** The demo server binds to `127.0.0.1`. For safety, don't forward Modbus port 502 or publish this demo to an untrusted network.

## Safety

The room is a concept model, not a surveyed building or BIM. MXCHIP environmental values are not calibrated certified measurements. **Button A is a software demo alarm only**, not a real fire alarm. Do not use this system for life safety decisions.

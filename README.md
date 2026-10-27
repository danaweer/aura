# aura — Building & Room Digital Twin Studio

A local project workspace for interactive 3D architecture and MXCHIP telemetry. It includes a new three-floor atrium building and your preserved, furnished meeting room. No firmware changes, MQTT broker, CDN, or API keys are required. The building uses a locally vendored Three.js renderer; the original room retains its Canvas2D renderer.

## Projects

Use **Projects** in the navigation or the header to see both saved models. Opening a project restores its model, requirements, development phases, and assigned IoT devices. The last opened project is remembered; direct links are also supported:

- `http://127.0.0.1:8090/#projects` — project library.
- `http://127.0.0.1:8090/#project/atrium-building` — new building (default on first visit).
- `http://127.0.0.1:8090/#project/meeting-room` — original room.

The original room's geometry is preserved in **`projects/meeting-room/model.js`**, with its saved configuration in `room.json` and requirements/device metadata in `project.json`. Its furniture, camera controls, MXCHIP telemetry, demonstration alarm, SQLite history, and CSV export remain available in that project. `--room-config` continues to override the meeting-room configuration.

The building is in **`projects/atrium-building/`**. It now includes the supplied revision A office plans: ground-floor arrival and public functions, first-floor teams and collaboration, and second-floor leadership and boardroom. There are 52 named rooms plus stairs, cores and risers across three occupiable floors, with an unoccupied glazed roof. The existing white frame, blue-green glazing, sloping glazed crowns, central atrium, galleries, stairs, lift core and revolving entrance are retained and adapted to the plans.

The office geometry follows the plans' **40 × 24 m working envelope**, with two 15 m wings, a 10 m central zone, and 2.4 m main corridors. Front is +Z; it does not indicate geographic north. Floor elevations remain 0, 4.2 and 8.4 m. This is a schematic model: the plans do not establish surveyed dimensions, detailed stair geometry, structural coordination or an installation design. The phase-one shell is saved in `projects/atrium-building/archive/shell-v1.js`.

Building controls:

- Drag to orbit through 360°, scroll to zoom, or use the view/zoom buttons. Right-drag pans; touch gestures are supported.
- Select **Ground floor**, **Level 01**, or **Level 02** to isolate a floor. **Whole building** restores all three.
- **Office cutaway** opens a furnished floor; **Top** shows its plan. **Low walls** exposes furniture while preserving the room boundaries; turn it off to see full-height partitions.
- **Find a room** or a room label selects its location, ID, area, capacity and design notes. Furniture, partitions and labels can be toggled independently.
- **Service reserves** shows empty plant/IT reserves, aligned shaft compartments, corridor ceiling-route allowances and an empty rear service-yard reservation. These volumes represent coordination space, not installed equipment.
- **Atrium view** opens the front and roof to inspect the galleries, stairs, and lift core.
- **Cutaway**, **Glazing**, and **Roof** control architectural visibility. Interior and individual-floor views automatically hide the roof.
- Click a room, furniture item or structural element to inspect it. Keyboard arrows orbit, +/− zoom, and Home restores the overview.

The building has **zero assigned IoT devices**. The MXCHIP remains assigned to the meeting room; switching models does not move its readings into the building. Requirements and a roadmap are stored with each project. Architecture and office furnishing are established. HVAC, fire detection, pump/sprinkler equipment, piping and IoT/BMS integration remain planned. Ground-floor fire pump, water/mechanical, electrical and server/UPS rooms, upper-floor AHU rooms, IDF spaces and risers are reserved without fitted equipment. Toilets and pantries align vertically; BMS/security has operator furniture only.

## Run on macOS or Linux

Use Python 3.10 or newer:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python server.py --demo
```

Open **http://127.0.0.1:8090**. To read the physical board instead:

```sh
python server.py --device 192.168.1.26
```

Use the IP currently displayed on the MXCHIP OLED. The computer and board must be on the same LAN. Close other dashboards or Modbus clients if the board only supports one TCP connection.

## Run on Windows

In PowerShell, from the project folder:

```powershell
py -m pip install -r requirements.txt
Test-NetConnection 192.168.1.26 -Port 502
py server.py --device 192.168.1.26
```

For simulation, use `py server.py --demo`. Open **http://127.0.0.1:8090** in the browser. Serve the page through `server.py`; opening `index.html` directly will not connect it to the API. Press Ctrl+C to stop.

## Data quality and alarms

In the meeting-room project, the dashboard distinguishes network connectivity from sensor quality:

| Status | Meaning |
| --- | --- |
| DEVICE ONLINE / LIVE | Device responds, samples advance, and sensor health is valid |
| SIMULATED STREAM / SIMULATED | Values are generated locally in software |
| CONNECTED · SENSOR STALE | Sample age exceeded the deadline, or the sequence stopped advancing |
| CONNECTED · SENSOR FAULT | Firmware reports a failed sensor |
| CONNECTED · DATA UNAVAILABLE | Required measurement is missing or invalid |
| CONNECTED · QUALITY UNVERIFIED | Firmware cannot establish sample age or sensor health |
| DEVICE OFFLINE | Modbus reads failed |
| STREAM RECONNECTING / STREAM STALLED | Browser lost its stream, or no state updates arrived before the deadline |

The default sensor deadline is `max(5 seconds, 3 × polling interval)`. It can be changed with `--stale-after`. The browser independently watches for missing stream updates and checks again when a background tab becomes visible.

Invalid Boolean registers stay **UNKNOWN**, including unsupported values other than 0 or 1. Invalid health masks never report healthy sensors. While disconnected or stale, the current alarm is UNKNOWN and the inspector labels the last known alarm state and time.

Physical **Button A must toggle input register 30006 in your firmware**. FC04 is read-only; the browser cannot change that physical register. The simulated alarm button appears only in demo mode and publishes changes immediately.

The reader prefers the 26-register firmware map, version 2. Older or unknown maps fall back to temperature at register 30001; other readings remain unavailable and sample quality is unverified.

## History and CSV export

The server saves temperature samples, quality, and alarm transitions to **`data/aura.sqlite3`**, using Python's built-in SQLite library. History survives page reloads and server restarts. Sources are separated by room code, simulation/live mode, device host, port, and unit identifier.

- The chart restores the latest 60 retained samples, with a real time axis. Repeated device sequences and replayed messages do not create duplicate measurements.
- Missing, faulty, and stale readings appear as gaps. Amber segments mark samples whose quality is unverified. Server restarts also break the line.
- Alarm events have stable IDs and their original UTC timestamps, displayed in the browser's local timezone. SSE resumes missed transitions without duplicating already delivered alarms.
- **Download CSV** exports retained temperature history and quality, including timestamps, source-session IDs, and simulation labels.
- Retention is bounded to 10,000 samples and 10,000 alarm transitions per source. The API returns the latest 100 alarm transitions for the timeline.

Choose another database or disable disk persistence:

```sh
python server.py --demo --history-db /path/to/history.sqlite3
python server.py --demo --history-db :memory:
```

If local storage fails, live telemetry continues and the dashboard reports the history error. The SQLite file contains local telemetry records; it is excluded from Git.

## Room and sensor configuration

Copy and edit `room.example.json`, then run:

```sh
python server.py --demo --room-config room.example.json
```

Configure the room name, code, location, dimensions, and MXCHIP position without editing JavaScript. Dimensions and positions use metres. The room center is x=0, z=0; y is height above the floor. The server validates dimensions and ensures the sensor lies inside the room. The renderer scales the schematic room and moves the sensor marker with the board model. Furniture remains schematic and scales with the room.

The workspace currently has two model projects and one device connection, assigned to the meeting room. Additional device connections will be established in later phases. Hosting and authentication are future work; the server binds to `127.0.0.1`.

## Controls and accessibility

Drag to orbit, scroll to zoom, or use the view and zoom buttons. With the room canvas focused, arrow keys orbit, +/− zoom, and Home resets the camera. Sensor tags support Enter and Space. View buttons expose their selected state, connection changes are announced to assistive technology, and reduced-motion preferences disable pulsing and smooth scrolling.

The inspector shows MXCHIP telemetry only for the sensor. The alarm view shows its demo input; the HVAC view explains that the model has no connected measurements or controls. Sensor health and firmware mode are available in the sensor inspector. The temperature chart also has a textual summary and CSV export.

## Files and API

| File | Responsibility |
| --- | --- |
| `server.py` | Single application entry point, polling, quality assessment, HTTP and SSE |
| `device_reader.py` | Modbus FC04 reads, register decoding, temperature-only fallback |
| `history.py` | Bounded SQLite sample and alarm history |
| `telemetry.js` | Browser stream state, sample deduplication, chart segmentation |
| `app.js` | Shared workspace, room telemetry, and preserved Canvas2D room viewer |
| `project-ui.js`, `projects.py` | Project cards, navigation, metadata and catalog API |
| `building-viewer.js` | WebGL camera, model selection, floor and layer controls |
| `projects/meeting-room/` | Preserved room model, configuration, manifest and preview |
| `projects/atrium-building/` | Architecture, office-layout data, furniture geometry, manifest, preview and original shell archive |
| `vendor/` | Locally served, pinned Three.js and OrbitControls modules |
| `index.html`, `style.css` | Accessible page structure, responsive layout, styling |
| `room.example.json` | Example room and sensor configuration |
| `tests/` | Python, JavaScript, and real-browser regression checks |

`GET /api/projects` returns project manifests with requirements, phases, and scoped IoT assignments. `GET /api/state` returns the latest state and configuration. `GET /api/events` streams configuration, state, and alarm events with resumable IDs. `GET /api/history` returns recent samples and alarms. `GET /api/history.csv` downloads retained temperature history. `POST /api/demo/toggle-alarm` is available only in demo mode. Running `device_reader.py` directly prints instructions to use `server.py`.

Run `python server.py --help` for all options. Ports, unit IDs, timeout, interval, freshness deadline, and room configuration are validated before polling starts.

## Development and verification

Node.js is required only for frontend development and tests. The running dashboard needs Python and a modern browser; the building viewer also requires WebGL. The original meeting room remains usable without WebGL. Three.js and OrbitControls are pinned in `package-lock.json` and copied into `vendor/`, including their MIT license, so runtime rendering needs no external network access. After intentionally updating Three.js, run `npm run vendor:three` to refresh those local modules.

```sh
python -m unittest discover -s tests -v
npm test
npm ci
npm run format:check
npm run test:browser
```

Python tests cover register decoding, invalid data, firmware fallback, stale/frozen samples, offline history, SQLite persistence, CLI validation, HTTP endpoints, and SSE replay. JavaScript tests also check room tiling and areas, corridor widths, vertical service alignment, furniture capacities, empty reserves, door openings and upper-floor slab openings, as well as the three-floor structure, preserved room and telemetry behavior.

Browser checks start an isolated demo server and database, verify the three furnished floor plans, room navigation, interior layers, service reserves, atrium and glazing, project switching and IoT isolation, then exercise the original room’s alarm, history, reconnection, inspectors and keyboard controls. Desktop/mobile screenshots and each floor's plan are saved under `test-results/`. On macOS the test uses installed Google Chrome. On other systems, first run `npx playwright install chromium`. Set `PYTHON_BIN` if your Python interpreter is not at `.venv/bin/python` (`.venv/Scripts/python.exe` on Windows). Set `AURA_BROWSER_CHANNEL` to override the browser channel.

Format the frontend with `npm run format`. Runtime data, virtual environments, installed development packages, caches, and browser artifacts are ignored by Git. No hardware is needed for the automated tests; verify real firmware mapping and sensor behavior separately on the board.

## Troubleshooting

- **Device offline:** Check the OLED IP, Wi-Fi, port 502, and other connected clients.
- **Sensor stale:** Check sample age and sequence in `/api/state`; a working TCP connection can coexist with frozen firmware sampling.
- **Sensor fault or unverified:** Read the sensor-health and firmware-mode details in the inspector.
- **Stream stalled:** Check that the Python server is running. The browser reconnects automatically.
- **Alarm does not change:** Verify that physical Button A changes register 30006 in your firmware.
- **History unavailable:** Check database path permissions and free disk space.

## Safety

The room is a schematic concept model, not a surveyed building or BIM. Environmental values are not calibrated certified measurements. **Button A is a software demonstration alarm, not a real fire alarm.** This system must not be used for life-safety decisions.

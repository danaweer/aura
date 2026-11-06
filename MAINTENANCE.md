# Maintenance — persistence, corrective reports and triage

Task 1 established persistent storage. Task 2 adds corrective problem reporting and manager triage for `AHU-L1-01`, originally in the building inspector and now on the dedicated Maintenance page added in Task 3. Assignment, repair/completion/verification, calendar, scheduler, IoT rules, notifications, attachments and AI remain outside this stage.

## Storage and migrations

The existing `HistoryStore(path)` now exposes `store.maintenance`. It shares the same SQLite connection and thread lock, and the history store still owns connection shutdown. Normal server startup applies the migration automatically to the existing `--history-db` file (default `data/aura.sqlite3`). In-memory history stores also receive an independent in-memory maintenance schema.

`maintenance.py` contains append-only, numbered migrations. A dedicated `maintenance_schema_migrations` table records applied revisions; SQLite's global `user_version` is untouched. Migration statements and pilot-asset inserts commit together using `BEGIN IMMEDIATE`; a failure rolls back the maintenance migration. Unknown or non-contiguous migration histories are rejected rather than downgraded. Foreign keys are enabled on the shared connection before transactions begin.

The new tables are `maintenance_assets`, `maintenance_work_orders`, `maintenance_notes`, `maintenance_audit_events` and `maintenance_schema_migrations`. Project-scoped composite keys, foreign keys and lookup indexes keep asset/job references within their project. Existing `samples` and `alarms`, their source isolation, and their retention rules are unchanged. Maintenance history is never included in telemetry retention cleanup.

## Canonical pilot registry

`projects/atrium-building/maintenance-assets.json` is the shared, language-neutral maintenance catalog. It registers exactly `AHU-L1-01`, `BS-G-01` and `FP-01`, using the current equipment names, systems, rooms, floors and IDs. Python loads this file; the focused JavaScript test compares it directly with `EQUIPMENT` from `equipment-plan.js`, so model/catalog mapping drift fails visibly. Later frontend/API work can reuse this catalog rather than define another list.

Records include project/asset keys, name, system, room/floor, optional parent, criticality, model reference and design/commissioning states. Current equipment remains conceptual and not connected. Criticality is **unassessed**, not an invented safety rating. Initial seeding is idempotent and preserves existing persisted metadata; later catalog changes require explicit maintenance operations or migrations.

## Operations available to the next task

```python
from history import HistoryStore

history = HistoryStore("data/aura.sqlite3")
try:
    maintenance = history.maintenance
    asset = maintenance.get_asset("atrium-building", "AHU-L1-01")
    order = maintenance.create_work_order(
        "atrium-building", asset["asset_id"], "Inspect noisy fan",
        actor="local-operator", request_key="a-stable-client-submission-key",
    )
    maintenance.add_note(
        "atrium-building", order["work_order_id"], order["version"],
        "Reported noise; inspection pending.",
    )
finally:
    history.close()
```

- Asset lookup: `get_asset(project_id, asset_id)` and `list_assets(project_id)`. Missing lookup returns `None`; creating a job for an unknown/cross-project asset raises `AssetNotFoundError` with a mapping-error message.
- Work orders: `create_work_order`, `get_work_order` and `list_work_orders` (optional asset filter, bounded limit). New records are manual/corrective, in **New** state, with a separate validated priority. No automatic deadlines, assignees, measurements or lifecycle claims are invented.
- Basic edits: `update_work_order(..., expected_version, title=..., description=...)` and `add_note(..., expected_version, body)`. Each successful write increments the version and records an audit event atomically. Stale writes raise `ConflictError`; unknown/scoped-out jobs raise `WorkOrderNotFoundError`.
- History: `list_notes` and `list_audit_events`, both scoped by project/job. Audit before/after values are JSON text. Notes are stored as plain text; future UI must render them as text, not raw HTML.
- Submission deduplication: a stable `request_key` returns the original job for the same input. Reusing it with different data raises `ConflictError`. Keys are project-scoped.

Lifecycle/assignment/deadline columns reserve the next task's storage, but have **no generic edit setter**: transitions, acknowledgement, completion, verification, reassignment, cancellation, deadlines and reopening require the specification's validation/audit rules in later work. Actor values here are local audit labels, not authentication. Person validation, role permissions and actual downtime/work-record handling remain future work. Room-only unknown-asset reports are now supported by the reporting/triage layer described below; existing asset references are never silently invented.

## Focused verification

`tests/test_maintenance.py` checks seeding, lookup/mapping errors, persistence, idempotency, separate connections and stale edits, foreign keys, atomic audit/migration rollback, unknown schema versions, catalog validation and legacy-history preservation. Existing `HistoryTests`/`HubTests` exercise the affected telemetry-store integration. `tests/maintenance-assets.test.js` checks the shared catalog against the real JavaScript model definitions. The reporting/triage browser checks additionally verify safe text, persisted reload, related-report linking and unchanged Normal/Blueprint camera/layer state. No 3D geometry or viewer navigation code changed.

Changed files: `history.py`, `maintenance.py`, the pilot JSON catalog, `tests/test_maintenance.py`, `tests/maintenance-assets.test.js` and this document. The supplied implementation specification is left unchanged.


## Corrective reporting and manager triage (Task 2)

Open **Maintenance** in the application sidebar, then **Reports**. Employee reports capture name, symptom, observed time, impact, description, room and optional known AHU. Choose **Equipment unknown** for a room-only observation. The building inspector's compact **Open maintenance** action passes the current model asset/room to this page without moving the camera. **Use selected room / AHU** also reuses the retained selection. No sensor reading is required or generated.

Choose **Demo role → Manager**, select a report and save a priority/review reason. An unmapped report can be reviewed without a job. Once mapped to the registered AHU, choose **Create corrective work order** or **Link existing related work order**. Related reports keep their own original content/history while sharing one job. Closed/completed/cancelled jobs and jobs for other assets cannot be linked. Linked reports are read-only in this slice; later work-order lifecycle actions are not exposed.

The Manager role is enforced as an explicit `X-AURA-Demo-Role: manager` workflow header at the triage endpoint. It is a local demonstration convention, **not authentication or a production authorization system**. Reporter names and the `local-manager` actor are audit labels. Immediate-hazard reports and Emergency priorities show the site's emergency-procedure reminder separately; the form is not emergency dispatch and assigns no universal response targets.

Migration **v2** adds `maintenance_rooms`, `maintenance_reports` and `maintenance_report_events`, preserving v1 jobs/history. `maintenance-rooms.json` is derived from the current model room definitions and checked against them in Node tests. Room and asset references remain project-scoped. The original room, reporter, reported equipment, observed time, symptom, impact and description are preserved when a manager maps equipment or sets priority.

`store.maintenance.reports` provides `rooms`, `submit`, `get`, `list`, `events` and `triage`. Report submission uses a persistent request key; same-key/same-input retries return one report, and changed-payload reuse conflicts. The browser keeps a submitted draft/key across reload or a lost response. **New report / clear draft** starts a deliberate new submission. Every triage requires a reason and current report version; existing-job linking also requires the current job version. Job creation/update, report linking and both audit histories commit in one transaction. Duplicate/stale triage cannot create another job.

API (all scoped to `project_id=atrium-building`):

- `GET /api/maintenance/overview?project_id=...`: pilot asset, reportable rooms, recent reports and AHU work orders.
- `GET /api/maintenance/reports/{id}?project_id=...`: report, audit events and linked job.
- `POST /api/maintenance/reports`: submit an observation, including `request_key`; `asset_id` may be null.
- `POST /api/maintenance/reports/{id}/triage`: manager review, priority/reason, optional asset mapping and `link_mode` (`review`, `new`, `existing`). Existing links require `work_order_id` and `expected_work_order_version`.

Bodies are bounded to 64 KiB, unexpected fields rejected, observation timestamps require a timezone and cannot be materially in the future, and conflicts return HTTP 409. Unmapped IDs return mapping errors. All employee text renders through `textContent`/native form controls. Refresh the panel or reconnect to reload persisted state; maintenance does not rely on the telemetry SSE stream.

Task 2 files: `maintenance.py` (v2/private transactional order insertion), `maintenance_reports.py`, `maintenance_api.py`, `maintenance-ui.js`, the reporting room catalog, `server.py`, `app.js`, `index.html`, `style.css`, focused persistence/API/catalog/browser tests and this document. The supplied specification remains unchanged. Screenshots: `test-results/maintenance-report.png` and `maintenance-triage.png`.

## Task 3 — application navigation

The existing `ProjectLibrary` hash router now recognizes application destinations as well as the existing `#projects` and `#project/{id}` routes. The default project-opening behavior is preserved. The sidebar remains available on narrow displays through horizontal scrolling.

| Destination | Route | Current behavior |
| --- | --- | --- |
| Dashboard | `#dashboard` | Functional launch page using real project metadata; links to Projects, Maintenance and IoT Devices. |
| Projects | `#projects` | Existing saved-project library. |
| 3D Viewer | `#project/atrium-building` (or another project ID) | Existing viewer and controls. Navigation retains the mounted building model, camera, selected assets, floor, layers and Normal/Blueprint presentation. |
| Maintenance | `#maintenance?project_id=atrium-building` | Functional Reports and Work Orders sections. Existing reporting, demo manager triage, priorities, history and work-order linking use the same APIs and database. Work Orders is a read-only view of persisted AHU jobs with links back to their reports. |
| Calendar | `#calendar` | Navigable, explicitly planned screen; no scheduling backend. |
| Notifications | `#notifications` | Navigable, explicitly planned screen; no inbox/delivery backend. |
| IoT Devices | `#iot-devices` | Functional project-assignment inventory from the current project catalog, linking to the existing project telemetry. Inventory does not assert a live connection. |
| Users & Access | `#users-access` | Planned administrator portal; no authentication/access implementation. |

Maintenance's **Preventive**, **Predictive** and **Asset history** sections reserve future space and are explicitly labeled unimplemented. Current report review history is still available within each report.

An inspector link can carry `asset_id` and `room_id`, for example `#maintenance?project_id=atrium-building&asset_id=AHU-L1-01&room_id=L1-M01`. Canonical IDs are preserved. AHU links prefill the AHU/room; another asset keeps its own ID in the page context and uses Equipment unknown for room reporting, rather than silently substituting the AHU. Reports remain accessible independent of asset context. Maintenance for other projects shows the pilot availability message and does not bind those projects to the building's assets. A pending submitted draft/key is preserved when navigating.

To submit an AHU report, select **Maintenance → Reports**, select `AHU-L1-01`, choose the observed room, enter the report fields and submit. Choose **Demo role → Manager** to review it. Existing reports and linked orders remain in the same SQLite tables; Task 3 adds no migrations or API/backend changes.

Task 3 files: `app.js`, `project-ui.js`, `maintenance-ui.js`, `index.html`, `style.css`, `tests/navigation.test.js`, `tests/navigation-browser.js`, the adapted maintenance/browser checks and this document. Checks cover deep links, browser Back, asset/room prefill, non-AHU mapping, Reports/Work Orders, future screens, mobile navigation and camera/selection/Blueprint preservation, alongside the existing reporting/triage and viewer/telemetry browser regressions. Screenshots include `navigation-dashboard.png` and `navigation-maintenance-mobile.png` under `test-results/`.

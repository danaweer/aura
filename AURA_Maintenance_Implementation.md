# AURA maintenance stage — implementation specification and Codex handoff

Prepared 3 November 2026. Scope: maintenance integrated into the existing AURA building viewer, with an IoT-first path toward predictive maintenance.

## 1. Intended result

Add a maintenance module inside AURA. Every maintainable asset in the 3D building should have a stable identity, current evidence, maintenance plans, work orders and an auditable history. Users can locate a job in the model and open an asset's maintenance record from the model.

Three entry points feed one work-order workflow:

| Entry point | What starts it | Result |
| --- | --- | --- |
| Preventive | A scheduled inspection, service or usage interval | A dated job with a checklist and a responsible person/team |
| Corrective | A reported or detected defect | A reviewed repair job, diagnosis, repair record and verification |
| Condition-based / predictive | Valid operating measurements show an abnormal condition or a supported degradation forecast | An evidence-linked inspection/intervention job |

Keep the user's three main UI categories: Predictive, Preventive and Corrective. Inside Predictive show the method explicitly: **Condition rule**, **Trend forecast**, or later **Validated model**. Threshold detection is not a claim that the app predicts failure. A trend forecast can estimate a threshold crossing without AI; this is not a proven remaining-life estimate.

The origin and the action are separate. A scheduled inspection may discover a defect and create a linked corrective job. A sensor alert may require a corrective repair. Preserve the original plan, report and alert rather than repeatedly changing the work order's origin to hide how the issue was found.

## 2. Repository findings and implementation boundaries

Reviewed the public `main` branch of https://github.com/danaweer/aura on 3 November 2026. The local working tree may contain newer blueprint or integration work; inspect that tree before applying this specification.

Verified integration points:

| Existing file / area | Observed responsibility | Proposed extension |
| --- | --- | --- |
| `server.py` | Python `ThreadingHTTPServer`, polling, JSON endpoints and SSE | Maintenance API registration, worker lifecycle and change notifications |
| `history.py` | SQLite telemetry/alarm persistence | Preserve existing tables and behavior; add versioned maintenance migrations and a separate store module |
| `telemetry.js` | Browser telemetry and quality handling | Reuse data-quality semantics; keep maintenance rendering in a separate module |
| `building-viewer.js` | Three.js selection, floor/layer visibility and asset inspectors | Stable asset selection adapter, maintenance markers and locate-in-model actions |
| `projects/atrium-building/equipment-plan.js` | Existing equipment IDs and locations | Register maintainable equipment using existing IDs |
| `projects/atrium-building/device-plan.js` and `devices.js` | Device candidates and inspection metadata | Register actual generated sensor IDs and their monitored parent assets |
| `project-ui.js`, `app.js`, `index.html`, `style.css` | Project navigation and application UI | Maintenance navigation, work-order panels, calendar and technician view |
| `tests/` | Python, Node and browser checks | Extend with lifecycle, scheduler, rule-engine and viewer integration tests |

The checked repository uses plain JavaScript/Three.js, Python and SQLite. Do not migrate to Next.js, FastAPI, Odoo or another framework for this stage. Current server static files are explicitly allowlisted: newly added JavaScript modules need to be served deliberately.

The current building manifest has no assigned live IoT devices. Its equipment and device concepts are unconnected. The MXCHIP connection belongs to the separate meeting-room project. A maintenance badge or a modeled sensor must not silently create a live binding. The root README contains older descriptions; use the current model definitions and project manifest when reconciling equipment availability.

This document is an implementation handoff, not an applied patch. No repository code, hardware configuration, messages or production schedules were changed while preparing it.

## 3. Pilot assets and three end-to-end scenarios

Use these verified modeled assets initially. Other systems can use the same workflow after registration.

| Modeled asset | Existing ID | Existing location | Pilot |
| --- | --- | --- | --- |
| Domestic booster skid | `BS-G-01` | `G-M02`, ground-floor water/mechanical room | Low-flow condition with running/demand context |
| First-floor AHU | `AHU-L1-01` | `L1-M01` | Scheduled inspection and employee complaint |
| Main fire pump | `FP-01` | `G-M01` | Maintenance history and reviewed inspection records; monitoring only |

Choose the actual AHU instrumentation/sensor ID from the current generated device records. Do not invent a sensor ID and imply it is already modeled. Tank-space reservations are not commissioned tanks and should remain visibly identified as reservations.

### Scenario A — domestic-water early warning

1. Bind a real flow meter to a named monitored pipe segment or the booster outlet, and bind the relevant equipment context. Until installed, the point is **Unconnected**.
2. Store calibrated readings with units, timestamps, quality, source and operating mode.
3. Evaluate low flow only when flow is expected: for example, confirmed running equipment and a known demand/test condition, after startup settling.
4. A sustained abnormal condition creates one maintenance alert with a graph and a rule explanation.
5. Show: **Low delivery flow under expected-demand conditions. Possible causes require inspection.** Candidate causes may include a restricted valve/strainer, supply limitation, pump trouble or measurement error; one flow value does not identify the cause.
6. The manager acknowledges and assigns an inspection job, or a configured policy creates an unassigned job for review.
7. The technician records observations, diagnosis, action and a post-work check. If the fault is not identified, record **Undetermined** and schedule investigation.
8. The alert and the job have separate lifecycles. Restored measurements do not erase a job or prove that a repair was verified.

**Illustrative test configuration only:** baseline flow 100 L/min, low-flow threshold 70 L/min for 60 seconds, recovery above 80 L/min for 120 seconds. These are software test values for a controlled domestic-water example, not design criteria, installed settings or fire-system limits. They must remain labeled DEMO until replaced by reviewed configuration and real measurements.

For an initial trend forecast, use comparable operating periods and estimate when a reviewed limit may be crossed. Require sufficient valid history, a minimum time span, appropriate operating-state filtering and a documented fit-quality gate. Show **Insufficient evidence** when those conditions are not met. A downward trend under changing demand is not automatically degradation.

### Scenario B — preventive AHU inspection

1. Create a plan for `AHU-L1-01` with a task-specific checklist, responsible team, duration, lead time and recurrence.
2. Example demo plan: inspection every calendar month at 09:00 Africa/Tripoli. This is demonstration scheduling, not an OEM maintenance interval.
3. The backend creates the work order before its due date and notifies the assigned team in AURA.
4. The assigned technician acknowledges the job, then records start and completion separately.
5. If unacknowledged or overdue, the backend escalates to the configured manager according to the plan/priority policy.
6. If waiting for parts or access, retain the outstanding job and show the reason. Do not silently move its original due date.
7. If inspection discovers a defect, retain the inspection result and create a linked corrective job with its own priority and deadline.
8. Completing the inspection does not imply that a discovered defect has been repaired.

Schedules must be task-specific. Filter checks, belt inspections, calibration and statutory tests can have different sources and intervals. Support calendar intervals first, then operating-hours/cycle triggers. Usage triggers require a real, quality-checked counter and counter-reset/replacement handling.

### Scenario C — employee notices an AC problem

1. Employee selects the AHU, served room or **Equipment unknown**, then selects **Report a problem**.
2. Report captures the symptom, room, observed time, impact, description and optional photos. It must work even when a sensor is missing or faulty.
3. A manager reviews the report, links the correct asset, checks for an existing related incident and sets priority. Keep duplicate reports as evidence linked to one incident/job.
4. Assignment creates a notification; the technician must explicitly acknowledge acceptance. Delivery is not acceptance.
5. Technician records diagnosis, confirmed or undetermined cause, action, parts, work time, test result and any remaining restriction.
6. Mark **Completed — awaiting verification** once the repair is recorded. A manager/verifier confirms restoration before closure.
7. Create a linked follow-up with an owner and due date if needed. Notes alone must not stand in for follow-up tasks.
8. Notify the reporter in AURA of meaningful changes and closure. Allow reopening when the symptom persists.

Example final record: **Symptom:** office too warm; **Finding:** failed room-temperature sensor confirmed by comparison with a reference instrument; **Action:** replaced sensor and checked its binding; **Verification:** response checked against the approved acceptance criteria; **Follow-up:** recheck after the next occupied operating period.

## 4. Shared work-order workflow

Recommended states:

`New → Triaged → Assigned → In progress → Completed → Verified/Closed`

Additional states: **Waiting for parts**, **Waiting for access**, **Cancelled**. Reopening is an audited action that returns a completed/closed job to an actionable state and preserves the previous completion/closure record. Waiting states resume to In progress.

Acknowledgement is a timestamped action on an assignment, not evidence that work started. Overdue is a derived flag, not a replacement state: an in-progress or waiting job can still be overdue.

Required controls:

- Server validates allowed transitions; buttons alone do not enforce rules.
- Cancellation, priority changes, reassignment, deadline changes and reopening require reasons.
- Original deadlines and breach history survive rescheduling.
- Completion requires checklist results and work notes. Corrective work also needs a diagnosis/outcome, action taken and post-work test result. Allow **Undetermined** cause with an investigation/follow-up outcome.
- Closure requires verification or an explicitly configured, audited low-risk self-verification policy.
- A failed verification keeps the issue actionable; it cannot appear as successfully restored.
- Store actual downtime independently of ticket age. Service interruption may start before reporting and end before administrative closure.
- Use server transactions and optimistic version checks to prevent two tabs/technicians overwriting each other.

Priority and maintenance type are different fields. **Emergency** is a priority/response route that can apply to a reported or detected fault. A potential immediate hazard must show the site's emergency response instruction and priority separately from the ordinary maintenance queue.

Suggested priority names: Emergency, High, Normal and Low. Response/attendance/restoration targets must be configurable by asset criticality and site policy; do not embed universal response-hour promises.

## 5. Preventive scheduler and overdue rules

Run scheduling on the backend, independently of any browser tab. Use a controllable clock for tests and a persistent worker heartbeat/status for operators.

Each plan needs:

- Project, asset, task/checklist version and plan revision.
- Interval and explicit scheduling basis: calendar-anchored or completion-based.
- Timezone, anchor date/time, next occurrence and window start/end.
- Lead time, assignment/team, required skills, expected duration and priority.
- Reminder/escalation policy and the source of the task/interval: OEM manual, adopted site requirement, engineering approval or demonstration.
- Approval state, effective date and pause/retirement status.

For calendar-anchored plans, late completion does not silently shift future dates. For completion-based plans, calculate the next due date from actual completion only when that basis was selected explicitly.

Use a unique occurrence key such as `(project_id, plan_id, plan_revision, occurrence_due_at)` to prevent duplicate generation. Scheduler retries, restarts and multiple worker ticks must not duplicate jobs. Do not allow a plan edit to create a second job for an already-linked occurrence; preserve the earlier occurrence and audit the revision.

On restart, reconcile missed occurrences under an explicit policy: preserve a visible missed-occurrence record and generate or escalate the outstanding task without losing evidence. Bound catch-up processing and expose the backlog; avoid generating years of hidden duplicate notifications.

Define separately: scheduled start, due-window end, acknowledgement target, response target and restoration target. Use actual event times. Waiting for access/parts does not automatically pause a compliance deadline. If site policy permits pausing an SLA clock, record pause intervals and show both elapsed and adjusted time.

Store UTC instants and use the plan timezone for calendar recurrence. Calendar months are not fixed 30-day durations. Specify a month-end policy, such as the last valid day when an anchored date does not exist. Handle leap years and timezone changes without duplicate occurrences.

Notifications must persist after reload. Record recipient, event, attempted/delivered time, read time and technician acknowledgement separately. Deduplicate by recipient + event + escalation stage. Version 1 uses AURA's notification center. Email/SMS/phone integrations require their own configured providers, delivery status and retry handling; never display **Technician called** merely because a task was assigned.

## 6. IoT pipeline, sensor trust and predictive growth

Data path:

`Physical sensor → device/gateway → Modbus/MQTT adapter → normalized measurement → quality/context gate → condition/trend rule → maintenance alert → work order → technician outcome`

Preserve the working Modbus integration. Add MQTT only if the actual device architecture requires it. Keep transport adapters separate from maintenance logic so future devices can feed the same validated schema.

Minimum measurement fields:

| Field group | Fields |
| --- | --- |
| Identity | `project_id`, `asset_id`, `point_id`, `device_id`, `source_session`, sample ID/sequence |
| Meaning | Metric, numeric/boolean value, unit, measurement location and monitored parent asset |
| Time | Device sample time where trustworthy, server received time, age |
| Trust | Quality, validity reason, calibration/config version, `live/demo/manual` source |
| Context | Run feedback, demand/test mode, startup/steady-state/standby state where available |

Use separate states for **No sensor installed**, **Unconnected**, **Offline**, **Stale**, **Invalid**, **Quality unverified** and **Valid**. Do not replace missing data with zero. Online equipment is not necessarily healthy. Equal readings are not proof of a stuck sensor; use independent freshness/sequence/diagnostic evidence where available. Treat sensor drift as an investigation outcome supported by comparison or calibration evidence.

Each rule stores applicability, thresholds, persistence window, hysteresis, maximum input age, data-coverage requirement, startup delay, severity, evidence text, rule version and job-creation policy.

Evaluate persistence using elapsed time and valid coverage, not raw message counts. Duplicate/replayed/out-of-order packets must not inflate persistence or generate duplicate work. Define whether a data gap resets or suspends a rule; for the pilot reset pending persistence and label the outcome **Unknown/data unavailable** until valid context returns. A previously opened incident remains in history and actionable according to policy.

An alert stores the triggering values, time range, source mode, relevant operating conditions, rule version and linked work order. Use an incident identity scoped by project + source mode + asset + rule + episode; repeated abnormal samples update the existing episode.

Alert states: **Open**, **Acknowledged**, **Condition cleared**, **Reviewed/resolved**. Acknowledgement does not clear the physical condition. Closing a work order does not force sensor readings healthy. A configured suppression period must be visible, time-limited and audited; suppression of duplicate maintenance messages must not suppress independent fire/alarm/trouble signals.

### Practical signal candidates

| System | Useful evidence | What AURA can initially say |
| --- | --- | --- |
| Domestic booster | Flow, suction/discharge pressure, running feedback, demand/test context | Delivery performance abnormal under the configured operating condition |
| AHU/filter | Filter differential pressure, fan speed/run state, airflow where available | Filter resistance/performance trend warrants inspection under comparable fan operation |
| Cooling zone | Room/supply/return temperature, command vs feedback, occupancy and operating mode | Temperature response differs from the commissioned baseline; investigate |
| Fan/pump motor | Appropriately sampled vibration, temperature, current and speed | Condition differs from baseline; cause unconfirmed |
| Water tank, when actually modeled/commissioned | Level and refill state | Level/refill trend outside the configured operating envelope |
| Sensor/gateway | Heartbeat, sample sequence, diagnostics and calibration records | Monitoring unavailable or sensor fault; asset condition may be unknown |
| Fire system | Approved panel/controller monitoring points and inspection records | Distinct alarm, supervisory/trouble and maintenance records; no autonomous control |

MXCHIP temperature/humidity readings can exercise a genuine environmental-data integration when explicitly bound to a pilot location. They do not measure pipe flow, pressure, filter differential pressure or bearing condition. Additional suitable transducers, interfaces and commissioning are needed for those use cases. Low-rate board accelerometer samples do not automatically provide a valid bearing-diagnostic system.

For fire-water equipment, do not reuse the domestic low-flow rule. Normal standby conditions can involve no flow; rule applicability must distinguish standby, approved test and demand modes. A sprinkler waterflow signal has fire-alarm meaning and must retain that meaning. Maintenance code must not inhibit alarms, reset/silence panels, start/stop fire pumps, or infer operational readiness solely from a dashboard value.

### Growth path

1. **Condition monitoring:** reviewed rules and valid live measurements.
2. **Trend forecasting:** transparent models estimate a configured limit crossing from comparable history. Show the time window, method and uncertainty/limitations; withhold unsupported predictions.
3. **Diagnostic assistance:** rank possible causes using multiple measurements, context, manuals and similar verified repair records. Keep observations, hypotheses and technician-confirmed causes distinct.
4. **Validated predictive models:** evaluate on historical time-separated data with known outcomes; track false alerts, missed events, forecast error and drift before operational reliance.
5. **AI assistant:** summarize evidence and propose checks with source links. The assistant cannot declare an exact cause or close jobs merely from a language-model answer. All consequential decisions stay reviewable and attributable.

Retain sufficient time-series history for the selected analysis. The current bounded temperature-history store is not automatically sufficient for multi-month degradation analysis. Add explicit metric retention/downsampling policies while keeping raw evidence around incidents and preserving live/demo separation.

## 7. 3D integration and user screens

The building remains the spatial entry point. Add a **Maintenance** layer to the existing normal/blueprint viewer where available. Camera, floor isolation, layer visibility and selection must continue working.

Use independent status dimensions:

| Dimension | Examples |
| --- | --- |
| Operating condition | Normal, warning, fault, unknown |
| Maintenance | No outstanding work, due soon, overdue, assigned, in progress, awaiting verification |
| Data quality | Valid, stale, offline, unconnected |
| Design/connection status | Concept, installed, commissioned; bound/unbound |

Show text and icons as well as color. Suggested maintenance badges: calendar for upcoming, clock for overdue, wrench for active work, check for awaiting verification. A scheduled inspection does not recolor a running machine as failed. Keep actual fire-alarm indication distinct and visually prioritized.

Asset inspector tabs: **Overview**, **Measurements**, **Maintenance**, **History**, **Documents**. Show IDs and room/floor, parent/served assets, data source/age, open jobs, next service, notes and locate actions. Display **Health unknown** for unconnected equipment.

Maintenance screens:

- Overview: open jobs, unacknowledged assignments, overdue occurrences, condition alerts and jobs awaiting verification.
- Calendar: month/week/agenda, date windows, assignee, priority, status and asset filters. Distinguish planned future occurrences from generated work orders.
- Work orders: list/board with filtering and a complete job detail panel.
- Report problem: simple employee form with room-based reporting when equipment is unknown.
- My tasks: technician assignment acknowledgement, checklist, findings, time, parts, notes, evidence and completion.
- Asset history: chronological reports, sensor evidence, inspections, repairs, failures, verification and follow-ups.

**Locate in 3D** should reveal the correct floor/layer and focus the existing asset. Every maintainable mesh/instance must map to the canonical `(project_id, asset_id)`. Do not use array indexes or mesh UUIDs as persistent identities. Restore materials after selection/overlay changes and avoid changing shared instanced materials globally. Dispose added geometries/materials when changing project or disabling overlays.

## 8. Proposed persistence model

These are logical entities; combine small tables when reasonable without losing the invariants.

| Entity | Essential content |
| --- | --- |
| Asset registry | Composite project/asset key, name, system, room/floor, parent, criticality, model reference, design/commissioning state |
| People/teams | Identity, role, skills, contact preferences and active status |
| Maintenance plans | Asset/task, recurrence, timezone, checklist version, source, approval, assignment and escalation policy |
| Plan occurrences | Stable occurrence ID, plan revision, due window, generation/result state and linked job |
| Problem reports | Reporter, location, symptom, observed time, evidence, triage and linked incident/job |
| Work orders | Origin, action type, asset, priority, state, deadlines, assignee, version and lifecycle timestamps |
| Work records | Checklist results, observations, diagnosis/cause status, repair actions, parts/labor and test result |
| Follow-ups | Linked parent job, task, owner, due date and outcome |
| Monitoring points/bindings | Device/protocol source, metric/unit, monitored asset, calibration and configuration |
| Measurements/aggregates | Quality-tagged time series, source mode and retention policy |
| Maintenance alerts | Rule/version, incident/episode, evidence, acknowledgement/clearance and linked job |
| Notifications | Recipient/event, channel, attempts, delivery/read/ack state and dedupe key |
| Audit events | Actor, time, entity/action, before/after or change fields, reason and correlation ID |

Use SQLite foreign keys, indexes, migrations and transactional writes. Check the current threaded connection/locking pattern before extending it. Scheduler-generated jobs, notifications and their outbox events should commit atomically. Keep durable maintenance history separate from telemetry retention cleanup.

Evidence attachments should be protected application resources with size/type checks and safe generated names, not arbitrary filesystem paths. Never render employee text as raw HTML. Scope all reads and writes by project and validate every referenced asset/person on the server.

Phase 1 may remain a single-operator local tool. A user-selector can demonstrate employee/technician/manager workflows only if labeled **Demo role**. It is not authentication. Real multi-user deployment requires authenticated identities, server-enforced role permissions, secure sessions, authorization for evidence access and transport protection. Do not expose the existing development HTTP server as a production multi-user service.

## 9. Suggested API shape

Use the existing HTTP server and app conventions. Paths below are a proposed contract, not existing endpoints.

| Method and route | Purpose |
| --- | --- |
| `GET /api/maintenance/assets?project_id=...` | Registered maintainable assets and summary badges |
| `GET /api/maintenance/assets/{id}?project_id=...` | Asset detail, open jobs and timeline |
| `POST /api/maintenance/reports` | Submit a corrective problem report |
| `POST /api/maintenance/reports/{id}/triage` | Link/merge, prioritize and convert a report into a job |
| `GET/POST /api/maintenance/work-orders` | List/filter or create work orders |
| `POST /api/maintenance/work-orders/{id}/actions` | Assign, acknowledge, start, wait, complete, verify, cancel or reopen with expected version |
| `GET/POST /api/maintenance/plans` | Read/create preventive plans |
| `POST /api/maintenance/plans/{id}/revise` | Versioned plan change with reason |
| `GET /api/maintenance/calendar?project_id=...&from=...&to=...` | Bounded calendar occurrences and jobs |
| `GET /api/maintenance/alerts?project_id=...` | Condition/trend alerts and evidence |
| `GET /api/maintenance/notifications` | Current user's/local operator's notification feed |

Reject invalid transitions, unknown/cross-project IDs, oversized bodies, invalid timestamps and non-finite measurements. Handle repeated submissions with idempotency keys. Return version conflicts explicitly rather than applying last-write-wins updates. Browser reconnects refresh maintenance state from the database; do not assume the current telemetry SSE replay stores maintenance changes. Add a deliberate durable-event design or a separate maintenance event stream with refresh/resync behavior. Periodic bounded refresh is acceptable in the first slice.

## 10. Delivery order and definition of done

### Phase 1 — asset register and corrective work orders

Build inside the existing app: asset-linked maintenance tab, room/asset problem reporting, triage, assignment and acknowledgement, workflow, completion/verification, notes, linked follow-ups, in-app notifications, persistent history and locate-in-3D.

Pilot `AHU-L1-01`. Register existing equipment from a canonical catalog that frontend and backend can validate consistently; do not scrape labels from rendered HTML or duplicate divergent hardcoded asset lists. Keep missing asset references visible as mapping errors.

Acceptance:

- Submit an AHU complaint, assign it, acknowledge, start, record an undetermined or confirmed finding, complete, verify and reopen.
- A complaint about an unknown asset can be reported against a room and mapped during triage.
- A follow-up has an owner/deadline and remains visible until resolved.
- Jobs and notes survive browser refresh and server restart.
- Invalid transitions and cross-project references fail on the server.
- Duplicate submit creates one report/job; concurrent stale updates produce a conflict.
- Work history is project-scoped and source-labeled; no live readings are fabricated.
- Selecting a job locates the correct 3D asset; normal/blueprint views and floor/layer controls are preserved.
- Existing meeting-room telemetry, alarms, history/export and project navigation still work.

### Phase 2 — preventive plans and calendar

Add plan CRUD/revision, backend occurrence generation, calendar, persistent reminders, acknowledgement escalation, overdue tracking and restart reconciliation.

Acceptance:

- Due-soon, due-now and overdue appear at the correct instants with a fake clock.
- Repeated ticks and restart generate no duplicate job/notification.
- Jobs still become due/overdue with all browser tabs closed while the backend runs.
- A stopped backend reports missed occurrences after restart; it cannot send messages while powered off.
- Monthly date anchors, month-end/leap-year policy and timezone boundaries are tested.
- Late completion follows the selected schedule basis; original lateness remains auditable.
- Waiting for parts does not silently reset deadlines.
- Plan revision does not duplicate an existing occurrence or erase checklist history.

### Phase 3 — IoT condition monitoring and first trend forecast

Add explicit bindings, measurement normalization/quality gating, configurable rules, incident deduplication and inspection-job generation. Start with the domestic booster scenario using a real meter when available. Add an opt-in deterministic demo fixture to test missing-hardware cases.

Acceptance:

- Low flow during confirmed expected-demand operation triggers after the configured valid duration.
- Normal standby/startup, unknown demand or stale/invalid data does not create a confident low-performance diagnosis.
- A single sustained incident creates one alert/job; recovery and later recurrence are distinct, linked episodes.
- Out-of-order/repeated samples and restarts do not duplicate incidents.
- Data loss creates an availability indication without claiming healthy operation or erasing an open fault.
- Trend forecasts require enough comparable data; otherwise show insufficient evidence.
- Every displayed reading and event identifies Live, Demo or Manual source. A demo fixture never writes into the live measurement stream.
- No MXCHIP temperature value is relabeled as pipe flow or assigned to another location without an explicit binding.
- The domestic-water rule cannot be applied by default to fire-water assets.

### Phase 4 — operational maturity and AI assistance

Add authenticated multi-user workflows before shared deployment, task/interval governance, documents/attachments, basic parts/labor costs, contractor access, downtime/reliability reporting and validated AI support. Build operating-hours plans once counters exist.

Initial metrics: overdue occurrences, on-time completion, acknowledgement/response time, actual downtime, repeat confirmed faults, work-order age and false-alert outcomes. Define denominators, exclusions and time ranges. Show MTBF/RUL as unavailable until the required failure/runtime/outcome evidence exists; ticket counts are not failure counts.

Do not promise that logging a fault prevents recurrence. Use repeated confirmed failures to recommend an engineering review, a plan revision or a component change; record that improvement as a separately owned action.

## 11. First prompt to give Codex in the local editor

Copy this prompt and attach this specification:

```text
Implement Phase 1 of the attached AURA maintenance specification in my current AURA repository.

Work in the existing application. Read AGENTS.md and inspect the current working tree first; it may be newer than public main. Identify the existing project routing, canonical asset IDs, building selection hooks, inspector, blueprint mode if present, telemetry quality handling, SQLite schema and tests. Preserve unrelated local edits.

Implement a complete vertical slice for AHU-L1-01: report an asset/room problem, manager triage, work-order assignment, technician acknowledgement, start/wait/complete, verification/closure, audited reopening, structured findings/repair/test notes, linked follow-ups, persistent in-app notifications and asset history. Include Equipment unknown reporting. Add Maintenance access in the existing UI and Locate in 3D using current floors/layers/asset IDs.

Use the existing Python + SQLite + plain JavaScript/Three.js architecture unless the current tree already changed it. Put maintenance persistence/business rules and UI into focused modules. Add versioned non-destructive migrations, server-side transition validation, project scoping, idempotent submissions and optimistic version checks. Register new JS files in the server's static allowlist if it still uses one. Keep the current telemetry history intact.

This phase is local/single-operator. Demo role switching must say Demo role and must not be presented as real authentication. Use in-app notifications; do not send email/SMS or make calls. Keep concept/unconnected/live/demo/manual states honest. Do not add physical control commands or move the MXCHIP's meeting-room data into the building.

Implement Phase 1 now; do not stop after a plan. Defer calendar generation, IoT maintenance rules and AI to the later phases in the specification. Add only the fields/interfaces needed to support that progression without building speculative infrastructure.

Verify the critical lifecycle, database persistence/restart, duplicate submission, stale-version conflict, invalid transition, project isolation and 3D locate behavior. Run the repository's applicable Python/Node/browser checks and formatting checks; report any check you could not run. Reuse the current tooling and keep the diff focused.

Finish by listing changed files, exact run/test commands and results, and the steps for me to exercise the full AHU complaint-to-verified-repair workflow in my existing app. Do not commit, push or publish unless I request it.
```

After Phase 1 passes, give Codex this follow-on instruction for Phase 2:

```text
Implement Phase 2 of AURA_Maintenance_Implementation.md on top of the existing tested maintenance workflow. Deliver the preventive-plan editor and calendar plus backend scheduling, durable occurrence generation, persistent in-app reminders/escalations, derived overdue flags and restart reconciliation. Follow the calendar anchoring, timezone, plan revision and deduplication rules in the specification. Use a controllable clock for meaningful tests. Label sample schedules as demonstration values. Preserve the corrective workflow and the 3D viewer. Implement and verify this phase, then report results; leave IoT rules and AI for later phases.
```

For Phase 3:

```text
Implement Phase 3 of AURA_Maintenance_Implementation.md. First identify actual available devices and approved register/point definitions; do not invent measurements or Modbus registers. Add explicit project/asset/point bindings, quality/context gating, reviewed configurable condition rules, deduplicated alerts, evidence and linked inspection work orders. Implement the domestic-booster low-flow scenario with explicit running/demand context, persistence and recovery logic. If physical inputs are unavailable, provide an opt-in, visibly labeled deterministic demo fixture and keep live operation unavailable. Add a transparent trend-forecast interface that withholds output without adequate comparable history. Test standby, startup, stale/offline data, gaps, replay, recovery, recurrence and restart behavior. No fire-system controls, AI diagnosis or invented live data.
```

## 12. Source notes

The data model, UI, statuses, delivery phases and numeric demo configuration above are proposed AURA design choices, not requirements quoted from a standard.

- Current repository and integration points: https://github.com/danaweer/aura ; server: https://github.com/danaweer/aura/blob/main/server.py ; asset definitions: https://github.com/danaweer/aura/blob/main/projects/atrium-building/equipment-plan.js ; current building manifest: https://github.com/danaweer/aura/blob/main/projects/atrium-building/project.json .
- IBM, Condition-based maintenance: https://www.ibm.com/think/topics/condition-based-maintenance — measured condition, baseline selection and distinction from forecasting future behavior.
- IBM, Predictive maintenance: https://www.ibm.com/think/topics/predictive-maintenance — operating data, condition monitoring, maintenance history and forecasting.
- NFPA, Fire Alarm Notification Delay from Sprinkler Waterflow: https://www.nfpa.org/news-blogs-and-articles/blogs/2022/06/03/Fire-Alarm-Notification-Delay-from-Sprinkler-Waterflow — sprinkler waterflow has a fire-alarm role. This source is explanatory, not an approval of AURA or its maintenance settings.

For real fire equipment, select inspection/test tasks and intervals from the applicable adopted requirements, the specific equipment documentation and the responsible site review. This specification deliberately does not prescribe universal fire inspection intervals or operating thresholds.

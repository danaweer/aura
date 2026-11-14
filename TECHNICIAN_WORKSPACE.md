# AURA Task 5A — technician workspace

Open **Maintenance → My Tasks** as a technician. This is the technician's default maintenance tab; it lists only orders assigned to that account in projects it can currently access. Use **Refresh tasks** to retrieve new assignments. There is no background notification delivery or scheduling in this task.

Each task links the canonical asset ID, equipment name, registered floor/room, priority, assignment date, due date if set, current status, saved work record and attributed UTC action history. Times are displayed in the browser's local timezone. Missing historical assignment dates display **Not recorded**; existing dates are not fabricated. Asset connection/design status stays explicit and does not imply live telemetry.

## Exact manual test

Prerequisite: have one **Manager** account and one **Technician** account, both with **Atrium building / 01** project access and completed password setup. An administrator can provision these through the existing Users & Access page. Use separate browser profiles/private windows for the two accounts.

1. Sign in as the manager. Open **Maintenance → Reports**. Submit a report with equipment **AHU-L1-01**, room **L1-M01**, symptom **Test — fan inspection**, an observed time, impact and description. This creates a test report, not a device reading.
2. Select the submitted report. In manager triage choose priority **High**, map to **AHU-L1-01**, enter a review reason, and choose **Create corrective work order**. Click **Save manager triage**; the job is now **Triaged**.
3. Open **Work Orders** and select that job. In **Assign technician**, select the technician, optionally enter a due date, enter an assignment reason, and click **Assign work order**. The status becomes **Assigned**.
4. Sign in as the technician in the other profile. Open **Maintenance**. **My Tasks** opens by default. Click **Refresh tasks** if already on the page, then select **Test — fan inspection**. Confirm asset, room, priority, assignment and due date.
5. Click **Acknowledge assignment**, then **Start work**. Acknowledgement has its own timestamp and does not itself start work.
6. Enter a work note such as **Test — waiting for a replacement filter** and click **Waiting for parts**. Enter **Test — replacement available**, then click **Resume work**. Repeat with **Waiting for access** and a reason, then **Resume work** after entering an access note.
7. Fill **Findings**. Choose **Diagnosed** and describe the diagnosis, or explicitly choose **Undetermined** and explain the investigation outcome/recommended next investigation. Fill repair action, materials (enter **None** if none), actual work duration in whole minutes, post-work checks and their observed results. Select **Passed** only for satisfactory checks; **Not restored** can be saved as a work record but blocks completion. Enter a work note and click **Save work record**. Reload and confirm the values persist.
8. Click **Locate in 3D**. The existing viewer opens the Atrium building, selects **AHU-L1-01** and focuses its actual floor/equipment. Click **Maintenance** to return to My Tasks.
9. Enter a completion work note, then click **Submit completed — awaiting verification**. The job displays **Completed — awaiting verification**, retains its saved record, and exposes no further technician edit, close or verify action. The database state is the existing `Completed`; `closed_at` remains NULL.
10. In the manager profile, open **Work Orders**, refresh, and select the job. Confirm completion, saved work and timestamped technician actions. Verification/closure is intentionally outside Task 5A.

Employees retain their reporting and permitted-report access; managers retain triage and linking. Employees and viewers have no task execution permissions. Technicians cannot assign work, act on someone else's order, access an unauthorized project, or verify/close repairs.

## Workflow and persistence

- `Assigned → acknowledge → start → In progress`. Acknowledgement is mandatory before start.
- `In progress → Waiting for parts / Waiting for access → resume → In progress`. Waiting and resume require notes.
- Save structured findings, **Diagnosed/Undetermined** cause, diagnosis/investigation outcome, repair action, materials, actual work minutes, post-work checks and result while in progress or waiting.
- Completion only from In progress; requires work notes, findings, explicit cause outcome, diagnosis/investigation outcome, repair action, materials, positive work duration, post-work check text and a **Passed** result. Failed checks leave work actionable.
- Assign/reassign only Triaged or Assigned work. The target must be an active technician with project access. Reasons are required. Reassignment clears acknowledgement; starting prevents reassignment in this stage. The original due date survives deadline changes.
- Every write revalidates account role, project grant, session, assignee and expected version inside a transaction. Stale updates return 409. Work notes and before/after audit snapshots commit together with the state/version change. On rejected actions, the form keeps unsaved notes until an explicit reload.
- Maintenance migration **v3** appends structured record columns and an assignee index. Existing work orders, notes, reports, audit history, asset IDs, authentication and telemetry tables are preserved. There are no dependencies or new frameworks.
- Undetermined causes record an investigation outcome; they do not automatically create or schedule follow-up work. Managers must review any remaining investigation needs. No notification, verification, closure, preventive, predictive or IoT workflow is implemented here.

## Focused validation

```sh
.venv/bin/python -m unittest tests.test_technician tests.test_auth tests.test_user_management tests.test_maintenance tests.test_maintenance_reports tests.test_backend.HttpTests tests.test_backend.HistoryTests tests.test_backend.HubTests tests.test_backend.ConfigurationTests
node --test tests/navigation.test.js tests/projects.test.js
node tests/technician-browser.js
node tests/auth-browser.js
```

Browser tests create only temporary accounts/database records and clean them up. The task screenshot is `test-results/technician-workspace.png`.

Files changed: `maintenance.py`, `maintenance_workflow.py`, `maintenance_tasks_api.py`, `server.py`, `maintenance-ui.js`, `maintenance-tasks-ui.js`, `app.js`, `index.html`, `style.css`, `tests/test_technician.py`, `tests/technician-browser.js`, `tests/test_maintenance.py`, `tests/test_maintenance_reports.py`, and `TECHNICIAN_WORKSPACE.md`.

Validation results: 55 focused Python tests and 5 JavaScript navigation/model tests passed, along with the technician browser workflow, existing authentication/employee-reporting/manager-triage/3D-blueprint browser regression, syntax, formatting and diff checks. The live v2-to-v3 migration preserved all original fields in existing account, grant, work-order, note, audit and report records. No real test accounts, reports or assignments were created by the tests.

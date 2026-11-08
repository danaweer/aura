# AURA authentication foundation

## First administrator

Run these commands from the project directory using the same database as the server:

```sh
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python auth_setup.py status
.venv/bin/python auth_setup.py bootstrap-admin
```

Enter a username, display name, and a unique password of 15–128 characters at the terminal prompts. Password entry is hidden; there is no default password, public signup, or browser bootstrap endpoint. Bootstrap closes atomically once any account exists and cannot replace accounts. Use `--db /path/to/aura.sqlite3` with both setup commands if the server uses a custom `--history-db`.

Open the existing AURA address (normally http://127.0.0.1:8090). The login screen appears before application initialization. The header shows the signed-in identity and Logout. Logging out invalidates that session on the server. Expiry returns to login, preserving the destination URL. Other sessions for the account remain valid until logout or expiry; disabling the account invalidates all sessions on their next request.

## Users & Access (Task 4B)

Sign in as an administrator and select **Users & Access** in the sidebar (or open `/#users-access`). This is a functional account directory; employees, technicians, managers and viewers cannot use its APIs or see its navigation item.

1. In **Create user**, enter the person's display name and unique username.
2. Choose **Technician**, **Employee**, or one of the other three supported roles.
3. Check the existing projects they may access and click **Create user**. No selected projects means no project-data access. Administrators can still use the global account directory without project grants.
4. A random temporary password is returned once, initially masked. Use **Show** if needed and share it privately through a trusted channel. It expires after **24 hours**. Click **Done — clear password** after sharing. The UI also clears it when leaving the page, hiding the tab or unloading; it is not saved in local/session storage. If lost, generate a replacement with **Reset password**.
5. The user signs in with that password, sees only **Set your password**, and must choose a different password of 15–128 characters. They must then sign in again using their own password. Until setup is complete, application APIs are denied on the server, including admin and telemetry APIs. Password-setup sessions last at most 15 minutes and cannot outlast the temporary password.

Use **Manage** beside an account to edit its role, granted projects, and Active/Disabled status. **Save changes** invalidates all of that user's sessions when any permission/status actually changes. Disabling blocks further login; re-enabling retains the password and grants you select. Accounts are never deleted and maintenance ownership/history remains intact. Concurrent stale edits return a conflict requiring **Refresh users** rather than overwriting another administrator's change.

**Reset password** invalidates all target sessions, replaces the prior password with a new 24-hour temporary password, and requires setup again. It does not re-enable a disabled account. Administrative self-reset is intentionally rejected: ask another administrator. The existing authenticated change-password API requires the current password; general account-settings UI is outside this task.

The final active administrator who has completed password setup cannot be disabled or demoted, even if there are other uninitialized administrator accounts. The guard is transactional. Create another administrator and complete their setup before retiring the first account.

Account creation, role/grant changes, enable/disable, temporary setup, resets and password changes are recorded with stable actor/target UUIDs in `auth_audit_events`. Passwords, hashes and session secrets are excluded from directory/API audit output. Hashes remain only in the existing protected user records; only the one-time temporary password is returned in a successful create/reset response.

Migration **auth v2** adds account version, password-change requirement and temporary-password expiry fields without changing existing passwords, grants, sessions or maintenance data. Existing accounts are not forced into setup. Public signup is still absent; `AuthStore.create_user` remains a trusted internal utility, while the administrator HTTP API always uses forced setup.

## Enforced permissions

Application APIs require an active account with completed password setup. Session, login, logout and password-setup endpoints handle their respective authenticated/pre-authenticated states. The project catalog contains only granted projects. Meeting-room telemetry, history, CSV and SSE require a meeting-room grant. The existing demo alarm operation additionally requires administrator or manager permission and still works only when the server is started in demo mode.

| Role | Granted-project maintenance access |
| --- | --- |
| Administrator | Read, report, triage, prioritize and link; internal authorized account operations |
| Manager | Read, report, triage, prioritize and link |
| Employee | Submit reports; read own reports and their linked work orders |
| Technician | Read reports/work orders assigned to their account ID; assignment UI/workflow is not implemented |
| Viewer | Read-only project reports and work orders |

Report ownership is a stable server-assigned user UUID. Display names cannot establish ownership. New report/event and triage/work-order audit actors come from the authenticated session. Caller-supplied reporter, owner or role fields are rejected; the former demo-role header has no authority. Submission retry keys are scoped to the account.

Legacy reports, their names, original events, work orders, telemetry and alarms are preserved. Existing reports receive a nullable `owner_user_id` and retain **NULL ownership**. Even a new account with the same name cannot claim them. Authorized project managers, administrators and read-only viewers can still review these records; legacy identity attribution remains unchanged. The auth migration ledger is separate from the existing maintenance migration ledger and rejects unknown versions rather than downgrading them.

## Session and deployment settings

- Passwords use the established `argon2-cffi` Argon2id password hasher with its recommended defaults and rehash checking. SQLite stores only password hashes and SHA-256 hashes of random session secrets. CSRF tokens are stored server-side and held in browser memory.
- Authenticated sessions default to an absolute eight hours and 30 minutes without authenticated HTTP activity. Background current-user checks and SSE do not extend idle time. Configure `--session-hours` and `--session-idle-minutes` if needed. Login pre-sessions expire after ten minutes. Login rotates/invalidate the previous token; logout deletes it.
- Cookies are HttpOnly, SameSite=Strict and scoped to `/`, without a Domain attribute. State-changing operations, including login and logout, require an exact allowed Origin and a session-bound `X-CSRF-Token`. Login has persisted username/IP throttling and a limit on concurrent expensive hash operations.
- Local HTTP is supported only on the loopback server. For HTTPS deployments terminate TLS at a properly configured reverse proxy and run the existing server with `--public-origin https://your-host.example --secure-cookies`. HTTPS origins automatically enable Secure cookies and the `__Host-` cookie prefix. Preserve the external Host header and browser Origin at the proxy; forwarded headers are not trusted. Keep the Python server private on loopback. Configure certificate handling, HSTS, trusted proxy limits and operational hardening at the HTTPS edge before exposing the service.
- The application database is permissioned `0600` on this local filesystem. Protect its directory, backups, machine account and any journals as well. SQLite contents/backups are not encrypted by this change.

This remains the existing local Python HTTP server, not a production identity provider. MFA, administrator step-up reauthentication, self-service password recovery/account-settings UI, email invitations/delivery, organization tenancy, session-management UI and distributed throttling are not implemented. Administrators must verify the recipient and deliver temporary passwords through a trusted channel; the application does not send them. Behind a reverse proxy, IP throttling sees the proxy address; configure additional edge rate limiting. Static viewer source, geometry and reference PDFs are shipped application assets, not private document storage; project grants protect API records and telemetry. Do not place confidential project documents in the static allowlist.

## Focused checks

```sh
.venv/bin/python -m unittest tests.test_user_management tests.test_auth tests.test_maintenance tests.test_maintenance_reports tests.test_backend.HttpTests tests.test_backend.HistoryTests tests.test_backend.HubTests tests.test_backend.ConfigurationTests
node --test tests/navigation.test.js tests/projects.test.js
node tests/auth-browser.js
node tests/users-browser.js
```

The browser check provisions random temporary test credentials in a separate temporary database and cleans it up. It does not create accounts in the real application database. Screenshots are written to `test-results/auth-login.png`, `test-results/auth-maintenance.png` and `test-results/users-access.png`. No real users are provisioned or reset by these tests.

Security references: [argon2-cffi PasswordHasher](https://argon2-cffi.readthedocs.io/en/stable/api.html), [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

Password setup/reset reference: [OWASP password reset guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

## Task 4B files

- Persistence and authorization: `auth.py`, `auth_http.py`, `user_management_api.py`, `server.py`.
- Interface and navigation: `users-ui.js`, `auth-ui.js`, `app.js`, `project-ui.js`, `index.html`, `style.css`.
- Checks: `tests/test_user_management.py`, `tests/test_auth.py`, `tests/users-browser.js`, `tests/navigation.test.js`, `tests/navigation-browser.js`.
- Setup and security documentation: `AUTHENTICATION.md`.

Task 4B validation: 48 focused Python tests and 5 JavaScript navigation/model tests passed. Both the Users & Access browser workflow and the existing authentication/maintenance/3D-blueprint browser regression passed. Syntax, formatting and diff checks passed. The live v1-to-v2 migration preserved the existing account/password/role/project fields and maintenance records; it created no real user accounts and imposed no password change on the existing administrator. Full builds and unrelated test suites were not run.

/* Temporary-database browser coverage for the administrator account workflow. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const python = path.join(root, ".venv/bin/python");
const temporary = await mkdtemp(path.join(os.tmpdir(), "aura-users-browser-"));
const db = path.join(temporary, "aura.sqlite3");
const password = randomBytes(24).toString("base64url");
const privatePassword = randomBytes(28).toString("base64url");
execFileSync(
  python,
  [
    "-c",
    `
import json,sys
from history import HistoryStore
s=HistoryStore(sys.argv[1]); password=json.load(sys.stdin)['password']
s.auth.bootstrap_admin('browser-admin','Browser administrator',password)
s.close()
`,
    db,
  ],
  { cwd: root, input: JSON.stringify({ password }) },
);
const probe = net.createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const url = `http://127.0.0.1:${port}`;
let server,
  browser,
  log = "";
try {
  server = spawn(
    python,
    [
      "-u",
      "server.py",
      "--demo",
      "--web-port",
      String(port),
      "--history-db",
      db,
    ],
    { cwd: root },
  );
  server.stdout.on("data", (chunk) => {
    log += chunk;
  });
  server.stderr.on("data", (chunk) => {
    log += chunk;
  });
  let ready = false;
  for (let n = 0; n < 60; n++) {
    if (server.exitCode !== null)
      throw new Error(`Temporary server stopped: ${log}`);
    try {
      if ((await fetch(`${url}/api/auth/session`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(100);
  }
  assert.ok(ready);
  browser = await chromium.launch({
    headless: true,
    channel: process.platform === "darwin" ? "chrome" : undefined,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  async function login(p, username, secret) {
    await p.locator('#loginForm [name="username"]').fill(username);
    await p.locator('#loginForm [name="password"]').fill(secret);
    await p.locator('#loginForm button[type="submit"]').click();
  }
  await page.goto(`${url}/#users-access`);
  await login(page, "browser-admin", password);
  await expect(page.locator("#usersPage")).toBeVisible();
  await expect(page.locator("#usersMessage")).toHaveText("1 account loaded.");
  const form = page.locator("#usersForm");
  async function create(username, role) {
    await form.locator('[name="name"]').fill(`Test ${role}`);
    await form.locator('[name="username"]').fill(username);
    await form.locator('[name="role"]').selectOption(role);
    await form.locator('input[value="atrium-building"]').check();
    await page.locator("#usersSave").click();
    await expect(page.locator("#usersMessage")).toContainText(
      "Account created.",
    );
    await expect(page.locator("#usersCredential")).toBeVisible();
    const secret = await page.locator("#usersTemporaryPassword").inputValue();
    assert.equal(secret.length, 32);
    await page.locator("#usersDismissPassword").click();
    await expect(page.locator("#usersTemporaryPassword")).toHaveValue("");
    return secret;
  }
  await create("ui-technician", "technician");
  await page.locator("#usersNew").click();
  const temporaryPassword = await create("ui-employee", "employee");
  const employeeContext = await browser.newContext();
  const employee = await employeeContext.newPage();
  employee.on("pageerror", (error) => errors.push(error.message));
  await employee.goto(`${url}/#maintenance?project_id=atrium-building`);
  await login(employee, "ui-employee", temporaryPassword);
  await expect(employee.locator("#passwordSetupScreen")).toBeVisible();
  await expect(employee.locator("#applicationShell")).toBeHidden();
  assert.equal(
    (await employee.request.get(`${url}/api/projects`)).status(),
    403,
  );
  const setup = employee.locator("#passwordSetupForm");
  await setup.locator('[name="current_password"]').fill(temporaryPassword);
  await setup.locator('[name="new_password"]').fill(privatePassword);
  await setup
    .locator('[name="confirmation"]')
    .fill(privatePassword + "different");
  await setup.locator('button[type="submit"]').click();
  await expect(employee.locator("#passwordSetupMessage")).toContainText(
    "do not match",
  );
  await setup.locator('[name="confirmation"]').fill(privatePassword);
  await setup.locator('button[type="submit"]').click();
  await expect(employee.locator("#loginScreen")).toBeVisible();
  await expect(employee.locator("#loginMessage")).toContainText(
    "Password updated.",
  );
  await login(employee, "ui-employee", privatePassword);
  await expect(employee.locator("#maintenancePage")).toBeVisible();
  await expect(employee.locator("#navUsers")).toBeHidden();
  assert.equal(
    (await employee.request.get(`${url}/api/admin/users`)).status(),
    403,
  );
  await page.locator("#usersRefresh").click();
  await expect(page.locator("#usersMessage")).toHaveText("3 accounts loaded.");
  await page
    .getByRole("button", { name: "Manage ui-employee", exact: true })
    .click();
  // Revoke all projects and ensure the prior session has been invalidated.
  await form.locator('input[value="atrium-building"]').uncheck();
  await page.locator("#usersSave").click();
  await expect(page.locator("#usersMessage")).toContainText("Account updated.");
  assert.equal(
    (await employee.request.get(`${url}/api/auth/me`)).status(),
    401,
  );
  const row = page
    .locator("#usersTableBody tr")
    .filter({ hasText: "ui-employee" });
  await expect(row).toContainText("No project access");
  await form.locator('[name="status"]').selectOption("disabled");
  await page.locator("#usersSave").click();
  await expect(row).toContainText("Disabled");
  await form.locator('[name="status"]').selectOption("active");
  await form.locator('input[value="atrium-building"]').check();
  await page.locator("#usersSave").click();
  await expect(row).toContainText("Active");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#usersResetPassword").click();
  await expect(page.locator("#usersMessage")).toContainText("Password reset.");
  const reset = await page.locator("#usersTemporaryPassword").inputValue();
  assert.notEqual(reset, temporaryPassword);
  await page.locator("#navDashboard").click();
  await expect(page.locator("#usersTemporaryPassword")).toHaveValue("");
  await page.locator("#navUsers").click();
  await expect(page.locator("#usersCredential")).toBeHidden();
  await expect(page.locator("#usersMessage")).toHaveText("3 accounts loaded.");
  await page
    .getByRole("button", { name: "Manage browser-admin", exact: true })
    .click();
  await form.locator('[name="status"]').selectOption("disabled");
  await page.locator("#usersSave").click();
  await expect(page.locator("#usersMessage")).toContainText(
    "final active administrator",
  );
  // A global administrator must retain the directory after revoking their own project grants.
  await page.locator("#usersRefresh").click();
  await expect(page.locator("#usersMessage")).toHaveText("3 accounts loaded.");
  await form.locator('input[value="atrium-building"]').uncheck();
  await form.locator('input[value="meeting-room"]').uncheck();
  await page.locator("#usersSave").click();
  await expect(page.locator("#loginScreen")).toBeVisible();
  await login(page, "browser-admin", password);
  await expect(page.locator("#usersPage")).toBeVisible();
  await expect(page.locator("#usersMessage")).toHaveText("3 accounts loaded.");
  assert.deepEqual(
    (await (await page.request.get(`${url}/api/projects`)).json()).projects,
    [],
  );
  await expect(page.locator("#usersFormTitle")).toHaveText("Create user");
  await mkdir(path.join(root, "test-results"), { recursive: true });
  await page.screenshot({
    path: path.join(root, "test-results/users-access.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Responsive directory with independent table scrolling",
  );
  await page.locator("#usersRefresh").click();
  await expect(page.locator("#usersMessage")).toHaveText("3 accounts loaded.");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: administrator directory, technician/employee creation, forced password setup, project revocation, disable/re-enable, reset, credential clearing, final-admin protection and mobile layout.",
  );
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    const stopped = once(server, "exit");
    server.kill("SIGINT");
    const timer = setTimeout(() => server.kill("SIGKILL"), 5000);
    await stopped;
    clearTimeout(timer);
  }
  await rm(temporary, { recursive: true, force: true });
}

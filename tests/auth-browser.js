/* Focused real-session browser check; credentials and SQLite are temporary. */
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
const temporary = await mkdtemp(path.join(os.tmpdir(), "aura-auth-browser-"));
const db = path.join(temporary, "aura.sqlite3");
const password = randomBytes(24).toString("base64url");
execFileSync(
  python,
  [
    "-c",
    `
import json,sys
from history import HistoryStore
s=HistoryStore(sys.argv[1]); password=json.load(sys.stdin)['password']
admin=s.auth.bootstrap_admin('browser-admin','Browser administrator',password)
for role in ('employee','manager','viewer'):
    s.auth.create_user(admin['user_id'],'browser-'+role,'Browser '+role,password,role,['atrium-building'])
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
let browser, server;
let log = "";
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
      throw new Error(`Test server stopped: ${log}`);
    try {
      if ((await fetch(`${url}/api/auth/session`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(100);
  }
  assert.ok(ready, "Temporary server ready");
  browser = await chromium.launch({
    headless: true,
    channel: process.platform === "darwin" ? "chrome" : undefined,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${url}/#maintenance?project_id=atrium-building`);
  await expect(page.locator("#loginScreen")).toBeVisible();
  await mkdir(path.join(root, "test-results"), { recursive: true });
  await page.screenshot({
    path: path.join(root, "test-results/auth-login.png"),
  });
  async function login(role) {
    await page.locator('#loginForm [name="username"]').fill(`browser-${role}`);
    await page.locator('#loginForm [name="password"]').fill(password);
    await page.locator('#loginForm button[type="submit"]').click();
    await expect(page.locator("#accountRole")).toHaveText(
      role === "admin"
        ? "Administrator"
        : role[0].toUpperCase() + role.slice(1),
    );
    await expect(
      page.locator('#problemReportForm [name="room_id"] option'),
    ).toHaveCount(71);
  }
  async function logout() {
    await page.locator("#logoutButton").click();
    await expect(page.locator("#loginScreen")).toBeVisible();
    assert.equal((await page.request.get(`${url}/api/auth/me`)).status(), 401);
  }
  await page.locator('#loginForm [name="username"]').fill("browser-employee");
  await page.locator('#loginForm [name="password"]').fill("incorrect-password");
  await page.locator('#loginForm button[type="submit"]').click();
  await expect(page.locator("#loginMessage")).toContainText(
    "Invalid username or password",
  );
  await login("employee");
  await expect(page.locator("#navUsers")).toBeHidden();
  assert.equal(await page.locator("#maintenanceRole").count(), 0);
  const form = page.locator("#problemReportForm");
  await expect(form.locator('[name="reporter"]')).toHaveValue(
    "Browser employee",
  );
  assert.equal(
    await form.locator('[name="reporter"]').getAttribute("readonly"),
    "",
  );
  await form.locator('[name="room_id"]').selectOption("L1-01");
  await form.locator('[name="symptom"]').fill("AHU noise browser test");
  await form.locator('[name="impact"]').fill("Team workspace affected");
  await form
    .locator('[name="description"]')
    .fill("Equipment unknown; manager to identify AHU.");
  await form.locator('button[type="submit"]').click();
  await expect(page.locator("#maintenanceMessage")).toContainText(
    "saved. Awaiting manager review.",
  );
  const reportId = await page.locator("#maintenanceReportSelect").inputValue();
  await expect(page.locator("#managerTriageForm")).toBeHidden();
  // Session cookie persists across reloads; report ownership survives.
  await page.reload();
  await expect(
    page.locator(`#maintenanceReportSelect option[value="${reportId}"]`),
  ).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Responsive authenticated shell",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await logout();
  await login("manager");
  await page.locator("#maintenanceReportSelect").selectOption(reportId);
  const triage = page.locator("#managerTriageForm");
  await expect(triage).toBeVisible();
  await triage.locator('[name="priority"]').selectOption("High");
  await triage
    .locator('[name="reason"]')
    .fill("Confirmed pilot AHU for investigation");
  await triage.locator('[name="asset_id"]').selectOption("AHU-L1-01");
  await triage.locator('[name="link_mode"]').selectOption("new");
  await triage.locator('button[type="submit"]').click();
  await expect(page.locator("#maintenanceMessage")).toHaveText(
    "Manager triage saved.",
  );
  await expect(page.locator("#maintenanceReportDetail")).toContainText(
    "Triaged · High",
  );
  await page.screenshot({
    path: path.join(root, "test-results/auth-maintenance.png"),
  });
  await logout();
  await login("viewer");
  await expect(page.locator("#maintenanceReportCard")).toBeHidden();
  await expect(page.locator("#maintenanceReportAction")).toBeHidden();
  await page.locator("#maintenanceReportSelect").selectOption(reportId);
  await expect(triage).toBeHidden();
  await logout();
  await login("admin");
  await expect(page.locator("#navUsers")).toBeVisible();
  // Check the existing 3D/blueprint controls under an authenticated session.
  await page.locator("#navProjects").click();
  await page
    .locator('[data-project-id="atrium-building"] .open-project')
    .click();
  await expect(page.locator("#buildingCanvas")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 60000 },
  );
  const canvas = page.locator("#buildingCanvas");
  const camera = await canvas.getAttribute("data-camera");
  await page.locator('button[data-presentation="blueprint"]').click();
  await expect(canvas).toHaveAttribute("data-presentation", "blueprint");
  await page.locator('button[data-presentation="normal"]').click();
  assert.equal(await canvas.getAttribute("data-camera"), camera);
  await page.locator("#equipmentOptions summary").click();
  await page.locator("#equipmentSelect").selectOption("AHU-L1-01");
  await expect(page.locator("#openAssetMaintenance")).toContainText(
    "AHU-L1-01",
  );
  await page.locator("#openAssetMaintenance").click();
  await expect(page.locator("#maintenanceContext")).toContainText("AHU-L1-01");
  // Expired sessions return to login instead of leaving protected controls active.
  execFileSync(
    python,
    [
      "-c",
      "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('UPDATE auth_sessions SET expires_at=0'); c.commit(); c.close()",
      db,
    ],
    { cwd: root },
  );
  await page.locator("#maintenanceRefresh").click();
  await expect(page.locator("#loginScreen")).toBeVisible();
  await expect(page.locator("#applicationShell")).toBeHidden();
  await expect(page.locator("#loginMessage")).toContainText("session expired");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: login failure/success, persisted session, employee report, manager linking, viewer read-only, navigation, responsive shell, 3D/blueprint/selection and session expiry.",
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

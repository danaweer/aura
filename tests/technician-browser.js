/* Manager assignment and technician execution in isolated temporary accounts/data. */
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
const root = fileURLToPath(new URL("..", import.meta.url)),
  python = path.join(root, ".venv/bin/python");
const temporary = await mkdtemp(path.join(os.tmpdir(), "aura-technician-")),
  db = path.join(temporary, "aura.sqlite3");
const password = randomBytes(24).toString("base64url");
const orderId = execFileSync(
  python,
  [
    "-c",
    `
import json,sys
from history import HistoryStore
s=HistoryStore(sys.argv[1]); p=json.load(sys.stdin)['password']
admin=s.auth.bootstrap_admin('browser-admin','Test administrator',p)
manager=s.auth.create_user(admin['user_id'],'manager','Test manager',p,'manager',['atrium-building'])
s.auth.create_user(admin['user_id'],'technician','Test technician',p,'technician',['atrium-building'])
report=s.maintenance.reports.submit('atrium-building','L1-M01','Test observer','Browser corrective inspection','2026-01-01T12:00:00Z','Test workspace','Browser test record','browser-report',asset_id='AHU-L1-01')
linked=s.maintenance.reports.triage('atrium-building',report['report_id'],1,'High','Test assignment workflow',asset_id='AHU-L1-01',link_mode='new',actor=manager['user_id'])
print(linked['work_order_id']);s.close()
`,
    db,
  ],
  { cwd: root, input: JSON.stringify({ password }), encoding: "utf8" },
).trim();
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
  for (let i = 0; i < 60; i++) {
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
  const errors = [];
  async function pageFor(username, section = "") {
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      }),
      page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(
      `${url}/#maintenance?project_id=atrium-building${section ? `&section=${section}` : ""}`,
    );
    await page.locator('#loginForm [name="username"]').fill(username);
    await page.locator('#loginForm [name="password"]').fill(password);
    await page.locator('#loginForm button[type="submit"]').click();
    return page;
  }
  const manager = await pageFor("manager", "work-orders");
  await expect(
    manager.locator(`#maintenanceWorkOrderSelect option[value="${orderId}"]`),
  ).toHaveCount(1);
  await manager.locator("#maintenanceWorkOrderSelect").selectOption(orderId);
  const assignment = manager.locator(".task-assignment");
  await expect(assignment).toBeVisible();
  await assignment
    .locator('[name="assignee_id"]')
    .selectOption({ label: "Test technician · technician" });
  await assignment.locator('[name="due_at"]').fill("2027-01-02T14:00");
  await assignment
    .locator('[name="note"]')
    .fill("Assign for an on-site test inspection");
  await assignment.locator('button[type="submit"]').click();
  await expect(manager.locator(".task-status")).toContainText("Assigned");
  await expect(manager.locator(".task-message")).toHaveText("Action saved.");
  const tech = await pageFor("technician");
  await expect(tech.locator("#maintenanceMyTasksPanel")).toBeVisible();
  await expect(tech.locator("#myTasksList .task-list-item")).toHaveCount(1);
  await expect(tech.locator(".task-meta")).toContainText("AHU-L1-01");
  await expect(tech.locator(".task-assignment")).toBeHidden();
  async function action(name, state, note) {
    if (note) await tech.locator(".task-note").fill(note);
    await tech.locator(`[data-action="${name}"]`).click();
    await expect(tech.locator(".task-message")).toHaveText("Action saved.");
    if (state)
      await expect(tech.locator(".task-detail")).toHaveAttribute(
        "data-state",
        state,
      );
  }
  await action("acknowledge", "Assigned");
  await action("start", "In progress");
  await action(
    "wait_parts",
    "Waiting for parts",
    "Waiting for an approved replacement",
  );
  await action("resume", "In progress", "Part received");
  await action(
    "wait_access",
    "Waiting for access",
    "Room temporarily unavailable",
  );
  await action("resume", "In progress", "Access approved");
  const work = tech.locator(".task-work");
  await work
    .locator('[name="findings"]')
    .fill("Test inspection found intermittent fan operation");
  await work.locator('[name="cause_status"]').selectOption("Undetermined");
  await work
    .locator('[name="diagnosis"]')
    .fill(
      "Cause remains undetermined; recommend further investigation under occupied conditions",
    );
  await work
    .locator('[name="repair_action"]')
    .fill("Inspected and secured connections per test procedure");
  await work.locator('[name="materials_used"]').fill("None");
  await work.locator('[name="work_duration_minutes"]').fill("25");
  await work
    .locator('[name="post_work_checks"]')
    .fill(
      "Test fixture: observed stable fan operation during post-work checks",
    );
  await work.locator('[name="post_work_result"]').selectOption("Passed");
  await tech
    .locator(".task-note")
    .fill("Recorded test investigation and work outcomes");
  await work.locator('button[value="record"]').click();
  await expect(tech.locator(".task-message")).toHaveText("Action saved.");
  await tech.reload();
  await expect(tech.locator('.task-work [name="findings"]')).toHaveValue(
    "Test inspection found intermittent fan operation",
  );
  await mkdir(path.join(root, "test-results"), { recursive: true });
  await tech.screenshot({
    path: path.join(root, "test-results/technician-workspace.png"),
  });
  await tech.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await tech.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await tech.setViewportSize({ width: 1440, height: 1000 });
  await tech.locator('[data-command="locate"]').click();
  await expect(tech.locator("#buildingCanvas")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 60000 },
  );
  await expect(tech.locator("#buildingCanvas")).toHaveAttribute(
    "data-equipment-selection",
    "AHU-L1-01",
  );
  await tech.locator("#navMaintenance").click();
  await expect(tech.locator(".task-work")).toBeVisible();
  await tech
    .locator(".task-note")
    .fill("Test work submitted for independent verification");
  await tech.locator('.task-work button[value="complete"]').click();
  await expect(tech.locator(".task-status")).toContainText(
    "Completed — awaiting verification",
  );
  await expect(tech.locator(".task-work")).toBeHidden();
  await expect(tech.locator(".task-history")).toContainText("Test technician");
  await manager.locator("#maintenanceRefresh").click();
  await expect(manager.locator(".task-status")).toContainText(
    "Completed — awaiting verification",
  );
  await expect(manager.locator(".task-assignment")).toBeHidden();
  await expect(tech.locator(".task-review")).toBeHidden();
  const review = manager.locator(".task-review");
  await expect(review).toBeVisible();
  await expect(manager.locator(".task-record-summary")).toHaveAttribute(
    "open",
    "",
  );
  await expect(manager.locator(".task-record-summary")).toContainText(
    "Inspected and secured connections per test procedure",
  );
  // Keep a second manager tab stale while the first returns the job for rework.
  const stale = await manager.context().newPage();
  stale.on("pageerror", (error) => errors.push(error.message));
  await stale.goto(
    `${url}/#maintenance?project_id=atrium-building&section=work-orders`,
  );
  await expect(
    stale.locator(`#maintenanceWorkOrderSelect option[value="${orderId}"]`),
  ).toHaveCount(1);
  await stale.locator("#maintenanceWorkOrderSelect").selectOption(orderId);
  await expect(stale.locator(".task-review")).toBeVisible();
  await review
    .locator('[name="note"]')
    .fill("Repeat the post-work check under load");
  await review.locator('button[value="return_rework"]').click();
  await expect(manager.locator(".task-detail")).toHaveAttribute(
    "data-state",
    "In progress",
  );
  await expect(review).toBeHidden();
  await expect(manager.locator(".task-review-result")).toContainText(
    "Returned for rework",
  );
  await stale.locator('.task-review [name="note"]').fill("Stale close attempt");
  await stale.locator('.task-review button[value="verify"]').click();
  await expect(stale.locator(".task-message")).toContainText(
    "Stale work-order version",
  );
  await expect(stale.locator('.task-review [name="note"]')).toHaveValue(
    "Stale close attempt",
  );
  await tech.reload();
  await expect(tech.locator(".task-work")).toBeVisible();
  await expect(tech.locator(".task-detail")).toHaveAttribute(
    "data-state",
    "In progress",
  );
  await expect(tech.locator(".task-review")).toBeHidden();
  await expect(tech.locator(".task-review-result")).toContainText(
    "Test manager",
  );
  await expect(tech.locator('.task-work [name="repair_action"]')).toHaveValue(
    "Inspected and secured connections per test procedure",
  );
  await tech
    .locator('.task-work [name="repair_action"]')
    .fill("Adjusted connection and repeated inspection after review");
  await tech
    .locator('.task-work [name="post_work_checks"]')
    .fill(
      "Test fixture: repeated post-work checks under load were satisfactory",
    );
  await tech.locator('.task-work [name="work_duration_minutes"]').fill("40");
  await tech
    .locator(".task-note")
    .fill("Rework completed and new checks recorded");
  await tech.locator('.task-work button[value="complete"]').click();
  await expect(tech.locator(".task-status")).toContainText(
    "Completed — awaiting verification",
  );
  await manager.locator("#maintenanceRefresh").click();
  await expect(review).toBeVisible();
  await expect(manager.locator(".task-record-summary")).toContainText(
    "Adjusted connection and repeated inspection after review",
  );
  await review
    .locator('[name="note"]')
    .fill("Rework evidence reviewed; restoration verified");
  await review.locator('button[value="verify"]').click();
  await expect(manager.locator(".task-detail")).toHaveAttribute(
    "data-state",
    "Verified/Closed",
  );
  await expect(review).toBeHidden();
  await manager.reload();
  await manager.locator("#maintenanceWorkOrderSelect").selectOption(orderId);
  await expect(manager.locator(".task-review-result")).toContainText(
    "Rework evidence reviewed; restoration verified",
  );
  await expect(manager.locator(".task-status")).toContainText("Closed ");
  await expect(manager.locator(".task-history")).toContainText(
    "Returned for rework",
  );
  await expect(manager.locator(".task-history")).toContainText(
    "Verified & closed",
  );
  await tech.reload();
  await expect(tech.locator(".task-detail")).toHaveAttribute(
    "data-state",
    "Verified/Closed",
  );
  await expect(tech.locator(".task-work")).toBeHidden();
  await expect(tech.locator(".task-review")).toBeHidden();
  await expect(tech.locator(".task-note-label")).toBeHidden();
  const response = await tech.request.get(
    `${url}/api/maintenance/work-orders/${orderId}?project_id=atrium-building`,
  );
  const result = await response.json();
  assert.ok(result.work_order.closed_at);
  assert.equal(result.work_order.cause_status, "Undetermined");
  const completions = result.events.filter(
    (event) => event.action === "complete",
  );
  assert.equal(completions.length, 2);
  assert.equal(
    completions[0].after.work_order.repair_action,
    "Inspected and secured connections per test procedure",
  );
  assert.equal(
    completions[1].after.work_order.repair_action,
    "Adjusted connection and repeated inspection after review",
  );
  assert.equal(
    result.events.find((event) => event.action === "return_rework").before
      .completed_at,
    completions[0].after.work_order.completed_at,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: technician lifecycle plus manager return/recomplete/verify-close, stale review rejection, refreshed audit evidence, and closed-job read-only UI.",
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

/* Presentation checks against the real application and an isolated temporary DB. */
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
const tmp = await mkdtemp(path.join(os.tmpdir(), "aura-ui-")),
  db = path.join(tmp, "aura.sqlite3"),
  password = randomBytes(24).toString("base64url");
execFileSync(
  python,
  [
    "-c",
    `import json,sys
from history import HistoryStore
s=HistoryStore(sys.argv[1]);s.auth.bootstrap_admin('ui-admin','UI administrator',json.load(sys.stdin)['password']);s.close()`,
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
let browser,
  server,
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
  server.stdout.on("data", (v) => {
    log += v;
  });
  server.stderr.on("data", (v) => {
    log += v;
  });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error(log);
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
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mkdir(path.join(root, "test-results"), { recursive: true });
  await page.goto(`${url}/#dashboard`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({
    path: path.join(root, "test-results/ui-login-light.png"),
  });
  await page.locator('#loginForm [name="username"]').fill("ui-admin");
  await page.locator('#loginForm [name="password"]').fill(password);
  await page.locator('#loginForm button[type="submit"]').click();
  await expect(page.locator("#dashboardPage")).toBeVisible();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator("#themeToggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  async function theme(name) {
    if ((await page.locator("html").getAttribute("data-theme")) !== name)
      await page.locator("#themeToggle").click();
  }
  async function route(hash, visible) {
    await page.evaluate((hash) => {
      location.hash = hash;
    }, hash);
    await expect(page.locator(visible)).toBeVisible();
  }
  async function noOverflow(label) {
    const result = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    const offenders =
      result.scroll > result.width + 1
        ? await page.locator("body *").evaluateAll((elements) =>
            elements
              .filter(
                (el) =>
                  el.getBoundingClientRect().right > innerWidth + 1 &&
                  el.getClientRects().length,
              )
              .slice(0, 8)
              .map((el) => ({
                tag: el.tagName,
                id: el.id,
                class: el.className,
              })),
          )
        : [];
    assert.ok(
      result.scroll <= result.width + 1,
      `${label}: ${JSON.stringify(result)} ${JSON.stringify(offenders)}`,
    );
  }
  for (const width of [1920, 1366, 834, 390, 320]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const mode of ["light", "dark"]) {
      await theme(mode);
      for (const [hash, selector] of [
        ["#dashboard", "#dashboardPage"],
        ["#projects", "#projectsView"],
        ["#maintenance?project_id=atrium-building", "#maintenancePage"],
        ["#users-access", "#usersPage"],
        ["#iot-devices", "#iotDevicesPage"],
        ["#calendar", "#plannedPage"],
        ["#notifications", "#plannedPage"],
      ]) {
        await route(hash, selector);
        await noOverflow(`${width}/${mode}/${hash}`);
      }
      await route(
        "#maintenance?project_id=atrium-building",
        "#maintenancePage",
      );
      await page.screenshot({
        path: path.join(
          root,
          `test-results/ui-maintenance-${width}-${mode}.png`,
        ),
      });
      if (width <= 1100) {
        await page.locator("#navigationToggle").click();
        await expect(page.locator("#navigationToggle")).toHaveAttribute(
          "aria-expanded",
          "true",
        );
        await expect(page.locator("#navDashboard")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.locator("#navigationToggle")).toBeFocused();
        await page.locator("#navigationToggle").click();
        await page.locator("#navUsers").click();
        await expect(page.locator("#usersPage")).toBeVisible();
        await expect(page.locator("#navigationToggle")).toHaveAttribute(
          "aria-expanded",
          "false",
        );
        assert.equal(
          await page
            .locator("#applicationNavigation")
            .evaluate((el) => el.inert),
          true,
        );
        const table = await page
          .locator(".users-table-scroll")
          .evaluate((el) => ({
            width: el.clientWidth,
            scroll: el.scrollWidth,
          }));
        if (width <= 390)
          assert.ok(
            table.scroll > table.width,
            "Wide table scrolls inside its container",
          );
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await route("#project/atrium-building", "#modelWorkspace");
  const canvas = page.locator("#buildingCanvas");
  await expect(canvas).toHaveAttribute("data-ready", "true", {
    timeout: 60000,
  });
  const camera = await canvas.getAttribute("data-camera");
  for (const width of [1920, 1366, 834, 390, 320]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const mode of ["light", "dark"]) {
      await theme(mode);
      await noOverflow(`building/${width}/${mode}`);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: path.join(root, `test-results/ui-building-${width}-${mode}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await theme("light");
  assert.equal(
    await canvas.getAttribute("data-camera"),
    camera,
    "Theme changes preserve camera",
  );
  await page.locator('button[data-presentation="blueprint"]').click();
  await theme("dark");
  await expect(canvas).toHaveAttribute("data-presentation", "blueprint");
  await page.locator("#floorSelect").selectOption("1");
  await expect(canvas).toHaveAttribute("data-floor", "1");
  await page.locator("#fullscreenBtn").click();
  await expect(page.locator("#viewerPanel")).toHaveClass(/is-immersive/);
  await page.locator("#fullscreenBtn").click();
  await expect(page.locator("#viewerPanel")).not.toHaveClass(/is-immersive/);
  await page.locator('button[data-presentation="normal"]').click();
  await route("#project/meeting-room", "#modelWorkspace");
  await expect(page.locator("#chartSummary")).toContainText(
    "available samples",
    { timeout: 15000 },
  );
  for (const mode of ["light", "dark"]) {
    await theme(mode);
    await page.locator("#roomTelemetry").scrollIntoViewIfNeeded();
    await noOverflow(`telemetry/${mode}`);
    await page.screenshot({
      path: path.join(root, `test-results/ui-telemetry-${mode}.png`),
    });
  }
  await page.locator("#helpBtn").click();
  await expect(page.locator("#helpDialog")).toBeVisible();
  await page.locator("#closeHelp").click();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: system/default/persisted themes; seven routes at phone/tablet/desktop in both themes; keyboard/collapsible navigation; table containment; 3D, blueprint, floor isolation, camera preservation, fullscreen, telemetry charts and dialog.",
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
  await rm(tmp, { recursive: true, force: true });
}

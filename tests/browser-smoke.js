/* Real-browser smoke checks. Uses Chrome on macOS or Playwright Chromium elsewhere. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = await mkdtemp(path.join(os.tmpdir(), "aura-browser-"));
const probe = net.createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const url = `http://127.0.0.1:${port}`;
const python =
  process.env.PYTHON_BIN ||
  path.join(
    root,
    ".venv",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python",
  );
let server, browser;
let serverLog = "";
async function startServer(roomConfig) {
  server = spawn(
    python,
    [
      "-u",
      "server.py",
      "--demo",
      "--web-port",
      String(port),
      "--history-db",
      path.join(temporary, "history.sqlite3"),
      ...(roomConfig ? ["--room-config", roomConfig] : []),
    ],
    { cwd: root },
  );
  server.stdout.on("data", (chunk) => {
    serverLog += chunk;
  });
  server.stderr.on("data", (chunk) => {
    serverLog += chunk;
  });
  let failure;
  server.on("error", (error) => {
    failure = error;
  });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (failure) throw failure;
    if (server.exitCode !== null)
      throw new Error(`Server stopped: ${serverLog}`);
    try {
      const response = await fetch(`${url}/api/state`);
      if (response.ok && (await response.json()).message) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Server did not become ready: ${serverLog}`);
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const exited = once(server, "exit");
  server.kill("SIGINT");
  const timer = setTimeout(() => server.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(timer);
}

try {
  await startServer();
  browser = await chromium.launch({
    headless: true,
    channel:
      process.env.AURA_BROWSER_CHANNEL ||
      (process.platform === "darwin" ? "chrome" : undefined),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await expect(page.locator("#roomName")).toHaveText("Atrium building / 01");
  await expect(page.locator("#buildingCanvas")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 15000 },
  );
  await expect(page.locator("#connLabel")).toHaveText("MODEL ONLY · NO IoT");
  await expect(page.locator("#inspectorPanel")).toBeHidden();
  await expect(page.locator("#roomTelemetry")).toBeHidden();
  await expect(page.locator("#projectIot")).toContainText(
    "No devices assigned",
  );
  for (const floor of ["0", "1", "2"]) {
    await page.locator("#floorSelect").selectOption(floor);
    await expect(page.locator("#buildingCanvas")).toHaveAttribute(
      "data-floor",
      floor,
    );
  }
  await page.locator("#floorSelect").selectOption("all");
  await page.locator("#atriumBtn").click();
  await expect(page.locator("#buildingCanvas")).toHaveAttribute(
    "data-view",
    "atrium",
  );
  await page.locator("#isoBtn").click();
  const facadeBefore = await page
    .locator("#buildingCanvas")
    .evaluate((canvas) => canvas.toDataURL());
  await page.locator("#glassToggle").uncheck();
  await expect
    .poll(() =>
      page.locator("#buildingCanvas").evaluate((canvas) => canvas.toDataURL()),
    )
    .not.toBe(facadeBefore);
  await page.locator("#glassToggle").check();
  await page.reload();
  await expect(page.locator("#buildingCanvas")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 15000 },
  );
  await expect(page.locator("#roomName")).toHaveText("Atrium building / 01");
  await mkdir(path.join(root, "test-results"), { recursive: true });
  await expect(page.locator("#buildingCanvas")).toHaveAttribute(
    "data-view",
    "offices",
  );
  await expect(page.locator("#modeChip")).toHaveText("FURNISHED MODEL");
  await expect(page.locator("#roomSelect option")).toHaveCount(71);
  for (const [floor, name, purpose] of [
    ["0", "ground", "Arrival"],
    ["1", "first", "Team"],
    ["2", "second", "Leadership"],
  ]) {
    await page.locator("#floorSelect").selectOption(floor);
    await page.locator("#topBtn").click();
    await expect(page.locator("#buildingCanvas")).toHaveAttribute(
      "data-view",
      "plan",
    );
    await expect(page.locator("#floorPurpose")).toContainText(purpose);
    await page.screenshot({
      path: path.join(root, "test-results", `building-${name}-plan.png`),
      fullPage: true,
    });
  }
  await page.locator("#roomSelect").selectOption("L2-04");
  await expect(page.locator("#buildingPartTitle")).toContainText("Boardroom");
  await expect(page.locator("#buildingPartInfo")).toContainText(
    "70 m² · 12 seats",
  );
  await page.locator("#roomSelect").selectOption("G-M01");
  await expect(page.locator("#floorSelect")).toHaveValue("0");
  await expect(page.locator("#buildingPartTitle")).toContainText("Fire pump");
  await expect(page.locator("#buildingPartInfo")).toContainText("27 m²");
  await page.locator("#serviceReservesToggle").check();
  await page.locator("#officeViewBtn").click();
  await expect(page.locator("#buildingCanvas")).toHaveAttribute(
    "data-services",
    "true",
  );
  await page.screenshot({
    path: path.join(root, "test-results", "building-service-reserves.png"),
    fullPage: true,
  });
  await page.locator("#serviceReservesToggle").uncheck();
  const furnishedBefore = await page
    .locator("#buildingCanvas")
    .evaluate((canvas) => canvas.toDataURL());
  await page.locator("#furnitureToggle").uncheck();
  await expect(page.locator("#buildingCanvas")).toHaveAttribute(
    "data-furniture",
    "false",
  );
  await expect
    .poll(() =>
      page.locator("#buildingCanvas").evaluate((canvas) => canvas.toDataURL()),
    )
    .not.toBe(furnishedBefore);
  await page.locator("#furnitureToggle").check();
  await page.locator("#lowWallsToggle").uncheck();
  await expect(page.locator("#buildingCanvas")).toHaveAttribute(
    "data-low-walls",
    "false",
  );
  await page.locator("#lowWallsToggle").check();
  await page.locator("#roomLabelsToggle").uncheck();
  await expect(page.locator("#buildingLabels button:visible")).toHaveCount(0);
  await page.locator("#roomLabelsToggle").check();
  await expect(
    page.locator('#buildingLabels button[data-room-id="G-05"]'),
  ).toBeVisible();
  console.log(
    "PASS Furnished floor plans, room navigation, boardroom capacity, service reserves, and interior layer controls",
  );
  await page.screenshot({
    path: path.join(root, "test-results", "building-desktop.png"),
    fullPage: true,
  });
  await page.locator("#cutawayToggle").check();
  await page.locator("#atriumBtn").click();
  await page.screenshot({
    path: path.join(root, "test-results", "building-atrium.png"),
    fullPage: true,
  });
  await page.locator("#cutawayToggle").uncheck();
  await page.locator("#isoBtn").click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Building mobile viewport fits",
  );
  await page.screenshot({
    path: path.join(root, "test-results", "building-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("#openProjectsBtn").click();
  await expect(page.locator("#projectCards .project-card")).toHaveCount(2);
  await page.screenshot({
    path: path.join(root, "test-results", "projects.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Open Meeting room / 01", exact: true })
    .click();
  console.log(
    "PASS Three-floor building, floor isolation, atrium, glazing, project library, mobile layout, and IoT isolation",
  );
  await expect(page.locator("#connLabel")).toHaveText("SIMULATED STREAM");
  await expect(page.locator("#qualityText")).toHaveText("SIMULATED");
  await expect(page.locator("#temperature")).not.toHaveText("—");
  await expect(page.locator("#modeChip")).toHaveText("SIMULATED MODE");
  await expect(page.locator("#historyStatus")).toContainText("LOCAL HISTORY");
  await expect(page.locator("#sensorHealth")).toContainText(
    "Temperature / humidity: OK",
  );
  // A resize clears the canvas; wait for the renderer's next animation frame.
  await expect
    .poll(
      () =>
        page.locator("#roomCanvas").evaluate((canvas) =>
          canvas
            .getContext("2d")
            .getImageData(0, 0, canvas.width, canvas.height)
            .data.some((value) => value > 0),
        ),
      { message: "Room canvas has visible content" },
    )
    .toBe(true);
  console.log("PASS Demo connects and room, quality, and sensor health render");

  await page.locator("#demoAlarmBtn").click();
  await expect(page.locator("#alarmBadge")).toHaveText("ON");
  const alarm = page
    .locator("#eventList .event-item")
    .filter({ hasText: "Simulated alarm ON" });
  await expect(alarm).toHaveCount(1);
  const saved = await (await fetch(`${url}/api/history`)).json();
  const alarmStamp = saved.events.find((event) => event.alarm_on).at;
  assert.equal(
    await alarm.locator("time").getAttribute("datetime"),
    new Date(alarmStamp).toISOString(),
  );
  const csv = await fetch(`${url}/api/history.csv`);
  assert.ok((await csv.text()).includes("sampled_at"));
  await page.reload();
  await expect(page.locator("#alarmBadge")).toHaveText("ON");
  await expect(
    page
      .locator("#eventList .event-item")
      .filter({ hasText: "Simulated alarm ON" }),
  ).toHaveCount(1);
  console.log(
    "PASS Alarm timestamps, CSV download, and history restoration without duplicates",
  );

  await page.locator("#openProjectsBtn").click();
  await page
    .getByRole("button", { name: "Open Atrium building / 01", exact: true })
    .click();
  await expect(page.locator("#connLabel")).toHaveText("MODEL ONLY · NO IoT");
  await expect(page.locator("#roomTelemetry")).toBeHidden();
  await page.locator("#openProjectsBtn").click();
  await page
    .getByRole("button", { name: "Open Meeting room / 01", exact: true })
    .click();
  await expect(page.locator("#alarmBadge")).toHaveText("ON");
  await expect(
    page
      .locator("#eventList .event-item")
      .filter({ hasText: "Simulated alarm ON" }),
  ).toHaveCount(1);

  await page
    .getByRole("button", { name: "Inspect HVAC display model" })
    .click();
  await expect(page.locator("#assetTitle")).toHaveText("HVAC diffuser");
  await expect(page.locator("#sensorDetails")).toBeHidden();
  await expect(page.locator("#alarmCard")).toBeHidden();
  await expect(page.locator("#modelDetails")).toBeVisible();
  await page.getByRole("button", { name: "Inspect alarm device" }).click();
  await expect(page.locator("#sensorDetails")).toBeHidden();
  await expect(page.locator("#alarmCard")).toBeVisible();
  await page.getByRole("button", { name: "Inspect MXCHIP sensor" }).click();
  await expect(page.locator("#sensorDetails")).toBeVisible();
  await page.locator("#roomCanvas").focus();
  const before = await page
    .locator("#roomCanvas")
    .evaluate((canvas) => canvas.toDataURL());
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(() =>
      page.locator("#roomCanvas").evaluate((canvas) => canvas.toDataURL()),
    )
    .not.toBe(before);
  await page.locator("#topBtn").click();
  await expect(page.locator("#topBtn")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#isoBtn").click();
  assert.equal(
    await page
      .locator(".pulse")
      .first()
      .evaluate((node) => getComputedStyle(node).animationName),
    "none",
  );
  console.log(
    "PASS Asset-specific inspectors, keyboard camera, view controls, and reduced motion",
  );

  await stopServer();
  await expect(page.locator("#connLabel")).toHaveText("STREAM RECONNECTING");
  await expect(page.locator("#alarmBadge")).toHaveText("UNKNOWN");
  await startServer();
  await expect(page.locator("#connLabel")).toHaveText("SIMULATED STREAM", {
    timeout: 10000,
  });
  await expect(page.locator("#alarmBadge")).toHaveText("OFF");
  await expect(
    page
      .locator("#eventList .event-item")
      .filter({ hasText: "Simulated alarm ON" }),
  ).toHaveCount(1);
  console.log(
    "PASS Server loss removes live/alarm certainty; restart reconnects and preserves history",
  );

  await mkdir(path.join(root, "test-results"), { recursive: true });
  await page.screenshot({
    path: path.join(root, "test-results", "desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator("#temperature")).toBeVisible();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Mobile layout fits the viewport",
  );
  await page.screenshot({
    path: path.join(root, "test-results", "mobile.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, [], "No browser JavaScript errors");
  console.log("PASS Desktop/mobile layout and no browser JavaScript errors");

  await stopServer();
  const roomConfig = path.join(temporary, "room.json");
  await writeFile(
    roomConfig,
    JSON.stringify({
      name: "Studio / 02",
      code: "ST-02",
      width_m: 8,
      depth_m: 6.2,
      sensor_position: { x: 1, y: 1, z: 0.5 },
    }),
  );
  await startServer(roomConfig);
  await expect(page.locator("#roomName")).toHaveText("Studio / 02", {
    timeout: 10000,
  });
  await expect(page.locator("#roomDimensions")).toHaveText("8 × 6.2 m");
  await expect(page.locator("#connLabel")).toHaveText("SIMULATED STREAM");
  await expect(
    page
      .locator("#eventList .event-item")
      .filter({ hasText: "Simulated alarm ON" }),
  ).toHaveCount(0);
  assert.deepEqual(
    errors,
    [],
    "Configured room has no browser JavaScript errors",
  );
  console.log(
    "PASS Custom room and sensor configuration, with history isolated by room",
  );
} finally {
  if (browser) await browser.close();
  await stopServer();
  await rm(temporary, { recursive: true, force: true });
}

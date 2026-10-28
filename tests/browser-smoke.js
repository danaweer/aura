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
  await mkdir(path.join(root, "test-results"), { recursive: true });
  await expect(page.locator("#buildingCanvas")).toHaveAttribute(
    "data-view",
    "overview",
  );
  await expect(page.locator("#buildingCanvas")).toHaveAttribute(
    "data-roof-visible",
    "true",
  );
  await expect(page.locator("#buildingCanvas")).toHaveAttribute(
    "data-ceilings-visible",
    "true",
  );
  await page.locator("#scene").screenshot({
    path: path.join(root, "test-results", "exterior-overview.png"),
  });
  for (const view of ["front", "rear", "left", "right", "roof"]) {
    await page.locator("#buildingViewSelect").selectOption(view);
    await expect(page.locator("#buildingCanvas")).toHaveAttribute(
      "data-view",
      view,
    );
    await page.locator("#scene").screenshot({
      path: path.join(root, "test-results", `exterior-${view}.png`),
    });
  }
  await page.locator("#ceilingsToggle").uncheck();
  await expect(page.locator("#buildingCanvas")).toHaveAttribute(
    "data-ceilings-visible",
    "false",
  );
  await page.locator("#roofToggle").uncheck();
  await expect(page.locator("#buildingCanvas")).toHaveAttribute(
    "data-roof-visible",
    "false",
  );
  await page.locator("#roofToggle").check();
  await page.locator("#ceilingsToggle").check();
  await page.locator("#systemsToggle").uncheck();
  await expect(page.locator("#buildingCanvas")).toHaveAttribute(
    "data-systems",
    "false",
  );
  await page.locator("#systemsToggle").check();
  // Middle-drag translates the model without rotating/scaling it or selecting an asset.
  async function checkMiddlePan(ids, overLabel = false) {
    const labels = ids.map((id) =>
      page.locator(`#buildingLabels button[data-room-id="${id}"]`),
    );
    const before = await Promise.all(
      labels.map((label) => label.boundingBox()),
    );
    const title = await page.locator("#buildingPartTitle").textContent();
    const rect = await page.locator("#buildingCanvas").boundingBox();
    const x = overLabel
        ? before[0].x + before[0].width / 2
        : rect.x + rect.width * 0.5,
      y = overLabel
        ? before[0].y + before[0].height / 2
        : rect.y + rect.height * 0.5;
    await page.mouse.move(x, y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(x + 45, y + 25, { steps: 5 });
    await page.mouse.up({ button: "middle" });
    const after = await Promise.all(labels.map((label) => label.boundingBox()));
    for (let i = 0; i < before.length; i++) {
      assert.ok(
        Math.abs(after[i].x - before[i].x - 45) < 2,
        "Middle-drag pans horizontally",
      );
      assert.ok(
        Math.abs(after[i].y - before[i].y - 25) < 2,
        "Middle-drag pans vertically",
      );
    }
    await expect(page.locator("#buildingPartTitle")).toHaveText(title);
  }
  await page.locator("#floorSelect").selectOption("0");
  await page.locator("#topBtn").click();
  await checkMiddlePan(["G-01", "G-05"]);
  await checkMiddlePan(["G-01", "G-05"], true);
  await page.locator("#isoBtn").click();
  await page.locator("#fullscreenBtn").click();
  await expect(page.locator("#viewerPanel")).toHaveAttribute(
    "data-fullscreen",
    "native",
  );
  assert.equal(
    await page.evaluate(() => document.fullscreenElement?.id),
    "viewerPanel",
  );
  await expect(page.locator("#fullscreenControls #floorSelect")).toBeVisible();
  await expect(page.locator("#fullscreenControls #roomSelect")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("#viewerPanel")
        .evaluate((el) => Math.abs(el.clientHeight - window.innerHeight)),
    )
    .toBeLessThan(2);
  await page.screenshot({
    path: path.join(root, "test-results", "building-fullscreen.png"),
  });
  const visiblePanelWidth = (
    await page.locator("#buildingCanvas").boundingBox()
  ).width;
  await page.locator("#fullscreenPanelToggle").click();
  await expect(page.locator("#fullscreenControls")).toBeHidden();
  await expect
    .poll(
      async () => (await page.locator("#buildingCanvas").boundingBox()).width,
    )
    .toBeGreaterThan(visiblePanelWidth);
  await page.locator("#fullscreenPanelToggle").click();
  await page.locator("#roofToggle").uncheck();
  await page.locator("#ceilingsToggle").uncheck();
  await expect(page.locator("#buildingCanvas")).toHaveAttribute(
    "data-roof-visible",
    "false",
  );
  await expect(page.locator("#buildingCanvas")).toHaveAttribute(
    "data-ceilings-visible",
    "false",
  );
  await page.locator("#floorSelect").selectOption("1");
  await page.locator("#topBtn").click();
  await checkMiddlePan(["L1-01", "L1-04"]);
  await page.locator("#roomSelect").selectOption("L1-S01");
  await expect(
    page.locator("#fullscreenControls #buildingPartTitle"),
  ).toContainText("L1-S01");
  await page.locator("#systemsToggle").uncheck();
  await page.screenshot({
    path: path.join(root, "test-results", "building-fullscreen-floor.png"),
  });
  await page.locator("#furnitureToggle").uncheck();
  await page.keyboard.press("Escape");
  await expect(page.locator("#viewerPanel")).toHaveAttribute(
    "data-fullscreen",
    "off",
  );
  await expect(page.locator("#fullscreenControls")).toBeHidden();
  await expect(
    page.locator("#viewerPanel > #buildingOptions #floorSelect"),
  ).toHaveValue("1");
  await expect(page.locator("#buildingInspector #roomSelect")).toHaveValue(
    "L1-S01",
  );
  await expect(page.locator("#furnitureToggle")).not.toBeChecked();
  await page.locator("#furnitureToggle").check();
  await page.locator("#isoBtn").click();
  await page.locator("#roofToggle").check();
  await page.locator("#ceilingsToggle").check();
  await page.locator("#systemsToggle").check();
  // If native fullscreen is unavailable, the expanded viewer remains usable and exits cleanly.
  await page.evaluate(() => {
    window.originalRequestFullscreen = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = () =>
      Promise.reject(new Error("Fullscreen disabled for fallback test"));
  });
  await page.locator("#fullscreenBtn").click();
  await expect(page.locator("#viewerPanel")).toHaveAttribute(
    "data-fullscreen",
    "expanded",
  );
  await expect(page.locator("#fullscreenControls #glassToggle")).toBeVisible();
  await page.locator("#fullscreenBtn").click();
  await expect(page.locator("#viewerPanel")).toHaveAttribute(
    "data-fullscreen",
    "off",
  );
  await page.evaluate(() => {
    Element.prototype.requestFullscreen = window.originalRequestFullscreen;
    delete window.originalRequestFullscreen;
  });
  console.log(
    "PASS Middle-button panning, native fullscreen, sidebar layers, panel resizing, Escape exit, state restoration and fullscreen fallback",
  );
  for (const floor of ["0", "1", "2"]) {
    await page.locator("#floorSelect").selectOption(floor);
    await expect(page.locator("#buildingCanvas")).toHaveAttribute(
      "data-floor",
      floor,
    );
    await expect(page.locator("#buildingCanvas")).toHaveAttribute(
      "data-ceilings-visible",
      "false",
    );
    await expect(page.locator("#buildingCanvas")).toHaveAttribute(
      "data-roof-visible",
      "false",
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
    "overview",
  );
  await expect(page.locator("#modeChip")).toHaveText("FURNISHED MODEL");
  await expect(page.locator("#roomSelect option")).toHaveCount(71);
  await page.locator("#systemsToggle").uncheck();
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
  for (const [room, name] of [
    ["L1-S01", "stair-A"],
    ["L1-S02", "stair-B"],
  ]) {
    await page.locator("#officeViewBtn").click();
    await page.locator("#roomSelect").selectOption(room);
    await expect(page.locator("#buildingPartTitle")).toContainText(room);
    await page.locator("#scene").screenshot({
      path: path.join(root, "test-results", `${name}-landing.png`),
    });
  }
  await page.locator("#roomSelect").selectOption("L2-04");
  await expect(page.locator("#buildingPartTitle")).toContainText("Boardroom");
  await expect(page.locator("#buildingPartInfo")).toContainText(
    "70 m² · 12 seats",
  );
  await page.locator("#officeViewBtn").click();
  await page.locator("#scene").screenshot({
    path: path.join(root, "test-results", "interior-second-floor.png"),
  });
  await page.locator("#systemsToggle").check();
  await page.locator("#scene").screenshot({
    path: path.join(root, "test-results", "interior-air-distribution.png"),
  });
  await page.locator("#systemsToggle").uncheck();
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
  await page.locator("#topBtn").click();
  const trainingLabel = await page
    .locator('#buildingLabels button[data-room-id="G-05"]')
    .boundingBox();
  await page.locator("#roomLabelsToggle").uncheck();
  await page.mouse.click(
    trainingLabel.x + trainingLabel.width / 2,
    trainingLabel.y + trainingLabel.height / 2,
  );
  await expect(page.locator("#buildingPartTitle")).toContainText("G-05");
  await expect(page.locator("#buildingPartInfo")).toContainText("16 seats");
  await page.locator("#roomLabelsToggle").check();
  await page.locator("#officeViewBtn").click();
  console.log(
    "PASS Furnished floor plans, room navigation, boardroom capacity, service reserves, and interior layer controls",
  );
  await page.screenshot({
    path: path.join(root, "test-results", "building-desktop.png"),
    fullPage: true,
  });
  // PDF Rev E01 schedule, physical boards, floor-specific overlays and complete stair descent.
  await expect(
    page.locator("#egressSignSelect optgroup[data-schedule='pdf'] option"),
  ).toHaveCount(57);
  await page.locator("#egressPlanBtn").click();
  await expect(page.locator("#roomLabelsToggle")).not.toBeChecked();
  for (const [floor, count] of [
    ["0", 21],
    ["1", 18],
    ["2", 18],
  ]) {
    await page.locator("#floorSelect").selectOption(floor);
    await expect(page.locator("#egressLabels button:visible")).toHaveCount(
      count,
    );
    await page.locator("#scene").screenshot({
      path: path.join(root, "test-results", `egress-plan-${floor}.png`),
    });
  }
  await page.locator('#egressLabels button[data-sign-id="2-15"]').click();
  await expect(page.locator("#buildingPartTitle")).toContainText("2-15");
  await expect(page.locator("#buildingPartInfo")).toContainText("PDF p.9");
  await expect(page.locator("#buildingPartInfo")).toContainText(
    "Room side above corridor door",
  );
  // Inspect the formerly crossed cabinets from a small oblique angle.
  const systemsBeforeSignInspection = await page
    .locator("#systemsToggle")
    .isChecked();
  await page.locator("#systemsToggle").uncheck();
  await page.locator("#egressPathsToggle").uncheck();
  for (const id of ["2-09", "2-10", "2-01", "2-02"]) {
    await page.locator("#egressSignSelect").selectOption(`EGRESS-${id}`);
    await expect(page.locator("#buildingPartTitle")).toContainText(id);
    const box = await page.locator("#buildingCanvas").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: "left" });
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, {
      steps: 4,
    });
    await page.mouse.up({ button: "left" });
    await page.locator("#scene").screenshot({
      path: path.join(root, "test-results", `egress-single-sign-${id}.png`),
    });
  }
  await expect(
    page.locator("#egressSignSelect optgroup[data-schedule='stair'] option"),
  ).toHaveCount(6);
  for (const stair of ["A", "B"])
    for (const floor of ["0", "1", "2"]) {
      const id = `EGRESS-STAIR-${stair}-${floor}`;
      await page.locator("#egressSignSelect").selectOption(id);
      await expect(page.locator("#floorSelect")).toHaveValue(floor);
      await expect(page.locator("#buildingPartTitle")).toContainText(
        `Stair ${stair}`,
      );
      await expect(page.locator("#buildingPartInfo")).toContainText(
        floor === "0" ? "SIDE DOOR" : "DOWN TO GROUND",
      );
      await page.locator("#scene").screenshot({
        path: path.join(
          root,
          "test-results",
          `stair-pictogram-${stair}-${floor}-3d.png`,
        ),
      });
      // Export the same code-drawn face used by the 3D cabinet for visual review.
      const png = await page.evaluate(async (assetId) => {
        const { drawStairPictogram } =
          await import("/projects/atrium-building/egress.js");
        const { SUPPLEMENTAL_SIGNS } =
          await import("/projects/atrium-building/egress-plan.js");
        const sign = SUPPLEMENTAL_SIGNS.find((s) => s.assetId === assetId);
        const canvas = document.createElement("canvas");
        canvas.width = 1024;
        canvas.height = 576;
        drawStairPictogram(canvas.getContext("2d"), sign);
        return canvas.toDataURL("image/png").split(",")[1];
      }, id);
      await writeFile(
        path.join(
          root,
          "test-results",
          `stair-pictogram-${stair}-${floor}.png`,
        ),
        Buffer.from(png, "base64"),
      );
    }
  console.log(
    "PASS Pictographic stair guidance on all six occupied landings, floor selection and ground discharge direction",
  );
  if (systemsBeforeSignInspection) await page.locator("#systemsToggle").check();
  await page.locator("#egressPathsToggle").check();
  await page.locator("#egressSignSelect").selectOption("EGRESS-G-14");
  await expect(page.locator("#floorSelect")).toHaveValue("0");
  await expect(page.locator("#buildingPartInfo")).toContainText(
    "actual side-wall door",
  );
  await page.locator("#scene").screenshot({
    path: path.join(root, "test-results", "egress-stair-discharge-sign.png"),
  });
  await page.locator("#egressSignsToggle").uncheck();
  await expect(page.locator("#buildingCanvas")).toHaveAttribute(
    "data-egress-signs",
    "false",
  );
  await page.locator("#egressSignsToggle").check();
  await page.locator("#roomSelect").selectOption("L2-01");
  await page.locator("#traceExitBtn").click();
  await expect(page.locator("#buildingCanvas")).toHaveAttribute(
    "data-egress-trace",
    "L2-01",
  );
  await expect(page.locator("#floorSelect")).toHaveValue("all");
  await expect(page.locator("#egressRouteInfo")).toContainText(
    "Stair A → ground side exit",
  );
  await expect(page.locator("#egressRouteInfo")).toContainText(
    "assumed public-way connection",
  );
  await page.locator("#fullscreenBtn").click();
  await expect(
    page.locator("#fullscreenControls #egressOptions"),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(root, "test-results", "egress-ceo-to-site-edge.png"),
  });
  await page.locator("#egressPathsToggle").uncheck();
  await expect(page.locator("#buildingCanvas")).toHaveAttribute(
    "data-egress-paths",
    "false",
  );
  await page.locator("#egressPathsToggle").check();
  await page.locator("#fullscreenBtn").click();
  await page.locator("#roomSelect").selectOption("L1-C01");
  await expect(page.locator("#traceExitBtn")).toBeDisabled();
  await page.locator("#roomSelect").selectOption("G-M01");
  await page.locator("#traceExitBtn").click();
  await expect(page.locator("#egressRouteInfo")).toContainText(
    "dedicated exterior exit",
  );
  await page.locator("#egressPlanBtn").click();
  await page.locator("#floorSelect").selectOption("0");
  await page.locator("#fullscreenBtn").click();
  await page.locator("#egressOptions").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(root, "test-results", "egress-ground-fullscreen.png"),
  });
  await page.locator("#fullscreenBtn").click();
  await page.locator("#egressPathsToggle").uncheck();
  await page.locator("#roomLabelsToggle").check();
  await page.locator("#isoBtn").click();
  console.log(
    "PASS PDF's 57 scheduled signs, sign inspection, route tracing, floor isolation, fullscreen layers and exclusion of lift evacuation",
  );
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
  await page.locator("#fullscreenBtn").click();
  await expect(page.locator("#fullscreenControls #floorSelect")).toBeVisible();
  await page.locator("#fullscreenPanelToggle").click();
  await expect(page.locator("#fullscreenControls")).toBeHidden();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Mobile fullscreen fits",
  );
  await page.locator("#fullscreenBtn").click();
  await expect(page.locator("#viewerPanel")).toHaveAttribute(
    "data-fullscreen",
    "off",
  );
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

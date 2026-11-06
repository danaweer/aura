import assert from "node:assert/strict";
import path from "node:path";
import { expect } from "@playwright/test";

export async function checkNavigation(page, root) {
  const canvas = page.locator("#buildingCanvas");
  const state = () =>
    canvas.evaluate((c) =>
      Object.fromEntries(
        [
          "camera",
          "floor",
          "view",
          "equipmentSelection",
          "serviceLayers",
          "deviceCategories",
          "presentation",
        ].map((k) => [k, c.dataset[k]]),
      ),
    );
  await expect(
    page.locator("#buildingInspector #problemReportForm"),
  ).toHaveCount(0);
  await page.locator("#equipmentOptions summary").click();
  await page.locator("#equipmentSelect").selectOption("AHU-L1-01");
  await page.locator('button[data-presentation="blueprint"]').click();
  const selected = await state();
  await page.locator("#openAssetMaintenance").click();
  await expect(page).toHaveURL(/#maintenance\?.*asset_id=AHU-L1-01/);
  await expect(page.locator("#maintenanceContext")).toContainText("AHU-L1-01");
  await expect(
    page.locator('#problemReportForm [name="asset_id"]'),
  ).toHaveValue("AHU-L1-01");
  await expect(page.locator('#problemReportForm [name="room_id"]')).toHaveValue(
    "L1-M01",
  );
  for (const tab of ["preventive", "predictive", "asset-history"]) {
    await page.locator(`[data-maintenance-tab="${tab}"]`).click();
    await expect(page.locator("#maintenanceFuturePanel")).toContainText(
      "Not implemented",
    );
  }
  await page.locator("#navTwin").click();
  await expect(canvas).toBeVisible();
  assert.deepEqual(await state(), selected);
  await page.locator("#equipmentSelect").selectOption("FP-01");
  const fire = await state();
  await page.locator("#openAssetMaintenance").click();
  await expect(page.locator("#maintenanceContext")).toContainText(
    "Asset FP-01",
  );
  await expect(
    page.locator('#problemReportForm [name="asset_id"]'),
  ).toHaveValue("");
  await expect(page.locator('#problemReportForm [name="room_id"]')).toHaveValue(
    "G-M01",
  );
  await page.locator("#navCalendar").click();
  await expect(page.locator("#plannedPageTitle")).toHaveText("Calendar");
  await expect(page.locator("#plannedPage")).toContainText("Not implemented");
  await page.locator("#navNotifications").click();
  await expect(page.locator("#plannedPageTitle")).toHaveText("Notifications");
  await page.goBack();
  await expect(page.locator("#plannedPageTitle")).toHaveText("Calendar");
  await page.goBack();
  await expect(page.locator("#maintenanceContext")).toContainText(
    "Asset FP-01",
  );
  await page.locator("#navUsers").click();
  await expect(page.locator("#plannedPageTitle")).toHaveText("Users & Access");
  await expect(page.locator("#plannedPage")).toContainText("not implemented");
  await page.locator("#navSensors").click();
  await expect(page.locator("#iotDevicesPage")).toContainText("MXCHIP AZ3166");
  await expect(page.locator("#iotDevicesPage")).toContainText(
    "No IoT devices assigned",
  );
  await page.locator("#navDashboard").click();
  await expect(page.locator("#dashboardProjectCount")).toContainText(
    "2 saved projects",
  );
  await page.screenshot({
    path: path.join(root, "test-results", "navigation-dashboard.png"),
  });
  await page.locator("#navProjects").click();
  await expect(page.locator("#projectsView")).toBeVisible();
  await page.locator("#navTwin").click();
  assert.deepEqual(await state(), fire);
  await page.locator("#equipmentOptions summary").click();
  await page.locator("#buildingViewSelect").selectOption("overview");
  await page.locator('button[data-presentation="normal"]').click();
  // Every destination remains reachable on a narrow display.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#navMaintenance").click();
  await expect(page.locator("#maintenancePage")).toBeVisible();
  await page.locator('[data-maintenance-tab="reports"]').click();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({
    path: path.join(root, "test-results", "navigation-maintenance-mobile.png"),
  });
  await page.locator("#navNotifications").click();
  await expect(page.locator("#plannedPageTitle")).toHaveText("Notifications");
  await page.locator("#navTwin").click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(canvas).toBeVisible();
  console.log(
    "PASS Application destinations, asset/room deep links, browser Back, Work Orders/future sections, mobile navigation and preserved Blueprint/viewer state",
  );
}

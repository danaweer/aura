import assert from "node:assert/strict";
import path from "node:path";
import { expect } from "@playwright/test";

export async function checkMaintenance(page, root, { viewer = true } = {}) {
  const panel = page.locator("#maintenancePanel");
  await page.locator("#navMaintenance").click();
  await expect(
    page.locator('#problemReportForm select[name="room_id"] option'),
  ).toHaveCount(71);
  const spatial = () =>
    page
      .locator("#buildingCanvas")
      .evaluate((c) =>
        Object.fromEntries(
          ["camera", "floor", "view", "serviceLayers", "deviceCategories"].map(
            (k) => [k, c.dataset[k]],
          ),
        ),
      );
  const before = await spatial();
  async function submit(symptom) {
    const form = page.locator("#problemReportForm");
    await form.locator('[name="reporter"]').fill("Office employee");
    await form.locator('[name="asset_id"]').selectOption("");
    await form.locator('[name="room_id"]').selectOption("L1-01");
    await form.locator('[name="symptom"]').fill(symptom);
    await form.locator('[name="impact"]').fill("Team workspace affected");
    await form
      .locator('[name="description"]')
      .fill('Fan noise; <img src=x onerror="window.reportXSS=true">');
    await form.locator('button[type="submit"]').click();
    await expect(page.locator("#maintenanceMessage")).toContainText(
      "saved. Awaiting manager review.",
    );
    return page.locator("#maintenanceReportSelect").inputValue();
  }
  const first = await submit("AHU pilot complaint");
  await expect(page.locator("#maintenanceReportDetail")).toContainText(
    "Equipment unknown",
  );
  await expect(page.locator("#managerTriageForm")).toBeHidden();
  assert.equal(await page.locator("#maintenanceReportDetail img").count(), 0);
  assert.deepEqual(await spatial(), before);
  await page.locator("#maintenancePage").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(root, "test-results", "maintenance-report.png"),
  });
  await page.reload();
  await expect(page.locator("#maintenancePage")).toBeVisible();
  await expect(
    page.locator(`#maintenanceReportSelect option[value="${first}"]`),
  ).toHaveCount(1);
  await page.locator("#maintenanceReportSelect").selectOption(first);
  await page.locator("#maintenanceRole").selectOption("manager");
  const triage = page.locator("#managerTriageForm");
  await expect(triage).toBeVisible();
  if (viewer) {
    await page.locator("#navTwin").click();
    await expect(page.locator("#buildingCanvas")).toHaveAttribute(
      "data-ready",
      "true",
    );
    await page.locator('button[data-presentation="blueprint"]').click();
    await page.locator("#navMaintenance").click();
    await expect(triage).toBeVisible();
  }
  const during = await spatial();
  await triage.locator('[name="priority"]').selectOption("Emergency");
  await expect(page.locator("#maintenanceEmergency")).toContainText(
    "not an emergency dispatch service",
  );
  await triage.locator('[name="priority"]').selectOption("High");
  await triage
    .locator('[name="reason"]')
    .fill("Workspace affected; identify equipment during review");
  await triage.locator('button[type="submit"]').click();
  await expect(page.locator("#maintenanceMessage")).toHaveText(
    "Manager triage saved.",
  );
  await expect(page.locator("#maintenanceReportDetail")).toContainText(
    "Reviewed",
  );
  await triage.locator('[name="asset_id"]').selectOption("AHU-L1-01");
  await triage
    .locator('[name="reason"]')
    .fill("Reviewed and mapped to the pilot AHU");
  await triage.locator('[name="link_mode"]').selectOption("new");
  await triage.locator('button[type="submit"]').click();
  await expect(page.locator("#maintenanceMessage")).toHaveText(
    "Manager triage saved.",
  );
  await expect(page.locator("#maintenanceReportDetail")).toContainText(
    "Triaged · High",
  );
  const response = await page.request.get(
    new URL(
      `/api/maintenance/reports/${first}?project_id=atrium-building`,
      page.url(),
    ).href,
  );
  const detail = await response.json(),
    order = detail.work_order;
  assert.ok(order.work_order_id);
  const second = await submit("Related complaint from same office");
  await expect(triage).toBeVisible();
  await triage.locator('[name="asset_id"]').selectOption("AHU-L1-01");
  await triage.locator('[name="priority"]').selectOption("High");
  await triage
    .locator('[name="reason"]')
    .fill("Related report: keep both observations on one job");
  await triage.locator('[name="link_mode"]').selectOption("existing");
  await triage
    .locator('[name="work_order_id"]')
    .selectOption(order.work_order_id);
  await triage.locator('button[type="submit"]').click();
  await expect(page.locator("#maintenanceMessage")).toHaveText(
    "Manager triage saved.",
  );
  const linked = await (
    await page.request.get(
      new URL(
        `/api/maintenance/reports/${second}?project_id=atrium-building`,
        page.url(),
      ).href,
    )
  ).json();
  assert.equal(linked.report.work_order_id, order.work_order_id);
  assert.deepEqual(await spatial(), during);
  if (viewer)
    await expect(page.locator("#buildingCanvas")).toHaveAttribute(
      "data-presentation",
      "blueprint",
    );
  assert.equal(await page.evaluate(() => window.reportXSS), undefined);
  await page.locator("#maintenanceReportDetail").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(root, "test-results", "maintenance-triage.png"),
  });
  await page.locator('[data-maintenance-tab="work-orders"]').click();
  await page
    .locator("#maintenanceWorkOrderSelect")
    .selectOption(order.work_order_id);
  await expect(page.locator("#maintenanceWorkOrderDetail")).toContainText(
    order.work_order_id,
  );
  await expect(page.locator("#maintenanceWorkOrderDetail button")).toHaveCount(
    2,
  );
  await page.locator("#maintenanceWorkOrderDetail button").first().click();
  await expect(page.locator("#maintenanceReportsPanel")).toBeVisible();
  await expect(page.locator("#maintenanceReportDetail")).toContainText(
    order.work_order_id,
  );
  await page.locator("#maintenanceRole").selectOption("employee");
  if (viewer) {
    await page.locator("#navTwin").click();
    await expect(page.locator("#buildingCanvas")).toBeVisible();
    assert.deepEqual(await spatial(), during);
    await page.locator('button[data-presentation="normal"]').click();
  }
  console.log(
    `PASS Room-only reporting, persisted reload, manager review/priority, AHU mapping, shared work-order linking and safe text${viewer ? ", with unchanged viewer state" : ""}`,
  );
}

export async function checkMaintenanceRefinement(page, root) {
  await page.locator("#navMaintenance").click();
  await expect(page.locator("#maintenanceOverview")).toHaveAttribute(
    "data-state",
    "available",
  );
  const values = await page
    .locator(".maintenance-metric strong")
    .allTextContents();
  assert.deepEqual(
    values,
    ["2", "0", "1", "2"],
    "Summary reflects the two saved/linked reports and single open job from this fixture",
  );
  await expect(page.locator(".maintenance-report-preview")).toHaveCount(2);
  await page.locator(".maintenance-report-preview").first().click();
  await expect(
    page.locator(".maintenance-report-preview").first(),
  ).toHaveAttribute("aria-pressed", "true");
  await page.locator("#maintenanceReportAction").click();
  await expect(
    page.locator('#problemReportForm [name="symptom"]'),
  ).toBeFocused();
  const cards = await page
    .locator(".maintenance-report-layout > .maintenance-card")
    .evaluateAll((elements) =>
      elements.map((e) => ({
        x: e.getBoundingClientRect().x,
        y: e.getBoundingClientRect().y,
        width: e.getBoundingClientRect().width,
      })),
    );
  assert.ok(
    cards[1].x > cards[0].x && Math.abs(cards[0].y - cards[1].y) < 2,
    "Desktop workspace is two aligned columns",
  );
  const rail = page.locator(".navrail");
  let box = await rail.boundingBox();
  assert.ok(
    Math.abs(box.y - 74) < 2 && Math.abs(box.y + box.height - 1000) < 2,
    "Sidebar fills available desktop height",
  );
  await page.locator("#maintenancePage").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(root, "test-results", "maintenance-refined-desktop.png"),
  });
  await page.setViewportSize({ width: 1440, height: 480 });
  const scroll = await rail.evaluate((e) => {
    const before = scrollY;
    e.scrollTop = e.scrollHeight;
    return {
      before,
      after: scrollY,
      scrollTop: e.scrollTop,
      scrollHeight: e.scrollHeight,
      clientHeight: e.clientHeight,
    };
  });
  assert.ok(
    scroll.scrollHeight > scroll.clientHeight && scroll.scrollTop > 0,
    "Short screens scroll the sidebar independently",
  );
  assert.equal(scroll.before, scroll.after);
  await page.locator("#navNotifications").focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.locator("#navUsers")).toBeFocused();
  const focus = await page.locator("#navUsers").evaluate((e) => ({
    outline: getComputedStyle(e).outlineStyle,
    bottom: e.getBoundingClientRect().bottom,
  }));
  assert.equal(focus.outline, "solid");
  assert.ok(focus.bottom <= 480);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#navMaintenance").click();
  await expect(page.locator("#maintenanceOverview")).toHaveAttribute(
    "data-state",
    "available",
  );
  const mobileCards = await page
    .locator(".maintenance-report-layout > .maintenance-card")
    .evaluateAll((elements) =>
      elements.map((e) => ({
        x: e.getBoundingClientRect().x,
        y: e.getBoundingClientRect().y,
      })),
    );
  assert.ok(
    Math.abs(mobileCards[0].x - mobileCards[1].x) < 2 &&
      mobileCards[1].y > mobileCards[0].y,
    "Mobile workspace stacks into one column",
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.locator("#maintenancePage").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(root, "test-results", "maintenance-refined-mobile.png"),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await rail.evaluate((e) => (e.scrollTop = 0));
  console.log(
    "PASS Maintenance density, real summary counts, report previews, primary-action focus, full-height/sidebar scrolling and responsive cards",
  );
}

/* Local corrective reporting/triage only; no viewer state changes or telemetry. */
const PROJECT = "atrium-building";
const $ = (id) => document.getElementById(id);
export class MaintenancePanel {
  constructor() {
    this.root = $("maintenancePanel");
    this.reportForm = $("problemReportForm");
    this.triageForm = $("managerTriageForm");
    this.active = false;
    this.context = null;
    this.current = null;
    this.workOrders = [];
    this.requestKey = null;
    this.busy = false;
    this.generation = 0;
    $("maintenanceReportAction").onclick = () => {
      this.setTab("reports");
      this.reportForm.scrollIntoView({ block: "nearest" });
      this.reportForm.elements.symptom.focus({ preventScroll: true });
    };
    this.routeAssetId = null;
    this.reports = [];
    for (const button of this.root.querySelectorAll("[data-maintenance-tab]"))
      button.onclick = () => this.setTab(button.dataset.maintenanceTab);
    $("maintenanceWorkOrderSelect").onchange = () => this.renderOrder();
    $("maintenanceRefresh").onclick = () => this.refresh();
    $("maintenanceRole").onchange = () => this.reviewVisibility();
    $("maintenanceReportSelect").onchange = () =>
      this.loadReport($("maintenanceReportSelect").value);
    $("maintenanceUseSelection").onclick = () => this.useSelection();
    $("maintenanceNewDraft").onclick = () => {
      if (this.busy) return;
      this.reportForm.reset();
      this.requestKey = null;
      this.setObservedNow();
      try {
        sessionStorage.removeItem("aura-maintenance-report-draft");
      } catch {
        /* optional storage */
      }
      this.emergencyVisibility();
      this.message("New report draft ready.");
    };
    this.reportForm.onsubmit = (event) => {
      event.preventDefault();
      this.submit();
    };
    this.triageForm.onsubmit = (event) => {
      event.preventDefault();
      this.triage();
    };
    this.triageForm.elements.link_mode.onchange = () => this.reviewVisibility();
    this.reportForm.elements.potential_hazard.onchange = () =>
      this.emergencyVisibility();
    this.triageForm.elements.priority.onchange = () =>
      this.emergencyVisibility();
    // Retain a submission key and its exact draft after a lost response/reload.
    try {
      const saved = JSON.parse(
        sessionStorage.getItem("aura-maintenance-report-draft"),
      );
      if (saved?.request_key) {
        this.requestKey = saved.request_key;
        for (const [key, value] of Object.entries(saved)) {
          const input = this.reportForm.elements.namedItem(key);
          if (input && key !== "room_id")
            input.type === "checkbox"
              ? (input.checked = value)
              : (input.value = value);
        }
        this.savedRoom = saved.room_id;
      }
    } catch {
      /* Storage can be unavailable; in-memory retry remains available. */
    }
    if (!this.reportForm.elements.observed_at.value) this.setObservedNow();
    window.addEventListener("online", () => {
      if (this.active) this.refresh();
    });
  }
  setObservedNow() {
    const now = new Date();
    this.reportForm.elements.observed_at.value = new Date(
      now.getTime() - now.getTimezoneOffset() * 60000,
    )
      .toISOString()
      .slice(0, 16);
  }
  setActive(active) {
    this.active = active;
    if (!active) {
      this.generation++;
    }
    if (active) this.refresh();
  }
  setContext(part) {
    this.context = part;
    const id = part?.equipmentId || part?.anchorAssetId || part?.assetId;
    $("maintenanceSelectionContext").textContent =
      id || part?.roomId || "Reports and corrective work";
    $("openAssetMaintenance").textContent = id
      ? `Open maintenance · ${id}`
      : "Open maintenance";
  }
  open(params = {}) {
    const project = params.project_id || PROJECT;
    const supported = project === PROJECT;
    this.root.hidden = !supported;
    $("maintenanceOverview").hidden = !supported;
    $("maintenanceReportAction").disabled = !supported;
    $("maintenanceUsePilot").hidden = supported;
    this.routeAssetId = params.asset_id || null;
    this.pendingContext = params;
    $("maintenanceContext").textContent = !supported
      ? `Project ${project}: maintenance reporting is currently available in the Atrium building pilot.`
      : this.routeAssetId
        ? `Asset ${this.routeAssetId}${params.room_id ? ` · Room ${params.room_id}` : ""}. ${this.routeAssetId === "AHU-L1-01" ? "AHU corrective maintenance pilot." : "Corrective equipment reporting currently supports AHU-L1-01; you can submit an observation against this room with equipment unknown."}`
        : "Atrium building / 01 · Reports and corrective work orders. Equipment can be unknown when reporting by room.";
    this.setTab(params.section || "reports");
    this.setActive(supported);
  }
  setTab(tab) {
    const future = {
      preventive: "Preventive maintenance",
      predictive: "Predictive maintenance",
      "asset-history": "Asset maintenance history",
    };
    if (!["reports", "work-orders", ...Object.keys(future)].includes(tab))
      tab = "reports";
    this.root.dataset.section = tab;
    for (const button of this.root.querySelectorAll("[data-maintenance-tab]"))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.maintenanceTab === tab),
      );
    $("maintenanceReportsPanel").hidden = tab !== "reports";
    $("maintenanceWorkOrdersPanel").hidden = tab !== "work-orders";
    $("maintenanceFuturePanel").hidden = !future[tab];
    $("maintenanceFutureTitle").textContent = future[tab] || "";
  }
  renderOrders() {
    const select = $("maintenanceWorkOrderSelect"),
      previous = select.value;
    const orders = this.workOrders.filter(
      (w) => !this.routeAssetId || w.asset_id === this.routeAssetId,
    );
    select.replaceChildren(
      new Option(
        orders.length
          ? "Select a work order…"
          : "No work orders returned for this asset / pilot",
        "",
      ),
      ...orders.map(
        (w) =>
          new Option(
            `${w.work_order_id.slice(0, 8)} · ${w.asset_id} · ${w.state} · ${w.priority} · ${w.title}`,
            w.work_order_id,
          ),
      ),
    );
    select.value = orders.some((w) => w.work_order_id === previous)
      ? previous
      : "";
    this.renderOrder();
  }
  renderOrder() {
    const order = this.workOrders.find(
      (w) => w.work_order_id === $("maintenanceWorkOrderSelect").value,
    );
    const detail = $("maintenanceWorkOrderDetail");
    detail.replaceChildren();
    if (!order) return;
    const reports = this.reports.filter(
      (r) => r.work_order_id === order.work_order_id,
    );
    for (const text of [
      `${order.work_order_id} · ${order.asset_id}`,
      order.title,
      `${order.state} · ${order.priority} · ${order.action_type} · ${order.origin}`,
      `Created ${new Date(order.created_at).toLocaleString()} · ${order.created_by}`,
      order.description,
      `Linked reports in the current report list: ${reports.length}`,
    ]) {
      const p = document.createElement("p");
      p.textContent = text;
      detail.append(p);
    }
    for (const report of reports) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `Open report ${report.report_id.slice(0, 8)} · ${report.symptom}`;
      button.onclick = () => {
        this.setTab("reports");
        $("maintenanceReportSelect").value = report.report_id;
        this.loadReport(report.report_id);
      };
      detail.append(button);
    }
  }
  message(text) {
    $("maintenanceMessage").textContent = text;
  }
  renderOverview(data) {
    const available = Boolean(data);
    $("maintenanceOverview").dataset.state = available
      ? "available"
      : "unavailable";
    const values = available
      ? {
          maintenanceMetricReports: data.reports.length,
          maintenanceMetricReview: data.reports.filter(
            (r) => r.status === "Submitted",
          ).length,
          maintenanceMetricOrders: data.work_orders.filter(
            (w) =>
              !["Completed", "Verified/Closed", "Cancelled"].includes(w.state),
          ).length,
          maintenanceMetricLinked: data.reports.filter((r) => r.work_order_id)
            .length,
        }
      : {};
    for (const id of [
      "maintenanceMetricReports",
      "maintenanceMetricReview",
      "maintenanceMetricOrders",
      "maintenanceMetricLinked",
    ])
      $(id).textContent = available ? String(values[id]) : "—";
    $("maintenanceReportCount").textContent = available
      ? String(data.reports.length)
      : "—";
  }
  renderRecentReports() {
    const list = $("maintenanceRecentReports");
    list.replaceChildren();
    if (!this.reports.length) {
      const empty = document.createElement("div");
      empty.className = "maintenance-empty-state";
      const title = document.createElement("strong"),
        description = document.createElement("p");
      title.textContent = "No reports yet";
      description.textContent =
        "Submitted observations will appear here for review.";
      empty.append(title, description);
      list.append(empty);
      return;
    }
    for (const report of this.reports.slice(0, 3)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "maintenance-report-preview";
      button.dataset.reportId = report.report_id;
      const top = document.createElement("span"),
        id = document.createElement("span"),
        status = document.createElement("span");
      top.className = "maintenance-preview-meta";
      id.textContent = report.report_id.slice(0, 8);
      status.textContent = report.status;
      status.className = "maintenance-preview-status";
      top.append(id, status);
      const symptom = document.createElement("strong"),
        context = document.createElement("span");
      symptom.textContent = report.symptom;
      context.className = "maintenance-preview-context";
      context.textContent = `${report.room_id} · ${report.priority || "Awaiting review"}`;
      button.append(top, symptom, context);
      button.onclick = () => {
        $("maintenanceReportSelect").value = report.report_id;
        this.loadReport(report.report_id);
      };
      list.append(button);
    }
    this.markRecentSelection($("maintenanceReportSelect").value);
  }
  markRecentSelection(id) {
    for (const button of $("maintenanceRecentReports").querySelectorAll(
      "[data-report-id]",
    ))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.reportId === id),
      );
  }
  async api(path, body) {
    const response = await fetch(`/api/maintenance/${path}`, {
      cache: "no-store",
      ...(body
        ? {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-AURA-Demo-Role": $("maintenanceRole").value,
            },
            body: JSON.stringify(body),
          }
        : {}),
    });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error || "Maintenance request failed");
      error.status = response.status;
      throw error;
    }
    return result;
  }
  async refresh() {
    if (!this.active || this.busy) return;
    const generation = ++this.generation;
    this.message("Loading reports…");
    try {
      const data = await this.api(`overview?project_id=${PROJECT}`);
      if (generation !== this.generation || !this.active) return;
      const roomSelect = this.reportForm.elements.room_id,
        room = this.savedRoom || roomSelect.value;
      roomSelect.replaceChildren(
        new Option("Select a room…", ""),
        ...data.rooms.map(
          (r) => new Option(`${r.room_id} · ${r.name}`, r.room_id),
        ),
      );
      roomSelect.value = room;
      this.savedRoom = null;
      if (this.pendingContext) {
        const context = this.pendingContext;
        if (!this.requestKey) {
          if (context.room_id) roomSelect.value = context.room_id;
          else if (context.asset_id === "AHU-L1-01")
            roomSelect.value =
              data.assets.find((a) => a.asset_id === context.asset_id)
                ?.room_id || "";
          if (context.asset_id)
            this.reportForm.elements.asset_id.value =
              context.asset_id === "AHU-L1-01" ? context.asset_id : "";
        }
        this.pendingContext = null;
      }
      $("maintenanceEmergency").textContent = data.emergency_instruction;
      this.workOrders = data.work_orders;
      this.reports = data.reports;
      this.renderOverview(data);
      this.renderRecentReports();
      this.renderOrders();
      const select = $("maintenanceReportSelect"),
        selected = select.value;
      select.replaceChildren(
        new Option(
          data.reports.length ? "Select a report…" : "No reports yet",
          "",
        ),
        ...data.reports.map(
          (r) =>
            new Option(
              `${r.report_id.slice(0, 8)} · ${r.room_id} · ${r.status} · ${r.priority || "Untriaged"} · ${r.symptom}`,
              r.report_id,
            ),
        ),
      );
      select.value = data.reports.some((r) => r.report_id === selected)
        ? selected
        : "";
      this.message(`${data.reports.length} recent reports loaded.`);
      if (select.value) await this.loadReport(select.value);
      else {
        this.current = null;
        $("maintenanceReportDetail").replaceChildren();
        this.reviewVisibility();
      }
      this.emergencyVisibility();
    } catch (error) {
      if (generation === this.generation) {
        this.renderOverview(null);
        this.message(`Could not load maintenance: ${error.message}`);
      }
    }
  }
  async loadReport(id) {
    const generation = ++this.generation;
    this.current = null;
    this.reviewVisibility();
    if (!id) {
      $("maintenanceReportDetail").replaceChildren();
      return;
    }
    try {
      const data = await this.api(
        `reports/${encodeURIComponent(id)}?project_id=${PROJECT}`,
      );
      if (generation !== this.generation || !this.active) return;
      this.current = data.report;
      this.markRecentSelection(data.report.report_id);
      const r = data.report,
        detail = $("maintenanceReportDetail");
      detail.replaceChildren();
      for (const text of [
        `Report ${r.report_id} · ${r.status} · version ${r.version}`,
        `${r.reporter} · ${r.room_id} · observed ${new Date(r.observed_at).toLocaleString()}`,
        `Originally reported equipment: ${r.reported_asset_id || "Equipment unknown"}. Current mapping: ${r.asset_id || "Unmapped"}.`,
        `Symptom: ${r.symptom}`,
        `Impact: ${r.impact}`,
        r.description,
        r.potential_hazard
          ? "Reporter flagged a possible immediate hazard."
          : "",
        r.priority
          ? `Manager priority: ${r.priority}. Review: ${r.triage_reason}`
          : "Awaiting manager review.",
        data.work_order
          ? `Work order ${data.work_order.work_order_id} · ${data.work_order.asset_id} · ${data.work_order.state} · ${data.work_order.priority}`
          : "No work order linked.",
      ].filter(Boolean)) {
        const p = document.createElement("p");
        p.textContent = text;
        detail.append(p);
      }
      const history = document.createElement("details"),
        summary = document.createElement("summary"),
        list = document.createElement("ol");
      summary.textContent = "Report history";
      for (const event of data.events) {
        const li = document.createElement("li");
        li.textContent = `${new Date(event.at).toLocaleString()} · ${event.actor} · ${event.action} · ${event.reason}`;
        list.append(li);
      }
      history.append(summary, list);
      detail.append(history);
      this.triageForm.elements.asset_id.value = r.asset_id || "";
      this.triageForm.elements.priority.value = r.priority || "Normal";
      this.triageForm.elements.reason.value = "";
      this.triageForm.elements.link_mode.value = "review";
      this.triageForm.elements.work_order_id.replaceChildren(
        new Option("Select related work order…", ""),
        ...this.workOrders
          .filter(
            (w) =>
              !["Completed", "Verified/Closed", "Cancelled"].includes(w.state),
          )
          .map(
            (w) =>
              new Option(
                `${w.work_order_id.slice(0, 8)} · ${w.title} · ${w.priority}`,
                w.work_order_id,
              ),
          ),
      );
      this.reviewVisibility();
    } catch (error) {
      if (generation === this.generation) this.message(error.message);
    }
  }
  reviewVisibility() {
    this.triageForm.hidden =
      !this.current ||
      this.current.status === "Linked" ||
      $("maintenanceRole").value !== "manager";
    $("maintenanceExistingLabel").hidden =
      this.triageForm.elements.link_mode.value !== "existing";
    this.triageForm.elements.work_order_id.required =
      !this.triageForm.hidden && !$("maintenanceExistingLabel").hidden;
    this.emergencyVisibility();
  }
  emergencyVisibility() {
    $("maintenanceEmergency").hidden = !(
      this.reportForm.elements.potential_hazard.checked ||
      this.current?.potential_hazard ||
      this.current?.priority === "Emergency" ||
      (!this.triageForm.hidden &&
        this.triageForm.elements.priority.value === "Emergency")
    );
  }
  useSelection() {
    const part = this.context;
    if (!part?.roomId) {
      this.message("Select a room or the AHU in the building first.");
      return;
    }
    const select = this.reportForm.elements.room_id;
    if (![...select.options].some((o) => o.value === part.roomId)) {
      this.message("Selected object has no reportable room location.");
      return;
    }
    select.value = part.roomId;
    this.reportForm.elements.asset_id.value = [
      part.assetId,
      part.equipmentId,
    ].includes("AHU-L1-01")
      ? "AHU-L1-01"
      : "";
    this.message("Report location copied from the model selection.");
  }
  async submit() {
    if (this.busy || !this.reportForm.reportValidity()) return;
    const draft = Object.fromEntries(new FormData(this.reportForm));
    draft.potential_hazard = this.reportForm.elements.potential_hazard.checked;
    draft.asset_id = draft.asset_id || null;
    this.requestKey ||= crypto.randomUUID();
    draft.request_key = this.requestKey;
    try {
      sessionStorage.setItem(
        "aura-maintenance-report-draft",
        JSON.stringify(draft),
      );
    } catch {
      /* Retry key stays in memory. */
    }
    const payload = {
      ...draft,
      project_id: PROJECT,
      observed_at: new Date(draft.observed_at).toISOString(),
    };
    this.busy = true;
    this.reportForm.querySelector('button[type="submit"]').disabled = true;
    try {
      const data = await this.api("reports", payload);
      this.requestKey = null;
      try {
        sessionStorage.removeItem("aura-maintenance-report-draft");
      } catch {
        /* optional storage */
      }
      this.reportForm.reset();
      this.setObservedNow();
      this.busy = false;
      await this.refresh();
      $("maintenanceReportSelect").value = data.report.report_id;
      await this.loadReport(data.report.report_id);
      this.message(
        `Report ${data.report.report_id.slice(0, 8)} saved. Awaiting manager review.`,
      );
    } catch (error) {
      this.message(
        `${error.message}. Your report has not been cleared; retry retains its submission key.`,
      );
    } finally {
      this.busy = false;
      this.reportForm.querySelector('button[type="submit"]').disabled = false;
    }
  }
  async triage() {
    if (this.busy || !this.current || !this.triageForm.reportValidity()) return;
    const values = Object.fromEntries(new FormData(this.triageForm)),
      order = this.workOrders.find(
        (w) => w.work_order_id === values.work_order_id,
      );
    const payload = {
      project_id: PROJECT,
      expected_version: this.current.version,
      priority: values.priority,
      reason: values.reason,
      asset_id: values.asset_id || null,
      link_mode: values.link_mode,
    };
    if (values.link_mode === "existing") {
      payload.work_order_id = values.work_order_id;
      payload.expected_work_order_version = order?.version;
    }
    const id = this.current.report_id;
    this.busy = true;
    this.triageForm.querySelector('button[type="submit"]').disabled = true;
    try {
      await this.api(`reports/${encodeURIComponent(id)}/triage`, payload);
      this.busy = false;
      await this.refresh();
      this.message("Manager triage saved.");
    } catch (error) {
      this.message(
        error.status === 409
          ? `${error.message}. Refresh reports to review the latest version.`
          : error.message,
      );
    } finally {
      this.busy = false;
      this.triageForm.querySelector('button[type="submit"]').disabled = false;
    }
  }
}

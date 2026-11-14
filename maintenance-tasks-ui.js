import { authState, authFetch, can } from "./auth-ui.js";
const $ = (id) => document.getElementById(id);
export const taskStatus = (order) =>
  order.state === "Completed"
    ? "Completed — awaiting verification"
    : order.state;
const stamp = (value) =>
  value ? new Date(value).toLocaleString() : "Not recorded";
async function api(path, body) {
  const response = await authFetch(`/api/maintenance/${path}`, {
    cache: "no-store",
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Task request failed");
  return data;
}
export class WorkOrderPanel {
  constructor(onLocate, onUpdated) {
    this.onLocate = onLocate;
    this.onUpdated = onUpdated;
    this.generation = 0;
    this.root = document.createElement("section");
    this.root.className = "task-detail maintenance-card";
    this.root.innerHTML = `<h3 class="task-title">Task details</h3><p class="task-meta"></p>
      <p class="task-status"></p><p class="task-description"></p><p class="task-asset-state"></p>
      <div class="task-toolbar"><button type="button" data-command="locate">Locate in 3D</button><button type="button" data-command="refresh">Reload task</button></div>
      <p class="task-message" role="status" aria-live="polite"></p>
      <form class="task-assignment" hidden><h3>Assign technician</h3><label>Technician<select name="assignee_id" required></select></label><label>Due date (optional, local time)<input name="due_at" type="datetime-local" /></label><label>Assignment / deadline reason<textarea name="note" required maxlength="10000"></textarea></label><button type="submit">Assign work order</button></form>
      <div class="task-actions" hidden><button type="button" data-action="acknowledge">Acknowledge assignment</button><button type="button" data-action="start">Start work</button><button type="button" data-action="wait_parts">Waiting for parts</button><button type="button" data-action="wait_access">Waiting for access</button><button type="button" data-action="resume">Resume work</button></div>
      <form class="task-work" hidden><h3>Work record</h3>
        <label>Findings<textarea name="findings" required maxlength="10000"></textarea></label>
        <label>Cause<select name="cause_status" required><option value="">Select a cause outcome…</option>Diagnosed</option><option>Undetermined</option></select></label>
        <label>Diagnosis / investigation outcome<textarea name="diagnosis" required maxlength="10000"></textarea></label>
        <label>Repair action<textarea name="repair_action" maxlength="10000"></textarea></label>
        <label>Materials used (state “None” if none)<textarea name="materials_used" maxlength="10000"></textarea></label>
        <label>Actual work duration (minutes)<input name="work_duration_minutes" type="number" min="0" max="1000000" step="1" value="0" required /></label>
        <label>Post-work checks and observed results<textarea name="post_work_checks" maxlength="10000"></textarea></label>
        <label>Post-work result<select name="post_work_result"><option value="">Not checked yet</option><option>Passed</option><option>Not restored</option></select></label>
        <div class="task-toolbar"><button type="submit" value="record">Save work record</button><button type="submit" value="complete">Submit completed — awaiting verification</button></div>
      </form>
      <label class="task-note-label">Work note (required for waiting, resume, records and completion)<textarea class="task-note" maxlength="10000"></textarea></label>
      <details class="task-record-summary"><summary>Saved work record</summary><div></div></details>
      <form class="task-review" hidden><h3>Manager verification</h3><p>Review the saved work and post-work checks before deciding.</p><label>Review note<textarea name="note" required maxlength="10000"></textarea></label><div class="task-toolbar"><button type="submit" value="verify">Verify &amp; close</button><button type="submit" value="return_rework">Return for rework</button></div></form>
      <p class="task-review-result" hidden></p>
      <details class="task-history" open><summary>Timestamped task history</summary><div></div></details>`;
    this.q = (selector) => this.root.querySelector(selector);
    this.root.insertBefore(this.q(".task-note-label"), this.q(".task-actions"));
    this.q('[data-command="locate"]').onclick = () => this.onLocate(this.asset);
    this.q('[data-command="refresh"]').onclick = () =>
      this.open(this.order, this.root.parentElement);
    this.root
      .querySelectorAll("[data-action]")
      .forEach(
        (button) => (button.onclick = () => this.act(button.dataset.action)),
      );
    this.q(".task-assignment").onsubmit = (event) => {
      event.preventDefault();
      const f = event.currentTarget;
      this.act("assign", {
        assignee_id: f.elements.assignee_id.value,
        due_at: f.elements.due_at.value
          ? new Date(f.elements.due_at.value).toISOString()
          : null,
        note: f.elements.note.value,
      });
    };
    this.q(".task-work").onsubmit = (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget));
      values.work_duration_minutes = Number(values.work_duration_minutes);
      values.post_work_result ||= null;
      this.act(event.submitter?.value || "record", values);
    };
    this.q(".task-review").onsubmit = (event) => {
      event.preventDefault();
      if (!event.submitter) return;
      this.act(event.submitter.value, {
        note: event.currentTarget.elements.note.value,
      });
    };
  }
  close() {
    this.generation++;
    this.root.remove();
  }
  async open(order, mount) {
    if (this.busy) return;
    const generation = ++this.generation;
    this.order = order;
    mount.append(this.root);
    this.root.hidden = true;
    this.q(".task-title").textContent = "Loading task…";
    for (const selector of [
      ".task-meta",
      ".task-status",
      ".task-description",
      ".task-asset-state",
      ".task-message",
    ])
      this.q(selector).textContent = "";
    this.q(".task-history div").replaceChildren();
    this.q(".task-record-summary div").replaceChildren();
    this.q('[data-command="locate"]').disabled = true;
    this.q(".task-assignment").reset();
    this.q(".task-work").reset();
    this.q(".task-review").reset();
    this.q(".task-review").hidden = true;
    this.q(".task-review-result").hidden = true;
    try {
      const data = await api(
        `work-orders/${order.work_order_id}?project_id=${encodeURIComponent(order.project_id)}`,
      );
      let technicians = [];
      if (
        can("triage_reports") &&
        ["Triaged", "Assigned"].includes(data.work_order.state)
      )
        technicians = (
          await api(
            `technicians?project_id=${encodeURIComponent(order.project_id)}`,
          )
        ).technicians;
      if (generation !== this.generation) return;
      this.order = data.work_order;
      this.asset = data.asset;
      this.q('[data-command="locate"]').disabled = false;
      const w = this.order;
      this.q(".task-title").textContent = w.title;
      this.q(".task-meta").textContent =
        `${w.work_order_id} · ${w.asset_id} · ${data.asset.name} · Floor ${data.asset.floor}, room ${data.asset.room_id} · ${w.priority} priority`;
      this.q(".task-status").textContent =
        `${taskStatus(w)} · Assigned ${stamp(w.assigned_at)} · Due ${w.due_at ? stamp(w.due_at) : "Not set"}${w.acknowledged_at ? ` · Acknowledged ${stamp(w.acknowledged_at)}` : ""}${w.closed_at ? ` · Closed ${stamp(w.closed_at)}` : ""}`;
      this.root.dataset.state = w.state;
      this.q(".task-description").textContent = w.description;
      this.q(".task-asset-state").textContent =
        `Asset: ${data.asset.design_state} · ${data.asset.commissioning_state === "not_connected" ? "Not connected — integration planned" : data.asset.commissioning_state}`;
      this.q(".task-message").textContent = "";
      this.q(".task-note").value = "";
      const assignment = this.q(".task-assignment");
      assignment.hidden =
        !can("triage_reports") || !["Triaged", "Assigned"].includes(w.state);
      assignment.elements.assignee_id.replaceChildren(
        new Option("Select an authorized technician…", ""),
        ...technicians.map(
          (t) => new Option(`${t.name} · ${t.username}`, t.user_id),
        ),
      );
      assignment.elements.assignee_id.value = w.assignee_id || "";
      assignment.elements.note.value = "";
      assignment.elements.due_at.value = w.due_at
        ? new Date(
            new Date(w.due_at).getTime() -
              new Date(w.due_at).getTimezoneOffset() * 60000,
          )
            .toISOString()
            .slice(0, 16)
        : "";
      const tech = authState.user.role === "technician";
      this.q(".task-actions").hidden = !tech;
      for (const button of this.root.querySelectorAll("[data-action]")) {
        const action = button.dataset.action;
        button.hidden = !(
          (action === "acknowledge" &&
            w.state === "Assigned" &&
            !w.acknowledged_at) ||
          (action === "start" && w.state === "Assigned" && w.acknowledged_at) ||
          (["wait_parts", "wait_access"].includes(action) &&
            w.state === "In progress") ||
          (action === "resume" && w.state.startsWith("Waiting for"))
        );
      }
      const work = this.q(".task-work");
      work.hidden =
        !tech ||
        !["In progress", "Waiting for parts", "Waiting for access"].includes(
          w.state,
        );
      for (const element of work.elements)
        if (element.name) element.value = w[element.name] ?? "";
      work.querySelector('[value="complete"]').hidden =
        w.state !== "In progress";
      this.q(".task-note-label").hidden =
        !tech ||
        ["Completed", "Verified/Closed", "Cancelled"].includes(w.state);
      const completion = [...data.events]
        .reverse()
        .find((event) => event.action === "complete");
      this.q(".task-review").hidden =
        !can("triage_reports") ||
        w.state !== "Completed" ||
        w.assignee_id === authState.user.user_id ||
        completion?.actor === authState.user.user_id;
      const reviewLabels = {
        verify: "Verified & closed",
        return_rework: "Returned for rework",
      };
      const review = [...data.events]
        .reverse()
        .find((event) => Object.hasOwn(reviewLabels, event.action));
      this.q(".task-review-result").hidden = !review;
      this.q(".task-review-result").textContent = review
        ? `${reviewLabels[review.action]} · ${stamp(review.at)} · ${review.actor_name || review.actor} · ${review.after.note}`
        : "";
      this.q(".task-record-summary").open = [
        "Completed",
        "Verified/Closed",
      ].includes(w.state);
      const saved = this.q(".task-record-summary div");
      saved.replaceChildren();
      for (const [name, label] of Object.entries({
        findings: "Findings",
        cause_status: "Cause",
        diagnosis: "Diagnosis / investigation outcome",
        repair_action: "Repair action",
        materials_used: "Materials",
        work_duration_minutes: "Actual work minutes",
        post_work_checks: "Post-work checks",
        post_work_result: "Post-work result",
      })) {
        const p = document.createElement("p");
        p.textContent = `${label}: ${w[name] ?? "Not recorded"}`;
        saved.append(p);
      }
      const history = this.q(".task-history div");
      history.replaceChildren();
      for (const event of data.events) {
        const p = document.createElement("p");
        p.textContent = `${stamp(event.at)} · ${event.actor_name || event.actor} (${event.actor}) · ${reviewLabels[event.action] || event.action}${event.after.note || event.after.body ? ` · ${event.after.note || event.after.body}` : ""}`;
        history.append(p);
        if (["record", "complete"].includes(event.action)) {
          const details = document.createElement("details"),
            summary = document.createElement("summary"),
            content = document.createElement("p");
          summary.textContent = "Work record at this action";
          content.textContent = Object.entries(event.after.work_order)
            .filter(([key]) =>
              [
                "findings",
                "cause_status",
                "diagnosis",
                "repair_action",
                "materials_used",
                "work_duration_minutes",
                "post_work_checks",
                "post_work_result",
              ].includes(key),
            )
            .map(([key, value]) => `${key}: ${value ?? "Not recorded"}`)
            .join("\n");
          details.append(summary, content);
          history.append(details);
        }
      }
      this.root.hidden = false;
    } catch (error) {
      if (generation !== this.generation) return;
      this.root.hidden = false;
      this.q(".task-title").textContent = "Task unavailable";
      this.q(".task-message").textContent = error.message;
      for (const selector of [
        ".task-assignment",
        ".task-actions",
        ".task-work",
        ".task-note-label",
        ".task-review",
      ])
        this.q(selector).hidden = true;
    }
  }
  async act(action, fields = {}) {
    if (this.busy) return;
    this.busy = true;
    const order = this.order;
    const generation = this.generation;
    this.root.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      const data = await api(`work-orders/${order.work_order_id}/actions`, {
        project_id: order.project_id,
        expected_version: order.version,
        action,
        note: this.q(".task-note").value,
        ...fields,
      });
      this.onUpdated(data.work_order);
      this.busy = false;
      if (generation === this.generation && this.root.isConnected) {
        await this.open(data.work_order, this.root.parentElement);
        this.q(".task-message").textContent = "Action saved.";
      }
    } catch (error) {
      if (generation === this.generation)
        this.q(".task-message").textContent =
          `${error.message}. Notes retained; reload if the task changed.`;
    } finally {
      this.busy = false;
      this.root.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
  }
}

export class MyTasksView {
  constructor(panel) {
    this.panel = panel;
    this.orders = [];
    this.selected = null;
    this.generation = 0;
  }
  close() {
    this.generation++;
  }
  async refresh() {
    if (this.panel.busy) return;
    const generation = ++this.generation;
    $("myTasksMessage").textContent = "Loading assigned work…";
    try {
      const data = await api("my-tasks");
      if (generation !== this.generation) return;
      this.orders = data.work_orders;
      this.render();
      const selected =
        this.orders.find((w) => w.work_order_id === this.selected) ||
        this.orders[0];
      if (selected) this.select(selected);
      else this.panel.close();
      $("myTasksMessage").textContent =
        `${this.orders.length} assigned task${this.orders.length === 1 ? "" : "s"} in your permitted projects.`;
    } catch (error) {
      if (generation === this.generation)
        $("myTasksMessage").textContent = error.message;
    }
  }
  updated(order) {
    this.orders = this.orders.map((w) =>
      w.work_order_id === order.work_order_id ? { ...w, ...order } : w,
    );
    this.render();
  }
  render() {
    const list = $("myTasksList");
    list.replaceChildren();
    for (const order of this.orders) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "task-list-item";
      button.setAttribute(
        "aria-pressed",
        String(order.work_order_id === this.selected),
      );
      button.textContent = `${order.title}\n${order.asset_id} · ${order.equipment_name}\nFloor ${order.floor} · ${order.room_id} · ${order.priority}\n${taskStatus(order)}\nAssigned ${stamp(order.assigned_at)} · Due ${order.due_at ? stamp(order.due_at) : "Not set"}`;
      button.onclick = () => this.select(order);
      list.append(button);
    }
  }
  select(order) {
    if (this.panel.busy) return;
    this.selected = order.work_order_id;
    this.render();
    this.panel.open(order, $("myTaskDetail"));
  }
}

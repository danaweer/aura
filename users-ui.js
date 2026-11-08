/* Administrator directory; temporary credentials stay in memory and are cleared on leave. */
import { authState, authFetch, can, expireAuthentication } from "./auth-ui.js";
const $ = (id) => document.getElementById(id);
const titleCase = (value) => value[0].toUpperCase() + value.slice(1);

export class UsersPanel {
  constructor() {
    this.form = $("usersForm");
    this.users = [];
    this.projects = [];
    this.selected = null;
    this.busy = false;
    this.generation = 0;
    $("usersRefresh").onclick = () => this.load();
    $("usersNew").onclick = () => this.edit(null);
    $("usersResetPassword").onclick = () => this.resetPassword();
    $("usersDismissPassword").onclick = () => this.clearCredential();
    $("usersRevealPassword").onclick = () => {
      const input = $("usersTemporaryPassword");
      input.type = input.type === "password" ? "text" : "password";
      $("usersRevealPassword").textContent =
        input.type === "password" ? "Show" : "Hide";
    };
    this.form.onsubmit = (event) => {
      event.preventDefault();
      this.save();
    };
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.clearCredential();
    });
    window.addEventListener("pagehide", () => this.clearCredential());
  }
  clearCredential() {
    $("usersTemporaryPassword").value = "";
    $("usersTemporaryPassword").type = "password";
    $("usersCredentialContext").textContent = "";
    $("usersRevealPassword").textContent = "Show";
    $("usersCredential").hidden = true;
  }
  close() {
    this.active = false;
    this.generation++;
    this.clearCredential();
  }
  open() {
    if (!can("administration")) return;
    this.active = true;
    this.clearCredential();
    this.load();
  }
  message(text) {
    $("usersMessage").textContent = text;
  }
  async api(path = "", body) {
    const response = await authFetch(`/api/admin/users${path}`, {
      cache: "no-store",
      ...(body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Account operation failed");
    return result;
  }
  async load() {
    if (this.busy) return;
    const generation = ++this.generation;
    this.message("Loading users…");
    try {
      const data = await this.api();
      if (!this.active || generation !== this.generation) return;
      this.users = data.users;
      this.projects = data.projects;
      this.form.elements.role.replaceChildren(
        ...data.roles.map((role) => new Option(titleCase(role), role)),
      );
      this.render();
      this.edit(
        this.users.find((u) => u.user_id === this.selected?.user_id) || null,
      );
      this.message(
        `${this.users.length} account${this.users.length === 1 ? "" : "s"} loaded.`,
      );
    } catch (error) {
      if (this.active && generation === this.generation)
        this.message(error.message);
    }
  }
  render() {
    const body = $("usersTableBody");
    body.replaceChildren();
    for (const user of this.users) {
      const row = document.createElement("tr");
      for (const text of [
        `${user.name}\n${user.username}`,
        titleCase(user.role),
        `${titleCase(user.status)}${user.must_change_password ? " · Password setup required" : ""}`,
        user.projects
          .map((id) => this.projects.find((p) => p.id === id)?.name || id)
          .join(", ") || "No project access",
      ]) {
        const cell = document.createElement("td");
        cell.textContent = text;
        row.append(cell);
      }
      const cell = document.createElement("td"),
        button = document.createElement("button");
      button.type = "button";
      button.className = "projects-button";
      button.textContent = "Manage";
      button.setAttribute("aria-label", `Manage ${user.username}`);
      button.onclick = () => {
        if (!this.busy) this.edit(user);
      };
      cell.append(button);
      row.append(cell);
      body.append(row);
    }
  }
  edit(user) {
    this.selected = user;
    this.form.reset();
    $("usersFormTitle").textContent = user ? "Manage user" : "Create user";
    $("usersFormContext").textContent = user
      ? `${user.name} · ${user.username} · ${user.user_id}`
      : "A temporary password is generated securely after creation.";
    $("usersNewFields").hidden = Boolean(user);
    for (const name of ["username", "name"])
      this.form.elements[name].disabled = Boolean(user);
    this.form.elements.role.value = user?.role || "employee";
    this.form.elements.status.value = user?.status || "active";
    $("usersStatusLabel").hidden = !user;
    $("usersNew").hidden = !user;
    $("usersResetPassword").hidden =
      !user || user.user_id === authState.user.user_id;
    $("usersSave").textContent = user ? "Save changes" : "Create user";
    const choices = $("usersProjectChoices");
    choices.replaceChildren();
    for (const project of this.projects) {
      const label = document.createElement("label"),
        input = document.createElement("input");
      input.type = "checkbox";
      input.name = "projects";
      input.value = project.id;
      input.checked = user?.projects.includes(project.id) || false;
      label.append(input, document.createTextNode(project.name));
      choices.append(label);
    }
  }
  credential(result) {
    if (!this.active) return;
    $("usersTemporaryPassword").value = result.temporary_password;
    $("usersCredentialContext").textContent =
      `${result.user.username} · Expires ${new Date(result.expires_at * 1000).toLocaleString()}`;
    $("usersCredential").hidden = false;
    $("usersCredential").scrollIntoView({ block: "nearest" });
  }
  async operation(action, success) {
    if (this.busy) return;
    this.busy = true;
    this.clearCredential();
    for (const button of $("usersPage").querySelectorAll("button"))
      button.disabled = true;
    try {
      const result = await action();
      if (!this.active) return;
      if (result.user.user_id === authState.user.user_id)
        return expireAuthentication();
      const index = this.users.findIndex(
        (u) => u.user_id === result.user.user_id,
      );
      if (index < 0) this.users.push(result.user);
      else this.users[index] = result.user;
      this.render();
      this.edit(result.user);
      if (result.temporary_password) this.credential(result);
      this.message(success);
    } catch (error) {
      if (this.active) this.message(error.message);
    } finally {
      this.busy = false;
      for (const button of $("usersPage").querySelectorAll("button"))
        button.disabled = false;
    }
  }
  async save() {
    if (!this.form.reportValidity()) return;
    const selected = this.selected;
    const projects = [
      ...this.form.querySelectorAll('input[name="projects"]:checked'),
    ].map((input) => input.value);
    const body = { role: this.form.elements.role.value, projects };
    if (selected) {
      body.status = this.form.elements.status.value;
      body.expected_version = selected.version;
    } else {
      body.username = this.form.elements.username.value;
      body.name = this.form.elements.name.value;
    }
    await this.operation(
      () => this.api(selected ? `/${selected.user_id}` : "", body),
      selected
        ? "Account updated. Changed permissions or status invalidate existing sessions."
        : "Account created. Share the temporary password privately.",
    );
  }
  async resetPassword() {
    const user = this.selected;
    if (
      !user ||
      this.busy ||
      !confirm(
        `Reset the password for ${user.username}? All their sessions will end and they must choose a new password.`,
      )
    )
      return;
    await this.operation(
      () =>
        this.api(`/${user.user_id}/reset-password`, {
          expected_version: user.version,
        }),
      "Password reset. All sessions invalidated. Share the new temporary password privately.",
    );
  }
}

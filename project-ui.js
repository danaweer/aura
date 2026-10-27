/* Project metadata and navigation. Models share a workspace, never device bindings. */
const $ = (id) => document.getElementById(id);
export class ProjectLibrary {
  constructor(onOpen, onLibrary) {
    this.onOpen = onOpen;
    this.onLibrary = onLibrary;
    this.projects = [];
    this.current = null;
    window.addEventListener("hashchange", () => this.route());
    for (const id of ["navProjects", "openProjectsBtn"])
      $(id).onclick = () => this.show();
    $("retryProjects").onclick = () => this.load();
  }
  async load() {
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      if (!response.ok) throw new Error("Project catalog unavailable");
      const catalog = await response.json();
      this.projects = catalog.projects;
      this.defaultId = catalog.default_project;
      this.renderCards();
      $("projectsStatus").textContent =
        `${this.projects.length} saved projects · Select a model to open its workspace.`;
      $("retryProjects").hidden = true;
      this.route();
    } catch (error) {
      $("projectsStatus").textContent =
        "Projects could not be loaded. Check the Python server and retry.";
      $("retryProjects").hidden = false;
      this.onLibrary();
      console.error(error);
    }
  }
  renderCards() {
    $("projectCount").textContent = String(this.projects.length).padStart(
      2,
      "0",
    );
    $("projectCards").replaceChildren();
    for (const project of this.projects) {
      const card = document.createElement("article");
      card.className = "project-card";
      card.dataset.projectId = project.id;
      const image = document.createElement("img");
      image.src = project.preview;
      image.alt = `${project.name} model preview`;
      image.width = 640;
      image.height = 340;
      const body = document.createElement("div");
      body.className = "project-card-body";
      const stage = document.createElement("span");
      stage.className = "project-stage";
      stage.textContent = project.stage;
      const title = document.createElement("h2");
      title.textContent = project.name;
      const description = document.createElement("p");
      description.textContent = project.description;
      const stats = document.createElement("div");
      stats.className = "project-card-stats";
      stats.textContent = `${project.model.floors} ${project.model.floors === 1 ? "floor" : "floors"} · ${project.iot.length} assigned IoT ${project.iot.length === 1 ? "device" : "devices"}`;
      const open = document.createElement("button");
      open.type = "button";
      open.className = "open-project";
      open.textContent = "Open project →";
      open.setAttribute("aria-label", `Open ${project.name}`);
      open.onclick = () => this.open(project.id);
      body.append(stage, title, description, stats, open);
      card.append(image, body);
      $("projectCards").append(card);
    }
  }
  route() {
    if (!this.projects.length) return;
    if (location.hash === "#projects") return this.show(false);
    let requested = null;
    if (location.hash.startsWith("#project/")) {
      try {
        requested = decodeURIComponent(location.hash.slice(9));
      } catch {}
    }
    if (!requested)
      try {
        requested = localStorage.getItem("aura.activeProject");
      } catch {}
    this.open(
      this.projects.some((project) => project.id === requested)
        ? requested
        : this.defaultId,
      false,
    );
  }
  open(id, route = true) {
    const project = this.projects.find((item) => item.id === id);
    if (!project) return;
    this.current = project;
    if (route)
      history.pushState(null, "", `#project/${encodeURIComponent(id)}`);
    try {
      localStorage.setItem("aura.activeProject", id);
    } catch {}
    this.onOpen(project);
  }
  show(route = true) {
    if (route) history.pushState(null, "", "#projects");
    this.onLibrary();
  }
}

export function renderProjectDetails(project) {
  $("buildingDescription").textContent = project.description;
  $("projectRequirements").replaceChildren();
  for (const requirement of project.requirements) {
    const item = document.createElement("li"),
      name = document.createElement("span"),
      status = document.createElement("small");
    name.textContent = requirement.name;
    status.textContent = requirement.status;
    item.append(name, status);
    $("projectRequirements").append(item);
  }
  $("projectPhases").replaceChildren();
  project.phases.forEach((phase, index) => {
    const item = document.createElement("li");
    item.className = phase.status === "current" ? "current" : "";
    const number = document.createElement("span");
    number.className = "phase-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const name = document.createElement("span");
    name.textContent = phase.name;
    const status = document.createElement("small");
    status.textContent = phase.status;
    item.append(number, name, status);
    $("projectPhases").append(item);
  });
  $("projectIot").textContent = project.iot.length
    ? project.iot.map((item) => `${item.name} · ${item.description}`).join("\n")
    : "No devices assigned. IoT and BMS connections will be established in a later phase.";
}

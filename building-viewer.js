import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";
import {
  createAtriumBuilding,
  FLOOR_HEIGHT,
} from "./projects/atrium-building/model.js";

export class BuildingViewer {
  constructor(canvas, onSelect = () => {}) {
    this.canvas = canvas;
    this.active = false;
    this.floor = "all";
    this.view = "overview";
    this.glass = true;
    this.roof = true;
    this.cutaway = false;
    this.partitions = true;
    this.furniture = true;
    this.lowWalls = true;
    this.services = false;
    this.labels = true;
    this.onSelect = onSelect;
    this.labelLayer = document.getElementById("buildingLabels");
    this.labelButtons = [];
    this.planNotes = [];
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xdce6ed);
    this.scene.fog = new THREE.Fog(0xdce6ed, 95, 180);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.2, 220);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = false;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 120;
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.target.set(-1, 5, 1);
    this.controls.addEventListener("change", () => this.render());
    this.scene.add(new THREE.HemisphereLight(0xf6fbff, 0x7b929f, 1.7));
    const sun = new THREE.DirectionalLight(0xfff4df, 2.4);
    sun.position.set(-25, 40, 28);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -40,
      right: 40,
      top: 35,
      bottom: -35,
      near: 1,
      far: 110,
    });
    sun.shadow.normalBias = 0.035;
    sun.shadow.bias = -0.0003;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xd6efff, 1.1);
    fill.position.set(20, 15, -25);
    this.scene.add(fill);
    this.model = createAtriumBuilding();
    this.scene.add(this.model.root);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0xd0dce4, roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.42;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(44, 0.24, 34),
      new THREE.MeshStandardMaterial({ color: 0xc6d3db, roughness: 0.8 }),
    );
    plinth.position.set(0, -0.3, -2);
    plinth.receiveShadow = true;
    this.scene.add(plinth);
    this.raycaster = new THREE.Raycaster();
    let down = null;
    canvas.addEventListener("pointerdown", (event) => {
      down = { x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener("pointerup", (event) => {
      if (
        !down ||
        Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5
      )
        return;
      const rect = canvas.getBoundingClientRect();
      this.raycaster.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          (-(event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        this.camera,
      );
      const hit = this.raycaster
        .intersectObject(this.model.root, true)
        .find((item) => {
          for (let node = item.object; node; node = node.parent)
            if (!node.visible) return false;
          return true;
        });
      if (hit) {
        const part =
          hit.object.userData.instances?.[hit.instanceId] ||
          hit.object.userData;
        if (
          part.roomId &&
          this.model.rooms.some((room) => room.id === part.roomId)
        )
          this.selectRoom(part.roomId, false);
        else onSelect(part);
      }
      down = null;
    });
    canvas.addEventListener("keydown", (event) => {
      const offsets = {
        ArrowLeft: [-0.12, 0],
        ArrowRight: [0.12, 0],
        ArrowUp: [0, -0.1],
        ArrowDown: [0, 0.1],
      };
      if (offsets[event.key]) {
        const offset = this.camera.position.clone().sub(this.controls.target);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        spherical.theta += offsets[event.key][0];
        spherical.phi = THREE.MathUtils.clamp(
          spherical.phi + offsets[event.key][1],
          0.05,
          1.5,
        );
        this.camera.position
          .copy(this.controls.target)
          .add(new THREE.Vector3().setFromSpherical(spherical));
        this.controls.update();
      } else if (["+", "=", "-"].includes(event.key))
        this.zoom(event.key === "-" ? 1.12 : 0.88);
      else if (event.key === "Home") this.setView("overview");
      else return;
      event.preventDefault();
      this.render();
    });
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      canvas.dataset.ready = "false";
      document.getElementById("buildingStatus").textContent =
        "The 3D graphics context was lost. Reload to restore the building.";
      document.getElementById("buildingStatus").hidden = false;
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas.parentElement);
    for (const room of this.model.rooms) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "room-label";
      button.dataset.roomId = room.id;
      button.setAttribute(
        "aria-label",
        `${room.id} ${room.name}, ${room.area} square metres`,
      );
      const code = document.createElement("small"),
        name = document.createElement("span");
      code.textContent = room.id;
      name.textContent = room.name;
      button.append(code, name);
      button.onclick = () => this.selectRoom(room.id, false);
      this.labelLayer.append(button);
      this.labelButtons.push({ room, button });
    }
    for (const [x, z, label] of [
      [0, 0, "ATRIUM"],
      [-12.5, 0.8, "MAIN CORRIDOR · 2.4 m"],
      [12.5, 0.8, "MAIN CORRIDOR · 2.4 m"],
      [0, 6.2, "RECEPTION"],
      [0, 13, "FRONT / ARRIVAL"],
    ]) {
      const element = document.createElement("span");
      element.className = "plan-note";
      element.textContent = label;
      this.labelLayer.append(element);
      this.planNotes.push({ x, z, label, element });
    }
    this.setView("offices");
  }
  resize() {
    if (!this.active) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.renderer.setSize(rect.width, rect.height, false);
    this.camera.aspect = rect.width / rect.height;
    this.camera.zoom = Math.min(1, this.camera.aspect / 1.15);
    this.camera.updateProjectionMatrix();
    this.render();
  }
  setActive(active) {
    this.active = active;
    this.labelLayer.hidden = !active;
    this.controls.enabled = active;
    if (active) this.resize();
  }
  setView(view) {
    if (["plan", "offices"].includes(view) && this.floor === "all")
      this.floor = "0";
    this.view = view;
    const y =
      this.floor === "all" ? 5 : Number(this.floor) * FLOOR_HEIGHT + 1.5;
    this.controls.target.set(
      0,
      view === "plan" ? Number(this.floor) * FLOOR_HEIGHT : y,
      0,
    );
    if (view === "plan") this.camera.position.set(0, y + 70, 0.01);
    else if (view === "offices") this.camera.position.set(29, y + 37, 40);
    else if (view === "atrium") this.camera.position.set(19, y + 16, 29);
    else this.camera.position.set(40, y + 25, 48);
    this.controls.update();
    this.applyLayers();
    this.render();
  }
  setFloor(floor) {
    this.floor = floor;
    this.setView(
      floor === "all" && ["plan", "offices"].includes(this.view)
        ? "overview"
        : floor !== "all" && this.view === "overview"
          ? "offices"
          : this.view,
    );
  }
  setLayer(key, value) {
    this[key] = value;
    this.applyLayers();
    this.render();
  }
  applyLayers() {
    // Keep floor plans readable without tall columns casting shadows across rooms.
    this.renderer.shadowMap.enabled = this.view !== "plan";
    this.model.floors.forEach((group, index) => {
      group.visible = this.floor === "all" || index === Number(this.floor);
    });
    const opened =
      this.cutaway ||
      this.view === "atrium" ||
      this.view === "plan" ||
      this.view === "offices" ||
      this.floor !== "all";
    this.model.roof.visible = this.roof && !opened;
    this.model.yard.visible =
      this.services && (this.floor === "all" || this.floor === "0");
    this.model.interiors.forEach((interior) => {
      interior.walls.visible = this.partitions;
      interior.walls.scale.y = this.lowWalls && opened ? 0.85 / 3.2 : 1;
      interior.furniture.visible = this.furniture;
      interior.reserves.visible = this.services;
    });
    this.model.root.traverse((object) => {
      if (!object.isMesh) return;
      const glass = object.material === this.model.materials.glass;
      const front = object.userData.side === "front";
      const exterior = ["front", "back", "left", "right"].includes(
        object.userData.side,
      );
      object.visible =
        (!glass || this.glass) &&
        !(
          ["plan", "offices"].includes(this.view) &&
          exterior &&
          ["glass", "structure"].includes(object.userData.kind)
        ) &&
        !(
          opened &&
          front &&
          ["glass", "structure"].includes(object.userData.kind)
        );
    });
  }
  selectRoom(id, focus = true) {
    const room = this.model.rooms.find((item) => item.id === id);
    if (!room) return;
    if (String(room.floor) !== this.floor) this.setFloor(String(room.floor));
    const b = room.bounds,
      y = room.floor * FLOOR_HEIGHT;
    if (this.selection) {
      this.scene.remove(this.selection);
      this.selection.geometry.dispose();
      this.selection.material.dispose();
    }
    const points = [
      [b.x1, y + 0.08, b.z1],
      [b.x2, y + 0.08, b.z1],
      [b.x2, y + 0.08, b.z2],
      [b.x1, y + 0.08, b.z2],
    ].map((p) => new THREE.Vector3(...p));
    this.selection = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0xdb8c2e, depthTest: false }),
    );
    this.selection.renderOrder = 10;
    this.selection.userData.floor = room.floor;
    this.scene.add(this.selection);
    if (focus) {
      this.controls.target.set((b.x1 + b.x2) / 2, y + 0.5, (b.z1 + b.z2) / 2);
      this.camera.position
        .copy(this.controls.target)
        .add(
          this.view === "plan"
            ? new THREE.Vector3(0, 24, 0.01)
            : new THREE.Vector3(9, 12, 14),
        );
      this.controls.update();
    }
    this.onSelect({
      ...room,
      kind: "room",
      roomId: room.id,
      label: `${room.id} · ${room.name}`,
    });
    this.render();
  }
  zoom(factor) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.multiplyScalar(factor).clampLength(12, 120);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
    this.render();
  }
  render() {
    if (!this.active) return;
    if (this.selection)
      this.selection.visible =
        this.floor === String(this.selection.userData.floor);
    this.renderer.render(this.scene, this.camera);
    const width = this.canvas.clientWidth,
      height = this.canvas.clientHeight;
    for (const { room, button } of this.labelButtons) {
      const b = room.bounds,
        point = new THREE.Vector3(
          (b.x1 + b.x2) / 2,
          room.floor * FLOOR_HEIGHT + 0.1,
          (b.z1 + b.z2) / 2,
        ).project(this.camera);
      const visible =
        this.active &&
        this.labels &&
        String(room.floor) === this.floor &&
        Math.abs(point.x) < 0.98 &&
        Math.abs(point.y) < 0.95 &&
        point.z > -1 &&
        point.z < 1;
      button.hidden = !visible;
      if (visible) {
        button.style.left = `${((point.x + 1) / 2) * width}px`;
        button.style.top = `${((-point.y + 1) / 2) * height}px`;
      }
    }
    for (const note of this.planNotes) {
      const point = new THREE.Vector3(
        note.x,
        Number(this.floor) * FLOOR_HEIGHT + 0.1,
        note.z,
      ).project(this.camera);
      note.element.hidden =
        this.view !== "plan" ||
        !this.labels ||
        Math.abs(point.x) > 0.95 ||
        Math.abs(point.y) > 0.95 ||
        point.z < -1 ||
        point.z > 1;
      note.element.textContent =
        note.label === "ATRIUM" && this.floor !== "0"
          ? "ATRIUM VOID · OPEN TO BELOW"
          : note.label === "RECEPTION" && this.floor !== "0"
            ? "FRONT GALLERY"
            : note.label;
      note.element.style.left = `${((point.x + 1) / 2) * width}px`;
      note.element.style.top = `${((-point.y + 1) / 2) * height}px`;
    }
    this.canvas.dataset.ready = "true";
    this.canvas.dataset.floor = String(this.floor);
    this.canvas.dataset.view = this.view;
    this.canvas.dataset.furniture = String(this.furniture);
    this.canvas.dataset.lowWalls = String(this.lowWalls);
    this.canvas.dataset.services = String(this.services);
  }
}

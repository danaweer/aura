import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { ROUTE_SYSTEMS } from "./projects/atrium-building/main-service-plan.js";
import {
  DEVICE_TYPES,
  DEVICE_CATEGORIES,
} from "./projects/atrium-building/device-plan.js";
import {
  createAtriumBuilding,
  FLOOR_HEIGHT,
} from "./projects/atrium-building/model.js";
import {
  applyBuildingVisibility,
  visibleIntersections,
} from "./projects/atrium-building/visibility.js";

export class BuildingViewer {
  constructor(canvas, onSelect = () => {}, onStateChange = () => {}) {
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
    this.ceilings = true;
    this.systems = true;
    this.egressSigns = true;
    this.egressPaths = false;
    this.extinguishers = true;
    this.washroomClearances = false;
    this.washroomDoors = false;
    this.washroomPoints = false;
    this.washroomDetail = false;
    this.selectedRoomId = "";
    this.equipment = true;
    this.equipmentClearances = false;
    this.equipmentPorts = false;
    this.equipmentConnections = false;
    this.selectedEquipmentId = "";
    this.equipmentEye = false;
    this.serviceLayers = Object.fromEntries(
      Object.keys(ROUTE_SYSTEMS).map((key) => [
        key,
        !["alarm", "smoke"].includes(key),
      ]),
    );
    this.serviceShafts = true;
    this.serviceAccess = false;
    this.serviceEnvelopes = false;
    this.selectedServiceId = "";
    this.servicePlanMode = false;
    this.serviceLabelButtons = [];
    this.devices = true;
    this.deviceLabels = true;
    this.deviceRoutes = false;
    this.deviceConnections = false;
    this.devicePlanMode = false;
    this.selectedDeviceId = "";
    this.deviceCategories = Object.fromEntries(
      Object.keys(DEVICE_CATEGORIES).map((c) => [
        c,
        !["zones", "pending"].includes(c),
      ]),
    );
    this.deviceLabelButtons = [];
    this.extinguisherLabelLayer = document.getElementById("extinguisherLabels");
    this.extinguisherLabelButtons = [];
    this.egressLabelLayer = document.getElementById("egressLabels");
    this.egressLabelButtons = [];
    this.onSelect = onSelect;
    this.onStateChange = onStateChange;
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
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.screenSpacePanning = true;
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
    // A local procedural studio environment gives glass and metal restrained reflections.
    // No texture download or additional dependency is needed.
    const studio = new THREE.Scene();
    studio.background = new THREE.Color(0xd4e1e7);
    for (const [x, y, z, w, h, d, color] of [
      [0, 20, 0, 70, 0.2, 70, 0xf3f3ed],
      [-25, 5, 0, 0.2, 15, 40, 0xa9bdc9],
      [15, 10, 25, 20, 18, 0.2, 0xffffff],
    ]) {
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshBasicMaterial({ color }),
      );
      panel.position.set(x, y, z);
      studio.add(panel);
    }
    const environment = new THREE.PMREMGenerator(this.renderer);
    this.environmentMap = environment.fromScene(studio, 0.05);
    this.scene.environment = this.environmentMap.texture;
    studio.traverse((object) => {
      object.geometry?.dispose();
      object.material?.dispose();
    });
    environment.dispose();
    this.model = createAtriumBuilding();
    const deviceSelect = document.getElementById("deviceSelect");
    this.deviceLeaderSvg = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    this.deviceLeaderSvg.classList.add("device-leaders");
    this.deviceLeaderSvg.setAttribute("aria-hidden", "true");
    this.labelLayer.append(this.deviceLeaderSvg);
    const zoneSymbols = new Set();
    for (const floor of [0, 1, 2]) {
      const options = document.createElement("optgroup");
      options.label = ["Ground floor", "First floor", "Second floor"][floor];
      for (const r of this.model.devices.assets.filter(
        (r) => r.floor === floor,
      )) {
        options.append(new Option(r.label, r.assetId));
        if (r.supplemental) continue;
        if (["L", "SW", "F"].includes(r.type)) continue;
        const key = `${r.type}-${r.roomId}`;
        if (["E", "P"].includes(r.type) && zoneSymbols.has(key)) continue;
        zoneSymbols.add(key);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "device-label";
        button.dataset.deviceId = r.assetId;
        button.dataset.deviceType = r.type;
        button.textContent = r.type === "Z" ? "L" : r.type;
        button.style.background = `#${DEVICE_TYPES[r.type].color.toString(16).padStart(6, "0")}`;
        button.title = `${r.label} · ${r.designStatus} / unconnected`;
        button.onclick = () => this.selectDevice(r.assetId, false);
        const leader = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "line",
        );
        this.deviceLeaderSvg.append(leader);
        this.labelLayer.append(button);
        this.deviceLabelButtons.push({ record: r, button, leader });
      }
      deviceSelect.append(options);
    }
    for (const floor of [0, 1, 2]) {
      const prefix = floor ? `L${floor}` : "G";
      const nodes = [
        ["FR", -12.45, -4.45, ["fire"], `FR-01-${prefix}`],
        ["WL", -11.55, -5.3, ["cold", "hot", "waste", "vent"], `WL-${prefix}`],
        ["WR", 19.76, -5.56, ["cold", "hot", "waste", "vent"], `WR-${prefix}`],
        ["DR", 10.5, -4.6, ["power", "data", "alarm"], `DR-POWER-${prefix}`],
        ["DB", 13.35, -2.5, ["power"], `${prefix}-DB-TRAYS-R01`],
        ["IDF", 10.25, -2.1, ["data"], `${prefix}-IDF-TRAYS-R01`],
        [
          "AHU",
          floor ? 8.35 : -2,
          floor ? -9.2 : -17.25,
          ["supply", "return"],
          floor ? `AHU-L${floor}-01` : "AHU-G-RES",
        ],
        ["EX", -18.95, -3.21, ["exhaust"], null],
        ["EX", 18.95, -3.21, ["exhaust"], null],
      ];
      for (const [text, x, z, systems, id] of nodes) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "service-label";
        button.dataset.node = text;
        button.textContent = text;
        button.title = `${prefix} · ${id || "separate toilet extraction"}`;
        button.onclick = () => {
          if (!id) return;
          if (id.startsWith("AHU-L")) this.selectEquipment(id, false);
          else
            this.selectService(
              text === "DR" && !this.serviceLayers.power
                ? `DR-${this.serviceLayers.data ? "DATA" : "FA"}-${prefix}`
                : id,
              false,
            );
        };
        button.addEventListener("pointerdown", (event) => {
          if (event.button === 1) {
            event.preventDefault();
            this.canvas.dispatchEvent(
              new PointerEvent("pointerdown", {
                pointerId: event.pointerId,
                pointerType: event.pointerType,
                isPrimary: event.isPrimary,
                button: 1,
                buttons: event.buttons,
                clientX: event.clientX,
                clientY: event.clientY,
                cancelable: true,
              }),
            );
          }
        });
        this.labelLayer.append(button);
        this.serviceLabelButtons.push({ floor, x, z, systems, button });
      }
    }
    const serviceSelect = document.getElementById("serviceSelect");
    for (const [system, definition] of Object.entries(ROUTE_SYSTEMS)) {
      const options = document.createElement("optgroup");
      options.label = definition.label;
      for (const record of this.model.mainServices.assets.filter(
        (r) =>
          r.system === system &&
          !r.data.diagram &&
          (r.reservation ||
            [
              "main",
              "source",
              "floor-source",
              "plant-reservation",
              "indoor-reservation",
            ].includes(r.role) ||
            r.id.startsWith("FC-")),
      ))
        options.append(new Option(record.data.label, record.id));
      serviceSelect.append(options);
    }
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
      new THREE.BoxGeometry(52, 0.24, 43),
      new THREE.MeshStandardMaterial({ color: 0xc6d3db, roughness: 0.8 }),
    );
    plinth.position.set(0, -0.32, 1);
    plinth.receiveShadow = true;
    this.scene.add(plinth);
    this.raycaster = new THREE.Raycaster();
    let down = null;
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button === 1) event.preventDefault();
      down =
        event.button === 0
          ? { x: event.clientX, y: event.clientY, dragged: false }
          : null;
    });
    canvas.addEventListener("pointermove", (event) => {
      if (
        down &&
        Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5
      )
        down.dragged = true;
    });
    canvas.addEventListener("pointercancel", () => {
      down = null;
    });
    canvas.addEventListener("auxclick", (event) => {
      if (event.button === 1) event.preventDefault();
    });
    canvas.addEventListener("pointerup", (event) => {
      const start = down;
      down = null;
      if (
        event.button !== 0 ||
        !start ||
        start.dragged ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5
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
      const hit = visibleIntersections(this.raycaster, this.model.root)[0];
      if (hit) {
        const part =
          hit.object.userData.instances?.[hit.instanceId] ||
          hit.object.userData;
        if (this.devices && (part.kind === "room-device" || part.deviceId))
          this.selectDevice(part.deviceId || part.assetId, false);
        else if (["equipment", "equipment-port"].includes(part.kind))
          this.selectEquipment(
            part.equipmentId || part.assetId,
            false,
            part.portName,
          );
        else if (part.kind === "egress-sign")
          this.selectSign(part.assetId, false);
        else if (part.kind === "washroom-point") this.inspectAsset(part);
        else if (part.kind === "main-service")
          this.selectService(part.assetId, false, part);
        else if (["fire-extinguisher", "extinguisher-sign"].includes(part.kind))
          this.selectExtinguisher(part.stationId || part.assetId, false);
        else if (
          part.roomId &&
          this.model.rooms.some((room) => room.id === part.roomId)
        )
          this.selectRoom(part.roomId, false);
        else this.inspectAsset(part);
      }
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
      // Labels remain clickable with the left button; middle-drag passes through to pan.
      button.addEventListener("pointerdown", (event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        this.canvas.dispatchEvent(
          new PointerEvent("pointerdown", {
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            isPrimary: event.isPrimary,
            button: event.button,
            buttons: event.buttons,
            clientX: event.clientX,
            clientY: event.clientY,
            cancelable: true,
          }),
        );
      });
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
    for (const sign of this.model.egress.allSigns.filter(
      (sign) => sign.scheduleId,
    )) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "egress-label";
      button.dataset.signId = sign.scheduleId;
      const travel = sign.faces.find((face) => face.travel)?.travel;
      const arrow = !travel
        ? ""
        : travel[0] < 0
          ? "←"
          : travel[0] > 0
            ? "→"
            : travel[1] < 0
              ? "↑"
              : "↓";
      button.textContent = `${sign.scheduleId} EXIT ${arrow}`;
      button.title = `${sign.label} · PDF p.${sign.sourcePage}`;
      button.setAttribute("aria-label", sign.label);
      button.onclick = () => this.selectSign(sign.assetId, false);
      button.addEventListener("pointerdown", (event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        this.canvas.dispatchEvent(
          new PointerEvent("pointerdown", {
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            isPrimary: event.isPrimary,
            button: 1,
            buttons: event.buttons,
            clientX: event.clientX,
            clientY: event.clientY,
            cancelable: true,
          }),
        );
      });
      this.egressLabelLayer.append(button);
      this.egressLabelButtons.push({ sign, button });
    }
    const select = document.getElementById("egressSignSelect");
    for (let f = 0; f < 3; f++) {
      const options = document.createElement("optgroup");
      options.dataset.schedule = "pdf";
      options.label = [
        "Ground · 21 positions",
        "First · 18 positions",
        "Second · 18 positions",
      ][f];
      for (const sign of this.model.egress.allSigns.filter(
        (sign) => sign.scheduleId && sign.floor === f,
      ))
        options.append(new Option(sign.label, sign.assetId));
      select.append(options);
    }
    const stairSigns = document.createElement("optgroup");
    stairSigns.label = "Stair directions · each occupied floor";
    stairSigns.dataset.schedule = "stair";
    for (const sign of this.model.egress.allSigns.filter(
      (sign) => sign.pictogram,
    ))
      stairSigns.append(
        new Option(
          `${sign.label} · ${sign.floor ? "down to ground" : "exit to outside"}`,
          sign.assetId,
        ),
      );
    select.append(stairSigns);
    const extinguisherSelect = document.getElementById("extinguisherSelect");
    for (let floor = 0; floor < 3; floor++) {
      const options = document.createElement("optgroup");
      options.label = [
        "Ground · 11 stations",
        "First · 8 stations",
        "Second · 8 stations",
      ][floor];
      for (const station of this.model.extinguishers.stations.filter(
        (s) => s.floor === floor,
      )) {
        options.append(new Option(station.label, station.assetId));
        const button = document.createElement("button");
        button.type = "button";
        button.className = "egress-label extinguisher-label";
        button.dataset.extinguisherId = station.assetId;
        button.textContent = station.assetId;
        button.title = `${station.location} · PDF p.${station.sourcePage}`;
        button.onclick = () => this.selectExtinguisher(station.assetId, false);
        button.addEventListener("pointerdown", (event) => {
          if (event.button !== 1) return;
          event.preventDefault();
          this.canvas.dispatchEvent(
            new PointerEvent("pointerdown", {
              pointerId: event.pointerId,
              pointerType: event.pointerType,
              isPrimary: event.isPrimary,
              button: 1,
              buttons: event.buttons,
              clientX: event.clientX,
              clientY: event.clientY,
              cancelable: true,
            }),
          );
        });
        this.extinguisherLabelLayer.append(button);
        this.extinguisherLabelButtons.push({ station, button });
      }
      extinguisherSelect.append(options);
    }
    this.washroomAssets = new Map();
    this.model.root.traverse((object) => {
      if (object.userData.kind === "washroom-point")
        this.washroomAssets.set(object.userData.assetId, object);
    });
    const washroomPoints = document.getElementById("washroomPointSelect");
    for (const [id, object] of this.washroomAssets)
      washroomPoints.append(new Option(object.userData.label, id));
    const equipmentSelect = document.getElementById("equipmentSelect");
    for (const record of this.model.equipment.assets)
      equipmentSelect.append(
        new Option(record.object.userData.label, record.definition.assetId),
      );
    this.setView("overview");
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
    this.egressLabelLayer.hidden = !active;
    this.extinguisherLabelLayer.hidden = !active;
    if (!active) document.getElementById("egressEndpoint").hidden = true;
    this.controls.enabled = active;
    if (active) this.resize();
  }
  setView(view) {
    if (view !== "plan") this.servicePlanMode = false;
    if (view !== "plan") this.devicePlanMode = false;
    this.camera.fov = 36;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = 12;
    this.equipmentEye = false;
    this.washroomDetail = false;
    if (["overview", "front", "rear", "left", "right", "roof"].includes(view))
      this.floor = "all";
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
    if (view === "plan") {
      const planY = Number(this.floor) * FLOOR_HEIGHT;
      const routePlan = this.egressPaths;
      this.controls.target.set(0, planY, routePlan ? 3.5 : 0);
      this.camera.position.set(
        0,
        planY + (routePlan ? 83 : 71.5),
        routePlan ? 3.51 : 0.01,
      );
    } else if (view === "offices") this.camera.position.set(34, y + 42, 47);
    else if (view === "atrium") this.camera.position.set(19, y + 16, 29);
    else if (view === "front") this.camera.position.set(0, 22, 79);
    else if (view === "rear") this.camera.position.set(29, 25, -70);
    else if (view === "left") this.camera.position.set(-79, 24, 0);
    else if (view === "right") this.camera.position.set(79, 24, 0);
    else if (view === "roof") this.camera.position.set(0, 89, 0.01);
    else this.camera.position.set(42, 32, 58);
    this.controls.update();
    this.applyLayers();
    this.render();
    this.onStateChange();
  }
  setFloor(floor) {
    this.floor = floor;
    this.setView(
      floor === "all" && ["plan", "offices"].includes(this.view)
        ? "overview"
        : floor !== "all" &&
            ["overview", "front", "rear", "left", "right", "roof"].includes(
              this.view,
            )
          ? "offices"
          : this.view,
    );
  }
  setLayer(key, value) {
    if (key === "lowWalls") this.washroomDetail = false;
    if (key === "equipmentConnections") this.systems = value;
    this[key] = value;
    this.applyLayers();
    this.render();
    this.onStateChange();
  }
  applyLayers() {
    this.equipmentConnections = this.systems;
    // Keep floor plans readable without tall columns casting shadows across rooms.
    this.renderer.shadowMap.enabled = this.view !== "plan";
    applyBuildingVisibility(this.model, this);
  }
  setServiceLayer(system, value) {
    if (!(system in this.serviceLayers)) return;
    this.serviceLayers[system] = value;
    if (value) this.systems = true;
    this.applyLayers();
    this.render();
    this.onStateChange();
  }
  showServicePlan() {
    this.devicePlanMode = false;
    this.clearSelection();
    this.systems = true;
    this.servicePlanMode = true;
    this.labels = false;
    this.egressSigns = false;
    this.egressPaths = false;
    this.lowWalls = true;
    this.washroomDetail = false;
    this.setFloor(this.floor === "all" ? "1" : this.floor);
    this.setView("plan");
    this.servicePlanMode = true;
    this.render();
    this.onStateChange();
  }
  selectService(id, focus = true, part = null) {
    this.devicePlanMode = false;
    const r = this.model.mainServices.assets.find((r) => r.id === id);
    if (!r) {
      if (part) this.inspectAsset(part);
      return;
    }
    this.clearSelection();
    this.selectedServiceId = id;
    if (["plant-reservation", "indoor-reservation"].includes(r.role))
      this.equipment = true;
    this.systems = true;
    this.serviceLayers[r.system] = true;
    if (r.reservation) this.serviceShafts = true;
    if (focus) {
      this.view = "offices";
      this.servicePlanMode = false;
      this.setFloor(r.floor == null ? "all" : String(r.floor));
      this.labels = false;
      this.lowWalls = true;
      this.washroomDetail = false;
      this.equipmentEye = false;
      this.camera.fov = 36;
      this.camera.updateProjectionMatrix();
      this.controls.minDistance = 0.8;
      const points = r.points || [
        [r.bounds.x, r.bounds.y, r.bounds.z],
        [r.bounds.x, r.bounds.y + r.bounds.h, r.bounds.z],
      ];
      const bounds = new THREE.Box3().setFromPoints(
        points.map((p) => new THREE.Vector3(...p)),
      );
      bounds.getCenter(this.controls.target);
      const size = bounds.getSize(new THREE.Vector3()),
        extent = Math.max(4, size.x, size.z, size.y);
      this.camera.position
        .copy(this.controls.target)
        .add(new THREE.Vector3(extent * 0.85, extent * 1.3, extent * 1.1));
      this.controls.update();
    }
    this.onSelect(r.data);
    this.applyLayers();
    this.render();
    this.onStateChange();
  }
  clearSelection() {
    if (!this.selection) return;
    this.scene.remove(this.selection);
    this.selection.geometry.dispose();
    this.selection.material.dispose();
    this.selection = null;
  }
  setDeviceCategory(category, value) {
    this.deviceCategories[category] = value;
    if (value) this.devices = true;
    this.applyLayers();
    this.render();
    this.onStateChange();
  }
  showDevicePlan() {
    this.clearSelection();
    this.devices = true;
    this.devicePlanMode = true;
    this.servicePlanMode = false;
    this.deviceCategories.zones = true;
    this.systems = true;
    this.labels = false;
    this.lowWalls = true;
    this.egressSigns = false;
    this.egressPaths = false;
    this.washroomDetail = false;
    this.setFloor(this.floor === "all" ? "0" : this.floor);
    this.setView("plan");
    this.devicePlanMode = true;
    this.servicePlanMode = false;
    this.applyLayers();
    this.render();
    this.onStateChange();
  }
  selectDevice(id, focus = true) {
    const r = this.model.devices.assets.find((r) => r.assetId === id);
    if (!r) return;
    this.clearSelection();
    this.devices = true;
    this.deviceCategories[r.category] = true;
    this.selectedDeviceId = id;
    this.selectedServiceId = "";
    if (["S", "R", "E"].includes(r.type)) {
      this.systems = true;
      this.serviceLayers[
        r.type === "S" ? "supply" : r.type === "R" ? "return" : "exhaust"
      ] = true;
    }
    if (focus) {
      this.devicePlanMode = false;
      this.servicePlanMode = false;
      this.view = "offices";
      this.setFloor(String(r.floor));
      this.view = "offices";
      this.lowWalls = !["T", "Q", "SW"].includes(r.type);
      this.labels = false;
      this.washroomDetail = false;
      this.systems = ["S", "R", "E", "P"].includes(r.type);
      this.controls.minDistance = 0.5;
      this.camera.fov = 48;
      this.camera.updateProjectionMatrix();
      this.controls.target.set(...r.position);
      const normal = new THREE.Vector3(...r.normal),
        offset = new THREE.Vector3(2, 4, 3);
      if (["T", "Q", "SW"].includes(r.type))
        offset.set(normal.x * 4, 2.4, normal.z * 4);
      if (r.category === "pending" || r.category === "zones")
        offset.set(12, 18, 16);
      this.camera.position.copy(this.controls.target).add(offset);
      if (r.type === "W") {
        const room = this.model.rooms.find((room) => room.id === r.roomId),
          east = room?.bounds.x1 > 0;
        const dx = r.roomId === "G-I01" ? -1.2 : east ? 1.15 : -1.15,
          dz = r.roomId === "G-I01" ? -0.3 : 0.65;
        this.camera.position.set(
          r.position[0] + dx,
          r.position[1] + 0.55,
          r.position[2] + dz,
        );
        if (room) {
          this.camera.position.x = Math.max(
            room.bounds.x1 + 0.2,
            Math.min(room.bounds.x2 - 0.2, this.camera.position.x),
          );
          this.camera.position.z = Math.max(
            room.bounds.z1 + 0.2,
            Math.min(room.bounds.z2 - 0.2, this.camera.position.z),
          );
        }
      }
      this.controls.update();
    }
    this.onSelect(r.data);
    this.applyLayers();
    this.render();
    this.onStateChange();
  }
  inspectAsset(part) {
    this.clearSelection();
    this.washroomDetail = false;
    this.onSelect(part);
    this.applyLayers();
    this.render();
    this.onStateChange();
  }
  selectRoom(id, focus = true) {
    this.devicePlanMode = false;
    this.selectedDeviceId = "";
    this.servicePlanMode = false;
    this.selectedServiceId = "";
    const room = this.model.rooms.find((item) => item.id === id);
    if (!room) return;
    this.selectedRoomId = room.id;
    if (focus) {
      this.controls.minDistance = 12;
      this.camera.fov = 36;
      this.camera.updateProjectionMatrix();
    }
    this.equipmentEye = false;
    this.washroomDetail = false;
    if (String(room.floor) !== this.floor) this.setFloor(String(room.floor));
    const b = room.bounds,
      y = room.floor * FLOOR_HEIGHT;
    this.clearSelection();
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
    this.selection.userData.roomId = room.id;
    this.scene.add(this.selection);
    if (focus) {
      this.controls.target.set((b.x1 + b.x2) / 2, y + 0.5, (b.z1 + b.z2) / 2);
      this.camera.position
        .copy(this.controls.target)
        .add(
          this.view === "plan"
            ? new THREE.Vector3(0, 24, 0.01)
            : ["wc", "accessible-wc"].includes(room.furniture)
              ? new THREE.Vector3(0, 12, 2)
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
    this.applyLayers();
    this.render();
  }
  showWashroom(roomId) {
    const room =
      this.model.rooms.find(
        (r) => r.id === roomId && ["wc", "accessible-wc"].includes(r.furniture),
      ) ||
      this.model.rooms.find(
        (r) =>
          r.floor === Number(this.floor === "all" ? "0" : this.floor) &&
          r.furniture === "wc",
      );
    this.view = "offices";
    this.lowWalls = false;
    this.washroomDoors = false;
    this.labels = false;
    this.systems = false;
    this.egressPaths = false;
    this.selectRoom(room.id);
    this.washroomDetail = true;
    this.applyLayers();
    this.render();
    this.onStateChange();
  }
  selectEquipment(id, focus = true, portName = null, eye = false) {
    this.devicePlanMode = false;
    this.selectedDeviceId = "";
    this.selectedServiceId = "";
    const record = this.model.equipment.assets.find(
      (r) => r.definition.assetId === id,
    );
    if (!record) return;
    this.clearSelection();
    this.equipment = true;
    this.selectedEquipmentId = id;
    if (focus) {
      this.systems = false;
      this.view = "offices";
      this.setFloor(String(record.definition.floor));
      this.equipmentEye = eye;
      this.controls.minDistance = 0.6;
      this.camera.fov = eye ? 80 : 36;
      this.camera.updateProjectionMatrix();
      this.lowWalls = !eye;
      this.labels = false;
      this.services = false;
      this.equipmentConnections = false;
      const d = record.definition,
        h = d.size?.[2] ?? 2.4;
      const position = record.object.getWorldPosition(new THREE.Vector3());
      this.controls.target.copy(position).y += Math.min(h * 0.55, 1.2);
      const normal = d.serviceFace || [0, 1];
      if (eye) {
        const half = d.type === "ahu" ? d.size[0] / 2 : (d.size?.[1] || 3) / 2;
        const access = Math.min((d.clearance || 1.2) - 0.15, 1.45);
        this.camera.position.set(
          position.x + normal[0] * (half + access),
          position.y + 1.65,
          position.z + normal[1] * (half + access),
        );
      } else
        this.camera.position
          .copy(this.controls.target)
          .add(
            new THREE.Vector3(
              normal[0] * 5 + normal[1] * 3,
              6,
              normal[1] * 5 - normal[0] * 3,
            ),
          );
      this.controls.update();
    }
    this.onSelect({
      ...record.object.userData,
      portName,
      ports: record.portRecords.map((p) => p.name),
    });
    this.applyLayers();
    this.render();
    this.onStateChange();
  }
  selectWashroomPoint(id) {
    const object = this.washroomAssets.get(id);
    if (!object) return;
    this.clearSelection();
    this.washroomPoints = true;
    this.systems = true;
    this.view = "offices";
    this.setFloor(String(object.userData.floor));
    this.model.root.updateMatrixWorld(true);
    object.getWorldPosition(this.controls.target);
    this.camera.position
      .copy(this.controls.target)
      .add(new THREE.Vector3(5, 11, 5));
    this.controls.update();
    this.onSelect(object.userData);
    this.applyLayers();
    this.render();
    this.onStateChange();
  }
  selectExtinguisher(id, focus = true) {
    this.servicePlanMode = false;
    const station = this.model.extinguishers.stations.find(
      (s) => s.assetId === id,
    );
    if (!station) return;
    this.clearSelection();
    this.extinguishers = true;
    this.setFloor(String(station.floor));
    if (focus) {
      this.view = "offices";
      this.controls.target.set(station.x, station.y + 1.35, station.z);
      const [nx, nz] = station.normal;
      this.camera.position.set(
        station.x + nx * 12,
        station.y + 4.1,
        station.z + nz * 12,
      );
      this.controls.update();
    }
    this.onSelect(station);
    this.applyLayers();
    this.render();
    this.onStateChange();
  }
  showExtinguisherPlan() {
    this.devicePlanMode = false;
    this.servicePlanMode = false;
    this.extinguishers = true;
    this.egressSigns = false;
    this.egressPaths = false;
    this.labels = false;
    this.lowWalls = true;
    this.setView("plan");
  }
  selectSign(id, focus = true) {
    this.servicePlanMode = false;
    const sign = this.model.egress.allSigns.find((s) => s.assetId === id);
    if (!sign) return;
    this.clearSelection();
    this.egressSigns = true;
    this.setFloor(String(sign.floor));
    if (focus) {
      this.view = "offices";
      const n = sign.faces[0].normal;
      this.controls.target.set(sign.x, sign.y, sign.z);
      this.camera.position.set(
        sign.x + n[0] * 12,
        sign.y + 3.5,
        sign.z + n[1] * 12,
      );
      this.controls.update();
    }
    this.onSelect(sign);
    this.applyLayers();
    this.render();
    this.onStateChange();
  }
  showExitPlan() {
    this.devicePlanMode = false;
    this.servicePlanMode = false;
    this.egressSigns = true;
    this.egressPaths = true;
    this.labels = false;
    this.lowWalls = true;
    this.model.egress.trace(null);
    this.setView("plan");
  }
  traceExit(roomId) {
    const route = this.model.egress.trace(roomId);
    if (!route) return;
    this.egressSigns = true;
    this.egressPaths = true;
    this.labels = false;
    this.cutaway = true;
    this.floor = "all";
    this.setView("atrium");
    this.controls.target.set(0, 4, 3);
    this.camera.position.set(route.side * 42, 34, 62);
    this.controls.update();
    this.render();
    return route;
  }
  zoom(factor) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.multiplyScalar(factor).clampLength(this.controls.minDistance, 120);
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
    const deviceOccupied = [];
    this.deviceLeaderSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    for (const { record: r, button, leader } of this.deviceLabelButtons) {
      const p =
        r.type === "Z"
          ? [r.bounds.x1 + 0.15, r.bounds.y, r.bounds.z1 + 0.15]
          : r.position;
      const point = new THREE.Vector3(...p).project(this.camera);
      button.hidden = !(
        this.devicePlanMode &&
        this.deviceLabels &&
        this.devices &&
        this.view === "plan" &&
        this.deviceCategories[r.category] &&
        this.floor === String(r.floor) &&
        Math.abs(point.x) < 0.98 &&
        Math.abs(point.y) < 0.95 &&
        point.z > -1 &&
        point.z < 1
      );
      const x = ((point.x + 1) / 2) * width,
        y = ((-point.y + 1) / 2) * height;
      let dx = 0,
        dy = 0;
      if (!button.hidden) {
        const offsets = [
          [0, 0],
          [10, 0],
          [-10, 0],
          [0, -10],
          [0, 10],
          [14, -12],
          [-14, -12],
          [14, 12],
          [-14, 12],
          [22, 0],
          [-22, 0],
          [0, -22],
          [0, 22],
          [24, -20],
          [-24, -20],
          [24, 20],
          [-24, 20],
        ];
        const free = offsets.find(
          ([a, b]) =>
            !deviceOccupied.some(
              (p) => Math.abs(p.x - x - a) < 20 && Math.abs(p.y - y - b) < 18,
            ),
        );
        if (free) [dx, dy] = free;
        deviceOccupied.push({ x: x + dx, y: y + dy });
      }
      button.style.left = `${x + dx}px`;
      button.style.top = `${y + dy}px`;
      leader.style.display = !button.hidden && (dx || dy) ? "" : "none";
      leader.setAttribute("x1", x);
      leader.setAttribute("y1", y);
      leader.setAttribute("x2", x + dx);
      leader.setAttribute("y2", y + dy);
    }
    for (const { floor, x, z, systems, button } of this.serviceLabelButtons) {
      const point = new THREE.Vector3(
        x,
        floor * FLOOR_HEIGHT + 3.95,
        z,
      ).project(this.camera);
      button.hidden = !(
        this.servicePlanMode &&
        this.view === "plan" &&
        this.systems &&
        this.floor === String(floor) &&
        systems.some((s) => this.serviceLayers[s]) &&
        Math.abs(point.x) < 0.98 &&
        Math.abs(point.y) < 0.95 &&
        point.z > -1 &&
        point.z < 1
      );
      button.style.left = `${((point.x + 1) / 2) * width}px`;
      button.style.top = `${((-point.y + 1) / 2) * height}px`;
    }
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
    for (const { sign, button } of this.egressLabelButtons) {
      const point = new THREE.Vector3(
        sign.x,
        sign.floor * FLOOR_HEIGHT + 0.16,
        sign.z,
      ).project(this.camera);
      button.hidden = !(
        this.egressSigns &&
        this.view === "plan" &&
        String(sign.floor) === this.floor &&
        Math.abs(point.x) < 0.98 &&
        Math.abs(point.y) < 0.97 &&
        point.z > -1 &&
        point.z < 1
      );
      button.style.left = `${((point.x + 1) / 2) * width}px`;
      button.style.top = `${((-point.y + 1) / 2) * height}px`;
    }
    for (const { station, button } of this.extinguisherLabelButtons) {
      const point = new THREE.Vector3(
        station.x,
        station.y + 0.16,
        station.z,
      ).project(this.camera);
      button.hidden = !(
        this.extinguishers &&
        !this.servicePlanMode &&
        !this.devicePlanMode &&
        this.view === "plan" &&
        String(station.floor) === this.floor &&
        Math.abs(point.x) < 0.98 &&
        Math.abs(point.y) < 0.97 &&
        point.z > -1 &&
        point.z < 1
      );
      button.style.left = `${((point.x + 1) / 2) * width}px`;
      button.style.top = `${((-point.y + 1) / 2) * height}px`;
    }
    const endpoint = document.getElementById("egressEndpoint");
    const currentRoute = this.model.egress.current;
    const endpointX = currentRoute ? currentRoute.side * 21.05 : 2.65;
    const endpointPoint = new THREE.Vector3(endpointX, 0.2, 22).project(
      this.camera,
    );
    endpoint.hidden = !(
      this.egressPaths &&
      ["all", "0"].includes(this.floor) &&
      Math.abs(endpointPoint.x) < 0.9 &&
      Math.abs(endpointPoint.y) < 0.94 &&
      endpointPoint.z > -1 &&
      endpointPoint.z < 1
    );
    endpoint.style.left = `${((endpointPoint.x + 1) / 2) * width}px`;
    endpoint.style.top = `${((-endpointPoint.y + 1) / 2) * height}px`;
    this.canvas.dataset.egressSigns = String(this.egressSigns);
    this.canvas.dataset.extinguishers = String(this.extinguishers);
    this.canvas.dataset.washroomPoints = String(this.washroomPoints);
    this.canvas.dataset.washroomClearances = String(this.washroomClearances);
    this.canvas.dataset.washroomDoors = String(this.washroomDoors);
    this.canvas.dataset.washroomDetail = String(this.washroomDetail);
    this.canvas.dataset.equipment = String(this.equipment);
    this.canvas.dataset.serviceLayers = JSON.stringify(this.serviceLayers);
    this.canvas.dataset.devices = String(this.devices);
    this.canvas.dataset.deviceSelection = this.selectedDeviceId;
    this.canvas.dataset.devicePlan = String(this.devicePlanMode);
    this.canvas.dataset.deviceCategories = JSON.stringify(
      this.deviceCategories,
    );
    this.canvas.dataset.deviceConnections = String(this.deviceConnections);
    this.canvas.dataset.deviceRoutes = String(this.deviceRoutes);
    this.canvas.dataset.serviceSelection = this.selectedServiceId;
    this.canvas.dataset.serviceShafts = String(this.serviceShafts);
    this.canvas.dataset.serviceAccess = String(this.serviceAccess);
    this.canvas.dataset.serviceEnvelopes = String(this.serviceEnvelopes);
    this.canvas.dataset.equipmentSelection = this.selectedEquipmentId;
    this.canvas.dataset.equipmentEye = String(this.equipmentEye);
    this.canvas.dataset.equipmentClearances = String(this.equipmentClearances);
    this.canvas.dataset.equipmentPorts = String(this.equipmentPorts);
    this.canvas.dataset.equipmentConnections = String(
      this.equipmentConnections,
    );
    this.canvas.dataset.roomSelection = this.selection?.visible
      ? this.selection.userData.roomId
      : "";
    this.canvas.dataset.egressPaths = String(this.egressPaths);
    this.canvas.dataset.egressTrace = currentRoute?.roomId || "";
    this.canvas.dataset.ready = "true";
    this.canvas.dataset.floor = String(this.floor);
    this.canvas.dataset.view = this.view;
    this.canvas.dataset.furniture = String(this.furniture);
    this.canvas.dataset.lowWalls = String(this.lowWalls);
    this.canvas.dataset.services = String(this.services);
    this.canvas.dataset.systems = String(this.systems);
    this.canvas.dataset.ceilings = String(this.ceilings);
    this.canvas.dataset.roofVisible = String(this.model.roof.visible);
    this.canvas.dataset.ceilingsVisible = String(
      this.model.services.ceilings.some((part) => part.visible),
    );
  }
}

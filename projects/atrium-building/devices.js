/* D02 candidate assets and explicit, unconnected measurement/interface records.
   Existing air terminals, lights and washroom point IDs are reused. */
import * as THREE from "three";
import { builder, group, finish } from "./geometry.js";
import {
  ALL_ROOMS,
  FLOORS,
  CORRIDORS,
  ENVELOPE,
  ROOM_FLOOR_TOP,
  doorPosition,
} from "./layout.js";
import { washroomPlan } from "./washroom-plan.js";
import {
  DEVICE_TYPES,
  DEVICE_CATEGORIES,
  deviceRoomSpec,
  roomPoint,
  wallCandidates,
  wallPose,
  deviceOccupancyCandidate,
} from "./device-plan.js";
import { ROUTE_PROFILES, branchTo } from "./main-service-plan.js";

export function createRoomDevices({
  root,
  floors,
  roof,
  interiors,
  services,
  equipment,
  mainServices,
}) {
  const geo = builder(),
    assets = [],
    aliases = [],
    issues = [],
    connections = [];
  const layers = floors.map((f, floor) =>
    Object.fromEntries(
      Object.keys(DEVICE_CATEGORIES).map((c) => [
        c,
        group(f, `D02 ${c}`, { floor, layer: "room-devices", category: c }),
      ]),
    ),
  );
  const connectionLayers = floors.map((f, floor) =>
    group(f, `D02 logical connection studies ${floor}`, {
      layer: "device-connections",
      floor,
    }),
  );
  const roofStudies = group(roof, "D02 tall-atrium studies", {
    layer: "room-devices",
    category: "pending",
  });
  const mats = {
    white: finish(0xeeeede),
    dark: finish(0x455763),
    metal: finish(0x99a8a9, { metalness: 0.55 }),
    light: finish(0xffeac5, { emissive: 0xffd58b, emissiveIntensity: 0.4 }),
    ...Object.fromEntries(
      Object.entries(DEVICE_TYPES).map(([k, v]) => [k, finish(v.color)]),
    ),
  };
  const byRoom = new Map(ALL_ROOMS.map((r) => [r.id, r]));
  root.updateMatrixWorld(true);
  // Full-height model geometry is checked before any inspection cutaway is applied.
  const blockers = [];
  function boxes(parent) {
    parent.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      const collect = (m, d) => {
        if (["furniture", "fixture", "door", "structure"].includes(d.kind))
          blockers.push(o.geometry.boundingBox.clone().applyMatrix4(m));
      };
      if (o.isInstancedMesh)
        for (let i = 0; i < o.count; i++) {
          const m = new THREE.Matrix4();
          o.getMatrixAt(i, m);
          collect(
            o.matrixWorld.clone().multiply(m),
            o.userData.instances?.[i] || o.userData,
          );
        }
      else collect(o.matrixWorld, o.userData);
    });
  }
  boxes(root);
  const bodyBox = (p, size) =>
    new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(...p),
      new THREE.Vector3(...size),
    );
  function wallFree(room, pose, size = [0.2, 0.25, 0.09]) {
    const position = [
        pose.position[0],
        room.floor * 4.2 + pose.position[1],
        pose.position[2],
      ],
      box = bodyBox(position, size);
    if (blockers.some((b) => b.intersectsBox(box))) return false;
    return !ALL_ROOMS.filter((r) => r.floor === room.floor).some((r) =>
      r.doors.some((d) => {
        const p = doorPosition(r, d),
          tangent = pose.axis === 2 ? p.z : p.x,
          fixed = pose.axis === 2 ? p.x : p.z;
        return (
          (["W", "E"].includes(d.side) ? 2 : 0) === pose.axis &&
          Math.abs(fixed - position[pose.axis === 2 ? 0 : 2]) < 0.2 &&
          Math.abs(tangent - position[pose.axis]) < d.width / 2 + 0.28
        );
      }),
    );
  }
  function roomWall(room, height = 1.5) {
    const pose = wallCandidates(room)
      .map((p) => ({ ...p, position: [p.position[0], height, p.position[2]] }))
      .find((p) => wallFree(room, p));
    if (!pose) {
      issues.push(`${room.id} representative wall position unresolved`);
      return null;
    }
    return {
      ...pose,
      position: [pose.position[0], room.floor * 4.2 + height, pose.position[2]],
    };
  }
  function tag(object, id) {
    object.userData.deviceId = id;
    object.traverse((o) => {
      if (!o.isMesh) return;
      o.userData.deviceId = id;
      if (o.userData.instances)
        for (const d of o.userData.instances) d.deviceId = id;
    });
  }
  function add(type, room, position, options = {}) {
    const floor = options.floor ?? room?.floor ?? 0,
      category = options.category || DEVICE_TYPES[type].category,
      id =
        options.id ||
        `${type}-${room.id}-${String(options.index || 1).padStart(2, "0")}`;
    const sensor = options.isSensor ?? DEVICE_TYPES[type].sensor;
    const { object: reusedObject, ...fields } = options;
    const data = {
      assetId: id,
      deviceId: id,
      kind: "room-device",
      type,
      roomId: room?.id || options.roomId || "ATRIUM",
      floor,
      category,
      sourcePage:
        options.sourcePage ||
        deviceRoomSpec(room || { id: "G-ATRIUM", floor: 0, furniture: "none" })
          .page,
      sourceRevision: "D02",
      designStatus: options.designStatus || "candidate",
      dataSource: "unconnected",
      dataStatus: "unavailable",
      hardwareBinding: null,
      telemetry: null,
      isSensor: sensor,
      controlAvailable: false,
      monitoringOnly: true,
      label: `${id} · ${options.label || DEVICE_TYPES[type].label}`,
      detail:
        options.detail ||
        "PDF D02 room-relative concept. Mounting, coverage, quantity, coordination and hardware selection remain unverified. No live reading, command or operating proof is assigned.",
      measurements:
        options.measurements ||
        {
          O: ["presence"],
          T: ["temperature"],
          Q: ["temperature", "CO2"],
          W: ["wet/dry", "sensor health"],
        }[type] ||
        [],
      optionalMeasurements:
        type === "Q"
          ? ["relativeHumidity only if supported by selected hardware"]
          : [],
      signals: options.signals || [],
      ...fields,
    };
    const record = {
      ...data,
      position: [...position],
      normal: options.normal || [0, 1, 0],
      data,
    };
    let object = reusedObject;
    if (object) {
      tag(object, id);
      record.reused = true;
    } else {
      const parent = options.roof ? roofStudies : layers[floor][category];
      object = group(parent, id, data);
      object.position.set(...position);
      if (["T", "Q", "SW"].includes(type)) {
        object.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          new THREE.Vector3(...record.normal),
        );
        geo.box(
          object,
          0,
          0,
          0,
          type === "SW" ? 0.085 : 0.15,
          type === "SW" ? 0.11 : 0.2,
          0.04,
          mats.white,
        );
        geo.box(
          object,
          0,
          0,
          0.023,
          type === "SW" ? 0.05 : 0.1,
          type === "SW" ? 0.065 : 0.08,
          0.008,
          mats[type],
        );
      } else if (type === "O") {
        geo.cylinder(object, 0, 0, 0, 0.075, 0.04, mats.white);
        geo.cylinder(object, 0, -0.022, 0, 0.04, 0.012, mats.O);
      } else if (type === "W") {
        geo.box(object, 0, 0, 0, 0.085, 0.025, 0.055, mats.W);
        geo.box(object, 0, 0.015, 0, 0.03, 0.006, 0.02, mats.white);
      } else if (
        type === "P" &&
        (options.isSensor === false || options.style === "surface")
      ) {
        object.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          new THREE.Vector3(...record.normal),
        );
        geo.box(object, 0, 0, 0.006, 0.07, 0.1, 0.012, mats.white);
        geo.box(object, 0, 0, 0.014, 0.035, 0.025, 0.005, mats.P);
      } else if (type === "P") {
        const normal = new THREE.Vector3(...record.normal);
        object.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          normal,
        );
        geo.cylinder(object, 0, 0.035, 0, 0.014, 0.07, mats.metal);
        geo.box(object, 0, 0.095, 0, 0.085, 0.065, 0.075, mats.P);
      } else if (type === "L")
        geo.box(
          object,
          0,
          0,
          0,
          ...(options.size || [0.14, 0.035, 1.3]),
          mats.light,
        );
    }
    record.object = object;
    assets.push(record);
    return record;
  }
  function diagram(record, points, color, dashed = true) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        points.map((p) => new THREE.Vector3(...p)),
      ),
      dashed
        ? new THREE.LineDashedMaterial({ color, dashSize: 0.14, gapSize: 0.09 })
        : new THREE.LineBasicMaterial({ color }),
    );
    if (dashed) line.computeLineDistances();
    line.raycast = () => {};
    record.object.add(line);
    return line;
  }
  function zone(id, floor, b, options = {}) {
    const r = add(options.type || "Z", null, [0, 0, 0], {
      id,
      floor,
      sourcePage: floor == null ? 4 : floor + 1,
      category: options.category || "zones",
      isSensor: false,
      roomId:
        options.roomId || `${FLOORS[floor]?.prefix || "ATRIUM"}-CIRCULATION`,
      ...options,
    });
    r.bounds = b;
    r.position = [(b.x1 + b.x2) / 2, b.y, (b.z1 + b.z2) / 2];
    diagram(
      r,
      [
        [b.x1, b.y, b.z1],
        [b.x2, b.y, b.z1],
        [b.x2, b.y, b.z2],
        [b.x1, b.y, b.z2],
        [b.x1, b.y, b.z1],
      ],
      DEVICE_TYPES[r.type].color,
    );
    return r;
  }
  function branch(record, target, system = "data") {
    record.connection = { target, system, status: "proposed/unconnected" };
    record.data.connection = record.connection;
    if (!ROUTE_PROFILES[system] || record.category === "pending") return;
    const profile = ROUTE_PROFILES[system],
      points = branchTo(profile, record.floor * 4.2, record.position);
    const g = group(
      connectionLayers[record.floor],
      `${record.assetId} logical field link`,
      {
        diagram: "device-link",
        category: record.category,
        deviceId: record.assetId,
      },
    );
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        points.map((p) => new THREE.Vector3(...p)),
      ),
      new THREE.LineDashedMaterial({
        color: system === "power" ? 0xba962c : 0x9273aa,
        dashSize: 0.12,
        gapSize: 0.1,
      }),
    );
    line.computeLineDistances();
    line.raycast = () => {};
    g.add(line);
    connections.push({
      deviceId: record.assetId,
      target,
      system,
      points,
      object: g,
      detail:
        "Logical branch reservation to existing containment, not a selected or installed field circuit.",
    });
  }
  function legacyAlias(record, legacyId) {
    const p = interiors[record.floor].washrooms.points.find(
      (p) => p.assetId === legacyId,
    );
    if (!p) return;
    const wrapper = group(p.object.parent, `${legacyId} alternate BMS marker`, {
      layer: "device-alias",
    });
    wrapper.add(p.object);
    root.updateMatrixWorld(true);
    p.object.position.copy(
      wrapper.worldToLocal(new THREE.Vector3(...record.position)),
    );
    record.legacyAssetId = legacyId;
    record.data.legacyAssetId = legacyId;
    aliases.push({ record, legacyId, wrapper, object: p.object });
  }
  for (const room of ALL_ROOMS) {
    const spec = deviceRoomSpec(room),
      y = room.floor * 4.2,
      b = room.bounds;
    if (spec.occupancy) {
      const pose = deviceOccupancyCandidate(room);
      const r = add("O", room, [pose[0], y + 3.06, pose[2]], {
        detail: `Non-camera occupancy candidate; review partitions, cubicles and coverage. ${spec.review} No occupancy value or operating state exists.`,
      });
      branch(r, `NET-${FLOORS[room.floor].prefix}-01`);
      if (spec.sanitary) legacyAlias(r, `OCC-${room.id}-AISLE`);
    }
    if (spec.roomSensor) {
      const pose = roomWall(room);
      if (pose) {
        const r = add(spec.roomSensor, room, pose.position, {
          normal: pose.normal,
          sourcePage: ["G-M01", "G-M02"].includes(room.id) ? 4 : spec.page,
          wallSide: pose.side,
          detail: `Representative opaque internal-wall candidate, adjusted from the PDF icon to avoid doors, glazing and furniture. ${spec.review} Q proposes temperature/CO2 only; humidity requires suitable hardware.`,
        });
        branch(
          r,
          spec.plant
            ? room.id === "G-M01"
              ? "CP-FP-01"
              : room.id === "G-M02"
                ? "CP-BS-G-01"
                : room.id.startsWith("L")
                  ? `AHU-L${room.floor}-01`
                  : `NET-${FLOORS[room.floor].prefix}-01`
            : `NET-${FLOORS[room.floor].prefix}-01`,
        );
      }
    }
    if (spec.sanitary || spec.pantry) {
      const p = spec.sanitary ? washroomPlan(room) : null;
      const point = p
        ? p.point(3.82, p.basins[0][1] + 0.12)
        : [b.x1 + 0.9, y, b.z1 + 0.78];
      const r = add(
        "W",
        room,
        [point[0], y + (p ? 0.06 : ROOM_FLOOR_TOP + 0.0125), point[2]],
        {
          leakSource: spec.sanitary
            ? `${room.id}-B1-TRAP`
            : `${FLOORS[room.floor].prefix}-PANTRY-WASTE`,
          detail:
            "Low-level probe beside the actual basin trap/water path; fixture location overrides the schematic W room tag. Sensor health and wet/dry state are separate unavailable points.",
        },
      );
      branch(r, `GW-G-01`);
      if (spec.sanitary) legacyAlias(r, `LD-${room.id}-01`);
    }
    if (
      spec.ordinary ||
      spec.sanitary ||
      spec.pantry ||
      spec.plant ||
      room.furniture === "janitor"
    ) {
      zone(
        `Z-${room.id}-L`,
        room.floor,
        {
          x1: b.x1 + 0.45,
          x2: b.x2 - 0.45,
          z1: b.z1 + 0.6,
          z2: b.z2 - 0.6,
          y: y + 3.015,
        },
        {
          roomId: room.id,
          label: "L work zone · not a luminaire count",
          detail:
            "PDF L outline: lighting design/work zone only. Existing/illustrative fixtures do not establish illumination, switching or emergency coverage.",
        },
      );
      for (const [index, door] of room.doors.entries()) {
        const axis = ["W", "E"].includes(door.side) ? 2 : 0,
          start = axis === 2 ? b.z1 : b.x1,
          end = axis === 2 ? b.z2 : b.x2;
        let pose = null;
        for (const gap of [0.32, 0.46, 0.62]) {
          const t = door.at + door.width / 2 + gap;
          if (t > end - 0.18) continue;
          const p = wallPose(room, door.side, (t - start) / (end - start), 1.1);
          const outer =
            axis === 2
              ? Math.abs(door.side === "W" ? b.x1 : b.x2) === 20 ||
                Math.abs(door.side === "W" ? b.x1 : b.x2) === 5
              : Math.abs(door.side === "N" ? b.z1 : b.z2) === 12;
          if (outer)
            p.position = p.position.map((v, j) => v + p.normal[j] * 0.07);
          if (wallFree(room, p, [0.12, 0.15, 0.1])) {
            pose = p;
            break;
          }
        }
        if (pose) {
          const r = add(
            "SW",
            room,
            [pose.position[0], y + 1.1, pose.position[2]],
            {
              index: index + 1,
              normal: pose.normal,
              doorIndex: index,
              wallSide: door.side,
              detail:
                "Local lighting switch candidate on the closed-door latch side, outside the modeled door opening/swing. Height is a modeling assumption; accessibility and circuit design unverified. Emergency lighting remains independent.",
            },
          );
          branch(r, `DB-${FLOORS[room.floor].prefix}`, "power");
        } else issues.push(`${room.id} latch-side switch needs review`);
      }
    }
  }
  // Reuse each physical grille; E remains one extraction zone with all cubicle terminals.
  const terminalCounters = new Map();
  for (const t of services.terminals) {
    const room = byRoom.get(t.roomId),
      spec = deviceRoomSpec(room);
    if (!spec.ordinary && !spec.sanitary && !spec.pantry) continue;
    if (t.system === "return" && !spec.returnCount) continue;
    const type =
        t.system === "supply" ? "S" : t.system === "return" ? "R" : "E",
      key = `${type}-${room.id}`,
      index = (terminalCounters.get(key) || 0) + 1;
    terminalCounters.set(key, index);
    const routeId = t.routeId || `${room.id}-${t.system.toUpperCase()}`,
      object = services.terminalGroups.find(
        (g) =>
          g.userData.roomId === room.id &&
          g.userData.system === t.system &&
          (!t.routeId || g.userData.assetId === `${t.routeId}-GRILLE`),
      );
    const r = add(type, room, t.position, {
      index,
      object,
      isSensor: false,
      supplemental: spec.sanitary && type === "S",
      designStatus: "existing-concept",
      legacyAssetId: object.userData.assetId,
      connection: {
        target: t.system === "exhaust" ? routeId : `${routeId}-R01`,
        system: t.system,
        status: "connected model geometry / uncommissioned",
      },
      detail: `D02 ${type} zone represented by a retained physical terminal connected to its own ${t.system} branch. No sensor reading, airflow measurement, final outlet quantity or fan operation is implied.`,
    });
    r.data.legacyAssetId = r.legacyAssetId;
  }
  for (const l of services.lights) {
    const room = byRoom.get(l.roomId);
    if (!room) continue;
    const r = add("L", room, l.position, {
      id: l.id,
      object: l.object,
      isSensor: false,
      designStatus: "existing-concept",
      signals: [
        "lighting command (unconnected)",
        "status if hardware provides it (unavailable)",
      ],
      detail:
        "Retained illustrative luminaire within an L work zone. No calculated fixture count, illumination coverage or operating proof is asserted.",
    });
    branch(r, `DB-${FLOORS[room.floor].prefix}`, "power");
  }
  for (const f of FLOORS) {
    for (const [i, c] of CORRIDORS.entries())
      zone(
        `Z-${f.prefix}-COR-${i + 1}`,
        f.index,
        {
          ...c,
          x1: c.x1 + 0.15,
          x2: c.x2 - 0.15,
          z1: c.z1 + 0.15,
          z2: c.z2 - 0.15,
          y: f.index * 4.2 + 3.015,
        },
        { label: "Corridor lighting work zone", sourcePage: f.index + 1 },
      );
    if (f.index)
      zone(
        `Z-${f.prefix}-FRONT-GALLERY`,
        f.index,
        { x1: -2.5, x2: 2.5, z1: 7.5, z2: 10.3, y: f.index * 4.2 + 3.015 },
        {
          label: "Front-gallery L work zone · support/lighting design pending",
        },
      );
    for (const [wing, x1, x2] of [
      ["WEST", -19.5, -5.5],
      ["EAST", 5.5, 19.5],
    ])
      zone(
        `F-${f.prefix}-CEILING-STUDY-${wing}`,
        f.index,
        { x1, x2, z1: -11.5, z2: 11.5, y: f.index * 4.2 + 3.02 },
        {
          type: "F",
          category: "pending",
          sourcePage: 4,
          designStatus: "design-pending",
          scopeRoomIds: ALL_ROOMS.filter(
            (r) =>
              r.floor === f.index &&
              deviceRoomSpec(r).ordinary &&
              (wing === "WEST" ? r.bounds.x2 < 0 : r.bounds.x1 > 0),
          ).map((r) => r.id),
          label: `${wing.toLowerCase()} wing detection / notification / sprinkler study`,
          detail:
            "Study boundary only, not coverage. All ordinary occupied rooms need a coordinated ceiling design. No one-per-room devices inferred. Detector/notification circuits need FACP design; sprinkler heads need coordinated fire branches and have no individual telemetry. Atrium strategy is reserved separately.",
        },
      );
    for (const side of ["S01", "S02"]) {
      const room = byRoom.get(`${f.prefix}-${side}`);
      zone(
        `F-${room.id}-EMERGENCY`,
        f.index,
        { ...room.bounds, y: f.index * 4.2 + 2.9 },
        {
          type: "F",
          category: "pending",
          sourcePage: 4,
          roomId: room.id,
          designStatus: "design-pending",
          label: "Stair emergency lighting / exit-device study",
          detail:
            "Keep existing exit signs and extinguishers. Emergency illumination, manual stations, notification coverage and selected monitored doors cannot be finalized from routing centerlines. No installed emergency lights, call points or door contacts are asserted.",
        },
      );
    }
  }
  zone(
    "F-G-ATRIUM-LIGHTING",
    0,
    { x1: -2.2, x2: 2.2, z1: 6.7, z2: 10.2, y: 3.6 },
    {
      type: "F",
      category: "pending",
      sourcePage: 4,
      designStatus: "design-pending",
      roomId: "ATRIUM",
      label: "Reception / tall-atrium lighting and sensing study",
      detail:
        "Coordinate reception/lounge lighting and sensing with the tall volume and maintenance access. No floating ordinary-room ceiling package placed across the atrium void.",
    },
  );
  zone(
    "F-ATRIUM-HIGH-D02",
    2,
    { x1: -1.4, x2: 1.4, z1: 1, z2: 4, y: 13.4 },
    {
      type: "F",
      category: "pending",
      roof: true,
      sourcePage: 4,
      designStatus: "design-pending",
      roomId: "ATRIUM",
      label: "High-level atrium fire/life-safety study",
      detail:
        "High-level detection, notification and sprinkler/smoke coverage need an engineered strategy. Beam/aspirating detection are options, not selected devices. Refer to the separate R01 smoke reservations; AURA remains monitoring-only.",
    },
  );

  // Actual equipment/duct measurement anchors, never the P room-tag coordinates.
  function equipmentPoint(id, local) {
    const r = equipment.assets.find((a) => a.definition.assetId === id);
    return r.object.localToWorld(new THREE.Vector3(...local)).toArray();
  }
  function portPoint(id, name) {
    const r = equipment.assets.find((a) => a.definition.assetId === id);
    return r.portRecords
      .find((p) => p.name === name)
      .object.getWorldPosition(new THREE.Vector3())
      .toArray();
  }
  function plantProbe(id, roomId, position, options) {
    return add("P", byRoom.get(roomId), position, {
      id,
      sourcePage: 4,
      ...options,
    });
  }
  for (const [suffix, name] of [
    ["SUC", "SUCTION"],
    ["DIS", "DISCHARGE"],
  ]) {
    const anchor = portPoint("FP-01", name),
      r = plantProbe(`P-G-M01-${suffix}-01`, "G-M01", anchor, {
        normal: suffix === "SUC" ? [1, 0, 0] : [1, 0, 0],
        anchor: [...anchor],
        anchorAssetId: "FP-01",
        anchorPort: name,
        measurements: ["pressure"],
        connection: {
          target: "CP-FP-01",
          system: "fire monitoring",
          status: "unconnected",
        },
        detail:
          "Pressure-transmitter tapping candidate on the actual main-pump fitting. Suction and discharge are separate points; selected tapping, isolation and approved monitoring interface require design. No pressure value or start/stop control.",
      });
  }
  const bp = portPoint("BS-G-01", "DISCHARGE");
  plantProbe("P-G-M02-PRESS-01", "G-M02", bp, {
    normal: [0, 1, 0],
    anchor: bp,
    anchorAssetId: "BS-G-01",
    anchorPort: "DISCHARGE",
    measurements: ["pressure"],
    connection: {
      target: "CP-BS-G-01",
      system: "domestic water",
      status: "unconnected",
    },
    detail:
      "Pressure probe on actual booster discharge pipework, separate from fire water. No measured pressure or controller binding.",
  });
  for (const [roomId, unitId] of [
    ["G-M01", "FP-01"],
    ["G-M02", "BS-G-01"],
  ]) {
    const unit = equipment.assets.find((a) => a.definition.assetId === unitId),
      point = equipmentPoint(unitId, [
        unit.definition.size[0] / 2 + 0.1,
        0.04,
        0,
      ]);
    point[1] = ROOM_FLOOR_TOP + 0.0125;
    const r = add("W", byRoom.get(roomId), point, {
      sourcePage: 4,
      leakSource: unitId,
      detail:
        "Low-level leak candidate beside actual water equipment/base, kept out of the front working aisle. Wet/dry and sensor health are unavailable.",
    });
    r.connection = {
      target: roomId === "G-M01" ? "CP-FP-01" : "CP-BS-G-01",
      system: "local monitoring",
      status: "unconnected",
    };
    r.data.connection = r.connection;
  }
  for (const [id, roomId, local, signals] of [
    [
      "CP-FP-01",
      "G-M01",
      [0.18, 1.6, 0.245],
      ["running proof", "available", "fault"],
    ],
    [
      "CP-JP-01",
      "G-M01",
      [0.1, 1.18, 0.195],
      ["running proof", "available", "fault"],
    ],
    [
      "CP-BS-G-01",
      "G-M02",
      [0.15, 1.31, 0.22],
      ["running proof", "fault", "local controller status"],
    ],
    [
      "MDB-G-01",
      "G-E01",
      [-0.6, 1.7, 0.445],
      ["meter interface if hardware provides it", "controller status"],
    ],
    [
      "UPS-G-01",
      "G-I01",
      [0.12, 1.1, 0.445],
      [
        "UPS available",
        "UPS fault",
        "battery data only if hardware provides it",
      ],
    ],
  ]) {
    plantProbe(`P-${roomId}-${id}-IF`, roomId, equipmentPoint(id, local), {
      normal: new THREE.Vector3(0, 0, 1)
        .applyQuaternion(
          equipment.assets.find((a) => a.definition.assetId === id).object
            .quaternion,
        )
        .toArray(),
      anchorAssetId: id,
      isSensor: false,
      measurements: [],
      signals,
      connection: {
        target: id,
        system:
          id.includes("FP") || id.includes("JP")
            ? "fire monitoring"
            : "BMS interface",
        status: "unconnected",
      },
      detail:
        "Electrical/controller interface reservation on the actual equipment. Separate signals are unavailable; no synthesized hardware data, command or operating proof. Fire interfaces are monitoring-only.",
    });
  }
  const rackIn = equipmentPoint("SR-G-01", [0, 1.15, 0.54]);
  plantProbe("P-G-I01-RACK-INLET-01", "G-I01", rackIn, {
    anchorAssetId: "SR-G-01",
    normal: [0, 0, 1],
    style: "surface",
    connection: {
      target: "SR-G-01",
      system: "rack environment interface",
      status: "unconnected",
    },
    measurements: ["rack inlet temperature (optional hardware)"],
    detail:
      "Optional inlet-temperature candidate at the actual rack front. Room temperature is a separate T asset; hardware, sampling and thresholds unselected.",
  });
  const cp = portPoint("CRAC-G-01", "CONDENSATE");
  add(
    "W",
    byRoom.get("G-I01"),
    [cp[0] + 0.135, ROOM_FLOOR_TOP + 0.0125, cp[2] - 0.295],
    {
      sourcePage: 4,
      leakSource: "CRAC-G-01:CONDENSATE",
      connection: {
        target: "GW-G-01",
        system: "local leak monitoring",
        status: "unconnected",
      },
      detail:
        "Leak probe adjacent to the actual cooling condensate connection path. Final drainage route and leak containment need coordination; no wet pipe is introduced above electrical equipment.",
    },
  );
  // Electrical-room water risk is not invented: register a pending location rather than a false leak source.
  const er = byRoom.get("G-E01");
  zone(
    "P-G-E01-LEAK-REVIEW",
    0,
    {
      x1: er.bounds.x1 + 0.3,
      x2: er.bounds.x1 + 0.7,
      z1: -6.8,
      z2: -6.4,
      y: 0.08,
    },
    {
      type: "F",
      category: "pending",
      roomId: er.id,
      sourcePage: 4,
      designStatus: "design-pending",
      label: "Electrical-room leak-risk review",
      detail:
        "D02 calls for leak sensing near actual water/condensate risks. No such local path is currently modeled in this dry room, so no arbitrary wall/floor leak sensor is fitted.",
    },
  );
  for (const zoneAsset of equipment.assets.filter(
    (a) => a.definition.type === "tank-reservation",
  )) {
    const p = zoneAsset.object.position,
      b = new THREE.Box3().setFromObject(zoneAsset.object);
    zone(
      `P-${zoneAsset.definition.assetId}-LEVEL-PENDING`,
      0,
      {
        x1: p.x - 0.2,
        x2: p.x + 0.2,
        z1: p.z - 0.2,
        z2: p.z + 0.2,
        y: b.max.y,
      },
      {
        type: "F",
        category: "pending",
        roomId: "YARD",
        sourcePage: 4,
        designStatus: "awaiting-tank",
        label: "Tank-level instrumentation awaits actual tank",
        anchorAssetId: zoneAsset.definition.assetId,
        detail:
          "Place a future level sensor on the actual tank. This model contains only a tank-space reservation; no fitted level probe or tank reading is asserted.",
      },
    );
  }
  for (const floor of [1, 2]) {
    const id = `AHU-L${floor}-01`,
      room = byRoom.get(`L${floor}-M01`),
      y = floor * 4.2;
    for (const [suffix, system] of [
      ["SA", "SUPPLY"],
      ["OA", "OUTDOOR-AIR"],
      ["RA", "RETURN"],
    ]) {
      const route = mainServices.routes.find(
          (r) =>
            r.id ===
            `L${floor}-${system === "OUTDOOR-AIR" ? system : `AHU-${system}`}-R01`,
        ),
        anchor = [route.points[0][0], y + 2.65, route.points[0][2]];
      plantProbe(
        `P-L${floor}-M01-${suffix}-TEMP-01`,
        room.id,
        [anchor[0] + route.width / 2, anchor[1], anchor[2]],
        {
          normal: [1, 0, 0],
          anchor,
          anchorAssetId: id,
          anchorRouteId: route.id,
          measurements: ["duct air temperature"],
          connection: {
            target: id,
            system: "AHU controller",
            status: "unconnected",
          },
          detail:
            "Air-temperature probe on the intended, connected AHU duct. This is an air measurement point, not room temperature or confirmed fan operation.",
        },
      );
    }
    const dpr = plantProbe(
      `P-L${floor}-M01-FILTER-DP-01`,
      room.id,
      equipmentPoint(id, [0.576, 0.9, -0.85]),
      {
        normal: [1, 0, 0],
        anchorAssetId: id,
        measurements: ["filter differential pressure"],
        connection: {
          target: id,
          system: "AHU controller",
          status: "unconnected",
        },
        filterPlaneAssumed: -0.85,
        detail:
          "Two tapping candidates straddle an assumed rear filter plane inside the AHU envelope. Actual filter location/access, tubing and transmitter selection need manufacturer coordination; the placeholder has no verified filter internals.",
      },
    );
    for (const z of [-1.15, -0.55]) {
      const tap = equipmentPoint(id, [0.576, 0.9, z]);
      dpr.data.filterTaps ??= [];
      dpr.data.filterTaps.push(tap);
      root.updateMatrixWorld(true);
      const delta = dpr.object.worldToLocal(new THREE.Vector3(...tap));
      diagram(dpr, [[0, 0, 0], delta.toArray()], 0x9caaad, false);
    }
    plantProbe(
      `P-L${floor}-M01-FAN-IF`,
      room.id,
      equipmentPoint(id, [0.576, 0.8, 0.1]),
      {
        normal: [1, 0, 0],
        anchorAssetId: id,
        isSensor: false,
        measurements: [],
        signals: [
          "enable command (unconnected)",
          "running proof (unavailable)",
          "fault (unavailable)",
        ],
        connection: {
          target: id,
          system: "AHU controller",
          status: "unconnected",
        },
        detail:
          "Fan/controller feedback interface on the corresponding AHU. Command, proof and fault remain distinct unavailable points; no command proves fan operation.",
      },
    );
  }
  // Plant-room linear lights above actual service aisles, with exposed suspension.
  for (const [roomId, x, z] of [
    ["G-M01", -11.7, -7.3],
    ["G-M02", -7.1, -10],
    ["G-E01", 6.9, -9],
    ["G-I01", 11.3, -7.4],
    ["L1-M01", 7.0, -9.2],
    ["L2-M01", 7.0, -9.2],
  ]) {
    const room = byRoom.get(roomId),
      y = room.floor * 4.2,
      r = add("L", room, [x, y + 3.065, z], {
        id: `L-${roomId}-AISLE-01`,
        size: [0.14, 0.035, 1.3],
        sourcePage: 4,
        signals: ["lighting command (unconnected)", "status only if available"],
        detail:
          "Illustrative suspended linear light above the modeled maintenance aisle. Fixture count, task/emergency illumination and accessible controls need design.",
      });
    for (const dz of [-0.58, 0.58])
      geo.beam(r.object, [0, 0.0175, dz], [0, 0.895, dz], 0.01, mats.metal);
    branch(r, `DB-${FLOORS[room.floor].prefix}`, "power");
  }
  geo.flush();
  root.updateMatrixWorld(true);
  return {
    assets,
    layers,
    roofStudies,
    aliases,
    connections,
    connectionLayers,
    issues,
    types: DEVICE_TYPES,
    categories: DEVICE_CATEGORIES,
  };
}

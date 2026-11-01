/* P01 placement models. Every group is movable and independently identifiable.
   Connection graphics are reservations, never an installed/commissioned network. */
import * as THREE from "three";
import { builder, group, finish } from "./geometry.js";
import {
  EQUIPMENT,
  TANK_ZONES,
  EQUIPMENT_YARD,
  EQUIPMENT_YARD_PAD_TOP,
  equipmentBounds,
} from "./equipment-plan.js";
import { ENVELOPE } from "./layout.js";

function labelMaterial(text, color = "#264c56") {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  if (typeof document === "undefined") return m;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 43px sans-serif";
  ctx.fillText(text, 256, 45, 480);
  ctx.font = "500 25px sans-serif";
  ctx.fillText("SIMULATED · MODEL ONLY", 256, 98, 480);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  m.color.set(0xffffff);
  m.map = map;
  return m;
}
export function createEquipment({ root, floors, services }) {
  const geo = builder(),
    assets = [],
    connectionRoutes = [],
    clearances = [];
  const m = {
    metal: finish(0xa6b3b2, { metalness: 0.5, roughness: 0.38 }),
    dark: finish(0x34464d),
    pump: finish(0x9c3033),
    water: finish(0x437b91),
    base: finish(0x7c8483),
    white: finish(0xe0e6de),
    amber: finish(0xd8a153),
    green: finish(0x607b66),
    port: finish(0xd5a052),
    clearance: new THREE.MeshBasicMaterial({
      color: 0xd3a148,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    tank: new THREE.MeshBasicMaterial({
      color: 0x4d9baf,
      transparent: true,
      opacity: 0.07,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  };
  const layers = floors.map((f, i) =>
    group(f, `P01 room equipment · floor ${i}`, {
      floor: i,
      layer: "equipment",
    }),
  );
  const yard = group(root, "P01 rear service yard", {
    floor: 0,
    layer: "equipment",
    kind: "equipment-yard",
  });
  const connections = floors.map((f, i) =>
    group(f, `P01 connection reservations · floor ${i}`, {
      floor: i,
      layer: "equipment-connections",
    }),
  );
  const roofConnections = group(
    services.rooftop,
    "P01 cooling connections at roof",
    { layer: "equipment-connections" },
  );
  function reservedRoute(parent, id, points, detail, anchors = {}) {
    const material = new THREE.LineDashedMaterial({
      color: 0xb38445,
      dashSize: 0.2,
      gapSize: 0.12,
    });
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        points.map((p) => new THREE.Vector3(...p)),
      ),
      material,
    );
    line.computeLineDistances();
    line.userData = { kind: "equipment-connection", label: id, detail };
    line.raycast = () => {};
    parent.add(line);
    connectionRoutes.push({ id, points, detail, object: line, ...anchors });
  }
  function portWorld(record, name) {
    const port = record.portRecords.find((p) => p.name === name);
    if (!port)
      throw new Error(
        `Missing connection port ${record.definition.assetId}/${name}`,
      );
    return record.object
      .localToWorld(new THREE.Vector3(...port.local))
      .toArray();
  }
  for (const a of EQUIPMENT) {
    const asset = group(
      a.roomId === "YARD" ? yard : layers[a.floor],
      a.assetId,
      { ...a, label: `${a.displayId || a.assetId} · ${a.label}` },
    );
    asset.position.set(a.x, a.y, a.z);
    asset.rotation.y = a.rotation;
    const [w, d, h] = a.size,
      fire = a.system.startsWith("fire"),
      body = fire
        ? m.pump
        : a.type === "booster" || a.type === "vessel"
          ? m.water
          : m.metal;
    const ports = group(asset, `${a.assetId} labelled connection ports`, {
      layer: "equipment-ports",
    });
    const clearanceGroup = group(
      asset,
      `${a.assetId} working-space reservations`,
      { layer: "equipment-clearances" },
    );
    const portRecords = [];
    const box = (x, y, z, bw, bh, bd, mat = body, data = {}) =>
      geo.box(asset, x, y, z, bw, bh, bd, mat, data);
    function link(start, end, portName, radius = 0.035) {
      const v1 = new THREE.Vector3(...start),
        v2 = new THREE.Vector3(...end),
        delta = v2.clone().sub(v1);
      const c = v1.add(v2).multiplyScalar(0.5);
      const pipe = geo.cylinder(
        asset,
        ...c.toArray(),
        radius,
        delta.length(),
        m.metal,
        { partRole: "connection", portName },
      );
      pipe.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        delta.normalize(),
      );
    }
    function port(name, x, y, z, normal = [0, 1], labelRise = 0) {
      const direction =
        normal.length === 3
          ? new THREE.Vector3(...normal)
          : new THREE.Vector3(normal[0], 0, normal[1]);
      const data = {
        ...asset.userData,
        assetId: `${a.assetId}:PORT:${name}`,
        equipmentId: a.assetId,
        kind: "equipment-port",
        portName: name,
        label: `${a.assetId} · ${name}`,
      };
      const mesh = geo.cylinder(ports, x, y, z, 0.055, 0.06, m.port, data);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      const plaque = new THREE.Mesh(
        new THREE.PlaneGeometry(0.44, 0.11),
        labelMaterial(name),
      );
      plaque.position.set(
        x + direction.x * 0.07,
        y + 0.13 + direction.y * 0.07 + labelRise,
        z + direction.z * 0.07,
      );
      const labelDirection =
        Math.abs(direction.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : direction;
      plaque.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        labelDirection,
      );
      plaque.userData = data;
      ports.add(plaque);
      if (labelRise) {
        const leader = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(x, y, z),
            plaque.position.clone().add(new THREE.Vector3(0, -0.055, 0)),
          ]),
          new THREE.LineBasicMaterial({ color: 0xb38445 }),
        );
        leader.raycast = () => {};
        ports.add(leader);
      }
      portRecords.push({ name, local: [x, y, z], object: mesh, label: plaque });
    }
    function space(name, x, z, cw, cd, height = 2.1) {
      const object = new THREE.Mesh(
        new THREE.BoxGeometry(cw, height, cd),
        m.clearance,
      );
      object.position.set(x, height / 2, z);
      object.userData = {
        ...asset.userData,
        kind: "equipment-clearance",
        label: `${a.assetId} · ${name} · illustrative only`,
      };
      object.raycast = () => {};
      clearanceGroup.add(object);
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(object.geometry),
        new THREE.LineBasicMaterial({ color: 0xbd9555 }),
      );
      edge.position.copy(object.position);
      edge.raycast = () => {};
      clearanceGroup.add(edge);
      clearances.push({ assetId: a.assetId, name, object });
    }
    // Bases stay inside the declared envelope and sit on the existing finished floor.
    box(0, 0.045, 0, w, 0.09, d, m.base, { partRole: "base" });
    if (["pump", "jockey", "booster"].includes(a.type)) {
      const count = a.type === "booster" ? 2 : 1;
      for (let n = 0; n < count; n++) {
        const x = count === 2 ? (n - 0.5) * 0.65 : 0;
        if (a.type === "pump") {
          const motor = geo.cylinder(asset, -0.4, 0.46, 0, 0.22, 0.8, m.metal, {
            partRole: "motor",
          });
          motor.rotation.z = Math.PI / 2;
          const volute = geo.cylinder(asset, 0.4, 0.46, 0, 0.3, 0.35, body, {
            partRole: "pump-volute",
          });
          volute.rotation.z = Math.PI / 2;
          box(-0.4, 0.21, 0, 0.75, 0.24, 0.55, m.dark, {
            partRole: "support",
            supportFor: "motor",
          });
          box(0.4, 0.2125, 0, 0.45, 0.245, 0.6, body, {
            partRole: "support",
            supportFor: "pump-volute",
          });
          box(0.68, 0.78, 0, 0.18, 0.48, 0.18);
          box(0.68, 1.04, 0, 0.3, 0.06, 0.3, m.metal, {
            partRole: "connection",
            portName: "DISCHARGE",
          });
          link([0, 0.46, 0], [0.25, 0.46, 0], "DRIVE SHAFT", 0.065);
          link([0.55, 0.6, 0], [0.68, 0.6, 0], "DISCHARGE", 0.07);
          link([0.4, 0.46, 0.25], [0.4, 0.46, 0.4], "SUCTION", 0.11);
          box(-0.4, 0.56, -0.23, 0.22, 0.18, 0.12, m.dark, {
            partRole: "connection",
            portName: "POWER",
          });
        } else {
          geo.cylinder(
            asset,
            x,
            0.4,
            0,
            a.type === "jockey" ? 0.12 : 0.15,
            0.48,
            body,
            { partRole: "pump-column" },
          );
          box(x, 0.125, 0, 0.24, 0.07, 0.24, m.dark, {
            partRole: "support",
            supportFor: "pump-column",
          });
          geo.cylinder(
            asset,
            x,
            0.77,
            0,
            a.type === "jockey" ? 0.12 : 0.15,
            0.28,
            m.metal,
          );
          box(x, a.type === "jockey" ? 0.94 : 0.98, 0, 0.24, 0.1, 0.26, m.dark);
        }
      }
      if (a.type === "pump") {
        port("SUCTION", 0.4, 0.46, 0.4, [0, 1]);
        port("DISCHARGE", 0.68, 1.07, 0, [0, 1, 0]);
        port("POWER", -0.4, 0.56, -0.3, [0, -1]);
      } else {
        const offset = Math.min(d * 0.28, 0.22),
          left = -w / 2 + 0.06,
          right = w / 2 - 0.06;
        const centres = count === 2 ? [-0.325, 0.325] : [0];
        for (const x of centres) {
          link([x, 0.28, 0], [x, 0.28, -offset], "SUCTION");
          link([x, 0.57, 0], [x, 0.57, offset], "DISCHARGE");
        }
        link([left, 0.28, -offset], [centres.at(-1), 0.28, -offset], "SUCTION");
        link([centres[0], 0.57, offset], [right, 0.57, offset], "DISCHARGE");
        port("SUCTION", left, 0.28, -offset, [-1, 0]);
        port("DISCHARGE", right, 0.57, offset, [1, 0]);
        port(
          "POWER",
          centres[0],
          0.77,
          a.type === "jockey" ? -0.13 : -0.16,
          [0, -1],
        );
      }
    } else if (a.type === "vessel") {
      geo.cylinder(asset, 0, h * 0.5, 0, w * 0.4, h * 0.7, body, {
        partRole: "pressure-vessel",
      });
      const footTop = h * 0.15;
      for (const x of [-w * 0.23, w * 0.23])
        box(x, (0.09 + footTop) / 2, 0, 0.08, footTop - 0.09, 0.15, m.dark, {
          partRole: "support",
          supportFor: "pressure-vessel",
        });
      geo.cylinder(
        asset,
        0,
        h * 0.89,
        0,
        w * 0.4,
        h * 0.08,
        body,
        {},
        w * 0.16,
      );
      port("WATER ENTRY", 0, 0.2, d / 2 - 0.04);
    } else if (a.type === "condenser") {
      box(0, h * 0.48, 0, w * 0.94, h * 0.78, d * 0.94, body, {
        partRole: "condenser-body",
      });
      const footTop = h * 0.09;
      for (const x of [-w * 0.34, w * 0.34])
        for (const z of [-d * 0.3, d * 0.3])
          box(x, (0.09 + footTop) / 2, z, 0.16, footTop - 0.09, 0.16, m.dark, {
            partRole: "support",
            supportFor: "condenser-body",
          });
      for (const x of [-w * 0.24, w * 0.24]) {
        geo.cylinder(asset, x, h * 0.91, 0, 0.39, 0.13, m.dark, {
          partRole: "fan-shroud",
        });
        for (let j = -2; j <= 2; j++)
          box(x, h * 0.95, j * 0.12, 0.68, 0.02, 0.025, m.metal);
      }
      for (let z = -d * 0.35; z <= d * 0.35; z += 0.17)
        box(-w * 0.48, h * 0.48, z, 0.03, h * 0.64, 0.05, m.dark);
      box(-w * 0.225, 0.35, d * 0.47 + 0.02, 0.55, 0.3, 0.04, m.dark, {
        partRole: "connection",
        portName: "REFRIGERANT A",
      });
      box(w * 0.35, 0.25, d * 0.47 + 0.02, 0.22, 0.2, 0.04, m.dark, {
        partRole: "connection",
        portName: "POWER",
      });
      port("REFRIGERANT A", -w * 0.3, 0.35, d * 0.49);
      port("REFRIGERANT B", -w * 0.15, 0.35, d * 0.49, [0, 1], 0.17);
      port("POWER", w * 0.35, 0.25, d * 0.49);
    } else {
      box(0, h / 2 + 0.045, 0, w * 0.96, h - 0.09, d * 0.96, body);
      const ahu = a.type === "ahu";
      if (ahu) {
        for (const z of [-d / 3, 0, d / 3]) {
          box(-w / 2 - 0.005, h * 0.55, z, 0.025, h * 0.8, d * 0.28, m.dark);
          box(
            -w / 2 - 0.025,
            h * 0.55,
            z + d * 0.08,
            0.025,
            0.2,
            0.035,
            m.metal,
          );
        }
        for (const [name, z] of [
          ["OUTDOOR AIR", -1.0],
          ["RELIEF AIR", -0.35],
          ["SUPPLY AIR", 0.35],
          ["RETURN AIR", 1.0],
        ])
          // Air connections rise from the top, leaving the west filter/coil
          // removal faces clear. IDs and front-to-back port order are retained.
          port(name, 0, h + 0.01, z, [0, 1, 0]);
        port("COIL LINES", w / 2 - 0.03, 0.35, -1.1, [1, 0]);
        port("CONDENSATE", w / 2 - 0.03, 0.12, 1.1, [1, 0]);
        port("POWER", 0, 0.15, -d / 2 + 0.04, [0, -1]);
      } else {
        const sections = a.type === "board" && w > 1 ? 3 : 1;
        for (let i = 0; i < sections; i++) {
          const x = ((i - (sections - 1) / 2) * w) / sections;
          box(
            x,
            h * 0.52,
            d / 2 + 0.007,
            (w / sections) * 0.92,
            h * 0.86,
            0.024,
            a.type === "rack" ? m.dark : m.white,
          );
          box(
            x + (w / sections) * 0.31,
            h * 0.52,
            d / 2 + 0.025,
            0.025,
            0.19,
            0.025,
            m.dark,
          );
          if (a.type === "rack")
            for (let j = 0; j < 9; j++) {
              box(
                x,
                h * 0.2 + j * 0.14,
                d / 2 + 0.025,
                w * 0.76,
                0.07,
                0.025,
                m.metal,
              );
              box(
                x + w * 0.3,
                h * 0.2 + j * 0.14,
                d / 2 + 0.045,
                0.025,
                0.025,
                0.01,
                m.green,
              );
            }
        }
        if (a.type === "cooling")
          for (let i = 0; i < 5; i++)
            box(
              0,
              h * 0.7 + i * 0.06,
              d / 2 + 0.03,
              w * 0.8,
              0.025,
              0.035,
              m.dark,
            );
        port(
          a.type === "rack" ? "DATA ENTRY" : "ELECTRICAL ENTRY",
          0,
          0.12,
          -d / 2 + 0.03,
          [0, -1],
        );
        if (a.type === "cooling") {
          port("COOLING LINES", w * 0.3, 0.35, -d / 2 + 0.03, [0, -1]);
          port("CONDENSATE", -w * 0.3, 0.12, -d / 2 + 0.03, [0, -1], 0.17);
        }
        if (a.assetId === "GW-G-01")
          port("NETWORK / BMS", 0, 0.8, -d / 2 + 0.03, [0, -1]);
      }
    }
    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.min(w * 0.85, 0.9), 0.2),
      labelMaterial(a.displayId || a.assetId, fire ? "#813638" : "#264c56"),
    );
    plaque.position.set(0, Math.min(h * 0.7, 1.35), d / 2 + 0.045);
    if (a.type === "ahu") {
      plaque.position.set(-w / 2 - 0.045, Math.min(h * 0.7, 1.35), 0);
      plaque.rotation.y = -Math.PI / 2;
    }
    plaque.userData = { ...asset.userData };
    asset.add(plaque);
    if (a.type === "ahu")
      space(
        "West service / filter / coil access",
        -w / 2 - a.clearance / 2 - 0.03,
        0,
        a.clearance,
        d + 0.2,
      );
    else
      space(
        "Front working space",
        0,
        d / 2 + a.clearance / 2 + 0.03,
        w + 0.2,
        a.clearance,
      );
    if (a.rearClearance)
      space(
        "Rear access",
        0,
        -d / 2 - a.rearClearance / 2 - 0.03,
        w + 0.2,
        a.rearClearance,
      );
    assets.push({
      definition: a,
      object: asset,
      ports,
      portRecords,
      clearanceGroup,
      bounds: equipmentBounds(a),
    });
  }
  for (const zone of TANK_ZONES) {
    const data = {
      assetId: zone.id,
      kind: "equipment",
      type: "tank-reservation",
      roomId: "YARD",
      floor: 0,
      label: zone.label,
      status: "SIMULATED",
      dataSource: "model-placeholder",
      connected: false,
      monitoringOnly: true,
      controlAvailable: false,
      detail:
        "Space reservation only, not a fitted or sized tank. Need, supply strategy, usable capacity and yard clearances remain unverified.",
      sourcePage: 1,
    };
    const object = group(yard, zone.id, data);
    object.position.set(zone.x, 0, zone.z);
    const shape = new THREE.BoxGeometry(zone.w, zone.h, zone.d);
    const mesh = new THREE.Mesh(shape, m.tank);
    mesh.position.y = zone.h / 2;
    mesh.userData = data;
    mesh.raycast = () => {};
    object.add(mesh);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(shape),
      new THREE.LineDashedMaterial({
        color: 0x3b8795,
        dashSize: 0.2,
        gapSize: 0.15,
      }),
    );
    edges.position.y = zone.h / 2;
    edges.computeLineDistances();
    edges.raycast = () => {};
    object.add(edges);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.4),
      labelMaterial(zone.id),
    );
    label.position.set(0, 1.6, zone.d / 2 + 0.02);
    label.userData = data;
    object.add(label);
    assets.push({
      definition: data,
      object,
      ports: null,
      portRecords: [],
      clearanceGroup: null,
    });
  }
  // Slatted ground-yard screen, open top and a 1.4 m front access gap.
  const b = EQUIPMENT_YARD;
  geo.box(
    yard,
    (b.x1 + b.x2) / 2,
    EQUIPMENT_YARD_PAD_TOP / 2,
    (b.z1 + b.z2) / 2,
    b.x2 - b.x1,
    EQUIPMENT_YARD_PAD_TOP,
    b.z2 - b.z1,
    m.base,
    {
      kind: "yard-pad",
      label: "Proposed ventilated condenser pad · no engineered support",
    },
  );
  for (let y = 0.15; y < 1.55; y += 0.2) {
    geo.box(yard, (b.x1 + b.x2) / 2, y, b.z1, b.x2 - b.x1, 0.09, 0.06, m.dark, {
      kind: "equipment-screen",
    });
    for (const x of [b.x1, b.x2])
      geo.box(yard, x, y, (b.z1 + b.z2) / 2, 0.06, 0.09, b.z2 - b.z1, m.dark, {
        kind: "equipment-screen",
      });
    for (const [x1, x2] of [
      [b.x1, 9.05],
      [10.45, b.x2],
    ])
      geo.box(yard, (x1 + x2) / 2, y, b.z2, x2 - x1, 0.09, 0.06, m.dark, {
        kind: "equipment-screen",
      });
  }
  // Indoor AHU access/replacement routes and high-level connection reservations.
  for (const record of assets.filter((r) => r.definition.type === "ahu")) {
    const a = record.definition,
      y = a.y,
      inlet = portWorld(record, "OUTDOOR AIR");
    reservedRoute(
      connections[a.floor],
      `${a.assetId}-REPLACEMENT`,
      [
        [7.6, y + 0.08, -9.2],
        [6.4, y + 0.08, -9.2],
        [6.4, y + 0.08, -8.7],
        [4, y + 0.08, -8.7],
      ],
      "Nominal 1.20 m component route through the retained 1.30 m door; handling space and whole-unit replacement unverified.",
    );
    reservedRoute(
      connections[a.floor],
      `${a.assetId}-SHAFT-RESERVE`,
      [
        inlet,
        [inlet[0], y + 3.72, inlet[2]],
        [4.2, y + 3.72, -10.2],
        [4.2, y + 3.72, 0.8],
        [12.25, y + 3.72, 0.8],
        [12.25, y + 3.72, -4.6],
      ],
      "Proposed above-ceiling connection via gallery/corridor to HVAC compartment. No route through adjacent flexible/records office; final topology and penetrations unverified.",
      { from: { assetId: a.assetId, port: "OUTDOOR AIR" } },
    );
  }
  // Each vertical cooling reservation belongs to its actual storey, preserving isolation.
  for (const [side, shaftX] of [
    ["West", -9.4],
    ["East", 13.75],
  ]) {
    const z = side === "West" ? -12.52 : -4.6;
    const condenser = assets.find(
      (r) => r.definition.assetId === `ROOF-${side}-COOL`,
    );
    const connection = portWorld(condenser, "REFRIGERANT A");
    for (let floor = 0; floor < 3; floor++) {
      const y = floor * ENVELOPE.floorHeight;
      reservedRoute(
        connections[floor],
        `${side}-COOLING-RISER-P01-${floor}`,
        [
          [shaftX, y, z],
          [shaftX, y + ENVELOPE.floorHeight, z],
        ],
        "Reserved refrigerant/hydronic route; technology, branch capacity and equipment selection remain unresolved.",
      );
    }
    reservedRoute(
      connections[0],
      `${side}-YARD-COOLING-P01`,
      [
        connection,
        [connection[0], 3.25, connection[2]],
        [shaftX, 3.25, connection[2]],
        [shaftX, 3.25, z],
      ],
      "High-level candidate yard connection, clear of the rear pedestrian path at ground height.",
      {
        from: { assetId: condenser.definition.assetId, port: "REFRIGERANT A" },
      },
    );
    reservedRoute(
      roofConnections,
      `${side}-COOLING-ROOF-P01`,
      [
        [shaftX, 12.6, z],
        [shaftX, 14.1, z],
        [side === "West" ? -8.05 : 12.25, 14.1, z],
        [side === "West" ? -8.05 : 12.25, 14.1, -8.1],
      ],
      "Existing rooftop ventilation concept retained; connection reservation only, pending consolidation with indoor AHUs.",
    );
  }
  geo.flush();
  root.updateMatrixWorld(true);
  return {
    assets,
    layers,
    yard,
    connections,
    roofConnections,
    connectionRoutes,
    clearances,
  };
}

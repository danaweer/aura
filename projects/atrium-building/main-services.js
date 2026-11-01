/* PDF R01 coordination model: candidate routes, distinct sources and layers.
   Nothing here asserts pipe/duct sizing, sprinkler coverage or operating proof. */
import * as THREE from "three";
import { builder, group, finish } from "./geometry.js";
import { FLOORS, ENVELOPE, ALL_ROOMS } from "./layout.js";
import { WASHROOM_PLANS } from "./washroom-plan.js";
import {
  ROUTE_SYSTEMS,
  ROUTE_PROFILES,
  SERVICE_RESERVATIONS,
  GROUND_AHU,
  corridorMains,
  branchTo,
  fallingRoute,
  vrfProfile,
  SERVICE_FACADE_OPENINGS,
  coordinateRefrigerantRoutes,
} from "./main-service-plan.js";

export function createMainServices({
  root,
  floors,
  roof,
  equipment,
  services,
}) {
  const geo = builder(),
    routes = [],
    reservations = [],
    assets = [],
    terminals = [];
  const layers = floors.map((parent, floor) =>
    Object.fromEntries(
      Object.keys(ROUTE_SYSTEMS).map((system) => [
        system,
        group(parent, `R01 ${ROUTE_SYSTEMS[system].label}`, {
          layer: "main-services",
          floor,
          system,
        }),
      ]),
    ),
  );
  const roofLayers = Object.fromEntries(
    Object.keys(ROUTE_SYSTEMS).map((system) => [
      system,
      group(roof, `R01 roof ${system}`, { layer: "main-services", system }),
    ]),
  );
  const mats = Object.fromEntries(
    Object.entries(ROUTE_SYSTEMS).map(([s, v]) => [
      s,
      finish(v.color, { roughness: 0.55 }),
    ]),
  );
  const insulationMaterial = new THREE.MeshBasicMaterial({
    color: 0xa79abd,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
  });
  const pipeGeometry = new THREE.CylinderGeometry(1, 1, 1, 10),
    pipeBatches = new Map();
  const detail =
    "PDF R01 conceptual route reservation. Cross-sections are visual allowances; insulation, supports, penetrations, duties, elevations and access require engineering. MODEL ONLY / NOT CONNECTED.";
  const metadata = (id, system, floor, extra = {}) => ({
    assetId: id,
    label: id,
    kind: "main-service",
    system,
    floor,
    sourcePage: ROUTE_SYSTEMS[system].page,
    status: "conceptual",
    connected: false,
    controlAvailable: false,
    detail,
    ...extra,
  });
  function label(parent, id, point, color, width = 0.7) {
    const material = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
    });
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = 512;
      c.height = 128;
      const ctx = c.getContext("2d");
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 512, 128);
      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "bold 48px sans-serif";
      ctx.fillText(id, 256, 64, 480);
      const map = new THREE.CanvasTexture(c);
      map.colorSpace = THREE.SRGBColorSpace;
      material.color.set(0xffffff);
      material.map = map;
    }
    const object = new THREE.Mesh(
      new THREE.PlaneGeometry(width, 0.18),
      material,
    );
    object.position.set(...point);
    object.userData = { ...parent.userData };
    parent.add(object);
    return object;
  }
  function batchPipe(parent, start, end, radius, material, data) {
    if (!pipeBatches.has(parent)) pipeBatches.set(parent, new Map());
    const collection = pipeBatches.get(parent),
      key = material.uuid;
    if (!collection.has(key))
      collection.set(key, { matrices: [], data: [], material });
    const batch = collection.get(key),
      a = new THREE.Vector3(...start),
      b = new THREE.Vector3(...end),
      delta = b.clone().sub(a);
    if (delta.length() < 1e-6) return;
    batch.matrices.push(
      new THREE.Matrix4().compose(
        a.add(b).multiplyScalar(0.5),
        new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          delta.clone().normalize(),
        ),
        new THREE.Vector3(radius, delta.length(), radius),
      ),
    );
    batch.data.push(data);
  }
  function route(id, system, floor, points, opts = {}) {
    // Consecutive equal points need no phantom fittings or zero-length geometry.
    points = points.filter(
      (p, i) =>
        !i || Math.hypot(...p.map((n, axis) => n - points[i - 1][axis])) > 1e-6,
    );
    if (["alarm", "smoke"].includes(system)) opts = { ...opts, pending: true };
    const data = metadata(id, system, floor, opts),
      parent = floor == null ? roofLayers[system] : layers[floor][system];
    const profile = ROUTE_PROFILES[system],
      width = opts.width || profile?.width || 0.05,
      height =
        opts.height ||
        (system === "refrigerant" ? width : profile?.height) ||
        width;
    const record = {
      id,
      system,
      floor,
      points,
      width,
      height,
      ...opts,
      data,
      group: parent,
    };
    routes.push(record);
    assets.push(record);
    // Draw refrigerant only after coordinating both pairs and all floor branches.
    if (system === "refrigerant") return record;
    const dashed =
      opts.example || opts.pending || system === "alarm" || system === "smoke";
    if (dashed) {
      const object = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(
          points.map((p) => new THREE.Vector3(...p)),
        ),
        new THREE.LineDashedMaterial({
          color: ROUTE_SYSTEMS[system].color,
          dashSize: 0.2,
          gapSize: 0.11,
        }),
      );
      object.computeLineDistances();
      object.userData = data;
      object.raycast = () => {};
      parent.add(object);
      record.object = object;
    } else {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i],
          dx = Math.abs(a[0] - b[0]),
          dy = Math.abs(a[1] - b[1]),
          dz = Math.abs(a[2] - b[2]);
        if (["supply", "return"].includes(system)) {
          if ([dx, dy, dz].filter((n) => n > 1e-6).length > 1)
            throw new Error(`Non-orthogonal R01 duct ${id}`);
          geo.box(
            parent,
            (a[0] + b[0]) / 2,
            (a[1] + b[1]) / 2,
            (a[2] + b[2]) / 2,
            dx || width,
            dy || height,
            dz || width,
            mats[system],
            { ...data, segment: i - 1 },
          );
        } else if (["power", "data"].includes(system)) {
          // Shallow, open-topped containment with a visible separation between systems.
          geo.box(
            parent,
            (a[0] + b[0]) / 2,
            (a[1] + b[1]) / 2 - height / 2,
            (a[2] + b[2]) / 2,
            dx || width,
            dy || 0.018,
            dz || width,
            mats[system],
            { ...data, segment: i - 1 },
          );
          if (dy < 1e-6) {
            for (const sign of [-1, 1])
              geo.box(
                parent,
                (a[0] + b[0]) / 2 + (dx ? 0 : (sign * width) / 2),
                (a[1] + b[1]) / 2,
                (a[2] + b[2]) / 2 + (dx ? (sign * width) / 2 : 0),
                dx || 0.018,
                height,
                dz || 0.018,
                mats[system],
                { ...data, segment: i - 1 },
              );
          }
        } else
          batchPipe(parent, a, b, width / 2, mats[system], {
            ...data,
            segment: i - 1,
          });
      }
    }
    if (opts.insulation && !dashed) {
      const envelope = group(parent, `${id} insulation envelope`, {
        diagram: "insulation",
      });
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i];
        if (["supply", "return"].includes(system)) {
          const dx = Math.abs(a[0] - b[0]),
            dy = Math.abs(a[1] - b[1]),
            dz = Math.abs(a[2] - b[2]);
          geo.box(
            envelope,
            (a[0] + b[0]) / 2,
            (a[1] + b[1]) / 2,
            (a[2] + b[2]) / 2,
            (dx || width) + 2 * opts.insulation,
            (dy || height) + 2 * opts.insulation,
            (dz || width) + 2 * opts.insulation,
            insulationMaterial,
            { ...data, kind: "service-envelope" },
          );
        } else
          batchPipe(
            envelope,
            a,
            b,
            width / 2 + opts.insulation,
            insulationMaterial,
            { ...data, kind: "service-envelope" },
          );
      }
    }
    return record;
  }
  function volume(id, system, floor, b, opts = {}) {
    const parent = floor == null ? roofLayers[system] : layers[floor][system],
      data = metadata(id, system, floor, opts);
    const g = group(parent, id, data),
      geometry = new THREE.BoxGeometry(b.w, b.h, b.d);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: ROUTE_SYSTEMS[system].color,
        transparent: true,
        opacity: 0.055,
        depthWrite: false,
      }),
    );
    mesh.position.set(b.x, b.y + b.h / 2, b.z);
    mesh.userData = data;
    mesh.raycast = () => {};
    g.add(mesh);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: ROUTE_SYSTEMS[system].color }),
    );
    edges.position.copy(mesh.position);
    edges.raycast = () => {};
    g.add(edges);
    label(
      g,
      id,
      [b.x, b.y + Math.min(2.8, b.h * 0.7), b.z + b.d / 2 + 0.02],
      `#${ROUTE_SYSTEMS[system].color.toString(16).padStart(6, "0")}`,
      opts.labelWidth || 0.65,
    );
    const record = {
      id,
      system,
      floor,
      bounds: b,
      data,
      object: g,
      reservation: true,
    };
    reservations.push(record);
    assets.push(record);
    return record;
  }
  function port(assetId, name) {
    const asset = equipment.assets.find(
        (a) => a.definition.assetId === assetId,
      ),
      p = asset?.portRecords.find((p) => p.name === name);
    if (!p) throw new Error(`R01 missing port ${assetId}/${name}`);
    root.updateMatrixWorld(true);
    return p.object.getWorldPosition(new THREE.Vector3()).toArray();
  }
  function connection(id, system, floor, assetId, name, tail, opts = {}) {
    return route(id, system, floor, [port(assetId, name), ...tail], {
      ...opts,
      from: { assetId, port: name },
    });
  }
  const main = (system, f) => {
    const p = ROUTE_PROFILES[system],
      y = f * ENVELOPE.floorHeight;
    return corridorMains(p, y).map((r) =>
      route(
        `${FLOORS[f].prefix}-${system.toUpperCase()}-${r.role}-R01`,
        system,
        f,
        r.points,
        {
          role: "main",
          corridor: true,
          ...(["supply", "return"].includes(system)
            ? { insulation: 0.01 }
            : {}),
        },
      ),
    );
  };
  for (const f of FLOORS) {
    const floor = f.index,
      y = floor * ENVELOPE.floorHeight;
    for (const [key, v] of Object.entries(SERVICE_RESERVATIONS)) {
      const system =
        key === "wetLeft" || key === "wetRight"
          ? "cold"
          : key === "hvac"
            ? "refrigerant"
            : key;
      volume(
        `${v.id}-${f.prefix}`,
        system,
        floor,
        { ...v, y, h: ENVELOPE.floorHeight },
        {
          proposed: v.proposed,
          detail: `${v.id}: ${v.proposed ? "proposed reservation; space, enclosure and penetrations unverified" : "within the retained service reservation"}. ${key === "wetRight" ? "Aligned with the existing local sanitary stack and modeled 220 mm openings, separate from electrical/IT/HVAC. " : ""}${detail}`,
        },
      );
    }
    for (const s of ["fire", "supply", "return", "power", "data", "alarm"])
      main(s, floor);
    const fr = SERVICE_RESERVATIONS.fire,
      h = y + ROUTE_PROFILES.fire.y;
    route(
      `FR-01-${f.prefix}-VERTICAL`,
      "fire",
      floor,
      [
        [fr.x, y, fr.z],
        [fr.x, y + 4.2, fr.z],
      ],
      { pending: true, role: "riser", shaft: "FR-01" },
    );
    route(
      `FC-${f.prefix}-01-MAIN`,
      "fire",
      floor,
      [
        [fr.x, h, fr.z],
        [-ROUTE_PROFILES.fire.rear, h, fr.z],
      ],
      { role: "floor-control-feed" },
    );
    const fc = metadata(`FC-${f.prefix}-01`, "fire", floor, {
      label: `FC-${f.prefix}-01 · floor control reservation`,
      detail:
        "Accessible isolation/supervision, flow indication, pressure gauge and test/drain reservation. Device selection, monitoring circuits and approved disposal remain unresolved; no live proof or controls.",
    });
    const assembly = group(layers[floor].fire, fc.assetId, fc);
    geo.box(assembly, fr.x, y + 1.55, fr.z, 0.24, 0.65, 0.22, mats.fire);
    geo.cylinder(
      assembly,
      fr.x - 0.16,
      y + 1.7,
      fr.z + 0.02,
      0.08,
      0.04,
      finish(0xe7e6dd),
    ).rotation.z = Math.PI / 2;
    label(assembly, fc.assetId, [fr.x, y + 2.1, fr.z + 0.15], "#9c3634");
    assets.push({
      id: fc.assetId,
      system: "fire",
      floor,
      data: fc,
      object: assembly,
      points: [[fr.x, y + 1.55, fr.z]],
    });
    volume(
      `${fc.assetId}-ACCESS`,
      "fire",
      floor,
      { x: fr.x - 0.52, y, z: fr.z, w: 0.65, d: 0.75, h: 2.1 },
      {
        diagram: "access",
        detail:
          "Illustrative floor-control access space inside janitor area; enclosure, panel and access require coordination.",
      },
    );
    route(
      `${fc.assetId}-TEST-DRAIN`,
      "fire",
      floor,
      [
        [fr.x, y + 1.15, fr.z],
        [-12.9, y + 1.15, fr.z],
        [-12.9, y + 0.6, fr.z],
        [-12.9, y + 0.5, -5.15],
      ],
      {
        pending: true,
        role: "test-drain",
        detail:
          "Test/drain disposal interface reservation only. Approved receptor, capacity and discharge arrangement unresolved; no automatic connection to domestic/fire storage or sanitary pipework.",
      },
    );
    for (const [i, endpoint] of [
      [-8, 5.4],
      [-16.4, 9.4],
      [9, 5.4],
      [16, 9.4],
    ].entries()) {
      route(
        `${f.prefix}-FIRE-EXAMPLE-${i + 1}`,
        "fire",
        floor,
        branchTo(ROUTE_PROFILES.fire, y, [endpoint[0], h, endpoint[1]]),
        {
          example: true,
          role: "example-branch",
          detail:
            "PDF p.1 example branch only. No sprinkler head, spacing, coverage, pipe size or hydraulic arrangement is asserted.",
        },
      );
    }
    for (const system of ["power", "data", "alarm"]) {
      const v = SERVICE_RESERVATIONS[system];
      route(
        `${f.prefix}-${v.id}-RISER`,
        system,
        floor,
        [
          [v.x, y, v.z],
          [v.x, y + 4.2, v.z],
        ],
        { role: "riser", shaft: v.id, pending: true },
      );
    }
    // Each floor's power comes through its DB, and data through its own IDF.
    const db = `DB-${f.prefix}`,
      net = `NET-${f.prefix}-01`,
      power = SERVICE_RESERVATIONS.power,
      data = SERVICE_RESERVATIONS.data;
    connection(
      `${f.prefix}-DB-FEED-R01`,
      "power",
      floor,
      db,
      "ELECTRICAL ENTRY",
      [
        [13.65, y + 0.143, -2.5],
        [13.65, y + 2.65, -2.5],
        [power.x, y + 2.65, -2.5],
        [power.x, y + 2.65, power.z],
      ],
      { role: "distribution-feed" },
    );
    connection(
      `${f.prefix}-DB-TRAYS-R01`,
      "power",
      floor,
      db,
      "ELECTRICAL ENTRY",
      [
        [13.65, y + 0.143, -2.5],
        [13.65, y + ROUTE_PROFILES.power.y, -2.5],
        [ROUTE_PROFILES.power.rear, y + ROUTE_PROFILES.power.y, -2.5],
      ],
      { role: "floor-source" },
    );
    const np = port(net, "DATA ENTRY");
    connection(
      `${f.prefix}-IDF-FEED-R01`,
      "data",
      floor,
      net,
      "DATA ENTRY",
      [
        [np[0], y + 0.143, -2.8],
        [np[0], y + 3.25, -2.8],
        [data.x, y + 3.25, -2.8],
        [data.x, y + 3.25, data.z],
      ],
      { role: "distribution-feed" },
    );
    connection(
      `${f.prefix}-IDF-TRAYS-R01`,
      "data",
      floor,
      net,
      "DATA ENTRY",
      [
        [np[0], y + 0.143, -2.8],
        [np[0], y + ROUTE_PROFILES.data.y, -2.8],
        [np[0], y + ROUTE_PROFILES.data.y, ROUTE_PROFILES.data.z],
      ],
      { role: "floor-source" },
    );
    for (const s of ["power", "data"])
      for (const [i, e] of [
        [-8, 5.4],
        [-16.4, 9.4],
        [9, 5.4],
        [16, 9.4],
      ].entries())
        route(
          `${f.prefix}-${s.toUpperCase()}-EXAMPLE-${i + 1}`,
          s,
          floor,
          branchTo(ROUTE_PROFILES[s], y, [e[0], y + ROUTE_PROFILES[s].y, e[1]]),
          { example: true, role: "example-branch" },
        );
    // Indoor floor AHUs, rear outdoor-air / relief connections and side-gallery feeds.
    for (const system of ["supply", "return"]) {
      const p = ROUTE_PROFILES[system],
        h = y + p.y;
      if (floor) {
        const id = `AHU-L${floor}-01`,
          name = system === "supply" ? "SUPPLY AIR" : "RETURN AIR",
          source = port(id, name);
        connection(
          `${f.prefix}-AHU-${system.toUpperCase()}-R01`,
          system,
          floor,
          id,
          name,
          [
            [source[0], h, source[2]],
            [p.edge, h, source[2]],
            [p.edge, h, p.z],
          ],
          { role: "floor-source" },
        );
      } else {
        const source = GROUND_AHU[system],
          x = system === "supply" ? -5.7 : -6.25;
        route(
          `G-AHU-${system.toUpperCase()}-R01`,
          system,
          0,
          [source, [source[0], h, source[2]], [x, h, source[2]], [x, h, p.z]],
          {
            role: "floor-source",
            fromReservation: GROUND_AHU.id,
            penetrationPending: true,
            detail:
              "Ground-yard ventilation reservation through an opaque rear water-room wall and the west ceiling zone. Weathering/penetration protection unresolved; no route through atrium glazing.",
          },
        );
      }
    }
    if (floor)
      for (const [system, name, x, h, z] of [
        ["supply", "OUTDOOR AIR", 6.4, y + 3.27, -10.2],
        ["return", "RELIEF AIR", 8.8, y + 3.8, -9.55],
      ]) {
        const id = `AHU-L${floor}-01`,
          source = port(id, name),
          end = [x, h, -12.2];
        connection(
          `${f.prefix}-${name.replaceAll(" ", "-")}-R01`,
          system,
          floor,
          id,
          name,
          [[source[0], h, source[2]], [x, h, source[2]], end],
          {
            role: name === "OUTDOOR AIR" ? "outdoor-intake" : "office-relief",
            penetrationPending: true,
          },
        );
        geo.box(
          layers[floor][system],
          ...end,
          0.6,
          name === "RELIEF AIR" ? 0.24 : 0.36,
          0.12,
          mats[system],
          metadata(`${f.prefix}-${name}-LOUVRE`, system, floor, {
            label: `${f.prefix} ${name.toLowerCase()} louvre reservation · separation unverified`,
          }),
        );
      }
    // Existing terminals retain their IDs and positions, with branches fed by R01 mains.
    for (const terminal of services.terminals.filter(
      (t) =>
        ALL_ROOMS.find((r) => r.id === t.roomId)?.floor === floor &&
        t.system !== "exhaust",
    )) {
      const system = terminal.system,
        p = ROUTE_PROFILES[system];
      let points = branchTo(p, y, terminal.position);
      const room = ALL_ROOMS.find((r) => r.id === terminal.roomId);
      if (["wc", "accessible-wc", "janitor"].includes(room.furniture)) {
        points = [
          points[0],
          ...points.slice(0, -1).map(([x, , z]) => [x, y + 3.74, z]),
          terminal.position,
        ];
      }
      const id =
        terminal.routeId || `${terminal.roomId}-${system.toUpperCase()}`;
      const r = route(`${id}-R01`, system, floor, points, {
        role: "room-branch",
        roomId: terminal.roomId,
        terminalId: id,
        insulation: 0.01,
        width: system === "supply" ? 0.15 : 0.13,
        height: 0.09,
      });
      terminals.push({ ...terminal, routeId: r.id });
    }
  }
  // Ground equipment sources: fire water and domestic water never share a source.
  const fp = port("FP-01", "DISCHARGE"),
    fr = SERVICE_RESERVATIONS.fire;
  connection(
    "G-FP-TO-FR-01",
    "fire",
    0,
    "FP-01",
    "DISCHARGE",
    [
      [fp[0], 3.84, fp[2]],
      [fr.x, 3.84, fp[2]],
      [fr.x, 3.84, fr.z],
    ],
    { role: "source" },
  );
  const suction = port("FP-01", "SUCTION");
  connection(
    "G-TANK-TO-FP-SUCTION",
    "fire",
    0,
    "FP-01",
    "SUCTION",
    [
      [suction[0], suction[1], suction[2] + 0.3],
      [suction[0], -0.65, suction[2] + 0.3],
      [suction[0], -0.8, -16.5],
      [-12, -0.8, -16.5],
    ],
    {
      pending: true,
      role: "tank-interface",
      toReservation: "RES-FIRE-TANK",
      detail:
        "Candidate fire-water supply/tank interface to main pump suction. Tank need, usable storage, suction arrangement and hydraulic adequacy unresolved.",
    },
  );
  const bs = port("BS-G-01", "DISCHARGE"),
    outset = [bs[0] - 0.3, bs[1], bs[2]];
  for (const [key, x, z] of [
    ["WL", -11.55, -5.22],
    ["WR", 19.76, -5.48],
  ]) {
    connection(
      `G-BOOSTER-TO-${key}`,
      "cold",
      0,
      "BS-G-01",
      "DISCHARGE",
      [
        outset,
        [outset[0], -0.5, outset[2]],
        [outset[0], -0.5, -13.8],
        [x + (x < 0 ? 0.32 : -0.32), -0.5, -13.8],
        [x + (x < 0 ? 0.32 : -0.32), -0.5, z],
        [x + (x < 0 ? 0.32 : -0.32), -0.15, z],
        [x, -0.15, z],
        [x, 0, z],
      ],
      {
        role: "source",
        width: 0.025,
        toReservation: key,
        detail:
          "Domestic booster feed to local wet-service stacks. Right feed follows the external rear ground-service strip below grade, avoiding electrical/IT rooms. Burial, protection and surveyed levels unverified.",
      },
    );
  }
  connection(
    "G-MDB-POWER-RISER-R01",
    "power",
    0,
    "MDB-G-01",
    "ELECTRICAL ENTRY",
    [
      [5.18, 0.143, -9],
      [5.18, 3.25, -9],
      [6.1, 3.25, -9],
      [6.1, 3.25, -4.6],
      [10, 3.25, -4.6],
    ],
    { role: "source" },
  );
  const server = port("SR-G-01", "DATA ENTRY");
  connection(
    "G-SERVER-DATA-RISER-R01",
    "data",
    0,
    "SR-G-01",
    "DATA ENTRY",
    [
      [server[0], server[1], server[2] - 0.3],
      [server[0], 3.5, server[2] - 0.3],
      [10.75, 3.5, server[2] - 0.3],
      [10.75, 3.5, -4.6],
    ],
    { role: "source" },
  );
  const gw = port("GW-G-01", "NETWORK / BMS");
  connection(
    "G-BMS-DATA-R01",
    "data",
    0,
    "GW-G-01",
    "NETWORK / BMS",
    [
      [gw[0] + 0.3, gw[1], gw[2]],
      [gw[0] + 0.3, 3.5, gw[2]],
      [10.75, 3.5, gw[2]],
      [10.75, 3.5, -4.6],
    ],
    {
      role: "bms-interface",
      pending: true,
      detail:
        "BMS network/field-containment interface reservation at gateway; the field architecture is pending. The dedicated network entry remains separate from power and fire-alarm circuitry.",
    },
  );
  volume(
    "FACP-SOURCE-PENDING",
    "alarm",
    0,
    { x: 8.8, y: 1.4, z: -5.6, w: 0.5, h: 0.5, d: 0.12 },
    {
      detail:
        "Fire-alarm panel placement is unresolved. This is a source-space study in G-B01, not installed equipment. Field/interface circuit pathways remain separate from server/data and require a settled architecture.",
    },
  );
  route(
    "G-FACP-INTERFACE-PENDING",
    "alarm",
    0,
    [
      [8.8, 1.65, -5.6],
      [8.8, 3.87, -5.6],
      [11.45, 3.87, -5.6],
      [11.45, 3.87, -4.6],
    ],
    { pending: true, fromReservation: "FACP-SOURCE-PENDING" },
  );
  for (const f of FLOORS)
    route(
      `${f.prefix}-ALARM-FIELD-PENDING`,
      "alarm",
      f.index,
      [
        [11.45, f.index * 4.2 + 3.87, -4.6],
        [15.8, f.index * 4.2 + 3.87, -4.6],
      ],
      {
        pending: true,
        role: "field-path",
        detail:
          "Dedicated fire-alarm containment reservation only; no field circuit, detector, interface or panel architecture selected.",
      },
    );
  // Ground ventilation is a new reservation, not a condenser fresh-air connection.
  const g = GROUND_AHU;
  const unitData = metadata(g.id, "supply", 0, {
    label: "Ground-floor ventilation unit · yard reservation",
    detail:
      "PDF p.2 separate ground ventilation reservation. No airflow, duty or manufacturer selected. Outdoor-air, supply, office return and relief faces are distinct from condenser equipment.",
  });
  const unit = group(floors[0], g.id, unitData);
  geo.box(unit, g.x, 0.08, g.z, g.w + 0.2, 0.16, g.d + 0.2, finish(0x909794));
  geo.box(unit, g.x, 0.86, g.z, g.w, 1.4, g.d, finish(0xacb6b3));
  for (const [system, point] of [
    ["supply", g.supply],
    ["return", g.return],
  ])
    geo.box(unit, point[0], 1.56, point[2], 0.34, 0.04, 0.34, mats[system], {
      ...unitData,
      label: `${g.id} ${system} top connection flange`,
    });
  for (const dx of [-0.9, 0, 0.9])
    geo.box(
      unit,
      g.x + dx,
      0.88,
      g.z + g.d / 2 + 0.02,
      0.8,
      1.1,
      0.03,
      finish(0x475a5e),
    );
  for (const [system, point] of [
    ["supply", g.intake],
    ["return", g.relief],
  ])
    geo.box(
      layers[0][system],
      ...point,
      0.55,
      0.35,
      0.2,
      mats[system],
      metadata(`${g.id}-${system}-LOUVRE`, system, 0, {
        label: `${g.id} ${system === "supply" ? "outdoor-air intake" : "office relief"} face reservation`,
      }),
    );
  label(unit, g.id, [g.x, 1.12, g.z + g.d / 2 + 0.04], "#167f8b", 1.2);
  assets.push({
    id: g.id,
    role: "plant-reservation",
    system: "supply",
    floor: 0,
    data: unitData,
    object: unit,
    points: [[g.x, 0.9, g.z]],
  });
  volume(
    `${g.id}-ACCESS`,
    "supply",
    0,
    { x: g.x, y: 0, z: -15.95, w: 3.2, d: 0.9, h: 2.1 },
    { diagram: "access" },
  );
  route(
    "G-AHU-OUTDOOR-AIR-R01",
    "supply",
    0,
    [g.intake, [g.intake[0], g.intake[1], g.z - 0.6]],
    { role: "outdoor-intake", fromReservation: g.id, width: 0.25, height: 0.2 },
  );
  route(
    "G-AHU-RELIEF-R01",
    "return",
    0,
    [g.relief, [g.relief[0], 3.1, g.relief[2]], [-0.6, 3.1, -19.25]],
    { role: "office-relief", fromReservation: g.id, width: 0.2, height: 0.16 },
  );
  // VRF pairs reach the HVAC compartment, not the dry riser or toilet/wet shaft.
  for (const [index, side] of ["West", "East"].entries())
    for (const [pIndex, name] of ["REFRIGERANT A", "REFRIGERANT B"].entries()) {
      const id = `ROOF-${side}-COOL`,
        source = port(id, name),
        x = 12.02 + index * 0.34 + pIndex * 0.12,
        z = -4.85 + index * 0.3 + pIndex * 0.15,
        offset = 0.2 + index * 0.35 + pIndex * 0.15;
      connection(
        `G-${side}-${name.replaceAll(" ", "-")}-TO-HVAC`,
        "refrigerant",
        0,
        id,
        name,
        [
          [source[0], source[1], source[2] + 0.01],
          [source[0], 3.92, source[2] + 0.01],
          [source[0], 3.92, source[2] + offset],
          [x, 3.92, source[2] + offset],
          [x, 3.92, z],
        ],
        {
          role: "source",
          shaft: "HVAC-REF",
          network: side,
          line: pIndex,
          insulation: 0.025,
          width: 0.025,
        },
      );
      for (const f of FLOORS) {
        const y = f.index * 4.2;
        route(
          `${f.prefix}-${side}-${pIndex}-REF-RISER`,
          "refrigerant",
          f.index,
          [
            [x, y, z],
            [x, y + 4.2, z],
          ],
          {
            role: "riser",
            shaft: "HVAC-REF",
            network: side,
            line: pIndex,
            insulation: 0.025,
            pending: true,
          },
        );
      }
    }
  for (const f of FLOORS) {
    const y = f.index * 4.2,
      p = ROUTE_PROFILES.refrigerant;
    for (const [sideIndex, side] of ["West", "East"].entries())
      for (const line of [0, 1]) {
        const prof = vrfProfile(side, line);
        for (const r of corridorMains(prof, y).filter((r) =>
          sideIndex
            ? ["EAST", "EAST-FRONT"].includes(r.role)
            : r.role !== "EAST-FRONT",
        ))
          route(
            `${f.prefix}-${side}-REF-${line}-${r.role}`,
            "refrigerant",
            f.index,
            sideIndex && r.role === "EAST"
              ? r.points.map((point, i) =>
                  i ? point : [5.7, point[1], point[2]],
                )
              : r.points,
            {
              role: "main",
              network: side,
              line,
              width: 0.025,
              insulation: 0.025,
            },
          );
        route(
          `${f.prefix}-${side}-VRF-${line}-TO-MAIN`,
          "refrigerant",
          f.index,
          [
            [
              12.02 + sideIndex * 0.34 + line * 0.12,
              y + prof.y,
              -4.85 + sideIndex * 0.3 + line * 0.15,
            ],
            [
              12.02 + sideIndex * 0.34 + line * 0.12,
              y + prof.y,
              sideIndex ? -3.85 - line * 0.15 : -5.45 + line * 0.15,
            ],
            [
              prof.rear,
              y + prof.y,
              sideIndex ? -3.85 - line * 0.15 : -5.45 + line * 0.15,
            ],
          ],
          {
            role: "floor-source",
            network: side,
            line,
            width: 0.025,
            insulation: 0.025,
          },
        );
      }
    const roomCodes = f.index
      ? ["01", "03", "04", "05"]
      : ["01", "04", "05", "06"];
    for (const code of roomCodes) {
      const room = ALL_ROOMS.find((r) => r.id === `${f.prefix}-${code}`),
        b = room.bounds,
        x = (b.x1 + b.x2) / 2,
        z = b.z1 + 0.8;
      const indoorId = `VRF-${room.id}-RES`,
        groupData = metadata(indoorId, "refrigerant", f.index, {
          roomId: room.id,
          label: `${room.id} · VRF indoor-unit reservation`,
          detail:
            "Illustrative indoor-unit location only; count, duty and layout are not a room cooling design. Separate local return/supply faces recirculate room air. Refrigerant pairs and sloping condensate are independent of ventilation/toilet extract.",
        });
      const indoor = group(layers[f.index].refrigerant, indoorId, groupData);
      geo.box(indoor, x, y + 3.38, z, 0.85, 0.24, 0.55, finish(0xc3c9bf));
      for (const offset of [-0.2, 0.2])
        geo.box(
          indoor,
          x + offset,
          y + 3.245,
          z,
          0.22,
          0.035,
          0.45,
          mats[offset < 0 ? "return" : "supply"],
          {
            ...groupData,
            label: `${indoorId} · local ${offset < 0 ? "return" : "supply"} face`,
          },
        );
      assets.push({
        id: indoorId,
        role: "indoor-reservation",
        system: "refrigerant",
        floor: f.index,
        data: groupData,
        object: indoor,
        points: [[x, y + 3.38, z]],
      });
      for (const line of [0, 1]) {
        const prof = vrfProfile(x < 0 ? "West" : "East", line),
          end = [x + (line ? 0.2 : -0.2), y + 3.5, z + (line ? 0.08 : -0.08)];
        route(
          `${indoorId}-REF-${line}`,
          "refrigerant",
          f.index,
          branchTo(prof, y, end),
          {
            role: "example-indoor-branch",
            network: x < 0 ? "West" : "East",
            roomId: room.id,
            line,
            insulation: 0.025,
            width: 0.025,
          },
        );
      }
      const west = x < 0,
        stack = WASHROOM_PLANS.find(
          (w) => w.room.id === `${f.prefix}-${west ? "W01" : "W04"}`,
        ).soil;
      const xy = [
        [x, z + 0.25],
        [west ? -12.35 : 13.35, z + 0.25],
        [west ? -12.35 : 13.35, 1.05],
        [west ? -15 : 15, 1.05],
        [west ? -15 : 15, stack[2] - 0.16],
        [stack[0] + (west ? 0.18 : -0.18), stack[2] - 0.16],
      ];
      const fall = fallingRoute(xy, y + 3.19, 0.001);
      route(
        `${indoorId}-CONDENSATE`,
        "condensate",
        f.index,
        [[x, y + 3.35, z + 0.25], ...fall],
        {
          role: "gravity",
          roomId: room.id,
          toReservation: `${f.prefix}-${west ? "A" : "B"}-COND-RECEPTOR`,
          fallPerMetre: 0.001,
          width: 0.03,
          detail:
            "Illustrative continuous fall to a local trapped/air-gap receptor reservation. Exact gradient, pipe size, insulation, trap seal, cleaning and discharge approval unresolved.",
        },
      );
    }
    for (const west of [true, false]) {
      const w = WASHROOM_PLANS.find(
          (w) => w.room.id === `${f.prefix}-${west ? "W01" : "W04"}`,
        ),
        [sx, , sz] = w.soil,
        x = sx + (west ? 0.18 : -0.18),
        z = sz - 0.16;
      volume(
        `${f.prefix}-${west ? "A" : "B"}-COND-RECEPTOR`,
        "condensate",
        f.index,
        { x, y: y + 3.02, z, w: 0.12, h: 0.2, d: 0.12 },
        {
          labelWidth: 1.2,
          detail:
            "Local trapped condensate receptor / air-gap interface reservation to the sanitary stack. Access, trap and approved detail unresolved; no direct refrigerant-to-waste connection.",
        },
      );
      route(
        `${f.prefix}-${west ? "A" : "B"}-COND-DISPOSAL`,
        "condensate",
        f.index,
        [
          [x, y + 3.19, z],
          [x, y + 3.08, z + 0.05],
          [x, y + 3.04, z],
          [sx, y + 3.0, sz],
        ],
        { role: "receptor-disposal", pending: true, width: 0.025 },
      );
    }
    // Existing left satellite suite is fed from WL, not from the fire riser.
    const left = WASHROOM_PLANS.find(
      (p) => p.room.id === `${f.prefix}-W01`,
    ).soil;
    route(
      `${f.prefix}-WL-TO-W01`,
      "cold",
      f.index,
      [
        [-11.55, y + 3.49, -5.22],
        [-11.55, y + 3.49, -5.0],
        [-13.9, y + 3.49, -5.0],
        [-13.9, y + 3.62, -5.0],
        [-14.86, y + 3.62, -5.0],
        [-14.86, y + 3.53, -5.0],
        [-15, y + 3.53, -5.0],
        [-15, y + 3.53, left[2] + 0.08],
        [left[0], y + 3.53, left[2] + 0.08],
      ],
      { role: "local-wet-feed", width: 0.025 },
    );
    // Pantry endpoints follow the retained basin in interiors.js, not the diagram.
    const pantry = ALL_ROOMS.find((r) => r.id === `${f.prefix}-P01`),
      px = pantry.bounds.x1 + 0.9,
      pz = pantry.bounds.z1 + 0.4;
    route(
      `${f.prefix}-PANTRY-COLD`,
      "cold",
      f.index,
      [
        [-11.55, y + 3.5, -5.22],
        [px - 0.12, y + 3.5, -5.22],
        [px - 0.12, y + 3.5, pz + 0.12],
        [px - 0.12, y + 0.7, pz + 0.12],
      ],
      { role: "pantry", width: 0.025 },
    );
    route(
      `${f.prefix}-PANTRY-WASTE`,
      "waste",
      f.index,
      [
        [px, y + 0.72, pz],
        [px, y + 0.45, pz],
        [px, y + 0.43, pz - 0.14],
        [px, y + 0.55, pz - 0.14],
        [px, y + 0.3, pz - 0.14],
        [-11.55, y + 0.18, pz - 0.14],
        [-11.55, y + 0.16, -5.3],
      ],
      { role: "pantry-trap-waste", width: 0.045 },
    );
    volume(
      `WH-${f.prefix}-PANTRY`,
      "hot",
      f.index,
      { x: px + 0.18, y: y + 0.35, z: pz + 0.25, w: 0.2, h: 0.32, d: 0.16 },
      {
        detail:
          "Optional point-of-use pantry hot-water provision beneath the retained basin/counter. No central hot-water supply from the domestic booster is implied; duty and approved details remain unresolved.",
      },
    );
    route(
      `${f.prefix}-PANTRY-HEATER-FEED`,
      "cold",
      f.index,
      [
        [px - 0.12, y + 0.6, pz + 0.12],
        [px - 0.12, y + 0.6, pz + 0.25],
        [px + 0.18, y + 0.6, pz + 0.25],
      ],
      { role: "local-heater-feed", width: 0.02 },
    );
    route(
      `${f.prefix}-PANTRY-HOT`,
      "hot",
      f.index,
      [
        [px + 0.18, y + 0.67, pz + 0.25],
        [px + 0.12, y + 0.7, pz + 0.25],
        [px + 0.12, y + 0.7, pz + 0.12],
      ],
      { role: "local-hot", width: 0.02 },
    );
  }
  for (const p of SERVICE_FACADE_OPENINGS)
    volume(
      `PEN-${p.id}-R01`,
      p.id.endsWith("RA") || p.id.includes("RELIEF") ? "return" : "supply",
      p.floor,
      { x: p.x, y: p.y - 0.24, z: -12, w: p.w + 0.2, h: 0.48, d: 0.7 },
      {
        diagram: "access",
        labelWidth: 1.2,
        detail:
          "Schematic rear service-wall penetration and access reservation. Small opaque-cladding opening modeled; damper/protection type, weathering, insulation, acoustic treatment and inspection access depend on the final barrier strategy. No verified fire rating.",
      },
    );
  // Smoke volumes are deliberately not connected to comfort AHUs or sanitary fans.
  volume(
    "ATR-SMOKE-HIGH-PENDING",
    "smoke",
    null,
    { x: 0, y: 13.5, z: 0, w: 1.8, h: 0.45, d: 4 },
    {
      labelWidth: 2,
      detail:
        "Possible high-level atrium smoke-exhaust opening zone, below the skylight. Strategy, controls, sizing, support and make-up air not engineered; no roof equipment load or working smoke system.",
    },
  );
  volume(
    "ATR-SMOKE-LOW-PENDING",
    "smoke",
    0,
    { x: 3.9, y: 0.4, z: 10.8, w: 0.7, h: 1.2, d: 0.25 },
    {
      labelWidth: 1.4,
      detail:
        "Possible low-level make-up opening zone beside, clear of, the conventional entrance. Smoke strategy/operable opening unresolved; independent of comfort HVAC.",
    },
  );
  const obstacles = [];
  const obstacle = (r) => {
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1],
        b = r.points[i],
        width = r.width || r.radius * 2,
        allowances = [width / 2, (r.height || width) / 2, width / 2].map(
          (v) => v + (r.insulation || 0),
        );
      obstacles.push({
        r,
        box: {
          lo: a.map((v, j) => Math.min(v, b[j]) - allowances[j]),
          hi: a.map((v, j) => Math.max(v, b[j]) + allowances[j]),
        },
      });
    }
  };
  for (const r of routes.filter(
    (r) => r.system !== "refrigerant" && !r.pending && !r.example,
  ))
    obstacle(r);
  for (const r of services.routes.filter((r) => r.system === "exhaust"))
    obstacle(r);
  for (const r of services.plumbing.routes) obstacle(r);
  const coordination = coordinateRefrigerantRoutes(routes, obstacles);
  for (const r of routes.filter((r) => r.system === "refrigerant")) {
    if (coordination.errors.some((error) => error.startsWith(r.id + " "))) {
      r.pending = true;
      r.data.detail += " Crossing remains unresolved; dashed reservation only.";
    }
    if (r.pending) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(
          r.points.map((p) => new THREE.Vector3(...p)),
        ),
        new THREE.LineDashedMaterial({
          color: ROUTE_SYSTEMS.refrigerant.color,
          dashSize: 0.2,
          gapSize: 0.11,
        }),
      );
      line.computeLineDistances();
      line.userData = r.data;
      line.raycast = () => {};
      r.group.add(line);
      r.object = line;
    } else {
      const envelope = group(r.group, `${r.id} insulation envelope`, {
        diagram: "insulation",
      });
      for (let i = 1; i < r.points.length; i++) {
        batchPipe(
          r.group,
          r.points[i - 1],
          r.points[i],
          r.width / 2,
          mats.refrigerant,
          { ...r.data, segment: i - 1 },
        );
        batchPipe(
          envelope,
          r.points[i - 1],
          r.points[i],
          r.width / 2 + (r.insulation || 0.025),
          insulationMaterial,
          { ...r.data, kind: "service-envelope", segment: i - 1 },
        );
      }
    }
  }
  geo.flush();
  for (const layer of [
    ...layers.flatMap((v) => Object.values(v)),
    ...Object.values(roofLayers),
  ])
    layer.traverse((o) => {
      if (o.isMesh && o.parent.userData.diagram) o.raycast = () => {};
    });
  for (const [parent, collection] of pipeBatches)
    for (const batch of collection.values()) {
      const mesh = new THREE.InstancedMesh(
        pipeGeometry,
        batch.material,
        batch.matrices.length,
      );
      batch.matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData = { ...parent.userData, instances: batch.data };
      mesh.castShadow = true;
      if (parent.userData.diagram) mesh.raycast = () => {};
      parent.add(mesh);
    }
  return {
    routes,
    reservations,
    assets,
    terminals,
    layers,
    roofLayers,
    groundPlant: unit,
    coordination,
    systems: ROUTE_SYSTEMS,
  };
}

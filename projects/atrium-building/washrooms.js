import * as THREE from "three";
import { builder, group, finish } from "./geometry.js";
import { isWashroom, washroomPlan } from "./washroom-plan.js";
import { doorPosition } from "./layout.js";

export function createWashrooms({ floor, root, walls, furniture, inventory }) {
  const geo = builder(),
    doors = [],
    plans = [],
    points = [],
    partitions = [];
  const clearances = group(root, "Washroom clearance reservations", {
    layer: "washroom-clearances",
  });
  const markers = group(root, "Washroom BMS points · unavailable / unbound", {
    layer: "washroom-bms",
  });
  const m = {
    stone: finish(0xd9d1c1),
    grout: finish(0xbab5a8),
    sage: finish(0x839081),
    lining: finish(0xb7bdb5),
    white: finish(0xf6f5ec, { roughness: 0.28 }),
    bowl: finish(0xc7d5d3),
    metal: finish(0x929d9a, { metalness: 0.72, roughness: 0.24 }),
    mirror: finish(0xb4ccce, { metalness: 0.93, roughness: 0.07 }),
    dark: finish(0x45514f),
    amber: finish(0xc59b56),
    black: finish(0x343c3a),
  };
  const seatShape = new THREE.Shape();
  seatShape.absellipse(0, 0, 0.32, 0.21, 0, Math.PI * 2, false, 0);
  const hole = new THREE.Path();
  hole.absellipse(0, 0, 0.23, 0.13, 0, Math.PI * 2, true, 0);
  seatShape.holes.push(hole);
  const seatGeo = new THREE.ExtrudeGeometry(seatShape, {
    depth: 0.055,
    bevelEnabled: false,
    curveSegments: 16,
  });
  for (const room of floor.rooms.filter(isWashroom)) {
    const p = washroomPlan(room);
    plans.push(p);
    const info = (id, kind, label) => ({
      assetId: `${room.id}-${id}`,
      roomId: room.id,
      floor: floor.index,
      kind,
      label: `${room.id} · ${label}`,
    });
    const fg = group(
      furniture,
      `${room.id} sanitary fixtures`,
      info("FIXTURES", "fixture", "Washroom fixtures"),
    );
    const wg = group(
      walls,
      `${room.id} cubicles and linings`,
      info("PARTITIONS", "partition", "Opaque washroom partitions"),
    );
    partitions.push(wg);
    function box(parent, u, y, v, w, h, d, mat, id, label, kind = "fixture") {
      geo.box(parent, ...p.point(u, v, y), w, h, d, mat, info(id, kind, label));
    }
    // Tile finish and restrained joints. Retained envelope walls remain opaque.
    box(
      fg,
      2,
      0.035,
      p.suite ? 2.8 : 1.6,
      3.7,
      0.025,
      p.suite ? 5.3 : 2.9,
      m.stone,
      "FLOOR",
      "Stone-look washroom tile",
    );
    for (let u = 0.8; u < 3.9; u += 0.6)
      box(
        fg,
        u,
        0.05,
        p.suite ? 2.8 : 1.6,
        0.005,
        0.004,
        p.suite ? 5.3 : 2.9,
        m.grout,
        "JOINT",
        "Tile joint",
      );
    for (let v = 0.5; v < (p.suite ? 5.5 : 3.1); v += 0.6)
      box(fg, 2, 0.05, v, 3.7, 0.004, 0.005, m.grout, "JOINT", "Tile joint");
    box(
      wg,
      0.24,
      1.2,
      p.suite ? 2.8 : 1.6,
      0.2,
      2.4,
      p.suite ? 5.3 : 2.9,
      m.lining,
      "LINING",
      "200 mm WC service lining",
      "partition",
    );
    // Closed doors and opaque sage screens give privacy in the finished model.
    if (p.suite) {
      for (const v of [1.08, 2.23, 3.38])
        box(
          wg,
          1.22,
          1.15,
          v,
          1.86,
          2.3,
          0.1,
          m.sage,
          `SCREEN-${v}`,
          "Cubicle divider",
          "partition",
        );
      for (const c of p.cubicles) {
        const [d1, d2] = c.door;
        for (const [v1, v2] of [
          [c.v1 - 0.05, d1],
          [d2, c.v2 + 0.05],
        ])
          if (v2 > v1)
            box(
              wg,
              2.09,
              1.15,
              (v1 + v2) / 2,
              0.1,
              2.3,
              v2 - v1,
              m.sage,
              `${c.id}-JAMB`,
              "Cubicle front screen",
              "partition",
            );
        const pivot = group(
          wg,
          `${room.id} ${c.id} operable door`,
          info(
            `${c.id}-DOOR`,
            "door",
            `${c.accessible ? "Larger outward-opening" : "Standard inward-opening"} cubicle door · closed`,
          ),
        );
        const hingeV = c.accessible ? d1 : d2,
          direction = c.accessible ? -1 : 1;
        pivot.position.set(...p.point(2.09, hingeV));
        const width = d2 - d1;
        geo.box(
          pivot,
          0,
          1.1,
          (direction * width) / 2,
          0.045,
          2.1,
          width - 0.015,
          m.sage,
        );
        geo.box(
          pivot,
          (p.east ? -1 : 1) * 0.04,
          1.05,
          direction * (width - 0.12),
          0.04,
          0.04,
          0.12,
          m.metal,
        );
        doors.push({
          object: pivot,
          openAngle: p.east ? Math.PI / 2 : -Math.PI / 2,
          roomId: room.id,
          accessible: c.accessible,
        });
        box(
          wg,
          2.09,
          2.26,
          (d1 + d2) / 2,
          0.13,
          0.06,
          width + 0.08,
          m.metal,
          `${c.id}-HEAD`,
          "Cubicle head rail",
          "partition",
        );
      }
    }
    for (const c of p.cubicles) {
      const [u, v] = c.wc;
      inventory.push({
        roomId: room.id,
        type: "wc",
        assetId: `${room.id}-${c.id}-WC`,
      });
      const pan = geo.cylinder(
        fg,
        ...p.point(u, v, 0.29),
        0.2,
        0.31,
        m.white,
        info(`${c.id}-WC`, "fixture", "Wall-hung WC"),
        0.24,
      );
      pan.scale.x = 1.32;
      pan.scale.z = 0.86;
      const seat = new THREE.Mesh(seatGeo, m.white);
      seat.rotation.x = Math.PI / 2;
      seat.position.set(...p.point(u + 0.02, v, 0.49));
      seat.userData = info(`${c.id}-SEAT`, "fixture", "WC seat");
      fg.add(seat);
      box(
        fg,
        0.35,
        1.05,
        v,
        0.025,
        0.16,
        0.24,
        m.metal,
        `${c.id}-FLUSH`,
        "Concealed cistern flush plate",
      );
      box(
        fg,
        0.35,
        0.75,
        v - 0.33,
        0.035,
        0.14,
        0.12,
        m.white,
        `${c.id}-PAPER`,
        "Toilet paper dispenser",
      );
      box(
        fg,
        c.accessible ? 0.65 : 1.6,
        0.18,
        c.accessible ? v + 0.5 : v - 0.37,
        0.2,
        0.34,
        0.16,
        m.dark,
        `${c.id}-BIN`,
        "Sanitary bin",
      );
      box(
        fg,
        1.98,
        1.65,
        v - 0.29,
        0.06,
        0.04,
        0.04,
        m.metal,
        `${c.id}-HOOK`,
        "Coat hook",
      );
      if (c.accessible) {
        geo.beam(
          fg,
          p.point(0.39, v - 0.43, 0.8),
          p.point(0.39, v + 0.43, 0.8),
          0.035,
          m.metal,
          info(`${c.id}-WALL-RAIL`, "fixture", "Wall grab rail"),
        );
        geo.beam(
          fg,
          p.point(0.95, v + 0.43, 0.8),
          p.point(0.95, v + 0.43, 1.45),
          0.035,
          m.metal,
          info(
            `${c.id}-FOLD-RAIL`,
            "fixture",
            "Fold-up rail shown raised beside transfer reserve",
          ),
        );
      }
    }
    for (const [i, [u, v]] of p.basins.entries()) {
      inventory.push({
        roomId: room.id,
        type: "basin",
        assetId: `${room.id}-BASIN-${i + 1}`,
      });
      box(
        fg,
        u,
        0.8,
        v,
        0.45,
        0.12,
        0.64,
        m.white,
        `BASIN-${i + 1}`,
        "Wall-hung basin · clear knee space below",
      );
      box(
        fg,
        u - 0.015,
        0.866,
        v,
        0.3,
        0.014,
        0.46,
        m.bowl,
        `BOWL-${i + 1}`,
        "Basin bowl",
      );
      box(
        fg,
        3.86,
        1.0,
        v,
        0.035,
        0.25,
        0.035,
        m.metal,
        `TAP-${i + 1}`,
        "Basin tap",
      );
      box(
        fg,
        3.77,
        1.12,
        v,
        0.22,
        0.035,
        0.035,
        m.metal,
        `SPOUT-${i + 1}`,
        "Tap spout",
      );
      box(
        fg,
        3.91,
        1.52,
        v,
        0.035,
        0.85,
        0.65,
        m.mirror,
        `MIRROR-${i + 1}`,
        "Mirror",
      );
      box(
        fg,
        3.89,
        1.1,
        v + 0.38,
        0.08,
        0.18,
        0.09,
        m.white,
        `SOAP-${i + 1}`,
        "Soap dispenser",
      );
    }
    box(
      fg,
      3.88,
      1.2,
      p.suite ? 1.75 : 1.15,
      0.1,
      0.29,
      0.2,
      m.metal,
      "TOWELS",
      "Paper towel dispenser",
    );
    // Entry doors are recessed into their existing openings, closed for privacy.
    const entry = room.doors[0],
      at = doorPosition(room, entry);
    const inward = entry.side === "E" ? -1 : 1;
    geo.box(
      wg,
      at.x + inward * 0.1,
      1.1,
      at.z,
      0.045,
      2.2,
      entry.width - 0.02,
      m.sage,
      info("ENTRY", "door", "Closed washroom privacy entrance"),
    );
    geo.box(
      wg,
      at.x + inward * 0.14,
      1.02,
      at.z + entry.width / 2 - 0.15,
      0.04,
      0.04,
      0.14,
      m.metal,
      info("ENTRY-HANDLE", "door", "Privacy door handle"),
    );
    // Dashed reserves are optional model-inspection overlays, not floor markings.
    const cg = group(
      clearances,
      `${room.id} clearances`,
      info(
        "CLEARANCE",
        "clearance",
        "Proposed 1.60 m turning and WC transfer reserves",
      ),
    );
    const vertices = Array.from({ length: 65 }, (_, i) =>
      p.point(
        p.turning.u + Math.cos((i * Math.PI) / 32) * 0.8,
        p.turning.v + Math.sin((i * Math.PI) / 32) * 0.8,
        0.065,
      ),
    );
    const circle = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        vertices.map((v) => new THREE.Vector3(...v)),
      ),
      new THREE.LineDashedMaterial({
        color: 0x27898b,
        dashSize: 0.1,
        gapSize: 0.07,
      }),
    );
    circle.computeLineDistances();
    circle.raycast = () => {};
    cg.add(circle);
    const t = p.transfer,
      rectangle = [
        [t.u1, t.v1],
        [t.u2, t.v1],
        [t.u2, t.v2],
        [t.u1, t.v2],
        [t.u1, t.v1],
      ].map(([u, v]) => new THREE.Vector3(...p.point(u, v, 0.066)));
    const transfer = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(rectangle),
      circle.material,
    );
    transfer.computeLineDistances();
    transfer.raycast = () => {};
    cg.add(transfer);
    const definitions = [
      [
        "OCC",
        "AISLE",
        2.8,
        p.suite ? 1.4 : 1.1,
        2.8,
        "Occupancy · non-camera; unavailable",
      ],
      ...p.cubicles.map((c) => [
        "OCC",
        c.id,
        1.2,
        c.wc[1],
        2.8,
        "Cubicle presence · unavailable",
      ]),
      ["LT", "01", 2.7, 1.6, 2.9, "Lighting command / status · unavailable"],
      [
        "LD",
        "01",
        3.88,
        p.basins[0][1],
        0.1,
        "Basin leak / sensor health · unavailable",
      ],
      [
        "LD",
        "02",
        0.37,
        p.suite ? 5.1 : 2.9,
        0.1,
        "Service-lining leak / sensor health · unavailable",
      ],
      [
        "WM",
        "01",
        0.38,
        p.suite ? 5.0 : 2.85,
        0.9,
        "Domestic branch flow / volume · unavailable",
      ],
      [
        "TH",
        "01",
        3.9,
        p.suite ? 3.6 : 1.4,
        1.5,
        "Temperature / humidity · unavailable",
      ],
      ...(!p.suite
        ? [
            [
              "PA",
              "01",
              0.42,
              2.0,
              0.65,
              "Assistance call / fault / acknowledgement · unavailable",
            ],
          ]
        : []),
    ];
    for (const [prefix, suffix, u, v, h, description] of definitions) {
      const data = {
        assetId: `${prefix}-${room.id}-${suffix}`,
        roomId: room.id,
        floor: floor.index,
        kind: "washroom-point",
        label: `${prefix}-${room.id}-${suffix} · ${description}`,
        detail:
          "Planned BMS point. No sensor, command, running proof or assistance-alarm connection is assigned.",
        status: "unavailable",
        source: "model-only",
      };
      const marker = geo.cylinder(
        markers,
        ...p.point(u, v, h),
        0.055,
        0.025,
        m.amber,
        data,
      );
      points.push({ ...data, object: marker });
    }
  }
  geo.flush();
  return { plans, doors, clearances, markers, points, partitions };
}

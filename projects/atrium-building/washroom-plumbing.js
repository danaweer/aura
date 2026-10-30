/* Connected visual reservations. Pipe diameters, gradients, water treatment,
   backflow, sewer connection and penetrations require engineering coordination. */
import * as THREE from "three";
import { builder, group, finish } from "./geometry.js";
import { WASHROOM_PLANS } from "./washroom-plan.js";
export function createWashroomPlumbing({ floors, roof, distribution }) {
  const geo = builder(),
    routes = [],
    stacks = [];
  const ventRoof = group(roof, "Washroom soil vents", {
    kind: "plumbing",
    layer: "systems",
  });
  const m = {
    cold: finish(0x5896b1),
    tempered: finish(0xb99165),
    waste: finish(0x6d7777),
    vent: finish(0x739b8e),
    metal: finish(0xa8adaa),
  };
  function pipe(parent, id, system, points, radius = 0.025, roomId) {
    const data = {
      assetId: id,
      kind: "plumbing",
      system,
      roomId,
      label: `${id} · ${system} reservation`,
      detail:
        "Conceptual connected pipe route. Sizes, gradients, penetrations, supply and drainage connections are unverified.",
    };
    const part = group(parent, id, data);
    for (let i = 1; i < points.length; i++) {
      const a = new THREE.Vector3(...points[i - 1]),
        b = new THREE.Vector3(...points[i]),
        delta = b.clone().sub(a);
      if (delta.length() < 0.001) continue;
      const c = a.add(b).multiplyScalar(0.5);
      const object = geo.cylinder(
        part,
        c.x,
        c.y,
        c.z,
        radius,
        delta.length(),
        m[system],
        data,
      );
      object.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        delta.normalize(),
      );
    }
    routes.push({ id, system, points, radius, roomId, group: part });
    return part;
  }
  const layers = distribution.map((parent, f) =>
    group(parent, `Washroom plumbing · floor ${f}`, {
      kind: "plumbing",
      floor: f,
      layer: "systems",
    }),
  );
  for (const p of WASHROOM_PLANS) {
    const room = p.room,
      y = room.floor * 4.2,
      part = layers[room.floor];
    const at = (u, v, h) => {
      const [x, , z] = p.point(u, v);
      return [x, y + h, z];
    };
    const [sx, , sz] = p.soil;
    // Standard suites have a local concealed stack; accessible WC uses R01.
    pipe(
      part,
      `${room.id}-SOIL-STACK`,
      "waste",
      [
        [sx, y, sz],
        [sx, y + 4.2, sz],
      ],
      0.055,
      room.id,
    );
    for (const [system, offset] of [
      ["cold", 0.08],
      ["tempered", -0.08],
    ])
      pipe(
        part,
        `${room.id}-${system}-RISER`,
        system,
        [
          [sx, y, sz + offset],
          [sx, y + 4.2, sz + offset],
        ],
        0.012,
        room.id,
      );
    const join = p.suite ? at(0.24, 5.16, 0.18) : [sx, y + 0.18, sz];
    const start = p.suite ? at(0.24, 1.66, 0.18) : at(0.24, 2.45, 0.18);
    const header = p.suite
      ? [start, join]
      : [
          start,
          at(0.24, 3.03, 0.18),
          [sx, y + 0.18, p.point(0.24, 3.03)[2]],
          join,
        ];
    pipe(part, `${room.id}-SOIL-HEADER`, "waste", header, 0.05, room.id);
    for (const c of p.cubicles) {
      pipe(
        part,
        `${room.id}-${c.id}-SOIL`,
        "waste",
        [
          at(0.45, c.wc[1], 0.3),
          at(0.24, c.wc[1], 0.3),
          at(0.24, c.wc[1], 0.18),
        ],
        0.045,
        room.id,
      );
      const coldStart = [sx, y + 1.05, sz + 0.08];
      pipe(
        part,
        `${room.id}-${c.id}-COLD`,
        "cold",
        [
          coldStart,
          [p.point(0.24, c.wc[1])[0], y + 1.05, sz + 0.08],
          at(0.24, c.wc[1], 1.05),
          at(0.36, c.wc[1], 1.05),
        ],
        0.012,
        room.id,
      );
    }
    for (const [i, [, v]] of p.basins.entries()) {
      for (const [system, height, offset] of [
        ["cold", 3.5, 0.08],
        ["tempered", 3.58, -0.08],
      ]) {
        const end = at(3.88, v + (system === "cold" ? -0.05 : 0.05), 0.7);
        pipe(
          part,
          `${room.id}-B${i + 1}-${system}`,
          system,
          [
            [sx, y + height, sz + offset],
            [end[0], y + height, sz + offset],
            [end[0], y + height, end[2]],
            end,
          ],
          0.012,
          room.id,
        );
      }
      const trap = [
        at(3.82, v, 0.74),
        at(3.82, v, 0.47),
        at(3.82, v + 0.12, 0.47),
        at(3.82, v + 0.12, 0.62),
        at(3.9, v + 0.12, 0.62),
        at(3.9, v + 0.12, 0.12),
      ];
      pipe(part, `${room.id}-B${i + 1}-TRAP`, "waste", trap, 0.023, room.id);
      const back = p.suite ? 5.4 : 3.03;
      pipe(
        part,
        `${room.id}-B${i + 1}-WASTE`,
        "waste",
        [
          trap.at(-1),
          at(3.9, back, 0.12),
          [sx, y + 0.12, p.point(3.9, back)[2]],
          [sx, y + 0.12, sz],
        ],
        0.025,
        room.id,
      );
    }
    if (!p.suite) {
      const janitor = `${room.floor ? `L${room.floor}` : "G"}-J01`;
      pipe(
        part,
        `${janitor}-COLD`,
        "cold",
        [
          [sx, y + 3.5, sz + 0.08],
          [-13, y + 3.5, sz + 0.08],
          [-13, y + 3.5, -5.75],
          [-13, y + 0.85, -5.75],
        ],
        0.012,
        janitor,
      );
      pipe(
        part,
        `${janitor}-TRAP-WASTE`,
        "waste",
        [
          [-13, y + 0.73, -5.55],
          [-13, y + 0.45, -5.55],
          [-13, y + 0.45, -5.7],
          [-13, y + 0.6, -5.7],
          [-13, y + 0.15, -5.7],
          [sx, y + 0.15, -5.7],
          [sx, y + 0.15, sz],
        ],
        0.025,
        janitor,
      );
    }
    // Visible cleanout / isolation reservations behind removable lining panels.
    geo.box(part, sx, y + 0.4, sz + 0.08, 0.11, 0.16, 0.035, m.metal, {
      assetId: `${room.id}-CLEANOUT`,
      kind: "plumbing",
      roomId: room.id,
      label: "Accessible soil cleanout reservation",
    });
    if (room.floor === 2) {
      const vent = group(ventRoof, `${room.id} soil vent termination`, {
        kind: "plumbing",
        layer: "systems",
      });
      pipe(
        vent,
        `${room.id}-VENT`,
        "vent",
        [
          [sx, 12.6, sz],
          [sx, 13.45, sz],
        ],
        0.055,
        room.id,
      );
      geo.cylinder(vent, sx, 13.48, sz, 0.1, 0.05, m.metal, {
        kind: "plumbing",
        label: "Conceptual vent terminal · roof penetration to coordinate",
      });
    }
    if (room.floor === 0) {
      const source = [-7.25, -0.5, -9.8],
        cold = [sx, 0, sz + 0.08];
      pipe(
        part,
        `${room.id}-COLD-SOURCE`,
        "cold",
        [
          source,
          [-7.25, -0.5, -13.8],
          [sx, -0.5, -13.8],
          [sx, -0.5, cold[2]],
          cold,
        ],
        0.015,
        room.id,
      );
      pipe(
        part,
        `${room.id}-TEMPERED-SOURCE`,
        "tempered",
        [
          [-7.1, -0.6, -9.8],
          [-7.1, -0.6, -13.95],
          [sx, -0.6, -13.95],
          [sx, -0.6, sz - 0.08],
          [sx, 0, sz - 0.08],
        ],
        0.015,
        room.id,
      );
      const boundary = [p.east ? 21 : -21, -0.65, -14.5];
      pipe(
        part,
        `${room.id}-DRAINAGE-BOUNDARY`,
        "waste",
        [[sx, 0, sz], [sx, -0.65, sz], [sx, -0.65, -14.5], boundary],
        0.055,
        room.id,
      );
      const connection = geo.cylinder(part, ...boundary, 0.13, 0.12, m.metal, {
        kind: "plumbing",
        label:
          "Candidate external drainage connection · site/sewer levels unverified",
      });
      stacks.push({ roomId: room.id, x: sx, z: sz, boundary, connection });
    }
  }
  geo.flush();
  return { layers, routes, stacks, roof: ventRoof };
}

/* Means of Egress.pdf, Rev E01, 28 October 2026, pp. 7–9.
   Schedule IDs belong to signs, never to the existing room namespace.
   Metres; +Z is arrival. Model doors override diagram positions. */
import { ALL_ROOMS, ENVELOPE, doorPosition } from "./layout.js";
export const EGRESS_BASIS = {
  source: "Means of Egress.pdf · Rev E01 · 28 Oct 2026",
  status:
    "Concept marking and candidate routes; public-way connection and fire strategy unverified.",
  publicWayZ: 22,
  sidePathX: 21.05,
  mountingHeight: 2.65,
};
export function faceArrow(normal, travel) {
  if (!travel) return "EXIT";
  const right = normal[1] * travel[0] - normal[0] * travel[1];
  const forward = -normal[0] * travel[0] - normal[1] * travel[1];
  if (Math.abs(right) > 0.7) return right > 0 ? "RIGHT" : "LEFT";
  if (forward > 0.7) return "UP";
  throw new Error("Sign face points away from its intended approach");
}
const face = (normal, travel = null) => ({
  normal,
  travel,
  arrow: faceArrow(normal, travel),
});
// One angled cabinet serves the corridor approaches, with parallel front/back faces.
// The chevrons reverse on the back so both sides indicate the same world-space exit.
function blade(side) {
  const q = Math.SQRT1_2;
  return [face([-side * q, q], [side, 0]), face([side * q, -q], [side, 0])];
}
const signs = [];
function add(floor, number, x, z, name, faces, extra = {}) {
  const scheduleId = `${floor === 0 ? "G" : floor}-${String(number).padStart(2, "0")}`;
  signs.push({
    assetId: `EGRESS-${scheduleId}`,
    scheduleId,
    floor,
    x,
    z,
    y: floor * ENVELOPE.floorHeight + EGRESS_BASIS.mountingHeight,
    kind: "egress-sign",
    label: `${scheduleId} · ${name}`,
    mount: "Suspended below service zone",
    sourcePage: 8,
    conditional: false,
    destination:
      x < 0 ? "Stair A → ground discharge" : "Stair B → ground discharge",
    faces,
    ...extra,
  });
}
for (let f = 0; f < 3; f++) {
  const prefix = f === 0 ? "G" : `L${f}`;
  add(f, 1, -15.84, -6.8, "Stair A entrance", blade(-1), {
    roomId: `${prefix}-S01`,
    mount: "Single angled double-sided sign above corridor door",
    panelOffset: [0.44, 0],
  });
  add(f, 2, 15.84, -6.8, "Stair B entrance", blade(1), {
    roomId: `${prefix}-S02`,
    mount: "Single angled double-sided sign above corridor door",
    panelOffset: [-0.44, 0],
  });
  add(f, 3, -12, 9.7, "West front spine", [face([0, 1], [0, -1])]);
  add(f, 4, 13, 9.7, "East front spine", [face([0, 1], [0, -1])]);
  add(f, 5, -15, 0.8, "Turn into west rear spine", [face([1, 0], [0, -1])]);
  add(f, 6, 15, 0.8, "Turn into east rear spine", [face([-1, 0], [0, -1])]);
  add(f, 7, -15, -3.2, "West rear repeater", [face([0, 1], [0, -1])]);
  add(f, 8, 15, -3.2, "East rear repeater", [face([0, 1], [0, -1])]);
  add(f, 9, -4.55, 0.8, "West wing / atrium junction", blade(-1), {
    conditional: true,
  });
  add(f, 10, 4.55, 0.8, "East wing / atrium junction", blade(1), {
    conditional: true,
  });
  add(f, 11, -4, -5.5, "West rear gallery bend", [face([0, -1], [0, 1])], {
    conditional: true,
  });
  add(f, 12, 4, -5.5, "East rear gallery bend", [face([0, -1], [0, 1])], {
    conditional: true,
  });
  add(f, f === 0 ? 20 : 17, -12, 0.8, "West front / main junction", [
    face([0, 1], [-1, 0]),
  ]);
  add(f, f === 0 ? 21 : 18, 13, 0.8, "East front / main junction", [
    face([0, 1], [1, 0]),
  ]);
  if (f > 0) {
    add(f, 13, -4, 8.5, "West front gallery end", [face([1, 0], [0, -1])], {
      conditional: true,
      sourcePage: 9,
    });
    add(f, 14, 4, 8.5, "East front gallery end", [face([-1, 0], [0, -1])], {
      conditional: true,
      sourcePage: 9,
    });
    add(
      f,
      15,
      -13.16,
      3.4,
      f === 1 ? "Team workspace A exit" : "CEO office exit",
      [face([-1, 0])],
      {
        roomId: `${prefix}-01`,
        sourcePage: 9,
        mount: "Room side above corridor door",
      },
    );
    add(
      f,
      16,
      11.84,
      3.4,
      f === 1 ? "Team workspace B exit" : "Boardroom exit",
      [face([-1, 0])],
      {
        roomId: `${prefix}-04`,
        sourcePage: 9,
        mount: "Room side above corridor door",
      },
    );
  }
}
add(0, 13, 2.65, 10.82, "Conventional main entrance exit", [face([0, -1])], {
  sourcePage: 9,
  conditional: true,
  destination: "Front pedestrian approach → assumed public-way connection",
  mount: "Interior side above conventional door alongside revolving entrance",
});
for (const [n, x, normal, roomId] of [
  [14, -19.84, [1, 0], "G-S01"],
  [15, 19.84, [-1, 0], "G-S02"],
])
  add(0, n, x, -6.8, "Ground stair discharge", [face(normal)], {
    sourcePage: 9,
    roomId,
    destination: "Side pedestrian path → assumed public-way connection",
    mount: "Inside outer-wall ground exit",
    adaptation:
      "PDF rear discharge moved to actual side-wall door and level stair landing.",
  });
for (const [n, roomId] of [
  [16, "G-M01"],
  [17, "G-M02"],
  [18, "G-E01"],
]) {
  const room = ALL_ROOMS.find((r) => r.id === roomId),
    p = doorPosition(room, room.doors[0]);
  add(0, n, p.x, p.z + 0.18, `${room.name} exterior exit`, [face([0, 1])], {
    sourcePage: 9,
    roomId,
    mount: "Room side above dedicated exterior door",
    destination:
      "Rear service path → side path → assumed public-way connection",
    restriction: "Own-room exit only; never an office through-route.",
  });
}
add(0, 19, 11.84, 3.6, "Training room exit", [face([-1, 0])], {
  roomId: "G-05",
  sourcePage: 9,
  mount: "Room side above corridor door",
});
export const EGRESS_SIGNS = signs.sort(
  (a, b) => a.floor - b.floor || a.scheduleId.localeCompare(b.scheduleId),
);
export const SUPPLEMENTAL_SIGNS = [];
for (let f = 0; f < 3; f++) {
  for (const [stair, x] of [
    ["A", -18],
    ["B", 18],
  ]) {
    SUPPLEMENTAL_SIGNS.push({
      assetId: `EGRESS-STAIR-${stair}-${f}`,
      kind: "egress-sign",
      label: `Stair ${stair} · ${["Ground", "First", "Second"][f]} floor`,
      floor: f,
      x,
      z: -6.13,
      y: f * ENVELOPE.floorHeight + EGRESS_BASIS.mountingHeight,
      text: `STAIR ${stair}\n${["GROUND", "FIRST", "SECOND"][f]} FLOOR\n${f ? "EXIT: DOWN TO GROUND" : `EXIT ${stair === "A" ? "→" : "←"} SIDE DOOR`}`,
      pictogram: f ? "stair-descent" : "level-exit",
      pictogramDirection: f ? "DOWN_LEFT" : stair === "A" ? "RIGHT" : "LEFT",
      stair,
      floorName: ["GROUND", "FIRST", "SECOND"][f],
      size: { width: 1.1, height: 0.62 },
      faces: [face([0, -1], [f ? 1 : stair === "A" ? -1 : 1, 0])],
      destination: f
        ? "Descend this stair to ground; do not continue to roof"
        : "Outer-wall side discharge",
      mount: "Front enclosure wall, facing stair landing",
      sourcePage: 9,
      supplemental: true,
    });
  }
  for (const [name, x, z] of [
    ["LIFT", -0.75, -7.84],
    ["CENTRAL STAIR", 2, -6.85],
  ])
    SUPPLEMENTAL_SIGNS.push({
      assetId: `EGRESS-NONEXIT-${name.replaceAll(" ", "-")}-${f}`,
      kind: "egress-sign",
      label: `${name} · not an exit route`,
      floor: f,
      x,
      z,
      y: f * ENVELOPE.floorHeight + 2.5,
      text: `${name}\nNOT AN EXIT ROUTE`,
      faces: [face([0, 1])],
      destination:
        "Use enclosed Stair A or B; accessible evacuation strategy remains to be designed",
      mount: "Approach-side identification",
      sourcePage: 7,
      supplemental: true,
      notice: true,
    });
}
for (const side of [-1, 1]) {
  SUPPLEMENTAL_SIGNS.push({
    assetId: `EGRESS-OUTDOOR-${side < 0 ? "A" : "B"}`,
    kind: "egress-sign",
    label: "Candidate outdoor continuation",
    floor: 0,
    x: side * 20.6,
    z: -5.7,
    y: 2.35,
    faces: [face([0, -1], [0, 1])],
    destination:
      "Follow side pedestrian path toward front site edge; public-way connection unverified",
    mount: "Post beside side path, clear of discharge door",
    sourcePage: 7,
    supplemental: true,
    outdoor: true,
    conditional: true,
  });
}
export function routeFromRoom(roomId) {
  const room = ALL_ROOMS.find((r) => r.id === roomId);
  if (!room || ["lift", "central-stair", "riser"].includes(room.furniture))
    return null;
  const d = room.doors.find((d) => !d.exterior) || room.doors[0];
  if (!d) return null;
  const p = doorPosition(room, d),
    side = room.bounds.x1 + room.bounds.x2 < 0 ? -1 : 1;
  const pts = [[p.x, p.z]];
  let conditional = false;
  if (d.exterior) {
    pts.push(
      [p.x, -12.8],
      [p.x, -14.5],
      [side * EGRESS_BASIS.sidePathX, -14.5],
    );
    return {
      roomId,
      floor: 0,
      side,
      exteriorOnly: true,
      conditional: true,
      points: pts,
      startsAt: "Dedicated exterior room door",
    };
  }
  const rear = side * 15;
  if (room.furniture === "stairs") pts.push([side * 18, -6.8]);
  else if (p.z >= 2) {
    const front = side < 0 ? -12 : 13;
    pts.push(
      [front, p.z],
      [front, 0.8],
      [rear, 0.8],
      [rear, -6.8],
      [side * 16, -6.8],
    );
  } else if (d.side === "S")
    pts.push([p.x, 0.8], [rear, 0.8], [rear, -6.8], [side * 16, -6.8]);
  else if (Math.abs(p.x) === 5) {
    conditional = true;
    pts.push(
      [side * 4, p.z],
      [side * 4, 0.8],
      [rear, 0.8],
      [rear, -6.8],
      [side * 16, -6.8],
    );
  } else pts.push([rear, p.z], [rear, -6.8], [side * 16, -6.8]);
  return {
    roomId,
    floor: room.floor,
    side,
    conditional,
    points: pts,
    startsAt:
      "Room doorway; travel from furniture/most remote point is not assessed",
  };
}
// Follows real tread tops and landings, never the lift, roof or central stair.
export function stairDescent(stairs, side, floor, stopFloor = 0) {
  const points = [],
    x = side * 18;
  for (let f = floor; f > stopFloor; f--) {
    const s = stairs.find((s) => s.floor === f - 1 && s.centerX === x);
    const front = s.floorLanding.z1,
      rear = s.turnLanding.z2;
    const right = x + s.laneOffset,
      left = x - s.laneOffset;
    points.push([right, s.top, -6.8], [right, s.top, front]);
    for (let i = 0; i < s.risers - 1; i++) {
      const y = s.top - (i + 1) * s.rise;
      points.push(
        [right, y, front - i * s.treadDepth],
        [right, y, front - (i + 1) * s.treadDepth],
      );
    }
    points.push(
      [right, s.middle, rear],
      [right, s.middle, rear - 0.35],
      [left, s.middle, rear - 0.35],
      [left, s.middle, rear],
    );
    for (let i = 0; i < s.risers - 1; i++) {
      const y = s.middle - (i + 1) * s.rise;
      points.push(
        [left, y, rear + i * s.treadDepth],
        [left, y, rear + (i + 1) * s.treadDepth],
      );
    }
    points.push([left, s.bottom, front], [left, s.bottom, -6.8]);
  }
  return points;
}
export function outdoorContinuation(side, fromRear = false) {
  const x = side * EGRESS_BASIS.sidePathX;
  return [
    ...(fromRear
      ? side > 0
        ? [
            [21.65, 0.06, -14.5],
            [21.65, 0.06, -6.0],
            [x, 0.06, -6.0],
          ]
        : []
      : [
          [side * 20, 0.06, -6.8],
          [x, 0.06, -6.8],
        ]),
    [x, 0.06, EGRESS_BASIS.publicWayZ],
  ];
}

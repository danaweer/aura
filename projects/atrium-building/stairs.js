/* Stair doors, slab openings, flights and roof access share one geometric definition. */
import { ENVELOPE } from "./layout.js";
import { builder, group } from "./geometry.js";

export const ROOF_LANDING_Y = ENVELOPE.floorHeight * 3 + 0.3525;

export function stairLayout(room) {
  const b = room.bounds;
  const centerX = (b.x1 + b.x2) / 2;
  const door = room.doors.find((opening) => !opening.exterior);
  const landingBack = Math.min(b.z2 - 1.55, door.at - door.width / 2 - 0.25);
  return {
    centerX,
    laneOffset: 0.75,
    laneWidth: 1.25,
    floorLanding: {
      x1: b.x1 + 0.15,
      x2: b.x2 - 0.15,
      z1: landingBack,
      z2: b.z2 - 0.15,
    },
    opening: {
      x1: b.x1 + 0.15,
      x2: b.x2 - 0.15,
      z1: b.z1 + 0.15,
      z2: b.z2 - 0.15,
    },
    turnLanding: {
      x1: centerX - 1.45,
      x2: centerX + 1.45,
      z1: b.z1 + 0.15,
      z2: b.z1 + 1.4,
    },
    roofDoorX: centerX + 0.75,
  };
}

export function createCoreStair(parent, room, floor, materials) {
  const geometry = builder(),
    { box, beam } = geometry;
  const spec = stairLayout(room);
  const bottom = floor * ENVELOPE.floorHeight;
  const top = floor === 2 ? ROOF_LANDING_Y : bottom + ENVELOPE.floorHeight;
  const middle = (bottom + top) / 2;
  const risers = floor === 2 ? 13 : 12;
  const rise = (middle - bottom) / risers;
  const startZ = spec.floorLanding.z1,
    endZ = spec.turnLanding.z2;
  const treadDepth = (startZ - endZ) / (risers - 1);
  const root = group(parent, `${room.id} stairs and landings`, {
    floor,
    roomId: room.id,
    kind: "circulation",
    label: `${room.id} · connected stair and floor landing`,
  });
  const landing = (bounds, y, kind) =>
    box(
      root,
      (bounds.x1 + bounds.x2) / 2,
      y - 0.09,
      (bounds.z1 + bounds.z2) / 2,
      bounds.x2 - bounds.x1,
      0.18,
      bounds.z2 - bounds.z1,
      materials.floor,
      { kind, label: `${room.id} · ${kind}`, elevation: y },
    );
  // Ground has its original solid slab; upper landings fill their slab openings exactly.
  if (floor > 0) landing(spec.floorLanding, bottom, "stair-floor-landing");
  landing(spec.turnLanding, middle, "stair-turn-landing");
  if (floor === 2) landing(spec.floorLanding, top, "stair-roof-landing");

  for (const flight of [0, 1]) {
    const x =
      spec.centerX + (flight === 0 ? -spec.laneOffset : spec.laneOffset);
    const zA = flight === 0 ? startZ : endZ;
    const direction = flight === 0 ? -1 : 1;
    const base = flight === 0 ? bottom : middle;
    for (let step = 0; step < risers - 1; step++) {
      const y = base + (step + 1) * rise;
      const z = zA + direction * (step + 0.5) * treadDepth;
      box(
        root,
        x,
        y - 0.055,
        z,
        spec.laneWidth,
        0.11,
        treadDepth,
        materials.floor,
        { kind: "stair-tread", flight, step, elevation: y },
      );
      // Solid risers meet each tread; the last riser meets the landing, not a floating step.
      box(
        root,
        x,
        y - rise / 2,
        zA + direction * step * treadDepth,
        spec.laneWidth,
        rise,
        0.035,
        materials.floor,
        { kind: "stair-riser", flight },
      );
    }
    const zB = flight === 0 ? endZ : startZ;
    box(
      root,
      x,
      base + (risers - 0.5) * rise,
      zB,
      spec.laneWidth,
      rise,
      0.035,
      materials.floor,
      { kind: "stair-riser", flight },
    );
    for (const side of [-1, 1]) {
      const railX = x + side * (spec.laneWidth / 2 - 0.025);
      const a = [railX, base + rise + 1.05, zA];
      const b = [railX, base + risers * rise + 1.05, zB];
      beam(root, a, b, 0.045, materials.rail, { kind: "stair-handrail" });
      for (let step = 0; step < risers; step += 2) {
        const t = step / (risers - 1),
          z = zA + (zB - zA) * t;
        const y = base + (step + 1) * rise;
        beam(root, [railX, y, z], [railX, y + 1.05, z], 0.035, materials.rail, {
          kind: "stair-guard",
        });
      }
    }
  }
  function guard(a, b, y) {
    beam(
      root,
      [a[0], y + 1.05, a[1]],
      [b[0], y + 1.05, b[1]],
      0.045,
      materials.rail,
      { kind: "stair-guard" },
    );
    const count = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.35);
    for (let i = 0; i <= count; i++) {
      const x = a[0] + ((b[0] - a[0]) * i) / count,
        z = a[1] + ((b[1] - a[1]) * i) / count;
      beam(root, [x, y, z], [x, y + 1.05, z], 0.03, materials.rail, {
        kind: "stair-guard",
      });
    }
  }
  // Guard only the well edges; both flight mouths and every landing door stay open.
  for (const elevation of floor === 2 ? [bottom, top] : [bottom]) {
    const x = spec.centerX,
      w = spec.laneWidth / 2,
      o = spec.laneOffset;
    for (const [a, b] of [
      [spec.opening.x1, x - o - w],
      [x - o + w, x + o - w],
      [x + o + w, spec.opening.x2],
    ])
      guard([a, startZ], [b, startZ], elevation);
  }
  guard(
    [spec.turnLanding.x1, spec.turnLanding.z1],
    [spec.turnLanding.x2, spec.turnLanding.z1],
    middle,
  );
  geometry.flush();
  return {
    root,
    roomId: room.id,
    floor,
    bottom,
    middle,
    top,
    risers,
    rise,
    treadDepth,
    ...spec,
  };
}

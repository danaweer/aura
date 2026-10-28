/* Connected conceptual air paths; not sized, balanced or commissioned HVAC. */
import { FLOORS, CORRIDORS, ENVELOPE, isReserved } from "./layout.js";
import { ROOF_Y, EAST_ROOF_OPENING } from "./architecture.js";
import { builder, group, finish } from "./geometry.js";

export const CEILING_Y = 3.1;
export const SHAFTS = {
  West: {
    supply: [-9.23, -12.52],
    return: [-8.77, -12.52],
    exhaust: [-20.48, -2.8],
  },
  East: {
    supply: [12.25, -4.6],
    return: [12.95, -4.6],
    exhaust: [13.65, -4.6],
  },
};

export function createBuildingServices({ root, floors, roof }) {
  const geo = builder(),
    { box, beam, cylinder, plate } = geo;
  const m = {
    ceiling: finish(0xe6e4db),
    seam: finish(0xb3b6b3),
    light: finish(0xfff1d1, { emissive: 0xffe4ac, emissiveIntensity: 0.5 }),
    metal: finish(0x9ca9aa, { metalness: 0.6, roughness: 0.38 }),
    dark: finish(0x35464b, { metalness: 0.35 }),
    base: finish(0x9b9b91),
    supply: finish(0x6c9daa, { metalness: 0.35 }),
    return: finish(0x90a48b),
    exhaust: finish(0xb28c65),
    refrigerant: finish(0x8f809c),
    stone: finish(0xded5c3),
  };
  const ceilings = [],
    distribution = [],
    routes = [],
    terminals = [],
    plant = [];
  const rooftop = group(roof, "Rooftop equipment", {
    kind: "rooftop-equipment",
    layer: "systems",
    label: "Conceptual rooftop HVAC reservations · no calculated capacities",
  });
  const riserShell = group(root, "External west service chase", {
    kind: "exterior-chase",
    label:
      "Separate west air-service chase, outside wet riser and service-door openings",
  });
  // New west chase is necessary because the retained west shaft is reserved for wet services.
  // It sits outside the envelope, between the water-room and fire-pump door clearances.
  box(riserShell, -9, ROOF_Y / 2, -12.52, 1.15, ROOF_Y, 0.78, m.stone);
  box(riserShell, -20.48, ROOF_Y / 2, -2.8, 0.44, ROOF_Y, 0.44, m.stone, {
    kind: "exhaust-chase",
    label: "Separate west sanitary-exhaust chase",
  });

  function route(
    parent,
    id,
    system,
    points,
    width = 0.3,
    height = 0.2,
    detail = "",
  ) {
    const part = group(parent, id, {
      assetId: id,
      kind: "hvac",
      system,
      label: `${system} · ${id}`,
      detail:
        detail ||
        "Connected conceptual route in ceiling zone; dimensions are visual reservations, not engineering sizes.",
    });
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i];
      const dx = Math.abs(a[0] - b[0]),
        dy = Math.abs(a[1] - b[1]),
        dz = Math.abs(a[2] - b[2]);
      if (dx + dy + dz < 0.001) continue;
      if ([dx, dy, dz].filter((n) => n > 0.001).length !== 1)
        throw new Error(`Non-orthogonal service route ${id}`);
      box(
        part,
        (a[0] + b[0]) / 2,
        (a[1] + b[1]) / 2,
        (a[2] + b[2]) / 2,
        dx || width,
        dy || height,
        dz || width,
        m[system] || m.metal,
      );
    }
    routes.push({ id, system, points, width, height, group: part });
    return part;
  }
  function grille(parent, room, type, x, y, z) {
    const info = {
      roomId: room.id,
      floor: room.floor,
      kind: "air-terminal",
      system: type,
      label: `${room.id} · ${type === "exhaust" ? "separate bathroom exhaust" : type === "supply" ? "supply diffuser" : "return grille"}`,
      detail:
        "Connected to the corresponding route; conceptual location and size only.",
    };
    box(parent, x, y, z, 0.48, 0.055, 0.48, m.dark, info);
    for (let i = -2; i <= 2; i++)
      box(
        parent,
        x + i * 0.075,
        y - 0.035,
        z,
        0.025,
        0.025,
        0.43,
        m[type],
        info,
      );
    terminals.push({ roomId: room.id, system: type, position: [x, y, z] });
  }
  for (const floor of FLOORS) {
    const y = floor.index * ENVELOPE.floorHeight;
    const ceiling = group(floors[floor.index], "Ceilings", {
      floor: floor.index,
      layer: "ceilings",
      kind: "ceiling",
      label: "Suspended ceiling · separate from structural slab",
    });
    const services = group(floors[floor.index], "HVAC distribution", {
      floor: floor.index,
      layer: "systems",
      kind: "hvac",
      label: "Connected conceptual ceiling services",
    });
    ceilings.push(ceiling);
    distribution.push(services);
    const occupied = floor.rooms.filter(
      (room) =>
        !isReserved(room) &&
        !["stairs", "lift", "central-stair"].includes(room.furniture),
    );
    for (const room of occupied) {
      const b = room.bounds,
        cx = (b.x1 + b.x2) / 2,
        cz = (b.z1 + b.z2) / 2;
      const west = cx < 0,
        wing = west ? "West" : "East";
      const sanitary = ["wc", "accessible-wc", "janitor"].includes(
        room.furniture,
      );
      const s = [cx - 0.65, y + CEILING_Y - 0.035, cz - 0.45];
      // Offset the return lane beyond the retained column line at x=±16.
      const r = [cx + 0.85, y + CEILING_Y - 0.035, cz + 0.55];
      const holes = (sanitary ? [s] : [s, r]).map(([x, , z]) => ({
        x1: x - 0.25,
        x2: x + 0.25,
        z1: z - 0.25,
        z2: z + 0.25,
      }));
      plate(
        ceiling,
        { x1: b.x1 + 0.08, x2: b.x2 - 0.08, z1: b.z1 + 0.08, z2: b.z2 - 0.08 },
        y + CEILING_Y + 0.06,
        0.08,
        m.ceiling,
        holes,
        {
          roomId: room.id,
          kind: "ceiling",
          floor: floor.index,
          label: `${room.id} · suspended ceiling`,
        },
      );
      const info = {
        roomId: room.id,
        floor: floor.index,
        kind: "ceiling-light",
        label: `${room.id} · recessed ceiling light`,
      };
      for (const dz of [-1.0, 1.0])
        box(
          ceiling,
          cx,
          y + CEILING_Y - 0.035,
          cz + dz,
          Math.min(1.5, b.x2 - b.x1 - 0.6),
          0.035,
          0.14,
          m.light,
          info,
        );
      box(
        ceiling,
        b.x1 + 0.48,
        y + CEILING_Y - 0.03,
        b.z2 - 0.55,
        0.5,
        0.025,
        0.5,
        m.seam,
        {
          ...info,
          kind: "access-panel",
          label: `${room.id} · ceiling maintenance panel`,
        },
      );
      if (sanitary) {
        const h = y + 3.83,
          [ex, ez] = SHAFTS[wing].exhaust;
        // Bathroom exhaust remains separate from recirculated office return air.
        const points = west
          ? [[ex, h, ez], [s[0], h, ez], [s[0], h, s[2]], s]
          : [[ex, h, ez], [ex, h, -2.8], [s[0], h, -2.8], [s[0], h, s[2]], s];
        route(services, `${room.id}-EXTRACT`, "exhaust", points, 0.15, 0.12);
        grille(services, { ...room, floor: floor.index }, "exhaust", ...s);
      } else {
        for (const [system, position, h] of [
          ["supply", s, y + 3.64],
          ["return", r, y + 3.38],
        ]) {
          const points = [
            [position[0], h, 0.8],
            [position[0], h, position[2]],
            position,
          ];
          route(
            services,
            `${room.id}-${system.toUpperCase()}`,
            system,
            points,
            system === "supply" ? 0.28 : 0.23,
            system === "supply" ? 0.2 : 0.17,
          );
          grille(
            services,
            { ...room, floor: floor.index },
            system,
            ...position,
          );
        }
      }
    }
    for (const corridor of CORRIDORS) {
      plate(ceiling, corridor, y + CEILING_Y + 0.06, 0.08, m.ceiling, [], {
        kind: "corridor-ceiling",
      });
      const cx = (corridor.x1 + corridor.x2) / 2,
        cz = (corridor.z1 + corridor.z2) / 2;
      box(
        ceiling,
        cx,
        y + CEILING_Y - 0.035,
        cz,
        Math.min(1.4, corridor.x2 - corridor.x1 - 0.4),
        0.035,
        0.16,
        m.light,
        { kind: "corridor-light" },
      );
      box(
        ceiling,
        cx + 0.5,
        y + CEILING_Y - 0.04,
        cz + 0.35,
        0.45,
        0.02,
        0.45,
        m.seam,
        { kind: "access-panel" },
      );
    }
    for (const wing of ["West", "East"]) {
      const west = wing === "West",
        shaft = SHAFTS[wing];
      for (const [system, h] of [
        ["supply", y + 3.64],
        ["return", y + 3.38],
      ]) {
        const [x, z] = shaft[system];
        route(
          services,
          `${floor.prefix}-${wing}-${system}-FEED`,
          system,
          [
            [x, y, z],
            [x, y + 4.2, z],
          ],
          0.27,
          0.22,
        );
        route(
          services,
          `${floor.prefix}-${wing}-${system}-SPINE`,
          system,
          [
            [x, h, z],
            [x, h, 0.8],
            [west ? -5.7 : 5.7, h, 0.8],
          ],
          0.33,
          system === "supply" ? 0.2 : 0.17,
        );
        route(
          services,
          `${floor.prefix}-${wing}-${system}-CORRIDOR`,
          system,
          [
            [x, h, 0.8],
            [west ? -19.5 : 19.5, h, 0.8],
          ],
          0.33,
          system === "supply" ? 0.2 : 0.17,
        );
      }
      const [ex, ez] = shaft.exhaust;
      route(
        services,
        `${floor.prefix}-${wing}-EXHAUST-RISER`,
        "exhaust",
        [
          [ex, y, ez],
          [ex, y + 4.2, ez],
        ],
        0.18,
        0.18,
        west
          ? "Separate external sanitary-exhaust stack, away from fresh-air intake."
          : "Sanitary exhaust in the existing HVAC shaft; kept separate from supply and office return.",
      );
    }
  }

  for (const wing of ["West", "East"]) {
    const west = wing === "West",
      shaft = SHAFTS[wing];
    const cx = west ? -10.15 : 10.15,
      y = ROOF_Y;
    const info = {
      kind: "rooftop-equipment",
      label: `${wing} rooftop mechanical reservation`,
      detail:
        "Conceptual equipment, airflow clearance and maintenance layout only. No capacity, structural adequacy or compliance is implied.",
    };
    const zone = group(rooftop, `${wing} mechanical equipment`, info);
    // Equipment is placed either side of an unobstructed central maintenance aisle.
    const coolX = cx - 2.2,
      ahuX = cx + 2.1,
      z = -8.1;
    for (const x of [coolX, ahuX]) {
      box(zone, x, y + 0.44, z, 2.8, 0.24, 2.6, m.base, {
        ...info,
        kind: "equipment-base",
        label: "Conceptual equipment support base · structural design pending",
      });
      for (const dx of [-0.85, 0.85])
        box(zone, x + dx, y + 0.66, z, 0.15, 0.25, 2.05, m.dark);
    }
    const cooling = group(zone, `${wing} cooling unit`, {
      ...info,
      assetId: `ROOF-${wing}-COOL`,
      label: `${wing} outdoor cooling unit · heat rejection, not room fresh air`,
    });
    box(cooling, coolX, y + 1.21, z, 2.15, 1.1, 1.9, m.metal);
    for (const dx of [-0.54, 0.54]) {
      cylinder(cooling, coolX + dx, y + 1.79, z, 0.43, 0.07, m.dark, {
        kind: "cooling-fan",
      });
      cylinder(cooling, coolX + dx, y + 1.83, z, 0.1, 0.06, m.metal);
      for (let i = -2; i <= 2; i++)
        box(
          cooling,
          coolX + dx,
          y + 1.85,
          z + i * 0.11,
          0.73,
          0.025,
          0.022,
          m.metal,
        );
    }
    for (let dz = -0.7; dz <= 0.7; dz += 0.18)
      box(cooling, coolX - 1.09, y + 1.17, z + dz, 0.035, 0.82, 0.04, m.dark);
    const ahu = group(zone, `${wing} AHU`, {
      ...info,
      assetId: `ROOF-${wing}-AHU`,
      label: `${wing} ventilation / air-handling unit · separate outdoor-air intake`,
    });
    box(ahu, ahuX, y + 1.19, z, 2.25, 1.08, 2.05, m.metal);
    for (const dx of [-0.6, 0.3])
      box(ahu, ahuX + dx, y + 1.19, z + 1.04, 0.035, 0.99, 0.02, m.dark);
    // Fresh-air intake faces the open roof, rather than a cooling fan or sanitary outlet.
    const intake = [ahuX, y + 1.22, z + 1.15];
    box(ahu, ...intake, 1.15, 0.68, 0.18, m.dark, {
      kind: "outdoor-air-intake",
      label: "Outdoor-air intake · separate from exhaust and condenser",
    });
    for (let h = -0.25; h < 0.3; h += 0.1)
      box(
        ahu,
        ahuX,
        intake[1] + h,
        intake[2] + 0.1,
        1.08,
        0.035,
        0.07,
        m.metal,
      );
    const exhaustOutlet = west
      ? [-18.8, y + 2.15, -2.8]
      : [15.2, y + 2.15, -11.0];
    const [ex, ez] = shaft.exhaust;
    route(
      zone,
      `${wing}-EXHAUST-ROOF`,
      "exhaust",
      [
        [ex, y, ez],
        [ex, y + 1.4, ez],
        [exhaustOutlet[0], y + 1.4, ez],
        [exhaustOutlet[0], y + 1.4, exhaustOutlet[2]],
        exhaustOutlet,
      ],
      0.18,
      0.18,
    );
    cylinder(zone, ...exhaustOutlet, 0.22, 0.35, m.dark, {
      ...info,
      kind: "exhaust-outlet",
      label: "Sanitary exhaust discharge · separated from outdoor-air intake",
    });
    cylinder(
      zone,
      exhaustOutlet[0],
      exhaustOutlet[1] + 0.26,
      exhaustOutlet[2],
      0.34,
      0.08,
      m.metal,
    );
    plant.push({
      wing,
      intake,
      exhaustOutlet,
      cooling: { x: coolX, z },
      ahu: { x: ahuX, z },
      aisle: { x1: cx - 0.55, x2: cx + 0.55, z1: -9.6, z2: -5.4 },
    });
    for (const [system, outX, routeY] of [
      ["supply", ahuX - 0.4, y + 1.45],
      ["return", ahuX + 0.4, y + 0.95],
    ]) {
      const [sx, sz] = shaft[system];
      const routeLevel = west ? y + (system === "supply" ? 1.5 : 1.85) : routeY;
      // West ducts rise over the rear parapet into the external chase; east uses a real shaft opening.
      route(
        zone,
        `${wing}-${system}-ROOF`,
        system,
        [
          [outX, y + 1.19, z - 1.1],
          [outX, routeLevel, z - 1.1],
          [sx, routeLevel, z - 1.1],
          [sx, routeLevel, sz],
          [sx, y, sz],
        ],
        0.27,
        0.22,
      );
    }
    // Paired small-bore lines connect cooling unit to AHU coil reservation, not to fresh-air grilles.
    for (const dz of [-0.1, 0.1])
      route(
        zone,
        `${wing}-COOLING-COIL-${dz}`,
        "refrigerant",
        [
          [coolX + 1.1, y + 0.85, z + dz],
          [coolX + 1.1, y + 0.85, -10.2 + dz],
          [ahuX - 1.15, y + 0.85, -10.2 + dz],
          [ahuX - 1.15, y + 0.85, z + dz],
        ],
        0.045,
        0.045,
        "Conceptual cooling-coil connection. Refrigerant/hydronic technology and sizing remain undecided.",
      );
    // Raised weathering collar around the east shaft penetration, never on atrium glazing.
    if (!west)
      for (const x of [
        EAST_ROOF_OPENING.x1 - 0.06,
        EAST_ROOF_OPENING.x2 + 0.06,
      ])
        box(zone, x, y + 0.34, -4.6, 0.12, 0.58, 0.85, m.metal, {
          kind: "shaft-weathering",
        });
  }
  geo.flush();
  return {
    ceilings,
    distribution,
    rooftop,
    routes,
    terminals,
    plant,
    riserShell,
  };
}

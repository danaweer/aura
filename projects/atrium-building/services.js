/* Connected conceptual air paths; not sized, balanced or commissioned HVAC. */
import { isWashroom, washroomPlan } from "./washroom-plan.js";
import { createWashroomPlumbing } from "./washroom-plumbing.js";
import { FLOORS, CORRIDORS, ENVELOPE, isReserved } from "./layout.js";
import { ROOF_Y, EAST_ROOF_OPENING } from "./architecture.js";
import { builder, group, finish } from "./geometry.js";
import {
  deviceAirCandidates,
  deviceOccupancyCandidate,
} from "./device-plan.js";

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
  const legacyAir = [],
    terminalGroups = [],
    lights = [],
    lighting = [];
  function light(parent, room, floor, id, position, size, info) {
    const object = group(parent, id, info);
    box(object, ...position, ...size, m.light, info);
    lights.push({
      id,
      roomId: room?.id,
      floor,
      position,
      size,
      object,
      data: info,
    });
  }
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
    if (["supply", "return"].includes(system)) {
      // R01 supersedes these earlier roof-fed routes. Retain their IDs/catalog
      // for comparison, but never draw a second competing air network.
      legacyAir.push(part);
      routes.push({
        id,
        system,
        points,
        width,
        height,
        group: part,
        superseded: true,
      });
      return part;
    }
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
  function grille(parent, room, type, x, y, z, routeId) {
    const info = {
      roomId: room.id,
      floor: room.floor,
      assetId: routeId ? `${routeId}-GRILLE` : `${room.id}-${type}-GRILLE`,
      kind: "air-terminal",
      system: type,
      label: `${room.id} · ${type === "exhaust" ? "separate bathroom exhaust" : type === "supply" ? "supply diffuser" : "return grille"}`,
      detail:
        "Connected to the corresponding route; conceptual location and size only.",
    };
    parent = group(parent, `${info.assetId} terminal`, {
      ...info,
      system: type,
    });
    terminalGroups.push(parent);
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
    terminals.push({
      roomId: room.id,
      system: type,
      position: [x, y, z],
      routeId,
    });
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
    const lightLayer = group(
      floors[floor.index],
      "Ceiling lighting · independent inspection layer",
      { floor: floor.index, layer: "lighting" },
    );
    lighting.push(lightLayer);
    const sanitaryParts = group(
      services,
      "Sanitary fan and damper reservations",
      { system: "exhaust", floor: floor.index },
    );
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
      const air = deviceAirCandidates(room, y + CEILING_Y - 0.035);
      const s = air?.supply[0] || [cx - 0.65, y + CEILING_Y - 0.035, cz - 0.45];
      // Offset the return lane beyond the retained column line at x=±16.
      const r = air?.return[0] || [cx + 0.85, y + CEILING_Y - 0.035, cz + 0.55];
      const washroom = isWashroom(room) ? washroomPlan(room) : null;
      const extracts = washroom
        ? washroom.extract.map(({ position }) => [
            position[0],
            y + CEILING_Y - 0.035,
            position[2],
          ])
        : [s];
      const makeUp = washroom
        ? [washroom.supply[0], y + CEILING_Y - 0.035, washroom.supply[2]]
        : [cx + 0.45, y + CEILING_Y - 0.035, cz + 0.6];
      const holes = (
        sanitary ? [...extracts, makeUp] : [...(air?.supply || [s]), r]
      ).map(([x, , z]) => ({
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
      for (const [index, dz] of [-1.0, 1.0].entries()) {
        const width = Math.min(1.5, b.x2 - b.x1 - 0.6);
        const occ = deviceOccupancyCandidate(room),
          lightObstacles = [
            ...holes,
            ...(occ
              ? [
                  {
                    x1: occ[0] - 0.11,
                    x2: occ[0] + 0.11,
                    z1: occ[2] - 0.11,
                    z2: occ[2] + 0.11,
                  },
                ]
              : []),
          ];
        let lx = cx,
          lz = cz + dz,
          found = false;
        for (const zOffset of [0, -0.35, 0.35, -0.7, 0.7]) {
          const z = cz + dz + zOffset;
          if (z - 0.12 < b.z1 + 0.2 || z + 0.12 > b.z2 - 0.2) continue;
          for (const offset of [0, -0.4, 0.4, -0.75, 0.75]) {
            const x = cx + offset;
            if (x - width / 2 < b.x1 + 0.2 || x + width / 2 > b.x2 - 0.2)
              continue;
            if (
              !lightObstacles.some(
                (h) =>
                  x + width / 2 + 0.05 > h.x1 &&
                  x - width / 2 - 0.05 < h.x2 &&
                  z + 0.12 > h.z1 &&
                  z - 0.12 < h.z2,
              )
            ) {
              lx = x;
              lz = z;
              found = true;
              break;
            }
          }
          if (found) break;
        }
        light(
          lightLayer,
          room,
          floor.index,
          `L-${room.id}-${String(index + 1).padStart(2, "0")}`,
          [lx, y + CEILING_Y - 0.035, lz],
          [width, 0.035, 0.14],
          info,
        );
      }
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
        const h = y + 3.58,
          [ex, ez] = SHAFTS[wing].exhaust;
        // Each cubicle has its own terminal and connected extract branch.
        for (const [index, position] of extracts.entries()) {
          const id = `${room.id}-EXTRACT${index ? `-C0${index + 1}` : ""}`;
          const outerH = y + 3.5;
          const points = west
            ? [
                [ex, outerH, ez],
                ...(position[0] > -14.5
                  ? [
                      [-14.86, outerH, ez],
                      [-14.86, y + 3.88, ez],
                      [-13.9, y + 3.88, ez],
                      [-13.9, h, ez],
                    ]
                  : []),
                [position[0], position[0] > -14.5 ? h : outerH, ez],
                [position[0], position[0] > -14.5 ? h : outerH, position[2]],
                position,
              ]
            : [
                [ex, h, ez],
                [ex, h, -2.8],
                [13.9, h, -2.8],
                [13.9, y + 3.88, -2.8],
                [14.86, y + 3.88, -2.8],
                [14.86, outerH, -2.8],
                [position[0], outerH, -2.8],
                [position[0], outerH, position[2]],
                position,
              ];
          route(services, id, "exhaust", points, 0.15, 0.12);
          grille(
            services,
            { ...room, floor: floor.index },
            "exhaust",
            ...position,
            id,
          );
          box(
            sanitaryParts,
            position[0],
            h,
            (position[2] - 2.8) / 2,
            0.2,
            0.16,
            0.08,
            m.dark,
            {
              assetId: `${id}-DAMPER`,
              roomId: room.id,
              kind: "balancing-damper",
              label: `${room.id} accessible extract balancing damper · conceptual`,
            },
          );
        }
        // Direct tempered make-up reservation; no unapproved corridor-wall grille.
        route(
          services,
          `${room.id}-SUPPLY`,
          "supply",
          [
            [makeUp[0], y + 3.64, 0.8],
            [makeUp[0], y + 3.64, makeUp[2]],
            makeUp,
          ],
          0.18,
          0.14,
          "Tempered washroom make-up air. Negative balance, acoustics and fan duty require design; no office-return connection.",
        );
        grille(services, { ...room, floor: floor.index }, "supply", ...makeUp);
      } else {
        for (const [system, position, h] of [
          ["supply", s, y + 3.64],
          ["return", r, y + 3.38],
          ...(air?.supply
            .slice(1)
            .map((position) => ["supply", position, y + 3.64]) || []),
        ]) {
          const extra = system === "supply" && position !== s;
          const id = `${room.id}-${system.toUpperCase()}${extra ? "-D02-02" : ""}`;
          const points = [
            [position[0], h, 0.8],
            [position[0], h, position[2]],
            position,
          ];
          route(
            services,
            id,
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
            extra ? id : undefined,
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
      cylinder(sanitaryParts, ex, y + 3.81, ez, 0.15, 0.28, m.dark, {
        assetId: `EF-${floor.prefix}-${west ? "A" : "B"}-01`,
        kind: "washroom-point",
        floor: floor.index,
        label: `${wing} sanitary extract fan · planned / unavailable`,
        detail:
          "Enable command, running proof and fault are unbound. No airflow or pressure performance has been calculated.",
        status: "unavailable",
        source: "model-only",
      });
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
    const oldPlant = group(zone, `${wing} superseded roof AHU study`, {
      superseded: true,
    });
    legacyAir.push(oldPlant);
    // Equipment is placed either side of an unobstructed central maintenance aisle.
    const coolX = cx - 2.2,
      ahuX = cx + 2.1,
      z = -8.1;
    for (const x of [ahuX]) {
      box(oldPlant, x, y + 0.44, z, 2.8, 0.24, 2.6, m.base, {
        ...info,
        kind: "equipment-base",
        label: "Conceptual equipment support base · structural design pending",
      });
      for (const dx of [-0.85, 0.85])
        box(oldPlant, x + dx, y + 0.66, z, 0.15, 0.25, 2.05, m.dark);
    }
    const ahu = group(oldPlant, `${wing} AHU`, {
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
    const exhaustParts = group(zone, `${wing} sanitary discharge`, {
      system: "exhaust",
    });
    route(
      exhaustParts,
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
    cylinder(exhaustParts, ...exhaustOutlet, 0.22, 0.35, m.dark, {
      ...info,
      kind: "exhaust-outlet",
      label: "Sanitary exhaust discharge · separated from outdoor-air intake",
    });
    cylinder(
      exhaustParts,
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
      cooling: {
        x: west ? 7.0 : 12.0,
        z: -18,
        floor: 0,
        location: "rear-service-yard",
      },
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
    // P01 moves outdoor cooling placeholders to the ground-level yard.
    // Their connections are separately visible reservations, not fitted roof coils.
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
  const plumbing = createWashroomPlumbing({ floors, roof, distribution });
  geo.flush();
  return {
    plumbing,
    ceilings,
    distribution,
    rooftop,
    routes,
    terminals,
    plant,
    lighting,
    lights,
    riserShell,
    legacyAir,
    terminalGroups,
  };
}

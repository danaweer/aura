/* Architectural treatment of the existing envelope; metres, front +Z. */
import * as THREE from "three";
import { WASHROOM_ROOF_PENETRATIONS } from "./washroom-plan.js";
import { ENVELOPE, FLOORS, ALL_ROOMS } from "./layout.js";
import { builder, group, finish } from "./geometry.js";
import { stairLayout, ROOF_LANDING_Y } from "./stairs.js";

export const ROOF_Y = ENVELOPE.floorHeight * FLOORS.length;
export const EAST_ROOF_OPENING = { x1: 11.96, x2: 13.94, z1: -4.92, z2: -4.28 };
export const WINGS = [
  { name: "West", x1: -ENVELOPE.width / 2, x2: -ENVELOPE.atriumWidth / 2 },
  { name: "East", x1: ENVELOPE.atriumWidth / 2, x2: ENVELOPE.width / 2 },
].map((wing) => ({ ...wing, z1: -ENVELOPE.depth / 2, z2: ENVELOPE.depth / 2 }));
// Door positions were checked against the retained furniture, not inferred from the image.
export const BALCONIES = [
  {
    id: "BAL-CEO",
    roomId: "L2-01",
    x1: -19.4,
    x2: -13.4,
    z1: 12,
    z2: 14.5,
    door: -14.35,
    drain: -19.2,
  },
  {
    id: "BAL-BOARD",
    roomId: "L2-04",
    x1: 5.6,
    x2: 11.6,
    z1: 12,
    z2: 14.5,
    door: 10.65,
    drain: 11.4,
  },
];
const opaqueUse = (room) =>
  room && ["service", "plant", "core"].includes(room.category);

export function createArchitecture({ root, floors, roof, materials }) {
  const geo = builder(),
    { box, beam, cylinder, plate, slopedSurface } = geo;
  const m = {
    stone: finish(0xded5c3),
    trim: finish(0xc4bbaa),
    roof: finish(0xbbb9ac),
    insulation: finish(0xd4c798),
    membrane: finish(0xd8d4c9),
    charcoal: finish(0x303b40, { metalness: 0.55, roughness: 0.33 }),
    wood: finish(0xaf8150),
    paving: finish(0xbcbcaf),
    paverAlt: finish(0xc9c7b9),
    soil: finish(0x514c3b),
    leaf: finish(0x63784a),
    leafLight: finish(0x83925a),
    trunk: finish(0x776047),
    white: finish(0xe5dfd0),
    light: finish(0xfaf0d1, { emissive: 0xffd98d, emissiveIntensity: 0.65 }),
  };
  const facades = [],
    balconyGroups = [],
    roofAccess = [],
    doorways = [],
    facadePanels = [];
  const wingRoofs = group(roof, "Wing roofs", {
    kind: "wing-roof",
    layer: "wingRoofs",
    label: "Solid roof assembly · conceptual build-up",
  });
  const balconies = group(floors[2], "Second-floor balconies", {
    kind: "balcony",
    floor: 2,
  });
  const site = group(root, "Exterior landscaping and furniture", {
    kind: "site",
    layer: "site",
    floor: 0,
    label: "Entrance and site",
  });
  const entrance = group(floors[0], "Entrance improvements", {
    kind: "entrance",
    floor: 0,
    label: "Level entrance, canopy and AURA identification",
  });
  const drainage = group(root, "External roof and balcony drainage", {
    kind: "drainage",
    layer: "drainage",
    label: "Conceptual gravity drainage routes",
  });

  function wallPieces(parent, wall, start, end, bottom, top, material, info) {
    if (end - start < 0.015 || top - bottom < 0.015) return;
    const alongX = wall.axis === "X",
      middle = (start + end) / 2;
    box(
      parent,
      alongX ? middle : wall.fixed,
      bottom + (top - bottom) / 2,
      alongX ? wall.fixed : middle,
      alongX ? end - start : 0.28,
      top - bottom,
      alongX ? 0.28 : end - start,
      material,
      { ...info, side: wall.side },
    );
  }
  function doorFrame(parent, wall, at, y, width, info, glazed = false) {
    const a = wall.axis === "X",
      fixed = wall.fixed;
    for (const sign of [-1, 1])
      box(
        parent,
        a ? at + sign * (width / 2 + 0.035) : fixed,
        y + 1.2,
        a ? fixed : at + sign * (width / 2 + 0.035),
        a ? 0.07 : 0.3,
        2.4,
        a ? 0.3 : 0.07,
        m.charcoal,
        info,
      );
    box(
      parent,
      a ? at : fixed,
      y + 2.43,
      a ? fixed : at,
      a ? width + 0.14 : 0.3,
      0.07,
      a ? 0.3 : width + 0.14,
      m.charcoal,
      info,
    );
    if (!glazed) {
      // Exterior service leaves open inward, preserving their dedicated exterior access.
      const angle = wall.side === "back" ? -Math.PI / 2 : Math.PI / 2;
      const leaf = group(parent, `${info.roomId} exterior door`, info);
      leaf.position.set(
        a ? at - width / 2 : fixed,
        y,
        a ? fixed : at - width / 2,
      );
      leaf.rotation.y = a ? angle : 0;
      box(
        leaf,
        width / 2,
        1.17,
        0,
        width - 0.05,
        2.34,
        0.065,
        m.charcoal,
        info,
      );
      box(leaf, width - 0.16, 1.05, -0.05, 0.15, 0.045, 0.035, m.white, info);
    }
  }

  for (const floor of FLOORS) {
    const y = floor.index * ENVELOPE.floorHeight;
    const exterior = group(floors[floor.index], "Exterior envelope", {
      floor: floor.index,
      layer: "envelope",
    });
    const opaque = group(exterior, "Exterior opaque walls", {
      floor: floor.index,
      kind: "opaque",
      label: "Warm stone opaque cladding",
    });
    const glazing = group(exterior, "Exterior glazing", {
      floor: floor.index,
      kind: "glass",
      label: "Charcoal-framed office windows",
    });
    const details = group(exterior, "Exterior shading and frames", {
      floor: floor.index,
      kind: "facade-detail",
      label: "Window frames, shading and wood-look accents",
    });
    facades.push({ exterior, opaque, glazing, details });
    for (const wing of WINGS) {
      const walls = [
        {
          axis: "X",
          fixed: wing.z2,
          start: wing.x1,
          end: wing.x2,
          side: "front",
          roomSide: "S",
        },
        {
          axis: "X",
          fixed: wing.z1,
          start: wing.x1,
          end: wing.x2,
          side: "back",
          roomSide: "N",
        },
        {
          axis: "Z",
          fixed: wing.x1,
          start: wing.z1,
          end: wing.z2,
          side: "left",
          roomSide: "W",
        },
        {
          axis: "Z",
          fixed: wing.x2,
          start: wing.z1,
          end: wing.z2,
          side: "right",
          roomSide: "E",
        },
      ];
      for (const wall of walls) {
        const alongX = wall.axis === "X";
        const touching = floor.rooms.filter((room) => {
          const b = room.bounds;
          return alongX
            ? (wall.roomSide === "N" ? b.z1 : b.z2) === wall.fixed &&
                b.x1 >= wing.x1 &&
                b.x2 <= wing.x2
            : (wall.roomSide === "W" ? b.x1 : b.x2) === wall.fixed &&
                b.x1 >= wing.x1 &&
                b.x2 <= wing.x2;
        });
        const inner =
          !alongX && Math.abs(wall.fixed) === ENVELOPE.atriumWidth / 2;
        const doors = touching.flatMap((room) =>
          room.doors
            .filter((door) => door.side === wall.roomSide)
            .map((door) => ({
              ...door,
              roomId: room.id,
              kind: "service-door",
              start: door.at - door.width / 2,
              end: door.at + door.width / 2,
            })),
        );
        if (floor.index === 2 && wall.side === "front")
          for (const b of BALCONIES.filter((balcony) =>
            touching.some((room) => room.id === balcony.roomId),
          ))
            doors.push({
              roomId: b.roomId,
              kind: "balcony-door",
              at: b.door,
              width: 1.25,
              start: b.door - 0.625,
              end: b.door + 0.625,
            });
        const cuts = [
          ...new Set([
            wall.start,
            wall.end,
            ...touching.flatMap((room) =>
              alongX
                ? [room.bounds.x1, room.bounds.x2]
                : [room.bounds.z1, room.bounds.z2],
            ),
            ...doors.flatMap((door) => [door.start, door.end]),
            ...(inner ? [-0.4, 2] : []),
          ]),
        ].sort((a, b) => a - b);
        for (let i = 1; i < cuts.length; i++) {
          const start = cuts[i - 1],
            end = cuts[i],
            mid = (start + end) / 2;
          const room = touching.find(
            (r) =>
              mid > (alongX ? r.bounds.x1 : r.bounds.z1) &&
              mid < (alongX ? r.bounds.x2 : r.bounds.z2),
          );
          const opening = doors.find((d) => mid > d.start && mid < d.end);
          const passage = inner && mid > -0.4 && mid < 2;
          const info = {
            floor: floor.index,
            side: wall.side,
            roomId: room?.id,
            kind: "opaque",
            label: room
              ? `${room.id} · exterior wall`
              : "Corridor exterior wall",
          };
          if (opening || passage) {
            wallPieces(
              opaque,
              wall,
              start,
              end,
              y + (passage ? 3.25 : 2.48),
              y + 4.2,
              m.stone,
              info,
            );
            continue;
          }
          const solid = opaqueUse(room) || !room;
          facadePanels.push({
            floor: floor.index,
            side: wall.side,
            axis: wall.axis,
            fixed: wall.fixed,
            start,
            end,
            roomId: room?.id,
            solid,
          });
          if (solid) {
            wallPieces(opaque, wall, start, end, y, y + 4.2, m.stone, info);
            // Fine cladding joints keep the large service walls visually scaled.
            for (const h of [1.4, 2.8])
              wallPieces(
                details,
                {
                  ...wall,
                  fixed:
                    wall.fixed +
                    (wall.side === "left" || wall.side === "back"
                      ? -0.145
                      : 0.145),
                },
                start + 0.02,
                end - 0.02,
                y + h,
                y + h + 0.012,
                m.trim,
                { ...info, kind: "cladding-joint" },
              );
          } else {
            wallPieces(opaque, wall, start, end, y, y + 0.78, m.stone, info);
            wallPieces(
              opaque,
              wall,
              start,
              end,
              y + 3.25,
              y + 4.2,
              m.stone,
              info,
            );
            const count = Math.max(1, Math.ceil((end - start) / 2.5));
            for (let j = 0; j < count; j++) {
              const a = start + ((end - start) * j) / count,
                b = start + ((end - start) * (j + 1)) / count;
              wallPieces(
                opaque,
                wall,
                a,
                a + 0.15,
                y + 0.78,
                y + 3.25,
                m.stone,
                info,
              );
              wallPieces(
                opaque,
                wall,
                b - 0.15,
                b,
                y + 0.78,
                y + 3.25,
                m.stone,
                info,
              );
              wallPieces(
                glazing,
                wall,
                a + 0.19,
                b - 0.19,
                y + 0.86,
                y + 3.17,
                materials.glass,
                { ...info, kind: "glass", label: `${room.id} · office window` },
              );
              for (const at of [a + 0.17, b - 0.17])
                wallPieces(
                  details,
                  wall,
                  at - 0.035,
                  at + 0.035,
                  y + 0.81,
                  y + 3.22,
                  m.charcoal,
                  { ...info, kind: "window-frame" },
                );
              for (const h of [0.81, 3.19])
                wallPieces(
                  details,
                  wall,
                  a + 0.15,
                  b - 0.15,
                  y + h,
                  y + h + 0.055,
                  m.charcoal,
                  { ...info, kind: "window-frame" },
                );
              if (wall.side === "front" || (!inner && !alongX)) {
                const out = wall.side === "left" ? -1 : 1;
                box(
                  details,
                  alongX ? (a + b) / 2 : wall.fixed + out * 0.22,
                  y + 3.23,
                  alongX ? wall.fixed + 0.22 : (a + b) / 2,
                  alongX ? b - a - 0.1 : 0.55,
                  0.065,
                  alongX ? 0.55 : b - a - 0.1,
                  m.charcoal,
                  {
                    ...info,
                    kind: "shading",
                    label: "Modest external window shade",
                  },
                );
              }
              if (wall.side === "front" && j === 0)
                for (const dx of [0.23, 0.43])
                  box(
                    details,
                    a + dx,
                    y + 2.02,
                    wall.fixed + 0.29,
                    0.065,
                    2.35,
                    0.3,
                    m.wood,
                    { ...info, kind: "wood-accent" },
                  );
            }
          }
        }
        for (const door of doors) {
          const info = {
            floor: floor.index,
            side: wall.side,
            roomId: door.roomId,
            kind: door.kind,
            label: `${door.roomId} · ${door.kind === "balcony-door" ? "balcony doorway" : "service access"}`,
          };
          doorways.push({
            ...door,
            floor: floor.index,
            axis: wall.axis,
            fixed: wall.fixed,
            side: wall.side,
            height: 2.4,
          });
          doorFrame(
            details,
            wall,
            door.at,
            y,
            door.width,
            info,
            door.kind === "balcony-door" || !door.exterior,
          );
        }
        // Continuous fascia conceals floor slab edges and the ceiling service zone.
        wallPieces(
          opaque,
          wall,
          wall.start,
          wall.end,
          y + 3.3,
          y + 4.21,
          m.stone,
          {
            floor: floor.index,
            kind: "floor-band",
            label: "Opaque slab-edge and ceiling-zone band",
          },
        );
      }
    }
  }

  function screen(parent, x1, x2, z1, z2, y, height, opening = true) {
    const info = {
      kind: "screen",
      label: "Ventilated louver screen · open top and access gap",
      airflow: "open",
    };
    for (let h = 0.14; h < height; h += 0.21) {
      for (const z of [z1, z2]) {
        if (opening && z === z2) {
          const mid = (x1 + x2) / 2;
          box(
            parent,
            (x1 + mid - 0.65) / 2,
            y + h,
            z,
            mid - 0.65 - x1,
            0.1,
            0.07,
            m.charcoal,
            info,
          );
          box(
            parent,
            (mid + 0.65 + x2) / 2,
            y + h,
            z,
            x2 - mid - 0.65,
            0.1,
            0.07,
            m.charcoal,
            info,
          );
        } else
          box(
            parent,
            (x1 + x2) / 2,
            y + h,
            z,
            x2 - x1,
            0.1,
            0.07,
            m.charcoal,
            info,
          );
      }
      for (const x of [x1, x2])
        box(
          parent,
          x,
          y + h,
          (z1 + z2) / 2,
          0.07,
          0.1,
          z2 - z1,
          m.charcoal,
          info,
        );
    }
    for (const x of [x1, x2])
      for (const z of [z1, z2])
        box(parent, x, y + height / 2, z, 0.09, height, 0.09, m.charcoal, info);
  }
  const roofZones = [];
  for (const wing of WINGS) {
    const west = wing.name === "West",
      sign = west ? -1 : 1;
    const part = group(wingRoofs, `${wing.name} roof assembly`, {
      kind: "wing-roof",
      label: `${wing.name} solid roof · slab, insulation and waterproof finish`,
    });
    const stair = ALL_ROOMS.find(
      (room) => room.id === (west ? "L2-S01" : "L2-S02"),
    );
    const stairSpec = stairLayout(stair);
    const accessX = stairSpec.roofDoorX;
    const hatch = stairSpec.opening;
    const penetrations = west ? [hatch] : [hatch, EAST_ROOF_OPENING];
    penetrations.push(
      ...WASHROOM_ROOF_PENETRATIONS.filter((p) => (west ? p.x2 < 0 : p.x1 > 0)),
    );
    plate(part, wing, ROOF_Y, 0.24, m.roof, penetrations, {
      kind: "roof-slab",
    });
    plate(part, wing, ROOF_Y + 0.18, 0.18, m.insulation, penetrations, {
      kind: "roof-insulation",
    });
    slopedSurface(
      part,
      wing,
      ROOF_Y + 0.23,
      0.08,
      m.membrane,
      {
        kind: "waterproofing",
        label: "Shallow drainage fall toward rear outlets",
      },
      penetrations,
    );
    for (const x of [wing.x1, wing.x2]) {
      box(part, x, ROOF_Y + 0.5, 0, 0.28, 1.0, 24.25, m.stone, {
        kind: "parapet",
      });
      box(part, x, ROOF_Y + 1.025, 0, 0.38, 0.07, 24.4, m.charcoal, {
        kind: "coping",
      });
    }
    for (const z of [-12, 12]) {
      box(
        part,
        (wing.x1 + wing.x2) / 2,
        ROOF_Y + 0.5,
        z,
        15,
        1,
        0.28,
        m.stone,
        { kind: "parapet" },
      );
      box(
        part,
        (wing.x1 + wing.x2) / 2,
        ROOF_Y + 1.025,
        z,
        15.3,
        0.07,
        0.38,
        m.charcoal,
        { kind: "coping" },
      );
    }
    const access = group(part, `${wing.name} stair roof access`, {
      kind: "roof-access",
      roomId: stair.id,
      label:
        "Roof maintenance access connected to full stair landing · unoccupied roof",
    });
    // A small access enclosure keeps headroom over the upper flight. It is not an occupied level.
    const frontZ = hatch.z2 + 0.08,
      rearZ = hatch.z1 - 0.08;
    const wallTop = ROOF_LANDING_Y + 2.35;
    for (const x of [hatch.x1 - 0.08, hatch.x2 + 0.08])
      box(
        access,
        x,
        (ROOF_Y + wallTop) / 2,
        (frontZ + rearZ) / 2,
        0.16,
        wallTop - ROOF_Y,
        frontZ - rearZ + 0.16,
        m.stone,
      );
    box(
      access,
      (hatch.x1 + hatch.x2) / 2,
      (ROOF_Y + wallTop) / 2,
      rearZ,
      hatch.x2 - hatch.x1,
      wallTop - ROOF_Y,
      0.16,
      m.stone,
    );
    const doorWidth = 1.15,
      doorLeft = accessX - doorWidth / 2,
      doorRight = accessX + doorWidth / 2;
    for (const [left, right] of [
      [hatch.x1, doorLeft],
      [doorRight, hatch.x2],
    ])
      box(
        access,
        (left + right) / 2,
        (ROOF_Y + wallTop) / 2,
        frontZ,
        right - left,
        wallTop - ROOF_Y,
        0.16,
        m.stone,
      );
    box(access, accessX, wallTop - 0.05, frontZ, doorWidth, 0.1, 0.16, m.stone);
    box(
      access,
      (hatch.x1 + hatch.x2) / 2,
      wallTop + 0.09,
      (frontZ + rearZ) / 2,
      hatch.x2 - hatch.x1 + 0.4,
      0.18,
      frontZ - rearZ + 0.4,
      m.charcoal,
      {
        kind: "roof-access-cover",
        label: "Stair access cover; maintained headroom above flights",
      },
    );
    for (const x of [doorLeft, doorRight])
      box(
        access,
        x,
        ROOF_LANDING_Y + 1.14,
        frontZ,
        0.055,
        2.28,
        0.2,
        m.charcoal,
      );
    box(
      access,
      doorLeft,
      ROOF_LANDING_Y + 1.11,
      frontZ + doorWidth / 2,
      0.055,
      2.22,
      doorWidth,
      m.charcoal,
      { kind: "roof-access-door" },
    );
    box(
      access,
      accessX,
      ROOF_LANDING_Y - 0.025,
      frontZ + 0.15,
      doorWidth,
      0.05,
      0.45,
      m.roof,
      { kind: "roof-access-threshold" },
    );
    roofAccess.push({
      roomId: stair.id,
      hatch,
      group: access,
      floorY: ROOF_LANDING_Y,
      door: { x: accessX, z: frontZ, width: doorWidth },
    });
    const zone = {
      wing: wing.name,
      x1: west ? -14.5 : 5.8,
      x2: west ? -5.8 : 14.5,
      z1: -10.8,
      z2: -5.4,
      floor: null,
    };
    screen(part, zone.x1, zone.x2, zone.z1, zone.z2, ROOF_Y + 0.3, 1.85);
    roofZones.push(zone);
    // A continuous one-metre maintenance approach joins the hatch to the screen opening.
    const mx = (zone.x1 + zone.x2) / 2;
    box(part, accessX, ROOF_Y + 0.32, -4.7, 1.05, 0.065, 3.0, m.roof, {
      kind: "roof-walkway",
    });
    box(
      part,
      (accessX + mx) / 2,
      ROOF_Y + 0.32,
      -3.4,
      Math.abs(accessX - mx) + 1,
      0.065,
      1.05,
      m.roof,
      { kind: "roof-walkway" },
    );
    box(part, mx, ROOF_Y + 0.32, -4.4, 1.05, 0.065, 2.6, m.roof, {
      kind: "roof-walkway",
    });
    // Outlet at the low rear edge; downpipe runs beside the stair, clear of its rear door.
    const dx = sign * 20.35;
    cylinder(part, sign * 19.45, ROOF_Y + 0.26, -11.4, 0.12, 0.08, m.charcoal, {
      kind: "roof-outlet",
    });
    beam(
      drainage,
      [sign * 19.45, ROOF_Y + 0.2, -11.4],
      [dx, ROOF_Y + 0.2, -11.4],
      0.11,
      m.charcoal,
    );
    beam(
      drainage,
      [dx, ROOF_Y + 0.2, -11.4],
      [dx, 0.1, -11.4],
      0.11,
      m.charcoal,
    );
    box(drainage, dx, 0.015, -11.4, 0.4, 0.04, 0.4, m.charcoal, {
      kind: "drain-grate",
    });
  }

  for (const b of BALCONIES) {
    const room = ALL_ROOMS.find((r) => r.id === b.roomId);
    const y = room.floor * ENVELOPE.floorHeight;
    const data = {
      kind: "balcony",
      roomId: b.roomId,
      floor: 2,
      label: `${b.roomId} · furnished second-floor balcony`,
      detail:
        "Conceptual cantilever brackets and ties; supports and connections are not structurally sized.",
    };
    const part = group(balconies, b.id, data);
    balconyGroups.push(part);
    box(part, (b.x1 + b.x2) / 2, y - 0.17, 13.25, 6, 0.26, 2.5, m.charcoal, {
      ...data,
      kind: "balcony-slab",
    });
    slopedSurface(part, b, y - 0.025, -0.025, m.paving, {
      ...data,
      kind: "balcony-finish",
    });
    for (const x of [b.x1 + 0.35, b.x2 - 0.35]) {
      beam(part, [x, y - 0.34, 10.8], [x, y - 0.34, 14.4], 0.18, m.charcoal, {
        ...data,
        kind: "balcony-support",
      });
      beam(part, [x, y - 0.8, 12.12], [x, y - 0.28, 14.1], 0.11, m.charcoal, {
        ...data,
        kind: "balcony-support",
      });
    }
    for (const [a, c] of [
      [
        [b.x1, 12.2],
        [b.x1, b.z2],
      ],
      [
        [b.x2, 12.2],
        [b.x2, b.z2],
      ],
      [
        [b.x1, b.z2],
        [b.x2, b.z2],
      ],
    ]) {
      const n = Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / 0.95);
      beam(
        part,
        [a[0], y + 1.12, a[1]],
        [c[0], y + 1.12, c[1]],
        0.06,
        m.charcoal,
        { ...data, kind: "balcony-guard" },
      );
      for (let i = 0; i <= n; i++)
        beam(
          part,
          [a[0] + ((c[0] - a[0]) * i) / n, y, a[1] + ((c[1] - a[1]) * i) / n],
          [
            a[0] + ((c[0] - a[0]) * i) / n,
            y + 1.12,
            a[1] + ((c[1] - a[1]) * i) / n,
          ],
          0.04,
          m.charcoal,
          { ...data, kind: "balcony-guard" },
        );
      const length = Math.hypot(c[0] - a[0], c[1] - a[1]);
      for (let i = 0.1; i < length; i += 0.13) {
        const t = i / length;
        beam(
          part,
          [a[0] + (c[0] - a[0]) * t, y + 0.08, a[1] + (c[1] - a[1]) * t],
          [a[0] + (c[0] - a[0]) * t, y + 1.06, a[1] + (c[1] - a[1]) * t],
          0.018,
          m.charcoal,
          { ...data, kind: "balcony-guard" },
        );
      }
    }
    // Open sliding leaf is parked alongside the actual full-height doorway.
    box(
      part,
      b.door - 1.28,
      y + 1.18,
      12.08,
      1.2,
      2.35,
      0.045,
      materials.glass,
      { ...data, kind: "balcony-door", label: "Open sliding balcony door" },
    );
    box(part, b.door, y - 0.005, 12.12, 1.25, 0.025, 0.3, m.charcoal, {
      ...data,
      kind: "threshold",
      label: "Low beveled threshold; recessed channel drain outside",
    });
    box(part, b.door, y - 0.01, 12.4, 1.4, 0.035, 0.1, m.charcoal, {
      ...data,
      kind: "balcony-drain",
    });
    const tableX = (b.x1 + b.x2) / 2 - 0.4;
    cylinder(part, tableX, y + 0.72, 13.35, 0.43, 0.06, m.wood, data);
    cylinder(part, tableX, y + 0.36, 13.35, 0.055, 0.7, m.charcoal, data);
    for (const offset of [-0.9, 0.9]) {
      const chair = group(part, "Outdoor chair", data);
      chair.position.set(tableX + offset, y, 13.35);
      chair.rotation.y = (Math.sign(offset) * Math.PI) / 2;
      box(chair, 0, 0.45, 0, 0.48, 0.09, 0.48, m.wood);
      box(chair, 0, 0.7, 0.25, 0.5, 0.5, 0.06, m.wood);
      for (const dx of [-0.18, 0.18])
        for (const dz of [-0.18, 0.18])
          beam(chair, [dx, 0, dz], [dx, 0.45, dz], 0.035, m.charcoal);
    }
    for (const x of [b.x1 + 0.5, b.x2 - 0.5])
      planter(part, x, y, 14.0, 0.7, 0.65, data);
    // Surface drain and positive external discharge route, kept off doors and paths.
    box(part, b.drain, y - 0.005, 14.3, 0.25, 0.045, 0.25, m.charcoal, {
      ...data,
      kind: "balcony-outlet",
    });
    const pipeX = b.roomId === "L2-01" ? -20.35 : 12.15;
    beam(
      drainage,
      [b.drain, y - 0.12, 14.3],
      [pipeX, y - 0.12, 14.3],
      0.07,
      m.charcoal,
      data,
    );
    beam(
      drainage,
      [pipeX, y - 0.12, 14.3],
      [pipeX, y - 0.12, 12.3],
      0.07,
      m.charcoal,
      data,
    );
    beam(
      drainage,
      [pipeX, y - 0.12, 12.3],
      [pipeX, 0.1, 12.3],
      0.07,
      m.charcoal,
      data,
    );
    box(drainage, pipeX, 0.02, 12.3, 0.3, 0.04, 0.3, m.charcoal);
  }

  function planter(parent, x, y, z, w, d, info = {}) {
    box(parent, x, y + 0.22, z, w, 0.44, d, m.stone, {
      ...info,
      kind: "planter",
    });
    box(parent, x, y + 0.45, z, w - 0.12, 0.025, d - 0.12, m.soil, info);
    for (let i = -1; i <= 1; i++)
      cylinder(
        parent,
        x + i * w * 0.24,
        y + 0.65,
        z,
        0.17,
        0.45,
        i === 0 ? m.leaf : m.leafLight,
        info,
        0.04,
      );
  }
  function auraSign(parent, x, y, z, scale = 1) {
    const sign = group(parent, "AURA building identification", {
      kind: "identification",
      label: "AURA",
    });
    sign.position.set(x, y, z);
    sign.scale.setScalar(scale);
    box(sign, 0, 0, 0, 3.4, 0.8, 0.12, m.charcoal);
    const letters = [
      [
        [
          [0, 0],
          [0.25, 0.5],
          [0.5, 0],
        ],
        [
          [0.12, 0.22],
          [0.39, 0.22],
        ],
      ],
      [
        [
          [0, 0.5],
          [0, 0.1],
          [0.1, 0],
          [0.4, 0],
          [0.5, 0.1],
          [0.5, 0.5],
        ],
      ],
      [
        [
          [0, 0],
          [0, 0.5],
          [0.4, 0.5],
          [0.5, 0.4],
          [0.5, 0.3],
          [0.4, 0.25],
          [0, 0.25],
        ],
        [
          [0.25, 0.25],
          [0.55, 0],
        ],
      ],
      [
        [
          [0, 0],
          [0.25, 0.5],
          [0.5, 0],
        ],
        [
          [0.12, 0.22],
          [0.39, 0.22],
        ],
      ],
    ];
    letters.forEach((paths, index) =>
      paths.forEach((points) => {
        for (let i = 1; i < points.length; i++)
          beam(
            sign,
            [
              points[i - 1][0] + index * 0.75 - 1.4,
              points[i - 1][1] - 0.25,
              0.08,
            ],
            [points[i][0] + index * 0.75 - 1.4, points[i][1] - 0.25, 0.08],
            0.04,
            m.white,
          );
      }),
    );
  }
  box(entrance, 0, 3.45, 12.25, 9.8, 0.18, 3.8, m.charcoal, {
    kind: "canopy",
    label: "Slim entrance canopy",
  });
  box(entrance, 0, 3.34, 12.25, 9.5, 0.035, 3.5, m.wood);
  for (const x of [-3.7, -1.8, 1.8, 3.7])
    box(entrance, x, 3.3, 12.35, 0.65, 0.025, 0.12, m.light, {
      kind: "entrance-light",
    });
  auraSign(entrance, 0, 4.0, 11.22, 0.85);
  const accessibleDoor = { axis: "X", fixed: 11, side: "front" };
  doorFrame(
    entrance,
    accessibleDoor,
    2.65,
    0,
    1.4,
    {
      kind: "entrance",
      label: "Conventional level entrance beside revolving door",
    },
    true,
  );
  const leaf = group(entrance, "Open accessible entrance leaf", {
    kind: "entrance",
    label: "1.4 m entrance opening · clear level approach",
  });
  leaf.position.set(3.35, 0, 11);
  leaf.rotation.y = -Math.PI / 2;
  box(leaf, -0.65, 1.18, 0, 1.3, 2.35, 0.055, materials.glass);
  box(leaf, -0.65, 1.18, 0.04, 0.035, 1.1, 0.035, m.charcoal);
  box(entrance, 2.65, 0, 11.15, 1.4, 0.02, 0.6, m.paving, {
    kind: "threshold",
  });
  doorways.push({
    kind: "accessible-entrance",
    floor: 0,
    axis: "X",
    fixed: 11,
    at: 2.65,
    width: 1.4,
    height: 2.4,
  });

  // Site paving stays at the ground-floor datum. No furnishing occupies the central approach
  // or the four-metre rear service strip.
  box(site, 0, -0.16, 1, 51, 0.3, 42, m.paving, {
    kind: "paving",
    label: "Level paved pedestrian approach and rear service access",
  });
  for (let x = -24.6; x < 25; x += 0.9)
    for (let z = 12.6; z < 22; z += 0.62)
      box(
        site,
        x,
        -0.002,
        z,
        0.88,
        0.025,
        0.6,
        Math.round(x * 10 + z * 10) % 3 ? m.paving : m.paverAlt,
        { kind: "paver" },
      );
  for (const x of [-12.5, 12.5]) {
    planter(site, x, 0, 20.3, 10, 2.5);
    // Benches beside the cross-path, well outside the central arrival route.
    box(site, x, 0.47, 18.65, 2.8, 0.14, 0.55, m.wood, {
      kind: "bench",
      label: "Bench beside pedestrian route",
    });
    box(site, x, 0.83, 18.9, 2.8, 0.6, 0.08, m.wood);
    for (const dx of [-1, 1])
      box(site, x + dx, 0.22, 18.65, 0.12, 0.44, 0.48, m.charcoal);
  }
  for (const [x, z] of [
    [-23, 13],
    [23, 11],
    [-18.5, 20.3],
    [18.5, 20.3],
    [-23, -4],
    [23, -3.8],
  ]) {
    if (Math.abs(x) > 22) planter(site, x, 0, z, 2.1, 3);
    cylinder(site, x, 1.7, z, 0.11, 3.4, m.trunk, { kind: "tree-trunk" }, 0.07);
    for (const [dx, dz, dy, r] of [
      [0, 0, 3.7, 1.1],
      [-0.7, 0.1, 3.3, 0.8],
      [0.65, -0.1, 3.5, 0.8],
    ]) {
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), m.leaf);
      mesh.position.set(x + dx, dy, z + dz);
      mesh.scale.y = 1.15;
      mesh.castShadow = true;
      mesh.userData = { kind: "tree", label: "Small landscape tree" };
      site.add(mesh);
    }
  }
  auraSign(site, 10.5, 1.05, 20.1, 1.0);
  for (const x of [-4.7, 4.7])
    for (const z of [15.2, 20.2]) {
      cylinder(site, x, 0.4, z, 0.075, 0.8, m.charcoal, { kind: "path-light" });
      cylinder(site, x, 0.77, z, 0.085, 0.08, m.light, { kind: "path-light" });
    }
  for (const x of [-23.8, -22.8, -21.8]) {
    for (const z of [17, 18.05])
      beam(site, [x, 0.03, z], [x, 0.9, z], 0.055, m.charcoal, {
        kind: "bicycle-rack",
      });
    beam(site, [x, 0.9, 17], [x, 0.9, 18.05], 0.055, m.charcoal, {
      kind: "bicycle-rack",
    });
  }
  const refuse = group(site, "Rear screened service and refuse area", {
    kind: "service-yard",
    label: "Rear refuse enclosure · open access from clear service strip",
  });
  screen(refuse, 14.5, 22.5, -19.2, -16.2, 0.02, 1.6);
  for (const x of [16.2, 18.1, 20.0]) {
    box(refuse, x, 0.52, -18.2, 1.05, 1.04, 0.85, m.charcoal, {
      kind: "refuse-bin",
    });
    box(refuse, x, 1.07, -18.2, 1.1, 0.08, 0.9, m.leaf);
  }
  geo.flush();
  return {
    materials: m,
    facades,
    wingRoofs,
    roofAccess,
    roofZones,
    balconies,
    balconyGroups,
    site,
    entrance,
    drainage,
    doorways,
    facadePanels,
  };
}

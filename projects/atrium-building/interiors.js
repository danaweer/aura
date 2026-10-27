/* Partitions and furniture derived from layout.js. Service areas remain empty reserves. */
import * as THREE from "three";
import { CATEGORIES, CORRIDORS, doorPosition, isReserved } from "./layout.js";

export function createOfficeInteriors(floor, floorHeight) {
  const root = new THREE.Group();
  root.position.y = floor.index * floorHeight;
  root.name = `${floor.name} offices`;
  const walls = new THREE.Group(),
    furniture = new THREE.Group(),
    reserves = new THREE.Group(),
    zones = new THREE.Group();
  walls.name = "Office partitions and doors";
  furniture.name = "Furniture and sanitary fixtures";
  reserves.name = "Service coordination reserves";
  zones.name = "Room zoning";
  root.add(zones, walls, furniture, reserves);
  const inventory = [];
  const unit = new THREE.BoxGeometry(1, 1, 1),
    batches = new Map();
  const material = (color, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });
  const m = {
    wall: material(0xe5e5e0),
    cap: material(0x6c8088),
    wood: material(0xac8055),
    woodLight: material(0xc0a07b),
    chair: material(0x527c8a),
    metal: material(0x465563, { metalness: 0.5, roughness: 0.35 }),
    screen: material(0x263d47),
    cabinet: material(0xb9b9ab),
    white: material(0xf3f4ee),
    sink: material(0x82989e),
    sofa: material(0x79979c),
    service: new THREE.MeshBasicMaterial({
      color: 0xeead5f,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
    }),
    route: new THREE.MeshBasicMaterial({
      color: 0x42a8b7,
      transparent: true,
      opacity: 0.13,
      depthWrite: false,
    }),
  };
  const meta = (room, kind, label) => ({
    floor: floor.index,
    roomId: room.id,
    kind,
    label: label || `${room.id} · ${room.name}`,
  });
  function box(parent, x, y, z, w, h, d, mat, info, rotation = 0) {
    const key = mat.uuid;
    if (!batches.has(parent)) batches.set(parent, new Map());
    const collection = batches.get(parent);
    if (!collection.has(key))
      collection.set(key, { mat, matrices: [], info: [] });
    const batch = collection.get(key);
    batch.matrices.push(
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          rotation,
        ),
        new THREE.Vector3(w, h, d),
      ),
    );
    batch.info.push(info);
  }
  function line(parent, points, color, info, closed = false) {
    const geo = new THREE.BufferGeometry().setFromPoints(
      points.map((point) => new THREE.Vector3(...point)),
    );
    const object = closed
      ? new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color }))
      : new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
    object.userData = info;
    parent.add(object);
    return object;
  }
  function chair(room, x, z, rotation = 0) {
    inventory.push({ roomId: room.id, type: "chair" });
    const info = meta(room, "furniture", "Office chair");
    box(furniture, x, 0.47, z, 0.48, 0.09, 0.48, m.chair, info, rotation);
    box(
      furniture,
      x - Math.sin(rotation) * 0.22,
      0.76,
      z - Math.cos(rotation) * 0.22,
      0.5,
      0.5,
      0.075,
      m.chair,
      info,
      rotation,
    );
    box(furniture, x, 0.25, z, 0.07, 0.4, 0.07, m.metal, info);
    box(furniture, x, 0.06, z, 0.6, 0.05, 0.06, m.metal, info, rotation);
    box(furniture, x, 0.06, z, 0.06, 0.05, 0.6, m.metal, info, rotation);
  }
  function desk(
    room,
    x,
    z,
    { width = 1.5, depth = 0.75, monitor = true, seat = true } = {},
  ) {
    inventory.push({ roomId: room.id, type: "desk" });
    const info = meta(room, "furniture", "Desk and inactive monitor");
    box(furniture, x, 0.76, z, width, 0.09, depth, m.wood, info);
    for (const dx of [-width / 2 + 0.1, width / 2 - 0.1])
      for (const dz of [-depth / 2 + 0.08, depth / 2 - 0.08])
        box(furniture, x + dx, 0.37, z + dz, 0.045, 0.74, 0.045, m.metal, info);
    if (monitor) {
      box(furniture, x, 0.84, z + 0.12, 0.22, 0.035, 0.18, m.metal, info);
      box(furniture, x, 0.96, z + 0.16, 0.035, 0.24, 0.035, m.metal, info);
      box(furniture, x, 1.1, z + 0.17, 0.57, 0.34, 0.045, m.metal, info);
      box(furniture, x, 1.1, z + 0.198, 0.5, 0.27, 0.012, m.screen, info);
      box(furniture, x, 0.82, z - 0.13, 0.36, 0.018, 0.13, m.screen, info);
    }
    if (seat) chair(room, x, z - 0.82);
  }
  function desks(room, count) {
    const b = room.bounds,
      cx = (b.x1 + b.x2) / 2,
      cz = (b.z1 + b.z2) / 2;
    const columns = count === 1 ? 1 : 2,
      rows = Math.ceil(count / columns);
    const spacing = (b.z2 - b.z1 - 2.4) / Math.max(1, rows - 1);
    for (let i = 0; i < count; i++) {
      const col = i % columns,
        row = Math.floor(i / columns);
      const x =
        columns === 1 ? cx : cx + (col - 0.5) * Math.min(4, b.x2 - b.x1 - 2.7);
      const z = rows === 1 ? cz : b.z1 + 1.55 + row * spacing;
      desk(room, x, z);
    }
    box(
      furniture,
      cx,
      0.6,
      b.z1 + 0.3,
      Math.min(2, b.x2 - b.x1 - 1.2),
      1.2,
      0.4,
      m.cabinet,
      meta(room, "furniture", "Storage cabinet"),
    );
  }
  function meeting(room, count, cx, cz, tableLength) {
    const b = room.bounds;
    cx ??= (b.x1 + b.x2) / 2;
    cz ??= (b.z1 + b.z2) / 2;
    const length = tableLength ?? (count >= 12 ? 6 : count >= 8 ? 2.9 : 2.25),
      width = count >= 12 ? 1.7 : 1.45;
    const info = meta(room, "furniture", `${count}-seat meeting table`);
    box(furniture, cx, 0.77, cz, width, 0.11, length, m.wood, info);
    for (const dz of [-length * 0.32, length * 0.32])
      box(furniture, cx, 0.36, cz + dz, 0.45, 0.72, 0.35, m.metal, info);
    const sideCount = (count - 2) / 2;
    for (let i = 0; i < sideCount; i++) {
      const z = cz + ((i + 0.5) / sideCount - 0.5) * (length - 0.2);
      chair(room, cx - width / 2 - 0.48, z, Math.PI / 2);
      chair(room, cx + width / 2 + 0.48, z, -Math.PI / 2);
    }
    chair(room, cx, cz - length / 2 - 0.48);
    chair(room, cx, cz + length / 2 + 0.48, Math.PI);
  }
  function sofa(room, x, z, width = 2.8, rotation = 0) {
    const info = meta(room, "furniture", "Lounge sofa");
    box(furniture, x, 0.3, z, width, 0.45, 0.8, m.sofa, info, rotation);
    box(
      furniture,
      x - Math.sin(rotation) * 0.34,
      0.65,
      z - Math.cos(rotation) * 0.34,
      width,
      0.5,
      0.16,
      m.sofa,
      info,
      rotation,
    );
  }
  function lounge(room) {
    const b = room.bounds,
      cx = (b.x1 + b.x2) / 2,
      cz = (b.z1 + b.z2) / 2;
    const width = Math.min(3.6, b.x2 - b.x1 - 1.1);
    sofa(room, cx, cz - 1.3, width);
    sofa(room, cx, cz + 1.3, width, Math.PI);
    box(
      furniture,
      cx,
      0.43,
      cz,
      1.45,
      0.09,
      0.7,
      m.wood,
      meta(room, "furniture", "Coffee table"),
    );
  }
  function basin(room, x, z) {
    const info = meta(room, "fixture", "Washbasin");
    box(furniture, x, 0.77, z, 0.7, 0.15, 0.55, m.white, info);
    box(furniture, x, 0.852, z, 0.43, 0.015, 0.32, m.sink, info);
    box(furniture, x, 0.95, z - 0.2, 0.035, 0.22, 0.035, m.metal, info);
  }
  function toilet(room, x, z) {
    const info = meta(room, "fixture", "WC fixture");
    box(furniture, x, 0.22, z, 0.43, 0.43, 0.6, m.white, info);
    box(furniture, x, 0.47, z, 0.48, 0.09, 0.65, m.white, info);
    box(furniture, x, 0.521, z + 0.05, 0.25, 0.015, 0.34, m.sink, info);
    box(furniture, x, 0.7, z - 0.27, 0.46, 0.45, 0.13, m.white, info);
  }
  for (const room of floor.rooms) {
    const b = room.bounds,
      cx = (b.x1 + b.x2) / 2,
      cz = (b.z1 + b.z2) / 2,
      w = b.x2 - b.x1,
      d = b.z2 - b.z1;
    const info = meta(room, "room");
    if (
      !(room.furniture === "riser" && floor.index > 0) &&
      !["stairs", "central-stair", "lift"].includes(room.furniture)
    ) {
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(w - 0.12, 0.018, d - 0.12),
        material(CATEGORIES[room.category].color),
      );
      tile.position.set(cx, 0.014, cz);
      tile.receiveShadow = true;
      tile.userData = info;
      zones.add(tile);
    }
    if (isReserved(room)) {
      box(reserves, cx, 1.85, cz, w - 0.3, 3.7, d - 0.3, m.service, {
        ...info,
        kind: "reserve",
        label: `${room.id} · reserved service volume`,
      });
      line(
        zones,
        [
          [b.x1 + 0.1, 0.045, b.z1 + 0.1],
          [b.x2 - 0.1, 0.045, b.z1 + 0.1],
          [b.x2 - 0.1, 0.045, b.z2 - 0.1],
          [b.x1 + 0.1, 0.045, b.z2 - 0.1],
        ],
        0xab854b,
        info,
        true,
      );
    }
    switch (room.furniture) {
      case "desks":
        desks(room, room.count);
        break;
      case "meeting":
        meeting(room, room.count);
        break;
      case "lounge":
        lounge(room);
        break;
      case "ceo":
        desk(room, b.x1 + 1.5, b.z1 + 1.7, { width: 1.8, depth: 0.85 });
        sofa(room, b.x1 + 2.1, b.z2 - 3.3, 3.6);
        sofa(room, b.x1 + 2.1, b.z2 - 1.0, 3.6, Math.PI);
        box(
          furniture,
          b.x1 + 2.1,
          0.44,
          b.z2 - 2.15,
          1.5,
          0.1,
          0.65,
          m.wood,
          meta(room, "furniture", "CEO lounge coffee table"),
        );
        meeting(room, 4, b.x2 - 1.85, b.z1 + 4.7, 1.5);
        break;
      case "training":
        for (let row = 0; row < 4; row++)
          for (let col = 0; col < 4; col++)
            desk(room, cx + (col - 1.5) * 1.55, b.z1 + 1.65 + row * 1.9, {
              width: 0.95,
              depth: 0.5,
              monitor: false,
            });
        box(
          furniture,
          cx,
          1.6,
          b.z2 - 0.15,
          3.8,
          1.5,
          0.06,
          m.screen,
          meta(room, "furniture", "Inactive training display"),
        );
        break;
      case "bms":
        desks(room, 2);
        for (let i = 0; i < 3; i++)
          box(
            furniture,
            cx + (i - 1) * 1.05,
            1.9,
            b.z1 + 0.12,
            0.9,
            0.58,
            0.05,
            m.screen,
            meta(room, "furniture", "Inactive BMS display model"),
          );
        break;
      case "pantry":
        box(
          furniture,
          cx,
          0.47,
          b.z1 + 0.4,
          w - 0.6,
          0.94,
          0.6,
          m.cabinet,
          meta(room, "furniture", "Pantry counter"),
        );
        box(
          furniture,
          cx,
          0.98,
          b.z1 + 0.4,
          w - 0.55,
          0.07,
          0.65,
          m.woodLight,
          meta(room, "furniture", "Pantry worktop"),
        );
        basin(room, b.x1 + 0.9, b.z1 + 0.4);
        meeting(room, 4, cx, cz + 0.55, 1.3);
        break;
      case "wc": {
        const mirrored = b.x1 > 0;
        const x = mirrored ? b.x2 - 0.8 : b.x1 + 0.8;
        toilet(room, x, b.z1 + 1.2);
        toilet(room, x, b.z1 + 3.8);
        box(
          furniture,
          x,
          0.75,
          b.z1 + 2.6,
          1.5,
          1.5,
          0.1,
          m.wall,
          meta(room, "fixture", "WC privacy partition"),
        );
        basin(room, mirrored ? b.x1 + 0.65 : b.x2 - 0.65, b.z1 + 1.2);
        basin(room, mirrored ? b.x1 + 0.65 : b.x2 - 0.65, b.z1 + 3.8);
        break;
      }
      case "accessible-wc":
        toilet(room, b.x1 + 0.8, b.z2 - 0.8);
        basin(room, b.x2 - 0.65, b.z1 + 0.6);
        box(
          furniture,
          b.x1 + 0.43,
          0.82,
          b.z2 - 0.8,
          0.035,
          0.035,
          0.7,
          m.metal,
          meta(room, "fixture", "Indicative grab rail"),
        );
        break;
      case "janitor":
        basin(room, cx, b.z1 + 0.45);
        break;
      case "archive":
        for (const z of [b.z1 + 0.4, b.z2 - 0.4])
          box(
            furniture,
            cx,
            0.85,
            z,
            w - 1,
            1.7,
            0.45,
            m.cabinet,
            meta(room, "furniture", "Archive storage cabinet"),
          );
        break;
    }
  }
  // Build each shared partition once, split at every room edge and doorway.
  const edgeMap = new Map();
  for (const room of floor.rooms) {
    if (["lift", "central-stair"].includes(room.furniture)) continue;
    const b = room.bounds;
    for (const [axis, pos, start, end, side] of [
      ["X", b.x1, b.z1, b.z2, "W"],
      ["X", b.x2, b.z1, b.z2, "E"],
      ["Z", b.z1, b.x1, b.x2, "N"],
      ["Z", b.z2, b.x1, b.x2, "S"],
    ]) {
      if (
        (axis === "X" && Math.abs(pos) === 20) ||
        (axis === "Z" && Math.abs(pos) === 12)
      )
        continue;
      const key = `${axis}:${pos}`;
      if (!edgeMap.has(key))
        edgeMap.set(key, { axis, pos, edges: [], doors: [] });
      const group = edgeMap.get(key);
      group.edges.push({ start, end, room });
      group.doors.push(
        ...room.doors
          .filter((opening) => opening.side === side)
          .map((opening) => ({
            start: opening.at - opening.width / 2,
            end: opening.at + opening.width / 2,
            room,
          })),
      );
    }
  }
  for (const group of edgeMap.values()) {
    const cuts = [
      ...new Set([
        ...group.edges.flatMap((edge) => [edge.start, edge.end]),
        ...group.doors.flatMap((opening) => [opening.start, opening.end]),
      ]),
    ].sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      const start = cuts[i - 1],
        end = cuts[i],
        mid = (start + end) / 2;
      const owner = group.edges.find(
        (edge) => mid > edge.start && mid < edge.end,
      );
      if (!owner) continue;
      const opening = group.doors.some(
        (edge) => mid > edge.start && mid < edge.end,
      );
      const h = opening ? 0.9 : 3.2,
        y = opening ? 2.75 : 1.6;
      const info = meta(
        owner.room,
        "partition",
        `${owner.room.id} · partition`,
      );
      box(
        walls,
        group.axis === "X" ? group.pos : mid,
        y,
        group.axis === "X" ? mid : group.pos,
        group.axis === "X" ? 0.14 : end - start,
        h,
        group.axis === "X" ? end - start : 0.14,
        m.wall,
        info,
      );
      box(
        walls,
        group.axis === "X" ? group.pos : mid,
        3.22,
        group.axis === "X" ? mid : group.pos,
        group.axis === "X" ? 0.16 : end - start,
        0.04,
        group.axis === "X" ? end - start : 0.16,
        m.cap,
        info,
      );
    }
  }
  // Door leaves stay open into their rooms, with actual gaps in the partitions.
  for (const room of floor.rooms)
    for (const opening of room.doors) {
      if (["lift", "central-stair"].includes(room.furniture)) continue;
      const { x, z } = doorPosition(room, opening),
        alongX = ["N", "S"].includes(opening.side),
        info = meta(
          room,
          "door",
          `${room.id} · ${opening.exterior ? "exterior service door" : "room entrance"}`,
        );
      const hingeX = alongX ? x - opening.width / 2 : x,
        hingeZ = alongX ? z : z - opening.width / 2;
      const rotation = {
        N: -Math.PI / 3,
        S: Math.PI / 3,
        E: -Math.PI / 2 - Math.PI / 3,
        W: -Math.PI / 2 + Math.PI / 3,
      }[opening.side];
      const leaf = new THREE.Group();
      leaf.position.set(hingeX, 0, hingeZ);
      leaf.rotation.y = rotation;
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(opening.width * 0.97, 2.15, 0.045),
        m.woodLight,
      );
      panel.position.set(opening.width / 2, 1.075, 0);
      panel.userData = info;
      leaf.add(panel);
      walls.add(leaf);
      for (const sign of [-1, 1])
        box(
          walls,
          x + (alongX ? sign * (opening.width / 2 + 0.035) : 0),
          1.15,
          z + (alongX ? 0 : sign * (opening.width / 2 + 0.035)),
          alongX ? 0.06 : 0.17,
          2.3,
          alongX ? 0.17 : 0.06,
          m.cap,
          info,
        );
      box(
        walls,
        x,
        2.32,
        z,
        alongX ? opening.width + 0.13 : 0.17,
        0.06,
        alongX ? 0.17 : opening.width + 0.13,
        m.cap,
        info,
      );
    }
  // Separate the dry-service and HVAC shaft compartments; no pipes or ducts yet.
  const shaft = floor.rooms.find((room) => room.id.endsWith("-R02"));
  box(
    walls,
    11.5,
    1.6,
    -4.6,
    0.14,
    3.2,
    2.8,
    m.wall,
    meta(shaft, "partition", "Separate dry-service / HVAC shaft compartments"),
  );
  for (const corridor of CORRIDORS) {
    const b = corridor;
    box(
      reserves,
      (b.x1 + b.x2) / 2,
      3.65,
      (b.z1 + b.z2) / 2,
      b.x2 - b.x1,
      0.7,
      b.z2 - b.z1,
      m.route,
      {
        floor: floor.index,
        kind: "reserve",
        label: `${corridor.name} · overhead service route reserve`,
      },
    );
  }
  if (floor.index === 0) {
    const reception = { id: "G-RECEPTION", name: "Reception", floor: 0 };
    box(
      furniture,
      0,
      0.56,
      7.6,
      2.7,
      1.12,
      0.85,
      m.wood,
      meta(reception, "furniture", "Reception desk"),
    );
    box(
      furniture,
      0,
      1.16,
      7.6,
      2.9,
      0.09,
      0.95,
      m.woodLight,
      meta(reception, "furniture", "Reception counter"),
    );
    chair(reception, 0, 6.65);
  }
  for (const [parent, collection] of batches)
    for (const batch of collection.values()) {
      const mesh = new THREE.InstancedMesh(
        unit,
        batch.mat,
        batch.matrices.length,
      );
      batch.matrices.forEach((matrix, index) =>
        mesh.setMatrixAt(index, matrix),
      );
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = !batch.mat.transparent;
      mesh.receiveShadow = !batch.mat.transparent;
      mesh.userData = {
        floor: floor.index,
        instances: batch.info,
        kind: parent === reserves ? "reserve" : "interior",
      };
      parent.add(mesh);
    }
  reserves.visible = false;
  return {
    root,
    walls,
    furniture,
    reserves,
    zones,
    rooms: floor.rooms,
    inventory,
  };
}

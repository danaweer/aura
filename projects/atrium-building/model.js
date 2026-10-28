/* Existing reference building, coordinated to the supplied 40 × 24 m office plans. */
import * as THREE from "three";
import { ENVELOPE, FLOORS, ALL_ROOMS, CORRIDORS } from "./layout.js";
import { createOfficeInteriors } from "./interiors.js";
import { createArchitecture } from "./architecture.js";
import { createBuildingServices } from "./services.js";
import { createCoreStair, stairLayout } from "./stairs.js";

export const FLOOR_COUNT = 3;
export const FLOOR_HEIGHT = ENVELOPE.floorHeight;
const LEVELS = ["Ground floor", "Level 01", "Level 02"];

export function createAtriumBuilding() {
  const root = new THREE.Group();
  root.name = "Atrium building";
  const materials = {
    frame: new THREE.MeshStandardMaterial({
      color: 0x354147,
      roughness: 0.38,
      metalness: 0.32,
    }),
    floor: new THREE.MeshStandardMaterial({
      color: 0xd7d5ca,
      roughness: 0.68,
      metalness: 0.08,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x8faeb5,
      transparent: true,
      opacity: 0.58,
      roughness: 0.09,
      metalness: 0.2,
      envMapIntensity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    rail: new THREE.MeshStandardMaterial({
      color: 0x6f8999,
      roughness: 0.32,
      metalness: 0.65,
    }),
    core: new THREE.MeshStandardMaterial({
      color: 0xb6c8d2,
      roughness: 0.45,
      metalness: 0.4,
    }),
    dark: new THREE.MeshStandardMaterial({
      color: 0x405b6b,
      roughness: 0.5,
      metalness: 0.3,
    }),
  };
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const batches = new Map();
  const floors = [];
  const interiors = [];
  const stairCores = [];
  const roof = new THREE.Group();
  roof.name = "Wing roofs and atrium skylight";
  root.add(roof);
  const skylight = new THREE.Group();
  skylight.name = "Atrium skylight";
  skylight.userData = {
    layer: "skylight",
    kind: "glass",
    label: "Central atrium glazed skylight",
  };
  roof.add(skylight);
  const vec = (x, y, z) => new THREE.Vector3(x, y, z);
  const names = {
    structure: "Retained structural grid / charcoal atrium frame",
    glass: "Reflective blue-grey glazing",
    slabs: "Open floor plate",
    circulation: "Stairs and gallery railing",
    lift: "Glazed lift core",
    entrance: "Revolving entrance",
  };
  function box(
    parent,
    x,
    y,
    z,
    w,
    h,
    d,
    material,
    kind = "structure",
    side = "interior",
    quaternion = null,
  ) {
    const key = `${material.uuid}:${kind}:${side}`;
    if (!batches.has(parent)) batches.set(parent, new Map());
    const batch = batches.get(parent);
    if (!batch.has(key)) batch.set(key, { material, kind, side, matrices: [] });
    const matrix = new THREE.Matrix4().compose(
      vec(x, y, z),
      quaternion || new THREE.Quaternion(),
      vec(w, h, d),
    );
    batch.get(key).matrices.push(matrix);
  }
  function beam(
    parent,
    a,
    b,
    size,
    material = materials.frame,
    kind = "structure",
    side = "interior",
  ) {
    const start = vec(...a),
      end = vec(...b),
      delta = end.clone().sub(start);
    const center = start.clone().add(end).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(
      vec(0, 1, 0),
      delta.clone().normalize(),
    );
    box(
      parent,
      center.x,
      center.y,
      center.z,
      size,
      delta.length(),
      size,
      material,
      kind,
      side,
      q,
    );
  }
  function surface(parent, points, material, kind = "glass") {
    const data = new Float32Array(points.flat());
    const meshGeometry = new THREE.BufferGeometry();
    meshGeometry.setAttribute("position", new THREE.BufferAttribute(data, 3));
    meshGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    meshGeometry.computeVertexNormals();
    const mesh = new THREE.Mesh(meshGeometry, material);
    mesh.userData = {
      kind,
      label: "Glazed roof panel",
      floor: null,
      side: "roof",
    };
    parent.add(mesh);
  }
  function facade(parent, x1, x2, z1, z2, y, openings = {}, omit = []) {
    const walls = [
      { axis: "X", a: x1, b: x2, fixed: z2, side: "front" },
      { axis: "X", a: x1, b: x2, fixed: z1, side: "back" },
      { axis: "Z", a: z1, b: z2, fixed: x1, side: "left" },
      { axis: "Z", a: z1, b: z2, fixed: x2, side: "right" },
    ];
    for (const wall of walls) {
      if (omit.includes(wall.side)) continue;
      const holes = openings[wall.side] || [],
        length = wall.b - wall.a,
        count = Math.round(length / 2.7),
        alongX = wall.axis === "X";
      const split = (start, end) =>
        [
          ...new Set([
            start,
            end,
            ...holes.flatMap((h) => [
              Math.max(start, Math.min(end, h.start)),
              Math.max(start, Math.min(end, h.end)),
            ]),
          ]),
        ].sort((a, b) => a - b);
      const add = (at, height, w, h, mat, kind) =>
        box(
          parent,
          alongX ? at : wall.fixed,
          y + height,
          alongX ? wall.fixed : at,
          alongX ? w : 0.13,
          h,
          alongX ? 0.13 : w,
          mat,
          kind,
          wall.side,
        );
      for (let col = 0; col <= count; col++) {
        const at = wall.a + (length * col) / count,
          opening = holes.find((h) => at > h.start && at < h.end),
          bottom = opening?.height || 0;
        add(
          at,
          (FLOOR_HEIGHT + bottom) / 2,
          0.13,
          FLOOR_HEIGHT - bottom,
          materials.frame,
          "structure",
        );
      }
      for (let row = 0; row <= 2; row++) {
        const height = (row * FLOOR_HEIGHT) / 2,
          cuts = split(wall.a, wall.b);
        for (let j = 1; j < cuts.length; j++) {
          const mid = (cuts[j] + cuts[j - 1]) / 2;
          if (
            height > 0 &&
            holes.some((h) => mid > h.start && mid < h.end && height < h.height)
          )
            continue;
          add(
            mid,
            height === 0 ? -0.035 : height,
            cuts[j] - cuts[j - 1],
            row === 0 ? 0.15 : 0.12,
            materials.frame,
            "structure",
          );
        }
      }
      for (let col = 0; col < count; col++)
        for (let row = 0; row < 2; row++) {
          const start = wall.a + (length * col) / count + 0.065,
            end = wall.a + (length * (col + 1)) / count - 0.065,
            cuts = split(start, end);
          for (let j = 1; j < cuts.length; j++) {
            const mid = (cuts[j] + cuts[j - 1]) / 2,
              opening = holes.find((h) => mid > h.start && mid < h.end);
            const bottom = Math.max(
                (row * FLOOR_HEIGHT) / 2 + 0.065,
                opening?.height || 0,
              ),
              top = ((row + 1) * FLOOR_HEIGHT) / 2 - 0.065;
            if (top > bottom && cuts[j] - cuts[j - 1] > 0.01)
              add(
                mid,
                (top + bottom) / 2,
                cuts[j] - cuts[j - 1],
                top - bottom,
                materials.glass,
                "glass",
              );
          }
        }
    }
  }
  function slabWithHoles(parent, bounds, y, holes = []) {
    const { x1, x2, z1, z2 } = bounds;
    const shape = new THREE.Shape();
    shape.moveTo(x1, z1);
    shape.lineTo(x2, z1);
    shape.lineTo(x2, z2);
    shape.lineTo(x1, z2);
    shape.closePath();
    for (const h of holes) {
      const path = new THREE.Path();
      path.moveTo(h.x1, h.z1);
      path.lineTo(h.x1, h.z2);
      path.lineTo(h.x2, h.z2);
      path.lineTo(h.x2, h.z1);
      path.closePath();
      shape.holes.push(path);
    }
    const slab = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: 0.24, bevelEnabled: false }),
      materials.floor,
    );
    slab.rotation.x = Math.PI / 2;
    slab.position.y = y;
    slab.receiveShadow = true;
    slab.castShadow = true;
    slab.userData = {
      kind: "slabs",
      label: "Floor plate with coordinated vertical openings",
      floor: parent.userData.floor,
    };
    parent.add(slab);
  }
  function railing(parent, a, b, y) {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const count = Math.ceil(length / 1.35);
    for (let i = 0; i <= count; i++) {
      const t = i / count,
        x = a[0] + (b[0] - a[0]) * t,
        z = a[1] + (b[1] - a[1]) * t;
      beam(
        parent,
        [x, y, z],
        [x, y + 1.05, z],
        0.045,
        materials.rail,
        "circulation",
      );
    }
    for (const h of [0.15, 0.57, 1.05])
      beam(
        parent,
        [a[0], y + h, a[1]],
        [b[0], y + h, b[1]],
        0.04,
        materials.rail,
        "circulation",
      );
  }
  function stairs(parent, y, centerX = 0, startZ = -11.5, narrow = false) {
    // Two flights and a landing connect successive gallery levels.
    const x = centerX,
      z = startZ,
      half = FLOOR_HEIGHT / 2,
      steps = 10,
      run = narrow ? 2.4 : 3.6;
    const width = narrow ? 0.7 : 1.15,
      offset = narrow ? 0.39 : 0.6;
    for (let i = 0; i < steps; i++) {
      box(
        parent,
        x - offset,
        y + ((i + 1) * half) / steps,
        z + (i * run) / steps,
        width,
        0.11,
        run / steps + 0.02,
        materials.floor,
        "circulation",
      );
      box(
        parent,
        x + offset,
        y + half + ((i + 1) * half) / steps,
        z + ((steps - i - 1) * run) / steps,
        width,
        0.11,
        run / steps + 0.02,
        materials.floor,
        "circulation",
      );
    }
    box(
      parent,
      x,
      y + half,
      z + run + 0.5,
      narrow ? 1.8 : 2.5,
      0.17,
      1.3,
      materials.floor,
      "circulation",
    );
    for (const flight of [0, 1]) {
      const sides = flight === 0 ? [-offset * 2, 0] : [0, offset * 2];
      for (const dx of sides) {
        const startY = y + (flight === 0 ? 0 : FLOOR_HEIGHT);
        beam(
          parent,
          [x + dx, startY + 1, z],
          [x + dx, y + half + 1, z + run],
          0.045,
          materials.rail,
          "circulation",
        );
        for (let step = 0; step <= steps; step++) {
          const t = step / steps,
            height = startY + (y + half - startY) * t;
          beam(
            parent,
            [x + dx, height, z + run * t],
            [x + dx, height + 1, z + run * t],
            0.035,
            materials.rail,
            "circulation",
          );
        }
      }
    }
  }

  function lift(parent, y, index) {
    const x = -0.75,
      z = -9.25,
      w = 2.1,
      d = 2.5;
    for (const dx of [-w / 2, w / 2])
      for (const dz of [-d / 2, d / 2])
        box(
          parent,
          x + dx,
          y + FLOOR_HEIGHT / 2,
          z + dz,
          0.12,
          FLOOR_HEIGHT,
          0.12,
          materials.core,
          "lift",
        );
    for (const h of [0, 2.1, FLOOR_HEIGHT]) {
      for (const dz of [-d / 2, d / 2])
        box(parent, x, y + h, z + dz, w, 0.09, 0.09, materials.core, "lift");
      for (const dx of [-w / 2, w / 2])
        box(parent, x + dx, y + h, z, 0.09, 0.09, d, materials.core, "lift");
    }
    beam(
      parent,
      [x - w / 2, y, z - d / 2],
      [x + w / 2, y + FLOOR_HEIGHT, z - d / 2],
      0.065,
      materials.core,
      "lift",
    );
    box(
      parent,
      x,
      y + FLOOR_HEIGHT / 2,
      z + d / 2,
      w - 0.15,
      FLOOR_HEIGHT - 0.15,
      0.025,
      materials.glass,
      "glass",
    );
    if (index === 0) {
      box(parent, x, y + 1.2, z, 1.75, 2.25, 2.1, materials.dark, "lift");
      box(
        parent,
        x,
        y + 1.2,
        z + 1.06,
        1.55,
        2.05,
        0.03,
        materials.glass,
        "glass",
      );
    }
  }
  function entrance(parent, x, z) {
    const cylinder = new THREE.CylinderGeometry(1.12, 1.12, 2.7, 28, 1, true);
    const glass = new THREE.Mesh(cylinder, materials.glass);
    glass.position.set(x, 1.35, z);
    glass.userData = {
      kind: "entrance",
      label: "Glazed revolving entrance",
      floor: 0,
    };
    parent.add(glass);
    const canopy = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.4, 0.15, 32),
      materials.frame,
    );
    canopy.position.set(x, 2.8, z);
    canopy.castShadow = true;
    canopy.userData = { kind: "entrance", label: "Entrance canopy", floor: 0 };
    parent.add(canopy);
    for (let i = 0; i < 3; i++) {
      const q = new THREE.Quaternion().setFromAxisAngle(
        vec(0, 1, 0),
        (i * Math.PI) / 3,
      );
      box(
        parent,
        x,
        1.35,
        z,
        2.1,
        2.6,
        0.025,
        materials.glass,
        "entrance",
        "front",
        q,
      );
    }
  }
  for (let index = 0; index < FLOOR_COUNT; index++) {
    const floor = new THREE.Group();
    floor.name = LEVELS[index];
    floor.userData = { floor: index };
    root.add(floor);
    floors.push(floor);
    const y = index * FLOOR_HEIGHT,
      layout = FLOORS[index];
    const westHoles =
      index === 0
        ? []
        : [
            stairLayout(layout.rooms.find((room) => room.id.endsWith("-S01")))
              .opening,
            { x1: -11.9, x2: -10.1, z1: -5.9, z2: -3.7 },
          ];
    const eastHoles =
      index === 0
        ? []
        : [
            stairLayout(layout.rooms.find((room) => room.id.endsWith("-S02")))
              .opening,
            { x1: 9.6, x2: 13.9, z1: -5.9, z2: -3.3 },
          ];
    slabWithHoles(floor, { x1: -20, x2: -5, z1: -12, z2: 12 }, y, westHoles);
    slabWithHoles(floor, { x1: 5, x2: 20, z1: -12, z2: 12 }, y, eastHoles);
    if (index === 0)
      slabWithHoles(floor, { x1: -5, x2: 5, z1: -11, z2: 11 }, y);
    else {
      slabWithHoles(floor, { x1: -5, x2: 5, z1: -11, z2: -6 }, y, [
        { x1: -2, x2: 0.5, z1: -10.5, z2: -8 },
        { x1: 1.15, x2: 2.85, z1: -10.8, z2: -7.3 },
      ]);
      for (const [x, z, w, d] of [
        [0, 8.5, 10, 5],
        [-4, 0, 2, 12],
        [4, 0, 2, 12],
      ])
        box(floor, x, y - 0.12, z, w, 0.24, d, materials.floor, "slabs");
      for (const [a, b] of [
        [
          [-3, -6],
          [-3, 6],
        ],
        [
          [3, -6],
          [3, 6],
        ],
        [
          [-3, 6],
          [3, 6],
        ],
        [
          [-3, -6],
          [3, -6],
        ],
      ])
        railing(floor, a, b, y);
    }
    facade(
      floor,
      -5,
      5,
      -11,
      11,
      y,
      index === 0
        ? {
            front: [
              { start: -1.5, end: 1.5, height: 2.85 },
              { start: 1.95, end: 3.35, height: 2.48 },
            ],
          }
        : {},
      ["left", "right"],
    );
    // Columns align with partition/corridor intersections rather than desk positions.
    for (const x of [-20, -16, -14, -5, 5, 14, 16, 20])
      for (const z of [-12, -6, -0.4, 2, 12]) {
        box(
          floor,
          x,
          y + FLOOR_HEIGHT / 2,
          z,
          0.23,
          FLOOR_HEIGHT,
          0.23,
          materials.frame,
          "structure",
        );
      }
    lift(floor, y, index);
    for (const room of layout.rooms.filter(
      (item) => item.furniture === "stairs",
    ))
      stairCores.push(createCoreStair(floor, room, index, materials));
    if (index < 2) stairs(floor, y, 2, -10.5, true);
    if (index === 0) entrance(floor, 0, 11.15);
    const interior = createOfficeInteriors(layout, FLOOR_HEIGHT);
    floor.add(interior.root);
    interiors.push(interior);
  }
  // Accessible rear service-yard allowance only: no tank, condenser or generator is installed.
  const yard = new THREE.Group();
  yard.name = "Rear service-yard reservation";
  root.add(yard);
  box(yard, -9.5, 0.02, -18.5, 9, 0.04, 3, materials.floor, "reserve");
  // Retain glazing above the central atrium only; office roofs are separate solid assemblies.
  for (const [x1, x2, z1, z2, leftHeight, rightHeight] of [
    [-5, 0, -11, 11, 12.65, 14.7],
    [0, 5, -11, 11, 14.7, 12.65],
  ]) {
    const divisions = Math.ceil((x2 - x1) / 2.5);
    for (let i = 0; i < divisions; i++) {
      const t1 = i / divisions,
        t2 = (i + 1) / divisions;
      const a = x1 + (x2 - x1) * t1,
        b = x1 + (x2 - x1) * t2;
      const ya = leftHeight + (rightHeight - leftHeight) * t1,
        yb = leftHeight + (rightHeight - leftHeight) * t2;
      surface(
        skylight,
        [
          [a, ya, z1],
          [b, yb, z1],
          [b, yb, z2],
          [a, ya, z2],
        ],
        materials.glass,
      );
      beam(skylight, [a, ya, z1], [a, ya, z2], 0.13);
      beam(skylight, [a, 12.6, z1], [a, ya, z1], 0.13);
      beam(skylight, [a, 12.6, z2], [a, ya, z2], 0.13);
      for (const z of [z1, z2]) {
        surface(
          skylight,
          [
            [a, 12.6, z],
            [b, 12.6, z],
            [b, yb, z],
            [a, ya, z],
          ],
          materials.glass,
        );
      }
      for (const z of [z1, z2]) beam(skylight, [a, ya, z], [b, yb, z], 0.13);
    }
    for (const [x, height] of [
      [x1, leftHeight],
      [x2, rightHeight],
    ]) {
      surface(
        skylight,
        [
          [x, 12.6, z1],
          [x, 12.6, z2],
          [x, height, z2],
          [x, height, z1],
        ],
        materials.glass,
      );
    }
    beam(skylight, [x2, rightHeight, z1], [x2, rightHeight, z2], 0.13);
    for (let z = z1; z <= z2; z += 2.5)
      beam(skylight, [x1, leftHeight, z], [x2, rightHeight, z], 0.12);
  }
  const architecture = createArchitecture({ root, floors, roof, materials });
  const services = createBuildingServices({ root, floors, roof });
  for (const [parent, batch] of batches)
    for (const item of batch.values()) {
      const mesh = new THREE.InstancedMesh(
        geometry,
        item.material,
        item.matrices.length,
      );
      item.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = item.material !== materials.glass;
      mesh.receiveShadow = item.material !== materials.glass;
      mesh.userData = {
        kind: item.kind,
        label: names[item.kind] || item.kind,
        side: item.side,
        floor: parent.userData.floor ?? null,
      };
      mesh.name = mesh.userData.label;
      parent.add(mesh);
    }
  return {
    root,
    floors,
    roof,
    materials,
    architecture,
    services,
    skylight,
    interiors,
    stairCores,
    rooms: ALL_ROOMS,
    corridors: CORRIDORS,
    yard,
    bounds: new THREE.Box3().setFromObject(root),
  };
}

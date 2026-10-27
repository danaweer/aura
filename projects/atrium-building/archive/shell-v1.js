/* Three-floor architectural reconstruction from the user's eight screenshots.
   Dimensions are provisional; no offices, equipment, or IoT are installed. */
import * as THREE from "three";

export const FLOOR_COUNT = 3;
export const FLOOR_HEIGHT = 4.2;
const LEVELS = ["Ground floor", "Level 01", "Level 02"];

export function createAtriumBuilding() {
  const root = new THREE.Group();
  root.name = "Atrium building";
  const materials = {
    frame: new THREE.MeshStandardMaterial({
      color: 0xdce7ec,
      roughness: 0.38,
      metalness: 0.32,
    }),
    floor: new THREE.MeshStandardMaterial({
      color: 0xd3dfe5,
      roughness: 0.68,
      metalness: 0.08,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x579dab,
      transparent: true,
      opacity: 0.38,
      roughness: 0.12,
      metalness: 0.12,
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
  const roof = new THREE.Group();
  roof.name = "Glazed pitched roof";
  root.add(roof);
  const vec = (x, y, z) => new THREE.Vector3(x, y, z);
  const names = {
    structure: "White structural frame",
    glass: "Blue-green curtain wall",
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
  function facade(parent, x1, x2, z1, z2, y) {
    const walls = [
      { a: [x1, z2], b: [x2, z2], side: "front" },
      { a: [x2, z1], b: [x1, z1], side: "back" },
      { a: [x1, z1], b: [x1, z2], side: "left" },
      { a: [x2, z2], b: [x2, z1], side: "right" },
    ];
    for (const { a, b, side } of walls) {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const count = Math.max(1, Math.round(length / 2.7));
      const alongX = a[1] === b[1];
      for (let i = 0; i <= count; i++) {
        const t = i / count,
          x = a[0] + (b[0] - a[0]) * t,
          z = a[1] + (b[1] - a[1]) * t;
        box(
          parent,
          x,
          y + FLOOR_HEIGHT / 2,
          z,
          0.13,
          FLOOR_HEIGHT,
          0.13,
          materials.frame,
          "structure",
          side,
        );
      }
      for (let row = 0; row <= 2; row++) {
        box(
          parent,
          (a[0] + b[0]) / 2,
          y + (row * FLOOR_HEIGHT) / 2,
          (a[1] + b[1]) / 2,
          alongX ? length : 0.14,
          row === 0 ? 0.24 : 0.12,
          alongX ? 0.14 : length,
          materials.frame,
          "structure",
          side,
        );
      }
      for (let col = 0; col < count; col++)
        for (let row = 0; row < 2; row++) {
          const t = (col + 0.5) / count,
            x = a[0] + (b[0] - a[0]) * t,
            z = a[1] + (b[1] - a[1]) * t;
          box(
            parent,
            x,
            y + ((row + 0.5) * FLOOR_HEIGHT) / 2,
            z,
            alongX ? length / count - 0.13 : 0.035,
            FLOOR_HEIGHT / 2 - 0.13,
            alongX ? 0.035 : length / count - 0.13,
            materials.glass,
            "glass",
            side,
          );
        }
    }
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
  function stairs(parent, y) {
    // Two flights and a landing connect successive gallery levels.
    const x = 3.85,
      z = -3.5,
      half = FLOOR_HEIGHT / 2,
      steps = 10,
      run = 3.6;
    for (let i = 0; i < steps; i++) {
      box(
        parent,
        x - 0.6,
        y + ((i + 1) * half) / steps,
        z + (i * run) / steps,
        1.15,
        0.11,
        run / steps + 0.02,
        materials.floor,
        "circulation",
      );
      box(
        parent,
        x + 0.6,
        y + half + ((i + 1) * half) / steps,
        z + ((steps - i - 1) * run) / steps,
        1.15,
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
      2.5,
      0.17,
      1.3,
      materials.floor,
      "circulation",
    );
    for (const flight of [0, 1]) {
      const sides = flight === 0 ? [-1.2, 0] : [0, 1.2];
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
    const x = -0.6,
      z = -3.4,
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
    const y = index * FLOOR_HEIGHT;
    const frontRight = 11 - index * 2.4;
    // Open wings. Partition walls, furniture and services will be later phases.
    box(floor, -12.5, y - 0.12, 1, 15, 0.24, 20, materials.floor, "slabs");
    box(
      floor,
      11.5,
      y - 0.12,
      (-9 + frontRight) / 2,
      13,
      0.24,
      frontRight + 9,
      materials.floor,
      "slabs",
    );
    if (index === 0)
      box(floor, 0, y - 0.12, 0, 10, 0.24, 16, materials.floor, "slabs");
    else {
      for (const [x, z, w, d] of [
        [0, 6.5, 10, 3],
        [0, -6.5, 10, 3],
        [-4, 0, 2, 10],
        [4, 0, 2, 10],
      ])
        box(floor, x, y - 0.12, z, w, 0.24, d, materials.floor, "slabs");
      for (const [a, b] of [
        [
          [-3, -5],
          [-3, 5],
        ],
        [
          [3, -5],
          [3, 5],
        ],
        [
          [-3, 5],
          [3, 5],
        ],
        [
          [-3, -5],
          [3, -5],
        ],
      ])
        railing(floor, a, b, y);
    }
    facade(floor, -20, -5, -9, 11, y);
    facade(floor, 5, 18, -9, frontRight, y);
    // Recessed glazed atrium, visible between the two stepped wings.
    facade(floor, -5, 5, -8, 8, y);
    for (const x of [-18, -12, -6, 6, 12, 17])
      for (const z of [-7, 1, 8]) {
        if (x > 5 && z > frontRight) continue;
        box(
          floor,
          x,
          y + FLOOR_HEIGHT / 2,
          z,
          0.28,
          FLOOR_HEIGHT,
          0.28,
          materials.frame,
          "structure",
        );
      }
    lift(floor, y, index);
    if (index < 2) stairs(floor, y);
    if (index === 0) {
      entrance(floor, -15, 11.3);
      entrance(floor, -9, 11.3);
      entrance(floor, 0, 8.1);
    }
  }
  // Reference-inspired projecting glass bay on the first upper level.
  facade(floors[1], -16, -10, 11, 12.8, FLOOR_HEIGHT);
  box(
    floors[1],
    -13,
    FLOOR_HEIGHT - 0.1,
    11.9,
    6,
    0.2,
    1.8,
    materials.floor,
    "slabs",
    "front",
  );
  // Sloping glazed crowns echo the angular silhouette in the references.
  for (const [x1, x2, z1, z2, leftHeight, rightHeight] of [
    [-20, -5, -9, 11, 12.65, 15.1],
    [5, 18, -9, 6.2, 14.2, 12.65],
    [-5, 0, -8, 8, 12.65, 14.7],
    [0, 5, -8, 8, 14.7, 12.65],
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
        roof,
        [
          [a, ya, z1],
          [b, yb, z1],
          [b, yb, z2],
          [a, ya, z2],
        ],
        materials.glass,
      );
      beam(roof, [a, ya, z1], [a, ya, z2], 0.13);
      beam(roof, [a, 12.6, z1], [a, ya, z1], 0.13);
      beam(roof, [a, 12.6, z2], [a, ya, z2], 0.13);
      for (const z of [z1, z2]) {
        surface(
          roof,
          [
            [a, 12.6, z],
            [b, 12.6, z],
            [b, yb, z],
            [a, ya, z],
          ],
          materials.glass,
        );
      }
      for (const z of [z1, z2]) beam(roof, [a, ya, z], [b, yb, z], 0.13);
    }
    for (const [x, height] of [
      [x1, leftHeight],
      [x2, rightHeight],
    ]) {
      surface(
        roof,
        [
          [x, 12.6, z1],
          [x, 12.6, z2],
          [x, height, z2],
          [x, height, z1],
        ],
        materials.glass,
      );
    }
    beam(roof, [x2, rightHeight, z1], [x2, rightHeight, z2], 0.13);
    for (let z = z1; z <= z2; z += 2.5)
      beam(roof, [x1, leftHeight, z], [x2, rightHeight, z], 0.12);
  }
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
    bounds: new THREE.Box3().setFromObject(root),
  };
}

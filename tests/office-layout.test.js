import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  FLOORS,
  ALL_ROOMS,
  CORRIDORS,
  ENVELOPE,
  ATRIUM_VOID,
} from "../projects/atrium-building/layout.js";
import {
  createAtriumBuilding,
  FLOOR_HEIGHT,
} from "../projects/atrium-building/model.js";

function dispose(model) {
  const geometries = new Set(),
    materials = new Set();
  model.root.traverse((item) => {
    if (item.geometry) geometries.add(item.geometry);
    if (item.material) materials.add(item.material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}
const near = (a, b) => Math.abs(a - b) < 0.001;
test("all three plan layouts tile the two 15 × 24 m wings without room overlaps", () => {
  assert.equal(ENVELOPE.width, 40);
  assert.equal(ENVELOPE.depth, 24);
  assert.equal(new Set(ALL_ROOMS.map((room) => room.id)).size, 70);
  for (const floor of FLOORS) {
    const wingRooms = floor.rooms.filter(
      (room) => !["lift", "central-stair"].includes(room.furniture),
    );
    const area =
      wingRooms.reduce((sum, room) => sum + room.area, 0) +
      CORRIDORS.reduce((sum, b) => sum + (b.x2 - b.x1) * (b.z2 - b.z1), 0);
    assert.ok(near(area, 720), `${floor.name}: ${area}`);
    for (let i = 0; i < wingRooms.length; i++)
      for (let j = i + 1; j < wingRooms.length; j++) {
        const a = wingRooms[i].bounds,
          b = wingRooms[j].bounds;
        assert.ok(
          Math.min(a.x2, b.x2) <= Math.max(a.x1, b.x1) + 0.001 ||
            Math.min(a.z2, b.z2) <= Math.max(a.z1, b.z1) + 0.001,
          `${wingRooms[i].id} overlaps ${wingRooms[j].id}`,
        );
      }
    for (const room of wingRooms)
      assert.ok(
        room.bounds.x2 <= -5 || room.bounds.x1 >= 5,
        "Atrium stays free of wing rooms",
      );
  }
  assert.ok(
    CORRIDORS.filter((item) => item.name.includes("main")).every((item) =>
      near(item.z2 - item.z1, 2.4),
    ),
  );
});

test("service reserves stay vertically aligned, empty, and accessible from the intended side", () => {
  for (const code of [
    "R01",
    "R02",
    "W01",
    "W02",
    "W04",
    "P01",
    "I02",
    "S01",
    "S02",
  ]) {
    const rooms = FLOORS.map((floor) =>
      floor.rooms.find((room) => room.id === `${floor.prefix}-${code}`),
    );
    assert.deepEqual(rooms[0].bounds, rooms[1].bounds);
    assert.deepEqual(rooms[1].bounds, rooms[2].bounds);
  }
  for (const code of ["G-M01", "G-M02", "G-E01"]) {
    const room = ALL_ROOMS.find((item) => item.id === code);
    assert.equal(room.area, 27);
    assert.equal(room.furniture, "reserve");
    assert.ok(room.doors.some((door) => door.exterior && door.side === "N"));
  }
  for (const code of ["L1-M01", "L2-M01"])
    assert.equal(ALL_ROOMS.find((room) => room.id === code).area, 27);
});

test("actual modeled seating and desks match the supplied meeting, training, and team capacities", () => {
  const model = createAtriumBuilding();
  try {
    const inventory = model.interiors.flatMap((floor) => floor.inventory);
    for (const [id, count] of [
      ["G-03", 8],
      ["G-04", 6],
      ["G-05", 16],
      ["L1-05", 8],
      ["L1-07", 6],
      ["L2-04", 12],
      ["L2-05", 6],
      ["L2-07", 6],
    ])
      assert.equal(
        inventory.filter((item) => item.roomId === id && item.type === "chair")
          .length,
        count,
        id,
      );
    for (const id of ["L1-01", "L1-04"])
      assert.equal(
        inventory.filter((item) => item.roomId === id && item.type === "desk")
          .length,
        8,
        id,
      );
    for (const room of ALL_ROOMS.filter((room) =>
      ["reserve", "server-reserve", "riser", "idf"].includes(room.furniture),
    ))
      assert.equal(
        inventory.filter((item) => item.roomId === room.id).length,
        0,
        room.id,
      );
  } finally {
    dispose(model);
  }
});

test("upper-floor slabs preserve the atrium, stairs, wet and dry shaft openings", () => {
  const model = createAtriumBuilding();
  model.root.updateMatrixWorld(true);
  try {
    const points = [
      [-18, -9],
      [18, -9],
      [-11, -4.8],
      [11.5, -4.6],
      [-0.75, -9.2],
      [0, 0],
      [2, -9],
    ];
    for (const index of [1, 2]) {
      const slabs = model.floors[index].children.filter(
        (mesh) => mesh.userData.kind === "slabs",
      );
      for (const [x, z] of points) {
        const ray = new THREE.Raycaster(
          new THREE.Vector3(x, index * FLOOR_HEIGHT + 0.5, z),
          new THREE.Vector3(0, -1, 0),
          0,
          0.8,
        );
        assert.equal(
          ray.intersectObjects(slabs, false).length,
          0,
          `Floor ${index} opening at ${x},${z}`,
        );
      }
      const ray = new THREE.Raycaster(
        new THREE.Vector3(-17, index * FLOOR_HEIGHT + 0.5, 5),
        new THREE.Vector3(0, -1, 0),
        0,
        0.8,
      );
      assert.ok(
        ray.intersectObjects(slabs, false).length > 0,
        "Office floor remains solid",
      );
    }
    assert.deepEqual(ATRIUM_VOID, { x1: -3, x2: 3, z1: -6, z2: 6 });
  } finally {
    dispose(model);
  }
});

test("partitions leave the specified office doorway open below its lintel", () => {
  const model = createAtriumBuilding();
  model.root.updateMatrixWorld(true);
  try {
    const walls = model.interiors[1].walls.children.filter(
      (mesh) => mesh.isInstancedMesh,
    );
    const ray = new THREE.Raycaster(
      new THREE.Vector3(-11.2, FLOOR_HEIGHT + 1.2, 10.4),
      new THREE.Vector3(1, 0, 0),
      0,
      0.4,
    );
    assert.equal(
      ray.intersectObjects(walls, false).length,
      0,
      "Project-office entrance is not blocked by a partition",
    );
  } finally {
    dispose(model);
  }
});

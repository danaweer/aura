import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createAtriumBuilding,
  FLOOR_COUNT,
  FLOOR_HEIGHT,
} from "../projects/atrium-building/model.js";
import { buildMeetingRoom } from "../projects/meeting-room/model.js";
const building = JSON.parse(
  readFileSync(
    new URL("../projects/atrium-building/project.json", import.meta.url),
  ),
);
const room = JSON.parse(
  readFileSync(
    new URL("../projects/meeting-room/project.json", import.meta.url),
  ),
);
function dispose(model) {
  const geometries = new Set(),
    materials = new Set();
  model.root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) materials.add(object.material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

test("building has exactly three occupiable floor groups and a separate roof", () => {
  const model = createAtriumBuilding();
  try {
    assert.equal(FLOOR_COUNT, 3);
    assert.equal(FLOOR_HEIGHT, 4.2);
    assert.deepEqual(
      model.floors.map((floor) => floor.name),
      ["Ground floor", "Level 01", "Level 02"],
    );
    assert.deepEqual(
      model.floors.map((floor) => floor.userData.floor),
      [0, 1, 2],
    );
    assert.ok(!model.floors.includes(model.roof));
    for (const floor of model.floors) {
      const kinds = new Set(floor.children.map((child) => child.userData.kind));
      for (const required of [
        "slabs",
        "structure",
        "glass",
        "circulation",
        "lift",
      ])
        assert.ok(kinds.has(required), `${floor.name}: ${required}`);
    }
    assert.ok(model.bounds.max.y > 12.6 && model.bounds.max.y < 16);
    assert.ok(model.bounds.max.x - model.bounds.min.x > 38);
  } finally {
    dispose(model);
  }
});

test("new building has no assigned IoT, and future systems remain planned", () => {
  assert.equal(building.model.floors, 3);
  assert.equal(building.model.dimensions_verified, false);
  assert.deepEqual(building.iot, []);
  assert.ok(
    building.phases.slice(3).every((phase) => phase.status === "planned"),
  );
  assert.match(building.phases[2].status, /concept modeled/);
  assert.equal(room.iot[0].scope, "meeting-room");
  assert.equal(room.iot[0].binding, "mxchip");
});

test("the original room still contains eight chairs, table geometry, and its sensor", () => {
  const chairs = [],
    boxes = [];
  buildMeetingRoom({
    box: (...args) => boxes.push(args),
    slab: () => {},
    stool: (...args) => chairs.push(args),
    v: (x, y, z) => ({ x, y, z }),
    roomOn: true,
    alarmOn: false,
    sensorPosition: () => ({ x: 0.38, y: 0.78, z: 0.2 }),
  });
  assert.equal(chairs.length, 8);
  assert.ok(
    boxes.some((box) => box[3] === 4.78 && box[5] === 1.88),
    "Original conference table",
  );
  assert.ok(
    boxes.some((box) => box[0] === 0.38 && box[1] === 0.78),
    "Original MXCHIP model",
  );
});

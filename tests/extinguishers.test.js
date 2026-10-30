import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { EXTINGUISHERS } from "../projects/atrium-building/extinguisher-plan.js";
import { createAtriumBuilding } from "../projects/atrium-building/model.js";
import { ALL_ROOMS, doorPosition } from "../projects/atrium-building/layout.js";
import {
  applyBuildingVisibility,
  visibleIntersections,
} from "../projects/atrium-building/visibility.js";
import { isVisible } from "../projects/atrium-building/geometry.js";

const model = createAtriumBuilding();
model.root.updateMatrixWorld(true);
const source = JSON.parse(
  readFileSync(
    new URL(
      "../projects/atrium-building/reference/extinguisher-placements-f01.json",
      import.meta.url,
    ),
  ),
);
const state = {
  floor: "all",
  view: "offices",
  roof: false,
  ceilings: false,
  systems: false,
  glass: true,
  partitions: true,
  furniture: true,
  lowWalls: false,
  services: false,
  extinguishers: true,
};

test("all 27 PDF F01 stations retain schedule IDs, floor counts, marked walls, facing and equipment categories", () => {
  assert.deepEqual(
    [0, 1, 2].map((f) => EXTINGUISHERS.filter((s) => s.floor === f).length),
    [11, 8, 8],
  );
  assert.equal(EXTINGUISHERS.length, source.count);
  for (const expected of source.stations) {
    const actual = EXTINGUISHERS.find((s) => s.assetId === expected.id);
    assert.ok(actual, expected.id);
    assert.equal(actual.signId, expected.sign_id);
    assert.equal(actual.type, expected.type);
    assert.equal(actual.roomId, expected.room_id);
    assert.deepEqual(actual.source, {
      x: expected.x_m,
      y: expected.y_m,
      facing: expected.facing,
    });
    assert.equal(actual.wall.x, expected.x_m - 20);
    assert.equal(actual.wall.z, 12 - expected.y_m);
    assert.equal(actual.y, actual.floor * 4.2);
  }
  assert.deepEqual(
    ["ABC-O", "ABC-S", "CA-E"].map(
      (type) => EXTINGUISHERS.filter((s) => s.type === type).length,
    ),
    [19, 7, 1],
  );
  const ids = EXTINGUISHERS.flatMap((s) => [s.assetId, s.signId]);
  assert.equal(new Set(ids).size, 54);
  assert.ok(ids.every((id) => !ALL_ROOMS.some((r) => r.id === id)));
});

test("each unit is mounted to the intended wall, clear of doorway swings, with one sign at the specified local heights", () => {
  for (const { station: s, asset, sign } of model.extinguishers.assets) {
    assert.equal(sign.position.y, 2.1);
    assert.equal(sign.geometry.parameters.width, 0.2);
    assert.equal(sign.geometry.parameters.height, 0.2);
    assert.equal(
      asset.children.filter((o) => o.userData.kind === "extinguisher-sign")
        .length,
      1,
    );
    const unitBounds = new THREE.Box3();
    for (const o of asset.children.filter(
      (o) => o.isMesh && o.userData.kind !== "extinguisher-sign",
    )) {
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i++) {
          const matrix = new THREE.Matrix4();
          o.getMatrixAt(i, matrix);
          // The wall/sign mounting hardware at 2.10 m is not part of the portable unit.
          if (matrix.elements[13] > 1.5) continue;
          o.geometry.computeBoundingBox();
          unitBounds.union(
            o.geometry.boundingBox
              .clone()
              .applyMatrix4(asset.matrixWorld.clone().multiply(matrix)),
          );
        }
      } else unitBounds.union(new THREE.Box3().setFromObject(o));
    }
    assert.ok(Math.abs(unitBounds.max.y - s.y - 1.2) < 0.001, s.assetId);
    assert.ok(unitBounds.min.y - s.y > 0.1);
    const room = ALL_ROOMS.find((r) => r.id === s.roomId);
    if (room) {
      assert.ok(
        unitBounds.min.x >= room.bounds.x1 &&
          unitBounds.max.x <= room.bounds.x2,
        s.assetId,
      );
      assert.ok(
        unitBounds.min.z >= room.bounds.z1 &&
          unitBounds.max.z <= room.bounds.z2,
        s.assetId,
      );
    }
    for (const r of ALL_ROOMS.filter((r) => r.floor === s.floor))
      for (const door of r.doors) {
        const p = doorPosition(r, door);
        // Leaves pivot at the lower-coordinate jamb, not the opening centre.
        const alongX = ["N", "S"].includes(door.side);
        const hingeX = p.x - (alongX ? door.width / 2 : 0);
        const hingeZ = p.z - (alongX ? 0 : door.width / 2);
        assert.ok(
          Math.hypot(s.x - hingeX, s.z - hingeZ) > door.width + 0.15,
          `${s.assetId} door ${r.id}`,
        );
      }
  }
});

test("portable units avoid existing columns, walls, furniture and doors and can be reached from their mounting side", () => {
  applyBuildingVisibility(model, state);
  const colliders = [];
  model.root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    const add = (matrix, data) => {
      if (
        ["structure", "partition", "door", "furniture", "fixture"].includes(
          data.kind,
        )
      )
        colliders.push({
          bounds: o.geometry.boundingBox.clone().applyMatrix4(matrix),
          data,
        });
    };
    if (o.isInstancedMesh)
      for (let i = 0; i < o.count; i++) {
        const matrix = new THREE.Matrix4();
        o.getMatrixAt(i, matrix);
        add(
          o.matrixWorld.clone().multiply(matrix),
          o.userData.instances?.[i] || o.userData,
        );
      }
    else add(o.matrixWorld, o.userData);
  });
  for (const { station: s, asset } of model.extinguishers.assets) {
    const body = asset.children.find(
      (o) => o.geometry?.type === "CylinderGeometry",
    );
    const bounds = new THREE.Box3().setFromObject(body);
    assert.deepEqual(
      colliders.filter((c) => c.bounds.intersectsBox(bounds)),
      [],
      s.assetId,
    );
    const point = new THREE.Vector3(
      s.x + s.normal[0] * 0.11,
      s.y + 0.82,
      s.z + s.normal[1] * 0.11,
    );
    const from = point
      .clone()
      .add(new THREE.Vector3(s.normal[0], 0, s.normal[1]).multiplyScalar(0.6));
    const hit = visibleIntersections(
      new THREE.Raycaster(
        from,
        point.clone().sub(from).normalize(),
        0.001,
        0.7,
      ),
      model.root,
    )[0];
    assert.ok(hit, s.assetId);
    assert.equal(
      (hit.object.userData.instances?.[hit.instanceId] || hit.object.userData)
        .assetId,
      s.assetId,
    );
  }
});

test("every paired sign is readable above its unit, including both approaches to projecting corridor signs", () => {
  for (const floor of [0, 1, 2]) {
    applyBuildingVisibility(model, { ...state, floor: String(floor) });
    model.root.updateMatrixWorld(true);
    for (const { station: s, sign } of model.extinguishers.assets.filter(
      ({ station }) => station.floor === floor,
    )) {
      const centre = sign.getWorldPosition(new THREE.Vector3());
      const normal = new THREE.Vector3(s.normal[0], 0, s.normal[1]);
      const directions = [normal];
      if (s.projecting) {
        const tangent = new THREE.Vector3(normal.z, 0, -normal.x);
        directions.push(tangent, tangent.clone().negate());
      }
      for (const direction of directions) {
        const from = centre.clone().addScaledVector(direction, 0.7);
        const hit = visibleIntersections(
          new THREE.Raycaster(from, direction.clone().negate(), 0.001, 0.75),
          model.root,
        )[0];
        assert.ok(
          hit?.object === sign,
          `${s.signId} approach ${direction.toArray()}`,
        );
        const material = Array.isArray(sign.material)
          ? sign.material[hit.face.materialIndex]
          : sign.material;
        assert.ok(
          material === model.extinguishers.signMaterial,
          `${s.signId} pictogram face`,
        );
      }
      assert.ok(Math.abs(centre.y - s.y - 2.1) < 0.0001, s.signId);
      // One physical identification object per station, always above the handle.
      assert.ok(centre.y - 0.1 > s.y + 1.2);
    }
  }
});

test("floor isolation and extinguisher toggle hide units and signs from rendering and raycast selection together", () => {
  applyBuildingVisibility(model, { ...state, floor: "1" });
  for (const { station, asset, sign } of model.extinguishers.assets) {
    assert.equal(isVisible(asset), station.floor === 1);
    assert.equal(isVisible(sign), station.floor === 1);
  }
  applyBuildingVisibility(model, { ...state, extinguishers: false });
  assert.ok(
    model.extinguishers.assets.every(
      ({ asset, sign }) => !isVisible(asset) && !isVisible(sign),
    ),
  );
  const s = EXTINGUISHERS[0];
  const from = new THREE.Vector3(
    s.x + s.normal[0],
    s.y + 0.82,
    s.z + s.normal[1],
  );
  assert.ok(
    visibleIntersections(
      new THREE.Raycaster(
        from,
        new THREE.Vector3(-s.normal[0], 0, -s.normal[1]),
        0,
        2,
      ),
      model.root,
    ).every(
      (hit) =>
        !["fire-extinguisher", "extinguisher-sign"].includes(
          hit.object.userData.kind,
        ),
    ),
  );
});

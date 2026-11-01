import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createAtriumBuilding } from "../projects/atrium-building/model.js";
import { ALL_ROOMS } from "../projects/atrium-building/layout.js";
import {
  EQUIPMENT,
  TANK_ZONES,
  equipmentBounds,
  EQUIPMENT_YARD_PAD_TOP,
} from "../projects/atrium-building/equipment-plan.js";
import {
  applyBuildingVisibility,
  visibleIntersections,
} from "../projects/atrium-building/visibility.js";
import { isVisible } from "../projects/atrium-building/geometry.js";
const model = createAtriumBuilding();
model.root.updateMatrixWorld(true);
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
  equipment: true,
  equipmentClearances: false,
  equipmentPorts: false,
  equipmentConnections: false,
};
const data = (hit) =>
  hit.object.userData.instances?.[hit.instanceId] || hit.object.userData;
const box = (b) =>
  new THREE.Box3(
    new THREE.Vector3(b.x1, b.y1 + 0.1, b.z1),
    new THREE.Vector3(b.x2, b.y2, b.z2),
  );

function parts(root) {
  const result = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    const add = (matrix, metadata) =>
      result.push({
        object: o,
        metadata,
        bounds: o.geometry.boundingBox.clone().applyMatrix4(matrix),
      });
    if (o.isInstancedMesh)
      for (let i = 0; i < o.count; i++) {
        const m = new THREE.Matrix4();
        o.getMatrixAt(i, m);
        add(o.matrixWorld.clone().multiply(m), o.userData.instances[i]);
      }
    else add(o.matrixWorld, o.userData);
  });
  return result;
}

test("all equipment bases sit flush on actual room finishes or the condenser pad", () => {
  model.root.updateMatrixWorld(true);
  const pad = parts(model.equipment.yard).find(
    (p) => p.metadata.kind === "yard-pad",
  );
  assert.ok(pad);
  for (const a of model.equipment.assets.filter(
    (a) => a.definition.type !== "tank-reservation",
  )) {
    const base = parts(a.object).find((p) => p.metadata.partRole === "base");
    assert.ok(base, a.definition.assetId);
    const floor =
      a.definition.roomId === "YARD"
        ? pad
        : parts(model.interiors[a.definition.floor].zones).find(
            (p) => p.metadata.roomId === a.definition.roomId,
          );
    assert.ok(floor, a.definition.roomId);
    assert.ok(
      Math.abs(base.bounds.min.y - floor.bounds.max.y) < 0.000001,
      `${a.definition.assetId} base contacts its finished surface`,
    );
  }
});

test("pump, pressure-vessel and condenser supports bridge the base to each supported body", () => {
  for (const a of model.equipment.assets.filter((a) =>
    ["pump", "jockey", "booster", "vessel", "condenser"].includes(
      a.definition.type,
    ),
  )) {
    const geometry = parts(a.object),
      base = geometry.find((p) => p.metadata.partRole === "base");
    const supports = geometry.filter((p) => p.metadata.partRole === "support");
    assert.ok(supports.length, `${a.definition.assetId} supports`);
    for (const support of supports) {
      assert.ok(
        Math.abs(support.bounds.min.y - base.bounds.max.y) < 0.000001,
        a.definition.assetId,
      );
      assert.ok(
        geometry.some(
          (body) =>
            body.metadata.partRole === support.metadata.supportFor &&
            support.bounds.max.y >= body.bounds.min.y - 0.000001 &&
            support.bounds.min.x <= body.bounds.max.x &&
            support.bounds.max.x >= body.bounds.min.x &&
            support.bounds.min.z <= body.bounds.max.z &&
            support.bounds.max.z >= body.bounds.min.z,
        ),
        `${a.definition.assetId} supported ${support.metadata.supportFor}`,
      );
    }
    if (a.definition.type === "pump") {
      const shaft = geometry.find((p) => p.metadata.portName === "DRIVE SHAFT");
      assert.ok(shaft, "Main pump has a connected drive shaft");
      for (const role of ["motor", "pump-volute"])
        assert.ok(
          shaft.bounds.intersectsBox(
            geometry.find((p) => p.metadata.partRole === role).bounds,
          ),
          `Drive shaft contacts ${role}`,
        );
    }
    if (a.definition.type === "condenser") {
      const body = geometry.find(
        (p) => p.metadata.partRole === "condenser-body",
      );
      for (const fan of geometry.filter(
        (p) => p.metadata.partRole === "fan-shroud",
      ))
        assert.ok(
          fan.bounds.intersectsBox(body.bounds),
          `${a.definition.assetId} fan housing contacts its body`,
        );
    }
  }
});

test("pump fluid-port markers land on their physical flange or manifold geometry", () => {
  for (const a of model.equipment.assets.filter((a) =>
    ["pump", "jockey", "booster"].includes(a.definition.type),
  )) {
    const geometry = parts(a.object);
    for (const name of ["SUCTION", "DISCHARGE"]) {
      const port = a.portRecords.find((p) => p.name === name),
        position = port.object.getWorldPosition(new THREE.Vector3());
      const fittings = geometry.filter(
        (p) =>
          p.metadata.partRole === "connection" && p.metadata.portName === name,
      );
      assert.ok(
        fittings.some((p) => p.bounds.distanceToPoint(position) < 0.000001),
        `${a.definition.assetId} ${name} matches a fitting`,
      );
    }
  }
});

test("AHU and yard connection reservations start exactly at their named, transformed ports", () => {
  const anchored = model.equipment.connectionRoutes.filter((r) => r.from);
  assert.equal(anchored.length, 4);
  for (const route of anchored) {
    const asset = model.equipment.assets.find(
      (a) => a.definition.assetId === route.from.assetId,
    );
    const port = asset.portRecords.find((p) => p.name === route.from.port);
    const position = port.object.getWorldPosition(new THREE.Vector3());
    assert.ok(
      position.distanceTo(new THREE.Vector3(...route.points[0])) < 0.000001,
      route.id,
    );
  }
});

test("equipment port labels do not overlap each other, including the close condenser connections", () => {
  model.root.updateMatrixWorld(true);
  for (const a of model.equipment.assets)
    for (let i = 0; i < a.portRecords.length; i++) {
      const first = new THREE.Box3().setFromObject(a.portRecords[i].label);
      for (let j = i + 1; j < a.portRecords.length; j++) {
        const second = new THREE.Box3().setFromObject(a.portRecords[j].label);
        assert.ok(
          !first.intersectsBox(second),
          `${a.definition.assetId}: ${a.portRecords[i].name}/${a.portRecords[j].name}`,
        );
      }
    }
});

test("P01 rooms retain all equipment IDs, illustrative envelope sizes, systems and model-only monitoring", () => {
  assert.equal(EQUIPMENT.length, 22);
  assert.equal(model.equipment.assets.length, 24);
  const expected = {
    "FP-01": [2, 0.9, 1.1],
    "JP-01": [0.5, 0.5, 1],
    "CP-FP-01": [0.8, 0.4, 1.8],
    "BS-G-01": [1.5, 0.8, 1.2],
    "MDB-G-01": [2.4, 0.8, 2],
    "SR-G-01": [0.6, 1, 2],
    "UPS-G-01": [0.6, 0.8, 1.2],
    "AHU-L1-01": [1.2, 3, 1.5],
    "AHU-L2-01": [1.2, 3, 1.5],
  };
  for (const [id, size] of Object.entries(expected))
    assert.deepEqual(EQUIPMENT.find((a) => a.assetId === id)?.size, size, id);
  assert.equal(
    new Set(model.equipment.assets.map((a) => a.definition.assetId)).size,
    24,
  );
  for (const { definition: a, portRecords } of model.equipment.assets) {
    assert.equal(a.status, "SIMULATED");
    assert.equal(a.dataSource, "model-placeholder");
    assert.equal(a.connected, false);
    assert.equal(a.controlAvailable, false);
    assert.equal(a.monitoringOnly, true);
    if (a.type !== "tank-reservation") assert.ok(portRecords.length, a.assetId);
    assert.ok(
      !a.roomId?.endsWith("-R01") && !a.roomId?.endsWith("-R02"),
      "Wet/dry/HVAC shafts remain free of floor-standing equipment",
    );
  }
});
test("equipment and its working spaces fit the retained rooms, avoiding other units and existing doors/furniture/structure", () => {
  const existing = [];
  model.root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    const collect = (matrix, d) => {
      if (
        ["structure", "partition", "door", "fixture", "furniture"].includes(
          d.kind,
        )
      )
        existing.push({
          bounds: o.geometry.boundingBox.clone().applyMatrix4(matrix),
          data: d,
        });
    };
    if (o.isInstancedMesh)
      for (let i = 0; i < o.count; i++) {
        const m = new THREE.Matrix4();
        o.getMatrixAt(i, m);
        collect(
          o.matrixWorld.clone().multiply(m),
          o.userData.instances?.[i] || o.userData,
        );
      }
    else collect(o.matrixWorld, o.userData);
  });
  for (const a of EQUIPMENT) {
    const b = equipmentBounds(a),
      room = ALL_ROOMS.find((r) => r.id === a.roomId),
      body = box(b);
    if (room) {
      assert.ok(
        b.x1 > room.bounds.x1 + 0.07 && b.x2 < room.bounds.x2 - 0.07,
        a.assetId,
      );
      assert.ok(
        b.z1 > room.bounds.z1 + 0.07 && b.z2 < room.bounds.z2 - 0.07,
        a.assetId,
      );
    }
    assert.deepEqual(
      existing
        .filter((c) => c.bounds.intersectsBox(body))
        .map((c) => c.data.label),
      [],
      a.assetId,
    );
    assert.ok(
      !EQUIPMENT.some(
        (other) =>
          other.assetId !== a.assetId &&
          box(equipmentBounds(other)).intersectsBox(body),
      ),
      a.assetId,
    );
  }
  for (const clearance of model.equipment.clearances) {
    const bounds = new THREE.Box3().setFromObject(clearance.object),
      a = EQUIPMENT.find((a) => a.assetId === clearance.assetId),
      r = ALL_ROOMS.find((r) => r.id === a.roomId);
    if (r)
      assert.ok(
        bounds.min.x >= r.bounds.x1 + 0.07 &&
          bounds.max.x <= r.bounds.x2 - 0.07 &&
          bounds.min.z >= r.bounds.z1 + 0.07 &&
          bounds.max.z <= r.bounds.z2 - 0.07,
        `${a.assetId} service space`,
      );
    assert.ok(
      !EQUIPMENT.some(
        (other) =>
          other.assetId !== a.assetId &&
          box(equipmentBounds(other)).intersectsBox(bounds),
      ),
      `${a.assetId} clear of other bodies`,
    );
  }
});
test("upper AHUs have front-to-back orientation, retained west doors and high-level shaft reservations outside the adjoining offices", () => {
  for (const f of [1, 2]) {
    const a = EQUIPMENT.find((a) => a.assetId === `AHU-L${f}-01`),
      room = ALL_ROOMS.find((r) => r.id === a.roomId);
    assert.equal(a.size[1], 3);
    assert.equal(a.rotation, 0);
    assert.ok(room.doors.some((d) => d.side === "W" && d.width >= 1.3));
    const route = model.equipment.connectionRoutes.find(
      (r) => r.id === `${a.assetId}-SHAFT-RESERVE`,
    );
    assert.ok(route);
    assert.deepEqual(route.points.at(-1), [12.25, a.y + 3.72, -4.6]);
    for (const [x, y, z] of route.points.slice(1)) {
      assert.ok(y >= a.y + 3.1);
      assert.ok(
        !(x > 9.5 && x < 14 && z > -12 && z < -6),
        "Avoid adjoining flexible/records office",
      );
      assert.ok(
        !(x > -3 && x < 3 && z > -6 && z < 6),
        "Keep central atrium void open",
      );
    }
  }
});
test("condensers are relocated to the open-top ground yard and tank zones leave the rear route unobstructed", () => {
  const coolers = EQUIPMENT.filter((a) => a.type === "condenser");
  assert.equal(coolers.length, 2);
  for (const a of coolers) {
    assert.equal(a.floor, 0);
    assert.equal(a.y, EQUIPMENT_YARD_PAD_TOP);
    assert.equal(a.roomId, "YARD");
    assert.ok(equipmentBounds(a).z2 < -15);
  }
  for (const zone of TANK_ZONES) assert.ok(zone.z + zone.d / 2 < -16);
  for (const a of EQUIPMENT.filter((a) => a.roomId === "YARD"))
    assert.ok(
      !box(equipmentBounds(a)).containsPoint(
        new THREE.Vector3(a.x, 1.1, -14.5),
      ),
    );
});
test("all port IDs remain selectable and clearances/connection diagrams never intercept picking; hidden floors hide equipment", () => {
  applyBuildingVisibility(model, {
    ...state,
    floor: "1",
    equipmentClearances: true,
    equipmentPorts: true,
    equipmentConnections: true,
  });
  for (const { definition: a, object, ports, clearanceGroup } of model.equipment
    .assets) {
    assert.equal(isVisible(object), a.floor === 1, a.assetId);
    if (ports) assert.equal(isVisible(ports), a.floor === 1);
    if (clearanceGroup) assert.equal(isVisible(clearanceGroup), a.floor === 1);
  }
  applyBuildingVisibility(model, {
    ...state,
    floor: "0",
    partitions: false,
    furniture: false,
    equipmentClearances: true,
  });
  const from = new THREE.Vector3(-11.55, 0.55, -6.8),
    direction = new THREE.Vector3(0, 0, -1);
  const ray = new THREE.Raycaster(from, direction, 0, 2);
  const hit = visibleIntersections(ray, model.root)[0];
  assert.ok(hit);
  assert.equal(data(hit).assetId, "FP-01");
  applyBuildingVisibility(model, {
    ...state,
    floor: "0",
    partitions: false,
    furniture: false,
    equipment: false,
  });
  assert.ok(
    !visibleIntersections(ray, model.root).some(
      (h) => data(h).kind === "equipment",
    ),
  );
});

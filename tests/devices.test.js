import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createAtriumBuilding } from "../projects/atrium-building/model.js";
import {
  ALL_ROOMS,
  ROOM_FLOOR_TOP,
  doorPosition,
} from "../projects/atrium-building/layout.js";
import {
  Q_ROOMS,
  deviceRoomSpec,
  deviceAirCandidates,
} from "../projects/atrium-building/device-plan.js";
import { pointOnRoute } from "../projects/atrium-building/main-service-plan.js";
import {
  applyBuildingVisibility,
  visibleIntersections,
} from "../projects/atrium-building/visibility.js";
import { isVisible } from "../projects/atrium-building/geometry.js";
const model = createAtriumBuilding(),
  d02 = model.devices;
model.root.updateMatrixWorld(true);
const state = {
  floor: "all",
  view: "offices",
  systems: true,
  devices: true,
  deviceCategories: { pending: false, zones: false },
  glass: true,
  partitions: true,
  furniture: true,
  lowWalls: false,
  roof: true,
  ceilings: true,
  equipment: true,
  services: false,
};
const data = (h) =>
  h.object.userData.instances?.[h.instanceId] || h.object.userData;
function parts(root) {
  const all = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    const add = (m, d) =>
      all.push({
        bounds: o.geometry.boundingBox.clone().applyMatrix4(m),
        data: d,
      });
    if (o.isInstancedMesh)
      for (let i = 0; i < o.count; i++) {
        const m = new THREE.Matrix4();
        o.getMatrixAt(i, m);
        add(o.matrixWorld.clone().multiply(m), o.userData.instances[i]);
      }
    else add(o.matrixWorld, o.userData);
  });
  return all;
}

test("D02 Q/O/T room programs match all three sheets, with explicit design/data separation and no invented live states", () => {
  assert.deepEqual(d02.issues, []);
  assert.deepEqual(
    d02.assets
      .filter((a) => a.type === "Q")
      .map((a) => a.roomId)
      .sort(),
    [...Q_ROOMS].sort(),
  );
  assert.equal(d02.assets.filter((a) => a.type === "O").length, 40);
  assert.equal(d02.assets.filter((a) => a.type === "T").length, 26);
  assert.equal(
    new Set(d02.assets.map((a) => a.assetId)).size,
    d02.assets.length,
  );
  for (const r of d02.assets) {
    assert.equal(r.data.dataSource, "unconnected");
    assert.equal(r.data.dataStatus, "unavailable");
    assert.equal(r.data.hardwareBinding, null);
    assert.equal(r.data.telemetry, null);
    assert.equal(r.data.controlAvailable, false);
    assert.ok(r.designStatus);
    assert.doesNotThrow(() => JSON.stringify(r.data));
  }
  for (const r of d02.assets.filter((r) =>
    ["S", "R", "E", "L", "SW", "Z", "F"].includes(r.type),
  ))
    assert.equal(r.isSensor, false, r.assetId);
  for (const q of d02.assets.filter((r) => r.type === "Q")) {
    assert.deepEqual(q.measurements, ["temperature", "CO2"]);
    assert.match(q.optionalMeasurements[0], /only if supported/);
  }
});

test("supply/return/extract candidates reuse physical terminals and connect to the proper R01/sanitary branches", () => {
  for (const room of ALL_ROOMS) {
    const spec = deviceRoomSpec(room);
    if (!spec.ordinary && !spec.sanitary && !spec.pantry) continue;
    const assets = d02.assets.filter((a) => a.roomId === room.id);
    assert.equal(
      assets.filter((a) => a.type === "S").length,
      spec.supplyCount || (spec.sanitary ? 1 : 0),
      room.id,
    );
    assert.equal(
      assets.filter((a) => a.type === "R").length,
      spec.returnCount,
      room.id,
    );
    for (const a of assets.filter((a) => ["S", "R", "E"].includes(a.type))) {
      assert.equal(a.reused, true);
      assert.ok(a.legacyAssetId);
      assert.equal(a.object.userData.deviceId, a.assetId);
      const route = [
        ...model.mainServices.routes,
        ...model.services.routes,
      ].find((r) => r.id === a.connection.target);
      assert.ok(route, a.assetId);
      assert.deepEqual(route.points.at(-1), a.position);
      if (a.type === "E") assert.equal(route.system, "exhaust");
      if (a.type === "R") assert.equal(route.system, "return");
      if (a.type === "S") assert.equal(route.system, "supply");
    }
  }
  assert.equal(
    d02.assets.filter((a) => a.type === "E").length,
    21,
    "Cubicle extracts are not collapsed to a single room grille",
  );
});

test("T/Q sensors and latch-side switches mount on actual opaque wall sections outside door openings", () => {
  applyBuildingVisibility(model, { ...state, view: "overview" });
  model.root.updateMatrixWorld(true);
  for (const a of d02.assets.filter((a) => ["T", "Q", "SW"].includes(a.type))) {
    const ray = new THREE.Raycaster(
      new THREE.Vector3(...a.position),
      new THREE.Vector3(...a.normal).negate(),
      0,
      0.3,
    );
    const hits = [
      ...ray.intersectObject(model.interiors[a.floor].walls, true),
      ...ray.intersectObject(
        model.architecture.facades[a.floor].exterior,
        true,
      ),
    ].filter((h) => ["partition", "opaque"].includes(data(h).kind));
    assert.ok(hits.length, `${a.assetId} touches an opaque wall`);
    if (a.type === "SW") {
      const room = ALL_ROOMS.find((r) => r.id === a.roomId),
        door = room.doors[a.doorIndex],
        axis = ["W", "E"].includes(door.side) ? 2 : 0;
      assert.ok(a.position[axis] > door.at + door.width / 2 + 0.28, a.assetId);
      assert.ok(Math.abs(a.position[1] - a.floor * 4.2 - 1.1) < 1e-6);
    }
  }
  applyBuildingVisibility(model, state);
});

test("leak probes sit on the correct finishes by real leak paths and reuse original washroom point IDs without duplicate markers", () => {
  assert.equal(d02.assets.filter((a) => a.type === "W").length, 15);
  for (const r of d02.assets.filter((r) => r.type === "W")) {
    const room = ALL_ROOMS.find((room) => room.id === r.roomId),
      sanitary = ["wc", "accessible-wc"].includes(room.furniture);
    const b = new THREE.Box3().setFromObject(r.object),
      floorY = r.floor * 4.2 + (sanitary ? 0.0475 : ROOM_FLOOR_TOP);
    assert.ok(Math.abs(b.min.y - floorY) < 1e-6, r.assetId);
    assert.ok(r.leakSource);
  }
  assert.equal(d02.aliases.length, 18);
  applyBuildingVisibility(model, { ...state, washroomPoints: true });
  for (const a of d02.aliases) {
    assert.ok(!isVisible(a.wrapper));
    assert.ok(isVisible(a.record.object));
    assert.equal(a.object.userData.assetId, a.legacyId);
    assert.ok(
      a.object
        .getWorldPosition(new THREE.Vector3())
        .distanceTo(new THREE.Vector3(...a.record.position)) < 1e-6,
    );
  }
  applyBuildingVisibility(model, {
    ...state,
    devices: false,
    washroomPoints: true,
  });
  for (const a of d02.aliases) assert.ok(isVisible(a.wrapper));
  assert.equal(model.interiors.flatMap((i) => i.washrooms.points).length, 78);
  applyBuildingVisibility(model, state);
});

test("plant instruments attach to fittings, ducts and actual AHUs; tank and fire layouts remain pending", () => {
  for (const p of d02.assets.filter((a) => a.anchorPort)) {
    const asset = model.equipment.assets.find(
        (a) => a.definition.assetId === p.anchorAssetId,
      ),
      port = asset.portRecords.find((q) => q.name === p.anchorPort);
    assert.ok(
      new THREE.Vector3(...p.anchor).distanceTo(
        port.object.getWorldPosition(new THREE.Vector3()),
      ) < 1e-6,
      p.assetId,
    );
  }
  for (const p of d02.assets.filter((a) => a.anchorRouteId))
    assert.ok(
      pointOnRoute(
        p.anchor,
        model.mainServices.routes.find((r) => r.id === p.anchorRouteId),
      ),
      p.assetId,
    );
  for (const p of d02.assets.filter(
    (a) => a.filterPlaneAssumed !== undefined,
  )) {
    assert.equal(p.data.filterTaps.length, 2);
    assert.notEqual(p.data.filterTaps[0][2], p.data.filterTaps[1][2]);
    assert.equal(p.connection.target, `AHU-L${p.floor}-01`);
  }
  const fan = d02.assets.find((a) => a.assetId === "P-L2-M01-FAN-IF");
  assert.ok(fan.signals.some((s) => s.includes("command")));
  assert.ok(fan.signals.some((s) => s.includes("proof")));
  assert.ok(fan.signals.some((s) => s.includes("fault")));
  assert.equal(
    d02.assets.filter((a) => a.designStatus === "awaiting-tank").length,
    2,
  );
  assert.ok(
    !d02.assets.some((a) =>
      ["detector", "sprinkler", "manual-station"].includes(a.type),
    ),
  );
  const fireStudies = d02.assets.filter((a) => a.scopeRoomIds);
  assert.deepEqual(
    fireStudies.flatMap((a) => a.scopeRoomIds).sort(),
    ALL_ROOMS.filter((r) => deviceRoomSpec(r).ordinary)
      .map((r) => r.id)
      .sort(),
    "All ordinary rooms are in pending ceiling studies, without selecting fire devices",
  );
  assert.ok(
    fireStudies.every((a) => a.bounds.x2 < 0 || a.bounds.x1 > 0),
    "Wing ceiling studies do not span the open atrium",
  );
  assert.equal(model.floors.length, 3);
});

test("light fixtures and occupancy devices clear the actual supply/return/extract grilles", () => {
  const clashes = [];
  for (const a of d02.assets.filter((a) => a.type === "L" || a.type === "O"))
    for (const b of d02.assets.filter(
      (b) => b.roomId === a.roomId && ["S", "R", "E"].includes(b.type),
    )) {
      const box = new THREE.Box3().setFromObject(a.object),
        other = new THREE.Box3().setFromObject(b.object);
      if (box.intersectsBox(other)) clashes.push(`${a.assetId}/${b.assetId}`);
    }
  assert.deepEqual(clashes, []);
});

test("D02 floor isolation, candidate categories, field links and hidden-object picking preserve service inspection", () => {
  applyBuildingVisibility(model, {
    ...state,
    floor: "1",
    devicePlanMode: true,
    deviceRoutes: false,
    deviceConnections: true,
  });
  assert.ok(Object.values(d02.layers[0]).every((g) => !isVisible(g)));
  assert.ok(Object.values(d02.layers[2]).every((g) => !isVisible(g)));
  assert.ok(!isVisible(model.roof));
  assert.ok(!isVisible(model.architecture.canopy));
  assert.ok(
    Object.values(model.mainServices.layers[1]).every((g) => !isVisible(g)),
  );
  assert.ok(
    isVisible(
      model.services.terminalGroups.find((g) => g.userData.roomId === "L1-07"),
    ),
  );
  applyBuildingVisibility(model, {
    ...state,
    floor: "1",
    devices: false,
    systems: false,
  });
  const a = d02.assets.find((a) => a.assetId === "O-L1-07-01"),
    ray = new THREE.Raycaster(
      new THREE.Vector3(a.position[0], a.position[1] + 1, a.position[2]),
      new THREE.Vector3(0, -1, 0),
      0,
      1.2,
    );
  assert.ok(
    !visibleIntersections(ray, model.root).some(
      (h) => data(h).kind === "room-device",
    ),
  );
  applyBuildingVisibility(model, state);
  assert.ok(isVisible(model.mainServices.layers[1].supply));
  applyBuildingVisibility(model, { ...state, view: "overview" });
  assert.ok(isVisible(model.architecture.canopy));
  applyBuildingVisibility(model, state);
});

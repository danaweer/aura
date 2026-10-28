import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  EGRESS_SIGNS,
  SUPPLEMENTAL_SIGNS,
  faceArrow,
  routeFromRoom,
  stairDescent,
  outdoorContinuation,
  EGRESS_BASIS,
} from "../projects/atrium-building/egress-plan.js";
import { ALL_ROOMS, doorPosition } from "../projects/atrium-building/layout.js";
import { createAtriumBuilding } from "../projects/atrium-building/model.js";
import {
  applyBuildingVisibility,
  visibleIntersections,
} from "../projects/atrium-building/visibility.js";
import { isVisible } from "../projects/atrium-building/geometry.js";
const model = createAtriumBuilding();
model.root.updateMatrixWorld(true);
const state = {
  floor: "all",
  view: "overview",
  roof: true,
  ceilings: false,
  systems: false,
  glass: true,
  partitions: true,
  furniture: true,
  lowWalls: false,
  services: false,
  cutaway: false,
  egressSigns: true,
  egressPaths: true,
};
applyBuildingVisibility(model, state);
function hitsBetween(a, b) {
  const start = new THREE.Vector3(...a),
    delta = new THREE.Vector3(...b).sub(start);
  return visibleIntersections(
    new THREE.Raycaster(
      start,
      delta.clone().normalize(),
      0.002,
      delta.length() - 0.002,
    ),
    model.root,
  );
}
test("PDF Rev E01 schedule retains exactly G-01…21, 1-01…18 and 2-01…18 without reusing room asset IDs", () => {
  assert.equal(EGRESS_SIGNS.length, 57);
  for (const [f, count] of [
    [0, 21],
    [1, 18],
    [2, 18],
  ]) {
    const actual = EGRESS_SIGNS.filter((s) => s.floor === f);
    assert.equal(actual.length, count);
    for (let n = 1; n <= count; n++)
      assert.ok(
        actual.some(
          (s) =>
            s.scheduleId === `${f ? f : "G"}-${String(n).padStart(2, "0")}`,
        ),
      );
  }
  assert.equal(new Set(model.egress.allSigns.map((s) => s.assetId)).size, 71);
  assert.equal(SUPPLEMENTAL_SIGNS.length, 14);
  assert.ok(
    EGRESS_SIGNS.every((s) => !ALL_ROOMS.some((r) => r.id === s.assetId)),
  );
});
test("printed chevrons follow observer orientation, including opposite faces on the single stair and junction cabinets", () => {
  assert.equal(faceArrow([1, 0], [0, -1]), "RIGHT");
  assert.equal(faceArrow([-1, 0], [0, -1]), "LEFT");
  assert.equal(faceArrow([0, -1], [-1, 0]), "RIGHT");
  assert.equal(faceArrow([0, 1], [0, -1]), "UP");
  assert.throws(() => faceArrow([0, 1], [0, 1]));
  for (const s of EGRESS_SIGNS)
    for (const face of s.faces)
      assert.equal(face.arrow, faceArrow(face.normal, face.travel));
  for (const s of EGRESS_SIGNS.filter((s) =>
    [1, 2, 9, 10].includes(Number(s.scheduleId.split("-")[1])),
  )) {
    assert.equal(s.faces.length, 2);
    const west = s.x < 0;
    assert.equal(s.faces[0].arrow, west ? "LEFT" : "RIGHT");
    assert.equal(s.faces[1].arrow, west ? "RIGHT" : "LEFT");
    assert.ok(s.faces.every((face) => face.travel[0] === (west ? -1 : 1)));
  }
});
test("room-side and discharge signs align with actual doors; no revolving-door substitution or plant through-route", () => {
  for (const s of EGRESS_SIGNS.filter((s) => s.roomId)) {
    const room = ALL_ROOMS.find((r) => r.id === s.roomId);
    const number = Number(s.scheduleId.split("-")[1]);
    const door = room.doors.find(
      (d) => d.exterior === (number >= 14 && number <= 18 && s.floor === 0),
    );
    assert.ok(door, s.scheduleId);
    const p = doorPosition(room, door);
    assert.ok(Math.hypot(p.x - s.x, p.z - s.z) < 0.2, s.scheduleId);
    assert.ok(s.y > room.floor * 4.2 + 2.4);
  }
  const main = EGRESS_SIGNS.find((s) => s.scheduleId === "G-13");
  assert.equal(main.x, 2.65);
  for (const id of ["G-M01", "G-M02", "G-E01"])
    assert.equal(routeFromRoom(id).exteriorOnly, true);
  for (const room of ALL_ROOMS.filter(
    (r) => !["plant", "core"].includes(r.category),
  )) {
    const route = routeFromRoom(room.id);
    if (!route) continue;
    assert.equal(route.exteriorOnly, undefined);
    assert.ok(
      route.points.every(([x, z]) => !(Math.abs(x) < 3 && z > -6 && z < 6)),
      room.id + " crosses atrium void",
    );
  }
});
test("doorway-to-stair polylines are connected and do not cross walls, furniture or structural posts at walking height", () => {
  for (const room of ALL_ROOMS) {
    const route = routeFromRoom(room.id);
    if (!route || route.exteriorOnly) continue;
    const pts = route.points.map(([x, z]) => [x, room.floor * 4.2 + 1.1, z]);
    for (let i = 1; i < pts.length; i++) {
      const hits = hitsBetween(pts[i - 1], pts[i]);
      assert.equal(
        hits.length,
        0,
        `${room.id} segment ${i}: ${hits.map((h) => h.object.userData.instances?.[h.instanceId]?.kind || h.object.userData.kind).join(",")}`,
      );
    }
  }
});
test("descent follows the existing stair treads and half-landings, reaches ground, and never ascends to roof", () => {
  for (const side of [-1, 1])
    for (const f of [1, 2]) {
      const points = stairDescent(model.stairCores, side, f);
      assert.equal(points[0][1], f * 4.2);
      assert.ok(Math.abs(points.at(-1)[1]) < 1e-6);
      for (let i = 1; i < points.length; i++)
        assert.ok(points[i][1] <= points[i - 1][1] + 1e-6);
      // Test the horizontal tread centers against real modeled surfaces, not the route implementation.
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i];
        if (
          Math.abs(a[1] - b[1]) > 1e-6 ||
          Math.hypot(a[0] - b[0], a[2] - b[2]) < 0.01
        )
          continue;
        const c = a.map((v, j) => (v + b[j]) / 2);
        const hits = new THREE.Raycaster(
          new THREE.Vector3(c[0], c[1] + 0.05, c[2]),
          new THREE.Vector3(0, -1, 0),
          0,
          0.1,
        ).intersectObject(model.root, true);
        assert.ok(
          hits.some((h) => Math.abs(h.point.y - c[1]) < 0.01),
          `No surface below ${c}`,
        );
      }
    }
});
test("side-path continuation is unobstructed at walking height and terminates at an explicitly assumed site edge", () => {
  for (const side of [-1, 1]) {
    const pts = outdoorContinuation(side).map(([x, y, z]) => [x, 1.1, z]);
    for (let i = 1; i < pts.length; i++)
      assert.equal(hitsBetween(pts[i - 1], pts[i]).length, 0);
    assert.equal(pts.at(-1)[2], EGRESS_BASIS.publicWayZ);
  }
});
test("sign and route controls respect floor isolation; hidden signs cannot intercept room picking and overlays never raycast", () => {
  model.egress.trace("L2-01");
  for (const f of [0, 1, 2]) {
    applyBuildingVisibility(model, {
      ...state,
      floor: String(f),
      view: "plan",
    });
    model.egress.signs.forEach((part, i) =>
      assert.equal(isVisible(part), i === f),
    );
    assert.equal(model.roof.visible, false);
    assert.ok(model.services.ceilings.every((p) => !isVisible(p)));
  }
  applyBuildingVisibility(model, {
    ...state,
    egressSigns: false,
    egressPaths: false,
  });
  for (const part of [
    ...model.egress.signs,
    ...model.egress.selected,
    model.egress.outdoorSigns,
    model.egress.outdoorRoutes,
  ])
    assert.equal(isVisible(part), false);
  const s = EGRESS_SIGNS.find((s) => s.scheduleId === "G-19");
  const hits = hitsBetween([s.x - 1, s.y, s.z], [s.x + 0.02, s.y, s.z]);
  assert.ok(hits.every((h) => h.object.userData.kind !== "egress-sign"));
  applyBuildingVisibility(model, state);
  const hitsOn = hitsBetween([s.x - 1, s.y, s.z], [s.x + 0.02, s.y, s.z]);
  assert.ok(hitsOn.some((h) => h.object.userData.kind === "egress-sign"));
});

test("dedicated service-door and main-entrance outdoor legs keep clear of landscaping, rear chases and the revolving door", () => {
  applyBuildingVisibility(model, state);
  const legs = ["G-M01", "G-M02", "G-E01"].map((id) => {
    const r = routeFromRoom(id);
    return [
      ...r.points.map(([x, z]) => [x, 1.1, z]),
      ...outdoorContinuation(r.side, true).map(([x, y, z]) => [x, 1.1, z]),
    ];
  });
  legs.push([
    [4, 1.1, 0.8],
    [4, 1.1, 9.2],
    [2.65, 1.1, 9.2],
    [2.65, 1.1, 22],
  ]);
  for (const pts of legs)
    for (let i = 1; i < pts.length; i++)
      assert.equal(
        hitsBetween(pts[i - 1], pts[i]).length,
        0,
        `Outdoor leg ${JSON.stringify(pts[i - 1])} to ${JSON.stringify(pts[i])}`,
      );
});

// Independent plan-zone audit transcribed from PDF pp.2–4 and schedules pp.8–9.
// The PDF gives locations/approaches, not installation dimensions; model doors
// remain the precise anchors, including the documented side-discharge adaptation.
test("all 57 positions match their PDF corridor, gallery or actual door location", () => {
  const common = {
    1: [-16, -14, -7.4, -6.2],
    2: [14, 16, -7.4, -6.2],
    3: [-13, -11, 8, 11],
    4: [12, 14, 8, 11],
    5: [-16, -14, -0.4, 2],
    6: [14, 16, -0.4, 2],
    7: [-16, -14, -5, -1],
    8: [14, 16, -5, -1],
    9: [-5, -3, -0.4, 2],
    10: [3, 5, -0.4, 2],
    11: [-5, -3, -6.4, -4.8],
    12: [3, 5, -6.4, -4.8],
  };
  let audited = 0;
  for (const s of EGRESS_SIGNS) {
    const n = Number(s.scheduleId.split("-")[1]);
    let zone = common[n];
    if (!zone && n === (s.floor ? 17 : 20)) zone = [-13, -11, -0.4, 2];
    if (!zone && n === (s.floor ? 18 : 21)) zone = [12, 14, -0.4, 2];
    if (!zone && s.floor && n === 13) zone = [-5, -3, 6, 11];
    if (!zone && s.floor && n === 14) zone = [3, 5, 6, 11];
    if (zone)
      assert.ok(
        s.x >= zone[0] && s.x <= zone[1] && s.z >= zone[2] && s.z <= zone[3],
        s.scheduleId,
      );
    else if (s.scheduleId === "G-13")
      assert.deepEqual([s.x, s.z], [2.65, 10.82]);
    else {
      const room = ALL_ROOMS.find((r) => r.id === s.roomId);
      assert.ok(room, s.scheduleId);
      const exterior = s.floor === 0 && n >= 14 && n <= 18;
      const p = doorPosition(
        room,
        room.doors.find((d) => d.exterior === exterior),
      );
      assert.ok(Math.hypot(s.x - p.x, s.z - p.z) < 0.2, s.scheduleId);
    }
    audited++;
  }
  assert.equal(audited, 57);
});
test("every scheduled and supplemental sign has one nonintersecting cabinet with parallel lettering faces", () => {
  const bounds = [];
  assert.equal(model.egress.cabinets.length, 71);
  for (const { sign, cabinet } of model.egress.cabinets) {
    const bodies = cabinet.children.filter((c) => c.isInstancedMesh);
    assert.equal(
      bodies.reduce((n, m) => n + m.count, 0),
      1,
      sign.assetId + " cabinet count",
    );
    const lettering = cabinet.children.filter(
      (c) => c.userData.part === "lettering",
    );
    assert.equal(lettering.length, sign.faces.length);
    if (lettering.length === 2) {
      const normals = lettering.map((face) =>
        new THREE.Vector3(0, 0, 1).transformDirection(face.matrixWorld),
      );
      assert.ok(
        normals[0].dot(normals[1]) < -0.9999,
        sign.assetId + " faces must be opposite, not crossed",
      );
      assert.ok(lettering[0].position.z > 0 && lettering[1].position.z < 0);
    }
    const box = new THREE.Box3().setFromObject(cabinet);
    for (const other of bounds)
      assert.equal(
        box.intersectsBox(other.box),
        false,
        sign.assetId + " overlaps " + other.id,
      );
    bounds.push({ id: sign.assetId, box });
    if (sign.panelOffset) {
      if (sign.x < 0)
        assert.ok(box.min.x > -15.94, sign.assetId + " clips stair wall");
      else assert.ok(box.max.x < 15.94, sign.assetId + " clips stair wall");
    }
  }
});

test("a corridor observer sees only one lettering side of each former cluster, with the correct exit direction", () => {
  for (const s of EGRESS_SIGNS.filter((s) => s.faces.length === 2)) {
    const west = s.x < 0;
    for (const approach of [
      [0, 1],
      [0, -1],
      [west ? 1 : -1, 0],
    ]) {
      const visible = s.faces.filter(
        (f) => f.normal[0] * approach[0] + f.normal[1] * approach[1] > 0.01,
      );
      assert.equal(
        visible.length,
        1,
        s.scheduleId + " must present one sign face",
      );
      assert.deepEqual(visible[0].travel, [west ? -1 : 1, 0]);
    }
  }
});

test("stair and atrium junction signs are visible from both actual corridor approaches", () => {
  applyBuildingVisibility(model, state);
  for (const { sign, cabinet } of model.egress.cabinets.filter(
    (r) => r.sign.faces.length === 2,
  )) {
    const stair = Number(sign.scheduleId.split("-")[1]) < 3;
    const x = Math.sign(sign.x) * (stair ? 15 : 4);
    for (const z of stair ? [-3.6, -9.5] : [4.5, -3.5]) {
      const hit = hitsBetween(
        [x, sign.floor * 4.2 + 1.6, z],
        cabinet.position.toArray(),
      )[0];
      const asset =
        hit?.object.userData.instances?.[hit.instanceId] ||
        hit?.object.userData;
      assert.equal(
        asset?.assetId,
        sign.assetId,
        `${sign.scheduleId} obscured from corridor at ${x},${z}`,
      );
    }
  }
});

test("each occupied stair landing has a pictographic route sign aligned with descent or its real ground exit", () => {
  const signs = SUPPLEMENTAL_SIGNS.filter((sign) => sign.pictogram);
  assert.equal(signs.length, 6);
  applyBuildingVisibility(model, state);
  for (const stair of model.stairCores) {
    const room = ALL_ROOMS.find((r) => r.id === stair.roomId);
    const name = stair.centerX < 0 ? "A" : "B";
    const sign = signs.find(
      (s) => s.assetId === `EGRESS-STAIR-${name}-${stair.floor}`,
    );
    assert.ok(sign, stair.roomId);
    assert.equal(sign.x, stair.centerX);
    assert.ok(sign.z > stair.floorLanding.z2 && sign.z < room.bounds.z2);
    assert.equal(sign.size.width, 1.1);
    assert.equal(sign.size.height, 0.62);
    assert.ok(
      Math.abs(sign.y - stair.bottom - EGRESS_BASIS.mountingHeight) < 0.0001,
    );
    assert.ok(
      sign.y + sign.size.height / 2 < stair.bottom + 3.1,
      "Sign clears ceiling zone",
    );
    if (stair.floor) {
      assert.equal(sign.pictogram, "stair-descent");
      assert.equal(sign.pictogramDirection, "DOWN_LEFT");
      // Viewed toward the front enclosure wall, printed left means world +X,
      // where the actual descending flight starts; it then descends toward -Z.
      const descent = stairDescent(
        model.stairCores,
        Math.sign(stair.centerX),
        stair.floor,
      );
      assert.ok(descent[0][0] > stair.centerX);
      assert.equal(sign.faces[0].travel[0], 1);
      assert.equal(sign.faces[0].arrow, "LEFT");
      assert.ok(descent.some((p) => p[1] < stair.bottom));
      assert.ok(descent[1][2] < descent[0][2]);
    } else {
      const exit = room.doors.find((d) => d.exterior);
      assert.equal(sign.pictogram, "level-exit");
      assert.equal(
        sign.pictogramDirection,
        exit.side === "W" ? "RIGHT" : "LEFT",
      );
      assert.equal(sign.faces[0].travel[0], exit.side === "W" ? -1 : 1);
    }
    const cabinet = model.egress.cabinets.find(
      (r) => r.sign.assetId === sign.assetId,
    ).cabinet;
    // Arriving at a floor from the ascending/descending flight must reveal the sign.
    const observer = [
      stair.centerX - stair.laneOffset,
      stair.bottom + 1.6,
      stair.floorLanding.z1 + 0.15,
    ];
    const hit = hitsBetween(observer, cabinet.position.toArray())[0];
    const metadata =
      hit?.object.userData.instances?.[hit.instanceId] || hit?.object.userData;
    assert.equal(
      metadata?.assetId,
      sign.assetId,
      sign.assetId + " landing visibility",
    );
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createAtriumBuilding } from "../projects/atrium-building/model.js";
import { ALL_ROOMS, ENVELOPE } from "../projects/atrium-building/layout.js";
import {
  BALCONIES,
  ROOF_Y,
  EAST_ROOF_OPENING,
} from "../projects/atrium-building/architecture.js";
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
  ceilings: true,
  systems: true,
  glass: true,
  partitions: true,
  furniture: true,
  lowWalls: true,
  services: false,
  cutaway: false,
};
const info = (hit) =>
  hit.object.userData.instances?.[hit.instanceId] || hit.object.userData;
const ray = (a, b, distance = 10) =>
  new THREE.Raycaster(
    new THREE.Vector3(...a),
    new THREE.Vector3(...b),
    0,
    distance,
  );
const near = (a, b) => Math.abs(a - b) < 0.001;

test("bathrooms, service rooms and stair cores have opaque room-aware exterior walls", () => {
  applyBuildingVisibility(model, state);
  const panels = model.architecture.facadePanels;
  for (const panel of panels.filter((p) => p.roomId)) {
    const room = ALL_ROOMS.find((r) => r.id === panel.roomId);
    if (["service", "plant", "core"].includes(room.category))
      assert.equal(panel.solid, true, room.id);
  }
  // Actual rays at fixture and standing-eye heights must hit opaque walls, not tinted glass.
  for (const floor of [0, 1, 2])
    for (const sign of [-1, 1])
      for (const h of [0.8, 1.7, 2.8, 3.6]) {
        const hits = visibleIntersections(
          ray([sign * 21, floor * 4.2 + h, -4.8], [-sign, 0, 0], 2),
          model.root,
        );
        assert.ok(hits.length, `Bathroom exterior floor ${floor}`);
        assert.equal(info(hits[0]).kind, "opaque");
        assert.equal(hits[0].object.material.transparent, false);
      }
});

test("second-floor balcony portals are open, connect to the correct rooms and retain their furniture", () => {
  applyBuildingVisibility(model, state);
  for (const b of BALCONIES) {
    const room = ALL_ROOMS.find((r) => r.id === b.roomId);
    assert.equal(room.floor, 2);
    assert.equal(room.bounds.z2, b.z1);
    assert.ok(
      b.door - 0.625 > room.bounds.x1 && b.door + 0.625 < room.bounds.x2,
    );
    const hits = visibleIntersections(
      ray([b.door, 9.6, 12.6], [0, 0, -1], 1.2),
      model.root,
    );
    assert.equal(
      hits.length,
      0,
      `${b.roomId} doorway clear through the actual façade`,
    );
    // Path from the last two metres of the room through the doorway avoids existing furniture.
    const furniture = model.interiors[2].furniture;
    const clear = ray([b.door, 8.95, 12.2], [0, 0, -1], 2.5).intersectObject(
      furniture,
      true,
    );
    assert.equal(clear.length, 0, `${b.roomId} interior approach`);
    const portal = model.architecture.doorways.find(
      (d) => d.roomId === b.roomId && d.kind === "balcony-door",
    );
    assert.equal(portal.floor, 2);
    assert.equal(portal.width, 1.25);
  }
  assert.equal(model.floors.length, 3);
  assert.equal(ENVELOPE.width, 40);
  assert.equal(ENVELOPE.depth, 24);
});

test("real openings preserve roof access from existing stairs and the HVAC shaft", () => {
  for (const access of model.architecture.roofAccess) {
    const b = access.hatch;
    const hits = ray([(b.x1 + b.x2) / 2, ROOF_Y + 0.8, -11.3], [0, -1, 0], 1.2)
      .intersectObject(model.architecture.wingRoofs, true)
      .filter((hit) =>
        ["roof-slab", "roof-insulation", "waterproofing"].includes(
          info(hit).kind,
        ),
      );
    assert.equal(
      hits.length,
      0,
      `${access.roomId} roof access is not sealed by a slab`,
    );
    assert.ok(
      ALL_ROOMS.some((r) => r.id === access.roomId && r.furniture === "stairs"),
    );
  }
  const opening = EAST_ROOF_OPENING;
  const hits = ray(
    [(opening.x1 + opening.x2) / 2, ROOF_Y + 0.6, -4.6],
    [0, -1, 0],
    1,
  )
    .intersectObject(model.architecture.wingRoofs, true)
    .filter((hit) =>
      ["roof-slab", "roof-insulation", "waterproofing"].includes(
        info(hit).kind,
      ),
    );
  assert.equal(hits.length, 0);
  for (const part of model.skylight.children.filter((item) => item.isMesh)) {
    const bounds = new THREE.Box3().setFromObject(part);
    assert.ok(
      bounds.min.x >= -5.1 && bounds.max.x <= 5.1,
      "Only central atrium is glazed at roof level",
    );
  }
});

function onSegment(point, a, b) {
  return point.every(
    (n, axis) =>
      n >= Math.min(a[axis], b[axis]) - 0.001 &&
      n <= Math.max(a[axis], b[axis]) + 0.001,
  );
}
test("every room air terminal connects to its matching spine and continuous roof-fed riser", () => {
  const routes = model.services.routes;
  for (const terminal of model.services.terminals) {
    const id =
      terminal.routeId ||
      `${terminal.roomId}-${terminal.system === "exhaust" ? "EXTRACT" : terminal.system.toUpperCase()}`;
    const branch = routes.find((r) => r.id === id);
    assert.ok(branch, id);
    assert.deepEqual(branch.points.at(-1), terminal.position);
    if (terminal.system !== "exhaust") {
      const start = branch.points[0];
      assert.ok(
        routes.some(
          (r) =>
            r.system === terminal.system &&
            r.id.includes("CORRIDOR") &&
            r.points.some((p, i) => i && onSegment(start, r.points[i - 1], p)),
        ) ||
          routes.some(
            (r) =>
              r.system === terminal.system &&
              r.id.includes("SPINE") &&
              r.points.some(
                (p, i) => i && onSegment(start, r.points[i - 1], p),
              ),
          ),
        `${id} connects to main route`,
      );
    }
  }
  for (const wing of ["West", "East"])
    for (const system of ["supply", "return"]) {
      const feeds = ["G", "L1", "L2"].map((f) =>
        routes.find((r) => r.id === `${f}-${wing}-${system}-FEED`),
      );
      assert.deepEqual(feeds[0].points.at(-1), feeds[1].points[0]);
      assert.deepEqual(feeds[1].points.at(-1), feeds[2].points[0]);
      assert.deepEqual(
        routes.find((r) => r.id === `${wing}-${system}-ROOF`).points.at(-1),
        feeds[2].points.at(-1),
      );
    }
  for (const wing of ["West", "East"]) {
    const feeds = ["G", "L1", "L2"].map((f) =>
      routes.find((r) => r.id === `${f}-${wing}-EXHAUST-RISER`),
    );
    assert.deepEqual(feeds[0].points.at(-1), feeds[1].points[0]);
    assert.deepEqual(feeds[1].points.at(-1), feeds[2].points[0]);
    assert.deepEqual(
      routes.find((r) => r.id === `${wing}-EXHAUST-ROOF`).points[0],
      feeds[2].points.at(-1),
    );
  }
  for (const r of routes.filter((r) =>
    /L2.*(SUPPLY|RETURN|EXTRACT)$/.test(r.id),
  ))
    assert.ok(
      r.points.every((p) => p[1] + r.height / 2 < ROOF_Y - 0.24),
      `${r.id} stays below roof slab`,
    );
  for (const room of ALL_ROOMS.filter((r) =>
    ["wc", "accessible-wc", "janitor"].includes(r.furniture),
  )) {
    assert.ok(
      model.services.terminals.some(
        (t) => t.roomId === room.id && t.system === "exhaust",
      ),
    );
    assert.ok(
      !model.services.terminals.some(
        (t) => t.roomId === room.id && t.system === "return",
      ),
    );
  }
});

test("equipment, exhaust separation and connections keep rooftop maintenance aisles clear", () => {
  for (const zone of model.services.plant) {
    // A visual separation guard, not a code-prescribed intake/exhaust distance.
    assert.ok(
      Math.hypot(
        zone.intake[0] - zone.exhaustOutlet[0],
        zone.intake[2] - zone.exhaustOutlet[2],
      ) > 5,
    );
    assert.ok(zone.exhaustOutlet[1] > zone.intake[1]);
    const aisle = zone.aisle;
    // No body of equipment or shin-height connection cuts across the maintenance aisle.
    for (const object of [zone.cooling, zone.ahu])
      assert.ok(object.x + 1.4 < aisle.x1 || object.x - 1.4 > aisle.x2);
    for (const route of model.services.routes.filter((r) =>
      r.id.startsWith(`${zone.wing}-COOLING-COIL`),
    ))
      for (let i = 1; i < route.points.length; i++) {
        const a = route.points[i - 1],
          b = route.points[i];
        if (Math.min(a[0], b[0]) < aisle.x2 && Math.max(a[0], b[0]) > aisle.x1)
          assert.ok(
            Math.max(a[2], b[2]) < aisle.z1 || Math.min(a[2], b[2]) > aisle.z2,
          );
      }
  }
});

test("air routes avoid the existing structural columns and leave roof walkways unobstructed", () => {
  const structural = [],
    walkways = [];
  model.root.traverse((object) => {
    if (!object.isInstancedMesh) return;
    for (let index = 0; index < object.count; index++) {
      const data = object.userData.instances?.[index] || object.userData;
      if (!["structure", "roof-walkway"].includes(data.kind)) continue;
      const matrix = new THREE.Matrix4();
      object.getMatrixAt(index, matrix);
      matrix.premultiply(object.matrixWorld);
      const bounds =
        object.geometry.boundingBox?.clone() ||
        new THREE.Box3().setFromBufferAttribute(
          object.geometry.attributes.position,
        );
      bounds.applyMatrix4(matrix);
      if (data.kind === "structure") structural.push(bounds);
      else {
        bounds.max.y += 2.1;
        walkways.push(bounds);
      }
    }
  });
  for (const route of model.services.routes)
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1],
        b = route.points[i];
      const bounds = new THREE.Box3(
        new THREE.Vector3(...a).min(new THREE.Vector3(...b)),
        new THREE.Vector3(...a).max(new THREE.Vector3(...b)),
      );
      bounds.expandByVector(
        new THREE.Vector3(route.width / 2, route.height / 2, route.width / 2),
      );
      assert.ok(
        !structural.some((s) => s.intersectsBox(bounds)),
        `${route.id} avoids structural grid`,
      );
      if (route.points.some((p) => p[1] > ROOF_Y + 0.01))
        assert.ok(
          !walkways.some((w) => w.intersectsBox(bounds)),
          `${route.id} keeps roof maintenance headroom`,
        );
    }
});

test("service doors and central approach remain clear of new site objects", () => {
  const site = model.architecture.site;
  for (const door of model.architecture.doorways.filter(
    (d) => d.floor === 0 && d.side === "back",
  )) {
    for (const x of [
      door.at - door.width * 0.3,
      door.at,
      door.at + door.width * 0.3,
    ]) {
      const hits = ray([x, 1, -16], [0, 0, 1], 4.15).intersectObject(
        site,
        true,
      );
      assert.equal(hits.length, 0, `${door.roomId} rear access`);
    }
  }
  for (const x of [-2, 0, 2, 2.65]) {
    const hits = ray([x, 0.75, 21], [0, 0, -1], 9.5).intersectObject(
      site,
      true,
    );
    assert.equal(hits.length, 0, "Continuous clear central approach");
  }
});

test("floor isolation hides ceilings and roofs and invisible objects never block picking", () => {
  for (const floor of ["0", "1", "2"]) {
    applyBuildingVisibility(model, {
      ...state,
      floor,
      view: "offices",
      systems: false,
    });
    assert.equal(model.roof.visible, false);
    assert.ok(model.services.ceilings.every((part) => !isVisible(part)));
    assert.ok(
      model.floors.every(
        (part, index) => isVisible(part) === (index === Number(floor)),
      ),
    );
    const hits = visibleIntersections(
      ray([-16.5, 30, 5.5], [0, -1, 0], 40),
      model.root,
    );
    assert.ok(hits.length);
    assert.ok(hits.every((hit) => isVisible(hit.object)));
    assert.ok(
      !hits.some(
        (hit) => info(hit).kind === "ceiling" || info(hit).kind === "roof-slab",
      ),
    );
    assert.ok(hits[0].point.y < Number(floor) * 4.2 + 4.2);
  }
  applyBuildingVisibility(model, {
    ...state,
    roof: false,
    ceilings: false,
    systems: false,
  });
  assert.ok(!isVisible(model.services.rooftop));
  assert.ok(!isVisible(model.roof));
  assert.ok(model.services.ceilings.every((part) => !isVisible(part)));
  applyBuildingVisibility(model, state);
});

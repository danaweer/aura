import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createAtriumBuilding } from "../projects/atrium-building/model.js";
import {
  WASHROOM_PLANS,
  WASHROOM_PENETRATIONS,
} from "../projects/atrium-building/washroom-plan.js";
import {
  applyBuildingVisibility,
  visibleIntersections,
} from "../projects/atrium-building/visibility.js";
import { isVisible } from "../projects/atrium-building/geometry.js";
const model = createAtriumBuilding();
const state = {
  floor: "all",
  view: "offices",
  partitions: true,
  furniture: true,
  lowWalls: false,
  systems: false,
  services: false,
  glass: true,
  ceilings: false,
  roof: false,
  washroomClearances: false,
  washroomPoints: false,
  washroomDoors: false,
};
applyBuildingVisibility(model, state);
model.root.updateMatrixWorld(true);
function data(hit) {
  return hit.object.userData.instances?.[hit.instanceId] || hit.object.userData;
}
function hit(a, b) {
  const from = new THREE.Vector3(...a),
    delta = new THREE.Vector3(...b).sub(from);
  return visibleIntersections(
    new THREE.Raycaster(
      from,
      delta.clone().normalize(),
      0.002,
      delta.length() - 0.002,
    ),
    model.root,
  );
}
test("six mirrored 4 × 5.6 m suites have three cubicles and two knee-clear basins each; three separate accessible WCs are retained", () => {
  const inventory = model.interiors.flatMap((i) => i.inventory);
  assert.equal(WASHROOM_PLANS.length, 9);
  assert.equal(inventory.filter((i) => i.type === "wc").length, 21);
  assert.equal(inventory.filter((i) => i.type === "basin").length, 15);
  for (const p of WASHROOM_PLANS) {
    assert.equal(
      inventory.filter((i) => i.roomId === p.room.id && i.type === "wc").length,
      p.suite ? 3 : 1,
    );
    assert.equal(
      inventory.filter((i) => i.roomId === p.room.id && i.type === "basin")
        .length,
      p.suite ? 2 : 1,
    );
    for (const c of p.cubicles.slice(0, p.suite ? 2 : 0)) {
      assert.ok(Math.abs(c.u2 - c.u1 - 1.7) < 0.001);
      assert.ok(Math.abs(c.v2 - c.v1 - 1.05) < 0.001);
    }
    if (p.suite) {
      assert.ok(p.cubicles[2].v2 - p.cubicles[2].v1 >= 2);
      assert.equal(p.room.doors[0].at, -1.8, "Retain existing corridor door");
      assert.equal(p.room.area, 22.4);
    } else assert.equal(p.room.area, 12.8);
    assert.equal(p.turning.radius * 2, 1.6);
    if (p.east) {
      const west = WASHROOM_PLANS.find(
        (w) => w.room.floor === p.room.floor && w.suite && !w.east,
      );
      for (const c of p.cubicles)
        assert.equal(p.point(...c.wc)[0], -west.point(...c.wc)[0]);
    }
  }
});
test("closed cubicle and entry doors provide privacy at standing height and opening direction matches each cubicle", () => {
  applyBuildingVisibility(model, state);
  model.root.updateMatrixWorld(true);
  for (const p of WASHROOM_PLANS.filter((p) => p.suite)) {
    const y = p.room.floor * 4.2 + 1.6;
    for (const c of p.cubicles) {
      const a = p.point(2.8, (c.door[0] + c.door[1]) / 2, y),
        b = p.point(1.7, (c.door[0] + c.door[1]) / 2, y);
      assert.ok(
        hit(a, b).some((h) => data(h).kind === "door"),
        `${p.room.id} ${c.id} privacy`,
      );
    }
    const d = p.room.doors[0],
      x = p.east ? p.room.bounds.x1 : p.room.bounds.x2;
    assert.ok(
      hit(
        [x + (p.east ? -0.3 : 0.3), y, d.at],
        [x + (p.east ? 0.5 : -0.5), y, d.at],
      ).some((h) => data(h).kind === "door"),
    );
  }
  applyBuildingVisibility(model, { ...state, washroomDoors: true });
  model.root.updateMatrixWorld(true);
  for (const interior of model.interiors)
    for (const d of interior.washrooms.doors) {
      const p = interior.washrooms.plans.find((p) => p.room.id === d.roomId);
      const object = d.object.children.find((o) => o.isInstancedMesh),
        matrix = new THREE.Matrix4();
      object.getMatrixAt(0, matrix);
      const centre = new THREE.Vector3().setFromMatrixPosition(
        object.matrixWorld.clone().multiply(matrix),
      );
      const u = p.east
        ? p.room.bounds.x2 - centre.x
        : centre.x - p.room.bounds.x1;
      assert.ok(
        d.accessible ? u > 2.1 : u < 2.05,
        `${d.roomId} door opens ${d.accessible ? "out" : "in"}`,
      );
    }
});
test("turning reserves stay clear of fixtures, closed doors and partitions at usable heights", () => {
  applyBuildingVisibility(model, state);
  model.root.updateMatrixWorld(true);
  for (const p of WASHROOM_PLANS) {
    const [cx, , cz] = p.point(p.turning.u, p.turning.v);
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8,
        dir = [Math.cos(a), Math.sin(a)];
      for (const height of [0.25, 0.8, 1.25]) {
        const y = p.room.floor * 4.2 + height;
        const hits = hit(
          [cx, y, cz],
          [cx + dir[0] * 0.79, y, cz + dir[1] * 0.79],
        );
        assert.ok(
          !hits.some((h) =>
            ["fixture", "door", "partition", "structure"].includes(
              data(h).kind,
            ),
          ),
          `${p.room.id} turning reserve at ${height}`,
        );
      }
    }
  }
});
test("every WC cubicle, separate accessible WC and janitor has extract; washrooms have make-up supply and no office return", () => {
  for (const p of WASHROOM_PLANS) {
    const terminals = model.services.terminals.filter(
      (t) => t.roomId === p.room.id,
    );
    assert.equal(
      terminals.filter((t) => t.system === "exhaust").length,
      p.cubicles.length,
    );
    assert.equal(terminals.filter((t) => t.system === "supply").length, 1);
    assert.equal(terminals.filter((t) => t.system === "return").length, 0);
    for (const terminal of terminals.filter((t) => t.system === "exhaust")) {
      const route = model.services.routes.find(
        (r) => r.id === terminal.routeId,
      );
      assert.deepEqual(route.points.at(-1), terminal.position);
    }
  }
  assert.equal(
    model.services.terminals.filter((t) => t.system === "exhaust").length,
    24,
  );
});
test("local soil and water stacks connect across all floors and roof vents pass through real reserved openings", () => {
  const routes = model.services.plumbing.routes;
  for (const code of ["W01", "W04", "W02"])
    for (const system of ["SOIL-STACK", "cold-RISER", "tempered-RISER"]) {
      const segments = ["G", "L1", "L2"].map((f) =>
        routes.find((r) => r.id === `${f}-${code}-${system}`),
      );
      assert.deepEqual(segments[0].points.at(-1), segments[1].points[0]);
      assert.deepEqual(segments[1].points.at(-1), segments[2].points[0]);
    }
  for (const p of WASHROOM_PLANS) {
    for (const c of p.cubicles)
      assert.ok(routes.find((r) => r.id === `${p.room.id}-${c.id}-SOIL`));
    for (let i = 0; i < p.basins.length; i++)
      for (const system of ["cold", "tempered", "TRAP", "WASTE"])
        assert.ok(
          routes.find((r) => r.id === `${p.room.id}-B${i + 1}-${system}`),
        );
  }
  for (const p of WASHROOM_PLANS.filter((p) => p.suite && p.room.floor === 2)) {
    const [x, , z] = p.soil;
    assert.ok(
      WASHROOM_PENETRATIONS.some(
        (b) => x > b.x1 && x < b.x2 && z > b.z1 && z < b.z2,
      ),
    );
    const ray = new THREE.Raycaster(
      new THREE.Vector3(x, 12.5, z),
      new THREE.Vector3(0, -1, 0),
      0,
      4.3,
    );
    assert.ok(
      !ray
        .intersectObject(model.root, true)
        .some((h) => ["slabs", "roof-slab"].includes(data(h).kind)),
    );
  }
});
test("washroom overlays obey floor isolation, doors remain closed by default and BMS states are unavailable", () => {
  applyBuildingVisibility(model, {
    ...state,
    floor: "2",
    washroomClearances: true,
    washroomPoints: true,
  });
  for (const [floor, i] of model.interiors.entries()) {
    assert.equal(isVisible(i.washrooms.clearances), floor === 2);
    assert.equal(isVisible(i.washrooms.markers), floor === 2);
    for (const point of i.washrooms.points) {
      assert.equal(point.status, "unavailable");
      assert.equal(point.source, "model-only");
    }
    assert.ok(i.washrooms.doors.every((d) => d.object.rotation.y === 0));
  }
  applyBuildingVisibility(model, state);
});

test("batched pipe rendering retains segment coordinates, stable asset IDs, floor isolation and picking", () => {
  const meshes = [];
  const roots = [
    ...model.services.plumbing.layers,
    model.services.plumbing.roof,
  ];
  for (const root of roots)
    root.traverse((o) => {
      if (o.isInstancedMesh && o.geometry.type === "CylinderGeometry")
        meshes.push(o);
    });
  const routes = new Map(model.services.plumbing.routes.map((r) => [r.id, r]));
  const expected = model.services.plumbing.routes.reduce(
    (n, r) =>
      n +
      r.points
        .slice(1)
        .filter(
          (p, i) => Math.hypot(...p.map((v, a) => v - r.points[i][a])) > 0.001,
        ).length,
    0,
  );
  assert.equal(
    meshes.reduce((n, m) => n + m.count, 0),
    expected,
  );
  assert.ok(
    meshes.length < 20,
    "Pipe segments remain batched instead of hundreds of individual meshes",
  );
  for (const mesh of meshes)
    for (let i = 0; i < mesh.count; i++) {
      const metadata = mesh.userData.instances[i],
        route = routes.get(metadata.assetId);
      assert.ok(route, metadata.assetId);
      const matrix = new THREE.Matrix4();
      mesh.getMatrixAt(i, matrix);
      const start = new THREE.Vector3(0, -0.5, 0).applyMatrix4(matrix);
      const end = new THREE.Vector3(0, 0.5, 0).applyMatrix4(matrix);
      assert.ok(
        start.distanceTo(new THREE.Vector3(...route.points[metadata.segment])) <
          0.0001,
      );
      assert.ok(
        end.distanceTo(
          new THREE.Vector3(...route.points[metadata.segment + 1]),
        ) < 0.0001,
      );
      assert.ok(Number.isInteger(metadata.floor));
    }
  applyBuildingVisibility(model, {
    ...state,
    floor: "1",
    systems: true,
    partitions: false,
    furniture: false,
  });
  model.root.updateMatrixWorld(true);
  const route = routes.get("L1-W01-SOIL-STACK"),
    p = route.points[0];
  const from = [p[0] + 0.3, p[1] + 2, p[2]],
    to = [p[0] - 0.1, p[1] + 2, p[2]];
  const visible = hit(from, to)[0];
  assert.equal(data(visible).assetId, route.id);
  assert.equal(data(visible).floor, 1);
  applyBuildingVisibility(model, {
    ...state,
    floor: "1",
    systems: false,
    partitions: false,
    furniture: false,
  });
  assert.ok(!hit(from, to).some((h) => data(h).kind === "plumbing"));
  applyBuildingVisibility(model, state);
});

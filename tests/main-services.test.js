import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createAtriumBuilding } from "../projects/atrium-building/model.js";
import {
  FLOORS,
  ALL_ROOMS,
  ATRIUM_VOID,
} from "../projects/atrium-building/layout.js";
import {
  SERVICE_RESERVATIONS,
  ROUTE_PROFILES,
  SERVICE_FACADE_OPENINGS,
  pointOnRoute,
} from "../projects/atrium-building/main-service-plan.js";
import {
  applyBuildingVisibility,
  visibleIntersections,
} from "../projects/atrium-building/visibility.js";
import { isVisible } from "../projects/atrium-building/geometry.js";

const model = createAtriumBuilding(),
  r01 = model.mainServices;
model.root.updateMatrixWorld(true);
const state = {
  floor: "all",
  view: "offices",
  systems: true,
  partitions: true,
  furniture: true,
  glass: true,
  roof: true,
  ceilings: true,
  services: false,
  serviceLayers: {},
  serviceShafts: true,
};
const byId = (id) => r01.routes.find((r) => r.id === id);
const bounds = (a, b, width = 0, height = width) =>
  new THREE.Box3(
    new THREE.Vector3(...a).min(new THREE.Vector3(...b)),
    new THREE.Vector3(...a).max(new THREE.Vector3(...b)),
  ).expandByVector(new THREE.Vector3(width / 2, height / 2, width / 2));
const info = (hit) =>
  hit.object.userData.instances?.[hit.instanceId] || hit.object.userData;

test("R01 starts at actual equipment ports and keeps fire, domestic water, power and data sources distinct", () => {
  for (const r of r01.routes.filter((r) => r.from)) {
    const asset = model.equipment.assets.find(
        (a) => a.definition.assetId === r.from.assetId,
      ),
      port = asset.portRecords.find((p) => p.name === r.from.port);
    assert.ok(
      new THREE.Vector3(...r.points[0]).distanceTo(
        port.object.getWorldPosition(new THREE.Vector3()),
      ) < 1e-6,
      r.id,
    );
  }
  assert.equal(byId("G-FP-TO-FR-01").from.assetId, "FP-01");
  for (const k of ["WL", "WR"])
    assert.equal(byId(`G-BOOSTER-TO-${k}`).from.assetId, "BS-G-01");
  assert.equal(byId("G-MDB-POWER-RISER-R01").from.assetId, "MDB-G-01");
  assert.equal(byId("G-SERVER-DATA-RISER-R01").from.assetId, "SR-G-01");
  assert.equal(byId("G-BMS-DATA-R01").from.port, "NETWORK / BMS");
  assert.ok(
    !r01.routes
      .filter((r) => r.system === "alarm")
      .some((r) => r.from?.assetId === "SR-G-01"),
  );
  assert.ok(
    r01.assets.every(
      (a) => a.data.connected === false && a.data.controlAvailable === false,
    ),
  );
});

test("each floor has one FR reservation, floor controls, test/drain intent and separate dry compartments", () => {
  for (const f of FLOORS) {
    for (const id of [
      "FR-01",
      "WL",
      "WR",
      "DR-POWER",
      "DR-DATA",
      "DR-FA",
      "HVAC-REF",
    ])
      assert.ok(r01.reservations.some((r) => r.id === `${id}-${f.prefix}`));
    assert.ok(r01.assets.some((a) => a.id === `FC-${f.prefix}-01`));
    assert.equal(byId(`FC-${f.prefix}-01-TEST-DRAIN`).pending, true);
    const fr = SERVICE_RESERVATIONS.fire,
      wl = SERVICE_RESERVATIONS.wetLeft;
    assert.ok(Math.abs(fr.x - wl.x) > (fr.w + wl.w) / 2);
    for (const code of ["POWER", "DATA", "FA"])
      assert.ok(byId(`${f.prefix}-DR-${code}-RISER`).pending);
  }
  const wet = SERVICE_RESERVATIONS.wetRight,
    dry = ALL_ROOMS.find((r) => r.id === "G-R02").bounds;
  assert.ok(wet.x - wet.w / 2 > dry.x2);
});

test("all candidate corridor networks cross at the front-gallery perimeter, never the atrium void or stair cores", () => {
  for (const r of r01.routes.filter((r) => r.role === "main")) {
    for (let i = 1; i < r.points.length; i++) {
      const b = bounds(r.points[i - 1], r.points[i], r.width, r.height);
      const v = ATRIUM_VOID;
      assert.ok(
        !(b.min.x < v.x2 && b.max.x > v.x1 && b.min.z < v.z2 && b.max.z > v.z1),
        `${r.id} avoids open void`,
      );
      for (const stair of ALL_ROOMS.filter(
        (room) => room.floor === r.floor && room.furniture === "stairs",
      )) {
        const s = stair.bounds;
        assert.ok(
          !(
            b.min.x < s.x2 &&
            b.max.x > s.x1 &&
            b.min.z < s.z2 &&
            b.max.z > s.z1
          ),
          `${r.id} avoids ${stair.id}`,
        );
      }
    }
    assert.ok(
      r.points.every(
        (p) =>
          p[1] > r.floor * 4.2 + 3.2 &&
          p[1] + Math.max(r.width, r.height) / 2 + (r.insulation || 0) <
            (r.floor + 1) * 4.2 - 0.24 + 1e-6,
      ),
      `${r.id} ceiling/slab allowance`,
    );
  }
});

test("floor AHUs feed the matching ventilation mains and every retained room terminal has a connected R01 branch", () => {
  for (const f of FLOORS)
    for (const s of ["supply", "return"]) {
      const mains = r01.routes.filter(
          (r) => r.system === s && r.floor === f.index && r.role === "main",
        ),
        source = byId(`${f.prefix}-AHU-${s.toUpperCase()}-R01`);
      assert.ok(
        mains.some((m) => pointOnRoute(source.points.at(-1), m)),
        source.id,
      );
      if (f.index) assert.equal(source.from.assetId, `AHU-L${f.index}-01`);
      else assert.equal(source.fromReservation, "AHU-G-RES");
    }
  assert.equal(
    r01.terminals.length,
    model.services.terminals.filter((t) => t.system !== "exhaust").length,
  );
  for (const t of r01.terminals) {
    const branch = byId(t.routeId);
    assert.deepEqual(branch.points.at(-1), t.position);
    assert.ok(
      r01.routes.some(
        (m) =>
          m.role === "main" &&
          m.system === t.system &&
          m.floor === branch.floor &&
          pointOnRoute(branch.points[0], m),
      ),
      branch.id,
    );
  }
  for (const room of ALL_ROOMS.filter((r) =>
    ["wc", "accessible-wc", "janitor"].includes(r.furniture),
  ))
    assert.ok(
      !r01.terminals.some((t) => t.roomId === room.id && t.system === "return"),
    );
});

test("refrigerant pairs reach the HVAC compartment and each example indoor unit; condensate falls continuously to local receptors", () => {
  for (const f of FLOORS)
    for (const side of ["West", "East"])
      for (const line of [0, 1]) {
        const source = byId(`${f.prefix}-${side}-VRF-${line}-TO-MAIN`);
        assert.ok(
          r01.routes.some(
            (m) =>
              m.role === "main" &&
              m.floor === f.index &&
              m.network === side &&
              m.line === line &&
              pointOnRoute(source.points.at(-1), m),
          ),
          source.id,
        );
      }
  for (const r of r01.routes.filter((r) => r.role === "example-indoor-branch"))
    assert.ok(
      r01.routes.some(
        (m) =>
          m.role === "main" &&
          m.floor === r.floor &&
          m.system === "refrigerant" &&
          m.network === r.network &&
          m.line === r.line &&
          pointOnRoute(r.points[0], m),
      ),
      r.id,
    );
  for (const r of r01.routes.filter((r) => r.role === "gravity")) {
    for (let i = 1; i < r.points.length; i++)
      assert.ok(r.points[i][1] < r.points[i - 1][1] - 1e-6, r.id);
    const receptor = r01.reservations.find((v) => v.id === r.toReservation);
    assert.ok(
      receptor && Math.abs(receptor.bounds.x - r.points.at(-1)[0]) < 1e-6,
    );
    assert.ok(
      Math.abs(r.points.at(-1)[0]) > 19,
      "local stack, no cross-atrium gravity loop",
    );
  }
});

test("new route envelopes avoid modeled structural columns and unrelated wet services avoid dedicated dry-equipment rooms", () => {
  const columns = [];
  model.root.traverse((o) => {
    if (!o.isInstancedMesh || o.userData.kind !== "structure") return;
    o.geometry.computeBoundingBox();
    for (let i = 0; i < o.count; i++) {
      const m = new THREE.Matrix4();
      o.getMatrixAt(i, m);
      m.premultiply(o.matrixWorld);
      columns.push(o.geometry.boundingBox.clone().applyMatrix4(m));
    }
  });
  const clashes = [];
  for (const r of r01.routes.filter((r) => !r.pending && !r.example))
    for (let i = 1; i < r.points.length; i++) {
      const b = bounds(
        r.points[i - 1],
        r.points[i],
        r.width + 2 * (r.insulation || 0),
        r.height + 2 * (r.insulation || 0),
      );
      if (columns.some((c) => c.intersectsBox(b)))
        clashes.push(`${r.id} segment ${i}`);
      if (
        ["cold", "hot", "waste", "condensate", "fire"].includes(r.system) &&
        Math.max(...r.points.map((p) => p[1])) >= 0
      )
        for (const room of ALL_ROOMS.filter(
          (room) =>
            room.floor === r.floor && ["G-E01", "G-I01"].includes(room.id),
        )) {
          const s = room.bounds,
            dry = new THREE.Box3(
              new THREE.Vector3(s.x1 + 0.1, room.floor * 4.2, s.z1 + 0.1),
              new THREE.Vector3(s.x2 - 0.1, room.floor * 4.2 + 4, s.z2 - 0.1),
            );
          assert.ok(!b.intersectsBox(dry), `${r.id} stays out of ${room.id}`);
        }
    }
  assert.deepEqual(clashes, []);
});

test("each service is independently toggleable, including existing sanitary geometry; hidden routes cannot intercept selection", () => {
  for (const system of Object.keys(r01.systems)) {
    applyBuildingVisibility(model, {
      ...state,
      floor: "1",
      serviceLayers: { [system]: false },
    });
    assert.ok(!isVisible(r01.layers[1][system]), system);
    assert.ok(Object.values(r01.layers[0]).every((g) => !isVisible(g)));
    assert.ok(!isVisible(model.roof));
    for (const g of model.services.terminalGroups.filter(
      (g) => g.userData.system === system,
    ))
      assert.ok(!isVisible(g));
  }
  applyBuildingVisibility(model, { ...state, floor: "1", systems: false });
  const ray = new THREE.Raycaster(
    new THREE.Vector3(-15.55, 12, 0.5),
    new THREE.Vector3(0, -1, 0),
    0,
    12,
  );
  assert.ok(
    !visibleIntersections(ray, model.root).some(
      (h) => info(h).kind === "main-service",
    ),
  );
  applyBuildingVisibility(model, state);
  assert.ok(model.services.legacyAir.every((g) => !isVisible(g)));
  assert.ok(model.equipment.connections.every((g) => !isVisible(g)));
});

test("candidate route envelopes clear other drawn systems, including retained sanitary extraction and plumbing", () => {
  const segments = [];
  const add = (r, legacy = false) => {
    for (let i = 1; i < r.points.length; i++) {
      const width = r.width || r.radius * 2;
      segments.push({
        r,
        legacy,
        bounds: bounds(
          r.points[i - 1],
          r.points[i],
          width + 2 * (r.insulation || 0),
          (r.height || width) + 2 * (r.insulation || 0),
        ),
      });
    }
  };
  for (const r of r01.routes.filter((r) => !r.pending && !r.example)) add(r);
  for (const r of model.services.routes.filter((r) => r.system === "exhaust")) {
    const prefix = /^(G|L1|L2)-/.exec(r.id)?.[1];
    add(
      {
        ...r,
        floor:
          prefix === "G" ? 0 : prefix === "L1" ? 1 : prefix === "L2" ? 2 : null,
      },
      true,
    );
  }
  for (const r of model.services.plumbing.routes)
    add(
      {
        ...r,
        system: r.system === "tempered" ? "hot" : r.system,
        floor:
          r.system === "vent"
            ? null
            : ALL_ROOMS.find((room) => room.id === r.roomId)?.floor,
      },
      true,
    );
  const clashes = new Set();
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i],
        b = segments[j];
      if (
        a.r.floor === b.r.floor &&
        a.r.system !== b.r.system &&
        !(a.legacy && b.legacy) &&
        a.bounds.intersectsBox(b.bounds)
      )
        clashes.add(`${a.r.id} / ${b.r.id}`);
    }
  assert.deepEqual([...clashes], []);
});

test("rear AHU/service connections have real cladding openings; bathroom privacy and source room doors are retained", () => {
  for (const p of SERVICE_FACADE_OPENINGS) {
    const ray = new THREE.Raycaster(
      new THREE.Vector3(p.x, p.y, -12.5),
      new THREE.Vector3(0, 0, 1),
      0,
      0.85,
    );
    const walls = ray
      .intersectObject(model.architecture.facades[p.floor].exterior, true)
      .filter((h) => ["opaque", "floor-band"].includes(info(h).kind));
    assert.equal(walls.length, 0, p.id);
  }
  assert.deepEqual(
    model.floors.map((f) => f.userData.floor),
    [0, 1, 2],
  );
  assert.equal(
    model.extinguishers.stations?.length ||
      model.extinguishers.allStations?.length,
    27,
  );
});

test("separate insulated refrigerant circuits clear each other while preserving every source-to-unit connection", () => {
  assert.deepEqual(r01.coordination.errors, []);
  assert.ok(
    r01.coordination.changes > 0,
    "Local pipe-pair offsets are applied",
  );
  const refs = r01.routes.filter((r) => r.system === "refrigerant"),
    segments = [];
  for (const r of refs) {
    assert.ok(["West", "East"].includes(r.network));
    assert.ok([0, 1].includes(r.line));
    for (let i = 1; i < r.points.length; i++)
      segments.push({
        r,
        bounds: bounds(
          r.points[i - 1],
          r.points[i],
          r.width + 2 * r.insulation,
          r.height + 2 * r.insulation,
        ),
      });
  }
  const clashes = new Set();
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i],
        b = segments[j];
      if (a.r.network === b.r.network && a.r.line === b.r.line) continue;
      const intersection = a.bounds.clone().intersect(b.bounds),
        size = intersection.getSize(new THREE.Vector3());
      if (!intersection.isEmpty() && Math.min(size.x, size.y, size.z) > 1e-6)
        clashes.add(`${a.r.id} / ${b.r.id}`);
    }
  assert.deepEqual([...clashes], []);
  for (const network of ["West", "East"])
    for (const line of [0, 1]) {
      const set = refs.filter((r) => r.network === network && r.line === line),
        source = set.find((r) => r.from),
        reached = new Set([source]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const r of set)
          if (
            !reached.has(r) &&
            [...reached].some(
              (s) =>
                r.points.some((p) => pointOnRoute(p, s)) ||
                s.points.some((p) => pointOnRoute(p, r)),
            )
          ) {
            reached.add(r);
            grew = true;
          }
      }
      assert.equal(
        reached.size,
        set.length,
        `${network} pair ${line} source, risers, mains and all indoor branches remain connected`,
      );
    }
});

test("rendered refrigerant instances use the coordinated route points, and added equipment obeys visibility controls", () => {
  const map = new Map(r01.routes.map((r) => [r.id, r]));
  let count = 0;
  for (const floor of r01.layers)
    floor.refrigerant.traverse((o) => {
      if (
        !o.isInstancedMesh ||
        o.geometry.type !== "CylinderGeometry" ||
        o.parent.userData.diagram
      )
        return;
      for (let i = 0; i < o.count; i++) {
        const d = o.userData.instances[i],
          r = map.get(d.assetId),
          matrix = new THREE.Matrix4();
        o.getMatrixAt(i, matrix);
        matrix.premultiply(o.matrixWorld);
        assert.ok(r && !r.pending, d.assetId);
        assert.ok(
          new THREE.Vector3(0, -0.5, 0)
            .applyMatrix4(matrix)
            .distanceTo(new THREE.Vector3(...r.points[d.segment])) < 1e-4,
          d.assetId,
        );
        assert.ok(
          new THREE.Vector3(0, 0.5, 0)
            .applyMatrix4(matrix)
            .distanceTo(new THREE.Vector3(...r.points[d.segment + 1])) < 1e-4,
          d.assetId,
        );
        count++;
      }
    });
  assert.equal(
    count,
    r01.routes
      .filter((r) => r.system === "refrigerant" && !r.pending)
      .reduce((n, r) => n + r.points.length - 1, 0),
  );
  applyBuildingVisibility(model, {
    ...state,
    floor: "0",
    serviceLayers: { supply: false, return: true },
  });
  assert.ok(
    isVisible(r01.groundPlant),
    "Return-only inspection retains its shared AHU body",
  );
  applyBuildingVisibility(model, { ...state, equipment: false });
  assert.ok(!isVisible(r01.groundPlant));
  assert.ok(
    r01.assets
      .filter((a) => a.role === "indoor-reservation")
      .every((a) => !isVisible(a.object)),
  );
  applyBuildingVisibility(model, { ...state, systems: false });
  assert.ok(!isVisible(r01.groundPlant));
  applyBuildingVisibility(model, state);
});

test("yard refrigerant connections rise beside the casing and leave the modeled maintenance aisles clear", () => {
  for (const clearance of model.equipment.clearances) {
    const working = new THREE.Box3().setFromObject(clearance.object);
    for (const r of r01.routes.filter(
      (r) =>
        r.system === "refrigerant" && r.from?.assetId === clearance.assetId,
    ))
      for (let i = 1; i < r.points.length; i++) {
        const allowance = r.width + 2 * r.insulation;
        const intersection = bounds(
            r.points[i - 1],
            r.points[i],
            allowance,
          ).intersect(working),
          size = intersection.getSize(new THREE.Vector3());
        assert.ok(
          intersection.isEmpty() || Math.min(size.x, size.y, size.z) < 1e-6,
          `${r.id} avoids the condenser working space`,
        );
      }
  }
});

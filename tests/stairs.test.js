import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createAtriumBuilding } from "../projects/atrium-building/model.js";
import { ALL_ROOMS, ENVELOPE } from "../projects/atrium-building/layout.js";
import {
  visibleIntersections,
  applyBuildingVisibility,
} from "../projects/atrium-building/visibility.js";
import { ROOF_LANDING_Y } from "../projects/atrium-building/stairs.js";

const model = createAtriumBuilding();
model.root.updateMatrixWorld(true);
applyBuildingVisibility(model, {
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
});
const ray = (x, y, z, direction, far) =>
  new THREE.Raycaster(
    new THREE.Vector3(x, y, z),
    new THREE.Vector3(...direction),
    0,
    far,
  );
const near = (a, b) => Math.abs(a - b) < 0.0001;
function floorAt(x, y, z, surfaces) {
  const hits = ray(x, y + 0.08, z, [0, -1, 0], 0.2).intersectObjects(
    surfaces,
    true,
  );
  assert.ok(
    hits.length && near(hits[0].point.y, y),
    `Missing level landing at ${x},${y},${z}`,
  );
}

test("both stair doors have a complete level landing and unobstructed threshold on every occupied floor", () => {
  assert.equal(model.stairCores.length, 6);
  for (const stair of model.stairCores) {
    const room = ALL_ROOMS.find((r) => r.id === stair.roomId);
    const door = room.doors.find((d) => !d.exterior);
    const west = room.bounds.x1 < 0,
      wallX = west ? room.bounds.x2 : room.bounds.x1;
    const floor = model.floors[stair.floor];
    const surfaces = [
      ...floor.children.filter((m) => m.userData.kind === "slabs"),
      stair.root,
    ];
    for (const z of [
      door.at - door.width * 0.4,
      door.at,
      door.at + door.width * 0.4,
    ]) {
      for (const distance of [-0.3, 0.1, 0.5, 1.0])
        floorAt(
          wallX + (west ? -distance : distance),
          stair.bottom,
          z,
          surfaces,
        );
    }
    // Crossing the doorway at both torso and eye height must not hit a railing, leaf or wall.
    for (const h of [0.8, 1.7]) {
      const hits = visibleIntersections(
        ray(
          wallX + (west ? 0.5 : -0.5),
          stair.bottom + h,
          door.at,
          [west ? -1 : 1, 0, 0],
          1.8,
        ),
        model.root,
      );
      assert.equal(hits.length, 0, `${room.id} clear doorway at floor datum`);
    }
    // Walk from the threshold across the landing to each flight mouth at the same height.
    for (
      let x = stair.floorLanding.x1 + 0.2;
      x < stair.floorLanding.x2 - 0.1;
      x += 0.25
    )
      floorAt(x, stair.bottom, door.at, surfaces);
  }
});

test("tread tops meet real half-landings, next-floor landings and roof deck without gaps or height offsets", () => {
  for (const stair of model.stairCores) {
    const floor = stair.floor;
    const next =
      floor === 2
        ? stair
        : model.stairCores.find(
            (s) => s.floor === floor + 1 && near(s.centerX, stair.centerX),
          );
    assert.ok(near(stair.top, floor === 2 ? ROOF_LANDING_Y : next.bottom));
    const flightSurface = [stair.root, ...(floor < 2 ? [next.root] : [])];
    for (const flight of [0, 1]) {
      const x =
        stair.centerX + (flight === 0 ? -stair.laneOffset : stair.laneOffset);
      const base = flight === 0 ? stair.bottom : stair.middle;
      const zStart =
        flight === 0 ? stair.floorLanding.z1 : stair.turnLanding.z2;
      const sign = flight === 0 ? -1 : 1;
      for (let i = 0; i < stair.risers - 1; i++) {
        const z = zStart + sign * (i + 0.5) * stair.treadDepth;
        const y = base + (i + 1) * stair.rise;
        floorAt(x, y, z, flightSurface);
        const head = visibleIntersections(
          ray(x, y + 0.1, z, [0, 1, 0], 1.9),
          model.root,
        );
        assert.equal(
          head.length,
          0,
          `${stair.roomId} flight ${flight} tread ${i} overhead obstruction`,
        );
      }
      const landingZ =
        flight === 0
          ? stair.turnLanding.z2 - 0.15
          : stair.floorLanding.z1 + 0.15;
      floorAt(
        x,
        flight === 0 ? stair.middle : stair.top,
        landingZ,
        flightSurface,
      );
    }
  }
});

test("ground exits connect directly to the full-floor landings and clear exterior paths", () => {
  for (const stair of model.stairCores.filter((s) => s.floor === 0)) {
    const room = ALL_ROOMS.find((r) => r.id === stair.roomId),
      door = room.doors.find((d) => d.exterior);
    const west = room.bounds.x1 < 0,
      wallX = west ? room.bounds.x1 : room.bounds.x2;
    assert.equal(door.side, west ? "W" : "E");
    assert.ok(door.at - door.width / 2 > stair.floorLanding.z1);
    for (const h of [0.6, 1.7]) {
      const hits = visibleIntersections(
        ray(
          wallX + (west ? 0.5 : -0.5),
          h,
          door.at,
          [west ? -1 : 1, 0, 0],
          3.5,
        ),
        model.root,
      );
      assert.equal(
        hits.length,
        0,
        `${room.id} ground exit reaches clear paving`,
      );
    }
  }
});

test("roof access door and walkway meet the stair arrival at one level", () => {
  for (const access of model.architecture.roofAccess) {
    assert.ok(near(access.floorY, ROOF_LANDING_Y));
    const stair = model.stairCores.find((s) => s.roomId === access.roomId);
    const surfaces = [stair.root, model.architecture.wingRoofs];
    for (let z = stair.floorLanding.z1 + 0.1; z < -3.5; z += 0.12)
      floorAt(access.door.x, ROOF_LANDING_Y, z, surfaces);
    const hits = visibleIntersections(
      ray(
        access.door.x,
        ROOF_LANDING_Y + 1,
        access.door.z - 0.4,
        [0, 0, 1],
        1.1,
      ),
      model.root,
    );
    assert.equal(
      hits.length,
      0,
      `${access.roomId} roof doorway opens onto walkway`,
    );
  }
  assert.equal(model.floors.length, 3);
  assert.equal(ENVELOPE.floorHeight, 4.2);
});

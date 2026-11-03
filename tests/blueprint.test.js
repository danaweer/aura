import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { BlueprintPresentation } from "../projects/atrium-building/blueprint.js";
import { createAtriumBuilding } from "../projects/atrium-building/model.js";
import {
  applyBuildingVisibility,
  visibleIntersections,
} from "../projects/atrium-building/visibility.js";
import { isVisible } from "../projects/atrium-building/geometry.js";

const model = createAtriumBuilding(),
  scene = new THREE.Scene();
scene.background = new THREE.Color(0xdce6ed);
scene.fog = new THREE.Fog(0xdce6ed, 95, 180);
scene.add(model.root);
const presentation = new BlueprintPresentation(scene, model.root);
const state = {
  floor: "1",
  view: "plan",
  roof: true,
  ceilings: true,
  systems: true,
  devices: true,
  deviceCategories: {},
  partitions: true,
  furniture: true,
  glass: true,
  equipment: true,
  serviceLayers: { fire: false },
};

test("Blueprint restores shared original materials and scene state, even after a failed draw", () => {
  const original = { ...presentation.normal };
  presentation.setEnabled(true);
  const architectural = presentation.records.find((r) =>
    r.mesh.userData.instances?.some((d) => d.kind === "partition"),
  );
  const pipe = presentation.records.find(
    (r) =>
      r.mesh.userData.kind === "main-service" ||
      r.mesh.userData.instances?.some((d) => d.kind === "main-service"),
  );
  const renderer = {
    shadowMap: { enabled: true },
    render() {
      assert.equal(architectural.mesh.material, architectural.blueprint);
      assert.equal(pipe.mesh.material, pipe.blueprint);
      assert.equal(renderer.shadowMap.enabled, false);
      throw new Error("draw failed");
    },
  };
  assert.throws(
    () => presentation.render(renderer, new THREE.PerspectiveCamera()),
    /draw failed/,
  );
  assert.ok(presentation.records.every((r) => r.mesh.material === r.original));
  assert.equal(renderer.shadowMap.enabled, true);
  presentation.setEnabled(false);
  assert.equal(scene.background, original.background);
  assert.equal(scene.fog, original.fog);
  assert.equal(scene.environment, original.environment);
});

test("cached crease edges preserve instanced transforms and equipment bounds without duplicating on repeated switches", () => {
  const equipment = model.equipment.assets.find(
    (a) => a.definition.assetId === "FP-01",
  );
  // Compare with overlays detached, then reattach; camera fit must not expand to unit origins.
  const parents = presentation.overlays.map((o) => o.parent);
  presentation.overlays.forEach((o) => o.removeFromParent());
  const before = new THREE.Box3().setFromObject(equipment.object);
  presentation.overlays.forEach((o, i) => parents[i].add(o));
  assert.deepEqual(new THREE.Box3().setFromObject(equipment.object), before);
  const count = presentation.overlays.length,
    resources = presentation.resources.size;
  for (let i = 0; i < 12; i++) {
    presentation.setEnabled(true);
    presentation.setEnabled(false);
  }
  assert.equal(presentation.overlays.length, count);
  assert.equal(presentation.resources.size, resources);
  const outline = presentation.overlays.find((o) => o.parent.isInstancedMesh);
  assert.equal(outline.geometry.instanceCount, outline.parent.count);
  const matrix = new THREE.Matrix4();
  outline.parent.getMatrixAt(0, matrix);
  const columns = [0, 1, 2, 3].flatMap((i) => {
    const a = outline.geometry.getAttribute(`bp${i}`);
    return [a.getX(0), a.getY(0), a.getZ(0), a.getW(0)];
  });
  assert.deepEqual(columns, matrix.toArray());
  assert.ok(
    outline.geometry.getAttribute("position").count <
      outline.parent.geometry.getAttribute("position").count * 3,
  );
});

test("Blueprint obeys floor and service visibility, preserves picking, and highlights only visible stable assets", () => {
  applyBuildingVisibility(model, state);
  const device = model.devices.assets.find((a) => a.assetId === "Q-L1-07-01");
  model.root.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(...device.position).add(
      new THREE.Vector3(...device.normal),
    ),
    new THREE.Vector3(...device.normal).negate(),
    0,
    1.2,
  );
  const before = visibleIntersections(ray, model.root).map(
    (h) => h.object.uuid + ":" + h.instanceId,
  );
  presentation.setEnabled(true);
  assert.deepEqual(
    visibleIntersections(ray, model.root).map(
      (h) => h.object.uuid + ":" + h.instanceId,
    ),
    before,
  );
  assert.ok(
    presentation.overlays
      .filter((o) => o.parent.userData.floor === 0)
      .every((o) => !isVisible(o)),
  );
  assert.equal(isVisible(model.mainServices.layers[1].fire), false);
  presentation.select(device.data);
  presentation.updateHighlight();
  assert.equal(presentation.highlight.visible, true);
  applyBuildingVisibility(model, { ...state, floor: "0" });
  presentation.updateHighlight();
  assert.equal(presentation.highlight.visible, false);
  presentation.setEnabled(false);
});

test("disposing Blueprint releases only its own resources and removes every overlay", () => {
  let originalDisposals = 0,
    disposed = 0;
  for (const r of presentation.records)
    r.original.addEventListener?.("dispose", () => originalDisposals++);
  for (const r of presentation.resources)
    r.addEventListener("dispose", () => disposed++);
  const count = presentation.resources.size,
    overlays = [...presentation.overlays];
  presentation.dispose();
  assert.equal(disposed, count);
  assert.equal(originalDisposals, 0);
  assert.ok(overlays.every((o) => o.parent === null));
  assert.equal(presentation.records.length, 0);
});

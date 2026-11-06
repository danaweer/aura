import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EQUIPMENT } from "../projects/atrium-building/equipment-plan.js";
import { ALL_ROOMS } from "../projects/atrium-building/layout.js";

test("canonical maintenance pilot catalog maps to the current model IDs and metadata", () => {
  const catalog = JSON.parse(
    readFileSync(
      new URL(
        "../projects/atrium-building/maintenance-assets.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(catalog.schema_version, 1);
  assert.deepEqual(catalog.assets.map((a) => a.asset_id).sort(), [
    "AHU-L1-01",
    "BS-G-01",
    "FP-01",
  ]);
  for (const asset of catalog.assets) {
    const equipment = EQUIPMENT.find((a) => a.assetId === asset.asset_id);
    assert.ok(equipment, `Asset mapping error: ${asset.asset_id}`);
    assert.equal(asset.project_id, "atrium-building");
    assert.equal(asset.name, equipment.label);
    assert.equal(asset.system, equipment.system);
    assert.equal(asset.room_id, equipment.roomId);
    assert.equal(asset.floor, equipment.floor);
    assert.equal(
      asset.model_ref,
      `projects/atrium-building/equipment-plan.js#${equipment.assetId}`,
    );
    assert.equal(equipment.connected, false);
    assert.equal(asset.commissioning_state, "not_connected");
  }
});

test("reporting room registry matches the current model's project, room IDs and floors", () => {
  const catalog = JSON.parse(
    readFileSync(
      new URL(
        "../projects/atrium-building/maintenance-rooms.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const sort = (rows) =>
    rows.sort((a, b) => a.room_id.localeCompare(b.room_id));
  assert.equal(catalog.schema_version, 1);
  assert.deepEqual(
    sort(catalog.rooms),
    sort(
      ALL_ROOMS.map((r) => ({
        project_id: "atrium-building",
        room_id: r.id,
        name: r.name,
        floor: r.floor,
      })),
    ),
  );
});

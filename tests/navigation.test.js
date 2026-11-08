import test from "node:test";
import assert from "node:assert/strict";
import {
  applicationRoute,
  APPLICATION_PAGES,
  ProjectLibrary,
} from "../project-ui.js";

test("application routes preserve canonical project/asset/room IDs and maintenance section", () => {
  assert.deepEqual(
    applicationRoute(
      "#maintenance?project_id=atrium-building&asset_id=AHU-L1-01&room_id=L1-M01&section=work-orders",
    ),
    {
      page: "maintenance",
      params: {
        project_id: "atrium-building",
        asset_id: "AHU-L1-01",
        room_id: "L1-M01",
        section: "work-orders",
      },
    },
  );
  assert.equal(
    applicationRoute("#maintenance?asset_id=FP-01").params.asset_id,
    "FP-01",
  );
  for (const page of Object.keys(APPLICATION_PAGES))
    assert.equal(applicationRoute(`#${page}`).page, page);
  assert.equal(applicationRoute("#project/atrium-building"), null);
  assert.equal(applicationRoute("#projects"), null);
  assert.equal(applicationRoute("#not-a-page"), null);
});

test("account pages remain navigable without project grants", () => {
  const previous = globalThis.location;
  const calls = [];
  const library = {
    projects: [],
    onPage: (page) => calls.push(page),
    show: () => calls.push("projects"),
  };
  try {
    globalThis.location = { hash: "#users-access" };
    ProjectLibrary.prototype.route.call(library);
    assert.deepEqual(calls, ["users-access"]);
    globalThis.location.hash = "#project/atrium-building";
    ProjectLibrary.prototype.route.call(library);
    assert.deepEqual(calls, ["users-access", "projects"]);
  } finally {
    if (previous === undefined) delete globalThis.location;
    else globalThis.location = previous;
  }
});

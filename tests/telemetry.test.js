import test from "node:test";
import assert from "node:assert/strict";
import { TelemetrySession, mergeSamples, chartSegments } from "../telemetry.js";

function message(version = 1, changes = {}) {
  return {
    stream_id: "session",
    version,
    kind: "telemetry",
    simulated: false,
    interval_seconds: 1,
    stale_after_seconds: 5,
    data: {
      quality: { state: "fresh", reason: "Current" },
      status: { sample_age_seconds: 0 },
    },
    ...changes,
  };
}
function sample(id, seconds, quality = "fresh", temperature = 24) {
  const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();
  return {
    id,
    observed_at: stamp,
    sampled_at: stamp,
    temperature_c: temperature,
    quality,
  };
}

test("stream failure immediately removes online status", () => {
  const state = new TelemetrySession();
  state.accept(message(), 1000);
  assert.equal(state.status(1000).state, "fresh");
  state.disconnect();
  assert.equal(state.status(1001).state, "stream_offline");
});

test("an old server snapshot is already stale when first received", () => {
  const state = new TelemetrySession();
  state.accept(message(1, { publication_age_seconds: 60 }), 100000);
  assert.equal(state.status(100000).state, "stream_stale");
});

test("silent stream stalls and sensor age expires without a disconnect event", () => {
  const state = new TelemetrySession();
  state.accept(message(), 1000);
  assert.equal(state.status(7000).state, "stream_stale");
  state.accept(
    message(2, {
      data: { quality: { state: "fresh" }, status: { sample_age_seconds: 4 } },
    }),
    8000,
  );
  assert.equal(state.status(10000).state, "stale");
});

test("offline, fault, unknown, and stale sensor states remain distinct", () => {
  for (const quality of ["fault", "unknown", "stale", "unavailable"]) {
    const state = new TelemetrySession();
    state.accept(
      message(1, { data: { quality: { state: quality }, status: {} } }),
      0,
    );
    assert.equal(state.status(0).state, quality);
  }
  const state = new TelemetrySession();
  state.accept(message(1, { kind: "offline", reason: "No response" }), 0);
  assert.equal(state.status(0).state, "offline");
});

test("out-of-order and duplicate messages cannot overwrite newer state", () => {
  const state = new TelemetrySession();
  assert.equal(state.accept(message(2), 1000), true);
  assert.equal(state.accept(message(1, { kind: "offline" }), 2000), false);
  assert.equal(state.accept(message(2), 3000), false);
  assert.equal(state.lastReceivedAt, 1000);
  assert.equal(state.status(3000).state, "fresh");
  assert.equal(
    state.accept(message(1, { stream_id: "restarted" }), 4000),
    true,
  );
  assert.equal(state.version, 1);
});

test("sampling and replay merge by stable ID without moving old readings forward", () => {
  const first = sample("one", 1);
  const repeated = sample("one", 30, "stale");
  const merged = mergeSamples([first], [repeated, sample("two", 2)]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].sampled_at, first.sampled_at);
  assert.deepEqual(mergeSamples(merged, [first]), merged);
});

test("history sorts retained samples, bounds memory, and rejects invalid timestamps", () => {
  const merged = mergeSamples(
    [sample("b", 2)],
    [sample("a", 1), sample("c", 3), { id: "bad", observed_at: "invalid" }],
    2,
  );
  assert.deepEqual(
    merged.map((row) => row.id),
    ["b", "c"],
  );
});

test("chart preserves outages, invalid readings, and quality changes as gaps", () => {
  const samples = [
    sample("a", 0),
    sample("b", 1),
    sample("gap", 2, "offline", null),
    sample("c", 3),
    sample("d", 20),
    sample("e", 21, "unknown"),
    sample("f", 22, "fault"),
  ];
  const segments = chartSegments(samples, 3000);
  assert.deepEqual(
    segments.map((segment) => segment.length),
    [2, 1, 1, 1],
  );
  assert.equal(segments[2][0].at - segments[1][0].at, 17000);
  assert.equal(segments[3][0].quality, "unknown");
});

test("chart shows a gap across server restarts even when the outage was short", () => {
  const samples = [
    { ...sample("a", 0), session_id: "first-process" },
    { ...sample("b", 1), session_id: "second-process" },
  ];
  assert.deepEqual(
    chartSegments(samples, 3000).map((segment) => segment.length),
    [1, 1],
  );
});

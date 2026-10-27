/* Telemetry state and history helpers shared by the UI and regression tests. */
export class TelemetrySession {
  constructor() {
    this.streamId = null;
    this.version = -1;
    this.lastReceivedAt = null;
    this.lastPublishedAt = null;
    this.connected = false;
    this.latest = null;
    this.timeoutMs = 5000;
  }

  accept(message, now = Date.now()) {
    if (!message || !Number.isInteger(message.version) || !message.stream_id)
      return false;
    if (message.stream_id !== this.streamId) {
      this.streamId = message.stream_id;
      this.version = -1;
    }
    if (message.version <= this.version) return false;
    this.version = message.version;
    this.lastReceivedAt = now;
    const age = Number.isFinite(message.publication_age_seconds)
      ? Math.max(0, message.publication_age_seconds)
      : 0;
    this.lastPublishedAt = now - age * 1000;
    this.connected = true;
    this.latest = message;
    this.timeoutMs = Math.max(5000, (message.interval_seconds || 1) * 3000);
    return true;
  }

  disconnect() {
    this.connected = false;
  }

  status(now = Date.now()) {
    if (!this.connected)
      return {
        state: "stream_offline",
        reason: "Stream reconnecting; current device state is unknown",
      };
    if (now - this.lastPublishedAt > this.timeoutMs)
      return {
        state: "stream_stale",
        reason: "No recent updates from the server",
      };
    if (this.latest?.kind === "offline")
      return {
        state: "offline",
        reason: this.latest.reason || "Device did not respond",
      };
    const data = this.latest?.data;
    if (!data) return { state: "unavailable", reason: "Awaiting telemetry" };
    const age = data.status?.sample_age_seconds;
    if (
      typeof age === "number" &&
      age + (now - this.lastPublishedAt) / 1000 >
        this.latest.stale_after_seconds
    ) {
      return { state: "stale", reason: "The latest sensor sample is stale" };
    }
    return (
      data.quality || {
        state: "unknown",
        reason: "Sensor quality is unverified",
      }
    );
  }
}

export function mergeSamples(existing, incoming, limit = 60) {
  const unique = new Map();
  // Preserve the original observation of a measurement; repeated sequence IDs
  // must not move an old measurement forward in time.
  for (const sample of [...existing, ...incoming]) {
    if (
      sample?.id &&
      Number.isFinite(Date.parse(sample.observed_at)) &&
      Number.isFinite(Date.parse(sample.sampled_at)) &&
      !unique.has(sample.id)
    ) {
      unique.set(sample.id, sample);
    }
  }
  return [...unique.values()]
    .sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at))
    .slice(-limit);
}

export function chartSegments(samples, gapMs) {
  const segments = [];
  let current = [];
  for (const sample of samples) {
    const at = Date.parse(sample.sampled_at);
    const valid =
      Number.isFinite(at) &&
      Number.isFinite(sample.temperature_c) &&
      ["fresh", "unknown"].includes(sample.quality);
    if (!valid) {
      current = [];
      continue;
    }
    const previous = current.at(-1);
    if (
      !previous ||
      at - previous.at > gapMs ||
      at < previous.at ||
      (previous.sessionId &&
        sample.session_id &&
        previous.sessionId !== sample.session_id) ||
      previous.quality !== sample.quality
    ) {
      current = [];
      segments.push(current);
    }
    current.push({
      at,
      value: sample.temperature_c,
      quality: sample.quality,
      sessionId: sample.session_id,
    });
  }
  return segments;
}

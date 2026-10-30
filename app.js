/* aura Meeting Room Digital Twin. Self-contained Canvas2D perspective renderer. */
import { FLOORS, ROOM_COUNT } from "./projects/atrium-building/layout.js";
import { ProjectLibrary, renderProjectDetails } from "./project-ui.js";
import { buildMeetingRoom } from "./projects/meeting-room/model.js";
import { TelemetrySession, mergeSamples, chartSegments } from "./telemetry.js";
import { ViewerFullscreen } from "./viewer-fullscreen.js";

const $ = (id) => document.getElementById(id);
const scene = $("scene");
const canvas = $("roomCanvas");
const ctx = canvas.getContext("2d");
const chartCanvas = $("trendCanvas");
const chart = chartCanvas.getContext("2d");
const session = new TelemetrySession();
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let angle = 0.69,
  elevation = 0.69,
  distance = 17.2;
let roomOn = true,
  tagsOn = true,
  viewTop = false,
  sceneDirty = true;
let isDragging = false,
  lastPointer = null;
let alarmOn = null,
  latest = null,
  lastOnline = false,
  simulation = false;
let renderStamp = 0,
  lastKnownAlarm = null,
  statusKey = "";
let selectedAsset = "mxchip";
let activeProject = null,
  buildingViewer = null,
  projectRequest = 0,
  library = null;
let history = [],
  historyRequest = 0,
  sourceKey = null,
  gapMs = 3000;
let historyAvailable = false;
let room = {
  name: "Meeting room / 01",
  code: "MR-01",
  location: "Building A · Level 01",
  width_m: 11.2,
  depth_m: 8.2,
  height_m: 3.72,
  sensor_position: { x: 0.38, y: 0.78, z: 0.2 },
};
const timeline = new Map();
const fmt = (value, decimals = 1) =>
  Number.isFinite(value) ? value.toFixed(decimals) : "—";
const val = (id, value, decimals = 1) => {
  $(id).textContent = fmt(value, decimals);
};
const pad = (n) => String(n).padStart(2, "0");
const clock = () => {
  $("clock").textContent = new Date().toLocaleTimeString();
};
clock();
setInterval(() => {
  clock();
  renderStatus();
}, 1000);

function addEvent(
  label,
  type = "neutral",
  stamp = new Date(),
  id = `local:${Date.now()}:${Math.random()}`,
) {
  if (timeline.has(id) || !Number.isFinite(stamp.getTime())) return;
  const el = document.createElement("div");
  el.className = "event-item";
  el.dataset.at = String(stamp.getTime());
  const tm = document.createElement("time");
  tm.className = "event-time";
  tm.dateTime = stamp.toISOString();
  tm.title = stamp.toLocaleString();
  tm.textContent = `${pad(stamp.getHours())}:${pad(stamp.getMinutes())}:${pad(stamp.getSeconds())}`;
  const dot = document.createElement("span");
  dot.className = "event-dot " + type;
  dot.setAttribute("aria-hidden", "true");
  const desc = document.createElement("span");
  desc.className = "event-message";
  desc.textContent = label;
  el.append(tm, dot, desc);
  const log = $("eventList");
  if (!timeline.size) log.replaceChildren();
  const before = [...log.children].find(
    (item) => Number(item.dataset.at) < stamp.getTime(),
  );
  log.insertBefore(el, before || null);
  timeline.set(id, el);
  while (log.children.length > 100) {
    const oldest = log.lastChild;
    for (const [key, node] of timeline)
      if (node === oldest) timeline.delete(key);
    oldest.remove();
  }
}

function addAlarmEvent(event) {
  if (!event.id || typeof event.alarm_on !== "boolean") return;
  addEvent(
    `${event.simulated ? "Simulated alarm" : "Button A · demo alarm"} ${event.alarm_on ? "ON" : "OFF"}`,
    event.alarm_on ? "alarm" : "normal",
    new Date(event.at),
    event.id,
  );
}

function setAlarm(status, reason = "") {
  alarmOn = status;
  const active = status === true;
  $("alarmCard").classList.toggle("active", active);
  $("markerAlarm").classList.toggle("triggered", active);
  $("alarmBadge").textContent =
    status === null ? "UNKNOWN" : active ? "ON" : "OFF";
  $("alarmHeadline").textContent =
    status === null
      ? "Current alarm state unavailable"
      : active
        ? "DEMO alarm activated"
        : "Normal · no demo alarm";
  $("alarmHint").textContent =
    status === null
      ? reason +
        (lastKnownAlarm
          ? ` Last known: ${lastKnownAlarm.on ? "ON" : "OFF"} at ${new Date(lastKnownAlarm.at).toLocaleTimeString()}.`
          : "")
      : simulation
        ? "Software simulation only. This is not a real fire detection event."
        : "Physical Button A controls the MXCHIP demo alarm register.";
  $("markerAlarmText").textContent =
    status === null ? "—" : active ? "ON" : "OFF";
  sceneDirty = true;
}

function setMode(demo) {
  simulation = !!demo;
  if (!isRoomOpen()) return;
  $("modeChip").classList.toggle("simulated", simulation);
  $("modeChip").textContent = simulation ? "SIMULATED MODE" : "LIVE DEVICE";
  $("demoAlarmBtn").hidden = !simulation;
  $("sensorCount").textContent = simulation
    ? "1 SIMULATED SENSOR"
    : "1 CONNECTED SENSOR";
  $("inspectorLabel").textContent =
    selectedAsset === "hvac"
      ? "MODEL ASSET"
      : simulation
        ? "SIMULATED ASSET"
        : "CONNECTED ASSET";
  $("sceneHelp").textContent = simulation
    ? "SIMULATED DATA · Telemetry and alarm signals are generated in software. Room model is illustrative."
    : "This room is illustrative. Only MXCHIP telemetry and its demo alarm are connected to the physical device.";
}

function renderStatus() {
  if (!isRoomOpen()) return;
  const { state, reason } = session.status();
  const labels = {
    fresh: [
      simulation ? "SIMULATED STREAM" : "DEVICE ONLINE",
      simulation ? "SIMULATED" : "LIVE",
    ],
    stale: ["CONNECTED · SENSOR STALE", "STALE"],
    fault: ["CONNECTED · SENSOR FAULT", "SENSOR FAULT"],
    unavailable: ["CONNECTED · DATA UNAVAILABLE", "UNAVAILABLE"],
    unknown: ["CONNECTED · QUALITY UNVERIFIED", "UNVERIFIED"],
    offline: ["DEVICE OFFLINE", "NO SIGNAL"],
    stream_offline: ["STREAM RECONNECTING", "NO SIGNAL"],
    stream_stale: ["STREAM STALLED", "STALE"],
  };
  const [label, quality] = labels[state] || labels.unknown;
  const connected = !["offline", "stream_offline", "stream_stale"].includes(
    state,
  );
  $("connState").className =
    "connection-status " +
    (state === "fresh" ? "online" : connected ? "warning" : "offline");
  if ($("connLabel").textContent !== label) $("connLabel").textContent = label;
  $("quality").className =
    "reading-quality" + (state === "fresh" ? " good" : "");
  $("qualityText").textContent = quality;
  $("quality").title = reason;
  $("inspectorPanel").classList.toggle("readings-stale", state !== "fresh");
  $("markerSensor").classList.toggle("stale", state !== "fresh");
  const stamp = latest
    ? new Date(latest.observed_at).toLocaleTimeString()
    : "none";
  $("sceneSync").textContent =
    state === "fresh" ? `SYNCED ${stamp}` : `${quality} · LAST ${stamp}`;
  const age = latest?.status?.sample_age_seconds;
  $("lastReading").textContent =
    `${reason}${latest ? ` · last read ${stamp}` : ""}${age != null ? ` · reported sample age ${age}s` : ""}`;
  const alarmValid =
    connected &&
    state !== "stale" &&
    typeof latest?.status?.alarm_on === "boolean";
  const nextKey = `${state}:${alarmValid ? latest.status.alarm_on : "unknown"}:${reason}:${simulation}`;
  if (nextKey !== statusKey) {
    setAlarm(alarmValid ? latest.status.alarm_on : null, reason);
    statusKey = nextKey;
  }
}

function setReading(data) {
  if (!data?.online) return;
  latest = data;
  const e = data.environment || {},
    s = data.status || {},
    m = data.motion || {};
  setMode(data.simulated);
  if (data.device)
    $("deviceIp").textContent = simulation
      ? "SIMULATED DEVICE"
      : `${data.device.ip}:${data.device.port} · unit ${data.device.unit_id}`;
  val("temperature", e.temperature_c);
  val("humidity", e.humidity_pct);
  val("pressure", e.pressure_hpa);
  $("markerTemp").textContent =
    e.temperature_c == null ? "—" : `${fmt(e.temperature_c)}°C`;
  val("rssi", s.wifi_rssi_dbm, 0);
  val("uptime", s.uptime_seconds_16bit, 0);
  const a = m.acceleration_mg || {};
  val("ax", a.x, 0);
  val("ay", a.y, 0);
  val("az", a.z, 0);
  const meter = (id, value) => {
    $(id).style.width = Number.isFinite(value)
      ? `${Math.min(100, Math.max(0, value))}%`
      : "0%";
  };
  meter("humidityMeter", e.humidity_pct);
  meter(
    "pressureMeter",
    e.pressure_hpa == null ? null : ((e.pressure_hpa - 960) / 90) * 100,
  );
  meter(
    "rssiMeter",
    s.wifi_rssi_dbm == null ? null : (s.wifi_rssi_dbm + 100) * 2,
  );
  meter(
    "uptimeMeter",
    s.uptime_seconds_16bit == null ? null : s.uptime_seconds_16bit / 36,
  );
  $("tempTrend").textContent = simulation
    ? "SIMULATED SENSOR VALUES"
    : "FROM PHYSICAL MXCHIP";
  $("firmwareMode").textContent =
    data.mode === "temperature-only"
      ? "Temperature-only firmware · freshness unverified"
      : `${simulation ? "Simulated" : "Full"} register map · version ${s.register_map_version ?? "unknown"}`;
  $("sensorHealth").textContent =
    (s.sensor_health || [])
      .map(
        (item) =>
          `${item.name}: ${item.ok === true ? "OK" : item.ok === false ? "FAULT" : "unverified"}`,
      )
      .join(" · ") || "Sensor health unavailable";
  if (data.quality?.state !== "stale" && typeof s.alarm_on === "boolean")
    lastKnownAlarm = { on: s.alarm_on, at: data.observed_at };
  history = mergeSamples(history, data.sample ? [data.sample] : []);
  drawTrend();
  if (!lastOnline)
    addEvent(
      simulation
        ? "Simulated device stream connected"
        : "MXCHIP connected · Modbus FC04 responding",
      "normal",
    );
  lastOnline = true;
}

function receive(payload) {
  if (!session.accept(payload)) return;
  setMode(payload.simulated);
  gapMs = Math.max(1500, payload.interval_seconds * 2500);
  if (payload.kind === "telemetry") setReading(payload.data);
  else if (payload.kind === "offline") {
    if (payload.sample) {
      history = mergeSamples(history, [payload.sample]);
      drawTrend();
    }
    if (lastOnline)
      addEvent(
        "Lost communication with MXCHIP · " +
          String(payload.reason).slice(0, 150),
        "warning",
      );
    lastOnline = false;
  }
  if (payload.history_error)
    $("historyStatus").textContent = "History could not be saved";
  else if (historyAvailable)
    $("historyStatus").textContent = "LOCAL HISTORY · LAST 60 SAMPLES";
  renderStatus();
}

async function loadHistory() {
  const request = ++historyRequest;
  try {
    const response = await fetch("/api/history", { cache: "no-store" });
    if (!response.ok) throw new Error("History unavailable");
    const saved = await response.json();
    if (request !== historyRequest) return;
    history = mergeSamples(history, saved.samples || []);
    for (const event of saved.events || []) addAlarmEvent(event);
    historyAvailable = true;
    $("historyStatus").textContent = session.latest?.history_error
      ? "History could not be saved"
      : "LOCAL HISTORY · LAST 60 SAMPLES";
    drawTrend();
  } catch {
    if (request === historyRequest) {
      historyAvailable = false;
      $("historyStatus").textContent = "Local history unavailable";
    }
  }
}

function configure(settings) {
  const nextSource = settings.source;
  if (sourceKey !== null && sourceKey !== nextSource) {
    history = [];
    historyAvailable = false;
    latest = null;
    lastKnownAlarm = null;
    lastOnline = false;
    timeline.clear();
    $("eventList").replaceChildren();
  }
  sourceKey = nextSource;
  gapMs = Math.max(1500, settings.interval_seconds * 2500);
  setMode(settings.demo);
  room = settings.room;
  if (library) {
    const saved = library.projects.find(
      (project) => project.id === "meeting-room",
    );
    if (saved) {
      saved.name = room.name;
      saved.code = room.code;
      saved.room = room;
      library.renderCards();
    }
  }
  if (isRoomOpen()) renderRoomHeading();
  sceneDirty = true;
  loadHistory();
}

// The SSE stream supplies both configuration and state, including after restart.
const live = new EventSource("/api/events");
live.addEventListener("config", (event) => {
  try {
    configure(JSON.parse(event.data));
  } catch (error) {
    console.error("Invalid configuration", error);
  }
});
live.addEventListener("state", (event) => {
  try {
    receive(JSON.parse(event.data));
  } catch (error) {
    console.error("Invalid telemetry", error);
  }
});
live.addEventListener("alarm", (event) => {
  try {
    addAlarmEvent(JSON.parse(event.data));
  } catch (error) {
    console.error("Invalid alarm event", error);
  }
});
live.addEventListener("resync", () => loadHistory());
live.onerror = () => {
  if (session.connected) {
    addEvent("Telemetry stream interrupted · reconnecting", "warning");
    const stamp = new Date().toISOString();
    history = mergeSamples(history, [
      {
        id: `stream-gap:${stamp}`,
        observed_at: stamp,
        sampled_at: stamp,
        temperature_c: null,
        quality: "offline",
        simulated: simulation,
      },
    ]);
    drawTrend();
  }
  lastOnline = false;
  session.disconnect();
  renderStatus();
};
document.addEventListener("visibilitychange", () => renderStatus());
$("demoAlarmBtn").addEventListener("click", async () => {
  if (!simulation) return;
  $("demoAlarmBtn").disabled = true;
  try {
    const response = await fetch("/api/demo/toggle-alarm", { method: "POST" });
    if (!response.ok) throw new Error("Failed");
  } catch {
    addEvent("Failed to toggle simulated alarm", "warning");
  } finally {
    $("demoAlarmBtn").disabled = false;
  }
});

// Perspective engine: lightweight 3D solids projected to Canvas2D. Fully offline.
const v = (x, y, z) => ({ x, y, z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) =>
  v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const sub = (a, b) => v(a.x - b.x, a.y - b.y, a.z - b.z);
const norm = (a) => {
  const d = Math.hypot(a.x, a.y, a.z) || 1;
  return v(a.x / d, a.y / d, a.z / d);
};
let W = 900,
  H = 530,
  dpr = 1,
  cam,
  forward,
  right,
  up;
function fit() {
  if (!isRoomOpen()) return;
  W = Math.max(1, scene.clientWidth);
  H = Math.max(1, scene.clientHeight);
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sceneDirty = true;
}
function cameraSetup() {
  const scale = Math.max(
    room.width_m / 11.2,
    room.depth_m / 8.2,
    room.height_m / 3.72,
  );
  const target = v(
    0,
    (1.03 * room.height_m) / 3.72,
    (-0.18 * room.depth_m) / 8.2,
  );
  cam = v(
    target.x + distance * scale * Math.sin(angle) * Math.cos(elevation),
    target.y + distance * scale * Math.sin(elevation),
    target.z + distance * scale * Math.cos(angle) * Math.cos(elevation),
  );
  forward = norm(sub(target, cam));
  right = norm(cross(forward, v(0, 1, 0)));
  up = norm(cross(right, forward));
}
function project(p) {
  p = v(
    (p.x * room.width_m) / 11.2,
    (p.y * room.height_m) / 3.72,
    (p.z * room.depth_m) / 8.2,
  );
  const delta = sub(p, cam),
    depth = dot(delta, forward);
  if (depth < 0.1) return null;
  const focal = Math.min(W * 1.11, H * 1.59);
  return {
    x: W / 2 + (dot(delta, right) / depth) * focal,
    y: H * 0.565 - (dot(delta, up) / depth) * focal,
    depth,
  };
}
function parseHex(h) {
  const c = h.replace("#", "");
  return [
    parseInt(c.slice(0, 2), 16),
    parseInt(c.slice(2, 4), 16),
    parseInt(c.slice(4, 6), 16),
  ];
}
function tint(base, k) {
  const c = parseHex(base);
  return `rgb(${c.map((n) => Math.min(255, Math.max(0, Math.round(n * k)))).join(",")})`;
}
const faces = [];
function poly(points, color, stroke = "#00000000", alpha = 1) {
  const pts = points.map(project);
  if (pts.some((p) => !p)) return;
  const depth = pts.reduce((s, p) => s + p.depth, 0) / pts.length;
  faces.push({ points: pts, color, stroke, alpha, depth });
}
function box(x, y, z, w, h, d, color, rotation = 0, alpha = 1) {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const px = i & 1 ? w / 2 : -w / 2,
      py = i & 2 ? h : 0,
      pz = i & 4 ? d / 2 : -d / 2;
    pts.push(
      v(
        x + px * Math.cos(rotation) - pz * Math.sin(rotation),
        y + py,
        z + px * Math.sin(rotation) + pz * Math.cos(rotation),
      ),
    );
  }
  // Flat-shaded faces; painter sort across the whole scene.
  const fs = [
    [[0, 1, 3, 2], 0.72],
    [[4, 6, 7, 5], 0.74],
    [[0, 2, 6, 4], 0.84],
    [[1, 5, 7, 3], 1.03],
    [[2, 3, 7, 6], 1.22],
    [[0, 4, 5, 1], 0.68],
  ];
  for (const [ix, k] of fs)
    poly(
      ix.map((i) => pts[i]),
      tint(color, k),
      "#0c223034",
      alpha,
    );
}
function slab(x, z, w, d, color) {
  poly(
    [
      v(x - w / 2, 0.015, z - d / 2),
      v(x + w / 2, 0.015, z - d / 2),
      v(x + w / 2, 0.015, z + d / 2),
      v(x - w / 2, 0.015, z + d / 2),
    ],
    color,
  );
}
function stool(x, z, rotation = 0) {
  // Conference swivel chair with five simple solids.
  box(x, 0.11, z, 0.67, 0.14, 0.64, "#31546a", rotation);
  const backOffset = v(
    -0.28 * Math.sin(rotation),
    0,
    0.28 * Math.cos(rotation),
  );
  box(
    x + backOffset.x,
    0.25,
    z + backOffset.z,
    0.68,
    0.88,
    0.13,
    "#41677b",
    rotation,
  );
  box(x, 0.01, z, 0.11, 0.19, 0.12, "#72818b");
  box(x, 0.02, z, 0.9, 0.045, 0.07, "#2c5065", rotation);
  box(x, 0.02, z, 0.07, 0.045, 0.8, "#2c5065", rotation);
}
function addSceneGeometry() {
  buildMeetingRoom({ box, slab, stool, v, roomOn, alarmOn, sensorPosition });
}
function drawBackground() {
  ctx.clearRect(0, 0, W, H);
  // subtle technical coordinate grid for the stage
  ctx.save();
  ctx.strokeStyle = "#33566b27";
  ctx.lineWidth = 0.7;
  for (let i = 0; i <= W; i += 33) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, H);
    ctx.stroke();
  }
  for (let i = 0; i <= H; i += 33) {
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(W, i);
    ctx.stroke();
  }
  ctx.restore();
  const gx = ctx.createRadialGradient(
    W * 0.47,
    H * 0.64,
    60,
    W * 0.46,
    H * 0.56,
    W * 0.67,
  );
  gx.addColorStop(0, "#40627316");
  gx.addColorStop(1, "#05131b00");
  ctx.fillStyle = gx;
  ctx.fillRect(0, 0, W, H);
}
function sensorPosition() {
  return v(
    (room.sensor_position.x * 11.2) / room.width_m,
    (room.sensor_position.y * 3.72) / room.height_m,
    (room.sensor_position.z * 8.2) / room.depth_m,
  );
}
const markerPositions = {
  alarm: v(-4.63, 3.13, 1.05),
  hvac: v(2.75, 3.58, 0.2),
};
function placeMarkers() {
  const sensor = sensorPosition();
  markerPositions.mxchip = v(sensor.x, sensor.y + 0.27, sensor.z);
  const targets = {
    mxchip: "markerSensor",
    alarm: "markerAlarm",
    hvac: "markerHVAC",
  };
  Object.entries(targets).forEach(([key, id]) => {
    const item = $(id),
      p = project(markerPositions[key]);
    const visible =
      !!p && p.x > -65 && p.x < W + 10 && p.y > 0 && p.y < H && tagsOn;
    item.hidden = !visible;
    if (visible) {
      item.style.left = p.x + "px";
      item.style.top = p.y + "px";
    }
  });
}
function draw3D() {
  cameraSetup();
  drawBackground();
  faces.length = 0;
  addSceneGeometry();
  faces.sort((a, b) => b.depth - a.depth);
  for (const face of faces) {
    const pts = face.points;
    ctx.globalAlpha = face.alpha;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = face.color;
    ctx.fill();
    ctx.strokeStyle = face.stroke;
    ctx.lineWidth = 0.65;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // ceiling detector ring and light guidance, drawn as upper layer
  placeMarkers();
  sceneDirty = false;
}
function animate(time) {
  if (
    isRoomOpen() &&
    (sceneDirty ||
      (!reducedMotion.matches && alarmOn === true && time - renderStamp > 520))
  ) {
    renderStamp = time;
    draw3D();
  }
  requestAnimationFrame(animate);
}
function orbit(dx, dy) {
  if (viewTop) viewTop = false;
  angle = Math.max(-0.2, Math.min(1.55, angle + dx * 0.007));
  elevation = Math.max(0.26, Math.min(1.5, elevation + dy * 0.0055));
  syncViewButtons();
  sceneDirty = true;
}
function syncViewButtons() {
  $("isoBtn").classList.toggle("active", !viewTop);
  $("topBtn").classList.toggle("active", viewTop);
  $("isoBtn").setAttribute("aria-pressed", String(!viewTop));
  $("topBtn").setAttribute("aria-pressed", String(viewTop));
}
canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  isDragging = true;
  lastPointer = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener("pointermove", (e) => {
  if (!isDragging || !lastPointer) return;
  const dx = e.clientX - lastPointer.x,
    dy = e.clientY - lastPointer.y;
  orbit(dx, dy);
  lastPointer = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener("pointerup", () => {
  isDragging = false;
  lastPointer = null;
});
canvas.addEventListener("pointercancel", () => {
  isDragging = false;
  lastPointer = null;
});
scene.addEventListener(
  "wheel",
  (e) => {
    if (!isRoomOpen()) return;
    e.preventDefault();
    distance = Math.max(
      10,
      Math.min(25, distance + Math.sign(e.deltaY) * 0.75),
    );
    sceneDirty = true;
  },
  { passive: false },
);
$("zoomIn").onclick = () => {
  if (!isRoomOpen()) return buildingViewer?.zoom(0.88);
  distance = Math.max(10, distance - 1.2);
  sceneDirty = true;
};
$("zoomOut").onclick = () => {
  if (!isRoomOpen()) return buildingViewer?.zoom(1.12);
  distance = Math.min(25, distance + 1.2);
  sceneDirty = true;
};
$("isoBtn").onclick = () => {
  if (!isRoomOpen()) return setBuildingView("overview");
  viewTop = false;
  angle = 0.69;
  elevation = 0.69;
  distance = 17.2;
  syncViewButtons();
  sceneDirty = true;
};
$("topBtn").onclick = () => {
  if (!isRoomOpen()) return setBuildingView("plan");
  viewTop = true;
  angle = 0.15;
  elevation = 1.48;
  distance = 18.2;
  syncViewButtons();
  sceneDirty = true;
};
$("resetView").onclick = () => $("isoBtn").click();
canvas.addEventListener("keydown", (e) => {
  const actions = {
    ArrowLeft: () => orbit(-10, 0),
    ArrowRight: () => orbit(10, 0),
    ArrowUp: () => orbit(0, 10),
    ArrowDown: () => orbit(0, -10),
    "+": () => $("zoomIn").click(),
    "=": () => $("zoomIn").click(),
    "-": () => $("zoomOut").click(),
    Home: () => $("resetView").click(),
  };
  if (actions[e.key]) {
    e.preventDefault();
    actions[e.key]();
  }
});
$("toggleHotspots").addEventListener("change", (e) => {
  tagsOn = e.target.checked;
  sceneDirty = true;
});
$("toggleRoom").addEventListener("change", (e) => {
  roomOn = e.target.checked;
  sceneDirty = true;
});
function inspect(key) {
  if (!isRoomOpen()) return;
  selectedAsset = key;
  const description = {
    mxchip: ["MXCHIP AZ3166", "Environmental / motion sensor"],
    alarm: ["Demo alarm input", "MXCHIP Button A · register 30006"],
    hvac: ["HVAC diffuser", "Decorative room asset"],
  };
  const [name, desc] = description[key] || description.mxchip;
  $("assetTitle").textContent = name;
  $("assetDesc").textContent = desc;
  $("inspectorLabel").textContent =
    key === "hvac"
      ? "MODEL ASSET"
      : simulation
        ? "SIMULATED ASSET"
        : "CONNECTED ASSET";
  $("sensorDetails").hidden = key !== "mxchip";
  $("alarmCard").hidden = key === "hvac";
  $("modelDetails").hidden = key !== "hvac";
  $("freshness").hidden = key === "hvac";
  $("deviceFoot").hidden = key === "hvac";
  $("navSensors").classList.toggle("active", key === "mxchip");
  $("navAlarm").classList.toggle("active", key === "alarm");
  $("inspectorPanel").scrollIntoView({
    behavior: reducedMotion.matches ? "instant" : "smooth",
    block: "nearest",
  });
}
for (const item of document.querySelectorAll("[data-asset]")) {
  item.addEventListener("click", () => inspect(item.dataset.asset));
  item.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      inspect(item.dataset.asset);
    }
  });
}
$("navSensors").onclick = () => inspect("mxchip");
$("navAlarm").onclick = () => inspect("alarm");
$("navTwin").onclick = () => {
  if ($("modelWorkspace").hidden)
    return library?.open(activeProject?.id || library.defaultId);
  (isRoomOpen() ? canvas : $("buildingCanvas")).focus();
};
const dlg = $("helpDialog");
$("helpBtn").onclick = () => dlg.showModal();
$("closeHelp").onclick = () => dlg.close();
function drawTrend() {
  const width = Math.max(5, chartCanvas.clientWidth),
    height = Math.max(20, chartCanvas.clientHeight);
  const dpi = Math.min(window.devicePixelRatio || 1, 2);
  chartCanvas.width = Math.round(width * dpi);
  chartCanvas.height = Math.round(height * dpi);
  chart.setTransform(dpi, 0, 0, dpi, 0, 0);
  chart.clearRect(0, 0, width, height);
  chart.strokeStyle = "#344e6155";
  chart.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (height * i) / 4;
    chart.beginPath();
    chart.moveTo(0, y);
    chart.lineTo(width, y);
    chart.stroke();
  }
  const segments = chartSegments(history, gapMs);
  const points = segments.flat();
  if (!points.length) {
    $("chartRange").textContent = "No available temperature samples";
    $("chartSummary").textContent =
      "No available temperature samples. Missing, faulty, and stale samples are left as gaps.";
    $("chartTimeRange").textContent = "—";
    return;
  }
  const values = points.map((point) => point.value),
    lo = Math.min(...values),
    hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.6, 0.6),
    min = lo - pad,
    max = hi + pad;
  const times = history
    .map((sample) => Date.parse(sample.sampled_at))
    .filter(Number.isFinite);
  const first = Math.min(...times),
    last = Math.max(...times),
    duration = Math.max(1000, last - first);
  $("chartRange").textContent = `${lo.toFixed(1)} — ${hi.toFixed(1)} °C`;
  $("chartTimeRange").textContent =
    `${new Date(first).toLocaleTimeString()} — ${new Date(last).toLocaleTimeString()}`;
  $("chartSummary").textContent =
    `${points.length} available samples, ${lo.toFixed(1)} to ${hi.toFixed(1)} °C. Teal: current; amber: unverified. Gaps indicate missing, faulty, or stale data.`;
  for (const segment of segments) {
    const pts = segment.map((point) => ({
      x: 8 + ((point.at - first) / duration) * (width - 16),
      y: height - 10 - ((point.value - min) / (max - min)) * (height - 22),
    }));
    chart.beginPath();
    pts.forEach((p, i) =>
      i === 0 ? chart.moveTo(p.x, p.y) : chart.lineTo(p.x, p.y),
    );
    chart.strokeStyle =
      segment[0].quality === "unknown" ? "#f2b968" : "#56e6d3";
    chart.lineWidth = 2.25;
    chart.stroke();
    const p = pts.at(-1);
    chart.beginPath();
    chart.arc(p.x, p.y, 3, 0, Math.PI * 2);
    chart.fillStyle = chart.strokeStyle;
    chart.fill();
  }
}
new ResizeObserver(() => {
  buildingViewer?.resize();
  fit();
  drawTrend();
}).observe(scene);
fit();
syncViewButtons();
requestAnimationFrame(animate);
drawTrend();

function isRoomOpen() {
  return (
    activeProject?.model.kind === "meeting-room" && !$("modelWorkspace").hidden
  );
}
function renderRoomHeading() {
  $("roomName").textContent = room.name;
  $("roomLocation").textContent = room.location;
  $("roomTrail").textContent = room.name;
  $("roomCode").textContent = room.code;
  $("roomDimensions").textContent = `${room.width_m} × ${room.depth_m} m`;
  $("projectSubtitle").textContent =
    "Your saved meeting room · MXCHIP telemetry and demonstration alarm";
  $("projectMeta").textContent = "SAVED ROOM";
  $("sceneKey").textContent = "MEETING ROOM DIGITAL TWIN";
  $("sceneCaptionLabel").textContent = "SCHEMATIC ROOM";
  $("sceneOrientation").textContent = "N";
  $("assetCount").textContent = "3 MODEL ASSETS";
  document.title = `aura — ${room.name}`;
}
function showLibrary() {
  viewerFullscreen.close();
  projectRequest++;
  $("projectsView").hidden = false;
  $("modelWorkspace").hidden = true;
  buildingViewer?.setActive(false);
  $("roomName").textContent = "Projects";
  $("roomLocation").textContent = "YOUR WORKSPACE";
  $("roomTrail").textContent = "Projects";
  $("projectSubtitle").textContent =
    "Your 3D models, project requirements, and IoT connections — kept together.";
  $("modeChip").textContent = "PROJECT LIBRARY";
  $("modeChip").classList.remove("simulated");
  $("projectMeta").textContent =
    `${library?.projects.length || 0} SAVED PROJECTS`;
  $("connLabel").textContent = "LOCAL WORKSPACE";
  $("connState").className = "connection-status online";
  $("navProjects").classList.add("active");
  $("navTwin").classList.remove("active");
  $("navSensors").disabled = true;
  $("navAlarm").disabled = true;
  document.title = "aura — Projects";
}
async function activateProject(project) {
  activeProject = project;
  const request = ++projectRequest;
  const roomProject = project.model.kind === "meeting-room";
  if (roomProject) viewerFullscreen.close();
  $("fullscreenBtn").hidden = roomProject;
  $("projectsView").hidden = true;
  $("modelWorkspace").hidden = false;
  $("navProjects").classList.remove("active");
  $("navTwin").classList.add("active");
  $("navSensors").disabled = !roomProject;
  $("navAlarm").disabled = !roomProject;
  $("navSensors").classList.remove("active");
  $("navAlarm").classList.remove("active");
  $("inspectorPanel").hidden = !roomProject;
  $("buildingInspector").hidden = roomProject;
  $("roomTelemetry").hidden = !roomProject;
  $("roomFooter").hidden = !roomProject;
  $("roomLayers").hidden = !roomProject;
  $("buildingFooter").hidden = roomProject;
  $("buildingOptions").hidden = roomProject;
  $("interiorOptions").hidden = roomProject;
  $("egressOptions").hidden = roomProject;
  canvas.hidden = !roomProject;
  $("buildingCanvas").hidden = roomProject;
  scene.classList.toggle("building-scene", !roomProject);
  $("buildingStatus").hidden = true;
  $("reloadBuilding").hidden = true;
  $("scene").setAttribute(
    "aria-label",
    roomProject
      ? "Interactive meeting room with sensor and demo assets"
      : "Three-floor glazed building, atrium, galleries, stairs, and lift core",
  );
  if (roomProject) {
    buildingViewer?.setActive(false);
    if (project.room) room = project.room;
    selectedAsset = "mxchip";
    renderRoomHeading();
    setMode(simulation);
    statusKey = "";
    renderStatus();
    $("sensorDetails").hidden = false;
    $("alarmCard").hidden = false;
    $("modelDetails").hidden = true;
    $("freshness").hidden = false;
    $("deviceFoot").hidden = false;
    selectedAsset = "mxchip";
    $("assetTitle").textContent = "MXCHIP AZ3166";
    $("assetDesc").textContent = "Environmental / motion sensor";
    $("roomRequirements").replaceChildren(
      ...project.requirements.map((item) => {
        const li = document.createElement("li");
        li.textContent = `${item.name} · ${item.status}`;
        return li;
      }),
    );
    $("roomIot").textContent = project.iot
      .map((item) => `${item.name} · ${item.description}`)
      .join("\n");
    fit();
    sceneDirty = true;
    drawTrend();
    syncViewButtons();
  } else {
    $("roomName").textContent = project.name;
    $("roomLocation").textContent = "ARCHITECTURE + CONCEPT SERVICES";
    $("roomTrail").textContent = project.name;
    $("projectSubtitle").textContent =
      "Three furnished floors · Private façades, solid roofs, balconies and connected concept services.";
    $("projectMeta").textContent = "40 × 24 m";
    $("roomCode").textContent = project.code;
    $("modeChip").textContent = "FURNISHED MODEL";
    $("modeChip").classList.remove("simulated");
    $("connState").className = "connection-status model-only";
    $("connLabel").textContent = "MODEL ONLY · NO IoT";
    $("sceneKey").textContent = "OFFICE CONCEPT / 40 × 24 m";
    $("sceneCaptionLabel").textContent = "AURA OFFICE BUILDING";
    $("sceneOrientation").textContent = "FRONT +Z";
    $("roomDimensions").textContent = "40 × 24 m · THREE FLOORS";
    $("sensorCount").textContent = "0 IoT DEVICES";
    $("assetCount").textContent = `${ROOM_COUNT} ROOMS · FURNISHED`;
    $("sceneSync").textContent = "ARCHITECTURAL CONCEPT";
    $("sceneHelp").textContent =
      "Left-drag to orbit · Middle-drag to pan · Scroll to zoom. Use Full screen for a larger workspace with floor, room and visibility controls.";
    renderProjectDetails(project);
    $("buildingRoomCount").textContent = String(ROOM_COUNT);
    $("roomSelect").replaceChildren(
      new Option("Select an office or service space…", ""),
    );
    for (const floor of FLOORS) {
      const group = document.createElement("optgroup");
      group.label = `${floor.name} · ${floor.purpose}`;
      for (const space of floor.rooms)
        group.append(
          new Option(
            `${space.id} · ${space.name} · ${space.area} m²`,
            space.id,
          ),
        );
      $("roomSelect").append(group);
    }
    document.title = `aura — ${project.name}`;
    $("buildingStatus").hidden = false;
    $("buildingStatus").textContent = "Opening 3D building…";
    try {
      const { BuildingViewer } = await import("./building-viewer.js");
      if (request !== projectRequest) return;
      if (!buildingViewer)
        buildingViewer = new BuildingViewer(
          $("buildingCanvas"),
          (part) => {
            $("buildingPartTitle").textContent =
              part.label || "Architectural element";
            const level =
              part.floor == null
                ? "Roof"
                : part.floor === 0
                  ? "Ground floor"
                  : `Level 0${part.floor}`;
            if (part.kind === "washroom-point") {
              $("washroomPointSelect").value = part.assetId;
              $("buildingPartInfo").textContent =
                `${level} · UNAVAILABLE · MODEL ONLY. ${part.detail} Command and running proof are separate planned points; no live reading or operating state is asserted.`;
              updateBuildingControls();
              return;
            }
            if (part.kind === "fire-extinguisher") {
              $("extinguisherSelect").value = part.assetId;
              $("buildingPartInfo").textContent =
                `${level} · PDF F01 p.${part.sourcePage} · ${part.type} · ${part.location}. Paired sign ${part.signId}. Extinguisher top ${part.topHeight.toFixed(2)} m; sign centre ${part.signHeight.toFixed(2)} m above this floor. Proposed equipment reservation; rating, coverage and installation require verification. No live device assigned.`;
              updateBuildingControls();
              return;
            }
            if (part.kind === "egress-sign") {
              $("egressSignSelect").value = part.assetId;
              const faces =
                part.text ||
                part.faces
                  ?.map((face) =>
                    face.arrow === "EXIT"
                      ? "EXIT over door"
                      : `EXIT ${face.arrow.toLowerCase()} for its approach`,
                  )
                  .join("; ");
              $("buildingPartInfo").textContent =
                `${level} · ${part.supplemental ? "Supplemental identification" : "PDF sign " + part.scheduleId} · PDF p.${part.sourcePage}. ${part.mount}. ${faces || ""}. ${part.destination}. ${part.conditional ? "Conditional: requires atrium/site strategy verification. " : ""}${part.adaptation || ""} ${part.restriction || ""} Model sign; emergency power/visibility are not verified.`;
              updateBuildingControls();
              return;
            }
            if (part.roomId && buildingViewer) {
              const space = buildingViewer.model.rooms.find(
                (item) => item.id === part.roomId,
              );
              if (space) {
                $("roomSelect").value = space.id;
                const capacity = space.count
                  ? ` · ${space.count} ${["wc", "accessible-wc"].includes(space.furniture) ? "WCs" : ["desks", "ceo", "bms"].includes(space.furniture) ? "desks" : "seats"}`
                  : "";
                $("buildingPartInfo").textContent =
                  `${level} · ${space.area} m²${capacity}. ${space.note || "Furnished according to the supplied schematic office plan."}`;
                updateBuildingControls();
                return;
              }
            }
            $("buildingPartInfo").textContent =
              `${level} · ${part.detail || (part.kind === "reserve" ? "Reserved coordination space; no fitted equipment installed." : "Concept model; no live device is assigned to this element.")}`;
          },
          updateBuildingControls,
        );
      buildingViewer.setActive(true);
      $("buildingStatus").hidden = true;
      updateBuildingControls();
    } catch (error) {
      if (request !== projectRequest) return;
      $("buildingStatus").textContent =
        "The building needs WebGL graphics support. Try reloading, or open the saved meeting-room project.";
      $("reloadBuilding").hidden = false;
      console.error("Building viewer could not start", error);
    }
  }
}
function updateBuildingControls() {
  if (!buildingViewer) return;
  const state = buildingViewer;
  $("buildingViewSelect").value = state.view;
  $("floorSelect").value = String(state.floor);
  $("selectedFloorLabel").textContent =
    state.floor === "all"
      ? "ALL FLOORS"
      : state.floor === "0"
        ? "GROUND FLOOR"
        : `LEVEL 0${state.floor}`;
  for (const button of document.querySelectorAll("[data-floor]")) {
    const selected = button.dataset.floor === String(state.floor);
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  $("isoBtn").classList.toggle("active", state.view === "overview");
  $("topBtn").classList.toggle("active", state.view === "plan");
  $("isoBtn").setAttribute("aria-pressed", String(state.view === "overview"));
  $("topBtn").setAttribute("aria-pressed", String(state.view === "plan"));
  $("atriumBtn").setAttribute("aria-pressed", String(state.view === "atrium"));
  $("cutawayToggle").checked = state.cutaway;
  $("washroomViewBtn").setAttribute(
    "aria-pressed",
    String(state.washroomDetail),
  );
  $("glassToggle").checked = state.glass;
  $("officeViewBtn").setAttribute(
    "aria-pressed",
    String(state.view === "offices"),
  );
  for (const [id, key] of [
    ["partitionsToggle", "partitions"],
    ["furnitureToggle", "furniture"],
    ["lowWallsToggle", "lowWalls"],
    ["serviceReservesToggle", "services"],
    ["roomLabelsToggle", "labels"],
    ["ceilingsToggle", "ceilings"],
    ["systemsToggle", "systems"],
    ["egressSignsToggle", "egressSigns"],
    ["egressPathsToggle", "egressPaths"],
    ["extinguishersToggle", "extinguishers"],
    ["washroomClearancesToggle", "washroomClearances"],
    ["washroomDoorsToggle", "washroomDoors"],
    ["washroomPointsToggle", "washroomPoints"],
  ])
    $(id).checked = state[key];
  const chosenRoom = state.model.rooms.find(
    (room) => room.id === $("roomSelect").value,
  );
  $("traceExitBtn").disabled =
    !chosenRoom ||
    ["lift", "central-stair", "riser"].includes(chosenRoom.furniture);
  const route = state.model.egress.current;
  $("clearExitTraceBtn").hidden = !route;
  $("egressRouteInfo").textContent = route
    ? `${route.roomId} doorway → ${route.exteriorOnly ? "dedicated exterior exit" : `Stair ${route.side < 0 ? "A" : "B"} → ground side exit`} → assumed public-way connection. ${route.conditional ? "Includes a conditional atrium or exterior leg. " : ""}All floors shows the descent; isolate a floor to inspect its leg.`
    : "57 scheduled positions · PDF Rev E01. Select a room to trace its doorway-to-discharge route.";
  $("floorPurpose").textContent =
    state.floor === "all"
      ? "Three furnished floors · Ground, teams, leadership"
      : `${FLOORS[Number(state.floor)].name} · ${FLOORS[Number(state.floor)].purpose}`;
  $("roofToggle").checked = state.roof;
  $("roofToggle").disabled =
    ["offices", "plan", "atrium"].includes(state.view) ||
    state.cutaway ||
    state.floor !== "all";
  $("roofToggle").title = $("roofToggle").disabled
    ? "Roof is hidden while exploring the interior or an individual floor"
    : "Show solid wing roofs and central atrium skylight";
  $("ceilingsToggle").disabled =
    ["offices", "plan", "atrium"].includes(state.view) ||
    state.cutaway ||
    state.floor !== "all";
  $("ceilingsToggle").title = $("ceilingsToggle").disabled
    ? "Ceilings are automatically hidden while inspecting floors and rooms"
    : "Show suspended ceilings below the structural slabs";
}
function setBuildingView(view) {
  if (buildingViewer) {
    buildingViewer.setView(view);
    updateBuildingControls();
  }
}
function setBuildingFloor(floor) {
  if (buildingViewer) {
    buildingViewer.setFloor(floor);
    updateBuildingControls();
  }
}
$("floorSelect").onchange = (event) => setBuildingFloor(event.target.value);
$("buildingViewSelect").onchange = (event) =>
  setBuildingView(event.target.value);
for (const button of document.querySelectorAll("[data-floor]"))
  button.onclick = () => setBuildingFloor(button.dataset.floor);
$("atriumBtn").onclick = () => setBuildingView("atrium");
$("officeViewBtn").onclick = () => setBuildingView("offices");
$("roomSelect").onchange = (event) => {
  if (event.target.value) {
    buildingViewer?.selectRoom(event.target.value);
    updateBuildingControls();
  }
};
for (const [id, key] of [
  ["cutawayToggle", "cutaway"],
  ["glassToggle", "glass"],
  ["roofToggle", "roof"],
  ["partitionsToggle", "partitions"],
  ["furnitureToggle", "furniture"],
  ["lowWallsToggle", "lowWalls"],
  ["serviceReservesToggle", "services"],
  ["roomLabelsToggle", "labels"],
  ["ceilingsToggle", "ceilings"],
  ["systemsToggle", "systems"],
  ["egressSignsToggle", "egressSigns"],
  ["egressPathsToggle", "egressPaths"],
  ["extinguishersToggle", "extinguishers"],
  ["washroomClearancesToggle", "washroomClearances"],
  ["washroomDoorsToggle", "washroomDoors"],
  ["washroomPointsToggle", "washroomPoints"],
])
  $(id).onchange = (event) => {
    buildingViewer?.setLayer(key, event.target.checked);
    updateBuildingControls();
  };
$("egressPlanBtn").onclick = () => buildingViewer?.showExitPlan();
$("washroomViewBtn").onclick = () =>
  buildingViewer?.showWashroom($("roomSelect").value);
$("washroomPointSelect").onchange = (event) => {
  if (event.target.value)
    buildingViewer?.selectWashroomPoint(event.target.value);
};
$("extinguisherPlanBtn").onclick = () => buildingViewer?.showExtinguisherPlan();
$("extinguisherSelect").onchange = (event) => {
  if (event.target.value)
    buildingViewer?.selectExtinguisher(event.target.value);
};
$("egressSignSelect").onchange = (event) => {
  if (event.target.value) buildingViewer?.selectSign(event.target.value);
};
$("traceExitBtn").onclick = () =>
  buildingViewer?.traceExit($("roomSelect").value);
$("clearExitTraceBtn").onclick = () => {
  buildingViewer?.model.egress.trace(null);
  buildingViewer?.setLayer("egressPaths", true);
};
$("reloadBuilding").onclick = () => location.reload();
const viewerFullscreen = new ViewerFullscreen({
  root: $("viewerPanel"),
  panel: $("fullscreenControls"),
  mount: $("fullscreenControlMount"),
  button: $("fullscreenBtn"),
  panelButton: $("fullscreenPanelToggle"),
  canvas: $("buildingCanvas"),
  controls: [
    $("buildingOptions"),
    $("interiorOptions"),
    $("egressOptions"),
    $("roomSelect").closest(".room-navigator"),
    $("buildingPartTitle").closest(".building-part"),
  ],
  onResize: () => buildingViewer?.resize(),
});
library = new ProjectLibrary(activateProject, showLibrary);
library.load();

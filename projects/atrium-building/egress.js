/* Physical signs and optional diagram overlays. No IoT/emergency-power connection implied. */
import * as THREE from "three";
import { ENVELOPE } from "./layout.js";
import { builder, group, finish } from "./geometry.js";
import {
  EGRESS_SIGNS,
  SUPPLEMENTAL_SIGNS,
  EGRESS_BASIS,
  routeFromRoom,
  stairDescent,
  outdoorContinuation,
} from "./egress-plan.js";
export { EGRESS_SIGNS, EGRESS_BASIS, routeFromRoom } from "./egress-plan.js";
const arrows = { LEFT: "←", RIGHT: "→", UP: "↑", EXIT: "" };
// Code-drawn pictograms stay sharp at any texture resolution; no reference-image asset.
function runningExit(c, direction) {
  c.save();
  c.translate(direction === "RIGHT" ? 295 : 60, 135);
  c.scale(direction === "RIGHT" ? -1 : 1, 1);
  c.strokeStyle = "#ffffff";
  c.lineWidth = 21;
  c.lineCap = "square";
  c.beginPath();
  c.moveTo(92, 30);
  c.lineTo(20, 30);
  c.lineTo(20, 270);
  c.lineTo(92, 270);
  c.stroke();
  c.fillStyle = "#ffffff";
  c.beginPath();
  c.arc(153, 67, 22, 0, Math.PI * 2);
  c.fill();
  c.lineCap = "round";
  c.lineJoin = "round";
  c.lineWidth = 24;
  for (const points of [
    [
      [146, 111],
      [170, 151],
      [136, 190],
    ],
    [
      [145, 111],
      [109, 134],
      [76, 117],
    ],
    [
      [150, 116],
      [187, 117],
      [214, 152],
    ],
    [
      [136, 190],
      [94, 225],
      [72, 267],
    ],
    [
      [136, 190],
      [181, 220],
      [216, 220],
    ],
  ]) {
    c.beginPath();
    points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.stroke();
  }
  c.restore();
}
function pictogramArrow(c, x, y, angle, length = 235) {
  c.save();
  c.translate(x, y);
  c.rotate(angle);
  c.beginPath();
  c.moveTo(-length / 2, -24);
  c.lineTo(length / 2 - 77, -24);
  c.lineTo(length / 2 - 77, -67);
  c.lineTo(length / 2, 0);
  c.lineTo(length / 2 - 77, 67);
  c.lineTo(length / 2 - 77, 24);
  c.lineTo(-length / 2, 24);
  c.closePath();
  c.fill();
  c.restore();
}
export function drawStairPictogram(c, sign) {
  // 1024 × 576 drawing coordinates, in the same green/white palette as EXIT boards.
  c.fillStyle = "#087449";
  c.fillRect(0, 0, 1024, 576);
  c.strokeStyle = "#ffffff";
  c.lineWidth = 7;
  c.strokeRect(15, 15, 994, 546);
  c.fillStyle = "#ffffff";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = "700 48px sans-serif";
  c.fillText(`STAIR ${sign.stair} · ${sign.floorName} FLOOR`, 512, 67, 945);
  runningExit(
    c,
    sign.pictogram === "stair-descent" ? "LEFT" : sign.pictogramDirection,
  );
  if (sign.pictogram === "stair-descent") {
    pictogramArrow(c, 484, 275, Math.PI * 0.75);
    c.beginPath();
    c.moveTo(645, 424);
    c.lineTo(705, 424);
    c.lineTo(705, 364);
    c.lineTo(765, 364);
    c.lineTo(765, 304);
    c.lineTo(825, 304);
    c.lineTo(825, 244);
    c.lineTo(885, 244);
    c.lineTo(885, 184);
    c.lineTo(945, 184);
    c.lineWidth = 25;
    c.lineCap = "square";
    c.lineJoin = "miter";
    c.stroke();
  } else
    pictogramArrow(
      c,
      710,
      294,
      sign.pictogramDirection === "RIGHT" ? 0 : Math.PI,
      310,
    );
  c.font = "800 49px sans-serif";
  c.fillText(
    sign.pictogram === "stair-descent"
      ? "EXIT · DOWN TO GROUND"
      : "EXIT TO OUTSIDE",
    512,
    510,
    935,
  );
}
function signMaterial(sign, face) {
  const color = sign.notice ? "#644b30" : "#087449";
  const material = new THREE.MeshBasicMaterial({
    color,
    side: THREE.FrontSide,
  });
  if (typeof document === "undefined") return material;
  const canvas = document.createElement("canvas");
  canvas.width = sign.pictogram ? 1024 : 768;
  canvas.height = sign.pictogram ? 576 : 256;
  const c = canvas.getContext("2d");
  c.fillStyle = color;
  c.fillRect(0, 0, 768, 256);
  c.strokeStyle = "#ffffff";
  c.lineWidth = 5;
  c.strokeRect(12, 12, 744, 232);
  c.fillStyle = "#ffffff";
  c.textAlign = "center";
  c.textBaseline = "middle";
  if (sign.pictogram) drawStairPictogram(c, sign);
  else if (sign.text) {
    const lines = sign.text.split("\n");
    c.font = `700 ${lines.length === 3 ? 43 : 49}px sans-serif`;
    lines.forEach((line, i) =>
      c.fillText(line, 384, 128 + (i - (lines.length - 1) / 2) * 62, 715),
    );
  } else {
    c.font = "800 145px sans-serif";
    c.fillText(`EXIT ${arrows[face.arrow]}`, 384, 117, 700);
    c.font = "500 29px sans-serif";
    c.fillText(sign.scheduleId || "OUTDOOR CONTINUATION", 384, 216, 700);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  material.color.set(0xffffff);
  material.map = texture;
  return material;
}
function line(parent, points, color, dashed = false, data = {}) {
  if (points.length < 2) return;
  parent = group(parent, "Route stroke and travel arrows", {
    kind: "egress-route",
  });
  const material = dashed
    ? new THREE.LineDashedMaterial({
        color,
        dashSize: 0.42,
        gapSize: 0.22,
        depthTest: false,
      })
    : new THREE.LineBasicMaterial({ color, depthTest: false });
  const object = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(
      points.map((p) => new THREE.Vector3(...p)),
    ),
    material,
  );
  object.computeLineDistances();
  object.renderOrder = 20;
  object.userData = {
    kind: "egress-route",
    label: "Concept route overlay",
    ...data,
  };
  // Diagram strokes must never intercept room, equipment or physical-sign picking.
  object.raycast = () => {};
  parent.add(object);
  // Flat directional chevrons clarify travel, including the assumed outdoor legs.
  // These are diagram marks, never physical floor signs or emergency luminaires.
  const vertices = [];
  for (let i = 1; i < points.length; i++) {
    const a = new THREE.Vector3(...points[i - 1]),
      end = new THREE.Vector3(...points[i]);
    const delta = end.clone().sub(a),
      length = delta.length();
    if (length < 0.7 || Math.abs(delta.y) > 0.01) continue;
    const direction = delta.clone().normalize(),
      right = new THREE.Vector3(direction.z, 0, -direction.x);
    const count = Math.max(1, Math.floor(length / 3));
    for (let n = 0; n < count; n++) {
      const center = a.clone().addScaledVector(delta, (n + 0.55) / count);
      const tip = center.clone().addScaledVector(direction, 0.24);
      const back = center.clone().addScaledVector(direction, -0.18);
      const left = back.clone().addScaledVector(right, -0.15),
        rightPoint = back.clone().addScaledVector(right, 0.15);
      for (const p of [tip, left, rightPoint])
        vertices.push(p.x, p.y + 0.01, p.z);
    }
  }
  if (vertices.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    const chevrons = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    chevrons.renderOrder = 21;
    chevrons.raycast = () => {};
    chevrons.userData = {
      kind: "egress-route",
      label: "Concept route direction arrows",
    };
    parent.add(chevrons);
  }
  return object;
}
function clear(parent) {
  for (const child of [...parent.children]) {
    child.traverse((object) => {
      object.geometry?.dispose();
      object.material?.dispose();
    });
    parent.remove(child);
  }
}
export function createEgress({ root, floors, stairCores }) {
  const b = builder(),
    metal = finish(0x303d43),
    board = finish(0x244c3d);
  const signs = floors.map((floor, i) =>
    group(floor, `Exit signs · floor ${i}`, {
      layer: "egress-signs",
      floor: i,
    }),
  );
  const routes = floors.map((floor, i) =>
    group(floor, `Concept exit routes · floor ${i}`, {
      layer: "egress-paths",
      floor: i,
    }),
  );
  const outdoorSigns = group(root, "Outdoor exit direction signs", {
    layer: "egress-signs",
    floor: 0,
  });
  const outdoorRoutes = group(root, "Assumed continuation to public way", {
    layer: "egress-paths",
    floor: 0,
  });
  const selected = floors.map((floor, i) =>
    group(floor, `Selected doorway-to-discharge route · floor ${i}`, {
      layer: "egress-paths",
      floor: i,
    }),
  );
  const selectedOutdoor = group(
    outdoorRoutes,
    "Selected assumed public-way continuation",
  );
  const allSigns = [...EGRESS_SIGNS, ...SUPPLEMENTAL_SIGNS];
  const cabinets = [];
  for (const sign of allSigns) {
    const parent = sign.outdoor ? outdoorSigns : signs[sign.floor];
    const asset = group(parent, sign.label, sign);
    const normal = sign.faces[0].normal;
    if (
      sign.faces.length > 2 ||
      sign.faces.some(
        (face, i) =>
          i &&
          Math.abs(
            normal[0] * face.normal[0] + normal[1] * face.normal[1] + 1,
          ) > 0.0001,
      )
    )
      throw new Error(
        `${sign.assetId}: one cabinet supports only parallel front/back faces`,
      );
    const cabinet = group(asset, "Single sign cabinet", {
      ...sign,
      part: "cabinet",
    });
    const x = sign.x + (sign.panelOffset?.[0] || 0),
      z = sign.z + (sign.panelOffset?.[1] || 0);
    cabinet.position.set(x, sign.y, z);
    cabinet.rotation.y = Math.atan2(normal[0], normal[1]);
    // Exactly one physical case per scheduled position. The back is a texture face,
    // never a second board intersecting the front or projecting across it.
    const width = sign.size?.width || 1.04,
      height = sign.size?.height || 0.37;
    b.box(cabinet, 0, 0, 0, width, height, 0.045, board);
    for (const [i, face] of sign.faces.entries()) {
      const surface = new THREE.Mesh(
        new THREE.PlaneGeometry(width - 0.03, height - 0.03),
        signMaterial(sign, face),
      );
      surface.name = i ? "Back lettering" : "Front lettering";
      surface.position.z = i ? -0.025 : 0.025;
      surface.rotation.y = i ? Math.PI : 0;
      surface.userData = {
        ...sign,
        face: i,
        printedArrow: face.arrow,
        part: "lettering",
      };
      cabinet.add(surface);
    }
    cabinets.push({ sign, asset, cabinet });
    if (sign.outdoor) b.box(asset, x, sign.y / 2, z, 0.07, sign.y, 0.07, metal);
    else if (sign.panelOffset) {
      const wallX = sign.x - Math.sign(sign.panelOffset[0]) * 0.16;
      b.beam(
        asset,
        [wallX, sign.y + 0.26, z],
        [x, sign.y + 0.26, z],
        0.025,
        metal,
      );
      b.beam(
        asset,
        [x, sign.y + 0.26, z],
        [x, sign.y + 0.185, z],
        0.025,
        metal,
      );
    } else if (sign.mount.startsWith("Suspended"))
      for (const d of [-0.35, 0.35]) {
        const rodX = x + d * normal[1],
          rodZ = z - d * normal[0];
        b.box(asset, rodX, sign.y + 0.32, rodZ, 0.022, 0.35, 0.022, metal);
      }
  }
  b.flush();
  const at = (f, pts) =>
    pts.map(([x, z]) => [x, f * ENVELOPE.floorHeight + 0.07, z]);
  for (let f = 0; f < 3; f++) {
    for (const side of [-1, 1]) {
      const front = side < 0 ? -12 : 13,
        rear = side * 15;
      line(
        routes[f],
        at(f, [
          [front, 11],
          [front, 0.8],
          [rear, 0.8],
          [rear, -6.8],
          [side * (f ? 16 : 20), -6.8],
        ]),
        0x039755,
      );
      line(
        routes[f],
        at(f, [
          [rear, -10.8],
          [rear, -6.8],
        ]),
        0x039755,
      );
      line(
        routes[f],
        at(f, [
          [side * 4, -8.1],
          [side * 4, 0.8],
          [rear, 0.8],
        ]),
        0x168ebd,
        true,
      );
      if (f)
        line(
          routes[f],
          at(f, [
            [0, 8.5],
            [side * 4, 8.5],
            [side * 4, 0.8],
          ]),
          0x168ebd,
          true,
        );
    }
  }
  line(
    routes[0],
    at(0, [
      [4, 0.8],
      [4, 9.2],
      [2.65, 9.2],
      [2.65, 11],
    ]),
    0x168ebd,
    true,
  );
  for (const side of [-1, 1])
    line(outdoorRoutes, outdoorContinuation(side), 0xca8826, true);
  line(
    outdoorRoutes,
    [
      [2.65, 0.07, 11],
      [2.65, 0.07, EGRESS_BASIS.publicWayZ],
    ],
    0xca8826,
    true,
  );
  // Dedicated plant exits have their own outdoor legs, never a route through the rooms.
  for (const roomId of ["G-M01", "G-M02", "G-E01"]) {
    const route = routeFromRoom(roomId);
    line(
      outdoorRoutes,
      [...at(0, route.points), ...outdoorContinuation(route.side, true)],
      0xca8826,
      true,
    );
  }
  let current = null;
  function trace(roomId) {
    selected.forEach(clear);
    clear(selectedOutdoor);
    current = routeFromRoom(roomId);
    if (!current) return null;
    const r = current;
    if (r.exteriorOnly)
      line(
        selectedOutdoor,
        [...at(0, r.points), ...outdoorContinuation(r.side, true)],
        0xffb23c,
        true,
      );
    else {
      line(
        selected[r.floor],
        at(r.floor, r.points),
        r.conditional ? 0x168ebd : 0x039755,
      );
      const steps = stairDescent(stairCores, r.side, r.floor);
      // Keep each descent with its source floor so isolated-floor inspection is legible.
      for (let f = r.floor; f > 0; f--) {
        const segment = stairDescent(stairCores, r.side, f, f - 1);
        const start =
          f === r.floor ? r.points.at(-1) : [r.side * 18 - 0.75, -6.8];
        line(
          selected[f],
          [
            [start[0], f * ENVELOPE.floorHeight + 0.07, start[1]],
            ...segment.map(([x, y, z]) => [x, y + 0.07, z]),
          ],
          0x039755,
        );
      }
      const arrivalX = r.floor ? steps.at(-1)[0] : r.points.at(-1)[0];
      line(
        selected[0],
        [
          [arrivalX, 0.07, -6.8],
          [r.side * 20, 0.07, -6.8],
        ],
        0x039755,
      );
      line(selectedOutdoor, outdoorContinuation(r.side), 0xffb23c, true);
    }
    return current;
  }
  return {
    signs,
    routes,
    outdoorSigns,
    outdoorRoutes,
    selected,
    selectedOutdoor,
    allSigns,
    cabinets,
    trace,
    get current() {
      return current;
    },
  };
}

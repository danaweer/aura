/* Reusable portable units and identification plates, independent of telemetry. */
import * as THREE from "three";
import { builder, group, finish } from "./geometry.js";
import { EXTINGUISHERS } from "./extinguisher-plan.js";

function identificationMaterial() {
  const material = new THREE.MeshBasicMaterial({
    color: 0xbd1d2d,
    side: THREE.DoubleSide,
  });
  if (typeof document === "undefined") return material;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const c = canvas.getContext("2d");
  c.fillStyle = "#bd1d2d";
  c.fillRect(0, 0, 256, 256);
  c.strokeStyle = c.fillStyle = "#ffffff";
  c.lineWidth = 6;
  c.strokeRect(6, 6, 244, 244);
  c.beginPath();
  c.roundRect(100, 88, 65, 120, 15);
  c.fill();
  c.fillRect(121, 66, 23, 29);
  c.lineWidth = 12;
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(132, 65);
  c.lineTo(164, 65);
  c.moveTo(127, 57);
  c.lineTo(160, 43);
  c.moveTo(119, 67);
  c.bezierCurveTo(61, 58, 75, 119, 65, 146);
  c.stroke();
  c.fillRect(53, 139, 20, 42);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  material.color.set(0xffffff);
  material.map = texture;
  return material;
}

export function createExtinguishers({ floors }) {
  const geo = builder();
  const red = finish(0xc52630, { roughness: 0.33, metalness: 0.25 });
  const cleanAgent = finish(0xe0e2dc, { roughness: 0.35, metalness: 0.55 });
  const black = finish(0x242a2d, { roughness: 0.42 });
  const metal = finish(0x8d9697, { metalness: 0.75, roughness: 0.25 });
  const label = finish(0xeee8d9);
  const signMaterial = identificationMaterial();
  const signGeometry = new THREE.PlaneGeometry(0.2, 0.2);
  const projectingGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  // Box face order: +X, -X, +Y, -Y, +Z, -Z. The front and both sides
  // retain the full pictogram; top, bottom and back sample plain red padding.
  // One shared texture/material also preserves the existing disposal convention.
  const uv = projectingGeometry.attributes.uv;
  for (const face of [2, 3, 5])
    for (let i = face * 4; i < face * 4 + 4; i++) uv.setXY(i, 0.05, 0.05);
  const layers = floors.map((floor, i) =>
    group(floor, `Fire extinguishers and location signs · floor ${i}`, {
      layer: "extinguishers",
      floor: i,
    }),
  );
  const assets = [];
  for (const station of EXTINGUISHERS) {
    const asset = group(layers[station.floor], station.label, station);
    asset.position.set(station.x, station.y, station.z);
    asset.rotation.y = Math.atan2(station.normal[0], station.normal[1]);
    const body = station.type === "CA-E" ? cleanAgent : red;
    // Local +Z is out from the finished wall. Highest handle is exactly 1.20 m.
    geo.box(asset, 0, 0.85, 0, 0.1, 0.4, 0.025, metal);
    geo.cylinder(asset, 0, 0.82, 0.11, 0.085, 0.5, body);
    geo.cylinder(asset, 0, 1.095, 0.11, 0.085, 0.05, body, {}, 0.035);
    geo.cylinder(asset, 0, 1.14, 0.11, 0.025, 0.04, metal);
    geo.box(asset, 0.025, 1.17, 0.11, 0.16, 0.02, 0.035, black);
    geo.beam(asset, [-0.04, 1.18, 0.11], [0.09, 1.19, 0.11], 0.02, metal);
    const gauge = geo.cylinder(asset, 0, 1.135, 0.16, 0.023, 0.02, label);
    gauge.rotation.x = Math.PI / 2;
    geo.box(asset, 0, 0.84, 0.197, 0.095, 0.17, 0.007, label);
    for (const [a, b] of [
      [
        [-0.035, 1.14, 0.11],
        [-0.12, 1.11, 0.11],
      ],
      [
        [-0.12, 1.11, 0.11],
        [-0.125, 0.75, 0.11],
      ],
      [
        [-0.125, 0.75, 0.11],
        [-0.1, 0.67, 0.11],
      ],
    ])
      geo.beam(asset, a, b, 0.018, black);
    geo.box(asset, -0.1, 0.66, 0.11, 0.035, 0.09, 0.035, black);
    // One physical sign. A front face stays visible above the unit while both
    // side faces identify it along the corridor; a single blade was edge-on here.
    const sign = new THREE.Mesh(
      station.projecting ? projectingGeometry : signGeometry,
      signMaterial,
    );
    sign.position.set(0, station.signHeight, station.projecting ? 0.12 : 0.02);
    sign.userData = {
      ...station,
      assetId: station.signId,
      stationId: station.assetId,
      kind: "extinguisher-sign",
      label: `${station.signId} · ${station.location}`,
    };
    asset.add(sign);
    geo.box(asset, 0, station.signHeight, 0, 0.035, 0.14, 0.025, metal);
    assets.push({ station, asset, sign });
  }
  geo.flush();
  return { stations: EXTINGUISHERS, layers, assets, signMaterial };
}

/* Presentation only: the original model, metadata and visibility remain authoritative. */
import * as THREE from "three";
import { isVisible } from "./geometry.js";

const TECHNICAL = new Set([
  "equipment",
  "equipment-port",
  "equipment-clearance",
  "main-service",
  "service-envelope",
  "hvac",
  "plumbing",
  "air-terminal",
  "room-device",
  "washroom-point",
  "ceiling-light",
  "corridor-light",
  "balancing-damper",
  "rooftop-equipment",
  "outdoor-air-intake",
  "exhaust-outlet",
  "fire-extinguisher",
  "extinguisher-sign",
  "egress-sign",
  "egress-route",
]);
const QUIET = new Set([
  "furniture",
  "fixture",
  "tree",
  "tree-trunk",
  "planter",
  "paving",
  "paver",
  "site",
  "bench",
  "bicycle-rack",
  "refuse-bin",
  "service-yard",
]);

export class BlueprintPresentation {
  constructor(scene, root, surroundings = []) {
    Object.assign(this, { scene, root, surroundings });
    this.enabled = false;
    this.records = [];
    this.overlays = [];
    this.resources = new Set();
    this.normal = {
      background: scene.background,
      fog: scene.fog,
      environment: scene.environment,
    };
    this.selectionRecords = [];
    this.selectionKey = "";
  }
  own(resource) {
    this.resources.add(resource);
    return resource;
  }
  prepare() {
    if (this.auxiliary) return;
    this.auxiliary = new THREE.Group();
    this.auxiliary.name = "Blueprint presentation (non-pickable)";
    this.scene.add(this.auxiliary);
    for (const [divisions, opacity] of [
      [100, 0.09],
      [20, 0.16],
    ]) {
      const grid = new THREE.GridHelper(100, divisions, 0x527fac, 0x527fac);
      grid.position.y = -0.445;
      grid.material.transparent = true;
      grid.material.opacity = opacity;
      grid.material.depthWrite = false;
      grid.renderOrder = -100;
      grid.raycast = () => {};
      this.own(grid.geometry);
      this.own(grid.material);
      this.auxiliary.add(grid);
    }
    this.highlight = new THREE.Box3Helper(new THREE.Box3(), 0xffe49b);
    this.highlight.material.depthTest = false;
    this.highlight.material.transparent = true;
    this.highlight.material.opacity = 0.95;
    this.highlight.renderOrder = 20;
    this.highlight.raycast = () => {};
    this.own(this.highlight.geometry);
    this.own(this.highlight.material);
    this.auxiliary.add(this.highlight);

    const edges = new Map(),
      basics = new Map();
    const surface = (quiet, hatching = false) =>
      this.own(
        new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
          uniforms: {
            quiet: { value: quiet ? 1 : 0 },
            hatching: { value: hatching ? 1 : 0 },
          },
          vertexShader: `
        varying vec3 worldPoint;
        void main() {
          vec4 p = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            p = instanceMatrix * p;
          #endif
          vec4 world = modelMatrix * p;
          worldPoint = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
          fragmentShader: `
        uniform float quiet;
        uniform float hatching;
        varying vec3 worldPoint;
        void main() {
          float stripe = (worldPoint.x + worldPoint.y + worldPoint.z) / 0.48;
          float width = max(fwidth(stripe), 0.001);
          float hatch = (1.0 - smoothstep(0.008, 0.008 + width, abs(fract(stripe) - 0.5))) * hatching;
          vec3 color = mix(vec3(0.09, 0.23, 0.42), vec3(0.8, 0.91, 1.0), hatch * (1.0 - quiet));
          gl_FragColor = vec4(color, mix(0.055 + hatch * 0.045, 0.035, quiet));
        }`,
        }),
      );
    const architecture = surface(false),
      hatched = surface(false, true),
      quiet = surface(true);
    const edgeMaterial = (instanced) =>
      this.own(
        new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          vertexShader: `
        ${instanced ? "attribute vec4 bp0; attribute vec4 bp1; attribute vec4 bp2; attribute vec4 bp3; attribute float bpStrength;" : ""}
        varying float strength;
        void main() {
          vec4 p = vec4(position, 1.0);
          ${instanced ? "p = mat4(bp0, bp1, bp2, bp3) * p; strength = bpStrength;" : "strength = 1.0;"}
          gl_Position = projectionMatrix * modelViewMatrix * p;
        }`,
          fragmentShader: `varying float strength; void main() {
        if (strength < 0.01) discard;
        gl_FragColor = vec4(0.87, 0.95, 1.0, 0.34 * strength);
      }`,
        }),
      );
    const edgeMaterials = [edgeMaterial(false), edgeMaterial(true)];
    const meshes = [];
    this.root.traverse((o) => {
      if (o.isMesh) meshes.push(o);
    });
    meshes.push(...this.surroundings);
    for (const mesh of meshes) {
      const metadata = mesh.userData.instances || [mesh.userData];
      const technical = metadata.some((d) => TECHNICAL.has(d.kind));
      const reduced =
        this.surroundings.includes(mesh) ||
        metadata.every((d) => QUIET.has(d.kind));
      const convert = (original) => {
        if (!technical)
          return reduced
            ? quiet
            : metadata.some((d) =>
                  ["partition", "opaque", "structure"].includes(d.kind),
                )
              ? hatched
              : architecture;
        if (!basics.has(original)) {
          const color = original.color?.clone() || new THREE.Color(0xb5d4e9);
          // Keep safety textures and system hues; unlit colours stay legible on navy.
          if (!original.map) color.lerp(new THREE.Color(0xd4edff), 0.18);
          basics.set(
            original,
            this.own(
              new THREE.MeshBasicMaterial({
                color,
                map: original.map || null,
                transparent: original.transparent,
                opacity: original.opacity,
                side: original.side,
                depthWrite: original.depthWrite,
                depthTest: original.depthTest,
                alphaTest: original.alphaTest,
                toneMapped: false,
              }),
            ),
          );
        }
        return basics.get(original);
      };
      this.records.push({
        mesh,
        original: mesh.material,
        blueprint: Array.isArray(mesh.material)
          ? mesh.material.map(convert)
          : convert(mesh.material),
        metadata,
      });
      // Clean crease edges, never triangle wireframes. Furniture stays a quiet silhouette.
      if (
        reduced ||
        (technical &&
          !metadata.some((d) =>
            ["equipment", "rooftop-equipment"].includes(d.kind),
          ))
      )
        continue;
      if (!edges.has(mesh.geometry))
        edges.set(
          mesh.geometry,
          this.own(new THREE.EdgesGeometry(mesh.geometry, 35)),
        );
      let geometry = edges.get(mesh.geometry);
      if (mesh.isInstancedMesh) {
        const instanced = this.own(new THREE.InstancedBufferGeometry());
        instanced.setAttribute("position", geometry.getAttribute("position"));
        const matrices = new THREE.InstancedInterleavedBuffer(
          mesh.instanceMatrix.array.slice(0, mesh.count * 16),
          16,
        );
        for (let i = 0; i < 4; i++)
          instanced.setAttribute(
            `bp${i}`,
            new THREE.InterleavedBufferAttribute(matrices, 4, i * 4),
          );
        instanced.setAttribute(
          "bpStrength",
          new THREE.InstancedBufferAttribute(
            new Float32Array(metadata.map((d) => (QUIET.has(d.kind) ? 0 : 1))),
            1,
          ),
        );
        instanced.instanceCount = mesh.count;
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
        instanced.boundingBox = mesh.boundingBox.clone();
        instanced.boundingSphere = mesh.boundingSphere.clone();
        geometry = instanced;
      }
      const outline = new THREE.LineSegments(
        geometry,
        edgeMaterials[mesh.isInstancedMesh ? 1 : 0],
      );
      outline.name = "Blueprint crease edges";
      outline.userData.blueprintOverlay = true;
      outline.frustumCulled = false; // Unit-geometry bounds omit the instance transforms.
      outline.raycast = () => {};
      mesh.add(outline); // Inherit every existing floor/layer/visibility transform.
      this.overlays.push(outline);
    }
  }
  setEnabled(enabled) {
    if (enabled) this.prepare();
    this.enabled = enabled;
    for (const o of this.overlays) o.visible = enabled;
    if (this.auxiliary) this.auxiliary.visible = enabled;
    this.scene.background = enabled
      ? new THREE.Color(0x071b38)
      : this.normal.background;
    this.scene.fog = enabled ? null : this.normal.fog;
    this.scene.environment = enabled ? null : this.normal.environment;
  }
  select(part) {
    this.part = part;
    this.selectionKey = "";
  }
  updateHighlight() {
    const part = this.part;
    const id = part?.deviceId || part?.equipmentId || part?.assetId;
    if (!id || part.kind === "room") {
      this.highlight.visible = false;
      return;
    }
    if (id !== this.selectionKey) {
      this.selectionKey = id;
      this.selectionRecords = this.records.flatMap((r) =>
        r.metadata.flatMap((d, index) =>
          [d.deviceId, d.equipmentId, d.assetId].includes(id)
            ? [{ ...r, index }]
            : [],
        ),
      );
    }
    this.root.updateWorldMatrix(true, true);
    const bounds = this.highlight.box.makeEmpty();
    for (const { mesh, index } of this.selectionRecords) {
      if (!isVisible(mesh)) continue;
      mesh.geometry.computeBoundingBox();
      const matrix = mesh.matrixWorld.clone();
      if (mesh.isInstancedMesh) {
        const local = new THREE.Matrix4();
        mesh.getMatrixAt(index, local);
        matrix.multiply(local);
      }
      bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(matrix));
    }
    this.highlight.visible = !bounds.isEmpty();
    if (this.highlight.visible) bounds.expandByScalar(0.055);
  }
  render(renderer, camera) {
    if (!this.enabled) return renderer.render(this.scene, camera);
    this.updateHighlight();
    const shadows = renderer.shadowMap.enabled;
    try {
      renderer.shadowMap.enabled = false;
      for (const r of this.records) r.mesh.material = r.blueprint;
      renderer.render(this.scene, camera);
    } finally {
      for (const r of this.records) r.mesh.material = r.original;
      renderer.shadowMap.enabled = shadows;
    }
  }
  dispose() {
    this.setEnabled(false);
    for (const o of this.overlays) o.removeFromParent();
    this.auxiliary?.removeFromParent();
    for (const r of this.resources) r.dispose();
    this.resources.clear();
    this.records = [];
    this.overlays = [];
    this.auxiliary = null;
    this.selectionKey = "";
    this.selectionRecords = [];
  }
}

/* Lightweight reusable primitives. Instance metadata keeps architectural assets pickable. */
import * as THREE from "three";

export function group(parent, name, data = {}) {
  const result = new THREE.Group();
  result.name = name;
  result.userData = data;
  parent.add(result);
  return result;
}
export const finish = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.72, ...extra });

export function builder() {
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const batches = new Map();
  function box(parent, x, y, z, w, h, d, material, data = {}, rotation = 0) {
    if (!batches.has(parent)) batches.set(parent, new Map());
    const collection = batches.get(parent);
    const key = `${material.uuid}:${data.side || ""}`;
    if (!collection.has(key))
      collection.set(key, { material, matrices: [], data: [] });
    const batch = collection.get(key);
    const quaternion =
      typeof rotation === "number"
        ? new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            rotation,
          )
        : rotation;
    batch.matrices.push(
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        quaternion,
        new THREE.Vector3(w, h, d),
      ),
    );
    batch.data.push({ ...parent.userData, ...data });
  }
  function beam(parent, a, b, width, material, data = {}) {
    const start = new THREE.Vector3(...a),
      end = new THREE.Vector3(...b);
    const delta = end.clone().sub(start);
    if (delta.length() < 0.0001) return;
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      delta.clone().normalize(),
    );
    const c = start.add(end).multiplyScalar(0.5);
    box(parent, c.x, c.y, c.z, width, delta.length(), width, material, data, q);
  }
  const cylinders = new Map();
  function cylinder(
    parent,
    x,
    y,
    z,
    radius,
    height,
    material,
    data = {},
    top = radius,
  ) {
    const key = `${radius}:${height}:${top}`;
    if (!cylinders.has(key))
      cylinders.set(key, new THREE.CylinderGeometry(top, radius, height, 12));
    const object = new THREE.Mesh(cylinders.get(key), material);
    object.position.set(x, y, z);
    object.userData = { ...parent.userData, ...data };
    object.castShadow = true;
    parent.add(object);
    return object;
  }
  function plate(
    parent,
    bounds,
    y,
    thickness,
    material,
    holes = [],
    data = {},
  ) {
    const { x1, x2, z1, z2 } = bounds;
    const shape = new THREE.Shape();
    shape.moveTo(x1, z1);
    shape.lineTo(x2, z1);
    shape.lineTo(x2, z2);
    shape.lineTo(x1, z2);
    shape.closePath();
    for (const b of holes) {
      const path = new THREE.Path();
      path.moveTo(b.x1, b.z1);
      path.lineTo(b.x1, b.z2);
      path.lineTo(b.x2, b.z2);
      path.lineTo(b.x2, b.z1);
      path.closePath();
      shape.holes.push(path);
    }
    const object = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, {
        depth: thickness,
        bevelEnabled: false,
      }),
      material,
    );
    object.rotation.x = Math.PI / 2;
    object.position.y = y;
    object.userData = { ...parent.userData, ...data };
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  function slopedSurface(
    parent,
    b,
    rearY,
    fall,
    material,
    data = {},
    holes = [],
  ) {
    // Low at the rear outlet, rising toward the front. A shallow waterproof finish.
    const object = plate(parent, b, rearY, 0.045, material, holes, data);
    const position = object.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const z = position.getY(i);
      position.setZ(i, position.getZ(i) - ((z - b.z1) / (b.z2 - b.z1)) * fall);
    }
    position.needsUpdate = true;
    object.geometry.computeVertexNormals();
    return object;
  }
  function flush() {
    for (const [parent, collection] of batches)
      for (const batch of collection.values()) {
        const material = batch.material;
        const object = new THREE.InstancedMesh(
          unit,
          material,
          batch.matrices.length,
        );
        batch.matrices.forEach((matrix, index) =>
          object.setMatrixAt(index, matrix),
        );
        object.instanceMatrix.needsUpdate = true;
        object.userData = {
          ...parent.userData,
          side: batch.data[0]?.side,
          instances: batch.data,
        };
        object.castShadow = !material.transparent;
        object.receiveShadow = !material.transparent;
        parent.add(object);
      }
    batches.clear();
  }
  return { box, beam, cylinder, plate, slopedSurface, flush };
}

export function isVisible(object) {
  for (let node = object; node; node = node.parent)
    if (!node.visible) return false;
  return true;
}

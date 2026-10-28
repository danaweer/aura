import { isVisible } from "./geometry.js";

export function applyBuildingVisibility(model, state) {
  const isolated = state.floor !== "all";
  const interior = ["offices", "plan"].includes(state.view);
  const opened =
    interior || isolated || state.cutaway || state.view === "atrium";
  model.floors.forEach((floor, index) => {
    floor.visible = !isolated || index === Number(state.floor);
  });
  model.egress?.signs.forEach((part) => {
    part.visible = state.egressSigns !== false;
  });
  model.egress?.routes.forEach((part) => {
    part.visible = !!state.egressPaths && !model.egress.current;
  });
  model.egress?.selected.forEach((part) => {
    part.visible = !!state.egressPaths;
  });
  if (model.egress) {
    const ground = !isolated || state.floor === "0";
    model.egress.outdoorSigns.visible =
      ground && state.egressSigns !== false && !interior;
    model.egress.outdoorRoutes.visible = ground && !!state.egressPaths;
    for (const child of model.egress.outdoorRoutes.children)
      child.visible =
        child === model.egress.selectedOutdoor || !model.egress.current;
  }
  model.roof.visible = state.roof && !opened;
  model.yard.visible = state.services && (!isolated || state.floor === "0");
  model.architecture.facades.forEach(({ exterior }) => {
    exterior.visible = !interior;
  });
  model.services.ceilings.forEach((part) => {
    part.visible = state.ceilings && !opened;
  });
  model.services.distribution.forEach((part) => {
    part.visible = state.systems;
  });
  model.services.rooftop.visible = state.systems;
  model.services.riserShell.visible = !opened;
  model.architecture.drainage.visible = !opened;
  model.architecture.site.visible =
    !isolated || (!interior && state.floor === "0");
  model.architecture.balconies.visible = !isolated || state.floor === "2";
  model.interiors.forEach((part) => {
    part.walls.visible = state.partitions;
    part.walls.scale.y = state.lowWalls && opened ? 0.85 / 3.2 : 1;
    part.furniture.visible = state.furniture;
    part.reserves.visible = state.services;
  });
  model.root.traverse((object) => {
    if (!object.isMesh) return;
    const glass = object.material === model.materials.glass;
    const front = object.userData.side === "front";
    const oldExterior =
      ["front", "back", "left", "right"].includes(object.userData.side) &&
      ["glass", "structure"].includes(object.userData.kind);
    object.visible =
      (!glass || state.glass) &&
      !(interior && oldExterior) &&
      !(
        opened &&
        front &&
        !interior &&
        (["glass", "structure"].includes(object.userData.kind) ||
          object.parent?.parent?.userData.layer === "envelope")
      );
  });
  return { isolated, opened, interior };
}

// Three.js raycasts hidden meshes too. Filter the complete ancestor chain so hidden
// floors, ceilings, roofs and systems never steal an asset or room selection.
export function visibleIntersections(raycaster, root) {
  return raycaster
    .intersectObject(root, true)
    .filter((hit) => isVisible(hit.object));
}

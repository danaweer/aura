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
  model.extinguishers?.layers.forEach((part) => {
    part.visible = state.extinguishers !== false;
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
  if (model.equipment) {
    const shown = state.equipment !== false;
    model.equipment.layers.forEach((g) => (g.visible = shown));
    model.equipment.yard.visible = shown && (!isolated || state.floor === "0");
    for (const a of model.equipment.assets) {
      if (a.ports) a.ports.visible = !!state.equipmentPorts;
      if (a.clearanceGroup)
        a.clearanceGroup.visible = !!state.equipmentClearances;
    }
    model.equipment.connections.forEach(
      (g) =>
        (g.visible =
          shown && !!state.equipmentConnections && !model.mainServices),
    );
    model.equipment.roofConnections.visible =
      shown && !!state.equipmentConnections && !model.mainServices;
  }
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
  model.services.plumbing.roof.visible = state.systems;
  model.interiors.forEach((part) => {
    part.washrooms.clearances.visible = !!state.washroomClearances;
    part.washrooms.markers.visible = !!state.washroomPoints;
    for (const door of part.washrooms.doors)
      door.object.rotation.y = state.washroomDoors ? door.openAngle : 0;
  });
  model.services.riserShell.visible = !opened;
  if (model.mainServices) {
    const settings = state.serviceLayers || {};
    const enabled = (system) =>
      settings[system === "tempered" ? "hot" : system] !== false;
    for (const layer of model.mainServices.layers)
      for (const [system, g] of Object.entries(layer))
        g.visible = state.systems && enabled(system);
    for (const [system, g] of Object.entries(model.mainServices.roofLayers))
      g.visible = state.systems && enabled(system);
    model.mainServices.groundPlant.visible =
      state.systems &&
      state.equipment !== false &&
      (enabled("supply") || enabled("return"));
    for (const a of model.mainServices.assets.filter(
      (a) => a.role === "indoor-reservation",
    ))
      a.object.visible = state.equipment !== false;
    for (const g of [
      ...model.services.distribution,
      model.services.rooftop,
      model.services.plumbing.roof,
    ])
      g.traverse((part) => {
        if (part.isGroup && part.userData.system)
          part.visible = enabled(part.userData.system);
      });
    for (const g of model.services.legacyAir) g.visible = false;
    model.root.traverse((g) => {
      if (g.isGroup && ["insulation", "access"].includes(g.userData.diagram))
        g.visible =
          g.userData.diagram === "insulation"
            ? !!state.serviceEnvelopes
            : !!state.serviceAccess;
    });
    model.mainServices.reservations.forEach((r) => {
      if (!r.data.diagram) r.object.visible = state.serviceShafts !== false;
    });
  }
  model.architecture.drainage.visible = !opened;
  if (model.architecture.canopy) model.architecture.canopy.visible = !opened;
  if (model.devices) {
    const active = state.devices === true,
      settings = state.deviceCategories || {},
      enabled = (c) => settings[c] !== false;
    for (const layer of model.devices.layers)
      for (const [category, g] of Object.entries(layer))
        g.visible = active && enabled(category);
    model.devices.roofStudies.visible = active && enabled("pending");
    for (const layer of model.devices.connectionLayers) {
      layer.visible = active && !!state.deviceConnections;
      for (const child of layer.children)
        child.visible = enabled(child.userData.category);
    }
    for (const alias of model.devices.aliases)
      alias.wrapper.visible =
        !!state.washroomPoints && !(active && enabled(alias.record.category));
    for (const layer of model.services.lighting)
      layer.visible = active ? enabled("lighting") : state.ceilings && !opened;
    // Reset the optional diagram-only inspection state on every update.
    for (const r of model.services.routes)
      r.group.visible =
        !r.superseded && state.serviceLayers?.[r.system] !== false;
    for (const part of model.services.plumbing.layers) part.visible = true;
    for (const terminal of model.services.terminalGroups)
      terminal.visible =
        state.serviceLayers?.[terminal.userData.system] !== false &&
        !(state.devicePlanMode && !terminal.userData.deviceId);
    if (state.devicePlanMode && !state.deviceRoutes) {
      for (const layer of model.mainServices.layers)
        for (const g of Object.values(layer)) g.visible = false;
      for (const r of model.services.routes) r.group.visible = false;
      for (const part of model.services.plumbing.layers) part.visible = false;
      for (const part of model.services.distribution)
        for (const g of part.children)
          if (g.name === "Sanitary fan and damper reservations")
            g.visible = false;
    }
    for (const part of model.services.distribution)
      for (const g of part.children)
        if (
          g.name === "Sanitary fan and damper reservations" &&
          !state.devicePlanMode
        )
          g.visible = state.serviceLayers?.exhaust !== false;
  }
  model.architecture.site.visible =
    !isolated || (!interior && state.floor === "0");
  model.architecture.balconies.visible = !isolated || state.floor === "2";
  model.interiors.forEach((part) => {
    part.walls.visible = state.partitions;
    const detail = state.washroomDetail && opened;
    part.walls.scale.y = (state.lowWalls || detail) && opened ? 0.85 / 3.2 : 1;
    // Inspection cutaway lowers the perimeter only, keeping the new cubicles
    // and doors full size so the washroom layout remains understandable.
    for (const partition of part.washrooms.partitions)
      partition.scale.y = detail ? 1 / part.walls.scale.y : 1;
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

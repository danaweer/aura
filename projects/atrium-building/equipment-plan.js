/* Equipment Placement Guide P01, pp.1–4. Coordinates use the retained model.
   Footprints, service envelopes and yard zones are movable concept proposals. */
import { ALL_ROOMS, ENVELOPE, ROOM_FLOOR_TOP } from "./layout.js";
export const EQUIPMENT_YARD_PAD_TOP = 0.05;
const roomById = new Map(ALL_ROOMS.map((r) => [r.id, r]));
function asset(id, roomId, type, x, z, size, options = {}) {
  const room = roomById.get(roomId),
    floor = room?.floor ?? 0;
  return {
    assetId: id,
    roomId,
    floor,
    kind: "equipment",
    type,
    x,
    z,
    y:
      floor * ENVELOPE.floorHeight +
      (room ? ROOM_FLOOR_TOP : EQUIPMENT_YARD_PAD_TOP),
    size,
    rotation: 0,
    serviceFace: [0, 1],
    sourcePage: floor ? floor + 1 : 1,
    source: "Equipment Placement Guide · P01",
    status: "SIMULATED",
    dataSource: "model-placeholder",
    connected: false,
    monitoringOnly: true,
    controlAvailable: false,
    detail:
      "Proposed equipment placement. Geometry and clearances are illustrative; no duty, capacity, rating or operating state is verified.",
    ...options,
    serviceFace: options.serviceFace || [
      Math.sin(options.rotation || 0),
      Math.cos(options.rotation || 0),
    ],
  };
}
// size = local width × depth × height; rotations orient access faces into aisles.
export const EQUIPMENT = [
  asset("FP-01", "G-M01", "pump", -11.55, -8.5, [2, 0.9, 1.1], {
    label: "Main fire pump and motor",
    system: "fire-water",
    clearance: 1.15,
  }),
  asset("JP-01", "G-M01", "jockey", -10.1, -6.95, [0.5, 0.5, 1], {
    label: "Jockey pump",
    system: "fire-water",
    rotation: Math.PI,
    clearance: 0.8,
  }),
  asset("CP-FP-01", "G-M01", "cabinet", -13.55, -10.5, [0.8, 0.4, 1.8], {
    label: "Main fire-pump controller",
    system: "fire-monitoring",
    rotation: Math.PI / 2,
    clearance: 1.1,
  }),
  asset("CP-JP-01", "G-M01", "cabinet", -13.55, -7, [0.5, 0.3, 1.35], {
    label: "Separate jockey-pump controller",
    system: "fire-monitoring",
    rotation: Math.PI / 2,
    clearance: 1.0,
  }),
  asset("BS-G-01", "G-M02", "booster", -7.1, -8.5, [1.5, 0.8, 1.2], {
    label: "Proposed two-pump domestic booster skid",
    system: "domestic-water",
    serviceFace: [0, -1],
    rotation: Math.PI,
    clearance: 1.0,
  }),
  asset("PV-G-01", "G-M02", "vessel", -8.5, -7, [0.55, 0.55, 1.3], {
    label: "Domestic pressure vessel",
    system: "domestic-water",
    rotation: Math.PI,
    clearance: 0.8,
  }),
  asset("CP-BS-G-01", "G-M02", "cabinet", -5.5, -9.7, [0.7, 0.35, 1.5], {
    label: "Domestic booster control panel",
    system: "domestic-water",
    rotation: -Math.PI / 2,
    clearance: 1.05,
  }),
  asset("MDB-G-01", "G-E01", "board", 5.65, -9, [2.4, 0.8, 2], {
    label: "Main distribution board",
    system: "electrical",
    rotation: Math.PI / 2,
    clearance: 1.4,
  }),
  asset("SR-G-01", "G-I01", "rack", 10.65, -9.05, [0.6, 1, 2], {
    label: "Server rack",
    system: "IT",
    clearance: 1.0,
    rearClearance: 1.0,
  }),
  asset("UPS-G-01", "G-I01", "cabinet", 12.8, -10, [0.6, 0.8, 1.2], {
    label: "Server UPS · battery arrangement unresolved",
    system: "electrical",
    clearance: 1.0,
  }),
  asset("CRAC-G-01", "G-I01", "cooling", 13.5, -11, [0.75, 0.35, 1.8], {
    label: "Dedicated server cooling reservation",
    system: "cooling",
    rotation: -Math.PI / 2,
    clearance: 0.9,
  }),
  asset("GW-G-01", "G-B01", "cabinet", 9.15, -4.7, [0.6, 0.3, 1.2], {
    label: "BMS control / gateway cabinet",
    system: "BMS",
    rotation: -Math.PI / 2,
    clearance: 0.9,
  }),
  ...["G", "L1", "L2"].flatMap((prefix) => [
    asset(
      `NET-${prefix}-01`,
      `${prefix}-I02`,
      "rack",
      10.25,
      -2.1,
      [0.6, 0.8, 1.8],
      {
        label: `${prefix} floor network rack`,
        system: "IT",
        clearance: 0.9,
        rearClearance: 0.35,
      },
    ),
    asset(
      `DB-${prefix}`,
      `${prefix}-I02`,
      "board",
      13.35,
      -2.5,
      [0.8, 0.3, 1.5],
      {
        label: `${prefix} floor distribution board · separate electrical zone`,
        system: "electrical",
        rotation: -Math.PI / 2,
        clearance: 1.0,
      },
    ),
  ]),
  ...[1, 2].map((f) =>
    asset(`AHU-L${f}-01`, `L${f}-M01`, "ahu", 8.35, -9.2, [1.2, 3, 1.5], {
      label: `Level ${f} indoor AHU · long axis front to back`,
      system: "ventilation",
      serviceFace: [-1, 0],
      clearance: 1.45,
      detail:
        "P01 indoor AHU envelope with west service aisle. Dashed high-level routes reserve a connection via the rear gallery/main corridor to the HVAC shaft, avoiding the adjoining flexible/records office. Existing roof ventilation headers are retained for later system consolidation; no AHU sizing or operating topology is asserted.",
    }),
  ),
  // Preserve existing condenser asset IDs while relocating the objects from roof to yard.
  asset("ROOF-West-COOL", "YARD", "condenser", 7, -18, [2.15, 1.9, 1.3], {
    label: "ODU-YARD-A · relocated outdoor cooling placeholder",
    displayId: "ODU-YARD-A",
    system: "cooling",
    clearance: 1.1,
  }),
  asset("ROOF-East-COOL", "YARD", "condenser", 12, -18, [2.15, 1.9, 1.3], {
    label: "ODU-YARD-B · relocated outdoor cooling placeholder",
    displayId: "ODU-YARD-B",
    system: "cooling",
    clearance: 1.1,
  }),
];
export const TANK_ZONES = [
  {
    id: "RES-FIRE-TANK",
    label: "Proposed fire-water tank zone · need and capacity unverified",
    x: -12,
    z: -18,
    w: 3,
    d: 3,
    h: 2.4,
  },
  {
    id: "RES-DOMESTIC-TANK",
    label:
      "Proposed domestic tank / incoming-supply zone · capacity unverified",
    x: -7.5,
    z: -18,
    w: 3,
    d: 3,
    h: 2.4,
  },
];
export const EQUIPMENT_YARD = { x1: 4.5, x2: 15, z1: -19.7, z2: -15.65 };
export function equipmentBounds(a) {
  const [w, d, h] = a.size,
    c = Math.abs(Math.cos(a.rotation)),
    s = Math.abs(Math.sin(a.rotation));
  const dx = (w * c + d * s) / 2,
    dz = (w * s + d * c) / 2;
  return {
    x1: a.x - dx,
    x2: a.x + dx,
    z1: a.z - dz,
    z2: a.z + dz,
    y1: a.y,
    y2: a.y + h,
  };
}

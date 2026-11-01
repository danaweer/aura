/* PDF Room Device Positions D02, 1 Nov 2026. Symbols are room-relative
   candidates; actual model walls, fixtures and routes control final placement. */
export const DEVICE_TYPES = {
  S: {
    label: "Supply outlet",
    color: 0x148eaa,
    category: "air",
    sensor: false,
  },
  R: {
    label: "Return connection",
    color: 0x607e89,
    category: "air",
    sensor: false,
  },
  E: {
    label: "Toilet extract",
    color: 0x9d6245,
    category: "air",
    sensor: false,
  },
  O: {
    label: "Occupancy candidate",
    color: 0x8b5db5,
    category: "sensors",
    sensor: true,
  },
  T: {
    label: "Temperature candidate",
    color: 0xe58435,
    category: "sensors",
    sensor: true,
  },
  Q: {
    label: "Temperature + CO₂ candidate",
    color: 0xd97125,
    category: "sensors",
    sensor: true,
  },
  W: {
    label: "Leak candidate",
    color: 0x318ccb,
    category: "sensors",
    sensor: true,
  },
  L: {
    label: "Lighting illustration",
    color: 0xc6a246,
    category: "lighting",
    sensor: false,
  },
  SW: {
    label: "Local lighting switch",
    color: 0xa3a9a3,
    category: "switches",
    sensor: false,
  },
  P: {
    label: "Plant measurement / interface",
    color: 0x466976,
    category: "plant",
    sensor: true,
  },
  Z: {
    label: "Lighting work zone",
    color: 0xb9912c,
    category: "zones",
    sensor: false,
  },
  F: {
    label: "Fire / atrium study pending",
    color: 0xa88484,
    category: "pending",
    sensor: false,
  },
};
export const DEVICE_CATEGORIES = {
  sensors: "O / T / Q / W candidates",
  air: "S / R / E terminal labels",
  lighting: "Illustrative lighting",
  switches: "Local switches",
  plant: "Plant probes / interfaces",
  zones: "L lighting work zones",
  pending: "Design-pending studies",
};
export const Q_ROOMS = [
  "G-03",
  "G-04",
  "G-05",
  "L1-07",
  "L1-05",
  "L2-07",
  "L2-04",
  "L2-05",
];
export const LARGE_SUPPLY_ROOMS = ["G-05", "L1-01", "L1-04", "L2-01", "L2-04"];
export function deviceRoomSpec(room) {
  const code = room.id.split("-").at(-1),
    ordinary = /^0[1-9]$/.test(code) || code === "B01",
    sanitary = ["wc", "accessible-wc"].includes(room.furniture),
    pantry = code === "P01";
  const plant = [
    "G-M01",
    "G-M02",
    "G-E01",
    "G-I01",
    "L1-M01",
    "L2-M01",
  ].includes(room.id);
  return {
    ordinary,
    sanitary,
    pantry,
    plant,
    occupancy: ordinary || sanitary || pantry,
    roomSensor: ordinary
      ? Q_ROOMS.includes(room.id)
        ? "Q"
        : "T"
      : plant
        ? "T"
        : null,
    supplyCount: ordinary
      ? LARGE_SUPPLY_ROOMS.includes(room.id)
        ? 2
        : 1
      : pantry
        ? 1
        : 0,
    returnCount: ordinary ? 1 : 0,
    page:
      (room.floor ?? (room.id.startsWith("G-") ? 0 : Number(room.id[1]))) + 1,
    review:
      code === "08" || code === "09"
        ? "Use, contents and equipment need review before sensor coverage and HVAC zoning are selected."
        : "Coverage and device quantities remain unverified.",
  };
}
export function roomPoint(room, u, v, y = 0) {
  const b = room.bounds;
  return [b.x1 + (b.x2 - b.x1) * u, y, b.z1 + (b.z2 - b.z1) * v];
}
export function deviceAirCandidates(room, y) {
  const spec = deviceRoomSpec(room);
  if (spec.pantry)
    return { supply: [roomPoint(room, 0.6, 0.78, y)], return: [] };
  if (!spec.ordinary) return null;
  return {
    supply: [
      roomPoint(room, 0.3, 0.72, y),
      ...(spec.supplyCount === 2 ? [roomPoint(room, 0.7, 0.28, y)] : []),
    ],
    return: [roomPoint(room, 0.8, 0.8, y)],
  };
}
export function wallPose(room, side, ratio, height = 1.5) {
  const b = room.bounds,
    axis = ["W", "E"].includes(side) ? 2 : 0;
  const position =
    side === "W"
      ? [b.x1 + 0.09, height, b.z1 + (b.z2 - b.z1) * ratio]
      : side === "E"
        ? [b.x2 - 0.09, height, b.z1 + (b.z2 - b.z1) * ratio]
        : side === "N"
          ? [b.x1 + (b.x2 - b.x1) * ratio, height, b.z1 + 0.09]
          : [b.x1 + (b.x2 - b.x1) * ratio, height, b.z2 - 0.09];
  const normal =
    side === "W"
      ? [1, 0, 0]
      : side === "E"
        ? [-1, 0, 0]
        : side === "N"
          ? [0, 0, 1]
          : [0, 0, -1];
  return { position, normal, side, axis };
}
export function wallCandidates(room) {
  const b = room.bounds,
    west = b.x2 < 0,
    code = room.id.split("-").at(-1);
  const preferred = ["E01", "M01"].includes(code)
    ? "E"
    : ["08", "09", "I01", "M02"].includes(code)
      ? "W"
      : west
        ? "E"
        : "W";
  const ratios = ["08", "E01", "M01"].includes(code)
    ? [0.3, 0.44, 0.66, 0.8]
    : ["09", "I01", "M02"].includes(code)
      ? [0.78, 0.62, 0.38, 0.22]
      : [0.58, 0.36, 0.75, 0.22, 0.88];
  return [preferred, "N", "S", "W", "E"]
    .filter((s, i, a) => a.indexOf(s) === i)
    .flatMap((side) => {
      const outer =
        (side === "W" && b.x1 === -20) ||
        (side === "E" && b.x2 === 20) ||
        (side === "N" && b.z1 === -12) ||
        (side === "S" && b.z2 === 12);
      const glazed =
        (side === "W" && b.x1 === 5) || (side === "E" && b.x2 === -5);
      return outer || glazed ? [] : ratios.map((t) => wallPose(room, side, t));
    });
}

export function deviceOccupancyCandidate(room, y = 3.06) {
  const spec = deviceRoomSpec(room);
  if (!spec.occupancy) return null;
  if (spec.sanitary) {
    const b = room.bounds;
    return [b.x1 > 0 ? b.x2 - 2.8 : b.x1 + 2.8, y, b.z2 - 2.0];
  }
  return roomPoint(room, 0.3, spec.pantry ? 0.78 : 0.3, y);
}

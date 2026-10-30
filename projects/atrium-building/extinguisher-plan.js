/* PDF F01 pp.11–14. Source coordinates: front-left origin, X right, Y rear.
   Model coordinates: X centred, +Z front; all heights above the local floor. */
import { ENVELOPE } from "./layout.js";

export const EXTINGUISHER_BASIS = {
  revision: "F01",
  topHeight: 1.2,
  signHeight: 2.1,
  signSize: 0.2,
  status: "Proposed PDF placement; equipment selection and coverage unverified",
};
// num, source X/Y, facing (in the PDF coordinate system), type, room, location.
const common = [
  [1, 4, 17.5, "+X", "ABC-O", "Circulation", "Left rear corridor"],
  [2, 36, 17.5, "-X", "ABC-O", "Circulation", "Right rear corridor"],
  [3, 7, 4.4, "+X", "ABC-O", "Circulation", "Left front spine"],
  [4, 34, 4.4, "-X", "ABC-O", "Circulation", "Right front spine"],
  [5, 13.2, 12.4, "-Y", "ABC-O", "Circulation", "Outside pantry"],
  [6, 28.7, 12.4, "-Y", "ABC-O", "Circulation", "Right inner corridor"],
];
const special = [
  [
    [7, 15, 2.6, "+X", "ABC-O", "Atrium", "Reception / entrance"],
    [8, 10.3, 24, "-Y", "ABC-S", "G-M01", "Fire pump room"],
    [9, 14, 24, "-Y", "ABC-S", "G-M02", "Water / mechanical room"],
    [10, 28.6, 24, "-Y", "ABC-S", "G-E01", "Main electrical room"],
    [11, 34, 18.8, "-X", "CA-E", "G-I01", "Server / UPS room"],
  ],
  [
    [7, 15, 18.6, "-X", "ABC-S", "L1-08", "Print / archive"],
    [8, 25, 18.6, "+X", "ABC-S", "L1-M01", "AHU / ventilation room"],
  ],
  [
    [7, 34, 18.8, "-X", "ABC-S", "L2-09", "Records / store"],
    [8, 25, 18.6, "+X", "ABC-S", "L2-M01", "AHU / ventilation room"],
  ],
];
const normals = { "+X": [1, 0], "-X": [-1, 0], "-Y": [0, 1] };
export const EXTINGUISHERS = special.flatMap((extra, floor) =>
  [...common, ...extra].map(([num, sx, sy, facing, type, roomId, location]) => {
    const prefix = floor ? `L${floor}` : "G";
    const suffix = `${prefix}-${String(num).padStart(2, "0")}`;
    const normal = normals[facing];
    const wall = { x: sx - ENVELOPE.width / 2, z: ENVELOPE.depth / 2 - sy };
    // 140 mm partitions / 280 mm external cladding; 20 mm bracket stand-off.
    const standOff = sy === 24 ? 0.16 : 0.09;
    return {
      assetId: `FE-${suffix}`,
      signId: `SG-${suffix}`,
      kind: "fire-extinguisher",
      label: `FE-${suffix} · ${location}`,
      floor,
      roomId,
      location,
      type,
      sourcePage: 11 + floor,
      source: { x: sx, y: sy, facing },
      wall,
      normal,
      x: wall.x + normal[0] * standOff,
      z: wall.z + normal[1] * standOff,
      y: floor * ENVELOPE.floorHeight,
      // One projecting identification housing for front and corridor approaches.
      projecting: num <= 4 || (floor === 0 && num === 7),
      ...EXTINGUISHER_BASIS,
    };
  }),
);

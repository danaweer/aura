/* Fitted to retained rooms, in metres. Local u: outer/service wall → aisle;
   local v: front of suite → rear. East suites mirror the west geometry. */
import { ALL_ROOMS } from "./layout.js";
export const isWashroom = (room) =>
  ["wc", "accessible-wc"].includes(room.furniture);
export function washroomPlan(room) {
  const b = room.bounds,
    suite = room.furniture === "wc",
    east = b.x1 > 0;
  const point = (u, v, y = 0) => [east ? b.x2 - u : b.x1 + u, y, b.z2 - v];
  const cubicles = suite
    ? [
        {
          id: "C01",
          u1: 0.34,
          u2: 2.04,
          v1: 1.13,
          v2: 2.18,
          wc: [0.68, 1.66],
          door: [1.3, 2.08],
          accessible: false,
        },
        {
          id: "C02",
          u1: 0.34,
          u2: 2.04,
          v1: 2.28,
          v2: 3.33,
          wc: [0.68, 2.81],
          door: [2.45, 3.23],
          accessible: false,
        },
        {
          id: "C03",
          u1: 0.34,
          u2: 2.04,
          v1: 3.43,
          v2: 5.46,
          wc: [0.68, 4.58],
          door: [3.5, 4.5],
          accessible: true,
        },
      ]
    : [
        {
          id: "C01",
          u1: 0.34,
          u2: 3.85,
          v1: 0.14,
          v2: 3.06,
          wc: [0.68, 2.45],
          accessible: true,
        },
      ];
  return {
    room,
    suite,
    east,
    point,
    cubicles,
    basins: suite
      ? [
          [3.68, 2.25],
          [3.68, 3.15],
        ]
      : [[3.68, 0.65]],
    turning: suite
      ? { u: 3.0, v: 4.55, radius: 0.8 }
      : { u: 2.55, v: 1.8, radius: 0.8 },
    transfer: suite
      ? { u1: 1.05, u2: 1.95, v1: 4.03, v2: 5.35 }
      : { u1: 1.05, u2: 1.95, v1: 1.9, v2: 2.98 },
    supply: point(suite ? 3.0 : 2.9, suite ? 1.35 : 0.7),
    extract: cubicles.map((c) => ({
      id: c.id,
      position: point(1.05, c.wc[1]),
    })),
    soil: suite ? point(0.24, 5.16) : [-11.55, 0, -5.3],
  };
}
export const WASHROOM_PLANS = ALL_ROOMS.filter(isWashroom).map(washroomPlan);
export const WASHROOM_PENETRATIONS = [-1, 1].map((side) => ({
  x1: side * 19.76 - 0.11,
  x2: side * 19.76 + 0.11,
  z1: -5.67,
  z2: -5.45,
}));
// Separate accessible WC branches use the retained R01 wet-service opening.
export const WASHROOM_ROOF_PENETRATIONS = [
  ...WASHROOM_PENETRATIONS,
  { x1: -11.66, x2: -11.44, z1: -5.41, z2: -5.19 },
];

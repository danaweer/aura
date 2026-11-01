/* R01 source mapping. Metres, Y up, front +Z. Route sizes are visual envelopes.
   New shaft volumes and penetrations are proposals, not structural alterations. */
export const ROUTE_SYSTEMS = {
  fire: { label: "Fire water", color: 0xc1423d, page: 1 },
  supply: { label: "Ventilation supply", color: 0x168d99, page: 2 },
  return: { label: "Office return / relief", color: 0x76936b, page: 2 },
  exhaust: { label: "Toilet extract", color: 0xa26d45, page: 2 },
  refrigerant: { label: "VRF refrigerant pairs", color: 0x8b68ab, page: 2 },
  condensate: { label: "Sloping condensate", color: 0x7faab5, page: 2 },
  cold: { label: "Domestic cold water", color: 0x398ac4, page: 3 },
  hot: { label: "Local hot / tempered water", color: 0xd38e55, page: 3 },
  waste: { label: "Gravity waste", color: 0x8b6450, page: 3 },
  vent: { label: "Soil vent", color: 0x78a591, page: 3 },
  power: { label: "Electrical power", color: 0xb58b21, page: 4 },
  data: { label: "Data / BMS", color: 0x8650a5, page: 4 },
  alarm: { label: "Fire-alarm pathway reservation", color: 0xc16868, page: 4 },
  smoke: { label: "Atrium smoke reservations", color: 0xa5a7ac, page: 2 },
};
export const ROUTE_PROFILES = {
  fire: {
    y: 3.84,
    z: 1.65,
    rear: 15.55,
    left: -12.75,
    right: 12.3,
    edge: 4.6,
    front: 8.9,
    width: 0.065,
    height: 0.065,
  },
  supply: {
    y: 3.69,
    z: 0.8,
    rear: 15.1,
    left: -12.15,
    right: 12.85,
    edge: 4.1,
    front: 8.6,
    width: 0.3,
    height: 0.18,
  },
  return: {
    y: 3.4,
    z: 0.35,
    rear: 14.65,
    left: -12.5,
    right: 13.5,
    edge: 3.65,
    front: 8.1,
    width: 0.24,
    height: 0.14,
  },
  power: {
    y: 3.54,
    z: 1.25,
    rear: 14.35,
    left: -11.6,
    right: 13.65,
    edge: 4.35,
    front: 9.4,
    width: 0.18,
    height: 0.07,
  },
  data: {
    y: 3.27,
    z: -0.04,
    rear: 14.85,
    left: -11.95,
    right: 13.05,
    edge: 3.9,
    front: 9.0,
    width: 0.12,
    height: 0.06,
  },
  alarm: {
    y: 3.87,
    z: 0.12,
    rear: 15.8,
    left: -12.9,
    right: 12.15,
    edge: 4.8,
    front: 9.7,
    width: 0.045,
    height: 0.045,
  },
  refrigerant: {
    y: 3.92,
    z: 0.55,
    rear: 15.3,
    left: -11.85,
    right: 13.25,
    edge: 4.5,
    front: 8.35,
    width: 0.035,
    height: 0.035,
  },
};
export const SERVICE_RESERVATIONS = {
  fire: {
    id: "FR-01",
    x: -12.45,
    z: -4.45,
    w: 0.44,
    d: 0.5,
    proposed: true,
    page: 1,
  },
  wetLeft: {
    id: "WL",
    x: -11.55,
    z: -5.3,
    w: 0.2,
    d: 0.2,
    proposed: false,
    page: 3,
  },
  wetRight: {
    id: "WR",
    x: 19.76,
    z: -5.56,
    w: 0.2,
    d: 0.2,
    proposed: true,
    page: 3,
  },
  power: {
    id: "DR-POWER",
    x: 10.0,
    z: -4.6,
    w: 0.5,
    d: 0.6,
    proposed: true,
    page: 4,
  },
  data: {
    id: "DR-DATA",
    x: 10.75,
    z: -4.6,
    w: 0.5,
    d: 0.6,
    proposed: true,
    page: 4,
  },
  alarm: {
    id: "DR-FA",
    x: 11.45,
    z: -4.6,
    w: 0.35,
    d: 0.6,
    proposed: true,
    page: 4,
  },
  hvac: {
    id: "HVAC-REF",
    x: 12.3,
    z: -4.6,
    w: 0.8,
    d: 0.6,
    proposed: false,
    page: 2,
  },
};
export const GROUND_AHU = {
  id: "AHU-G-RES",
  x: -2,
  z: -17.25,
  w: 3,
  d: 1.4,
  h: 1.5,
  supply: [-2.75, 1.58, -17.45],
  return: [-1.25, 1.58, -17.0],
  intake: [-2.8, 1.15, -18.05],
  relief: [-0.6, 1.15, -18.05],
};
export function corridorMains(p, y) {
  const h = y + p.y;
  return [
    {
      role: "WEST",
      points: [
        [-p.rear, h, -8],
        [-p.rear, h, p.z],
        [-p.edge, h, p.z],
      ],
    },
    {
      role: "EAST",
      points: [
        [p.edge, h, p.z],
        [p.rear, h, p.z],
        [p.rear, h, -8],
      ],
    },
    {
      role: "WEST-FRONT",
      points: [
        [p.left, h, p.z],
        [p.left, h, 11.35],
      ],
    },
    {
      role: "EAST-FRONT",
      points: [
        [p.right, h, p.z],
        [p.right, h, 11.35],
      ],
    },
    {
      role: "FRONT-GALLERY",
      points: [
        [-p.edge, h, p.z],
        [-p.edge, h, p.front],
        [p.edge, h, p.front],
        [p.edge, h, p.z],
      ],
    },
  ];
}
// Schematic louvre/duct openings in opaque service-room rear walls.
// Protection, weathering and acoustic details remain pending.
export const SERVICE_FACADE_OPENINGS = [
  {
    id: "G-SA",
    floor: 0,
    x: -5.7,
    y: ROUTE_PROFILES.supply.y,
    w: 0.42,
    h: 0.28,
  },
  {
    id: "G-RA",
    floor: 0,
    x: -6.25,
    y: ROUTE_PROFILES.return.y,
    w: 0.36,
    h: 0.24,
  },
  ...[1, 2].flatMap((floor) => [
    {
      id: `L${floor}-OA`,
      floor,
      x: 6.4,
      y: floor * 4.2 + 3.27,
      w: 0.65,
      h: 0.4,
    },
    {
      id: `L${floor}-RELIEF`,
      floor,
      x: 8.8,
      y: floor * 4.2 + 3.8,
      w: 0.65,
      h: 0.26,
    },
  ]),
];
export function branchTo(p, y, end) {
  const [x, , z] = end,
    h = y + p.y;
  const front = z > 2 && Math.abs(x) > 5;
  const rear = z < -0.4 && Math.abs(x) > 14;
  if (front || rear) {
    const trunkX = front ? (x < 0 ? p.left : p.right) : Math.sign(x) * p.rear;
    return [[trunkX, h, z], [x, h, z], end];
  }
  return [[x, h, p.z], [x, h, z], end];
}
// Start upstream and fall continuously toward the final receptor. The illustrative
// fall is a visualization assumption, never a selected installation gradient.
export function fallingRoute(points, endY, fallPerMetre = 0.002) {
  const lengths = points
    .slice(1)
    .map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  let remaining = lengths.reduce((a, b) => a + b, 0);
  return points.map(([x, z], i) => {
    const point = [x, endY + remaining * fallPerMetre, z];
    remaining -= lengths[i] || 0;
    return point;
  });
}
export function pointOnRoute(point, route, epsilon = 1e-5) {
  return route.points.slice(1).some((b, i) => {
    const a = route.points[i],
      v = b.map((n, j) => n - a[j]),
      w = point.map((n, j) => n - a[j]);
    const length2 = v.reduce((n, x) => n + x * x, 0);
    const t = length2 ? w.reduce((n, x, j) => n + x * v[j], 0) / length2 : 0;
    return (
      t >= -epsilon &&
      t <= 1 + epsilon &&
      Math.hypot(...point.map((n, j) => n - a[j] - t * v[j])) < epsilon
    );
  });
}

export function vrfProfile(side, line) {
  const p = {
    ...ROUTE_PROFILES.refrigerant,
    ...(side === "East" ? { rear: 15.68, z: 0.85, right: 13.45 } : {}),
  };
  return {
    ...p,
    rear: p.rear + line * 0.12,
    z: p.z + line * 0.12,
    left: p.left + line * 0.12,
    right: p.right + line * 0.12,
    edge: p.edge + line * 0.12,
    front: p.front + line * 0.12,
  };
}

// Local vertical offsets for insulated pipe-pair crossings. Keep the authored
// corridor footprint, source ports and every same-circuit tee coordinate.
// This is a geometry reservation check, not a refrigerant-system calculation.
export function coordinateRefrigerantRoutes(routes, obstacles) {
  const refs = routes.filter((r) => r.system === "refrigerant"),
    fixed = [...obstacles],
    tol = 0.000001,
    errors = [];
  const circuit = (r) => `${r.network}:${r.line}`;
  const outer = (r) => r.width / 2 + (r.insulation || 0);
  const box = (a, b, r) => ({
    lo: a.map((v, i) => Math.min(v, b[i]) - r),
    hi: a.map((v, i) => Math.max(v, b[i]) + r),
  });
  const overlap = (a, b) =>
    a.lo.every((v, i) => v < b.hi[i] - tol && a.hi[i] > b.lo[i] + tol);
  const segments = (r) =>
    r.points.slice(1).map((b, i) => ({
      r,
      a: r.points[i],
      b,
      box: box(r.points[i], b, outer(r)),
    }));
  for (const r of refs.filter((r) => r.pending)) fixed.push(...segments(r));
  let changes = 0;
  for (const key of [...new Set(refs.filter((r) => !r.pending).map(circuit))]) {
    const set = refs.filter((r) => !r.pending && circuit(r) === key),
      nodes = set.flatMap((r) => [r.points[0], r.points.at(-1)]);
    const other = fixed.filter(
      (o) => o.r.system !== "refrigerant" || circuit(o.r) !== key,
    );
    const clear = (a, b, rad) =>
      !other.some((o) => overlap(box(a, b, rad), o.box));
    for (const r of set) {
      const rad = outer(r),
        points = [r.points[0]];
      for (let i = 1; i < r.points.length; i++) {
        const a = r.points[i - 1],
          b = r.points[i],
          axis = [0, 1, 2].find((j) => Math.abs(a[j] - b[j]) > tol);
        if (axis === undefined) continue;
        // Preserve every existing same-circuit tee/end coordinate.
        const length = Math.abs(b[axis] - a[axis]),
          sign = Math.sign(b[axis] - a[axis]);
        const at = (t) => a.map((v, j) => (j === axis ? v + sign * t : v));
        const cuts = [0, length];
        for (const p of nodes) {
          const t = (p[axis] - a[axis]) * sign;
          if (
            t > tol &&
            t < length - tol &&
            p.every((v, j) => j === axis || Math.abs(v - a[j]) < tol)
          )
            cuts.push(t);
        }
        cuts.sort((x, y) => x - y);
        for (let ci = 1; ci < cuts.length; ci++) {
          const from = at(cuts[ci - 1]),
            to = at(cuts[ci]);
          if (clear(from, to, rad)) {
            points.push(to);
            continue;
          }
          if (axis === 1) {
            errors.push(r.id + " vertical");
            points.push(to);
            continue;
          }
          const L = cuts[ci] - cuts[ci - 1],
            direction = sign,
            local = (t) =>
              from.map((v, j) => (j === axis ? v + direction * t : v));
          const intervals = other
            .filter((o) => overlap(box(from, to, rad), o.box))
            .map((o) => {
              const lo = o.box.lo[axis] - rad - 0.008,
                hi = o.box.hi[axis] + rad + 0.008;
              return direction > 0
                ? [lo - from[axis], hi - from[axis]]
                : [from[axis] - hi, from[axis] - lo];
            })
            .sort((a, b) => a[0] - b[0]);
          const clusters = [];
          for (const p of intervals) {
            if (clusters.length && p[0] <= clusters.at(-1)[1] + 0.2)
              clusters.at(-1)[1] = Math.max(clusters.at(-1)[1], p[1]);
            else clusters.push([...p]);
          }
          let last = 0;
          for (const cluster of clusters) {
            let solved = false;
            for (const extraBefore of [
              0, 0.02, 0.04, 0.06, 0.08, 0.1, 0.12, 0.14, 0.16, 0.18, 0.2, 0.24,
              0.28, 0.3, 0.32, 0.34, 0.36, 0.38, 0.4, 0.44, 0.5, 0.6,
            ]) {
              for (const extraAfter of [
                0, 0.02, 0.04, 0.06, 0.08, 0.1, 0.12, 0.14, 0.16, 0.18, 0.2,
                0.24, 0.28, 0.3, 0.32, 0.34, 0.36, 0.38, 0.4, 0.44, 0.5, 0.6,
              ]) {
                let t0 = cluster[0] - extraBefore,
                  t1 = cluster[1] + extraAfter;
                if (t0 < last + tol || t1 > L - tol) continue;
                const start = local(t0),
                  end = local(t1);
                for (const h of [
                  3.84, 3.81, 3.61, 3.31, 3.22, 3.48, 3.56, 3.72, 3.88,
                ]) {
                  const y = r.floor * 4.2 + h;
                  if (Math.abs(y - from[1]) < tol) continue;
                  const d0 = [...start],
                    d1 = [...end];
                  d0[1] = d1[1] = y;
                  if (
                    clear(local(last), start, rad) &&
                    clear(start, d0, rad) &&
                    clear(d0, d1, rad) &&
                    clear(d1, end, rad)
                  ) {
                    points.push(start, d0, d1, end);
                    last = t1;
                    changes++;
                    solved = true;
                    break;
                  }
                }
                if (solved) break;
              }
              if (solved) break;
            }
            if (!solved) {
              errors.push(
                r.id +
                  " horizontal " +
                  JSON.stringify({ from, to, cluster, L }),
              );
            }
          }
          points.push(to);
        }
      }
      r.points = points.filter(
        (p, i) =>
          !i || Math.hypot(...p.map((v, j) => v - points[i - 1][j])) > tol,
      );
    }
    for (const r of set) fixed.push(...segments(r));
  }
  return { changes, errors };
}

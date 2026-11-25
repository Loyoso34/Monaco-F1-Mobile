// Monaco circuit geometry core: pure math, no three.js. Used by the renderer, physics,
// timing, audio (tunnel) and by Node test tools.
//
// World frame: x = east, y = up, z = south (three.js right-handed, north = -z). Meters.
// Track frame: s = distance along the centerline from the start/finish line (race direction),
//              d = lateral offset, positive to the LEFT of the race direction.
//
// The raw trace is a 159-point GeoJSON line (see trackdata.js). It is projected to local
// meters, resampled, de-noised with Taubin smoothing (no shrinkage), splined, scaled so the
// centerline equals the official 3,337 m, and annotated (elevation, width, barriers, curbs,
// tunnel, corners, sectors, cut zones). Annotations are keyed to the raw point index so they
// stay attached to the right street even if the smoothing is retuned.

import { MONACO_RAW } from './trackdata.js';

export const OFFICIAL_LENGTH = 3337;
const LAT0 = 43.7375, LON0 = 7.4235, R_EARTH = 6378137;

// ---------------------------------------------------------------------------------------------
// Annotations (raw index i = position in MONACO_RAW, fractional allowed)
// ---------------------------------------------------------------------------------------------
export const SF_IDX = 114.2;          // start/finish line on Boulevard Albert 1er
// Start position: the second grid slot (front wheels behind its line, 16 m before the start
// line, right-hand side of the road). The start / finish straight is a long right-hand curve
// (R ~ 215-1000 m); from here a car held perfectly straight runs ~120 m before reaching the
// left-hand side, instead of 45 m from the tighter part of the bend further back.
export const SPAWN_BEFORE_SF = 18.6;  // m before the line (car reference point)
export const SPAWN_D = -2.4;          // lateral offset (+ = left)

// Named corners. side: direction of the turn. apex idx for markers / loading screen.
export const CORNERS = [
  { id: 'ste-devote', name: 'Sainte Dévote', turn: 'T1', side: 'R', idx: 129.2, view: true },
  { id: 'beau-rivage', name: 'Beau Rivage', turn: 'T2', side: 'L', idx: 139.0 },
  { id: 'massenet', name: 'Massenet', turn: 'T3', side: 'L', idx: 149.6, view: true },
  { id: 'casino', name: 'Casino Square', turn: 'T4', side: 'R', idx: 158.4, view: true },
  { id: 'mirabeau', name: 'Mirabeau Haute', turn: 'T5', side: 'R', idx: 8.6 },
  { id: 'hairpin', name: 'Fairmont Hairpin', turn: 'T6', side: 'L', idx: 22.2, view: true },
  { id: 'mirabeau-bas', name: 'Mirabeau Bas', turn: 'T7', side: 'R', idx: 29.8 },
  { id: 'portier', name: 'Portier', turn: 'T8', side: 'R', idx: 37.4, view: true },
  { id: 'tunnel', name: 'The Tunnel', turn: 'T9', side: 'R', idx: 44.0, view: true },
  { id: 'chicane', name: 'Nouvelle Chicane', turn: 'T10–11', side: 'L', idx: 54.8, view: true },
  { id: 'tabac', name: 'Tabac', turn: 'T12', side: 'L', idx: 66.2, view: true },
  { id: 'pool1', name: 'Swimming Pool', turn: 'T13–14', side: 'L', idx: 76.0, view: true },
  { id: 'pool2', name: 'Swimming Pool Exit', turn: 'T15–16', side: 'R', idx: 85.8 },
  { id: 'rascasse', name: 'La Rascasse', turn: 'T17–18', side: 'R', idx: 99.2, view: true },
  { id: 'noghes', name: 'Anthony Noghès', turn: 'T19', side: 'R', idx: 106.6 },
];

// Elevation above sea level (m), keyed by lap distance s from the start/finish line.
// Climb from Ste Dévote (8.8 m) to Casino Square (45.5 m); low point 2.5 m on the harbour
// front: 43 m range (published elevation change of the circuit: 42 m). Beau Rivage peaks at
// ~9 %, the drop from the hairpin to Portier ~11 %, the tunnel exit falls ~4 % to the chicane.
const ELEV_S_KEYS = [
  [0, 5.8], [120, 6.4], [260, 7.2], [340, 7.8], [384, 8.8], [420, 10.2], [470, 13.0],
  [540, 18.6], [610, 24.6], [680, 29.6], [750, 34.0], [820, 37.6], [870, 40.0], [930, 42.6],
  [990, 44.4], [1050, 45.4], [1080, 45.5], [1120, 44.6], [1200, 41.0], [1270, 37.0],
  [1310, 35.0], [1350, 32.6], [1400, 29.2], [1440, 27.6], [1470, 26.4], [1500, 24.6],
  [1530, 22.0], [1560, 18.8], [1590, 15.4], [1620, 12.6], [1650, 11.0], [1700, 10.8],
  [1800, 11.2], [1950, 10.8], [2060, 9.6], [2100, 8.6], [2150, 6.4], [2200, 4.6],
  [2260, 3.5], [2330, 3.0], [2450, 2.9], [2552, 2.8], [2720, 2.6], [2890, 2.5],
  [3000, 2.8], [3100, 3.3], [3190, 4.1], [3260, 4.9], [3300, 5.3],
];

// Full road width (m) between the painted edges.
const WIDTH_KEYS = [
  [106.0, 11.0], [109.0, 13.0], [125.0, 13.0], [128.5, 12.0], [131.5, 11.0], [134.0, 10.4],
  [144.0, 10.6], [146.0, 11.0], [157.0, 11.0], [159.5, 11.5], [3.0, 11.0], [6.5, 11.0],
  [9.0, 11.0], [12.0, 10.6], [18.5, 10.6], [20.0, 11.8], [24.5, 11.8], [26.5, 10.6],
  [30.0, 10.2], [35.0, 10.2], [38.0, 10.6], [40.0, 10.4], [48.5, 10.4], [51.0, 11.0],
  [60.0, 11.0], [62.0, 10.6], [68.0, 10.6], [70.0, 11.0], [89.0, 11.0], [91.0, 10.4],
  [96.0, 10.4], [98.0, 10.6], [101.0, 10.6], [104.0, 10.8],
];

// Distance from the painted road edge to the barrier face (m), per side. L = left of travel.
const GAP_DEFAULT = 0.65;
const GAP_KEYS = [
  // [idx0, idx1, left, right, ramp(idx units)]
  [108.5, 127.0, 1.1, 0.55, 1.2],     // start straight: buildings left, pit wall right
  [126.2, 131.8, 8.5, 0.8, 1.0],      // Ste Dévote: escape road on the outside (left)
  [5.6, 9.4, 6.0, 0.8, 0.8],          // Mirabeau Haute escape road (left, straight ahead)
  [19.0, 25.5, 0.9, 1.1, 0.7],        // hairpin
  [39.0, 49.0, 0.75, 0.9, 0.6],       // tunnel walls
  [51.0, 59.5, 7.0, 4.0, 1.0],        // Nouvelle Chicane: escape road + inside runoff
  [72.6, 80.0, 3.2, 3.2, 0.8],        // Swimming Pool T13-14
  [82.6, 89.2, 3.2, 3.2, 0.8],        // Swimming Pool T15-16
  [97.0, 101.0, 3.0, 0.9, 0.8],       // Rascasse
];

// Curbs: [idx0, idx1, side('L'|'R'), width m]
const CURBS = [
  [127.6, 129.9, 'R', 1.1], [129.6, 131.4, 'L', 1.1],                 // Ste Dévote
  [138.3, 139.6, 'L', 0.9],                                           // Beau Rivage
  [147.0, 152.5, 'L', 0.9],                                           // Massenet
  [157.6, 159.0, 'R', 1.0], [0.0, 1.6, 'L', 1.0],                     // Casino
  [7.4, 9.6, 'R', 1.0],                                               // Mirabeau
  [20.4, 24.0, 'L', 1.1],                                             // Hairpin
  [28.8, 30.8, 'R', 1.0],                                             // Mirabeau Bas
  [36.6, 38.3, 'R', 1.0], [38.0, 39.0, 'L', 0.9],                     // Portier
  [52.6, 54.6, 'L', 1.4], [55.6, 58.6, 'R', 1.4], [58.6, 60.0, 'L', 1.0], // Nouvelle Chicane
  [65.2, 67.2, 'L', 1.0],                                             // Tabac
  [73.6, 75.6, 'L', 1.3], [76.6, 79.0, 'R', 1.3],                     // Pool T13-14
  [83.2, 85.6, 'R', 1.3], [86.4, 88.6, 'L', 1.3],                     // Pool T15-16
  [97.6, 100.6, 'R', 1.1],                                            // Rascasse
  [104.8, 107.4, 'R', 1.1], [108.4, 110.0, 'L', 0.9],                 // Noghès
];

// Banking (deg). Positive lifts the RIGHT edge (banks a LEFT turn into the corner); negative
// lifts the left edge (banks a right turn). Monaco is mostly flat; small cambers only.
const BANK_KEYS = [
  [126.5, 0], [128.8, -1.4], [131.0, 0], [146.0, 0], [149.5, 0.8], [153.0, 0],
  [20.0, 0], [22.2, 0.8], [24.5, 0], [64.8, 0], [66.2, 1.0], [67.8, 0],
];

export const TUNNEL_IDX = [39.35, 48.65];

// Corner-cut zones (lap invalid if the car centre goes beyond the curbs).
export const CUT_ZONES = [
  { name: 'Nouvelle Chicane', idx0: 52.4, idx1: 60.2 },
  { name: 'Swimming Pool', idx0: 73.2, idx1: 79.6 },
  { name: 'Swimming Pool', idx0: 82.8, idx1: 89.0 },
];

// Timing checkpoints (must be crossed in order). Sector boundaries are a subset.
const CHECKPOINT_IDX = [131.5, 145.0, 158.8, 9.5, 22.2, 34.0, 44.0, 52.0, 66.0, 79.6, 89.0, 100.5];
const SECTOR_IDX = [6.0, 61.0];   // S1 ends after Casino/at Spélugues, S2 after the chicane

// Corner rounding. The trace is a hand-drawn polygon: each bend is concentrated on a few
// vertices. Taubin smoothing (below) removes jitter but by design preserves features longer
// than ~40 m, so corners whose real radius is larger than the trace suggests get extra pure
// Laplacian passes (which pull the path inside the vertex, like the real kerb line).
// [idx0, idx1, passes]
const CORNER_ROUNDING = [
  [125.5, 133.0, 70],   // Sainte Dévote (~100 km/h)
  [155.6, 3.6, 60],     // Casino and the exit onto Avenue des Spélugues
  [34.8, 39.8, 50],     // Portier
  [51.2, 61.4, 26],     // Nouvelle Chicane
  [62.8, 69.4, 260],    // Tabac (fast left, ~160 km/h)
  [72.0, 80.6, 110],    // Swimming Pool T13-14 (fast left-right)
  [82.0, 89.6, 60],     // Swimming Pool T15-16
  [102.6, 110.0, 24],   // Anthony Noghès
];

// Heading smoothing (Gaussian sigma in metres along the lap) per section: long, gentle
// curves (tunnel, straights) are smoothed strongly to remove the vertex kinks of the trace,
// tight corners only lightly so their radius survives.  [idx0, idx1, sigma]
const SIGMA_DEFAULT = 8;
const HEADING_SIGMA = [
  [109.5, 126.5, 22], [132.5, 144.5, 16], [1.8, 6.4, 14], [11.8, 18.2, 7],
  [19.0, 25.6, 2.5], [7.0, 11.0, 4.5], [27.5, 31.5, 4.5], [35.5, 38.8, 5.5],
  [39.6, 50.6, 30], [51.6, 60.4, 4.5], [60.8, 64.6, 18], [64.6, 68.2, 11],
  [68.2, 72.8, 14], [72.8, 80.2, 9], [80.2, 82.8, 12], [82.8, 89.4, 6],
  [89.4, 96.4, 12], [96.4, 101.4, 3.5], [101.4, 104.2, 8], [104.2, 108.6, 5],
  [126.8, 131.6, 7], [144.8, 155.0, 10], [155.6, 1.8, 7],
];

// ---------------------------------------------------------------------------------------------
function project(lon, lat) {
  const x = (lon - LON0) * Math.PI / 180 * R_EARTH * Math.cos(LAT0 * Math.PI / 180);
  const z = -(lat - LAT0) * Math.PI / 180 * R_EARTH;
  return [x, z];
}

function wrapIdx(i, n) { return ((i % n) + n) % n; }

// periodic distance between raw indices a -> b going forward
function idxFwd(a, b, n) { return wrapIdx(b - a, n); }

function inIdxRange(u, a, b, n) {
  return idxFwd(a, u, n) <= idxFwd(a, b, n);
}

// Centripetal Catmull–Rom point (alpha 0.5)
function catmull(p0, p1, p2, p3, t) {
  const d = (p, q) => Math.max(1e-4, Math.sqrt(Math.hypot(q[0] - p[0], q[1] - p[1])));
  const t0 = 0, t1 = d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  const x = t1 + (t2 - t1) * t;
  const lerp = (a, b, ta, tb) => {
    const w = (x - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
  };
  const A1 = lerp(p0, p1, t0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3);
  const B1 = lerp(A1, A2, t0, t2), B2 = lerp(A2, A3, t1, t3);
  return lerp(B1, B2, t1, t2);
}

// Periodic interpolation of keyed values by arc length (monotone cubic Hermite).
function periodicMonotone(keysS, keysV, L) {
  const n = keysS.length;
  const order = keysS.map((s, i) => i).sort((a, b) => keysS[a] - keysS[b]);
  const S = order.map(i => keysS[i]), V = order.map(i => keysV[i]);
  // extend periodically
  const xs = [S[n - 1] - L, ...S, S[0] + L], ys = [V[n - 1], ...V, V[0]];
  const m = xs.length, dk = [], mk = new Array(m).fill(0);
  for (let i = 0; i < m - 1; i++) dk.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  for (let i = 1; i < m - 1; i++) {
    if (dk[i - 1] * dk[i] <= 0) mk[i] = 0;
    else {
      const w1 = 2 * (xs[i + 1] - xs[i]) + (xs[i] - xs[i - 1]);
      const w2 = (xs[i + 1] - xs[i]) + 2 * (xs[i] - xs[i - 1]);
      mk[i] = (w1 + w2) / (w1 / dk[i - 1] + w2 / dk[i]);
    }
  }
  mk[0] = mk[m - 2]; mk[m - 1] = mk[1];
  return (s) => {
    s = wrapIdx(s, L);
    if (s < xs[1]) s += 0; // in first interval [xs0, xs1]
    let lo = 0, hi = m - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= s) lo = mid; else hi = mid; }
    const h = xs[hi] - xs[lo], t = (s - xs[lo]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h * mk[lo] +
      (-2 * t3 + 3 * t2) * ys[hi] + (t3 - t2) * h * mk[hi];
  };
}

function boxSmoothPeriodic(arr, radius) {
  const n = arr.length, out = new Float32Array(n);
  let acc = 0;
  for (let k = -radius; k <= radius; k++) acc += arr[wrapIdx(k, n)];
  for (let i = 0; i < n; i++) {
    out[i] = acc / (2 * radius + 1);
    acc += arr[wrapIdx(i + radius + 1, n)] - arr[wrapIdx(i - radius, n)];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
export function buildTrack(opts = {}) {
  const this_closure = { err: 0, drift: 0 };
  const DS = opts.ds || 1.0;
  // 1. raw -> local meters with index parameter u
  const raw = [];
  for (let i = 0; i < MONACO_RAW.length; i += 2) raw.push(project(MONACO_RAW[i], MONACO_RAW[i + 1]));
  const nRaw = raw.length;

  // 2. resample the closed raw polyline every ~3 m, carrying u
  let pts = [];
  for (let i = 0; i < nRaw; i++) {
    const a = raw[i], b = raw[(i + 1) % nRaw];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const m = Math.max(1, Math.round(len / 3));
    for (let k = 0; k < m; k++) {
      const t = k / m;
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, i + t]);
    }
  }

  // 3. Taubin smoothing (lambda/mu, no shrinkage) everywhere, then local corner rounding
  const np = pts.length;
  const smoothStep = (w, active) => {
    const nx = new Float64Array(np), nz = new Float64Array(np);
    for (let i = 0; i < np; i++) {
      const p = pts[i], a = pts[(i - 1 + np) % np], b = pts[(i + 1) % np];
      const ww = w * (active ? active[i] : 1);
      nx[i] = p[0] + ww * ((a[0] + b[0]) / 2 - p[0]);
      nz[i] = p[1] + ww * ((a[1] + b[1]) / 2 - p[1]);
    }
    for (let i = 0; i < np; i++) { pts[i][0] = nx[i]; pts[i][1] = nz[i]; }
  };
  const passes = opts.smoothPasses ?? 16;
  for (let it = 0; it < passes; it++) { smoothStep(0.5); smoothStep(-0.53); }
  // per-point rounding pass budget with smooth ramps at the range ends
  const budget = new Float32Array(np);
  for (let i = 0; i < np; i++) {
    for (const [a, b, k] of CORNER_ROUNDING) {
      const span = idxFwd(a, b, nRaw), pos = idxFwd(a, pts[i][2], nRaw);
      if (pos > span) continue;
      const e = Math.min(pos, span - pos) / Math.max(0.5, span * 0.25);
      const w = Math.min(1, e);
      budget[i] = Math.max(budget[i], k * w * w * (3 - 2 * w));
    }
  }
  const maxB = Math.max(...budget);
  const act = new Float32Array(np);
  for (let it = 0; it < maxB; it++) {
    for (let i = 0; i < np; i++) act[i] = Math.max(0, Math.min(1, budget[i] - it));
    smoothStep(0.4, act);
  }

  // 4. spline + uniform arc-length resample
  const dense = [];
  for (let i = 0; i < np; i++) {
    const p0 = pts[(i - 1 + np) % np], p1 = pts[i], p2 = pts[(i + 1) % np], p3 = pts[(i + 2) % np];
    // keep u continuous across the wrap
    const fix = (p) => [p[0], p[1], p[2]];
    const q0 = fix(p0), q1 = fix(p1), q2 = fix(p2), q3 = fix(p3);
    if (q0[2] > q1[2] + nRaw / 2) q0[2] -= nRaw;
    if (q2[2] < q1[2] - nRaw / 2) q2[2] += nRaw;
    if (q3[2] < q1[2] - nRaw / 2) q3[2] += nRaw;
    for (let k = 0; k < 6; k++) {
      const c = catmull(q0, q1, q2, q3, k / 6);
      c[2] = wrapIdx(c[2], nRaw);
      dense.push(c);
    }
  }
  const nd = dense.length;
  const cum = new Float64Array(nd + 1);
  for (let i = 1; i <= nd; i++) {
    const a = dense[i - 1], b = dense[i % nd];
    cum[i] = cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const rawLen = cum[nd];
  const scale = OFFICIAL_LENGTH / rawLen;
  // centroid for scaling
  let cx = 0, cz = 0;
  for (const p of dense) { cx += p[0]; cz += p[1]; }
  cx /= nd; cz /= nd;

  // find SF start in dense param
  const denseU = dense.map(p => p[2]);
  function denseIndexOfIdx(u) {
    let best = 0, bd = 1e9;
    for (let i = 0; i < nd; i++) {
      const d = Math.min(wrapIdx(denseU[i] - u, nRaw), wrapIdx(u - denseU[i], nRaw));
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  const sfDense = denseIndexOfIdx(SF_IDX);
  const s0 = cum[sfDense];

  const L = OFFICIAL_LENGTH;
  const N = Math.round(L / DS);
  const ds = L / N;
  const px = new Float32Array(N), pz = new Float32Array(N), uIdx = new Float32Array(N);
  let j = sfDense;
  for (let k = 0; k < N; k++) {
    const target = (s0 + (k * ds) / scale) % rawLen;
    // advance j so cum[j] <= target < cum[j+1] (cyclic)
    let guard = 0;
    while (!(cum[j] <= target && target < cum[j + 1]) && guard < nd * 2) { j = (j + 1) % nd; guard++; }
    const a = dense[j], b = dense[(j + 1) % nd];
    const t = (target - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
    px[k] = cx + (a[0] + (b[0] - a[0]) * t - cx) * scale;
    pz[k] = cz + (a[1] + (b[1] - a[1]) * t - cz) * scale;
    let du = b[2] - a[2];
    if (du < -nRaw / 2) du += nRaw;
    uIdx[k] = wrapIdx(a[2] + du * t, nRaw);
  }

  // 4b. variable-width heading smoothing, re-integration and closure correction
  {
    const sig = new Float32Array(N).fill(SIGMA_DEFAULT);
    for (let k = 0; k < N; k++) for (const [a, b, sg] of HEADING_SIGMA) if (inIdxRange(uIdx[k], a, b, nRaw)) sig[k] = sg;
    // soften sigma transitions
    const sig2 = boxSmoothPeriodic(sig, Math.round(12 / ds));
    const th = new Float64Array(N);
    let prev = 0;
    for (let k = 0; k < N; k++) {
      const j = (k + 1) % N;
      let a = Math.atan2(pz[j] - pz[k], px[j] - px[k]);
      if (k > 0) { while (a - prev > Math.PI) a -= 2 * Math.PI; while (a - prev < -Math.PI) a += 2 * Math.PI; }
      th[k] = a; prev = a;
    }
    // total turning of a closed loop is +/-2pi: detrend so the series is periodic
    let total = th[N - 1] - th[0];
    { let last = Math.atan2(pz[1] - pz[0], px[1] - px[0]); while (last - th[N - 1] > Math.PI) last -= 2 * Math.PI; while (last - th[N - 1] < -Math.PI) last += 2 * Math.PI; total = last - th[0]; }
    const lin = new Float64Array(N);
    for (let k = 0; k < N; k++) lin[k] = th[k] - total * k / N;
    const sm = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      const sgm = Math.max(0.5, sig2[k]) / ds, R = Math.ceil(3 * sgm);
      let acc = 0, wsum = 0;
      for (let q = -R; q <= R; q++) {
        const w = Math.exp(-(q * q) / (2 * sgm * sgm));
        let idx = k + q, shift = 0;
        if (idx < 0) { idx += N; } else if (idx >= N) { idx -= N; }
        acc += w * (lin[idx] + shift); wsum += w;
      }
      sm[k] = acc / wsum + total * k / N;
    }
    const nxp = new Float64Array(N + 1), nzp = new Float64Array(N + 1);
    nxp[0] = px[0]; nzp[0] = pz[0];
    for (let k = 0; k < N; k++) { nxp[k + 1] = nxp[k] + ds * Math.cos(sm[k]); nzp[k + 1] = nzp[k] + ds * Math.sin(sm[k]); }
    const ex = nxp[N] - nxp[0], ez = nzp[N] - nzp[0];
    let drift = 0;
    for (let k = 0; k < N; k++) {
      const nxk = nxp[k] - ex * k / N, nzk = nzp[k] - ez * k / N;
      drift = Math.max(drift, Math.hypot(nxk - px[k], nzk - pz[k]));
      px[k] = nxk; pz[k] = nzk;
    }
    this_closure.err = Math.hypot(ex, ez); this_closure.drift = drift;
  }

  // map raw idx -> s
  function sOfIdx(u) {
    let best = 0, bd = 1e9;
    for (let k = 0; k < N; k++) {
      const d = Math.min(wrapIdx(uIdx[k] - u, nRaw), wrapIdx(u - uIdx[k], nRaw));
      if (d < bd) { bd = d; best = k; }
    }
    return best * ds;
  }

  // 5. tangents, normals, curvature
  const tx = new Float32Array(N), tz = new Float32Array(N), nx = new Float32Array(N), nz = new Float32Array(N);
  const curv = new Float32Array(N), heading = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const a = (k - 1 + N) % N, b = (k + 1) % N;
    let dx = px[b] - px[a], dz = pz[b] - pz[a];
    const l = Math.hypot(dx, dz); dx /= l; dz /= l;
    tx[k] = dx; tz[k] = dz; nx[k] = dz; nz[k] = -dx;
    heading[k] = Math.atan2(dx, -dz); // compass-like: 0 = north, +90 = east
  }
  for (let k = 0; k < N; k++) {
    const r = Math.max(2, Math.round(3 / ds));
    const a = (k - r + N) % N, b = (k + r) % N;
    let dh = Math.atan2(tz[b], tx[b]) - Math.atan2(tz[a], tx[a]);
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    // atan2(z,x) increases clockwise when viewed from above (z south) -> right turn positive.
    curv[k] = -dh / (2 * r * ds); // + = left turn
  }

  // 6. elevation
  const eS = ELEV_S_KEYS.map(([q]) => q), eV = ELEV_S_KEYS.map(([, v]) => v);
  const elevFn = periodicMonotone(eS, eV, L);
  let py = new Float32Array(N);
  for (let k = 0; k < N; k++) py[k] = elevFn(k * ds);
  py = boxSmoothPeriodic(boxSmoothPeriodic(py, Math.round(8 / ds)), Math.round(6 / ds));

  // 7. width
  const wS = WIDTH_KEYS.map(([u]) => sOfIdx(u)), wV = WIDTH_KEYS.map(([, v]) => v);
  const widthFn = periodicMonotone(wS, wV, L);
  let halfW = new Float32Array(N);
  for (let k = 0; k < N; k++) halfW[k] = widthFn(k * ds) / 2;
  halfW = boxSmoothPeriodic(halfW, Math.round(10 / ds));

  // 8. curbs (outer edge beyond the road edge)
  const curbL = new Float32Array(N), curbR = new Float32Array(N);
  const curbList = [];
  for (const [a, b, side, w] of CURBS) {
    const sa = sOfIdx(a), sb = sOfIdx(b);
    const len = wrapIdx(sb - sa, L);
    curbList.push({ s0: sa, s1: sa + len, side, w });
    for (let q = 0; q <= len; q += ds) {
      const k = Math.round(wrapIdx(sa + q, L) / ds) % N;
      // taper the curb ends over 3 m
      const taper = Math.min(1, q / 3, (len - q) / 3);
      const ww = w * Math.max(0.35, taper);
      if (side === 'L') curbL[k] = Math.max(curbL[k], ww); else curbR[k] = Math.max(curbR[k], ww);
    }
  }

  // 9. barrier gaps
  const gapL = new Float32Array(N).fill(GAP_DEFAULT), gapR = new Float32Array(N).fill(GAP_DEFAULT);
  for (const [a, b, gl, gr, ramp] of GAP_KEYS) {
    const sa = sOfIdx(a), sb = sOfIdx(b), len = wrapIdx(sb - sa, L);
    const rampM = Math.max(6, ramp * 18);
    for (let q = -rampM; q <= len + rampM; q += ds) {
      const k = Math.round(wrapIdx(sa + q, L) / ds) % N;
      let w = 1;
      if (q < 0) w = 1 + q / rampM; else if (q > len) w = 1 - (q - len) / rampM;
      w = w * w * (3 - 2 * w);
      gapL[k] = Math.max(gapL[k], GAP_DEFAULT + (gl - GAP_DEFAULT) * w);
      gapR[k] = Math.max(gapR[k], GAP_DEFAULT + (gr - GAP_DEFAULT) * w);
    }
  }
  // barrier offsets from the centerline, limited on the inside of tight bends
  let barL = new Float32Array(N), barR = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    barL[k] = halfW[k] + Math.max(curbL[k], 0) + gapL[k];
    barR[k] = halfW[k] + Math.max(curbR[k], 0) + gapR[k];
  }
  barL = boxSmoothPeriodic(barL, Math.round(3 / ds));
  barR = boxSmoothPeriodic(barR, Math.round(3 / ds));
  for (let k = 0; k < N; k++) {
    const c = curv[k];
    if (c > 1e-3) barL[k] = Math.min(barL[k], 0.8 / c);      // left turn: inside is left
    if (c < -1e-3) barR[k] = Math.min(barR[k], 0.8 / -c);
  }

  // 10. bank
  const bank = new Float32Array(N);
  if (BANK_KEYS.length) {
    for (let i = 0; i < BANK_KEYS.length; i++) {
      // keys are grouped per corner (start 0, peak, end 0) -> piecewise smooth
    }
    const bS = BANK_KEYS.map(([u]) => sOfIdx(u)), bV = BANK_KEYS.map(([, v]) => v);
    const bankFn = periodicMonotone(bS, bV, L);
    for (let k = 0; k < N; k++) bank[k] = bankFn(k * ds) * Math.PI / 180;
  }

  // 11. tunnel
  const tunnel = new Uint8Array(N);
  const tunS0 = sOfIdx(TUNNEL_IDX[0]), tunS1 = sOfIdx(TUNNEL_IDX[1]);
  for (let k = 0; k < N; k++) if (wrapIdx(k * ds - tunS0, L) <= wrapIdx(tunS1 - tunS0, L)) tunnel[k] = 1;

  const corners = CORNERS.map(c => ({ ...c, s: sOfIdx(c.idx) }));
  const cutZones = CUT_ZONES.map(z => ({ name: z.name, s0: sOfIdx(z.idx0), s1: sOfIdx(z.idx1) }));
  const checkpoints = CHECKPOINT_IDX.map(u => sOfIdx(u)).sort((a, b) => a - b);
  const sectors = SECTOR_IDX.map(u => sOfIdx(u)).sort((a, b) => a - b);

  const track = new Track({
    N, ds, L, px, py, pz, tx, tz, nx, nz, curv, heading, halfW, curbL, curbR, gapL, gapR,
    barL, barR, bank, tunnel, uIdx, corners, cutZones, checkpoints, sectors, curbList,
    tunnelS: [tunS0, tunS1], spawnS: L - SPAWN_BEFORE_SF, spawnD: SPAWN_D, closure: this_closure,
  });
  return track;
}

// ---------------------------------------------------------------------------------------------
export class Track {
  constructor(o) {
    Object.assign(this, o);
    // spatial hash of sample indices for projection queries
    this.cell = 12;
    this.grid = new Map();
    for (let k = 0; k < this.N; k++) {
      const key = this._key(Math.floor(this.px[k] / this.cell), Math.floor(this.pz[k] / this.cell));
      let a = this.grid.get(key);
      if (!a) this.grid.set(key, a = []);
      a.push(k);
    }
  }
  _key(i, j) { return (i + 1000) * 4096 + (j + 1000); }
  wrapS(s) { return ((s % this.L) + this.L) % this.L; }
  idxOfS(s) { return Math.floor(this.wrapS(s) / this.ds) % this.N; }

  // interpolate a per-sample array at s
  sample(arr, s) {
    const f = this.wrapS(s) / this.ds;
    const i = Math.floor(f) % this.N, j = (i + 1) % this.N, t = f - Math.floor(f);
    return arr[i] + (arr[j] - arr[i]) * t;
  }

  // world position of (s, d) on the road surface
  pointAt(s, d, out = {}) {
    const f = this.wrapS(s) / this.ds;
    const i = Math.floor(f) % this.N, j = (i + 1) % this.N, t = f - Math.floor(f);
    const x = this.px[i] + (this.px[j] - this.px[i]) * t;
    const z = this.pz[i] + (this.pz[j] - this.pz[i]) * t;
    const nx = this.nx[i] + (this.nx[j] - this.nx[i]) * t;
    const nz = this.nz[i] + (this.nz[j] - this.nz[i]) * t;
    const y = this.py[i] + (this.py[j] - this.py[i]) * t;
    const b = this.bank[i] + (this.bank[j] - this.bank[i]) * t;
    out.x = x + nx * d; out.z = z + nz * d; out.y = y - Math.tan(b) * d;
    return out;
  }

  // Project a world point to (s, d). hintS (optional) keeps the search on the same part of
  // the circuit where sections pass close to each other.
  project(x, z, hintS = null, out = {}) {
    const ci = Math.floor(x / this.cell), cj = Math.floor(z / this.cell);
    let best = -1, bd = 1e18;
    for (let r = 1; r <= 4 && best < 0; r++) {
      for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
        const a = this.grid.get(this._key(ci + di, cj + dj));
        if (!a) continue;
        for (const k of a) {
          const dx = this.px[k] - x, dz = this.pz[k] - z;
          let d2 = dx * dx + dz * dz;
          if (hintS !== null) {
            let dsx = Math.abs(k * this.ds - hintS);
            dsx = Math.min(dsx, this.L - dsx);
            if (dsx > 60) d2 += 1e6 + dsx * dsx;
          }
          if (d2 < bd) { bd = d2; best = k; }
        }
      }
    }
    if (best < 0) { out.s = hintS ?? 0; out.d = 1e3; out.ok = false; return out; }
    // refine on the two adjacent segments
    let bestS = best * this.ds, bestD = 0, bestE = 1e18;
    for (const k0 of [(best - 1 + this.N) % this.N, best]) {
      const k1 = (k0 + 1) % this.N;
      const ax = this.px[k0], az = this.pz[k0], bx = this.px[k1], bz = this.pz[k1];
      const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
      let t = ((x - ax) * ex + (z - az) * ez) / l2;
      t = Math.max(0, Math.min(1, t));
      const qx = ax + ex * t, qz = az + ez * t;
      const e = (x - qx) ** 2 + (z - qz) ** 2;
      if (e < bestE) {
        bestE = e;
        bestS = (k0 + t) * this.ds;
        const nx = this.nx[k0] + (this.nx[k1] - this.nx[k0]) * t;
        const nz = this.nz[k0] + (this.nz[k1] - this.nz[k0]) * t;
        bestD = (x - qx) * nx + (z - qz) * nz;
      }
    }
    out.s = this.wrapS(bestS); out.d = bestD; out.ok = true;
    return out;
  }

  heightAt(s, d) {
    const y = this.sample(this.py, s), b = this.sample(this.bank, s);
    return y - Math.tan(b) * d;
  }

  // Surface type at (s, d): 0 road, 1 curb, 2 runoff (painted asphalt), 3 beyond barrier
  surfaceAt(s, d) {
    const hw = this.sample(this.halfW, s);
    const ad = Math.abs(d);
    if (ad <= hw) return 0;
    const curb = d > 0 ? this.sample(this.curbL, s) : this.sample(this.curbR, s);
    if (ad <= hw + curb) return 1;
    const bar = d > 0 ? this.sample(this.barL, s) : this.sample(this.barR, s);
    if (ad <= bar) return 2;
    return 3;
  }

  inTunnel(s) {
    const [a, b] = this.tunnelS;
    return this.wrapS(s - a) <= this.wrapS(b - a);
  }

  // Signed forward distance from a to b along the lap (-L/2..L/2)
  deltaS(a, b) {
    let d = b - a;
    if (d > this.L / 2) d -= this.L;
    if (d < -this.L / 2) d += this.L;
    return d;
  }

  cornerNear(s) {
    let best = null, bd = 1e9;
    for (const c of this.corners) {
      const d = Math.abs(this.deltaS(s, c.s));
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
}

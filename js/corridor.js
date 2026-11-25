// Track exclusion zone ("corridor"): a raster of the ground around the circuit that records,
// for every cell, how far it lies beyond the nearest barrier of ANY section of the lap, the
// height of the road surface there, and the road / pavement widths available on each side.
// Scenery placement, terrain carving, pavement widths and the automated inspection all use it,
// so nothing the player can see is ever built on the racing surface. Pure JS (no three.js).
//
// clearBar  = signed distance beyond the barrier face (m): < 0 on the road / kerbs / run-off.
// clearWalk = signed distance beyond the pavement edge (barrier + pavement width).
// roadY     = height of the road or pavement surface in corridor cells (lowest section wins).

export const WALK = 4.5;          // pavement / service strip beyond the barrier (m)
export const PIT_WALK = 13.0;     // pit lane + garages side on the start straight
export const TUNNEL_WALL = 0.95;  // tunnel: wall plane 0.35 m behind the rail + 0.6 m shell

export function pitZone(T, s) { return s > T.L - 150 || s < 300; }

export function buildCorridor(T, { cell = 1.25, reach = 36, margin = 140 } = {}) {
  let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  for (let k = 0; k < T.N; k++) {
    minx = Math.min(minx, T.px[k]); maxx = Math.max(maxx, T.px[k]);
    minz = Math.min(minz, T.pz[k]); maxz = Math.max(maxz, T.pz[k]);
  }
  const x0 = minx - margin, z0 = minz - margin;
  const nx = Math.ceil((maxx - minx + 2 * margin) / cell), nz = Math.ceil((maxz - minz + 2 * margin) / cell);
  const n = nx * nz;
  const BIG = 32000;
  // decimetres in Int16 to keep memory low on phones
  const clearBar = new Int16Array(n).fill(BIG);
  const clearWalk = new Int16Array(n).fill(BIG);
  const roadY = new Float32Array(n).fill(Infinity);
  const sIdx = new Int16Array(n).fill(-1);         // which section (lap metre / 1) owns the cell
  const C = { T, cell, x0, z0, nx, nz, clearBar, clearWalk, roadY, sIdx, BIG };

  // walk widths per lap metre, clipped where two sections run close together (hairpin,
  // Mirabeau / Portier): each section gets at most half of the free gap between barriers
  const walkL = new Float32Array(T.N).fill(WALK), walkR = new Float32Array(T.N).fill(WALK);
  const tmp = {};
  for (let k = 0; k < T.N; k++) {
    const s = k * T.ds;
    for (const side of [1, -1]) {
      const bar = side > 0 ? T.barL[k] : T.barR[k];
      // tunnel: no pavement, the wall (0.35 m behind the rail) and the 0.6 m shell instead
      let w = T.inTunnel(s) ? TUNNEL_WALL : side < 0 && pitZone(T, s) ? PIT_WALK : WALK;
      for (let t = 0.5; t <= w + 0.01; t += 0.5) {
        const d = side * (bar + t);
        const x = T.px[k] + T.nx[k] * d, z = T.pz[k] + T.nz[k] * d;
        const pr = T.project(x, z, null, tmp);
        if (!pr.ok) continue;
        if (Math.abs(T.deltaS(pr.s, s)) > 25) {           // nearer to another section
          const ob = pr.d > 0 ? T.sample(T.barL, pr.s) : T.sample(T.barR, pr.s);
          if (Math.abs(pr.d) < ob + 4.5) { w = Math.max(0, t - 0.5); break; }
        }
      }
      if (side > 0) walkL[k] = w; else walkR[k] = w;
    }
  }
  C.walkL = walkL; C.walkR = walkR;

  // rasterise cross-sections (step along the lap shrinks in tight bends so the outside of a
  // curve has no holes)
  const p = {};
  let s = 0;
  while (s < T.L) {
    const k = T.idxOfS(s);
    const bl = T.sample(T.barL, s), br = T.sample(T.barR, s);
    const wl = walkL[k], wr = walkR[k];
    const kap = Math.abs(T.curv[k]);
    const ext = Math.max(bl, br) + reach;
    T.pointAt(s, 0, p);
    const cx = p.x, cz = p.z, cy = p.y;
    const nxs = T.sample(T.nx, s), nzs = T.sample(T.nz, s);
    const bank = T.sample(T.bank, s);
    const step = cell * 0.45;
    for (let d = -(br + reach); d <= bl + reach; d += step) {
      const x = cx + nxs * d, z = cz + nzs * d;
      const i = Math.floor((x - x0) / cell), j = Math.floor((z - z0) / cell);
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      const c = j * nx + i;
      const left = d >= 0;
      const vb = left ? d - bl : -d - br;
      const vw = vb - (left ? wl : wr);
      const cb = Math.max(-BIG, Math.round(vb * 10)), cw = Math.max(-BIG, Math.round(vw * 10));
      if (cb < clearBar[c]) { clearBar[c] = cb; sIdx[c] = Math.round(s) % T.N; }
      if (cw < clearWalk[c]) clearWalk[c] = cw;
      if (vw <= 0) {
        // surface height: road (banked) up to the barrier, pavement (+12 cm) beyond it
        const dc = Math.max(-br, Math.min(bl, d));
        const y = cy - Math.tan(bank) * dc + (vb > 0 ? 0.12 : 0);
        if (y < roadY[c]) roadY[c] = y;
      }
    }
    s += Math.min(0.5, step / (1 + kap * ext));
  }
  // close single-cell holes (3x3 minimum)
  for (const arr of [clearBar, clearWalk]) {
    const src = arr.slice();
    for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const c = j * nx + i;
      if (src[c] < BIG) continue;
      let m = BIG;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) m = Math.min(m, src[c + dj * nx + di]);
      if (m < BIG) arr[c] = m;
    }
  }
  return C;
}

export function cellAt(C, x, z) {
  const i = Math.floor((x - C.x0) / C.cell), j = Math.floor((z - C.z0) / C.cell);
  if (i < 0 || j < 0 || i >= C.nx || j >= C.nz) return -1;
  return j * C.nx + i;
}
// metres beyond the nearest barrier (Infinity far from the circuit)
export function clearBarAt(C, x, z) { const c = cellAt(C, x, z); return c < 0 || C.clearBar[c] >= C.BIG ? Infinity : C.clearBar[c] / 10; }
export function clearWalkAt(C, x, z) { const c = cellAt(C, x, z); return c < 0 || C.clearWalk[c] >= C.BIG ? Infinity : C.clearWalk[c] / 10; }

// Minimum clearance under a rotated rectangle footprint (centre, heading angle of its local
// +z axis, width along local x, depth along local z). Exact: every raster cell that the
// rectangle touches is included (2-D separating-axis test cell square vs rectangle), so a
// footprint that only clips the corner of a cell is still caught.
export function footprintClear(C, cx, cz, ang, w, dpt, which = 'walk') {
  const arr = which === 'bar' ? C.clearBar : C.clearWalk;
  const ux = Math.cos(ang), uz = -Math.sin(ang);      // local x (half-extent hw)
  const vx = Math.sin(ang), vz = Math.cos(ang);       // local z (half-extent hd)
  const hw = w / 2, hd = dpt / 2, h = C.cell / 2;
  const ex = hw * Math.abs(ux) + hd * Math.abs(vx), ez = hw * Math.abs(uz) + hd * Math.abs(vz);
  const i0 = Math.max(0, Math.floor((cx - ex - C.x0) / C.cell)), i1 = Math.min(C.nx - 1, Math.floor((cx + ex - C.x0) / C.cell));
  const j0 = Math.max(0, Math.floor((cz - ez - C.z0) / C.cell)), j1 = Math.min(C.nz - 1, Math.floor((cz + ez - C.z0) / C.cell));
  const ru = h * (Math.abs(ux) + Math.abs(uz)), rv = h * (Math.abs(vx) + Math.abs(vz));
  let m = Infinity;
  for (let j = j0; j <= j1; j++) {
    const qz = C.z0 + (j + 0.5) * C.cell;
    for (let i = i0; i <= i1; i++) {
      const val = arr[j * C.nx + i];
      if (val >= C.BIG || val / 10 >= m) continue;
      const qx = C.x0 + (i + 0.5) * C.cell;
      const dx = cx - qx, dz = cz - qz;
      if (Math.abs(dx) > h + ex || Math.abs(dz) > h + ez) continue;
      if (Math.abs(dx * ux + dz * uz) > hw + ru || Math.abs(dx * vx + dz * vz) > hd + rv) continue;
      m = val / 10;
      if (m < -50) return m;
    }
  }
  return m;
}

// Terrain ceiling: the ground must stay `depth` below every road / pavement surface and may
// only rise away from it with slope `k`. The result is min-filtered by `grid` (the terrain
// mesh spacing) so that no terrain triangle can rise through the road between its vertices.
export function terrainLimit(C, { depth = 1.2, k = 0.45, cell = 2.5, grid = 16 } = {}) {
  const f = Math.max(1, Math.round(cell / C.cell));
  const nx = Math.ceil(C.nx / f), nz = Math.ceil(C.nz / f);
  const L = new Float32Array(nx * nz).fill(Infinity);
  for (let j = 0; j < C.nz; j++) for (let i = 0; i < C.nx; i++) {
    const y = C.roadY[j * C.nx + i];
    if (!isFinite(y)) continue;
    const c = Math.floor(j / f) * nx + Math.floor(i / f);
    L[c] = Math.min(L[c], y - depth);
  }
  const cs = C.cell * f, dg = Math.SQRT2 * cs * k, ds = cs * k;
  // chamfer distance passes: ground may rise at slope k away from the corridor
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      let v = L[c];
      if (i > 0) v = Math.min(v, L[c - 1] + ds);
      if (j > 0) { v = Math.min(v, L[c - nx] + ds); if (i > 0) v = Math.min(v, L[c - nx - 1] + dg); if (i < nx - 1) v = Math.min(v, L[c - nx + 1] + dg); }
      L[c] = v;
    }
    for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
      const c = j * nx + i;
      let v = L[c];
      if (i < nx - 1) v = Math.min(v, L[c + 1] + ds);
      if (j < nz - 1) { v = Math.min(v, L[c + nx] + ds); if (i < nx - 1) v = Math.min(v, L[c + nx + 1] + dg); if (i > 0) v = Math.min(v, L[c + nx - 1] + dg); }
      L[c] = v;
    }
  }
  // min-filter by the terrain grid diagonal (separable square kernel)
  const r = Math.ceil(grid * Math.SQRT2 / cs);
  const tmpA = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    let m = Infinity;
    for (let q = Math.max(0, i - r); q <= Math.min(nx - 1, i + r); q++) m = Math.min(m, L[j * nx + q]);
    tmpA[j * nx + i] = m;
  }
  const out = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    let m = Infinity;
    for (let q = Math.max(0, j - r); q <= Math.min(nz - 1, j + r); q++) m = Math.min(m, tmpA[q * nx + i]);
    out[j * nx + i] = m;
  }
  return {
    cell: cs, x0: C.x0, z0: C.z0, nx, nz, data: out,
    at(x, z) {
      const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell);
      if (i < 0 || j < 0 || i >= nx || j >= nz) return Infinity;
      return out[j * nx + i];
    },
  };
}

// Validates the processed circuit: length, corner radii, grades, widths, barrier sanity.
// Usage: node tools/track-report.mjs [--png out.ppm]
import { buildTrack } from '../js/track-core.js';
const t0 = Date.now();
const T = buildTrack();
console.log(`built in ${Date.now() - t0} ms, N=${T.N}, ds=${T.ds.toFixed(3)} m, L=${T.L}`);
// geometric length check
let L = 0; for (let k = 0; k < T.N; k++) { const j = (k + 1) % T.N; L += Math.hypot(T.px[j] - T.px[k], T.pz[j] - T.pz[k]); }
console.log(`polyline length ${L.toFixed(1)} m (official 3337)`);
let ymin = 1e9, ymax = -1e9, gmax = 0, gmin = 0, gS = 0, gSm = 0;
for (let k = 0; k < T.N; k++) {
  ymin = Math.min(ymin, T.py[k]); ymax = Math.max(ymax, T.py[k]);
  const j = (k + 5) % T.N; const g = (T.py[j] - T.py[k]) / (5 * T.ds);
  if (g > gmax) { gmax = g; gS = k * T.ds; } if (g < gmin) { gmin = g; gSm = k * T.ds; }
}
console.log(`elevation ${ymin.toFixed(1)}..${ymax.toFixed(1)} m (range ${(ymax - ymin).toFixed(1)}), max climb ${(gmax * 100).toFixed(1)}% at s=${gS.toFixed(0)}, max descent ${(gmin * 100).toFixed(1)}% at s=${gSm.toFixed(0)}`);
for (const c of T.corners) {
  // min radius within +-25 m of the apex
  let rmin = 1e9, at = 0;
  for (let q = -25; q <= 25; q++) { const k = T.idxOfS(c.s + q); const r = 1 / Math.max(1e-6, Math.abs(T.curv[k])); if (r < rmin) { rmin = r; at = q; } }
  const k = T.idxOfS(c.s);
  console.log(`${c.turn.padEnd(7)} ${c.name.padEnd(20)} s=${c.s.toFixed(0).padStart(5)}  Rmin=${rmin.toFixed(1).padStart(6)} m (at ${at >= 0 ? '+' : ''}${at})  width=${(2 * T.halfW[k]).toFixed(1)}  elev=${T.py[k].toFixed(1)}  barL=${T.barL[k].toFixed(1)} barR=${T.barR[k].toFixed(1)}`);
}
console.log('tunnel s', T.tunnelS.map(v => v.toFixed(0)).join('..'), 'len', T.deltaS(T.tunnelS[0], T.tunnelS[1]).toFixed(0));
console.log('checkpoints', T.checkpoints.map(v => v.toFixed(0)).join(', '));
console.log('sectors', T.sectors.map(v => v.toFixed(0)).join(', '));
console.log('cut zones', T.cutZones.map(z => `${z.name} ${z.s0.toFixed(0)}-${z.s1.toFixed(0)}`).join(' | '));
// projection round-trip test
let maxErr = 0;
for (let k = 0; k < T.N; k += 7) {
  for (const d of [-4, 0, 3]) {
    const p = T.pointAt(k * T.ds, d); const q = T.project(p.x, p.z, k * T.ds);
    maxErr = Math.max(maxErr, Math.abs(T.deltaS(k * T.ds, q.s)), Math.abs(q.d - d));
  }
}
console.log('projection round-trip max error', maxErr.toFixed(3), 'm');
// heading at S/F
console.log('heading smoothing closure error', T.closure.err.toFixed(2), 'm, max shift from trace', T.closure.drift.toFixed(1), 'm');
console.log('S/F heading (0=N, 90=E):', (T.heading[0] * 180 / Math.PI).toFixed(1), ' pos', T.px[0].toFixed(1), T.pz[0].toFixed(1));

// Reports places where different parts of the lap come close (barriers must not overlap).
import { buildTrack } from '../js/track-core.js';
const T = buildTrack();
const res = [];
for (let k = 0; k < T.N; k += 2) {
  let best = 1e9, bk = -1;
  for (let j = 0; j < T.N; j += 1) {
    let ds = Math.abs(j - k) * T.ds; ds = Math.min(ds, T.L - ds);
    if (ds < 60) continue;
    const d = Math.hypot(T.px[j] - T.px[k], T.pz[j] - T.pz[k]);
    if (d < best) { best = d; bk = j; }
  }
  // which side faces the other part?
  const dx = T.px[bk] - T.px[k], dz = T.pz[bk] - T.pz[k];
  const side = dx * T.nx[k] + dz * T.nz[k] > 0 ? 'L' : 'R';
  const off = side === 'L' ? T.barL[k] : T.barR[k];
  const dx2 = -dx, dz2 = -dz; const side2 = dx2 * T.nx[bk] + dz2 * T.nz[bk] > 0 ? 'L' : 'R';
  const off2 = side2 === 'L' ? T.barL[bk] : T.barR[bk];
  if (best < 40) res.push({ s: k, other: bk, dist: best, side, clear: best - off - off2 });
}
res.sort((a, b) => a.clear - b.clear);
for (const r of res.slice(0, 12)) console.log(`s=${r.s} vs s=${r.other} dist=${r.dist.toFixed(1)} side=${r.side} clearance between barriers=${r.clear.toFixed(1)} m`);

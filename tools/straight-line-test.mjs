// Straight-line / zero-steering test of the vehicle model (Node, no browser).
//   node tools/straight-line-test.mjs
// 1. A perfectly straight, flat synthetic road: full throttle from rest for 8 s with exactly zero
//    steering, starting on the centre line and 1.6 m off it. The car must keep its heading.
// 2. Light barrier brushes on each wheel (800 - 3500 J, the energy of a tyre or rim touching
//    the wall): no hidden toe / camber may remain, so the car still runs straight afterwards.
// 3. A hard wheel strike: the suspension bends visibly (HUD damage level >= 1) and the car pulls
//    in a consistent direction — damage you can see, not a silent drift.
// 4. The real start / finish straight (Boulevard Albert 1er) from the grid slot with zero
//    steering: the car's own heading does not change; the road itself is a long right-hand curve
//    (R ~ 300-1000 m ahead of the grid), so the car slowly converges on the left-hand side.
import { Track, buildTrack } from '../js/track-core.js';
import { Vehicle } from '../js/physics.js';

let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const deg = (r) => r * 180 / Math.PI;

function straightTrack() {
  const N = 3000, f = (n) => new Float32Array(n);
  const o = {
    px: f(N), py: f(N), pz: f(N), tx: f(N), tz: f(N), nx: f(N), nz: f(N), curv: f(N), heading: f(N), halfW: f(N).fill(6),
    curbL: f(N), curbR: f(N), gapL: f(N).fill(1), gapR: f(N).fill(1), barL: f(N).fill(7), barR: f(N).fill(7), bank: f(N),
    tunnel: new Uint8Array(N), uIdx: f(N),
  };
  for (let k = 0; k < N; k++) { o.pz[k] = -k; o.tz[k] = -1; o.nx[k] = -1; }
  return new Track({ N, ds: 1, L: N, ...o, corners: [], cutZones: [], checkpoints: [], sectors: [], curbList: [], tunnelS: [-10, -9], spawnS: 100 });
}
const run = (v, seconds, steer = 0) => {
  let maxR = 0, maxDelta = 0;
  for (let i = 0; i < 240 * seconds; i++) { v.setInput(steer, 1, 0); v.step(1 / 240); maxR = Math.max(maxR, Math.abs(v.r)); maxDelta = Math.max(maxDelta, Math.abs(v.delta)); }
  return { maxR, maxDelta };
};

// 1 -------------------------------------------------------------------------------------------
for (const d0 of [0, 1.6, -1.6]) {
  const v = new Vehicle(straightTrack()); v.reset(100, d0, { speed: 0 });
  const psi0 = v.psi;
  const { maxR, maxDelta } = run(v, 8);
  const dpsi = v.psi - psi0, drift = v.d - d0;
  check(`Flat straight, zero steering, start d=${d0} m`, Math.abs(dpsi) < 1e-6 && Math.abs(drift) < 1e-3 && maxDelta === 0,
    `${(v.speed * 3.6).toFixed(0)} km/h after 8 s, heading change ${deg(dpsi).toFixed(5)}°, lateral drift ${drift.toFixed(4)} m, max yaw rate ${deg(maxR).toFixed(5)}°/s`);
}

// 2 -------------------------------------------------------------------------------------------
for (const [part, E] of [['wheelFR', 800], ['wheelFR', 2500], ['wheelFL', 2500], ['wheelRR', 3500], ['wheelRL', 3500]]) {
  const v = new Vehicle(straightTrack()); v.reset(100, 0, { speed: 0 });
  v.damage.impact(part, E, 2, 6, 'tyre');
  const id = part.slice(5);
  const toe = v.damage.toe[id], camber = v.damage.camber[id];
  const psi0 = v.psi; run(v, 6);
  check(`Light brush on ${id} (${E} J) leaves no misalignment`, toe === 0 && camber === 0 && Math.abs(v.d) < 1e-3,
    `toe ${deg(toe).toFixed(2)}°, camber ${deg(camber).toFixed(2)}°, lateral drift after 6 s ${v.d.toFixed(4)} m, heading ${deg(v.psi - psi0).toFixed(4)}°`);
}

// 3 -------------------------------------------------------------------------------------------
{
  const v = new Vehicle(straightTrack()); v.reset(100, 0, { speed: 0 });
  v.damage.impact('wheelFR', 9000, 6, 8, 'wheel');
  const lvl = v.damage.level('wheelFR'), toe = v.damage.toe.FR;
  run(v, 4);
  check('Hard wheel strike bends the suspension visibly and consistently', lvl >= 1 && toe !== 0 && Math.abs(v.d) > 0.2,
    `HUD level ${lvl}, toe ${deg(toe).toFixed(2)}°, lateral drift after 4 s ${v.d.toFixed(2)} m ${v.d < 0 ? '(right)' : '(left)'}`);
}

// 4 -------------------------------------------------------------------------------------------
{
  const T = buildTrack();
  const v = new Vehicle(T); v.reset(T.spawnS, T.spawnD, { speed: 0 });
  const psi0 = v.psi, k0 = T.idxOfS(v.s);
  const roadHeading = (k) => Math.atan2(-T.tx[k], -T.tz[k]);
  let t = 0, contactAt = null;
  for (let i = 0; i < 240 * 3.5; i++) { v.setInput(0, 1, 0); v.step(1 / 240); t += 1 / 240; if (v.contact.active) { contactAt = v.s; break; } }
  const k = T.idxOfS(v.s);
  let roadTurn = roadHeading(k) - roadHeading(k0); roadTurn = Math.atan2(Math.sin(roadTurn), Math.cos(roadTurn));
  check('Start straight, zero steering: the car keeps its heading and stays on the road for 3.5 s', Math.abs(v.psi - psi0) < 0.0005 && contactAt === null,
    `after ${t.toFixed(1)} s / ${(T.deltaS(T.spawnS, v.s)).toFixed(0)} m: car heading change ${deg(v.psi - psi0).toFixed(4)}°, road heading change ${deg(roadTurn).toFixed(2)}° (right-hand bend), lateral position ${v.d.toFixed(2)} m${contactAt !== null ? ', reaches the left barrier' : ''}`);
}

console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);

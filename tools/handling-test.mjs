// Braking and traction characterisation (Node, no browser): straight-line stops at several
// speeds and pedal pressures, trail braking into a bend, standing starts and corner exits.
// There is no ABS: lock-ups must come from the tyre / wheel / brake physics, only when the
// brake torque really exceeds what the tyre can transmit (low downforce, high pedal).
//   node tools/handling-test.mjs            (exit code 1 on failure)
//   ASSISTS=off node tools/handling-test.mjs
import { Track } from '../js/track-core.js';
import { Vehicle } from '../js/physics.js';

const DT = 1 / 240, G = 9.81;
const assists = process.env.ASSISTS || 'standard';
function straightTrack(width = 12) {
  const N = 6000, f = (n) => new Float32Array(n);
  const o = { px: f(N), py: f(N), pz: f(N), tx: f(N), tz: f(N), nx: f(N), nz: f(N), curv: f(N), heading: f(N), halfW: f(N).fill(width), curbL: f(N), curbR: f(N), gapL: f(N).fill(1), gapR: f(N).fill(1), barL: f(N).fill(width + 2), barR: f(N).fill(width + 2), bank: f(N), tunnel: new Uint8Array(N), uIdx: f(N) };
  for (let k = 0; k < N; k++) { o.pz[k] = -k; o.tz[k] = -1; o.nx[k] = -1; }
  return new Track({ N, ds: 1, L: N, ...o, corners: [], cutZones: [], checkpoints: [], sectors: [], curbList: [], tunnelS: [-10, -9], spawnS: 100 });
}
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${detail}`); };

// ---- braking -------------------------------------------------------------------------------------
function brake({ v0, pedal, steer = 0 }) {
  const v = new Vehicle(straightTrack(steer ? 400 : 12), { assists });
  v.reset(200, 0, { speed: v0 / 3.6 });
  for (let i = 0; i < 72; i++) { v.setInput(0, 0, 0); v.step(DT); }          // settle (coast 0.3 s)
  const psi0 = v.psi; let t = 0, firstLock = null, lockF = 0, lockR = 0, peak = 0, maxR = 0, dist = 0;
  const peakAt = { kmh: 0 };
  while (v.speed > 2 && t < 12) {
    v.setInput(steer, 0, pedal); v.step(DT); t += DT; dist += v.speed * DT;
    const fl = v.wheels[0].locked || v.wheels[1].locked, rl = v.wheels[2].locked || v.wheels[3].locked;
    if ((fl || rl) && !firstLock) firstLock = { t, kmh: v.speed * 3.6, axle: fl ? 'front' : 'rear' };
    if (fl) lockF += DT; if (rl) lockR += DT;
    if (-v.ax / G > peak) { peak = -v.ax / G; peakAt.kmh = v.speed * 3.6; }
    maxR = Math.max(maxR, Math.abs(v.r));
  }
  return { t, dist, peak, peakAt, firstLock, lockF, lockR, heading: (v.psi - psi0) * 57.2958, maxR: maxR * 57.2958 };
}
const fmt = (r) => `stop ${r.t.toFixed(2)} s / ${r.dist.toFixed(0)} m, peak ${r.peak.toFixed(2)} g at ${r.peakAt.kmh.toFixed(0)} km/h, first lock ${r.firstLock ? `${r.firstLock.t.toFixed(2)} s at ${r.firstLock.kmh.toFixed(0)} km/h (${r.firstLock.axle})` : 'none'}, heading ${r.heading.toFixed(1)}°, max yaw rate ${r.maxR.toFixed(1)}°/s`;

let r = brake({ v0: 290, pedal: 1 });
check('290 -> 0 km/h, full pedal: 4-6 g at speed, no lock above 200 km/h, straight', r.peak > 4 && r.peak < 6 && (!r.firstLock || r.firstLock.kmh < 200) && Math.abs(r.heading) < 0.5, fmt(r));
r = brake({ v0: 290, pedal: 0.7 });
check('290 -> 0 km/h, 70 % pedal: no lock above 140 km/h, straight', (!r.firstLock || r.firstLock.kmh < 140) && Math.abs(r.heading) < 0.5, fmt(r));
r = brake({ v0: 200, pedal: 0.55 });
check('200 -> 0 km/h, 55 % pedal: no lock above 100 km/h', !r.firstLock || r.firstLock.kmh < 100, fmt(r));
r = brake({ v0: 120, pedal: 1 });
check('120 km/h, full pedal (little downforce): the fronts lock first — no ABS', !!r.firstLock && r.firstLock.axle === 'front' && Math.abs(r.heading) < 0.5, fmt(r));
r = brake({ v0: 180, pedal: 1, steer: 0.25 });
check('Trail braking 180 km/h, full pedal + steering: no spin', Math.abs(r.heading) < 15 && r.maxR < 45, fmt(r));
r = brake({ v0: 120, pedal: 0.6, steer: 0.4 });
check('Trail braking 120 km/h, 60 % pedal + 0.4 steering: no rear lock, no spin', r.lockR === 0 && Math.abs(r.heading) < 15, fmt(r));

// ---- traction ------------------------------------------------------------------------------------
function drive({ v0, thr, steer = 0, dur }) {
  const v = new Vehicle(straightTrack(steer ? 500 : 12), { assists });
  v.reset(200, 0, { speed: v0 / 3.6 });
  let t = 0, maxK = 0, spinT = 0, maxR = 0, at1 = 0; const psi0 = v.psi;
  while (t < dur) {
    v.setInput(steer, thr, 0); v.step(DT); t += DT;
    maxK = Math.max(maxK, v.wheels[2].kappa, v.wheels[3].kappa);
    if (v.wheels[2].spinning || v.wheels[3].spinning) spinT += DT;
    maxR = Math.max(maxR, Math.abs(v.r));
    if (!at1 && t >= 1) at1 = v.speed * 3.6;
  }
  const fwd = [-Math.sin(v.psi), -Math.cos(v.psi)], sp = Math.hypot(v.vx, v.vz);
  const beta = Math.acos(Math.max(-1, Math.min(1, (v.vx * fwd[0] + v.vz * fwd[1]) / Math.max(0.1, sp)))) * 57.2958;
  return { kmh: v.speed * 3.6, at1, gear: v.gear, maxK, spinT, beta, yaw: (v.psi - psi0) * 57.2958, maxR: maxR * 57.2958 };
}
const fmtD = (d, dur) => `${d.at1.toFixed(0)} km/h after 1 s, ${d.kmh.toFixed(0)} km/h after ${dur} s (gear ${d.gear}), max rear slip ${d.maxK.toFixed(2)}, wheelspin ${d.spinT.toFixed(2)} s, body slip ${d.beta.toFixed(1)}°, yaw ${d.yaw.toFixed(1)}°`;
let d = drive({ v0: 0, thr: 1, dur: 3 });
if (assists === 'standard') {
  check('Standing start, full throttle: straight, traction-limited, no wheelspin phase', d.kmh > 120 && Math.abs(d.yaw) < 0.5 && d.spinT < 0.2, fmtD(d, 3));
  d = drive({ v0: 80, thr: 1, steer: 0.35, dur: 2.5 });
  check('Corner exit at 80 km/h, full throttle + steering: the rear stays in line', d.beta < 4 && d.kmh > 150, fmtD(d, 2.5));
} else {
  check('Standing start, full throttle, no traction control: wheelspin but the car stays straight', Math.abs(d.yaw) < 0.5, fmtD(d, 3));
}
d = drive({ v0: 120, thr: 0.5, steer: 0.3, dur: 3 });
check('Steady corner at 120 km/h, half throttle: stable', d.beta < 3, fmtD(d, 3));

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} handling checks passed [assists: ${assists}]`);
process.exit(failed ? 1 : 0);

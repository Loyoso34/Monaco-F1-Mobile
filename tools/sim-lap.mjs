// Headless physics test: drives laps with the autopilot and reports lap time, speeds per
// corner, gear use, steering at the hairpin, barrier contacts and any instability.
// Usage: node tools/sim-lap.mjs [laps] [pace] [assists]
import { buildTrack } from '../js/track-core.js';
import { Vehicle, steerLimit } from '../js/physics.js';
import { buildRacingLine, Autopilot } from '../js/autopilot.js';
const laps = +(process.argv[2] || 1), pace = +(process.argv[3] || 1), assists = process.argv[4] || 'standard';
const T = buildTrack();
const line = buildRacingLine(T);
const car = new Vehicle(T, { assists });
const ap = new Autopilot(T, line, { pace });
const dt = 1 / 240;
let t = 0, lastS = car.s, lapStart = null, lap = 0, maxV = 0, impacts = 0, shifts = 0, downs = 0;
const cornerMin = {}; let hairpinMaxSteer = 0, hairpinMaxInput = 0;
const log = [];
for (let n = 0; n < 240 * 100 * laps && lap <= laps; n++) {
  const inp = ap.update(car, dt);
  car.setInput(inp.steer, inp.throttle, inp.brake);
  car.step(dt);
  t += dt;
  for (const e of car.events) { if (e.type === 'impact') { impacts++; log.push(`t=${t.toFixed(2)} s=${car.s.toFixed(0)} impact ${e.kind} ${e.part} E=${e.energy.toFixed(0)}J vn=${e.vn.toFixed(1)}`); } if (e.type === 'upshift') shifts++; if (e.type === 'downshift') downs++; }
  car.events.length = 0;
  const v = car.speed; maxV = Math.max(maxV, v);
  for (const c of T.corners) {
    if (Math.abs(T.deltaS(car.s, c.s)) < 20) cornerMin[c.name] = Math.min(cornerMin[c.name] ?? 1e9, v * 3.6);
  }
  const hp = T.corners.find(c => c.id === 'hairpin');
  if (Math.abs(T.deltaS(car.s, hp.s)) < 25) { hairpinMaxSteer = Math.max(hairpinMaxSteer, Math.abs(car.delta)); hairpinMaxInput = Math.max(hairpinMaxInput, Math.abs(inp.steer)); }
  // lap crossing (s wraps from ~L to ~0)
  if (lastS > T.L - 50 && car.s < 50) {
    if (lapStart !== null) { console.log(`LAP ${lap}: ${(t - lapStart).toFixed(3)} s`); }
    lapStart = t; lap++;
  }
  lastS = car.s;
  if (!isFinite(car.x) || !isFinite(car.vx)) { console.log('NaN at', t); break; }
  if (car.damage.undriveable) { console.log('UNDRIVEABLE', car.damage.reason, 'at s', car.s.toFixed(0)); break; }
}
console.log('max speed', (maxV * 3.6).toFixed(1), 'km/h; upshifts', shifts, 'downshifts', downs, 'impacts', impacts);
console.log('hairpin: max road-wheel angle', (hairpinMaxSteer * 180 / Math.PI).toFixed(1), 'deg (lock', (steerLimit(0) * 180 / Math.PI).toFixed(1), '), max input', hairpinMaxInput.toFixed(2));
for (const [k, v] of Object.entries(cornerMin)) console.log('  ', k.padEnd(22), v.toFixed(0), 'km/h');
console.log(log.slice(0, 15).join('\n'));

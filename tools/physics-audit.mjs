// Physics audit: manoeuvres with measurable outcomes (Node, no browser).
//   node tools/physics-audit.mjs [section,...]      sections: map, pool, exit, hairpin, lift,
//                                                   trail, curb, launch, brake, fps, lap (default all)
//   ASSISTS=off node tools/physics-audit.mjs
// Outputs numbers, not verdicts; tools/handling-test.mjs holds the pass/fail acceptance checks.
import { Track, buildTrack } from '../js/track-core.js';
import { Vehicle, steerLimit } from '../js/physics.js';
import { buildRacingLine, Autopilot } from '../js/autopilot.js';
import { SPEC } from '../js/carspec.js';

const DT = 1 / 240, G = 9.81, D2R = 180 / Math.PI;
const assists = process.env.ASSISTS || 'standard';
const want = (process.argv[2] || 'all').split(',');
const on = (k) => want.includes('all') || want.includes(k);

// open, flat test pad (a 6 km "road" 800 m wide): room for circles and slaloms
function pad({ width = 400, surface = 0 } = {}) {
  const N = 6000, f = (n) => new Float32Array(n);
  const o = { px: f(N), py: f(N), pz: f(N), tx: f(N), tz: f(N), nx: f(N), nz: f(N), curv: f(N), heading: f(N), halfW: f(N).fill(width), curbL: f(N), curbR: f(N), gapL: f(N).fill(1), gapR: f(N).fill(1), barL: f(N).fill(width + 2), barR: f(N).fill(width + 2), bank: f(N), tunnel: new Uint8Array(N), uIdx: f(N) };
  for (let k = 0; k < N; k++) { o.pz[k] = -k; o.tz[k] = -1; o.nx[k] = -1; }
  const T = new Track({ N, ds: 1, L: N, ...o, corners: [], cutZones: [], checkpoints: [], sectors: [], curbList: [], tunnelS: [-10, -9], spawnS: 100 });
  if (surface) T.surfaceAt = () => surface;
  return T;
}
const fwdOf = (v) => [-Math.sin(v.psi), -Math.cos(v.psi)];
const beta = (v) => { const f = fwdOf(v), sp = Math.hypot(v.vx, v.vz); if (sp < 0.5) return 0; const r = [Math.cos(v.psi), -Math.sin(v.psi)]; return Math.atan2(v.vx * r[0] + v.vz * r[1], v.vx * f[0] + v.vz * f[1]) * D2R; };
const latG = (v) => v.ay / G;
// speed holder (throttle / brake PI on the longitudinal speed)
function holdSpeed(v, target, st) {
  const e = target - v.speed;
  st.i = Math.max(-2, Math.min(2, (st.i || 0) + e * DT));
  const u = 0.25 * e + 0.6 * st.i;
  return u >= 0 ? [Math.min(1, u), 0] : [0, Math.min(1, -u * 0.5)];
}
const AX = { fp: Math.atan(1.85 / 17.5), rp: Math.atan(1.85 / 19.5) };

// ---- 1. steady-state steering map ----------------------------------------------------------
if (on('map')) {
  console.log('\n== Steady-state steering map (flat pad, speed held) ==');
  console.log('speed  input  roadwheel  latG   beta    aF/peak aR/peak  yaw(deg/s)  note');
  for (const kmh of [60, 100, 150, 200, 250]) {
    let peakG = 0, peakIn = 0;
    for (const sIn of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0]) {
      const v = new Vehicle(pad(), { assists }); v.reset(200, 0, { speed: kmh / 3.6 });
      const st = {}; let spun = false, t = 0;
      const tEnd = 6;
      let aF = 0, aR = 0, lat = 0, b = 0, yaw = 0, n = 0;
      while (t < tEnd) {
        const [th, br] = holdSpeed(v, kmh / 3.6, st);
        v.setInput(sIn, th, br); v.step(DT); t += DT;
        if (Math.abs(beta(v)) > 25) { spun = true; break; }
        if (t > tEnd - 1.5) { aF += Math.abs(v.wheels[0].slipA + v.wheels[1].slipA) / 2; aR += Math.abs(v.wheels[2].slipA + v.wheels[3].slipA) / 2; lat += Math.abs(latG(v)); b += beta(v); yaw += Math.abs(v.r); n++; }
      }
      if (spun) { console.log(`${String(kmh).padStart(4)}   ${sIn.toFixed(1)}    —          —      SPIN   (rear let go at ${t.toFixed(1)} s)`); continue; }
      aF /= n; aR /= n; lat /= n; b /= n; yaw /= n;
      if (lat > peakG + 0.02) { peakG = lat; peakIn = sIn; }
      const note = aR / AX.rp > 1.05 && aR / AX.rp > aF / AX.fp ? 'REAR past peak' : aF / AX.fp > 1.05 ? 'front past peak' : '';
      console.log(`${String(kmh).padStart(4)}   ${sIn.toFixed(1)}    ${(v.delta * D2R).toFixed(2).padStart(6)}°   ${lat.toFixed(2)}  ${b.toFixed(1).padStart(6)}°  ${(aF / AX.fp).toFixed(2)}    ${(aR / AX.rp).toFixed(2)}    ${(yaw * D2R).toFixed(1).padStart(6)}    ${note}`);
    }
    console.log(`  -> ${kmh} km/h: peak ${peakG.toFixed(2)} g reached at input ${peakIn.toFixed(1)}`);
  }
}

// ---- 2. Swimming-Pool style direction change ------------------------------------------------
function slalom(kmh, amp, half, { label = '' } = {}) {
  const v = new Vehicle(pad(), { assists }); v.reset(200, 0, { speed: kmh / 3.6 });
  const st = {}; let t = 0, maxB = 0, maxR = 0, spun = false, settle = null;
  const seq = (tt) => tt < half ? amp : tt < 2 * half ? -amp : tt < 2.6 * half ? amp * 0.3 : 0;
  while (t < 2 * half + 3) {
    const [th] = holdSpeed(v, kmh / 3.6, st);
    v.setInput(seq(t), Math.max(0.35, th), 0); v.step(DT); t += DT;
    maxB = Math.max(maxB, Math.abs(beta(v))); maxR = Math.max(maxR, Math.abs(v.r));
    if (Math.abs(beta(v)) > 30) { spun = true; break; }
    if (t > 2.6 * half && settle === null && Math.abs(v.r) < 0.03 && Math.abs(beta(v)) < 0.5) settle = t - 2.6 * half;
  }
  console.log(`${label} ${kmh} km/h, input ±${amp} for ${half}s each: ${spun ? 'SPIN' : 'ok'}  max body slip ${maxB.toFixed(1)}°, max yaw ${(maxR * D2R).toFixed(0)}°/s, settles ${settle === null ? '>3 s' : settle.toFixed(2) + ' s'} after the input ends, speed ${(v.speed * 3.6).toFixed(0)} km/h`);
  return { spun, maxB };
}
if (on('pool')) {
  console.log('\n== Quick direction changes (Swimming Pool ~ 130-150 km/h) ==');
  for (const amp of [0.3, 0.5, 0.7, 1.0]) slalom(140, amp, 0.45);
  for (const amp of [0.5, 1.0]) slalom(200, amp, 0.35);
}

// ---- 3. Power on out of a slow corner (Portier / La Rascasse) --------------------------------
if (on('exit')) {
  console.log('\n== Full throttle out of a slow corner (steady 70 km/h corner, then floor it) ==');
  for (const sIn of [0.3, 0.5, 0.8]) {
    for (const thr of [0.6, 1.0]) {
      const v = new Vehicle(pad(), { assists }); v.reset(200, 0, { speed: 70 / 3.6 });
      const st = {}; let t = 0, maxB = 0, spun = false, maxK = 0;
      while (t < 5) {
        const ph = t > 2.5;
        const [th, br] = holdSpeed(v, 70 / 3.6, st);
        v.setInput(sIn * (ph ? Math.max(0, 1 - (t - 2.5) / 1.2) : 1), ph ? thr : th, ph ? 0 : br);
        v.step(DT); t += DT;
        if (ph) { maxB = Math.max(maxB, Math.abs(beta(v))); maxK = Math.max(maxK, v.wheels[2].kappa, v.wheels[3].kappa); }
        if (Math.abs(beta(v)) > 30) { spun = true; break; }
      }
      console.log(`steer ${sIn} unwinding, throttle ${thr}: ${spun ? 'SPIN' : 'ok'}  max body slip ${maxB.toFixed(1)}°, max rear slip ratio ${maxK.toFixed(2)}, ${(v.speed * 3.6).toFixed(0)} km/h after 2.5 s`);
    }
  }
}

// ---- 4. Hairpin: full lock -----------------------------------------------------------------
if (on('hairpin')) {
  console.log('\n== Full lock at hairpin speeds (radius of the path, centre line of the car) ==');
  for (const kmh of [35, 45, 55, 65]) {
    const v = new Vehicle(pad(), { assists }); v.reset(200, 0, { speed: kmh / 3.6 });
    const st = {}; let t = 0, pts = [];
    while (t < 5) { const [th, br] = holdSpeed(v, kmh / 3.6, st); v.setInput(1, th, br); v.step(DT); t += DT; if (t > 3) pts.push([v.x, v.z]); }
    // fit radius: mean distance from centroid
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const R = pts.reduce((a, p) => a + Math.hypot(p[0] - cx, p[1] - cz), 0) / pts.length;
    console.log(`${kmh} km/h full lock: path radius ${R.toFixed(1)} m, lateral ${Math.abs(latG(v)).toFixed(2)} g, body slip ${beta(v).toFixed(1)}°, front slip ${(Math.abs(v.wheels[0].slipA) * D2R).toFixed(1)}°`);
  }
  const T = buildTrack(); const hp = T.corners.find(c => c.id === 'hairpin');
  let kmax = 0; for (let ds = -15; ds <= 15; ds++) kmax = Math.max(kmax, Math.abs(T.curv[T.idxOfS(hp.s + ds)]));
  console.log(`Fairmont hairpin centre-line radius ${(1 / kmax).toFixed(1)} m, road half-width ${T.halfW[T.idxOfS(hp.s)].toFixed(1)} m`);
}

// ---- 5. Lift-off and trail braking in a fast corner ------------------------------------------
if (on('lift') || on('trail')) {
  console.log('\n== Lift-off / braking mid-corner (steady corner at ~85 % of the limit) ==');
  for (const [kmh, sIn] of [[150, 0.30], [200, 0.25], [120, 0.40]]) {
    for (const act of ['lift', 'brake0.5', 'brake1.0']) {
      const v = new Vehicle(pad(), { assists }); v.reset(200, 0, { speed: kmh / 3.6 });
      const st = {}; let t = 0, maxB = 0, maxR = 0, spun = false, b0 = 0;
      while (t < 5) {
        const ph = t > 2.5;
        if (!ph) { const [th, br] = holdSpeed(v, kmh / 3.6, st); v.setInput(sIn, th, br); b0 = beta(v); }
        else v.setInput(sIn, 0, act === 'lift' ? 0 : act === 'brake0.5' ? 0.5 : 1.0);
        v.step(DT); t += DT;
        if (ph) { maxB = Math.max(maxB, Math.abs(beta(v) - b0)); maxR = Math.max(maxR, Math.abs(v.r)); }
        if (Math.abs(beta(v)) > 30) { spun = true; break; }
        if (v.speed < 8) break;
      }
      console.log(`${kmh} km/h, steer ${sIn}, ${act.padEnd(8)}: ${spun ? 'SPIN' : 'ok'}  body slip change ${maxB.toFixed(1)}°, max yaw ${(maxR * D2R).toFixed(0)}°/s`);
    }
  }
}

// ---- 6. Curb strike ------------------------------------------------------------------------
if (on('curb')) {
  console.log('\n== Corner on a kerb (surface 1) vs asphalt ==');
  for (const surf of [0, 1]) {
    const v = new Vehicle(pad({ surface: surf }), { assists }); v.reset(200, 0, { speed: 120 / 3.6 });
    const st = {}; let t = 0, lat = 0, n = 0, maxB = 0, sdB = 0, b2 = 0;
    while (t < 5) { const [th, br] = holdSpeed(v, 120 / 3.6, st); v.setInput(0.4, th, br); v.step(DT); t += DT; if (t > 2) { const b = beta(v); lat += Math.abs(latG(v)); n++; maxB = Math.max(maxB, Math.abs(b)); sdB += b; b2 += b * b; } }
    const m = sdB / n;
    console.log(`${surf ? 'kerb   ' : 'asphalt'}: mean lateral ${(lat / n).toFixed(2)} g, body slip ${m.toFixed(2)}° (sd ${Math.sqrt(Math.max(0, b2 / n - m * m)).toFixed(2)}°), max ${maxB.toFixed(1)}°`);
  }
}

if (on('curb')) {
  console.log('\n== Kerb strike: left wheels run over a 30 m kerb at 150 km/h (light steering) ==');
  const T = pad(); const base = T.surfaceAt.bind(T);
  let sNow = 0; T.surfaceAt = (s, d) => (s > 400 && s < 430 && d > 0.3) ? 1 : base(s, d);
  const v = new Vehicle(T, { assists }); v.reset(200, 0, { speed: 150 / 3.6 });
  const st = {}; let t = 0, maxDF = 0, minDF = 0, b0 = null, maxDB = 0, maxDR = 0, r0 = null, hit = false;
  while (t < 6) {
    const [th, br] = holdSpeed(v, 150 / 3.6, st); v.setInput(0, th, br); v.step(DT); t += DT;
    const onK = v.wheels[0].surface === 1 || v.wheels[2].surface === 1;
    if (!onK && b0 === null && v.s > 380) { b0 = beta(v); r0 = v.r; }
    if (onK) hit = true;
    if (b0 !== null) { maxDB = Math.max(maxDB, Math.abs(beta(v) - b0)); maxDR = Math.max(maxDR, Math.abs(v.r - r0)); }
    if (v.s > 380 && v.s < 460) for (const w of v.wheels) { maxDF = Math.max(maxDF, w.dFz); minDF = Math.min(minDF, w.dFz); }
    if (v.s > 520) break;
  }
  console.log(`${hit ? 'kerb hit' : 'KERB MISSED'}: tyre load swing ${minDF.toFixed(0)} / +${maxDF.toFixed(0)} N, body slip disturbance ${maxDB.toFixed(2)}°, yaw-rate disturbance ${(maxDR * D2R).toFixed(1)}°/s`);
}

// ---- 7. Launch and heavy braking ---------------------------------------------------------
if (on('launch')) {
  console.log('\n== Straight launch, neutral steering ==');
  const v = new Vehicle(pad({ width: 12 }), { assists }); v.reset(200, 0, { speed: 0 });
  let t = 0, t100 = null, t200 = null, maxYaw = 0; const psi0 = v.psi, x0 = v.x;
  while (t < 10) { v.setInput(0, 1, 0); v.step(DT); t += DT; if (!t100 && v.speed * 3.6 >= 100) t100 = t; if (!t200 && v.speed * 3.6 >= 200) t200 = t; maxYaw = Math.max(maxYaw, Math.abs(v.r)); }
  console.log(`0-100 ${t100?.toFixed(2)} s, 0-200 ${t200?.toFixed(2)} s, ${(v.speed * 3.6).toFixed(0)} km/h at 10 s; heading change ${((v.psi - psi0) * D2R).toFixed(4)}°, lateral drift ${(v.x - x0).toFixed(4)} m, max yaw rate ${(maxYaw * D2R).toFixed(4)}°/s`);
}
if (on('brake')) {
  console.log('\n== Heavy braking ==');
  for (const [v0, p] of [[290, 1], [200, 1], [150, 0.7]]) {
    const v = new Vehicle(pad({ width: 12 }), { assists }); v.reset(200, 0, { speed: v0 / 3.6 });
    let t = 0, dist = 0, peak = 0; const psi0 = v.psi; let lockT = 0;
    while (v.speed > 80 / 3.6 && t < 8) { v.setInput(0, 0, p); v.step(DT); t += DT; dist += v.speed * DT; peak = Math.max(peak, -v.ax / G); if (v.wheels[0].locked || v.wheels[1].locked) lockT += DT; }
    console.log(`${v0} -> 80 km/h at ${p * 100}% pedal: ${dist.toFixed(0)} m, ${t.toFixed(2)} s, peak ${peak.toFixed(2)} g, front lock ${lockT.toFixed(2)} s, heading ${((v.psi - psi0) * D2R).toFixed(2)}°`);
  }
}

// ---- 8. Frame-rate independence ----------------------------------------------------------
// the game steps the physics at 240 Hz from an accumulator; inputs are sampled once per frame
// and the steering of the touch controls is smoothed per frame (controls.js: tc 35 ms)
if (on('fps')) {
  console.log('\n== Same driver input at different rendering frame rates (game step loop) ==');
  // smooth: a continuous thumb motion (Swimming Pool S-bend); steps: abrupt thumb jumps
  const smooth = (t) => ({ st: t < 1 ? 0 : t < 3.5 ? 0.55 * Math.sin(2 * Math.PI * 0.8 * (t - 1)) : 0, th: 0.85, br: 0 });
  const steps = (t) => ({ st: t < 1 ? 0 : t < 1.5 ? 0.6 : t < 2.0 ? -0.6 : t < 2.4 ? 0.3 : 0, th: t < 2.6 ? 0.8 : 1, br: 0 });
  const run = (fps, script, scheme) => {
    const v = new Vehicle(pad(), { assists }); v.reset(200, 0, { speed: 140 / 3.6 });
    let acc = 0, t = 0, steer = 0, prev = null, steps = 0, snap = null;
    const H = 1 / 240;
    const stepH = () => { v.step(H); steps++; if (steps === 960) snap = { x: v.x, z: v.z, psi: v.psi * D2R }; };
    while (steps < 960) {
      const dt = 1 / fps; t += dt;
      const s = script(t);
      if (scheme === 'old') {
        steer += (s.st - steer) * Math.min(1, dt / 0.035);
        v.setInput(steer, s.th, s.br);
        acc += dt; let n = 0;
        while (acc >= H && n < 14) { stepH(); acc -= H; n++; }
        if (n >= 14) acc = 0;
      } else {
        steer += (s.st - steer) * (1 - Math.exp(-dt / 0.035));
        const tgt = [steer, s.th, s.br]; prev = prev || tgt;
        acc += dt; const n = Math.min(14, Math.floor(acc / H));
        for (let j = 0; j < n; j++) { const f = (j + 1) / n; v.setInput(prev[0] + (tgt[0] - prev[0]) * f, prev[1] + (tgt[1] - prev[1]) * f, prev[2] + (tgt[2] - prev[2]) * f); stepH(); acc -= H; }
        if (n >= 14) acc = 0;
        prev = tgt;
      }
    }
    return snap;
  };
  for (const [name, script] of [['continuous thumb motion', smooth], ['abrupt thumb jumps', steps]]) {
    for (const scheme of ['old', 'new']) {
      const ref = run(240, script, scheme);
      const row = [30, 45, 60, 90, 120].map(fps => { const r = run(fps, script, scheme); return `${fps}fps ${Math.hypot(r.x - ref.x, r.z - ref.z).toFixed(2)}m/${Math.abs(r.psi - ref.psi).toFixed(2)}°`; });
      console.log(`${name.padEnd(24)} ${scheme === 'old' ? 'previous loop' : 'new loop     '}: deviation from 240 fps after 4 s -> ${row.join('  ')}`);
    }
  }
}

// ---- 9. Autopilot lap with slip statistics ------------------------------------------------
if (on('lap')) {
  console.log('\n== Autopilot lap: where the tyres are used beyond their peak ==');
  const T = buildTrack(); const line = buildRacingLine(T); const v = new Vehicle(T, { assists }); const ap = new Autopilot(T, line, { pace: 1 });
  let t = 0, lastS = v.s, started = null; const over = {};
  for (let n = 0; n < 240 * 200; n++) {
    const inp = ap.update(v, DT); v.setInput(inp.steer, inp.throttle, inp.brake); v.step(DT); t += DT;
    const rF = Math.abs(v.wheels[0].slipA + v.wheels[1].slipA) / 2 / AX.fp, rR = Math.abs(v.wheels[2].slipA + v.wheels[3].slipA) / 2 / AX.rp;
    if (started !== null) {
      const c = T.corners.reduce((a, c) => Math.abs(T.deltaS(v.s, c.s)) < Math.abs(T.deltaS(v.s, a.s)) ? c : a, T.corners[0]);
      const o = over[c.name] || (over[c.name] = { f: 0, r: 0, n: 0, b: 0 });
      o.n++; if (rF > 1) o.f++; if (rR > 1) o.r++; o.b = Math.max(o.b, Math.abs(beta(v)));
    }
    if (lastS > T.L - 50 && v.s < 50) { if (started !== null) { console.log(`lap ${(t - started).toFixed(3)} s`); break; } started = t; }
    lastS = v.s;
  }
  for (const [k, o] of Object.entries(over)) console.log(`  ${k.padEnd(22)} front>peak ${(o.f / o.n * 100).toFixed(0).padStart(3)}%  rear>peak ${(o.r / o.n * 100).toFixed(0).padStart(3)}%  max body slip ${o.b.toFixed(1)}°`);
}

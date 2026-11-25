// Test driver: minimum-curvature racing line, grip-limited speed profile and pure-pursuit
// steering. Used by the automated lap tests (Node and in-browser with ?autopilot=1) and for
// the menu's cinematic laps. Pure JS (no three.js).
import { steerLimit } from './physics.js';
import { SPEC } from './carspec.js';

export function buildRacingLine(T, { margin = 1.05, iters = 1400, mu = 1.70 } = {}) {
  const N = T.N;
  const d = new Float32Array(N);
  const px = new Float32Array(N), pz = new Float32Array(N);
  for (let it = 0; it < iters; it++) {
    for (let k = 0; k < N; k++) { px[k] = T.px[k] + T.nx[k] * d[k]; pz[k] = T.pz[k] + T.nz[k] * d[k]; }
    const st = it < iters * 0.6 ? 7 : 3;          // wide stencil first (fast convergence), then fine
    for (let k = 0; k < N; k++) {
      const a = (k - st + N) % N, b = (k + st) % N;
      const mx = (px[a] + px[b]) / 2, mz = (pz[a] + pz[b]) / 2;
      // move towards the midpoint, then re-express as lateral offset
      const dx = mx - px[k], dz = mz - pz[k];
      const lat = dx * T.nx[k] + dz * T.nz[k];
      const lim = Math.max(0, T.halfW[k] - margin);
      d[k] = Math.max(-lim, Math.min(lim, d[k] + lat * 0.5));
    }
  }
  // smooth d a little
  const out = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    let acc = 0;
    for (let j = -4; j <= 4; j++) acc += d[(k + j + N) % N];
    out[k] = acc / 9;
  }
  // curvature of the line
  const kap = new Float32Array(N);
  for (let k = 0; k < N; k++) { px[k] = T.px[k] + T.nx[k] * out[k]; pz[k] = T.pz[k] + T.nz[k] * out[k]; }
  for (let k = 0; k < N; k++) {
    const a = (k - 4 + N) % N, b = (k + 4) % N;
    const h1 = Math.atan2(pz[k] - pz[a], px[k] - px[a]), h2 = Math.atan2(pz[b] - pz[k], px[b] - px[k]);
    let dh = h2 - h1; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    const len = Math.hypot(px[b] - px[k], pz[b] - pz[k]) + Math.hypot(px[k] - px[a], pz[k] - pz[a]);
    kap[k] = Math.abs(dh) / (len / 2);
  }
  // speed profile from the same tyre model as the physics (load-sensitive grip)
  const m = SPEC.massKg, g = 9.81, kAero = 0.5 * 1.2 * 5.05 / m;
  const muAt = (vv) => {
    const Fz = (m * g + 0.5 * 1.2 * 5.05 * vv * vv) / 4;
    const lf = Math.max(0.72, Math.min(1.12, 1 - 0.085 * (Fz / 2400 - 1)));
    return 1.86 * lf * (mu / 1.86);
  };
  const vmax = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    let kk = 0;
    for (let j = -3; j <= 3; j++) kk = Math.max(kk, kap[(k + j + N) % N]);
    let vv = 30;
    for (let it = 0; it < 8; it++) {
      const mu2 = muAt(vv);
      const den = kk - mu2 * kAero;
      vv = den <= 1e-5 ? 84 : Math.min(84, Math.sqrt(mu2 * g / den));
    }
    vmax[k] = vv;
  }
  const v = Float32Array.from(vmax);
  const ds = T.ds;
  for (let pass = 0; pass < 2; pass++) {
    // backward (braking)
    for (let i = 2 * N; i > 0; i--) {
      const k = i % N, kn = (k + 1) % N;
      const vv = v[kn];
      const dec = muAt(vv) * 0.80 * (g + kAero * vv * vv);
      v[k] = Math.min(v[k], Math.sqrt(vv * vv + 2 * dec * ds));
    }
    // forward (traction / power)
    for (let i = 0; i < 2 * N; i++) {
      const k = i % N, kn = (k + 1) % N;
      const vv = v[k];
      const acc = Math.min(muAt(vv) * 0.5 * (g + kAero * vv * vv), 620e3 / (m * Math.max(8, vv))) - 0.5 * 1.2 * 1.6 * vv * vv / m;
      v[kn] = Math.min(v[kn], Math.sqrt(Math.max(0, vv * vv + 2 * Math.max(0, acc) * ds)));
    }
  }
  return { d: out, kappa: kap, vmax: v, px, pz };
}

export class Autopilot {
  constructor(T, line, { pace = 1.0 } = {}) {
    this.T = T; this.line = line; this.pace = pace;
    this.i = 0; this.out = { steer: 0, throttle: 0, brake: 0 };
    this.brakeCap = 1;
  }
  update(car, dt) {
    const T = this.T, L = this.line;
    const v = car.speed;
    const look = 3.5 + v * 0.30;
    const s = car.s;
    const tgt = T.pointAt(s + look, L.d[T.idxOfS(s + look)]);
    const fwd = [-Math.sin(car.psi), -Math.cos(car.psi)];
    const right = [Math.cos(car.psi), -Math.sin(car.psi)];
    const dx = tgt.x - car.x, dz = tgt.z - car.z;
    const ahead = dx * fwd[0] + dz * fwd[1], side = dx * right[0] + dz * right[1];
    const alpha = Math.atan2(side, Math.max(0.1, ahead));            // + = target to the right
    const delta = Math.atan(2 * SPEC.wheelbase * Math.sin(alpha) / look);
    const lim = steerLimit(v);
    let st = Math.min(1, Math.abs(delta) / lim);
    st = Math.pow(st, 1 / 1.2) * Math.sign(delta);
    this.out.steer = Math.max(-1, Math.min(1, st * 1.05));
    // speed control vs the profile a little ahead (braking needs anticipation)
    const vt = L.vmax[T.idxOfS(s + 4 + v * 0.12)] * this.pace;
    const err = vt - v;
    if (err > 0.5) { this.out.throttle = Math.min(1, err * 0.5 + 0.35); this.out.brake = 0; }
    else if (err < -1.2) { this.out.throttle = 0; this.out.brake = Math.min(1, -err * 0.18 + 0.15); }
    else { this.out.throttle = 0.25; this.out.brake = 0; }
    // threshold braking: like a driver, it feels the front tyres going past their peak slip
    // and eases the pedal (the car itself has no ABS), then squeezes it back on
    const kF = Math.min(car.wheels[0].kappa || 0, car.wheels[1].kappa || 0);
    if (kF < -0.13) this.brakeCap = Math.max(0.2, this.brakeCap - dt * 4);
    else this.brakeCap = Math.min(1, this.brakeCap + dt * (kF > -0.09 ? 2.5 : 0.6));
    this.out.brake = Math.min(this.out.brake, this.brakeCap);
    return this.out;
  }
}

// RB20 vehicle dynamics (planar chassis + per-wheel tyre forces), powertrain, automatic
// gearbox and barrier contact. Fixed sub-step integration (default 240 Hz).
//
// Frames: world x east, z south, y up. Car heading psi: forward = (-sin psi, -cos psi) in (x, z);
// psi grows when the car turns LEFT. Car-local offsets use carspec.js (x right, -z forward).
import { SPEC, Z, WHEELS, buildCollisionPoints } from './carspec.js';
import { Damage } from './damage.js';

const G = 9.81, RHO = 1.20;
export const IDLE_RPM = 4300, SHIFT_RPM = 11800, LIMIT_RPM = 12250;
// speed (km/h) at the shift point in each gear, Monaco gearing
const GEAR_TOP_KMH = [95, 125, 152, 178, 205, 232, 258, 290];
const R_ROLL = 0.352;
const RATIOS = GEAR_TOP_KMH.map(k => (SHIFT_RPM * Math.PI / 30) * R_ROLL / (k / 3.6));
const REVERSE_RATIO = RATIOS[0] * 1.1;
const DRIVELINE_EFF = 0.92;

const CLA = 5.05, AERO_FRONT = 0.44;          // Monaco high-downforce
const CDA = 1.58;
const IZ = 1250;                               // yaw inertia kg m^2
const MU0 = 1.86, MUX = 1.95, LOAD_SENS = 0.085;
// the 405 mm rears carry more load before their grip coefficient falls, and are stiffer
const AXLE = { front: { mu: 1.0, fz0: 2300, B: 17.5 }, rear: { mu: 1.07, fz0: 3000, B: 19.5 } };
const TYRE_C = 1.45;                           // lateral peak ~5.5-6 deg, ~25 % drop when sliding
const BRAKE_MAX = 5.4 * 805 * G, BRAKE_FRONT = 0.60;
const ES_MAX = 4e6;

export function wheelRate(v) { return v / R_ROLL; }

// maximum road-wheel angle available at speed (rad); full Monaco lock at hairpin speeds
export function steerLimit(v) {
  const lock = SPEC.steeringLockDeg * Math.PI / 180;
  const vv = Math.abs(v);
  if (vv < 15) return lock;
  return lock * Math.pow(15 / vv, 0.85);
}

export class Vehicle {
  constructor(track, opts = {}) {
    this.track = track;
    this.m = SPEC.massKg;
    this.a = SPEC.frontToCG;                    // CG -> front axle
    this.b = SPEC.wheelbase - SPEC.frontToCG;   // CG -> rear axle
    this.h = SPEC.cgHeight;
    this.points = buildCollisionPoints();
    this.damage = new Damage();
    this.assists = opts.assists || 'standard';
    this.wheels = WHEELS.map((w, i) => ({
      id: w.id, front: w.front, left: w.left,
      fo: -w.z, ro: w.x,                           // forward / right offsets from the CG
      r: w.r, Fz: 0, slipA: 0, slipX: 0, Fx: 0, Fy: 0, spin: 0, omega: 0,
      surface: 0, curbPhase: Math.random() * 10, travel: 0, contactY: 0, locked: false, spinning: false,
      sd: { s: 0, d: 0 },
    }));
    this.input = { steer: 0, throttle: 0, brake: 0 };
    this.events = [];
    this.reset(track.spawnS, 0);
  }

  reset(s, d = 0, { keepDamage = false, speed = 0 } = {}) {
    const T = this.track;
    const p = T.pointAt(s, d);
    const k = T.idxOfS(s);
    const tx = T.tx[k], tz = T.tz[k];
    this.x = p.x; this.z = p.z; this.y = p.y;
    this.psi = Math.atan2(-tx, -tz);            // forward = (tx, tz)
    const fx = -Math.sin(this.psi), fz = -Math.cos(this.psi);
    this.vx = fx * speed; this.vz = fz * speed;
    this.r = 0;
    this.s = s; this.d = d;
    this.delta = 0; this.deltaL = 0; this.deltaR = 0;
    this.gear = speed > 2 ? this._gearForSpeed(speed) : 1;
    this.rpm = IDLE_RPM; this.rpmVis = IDLE_RPM;
    this.shiftTimer = 0; this.shiftCut = 0; this.lastShift = 0; this.blip = 0;
    this.reverse = false; this.reverseHold = 0;
    this.ax = 0; this.ay = 0; this.axF = 0; this.ayF = 0;
    this.pitch = 0; this.roll = 0; this.heave = 0; this.yRoadPitch = 0; this.yRoadRoll = 0;
    this.es = ES_MAX; this.deploy = 0; this.harvest = 0; this.boost = 0;
    this.load = 0; this.torqueOut = 0; this.engineTorque = 0;
    this.time = 0;
    this.contact = { active: false, scrape: 0, part: null, tyre: 0 };
    this.curb = [0, 0, 0, 0];
    this.slide = 0; this.scrub = 0;
    this.offTrack = 0;
    for (const w of this.wheels) { w.spin = 0; w.omega = 0; w.travel = 0; w.sd.s = s; w.sd.d = d; }
    if (!keepDamage) this.damage.reset();
    this.events.length = 0;
    this._updateAttitude(0);
  }

  _gearForSpeed(v) {
    for (let g = 0; g < 8; g++) if (v * 3.6 < GEAR_TOP_KMH[g] * 0.82) return g + 1;
    return 8;
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  get fwd() { return [-Math.sin(this.psi), -Math.cos(this.psi)]; }

  setInput(steer, throttle, brake) {
    this.input.steer = Math.max(-1, Math.min(1, steer));
    this.input.throttle = Math.max(0, Math.min(1, throttle));
    this.input.brake = Math.max(0, Math.min(1, brake));
  }

  // -------------------------------------------------------------------------------------------
  step(dt) {
    const T = this.track;
    this.time += dt;
    const sinP = Math.sin(this.psi), cosP = Math.cos(this.psi);
    const fx = -sinP, fz = -cosP;              // forward
    const rx = cosP, rz = -sinP;               // right
    let u = this.vx * fx + this.vz * fz;       // longitudinal speed (+ forward)
    let vl = this.vx * rx + this.vz * rz;      // lateral speed (+ right)
    const v = Math.hypot(u, vl);
    const dmg = this.damage.factors();

    // --- steering (rate-limited), Ackermann ---------------------------------------------------
    const lim = steerLimit(u);
    const sIn = this.input.steer;
    const target = -Math.sign(sIn) * Math.pow(Math.abs(sIn), 1.2) * lim;   // + = left
    const rate = 1.35;                                                      // rad/s road wheel
    this.delta += Math.max(-rate * dt, Math.min(rate * dt, target - this.delta));
    const L = SPEC.wheelbase, tf = SPEC.trackFront;
    if (Math.abs(this.delta) > 1e-4) {
      const R = L / Math.tan(Math.abs(this.delta));
      const inner = Math.atan(L / Math.max(0.5, R - tf / 2)), outer = Math.atan(L / (R + tf / 2));
      if (this.delta > 0) { this.deltaL = inner; this.deltaR = outer; } else { this.deltaL = -outer; this.deltaR = -inner; }
    } else { this.deltaL = this.deltaR = this.delta; }

    // --- powertrain -----------------------------------------------------------------------------
    const thr = this.input.throttle, brk = this.input.brake;
    // reverse: hold the brake at standstill
    if (!this.reverse && v < 0.4 && brk > 0.5 && thr < 0.05) { this.reverseHold += dt; if (this.reverseHold > 0.55) { this.reverse = true; this.events.push({ type: 'gear', gear: -1 }); } }
    else if (!(this.reverse)) this.reverseHold = 0;
    if (this.reverse && thr > 0.1 && u > -0.5) { this.reverse = false; this.reverseHold = 0; this.gear = 1; this.events.push({ type: 'gear', gear: 1 }); }
    const drivePedal = this.reverse ? brk : thr;
    const brakePedal = this.reverse ? (thr > 0.1 ? thr : 0) : brk;

    const ratio = this.reverse ? REVERSE_RATIO : RATIOS[this.gear - 1];
    const wheelOmega = Math.abs(u) / R_ROLL;
    const rearSlip = Math.max(this.wheels[2].slipX, this.wheels[3].slipX);
    let rpmWheel = wheelOmega * ratio * 30 / Math.PI * (1 + Math.min(0.35, rearSlip));
    // clutch slip / launch control in first (and reverse): engine held up while the clutch slips
    let rpm = rpmWheel;
    if (this.gear === 1 || this.reverse) rpm = Math.max(rpm, IDLE_RPM + drivePedal * 5200 * Math.max(0, 1 - rpmWheel / 9500));
    rpm = Math.max(rpm, IDLE_RPM);
    // downshift blip lifts the revs briefly towards the next gear's speed
    if (this.blip > 0) { rpm = Math.max(rpm, this.blipRpm * (0.6 + 0.4 * this.blip / 0.09)); this.blip -= dt; }
    rpm = Math.min(rpm, LIMIT_RPM + 150);
    this.rpm = rpm;
    const omegaE = rpm * Math.PI / 30;

    // ICE power from the fuel-flow limit (100 kg/h above 10,500 rpm)
    const ff = Math.min(1, Math.max(0.14, (0.009 * rpm + 5.5) / 100));
    const Pice = 560e3 * ff;
    // MGU-K deploy (120 kW) on throttle, harvest on braking / lift
    this.deploy = 0; this.harvest = 0;
    let Pk = 0;
    if (!this.reverse && drivePedal > 0.85 && this.es > 0 && v > 8) { Pk = 120e3 * Math.min(1, (drivePedal - 0.85) / 0.1); this.deploy = Pk / 120e3; }
    // the MGU-H keeps topping up the store at full throttle (net drain ~40 kW)
    if (this.deploy > 0) this.es = Math.max(0, this.es - (Pk - 80e3) * dt);
    const limiter = rpm > LIMIT_RPM ? Math.max(0, 1 - (rpm - LIMIT_RPM) / 150) : 1;
    const cut = this.shiftCut > 0 ? 0.12 : 1;
    let Tcrank = (drivePedal * (Pice / omegaE) + Pk / omegaE) * limiter * cut;
    // engine braking when lifted
    const Tfric = (16 + 0.0062 * rpm) * (1 - drivePedal);
    Tcrank -= Tfric;
    this.engineTorque = Tcrank;
    this.load = Math.max(0, Math.min(1, (drivePedal * limiter * cut)));
    let Fdrive = Tcrank * ratio * DRIVELINE_EFF / R_ROLL;    // at the rear contact patches (total)
    if (this.reverse) Fdrive = -Math.max(0, Fdrive) * 0.35;
    if (Math.abs(u) < 0.3 && drivePedal < 0.02 && Fdrive < 0) Fdrive = 0;   // no creeping backwards
    if (u < 0 && !this.reverse && Fdrive < 0) Fdrive = Math.min(0, -Fdrive);
    // MGU-K harvest. Under braking the brake-by-wire system blends regen into the rear
    // braking (total rear braking still equals the driver's demand); when lifting without
    // braking a smaller "lift and coast" regen adds to engine braking.
    let Fharvest = 0, FliftRegen = 0;
    if (u > 6 && this.es < ES_MAX) {
      let Ph = 0;
      if (brakePedal > 0.1) Ph = 120e3 * Math.min(1, brakePedal * 1.5);
      else if (drivePedal < 0.05 && u > 20) { Ph = 45e3; FliftRegen = Ph / u; }
      Fharvest = Ph / Math.max(6, u);
      this.harvest = Ph / 120e3;
      this.es = Math.min(ES_MAX, this.es + Ph * dt * 0.95);
    }
    this.boost += ((drivePedal > 0.3 ? drivePedal : 0) * Math.min(1, rpm / 9000) - this.boost) * Math.min(1, dt * 7);

    // --- loads ----------------------------------------------------------------------------------
    const m = this.m;
    const Fdown = 0.5 * RHO * CLA * v * v;
    const FdF = Fdown * AERO_FRONT * dmg.frontAero, FdR = Fdown * (1 - AERO_FRONT) * dmg.rearAero;
    const asym = (dmg.frontLeft - dmg.frontRight) * 0.5;      // damaged side loses more
    const Wf = m * G * this.b / L, Wr = m * G * this.a / L;
    const dLong = m * this.axF * this.h / L;                  // + accel -> load to the rear
    const rsdF = 0.52;
    const dLatF = m * this.ayF * this.h / tf * rsdF;          // + right accel -> load to the left
    const dLatR = m * this.ayF * this.h / SPEC.trackRear * (1 - rsdF);
    const ws = this.wheels;
    ws[0].Fz = Wf / 2 + FdF / 2 * (1 + asym) - dLong / 2 + dLatF / 2;
    ws[1].Fz = Wf / 2 + FdF / 2 * (1 - asym) - dLong / 2 - dLatF / 2;
    ws[2].Fz = Wr / 2 + FdR / 2 + dLong / 2 + dLatR / 2;
    ws[3].Fz = Wr / 2 + FdR / 2 + dLong / 2 - dLatR / 2;

    // --- per-wheel tyre forces -----------------------------------------------------------------
    let Ff = 0, Fr = 0, Mz = 0;
    const brakeTotal = brakePedal * BRAKE_MAX;
    // brake migration: bias moves forward as speed (and downforce) falls
    const bias = BRAKE_FRONT + 0.03 * Math.max(0, Math.min(1, (45 - v) / 30));
    const rearHydraulic = Math.max(0, brakeTotal * (1 - bias) - Fharvest);
    let scrub = 0, slide = 0;
    for (let i = 0; i < 4; i++) {
      const w = ws[i];
      if (this.damage.wheelLost.has(w.id)) { w.Fz = 0; w.Fx = w.Fy = 0; continue; }
      const Fz = Math.max(0, w.Fz);
      // wheel contact patch velocity in the car frame
      const uw = u + this.r * w.ro;
      const vw = vl - this.r * w.fo;
      const toe = dmg.toe[w.id] || 0;
      const del = (w.front ? (i === 0 ? this.deltaL : this.deltaR) : 0) + toe;
      const cd = Math.cos(del), sd = Math.sin(del);
      const ut = uw * cd - vw * sd;          // along the wheel
      const vt = uw * sd + vw * cd;          // across the wheel (+ right)
      // surface grip
      const surf = w.surface;
      let muS = surf === 1 ? 0.94 : surf === 2 ? 0.88 : surf === 3 ? 0.75 : 1.0;
      const camberLoss = 1 - Math.min(0.25, Math.abs(dmg.camber[w.id] || 0) * 2.2);
      const ax = w.front ? AXLE.front : AXLE.rear;
      const loadF = Math.max(0.72, Math.min(1.12, 1 - LOAD_SENS * (Fz / ax.fz0 - 1)));
      const muY = MU0 * ax.mu * loadF * muS * camberLoss, muX = MUX * ax.mu * loadF * muS * camberLoss;
      const Dy = muY * Fz, Dx = muX * Fz;
      const alpha = Math.atan2(vt, Math.max(Math.abs(ut), 3.0));
      w.slipA = alpha;
      let FyPure = -Dy * Math.sin(TYRE_C * Math.atan(ax.B * alpha));
      // low-speed damping so the car does not creep sideways
      if (Math.abs(ut) < 3) FyPure += -vt * Fz * 0.12 * (1 - Math.abs(ut) / 3);
      // longitudinal demand
      let FxDem = 0;
      if (!w.front) FxDem += Fdrive / 2 - (brakePedal > 0.1 ? Fharvest : FliftRegen) / 2;
      const Fb = w.front ? brakeTotal * bias / 2 : rearHydraulic / 2;
      const dirU = Math.abs(ut) > 0.05 ? Math.sign(ut) : 0;
      FxDem -= Fb * dirU;
      if (dirU === 0 && Fb > 0) FxDem -= Math.max(-Fb, Math.min(Fb, ut * m * 4)); // holding at rest
      // assists: keep the longitudinal demand inside the available grip
      const uy = Math.min(1, Math.abs(FyPure) / Math.max(1, Dy));
      const avail = Dx * Math.sqrt(Math.max(0.05, 1 - uy * uy));
      if (this.assists === 'standard') {
        // rear axle keeps a lateral reserve while cornering (stability), fronts may brake to the limit
        const reserve = !w.front && uy > 0.45 ? 0.88 : 1.0;
        const capT = avail * 1.03 * reserve, capB = avail * (w.front ? 1.06 : 1.0) * reserve;
        if (FxDem > capT) FxDem = capT;
        if (FxDem < -capB) FxDem = -capB;
      }
      // combined slip on the friction ellipse
      let Fx = FxDem, Fy = FyPure;
      const ex = Fx / Math.max(1, Dx), ey = Fy / Math.max(1, Dy);
      const n = Math.hypot(ex, ey);
      w.locked = false; w.spinning = false; w.slipX = 0;
      if (Math.abs(FxDem) > Dx * 1.04 && v > 2) {
        // lock-up or wheelspin: the patch slides, total force = sliding friction along the slip
        const sx = FxDem > 0 ? 1 : -1;
        w.locked = sx < 0; w.spinning = sx > 0;
        const excess = Math.abs(FxDem) / Dx - 1;
        w.slipX = Math.min(1, excess);
        const slideMu = 0.82;
        const lat = Math.max(0.18, 0.55 - excess * 0.5);
        const gx = sx * 1.0, gy = (FyPure / Math.max(1, Dy)) * lat;
        const nn = Math.hypot(gx, gy);
        Fx = gx / nn * Dx * slideMu; Fy = gy / nn * Dy * slideMu;
      } else if (n > 1) {
        Fx /= n; Fy /= n;
        const pen = 1 - 0.12 * Math.min(1, n - 1);
        Fx *= pen; Fy *= pen;
      }
      w.Fx = Fx; w.Fy = Fy;
      // forces back into the car frame
      const Fcf = Fx * cd + Fy * sd;      // forward
      const Fcr = -Fx * sd + Fy * cd;     // right
      Ff += Fcf; Fr += Fcr;
      Mz += -w.fo * Fcr + w.ro * Fcf;
      // wheel spin (visual / audio)
      const spinOmega = w.locked ? 0 : (ut / w.r) * (w.spinning ? 1 + w.slipX * 0.6 : 1);
      w.omega = spinOmega;
      w.spin += spinOmega * dt;
      const slipMag = Math.min(1.5, Math.abs(alpha) / 0.10 + w.slipX * 1.5);
      scrub += slipMag * Math.min(1, v / 20) * Math.min(1, Fz / 3000);
      if (w.locked || w.spinning || Math.abs(alpha) > 0.12) slide = Math.max(slide, Math.min(1, w.slipX + Math.abs(alpha) * 3));
    }
    this.scrub = scrub / 4; this.slide = slide;

    // --- aero drag, rolling resistance, gravity on grades -------------------------------------
    const cda = CDA * (1 + dmg.dragAdd);
    const Fdrag = 0.5 * RHO * cda * v * v;
    const Froll = 0.014 * (ws[0].Fz + ws[1].Fz + ws[2].Fz + ws[3].Fz);
    if (v > 0.05) {
      const ux = u / v, vx = vl / v;
      Ff -= (Fdrag + Froll) * ux; Fr -= (Fdrag + Froll) * vx;
    }
    // slope: road gradient along the heading and bank across it
    const gGrade = this.yRoadPitch, gBank = this.yRoadRoll;
    Ff += -m * G * Math.sin(gGrade);
    Fr += m * G * Math.sin(gBank) * 0.9;

    // --- integrate ------------------------------------------------------------------------------
    const aF = Ff / m, aR = Fr / m;
    const axw = aF * fx + aR * rx, azw = aF * fz + aR * rz;
    this.vx += axw * dt; this.vz += azw * dt;
    this.r += Mz / IZ * dt;
    // yaw damping at very low speed (tyres can't hold a yaw rate when stationary)
    if (v < 1.5) this.r *= 1 - Math.min(1, dt * 6 * (1.5 - v));
    if (v < 0.25 && drivePedal < 0.02) { this.vx *= 0.9; this.vz *= 0.9; }
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.psi += this.r * dt;
    // accelerations in the car frame (filtered for load transfer & visuals)
    // centripetal included: a_lat = dv_l/dt + u*r
    this.ax = aF; this.ay = aR;
    const kF = Math.min(1, dt * 18);
    this.axF += (this.ax - this.axF) * kF; this.ayF += (this.ay - this.ayF) * kF;

    // --- gearbox --------------------------------------------------------------------------------
    this._gearbox(dt, u, drivePedal, brakePedal);

    // --- track position, surfaces, attitude, barriers -----------------------------------------
    const pr = T.project(this.x, this.z, this.s);
    if (pr.ok) { this.s = pr.s; this.d = pr.d; }
    this._wheelSurfaces(dt);
    this._updateAttitude(dt);
    this._barriers(dt);
  }

  _gearbox(dt, u, thr, brk) {
    this.lastShift += dt;
    if (this.shiftCut > 0) this.shiftCut -= dt;
    if (this.reverse) return;
    const kmh = u * 3.6;
    const g = this.gear;
    const upRpm = thr > 0.8 ? SHIFT_RPM : 10400 + 1400 * thr;
    const rpmAt = (gear) => Math.abs(u) / R_ROLL * RATIOS[gear - 1] * 30 / Math.PI;
    if (g < 8 && rpmAt(g) > upRpm && this.lastShift > 0.18 && thr > 0.05) {
      this.gear++; this.lastShift = 0; this.shiftCut = 0.045;
      this.events.push({ type: 'upshift', gear: this.gear, rpmFrom: this.rpm, rpmTo: rpmAt(this.gear) });
    } else if (g > 1) {
      const lower = rpmAt(g - 1);
      const braking = brk > 0.1;
      const downAt = braking ? 11000 : (thr > 0.5 ? 7600 : 6200);
      if (lower < downAt && this.lastShift > (braking ? 0.13 : 0.3)) {
        this.gear--; this.lastShift = 0;
        this.blip = 0.09; this.blipRpm = Math.min(LIMIT_RPM, lower * 1.06);
        this.events.push({ type: 'downshift', gear: this.gear, rpmFrom: this.rpm, rpmTo: lower });
      }
    }
    if (kmh < 12 && this.gear > 1 && this.lastShift > 0.1) { this.gear = 1; this.lastShift = 0; this.events.push({ type: 'downshift', gear: 1, rpmFrom: this.rpm, rpmTo: IDLE_RPM }); }
  }

  _wheelSurfaces(dt) {
    const T = this.track;
    const sinP = Math.sin(this.psi), cosP = Math.cos(this.psi);
    const fx = -sinP, fz = -cosP, rx = cosP, rz = -sinP;
    const v = this.speed;
    let off = 0;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const wx = this.x + rx * w.ro + fx * w.fo, wz = this.z + rz * w.ro + fz * w.fo;
      const pr = T.project(wx, wz, this.s, w.sd);
      w.wx = wx; w.wz = wz;
      w.surface = T.surfaceAt(pr.s, pr.d);
      w.contactY = T.heightAt(pr.s, pr.d);
      // kerb bumps: ~1 m stripes, amplitude grows with speed
      let bump = 0;
      if (w.surface === 1) {
        w.curbPhase += v * dt / 1.0 * Math.PI * 2;
        bump = 0.007 * Math.max(0, Math.sin(w.curbPhase)) * Math.min(1, v / 15);
        this.curb[i] = Math.min(1, 0.25 + v / 40);
      } else {
        this.curb[i] = 0;
        // street surface ripple
        bump = 0.0012 * Math.sin(pr.s * 1.7 + i) * Math.sin(pr.s * 0.37) * Math.min(1, v / 30);
      }
      if (w.surface >= 2) off++;
      w.travel += (bump - 0.018 * Math.min(1, (v / 80) ** 2) - w.travel) * Math.min(1, dt * 40);
    }
    this.offTrack = off;
  }

  _updateAttitude(dt) {
    const ws = this.wheels;
    if (ws[0].contactY === undefined || ws[0].wx === undefined) {
      this.y = this.track.heightAt(this.s, this.d);
      return;
    }
    const hF = (ws[0].contactY + ws[1].contactY) / 2, hR = (ws[2].contactY + ws[3].contactY) / 2;
    const hL = (ws[0].contactY + ws[2].contactY) / 2, hRt = (ws[1].contactY + ws[3].contactY) / 2;
    const L = SPEC.wheelbase, t = (SPEC.trackFront + SPEC.trackRear) / 2;
    this.yRoadPitch = Math.atan2(hF - hR, L);          // + = nose up (climbing)
    this.yRoadRoll = Math.atan2(hL - hRt, t);           // + = left side higher
    this.y = hR + (hF - hR) * (this.b / L);
    // dynamic attitude from accelerations (stiff F1 platform: ~1 deg under 5 g braking)
    const pitchDyn = this.axF * 0.00034;            // braking (ax < 0) dives the nose
    const rollDyn = this.ayF * 0.00028;
    this.pitch = pitchDyn; this.roll = rollDyn;
    this.heave = -0.018 * Math.min(1, (this.speed / 80) ** 2);
  }

  // Barrier contact: impulse-based with friction, at each collision point (CCD via sub-stepping
  // + one-sided barrier half-spaces: a point that has crossed is always pushed back).
  _barriers(dt) {
    const T = this.track;
    const sMid = this.s;
    const bl = T.sample(T.barL, sMid), br = T.sample(T.barR, sMid);
    const reach = 3.4;
    this.contact.active = false;
    let scrapeNow = 0;
    if (this.d + reach < bl && -this.d + reach < br) { this.contact.scrape *= 0.9; return; }
    const sinP = Math.sin(this.psi), cosP = Math.cos(this.psi);
    const fx = -sinP, fz = -cosP, rx = cosP, rz = -sinP;
    const m = this.m;
    const tmp = { s: 0, d: 0 };
    for (let iter = 0; iter < 2; iter++) {
      for (const P of this.points) {
        if (P.part.startsWith('wheel') && this.damage.wheelLost.has(P.part.slice(5))) continue;
        const fo = -P.z, ro = P.x;
        const px = this.x + rx * ro + fx * fo, pz = this.z + rz * ro + fz * fo;
        const pr = T.project(px, pz, sMid, tmp);
        if (!pr.ok) continue;
        const left = pr.d > 0;
        const bar = left ? T.sample(T.barL, pr.s) : T.sample(T.barR, pr.s);
        if (Math.abs(pr.d) + P.r < bar) continue;
        // barrier point and inward normal from the local barrier polyline
        const s0 = pr.s - 0.6, s1 = pr.s + 0.6;
        const b0 = T.pointAt(s0, left ? T.sample(T.barL, s0) : -T.sample(T.barR, s0));
        const b1 = T.pointAt(s1, left ? T.sample(T.barL, s1) : -T.sample(T.barR, s1));
        let tx = b1.x - b0.x, tz = b1.z - b0.z; const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
        let nx = -tz, nz = tx;   // a perpendicular
        const bc = T.pointAt(pr.s, left ? bar : -bar);
        const cpt = T.pointAt(pr.s, 0);
        if ((cpt.x - bc.x) * nx + (cpt.z - bc.z) * nz < 0) { nx = -nx; nz = -nz; }
        const pen = P.r - ((px - bc.x) * nx + (pz - bc.z) * nz);
        if (pen <= 0) continue;
        // contact point velocity
        const rxw = px - this.x, rzw = pz - this.z;
        // yaw rate r (+ = CCW seen from above, x east z south): v = w x r with w along +y
        // w=(0,r,0), r=(rxw,0,rzw): w x r = (r*rzw, 0, -r*rxw)
        const vpx = this.vx + this.r * rzw, vpz = this.vz - this.r * rxw;
        const vn = vpx * nx + vpz * nz;
        // effective mass along the normal: angular term from (r x n)_y
        const rxn = rzw * nx - rxw * nz;          // (r x n).y
        const invM = 1 / m + rxn * rxn / IZ;
        const isTyre = P.kind === 'tyre';
        const kindE = T.inTunnel(pr.s) ? 0.22 : (T.sample(left ? T.gapL : T.gapR, pr.s) > 2 ? 0.06 : 0.14);
        let Jn = 0;
        if (vn < 0) {
          const e = vn < -1.2 ? kindE : 0;          // slow contacts don't bounce
          Jn = -(1 + e) * vn / invM;
          const energy = 0.5 * vn * vn / invM;
          if (iter === 0 && energy > 120) this._registerImpact(P, energy, -vn, (vpx * -nz + vpz * nx), px, pz, isTyre);
        }
        // positional correction (no penetration, no bounce at rest)
        const corr = Math.max(0, pen - 0.002) * 0.85;
        this.x += nx * corr * (1 / m) / invM; this.z += nz * corr * (1 / m) / invM;
        // apply normal impulse
        if (Jn > 0) {
          this.vx += Jn * nx / m; this.vz += Jn * nz / m;
          // torque about +y: (R x J).y = rzw*Jx - rxw*Jz = Jn * (rzw*nx - rxw*nz)
          this.r += (Jn * rxn) / IZ;
        }
        // friction along the barrier tangent
        let tnx = -nz, tnz = nx;
        const vpx2 = this.vx + this.r * rzw, vpz2 = this.vz - this.r * rxw;
        const vt = vpx2 * tnx + vpz2 * tnz;
        const rxt = rzw * tnx - rxw * tnz;
        const invMt = 1 / m + rxt * rxt / IZ;
        const mu = isTyre ? 0.95 : 0.38;
        const Nimp = Math.max(Jn, pen * m * 30 * dt);      // resting contact still rubs
        let Jt = -vt / invMt;
        Jt = Math.max(-mu * Nimp, Math.min(mu * Nimp, Jt));
        this.vx += Jt * tnx / m; this.vz += Jt * tnz / m;
        this.r += (Jt * rxt) / IZ;
        if (iter === 0) {
          this.contact.active = true;
          if (Math.abs(vt) > 1.5) {
            const power = Math.abs(vt) * Math.max(Nimp / dt, 0) * 0.002;
            scrapeNow = Math.max(scrapeNow, Math.min(1, Math.abs(vt) / 25) * (isTyre ? 0.5 : 1));
            if (!isTyre) this.damage.scrape(P.part, Math.min(4e4, power), dt);
            this.contact.part = P.part;
            this.contact.tyre = isTyre ? 1 : 0;
            this.contact.x = px; this.contact.z = pz;
          }
        }
      }
    }
    this.contact.scrape += (scrapeNow - this.contact.scrape) * (scrapeNow > this.contact.scrape ? 0.5 : 0.12);
  }

  _registerImpact(P, energy, vn, vt, px, pz, isTyre) {
    const res = this.damage.impact(P.part, energy, vn, vt, isTyre ? 'tyre' : 'carbon');
    // scale: scrape < 2.5 kJ, glancing < 15 kJ, heavy above
    const kind = isTyre ? 'wheel' : (energy > 25000 ? 'heavy' : energy > 2500 ? 'glance' : 'scrape');
    this.events.push({ type: 'impact', kind, part: P.part, energy, vn, vt, x: px, z: pz, y: this.y + 0.3, severity: res.severity, broken: res.newlyBroken });
  }

  // world transform helpers for rendering ------------------------------------------------------
  wheelSteer(i) {
    const toe = this.damage.factors().toe[this.wheels[i].id] || 0;
    return (i === 0 ? this.deltaL : i === 1 ? this.deltaR : 0);
  }
}

export { RATIOS, GEAR_TOP_KMH, R_ROLL };

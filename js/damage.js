// Damage model. Impacts are resolved per contact point (part of the car that touched the
// barrier), using the energy dissipated in the normal direction at that point. Parts lose
// "health" (1 = intact, 0 = destroyed); health feeds the aerodynamics, the steering
// geometry and the "undriveable" decision. The survival cell is never damaged.
import { PARTS } from './carspec.js';

const J_PER_UNIT = 9000;          // energy (J) that removes 1.0 health from a part of strength 1
// Suspension and wheel assemblies absorb light contacts elastically (tyre sidewall, rim,
// compliant links): a brush below this energy leaves no permanent damage or misalignment.
const WHEEL_ELASTIC_J = 3500;
// Wheel alignment only changes once the corner is visibly damaged (HUD level >= 1).
const MISALIGN_BELOW = 0.7;

export class Damage {
  constructor() { this.reset(); }

  reset() {
    this.health = {};
    for (const k of Object.keys(PARTS)) this.health[k] = 1;
    this.toe = { FL: 0, FR: 0, RL: 0, RR: 0 };       // rad, + = toe-left
    this.toeDir = {};
    this.camber = { FL: 0, FR: 0, RL: 0, RR: 0 };
    this.broken = new Set();                           // parts that have come off
    this.wheelLost = new Set();
    this.undriveable = false;
    this.reason = '';
    this.maxImpactJ = 0;
    this.version = 0;                                  // bumps on every visible change
  }

  // part: key from PARTS, energy: J, vn: closing speed (m/s), side: -1 left / +1 right of the car
  // Returns { severity: 0..1, newlyBroken: [parts], level }
  impact(part, energy, vn, vt, kind) {
    const spec = PARTS[part];
    if (!spec) return { severity: 0, newlyBroken: [] };
    this.maxImpactJ = Math.max(this.maxImpactJ, energy);
    const isWheel = part.startsWith('wheel');
    const effective = isWheel ? Math.max(0, energy - WHEEL_ELASTIC_J) : energy;
    const dmg = effective / (spec.strength * J_PER_UNIT);
    const before = this.health[part];
    this.health[part] = Math.max(0, before - dmg);
    const newly = [];
    // a hard frontal hit on the nose also takes the front wing with it
    if (part === 'nose' && this.health.nose < 0.35) {
      for (const p of ['fwL', 'fwR']) this.health[p] = Math.min(this.health[p], 0.15);
    }
    // wheels: a hard strike bends the suspension (toe / camber) in the direction of the
    // impact; light brushes stay elastic and leave the alignment untouched
    if (isWheel && dmg > 0) {
      const id = part.slice(5);
      const bend = Math.max(0, MISALIGN_BELOW - this.health[part]);
      if (bend > 0) {
        const dir = Math.sign(vt || 1) * (id.endsWith('L') ? 1 : -1);
        if (!this.toeDir) this.toeDir = {};
        if (!this.toeDir[id]) this.toeDir[id] = dir;               // a bent link stays bent the same way
        this.toe[id] = this.toeDir[id] * Math.min(0.055, bend * 0.09);          // up to ~3°
        this.camber[id] = (id.endsWith('L') ? -1 : 1) * Math.min(0.06, bend * 0.08);
      }
    }
    for (const p of Object.keys(this.health)) {
      if (this.health[p] < 0.3 && !this.broken.has(p) && (p.startsWith('fw') || p === 'nose' || p.startsWith('rw') || p.startsWith('wheel'))) {
        this.broken.add(p); newly.push(p);
        if (p.startsWith('wheel') && this.health[p] < 0.12) this.wheelLost.add(p.slice(5));
      }
    }
    // heavy impact anywhere
    if (energy > 160000) this._end('Heavy impact');
    if (this.wheelLost.size) this._end('Suspension failure – a wheel has come off');
    if (this.health.gearbox < 0.12) this._end('Gearbox and rear crash structure destroyed');
    if (this.health.nose < 0.05 && energy > 60000) this._end('Heavy frontal impact');
    if (dmg > 0.005) this.version++;
    const severity = Math.min(1, energy / 60000);
    return { severity, newlyBroken: newly, before, after: this.health[part] };
  }

  // Energy a part can still absorb before it breaks (frangible parts: wings, nose, wheels...)
  absorbable(part) {
    const spec = PARTS[part];
    if (!spec) return Infinity;                        // survival cell: rigid
    return Math.max(300, this.health[part] * spec.strength * J_PER_UNIT);
  }
  // Broken-off parts no longer touch anything
  gone(part) {
    if (part.startsWith('wheel')) return this.wheelLost.has(part.slice(5));
    if (part === 'fwL' || part === 'fwR') return this.broken.has(part) || this.broken.has('nose');
    if (part === 'nose' || part === 'rwL' || part === 'rwR') return this.broken.has(part);
    return false;
  }

  // continuous scraping (carbon sliding on the barrier): small local wear
  scrape(part, power, dt) {
    if (!PARTS[part]) return;
    const d = power * dt / (PARTS[part].strength * J_PER_UNIT * 6);
    this.health[part] = Math.max(0, this.health[part] - d);
  }

  _end(reason) {
    if (!this.undriveable) { this.undriveable = true; this.reason = reason; this.version++; }
  }

  // Aerodynamic and mechanical consequences used by the physics
  factors() {
    const h = this.health;
    const fwL = this.broken.has('fwL') ? 0.25 : 0.4 + 0.6 * h.fwL;
    const fwR = this.broken.has('fwR') ? 0.25 : 0.4 + 0.6 * h.fwR;
    const nose = 0.3 + 0.7 * h.nose;
    const front = Math.min(fwL, fwR) * 0.3 + (fwL + fwR) * 0.35 * nose;   // 0..1
    const rw = (h.rwL + h.rwR) / 2;
    const floor = 0.6 + 0.4 * (h.floorL + h.floorR) / 2 * (0.5 + 0.5 * h.diffuser);
    return {
      frontAero: Math.max(0.2, front),
      frontLeft: fwL, frontRight: fwR,
      rearAero: (0.45 + 0.55 * rw) * floor,
      dragAdd: (1 - rw) * 0.12 + (2 - fwL - fwR) * 0.04,
      toe: this.toe, camber: this.camber,
    };
  }

  level(part) {
    const v = this.health[part];
    if (v === undefined) return 0;
    if (this.broken.has(part) || v < 0.3) return 2;
    if (v < 0.85) return 1;
    return 0;
  }
}

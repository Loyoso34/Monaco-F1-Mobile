// Time trial rules: timing starts on the first FORWARD crossing of the start/finish line; a lap
// counts only if every checkpoint was passed in order and the line is crossed forward again.
// Reverse crossings never start or complete a lap. Cutting the Nouvelle Chicane or either
// Swimming Pool chicane invalidates the lap immediately ("Lap invalid — corner cut."); the
// player continues and a fresh lap starts at the next valid forward crossing.
import { loadBest, saveBest } from './settings.js';

export class Timing {
  constructor(track) {
    this.T = track;
    this.best = loadBest()?.time ?? null;
    this.messages = [];
    this.reset();
  }
  reset() {
    this.state = 'out';         // 'out' (not started) | 'running'
    this.lapStart = 0; this.nextCp = 0; this.invalid = false; this.invalidReason = '';
    this.last = null; this.lapNo = 0; this.prevS = null; this.prevSign = 0;
  }
  // Teleports (reset car) must not register as crossings
  teleport(s) { this.prevS = s; }

  current(simTime) { return this.state === 'running' ? simTime - this.lapStart : null; }

  invalidate(reason) {
    if (this.state !== 'running' || this.invalid) return;
    this.invalid = true; this.invalidReason = reason;
    this.messages.push({ text: reason === 'cut' ? 'Lap invalid — corner cut.' : 'Lap invalid — car reset.', kind: 'bad', dur: 3.2 });
  }

  update(car, simTime) {
    const T = this.T, s = car.s, L = T.L;
    if (this.prevS === null) { this.prevS = s; return; }
    const ps = this.prevS;
    this.prevS = s;
    const ds = T.deltaS(ps, s);
    if (Math.abs(ds) > 30) return;                 // projection jump / teleport
    // direction of travel along the track
    const k = T.idxOfS(s);
    const vAlong = car.vx * T.tx[k] + car.vz * T.tz[k];
    const crossedLine = (ps > L - 40 && s < 40 && ds > 0) || (ps < 40 && s > L - 40 && ds < 0);
    const onTrack = Math.abs(car.d) < Math.max(T.sample(T.barL, s), T.sample(T.barR, s)) + 1;
    if (crossedLine && onTrack) {
      if (ds > 0 && vAlong > 0) this._forwardCross(simTime);
      else if (ds < 0) this._reverseCross();
    }
    // checkpoints (in order)
    if (this.state === 'running') {
      const cps = T.checkpoints;
      if (this.nextCp < cps.length) {
        const cp = cps[this.nextCp];
        if (ds > 0 && T.deltaS(ps, cp) > 0 && T.deltaS(cp, s) >= 0 && vAlong > 0) this.nextCp++;
      }
      if (this.nextCp > 0 && ds < 0) {
        const cp = cps[this.nextCp - 1];
        if (T.deltaS(s, cp) > 0 && T.deltaS(cp, ps) >= 0) this.nextCp--;   // backed over it
      }
      // corner cuts
      for (const z of T.cutZones) {
        if (T.deltaS(z.s0, s) >= 0 && T.deltaS(s, z.s1) >= 0) {
          const curb = car.d > 0 ? T.sample(T.curbL, s) : T.sample(T.curbR, s);
          const limit = T.sample(T.halfW, s) + curb + 0.55;
          if (Math.abs(car.d) > limit) this.invalidate('cut');
        }
      }
    }
  }

  _forwardCross(t) {
    if (this.state === 'out') {
      this._startLap(t);
      this.messages.push({ text: 'Lap started', kind: 'good', dur: 1.6 });
      return;
    }
    const complete = this.nextCp >= this.T.checkpoints.length;
    if (complete && !this.invalid) {
      const lap = t - this.lapStart;
      this.last = lap;
      const pb = this.best === null || lap < this.best;
      if (pb) { this.best = lap; saveBest(lap); }
      this.messages.push({ text: (pb ? 'Personal best  ' : 'Lap  ') + fmt(lap), kind: pb ? 'best' : 'good', dur: 4.5, lap });
    } else if (complete && this.invalid) {
      this.messages.push({ text: 'Lap not counted — corner cut', kind: 'bad', dur: 2.5 });
    }
    this._startLap(t);
  }
  _reverseCross() {
    // never starts or completes a lap; the lap in progress no longer counts
    if (this.state === 'running') { this.invalid = true; this.invalidReason = 'reverse'; this.nextCp = 0; }
  }
  _startLap(t) {
    this.state = 'running'; this.lapStart = t; this.nextCp = 0; this.invalid = false; this.invalidReason = ''; this.lapNo++;
  }
}
function fmt(t) { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(3).padStart(6, '0')}`; }

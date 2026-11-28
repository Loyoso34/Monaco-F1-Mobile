// HUD: lap timer, last / best, lap number, speed (km/h), gear, rev lights, damage diagram and
// transient messages. DOM text is refreshed at ~20 Hz; messages animate with opacity only.
import { fmtTime } from './settings.js';
import { SHIFT_RPM } from './physics.js';
import { t } from './i18n.js';

export class Hud {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = { cur: $('tCur'), last: $('tLast'), best: $('tBest'), lap: $('lapNo'), gear: $('gear'), speed: $('speed'), revs: $('revs'), m1: $('msg1'), m2: $('msg2'), camLabel: $('camLabel'), fps: $('fps') };
    for (let i = 0; i < 15; i++) { const d = document.createElement('i'); this.el.revs.appendChild(d); }
    this.revEls = [...this.el.revs.children];
    this.acc = 0; this.queue = []; this.showing = [null, null];
    this.dmgEls = {};
    for (const id of ['fwL', 'fwR', 'nose', 'wheelFL', 'wheelFR', 'body', 'wheelRL', 'wheelRR', 'rw']) this.dmgEls[id] = document.getElementById('dm-' + id);
    this.lastDmgVer = -1; this.camLabelT = 0;
    this.prev = {};
  }
  flashCamera(label) { this.el.camLabel.textContent = label; this.el.camLabel.style.opacity = '1'; this.camLabelT = 1.6; }
  // messages are kept as a key + values and rendered when shown, so they always appear (and
  // stay) in the current language
  message(key, vars, kind = '', dur = 2.5) { this.queue.push({ key, vars, kind, dur }); }
  clearMessages() {
    this.queue.length = 0;
    for (let i = 0; i < 2; i++) { this.showing[i] = null; const el = i ? this.el.m2 : this.el.m1; el.classList.remove('on'); el.textContent = ''; }
  }
  // language switch: rewrite the text fields on the next refresh and the messages on screen now
  relabel() {
    this.prev.lap = null;
    for (let i = 0; i < 2; i++) { const s = this.showing[i]; if (s) (i ? this.el.m2 : this.el.m1).textContent = t(s.key, s.vars); }
  }

  set(k, el, v) { if (this.prev[k] !== v) { this.prev[k] = v; el.textContent = v; } }

  update(dt, car, timing, simTime, fps) {
    this.acc += dt;
    if (this.camLabelT > 0) { this.camLabelT -= dt; if (this.camLabelT <= 0) this.el.camLabel.style.opacity = '0'; }
    // messages: two slots
    for (let i = 0; i < 2; i++) {
      const s = this.showing[i];
      if (s) { s.t -= dt; if (s.t <= 0) { this.showing[i] = null; const el = i ? this.el.m2 : this.el.m1; el.classList.remove('on'); setTimeout(() => { if (!this.showing[i]) el.textContent = ''; }, 300); } }
    }
    while (this.queue.length && (!this.showing[0] || !this.showing[1])) {
      const m = this.queue.shift();
      const i = !this.showing[0] ? 0 : 1;
      const el = i ? this.el.m2 : this.el.m1;
      el.textContent = t(m.key, m.vars); el.className = 'm on ' + (m.kind || '');
      this.showing[i] = { t: m.dur, key: m.key, vars: m.vars };
    }
    if (this.acc < 0.05) return;
    this.acc = 0;
    const kmh = Math.round(car.speed * 3.6 * (car.vx * Math.sin(-car.psi) + car.vz * -Math.cos(car.psi) < -0.5 ? 1 : 1));
    this.set('speed', this.el.speed, String(kmh));
    this.set('gear', this.el.gear, car.reverse ? 'R' : (car.speed < 0.6 && car.input.throttle < 0.05 ? 'N' : String(car.gear)));
    // rev lights: green 5 / red 5 / blue 5 from ~9,800 rpm to the shift point; flash at the limit
    const f = (car.rpm - 9600) / (SHIFT_RPM - 9600);
    const n = Math.max(0, Math.min(15, Math.round(f * 15)));
    if (this.prev.revN !== n) {
      this.prev.revN = n;
      this.revEls.forEach((e, i) => { e.className = i < n ? (i < 5 ? 'g' : i < 10 ? 'r' : 'b') : ''; });
    }
    this.el.revs.classList.toggle('flash', car.rpm > SHIFT_RPM + 150);
    const cur = timing.current(simTime);
    this.set('cur', this.el.cur, timing.state === 'out' ? '0:00.000' : fmtTime(cur));
    this.el.cur.classList.toggle('invalid', timing.invalid);
    this.set('last', this.el.last, fmtTime(timing.last));
    this.set('best', this.el.best, fmtTime(timing.best));
    this.set('lap', this.el.lap, timing.state === 'out' ? t('hud.outLap') : t('hud.lap', { n: timing.lapNo }) + (timing.invalid ? t('hud.invalid') : ''));
    if (fps != null) this.set('fps', this.el.fps, fps);
    // damage diagram
    const dm = car.damage;
    if (dm.version !== this.lastDmgVer) {
      this.lastDmgVer = dm.version;
      const lvl = (p) => dm.level(p);
      const setL = (id, l) => { const e = this.dmgEls[id]; e.classList.toggle('d1', l === 1); e.classList.toggle('d2', l >= 2); };
      setL('fwL', lvl('fwL')); setL('fwR', lvl('fwR')); setL('nose', lvl('nose'));
      for (const w of ['FL', 'FR', 'RL', 'RR']) setL('wheel' + w, lvl('wheel' + w));
      setL('rw', Math.max(lvl('rwL'), lvl('rwR')));
      setL('body', Math.max(lvl('sidepodL'), lvl('sidepodR'), lvl('floorL'), lvl('floorR'), lvl('diffuser'), lvl('gearbox')));
    }
  }
}

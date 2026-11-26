// Two-thumb landscape controls: a horizontal steering zone under the left thumb (relative:
// the touch can start anywhere, the knob follows, release recentres smoothly) and analog
// throttle / brake pedals under the right thumb (press higher on the pedal for more). A
// finger that slides from one pedal to the other switches pedals immediately.
import { settings } from './settings.js';

export class Controls {
  constructor(el) {
    this.zone = el.querySelector('#steerZone');
    this.knob = el.querySelector('#steerKnob');
    this.pedalEls = { brake: el.querySelector('#brake'), throttle: el.querySelector('#throttle') };
    this.fills = { brake: this.pedalEls.brake.querySelector('.fill'), throttle: this.pedalEls.throttle.querySelector('.fill') };
    this.steerTouch = null; this.steerStartX = 0; this.steerRaw = 0; this.steer = 0;
    this.pedalTouches = new Map();       // touch id -> { pedal, value }
    this.throttle = 0; this.brake = 0;
    this.keys = new Set();
    this.enabled = false;
    this._bind();
  }

  _bind() {
    const opts = { passive: false };
    const onStart = (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) this._touchStart(t);
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) this._touchMove(t);
      e.preventDefault();
    };
    const onEnd = (e) => {
      for (const t of e.changedTouches) this._touchEnd(t);
      if (this.enabled) e.preventDefault();
    };
    const layer = this.zone.parentElement;
    layer.addEventListener('touchstart', onStart, opts);
    layer.addEventListener('touchmove', onMove, opts);
    layer.addEventListener('touchend', onEnd, opts);
    layer.addEventListener('touchcancel', onEnd, opts);
    // mouse (desktop testing): treat as a single touch
    let mouseDown = false;
    layer.addEventListener('mousedown', (e) => { if (!this.enabled) return; mouseDown = true; this._touchStart({ identifier: 'm', clientX: e.clientX, clientY: e.clientY }); });
    window.addEventListener('mousemove', (e) => { if (mouseDown) this._touchMove({ identifier: 'm', clientX: e.clientX, clientY: e.clientY }); });
    window.addEventListener('mouseup', () => { if (mouseDown) { mouseDown = false; this._touchEnd({ identifier: 'm' }); } });
    window.addEventListener('keydown', (e) => { this.keys.add(e.code); });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
  }

  _hit(el, x, y, pad = 0) {
    const r = el.getBoundingClientRect();
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  }
  _pedalAt(x, y) {
    for (const k of ['brake', 'throttle']) if (this._hit(this.pedalEls[k], x, y, 14)) return k;
    return null;
  }
  _pedalValue(k, y) {
    const r = this.pedalEls[k].getBoundingClientRect();
    const rel = Math.max(0, Math.min(1, (y - r.top) / r.height));     // 0 top .. 1 bottom
    if (k === 'brake') {
      // brake pressure is progressive over the whole pedal: ~22 % at the bottom edge, ~65 %
      // in the middle, 100 % only at the top -- slide the thumb down to bleed pressure off
      // as the speed (and downforce) falls, like a driver does with the pedal
      const top = Math.max(0, rel - 0.06) / 0.94;
      return Math.max(0.22, Math.min(1, 0.22 + 0.78 * Math.pow(1 - top, 0.85)));
    }
    // throttle: the top third of the pad is full throttle; below it the demand falls
    // progressively to 25 % at the bottom edge, so a thumb can feed the power in out of slow
    // corners (it was full over the top 70 %: practically on / off)
    const low = Math.max(0, rel - 0.32) / 0.68;
    return Math.max(0.25, Math.min(1, 1 - 0.75 * Math.pow(low, 0.85)));
  }
  // front tyres locking: the brake pedal glows so the driver can ease off
  setLock(on) {
    if (on !== this._lock) { this._lock = on; this.pedalEls.brake.classList.toggle('lock', on); }
  }

  _touchStart(t) {
    const x = t.clientX, y = t.clientY;
    if (this.steerTouch === null && this._hit(this.zone, x, y, 10)) {
      this.steerTouch = t.identifier; this.steerStartX = x; this.steerRaw = 0;
      this._knob(0);
      return;
    }
    const p = this._pedalAt(x, y);
    if (p) this.pedalTouches.set(t.identifier, { pedal: p, value: this._pedalValue(p, y) });
  }
  _touchMove(t) {
    const x = t.clientX, y = t.clientY;
    if (t.identifier === this.steerTouch) {
      const w = this.zone.getBoundingClientRect().width;
      // px of thumb travel for full lock: the same physical travel as before the zone was made
      // 20 % smaller (0.34 x the previous width = 0.425 x the current width)
      const full = w * 0.425 / Math.max(0.3, settings.steerSens);
      const raw = Math.max(-1, Math.min(1, (x - this.steerStartX) / full));
      // a resting thumb jitters by a pixel or two: small rest deadzone, rescaled so the
      // response stays continuous outside it
      const DZ = 0.035;
      this.steerRaw = Math.abs(raw) <= DZ ? 0 : Math.sign(raw) * (Math.abs(raw) - DZ) / (1 - DZ);
      this._knob(raw);
      return;
    }
    const pt = this.pedalTouches.get(t.identifier);
    if (pt) {
      const p = this._pedalAt(x, y);
      if (!p) { pt.pedal = null; pt.value = 0; }
      else { pt.pedal = p; pt.value = this._pedalValue(p, y); }
    }
  }
  _touchEnd(t) {
    if (t.identifier === this.steerTouch) { this.steerTouch = null; this.steerRaw = 0; this._knob(0, true); }
    this.pedalTouches.delete(t.identifier);
  }
  _knob(v, animate = false) {
    const w = this.zone.clientWidth;
    this.knob.style.transition = animate ? 'transform 0.12s ease-out' : 'none';
    this.knob.style.transform = `translateX(${(v * w * 0.42).toFixed(1)}px)`;
  }

  // Release everything (focus loss, pause, restart)
  clear() {
    this.steerTouch = null; this.steerRaw = 0; this.steer = 0;
    this.pedalTouches.clear(); this.throttle = 0; this.brake = 0;
    this.keys.clear();
    this._knob(0, true);
    this._renderPedals();
  }

  update(dt) {
    // keyboard
    const kL = this.keys.has('ArrowLeft') || this.keys.has('KeyA');
    const kR = this.keys.has('ArrowRight') || this.keys.has('KeyD');
    const kUp = this.keys.has('ArrowUp') || this.keys.has('KeyW');
    const kDn = this.keys.has('ArrowDown') || this.keys.has('KeyS');
    let target = this.steerRaw;
    if (this.steerTouch === null && (kL || kR)) target = (kR ? 1 : 0) - (kL ? 1 : 0);
    // touch steering follows the thumb closely; release / keys recentre with a short time constant
    const tc = this.steerTouch !== null ? 0.035 : 0.09;
    // exact first-order response (identical at 30, 60 or 120 frames per second)
    this.steer += (target - this.steer) * (1 - Math.exp(-dt / tc));
    // neutral is exactly zero: no residual steering left over from the exponential return
    if (target === 0 && Math.abs(this.steer) < 0.004) this.steer = 0;
    let th = 0, br = 0;
    for (const v of this.pedalTouches.values()) {
      if (v.pedal === 'throttle') th = Math.max(th, v.value);
      if (v.pedal === 'brake') br = Math.max(br, v.value);
    }
    if (kUp) th = 1;
    if (kDn) br = 1;
    this.throttle = th; this.brake = br;
    this._renderPedals();
  }
  _renderPedals() {
    for (const k of ['brake', 'throttle']) {
      const v = k === 'brake' ? this.brake : this.throttle;
      this.fills[k].style.height = (v * 100).toFixed(0) + '%';
      this.pedalEls[k].classList.toggle('on', v > 0);
    }
  }
}

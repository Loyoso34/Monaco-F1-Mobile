// Synthesised 1.6 L V6 turbo-hybrid (2024 F1 power unit) as heard from the T-cam above the
// airbox. Runs in an AudioWorklet (and, as a fallback, inside a ScriptProcessor). Original
// synthesis — no samples.
//
// Model: 4-stroke V6 = 3 firings per crank revolution (575 Hz at 11,500 rpm). Each of the six
// cylinders fires an asymmetric exhaust pulse; small per-cylinder amplitude/timing differences
// create the half-order "rasp" of a real engine. Load (throttle x torque) sets the pulse
// strength and brightness, so full throttle and coasting at the same rpm sound different.
// The pulse train goes through exhaust/intake formant filters and a soft saturator. On top:
// intake roar at the airbox, turbo/MGU-H whistle, MGU-K whine (deploy/harvest), straight-cut
// gear whine, upshift ignition-cut crack, downshift blips, overrun burble and the limiter.

const Base = typeof AudioWorkletProcessor !== 'undefined' ? AudioWorkletProcessor : class {};

class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }
  set(type, f, q, gainDb, fs) {
    const w = 2 * Math.PI * Math.min(f, fs * 0.45) / fs, cw = Math.cos(w), sw = Math.sin(w);
    const alpha = sw / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
    else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
    else if (type === 'bp') { b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
    else { // peaking
      const A = Math.pow(10, gainDb / 40);
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

export class EngineSynth {
  constructor(fs) {
    this.fs = fs;
    this.p = { rpm: 4300, load: 0, throttle: 0, boost: 0, harvest: 0, deploy: 0, speed: 0, gear: 1, limiter: 0, on: 1 };
    this.rpm = 4300; this.load = 0; this.bright = 0;
    this.cyc = 0;                       // 0..1 over the 4-stroke cycle (720 deg)
    // bank-to-bank and cylinder-to-cylinder differences (exhaust path lengths into the single
    // tailpipe) -> half-order content, the V6 'growl' under the firing tone
    this.cylAmp = [1.0, 0.76, 1.14, 0.84, 1.2, 0.79];
    this.cylOff = [0, 0.011, -0.006, 0.013, -0.004, 0.009];   // firing timing offsets (cycle fraction)
    this.lastFire = new Float32Array(6).fill(-1);
    this.fireAmp = new Float32Array(6);
    this.rnd = 12345;
    // filters
    this.hp = new Biquad(); this.f1 = new Biquad(); this.f2 = new Biquad(); this.f3 = new Biquad(); this.lp = new Biquad(); this.lp2 = new Biquad();
    this.body = new Biquad(); this.raspBP = new Biquad(); this.intakeBP = new Biquad(); this.out2 = new Biquad();
    this.hp.set('hp', 45, 0.7, 0, fs);
    this.f1.set('peak', 640, 1.4, 7, fs);
    this.f2.set('peak', 1480, 2.0, 4.5, fs);
    this.f3.set('peak', 3200, 2.2, 1.5, fs);
    this.body.set('bp', 190, 0.9, 0, fs);
    this.raspBP.set('bp', 2700, 1.1, 0, fs);
    this.intakeBP.set('bp', 900, 0.8, 0, fs);
    this.out2.set('hp', 30, 0.7, 0, fs);
    this.lpF = 0; this.updCount = 0;
    this.tPhase = 0; this.kPhase = 0; this.gPhase = 0;
    this.crack = 0; this.blipEnv = 0; this.popEnv = 0; this.whoosh = 0;
    this.prevThrottle = 0;
  }
  rand() { this.rnd = (this.rnd * 1664525 + 1013904223) >>> 0; return this.rnd / 4294967296; }
  event(e) {
    if (e === 'up') { this.crack = 1; }
    else if (e === 'down') { this.blipEnv = 1; if (this.rand() < 0.7) this.popEnv = 0.8; }
    else if (e === 'lift') { this.whoosh = 1; }
  }
  set(params) { Object.assign(this.p, params); }

  render(out, n) {
    const fs = this.fs, p = this.p;
    const kR = 1 - Math.exp(-1 / (fs * 0.012)), kL = 1 - Math.exp(-1 / (fs * 0.010));
    for (let i = 0; i < n; i++) {
      // parameter smoothing (fast enough for shift snaps, slow enough to avoid zipper noise)
      this.rpm += (p.rpm - this.rpm) * kR;
      let loadT = p.load * (p.limiter > 0 ? (Math.sin(this.cyc * 6.283 * 3) > 0 ? 1 : 0.15) : 1);
      loadT = Math.max(loadT, this.blipEnv * 0.75);
      this.load += (loadT - this.load) * kL;
      if ((this.updCount++ & 31) === 0) {
        const L = this.load;
        // 24 dB/oct roll-off whose corner opens with load: bright and raspy on throttle,
        // darker and softer on the overrun
        this.lpF = 900 + 3800 * L + this.rpm * 0.18;
        this.lp.set('lp', this.lpF, 0.7, 0, fs);
        this.lp2.set('lp', this.lpF * 1.15, 0.6, 0, fs);
        this.intakeBP.set('bp', 600 + this.rpm * 0.11, 0.9, 0, fs);
      }
      const fRev = this.rpm / 60;
      this.cyc += fRev / 2 / fs;
      if (this.cyc >= 1) this.cyc -= 1;
      // six cylinders, even firing every 120 deg crank = 1/6 of the cycle
      let pulse = 0, env = 0;
      const L = this.load;
      const w = 0.42 - 0.12 * L;                        // pulse width (fraction of firing interval)
      for (let c = 0; c < 6; c++) {
        // each cylinder fires ONCE per 720 deg cycle; x = time since its firing in firing intervals
        let pc = this.cyc - (c / 6 + this.cylOff[c]);
        pc -= Math.floor(pc);
        const x = pc * 6;                                  // 0..6
        // new firing: pick its amplitude (load, roughness, overrun misfires/pops)
        if (x < this.lastFire[c]) {
          const a = this.cylAmp[c] * (0.88 + 0.24 * this.rand());
          const over = 1 - L;
          let amp = 0.22 + 0.78 * L;
          if (over > 0.7 && this.rand() < 0.10 * over) amp *= 0.15;               // misfire on overrun
          if (this.popEnv > 0.05 && this.rand() < 0.25) amp *= 1.9;              // pop
          this.fireAmp[c] = a * amp;
        }
        this.lastFire[c] = x;
        if (x >= 1) continue;                              // between this cylinder's firings
        let v;
        if (x < w) { const s = Math.sin(Math.PI * x / w); v = s * Math.sqrt(s); }
        else v = -0.32 * Math.sin(Math.PI * (x - w) / (1 - w));
        pulse += v * this.fireAmp[c];
        if (x < w) env += Math.sin(Math.PI * x / w) * this.fireAmp[c];
      }
      // noise (rasp + intake), modulated by the pulse envelope
      const nz = this.rand() * 2 - 1;
      const rasp = this.raspBP.run(nz) * env * (0.10 + 0.30 * L);
      const intake = this.intakeBP.run(nz * (0.35 + 0.65 * env)) * (0.06 + 0.30 * L);
      let x = this.hp.run(pulse * 1.5);
      x = this.f1.run(x); x = this.f2.run(x); x = this.f3.run(x);
      x = this.lp2.run(this.lp.run(x)) + this.body.run(pulse) * 0.5;
      x += rasp * 0.22 + intake * 0.35;
      // upshift ignition-cut crack and downshift blip pop
      if (this.crack > 0.001) { x += (this.rand() * 2 - 1) * this.crack * 0.55; this.crack *= Math.exp(-1 / (fs * 0.012)); }
      if (this.popEnv > 0.001) { this.popEnv *= Math.exp(-1 / (fs * 0.06)); }
      if (this.blipEnv > 0.001) { this.blipEnv *= Math.exp(-1 / (fs * 0.045)); }
      // soft saturation (grit grows with load)
      const drive = 1.05 + 0.95 * L;
      x = Math.tanh(x * drive) / Math.tanh(drive) * 0.6;
      // turbo / MGU-H whistle
      const ft = (2100 + this.rpm * 0.30) * (0.75 + 0.25 * p.boost);
      this.tPhase += ft / fs; if (this.tPhase > 1) this.tPhase -= 1;
      x += Math.sin(this.tPhase * 6.2832) * (0.004 + 0.012 * p.boost);
      // MGU-K whine (geared to the crank): loud when harvesting under braking
      const fk = this.rpm * 0.205;
      this.kPhase += fk / fs; if (this.kPhase > 1) this.kPhase -= 1;
      const ka = 0.028 * p.harvest + 0.008 * p.deploy;
      x += (Math.sin(this.kPhase * 6.2832) + 0.35 * Math.sin(this.kPhase * 12.566)) * ka;
      // straight-cut gearbox whine, most audible off throttle
      const fg = p.speed * 41;
      this.gPhase += fg / fs; if (this.gPhase > 1) this.gPhase -= 1;
      x += Math.sin(this.gPhase * 6.2832) * 0.007 * (1 - 0.6 * L) * Math.min(1, p.speed / 20);
      // wastegate / blow-off whoosh on lift
      if (this.whoosh > 0.001) { x += this.out2.run(nz) * this.whoosh * 0.12; this.whoosh *= Math.exp(-1 / (fs * 0.18)); }
      out[i] = x * (p.on ?? 1);
    }
  }
}

class EngineProcessor extends Base {
  constructor() {
    super();
    this.synth = new EngineSynth(sampleRate);
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.params) this.synth.set(d.params);
      if (d.event) this.synth.event(d.event);
    };
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const ch0 = out[0];
    this.synth.render(ch0, ch0.length);
    for (let c = 1; c < out.length; c++) out[c].set(ch0);
    return true;
  }
}
if (typeof registerProcessor === 'function') registerProcessor('rb20-engine', EngineProcessor);

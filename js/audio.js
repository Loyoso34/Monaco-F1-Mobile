// Audio: synthesised RB20 power unit (AudioWorklet) + tyres, wind, kerbs, barrier scrape,
// impacts and the Monaco tunnel acoustics. Everything is generated at runtime (no samples).
// Mobile rules: the context is created/resumed on the first tap; every gain change is ramped
// (no clicks); noise loops are long and seamless; a limiter protects phone speakers; the
// context is suspended when the app loses focus and resumed cleanly.
import { EngineSynth } from './engine-worklet.js';
import { settings } from './settings.js';

function noiseBuffer(ctx, seconds = 3, color = 'white') {
  const n = Math.floor(ctx.sampleRate * seconds), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0, b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (color === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else if (color === 'pink') { b0 = 0.997 * b0 + w * 0.029591; b1 = 0.985 * b1 + w * 0.032534; b2 = 0.95 * b2 + w * 0.048056; d[i] = (b0 + b1 + b2 + w * 0.05) * 1.6; }
    else d[i] = w;
  }
  // seamless loop: crossfade the last 50 ms into the start
  const xf = Math.floor(ctx.sampleRate * 0.05);
  for (let i = 0; i < xf; i++) { const t = i / xf; d[i] = d[i] * t + d[n - xf + i] * (1 - t); }
  return b;
}

// Tunnel impulse response: dense early reflections from walls ~5 m away and the roof, then a
// ~1.7 s diffuse tail whose highs die faster than the lows.
function tunnelIR(ctx) {
  const sr = ctx.sampleRate, len = Math.floor(sr * 2.0);
  const b = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const decay = Math.exp(-t / 0.26);
      const w = Math.random() * 2 - 1;
      const cut = 0.55 * Math.exp(-t / 0.5) + 0.06;      // progressively darker tail
      lp += (w - lp) * cut;
      d[i] = lp * decay * 0.55 * Math.min(1, t / 0.008);
    }
    const refl = [[0.009, 0.75], [0.016, 0.6], [0.024, 0.55], [0.031, 0.45], [0.043, 0.38], [0.058, 0.3], [0.071, 0.24], [0.092, 0.18]];
    for (const [t, g] of refl) {
      const k = Math.floor((t + (ch ? 0.0013 : 0)) * sr);
      for (let j = 0; j < 40; j++) d[k + j] += g * (1 - j / 40) * (j % 2 ? -0.6 : 1);
    }
  }
  return b;
}

// One-shot impact buffers
function impactBuffer(ctx, kind) {
  const sr = ctx.sampleRate;
  const dur = kind === 'heavy' ? 1.4 : kind === 'wheel' ? 0.55 : 0.28;
  const n = Math.floor(sr * dur), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
  let lp = 0, ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, w = Math.random() * 2 - 1;
    let v = 0;
    if (kind === 'heavy') {
      const f = 55 + 60 * Math.exp(-t * 10); ph += f / sr;
      v += Math.sin(ph * 6.283) * Math.exp(-t * 4.5) * 0.9;                    // body thump
      lp += (w - lp) * 0.35;
      v += lp * Math.exp(-t * 3.2) * 0.9;                                      // crunch
      v += w * Math.exp(-t * 18) * 0.7;                                        // crack
      // debris rattle: random clicks
      if (Math.random() < 0.004 * Math.exp(-t * 2)) for (let j = 0; j < 60 && i + j < n; j++) d[i + j] += (Math.random() * 2 - 1) * 0.35 * (1 - j / 60);
      v += (Math.sin(t * 6.283 * 410) * 0.2 + Math.sin(t * 6.283 * 1130) * 0.15) * Math.exp(-t * 6);   // metal
    } else if (kind === 'wheel') {
      const f = 85 + 40 * Math.exp(-t * 20); ph += f / sr;
      v += Math.sin(ph * 6.283) * Math.exp(-t * 14) * 0.9;                     // tyre thud
      v += (Math.sin(t * 6.283 * 380) * 0.35 + Math.sin(t * 6.283 * 970) * 0.25 + Math.sin(t * 6.283 * 2350) * 0.15) * Math.exp(-t * 9); // suspension clank
      v += w * Math.exp(-t * 40) * 0.5;
    } else { // carbon crack / brush
      lp += (w - lp) * 0.6;
      v += (w - lp) * Math.exp(-t * 28) * 0.9 + Math.sin(t * 6.283 * 2400) * Math.exp(-t * 45) * 0.3;
    }
    d[i] += v;
  }
  return b;
}

export class AudioSystem {
  constructor() {
    this.ctx = null; this.ready = false; this.engineNode = null; this.started = false;
    this.inTunnel = 0; this.lastThrottle = 0;
  }

  // Must be called from a user gesture (first tap)
  async start() {
    if (this.started) { this.resume(); return; }
    this.started = true;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // reuse the context unlocked by the first tap (main.js), if any
    const ctx = this.ctx = window.__actx || new AC({ latencyHint: 'interactive' });
    window.__actx = ctx;
    // unlock on iOS: a tiny silent buffer inside the gesture
    const sb = ctx.createBufferSource(); sb.buffer = ctx.createBuffer(1, 1, ctx.sampleRate); sb.connect(ctx.destination); sb.start(0);
    if (ctx.state !== 'running') ctx.resume();

    const master = this.master = ctx.createGain(); master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -9; limiter.knee.value = 6; limiter.ratio.value = 8; limiter.attack.value = 0.003; limiter.release.value = 0.18;
    master.connect(limiter); limiter.connect(ctx.destination);
    this.limiter = limiter;
    this.engineBus = ctx.createGain(); this.fxBus = ctx.createGain();
    this.engineBus.connect(master); this.fxBus.connect(master);
    // tunnel reverb send and wall slap-back
    this.conv = ctx.createConvolver(); this.conv.buffer = tunnelIR(ctx);
    this.wet = ctx.createGain(); this.wet.gain.value = 0;
    this.send = ctx.createGain(); this.send.gain.value = 1;
    this.send.connect(this.conv); this.conv.connect(this.wet); this.wet.connect(master);
    this.slap = ctx.createDelay(0.2); this.slap.delayTime.value = 0.022;
    this.slapFb = ctx.createGain(); this.slapFb.gain.value = 0.0;
    this.slapOut = ctx.createGain(); this.slapOut.gain.value = 0;
    this.send.connect(this.slap); this.slap.connect(this.slapFb); this.slapFb.connect(this.slap); this.slap.connect(this.slapOut); this.slapOut.connect(master);

    // engine
    this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0.9;
    this.engineTone = ctx.createBiquadFilter(); this.engineTone.type = 'highshelf'; this.engineTone.frequency.value = 3500; this.engineTone.gain.value = 0;
    this.engineTone.connect(this.engineGain); this.engineGain.connect(this.engineBus); this.engineGain.connect(this.send);
    try {
      await ctx.audioWorklet.addModule(new URL('./engine-worklet.js', import.meta.url));
      this.engineNode = new AudioWorkletNode(ctx, 'rb20-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      this.engineNode.connect(this.engineTone);
      this.post = (m) => this.engineNode.port.postMessage(m);
    } catch (e) {
      // fallback: same synth in a ScriptProcessor
      const synth = new EngineSynth(ctx.sampleRate);
      const sp = ctx.createScriptProcessor(1024, 0, 1);
      sp.onaudioprocess = (ev) => synth.render(ev.outputBuffer.getChannelData(0), ev.outputBuffer.length);
      sp.connect(this.engineTone);
      this.engineNode = sp;
      this.post = (m) => { if (m.params) synth.set(m.params); if (m.event) synth.event(m.event); };
    }

    // noise sources
    const white = noiseBuffer(ctx, 4, 'white'), pink = noiseBuffer(ctx, 4, 'pink'), brown = noiseBuffer(ctx, 4, 'brown');
    const loop = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 3); return s; };
    // tyre scrub (broadband, rises in pitch with load) + lock-up squeal
    this.scrubF = ctx.createBiquadFilter(); this.scrubF.type = 'bandpass'; this.scrubF.frequency.value = 900; this.scrubF.Q.value = 0.9;
    this.scrubG = ctx.createGain(); this.scrubG.gain.value = 0;
    loop(pink).connect(this.scrubF); this.scrubF.connect(this.scrubG); this.scrubG.connect(this.fxBus); this.scrubG.connect(this.send);
    this.squealF = ctx.createBiquadFilter(); this.squealF.type = 'bandpass'; this.squealF.frequency.value = 2100; this.squealF.Q.value = 7;
    this.squealG = ctx.createGain(); this.squealG.gain.value = 0;
    loop(white).connect(this.squealF); this.squealF.connect(this.squealG); this.squealG.connect(this.fxBus);
    // wind
    this.windLP = ctx.createBiquadFilter(); this.windLP.type = 'lowpass'; this.windLP.frequency.value = 400;
    this.windG = ctx.createGain(); this.windG.gain.value = 0;
    this.hissF = ctx.createBiquadFilter(); this.hissF.type = 'bandpass'; this.hissF.frequency.value = 3200; this.hissF.Q.value = 0.6;
    this.hissG = ctx.createGain(); this.hissG.gain.value = 0;
    loop(brown).connect(this.windLP); this.windLP.connect(this.windG); this.windG.connect(this.fxBus);
    loop(white).connect(this.hissF); this.hissF.connect(this.hissG); this.hissG.connect(this.fxBus);
    // kerb rumble: low noise amplitude-modulated at the stripe rate
    this.curbOsc = ctx.createOscillator(); this.curbOsc.type = 'square'; this.curbOsc.frequency.value = 30;
    this.curbAM = ctx.createGain(); this.curbAM.gain.value = 0;
    this.curbLP = ctx.createBiquadFilter(); this.curbLP.type = 'lowpass'; this.curbLP.frequency.value = 420;
    this.curbG = ctx.createGain(); this.curbG.gain.value = 0;
    const curbN = loop(brown);
    curbN.connect(this.curbAM); this.curbOsc.connect(this.curbAM.gain);
    this.curbAM.connect(this.curbLP);
    const curbTone = ctx.createGain(); curbTone.gain.value = 0.5; this.curbOsc.connect(curbTone); curbTone.connect(this.curbLP);
    this.curbLP.connect(this.curbG); this.curbG.connect(this.fxBus); this.curbG.connect(this.send);
    this.curbOsc.start();
    // barrier scrape: gritty band-passed noise with a metallic resonance
    this.scrapeF = ctx.createBiquadFilter(); this.scrapeF.type = 'bandpass'; this.scrapeF.frequency.value = 2600; this.scrapeF.Q.value = 1.4;
    this.scrapeRes = ctx.createBiquadFilter(); this.scrapeRes.type = 'peaking'; this.scrapeRes.frequency.value = 1250; this.scrapeRes.Q.value = 12; this.scrapeRes.gain.value = 12;
    this.scrapeG = ctx.createGain(); this.scrapeG.gain.value = 0;
    loop(white).connect(this.scrapeF); this.scrapeF.connect(this.scrapeRes); this.scrapeRes.connect(this.scrapeG); this.scrapeG.connect(this.fxBus); this.scrapeG.connect(this.send);

    this.impacts = { heavy: impactBuffer(ctx, 'heavy'), wheel: impactBuffer(ctx, 'wheel'), glance: impactBuffer(ctx, 'glance'), scrape: impactBuffer(ctx, 'glance') };
    this.lastImpact = 0;
    this.ready = true;
    this.applyVolumes(true);
  }

  applyVolumes(fadeIn = false) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(settings.master * 0.9, t, fadeIn ? 0.25 : 0.05);
    this.engineBus.gain.setTargetAtTime(settings.engine, t, 0.05);
    this.fxBus.gain.setTargetAtTime(settings.fx, t, 0.05);
  }

  // Fade and suspend (focus loss / pause); resume ramps back up without a jump.
  suspend() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, 0.015);
    clearTimeout(this._susT);
    this._susT = setTimeout(() => { if (this.ctx.state === 'running' && this._wantSuspended) this.ctx.suspend(); }, 120);
    this._wantSuspended = true;
  }
  resume() {
    if (!this.ctx) return;
    this._wantSuspended = false;
    clearTimeout(this._susT);
    const go = () => this.applyVolumes(true);
    if (this.ctx.state !== 'running') this.ctx.resume().then(go, go); else go();
  }
  // Silence the car (menu) but keep the context alive
  setEngineOn(on) { if (this.ready) this.post({ params: { on: on ? 1 : 0 } }); }

  event(e) {
    if (!this.ready) return;
    if (e.type === 'upshift') this.post({ event: 'up' });
    else if (e.type === 'downshift') this.post({ event: 'down' });
    else if (e.type === 'impact') this.impact(e.kind, e.severity, e.energy);
  }
  impact(kind, severity, energy) {
    const ctx = this.ctx, now = ctx.currentTime;
    if (now - this.lastImpact < 0.06 && kind !== 'heavy') return;
    this.lastImpact = now;
    const src = ctx.createBufferSource();
    src.buffer = this.impacts[kind] || this.impacts.glance;
    const g = ctx.createGain();
    const vol = kind === 'heavy' ? 1.0 : kind === 'wheel' ? 0.55 + 0.4 * severity : 0.25 + 0.6 * Math.min(1, energy / 15000);
    g.gain.value = vol;
    src.playbackRate.value = kind === 'heavy' ? 0.9 + 0.2 * Math.random() : 0.85 + 0.4 * Math.random();
    src.connect(g); g.connect(this.fxBus); g.connect(this.send);
    src.start();
  }

  // per-frame update from the simulation
  update(dt, car, track) {
    if (!this.ready || !car) return;
    const ctx = this.ctx, t = ctx.currentTime, tc = 0.03;
    const v = car.speed;
    const thr = car.input.throttle;
    if (this.lastThrottle > 0.7 && thr < 0.2 && car.rpm > 8000) this.post({ event: 'lift' });
    this.lastThrottle = thr;
    this.post({ params: {
      rpm: car.rpm, load: car.load, throttle: thr, boost: car.boost, harvest: car.harvest, deploy: car.deploy,
      speed: v, gear: car.gear, limiter: car.rpm > 12200 ? 1 : 0,
    } });
    // onboard tone: a touch brighter at high load
    this.engineTone.gain.setTargetAtTime(-2 + 4 * car.load, t, 0.05);
    // tyres
    const scrub = Math.min(1, car.scrub * 0.9);
    const lock = Math.max(...car.wheels.map(w => (w.locked || w.spinning) ? 0.4 + 0.6 * w.slipX : 0));
    this.scrubG.gain.setTargetAtTime(Math.pow(scrub, 1.4) * 0.5 * Math.min(1, v / 8), t, tc);
    this.scrubF.frequency.setTargetAtTime(500 + 900 * scrub + v * 6, t, 0.05);
    this.squealG.gain.setTargetAtTime(lock * 0.22 * Math.min(1, v / 10), t, 0.02);
    // wind ~ v^2
    const w = Math.min(1, (v / 85) ** 2);
    this.windG.gain.setTargetAtTime(w * 0.55, t, 0.08);
    this.windLP.frequency.setTargetAtTime(250 + v * 9, t, 0.1);
    this.hissG.gain.setTargetAtTime(w * 0.08, t, 0.08);
    // kerbs: stripes ~1 m apart -> modulation frequency = v / 1 m (speed dependent rumble)
    const curb = Math.max(...car.curb);
    this.curbOsc.frequency.setTargetAtTime(Math.max(8, v / 1.0), t, 0.02);
    this.curbAM.gain.setTargetAtTime(curb > 0 ? 0.6 : 0, t, 0.01);
    this.curbG.gain.setTargetAtTime(curb > 0 ? Math.min(0.9, 0.25 + v / 60) : 0, t, curb > 0 ? 0.008 : 0.04);
    // barrier scrape (continuous contact)
    const sc = car.contact.scrape;
    this.scrapeG.gain.setTargetAtTime(sc * (car.contact.tyre ? 0.25 : 0.7), t, sc > 0.05 ? 0.01 : 0.06);
    this.scrapeF.frequency.setTargetAtTime(1800 + sc * 2400, t, 0.03);
    // tunnel: reflections build quickly at the entrance, decay naturally at the exit
    const inT = track.inTunnel(car.s) ? 1 : 0;
    // wall proximity elsewhere (narrow streets): a hint of slap-back
    const wallGap = Math.max(0, Math.min(T_bar(track, car) - 1.2, 6));
    const street = Math.max(0, 1 - wallGap / 4) * 0.25;
    this.wet.gain.setTargetAtTime(inT ? 0.85 : 0.0, t, inT ? 0.12 : 0.35);
    this.slapOut.gain.setTargetAtTime(inT ? 0.45 : street, t, inT ? 0.08 : 0.25);
    this.slapFb.gain.setTargetAtTime(inT ? 0.38 : 0.1, t, 0.1);
    this.slap.delayTime.setTargetAtTime(inT ? 0.024 : 0.012 + wallGap * 0.004, t, 0.1);
    this.engineGain.gain.setTargetAtTime(inT ? 1.05 : 0.9, t, 0.15);
  }
}
function T_bar(T, car) {
  const l = T.sample(T.barL, car.s) - car.d, r = T.sample(T.barR, car.s) + car.d;
  return Math.min(l, r);
}

// Offline engine-sound check: drives the physics with the autopilot and feeds the same
// EngineSynth used in the AudioWorklet. Writes a WAV and a CSV of per-frame data.
// node tools/audio-render.mjs <out.wav> [startS] [seconds]
import fs from 'fs';
import { buildTrack } from '../js/track-core.js';
import { Vehicle } from '../js/physics.js';
import { buildRacingLine, Autopilot } from '../js/autopilot.js';
import { EngineSynth } from '../js/engine-worklet.js';
const out = process.argv[2] || 'engine.wav';
const startS = process.argv[3] !== undefined ? +process.argv[3] : null;
const secs = +(process.argv[4] || 24);
const T = buildTrack(); const line = buildRacingLine(T);
const car = new Vehicle(T); const ap = new Autopilot(T, line);
if (startS !== null) car.reset(startS, line.d[T.idxOfS(startS)], { speed: 30 });
const fs_ = 48000, H = 240, per = fs_ / H;
const synth = new EngineSynth(fs_);
const buf = new Float32Array(Math.floor(secs * fs_));
const chunk = new Float32Array(per);
const rows = ['t,s,kmh,rpm,gear,load,thr,brk,harvest,tunnel'];
let lastThr = 0;
for (let i = 0; i < secs * H; i++) {
  const inp = ap.update(car, 1 / H);
  car.setInput(inp.steer, inp.throttle, inp.brake);
  car.step(1 / H);
  for (const e of car.events) { if (e.type === 'upshift') synth.event('up'); if (e.type === 'downshift') synth.event('down'); }
  car.events.length = 0;
  if (lastThr > 0.7 && inp.throttle < 0.2 && car.rpm > 8000) synth.event('lift');
  lastThr = inp.throttle;
  synth.set({ rpm: car.rpm, load: car.load, throttle: inp.throttle, boost: car.boost, harvest: car.harvest, deploy: car.deploy, speed: car.speed, gear: car.gear, limiter: car.rpm > 12200 ? 1 : 0 });
  synth.render(chunk, per);
  buf.set(chunk, i * per);
  if (i % 24 === 0) rows.push([(i / H).toFixed(2), car.s.toFixed(0), (car.speed * 3.6).toFixed(0), car.rpm.toFixed(0), car.gear, car.load.toFixed(2), inp.throttle.toFixed(2), inp.brake.toFixed(2), car.harvest.toFixed(2), T.inTunnel(car.s) ? 1 : 0].join(','));
}
// stats
let peak = 0, maxJump = 0, nan = 0, sum = 0;
for (let i = 0; i < buf.length; i++) { const v = buf[i]; if (!isFinite(v)) { nan++; buf[i] = 0; continue; } peak = Math.max(peak, Math.abs(v)); sum += v * v; if (i) maxJump = Math.max(maxJump, Math.abs(v - buf[i - 1])); }
console.log(`peak ${peak.toFixed(3)}  rms ${Math.sqrt(sum / buf.length).toFixed(3)}  max sample jump ${maxJump.toFixed(3)}  NaN ${nan}`);
// WAV 16-bit mono
const n = buf.length, b = Buffer.alloc(44 + n * 2);
b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
b.writeUInt32LE(fs_, 24); b.writeUInt32LE(fs_ * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(buf[i] / Math.max(1, peak) * 32000))), 44 + i * 2);
fs.writeFileSync(out, b);
fs.writeFileSync(out.replace(/\.wav$/, '.csv'), rows.join('\n'));

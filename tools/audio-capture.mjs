// Records the real Web Audio mix (and the tunnel reverb return) in Chromium while the
// autopilot drives a stretch of the lap. node tools/audio-capture.mjs <out-prefix> [startS] [seconds]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
const prefix = process.argv[2], startS = +(process.argv[3] || 1480), secs = +(process.argv[4] || 20);
const srv = spawn(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), 'serve.mjs'), '8770'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 400));
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await b.newPage({ viewport: { width: 956, height: 440 } });
page.on('pageerror', e => console.log('err', e.message));
await page.goto('http://localhost:8770/?start=drive&autopilot=1&q=low&norender=1');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await page.evaluate(async (startS) => {
  const a = window.__app;
  await a.audio.start();
  a.audio.setEngineOn(true);
  const ctx = a.audio.ctx;
  const T = a.track, line = a.auto.line;
  a.veh.reset(startS, line.d[T.idxOfS(startS)], { speed: 25 });
  a.timing.teleport(a.veh.s);
  window.__rec = { mix: [], wet: [], s: [], t0: ctx.currentTime };
  const tap = (node, key) => {
    const sp = ctx.createScriptProcessor(4096, 1, 1);
    node.connect(sp);
    const sink = ctx.createGain(); sink.gain.value = 0; sp.connect(sink); sink.connect(ctx.destination);
    sp.onaudioprocess = (e) => { window.__rec[key].push(...e.inputBuffer.getChannelData(0)); if (key === 'mix') window.__rec.s.push([ctx.currentTime, a.veh.s, T.inTunnel(a.veh.s) ? 1 : 0]); };
  };
  tap(a.audio.limiter, 'mix'); tap(a.audio.wet, 'wet');
}, startS);
await page.waitForTimeout(secs * 1000);
const rec = await page.evaluate(() => ({ sr: window.__app.audio.ctx.sampleRate, mix: Array.from(window.__rec.mix), wet: Array.from(window.__rec.wet), s: window.__rec.s }));
const wav = (data, file) => {
  const n = data.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rec.sr, 24); buf.writeUInt32LE(rec.sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(data[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, buf);
};
wav(rec.mix, prefix + '_mix.wav'); wav(rec.wet, prefix + '_wet.wav');
fs.writeFileSync(prefix + '_track.json', JSON.stringify(rec.s));
console.log('recorded', (rec.mix.length / rec.sr).toFixed(1), 's at', rec.sr);
await b.close(); srv.kill();

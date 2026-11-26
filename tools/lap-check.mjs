// Lap check: the test driver drives the car round Monaco at racing speed; at 12 points of the
// lap (sun, shade, tunnel) the T-cam, chase and cockpit views are captured. Writes a contact
// sheet (lap-check.png) with the halo and both mirrors as the driver sees them (cockpit) and the
// car (chase) for each point, and checks that both mirrors show a varied live scene from the
// driver's eye that changes round the lap.
//   node tools/lap-check.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
const out = process.argv[2] || '.';
fs.mkdirSync(out, { recursive: true });
const PORT = +(process.env.PORT || 8775);
const srv = spawn(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 400));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 956, height: 440 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: devices['iPhone 15 Pro Max'].userAgent });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/?start=drive&noaudio=1&q=high`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });

const N = 12;
const shots = [];
for (let k = 0; k < N; k++) {
  const info = await page.evaluate(async ({ k, N }) => {
    const a = window.__app, T = a.track;
    // a point of the lap at racing speed (from the racing line's speed profile)
    const s = T.wrapS(T.spawnS + 40 + (T.L - 120) * k / N);
    const rl = a.auto.line || a.auto.rl || null;
    const vmax = rl && rl.vmax ? rl.vmax[T.idxOfS(s)] : 40;
    a.__autoOverride = true; a.controls.enabled = false;
    a.veh.reset(s, rl && rl.d ? rl.d[T.idxOfS(s)] : 0, { speed: Math.min(80, vmax * 0.95) }); a.timing.teleport(a.veh.s);
    await new Promise(r => setTimeout(r, 1200));         // drive on for a moment (mirrors, exposure, suspension)
    return { s: Math.round(a.veh.s), kmh: Math.round(a.veh.speed * 3.6), daylight: +a.daylight.toFixed(2) };
  }, { k, N });
  const frames = {};
  for (const cam of ['tcam', 'chase', 'cockpit']) {          // cockpit last: mirror stats = driver's view
    await page.evaluate((cam) => { window.__app.rig.setMode(cam); }, cam);
    await page.waitForTimeout(700);
    const f = path.join(out, `lap_${String(k).padStart(2, '0')}_${cam}.png`);
    await page.screenshot({ path: f });
    frames[cam] = f;
  }
  // mirror images and material separation in this light
  const m = await page.evaluate(() => {
    const a = window.__app, THREE = a.THREE, r = a.renderer;
    const mir = a.mirrors.list.map((mm) => {
      const { width: w, height: h } = mm.rt, buf = mm.rt.texture.type === THREE.HalfFloatType ? new Uint16Array(w * h * 4) : new Uint8Array(w * h * 4);
      r.readRenderTargetPixels(mm.rt, 0, 0, w, h, buf);
      const f = (i) => buf instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat(buf[i]) : buf[i] / 255;
      let s1 = 0, s2 = 0; const n = w * h; const cols = new Set();
      for (let i = 0; i < n; i++) { const l = 0.2126 * f(i * 4) + 0.7152 * f(i * 4 + 1) + 0.0722 * f(i * 4 + 2); s1 += l; s2 += l * l; if (i % 13 === 0) cols.add(Math.min(15, Math.floor(l * 24))); }
      const mean = s1 / n;
      return { mean: +mean.toFixed(3), sd: +Math.sqrt(Math.max(0, s2 / n - mean * mean)).toFixed(3), levels: cols.size };
    });
    return { mirrors: mir, renders: a.mirrors.stats.renders };
  });
  shots.push({ k, ...info, frames, ...m });
}
// contact sheet: rows = lap points, columns = cockpit halo crop | T-cam mirrors | chase car
const sheet = await page.evaluate(async (shots) => {
  const load = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = src; });
  const cw = 320, ch = 120, rows = shots.length;
  const cv = document.createElement('canvas'); cv.width = cw * 3 + 8 + 210; cv.height = rows * (ch + 4); const c = cv.getContext('2d');
  c.fillStyle = '#111'; c.fillRect(0, 0, cv.width, cv.height);
  for (let i = 0; i < rows; i++) {
    const y = i * (ch + 4);
    const [ck, tc, cs] = await Promise.all([load(shots[i].data.cockpit), load(shots[i].data.tcam), load(shots[i].data.chase)]);
    c.drawImage(ck, 160, 60, 636, 240, 0, y, cw, ch);               // halo cross-bar + pillar
    c.drawImage(ck, 50, 178, 200, 100, cw + 4, y, 156, ch * 0.75);  // left mirror (driver's eye)
    c.drawImage(ck, 706, 178, 200, 100, cw + 164, y, 156, ch * 0.75); // right mirror
    c.drawImage(cs, 200, 120, 556, 260, cw * 2 + 8, y, cw, ch);     // chase: the car
    c.drawImage(tc, 230, 230, 496, 210, cw * 3 + 12, y, 200, ch * 0.85); // T-cam
    c.fillStyle = '#ffd400'; c.font = '11px sans-serif'; c.fillText(`${shots[i].s} m  ${shots[i].kmh} km/h  daylight ${shots[i].daylight}`, 4, y + 12);
  }
  return cv.toDataURL('image/png');
}, shots.map(s => ({ ...s, data: Object.fromEntries(Object.entries(s.frames).map(([k, f]) => [k, 'data:image/png;base64,' + fs.readFileSync(f).toString('base64')])) })));
fs.writeFileSync(path.join(out, 'lap-check.png'), Buffer.from(sheet.split(',')[1], 'base64'));
let fail = 0;
const seen = new Set();
for (const s of shots) {
  const ok = s.mirrors.length === 2 && s.mirrors.every(m => m.sd > 0.01 && m.levels >= 4);
  if (!ok) fail++;
  seen.add(s.mirrors.map(m => m.mean).join('/'));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(s.s).padStart(4)} m ${String(s.kmh).padStart(3)} km/h daylight ${s.daylight.toFixed(2)}  mirrors L mean ${s.mirrors[0].mean} sd ${s.mirrors[0].sd} (${s.mirrors[0].levels} levels)  R mean ${s.mirrors[1].mean} sd ${s.mirrors[1].sd} (${s.mirrors[1].levels} levels)`);
}
if (seen.size < N * 0.8) { console.log('FAIL  mirror images do not change round the lap'); fail++; }
if (errors.length) { console.log('page errors:', errors.slice(0, 3).join(' | ')); fail++; }
console.log(`contact sheet: ${path.join(out, 'lap-check.png')}`);
await browser.close(); srv.kill();
process.exit(fail ? 1 : 0);

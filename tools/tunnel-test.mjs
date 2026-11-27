// Tunnel lighting transition test: the autopilot drives through the tunnel; every frame the
// daylight factor, exposure and light intensities are recorded (no rendering, real-time sim),
// then a rendered run captures frames at the entrance, inside and at the exit.
//   node tools/tunnel-test.mjs <outdir> [cam=tcam]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const out = process.argv[2] || '.';
const cam = process.argv[3] || 'tcam';
fs.mkdirSync(out, { recursive: true });
const PORT = +(process.env.PORT || 8773);
const srv = spawn(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 400));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

// start on the racing line just before Portier at the line's own speed, so the car
// accelerates out of Portier into the tunnel as in a real lap
const drive = async (page) => page.evaluate(([cam]) => {
  const a = window.__app, T = a.track;
  const s0 = T.wrapS(T.corners.find(c => c.id === 'portier').s - 25), k = T.idxOfS(s0);
  a.veh.reset(s0, a.auto.line.d[k], { speed: a.auto.line.vmax[k] * 0.95 });
  a.timing.teleport(a.veh.s);
  a.rig.setMode(cam); a.rig.chaseInit = false;
  a.__autoOverride = true; a.controls.enabled = false;
  a.lightS = null;
}, [cam]);

// 1) time series (no rendering)
let series;
{
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await page.goto(`http://localhost:${PORT}/?start=drive&noaudio=1&norender=1&q=high`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  await drive(page);
  series = await page.evaluate(() => new Promise((resolve) => {
    const a = window.__app, T = a.track, rows = [];
    const t1 = T.tunnelS[1];
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      rows.push({ t: now, s: a.veh.s, into: T.deltaS(T.tunnelS[0], a.veh.s), toExit: T.deltaS(a.veh.s, t1), v: a.veh.speed, daylight: a.daylight, exposure: a.renderer.toneMappingExposure, sun: a.M.lighting.CAR_SUN.value, hemi: a.hemi.intensity, env: a.scene.environmentIntensity });
      last = now;
      if (T.deltaS(t1, a.veh.s) > 140 || rows.length > 6000) resolve(rows); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  await page.close();
}
const t0 = series[0].t;
let maxStep = 0, maxRate = 0, nan = 0;
for (let i = 1; i < series.length; i++) {
  const dt = (series[i].t - series[i - 1].t) / 1000;
  const de = Math.abs(series[i].exposure - series[i - 1].exposure);
  if (!isFinite(series[i].exposure)) nan++;
  maxStep = Math.max(maxStep, de);
  if (dt > 0.004) maxRate = Math.max(maxRate, de / dt);
}
const inside = series.filter(r => r.into > 40 && r.toExit > 40);
const exitRows = series.filter(r => r.toExit < 0);
const tExit = exitRows.length ? exitRows[0].t : null;
const settle = exitRows.find(r => Math.abs(r.exposure - 1) < 0.02);
const entryRows = series.filter(r => r.into >= 0 && r.into < 120);
const tEntry = entryRows.length ? entryRows[0].t : null;
const insideMean = inside.length ? inside.reduce((a, r) => a + r.exposure, 0) / inside.length : 1;
const adapted = series.find(r => r.into > 0 && r.toExit > 0 && r.exposure >= 1 + 0.95 * (insideMean - 1));   // 95 % adapted
const summary = {
  frames: series.length,
  durationS: +((series[series.length - 1].t - t0) / 1000).toFixed(2),
  exposureOutside: +series[0].exposure.toFixed(3),
  exposureInsideMean: inside.length ? +(inside.reduce((a, r) => a + r.exposure, 0) / inside.length).toFixed(3) : null,
  daylightInsideMax: inside.length ? +Math.max(...inside.map(r => r.daylight)).toFixed(3) : null,
  carSunInsideMax: inside.length ? +Math.max(...inside.map(r => r.sun)).toFixed(3) : null,   // sunlight on the car (1 = full)
  maxExposureStepPerFrame: +maxStep.toFixed(4),
  maxExposureRatePerS: +maxRate.toFixed(3),
  entryAdaptationS: adapted && tEntry ? +((adapted.t - tEntry) / 1000).toFixed(2) : null,
  exitPeakExposure: exitRows.length ? +Math.max(...exitRows.map(r => r.exposure)).toFixed(3) : null,
  exitSettleS: settle && tExit ? +((settle.t - tExit) / 1000).toFixed(2) : null,
  nonFinite: nan,
};
fs.writeFileSync(path.join(out, 'tunnel-series.json'), JSON.stringify({ summary, series: series.map(r => ({ ...r, t: +((r.t - t0) / 1000).toFixed(3) })) }));
console.log(JSON.stringify(summary, null, 1));

// 2) rendered frames through the transitions
{
  const ctx = await browser.newContext({ viewport: { width: 956, height: 440 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: devices['iPhone 15 Pro Max'].userAgent });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/?start=drive&noaudio=1&q=high`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  await drive(page);
  const marks = [['entry-30m-before', -30], ['entry-portal', -4], ['entry-15m-in', 15], ['entry-60m-in', 60], ['inside-mid', 220], ['exit-20m-before', 'x-20'], ['exit-portal', 'x4'], ['exit-30m-after', 'x30'], ['exit-90m-after', 'x90']];
  for (const [name, at] of marks) {
    await page.waitForFunction(([at]) => {
      const a = window.__app, T = a.track;
      if (typeof at === 'number') return T.deltaS(T.tunnelS[0], a.veh.s) >= at;
      return T.deltaS(T.tunnelS[1], a.veh.s) >= +at.slice(1);
    }, [at], { timeout: 240000, polling: 'raf' });
    const info = await page.evaluate(() => ({ e: window.__app.renderer.toneMappingExposure.toFixed(2), d: window.__app.daylight.toFixed(2) }));
    await page.screenshot({ path: path.join(out, `tunnel_${cam}_${name}.png`) });
    console.log(`${name}: exposure ${info.e} daylight ${info.d}`);
  }
}
await browser.close(); srv.kill();

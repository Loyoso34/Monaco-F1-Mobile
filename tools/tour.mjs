// Captures the default T-cam (or another camera) at points around the lap.
// node tools/tour.mjs <outdir> [cam] [list of s values or corner ids]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
import { spawn } from 'child_process';
import path from 'path';
const out = process.argv[2] || '.';
const cam = process.argv[3] || 'tcam';
const stops = (process.argv[4] || 'grid,ste-devote,beau-rivage,massenet,casino,mirabeau,hairpin,portier,tunnel,chicane,tabac,pool1,pool2,rascasse,noghes').split(',');
const W = +(process.env.W || 956), H = +(process.env.H || 440);
const srv = spawn(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), 'serve.mjs'), '8767'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 400));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: devices['iPhone 15 Pro Max'].userAgent });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', e => logs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
await page.goto(`http://localhost:8767/?start=drive&cam=${cam}&noaudio=1${process.env.Q ? '&q=' + process.env.Q : ''}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
for (const st of stops) {
  await page.evaluate(([st]) => {
    const a = window.__app, T = a.track;
    let s;
    if (st === 'grid') s = T.spawnS; else if (/^[0-9.]+$/.test(st)) s = +st; else { const c = T.corners.find(c => c.id === st); s = T.wrapS(c.s - (st === 'tunnel' ? 0 : 45)); }
    const line = a.auto.line;
    a.veh.reset(s, line.d[T.idxOfS(s)] * 0.7, { speed: Math.min(60, line.vmax[T.idxOfS(s)] * 0.9) });
    a.timing.teleport(a.veh.s);
    a.__autoOverride = true;
  }, [st]);
  // let the autopilot drive a moment so the attitude settles
  await page.evaluate(() => { const a = window.__app; a.controls.enabled = false; });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, `tour_${cam}_${st}.png`) });
}
console.log(logs.slice(0, 20).join('\n'));
await browser.close(); srv.kill();

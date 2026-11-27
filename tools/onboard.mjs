// Onboard capture at racing speed: the test driver laps Monaco and the game is captured from
// the player's camera on the approach to each corner (phone-size landscape viewport, the normal
// entry point with ?start=drive). Two frames per stop, a fraction of a second apart, show what
// moves, shimmers or pops in motion.
//   node tools/onboard.mjs <outdir> [cam=cockpit] [stops] [W] [H]
//   stops: comma list of corner ids with an offset (id-60) or plain lap metres; default = lap
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const out = process.argv[2] || '.';
const cam = process.argv[3] || 'cockpit';
const DEFAULT = 'ste-devote-130,beau-rivage-90,massenet-90,casino-70,mirabeau-95,hairpin-70,portier-60,tunnel+150,tunnelEnd-25,chicane-120,tabac-75,pool1-70,pool2-55,rascasse-60,noghes-50';
const stops = (process.argv[4] || DEFAULT).split(',');
const W = +(process.argv[5] || process.env.W || 956), H = +(process.argv[6] || process.env.H || 440);
const PORT = +(process.env.PORT || 8773);
const DPR = +(process.env.DPR || 1);
fs.mkdirSync(out, { recursive: true });
const srv = spawn(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 400));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true, userAgent: devices['iPhone 15 Pro Max'].userAgent });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', e => logs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
await page.goto(`http://localhost:${PORT}/?start=drive&cam=${cam}&noaudio=1${process.env.Q ? '&q=' + process.env.Q : ''}${process.env.EXTRA ? '&' + process.env.EXTRA : ''}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
const info = [];
for (const st of stops) {
  const r = await page.evaluate(async ([st]) => {
    const a = window.__app, T = a.track, line = a.auto.line;
    const m = st.match(/^([a-z0-9-]+?|tunnel|tunnelEnd)([+-][0-9.]+)?$/i);
    let s;
    if (/^[0-9.]+$/.test(st)) s = +st;
    else {
      const id = m[1], off = +(m[2] || 0);
      const base = id === 'tunnel' ? T.tunnelS[0] : id === 'tunnelEnd' ? T.tunnelS[1] : id === 'grid' ? T.spawnS : T.corners.find(c => c.id === id).s;
      s = T.wrapS(base + off);
    }
    // start ~1.3 s earlier on the racing line at the line's speed, then let the driver run on
    const v = line.vmax[T.idxOfS(s)] * 0.95;
    const s0 = T.wrapS(s - v * 1.3);
    a.veh.reset(s0, line.d[T.idxOfS(s0)], { speed: line.vmax[T.idxOfS(s0)] * 0.95 });
    a.timing.teleport(a.veh.s);
    a.__autoOverride = true; a.controls.enabled = false;
    a.lightS = null;
    const t0 = a.simTime;
    await new Promise((res) => { const f = () => { if (a.simTime - t0 >= 1.3) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
    return { s: Math.round(a.veh.s), kmh: Math.round(a.veh.speed * 3.6) };
  }, [st]);
  const name = st.replace(/[^a-z0-9+-]/gi, '_');
  await page.screenshot({ path: path.join(out, `${cam}_${name}_a.png`) });
  // second frame ~0.25 s of game time later
  await page.evaluate(async () => { const a = window.__app, t0 = a.simTime; await new Promise((res) => { const f = () => { if (a.simTime - t0 >= 0.25) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }); });
  await page.screenshot({ path: path.join(out, `${cam}_${name}_b.png`) });
  info.push({ st, ...r });
  process.stdout.write(`${st} ${r.kmh}km/h  `);
}
fs.writeFileSync(path.join(out, `${cam}_stops.json`), JSON.stringify(info, null, 1));
console.log('\n' + logs.slice(0, 20).join('\n'));
await browser.close(); srv.kill();

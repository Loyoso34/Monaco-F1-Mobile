// Reference-matched side view of the car (tools/carview.html, perspective camera) for comparing
// against a real photograph cropped and scaled the same way.
//
//   node tools/refmatch.mjs <out.png> [key=value ...]
//
// Defaults reproduce the 2024 RB20 side-profile comparison: 1320 x 964 px, car facing left
// (camera on the car's left), the stations 0.5 / 1.0 / 1.5 m behind the front axle at
// x = 95 / 512 / 928 px (833 px per metre at the target plane). Keys: el (deg), D (m), ty, x0
// (target plane x, 0 = centre line), az, W, H, ppm, fa0 (station at px0), px0, guides=1 draws
// the cyan station lines, env, extra (raw query string for carview).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
import { spawn } from 'child_process';
import path from 'path';

const out = process.argv[2] || 'ref.png';
const kv = Object.fromEntries(process.argv.slice(3).map(a => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const W = +(kv.W || 1320), H = +(kv.H || 964);
const ppm = +(kv.ppm || 833), fa0 = +(kv.fa0 || 0.5), px0 = +(kv.px0 || 95);
const el = +(kv.el ?? 9), D = +(kv.D || 40), az = +(kv.az ?? 0);
const ty = +(kv.ty ?? 0.50);
// frame width at the target and the station at the frame centre
const w = W / ppm;
const faC = fa0 + (W / 2 - px0) / ppm;
const PORT = +(process.env.PORT || 8766);
const srv = spawn(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), 'serve.mjs'), String(PORT)], { stdio: 'ignore', cwd: process.env.ROOT || undefined });
await new Promise(r => setTimeout(r, 400));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', e => logs.push('pageerror: ' + e.message));
const q = new URLSearchParams({ view: 'persp', az: String(az), el: String(el), D: String(D), w: String(w), ty: String(ty), tx: String(kv.x0 || 0), grid: '0', ...(kv.env ? { env: kv.env } : {}) });
const extra = kv.extra ? '&' + kv.extra : '';
await page.goto(`http://localhost:${PORT}/tools/carview.html?${q}&tzFA=${faC}${extra}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
if (kv.guides === '1') {
  await page.evaluate(([ppm, fa0, px0]) => {
    for (const f of [0.5, 1.0, 1.5]) {
      const d = document.createElement('div');
      d.style.cssText = `position:fixed;top:0;bottom:0;width:2px;background:#22d3e0;left:${px0 + (f - fa0) * ppm - 1}px`;
      document.body.appendChild(d);
    }
  }, [ppm, fa0, px0]);
}
await page.screenshot({ path: out });
if (logs.length) console.log(logs.join('\n'));
await browser.close(); srv.kill();

// Renders validation screenshots: node tools/shots.mjs <outdir> view[,view...] [w] [h] [query]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
import { spawn } from 'child_process';
import path from 'path';
const out = process.argv[2] || '.';
const views = (process.argv[3] || 'side,front,top,rear34,tcam').split(',');
const W = +(process.argv[4] || 1280), H = +(process.argv[5] || 720);
const extra = process.argv[6] || '';
const srv = spawn(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), 'serve.mjs'), '8765'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 400));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', m => logs.push(m.type() + ': ' + m.text()));
page.on('pageerror', e => logs.push('pageerror: ' + e.message));
for (const v of views) {
  await page.goto(`http://localhost:8765/tools/carview.html?view=${v}${extra ? '&' + extra : ''}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 }).catch(() => {});
  await page.screenshot({ path: path.join(out, `car_${v}${extra ? '_' + extra.replace(/[^a-z0-9]+/gi, '_') : ''}.png`) });
}
if (logs.length) console.log(logs.join('\n'));
await browser.close(); srv.kill();

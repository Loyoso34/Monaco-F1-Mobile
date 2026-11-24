// Smoke test in emulated phones: loads the game, captures the menu and the default T-cam view,
// reports console errors. node tools/smoke.mjs <outdir> [query] [device]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
import { spawn } from 'child_process';
import path from 'path';
const out = process.argv[2] || '.';
const query = process.argv[3] || '';
const devName = process.argv[4] || 'iphone';
const base = process.env.BASE_URL || null;
let srv = null;
if (!base) { srv = spawn(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), 'serve.mjs'), '8766'], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 400)); }
const url = (base || 'http://localhost:8766/') + (query ? '?' + query : '');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const dev = devName === 'android'
  ? { viewport: { width: 915, height: 412 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: devices['Pixel 7'].userAgent }
  : { viewport: { width: 956, height: 440 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: devices['iPhone 15 Pro Max'].userAgent };
const ctx = await browser.newContext(dev);
const page = await ctx.newPage();
const logs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', e => logs.push('pageerror: ' + e.message));
page.on('requestfailed', r => logs.push('requestfailed: ' + r.url()));
page.on('response', r => { if (r.status() >= 400) logs.push('HTTP ' + r.status() + ' ' + r.url()); });
const t0 = Date.now();
await page.goto(url);
await page.screenshot({ path: path.join(out, 'g_loading.png') });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }).catch(e => logs.push('timeout waiting for ready'));
console.log('ready after', ((Date.now() - t0) / 1000).toFixed(1), 's');
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(out, 'g_menu.png') });
if (!query.includes('start=')) {
  await page.tap('#btnDrive').catch(e => logs.push('tap drive failed ' + e.message));
}
await page.waitForTimeout(3000);
await page.screenshot({ path: path.join(out, 'g_drive.png') });
const info = await page.evaluate(() => { const a = window.__app; if (!a) return null; return { state: a.state, calls: a.renderer.info.render.calls, tris: a.renderer.info.render.triangles, geoms: a.renderer.info.memory.geometries, tex: a.renderer.info.memory.textures, s: a.veh.s, speed: a.veh.speed, audio: a.audio.ready, ctx: a.audio.ctx && a.audio.ctx.state, pr: a.renderer.getPixelRatio() }; });
console.log(JSON.stringify(info));
console.log(logs.slice(0, 30).join('\n'));
await browser.close(); if (srv) srv.kill();

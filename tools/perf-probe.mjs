// Performance probe (emulated): simulation CPU cost per frame, draw calls / triangles around the
// lap, and memory stability over consecutive autopilot laps including a crash + restart.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
import { spawn } from 'child_process';
import path from 'path';
const srv = spawn(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), 'serve.mjs'), '8772'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 400));
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 956, height: 440 }, isMobile: true, hasTouch: true, userAgent: devices['iPhone 15 Pro Max'].userAgent });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('err', e.message));
// 1) draw calls & triangles at points around the lap (rendered, high quality)
await page.goto('http://localhost:8772/?start=drive&noaudio=1&q=high');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const pts = ['spawn', 'ste-devote', 'casino', 'hairpin', 'portier', 'tunnel', 'chicane', 'tabac', 'pool1', 'rascasse'];
const rows = [];
for (const id of pts) {
  const r = await page.evaluate(async (id) => {
    const a = window.__app, T = a.track;
    const s = id === 'spawn' ? T.spawnS : T.wrapS(T.corners.find(c => c.id === id).s - 30);
    a.veh.reset(s, 0, { speed: 30 }); a.timing.teleport(a.veh.s);
    await new Promise(r => setTimeout(r, 400));
    const i = a.renderer.info.render;
    const calls = i.calls, tris = i.triangles;
    // mean frame interval over ~1.5 s (software GL here: only meaningful relative to other builds)
    const t0 = performance.now(); let n = 0;
    await new Promise((res) => { const f = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    return { id, calls, tris, frameMs: (performance.now() - t0) / n };
  }, id);
  rows.push(r);
}
console.log('draw calls / triangles per frame (T-cam, high quality):');
for (const r of rows) console.log(`  ${r.id.padEnd(11)} ${String(r.calls).padStart(4)} calls  ${String(r.tris).padStart(7)} tris  ${r.frameMs.toFixed(1).padStart(6)} ms/frame (software GL)`);
if (process.env.PERF_QUICK) { await b.close(); srv.kill(); process.exit(0); }
// 2) simulation CPU per frame and memory over laps (no rendering so the sim runs in real time)
await page.goto('http://localhost:8772/?start=drive&noaudio=1&q=high&autopilot=1&norender=1');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const mem0 = await page.evaluate(() => ({ g: window.__app.renderer.info.memory.geometries, t: window.__app.renderer.info.memory.textures, heap: performance.memory ? performance.memory.usedJSHeapSize : 0 }));
await page.waitForFunction(() => window.__app.timing.lapNo >= 3, null, { timeout: 400000 });
// crash + restart, then one more lap
await page.evaluate(() => { const a = window.__app, T = a.track, k = T.idxOfS(600); a.veh.reset(600, -4, { speed: 0 }); a.veh.psi = Math.atan2(-T.nx[k], -T.nz[k]); a.veh.vx = T.nx[k] * 30; a.veh.vz = T.nz[k] * 30; });
await page.waitForFunction(() => window.__app.state === 'crashed', null, { timeout: 60000 });
await page.evaluate(() => document.getElementById('btnCrashRestart').click());
await page.waitForFunction(() => window.__app.timing.lapNo >= 2, null, { timeout: 400000 });
const res = await page.evaluate(() => ({ st: window.__app.stats, laps: window.__app.timing.lapNo, best: window.__app.timing.best, g: window.__app.renderer.info.memory.geometries, t: window.__app.renderer.info.memory.textures, heap: performance.memory ? performance.memory.usedJSHeapSize : 0, debris: window.__app.fx.debris.length }));
console.log(`simulation + game logic per frame: avg ${res.st.simMs.toFixed(2)} ms, peak ~${res.st.maxSimMs.toFixed(1)} ms (container CPU, 240 Hz physics)`);
console.log(`memory: geometries ${mem0.g} -> ${res.g}, textures ${mem0.t} -> ${res.t}, JS heap ${(mem0.heap / 1e6).toFixed(0)} -> ${(res.heap / 1e6).toFixed(0)} MB after 3 laps + crash + restart + 1 lap; debris live ${res.debris}`);
await b.close(); srv.kill();

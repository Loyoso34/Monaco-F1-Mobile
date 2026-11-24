// Automated acceptance tests in an emulated phone (Chromium + touch emulation).
// node tools/gameplay-test.mjs <outdir> [iphone|android]
// Checks: cold launch, two-thumb touch input (incl. throttle->brake slide), automatic shifts,
// focus loss / resume, lap timing + saved best across a reload, corner-cut detection,
// reverse crossings, Reset Car, Quick Restart, hairpin full lock, tunnel pull, downshifts into
// the Nouvelle Chicane, a glancing barrier scrape and a heavy frontal impact.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
import { spawn } from 'child_process';
import path from 'path';
const out = process.argv[2] || '.';
const devName = process.argv[3] || 'iphone';
const base = process.env.BASE_URL || null;
let srv = null;
if (!base) { srv = spawn(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), 'serve.mjs'), '8771'], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 400)); }
const root = base || 'http://localhost:8771/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const dev = devName === 'android'
  ? { viewport: { width: 915, height: 412 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: devices['Pixel 7'].userAgent }
  : { viewport: { width: 956, height: 440 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: devices['iPhone 15 Pro Max'].userAgent };
const ctx = await browser.newContext(dev);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const cdp = await ctx.newCDPSession(page);
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(p => ({ x: p.x, y: p.y, id: p.id, radiusX: 8, radiusY: 8, force: 1 })) });

// ---- cold launch -------------------------------------------------------------------------------
const t0 = Date.now();
await page.goto(root + '?norender=1&noaudio=1');
const loadingVisible = await page.isVisible('#loading');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
check('Cold launch: loading screen then menu', loadingVisible && await page.isVisible('#menu.on'), `ready in ${((Date.now() - t0) / 1000).toFixed(1)} s (emulated, software GL)`);
check('Menu has large Drive and Settings buttons', await page.isVisible('#btnDrive') && await page.isVisible('#btnSettings'));
await ev(() => localStorage.removeItem('monacoTT.best.v1'));
await page.tap('#btnDrive');
await wait(500);
check('Default camera is the T-cam', (await ev(() => window.__app.rig.mode)) === 'tcam');
check('Car spawns before the start/finish line, timing not started', await ev(() => { const a = window.__app; return a.veh.s > a.track.L - 80 && a.timing.state === 'out'; }));

// ---- touch controls ------------------------------------------------------------------------------
const rect = async (sel) => page.$eval(sel, e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const sz = await rect('#steerZone'), th = await rect('#throttle'), br = await rect('#brake');
const vp = page.viewportSize();
check('Touch targets kept away from the screen edges', sz.x >= 18 && th.x + th.w <= vp.width - 18 && sz.y + sz.h <= vp.height - 14 && th.y + th.h <= vp.height - 14, `steer ${sz.x.toFixed(0)}px from left, pedals ${(vp.width - th.x - th.w).toFixed(0)}px from right, bottom gap ${(vp.height - th.y - th.h).toFixed(0)}px`);
// left thumb starts off-centre in the zone and slides right; right thumb on the throttle
const sx = sz.x + sz.w * 0.3, sy = sz.y + sz.h * 0.5;
const tx = th.x + th.w / 2, ty = th.y + th.h * 0.3;
await touch('touchStart', [{ x: sx, y: sy, id: 1 }]);
await touch('touchStart', [{ x: sx, y: sy, id: 1 }, { x: tx, y: ty, id: 2 }]);
await touch('touchMove', [{ x: sx + sz.w * 0.25, y: sy, id: 1 }, { x: tx, y: ty, id: 2 }]);
await wait(250);
let c = await ev(() => { const k = window.__app.controls; return { steer: k.steer, thr: k.throttle, brk: k.brake }; });
check('Steering starts anywhere in its zone and works with the throttle held', c.steer > 0.4 && c.thr > 0.95, `steer ${c.steer.toFixed(2)}, throttle ${c.thr.toFixed(2)}`);
// slide the throttle thumb onto the brake
await touch('touchMove', [{ x: sx + sz.w * 0.25, y: sy, id: 1 }, { x: br.x + br.w / 2, y: br.y + br.h * 0.3, id: 2 }]);
await wait(20);
c = await ev(() => { const k = window.__app.controls; k.update(0.016); return { thr: k.throttle, brk: k.brake }; });
check('Sliding from throttle to brake releases the throttle immediately', c.thr === 0 && c.brk > 0.9, `throttle ${c.thr}, brake ${c.brk.toFixed(2)}`);
await touch('touchEnd', []);
await wait(300);
c = await ev(() => { const k = window.__app.controls; return { steer: k.steer, thr: k.throttle, brk: k.brake }; });
check('Released steering recentres smoothly', Math.abs(c.steer) < 0.05 && c.thr === 0 && c.brk === 0, `steer ${c.steer.toFixed(3)}`);
const prevented = await ev(() => { const e = new TouchEvent('touchmove', { cancelable: true, bubbles: true, touches: [] }); document.getElementById('view').dispatchEvent(e); return e.defaultPrevented; });
check('Page gestures prevented on the driving surface', prevented);

// ---- automatic shifts (autopilot over the first sector) -----------------------------------------
await ev(() => { const a = window.__app; a.__autoOverride = true; a.__shifts = { up: 0, down: 0, gears: new Set() }; const orig = a.audio.event.bind(a.audio); a.audio.event = (e) => { if (e.type === 'upshift') a.__shifts.up++; if (e.type === 'downshift') a.__shifts.down++; orig(e); }; });
await page.waitForFunction(() => window.__app.veh.s > 300 && window.__app.veh.s < 1000, null, { timeout: 60000 });
let sh = await ev(() => ({ up: window.__app.__shifts.up, gear: window.__app.veh.gear, lap: window.__app.timing.state }));
check('Timing starts on the first forward crossing of the line', sh.lap === 'running');
check('Automatic upshifts on acceleration', sh.up >= 4, `${sh.up} upshifts by Sainte Dévote, gear ${sh.gear}`);
const hudGear = await page.textContent('#gear');
check('HUD shows the current gear', /^[1-8NR]$/.test(hudGear.trim()), `HUD gear "${hudGear}"`);

// ---- focus loss --------------------------------------------------------------------------------
await ev(() => window.dispatchEvent(new Event('blur')));
const p1 = await ev(() => ({ st: window.__app.state, t: window.__app.simTime, touches: window.__app.controls.pedalTouches.size }));
await wait(1200);
const p2 = await ev(() => ({ st: window.__app.state, t: window.__app.simTime }));
check('Focus loss pauses the simulation and freezes the lap timer', p1.st === 'paused' && p2.t === p1.t && await page.isVisible('#pause.on'), `state ${p1.st}, timer ${p1.t.toFixed(3)} -> ${p2.t.toFixed(3)}`);
check('Focus loss clears active touches', p1.touches === 0);
await page.tap('#btnResume');
await wait(400);
check('Resume continues the run', (await ev(() => window.__app.state)) === 'driving');

// ---- full lap: timing, checkpoints, saved best, hairpin lock, tunnel, chicane downshifts -------
await ev(() => {
  const a = window.__app;
  a.__log = { hairpinLock: 0, tunnelV: [], chicaneDown: 0, prevGear: a.veh.gear };
  a.__probe = setInterval(() => {
    const v = a.veh, T = a.track, L = a.__log;
    const hp = T.corners.find(c => c.id === 'hairpin').s;
    if (Math.abs(T.deltaS(v.s, hp)) < 25) L.hairpinLock = Math.max(L.hairpinLock, Math.abs(v.delta) * 180 / Math.PI);
    if (T.inTunnel(v.s)) L.tunnelV.push([v.s, v.speed * 3.6, v.gear, v.rpm]);
    const ch = T.corners.find(c => c.id === 'chicane').s;
    const toCh = T.deltaS(v.s, ch);                 // > 0 before the chicane
    if (toCh > 0 && toCh < 160 && v.gear < L.prevGear) L.chicaneDown += L.prevGear - v.gear;
    L.prevGear = v.gear;
  }, 10);
});
await page.waitForFunction(() => window.__app.timing.last !== null, null, { timeout: 240000 });
const lap = await ev(() => { const a = window.__app; clearInterval(a.__probe); return { last: a.timing.last, best: a.timing.best, ls: localStorage.getItem('monacoTT.best.v1'), log: a.__log }; });
check('Full lap recorded after all checkpoints and a forward crossing', lap.last > 60 && lap.last < 120, `autopilot lap ${lap.last.toFixed(3)} s`);
check('Best lap saved locally', !!lap.ls && Math.abs(JSON.parse(lap.ls).time - lap.best) < 1e-6);
check('Fairmont hairpin taken in one continuous turn at full steering lock', lap.log.hairpinLock > 22.5, `max road-wheel angle ${lap.log.hairpinLock.toFixed(1)}°`);
const tv = lap.log.tunnelV;
check('Engine pulls through the tunnel', tv.length > 10 && tv[tv.length - 1][1] > tv[0][1] + 40 && tv[tv.length - 1][2] >= 7, `${tv[0][1].toFixed(0)} -> ${tv[tv.length - 1][1].toFixed(0)} km/h, gear ${tv[0][2]} -> ${tv[tv.length - 1][2]}`);
check('Individual downshifts approaching the Nouvelle Chicane', lap.log.chicaneDown >= 3, `${lap.log.chicaneDown} downshifts`);
const msg = await page.textContent('#msg1') + ' ' + await page.textContent('#msg2');
check('Completed time displayed while the next lap runs', /Lap|Personal best/.test(msg) && (await ev(() => window.__app.timing.state)) === 'running', msg.trim());

// ---- corner cut at the Nouvelle Chicane -----------------------------------------------------------
await ev(() => {
  const a = window.__app, T = a.track;
  a.__autoOverride = false;
  const ch = T.corners.find(c => c.id === 'chicane').s;
  a.timing._startLap(a.simTime); a.timing.nextCp = 7;
  a.veh.reset(T.wrapS(ch - 60), 0, { speed: 20 });
  a.timing.teleport(a.veh.s);
  a.__cut = setInterval(() => { a.controls.steerRaw = 0; a.controls.steer = 0; a.controls.throttle = 0.5; a.veh.setInput(0, 0.5, 0); }, 5);
});
await page.waitForFunction(() => window.__app.timing.invalid || window.__app.veh.s > window.__app.track.corners.find(c => c.id === 'tabac').s, null, { timeout: 30000 }).catch(() => {});
const cut = await ev(() => { const a = window.__app; clearInterval(a.__cut); return { inv: a.timing.invalid, reason: a.timing.invalidReason }; });
const cutMsg = await page.textContent('#msg1') + ' ' + await page.textContent('#msg2');
check('Corner cut at the Nouvelle Chicane invalidates the lap immediately', cut.inv && cut.reason === 'cut' && cutMsg.includes('Lap invalid — corner cut.'), cutMsg.trim());

// ---- reverse crossing never starts a lap ----------------------------------------------------------
await ev(() => { const a = window.__app; a.timing.reset(); a.veh.reset(8, 0, { speed: 0 }); a.timing.teleport(a.veh.s); });
// hold the brake at a standstill -> reverse engages; keep holding to back over the line
await ev(() => { window.__app.controls.keys.add('ArrowDown'); });
await page.waitForFunction(() => window.__app.veh.s > window.__app.track.L - 25, null, { timeout: 30000 }).catch(() => {});
const rev = await ev(() => { const a = window.__app; a.controls.keys.delete('ArrowDown'); return { s: a.veh.s, state: a.timing.state, reverse: a.veh.reverse }; });
check('Reverse crossing of the line does not start a lap', rev.reverse && rev.state === 'out', `reversed to s=${rev.s.toFixed(0)}, timing ${rev.state}`);

// ---- reset car ---------------------------------------------------------------------------------
await ev(() => { const a = window.__app; a.timing._startLap(a.simTime); const s = a.track.corners.find(c => c.id === 'portier').s; a.veh.reset(s, 3.5, { speed: 0 }); a.veh.psi += 1.2; a.veh.damage.impact('fwL', 4000, 5, 1, 'carbon'); a.timing.teleport(a.veh.s); });
const before = await ev(() => ({ s: window.__app.veh.s, fwL: window.__app.veh.damage.health.fwL }));
await page.tap('#btnPause'); await wait(200); await page.tap('#btnReset'); await wait(300);
const after = await ev(() => { const a = window.__app, T = a.track, k = T.idxOfS(a.veh.s); const fwd = [-Math.sin(a.veh.psi), -Math.cos(a.veh.psi)]; return { s: a.veh.s, d: a.veh.d, fwL: a.veh.damage.health.fwL, align: fwd[0] * T.tx[k] + fwd[1] * T.tz[k], inv: a.timing.invalid, st: a.state }; });
check('Reset Car: safe nearby position facing the right way', Math.abs(after.d) < 0.5 && after.align > 0.99 && before.s - after.s > 2 && before.s - after.s < 20 && after.st === 'driving', `moved ${(before.s - after.s).toFixed(1)} m back, d=${after.d.toFixed(2)}, heading·tangent=${after.align.toFixed(3)}`);
check('Reset Car keeps the damage and invalidates the lap', Math.abs(after.fwL - before.fwL) < 1e-6 && after.fwL < 1 && after.inv);

// ---- glancing scrape ------------------------------------------------------------------------------
await ev(() => {
  const a = window.__app, T = a.track;
  a.veh.reset(80, -4.6, { speed: 58 }); a.car.repair(); a.timing.teleport(a.veh.s);
  a.__ev = []; const orig = a.audio.event.bind(a.audio); a.audio.event = (e) => { if (e.type === 'impact') a.__ev.push({ kind: e.kind, part: e.part, E: e.energy }); orig(e); };
  // ~4 degrees towards the right-hand (pit) wall, velocity along the new heading
  a.veh.psi -= 0.09;
  const sp = a.veh.speed; a.veh.vx = -Math.sin(a.veh.psi) * sp; a.veh.vz = -Math.cos(a.veh.psi) * sp;
  a.controls.keys.add('ArrowUp');
});
await wait(1500);
const gl = await ev(() => { const a = window.__app; a.controls.keys.delete('ArrowUp'); return { ev: a.__ev, und: a.veh.damage.undriveable, v: a.veh.speed * 3.6, scrape: a.veh.contact.scrape, fwR: a.veh.damage.health.fwR, wFR: a.veh.damage.health.wheelFR }; });
const kinds = [...new Set(gl.ev.map(e => e.kind))].join(',');
check('Glancing barrier contact: scrape, slide along the wall, car continues', gl.ev.length > 0 && !gl.und && gl.v > 120, `events: ${kinds || 'none'}, ${gl.ev.length} contacts, speed after ${gl.v.toFixed(0)} km/h, wing R ${gl.fwR.toFixed(2)}, FR susp ${gl.wFR.toFixed(2)}`);

// ---- heavy frontal impact -----------------------------------------------------------------------
await page.goto(root + '?noaudio=1&start=drive');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await ev(() => {
  // nose first, square into the left-hand barrier on Beau Rivage at ~110 km/h
  const a = window.__app, T = a.track;
  const s = 600, k = T.idxOfS(s);
  a.veh.reset(s, -4, { speed: 0 });
  a.veh.psi = Math.atan2(-T.nx[k], -T.nz[k]);         // forward = +left normal (towards the barrier)
  a.veh.vx = T.nx[k] * 30; a.veh.vz = T.nz[k] * 30;
  a.timing.teleport(a.veh.s);
  a.__ev = []; const orig = a.audio.event.bind(a.audio); a.audio.event = (e) => { if (e.type === 'impact') a.__ev.push({ kind: e.kind, part: e.part, E: e.energy }); orig(e); };
});
await page.waitForFunction(() => window.__app.veh.damage.undriveable || window.__app.__ev.some(e => e.kind === 'heavy'), null, { timeout: 30000 }).catch(() => {});
await wait(600);
await page.screenshot({ path: path.join(out, `test_heavy_impact_${devName}.png`) });
await page.waitForSelector('#crash.on', { timeout: 30000 }).catch(() => {});
const hv = await ev(() => { const a = window.__app; const d = a.veh.damage; return { ev: a.__ev, und: d.undriveable, reason: d.reason, nose: d.health.nose, fwL: d.health.fwL, fwR: d.health.fwR, wFL: d.health.wheelFL, wFR: d.health.wheelFR, debris: a.fx.debris.length, st: a.state, cell: true }; });
check('Heavy frontal impact damages the nose, wing and front suspension', hv.ev.some(e => e.kind === 'heavy') && hv.nose < 0.5 && Math.min(hv.fwL, hv.fwR) < 0.3, `nose ${hv.nose.toFixed(2)}, wing L/R ${hv.fwL.toFixed(2)}/${hv.fwR.toFixed(2)}, wheels FL/FR ${hv.wFL.toFixed(2)}/${hv.wFR.toFixed(2)}, debris ${hv.debris}`);
check('Undriveable car ends the run with Quick Restart offered', hv.und && hv.st === 'crashed' && await page.isVisible('#crash.on'), hv.reason);
await page.screenshot({ path: path.join(out, `test_crash_screen_${devName}.png`) });

// ---- quick restart ------------------------------------------------------------------------------
await ev(() => { const a = window.__app; a.rig.setMode('chase'); localStorage.setItem('monacoTT.best.v1', JSON.stringify({ time: 77.777 })); a.timing.best = 77.777; });
await page.tap('#btnCrashRestart');
await wait(400);
const qr = await ev(() => { const a = window.__app; const h = a.veh.damage.health; return { s: a.veh.s, spawn: a.track.spawnS, intact: Object.values(h).every(v => v === 1), state: a.timing.state, best: a.timing.best, cam: a.rig.mode, st: a.state, nose: a.car.parts.nose.visible }; });
check('Quick Restart: repaired car at the start, timing cleared', Math.abs(qr.s - qr.spawn) < 1 && qr.intact && qr.nose && qr.state === 'out' && qr.st === 'driving');
check('Quick Restart keeps the personal best and the camera choice', qr.best === 77.777 && qr.cam === 'chase');

// ---- saved best across a reload ---------------------------------------------------------------------
await page.goto(root + '?norender=1&noaudio=1');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const menuBest = await page.textContent('#menuBest');
check('Personal best restored after a fresh reload', menuBest.includes('1:17.777'), menuBest);

// ---- portrait prompt ---------------------------------------------------------------------------------
await page.setViewportSize({ width: 440, height: 956 });
await wait(300);
check('Portrait shows "Rotate your phone to play."', await page.isVisible('#rotate') && (await page.textContent('#rotate p')).includes('Rotate your phone to play.'));

check('No uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed on emulated ${devName}`);
await browser.close(); if (srv) srv.kill();
process.exit(failed ? 1 : 0);

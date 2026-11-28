// Language and touch-input acceptance test (emulated iPhone, real touch events via CDP):
//   node tools/ui-test.mjs [outdir]          (exit code 1 on failure)
// * the language selector: instant switch without a reload, <html lang>, persistence across a
//   reload, the same choice in Settings; in each language every text on every screen is in that
//   language (no string left from the other one)
// * every button acts on the FIRST tap, exactly once - including taps where the thumb drifts
//   8 px while down (the case iOS Safari turned into a lost click), with a pressed state shown
//   while the finger is down
// * driving controls: steering + throttle, then + brake, all held together (multi-touch)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
const out = process.argv[2] || '.';
fs.mkdirSync(out, { recursive: true });
const PORT = +(process.env.PORT || 8796);
const base = process.env.BASE_URL || `http://localhost:${PORT}/`;
let srv = null;
if (!process.env.BASE_URL) { srv = spawn(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), 'serve.mjs'), String(PORT)], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 400)); }
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ ...devices['iPhone 15 Pro Max'], viewport: { width: 956, height: 440 }, locale: 'en-US' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
let pass = 0, fail = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); ok ? pass++ : fail++; };
const ev = (fn, a) => page.evaluate(fn, a);
const cdp = await ctx.newCDPSession(page);
const wait = (ms) => page.waitForTimeout(ms);
const center = async (sel) => { await ev((s) => { const e = document.querySelector(s); if (e && e.closest('.card')) e.scrollIntoView({ block: 'center' }); }, sel); await wait(60); const b = await page.locator(sel).boundingBox(); if (!b) throw new Error('no box ' + sel); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
// a real touch: down, (optional drift while held), up
async function touchTap(sel, { drift = 0, hold = 60 } = {}) {
  const { x, y } = await center(sel);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await wait(hold / 2);
  if (drift) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + drift, y: y + drift * 0.6, id: 1 }] });
  const pressed = await ev((s) => document.querySelector(s).classList.contains('pressed'), sel);
  await wait(hold / 2);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await wait(250);
  return pressed;
}
await page.goto(base + '?noaudio=1&q=low');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
await page.waitForFunction(() => window.__app.state === 'menu', null, { timeout: 30000 });
await wait(3200);                                         // loading hand-over finished
await ev(() => { window.__noReload = 1; });

// ---- language selector ----------------------------------------------------------------------
check('First visit follows the device language (en-US -> English)', await ev(() => document.documentElement.lang) === 'en');
const lbox = await page.locator('#langSel').boundingBox();
check('Language selector in the top-right corner of the menu', lbox && lbox.x + lbox.width > 956 - 80 && lbox.y < 60, lbox && `x ${lbox.x.toFixed(0)}-${(lbox.x + lbox.width).toFixed(0)}, y ${lbox.y.toFixed(0)}`);
let p = await touchTap('#langSel [data-lang="tr"]');
const trNow = await ev(() => ({ lang: document.documentElement.lang, drive: document.getElementById('btnDrive').textContent, h1: document.querySelector('#menu h1').textContent, best: document.getElementById('menuBest').textContent, cine: document.getElementById('cineLabel').textContent, on: document.querySelector('#langSel [data-lang="tr"]').classList.contains('on'), reloaded: !window.__noReload, stored: localStorage.getItem('f1-27.lang') }));
check('Tapping Türkçe switches instantly, no reload, selection highlighted, saved', trNow.lang === 'tr' && trNow.drive === 'Piste Çık' && trNow.on && !trNow.reloaded && trNow.stored === 'tr', JSON.stringify(trNow));
check('Pressed state shown while the finger is down', p);
await page.screenshot({ path: path.join(out, 'menu_tr.png') });
await page.reload();
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
await wait(3200);
check('Turkish kept after a reload (localStorage)', await ev(() => document.documentElement.lang === 'tr' && document.getElementById('btnDrive').textContent === 'Piste Çık'));

// ---- every screen in a language: collect visible text and compare with the other language -----
async function screenTexts() {
  return ev(() => {
    const out = [];
    const walk = (el) => {
      if (el.closest('[data-lang], #fps, #err')) return;
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return;
      for (const n of el.childNodes) {
        if (n.nodeType === 3 && n.textContent.trim()) out.push(n.textContent.trim());
        else if (n.nodeType === 1) walk(n);
      }
    };
    walk(document.getElementById('app'));
    return out;
  });
}
// the two dictionaries straight from the module source
const src = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '../js/i18n.js'), 'utf8');
const enVals = new Set([...src.slice(src.indexOf('en: {'), src.indexOf('tr: {')).matchAll(/'[\w.]+(?: [^']*)?': '([^']*)'/g)].map(m => m[1].replace(/<[^>]+>/g, '').replace(/\{\w+\}/g, '').trim()).filter(v => v.length > 2));
const trVals = new Set([...src.slice(src.indexOf('tr: {')).matchAll(/'[\w.]+(?: [^']*)?': '([^']*)'/g)].map(m => m[1].replace(/<[^>]+>/g, '').replace(/\{\w+\}/g, '').trim()).filter(v => v.length > 2));
const foreign = (texts, other, own) => texts.filter(s => [...other].some(v => !own.has(v) && (s === v || (v.length > 5 && s.includes(v)))));
const shots = [];
async function audit(label, lang) {
  const texts = await screenTexts();
  const bad = lang === 'tr' ? foreign(texts, enVals, trVals) : foreign(texts, trVals, enVals);
  check(`[${lang}] ${label}: everything in ${lang === 'tr' ? 'Turkish' : 'English'}`, bad.length === 0, bad.length ? 'found: ' + bad.slice(0, 5).join(' | ') : `${texts.length} texts`);
  const f = path.join(out, `${lang}_${label.replace(/\W+/g, '_')}.png`); await page.screenshot({ path: f }); shots.push(f);
}

async function runLanguage(lang) {
  await touchTap(`#langSel [data-lang="${lang}"]`);
  await audit('menu', lang);
  // Settings: first tap opens it, every segment button toggles on the first tap
  await touchTap('#btnSettings', { drift: 8 });
  check(`[${lang}] Settings opens on the first tap (thumb drifting 8 px)`, await ev(() => document.getElementById('settings').classList.contains('on')));
  await audit('settings', lang);
  for (const [seg, v] of [['segGfx', 'medium'], ['segGfx', 'auto'], ['segAssist', 'off'], ['segAssist', 'standard'], ['segFps', '1'], ['segFps', '0'], ['segCam', 'tcam'], ['segCam', 'cockpit']]) {
    await touchTap(`#${seg} [data-v="${v}"]`, { drift: 6 });
    const on = await ev(([s, v]) => document.querySelector(`#${s} [data-v="${v}"]`).classList.contains('on'), [seg, v]);
    check(`[${lang}] ${seg} → ${v} on the first tap`, on);
  }
  const other = lang === 'tr' ? 'en' : 'tr';
  await touchTap(`#segLang [data-lang="${other}"]`);
  const sw = await ev(() => ({ lang: document.documentElement.lang, title: document.querySelector('#settings h2').textContent }));
  check(`[${lang}] Language row in Settings switches to ${other} instantly`, sw.lang === other, JSON.stringify(sw));
  await touchTap(`#segLang [data-lang="${lang}"]`);
  await touchTap('#btnSettingsBack', { drift: 8 });
  check(`[${lang}] Done closes Settings on the first tap, and its late click does not hit the menu underneath`, !(await ev(() => document.getElementById('settings').classList.contains('on'))) && await ev(() => window.__app.state) === 'menu');
  // Drive
  await touchTap('#btnDrive', { drift: 8 });
  check(`[${lang}] Drive starts on the first tap`, await ev(() => window.__app.state) === 'driving');
  await wait(400);
  await audit('hud driving', lang);
  // camera: one tap = exactly one camera step
  const cams = [];
  for (let i = 0; i < 3; i++) { await touchTap('#btnCam', { drift: 5 }); cams.push(await ev(() => window.__app.rig.mode)); }
  check(`[${lang}] Camera button: one tap, one camera step`, cams.join() === 'tcam,chase,cockpit', cams.join());
  check(`[${lang}] Camera label in the language`, (await ev(() => document.getElementById('camLabel').textContent)) === (lang === 'tr' ? 'KOKPİT' : 'COCKPIT'));
  // multi-touch: steer + throttle, then + brake, all held
  const zs = await center('#steerZone'), th = await center('#throttle'), br = await center('#brake');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: zs.x, y: zs.y, id: 11 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: zs.x, y: zs.y, id: 11 }, { x: th.x, y: th.y - 40, id: 12 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: zs.x + 70, y: zs.y, id: 11 }, { x: th.x, y: th.y - 40, id: 12 }] });
  await wait(300);
  const m1 = await ev(() => ({ s: window.__app.controls.steer, th: window.__app.controls.throttle, br: window.__app.controls.brake }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: zs.x + 70, y: zs.y, id: 11 }, { x: th.x, y: th.y - 40, id: 12 }, { x: br.x, y: br.y - 40, id: 13 }] });
  await wait(250);
  const m2 = await ev(() => ({ s: window.__app.controls.steer, th: window.__app.controls.throttle, br: window.__app.controls.brake }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await wait(300);
  const m3 = await ev(() => ({ s: window.__app.controls.steerRaw, steerTouch: window.__app.controls.steerTouch, th: window.__app.controls.throttle, br: window.__app.controls.brake }));
  check(`[${lang}] Steering + throttle held together`, m1.s > 0.3 && m1.th > 0.9 && m1.br === 0, JSON.stringify(m1));
  check(`[${lang}] Steering + throttle + brake held together`, m2.s > 0.3 && m2.th > 0.9 && m2.br > 0.5, JSON.stringify(m2));
  check(`[${lang}] All released (steering target back to centre)`, m3.s === 0 && m3.steerTouch === null && m3.th === 0 && m3.br === 0, JSON.stringify(m3));
  // a thumb landing just off the throttle pad and rolling onto it engages the throttle
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: th.x, y: th.y - 110, id: 21 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: th.x, y: th.y - 30, id: 21 }] });
  await wait(200);
  const roll = await ev(() => window.__app.controls.throttle);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  check(`[${lang}] Thumb rolling onto the throttle engages it without a re-tap`, roll > 0.9, roll.toFixed(2));
  // pause / resume / reset / restart / settings from pause / menu
  await touchTap('#btnPause', { drift: 6 });
  check(`[${lang}] Pause on the first tap`, await ev(() => window.__app.state) === 'paused');
  await audit('pause', lang);
  await touchTap('#btnResume', { drift: 8 });
  check(`[${lang}] Resume on the first tap`, await ev(() => window.__app.state) === 'driving');
  await touchTap('#btnPause'); await touchTap('#btnReset', { drift: 8 });
  check(`[${lang}] Reset Car on the first tap`, await ev(() => window.__app.state) === 'driving' && await ev(() => window.__app.timing.invalid || window.__app.timing.state === 'out'));
  await touchTap('#btnPause'); await touchTap('#btnRestart', { drift: 8 });
  check(`[${lang}] Quick Restart on the first tap`, await ev(() => window.__app.state === 'driving' && window.__app.timing.state === 'out'));
  await touchTap('#btnPause'); await touchTap('#btnPauseSettings', { drift: 8 });
  check(`[${lang}] Settings from pause on the first tap`, await ev(() => document.getElementById('settings').classList.contains('on')));
  await touchTap('#btnSettingsBack');
  // timing messages and the crash panel in the language
  await ev(() => { const a = window.__app; a.timing._startLap(a.simTime); a.timing.invalidate('cut'); });
  await touchTap('#btnResume');
  await wait(500);
  await audit('lap invalid message', lang);
  const msg = await ev(() => document.getElementById('msg1').textContent + document.getElementById('msg2').textContent);
  check(`[${lang}] Corner-cut warning in the language`, msg.includes(lang === 'tr' ? 'Tur geçersiz — viraj kesildi.' : 'Lap invalid — corner cut.'), msg);
  await ev(() => { const a = window.__app; a.veh.damage._end('Heavy impact'); a.crashT = 2; });   // skip the 1.4 s wait (slow software rendering here)
  await page.waitForFunction(() => window.__app.state === 'crashed', null, { timeout: 120000 });
  await audit('crash', lang);
  const cm = await ev(() => document.getElementById('crashMsg').textContent);
  check(`[${lang}] Crash message in the language`, cm === (lang === 'tr' ? 'Şiddetli çarpışma. Güvenlik hücresi sağlam.' : 'Heavy impact. The survival cell is intact.'), cm);
  await touchTap('#btnCrashMenu', { drift: 8 });
  check(`[${lang}] Return to Menu (crash panel) on the first tap`, await ev(() => window.__app.state) === 'menu');
  await wait(300);
  // drive again and leave via the pause menu
  await touchTap('#btnDrive'); await touchTap('#btnPause'); await touchTap('#btnMenu', { drift: 8 });
  check(`[${lang}] Return to Menu (pause) on the first tap`, await ev(() => window.__app.state) === 'menu');
  // the switch while driving: the HUD follows
  await touchTap('#btnDrive');
  await ev((o) => import('./js/i18n.js').then(m => m.setLang(o)), lang === 'tr' ? 'en' : 'tr');
  await wait(250);
  const lapNo = await ev(() => document.getElementById('lapNo').textContent);
  check(`[${lang}] Switching language while driving updates the HUD at once`, lapNo === (lang === 'tr' ? 'OUT LAP' : 'ÇIKIŞ TURU'), lapNo);
  await ev((o) => import('./js/i18n.js').then(m => m.setLang(o)), lang);
  await touchTap('#btnPause'); await touchTap('#btnMenu');
}
// LANGS=tr or LANGS=en runs one language (the selector / persistence checks always run)
for (const l of (process.env.LANGS || 'tr,en').split(',')) await runLanguage(l);
check('Each tap acted exactly once (no double actions seen above) and no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${pass}/${pass + fail} checks passed`);
await browser.close(); if (srv) srv.kill();
process.exit(fail ? 1 : 0);

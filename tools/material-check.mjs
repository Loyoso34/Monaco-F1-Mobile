// Are the car's materials distinguishable in every light? In the rendered game the car is
// viewed from its sun-lit side, from its shaded side (faces turned away from the sun, lit only
// by the sky and the street; the street scenery itself casts no shadows in this build) and in
// the tunnel. Each frame is split into material classes with ID renders - navy paint (the
// livery's navy areas only), exposed carbon, tyre rubber, the satin-black halo - and the mean
// colour of each class is compared pairwise as CIE Lab Delta-E (2.3 = just noticeable,
// > 5 = clearly different), together with the brightness of the highlights (90th percentile).
//   node tools/material-check.mjs [outdir]           (exit code 1 on failure)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
const out = process.argv[2] || null;
if (out) fs.mkdirSync(out, { recursive: true });
const PORT = +(process.env.PORT || 8776);
const srv = spawn(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 400));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 956, height: 440 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: devices['iPhone 15 Pro Max'].userAgent });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/?start=drive&noaudio=1&q=high`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });

const spots = [
  { name: 'sun side', s: ['beau-rivage', -40], view: 'sun' },
  { name: 'shaded side', s: ['beau-rivage', -40], view: 'shade' },
  { name: 'tunnel', s: 'tunnel+150', view: 'sun' },
];
const rows = [];
for (const sp of spots) {
  const r = await page.evaluate(async (sp) => {
    const a = window.__app, T = a.track, THREE = a.THREE;
    const s = typeof sp.s === 'string' ? T.wrapS(T.tunnelS[0] + (+sp.s.slice(7))) : T.wrapS(T.corners.find(c => c.id === sp.s[0]).s + sp.s[1]);
    a.__autoOverride = false; a.controls.enabled = false; a.controls.clear();
    a.veh.reset(s, 0, { speed: 0 }); a.timing.teleport(a.veh.s);
    await new Promise(res => setTimeout(res, 800));
    // camera beside the car on the sun-lit or the shaded side (car frame -> world)
    a.car.root.updateMatrixWorld(true);
    const Mw = a.car.chassis.matrixWorld;
    const sunLocal = a.sc.sunDir.clone().transformDirection(Mw.clone().invert());
    const side = (sp.view === 'sun' ? 1 : -1) * Math.sign(sunLocal.x || 1);
    const e = new THREE.Vector3(side * 4.2, 1.35, -1.2).applyMatrix4(Mw), l = new THREE.Vector3(0, 0.42, 0.1).applyMatrix4(Mw);
    a.freeCam = { pos: [e.x, e.y, e.z], look: [l.x, l.y, l.z], fov: 38 };
    await new Promise(res => setTimeout(res, 1200));
    a.benchNoAdapt = true;
    const r = a.renderer, gl = r.getContext(), W = r.domElement.width, H = r.domElement.height;
    const M = a.car.materials;
    const classOf = (m) => {
      if (!m) return null;
      if (m === M.body || m === M.navy || m === M.navyDark) return 1;            // painted navy
      if (m === M.carbon || m === M.carbonMatte || m === M.wing) return 2;        // exposed carbon
      if (m === M.tyre) return 3;                                                // rubber
      if (m.name === 'haloSatin') return 4;                                       // halo
      if (m === M.metal || m === M.anodised || m === M.rim || m === M.exhaust) return 5; // metal
      return null;
    };
    const px = new Uint8Array(W * H * 4);
    const cam = a.camera;
    r.render(a.scene, cam); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const real = px.slice();
    // ID pass
    const saved = [], idMats = {};
    const hidden = [];
    a.scene.children.forEach((c) => { if (c !== a.car.root && c.visible && !c.isLight) { hidden.push(c); c.visible = false; } });
    a.car.root.traverse((o) => {
      if (!o.isMesh) return;
      saved.push([o, o.material]);
      const k = classOf(o.material);
      if (!k || o.material.transparent) { o.material = idMats[0] || (idMats[0] = new THREE.MeshBasicMaterial({ color: 0x000000 })); return; }
      o.material = idMats[k] || (idMats[k] = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(k * 40 / 255, 0, 0, THREE.SRGBColorSpace), toneMapped: false }));
    });
    const bg = a.scene.background, fog = a.scene.fog; a.scene.background = new THREE.Color(0, 0, 0); a.scene.fog = null;
    r.render(a.scene, cam); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // second ID pass: the livery's unlit colour on painted panels, to keep only navy areas
    const albedo = new Uint8Array(W * H * 4);
    {
      const unlit = new THREE.MeshBasicMaterial({ map: M.body.map, toneMapped: false });
      const navyU = new THREE.MeshBasicMaterial({ color: M.navy.color, toneMapped: false });
      for (const [o, m] of saved) o.material = m === M.body ? unlit : (m === M.navy || m === M.navyDark) ? navyU : (idMats[0] || new THREE.MeshBasicMaterial({ color: 0 }));
      r.render(a.scene, cam); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, albedo);
    }
    for (const [o, m] of saved) o.material = m;
    for (const c of hidden) c.visible = true;
    a.scene.background = bg; a.scene.fog = fog;
    a.benchNoAdapt = false; a.freeCam = null;
    // stats per class (linear RGB means of sRGB pixels)
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const acc = {};
    for (let i = 0; i < W * H; i++) {
      let id = Math.round(px[i * 4] / 40);
      if (id < 1 || id > 5 || Math.abs(px[i * 4] - id * 40) > 3) continue;
      if (id === 1) {
        // navy paint only (dark, blue-dominant albedo); livery colours / decals excluded
        const R = albedo[i * 4], G = albedo[i * 4 + 1], B = albedo[i * 4 + 2];
        if (!(B > R + 8 && B > G && R + G + B < 240)) continue;
      }
      // erode: skip pixels next to another class (edges blend)
      const x = i % W, y = (i / W) | 0;
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
      if (px[(i - 1) * 4] !== px[i * 4] || px[(i + 1) * 4] !== px[i * 4] || px[(i - W) * 4] !== px[i * 4] || px[(i + W) * 4] !== px[i * 4]) continue;
      const c = acc[id] || (acc[id] = { n: 0, r: 0, g: 0, b: 0, lum: [] });
      const R = lin(real[i * 4]), G = lin(real[i * 4 + 1]), B = lin(real[i * 4 + 2]);
      c.n++; c.r += R; c.g += G; c.b += B; if (c.n % 3 === 0) c.lum.push(0.2126 * R + 0.7152 * G + 0.0722 * B);
    }
    const res = {};
    for (const [id, c] of Object.entries(acc)) {
      const l = c.lum.sort((p, q) => p - q);
      res[id] = { n: c.n, rgb: [c.r / c.n, c.g / c.n, c.b / c.n], p90: l[Math.floor(l.length * 0.9)] || 0, p10: l[Math.floor(l.length * 0.1)] || 0 };
    }
    return { s: Math.round(s), daylight: a.daylight, res };
  }, sp);
  if (out) await page.screenshot({ path: path.join(out, `materials_${sp.name}.png`) });
  rows.push({ ...sp, ...r });
}
// CIE Lab from linear sRGB
const lab = ([r, g, b]) => {
  let X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
const NAMES = { 1: 'paint', 2: 'carbon', 3: 'rubber', 4: 'halo', 5: 'metal' };
let fail = 0;
for (const r of rows) {
  const ids = Object.keys(r.res).filter((k) => r.res[k].n >= 150);
  console.log(`${r.name} (lap ${r.s} m, daylight ${r.daylight.toFixed(2)}):  ` + ids.map((k) => { const L = lab(r.res[k].rgb); return `${NAMES[k]} L*${L[0].toFixed(1)} a*${L[1].toFixed(1)} b*${L[2].toFixed(1)} (${r.res[k].n} px)`; }).join(' | '));
  const pairs = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const A = lab(r.res[ids[i]].rgb), B = lab(r.res[ids[j]].rgb);
    const dE = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
    // highlights also tell materials apart (glossy carbon vs satin paint vs rough rubber)
    const dHi = Math.abs(lab([r.res[ids[i]].p90, r.res[ids[i]].p90, r.res[ids[i]].p90])[0] - lab([r.res[ids[j]].p90, r.res[ids[j]].p90, r.res[ids[j]].p90])[0]);
    const ok = dE > 3 || dHi > 5;
    if (!ok) fail++;
    pairs.push(`${ok ? '' : 'FAIL '}${NAMES[ids[i]]}/${NAMES[ids[j]]} dE ${dE.toFixed(1)}${dHi > 0 ? ` hi ${dHi.toFixed(1)}` : ''}`);
  }
  console.log('   ' + pairs.join(' · '));
}
if (errors.length) { console.log('page errors:', errors.slice(0, 3).join(' | ')); fail++; }
console.log(fail ? `${fail} pairs not distinguishable` : 'all material pairs distinguishable in every light');
await browser.close(); srv.kill();
process.exit(fail ? 1 : 0);

// Small-decal stability test (halo markings, onboard cameras), in the rendered game.
//
// Shimmer is texture aliasing: when the camera moves by a fraction of a pixel (vibration,
// steering, bumps), an under-filtered texture samples different texels and pixels flicker
// instead of moving smoothly. For each test spot the scene is rendered 16 times with sub-pixel
// projection offsets (the camera shifted by -0.5..0.5 px, as in TAA jitter), and every frame is
// compared with the unshifted frame resampled at the same sub-pixel offset: what a correctly
// filtered image looks like after that motion. The mean residual over the pixels the markings
// cover is the shimmer. It is compared with the same markings without mipmaps / filtering (what
// shimmering decals look like) and with the bare halo surface under them (geometry edges and
// highlights). Sharpness: the markings' texture density against the screen's at their distance.
//   node tools/decal-shimmer-test.mjs [outdir]       (exit code 1 on failure)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
const out = process.argv[2] || null;
if (out) fs.mkdirSync(out, { recursive: true });
const PORT = +(process.env.PORT || 8774);
const srv = spawn(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 400));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 956, height: 440 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: devices['iPhone 15 Pro Max'].userAgent });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/?start=drive&noaudio=1&q=high`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });

const spots = [
  { name: 'sun, cockpit', at: ['casino', -60], cam: 'cockpit' },
  { name: 'sun, T-cam', at: ['casino', -60], cam: 'tcam' },
  { name: 'shade, cockpit', at: ['mirabeau', -60], cam: 'cockpit' },
  { name: 'tunnel, cockpit', at: 'tunnel+150', cam: 'cockpit' },
];
const rows = [];
for (const sp of spots) {
  const r = await page.evaluate(async (sp) => {
    const a = window.__app, T = a.track, THREE = a.THREE;
    const sOf = (ref) => typeof ref === 'string' && ref.startsWith('tunnel+') ? T.wrapS(T.tunnelS[0] + (+ref.slice(7))) : T.wrapS(T.corners.find(c => c.id === ref[0]).s + ref[1]);
    a.__autoOverride = false; a.controls.enabled = false; a.controls.clear();
    a.veh.reset(sOf(sp.at), 0, { speed: 0 }); a.timing.teleport(a.veh.s);
    a.rig.setMode(sp.cam);
    await new Promise(res => setTimeout(res, 1500));      // settle, exposure, mirrors
    a.benchNoAdapt = true;                                  // keep the resolution fixed
    const r = a.renderer, gl = r.getContext(), cvs = r.domElement, W = cvs.width, H = cvs.height;
    const mk = a.car.root.getObjectByName('haloMarkings');
    const base = a.camera.clone(); base.updateMatrixWorld();
    const px = new Uint8Array(W * H * 4);
    const grab = (cam) => { r.render(a.scene, cam); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); const L = new Float32Array(W * H); for (let i = 0; i < W * H; i++) L[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255; return L; };
    // mask: pixels the markings change
    mk.visible = false; const A = grab(base); mk.visible = true; const B = grab(base);
    const mask = []; for (let i = 0; i < W * H; i++) { const x = i % W, y = (i / W) | 0; if (x > 1 && y > 1 && x < W - 2 && y < H - 2 && Math.abs(A[i] - B[i]) > 0.06) mask.push(i); }
    let seed = 12345; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    const jit = Array.from({ length: 16 }, () => [rnd(), rnd()]);
    // bilinear sample of a frame (readPixels rows run bottom -> top)
    const bil = (L, x, yRow) => { const x0 = Math.floor(x), y0 = Math.floor(yRow), fx = x - x0, fy = yRow - y0; const i = y0 * W + x0; return (L[i] * (1 - fx) + L[i + 1] * fx) * (1 - fy) + (L[i + W] * (1 - fx) + L[i + W + 1] * fx) * fy; };
    // 4x4 supersampled grab, box-filtered down to W x H: a practically alias-free reference
    const SS = 4, pxS = new Uint8Array(W * SS * H * SS * 4);
    const grabSS = (jx, jy) => {
      const pr = r.getPixelRatio();
      r.setPixelRatio(pr * SS);
      const c = base.clone(); c.setViewOffset(W * SS, H * SS, jx * SS, jy * SS, W * SS, H * SS); c.updateProjectionMatrix();
      r.render(a.scene, c); gl.readPixels(0, 0, W * SS, H * SS, gl.RGBA, gl.UNSIGNED_BYTE, pxS);
      r.setPixelRatio(pr);
      const L = new Float32Array(W * H), WS = W * SS;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let acc = 0;
        for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) { const i = ((y * SS + dy) * WS + x * SS + dx) * 4; acc += 0.2126 * pxS[i] + 0.7152 * pxS[i + 1] + 0.0722 * pxS[i + 2]; }
        L[y * W + x] = acc / (SS * SS * 255);
      }
      return L;
    };
    const shimmer = (on, ss = false) => {
      mk.visible = on;
      const ref = ss ? grabSS(0, 0) : grab(base);
      let acc = 0, n = 0;
      for (const [jx, jy] of ss ? jit.slice(0, 8) : jit) {
        let L;
        if (ss) L = grabSS(jx, jy);
        else { const c = base.clone(); c.setViewOffset(W, H, jx, jy, W, H); c.updateProjectionMatrix(); L = grab(c); }
        // view offset (jx, jy): new pixel (x, y_top) shows old (x + jx, y_top + jy); rows bottom-up -> yRow - jy
        for (const i of mask) { const x = i % W, yr = (i / W) | 0; acc += Math.abs(L[i] - bil(ref, x + jx, yr - jy)); n++; }
      }
      return acc / Math.max(1, n);
    };
    const good = shimmer(true);
    const floor = shimmer(false);
    const ideal = shimmer(true, true);                      // supersampled reference
    // control: the same markings without mipmaps / filtering
    const t = mk.material.map, keep = [t.minFilter, t.magFilter, t.anisotropy, t.generateMipmaps];
    t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter; t.anisotropy = 1; t.generateMipmaps = false; t.needsUpdate = true;
    const bad = shimmer(true);
    [t.minFilter, t.magFilter, t.anisotropy, t.generateMipmaps] = keep; t.needsUpdate = true;
    mk.visible = true;
    // on-screen texel density: marking texture px per metre vs screen px per metre at the median
    // distance of the marking vertices in view (> 1 = the texture out-resolves the screen)
    const eye = new THREE.Vector3().setFromMatrixPosition(base.matrixWorld);
    const pos = mk.geometry.attributes.position, v = new THREE.Vector3(), ds = [];
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(base.projectionMatrix, base.matrixWorldInverse));
    for (let i = 0; i < pos.count; i += 7) { v.fromBufferAttribute(pos, i).applyMatrix4(mk.matrixWorld); if (fr.containsPoint(v)) ds.push(eye.distanceTo(v)); }
    ds.sort((p, q) => p - q);
    const dist = ds.length ? ds[ds.length >> 1] : 0;
    const screenPxPerM = H / (2 * dist * Math.tan(base.fov * Math.PI / 360));

    a.benchNoAdapt = false;
    return { pixels: mask.length, good, bad, floor, ideal, dist, screenPxPerM, W, H };
  }, sp);
  if (out) await page.screenshot({ path: path.join(out, `shimmer_${sp.name.replace(/[^a-z]+/gi, '_')}.png`) });
  rows.push({ ...sp, ...r });
}
let fail = 0;
console.log('halo markings: shimmer under sub-pixel camera motion (mean residual after motion compensation, 0..1 luminance)');
console.log('  game = as rendered (mipmaps + anisotropic filtering), ideal = 16x supersampled reference, unfiltered = no mipmaps');
for (const r of rows) {
  // pass: within 25 % (or 0.006) of the supersampled ideal, and clearly better than unfiltered
  const ok = r.pixels > 50 && r.good <= Math.max(r.ideal * 1.25, r.ideal + 0.006) && r.good < r.bad * 0.6;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(16)} ${String(r.pixels).padStart(5)} px  game ${r.good.toFixed(4)}  ideal ${r.ideal.toFixed(4)}  unfiltered ${r.bad.toFixed(4)}  bare halo ${r.floor.toFixed(4)}  | texture 4600 px/m vs screen ${r.screenPxPerM.toFixed(0)} px/m (${(r.screenPxPerM * 2).toFixed(0)} at 2x) at ${r.dist.toFixed(2)} m`);
}
if (errors.length) { console.log('page errors:', errors.slice(0, 3).join(' | ')); fail++; }
await browser.close(); srv.kill();
process.exit(fail ? 1 : 0);

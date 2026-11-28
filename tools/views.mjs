// Inspection screenshots: fixed cameras anywhere on the circuit (lap position s, lateral
// offset d (+ = left of the driving direction), height h, looking at another (s, d, h)), or the
// in-game cameras following the car at a lap position.
//   node tools/views.mjs <outdir> [view names or "all"]
// env: Q (quality tier, default high), W/H (viewport), PORT
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const out = process.argv[2] || '.';
const want = (process.argv[3] || 'all').split(',');
const W = +(process.env.W || 956), H = +(process.env.H || 440), PORT = +(process.env.PORT || 8771);
fs.mkdirSync(out, { recursive: true });

// fixed views: [s or corner+offset, d, h] -> look [s, d, h]; car: car-follow camera at s
export const VIEWS = {
  // start / finish straight (Boulevard Albert 1er) – the user's first screenshot
  'start-straight-tcam': { car: { at: 'spawn', d: 'spawn' }, cam: 'tcam' },
  'start-straight-chase': { car: { at: 'spawn', d: 'spawn' }, cam: 'chase' },
  'start-straight-high': { from: ['spawn', -30, 4, 14], to: ['spawn', 120, 0, 2], fov: 60 },
  // the previous start position (55 m before the line) for before / after comparisons
  // grandstands seen from the track (terrace side walls, canopy, fascia) and from behind
  'stand-start-road': { from: ['spawn', -6, -3, 1.6], to: ['spawn', 14, 18, 7], fov: 62 },
  'stand-start-behind': { from: ['spawn', 30, 48, 18], to: ['spawn', 0, 12, 6], fov: 55 },
  'start-old-spawn-tcam': { car: { at: ['noghes', 88], d: 1.6 }, cam: 'tcam' },
  'start-old-spawn-chase': { car: { at: ['noghes', 88], d: 1.6 }, cam: 'chase' },
  // Mirabeau approach (downhill from the Casino)
  'mirabeau-approach': { car: { at: ['mirabeau', -70], d: 0 }, cam: 'tcam' },
  'mirabeau-high': { from: ['mirabeau', -90, 0, 12], to: ['mirabeau', 10, 0, 0], fov: 60 },
  'hairpin-high': { from: ['hairpin', -60, 6, 14], to: ['hairpin', 10, 0, 0], fov: 60 },
  // Portier and the tunnel
  'portier-exit-tcam': { car: { at: ['portier', 25], d: 0 }, cam: 'tcam' },
  'tunnel-entry-tcam': { car: { at: 'tunnel+(-25)', d: 1 }, cam: 'tcam' },
  'tunnel-entry-outside': { from: ['tunnel', -28, 0, 3], to: ['tunnel', 6, 0, 4], fov: 60 },
  'tunnel-portal-zoom': { from: ['tunnel', -22, 0, 4], to: ['tunnel', 0, 0, 7], fov: 32 },
  'fairmont-top': { from: ['tunnel', 150, 0, 520], to: ['tunnel', 151, 0, 0], fov: 45 },
  'fairmont-left': { from: ['tunnel', 60, 120, 40], to: ['tunnel', 110, 0, 10], fov: 55 },
  'fairmont-right': { from: ['tunnel', 60, -120, 40], to: ['tunnel', 110, 0, 10], fov: 55 },
  'tunnel-mid-tcam': { car: { at: 'tunnel+120', d: 1 }, cam: 'tcam' },
  'tunnel-mid-chase': { car: { at: 'tunnel+150', d: 1 }, cam: 'chase' },
  'tunnel-mid-cockpit': { car: { at: 'tunnel+200', d: 1 }, cam: 'cockpit' },
  'tunnel-ceiling': { from: ['tunnel', 90, -2, 1.2], to: ['tunnel', 115, 1, 5.2], fov: 70 },
  'tunnel-wall-left': { from: ['tunnel', 160, -3, 1.4], to: ['tunnel', 175, 6, 2.6], fov: 60 },
  'tunnel-exit-tcam': { car: { at: 'tunnelEnd+(-60)', d: 1 }, cam: 'tcam' },
  'tunnel-exit-outside': { from: ['tunnelEnd', 50, 1, 4], to: ['tunnelEnd', -20, 0, 3], fov: 60 },
  // chicane approach after the tunnel – the user's screenshot
  'chicane-approach-tcam': { car: { at: ['chicane', -120], d: 0 }, cam: 'tcam' },
  // Tabac and the swimming pool – the user's screenshot
  'tabac-tcam': { car: { at: ['tabac', -60], d: 0 }, cam: 'tcam' },
  'pool-tcam': { car: { at: ['pool1', -50], d: 0 }, cam: 'tcam' },
  'pool-high': { from: ['pool1', -60, 10, 16], to: ['pool2', 0, -10, 0], fov: 60 },
  'rascasse-tcam': { car: { at: ['rascasse', -60], d: 0 }, cam: 'tcam' },
  'ste-devote-tcam': { car: { at: ['ste-devote', -80], d: 0 }, cam: 'tcam' },
  'beau-rivage-tcam': { car: { at: ['beau-rivage', -40], d: 0 }, cam: 'tcam' },
  'casino-tcam': { car: { at: ['casino', -60], d: 0 }, cam: 'tcam' },
  // mirrors (real-time reflections): onboard cameras and zooms on each glass from the eye
  // road surface: braking rubber / lock-up marks, exit traction lines, patches and covers
  'road-ste-devote-brake': { from: ['ste-devote', -75, 0.5, 1.5], to: ['ste-devote', -25, 0, 0], fov: 58 },
  'road-chicane-brake': { from: ['chicane', -95, 0, 1.4], to: ['chicane', -35, 0, 0], fov: 58 },
  'road-chicane-top': { from: ['chicane', -45, 0, 22], to: ['chicane', -44, 0, 0], fov: 50 },
  'road-hairpin-exit': { from: ['hairpin', 18, 0, 2.2], to: ['hairpin', 60, 0, 0], fov: 58 },
  'road-casino-close': { from: ['casino', -45, 1.5, 0.9], to: ['casino', -33, -0.5, 0], fov: 52 },
  'road-mirabeau-top': { from: ['mirabeau', -35, 0, 26], to: ['mirabeau', -34, 0, 0], fov: 50 },
  'kerb-pool-close': { from: ['pool1', -22, 0, 1.1], to: ['pool1', 2, 0, 0], fov: 55 },
  'kerb-rascasse-close': { from: ['rascasse', -18, 0, 1.1], to: ['rascasse', 4, 0, 0], fov: 55 },
  'mirrors-cockpit': { car: { at: ['ste-devote', 30], d: 0 }, cam: 'cockpit' },
  'mirrors-tcam': { car: { at: ['ste-devote', 30], d: 0 }, cam: 'tcam' },
  'mirror-left-zoom': { carRel: { at: ['ste-devote', 30], d: 0, eye: [0, 0.728, -0.476], look: [-0.515, 0.668, -0.816], fov: 18 } },
  'mirror-right-zoom': { carRel: { at: ['ste-devote', 30], d: 0, eye: [0, 0.728, -0.476], look: [0.515, 0.668, -0.816], fov: 18 } },
  'mirrors-chase-close': { carRel: { at: ['ste-devote', 30], d: 0, eye: [1.1, 1.25, 1.6], look: [0.2, 0.62, -0.7], fov: 34 } },
  'mirror-right-outside': { carRel: { at: ['ste-devote', 30], d: 0, eye: [1.05, 0.95, 0.10], look: [0.515, 0.668, -0.816], fov: 30 } },
  'mirror-right-front': { carRel: { at: ['ste-devote', 30], d: 0, eye: [1.0, 0.85, -1.85], look: [0.515, 0.65, -0.816], fov: 30 } },
  'mirrors-tunnel-cockpit': { car: { at: 'tunnel+160', d: 1 }, cam: 'cockpit' },
  // the car in direct sun and in the tunnel, onboard and from outside
  'sun-cockpit': { car: { at: ['casino', -60], d: 0 }, cam: 'cockpit' },
  'sun-chase': { car: { at: ['casino', -60], d: 0 }, cam: 'chase' },
  'sun-ext-34': { carRel: { at: ['beau-rivage', -40], d: 0, eye: [-4.2, 1.5, -5.2], look: [0, 0.45, -0.6], fov: 34 } },
  'sun-ext-rear34': { carRel: { at: ['beau-rivage', -40], d: 0, eye: [3.6, 1.7, 5.4], look: [0, 0.55, 0.2], fov: 34 } },
  'tunnel-cockpit': { car: { at: 'tunnel+150', d: 1 }, cam: 'cockpit' },
  'tunnel-ext-34': { carRel: { at: 'tunnel+150', d: 1, eye: [-3.6, 1.4, -4.8], look: [0, 0.45, -0.6], fov: 36 } },
  'shadow-ext-34': { carRel: { at: ['mirabeau', -60], d: 0, eye: [-4.2, 1.5, -5.2], look: [0, 0.45, -0.6], fov: 34 } },
  // halo
  'halo-tcam': { car: { at: 'spawn', d: 'spawn' }, cam: 'tcam' },
  'halo-cockpit': { car: { at: 'spawn', d: 'spawn' }, cam: 'cockpit' },
};

const srv = spawn(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 400));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: devices['iPhone 15 Pro Max'].userAgent });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', e => logs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
await page.goto(`http://localhost:${PORT}/?start=drive&noaudio=1&q=${process.env.Q || 'high'}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });

for (const [name, v] of Object.entries(VIEWS)) {
  if (!want.includes('all') && !want.includes(name)) continue;
  await page.evaluate(([v]) => {
    const a = window.__app, T = a.track;
    const resolve = (ref) => {
      if (ref === 'spawn') return T.spawnS;
      if (typeof ref === 'string' && ref.startsWith('tunnelEnd')) return T.wrapS(T.tunnelS[1] + (+(ref.match(/\(([-0-9.]+)\)/) || [0, 0])[1]));
      if (typeof ref === 'string' && ref.startsWith('tunnel+')) { const m = ref.match(/tunnel\+\(?([-0-9.]+)\)?/); return T.wrapS(T.tunnelS[0] + (+m[1])); }
      if (ref === 'tunnel') return T.tunnelS[0];
      if (ref === 'tunnelEnd') return T.tunnelS[1];
      if (Array.isArray(ref)) return T.wrapS(T.corners.find(c => c.id === ref[0]).s + ref[1]);
      return T.wrapS(T.corners.find(c => c.id === ref).s);
    };
    a.freeCam = null;
    if (v.carRel) {
      const s = resolve(v.carRel.at);
      a.veh.reset(s, v.carRel.d, { speed: 0 }); a.timing.teleport(a.veh.s);
      a.__autoOverride = false; a.controls.enabled = false; a.controls.clear();
      // the camera is attached once the car has settled on the road (next evaluate)
      a.__carRel = v.carRel;
    } else if (v.car) {
      const s = resolve(v.car.at);
      a.veh.reset(s, v.car.d === 'spawn' ? (T.spawnD ?? 1.6) : v.car.d, { speed: 0 });
      a.timing.teleport(a.veh.s);
      a.rig.setMode(v.cam); a.rig.chaseInit = false;
      a.__autoOverride = false; a.controls.enabled = false; a.controls.clear();
    } else {
      const base = (r) => { const s0 = resolve(r[0]); return T.wrapS(s0 + r[1]); };
      const sF = base(v.from), sT = base(v.to);
      const pf = T.pointAt(sF, v.from[2]), pt = T.pointAt(sT, v.to[2]);
      a.freeCam = { pos: [pf.x, pf.y + v.from[3], pf.z], look: [pt.x, pt.y + v.to[3], pt.z], fov: v.fov };
      a.veh.reset(T.wrapS(sF + 25), 0, { speed: 0 });
    }
    a.lightS = null;
  }, [v]);
  if (v.carRel) {
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const a = window.__app, c = a.__carRel;
      a.car.root.updateMatrixWorld(true);
      const M = a.car.chassis.matrixWorld;
      const e = new a.THREE.Vector3(...c.eye).applyMatrix4(M), l = new a.THREE.Vector3(...c.look).applyMatrix4(M);
      a.freeCam = { pos: [e.x, e.y, e.z], look: [l.x, l.y, l.z], fov: c.fov };
    });
  }
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  process.stdout.write(name + ' ');
}
console.log('\n' + logs.slice(0, 30).join('\n'));
await browser.close(); srv.kill();

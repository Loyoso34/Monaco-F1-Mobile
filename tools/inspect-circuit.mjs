// Runs the automated circuit inspection (tools/inspect-lib.js) in headless Chromium for each
// graphics tier and prints a report. Exit code 1 if any check fails.
//   node tools/inspect-circuit.mjs [tiers=high,medium,low] [out.json]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const tiers = (process.argv[2] || 'high,medium,low').split(',');
const outFile = process.argv[3];
const PORT = +(process.env.PORT || 8772);
const srv = spawn(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 400));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const all = {};
let ok = true;
for (const q of tiers) {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://localhost:${PORT}/?start=drive&noaudio=1&norender=1&q=${q}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  const t0 = Date.now();
  const rep = await page.evaluate(async () => {
    const lib = await import('/tools/inspect-lib.js');
    return lib.inspectCircuit(window.__app);
  });
  rep.ms = Date.now() - t0;
  rep.pageErrors = errs;
  all[q] = rep;
  ok = ok && rep.pass && errs.length === 0;
  const line = (k, v) => console.log(`  ${k.padEnd(11)} ${v}`);
  console.log(`[${q}] ${rep.pass ? 'PASS' : 'FAIL'}  (${rep.ms} ms)`);
  line('raster', `${rep.raster.holes} holes in ${rep.raster.points} circuit points`);
  line('track', `${rep.track.onOtherSection} barrier points on another section (${rep.track.barrierPoints} checked)`);
  line('terrain', `${rep.terrain.penetrations} penetrations, worst ${rep.terrain.worstAboveRoad} m (${rep.terrain.samplesUnderCircuit} samples under the circuit)`);
  line('objects', `${rep.objects.inDrivableVolume} points in the drivable volume (${rep.objects.triangles} triangles, ${rep.objects.nearCircuit} near the circuit, ${rep.objects.samplePoints} samples)`);
  line('pavement', `${rep.pavement.buildingPointsOnPavement} building points on pavements`);
  line('footprints', `${rep.footprints.overlappingPairs} overlapping pairs of ${rep.footprints.count}`);
  line('bases', `${rep.bases.floating} floating buildings of ${rep.bases.buildings} (worst gap ${rep.bases.worstGap} m)`);
  for (const k of ['raster', 'track', 'terrain', 'objects', 'pavement', 'footprints', 'bases']) {
    if (rep[k].examples && rep[k].examples.length) console.log(`    ${k} examples: ${JSON.stringify(rep[k].examples.slice(0, 6))}`);
  }
  if (errs.length) console.log('  page errors:', errs.slice(0, 5));
  // self-test: plant a 4 m box on the racing line at Tabac and lift one terrain vertex through
  // the road at Mirabeau; the inspection must report both
  if (q === tiers[0]) {
    const st = await page.evaluate(async () => {
      const lib = await import('/tools/inspect-lib.js');
      const a = window.__app, T = a.track, THREE = a.THREE;
      const c = T.corners.find(c => c.id === 'tabac'), p = T.pointAt(c.s - 30, 0.5);
      const box = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), new THREE.MeshBasicMaterial());
      box.position.set(p.x, p.y + 2, p.z); box.name = 'selftest'; a.sc.root.add(box);
      const terr = a.sc.root.getObjectByName('terrain'), pos = terr.geometry.attributes.position;
      const m = T.pointAt(T.corners.find(c => c.id === 'mirabeau').s - 20, 0);
      let best = -1, bd = 1e9;
      for (let i = 0; i < pos.count; i++) { const d = Math.hypot(pos.getX(i) - m.x, pos.getZ(i) - m.z); if (d < bd) { bd = d; best = i; } }
      const old = pos.getY(best); pos.setY(best, m.y + 3);
      const r = lib.inspectCircuit(a);
      pos.setY(best, old); a.sc.root.remove(box);
      return { objects: r.objects.inDrivableVolume, near: r.objects.examples[0] && r.objects.examples[0].near, terrain: r.terrain.penetrations, pass: r.pass };
    });
    const caught = st.objects > 0 && st.terrain > 0 && !st.pass;
    console.log(`  self-test   ${caught ? 'OK' : 'FAILED'} – planted box -> ${st.objects} points (${st.near}), raised terrain -> ${st.terrain} penetrations`);
    ok = ok && caught;
    all.selftest = st;
  }
  await page.close();
}
if (outFile) fs.writeFileSync(outFile, JSON.stringify(all, null, 1));
await browser.close(); srv.kill();
process.exit(ok ? 0 : 1);

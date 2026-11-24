// Renders the loading image and the corner thumbnails from the playable track and writes them
// as lightweight WebP files to assets/.  node tools/capture.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
import { spawn, execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tmp = fs.mkdtempSync('/tmp/mcshots-');
const srv = spawn(process.execPath, [path.join(root, 'tools/serve.mjs'), '8769'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 400));
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const shots = (process.argv[2] || 'loading,corner-ste-devote,corner-casino,corner-hairpin,corner-tunnel,corner-pool').split(',');
for (const name of shots) {
  const big = name === 'loading';
  const page = await b.newPage({ viewport: { width: big ? 1280 : 800, height: big ? 720 : 450 } });
  page.on('pageerror', e => console.log('err', e.message));
  await page.goto(`http://localhost:8769/?shot=${name}&noaudio=1&q=high`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await page.waitForTimeout(300);
  const png = path.join(tmp, name + '.png');
  await page.screenshot({ path: png });
  await page.close();
  const out = path.join(root, 'assets', name + '.webp');
  execFileSync('python3', ['-I', '-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
w = 1280 if sys.argv[3] == '1' else 480
im = im.resize((w, int(w * im.height / im.width)), Image.LANCZOS)
im.save(sys.argv[2], 'WEBP', quality=62 if sys.argv[3] == '1' else 58, method=6)
`, png, out, big ? '1' : '0']);
  console.log(name, fs.statSync(out).size, 'bytes');
}
await b.close(); srv.kill();

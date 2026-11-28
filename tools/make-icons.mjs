// Renders the app icon from the in-game RB20 (tools/icon.html) and writes the icon set:
// icons/icon-1024.png (master), icon-512.png, icon-192.png, icon-180.png (apple-touch-icon),
// icon-32.png (favicon). Opaque, square corners (iOS applies its own mask).
//   node tools/make-icons.mjs [query]      e.g. "fov=26&cx=-3.1"
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
import { spawn, execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tmp = fs.mkdtempSync('/tmp/icon-');
const srv = spawn(process.execPath, [path.join(root, 'tools/serve.mjs'), '8768'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 400));
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 2048, height: 2048 } });
page.on('pageerror', e => console.log('err', e.message));
await page.goto(`http://localhost:8768/tools/icon.html?${process.argv[2] || ''}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
const raw = path.join(tmp, 'raw.png');
await page.screenshot({ path: raw });
await b.close(); srv.kill();
execFileSync('python3', ['-I', path.join(root, 'tools/icon-post.py'), raw, path.join(root, 'icons')], { stdio: 'inherit' });

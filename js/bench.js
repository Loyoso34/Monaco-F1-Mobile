import { t } from './i18n.js';
// On-device benchmark (open the game with ?bench=1): the test driver laps Monaco from the
// start line in the selected camera with everything rendered (mirrors, shadows, the tunnel), and
// the frame times are recorded with the adaptive resolution switched off. A result panel then
// shows the device, the GPU (where the browser reports it), the render size, average FPS, the
// 1 % low, frame-time percentiles and the draw calls - the numbers to judge 60 FPS on a phone.
//   ?bench=1&cam=cockpit|tcam|chase&q=high|medium|low&laps=1&secs=150
const $ = (id) => document.getElementById(id);

export function startBench(app, { cam = 'tcam', laps = 1, secs = 150 } = {}) {
  const r = app.renderer, gl = r.getContext();
  let gpu = 'n/a';
  try { const ext = gl.getExtension('WEBGL_debug_renderer_info'); gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch (e) { /* not exposed */ }
  // the run ends when the requested number of laps has been completed (from the grid, the
  // first crossing only starts the lap)
  const target = app.timing.lapNo + laps + (app.timing.state === 'out' ? 1 : 0);
  const b = { t0: 0, frames: [], calls: [], tris: [], cam, laps, target, secs, done: false, warm: 0, gpu };
  app.bench = b;
  app.__autoOverride = true;
  app.rig.setMode(cam);
  app.benchNoAdapt = true;                    // fixed resolution while measuring
  return b;
}

// call once per rendered frame with the frame interval (ms)
export function benchFrame(app, dtMs) {
  const b = app.bench;
  if (!b || b.done) return;
  if (b.warm < 90) { b.warm++; return; }      // skip shader warm-up / first second
  if (!b.t0) b.t0 = performance.now();
  b.frames.push(dtMs);
  const info = app.renderer.info.render;
  b.calls.push(info.calls); b.tris.push(info.triangles);
  // stop after the requested laps or the time limit
  if (app.timing.lapNo >= b.target || performance.now() - b.t0 > b.secs * 1000) finish(app);
}

function pct(a, p) { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }

function finish(app) {
  const b = app.bench; b.done = true;
  app.__autoOverride = false;
  const f = b.frames, n = f.length, tot = f.reduce((x, y) => x + y, 0);
  const sorted = f.slice().sort((x, y) => y - x);
  const worst1 = sorted.slice(0, Math.max(1, Math.floor(n * 0.01)));
  const low1 = 1000 / (worst1.reduce((x, y) => x + y, 0) / worst1.length);
  const c = app.renderer.domElement;
  const res = {
    device: navigator.userAgent, gpu: b.gpu,
    render: `${c.width} x ${c.height} px (pixel ratio ${app.renderer.getPixelRatio().toFixed(2)})`,
    tier: app.perf.tierName, camera: b.cam, frames: n, seconds: +(tot / 1000).toFixed(1),
    avgFps: +(1000 * n / tot).toFixed(1), low1Fps: +low1.toFixed(1),
    p50ms: +pct(f, 0.5).toFixed(2), p95ms: +pct(f, 0.95).toFixed(2), p99ms: +pct(f, 0.99).toFixed(2),
    over20ms: +(100 * f.filter((x) => x > 20).length / n).toFixed(1),
    drawCalls: `${Math.round(pct(b.calls, 0.5))} median / ${Math.max(...b.calls)} max`,
    triangles: `${Math.round(pct(b.tris, 0.5) / 1000)}k median`,
  };
  b.result = res;
  window.__bench = res;
  const el = document.createElement('div');
  el.id = 'benchOut';
  el.style.cssText = 'position:absolute;z-index:90;left:50%;top:50%;transform:translate(-50%,-50%);max-width:88vw;max-height:84vh;overflow:auto;background:rgba(6,7,10,0.92);color:#e9eaee;border:1px solid rgba(255,255,255,0.15);border-radius:14px;padding:16px 18px;font:13px/1.45 -apple-system,Helvetica,Arial,sans-serif;white-space:pre-wrap;user-select:text;-webkit-user-select:text';
  el.textContent = t('bench.title') + '\n\n' + Object.entries(res).map(([k, v]) => `${k}: ${v}`).join('\n');
  document.body.appendChild(el);
  console.log('BENCH', JSON.stringify(res));
}

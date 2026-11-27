// Procedural textures for the circuit and the city (canvas-generated, no downloads).
import * as THREE from 'three';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function tex(c, { repeat = true, srgb = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

// Road paint (kerbs, edge lines, start / finish, grid boxes), one tile = 3 m like the asphalt:
// near-white paint film with pits where the aggregate shows through, rubber scuffs along the
// direction of travel and soft wear. Tinted by vertex colours (red / white kerb stripes).
export function roadPaint(size = 512) {
  const N = size, r = rng(555);
  const c = canvas(N, N), x = c.getContext('2d');
  const img = x.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    let v = 226 + (r() - 0.5) * 20;
    if (r() < 0.05) v -= 55 + r() * 80;                // aggregate pits through the paint
    img.data[i * 4] = img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v - 2; img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const wrapRect = (rx, ry, rw, rh) => { x.fillRect(rx, ry, rw, rh); if (ry + rh > N) x.fillRect(rx, ry - N, rw, rh); if (rx + rw > N) x.fillRect(rx - N, ry, rw, rh); };
  // rubber scuffs along the lap direction (v)
  for (let k = 0; k < 170; k++) { x.fillStyle = `rgba(28,28,30,${0.03 + r() * 0.08})`; wrapRect(r() * N, r() * N, 1 + r() * 3, 20 + r() * 130); }
  // soft wear / dirt
  for (let k = 0; k < 14; k++) {
    const gx = r() * N, gy = r() * N, rad = 30 + r() * 90;
    for (const [ox, oy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) {
      const g = x.createRadialGradient(gx + ox, gy + oy, 0, gx + ox, gy + oy, rad);
      g.addColorStop(0, 'rgba(70,70,72,0.10)'); g.addColorStop(1, 'rgba(70,70,72,0)');
      x.fillStyle = g; x.fillRect(gx + ox - rad, gy + oy - rad, rad * 2, rad * 2);
    }
  }
  return tex(c, { aniso: 8 });
}

// Street-circuit asphalt (one tile = 3 m): dense aggregate (2-9 mm stones of several greys) in
// a dark bitumen binder, fine sand, polished high spots; with a matching normal map (stone
// relief) and roughness map (binder rougher, polished stone tops smoother). Neutral grey: the
// road bands tint it with vertex colours.
export function asphaltSet(size = 1024) {
  const N = size, r = rng(1234);
  const h = new Float32Array(N * N), col = new Float32Array(N * N), rough = new Float32Array(N * N);
  // binder + sand
  for (let i = 0; i < N * N; i++) { const n = r(); col[i] = 0.25 + n * 0.07; h[i] = n * 0.15; rough[i] = 0.95; }
  // stones: soft-edged discs (wrap-around so the tile is seamless)
  const px = N / 3;                                  // pixels per metre
  const stones = Math.round(N * N * 0.0105);
  for (let k = 0; k < stones; k++) {
    const cx = r() * N, cy = r() * N;
    const rad = (0.0012 + Math.pow(r(), 2.2) * 0.0036) * px;     // 2.4 - 9.6 mm diameter
    const tone = r() < 0.16 ? 0.74 + r() * 0.16 : r() < 0.55 ? 0.50 + r() * 0.14 : 0.33 + r() * 0.10;
    const polish = r() < 0.35;
    const e = 0.75 + r() * 0.5;                      // elongation
    const ang = r() * Math.PI;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const R = Math.ceil(rad * 1.6);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const u = (dx * ca + dy * sa) / (rad * e), v = (-dx * sa + dy * ca) / rad;
      const d2 = u * u + v * v;
      if (d2 > 1) continue;
      const x = ((Math.floor(cx) + dx) % N + N) % N, y = ((Math.floor(cy) + dy) % N + N) % N, i = y * N + x;
      const top = Math.sqrt(1 - d2);
      col[i] = col[i] * (1 - top * 0.9) + tone * top * 0.9;
      h[i] = Math.max(h[i], 0.25 + top * 0.75);
      rough[i] = polish ? 0.62 + (1 - top) * 0.3 : 0.86;
    }
  }
  // fine speckle and a little oil darkening
  for (let i = 0; i < N * N; i++) { col[i] *= 0.94 + r() * 0.12; }
  const mk = (fill) => { const c = canvas(N, N), x = c.getContext('2d'); const img = x.createImageData(N, N); fill(img.data); x.putImageData(img, 0, 0); return c; };
  const mapC = mk((d) => { for (let i = 0; i < N * N; i++) { const v = Math.max(0, Math.min(255, col[i] * 255)); d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = Math.min(255, v + 4); d[i * 4 + 3] = 255; } });
  const nrmC = mk((d) => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const dx = h[y * N + (x + 1) % N] - h[y * N + (x - 1 + N) % N];
      const dy = h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x];
      const nx = -dx * 1.6, ny = dy * 1.6, l = Math.hypot(nx, ny, 1);
      d[i * 4] = (nx / l * 0.5 + 0.5) * 255; d[i * 4 + 1] = (ny / l * 0.5 + 0.5) * 255; d[i * 4 + 2] = (1 / l * 0.5 + 0.5) * 255; d[i * 4 + 3] = 255;
    }
  });
  const roughC = mk((d) => { for (let i = 0; i < N * N; i++) { const v = rough[i] * 255; d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255; } });
  return { map: tex(mapC, { aniso: 16 }), normalMap: tex(nrmC, { srgb: false, aniso: 16 }), roughnessMap: tex(roughC, { srgb: false, aniso: 16 }) };
}

// Low-frequency tileable value noise (grey), used to break up texture repetition at a 40 m scale.
export function macroNoise(size = 256) {
  const c = canvas(size, size), x = c.getContext('2d');
  const img = x.createImageData(size, size), r = rng(99);
  const grid = (n) => { const g = new Float32Array(n * n); for (let i = 0; i < n * n; i++) g[i] = r(); return g; };
  const octaves = [[4, 0.5], [8, 0.28], [16, 0.14], [32, 0.08]].map(([n, a]) => ({ n, a, g: grid(n) }));
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) for (let xx = 0; xx < size; xx++) {
    let v = 0;
    for (const o of octaves) {
      const fx = xx / size * o.n, fy = y / size * o.n, ix = Math.floor(fx), iy = Math.floor(fy), tx = smooth(fx - ix), ty = smooth(fy - iy);
      const G = (a, b) => o.g[((b % o.n) * o.n) + (a % o.n)];
      v += o.a * ((G(ix, iy) * (1 - tx) + G(ix + 1, iy) * tx) * (1 - ty) + (G(ix, iy + 1) * (1 - tx) + G(ix + 1, iy + 1) * tx) * ty);
    }
    const i = (y * size + xx) * 4, vv = Math.max(0, Math.min(255, v * 255));
    img.data[i] = img.data[i + 1] = img.data[i + 2] = vv; img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return tex(c, { srgb: false, aniso: 4 });
}

// Road-detail atlas (1024 x 1024, RGBA, premultiplied look): rows of
//   0: tyre streaks (rubber / braking) 1024 x 256 — long streak with broken texture
//   1: asphalt patches (2 variants) 512 x 256 each — darker newer asphalt, ragged edges
//   2: seam / crack sealant line 1024 x 128 and a manhole cover 256 + drain grate 256
export const ROAD_ATLAS = {
  streak: [0, 0, 1, 0.25], patchA: [0, 0.25, 0.5, 0.5], patchB: [0.5, 0.25, 1, 0.5],
  seam: [0, 0.5, 1, 0.625], manhole: [0, 0.625, 0.25, 0.875], grate: [0.25, 0.625, 0.5, 0.875], lock: [0.5, 0.625, 1, 0.875],
};
export function roadDetailAtlas() {
  const S = 1024, c = canvas(S, S), x = c.getContext('2d'), r = rng(4321);
  x.clearRect(0, 0, S, S);
  // atlas rows use canvas y from the top: v (flipY) = 1 - y / S
  const rect = (k) => { const [u0, v0, u1, v1] = ROAD_ATLAS[k]; return [u0 * S, (1 - v1) * S, (u1 - u0) * S, (v1 - v0) * S]; };
  // tyre streak: dark rubber, density varying along the length, frayed edges
  {
    const [X, Y, W, H] = rect('streak');
    const g = x.createLinearGradient(0, Y, 0, Y + H);
    g.addColorStop(0, 'rgba(12,12,14,0)'); g.addColorStop(0.22, 'rgba(12,12,14,0.16)'); g.addColorStop(0.5, 'rgba(10,10,12,0.34)'); g.addColorStop(0.78, 'rgba(12,12,14,0.16)'); g.addColorStop(1, 'rgba(12,12,14,0)');
    x.fillStyle = g; x.fillRect(X, Y, W, H);
    // rubber grain: thin longitudinal scrubs, denser in the middle of the tyre path
    for (let k = 0; k < 5200; k++) {
      const t = r(), off = (r() + r() + r() - 1.5) / 1.5;      // ~triangular across the path
      const yy = Y + H * (0.5 + off * 0.42);
      x.fillStyle = `rgba(10,10,12,${(0.04 + r() * 0.10) * (1 - Math.abs(off) * 0.7)})`;
      x.fillRect(X + t * W, yy, 6 + r() * 46, 0.6 + r() * 1.6);
    }
    // lighter gaps where the deposit is broken
    for (let k = 0; k < 220; k++) { x.clearRect(X + r() * W, Y + H * (0.15 + r() * 0.7), 2 + r() * 10, 1 + r() * 2); }
  }
  // patch A: saw-cut repair of fresher, finer asphalt (slightly darker), bitumen-sealed joint
  {
    const [X, Y, W, H] = rect('patchA');
    const pad = 10, x0 = X + pad, y0 = Y + pad, w = W - 2 * pad, h = H - 2 * pad;
    x.fillStyle = 'rgba(22,22,25,0.30)'; x.fillRect(x0, y0, w, h);
    for (let i = 0; i < 5200; i++) {
      const v = 30 + r() * 70; x.fillStyle = `rgba(${v},${v},${v + 3},${0.10 + r() * 0.18})`;
      x.fillRect(x0 + r() * w, y0 + r() * h, 1 + r() * 2, 1 + r() * 2);
    }
    // wear on the patch along the tyre paths (lighter)
    x.fillStyle = 'rgba(120,120,124,0.06)'; x.fillRect(x0, y0 + h * 0.18, w, h * 0.16); x.fillRect(x0, y0 + h * 0.64, w, h * 0.16);
    // sealant joint: slightly wavy black band over the saw cut, overbanded onto the old surface
    x.lineJoin = 'round';
    for (const [lw, a] of [[9, 0.28], [4, 0.75]]) {
      x.strokeStyle = `rgba(8,8,10,${a})`; x.lineWidth = lw; x.beginPath();
      const pts = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]];
      for (let k = 0; k <= 4; k++) {
        const [ax, ay] = pts[k % 4], [bx, by] = pts[(k + 1) % 4];
        for (let j = 0; j < 12; j++) { const t = j / 12, jx = (r() - 0.5) * 2.2, jy = (r() - 0.5) * 2.2; const px = ax + (bx - ax) * t + jx, py = ay + (by - ay) * t + jy; if (k === 0 && j === 0) x.moveTo(px, py); else x.lineTo(px, py); }
      }
      x.stroke();
    }
  }
  // patch B: crack-sealed area ("tar snakes"): branching bitumen lines over a slightly lighter,
  // older surface
  {
    const [X, Y, W, H] = rect('patchB');
    x.save(); x.beginPath(); x.rect(X + 4, Y + 4, W - 8, H - 8); x.clip();
    const fade = x.createRadialGradient(X + W / 2, Y + H / 2, 10, X + W / 2, Y + H / 2, W * 0.52);
    fade.addColorStop(0, 'rgba(150,150,152,0.07)'); fade.addColorStop(1, 'rgba(150,150,152,0)');
    x.fillStyle = fade; x.fillRect(X, Y, W, H);
    const snake = (sx, sy, ang, len, wid, depth) => {
      x.strokeStyle = 'rgba(6,6,8,0.82)'; x.lineWidth = wid; x.lineCap = 'round'; x.lineJoin = 'round';
      x.beginPath(); x.moveTo(sx, sy);
      let px = sx, py = sy, a = ang;
      for (let k = 0; k < len; k++) {
        a += (r() - 0.5) * 0.7; px += Math.cos(a) * 7; py += Math.sin(a) * 7; x.lineTo(px, py);
        if (depth < 2 && r() < 0.05) { x.stroke(); snake(px, py, a + (r() < 0.5 ? 1 : -1) * (0.6 + r() * 0.6), Math.floor(len * 0.4), wid * 0.75, depth + 1); x.strokeStyle = 'rgba(6,6,8,0.82)'; x.lineWidth = wid; x.beginPath(); x.moveTo(px, py); }
      }
      x.stroke();
    };
    snake(X + 18, Y + H * 0.5, 0, 70, 4.5, 0);
    snake(X + W * 0.3, Y + 14, Math.PI / 2, 30, 3.5, 1);
    snake(X + W * 0.7, Y + H - 14, -Math.PI / 2, 28, 3.5, 1);
    x.restore();
  }
  // seam: bitumen sealant line with a wobble
  {
    const [X, Y, W, H] = rect('seam');
    x.strokeStyle = 'rgba(8,8,10,0.85)'; x.lineWidth = H * 0.22; x.lineCap = 'round';
    x.beginPath(); x.moveTo(X, Y + H / 2);
    for (let i = 1; i <= 40; i++) x.lineTo(X + W * i / 40, Y + H / 2 + (r() - 0.5) * H * 0.18);
    x.stroke();
    x.strokeStyle = 'rgba(8,8,10,0.35)'; x.lineWidth = H * 0.5; x.stroke();
  }
  // manhole cover: cast iron disc with a radial / ring pattern
  {
    const [X, Y, W, H] = rect('manhole');
    const cx = X + W / 2, cy = Y + H / 2, R = W * 0.46;
    x.fillStyle = 'rgba(48,49,52,1)'; x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(90,92,96,1)'; x.lineWidth = 6; x.stroke();
    x.strokeStyle = 'rgba(28,28,30,1)'; x.lineWidth = 3;
    for (let k = 1; k <= 4; k++) { x.beginPath(); x.arc(cx, cy, R * k / 5, 0, Math.PI * 2); x.stroke(); }
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; x.beginPath(); x.moveTo(cx + Math.cos(a) * R * 0.2, cy + Math.sin(a) * R * 0.2); x.lineTo(cx + Math.cos(a) * R * 0.95, cy + Math.sin(a) * R * 0.95); x.stroke(); }
    x.fillStyle = 'rgba(70,72,76,1)'; x.font = `700 ${Math.round(W * 0.1)}px Arial`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('MONACO', cx, cy);
  }
  // drain grate: slotted steel frame
  {
    const [X, Y, W, H] = rect('grate');
    x.fillStyle = 'rgba(40,41,44,1)'; x.fillRect(X + W * 0.25, Y + H * 0.05, W * 0.5, H * 0.9);
    x.fillStyle = 'rgba(8,8,9,1)';
    for (let k = 0; k < 9; k++) x.fillRect(X + W * 0.29, Y + H * (0.1 + k * 0.095), W * 0.42, H * 0.05);
    x.strokeStyle = 'rgba(96,98,102,1)'; x.lineWidth = 4; x.strokeRect(X + W * 0.25, Y + H * 0.05, W * 0.5, H * 0.9);
  }
  // lock-up flat-spot mark: short dense black smudge
  {
    const [X, Y, W, H] = rect('lock');
    for (let k = 0; k < 1600; k++) {
      const t = Math.pow(r(), 0.8); const yy = Y + H * (0.28 + r() * 0.44);
      const a = (t < 0.06 ? t / 0.06 : 1 - (t - 0.06) / 0.94 * 0.85) * (0.12 + r() * 0.3);
      x.fillStyle = `rgba(6,6,8,${a})`;
      x.fillRect(X + t * W, yy, 6 + r() * 22, 1 + r() * 3);
    }
  }
  const t = tex(c, { repeat: false, aniso: 8 });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Armco guard-rail: three stacked galvanised W-beams (0.31 m each, 0.10 - 1.03 m above the
// road) on posts every 2 m, splice bolts every 4 m. One tile = 4 m x 1.10 m (-0.05 .. 1.05 m),
// 1024 x 128. The geometry gives each rail its lit upper / shaded lower half; the texture adds
// the W valley, the lips, bolts, spangle, road grime at the foot and black tyre rubbings.
const ARMCO_Y = (h) => (1.05 - h) / 1.10 * 128;          // height (m) -> texel row
export function armco(seed = 41, { dirt = 1 } = {}) {
  const W = 1024, H = 128, c = canvas(W, H), x = c.getContext('2d'), r = rng(seed);
  // ground gap under the rails: posts and their shadow
  x.fillStyle = '#2c2f33'; x.fillRect(0, 0, W, H);
  for (let p = 0; p < 2; p++) { x.fillStyle = '#4a4e54'; x.fillRect(p * 512 + 241, 0, 30, H); x.fillStyle = '#383b40'; x.fillRect(p * 512 + 241, 0, 6, H); }
  for (let i = 0; i < 3; i++) {
    const y0 = ARMCO_Y(0.41 + 0.31 * i), y1 = ARMCO_Y(0.10 + 0.31 * i), h = y1 - y0;
    // W profile across the rail: lip, upper ridge, valley, lower ridge, lip
    const g = x.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0.00, '#8d9399'); g.addColorStop(0.05, '#dfe3e6'); g.addColorStop(0.16, '#eef0f1');
    g.addColorStop(0.36, '#a9afb5'); g.addColorStop(0.48, '#7b8187'); g.addColorStop(0.56, '#c9ced2');
    g.addColorStop(0.70, '#d6dadd'); g.addColorStop(0.88, '#8f959b'); g.addColorStop(0.96, '#6d7378'); g.addColorStop(1.00, '#3a3d41');
    x.fillStyle = g; x.fillRect(0, y0, W, h);
    // galvanised spangle: soft lighter / darker flakes
    for (let k = 0; k < 900; k++) {
      const v = r() < 0.5 ? 255 : 60;
      x.fillStyle = `rgba(${v},${v},${v},${0.025 + r() * 0.05})`;
      x.fillRect(r() * W, y0 + r() * h, 3 + r() * 14, 1 + r() * 3);
    }
    // splice (overlap of two rail lengths) every 4 m: a darker edge and two rows of bolts
    x.fillStyle = 'rgba(0,0,0,0.30)'; x.fillRect(0, y0, 3, h); x.fillRect(W - 2, y0, 2, h);
    for (const bx of [10, 24, 38, W - 30, W - 16]) for (const fy of [0.22, 0.74]) bolt(x, bx, y0 + h * fy, 2.6);
    // post bolt every 2 m (in the valley)
    for (const px of [256, 768]) bolt(x, px, y0 + h * 0.5, 3.0);
  }
  // road grime splashed up the foot of the barrier, black tyre rubbing along the lower rails
  const grime = x.createLinearGradient(0, ARMCO_Y(0.55), 0, ARMCO_Y(0.0));
  grime.addColorStop(0, 'rgba(70,62,52,0)'); grime.addColorStop(1, `rgba(70,62,52,${0.42 * dirt})`);
  x.fillStyle = grime; x.fillRect(0, ARMCO_Y(0.55), W, ARMCO_Y(0.0) - ARMCO_Y(0.55));
  for (let k = 0; k < 7 * dirt; k++) {
    const yy = ARMCO_Y(0.18 + r() * 0.4), len = 40 + r() * 260, x0 = r() * (W - len);
    for (let j = 0; j < 14; j++) {
      x.fillStyle = `rgba(14,14,16,${0.05 + r() * 0.14})`;
      x.fillRect(x0 + r() * len * 0.3, yy + (r() - 0.5) * 7, len * (0.4 + r() * 0.6), 1 + r() * 2.5);
    }
  }
  return tex(c, { aniso: 8 });
}
function bolt(x, cx, cy, rad) {
  x.fillStyle = 'rgba(30,32,35,0.85)'; x.beginPath(); x.arc(cx, cy, rad, 0, Math.PI * 2); x.fill();
  x.fillStyle = 'rgba(240,242,244,0.55)'; x.beginPath(); x.arc(cx - rad * 0.3, cy - rad * 0.35, rad * 0.45, 0, Math.PI * 2); x.fill();
}

// Advertising banners stretched over the barriers (generic names, no real brands). One tile =
// 16 m x 1.10 m = four 4 m panels on a 1024 x 128 canvas: the artwork is drawn 0.55x wide so
// it keeps its proportions on the 4 m x 1.1 m panel (64 px/m along, 116 px/m up).
const AD_SETS = [
  [['#0b2a5b', '#ffffff', 'MONTE-CARLO', 'bar'], ['#ffffff', '#c8102e', 'GRAND PRIX', 'chev'], ['#c8102e', '#ffffff', 'RIVIERA', 'dot'], ['#101010', '#ffc20e', 'HERCULE MARINE', 'bar']],
  [['#00704a', '#ffffff', 'AZUR', 'dot'], ['#f2f2f2', '#0b2a5b', 'PRINCIPAUTÉ', 'bar'], ['#202a44', '#ffffff', 'NOVA', 'chev'], ['#ffc20e', '#101010', 'SOLARIS', 'dot']],
  [['#e10b2a', '#ffffff', 'VELOCE', 'chev'], ['#111418', '#ffffff', 'CORSA', 'bar'], ['#ffffff', '#00704a', 'AZURA', 'dot'], ['#0b2a5b', '#ffc20e', 'MONACO 2024', 'chev']],
];
export function adWall(set = 0) {
  const W = 1024, H = 128, c = canvas(W, H), x = c.getContext('2d');
  const ads = AD_SETS[set % AD_SETS.length];
  const w = W / 4, top = ARMCO_Y(1.03), bot = ARMCO_Y(0.06);
  x.fillStyle = '#2c2f33'; x.fillRect(0, 0, W, H);                 // gap under the banner
  for (let i = 0; i < 4; i++) {
    const [bg, fg, t, mark] = ads[i];
    const x0 = i * w;
    x.fillStyle = bg; x.fillRect(x0, top, w, bot - top);
    // a simple graphic device beside the name (stripes / chevron / disc)
    x.save(); x.translate(x0 + w / 2, (top + bot) / 2); x.scale(0.55, 1);
    x.fillStyle = fg;
    let tw;
    x.font = 'italic 900 58px "Helvetica Neue", "Arial Black", Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    tw = Math.min(x.measureText(t).width, (w - 40) / 0.55 - 70);
    const k = tw / x.measureText(t).width;
    if (mark === 'bar') { x.fillRect(-tw / 2 - 52, -22, 12, 44); x.fillRect(-tw / 2 - 34, -22, 12, 44); }
    else if (mark === 'chev') { x.beginPath(); x.moveTo(-tw / 2 - 58, -24); x.lineTo(-tw / 2 - 30, 0); x.lineTo(-tw / 2 - 58, 24); x.lineTo(-tw / 2 - 44, 24); x.lineTo(-tw / 2 - 16, 0); x.lineTo(-tw / 2 - 44, -24); x.closePath(); x.fill(); }
    else { x.beginPath(); x.arc(-tw / 2 - 36, 0, 18, 0, Math.PI * 2); x.fill(); }
    x.save(); x.translate(14, 4); x.scale(k, 1); x.fillText(t, 0, 0); x.restore();
    x.restore();
    // banner hem and the eyelets that tie it to the rails
    x.fillStyle = 'rgba(0,0,0,0.22)'; x.fillRect(x0, top, w, 2); x.fillRect(x0, bot - 2, w, 2); x.fillRect(x0 + w - 2, top, 2, bot - top);
    for (let e = 8; e < w; e += 32) { x.fillStyle = 'rgba(210,212,215,0.9)'; x.fillRect(x0 + e, top + 3, 2, 2); x.fillRect(x0 + e, bot - 5, 2, 2); }
  }
  // dirt at the foot
  const grime = x.createLinearGradient(0, ARMCO_Y(0.4), 0, bot);
  grime.addColorStop(0, 'rgba(60,55,48,0)'); grime.addColorStop(1, 'rgba(60,55,48,0.30)');
  x.fillStyle = grime; x.fillRect(0, ARMCO_Y(0.4), W, bot - ARMCO_Y(0.4));
  return tex(c);
}

// Tecpro-style energy-absorbing blocks: 1 m wide vinyl-covered blocks, alternating colours.
export function tecpro() {
  const W = 512, H = 128, c = canvas(W, H), x = c.getContext('2d');
  for (let i = 0; i < 4; i++) {
    const g = x.createLinearGradient(0, 0, 0, H);
    const base = i % 2 ? ['#f1f3f5', '#d3d8dd'] : ['#2466c8', '#184a96'];
    g.addColorStop(0, base[0]); g.addColorStop(1, base[1]);
    x.fillStyle = g; x.fillRect(i * 128, 0, 128, H);
    x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(i * 128, 0, 3, H);
    x.fillStyle = 'rgba(255,255,255,0.18)'; x.fillRect(i * 128 + 3, 0, 2, H);
  }
  x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(0, 22, W, 4); x.fillRect(0, 100, W, 4);
  const grime = x.createLinearGradient(0, 80, 0, H);
  grime.addColorStop(0, 'rgba(60,55,48,0)'); grime.addColorStop(1, 'rgba(60,55,48,0.35)');
  x.fillStyle = grime; x.fillRect(0, 80, W, H - 80);
  return tex(c);
}

// Tunnel wall: painted concrete panels (joints every 1.5 m), a grime band above the rail,
// water stains running down from the cable tray. Mapped 3 m per 1024 px, 1.05 - 4.6 m up.
export function tunnelWall() {
  const W = 1024, H = 128, c = canvas(W, H), x = c.getContext('2d'), r = rng(77);
  const img = x.createImageData(W, H);
  for (let i = 0; i < W * H; i++) { const n = 196 + (r() - 0.5) * 18; img.data[i * 4] = n; img.data[i * 4 + 1] = n - 3; img.data[i * 4 + 2] = n - 9; img.data[i * 4 + 3] = 255; }
  x.putImageData(img, 0, 0);
  for (let j = 0; j < W; j += 512) { x.fillStyle = 'rgba(40,38,34,0.45)'; x.fillRect(j, 0, 3, H); x.fillStyle = 'rgba(255,255,255,0.15)'; x.fillRect(j + 3, 0, 2, H); }
  // stains down from the top
  for (let k = 0; k < 26; k++) {
    const sx = r() * W, len = 20 + r() * 70, wd = 3 + r() * 14;
    const g = x.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, `rgba(70,64,52,${0.12 + r() * 0.2})`); g.addColorStop(1, 'rgba(70,64,52,0)');
    x.fillStyle = g; x.fillRect(sx, 0, wd, len);
  }
  // grime band at the bottom (above the rail): exhaust soot and tyre dust
  const g = x.createLinearGradient(0, H * 0.55, 0, H);
  g.addColorStop(0, 'rgba(40,38,36,0)'); g.addColorStop(1, 'rgba(40,38,36,0.55)');
  x.fillStyle = g; x.fillRect(0, H * 0.55, W, H * 0.45);
  return tex(c);
}

// Debris (catch) fence mesh: galvanised chain link, 50 mm diamonds of ~4 mm wire. One tile =
// 0.8 m square (16 diamonds across), 256 px. Built as raw RGBA so the colour is the wire's
// everywhere and the alpha is its coverage: the GPU mipmaps then average to the real
// see-through density (~20 %), so at a distance the fence becomes a fine grey veil that stays
// still in motion instead of an aliased lattice.
export function fence() {
  const N = 256, cells = 16, pitch = N / cells, half = 0.72;     // wire half-width in texels
  const data = new Uint8Array(N * N * 4), r = rng(808);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const a = ((x + y + 0.5) % pitch + pitch) % pitch, b = ((x - y + 0.5) % pitch + pitch) % pitch;
    const da = Math.min(a, pitch - a) / Math.SQRT2, db = Math.min(b, pitch - b) / Math.SQRT2;
    const d = Math.min(da, db);
    const cov = Math.max(0, Math.min(1, half + 0.5 - d));
    const i = (y * N + x) * 4;
    const v = 104 + (r() - 0.5) * 14 + (da < db ? 8 : -6);         // the two wire directions catch the light differently
    data[i] = v; data[i + 1] = v + 4; data[i + 2] = v + 9; data[i + 3] = Math.round(cov * 255);
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}

// Soft glow round a tunnel luminaire (additive): elongated falloff, white centre.
export function lampGlow() {
  const W = 64, H = 128, c = canvas(W, H), x = c.getContext('2d');
  const img = x.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
    const u = (xx + 0.5) / W * 2 - 1, v = (y + 0.5) / H * 2 - 1;
    const dx = Math.max(0, Math.abs(u) - 0.18) / 0.82, dy = Math.max(0, Math.abs(v) - 0.42) / 0.58;
    const d = Math.min(1, Math.hypot(dx, dy));
    const a = Math.pow(1 - d, 2.2);
    const i = (y * W + xx) * 4;
    img.data[i] = 255 * a; img.data[i + 1] = 244 * a; img.data[i + 2] = 222 * a; img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return tex(c, { repeat: false });
}

export function concrete(size = 256, base = 182) {
  const c = canvas(size, size), x = c.getContext('2d');
  const img = x.createImageData(size, size), r = rng(11);
  for (let i = 0; i < size * size; i++) {
    const n = base + (r() - 0.5) * 26;
    img.data[i * 4] = n; img.data[i * 4 + 1] = n - 2; img.data[i * 4 + 2] = n - 6; img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  x.strokeStyle = 'rgba(0,0,0,0.18)'; x.lineWidth = 2;
  for (let k = 0; k <= 4; k++) { x.beginPath(); x.moveTo(0, k * size / 4); x.lineTo(size, k * size / 4); x.stroke(); }
  return tex(c);
}

// Riviera facades: grayscale (tinted per building by vertex colour). One tile = 1 bay x 1 floor
// (3.4 m x 3.2 m); variants: shuttered classic, modern balconies, belle-époque.
export function facade(variant = 0) {
  const W = 256, H = 256, c = canvas(W, H), x = c.getContext('2d');
  const r = rng(31 + variant * 17);
  x.fillStyle = '#e9e5dc'; x.fillRect(0, 0, W, H);
  // render 2x2 bays per tile for variety
  for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
    const ox = bx * 128, oy = by * 128;
    if (variant === 0) { // shutters
      x.fillStyle = '#3c4148'; x.fillRect(ox + 40, oy + 26, 48, 74);
      const sh = r() < 0.5;
      x.fillStyle = sh ? '#7d8f6a' : '#a0896a';
      if (r() < 0.6) { x.fillRect(ox + 18, oy + 26, 22, 74); x.fillRect(ox + 88, oy + 26, 22, 74); }
      x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(ox + 36, oy + 100, 56, 6);
      x.fillStyle = '#d9d2c3'; x.fillRect(ox + 34, oy + 18, 60, 8);
    } else if (variant === 1) { // modern balconies with glass
      x.fillStyle = '#5b6b7c'; x.fillRect(ox + 8, oy + 20, 112, 80);
      x.fillStyle = 'rgba(200,220,240,0.55)'; x.fillRect(ox + 12, oy + 24, 50, 72); x.fillRect(ox + 66, oy + 24, 50, 72);
      x.fillStyle = '#f4f4f2'; x.fillRect(ox, oy + 98, 128, 14);
      x.fillStyle = 'rgba(255,255,255,0.6)'; x.fillRect(ox + 4, oy + 84, 120, 3);
    } else { // belle époque with balcony rails
      x.fillStyle = '#2f343b'; x.fillRect(ox + 34, oy + 22, 60, 84);
      x.fillStyle = 'rgba(160,180,200,0.35)'; x.fillRect(ox + 40, oy + 28, 22, 70); x.fillRect(ox + 66, oy + 28, 22, 70);
      x.strokeStyle = '#25282c'; x.lineWidth = 2;
      for (let k = 0; k < 9; k++) { x.beginPath(); x.moveTo(ox + 30 + k * 8.5, oy + 86); x.lineTo(ox + 30 + k * 8.5, oy + 106); x.stroke(); }
      x.fillStyle = '#d6cfbf'; x.fillRect(ox + 26, oy + 104, 76, 6); x.fillRect(ox + 28, oy + 12, 72, 10);
    }
  }
  return tex(c, { aniso: 4 });
}

// Empty grandstand seats (the stands are kept empty): one row seen from the track, 8 m x 0.8 m
// on 512 x 64 px: fourteen 0.5 m moulded seats and a 1 m aisle with yellow step nosings. The
// strip stands on each tread in front of the next riser, so the gaps show the grey concrete.
export function seats() {
  const W = 512, H = 64, c = canvas(W, H), x = c.getContext('2d'), r = rng(23);
  const pxm = W / 8, py = H / 0.8;
  x.fillStyle = '#8e9398'; x.fillRect(0, 0, W, H);                 // riser behind
  x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(0, H - 0.36 * py, W, 0.36 * py);   // shade under the seats
  for (let k = 0; k < 14; k++) {
    const cx = (0.25 + k * 0.5) * pxm, sw = 0.42 * pxm;
    const tone = r() < 0.04 ? '#9a1620' : '#c41a26';
    // seat back (rounded top), lighter rim along its top
    const top = H - 0.8 * py + 2, bk = H - 0.44 * py;
    x.fillStyle = tone; x.beginPath();
    x.moveTo(cx - sw / 2, bk); x.lineTo(cx - sw / 2, top + 6); x.quadraticCurveTo(cx - sw / 2, top, cx - sw / 2 + 6, top);
    x.lineTo(cx + sw / 2 - 6, top); x.quadraticCurveTo(cx + sw / 2, top, cx + sw / 2, top + 6); x.lineTo(cx + sw / 2, bk); x.closePath(); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.28)'; x.fillRect(cx - sw / 2 + 4, top + 1, sw - 8, 2);
    x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(cx - sw / 2, bk - 4, sw, 4);
    // seat pan seen edge-on (folded up) and the bracket below it
    x.fillStyle = '#7d1118'; x.fillRect(cx - sw / 2 + 2, bk, sw - 4, 0.06 * py);
    x.fillStyle = '#3c3f44'; x.fillRect(cx - 2, bk + 0.06 * py, 4, H - bk - 0.06 * py);
  }
  // aisle: steps with yellow nosings
  const ax = 7 * pxm;
  x.fillStyle = '#a3a8ad'; x.fillRect(ax, 0, pxm, H);
  x.fillStyle = '#e2b007'; x.fillRect(ax, H - 3, pxm, 3); x.fillRect(ax, H / 2 - 2, pxm, 3);
  return tex(c);
}

// Water normal map (tileable value-noise ripples)
export function waterNormal(size = 256) {
  const c = canvas(size, size), x = c.getContext('2d');
  const h = new Float32Array(size * size), r = rng(3);
  const waves = [];
  for (let k = 0; k < 14; k++) waves.push({ kx: Math.round((r() - 0.5) * 12), ky: Math.round((r() - 0.5) * 12), a: 0.4 + r(), p: r() * 6.28 });
  for (let y = 0; y < size; y++) for (let xx = 0; xx < size; xx++) {
    let v = 0;
    for (const w of waves) v += w.a * Math.sin((w.kx * xx + w.ky * y) / size * Math.PI * 2 + w.p);
    h[y * size + xx] = v;
  }
  const img = x.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let xx = 0; xx < size; xx++) {
    const dx = h[y * size + (xx + 1) % size] - h[y * size + (xx - 1 + size) % size];
    const dy = h[((y + 1) % size) * size + xx] - h[((y - 1 + size) % size) * size + xx];
    const nx = -dx * 0.25, ny = -dy * 0.25, l = Math.hypot(nx, ny, 1);
    const i = (y * size + xx) * 4;
    img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return tex(c, { srgb: false });
}

// Braking-marker boards (150 / 100 / 50) in one atlas row
export function markerBoards() {
  const W = 512, H = 256, c = canvas(W, H), x = c.getContext('2d');
  ['150', '100', '50'].forEach((t, i) => {
    const ox = i * 170;
    x.fillStyle = '#ffffff'; x.fillRect(ox + 4, 4, 162, H - 8);
    x.strokeStyle = '#111'; x.lineWidth = 10; x.strokeRect(ox + 9, 9, 152, H - 18);
    x.fillStyle = '#111'; x.font = '900 96px Arial Black, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.save(); x.translate(ox + 85, H / 2 + 6); x.scale(Math.min(1, 140 / x.measureText(t).width), 1.25); x.fillText(t, 0, 0); x.restore();
  });
  return tex(c, { repeat: false, aniso: 8 });
}

export function skyGradient() {
  const c = canvas(4, 256), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#2f6fb8'); g.addColorStop(0.45, '#7fb0dd'); g.addColorStop(0.5, '#cfe1ef'); g.addColorStop(0.53, '#dfe8ec'); g.addColorStop(1, '#c9d3d8');
  x.fillStyle = g; x.fillRect(0, 0, 4, 256);
  const t = tex(c, { repeat: false }); return t;
}

// One atlas for all barrier faces (one material per chunk): eight 128 px rows, each tiling
// horizontally. 'flat' is a plain light row for posts, frames and caps (tinted by vertex colour).
export const BARRIER_ROWS = { armco: 0, ads: 1, tecpro: 2, wall: 3, flat: 4, ads2: 5, tunnel: 6, ads3: 7 };
export const BARRIER_NROWS = 8;
export const barrierRowV = (row, inset = 0.003) => [1 - (row + 1) / BARRIER_NROWS + inset, 1 - row / BARRIER_NROWS - inset];
export function barrierAtlas() {
  const W = 1024, RH = 128, c = canvas(W, RH * BARRIER_NROWS), x = c.getContext('2d');
  const flat = canvas(64, 128), fx = flat.getContext('2d'); fx.fillStyle = '#e8e8e8'; fx.fillRect(0, 0, 64, 128);
  const rows = [armco().image, adWall(0).image, tecpro().image, concrete(256, 170).image, flat, adWall(1).image, tunnelWall().image, adWall(2).image];
  rows.forEach((img, i) => {
    for (let ox = 0; ox < W; ox += img.width * (RH / img.height)) x.drawImage(img, ox, i * RH, img.width * (RH / img.height), RH);
  });
  const t = tex(c, { aniso: 8 });
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

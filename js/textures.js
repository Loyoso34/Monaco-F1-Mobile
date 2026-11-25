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

// Armco guard-rail (W-beam x2) on posts, 4 m per tile, with occasional sponsor-free ad panels.
export function armco() {
  const W = 512, H = 128, c = canvas(W, H), x = c.getContext('2d');
  x.fillStyle = '#5c6066'; x.fillRect(0, 0, W, H);           // shadowed gap / posts behind
  for (let p = 0; p < 4; p++) { x.fillStyle = '#3f4247'; x.fillRect(p * 128 + 54, 0, 20, H); }
  const beam = (y0, h) => {
    const g = x.createLinearGradient(0, y0, 0, y0 + h);
    g.addColorStop(0, '#cfd4d9'); g.addColorStop(0.25, '#9aa0a7'); g.addColorStop(0.5, '#dde1e5'); g.addColorStop(0.75, '#8d939a'); g.addColorStop(1, '#c4c9ce');
    x.fillStyle = g; x.fillRect(0, y0, W, h);
    x.fillStyle = 'rgba(0,0,0,0.25)';
    for (let p = 0; p < 8; p++) x.fillRect(p * 64 + 30, y0 + h * 0.45, 4, 4);
  };
  beam(14, 40); beam(70, 40);
  x.fillStyle = 'rgba(80,60,40,0.15)'; x.fillRect(0, 112, W, 16);
  return tex(c);
}

// Concrete wall with advertising panels (generic names) for street sections and the tunnel.
export function adWall() {
  const W = 1024, H = 128, c = canvas(W, H), x = c.getContext('2d');
  const ads = [
    ['#0b2a5b', '#ffffff', 'MONTE-CARLO'], ['#ffffff', '#c8102e', 'GRAND PRIX'], ['#c8102e', '#ffffff', 'RIVIERA'],
    ['#101010', '#ffc20e', 'PORT HERCULE'], ['#00704a', '#ffffff', 'HARBOUR'], ['#f2f2f2', '#0b2a5b', 'PRINCIPAUTÉ'],
    ['#202a44', '#ffffff', 'CASINO'], ['#ffc20e', '#101010', 'TABAC'],
  ];
  const w = W / 4;
  for (let i = 0; i < 4; i++) {
    const [bg, fg, t] = ads[(i * 3 + 1) % ads.length];
    x.fillStyle = bg; x.fillRect(i * w, 0, w, H);
    x.fillStyle = fg; x.font = '900 46px Arial Black, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.save(); x.translate(i * w + w / 2, H / 2 + 4); x.scale(Math.min(1, (w - 20) / x.measureText(t).width), 1); x.fillText(t, 0, 0); x.restore();
    x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(i * w + w - 3, 0, 3, H);
  }
  return tex(c);
}

export function tecpro() {
  const W = 256, H = 128, c = canvas(W, H), x = c.getContext('2d');
  for (let i = 0; i < 4; i++) { x.fillStyle = i % 2 ? '#e8edf2' : '#1f5fbf'; x.fillRect(i * 64, 0, 64, H); x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(i * 64, 0, 3, H); }
  x.fillStyle = 'rgba(255,255,255,0.25)'; x.fillRect(0, 20, W, 6); x.fillRect(0, 100, W, 6);
  return tex(c);
}

// Debris (catch) fence: chain link with posts, alpha-tested. 4 m per tile, 4 m tall.
export function fence() {
  const W = 256, H = 256, c = canvas(W, H), x = c.getContext('2d');
  x.clearRect(0, 0, W, H);
  x.strokeStyle = 'rgba(92,98,106,0.85)'; x.lineWidth = 1.1;
  for (let i = -H; i < W + H; i += 14) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i + H, H); x.stroke();
    x.beginPath(); x.moveTo(i, H); x.lineTo(i + H, 0); x.stroke();
  }
  x.fillStyle = 'rgba(70,74,80,1)'; x.fillRect(0, 0, 8, H); x.fillRect(0, 0, W, 5); x.fillRect(0, H * 0.5, W, 3);
  const t = tex(c, { srgb: true });
  return t;
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

// Grandstand crowd: dense coloured dots on dark rows.
export function crowd(density = 1) {
  const W = 256, H = 128, c = canvas(W, H), x = c.getContext('2d');
  x.fillStyle = '#2b2f36'; x.fillRect(0, 0, W, H);
  const r = rng(5);
  const cols = ['#e2202e', '#ffc20e', '#ffffff', '#1f4fbf', '#f36b21', '#2a9d4b', '#d9d9d9', '#111', '#c8102e', '#7cc4ff'];
  const n = Math.floor(1400 * density);
  for (let i = 0; i < n; i++) {
    const row = Math.floor(r() * 8);
    x.fillStyle = cols[Math.floor(r() * cols.length)];
    x.fillRect(r() * W, row * 16 + 3 + r() * 4, 3, 5);
  }
  for (let row = 0; row < 8; row++) { x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, row * 16 + 13, W, 3); }
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

// One atlas for all barrier faces (one material per chunk): rows top->bottom =
// armco, advertising, Tecpro, concrete. Each row tiles horizontally.
export const BARRIER_ROWS = { armco: 0, ads: 1, tecpro: 2, wall: 3 };
export function barrierAtlas() {
  const W = 1024, RH = 128, c = canvas(W, RH * 4), x = c.getContext('2d');
  const rows = [armco().image, adWall().image, tecpro().image, concrete(256, 170).image];
  rows.forEach((img, i) => {
    for (let ox = 0; ox < W; ox += img.width * (RH / img.height)) x.drawImage(img, ox, i * RH, img.width * (RH / img.height), RH);
  });
  const t = tex(c, { aniso: 8 });
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

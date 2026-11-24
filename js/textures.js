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

// Asphalt: fine aggregate noise, slight patches. Neutral grey (tinted by vertex colours).
export function asphalt(size = 512) {
  const c = canvas(size, size), x = c.getContext('2d');
  const img = x.createImageData(size, size), r = rng(7);
  for (let i = 0; i < size * size; i++) {
    const n = 150 + (r() - 0.5) * 70 + (r() < 0.04 ? 40 : 0) - (r() < 0.03 ? 45 : 0);
    img.data[i * 4] = img.data[i * 4 + 1] = n; img.data[i * 4 + 2] = n + 4; img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  // soft patches / sealant lines
  x.globalAlpha = 0.08;
  for (let k = 0; k < 18; k++) { x.fillStyle = r() < 0.5 ? '#000' : '#fff'; x.beginPath(); x.ellipse(r() * size, r() * size, 20 + r() * 80, 10 + r() * 40, r() * 3, 0, 7); x.fill(); }
  x.globalAlpha = 0.18; x.strokeStyle = '#111'; x.lineWidth = 2;
  for (let k = 0; k < 5; k++) { x.beginPath(); x.moveTo(r() * size, 0); x.bezierCurveTo(r() * size, size * 0.3, r() * size, size * 0.7, r() * size, size); x.stroke(); }
  return tex(c, { aniso: 8 });
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

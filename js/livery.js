// RB20 Monaco livery, painted procedurally into a texture atlas in car coordinates (metres),
// so colour areas and sponsor marks sit at their measured positions and real scale.
// Sponsor names are rendered as plain text approximations (not the real logo artwork).
import * as THREE from 'three';
import { Z } from './carspec.js';

export const NAVY = '#16213f';      // matte "RB navy"
export const NAVY_DARK = '#0e1630';
export const RB_RED = '#d8202e';
export const RB_YELLOW = '#ffc20e';
export const RB_ORANGE = '#f7941d';

// Atlas layout (pixels, W x H). Regions: right side, left side, top, under.
export const ATLAS = {
  W: 2048, H: 2048,
  zMin: Z.noseTip - 0.20, zMax: Z.RA + 0.75,
  side: { y0: 0, h: 640, yMin: -0.05, yMax: 1.05 },     // right side
  sideL: { y0: 640, h: 640 },                              // left side
  top: { y0: 1280, h: 720, xMin: -1.0, xMax: 1.0 },
  under: { y0: 2000, h: 48 },
};

const zToU = (z) => (ATLAS.zMax - z) / (ATLAS.zMax - ATLAS.zMin);   // front -> u = 1

// UV for a point (car frame) with face normal n, per-face planar projection into the atlas.
export function atlasUV(x, y, z, nx, ny, nz, out) {
  const W = ATLAS.W, H = ATLAS.H;
  const yy = (v) => 1 - v / H;
  if (ny < -0.6) { // underside
    out[0] = 0.1 + 0.8 * zToU(z); out[1] = yy(ATLAS.under.y0 + 24); return out;
  }
  if (ny > 0.62) { // top view: front to the right, car left (x<0) at the top rows
    const r = ATLAS.top;
    out[0] = zToU(z);
    out[1] = yy(r.y0 + (x - r.xMin) / (r.xMax - r.xMin) * r.h);
    return out;
  }
  const s = ATLAS.side;
  const row = (1 - (y - s.yMin) / (s.yMax - s.yMin)) * s.h;
  if (nx >= 0) { out[0] = zToU(z); out[1] = yy(s.y0 + row); }
  else { out[0] = 1 - zToU(z); out[1] = yy(ATLAS.sideL.y0 + row); }
  return out;
}

// Apply atlas UVs to a non-indexed geometry using per-face normals.
export function applyAtlasUV(geom) {
  const g = geom.index ? geom.toNonIndexed() : geom;
  const p = g.attributes.position.array;
  const uv = new Float32Array((p.length / 3) * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const tmp = [0, 0];
  for (let i = 0; i < p.length; i += 9) {
    a.fromArray(p, i); b.fromArray(p, i + 3); c.fromArray(p, i + 6);
    n.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
    for (let k = 0; k < 3; k++) {
      atlasUV(p[i + k * 3], p[i + k * 3 + 1], p[i + k * 3 + 2], n.x, n.y, n.z, tmp);
      uv[(i / 3 + k) * 2] = tmp[0]; uv[(i / 3 + k) * 2 + 1] = tmp[1];
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// ---------------------------------------------------------------------------------------------
function sidePx(z, y, left) {
  const s = ATLAS.side;
  const u = left ? 1 - zToU(z) : zToU(z);
  return [u * ATLAS.W, (left ? ATLAS.sideL.y0 : s.y0) + (1 - (y - s.yMin) / (s.yMax - s.yMin)) * s.h];
}
function topPx(z, x) {
  const r = ATLAS.top;
  return [zToU(z) * ATLAS.W, r.y0 + (x - r.xMin) / (r.xMax - r.xMin) * r.h];
}
const pxPerM = () => ATLAS.W / (ATLAS.zMax - ATLAS.zMin);

// A stylised charging bull (simple silhouette), facing +x in its local box (w x h).
function bullPath(ctx, x, y, w, h, faceLeft) {
  ctx.save();
  ctx.translate(x, y);
  if (faceLeft) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  ctx.scale(w / 100, h / 50);
  ctx.beginPath();
  ctx.moveTo(8, 22);
  ctx.bezierCurveTo(14, 10, 40, 6, 62, 10);       // back
  ctx.bezierCurveTo(72, 12, 78, 14, 84, 20);      // neck
  ctx.lineTo(96, 18); ctx.lineTo(90, 24);          // horn
  ctx.lineTo(99, 30); ctx.lineTo(88, 31);          // head / snout
  ctx.bezierCurveTo(86, 36, 80, 38, 76, 36);
  ctx.lineTo(80, 48); ctx.lineTo(74, 48); ctx.lineTo(68, 36);   // front leg
  ctx.bezierCurveTo(56, 38, 44, 38, 32, 36);
  ctx.lineTo(26, 48); ctx.lineTo(20, 48); ctx.lineTo(22, 34);   // hind leg
  ctx.bezierCurveTo(14, 32, 10, 30, 8, 26);
  ctx.lineTo(0, 30); ctx.lineTo(6, 22);            // tail
  ctx.closePath();
  ctx.restore();
}

function text(ctx, str, cx, cy, hPx, color, { font = '900', family = 'Arial Black, Helvetica Neue, Arial, sans-serif', stretch = 1, align = 'center' } = {}) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${font} ${Math.round(hPx * 1.32)}px ${family}`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.translate(cx, cy); ctx.scale(stretch, 1);
  ctx.fillText(str, 0, 0);
  ctx.restore();
}

// Paints the atlas. Returns a CanvasTexture.
export function makeLiveryTexture(size = 2048) {
  const cv = document.createElement('canvas');
  cv.width = ATLAS.W; cv.height = ATLAS.H;
  const ctx = cv.getContext('2d');
  const ppm = pxPerM();
  // base matte navy with a very slight vertical shading (matte paint picks up sky light)
  ctx.fillStyle = NAVY; ctx.fillRect(0, 0, ATLAS.W, ATLAS.H);
  // underside carbon
  ctx.fillStyle = '#121214'; ctx.fillRect(0, ATLAS.under.y0, ATLAS.W, ATLAS.under.h);

  for (const left of [false, true]) {
    const P = (z, y) => sidePx(z, y, left);
    // lower body darker (carbon floor edge / bargeboard zone)
    {
      const [x0] = P(Z.fromFA(0.35), 0), [x1] = P(Z.fromFA(3.3), 0);
      const [, yTop] = P(0, 0.14), [, yBot] = P(0, -0.05);
      ctx.fillStyle = '#101218'; ctx.fillRect(Math.min(x0, x1), yTop, Math.abs(x1 - x0), yBot - yTop);
    }
    // nose: yellow tip fading to orange, then navy
    {
      const [xa] = P(Z.noseTip - 0.05, 0), [xb] = P(Z.fromFA(-0.55), 0);
      const g = ctx.createLinearGradient(xa, 0, xb, 0);
      g.addColorStop(0, RB_YELLOW); g.addColorStop(0.55, RB_ORANGE); g.addColorStop(0.85, '#e0582a'); g.addColorStop(1, NAVY);
      ctx.fillStyle = g;
      const [, y0] = P(0, 0.42), [, y1] = P(0, 0.12);
      ctx.fillRect(Math.min(xa, xb), y0, Math.abs(xb - xa), y1 - y0);
      // red bull on the nose side
      const [bx] = P(Z.fromFA(-0.95), 0), [, by] = P(0, 0.36);
      const bw = 0.42 * ppm, bh = 0.16 * ppm;
      ctx.fillStyle = RB_RED;
      bullPath(ctx, left ? bx : bx - bw, by, bw, bh, !left);
      ctx.fill();
    }
    // red pin stripe along the chassis side
    {
      const [xa] = P(Z.fromFA(0.15), 0), [xb] = P(Z.fromFA(1.25), 0);
      const [, y] = P(0, 0.465);
      ctx.fillStyle = RB_RED; ctx.fillRect(Math.min(xa, xb), y - 0.009 * ppm, Math.abs(xb - xa), 0.018 * ppm);
    }
    // (sponsor wordmarks are sharp conformal decals: see carmodel.js / decals.js)
    // airbox & engine cover upper: yellow sun -> orange -> red bull -> navy
    {
      const [xa] = P(Z.fromFA(1.74), 0), [xb] = P(Z.fromFA(3.0), 0);
      const g = ctx.createLinearGradient(xa, 0, xb, 0);
      g.addColorStop(0, RB_YELLOW); g.addColorStop(0.3, RB_ORANGE); g.addColorStop(0.75, '#e2462b'); g.addColorStop(1, NAVY);
      ctx.fillStyle = g;
      const [, y0] = P(0, 1.05), [, y1] = P(0, 0.62);
      ctx.beginPath();
      ctx.moveTo(xa, y0); ctx.lineTo(xb, y0); ctx.lineTo(xb, P(0, 0.64)[1]);
      ctx.lineTo(P(Z.fromFA(2.3), 0)[0], y1); ctx.lineTo(xa, y1); ctx.closePath(); ctx.fill();
      const [bx] = P(Z.fromFA(2.05), 0), [, by] = P(0, 0.86);
      const bw = 0.62 * ppm, bh = 0.24 * ppm;
      ctx.fillStyle = RB_RED;
      bullPath(ctx, left ? bx - bw * 0.15 : bx - bw * 0.85, by, bw, bh, !left);
      ctx.fill();
    }
    // number 1 on the nose side near the tip (white)
    { const [x, y] = P(Z.fromFA(-0.62), 0.31); text(ctx, '1', x, y, 0.07 * ppm, '#ffffff'); }
  }

  // ---- top view ----
  {
    const T = (z, x) => topPx(z, x);
    // nose top: yellow tip -> orange, red bull, number
    const [xa] = T(Z.noseTip - 0.05, 0), [xb] = T(Z.fromFA(-0.45), 0);
    const g = ctx.createLinearGradient(xa, 0, xb, 0);
    g.addColorStop(0, RB_YELLOW); g.addColorStop(0.6, RB_ORANGE); g.addColorStop(0.9, '#de4f2a'); g.addColorStop(1, NAVY);
    ctx.fillStyle = g;
    const [, y0] = T(0, -0.30), [, y1] = T(0, 0.30);
    ctx.fillRect(Math.min(xa, xb), y0, Math.abs(xb - xa), y1 - y0);
    // number 1 on the nose top, readable from the front-left
    {
      const [x, y] = T(Z.fromFA(-0.78), 0);
      ctx.save(); ctx.translate(x, y); ctx.rotate(-Math.PI / 2);
      text(ctx, '1', 0, 0, 0.11 * ppm, '#ffffff'); ctx.restore();
    }
    // red stripe down the chassis centre line to the cockpit
    {
      const [x0] = T(Z.fromFA(0.05), 0), [x1] = T(Z.fromFA(1.02), 0), [, yc] = T(0, 0);
      ctx.fillStyle = RB_RED; ctx.fillRect(Math.min(x0, x1), yc - 0.006 * ppm, Math.abs(x1 - x0), 0.012 * ppm);
    }
    // engine cover top
    const [ea] = T(Z.fromFA(1.74), 0), [eb] = T(Z.fromFA(3.05), 0);
    const g2 = ctx.createLinearGradient(ea, 0, eb, 0);
    g2.addColorStop(0, RB_YELLOW); g2.addColorStop(0.35, RB_ORANGE); g2.addColorStop(0.8, '#e2462b'); g2.addColorStop(1, NAVY);
    ctx.fillStyle = g2;
    const [, e0] = T(0, -0.26), [, e1] = T(0, 0.26);
    ctx.fillRect(Math.min(ea, eb), e0, Math.abs(eb - ea), e1 - e0);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  if (size < ATLAS.W) {
    const c2 = document.createElement('canvas'); c2.width = size; c2.height = size;
    c2.getContext('2d').drawImage(cv, 0, 0, size, size);
    tex.image = c2;
  }
  return tex;
}

// Carbon twill weave: colour + normal maps (tileable).
export function makeCarbonTextures() {
  const N = 128;
  const cv = document.createElement('canvas'); cv.width = cv.height = N;
  const ctx = cv.getContext('2d');
  const h = new Float32Array(N * N);
  const tow = 16;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const cx = Math.floor(x / tow), cy = Math.floor(y / tow);
    const over = ((cx + cy) % 4) < 2;          // 2x2 twill
    const fx = (x % tow) / tow, fy = (y % tow) / tow;
    const along = over ? fx : fy;
    const across = over ? fy : fx;
    const bump = Math.sin(Math.PI * across) * 0.8 + 0.2 * Math.sin(Math.PI * along);
    h[y * N + x] = bump;
  }
  const img = ctx.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const v = 22 + h[i] * 16;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v + 3; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const nm = document.createElement('canvas'); nm.width = nm.height = N;
  const nctx = nm.getContext('2d');
  const nimg = nctx.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = h[y * N + (x + 1) % N] - h[y * N + (x - 1 + N) % N];
    const dy = h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x];
    const nx = -dx * 1.2, ny = -dy * 1.2, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    const i = (y * N + x) * 4;
    nimg.data[i] = (nx / l * 0.5 + 0.5) * 255; nimg.data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
    nimg.data[i + 2] = (nz / l * 0.5 + 0.5) * 255; nimg.data[i + 3] = 255;
  }
  nctx.putImageData(nimg, 0, 0);
  const map = new THREE.CanvasTexture(cv), normal = new THREE.CanvasTexture(nm);
  for (const t of [map, normal]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 1); }
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, normal };
}

// Tyre texture (lathe UV: u around, v across the profile; v 0..1 inner bead -> outer bead).
// Soft compound (Monaco qualifying): red band and lettering on the outer sidewall.
export function makeTyreTexture(compound = '#e0262b') {
  const W = 1024, H = 128;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#18181a'; ctx.fillRect(0, 0, W, H);
  // tread (middle band) slightly lighter & worn
  const tread0 = H * (6 / 14), tread1 = H * (8 / 14);
  ctx.fillStyle = '#1f1f21'; ctx.fillRect(0, tread0 - 6, W, tread1 - tread0 + 12);
  // outer sidewall (v ~ 0.72 .. 0.97) -> canvas rows (flipY): row = (1 - v) * H
  const row = (v) => (1 - v) * H;
  for (const [v0, v1, outer] of [[0.74, 0.97, true], [0.03, 0.26, false]]) {
    const ya = row(v1), yb = row(v0);
    // compound band
    ctx.fillStyle = compound;
    ctx.fillRect(0, ya + (yb - ya) * 0.70, W, (yb - ya) * 0.10);
    // lettering repeated twice around
    ctx.fillStyle = compound;
    ctx.font = `900 ${Math.round((yb - ya) * 0.42)}px Arial Black, Arial, sans-serif`;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    for (let k = 0; k < 2; k++) {
      const cx = W * (0.25 + 0.5 * k);
      ctx.save(); ctx.translate(cx, ya + (yb - ya) * 0.38); if (!outer) ctx.scale(-1, 1);
      ctx.fillText('P ZERO', 0, 0); ctx.restore();
      ctx.save(); ctx.translate(cx + W * 0.25, ya + (yb - ya) * 0.38); if (!outer) ctx.scale(-1, 1);
      ctx.fillStyle = '#d9d9d9'; ctx.font = `700 ${Math.round((yb - ya) * 0.26)}px Arial, sans-serif`;
      ctx.fillText('SOFT', 0, 0); ctx.restore();
      ctx.fillStyle = compound;
      ctx.font = `900 ${Math.round((yb - ya) * 0.42)}px Arial Black, Arial, sans-serif`;
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Wheel cover disc texture (front face): black cover, red outer ring, yellow-green hub ring.
export function makeWheelCoverTexture() {
  const N = 256;
  const cv = document.createElement('canvas'); cv.width = cv.height = N;
  const ctx = cv.getContext('2d');
  const c = N / 2;
  ctx.fillStyle = '#0d0d10'; ctx.fillRect(0, 0, N, N);
  ctx.strokeStyle = RB_RED; ctx.lineWidth = N * 0.025;
  ctx.beginPath(); ctx.arc(c, c, N * 0.465, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#1a1a1e';
  ctx.beginPath(); ctx.arc(c, c, N * 0.43, 0, Math.PI * 2); ctx.fill();
  // subtle radial bolt marks
  ctx.fillStyle = '#26262b';
  for (let k = 0; k < 10; k++) {
    const a = k / 10 * Math.PI * 2;
    ctx.beginPath(); ctx.arc(c + Math.cos(a) * N * 0.3, c + Math.sin(a) * N * 0.3, N * 0.018, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = '#c6d21e'; ctx.lineWidth = N * 0.02;
  ctx.beginPath(); ctx.arc(c, c, N * 0.1, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#2b2b30'; ctx.beginPath(); ctx.arc(c, c, N * 0.07, 0, Math.PI * 2); ctx.fill();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

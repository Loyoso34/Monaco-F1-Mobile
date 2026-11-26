// RB20 Monaco livery, painted procedurally into a texture atlas in car coordinates (metres),
// so colour areas and sponsor marks sit at their measured positions and real scale.
// Sponsor names are rendered as plain text approximations (not the real logo artwork).
import * as THREE from 'three';
import { Z } from './carspec.js';

// satin "RB navy": calibrated on the 2024 side reference against the white ORACLE lettering on
// the same panel (navy / white ~ 1 / 170 in linear light, the white close to clipping, so the
// paint is taken about twice that): a very dark blue whose navy look also comes from the sky
// sheen on its curved, clear-coated surfaces
export const NAVY = '#131b37';
export const NAVY_DARK = '#0c1126';
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
  // cockpit interior walls (inside the opening, facing the driver): dark, unpainted
  if (z > Z.fromFA(1.06) && z < Z.fromFA(1.86) && Math.abs(x) < 0.255 && y > 0.30 && nx * Math.sign(x || 1) < -0.25) {
    out[0] = 0.5; out[1] = yy(ATLAS.under.y0 + 24); return out;
  }
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
    // sidepod undercut / floor body: the deep, shadowed carbon recess under the sidepod flank
    // (2024 side photo: the navy flank ends ~0.40 m up at the inlet, sweeping down to the rear)
    {
      const edge = [[0.95, 0.43], [1.30, 0.38], [1.80, 0.355], [2.40, 0.32], [2.90, 0.27], [3.30, 0.22]];
      ctx.fillStyle = '#0d0f14';
      ctx.beginPath();
      const [s0x, s0y] = P(Z.fromFA(edge[0][0]), -0.05); ctx.moveTo(s0x, s0y);
      for (const [fa, yy] of edge) { const [ex, ey] = P(Z.fromFA(fa), yy); ctx.lineTo(ex, ey); }
      const [s1x, s1y] = P(Z.fromFA(edge[edge.length - 1][0]), -0.05); ctx.lineTo(s1x, s1y);
      ctx.closePath(); ctx.fill();
    }
    // red pin stripe along the chassis side, broken by the BYBIT letters and running through
    // their lower half (2024 side reference), then a red line along the sidepod shoulder
    {
      const seg = (fa0, fa1, y, hh) => {
        const [xa] = P(Z.fromFA(fa0), 0), [xb] = P(Z.fromFA(fa1), 0), [, yy] = P(0, y);
        ctx.fillStyle = RB_RED; ctx.fillRect(Math.min(xa, xb), yy - hh / 2 * ppm, Math.abs(xb - xa), hh * ppm);
      };
      seg(0.18, 0.47, 0.512, 0.017); seg(0.81, 1.05, 0.512, 0.017);
      seg(1.40, 2.35, 0.578, 0.012);
    }
    // (sponsor wordmarks are sharp conformal decals: see carmodel.js / decals.js)
    // airbox & engine cover upper: yellow sun -> orange -> red bull -> navy
    {
      const [xa] = P(Z.fromFA(1.70), 0), [xb] = P(Z.fromFA(3.05), 0);
      const g = ctx.createLinearGradient(xa, 0, xb, 0);
      // yellow round the inlet, deep orange down the airbox flanks, red towards the rear
      g.addColorStop(0, RB_YELLOW); g.addColorStop(0.07, '#f9a01c'); g.addColorStop(0.20, '#f2801a'); g.addColorStop(0.55, '#e2462b'); g.addColorStop(1, '#c8302a');
      ctx.fillStyle = g;
      const [, y0] = P(0, 1.05);
      // lower edge (2024 side photo): high at the airbox, sweeping down along the cooling gulley
      const edge = [[1.70, 0.80], [1.85, 0.76], [2.10, 0.74], [2.45, 0.70], [2.80, 0.64], [3.05, 0.60]];
      ctx.beginPath();
      ctx.moveTo(xa, y0); ctx.lineTo(xb, y0);
      for (let i = edge.length - 1; i >= 0; i--) { const [fa, yy] = edge[i]; const [ex, ey] = P(Z.fromFA(fa), yy); ctx.lineTo(ex, ey); }
      ctx.closePath(); ctx.fill();
      const [bx] = P(Z.fromFA(2.05), 0), [, by] = P(0, 0.86);
      const bw = 0.62 * ppm, bh = 0.24 * ppm;
      ctx.fillStyle = RB_RED;
      bullPath(ctx, left ? bx - bw * 0.15 : bx - bw * 0.85, by, bw, bh, !left);
      ctx.fill();
    }
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
    // (the car number and the sponsor stack on the chassis / nose top are sharp decals)
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
    const v = 34 + h[i] * 22;
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

// Tyre textures (lathe UV: u around the tyre, v across the profile in fixed bands - see
// tyreGeometry: inner sidewall 0-0.30, shoulders, tread 0.36-0.64, outer sidewall 0.70-1).
// 2024 Pirelli sidewall (from race photos): "P ZERO" and "PIRELLI" in the compound colour,
// arched in the upper half of each sidewall and separated by two thick compound-colour arcs;
// lettering runs clockwise as seen from that side with the letters' tops towards the tread.
// Soft compound (Monaco qualifying): red. Returns the sharp map, a circumferentially smeared
// map (blended in with wheel speed so the lettering blurs into rings instead of strobing), and
// a roughness map (scrubbed tread rougher than the satin sidewall, painted marks smoother).
export function makeTyreTextures(compound = '#e3262c') {
  const W = 2048, H = 256;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const row = (v) => (1 - v) * H;                    // flipY: v = 1 is the top row
  // base rubber: satin black sidewalls, dark grey scrubbed tread with graining
  c.fillStyle = '#121214'; c.fillRect(0, 0, W, H);
  const tr0 = row(0.70), tr1 = row(0.30);
  const g = c.createLinearGradient(0, tr0, 0, tr1);
  g.addColorStop(0, '#17171a'); g.addColorStop(0.12, '#242427'); g.addColorStop(0.5, '#28282b'); g.addColorStop(0.88, '#242427'); g.addColorStop(1, '#17171a');
  c.fillStyle = g; c.fillRect(0, tr0, W, tr1 - tr0);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 2600; k++) {                   // graining / scrub marks across the tread
    const x = rnd() * W, y = row(0.37 + rnd() * 0.26), l = 4 + rnd() * 26;
    c.fillStyle = rnd() < 0.5 ? `rgba(70,70,74,${0.05 + rnd() * 0.10})` : `rgba(8,8,9,${0.06 + rnd() * 0.10})`;
    c.fillRect(x, y, l, 1 + rnd() * 1.5);
  }
  // sidewall artwork
  const drawSide = (vLo, vHi, outer) => {
    // vLo..vHi: sidewall band from the bead (vLo for inner) to the shoulder
    const yShoulder = outer ? row(0.715) : row(0.285), yBead = outer ? row(0.985) : row(0.015);
    const hSide = Math.abs(yBead - yShoulder);
    const yText = yShoulder + (yBead - yShoulder) * 0.33;        // centre line of the marks
    const tH = hSide * 0.27, arcH = hSide * 0.17;
    // circumferential layout (fractions of W): P ZERO, arc, PIRELLI, arc
    const parts = [['pzero', 0.205], ['gap', 0.028], ['arc', 0.232], ['gap', 0.028], ['pirelli', 0.150], ['gap', 0.028], ['arc', 0.301], ['gap', 0.028]];
    let x = W * 0.06;
    for (const [kind, f] of parts) {
      const w = f * W;
      if (kind === 'arc') { c.fillStyle = compound; c.fillRect(x, yText - arcH / 2, w, arcH); }
      if (kind === 'pzero' || kind === 'pirelli') {
        c.save();
        c.translate(x + w / 2, yText);
        // outer sidewall: u runs anticlockwise and v towards the hub as seen from outside, so
        // the text is drawn rotated 180 deg to read clockwise with the tops towards the tread
        if (outer) c.rotate(Math.PI);
        c.fillStyle = compound; c.textAlign = 'center'; c.textBaseline = 'middle';
        if (kind === 'pzero') {
          c.font = `italic 900 ${Math.round(tH * 1.25)}px Arial Black, Helvetica Neue, Arial, sans-serif`;
          const m = c.measureText('P ZERO').width; c.scale(w * 0.96 / m, 1);
          c.fillText('P ZERO', 0, tH * 0.04);
        } else {
          c.font = `900 ${Math.round(tH * 1.0)}px Helvetica Neue, Arial, sans-serif`;
          const m = c.measureText('PIRELLI').width; c.scale(w * 0.92 / m, 1);
          c.fillText('PIRELLI', 0, tH * 0.03);
        }
        c.restore();
      }
      x = (x + w) % W;
    }
  };
  drawSide(0.70, 1.0, true);
  drawSide(0.0, 0.30, false);
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  map.wrapS = THREE.RepeatWrapping;
  // smeared copy: every row replaced by its average colour (a spinning wheel at speed)
  const cb = document.createElement('canvas'); cb.width = 64; cb.height = H;
  {
    const src = c.getImageData(0, 0, W, H).data, bx = cb.getContext('2d'), img = bx.createImageData(64, H);
    for (let y = 0; y < H; y++) {
      // average in linear light so the blurred band keeps the right brightness
      let r = 0, gg = 0, b = 0;
      for (let xx = 0; xx < W; xx++) { const i = (y * W + xx) * 4; r += (src[i] / 255) ** 2.2; gg += (src[i + 1] / 255) ** 2.2; b += (src[i + 2] / 255) ** 2.2; }
      const R = Math.round(255 * (r / W) ** (1 / 2.2)), G = Math.round(255 * (gg / W) ** (1 / 2.2)), B = Math.round(255 * (b / W) ** (1 / 2.2));
      for (let xx = 0; xx < 64; xx++) { const i = (y * 64 + xx) * 4; img.data[i] = R; img.data[i + 1] = G; img.data[i + 2] = B; img.data[i + 3] = 255; }
    }
    bx.putImageData(img, 0, 0);
  }
  const mapBlur = new THREE.CanvasTexture(cb);
  mapBlur.colorSpace = THREE.SRGBColorSpace; mapBlur.wrapS = THREE.RepeatWrapping;
  // roughness: tread 0.93 (scrubbed), sidewall 0.74 (satin moulded rubber), marks 0.55
  const cr = document.createElement('canvas'); cr.width = W / 4; cr.height = H;
  {
    const x = cr.getContext('2d');
    x.fillStyle = 'rgb(189,189,189)'; x.fillRect(0, 0, W / 4, H);
    x.fillStyle = 'rgb(237,237,237)'; x.fillRect(0, row(0.68), W / 4, row(0.32) - row(0.68));
  }
  const roughness = new THREE.CanvasTexture(cr);
  roughness.wrapS = THREE.RepeatWrapping;
  return { map, mapBlur, roughness };
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

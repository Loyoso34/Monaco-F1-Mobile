// Street life and vegetation of Monaco: Canary date palms and Washingtonias, umbrella pines,
// cypresses and broadleaf trees on the hillside and in the gardens, clipped shrubs, the tall
// boulevard streetlights whose arms reach over the circuit, the red-and-white Monaco flags along
// the harbour, and the street furniture: road signs and direction boards, benches, litter bins,
// stone balustrades along the retaining walls and public stairways.
//
// Cost control: every kind along the circuit is ONE InstancedMesh per 640 m tile (a few draw calls
// in view, each frustum-culled by its tile's bounds); the hillside trees use a coarse crown of
// 1-3 masses and are one InstancedMesh per species for the whole city - the far LOD is chosen per
// tree at build time, by its distance to the circuit, so there is no popping. Trees, shrubs,
// flags and the furniture are drawn by the main camera only (not the mirrors). Nothing here casts
// a real-time shadow: on High / Medium they receive the static sun shadow map (js/sunshadow.js),
// on Low the baked building shade darkens each instance (applyShade), like the road.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { receiveSunShadow } from './sunshadow.js';
import { DETAIL_LAYER } from './city.js';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const TILE = 640;

// ---------------------------------------------------------------------------------------------
// textures
// palm frond (pinnate): midrib along u, leaflets angled towards the tip, alpha cut-out
function frondTexture() {
  const W = 512, H = 128, c = canvas(W, H), x = c.getContext('2d'), r = rng(91);
  x.clearRect(0, 0, W, H);
  x.lineCap = 'round';
  for (let i = 14; i < W - 6; i += 2.6) {
    const t = i / W, L = (H * 0.47) * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.02)), 0.55);
    for (const sgn of [-1, 1]) {
      const g = 92 + r() * 46, rr = 52 + r() * 26 + (t > 0.85 ? 30 : 0), b = 30 + r() * 18;
      x.strokeStyle = `rgb(${rr | 0},${g | 0},${b | 0})`; x.lineWidth = 2.2 + r() * 0.8;
      x.beginPath(); x.moveTo(i, H / 2); x.quadraticCurveTo(i + 10, H / 2 + sgn * L * 0.6, i + 20 + r() * 6, H / 2 + sgn * L); x.stroke();
    }
  }
  x.strokeStyle = '#6f7a3a'; x.lineWidth = 4; x.beginPath(); x.moveTo(0, H / 2); x.lineTo(W, H / 2); x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
// palm trunk: the "pineapple" pattern of old leaf bases (Phoenix), tiles around and up
function barkTexture() {
  const W = 128, H = 256, c = canvas(W, H), x = c.getContext('2d'), r = rng(57);
  x.fillStyle = '#7a6448'; x.fillRect(0, 0, W, H);
  for (let row = 0; row < 16; row++) for (let col = 0; col < 8; col++) {
    const cx = col * 16 + (row % 2) * 8 + 8, cy = row * 16 + 8;
    const v = 0.75 + r() * 0.4;
    x.fillStyle = `rgb(${(138 * v) | 0},${(112 * v) | 0},${(80 * v) | 0})`;
    x.beginPath(); x.moveTo(cx, cy - 9); x.lineTo(cx + 8, cy); x.lineTo(cx, cy + 9); x.lineTo(cx - 8, cy); x.closePath(); x.fill();
    x.fillStyle = 'rgba(40,30,20,0.55)'; x.fillRect(cx - 7, cy + 4, 14, 3);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// foliage clumps (grey-scale, tinted per instance): leaf masses with gaps and shadows
function foliageTexture() {
  const S = 256, c = canvas(S, S), x = c.getContext('2d'), r = rng(23);
  x.fillStyle = '#4a4a4a'; x.fillRect(0, 0, S, S);                // the shadowed depth of the crown
  // leaf clusters: small, many, each lit from above (bright top edge, darker underside)
  for (let i = 0; i < 4200; i++) {
    const px = r() * S, py = r() * S, rad = 1.4 + r() * 3.2, v = 95 + r() * 120;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      x.fillStyle = `rgb(${(v * 0.62) | 0},${(v * 0.62) | 0},${(v * 0.62) | 0})`; x.beginPath(); x.arc(px + ox, py + oy + rad * 0.35, rad, 0, Math.PI * 2); x.fill();
      x.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`; x.beginPath(); x.arc(px + ox, py + oy - rad * 0.15, rad * 0.8, 0, Math.PI * 2); x.fill();
    }
  }
  // a few gaps where the sky / the branches show through
  for (let i = 0; i < 90; i++) { const px = r() * S, py = r() * S; x.fillStyle = 'rgba(30,30,30,0.7)'; x.beginPath(); x.arc(px, py, 1.5 + r() * 2.5, 0, Math.PI * 2); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

// street furniture atlas (1024 x 256): French / Monegasque road signs in the top row (128 px
// cells), two white direction boards in the bottom row; cell 7 stays plain white for the
// vertex-coloured parts (poles, benches, bins, stone)
const FA_W = 1024, FA_H = 256;
function furnitureAtlas() {
  const c = canvas(FA_W, FA_H), x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, FA_W, FA_H);
  const RED = '#c4122f', BLUE = '#1c4f9c', WHITE = '#f6f6f2', INK = '#151515';
  const disc = (cx, cy, r, f) => { x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fillStyle = f; x.fill(); };
  const font = (px) => `bold ${px}px Arial, Helvetica, sans-serif`;
  // 0 no entry
  disc(64, 64, 62, WHITE); disc(64, 64, 58, RED); x.fillStyle = WHITE; x.fillRect(22, 54, 84, 20);
  // 1 pass on the right (blue disc, white arrow pointing down to the right)
  { const X = 128; disc(X + 64, 64, 62, WHITE); disc(X + 64, 64, 58, BLUE);
    x.save(); x.translate(X + 64, 64); x.rotate(Math.PI / 4); x.fillStyle = WHITE;
    x.fillRect(-36, -8, 48, 16); x.beginPath(); x.moveTo(10, -24); x.lineTo(40, 0); x.lineTo(10, 24); x.closePath(); x.fill(); x.restore(); }
  // 2 give way (inverted triangle, red border)
  { const X = 256; x.beginPath(); x.moveTo(X + 4, 8); x.lineTo(X + 124, 8); x.lineTo(X + 64, 120); x.closePath(); x.fillStyle = RED; x.fill();
    x.beginPath(); x.moveTo(X + 26, 21); x.lineTo(X + 102, 21); x.lineTo(X + 64, 92); x.closePath(); x.fillStyle = WHITE; x.fill(); }
  // 3 pedestrian crossing (blue square, white triangle, walking figure on a zebra)
  { const X = 384; x.fillStyle = BLUE; x.fillRect(X + 4, 4, 120, 120); x.strokeStyle = WHITE; x.lineWidth = 3; x.strokeRect(X + 9, 9, 110, 110);
    x.beginPath(); x.moveTo(X + 64, 17); x.lineTo(X + 113, 108); x.lineTo(X + 15, 108); x.closePath(); x.fillStyle = WHITE; x.fill();
    disc(X + 67, 47, 6, INK);
    x.save(); x.translate(X + 64, 72); x.lineWidth = 6; x.strokeStyle = INK; x.lineCap = 'round';
    x.beginPath(); x.moveTo(2, -16); x.lineTo(-1, 6); x.lineTo(-11, 24); x.moveTo(-1, 6); x.lineTo(10, 24); x.moveTo(1, -11); x.lineTo(-11, 0); x.moveTo(1, -11); x.lineTo(12, -3); x.stroke(); x.restore();
    x.fillStyle = INK; for (let i = 0; i < 5; i++) x.fillRect(X + 34 + i * 13, 98, 7, 6); }
  // 4 speed limit 50
  { const X = 512; disc(X + 64, 64, 62, WHITE); disc(X + 64, 64, 58, RED); disc(X + 64, 64, 45, WHITE);
    x.fillStyle = INK; x.font = font(50); x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('50', X + 64, 67); }
  // 5 parking
  { const X = 640; x.fillStyle = BLUE; x.fillRect(X + 4, 4, 120, 120); x.strokeStyle = WHITE; x.lineWidth = 3; x.strokeRect(X + 9, 9, 110, 110);
    x.fillStyle = WHITE; x.font = font(88); x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('P', X + 64, 70); }
  // 6 no stopping (blue disc, red ring and cross)
  { const X = 768; disc(X + 64, 64, 62, WHITE); disc(X + 64, 64, 58, RED); disc(X + 64, 64, 46, BLUE);
    x.save(); x.translate(X + 64, 64); x.strokeStyle = RED; x.lineWidth = 12; x.beginPath(); x.moveTo(-33, -33); x.lineTo(33, 33); x.moveTo(33, -33); x.lineTo(-33, 33); x.stroke(); x.restore(); }
  // direction boards: white, black border, black lettering and arrows
  const arrow = (cx, cy, d) => { x.beginPath(); x.moveTo(cx - d * 22, cy - 6); x.lineTo(cx + d * 2, cy - 6); x.lineTo(cx + d * 2, cy - 15); x.lineTo(cx + d * 22, cy); x.lineTo(cx + d * 2, cy + 15); x.lineTo(cx + d * 2, cy + 6); x.lineTo(cx - d * 22, cy + 6); x.closePath(); x.fill(); };
  const board = (X, lines) => {
    x.fillStyle = WHITE; x.fillRect(X + 2, 130, 508, 124); x.strokeStyle = INK; x.lineWidth = 5; x.strokeRect(X + 9, 137, 494, 110);
    x.fillStyle = INK; x.font = font(40); x.textBaseline = 'middle';
    lines.forEach(([t, d], i) => { const y = 166 + i * 52; if (d > 0) { x.textAlign = 'left'; x.fillText(t, X + 28, y); arrow(X + 466, y, 1); } else { x.textAlign = 'right'; x.fillText(t, X + 484, y); arrow(X + 46, y, -1); } });
  };
  board(0, [['MONTE-CARLO', 1], ['BEAUSOLEIL', 1]]);
  board(512, [['LA CONDAMINE', -1], ['MONACO-VILLE', -1]]);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
// atlas pixel rectangle -> uv, for a geometry whose own uvs span 0..1
const atlasRect = (px, py, pw, ph) => (u, v) => [(px + u * pw) / FA_W, 1 - (py + (1 - v) * ph) / FA_H];
const WHITE_UV = [(7 * 128 + 64) / FA_W, 1 - 64 / FA_H];
// stone balusters between the plinth and the hand rail (alpha cut-out, 4 per metre of texture)
function balusterTexture() {
  const W = 128, H = 128, c = canvas(W, H), x = c.getContext('2d');
  x.clearRect(0, 0, W, H);
  // one baluster per 32 px: a turned profile (vase), light stone with a shaded side
  for (let i = 0; i < 4; i++) {
    const cx = i * 32 + 16;
    const prof = [[0, 7], [10, 7], [14, 5], [30, 4.5], [52, 9], [70, 10], [86, 7], [100, 4.5], [112, 6], [118, 8], [128, 8]];
    const grd = x.createLinearGradient(cx - 10, 0, cx + 10, 0);
    grd.addColorStop(0, '#d9d2c4'); grd.addColorStop(0.45, '#f2ece0'); grd.addColorStop(1, '#a8a092');
    x.fillStyle = grd; x.beginPath();
    prof.forEach(([y, r], k) => (k ? x.lineTo(cx + r, y) : x.moveTo(cx + r, y)));
    for (let k = prof.length - 1; k >= 0; k--) x.lineTo(cx - prof[k][1], prof[k][0]);
    x.closePath(); x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------------------------------------
// geometries (local frame: base at the origin, +y up)
// Canary date palm crown: three tiers of arching fronds, each a V-folded strip
function palmCrown(seed, nTop = 7, nMid = 11, nLow = 10) {
  const r = rng(seed), pos = [], uv = [], idx = [];
  const tiers = [[nTop, 0.95, 3.3, 0.35], [nMid, 0.42, 4.4, 0.75], [nLow, 0.05, 4.1, 1.05]];
  const up = new THREE.Vector3(0, 1, 0);
  for (const [n, elev, len, droop] of tiers) {
    for (let i = 0; i < n; i++) {
      const az = (i + r() * 0.6) / n * Math.PI * 2, e = elev + (r() - 0.5) * 0.2, L = len * (0.85 + r() * 0.3);
      const dirH = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
      const SEG = 6, base = pos.length / 3;
      for (let j = 0; j <= SEG; j++) {
        const t = j / SEG;
        const mid = dirH.clone().multiplyScalar(L * t * Math.cos(e)).add(up.clone().multiplyScalar(L * t * Math.sin(e) - droop * L * t * t * 0.5));
        const t2 = Math.min(1, t + 0.01);
        const nxt = dirH.clone().multiplyScalar(L * t2 * Math.cos(e)).add(up.clone().multiplyScalar(L * t2 * Math.sin(e) - droop * L * t2 * t2 * 0.5));
        const T = nxt.sub(mid).normalize();
        const S = new THREE.Vector3().crossVectors(T, up).normalize();
        const U = new THREE.Vector3().crossVectors(S, T).normalize();
        const w = 0.95 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.04)), 0.6) + 0.04;
        const fold = 0.45;                                   // leaflets rise from the midrib (V)
        const L1 = mid.clone().addScaledVector(S, -w * Math.cos(fold)).addScaledVector(U, w * Math.sin(fold));
        const R1 = mid.clone().addScaledVector(S, w * Math.cos(fold)).addScaledVector(U, w * Math.sin(fold));
        for (const [p, v] of [[L1, 0], [mid, 0.5], [R1, 1]]) { pos.push(p.x, p.y, p.z); uv.push(t, v); }
      }
      for (let j = 0; j < SEG; j++) {
        const a = base + j * 3, b = a + 3;
        idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// smooth blob from an icosahedron (sphere normals, spherical uv) scaled / offset
// (the surface is pushed in and out by a smooth function of the direction, so the crowns are
// lumpy clusters of foliage rather than smooth balls; the same direction always gets the same
// offset, so the non-indexed faces stay closed)
let blobSeed = 0;
function blob(detail, sx, sy, sz, ox, oy, oz) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  const k = (blobSeed++) * 1.7;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), l = Math.hypot(x, y, z) || 1;
    const ux = x / l, uy = y / l, uz = z / l;
    const lump = 1 + 0.13 * Math.sin(ux * 4.1 + k) * Math.sin(uz * 3.7 - k * 0.6) + 0.09 * Math.sin(uy * 5.3 + ux * 2.2 + k * 1.3);
    n.setXYZ(i, ux, uy * 1.2, uz);                    // a little more "up" in the normals: canopy tops catch the sky
    uv.setXY(i, Math.atan2(uz, ux) / Math.PI + 1, uy * 0.5 + 0.5);
    p.setXYZ(i, ux * lump * sx + ox, uy * lump * sy + oy, uz * lump * sz + oz);
  }
  n.needsUpdate = true;
  return g;
}
const canopy = {
  // umbrella pine: a broad, flat crown of a few masses
  pine: (d) => mergeGeometries([blob(d, 3.4, 1.35, 3.4, 0, 0, 0), blob(d, 2.5, 1.1, 2.5, 2.3, -0.4, 0.9), blob(d, 2.6, 1.05, 2.6, -2.0, -0.3, -1.3), blob(d, 2.0, 1.0, 2.0, 0.3, 0.45, -2.2)]),
  // cypress: a tall, narrow column
  cypress: (d) => mergeGeometries([blob(d, 1.05, 4.6, 1.05, 0, 4.6, 0), blob(d, 0.75, 1.6, 0.75, 0, 8.8, 0)]),
  // broadleaf (plane tree, holm oak): a rounded crown of several masses
  broad: (d) => mergeGeometries([blob(d, 2.6, 2.2, 2.6, 0, 0, 0), blob(d, 2.0, 1.8, 2.0, 1.7, -0.5, 0.6), blob(d, 2.1, 1.7, 2.1, -1.5, -0.3, -0.9), blob(d, 1.8, 1.6, 1.8, 0.2, 0.9, -1.4), blob(d, 1.7, 1.5, 1.7, -0.6, 0.6, 1.5)]),
  shrub: (d) => blob(d, 0.9, 0.62, 0.9, 0, 0.5, 0),
  // far LOD (230 m+ from the circuit): the same outline from 1-3 coarse masses
  pineFar: () => mergeGeometries([blob(0, 3.7, 1.45, 3.7, 0.3, 0, 0.2), blob(0, 2.4, 1.1, 2.4, -1.7, -0.3, -1.1)]),
  cypressFar: () => blob(0, 1.05, 5.4, 1.05, 0, 5.0, 0),
  broadFar: () => mergeGeometries([blob(0, 2.9, 2.4, 2.9, 0.2, 0, 0.1), blob(0, 2.1, 1.8, 2.1, -1.5, -0.3, -0.9), blob(0, 1.9, 1.7, 1.9, 1.2, 0.3, 1.1)]),
};
// Monaco boulevard streetlight: plinth, tapered pole, an arm curving out over the road, a slim
// lantern with a pale diffuser (vertex colours), local +x = towards the road
function lampGeometry() {
  const parts = [];
  const add = (g, col) => { const c = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < c.length; i += 3) { c[i] = col[0]; c[i + 1] = col[1]; c[i + 2] = col[2]; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); parts.push(g.index ? g.toNonIndexed() : g); };
  const dark = [0.035, 0.045, 0.042];                // dark green-grey cast metal (linear)
  const plinth = new THREE.CylinderGeometry(0.15, 0.19, 0.9, 8, 1, true); plinth.translate(0, 0.45, 0); add(plinth, dark);
  const pole = new THREE.CylinderGeometry(0.06, 0.09, 7.6, 8, 1, true); pole.translate(0, 0.9 + 3.8, 0); add(pole, dark);
  // the arm: three straight pieces rising, then running out
  const pts = [[0, 8.4], [0.25, 8.75], [0.8, 8.95], [2.3, 9.0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], len = Math.hypot(x1 - x0, y1 - y0);
    const g = new THREE.CylinderGeometry(0.045, 0.05, len, 6, 1, true);
    g.rotateZ(-Math.atan2(x1 - x0, y1 - y0)); g.translate((x0 + x1) / 2, (y0 + y1) / 2, 0); add(g, dark);
  }
  const head = new THREE.BoxGeometry(0.85, 0.13, 0.3); head.translate(2.55, 8.97, 0); add(head, dark);
  const diff = new THREE.PlaneGeometry(0.75, 0.24); diff.rotateX(Math.PI / 2); diff.translate(2.55, 8.9, 0); add(diff, [0.86, 0.86, 0.82]);
  const cap = new THREE.SphereGeometry(0.1, 6, 3); cap.translate(0, 8.4, 0); add(cap, dark);
  const g = mergeGeometries(parts);
  return g;
}
// Monaco flag on a white pole: red over white, a gentle wave (wind from the sea)
function flagGeometry() {
  const parts = [];
  const col = (g, f) => { const p = g.attributes.position, c = new Float32Array(p.count * 3); for (let i = 0; i < p.count; i++) { const v = f(p.getX(i), p.getY(i), p.getZ(i)); c[i * 3] = v[0]; c[i * 3 + 1] = v[1]; c[i * 3 + 2] = v[2]; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); parts.push(g.index ? g.toNonIndexed() : g); };
  const pole = new THREE.CylinderGeometry(0.035, 0.055, 9, 8, 1, true); pole.translate(0, 4.5, 0); col(pole, () => [0.9, 0.9, 0.88]);
  const ball = new THREE.SphereGeometry(0.08, 8, 4); ball.translate(0, 9.05, 0); col(ball, () => [0.85, 0.7, 0.3]);
  const flag = new THREE.PlaneGeometry(1.9, 1.25, 10, 2);
  const p = flag.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) + 0.95; p.setXYZ(i, x + 0.04, p.getY(i) + 8.3, Math.sin(x * 2.6) * 0.12 * (x / 1.9)); }
  flag.computeVertexNormals();
  col(flag, (x, y) => (y > 8.3 ? [0.62, 0.006, 0.019] : [0.88, 0.88, 0.86]));
  return mergeGeometries(parts);
}

// ---- street furniture pieces (vertex colours + the furniture atlas; local +z faces the viewer) ----
// a piece: non-indexed, with a colour attribute, its uvs mapped into the atlas (map(u, v)), kept
// as they are (map === true) or put on the plain white cell
function part(g, col, map = null) {
  g = g.index ? g.toNonIndexed() : g;
  const n = g.attributes.position.count, c = new Float32Array(n * 3), uv = g.attributes.uv;
  for (let i = 0; i < n; i++) {
    c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2];
    if (map === true) continue;
    const [u, v] = map ? map(uv.getX(i), uv.getY(i)) : WHITE_UV;
    uv.setXY(i, u, v);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
// flat convex polygon facing +z with explicit atlas uvs
function polyPlate(pts, uvs) {
  const pos = [], nor = [], uv = [];
  for (let i = 1; i < pts.length - 1; i++) for (const k of [0, i, i + 1]) { pos.push(pts[k][0], pts[k][1], 0); nor.push(0, 0, 1); uv.push(uvs[k][0], uvs[k][1]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
// (vertex colours are linear: the values below are written in sRGB and converted)
const lin = (r, g, b) => [r, g, b].map((c) => Math.pow(c, 2.2));
const METAL = lin(0.58, 0.60, 0.62), PLATE_BACK = lin(0.42, 0.44, 0.46), SIGN_WHITE = [1, 1, 1];
const IRON = lin(0.13, 0.20, 0.17), WOOD = lin(0.52, 0.38, 0.24), STONE = lin(0.84, 0.80, 0.72), STEP = lin(0.74, 0.72, 0.67);
// road sign on a galvanised pole: type 0-6 (atlas cells), plate centre 2.35 m up
function signGeometry(type) {
  const parts = [], H = 2.35;
  const pole = new THREE.CylinderGeometry(0.03, 0.03, H + 0.32, 8, 1, true); pole.translate(0, (H + 0.32) / 2, 0); parts.push(part(pole, METAL));
  const cap = new THREE.CylinderGeometry(0.034, 0.034, 0.03, 8); cap.translate(0, H + 0.33, 0); parts.push(part(cap, METAL));
  let front, back;
  if (type === 2) {                                         // inverted triangle
    const s = 0.8 / 120, px = [[4, 8], [64, 120], [124, 8]];
    const pts = px.map(([a, b]) => [(a - 64) * s, (56 - b) * s]);
    const uvs = px.map(([a, b]) => [(256 + a) / FA_W, 1 - b / FA_H]);
    front = polyPlate(pts, uvs); back = polyPlate(pts, uvs);           // (symmetric: the back is the same plate turned round)
  } else if (type === 3 || type === 5) {                     // square plates
    front = new THREE.PlaneGeometry(0.6, 0.6); back = new THREE.PlaneGeometry(0.6, 0.6);
    front = part(front, SIGN_WHITE, atlasRect(type * 128 + 4, 4, 120, 120));
  } else {                                                  // discs
    front = new THREE.CircleGeometry(0.33, 24); back = new THREE.CircleGeometry(0.33, 24);
    front = part(front, SIGN_WHITE, atlasRect(type * 128 + 2, 2, 124, 124));
  }
  if (type === 2) front = part(front, SIGN_WHITE, true);
  front.translate(0, H, 0.045); parts.push(front);
  back.rotateY(Math.PI); back.translate(0, H, 0.035); parts.push(part(back, PLATE_BACK));
  // clamp bands round the pole behind the plate
  for (const dy of [-0.18, 0.18]) { const b = new THREE.BoxGeometry(0.09, 0.04, 0.05); b.translate(0, H + dy, 0.018); parts.push(part(b, METAL)); }
  return mergeGeometries(parts);
}
// white direction board (1.5 x 0.375 m) on two poles
function boardGeometry(i) {
  const parts = [], H = 2.45;
  for (const x of [-0.55, 0.55]) { const p = new THREE.CylinderGeometry(0.035, 0.035, H + 0.22, 8, 1, true); p.translate(x, (H + 0.22) / 2, 0); parts.push(part(p, METAL)); }
  const f = part(new THREE.PlaneGeometry(1.5, 0.375), SIGN_WHITE, atlasRect(i * 512 + 2, 130, 508, 124)); f.translate(0, H, 0.05); parts.push(f);
  const b = new THREE.PlaneGeometry(1.5, 0.375); b.rotateY(Math.PI); b.translate(0, H, 0.04); parts.push(part(b, PLATE_BACK));
  const rim = new THREE.BoxGeometry(1.52, 0.395, 0.02); rim.translate(0, H, 0.032); parts.push(part(rim, PLATE_BACK));
  return mergeGeometries(parts);
}
// park bench: cast-iron side frames, three seat slats, two back slats (front = +z)
function benchGeometry() {
  const parts = [], box = (w, h, d, x, y, z, col, rx = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); g.translate(x, y, z); parts.push(part(g, col)); };
  for (const sx of [-0.78, 0.78]) {
    box(0.06, 0.86, 0.06, sx, 0.43, -0.24, IRON, 0.12);   // back leg / back post
    box(0.06, 0.44, 0.06, sx, 0.22, 0.2, IRON);            // front leg
    box(0.06, 0.05, 0.5, sx, 0.62, -0.01, IRON);           // arm rest
    box(0.06, 0.05, 0.46, sx, 0.4, -0.02, IRON);           // seat rail
  }
  for (const z of [0.16, 0.03, -0.1]) box(1.8, 0.035, 0.11, 0, 0.44, z, WOOD);
  for (const y of [0.6, 0.76]) box(1.8, 0.1, 0.03, 0, y, -0.25 - (y - 0.6) * 0.15, WOOD, -0.15);
  return mergeGeometries(parts);
}
// litter bin: dark green drum with a lid on a short post
function binGeometry() {
  const parts = [];
  const drum = new THREE.CylinderGeometry(0.21, 0.19, 0.62, 12); drum.translate(0, 0.62, 0); parts.push(part(drum, IRON));
  const lid = new THREE.CylinderGeometry(0.23, 0.23, 0.05, 12); lid.translate(0, 0.955, 0); parts.push(part(lid, lin(0.1, 0.12, 0.12)));
  const post = new THREE.CylinderGeometry(0.035, 0.035, 0.32, 8); post.translate(0, 0.16, 0); parts.push(part(post, IRON));
  return mergeGeometries(parts);
}

// ---------------------------------------------------------------------------------------------
// instanced, tiled collections
// tile: instancing cell size (m) - things along the circuit in 640 m cells; the hillside trees (far
// LOD, ~70 k triangles in all) one mesh per kind for the whole city: 4 draw calls instead of ~20,
// for a few thousand triangles drawn off-screen, which costs a phone GPU far less;
// mainOnly: drawn by the main camera only (DETAIL_LAYER), not by the rear-view mirrors
class Kind {
  constructor(name, geo, mat, { tile = TILE, mainOnly = false } = {}) { this.name = name; this.geo = geo; this.mat = mat; this.items = []; this.tile = tile; this.mainOnly = mainOnly; }
  add(m4, color) { this.items.push({ m4: m4.clone(), color: color ? color.clone() : null }); }
  build(group) {
    const tiles = new Map();
    const v = new THREE.Vector3(), T = this.tile;
    for (const it of this.items) {
      v.setFromMatrixPosition(it.m4);
      const k = Math.floor(v.x / T + 0.5) + ',' + Math.floor(v.z / T + 0.5);       // (cells centred on the origin)
      (tiles.get(k) || tiles.set(k, []).get(k)).push(it);
    }
    this.meshes = [];
    for (const list of tiles.values()) {
      const m = new THREE.InstancedMesh(this.geo, this.mat, list.length);
      list.forEach((it, i) => { m.setMatrixAt(i, it.m4); if (it.color) m.setColorAt(i, it.color); });
      m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
      m.name = this.name; m.matrixAutoUpdate = false;
      if (this.mainOnly) m.layers.set(DETAIL_LAYER);
      m.userData.items = list;
      group.add(m); this.meshes.push(m);
    }
    return this;
  }
}

// ctx: { T, C, R, lo, hi, isWater, clearBarAt, free, groundAt, terrainH, standSide, quaySide,
//        cS, greenAt, rockH, extentX0..: terrain grid }
export function buildStreetLife(ctx) {
  const { T, C, R, lo, hi, isWater, clearBarAt, free, groundAt, terrainH, standSide, cS } = ctx;
  const group = new THREE.Group(); group.name = 'streetLife';
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const place = (x, y, z, yaw, s, sy = s) => { q.setFromAxisAngle(up, yaw); pv.set(x, y, z); sc.set(s, sy, s); return m4.compose(pv, q, sc); };
  const col = new THREE.Color();

  // materials
  const foliage = foliageTexture();
  const leafMat = new THREE.MeshLambertMaterial({ map: foliage });
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b5641 });
  const frondMat = new THREE.MeshLambertMaterial({ map: frondTexture(), alphaTest: 0.45, alphaToCoverage: true, side: THREE.DoubleSide });
  const barkMat = new THREE.MeshLambertMaterial({ map: barkTexture() });
  const lampMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const flagMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  // the static sun shadow map (js/sunshadow.js) shades them where buildings or the hills do
  if (!lo) for (const m of [leafMat, trunkMat, frondMat, barkMat, lampMat, flagMat]) receiveSunShadow(m);

  // geometries
  const crownA = palmCrown(7), crownB = palmCrown(19, 6, 9, 8);
  const palmTrunk = new THREE.CylinderGeometry(0.34, 0.44, 1, 12, 1, true); palmTrunk.translate(0, 0.5, 0);
  { const uv = palmTrunk.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 3); }
  const knob = new THREE.SphereGeometry(0.62, 10, 6); knob.scale(1, 0.85, 1);
  const treeTrunk = new THREE.CylinderGeometry(0.16, 0.26, 1, 7, 1, true); treeTrunk.translate(0, 0.5, 0);
  const treeTrunkFar = new THREE.CylinderGeometry(0.16, 0.26, 1, 4, 1, true); treeTrunkFar.translate(0, 0.5, 0);

  // palms and streetlights also show in the mirrors; trees, shrubs and flags in the main view only
  const MAIN = { mainOnly: true }, FAR = { mainOnly: true, tile: 8000 };
  const K = {
    palmTrunk: new Kind('palmTrunk', palmTrunk, barkMat),
    palmKnob: new Kind('palmKnob', knob, barkMat),
    crownA: new Kind('palmCrown', crownA, frondMat),
    crownB: new Kind('palmCrown', crownB, frondMat),
    trunk: new Kind('treeTrunk', treeTrunk, trunkMat, MAIN), trunkF: new Kind('treeTrunk', treeTrunkFar, trunkMat, FAR),
    pineN: new Kind('pine', canopy.pine(1), leafMat, MAIN), pineF: new Kind('pine', canopy.pineFar(), leafMat, FAR),
    cypN: new Kind('cypress', canopy.cypress(1), leafMat, MAIN), cypF: new Kind('cypress', canopy.cypressFar(), leafMat, FAR),
    broadN: new Kind('broadleaf', canopy.broad(1), leafMat, MAIN), broadF: new Kind('broadleaf', canopy.broadFar(), leafMat, FAR),
    shrub: new Kind('shrub', canopy.shrub(1), leafMat, MAIN),
    lamp: new Kind('streetlight', lampGeometry(), lampMat),
    flag: new Kind('flag', flagGeometry(), flagMat, MAIN),
  };
  const tint = (h, s, l) => col.setHSL(h, s, l);

  // ---- palms ----------------------------------------------------------------------------------
  const palm = (x, y, z, kind = R() < 0.72 ? 'A' : 'B') => {
    const yaw = R() * Math.PI * 2;
    if (kind === 'A') {                                     // Canary date palm: stout, 5-10 m
      const h = 5 + R() * 5, s = 0.9 + R() * 0.25;
      K.palmTrunk.add(place(x, y, z, yaw, s * 1.15, h));
      K.palmKnob.add(place(x, y + h, z, yaw, s));
      K.crownA.add(place(x, y + h + 0.2, z, yaw, s * (0.95 + R() * 0.15)), tint(0.22 + R() * 0.04, 0.35, 0.42 + R() * 0.12));
    } else {                                                // Washingtonia: slender, 12-18 m, small crown
      const h = 12 + R() * 6, s = 0.7 + R() * 0.12;
      K.palmTrunk.add(place(x, y, z, yaw, 0.62, h));
      K.palmKnob.add(place(x, y + h - 0.6, z, yaw, 0.85, 1.6));
      K.crownB.add(place(x, y + h, z, yaw, s), tint(0.2 + R() * 0.04, 0.35, 0.40 + R() * 0.1));
    }
  };
  // ---- trees (pine / cypress / broadleaf) ---------------------------------------------------------
  const tree = (x, y, z, type, near) => {
    const yaw = R() * Math.PI * 2;
    const TR = near ? K.trunk : K.trunkF;
    if (type === 'pine') {
      const h = 7 + R() * 6, s = 0.8 + R() * 0.45;
      TR.add(place(x, y, z, yaw, s, h));
      (near ? K.pineN : K.pineF).add(place(x, y + h, z, yaw, s), tint(0.25 + R() * 0.05, 0.38 + R() * 0.12, 0.26 + R() * 0.07));
    } else if (type === 'cypress') {
      const s = 0.8 + R() * 0.45;
      TR.add(place(x, y, z, yaw, 0.6, 1.2));
      (near ? K.cypN : K.cypF).add(place(x, y + 0.6, z, yaw, s, s * (0.9 + R() * 0.4)), tint(0.27 + R() * 0.04, 0.35, 0.2 + R() * 0.05));
    } else if (type === 'street') {                      // pruned pavement tree: compact crown kept behind the barrier line (~2.3 m reach)
      const h = 5.0 + R() * 1.0, s = 0.48 + R() * 0.08;
      K.trunk.add(place(x, y, z, yaw, s * 0.9, h));
      (near ? K.broadN : K.broadF).add(place(x, y + h + 1.2 * s, z, yaw, s), tint(0.2 + R() * 0.07, 0.36 + R() * 0.12, 0.3 + R() * 0.09));
    } else {
      const h = 3 + R() * 3, s = 0.75 + R() * 0.5;
      TR.add(place(x, y, z, yaw, s * 0.9, h));
      (near ? K.broadN : K.broadF).add(place(x, y + h + 1.2 * s, z, yaw, s), tint(0.2 + R() * 0.07, 0.36 + R() * 0.12, 0.3 + R() * 0.09));
    }
  };

  // ---- along the circuit: streetlights, palms, street trees, shrubs, flags ------------------------
  const L = T.L;
  const sideOK = (s, side) => !T.inTunnel(s) && !T.inTunnel(s + 6) && !T.inTunnel(s - 6) && !standSide(s, side);
  const pitSide = (s, side) => side < 0 && (s > L - 150 || s < 300);
  const walkAt = (k, side) => (side > 0 ? C.walkL[k] : C.walkR[k]);
  const barAt = (s, side) => (side > 0 ? T.sample(T.barL, s) : T.sample(T.barR, s));
  const spot = (s, side, off) => {                        // point on the pavement, `off` beyond the barrier
    const d = side * (barAt(s, side) + off), p = T.pointAt(s, d);
    return { x: p.x, z: p.z, y: T.heightAt(s, d) + 0.12, d };
  };
  const clearOfAll = (x, z, r, minBar = 0.45) => !isWater(x, z) && clearBarAt(C, x, z) >= minBar && free(x, z, 0, r, r, 0.15);
  // everything placed on the pavements claims a disc, so lamps, palms, trees, signs, benches and
  // the stair heads never stand inside one another
  const CLAIM = new Map(), CC = 6;
  const unclaimed = (x, z, r) => {
    const i0 = Math.floor((x - r - 2) / CC), i1 = Math.floor((x + r + 2) / CC), j0 = Math.floor((z - r - 2) / CC), j1 = Math.floor((z + r + 2) / CC);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const c of CLAIM.get(i + ',' + j) || []) if (Math.hypot(c.x - x, c.z - z) < c.r + r) return false;
    return true;
  };
  const claim = (x, z, r) => {
    if (!unclaimed(x, z, r)) return false;
    const key = Math.floor(x / CC) + ',' + Math.floor(z / CC);
    (CLAIM.get(key) || CLAIM.set(key, []).get(key)).push({ x, z, r });
    return true;
  };
  // streetlights: both sides, ~32 m apart, staggered; the arm over the road
  for (const side of [1, -1]) {
    for (let s = side > 0 ? 6 : 22; s < L; s += 30 + R() * 6) {
      const k = T.idxOfS(s);
      if (!sideOK(s, side) || pitSide(s, side)) continue;
      const walk = walkAt(k, side);
      if (walk < 1.4) continue;
      const p = spot(s, side, 0.55 + Math.min(1.1, walk * 0.25));
      if (!clearOfAll(p.x, p.z, 0.5, 0.4) || !claim(p.x, p.z, 0.45)) continue;
      const toRoad = new THREE.Vector3(-side * T.nx[k], 0, -side * T.nz[k]);
      K.lamp.add(place(p.x, p.y, p.z, Math.atan2(-toRoad.z, toRoad.x), 1));
    }
  }
  // palms: the harbour side from the tunnel exit to La Rascasse, the start / finish straight,
  // Sainte Dévote, Casino Square, the swimming pool
  const palmZones = [
    [T.tunnelS[1] + 120, cS('rascasse') - 15, 1, 16], [L - 300, L + 40, 1, 19], [cS('ste-devote') - 70, cS('ste-devote') + 60, 1, 15],
    [cS('casino') - 70, cS('casino') + 30, -1, 14], [cS('casino') - 70, cS('casino') + 10, 1, 17], [cS('pool1') - 40, cS('pool2') + 40, -1, 15],
    [cS('rascasse') - 40, cS('rascasse') + 50, -1, 16], [cS('mirabeau') - 120, cS('mirabeau') - 40, -1, 20],
  ];
  for (const [a, b, side, step] of palmZones) {
    for (let s = a; s < b; s += step + R() * step * 0.5) {
      const sw = T.wrapS(s), k = T.idxOfS(sw);
      if (!sideOK(sw, side) || pitSide(sw, side)) continue;
      const walk = walkAt(k, side);
      // half of them well back (room for a Canary palm's crown), half near the barrier line
      const off = R() < 0.5 ? 5.0 + R() * 5 : (walk >= 3.2 ? 1.2 + R() * (walk - 2.4) : 2.4 + R() * 2.4);
      const p = spot(sw, side, off);
      if (!clearOfAll(p.x, p.z, 1.4, 1.0) || !claim(p.x, p.z, 1.3)) continue;
      // a Canary palm's drooping fronds reach ~4.5 m: only where they stay off the circuit;
      // closer to the barriers, a tall Washingtonia (its crown is 12 m up)
      const cb = clearBarAt(C, p.x, p.z);
      palm(p.x, Math.max(p.y - 0.12, groundAt(p.x, p.z) + 0.2), p.z, cb < 4.8 ? 'B' : undefined);
    }
  }
  // street trees on the wide pavements of the climb (Avenue d'Ostende / Beau Rivage) and round
  // Portier; clipped shrubs along the Casino and Sainte Dévote pavements
  for (const side of [1, -1]) {
    for (let s = cS('ste-devote') + 40; s < cS('massenet') - 30; s += 13 + R() * 6) {
      const k = T.idxOfS(s); if (!sideOK(s, side)) continue;
      const walk = walkAt(k, side); if (walk < 3.3) continue;
      const p = spot(s, side, Math.min(walk - 0.75, 3.0));
      if (clearOfAll(p.x, p.z, 1.2, 2.45) && claim(p.x, p.z, 1.1)) tree(p.x, p.y, p.z, 'street', true);
    }
    for (const [a, b] of [[cS('casino') - 90, cS('casino') + 25], [cS('ste-devote') - 60, cS('ste-devote') + 30], [cS('portier') - 60, cS('portier') + 40]]) {
      for (let s = a; s < b; s += 4 + R() * 3) {
        const sw = T.wrapS(s), k = T.idxOfS(sw); if (!sideOK(sw, side)) continue;
        const walk = walkAt(k, side); if (walk < 2.0) continue;
        const p = spot(sw, side, walk - 0.7);
        if (clearOfAll(p.x, p.z, 0.9, 1.6) && claim(p.x, p.z, 0.7)) K.shrub.add(place(p.x, p.y, p.z, R() * 6, 0.8 + R() * 0.5), tint(0.24 + R() * 0.05, 0.4, 0.28 + R() * 0.08));
      }
    }
  }
  // Monaco flags along the harbour quays and round the pool
  for (let s = T.tunnelS[1] + 150; s < cS('rascasse') + 40; s += 22 + R() * 8) {
    const sw = T.wrapS(s), k = T.idxOfS(sw);
    if (!sideOK(sw, 1)) continue;
    const p = spot(sw, 1, 1.6 + Math.min(3, walkAt(k, 1) * 0.4));
    if (!clearOfAll(p.x, p.z, 0.6, 0.8) || !claim(p.x, p.z, 0.5)) continue;
    K.flag.add(place(p.x, Math.max(p.y - 0.12, groundAt(p.x, p.z) + 0.2), p.z, -0.9 + (R() - 0.5) * 0.3, 1));
  }

  // ---- street furniture: road signs, direction boards, benches, litter bins, balustrades, stairs ----
  // all merged per 640 m tile into one mesh (one draw call) with the furniture atlas; the stone
  // balusters are a second, alpha-tested mesh per tile; main view only (not in the mirrors)
  const FURN = new Map(), BAL = new Map();
  const tileKey = (x, z) => Math.floor(x / TILE) + ',' + Math.floor(z / TILE);
  const put = (map, g, x, z) => { const k = tileKey(x, z); (map.get(k) || map.set(k, []).get(k)).push(g); };
  const addFurn = (geo, m, x, z) => put(FURN, geo.clone().applyMatrix4(m), x, z);
  const addFurnW = (geo, x, z) => put(FURN, geo, x, z);          // (already in world space)
  const fwd = (k) => new THREE.Vector3(T.tx[k], 0, T.tz[k]);
  const outward = (k, side) => new THREE.Vector3(side * T.nx[k], 0, side * T.nz[k]);
  const yawOf = (v) => Math.atan2(v.x, v.z);                        // local +z -> v
  const nFurn = { signs: 0, boards: 0, benches: 0, bins: 0, balustrade: 0, stairs: 0 };
  const spots = { stairs: [], benches: [], signs: [], balustrade: [], stairReject: { side: 0, walk: 0, near: 0, foot: 0, steps: 0, free: 0, water: 0, claim: 0 } };                                    // (for the inspection tools)

  // road signs: mostly on the right, every 42-78 m, turned to face the oncoming car
  const SIGN = [0, 1, 2, 3, 4, 5, 6].map(signGeometry);
  const SIGN_P = [0.12, 0.27, 0.42, 0.57, 0.77, 0.88, 1.0];          // cumulative: no entry, keep right, give way, crossing, 50, parking, no stopping
  for (let s = 40; s < L - 20; s += 42 + R() * 36) {
    const side = R() < 0.65 ? -1 : 1, k = T.idxOfS(s);
    if (!sideOK(s, side) || pitSide(s, side)) continue;
    const walk = walkAt(k, side); if (walk < 1.5) continue;
    const p = spot(s, side, 0.8 + Math.min(0.4, (walk - 1.5) * 0.3));
    if (!clearOfAll(p.x, p.z, 0.45, 0.55) || !claim(p.x, p.z, 0.4)) continue;
    const r = R(), type = SIGN_P.findIndex((c) => r < c);
    const face = fwd(k).multiplyScalar(-Math.cos(0.3)).addScaledVector(outward(k, side), -Math.sin(0.3));
    addFurn(SIGN[type], place(p.x, p.y - 0.02, p.z, yawOf(face), 1), p.x, p.z); nFurn.signs++;
    spots.signs.push([Math.round(s), side, type]);
  }
  // direction boards before the big junctions (Sainte Devote, Casino, Portier, Tabac, Rascasse)
  const BOARD = [boardGeometry(0), boardGeometry(1)];
  for (const [id, off, bi] of [['ste-devote', -55, 0], ['massenet', -45, 0], ['casino', -40, 1], ['portier', -45, 1], ['tabac', -55, 1], ['rascasse', -50, 0], ['noghes', -40, 1]]) {
    for (const side of [-1, 1]) {
      const sw = T.wrapS(cS(id) + off), k = T.idxOfS(sw);
      if (!sideOK(sw, side) || pitSide(sw, side) || walkAt(k, side) < 2.2) continue;
      const p = spot(sw, side, 1.05);
      if (!clearOfAll(p.x, p.z, 0.9, 1.0) || !claim(p.x, p.z, 0.85)) continue;
      const face = fwd(k).multiplyScalar(-Math.cos(0.25)).addScaledVector(outward(k, side), -Math.sin(0.25));
      addFurn(BOARD[bi], place(p.x, p.y - 0.02, p.z, yawOf(face), 1), p.x, p.z); nFurn.boards++;
      break;
    }
  }
  // benches and litter bins: on the harbour quays facing the boats, and on the wide pavements of
  // the climb to the Casino facing the street
  const BENCH = benchGeometry(), BIN = binGeometry();
  const benchAt = (sw, side, off, faceOut) => {
    const k = T.idxOfS(sw), p = spot(sw, side, off);
    if (!clearOfAll(p.x, p.z, 1.1, 1.0) || !claim(p.x, p.z, 1.0)) return false;
    const o = outward(k, side);
    addFurn(BENCH, place(p.x, p.y - 0.02, p.z, yawOf(faceOut ? o : o.clone().negate()), 1), p.x, p.z); nFurn.benches++;
    spots.benches.push([Math.round(sw), side]);
    if (R() < 0.6) {                                          // a bin beside it
      const f = fwd(k), b = { x: p.x + f.x * 1.35, z: p.z + f.z * 1.35 };
      if (clearOfAll(b.x, b.z, 0.4, 1.0) && claim(b.x, b.z, 0.3)) { addFurn(BIN, place(b.x, p.y - 0.02, b.z, R() * 6, 1), b.x, b.z); nFurn.bins++; }
    }
    return true;
  };
  for (let s = T.tunnelS[1] + 140; s < cS('rascasse') + 30; s += 17 + R() * 9) {
    const sw = T.wrapS(s), k = T.idxOfS(sw), walk = walkAt(k, 1);
    if (!sideOK(sw, 1) || walk < 3.0) continue;
    benchAt(sw, 1, walk - 0.65, true);
  }
  for (const side of [1, -1]) {
    for (let s = cS('ste-devote') + 50; s < cS('casino') - 20; s += 34 + R() * 20) {
      const sw = T.wrapS(s), k = T.idxOfS(sw), walk = walkAt(k, side);
      if (!sideOK(sw, side) || walk < 3.2) continue;
      benchAt(sw, side, walk - 0.55, false);
    }
  }

  // stairs down, and stone balustrades along the back edge of the pavement wherever the ground
  // falls away behind it (the top of the retaining wall), clear of the buildings
  const RISE = 0.165, RUN = 0.3, SW = 2.4;                          // step rise / going, flight width
  const edgeOf = (s, side, k) => { const d = side * (barAt(s, side) + walkAt(k, side)); const p = T.pointAt(s, d); return { x: p.x, z: p.z, y: T.heightAt(s, d) + 0.12 }; };
  const stairSpans = [];                                           // [s0, s1, side]: no balustrade there
  const stairSlope = RISE / RUN;
  for (let s = 20; s < L - 20 && nFurn.stairs < (lo ? 5 : 16); s += 23) {
    for (const side of [1, -1]) {
      const k = T.idxOfS(s);
      const SR = spots.stairReject;
      if (!sideOK(s, side) || pitSide(s, side)) { SR.side++; continue; }
      if (walkAt(k, side) < 4.3 || Math.abs(T.curv[k]) > 1 / 60) { SR.walk++; continue; }
      if (stairSpans.some(([a, b]) => T.deltaS(a - 60, s) >= 0 && T.deltaS(s, b + 60) >= 0)) { SR.near++; continue; }   // one per 120 m
      const e = edgeOf(s, side, k), o = outward(k, side);
      // follow the flight down until it meets the ground
      let foot = -1;
      for (let t = 0.3; t < 14; t += 0.15) {
        const gy = groundAt(e.x + o.x * t, e.z + o.z * t);
        if (gy >= e.y - stairSlope * t - 0.02) { foot = t; break; }
      }
      if (foot < 2.2 || foot > 12) { SR.foot++; continue; }
      const nSteps = Math.round((e.y - groundAt(e.x + o.x * foot, e.z + o.z * foot)) / RISE);
      if (nSteps < 8) { SR.steps++; continue; }
      const len = nSteps * RUN, cx = e.x + o.x * (len / 2 + 0.6), cz = e.z + o.z * (len / 2 + 0.6);
      // the flight and its landing must be on free, dry ground
      let ok = free(cx, cz, yawOf(o), len + 1.6, SW + 0.8, 0.3);       // (width runs along the yaw axis: outward)
      if (!ok) { SR.free++; continue; }
      for (let t = 0; ok && t <= len + 1.2; t += 1.5) { const qx = e.x + o.x * t, qz = e.z + o.z * t; if (isWater(qx, qz)) ok = false; }
      if (!ok) { SR.water++; continue; }
      const claims = [];
      for (let t = 0.4; t <= len + 1.2; t += 1.6) claims.push([e.x + o.x * t, e.z + o.z * t]);
      if (!claims.every(([qx, qz]) => unclaimed(qx, qz, 1.5))) { SR.claim++; continue; }
      for (const [qx, qz] of claims) claim(qx, qz, 1.5);
      // build the flight in its local frame (+z down the stairs, x across, y = 0 at the pavement)
      const parts = [], rel = (t) => groundAt(e.x + o.x * t, e.z + o.z * t) - e.y;
      for (let i = 0; i < nSteps; i++) {
        const top = -(i + 1) * RISE, z0 = i * RUN, z1 = z0 + RUN;
        const bot = Math.min(top - 0.4, Math.min(rel(z0), rel(z1)) - 0.3);
        const st = new THREE.BoxGeometry(SW, top - bot, RUN); st.translate(0, (top + bot) / 2, (z0 + z1) / 2); parts.push(part(st, STEP));
        const nose = new THREE.BoxGeometry(SW, 0.03, 0.04); nose.translate(0, top - 0.015, z0 + 0.02); parts.push(part(nose, lin(0.6, 0.58, 0.55)));
      }
      // landing at the foot, then the parapet walls (their top 1 m above the nosings) with a rail
      const yFoot = -nSteps * RISE;
      { const bot = Math.min(yFoot - 0.4, rel(len + 0.6) - 0.3), ld = new THREE.BoxGeometry(SW + 0.5, yFoot - bot, 1.2); ld.translate(0, (yFoot + bot) / 2, len + 0.6); parts.push(part(ld, STEP)); }
      let lowest = 0; for (let t = 0; t <= len + 1.2; t += 0.5) lowest = Math.min(lowest, rel(t));
      for (const sx of [-1, 1]) {
        const sh = new THREE.Shape();
        sh.moveTo(-0.15, lowest - 0.4); sh.lineTo(-0.15, 1.0); sh.lineTo(0.1, 1.0); sh.lineTo(len, yFoot + 1.0); sh.lineTo(len + 0.5, yFoot + 0.55); sh.lineTo(len + 0.5, lowest - 0.4); sh.closePath();
        const w = new THREE.ExtrudeGeometry(sh, { depth: 0.25, bevelEnabled: false });
        w.rotateY(-Math.PI / 2);                                   // shape x -> +z (down the flight), extruded across x
        w.translate(sx * (SW / 2 + 0.125) + 0.125, 0, 0);
        parts.push(part(w, STONE));
        // hand rail on the inner face, on short posts
        const rx = sx * (SW / 2 - 0.06), dl = Math.hypot(len, nSteps * RISE);
        const rail = new THREE.CylinderGeometry(0.025, 0.025, dl, 6, 1, true);
        rail.rotateX(Math.PI / 2 + Math.atan2(nSteps * RISE, len)); rail.translate(rx, yFoot / 2 + 0.9, len / 2); parts.push(part(rail, IRON));
        for (let t = 0.45; t < len; t += 2.1) {
          const yb = -(Math.floor(t / RUN) + 1) * RISE, yr = -t * (nSteps * RISE / len) + 0.9;
          const pst = new THREE.CylinderGeometry(0.02, 0.02, yr - yb, 6, 1, true); pst.translate(rx, (yr + yb) / 2, t); parts.push(part(pst, IRON));
        }
      }
      const g = mergeGeometries(parts);
      g.applyMatrix4(place(e.x, e.y, e.z, yawOf(o), 1));
      put(FURN, g, e.x, e.z);
      const s0 = T.wrapS(s - SW / 2 - 0.4), s1 = T.wrapS(s + SW / 2 + 0.4);
      stairSpans.push([s0, s1, side]);
      spots.stairs.push([Math.round(s), side, nSteps]);
      nFurn.stairs++;
      break;
    }
  }
  // balustrades: runs of 2.4 m bays from one point of the pavement's back edge to the next, so they
  // follow its curve and its slope (raked plinth and hand rail, vertical turned balusters between,
  // a pedestal at every bay) - only on full-width pavements in gentle bends
  const balTex = balusterTexture();
  const balMat = new THREE.MeshLambertMaterial({ map: balTex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide });
  if (!lo) receiveSunShadow(balMat);
  const BL = 2.4;
  // flat-shaded quads -> one non-indexed geometry (each quad wound to face away from `ctr`)
  const quadGeo = (quads, ctr, col) => {
    const pos = [], nor = [], uv = [], cl = [];
    const v = (q) => new THREE.Vector3(q[0], q[1], q[2]);
    for (const q of quads) {
      let [p0, p1, p2, p3] = q.map(v);
      const n = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0)).normalize();
      const fc = new THREE.Vector3().add(p0).add(p1).add(p2).add(p3).multiplyScalar(0.25).sub(ctr);
      if (n.dot(fc) < 0) { [p1, p3] = [p3, p1]; n.negate(); }
      for (const pt of [p0, p1, p2, p0, p2, p3]) { pos.push(pt.x, pt.y, pt.z); nor.push(n.x, n.y, n.z); uv.push(WHITE_UV[0], WHITE_UV[1]); cl.push(col[0], col[1], col[2]); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
    return g;
  };
  // a raked box from a to b: width w across, bottom / top heights at each end (its ends meet the
  // pedestals, so they are left open; the underside only where it can be seen)
  const rakedBox = (a, b, ya0, ya1, yb0, yb1, w, col, under) => {
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l * w / 2, nz = dx / l * w / 2;
    const C = (e, sd, lv) => { const q = e ? b : a, y = e ? (lv ? yb1 : yb0) : (lv ? ya1 : ya0); return [q.x + sd * nx, y, q.z + sd * nz]; };
    const ctr = new THREE.Vector3((a.x + b.x) / 2, (ya0 + ya1 + yb0 + yb1) / 4, (a.z + b.z) / 2);
    const quads = [
      [C(0, -1, 1), C(1, -1, 1), C(1, 1, 1), C(0, 1, 1)],
      [C(0, -1, 0), C(1, -1, 0), C(1, -1, 1), C(0, -1, 1)], [C(0, 1, 0), C(1, 1, 0), C(1, 1, 1), C(0, 1, 1)],
    ];
    if (under) quads.push([C(0, -1, 0), C(1, -1, 0), C(1, 1, 0), C(0, 1, 0)]);
    return quadGeo(quads, ctr, col);
  };
  const pedestal = (p, y, yaw) => { const g = part(new THREE.BoxGeometry(0.36, 1.1, 0.36), STONE); g.rotateY(yaw); g.translate(p.x, y + 0.55, p.z); return g; };
  const balEdge = (s, side) => {
    const k = T.idxOfS(s);
    if (!sideOK(s, side) || pitSide(s, side) || walkAt(k, side) < 4.3 || Math.abs(T.curv[k]) > 1 / 45) return null;
    const e = edgeOf(s, side, k), o = outward(k, side);
    return { x: e.x - o.x * 0.17, z: e.z - o.z * 0.17, y: e.y - 0.01, o, e };
  };
  if (!lo) for (const side of [1, -1]) {
    let open = null;                                               // end of the run being built
    for (let s = 0; s < L; s += BL) {
      const a = balEdge(s, side), b = balEdge(T.wrapS(s + BL), side);
      let ok = !!(a && b);
      if (ok && stairSpans.some(([s0, s1, sd]) => sd === side && T.deltaS(s0, s + BL) >= 0 && T.deltaS(s, s1) >= 0)) ok = false;
      if (ok) {
        // a real drop behind the pavement (a retaining wall), not water, no building right behind it
        const m = { x: (a.e.x + b.e.x) / 2, z: (a.e.z + b.e.z) / 2, y: (a.y + b.y) / 2 }, o = a.o;
        const g1 = groundAt(m.x + o.x * 1.0, m.z + o.z * 1.0), g3 = groundAt(m.x + o.x * 3.0, m.z + o.z * 3.0);
        if (g1 > m.y - 2.0 || g3 > m.y - 2.2) ok = false;
        else if (isWater(m.x + o.x * 1.5, m.z + o.z * 1.5)) ok = false;
        else if (!free(m.x + o.x * 0.9, m.z + o.z * 0.9, yawOf(o), 1.6, BL, 0.05)) ok = false;
      }
      if (!ok) { if (open) { addFurnW(pedestal(open, open.y, yawOf(open.o)), open.x, open.z); open = null; } continue; }
      const yaw = yawOf(a.o);
      addFurnW(pedestal(a, a.y, yaw), a.x, a.z);
      addFurnW(rakedBox(a, b, a.y, a.y + 0.16, b.y, b.y + 0.16, 0.3, STONE, false), a.x, a.z);
      addFurnW(rakedBox(a, b, a.y + 0.9, a.y + 1.02, b.y + 0.9, b.y + 1.02, 0.32, STONE, true), a.x, a.z);
      // the balusters: a vertical cut-out band between plinth and rail (5 per metre)
      const len = Math.hypot(b.x - a.x, b.z - a.z), q = new THREE.BufferGeometry();
      q.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y + 0.16, a.z, b.x, b.y + 0.16, b.z, b.x, b.y + 0.9, b.z, a.x, a.y + 0.16, a.z, b.x, b.y + 0.9, b.z, a.x, a.y + 0.9, a.z], 3));
      const n = a.o; q.setAttribute('normal', new THREE.Float32BufferAttribute([n.x, 0, n.z, n.x, 0, n.z, n.x, 0, n.z, n.x, 0, n.z, n.x, 0, n.z, n.x, 0, n.z], 3));
      const u = len * 1.25; q.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, u, 0, u, 1, 0, 0, u, 1, 0, 1], 2));
      put(BAL, q, a.x, a.z);
      if (nFurn.balustrade % 12 === 0) spots.balustrade.push([Math.round(s), side]);
      nFurn.balustrade++;
      open = b;
    }
    if (open) addFurnW(pedestal(open, open.y, yawOf(open.o)), open.x, open.z);
  }
  const furnMat = new THREE.MeshLambertMaterial({ map: furnitureAtlas(), vertexColors: true });
  if (!lo) receiveSunShadow(furnMat);
  for (const [map, mat, name] of [[FURN, furnMat, 'furniture'], [BAL, balMat, 'balustrade']]) {
    for (const list of map.values()) {
      const m = new THREE.Mesh(mergeGeometries(list), mat);
      m.name = name; m.matrixAutoUpdate = false; m.geometry.computeBoundingSphere();
      m.layers.set(DETAIL_LAYER);                                  // not in the mirrors
      group.add(m);
    }
  }

  // ---- hillside and gardens: pines, cypresses, broadleaf trees -------------------------------------
  const { X0, X1, Z0, Z1, greenAt } = ctx;
  const nMax = lo ? 260 : hi ? 1500 : 800;
  const step = lo ? 26 : hi ? 13 : 18;
  let nTrees = 0;
  for (let z = Z0 + step / 2; z < Z1 && nTrees < nMax; z += step) {
    for (let x = X0 + step / 2; x < X1 && nTrees < nMax; x += step) {
      const jx = x + (R() - 0.5) * step * 0.9, jz = z + (R() - 0.5) * step * 0.9;
      const g = greenAt(jx, jz);
      if (g < 0.5 || R() > (g - 0.5) * 2.2) continue;
      if (isWater(jx, jz)) continue;
      const cb = clearBarAt(C, jx, jz);
      if (cb < 7) continue;
      if (!free(jx, jz, 0, 5, 5, 0.5)) continue;
      const y = groundAt(jx, jz);
      if (y < 1.5) continue;
      const r = R(), near = ctx.trackDist(jx, jz) < 230;          // the detailed canopy near the circuit
      tree(jx, y, jz, r < 0.5 ? 'pine' : r < 0.78 ? 'cypress' : 'broad', near);
      nTrees++;
    }
  }

  for (const k of Object.values(K)) if (k.items.length) k.build(group);
  // baked building shade: darken the instances standing in a street's shadow (like the road)
  const applyShade = (shadeAt) => {
    const v = new THREE.Vector3(), c = new THREE.Color();
    group.traverse((m) => {
      if (!m.isInstancedMesh) return;
      const items = m.userData.items, h = m.name === 'streetlight' ? 4 : m.name === 'palmCrown' ? 0.5 : 1.5;
      if (!m.instanceColor) { m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.count * 3).fill(1), 3); }
      for (let i = 0; i < m.count; i++) {
        v.setFromMatrixPosition(items[i].m4);
        if (shadeAt(v.x, v.y + h, v.z) > 0) { m.getColorAt(i, c); c.multiplyScalar(0.5); m.setColorAt(i, c); }
      }
      m.instanceColor.needsUpdate = true;
    });
  };
  const counts = Object.assign(Object.fromEntries(Object.entries(K).map(([n, k]) => [n, k.items.length])), nFurn);
  return { group, applyShade, counts, spots, unclaimed };
}

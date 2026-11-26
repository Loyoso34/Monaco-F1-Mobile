// Monaco architecture: facade atlas and building geometry.
//
// Every building is built floor by floor from one facade atlas (a canvas texture of repeating
// floor strips, one strip per district style), so windows sit at real floor heights on every
// side, rear and gable alike. Buildings near the circuit also get real geometry where a driver
// sees depth at speed: shopfronts with awnings, balcony slabs with shaded undersides and
// parapets, string courses, cornices, roof parapets, rooftop plant rooms and terracotta hip
// roofs. Everything uses ONE material (Lambert, atlas x vertex colour) and is merged into
// spatial tiles, so the whole city costs one draw call per visible tile.
//
// Styles (district character):
//   'belle'  - Monte-Carlo belle epoque: cream / ochre stone, tall windows with surrounds,
//              iron balconettes, rusticated ground floor with arches, attic and cornice
//   'riviera'- La Condamine: pastel render (ochre, salmon, yellow), green / brown shutters,
//              shopfronts and awnings, terracotta hip roofs
//   'modern' - 1960s-2000s apartment blocks and towers: continuous balconies with solid
//              parapets, full-height glazing, flat roofs with plant rooms
//   'old'    - Monaco-Ville on the Rock: small shuttered windows, ochre / peach render,
//              terracotta roofs
//   'hotel'  - glass and white bands (the large seafront hotels)
import * as THREE from 'three';

const ROWS = 16, TW = 1024, TH = 2048, RH = TH / ROWS, BAYS = 8;      // 8 bays per strip
export const ROW = {
  belle: 0, belleAttic: 1, rivA: 2, rivB: 3, modern: 4, tower: 5, old: 6, hotel: 7,
  shop: 8, belleBase: 9, cafe: 10, plain: 11, tiles: 12, flat: 13, awning: 14, stone: 15,
};

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ---------------------------------------------------------------------------------------------
// Facade atlas. Walls are drawn near-white (the vertex colour tints them per building); windows
// carry their own depth cues: dark reveal on the top / left (shade), lit sill, glass reflecting
// a sky gradient, frames, shutters.
export function makeFacadeAtlas() {
  const cv = document.createElement('canvas'); cv.width = TW; cv.height = TH;
  const x = cv.getContext('2d');
  const R = rng(7);
  const rowY = (r) => r * RH;
  const wall = (r, tone = '#f4f1ea') => { x.fillStyle = tone; x.fillRect(0, rowY(r), TW, RH); };
  // subtle plaster / stone noise over a row
  const grain = (r, amt = 0.05) => {
    for (let i = 0; i < 900; i++) {
      const a = R() * amt;
      x.fillStyle = R() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
      x.fillRect(R() * TW, rowY(r) + R() * RH, 2 + R() * 6, 1 + R() * 3);
    }
  };
  // glass with a sky reflection (light at the top, darker and bluer below)
  const glass = (gx, gy, gw, gh, dark = 0) => {
    const g = x.createLinearGradient(0, gy, 0, gy + gh);
    g.addColorStop(0, `rgb(${168 - dark},${184 - dark},${196 - dark})`); g.addColorStop(0.45, `rgb(${96 - dark},${112 - dark},${128 - dark})`); g.addColorStop(1, `rgb(${44 - dark / 2},${54 - dark / 2},${66 - dark / 2})`);
    x.fillStyle = g; x.fillRect(gx, gy, gw, gh);
  };
  // a window opening with depth: reveal shade (top + left), glass, frame, sill
  const windowAt = (wx, wy, ww, wh, { frame = '#e8e4da', sill = true, mullion = true, dark = 0, shade = 0.55 } = {}) => {
    x.fillStyle = `rgba(30,26,22,${shade})`; x.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);
    glass(wx + 4, wy + 6, ww - 6, wh - 8, dark);
    x.fillStyle = 'rgba(0,0,0,0.38)'; x.fillRect(wx + 2, wy + 2, ww - 2, 6); x.fillRect(wx + 2, wy + 2, 4, wh - 2);   // reveal shadow
    x.strokeStyle = frame; x.lineWidth = 3; x.strokeRect(wx + 5, wy + 7, ww - 8, wh - 10);
    if (mullion) { x.beginPath(); x.moveTo(wx + ww / 2, wy + 7); x.lineTo(wx + ww / 2, wy + wh - 3); x.moveTo(wx + 5, wy + wh * 0.38); x.lineTo(wx + ww - 3, wy + wh * 0.38); x.stroke(); }
    if (sill) { x.fillStyle = '#fbf8f1'; x.fillRect(wx - 6, wy + wh, ww + 12, 6); x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(wx - 6, wy + wh + 6, ww + 12, 3); }
  };
  const shutters = (wx, wy, ww, wh, col, open = true) => {
    const louvre = (sx, sw) => {
      x.fillStyle = col; x.fillRect(sx, wy, sw, wh);
      x.fillStyle = 'rgba(0,0,0,0.22)';
      for (let k = 4; k < wh - 2; k += 6) x.fillRect(sx + 2, wy + k, sw - 4, 2);
      x.fillStyle = 'rgba(255,255,255,0.10)'; x.fillRect(sx, wy, 2, wh);
    };
    if (open) { louvre(wx - ww * 0.42 - 2, ww * 0.42); louvre(wx + ww + 2, ww * 0.42); }
    else { louvre(wx, wy, ww / 2 - 1, wh); louvre(wx + ww / 2 + 1, ww / 2 - 1); }
  };
  const railing = (rx, ry, rw, rh, col = '#2a2a2c') => {
    x.fillStyle = col; x.fillRect(rx, ry, rw, 3); x.fillRect(rx, ry + rh - 3, rw, 3);
    for (let k = rx; k <= rx + rw; k += 6) x.fillRect(k, ry, 2, rh);
  };
  const bay = (i) => i * (TW / BAYS);
  const B = TW / BAYS;                                                   // 128 px per bay

  // 0 belle epoque floor: tall window, stone surround, balconette, pilaster every 4th bay
  wall(ROW.belle, '#f3ede0'); grain(ROW.belle, 0.04);
  for (let i = 0; i < BAYS; i++) {
    const ox = bay(i), oy = rowY(ROW.belle);
    if (i % 4 === 0) { x.fillStyle = 'rgba(120,100,70,0.12)'; x.fillRect(ox, oy, 12, RH); }
    x.fillStyle = '#e7dcc5'; x.fillRect(ox + 30, oy + 10, 68, 102);       // stone surround
    x.fillStyle = 'rgba(90,70,40,0.18)'; x.fillRect(ox + 26, oy + 6, 76, 8);   // pediment shadow
    windowAt(ox + 38, oy + 18, 52, 86, { frame: '#f4efe4' });
    if (R() < 0.7) shutters(ox + 38, oy + 18, 52, 86, R() < 0.5 ? '#6f7f63' : '#8a8f88', true);
    railing(ox + 30, oy + 84, 68, 22, '#262626');
  }
  // 1 belle epoque attic (top floor): smaller windows, cornice band drawn at the top
  wall(ROW.belleAttic, '#f1eadb'); grain(ROW.belleAttic, 0.04);
  for (let i = 0; i < BAYS; i++) {
    const ox = bay(i), oy = rowY(ROW.belleAttic);
    windowAt(ox + 42, oy + 40, 44, 58, { frame: '#f4efe4' });
    x.fillStyle = '#e9dfca'; x.fillRect(ox, oy, B, 20); x.fillStyle = 'rgba(70,55,35,0.30)'; x.fillRect(ox, oy + 20, B, 5);
    for (let k = 4; k < B; k += 16) { x.fillStyle = 'rgba(80,60,35,0.22)'; x.fillRect(ox + k, oy + 4, 6, 12); }   // dentils
  }
  // 2 / 3 riviera floors: shuttered windows (green or brown, open or closed), sills
  for (const [r, mode] of [[ROW.rivA, 0], [ROW.rivB, 1]]) {
    wall(r, '#f6f0e4'); grain(r, 0.06);
    for (let i = 0; i < BAYS; i++) {
      const ox = bay(i), oy = rowY(r);
      const col = (i + mode) % 3 === 0 ? '#5f7a52' : (i + mode) % 3 === 1 ? '#7d6a4f' : '#6c8a6a';
      const open = mode === 0 ? i % 3 !== 2 : i % 2 === 0;
      if (open) { windowAt(ox + 42, oy + 20, 44, 80); shutters(ox + 42, oy + 20, 44, 80, col, true); }
      else { x.fillStyle = 'rgba(30,26,22,0.45)'; x.fillRect(ox + 40, oy + 18, 48, 84); shutters(ox + 42, oy + 20, 44, 80, col, false); x.fillStyle = '#fbf8f1'; x.fillRect(ox + 36, oy + 100, 56, 6); }
      if (mode === 1 && i % 2 === 0) railing(ox + 36, oy + 80, 56, 20);
    }
  }
  // 4 modern floor: full-height glazing behind a balcony parapet band (seen on far blocks)
  wall(ROW.modern, '#f5f5f2');
  for (let i = 0; i < BAYS; i++) {
    const ox = bay(i), oy = rowY(ROW.modern);
    x.fillStyle = 'rgba(25,25,28,0.55)'; x.fillRect(ox + 4, oy + 8, B - 8, 96);
    glass(ox + 8, oy + 12, B - 16, 86, 10);
    x.fillStyle = '#d8d8d4'; for (let k = 8; k < B - 4; k += 30) x.fillRect(ox + k, oy + 12, 3, 86);
    x.fillStyle = 'rgba(0,0,0,0.30)'; x.fillRect(ox + 8, oy + 12, B - 16, 10);       // slab shade above
    x.fillStyle = '#f8f8f6'; x.fillRect(ox, oy + 96, B, 32);                       // parapet band
    x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(ox, oy + 124, B, 4);
  }
  // 5 tower floor: ribbon windows with mullions
  wall(ROW.tower, '#ecebe6');
  for (let i = 0; i < BAYS; i++) {
    const ox = bay(i), oy = rowY(ROW.tower);
    glass(ox, oy + 30, B, 62, 20);
    x.fillStyle = '#cfd0cc'; for (let k = 0; k < B; k += 32) x.fillRect(ox + k, oy + 30, 4, 62);
    x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(ox, oy + 30, B, 6);
  }
  // 6 old town: small shuttered windows, irregular
  wall(ROW.old, '#f2e8d6'); grain(ROW.old, 0.09);
  for (let i = 0; i < BAYS; i++) {
    const ox = bay(i), oy = rowY(ROW.old), dx = (R() - 0.5) * 16, dy = (R() - 0.5) * 8;
    windowAt(ox + 46 + dx, oy + 30 + dy, 36, 60, { mullion: false });
    shutters(ox + 46 + dx, oy + 30 + dy, 36, 60, R() < 0.5 ? '#3f6b4b' : '#8c5a3c', R() < 0.7);
  }
  // 7 hotel: glass bands between white slab edges
  wall(ROW.hotel, '#f7f7f5');
  for (let i = 0; i < BAYS; i++) {
    const ox = bay(i), oy = rowY(ROW.hotel);
    glass(ox, oy + 16, B, 84, 30);
    x.fillStyle = '#e6e6e2'; for (let k = 0; k < B; k += 21) x.fillRect(ox + k, oy + 16, 2, 84);
    x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(ox, oy + 16, B, 8);
  }
  // 8 ground floor shops: display windows, doors, a fascia for the sign
  wall(ROW.shop, '#efe9dd');
  for (let i = 0; i < BAYS; i++) {
    const ox = bay(i), oy = rowY(ROW.shop);
    const fascia = ['#203050', '#7a1f24', '#1f4a3a', '#3a3a3c', '#a07a2a', '#e9e2d0'][i % 6];
    x.fillStyle = fascia; x.fillRect(ox + 6, oy + 10, B - 12, 20);
    x.fillStyle = 'rgba(255,255,255,0.75)'; for (let k = 0; k < 5; k++) x.fillRect(ox + 20 + k * 18, oy + 17, 10, 6);
    x.fillStyle = '#1c1c1e'; x.fillRect(ox + 6, oy + 32, B - 12, 92);
    glass(ox + 10, oy + 36, B - 20, 86, -30);
    // warm interior and goods
    x.fillStyle = 'rgba(255,220,170,0.25)'; x.fillRect(ox + 12, oy + 70, B - 24, 50);
    for (let k = 0; k < 6; k++) { x.fillStyle = ['#c9a24a', '#8b2b2b', '#e8e8e8', '#2b4b7b'][k % 4]; x.fillRect(ox + 16 + k * 16, oy + 96 + (k % 2) * 6, 10, 14); }
    if (i % 3 === 1) { x.fillStyle = '#2b2622'; x.fillRect(ox + 48, oy + 46, 32, 78); x.fillStyle = 'rgba(180,200,215,0.5)'; x.fillRect(ox + 52, oy + 52, 24, 40); }
  }
  // 9 belle epoque base: rusticated stone with arched openings
  wall(ROW.belleBase, '#ece3d1');
  for (let r = 0; r < 8; r++) { x.fillStyle = 'rgba(90,70,45,0.20)'; x.fillRect(0, rowY(ROW.belleBase) + r * 16, TW, 2); }
  for (let i = 0; i < BAYS; i++) {
    const ox = bay(i), oy = rowY(ROW.belleBase);
    x.fillStyle = '#1e1c1a'; x.beginPath(); x.moveTo(ox + 24, oy + 128); x.lineTo(ox + 24, oy + 52); x.arc(ox + 64, oy + 52, 40, Math.PI, 0); x.lineTo(ox + 104, oy + 128); x.closePath(); x.fill();
    glass(ox + 30, oy + 40, 68, 88, -20);
    x.strokeStyle = '#3a3026'; x.lineWidth = 3; x.beginPath(); x.moveTo(ox + 64, oy + 14); x.lineTo(ox + 64, oy + 128); x.stroke();
    x.fillStyle = '#e2d6bd'; x.fillRect(ox + 58, oy + 8, 12, 12);        // keystone
  }
  // 10 cafe / restaurant ground floor: terrace glazing under a drawn canopy, entrance
  wall(ROW.cafe, '#efe8dc');
  for (let i = 0; i < BAYS; i++) {
    const ox = bay(i), oy = rowY(ROW.cafe);
    x.fillStyle = '#1d1b1a'; x.fillRect(ox + 6, oy + 26, B - 12, 102);
    glass(ox + 10, oy + 30, B - 20, 98, -10);
    x.fillStyle = 'rgba(255,210,150,0.30)'; x.fillRect(ox + 10, oy + 70, B - 20, 58);
    x.fillStyle = i % 2 ? '#7a1f24' : '#1f4a3a'; x.fillRect(ox, oy, B, 24);
    x.fillStyle = 'rgba(255,255,255,0.8)'; x.font = 'bold 14px sans-serif'; x.fillText(['CAFÉ', 'BAR', 'BISTRO', 'GLACES'][i % 4], ox + 34, oy + 17);
  }
  // 11 plain plaster wall
  wall(ROW.plain, '#f4f0e8'); grain(ROW.plain, 0.06);
  // 12 terracotta roof tiles (rows of canal tiles)
  x.fillStyle = '#b5603a'; x.fillRect(0, rowY(ROW.tiles), TW, RH);
  for (let yy = 0; yy < RH; yy += 10) for (let xx = (yy / 10) % 2 * 8; xx < TW; xx += 16) {
    const t = R();
    x.fillStyle = `rgb(${170 + t * 40},${82 + t * 25},${50 + t * 15})`; x.fillRect(xx, rowY(ROW.tiles) + yy, 13, 9);
    x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(xx, rowY(ROW.tiles) + yy + 8, 13, 2);
  }
  // 13 flat roof: gravel / membrane with joints
  x.fillStyle = '#b8b3aa'; x.fillRect(0, rowY(ROW.flat), TW, RH); grain(ROW.flat, 0.12);
  x.fillStyle = 'rgba(0,0,0,0.12)'; for (let k = 0; k < TW; k += 64) x.fillRect(k, rowY(ROW.flat), 2, RH);
  // 14 awnings: four striped canvases across the strip (each 2 bays wide)
  {
    const sets = [['#b8202a', '#f2ede2'], ['#1f5a3a', '#f2ede2'], ['#1b2e5a', '#f2ede2'], ['#d9b35b', '#7a4a2a']];
    for (let k = 0; k < 4; k++) {
      const [a, b] = sets[k];
      for (let xx = 0; xx < 256; xx += 32) { x.fillStyle = a; x.fillRect(k * 256 + xx, rowY(ROW.awning), 16, RH); x.fillStyle = b; x.fillRect(k * 256 + xx + 16, rowY(ROW.awning), 16, RH); }
    }
  }
  // 15 stone / retaining wall: rough coursed blocks
  x.fillStyle = '#cbbf9f'; x.fillRect(0, rowY(ROW.stone), TW, RH);
  for (let yy = 0; yy < RH; yy += 21) for (let xx = (yy / 21) % 2 * 18; xx < TW; xx += 38) {
    const t = R(); x.fillStyle = `rgb(${190 + t * 30},${178 + t * 26},${148 + t * 22})`; x.fillRect(xx + 1, rowY(ROW.stone) + yy + 1, 35, 19);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8; tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}
// v range of a row (canvas row 0 is the top of the texture: v near 1), inset against mip bleed
// render layer of the near-only architectural detail (main camera only: not the mirrors or the
// car's reflection cube)
export const DETAIL_LAYER = 3;
export const vRow = (r) => [1 - (r + 1) / ROWS + 2.5 / TH, 1 - r / ROWS - 2.5 / TH];
export const ATLAS_BAYS = BAYS;

// ---------------------------------------------------------------------------------------------
export class CityBuilder {
  constructor({ tile = 300, detailTile = 150 } = {}) {
    this.tile = tile; this.dtile = detailTile;
    this.tiles = new Map();
    this.tmp = new THREE.Color();
  }
  // geometry is kept in two buckets per tile: 'base' (walls, roofs - everywhere, also in the
  // car's reflections and the mirrors) and 'detail' (balconies, awnings, cornices, parapets,
  // rooftop plant - only drawn in the main view and only within ~280 m)
  _bucket(x, z, detail = false) {
    const t = detail ? this.dtile : this.tile;
    const key = Math.floor(x / t) + ',' + Math.floor(z / t) + (detail ? 'd' : '');
    let b = this.tiles.get(key);
    if (!b) { b = { pos: [], uv: [], col: [], detail, cx: (Math.floor(x / t) + 0.5) * t, cz: (Math.floor(z / t) + 0.5) * t }; this.tiles.set(key, b); }
    return b;
  }
  // quad: a, b bottom (left -> right seen from the front), c, d top; uv rect [u0, u1] x [v0, v1]
  quad(bk, a, b, c, d, u0, u1, v0, v1, col, f = 1) {
    bk.pos.push(...a, ...b, ...c, ...b, ...d, ...c);
    bk.uv.push(u0, v0, u1, v0, u0, v1, u1, v0, u1, v1, u0, v1);
    for (let k = 0; k < 6; k++) bk.col.push(col.r * f, col.g * f, col.b * f);
  }
  // general triangle
  tri(bk, a, b, c, uva, uvb, uvc, col, f = 1) {
    bk.pos.push(...a, ...b, ...c); bk.uv.push(...uva, ...uvb, ...uvc);
    for (let k = 0; k < 3; k++) bk.col.push(col.r * f, col.g * f, col.b * f);
  }
  // oriented box (ang about +y; local x along (sin a, cos a), local z along (cos a, -sin a)),
  // bottom centre at (cx, y0, cz); faces textured from a row with u tiling every `bayM` metres
  box(cx, y0, cz, ang, sx, sy, sz, col, { row = ROW.plain, bayM = 4, top = ROW.flat, bottomF = 0.55, sideF = 1, skipBottom = true, detail = false } = {}) {
    const bk = this._bucket(cx, cz, detail);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const P = (a, y, d) => [cx + sa * a + ca * d, y, cz + ca * a - sa * d];
    const hx = sx / 2, hz = sz / 2, y1 = y0 + sy;
    const [v0, v1] = vRow(row);
    const vSpan = (h) => v0 + (v1 - v0) * Math.min(1, h / 3.2);
    const faces = [
      [P(-hx, y0, -hz), P(hx, y0, -hz), sx], [P(hx, y0, -hz), P(hx, y0, hz), sz],
      [P(hx, y0, hz), P(-hx, y0, hz), sx], [P(-hx, y0, hz), P(-hx, y0, -hz), sz],
    ];
    for (const [p0, p1, len] of faces) {
      const u1 = len / bayM / BAYS;
      this.quad(bk, p0, p1, [p0[0], y1, p0[2]], [p1[0], y1, p1[2]], 0, u1, v0, vSpan(sy), col, sideF);
    }
    const [t0, t1] = vRow(top);
    const r0 = P(-hx, y1, -hz), r1 = P(hx, y1, -hz), r2 = P(hx, y1, hz), r3 = P(-hx, y1, hz);
    this.quad(bk, r0, r1, r3, r2, 0, sx / 16, t0, t1, col, 1);
    if (!skipBottom) { const b0 = P(-hx, y0, -hz), b1 = P(hx, y0, -hz), b2 = P(hx, y0, hz), b3 = P(-hx, y0, hz); this.quad(bk, b0, b1, b3, b2, 0, 0.01, t0, t0 + 0.001, col, bottomF); }
  }
  // building from the placement record b: { cx, cz, ang, w, dpt, h, baseY, color, style, near,
  // front (face index looking at the circuit, -1 none), seed }
  building(b) {
    const R = rng(b.seed || 1);
    const col = this.tmp.set(b.color).clone();
    const bk = this._bucket(b.cx, b.cz);
    const ca = Math.cos(b.ang), sa = Math.sin(b.ang);
    const P = (a, y, d) => [b.cx + sa * a + ca * d, y, b.cz + ca * a - sa * d];
    const hw = b.w / 2, hd = b.dpt / 2;
    const st = b.style;
    // floor heights by style; the ground floor is taller on shop streets
    const fh = st === 'belle' ? 3.7 : st === 'old' ? 3.0 : st === 'hotel' ? 3.3 : st === 'modern' ? 3.05 : 3.2;
    const gH = b.near && st !== 'old' ? (st === 'belle' ? 5.0 : 4.4) : fh;
    const y0 = b.baseY, yTop0 = b.baseY + b.h;
    const nUp = Math.max(1, Math.round((yTop0 - y0 - gH) / fh));
    const yTop = y0 + gH + nUp * fh;
    const bayM = st === 'belle' ? 3.9 : st === 'modern' ? 4.2 : st === 'hotel' ? 3.6 : st === 'old' ? 3.0 : 3.4;
    const upRow = st === 'belle' ? ROW.belle : st === 'riviera' ? (R() < 0.5 ? ROW.rivA : ROW.rivB) : st === 'old' ? ROW.old : st === 'hotel' ? ROW.hotel : (b.h > 45 && R() < 0.5 ? ROW.tower : ROW.modern);
    const groundRow = !b.near ? upRow : st === 'belle' ? ROW.belleBase : st === 'old' ? ROW.old : (R() < 0.35 ? ROW.cafe : ROW.shop);
    // corners: face k runs from corner k to corner k+1 (outward normal)
    const C = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    const faces = [];
    for (let k = 0; k < 4; k++) {
      const [a0, d0] = C[k], [a1, d1] = C[(k + 1) % 4];
      faces.push({ k, a0, d0, a1, d1, len: k % 2 === 0 ? b.w : b.dpt });
    }
    for (const f of faces) {
      const p = (y) => [P(f.a0, y, f.d0), P(f.a1, y, f.d1)];
      const nb = Math.max(1, Math.round(f.len / bayM));
      const uOff = Math.floor(R() * BAYS) / BAYS, u1 = uOff + nb / BAYS;
      const isFront = f.k === b.front;
      // ground floor
      {
        const [A, Bp] = p(y0), [Cc, D] = p(y0 + gH);
        const row = isFront || (b.near && R() < 0.5) ? groundRow : (st === 'belle' ? ROW.belleBase : upRow);
        const [v0, v1] = vRow(row);
        // the visible part of a ground floor taller than the strip is the strip stretched: use
        // the full row for gH (shop / base rows are drawn for a tall storey)
        this.quad(bk, A, Bp, Cc, D, uOff, u1, v0, v1, col, 0.97);
      }
      // upper floors (the top one is the attic strip on belle epoque buildings)
      for (let j = 0; j < nUp; j++) {
        const ya = y0 + gH + j * fh, yb = ya + fh;
        const [A, Bp] = p(ya), [Cc, D] = p(yb);
        const row = st === 'belle' && j === nUp - 1 ? ROW.belleAttic : upRow;
        const [v0, v1] = vRow(row);
        this.quad(bk, A, Bp, Cc, D, uOff, u1, v0, v1, col, 1);
      }
    }
    // ---- roof ----
    const roofTiles = (st === 'riviera' || st === 'old') && b.h < 32 && R() < 0.8;
    if (roofTiles) {
      // hip roof: ridge along the longer axis, 28 deg pitch, small eaves overhang
      const eave = 0.45, long = b.w >= b.dpt;
      const ex = hw + eave, ez = hd + eave;
      const run = (long ? ez : ex), rise = Math.tan(28 * Math.PI / 180) * run;
      const yr = yTop + rise;
      const rl = Math.max(0.01, (long ? ex : ez) - run);             // half ridge length
      const E = [P(-ex, yTop, -ez), P(ex, yTop, -ez), P(ex, yTop, ez), P(-ex, yTop, ez)];
      const R0 = long ? P(-rl, yr, 0) : P(0, yr, -rl), R1 = long ? P(rl, yr, 0) : P(0, yr, rl);
      const [v0, v1] = vRow(ROW.tiles);
      const tcol = new THREE.Color(0xffffff);
      const L = Math.max(b.w, b.dpt) / 8;
      if (long) {
        // long faces (trapezoids) and hip ends (triangles)
        this.quad(bk, E[0], E[1], R0, R1, 0, L, v0, v1, tcol, 1);
        this.quad(bk, E[2], E[3], R1, R0, 0, L, v0, v1, tcol, 0.92);
        this.tri(bk, E[1], E[2], R1, [0, v0], [L / 3, v0], [L / 6, v1], tcol, 0.96);
        this.tri(bk, E[3], E[0], R0, [0, v0], [L / 3, v0], [L / 6, v1], tcol, 0.88);
      } else {
        this.quad(bk, E[1], E[2], R0, R1, 0, L, v0, v1, tcol, 0.96);
        this.quad(bk, E[3], E[0], R1, R0, 0, L, v0, v1, tcol, 0.9);
        this.tri(bk, E[0], E[1], R0, [0, v0], [L / 3, v0], [L / 6, v1], tcol, 1);
        this.tri(bk, E[2], E[3], R1, [0, v0], [L / 3, v0], [L / 6, v1], tcol, 0.88);
      }
      // eave soffit (shaded underside)
      const S = [P(-hw, yTop, -hd), P(hw, yTop, -hd), P(hw, yTop, hd), P(-hw, yTop, hd)];
      const [s0, s1] = vRow(ROW.plain);
      for (let k = 0; k < 4; k++) this.quad(bk, E[(k + 1) % 4], E[k], S[(k + 1) % 4], S[k], 0, 0.05, s0, s1, col, 0.45);
    } else {
      // flat roof inside a parapet, plant rooms / lift housing on top
      const [v0, v1] = vRow(ROW.flat);
      this.quad(bk, P(-hw, yTop, -hd), P(hw, yTop, -hd), P(-hw, yTop, hd), P(hw, yTop, hd), 0, b.w / 16, v0, v1, col, 0.9);
      const par = 0.9, th = 0.25;
      this.box(b.cx + sa * 0 + ca * (-hd + th / 2), yTop, b.cz + ca * 0 - sa * (-hd + th / 2), b.ang, b.w, par, th, col, { row: ROW.plain, detail: true });
      this.box(b.cx + ca * (hd - th / 2), yTop, b.cz - sa * (hd - th / 2), b.ang, b.w, par, th, col, { row: ROW.plain, detail: true });
      this.box(b.cx + sa * (-hw + th / 2), yTop, b.cz + ca * (-hw + th / 2), b.ang, th, par, b.dpt - 2 * th, col, { row: ROW.plain, detail: true });
      this.box(b.cx + sa * (hw - th / 2), yTop, b.cz + ca * (hw - th / 2), b.ang, th, par, b.dpt - 2 * th, col, { row: ROW.plain, detail: true });
      const nPlant = b.w * b.dpt > 300 ? 2 + Math.floor(R() * 2) : 1;
      for (let i = 0; i < nPlant; i++) {
        const pw = 2.5 + R() * 4, pd = 2 + R() * 3, ph = 2.2 + R() * 1.8;
        const pa = (R() - 0.5) * (b.w - pw - 2), pdz = (R() - 0.5) * (b.dpt - pd - 2);
        this.box(b.cx + sa * pa + ca * pdz, yTop, b.cz + ca * pa - sa * pdz, b.ang, pw, ph, pd, new THREE.Color(0xd8d6d0), { row: ROW.plain, detail: true });
      }
      if (st === 'belle' || (b.near && st !== 'modern')) {
        // cornice: a projecting band round the top of the walls
        this.ring(b, yTop - 0.65, 0.65, 0.40, col, 0.9);
      }
    }
    // ---- near-circuit depth: balconies, string course, awnings ----
    if (b.near) {
      if (st === 'belle') this.ring(b, y0 + gH - 0.05, 0.35, 0.22, col, 0.88);       // string course over the base
      const balconyFaces = faces.filter(f => f.k === b.front || (st === 'modern' && f.len > 10 && R() < 0.6));
      for (const f of balconyFaces) {
        if (st === 'modern' || st === 'hotel') {
          // continuous balconies on every upper floor: slab + solid parapet
          for (let j = 0; j < nUp; j++) this.balcony(b, f, y0 + gH + j * fh, 0.3, f.len - 0.6, 1.35, 1.05, col, true);
        } else if (st === 'riviera' || st === 'belle') {
          // individual balconies on alternate bays, first two upper floors
          const nb = Math.max(1, Math.round(f.len / bayM));
          for (let j = 0; j < Math.min(nUp, st === 'belle' ? 3 : 2); j++) {
            for (let i = (j % 2); i < nb; i += 2) {
              const a = (i + 0.5) / nb * f.len - 0.5 * bayM * 0.8;
              this.balcony(b, f, y0 + gH + j * fh, a, bayM * 0.8, 0.85, 1.0, col, false);
            }
          }
        }
      }
      // awnings over the shopfronts on the circuit side
      if (b.front >= 0 && st !== 'old' && st !== 'hotel' && !b.noAwnings) {
        const f = faces[b.front];
        const nb = Math.max(1, Math.round(f.len / bayM));
        const set = Math.floor(R() * 4);
        for (let i = 0; i < nb; i++) {
          if (R() < 0.35) continue;
          const a = (i + 0.08) / nb * f.len, wA = f.len / nb * 0.84;
          this.awning(b, f, y0 + gH - 0.55, a, wA, 1.5, set);
        }
      }
    }
    return yTop;
  }
  // point at distance `a` along face f (from its start corner), height y, `out` metres outside
  _facePoint(b, f, a, y, out) {
    const ca = Math.cos(b.ang), sa = Math.sin(b.ang);
    const t = a / f.len;
    const la = f.a0 + (f.a1 - f.a0) * t, ld = f.d0 + (f.d1 - f.d0) * t;
    // outward normal in local (a, d): face 0 -> -d, 1 -> +a, 2 -> +d, 3 -> -a
    const n = [[0, -1], [1, 0], [0, 1], [-1, 0]][f.k];
    const A = la + n[0] * out, D = ld + n[1] * out;
    return [b.cx + sa * A + ca * D, y, b.cz + ca * A - sa * D];
  }
  balcony(b, f, y, a0, len, depth, rail, col, solid) {
    const bk = this._bucket(b.cx, b.cz, true);
    const [v0, v1] = vRow(ROW.plain);
    const t = 0.2;
    const p = (a, yy, o) => this._facePoint(b, f, a, yy, o);
    const a1 = a0 + len;
    // slab: top, underside (shaded), front edge, ends
    this.quad(bk, p(a0, y, depth), p(a1, y, depth), p(a0, y, 0), p(a1, y, 0), 0, 0.05, v0, v1, col, 0.95);
    this.quad(bk, p(a1, y - t, depth), p(a0, y - t, depth), p(a1, y - t, 0), p(a0, y - t, 0), 0, 0.05, v0, v1, col, 0.42);
    this.quad(bk, p(a0, y - t, depth), p(a1, y - t, depth), p(a0, y, depth), p(a1, y, depth), 0, 0.05, v0, v1, col, 0.9);
    this.quad(bk, p(a0, y - t, 0), p(a0, y - t, depth), p(a0, y, 0), p(a0, y, depth), 0, 0.05, v0, v1, col, 0.8);
    this.quad(bk, p(a1, y - t, depth), p(a1, y - t, 0), p(a1, y, depth), p(a1, y, 0), 0, 0.05, v0, v1, col, 0.8);
    // parapet (solid render) or wrought-iron rail (dark)
    const rc = solid ? col : new THREE.Color(0x2a2a2c);
    const rh = solid ? rail : rail * 0.95, rt = solid ? 0.12 : 0.04;
    this.quad(bk, p(a0, y, depth), p(a1, y, depth), p(a0, y + rh, depth), p(a1, y + rh, depth), 0, 0.05, v0, v1, rc, solid ? 1.0 : 1);
    this.quad(bk, p(a1, y, depth - rt), p(a0, y, depth - rt), p(a1, y + rh, depth - rt), p(a0, y + rh, depth - rt), 0, 0.05, v0, v1, rc, solid ? 0.8 : 1);
    this.quad(bk, p(a0, y + rh, depth), p(a1, y + rh, depth), p(a0, y + rh, depth - rt), p(a1, y + rh, depth - rt), 0, 0.05, v0, v1, rc, 1.05);
    this.quad(bk, p(a0, y, 0), p(a0, y, depth), p(a0, y + rh, 0), p(a0, y + rh, depth), 0, 0.05, v0, v1, rc, 0.85);
    this.quad(bk, p(a1, y, depth), p(a1, y, 0), p(a1, y + rh, depth), p(a1, y + rh, 0), 0, 0.05, v0, v1, rc, 0.85);
  }
  awning(b, f, y, a0, len, depth, set) {
    const bk = this._bucket(b.cx, b.cz, true);
    const [v0, v1] = vRow(ROW.awning);
    const u0 = set / 4, u1 = u0 + 0.25;
    const p = (a, yy, o) => this._facePoint(b, f, a, yy, o);
    const a1 = a0 + len, drop = 0.75;
    const w = new THREE.Color(0xffffff);
    // sloped canvas, its valance, the shaded underside and the end cheeks
    this.quad(bk, p(a0, y - drop, depth), p(a1, y - drop, depth), p(a0, y, 0), p(a1, y, 0), u0, u1, v0, v1, w, 1);
    this.quad(bk, p(a1, y - drop, depth), p(a0, y - drop, depth), p(a1, y, 0), p(a0, y, 0), u0, u1, v0, v1, w, 0.45);
    this.quad(bk, p(a0, y - drop - 0.28, depth), p(a1, y - drop - 0.28, depth), p(a0, y - drop, depth), p(a1, y - drop, depth), u0, u1, v0, v1, w, 0.92);
    this.tri(bk, p(a0, y - drop, depth), p(a0, y, 0), p(a0, y - drop, 0), [u0, v0], [u0, v1], [u0 + 0.01, v0], w, 0.75);
    this.tri(bk, p(a1, y, 0), p(a1, y - drop, depth), p(a1, y - drop, 0), [u0, v1], [u0, v0], [u0 + 0.01, v0], w, 0.75);
  }
  // projecting band round the walls (cornice / string course): top, front, shaded underside
  ring(b, y, h, out, col, f = 1) {
    const bk = this._bucket(b.cx, b.cz, true);
    const ca = Math.cos(b.ang), sa = Math.sin(b.ang);
    const hw = b.w / 2 + out, hd = b.dpt / 2 + out, iw = b.w / 2, id = b.dpt / 2;
    const P = (a, yy, d) => [b.cx + sa * a + ca * d, yy, b.cz + ca * a - sa * d];
    const O = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]], I = [[-iw, -id], [iw, -id], [iw, id], [-iw, id]];
    const [v0, v1] = vRow(ROW.plain);
    for (let k = 0; k < 4; k++) {
      const o0 = O[k], o1 = O[(k + 1) % 4], i0 = I[k], i1 = I[(k + 1) % 4];
      this.quad(bk, P(o0[0], y, o0[1]), P(o1[0], y, o1[1]), P(o0[0], y + h, o0[1]), P(o1[0], y + h, o1[1]), 0, 0.05, v0, v1, col, f);
      this.quad(bk, P(o0[0], y + h, o0[1]), P(o1[0], y + h, o1[1]), P(i0[0], y + h, i0[1]), P(i1[0], y + h, i1[1]), 0, 0.05, v0, v1, col, f * 1.05);
      this.quad(bk, P(i0[0], y, i0[1]), P(i1[0], y, i1[1]), P(o0[0], y, o0[1]), P(o1[0], y, o1[1]), 0, 0.05, v0, v1, col, f * 0.45);
    }
  }
  // free-standing retaining / terrace wall along a polyline of [x, z, yBottom, yTop]
  wall(pts, thick, col) {
    const [v0, v1] = vRow(ROW.stone);
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0, b0, t0] = pts[i], [x1, z1, b1, t1] = pts[i + 1];
      const bk = this._bucket(x0, z0);
      const len = Math.hypot(x1 - x0, z1 - z0), nx = (z1 - z0) / len * thick / 2, nz = -(x1 - x0) / len * thick / 2;
      const u = len / 6;
      // (dir x up = -n: the face on the -n side runs x0 -> x1, the +n face x1 -> x0)
      this.quad(bk, [x0 - nx, b0, z0 - nz], [x1 - nx, b1, z1 - nz], [x0 - nx, t0, z0 - nz], [x1 - nx, t1, z1 - nz], 0, u, v0, v1, col, 1);
      this.quad(bk, [x1 + nx, b1, z1 + nz], [x0 + nx, b0, z0 + nz], [x1 + nx, t1, z1 + nz], [x0 + nx, t0, z0 + nz], 0, u, v0, v1, col, 0.85);
      this.quad(bk, [x0 - nx, t0, z0 - nz], [x1 - nx, t1, z1 - nz], [x0 + nx, t0, z0 + nz], [x1 + nx, t1, z1 + nz], 0, u, v0, v0 + 0.004, col, 1.1);
    }
  }
  build(material, name = 'buildings') {
    const out = [];
    for (const bk of this.tiles.values()) {
      if (!bk.pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(bk.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(bk.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(bk.col, 3));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, material);
      m.name = bk.detail ? name + 'Detail' : name; m.matrixAutoUpdate = false;
      if (bk.detail) { m.layers.set(DETAIL_LAYER); m.userData.lodCenter = [bk.cx, bk.cz]; }
      out.push(m);
    }
    return out;
  }
}

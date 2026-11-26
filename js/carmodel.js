// Procedural RB20 (Monaco high-downforce spec) in the car frame of carspec.js.
// Everything is built from the measured dimension sheet so the visual model, the wheels and
// steering pivots, the collision points and the cameras share one coordinate system.
import * as THREE from 'three';
import { SPEC, Z, WHEELS, CAMERA_MOUNTS } from './carspec.js';
import { loft, chassisSection, sampleKeys, wingElement, sweep, strut, tyreGeometry, mergeGeoms } from './geom.js';
import { buildCockpit } from './cockpit.js';
import { buildHalo } from './halo.js';
import { buildHelmet } from './helmet.js';
import { fitText, projectDecal, decalMaterial, decalAtlas } from './decals.js';
import {
  applyAtlasUV, makeLiveryTexture, makeCarbonTextures, makeTyreTextures, makeWheelCoverTexture,
  NAVY, NAVY_DARK, RB_RED, RB_YELLOW,
} from './livery.js';

const q = (d) => Z.FA + d;          // z of a station d metres behind the front axle

// Planar box-projected UVs (for tiling carbon weave on arbitrary parts)
function boxUV(geom, tile = 0.05) {
  const g = geom.index ? geom.toNonIndexed() : geom;
  const p = g.attributes.position.array, uv = new Float32Array(p.length / 3 * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.length; i += 9) {
    a.fromArray(p, i); b.fromArray(p, i + 3); c.fromArray(p, i + 6);
    n.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const x = p[i + k * 3], y = p[i + k * 3 + 1], z = p[i + k * 3 + 2];
      let u, v;
      if (ax >= ay && ax >= az) { u = z; v = y; } else if (ay >= az) { u = z; v = x; } else { u = x; v = y; }
      uv[(i / 3 + k) * 2] = u / tile; uv[(i / 3 + k) * 2 + 1] = v / tile;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// Surface-following UVs for a loft (sections of equal point count, as built by loft()): u runs
// along the car, v round the section by arc length, both in metres / tile. Unlike box
// projection, a weave mapped this way flows continuously over rounded edges.
function loftUV(geom, secs, tile = 0.06) {
  const M = secs[0].pts.length, uv = new Float32Array(geom.attributes.position.count * 2);
  for (let si = 0; si < secs.length; si++) {
    let acc = 0;
    const pts = secs[si].pts;
    for (let i = 0; i < M; i++) {
      if (i > 0) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      uv[(si * M + i) * 2] = secs[si].z / tile; uv[(si * M + i) * 2 + 1] = acc / tile;
    }
  }
  for (let k = secs.length * M; k < geom.attributes.position.count; k++) { uv[k * 2] = 0; uv[k * 2 + 1] = 0; }
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geom;
}

function mirrorX(geom) {
  const g = geom.clone();
  g.scale(-1, 1, 1);
  // fix winding after mirroring
  if (g.index) {
    const ix = g.index.array;
    for (let t = 0; t < ix.length; t += 3) { const tmp = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = tmp; }
  } else {
    const attrs = Object.values(g.attributes);
    for (const at of attrs) {
      const s = at.itemSize, arr = at.array;
      for (let t = 0; t < arr.length; t += 3 * s) {
        for (let k = 0; k < s; k++) { const tmp = arr[t + s + k]; arr[t + s + k] = arr[t + 2 * s + k]; arr[t + 2 * s + k] = tmp; }
      }
    }
  }
  g.computeVertexNormals();
  return g;
}

// ---- sponsor artwork (text approximations of the 2024 wordmarks, no logo artwork) ----------
function drawBybitDecal(c, w, h) {
  c.save();
  const H = h * 0.88, fam = 'Helvetica Neue, Helvetica, Arial, sans-serif';
  c.font = `800 ${Math.round(H * 1.12)}px ${fam}`;
  if ('letterSpacing' in c) c.letterSpacing = `${(H * 0.06).toFixed(1)}px`;
  const wb = c.measureText('BYB').width, wt = c.measureText('T').width, bar = H * 0.17, gap = H * 0.16;
  const total = wb + gap + bar + gap + wt, sc = Math.min(1, (w * 0.94) / total);
  c.translate(w / 2 - total * sc / 2, h / 2 + H * 0.05); c.scale(sc, sc);
  c.fillStyle = '#f4f4f6'; c.textBaseline = 'middle'; c.textAlign = 'left';
  c.fillText('BYB', 0, 0);
  c.fillStyle = '#f7a600'; c.fillRect(wb + gap, -H * 0.42, bar, H * 0.84);
  c.fillStyle = '#f4f4f6'; c.fillText('T', wb + gap + bar + gap, 0);
  c.restore();
}
// ORACLE wordmark drawn from geometric glyphs (no font): stadium-shaped O and C, R with a
// stadium bowl and a straight diagonal leg, A without a full crossbar (the bar leaves the left
// leg and stops short of the right one), square terminals; stroke ~15 % of the cap height.
function drawOracle(c, w, h, color = '#ffffff') {
  const H = h * 0.92, t = H * 0.152, y0 = (h - H) / 2;
  // glyph advance widths in cap heights and the gap between glyphs
  const G = { O: 1.42, R: 0.95, A: 1.20, C: 1.22, L: 0.80, E: 0.84 }, gap = 0.13;
  const total = (G.O + G.R + G.A + G.C + G.L + G.E + gap * 5) * H;
  const sc = Math.min(1, w * 0.995 / total);
  c.save();
  c.translate((w - total * sc) / 2, y0 + H * (1 - sc) / 2); c.scale(sc, sc);
  c.fillStyle = color;
  const stadium = (x, y, ww, hh) => { const r = hh / 2; c.moveTo(x + r, y); c.lineTo(x + ww - r, y); c.arc(x + ww - r, y + r, r, -Math.PI / 2, Math.PI / 2); c.lineTo(x + r, y + hh); c.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5); c.closePath(); };
  const stadiumRev = (x, y, ww, hh) => { const r = hh / 2; c.moveTo(x + r, y); c.arc(x + r, y + r, r, -Math.PI / 2, -Math.PI * 1.5, true); c.lineTo(x + ww - r, y + hh); c.arc(x + ww - r, y + r, r, Math.PI / 2, -Math.PI / 2, true); c.closePath(); };
  let x = 0;
  // O
  c.beginPath(); stadium(x, 0, G.O * H, H); stadiumRev(x + t, t, G.O * H - 2 * t, H - 2 * t); c.fill('evenodd');
  x += (G.O + gap) * H;
  // R: stem, bowl (upper 56 %), diagonal leg
  {
    const bh = H * 0.56, bw = G.R * H * 0.96;
    c.beginPath(); c.rect(x, 0, t, H); c.fill();
    c.beginPath();
    const r = bh / 2;
    c.moveTo(x, 0); c.lineTo(x + bw - r, 0); c.arc(x + bw - r, r, r, -Math.PI / 2, Math.PI / 2); c.lineTo(x, bh); c.closePath();
    const ri = r - t;
    c.moveTo(x + t, t); c.lineTo(x + t, bh - t); c.lineTo(x + bw - r, bh - t); c.arc(x + bw - r, r, ri, Math.PI / 2, -Math.PI / 2, true); c.closePath();
    c.fill('evenodd');
    // leg from the bowl's lower edge to the baseline at the right
    const lx0 = x + bw * 0.42, lx1 = x + G.R * H;
    c.beginPath(); c.moveTo(lx0, bh - t * 0.2); c.lineTo(lx0 + t * 1.25, bh - t * 0.2); c.lineTo(lx1, H); c.lineTo(lx1 - t * 1.3, H); c.closePath(); c.fill();
  }
  x += (G.R + gap) * H;
  // A: two legs meeting in a narrow flat apex; bar from the left leg, short of the right
  {
    const aw = G.A * H, ax = x + aw / 2, tw = t * 1.22;
    c.beginPath(); c.moveTo(x, H); c.lineTo(ax - tw * 0.35, 0); c.lineTo(ax + tw * 0.35, 0); c.lineTo(x + aw, H); c.lineTo(x + aw - tw, H); c.lineTo(ax, tw * 0.95); c.lineTo(x + tw, H); c.closePath(); c.fill();
    const by = H * 0.70, k = (H - by) / H;
    const leftX = x + aw / 2 * (1 - (by + t) / H) + tw * 0.2;
    c.beginPath(); c.rect(leftX, by, (x + aw - tw * 1.05 - aw / 2 * k) - leftX - t * 0.75, t); c.fill();
  }
  x += (G.A + gap) * H;
  // C: stadium open on the right
  {
    const cw = G.C * H, r = H / 2;
    c.beginPath();
    c.moveTo(x + cw, 0); c.lineTo(x + r, 0); c.arc(x + r, r, r, -Math.PI / 2, Math.PI / 2, true); c.lineTo(x + cw, H); c.lineTo(x + cw, H - t); c.lineTo(x + r, H - t);
    c.arc(x + r, r, r - t, Math.PI / 2, -Math.PI / 2, false); c.lineTo(x + cw, t); c.closePath(); c.fill();
  }
  x += (G.C + gap) * H;
  // L
  c.beginPath(); c.rect(x, 0, t, H); c.rect(x, H - t, G.L * H, t); c.fill();
  x += (G.L + gap) * H;
  // E (middle arm slightly shorter)
  c.beginPath(); c.rect(x, 0, t, H); c.rect(x, 0, G.E * H, t); c.rect(x, (H - t) / 2, G.E * H * 0.9, t); c.rect(x, H - t, G.E * H, t); c.fill();
  c.restore();
}
// RAUCH badge: orange-yellow oval with a dark red rim and a fine light inner line, the red
// fruit mark at the left and heavy black lettering
function drawRauch(c, w, h) {
  const cx = w / 2, cy = h / 2, rx = w * 0.485, ry = h * 0.465;
  c.fillStyle = '#7a1d14'; c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); c.fill();
  const g = c.createLinearGradient(0, cy - ry, 0, cy + ry);
  g.addColorStop(0, '#f08a1c'); g.addColorStop(0.55, '#f6a523'); g.addColorStop(1, '#f9bf3a');
  c.fillStyle = g; c.beginPath(); c.ellipse(cx, cy, rx - h * 0.055, ry - h * 0.055, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(255,214,140,0.85)'; c.lineWidth = h * 0.018;
  c.beginPath(); c.ellipse(cx, cy, rx - h * 0.085, ry - h * 0.085, 0, 0, Math.PI * 2); c.stroke();
  // fruit mark: round red body with a lighter cheek and a small stalk / leaf
  const fx = w * 0.205, fy = h * 0.52, fr = h * 0.20;
  c.fillStyle = '#c4141f'; c.beginPath(); c.arc(fx, fy, fr, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.arc(fx - fr * 0.15, fy - fr * 0.95, fr * 0.55, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(255,120,110,0.55)'; c.beginPath(); c.arc(fx - fr * 0.38, fy - fr * 0.25, fr * 0.30, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#2d6b1f'; c.beginPath(); c.ellipse(fx + fr * 0.45, fy - fr * 1.45, fr * 0.42, fr * 0.16, -0.5, 0, Math.PI * 2); c.fill();
  c.save(); c.translate(w * 0.115, 0);
  fitText(c, w * 0.80, h, 'RAUCH', { color: '#141010', weight: 900, stretch: 0.98, letter: -0.02, pad: 0.24, family: 'Arial Black, Helvetica Neue, Arial, sans-serif' });
  c.restore();
}
function drawRokt(c, w, h) {
  fitText(c, w, h, 'ROKT', { color: '#ffffff', weight: 900, stretch: 1.42, letter: 0.03, pad: 0.03, family: 'Arial Black, Helvetica Neue, Arial, sans-serif' });
}
function drawTagWide(c, w, h) {
  // TAG Heuer badge as on the chassis top: white frame, red upper field (TAG), green lower (HEUER)
  const m = h * 0.07, r = h * 0.18;
  const box = (x, y, ww, hh, rr) => { c.beginPath(); c.moveTo(x + rr, y); c.lineTo(x + ww - rr, y); c.quadraticCurveTo(x + ww, y, x + ww, y + rr); c.lineTo(x + ww, y + hh - rr); c.quadraticCurveTo(x + ww, y + hh, x + ww - rr, y + hh); c.lineTo(x + rr, y + hh); c.quadraticCurveTo(x, y + hh, x, y + hh - rr); c.lineTo(x, y + rr); c.quadraticCurveTo(x, y, x + rr, y); c.closePath(); };
  c.fillStyle = '#ffffff'; box(m, m, w - 2 * m, h - 2 * m, r); c.fill();
  const b = h * 0.07, mid = h / 2;
  c.save(); box(m + b, m + b, w - 2 * (m + b), h - 2 * (m + b), r * 0.7); c.clip();
  c.fillStyle = '#d6001c'; c.fillRect(0, 0, w, mid - b * 0.3);
  c.fillStyle = '#00843d'; c.fillRect(0, mid + b * 0.3, w, h);
  c.restore();
  c.save(); c.translate(0, m + b); fitText(c, w, mid - m - b * 1.2, 'TAG', { color: '#ffffff', weight: 900, stretch: 1.6, pad: 0.12 }); c.restore();
  c.save(); c.translate(0, mid + b * 0.3); fitText(c, w, mid - m - b * 1.2, 'HEUER', { color: '#ffffff', weight: 900, stretch: 1.5, pad: 0.12 }); c.restore();
}
function drawNumberOne(c, w, h) {
  // the car number: a heavy red "1" with a long flag
  c.fillStyle = '#e2232b';
  const bw = w * 0.30, x0 = w * 0.50;
  c.fillRect(x0, h * 0.06, bw, h * 0.88);                    // stem
  c.beginPath(); c.moveTo(x0, h * 0.06); c.lineTo(x0 - w * 0.36, h * 0.06); c.lineTo(x0 - w * 0.36, h * 0.30); c.lineTo(x0, h * 0.42); c.closePath(); c.fill();
}
function drawNoseStack(c, w, h) {
  // VISA / CDW / ZOOM / ARCTIC WOLF / PIRELLI / infinitum / Mobil 1, top (rear) to bottom (front)
  const rows = [
    ['VISA', 0.15, { weight: 900, stretch: 1.25, italic: true }],
    ['CDW', 0.135, { weight: 900, stretch: 1.25 }],
    ['zoom', 0.13, { weight: 800, stretch: 1.25 }],
    ['ARCTIC WOLF', 0.14, { weight: 800, stretch: 0.95 }],
    ['PIRELLI', 0.125, { weight: 900, stretch: 1.3 }],
    ['infinitum', 0.125, { weight: 800, stretch: 1.1 }],
    ['Mobil 1', 0.135, { weight: 800, stretch: 1.15 }],
  ];
  const gap = 0.007;
  let y = 0;
  for (const [t, f, o] of rows) {
    const hh = f * h;
    c.save(); c.translate(0, y); fitText(c, w, hh, t, { color: '#f4f4f6', pad: 0.06, ...o }); c.restore();
    if (t === 'CDW') { c.strokeStyle = '#f4f4f6'; c.lineWidth = hh * 0.07; c.beginPath(); c.ellipse(w / 2, y + hh / 2, w * 0.36, hh * 0.44, 0, 0, Math.PI * 2); c.stroke(); }
    y += hh + gap * h;
  }
}

// ---------------------------------------------------------------------------------------------
export function createCar({ quality = 'high', debugColors = false } = {}) {
  const hi = quality !== 'low';
  const tex = {
    livery: makeLiveryTexture(hi ? 2048 : 1024),
    carbon: makeCarbonTextures(),
    tyre: makeTyreTextures(),
    cover: makeWheelCoverTexture(),
  };
  const M = {
    // material responses (outdoor sky env): matte paint = broad soft sheen; exposed carbon =
    // dark weave under a hard glossy clear coat (sharp reflections); satin black halo; rubber =
    // rough, no sheen except at grazing angles; titanium / steel hardware = metallic
    // satin navy paint: a rough, weakly reflecting base (satin pigment, F0 ~2 %) under a thin
    // semi-gloss clear coat, so curved shoulders carry a narrow sun highlight and a soft sky
    // sheen while the panels still read deep navy rather than silver at grazing angles
    body: hi
      ? new THREE.MeshPhysicalMaterial({ map: tex.livery, roughness: 0.58, metalness: 0.0, specularIntensity: 0.45, clearcoat: 0.32, clearcoatRoughness: 0.14, envMapIntensity: 0.9 })
      : new THREE.MeshStandardMaterial({ map: tex.livery, roughness: 0.42, metalness: 0.0, envMapIntensity: 1.0 }),
    navy: hi
      ? new THREE.MeshPhysicalMaterial({ color: NAVY, roughness: 0.58, metalness: 0.0, specularIntensity: 0.45, clearcoat: 0.32, clearcoatRoughness: 0.14, envMapIntensity: 0.9 })
      : new THREE.MeshStandardMaterial({ color: NAVY, roughness: 0.42, metalness: 0.0, envMapIntensity: 1.0 }),
    navyDark: new THREE.MeshStandardMaterial({ color: NAVY_DARK, roughness: 0.56, metalness: 0.0, envMapIntensity: 0.85 }),
    red: new THREE.MeshStandardMaterial({ color: RB_RED, roughness: 0.45, metalness: 0.05 }),
    yellow: new THREE.MeshStandardMaterial({ color: RB_YELLOW, roughness: 0.45 }),
    carbon: hi
      ? new THREE.MeshPhysicalMaterial({ color: 0x9a9aa2, map: tex.carbon.map, normalMap: tex.carbon.normal, normalScale: new THREE.Vector2(0.16, 0.16), roughness: 0.40, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.07, envMapIntensity: 1.0 })
      : new THREE.MeshStandardMaterial({ color: 0x9a9aa2, map: tex.carbon.map, roughness: 0.3, metalness: 0.0, envMapIntensity: 1.0 }),
    carbonMatte: new THREE.MeshStandardMaterial({ color: 0x74747a, map: tex.carbon.map, normalMap: tex.carbon.normal, normalScale: new THREE.Vector2(0.12, 0.12), roughness: 0.80, metalness: 0.0, envMapIntensity: 0.6 }),
    // sculpted floor bodywork: exposed carbon under a clear coat, a little softer than the wings
    // so its curvature shows as a broad, moving reflection; weave kept faint for motion
    carbonBody: hi
      ? new THREE.MeshPhysicalMaterial({ color: 0xd0d0d6, map: tex.carbon.map, normalMap: tex.carbon.normal, normalScale: new THREE.Vector2(0.10, 0.10), roughness: 0.46, metalness: 0.0, clearcoat: 0.9, clearcoatRoughness: 0.14, envMapIntensity: 1.1 })
      : new THREE.MeshStandardMaterial({ color: 0xd0d0d6, map: tex.carbon.map, roughness: 0.34, metalness: 0.0, envMapIntensity: 1.1 }),
    tyre: new THREE.MeshStandardMaterial({ map: tex.tyre.map, roughnessMap: tex.tyre.roughness, roughness: 1.0, metalness: 0, envMapIntensity: 0.8 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.35, metalness: 0.7 }),
    cover: new THREE.MeshStandardMaterial({ map: tex.cover, roughness: 0.42, metalness: 0.25 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xa9aeb6, roughness: 0.30, metalness: 0.95 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.75 }),
    anodised: new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.38, metalness: 0.85 }),
    inlet: new THREE.MeshStandardMaterial({ color: 0x050507, roughness: 0.9 }),
    duct: new THREE.MeshStandardMaterial({ color: 0x07080b, roughness: 0.85, side: THREE.DoubleSide }),
    pad: new THREE.MeshStandardMaterial({ color: 0x0d1226, roughness: 0.92 }),
    suit: new THREE.MeshStandardMaterial({ color: 0x1b2850, roughness: 0.85 }),
    mirror: new THREE.MeshStandardMaterial({ color: 0x8fa3b8, roughness: 0.04, metalness: 1.0 }),
    lightOff: new THREE.MeshStandardMaterial({ color: 0x400606, emissive: 0xff1010, emissiveIntensity: 0.0, roughness: 0.3 }),
    exhaust: new THREE.MeshStandardMaterial({ color: 0x5a5560, roughness: 0.4, metalness: 0.9 }),
    wing: hi
      ? new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.08, envMapIntensity: 1.0 })
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.0 }),
    display: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0x2266ff, emissiveIntensity: 0.25, roughness: 0.2 }),
  };

  // tyre lettering blurs into rings with wheel speed (no strobing / shimmer at speed)
  {
    const u = { value: 0 };
    M.tyre.userData.spinBlur = u;
    M.tyre.onBeforeCompile = (sh) => {
      sh.uniforms.mapBlur = { value: tex.tyre.mapBlur };
      sh.uniforms.spinBlur = u;
      sh.fragmentShader = sh.fragmentShader
        .replace('void main() {', 'uniform sampler2D mapBlur;\nuniform float spinBlur;\nvoid main() {')
        .replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(mapBlur, vMapUv).rgb, spinBlur);');
    };
    M.tyre.customProgramCacheKey = () => 'tyreSpinBlur';
  }

  const root = new THREE.Group(); root.name = 'RB20';
  const chassis = new THREE.Group(); chassis.name = 'chassis';   // sprung mass (pitch/roll)
  root.add(chassis);
  const parts = {};      // damage groups
  const add = (parent, geom, mat, name, opts = {}) => {
    const m = new THREE.Mesh(geom, mat);
    m.name = name || '';
    m.castShadow = opts.shadow ?? true;
    // self-shadowing (the halo, mirrors, wheels and wings shade the bodywork and its logos)
    m.receiveShadow = opts.receive ?? hi;
    parent.add(m);
    return m;
  };
  const group = (parent, name) => { const g = new THREE.Group(); g.name = name; parent.add(g); return g; };

  // =============================================================================================
  // SURVIVAL CELL + NOSE (one loft, with the cockpit opening formed by the section "dip")
  const CH = [
    { z: q(-1.270), w: 0.060, wTop: 0.045, top: 0.262, bot: 0.168, rt: 0.040, rb: 0.035, cw: 0, dip: 0 },
    { z: q(-1.215), w: 0.084, wTop: 0.066, top: 0.278, bot: 0.160, rt: 0.050, rb: 0.040, cw: 0, dip: 0 },
    { z: q(-1.000), w: 0.116, wTop: 0.090, top: 0.316, bot: 0.163, rt: 0.060, rb: 0.045, cw: 0, dip: 0 },
    { z: q(-0.700), w: 0.146, wTop: 0.113, top: 0.366, bot: 0.175, rt: 0.065, rb: 0.050, cw: 0, dip: 0 },
    { z: q(-0.400), w: 0.170, wTop: 0.133, top: 0.424, bot: 0.190, rt: 0.070, rb: 0.050, cw: 0, dip: 0 },
    { z: q(-0.150), w: 0.186, wTop: 0.148, top: 0.474, bot: 0.200, rt: 0.070, rb: 0.050, cw: 0, dip: 0 },
    { z: q(0.000), w: 0.196, wTop: 0.158, top: 0.505, bot: 0.205, rt: 0.070, rb: 0.050, cw: 0, dip: 0 },
    // 2024 side reference: the chassis sides stay near-vertical up to ~0.60 m ahead of the
    // cockpit (BYBIT sits on that flat face, the red line running through its lower half), the
    // rim rises towards the rear of the opening, and the cockpit ends in broad rounded shoulders
    // at ~0.75 m - the halo legs run into them and ROKT sits on the vertical wall below
    { z: q(0.300), w: 0.226, wTop: 0.198, top: 0.560, bot: 0.150, rt: 0.055, rb: 0.040, cw: 0, dip: 0 },
    { z: q(0.600), w: 0.256, wTop: 0.236, top: 0.612, bot: 0.085, rt: 0.040, rb: 0.030, cw: 0, dip: 0 },
    { z: q(0.900), w: 0.282, wTop: 0.262, top: 0.638, bot: 0.062, rt: 0.040, rb: 0.030, cw: 0, dip: 0 },
    { z: q(1.040), w: 0.294, wTop: 0.272, top: 0.652, bot: 0.058, rt: 0.044, rb: 0.030, cw: 0.0, dip: 0 },
    { z: q(1.110), w: 0.300, wTop: 0.278, top: 0.662, bot: 0.058, rt: 0.046, rb: 0.030, cw: 0.17, dip: 0.13 },
    { z: q(1.230), w: 0.308, wTop: 0.286, top: 0.680, bot: 0.058, rt: 0.050, rb: 0.030, cw: 0.232, dip: 0.30 },
    { z: q(1.450), w: 0.318, wTop: 0.296, top: 0.712, bot: 0.058, rt: 0.056, rb: 0.030, cw: 0.244, dip: 0.36 },
    { z: q(1.600), w: 0.326, wTop: 0.304, top: 0.740, bot: 0.058, rt: 0.060, rb: 0.030, cw: 0.240, dip: 0.39 },
    { z: q(1.700), w: 0.330, wTop: 0.306, top: 0.752, bot: 0.058, rt: 0.062, rb: 0.030, cw: 0.230, dip: 0.39 },
    { z: q(1.780), w: 0.326, wTop: 0.298, top: 0.760, bot: 0.058, rt: 0.064, rb: 0.030, cw: 0.196, dip: 0.30 },
    { z: q(1.830), w: 0.312, wTop: 0.270, top: 0.800, bot: 0.058, rt: 0.065, rb: 0.030, cw: 0.09, dip: 0.10 },
    { z: q(1.865), w: 0.290, wTop: 0.220, top: 0.870, bot: 0.060, rt: 0.068, rb: 0.030, cw: 0, dip: 0 },
    { z: q(1.910), w: 0.262, wTop: 0.150, top: 0.925, bot: 0.065, rt: 0.070, rb: 0.030, cw: 0, dip: 0 },
  ];
  const zs = [];
  for (let z = CH[0].z; z <= CH[CH.length - 1].z + 1e-6; z += 0.035) zs.push(z);
  // denser stations near the tip and through the cockpit lips
  const chassisSecs = zs.map(z => ({ z, pts: chassisSection(sampleKeys(CH, z)) }));
  const chassisGeom = applyAtlasUV(loft(chassisSecs, { capStart: true, capEnd: true }));
  chassisGeom.computeVertexNormals();
  // nose tip part (detachable) = stations ahead of q(-0.55); fixed chassis behind.
  const noseSplit = q(-0.55);
  const noseSecs = chassisSecs.filter(s => s.z <= noseSplit + 1e-6);
  noseSecs.push({ z: noseSplit, pts: chassisSection(sampleKeys(CH, noseSplit)) });
  const tubSecs = [{ z: noseSplit, pts: chassisSection(sampleKeys(CH, noseSplit)) }, ...chassisSecs.filter(s => s.z > noseSplit + 1e-6)];
  const noseGroup = group(chassis, 'nose');
  parts.nose = noseGroup;
  add(noseGroup, applyAtlasUV(loft(noseSecs, { capStart: true, capEnd: true })), M.body, 'noseTip');
  add(chassis, applyAtlasUV(loft(tubSecs, { capStart: false, capEnd: true })), M.body, 'tub');
  chassisGeom.dispose();

  // cockpit interior floor/seat shadow (dark) so the opening reads as deep
  {
    const g = new THREE.BoxGeometry(0.42, 0.02, 0.62);
    g.translate(0, 0.36, q(1.46));
    add(chassis, g, M.inlet, 'cockpitFloor', { shadow: false });
  }

  // =============================================================================================
  // ENGINE COVER + AIRBOX + GEARBOX
  const EC = [
    { z: q(1.850), w: 0.196, wTop: 0.112, top: 0.952, bot: 0.300, rt: 0.085, rb: 0.050 },
    { z: q(1.980), w: 0.228, wTop: 0.136, top: 0.946, bot: 0.250, rt: 0.090, rb: 0.050 },
    { z: q(2.200), w: 0.250, wTop: 0.150, top: 0.884, bot: 0.215, rt: 0.090, rb: 0.050 },
    { z: q(2.500), w: 0.246, wTop: 0.142, top: 0.784, bot: 0.200, rt: 0.085, rb: 0.050 },
    { z: q(2.850), w: 0.212, wTop: 0.120, top: 0.684, bot: 0.200, rt: 0.075, rb: 0.050 },
    { z: q(3.200), w: 0.160, wTop: 0.092, top: 0.580, bot: 0.205, rt: 0.060, rb: 0.045 },
    { z: Z.RA, w: 0.112, wTop: 0.066, top: 0.505, bot: 0.220, rt: 0.045, rb: 0.040 },
    { z: Z.RA + 0.28, w: 0.080, wTop: 0.050, top: 0.455, bot: 0.245, rt: 0.035, rb: 0.035 },
    { z: Z.RA + 0.40, w: 0.062, wTop: 0.042, top: 0.432, bot: 0.262, rt: 0.030, rb: 0.030 },
  ];
  const ecSecs = [];
  for (let z = EC[0].z; z <= EC[EC.length - 1].z + 1e-6; z += 0.05) ecSecs.push({ z, pts: chassisSection(sampleKeys(EC, z)) });
  add(chassis, applyAtlasUV(loft(ecSecs)), M.body, 'engineCover');
  // airbox inlet: rounded triangle opening facing forward, at the top of the roll hoop
  {
    const s = new THREE.Shape();
    s.moveTo(0, 0.948); s.bezierCurveTo(0.07, 0.948, 0.105, 0.935, 0.098, 0.905);
    s.bezierCurveTo(0.085, 0.86, 0.04, 0.83, 0, 0.82);
    s.bezierCurveTo(-0.04, 0.83, -0.085, 0.86, -0.098, 0.905);
    s.bezierCurveTo(-0.105, 0.935, -0.07, 0.948, 0, 0.948);
    const g = new THREE.ShapeGeometry(s, 10);
    g.translate(0, 0, q(1.846));
    add(chassis, g, M.inlet, 'airboxInlet', { shadow: false });
    const lip = new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: false, curveSegments: 10 });
    lip.scale(1.12, 1, 1); lip.translate(0, -0.105, q(1.846) + 0.002);
    // (lip is hidden inside the engine cover except for its rim)
  }
  // T-cam pod on the roll hoop (black on car #1)
  const tcamPod = group(chassis, 'tcamPod');
  {
    const g = new THREE.BoxGeometry(0.11, 0.032, 0.05); g.translate(0, 0.968, q(1.905));
    add(tcamPod, g, M.black, 'tcam');
    for (const sx of [-1, 1]) {
      const f = new THREE.BoxGeometry(0.012, 0.03, 0.04); f.translate(sx * 0.045, 0.995, q(1.905));
      add(tcamPod, f, M.black, 'tcamEar');
    }
  }
  // gearbox / rear crash structure + rear light + exhaust
  {
    const gb = new THREE.BoxGeometry(0.10, 0.13, 0.32);
    gb.translate(0, 0.305, Z.RA + 0.46);
    add(chassis, boxUV(gb), M.carbon, 'crashStructure');
    const light = new THREE.BoxGeometry(0.07, 0.035, 0.012);
    light.translate(0, 0.30, Z.RA + 0.625);
    const lightMesh = add(chassis, light, M.lightOff, 'rearLight', { shadow: false });
    root.userData.rearLight = lightMesh;
    const ex = new THREE.CylinderGeometry(0.046, 0.05, 0.16, 18, 1, true);
    ex.rotateX(Math.PI / 2); ex.translate(0, 0.415, Z.RA + 0.53);
    add(chassis, ex, M.exhaust, 'exhaust');
    const exIn = new THREE.CircleGeometry(0.044, 18); exIn.translate(0, 0.415, Z.RA + 0.59);
    add(chassis, exIn, M.inlet, 'exhaustInner', { shadow: false });
  }

  // =============================================================================================
  // SIDEPODS (RB20: narrow letterbox inlet under an overbite, deep undercut, downwash ramp)
  // (2024 side photo: the inlet sits just behind the mirrors at ~1.0 m behind the front axle,
  // the sidepod's flank runs from there; the section grows to full width by ~1.6 m)
  const SP = [
    { z: q(1.000), xc: 0.430, w: 0.125, wTop: 0.112, top: 0.586, bot: 0.432, rt: 0.050, rb: 0.060 },
    { z: q(1.200), xc: 0.448, w: 0.150, wTop: 0.138, top: 0.594, bot: 0.405, rt: 0.056, rb: 0.080 },
    { z: q(1.450), xc: 0.462, w: 0.185, wTop: 0.165, top: 0.606, bot: 0.360, rt: 0.068, rb: 0.110 },
    { z: q(1.600), xc: 0.478, w: 0.215, wTop: 0.188, top: 0.620, bot: 0.300, rt: 0.080, rb: 0.140 },
    { z: q(1.900), xc: 0.478, w: 0.238, wTop: 0.205, top: 0.604, bot: 0.220, rt: 0.100, rb: 0.160 },
    { z: q(2.300), xc: 0.440, w: 0.228, wTop: 0.190, top: 0.552, bot: 0.180, rt: 0.100, rb: 0.140 },
    { z: q(2.700), xc: 0.380, w: 0.200, wTop: 0.160, top: 0.470, bot: 0.160, rt: 0.090, rb: 0.100 },
    { z: q(3.050), xc: 0.300, w: 0.150, wTop: 0.110, top: 0.380, bot: 0.150, rt: 0.070, rb: 0.060 },
    { z: q(3.350), xc: 0.220, w: 0.100, wTop: 0.070, top: 0.312, bot: 0.150, rt: 0.050, rb: 0.040 },
  ];
  for (const side of [1, -1]) {
    const nm = side > 0 ? 'sidepodR' : 'sidepodL';
    const g = group(chassis, nm); parts[nm] = g;
    const secs = [];
    for (let z = SP[0].z; z <= SP[SP.length - 1].z + 1e-6; z += 0.05) {
      const k = sampleKeys(SP, z);
      const pts = chassisSection(k).map(([x, y]) => [side * (k.xc + x), y]);
      if (side < 0) pts.reverse();
      secs.push({ z, pts });
    }
    const geo = applyAtlasUV(loft(secs, { capStart: false, capEnd: true }));
    add(g, geo, M.body, nm + 'Body');
    // inlet face (dark) with the letterbox slot
    const face = new THREE.Shape(secs[0].pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const fg = new THREE.ShapeGeometry(face); fg.translate(0, 0, SP[0].z - 0.001);
    add(g, fg, M.navyDark, nm + 'Face', { shadow: false });
    const slot = new THREE.Shape();
    const x0 = side * 0.335, x1 = side * 0.585, y0 = 0.452, y1 = 0.548;
    slot.moveTo(x0, y0); slot.lineTo(x1, y0 + 0.01); slot.lineTo(x1, y1 - 0.012); slot.lineTo(x0, y1); slot.closePath();
    const sg = new THREE.ShapeGeometry(slot); sg.translate(0, 0, SP[0].z + 0.14);
    add(g, sg, M.inlet, nm + 'InletBack', { shadow: false });
    {
      // duct walls from the slot mouth 0.14 m into the sidepod (tapering slightly)
      const mouth = [[x0, y0], [x1, y0 + 0.01], [x1, y1 - 0.012], [x0, y1]];
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const secs = [0, 0.05, 0.10, 0.14].map((dz, i) => ({ z: SP[0].z - 0.004 + dz, pts: mouth.map(([x, y]) => [cx + (x - cx) * (1 - 0.06 * i), cy + (y - cy) * (1 - 0.10 * i)]) }));
      const dg = loft(secs, { capStart: false, capEnd: false });
      add(g, dg, M.duct, nm + 'InletDuct', { shadow: false });
      // overbite lip above the mouth
      const lip = strut([x0, y1 + 0.012, SP[0].z - 0.03], [x1, y1 + 0.004, SP[0].z - 0.03], 0.06, 0.012);
      add(g, lip, M.navy, nm + 'InletLip');
    }
    // cooling louvres / exit on the engine cover side (dark slots)
    for (let k = 0; k < 4; k++) {
      const lg = new THREE.BoxGeometry(0.008, 0.012, 0.09);
      lg.translate(side * 0.205, 0.64 - k * 0.022, q(2.62 + k * 0.03));
      add(g, lg, M.inlet, nm + 'Louvre', { shadow: false });
    }
  }

  // =============================================================================================
  // COCKPIT SHOULDERS behind the halo feet: rounded ridges that carry on past the airbox and
  // ease down into the sidepod tops (2024 side reference: the tubular shoulder above ROKT that
  // runs back along the airbox flank and catches a long highlight)
  {
    const SH = [
      { z: q(1.790), xc: 0.262, w: 0.064, wTop: 0.056, top: 0.760, bot: 0.540, rt: 0.052, rb: 0.020 },
      { z: q(1.950), xc: 0.268, w: 0.062, wTop: 0.054, top: 0.762, bot: 0.540, rt: 0.052, rb: 0.020 },
      { z: q(2.150), xc: 0.272, w: 0.058, wTop: 0.050, top: 0.742, bot: 0.520, rt: 0.048, rb: 0.020 },
      { z: q(2.350), xc: 0.270, w: 0.052, wTop: 0.044, top: 0.705, bot: 0.500, rt: 0.042, rb: 0.020 },
      { z: q(2.550), xc: 0.262, w: 0.044, wTop: 0.036, top: 0.655, bot: 0.480, rt: 0.034, rb: 0.018 },
      { z: q(2.700), xc: 0.250, w: 0.034, wTop: 0.026, top: 0.600, bot: 0.470, rt: 0.024, rb: 0.016 },
    ];
    for (const side of [1, -1]) {
      const secs = [];
      for (let z = SH[0].z; z <= SH[SH.length - 1].z + 1e-6; z += 0.04) {
        const k = sampleKeys(SH, z);
        const pts = chassisSection(k).map(([x, y]) => [side * (k.xc + x), y]);
        if (side < 0) pts.reverse();
        secs.push({ z, pts });
      }
      add(chassis, applyAtlasUV(loft(secs, { capStart: true, capEnd: true })), M.body, 'shoulder' + (side > 0 ? 'R' : 'L'));
    }
  }

  // =============================================================================================
  // FLOOR BODY: the sculpted exposed-carbon bodywork between the floor and the sidepod undercut
  // (2024 side reference: RAUCH sits on its near-vertical leading wall; behind it the surface
  // rolls outward and down into the floor edge in a long curve that carries a broad reflection)
  {
    // per station: inner x (inside the chassis), wall x, wall top, skirt end x (floor edge), skirt height
    const FB = [
      { d: 0.52, xi: 0.18, xw: 0.240, top: 0.300, xo: 0.30, yo: 0.030, r: 0.040, wf: 0.030, yb: 0.026 },
      { d: 0.62, xi: 0.20, xw: 0.268, top: 0.300, xo: 0.44, yo: 0.030, r: 0.045, wf: 0.030, yb: 0.026 },
      { d: 0.80, xi: 0.22, xw: 0.300, top: 0.255, xo: 0.66, yo: 0.034, r: 0.050, wf: 0.034, yb: 0.028 },
      { d: 0.98, xi: 0.24, xw: 0.335, top: 0.175, xo: 0.80, yo: 0.060, r: 0.050, wf: 0.070, yb: 0.045 },
      { d: 1.30, xi: 0.26, xw: 0.390, top: 0.150, xo: 0.86, yo: 0.082, r: 0.050, wf: 0.110, yb: 0.062 },
      { d: 1.70, xi: 0.28, xw: 0.450, top: 0.160, xo: 0.87, yo: 0.086, r: 0.056, wf: 0.120, yb: 0.068 },
      { d: 2.20, xi: 0.26, xw: 0.480, top: 0.160, xo: 0.87, yo: 0.088, r: 0.056, wf: 0.122, yb: 0.070 },
      { d: 2.60, xi: 0.22, xw: 0.450, top: 0.150, xo: 0.84, yo: 0.090, r: 0.052, wf: 0.118, yb: 0.072 },
      { d: 2.90, xi: 0.20, xw: 0.380, top: 0.135, xo: 0.72, yo: 0.092, r: 0.045, wf: 0.112, yb: 0.074 },
      { d: 3.10, xi: 0.18, xw: 0.300, top: 0.118, xo: 0.58, yo: 0.094, r: 0.035, wf: 0.106, yb: 0.076 },
    ];
    const lerpKey = (d) => {
      let i = 0; while (i < FB.length - 2 && FB[i + 1].d < d) i++;
      const a = FB[i], b = FB[i + 1], t = Math.max(0, Math.min(1, (d - a.d) / (b.d - a.d))), ts = t * t * (3 - 2 * t);
      const o = {}; for (const k of Object.keys(a)) o[k] = a[k] + (b[k] - a[k]) * ts; return o;
    };
    // closed section (x >= 0, mirrored by side): bottom, skirt rising from the floor edge into
    // the wall, rounded top corner, flat top back to the chassis
    const section = (k, side) => {
      const pts = [];
      const yb = k.yb;
      pts.push([k.xi, yb], [k.xo, yb], [k.xo, k.yo]);
      // skirt: concave sweep from the floor edge up to the wall foot
      const wallFoot = Math.min(k.top - k.r - 0.005, k.wf);
      for (let i = 1; i <= 7; i++) {
        const t = i / 7;
        const x = k.xo + (k.xw - k.xo) * t;
        const y = k.yo + (wallFoot - k.yo) * Math.pow(t, 2.2);
        pts.push([x, y]);
      }
      // wall up to the corner, rounded corner, top back inboard
      for (let i = 1; i <= 3; i++) pts.push([k.xw, wallFoot + (k.top - k.r - wallFoot) * i / 3]);
      for (let i = 1; i <= 5; i++) { const a = (Math.PI / 2) * i / 5; pts.push([k.xw - k.r + k.r * Math.cos(a), k.top - k.r + k.r * Math.sin(a)]); }
      pts.push([k.xi, k.top]);
      const out = pts.map(([x, y]) => [side * x, y]);
      if (side < 0) out.reverse();
      return out;
    };
    const fbGroup = group(chassis, 'floorBody');
    for (const side of [1, -1]) {
      const secs = [];
      for (let d = FB[0].d; d <= FB[FB.length - 1].d + 1e-6; d += 0.04) secs.push({ z: q(d), pts: section(lerpKey(d), side) });
      const g = loft(secs, { capStart: true, capEnd: true });
      add(fbGroup, loftUV(g, secs, 0.05), M.carbonBody, 'floorBody' + (side > 0 ? 'R' : 'L'), { receive: true });
    }
  }

  // =============================================================================================
  // FLOOR, EDGE WING, PLANK, DIFFUSER
  {
    const outline = [
      [0.50, 0.20], [0.62, 0.42], [0.80, 0.68], [1.05, 0.84], [1.35, 0.900], [2.60, 0.900],
      [2.85, 0.860], [3.02, 0.760], [3.16, 0.650], [3.30, 0.600], [3.57, 0.595], [3.78, 0.575],
    ];
    const shape = new THREE.Shape();
    shape.moveTo(outline[0][1], outline[0][0]);
    for (const [d, x] of outline) shape.lineTo(x, d);
    for (let i = outline.length - 1; i >= 0; i--) shape.lineTo(-outline[i][1], outline[i][0]);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.024, bevelEnabled: false });
    // shape is in (x, d); extrude along +z -> rotate so d -> z and extrusion -> y
    g.rotateX(Math.PI / 2);          // (x, d, e) -> (x, -e?, d)
    // after rotateX(+90): y' = -z_e, z' = y(d)
    g.translate(0, 0.054, 0);
    g.translate(0, 0, Z.FA);
    // rake: lift the rear slightly
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i);
      const t = Math.max(0, Math.min(1, (z - q(0.5)) / (SPEC.wheelbase)));
      p.setY(i, p.getY(i) + (SPEC.rideHeightFront - 0.03) + t * (SPEC.rideHeightRear - SPEC.rideHeightFront));
    }
    g.computeVertexNormals();
    const floorGroup = group(chassis, 'floor');
    add(floorGroup, boxUV(g, 0.06), M.carbonMatte, 'floorPlate', { receive: true });
    // floor edge wing / scroll (upturned lip)
    for (const side of [1, -1]) {
      const pts = [];
      for (let d = 1.15; d <= 2.95; d += 0.15) {
        const k = outline.findIndex(o => o[0] >= d);
        const a = outline[Math.max(0, k - 1)], b = outline[k];
        const t = (d - a[0]) / Math.max(1e-6, b[0] - a[0]);
        const x = a[1] + (b[1] - a[1]) * t - 0.012;
        pts.push([side * x, 0.085 + 0.02 * Math.sin((d - 1.15) / 1.8 * Math.PI), q(d)]);
      }
      const lip = sweep(pts, { rx: 0.006, ry: 0.034, seg: 6 });
      add(floorGroup, boxUV(lip), M.carbon, 'floorEdge');
    }
    // floor fences: four curved vanes per side under the floor's leading edge, turning outwards
    for (const side of [1, -1]) {
      for (let k = 0; k < 4; k++) {
        const x0 = 0.15 + 0.07 * k, pts = [];
        for (let i = 0; i <= 8; i++) {
          const t = i / 8;
          pts.push([side * (x0 + (0.05 + 0.02 * k) * t * t), 0.040 - 0.004 * t, q(0.56 + 0.46 * t)]);
        }
        const rect = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        const fg = sweep(pts, { rx: 0.0035, ry: 0.014 - 0.002 * k, profile: rect });
        add(floorGroup, boxUV(fg, 0.05), M.carbonMatte, 'floorFence', { shadow: false });
      }
    }
    // plank
    const pl = new THREE.BoxGeometry(0.30, 0.012, 2.6); pl.translate(0, 0.024, q(1.9));
    add(floorGroup, pl, M.black, 'plank', { shadow: false });
    // floor fences / leading edge "bib" under the chassis
    const bib = new THREE.BoxGeometry(0.40, 0.03, 0.3); bib.translate(0, 0.055, q(0.62));
    add(floorGroup, boxUV(bib), M.carbonMatte, 'bib');
    // diffuser: roof ramp + side walls + fences
    const dGroup = group(chassis, 'diffuser'); parts.diffuser = dGroup;
    const zz0 = Z.RA - 0.45, zz1 = Z.RA + 0.52;
    const roof = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10, z = zz0 + (zz1 - zz0) * t;
      const y = 0.075 + 0.25 * Math.pow(t, 1.6);
      roof.push({ z, pts: [[-0.56, y], [0.56, y], [0.56, y + 0.02], [-0.56, y + 0.02]] });
    }
    add(dGroup, boxUV(loft(roof)), M.carbon, 'diffuserRoof');
    for (const x of [-0.56, -0.33, 0.33, 0.56]) {
      const s = new THREE.Shape();
      s.moveTo(zz0, 0.062); s.lineTo(zz1, 0.062);
      for (let i = 10; i >= 0; i--) { const t = i / 10; s.lineTo(zz0 + (zz1 - zz0) * t, 0.075 + 0.25 * Math.pow(t, 1.6)); }
      s.closePath();
      const fg = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: false });
      fg.rotateY(-Math.PI / 2); fg.translate(x + 0.004, 0, 0);
      add(dGroup, boxUV(fg), M.carbon, 'diffuserFence');
    }
  }

  // =============================================================================================
  // FRONT WING (4 elements, Monaco high-downforce flap angles) – split into damage sections
  const fwLE = Z.fwLE;
  const EP = SPEC.frontWingSpan / 2;               // endplate outer face
  const fwRoot = group(chassis, 'frontWing'); parts.frontWing = fwRoot;
  const wingColor = (g, fn) => {
    const p = g.attributes.position, c = new Float32Array(p.count * 3), col = new THREE.Color();
    for (let i = 0; i < p.count; i++) { col.set(fn(p.getX(i), p.getY(i), p.getZ(i))); c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  };
  // element definitions: chord, LE offset (behind fwLE), base height, aoa, height rise outboard
  const FW_ELEMS = [
    { chord: 0.400, dz: 0.000, y: 0.082, aoa: 5, rise: 0.000, th: 0.10 },
    { chord: 0.205, dz: 0.315, y: 0.138, aoa: 21, rise: 0.022, th: 0.09 },
    { chord: 0.160, dz: 0.455, y: 0.208, aoa: 34, rise: 0.040, th: 0.08 },
    { chord: 0.135, dz: 0.552, y: 0.282, aoa: 47, rise: 0.055, th: 0.08 },
  ];
  const fwStations = (el, x0, x1, side) => {
    const xsAll = [0.12, 0.22, 0.34, 0.45, 0.58, 0.72, 0.84, EP - 0.045, EP - 0.018, EP - 0.004];
    const st = [];
    for (const ax of xsAll) {
      if (ax < x0 - 1e-6 || ax > x1 + 1e-6) continue;
      const t = (ax - 0.12) / (EP - 0.12);
      const curl = Math.max(0, (ax - (EP - 0.06)) / 0.06);    // tip curls up into the endplate
      const sweepBack = 0.04 * t * t;
      st.push({
        x: side * ax,
        y: el.y + el.rise * Math.min(1, t * 1.6) + 0.04 * curl * curl,
        z: fwLE + el.dz + sweepBack + (el === FW_ELEMS[0] ? 0.03 * (1 - t) : 0),
        chord: el.chord * (1 - 0.18 * curl),
        aoa: el.aoa + 6 * curl,
        roll: -side * 55 * curl * curl,
        thick: 1,
      });
    }
    return st;
  };
  const elemColor = (ei) => (x, y, z) => {
    // exposed carbon elements (2024): glossy black weave under clear coat
    return 0x16161a;
  };
  for (const side of [1, -1]) {
    const nm = side > 0 ? 'fwR' : 'fwL';
    const g = group(fwRoot, nm); parts[nm] = g;
    const inner = group(g, nm + 'Inner'), outer = group(g, nm + 'Outer');
    FW_ELEMS.forEach((el, ei) => {
      const a = wingColor(wingElement(fwStations(el, 0.12, 0.45, side), { thickness: el.th, camber: 0.07 }), elemColor(ei));
      const b = wingColor(wingElement(fwStations(el, 0.45, EP, side), { thickness: el.th, camber: 0.07 }), elemColor(ei));
      add(inner, a, M.wing, `${nm}E${ei}in`);
      add(outer, b, M.wing, `${nm}E${ei}out`);
    });
    // endplate: side profile with a raised rear section, slight inward lean at the top
    const s = new THREE.Shape();
    s.moveTo(fwLE + 0.02, 0.040);
    s.lineTo(fwLE + 0.05, 0.105);
    s.bezierCurveTo(fwLE + 0.20, 0.15, fwLE + 0.38, 0.24, fwLE + 0.56, 0.355);
    s.lineTo(fwLE + 0.69, 0.395);
    s.bezierCurveTo(fwLE + 0.725, 0.33, fwLE + 0.73, 0.20, fwLE + 0.69, 0.09);
    s.lineTo(fwLE + 0.60, 0.040);
    s.closePath();
    const eg = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false, curveSegments: 12 });
    eg.rotateY(-Math.PI / 2);   // shape x -> z (negated), shape y -> y, depth -> x
    // rotateY(-90): (x, y, z) -> (-z, y, x): so shape-x lands on +z (we want z = shape x)
    const pa = eg.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const zz = pa.getZ(i), xx = pa.getX(i), yy = pa.getY(i);
      // lean the top inboard slightly
      pa.setXYZ(i, side * (EP - 0.012 + xx * -1) - side * 0.03 * Math.max(0, yy - 0.2), yy, zz);
    }
    eg.computeVertexNormals();
    wingColor(eg, () => 0x16161a);
    add(outer, eg, M.wing, nm + 'Endplate');
    // footplate
    const fp = new THREE.BoxGeometry(0.11, 0.008, 0.62); fp.translate(side * (EP - 0.06), 0.045, fwLE + 0.33);
    add(outer, boxUV(fp), M.carbon, nm + 'Foot');
  }
  // central neutral section under the nose (mainplane centre)
  {
    const st = [];
    for (const x of [-0.13, -0.06, 0, 0.06, 0.13]) st.push({ x, y: 0.105, z: fwLE + 0.045, chord: 0.36, aoa: 3 });
    add(fwRoot, wingColor(wingElement(st, { thickness: 0.11, camber: 0.04 }), () => 0x1d1d22), M.wing, 'fwCentre');
    // nose pylons/mounts onto the wing
    for (const sx of [-1, 1]) add(fwRoot, strut([sx * 0.05, 0.13, fwLE + 0.20], [sx * 0.05, 0.19, fwLE + 0.27], 0.12, 0.012), M.carbon, 'fwMount');
  }
  // nose and wing go together when the nose breaks
  noseGroup.add(fwRoot); // front wing hangs off the nose

  // =============================================================================================
  // REAR WING (Monaco: max-height, deep upper flap), endplates, beam wing, pylon
  const rwRoot = group(chassis, 'rearWing'); parts.rearWing = rwRoot;
  const RWX = SPEC.rearWingSpan / 2;
  const rwStations = (chord, z, y, aoa, side0 = -1, side1 = 1) => {
    const xs = [-RWX + 0.006, -RWX + 0.03, -RWX + 0.075, -0.33, -0.15, 0, 0.15, 0.33, RWX - 0.075, RWX - 0.03, RWX - 0.006];
    return xs.map(x => {
      const tip = Math.max(0, (Math.abs(x) - (RWX - 0.09)) / 0.09);
      const spoon = 0.012 * (1 - (x / RWX) ** 2);         // slight spoon (higher centre)
      return { x, y: y + spoon - 0.05 * tip * tip, z, chord: chord * (1 - 0.1 * tip), aoa: aoa + 4 * tip, roll: Math.sign(x) * 40 * tip * tip };
    });
  };
  const rwMain = wingColor(wingElement(rwStations(0.335, Z.RA + 0.18, 0.705, 11), { thickness: 0.12, camber: 0.09 }), () => 0x16161a);
  const rwFlap = wingColor(wingElement(rwStations(0.235, Z.RA + 0.455, 0.805, 38), { thickness: 0.10, camber: 0.08 }), () => 0x16161a);
  add(rwRoot, rwMain, M.wing, 'rwMain');
  add(rwRoot, rwFlap, M.wing, 'rwFlap');
  // DRS actuator pod
  { const d = new THREE.BoxGeometry(0.05, 0.05, 0.10); d.translate(0, 0.83, Z.RA + 0.46); add(rwRoot, d, M.navy, 'drsPod'); }
  // central pylon from the crash structure to the main plane
  add(rwRoot, strut([0, 0.37, Z.RA + 0.36], [0, 0.71, Z.RA + 0.27], 0.16, 0.022), M.carbon, 'rwPylon');
  // endplates
  const mobilTex = (() => {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
    const c = cv.getContext('2d'); c.fillStyle = NAVY; c.fillRect(0, 0, 256, 128);
    c.fillStyle = '#ffffff'; c.font = '700 40px Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('Mobil 1', 128, 58);
    c.fillStyle = RB_RED; c.fillRect(0, 112, 256, 16);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const epMat = new THREE.MeshStandardMaterial({ map: mobilTex, roughness: 0.5, metalness: 0.05 });
  for (const side of [1, -1]) {
    const nm = side > 0 ? 'rwR' : 'rwL';
    const g = group(rwRoot, nm); parts[nm] = g;
    const s = new THREE.Shape();
    const z0 = Z.RA + 0.10, z1 = Z.RA + 0.655;
    s.moveTo(z0 + 0.09, 0.47);
    s.bezierCurveTo(z0, 0.55, z0 + 0.01, 0.80, z0 + 0.10, 0.90);
    s.bezierCurveTo(z0 + 0.20, 0.965, z1 - 0.12, 0.965, z1, 0.955);
    s.lineTo(z1 + 0.005, 0.40);
    s.bezierCurveTo(z1 - 0.02, 0.33, z1 - 0.12, 0.30, z1 - 0.24, 0.30);
    s.lineTo(z0 + 0.20, 0.36);
    s.closePath();
    const eg = new THREE.ExtrudeGeometry(s, { depth: 0.011, bevelEnabled: false, curveSegments: 14 });
    eg.rotateY(-Math.PI / 2);
    const pa = eg.attributes.position;
    for (let i = 0; i < pa.count; i++) pa.setX(i, side * (RWX + 0.006 - pa.getX(i) * -1));
    // planar UV for the Mobil 1 texture from (z, y)
    const uv = new Float32Array(pa.count * 2);
    for (let i = 0; i < pa.count; i++) {
      const u = (pa.getZ(i) - z0) / (z1 - z0);
      uv[i * 2] = side > 0 ? 1 - u : u; uv[i * 2 + 1] = (pa.getY(i) - 0.30) / 0.66;
    }
    eg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    eg.computeVertexNormals();
    {
      // the inboard face gets a plain navy patch of the texture (no mirrored lettering)
      const nrm = eg.attributes.normal;
      for (let i = 0; i < pa.count; i++) if (nrm.getX(i) * side < -0.5) { uv[i * 2] = 0.03; uv[i * 2 + 1] = 0.5; }
    }
    add(g, eg, epMat, nm + 'Endplate');
    // LED strip on the endplate trailing edge
    const led = new THREE.BoxGeometry(0.014, 0.12, 0.01); led.translate(side * (RWX + 0.004), 0.62, z1 - 0.004);
    add(g, led, M.lightOff, nm + 'Led', { shadow: false });
  }
  // beam wing (two elements)
  for (const [chord, z, y, aoa, nm] of [[0.15, Z.RA + 0.40, 0.300, 8, 'beamLower'], [0.125, Z.RA + 0.515, 0.352, 26, 'beamUpper']]) {
    const st = [-0.47, -0.3, -0.1, 0.1, 0.3, 0.47].map(x => ({ x, y: y + 0.01 * (1 - (x / 0.47) ** 2), z, chord, aoa }));
    add(rwRoot, wingColor(wingElement(st, { thickness: 0.1, camber: 0.07 }), () => 0x1c1c21), M.wing, nm);
  }

  // =============================================================================================
  // HALO (js/halo.js): satin-black faired hoop with a rounded D section, swept centre pillar,
  // feet blended into the bodywork, and the 2024 markings as a conformal skin
  {
    const halo = buildHalo({ q, apexFA: SPEC.haloApexFA, hi, envIntensity: 1.0 });
    chassis.add(halo.group);
  }

  // =============================================================================================
  // DRIVER, COCKPIT PADDING, STEERING WHEEL, MIRRORS
  {
    const drv = group(chassis, 'driver');
    // helmet (js/helmet.js): shaped shell with chin bar, visor, gasket, pivots, vents and
    // spoiler; top at the height the side reference gives (level with the halo arm beside it),
    // head upright and seated low in the padding
    {
      const helmet = buildHelmet({ hi, envIntensity: 1.0 });
      helmet.group.position.set(0, SPEC.helmetTopHeight - 0.128, q(SPEC.helmetCentreFA));
      helmet.group.rotation.x = 0.04;
      drv.add(helmet.group);
    }
    // shoulders / torso (mostly hidden inside the tub)
    const sh = new THREE.SphereGeometry(0.2, 16, 10); sh.scale(1.0, 0.45, 0.55); sh.translate(0, 0.50, q(1.62));
    add(drv, sh, M.suit, 'shoulders');
    // cockpit padding: the head surround (a U-shaped foam collar round the back and sides of the
    // helmet, its wings rising level with the cockpit shoulders) in dark padded fabric, with a
    // deep shadowed gap between it and the helmet
    {
      const U = new THREE.Shape();
      const R0 = 0.132, R1 = 0.205, zc = q(1.60);
      // top view: x across, y forward (+y -> towards the front after the rotation below)
      U.moveTo(-R1, 0.20); U.lineTo(-R1, 0); U.absarc(0, 0, R1, Math.PI, 2 * Math.PI, false); U.lineTo(R1, 0.20);
      U.lineTo(R0, 0.20); U.lineTo(R0, 0); U.absarc(0, 0, R0, 0, -Math.PI, true); U.lineTo(-R0, 0.20); U.closePath();
      const hg = new THREE.ExtrudeGeometry(U, { depth: 0.120, bevelEnabled: true, bevelThickness: 0.022, bevelSize: 0.018, bevelSegments: 4, curveSegments: 20 });
      // (x, y, z) -> (x, z, -y): extrusion goes up, the closed arc ends up behind the helmet
      hg.rotateX(-Math.PI / 2);
      hg.translate(0, 0.585, zc + 0.02);
      add(chassis, hg, M.pad, 'headrest', { shadow: true, receive: true });
      // dark well round the helmet (shadowed gap seen between the padding and the shell)
      const well = new THREE.CylinderGeometry(R0 - 0.004, R0 - 0.010, 0.10, 28, 1, true);
      well.translate(0, 0.64, zc + 0.02);
      add(chassis, well, M.inlet, 'headWell', { shadow: false });
    }
    // RB20-style steering wheel with live display, shift LEDs, gloved hands and IK arms
    const cockpit = buildCockpit({ chassis, carbonMap: tex.carbon.map, carbonNormal: tex.carbon.normal, hi, q, helmetCentreFA: SPEC.helmetCentreFA });
    root.userData.steeringWheel = cockpit.wheel;
    root.userData.cockpit = cockpit;
    // RB20 mirrors: streamlined pods on an aerofoil pylon from the sidepod's upper inlet lip and
    // a slim strut to the chassis shoulder; 200 x 50 mm glass (the 2023+ minimum reflective
    // surface) angled in towards the driver so it shows the car's flank and the track behind.
    // Both supports are thin blades (<= 50 mm chord, <= 10 mm thick). The glass is a real-time planar
    // reflection (js/mirrors.js); its rectangle is exported in root.userData.mirrors.
    const mirrors = [];
    for (const sx of [-1, 1]) {
      const g = new THREE.Group(); g.name = 'mirror' + (sx < 0 ? 'L' : 'R');
      // 2024 side photo: mirror housing 1.02-1.16 m behind the front axle, above the inlet
      const C = new THREE.Vector3(sx * 0.515, 0.668, q(1.13));
      // glass aimed as a driver sets it: from the eye, the centre of the glass looks back 4 deg
      // outboard and 1.5 deg up (a sliver of the car's flank on the inboard edge, the track
      // behind above the rear tyre); the normal bisects the eye direction and that direction
      const eye = new THREE.Vector3(0, CAMERA_MOUNTS.cockpit.y, q(1.47));
      const back = new THREE.Vector3(sx * Math.sin(4 * Math.PI / 180), Math.sin(1.5 * Math.PI / 180), 1).normalize();
      const nrm = eye.clone().sub(C).normalize().add(back).normalize();
      g.position.copy(C);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm);
      const GW = 0.200, GH = 0.050;
      // housing: lofted rounded-rectangle sections from the glass rim forward to a rounded nose
      {
        const secs = [];
        const n = 9;
        for (let i = 0; i <= n; i++) {
          const t = i / n;                                    // 0 at the glass face, 1 at the nose
          const z = -0.004 - 0.078 * t;
          const k = Math.cos(Math.min(1, t) * Math.PI / 2) ** 0.55;   // rounded nose
          const hw = (GW / 2 + 0.010) * Math.max(0.12, k) * (1 - 0.08 * t), hh = (GH / 2 + 0.010) * Math.max(0.15, k);
          const pts = [];
          for (let j = 0; j < 20; j++) {
            const a = (j / 20) * Math.PI * 2;
            // superellipse (rounded rectangle) section
            const c = Math.cos(a), s2 = Math.sin(a);
            pts.push([Math.sign(c) * Math.abs(c) ** 0.45 * hw, Math.sign(s2) * Math.abs(s2) ** 0.45 * hh]);
          }
          secs.push({ z, pts });
        }
        const hg = loft(secs, { capStart: false, capEnd: true });
        add(g, hg, M.navy, 'mirrorHousing');
        // dark recess behind the glass edge
        const rim = new THREE.PlaneGeometry(GW + 0.014, GH + 0.014); rim.translate(0, 0, -0.0045);
        add(g, rim, M.black, 'mirrorRecess', { shadow: false });
      }
      const glassGeo = new THREE.PlaneGeometry(GW, GH);
      // u runs right-to-left as seen from the front so the reflection reads correctly (a mirror
      // swaps front and back, not left and right)
      { const uv = glassGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); }
      const glass = new THREE.Mesh(glassGeo, M.mirror);
      glass.name = 'mirrorGlass'; glass.position.z = -0.003;
      g.add(glass);
      chassis.add(g);
      // supports (chassis frame): a forward-swept aerofoil stay from the chassis shoulder to the
      // inboard side of the pod and a slim lower strut
      // the blades end inside the housing body, ahead of the glass plane, so nothing crosses the
      // driver's line of sight to the glass (local -x is inboard-forward on the right mirror)
      g.updateMatrix();
      const atHousing = (lx, ly, lz) => { const v = new THREE.Vector3(-sx * lx, ly, lz).applyMatrix4(g.matrix); return [v.x, v.y, v.z]; };
      // stays down onto the sidepod's upper inlet lip (the sidepod now starts at 1.0 m)
      add(chassis, strut([sx * 0.300, 0.600, q(1.04)], atHousing(0.072, -0.012, -0.040), 0.046, 0.009), M.navy, 'mirrorStay');
      add(chassis, strut([sx * 0.455, 0.585, q(1.10)], atHousing(0.012, -0.026, -0.052), 0.026, 0.007), M.navy, 'mirrorStrut');
      mirrors.push({ group: g, glass, w: GW, h: GH, side: sx });
    }
    root.userData.mirrors = mirrors;
  }

  // =============================================================================================
  // WHEELS, UPRIGHTS, SUSPENSION
  const tyreGeoF = tyreGeometry(WHEELS[0].r, WHEELS[0].w, SPEC.tyre.rimDiameter / 2, hi ? 44 : 30);
  const tyreGeoR = tyreGeometry(WHEELS[2].r, WHEELS[2].w, SPEC.tyre.rimDiameter / 2, hi ? 44 : 30);
  const rimR = SPEC.tyre.rimDiameter / 2;
  const wheels = [];
  for (const W of WHEELS) {
    const side = W.left ? -1 : 1;
    const corner = group(root, 'corner' + W.id);       // unsprung: follows the wheel's vertical travel
    corner.position.set(W.pivotX, W.y, W.z);
    const steer = group(corner, 'steer' + W.id);        // rotates about the kingpin (vertical)
    const hub = group(steer, 'hub' + W.id);             // wheel centre (offset from the pivot)
    hub.position.set(W.x - W.pivotX, 0, 0);
    const spin = group(hub, 'spin' + W.id);             // rotates about X
    const tyre = new THREE.Mesh(W.front ? tyreGeoF : tyreGeoR, M.tyre);
    tyre.castShadow = true;
    if (W.left) tyre.rotation.y = Math.PI;               // outer sidewall faces outward
    spin.add(tyre);
    // rim barrel + covers
    const barrel = new THREE.CylinderGeometry(rimR, rimR, W.w * 0.92, 28, 1, true); barrel.rotateZ(Math.PI / 2);
    spin.add(new THREE.Mesh(barrel, M.rim));
    const cov = new THREE.CircleGeometry(rimR + 0.004, 32); cov.rotateY(Math.PI / 2);
    const covMesh = new THREE.Mesh(cov, M.cover);
    covMesh.position.x = side * (W.w / 2 - 0.028);
    if (W.left) covMesh.rotation.y = Math.PI;
    spin.add(covMesh);
    const covIn = new THREE.CircleGeometry(rimR, 24); covIn.rotateY(-Math.PI / 2);
    const covInMesh = new THREE.Mesh(covIn, M.black); covInMesh.position.x = -side * (W.w / 2 - 0.035);
    if (W.left) covInMesh.rotation.y = Math.PI;
    spin.add(covInMesh);
    // brake duct drum (inboard, non-rotating)
    const drum = new THREE.CylinderGeometry(rimR * 0.92, rimR * 0.92, 0.15, 20); drum.rotateZ(Math.PI / 2);
    const drumM = new THREE.Mesh(drum, M.carbon); drumM.position.x = -side * (W.w / 2 - 0.02);
    hub.add(drumM);
    // brake ducts: the front drum gets its forward-facing cooling inlet scoop; the rear duct
    // carries the two small winglets allowed above the axle (2022+ rules)
    if (W.front) {
      const mx = -side * (W.w / 2 + 0.035), my = -0.055;
      const secs = [];
      for (let i = 0; i <= 5; i++) {
        const t = i / 5, z = -0.20 - 0.085 * t;
        const hw = 0.040 + 0.008 * t, hh = 0.033 + 0.006 * t;
        const pts = [];
        for (let j = 0; j < 14; j++) { const a = (j / 14) * Math.PI * 2, c = Math.cos(a), s2 = Math.sin(a); pts.push([mx + Math.sign(c) * Math.abs(c) ** 0.5 * hw, my + Math.sign(s2) * Math.abs(s2) ** 0.5 * hh]); }
        secs.push({ z, pts });
      }
      const sc = loft(secs, { capStart: false, capEnd: false });
      hub.add(new THREE.Mesh(sc, M.navy));
      const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.092, 0.074), M.inlet);
      mouth.position.set(mx, my, -0.265); mouth.rotation.y = Math.PI;
      hub.add(mouth);
      const inner = new THREE.Mesh(loft(secs.slice(0, 3).map(sc2 => ({ z: sc2.z, pts: sc2.pts.map(([x, y]) => [mx + (x - mx) * 0.9, my + (y - my) * 0.9]) })), { capStart: false, capEnd: false }), M.duct);
      hub.add(inner);
    } else {
      for (const [y, aoa, ch] of [[0.255, 10, 0.13], [0.300, 18, 0.11]]) {
        const xs = [-side * (W.w / 2 + 0.006), -side * (W.w / 2 + 0.05), -side * (W.w / 2 + 0.095)];
        const st = xs.map(x => ({ x, y, z: -0.02, chord: ch, aoa }));
        const wg = wingColor(wingElement(st, { thickness: 0.09, camber: 0.08 }), () => 0x1c1d22);
        const wm = new THREE.Mesh(wg, M.wing); wm.castShadow = true; hub.add(wm);
      }
    }
    // rim edge: machined outer lip where the tyre bead meets the rim
    {
      const lip = new THREE.TorusGeometry(rimR + 0.003, 0.0065, 8, 48); lip.rotateY(Math.PI / 2);
      const lm = new THREE.Mesh(lip, M.rim); lm.position.x = side * (W.w / 2 - 0.03);
      spin.add(lm);
    }
    // front wheel-wake control winglet over the top-front of the tyre (steers with the upright)
    if (W.front) {
      const R = W.r + 0.042, arc = [];
      for (let a = 40; a <= 98; a += 6) {
        const phi = a * Math.PI / 180;                 // from forward (-z), upwards
        arc.push(new THREE.Vector3(0, R * Math.sin(phi), -R * Math.cos(phi)));
      }
      const rect = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const wl = sweep(arc, { rx: 0.008, ry: W.w * 0.27, profile: rect, up: new THREE.Vector3(1, 0, 0) });
      const wlm = new THREE.Mesh(wl, M.carbon); wlm.castShadow = true;
      hub.add(wlm);
      const stalk = strut([-side * (W.w / 2 + 0.01), 0.05, -0.02], [-side * (W.w / 2 - 0.03), R * Math.sin(1.2), -R * Math.cos(1.2)], 0.035, 0.012);
      hub.add(new THREE.Mesh(stalk, M.carbon));
    }
    // upright/hardware
    const up = new THREE.BoxGeometry(0.05, 0.36, 0.07); up.translate(-side * (W.w / 2 + 0.005), 0, 0);
    hub.add(new THREE.Mesh(up, M.metal));
    // hub nut
    // centre-lock nut under the cover: only its black anodised face shows inside the green ring
    const nut = new THREE.CylinderGeometry(0.026, 0.028, 0.012, 12); nut.rotateZ(Math.PI / 2);
    const nutM = new THREE.Mesh(nut, M.anodised); nutM.position.x = side * (W.w / 2 - 0.024);
    spin.add(nutM);

    wheels.push({ spec: W, corner, steer, hub, spin, tyre, side, toe: 0, camber: 0, detached: false });
    parts['wheel' + W.id] = corner;
  }

  // suspension arms (chassis points fixed in the sprung frame; outboard points on the upright)
  const SUS = {
    front: {
      arms: [
        // [chassis point, upright point (relative to hub: dx outward-negative = inboard, dy, dz)]
        { c: [0.170, 0.538, -0.30], u: [-0.123, 0.185, -0.01], ch: 0.075, th: 0.020 },  // UWB front leg
        { c: [0.200, 0.556, 0.30], u: [-0.123, 0.185, -0.01], ch: 0.070, th: 0.020 },   // UWB rear leg
        { c: [0.130, 0.228, -0.35], u: [-0.103, -0.185, 0.01], ch: 0.080, th: 0.022 },  // LWB front leg
        { c: [0.160, 0.204, 0.33], u: [-0.103, -0.185, 0.01], ch: 0.070, th: 0.022 },   // LWB rear leg
        { c: [0.190, 0.200, 0.18], u: [-0.148, 0.150, 0.03], ch: 0.035, th: 0.030 },    // pull-rod
        { c: [0.200, 0.470, 0.13], u: [-0.138, 0.110, 0.12], ch: 0.050, th: 0.016 },    // track rod
      ],
    },
    rear: {
      arms: [
        { c: [0.240, 0.520, -0.35], u: [-0.138, 0.195, 0.0], ch: 0.070, th: 0.020 },
        { c: [0.180, 0.500, 0.20], u: [-0.138, 0.195, 0.0], ch: 0.060, th: 0.020 },
        { c: [0.220, 0.200, -0.40], u: [-0.118, -0.190, 0.0], ch: 0.075, th: 0.022 },
        { c: [0.140, 0.200, 0.15], u: [-0.118, -0.190, 0.0], ch: 0.060, th: 0.022 },
        { c: [0.200, 0.480, -0.10], u: [-0.158, -0.160, 0.02], ch: 0.035, th: 0.030 },  // push-rod
        { c: [0.200, 0.330, 0.12], u: [-0.138, -0.030, 0.12], ch: 0.045, th: 0.016 },   // toe link
      ],
    },
  };
  const unitStrut = (ch, th) => {
    const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1, false);
    g.translate(0, 0.5, 0); // base at origin, top at y=1
    g.scale(ch, 1, th);
    return g;
  };
  // all 24 links in one instanced mesh (one draw call); per-instance scale = chord/thickness
  const armList = [];
  for (const wh of wheels) {
    const set = wh.spec.front ? SUS.front : SUS.rear;
    for (const a of set.arms) armList.push({ wh, a });
  }
  const armGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1, false); armGeo.translate(0, 0.5, 0);
  const arms = new THREE.InstancedMesh(armGeo, M.carbon, armList.length);
  arms.castShadow = true; arms.frustumCulled = false; arms.name = 'suspension';
  root.add(arms);

  // ---------------------------------------------------------------------------------------------
  // Dynamic update: steering, wheel spin, suspension travel, chassis pitch/roll, arms
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpD = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0), zAxisV = new THREE.Vector3(0, 0, 1);
  const basisM = new THREE.Matrix4();
  const state = { steer: 0, wheelSpin: [0, 0, 0, 0], travel: [0, 0, 0, 0], pitch: 0, roll: 0, heave: 0, steeringWheel: 0, brakeLight: 0 };

  function update(s) {
    Object.assign(state, s);
    // wheel speed -> tyre lettering blur (fully smeared from ~65 km/h)
    { const v = state.speed || 0, t = Math.max(0, Math.min(1, (v - 4) / 14)); M.tyre.userData.spinBlur.value = t * t * (3 - 2 * t); }
    // sprung mass
    chassis.position.y = state.heave;
    chassis.rotation.set(state.pitch, 0, state.roll, 'XYZ');
    chassis.updateMatrix();
    wheels.forEach((wh, i) => {
      if (wh.detached) return;
      const W = wh.spec;
      wh.corner.position.y = W.y + (state.travel[i] || 0) - (wh.drop || 0);
      const steer = W.front ? (i === 0 ? state.steerL ?? state.steer : state.steerR ?? state.steer) : 0;
      wh.steer.rotation.set(0, steer + wh.toe, 0);
      wh.hub.rotation.set(0, 0, wh.camber * (W.left ? -1 : 1));
      wh.spin.rotation.x = -(state.wheelSpin[i] || 0);
    });
    // steering wheel: + = turning left = anticlockwise as seen by the driver (+z faces him),
    // i.e. a positive rotation about the column axis
    if (root.userData.steeringWheel) root.userData.steeringWheel.rotation.z = state.steeringWheel;
    if (root.userData.cockpit && state.dash) root.userData.cockpit.update(state.dash);
    if (root.userData.rearLight) M.lightOff.emissiveIntensity = state.brakeLight ? 2.5 : 0.0;
    // arms
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    armList.forEach(({ wh, a }, idx) => {
      if (wh.detached) { arms.setMatrixAt(idx, zero); return; }
      const side = wh.side;
      const W = wh.spec;
      tmpA.set(side * a.c[0], a.c[1], W.z + a.c[2]);
      tmpA.applyMatrix4(chassis.matrix);
      tmpB.set(side * a.u[0], a.u[1], a.u[2]);            // u[0] < 0 = inboard of the hub
      tmpB.applyMatrix4(wh.hub.matrixWorld).applyMatrix4(inv);
      tmpD.subVectors(tmpB, tmpA);
      const len = tmpD.length();
      tmpD.divideScalar(len);
      const cx = zAxisV.clone().sub(tmpD.clone().multiplyScalar(zAxisV.dot(tmpD)));
      if (cx.lengthSq() < 1e-4) cx.set(1, 0, 0);
      cx.normalize();
      const cz = new THREE.Vector3().crossVectors(cx, tmpD).normalize();
      basisM.makeBasis(cx.multiplyScalar(a.ch), tmpD.clone().multiplyScalar(len), cz.multiplyScalar(a.th));
      basisM.setPosition(tmpA);
      arms.setMatrixAt(idx, basisM);
    });
    arms.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------------------------
  // Damage visuals. level: 0 intact, 1 damaged (bent/cracked), 2 broken (detached)
  const detachedList = [];
  function detachGroup(obj) {
    if (!obj || !obj.parent) return [];
    obj.updateMatrixWorld(true);
    const out = [];
    obj.traverse(o => { if (o.isMesh) out.push(o); });
    const pieces = out.map(m => {
      const clone = new THREE.Mesh(m.geometry, m.material);
      clone.castShadow = true;
      m.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
      return clone;
    });
    obj.visible = false;
    detachedList.push(obj);
    return pieces;
  }
  function setWheelMisalign(id, toeRad, camberRad, drop = 0) {
    const wh = wheels.find(w => w.spec.id === id);
    if (!wh) return;
    wh.toe = toeRad; wh.camber = camberRad; wh.drop = drop;
  }
  function detachWheel(id) {
    const wh = wheels.find(w => w.spec.id === id);
    if (!wh || wh.detached) return [];
    const pieces = detachGroup(wh.corner);
    wh.detached = true;
    return pieces;
  }
  function bendGroup(obj, ax, ang) {
    if (!obj) return;
    obj.rotation[ax] = ang;
  }
  function repair() {
    for (const o of detachedList) o.visible = true;
    detachedList.length = 0;
    for (const wh of wheels) { wh.detached = false; wh.toe = 0; wh.camber = 0; wh.drop = 0; wh.corner.visible = true; }
    for (const k of Object.keys(parts)) { parts[k].visible = true; parts[k].rotation.set(0, 0, 0); parts[k].position.set(0, 0, 0); }
    // restore wheel corner positions (they were reset by the loop above)
    wheels.forEach(wh => wh.corner.position.set(wh.spec.pivotX, wh.spec.y, wh.spec.z));
    // inner/outer front wing sub-groups
    chassis.traverse(o => { if (o.name.endsWith('Outer') || o.name.endsWith('Inner')) { o.visible = true; o.rotation.set(0, 0, 0); } });
  }

  // ---------------------------------------------------------------------------------------------
  // SPONSOR DECALS (sharp conformal wordmarks on the actual surfaces; 2024 positions)
  {
    const find = (n) => { const out = []; root.traverse(o => { if (o.isMesh && o.name === n) out.push(o); }); return out; };
    // decals are collected, their artwork packed into one atlas, and the projected pieces
    // merged per car part: one draw call per part instead of one per decal
    const requests = [];
    const decal = (targets, opts, drawFn, ppm = 2200, matOpts) => requests.push({ targets, opts, drawFn, ppm, matOpts });
    const W = '#ffffff';
    // positions and sizes measured on 2024 photos (Austria side view overlaid with the model in
    // the same telephoto perspective; Austria / Netherlands front close-ups)
    for (const side of [1, -1]) {
      // ORACLE across the sidepod (title partner): the O starts 1.27 m behind the front axle,
      // cap height 0.15 m (2024 side reference); wraps over the sidepod's shoulder and undercut
      decal(['sidepodRBody', 'sidepodLBody'], { proj: 'side', side, center: [q(1.80), 0.472], size: [1.07, 0.162], normalMin: 0.30 },
        (c, w, h) => drawOracle(c, w, h), 2400);
      // SIEMENS small under the rear of ORACLE
      decal(['sidepodRBody', 'sidepodLBody'], { proj: 'side', side, center: [q(2.08), 0.385], size: [0.18, 0.03], normalMin: 0.4 },
        (c, w, h) => fitText(c, w, h, 'SIEMENS', { color: W, weight: 700, stretch: 1.15, letter: 0.05 }), 3000);
      // BYBIT on the flat chassis side ahead of the sidepod: letters 0.08 m tall, 0.49-0.79 m
      // behind the front axle, the red line running through their lower half
      decal(['tub'], { proj: 'side', side, center: [q(0.64), 0.533], size: [0.32, 0.090], normalMin: 0.3 }, drawBybitDecal, 2600);
      // ROKT on the cockpit wall under the shoulder, behind the halo leg (1.57-1.78 m)
      decal(['tub'], { proj: 'side', side, center: [q(1.675), 0.640], size: [0.218, 0.050], normalMin: 0.3 }, drawRokt, 3200);
      // Red Bull (bold red wordmark) on the engine cover side
      decal(['engineCover', 'sidepodRBody', 'sidepodLBody'], { proj: 'side', side, center: [q(2.53), 0.56], size: [0.60, 0.125], normalMin: 0.55 },
        (c, w, h) => fitText(c, w, h, 'Red Bull', { color: '#d8202e', weight: 900, stretch: 0.92, letter: -0.01, pad: 0.03 }));
      // HONDA towards the rear of the engine cover
      decal(['engineCover', 'sidepodRBody', 'sidepodLBody'], { proj: 'side', side, center: [q(3.14), 0.58], size: [0.38, 0.05], normalMin: 0.45 },
        (c, w, h) => fitText(c, w, h, 'HONDA', { color: W, weight: 900, stretch: 1.5, letter: 0.10 }));
      // RAUCH badge (0.33 x 0.126 m) on the floor body's leading carbon wall
      decal(['floorBodyR', 'floorBodyL'], { proj: 'side', side, center: [q(0.727), 0.106], size: [0.33, 0.126], normalMin: 0.45 }, drawRauch, 2400);
    }
    // chassis top ahead of the cockpit and the nose top, readable from the front (as photographed):
    // text runs towards the car's left, letters' tops towards the rear
    const FRONT_TOP = { X: [-1, 0, 0], Y: [0, 0, 1], N: [0, 1, 0] };
    const top = (targets, fa, len, hgt, draw, ppm = 3000, x = 0) => decal(targets, { basis: FRONT_TOP, center3: [x, 0, q(fa)], size: [len, hgt], normalMin: 0.45 }, draw, ppm);
    top(['tub'], 0.575, 0.13, 0.024, (c, w, h) => drawOracle(c, w, h), 3600);
    top(['tub'], 0.455, 0.21, 0.066, drawTagWide, 3000);
    top(['tub'], 0.275, 0.14, 0.085, drawNumberOne, 2400);
    top(['tub'], -0.17, 0.175, 0.36, drawNoseStack, 2600);
    // front wing (exposed carbon): red "Red Bull" across the planes - "Red" on the right half,
    // "Bull" on the left, read from the front - and white Bybit on the upper flaps
    const fwT = (side, els = [0]) => els.flatMap((e) => [`${side}E${e}in`, `${side}E${e}out`]);
    decal(fwT('fwR'), { basis: FRONT_TOP, center3: [0.50, 0, Z.fwLE + 0.20], size: [0.56, 0.30], normalMin: 0.3 },
      (c, w, h) => fitText(c, w, h, 'Red', { color: '#d8202e', weight: 900, stretch: 0.95 }), 1400);
    decal(fwT('fwL'), { basis: FRONT_TOP, center3: [-0.50, 0, Z.fwLE + 0.20], size: [0.56, 0.30], normalMin: 0.3 },
      (c, w, h) => fitText(c, w, h, 'Bull', { color: '#d8202e', weight: 900, stretch: 0.95 }), 1400);
    for (const sx of [1, -1]) {
      decal(fwT(sx > 0 ? 'fwR' : 'fwL', [2]), { basis: FRONT_TOP, center3: [sx * 0.40, 0, Z.fwLE + 0.515], size: [0.36, 0.10], normalMin: 0.3 }, drawBybitDecal, 2000);
    }
    // RB20 cooling gulleys: long recessed channels along the tops of the sidepods beside the
    // engine cover (rendered as shaded channels: dark floor, soft edges)
    for (const side of [1, -1]) {
      decal(['sidepodRBody', 'sidepodLBody', 'engineCover'], { proj: 'top', center: [q(2.28), side * 0.302], size: [1.05, 0.075], angle: 0, normalMin: 0.4 },
        (c, w, h) => {
          const g = c.createLinearGradient(0, 0, 0, h);
          g.addColorStop(0, 'rgba(6,8,14,0)'); g.addColorStop(0.28, 'rgba(6,8,14,0.78)'); g.addColorStop(0.5, 'rgba(3,4,8,0.9)');
          g.addColorStop(0.72, 'rgba(6,8,14,0.78)'); g.addColorStop(1, 'rgba(6,8,14,0)');
          c.fillStyle = g;
          const r = h * 0.5; c.beginPath(); c.moveTo(r, 0); c.lineTo(w - r * 3, 0); c.quadraticCurveTo(w, h / 2, w - r * 3, h); c.lineTo(r, h); c.quadraticCurveTo(0, h / 2, r, 0); c.fill();
          // light catching the outer lip of the channel
          c.fillStyle = 'rgba(120,130,160,0.35)'; c.fillRect(r, h * 0.84, w - r * 4, h * 0.05);
        }, 900, { roughness: 0.8 });
    }
    // rear wing upper flap: large Bybit on its forward-facing (upper) surface, read from the front
    decal(['rwFlap'], { basis: { X: [-1, 0, 0], Y: [0, 0.8, 0.6], N: [0, 0.6, -0.8] }, center3: [0, 0.86, Z.RA + 0.53], size: [0.80, 0.14], normalMin: 0.2 }, drawBybitDecal, 1600);

    // ---- build: one atlas for every artwork (identical artworks shared), pieces merged per part
    {
      const art = new Map();
      for (const r of requests) {
        const w = Math.min(2600, Math.round(r.opts.size[0] * r.ppm)), h = Math.min(1024, Math.round(r.opts.size[1] * r.ppm));
        r.key = `${r.drawFn.name || ''}|${r.drawFn.toString().length}|${r.drawFn.toString().slice(0, 160)}|${w}x${h}`;
        if (!art.has(r.key)) art.set(r.key, { key: r.key, w, h, draw: r.drawFn });
      }
      const atlas = decalAtlas([...art.values()], { width: 4096, pad: 12, anisotropy: 8 });
      const mats = new Map();
      const matFor = (o = {}) => { const k = JSON.stringify(o); if (!mats.has(k)) mats.set(k, decalMaterial(atlas.texture, o)); return mats.get(k); };
      const pieces = new Map();                      // parent -> material -> [geometries]
      for (const r of requests) {
        const meshes = r.targets.flatMap(find);
        if (!meshes.length) continue;
        const [u0, v0, u1, v1] = atlas.rects[r.key];
        const byParent = new Map();
        for (const m of meshes) { if (!byParent.has(m.parent)) byParent.set(m.parent, []); byParent.get(m.parent).push(m.geometry); }
        for (const [parent, geoms] of byParent) {
          const g = projectDecal(geoms, { ...r.opts, clipBox: true });
          if (!g) continue;
          const uv = g.attributes.uv;
          for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (u1 - u0) * uv.getX(i), v0 + (v1 - v0) * uv.getY(i));
          const mat = matFor(r.matOpts);
          if (!pieces.has(parent)) pieces.set(parent, new Map());
          const pm = pieces.get(parent);
          if (!pm.has(mat)) pm.set(mat, []);
          pm.get(mat).push(g);
        }
      }
      for (const [parent, pm] of pieces) for (const [mat, list] of pm) {
        const g = mergeGeoms(list); g.computeBoundingSphere();
        const dm = new THREE.Mesh(g, mat); dm.name = 'decal'; dm.renderOrder = 3; dm.castShadow = false; dm.receiveShadow = hi;
        parent.add(dm);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Draw-call reduction: merge static meshes that share a material inside each group
  // (detachable damage groups stay separate objects).
  const normAttrs = (g, withColor) => {
    g = g.index ? g.toNonIndexed() : g.clone();
    const n = g.attributes.position.count;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    if (withColor && !g.attributes.color) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', ...(withColor ? ['color'] : [])].includes(k)) g.deleteAttribute(k);
    return g;
  };
  const KEEP = new Set(['helmet', 'rearLight', 'mirrorGlass']);
  const mergeGroup = (grp) => {
    const byMat = new Map();
    for (const c of [...grp.children]) {
      if (c.isMesh && !c.isInstancedMesh && !KEEP.has(c.name)) {
        if (!byMat.has(c.material)) byMat.set(c.material, []);
        byMat.get(c.material).push(c);
      } else if (c.isGroup && !c.name.startsWith('corner') && c.name !== 'steeringWheel' && c.name !== 'driverArms' && !c.name.startsWith('mirror')) mergeGroup(c);
    }
    for (const [mat, list] of byMat) {
      if (list.length < 2) continue;
      const withColor = !!mat.vertexColors;
      const geoms = list.map(m => { m.updateMatrix(); const g = normAttrs(m.geometry, withColor); g.applyMatrix4(m.matrix); return g; });
      const merged = mergeGeoms(geoms);
      merged.computeBoundingSphere();
      const mm = new THREE.Mesh(merged, mat);
      mm.castShadow = list.some(m => m.castShadow); mm.receiveShadow = list.some(m => m.receiveShadow); mm.name = list[0].name + '+';
      for (const m of list) grp.remove(m);
      grp.add(mm);
    }
  };
  mergeGroup(chassis);
  for (const wh of wheels) mergeGroup(wh.hub);

  // objects only ever seen from the driver's seat or from outside, never in the mirrors (the
  // mirrors look back along the flanks): render layer 1, which the mirror cameras skip
  for (const name of ['driver', 'steeringWheel', 'driverArms']) {
    const g = root.getObjectByName(name);
    if (g) g.traverse((o) => o.layers.set(1));
  }

  update({});
  return {
    root, chassis, parts, wheels, materials: M, textures: tex, tcamPod,
    update, detachGroup, detachWheel, setWheelMisalign, bendGroup, repair,
    find: (name) => root.getObjectByName(name),
  };
}

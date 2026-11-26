// Conformal decals: sponsor wordmarks projected onto the actual body triangles they cover, each
// with its own high-resolution texture, so the lettering stays sharp at onboard distances
// (the body atlas is ~340 px/m; decals here are 1,500-3,000 px/m). A decal is added to the
// group of the part it sits on, so it breaks away with that part.
//
// Sponsor names are drawn as text approximations of the 2024 wordmarks (no logo artwork).
import * as THREE from 'three';

// text canvas with a transparent margin (clamped UVs outside the decal box sample transparency)
export function wordmarkTexture(draw, wPx, hPx) {
  const cv = document.createElement('canvas'); cv.width = wPx; cv.height = hPx;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, wPx, hPx);
  draw(c, wPx, hPx);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Fit a single line of text into the canvas (centred), optional horizontal stretch.
export function fitText(c, w, h, text, { color = '#fff', weight = 800, family = 'Helvetica Neue, Helvetica, Arial, sans-serif', stretch = 1, italic = false, pad = 0.06, letter = 0 } = {}) {
  const H = h * (1 - 2 * pad);
  c.save();
  c.font = `${italic ? 'italic ' : ''}${weight} ${Math.round(H)}px ${family}`;
  if ('letterSpacing' in c) c.letterSpacing = `${letter * H}px`;
  const tw = c.measureText(text).width * stretch;
  const s = Math.min(1, (w * (1 - 2 * pad)) / tw);
  c.translate(w / 2, h / 2 + H * 0.04);
  c.scale(stretch * s, s);
  c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(text, 0, 0);
  c.restore();
}

// Project a decal onto geometries (car-frame coordinates, non-indexed or indexed).
//   proj 'side': along x, box in (z, y); side = +1 right / -1 left; text reads front -> back
//                on the right side, and back -> front on the left (as on the car)
//   proj 'top' : along y (from above), box in (z, x); text reads with 'up' towards +x or -x
//   center: [a, b], size: [lenA, lenB] in the box plane (a = z), angle: rotation in the plane
//   basis (alternative to proj): { X, Y, N } car-frame vectors - X = text reading direction,
//   Y = letters' up, N = surfaces facing this way (dot >= normalMin) receive the decal - with
//   center3 [x, y, z]. Non-mirrored by construction when X x Y points along N.
//   clipBox: clip the triangles exactly to the decal rectangle, so every UV stays in [0, 1]
//   (needed when the artwork lives in a shared atlas; also saves transparent overdraw)
export function projectDecal(geoms, { proj, side = 1, center, size, angle = 0, normalMin = 0.3, offset = 0.0007, flipU = false, basis = null, center3 = null, clip = null, clipBox = false }) {
  const pos = [], uv = [], nrm = [];
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3(), E1 = new THREE.Vector3(), E2 = new THREE.Vector3();
  const bX = basis && new THREE.Vector3(...basis.X).normalize(), bY = basis && new THREE.Vector3(...basis.Y).normalize(), bN = basis && new THREE.Vector3(...basis.N).normalize();
  const c3 = center3 && new THREE.Vector3(...center3);
  const toBox = (p) => {
    if (basis) {
      const dx = p.x - c3.x, dy = p.y - c3.y, dz = p.z - c3.z;
      return [(dx * bX.x + dy * bX.y + dz * bX.z) / size[0] + 0.5, (dx * bY.x + dy * bY.y + dz * bY.z) / size[1] + 0.5];
    }
    // plane coordinates of a point
    let a, b;
    if (proj === 'side') { a = p.z; b = p.y; } else { a = p.z; b = p.x; }
    const da = a - center[0], db = b - center[1];
    const ra = da * ca + db * sa, rb = -da * sa + db * ca;
    let u = ra / size[0] + 0.5, v = rb / size[1] + 0.5;
    // text direction: on the right side the front of the car (-z) is on the viewer's right,
    // so u runs from back to front reversed to keep the lettering readable
    if (proj === 'side' && side > 0) u = 1 - u;
    if (flipU) u = 1 - u;
    return [u, v];
  };
  const margin = Math.max(size[0], size[1]) * 0.08;
  for (const g0 of geoms) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      A.fromBufferAttribute(p, i); B.fromBufferAttribute(p, i + 1); C.fromBufferAttribute(p, i + 2);
      E1.subVectors(B, A); E2.subVectors(C, A); N.crossVectors(E1, E2);
      const len = N.length(); if (len < 1e-12) continue;
      N.divideScalar(len);
      const facing = basis ? N.dot(bN) : proj === 'side' ? N.x * side : N.y;
      if (facing < normalMin) continue;
      if (!basis && proj === 'side' && (A.x + B.x + C.x) * side < 0) continue;
      if (clip && !clip((A.x + B.x + C.x) / 3, (A.y + B.y + C.y) / 3, (A.z + B.z + C.z) / 3)) continue;
      const ua = toBox(A), ub = toBox(B), uc = toBox(C);
      const ext = (k) => [ua[k], ub[k], uc[k]];
      const m0 = margin / size[0], m1 = margin / size[1];
      if (Math.max(...ext(0)) < -m0 || Math.min(...ext(0)) > 1 + m0 || Math.max(...ext(1)) < -m1 || Math.min(...ext(1)) > 1 + m1) continue;
      if (clipBox) {
        // Sutherland-Hodgman against u >= 0, u <= 1, v >= 0, v <= 1 (positions interpolated)
        let poly = [[A.x, A.y, A.z, ua[0], ua[1]], [B.x, B.y, B.z, ub[0], ub[1]], [C.x, C.y, C.z, uc[0], uc[1]]];
        for (const [k, lo] of [[3, true], [3, false], [4, true], [4, false]]) {
          const inside = (p) => (lo ? p[k] >= 0 : p[k] <= 1);
          const cut = (p, q) => { const e = lo ? 0 : 1, t = (e - p[k]) / (q[k] - p[k]); return p.map((x, i) => x + (q[i] - x) * t); };
          const outP = [];
          for (let i = 0; i < poly.length; i++) {
            const cur = poly[i], prev = poly[(i + poly.length - 1) % poly.length];
            const ci = inside(cur), pi = inside(prev);
            if (ci) { if (!pi) outP.push(cut(prev, cur)); outP.push(cur); } else if (pi) outP.push(cut(prev, cur));
          }
          poly = outP;
          if (poly.length < 3) break;
        }
        for (let i = 1; i + 1 < poly.length; i++) for (const p of [poly[0], poly[i], poly[i + 1]]) {
          pos.push(p[0] + N.x * offset, p[1] + N.y * offset, p[2] + N.z * offset);
          uv.push(Math.min(1, Math.max(0, p[3])), Math.min(1, Math.max(0, p[4]))); nrm.push(N.x, N.y, N.z);
        }
        continue;
      }
      for (const [P, U] of [[A, ua], [B, ub], [C, uc]]) {
        pos.push(P.x + N.x * offset, P.y + N.y * offset, P.z + N.z * offset);
        uv.push(U[0], U[1]); nrm.push(N.x, N.y, N.z);
      }
    }
  }
  if (!pos.length) return null;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return out;
}

export function decalMaterial(tex, { roughness = 0.5, metalness = 0.02 } = {}) {
  return new THREE.MeshStandardMaterial({
    map: tex, transparent: true, depthWrite: false, roughness, metalness,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
}

// Pack decal artworks into one atlas canvas (shelf packing, transparent padding against mip
// bleeding). items: [{ key, w, h, draw }] -> { texture, rects: { key: [u0, v0, u1, v1] } }
export function decalAtlas(items, { width = 4096, pad = 12, anisotropy = 8 } = {}) {
  const sorted = items.slice().sort((a, b) => b.h - a.h);
  let x = pad, y = pad, rowH = 0;
  const place = {};
  for (const it of sorted) {
    if (x + it.w + pad > width) { x = pad; y += rowH + pad * 2; rowH = 0; }
    place[it.key] = [x, y];
    x += it.w + pad * 2; rowH = Math.max(rowH, it.h);
  }
  let H = 256; while (H < y + rowH + pad) H *= 2;
  const cv = document.createElement('canvas'); cv.width = width; cv.height = H;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, width, H);
  const rects = {};
  for (const it of sorted) {
    const [px, py] = place[it.key];
    c.save(); c.translate(px, py); c.beginPath(); c.rect(0, 0, it.w, it.h); c.clip();
    it.draw(c, it.w, it.h);
    c.restore();
    rects[it.key] = [px / width, 1 - (py + it.h) / H, (px + it.w) / width, 1 - py / H];
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = anisotropy;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return { texture: t, rects, size: [width, H] };
}

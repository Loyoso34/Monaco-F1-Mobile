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
export function projectDecal(geoms, { proj, side = 1, center, size, angle = 0, normalMin = 0.3, offset = 0.0007, flipU = false }) {
  const pos = [], uv = [], nrm = [];
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3(), E1 = new THREE.Vector3(), E2 = new THREE.Vector3();
  const toBox = (p) => {
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
      const facing = proj === 'side' ? N.x * side : N.y;
      if (facing < normalMin) continue;
      if (proj === 'side' && (A.x + B.x + C.x) * side < 0) continue;
      const ua = toBox(A), ub = toBox(B), uc = toBox(C);
      const ext = (k) => [ua[k], ub[k], uc[k]];
      const m0 = margin / size[0], m1 = margin / size[1];
      if (Math.max(...ext(0)) < -m0 || Math.min(...ext(0)) > 1 + m0 || Math.max(...ext(1)) < -m1 || Math.min(...ext(1)) > 1 + m1) continue;
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

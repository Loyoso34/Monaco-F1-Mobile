// Driver's helmet (closed-face F1 helmet) in the car frame: shaped shell with the chin bar,
// visor opening, tinted visor with its rubber gasket, side pivots, crown and chin vents, the
// rear aero spoiler, and a painted livery approximating the 2024 design seen in the side
// reference (pearl-white crown with maroon / red graphics, navy lower sides, red accents).
// Everything is built round the helmet's own frame: origin at the shell centre, +y up, -z
// forward (the chin), so it can be placed and tilted in one transform.
import * as THREE from 'three';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Shell surface: radius as a function of the direction (longitude lon, 0 = forward, + = left /
// right symmetric; latitude lat, + up). A slightly elongated ellipsoid, flattened on the sides,
// with the chin bar pushed forward and the lower rim drawn in towards the neck.
function shellPoint(lon, lat, off = 0) {
  const cl = Math.cos(lat), sl = Math.sin(lat);
  const fx = Math.sin(lon) * cl, fy = sl, fz = -Math.cos(lon) * cl;   // unit direction, -z forward
  let rx = 0.118, ry = 0.128, rz = 0.143;
  // fuller forehead and chin bar (front-lower), tapered back of the head
  const front = Math.max(0, -fz);
  const lower = smooth(0.05, -0.75, sl);                // 0 above the equator .. 1 low
  rz += 0.018 * front * lower;                         // chin bar protrudes
  ry += 0.010 * front * smooth(-0.2, 0.6, sl);
  const back = Math.max(0, fz);
  rz -= 0.010 * back * smooth(-0.3, 0.5, sl);
  let x = fx * rx, y = fy * ry, z = fz * rz;
  // lower rim: pull in towards the neck below the jaw line (the shell ends in a rolled edge)
  const neck = smooth(-0.55, -0.95, sl);
  x *= 1 - 0.18 * neck; z *= 1 - 0.10 * neck * (1 - front);
  // outward normal (approximate: ellipsoid gradient) for the offset layers
  const n = new THREE.Vector3(x / (rx * rx), y / (ry * ry), z / (rz * rz)).normalize();
  return new THREE.Vector3(x, y, z).addScaledVector(n, off);
}

function surface(lon0, lon1, lat0, lat1, nu, nv, off, uvFn) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const lon = lon0 + (lon1 - lon0) * i / nu, lat = lat0 + (lat1 - lat0) * j / nv;
    const p = shellPoint(lon, lat, off);
    pos.push(p.x, p.y, p.z);
    const t = uvFn ? uvFn(lon, lat, i / nu, j / nv) : [i / nu, j / nv];
    uv.push(t[0], t[1]);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // outward winding
  const p = g.attributes.position, n = g.attributes.normal;
  let agree = 0; const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), f = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    A.fromBufferAttribute(p, idx[t]); B.fromBufferAttribute(p, idx[t + 1]); C.fromBufferAttribute(p, idx[t + 2]);
    f.crossVectors(B.clone().sub(A), C.clone().sub(A)); agree += f.dot(A);
  }
  if (agree < 0) { const ix = g.index.array; for (let t = 0; t < ix.length; t += 3) { const k = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = k; } g.computeVertexNormals(); }
  return g;
}

// visor opening (eyeport) in shell coordinates: longitude span and latitude band
const EYE = { lon: 1.08, lat0: -0.26, lat1: 0.17 };

function liveryTexture() {
  // equirectangular in (lon, lat): u = 0.5 at the front, u -> 0 / 1 at the back; v = 0 bottom
  const W = 1024, H = 512;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  // u runs from the helmet's right (+lon) to its left, so lettering reads left-to-right for a
  // viewer facing the helmet
  const X = (lon) => (0.5 - lon / (2 * Math.PI)) * W;           // lon in [-pi, pi]
  const Y = (lat) => (0.5 - lat / Math.PI) * H;                  // lat in [-pi/2, pi/2]
  // base: pearl white crown, navy lower sides
  c.fillStyle = '#eeeeec'; c.fillRect(0, 0, W, H);
  const g = c.createLinearGradient(0, Y(0.25), 0, Y(-0.35));
  g.addColorStop(0, 'rgba(23,29,62,0)'); g.addColorStop(0.35, '#1a2044'); g.addColorStop(1, '#141836');
  c.fillStyle = g; c.fillRect(0, Y(0.25), W, H);
  // broad swept bands from the visor corners back over the crown (red into maroon, with a thin
  // orange edge), navy below; a white centre stripe stays clear over the top
  for (const side of [-1, 1]) {
    const band = (lonA, latA, lonB, latB, w0, w1, col) => {
      c.fillStyle = col; c.beginPath();
      const n = 24;
      const pt = (t, off) => {
        const lon = lonA + (lonB - lonA) * t, lat = latA + (latB - latA) * t + 0.10 * Math.sin(Math.PI * t);
        return [X(side * lon), Y(lat + off)];
      };
      for (let i = 0; i <= n; i++) { const t = i / n, [x, y] = pt(t, (w0 + (w1 - w0) * t) / 2); i ? c.lineTo(x, y) : c.moveTo(x, y); }
      for (let i = n; i >= 0; i--) { const t = i / n, [x, y] = pt(t, -(w0 + (w1 - w0) * t) / 2); c.lineTo(x, y); }
      c.closePath(); c.fill();
    };
    band(0.95, 0.32, 2.95, 0.70, 0.11, 0.05, '#f39220');
    band(0.95, 0.32, 2.95, 0.70, 0.09, 0.035, '#d8202e');
    band(1.25, 0.18, 2.95, 0.42, 0.10, 0.05, '#7a1222');
    band(1.10, 0.05, 2.95, 0.16, 0.06, 0.03, '#d8202e');
    // small red star on the side (as in the reference)
    const sx = X(side * 1.75), sy = Y(-0.12), r = 16;
    c.fillStyle = '#d8202e'; c.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; c.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr); }
    c.closePath(); c.fill();
    // red bull side patch (sun + bulls as simple shapes)
    const bx = X(side * 2.30), by = Y(-0.26);
    c.fillStyle = '#ffc20e'; c.beginPath(); c.arc(bx, by, 14, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#d8202e'; c.fillRect(bx - 34, by + 2, 24, 9); c.fillRect(bx + 10, by + 2, 24, 9);
  }
  // visor strip area above the eyeport: dark band with white lettering
  c.fillStyle = '#16193a'; c.fillRect(X(-EYE.lon), Y(EYE.lat1 + 0.16), X(EYE.lon) - X(-EYE.lon), Y(EYE.lat1) - Y(EYE.lat1 + 0.16));
  c.fillStyle = '#ffffff'; c.font = '800 30px Helvetica Neue, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.save(); c.translate(X(0), Y(EYE.lat1 + 0.08)); c.scale(1.6, 1); c.fillText('VERSTAPPEN', 0, 0); c.restore();
  // chin bar: navy with a red stripe
  c.fillStyle = '#d8202e'; c.fillRect(X(-0.7), Y(-0.55), X(0.7) - X(-0.7), 10);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function buildHelmet({ hi = true, envIntensity = 1 } = {}) {
  const group = new THREE.Group(); group.name = 'helmet';
  const uvShell = (lon, lat) => [0.5 - lon / (2 * Math.PI), 0.5 + lat / Math.PI];
  const NU = hi ? 72 : 40, NV = hi ? 36 : 20;
  const paint = new THREE.MeshPhysicalMaterial({ map: liveryTexture(), roughness: 0.32, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.06, envMapIntensity: envIntensity });
  const black = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.65, metalness: 0.0 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.85, metalness: 0.0 });
  const visorMat = new THREE.MeshPhysicalMaterial({
    color: 0x0c1220, roughness: 0.03, metalness: 0.55, clearcoat: 1.0, clearcoatRoughness: 0.02,
    iridescence: hi ? 0.55 : 0, iridescenceIOR: 1.6, iridescenceThicknessRange: [260, 420], envMapIntensity: envIntensity * 1.25,
  });
  const alloy = new THREE.MeshStandardMaterial({ color: 0x9ea3ab, roughness: 0.28, metalness: 0.9 });
  const meshes = [];
  const add = (g, m, name) => { const o = new THREE.Mesh(g, m); o.name = name; o.castShadow = true; o.receiveShadow = true; group.add(o); meshes.push(o); return o; };

  // shell, with the eyeport cut out: three patches round the opening
  const lonL = -Math.PI, lonR = Math.PI;
  // above the opening (all longitudes)
  add(surface(lonL, lonR, EYE.lat1, Math.PI / 2 - 0.001, NU, Math.round(NV * 0.45), 0, uvShell), paint, 'helmetShell');
  // below the opening
  add(surface(lonL, lonR, -1.12, EYE.lat0, NU, Math.round(NV * 0.45), 0, uvShell), paint, 'helmetShellLow');
  // beside the opening (the back half, from one edge of the eyeport round to the other)
  add(surface(EYE.lon, 2 * Math.PI - EYE.lon, EYE.lat0, EYE.lat1, Math.round(NU * 0.7), 8, 0, (lon, lat) => uvShell(lon > Math.PI ? lon - 2 * Math.PI : lon, lat)), paint, 'helmetShellSide');
  // dark interior behind the visor (lining / face area)
  add(surface(-EYE.lon, EYE.lon, EYE.lat0, EYE.lat1, 24, 6, -0.022), black, 'helmetInner');
  // eyeport rubber gasket: a thin raised rim round the opening
  {
    const ring = [];
    const N = 64;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      // walk round the rectangle of the opening in (lon, lat) with rounded corners
      const per = 2 * (2 * EYE.lon + (EYE.lat1 - EYE.lat0));
      let d = t * per, lon, lat;
      const w = 2 * EYE.lon, h = EYE.lat1 - EYE.lat0;
      if (d < w) { lon = -EYE.lon + d; lat = EYE.lat1; }
      else if ((d -= w) < h) { lon = EYE.lon; lat = EYE.lat1 - d; }
      else if ((d -= h) < w) { lon = EYE.lon - d; lat = EYE.lat0; }
      else { d -= w; lon = -EYE.lon; lat = EYE.lat0 + d; }
      ring.push(shellPoint(lon, lat, 0.0015));
    }
    const curve = new THREE.CatmullRomCurve3(ring, true);
    add(new THREE.TubeGeometry(curve, 128, 0.0042, 6, true), rubber, 'visorSeal');
  }
  // visor: a curved shield 3 mm proud of the shell, slightly larger than the opening
  add(surface(-EYE.lon - 0.05, EYE.lon + 0.05, EYE.lat0 - 0.03, EYE.lat1 + 0.035, 40, 10, 0.004), visorMat, 'visor');
  // visor tear-off tab and pivots (one each side)
  for (const sd of [-1, 1]) {
    const p = shellPoint(sd * (EYE.lon + 0.20), (EYE.lat0 + EYE.lat1) / 2 + 0.04, 0.004);
    const pv = new THREE.CylinderGeometry(0.017, 0.019, 0.007, hi ? 20 : 12);
    pv.rotateZ(Math.PI / 2); pv.translate(p.x, p.y, p.z);
    add(pv, alloy, 'visorPivot');
    const cap = new THREE.CylinderGeometry(0.010, 0.010, 0.009, 12); cap.rotateZ(Math.PI / 2); cap.translate(p.x + sd * 0.002, p.y, p.z);
    add(cap, black, 'visorPivotCap');
  }
  // crown vents (two intakes above the visor) and chin vent
  for (const sd of [-1, 1]) {
    const p = shellPoint(sd * 0.20, 0.66, 0.001);
    const v = new THREE.BoxGeometry(0.016, 0.005, 0.026); v.rotateX(-0.55); v.translate(p.x, p.y, p.z);
    add(v, black, 'crownVent');
  }
  {
    const p = shellPoint(0, -0.62, 0.004);
    const v = new THREE.BoxGeometry(0.050, 0.018, 0.012); v.rotateX(0.5); v.translate(p.x, p.y, p.z);
    add(v, black, 'chinVent');
  }
  // rear aero spoiler on the crown (body-coloured, with end plates)
  {
    const a = shellPoint(Math.PI, 0.50, 0.0), b = shellPoint(Math.PI, 0.32, 0.0);
    const s = new THREE.Shape();
    s.moveTo(-0.075, 0); s.quadraticCurveTo(0, 0.010, 0.075, 0); s.lineTo(0.068, 0.012); s.quadraticCurveTo(0, 0.022, -0.068, 0.012); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.050, bevelEnabled: false, curveSegments: 8 });
    g.rotateX(-0.35); g.translate(0, a.y - 0.004, a.z - 0.012);
    add(g, paint, 'helmetSpoiler');
    for (const sd of [-1, 1]) {
      const ep = new THREE.BoxGeometry(0.004, 0.026, 0.050); ep.translate(sd * 0.073, (a.y + b.y) / 2 + 0.004, (a.z + b.z) / 2 - 0.005);
      add(ep, paint, 'helmetSpoilerEnd');
    }
  }
  // HANS tethers / collar: a dark roll under the rim
  {
    const tor = new THREE.TorusGeometry(0.098, 0.016, 8, 32); tor.rotateX(Math.PI / 2); tor.scale(1, 1, 1.15); tor.translate(0, -0.118, 0.012);
    add(tor, rubber, 'helmetCollar');
  }
  return { group, materials: { paint, visor: visorMat } };
}

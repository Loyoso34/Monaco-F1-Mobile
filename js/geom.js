// Procedural geometry helpers: lofts between cross-sections, airfoil wings, swept tubes,
// tyres. All output is THREE.BufferGeometry in metres.
import * as THREE from 'three';

// ---------------------------------------------------------------------------------------------
// Loft: sections = [{ z, pts: [[x, y], ...] }] (closed loops, equal point counts, same winding).
// Returns a non-indexed geometry (flat-shaded seams avoided by computing smooth normals from an
// indexed copy first, then expanding).
export function loft(sections, { capStart = true, capEnd = true, closed = true } = {}) {
  const M = sections[0].pts.length, S = sections.length;
  const pos = [];
  for (const sec of sections) for (const [x, y] of sec.pts) pos.push(x, y, sec.z);
  const idx = [];
  const segs = closed ? M : M - 1;
  for (let s = 0; s < S - 1; s++) {
    for (let i = 0; i < segs; i++) {
      const a = s * M + i, b = s * M + (i + 1) % M, c = (s + 1) * M + i, d = (s + 1) * M + (i + 1) % M;
      idx.push(a, c, b, b, c, d);
    }
  }
  const addCap = (s, flip) => {
    // centroid fan
    let cx = 0, cy = 0;
    for (const [x, y] of sections[s].pts) { cx += x; cy += y; }
    cx /= M; cy /= M;
    const ci = pos.length / 3;
    pos.push(cx, cy, sections[s].z);
    for (let i = 0; i < M; i++) {
      const a = s * M + i, b = s * M + (i + 1) % M;
      if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  };
  if (capStart) addCap(0, false);
  if (capEnd) addCap(S - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  orientOutward(g);
  g.computeVertexNormals();
  return g;
}

// Flip triangle winding if the mesh is inside-out (signed volume < 0).
export function orientOutward(g) {
  const p = g.attributes.position.array, ix = g.index.array;
  let vol = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    vol += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
      - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
      + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  if (vol < 0) {
    for (let t = 0; t < ix.length; t += 3) { const tmp = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = tmp; }
  }
  return g;
}

// Rounded-box style section ("chassis section") with optional cockpit dip.
// p: { w (half width at the widest), wTop (half width at the top corners), top, bot,
//      rt (top corner radius), rb (bottom corner radius), cw (cockpit half width), dip,
//      yOff (lateral shift none) }
// Returns a closed loop of 2*H points (H per half), counter-clockwise seen from behind.
export const SECTION_HALF = 26;
export function chassisSection(p) {
  const { w, top, bot } = p;
  const wTop = p.wTop ?? w;
  const rt = Math.min(p.rt ?? 0.05, (top - bot) * 0.48, wTop * 0.95);
  const rb = Math.min(p.rb ?? 0.03, (top - bot) * 0.48, w * 0.95);
  const cw = p.cw ?? 0, dip = p.dip ?? 0;
  const half = [];
  // bottom: 4 pts from x=0 to w-rb
  for (let i = 0; i < 4; i++) half.push([(w - rb) * (i / 4), bot]);
  // bottom corner arc: 4 pts
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / 4);
    half.push([w - rb + rb * Math.cos(a), bot + rb + rb * Math.sin(a)]);
  }
  // side: 4 pts from (w, bot+rb) to (wTop, top-rt) – slight bulge
  for (let i = 0; i < 4; i++) {
    const t = i / 4;
    const x = w + (wTop - w) * t + (p.bulge ?? 0) * Math.sin(Math.PI * t);
    half.push([x, bot + rb + (top - rt - bot - rb) * t]);
  }
  // top corner arc: 5 pts
  for (let i = 0; i < 5; i++) {
    const a = (Math.PI / 2) * (i / 5);
    half.push([wTop - rt + rt * Math.cos(a), top - rt + rt * Math.sin(a)]);
  }
  // top towards the centre: 9 pts. The last 5 points form the cockpit lip, inner wall and
  // seat floor; with dip = 0 they lie on the top surface, so every section has the same
  // point distribution and the loft never twists at the cockpit edges.
  const xStart = wTop - rt;
  const k = Math.min(1, Math.max(0, cw / 0.12));
  const kk = k * k * (3 - 2 * k);
  const lipX = xStart * 0.5 * (1 - kk) + Math.min(Math.max(cw, 0.02), xStart - 0.005) * kk;
  for (let i = 0; i < 4; i++) {
    const t = i / 4;
    half.push([xStart + (lipX + 0.02 - xStart) * t, top]);
  }
  const dd = dip;
  const lipDrop = Math.min(1, dd / 0.05);
  half.push([lipX + 0.005, top - 0.012 * lipDrop]);
  half.push([lipX - 0.01, top - 0.04 * lipDrop]);
  half.push([lipX - 0.03, top - dd * 0.65]);
  half.push([lipX * 0.6, top - dd]);
  half.push([lipX * 0.2, top - dd]);
  // half has 4+4+4+5+9 = 26 points (x >= 0), from bottom centre to near top centre.
  const loop = [];
  for (const q of half) loop.push([q[0], q[1]]);
  for (let i = half.length - 1; i >= 0; i--) loop.push([-half[i][0], half[i][1]]);
  return loop;
}

// Interpolate section parameter tables (array of {z, ...numbers}) at z (smoothstep between keys)
export function sampleKeys(keys, z) {
  if (z <= keys[0].z) return { ...keys[0] };
  if (z >= keys[keys.length - 1].z) return { ...keys[keys.length - 1] };
  let i = 0;
  while (keys[i + 1].z < z) i++;
  const a = keys[i], b = keys[i + 1];
  let t = (z - a.z) / (b.z - a.z);
  const ts = t * t * (3 - 2 * t);
  const out = { z };
  for (const k of Object.keys(a)) {
    if (k === 'z' || typeof a[k] !== 'number') continue;
    const bk = b[k] ?? a[k];
    const lin = k === 'dip' || k === 'cw';
    out[k] = a[k] + (bk - a[k]) * (lin ? t : ts);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Airfoil (NACA 4-digit style) with finite trailing edge. Returns [[x, y]] closed loop with x in
// [0,1] from the leading edge, y up. camber > 0 = convex up (we invert for downforce wings).
export function airfoil(n = 14, thickness = 0.1, camber = 0.05, camberPos = 0.45, teThick = 0.006) {
  const up = [], lo = [];
  for (let i = 0; i <= n; i++) {
    const b = Math.PI * i / n;
    const x = (1 - Math.cos(b)) / 2;   // cosine spacing
    const yt = 5 * thickness * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4) + teThick * x / 2;
    let yc, dy;
    const m = camber, pp = camberPos;
    if (x < pp) { yc = m / (pp * pp) * (2 * pp * x - x * x); dy = 2 * m / (pp * pp) * (pp - x); }
    else { yc = m / ((1 - pp) ** 2) * ((1 - 2 * pp) + 2 * pp * x - x * x); dy = 2 * m / ((1 - pp) ** 2) * (pp - x); }
    const th = Math.atan(dy);
    up.push([x - yt * Math.sin(th), yc + yt * Math.cos(th)]);
    lo.push([x + yt * Math.sin(th), yc - yt * Math.cos(th)]);
  }
  const loop = [];
  for (let i = n; i >= 0; i--) loop.push(up[i]);
  for (let i = 1; i < n; i++) loop.push(lo[i]);
  return loop; // 2n points
}

// Wing element lofted across span stations.
// stations: [{ x, y, z, chord, aoa (deg, + = trailing edge UP), thick, roll (deg, rotation about
//              the chord line, used where the element curls into an endplate) }]
// The profile is inverted (downforce). The chord runs along +z (rearward) from the LE at (x,y,z).
export function wingElement(stations, { n = 12, thickness = 0.09, camber = 0.06 } = {}) {
  const foil = airfoil(n, thickness, camber);
  const M = foil.length, pos = [], idx = [];
  for (const st of stations) {
    const a = (st.aoa ?? 0) * Math.PI / 180, r = (st.roll ?? 0) * Math.PI / 180;
    const tk = (st.thick ?? 1);
    for (const [fx, fy0] of foil) {
      const fy = -fy0 * tk;                 // inverted
      // chord-plane coords: u along chord, v normal (up)
      const u = fx * st.chord, v = fy * st.chord;
      // rotate by aoa about the LE (TE up for positive aoa => rotate so +u gets +y)
      const zz = u * Math.cos(a) - v * Math.sin(a);
      const yy = v * Math.cos(a) + u * Math.sin(a);
      // roll: rotate (x offset, y) about the chord line (z axis) — the section tilts sideways
      const xr = -yy * Math.sin(r), yr = yy * Math.cos(r);
      pos.push(st.x + xr, st.y + yr, st.z + zz);
    }
  }
  const S = stations.length;
  for (let s = 0; s < S - 1; s++) for (let i = 0; i < M; i++) {
    const a = s * M + i, b = s * M + (i + 1) % M, c = (s + 1) * M + i, d = (s + 1) * M + (i + 1) % M;
    idx.push(a, b, c, b, d, c);
  }
  // end caps
  for (const s of [0, S - 1]) {
    const base = s * M;
    for (let i = 1; i < M - 1; i++) {
      if (s === 0) idx.push(base, base + i + 1, base + i); else idx.push(base, base + i, base + i + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  orientOutward(g);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------
// Sweep an elliptical (or custom) cross-section along a 3D polyline using parallel transport.
// rx = half-width (perpendicular, roughly horizontal), ry = half-height. widthFn(t) scales.
export function sweep(points, { rx = 0.02, ry = 0.02, seg = 10, scaleFn = null, up = new THREE.Vector3(0, 1, 0), caps = true, profile = null } = {}) {
  const P = points.map(p => p.isVector3 ? p.clone() : new THREE.Vector3(...p));
  const n = P.length;
  const T = [];
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
    T.push(new THREE.Vector3().subVectors(b, a).normalize());
  }
  // initial normal: component of 'up' perpendicular to T0
  let N = up.clone().sub(T[0].clone().multiplyScalar(up.dot(T[0])));
  if (N.lengthSq() < 1e-6) N = new THREE.Vector3(1, 0, 0).sub(T[0].clone().multiplyScalar(T[0].x));
  N.normalize();
  const frames = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const axis = new THREE.Vector3().crossVectors(T[i - 1], T[i]);
      const l = axis.length();
      if (l > 1e-6) {
        axis.divideScalar(l);
        const ang = Math.acos(Math.max(-1, Math.min(1, T[i - 1].dot(T[i]))));
        N.applyAxisAngle(axis, ang);
      }
    }
    const B = new THREE.Vector3().crossVectors(T[i], N).normalize();
    frames.push({ N: N.clone(), B });
  }
  const prof = profile || Array.from({ length: seg }, (_, k) => {
    const a = 2 * Math.PI * k / seg;
    return [Math.cos(a), Math.sin(a)];
  });
  const M = prof.length, pos = [], idx = [];
  for (let i = 0; i < n; i++) {
    const s = scaleFn ? scaleFn(i / (n - 1)) : 1;
    const { N: Nn, B } = frames[i];
    for (const [px, py] of prof) {
      // px along B (side), py along N (up)
      const v = P[i].clone().addScaledVector(B, px * rx * s).addScaledVector(Nn, py * ry * s);
      pos.push(v.x, v.y, v.z);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < M; k++) {
    const a = i * M + k, b = i * M + (k + 1) % M, c = (i + 1) * M + k, d = (i + 1) * M + (k + 1) % M;
    idx.push(a, c, b, b, c, d);
  }
  if (caps) {
    for (const i of [0, n - 1]) {
      const ci = pos.length / 3;
      pos.push(P[i].x, P[i].y, P[i].z);
      for (let k = 0; k < M; k++) {
        const a = i * M + k, b = i * M + (k + 1) % M;
        if (i === 0) idx.push(ci, b, a); else idx.push(ci, a, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  orientOutward(g);
  g.computeVertexNormals();
  return g;
}

// Streamlined strut (suspension arm) between two points: elliptical section, chord oriented
// along the car's longitudinal axis (z) as far as possible.
export function strut(a, b, chord = 0.06, thick = 0.022, seg = 8) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const dir = new THREE.Vector3().subVectors(B, A);
  const len = dir.length();
  dir.normalize();
  // profile in local (side = chord direction, up = thickness)
  const g = new THREE.CylinderGeometry(1, 1, len, seg, 1, false);
  // scale the cylinder's x/z cross-section into an ellipse, then align
  g.scale(chord / 2, 1, thick / 2);
  // orient: cylinder axis is +y; build basis so that local y -> dir, local x -> chord axis
  const zAxis = new THREE.Vector3(0, 0, 1);
  let chordDir = zAxis.clone().sub(dir.clone().multiplyScalar(zAxis.dot(dir)));
  if (chordDir.lengthSq() < 1e-4) chordDir = new THREE.Vector3(1, 0, 0);
  chordDir.normalize();
  const third = new THREE.Vector3().crossVectors(chordDir, dir).normalize();
  const m = new THREE.Matrix4().makeBasis(chordDir, dir, third);
  g.applyMatrix4(m);
  const mid = A.clone().add(B).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Tyre: lathe profile around the X axis (axle). Returns { tyre, sidewallInner } geometries.
// r = outer radius, w = width, rimR = rim radius. UV: u around, v across profile (0..1).
export function tyreGeometry(r, w, rimR, radial = 40) {
  // profile points (radius, axial offset) from the inner rim bead around the tread to the outer bead
  const hw = w / 2;
  const prof = [];
  const shoulder = 0.055, bulge = 0.012;
  const add = (rad, ax) => prof.push(new THREE.Vector2(rad, ax));
  add(rimR + 0.002, -hw + 0.03);                  // inner bead
  add(rimR + 0.03, -hw - bulge * 0.6);
  add(rimR + (r - rimR) * 0.45, -hw - bulge);      // sidewall bulge
  add(r - shoulder * 0.9, -hw - bulge * 0.4);
  add(r - shoulder * 0.35, -hw + 0.006);
  add(r - 0.008, -hw + shoulder * 0.55);
  add(r, -hw + shoulder);                          // tread starts
  add(r + 0.001, 0);
  add(r, hw - shoulder);
  add(r - 0.008, hw - shoulder * 0.55);
  add(r - shoulder * 0.35, hw - 0.006);
  add(r - shoulder * 0.9, hw + bulge * 0.4);
  add(rimR + (r - rimR) * 0.45, hw + bulge);
  add(rimR + 0.03, hw + bulge * 0.6);
  add(rimR + 0.002, hw - 0.03);
  // LatheGeometry revolves points (x = radius, y = height) around Y. We want around X.
  const pts = prof.map(p => new THREE.Vector2(p.x, p.y));
  const g = new THREE.LatheGeometry(pts, radial);
  g.rotateZ(-Math.PI / 2); // Y axis -> X axis
  g.computeVertexNormals();
  return g;
}

export function mergeGeoms(list) {
  // minimal merge (same attributes: position, normal, optional uv/color), non-indexed output
  const parts = list.map(g => g.index ? g.toNonIndexed() : g);
  const names = ['position', 'normal', 'uv', 'color'].filter(n => parts.every(p => p.attributes[n]));
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const size = parts[0].attributes[n].itemSize;
    let total = 0;
    for (const p of parts) total += p.attributes[n].array.length;
    const arr = new Float32Array(total);
    let o = 0;
    for (const p of parts) { arr.set(p.attributes[n].array, o); o += p.attributes[n].array.length; }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

export function colorize(g, color) {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

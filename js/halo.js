// RB20 halo (2024): titanium structure under a satin-black fairing.
//
// Shape (from 2024 race photos: Suzuka, Austria, Belgium; the same parts ran at Monaco):
//  * hoop: a rounded "D" section ~74 x 56 mm - the outboard side fully rounded, the inboard
//    face (towards the driver) flatter, where the small sponsor lines are printed; the rear legs
//    thicken and flare into faired feet that blend into the cockpit shoulders;
//  * centre pillar: a swept blade (lens section, chord along the flow) that rises from a
//    filleted foot on the chassis ahead of the cockpit into the front of the hoop.
//
// Markings (white unless stated), placed and oriented as in the photos:
//  * "Sui" (drop icon + wordmark) on the upper surface of each arm, ~0.32 m from the front
//    along the hoop, letters' tops towards the hoop centre (right arm reads forward, left arm
//    reads rearward);
//  * inner face of the left arm, reading forward: @REDBULLRACING (rear), BYBIT, ORACLE (at the
//    front corner); inner face of the right arm, reading rearward: ZOOM, @REDBULLRACING;
//  * a TAG Heuer shield on the driver-facing side of the hoop front, either side of the pillar.
//  A word beside the right-hand shield is unreadable in every reference and is left out.
//
// The markings are a second "skin" generated from the same surface parameterisation as the
// hoop (arc length s along the centreline, angle theta around the section), offset 0.6 mm along
// the surface normal and mapped into one texture atlas: they follow the curvature exactly, can
// never come out mirrored, stay attached from every camera angle, and cost one draw call.
// Wordmarks are text approximations, not logo artwork.
import * as THREE from 'three';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Rounded D section. theta 0 = outboard, 90 deg = top, 180 deg = inboard, 270 deg = bottom.
// Returns [a, b]: a along +B (inboard), b along +N (up).
function dSection(theta, w, h) {
  const c = Math.cos(theta), s = Math.sin(theta);
  const inboard = c < 0;
  const n = inboard ? 3.1 : 2.15;                 // flatter inboard face, rounded outboard side
  const e = 2 / n;
  const x = Math.sign(c) * Math.abs(c) ** e, y = Math.sign(s) * Math.abs(s) ** e;
  // the top is a little fuller than the underside (fairing over the tube)
  const hb = y > 0 ? h / 2 : h * 0.46;
  return [-x * w / 2, y * hb];
}

// lens / aerofoil section for the pillar (chord along +C, thickness along +L)
function lens(t, chord, thick) {
  // t in [0, 2pi): parametric symmetric aerofoil, leading edge at +C
  const x = Math.cos(t);                          // -1 .. 1 along the chord
  const u = (1 - x) / 2;                          // 0 at the leading edge .. 1 at the trailing edge
  const half = thick / 2 * (1.48 * Math.sqrt(Math.max(0, u)) - 0.63 * u - 1.75 * u * u + 1.42 * u ** 3 - 0.52 * u ** 4) / 0.5;
  return [x * chord / 2, Math.sign(Math.sin(t)) * Math.max(0, half)];
}

export function buildHalo({ q, apexFA, hi, envIntensity = 1 }) {
  const group = new THREE.Group(); group.name = 'halo';
  const mat = hi
    ? new THREE.MeshPhysicalMaterial({ color: 0x101115, roughness: 0.46, metalness: 0.0, clearcoat: 0.55, clearcoatRoughness: 0.26, envMapIntensity: envIntensity })
    : new THREE.MeshStandardMaterial({ color: 0x111216, roughness: 0.42, metalness: 0.0, envMapIntensity: envIntensity });
  mat.name = 'haloSatin';

  // ---- hoop centreline (car frame; FA = distance behind the front axle) -----------------------
  // 2024 side reference (matched camera): the hoop's front top surface ~0.865 m, falling only
  // ~9 cm to the rear, where the legs run into the raised cockpit shoulders just ahead of the
  // airbox (no plunge down the sidepods); widest ~0.39 m either side beside the helmet, the
  // legs pulled in to land on the shoulder tops at x ~0.30. Points: [x, y, FA], foot -> apex.
  const half = [
    [0.288, 0.722, 1.800], [0.300, 0.748, 1.772], [0.320, 0.762, 1.732], [0.350, 0.770, 1.688], [0.377, 0.777, 1.630],
    [0.392, 0.785, 1.560], [0.392, 0.793, 1.480], [0.372, 0.806, 1.350], [0.318, 0.820, 1.200], [0.218, 0.832, 1.072],
    [0.100, 0.838, 0.996], [0, 0.840, apexFA],
  ];
  const cp = [];
  for (let i = 0; i < half.length; i++) cp.push(new THREE.Vector3(-half[i][0], half[i][1], q(half[i][2])));
  for (let i = half.length - 2; i >= 0; i--) cp.push(new THREE.Vector3(half[i][0], half[i][1], q(half[i][2])));
  const curve = new THREE.CatmullRomCurve3(cp, false, 'centripetal');
  const ND = 720;                                  // dense frame table
  const P = curve.getSpacedPoints(ND);
  const S = [0];
  for (let i = 1; i <= ND; i++) S.push(S[i - 1] + P[i].distanceTo(P[i - 1]));
  const L = S[ND], sApex = L / 2;
  const T = [], N = [], B = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= ND; i++) {
    const t = new THREE.Vector3().subVectors(P[Math.min(ND, i + 1)], P[Math.max(0, i - 1)]).normalize();
    const n = up.clone().addScaledVector(t, -up.dot(t)).normalize();
    T.push(t); N.push(n); B.push(new THREE.Vector3().crossVectors(t, n).normalize());   // +B = inboard
  }
  // section size along the hoop: u = 0 at the feet, 1 at the front. The fairing is slim (the
  // 2024 photos give ~60 x 47 mm on the rails, i.e. the 45 mm titanium tube plus a thin skin):
  // a touch fuller round the front corners, thickening gradually down the legs and flaring only
  // in the last few centimetres into a fillet with the shoulder bodywork.
  const size = (s) => {
    const u = 1 - Math.abs(s - sApex) / sApex;
    const front = smooth(0.70, 0.95, u);             // front corners / apex
    const leg = 1 - smooth(0.06, 0.30, u);           // rear legs
    const foot = 1 - smooth(0.0, 0.075, u);          // fillet into the shoulder
    return { w: 0.060 + 0.003 * front + 0.009 * leg + 0.040 * foot * foot, h: 0.047 + 0.003 * front + 0.007 * leg + 0.026 * foot * foot };
  };
  const frameAt = (s) => {
    const f = Math.max(0, Math.min(ND - 1e-6, (s / L) * ND)), i = Math.floor(f), k = f - i;
    const lerp = (A) => A[i].clone().lerp(A[i + 1], k);
    return { p: lerp(P), t: lerp(T).normalize(), n: lerp(N).normalize(), b: lerp(B).normalize() };
  };
  // surface point and outward normal at (s, theta)
  const sectionNormal2D = (theta, w, h) => {
    const d = 1e-3;
    const [a0, b0] = dSection(theta - d, w, h), [a1, b1] = dSection(theta + d, w, h);
    let na = b1 - b0, nb = -(a1 - a0);                       // perpendicular to the tangent
    const [ac, bc] = dSection(theta, w, h);
    if (na * ac + nb * bc < 0) { na = -na; nb = -nb; }
    const l = Math.hypot(na, nb) || 1;
    return [na / l, nb / l];
  };
  const surf = (s, theta, off = 0) => {
    const F = frameAt(s), { w, h } = size(s);
    const [a, b] = dSection(theta, w, h);
    const [na, nb] = sectionNormal2D(theta, w, h);
    const nrm = F.b.clone().multiplyScalar(na).addScaledVector(F.n, nb).normalize();
    const pos = F.p.clone().addScaledVector(F.b, a).addScaledVector(F.n, b).addScaledVector(nrm, off);
    return { pos, nrm };
  };
  // section perimeter (metres) from theta0 to theta1 at arc position s
  const perim = (s, th0, th1) => {
    const { w, h } = size(s), n = 48;
    let acc = 0, prev = dSection(th0, w, h);
    for (let k = 1; k <= n; k++) { const cur = dSection(th0 + (th1 - th0) * k / n, w, h); acc += Math.hypot(cur[0] - prev[0], cur[1] - prev[1]); prev = cur; }
    return acc;
  };
  // theta span centred on thc covering `len` metres of perimeter
  const thetaSpan = (s, thc, len) => {
    let lo = 0, hi2 = Math.PI / 2;
    for (let k = 0; k < 30; k++) { const m = (lo + hi2) / 2; if (perim(s, thc - m, thc + m) < len) lo = m; else hi2 = m; }
    return [thc - lo, thc + lo];
  };

  // ---- hoop mesh -----------------------------------------------------------------------------
  const RINGS = hi ? 132 : 72, SEG = hi ? 36 : 22;
  {
    const pos = [], nrm = [], uv = [], idx = [];
    for (let i = 0; i <= RINGS; i++) {
      const s = L * i / RINGS;
      for (let j = 0; j <= SEG; j++) {
        const th = (j / SEG) * Math.PI * 2;
        const { pos: p, nrm: n } = surf(s, th);
        pos.push(p.x, p.y, p.z); nrm.push(n.x, n.y, n.z); uv.push(s / 0.05, j / SEG);
      }
    }
    for (let i = 0; i < RINGS; i++) for (let j = 0; j < SEG; j++) {
      const a = i * (SEG + 1) + j, b = a + 1, c = a + SEG + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    fixWinding(g);
    const m = new THREE.Mesh(g, mat); m.name = 'haloHoop'; m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }

  // ---- centre pillar: swept blade from the foot into the hoop front ---------------------------
  {
    // centre line of the blade, from inside the hoop front down to the chassis top: the
    // leading edge follows the 2024 side photo (0.65 m at 0.72 m behind the axle, 0.80 m at
    // 0.87 m, into the hoop front at ~0.97 m)
    const pts = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.846, q(apexFA + 0.024)), new THREE.Vector3(0, 0.806, q(apexFA - 0.020)), new THREE.Vector3(0, 0.752, q(apexFA - 0.082)),
      new THREE.Vector3(0, 0.700, q(apexFA - 0.142)), new THREE.Vector3(0, 0.658, q(apexFA - 0.196)), new THREE.Vector3(0, 0.634, q(apexFA - 0.232)),
      new THREE.Vector3(0, 0.616, q(apexFA - 0.262)),
    ], false, 'centripetal').getSpacedPoints(hi ? 40 : 22);
    const n = pts.length, SG = hi ? 28 : 18;
    const pos = [], uv = [], idx = [];
    const lat = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i < n; i++) {
      const t = new THREE.Vector3().subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      let ch = new THREE.Vector3().crossVectors(lat, t).normalize();      // chord direction (in the y-z plane)
      if (ch.z > 0) ch.negate();                                          // leading edge forward (-z)
      const f = i / (n - 1);                                              // 0 top .. 1 foot
      const blend = 1 - smooth(0.0, 0.22, f);                             // fillet into the hoop
      const foot = smooth(0.70, 1.0, f);                                  // fillet into the chassis
      const chord = 0.104 - 0.010 * blend + 0.062 * foot, thick = 0.030 + 0.016 * blend + 0.016 * foot;
      for (let j = 0; j <= SG; j++) {
        const [a, b] = lens((j / SG) * Math.PI * 2, chord, thick);
        const p = pts[i].clone().addScaledVector(ch, a - chord * 0.06).addScaledVector(lat, b);
        pos.push(p.x, p.y, p.z); uv.push(f, j / SG);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < SG; j++) {
      const a = i * (SG + 1) + j, b = a + 1, c = a + SG + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    fixWinding(g);
    const m = new THREE.Mesh(g, mat); m.name = 'haloPillar'; m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }

  // (the pillar's chord grows into a long fillet at the foot and the legs flare where they
  // enter the bodywork, so no separate mounting pads are needed)

  // ---- markings ------------------------------------------------------------------------------
  const PPM = 4600;                                // texture density: px per metre on the surface
  const items = [
    { key: 'sui', len: 0.118, hgt: 0.030, draw: drawSui },
    { key: 'tag', len: 0.050, hgt: 0.040, draw: drawTag },
    { key: 'oracle', len: 0.078, hgt: 0.016, draw: (c, w, h) => text(c, w, h, 'ORACLE', { weight: 700, stretch: 1.32, letter: 0.07 }) },
    { key: 'bybit', len: 0.098, hgt: 0.020, draw: drawBybit },
    { key: 'zoom', len: 0.086, hgt: 0.021, draw: (c, w, h) => text(c, w, h, 'zoom', { weight: 800, stretch: 1.12, letter: 0.01, family: 'Avenir Next, Helvetica Neue, Helvetica, Arial, sans-serif' }) },
    { key: 'handle', len: 0.205, hgt: 0.0135, draw: (c, w, h) => text(c, w, h, '@REDBULLRACING', { weight: 600, stretch: 1.0, letter: 0.09 }) },
  ];
  const atlas = packAtlas(items, PPM);
  const D = (d, side) => sApex + side * d;        // arc position d metres from the front, side -1 left / +1 right
  const TOP = Math.PI / 2, INNER = Math.PI;
  const place = [
    // [item, s centre, theta centre, orientation]
    ['sui', D(0.322, -1), TOP - 0.05, 'top'], ['sui', D(0.322, 1), TOP - 0.05, 'top'],
    ['tag', D(0.142, -1), INNER - 0.10, 'inner'], ['tag', D(0.142, 1), INNER - 0.10, 'inner'],
    ['oracle', D(0.268, -1), INNER - 0.05, 'inner'],
    ['bybit', D(0.430, -1), INNER - 0.05, 'inner'],
    ['handle', D(0.660, -1), INNER - 0.05, 'inner'],
    ['zoom', D(0.440, 1), INNER - 0.05, 'inner'],
    ['handle', D(0.660, 1), INNER - 0.05, 'inner'],
  ];
  {
    const pos = [], nrm = [], uv = [], idx = [];
    for (const [key, sc, thc, orient] of place) {
      const it = atlas.items[key];
      const s0 = sc - it.len / 2, s1 = sc + it.len / 2;
      const [th0, th1] = thetaSpan(sc, thc, it.hgt);
      const ns = Math.max(4, Math.ceil(it.len / 0.006)), nt = 6;
      const base = pos.length / 3;
      for (let i = 0; i <= ns; i++) for (let j = 0; j <= nt; j++) {
        const fx = i / ns, fy = j / nt;
        const s = s0 + (s1 - s0) * fx, th = th0 + (th1 - th0) * fy;
        const { pos: p, nrm: n } = surf(s, th, 0.0006);
        pos.push(p.x, p.y, p.z); nrm.push(n.x, n.y, n.z);
        // text axes: 'top' -> text x runs against s, letters' tops towards +theta (hoop centre);
        // 'inner' -> text x runs with s, letters' tops towards -theta (up)
        const tx = orient === 'top' ? 1 - fx : fx, ty = orient === 'top' ? fy : 1 - fy;
        uv.push(it.u0 + (it.u1 - it.u0) * tx, it.v0 + (it.v1 - it.v0) * ty);
      }
      for (let i = 0; i < ns; i++) for (let j = 0; j < nt; j++) {
        const a = base + i * (nt + 1) + j, b = a + 1, c = a + nt + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    fixWinding(g, true);
    const dmat = new THREE.MeshStandardMaterial({
      map: atlas.texture, transparent: true, depthWrite: false, roughness: 0.38, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, envMapIntensity: envIntensity,
    });
    const m = new THREE.Mesh(g, dmat); m.name = 'haloMarkings'; m.renderOrder = 3; m.castShadow = false; m.receiveShadow = true;
    group.add(m);
  }
  return { group, material: mat, curve, length: L };
}

// make every triangle face away from the local centre of curvature (outward), using the stored
// normals when present
function fixWinding(g, useNormals = false) {
  if (!g.attributes.normal || !useNormals) g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, ix = g.index.array;
  let agree = 0;
  const A = new THREE.Vector3(), Bv = new THREE.Vector3(), C = new THREE.Vector3(), f = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let t = 0; t < ix.length; t += 3) {
    A.fromBufferAttribute(p, ix[t]); Bv.fromBufferAttribute(p, ix[t + 1]); C.fromBufferAttribute(p, ix[t + 2]);
    f.crossVectors(e1.subVectors(Bv, A), e2.subVectors(C, A));
    agree += f.x * n.getX(ix[t]) + f.y * n.getY(ix[t]) + f.z * n.getZ(ix[t]);
  }
  if (agree < 0) {
    for (let t = 0; t < ix.length; t += 3) { const tmp = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = tmp; }
    if (!useNormals) g.computeVertexNormals();
  }
}

// ---- marking artwork (text approximations of the wordmarks) ----------------------------------
function text(c, w, h, str, { color = '#f4f4f6', weight = 700, family = 'Helvetica Neue, Helvetica, Arial, sans-serif', stretch = 1, letter = 0, pad = 0.04 } = {}) {
  const H = h * (1 - 2 * pad);
  c.save();
  c.font = `${weight} ${Math.round(H * 1.12)}px ${family}`;
  if ('letterSpacing' in c) c.letterSpacing = `${(letter * H).toFixed(1)}px`;
  const tw = c.measureText(str).width * stretch;
  const sc = Math.min(1, (w * (1 - 2 * pad)) / tw);
  c.translate(w / 2, h / 2 + H * 0.05);
  c.scale(stretch * sc, sc);
  c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(str, 0, 0);
  c.restore();
}
function drawSui(c, w, h) {
  // water-drop mark followed by the wordmark
  const r = h * 0.36, cx = h * 0.50, cy = h * 0.56;
  c.save();
  c.fillStyle = '#f4f4f6';
  c.beginPath();
  c.moveTo(cx, cy - r * 1.55);
  c.bezierCurveTo(cx + r * 0.55, cy - r * 0.85, cx + r, cy - r * 0.35, cx + r, cy + r * 0.12);
  c.arc(cx, cy + r * 0.12, r, 0, Math.PI, false);
  c.bezierCurveTo(cx - r, cy - r * 0.35, cx - r * 0.55, cy - r * 0.85, cx, cy - r * 1.55);
  c.fill();
  // inner counter-stroke (the drop is drawn as an outline with a swirl)
  c.globalCompositeOperation = 'destination-out';
  c.lineWidth = r * 0.30; c.lineCap = 'round';
  c.beginPath(); c.arc(cx + r * 0.05, cy + r * 0.18, r * 0.52, Math.PI * 0.95, Math.PI * 1.95, false); c.stroke();
  c.beginPath(); c.arc(cx - r * 0.05, cy + r * 0.42, r * 0.40, Math.PI * 0.05, Math.PI * 0.85, false); c.stroke();
  c.restore();
  c.save(); c.translate(h * 1.05, 0); text(c, w - h * 1.1, h, 'Sui', { weight: 600, stretch: 1.0, letter: 0.02, pad: 0.10, family: 'Avenir Next, Helvetica Neue, Helvetica, Arial, sans-serif' }); c.restore();
}
function drawTag(c, w, h) {
  // shield: red upper field with TAG, green lower field with HEUER, white border
  const m = Math.max(2, w * 0.05), x0 = m, x1 = w - m, y0 = m, y1 = h - m, mid = y0 + (y1 - y0) * 0.50;
  const outline = () => {
    c.beginPath();
    c.moveTo(x0, y0); c.lineTo(x1, y0); c.lineTo(x1, mid + (y1 - mid) * 0.35);
    c.quadraticCurveTo(x1, y1, (x0 + x1) / 2, y1);
    c.quadraticCurveTo(x0, y1, x0, mid + (y1 - mid) * 0.35);
    c.closePath();
  };
  c.save();
  outline(); c.fillStyle = '#ffffff'; c.fill();
  c.save(); outline(); c.clip();
  const b = Math.max(1.5, w * 0.05);
  c.fillStyle = '#d6001c'; c.fillRect(x0 + b, y0 + b, x1 - x0 - 2 * b, mid - y0 - b * 1.5);
  c.fillStyle = '#00843d'; c.fillRect(x0 + b, mid + b * 0.5, x1 - x0 - 2 * b, y1 - mid);
  c.restore();
  c.restore();
  c.save(); c.translate(0, y0 + b); text(c, w, (mid - y0) - b * 1.6, 'TAG', { weight: 900, stretch: 1.0, pad: 0.08 }); c.restore();
  c.save(); c.translate(0, mid + b * 0.5); text(c, w, (y1 - mid) * 0.62, 'HEUER', { weight: 800, stretch: 0.95, pad: 0.12 }); c.restore();
}
function drawBybit(c, w, h) {
  // BYB + orange bar + T
  c.save();
  const H = h * 0.86, family = 'Helvetica Neue, Helvetica, Arial, sans-serif';
  c.font = `900 ${Math.round(H * 1.12)}px ${family}`;
  const wb = c.measureText('BYB').width, wt = c.measureText('T').width, bar = H * 0.20, gap = H * 0.12;
  const total = wb + gap + bar + gap + wt;
  const sc = Math.min(1, (w * 0.94) / total);
  c.translate(w / 2 - total * sc / 2, h / 2 + H * 0.05);
  c.scale(sc, sc);
  c.fillStyle = '#f4f4f6'; c.textBaseline = 'middle'; c.textAlign = 'left';
  c.fillText('BYB', 0, 0);
  c.fillStyle = '#f7a600'; c.fillRect(wb + gap, -H * 0.42, bar, H * 0.84);
  c.fillStyle = '#f4f4f6'; c.fillText('T', wb + gap + bar + gap, 0);
  c.restore();
}

// pack the items into one canvas (px = metres x ppm), each with a transparent margin so that
// mip levels never bleed a neighbour into a patch
function packAtlas(items, ppm) {
  const W = 2048, PAD = 18;
  let x = PAD, y = PAD, rowH = 0;
  const rects = {};
  for (const it of items) {
    const w = Math.round(it.len * ppm), h = Math.round(it.hgt * ppm);
    if (x + w + PAD > W) { x = PAD; y += rowH + PAD * 2; rowH = 0; }
    rects[it.key] = { x, y, w, h, it };
    x += w + PAD * 2; rowH = Math.max(rowH, h);
  }
  let H = 64; while (H < y + rowH + PAD) H *= 2;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, W, H);
  const out = {};
  for (const [k, r] of Object.entries(rects)) {
    c.save(); c.translate(r.x, r.y); c.beginPath(); c.rect(0, 0, r.w, r.h); c.clip();
    r.it.draw(c, r.w, r.h);
    c.restore();
    // UV rect (flipY: v = 1 - y / H)
    out[k] = { len: r.it.len, hgt: r.it.hgt, u0: r.x / W, u1: (r.x + r.w) / W, v0: 1 - (r.y + r.h) / H, v1: 1 - r.y / H };
  }
  const texture = new THREE.CanvasTexture(cv);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  return { texture, items: out, canvas: cv };
}

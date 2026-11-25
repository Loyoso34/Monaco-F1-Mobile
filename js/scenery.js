// Monaco scenery: sky, sea and Port Hercule, terrain, Riviera buildings along the circuit,
// landmarks (Casino, Hôtel de Paris, Fairmont over the tunnel, the Rock and the Palace,
// the swimming pool), pit garages, grandstands, yachts, palms and the mountain backdrop.
import * as THREE from 'three';
import * as TX from './textures.js';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { buildCorridor, footprintClear, terrainLimit, clearBarAt } from './corridor.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const R = rng(20240526);

// Coast polyline (east -> west). The land (north-west) lies on the RIGHT of the walking
// direction in this x-east / z-south frame; coastSide() > 0 on land.
const COAST = [
  [1500, -1300], [760, -520], [640, -330], [590, -150], [520, -40], [400, 110], [350, 300],
  [300, 470], [190, 590], [90, 700], [-60, 800], [-260, 860], [-520, 860], [-900, 760], [-1500, 700],
];
// Port Hercule basin (water), polygon in world x/z
const HARBOUR = [
  [-68, 100], [60, 94], [130, 96], [182, 92], [240, 112], [300, 170], [318, 280], [296, 400],
  [230, 480], [150, 525], [40, 545], [-50, 548], [-76, 520], [-80, 430], [-78, 300], [-90, 250], [-95, 160],
];
function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
// signed distance-ish: >0 on the land side of the coast
function coastSide(x, z) {
  let best = 1e9, sign = 1;
  for (let i = 0; i < COAST.length - 1; i++) {
    const [ax, az] = COAST[i], [bx, bz] = COAST[i + 1];
    const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
    let t = ((x - ax) * ex + (z - az) * ez) / l2; t = Math.max(0, Math.min(1, t));
    const qx = ax + ex * t, qz = az + ez * t, d = Math.hypot(x - qx, z - qz);
    if (d < best) { best = d; const cr = ex * (z - az) - ez * (x - ax); sign = cr > 0 ? 1 : -1; }
  }
  return sign * best;
}
function polyEdgeDist(x, z, poly) {
  let best = 1e9;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i];
    const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
    let t = ((x - ax) * ex + (z - az) * ez) / l2; t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return best;
}
export function isWater(x, z) {
  if (pointInPoly(x, z, HARBOUR)) return true;
  return coastSide(x, z) < 0;
}

// ---------------------------------------------------------------------------------------------
export function buildScenery(T, { quality = 'high', renderer = null, corridor = null } = {}) {
  const root = new THREE.Group(); root.name = 'scenery';
  const hi = quality === 'high', lo = quality === 'low';
  // track exclusion zone shared with the track mesh (road + barriers + pavements of every section)
  const C = corridor || buildCorridor(T);
  const TERRAIN_STEP = lo ? 30 : 20;
  const TL = terrainLimit(C, { grid: TERRAIN_STEP });

  // ---- sky dome ----------------------------------------------------------------------------
  const sunDir = new THREE.Vector3(-0.42, 0.78, 0.46).normalize();     // SW, afternoon
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: sunDir }, top: { value: new THREE.Color(0x2a66b3) }, mid: { value: new THREE.Color(0x86b4dd) }, hor: { value: new THREE.Color(0xdde8ee) } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: `varying vec3 vDir; uniform vec3 sunDir, top, mid, hor;
      void main(){ float h = clamp(vDir.y, -0.2, 1.0);
        vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, h)); c = mix(c, top, smoothstep(0.18, 0.75, h));
        c = mix(c, vec3(0.80,0.84,0.86), smoothstep(0.02, -0.2, h));
        float sd = max(dot(normalize(vDir), sunDir), 0.0);
        c += vec3(1.0,0.92,0.75) * (pow(sd, 900.0) * 6.0 + pow(sd, 12.0) * 0.22);
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4500, 32, 16), skyMat);
  sky.renderOrder = -10; sky.frustumCulled = false; sky.name = 'sky';
  root.add(sky);

  // ---- water ---------------------------------------------------------------------------------
  const waterNormal = TX.waterNormal(lo ? 128 : 256);
  waterNormal.repeat.set(220, 220);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x1f4f6e, roughness: 0.12, metalness: 0.0, normalMap: waterNormal, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.1 }),
  );
  water.rotation.x = -Math.PI / 2; water.position.y = 0.0; water.name = 'water';
  root.add(water);

  // ---- terrain (land) -------------------------------------------------------------------------
  // height from the nearest circuit elevation close to the road, rising towards the hills
  // inland; the Rock (Monaco-Ville) as a 55 m plateau south of La Rascasse.
  const trackPts = [];
  for (let k = 0; k < T.N; k += 6) trackPts.push([T.px[k], T.pz[k], T.py[k]]);
  const nearestTrack = (x, z) => {
    let best = 1e18, y = 0;
    for (const [px, pz, py] of trackPts) { const d = (px - x) ** 2 + (pz - z) ** 2; if (d < best) { best = d; y = py; } }
    return [Math.sqrt(best), y];
  };
  const rockH = (x, z) => {
    const d = Math.hypot((x + 140) / 1.25, z - 760);
    return 56 * (1 - smooth(150, 230, d));
  };
  function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  const terrainNatural = (x, z) => {
    const cs = coastSide(x, z);
    if (pointInPoly(x, z, HARBOUR)) return -6;
    if (cs < 0) return -6 - Math.min(30, -cs * 0.2);
    const [dt, ty] = nearestTrack(x, z);
    // distance from the nearest water (open sea or Port Hercule)
    const shore = Math.min(cs, polyEdgeDist(x, z, HARBOUR));
    // flat around the circuit (streets, squares, quays), gently rising further inland
    let h = ty - 0.4;
    if (dt > 40) h += Math.max(0, dt - 70) * 0.07 + Math.max(0, shore - 150) * 0.03;
    if (shore < 30) h = Math.min(h, 1.6 + shore * 0.05);   // quays a little above the water
    h = Math.max(h, rockH(x, z));
    // coastal promenade a little above sea level
    if (cs < 25) h = Math.min(h, 1.2 + cs * 0.12);
    return h;
  };
  // Final ground height: never above the terrain ceiling of the corridor (1.2 m under every
  // road and pavement, rising at most 1:2.2 away from them, min-filtered by the mesh spacing)
  const terrainH = (x, z) => Math.min(terrainNatural(x, z), TL.at(x, z));
  // The rendered terrain is this function sampled on a TERRAIN_STEP grid and triangulated like
  // THREE.PlaneGeometry (diagonal from (i, j+1) to (i+1, j)), drawn 0.25 m lower. groundAt()
  // returns that exact surface, so building bases can be checked against what is drawn.
  // (extents are whole multiples of the step, so the mesh vertices sit exactly on the samples)
  const TG = { X0: -900, Z0: -1300, step: TERRAIN_STEP };
  TG.nx = Math.ceil(2200 / TG.step); TG.nz = Math.ceil(2400 / TG.step);
  TG.X1 = TG.X0 + TG.nx * TG.step; TG.Z1 = TG.Z0 + TG.nz * TG.step;
  TG.h = new Float32Array((TG.nx + 1) * (TG.nz + 1));
  for (let j = 0; j <= TG.nz; j++) for (let i = 0; i <= TG.nx; i++) TG.h[j * (TG.nx + 1) + i] = terrainH(TG.X0 + i * TG.step, TG.Z0 + j * TG.step);
  const TERRAIN_DROP = 0.25;
  const groundAt = (x, z) => {
    const fx = (x - TG.X0) / TG.step, fz = (z - TG.Z0) / TG.step;
    if (fx < 0 || fz < 0 || fx >= TG.nx || fz >= TG.nz) return terrainH(x, z) - TERRAIN_DROP;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, W = TG.nx + 1;
    const ha = TG.h[j * W + i], hb = TG.h[(j + 1) * W + i], hc = TG.h[(j + 1) * W + i + 1], hd = TG.h[j * W + i + 1];
    const h = u + v <= 1 ? ha + u * (hd - ha) + v * (hb - ha) : hc + (1 - u) * (hb - hc) + (1 - v) * (hd - hc);
    return h - TERRAIN_DROP;
  };
  // lowest ground under a footprint (building bases must never float)
  const groundMin = (cx, cz, ang, w, dpt) => {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    let m = groundAt(cx, cz);
    const nu = Math.max(1, Math.ceil(w / 2)), nv = Math.max(1, Math.ceil(dpt / 2));
    const at = (a, b) => { m = Math.min(m, groundAt(cx + sa * a * w + ca * b * dpt, cz + ca * a * w - sa * b * dpt)); };
    for (let i = 0; i <= nu; i++) { at(i / nu - 0.5, -0.5); at(i / nu - 0.5, 0.5); }
    for (let j = 0; j <= nv; j++) { at(-0.5, j / nv - 0.5); at(0.5, j / nv - 0.5); }
    return m;
  };
  {
    const { X0, X1, Z0, Z1, step, nx, nz } = TG;
    const g = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0, nx, nz);
    g.rotateX(-Math.PI / 2);
    g.translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const gi = Math.round((x - X0) / step), gj = Math.round((z - Z0) / step);
      const h = TG.h[gj * (nx + 1) + gi];
      p.setY(i, h);
      // urban beige/grey with garden greens inland; rock grey on the Rock's cliffs
      const n = R();
      let c;
      // Monaco hillsides: dense gardens (umbrella pines, olive) between pale stone terraces
      if (h < -0.5) c = [0.30, 0.33, 0.31];
      else if (rockH(x, z) > 20 && Math.abs(h - rockH(x, z)) < 1) c = [0.47, 0.45, 0.39];
      else c = n < 0.55 ? [0.25 + n * 0.08, 0.33 + n * 0.06, 0.21] : [0.42, 0.40, 0.36];
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const grain = TX.concrete(256, 150);
    grain.repeat.set((X1 - X0) / 24, (Z1 - Z0) / 24);
    // UVs for the grain texture
    const uvA = g.attributes.uv; for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i), uvA.getY(i));
    const terrain = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, map: grain }));
    terrain.name = 'terrain'; terrain.receiveShadow = false;
    // push the terrain slightly below the road to avoid z-fighting with the track ribbon
    terrain.position.y = -TERRAIN_DROP;
    root.add(terrain);
  }

  // ---- buildings ----------------------------------------------------------------------------
  const facades = [TX.facade(0), TX.facade(1), TX.facade(2)];
  const bMats = facades.map(t => new THREE.MeshLambertMaterial({ map: t, vertexColors: true }));
  const bBuilders = [[], [], []];
  const PALETTE = ['#efe3c8', '#f2d7b6', '#e9c9a8', '#f4e9d8', '#e7d3b0', '#f0c9b0', '#ffffff', '#e8dcc8', '#d9c7a6', '#f3e0c0', '#e6b8a2', '#f6eed9'];
  // Occupied ground: oriented rectangles (building convention: width w along (sin a, cos a),
  // depth along (cos a, -sin a)); new buildings must not overlap any of them (2-D SAT test).
  const occupied = [];
  const addOcc = (x, z, a, w, dpt, kind = 'building') => { occupied.push({ x, z, a, hw: w / 2, hd: dpt / 2, r: Math.hypot(w, dpt) / 2, kind }); };
  const addOcc3 = (x, z, rot, wx, dz, kind) => addOcc(x, z, rot, dz, wx, kind);      // three.js footprint (wx along local x)
  const obbOverlap = (A, B, gap = 0) => {
    const dx = B.x - A.x, dz = B.z - A.z;
    if (Math.hypot(dx, dz) > A.r + B.r + gap) return false;
    for (const o of [A, B]) {
      const ux = Math.sin(o.a), uz = Math.cos(o.a);
      for (const [ax, az] of [[ux, uz], [uz, -ux]]) {
        const ra = A.hw * Math.abs(Math.sin(A.a) * ax + Math.cos(A.a) * az) + A.hd * Math.abs(Math.cos(A.a) * ax - Math.sin(A.a) * az);
        const rb = B.hw * Math.abs(Math.sin(B.a) * ax + Math.cos(B.a) * az) + B.hd * Math.abs(Math.cos(B.a) * ax - Math.sin(B.a) * az);
        if (Math.abs(dx * ax + dz * az) > ra + rb + gap) return false;
      }
    }
    return true;
  };
  const free = (x, z, a, w, dpt, gap = 0.5, ignoreKind = null) => { const q = { x, z, a, hw: w / 2, hd: dpt / 2, r: Math.hypot(w, dpt) / 2 }; return !occupied.some(o => o.kind !== ignoreKind && obbOverlap(q, o, gap)); };
  const rej = { water: 0, track: 0, free: 0, ok: 0, relocated: 0, dropped: 0 };
  // Buildings: width w runs along (sin a, cos a), depth along (cos a, -sin a) — the same axes
  // as buildGeom below. Whole-footprint test against the corridor (every section of the lap).
  const NEED_BUILDING = 0.6;            // metres beyond the pavement edge
  const footprintOK = (cx, cz, ang, w, dpt, need = NEED_BUILDING) => {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (const [a, b] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [0, 0]]) {
      if (isWater(cx + sa * a * w + ca * b * dpt, cz + ca * a * w - sa * b * dpt)) { rej.water++; return false; }
    }
    if (footprintClear(C, cx, cz, ang, dpt, w, 'walk') < need) { rej.track++; return false; }
    return true;
  };
  // emits a box building into the builder list (base on the lowest ground under it)
  function building(cx, cz, ang, w, dpt, h, baseY, variant, color) {
    const ground = groundMin(cx, cz, ang, w, dpt);
    const y0 = Math.min(baseY, ground - 0.6);
    bBuilders[variant].push({ cx, cz, ang, w, dpt, h: h + (baseY - y0), baseY: y0, color });
    addOcc(cx, cz, ang, w, dpt);
  }
  const cS = (id) => T.corners.find(c => c.id === id).s;
  const quaySide = (s, side) => side > 0 && T.deltaS(cS('chicane') + 30, s) >= 0 && T.deltaS(s, cS('rascasse') - 10) >= 0;
  // Try a building at a lap position: if its footprint touches the corridor it is pushed
  // further from the road and/or made smaller instead of being dropped.
  const placeBeside = (sc, side, baseSet, w, dpt, pushes, scales) => {
    const k = T.idxOfS(sc);
    const ang = Math.atan2(T.tx[k], T.tz[k]);
    for (const e of pushes) for (const f of scales) {
      const ww = w * f, dd = dpt * f;
      const c = T.pointAt(sc, side * (baseSet + e + dd / 2));
      if (!footprintOK(c.x, c.z, ang, ww, dd)) continue;
      if (!free(c.x, c.z, ang, ww, dd)) { rej.free++; continue; }
      if (e > 0 || f < 1) rej.relocated++;
      return { x: c.x, z: c.z, ang, w: ww, dpt: dd, e };
    }
    rej.dropped++;
    return null;
  };
  const sideBuildings = (side, sFrom, sTo, opts = {}) => {
    let s = sFrom;
    while (s < sTo) {
      if (quaySide(s, side) || standSide(s, side)) { s += 10; continue; }   // harbour quays, grandstands
      const w = opts.w ? opts.w() : 12 + R() * 18;
      const sc = T.wrapS(s + w / 2);
      const k = T.idxOfS(sc);
      const bar = side > 0 ? T.sample(T.barL, sc) : T.sample(T.barR, sc);
      const walk = side > 0 ? C.walkL[k] : C.walkR[k];
      const setback = bar + walk + 0.8 + (opts.extraSet || 0);
      const dpt = 14 + R() * 12;
      const first = placeBeside(sc, side, setback, w, dpt, [0, 2, 4, 7, 11, 16], [1, 0.8, 0.62]);
      if (first) {
        rej.ok++;
        const h = opts.h ? opts.h() : 14 + R() * 22 + (R() < 0.12 ? 25 : 0);
        building(first.x, first.z, first.ang, first.w, first.dpt, h, T.py[k] - 1.5, Math.floor(R() * 3), PALETTE[Math.floor(R() * PALETTE.length)]);
        // second row behind (taller, up the hill) — same full-footprint test
        if (!opts.single && R() < 0.85) {
          const w2 = first.w * (0.8 + R() * 0.4), d2 = 16 + R() * 10;
          const base2 = setback + first.e + first.dpt + 10 + R() * 8;
          const second = placeBeside(sc, side, base2, w2, d2, [0, 4, 9, 15], [1, 0.75]);
          if (second) building(second.x, second.z, second.ang, second.w, second.dpt, 18 + R() * 30, terrainH(second.x, second.z) - 2, Math.floor(R() * 3), PALETTE[Math.floor(R() * PALETTE.length)]);
        }
      }
      s += w + 1.5 + R() * 4;
    }
  };
  // Landmarks and grandstands are reserved BEFORE the apartment blocks so nothing overlaps
  // them. Footprints use the three.js convention: width wx along local x, depth dz along
  // local z, rotation = the track heading at s. Pushed away from the road until clear.
  const reserveAt = (s, d, wx, dz, need, which = 'walk') => {
    const k = T.idxOfS(s), rot = Math.atan2(T.tx[k], T.tz[k]);
    const dir = Math.sign(d) || 1;
    for (let e = 0; e <= 48; e += 2) {
      const p = T.pointAt(s, d + dir * e);
      if (isWater(p.x, p.z)) continue;
      if (footprintClear(C, p.x, p.z, rot, wx, dz, which) >= need) { if (e > 0) rej.relocated++; return { x: p.x, z: p.z, y: T.py[k], rot, e }; }
    }
    rej.dropped++;
    return null;
  };
  // Fairmont hotel over the tunnel: lap range (metres after the entrance) and wing widths
  const FAIRMONT = { q0: 6, q1: Math.min(T.deltaS(T.tunnelS[0], T.tunnelS[1]) - 6, 262), wL: 22, wR: 14, seg: 20, height: 27 };
  // its volume is reserved before any other building is placed
  for (let q = FAIRMONT.q0; q < FAIRMONT.q1; q += 8) {
    const q2 = Math.min(FAIRMONT.q1, q + 8), sq = T.wrapS(T.tunnelS[0] + (q + q2) / 2), k = T.idxOfS(sq);
    const dl = T.sample(T.barL, sq) + 0.95 + FAIRMONT.wL, dr = -T.sample(T.barR, sq) - 0.95 - FAIRMONT.wR;
    const p = T.pointAt(sq, (dl + dr) / 2);
    addOcc(p.x, p.z, Math.atan2(T.tx[k], T.tz[k]), q2 - q + 1.5, dl - dr, 'fairmont');
  }
  const RES = {};
  RES.casino = reserveAt(cS('casino') - 12, -40, 48, 32, 0.6);
  RES.hdp = reserveAt(cS('casino') - 60, 32, 62, 28, 0.6);
  {
    const sp = (cS('pool1') + cS('pool2')) / 2;
    RES.pool = reserveAt(sp, -T.sample(T.barR, sp) - 22, 32, 70, 0.4);
  }
  if (RES.casino) addOcc3(RES.casino.x, RES.casino.z, RES.casino.rot, 48, 32, 'landmark');
  if (RES.hdp) addOcc3(RES.hdp.x, RES.hdp.z, RES.hdp.rot, 62, 28, 'landmark');
  if (RES.pool) addOcc3(RES.pool.x, RES.pool.z, RES.pool.rot, 32, 70, 'landmark');
  // pit garages along the start straight (reserved here, built further down)
  const GARAGES = [];
  for (let q = -130, i = 0; q < 250; q += 17, i++) {
    const sg = T.wrapS(q), k = T.idxOfS(sg);
    const d = -T.sample(T.barR, sg) - 12.6;
    const p = T.pointAt(sg, d), h = Math.atan2(T.tx[k], T.tz[k]);
    // 16 m along the track, 6 m deep; three.js rotation of the group = heading + 90 deg
    if (footprintClear(C, p.x, p.z, h + Math.PI / 2, 16, 6, 'bar') < 9.4) { rej.dropped++; continue; }
    GARAGES.push({ s: sg, d, i });
    addOcc(p.x, p.z, h, 16, 6, 'garage');
  }
  // grandstand plan: [s0, s1, side, setback beyond the barrier]
  const STANDS = [
    [cS('ste-devote') - 60, cS('ste-devote') + 10, 1, 3], [T.L - 140, T.L - 20, 1, 2.5],
    [cS('tabac') - 30, cS('tabac') + 50, 1, 6], [cS('pool1') + 25, cS('pool2') + 40, 1, 6],
    [cS('rascasse') - 20, cS('rascasse') + 30, 1, 4], [cS('casino') - 80, cS('casino') - 30, 1, 4],
  ];
  // grandstand segments (23 m wide, 12.6 m deep behind the front edge): placed now, off every
  // section of the circuit and clear of the landmarks / garages, pushed back up to 8 m if needed
  const STAND_SEGS = [];
  for (const [s0, s1, side, setback] of STANDS) {
    const len = T.deltaS(s0, s1);
    for (let q = 0; q < len; q += 24) {
      const s = T.wrapS(s0 + q + 12), k = T.idxOfS(s);
      const bar = side > 0 ? T.sample(T.barL, s) : T.sample(T.barR, s);
      const rot = Math.atan2(T.tx[k], T.tz[k]) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
      let ok = false;
      for (let e = 0; e <= 8 && !ok; e += 1) {
        const p = T.pointAt(s, side * (bar + setback + e));
        const fcx = p.x + Math.sin(rot) * -5.6, fcz = p.z + Math.cos(rot) * -5.6;
        if (footprintClear(C, fcx, fcz, rot, 23.4, 12.6, 'bar') < 0.5) continue;
        if (!free(fcx, fcz, rot, 12.6, 23.4, 0.3, 'grandstand')) continue;
        STAND_SEGS.push({ s, k, p, fcx, fcz, rot });
        addOcc3(fcx, fcz, rot, 23.4, 12.6, 'grandstand');
        ok = true;
      }
      if (!ok) rej.dropped++;
    }
  }
  const standSide = (s, side) => STANDS.some(([a, b, sd]) => sd === side && T.deltaS(a - 12, s) >= 0 && T.deltaS(s, b + 12) >= 0)
    || (FAIRMONT && T.deltaS(T.wrapS(T.tunnelS[0] + FAIRMONT.q0 - 14), s) >= 0 && T.deltaS(s, T.wrapS(T.tunnelS[0] + FAIRMONT.q1 + 14)) >= 0);

  const L = T.L;
  sideBuildings(1, 0, L);
  sideBuildings(-1, 0, L);
  // (side buildings skip the Fairmont's length: see hotelSide)
  // inland city blocks and towers further from the circuit (skyline backdrop): random sites,
  // rejected sites are re-drawn so the density is kept
  let inland = 0;
  for (let i = 0; i < (lo ? 400 : 900) && inland < (lo ? 60 : 140); i++) {
    const x = -700 + R() * 1700, z = -1100 + R() * 1500;
    if (isWater(x, z) || coastSide(x, z) < 40) continue;
    const ang = R() * Math.PI, w = 16 + R() * 16, dpt = 16 + R() * 14;
    if (!footprintOK(x, z, ang, w, dpt, 8)) continue;
    if (!free(x, z, ang, w, dpt, 1)) continue;
    const tall = R() < 0.25;
    building(x, z, ang, w, dpt, tall ? 45 + R() * 60 : 15 + R() * 25, terrainH(x, z) - 3, Math.floor(R() * 3), PALETTE[Math.floor(R() * PALETTE.length)]);
    inland++;
  }
  // the Rock: low old-town blocks
  for (let i = 0, n = 0; i < 200 && n < (lo ? 20 : 45); i++) {
    const x = -330 + R() * 360, z = 660 + R() * 180;
    const ang = 0.35 + (R() - 0.5) * 0.3, w = 10 + R() * 12, dpt = 10 + R() * 10;
    if (rockH(x, z) < 50 || !free(x, z, ang, w, dpt, 1)) continue;
    if (!footprintOK(x, z, ang, w, dpt, 4)) continue;
    building(x, z, ang, w, dpt, 10 + R() * 9, Math.min(54, terrainH(x, z)), 0, PALETTE[Math.floor(R() * 5)]);
    n++;
  }

  const buildGeom = (list) => {
    const pos = [], uv = [], col = [];
    const c = new THREE.Color();
    for (const b of list) {
      c.set(b.color);
      const ca = Math.cos(b.ang), sa = Math.sin(b.ang);
      // local axes: u along the street (ang), v perpendicular
      const corner = (a, d) => [b.cx + sa * a + ca * d, b.cz + ca * a - sa * d];
      const hw = b.w / 2, hd = b.dpt / 2, y0 = b.baseY, y1 = b.baseY + b.h;
      const quads = [
        [corner(-hw, -hd), corner(hw, -hd), b.w], [corner(hw, -hd), corner(hw, hd), b.dpt],
        [corner(hw, hd), corner(-hw, hd), b.w], [corner(-hw, hd), corner(-hw, -hd), b.dpt],
      ];
      for (const [p0, p1, len] of quads) {
        const u1 = Math.max(1, Math.round(len / 6.8)), v1 = b.h / 6.4;
        const A = [p0[0], y0, p0[1]], B = [p1[0], y0, p1[1]], C2 = [p0[0], y1, p0[1]], D = [p1[0], y1, p1[1]];
        // outward facing: (B - A) x (C2 - A) points away from the building centre
        pos.push(...A, ...B, ...C2, ...B, ...D, ...C2);
        uv.push(0, 0, u1, 0, 0, v1, u1, 0, u1, v1, 0, v1);
        for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
      }
      // roof
      const r0 = corner(-hw, -hd), r1 = corner(hw, -hd), r2 = corner(hw, hd), r3 = corner(-hw, hd);
      pos.push(r0[0], y1, r0[1], r1[0], y1, r1[1], r2[0], y1, r2[1], r0[0], y1, r0[1], r2[0], y1, r2[1], r3[0], y1, r3[1]);
      for (let k = 0; k < 6; k++) { uv.push(0.02, 0.98); col.push(c.r * 0.82, c.g * 0.8, c.b * 0.78); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  };
  // split buildings into spatial tiles for culling
  const TILE = 520;
  for (let v = 0; v < 3; v++) {
    const tiles = new Map();
    for (const b of bBuilders[v]) {
      const key = Math.floor(b.cx / TILE) + ',' + Math.floor(b.cz / TILE);
      if (!tiles.has(key)) tiles.set(key, []);
      tiles.get(key).push(b);
    }
    for (const list of tiles.values()) {
      const m = new THREE.Mesh(buildGeom(list), bMats[v]);
      m.matrixAutoUpdate = false; m.name = 'buildings';
      root.add(m);
    }
  }
  const nBuildings = bBuilders.reduce((a, b) => a + b.length, 0);

  // ---- landmarks ----------------------------------------------------------------------------
  // Static props are baked (world transform applied) and merged into one mesh per material
  // at the end, which keeps the draw-call count low on phones.
  const lm = new THREE.Group(); lm.name = 'landmarks'; root.add(lm);
  const baked = new Map();
  const bake = (obj) => {
    obj.updateMatrixWorld(true);
    obj.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh) return;
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
      g.applyMatrix4(o.matrixWorld);
      const list = baked.get(o.material) || [];
      list.push(g); baked.set(o.material, list);
    });
  };
  const stone = new THREE.MeshLambertMaterial({ color: 0xe8dcc2 });
  const copper = new THREE.MeshLambertMaterial({ color: 0x5f8f7a });
  const glass = new THREE.MeshLambertMaterial({ color: 0x8aa2b2 });
  const placeAt = (s, d, obj, yOff = 0) => {
    const p = T.pointAt(s, d), k = T.idxOfS(s);
    obj.position.set(p.x, T.py[k] + yOff, p.z);
    obj.rotation.y = Math.atan2(T.tx[k], T.tz[k]);
    return obj;
  };
  const corner = (id) => T.corners.find(c => c.id === id).s;
  // Casino de Monte-Carlo (belle époque front, twin towers, green roofs)
  {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(46, 16, 28), stone); body.position.y = 8; g.add(body);
    for (const sx of [-1, 1]) {
      const tw = new THREE.Mesh(new THREE.BoxGeometry(7, 26, 7), stone); tw.position.set(sx * 19, 13, -10); g.add(tw);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(5.2, 7, 4), copper); cap.position.set(sx * 19, 29.5, -10); cap.rotation.y = Math.PI / 4; g.add(cap);
    }
    const dome = new THREE.Mesh(new THREE.SphereGeometry(8, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), copper); dome.position.set(0, 16, 0); g.add(dome);
    if (RES.casino) {
      g.position.set(RES.casino.x, Math.min(RES.casino.y - 1, groundMin(RES.casino.x, RES.casino.z, RES.casino.rot, 32, 48) - 0.5), RES.casino.z); g.rotation.y = RES.casino.rot;
      bake(g);
    }
    // Hôtel de Paris
    const hp = new THREE.Mesh(new THREE.BoxGeometry(60, 22, 26), stone); hp.position.y = 11;
    const hg = new THREE.Group(); hg.add(hp);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(60, 3, 24), copper); roof.position.y = 23.5; hg.add(roof);
    if (RES.hdp) {
      hg.position.set(RES.hdp.x, Math.min(RES.hdp.y - 1, groundMin(RES.hdp.x, RES.hdp.z, RES.hdp.rot, 28, 62) - 0.5), RES.hdp.z); hg.rotation.y = RES.hdp.rot;
      bake(hg);
    }
  }
  // Fairmont hotel built over the tunnel: one structure that follows the curve of the road,
  // with wings standing on the ground either side of the tunnel and a roof stepped in 20 m
  // segments. Its outer faces never enter the tunnel: the tunnel walls, ceiling, roof slab and
  // shell (track mesh) sit inside its volume, and only the parts of its end faces that lie
  // outside the tunnel cross-section are built.
  if (FAIRMONT) {
    const { q0, q1, wL, wR, seg, height } = FAIRMONT;
    const [t0] = T.tunnelS;
    const pos = [], uv = [], col = [];
    const tint = [0.94, 0.91, 0.85];
    const quad = (a, b, c, d, ua, ub, uc, ud, f = 1) => {      // a,b bottom row; c,d top row; front = (b-a)x(c-a)
      pos.push(...a, ...b, ...c, ...b, ...d, ...c);
      uv.push(...ua, ...ub, ...uc, ...ub, ...ud, ...uc);
      for (let k = 0; k < 6; k++) col.push(tint[0] * f, tint[1] * f, tint[2] * f);
    };
    const outerL = (s) => T.sample(T.barL, s) + 0.95 + wL, outerR = (s) => -T.sample(T.barR, s) - 0.95 - wR;
    const wallL = (s) => T.sample(T.barL, s) + 0.35, wallR = (s) => -T.sample(T.barR, s) - 0.35;
    const XZ = (s, d) => { const p = T.pointAt(s, d); return [p.x, p.z]; };
    const BOT = -2;
    const segs = [];
    for (let qa = q0; qa < q1 - 1; qa += seg) {
      const qb = Math.min(q1, qa + seg);
      let ymax = -1e9;
      for (let q = qa; q <= qb; q += 1) ymax = Math.max(ymax, T.heightAt(T.wrapS(t0 + q), 0));
      segs.push({ qa, qb, top: ymax + height });
    }
    let u = 0;
    for (const g of segs) {
      const n = Math.max(1, Math.ceil((g.qb - g.qa) / 2));
      for (let i = 0; i < n; i++) {
        const sa = T.wrapS(t0 + g.qa + (g.qb - g.qa) * i / n), sb = T.wrapS(t0 + g.qa + (g.qb - g.qa) * (i + 1) / n);
        const la = XZ(sa, outerL(sa)), lb = XZ(sb, outerL(sb)), ra = XZ(sa, outerR(sa)), rb = XZ(sb, outerR(sb));
        const du = Math.hypot(lb[0] - la[0], lb[1] - la[1]) / 6.8, v1 = (g.top - BOT) / 6.4;
        // left (outer side of the bend) faces outwards = +n; right faces -n
        quad([lb[0], BOT, lb[1]], [la[0], BOT, la[1]], [lb[0], g.top, lb[1]], [la[0], g.top, la[1]], [u + du, 0], [u, 0], [u + du, v1], [u, v1]);
        quad([ra[0], BOT, ra[1]], [rb[0], BOT, rb[1]], [ra[0], g.top, ra[1]], [rb[0], g.top, rb[1]], [u, 0], [u + du, 0], [u, v1], [u + du, v1]);
        // roof (faces up)
        quad([la[0], g.top, la[1]], [ra[0], g.top, ra[1]], [lb[0], g.top, lb[1]], [rb[0], g.top, rb[1]], [0.02, 0.98], [0.02, 0.98], [0.02, 0.98], [0.02, 0.98], 0.8);
        u += du;
      }
    }
    // steps in the roof line between segments (vertical face looking at the lower roof)
    for (let i = 1; i < segs.length; i++) {
      const a = segs[i - 1], b = segs[i];
      if (Math.abs(a.top - b.top) < 0.05) continue;
      const sq = T.wrapS(t0 + b.qa);
      const L2 = XZ(sq, outerL(sq)), R2 = XZ(sq, outerR(sq));
      const lo2 = Math.min(a.top, b.top), hi2 = Math.max(a.top, b.top), v = (hi2 - lo2) / 6.4, uu = Math.hypot(L2[0] - R2[0], L2[1] - R2[1]) / 6.8;
      // previous segment higher -> face looks forward (+t) over the next roof, else backwards
      if (a.top > b.top) quad([R2[0], lo2, R2[1]], [L2[0], lo2, L2[1]], [R2[0], hi2, R2[1]], [L2[0], hi2, L2[1]], [0, 0], [uu, 0], [0, v], [uu, v]);
      else quad([L2[0], lo2, L2[1]], [R2[0], lo2, R2[1]], [L2[0], hi2, L2[1]], [R2[0], hi2, R2[1]], [0, 0], [uu, 0], [0, v], [uu, v]);
    }
    // end faces: only the parts outside the tunnel cross-section (wings + the wall above the slab)
    for (const [g, dir] of [[segs[0], -1], [segs[segs.length - 1], 1]]) {
      const sq = T.wrapS(t0 + (dir < 0 ? g.qa : g.qb));
      const yRoad = T.heightAt(sq, 0);
      const parts = [
        [wallL(sq), outerL(sq), BOT, g.top],          // left wing
        [outerR(sq), wallR(sq), BOT, g.top],          // right wing
        [wallR(sq), wallL(sq), yRoad + 6.4, g.top],    // above the tunnel slab
      ];
      for (const [dRight, dLeft, y0, y1] of parts) {
        const A = XZ(sq, dLeft), B = XZ(sq, dRight);
        const uu = Math.hypot(A[0] - B[0], A[1] - B[1]) / 6.8, v = (y1 - y0) / 6.4;
        // dir < 0: faces back along the road (-t), i.e. towards a car approaching the entrance
        if (dir < 0) quad([A[0], y0, A[1]], [B[0], y0, B[1]], [A[0], y1, A[1]], [B[0], y1, B[1]], [0, 0], [uu, 0], [0, v], [uu, v]);
        else quad([B[0], y0, B[1]], [A[0], y0, A[1]], [B[0], y1, B[1]], [A[0], y1, A[1]], [0, 0], [uu, 0], [0, v], [uu, v]);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const hotel = new THREE.Mesh(g, bMats[1]);
    hotel.name = 'fairmont'; hotel.matrixAutoUpdate = false;
    root.add(hotel);
  }
  // the Prince's Palace and the Oceanographic Museum on the Rock
  {
    const pal = new THREE.Mesh(new THREE.BoxGeometry(70, 14, 30), new THREE.MeshLambertMaterial({ color: 0xead2b8 }));
    pal.position.set(-210, 56 + 7, 740); pal.rotation.y = 0.3; bake(pal);
    for (let i = 0; i < 6; i++) { const t = new THREE.Mesh(new THREE.BoxGeometry(5, 18, 5), pal.material); t.position.set(-245 + i * 13, 56 + 9, 728 + i * 4); bake(t); }
    const mus = new THREE.Mesh(new THREE.BoxGeometry(50, 30, 22), stone); mus.position.set(-20, 30, 830); mus.rotation.y = 0.5; bake(mus);
  }
  // Rainier III swimming pool between the two pool chicanes (right side)
  if (RES.pool) {
    const r = RES.pool;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(32, 0.4, 70), new THREE.MeshLambertMaterial({ color: 0xe9e6df }));
    deck.position.set(r.x, r.y - 0.1, r.z); deck.rotation.y = r.rot; bake(deck);
    const pool = new THREE.Mesh(new THREE.BoxGeometry(22, 0.42, 50), new THREE.MeshStandardMaterial({ color: 0x1b9ad6, roughness: 0.1 }));
    pool.position.set(r.x, r.y - 0.05, r.z); pool.rotation.y = r.rot; bake(pool);
  }
  // pit garages (temporary two-storey buildings) along the start straight
  {
    const teamCols = [0x16213f, 0xc8102e, 0x00a19c, 0xff8000, 0x006f62, 0x2293d1, 0x6692ff, 0xb6babd, 0x1e41ff, 0x52e252];
    const gm = teamCols.map(c => new THREE.MeshLambertMaterial({ color: c }));
    const frame = new THREE.MeshLambertMaterial({ color: 0xdedede });
    for (const { s: sg, d, i } of GARAGES) {
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(16, 8, 6), frame); box.position.y = 4; g.add(box);
      const front = new THREE.Mesh(new THREE.BoxGeometry(14, 3.2, 0.3), gm[i % gm.length]); front.position.set(0, 1.8, 3.1); g.add(front);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(15, 1.4, 0.3), gm[i % gm.length]); upper.position.set(0, 6.4, 3.1); g.add(upper);
      const gObj = placeAt(sg, d, g, 0.1);
      // garages face the pit lane (towards the track)
      gObj.rotation.y += Math.PI / 2;
      bake(gObj);
    }
  }

  // ---- grandstands -------------------------------------------------------------------------
  const crowdTex = TX.crowd(hi ? 1 : 0.6);
  crowdTex.repeat.set(1, 1);
  const standMat = new THREE.MeshLambertMaterial({ map: crowdTex });
  const standFrame = new THREE.MeshLambertMaterial({ color: 0xbfc4c9 });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2, side: THREE.DoubleSide });
  for (const { k, p, fcx, fcz, rot } of STAND_SEGS) {
    const g = new THREE.Group();
    const rows = 8, rise = 1.0, run = 1.4, w = 23;
    for (let r = 0; r < rows; r++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(w, rise, run), standMat);
      step.position.set(0, 1.5 + r * rise, -(r * run));
      g.add(step);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(w, rows * rise + 4, 0.4), standFrame); back.position.set(0, (rows * rise + 4) / 2, -rows * run - 0.2); g.add(back);
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(w, rows * run + 2), roofMat); roof.rotation.x = -Math.PI / 2 + 0.12; roof.position.set(0, rows * rise + 5, -rows * run / 2); g.add(roof);
    // face the track (local -z points away from it); stands on the lowest ground under it
    g.position.set(p.x, Math.min(T.py[k] - 0.5, groundMin(fcx, fcz, rot, 12.6, 23.4) + 0.2), p.z);
    g.rotation.y = rot;
    bake(g);
  }
  const cs = (id) => corner(id);

  // ---- yachts ------------------------------------------------------------------------------
  const hullMat = new THREE.MeshLambertMaterial({ color: 0xf4f6f8 });
  const hullDark = new THREE.MeshLambertMaterial({ color: 0x14213d });
  const deckMat = new THREE.MeshLambertMaterial({ color: 0x9aa7b3 });
  const yachtGeo = (len, wid, decks) => {
    const g = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(-wid / 2, 0); shape.lineTo(wid / 2, 0); shape.lineTo(wid / 2, len * 0.72);
    shape.quadraticCurveTo(wid / 2, len * 0.9, 0, len); shape.quadraticCurveTo(-wid / 2, len * 0.9, -wid / 2, len * 0.72); shape.closePath();
    const hull = new THREE.ExtrudeGeometry(shape, { depth: wid * 0.35, bevelEnabled: false });
    hull.rotateX(-Math.PI / 2); hull.translate(0, -0.5, len / 2);
    g.add(new THREE.Mesh(hull, R() < 0.25 ? hullDark : hullMat));
    for (let i = 0; i < decks; i++) {
      const dl = len * (0.55 - i * 0.12), dw = wid * (0.8 - i * 0.1);
      const d = new THREE.Mesh(new THREE.BoxGeometry(dw, 2.2, dl), hullMat);
      d.position.set(0, wid * 0.35 + 0.6 + i * 2.3, -len * 0.05 + i * 1.5);
      g.add(d);
      const band = new THREE.Mesh(new THREE.BoxGeometry(dw + 0.05, 0.8, dl * 0.92), deckMat);
      band.position.copy(d.position); band.position.y += 0.2;
      g.add(band);
    }
    return g;
  };
  const nY = lo ? 14 : hi ? 46 : 28;
  let placed = 0;
  // moored stern-to along the harbour quays (left side of the track from the chicane to Rascasse)
  for (let s = cs('chicane') + 60; s < cs('rascasse') - 30 && placed < nY * 0.75; s += 11 + R() * 8) {
    const bar = T.sample(T.barL, s);
    const len = 18 + R() * 26, wid = len * 0.22;
    const p = T.pointAt(s, bar + 14 + len / 2);
    if (!pointInPoly(p.x, p.z, HARBOUR)) continue;
    const k = T.idxOfS(s);
    if (footprintClear(C, p.x, p.z, Math.atan2(T.nx[k], T.nz[k]), wid, len, 'bar') < 3) continue;
    const y = yachtGeo(len, wid, 1 + Math.floor(R() * 3));
    y.position.set(p.x, 0, p.z);
    y.rotation.y = Math.atan2(T.nx[k], T.nz[k]) + Math.PI;
    bake(y); placed++;
  }
  // superyachts in the basin
  for (let i = 0; i < 40 && placed < nY; i++) {
    const x = -40 + R() * 320, z = 120 + R() * 400;
    if (!pointInPoly(x, z, HARBOUR)) continue;
    const len = 30 + R() * 50, wid = len * 0.2, yr = R() * Math.PI * 2;
    if (footprintClear(C, x, z, yr, wid, len, 'bar') < 3) continue;
    const y = yachtGeo(len, wid, 2 + Math.floor(R() * 3));
    y.position.set(x, 0, z); y.rotation.y = yr;
    bake(y); placed++;
  }

  // ---- palms -------------------------------------------------------------------------------
  {
    const fr = document.createElement('canvas'); fr.width = 128; fr.height = 64;
    const fx = fr.getContext('2d');
    fx.strokeStyle = '#3f6b2a'; fx.lineWidth = 3;
    fx.beginPath(); fx.moveTo(0, 32); fx.quadraticCurveTo(64, 18, 128, 34); fx.stroke();
    for (let i = 4; i < 124; i += 5) { fx.lineWidth = 2; fx.beginPath(); fx.moveTo(i, 30 - Math.sin(i / 128 * 3) * 6); fx.lineTo(i + 6, 8 + i / 12); fx.moveTo(i, 32); fx.lineTo(i + 6, 56 - i / 12); fx.stroke(); }
    const ft = new THREE.CanvasTexture(fr); ft.colorSpace = THREE.SRGBColorSpace;
    const frondMat = new THREE.MeshLambertMaterial({ map: ft, alphaTest: 0.3, side: THREE.DoubleSide, transparent: false });
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a7458 });
    const trunk = new THREE.CylinderGeometry(0.18, 0.28, 11, 6); trunk.translate(0, 5.5, 0);
    const frond = new THREE.PlaneGeometry(5, 2.2); frond.translate(2.5, 0, 0);
    const fronds = [];
    for (let i = 0; i < 7; i++) { const f = frond.clone(); f.rotateX(0.5); f.rotateZ(-0.5); f.rotateY(i / 7 * Math.PI * 2); f.translate(0, 11, 0); fronds.push(f); }
    const frondGeo = mergeSimple(fronds);
    const positions = [];
    for (let s = 0; s < T.L; s += 22) {
      const near = ['ste-devote', 'casino', 'tabac', 'pool1', 'rascasse'].some(id => Math.abs(T.deltaS(s, cs(id))) < 140) || s > T.L - 300;
      if (!near || R() < 0.35) continue;
      const side = R() < 0.5 ? 1 : -1;
      const bar = side > 0 ? T.sample(T.barL, s) : T.sample(T.barR, s);
      const pit = (s > T.L - 150 || s < 300) && side < 0;
      if (pit) continue;
      const p = T.pointAt(s, side * (bar + 2.4));
      if (isWater(p.x, p.z)) continue;
      if (clearBarAt(C, p.x, p.z) < 1.2) continue;          // trunk off every section's run-off
      positions.push([p.x, T.py[T.idxOfS(s)], p.z]);
    }
    const count = lo ? Math.min(30, positions.length) : positions.length;
    const it = new THREE.InstancedMesh(trunk, trunkMat, count), ifr = new THREE.InstancedMesh(frondGeo, frondMat, count);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const [x, y, z] = positions[i];
      const sc = 0.85 + R() * 0.4;
      m4.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6), new THREE.Vector3(sc, sc, sc));
      it.setMatrixAt(i, m4); ifr.setMatrixAt(i, m4);
    }
    it.name = 'palms'; ifr.name = 'palms';
    lm.add(it); lm.add(ifr);
  }

  // merge baked props
  for (const [mat, list] of baked) {
    const g = mergeGeometries(list, false);
    if (!g) continue;
    const m = new THREE.Mesh(g, mat);
    m.matrixAutoUpdate = false; m.name = 'props';
    lm.add(m);
  }

  // ---- mountains backdrop -------------------------------------------------------------------
  {
    const g = new THREE.BufferGeometry();
    const pos = [], col = [];
    const ring = [];
    for (let a = -1.9; a <= 1.25; a += 0.05) {   // north-west through north-east (inland)
      const ang = a - Math.PI / 2;  // around north (-z)
      const r = 2600 + Math.sin(a * 3.1) * 400;
      const h = 380 + 260 * Math.max(0, Math.sin(a * 1.7 + 0.8)) + 80 * Math.sin(a * 9.0) + 40 * Math.sin(a * 23.0);
      ring.push([Math.cos(ang) * r, h, Math.sin(ang) * r]);
    }
    // pre-hazed colours (aerial perspective at 2.5-3 km) so the ridge reads against the sky
    const base = new THREE.Color(0x8ea29f), top = new THREE.Color(0xa7b5b6);
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, h0, z0] = ring[i], [x1, h1, z1] = ring[i + 1];
      pos.push(x0, -20, z0, x0, h0, z0, x1, -20, z1, x1, -20, z1, x0, h0, z0, x1, h1, z1);
      for (const c of [base, top, base, base, top, top]) col.push(c.r, c.g, c.b);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const mtn = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false }));
    mtn.name = 'mountains';
    root.add(mtn);
  }

  return {
    root, sky, water, sunDir, nBuildings, terrainH, waterNormal, rej, corridor: C, terrainLimit: TL, terrainStep: TERRAIN_STEP,
    footprints: occupied, buildings: bBuilders.flat(),
  };
}

function mergeSimple(list) {
  const parts = list.map(g => g.index ? g.toNonIndexed() : g);
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    let total = 0; for (const p of parts) total += p.attributes[name].array.length;
    const arr = new Float32Array(total); let o = 0;
    for (const p of parts) { arr.set(p.attributes[name].array, o); o += p.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, parts[0].attributes[name].itemSize));
  }
  return out;
}

// Monaco scenery: sky, sea and Port Hercule, terrain, Riviera buildings along the circuit,
// landmarks (Casino, Hôtel de Paris, Fairmont over the tunnel, the Rock and the Palace,
// the swimming pool), pit garages, grandstands, yachts, palms and the mountain backdrop.
import * as THREE from 'three';
import * as TX from './textures.js';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { buildCorridor, footprintClear, terrainLimit, clearBarAt } from './corridor.js';
import { makeFacadeAtlas, CityBuilder, ROW, vRow, ATLAS_BAYS, addFacadeRecess } from './city.js';

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
    // expo: the camera exposure relative to daylight (main.js) - under the tunnel roof the
    // camera opens up and the sky beyond the portals blows out like the sun-lit street
    uniforms: { sunDir: { value: sunDir }, top: { value: new THREE.Color(0x2a66b3) }, mid: { value: new THREE.Color(0x86b4dd) }, hor: { value: new THREE.Color(0xdde8ee) }, expo: { value: 1 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: `varying vec3 vDir; uniform vec3 sunDir, top, mid, hor; uniform float expo;
      void main(){ float h = clamp(vDir.y, -0.2, 1.0);
        vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, h)); c = mix(c, top, smoothstep(0.18, 0.75, h));
        c = mix(c, vec3(0.80,0.84,0.86), smoothstep(0.02, -0.2, h));
        float sd = max(dot(normalize(vDir), sunDir), 0.0);
        c += vec3(1.0,0.92,0.75) * (pow(sd, 900.0) * 6.0 + pow(sd, 12.0) * 0.22);
        c *= expo; c = mix(c, vec3(1.0), clamp((expo - 1.0) * 0.35, 0.0, 0.6));
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
    // Monaco climbs steeply from the shore: La Condamine up to Moneghetti in the west, Monte-
    // Carlo up to the Moyenne Corniche (Beausoleil) in the north - ~70 m half a kilometre
    // inland, ~120 m at 800 m, so the city rises in layers behind the waterfront
    let h = ty - 0.4;
    if (dt > 40) h += Math.max(0, dt - 60) * 0.11 + Math.max(0, shore - 100) * 0.09;
    h = Math.min(h, 230);
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
  // one facade atlas and one material for every building (js/city.js)
  const atlas = makeFacadeAtlas();
  const cityMat = new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true });
  if (!lo) addFacadeRecess(cityMat, atlas.userData.recess);
  const BLD = [];
  // district character along the lap and inland (Monaco's quarters)
  const PAL = {
    belle: ['#efe3c8', '#f2dcc0', '#ecd5b0', '#f5ead8', '#e9d9bd', '#f1d5c3', '#efe0cf'],
    riviera: ['#e9b97a', '#e8a58c', '#f0cf86', '#dc9567', '#f3c6a5', '#e7c39a', '#f0dcb2', '#d9a37c', '#efc7b0'],
    modern: ['#f2f1ec', '#e6e3dc', '#ece6da', '#dfe0dc', '#f5efe2', '#e9e4d8'],
    old: ['#e8b77e', '#eac39c', '#e5a986', '#f0d39a', '#e2b48e', '#efc59a'],
    hotel: ['#f4f4f2', '#eeeeea'],
  };
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const styleAtS = (s) => {
    const r = R();
    if (s >= 2300 || s < 330) return r < 0.72 ? 'riviera' : r < 0.9 ? 'belle' : 'modern';     // La Condamine, harbour
    if (s < 800) return r < 0.4 ? 'riviera' : r < 0.75 ? 'belle' : 'modern';                // Ste Devote - Beau Rivage
    if (s < 1250) return r < 0.75 ? 'belle' : 'modern';                                      // Massenet - Casino
    if (s < 1660) return r < 0.6 ? 'modern' : 'belle';                                       // Mirabeau - Portier
    return r < 0.7 ? 'modern' : 'hotel';                                                     // tunnel - chicane (seafront)
  };
  const styleAtXZ = (x, z) => {
    const r = R();
    if (x > 150 && z < -60) return r < 0.7 ? 'modern' : 'belle';           // Monte-Carlo heights / Beausoleil
    if (x < 40) return r < 0.5 ? 'riviera' : 'modern';                      // La Condamine slopes, Moneghetti
    return r < 0.6 ? 'modern' : r < 0.85 ? 'belle' : 'riviera';
  };
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
  function building(cx, cz, ang, w, dpt, h, baseY, style, color, near = false, front = -1) {
    const ground = groundMin(cx, cz, ang, w, dpt);
    const y0 = Math.min(baseY, ground - 0.6);
    BLD.push({ cx, cz, ang, w, dpt, h: h + (baseY - y0), baseY: y0, color, style, near, front, seed: Math.floor(R() * 1e9) });
    addOcc(cx, cz, ang, w, dpt);
  }
  const cS = (id) => T.corners.find(c => c.id === id).s;
  // the seafront from the tunnel exit (the sea and the harbour's outer quay on the left), then the
  // harbour quays to La Rascasse: no buildings on the left, so leaving the tunnel opens the view
  // over the water to La Condamine and the Rock
  const quaySide = (s, side) => side > 0 && T.deltaS(T.tunnelS[1] - 5, s) >= 0 && T.deltaS(s, cS('rascasse') - 10) >= 0;
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
        const st = styleAtS(sc);
        const h = opts.h ? opts.h() : st === 'riviera' ? 13 + R() * 12 : st === 'belle' ? 16 + R() * 12 : 18 + R() * 24 + (R() < 0.15 ? 22 : 0);
        // first row: full architectural detail, its circuit-side face is the street front
        building(first.x, first.z, first.ang, first.w, first.dpt, h, T.py[k] - 1.5, st, pick(PAL[st]), true, side > 0 ? 0 : 2);
        // second row behind (taller, up the hill) - same full-footprint test
        if (!opts.single && R() < 0.85) {
          const w2 = first.w * (0.8 + R() * 0.4), d2 = 16 + R() * 10;
          const base2 = setback + first.e + first.dpt + 10 + R() * 8;
          const second = placeBeside(sc, side, base2, w2, d2, [0, 4, 9, 15], [1, 0.75]);
          const st2 = R() < 0.5 ? st : 'modern';
          if (second) building(second.x, second.z, second.ang, second.w, second.dpt, 20 + R() * 30, terrainH(second.x, second.z) - 2, st2, pick(PAL[st2]));
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
  {
    const sd = cS('ste-devote') + 4;
    RES.chapel = reserveAt(sd, T.sample(T.barL, sd) + 13, 10, 16, 0.6);
  }
  if (RES.chapel) addOcc3(RES.chapel.x, RES.chapel.z, RES.chapel.rot, 10, 16, 'landmark');
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
  for (let i = 0; i < (lo ? 900 : 2600) && inland < (lo ? 90 : hi ? 320 : 220); i++) {
    const x = -760 + R() * 1860, z = -1180 + R() * 1580;
    if (isWater(x, z) || coastSide(x, z) < 40) continue;
    // terraces: blocks run along the contour lines of the hillside
    const gx = terrainH(x + 4, z) - terrainH(x - 4, z), gz = terrainH(x, z + 4) - terrainH(x, z - 4);
    const ang = Math.hypot(gx, gz) > 0.4 ? Math.atan2(-gz, gx) + (R() - 0.5) * 0.25 : R() * Math.PI;
    const w = 18 + R() * 22, dpt = 13 + R() * 9;
    if (!footprintOK(x, z, ang, w, dpt, 8)) continue;
    if (!free(x, z, ang, w, dpt, 1)) continue;
    const tall = R() < 0.25;
    const st = styleAtXZ(x, z);
    building(x, z, ang, w, dpt, tall && st === 'modern' ? 45 + R() * 60 : 15 + R() * 25, terrainH(x, z) - 3, st, pick(PAL[st]));
    inland++;
  }
  // the Rock: low old-town blocks
  for (let i = 0, n = 0; i < 200 && n < (lo ? 20 : 45); i++) {
    const x = -330 + R() * 360, z = 660 + R() * 180;
    const ang = 0.35 + (R() - 0.5) * 0.3, w = 10 + R() * 12, dpt = 10 + R() * 10;
    if (rockH(x, z) < 50 || !free(x, z, ang, w, dpt, 1)) continue;
    if (!footprintOK(x, z, ang, w, dpt, 4)) continue;
    building(x, z, ang, w, dpt, 10 + R() * 9, Math.min(54, terrainH(x, z)), 'old', pick(PAL.old));
    n++;
  }

  const city = new CityBuilder({ tile: 300, detailTile: 150 });
  for (const b of BLD) city.building(b);
  const BLD_LANDMARK = [];
  const nBuildings = BLD.length;

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
  // Casino de Monte-Carlo: belle epoque stone block with the arched base, balconettes and attic,
  // twin towers on the corners of its square-facing front (copper caps), the central dome
  // (three.js local +x = towards the circuit; the builder's width runs along local z)
  const localXZ = (r, lx, lz) => [r.x + lx * Math.cos(r.rot) + lz * Math.sin(r.rot), r.z - lx * Math.sin(r.rot) + lz * Math.cos(r.rot)];
  if (RES.casino) {
    const r = RES.casino;
    const y0 = Math.min(r.y - 1, groundMin(r.x, r.z, r.rot, 32, 48) - 0.5);
    BLD_LANDMARK.push({ cx: r.x, cz: r.z, ang: r.rot, w: 30, dpt: 46, h: 17, baseY: y0, color: '#efe2c8', style: 'belle', near: true, front: 2, noAwnings: true, seed: 11 });
    const g = new THREE.Group();
    for (const lz of [-11.5, 11.5]) {
      const [tx, tz] = localXZ(r, 19.5, lz);
      city.box(tx, y0, tz, r.rot, 7.5, 27, 7.5, new THREE.Color('#efe2c8'), { row: ROW.belle, bayM: 3.75 });
      city.box(tx, y0 + 27, tz, r.rot, 8.3, 0.8, 8.3, new THREE.Color('#e6d7ba'), { row: ROW.plain });
      const cap = new THREE.Mesh(new THREE.ConeGeometry(5.6, 7.5, 4), copper); cap.position.set(19.5, 27.8 + 3.75, lz); cap.rotation.y = Math.PI / 4; g.add(cap);
    }
    // central entrance pavilion with the clock, and the dome
    { const [px, pz] = localXZ(r, 24.2, 0); city.box(px, y0, pz, r.rot, 12, 20, 2.5, new THREE.Color('#f2e7d0'), { row: ROW.belleBase, bayM: 4 }); }
    const clock = new THREE.Mesh(new THREE.CircleGeometry(1.3, 20), new THREE.MeshLambertMaterial({ color: 0xf6f1e4 })); clock.position.set(25.5, 18, 0); clock.rotation.y = Math.PI / 2; g.add(clock);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(8, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), copper); dome.position.set(0, 17, 0); g.add(dome);
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 3, 10), stone); lantern.position.set(0, 25.5, 0); g.add(lantern);
    g.position.set(r.x, y0, r.z); g.rotation.y = r.rot;
    bake(g);
  }
  // Hotel de Paris: belle epoque facade along the square, copper mansard roof
  if (RES.hdp) {
    const r = RES.hdp;
    const y0 = Math.min(r.y - 1, groundMin(r.x, r.z, r.rot, 28, 62) - 0.5);
    BLD_LANDMARK.push({ cx: r.x, cz: r.z, ang: r.rot, w: 26, dpt: 60, h: 22, baseY: y0, color: '#f3e7d2', style: 'belle', near: true, front: 0, seed: 12 });
    const hg = new THREE.Group();
    const roof = new THREE.Mesh(new THREE.BoxGeometry(58, 3.2, 24), copper); roof.position.y = 23.6; hg.add(roof);
    hg.position.set(r.x, y0, r.z); hg.rotation.y = r.rot;
    bake(hg);
  }
  // Sainte-Devote chapel on the outside of Turn 1: pink-ochre render, terracotta roofs, bell tower
  if (RES.chapel) {
    const r = RES.chapel;
    const y0 = Math.min(r.y - 1, groundMin(r.x, r.z, r.rot, 16, 10) - 0.5);
    BLD_LANDMARK.push({ cx: r.x, cz: r.z, ang: r.rot, w: 15, dpt: 9, h: 8.5, baseY: y0, color: '#eab996', style: 'old', near: false, front: -1, seed: 13 });
    const [bx, bz] = localXZ(r, 0, -9.4);
    city.box(bx, y0, bz, r.rot, 3.8, 17, 3.8, new THREE.Color('#eab996'), { row: ROW.old, bayM: 3.8 });
    const tg = new THREE.Group();
    const spire = new THREE.Mesh(new THREE.ConeGeometry(2.9, 3.4, 4), new THREE.MeshLambertMaterial({ color: 0xb5603a })); spire.position.set(0, 17 + 1.7, -9.4); spire.rotation.y = Math.PI / 4; tg.add(spire);
    tg.position.set(r.x, y0, r.z); tg.rotation.y = r.rot;
    bake(tg);
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
    const tint = [0.97, 0.96, 0.93];
    const quad = (a, b, c, d, ua, ub, uc, ud, f = 1) => {      // a,b bottom row; c,d top row; front = (b-a)x(c-a)
      pos.push(...a, ...b, ...c, ...b, ...d, ...c);
      uv.push(...ua, ...ub, ...uc, ...ub, ...ud, ...uc);
      for (let k = 0; k < 6; k++) col.push(tint[0] * f, tint[1] * f, tint[2] * f);
    };
    const outerL = (s) => T.sample(T.barL, s) + 0.95 + wL, outerR = (s) => -T.sample(T.barR, s) - 0.95 - wR;
    const wallL = (s) => T.sample(T.barL, s) + 0.35, wallR = (s) => -T.sample(T.barR, s) - 0.35;
    const XZ = (s, d) => { const p = T.pointAt(s, d); return [p.x, p.z]; };
    const BOT = -2, FL = 3.3;
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
        // left (outer side of the bend) faces outwards = +n; right faces -n; one band per floor
        const uu = du * 6.8 / 3.6 / ATLAS_BAYS, U0 = u * 6.8 / 3.6 / ATLAS_BAYS;
        for (let y = BOT; y < g.top - 0.5; y += FL) {
          const y2 = Math.min(g.top, y + FL), [r0, r1] = vRow(y < BOT + 2 * FL ? ROW.shop : ROW.hotel), rv = r0 + (r1 - r0) * (y2 - y) / FL;
          quad([lb[0], y, lb[1]], [la[0], y, la[1]], [lb[0], y2, lb[1]], [la[0], y2, la[1]], [U0 + uu, r0], [U0, r0], [U0 + uu, rv], [U0, rv]);
          quad([ra[0], y, ra[1]], [rb[0], y, rb[1]], [ra[0], y2, ra[1]], [rb[0], y2, rb[1]], [U0, r0], [U0 + uu, r0], [U0, rv], [U0 + uu, rv]);
        }
        // roof (faces up)
        const [f0, f1] = vRow(ROW.flat);
        quad([la[0], g.top, la[1]], [ra[0], g.top, ra[1]], [lb[0], g.top, lb[1]], [rb[0], g.top, rb[1]], [0.02, f0], [0.3, f0], [0.02, f1], [0.3, f1], 0.8);
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
      const [h0, h1] = vRow(ROW.hotel), uh = uu * 6.8 / 3.6 / ATLAS_BAYS;
      if (a.top > b.top) quad([R2[0], lo2, R2[1]], [L2[0], lo2, L2[1]], [R2[0], hi2, R2[1]], [L2[0], hi2, L2[1]], [0, h0], [uh, h0], [0, h1], [uh, h1]);
      else quad([L2[0], lo2, L2[1]], [R2[0], lo2, R2[1]], [L2[0], hi2, L2[1]], [R2[0], hi2, R2[1]], [0, h0], [uh, h0], [0, h1], [uh, h1]);
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
        const uu = Math.hypot(A[0] - B[0], A[1] - B[1]) / 3.6 / ATLAS_BAYS;
        // dir < 0: faces back along the road (-t), i.e. towards a car approaching the entrance;
        // one band per floor
        for (let y = y0; y < y1 - 0.3; y += FL) {
          const y2 = Math.min(y1, y + FL), [r0, r1] = vRow(ROW.hotel), rv = r0 + (r1 - r0) * (y2 - y) / FL;
          if (dir < 0) quad([A[0], y, A[1]], [B[0], y, B[1]], [A[0], y2, A[1]], [B[0], y2, B[1]], [0, r0], [uu, r0], [0, rv], [uu, rv]);
          else quad([B[0], y, B[1]], [A[0], y, A[1]], [B[0], y2, B[1]], [A[0], y2, A[1]], [0, r0], [uu, r0], [0, rv], [uu, rv]);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const hotel = new THREE.Mesh(g, cityMat);
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

  // ---- grandstands (kept empty) -----------------------------------------------------------
  // concrete terraces with rows of red moulded seats and aisles; a white canopy on a frame
  const seatTex = TX.seats();
  const seatMat = new THREE.MeshLambertMaterial({ map: seatTex });
  const stepMat = new THREE.MeshLambertMaterial({ color: 0xb4b8bc });
  const standFrame = new THREE.MeshLambertMaterial({ color: 0xbfc4c9 });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2, side: THREE.DoubleSide });
  const railMat = new THREE.MeshLambertMaterial({ color: 0x30343a });
  for (const { k, p, fcx, fcz, rot } of STAND_SEGS) {
    const g = new THREE.Group();
    const rows = 8, rise = 1.0, run = 1.4, w = 23;
    for (let r = 0; r < rows; r++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(w, rise, run), stepMat);
      step.position.set(0, 1.5 + r * rise, -(r * run));
      g.add(step);
      // the seat row stands on the tread in front of the next riser (texture repeats every 8 m)
      const sg = new THREE.PlaneGeometry(w, 0.8);
      const uv = sg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * w / 8 + (r % 2) * 0.5);
      const seatsRow = new THREE.Mesh(sg, seatMat);
      seatsRow.position.set(0, 1.5 + r * rise + rise / 2 + 0.4, -(r * run) - run / 2 + 0.38);
      g.add(seatsRow);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(w, rows * rise + 4, 0.4), standFrame); back.position.set(0, (rows * rise + 4) / 2, -rows * run - 0.2); g.add(back);
    // front railing on the lowest terrace
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.06), railMat); rail.position.set(0, 1.5 + rise / 2 + 1.0, run / 2 - 0.05); g.add(rail);
    for (let x = -w / 2 + 0.5; x <= w / 2; x += 2.3) { const pst = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.0, 0.05), railMat); pst.position.set(x, 1.5 + rise / 2 + 0.5, run / 2 - 0.05); g.add(pst); }
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(w, rows * run + 2), roofMat); roof.rotation.x = -Math.PI / 2 + 0.12; roof.position.set(0, rows * rise + 5, -rows * run / 2); g.add(roof);
    // face the track (local -z points away from it); stands on the lowest ground under it
    g.position.set(p.x, Math.min(T.py[k] - 0.5, groundMin(fcx, fcz, rot, 12.6, 23.4) + 0.2), p.z);
    g.rotation.y = rot;
    bake(g);
  }
  const cs = (id) => corner(id);

  // ---- yachts ------------------------------------------------------------------------------
  // motor yachts: a raked hull with a sheer line rising to the bow and a dark boot stripe at
  // the waterline, stepped superstructure decks wrapped in tinted glass bands, a flybridge
  // with a radar arch and dome, and a swim platform at the stern (all merged by material)
  const hullMat = new THREE.MeshLambertMaterial({ color: 0xf4f6f8 });
  const hullDark = new THREE.MeshLambertMaterial({ color: 0x14213d });
  const bootMat = new THREE.MeshLambertMaterial({ color: 0x1b2433 });
  const deckMat = new THREE.MeshLambertMaterial({ color: 0xb89a74 });            // teak decks
  const glassBand = new THREE.MeshStandardMaterial({ color: 0x18222e, roughness: 0.12, metalness: 0.35, envMapIntensity: 1.2 });
  const steelMat = new THREE.MeshLambertMaterial({ color: 0xd9dde2 });
  const hullShape = (len, wid, inset = 0) => {
    const w = wid / 2 - inset, L0 = inset, L1 = len - inset * 1.6;
    const sh = new THREE.Shape();
    sh.moveTo(-w * 0.92, L0); sh.lineTo(w * 0.92, L0);                         // transom
    sh.quadraticCurveTo(w, L0 + 0.02 * len, w, L0 + 0.12 * len); sh.lineTo(w, L1 * 0.62);
    sh.quadraticCurveTo(w, L1 * 0.88, 0, L1); sh.quadraticCurveTo(-w, L1 * 0.88, -w, L1 * 0.62);
    sh.lineTo(-w, L0 + 0.12 * len); sh.quadraticCurveTo(-w, L0 + 0.02 * len, -w * 0.92, L0);
    return sh;
  };
  const yachtGeo = (len, wid, decks) => {
    const g = new THREE.Group();
    const fb = wid * 0.36;                                       // freeboard aft
    const hull = new THREE.ExtrudeGeometry(hullShape(len, wid), { depth: fb, bevelEnabled: false, curveSegments: 3 });
    hull.rotateX(-Math.PI / 2); hull.translate(0, -0.6, len / 2);
    // sheer line: raise the deck towards the bow (vertices on top, scaled by how far forward)
    { const pa = hull.attributes.position; for (let i = 0; i < pa.count; i++) { const y = pa.getY(i); if (y > -0.6 + fb * 0.5) { const f = Math.max(0, (len / 2 - pa.getZ(i)) / len); pa.setY(i, y + f * f * fb * 0.55); } } hull.computeVertexNormals(); }
    const dark = R() < 0.22;
    g.add(new THREE.Mesh(hull, dark ? hullDark : hullMat));
    const boot = new THREE.ExtrudeGeometry(hullShape(len * 1.004, wid * 1.012), { depth: 0.32, bevelEnabled: false, curveSegments: 3 });
    boot.rotateX(-Math.PI / 2); boot.translate(0, -0.18, len / 2 * 1.004);
    g.add(new THREE.Mesh(boot, bootMat));
    // teak main deck
    const deck = new THREE.ExtrudeGeometry(hullShape(len, wid, 0.35), { depth: 0.06, bevelEnabled: false, curveSegments: 2 });
    deck.rotateX(-Math.PI / 2); deck.translate(0, fb - 0.6 + 0.01, len / 2);
    g.add(new THREE.Mesh(deck, deckMat));
    // swim platform at the stern
    { const sp = new THREE.Mesh(new THREE.BoxGeometry(wid * 0.84, 0.18, 1.6), deckMat); sp.position.set(0, 0.35, len / 2 + 0.8); g.add(sp); }
    // superstructure: each deck shorter and set further forward, a glass band all round
    let y = fb - 0.6, top = y;
    for (let i = 0; i < decks; i++) {
      const dl = len * (0.56 - i * 0.12), dw = wid * (0.82 - i * 0.1), dh = 2.5;
      const zc = len * 0.02 - i * 1.2;
      const d = new THREE.ExtrudeGeometry(hullShape(dl, dw), { depth: dh, bevelEnabled: false, curveSegments: 2 });
      d.rotateX(-Math.PI / 2); d.translate(0, y, zc + dl / 2);
      g.add(new THREE.Mesh(d, hullMat));
      const band = new THREE.ExtrudeGeometry(hullShape(dl * 1.01, dw * 1.02), { depth: 1.05, bevelEnabled: false, curveSegments: 2 });
      band.rotateX(-Math.PI / 2); band.translate(0, y + 0.95, zc + dl * 1.01 / 2);
      g.add(new THREE.Mesh(band, glassBand));
      // overhanging deck slab (the next deck's floor) with its shadowed edge
      const slab = new THREE.ExtrudeGeometry(hullShape(dl * 1.06, dw * 1.04), { depth: 0.22, bevelEnabled: false, curveSegments: 2 });
      slab.rotateX(-Math.PI / 2); slab.translate(0, y + dh, zc + dl * 1.06 / 2 + 0.3);
      g.add(new THREE.Mesh(slab, hullMat));
      y += dh + 0.22; top = y;
    }
    // flybridge: radar arch and a dome, a short mast
    { const zc = -len * 0.06;
      const arch = new THREE.Mesh(new THREE.BoxGeometry(wid * 0.5, 1.6, 0.5), hullMat); arch.position.set(0, top + 0.8, zc); g.add(arch);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 6), steelMat); dome.position.set(0, top + 1.9, zc); g.add(dome);
      const mast = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 0.12), steelMat); mast.position.set(wid * 0.18, top + 2.6, zc); g.add(mast); }
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

  for (const b of BLD_LANDMARK) city.building(b);
  // Retaining walls and garden walls just beyond the pavements from Mirabeau round the hairpin
  // to Portier: coursed stone rising with the hillside on the uphill side, so the road runs in
  // the tight cutting it does in reality
  {
    const wallCol = new THREE.Color('#d9cfb4');
    for (const side of [1, -1]) {
      let run = [];
      const flush = () => { if (run.length > 1) city.wall(run, 0.6, wallCol); run = []; };
      for (let s = cS('mirabeau') - 40; s <= cS('portier') + 30; s += 3) {
        const k = T.idxOfS(s);
        const bar = side > 0 ? T.sample(T.barL, s) : T.sample(T.barR, s);
        const walk = side > 0 ? C.walkL[k] : C.walkR[k];
        const p = T.pointAt(s, side * (bar + walk + 0.7));
        const ok = !isWater(p.x, p.z) && footprintClear(C, p.x, p.z, Math.atan2(T.tx[k], T.tz[k]), 0.6, 3.2, 'walk') >= 0.15;
        if (!ok) { flush(); continue; }
        const yRoad = T.py[k];
        const hill = terrainH(p.x, p.z) - yRoad;
        const top = yRoad + Math.max(1.3, Math.min(7.5, hill + 1.2));
        run.push([p.x, p.z, Math.min(yRoad - 1.0, groundAt(p.x, p.z) - 0.3), top]);
      }
      flush();
    }
  }
  // the city (buildings, terraces, retaining walls) - one material, tiled for culling
  for (const m of city.build(cityMat)) root.add(m);

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
    root, sky, water, sunDir, nBuildings, terrainH, groundAt, groundMax: Math.max(...TG.h), waterNormal, rej, corridor: C, terrainLimit: TL, terrainStep: TERRAIN_STEP,
    footprints: occupied, buildings: BLD.concat(BLD_LANDMARK),
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

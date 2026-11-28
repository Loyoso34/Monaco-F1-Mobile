// Monaco scenery: sky, sea and Port Hercule, terrain, Riviera buildings along the circuit,
// landmarks (Casino, Hôtel de Paris, Fairmont over the tunnel, the Rock and the Palace,
// the swimming pool), pit garages, grandstands, yachts, palms and the mountain backdrop.
import * as THREE from 'three';
import * as TX from './textures.js';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { buildCorridor, footprintClear, terrainLimit, clearBarAt } from './corridor.js';
import { makeFacadeAtlas, CityBuilder, ROW, vRow, ATLAS_BAYS, addFacadeRecess, addFacadeDetail, DETAIL_LAYER } from './city.js';
import { buildStreetLife } from './streetlife.js';
import { receiveSunShadow, bakeSunShadow, SUN_SHADOW_LAYER } from './sunshadow.js';

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
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
      float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
      void main(){ vec3 d = normalize(vDir); float h = clamp(d.y, -0.2, 1.0);
        vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, h)); c = mix(c, top, smoothstep(0.18, 0.75, h));
        c = mix(c, vec3(0.80,0.84,0.86), smoothstep(0.02, -0.2, h));
        float sd = max(dot(d, sunDir), 0.0);
        // fair-weather clouds on a plane above the city: scattered cumulus low over the
        // horizon (flattened by perspective), thin cirrus streaks high up; lit tops, grey bases,
        // brighter towards the sun; none below the horizon
        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y + 0.06);
          float cu = fbm(uv * 1.15 + vec2(3.0, 7.0));
          float cov = smoothstep(0.56, 0.78, cu) * smoothstep(0.02, 0.16, d.y) * (1.0 - smoothstep(0.55, 0.9, d.y));
          float shade = smoothstep(0.56, 0.9, fbm(uv * 1.15 + vec2(3.06, 7.04)));
          vec3 cloud = mix(vec3(0.74, 0.77, 0.82), vec3(1.0, 0.99, 0.96), shade) * (1.0 + 0.35 * pow(sd, 6.0));
          c = mix(c, cloud, cov * 0.92);
          float ci = fbm(vec2(uv.x * 0.6, uv.y * 4.0) + vec2(11.0, 2.0));
          c = mix(c, vec3(0.92, 0.95, 0.98), smoothstep(0.62, 0.8, ci) * 0.35 * smoothstep(0.12, 0.4, d.y));
        }
        c += vec3(1.0,0.92,0.75) * (pow(sd, 900.0) * 6.0 + pow(sd, 12.0) * 0.22);
        c *= expo; c = mix(c, vec3(1.0), clamp((expo - 1.0) * 0.35, 0.0, 0.6));
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4500, 32, 16), skyMat);
  sky.renderOrder = -10; sky.frustumCulled = false; sky.name = 'sky';
  root.add(sky);

  // ---- water ---------------------------------------------------------------------------------
  const waterNormal = TX.waterNormal(lo ? 128 : 256);
  waterNormal.repeat.set(600, 600);                   // 15 m ripple tiles (main.js drifts them)
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x0b3a50, roughness: 0.07, metalness: 0.0, normalMap: waterNormal, normalScale: new THREE.Vector2(0.42, 0.42), envMapIntensity: 1.0 });
  // three ripple scales from the one normal map - ~4.5 m chop, the 15 m ripples and ~55 m swell -
  // each running its own way, so the harbour never shows a repeating tile and the sun breaks
  // into a field of glints instead of one smeared highlight
  waterMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `
      #ifdef USE_NORMALMAP_TANGENTSPACE
        vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
        vec3 mapN2 = texture2D( normalMap, vNormalMapUv.yx * 3.3 + vec2( 0.37, 0.11 ) ).xyz * 2.0 - 1.0;
        vec3 mapN3 = texture2D( normalMap, vNormalMapUv * 0.27 + vec2( 0.61, 0.23 ) ).xyz * 2.0 - 1.0;
        mapN = vec3( ( mapN.xy + mapN2.xy * 0.55 + mapN3.xy * 0.9 ) * normalScale, 1.0 );
        normal = normalize( tbn * mapN );
      #else
        #include <normal_fragment_maps>
      #endif`);
  };
  waterMat.customProgramCacheKey = () => 'harbourWater';
  const water = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000, 1, 1), waterMat);
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
  // gardens: a smooth field (value noise at ~110 m and ~40 m) - the hillside parks, the gardens
  // between the terraces and on the Rock's slopes; it colours the terrain and places the trees
  const vhash = (i, j) => { const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return h - Math.floor(h); };
  const vnoise = (x, z, cell) => {
    const fx = x / cell, fz = z / cell, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    return (vhash(i, j) * (1 - su) + vhash(i + 1, j) * su) * (1 - sv) + (vhash(i, j + 1) * (1 - su) + vhash(i + 1, j + 1) * su) * sv;
  };
  const greenAt = (x, z) => {
    let g = 0.62 * vnoise(x + 900, z + 1300, 110) + 0.38 * vnoise(x + 300, z - 200, 40);
    const cs = coastSide(x, z);
    if (cs < 45) g -= (45 - cs) / 60;                       // the waterfront is paved
    const [dt] = nearestTrack(x, z);
    if (dt < 60) g -= (60 - dt) / 140;                      // the streets round the circuit are built up
    return g;
  };
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
      // Monaco hillsides: gardens (umbrella pines, cypresses, olive) between pale stone and
      // rendered terraces - from the same green field that places the trees
      const gr = greenAt(x, z);
      if (h < -0.5) c = [0.30, 0.33, 0.31];
      else if (rockH(x, z) > 20 && Math.abs(h - rockH(x, z)) < 1) c = [0.47, 0.45, 0.39];
      else if (gr > 0.46) { const k = Math.min(1, (gr - 0.46) * 4); c = [0.40 - 0.16 * k + n * 0.02, 0.39 - 0.07 * k + n * 0.02, 0.34 - 0.14 * k]; }
      else c = [0.44 + n * 0.03, 0.42 + n * 0.03, 0.38 + n * 0.02];
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const grain = TX.concrete(256, 150);
    grain.repeat.set((X1 - X0) / 24, (Z1 - Z0) / 24);
    // UVs for the grain texture
    const uvA = g.attributes.uv; for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i), uvA.getY(i));
    const terrain = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, map: grain }));
    if (!lo) receiveSunShadow(terrain.material);
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
  { const grain = TX.concrete(256, 160); grain.colorSpace = THREE.NoColorSpace; addFacadeDetail(cityMat, atlas.userData.glass, grain); }
  const staticShadow = !lo;                       // the baked sun shadow map (js/sunshadow.js)
  if (staticShadow) receiveSunShadow(cityMat);
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

  // ---- overhead sponsor bridges and corner billboards -----------------------------------------
  // Footbridges over the circuit carry sponsor banners on both faces (deck underside 6.2 m above
  // the road, over the 5 m drivable headroom); free-standing hoardings stand on the pavement on
  // the outside of the braking zones, angled towards the approaching cars. Steel in one material,
  // the banners in the sponsor atlas (TX.drawSponsor art), baked into the static props below.
  // Each deck is also a shade prism (its shadow falls on the road; see main.js / shade.js).
  const SHADE_EXTRA = [];
  const brSteel = new THREE.MeshLambertMaterial({ color: 0xcfd3d8 });
  const brDark = new THREE.MeshLambertMaterial({ color: 0x3a3e44 });
  const sponsorTex = TX.sponsorAtlas();
  const sponsorMat = new THREE.MeshLambertMaterial({ map: sponsorTex });
  const sponsorGeo = (w, h, i) => {             // a w x h panel (faces +z) showing sponsor panel i
    const g = new THREE.PlaneGeometry(w, h);
    const [u0, v0, u1, v1] = TX.sponsorUV(i);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) ? u1 : u0, uv.getY(k) ? v1 : v0);
    return g;
  };
  const bridgeMeshes = [];
  {
    const clearSpot = (x, z, r) => !isWater(x, z) && clearBarAt(C, x, z) >= 0.5 && free(x, z, 0, r, r, 0.2);
    const wanted = [[cS('ste-devote') - 170, 0], [cS('beau-rivage') - 60, 4], [cS('tabac') + 80, 8]];
    for (const [s0, sp0] of wanted) {
      for (const ds of [0, 8, -8, 16, -16, 24, -24, 32, -32]) {
        const sb = T.wrapS(s0 + ds), k = T.idxOfS(sb);
        if (T.inTunnel(sb)) continue;
        const dl = T.sample(T.barL, sb) + 1.0, dr = -T.sample(T.barR, sb) - 1.0;
        const pl = T.pointAt(sb, dl), pr = T.pointAt(sb, dr);
        if (!clearSpot(pl.x, pl.z, 1.2) || !clearSpot(pr.x, pr.z, 1.2)) continue;
        const yRoad = Math.max(T.heightAt(sb, dl), T.heightAt(sb, dr), T.heightAt(sb, 0));
        const yB = yRoad + 6.2, yT = yB + 1.5, half = 1.5;
        const ang = Math.atan2(T.tx[k], T.tz[k]);
        const g = new THREE.Group();
        const span = Math.hypot(pl.x - pr.x, pl.z - pr.z) + 1.2;
        // the deck: a box across the road (local x across, z along the road)
        const deck = new THREE.Mesh(new THREE.BoxGeometry(span, 1.5, half * 2), brSteel); deck.position.set(0, yB + 0.75, 0); g.add(deck);
        // banners on both faces: sponsor panels 4 m x 1 m side by side, a dark trim above / below
        const nP = Math.max(1, Math.floor((span - 0.6) / 4)), pw = (span - 0.6) / nP;
        for (const face of [1, -1]) {
          for (let i = 0; i < nP; i++) {
            const pm = new THREE.Mesh(sponsorGeo(pw, 1.05, sp0 + (i % 2)), sponsorMat);
            pm.position.set(-span / 2 + 0.3 + pw * (i + 0.5), yB + 0.75, face * (half + 0.012));
            if (face < 0) pm.rotation.y = Math.PI;
            g.add(pm);
          }
        }
        // handrails and posts along both edges of the walkway
        for (const e of [half - 0.05, -half + 0.05]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(span, 0.06, 0.06), brDark); rail.position.set(0, yT + 1.05, e); g.add(rail);
          for (let xx = -span / 2 + 0.2; xx <= span / 2; xx += 1.6) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.05, 0.05), brDark); post.position.set(xx, yT + 0.52, e); g.add(post); }
        }
        // pylons: two columns at each end, down to the ground
        for (const [px, pz] of [[pl.x, pl.z], [pr.x, pr.z]]) {
          const gy = Math.min(groundAt(px, pz), T.heightAt(sb, 0)) - 0.3;
          for (const dz of [-0.9, 0.9]) {
            const lx = (px - (pl.x + pr.x) / 2) * Math.cos(ang) - (pz - (pl.z + pr.z) / 2) * Math.sin(ang);
            const col = new THREE.Mesh(new THREE.BoxGeometry(0.45, yB - gy, 0.45), brSteel);
            col.position.set(lx, gy + (yB - gy) / 2, dz); g.add(col);
          }
        }
        // the group: centred between the pylons, local x across the road
        g.position.set((pl.x + pr.x) / 2, 0, (pl.z + pr.z) / 2);
        g.rotation.y = ang;
        bridgeMeshes.push(g);
        addOcc((pl.x + pr.x) / 2, (pl.z + pr.z) / 2, ang, half * 2 + 1, span, 'bridge');
        SHADE_EXTRA.push({ cx: (pl.x + pr.x) / 2, cz: (pl.z + pr.z) / 2, ang, w: half * 2, dpt: span, h: 1.5, baseY: yB });
        break;
      }
    }
  }
  // corner billboards: 8 m x 2 m hoardings on two posts, bottom at 2.4 m, on the outside of
  // the braking zones, turned 25 degrees towards the approaching car
  const boardMeshes = [];
  {
    const spots = [['ste-devote', -70, 9], ['massenet', -60, 2], ['casino', -55, 12], ['mirabeau', -60, 5], ['portier', -45, 14], ['chicane', -90, 3], ['tabac', -70, 10], ['rascasse', -55, 6], ['noghes', -40, 1]];
    for (const [id, off, sp] of spots) {
      const c = T.corners.find(cc => cc.id === id);
      const side = c.side === 'R' ? 1 : -1;                       // outside of the corner
      for (const ds of [0, -8, 8, -16, 16]) {
        const sb = T.wrapS(c.s + off + ds), k = T.idxOfS(sb);
        if (T.inTunnel(sb) || standSide(sb, side)) continue;
        const walk = side > 0 ? C.walkL[k] : C.walkR[k];
        if (walk < 3.2) continue;
        const bar = side > 0 ? T.sample(T.barL, sb) : T.sample(T.barR, sb);
        const d = side * (bar + Math.min(walk - 0.6, 3.2));
        const p = T.pointAt(sb, d);
        // the panel faces the road, turned 25 degrees towards the approaching car (its near end
        // stays ~0.8 m behind the barrier line)
        const nrm = new THREE.Vector3(-side * T.nx[k], 0, -side * T.nz[k]).multiplyScalar(Math.cos(0.44)).add(new THREE.Vector3(-T.tx[k], 0, -T.tz[k]).multiplyScalar(Math.sin(0.44)));
        const yaw = Math.atan2(nrm.x, nrm.z);
        const ex = Math.cos(yaw) * 4.15, ez = -Math.sin(yaw) * 4.15;
        if (isWater(p.x, p.z) || clearBarAt(C, p.x, p.z) < 0.6 || !free(p.x, p.z, yaw, 0.6, 8.6, 0.2)) continue;
        if (clearBarAt(C, p.x + ex, p.z + ez) < 0.5 || clearBarAt(C, p.x - ex, p.z - ez) < 0.5) continue;
        const y0 = T.heightAt(sb, d) + 0.12;
        const g = new THREE.Group();
        const panel = new THREE.Mesh(sponsorGeo(8, 2, sp), sponsorMat); panel.position.set(0, 3.4, 0.08); g.add(panel);
        const back = new THREE.Mesh(new THREE.BoxGeometry(8.2, 2.2, 0.12), brDark); back.position.set(0, 3.4, 0); g.add(back);
        for (const px of [-2.8, 2.8]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.4, 0.16), brDark); post.position.set(px, 1.2, -0.05); g.add(post); }
        g.position.set(p.x, y0, p.z); g.rotation.y = yaw;
        boardMeshes.push(g);
        addOcc(p.x, p.z, yaw, 0.6, 8.4, 'billboard');
        break;
      }
    }
  }

  // palms, trees, shrubs, streetlights and flags (js/streetlife.js): placed off the circuit's
  // corridor and clear of every building, landmark and grandstand footprint
  const life = buildStreetLife({
    T, C, R, lo, hi, isWater, clearBarAt, free: (x, z, a, w, d, gap) => free(x, z, a, w, d, gap), groundAt, terrainH, standSide, cS, greenAt,
    X0: TG.X0, X1: TG.X1, Z0: TG.Z0, Z1: TG.Z1, trackDist: (x, z) => nearestTrack(x, z)[0],
  });
  root.add(life.group);

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
  // Rainier III swimming pool between the two pool chicanes (right side): the deck, a 50 m pool
  // with lane lines and a tiled edge, and the diving tower at its far end
  if (RES.pool) {
    const r = RES.pool;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(32, 0.4, 70), new THREE.MeshLambertMaterial({ color: 0xe9e6df }));
    deck.position.set(r.x, r.y - 0.1, r.z); deck.rotation.y = r.rot; bake(deck);
    const lc = document.createElement('canvas'); lc.width = 256; lc.height = 512;
    { const x = lc.getContext('2d'); const g = x.createLinearGradient(0, 0, 256, 0); g.addColorStop(0, '#1d8fcf'); g.addColorStop(0.5, '#27a3dc'); g.addColorStop(1, '#1d8fcf'); x.fillStyle = g; x.fillRect(0, 0, 256, 512);
      x.fillStyle = '#123f86'; for (let i = 1; i < 8; i++) { x.fillRect(i * 32 - 3, 24, 6, 464); x.fillRect(i * 32 - 9, 24, 18, 6); x.fillRect(i * 32 - 9, 482, 18, 6); }
      x.fillStyle = 'rgba(255,255,255,0.10)'; for (let k = 0; k < 60; k++) x.fillRect(Math.random() * 256, Math.random() * 512, 30, 2); }
    const lt = new THREE.CanvasTexture(lc); lt.colorSpace = THREE.SRGBColorSpace;
    const pool = new THREE.Mesh(new THREE.BoxGeometry(22, 0.42, 50), new THREE.MeshLambertMaterial({ color: 0x1b6fa0 }));
    pool.position.set(r.x, r.y - 0.05, r.z); pool.rotation.y = r.rot; bake(pool);
    const surf = new THREE.Mesh(new THREE.PlaneGeometry(22, 50), new THREE.MeshStandardMaterial({ map: lt, roughness: 0.08, envMapIntensity: 0.9 }));
    surf.rotation.set(-Math.PI / 2, 0, r.rot, 'YXZ'); surf.position.set(r.x, r.y + 0.17, r.z); bake(surf);
    const edgeMat = new THREE.MeshLambertMaterial({ color: 0xf4f2ec });
    for (const [w, d, ox, oz] of [[23, 0.6, 0, 25.3], [23, 0.6, 0, -25.3], [0.6, 50, 11.3, 0], [0.6, 50, -11.3, 0]]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), edgeMat);
      e.position.set(r.x + ox * Math.cos(r.rot) + oz * Math.sin(r.rot), r.y + 0.18, r.z - ox * Math.sin(r.rot) + oz * Math.cos(r.rot)); e.rotation.y = r.rot; bake(e);
    }
    // diving tower: concrete column and platforms at 3, 5, 7.5 and 10 m, at the far end
    const tg = new THREE.Group(), conc = new THREE.MeshLambertMaterial({ color: 0xdedbd3 });
    const col = new THREE.Mesh(new THREE.BoxGeometry(1.6, 10.6, 1.6), conc); col.position.set(0, 5.3, 0); tg.add(col);
    for (const [h, len] of [[3, 3.2], [5, 3.6], [7.5, 4.0], [10, 4.4]]) { const pl = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.22, len), conc); pl.position.set(0, h, len / 2 - 0.3); tg.add(pl); }
    const [tx, tz] = localXZ(r, 0, -28.2);
    tg.position.set(tx, r.y, tz); tg.rotation.y = r.rot; bake(tg);
  }
  const gardenInfo = {};
  // Casino Square gardens on the inside of the Casino bend: lawns between flower beds and palms,
  // a round fountain - kept off the pavements and clear of the buildings
  {
    const grass = new THREE.MeshLambertMaterial({ color: 0x4f7d34 });
    const bed = new THREE.MeshLambertMaterial({ color: 0xb83a4b });
    const stoneM = new THREE.MeshLambertMaterial({ color: 0xe7e0d0 });
    const waterM = new THREE.MeshStandardMaterial({ color: 0x2a6f8a, roughness: 0.05, envMapIntensity: 1.0 });
    const cs0 = cS('casino');
    let nLawn = 0;
    // lawns (6.4 m, else 4.4 m) in the free ground beyond the pavements round the square, on both
    // sides of the road; each one reserves its footprint
    for (let q = -110; q < 24; q += 7) {
      const sq = T.wrapS(cs0 + q), k = T.idxOfS(sq);
      for (const side of [-1, 1]) {
        const bar = side > 0 ? T.sample(T.barL, sq) : T.sample(T.barR, sq), walk = side > 0 ? C.walkL[k] : C.walkR[k];
        for (const dd of [4.5, 11.5]) {
          const ang = Math.atan2(T.tx[k], T.tz[k]);
          for (const sz of [6.4, 4.4]) {
            const d = side * (bar + walk + dd - (6.4 - sz) / 2), p = T.pointAt(sq, d);
            if (isWater(p.x, p.z) || footprintClear(C, p.x, p.z, ang, sz + 0.2, sz + 0.2, 'walk') < 0.4 || !free(p.x, p.z, ang, sz, sz, 0.1)) continue;
            if (!life.unclaimed(p.x, p.z, sz * 0.72)) continue;        // no bench, lamp or stair in it
            // a raised bed on the ground: stone kerb walls from the lowest ground under it, the lawn
            // level with its highest point (not on slopes steeper than ~1 m across)
            const g0 = groundMin(p.x, p.z, ang, sz + 0.3, sz + 0.3), g1 = Math.max(groundAt(p.x, p.z), ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => groundAt(p.x + u * sz * 0.55, p.z + v * sz * 0.55)));
            if (g1 - g0 > 1.0) continue;
            const top = g1 + 0.18;
            const kerb = new THREE.Mesh(new THREE.BoxGeometry(sz + 0.3, top - g0 + 0.25, sz + 0.3), stoneM); kerb.position.set(p.x, (top + g0 - 0.25) / 2 - 0.01, p.z); kerb.rotation.y = ang; bake(kerb);
            const lawn = new THREE.Mesh(new THREE.BoxGeometry(sz, 0.1, sz), grass); lawn.position.set(p.x, top - 0.04, p.z); lawn.rotation.y = ang; bake(lawn);
            if ((nLawn + (dd > 5 ? 1 : 0)) % 2 === 0) { const fb = new THREE.Mesh(new THREE.CylinderGeometry(sz * 0.23, sz * 0.23, 0.3, 14), bed); fb.position.set(p.x, top + 0.05, p.z); bake(fb); }
            addOcc(p.x, p.z, ang, sz + 0.3, sz + 0.3, 'garden');
            nLawn++;
            break;
          }
        }
      }
    }
    // the fountain: the first free spot beyond the pavement round the square
    let fountain = false;
    for (const [q, side, dd] of [[-30, -1, 9], [-50, -1, 9], [-10, -1, 9], [-30, 1, 9], [-50, 1, 9], [-70, -1, 9], [-70, 1, 9], [-90, -1, 9], [-90, 1, 9]]) {
      const sq = T.wrapS(cs0 + q), k = T.idxOfS(sq);
      const d = side * ((side > 0 ? T.sample(T.barL, sq) : T.sample(T.barR, sq)) + (side > 0 ? C.walkL[k] : C.walkR[k]) + dd), p = T.pointAt(sq, d);
      if (isWater(p.x, p.z) || footprintClear(C, p.x, p.z, 0, 8, 8, 'walk') < 0.4 || !free(p.x, p.z, 0, 7.4, 7.4, 0.1)) continue;
      if (!life.unclaimed(p.x, p.z, 3.8)) continue;
      const g0 = groundMin(p.x, p.z, 0, 7.2, 7.2), g1 = Math.max(groundAt(p.x, p.z), ...[[-1, 0], [1, 0], [0, 1], [0, -1]].map(([u, v]) => groundAt(p.x + u * 3.6, p.z + v * 3.6)));
      if (g1 - g0 > 1.0) continue;
      fountain = true;
      const y = g1;                                              // basin rim 0.7 m above the highest ground
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, y + 0.7 - g0 + 0.2, 24), stoneM); basin.position.set(p.x, (y + 0.7 + g0 - 0.2) / 2, p.z); bake(basin);
      const wtr = new THREE.Mesh(new THREE.CylinderGeometry(3.05, 3.05, 0.1, 24), waterM); wtr.position.set(p.x, y + 0.66, p.z); bake(wtr);
      const tier = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 2.2, 12), stoneM); tier.position.set(p.x, y + 1.6, p.z); bake(tier);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.4, 0.4, 16), stoneM); bowl.position.set(p.x, y + 2.7, p.z); bake(bowl);
      addOcc(p.x, p.z, 0, 7.4, 7.4, 'garden');
      break;
    }
    gardenInfo.lawns = nLawn; gardenInfo.fountain = fountain;
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
  const roofMat = new THREE.MeshLambertMaterial({ color: 0xeef0f2 });
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
    // side walls following the terrace profile (closing the stepped structure: the profile is
    // drawn in the y/z plane, front at +z, and extruded across x), a sponsor fascia and plinth
    // along the front, the front railing, and the white canopy - cantilevered over the seats on
    // columns behind the back wall, with a fascia beam along its leading edge
    for (const sx of [-w / 2 - 0.1, w / 2 + 0.1]) {
      const sh = new THREE.Shape();
      sh.moveTo(run / 2, 0); sh.lineTo(run / 2, 2.05); sh.lineTo(-(rows - 1) * run - run / 2, 1.5 + (rows - 1) * rise + rise / 2 + 0.05); sh.lineTo(-rows * run - 0.4, rows * rise + 4); sh.lineTo(-rows * run - 0.4, 0); sh.closePath();
      const sg = new THREE.ExtrudeGeometry(sh, { depth: 0.2, bevelEnabled: false }); sg.rotateY(-Math.PI / 2); sg.translate(sx + 0.1, 0, 0);
      g.add(new THREE.Mesh(sg, standFrame));
    }
    const nF = Math.max(1, Math.round(w / 4));
    for (let i = 0; i < nF; i++) { const f = new THREE.Mesh(sponsorGeo(w / nF, 0.95, 3 + ((i + k) % 5) * 2), sponsorMat); f.position.set(-w / 2 + w / nF * (i + 0.5), 0.52, run / 2 + 0.01); g.add(f); }
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(w, 1.05, 0.1), standFrame); plinth.position.set(0, 0.52, run / 2 - 0.05); g.add(plinth);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.06), railMat); rail.position.set(0, 1.5 + rise / 2 + 1.0, run / 2 - 0.05); g.add(rail);
    for (let x = -w / 2 + 0.5; x <= w / 2; x += 2.3) { const pst = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.0, 0.05), railMat); pst.position.set(x, 1.5 + rise / 2 + 0.5, run / 2 - 0.05); g.add(pst); }
    // canopy: 13.2 m deep, rising 6.9 degrees towards the back (front edge ~12.2 m, back ~13.8 m)
    const cd = rows * run + 2, ct = 0.12;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.16, cd), roofMat); roof.rotation.x = ct; roof.position.set(0, rows * rise + 5, -rows * run / 2); g.add(roof);
    const zf = -rows * run / 2 + cd / 2 * Math.cos(ct), yf = rows * rise + 5 - cd / 2 * Math.sin(ct);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.5, 0.14), standFrame); beam.position.set(0, yf - 0.2, zf); g.add(beam);
    const zb = -rows * run - 0.55, yb = rows * rise + 5 + (-rows * run / 2 - zb) * Math.tan(ct);
    for (const cx of [-w / 2 + 0.4, -w / 6, w / 6, w / 2 - 0.4]) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.24, yb, 0.24), railMat); c.position.set(cx, yb / 2, zb); g.add(c); }
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

  for (const g of bridgeMeshes.concat(boardMeshes)) bake(g);
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

  // merge baked props - plain painted materials of nearly the same colour (within ~6 % per
  // channel: the bridge steel and the grandstand frames, the canopy and the hull white...) are
  // drawn as one, so each extra prop type costs no extra draw call
  {
    const reps = [];
    const plain = (m) => m.isMeshLambertMaterial && !m.map && !m.vertexColors && !m.transparent && m.side === THREE.FrontSide;
    for (const [mat, list] of [...baked]) {
      if (!plain(mat)) continue;
      const r = reps.find((q) => Math.abs(q.color.r - mat.color.r) < 0.063 && Math.abs(q.color.g - mat.color.g) < 0.063 && Math.abs(q.color.b - mat.color.b) < 0.063);
      if (!r) { reps.push(mat); continue; }
      baked.get(r).push(...list); baked.delete(mat);
    }
  }
  for (const [mat, list] of baked) {
    const g = mergeGeometries(list, false);
    if (!g) continue;
    if (staticShadow && mat.isMeshLambertMaterial) receiveSunShadow(mat);
    const m = new THREE.Mesh(g, mat);
    m.matrixAutoUpdate = false; m.name = 'props';
    lm.add(m);
  }

  // ---- mountains and headlands ---------------------------------------------------------------
  // Two ridges behind Monaco, unlit but pre-shaded from the sun and pre-hazed (aerial
  // perspective), one draw call: the limestone wall of the Tete de Chien and Mont Agel ~2.5 km
  // inland - grey cliffs and screes over green maquis and pines, villages and villas on the
  // lower slopes - running down at both ends into the sea as wooded headlands (Cap d'Ail to the
  // west, Cap Martin to the east); and the higher Alpine ridge ~5 km behind it, pale blue.
  {
    const h1 = (i) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
    const n1 = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return h1(i) * (1 - u) + h1(i + 1) * u; };
    // ridged noise: sharp crests and notches like eroded limestone
    const ridged = (x, oct) => { let a = 0, amp = 0.5, fr = 1; for (let o = 0; o < oct; o++) { const v = 1 - Math.abs(n1(x * fr + o * 17.3) * 2 - 1); a += amp * v * v; amp *= 0.5; fr *= 2.07; } return a; };
    const n2 = (x, y) => { const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v), hh = (a, b) => h1(a * 57.3 + b * 131.9);
      return (hh(i, j) * (1 - su) + hh(i + 1, j) * su) * (1 - sv) + (hh(i, j + 1) * (1 - su) + hh(i + 1, j + 1) * su) * sv; };
    const srgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
    const HAZE = new THREE.Color(0xd7e2e8), FARHAZE = new THREE.Color(0xc9d8e6);
    const ROCK = srgb(0.60, 0.58, 0.53), SCREE = srgb(0.55, 0.53, 0.49), MAQUIS = srgb(0.27, 0.34, 0.22), PINE = srgb(0.19, 0.27, 0.18);
    const GARRIGUE = srgb(0.44, 0.45, 0.34), TOWN = srgb(0.80, 0.75, 0.66), ROOF = srgb(0.66, 0.44, 0.34);
    const sd = sunDir.clone().normalize();
    const pos = [], col = [], uv = [], idx = [];
    const layer = ({ a0, a1, da, rows, rAt, hAt, depth, haze, hazeCol, near }) => {
      const cols = Math.round((a1 - a0) / da) + 1, base = pos.length / 3, P = [];
      for (let c = 0; c < cols; c++) {
        const a = a0 + c * da, ang = a - Math.PI / 2, H = hAt(a), R0 = rAt(a);
        for (let v = 0; v <= rows; v++) {
          const f = v / rows;
          // a steep foot that rounds over towards the crest, gullies cut into the face
          const y = -25 + (H + 25) * (1 - Math.pow(1 - f, 1.45));
          const gully = (n1(a * 140 + 3.1) - 0.5) * depth * 0.22 * Math.sin(Math.PI * f);
          const r = R0 + depth * f + gully;
          P.push([Math.cos(ang) * r, y, Math.sin(ang) * r, a, f]);
          pos.push(Math.cos(ang) * r, y, Math.sin(ang) * r);
          uv.push(a * R0 / 600, f);
        }
      }
      for (let c = 0; c < cols - 1; c++) for (let v = 0; v < rows; v++) {
        const i0 = base + c * (rows + 1) + v, i1 = i0 + rows + 1;
        idx.push(i0, i0 + 1, i1, i1, i0 + 1, i1 + 1);
      }
      return { P, cols, rows, haze, hazeCol, near, base };
    };
    const L1 = layer({
      a0: -2.2, a1: 1.52, da: 0.008, rows: 9, depth: 850, haze: 0.30, hazeCol: HAZE, near: true,
      rAt: (a) => 2550 + Math.sin(a * 3.1) * 380 + Math.sin(a * 7.3 + 1.1) * 90,
      hAt: (a) => {
        let h = 380 + 430 * ridged(a * 2.4 + 4.0, 5) + 170 * Math.max(0, Math.sin(a * 1.7 + 0.8));
        // the ends drop to the sea as headlands, 30-80 m high
        const t = Math.min(1, Math.max(0, (a + 2.2) / 0.42)) * Math.min(1, Math.max(0, (1.52 - a) / 0.38));
        const e = t * t * (3 - 2 * t);
        return 30 + 40 * n1(a * 30) + (h - 30) * e;
      },
    });
    const L2 = layer({
      a0: -1.55, a1: 1.05, da: 0.012, rows: 5, depth: 700, haze: 0.58, hazeCol: FARHAZE, near: false,
      rAt: (a) => 4500 + Math.sin(a * 2.3 + 0.4) * 300,          // (crest inside the 6 km far plane)
      hAt: (a) => 800 + 750 * ridged(a * 1.9 + 9.0, 5),
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const nrm = g.attributes.normal, c3 = new THREE.Color(), nv = new THREE.Vector3();
    for (const Ly of [L1, L2]) {
      for (let i = 0; i < Ly.P.length; i++) {
        const [x, y, z, a, f] = Ly.P[i], vi = Ly.base + i;
        nv.fromBufferAttribute(nrm, vi);
        if (nv.dot(new THREE.Vector3(-x, 0, -z)) < 0) nv.negate();            // face the city
        const steep = 1 - Math.abs(nv.y), nA = n2(a * 60, f * 3.2), nB = n2(a * 260 + 7, f * 9);
        // ground cover: pines and maquis low down, garrigue higher, bare limestone where steep
        c3.copy(MAQUIS).lerp(PINE, nB * 0.6);
        c3.lerp(GARRIGUE, Math.min(1, Math.max(0, (f - 0.45) * 1.6 + (nA - 0.5) * 0.8)));
        c3.lerp(ROCK, Math.min(1, Math.max(0, (steep - 0.42) * 3.0 + (nA - 0.5) * 1.2 + (f - 0.6) * 0.6)));
        if (f > 0.55 && nB > 0.62) c3.lerp(SCREE, 0.5);
        // villages and villas on the lower slopes (La Turbie, Beausoleil above the city)
        if (Ly.near && f < 0.42 && a > -1.7 && a < 1.15) { const t = n2(a * 420 + 3, f * 14); if (t > 0.58) c3.lerp(t > 0.8 ? ROOF : TOWN, Math.min(0.85, (t - 0.58) * 3.5) * (1 - f / 0.42)); }
        // sun and sky light (the sun is in the south-west, behind the viewer for most of the lap)
        const lit = 0.46 + 0.52 * Math.max(0, nv.dot(sd)) + 0.06 * nv.y;
        c3.multiplyScalar(lit);
        // aerial perspective: denser haze low down
        c3.lerp(Ly.hazeCol, Math.min(0.92, Ly.haze + 0.12 * (1 - f)));
        col.push(c3.r, c3.g, c3.b);
      }
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    // fine detail (crags, tree clumps, terraces), multiplied in, a few metres per texel
    const dc = document.createElement('canvas'); dc.width = 512; dc.height = 256;
    const dx = dc.getContext('2d');
    dx.fillStyle = '#f0f0f0'; dx.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 2600; i++) {
      const px = R() * 512, py = R() * 256, w = 1 + R() * 4, h = 1 + R() * 2.5, v = 170 + R() * 85;
      dx.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`; dx.fillRect(px, py, w, h);
    }
    for (let i = 0; i < 140; i++) {                                   // strata and gullies
      const px = R() * 512, py = R() * 120, l = 6 + R() * 30;
      dx.strokeStyle = `rgba(90,90,90,${0.25 + R() * 0.3})`; dx.lineWidth = 1; dx.beginPath(); dx.moveTo(px, py); dx.lineTo(px + (R() - 0.5) * 6, py + l); dx.stroke();
    }
    const dt = new THREE.CanvasTexture(dc); dt.colorSpace = THREE.SRGBColorSpace; dt.wrapS = THREE.RepeatWrapping; dt.anisotropy = 4;
    const mtn = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, map: dt, color: new THREE.Color(1.08, 1.08, 1.08), side: THREE.DoubleSide, fog: false }));
    mtn.name = 'mountains';
    mtn.layers.set(DETAIL_LAYER);                                   // main view only (not the mirrors)
    root.add(mtn);
  }

  // casters of the static sun shadow: buildings (and their detail), the Fairmont, the landmarks
  // and other static props, the terrain, the trees and palm trunks (not the cut-out palm fronds)
  const CASTERS = new Set(['buildings', 'buildingsDetail', 'fairmont', 'props', 'terrain', 'pine', 'cypress', 'broadleaf', 'treeTrunk', 'palmTrunk', 'palmKnob']);
  root.traverse((o) => { if (o.isMesh && CASTERS.has(o.name)) o.layers.enable(SUN_SHADOW_LAYER); });
  // bake it once the whole static scene is in place (main.js), round the circuit and the hills
  const bakeShadow = (renderer, scene) => {
    if (!staticShadow) return null;
    const box = new THREE.Box3();
    for (let k = 0; k < T.N; k += 4) box.expandByPoint(new THREE.Vector3(T.px[k], T.py[k], T.pz[k]));
    box.min.x -= 170; box.min.z -= 170; box.max.x += 170; box.max.z += 170; box.min.y = -8; box.max.y += 110;
    return bakeSunShadow(renderer, scene, sunDir, box, hi ? 3072 : 2048);
  };

  return {
    bakeShadow,
    root, sky, water, sunDir, nBuildings, terrainH, groundAt, groundMax: Math.max(...TG.h), waterNormal, rej, corridor: C, terrainLimit: TL, terrainStep: TERRAIN_STEP,
    footprints: occupied, buildings: BLD.concat(BLD_LANDMARK), streetLife: life, shadeExtra: SHADE_EXTRA, gardens: gardenInfo,
  };
}

// Monaco scenery: sky, sea and Port Hercule, terrain, Riviera buildings along the circuit,
// landmarks (Casino, Hôtel de Paris, Fairmont over the tunnel, the Rock and the Palace,
// the swimming pool), pit garages, grandstands, yachts, palms and the mountain backdrop.
import * as THREE from 'three';
import * as TX from './textures.js';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const R = rng(20240526);

// Coast: land lies to the LEFT of this polyline walking along it (north-west side).
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
    if (d < best) { best = d; const cr = ex * (z - az) - ez * (x - ax); sign = cr < 0 ? 1 : -1; }
  }
  return sign * best;
}
export function isWater(x, z) {
  if (pointInPoly(x, z, HARBOUR)) return true;
  return coastSide(x, z) < 0;
}

// ---------------------------------------------------------------------------------------------
export function buildScenery(T, { quality = 'high', renderer = null } = {}) {
  const root = new THREE.Group(); root.name = 'scenery';
  const hi = quality === 'high', lo = quality === 'low';

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
  const terrainH = (x, z) => {
    const cs = coastSide(x, z);
    if (pointInPoly(x, z, HARBOUR)) return -6;
    if (cs < 0) return -6 - Math.min(30, -cs * 0.2);
    const [dt, ty] = nearestTrack(x, z);
    // inland slope: higher towards the north-west (away from the sea)
    const inland = Math.max(0, cs - 40);
    const hill = ty + Math.max(0, dt - 25) * 0.16 + inland * 0.06;
    let h = dt < 25 ? ty - 0.4 : hill;
    h = Math.max(h, rockH(x, z));
    // coastal promenade a little above sea level
    if (cs < 25) h = Math.min(h, 1.2 + cs * 0.12);
    return h;
  };
  {
    const X0 = -900, X1 = 1300, Z0 = -1300, Z1 = 1100, step = lo ? 30 : 20;
    const nx = Math.round((X1 - X0) / step), nz = Math.round((Z1 - Z0) / step);
    const g = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0, nx, nz);
    g.rotateX(-Math.PI / 2);
    g.translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const h = terrainH(x, z);
      p.setY(i, h);
      // urban beige/grey with garden greens inland; rock grey on the Rock's cliffs
      const n = R();
      let c;
      if (h < -0.5) c = [0.35, 0.38, 0.36];
      else if (rockH(x, z) > 20 && Math.abs(h - rockH(x, z)) < 1) c = [0.62, 0.6, 0.52];
      else c = n < 0.3 ? [0.33, 0.42, 0.29] : [0.5, 0.48, 0.45];
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const terrain = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    terrain.name = 'terrain'; terrain.receiveShadow = false;
    // push the terrain slightly below the road to avoid z-fighting with the track ribbon
    terrain.position.y = -0.25;
    root.add(terrain);
  }

  // ---- buildings ----------------------------------------------------------------------------
  const facades = [TX.facade(0), TX.facade(1), TX.facade(2)];
  const bMats = facades.map(t => new THREE.MeshLambertMaterial({ map: t, vertexColors: true }));
  const bBuilders = [[], [], []];
  const PALETTE = ['#efe3c8', '#f2d7b6', '#e9c9a8', '#f4e9d8', '#e7d3b0', '#f0c9b0', '#ffffff', '#e8dcc8', '#d9c7a6', '#f3e0c0', '#e6b8a2', '#f6eed9'];
  const occupied = [];
  const free = (x, z, r) => occupied.every(([ox, oz, or]) => Math.hypot(ox - x, oz - z) > r + or);
  const tmpProj = {};
  const clearOfTrack = (pts, sHome) => {
    for (const [x, z] of pts) {
      if (isWater(x, z)) return false;
      const pr = T.project(x, z, null, tmpProj);
      if (!pr.ok) continue;
      const bar = pr.d > 0 ? T.sample(T.barL, pr.s) : T.sample(T.barR, pr.s);
      const pit = (pr.s > T.L - 150 || pr.s < 300) && pr.d < 0;
      if (Math.abs(pr.d) < bar + (pit ? 13.5 : 4.2)) return false;
    }
    return true;
  };
  // emits a box building into the builder list
  function building(cx, cz, ang, w, dpt, h, baseY, variant, color) {
    bBuilders[variant].push({ cx, cz, ang, w, dpt, h, baseY, color });
    occupied.push([cx, cz, Math.hypot(w, dpt) / 2]);
  }
  const sideBuildings = (side, sFrom, sTo, opts = {}) => {
    let s = sFrom;
    while (s < sTo) {
      const w = opts.w ? opts.w() : 12 + R() * 18;
      const sc = T.wrapS(s + w / 2);
      const k = T.idxOfS(sc);
      const bar = side > 0 ? T.sample(T.barL, sc) : T.sample(T.barR, sc);
      const pit = (sc > T.L - 150 || sc < 300) && side < 0;
      const setback = bar + (pit ? 14 : 4.6) + (opts.extraSet || 0);
      const dpt = 14 + R() * 12;
      const dC = side * (setback + dpt / 2);
      const c = T.pointAt(sc, dC);
      const tx = T.tx[k], tz = T.tz[k];
      const ang = Math.atan2(tx, tz);
      // footprint corners
      const nx = T.nx[k], nz = T.nz[k];
      const pts = [];
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) pts.push([c.x + tx * a * w / 2 + nx * b * dpt / 2, c.z + tz * a * w / 2 + nz * b * dpt / 2]);
      if (clearOfTrack(pts) && free(c.x, c.z, Math.hypot(w, dpt) / 2 * 0.8)) {
        const h = opts.h ? opts.h() : 14 + R() * 22 + (R() < 0.12 ? 25 : 0);
        const y = T.py[k] - 1.5;
        building(c.x, c.z, ang, w, dpt, h, y, Math.floor(R() * 3), PALETTE[Math.floor(R() * PALETTE.length)]);
        // second row behind (taller, up the hill)
        if (!opts.single && R() < 0.85) {
          const c2 = T.pointAt(sc, dC + side * (dpt / 2 + 10 + R() * 8));
          const w2 = w * (0.8 + R() * 0.4), d2 = 16 + R() * 10;
          if (!isWater(c2.x, c2.z) && free(c2.x, c2.z, Math.hypot(w2, d2) / 2 * 0.8)) {
            const y2 = terrainH(c2.x, c2.z) - 2;
            building(c2.x, c2.z, ang, w2, d2, 18 + R() * 30, y2, Math.floor(R() * 3), PALETTE[Math.floor(R() * PALETTE.length)]);
          }
        }
      }
      s += w + 1.5 + R() * 4;
    }
  };
  const L = T.L;
  sideBuildings(1, 0, L);
  sideBuildings(-1, 0, L);
  // inland city blocks and towers further from the circuit (skyline backdrop)
  for (let i = 0; i < (lo ? 60 : 140); i++) {
    const x = -700 + R() * 1700, z = -1100 + R() * 1500;
    if (isWater(x, z) || coastSide(x, z) < 40) continue;
    const [dt] = nearestTrack(x, z);
    if (dt < 45) continue;
    if (!free(x, z, 14)) continue;
    const tall = R() < 0.25;
    building(x, z, R() * Math.PI, 16 + R() * 16, 16 + R() * 14, tall ? 45 + R() * 60 : 15 + R() * 25, terrainH(x, z) - 3, Math.floor(R() * 3), PALETTE[Math.floor(R() * PALETTE.length)]);
  }
  // the Rock: low old-town blocks
  for (let i = 0; i < (lo ? 20 : 45); i++) {
    const x = -330 + R() * 360, z = 660 + R() * 180;
    if (rockH(x, z) < 50 || !free(x, z, 9)) continue;
    building(x, z, 0.35 + (R() - 0.5) * 0.3, 10 + R() * 12, 10 + R() * 10, 10 + R() * 9, 54, 0, PALETTE[Math.floor(R() * 5)]);
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
    bake(placeAt(corner('casino') - 12, -40, g, -1));
    // Hôtel de Paris
    const hp = new THREE.Mesh(new THREE.BoxGeometry(60, 22, 26), stone); hp.position.y = 11;
    const hg = new THREE.Group(); hg.add(hp);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(60, 3, 24), copper); roof.position.y = 23.5; hg.add(roof);
    bake(placeAt(corner('casino') - 60, 32, hg, -1));
    occupied.push([hg.position.x, hg.position.z, 30]);
  }
  // Fairmont hotel over the tunnel: wide curved block
  {
    const [t0] = T.tunnelS;
    const mat = new THREE.MeshLambertMaterial({ color: 0xd9d3c4 });
    for (let q = 10; q < 220; q += 32) {
      const s = T.wrapS(t0 + q);
      const block = new THREE.Mesh(new THREE.BoxGeometry(34, 22, 48), mat);
      bake(placeAt(s, 4, block, 6.0 + 11));
      const win = new THREE.Mesh(new THREE.BoxGeometry(34.2, 16, 48.2), glass);
      win.position.copy(block.position); win.position.y -= 1; win.rotation.copy(block.rotation); win.scale.set(1, 0.6, 0.98);
      bake(win);
    }
  }
  // the Prince's Palace and the Oceanographic Museum on the Rock
  {
    const pal = new THREE.Mesh(new THREE.BoxGeometry(70, 14, 30), new THREE.MeshLambertMaterial({ color: 0xead2b8 }));
    pal.position.set(-210, 56 + 7, 740); pal.rotation.y = 0.3; bake(pal);
    for (let i = 0; i < 6; i++) { const t = new THREE.Mesh(new THREE.BoxGeometry(5, 18, 5), pal.material); t.position.set(-245 + i * 13, 56 + 9, 728 + i * 4); bake(t); }
    const mus = new THREE.Mesh(new THREE.BoxGeometry(50, 30, 22), stone); mus.position.set(-20, 30, 830); mus.rotation.y = 0.5; bake(mus);
  }
  // Rainier III swimming pool between the two pool chicanes (right side)
  {
    const s = (corner('pool1') + corner('pool2')) / 2;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(32, 0.4, 70), new THREE.MeshLambertMaterial({ color: 0xe9e6df }));
    bake(placeAt(s, -T.sample(T.barR, s) - 22, deck, -0.1));
    const pool = new THREE.Mesh(new THREE.BoxGeometry(22, 0.42, 50), new THREE.MeshStandardMaterial({ color: 0x1b9ad6, roughness: 0.1 }));
    bake(placeAt(s, -T.sample(T.barR, s) - 22, pool, -0.05));
    occupied.push([pool.position.x, pool.position.z, 30]);
  }
  // pit garages (temporary two-storey buildings) along the start straight
  {
    const teamCols = [0x16213f, 0xc8102e, 0x00a19c, 0xff8000, 0x006f62, 0x2293d1, 0x6692ff, 0xb6babd, 0x1e41ff, 0x52e252];
    const gm = teamCols.map(c => new THREE.MeshLambertMaterial({ color: c }));
    const frame = new THREE.MeshLambertMaterial({ color: 0xdedede });
    let i = 0;
    for (let q = -130; q < 250; q += 17) {
      const s = T.wrapS(q);
      const d = -T.sample(T.barR, s) - 12.6;
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(16, 8, 6), frame); box.position.y = 4; g.add(box);
      const front = new THREE.Mesh(new THREE.BoxGeometry(14, 3.2, 0.3), gm[i % gm.length]); front.position.set(0, 1.8, 3.1); g.add(front);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(15, 1.4, 0.3), gm[i % gm.length]); upper.position.set(0, 6.4, 3.1); g.add(upper);
      const gObj = placeAt(s, d, g, 0.1);
      // garages face the pit lane (towards the track)
      gObj.rotation.y += Math.PI / 2;
      bake(gObj);
      i++;
    }
  }

  // ---- grandstands -------------------------------------------------------------------------
  const crowdTex = TX.crowd(hi ? 1 : 0.6);
  crowdTex.repeat.set(1, 1);
  const standMat = new THREE.MeshLambertMaterial({ map: crowdTex });
  const standFrame = new THREE.MeshLambertMaterial({ color: 0xbfc4c9 });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2, side: THREE.DoubleSide });
  const grandstand = (s0, s1, side, setback) => {
    const len = T.deltaS(s0, s1);
    for (let q = 0; q < len; q += 24) {
      const s = T.wrapS(s0 + q + 12);
      const bar = side > 0 ? T.sample(T.barL, s) : T.sample(T.barR, s);
      const g = new THREE.Group();
      const rows = 8, rise = 1.0, run = 1.4, w = 23;
      for (let r = 0; r < rows; r++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(w, rise, run), r % 2 ? standMat : standMat);
        step.position.set(0, 1.5 + r * rise, -(r * run));
        g.add(step);
      }
      const back = new THREE.Mesh(new THREE.BoxGeometry(w, rows * rise + 4, 0.4), standFrame); back.position.set(0, (rows * rise + 4) / 2, -rows * run - 0.2); g.add(back);
      const roof = new THREE.Mesh(new THREE.PlaneGeometry(w, rows * run + 2), roofMat); roof.rotation.x = -Math.PI / 2 + 0.12; roof.position.set(0, rows * rise + 5, -rows * run / 2); g.add(roof);
      const p = T.pointAt(s, side * (bar + setback)), k = T.idxOfS(s);
      g.position.set(p.x, T.py[k] - 0.5, p.z);
      // face the track: local -z points away from the track
      g.rotation.y = Math.atan2(T.tx[k], T.tz[k]) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
      bake(g);
      occupied.push([p.x, p.z, 14]);
    }
  };
  const cs = (id) => corner(id);
  grandstand(cs('ste-devote') - 60, cs('ste-devote') + 10, 1, 3);
  grandstand(T.L - 140, T.L - 20, 1, 2.5);
  grandstand(cs('tabac') - 30, cs('tabac') + 50, 1, 6);
  grandstand(cs('pool1') - 50, cs('pool2') + 40, 1, 6);
  grandstand(cs('rascasse') - 20, cs('rascasse') + 30, 1, 4);
  grandstand(cs('casino') - 80, cs('casino') - 30, 1, 4);

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
    const y = yachtGeo(len, wid, 1 + Math.floor(R() * 3));
    const k = T.idxOfS(s);
    y.position.set(p.x, 0, p.z);
    y.rotation.y = Math.atan2(T.nx[k], T.nz[k]) + Math.PI;
    bake(y); placed++;
  }
  // superyachts in the basin
  for (let i = 0; i < 40 && placed < nY; i++) {
    const x = -40 + R() * 320, z = 120 + R() * 400;
    if (!pointInPoly(x, z, HARBOUR)) continue;
    const len = 30 + R() * 50, wid = len * 0.2;
    const y = yachtGeo(len, wid, 2 + Math.floor(R() * 3));
    y.position.set(x, 0, z); y.rotation.y = R() * Math.PI * 2;
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
    const trunk = new THREE.CylinderGeometry(0.18, 0.28, 9, 6); trunk.translate(0, 4.5, 0);
    const frond = new THREE.PlaneGeometry(5, 2.2); frond.translate(2.5, 0, 0);
    const fronds = [];
    for (let i = 0; i < 7; i++) { const f = frond.clone(); f.rotateX(0.5); f.rotateZ(-0.5); f.rotateY(i / 7 * Math.PI * 2); f.translate(0, 9, 0); fronds.push(f); }
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

  return { root, sky, water, sunDir, nBuildings, terrainH, waterNormal };
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

// Circuit geometry: road, kerbs, run-off, pavements, barriers, catch fences, braking
// markers, start/finish, pit lane and the tunnel. Built in chunks along the lap so the
// renderer can frustum-cull them.
import * as THREE from 'three';
import * as TX from './textures.js';

const CHUNK = 150;          // metres of lap per chunk

class Builder {
  constructor() { this.p = []; this.c = []; this.uv = []; }
  tri(a, b, c, ca, cb, cc, ua, ub, uc) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.c.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
    this.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  }
  // quad a-b-c-d: front face is the side where (b - a) x (c - a) points (a,b on row 0; c,d on
  // row 1). For ground: a = left, b = right at s0; c, d at s1 -> faces up.
  quad(a, b, c, d, col, uvs, colB) {
    const cb = colB || col;
    this.tri(a, b, c, col, col, cb, uvs[0], uvs[1], uvs[2]);
    this.tri(b, d, c, col, cb, cb, uvs[1], uvs[3], uvs[2]);
  }
  // quad with one colour per corner (lateral gradients)
  quad4(a, b, c, d, ca, cb, cc, cd, uvs) {
    this.tri(a, b, c, ca, cb, cc, uvs[0], uvs[1], uvs[2]);
    this.tri(b, d, c, cb, cd, cc, uvs[1], uvs[3], uvs[2]);
  }
  get empty() { return this.p.length === 0; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

const C = {
  asphalt: [0.36, 0.36, 0.38], rubber: [0.22, 0.22, 0.24], white: [0.92, 0.92, 0.9],
  red: [0.66, 0.045, 0.04], runoff: [0.40, 0.41, 0.43], walk: [0.70, 0.68, 0.64], walkEdge: [0.78, 0.76, 0.72],
  pit: [0.30, 0.30, 0.32], green: [0.24, 0.42, 0.25], blueLine: [0.2, 0.4, 0.8],
};
const mul = (c, f) => [c[0] * f, c[1] * f, c[2] * f];

// Barrier types along the lap (per side). Default: armco + fence.
function barrierType(T, s, side) {
  const sc = (id) => T.corners.find(c => c.id === id).s;
  const near = (id, a, b) => { const d = T.deltaS(sc(id), s); return d >= a && d <= b; };
  if (T.inTunnel(s)) return 'tunnel';
  if (side > 0 && near('ste-devote', -40, 30)) return 'tecpro';
  if (side > 0 && near('mirabeau', -35, 15)) return 'tecpro';
  if (near('chicane', -30, 40) && side > 0) return 'tecpro';
  if (side > 0 && near('rascasse', -20, 20)) return 'tecpro';
  // ad walls on the start straight and around the harbour
  if (s > T.L - 180 || s < 330) return side > 0 ? 'ads' : 'pitwall';
  if (near('tabac', -60, 40) || near('pool1', -50, 60) || near('casino', -40, 50)) return 'ads';
  return 'armco';
}

export function buildTrackMeshes(T, { racingLine = null, quality = 'high', corridor = null } = {}) {
  const group = new THREE.Group(); group.name = 'track';
  const asph = TX.asphaltSet(quality === 'low' ? 512 : 1024);
  const tex = {
    asphalt: asph.map, asphaltN: asph.normalMap, asphaltR: asph.roughnessMap, macro: TX.macroNoise(256), roadAtlas: TX.roadDetailAtlas(),
    paint: TX.roadPaint(quality === 'low' ? 256 : 512),
    armco: TX.armco(), ads: TX.adWall(), tecpro: TX.tecpro(),
    fence: TX.fence(), concrete: TX.concrete(), markers: TX.markerBoards(), barrier: TX.barrierAtlas(),
  };
  // Large-scale variation (40 m) multiplied into the asphalt so the 3 m tile never repeats
  // visibly (patchy wear, darker / lighter laid sections).
  const withMacro = (mat, amt = [0.82, 1.14]) => {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.macroMap = { value: tex.macro };
      sh.fragmentShader = sh.fragmentShader
        .replace('void main() {', 'uniform sampler2D macroMap;\nvoid main() {')
        .replace('#include <map_fragment>', `#include <map_fragment>
          { float mac = texture2D(macroMap, vMapUv * 0.075).r * 0.65 + texture2D(macroMap, vMapUv * 0.31 + 0.37).r * 0.35;
            diffuseColor.rgb *= mix(${amt[0].toFixed(2)}, ${amt[1].toFixed(2)}, mac); }`);
    };
    mat.customProgramCacheKey = () => 'macro' + amt.join();
    return mat;
  };
  const lo = quality === 'low';
  const M = {
    // PBR asphalt: high roughness (no gloss), stone relief normal map, polished-stone roughness
    ground: withMacro(lo
      ? new THREE.MeshLambertMaterial({ map: tex.asphalt, vertexColors: true })
      : new THREE.MeshStandardMaterial({ map: tex.asphalt, normalMap: tex.asphaltN, normalScale: new THREE.Vector2(0.55, 0.55), roughnessMap: tex.asphaltR, roughness: 1.0, metalness: 0.0, vertexColors: true, envMapIntensity: 0.35 })),
    // tunnel floor: baked light (vertex colours) on an unlit material; the factor carries the
    // LED luminaire level onto the dark PBR asphalt albedo (same apparent grey as in daylight)
    tunnelGround: withMacro(new THREE.MeshBasicMaterial({ map: tex.asphalt, vertexColors: true, color: new THREE.Color(3.4, 3.4, 3.4) })),
    // painted kerbs and lines: smoother than the asphalt, keeping some of its relief
    paint: lo
      ? new THREE.MeshLambertMaterial({ map: tex.paint, vertexColors: true })
      : new THREE.MeshStandardMaterial({ map: tex.paint, normalMap: tex.asphaltN, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.6, metalness: 0, vertexColors: true, envMapIntensity: 0.35 }),
    roadDetail: new THREE.MeshStandardMaterial({ map: tex.roadAtlas, transparent: true, depthWrite: false, vertexColors: true, roughness: 0.8, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    barrier: new THREE.MeshLambertMaterial({ map: tex.barrier, vertexColors: true }),
    tunnelWall: new THREE.MeshBasicMaterial({ map: tex.barrier, vertexColors: true }),
    tunnelRoof: new THREE.MeshBasicMaterial({ map: tex.concrete, vertexColors: true }),
    tunnelShell: new THREE.MeshLambertMaterial({ map: tex.concrete, vertexColors: true }),
    fence: new THREE.MeshLambertMaterial({ map: tex.fence, alphaTest: 0.3, alphaToCoverage: true, side: THREE.DoubleSide, transparent: false }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xfff6e6 }),
    lampHousing: new THREE.MeshBasicMaterial({ color: 0x2b2c2f }),
    markers: new THREE.MeshLambertMaterial({ map: tex.markers, emissive: 0x111111 }),
    gantry: new THREE.MeshLambertMaterial({ color: 0x23262b }),
    lightRed: new THREE.MeshBasicMaterial({ color: 0x401010 }),
  };
  const N = T.N, L = T.L;
  const TUN_H = 5.9;                     // ceiling height above the road
  // Baked tunnel lighting (0..1.35): continuous LED luminaire rows at d = +/-2.6 give a near
  // uniform level; the threshold zone after the entrance is brighter so the eye / camera can
  // adapt; surfaces higher up (walls near the fittings) receive more light; daylight spills in
  // at the portals.
  function tunnelLight(s, d, h) {
    const into = T.deltaS(T.tunnelS[0], s), out = T.deltaS(s, T.tunnelS[1]);
    const threshold = 1 + 0.35 * Math.max(0, 1 - into / 70);
    const lateral = 1 - 0.18 * Math.min(1, Math.max(0, Math.abs(d) - 2.6) / 4);
    const height = 0.85 + 0.15 * Math.min(1, h / TUN_H);
    const daylight = Math.max(0, 1 - Math.min(into, out) / 14) * 0.35;   // spill at the portals
    return Math.min(1.35, 0.72 * threshold * lateral * height + daylight);
  }
  const nChunks = Math.ceil(L / CHUNK);
  const chunks = [];
  for (let i = 0; i < nChunks; i++) chunks.push({ ground: new Builder(), paint: new Builder(), tground: new Builder(), barrier: new Builder(), twall: new Builder(), roof: new Builder(), shell: new Builder(), fence: new Builder() });
  const chunkOf = (s) => chunks[Math.min(nChunks - 1, Math.floor(T.wrapS(s) / CHUNK))];

  // ---------------------------------------------------------------------------------------------
  // Rows: 1 m where kerbs or tight bends exist, otherwise 2 m.
  const rows = [];
  for (let s = 0; s < L; s += 1) {
    const k = T.idxOfS(s);
    const fine = T.curbL[k] > 0 || T.curbR[k] > 0 || Math.abs(T.curv[k]) > 1 / 45 || T.curbL[(k + 1) % N] > 0 || T.curbR[(k + 1) % N] > 0;
    if (fine || s % 2 === 0) rows.push(s);
  }
  const pitZone = (s) => s > L - 150 || s < 300;
  const rl = racingLine;
  const P = (s, d, dy = 0) => { const p = T.pointAt(s, d); return [p.x, p.y + dy, p.z]; };

  const sectionFor = (s) => {
    const k = T.idxOfS(s);
    const hw = T.sample(T.halfW, s);
    const cl = T.sample(T.curbL, s), cr = T.sample(T.curbR, s);
    const bl = T.sample(T.barL, s), br = T.sample(T.barR, s);
    // pavement widths from the corridor: clipped where another section runs alongside
    const walkL = corridor ? corridor.walkL[k] : 4.5, walkR = corridor ? corridor.walkR[k] : (pitZone(s) ? 13.0 : 4.5);
    return { k, hw, cl, cr, bl, br, walkL, walkR };
  };

  for (let r = 0; r < rows.length; r++) {
    const s0 = rows[r], s1 = r + 1 < rows.length ? rows[r + 1] : L;
    const A = sectionFor(s0), B = sectionFor(s1 % L);
    const inTun = T.inTunnel((s0 + s1) / 2);
    const ch = chunkOf(s0);
    const G = inTun ? ch.tground : ch.ground;
    const GP = inTun ? ch.tground : ch.paint;          // kerbs and lines (painted)
    // tunnel: baked light from the two luminaire rows (near-uniform, brighter threshold zone)
    const lampF = (s) => inTun ? tunnelLight(s, 0, 0) : 1;
    const fa = lampF(s0), fb = lampF(s1);
    const uvq = (d0, d1) => [[d0 / 3, s0 / 3], [d1 / 3, s0 / 3], [d0 / 3, s1 / 3], [d1 / 3, s1 / 3]];
    const band = (d0a, d1a, d0b, d1b, col, dy0 = 0, dy1 = 0, colB = null, Bld = G) => {
      const a = P(s0, d0a, dy0), b = P(s0, d1a, dy1), c = P(s1, d0b, dy0), d = P(s1, d1b, dy1);
      Bld.quad(a, b, c, d, mul(col, fa), uvq(d0a, d1a), mul(colB || col, fb));
    };
    // road surface: rubber laid along the racing line by the tyres (two soft bands at the
    // tyre tracks, merged by line-to-line variation, lighter under the car), plus the white
    // edge lines. Colours vary per vertex across the road, so there are no hard steps.
    const lineD0 = rl ? rl.d[T.idxOfS(s0)] : 0, lineD1 = rl ? rl.d[T.idxOfS(s1)] : 0;
    const rubberAt = (dd) => {
      const g = (x0, sg) => Math.exp(-((dd - x0) * (dd - x0)) / (2 * sg * sg));
      return Math.min(1, 0.85 * (g(0.8, 0.42) + g(-0.8, 0.42)) + 0.32 * g(0, 1.5));
    };
    const roadCol = (dd, f) => { const k = 1 - 0.36 * rubberAt(dd); return [C.asphalt[0] * k * f, C.asphalt[1] * k * f, C.asphalt[2] * k * f]; };
    const OFFS = [2.6, 1.7, 1.25, 0.9, 0.55, 0.25, 0, -0.25, -0.55, -0.9, -1.25, -1.7, -2.6];
    const roadCuts = (S, ld) => {
      const pts = [S.hw, S.hw - 0.12];
      for (const o of OFFS) pts.push(Math.max(-S.hw + 0.12, Math.min(S.hw - 0.12, ld + o)));
      pts.push(-S.hw + 0.12, -S.hw);
      for (let i = 1; i < pts.length; i++) pts[i] = Math.min(pts[i], pts[i - 1]);
      return pts;
    };
    const ra = roadCuts(A, lineD0), rb = roadCuts(B, lineD1);
    band(ra[0], ra[1], rb[0], rb[1], C.white, 0, 0, null, GP);
    band(ra[ra.length - 2], ra[ra.length - 1], rb[rb.length - 2], rb[rb.length - 1], C.white, 0, 0, null, GP);
    for (let i = 1; i < ra.length - 2; i++) {
      if (ra[i] - ra[i + 1] < 1e-4 && rb[i] - rb[i + 1] < 1e-4) continue;
      const a = P(s0, ra[i]), b = P(s0, ra[i + 1]), c = P(s1, rb[i]), d = P(s1, rb[i + 1]);
      G.quad4(a, b, c, d, roadCol(ra[i] - lineD0, fa), roadCol(ra[i + 1] - lineD0, fa), roadCol(rb[i] - lineD1, fb), roadCol(rb[i + 1] - lineD1, fb), uvq(ra[i], ra[i + 1]));
    }
    // kerbs: red/white 1 m stripes, slightly raised in the middle
    const stripe = (Math.floor(s0) % 2) ? C.red : C.white;
    if (A.cl > 0.05 || B.cl > 0.05) band(A.hw + A.cl, A.hw, B.hw + B.cl, B.hw, stripe, 0.0, 0.0, null, GP);
    if (A.cr > 0.05 || B.cr > 0.05) band(-A.hw, -A.hw - A.cr, -B.hw, -B.hw - B.cr, stripe, 0.0, 0.0, null, GP);
    // run-off to the barriers
    band(A.bl, A.hw + A.cl, B.bl, B.hw + B.cl, C.runoff);
    band(-A.hw - A.cr, -A.br, -B.hw - B.cr, -B.br, C.runoff);
    if (!inTun) {
      // pavements beyond the barriers (raised 12 cm); pit lane on the start straight
      band(A.bl + A.walkL, A.bl, B.bl + B.walkL, B.bl, C.walk, 0.12, 0.12);
      if (pitZone(s0)) {
        band(-A.br, -A.br - 0.4, -B.br, -B.br - 0.4, C.walkEdge, 0.12, 0.12);
        band(-A.br - 0.4, -A.br - 1.2, -B.br - 0.4, -B.br - 1.2, C.white, 0.005, 0.005);
        band(-A.br - 1.2, -A.br - 9.5, -B.br - 1.2, -B.br - 9.5, C.pit, 0.005, 0.005);
        band(-A.br - 9.5, -A.br - A.walkR, -B.br - 9.5, -B.br - B.walkR, mul(C.walk, 0.9), 0.02, 0.02);
      } else {
        band(-A.br, -A.br - A.walkR, -B.br, -B.br - B.walkR, C.walk, 0.12, 0.12);
      }
      // retaining walls where the ground falls away behind the pavement (terrain is kept at
      // least 1.2 m below every road and pavement, so this face closes the gap)
      const RW = ch.barrier, rv0 = 0.004, rv1 = 0.25 - 0.004;      // concrete row of the atlas
      for (const side of [1, -1]) {
        const ea = side > 0 ? A.bl + A.walkL : -(A.br + A.walkR), eb = side > 0 ? B.bl + B.walkL : -(B.br + B.walkR);
        const ta = P(s0, ea, 0.12), tb = P(s1, eb, 0.12), ba = P(s0, ea, -6), bb = P(s1, eb, -6);
        const uvw = [[s0 / 4, rv1], [s0 / 4, rv0], [s1 / 4, rv1], [s1 / 4, rv0]];
        // faces away from the circuit (seen from lower roads / the harbour, never from the road)
        if (side > 0) RW.quad(ba, ta, bb, tb, [0.82, 0.8, 0.76], [uvw[1], uvw[0], uvw[3], uvw[2]]);
        else RW.quad(ta, ba, tb, bb, [0.82, 0.8, 0.76], uvw);
      }
    }
  }

  // start/finish line + grid boxes
  {
    const ch = chunkOf(0);
    const hw = T.sample(T.halfW, 0);
    const G = ch.paint;
    const sq = 0.5;
    for (let i = 0; i < Math.round(2 * hw / sq); i++) {
      const d0 = hw - i * sq, d1 = d0 - sq;
      for (let j = 0; j < 2; j++) {
        const col = (i + j) % 2 ? [0.05, 0.05, 0.05] : C.white;
        const sA = -0.6 + j * 0.6, sB = sA + 0.6;
        const a = P(sA, d0, 0.004), b = P(sA, d1, 0.004), c = P(sB, d0, 0.004), d = P(sB, d1, 0.004);
        G.quad(a, b, c, d, col, [[d0 / 3, sA / 3], [d1 / 3, sA / 3], [d0 / 3, sB / 3], [d1 / 3, sB / 3]]);
      }
    }
    // grid slots (staggered) behind the line
    for (let g = 0; g < 10; g++) {
      const sg = -8 - g * 8, dd = g % 2 ? -2.4 : 2.4;
      const s = T.wrapS(sg);
      const G2 = chunkOf(s).paint;
      const a = P(s, dd + 1.0, 0.004), b = P(s, dd - 1.0, 0.004), c = P(s + 0.25, dd + 1.0, 0.004), d = P(s + 0.25, dd - 1.0, 0.004);
      G2.quad(a, b, c, d, C.white, [[(dd + 1) / 3, s / 3], [(dd - 1) / 3, s / 3], [(dd + 1) / 3, (s + 0.25) / 3], [(dd - 1) / 3, (s + 0.25) / 3]]);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Road details: rubber laid by braking (front tyres) and traction (rear tyres) along the racing
  // line, lock-up flat-spot marks at the end of the heavy stops, resurfaced patches, sealed
  // seams, manhole covers and gutter grates. One RGBA-coloured overlay mesh per ~600 m.
  if (rl && rl.vmax) {
    const A = TX.ROAD_ATLAS;
    const rand = (() => { let q = 9137; return () => ((q = (q * 1664525 + 1013904223) >>> 0) / 4294967296); })();
    const groups = [];
    const GROUP = 600;
    const grp = (s) => { const i = Math.floor(T.wrapS(s) / GROUP); return groups[i] || (groups[i] = { p: [], c: [], uv: [] }); };
    const pushQuad = (g, a, b, c, d, ua, ub, uc, ud, ca, cb, cc, cd) => {
      for (const [P, U, Cc] of [[a, ua, ca], [b, ub, cb], [c, uc, cc], [b, ub, cb], [d, ud, cd], [c, uc, cc]]) { g.p.push(...P); g.uv.push(...U); g.c.push(...Cc); }
    };
    const LIFT = 0.006;
    // strip along the lap at lateral offset dOf(s) (function), width w, region of the atlas
    // repeated every rep metres along the strip, alpha alpha(t) over the strip (t 0..1)
    const strip = (sA, sB, dOf, w, region, rep, alpha, rgb = [1, 1, 1]) => {
      const len = T.deltaS(sA, sB);
      if (len <= 0.5) return;
      const [u0, v0, u1, v1] = A[region];
      const n = Math.max(1, Math.ceil(len / 1.5));
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n, sa = sA + len * t0, sb = sA + len * t1;
        // u restarts each rep metres: split a segment that crosses a repeat boundary
        const f0 = ((len * t0) / rep) % 1, f1raw = (len * t1) / rep;
        const f1 = f1raw - Math.floor((len * t0) / rep);
        if (f1 > 1.0001) continue;                  // tiny gap at the repeat boundary
        const ua = u0 + (u1 - u0) * f0, ub = u0 + (u1 - u0) * Math.min(1, f1);
        const da = dOf(sa), db = dOf(sb);
        const p0 = P(sa, da + w / 2, LIFT), p1 = P(sa, da - w / 2, LIFT), p2 = P(sb, db + w / 2, LIFT), p3 = P(sb, db - w / 2, LIFT);
        const aA = alpha(t0), aB = alpha(t1);
        pushQuad(grp(sa), p0, p1, p2, p3, [ua, v1], [ua, v0], [ub, v1], [ub, v0], [...rgb, aA], [...rgb, aA], [...rgb, aB], [...rgb, aB]);
      }
    };
    const sprite = (sc, dc, along, across, ang, region, a = 1, rgb = [1, 1, 1]) => {
      const [u0, v0, u1, v1] = A[region];
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const corner = (x, y) => { const ds = x * ca - y * sa, dd = x * sa + y * ca; return P(sc + ds, dc + dd, LIFT + 0.001); };
      const hl = along / 2, hc = across / 2, c4 = [...rgb, a];
      pushQuad(grp(sc), corner(-hl, hc), corner(-hl, -hc), corner(hl, hc), corner(hl, -hc), [u0, v1], [u0, v0], [u1, v1], [u1, v0], c4, c4, c4, c4);
    };
    const v = rl.vmax, Nn = T.N, ds = T.ds;
    const dAt = (s) => rl.d[T.idxOfS(s)];
    // braking zones and exits from the speed profile
    const zones = [];
    for (let k = 0; k < Nn; k++) {
      const dec = v[k] - v[(k + 1) % Nn];
      if (dec > 0.035 && !(zones.length && zones[zones.length - 1].end === k - 1)) zones.push({ start: k, end: k });
      else if (dec > 0.035) zones[zones.length - 1].end = k;
    }
    for (const z of zones) {
      const sA = z.start * ds, sB = z.end * ds, len = sB - sA;
      if (len < 25 || T.inTunnel(sA)) continue;
      const heavy = (v[z.start] - v[z.end]) / Math.max(1, v[z.start]);
      // front tyres (track 1.68 m): darker towards the corner where the load is lowest
      for (const off of [0.83, -0.83]) for (const [j, w, ph] of [[-0.07, 0.42, 0], [0.09, 0.36, 2.1]]) {
        strip(sA + len * (0.30 + 0.08 * rand()), sB, (s) => dAt(s) + off + j + 0.035 * Math.sin(s * 0.13 + ph), w, 'streak', 13 + 4 * rand(), (t) => Math.min(0.9, (0.25 + 0.75 * t) * (0.55 + heavy)));
      }
      // lock-up flat spots near the end of heavy stops
      if (heavy > 0.45) {
        const nLock = 1 + Math.floor(rand() * 3);
        for (let i = 0; i < nLock; i++) {
          const sc = sB - 4 - rand() * len * 0.3, off = rand() < 0.5 ? 0.83 : -0.83;
          sprite(sc, dAt(sc) + off, 3 + rand() * 4, 0.32, (rand() - 0.5) * 0.05, 'lock', 0.85);
        }
      }
      // exit: rear tyres (track 1.60 m) laying rubber under traction after the apex
      let kx = z.end, kMax = z.end + 80;
      while (kx < kMax && v[(kx + 1) % Nn] >= v[kx % Nn] - 1e-3 && v[kx % Nn] < v[z.end] * 1.45) kx++;
      const eA = z.end * ds + 2, eB = kx * ds;
      if (eB - eA > 8 && !T.inTunnel(eA)) for (const off of [0.80, -0.80]) strip(eA, eB, (s) => dAt(s) + off, 0.44, 'streak', 16, (t) => 0.8 * (1 - t) * (1 - t));
    }
    // resurfaced patches, seams, manholes and gutter grates (not on the grid / in the tunnel)
    const okHere = (s) => !T.inTunnel(s) && !(s > T.L - 100 || s < 8);
    for (let i = 0; i < 140; i++) {
      const sc = rand() * T.L; if (!okHere(sc)) continue;
      const hw = T.sample(T.halfW, sc);
      const crack = rand() < 0.4;
      const along = crack ? 2.5 + rand() * 3 : 1.4 + rand() * 4.6, across = crack ? 1.4 + rand() * 1.6 : 0.9 + rand() * 2.2;
      const dc = (rand() * 2 - 1) * Math.max(0, hw - across / 2 - 0.3);
      sprite(sc, dc, along, across, crack ? (rand() - 0.5) * 0.5 : (rand() - 0.5) * 0.04, crack ? 'patchB' : 'patchA', crack ? 0.8 : 1);
    }
    for (let i = 0; i < 26; i++) {
      const sc = rand() * T.L; if (!okHere(sc)) continue;
      const hw = T.sample(T.halfW, sc), side = rand() < 0.5 ? 1 : -1, sl = 25 + rand() * 60;
      strip(sc, sc + sl, () => side * (hw - 1.4 - rand() * 0.001), 0.10, 'seam', 9, () => 0.8);
      if (rand() < 0.5) { const hw2 = T.sample(T.halfW, sc + sl * 0.5); sprite(sc + sl * 0.5, 0, 0.1, hw2 * 2 - 0.4, 0.02, 'seam', 0.7); }
    }
    for (let i = 0; i < 46; i++) {
      const sc = rand() * T.L; if (!okHere(sc)) continue;
      const hw = T.sample(T.halfW, sc), side = rand() < 0.5 ? 1 : -1;
      if (rand() < 0.55) sprite(sc, side * (hw - 0.9 - rand() * 1.2), 0.68, 0.68, rand() * 3, 'manhole', 1);
      else sprite(sc, side * (hw - 0.26), 0.82, 0.42, 0, 'grate', 1);
    }
    for (const g of groups) {
      if (!g || !g.p.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(g.c, 4));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, M.roadDetail); m.name = 'roadDetail'; m.matrixAutoUpdate = false; m.renderOrder = 1;
      group.add(m);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Barriers (+ fences) per side
  const BAR_H = 1.05, FENCE_H = 3.6;
  const TUN_LEN = T.deltaS(T.tunnelS[0], T.tunnelS[1]);
  const BEAM_EVERY = 7.5, BEAM0 = 3.75, WALL_OFF = 0.35;
  const beamsIn = (s0, s1) => {       // beam stations (lap s) inside [s0, s1)
    const out = [];
    const into = T.deltaS(T.tunnelS[0], s0), len = s1 - s0;
    for (let q = BEAM0 + BEAM_EVERY * Math.max(0, Math.floor((into - BEAM0) / BEAM_EVERY)); q < into + len; q += BEAM_EVERY) {
      if (q >= into && q < TUN_LEN - 1) out.push(T.wrapS(T.tunnelS[0] + q));
    }
    return out;
  };
  for (const side of [1, -1]) {
    let skipUntil = -1;
    for (let s0 = 0; s0 < L; s0 += 1) {
      if (s0 < skipUntil) continue;
      const typ = barrierType(T, s0 + 0.5, side);
      // the tunnel bends gently (R >= 239 m): 2 m segments there (2 mm sagitta)
      const s1 = s0 + (typ === 'tunnel' && T.inTunnel(s0 + 1.5) && s0 + 2 <= L ? 2 : 1);
      skipUntil = s1;
      const ch = chunkOf(s0);
      const off = (s) => side > 0 ? T.sample(T.barL, s) : -T.sample(T.barR, s);
      const o0 = off(s0), o1 = off(s1);
      const y0a = T.heightAt(s0, o0), y0b = T.heightAt(s1, o1);
      const pa = T.pointAt(s0, o0), pb = T.pointAt(s1, o1);
      const backA = T.pointAt(s0, o0 + side * 0.3), backB = T.pointAt(s1, o1 + side * 0.3);
      if (typ === 'tunnel') {
        // armco (sparse sponsor boards) in front of a light concrete wall with pilasters
        const W = ch.twall;
        const fu = side > 0 ? 1 : -1;
        const into = T.deltaS(T.tunnelS[0], s0);
        const board = Math.floor(into / 62) % 2 === 1 && (into % 62) < 7;
        const row = board ? TX.BARRIER_ROWS.ads : TX.BARRIER_ROWS.armco;
        const v0 = 1 - (row + 1) / 4 + 0.004, v1 = 1 - row / 4 - 0.004;
        const us = board ? 16 : 4;
        const la = tunnelLight(s0, o0, 0.6), lb = tunnelLight(s1, o1, 0.6);
        const a = [pa.x, y0a - 0.05, pa.z], b = [pa.x, y0a + BAR_H, pa.z], c = [pb.x, y0b - 0.05, pb.z], d = [pb.x, y0b + BAR_H, pb.z];
        const uv = [[fu * s0 / us, v0], [fu * s0 / us, v1], [fu * s1 / us, v0], [fu * s1 / us, v1]];
        if (side > 0) W.quad(b, a, d, c, mul([1, 1, 1], la), [uv[1], uv[0], uv[3], uv[2]], mul([1, 1, 1], lb));
        else W.quad(a, b, c, d, mul([1, 1, 1], la), uv, mul([1, 1, 1], lb));
        // rail top cap back to the wall (closes the gap behind the armco)
        const wo = side * WALL_OFF;
        const qa = T.pointAt(s0, o0 + wo), qb = T.pointAt(s1, o1 + wo);
        {
          const e = [qa.x, y0a + BAR_H, qa.z], f2 = [qb.x, y0b + BAR_H, qb.z];
          const cc = mul([0.5, 0.5, 0.5], la), cuv = [[0, 0.1], [0, 0.1], [0, 0.1], [0, 0.1]];
          if (side > 0) W.quad(e, b, f2, d, cc, cuv); else W.quad(b, e, d, f2, cc, cuv);
        }
        // concrete wall behind the rail, up to the cable tray at 4.6 m; light grey, cleaner
        // towards the luminaires, a grime band just above the rail
        const ya = qa.y, yb = qb.y;
        const wv0 = 0.004, wv1 = 0.25 - 0.004;           // concrete row of the atlas
        const H0 = BAR_H, H1 = 4.6, nb = 3;
        const wcol = (sq, d, h, g) => mul([1.0, 0.98, 0.94], tunnelLight(sq, d, h) * g);
        {
          const A2 = [qa.x, ya + H0, qa.z], B2 = [qa.x, ya + H1, qa.z], C2 = [qb.x, yb + H0, qb.z], D2 = [qb.x, yb + H1, qb.z];
          const g0 = 0.55, g1 = 0.92;
          const ca = wcol(s0, o0, H0, g0), cb = wcol(s0, o0, H1, g1), cc = wcol(s1, o1, H0, g0), cd = wcol(s1, o1, H1, g1);
          const vv = (h) => wv0 + (wv1 - wv0) * (h / H1);
          const wuv = [[fu * s0 / 3, vv(H0)], [fu * s0 / 3, vv(H1)], [fu * s1 / 3, vv(H0)], [fu * s1 / 3, vv(H1)]];
          if (side > 0) { W.tri(B2, A2, D2, cb, ca, cd, wuv[1], wuv[0], wuv[3]); W.tri(A2, C2, D2, ca, cc, cd, wuv[0], wuv[2], wuv[3]); }
          else { W.tri(A2, B2, C2, ca, cb, cc, wuv[0], wuv[1], wuv[2]); W.tri(B2, D2, C2, cb, cd, cc, wuv[1], wuv[3], wuv[2]); }
        }
        // pilasters under each ceiling beam
        for (const sb of beamsIn(s0, s1)) {
          const pw = 0.6, pdp = 0.2;
          const ob = off(sb), yb0 = T.pointAt(sb, ob + wo).y;
          const p0 = T.pointAt(sb - pw / 2, ob + wo - side * pdp), p1 = T.pointAt(sb + pw / 2, ob + wo - side * pdp);
          const r0 = T.pointAt(sb - pw / 2, ob + wo + side * 0.02), r1 = T.pointAt(sb + pw / 2, ob + wo + side * 0.02);
          const lc = mul([0.95, 0.93, 0.9], tunnelLight(sb, ob, 3)), puv = [[0.02, 0.02], [0.02, 0.2], [0.04, 0.02], [0.04, 0.2]];
          const fA = [p0.x, yb0 + H0, p0.z], fB = [p0.x, yb0 + H1, p0.z], fC = [p1.x, yb0 + H0, p1.z], fD = [p1.x, yb0 + H1, p1.z];
          const sA = [r0.x, yb0 + H0, r0.z], sB = [r0.x, yb0 + H1, r0.z], sC = [r1.x, yb0 + H0, r1.z], sD = [r1.x, yb0 + H1, r1.z];
          if (side > 0) {
            W.quad(fB, fA, fD, fC, lc, puv);
            W.quad(sB, sA, fB, fA, mul(lc, 0.75), puv);
            W.quad(fD, fC, sD, sC, mul(lc, 0.75), puv);
          } else {
            W.quad(fA, fB, fC, fD, lc, puv);
            W.quad(sA, sB, fA, fB, mul(lc, 0.75), puv);
            W.quad(fC, fD, sC, sD, mul(lc, 0.75), puv);
          }
        }
        // cable tray along the wall top, then plain wall up into the ceiling slab
        {
          const k0 = T.pointAt(s0, o0 + wo - side * 0.42), k1 = T.pointAt(s1, o1 + wo - side * 0.42);
          const tc = mul([0.55, 0.55, 0.56], tunnelLight(s0, o0, 4.6)), uvc = [[0.02, 0.02], [0.02, 0.03], [0.03, 0.02], [0.03, 0.03]];
          const kA = [k0.x, ya + H1, k0.z], kB = [k0.x, ya + H1 + 0.28, k0.z], kC = [k1.x, yb + H1, k1.z], kD = [k1.x, yb + H1 + 0.28, k1.z];
          if (side > 0) W.quad(kB, kA, kD, kC, tc, uvc); else W.quad(kA, kB, kC, kD, tc, uvc);
          const wA = [qa.x, ya + H1, qa.z], wC = [qb.x, yb + H1, qb.z];
          // underside of the tray, facing down to the road
          if (side > 0) W.quad(kA, wA, kC, wC, mul(tc, 0.6), uvc); else W.quad(wA, kA, wC, kC, mul(tc, 0.6), uvc);
          // wall above the tray; runs 5 cm past the ceiling so the joint has no crack
          const uA = [qa.x, ya + H1 + 0.28, qa.z], uB = [qa.x, ya + TUN_H + 0.05, qa.z], uC = [qb.x, yb + H1 + 0.28, qb.z], uD = [qb.x, yb + TUN_H + 0.05, qb.z];
          const uc = mul([0.8, 0.79, 0.76], tunnelLight(s0, o0, 5.4)), uuv = [[0.02, 0.1], [0.02, 0.2], [0.04, 0.1], [0.04, 0.2]];
          if (side > 0) W.quad(uB, uA, uD, uC, uc, uuv); else W.quad(uA, uB, uC, uD, uc, uuv);
        }
        continue;
      }
      const B = ch.barrier;
      const row = TX.BARRIER_ROWS[typ === 'pitwall' ? 'wall' : typ] ?? 0;
      const v0 = 1 - (row + 1) / 4 + 0.004, v1 = 1 - row / 4 - 0.004;
      const h = typ === 'tecpro' ? 1.2 : typ === 'pitwall' ? 1.2 : BAR_H;
      const uScale = typ === 'ads' ? 16 : 4;
      const a = [pa.x, y0a - 0.05, pa.z], b = [pa.x, y0a + h, pa.z], c = [pb.x, y0b - 0.05, pb.z], d = [pb.x, y0b + h, pb.z];
      const fu = side > 0 ? 1 : -1;
      const uv = [[fu * s0 / uScale, v0], [fu * s0 / uScale, v1], [fu * s1 / uScale, v0], [fu * s1 / uScale, v1]];
      const col = [1, 1, 1];
      if (side > 0) B.quad(b, a, d, c, col, [uv[1], uv[0], uv[3], uv[2]]); else B.quad(a, b, c, d, col, uv);
      // top cap
      const e = [backA.x, y0a + h, backA.z], f2 = [backB.x, y0b + h, backB.z];
      const capCol = [0.8, 0.8, 0.8], cuv = [[0, 0.1], [0, 0.1], [0, 0.1], [0, 0.1]];
      if (side > 0) B.quad(e, b, f2, d, capCol, cuv); else B.quad(b, e, d, f2, capCol, cuv);
      // catch fence on top (not where buildings press right up to the barrier in the old town)
      if (typ !== 'tecpro' && !(typ === 'pitwall')) {
        const fa = [pa.x, y0a + h, pa.z], fb2 = [pa.x, y0a + h + FENCE_H, pa.z], fc = [pb.x, y0b + h, pb.z], fd = [pb.x, y0b + h + FENCE_H, pb.z];
        const fuv = [[s0 / 4, 0], [s0 / 4, 1], [s1 / 4, 0], [s1 / 4, 1]];
        ch.fence.quad(fa, fb2, fc, fd, [1, 1, 1], fuv);
      }
    }
  }

  // Tunnel ceiling: a continuous slab (no gaps, single surface facing down) with transverse
  // beams every 7.5 m and two rows of luminaires; a solid roof slab and outer shell above /
  // beside it (they cast the shadow that keeps the car out of the sun inside); portal frames.
  const lamps = new Builder(), housings = new Builder();
  {
    const [t0, t1] = T.tunnelS;
    const len = TUN_LEN;
    const across = 6;
    // ceiling edges at the wall planes (+5 cm into the wall so the joint is closed)
    const edges = (sq) => [T.sample(T.barL, sq) + WALL_OFF + 0.05, -T.sample(T.barR, sq) - WALL_OFF - 0.05];
    const camber = (f) => 0.15 * Math.sin(Math.max(0, Math.min(1, f)) * Math.PI);
    const ceilY = (sq, d) => { const [l, r] = edges(sq); return TUN_H + camber((l - d) / (l - r)); };
    for (let q = 0; q < len; q += 2) {
      const s0 = T.wrapS(t0 + q), s1 = T.wrapS(t0 + Math.min(len, q + 2));
      const ch = chunkOf(s0);
      const [l0, r0] = edges(s0), [l1, r1] = edges(s1);
      for (let i = 0; i < across; i++) {
        const fA = i / across, fB = (i + 1) / across;
        const dA0 = l0 + (r0 - l0) * fA, dB0 = l0 + (r0 - l0) * fB, dA1 = l1 + (r1 - l1) * fA, dB1 = l1 + (r1 - l1) * fB;
        const a = P(s0, dA0, TUN_H + camber(fA)), b = P(s0, dB0, TUN_H + camber(fB)), c = P(s1, dA1, TUN_H + camber(fA)), d = P(s1, dB1, TUN_H + camber(fB));
        const ca = mul([0.62, 0.61, 0.6], tunnelLight(s0, dA0, TUN_H)), cb = mul([0.62, 0.61, 0.6], tunnelLight(s0, dB0, TUN_H));
        const cc = mul([0.62, 0.61, 0.6], tunnelLight(s1, dA1, TUN_H)), cd = mul([0.62, 0.61, 0.6], tunnelLight(s1, dB1, TUN_H));
        const uv = [[dA0 / 3, s0 / 3], [dB0 / 3, s0 / 3], [dA1 / 3, s1 / 3], [dB1 / 3, s1 / 3]];
        // one continuous surface facing down (visible from the road)
        ch.roof.tri(b, a, d, cb, ca, cd, uv[1], uv[0], uv[3]); ch.roof.tri(a, c, d, ca, cc, cd, uv[0], uv[2], uv[3]);
      }
      // roof slab top (+7.6), lit by the sun from outside
      {
        const ta = P(s0, l0, 7.6), tb = P(s0, r0, 7.6), tc2 = P(s1, l1, 7.6), td = P(s1, r1, 7.6);
        ch.shell.quad(ta, tb, tc2, td, [0.55, 0.53, 0.5], [[l0 / 3, s0 / 3], [r0 / 3, s0 / 3], [l1 / 3, s1 / 3], [r1 / 3, s1 / 3]]);
      }
      // outer shell walls (0.6 m thick tunnel walls), from below the road up to the slab top
      for (const [side, o0, o1] of [[1, l0 + 0.55, l1 + 0.55], [-1, r0 - 0.55, r1 - 0.55]]) {
        const A = P(s0, o0, -3), B = P(s0, o0, 7.6), Cc = P(s1, o1, -3), D = P(s1, o1, 7.6);
        const uvs = [[s0 / 4, 0], [s0 / 4, 2], [s1 / 4, 0], [s1 / 4, 2]];
        if (side > 0) ch.shell.quad(A, B, Cc, D, [0.6, 0.58, 0.55], uvs); else ch.shell.quad(B, A, D, Cc, [0.6, 0.58, 0.55], [uvs[1], uvs[0], uvs[3], uvs[2]]);
      }
    }
    // transverse beams (0.5 m wide, 0.32 m deep) carried by the wall pilasters
    for (let qb = BEAM0; qb < len - 1; qb += BEAM_EVERY) {
      const sb = T.wrapS(t0 + qb), ch = chunkOf(sb);
      const bw = 0.5, bd = 0.32;
      const [l, r] = edges(sb);
      const nb = 4;
      for (let i = 0; i < nb; i++) {
        const fA = i / nb, fB = (i + 1) / nb;
        const dA = l + (r - l) * fA, dB = l + (r - l) * fB;
        const yA = TUN_H + camber(fA), yB = TUN_H + camber(fB);
        const a = P(sb - bw / 2, dA, yA - bd), b = P(sb - bw / 2, dB, yB - bd), c = P(sb + bw / 2, dA, yA - bd), d = P(sb + bw / 2, dB, yB - bd);
        const bc = mul([0.5, 0.5, 0.5], tunnelLight(sb, dA, TUN_H)), sc2 = mul(bc, 0.8), z2 = [0, 0];
        ch.roof.tri(b, a, d, bc, bc, bc, z2, z2, z2); ch.roof.tri(a, c, d, bc, bc, bc, z2, z2, z2);
        const a2 = P(sb - bw / 2, dA, yA + 0.02), b2 = P(sb - bw / 2, dB, yB + 0.02);
        ch.roof.tri(a2, a, b2, sc2, sc2, sc2, z2, z2, z2); ch.roof.tri(a, b, b2, sc2, sc2, sc2, z2, z2, z2);
        const c2 = P(sb + bw / 2, dA, yA + 0.02), d2 = P(sb + bw / 2, dB, yB + 0.02);
        ch.roof.tri(c, c2, d, sc2, sc2, sc2, z2, z2, z2); ch.roof.tri(c2, d2, d, sc2, sc2, sc2, z2, z2, z2);
      }
    }
    // luminaires: 1.5 m fittings every 2.5 m between the beams, two rows over the lanes (a
    // third, central row in the threshold zone after the entrance), hung 12 cm below the slab
    for (let ql = BEAM0 + 0.6 - BEAM_EVERY / 3 * Math.floor((BEAM0 + 0.6) / (BEAM_EVERY / 3)); ql + 1.5 < len - 0.5; ql += BEAM_EVERY / 3) {
      if (ql < 0.5) continue;
      const sl = T.wrapS(t0 + ql);
      const rowsD = ql < 70 ? [-2.6, 0, 2.6] : [-2.6, 2.6];
      for (const dd of rowsD) {
        const y = ceilY(sl, dd) - 0.12;
        const p0 = P(sl, dd - 0.2, y), p1 = P(sl + 1.5, dd - 0.2, y), p2 = P(sl, dd + 0.2, y), p3 = P(sl + 1.5, dd + 0.2, y);
        const z4 = [[0, 0], [0, 0], [0, 0], [0, 0]];
        lamps.quad(p0, p2, p1, p3, [1, 1, 1], z4);                           // faces down
        // dark housing 2 cm above the diffuser, slightly larger (visible as a rim)
        const h0 = P(sl - 0.06, dd - 0.27, y + 0.02), h1 = P(sl + 1.56, dd - 0.27, y + 0.02), h2 = P(sl - 0.06, dd + 0.27, y + 0.02), h3 = P(sl + 1.56, dd + 0.27, y + 0.02);
        housings.quad(h0, h2, h1, h3, [1, 1, 1], z4);
      }
    }
    // portal frames at both ends: a concrete face from the wall planes / ceiling outwards
    for (const [sp, dir] of [[t0, 1], [t1, -1]]) {
      const ch = chunkOf(sp);
      const l = T.sample(T.barL, sp) + WALL_OFF - 0.02, r = -T.sample(T.barR, sp) - WALL_OFF + 0.02;
      const ring = [[l + 3, -3, l, -3], [l + 3, 9.5, l, TUN_H - 0.02], [r - 3, 9.5, r, TUN_H - 0.02], [r - 3, -3, r, -3]];
      const sp2 = sp - dir * 0.02;                // 2 cm outside the opening
      const pts = ring.map(([dO, yO, dI, yI]) => [P(sp2, dO, yO), P(sp2, dI, yI)]);
      // planar UVs in the plane of the portal (continuous across the triangles)
      const uvs = ring.map(([dO, yO, dI, yI]) => [[dO / 4, yO / 4], [dI / 4, yI / 4]]);
      for (let i = 0; i < 3; i++) {
        const [o0, i0] = pts[i], [o1, i1] = pts[i + 1];
        const [uo0, ui0] = uvs[i], [uo1, ui1] = uvs[i + 1];
        const col = [0.72, 0.7, 0.66];
        // facing out of the tunnel (towards the approaching / departing car)
        if (dir > 0) ch.shell.quad(o0, i0, o1, i1, col, [uo0, ui0, uo1, ui1]);
        else ch.shell.quad(i0, o0, i1, o1, col, [ui0, uo0, ui1, uo1]);
      }
    }
  }
  // tunnel roof: casts shadow so the car is not sunlit inside
  const tunnelShadow = [];

  // ---------------------------------------------------------------------------------------------
  // assemble chunk meshes
  for (let i = 0; i < nChunks; i++) {
    const ch = chunks[i];
    const add = (b, mat, opts = {}) => {
      if (b.empty) return null;
      const m = new THREE.Mesh(b.geometry(), mat);
      m.receiveShadow = opts.receive ?? false;
      m.castShadow = opts.cast ?? false;
      m.matrixAutoUpdate = false;
      m.name = opts.name || '';
      group.add(m);
      return m;
    };
    add(ch.ground, M.ground, { receive: true, name: 'ground' });
    add(ch.paint, M.paint, { receive: true, name: 'roadPaint' });
    add(ch.tground, M.tunnelGround, { name: 'tunnelGround' });
    add(ch.barrier, M.barrier, { receive: true, name: 'barriers' });
    add(ch.twall, M.tunnelWall, { name: 'tunnelWall' });
    add(ch.roof, M.tunnelRoof, { name: 'tunnelCeiling' });
    const shell = add(ch.shell, M.tunnelShell, { cast: true, receive: true, name: 'tunnelShell' });
    if (shell) tunnelShadow.push(shell);
    if (quality !== 'low') add(ch.fence, M.fence, { name: 'fence' });
  }
  if (!lamps.empty) { const lm = new THREE.Mesh(lamps.geometry(), M.lamp); lm.matrixAutoUpdate = false; lm.name = 'tunnelLamps'; group.add(lm); }
  if (!housings.empty) { const hm = new THREE.Mesh(housings.geometry(), M.lampHousing); hm.matrixAutoUpdate = false; group.add(hm); }

  // ---------------------------------------------------------------------------------------------
  // braking markers (150 / 100 / 50) on the outside fence before the heavy stops
  {
    const corners = ['ste-devote', 'mirabeau', 'hairpin', 'portier', 'chicane', 'rascasse', 'noghes', 'pool2', 'casino'];
    const g = new Builder();
    for (const id of corners) {
      const c = T.corners.find(cc => cc.id === id);
      const turnIn = c.s - (id === 'hairpin' ? 18 : id === 'chicane' ? 22 : 26);
      const side = c.side === 'R' ? 1 : -1;      // board on the outside of the corner
      [150, 100, 50].forEach((dist, i) => {
        // board above the barrier, perpendicular to the road, facing the approaching car
        const s = T.wrapS(turnIn - dist);
        const bar = side > 0 ? T.sample(T.barL, s) : -T.sample(T.barR, s);
        const outer = T.pointAt(s, bar), inner = T.pointAt(s, bar - side * 0.85);
        const y = T.heightAt(s, bar);
        const u0 = i * 170 / 512 + 0.008, u1 = (i * 170 + 170) / 512 - 0.008;
        const L0 = side > 0 ? outer : inner, R0 = side > 0 ? inner : outer;   // as seen by the driver
        const A = [L0.x, y + 1.15, L0.z], B = [R0.x, y + 1.15, R0.z], Cc = [L0.x, y + 2.45, L0.z], D = [R0.x, y + 2.45, R0.z];
        g.quad(A, B, Cc, D, [1, 1, 1], [[u0, 0.02], [u1, 0.02], [u0, 0.98], [u1, 0.98]]);
        // post
        const p0 = T.pointAt(s, bar - side * 0.42);
        const q0 = [p0.x - 0.05, y + 1.0, p0.z], q1 = [p0.x + 0.05, y + 1.0, p0.z], q2 = [p0.x - 0.05, y + 1.16, p0.z], q3 = [p0.x + 0.05, y + 1.16, p0.z];
        g.quad(q0, q1, q2, q3, [0.2, 0.2, 0.2], [[0.99, 0.99], [0.99, 0.99], [0.99, 0.99], [0.99, 0.99]]);
      });
    }
    const mm = new THREE.Mesh(g.geometry(), new THREE.MeshLambertMaterial({ map: tex.markers, side: THREE.DoubleSide }));
    mm.matrixAutoUpdate = false;
    group.add(mm);
  }

  // start gantry over the line
  {
    const hw = T.sample(T.halfW, 0) + 1.5;
    const pL = T.pointAt(-6, hw + 0.6), pR = T.pointAt(-6, -hw - 0.6), mid = T.pointAt(-6, 0);
    const k = T.idxOfS(0);
    const ang = Math.atan2(T.nx[k], T.nz[k]);
    const post = new THREE.BoxGeometry(0.4, 7.5, 0.4);
    for (const p of [pL, pR]) { const m = new THREE.Mesh(post, M.gantry); m.position.set(p.x, p.y + 3.75, p.z); m.castShadow = true; group.add(m); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * hw + 1.4, 0.9, 0.5), M.gantry);
    beam.position.set(mid.x, mid.y + 7.1, mid.z); beam.rotation.y = ang + Math.PI / 2; group.add(beam);
    for (let i = 0; i < 5; i++) {
      const lp = T.pointAt(-6.3, (i - 2) * 0.9);
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.16, 12), M.lightRed);
      l.position.set(lp.x, mid.y + 7.1, lp.z);
      const t = T.idxOfS(0); l.lookAt(lp.x - T.tx[t], mid.y + 7.1, lp.z - T.tz[t]);
      group.add(l);
    }
  }

  return { group, materials: M, textures: tex, tunnelShadow };
}

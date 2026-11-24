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
  red: [0.78, 0.1, 0.1], runoff: [0.40, 0.41, 0.43], walk: [0.70, 0.68, 0.64], walkEdge: [0.78, 0.76, 0.72],
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

export function buildTrackMeshes(T, { racingLine = null, quality = 'high' } = {}) {
  const group = new THREE.Group(); group.name = 'track';
  const tex = {
    asphalt: TX.asphalt(quality === 'low' ? 256 : 512), armco: TX.armco(), ads: TX.adWall(), tecpro: TX.tecpro(),
    fence: TX.fence(), concrete: TX.concrete(), markers: TX.markerBoards(), barrier: TX.barrierAtlas(),
  };
  const M = {
    ground: new THREE.MeshLambertMaterial({ map: tex.asphalt, vertexColors: true }),
    tunnelGround: new THREE.MeshBasicMaterial({ map: tex.asphalt, vertexColors: true }),
    barrier: new THREE.MeshLambertMaterial({ map: tex.barrier, vertexColors: true }),
    tunnelWall: new THREE.MeshBasicMaterial({ map: tex.ads, vertexColors: true }),
    tunnelRoof: new THREE.MeshBasicMaterial({ map: tex.concrete, vertexColors: true, side: THREE.DoubleSide }),
    fence: new THREE.MeshLambertMaterial({ map: tex.fence, alphaTest: 0.3, alphaToCoverage: true, side: THREE.DoubleSide, transparent: false }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xfff3d6 }),
    markers: new THREE.MeshLambertMaterial({ map: tex.markers, emissive: 0x111111 }),
    gantry: new THREE.MeshLambertMaterial({ color: 0x23262b }),
    lightRed: new THREE.MeshBasicMaterial({ color: 0x401010 }),
  };
  const N = T.N, L = T.L;
  const nChunks = Math.ceil(L / CHUNK);
  const chunks = [];
  for (let i = 0; i < nChunks; i++) chunks.push({ ground: new Builder(), tground: new Builder(), barrier: new Builder(), twall: new Builder(), roof: new Builder(), fence: new Builder() });
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
    const walkL = 4.5, walkR = pitZone(s) ? 13.0 : 4.5;
    return { k, hw, cl, cr, bl, br, walkL, walkR };
  };

  for (let r = 0; r < rows.length; r++) {
    const s0 = rows[r], s1 = r + 1 < rows.length ? rows[r + 1] : L;
    const A = sectionFor(s0), B = sectionFor(s1 % L);
    const inTun = T.inTunnel((s0 + s1) / 2);
    const ch = chunkOf(s0);
    const G = inTun ? ch.tground : ch.ground;
    // tunnel lamp pools every 6 m
    const lampF = (s) => inTun ? 0.22 + 0.55 * Math.pow(Math.max(0, Math.cos((s % 6) / 6 * Math.PI * 2)), 4) : 1;
    const fa = lampF(s0), fb = lampF(s1);
    const uvq = (d0, d1) => [[d0 / 3, s0 / 3], [d1 / 3, s0 / 3], [d0 / 3, s1 / 3], [d1 / 3, s1 / 3]];
    const band = (d0a, d1a, d0b, d1b, col, dy0 = 0, dy1 = 0, colB = null) => {
      const a = P(s0, d0a, dy0), b = P(s0, d1a, dy1), c = P(s1, d0b, dy0), d = P(s1, d1b, dy1);
      G.quad(a, b, c, d, mul(col, fa), uvq(d0a, d1a), mul(colB || col, fb));
    };
    // road surface: split at the racing line so the rubbered line is darker
    const lineD0 = rl ? rl.d[T.idxOfS(s0)] : 0, lineD1 = rl ? rl.d[T.idxOfS(s1)] : 0;
    const roadCuts = (S) => {
      const ld = S === A ? lineD0 : lineD1;
      const pts = [S.hw, S.hw - 0.12, Math.min(S.hw - 0.2, ld + 1.1), Math.min(S.hw - 0.25, ld + 0.45), Math.max(-S.hw + 0.25, ld - 0.45), Math.max(-S.hw + 0.2, ld - 1.1), -S.hw + 0.12, -S.hw];
      for (let i = 1; i < pts.length; i++) pts[i] = Math.min(pts[i], pts[i - 1]);
      return pts;
    };
    const ra = roadCuts(A), rb = roadCuts(B);
    const roadCols = [C.white, C.asphalt, mul(C.asphalt, 0.85), C.rubber, mul(C.asphalt, 0.85), C.asphalt, C.white];
    for (let i = 0; i < 7; i++) band(ra[i], ra[i + 1], rb[i], rb[i + 1], roadCols[i]);
    // kerbs: red/white 1 m stripes, slightly raised in the middle
    const stripe = (Math.floor(s0) % 2) ? C.red : C.white;
    if (A.cl > 0.05 || B.cl > 0.05) band(A.hw + A.cl, A.hw, B.hw + B.cl, B.hw, stripe, 0.0, 0.0);
    if (A.cr > 0.05 || B.cr > 0.05) band(-A.hw, -A.hw - A.cr, -B.hw, -B.hw - B.cr, stripe, 0.0, 0.0);
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
    }
  }

  // start/finish line + grid boxes
  {
    const ch = chunkOf(0);
    const hw = T.sample(T.halfW, 0);
    const G = ch.ground;
    const sq = 0.5;
    for (let i = 0; i < Math.round(2 * hw / sq); i++) {
      const d0 = hw - i * sq, d1 = d0 - sq;
      for (let j = 0; j < 2; j++) {
        const col = (i + j) % 2 ? [0.05, 0.05, 0.05] : C.white;
        const sA = -0.6 + j * 0.6, sB = sA + 0.6;
        const a = P(sA, d0, 0.004), b = P(sA, d1, 0.004), c = P(sB, d0, 0.004), d = P(sB, d1, 0.004);
        G.quad(a, b, c, d, col, [[0, 0], [0, 0], [0, 0], [0, 0]]);
      }
    }
    // grid slots (staggered) behind the line
    for (let g = 0; g < 10; g++) {
      const sg = -8 - g * 8, dd = g % 2 ? -2.4 : 2.4;
      const s = T.wrapS(sg);
      const G2 = chunkOf(s).ground;
      const a = P(s, dd + 1.0, 0.004), b = P(s, dd - 1.0, 0.004), c = P(s + 0.25, dd + 1.0, 0.004), d = P(s + 0.25, dd - 1.0, 0.004);
      G2.quad(a, b, c, d, C.white, [[0, 0], [0, 0], [0, 0], [0, 0]]);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Barriers (+ fences) per side
  const BAR_H = 1.05, FENCE_H = 3.6;
  for (const side of [1, -1]) {
    for (let s0 = 0; s0 < L; s0 += 1) {
      const s1 = s0 + 1;
      const typ = barrierType(T, s0 + 0.5, side);
      const ch = chunkOf(s0);
      const off = (s) => side > 0 ? T.sample(T.barL, s) : -T.sample(T.barR, s);
      const o0 = off(s0), o1 = off(s1);
      const y0a = T.heightAt(s0, o0), y0b = T.heightAt(s1, o1);
      const pa = T.pointAt(s0, o0), pb = T.pointAt(s1, o1);
      const backA = T.pointAt(s0, o0 + side * 0.3), backB = T.pointAt(s1, o1 + side * 0.3);
      if (typ === 'tunnel') {
        // tunnel walls (lit by lamps), full height to the roof
        const H = 5.6;
        const f = (s) => 0.35 + 0.5 * Math.pow(Math.max(0, Math.cos((s % 6) / 6 * Math.PI * 2)), 3);
        const W = ch.twall;
        const a = [pa.x, y0a, pa.z], b = [pa.x, y0a + 1.3, pa.z], c = [pb.x, y0b, pb.z], d = [pb.x, y0b + 1.3, pb.z];
        // right-hand walls are seen with the lap running right-to-left: flip u so text reads
        const fu = side > 0 ? 1 : -1;
        const uv = [[fu * s0 / 4, 0], [fu * s0 / 4, 1], [fu * s1 / 4, 0], [fu * s1 / 4, 1]];
        if (side > 0) W.quad(b, a, d, c, mul([1, 1, 1], f(s0)), [uv[1], uv[0], uv[3], uv[2]], mul([1, 1, 1], f(s1)));
        else W.quad(a, b, c, d, mul([1, 1, 1], f(s0)), uv, mul([1, 1, 1], f(s1)));
        const a2 = [pa.x, y0a + 1.3, pa.z], b2 = [pa.x, y0a + H, pa.z], c2 = [pb.x, y0b + 1.3, pb.z], d2 = [pb.x, y0b + H, pb.z];
        const cw = mul([0.86, 0.85, 0.82], 1), uw = [[0.01, 0.01], [0.01, 0.01], [0.01, 0.01], [0.01, 0.01]];
        if (side > 0) ch.roof.quad(b2, a2, d2, c2, mul(cw, f(s0) * 0.9), uw, mul(cw, f(s1) * 0.9));
        else ch.roof.quad(a2, b2, c2, d2, mul(cw, f(s0) * 0.9), uw, mul(cw, f(s1) * 0.9));
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

  // tunnel roof with lamp strips
  const lamps = new Builder();
  {
    const [t0, t1] = T.tunnelS;
    const len = T.deltaS(t0, t1);
    for (let q = -6; q < len + 6; q += 2) {
      const s0 = T.wrapS(t0 + q), s1 = T.wrapS(t0 + q + 2);
      const ch = chunkOf(s0);
      const H = 5.6;
      const l0 = T.sample(T.barL, s0), r0 = -T.sample(T.barR, s0), l1 = T.sample(T.barL, s1), r1 = -T.sample(T.barR, s1);
      const steps = 6;
      for (let i = 0; i < steps; i++) {
        const fA = i / steps, fB = (i + 1) / steps;
        const arch = (f) => 0.45 * Math.sin(f * Math.PI);
        const dA0 = l0 + (r0 - l0) * fA, dB0 = l0 + (r0 - l0) * fB, dA1 = l1 + (r1 - l1) * fA, dB1 = l1 + (r1 - l1) * fB;
        const a = P(s0, dA0, H + arch(fA)), b = P(s0, dB0, H + arch(fB)), c = P(s1, dA1, H + arch(fA)), d = P(s1, dB1, H + arch(fB));
        const col = [0.32, 0.31, 0.3];
        ch.roof.quad(a, b, c, d, col, [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]]);
      }
      // two lamp lines every 6 m
      if (Math.round(q) % 6 === 0 && q >= 0 && q <= len) {
        for (const dd of [-1.6, 1.6]) {
          const p0 = P(s0, dd, H + 0.35), p1 = P(s0 + 1.6, dd, H + 0.35), p2 = P(s0, dd + 0.25, H + 0.35), p3 = P(s0 + 1.6, dd + 0.25, H + 0.35);
          lamps.quad(p0, p2, p1, p3, [1, 1, 1], [[0, 0], [0, 0], [0, 0], [0, 0]]);
        }
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
    add(ch.tground, M.tunnelGround, { name: 'tunnelGround' });
    add(ch.barrier, M.barrier, { receive: true, name: 'barriers' });
    add(ch.twall, M.tunnelWall);
    const roof = add(ch.roof, M.tunnelRoof, { cast: true, name: 'tunnelRoof' });
    if (roof) tunnelShadow.push(roof);
    if (quality !== 'low') add(ch.fence, M.fence, { name: 'fence' });
  }
  if (!lamps.empty) { const lm = new THREE.Mesh(lamps.geometry(), M.lamp); lm.matrixAutoUpdate = false; group.add(lm); }

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

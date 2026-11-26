// Baked sun / shade from Monaco's buildings and hillside (the sun is fixed: an afternoon from
// the south-west). At load time, a ray from each road / kerb / barrier / fence vertex towards
// the sun is marched against the building prisms (spatial hash) and the terrain; vertices in
// shade keep only the sky's share of their light (vertex colour), so the streets show the hard
// geometry of the shadows between the buildings at every distance - not only next to the car.
// The same test along the lap gives a shade table for the car: driving into a building's
// shadow, only the car's sunlight fades (lighting.js CAR_SUN), the sun-lit facades stay lit.
import * as THREE from 'three';

export function buildShade(T, buildings, groundAt, sunDir, { cell = 32 } = {}) {
  // building prisms (oriented boxes, bottom / top heights)
  const P = buildings.map((b) => {
    const ca = Math.cos(b.ang), sa = Math.sin(b.ang);
    return { cx: b.cx, cz: b.cz, ux: sa, uz: ca, vx: ca, vz: -sa, hw: b.w / 2 + 0.3, hd: b.dpt / 2 + 0.3, y0: b.baseY, y1: b.baseY + b.h + 1.0, r: Math.hypot(b.w, b.dpt) / 2 + 0.5 };
  });
  const grid = new Map();
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    for (let gx = Math.floor((p.cx - p.r) / cell); gx <= Math.floor((p.cx + p.r) / cell); gx++)
      for (let gz = Math.floor((p.cz - p.r) / cell); gz <= Math.floor((p.cz + p.r) / cell); gz++) {
        const k = gx + ',' + gz; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
      }
  }
  const sd = sunDir.clone().normalize();
  const inside = (p, x, y, z) => {
    if (y < p.y0 || y > p.y1) return false;
    const dx = x - p.cx, dz = z - p.cz;
    return Math.abs(dx * p.ux + dz * p.uz) <= p.hw && Math.abs(dx * p.vx + dz * p.vz) <= p.hd;
  };
  // 0 = sun-lit, 1 = in shade
  const shadeAt = (x, y, z) => {
    for (let t = 1.0; t < 230; t += t < 40 ? 1.2 : 2.5) {
      const px = x + sd.x * t, py = y + sd.y * t, pz = z + sd.z * t;
      const list = grid.get(Math.floor(px / cell) + ',' + Math.floor(pz / cell));
      if (list) for (const i of list) if (inside(P[i], px, py, pz)) return 1;
      if (t > 6 && groundAt(px, pz) > py + 0.5) return 1;      // hillside / the Rock
      if (py > 260) break;
    }
    return 0;
  };
  return { shadeAt, sunDir: sd };
}

// darken the vertex colours of shaded vertices on the given meshes (non-indexed or indexed)
export function bakeShadeIntoMeshes(meshes, shadeAt, { shadeF = 0.36, lift = 0.15 } = {}) {
  const cache = new Map();
  let n = 0, shaded = 0;
  for (const m of meshes) {
    const g = m.geometry, p = g.attributes.position, c = g.attributes.color;
    if (!p || !c) continue;
    m.updateMatrixWorld();
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      const key = Math.round(v.x * 2) + ',' + Math.round(v.z * 2) + ',' + Math.round(v.y);
      let sh = cache.get(key);
      if (sh === undefined) { sh = shadeAt(v.x, v.y + lift, v.z); cache.set(key, sh); }
      n++;
      if (sh > 0) { shaded++; const f = 1 - (1 - shadeF) * sh; c.setXYZ(i, c.getX(i) * f, c.getY(i) * f, c.getZ(i) * f); }
    }
    c.needsUpdate = true;
  }
  return { n, shaded };
}

// shade along the lap at the car's height: rows every `ds` metres of lap distance, columns
// across the road at d = -7.5 .. 7.5 m
export function carShadeTable(T, shadeAt, { ds = 2, cols = [-7.5, -3.75, 0, 3.75, 7.5], h = 0.75 } = {}) {
  const ns = Math.ceil(T.L / ds), nc = cols.length;
  const tab = new Float32Array(ns * nc);
  for (let i = 0; i < ns; i++) {
    const s = i * ds;
    for (let j = 0; j < nc; j++) {
      if (T.inTunnel(s)) { tab[i * nc + j] = 0; continue; }       // the tunnel has its own lighting
      const p = T.pointAt(s, cols[j]);
      tab[i * nc + j] = shadeAt(p.x, T.heightAt(s, cols[j]) + h, p.z);
    }
  }
  // lookup with bilinear interpolation (s wraps)
  const at = (s, d) => {
    const fs = ((s % T.L) + T.L) % T.L / ds, i0 = Math.floor(fs) % ns, i1 = (i0 + 1) % ns, ts = fs - Math.floor(fs);
    const fd = Math.max(0, Math.min(nc - 1 - 1e-6, (d - cols[0]) / (cols[1] - cols[0]))), j0 = Math.floor(fd), td = fd - j0;
    const v = (i, j) => tab[i * nc + j];
    return (v(i0, j0) * (1 - td) + v(i0, j0 + 1) * td) * (1 - ts) + (v(i1, j0) * (1 - td) + v(i1, j0 + 1) * td) * ts;
  };
  return { tab, at };
}

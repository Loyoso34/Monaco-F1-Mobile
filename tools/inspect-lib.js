// Automated circuit inspection, run inside the page against the live scene (tools/inspect-circuit.mjs).
// Everything is checked against the track exclusion corridor (js/corridor.js) and the actual
// rendered geometry (world-space triangles), so what is tested is what the player sees.
//
//  1. raster     every point 1 m inside the barriers of every section is marked as circuit
//  2. track      no barrier line of one section lies on the road / run-off of another section
//  3. terrain    the terrain mesh stays below the road, run-off and pavement surfaces everywhere
//  4. objects    no scenery triangle (buildings, landmarks, hotel, stands, garages, yachts, palms)
//                enters the drivable volume (inside the barriers, up to 5 m above the road)
//  5. pavement   no building triangle stands on a pavement (between barrier and pavement edge)
//  6. footprints no two building / landmark footprints overlap
//  7. bases      no building floats: its base is below the terrain mesh along its whole perimeter
export function inspectCircuit(app, { headroom = 5.0, sample = 0.5, byCorner = false } = {}) {
  const T = app.track, C = app.sc.corridor, THREE = app.THREE;
  const report = {};
  // optional per-corner tally of violations (nearest corner of the nearest section)
  const tally = { terrain: {}, objects: {}, pavement: {} };
  const count = (kind, x, z, worst = 0) => {
    if (!byCorner) return;
    const id = T.cornerNear(T.project(x, z, null, {}).s).id;
    const e = tally[kind][id] || (tally[kind][id] = { n: 0, worst: 0 });
    e.n++; e.worst = Math.max(e.worst, worst);
  };
  const cellOf = (x, z) => {
    const i = Math.floor((x - C.x0) / C.cell), j = Math.floor((z - C.z0) / C.cell);
    return i < 0 || j < 0 || i >= C.nx || j >= C.nz ? -1 : j * C.nx + i;
  };
  const tmp = {};
  const where = (x, z) => {
    const pr = T.project(x, z, null, tmp);
    const c = T.cornerNear(pr.s);
    return { s: +pr.s.toFixed(1), d: +pr.d.toFixed(1), near: c.id, x: +x.toFixed(1), z: +z.toFixed(1) };
  };

  // 1. raster completeness ----------------------------------------------------------------------
  {
    let n = 0, holes = 0; const list = [];
    for (let s = 0; s < T.L; s += 0.5) {
      const bl = T.sample(T.barL, s), br = T.sample(T.barR, s);
      for (let d = -br + 1; d <= bl - 1; d += 0.5) {
        const p = T.pointAt(s, d); const c = cellOf(p.x, p.z); n++;
        if (c < 0 || C.clearBar[c] >= 0) { holes++; if (list.length < 8) list.push({ s, d: +d.toFixed(1) }); }
      }
    }
    report.raster = { points: n, holes, examples: list };
  }

  // 2. track self-consistency -------------------------------------------------------------------
  {
    let n = 0, bad = 0; const list = [];
    for (let s = 0; s < T.L; s += 1) {
      for (const side of [1, -1]) {
        const bar = side > 0 ? T.sample(T.barL, s) : T.sample(T.barR, s);
        const p = T.pointAt(s, side * bar); n++;
        const pr = T.project(p.x, p.z, null, tmp);
        if (!pr.ok || Math.abs(T.deltaS(pr.s, s)) < 40) continue;
        const ob = pr.d > 0 ? T.sample(T.barL, pr.s) : T.sample(T.barR, pr.s);
        if (Math.abs(pr.d) < ob - 0.05) { bad++; if (list.length < 8) list.push({ s, side, onS: +pr.s.toFixed(1), d: +pr.d.toFixed(2) }); }
      }
    }
    report.track = { barrierPoints: n, onOtherSection: bad, examples: list };
  }

  // helpers over world-space triangles -----------------------------------------------------------
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
  const eachTriangle = (mesh, fn) => {
    mesh.updateMatrixWorld(true);
    const g = mesh.geometry, pos = g.attributes.position, idx = g.index;
    const nTri = (idx ? idx.count : pos.count) / 3;
    const mats = [];
    if (mesh.isInstancedMesh) {
      for (let i = 0; i < mesh.count; i++) { const m = new THREE.Matrix4(); mesh.getMatrixAt(i, m); mats.push(m.premultiply(mesh.matrixWorld)); }
    } else mats.push(mesh.matrixWorld);
    for (const m of mats) {
      for (let t = 0; t < nTri; t++) {
        const ia = idx ? idx.getX(3 * t) : 3 * t, ib = idx ? idx.getX(3 * t + 1) : 3 * t + 1, ic = idx ? idx.getX(3 * t + 2) : 3 * t + 2;
        vA.fromBufferAttribute(pos, ia).applyMatrix4(m); vB.fromBufferAttribute(pos, ib).applyMatrix4(m); vC.fromBufferAttribute(pos, ic).applyMatrix4(m);
        fn(vA, vB, vC);
      }
    }
  };
  // min clearance over the cells of an axis-aligned box
  const boxMin = (arr, x0, z0, x1, z1) => {
    const i0 = Math.max(0, Math.floor((x0 - C.x0) / C.cell)), i1 = Math.min(C.nx - 1, Math.floor((x1 - C.x0) / C.cell));
    const j0 = Math.max(0, Math.floor((z0 - C.z0) / C.cell)), j1 = Math.min(C.nz - 1, Math.floor((z1 - C.z0) / C.cell));
    let m = C.BIG;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const v = arr[j * C.nx + i]; if (v < m) m = v; }
    return m / 10;
  };

  // 3. terrain ----------------------------------------------------------------------------------
  const terrain = app.sc.root.getObjectByName('terrain');
  // terrain surface height lookup (mesh, not the analytic function): triangles per grid square
  const terr = { tris: [], step: app.sc.terrainStep, x0: Infinity, z0: Infinity, sq: new Map() };
  {
    let n = 0, cells = 0, worst = 0, pens = 0; const list = [];
    eachTriangle(terrain, (a, b, c) => {
      const tri = [a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z];
      terr.tris.push(tri);
      terr.x0 = Math.min(terr.x0, a.x, b.x, c.x); terr.z0 = Math.min(terr.z0, a.z, b.z, c.z);
      n++;
      const x0 = Math.min(a.x, b.x, c.x), x1 = Math.max(a.x, b.x, c.x), z0 = Math.min(a.z, b.z, c.z), z1 = Math.max(a.z, b.z, c.z);
      if (x1 < C.x0 || z1 < C.z0 || x0 > C.x0 + C.nx * C.cell || z0 > C.z0 + C.nz * C.cell) return;
      const i0 = Math.max(0, Math.floor((x0 - C.x0) / C.cell)), i1 = Math.min(C.nx - 1, Math.floor((x1 - C.x0) / C.cell));
      const j0 = Math.max(0, Math.floor((z0 - C.z0) / C.cell)), j1 = Math.min(C.nz - 1, Math.floor((z1 - C.z0) / C.cell));
      const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const cc = j * C.nx + i, ry = C.roadY[cc];
        if (!isFinite(ry)) continue;
        // test the four corners of the cell (the road surface is defined over the whole cell)
        for (const [ox, oz] of [[0.05, 0.05], [0.95, 0.05], [0.05, 0.95], [0.95, 0.95], [0.5, 0.5]]) {
          const x = C.x0 + (i + ox) * C.cell, z = C.z0 + (j + oz) * C.cell;
          const l1 = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det;
          const l2 = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
          const y = l1 * a.y + l2 * b.y + l3 * c.y;
          cells++;
          const pen = y - (ry - 0.05);
          if (pen > 0) { pens++; worst = Math.max(worst, pen); count('terrain', x, z, pen); if (list.length < 12) list.push({ ...where(x, z), above: +pen.toFixed(2) }); }
        }
      }
    });
    report.terrain = { triangles: n, samplesUnderCircuit: cells, penetrations: pens, worstAboveRoad: +worst.toFixed(3), examples: list };
  }
  const terrainMeshH = (() => {
    // bucket triangles by grid square
    const st = terr.step;
    for (let t = 0; t < terr.tris.length; t++) {
      const q = terr.tris[t];
      const cx = (q[0] + q[3] + q[6]) / 3, cz = (q[2] + q[5] + q[8]) / 3;
      const key = Math.floor((cx - terr.x0) / st) + ',' + Math.floor((cz - terr.z0) / st);
      (terr.sq.get(key) || terr.sq.set(key, []).get(key)).push(t);
    }
    return (x, z) => {
      const key = Math.floor((x - terr.x0) / st) + ',' + Math.floor((z - terr.z0) / st);
      for (const t of terr.sq.get(key) || []) {
        const q = terr.tris[t];
        const det = (q[5] - q[8]) * (q[0] - q[6]) + (q[6] - q[3]) * (q[2] - q[8]);
        const l1 = ((q[5] - q[8]) * (x - q[6]) + (q[6] - q[3]) * (z - q[8])) / det;
        const l2 = ((q[8] - q[2]) * (x - q[6]) + (q[0] - q[6]) * (z - q[8])) / det;
        const l3 = 1 - l1 - l2;
        if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) return l1 * q[1] + l2 * q[4] + l3 * q[7];
      }
      return null;
    };
  })();

  // exact test: inside the barrier lines of the section owning the cell or of the nearest one
  const pr2 = {};
  const insideBarriers = (x, z, cc) => {
    for (const hint of [C.sIdx[cc] >= 0 ? C.sIdx[cc] * T.ds : null, null]) {
      const pr = T.project(x, z, hint, pr2);
      if (!pr.ok) continue;
      const bar = pr.d > 0 ? T.sample(T.barL, pr.s) : T.sample(T.barR, pr.s);
      if (Math.abs(pr.d) < bar) return true;
    }
    return false;
  };
  // 4 + 5. scenery objects ------------------------------------------------------------------------
  {
    const skip = new Set(['sky', 'water', 'terrain', 'mountains']);
    const groups = {};
    const hard = [], pave = [];
    let nHard = 0, nPave = 0;
    let tris = 0, tested = 0, points = 0;
    app.sc.root.traverse((o) => {
      if (!o.isMesh || skip.has(o.name)) return;
      const kind = o.name || 'mesh';
      const isBuilding = kind === 'buildings';
      groups[kind] = (groups[kind] || 0) + 1;
      eachTriangle(o, (a, b, c) => {
        tris++;
        const x0 = Math.min(a.x, b.x, c.x), x1 = Math.max(a.x, b.x, c.x), z0 = Math.min(a.z, b.z, c.z), z1 = Math.max(a.z, b.z, c.z);
        if (x1 < C.x0 || z1 < C.z0 || x0 > C.x0 + C.nx * C.cell || z0 > C.z0 + C.nz * C.cell) return;
        const mb = boxMin(C.clearBar, x0, z0, x1, z1);
        const mw = isBuilding ? boxMin(C.clearWalk, x0, z0, x1, z1) : 99;
        if (mb >= 0.3 && mw >= 0) return;
        tested++;
        const e = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
        const n = Math.max(1, Math.ceil(e / sample));
        for (let i = 0; i <= n; i++) for (let j = 0; i + j <= n; j++) {
          const u = i / n, v = j / n, w = 1 - u - v;
          const x = a.x * w + b.x * u + c.x * v, y = a.y * w + b.y * u + c.y * v, z = a.z * w + b.z * u + c.z * v;
          const cc = cellOf(x, z); if (cc < 0) continue;
          points++;
          const cb = C.clearBar[cc] / 10, ry = C.roadY[cc];
          // visible above the road surface and below the headroom, inside the barrier lines
          // (raster cells straddling a barrier are resolved exactly against the sections)
          if (cb < 0 && isFinite(ry) && y < ry + headroom && y > ry - 0.02 && insideBarriers(x, z, cc)) {
            nHard++; count('objects', x, z, y - ry);
            if (hard.length < 12) hard.push({ kind, ...where(x, z), y: +(y - ry).toFixed(2) });
          }
          if (isBuilding) {
            const cw = C.clearWalk[cc] / 10;
            if (cw < -0.05 && isFinite(ry) && y < ry + 4 && y > ry - 3) {
              nPave++; count('pavement', x, z, y - ry);
              if (pave.length < 12) pave.push({ kind, ...where(x, z), y: +(y - ry).toFixed(2) });
            }
          }
        }
      });
    });
    report.objects = { meshes: groups, triangles: tris, nearCircuit: tested, samplePoints: points, inDrivableVolume: nHard, examples: hard };
    report.pavement = { buildingPointsOnPavement: nPave, examples: pave };
  }

  // 6. footprint overlaps ---------------------------------------------------------------------------
  {
    const F = app.sc.footprints || [];
    const ov = (A, B) => {
      const dx = B.x - A.x, dz = B.z - A.z;
      if (Math.hypot(dx, dz) > A.r + B.r) return false;
      for (const o of [A, B]) {
        const ux = Math.sin(o.a), uz = Math.cos(o.a);
        for (const [ax, az] of [[ux, uz], [uz, -ux]]) {
          const ra = A.hw * Math.abs(Math.sin(A.a) * ax + Math.cos(A.a) * az) + A.hd * Math.abs(Math.cos(A.a) * ax - Math.sin(A.a) * az);
          const rb = B.hw * Math.abs(Math.sin(B.a) * ax + Math.cos(B.a) * az) + B.hd * Math.abs(Math.cos(B.a) * ax - Math.sin(B.a) * az);
          if (Math.abs(dx * ax + dz * az) > ra + rb - 0.05) return false;
        }
      }
      return true;
    };
    let pairs = 0; const list = [];
    for (let i = 0; i < F.length; i++) for (let j = i + 1; j < F.length; j++) {
      if (F[i].kind === F[j].kind && (F[i].kind === 'fairmont' || F[i].kind === 'grandstand')) continue;   // one structure in segments
      if (ov(F[i], F[j])) { pairs++; if (list.length < 8) list.push([F[i].kind, F[j].kind, where(F[i].x, F[i].z)]); }
    }
    report.footprints = { count: F.length, overlappingPairs: pairs, examples: list };
  }

  // 7. building bases ---------------------------------------------------------------------------------
  {
    const B = app.sc.buildings || [];
    let floating = 0, worst = 0; const list = [];
    for (const b of B) {
      const ca = Math.cos(b.ang), sa = Math.sin(b.ang);
      const per = 2 * (b.w + b.dpt), n = Math.max(8, Math.ceil(per / 2));
      for (let k = 0; k < n; k++) {
        const t = k / n * 4, e = Math.floor(t), f = t - e;
        const [a1, b1] = [[-0.5 + f, -0.5], [0.5, -0.5 + f], [0.5 - f, 0.5], [-0.5, 0.5 - f]][e];
        const x = b.cx + sa * a1 * b.w + ca * b1 * b.dpt, z = b.cz + ca * a1 * b.w - sa * b1 * b.dpt;
        const h = terrainMeshH(x, z);
        if (h === null) continue;
        const gap = b.baseY - h;
        if (gap > 0.02) { floating++; worst = Math.max(worst, gap); if (list.length < 8) list.push({ ...where(x, z), gap: +gap.toFixed(2) }); break; }
      }
    }
    report.bases = { buildings: B.length, floating, worstGap: +worst.toFixed(2), examples: list };
  }

  if (byCorner) report.byCorner = tally;
  report.pass = report.raster.holes === 0 && report.track.onOtherSection === 0 && report.terrain.penetrations === 0
    && report.objects.inDrivableVolume === 0 && report.pavement.buildingPointsOnPavement === 0
    && report.footprints.overlappingPairs === 0 && report.bases.floating === 0;
  return report;
}

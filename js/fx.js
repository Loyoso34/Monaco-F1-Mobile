// Visual effects: detached car parts and carbon fragments as simple rigid debris, scrape
// sparks, and plank sparks over bumps at speed. Debris count scales with impact severity and
// the graphics quality.
import * as THREE from 'three';

export class Fx {
  constructor(scene, track, { quality = 'high' } = {}) {
    this.scene = scene; this.T = track;
    this.maxDebris = quality === 'low' ? 14 : quality === 'medium' ? 26 : 40;
    this.debris = [];
    this.fragGeo = [new THREE.BoxGeometry(0.12, 0.012, 0.08), new THREE.BoxGeometry(0.2, 0.01, 0.05), new THREE.BoxGeometry(0.06, 0.02, 0.06)];
    this.fragMat = new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.4, metalness: 0.2 });
    this.fragMat2 = new THREE.MeshStandardMaterial({ color: 0x16213f, roughness: 0.5 });
    // sparks: a pooled points cloud
    this.nSpark = quality === 'low' ? 60 : 160;
    const g = new THREE.BufferGeometry();
    this.sparkPos = new Float32Array(this.nSpark * 3);
    this.sparkVel = new Float32Array(this.nSpark * 3);
    this.sparkLife = new Float32Array(this.nSpark);
    g.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparks = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffc46b, size: 0.06, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.sparks.frustumCulled = false;
    scene.add(this.sparks);
    this.sparkIdx = 0;
    for (let i = 0; i < this.nSpark; i++) this.sparkPos[i * 3 + 1] = -1000;
  }

  // pieces: meshes (already positioned in world space) from carmodel.detach*
  addPieces(pieces, vel, severity) {
    for (const m of pieces) {
      this.scene.add(m);
      this._add(m, vel, severity, true);
    }
  }
  fragments(x, y, z, vel, severity) {
    const n = Math.min(12, Math.round(2 + severity * 10));
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.fragGeo[i % 3], i % 3 ? this.fragMat : this.fragMat2);
      m.position.set(x + (Math.random() - 0.5) * 0.4, y + Math.random() * 0.3, z + (Math.random() - 0.5) * 0.4);
      m.castShadow = false;
      this.scene.add(m);
      this._add(m, vel, severity, false);
    }
  }
  _add(m, vel, severity, big) {
    const spread = 2 + severity * 5;
    const d = {
      m, big,
      v: new THREE.Vector3(vel.x * (0.55 + Math.random() * 0.3) + (Math.random() - 0.5) * spread, 0.5 + Math.random() * (1 + severity * 3), vel.z * (0.55 + Math.random() * 0.3) + (Math.random() - 0.5) * spread),
      w: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12),
      rest: 0, age: 0,
    };
    this.debris.push(d);
    while (this.debris.length > this.maxDebris) {
      const old = this.debris.shift();
      this.scene.remove(old.m);
    }
  }
  sparksAt(x, y, z, vx, vz, n = 6) {
    for (let i = 0; i < n; i++) {
      const k = this.sparkIdx++ % this.nSpark;
      this.sparkPos[k * 3] = x; this.sparkPos[k * 3 + 1] = y; this.sparkPos[k * 3 + 2] = z;
      this.sparkVel[k * 3] = vx * 0.7 + (Math.random() - 0.5) * 6;
      this.sparkVel[k * 3 + 1] = Math.random() * 3;
      this.sparkVel[k * 3 + 2] = vz * 0.7 + (Math.random() - 0.5) * 6;
      this.sparkLife[k] = 0.25 + Math.random() * 0.35;
    }
  }
  clear() {
    for (const d of this.debris) this.scene.remove(d.m);
    this.debris.length = 0;
    for (let i = 0; i < this.nSpark; i++) { this.sparkLife[i] = 0; this.sparkPos[i * 3 + 1] = -1000; }
  }

  update(dt) {
    const T = this.T, tmp = {};
    for (const d of this.debris) {
      if (d.rest > 1.5) continue;
      d.age += dt;
      d.v.y -= 9.81 * dt;
      d.m.position.addScaledVector(d.v, dt);
      d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt; d.m.rotation.z += d.w.z * dt;
      const pr = T.project(d.m.position.x, d.m.position.z, null, tmp);
      const gy = (pr.ok && Math.abs(pr.d) < 40 ? T.heightAt(pr.s, pr.d) : 0) + 0.02;
      if (d.m.position.y < gy) {
        d.m.position.y = gy;
        d.v.y = Math.abs(d.v.y) * 0.25;
        d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.6);
        if (d.v.lengthSq() < 0.05) d.rest += dt;
      }
      // keep pieces on the circuit side of the barriers
      if (pr.ok) {
        const bar = pr.d > 0 ? T.sample(T.barL, pr.s) : T.sample(T.barR, pr.s);
        if (Math.abs(pr.d) > bar - 0.1) {
          const n = pr.d > 0 ? -1 : 1, k = T.idxOfS(pr.s);
          d.m.position.x += T.nx[k] * n * (Math.abs(pr.d) - bar + 0.1);
          d.m.position.z += T.nz[k] * n * (Math.abs(pr.d) - bar + 0.1);
          const vn = d.v.x * T.nx[k] + d.v.z * T.nz[k];
          d.v.x -= 1.5 * vn * T.nx[k]; d.v.z -= 1.5 * vn * T.nz[k];
        }
      }
    }
    let any = false;
    for (let i = 0; i < this.nSpark; i++) {
      if (this.sparkLife[i] <= 0) continue;
      any = true;
      this.sparkLife[i] -= dt;
      this.sparkVel[i * 3 + 1] -= 9.81 * dt;
      this.sparkPos[i * 3] += this.sparkVel[i * 3] * dt;
      this.sparkPos[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
      this.sparkPos[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
      if (this.sparkLife[i] <= 0) this.sparkPos[i * 3 + 1] = -1000;
    }
    if (any || this._wasAny) this.sparks.geometry.attributes.position.needsUpdate = true;
    this._wasAny = any;
  }
}

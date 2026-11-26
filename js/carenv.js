// Live reflections for the car: a small cube map rendered from the car's position (the car
// itself hidden), PMREM-filtered and used as the environment of the car's own materials only.
// As the car runs beside a sun-lit facade, past the harbour or into the tunnel, its panels
// reflect those surroundings and the reflections slide across the curvature of the bodywork.
//
// Cost control: only large, reflection-relevant objects are drawn (render layer 2: sky,
// buildings, terrain, landmarks, road, barriers, tunnel, water); the six faces are spread over
// several frames (High: 2 faces / frame -> a full cube every 3 frames; Medium: 1 face / frame);
// the PMREM filter runs once per completed cube; no shadow-map update during these passes.
// Low keeps the static procedural sky environment.
import * as THREE from 'three';

export const REFLECT_LAYER = 2;
const TIERS = {
  high: { size: 128, faces: 2, far: 420 },
  medium: { size: 64, faces: 1, far: 300 },
  low: null,
};

export class CarEnv {
  constructor(renderer, scene, carRoot, tier = 'high') {
    this.renderer = renderer; this.scene = scene; this.car = carRoot;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.materials = [];
    carRoot.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if ((m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) && !this.materials.includes(m)) this.materials.push(m);
      }
    });
    this.cams = [];
    this.face = 0;
    this.envRT = null;
    this.setTier(tier);
  }

  setTier(tier) {
    const q = TIERS[tier] || null;
    this.q = q;
    if (this.cubeRT) { this.cubeRT.dispose(); this.cubeRT = null; }
    if (!q) { this.apply(null); return; }
    const half = this.renderer.capabilities.isWebGL2 && (this.renderer.extensions.has('EXT_color_buffer_float') || this.renderer.extensions.has('EXT_color_buffer_half_float'));
    this.cubeRT = new THREE.WebGLCubeRenderTarget(q.size, { type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, generateMipmaps: false });
    // one camera per cube face, oriented as THREE.CubeCamera does
    this.cams = [];
    const dirs = [[1, 0, 0, 0, -1, 0], [-1, 0, 0, 0, -1, 0], [0, 1, 0, 0, 0, 1], [0, -1, 0, 0, 0, -1], [0, 0, 1, 0, -1, 0], [0, 0, -1, 0, -1, 0]];
    for (const [x, y, z, ux, uy, uz] of dirs) {
      const c = new THREE.PerspectiveCamera(90, 1, 0.5, q.far);
      c.up.set(ux, uy, uz); c.lookAt(x, y, z);
      c.layers.set(REFLECT_LAYER);
      this.cams.push({ cam: c, dir: new THREE.Vector3(x, y, z) });
    }
    this.face = 0; this.primed = false;
  }

  // assign the filtered cube (or the scene's static environment when null) to the car
  apply(tex) {
    for (const m of this.materials) {
      if (m.envMap !== tex) { m.envMap = tex; m.needsUpdate = true; }
    }
  }

  // render the faces due this frame around `pos` (world); when the cube completes, filter it
  update(pos) {
    if (!this.q) return;
    const r = this.renderer;
    const prevTarget = r.getRenderTarget(), prevShadow = r.shadowMap.autoUpdate, prevXr = r.xr.enabled;
    r.shadowMap.autoUpdate = false; r.xr.enabled = false;
    const carVis = this.car.visible; this.car.visible = false;
    const n = this.primed ? this.q.faces : 6;           // first time: the whole cube at once
    for (let k = 0; k < n; k++) {
      const f = this.cams[this.face];
      f.cam.position.copy(pos);
      f.cam.lookAt(pos.x + f.dir.x, pos.y + f.dir.y, pos.z + f.dir.z);
      f.cam.updateMatrixWorld();
      r.setRenderTarget(this.cubeRT, this.face);
      r.clear();
      r.render(this.scene, f.cam);
      this.face = (this.face + 1) % 6;
      if (this.face === 0) {
        // completed cube -> prefiltered environment (reuses its render target)
        r.setRenderTarget(prevTarget);
        this.envRT = this.pmrem.fromCubemap(this.cubeRT.texture, this.envRT);
        this.apply(this.envRT.texture);
        this.primed = true;
      }
    }
    this.car.visible = carVis;
    r.setRenderTarget(prevTarget);
    r.shadowMap.autoUpdate = prevShadow; r.xr.enabled = prevXr;
  }
}

// Real-time rear-view mirrors. Each glass is a planar reflector: the scene is rendered from the
// viewer's eye reflected in the glass plane, through an off-axis frustum that passes exactly
// through the glass rectangle (generalised perspective projection), so
//  * the reflection is perspective-correct for whichever camera is looking (T-cam, cockpit,
//    chase), including parallax as the viewpoint moves;
//  * the near plane lies on the glass: nothing behind the mirror leaks into it;
//  * every texel of the small render target lands on the glass.
// The two mirrors are refreshed on alternate frames (each at half the frame rate), without
// shadow-map updates, and skipped when the glass is off-screen or seen from behind.
import * as THREE from 'three';

// render-target sizes match the 4:1 glass (200 x 50 mm)
const QUALITY = {
  high: { w: 384, h: 96, every: 1 },
  medium: { w: 256, h: 64, every: 1 },
  low: { w: 160, h: 40, every: 2 },
};
// F1 mirror glass is slightly convex: the field of view is widened about the glass centre
// (horizontal x vertical), so the glass shows the track behind and the car's own flank only
// along its inboard edge
const CONVEX = [1.55, 1.30];

export class Mirrors {
  constructor(renderer, scene, carRoot, tier = 'high') {
    this.renderer = renderer; this.scene = scene;
    // half-float targets keep the reflection in linear HDR (bright sky, dark tunnel); where the
    // GPU cannot render to half float, an 8-bit sRGB target avoids banding in the darks
    const ext = renderer.extensions;
    const half = renderer.capabilities.isWebGL2 && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'));
    this.list = (carRoot.userData.mirrors || []).map((m) => {
      const q = QUALITY[tier] || QUALITY.high;
      const rt = new THREE.WebGLRenderTarget(q.w, q.h, {
        type: half ? THREE.HalfFloatType : THREE.UnsignedByteType,
        colorSpace: half ? THREE.NoColorSpace : THREE.SRGBColorSpace,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: true,
      });
      rt.texture.name = 'mirrorRT';
      // the glass shows the reflection at the ~80 % reflectance of silvered glass (neutral)
      m.glass.material = new THREE.MeshBasicMaterial({ map: rt.texture, color: 0xcdcdcd });
      const cam = new THREE.PerspectiveCamera();
      cam.matrixAutoUpdate = false; cam.matrixWorldAutoUpdate = false;
      cam.layers.set(0);                                        // cockpit-only objects (layer 1) are skipped
      return { ...m, rt, cam, q, valid: false };
    });
    this.tier = tier;
    this.frame = 0;
    this.tmp = { E0: new THREE.Vector3(), E: new THREE.Vector3(), C: new THREE.Vector3(), n: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3(), pa: new THREE.Vector3(), pb: new THREE.Vector3(), pc: new THREE.Vector3(), va: new THREE.Vector3(), vb: new THREE.Vector3(), vc: new THREE.Vector3() };
    this.frustum = new THREE.Frustum(); this.pv = new THREE.Matrix4();
    this.sphere = new THREE.Sphere();
    this.stats = { renders: 0 };
  }

  setTier(tier) {
    const q = QUALITY[tier] || QUALITY.high;
    for (const m of this.list) { m.rt.setSize(q.w, q.h); m.q = q; }
    this.tier = tier;
  }

  // Render the mirror(s) due this frame for the viewing camera. Call just before the main render.
  update(viewCam) {
    if (!this.list.length) return;
    this.frame++;
    const T = this.tmp;
    viewCam.updateMatrixWorld();
    this.pv.multiplyMatrices(viewCam.projectionMatrix, viewCam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    T.E0.setFromMatrixPosition(viewCam.matrixWorld);
    const r = this.renderer;
    for (let i = 0; i < this.list.length; i++) {
      const m = this.list[i];
      // alternate the two glasses (and on Low only every other pair of frames)
      if (m.valid && (this.frame + i) % (2 * m.q.every) !== 0) continue;
      m.glass.updateMatrixWorld();
      const M = m.glass.matrixWorld;
      // glass rectangle in world space
      T.C.setFromMatrixPosition(M);
      T.n.set(0, 0, 1).transformDirection(M);                 // faces the viewer side
      const toEye = T.E0.clone().sub(T.C);
      if (toEye.dot(T.n) <= 0.002) continue;                  // seen from behind / edge-on
      this.sphere.set(T.C, Math.hypot(m.w, m.h) / 2);
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      T.u.set(0, 1, 0).transformDirection(M);
      // reflected eye (behind the glass)
      T.E.copy(T.E0).addScaledVector(T.n, -2 * toEye.dot(T.n));
      // from the reflected eye the camera looks along +n; its right axis is up x (-n)
      T.r.crossVectors(T.u, T.n).multiplyScalar(-1);          // = u x (-n)
      // rectangle corners as seen from the virtual eye: pa lower-left, pb lower-right, pc upper-left
      const hw = m.w / 2, hh = m.h / 2;
      T.pa.copy(T.C).addScaledVector(T.r, -hw).addScaledVector(T.u, -hh);
      T.pb.copy(T.C).addScaledVector(T.r, hw).addScaledVector(T.u, -hh);
      T.pc.copy(T.C).addScaledVector(T.r, -hw).addScaledVector(T.u, hh);
      T.va.subVectors(T.pa, T.E); T.vb.subVectors(T.pb, T.E); T.vc.subVectors(T.pc, T.E);
      const vn = T.n.clone().multiplyScalar(-1);              // camera +z (towards the eye)
      const d = -T.va.dot(vn);                                  // eye -> glass plane distance
      if (d < 1e-4) continue;
      const near = d, far = 320;                              // beyond ~300 m the scene is sub-pixel in the glass
      let l = T.r.dot(T.va), rr = T.r.dot(T.vb), b = T.u.dot(T.va), t = T.u.dot(T.vc);
      { const cx = (l + rr) / 2, cy = (b + t) / 2; l = cx + (l - cx) * CONVEX[0]; rr = cx + (rr - cx) * CONVEX[0]; b = cy + (b - cy) * CONVEX[1]; t = cy + (t - cy) * CONVEX[1]; }
      const cam = m.cam;
      cam.projectionMatrix.makePerspective(l, rr, t, b, near, far);
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      cam.matrixWorld.makeBasis(T.r, T.u, vn).setPosition(T.E);
      cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      cam.near = near; cam.far = far;
      // render without the glasses themselves and without refreshing the shadow map
      const prevTarget = r.getRenderTarget();
      const prevShadow = r.shadowMap.autoUpdate;
      r.shadowMap.autoUpdate = false;
      for (const o of this.list) o.glass.visible = false;
      r.setRenderTarget(m.rt);
      r.clear();
      r.render(this.scene, cam);
      r.setRenderTarget(prevTarget);
      for (const o of this.list) o.glass.visible = true;
      r.shadowMap.autoUpdate = prevShadow;
      m.valid = true;
      this.stats.renders++;
    }
  }
}

// Cameras: T-cam (default: on the roll hoop above and behind the driver, looking over the
// halo), driver-eye cockpit and rear chase. Onboard cameras are rigidly anchored to the sprung
// chassis so pitch under braking, roll and kerb strikes read through the image; added
// vibration is kept to a few millimetres so the next apex stays sharp.
import * as THREE from 'three';
import { CAMERA_MOUNTS } from './carspec.js';

export const CAM_MODES = ['cockpit', 'tcam', 'chase'];
export const CAM_LABEL = { tcam: 'T-CAM', cockpit: 'COCKPIT', chase: 'CHASE' };

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.mode = 'cockpit';
    this.shake = 0; this.shakeT = 0;
    this.chasePos = new THREE.Vector3(); this.chaseInit = false;
    this.tmp = new THREE.Vector3(); this.tmpQ = new THREE.Quaternion(); this.m = new THREE.Matrix4();
    this.noise = 0;
  }
  setMode(m) { this.mode = m; this.chaseInit = false; }
  impulse(strength) { this.shake = Math.min(1, this.shake + strength); }

  // vertical FOV for the current aspect: keep broadcast proportions (16:9 reference); on wider
  // phones widen the horizontal view moderately rather than stretching or cropping hard.
  fovFor(vref, aspect) {
    const ref = 16 / 9;
    const t = Math.tan(vref * Math.PI / 360) * Math.pow(Math.min(1, ref / aspect), 0.45);
    return 2 * Math.atan(t) * 180 / Math.PI;
  }

  update(dt, car, carObj, chassisObj, extra = {}) {
    const cam = this.cam;
    const aspect = cam.aspect;
    this.shake *= Math.exp(-dt * 6);
    this.shakeT += dt;
    const sh = this.shake;
    // subtle high-frequency vibration (engine/road) + kerb + impact shake
    const v = car ? car.speed : 0;
    const curb = extra.curb || 0;
    const vib = 0.0006 * Math.min(1, v / 60) + 0.0025 * curb + 0.03 * sh * sh;
    const t = this.shakeT;
    const nx = (Math.sin(t * 91.7) + Math.sin(t * 57.3 + 1.3)) * 0.5 * vib;
    const ny = (Math.sin(t * 83.1 + 0.7) + Math.sin(t * 131.9)) * 0.5 * vib;
    if (this.mode === 'tcam' || this.mode === 'cockpit') {
      const mnt = CAMERA_MOUNTS[this.mode];
      const vfov = this.fovFor(mnt.vfov16x9, aspect);
      if (Math.abs(cam.fov - vfov) > 0.01) { cam.fov = vfov; cam.updateProjectionMatrix(); }
      chassisObj.updateMatrixWorld(true);
      this.tmp.set(mnt.x + nx, mnt.y + ny, mnt.z);
      cam.position.copy(this.tmp.applyMatrix4(chassisObj.matrixWorld));
      // orientation: chassis orientation then the mount pitch (slightly less down-tilt on very
      // wide screens so the horizon stays at the same height in the frame)
      chassisObj.getWorldQuaternion(this.tmpQ);
      const pitchAdj = (this.fovFor(mnt.vfov16x9, aspect) - mnt.vfov16x9) * 0.12;
      const q2 = new THREE.Quaternion().setFromEuler(new THREE.Euler((mnt.pitchDeg - pitchAdj) * Math.PI / 180 + ny * 2.0, nx * 1.5, sh * 0.01 * Math.sin(t * 40), 'YXZ'));
      cam.quaternion.copy(this.tmpQ).multiply(q2);
      cam.near = 0.03;
    } else {
      const vfov = this.fovFor(58, aspect);
      if (Math.abs(cam.fov - vfov) > 0.01) { cam.fov = vfov; cam.updateProjectionMatrix(); }
      // behind & above, following the velocity-smoothed heading
      carObj.updateMatrixWorld(true);
      const target = new THREE.Vector3(0, 1.1, 0).applyMatrix4(carObj.matrixWorld);
      const back = new THREE.Vector3(0, 2.25, 7.4).applyMatrix4(carObj.matrixWorld);
      if (!this.chaseInit) { this.chasePos.copy(back); this.chaseInit = true; }
      this.chasePos.lerp(back, 1 - Math.exp(-dt * 9));
      cam.position.copy(this.chasePos);
      cam.position.x += nx * 3; cam.position.y += ny * 3;
      cam.lookAt(target);
      cam.near = 0.1;
    }
    cam.updateProjectionMatrix();
  }
}

// Environment maps for reflections and image-based light (PMREM-filtered once at load).
//
// outdoorEnv: an HDR equirectangular sky over Monaco: deep blue zenith fading to a pale hazy
// horizon, a warm glow round the sun, a band of sun-lit cream / ochre facades and green slopes
// above the horizon, warm grey ground. Sky-facing panels pick up a blue-grey sheen, side panels
// reflect the darker street and stay deep navy (as in photos of the car), and glossy carbon,
// satin paint, rubber and metal separate by how sharp and how strong their reflections are,
// also in shadow.
// tunnelEnv: dark concrete walls and road under the two rows of warm LED luminaires.
import * as THREE from 'three';

// RGBA16F: linear filtering of half-float textures is core in WebGL 2 (32-bit float textures
// need OES_texture_float_linear, which not every mobile GPU / browser exposes)
const toHalf = THREE.DataUtils.toHalfFloat;
function makeTex(W, H, fn) {
  const data = new Uint16Array(W * H * 4);
  const d = new THREE.Vector3();
  for (let y = 0; y < H; y++) {
    const e = ((y + 0.5) / H - 0.5) * Math.PI;           // elevation (row 0 = straight down)
    for (let x = 0; x < W; x++) {
      const phi = ((x + 0.5) / W - 0.5) * Math.PI * 2;   // azimuth, matches three's equirectUv
      d.set(Math.cos(phi) * Math.cos(e), Math.sin(e), Math.sin(phi) * Math.cos(e));
      const c = fn(d, e, phi);
      const i = (y * W + x) * 4;
      data[i] = toHalf(c[0]); data[i + 1] = toHalf(c[1]); data[i + 2] = toHalf(c[2]); data[i + 3] = toHalf(1);
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.LinearSRGBColorSpace;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// deterministic hash noise
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

export function outdoorEnv(renderer, sunDir = new THREE.Vector3(0.4, 0.8, 0.3)) {
  const sd = sunDir.clone().normalize();
  // radiance scale: clear-sky light on a horizontal surface ~ 1/4 of the total next to the
  // sun's direct light (2.7) - sky ~0.35-0.5, sun-lit facades ~0.25, street ~0.06
  const K = 0.42;
  const sample = (d, e, phi) => {
    if (e >= 0) {
      // sky: Rayleigh-like gradient, brighter and whiter towards the horizon
      const k = Math.pow(1 - Math.min(1, e / (Math.PI / 2)), 2.2);
      let r = 0.20 + 0.62 * k, g = 0.38 + 0.52 * k, b = 0.86 + 0.18 * k;
      const cosS = d.dot(sd);
      const ang = Math.acos(Math.max(-1, Math.min(1, cosS)));
      const glow = 3.2 * Math.exp(-(ang * ang) / (2 * 0.05 * 0.05)) + 0.55 * Math.exp(-(ang * ang) / (2 * 0.30 * 0.30));
      r += glow * 1.0; g += glow * 0.93; b += glow * 0.80;
      // facades and slopes above the horizon (heights vary with azimuth)
      const cell = Math.floor((phi + Math.PI) / (Math.PI * 2) * 96);
      const hgt = 0.05 + 0.20 * hash(cell) * hash(cell * 0.37 + 5) + (hash(cell * 3.1) < 0.18 ? 0.10 : 0);
      if (e < hgt) {
        // sun-facing walls brighter; a few greener cells for the slopes / trees
        const facing = Math.max(0, -(Math.cos(phi) * sd.x + Math.sin(phi) * sd.z));
        const lit = 0.30 + 0.55 * facing;
        const green = hash(cell * 7.7) < 0.22;
        const tone = 0.85 + 0.3 * hash(cell * 1.9);
        const win = (Math.floor(e * 240) % 3 === 0) ? 0.72 : 1;     // rows of windows
        if (green) return [0.10 * lit * tone, 0.17 * lit * tone, 0.08 * lit * tone];
        return [0.95 * lit * tone * win, 0.82 * lit * tone * win, 0.64 * lit * tone * win];
      }
      return [r, g, b];
    }
    // ground: sun-lit asphalt, kerbs and pavements (radiance comparable to the sky near the
    // horizon - this warm bounce is what keeps shaded, down-facing panels neutral rather than
    // sky-blue), darker straight down where the car's own shadow lies
    const k = Math.min(1, -e / (Math.PI / 2));
    const near = Math.exp(-((Math.PI / 2 + e) ** 2) / (2 * 0.35 * 0.35));     // straight down
    const base = 0.34 - 0.12 * k - 0.14 * near;
    return [base * 1.05, base * 1.0, base * 0.92];
  };
  const tex = makeTex(512, 256, (d, e, phi) => {
    const c = sample(d, e, phi);
    return [c[0] * K, c[1] * K, c[2] * K];
  });
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromEquirectangular(tex);
  tex.dispose(); pm.dispose();
  return rt.texture;
}

export function tunnelEnv(renderer) {
  // Monaco tunnel: light painted walls and ceiling lit by two continuous rows of warm LED
  // luminaires (the rows are modelled on both axes: their direction in the world turns with
  // the tunnel, and the PMREM blur makes the pattern read as soft lamp streaks either way)
  const tex = makeTex(256, 128, (d, e) => {
    if (e > 0.45) {
      const ax = Math.abs(d.x / Math.max(0.05, d.y)), az = Math.abs(d.z / Math.max(0.05, d.y));
      const row = Math.max(Math.exp(-((ax - 0.45) ** 2) / (2 * 0.06 * 0.06)), Math.exp(-((az - 0.45) ** 2) / (2 * 0.06 * 0.06)));
      return [0.50 + 3.2 * row, 0.47 + 2.95 * row, 0.42 + 2.4 * row];        // lit ceiling + lamp rows
    }
    if (e > 0.06) return [0.34, 0.33, 0.31];                                  // light walls
    if (e > 0) return [0.16, 0.155, 0.15];                                    // wall base / kerb
    return [0.05, 0.048, 0.046];                                              // road
  });
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromEquirectangular(tex);
  tex.dispose(); pm.dispose();
  return rt.texture;
}

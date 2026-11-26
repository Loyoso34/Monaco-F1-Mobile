// Cockpit: RB20-style steering wheel (carbon body, suede grips, buttons, rotaries, thumb
// wheels, paddles, printed labels), a live colour display (gear, speed, rpm, ERS, brake bias),
// progressive RPM shift LEDs, gloved hands gripping the wheel and the driver's arms solved by
// two-bone IK every frame so they follow the wheel without stretching or detaching.
//
// Steering-wheel local frame (child of the chassis, tilted back with the column):
//   +x right, +y up along the face, +z towards the driver (the face looks at the driver).
import * as THREE from 'three';
import { sweep, loft, mergeGeoms } from './geom.js';
import { SHIFT_RPM, LIMIT_RPM } from './physics.js';

const RED = '#d81f2c', YELLOW = '#ffc20e', BLUE = '#2f6bff', GREEN = '#21b34b', WHITE = '#ececec';

// ---------------------------------------------------------------------------------------------
// textures
function canvasTex(w, h, draw, { srgb = true, aniso = 8 } = {}) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// suede / Alcantara grip: fine noise
function suedeTexture() {
  return canvasTex(128, 128, (c, w, h) => {
    const img = c.createImageData(w, h), r = rng(7);
    for (let i = 0; i < w * h; i++) { const v = 34 + (r() - 0.5) * 16; img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v + 2; img.data[i * 4 + 3] = 255; }
    c.putImageData(img, 0, 0);
  });
}

// Racing glove: navy Nomex knit, white side seams along each finger (u along the finger,
// v around it: seams at v = 0.25 / 0.75), darker silicone palm grip pattern on the inside half.
function gloveTexture() {
  const t = canvasTex(256, 128, (c, w, h) => {
    const img = c.createImageData(w, h), r = rng(17);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const knit = ((x + (y % 2) * 2) % 4 < 2 ? 1 : 0) * 5 + (r() - 0.5) * 10;
      const i = (y * w + x) * 4;
      img.data[i] = 30 + knit; img.data[i + 1] = 44 + knit; img.data[i + 2] = 92 + knit; img.data[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    // palm side (v 0.5..1 -> rows 0..h/2 after the flip): darker grey silicone dots
    c.fillStyle = 'rgba(40,40,46,0.9)'; c.fillRect(0, 0, w, h * 0.42);
    c.fillStyle = 'rgba(90,92,100,0.9)';
    for (let y = 4; y < h * 0.42; y += 7) for (let x = (y % 14 ? 3 : 7); x < w; x += 8) { c.beginPath(); c.arc(x, y, 1.4, 0, Math.PI * 2); c.fill(); }
    // side seams (stitches)
    c.strokeStyle = 'rgba(230,232,240,0.85)'; c.lineWidth = 1.2; c.setLineDash([3, 3]);
    for (const v of [0.25, 0.75]) { const y = (1 - v) * h; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    c.setLineDash([]);
    // knuckle panel stripe (red) near the base of the fingers on the back
    c.fillStyle = RED; c.fillRect(0, h * 0.62, w * 0.08, h * 0.26);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Printed faceplate labels and rotary scales, transparent background. The canvas covers the
// face rectangle x in [-FX, FX], y in [-FY, FY] (metres) at 4096 px per metre.
const FX = 0.125, FY = 0.08, PPM = 4096;
function faceToPx(x, y) { return [(x + FX) * PPM, (FY - y) * PPM]; }

// ---------------------------------------------------------------------------------------------
// grip surface shared by the grip mesh, the palm and the fingers (wheel frame, metres):
// elliptical section (width GRIP_RW across, depth GRIP_RD fore-aft), toed in at the top,
// fuller in the middle, with moulded grooves under the four fingers
const GY0 = -0.074, GY1 = 0.068, GRIP_Z = -0.003, GRIP_RW = 0.0195, GRIP_RD = 0.0225;
const FING = [[0.035, 0.0086, -2.55], [0.0135, 0.0091, -2.75], [-0.0075, 0.0088, -2.62], [-0.0275, 0.0078, -2.30]];   // [height, finger radius, wrap angle]
const gripCX = (sx, y) => sx * (0.140 - 0.006 * (y - GY0) / (GY1 - GY0));
function gripScale(y) {
  const t = Math.max(0, Math.min(1, (y - GY0) / (GY1 - GY0)));
  let s = 0.92 + 0.12 * Math.sin(Math.PI * t);
  for (const [fy] of FING) s -= 0.05 * Math.exp(-((y - fy) ** 2) / (2 * 0.0042 * 0.0042));
  return s;
}

export function buildCockpit({ chassis, carbonMap, carbonNormal, hi, q, helmetCentreFA }) {
  const W = new THREE.Group(); W.name = 'steeringWheel';
  // column end in front of the driver, tilted back like the real column (~24 deg)
  W.position.set(0, 0.568, q(1.205));
  W.rotation.x = -0.42;
  chassis.add(W);

  // ---- materials --------------------------------------------------------------------------
  const carbonMat = hi
    ? new THREE.MeshPhysicalMaterial({ color: 0xa4a8b4, map: carbonMap, normalMap: carbonNormal, normalScale: new THREE.Vector2(0.18, 0.18), roughness: 0.55, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.18, envMapIntensity: 0.4 })
    : new THREE.MeshStandardMaterial({ color: 0xa4a8b4, map: carbonMap, roughness: 0.45, metalness: 0.0, envMapIntensity: 0.4 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3e, map: suedeTexture(), roughness: 0.96, metalness: 0 });
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.18, metalness: 0.2 });
  const knobMat = new THREE.MeshStandardMaterial({ color: 0x1c1d21, roughness: 0.32, metalness: 0.75 });
  const alloyMat = new THREE.MeshStandardMaterial({ color: 0x9da2ab, roughness: 0.3, metalness: 0.9 });
  const btnMats = {};
  const btn = (hex) => btnMats[hex] || (btnMats[hex] = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.32, metalness: 0.0 }));

  const add = (parent, g, m, name = '', shadow = true) => { const o = new THREE.Mesh(g, m); o.name = name; o.castShadow = shadow; parent.add(o); return o; };

  // ---- carbon body --------------------------------------------------------------------------
  // Outline (front view): flat top with the LED bar, shoulders flaring to the grips, a scalloped
  // lower edge between the grips. The grips are separate suede-covered parts.
  const body = new THREE.Shape();
  body.moveTo(-0.082, 0.064);
  body.lineTo(0.082, 0.064);
  body.bezierCurveTo(0.100, 0.064, 0.112, 0.058, 0.118, 0.046);
  body.lineTo(0.124, 0.030);
  body.lineTo(0.124, -0.046);
  body.bezierCurveTo(0.118, -0.062, 0.104, -0.068, 0.088, -0.068);
  body.bezierCurveTo(0.060, -0.068, 0.040, -0.058, 0.030, -0.060);
  body.lineTo(-0.030, -0.060);
  body.bezierCurveTo(-0.040, -0.058, -0.060, -0.068, -0.088, -0.068);
  body.bezierCurveTo(-0.104, -0.068, -0.118, -0.062, -0.124, -0.046);
  body.lineTo(-0.124, 0.030);
  body.lineTo(-0.118, 0.046);
  body.bezierCurveTo(-0.112, 0.058, -0.100, 0.064, -0.082, 0.064);
  const bodyGeo = new THREE.ExtrudeGeometry(body, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.0028, bevelSegments: 3, curveSegments: 10 });
  bodyGeo.translate(0, 0, -0.009 - 0.003);
  // carbon weave scale: shape UVs are in metres -> ~7 mm tows
  { const uv = bodyGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 0.05, uv.getY(i) / 0.05); }
  add(W, bodyGeo, carbonMat, 'swBody');
  const FACE_Z = 0.009 + 0.003;                      // front face plane of the body

  // ---- grips (suede over a carbon core), slightly toed in at the top, with moulded finger
  // grooves at the driver's finger positions. The same surface function places the palm and the
  // fingers, so they touch the grip everywhere (no gaps, no intersections) ------------------
  for (const sx of [-1, 1]) {
    const pts = [];
    const NG = hi ? 48 : 24;
    for (let i = 0; i <= NG; i++) {
      const t = i / NG, y = GY0 + (GY1 - GY0) * t;
      pts.push([gripCX(sx, y), y, GRIP_Z]);
    }
    const g = sweep(pts, { rx: GRIP_RD, ry: GRIP_RW, seg: hi ? 20 : 12, scaleFn: (t) => gripScale(GY0 + (GY1 - GY0) * t) });
    const uv = new Float32Array(g.attributes.position.count * 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getY(i) * 20; uv[i * 2 + 1] = Math.atan2(p.getZ(i), p.getX(i) - sx * 0.14) * 2; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    add(W, g, gripMat, 'swGrip');
  }

  // ---- display bezel + live screen ----------------------------------------------------------
  const SCR_W = 0.100, SCR_H = 0.056, SCR_Y = 0.010;
  {
    const bz = new THREE.Shape();
    const bw = SCR_W / 2 + 0.006, bh = SCR_H / 2 + 0.006, r = 0.006;
    bz.moveTo(-bw + r, -bh); bz.lineTo(bw - r, -bh); bz.quadraticCurveTo(bw, -bh, bw, -bh + r); bz.lineTo(bw, bh - r);
    bz.quadraticCurveTo(bw, bh, bw - r, bh); bz.lineTo(-bw + r, bh); bz.quadraticCurveTo(-bw, bh, -bw, bh - r); bz.lineTo(-bw, -bh + r); bz.quadraticCurveTo(-bw, -bh, -bw + r, -bh);
    const g = new THREE.ExtrudeGeometry(bz, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.0012, bevelSize: 0.0012, bevelSegments: 2 });
    g.translate(0, SCR_Y, FACE_Z - 0.001);
    add(W, g, bezelMat, 'swBezel', false);
  }
  const DW = 512, DH = 288;
  const dispCanvas = document.createElement('canvas'); dispCanvas.width = DW; dispCanvas.height = DH;
  const dctx = dispCanvas.getContext('2d');
  const dispTex = new THREE.CanvasTexture(dispCanvas); dispTex.colorSpace = THREE.SRGBColorSpace; dispTex.anisotropy = 4;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCR_W, SCR_H), new THREE.MeshBasicMaterial({ map: dispTex, toneMapped: false }));
  screen.position.set(0, SCR_Y, FACE_Z + 0.0045); screen.name = 'swScreen';
  W.add(screen);

  // ---- shift LEDs (15 across the top) + 3 status LEDs each side -----------------------------
  const ledN = 15 + 6;
  const ledGeo = new THREE.SphereGeometry(0.0034, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  ledGeo.rotateX(Math.PI / 2);
  const leds = new THREE.InstancedMesh(ledGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), ledN);
  leds.name = 'swLeds';
  const ledPos = [];
  for (let i = 0; i < 15; i++) ledPos.push([-0.0735 + i * 0.0105, 0.0515]);
  for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) ledPos.push([sx * 0.1005, 0.036 - k * 0.0105]);
  const m4 = new THREE.Matrix4();
  ledPos.forEach(([x, y], i) => { m4.makeTranslation(x, y, FACE_Z + 0.0005); leds.setMatrixAt(i, m4); });
  W.add(leds);
  // glow: an additive soft halo in front of each LED (black = invisible when the LED is off),
  // so lit LEDs bloom and stay readable in direct sun like the real ones on onboard footage
  const glowTex = (() => {
    const N = 64, cv = document.createElement('canvas'); cv.width = cv.height = N;
    const c = cv.getContext('2d'), g = c.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,0.85)'); g.addColorStop(0.42, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, N, N);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const glows = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.0145, 0.0145), new THREE.MeshBasicMaterial({
    map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }), ledN);
  glows.name = 'swLedGlow'; glows.renderOrder = 4; glows.frustumCulled = false;
  ledPos.forEach(([x, y], i) => { m4.makeTranslation(x, y, FACE_Z + 0.0042); glows.setMatrixAt(i, m4); glows.setColorAt(i, new THREE.Color(0, 0, 0)); });
  W.add(glows);
  // lens colours: smoked dark lens when off; lit LEDs saturated and bright
  const ledOff = new THREE.Color(0x1b1d22), ledCol = { g: new THREE.Color(0x2bff6a), r: new THREE.Color(0xff2a22), b: new THREE.Color(0x5a7cff), a: new THREE.Color(0xffae1a), w: new THREE.Color(0xeef2ff) };
  const glowOff = new THREE.Color(0, 0, 0), glowK = 0.75, tmpC = new THREE.Color();
  for (let i = 0; i < ledN; i++) leds.setColorAt(i, ledOff);
  // LED housings (dark strip)
  {
    const g = new THREE.BoxGeometry(0.165, 0.011, 0.003); g.translate(0, 0.0515, FACE_Z - 0.0005);
    add(W, g, bezelMat, 'swLedStrip', false);
  }

  // ---- buttons, rotaries, thumb wheels ------------------------------------------------------
  const BUTTONS = [
    // x, y, colour, label, label side (x offset of the text)
    [-0.074, 0.032, RED, 'PIT', -1], [-0.074, 0.012, WHITE, 'N', -1], [-0.074, -0.008, BLUE, 'RADIO', -1],
    [0.074, 0.032, YELLOW, 'BOX', 1], [0.074, 0.012, GREEN, 'OK', 1], [0.074, -0.008, '#f07c22', 'DRS', 1],
    [-0.040, -0.030, '#202024', 'BB−', 0], [-0.014, -0.030, WHITE, '+1', 0], [0.014, -0.030, WHITE, '−1', 0], [0.040, -0.030, '#202024', 'BB+', 0],
    [-0.106, 0.046, RED, 'MARK', 0], [0.106, 0.046, BLUE, 'PL', 0],
  ];
  const btnGeo = new THREE.CylinderGeometry(0.0062, 0.0066, 0.0045, 18); btnGeo.rotateX(Math.PI / 2);
  const btnRim = new THREE.TorusGeometry(0.0069, 0.0011, 6, 18);
  for (const [x, y, col] of BUTTONS) {
    const b = add(W, btnGeo, btn(col), 'swButton', false); b.position.set(x, y, FACE_Z + 0.0022);
    const r = add(W, btnRim, alloyMat, 'swButtonRim', false); r.position.set(x, y, FACE_Z + 0.0004);
  }
  // knurled rotary switches: a star-profile extrusion with a white pointer
  const knurl = (R, teeth, depth) => {
    const s = new THREE.Shape();
    for (let i = 0; i <= teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2, rr = i % 2 ? R : R * 0.93;
      if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0006, bevelSegments: 1 });
    return g;
  };
  const ROTARIES = [
    [-0.050, -0.049, 0.0105, 'STRAT', 2.2], [0.050, -0.049, 0.0105, 'DIFF', -1.0], [0, -0.050, 0.0085, 'BMIG', 0.6],
    [-0.101, 0.006, 0.0078, 'EB', 1.4], [0.101, 0.006, 0.0078, 'MODE', -0.4],
  ];
  const pointerMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });
  for (const [x, y, R, , ang] of ROTARIES) {
    const grp = new THREE.Group(); grp.position.set(x, y, FACE_Z); grp.rotation.z = ang;
    add(grp, knurl(R, 18, 0.0055), knobMat, 'swRotary');
    const cap = new THREE.CylinderGeometry(R * 0.72, R * 0.78, 0.0016, 20); cap.rotateX(Math.PI / 2); cap.translate(0, 0, 0.0068);
    add(grp, cap, bezelMat, 'swRotaryCap', false);
    const ptr = new THREE.BoxGeometry(0.0011, R * 0.75, 0.0008); ptr.translate(0, R * 0.42, 0.0078);
    add(grp, ptr, pointerMat, 'swPointer', false);
    grp.userData.flatten = true;                     // static: merged into the wheel below
    W.add(grp);
  }
  // thumb wheels at the top of the grips
  for (const sx of [-1, 1]) {
    const g = new THREE.CylinderGeometry(0.0065, 0.0065, 0.008, 16); g.rotateZ(Math.PI / 2);
    g.translate(sx * 0.116, 0.058, FACE_Z - 0.002);
    add(W, g, knobMat, 'swThumbWheel', false);
  }

  // ---- printed labels / scales (transparent decal over the face) ----------------------------
  const labelTex = canvasTex(Math.round(FX * 2 * PPM), Math.round(FY * 2 * PPM), (c) => {
    c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    const txt = (s, x, y, size = 0.0042, col = '#e9e9ec', weight = 700, align = 'center') => {
      const [px, py] = faceToPx(x, y);
      c.fillStyle = col; c.font = `${weight} ${Math.round(size * PPM)}px Helvetica, Arial, sans-serif`;
      c.textAlign = align; c.textBaseline = 'middle'; c.fillText(s, px, py);
    };
    for (const [x, y, , label, side] of BUTTONS) {
      if (side) txt(label, x + side * 0.0145, y, 0.0038, '#e6e6ea', 700, side < 0 ? 'right' : 'left');
      else txt(label, x, y - 0.0105, 0.0034);
    }
    // rotary scales: ticks and numbers around each rotary
    for (const [x, y, R, label] of ROTARIES) {
      const [cx, cy] = faceToPx(x, y);
      c.strokeStyle = 'rgba(235,235,240,0.9)'; c.lineWidth = 2;
      const n = 12;
      for (let k = 0; k < n; k++) {
        const a = -Math.PI * 0.75 + (k / (n - 1)) * Math.PI * 1.5 - Math.PI / 2;
        const r0 = (R + 0.0018) * PPM, r1 = (R + 0.0032) * PPM;
        c.beginPath(); c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); c.stroke();
      }
      txt(label, x, y + R + 0.0052, 0.0032, YELLOW, 800);
    }
    // centre lettering under the screen
    txt('ORACLE RED BULL RACING', 0, -0.0145, 0.0030, '#bfc1c7', 600);
    // LED bar end marks
    txt('RPM', -0.0855, 0.0515, 0.0026, '#9a9ca3', 700);
  });
  {
    const g = new THREE.PlaneGeometry(FX * 2, FY * 2);
    const m = new THREE.MeshStandardMaterial({ map: labelTex, transparent: true, roughness: 0.5, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const o = add(W, g, m, 'swLabels', false); o.position.z = FACE_Z + 0.0002; o.renderOrder = 2;
  }

  // ---- paddles behind the wheel (shift up / down, clutch) -----------------------------------
  for (const sx of [-1, 1]) {
    for (const [y, len, thick] of [[0.030, 0.062, 0.0035], [-0.022, 0.054, 0.0032]]) {
      const s = new THREE.Shape();
      s.moveTo(0, -0.008); s.lineTo(len, -0.010); s.quadraticCurveTo(len + 0.012, 0, len, 0.010); s.lineTo(0, 0.008); s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false });
      g.translate(0, 0, -thick / 2);
      if (sx < 0) g.scale(-1, 1, 1);
      g.translate(sx * 0.075, y, -0.016);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 0.05, uv.getY(i) / 0.05);
      add(W, g, carbonMat, 'swPaddle');
    }
  }
  // quick-release hub / column
  {
    const g = new THREE.CylinderGeometry(0.019, 0.022, 0.05, 18); g.rotateX(Math.PI / 2); g.translate(0, 0, -0.036);
    add(W, g, alloyMat, 'swHub');
    const col = new THREE.CylinderGeometry(0.012, 0.012, 0.30, 12); col.rotateX(Math.PI / 2); col.translate(0, 0, -0.21);
    add(W, col, alloyMat, 'swColumn', false);
  }

  // =============================================================================================
  // GLOVED HANDS (children of the wheel: they rotate with it) and IK ARMS
  const gloveMat = new THREE.MeshStandardMaterial({ map: gloveTexture(), roughness: 0.88, metalness: 0 });
  const cuffMat = new THREE.MeshStandardMaterial({ color: 0x1a2550, roughness: 0.85 });
  const strapMat = new THREE.MeshStandardMaterial({ color: 0xc81d29, roughness: 0.7 });
  // tube sweep with UVs (u along, v around); caps: 'round' (dome), 'flat' or 'none'
  const tube = (pts, radius, seg = 10, caps = ['round', 'round']) => {
    const P = pts.map(p => new THREE.Vector3(...p));
    const n = P.length, pos = [], uv = [], idx = [];
    const rad = (t) => (typeof radius === 'function' ? radius(t) : radius);
    let N = new THREE.Vector3(0, 1, 0);
    const frames = [];
    for (let i = 0; i < n; i++) {
      const T = new THREE.Vector3().subVectors(P[Math.min(n - 1, i + 1)], P[Math.max(0, i - 1)]).normalize();
      N = N.clone().sub(T.clone().multiplyScalar(N.dot(T)));
      if (N.lengthSq() < 1e-6) N = new THREE.Vector3(1, 0, 0).sub(T.clone().multiplyScalar(T.x));
      N.normalize();
      frames.push({ T, N: N.clone(), B: new THREE.Vector3().crossVectors(T, N).normalize() });
    }
    const ring = (C, fr, r, u) => {
      const base = pos.length / 3;
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const v = C.clone().addScaledVector(fr.N, Math.cos(a) * r).addScaledVector(fr.B, Math.sin(a) * r);
        pos.push(v.x, v.y, v.z); uv.push(u, k / seg);
      }
      return base;
    };
    const join = (r0, r1) => { for (let k = 0; k < seg; k++) { const a = r0 + k, b = a + 1, c = r1 + k, d = c + 1; idx.push(a, c, b, b, c, d); } };
    // optional start dome (rings ahead of the first point, reversed direction)
    const rings = [];
    let len = 0;
    const startCap = caps[0], endCap = caps[1];
    if (startCap === 'round') {
      const fr = frames[0], r0 = rad(0);
      for (const [o, f] of [[0.92, 0.42], [0.62, 0.80]]) rings.push(ring(P[0].clone().addScaledVector(fr.T, -o * r0), fr, f * r0, -0.1));
    }
    for (let i = 0; i < n; i++) { if (i > 0) len += P[i].distanceTo(P[i - 1]); rings.push(ring(P[i], frames[i], rad(i / (n - 1)), len / 0.06)); }
    if (endCap === 'round') {
      const fr = frames[n - 1], r1 = rad(1);
      for (const [o, f] of [[0.62, 0.80], [0.92, 0.42]]) rings.push(ring(P[n - 1].clone().addScaledVector(fr.T, o * r1), fr, f * r1, len / 0.06 + 0.1));
    }
    for (let i = 0; i < rings.length - 1; i++) join(rings[i], rings[i + 1]);
    // close the ends with a centre fan
    const fan = (r, C, flip) => { const ci = pos.length / 3; pos.push(C.x, C.y, C.z); uv.push(0, 0.5); for (let k = 0; k < seg; k++) { const a = r + k, b = a + 1; if (flip) idx.push(a, b, ci); else idx.push(b, a, ci); } };
    if (startCap !== 'none') fan(rings[0], startCap === 'round' ? P[0].clone().addScaledVector(frames[0].T, -rad(0) * 1.0) : P[0], false);
    if (endCap !== 'none') fan(rings[rings.length - 1], endCap === 'round' ? P[n - 1].clone().addScaledVector(frames[n - 1].T, rad(1) * 1.0) : P[n - 1], true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  };
  gloveMat.side = THREE.DoubleSide; cuffMat.side = THREE.DoubleSide; strapMat.side = THREE.DoubleSide;
  // point on the grip surface (+ offset along its normal) at angle a and height y
  const onGrip = (sx, a, y, off) => {
    const sc = gripScale(y), Rw = GRIP_RW * sc, Rd = GRIP_RD * sc, c = Math.cos(a), si = Math.sin(a);
    let nx = sx * c / Rw, nz = si / Rd; const l = Math.hypot(nx, nz); nx /= l; nz /= l;
    return [gripCX(sx, y) + sx * c * Rw + nx * off, y, GRIP_Z + si * Rd + nz * off];
  };
  const GRIP_R = 0.0222;
  // angle convention around a grip (in the face plane x-z): 0 = outer side, +pi/2 = towards
  // the driver (front face), -pi/2 = behind the wheel, -pi = inner side
  const around = (sx, gx, a, r, y) => [gx + sx * Math.cos(a) * r, y, GRIP_Z + Math.sin(a) * r];
  const hands = [];
  for (const sx of [-1, 1]) {
    const H = new THREE.Group(); H.name = 'glove' + (sx < 0 ? 'L' : 'R');
    const gx = sx * 0.138;
    // palm: a padded shell hugging the outer side of the grip, from just behind it round to
    // the front face; rounded at the heel of the hand and at the knuckles
    {
      const A0 = -0.30, A1 = 1.50, TH = 0.021, NA = 10, NY = 10, Y0 = -0.050, Y1 = 0.047;
      const pos = [], idx = [], uv = [];
      const M = 2 * (NA + 1) + 6;                      // outer arc, end round, inner arc, end round
      for (let j = 0; j <= NY; j++) {
        const t = j / NY, y = Y0 + (Y1 - Y0) * t;
        const round = Math.sin(Math.PI * Math.min(1, Math.max(0, t * 1.15 - 0.02))) ** 0.45;   // taper top / bottom
        const th = Math.max(0.004, TH * (0.55 + 0.45 * round));
        const o0 = 0.0005, o1 = o0 + th;                // glove thickness over the grip surface
        const ring = [];
        for (let k = 0; k <= NA; k++) { const a = A1 + (A0 - A1) * (k / NA); ring.push(onGrip(sx, a, y, o1)); }     // outer (back of hand)
        for (let k = 1; k <= 3; k++) { const a = A0 - 0.06 * Math.sin(k / 4 * Math.PI); ring.push(onGrip(sx, a, y, o1 - th * k / 4)); }
        for (let k = 0; k <= NA; k++) { const a = A0 + (A1 - A0) * (k / NA); ring.push(onGrip(sx, a, y, o0)); }     // inner (on the grip)
        for (let k = 1; k <= 3; k++) { const a = A1 + 0.08 * Math.sin(k / 4 * Math.PI); ring.push(onGrip(sx, a, y, o0 + th * k / 4)); }
        ring.forEach(([x, yy, z], k) => { pos.push(x, yy, z); uv.push(t * 1.5, k / M); });
      }
      for (let j = 0; j < NY; j++) for (let k = 0; k < M; k++) {
        const a = j * M + k, b = j * M + (k + 1) % M, c = a + M, d = b + M;
        idx.push(a, c, b, b, c, d);
      }
      for (const [j, flip] of [[0, false], [NY, true]]) {
        let cx = 0, cy = 0, cz = 0;
        for (let k = 0; k < M; k++) { cx += pos[(j * M + k) * 3]; cy += pos[(j * M + k) * 3 + 1]; cz += pos[(j * M + k) * 3 + 2]; }
        const ci = pos.length / 3; pos.push(cx / M, cy / M, cz / M); uv.push(0.5, 0.5);
        for (let k = 0; k < M; k++) { const a = j * M + k, b = j * M + (k + 1) % M; if (flip) idx.push(a, b, ci); else idx.push(b, a, ci); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      add(H, g, gloveMat, 'palm');
    }
    // fingers: from the knuckles at the back-outer edge of the palm, round the back of the grip
    // to the inner side, fingertips resting against the paddles
    for (const [y, rf, aEnd] of FING) {
      const pts = [];
      const a0 = -0.12;
      const knuckles = (t) => rf * (1 + 0.09 * Math.exp(-((t - 0.33) ** 2) / 0.003) + 0.07 * Math.exp(-((t - 0.66) ** 2) / 0.003) - 0.12 * Math.max(0, t - 0.85) / 0.15);
      for (let k = 0; k <= 20; k++) {
        const t = k / 20, a = a0 + (aEnd - a0) * t;
        // centreline one finger radius off the grip surface: the finger pads touch the grip
        pts.push(onGrip(sx, a, y, knuckles(t) * 0.97 + 0.0003));
      }
      add(H, tube(pts, knuckles, hi ? 10 : 7, ['flat', 'round']), gloveMat, 'finger');
    }
    // thumb: from the front edge of the palm over the face towards the top buttons
    {
      const root = around(sx, gx, 1.35, GRIP_R + 0.011, 0.024);
      const pts = [root, [gx - sx * 0.004, 0.034, 0.0255], [gx - sx * 0.017, 0.041, 0.0235], [gx - sx * 0.028, 0.0445, 0.0205]];
      add(H, tube(pts, (t) => 0.0102 - 0.0022 * t, hi ? 10 : 7, ['flat', 'round']), gloveMat, 'thumb');
    }
    // cuff with a red strap, from below the palm towards the forearm (down, out, back)
    const wristDir = new THREE.Vector3(sx * 0.26, -0.70, 0.66).normalize();
    const cuffBase = new THREE.Vector3(...around(sx, gx, 0.55, GRIP_R + 0.012, -0.046));
    const cuffEnd = cuffBase.clone().addScaledVector(wristDir, 0.072);
    {
      const pts = [];
      for (let k = 0; k <= 6; k++) { const p = cuffBase.clone().addScaledVector(wristDir, 0.072 * k / 6); pts.push([p.x, p.y, p.z]); }
      add(H, tube(pts, (t) => 0.0255 + 0.0065 * t, hi ? 16 : 10, ['round', 'none']), cuffMat, 'cuff');
      const sp = [];
      for (let k = 0; k <= 3; k++) { const p = cuffBase.clone().addScaledVector(wristDir, 0.038 + 0.017 * k / 3); sp.push([p.x, p.y, p.z]); }
      add(H, tube(sp, 0.0312, hi ? 16 : 10, ['none', 'none']), strapMat, 'cuffStrap');
    }
    W.add(H);
    hands.push({ sx, group: H, wristLocal: cuffEnd.clone(), wristDirLocal: wristDir.clone() });
  }

  // arms: unit cylinders oriented every frame (shoulder -> elbow -> wrist)
  const armsG = new THREE.Group(); armsG.name = 'driverArms';
  chassis.add(armsG);
  const suitMat = new THREE.MeshStandardMaterial({ color: 0x1b2850, roughness: 0.86 });
  const seg = (r0, r1) => { const g = new THREE.CylinderGeometry(r1, r0, 1, hi ? 14 : 10, 1, true); g.translate(0, 0.5, 0); return g; };
  const arms = hands.map(h => {
    const upper = add(armsG, seg(0.043, 0.037), suitMat, 'upperArm');
    const fore = add(armsG, seg(0.037, 0.031), suitMat, 'forearm');
    const elbow = add(armsG, new THREE.SphereGeometry(0.038, 12, 8), suitMat, 'elbow');
    const shoulder = new THREE.Vector3(h.sx * 0.180, 0.522, q(helmetCentreFA + 0.035));
    return { h, upper, fore, elbow, shoulder };
  });
  const LU = 0.28, LF = 0.26;                         // upper arm, forearm (to the glove cuff)
  const tmpW = new THREE.Vector3(), tmpE = new THREE.Vector3(), tmpU = new THREE.Vector3(), tmpV = new THREE.Vector3(), tmpP = new THREE.Vector3();
  const qTmp = new THREE.Quaternion(), yUp = new THREE.Vector3(0, 1, 0);
  const place = (mesh, a, b) => {
    tmpU.subVectors(b, a); const len = tmpU.length();
    mesh.position.copy(a);
    qTmp.setFromUnitVectors(yUp, tmpU.divideScalar(len || 1));
    mesh.quaternion.copy(qTmp);
    mesh.scale.set(1, len, 1);
  };
  function solveArms() {
    W.updateMatrix();
    for (const a of arms) {
      // wrist (end of the glove cuff) in the chassis frame
      tmpW.copy(a.h.wristLocal).applyMatrix4(a.h.group.matrix).applyMatrix4(W.matrix);
      const S = a.shoulder;
      tmpU.subVectors(tmpW, S);
      let d = tmpU.length();
      const dMax = (LU + LF) * 0.995;
      if (d > dMax) d = dMax;
      tmpU.normalize();
      // elbow pole: outwards and down, a little back (elbows tucked along the cockpit sides)
      tmpP.set(a.h.sx * 0.9, -1.15, 0.05).normalize();
      tmpV.copy(tmpP).addScaledVector(tmpU, -tmpP.dot(tmpU)).normalize();
      const cosA = (LU * LU + d * d - LF * LF) / (2 * LU * d);
      const ang = Math.acos(Math.max(-1, Math.min(1, cosA)));
      tmpE.copy(S).addScaledVector(tmpU, Math.cos(ang) * LU).addScaledVector(tmpV, Math.sin(ang) * LU);
      // keep the forearm exactly on the wrist (no gap): re-aim from the elbow
      place(a.upper, S, tmpE);
      place(a.fore, tmpE, tmpW);
      a.elbow.position.copy(tmpE);
    }
  }

  // =============================================================================================
  // live display + LEDs
  let dispAcc = 1, lastKey = '';
  function drawDisplay(st) {
    const c = dctx, w = DW, h = DH;
    c.fillStyle = '#05070b'; c.fillRect(0, 0, w, h);
    // rpm bar along the top
    const f = Math.max(0, Math.min(1, (st.rpm - 4000) / (LIMIT_RPM - 4000)));
    c.fillStyle = '#151a24'; c.fillRect(14, 14, w - 28, 16);
    const grad = c.createLinearGradient(14, 0, w - 14, 0);
    grad.addColorStop(0, '#19c64f'); grad.addColorStop(0.62, '#19c64f'); grad.addColorStop(0.8, '#ff2a2a'); grad.addColorStop(1, '#5a6bff');
    c.fillStyle = grad; c.fillRect(14, 14, (w - 28) * f, 16);
    // gear (big, centre)
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = st.limiter ? '#5a6bff' : '#ffffff';
    c.font = '800 168px Helvetica, Arial, sans-serif';
    c.fillText(st.gear, w / 2, h * 0.56);
    // speed (left) and rpm (right)
    c.fillStyle = '#e8eaf0'; c.font = '700 58px Helvetica, Arial, sans-serif';
    c.textAlign = 'left'; c.fillText(String(st.kmh), 22, h * 0.47);
    c.fillStyle = '#7f8796'; c.font = '700 20px Helvetica, Arial, sans-serif'; c.fillText('KM/H', 24, h * 0.66);
    c.textAlign = 'right'; c.fillStyle = '#e8eaf0'; c.font = '700 44px Helvetica, Arial, sans-serif';
    c.fillText(String(Math.round(st.rpm / 10) * 10), w - 22, h * 0.45);
    c.fillStyle = '#7f8796'; c.font = '700 20px Helvetica, Arial, sans-serif'; c.fillText('RPM', w - 24, h * 0.64);
    // bottom row: ERS store, brake bias, lock warning
    c.fillStyle = '#121722'; c.fillRect(14, h - 54, w - 28, 40);
    c.textAlign = 'left'; c.fillStyle = '#ffc20e'; c.font = '700 22px Helvetica, Arial, sans-serif';
    c.fillText(`ERS ${Math.round(st.ers * 100)}%`, 26, h - 34);
    c.fillStyle = '#29d36a'; c.fillRect(150, h - 42, 110 * st.ers, 16);
    c.strokeStyle = '#3a4254'; c.lineWidth = 2; c.strokeRect(150, h - 42, 110, 16);
    c.textAlign = 'right'; c.fillStyle = st.lock ? '#ffa400' : '#cfd3dc';
    c.fillText(st.lock ? 'LOCK' : `BB ${(st.bias * 100).toFixed(1)}`, w - 26, h - 34);
    dispTex.needsUpdate = true;
  }
  function update(st) {
    // LEDs: green 1-5, red 6-10, blue 11-15 from 9,600 rpm to the shift point; all flash blue at
    // the limiter. Side LEDs: amber when a tyre locks or spins, white on the pit limiter (N).
    const f = (st.rpm - 9600) / (SHIFT_RPM - 9600);
    const n = Math.max(0, Math.min(15, Math.round(f * 15)));
    const flash = st.rpm > SHIFT_RPM + 150 && Math.floor(st.time * 12) % 2 === 0;
    for (let i = 0; i < 15; i++) {
      let c = ledOff;
      if (flash) c = ledCol.b;
      else if (i < n) c = i < 5 ? ledCol.g : i < 10 ? ledCol.r : ledCol.b;
      leds.setColorAt(i, c);
      glows.setColorAt(i, c === ledOff ? glowOff : tmpC.copy(c).multiplyScalar(glowK));
    }
    for (let k = 0; k < 6; k++) {
      const c = st.lock && Math.floor(st.time * 10) % 2 === 0 ? ledCol.a : st.gear === 'N' ? ledCol.w : ledOff;
      leds.setColorAt(15 + k, c);
      glows.setColorAt(15 + k, c === ledOff ? glowOff : tmpC.copy(c).multiplyScalar(glowK));
    }
    leds.instanceColor.needsUpdate = true; glows.instanceColor.needsUpdate = true;
    // display at ~15 Hz (only when something visible changed)
    dispAcc += st.dt || 0;
    const key = `${st.gear}|${st.kmh}|${Math.round(st.rpm / 50)}|${Math.round(st.ers * 50)}|${st.lock ? 1 : 0}|${st.limiter ? 1 : 0}|${Math.round(st.bias * 1000)}`;
    if (dispAcc > 1 / 15 && key !== lastKey) { dispAcc = 0; lastKey = key; drawDisplay(st); }
    solveArms();
  }
  drawDisplay({ rpm: 4300, gear: 'N', kmh: 0, ers: 1, bias: 0.57, lock: false, limiter: false });
  // draw-call reduction: the wheel's static parts and each glove's parts are merged per
  // material (the display, LEDs and printed labels stay separate: they change or blend)
  mergeStatic(W, new Set(['swScreen', 'swLeds', 'swLedGlow', 'swLabels']));
  for (const h of hands) mergeStatic(h.group);
  solveArms();
  return { wheel: W, arms: armsG, update, hands };
}

// Merge the direct child meshes of a group that share a material into one mesh each (static
// sub-groups flagged userData.flatten are folded into the group first).
function mergeStatic(grp, keep = new Set()) {
  for (const c of [...grp.children]) {
    if (!c.isGroup || !c.userData.flatten) continue;
    c.updateMatrix();
    for (const k of [...c.children]) {
      k.updateMatrix(); k.matrix.premultiply(c.matrix);
      k.matrix.decompose(k.position, k.quaternion, k.scale);
      grp.add(k);
    }
    grp.remove(c);
  }
  const byMat = new Map();
  for (const c of grp.children) {
    if (!c.isMesh || c.isInstancedMesh || keep.has(c.name) || c.material.transparent) continue;
    if (!byMat.has(c.material)) byMat.set(c.material, []);
    byMat.get(c.material).push(c);
  }
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;
    const geoms = list.map((m) => {
      m.updateMatrix();
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      g.applyMatrix4(m.matrix);
      return g;
    });
    const merged = mergeGeoms(geoms);
    merged.computeBoundingSphere();
    const mm = new THREE.Mesh(merged, mat);
    mm.name = list[0].name + '+'; mm.castShadow = list.some((m) => m.castShadow);
    for (const m of list) grp.remove(m);
    grp.add(mm);
  }
}

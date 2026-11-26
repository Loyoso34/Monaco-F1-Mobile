// Red Bull Racing RB20 (2024), Monaco high-downforce specification.
// Single source of truth for the visual model, the wheels / steering pivots, the physics and
// the collision geometry. All values in metres, in ONE coordinate system:
//
//   Car frame: origin on the ground plane (static ride height), laterally on the car's
//   centreline, longitudinally at the centre of gravity.  +x = right, +y = up, -z = forward.
//
// Provenance flags (see docs/CAR_DIMENSIONS.md for the full table and method):
//   P = published (Pirelli / FIA documentation)          R = regulatory bound (2022-25 rules)
//   M = measured from photographs, scaled by the 720 mm tyre diameter
//   E = estimate (several reference views, engineering judgement)

const FA_TO_CG = 1.946;          // CG behind the front axle (45.5 % static front weight) [E]

export const SPEC = {
  name: 'RB20',
  massKg: 805,                   // 798 kg minimum incl. driver (R) + ~7 kg qualifying fuel [E]
  wheelbase: 3.570,              // [M] 3.51–3.56 photo + foreshortening, reg max 3.600 [R]
  frontToCG: FA_TO_CG,
  cgHeight: 0.275,               // [E]
  overallLength: 5.630,          // [M] front wing LE -> rear wing TE
  overallWidth: 2.000,           // [R] maximum, outer faces of the rear tyres
  frontOverhang: 1.420,          // [M] front axle -> front wing leading edge
  rearOverhang: 0.640,           // [M] rear axle -> rear wing trailing edge
  trackFront: 1.676,             // [E] tyre centres (outer face at 0.991 m)
  trackRear: 1.595,              // [E] tyre centres (outer face at 1.000 m)
  tyre: {
    front: { diameter: 0.720, width: 0.305 },    // [P] Pirelli 305/720-R18
    rear: { diameter: 0.720, width: 0.405 },     // [P] Pirelli 405/720-R18
    rimDiameter: 0.4572,                          // [P] 18 in
    loadedRadius: 0.352,                          // [E] ~8 mm static deflection
  },
  noseTipAheadFA: 1.270,         // [M] nose tip ahead of the front axle
  noseTipHeight: 0.215,          // [M] centre of the nose tip above ground
  noseHeightAtFA: 0.505,         // [M] top of the chassis above the front axle line
  frontWingSpan: 1.860,          // [E] endplate outer faces; reg bound 2.000 [R]
  floorWidth: 1.800,             // [E] widest point of the floor plank-to-edge
  rideHeightFront: 0.030,        // [E] Monaco (raised) static
  rideHeightRear: 0.060,         // [E]
  cockpitOpeningFrontFA: 1.050,  // [M] behind front axle
  cockpitOpeningRearFA: 1.840,   // [M] headrest rear edge
  cockpitWidth: 0.520,           // [E] opening width at the shoulders
  helmetCentreFA: 1.560,         // [M]
  helmetTopHeight: 0.852,        // [M] 2024 side photos: helmet top level with the halo arm
  haloApexFA: 0.940,             // [M] front pillar top joins the hoop
  haloTopHeight: 0.805,          // [M] top of the hoop at the apex
  haloRearFA: 1.700,             // [M] rear mounts
  haloRearHalfWidth: 0.395,      // [E]
  haloTubeDia: 0.049,            // [E] structural tube ~49 mm; aero fairing on top
  rollHoopFA: 1.790,             // [M] airbox inlet front face
  airboxTopHeight: 0.950,        // [R] 950 mm max height / [M]
  tcamFA: 1.885,                 // [M] T-camera lens position behind the front axle
  tcamHeight: 0.985,             // [M] lens height above ground
  sidepodInletFA: 1.000,         // [M] 2024 side photo (Austria): letterbox inlet under the overbite, just behind the mirrors
  rearWingTopHeight: 0.950,      // [R]/[M] high-downforce wing at the height limit
  rearWingSpan: 1.020,           // [E]
  beamWingHeight: 0.360,         // [E]
  steeringLockDeg: 23.0,         // [E] Monaco-specific extended lock (road wheels)
};

// Derived longitudinal positions in the car frame (z, forward is negative)
export const Z = {
  FA: -FA_TO_CG,
  RA: -FA_TO_CG + SPEC.wheelbase,
  fromFA: (q) => -FA_TO_CG + q,               // q metres behind the front axle
};
Z.noseTip = Z.FA - SPEC.noseTipAheadFA;
Z.fwLE = Z.FA - SPEC.frontOverhang;
Z.rwTE = Z.RA + SPEC.rearOverhang;

// Wheel centres (static) and steering pivots. The front kingpin axis runs through the upper
// and lower ball joints inside the rim, 0.108 m inboard of the tyre centreline (scrub radius
// ~0.09 m at the ground). The model, the physics and the steering visual all use pivotX.
const rF = SPEC.tyre.front.diameter / 2, rR = SPEC.tyre.rear.diameter / 2;
export const WHEELS = [
  { id: 'FL', front: true, left: true, x: -SPEC.trackFront / 2, y: rF, z: Z.FA, r: rF, w: SPEC.tyre.front.width, pivotX: -SPEC.trackFront / 2 + 0.108 },
  { id: 'FR', front: true, left: false, x: SPEC.trackFront / 2, y: rF, z: Z.FA, r: rF, w: SPEC.tyre.front.width, pivotX: SPEC.trackFront / 2 - 0.108 },
  { id: 'RL', front: false, left: true, x: -SPEC.trackRear / 2, y: rR, z: Z.RA, r: rR, w: SPEC.tyre.rear.width, pivotX: -SPEC.trackRear / 2 },
  { id: 'RR', front: false, left: false, x: SPEC.trackRear / 2, y: rR, z: Z.RA, r: rR, w: SPEC.tyre.rear.width, pivotX: SPEC.trackRear / 2 },
];

// T-cam (default view) and driver-eye positions, same frame.
export const CAMERA_MOUNTS = {
  tcam: { x: 0, y: SPEC.tcamHeight, z: Z.fromFA(SPEC.tcamFA), pitchDeg: -6.5, vfov16x9: 54 },
  // driver's eye at the visor: the steering wheel's LEDs, display and the gloves sit in the
  // lower part of the frame, the halo pillar in the middle, as in helmet-camera footage
  // eye 0.756 m: 0.096 m under the helmet top, which the 2024 side photos put level with the
  // halo arm; the halo crossbar then sits just above the eye line. Field of view of a helmet
  // camera (~112 deg across a 16:9 frame): halo bar across the top, pillar in the middle, both
  // front tyres beside the nose, the wheel at the bottom and both mirrors at the frame edges
  cockpit: { x: 0, y: 0.756, z: Z.fromFA(1.47), pitchDeg: -10.5, vfov16x9: 80 },
};

// Collision geometry: circles in the ground plane (x, z, radius) at the car's real
// extremities, tagged by the part they belong to so that contact damages that part.
// Heights are used to decide whether a part can touch a 1 m barrier (all can).
export function buildCollisionPoints() {
  const P = [];
  const add = (part, x, z, r, kind = 'carbon') => P.push({ part, x, z, r, kind });
  const fwZ = Z.fwLE + 0.10, epX = SPEC.frontWingSpan / 2 - 0.03;
  // front wing: endplates (front & rear corners), outer flaps, centre
  add('fwL', -epX, fwZ, 0.06); add('fwL', -epX, Z.FA - 0.62, 0.06);
  add('fwR', epX, fwZ, 0.06); add('fwR', epX, Z.FA - 0.62, 0.06);
  add('fwL', -0.55, Z.fwLE + 0.05, 0.06); add('fwR', 0.55, Z.fwLE + 0.05, 0.06);
  add('nose', 0, Z.noseTip + 0.02, 0.09);
  // survival cell front bulkhead (rigid: stops the car once the nose has crushed)
  add('tub', 0, Z.FA - 0.20, 0.12); add('tub', 0, Z.fromFA(0.9), 0.28);
  // tyres: three circles along each contact rectangle, outer face
  for (const w of WHEELS) {
    const ox = w.x + Math.sign(w.x) * (w.w / 2 - 0.09);
    const part = 'wheel' + w.id;
    add(part, ox, w.z - w.r * 0.78, 0.10, 'tyre');
    add(part, ox, w.z, 0.10, 'tyre');
    add(part, ox, w.z + w.r * 0.78, 0.10, 'tyre');
  }
  // sidepods / floor edges
  add('floorL', -0.86, Z.fromFA(1.55), 0.08); add('floorR', 0.86, Z.fromFA(1.55), 0.08);
  add('floorL', -0.80, Z.fromFA(2.45), 0.08); add('floorR', 0.80, Z.fromFA(2.45), 0.08);
  add('sidepodL', -0.70, Z.fromFA(2.0), 0.10); add('sidepodR', 0.70, Z.fromFA(2.0), 0.10);
  // rear: wing endplates, diffuser corners, crash structure
  add('rwL', -SPEC.rearWingSpan / 2, Z.rwTE - 0.04, 0.05); add('rwR', SPEC.rearWingSpan / 2, Z.rwTE - 0.04, 0.05);
  add('diffuser', -0.45, Z.RA + 0.50, 0.08); add('diffuser', 0.45, Z.RA + 0.50, 0.08);
  add('gearbox', 0, Z.RA + 0.62, 0.08);
  return P;
}

// Parts that can be damaged, with how much damage they absorb before they fail.
export const PARTS = {
  fwL: { name: 'Front wing (left)', strength: 1.0 },
  fwR: { name: 'Front wing (right)', strength: 1.0 },
  nose: { name: 'Nose', strength: 1.6 },
  wheelFL: { name: 'Front-left suspension', strength: 1.4 },
  wheelFR: { name: 'Front-right suspension', strength: 1.4 },
  wheelRL: { name: 'Rear-left suspension', strength: 1.6 },
  wheelRR: { name: 'Rear-right suspension', strength: 1.6 },
  floorL: { name: 'Floor (left)', strength: 1.6 },
  floorR: { name: 'Floor (right)', strength: 1.6 },
  sidepodL: { name: 'Sidepod (left)', strength: 2.2 },
  sidepodR: { name: 'Sidepod (right)', strength: 2.2 },
  rwL: { name: 'Rear wing (left)', strength: 1.2 },
  rwR: { name: 'Rear wing (right)', strength: 1.2 },
  diffuser: { name: 'Diffuser', strength: 1.6 },
  gearbox: { name: 'Gearbox / rear crash structure', strength: 2.4 },
};

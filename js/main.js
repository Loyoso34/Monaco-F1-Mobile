// Monaco Time Trial — application entry: loading with real progress, menu with cinematic
// views, the driving loop (240 Hz physics), pause / focus handling, reset and restart.
import { buildTrack } from './track-core.js';
import { settings, saveSettings, clearBest, loadBest, fmtTime } from './settings.js';
import { startBench, benchFrame } from './bench.js';
import { t, tReason, setLang, onLang, getLang } from './i18n.js';
import { onTap } from './tap.js';

const $ = (id) => document.getElementById(id);
const P = new URLSearchParams(location.search);
const DEBUG = {
  autopilot: P.get('autopilot') === '1', shot: P.get('shot'), noaudio: P.get('noaudio') === '1',
  start: P.get('start'), cam: P.get('cam'), quality: P.get('q'), fps: P.get('fps') === '1', s: P.get('s'),
  norender: P.get('norender') === '1', cine: P.get('cine'), bench: P.get('bench') === '1', laps: +(P.get('laps') || 1), secs: +(P.get('secs') || 150),
};

// ---------------------------------------------------------------------------------------------
// Loading screen: brand sequence (CSS), real progress on a hairline bar.
const track = buildTrack();
let progress = 0, progressKey = 'ld.loading';
function setProgress(p, key) {
  progress = Math.max(progress, p);
  $('loadBar').style.width = (progress * 100).toFixed(0) + '%';
  $('loadPct').textContent = Math.round(progress * 100) + '%';
  if (key) { progressKey = key; $('ldStatus').textContent = t(key); }
}
// language: the selector works from the first moment (also while loading); every piece of text
// built in code re-renders on a switch (onLang handlers below and in bindUI)
window.__tErr = (m) => t('err.error', { m });
document.querySelectorAll('[data-lang]').forEach((b) => onTap(b, () => setLang(b.dataset.lang)));
onLang(() => { $('ldStatus').textContent = t(progressKey); });
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

// iOS / Android only allow audio to start inside a user gesture: create and unlock the
// AudioContext on the very first tap, even while the game is still loading.
function unlockAudio() {
  if (DEBUG.noaudio) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!window.__actx) {
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
      window.__actx = new AC({ latencyHint: 'interactive' });
    }
    const ctx = window.__actx;
    const b = ctx.createBufferSource(); b.buffer = ctx.createBuffer(1, 1, ctx.sampleRate); b.connect(ctx.destination); b.start(0);
    if (ctx.state !== 'running') ctx.resume();
  } catch {}
}
window.addEventListener('pointerdown', unlockAudio, { passive: true });
window.addEventListener('touchend', unlockAudio, { passive: true });

// ---------------------------------------------------------------------------------------------
let THREE, App;
async function boot() {
  setProgress(0.04, 'ld.engine');
  THREE = await import('three');
  setProgress(0.30, 'ld.car');
  const [carmodel, carspec, physics, autopilot] = await Promise.all([
    import('./carmodel.js'), import('./carspec.js'), import('./physics.js'), import('./autopilot.js'),
  ]);
  setProgress(0.40, 'ld.circuit');
  const [trackmesh, scenery, corridor, cameras, controls, timing, hud, fx, audio, perf, envmap, mirrors, lighting, carenv, shade] = await Promise.all([
    import('./trackmesh.js'), import('./scenery.js'), import('./corridor.js'), import('./cameras.js'), import('./controls.js'), import('./timing.js'),
    import('./hud.js'), import('./fx.js'), import('./audio.js'), import('./perf.js'), import('./envmap.js'),
    import('./mirrors.js'), import('./lighting.js'), import('./carenv.js'), import('./shade.js'),
  ]);
  setProgress(0.48, 'ld.build');
  await nextFrame();
  App = await setup({ carmodel, carspec, physics, autopilot, trackmesh, scenery, corridor, cameras, controls, timing, hud, fx, audio, perf, envmap, mirrors, lighting, carenv, shade });
}

async function setup(M) {
  const canvas = $('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!DEBUG.shot });
  // colour pipeline + light balance shared with the model viewer (js/lighting.js)
  const LIGHT = M.lighting.LIGHT;
  M.lighting.setupRenderer(renderer, { toneMapping: P.get('tm') || undefined });
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xd7e2e8, 0.00085);
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.03, 6000);
  camera.layers.enable(1);                       // cockpit-only objects (skipped by the mirrors)
  camera.layers.enable(3);                       // near-only building detail (js/city.js DETAIL_LAYER)

  const tierName = DEBUG.quality || (settings.gfx === 'auto' ? M.perf.autoTier() : settings.gfx);
  // lights
  const hemi = new THREE.HemisphereLight(LIGHT.sky, LIGHT.ground, LIGHT.hemi);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(LIGHT.sunColor, LIGHT.sun);
  // tight frustum round the car: ~1 cm texels on High, so the halo, mirrors and wheels cast
  // readable shadows across the bodywork and its logos (the street scenery's shade is baked)
  sun.shadow.camera.left = -10; sun.shadow.camera.right = 10; sun.shadow.camera.top = 10; sun.shadow.camera.bottom = -10;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 140; sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.012;
  scene.add(sun); scene.add(sun.target);
  const perf = new M.perf.Perf(renderer, sun, tierName);
  const resize = () => {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);
  visualViewport?.addEventListener('resize', resize);

  // environment (reflections and image-based light on the car & water): outdoor HDR sky over
  // Monaco, and a tunnel version swapped in under the tunnel roof; built once the sun
  // direction is known (after the scenery)
  scene.environmentIntensity = LIGHT.env;
  setProgress(0.52, 'ld.build'); await nextFrame();

  const racingLine = M.autopilot.buildRacingLine(track);
  // exclusion corridor around every section of the lap: pavement widths, terrain carving and
  // the placement of every building / prop are derived from it
  const corridor = M.corridor.buildCorridor(track);
  setProgress(0.58, 'ld.build'); await nextFrame();
  const tm = M.trackmesh.buildTrackMeshes(track, { racingLine, quality: tierName, corridor });
  scene.add(tm.group);
  setProgress(0.70, 'ld.monaco'); await nextFrame();
  const sc = M.scenery.buildScenery(track, { quality: tierName, renderer, corridor });
  scene.add(sc.root);
  const envs = { outdoor: M.envmap.outdoorEnv(renderer, sc.sunDir), tunnel: M.envmap.tunnelEnv(renderer) };
  // sun and shade between the buildings: baked into the road, kerbs, barriers and fences, and a
  // shade table along the lap for the car's own sunlight
  setProgress(0.78, 'ld.monaco'); await nextFrame();
  const shadeT0 = performance.now();
  const shade = M.shade.buildShade(track, sc.buildings, sc.groundAt, sc.sunDir, { maxGround: sc.groundMax });
  {
    const shadeMeshes = [];
    tm.group.traverse((o) => { if (o.isMesh && ['ground', 'roadPaint', 'barriers', 'fence', 'roadDetail'].includes(o.name)) shadeMeshes.push(o); });
    M.shade.bakeShadeIntoMeshes(shadeMeshes, shade.shadeAt);
  }
  const carShade = M.shade.carShadeTable(track, shade.shadeAt);
  const shadeMs = performance.now() - shadeT0;
  scene.environment = envs.outdoor;
  sun.position.copy(sc.sunDir).multiplyScalar(60);
  setProgress(0.82, 'ld.rb20'); await nextFrame();
  const car = M.carmodel.createCar({ quality: tierName });
  scene.add(car.root);
  // the car's materials take their sunlight through the building-shade factor (lighting.js)
  {
    const seen = new Set();
    car.root.traverse((o) => { if (!o.isMesh) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) { if (m && !seen.has(m) && (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) { seen.add(m); M.lighting.markCarSun(m); } } });
  }
  // real-time planar reflections in both mirrors (resolution follows the graphics tier)
  const mirrors = new M.mirrors.Mirrors(renderer, scene, car.root, tierName);
  // live reflections on the car: the large surroundings (sky, buildings, terrain, landmarks,
  // road, barriers, tunnel, water) are drawn into a small cube map round the car
  {
    const RL = M.carenv.REFLECT_LAYER;
    const reflectNames = new Set(['sky', 'water', 'terrain', 'buildings', 'fairmont', 'props', 'ground', 'tunnelGround', 'barriers', 'tunnelWall', 'tunnelCeiling', 'tunnelShell', 'tunnelLamps']);
    for (const g of [sc.root, tm.group]) g.traverse((o) => { if (o.isMesh && reflectNames.has(o.name)) o.layers.enable(RL); });
  }
  const carEnv = new M.carenv.CarEnv(renderer, scene, car.root, tierName);
  perf.onTier = (t) => { mirrors.setTier(t); carEnv.setTier(t); };
  const veh = new M.physics.Vehicle(track, { assists: settings.assists });
  setProgress(0.90, 'ld.shaders'); await nextFrame();
  // place a camera near the start for the shader warm-up
  car.root.position.set(track.px[0], track.py[0], track.pz[0]);
  camera.position.set(track.px[0] + 5, track.py[0] + 3, track.pz[0] + 5); camera.lookAt(car.root.position);
  // the car's live environment first, so its materials compile once with the final setup
  carEnv.update(new THREE.Vector3(track.px[0], track.py[0] + 0.9, track.pz[0]));
  try { await renderer.compileAsync?.(scene, camera); } catch { renderer.compile(scene, camera); }
  setProgress(0.97, 'ld.almost'); await nextFrame();

  const rig = new M.cameras.CameraRig(camera);
  rig.setMode(DEBUG.cam || settings.camera || 'cockpit');
  const controls = new M.controls.Controls($('controls'));
  const timing = new M.timing.Timing(track);
  const hud = new M.hud.Hud();
  const fx = new M.fx.Fx(scene, track, { quality: tierName });
  const audio = new M.audio.AudioSystem();
  const auto = new M.autopilot.Autopilot(track, racingLine, { pace: 0.92 });

  const app = {
    THREE, M, renderer, scene, camera, sun, hemi, perf, track, tm, sc, car, veh, rig, controls, timing, hud, fx, audio, auto, mirrors, envs, carEnv, carShade, shadeMs, carSunShade: 0,
    state: 'loading', simTime: 0, acc: 0, crashT: 0, exposure: 1, daylight: 1, lightS: null,
    LIGHT, lightCols: { sky: new THREE.Color(LIGHT.sky), ground: new THREE.Color(LIGHT.ground), lamp: new THREE.Color(0xffe2bd), floor: new THREE.Color(0x3a3733) },
    cine: { idx: -1, t: 0 }, lastFrame: performance.now(), fpsShown: settings.showFps || DEBUG.fps,
  };
  return app;
}

// ---------------------------------------------------------------------------------------------
// Cinematic menu shots: Sainte Dévote, the Fairmont hairpin, the harbour (and the tunnel exit).
const SHOTS = [
  // cam: [s offset from the corner, lateral d (+ left), height]; the camera tracks the car TV-style
  { label: 'cine.devote', labelLang: 'fr', sub: ['cine.turn', { n: 1 }], corner: 'ste-devote', cam: [22, 12.5, 4.5], lead: 150, dur: 8.5, fov: 36 },
  { label: 'cine.hairpin', sub: ['cine.turn', { n: 6 }], corner: 'hairpin', cam: [4, -13, 9], lead: 95, dur: 8.5, fov: 40 },
  { label: 'cine.harbour', labelLang: 'fr', sub: ['cine.harbourSub'], subLang: 'en', corner: 'pool1', cam: [-35, 36, 11], lead: 170, dur: 9, fov: 36 },
];

function startCine(app, i) {
  const { track, veh, car } = app;
  const shot = SHOTS[i % SHOTS.length];
  app.cine.idx = i; app.cine.t = 0; app.cine.look = null;
  const c = track.corners.find(cc => cc.id === shot.corner);
  veh.reset(track.wrapS(c.s - shot.lead), app.auto.line.d[track.idxOfS(c.s - shot.lead)], { speed: 40 });
  car.repair();
  renderCineLabel(shot);
  $('cineLabel').style.opacity = '1';
}

function renderCineLabel(shot) {
  const el = $('cineLabel'); el.textContent = '';
  // proper names keep their own capitals (Turkish uppercasing would write SAİNTE DÉVOTE)
  const sm = document.createElement('small'); sm.textContent = t(shot.sub[0], shot.sub[1]);
  if (shot.subLang) sm.lang = shot.subLang;
  const nm = document.createElement('span'); nm.textContent = t(shot.label);
  if (shot.labelLang) nm.lang = shot.labelLang;
  el.append(sm, nm);
}
function menuBestText(best) { return best ? t('menu.best', { t: fmtTime(best) }) : t('menu.first'); }

function updateCine(app, dt) {
  const { track, camera, THREE } = app;
  const shot = SHOTS[app.cine.idx % SHOTS.length];
  app.cine.t += dt;
  const c = track.corners.find(cc => cc.id === shot.corner);
  const p = track.pointAt(c.s + shot.cam[0], shot.cam[1]);
  camera.position.set(p.x, p.y + shot.cam[2], p.z);
  // track the car (smoothly); before it arrives, look at the corner
  const carPos = app.car.root.position;
  const apex = track.pointAt(c.s, 0);
  const want = carPos.distanceTo(camera.position) < 160 ? new THREE.Vector3(carPos.x, carPos.y + 0.5, carPos.z) : new THREE.Vector3(apex.x, apex.y + 1, apex.z);
  if (!app.cine.look) app.cine.look = want.clone();
  app.cine.look.lerp(want, 1 - Math.exp(-dt * 5));
  camera.lookAt(app.cine.look);
  // keep the car right of centre (the menu panel covers the left of the screen)
  camera.rotateY(0.20 * (innerWidth / innerHeight > 1.6 ? 1 : 0.5));
  camera.fov = shot.fov; camera.near = 0.1; camera.updateProjectionMatrix();
  if (app.cine.t > shot.dur) startCine(app, app.cine.idx + 1);
}

// ---------------------------------------------------------------------------------------------
function show(id, on) { $(id).classList.toggle('on', on); }

function enterMenu(app) {
  app.state = 'menu';
  show('menu', true); show('hud', false); show('controls', false);
  if (!$('loading').classList.contains('on')) $('menu').classList.add('in');
  show('pause', false); show('crash', false);
  app.controls.enabled = false; app.controls.clear();
  app.audio.setEngineOn(false);
  app.fx.clear();
  app.hud.clearMessages(); app.timing.messages.length = 0;
  $('menuBest').textContent = menuBestText(app.timing.best);
  startCine(app, DEBUG.cine ? +DEBUG.cine : 0);
}

function startDriving(app) {
  app.state = 'driving';
  show('menu', false); show('hud', true); show('controls', true); show('pause', false); show('crash', false);
  $('cineLabel').style.opacity = '0';
  quickRestart(app, true);
  app.controls.enabled = true;
  app.audio.setEngineOn(true);
  app.hud.flashCamera(t('cam.' + app.rig.mode));
}

// Repaired car at the original start, timing cleared, personal best and camera preserved.
function quickRestart(app, fromMenu = false) {
  const { veh, car, timing, controls, fx, track } = app;
  const s = DEBUG.s ? +DEBUG.s : track.spawnS;
  veh.assists = settings.assists;
  veh.reset(s, DEBUG.s ? 0 : track.spawnD, { keepDamage: false });
  car.repair();
  fx.clear();
  timing.reset(); timing.teleport(veh.s);
  timing.messages.length = 0; app.hud.clearMessages();
  controls.clear();
  app.simTime = 0; app.acc = 0; app.crashT = 0;
  app.rig.chaseInit = false;
  if (!fromMenu) { show('pause', false); show('crash', false); app.state = 'driving'; app.controls.enabled = true; app.audio.resume(); app.audio.setEngineOn(true); }
}

// Stuck but driveable car -> safe position nearby, facing the right way. Damage is kept and
// the lap in progress is invalidated.
function resetCar(app) {
  const { veh, track, timing } = app;
  if (veh.damage.undriveable) return;
  let s = track.wrapS(veh.s - 8);
  veh.reset(s, 0, { keepDamage: true });
  timing.invalidate('reset'); timing.teleport(veh.s);
  app.controls.clear();
  resume(app);
}

function pause(app, reason) {
  if (app.state !== 'driving') return;
  app.state = 'paused';
  app.controls.enabled = false; app.controls.clear();
  app.audio.suspend();
  app.pauseReason = reason;
  $('pauseSub').textContent = t(reason === 'focus' ? 'pause.focus' : 'pause.sub');
  show('pause', true);
}
function resume(app) {
  show('pause', false); show('settings', false);
  if (app.veh.damage.undriveable) { app.state = 'crashed'; show('crash', true); return; }
  app.state = 'driving';
  app.controls.clear();
  app.controls.enabled = true;
  app.audio.resume();
  app.lastFrame = performance.now();
}

// ---------------------------------------------------------------------------------------------
// Damage visuals: detach broken parts as debris, bend damaged ones, misalign wheels.
function applyDamageVisuals(app, ev) {
  const { car, veh, fx } = app;
  const dm = veh.damage;
  const v = { x: veh.vx, z: veh.vz };
  const det = (obj) => { const pieces = car.detachGroup(obj); if (pieces.length) fx.addPieces(pieces, v, ev ? ev.severity : 0.5); };
  for (const side of ['L', 'R']) {
    const part = 'fw' + side;
    const outer = car.find(part + 'Outer'), inner = car.find(part + 'Inner');
    const h = dm.health[part];
    if (h < 0.3 && outer && outer.visible) det(outer);
    if (h < 0.08 && inner && inner.visible) det(inner);
    if (h < 0.85 && outer && outer.visible) outer.rotation.z = (side === 'L' ? 1 : -1) * (1 - h) * 0.12;
  }
  if (dm.health.nose < 0.3) { const n = car.parts.nose; if (n && n.visible) det(n); }
  for (const id of ['FL', 'FR', 'RL', 'RR']) {
    // broken suspension: the wheel stays on its tethers, collapsed and badly misaligned
    if (dm.wheelLost.has(id)) car.setWheelMisalign(id, (id.endsWith('L') ? 1 : -1) * 0.38, (id.endsWith('L') ? -1 : 1) * 0.42, 0.09);
    else car.setWheelMisalign(id, dm.toe[id], dm.camber[id]);
  }
  for (const side of ['L', 'R']) {
    const part = 'rw' + side;
    if (dm.health[part] < 0.3) { const g = car.parts[part]; if (g && g.visible) det(g); }
  }
  if (dm.health.rwL < 0.15 && dm.health.rwR < 0.15) { const rw = car.parts.rearWing; if (rw && rw.visible) det(rw); }
}

const STEER_RATIO = 4.4;
function syncCarVisual(app) {
  const { car, veh } = app;
  car.root.position.set(veh.x, veh.y + veh.heave, veh.z);
  car.root.rotation.set(veh.yRoadPitch, veh.psi, -veh.yRoadRoll, 'YXZ');
  const ws = veh.wheels;
  car.update({
    steerL: veh.deltaL, steerR: veh.deltaR, steer: veh.delta, speed: veh.speed,
    wheelSpin: ws.map(w => w.spin),
    travel: ws.map(w => w.travel),
    pitch: veh.pitch, roll: veh.roll, heave: 0,
    // F1 steering ratio ~4.4:1 -> ~100 deg at the steering wheel at the 23 deg Monaco lock
    steeringWheel: veh.delta * STEER_RATIO,
    brakeLight: veh.harvest > 0.25 && (Math.floor(app.simTime * 8) % 2 === 0),
    dash: {
      dt: app.frameDt || 0.016, time: app.simTime + (app.cine ? app.cine.t : 0),
      rpm: veh.rpm, kmh: Math.round(veh.speed * 3.6),
      gear: veh.reverse ? 'R' : (veh.speed < 0.6 && veh.input.throttle < 0.05 ? 'N' : String(veh.gear)),
      ers: veh.es / 4e6, bias: veh.bias || 0.57,
      lock: veh.wheels.some(w => w.locked || w.spinning), limiter: veh.rpm > 12250,
    },
  });
}

// ---------------------------------------------------------------------------------------------
function frame(app) {
  const now = performance.now();
  let dt = Math.min(0.05, (now - app.lastFrame) / 1000);
  app.frameDt = dt;
  const dtMs = now - app.lastFrame;
  app.lastFrame = now;
  const { veh, car, rig, timing, hud, audio, controls, fx, track } = app;
  const tA = performance.now();

  if (app.state === 'menu' || app.state === 'loadingDone') {
    // autopilot lap behind the cinematic camera
    const inp = app.auto.update(veh, dt);
    veh.setInput(inp.steer, inp.throttle, inp.brake);
    stepPhysics(app, dt, false);
    veh.events.length = 0;
    syncCarVisual(app);
    updateCine(app, dt);
  } else if (app.state === 'driving' || app.state === 'crashed') {
    controls.update(dt);
    let st = controls.steer, th = controls.throttle, br = controls.brake;
    if (DEBUG.autopilot || app.__autoOverride) { const a = app.auto.update(veh, dt); st = a.steer; th = a.throttle; br = a.brake; }
    if (app.state === 'crashed') { th = 0; br = 0.6; }
    const needTap = !DEBUG.noaudio && audio.ctx && audio.ctx.state !== 'running' && app.state === 'driving';
    if (needTap !== app.__needTap) { app.__needTap = needTap; $('tapAudio').style.display = needTap ? 'block' : 'none'; }
    veh.setInput(st, th, br);
    stepPhysics(app, dt, true);
    // events
    let dmgEvent = null;
    for (const e of veh.events) {
      audio.event(e);
      if (e.type === 'impact') {
        rig.impulse(e.kind === 'heavy' ? 0.9 : e.kind === 'wheel' ? 0.35 : e.kind === 'glance' ? 0.18 : 0.06);
        if (e.kind !== 'scrape') fx.fragments(e.x, e.y, e.z, { x: veh.vx, z: veh.vz }, e.severity);
        dmgEvent = e;
      }
    }
    veh.events.length = 0;
    if (dmgEvent || veh.damage.version !== app.lastDmgVer) { app.lastDmgVer = veh.damage.version; applyDamageVisuals(app, dmgEvent); }
    if (veh.contact.scrape > 0.2 && !veh.contact.tyre && Math.random() < 0.7) fx.sparksAt(veh.contact.x, veh.y + 0.15, veh.contact.z, veh.vx, veh.vz, 3);
    // plank sparks over bumps at high speed
    if (veh.speed > 62 && Math.random() < 0.08 * (veh.speed - 62) / 20) {
      const k = 0.5; fx.sparksAt(veh.x - Math.sin(veh.psi) * -1.2, veh.y + 0.02, veh.z - Math.cos(veh.psi) * -1.2, veh.vx * k, veh.vz * k, 2);
    }
    syncCarVisual(app);
    controls.setLock(veh.wheels[0].locked || veh.wheels[1].locked);
    timing.update(veh, app.simTime);
    for (const m of timing.messages) hud.message(m.key, m.vars, m.kind, m.dur);
    timing.messages.length = 0;
    if (veh.damage.undriveable && app.state === 'driving') {
      app.crashT += dt;
      if (app.crashT > 1.4) {
        app.state = 'crashed';
        $('crashMsg').textContent = t('crash.cell', { r: tReason(veh.damage.reason) });
        show('crash', true); controls.enabled = false; controls.clear();
      }
    }
    rig.update(dt, veh, car.root, car.chassis, { curb: Math.max(...veh.curb) });
    car.tcamPod.visible = rig.mode !== 'tcam';
    const hel = car.find('helmet'); if (hel) hel.visible = rig.mode !== 'cockpit';
    audio.update(dt, veh, track);
    hud.update(dt, veh, timing, app.simTime, app.fpsShown ? `${app.perf.fps} fps · ${app.renderer.info.render.calls} dc` : null);
  }
  if (app.state === 'paused') {
    // keep rendering the frozen scene (cheap) for a stable background
  }
  fx.update(app.state === 'paused' ? 0 : dt);
  // debug / inspection hook (tools/views.mjs): fixed camera at a given position
  if (app.freeCam) {
    const fc = app.freeCam;
    app.camera.position.set(fc.pos[0], fc.pos[1], fc.pos[2]); app.camera.lookAt(fc.look[0], fc.look[1], fc.look[2]);
    app.camera.fov = fc.fov || 55; app.camera.near = 0.1; app.camera.updateProjectionMatrix();
  }
  updateLighting(app, dt);
  // building detail (balconies, awnings, cornices, parapets) only within ~280 m of the camera
  {
    const cp = app.camera.position;
    if (!app._detail) { app._detail = []; app.sc.root.traverse((o) => { if (o.userData && o.userData.lodCenter) app._detail.push(o); }); }
    for (const m of app._detail) { const [x, z] = m.userData.lodCenter; m.visible = (x - cp.x) ** 2 + (z - cp.z) ** 2 < 280 * 280; }
  }
  app.sc.waterNormal.offset.x += dt * 0.004; app.sc.waterNormal.offset.y += dt * 0.0025;
  const tB = performance.now();
  if (!DEBUG.norender) {
    const cp = app.car.root.position;
    app.carEnv.update(app._envPos ? app._envPos.set(cp.x, cp.y + 0.9, cp.z) : (app._envPos = new app.THREE.Vector3(cp.x, cp.y + 0.9, cp.z)));
    app.mirrors.update(app.camera); app.renderer.render(app.scene, app.camera);
  }
  const tC = performance.now();
  const st = app.stats || (app.stats = { simMs: 0, renderMs: 0, maxSimMs: 0 });
  st.simMs += (tB - tA - st.simMs) * 0.05; st.renderMs += (tC - tB - st.renderMs) * 0.05; st.maxSimMs = Math.max(st.maxSimMs * 0.999, tB - tA);
  if (app.rig.mode !== app.__hudCam) { app.__hudCam = app.rig.mode; $('hud').classList.toggle('cockpitView', app.rig.mode === 'cockpit'); }
  app.perf.frame(dtMs, settings.gfx === 'auto' && !DEBUG.quality && !app.benchNoAdapt);
  if (app.bench) benchFrame(app, dtMs);
  requestAnimationFrame(() => frame(app));
}

// Fixed 240 Hz sub-steps from an accumulator. The driver's inputs are sampled once per frame;
// across this frame's sub-steps they move linearly from the previous frame's values to the new
// ones, so a thumb movement reaches the tyres as the same ramp whatever the frame rate (with a
// step change per frame, 30 fps and 60 fps drove measurably different lines).
function stepPhysics(app, dt, timed) {
  const H = 1 / 240, veh = app.veh, inp = veh.input;
  const tgt = [inp.steer, inp.throttle, inp.brake];
  const prev = app.prevInput || tgt;
  app.acc += dt;
  const n = Math.min(14, Math.floor(app.acc / H));
  for (let j = 0; j < n; j++) {
    const f = (j + 1) / n;
    veh.setInput(prev[0] + (tgt[0] - prev[0]) * f, prev[1] + (tgt[1] - prev[1]) * f, prev[2] + (tgt[2] - prev[2]) * f);
    veh.step(H); app.acc -= H; if (timed) app.simTime += H;
  }
  if (n >= 14) app.acc = 0;
  veh.setInput(tgt[0], tgt[1], tgt[2]);
  app.prevInput = tgt;
}

// Tunnel lighting. daylightAt() is the share of daylight at a point of the lap: 1 in the open,
// falling smoothly over the first ~18 m inside each portal (daylight spill) to the level of the
// luminaires. The lights on the car follow the camera position directly (sun, sky, reflections,
// warm luminaire fill); the exposure adapts with a lag like a broadcast camera or the eye:
// slower when it has to open up entering the tunnel, faster when it closes down at the exit
// (so the exit is briefly over-exposed, then settles).
const TUNNEL_EXPOSURE = 2.4;
function daylightAt(track, s) {
  const [a, b] = track.tunnelS;
  const edge = Math.min(track.deltaS(a, s), track.deltaS(s, b));   // metres inside the nearest portal
  const t = Math.max(0, Math.min(1, (edge + 6) / 24));
  return 1 - t * t * (3 - 2 * t);
}
function updateLighting(app, dt) {
  const { veh, track, sun, hemi, renderer, scene, camera } = app;
  const pr = track.project(camera.position.x, camera.position.z, veh.s, app._lp || (app._lp = {}));
  const sCam = pr.ok && Math.abs(pr.d) < 40 ? pr.s : veh.s;
  const dl = daylightAt(track, sCam);
  const tk = 1 - dl;
  app.daylight = dl;
  const L = app.LIGHT;
  // the sun keeps lighting the world outside (the street seen through the portals and in the
  // mirrors stays sun-lit, so the exit blows out at the tunnel exposure); only the car's own
  // sunlight goes: in a building's shadow (baked table, a quick soft transition) and under the
  // tunnel roof (the daylight at the car's position)
  sun.intensity = L.sun;
  {
    const want = app.carShade ? app.carShade.at(veh.s, veh.d) : 0;
    const k = dt <= 0 ? 1 : 1 - Math.exp(-dt / 0.06);
    app.carSunShade += (want - app.carSunShade) * k;
    // in a street's shade a quarter of the sun is kept: the light bounced off the sun-lit
    // facades and the road onto the car - its dark navy stays readable as navy, not black
    const carDay = daylightAt(track, veh.s);
    app.M.lighting.CAR_SUN.value = (1 - 0.75 * app.carSunShade) * (0.03 + 0.97 * carDay);
  }
  // under the roof the camera opens up (TUNNEL_EXPOSURE): the lights on the car are scaled
  // down by the same factor, so it is lit as before while the sun-lit exit blows out
  const kx = 1 + (1.75 / TUNNEL_EXPOSURE - 1) * tk;
  hemi.intensity = L.hemi * (1 - 0.55 * tk) * kx;    // tunnel: warm luminaire fill
  hemi.color.copy(app.lightCols.sky).lerp(app.lightCols.lamp, tk);
  hemi.groundColor.copy(app.lightCols.ground).lerp(app.lightCols.floor, tk);
  // reflections: the outdoor sky until the camera is well under the roof, then the tunnel
  const envWanted = tk > 0.55 ? app.envs.tunnel : app.envs.outdoor;
  if (scene.environment !== envWanted) scene.environment = envWanted;
  scene.environmentIntensity = (tk > 0.55 ? L.env * (0.3 + 0.3 * tk) : L.env * (1 - 0.6 * tk)) * kx;
  // the camera opens up under the roof (the interior is built dim, see trackmesh.js TUN): the
  // luminaire rows glare, the concrete reads mid-grey and the exit is a blown-out opening
  const target = 1.0 + (TUNNEL_EXPOSURE - 1) * tk;
  const jump = app.lightS === null || Math.abs(track.deltaS(app.lightS, sCam)) > 40;
  if (dt <= 0 || jump) app.exposure = target;                 // camera cut / teleport: no lag
  else app.exposure += (target - app.exposure) * (1 - Math.exp(-dt / (target > app.exposure ? 0.6 : 0.3)));
  app.lightS = sCam;
  renderer.toneMappingExposure = app.exposure;
  app.sc.sky.material.uniforms.expo.value = app.exposure;
  // shadow camera follows the car
  const c = app.car.root.position;
  sun.target.position.copy(c);
  sun.position.copy(c).addScaledVector(app.sc.sunDir, 60);
  sun.target.updateMatrixWorld();
}

// ---------------------------------------------------------------------------------------------
function bindUI(app) {
  const tapAudio = () => { if (!DEBUG.noaudio) app.audio.start().catch(() => {}); };
  // first tap anywhere starts the audio system (mobile autoplay rules)
  const first = () => { tapAudio(); };
  window.addEventListener('pointerdown', first, { once: false, passive: true });
  window.addEventListener('touchend', first, { passive: true });

  // every button acts on the first tap (js/tap.js); state guards make a stray repeat harmless
  onTap($('btnDrive'), () => { if (app.state !== 'menu') return; tapAudio(); startDriving(app); });
  onTap($('btnSettings'), () => openSettings(app));
  onTap($('btnPause'), () => pause(app, 'button'));
  onTap($('btnResume'), () => { if (app.state !== 'paused') return; tapAudio(); resume(app); });
  onTap($('btnRestart'), () => { tapAudio(); quickRestart(app); });
  onTap($('btnReset'), () => { if (app.state !== 'paused') return; tapAudio(); resetCar(app); });
  onTap($('btnPauseSettings'), () => openSettings(app));
  onTap($('btnMenu'), () => enterMenu(app));
  onTap($('btnCrashRestart'), () => { tapAudio(); quickRestart(app); });
  onTap($('btnCrashMenu'), () => enterMenu(app));
  onTap($('btnCam'), () => {
    const modes = app.M.cameras.CAM_MODES;
    const next = modes[(modes.indexOf(app.rig.mode) + 1) % modes.length];
    app.rig.setMode(next); settings.camera = next; saveSettings();
    app.hud.flashCamera(t('cam.' + next));
  });
  // a language switch re-renders all text built in code, wherever the game is
  onLang(() => {
    if (app.state === 'menu') { $('menuBest').textContent = menuBestText(app.timing.best); renderCineLabel(SHOTS[app.cine.idx % SHOTS.length]); }
    $('pauseSub').textContent = t(app.pauseReason === 'focus' ? 'pause.focus' : 'pause.sub');
    if (app.veh.damage.undriveable) $('crashMsg').textContent = t('crash.cell', { r: tReason(app.veh.damage.reason) });
    if ($('settings').classList.contains('on')) $('btnClearBest').textContent = t(app.__bestCleared ? 'set.cleared' : 'set.clear');
    app.hud.relabel();
    if (app.hud.camLabelT > 0) app.hud.flashCamera(t('cam.' + app.rig.mode));
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyC') $('btnCam').click();
    if (e.code === 'KeyP' || e.code === 'Escape') { if (app.state === 'driving') pause(app, 'button'); else if (app.state === 'paused') resume(app); }
    if (e.code === 'KeyR' && app.state === 'driving') resetCar(app);
  });
  // focus loss: pause the simulation, freeze the timer, clear touches, wait for Resume
  const lost = () => { app.controls.clear(); if (app.state === 'driving') pause(app, 'focus'); else app.audio.suspend(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) lost(); else if (app.state === 'menu') app.audio.resume(); });
  window.addEventListener('blur', lost);
  window.addEventListener('pagehide', lost);
  // orientation: portrait shows the rotate prompt (CSS); treat it like a pause
  matchMedia('(orientation: portrait)').addEventListener?.('change', (e) => { if (e.matches) lost(); });
}

function openSettings(app) {
  const panel = $('settings');
  const bindRange = (id, out, key, fmt) => {
    const el = $(id), o = $(out);
    el.value = settings[key]; o.textContent = fmt(settings[key]);
    el.oninput = () => { settings[key] = +el.value; o.textContent = fmt(settings[key]); saveSettings(); app.audio.applyVolumes(); };
  };
  bindRange('sSteer', 'oSteer', 'steerSens', v => v.toFixed(2));
  bindRange('sVol', 'oVol', 'master', v => Math.round(v * 100));
  bindRange('sEng', 'oEng', 'engine', v => Math.round(v * 100));
  bindRange('sFx', 'oFx', 'fx', v => Math.round(v * 100));
  const seg = (id, key, onSet) => {
    const el = $(id);
    const sync = () => el.querySelectorAll('button').forEach(b => b.classList.toggle('on', String(settings[key]) === b.dataset.v || (key === 'camera' && app.rig.mode === b.dataset.v)));
    el.querySelectorAll('button').forEach(b => onTap(b, () => {
      settings[key] = key === 'showFps' ? b.dataset.v === '1' : b.dataset.v;
      if (key === 'showFps') settings[key] = b.dataset.v === '1';
      saveSettings(); onSet && onSet(settings[key]); sync();
    }));
    sync();
  };
  seg('segCam', 'camera', (v) => { app.rig.setMode(v); });
  seg('segGfx', 'gfx', (v) => { app.perf.setTier(v === 'auto' ? app.M.perf.autoTier() : v); });
  seg('segAssist', 'assists', (v) => { app.veh.assists = v; });
  $('segFps').querySelectorAll('button').forEach(b => b.classList.toggle('on', (settings.showFps ? '1' : '0') === b.dataset.v));
  $('segFps').querySelectorAll('button').forEach(b => onTap(b, () => { settings.showFps = b.dataset.v === '1'; app.fpsShown = settings.showFps; $('fps').style.display = app.fpsShown ? 'block' : 'none'; saveSettings(); $('segFps').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); }));
  app.__bestCleared = false; $('btnClearBest').textContent = t('set.clear');
  onTap($('btnClearBest'), () => { clearBest(); app.timing.best = null; app.__bestCleared = true; $('btnClearBest').textContent = t('set.cleared'); });
  onTap($('btnSettingsBack'), () => { panel.classList.remove('on'); app.__bestCleared = false; $('btnClearBest').textContent = t('set.clear'); if (app.state === 'menu') $('menuBest').textContent = menuBestText(app.timing.best); });
  panel.classList.add('on');
}

// ---------------------------------------------------------------------------------------------
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
boot().then(() => {
  const app = App;
  window.__app = app;
  bindUI(app);
  if (app.fpsShown) $('fps').style.display = 'block';
  setProgress(1, 'ld.ready');
  if (DEBUG.shot) { setupShot(app, DEBUG.shot); return; }
  app.lastFrame = performance.now();
  if (DEBUG.start === 'drive' || DEBUG.bench) startDriving(app);
  else enterMenu(app);
  if (DEBUG.bench) startBench(app, { cam: DEBUG.cam || 'tcam', laps: DEBUG.laps, secs: DEBUG.secs });
  requestAnimationFrame(() => frame(app));
  // cinematic hand-over once the brand sequence has played (>= 2.7 s after the page started):
  // the brand fades, the black lifts, the menu / car fades in
  const handover = Math.max(450, 2700 - performance.now());
  setTimeout(() => { $('loading').classList.add('out'); $('menu').classList.add('in'); }, handover);
  setTimeout(() => show('loading', false), handover + 1050);
  window.__ready = true;
}).catch((e) => {
  console.error(e);
  const el = $('err'); el.style.display = 'block'; el.textContent = t('err.start', { m: e && e.message || e });
});

// Debug helper used by tools/capture.mjs to render the loading image & corner thumbnails
function setupShot(app, name) {
  show('loading', false); show('menu', false);
  $('loading').classList.add('out');
  const { track, camera, veh, car } = app;
  const shots = {
    'loading': { corner: 'ste-devote', s: -62, d: 5.5, h: 7.5, look: [18, -2, 0.5], car: -18 },
    'corner-ste-devote': { corner: 'ste-devote', s: -55, d: 5, h: 6, look: [18, -2, 0.5], car: -14 },
    'corner-casino': { corner: 'casino', s: -48, d: -2, h: 6, look: [12, 0, 1.5], car: -14 },
    'corner-hairpin': { corner: 'hairpin', s: -15, d: -14, h: 14, look: [0, 0, 0], car: -2 },
    'corner-tunnel': { corner: 'tunnel', s: 180, d: 1.5, h: 2.2, look: [240, 0, 1.2], car: 205, tunnel: true },
    'corner-pool': { corner: 'pool1', s: -55, d: 3, h: 8, look: [20, -1, 0.5], car: -12 },
    // key art for the loading screen (assets/hero.webp): the RB20 low and close, at speed
    // (Swimming Pool: palms, the harbour-side blocks and the banners behind the car)
    'hero': { corner: 'pool1', s: -27.2, d: -2.9, h: 0.55, look: [-33.2, -0.65, 1.25], car: -34.2, fov: 38, speed: 55 },
  };
  if (name === 'map') {
    const cam = new app.THREE.OrthographicCamera(-700, 700, 700 * innerHeight / innerWidth, -700 * innerHeight / innerWidth, 1, 3000);
    cam.position.set(180, 1500, 0); cam.up.set(0, 0, -1); cam.lookAt(180, 0, 0);
    app.renderer.render(app.scene, cam);
    window.__info = { buildings: app.sc.nBuildings, rej: app.sc.rej };
    window.__ready = true; return;
  }
  const sh = shots[name] || shots.loading;
  const c = track.corners.find(cc => cc.id === sh.corner);
  veh.reset(track.wrapS(c.s + sh.car), 0.5, { speed: sh.speed || 0 });
  syncCarVisual(app);
  if (sh.speed) { const hel = car.find('helmet'); if (hel) hel.visible = true; }
  const p = track.pointAt(c.s + sh.s, sh.d);
  camera.position.set(p.x, p.y + sh.h, p.z);
  const l = track.pointAt(c.s + sh.look[0], sh.look[1]);
  camera.lookAt(l.x, l.y + sh.look[2], l.z);
  camera.fov = sh.fov || 50; camera.near = 0.05; camera.updateProjectionMatrix();
  updateLighting(app, 0);
  { const cp = car.root.position; app.carEnv.update(new app.THREE.Vector3(cp.x, cp.y + 0.9, cp.z)); }
  app.mirrors.update(camera); app.mirrors.update(camera);
  app.renderer.render(app.scene, camera);
  window.__ready = true;
}

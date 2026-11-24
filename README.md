# Monaco Time Trial — RB20

A mobile-first 3D Formula 1 time trial around the **Circuit de Monaco** in a **2024 Red Bull
Racing RB20** (Monaco high-downforce specification). Landscape, two thumbs, opens straight from a
link. Static site — no build step; three.js r170 is vendored.

**Play:** https://loyoso34.github.io/Monaco-F1-Mobile/ *(live once GitHub Pages is enabled — see
[Publishing](#publishing))*

![Default onboard T-cam, approaching Casino Square](docs/img/onboard-tcam-casino.webp)

## Driving

* **Left thumb:** steering zone — put your thumb down anywhere in it and slide left/right; let go
  and the wheel recentres.
* **Right thumb:** **Brake** and **Throttle** pedals. Press higher on a pedal for more; slide from
  throttle to brake and the throttle releases instantly.
* **Automatic 8-speed gearbox** (gear on the HUD). Hold the brake at a standstill to engage
  reverse; touch the throttle to go forward again.
* Top-right: **camera** (T-cam → Cockpit → Chase) and **pause** (Resume, Quick Restart, Reset Car,
  Settings, Return to Menu).
* Keyboard (desktop): arrows / WASD, C camera, P pause, R reset car.

**Rules:** timing starts on your first forward crossing of the line; a lap counts after every
checkpoint in order and a forward crossing. Cutting the Nouvelle Chicane or either Swimming
Pool chicane shows "Lap invalid — corner cut." — keep going and a fresh lap starts at the line.
Reset Car keeps damage and invalidates the lap; Quick Restart repairs the car and clears timing.
Your best valid lap is saved on the device.

## What's inside

| Area | Highlights |
|---|---|
| **Car** (`js/carspec.js`, `js/carmodel.js`, `js/livery.js`) | Procedural RB20 built from a measured dimension sheet ([docs/CAR_DIMENSIONS.md](docs/CAR_DIMENSIONS.md)): lofted survival cell with real cockpit opening, nose cross-sections, 4-element front wing with endplates, pull-rod/push-rod suspension on real pick-ups, steering about the kingpin, halo with pillar, mirrors, driver, RB20 sidepods with undercut, floor, diffuser, Monaco rear wing + beam wing, soft tyres, livery painted at measured positions. |
| **Camera** (`js/cameras.js`) | Broadcast **T-cam on the roll hoop** (1.885 m behind the front axle, 0.985 m high) is the default; driver-eye cockpit and chase cams. Rigidly anchored to the chassis; wide-screen FOV keeps 16:9 proportions. |
| **Audio** (`js/engine-worklet.js`, `js/audio.js`) | Synthesised V6 turbo-hybrid in an AudioWorklet driven by rpm, load and gear (shift cuts, blips, overrun, MGU-K, turbo), tyre scrub, wind, kerbs, scrapes, impacts and tunnel reverb. See [docs/TRACK_AND_AUDIO.md](docs/TRACK_AND_AUDIO.md). |
| **Circuit** (`js/track-core.js`, `js/trackmesh.js`, `js/scenery.js`) | Geo-referenced centre line scaled to 3,337 m, 43 m of elevation, kerbs, armco and catch fences, braking boards, pit lane, tunnel, harbour with yachts, grandstands, Casino, Fairmont, the Rock and the Palace. |
| **Physics** (`js/physics.js`, `js/damage.js`) | 240 Hz planar dynamics, load-sensitive tyres with combined slip, speed-dependent downforce, brake-by-wire with migration, fuel-flow-limited power + ERS, barrier contact with friction at the real extremities, frangible wings/nose/wheels, survival cell. |
| **Game** (`js/main.js`, `js/controls.js`, `js/timing.js`, `js/hud.js`) | Loading with real progress and corner previews, cinematic menu, HUD, settings, pause on focus loss, portrait prompt, PWA. |

## Publishing

The repository is **private** (this was the only option available to the session that created
it). GitHub Pages serves private repositories only on paid plans, so:

1. **Settings → General → Danger Zone → Change visibility → Public** (or keep it private on a
   plan that includes Pages for private repositories).
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main`,
   folder `/ (root)` → Save.**
3. After about a minute the game is live at **https://loyoso34.github.io/Monaco-F1-Mobile/**.
   On iPhone, Share → *Add to Home Screen* gives a full-screen landscape app.

Every path is relative, so the site works from the project sub-path; `.nojekyll` makes Pages
serve the files as they are. The service worker fetches code network-first, so a normal reload
picks up new versions.

## Development

```bash
node tools/serve.mjs 8080             # then open http://localhost:8080
node tools/gameplay-test.mjs out      # emulated-phone acceptance tests
node tools/sim-lap.mjs 3              # headless physics laps with the test driver
node tools/track-report.mjs           # circuit geometry report
node tools/shots.mjs out side,front,top,rear34,tcam   # model validation renders
node tools/capture.mjs                # re-render the loading images from the game
```

Debug URL parameters: `?start=drive`, `?cam=chase`, `?q=low|medium|high`, `?fps=1`,
`?autopilot=1`, `?noaudio=1`.

See [docs/TESTING.md](docs/TESTING.md) for the test matrix, performance numbers and what still
needs a physical-phone check.

## Credits and licences

* Circuit trace: [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) (MIT).
* [three.js](https://threejs.org) r170 (MIT), vendored in `vendor/three/`.
* All textures, models and sounds are generated procedurally by this project.
* This is an unofficial, non-commercial fan project. Team, sponsor and supplier names appear as
  plain-text approximations of the 2024 livery for realism; they belong to their respective
  owners and no official artwork or logos are included.

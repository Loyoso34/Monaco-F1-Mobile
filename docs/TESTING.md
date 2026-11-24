# Testing report

## What was tested, and how

All testing so far ran in a cloud container **without a physical phone and without a GPU**:
Chromium (Playwright) with mobile emulation and software WebGL (SwiftShader). There is no WebKit
engine in the container, so **iPhone Safari itself has not been exercised** — the iPhone runs
below use Chromium with the iPhone 15 Pro Max user agent, viewport (956 × 440 CSS px landscape,
the size of the Pro Max class including the iPhone 18 Pro Max) and touch emulation.

| Environment | Engine | Result |
|---|---|---|
| Emulated iPhone (956 × 440, touch, iOS UA) | Chromium 1243 + SwiftShader | 33 / 33 acceptance checks pass |
| Emulated Android Chrome (Pixel 7, 915 × 412, touch) | Chromium 1243 + SwiftShader | 33 / 33 acceptance checks pass |
| Node.js physics (no browser) | V8 | 3 autopilot laps, 0 contacts, 79.0 s (pace 1.0) |

Run them yourself:

```bash
node tools/serve.mjs 8080                    # local server
node tools/gameplay-test.mjs out iphone      # 33 acceptance checks (emulated)
node tools/gameplay-test.mjs out android
BASE_URL=https://loyoso34.github.io/Monaco-F1-Mobile/ node tools/gameplay-test.mjs out iphone   # against the live site
node tools/sim-lap.mjs 3                     # headless physics laps
node tools/track-report.mjs                  # circuit geometry checks
node tools/perf-probe.mjs                    # draw calls, CPU per frame, memory over laps
```

## Acceptance checks (`tools/gameplay-test.mjs`)

Cold launch (loading screen → menu with Drive and Settings) · default camera is the T-cam · car
spawns before the line with timing stopped · touch targets kept ≥ 18 px from the edges ·
steering starts anywhere in its zone and works while the throttle is held · sliding the throttle
thumb onto the brake releases the throttle immediately · released steering recentres · page
gestures are prevented on the driving surface · timing starts on the first forward crossing ·
automatic upshifts (7 by Sainte Dévote) · HUD shows the gear · focus loss pauses the simulation,
freezes the timer and clears touches; Resume continues · a full lap is only recorded after all
checkpoints and a forward crossing · best lap saved locally · Fairmont hairpin taken in one
continuous turn at the full 23° lock · engine pulls through the tunnel (≈100 → 262 km/h, 2nd →
8th) · six individual downshifts into the Nouvelle Chicane · completed time displayed while the
next lap runs · cutting the Nouvelle Chicane shows "Lap invalid — corner cut." immediately ·
reversing over the line never starts a lap · Reset Car moves the car 8 m back to the centre line
facing the right way, keeps damage, invalidates the lap · glancing scrape on the pit wall at
~210 km/h: contact, slide along the wall, car continues · heavy frontal impact at 108 km/h breaks
the wing, crushes the nose and collapses the front suspension; the survival cell stops the car;
the run ends with Quick Restart offered · Quick Restart restores a repaired car at the start,
clears timing, keeps the personal best and the camera choice · personal best restored after a
fresh reload · portrait shows "Rotate your phone to play." · no uncaught errors.

## Performance (measured in emulation)

| Measure | Result |
|---|---|
| Draw calls per T-cam frame | 71–160 (tunnel highest) |
| Triangles per frame | 80 k – 145 k |
| Simulation + game logic per frame | 0.39 ms average, ~1.1 ms peak (240 Hz physics, container CPU) |
| Memory over 3 laps + crash + restart + 1 lap | flat (JS heap 81 → 81 MB, debris cleared) |
| Loading (local server) | ready in ~1.7 s; first download ≈ 1.3 MB (three.js 0.69 MB) |

Adaptive quality (Graphics = Auto) scales the render resolution down in steps when the 60th
percentile frame time exceeds 18.2 ms, then drops to the Medium/Low tier (smaller shadow map,
then no shadows/fences). The DOM HUD is unaffected by render scaling and stays sharp.

## Still needs a physical-phone test

* **Sustained 60 FPS on the iPhone 18 Pro Max** — not measurable here (software GPU). Check with
  Settings → Show FPS while driving several laps round the harbour and during a crash.
* **iPhone Safari specifics** — WebKit audio unlock on the first tap, `navigator.audioSession`,
  the AudioWorklet engine, home-indicator spacing, Add-to-Home-Screen full-screen mode.
* **Audio on phone speakers and headphones** — the mix was verified by spectral analysis and
  level measurement, not by ear. Listen for the engine character, shift cracks, downshift blips,
  tyre scrub under braking and the tunnel transition.
* **Thermal behaviour** over long sessions and real touch latency.

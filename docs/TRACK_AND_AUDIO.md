# Circuit de Monaco — data and processing

## Centre line

* **Source:** `tools/mc-1929.geojson` from [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits)
  (MIT licence, see `tools/f1-circuits-LICENSE.md`): a 159-point geo-referenced trace of the
  current layout, 3,328 m long.
* **Processing** (`js/track-core.js`, runs at load in ~80 ms):
  1. project WGS-84 to local metres (x east, z south) around 43.7375 N / 7.4235 E;
  2. resample every ~3 m and remove trace jitter with Taubin smoothing (no shrinkage);
  3. round the hand-traced corner vertices with local Laplacian passes where the real corner is
     larger than the trace (Tabac, Pool, Ste Dévote, Portier, Casino…);
  4. variable-width heading smoothing (30 m in the tunnel, 2.5 m at the hairpin) and
     re-integration with the closure error distributed around the lap; the result stays within
     9 m of the trace;
  5. scale to the official **3,337 m** (+0.27 %).
* **Verification against the scaled map** (`node tools/track-report.mjs`, `tools/track-proximity.mjs`):

| Corner | Lap distance | Min. centre-line radius | Width | Elevation |
|---|---:|---:|---:|---:|
| T1 Sainte Dévote | 386 m | 26 m | 11.9 m | 8.9 m |
| T3 Massenet | 946 m | 52 m | 11.0 m | 43.2 m |
| T4 Casino Square | 1,065 m | 43 m | 11.2 m | 45.5 m |
| T5 Mirabeau Haute | 1,318 m | 16 m | 11.0 m | 34.5 m |
| T6 Fairmont Hairpin | 1,449 m | 9.8 m | 11.8 m | 27.3 m |
| T8 Portier | 1,617 m | 18 m | 10.6 m | 12.8 m |
| T9 Tunnel | 1,653–2,108 m | 275 m | 10.4 m | ~11 m |
| T10–11 Nouvelle Chicane | 2,291 m | 19 m | 11.0 m | 3.2 m |
| T12 Tabac | 2,560 m | 86 m | 10.6 m | 2.8 m |
| T13–14 Swimming Pool | 2,724 m | 54 m | 11.0 m | 2.6 m |
| T15–16 Swimming Pool exit | 2,892 m | 24 m | 11.0 m | 2.5 m |
| T17–18 La Rascasse | 3,101 m | 11 m | 10.6 m | 3.3 m |
| T19 Anthony Noghès | 3,194 m | 20 m | 11.4 m | 4.1 m |

* **Elevation:** keyed by lap distance, 2.5 m (harbour) to 45.5 m (Casino Square): 43 m range
  (published elevation change: 42 m). The climb from Sainte Dévote peaks at 8.8 % on Beau
  Rivage; the drop from the hairpin to Portier reaches 11.5 %; the tunnel exit falls ~4 % into the
  braking zone of the Nouvelle Chicane.
* **Neighbouring sections:** the hairpin entry and exit run 15.8 m apart with 4 m between their
  barriers; the projection used by physics and timing is hinted by the car's own lap distance so
  close sections never get confused.
* **Barriers & run-off:** barriers sit 0.55–1.1 m beyond the kerbs except the Ste Dévote and
  Mirabeau escape roads, the Nouvelle Chicane escape road and the pool and Rascasse run-offs.
  Armco with catch fencing, advertising walls, Tecpro at the escape roads, a concrete pit wall
  and tunnel walls with lamp lines every 6 m.
* **Timing:** 12 ordered checkpoints, three cut zones (Nouvelle Chicane, both Swimming Pool
  chicanes): the lap is invalid when the car's centre goes more than 0.55 m beyond the kerb.

## Audio design

Everything is synthesised at runtime (`js/engine-worklet.js`, `js/audio.js`); there are no
samples.

**Engine (AudioWorklet).** A 1.6 L V6 four-stroke fires three times per crank revolution, so the
firing tone is `rpm / 20` Hz (575 Hz at 11,500 rpm). Each cylinder fires once per 720° with an
asymmetric exhaust pulse; deliberate cylinder-to-cylinder and bank differences produce the
half-order content (orders 1.5 and 4.5 at about −18 dB re. the firing order), which gives the V6
its growl. Load = throttle × torque state drives pulse strength, a 24 dB/oct low-pass that opens
with load, saturation and noise, so the same rpm sounds full and raspy on throttle (spectral
centroid ≈ 3 kHz) and darker with burble and misfires on the overrun (≈ 1.5 kHz). Upshifts
produce a 45 ms torque cut with an ignition-cut crack and an immediate pitch drop (the rpm follows
the new ratio); each downshift under braking produces a throttle blip and pop. Added layers: intake
roar at the airbox (the T-cam sits on it), turbo/MGU-H whistle, MGU-K whine when deploying and
loud when harvesting under braking, straight-cut gear whine, wastegate whoosh on lift, rev
limiter stutter.

**Driving feedback.** Tyre scrub from the actual slip angles and loads, lock-up/wheelspin squeal,
wind rising with v², kerb rumble modulated at speed / stripe pitch (speed-dependent), continuous
carbon-on-barrier scrape with a metallic resonance, and separate synthesised one-shots for a
carbon brush, a wheel hitting a barrier (thud + suspension clank) and a heavy impact (body thump,
crunch, debris rattle). A limiter protects phone speakers.

**Tunnel.** A convolution reverb with a synthesised impulse response (dense early reflections at
9–92 ms from walls ~5 m away, ~1.7 s tail whose highs die first) plus a short wall slap-back. The
send ramps in at the tunnel mouth after Portier and ramps out at the exit while the convolver
tail rings out naturally. Measured in Chromium (recording of the real Web Audio mix while the
autopilot drives Portier → Nouvelle Chicane): reverb return −∞ before the tunnel, −8 dB re. the
mix 0.5 s after entry, −5 to −7 dB through the tunnel, then −29 dB 0.5 s after the exit,
−50 dB at 1.5 s and −62 dB at 2 s. Narrow street sections get a subtle slap-back that depends on
the distance to the nearest wall.

**Mobile lifecycle.** The audio context is created inside the first tap (and `navigator.audioSession`
is set to `playback` where available so the ring/silent switch does not mute it). All gain
changes are ramped; noise loops are 4 s with cross-faded seams. Losing focus fades out and
suspends the context; Resume ramps back in.

**Verification tools.** `node tools/audio-render.mjs out.wav` renders the engine offline from the
autopilot physics (levels, NaN, click and spectrum checks); `node tools/audio-capture.mjs prefix`
records the full in-browser mix and the reverb return.

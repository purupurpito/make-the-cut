# notes/audio.md — js/audio.js (owner: audio)

## 1. What it is
- 100 % procedural WebAudio, no files and no network. Every effect is **synthesised once in JS** (Float32Array) and played back
  as an `AudioBuffer`: each sound costs 1 source + 1 gain (+ optional panner, + optional reverb send). No live oscillators per hit.
- Generation is **time-sliced at sample level** (review 2 fix): every generator is a `function*` that yields every 512 samples
  (16 k for cheap passes like normalize), so the budget is checked between steps of about 0.25 ms instead of between whole sounds.
  The scheduler uses `requestIdleCallback` (idle time minus 1 ms of margin; when forced by timeout only 2 ms; timeout 60 ms in
  menus, 250 ms in a match) and falls back to `setTimeout` at 3 ms per slice. Measured in real Chrome (1280x720, machine at
  100 % CPU from other agents): p50 0.25 ms, p99 0.5 ms, p99.9 1.75 ms, worst slice 5 ms. Before the fix: one step reached 18.4 ms.
- **Pre-synthesis without a gesture**: 1.2 s after `init()` the Float32 bank is synthesised in the menu's idle time (48 kHz assumed).
  No AudioContext is created and nothing plays until `unlock()`. On the first gesture the arrays are copied into AudioBuffers
  (one memcpy per step), so by the time the user clicks JUGAR the bank is usually complete and nothing is generated during the
  first serve. A gesture earlier than 1.2 s starts generation at once. Order: UI → whistle → touches → reverb → crowd → music.
- **Segmented reverb**: assigning `ConvolverNode.buffer` runs FFTs over the whole IR on the main thread (measured in Chrome:
  about 60 ms with `normalize`, 25-35 ms without, for 1.8 s stereo). The IR is now split into 6 segments of 0.3 s, each in its own
  ConvolverNode (`normalize=false`) behind a DelayNode set to its offset. The sum is the same convolution, and the convolver's
  normalisation (RMS, -58 dB at 44.1 kHz) is baked into the IR. Verified with OfflineAudioContext against the old single
  convolver: difference -101 dB (identical). One segment per step (3-4 ms on desktop), **never during a rally**
  (`g.mode === 'rally'`). Audio-thread cost of 6 convolvers is about 2 % of a core. If the context is not 48 kHz the IR is
  regenerated at the exact rate.
- `VB.Audio.ready()` returns 0..1 (AudioBuffers built / total; 0 before the gesture). `stats.synth` = sounds already synthesised
  (also before the gesture). Diagnostics: `stats.hist` (step histogram, 0.25 ms buckets), `stats.maxStepMs/maxStep`, `maxSliceMs`,
  `slow` (first 12 steps > 1.5 ms), `startedAt/synthDoneAt/unlockAt/bankDoneAt/reverbAt` (performance.now).
- The `AudioContext` is created **only** inside `unlock()` (a user gesture). Before that, every function is a silent no-op.
- It loads in node without `window`/`AudioContext` (`root = window || globalThis`).

Graph:
```
sfx ───────────────────────────────┐
crowd ─> brillo ─> hueco silbato ──┼─> fxFilter (pausa 650 Hz / cámara lenta) ─> master ─> compresor ─> compensación ─> recorte suave ─> destino
reverb (envíos) ───────────────────┘                                              ^
music (ráfagas + UI) ─────────────────────────────────────────────────────────────┘   (la música y la UI no se filtran en pausa)
```
- Master (7-nov-2026): compressor -10 dB / knee 8 / 4:1 / 3 ms / 200 ms that only touches peaks; then a gain of -2.91 dB that cancels
  the compressor's automatic makeup gain (Chrome/WebKit always add it: measured +2.91 dB with these settings, +4.42 dB with the old
  -14/10/4.5, which lifted every quiet sound too); then a WaveShaper soft clipper (linear to 0.8, full scale → 0.945, 2x oversampling).
- "Hueco silbato": a peaking EQ on the crowd bus (3.3 kHz, Q 1.1) that dips -9 dB while a whistle sounds (`whistle()` schedules it).
- Every positional sound now always goes through its StereoPanner. Before, it was only created when pan ≠ 0, and StereoPanner puts a
  centred mono at -3 dB per channel: the same hit jumped 3 dB depending on whether it fell dead centre.
- Reverb: procedural convolution IR of a pavilion (about 1.8 s, stereo, early reflections). Disabled at `quality.rank 0`.
- Stereo panning and mild distance attenuation relative to `ctx.camera` + `VB.CameraRig.getBasis()` (with guard).
- Voice limit: 32 (20 at low quality), using end-time slots (it does not depend on `onended`, which never fires while suspended).
- Muted or hidden tab → `AudioContext.suspend()` (zero CPU). Unmute or visible again → `resume()`.
- Slow motion (`ctx.timeScale < 0.95`): new sounds and the crowd beds drop in pitch (`sqrt(ts)`, min 0.6) and the
  fx bus closes its lowpass → a "dramatic slow-mo" feel. Pause: lowpass at 650 Hz, effects at 50 %, crowd at 45 %.

## 2. Event → sound map
| event | sound |
|---|---|
| `hit kind:'pass'` | forearm "thump" (low body 230→118 Hz + muffled slap). Volume and pitch rise slightly with `quality`. `shot:'shank'` → dull, ugly hit |
| `hit kind:'set'` | soft fingertip "pat" (double contact of both hands, 6 ms apart) |
| `hit kind:'free'` | medium slap; `shot:'tip'` (tip) → soft fingertips; `shot:'overhead'` → overhead touch |
| `hit kind:'serve'` | `shot:'float'`: firm open-hand slap with "pop" (volume by `speed`); `shot:'jump'`: crack like a spike |
| `hit kind:'spike'` | saturated CRACK + body + air whistle behind the ball; volume/pitch/reverb by `power`; raises crowd excitement |
| `hit human:true grade:'perfect'` | very subtle bell glint (music bus), a bit more present on spike/serve |
| `hit` after an opponent spike (a dig, < 1.2 s) | + crowd "uuuh" |
| `hit` of an unknown kind | as `pass` |
| `block` | muffled thud (two hands) + a little net rattle. `result:'stuff'` loud + roar (team 0) / "uuuh"; `'soft'` light touch; `'tool'` medium + "uuuh" |
| `toss` | the ball leaves the hand (soft swish); `jump:true` → 3 approach steps; the murmur quiets ~1.2 s and the claps stop |
| `dive` | dive: body hitting and sliding on the floor (+ squeak sometimes) |
| `netTouch` | player hitting the net (strong rattle); the whistle comes with `point` |
| `miss` | swing at air (whoosh) |
| `net` | mesh rattle (grains) + cable vibration; `tape:true` adds the "thwack" of the tape |
| `land` | floor bounce; **slam** (louder, more reverb) if `lastKind==='spike'` or `speed>13`. Ball out < 30 cm from the line → "uuuh" |
| `bounce` | dead-ball bounces (volume by speed, minimum gap 50 ms) |
| `whistle reason:'serve'` | short whistle (0.32 s): two tones (chambers ≈2.95/3.45 kHz) + pea trill 26-34 Hz + breath |
| `whistle reason:'point'` | longer whistle (0.62 s); **end of set/match** → long whistle (1.05 s) |
| `point` | crowd (local = team 0), scaled continuously by `point.highlight` (AUD-07, 8-nov-2026; see «Pulido ola 2»): home point → roar 0.40 + 0.72·h, long-ovation layer from h 0.4, burst layer + bass drum from h 0.72, applause 0.22 + 0.5·h (+ a second one from h 0.45); digs ≥ 2 → "uuuh" breaking into the roar; streak ≥ 3 → unison claps + drum that run into the home-serve claps; saved set point → relief layer. CPU point → groan (bigger for a home error / a saved CPU set point), applause of recognition from h 0.45, "uuuh" of admiration with digs ≥ 2; menu demo → polite applause |
| `fx:highfive` / `fx:fistbump` / `fx:chestbump` / `fx:clap` / `fx:catch` | celebration contacts (players `drainFx`, main.js): `slap` / `fist` / `chest` / `handclap` / soft catch pat, one sound per event (no anti-repeat), gain by `strength`, at `x, y`, through the voice-strip pool (AUD-05) |
| `dribble` | serve ritual bounce (sim SIM-04): `dribble` sound at the bounce point, gain by `speed`, one per event, pool (AUD-05) |
| `point matchWon` | double roar + long applause (or groan + polite applause if the CPU wins) |
| `set` | music sting `setWin` / `setLose` (0.8 s after, once the whistle has finished). Not for the set that closes the match |
| `match` | `matchWin` / `matchLose` sting (once per match; `gameOver` acts as a fallback if `match` did not arrive) |
| `serveReady` | arms the serve wait: **home serve** → after 0.9 s the stands clap in unison (3 claps + rest) with a bass drum, rising; **match point** → heartbeat "lub-dub" every 0.9 s |
| `newMatch` (not demo) | welcome roar + applause, 0.35 s late; cancelled before it sounds if `sting('intro')` arrives in time (AUD-06) |
| `newSet` | applause |
| `swing` | whoosh of the arm |
| `jump` | sneaker scuff on take-off |
| `landPlayer` | feet thud (louder after a spike/block), sometimes a squeak |
| `switch auto:false` | small UI "tick" |
| `sideout`, `gameOver` (if `match` already played), unknown types, `null` | nothing (safe) |
| (state) sneakers | squeak on sharp turns/stops: smoothed velocity (~0.1 s) > 3 m/s and turn angle > 75° or braking > 3.2 m/s; per-player cooldown 0.55-0.95 s |
| (state) crowd | murmur bed (loop) + excitement bed (loop) that **rises with `rally.hits` and `rally.t`**, more on set/match point; quieter while the CPU serves; brighter (lowpass) with excitement |

## 3. Public API (CONTRACT §4.4 + optional additions)
Contract (kept): `init(ctx)`, `unlock()`, `setMuted(b)`, `isMuted()`, `click()`, `onGameStart(g)`, `handle(events, g)`, `update(g, realDt)`.
**Optional additions:**
- `hover()` — soft UI sound (anti-repeat 40 ms).
- `ui(kind)` — `'click' | 'hover' | 'back' | 'start' | 'wipe' | 'intro' | 'introEnd' | 'introSkip'` (AUD-06); unknown names → nothing (before: a click).
- `setVolume(kind, v)` / `getVolume(kind)` — `kind = 'master' | 'sfx' | 'music' | 'crowd'`, `v` 0..1.
- `onSettings(settings, key)` — reads `settings.sfxVol`, `settings.musicVol`, `settings.crowdVol`, `settings.volume` (0..1) if they are numbers, and `muted`. If `crowdVol` is missing, the crowd follows `sfxVol`.
- `onState(state)` — pause/menu adjust the mix.
- `setQuality(q)` — `rank 0` → no reverb, 20 voices.
- `play(name, gain?, x?, y?)` — any sound from the catalogue (see `VB.Audio.SOUNDS`), with optional position in sim coords.
- `sting(name)` — `'setWin' | 'setLose' | 'matchWin' | 'matchLose' | 'intro'` (AUD-06: presentation).
- `introInfo()` → `{active, t}`; `voices()` → voices playing now (AUD-05/06).
- Generation: see §1 (generators with yield, idle time, pre-synthesis before the gesture, segmented reverb).
- `ready()` (0..1), `contextState()`, `stats` (`played`, `skipped`, `genMs`, `maxStepMs`), `synth(name, variant, sr)` and `synthRate(name, sr)` (pure generation, for tests).

## 5. Verification (how I checked it)
- **`node tools/audiotest.js`** (in the repo, owner audio; about 2.5 min) — see §6. Must end "TODO OK". `--before <file>` prints a
  before/after table, `--no-chrome` skips the Chrome render, `--synth-only --only a,b` for quick sound design, `--calibrate` prints the
  `LEVEL` table that puts every scenario on its target, `--seed/--secs` for the match, `--json <file>` dumps everything.
  WAVs: `tools/out/audio/<name>.wav` and `tools/out/audio/match-after.wav` (the 60 s match mix).
- (Earlier pass) Node: test harness with a simulated AudioContext:
  load without AudioContext and full API → no errors; `handle()` with every event type + `null`, `{}`, unknown types, missing fields;
  the 38 sounds synthesised with no NaN, peak ≤ 1 and no edge clicks; a full CPU-vs-CPU match (autopilot) with events → sound:
  about 136 sounds/min, max 9 simultaneous voices, 0 dropped, exactly 1 match sting.
- Headless Chrome with real WebAudio (`--autoplay-policy=no-user-gesture-required --mute-audio`): `running` context,
  sliced generation completes, every sound and sting plays, mute→`suspended`, unmute→`running`, no console errors.
- WAV files for listening: `tools/out/audio/*.wav` (they are regenerated with the harness).

## 6. Mix plan and measurements (7-nov-2026)
Nobody can listen during the build, so the mix is measured. `tools/audiotest.js` has three parts:
1. **Synth**: every sound and variant at 48 kHz: sample peak, true peak (4x oversampled windowed sinc; checked: fs/4 sine → 1.012),
   RMS, K-weighted loudness (BS.1770 filters for any rate; checked: 997 Hz at -20 dBFS → -23.01 LUFS mono), momentary max (400 ms)
   for one-shots and gated integrated loudness for long sounds, spectral centroid, HF share (> 6 kHz), LF share (< 150 Hz),
   **"phone"** = loss through a 4th-order 250 Hz high-pass (a phone/laptop speaker), edge clicks, loop seams (murmur/excite), DC, NaN.
2. **Mix plan**: the real engine runs in node against a mock AudioContext that records the graph. Representative events are fed to
   `handle()/update()` and every source that starts is rendered through its gains, filters and panners (reverb excluded; compressor =
   its makeup gain only). Level = LUFS at the output for signals under the compressor threshold. Positional sounds are measured on the
   home court ~8 m from the camera. Targets (±1.5 LU): UI -24 (hover/switch -28) · touches -18 (set/tip -21) · spike -14 · stuff
   block / slam -15 · ball on the floor and net -18 · whistle -16 · foley -24 · dead-ball bounces -26 · crowd bed -26 (rally, 4 hits) ·
   crowd reactions -20 · claps+drum and heartbeat -22 · stings -16 · perfect glint -26. All 37 scenarios pass. The per-sound trims
   live in `LEVEL` (dB) in audio.js; `--calibrate` recomputes them after any sound change.
3. **Match in Chrome**: a page with sim.js + ai.js + audio.js; `window.AudioContext` returns an OfflineAudioContext (state forced to
   'running'), suspended every 768 samples to step the real sim (autopilot, seed 7) and feed its events to the real engine; the real
   compressor and clipper are included. Four deterministic passes (full mix, whistle stem, crowd stem, everything except the whistle),
   plus an 8 s "climax" (spike, block-out, slam, final whistle, match-point roar ×2, applause and the match sting at once).

**Before → after** (`node tools/audiotest.js --before tools/out/audio/audio.before.js`; before = audio.js at commit eb950de):

| measure | before | after |
|---|---|---|
| mix-plan scenarios on target (±1.5 LU) | 5 / 37 | 37 / 37 |
| whistle (serve / point), LUFS | -8.5 / -6.7 (the loudest thing in the game) | -16 / -16 |
| spike / slam | -10.8 / -6.7 | -14 / -15 |
| set / free / jump scuff / hover | -28.7 / -23.5 / -32.7 / -34.5 | -21 / -17.9 / -24 / -29 |
| crowd bed in a rally | -17.8 (louder than a pass) | -26 |
| true peak over sample peak: spike / slam / serve | +5.5 / +3.9 / +2.3 dB (aliased saturation) | +0.1 / 0 / -0.7 |
| "phone" loss: pass / block / land / bounce / feet / slide | -11.9 / -11.6 / -12.7 / -12.8 / -19.7 / -10.9 dB | -6.5 / -6.5 / -7.5 / -6.0 / -11.5 / -5.7 |
| DC offset: feet / beat | 0.8 % / 0.9 % | 0.02 % |
| crowd bed L-R balance | +3.2 LU (serve: +4.5) | 0.1 |
| match mix (60 s, seed 7): integrated | -14.3 LUFS | -18.6 LUFS |
| match mix: momentary max / true peak | -8.2 LUFS / -1.7 dBTP | -12.6 LUFS / -3.7 dBTP |
| match mix: L-R balance | 1.3 LU | 0.15 LU |
| crowd stem integrated | -15.6 (almost as loud as the whole mix) | -21.1 |
| whistle above the crowd in its band (2.6-4.2 kHz), worst whistle | 10 dB (6.2 dB with the new levels before the EQ dip) | 14.2 dB (seed 21: 13.9) |
| climax: momentary max / true peak / clipped samples | -7.8 LUFS / -1.5 dBTP / 0 | -11.8 LUFS / -2.3 dBTP / 0 |
| voices max / avg, dropped | 8 / 3.2, 0 | 8 / 3.2, 0 |
| generation cost (node, sum of all sounds; worst step) | 1408 ms; 6.2 ms | 1444 ms; 6.5 ms (machine loaded by other agents: noise) |

The short-term loudness of the match now swings between -15 and -25 LUFS (serve waits are quiet, rallies and points rise) instead of
-11 to -19. The output sits at about -18.6 LUFS integrated, the usual level for mobile/handheld games. If Ferran wants it louder, the
single knob is `vol.master` (0.9); `MAKEUP_COMP` must stay matched to the compressor settings.
Chart: `tools/out/audio/chart.png` (short-term loudness before/after + every scenario against its target band).

**Sound changes behind the numbers**
- Impacts with saturation (serve, spike, block, slam): a 2-pole low-pass after the tanh (10.5-12.5 kHz) removes the energy next to
  Nyquist (samples alternating ±1) that produced +5.5 dBTP and a harsh fizz.
- Touches and floor hits (pass, free, serve, spike, block, land, slam, bounce, feet, bombo, beat, slide): stronger body harmonic
  (`ha`) and ball-cavity / parquet "knock" resonance (`rf`, `ra`), slightly shorter sub decay; mild saturation (drive 1.3, low-pass
  15 kHz) on pass/set/free/land/bounce lowers the crest factor by ~4 dB, so they reach their level with peaks around -3 to -6 dBFS.
- A 20 Hz DC blocker in every impact.
- Crowd plans (murmur, excite, roar, groan, ooh), applause, claps and stings: L/R energy balanced after generation (time-sliced).
- Whistle-band dip on the crowd while the whistle sounds (see §1). `switch` tick now plays `hover` at 0.3 (was 0.5) to sit at -28.

**API additions (optional)**: `VB.Audio.VARIANTS` (variants per sound), `VB.Audio.LOOPS`, `VB.Audio.LEVELS` (read-only dB plan),
`VB.Audio.synthSteps(name, variant, ctxRate)` (the sliced generator, for step-cost tests). Nothing removed or renamed.

**For the lead (TRASPASO.md is not my file)**: the line "Audio: está verificado con un arnés en node y sin errores en la página, pero
nadie lo ha escuchado en esta pasada" can become: "Audio: mezcla medida con `node tools/audiotest.js` (37 escenarios en su objetivo
LUFS ±1,5; partido de 60 s renderizado en Chrome sin recortes; silbato ≥ 14 dB sobre la grada en su banda). Falta escucharlo con
auriculares y en un móvil." `tools/audiotest.js` is new (owner audio); add it to the test list in TRASPASO / CONTRACT §6 if wanted.

## Aplicado (log)
- 6-nov-2026 (Integrate, PC de casa): ui_main ya tenía los sliders Efectos/Música, Audio.hover y Audio.ui('start'|'back'). CONTRACT §4.3 documenta los
  eventos/campos que usa el audio (toss, dive, netTouch, miss, hit.shot/power/grade, block.result, point.how). Nada pendiente.
- 6-nov-2026 (integración tras Review 2): `hit.shot === 'body'` → golpe sordo ('free' a 0,5, pitch 0,7); `courtChange` → silbato corto tras el del punto;
  `block.result 'touch'` cae en la rama de 'soft'.

- 7-nov-2026 (integración de pendientes): TRASPASO (línea de audio) y CONTRACT §1/§4.4/§6 (`tools/audiotest.js`, `VARIANTS/LOOPS/LEVELS/synthSteps`) al día.
  `node tools/audiotest.js` → TODO OK tras la integración.

## Aplicado (log, integración ronda 1 de verificación, 7-nov-2026)
- Nada pendiente. `node tools/audiotest.js` (con la comprobación nueva de clics internos) → TODO OK tras la integración.

## Ronda 2 de verificación (7-nov-2026): asignación del banco, DC, sonidos tempranos, argumentos de play()
- **Asignación (causa real medida)**: en un `function*` de V8, una variable double que pasa de una iteración a la siguiente de un bucle
  que contiene un `yield` se guarda en caja (HeapNumber) en CADA muestra, también con el código optimizado (prueba mínima en node:
  612 recolecciones menores frente a 2 con el estado en un Float64Array). No eran los Float32Array: el banco asignaba ~740 MB de basura
  para producir 10,8 MB de audio. Todos los generadores siguen ahora el mismo patrón (ver "REGLA DE ASIGNACIÓN" en audio.js): bucle
  exterior por tramos de 512 muestras con el `yield` y bucle interior sin `yield` cuyo estado se carga de / guarda en un `Float64Array`
  por tramo. El ruido usa `rnd(st)` (monomórfica) en vez del cierre `rng()`. Las envolventes de grada escriben en `o[0]` en vez de
  devolver un double. El estado de `Biq` vive en un Float64Array (`c`). Los formantes de `crowdVoice` y los filtros de `impact` van
  escritos en línea (V8 no insertaba `Biq.p()` allí). Las pasadas largas (`balanceLRG`, `normalizeG`) van en funciones normales.
  **Salida idéntica bit a bit** a la anterior en los 70 sonidos y variantes, a 48 y 44,1 kHz (salvo scuff/slide, ver DC).
- Medidas (antes → después):
  - node, todo el banco, semiespacio de 1 MB: 869 → ~420 recolecciones menores; 1,0-1,2 s → 0,76-0,86 s. Lo que queda es sobre todo la
    primera ejecución, aún sin optimizar, de cada generador (en régimen: murmur 85 → 50 ms, roar 87 → 47, spike 6 → 3).
  - Chrome, CPU ×4, partido: 0,87 → 0,22 ms por paso. Menú 103 s: 57/70 → 68/70 sonidos (la generación está limitada por el
    presupuesto de huecos, ~30 ms/s sin vsync en headless, no por la velocidad de síntesis). Paso p99 1,5 ms en los dos casos,
    p99,9 4,5 → 4,0 ms, peor paso 14,8 → 6,6 ms.
  - perf.js ALLOC=1 low cpu4: audio.js 5269 KB/s en mi medida de partida (el verificador midió 955) → 201-653 KB/s según qué se
    sintetice en la ventana. **Ojo**: el perfil de asignación muestreado de V8 cambia la optimización y hace que el código optimizado
    meta cosas en caja (en node se mide incluso en funciones normales). Los números de verdad son los de GC sin perfil: con el audio
    totalmente apagado el juego hace 29 menores / 16 mayores en 80 s; con el audio, 37-39 / 18-19 antes y después (audio ≈ +2-3
    mayores, ruido entre ejecuciones).
- Programación: entre puntos (en partido, fuera de peloteo) el `requestIdleCallback` se fuerza a los 100 ms (antes 250), con el mismo
  tramo de 2 ms. En peloteo sigue igual: 250 ms.
- **DC**: `scuff` 7e-3 → 1e-3 y `slide` 4e-3 → 2e-4, con el mismo bloqueo de 20 Hz que `impact` (`dcBlock`). Recalibrado: slide -1 → 0,7 dB,
  scuff 13,1 → 12,9 dB. Mezcla 37/37.
- **Sonidos tempranos**: `play()`/`whistle()` sin buffer aún → si el sonido está en `DEFER` (silbatos, roar, applause, groan, ooh, stings,
  start/click) se aplaza (máx. 8). Su trabajo pasa al frente (solo la variante 0, y si ya está sintetizado, al frente de la copia), los
  tramos suben a 6 ms y se pide el siguiente ya. Suena en cuanto existe, con el retraso que lleve, salvo que pase su máximo (silbato
  0,6 s, roar/applause 2,5 s), en cuyo caso se descarta (`stats.lateDrop`). En el gesto (`ensure()`), los sonidos de `DEFER` ya
  sintetizados pasan a AudioBuffer en el acto. Stats nuevas: `deferred`, `lateDrop`, `lateMax` (ms). Chrome, toque rápido (JUGAR a los
  0,3 s), CPU ×4: antes `skipped=3` y no sonaban ni el silbato ni la bienvenida. Ahora suenan el silbato (≤ 0,22 s tarde) y el aplauso.
  El roar de bienvenida solo se pierde con el banco totalmente frío (es el sonido más caro).
- **play()** sanea sus argumentos: gain no finito → 1 (y se acota a 0..4), x no finito → no posicional, y/rate/send/delay no finitos → valor
  neutro. `VB.Audio.play()` rechaza nombres que no sean propios del catálogo (`'constructor'`, `'__proto__'`, `'ir'`) y trata un gain NaN
  como el de por defecto (0,7). `bank` es `Object.create(null)`.
- `tools/audiotest.js` tiene una parte 4 (robustez, con un AudioContext simulado cuyos parámetros lanzan error con valores no finitos,
  como Chrome): play() con NaN/Infinity, toque rápido aplazado y no descartado, silbato tardío descartado, y recolecciones del banco
  (< 600). La versión anterior falla las 5 y la actual las pasa. `node tools/audiotest.js` → TODO OK. Partido en Chrome sin cambios
  (-18,6 LUFS, 150 fuentes, 0 descartadas).

## Aplicado (log, integración ronda 2 de verificación, 7-nov-2026)
- CONTRACT §4.4: `stats.deferred/lateDrop/lateMax`. `tools/audiotest.js` (sin seguimiento en git) queda para que lo añada el lead.
- Comprobado: `node tools/audiotest.js` TODO OK (mezcla 37/37, robustez 5/5, partido en Chrome 150 fuentes / 0 descartadas, silbato ≥ 14,2 dB sobre la grada).

## Aviso de sim (pulido ola 1, SIM-01): `point.highlight` para las reacciones del público (AUD-07) (2026-11-07)
Ver notes/sim.md §P1. Cada `point` trae `highlight` (0..1), `digs`, `streak`, `savedSetPoint`, `hold` (s de pausa hasta el saque).
Distribución medida: demo CPU vs CPU media 0,29 (p50 0,18, p90 0,54, ≥ 0,55 el 8 %); partido humano medio vs Normal media 0,37
(≥ 0,55 el 19 %). Errores ≤ 0,35 salvo que cierren set/partido. Sugerencia de escala: < 0,3 aplauso normal; 0,3-0,55 ovación;
≥ 0,55 ovación larga (dura hasta `hold`); ≥ 0,8 estallido (bloqueo directo o remate perfecto con punto de partido).
`savedSetPoint` = alivio/rugido de la grada; `streak ≥ 3` = cántico.

## Pulido ola 1 (7-nov-2026, owner audio): AUD-01..04
Ficheros: `js/audio.js`, `tools/audiotest.js`. Todo medido con `node tools/audiotest.js` → **TODO OK** (mezcla: los 37 escenarios de
antes siguen en su objetivo ±1,5 LU; robustez 5/5; partido de 60 s en Chrome sin cambios: -18,6 LUFS, -3,7 dBTP, 150 fuentes / 0 descartadas,
silbato ≥ 14,2 dB sobre la grada; clímax -2,3 dBTP, 0 recortes). Secciones nuevas del informe: **2b** (modelo, escenarios de las 4 tareas)
y, dentro de la 3, **«polish wave 1»** (cadena real de Chrome: compresor + recortador, escenas controladas con lechos de grada y eventos
inyectados, sin avanzar la sim, cámara a ~6 m del rematador). WAV para escuchar: `tools/out/audio/remate-bueno.wav` y `remate-perfecto.wav`.

### AUD-01 · Golpe perfecto (remate, bloqueo directo, saque en salto) y remate que revienta
- **Hallazgo medido**: el chasquido de un remate normal ya lleva el compresor general a ~3 dB de reducción y su pico de salida queda clavado
  (-3,8 dBTP). La primera versión (sub de 50 Hz por el bus normal) dejaba el remate perfecto **0,8 LU MÁS FLOJO** que el bueno en Chrome: el
  grave bombeaba el compresor y bajaba el chasquido. Subir ganancias por ese bus no se oye.
- **Diseño final**: «bus de refuerzo» (`N.punch`) que entra DESPUÉS del compresor, directo al recortador, con 6 ms de retraso (la mirada
  adelante del compresor de Chrome/WebKit: así el chasquido no se adelanta a su reverb ni a la grada) y la misma cadena de volúmenes (general,
  efectos, demo, pausa, silencio). Solo van por él capas de pico conocido, con techo calculado (`punchCap`: pico del buffer × nivel × distancia ×
  panoramizador × volúmenes ≤ techo):
  - remate perfecto del humano → `spikeHero` (sonido nuevo: el mismo chasquido con más cuerpo y palmada larga; ~3,3 dB más sonoro al mismo
    pico real, centroide 3,1 kHz frente a 2,8) por el bus de refuerzo, techo 0,6; un pelo más grave (×0,97);
  - bloqueo directo del humano → `blockHero` (igual idea, +2,6 dB de densidad), techo 0,54 (lleva además el traqueteo de la red);
  - saque en salto perfecto (versión ligera) → `spikeHero` con techo 0,5, sub y agachada al 55 %;
  - en los tres: «thump» sub `sub` (62→45 Hz, ataque de 7 ms en coseno, ~120 ms audibles, armónicos 2.º y 3.º para altavoces pequeños) por el
    bus de refuerzo con techo 0,12, 8 ms tarde (sobre la cola, no encima del pico), y **agachada de la grada** de 60 ms a -4 dB (`N.duck`, nodo
    propio en la cadena de la grada; ataque 5 ms, vuelta 35 ms).
  - El destello «perfecto» de remate y saque baja de 0,22 a 0,16 y entra 45 ms tarde: es una campana (picos de seno) y encima del contacto
    sumaba 0,21 de pico a la salida sin sumar sonoridad.
- `land` dentro tras un remate a > 13 m/s → capa de tarima `slamSub` (sonido nuevo) que crece con la velocidad (13 → 22 m/s).
- **Medidas (salida real, Chrome)**: remate perfecto vs bueno, sonoridad en los 150 ms tras el contacto **+3,3 LU** (-10,2 → -6,9 LUFS),
  pico real **-2,1 dBTP** (bueno -4,8). Bloqueo directo humano vs CPU **+3,1 LU**, -1,7 dBTP. Saque en salto perfecto **+2,0 LU** (más
  ligero que el remate), -3,7 dBTP. Remate que revienta a 23 m/s a 4 m de la cámara: -4,6 dBTP. Capa de tarima (modelo): 13 / 17,5 / 22 m/s
  → -11,3 / -10,5 / -9,8 LUFS (+1,5 LU a 22), nada si cae fuera.
- En el modelo de la parte 2 (señal pequeña, sin reducción del compresor) el perfecto sale solo +1,3 LU: es lo esperable, porque toda su
  ganancia es saltarse el compresor, que ese modelo no ve. Por eso la puerta de AUD-01 es la salida real (parte 3) y la fila del modelo es informativa.

### AUD-02 · Latido en punto de set
- `serveReady` con `setPoint ≥ 0` (y sin punto de partido) → latido a ×0,6 cada 1,0 s (partido: ×1 cada 0,9 s, como antes). Los dos
  **paran al lanzar** (`toss`), incluidos los golpes ya programados (se cancelan con `stop()`). Durante la espera, paso alto suave en la
  grada (170 Hz punto de set, 220 Hz partido; `N.crowdHp`, Q Butterworth) que vuelve a 20 Hz al lanzar.
- Medido: partido -22,0 / set -26,4 LUFS (**-4,4 LU**), periodos 0,90 / 1,00 s; punto de set y de partido a la vez → latido de partido.
- **Error previo arreglado**: tras una pausa larga en un saque de punto de partido, `beatNext` quedaba en el pasado y al reanudar salía un
  latido por frame hasta alcanzar el reloj (medido en la versión anterior: 8 golpes en 0,6 s). Ahora se resincroniza (2 golpes = un lub-dub).

### AUD-03 · Reloj de saque
- Sacador humano (`g.server.team === 0`, sin autopilot, `serveAuth`, `serveState 'ready'`, regla de 8 s activa): «toc» de madera
  (`tick`, sonido nuevo, 45 ms) al cruzar 3, 2 y 1 s de `g.serveClock`, programado con precisión de muestra hasta 40 ms antes del cruce;
  el último, más brillante (×1,22 y +1,8 dB). Coincide con el cambio de cifra de «Saca ya N s» de ui.js (`Math.ceil`). Bus de música (seco,
  sin filtro de pausa ni de cámara lenta). Nunca para la CPU.
- Lanzar antes del cruce cancela el «toc» ya programado; pausar con uno programado lo cancela y se vuelve a marcar al reanudar.
- Medido: 3 toc antes de la falta de 8 s (a 3, 2 y 1 s; error de tiempo 0,0 ms), 0 si saca a 3,5 s, 1 si saca a 2,5 s, 0 si saca a 3,02 s
  (programado y cancelado), 0 con CPU / autopilot / `serveClock:false`; nivel **-25 LUFS, 9 LU bajo el silbato** (-16).

### AUD-04 · Hit-stop (CAM-04) sin efectos en el audio
- **Error previo arreglado**: cualquier bajada de `ctx.timeScale` por debajo de 0,95 bajaba el tono de los sonidos nuevos (hasta ×0,6) y
  cerraba el filtro general (700 Hz con ts 0). El hit-stop del remate propio (antes 0,3 × 120 ms; ahora CAM-04: 0 × 35-70 ms + vuelta de
  80 ms) apagaba la cola del chasquido y los lechos de grada cambiaban de tono en cada remate.
- Ahora solo cuenta como cámara lenta una bajada que dure `SLOW_HOLD` = 0,25 s reales y no sea una congelación (`ts < 0,04`); entra con las
  mismas rampas suaves de antes. El máximo de la API de CAM-04 (150 ms + 80 ms de vuelta = 230 ms) queda dentro.
- Medido (Chrome, render comparado muestra a muestra con el de sin congelación): 0 × 70 ms, CAM-04 0 × 70 + 80 ms con la sim parada, máximo de
  la API 0 × 150 + 80 ms y el hit-stop viejo 0,3 × 120 ms → **diferencia -inf dBFS** (idéntico), 0 clics nuevos > -30 dBFS, grada Δ 0 LU,
  `lateDrop` igual. Con la versión anterior: diferencia -13,7 / -15,1 dBFS y grada Δ 0,71 / 0,97 LU (pasaba el «≤ 1 LU» por poco: por eso la
  puerta incluye además la diferencia ≤ -60 dBFS). Modelo: tono ×0,98 (jit) tras 70 ms de congelación y tras 0,25 × 220 ms; cámara lenta
  0,28 × 0,4 s → ×0,59.
- Partida real en Chrome con la cámara real (`VB.CameraRig.hitStop(70)` / `(150)`): `slowRate` se queda en 1 (12 frames con ts 0);
  `slowmo(0.28, 1.9)` entra a los 255 ms con ×0,6.

### API (todo opcional, nada roto ni renombrado)
- Sonidos nuevos en el catálogo: `spikeHero` (3 variantes), `blockHero` (3), `sub` (1), `slamSub` (2), `tick` (1). Banco: 80 trabajos (antes 70);
  recolecciones del banco en node 412 (< 600). Generación en Chrome: paso peor 2,4-4,8 ms en tres pasadas alternas con la versión anterior
  (2,5-3,5 ms): ruido de la máquina cargada.
- `stats.ticks` («toc» programados). `VB.Audio._debug()` (pruebas) → `{slowRate, lowT, tension, tickNext, duck, crowdHp}`.
- `play()` interno acepta el bus `'punch'` (no expuesto por `VB.Audio.play`).
- `tools/audiotest.js`: `PAGE_RUN` acepta `nosim`, `cam`, `gset`, `freeze {t, dur, ts, ease, sim}`; exporta `featureReport`, `chromeFeatures`,
  `pageHtml`, `PAGE_RUN`, `pcmOf`, `winLoud`, `clickTimes`, `variantsOf`. Duración total ~2 min 45 s.

### Para el integrador / lead
- CONTRACT §4.4 (añadidos de audio): `stats.ticks`, `VB.Audio._debug()`; los sonidos nuevos aparecen en `VARIANTS`/`LEVELS`.
- TRASPASO (línea de audio): «hit-stop y cámara lenta separados (el audio ignora bajadas de `timeScale` de menos de 0,25 s); golpe perfecto con
  bus de refuerzo (+3,3 LU medidos a la salida, pico -2,1 dBTP); latido en punto de set; reloj de saque en los últimos 3 s».
- Avisos en notes/camera_input.md (CAM-04) y notes/ui_main.md (UI-05). sim: nada que pedir (`block.human` y `g.serveClock` ya existen).

## De players (pulido ola 1, PLY-07 → AUD-05), 2026-11-07
- **Qué**: los contactos cosméticos de la celebración ya existen en `js/players.js`: `VB.Players.drainFx(out)` añade a `out` (y vacía su cola)
  `{type:'highfive'|'fistbump'|'chestbump'|'clap', team, x, y, z, strength}` (coords de la sim; `strength` 0..1: choque arriba 1, choque abajo
  0,75, puños 0,55, palmadas de ánimo 0,6; `chestbump` llegará con PLY-15). Un evento por contacto, en el frame del contacto (tiempo de juego).
- **Por qué**: hoy los choques de manos tras el punto son mudos (19 de 19 puntos tienen choque en la semilla 7).
- **Propuesta** (en `VB.Audio.update(game, realDt)`, o donde se manejen los eventos; un solo consumidor vacía la cola, ver notes/ui_main.md
  si main.js los reparte como eventos):
  ```js
  var FXB = [];
  // ...cada frame:
  if (VB.Players && VB.Players.drainFx) { FXB.length = 0; VB.Players.drainFx(FXB);
    for (var i = 0; i < FXB.length; i++) { var f = FXB[i]; play(f.type === 'clap' ? 'clap' : f.type === 'fistbump' ? 'fistbump' : 'slap', 0.5 + 0.5 * f.strength, f.x, f.y); } }
  ```
  (los nombres de sonido son orientativos: los que defina AUD-05).

## Aplicado (log, integración del pulido ola 1, 8-nov-2026, PC de casa)
- AUD-05 (mínimo, por el integrador): sonidos nuevos `slap` (3 variantes: dos palmas planas a 1-2 ms, chasquido 1,5-3 kHz + cuerpo de
  ~190 Hz) y `fist` (2: sordo < 1 kHz + golpe de 118 Hz), con paso alto (sin DC). Eventos `fx:highfive`/`fx:chestbump` → `slap`,
  `fx:fistbump` → `fist`, `fx:clap` (ánimo del que pierde) → `slap` más suave y agudo (main.js reparte `VB.Players.drainFx`).
  Niveles calibrados con `audiotest --calibrate`: `slap` 9,8, `fist` 8,2 (foley −24 LUFS: −23,8 / −23,0). Escenarios nuevos en audiotest.
  `node tools/audiotest.js` completo → TODO OK (partido en Chrome −3,7 dBTP, 150/0 fuentes). En vivo (seed 7, 40 s): 3 puntos →
  1 `fx:highfive`, 1 `fx:fistbump`, 2 `fx:clap` llegan a `Audio.handle`.
- Pendiente para el owner: AUD-07 (`point.highlight` → escala de reacciones de la grada) sigue sin hacer.

## Pulido ola 2 (8-nov-2026, owner audio): sonidos perdidos al empezar en un móvil lento
Ficheros: `js/audio.js`, `tools/audiotest.js`. Problema verificado (tech, ola 1): en móvil CPU ×4 con JUGAR nada más cargar, los
primeros 60-80 s de partido perdían la mitad de los toques (`skipped` 10 → 80, banco 2 → 39 de 85): el hilo principal no tiene
huecos libres en pleno partido y la cola troceada solo sacaba ~1 sonido por segundo.
- **Hilo de síntesis (Worker)**: el módulo se llama `VBAudioModule` y su propio código fuente (`toString()`) arranca un Worker desde un
  Blob (sin ficheros ni red; vale en file://, comprobado). El Worker carga el mismo módulo (`self.__vbAudioWorker=1` → `workerMain()`),
  sintetiza los trabajos en orden y devuelve los Float32Array transferidos (sin copia). El hilo principal solo los copia a
  AudioBuffer. Arranca 0,4 s después de `init()` (antes 1,2 s; crearlo cuesta ~1 ms en el hilo principal) o en el gesto.
  Saluda en 25-100 ms; hasta el saludo la cola troceada sigue trabajando (un Worker que no arranca no deja hueco). Si no hay Worker,
  la CSP lo bloquea (evento error) o no saluda en 6 s, sus trabajos vuelven a la cola troceada (`stats.worker = 'failed:<motivo>'`).
  Al acabar el banco se cierra (`terminate`) y se revoca la URL. Salida idéntica bit a bit (audiotest parte 5d: 84 buffers, 0 distintos).
  Nota: con una CSP que bloquee workers, Chrome escribe su aviso de CSP en la consola (no se puede evitar; no es un error del juego).
- **Sin Worker (respaldo)**: primera pasada con UNA variante de cada sonido de juego (`CORE`: click, start, whistle, serve, whoosh, pass,
  set, spike, land, whistleLong, free, block, net, bounce, scuff, slam, netTape, feet, squeak, hover, back) antes que las demás
  variantes. Mientras falte alguno, si no hay huecos libres, tramos forzados de 6 ms cada 24 ms (menú, saque, entre puntos) o 4 ms
  cada 40 ms (peloteo). Un toque pedido sin buffer (no aplazable) pasa su sonido al frente de la cola (`bumpSoft`, también en el Worker).
- **Medido** (Chrome 844x390 DPR 2,75 CPU ×4, JUGAR 1 s tras cargar, 20 s de partido; intercalado con la versión anterior):
  antes: skipped 25-29, 22-24/85 sonidos, 14-16 oídos · ahora con Worker: **skipped 0**, banco entero 1,0-1,7 s después de JUGAR,
  lateDrop 0 · sin Worker: skipped 2-14 · CSP que bloquea el Worker: skipped 0-5 en 12 s.
  Método del verificador (`verify-w1-tech/soak.js`, MOB=1, JUGAR a los 2,5 s, 90 s): skipped 0 en todas las muestras (antes 10 → 104),
  banco listo 1,5 s después del gesto, heap retenido 8,6 MB. perf.js 844x390 ×4: medium 78,6 / low 99,5 fps (low con WARM=1, la
  síntesis dentro de la medida: 102,7); escritorio high 164 fps. console.sh all: sin errores JS.
- `tools/audiotest.js`: **parte 5** (cold start en el juego real: a Worker, b sin Worker, c CSP, d antes del gesto + idéntico bit a bit;
  ~90 s; `--no-cold` la salta, `--cold-only` solo ella) y parte 4d (protocolo del Worker con un Worker simulado: uno que no contesta y
  uno que funciona, con el salto de cola). `node tools/audiotest.js` completo → **TODO OK** (mezcla y partido sin cambios: -18,6 LUFS,
  -3,7 dBTP, 150/0 fuentes; AUD-01..04 siguen en objetivo).

### Para el integrador / lead
- CONTRACT §4.4 (añadidos de audio, todo opcional): `stats.worker` ('none' | 'starting' | 'on' | 'off' | 'failed:<motivo>'),
  `stats.workerMs`, `stats.workerHi` (ms hasta el saludo), `stats.bumped`, `stats.missed` (nombre → veces pedido sin buffer),
  `VB.Audio._bank(name)` (pruebas), `window.__vbAudioNoWorker = true` (pruebas: desactiva el Worker).
- TRASPASO (línea de audio): «la síntesis del banco va en un Worker creado desde el propio audio.js (Blob, sin ficheros); sin Worker,
  cola troceada con primera pasada de una variante por sonido de juego. Móvil ×4 con JUGAR inmediato: 0 sonidos perdidos (antes ~27 en 20 s)».
- Restricción respetada: sin ficheros js/ nuevos, sin red, clásico (sin módulos ES). No hace falta tocar index.html ni main.js.

## Aplicado (log, integración del pulido ola 2, 8-nov-2026, PC de casa)
- CONTRACT §4.4 («pulido ola 2»): `stats.worker/workerMs/workerHi/bumped/missed`, `VB.Audio._bank(name)`, `window.__vbAudioNoWorker`.
- TRASPASO: línea de audio con el Worker de síntesis.

## Pulido ola 2 (8-nov-2026, owner audio): AUD-05, AUD-06, AUD-07
Ficheros: `js/audio.js`, `tools/audiotest.js`. `node tools/audiotest.js` → **TODO OK** (todo lo de antes sigue igual: mezcla en objetivo,
AUD-01..04, robustez, partido de 60 s, silbato sobre la grada, arranque en frío). Secciones nuevas del informe: **2c** (modelo) y
«polish wave 2» dentro de la 3 (cadena real de Chrome). Escenarios nuevos en la 2. Cifras de la pasada final: ver «Medidas finales» abajo.

### AUD-05 · Contactos de celebración y botes del ritual de saque
- Sonidos nuevos: `handclap` (3 variantes: palmada de ánimo de UNA persona, manos ahuecadas: resonancia de ~1 kHz de 8-11 ms y 2-3
  micro-impactos; distinta del choque de manos), `chest` (2: golpe de tórax 92→62 Hz con 2.º/3.er armónico para el móvil, "plaf" de ropa,
  roce de camiseta y las manos que se agarran 25-40 ms después), `dribble` (3: bote controlado en el parqué, ~5 m/s, poco cuerpo, "ping" de
  la cámara del balón y knock de la tarima). `fist` re-voceado: tenía el 99 % de la energía bajo 150 Hz y perdía 14 dB en un altavoz de
  móvil; ahora con «toc» de nudillos en 560 Hz pierde 6,6 dB (como un toque).
- `fx:highfive` → `slap`, `fx:fistbump` → `fist`, `fx:chestbump` → `chest`, `fx:clap` → `handclap`, `fx:catch` (opcional) → palmada blanda;
  `dribble` (sim SIM-04, ya en sim.js) → `dribble` en el punto del bote, ganancia por `speed`. **Un sonido por evento** (se quitó la
  anti-repetición: un choque y la palmada del otro equipo en el mismo frame eran un solo sonido).
- **Pool de tiras de voz**: 8 tiras fijas (ganancia → paneo → efectos + envío de reverb) creadas al crear el contexto. Cada contacto o bote
  solo crea su BufferSource; ganancia, paneo y envío se programan en la tira con `setValueAtTime` en el instante de arranque (LRU entre las
  libres). Si las 8 están ocupadas cae a `play()`.
- Niveles (plan, a ~8 m): choque/puños/pecho -24 (foley), palmada de ánimo -27 (`foleySoft`: un transitorio de 60 ms suena más de lo que
  marca su LUFS de 400 ms; a -24 tenía picos de -1 dBFS), bote del ritual -23 (~5 LU bajo un bote de peloteo, por encima de los muertos).
- Medido: celebración (choque + palmada en el mismo frame, 2.ª palmada, puños, pecho) → 5 eventos, 5 sonidos, los correctos, 0 nodos de
  ganancia/paneo creados; 12 contactos en un frame → 12 sonidos; ritual 3 + 3 botes → 6; tiras 8/8 libres y 0 voces al acabar.
  Chrome, 240 s de partido real (sim + contactos como los emite players): todos los contactos y todos los botes nativos de la sim suenan una
  vez, 0 voces y 8/8 tiras libres tras 6 s de silencio, sin recortes. **Partida real (index.html, players.js de verdad)**: `fx:*` repartidos
  por main.js = `fxIn` = `fxOut`; botes de la sim = `dribIn` = `dribOut`; 0 descartados (`tools/out/aud-w3/liveprobe.js`, scratch).

### AUD-06 · Cortinilla y presentación
- `VB.Audio.ui('wipe')`: soplido de aire filtrado (banda que sube de 450 Hz a 2,8 kHz y baja) que cruza de izquierda a derecha (paneo en el
  buffer), pico a 0,15 s = el corte en el centro de la cortinilla de 0,3 s, con un golpe de aire grave muy suave en el corte. Bus de interfaz.
  Anti-repetición 0,25 s. -25 LUFS (suena casi cada punto: discreto).
- `VB.Audio.sting('intro')` (= `ui('intro')`): firma suave (`introSting`: campanas La-Re-Mi que se posan en Fa# sobre Re con novena en piano
  eléctrico; sin metal: su diente de sierra grave quedaba al aire y audiotest lo marcaba como clic; las campanas casi al nivel del acorde:
  el motivo es la firma) + crescendo de grada (`introSwell`, 3,6 s: voces que suben, aplauso cada vez más denso, unos silbidos) y el lecho de
  grada agachado -7 dB (vuelve solo a los 3 s, bajo la meseta del crescendo: con una tarjeta larga no queda hueco). Se suelta con
  `ui('introEnd')`, `ui('introSkip')` (grada y firma se apagan en ~0,5 s), el primer silbato del saque o a los 6,5 s. La ovación de bienvenida
  de `newMatch` va 0,35 s tarde y se cancela antes de sonar si llega la presentación (aplazada sin buffer: tampoco suena). Plan: firma -19,
  grada -21, juntas -17 LUFS.
- Antes del primer gesto todo es no-op sin error (prueba nueva en la parte 4; console.sh limpio).

### AUD-07 · Reacción de la grada con `point.highlight`
- `crowdReact` reescrito (mismas muestras): punto local → ovación 0,40 + 0,72·h, capa de ovación larga desde h 0,4, estallido (capa aguda +
  dos golpes de bombo) desde h 0,72, aplauso 0,22 + 0,5·h y segundo aplauso desde h 0,45; digs ≥ 2 → "uuuh" que rompe en ovación; racha ≥ 3
  → palmas al unísono con bombo tras la ovación (solo hasta `point.hold`) que **siguen en la misma rejilla** con las palmas del saque local
  (sin hueco ni golpe doble: separación 0,42-0,84 s medida); punto de set salvado → capa de alivio y aplauso largo. Punto rival → lamento
  (más si es error local o si la CPU salva un punto de set), aplauso de reconocimiento desde h 0,45, "uuuh" de admiración con digs ≥ 2.
  Sin `highlight` (sim antigua) se estima con los términos de `VB.Sim.highlightOf`.
- En peloteo, el "uuuh" de cada defensa de remate crece con `g.rally.digs` (×1,22 y ×1,43 en la 2.ª y la 3.ª, un pelo más agudo) y el ánimo
  del lecho sube con él.
- Escenarios de mezcla de reacciones anclados en h 0,35 (mediana de un partido humano, notes/sim.md SIM-01): -20 LUFS, como antes.

### API (todo opcional; nada roto ni renombrado)
- `VB.Audio.ui('wipe'|'intro'|'introEnd'|'introSkip')`, `VB.Audio.sting('intro')`, `VB.Audio.introInfo()` → `{active, t}`, `VB.Audio.voices()`.
- `stats`: `fxIn`, `fxOut`, `dribIn`, `dribOut`, `pooled`, `poolFull`, `voicesMax`, `intro`, `wipe`, `react`. `_debug()` añade `react` (última
  reacción: `h, team, layers, chant`), `intro`, `pool`, `poolFree`, `voices`, `bed`, `chant`.
- Sonidos nuevos: `handclap` (3), `chest` (2), `dribble` (3), `wipe` (2), `introSwell` (1), `introSting` (1). Banco: 97 trabajos (antes 85).
- `ui(kind)` con un nombre desconocido ya no suena como un clic (sin argumento sigue siendo el clic).
- `tools/audiotest.js`: parte 2c (`wave2Report`), `chromeWave2`, `realPoints`/`spreadPick`/`spearman`; `PAGE_RUN` acepta `api` (llamadas de UI
  en un instante), `fxSynth` (contactos como los emite players y, si la sim no los trae, botes del ritual), `tail` (s finales sin eventos) y
  registra las fuentes canceladas antes de sonar; `--no-w2` salta la parte de Chrome de la ola 2.

### Para el integrador / lead
- CONTRACT §4.4 (añadidos de audio, pulido ola 2): `VB.Audio.ui('wipe'|'intro'|'introEnd'|'introSkip')`, `sting('intro')`, `introInfo()`,
  `voices()`; `stats.fxIn/fxOut/dribIn/dribOut/pooled/poolFull/voicesMax/intro/wipe/react`; eventos `fx:catch` (opcional) y `dribble` → sonido.
- TRASPASO (línea de audio): «contactos de celebración y botes del ritual con sonido propio, uno por evento, por un pool de tiras; cortinilla y
  presentación (firma + crescendo, lecho agachado); la grada reacciona en proporción a `point.highlight` (Spearman ≥ 0,99 medido a la salida)».
- Peticiones: notes/ui_main.md (cablear `ui('wipe')`, `sting('intro')`, `ui('introEnd'|'introSkip')` y la entrada del HUD en el silbato),
  notes/players.md (PLY-15 `chestbump`, `catch` opcional en PLY-16), notes/sim.md (nada: aviso de que `dribble` ya suena).

### Medidas finales (pasada completa `node tools/audiotest.js --json tools/out/aud-w3/final.json` → TODO OK, 8-nov-2026)
- Mezcla (parte 2): todos los escenarios en su objetivo ±1,5 LU, también los nuevos: choque -23,8 · puños -24 · pecho -24 · palmada de ánimo
  -27 · bote del ritual -23 (peloteo -18, muerto -26) · cortinilla -25 · firma -19 · grada de la presentación -21 · presentación -17.
- 2c (modelo): las 15 comprobaciones OK (celebración 5/5 con 0 nodos por contacto, 12 en un frame → 12, ritual 6/6, sin fugas; presentación
  sin bienvenida, lecho -6,9 dB y de vuelta, silbato y salto la sueltan, tiempo agotado; cortinilla 1 por cortinilla; "uuuh" 0,67 → 0,81 →
  0,96; racha → palmas del saque sin hueco (0,42-0,84 s); Spearman 0,998 en 30 puntos reales de 0,15 a 0,99).
- Chrome (cadena real): cortinilla -12,7 dBTP (sola: -24,9 LUFS) · presentación -7,5 dBTP, -18,1 LUFS bajo la tarjeta, bienvenida 0, lecho
  -27,4 → -34,0 → -27,1 LUFS · Spearman 0,997 (-22,2 → -14,7 LUFS en 5 s) · punto máximo -1,5 dBTP, 0 recortes · 240 s de partido: 48/48
  contactos, 35/35 botes de la sim, 0 voces y 8/8 tiras libres al final, máx. 9 voces, -18,9 LUFS, -3,3 dBTP.
- Partido de 60 s (semilla 7) sin cambios de fondo: -18,8 LUFS, -3,7 dBTP, 0 recortes, 159 fuentes / 0 descartadas (antes 150: ahora suenan
  los botes del ritual de la sim), silbato ≥ 14,4 dB sobre la grada; clímax -2 dBTP.
- Arranque en frío (CPU ×4, JUGAR a 1 s): con Worker 0-1 descartados, banco entero 1,1-1,8 s tras JUGAR; banco idéntico bit a bit (96
  buffers). Sin Worker: `dribble`, `slap` y `handclap` entran en la primera pasada (`CORE`; el bote justo tras el silbato, que es cuando se
  oye primero): los botes del ritual sin sonido en los primeros 20 s bajan de 3 a 1 (el primerísimo, antes de que exista nada).
- Partida real (index.html, 60 s, autopilot): `fx:*` repartidos = sonados, botes 12/12, 0 descartados, ~160 fps.

## De ui_main (pulido ola 2: UI-13, UI-14), 8-nov-2026 — cableado hecho
- `VB.Audio.ui('wipe')`: en los cortes punto → saque / cambio de campo se llama cuando `nextCutIn ≤ 0,15` (el pico cae en el corte); en las
  transiciones de pantalla (menú → partido, partido → final, final → menú, 450 ms) al empezar. La cinta barre de IZQUIERDA a DERECHA (como el
  soplido). Una llamada por cortinilla.
- `VB.Audio.sting('intro')`: main.js al mostrar la tarjeta (mismo frame que `newMatch`; la sim espera bajo la tarjeta 2,5 s).
- `ui('introEnd')`: al empezar la entrada del marcador, 0,25 s después de que la tarjeta se vaya sola (la sim arranca al irse: `serveReady` en
  ese frame, silbato 0,7 s después: la entrada del marcador dura 0,45 s y acaba hacia el silbato). `ui('introSkip')` en el frame en que la saltan.

## Aplicado (log, integración del pulido ola 2, segunda tanda, 8-nov-2026, PC de casa)
- Cableado de ui_main ya estaba hecho (cortinilla, presentación, `introEnd/introSkip`). La tarjeta de presentación no se veía si el partido empezaba antes
  de acabar el ensayo de estilos (arreglado en ui.js); el sonido sí sonaba.
- CONTRACT §4.4: `ui('wipe'|'intro'|'introEnd'|'introSkip')`, `sting('intro')`, `introInfo()`, `voices()`, `stats` nuevos, sonidos nuevos; §4.3 `fx:*` → sonidos.
- `node tools/audiotest.js` en la integración: TODO OK (3 min 52 s).

## De ui_main (arreglos tras la verificación de la ola 2, UI-01), 8-nov-2026 — opcional
- El verificador midió `ensure()` (constructor del `AudioContext` + cadena maestra) en 46-53 ms de hilo y el primer `irStep` en 14 ms, en el
  MISMO frame cuando el primer gesto del jugador es JUGAR (o cuando una herramienta llama a `startMatch` sin gesto previo: main.js llama a
  `Audio.unlock` dentro de `startMatch`). Propuesta: en `unlock()` crear solo el `AudioContext` (debe ir dentro del gesto) y construir la
  cadena maestra y el primer tramo de la reverberación en el siguiente frame (p. ej. `requestAnimationFrame` o un `setTimeout(…, 0)` tras el
  `resume()`), para que los dos costes no compartan frame. Hoy, con el clic previo en el menú (lo normal), `smtime.js` da 6/6 frames < 25 ms
  tras `startMatch`, y `feel.js NOCAST=1` 3/3 con el mayor hueco en 23-37 ms: no es urgente.

## Aplicado (log, integración de los arreglos tras la verificación de la ola 2, 8-nov-2026 noche, PC de casa)
- Propuesta opcional de ui_main (UI-01: crear la cadena maestra un frame después del `AudioContext`) **no aplicada**: el coste cae en el `pointerdown` del
  primer gesto (antes del clic de JUGAR y antes de la cortinilla), y partir `ensure()` en dos frames arriesga que el primer sonido (clic, silbato) no tenga
  cadena. Queda para el owner de audio si se quiere, con audiotest completo.

## Desde sim (SIM-05, 2026-11-08): highlight calibrado
La fórmula de `point.highlight` ha cambiado (notes/sim.md §P3; pesos en `VB.HL`). `hlOf` en js/audio.js solo la estima cuando falta
`e.highlight`, que ya nunca falta: se puede dejar o sustituir por `VB.Sim.highlightOf` si existe. Nuevo `e.clutch` (final apretado:
últimos 8 puntos del set con ≤ 2 de diferencia), por si la grada quiere más tensión en esos saques/puntos.

## De players (pulido ola 3, 8-nov-2026)
- `fx:catch` YA se emite: cada recogida del bote en el ritual del sacador CPU (`{team, x, y, z, strength:0.6}`), un evento por bote.
- Nuevo `fx:call` (opcional): «¡mía!» del que va a por el balón (un evento por balón, `{team, x, y, z (cabeza), strength:0.6}`). Si se quiere, un aviso de voz
  muy sutil; si no, se ignora (main.js ya lo reparte como cualquier `fx:*`).
- CONTRACT §4.3: `fx:catch` lo emite players; nuevo `fx:call` `{team, x, y, z, strength}`. §4.4: `VB.Players._face(p, 'shout'|'effort'|'joy'|'sad'|'neutral'|'', sec)`
  (pruebas); rig de solo lectura: huesos `eyes, mouth, teeth, brow[2], hair`, pesos `fxS/fxE/fxJ/fxD`, `hairAng`, `ritOn`, `tgtW`. Proporciones: cadera 1,042 m
  (hombros y altura total iguales). Sin cambios necesarios en main.js.

## Pulido ola 3 (8-nov-2026, owner audio): AUD-08, AUD-09
Ficheros: `js/audio.js`, `tools/audiotest.js` (y una petición en notes/ui_main.md). `node tools/audiotest.js` → **TODO OK** (todo lo de antes
sigue igual). Secciones nuevas del informe: **2d** (AUD-08, modelo), **2e** (jerarquía de la mezcla, AUD-09), dentro de la 3 «polish wave 3»
(«final de partido» por la cadena real) y el barrido AUD-09, y la parte **6** (hoja final y menús en el juego real).

### AUD-08 · Hoja final y sonidos de los menús
- **Sonidos nuevos** (familia propia de "mecanismo" con un tono pequeño en Re mayor, la tonalidad de las ráfagas y de la presentación):
  `cntTick` (2 var.: tic cristalino de 30 ms, energía en 4-9 kHz, por encima de la grada, que pasa por un paso bajo de 1,5-6,5 kHz),
  `cntLock` («clac» doble con cuerpo Re5/La5 y "ding" en Re6), `mvpWin` (soplo que sube 0,5 s y arpegio de campanas Re-Fa#-La-Re sobre Re
  mayor en piano eléctrico, acento a 0,6 s), `mvpLose` (el mismo gesto en Si menor, más corto y suave), `arwHover` (punteo; ‹ grave, › agudo),
  `stepUp`/`stepDown` (trinquete + cuarta La5↔Re6; la nota final sigue al nivel de destino: Fácil→Experto -5/-3/0/+4 semitonos), `arwEdge`
  (doble golpe sordo "no se puede"), `optHover` (toque de fieltro), `tglOn`/`tglOff` (pestillo con tono que sube / baja), `optSel` (retén con
  nota que sube con el índice). Banco: 110 trabajos (antes 97).
- **Cuenta de las cifras** (UI-11, 600 ms, salida cúbica): `ui('count', u, ts)` en cada frame con cambio. Cada tic suena YA (nada programado a
  futuro), espaciados `0,05 + 0,1·u²` s (50 → 150 ms: se frenan como las cifras; nunca más de 20/s) con reloj virtual (un frame 2,5 ms
  adelantado no se salta un tic), tono ×0,94 → ×1,10. `u ≥ 1` = «clac» EN ese frame. `ui('countEnd')` = el clac si no hubo frame con u = 1
  (suelto, sin cuenta: nada).
- **MVP**: `ui('mvp', win)` al empezar la cuenta (el acento cae a 0,6 s, con las cifras posadas); sin `win`, el ganador del evento `match`;
  anti-repetición 1,5 s.
- **Foco en la hoja**: con state `over` y tras la 1.ª cifra o el MVP, la grada baja 6 dB (`END_DUCK` 0,5; con el compresor ≈ -3,4 dB a la
  salida) en ~0,35 s; vuelve al salir de `over`. Sin ese hueco, en el final más ruidoso los tics quedaban 4 dB bajo la ovación en su banda.
- **Menús**: `ui('arrowHover', dir)`, `ui('arrow', dir, nivel, n)`, `ui('arrowEdge', dir)`, `ui('optHover')`, `ui('toggle', on)`,
  `ui('select', i, n)`, `ui('slide', v)` (tic suelto a -28; el de Efectos sigue sonando con el toque `pass` de muestra).
- Mientras ui.js no lo cablee no suena nada nuevo (todo opcional). Petición con los cambios exactos en notes/ui_main.md (8 cambios, probados).

### AUD-09 · Pasada de mezcla completa
- Re-medidos los 70 escenarios del plan (los 37 originales + olas 1-2 + 13 nuevos): todos en su objetivo ±1,5 LU (casi todos a ±0,2).
  Reequilibrado: `hover` +1 dB (estaba a -29 de -28) con el cambio de jugador a 0,27 (era 0,3) para que siga a -28; niveles de los nuevos
  calibrados con `--calibrate`.
- **Colas cortadas** (solo se veían en espectrograma, `tools/out/aud-w4/spec.js`): `boom` (bombo de las ráfagas, cortado a -22 dB a los
  0,9 s), las notas de metal (al 2 %) y las campanas (al 3 % a los 1,4 s) acababan en seco. Ahora se apagan en 60 / 40 / 80 ms. Afecta a
  setWin, matchWin, introSting y los MVP (sin cambio de nivel medible).
- **Jerarquía (2e, nueva puerta)**: 20 relaciones entre capas que los objetivos por categoría no vigilan (p. ej. tics ≥ 8 LU bajo el MVP,
  MVP ≥ 2 LU bajo la ráfaga de partido, cortinilla ≥ 5 LU bajo un toque, bote del ritual entre el muerto y el de peloteo, latido de set ≥ 3 LU
  bajo el de partido, Sí/No igual de fuertes).
- **Pico real en todas partes (nueva puerta)**: los 59 escenarios de eventos/API por la cadena real de Chrome (compresor + recortador), sobre los
  lechos, con la cámara a ~8 m y a ~3 m: pico real ≤ -1 dBTP y 0 recortes en cada ventana. Peor: bloqueo directo humano a 3 m -2,4 dBTP.
- **Sonoridad del partido (nueva puerta)**: el partido de 60 s (semilla 7) debe quedar a ±1 LU de la referencia de la ola 2 (-18,8 LUFS).

### Plan de niveles final (LUFS a la salida, señal pequeña; tolerancia ±1,5 LU)
| capa | objetivo | | capa | objetivo |
|---|---|---|---|---|
| remate, saque en salto | -14 | | reacciones de grada | -20 |
| bloqueo directo, remate al suelo | -15 | | lecho de grada (peloteo de 4) | -26 |
| silbato | -16 | | palmas + bombo, latido de partido | -22 |
| ráfagas set/partido | -16 | | latido de punto de set | -27 |
| presentación (firma + grada) | -17 (-19 / -21) | | reloj de saque | -25 |
| toques, balón al suelo, red | -18 | | destello «perfecto» | -26 |
| colocación, dejada | -21 | | bote muerto | -26 |
| MVP / hoja final entera | -19 / -19 | | cortinilla | -25 |
| bote del ritual | -23 | | «clac» de la cuenta | -25 |
| pies, zapatillas, brazo, choques | -24 | | tics de la cuenta (600 ms) | -29 |
| palmada de ánimo | -27 | | interfaz: confirmaciones / hovers | -24 / -28 |
`LEVEL` (dB, audio.js) con los valores finales; `VB.Audio.LEVELS` lo expone.

### Medidas finales (`node tools/audiotest.js --json tools/out/aud-w4/final2.json` → TODO OK)
- Mezcla (parte 2): 70/70 escenarios en objetivo (nuevos: tics -29, clac -25, MVP -19 / -19, hoja entera -19,1, flechas y Ajustes -24 / -28, deslizador -28). 2e: 20/20 relaciones.
- 2d (modelo, 11/11): cuenta a 30/60/120/144 Hz → 6-7 tics a 17-383 ms (60 Hz), intervalo mín. 49-67 ms, clac en el último frame (600 ms), nada después; grada -6,0 dB y vuelta; MVP gana/pierde/por defecto; clac solo tras una cuenta; flechas ×0,84→1,00→1,26; Ajustes; no-op sin gesto.
- Chrome «final de partido» (punto de partido con doble ovación, ráfaga, choque de pecho, cortinilla, hoja): pico real -2,3 dBTP, 0 recortes; 6 tics, clac a 608 ms = fin de la cuenta, 0 tics después; grada -3,4 dB a la salida bajo la hoja; tics +8,1 dB sobre el resto en su banda (mín. +4,3); acento del MVP -0,7 LU respecto a todo lo demás (encima de la ovación y la fanfarria). WAV: tools/out/audio/final-de-partido.wav.
- Barrido AUD-09: 59 escenarios × 8 m / 3 m, todos ≤ -1 dBTP; peor remate perfecto humano -1,9 dBTP (varía ±0,6 con la variante elegida).
- Partido de 60 s: -18,9 LUFS (-0,1 LU frente a -18,8), -3,7 dBTP, clímax -2 dBTP, 0 recortes; silbato ≥ 14 dB sobre la grada.
- Juego real (parte 6, 1280×720 y 844×390 táctil): 7 tics a 49-97 ms, clac en el último frame de la cuenta (0 frames, reloj de audio 0,0 ms), 0 tics después, MVP 1; menú y Ajustes con sus sonidos.
- Arranque en frío: Worker 0 descartados, banco (110) 1,0 s tras JUGAR; banco idéntico bit a bit (109 buffers). fps de esa prueba = carga de la máquina (base y nueva medidas seguidas: 62-63 / 67-70).
- simtest 10 12345 0 → TODO OK.

### API (todo opcional; nada roto ni renombrado)
- `VB.Audio.ui('count', u, ts)`, `ui('countEnd')`, `ui('mvp', win)`, `ui('arrowHover', dir)`, `ui('arrow', dir, nivel, n)`, `ui('arrowEdge', dir)`,
  `ui('optHover')`, `ui('toggle', on)`, `ui('select', i, n)`, `ui('slide', v)`. `ui()` acepta ahora hasta 3 argumentos tras el nombre.
- `stats.count`, `countAt`, `countEnd`, `countEndAt` (ms de performance), `stats.mvp`. `_debug()` añade `crowd`, `endFocus`, `count`, `stingTeam`.
- Sonidos nuevos en `SOUNDS`/`VARIANTS`/`LEVELS`: `cntTick` (2), `cntLock`, `arwHover`, `optHover`, `stepUp`, `stepDown`, `arwEdge`, `tglOn`,
  `tglOff`, `optSel`, `mvpWin`, `mvpLose`. `sting()` no reproduce los MVP (van por `ui('mvp')`).
- `tools/audiotest.js`: partes 2d, 2e, «polish wave 3» y barrido AUD-09 en la 3, parte 6; `--endui-only`, `--no-endui`, `--w3-only`,
  `--sweep-only`, `--no-w3`, `--no-sweep`. `PAGE_RUN` acepta `mute` (todo menos esos sonidos), `api[].args` y las pseudo-llamadas `__state` y
  `__gset`. Exporta `UI_PATCH`, `enduiReport`, `countUpCalls`. Duración total ~6 min.

### Para el integrador / lead
- Cablear AUD-08 en ui.js con la nota de notes/ui_main.md (o pedírselo a ui_main). Comprobar después con `node tools/audiotest.js --endui-only`
  (detecta el cableado y prueba ui.js tal cual).
- CONTRACT §4.4 (añadidos de audio, ola 3): la API de arriba, `stats.count/countAt/countEnd/countEndAt/mvp`.
- TRASPASO (línea de audio): «hoja final con tics que se frenan con la cuenta, «clac» en el último frame y revelación del MVP (la grada cede
  a la hoja); sonidos propios de las flechas de dificultad y de Ajustes; pasada de mezcla completa: 70 escenarios en objetivo, 20 relaciones
  entre capas, pico real ≤ -1 dBTP en los 59 escenarios por la cadena real a 8 y 3 m, partido a -18,9 LUFS (±1 LU de la ola 2)».

## Aplicado (log, integración del pulido ola 3, 9-nov-2026, PC de casa)
- AUD-08 cableado en ui.js (los 8 cambios de notes/ui_main.md, tal cual): `--endui-only` → TODO OK.
- **Arreglo (cola sin Worker)**: con la ola 3 players emite `fx:catch` (→ `set`) y pasos en los primeros segundos del primer saque de la CPU; en el respaldo sin
  Worker / con CSP la 1.ª pasada aún no los tenía y la parte 5 fallaba de forma intermitente (`missed {feet:3}`, luego `{set:1}`). `CORE` empieza ahora por
  `click, start, whistle, dribble, set, feet, serve…` (antes `set` 9.º y `feet` 17.º). `--cold-only` 3/3 TODO OK; con Worker, el banco es idéntico.
- `hlOf` de reserva se deja (solo sin `e.highlight`, que ya no pasa). `fx:call` sin sonido (opcional; un «¡mía!» sintético no compensa el riesgo de sonar a juguete).
- `node tools/audiotest.js` completo → TODO OK (mezcla, 2d/2e, partido -18,9 LUFS, barrido de pico real, arranque en frío, parte 6).

## Aplicado (log, integración de los arreglos tras la verificación de la ola 3, 9-nov-2026, PC de casa)
- Sin peticiones pendientes para audio. `node tools/audiotest.js` completo en el árbol integrado → TODO OK (parte 6: 7 tics, clac en el último frame, MVP 1, flechas y Ajustes, en 1280×720 y 844×390 táctil).
- Aviso: con el cuadro vivo de players, `debug=point|ace` re-emiten el `point` en bucle: los sonidos de `fx:highfive` y familia suenan en cada vuelta (como en juego).

## Sprint remate apuntado + challenge (B8, 9-nov-2026)
- **Bocina** `horn` (nuevo en el catálogo, 1 variante, síntesis en el Worker como el resto): dos sierras polyBLEP a 233/277 Hz + una
  desafinada, formante a 1,3 kHz, 0,8 s + 90 ms de salida. Suena con el evento `challenge` (bus de efectos, envío 0,4 a la reverb)
  junto a un «uuuh» suave de expectación (0,55 s). Mezcla: -17 LUFS (justo bajo el silbato -16), LEVEL `horn: -1.8`.
- **Revisión**: mientras `g.review` (o, si la sim no lo expone, hasta 6 s tras el evento) el ánimo se apaga (emoción objetivo 0,1) y el
  murmullo sube de ×1,78 a ×2,51 según `g.review.t / dur` (+5 → +8 dB): -20,7 LUFS a mitad de revisión (objetivo -21; lecho normal -26).
  `g.review === null` corta el murmullo al momento.
- **Resultado** `challengeResult {team, overturned}`: se calcula a quién favorece (equipo 0 = local). Anulado: reacción grande (-18:
  ovación con bombo y aplauso, o lamento fuerte). Se mantiene: moderada (-20: ovación corta + aplauso, o lamento). Si en el mismo
  frame llega el `point` corregido (la sim lo pita antes del `challengeResult`), el `point` no lanza su reacción (sin doble capa); si ese
  punto cierra set o partido, manda la reacción del `point` y la del challenge no suena.
- API (opcional, pruebas): `_debug().review` → `{on, n, res, team, last:{team, overturned, home, t}, mur}`. No se expone nada más.
- `tools/audiotest.js`: categorías `horn` (-17), `reviewBed` (-21, se mide como lecho), `reactBig` (-18) y 7 escenarios «challenge: …»
  en la parte 2 (incluido el punto corregido + resultado en el mismo frame).

## Sprint cartoon (9-nov-2026): audio de dibujo animado
Capas nuevas que se SUMAN, bajas, al golpe de siempre (los golpes, el banco previo y su mezcla no cambian): dan el carácter de dibujo
sin volverlo de juguete. Todo sintetizado (generador `genToon`, dos senos con envolvente de tono + ruido filtrado; «¡PAM!» como partitura).
| sonido | qué es | cuándo | nivel (LUFS) |
|---|---|---|---|
| `toonPop` (3) | «bonk» redondo, octava que cae en 12 ms | cada toque: recepción ×1, colocación/dejada ×1,38 («pip»), saque flotante ×1,12, balón libre ×0,92 (de dedos ×1,2), `shank` ×0,8, balón en el cuerpo ×0,72 | -25 (7 LU bajo el toque) |
| `toonWhack` (2) | «¡zas!»: seno 950 → 150 Hz en 9 ms + palmada de ruido a 1,9 kHz | remate y saque en salto (×0,8); en el perfecto ×0,4 (manda el chasquido del bus de refuerzo) | -21 (7 LU bajo el remate) |
| `toonZip` (2) | zumbido de «líneas de velocidad» 2,6 → 0,7 kHz | remate / saque en salto fuerte (potencia ≥ 0,65 o ≥ 19 m/s), 15 ms tras el golpe | -24 |
| `boing` (2) | muelle sutil 175 → 200 Hz, vibrato de 12,5 Hz que se apaga, armónicos 2.º-3.º | `block` (toque ×0,6, block-out ×0,5, directo ×0,35 y más grave) y `net` (red ×0,5, cinta ×0,45 más agudo) | -24 (≥ 6 LU bajo la red) |
| `pamSting` (1, partitura) | golpe de metal en Re mayor + platillo pequeño + tres campanas que suben (sin bombo) | remate perfecto del humano (no dejada), 160 ms tras el chasquido, bus de música; sustituye al destello `perfect` en ese caso | -21 (≥ 6 LU bajo el remate, ≥ 3 LU bajo la ráfaga de set) |
- Sin reverb apreciable (envío 0,04: «de dibujo», secos). En demo, a la mitad y sin «¡PAM!».
- **Onomatopeya (lectura defensiva)**: el contrato no fija aún un evento de fx. Audio lanza el «¡PAM!» por sí mismo con la misma condición
  que el pulso de ui.js (`hit` `spike`, `grade 'perfect'`, humano) y además acepta `fx:onoma` / `fx:pam` / `onoma` (equipo ≠ 1): una sola vez por
  remate (< 0,4 s entre ambos no se repite). Si fx acaba emitiendo su evento, no hace falta tocar nada.
- **Interruptores**: `ctx.settings.toonSfx === false` o `VB.Audio.setToon(false)` quitan todas las capas (vuelve el destello `perfect`);
  `ctx.settings.onoma === false` / `onomatopoeia === false` quitan solo el «¡PAM!» propio (si fx emite el evento, suena). Ninguno existe hoy
  en Ajustes: por defecto todo activo. No dependen de la calidad gráfica (el audio no cuesta GPU; 5 sonidos cortos más en el banco).
- API (opcional): `VB.Audio.setToon(on)`, `stats.toon` (capas que sonaron), `stats.pam`, `_debug().toon` → `{on, n, pam, pamT}`. `CORE` (primera
  pasada sin Worker) incluye `toonPop, toonWhack, boing, toonZip`; `pamSting` es música (DEFER 0,15 s).
- `tools/audiotest.js`: categorías `toon` -25, `toonHit` -21, `toonZip` -24, `toonBoing` -24, `stinger` -21; 8 escenarios «cartoon: …» en la
  parte 2 (también pasan por el barrido de pico real AUD-09), 9 relaciones nuevas en la 2e y una prueba en la 2b (qué capa suena con cada
  evento, interruptores, «¡PAM!» sin repetir con el evento de fx, CPU sin «¡PAM!», demo).
- Medidas (`node tools/audiotest.js --json tools/out/aud-cartoon/final.json` → TODO OK; log en tools/out/aud-cartoon/full.log): los 8 escenarios
  en objetivo, 9/9 relaciones nuevas; barrido AUD-09 peor -1,5 dBTP («uuuh» de defensa a 3 m; remate perfecto entero con «¡PAM!» -1,7);
  AUD-01 remate perfecto a la salida -1,9 dBTP (con el «¡PAM!» a 70 ms llegaba a -0,6/-0,9: por eso entra a 160 ms y sin bombo);
  partido de 60 s -19,0 LUFS (-0,2 LU frente a la referencia); arranque en frío sin Worker / CSP: missed {} (con `toonPop` al final de
  `CORE` se perdía 1: va justo tras `set`). simtest TODO OK; console.sh all sin errores JS.
- Pendiente para integración: si fx/ui ponen la onomatopeya como evento, usar uno de `fx:onoma` / `fx:pam` / `onoma` (con `team`); si se
  añade un ajuste para quitarla, llamarlo `onoma` (audio ya lo lee). WAV de cada sonido nuevo en tools/out/audio/<nombre>.wav.

## Petición de sim (reglas de playa, 10-nov-2026): `courtChange` con `why: 'swap'`
Vóley playa (`g.beach`): cambio de campo cada 7 puntos (cada 5 en el 3.er set), `e.every` = 7 | 5, `e.pause` = 1,0 s. Hoy audio.js lo
trata como fin de set (silbato de 2,7 s). Para `'swap'` iría el silbato corto del `'eight'` (1,0) o ninguno: es frecuente (~5 por set) y
el juego sigue enseguida. Golpe nuevo: `hit` con `pokey: true` (dejada de nudillos de la playa; `shot` sigue siendo `'tip'`): podría
sonar más seco que la yema de los dedos.

### Playa (revisión final, 10-nov-2026)
- `courtChange why:'swap'`: silbato corto a 1,0 s (como `'eight'`), no a 2,7 s. Pendiente: sonido propio del pokey.

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
| `point` | crowd (local = team 0; uses `how` = ace/kill/tip/block/free/error when present): home point → roar (bigger after a long rally ≥8 touches, kill, ace, set) + applause; home error (out/antenna/double/4 touches/serve fault) → groan "ooohhh"; CPU point → smaller groan; menu demo → polite applause |
| `point matchWon` | double roar + long applause (or groan + polite applause if the CPU wins) |
| `set` | music sting `setWin` / `setLose` (0.8 s after, once the whistle has finished). Not for the set that closes the match |
| `match` | `matchWin` / `matchLose` sting (once per match; `gameOver` acts as a fallback if `match` did not arrive) |
| `serveReady` | arms the serve wait: **home serve** → after 0.9 s the stands clap in unison (3 claps + rest) with a bass drum, rising; **match point** → heartbeat "lub-dub" every 0.9 s |
| `newMatch` (not demo) | welcome roar + applause |
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
- `ui(kind)` — `'click' | 'hover' | 'back' | 'start'`.
- `setVolume(kind, v)` / `getVolume(kind)` — `kind = 'master' | 'sfx' | 'music' | 'crowd'`, `v` 0..1.
- `onSettings(settings, key)` — reads `settings.sfxVol`, `settings.musicVol`, `settings.crowdVol`, `settings.volume` (0..1) if they are numbers, and `muted`. If `crowdVol` is missing, the crowd follows `sfxVol`.
- `onState(state)` — pause/menu adjust the mix.
- `setQuality(q)` — `rank 0` → no reverb, 20 voices.
- `play(name, gain?, x?, y?)` — any sound from the catalogue (see `VB.Audio.SOUNDS`), with optional position in sim coords.
- `sting(name)` — `'setWin' | 'setLose' | 'matchWin' | 'matchLose'`.
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

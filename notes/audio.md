# notes/audio.md — js/audio.js (owner: audio)

## 1. What it is
- 100 % procedural WebAudio, no files and no network. Every effect is **synthesised once in JS** (Float32Array) and played back
  as an `AudioBuffer`: each sound costs 1 source + 1 gain (+ optional panner, + optional reverb send). No live oscillators per hit.
- Generation is **time-sliced**: a job queue runs about 6 ms per tick (`setTimeout` 12 ms) after the first `unlock()`, in priority
  order (UI → whistle → touches → reverb → crowd → music), so the menu never stalls on a phone. Crowd beds start fading in
  when they are ready (about 1-3 s). `VB.Audio.ready()` returns 0..1.
- The `AudioContext` is created **only** inside `unlock()` (a user gesture). Before that, every function is a silent no-op.
- It loads in node without `window`/`AudioContext` (`root = window || globalThis`).

Graph:
```
sfx ─────────────┐
crowd ─> brillo ─┼─> fxFilter (pausa 650 Hz / cámara lenta) ─> master ─> compresor ─> destino
reverb (envíos) ─┘                                              ^
music (ráfagas + UI) ───────────────────────────────────────────┘   (la música y la UI no se filtran en pausa)
```
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
- Generation uses `requestIdleCallback` when available (gaps between frames), otherwise `setTimeout`; about 4-5 ms per slice.
- `ready()` (0..1), `contextState()`, `stats` (`played`, `skipped`, `genMs`, `maxStepMs`), `synth(name, variant, sr)` and `synthRate(name, sr)` (pure generation, for tests).

## 4. Requests to other owners

### ui_main (index.html / js/ui.js / js/main.js)
1. **Volume sliders** in Ajustes (optional but recommended). Persist two new settings fields and pass them through `setSetting`:
   ```js
   // main.js: defaults of ctx.settings
   musicVol: 0.75, sfxVol: 1
   // ui.js: on the range input (0..100)
   ctx.actions.setSetting('sfxVol', +input.value / 100);   // effects + crowd
   ctx.actions.setSetting('musicVol', +input.value / 100); // stings and UI
   ```
   `setSetting` already calls `Audio.onSettings(settings, k)`: nothing else is needed. Suggested labels: "Efectos" / "Música".
2. **UI sounds**: `click()` already exists. Recommended additionally (all with guard):
   ```js
   // hover/focus on menu buttons (desktop only; on touch screens it does not apply)
   btn.addEventListener('pointerenter', function () { if (VB.Audio && VB.Audio.hover) VB.Audio.hover(); });
   // "Jugar" / start match button:
   if (VB.Audio && VB.Audio.ui) VB.Audio.ui('start');   // instead of click() on that button
   // "Volver"/"Menú" and closing panels:
   if (VB.Audio && VB.Audio.ui) VB.Audio.ui('back');
   ```
3. Nothing in main.js needs to change: `unlock` on gesture, `handle`/`update` every frame, `setMuted` on M, and `onState`/`onSettings`/`setQuality` are already called with guard.
   Note: on `visibilitychange`, audio suspends itself (it registers its own listener in `init`).

### sim
- Nothing required. The audio already uses the new fields/events (`toss`, `dive`, `netTouch`, `miss`, `hit.shot/power/grade`, `block.result`, `point.how`) with fallback if they are missing.
- Suggestion for CONTRACT §4.3: document those events/fields (they are not in the contract table yet).

## 5. Verification (how I checked it)
- Node: test harness with a simulated AudioContext (outside the repo; it can be copied to `tools/audiotest.js` if ui_main wants it):
  load without AudioContext and full API → no errors; `handle()` with every event type + `null`, `{}`, unknown types, missing fields;
  the 38 sounds synthesised with no NaN, peak ≤ 1 and no edge clicks; a full CPU-vs-CPU match (autopilot) with events → sound:
  about 136 sounds/min, max 9 simultaneous voices, 0 dropped, exactly 1 match sting.
- Headless Chrome with real WebAudio (`--autoplay-policy=no-user-gesture-required --mute-audio`): `running` context,
  sliced generation completes, every sound and sting plays, mute→`suspended`, unmute→`running`, no console errors.
- WAV files for listening: `tools/out/audio/*.wav` (they are regenerated with the harness).

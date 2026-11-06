# Informes de la fase Build (los que terminaron)

## foundation

### summary

Built the full working base for VOLEY 3D in /home/trilogi/work/voley-3d. The game plays from start to finish in real 3D using Three.js r149, loaded as plain scripts from cdnjs. Everything shares one global, window.VB, and runs from file:// as well as being publishable as an Artifact.

- **Simulation** (js/sim.js + js/ai.js): a pure port of the prototype that touches no page, Three.js or window objects. It keeps all of the prototype's tuning and both of its fixes (no touching your own serve, and the same player can't touch twice in a row). It adds a fixed 120 Hz step, a seeded random generator, a demo mode, an autopilot mode, VB.toThree / VB.fromThree, and a rich event queue: hit, block, net, land, point, set, match, gameOver, whistle, sideout, switch, serveReady with set point and match point, and others. Players carry lastAction and actionT for animation.
- **Arena** (js/arena.js): procedural parquet floor with correct lines, including the dashed attack-line extension; a net with antennas, posts and a referee chair; warm key light with soft shadows plus fill light; stands with an instanced crowd that jumps on points; LED boards with fictional brands.
- **Effects** (js/fx.js): textured ball that spins, contact shadow under the ball, predicted landing ring (yellow on your side, blue on theirs), a ring where your team will play the ball, spike trail, sparks and an impact flash.
- **Players** (js/players.js): low-poly athletes with a jointed rig and procedural poses: ready stance, run cycle, forearm pass, set, spike swing, serve, block, jump tuck, celebration and disappointment. The controlled player has a yellow ring and a marker above the head.
- **Camera** (js/camera.js): third person behind the controlled player, critically damped follow, a slower glide when control switches, a slow orbit in the menu, shake on spikes and blocks, slow motion when the match is won, and getBasis() for camera-relative controls.
- **Input** (js/input.js): keyboard, gamepad, and a touch overlay with a floating joystick, GOLPEAR / SALTAR buttons and a pause button.
- **Audio** (js/audio.js): procedural sounds for each event, plus crowd ambience and the end-of-match sting.
- **UI** (js/ui.js + index.html): Spanish HUD with scoreboard, serve indicator, PUNTO DE SET / PUNTO DE PARTIDO tag and touch counter; banners for points, cambio de saque, sets and bloqueo; menu with help and sound toggle; pause screen; end screen with set scores and win record; "Gira el móvil" overlay.
- **Main loop** (js/main.js): shared VB.ctx (scene, camera, renderer, quality, state, actions, timeScale, renderFn hook), fixed-step loop, events passed to every module, colour handling set so material colours come out saturated, quality capped by device and lowered automatically if fps drops, and the debug scenes.

CONTRACT.md has the exact ownership JSON, coordinate conventions, the VB.ctx fields, the sim API and state, the event table with payloads, the module interfaces (all optional, so main.js never needs editing), the per-frame order, the debug tools, the rules (edit only your own files, put requests in notes/<owner>.md) and the referee terminology.

### files_changed

/home/trilogi/work/voley-3d/index.html, /home/trilogi/work/voley-3d/js/sim.js, /home/trilogi/work/voley-3d/js/ai.js, /home/trilogi/work/voley-3d/js/arena.js, /home/trilogi/work/voley-3d/js/fx.js, /home/trilogi/work/voley-3d/js/players.js, /home/trilogi/work/voley-3d/js/camera.js, /home/trilogi/work/voley-3d/js/input.js, /home/trilogi/work/voley-3d/js/audio.js, /home/trilogi/work/voley-3d/js/ui.js, /home/trilogi/work/voley-3d/js/main.js, /home/trilogi/work/voley-3d/CONTRACT.md, /home/trilogi/work/voley-3d/notes/README.md, /home/trilogi/work/voley-3d/tools/simtest.js, /home/trilogi/work/voley-3d/tools/shot.sh, /home/trilogi/work/voley-3d/tools/console.sh, /home/trilogi/work/voley-3d/tools/drive.js, /home/trilogi/work/voley-3d/tools/eval.js

### verified

- **Three.js URL:** checked with curl -sI. https://cdnjs.cloudflare.com/ajax/libs/three.js/0.149.0/three.min.js returns 200; I downloaded it and its revision string is "149".
- **Sim test** (`node tools/simtest.js`): passes ("TODO OK") with the defaults, with 10 99 and with 30 4242.
  - 20-minute CPU vs CPU run: 120 points, median rally 4.73 s (p90 12.9 s); 219 passes, 204 sets, 240 spikes, 121 serves, 35 blocks; 2 sets closed and 1 full match; zero exceptions.
  - Separate point-split run: 60-61. Autopilot run is healthy.
  - Random-input fuzz and the heuristic human player run without exceptions.
  - Rule checks pass: 4 toques, dobles, set closes at 25, 25-24 does not close a set, tie-break at 15, punto de set announced.
- **Console checks:** `tools/console.sh` reports no JS errors for every scene (menu, serve, rally, spike, block, point, over, pause) and for mobile at 844x390.
- **Screenshots:** I took and looked at all of them in tools/out/: menu, serve, rally, spike, block, point, over and pause at 1280x720, plus mobile and serve at 844x390. They show a real lit 3D pavilion, crowd, LED boards, net and antennas, players in team colours with shadows, the ball with its landing ring, HUD, banners (¡BLOQUEO!, PUNTO CPU / CAMBIO DE SAQUE), the end screen with set scores, the pause screen and the touch buttons.
  - That review caught washed-out colours, which I fixed in main.js.
- **Real playthrough:** `node tools/drive.js` drives the actual page with key presses through DevTools. Results: the menu loads with the demo behind it, Enter starts the match with a human serve, Space serves, the human touched the ball 5 times and 2 points were played, P pauses and P resumes, no page errors ("TODO OK").
  - This run caught a real bug: pressing Space on a still-focused menu button. Fixed in ui.js: Enter clicks the focused button itself, and button focus is cleared when play starts.
- **Untouched:** /home/trilogi/work/voley-iso was only read, never modified. No git was used.

### notes_for_integration

None yet; notes/ only holds a README so far. Things specialists should know:
- **players:** rebuild rigs in onGameStart (update() also rebuilds if the players changed). When paused or frozen, update gets dt=0, so pose() must still produce a complete pose. Jersey numbers are not done yet.
- **arena:** the crowd is a single InstancedMesh of about 1150 figures (about 120k triangles and 131 draw calls in total). On low quality, reduce it using q.crowdDensity in setQuality; today density is only used at build time. A post-processing glow can be added through ctx.renderFn. The hanging scoreboard is not built yet.
- **camera_input:** camera.js owns ctx.timeScale (slow motion). It currently triggers on the 'point' event with matchWon, which fires when the ball lands; a better moment could be predicted from game.matchPoint plus pr1. With the third-person camera, blocking at the net puts the controlled player in front of the view; this needs framing work.
- **sim:** game.opts.difficulty is passed through but not used yet. The demo AI never plays a 'free' ball on the 3rd touch. The heuristic human in simtest rarely manages to spike (13 spikes out of 83 sets), which suggests the human attack timing needs an assist or a wider window for real players.
- **ui_main:** a tutorial/onboarding flow and a settings screen (quality, difficulty) are still to do. The settings fields already exist in ctx.settings and ctx.actions.setSetting.

### known_issues

- **Headless speed is not real performance.** In headless Chrome with SwiftShader the page runs at about 1–5 fps. That is a property of the software renderer, not of the game; pass `maxdt=0.25` for scripted runs (drive.js does this by default). Performance on a real GPU or phone is unmeasured; JS logic alone reaches 54 fps when rendering is turned off.
- **Fonts need network.** Google Fonts loads over the network; offline it falls back to system-ui.
- **Rally length.** The 120 Hz step makes the median CPU rally a little longer than the prototype's ~5 s: between 4.7 and 7.6 s depending on the seed.
- **Not built yet:** these are left to the specialists:
  - jersey numbers
  - hanging scoreboard
  - crowd noise that matches the crowd animation
  - tutorial
  - difficulty levels
  - a fullscreen button on desktop

  Touch fullscreen and landscape lock are attempted when a match starts, and a refusal is handled quietly.

## build:audio

### summary

Rewrote js/audio.js as a full procedural WebAudio engine for VOLEY 3D. Every sound is synthesised once in JS and played back as an AudioBuffer, so each hit costs 1 source plus 1-3 nodes. The catalogue has 38 sounds:
- Touches: forearm pass "thump", soft fingertip set, free ball, float serve slap, jump serve crack, spike CRACK with air whistle (scaled by power), tip, shank, and stuffed / soft / tool blocks.
- Ball and court: net rattle with cable vibration (plus a tape "thwack"), floor bounce, spike floor slam, dead-ball bounces, sneaker squeaks on sharp turns and stops (smoothed velocity per player), take-off scuff, feet landing, dive slide, swing whoosh, and a toss swish with approach steps on jump serves.
- Referee whistle: two-tone with pea trill and breath, in short (serve), medium (point) and long (end of set or match) versions.
- Crowd (stereo, formant voices): a murmur bed plus an excitement bed that swells with rally touches and time and rises on set or match point. It roars on home points, more for long rallies, kills, aces and blocks, and adds fan whistles and applause. It groans on home errors, goes "uuuh" on digs after a spike and on near-line outs, hushes on the toss, claps in unison with a bass drum while the home team waits to serve, and plays a heartbeat on match point.
- Music: original stings for set and match, win and loss (setWin, setLose, matchWin, matchLose). There is also a subtle chime for a perfect-timing touch by the human, and UI sounds (click, hover, back, start).
- Mix: master compressor, procedural pavilion convolution reverb (off at low quality), stereo panning and distance attenuation relative to the camera.
- Pause and slow-mo: pause closes a lowpass on effects and crowd. Slow-mo lowers pitch and closes the lowpass.
- Settings and lifecycle: volumes for master, sfx, music and crowd. Mute and hidden tab suspend the AudioContext; unmute and visible resume it. The context is created only inside unlock().
- Generation runs in time slices (requestIdleCallback, or setTimeout as fallback, about 4-5 ms per slice) in priority order, so the menu does not stall on phones.

The module loads in node without window or AudioContext, and handle() is safe with any event, null, unknown types and missing fields. It already uses the sim's newer events and fields (toss, dive, netTouch, miss, hit.shot/power/grade, block.result, point.how) and falls back gracefully when they are absent. The event-to-sound map, the API additions and the requests to ui_main are in notes/audio.md.

### files_changed

/home/trilogi/work/voley-3d/js/audio.js, /home/trilogi/work/voley-3d/notes/audio.md

### verified

1) Node harness (/home/trilogi/work/voley-3d/tools/out/audiotest.js, log in tools/out/audiotest.log), result TODO OK, exit 0:
- Load without AudioContext plus the full API and handle() with every event type, null, {}, unknown types and missing fields: no errors, no sound.
- All 38 sounds synthesised: no NaN, peak at most 1, no clicks at the edges (except the loop beds and the IR, which are not meant to start at zero). WAVs written to tools/out/audio/*.wav for listening.
- Mock AudioContext plus a full CPU-vs-CPU autopilot match driven by real sim events at 60 fps: every event type reachable, about 153 sounds/min, at most 9 simultaneous voices, at most 6 new sounds in one frame, 0 dropped, exactly 1 match sting.
2) Headless Chrome with real WebAudio (scratch CDP driver, --autoplay-policy=no-user-gesture-required --mute-audio):
- Context 'none' before unlock, 'running' after; sliced generation completes; every catalogue sound and all 4 stings play through real nodes; mute gives 'suspended', unmute gives 'running'; 0 console errors or warnings.
- The only failure was 'roar' in an artificial stress test of 37 simultaneous sounds against the 32-voice cap, which is expected.
- Generation takes about 18 s wall-clock here in the worst case (SwiftShader at 1-5 fps, load average 40). The longest single step is about 200 ms wall-clock, inflated by descheduling; CPU profiling estimates about 2.5 ms on a normal desktop. Timings were measured on a machine about 7x slower than normal.
3) tools/console.sh menu: "sin errores JS".
4) tools/simtest.js: exits 1 with 2 failures ("ningún partido completo en demo", "las dificultades no están ordenadas"). These are sim-owned logic; simtest never loads audio.js.

### notes_for_integration

ui_main (optional, details in notes/audio.md section 4):
(a) Add settings defaults musicVol:0.75, sfxVol:1 and two "Efectos"/"Música" range sliders that call ctx.actions.setSetting('sfxVol'|'musicVol', v/100). Audio.onSettings already reads them, and the crowd follows sfxVol unless crowdVol exists.
(b) Wire these UI sounds, all behind a guard: VB.Audio.hover() on pointerenter of menu buttons, VB.Audio.ui('start') on the Jugar button, VB.Audio.ui('back') on back/menu.
Nothing in main.js needs to change: audio registers its own visibilitychange listener. The node harness can be moved to tools/audiotest.js if ui_main wants it in the tools set.

sim: nothing required. CONTRACT §4.3 should document the new events and fields already emitted (toss, dive, netTouch, miss, hit.shot/power/grade/timing, block.result/quality, point.how/lastKind/lastShot, new point reasons under/net/serve/block).

### known_issues

- I could not actually listen to the sounds. Quality was judged with objective checks only (peak, RMS, zero-crossing brightness per sound: pass about 245 Hz, set about 1.3 kHz, spike about 2.6 kHz, whistle about 5.5 kHz) and with the WAVs in tools/out/audio/, which Ferran should listen to. Gains may need tuning by ear.
- Crowd beds arrive about 1-3 s after the first gesture on a normal device, because generation is time-sliced (longer on slow phones).
- Under extreme polyphony (more than 32 voices) crowd one-shots share the voice cap with effects. Normal play peaks at 9 voices.
- The 'perfect' chime only fires for human touches with grade 'perfect', so it was never heard in the autopilot tests.
- simtest is currently red because of sim's own in-progress changes.

## build:sim

### summary

I rebuilt the gameplay simulation (js/sim.js), the AI (js/ai.js) and the test harness (tools/simtest.js). The public interfaces in CONTRACT.md still work; everything new is an addition.

**Touch quality now depends on timing.**
- HIT opens a 0.30 s swing. If the ideal contact moment is at most 0.05 s away, the swing waits for it.
- The ideal moment comes from a trajectory search: when the ball passes the contact point for that touch, including the player's own jump.
- Within ±35 ms of ideal is "perfect", within ±100 ms "good", otherwise "poor".
- Quality drives scatter, spike power (13.5–19 m/s), net/out risk, a deflected reception that flies off ("shank") and accidental oversets.
- Mashing HIT gains nothing: a press during a live swing only changes the shot type, and a missed swing locks HIT for 0.12 s.
- The CPU uses the same timing function with a random offset set by difficulty.

**New player tools.**
- Dive: pressing HIT for a low ball out of normal reach makes the player lunge, with capped quality, then stay down for 0.9 s.
- Tip: JUMP while in the air is a tip. It is reported as `kind:'free'` with `shot:'tip'`, so it causes no camera shake.
- Aim works on spikes and serves.
- Near the contact point, the human player is gently pulled into position and braked on arrival.
- `hitWindow()` gives the UI a timing ring value and a "¡Salta!" cue (`jumpT`).

**Serve.**
- There is a whistle 0.7 s after the server gets the ball; no toss is allowed before it, and the 8-second rule counts from it (`serveClock:false` turns it off).
- HIT tosses for a float serve, JUMP tosses for a jump serve (the run-up and jump are automatic, with take-off behind the end line), then HIT strikes.
- If the tossed ball falls without being hit, it is a service fault.
- The float serve moves sideways in flight, up to about 0.5 m and with no cumulative drift. The jump serve has topspin.

**Rules added:** player touching the net, ball passing under the net, ball touching the antenna versus passing outside it, blocking the serve is a fault, ball rolling over the net tape is legal, and the centre line holds. Existing rules (block not counting as a touch, double contact, 4 touches, sets to 25/15 by 2, rotation of the server within the team) are kept and tested. Point texts now distinguish "Saque a la red", "Balón a la red" and "Saque fuera".

**Difficulty.** `VB.DIFF` has Fácil, Normal and Difícil profiles, plus a fixed level for the human's AI teammate. They differ in reaction, speed, timing precision, blocking, digging, reception, spike/serve power, jump-serve rate, tips, aim, and unforced attack/serve errors. Blocks now resolve three ways: straight down into the attacker's court, a playable touch on the blocker's side, or deflected out off the hands.

**Events for other modules.**
- `hit` gains grade, timing, power, shot, dive, aim and target.
- `block` gains result.
- `point` gains how (ace/kill/tip/block/free/error), player, lastKind and lastShot.
- New event types: toss, miss (early/late/far), dive and netTouch.

The UI and audio modules already consume these.

**Balance.** Measured with bots that play only through the real controls, 30 minutes of game time per cell (share of points won by the human side):
- Novice: Easy 54%, Normal 30%, Hard 24%.
- Average: Easy 74%, Normal 55%, Hard 44%.
- Perfect: Easy 84%, Normal 65%, Hard 58%.

CPU vs CPU median rally is 5.0 s, close to the prototype.

### files_changed

/home/trilogi/work/voley-3d/js/sim.js, /home/trilogi/work/voley-3d/js/ai.js, /home/trilogi/work/voley-3d/tools/simtest.js, /home/trilogi/work/voley-3d/notes/sim.md

### verified

Final full run of `node tools/simtest.js` (defaults: 20 min CPU vs CPU, 8 min fuzz, 30 min per cell for the 12-cell matrix of AI-teammate vs each difficulty and three bot skill levels vs each difficulty, run in worker threads): TODO OK, exit 0.

It reports CPU vs CPU median rally 5.05 s with points split 75-61. All 22 rule checks pass:
- 4 touches and double contact (and `canReach` refuses a double).
- Block does not count as a touch; set to 25, win by 2, tie-break to 15; set point announced.
- Server rotation within the team; antenna touch, outside the antenna, under the net; net touch.
- Toss not hit, no serve before the whistle, 8-second rule and its `serveClock:false` off switch.
- Timing grades for presses 20/0/160/−70 ms around the ideal; blocking the serve; difficulty name aliases.

There are also no-exception and invariant checks: values stay finite, players never cross the centre line, never more than 3 touches, no consecutive touch without a fault, and jump-serve take-off always at x ≥ 9.

Separate node scripts in the scratchpad:
- Classified the bots' lost points; this exposed a bot that pressed HIT before jumping, which led to adding `jumpT`.
- Float-serve landing deviation from prediction: median 0.28 m, max 0.49 m over 150 serves.
- Confirmed the proposed toss, jump-serve and dive debug-scene snippets reach their moments (jump-serve server airborne at x = 9.48).

Browser:
- `tools/console.sh` for rally, spike, block, point, serve and over: no JS errors. The `over` scene completed a full match at 0-2.
- Screenshots of spike and serve in `tools/out/sim/` look right: the scene renders and the UI already shows the new serve prompts ("ESPACIO saque flotante · K saque en salto").

The machine was heavily loaded by other agents' headless Chrome (load average about 70), so some screenshot runs needed TMO=300.

### notes_for_integration

Everything is in /home/trilogi/work/voley-3d/notes/sim.md. Key points:

**players.js**
- Animate the new `lastAction` values `'toss'` (serve toss; the ball is not held while `g.serveState === 'toss'`) and `'dive'` (lunge, then lying on the floor while `p.down > 0`, direction in `p.lvx/p.lvy` or `dive.dir`).
- A tip is `lastAction 'spike'` with `p.shot === 'tip'`: use a soft extended-arm pose, not the full arm swing.
- During the jump serve (`act === 'jump'` and `g.mode === 'serve'`), use the spike arm pose, not the block pose.

**camera.js**
- Scale spike shake by `e.power` and `e.grade`. A tip arrives as `kind:'free'`, so it gets no shake.

**fx.js**
- Bigger impact flash on `grade === 'perfect'`; spark on `netTouch`; dust on `dive`; `block.result` 'stuff' should look heavy.
- The landing ring for a float serve will move during flight; that is intended.

**ui/main and tools**
- `miss.reason` texts: early → "¡Pronto!", late → "¡Tarde!", far → "No llegas".
- Optionally show "Espera el silbato" while `!g.serveAuth`.
- `tools/drive.js`: a serve is now two presses (toss, then strike). Wait for `VB.ctx.game.serveAuth` first, then add `await sleep(1000); await press(' ');` after the first press. Without this the serve still leaves `'serve'` mode, but as a fault.
- Suggested debug scenes `toss`, `jumpserve` and `dive`, with exact code tested in node, are in the notes.
- The live `serve` scene with no input gets an 8-second fault after about 8.7 s of game time. Use `createGame({serveClock:false})` there if long screenshots need it.

Difficulty strings `'easy' | 'normal' | 'hard'` (as main.js already passes) work unchanged; Spanish aliases are also accepted.

### known_issues

- The balance numbers come from bots. The "average" bot positions itself from exact predictions with a reaction time of 0.22 s, so a real human in third person is probably somewhat weaker. That is why Normal is set about 54/46 in the human's favour; it still needs tuning with real players.
- CPU vs CPU, Hard is only slightly stronger than Normal against the fixed AI teammate (46% vs 45% of points for the teammate, within noise). Against the human-input bots the step is clear (55 → 44 for the average bot). The ordering check in simtest only requires Easy to be clearly easier and Normal to be no stronger than Hard by more than 4 points.
- Some 2v2 simplifications remain: no side change and no back-row attack rule. A ball crossing outside the antenna is a fault immediately (FIVB allows recovering it from the opponent's free zone). Ball contact is only counted when a touch is attempted.
- With default arguments the full simtest takes about 1.5 minutes on this loaded machine. Pass `0` as the third argument to skip the matrix.

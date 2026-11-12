export const meta = {
  name: 'voley-3d',
  description: 'Build a polished third-person 3D volleyball game (Three.js) from the iso prototype: foundation, parallel specialists, integration, 2 critic/fix rounds',
  phases: [
    { title: 'Foundation', detail: 'architecture, port sim, minimal 3D, test harness' },
    { title: 'Build', detail: 'parallel specialists, one owner per file' },
    { title: 'Integrate', detail: 'merge notes, full verification' },
    { title: 'Review', detail: 'independent critics with screenshots and sim runs' },
    { title: 'Fix', detail: 'per-file fixers + integration' },
    { title: 'Final', detail: 'final verification report' },
  ],
}

const DIR = '/home/trilogi/work/voley-3d'
const CTX = `
You are part of a small game studio team building "VOLEY 3D", a browser volleyball game the user wants to be the best-looking, best-feeling browser volleyball game they have ever seen ("imagine it ships to market the moment we finish"). This is a PERSONAL hobby project of the user (Ferran) — not Trilogi client work: ignore all Trilogi customer-care/ticket/ClickUp/Zendesk/imputar rules from CLAUDE.md. Do NOT touch /home/trilogi/work/voley-iso (the existing isometric version must stay intact; read it only as reference).

PROJECT DIR: ${DIR}  (not a git repo; do not git init, do not commit)
REFERENCE PROTOTYPE: /home/trilogi/work/voley-iso/index.html — a working 2v2 isometric canvas game. Its simulation (physics in meters, rules, rally flow, AI, auto-assigned touch types pass/set/spike/free ball, blocks, serve rotation, sets 25/25/15 win by 2, faults: net, out, antenna, 4 touches, double) is tuned and tested: median rally ~5 s CPU vs CPU. Reuse it, don't reinvent it.

PRODUCT VISION:
- Real 3D with Three.js. Camera: THIRD PERSON, behind and slightly above the player the human currently controls, looking toward the net/opponents. When control passes to the teammate (it does automatically: control goes to whoever must play the next touch), the camera GLIDES smoothly to the new player — never a hard cut, never nauseating. The ball must always be readable: ball shadow on the floor, landing ring, maybe a subtle trail on spikes.
- Controls camera-relative: up = toward the net, right = player's right. Keyboard (arrows/WASD move, Space/J hit, K/X jump, C switch, P/Esc pause, M mute), gamepad (Gamepad API), and mobile touch (left-half floating joystick, big HIT and JUMP buttons on the right, pause button), landscape on phones.
- Same format as the prototype: 2v2 on an 18x9 indoor court, human team (red/orange) vs CPU (blue), best of 3 sets, Spanish UI text. The user is a volleyball referee (FCVB): rules and terminology must be correct (Spanish terms: saque, recepción, colocación, remate, bloqueo, toque, red, fuera, antena, dobles, 4 toques, set, punto de set, punto de partido, cambio de saque).
- Original art and design. Do NOT imitate any existing commercial game's names, characters, art or look.
- Visual target: stylized, premium, cohesive — think a polished indie sports game: an indoor pavilion with a gorgeous sports floor (procedural canvas textures), lit like a TV broadcast (warm key lights, soft shadows, tone mapping, subtle bloom-like glow if cheap), stands with an instanced low-poly crowd that reacts to points, LED ad boards with original fictional brands, a hanging scoreboard showing the live score. Athletes: stylized low-poly characters built from primitives with real procedural animation (ready stance, run cycle, forearm pass, overhead set, approach+jump+arm swing spike, block with hands over net, serve toss, dive/stretch, celebration, disappointment). Juice: hit impact flashes/particles, camera shake on spikes, slow-mo moment on match point win, crowd roar.
- Must run smoothly (60 fps target) on a mid-range phone: cap pixelRatio (≤2 desktop, ≤1.5 mobile), shadow map 2048 desktop / 1024 mobile, instancing, no per-frame allocations in hot loops, adaptive quality if fps drops.

HARD TECH CONSTRAINTS (it will be published as a claude.ai Artifact AND must work when opened locally via file://):
- Plain classic <script> files (NO ES modules, no import/export, no bundler) sharing one global namespace window.VB. Files load in order from index.html. Relative paths only (js/xxx.js).
- External scripts ONLY from https://cdnjs.cloudflare.com (preferred), https://cdn.jsdelivr.net/npm/, https://unpkg.com — pinned exact versions, UMD/global builds (e.g. three.js r128 or another version that still ships build/three.min.js, verified with curl -sI). No other network requests at runtime: no fetch of external assets, no external images/fonts except Google Fonts stylesheets (fonts.googleapis.com). All textures procedural (canvas) or data URIs. No glTF downloads.
- index.html must NOT contain <!doctype>, <html>, <head> or <body> tags (the publisher wraps it); start with <title>Voley 3D</title> and <style>. It is a single-look dark game: set color-scheme: dark and explicit background on html/body; html,body height:100%; no 100vh.
- No alert/confirm/prompt; no window.print; localStorage only inside try/catch and only for settings/best score. Audio only starts after a user gesture. Fullscreen/orientation lock optional with rejection handled.
- Gameplay simulation must stay pure and headless-testable in node: js/sim.js (and js/ai.js if split) must not touch DOM, THREE or window except via the VB namespace object (use \`var VB = (typeof window!=='undefined'?window:globalThis).VB || ...\` pattern).

VERIFICATION TOOLS (use them; never claim something works without running it):
- node is available. Headless sim test: node ${DIR}/tools/simtest.js (CPU vs CPU minutes, prints points, reasons, hit kinds, blocks, rally stats; plus a random-input human fuzz run). Must run without errors.
- Headless Chrome is /usr/bin/google-chrome. WebGL in headless needs: google-chrome --headless=new --no-sandbox --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --window-size=W,H --virtual-time-budget=6000 --screenshot=OUT.png "file://${DIR}/index.html?debug=SCENE". The foundation creates ${DIR}/tools/shot.sh <scene> <W> <H> <out.png> and tools/console.sh (captures console errors via --enable-logging=stderr --v=0). Debug query params (?debug=menu|serve|rally|spike|block|point|mobile etc.) deterministically advance the sim to a representative moment and freeze/hold so screenshots are meaningful; they must be inert when absent. You can view PNGs with the Read tool — LOOK at your screenshots and judge them critically.
- Put scratch outputs (screenshots, logs) in ${DIR}/tools/out/ .
`

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    files_changed: { type: 'array', items: { type: 'string' } },
    verified: { type: 'string', description: 'what you actually ran/looked at and the result' },
    notes_for_integration: { type: 'string', description: 'cross-file changes needed in files you do not own; empty if none' },
    known_issues: { type: 'string' },
  },
  required: ['summary', 'files_changed', 'verified', 'notes_for_integration', 'known_issues'],
}
const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    overall_score: { type: 'number', description: '0-10 for your lens' },
    verdict: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          owner: { type: 'string', enum: ['sim', 'players', 'arena', 'camera_input', 'audio', 'ui_main'] },
          title: { type: 'string' },
          evidence: { type: 'string', description: 'screenshot path, command output, file:line' },
          fix: { type: 'string', description: 'concrete fix proposal' },
        },
        required: ['severity', 'owner', 'title', 'evidence', 'fix'],
      },
    },
  },
  required: ['overall_score', 'verdict', 'findings'],
}

const OWNERS = {
  sim: 'js/sim.js and js/ai.js (gameplay simulation, rules, AI, hit quality/timing, serve types, difficulty) and tools/simtest.js',
  players: 'js/players.js (athlete models, materials, procedural animation state machine, celebrations)',
  arena: 'js/arena.js, js/venues.js, js/venue-*.js and js/fx.js (venue registry and maps, pavilion, floor, lines, net, antennas, posts, lighting, shadows, stands, crowd, LED boards, hanging scoreboard, ball mesh+shadow+trail, particles/impact FX)',
  camera_input: 'js/camera.js and js/input.js (third-person camera rig, transitions, shake, slow-mo hook, camera-relative input mapping, keyboard, gamepad, touch controls overlay)',
  audio: 'js/audio.js (procedural WebAudio: hit sounds per touch type, spike crack, net, block, whistle, crowd ambience and reactions, UI clicks, music sting)',
  ui_main: 'index.html, css (inline in index.html), js/ui.js and js/main.js (boot, loop, renderer setup, adaptive quality, menus, HUD, scoreboard overlay, pause, end screen, settings, tutorial/onboarding, debug scenes, tools/shot.sh, tools/console.sh)',
}

// ---------------- Phase 1: Foundation ----------------
phase('Foundation')
const foundation = await agent(`${CTX}

YOUR TASK: FOUNDATION ARCHITECT. Build the complete working skeleton of VOLEY 3D in ${DIR} so that 6 specialists can then work IN PARALLEL, each owning separate files, without stepping on each other.

1. Read the reference prototype fully. Port its simulation into js/sim.js (+ js/ai.js if you split AI) as a pure module: VB.Sim with createGame(opts), step(game, dt, humanInput), where humanInput is already in WORLD coordinates ({move:[wx,wy], hit:bool(pressed this frame), jump:bool, switchPlayer:bool}). The sim exposes state (players, ball, score, sets, mode, touches, jobs, controlled player, predictions pr1/pr3) and an events queue (e.g. {type:'hit', kind:'pass|set|spike|free|serve', player, quality}, 'block', 'net', 'land', 'point', 'set', 'match', 'whistle', 'jump', 'switch', 'serveReady') that render/audio/UI consume each frame. Keep all the prototype's tuning and the two fixes it already has (no touching your own serve; no same-player consecutive touch). Add a demo mode (CPU vs CPU) used behind the main menu.
2. Coordinate convention: document clearly. Sim: x along court length (net at x=0, human team at x>0), y across width, z up, meters. Provide VB.toThree(x,y,z,out) mapping to Three.js Y-up and use it everywhere.
3. Minimal but CORRECT versions of every other module so the game is fully playable end to end in 3D already: js/arena.js (floor+court lines+net+lights+shadows), js/players.js (simple capsule athletes positioned from sim, jump), js/fx.js (ball mesh + floor shadow + landing ring), js/camera.js (third-person behind controlled player with smooth follow and smooth glide on control switch; exposes basis so input is camera-relative), js/input.js (keyboard + basic touch joystick/buttons + gamepad stub) returning raw intents, js/audio.js (basic procedural sounds driven by events), js/ui.js (DOM HUD scoreboard, banners for points, start menu, pause, end screen — Spanish), js/main.js (renderer, resize via element client size, loop with fixed-step sim at 120 Hz, dispatch events to modules, debug scenes via ?debug=).
4. Write ${DIR}/CONTRACT.md: file ownership table (exactly: ${JSON.stringify(OWNERS)}), the module interfaces (function names, args, when called by main.js), the event list with payloads, the coordinate convention, the per-frame order, and rules: specialists edit ONLY their own files; any change needed elsewhere is written to ${DIR}/notes/<owner>.md for integration. Make interfaces rich enough that specialists won't need to change main.js (e.g. players.update(game, dt, events), arena.update(game, dt, events), fx.update(...), camera.update(game, dt, events, renderer), ui.update(game, dt, events), audio.handle(events, game)), and give modules access to scene, camera, renderer, quality level via a shared VB.ctx object.
5. Test harness: tools/simtest.js (node; loads sim files via vm; CPU-vs-CPU stats + random-input fuzz; exits non-zero on exceptions), tools/shot.sh, tools/console.sh, and debug scenes. Verify: simtest passes with healthy stats (rallies with passes, sets, spikes, blocks; points split; no exceptions), screenshots of menu, serve, rally (desktop 1280x720) and mobile landscape 844x390 render a real 3D scene with no console errors. LOOK at the screenshots.
6. Pin the Three.js version (verify the URL returns 200 with curl). Keep total code organized and commented (comments in Spanish or English, consistent).

Quality bar: this is the base everyone builds on; correctness and clean interfaces matter more than looks here, but it must already look decent.`, { label: 'foundation', phase: 'Foundation', schema: BUILD_SCHEMA })
log('Foundation: ' + (foundation ? foundation.summary.slice(0, 300) : 'FAILED'))
if (!foundation) return { error: 'foundation failed' }

// ---------------- Phase 2: Specialists ----------------
const SPECIALISTS = [
  { key: 'sim', brief: `GAMEPLAY DESIGNER/ENGINEER. Own: ${OWNERS.sim}. Make it feel great and fair with a third-person camera: timing-based hit quality (perfect/good/poor windows shown via events so UI/FX can react), aim control on spikes and serves (camera-relative aim already converted to world by main), serve types (float serve standing, jump serve if player jumps before hitting), tips/rolls (soft attack if hit pressed briefly? design something simple and intuitive), digs on hard spikes with a reach-stretch/dive window, 3 difficulty levels for CPU (Fácil/Normal/Difícil) affecting reaction, errors, block success, spike power. Keep rules correct (referee user): rally point scoring, sets to 25 (3rd to 15) by 2, side change? (for 2v2 indoor not required — skip), service order alternation within the team, 3 touches max, block touch doesn't count, consecutive contact fault except after block, ball crossing outside antennae fault, net touch by player during play is a fault (add it: jumping player touching net top while ball in play near him), center line: players may not cross. Assist: generous but skill-based windows; the human should win about 50% vs Normal after some practice. Re-tune and prove with tools/simtest.js (extend it: per-difficulty stats, human-bot that plays with perfect/average timing to estimate win rates). Emit rich events for other modules (quality, kind, power, aim).` },
  { key: 'players', brief: `CHARACTER ARTIST + ANIMATOR. Own: ${OWNERS.players}. Build stylized, appealing low-poly athletes from primitives (no external models): proportions of real volleyball players (tall, long limbs), jersey with number (canvas texture), shorts, knee pads, shoes, hair variety, skin tone variety; team colors red/orange vs blue. Hierarchical rig (hips, spine, chest, neck, head, upper/lower arms, hands, thighs, shins, feet) animated procedurally with smooth blending between states: ready stance (knees bent, weight forward), shuffle/run cycle with speed-matched stride, forearm pass (platform), overhead set (hands above forehead), spike approach + two-foot jump + bow-and-arrow arm swing timed to contact, block (hands over net, penetration), serve toss + hit (float and jump serve), dive/stretch for far balls, celebration (fist pump, team high-five when close), frustration on lost point, idle breathing. Face the right way (toward ball/net), lean into movement, foot planting without obvious sliding. Driven by sim state + events (hit events tell you exact contact frames). Must be cheap: shared geometries/materials, ~4 characters. Verify with screenshots (add debug scenes in notes if needed, or use existing ones) and LOOK at them critically; iterate until the athletes look premium, not like capsules.` },
  { key: 'arena', brief: `ENVIRONMENT + LIGHTING + VFX ARTIST. Own: ${OWNERS.arena}. Create a stunning original indoor pavilion: procedural canvas textures for a premium sports floor (court in one color, free zone in another, subtle wood/PU grain, crisp anti-aliased lines with correct dimensions: 18x9, attack lines at 3 m, free zone), net with real mesh look (alpha texture), white top band, antennas red/white, posts with padding, referee stand (the user is a referee — include a first referee on the stand and a simple scorer table), stands with an instanced crowd (thousands of cheap figures with color variety, idle bob, waves of cheering on points via events), LED ad boards with original fictional brands that animate, a hanging center scoreboard (canvas texture showing live score/sets), ceiling truss lights. Broadcast lighting: hemisphere + key directional with soft shadows (PCFSoft), ACES tone mapping, sRGB output, fog/vignette for depth. Ball: proper volleyball look (3-color panel texture, spin), floor shadow + landing ring + spike trail; impact particles/flash on hits (stronger on spikes), sand-like dust? no — floor squeak sparks are fine, confetti on match win. Adaptive quality hooks (VB.ctx.quality low/med/high reduces crowd count, shadow size, particles). LOOK at screenshots desktop+mobile and iterate until it looks like a premium product.` },
  { key: 'camera_input', brief: `CAMERA + CONTROLS DESIGNER. Own: ${OWNERS.camera_input}. Third-person camera behind the controlled player: tuned height/distance/FOV so you see your player, the net and the opponents; ball always readable (gently bias look target toward ball when it is high/far, keep the player in lower third); smooth critically-damped follow; glide on control switch (ease, ~0.35-0.6 s, no motion sickness); special framing for serve (behind server), for spike (slightly lower dramatic angle), during opponent's attack, between points (slow cinematic orbit/pan) and on match end; small camera shake on spikes/blocks; slow-mo hook (VB.ctx.timeScale) for match point win. Avoid clipping through net/stands. Input: camera-relative mapping (up = toward net from player's perspective; right = screen right), keyboard with key repeat safety, hit buffer handled in sim, gamepad (left stick move, A hit, B/X jump, RB switch, Start pause) with deadzones, touch controls drawn as a DOM or canvas overlay: floating joystick on left half, large HIT (naranja) and JUMP (azul) buttons right with pressed feedback, pause button, safe-area insets, prevent scroll/zoom, portrait shows "Gira el móvil". Verify with screenshots of several scenes and by reasoning about transitions (add debug scene for switch if needed via notes).` },
  { key: 'audio', brief: `SOUND DESIGNER. Own: ${OWNERS.audio}. All procedural WebAudio (no files): satisfying distinct sounds for forearm pass (thump), set (soft pat), spike (sharp crack + floor slam on landing), block (stuffed thud), serve toss/hit, net hit (rattle), ball bounce on floor, sneaker squeaks on fast direction changes, referee whistle (realistic two-tone trill with noise), crowd ambience bed (filtered noise with murmur modulation) that swells on long rallies and roars on points/blocks, groans on errors, UI click/hover, a short original musical sting for set/match win. Master bus with compressor, volume settings (music/effects), mute (M), respects visibility (suspend when hidden). Starts only after user gesture. Driven entirely by events + game state. Keep CPU light. Verify in node that the module loads without AudioContext and that handle() is safe with every event type; document the event-to-sound map in notes.` },
  { key: 'ui_main', brief: `UI/UX + TECH LEAD for shell. Own: ${OWNERS.ui_main}. Premium game UI in Spanish: title screen over the live CPU-vs-CPU demo with a strong original logo treatment (Google Fonts allowed, e.g. a sporty condensed display face + clean body face, with fallbacks), menu: Jugar, Dificultad (Fácil/Normal/Difícil), Controles, Ajustes (sonido, calidad gráfica auto/alta/media/baja, sensibilidad cámara), and a quick interactive tutorial ("Cómo se juega": serve, pass, set, spike, block explained with the touch type logic). In-game HUD: broadcast-style scoreboard (team names TÚ/CPU, score, sets, serve indicator, set number), touch counter for your team, contextual hints ("¡Salta!", "Golpea ahora" when ball in window), big animated banners for Punto, Bloqueo, Ace, Punto de set, Punto de partido, Cambio de saque; pause menu; end screen with stats (aces, remates, bloqueos, errores, racha). Smooth CSS transitions, focus states for keyboard/gamepad navigation, responsive for phone landscape with safe areas. main.js: renderer setup (antialias, ACES, sRGB, shadows), resize by client size, fixed-step loop, adaptive quality (measure fps, step quality down/up with hysteresis), pause on visibilitychange, debug scenes for every module (menu, serve, rally, spike, block, point, switch, mobile, end) deterministic via seeded RNG if sim supports it. Keep tools/shot.sh and console.sh working. LOOK at your screenshots.` },
]

phase('Build')
const built = await parallel(SPECIALISTS.map(s => () => agent(`${CTX}

Read ${DIR}/CONTRACT.md first, then the current code. YOUR ROLE: ${s.brief}

RULES: edit ONLY the files you own (listed above). Other specialists are editing the other files at the same time — do not touch them, not even to fix a typo; write any needed cross-file change to ${DIR}/notes/${s.key}.md with exact code snippets. Keep the public interfaces from CONTRACT.md working (you may ADD optional functions/fields; document additions in your notes file). Verify your work (simtest for logic; tools/shot.sh screenshots for visuals — note other modules may be mid-edit, so if a screenshot breaks because of someone else's file, retry later or judge your part only). Aim for shipping quality.`, { label: 'build:' + s.key, phase: 'Build', schema: BUILD_SCHEMA })))
built.forEach((b, i) => log(`${SPECIALISTS[i].key}: ${b ? b.summary.slice(0, 200) : 'FAILED'}`))

// ---------------- Phase 3: Integrate ----------------
async function integrate(label, reports) {
  return agent(`${CTX}

YOUR ROLE: INTEGRATION LEAD (${label}). All specialists have finished. Reports from this round:
${JSON.stringify(reports.filter(Boolean), null, 1).slice(0, 30000)}

1. Snapshot first: cp -r ${DIR} /home/trilogi/work/voley-3d-snapshots/${label}-before (mkdir -p parent).
2. Read every ${DIR}/notes/*.md and apply the cross-file changes (you may edit any file now). Clear applied items from the notes (keep a short "applied" log at the end of each notes file).
3. Make the whole game work together: run node tools/simtest.js, tools/console.sh for menu/serve/rally/mobile, and screenshots of all debug scenes at 1280x720 and 844x390. Zero console errors, zero exceptions. LOOK at each screenshot.
4. Play-test by reasoning through a full human rally flow in code (serve → receive → set → spike → block → point → next serve → set end → match end → replay) and fix any broken transition. Check file:// local load and artifact constraints (no doctype/html/head/body tags in index.html, pinned CDN, no other network).
5. Update CONTRACT.md if interfaces changed.`, { label: 'integrate:' + label, phase: label.startsWith('build') ? 'Integrate' : 'Fix', schema: BUILD_SCHEMA })
}
phase('Integrate')
let integ = await integrate('build', built)
log('Integration: ' + (integ ? integ.summary.slice(0, 300) : 'FAILED'))

// ---------------- Phase 4/5: Review + Fix rounds ----------------
const CRITICS = [
  { key: 'visual', lens: 'ART DIRECTOR. Judge visual quality as if reviewing for a store feature: composition, lighting, materials, athletes, animation poses mid-action, crowd, net, floor lines accuracy, ball readability, UI typography and layout. Capture many screenshots across debug scenes at 1280x720 and 1920x1080 and LOOK at them closely. Be harsh: anything that looks like placeholder/programmer art is major.' },
  { key: 'gameplay', lens: 'GAMEPLAY + RULES REVIEWER (the user is a volleyball referee). Read sim/ai code, run tools/simtest.js and extend scenarios in a scratch copy under tools/out/ (do not edit project files). Check rules correctness (scoring, set/match end, service order, touch counting, block touch not counted, double contact, net touch, antenna, center line, out/in on lines), fairness, difficulty curve, whether a human can actually perform pass/set/spike/block with the third-person camera, hit windows, aim, edge cases (ball exactly on line, ball under net, simultaneous events, pause during point).' },
  { key: 'camera', lens: 'CAMERA + CONTROLS REVIEWER. Evaluate third-person camera framing in every scene (screenshots), transitions on control switch (inspect code + capture sequential frames via debug scene/time params if available), ball readability, motion-sickness risks, clipping, input mapping correctness (camera-relative, keyboard/gamepad/touch), touch overlay usability on 844x390 and 667x375 screenshots, portrait handling.' },
  { key: 'tech', lens: 'TECH/PERF/ROBUSTNESS REVIEWER. Console errors in all scenes, exceptions in simtest/fuzz, memory leaks (per-frame allocations, unbounded arrays/particles/events), adaptive quality, draw calls/triangles (log renderer.info in a debug run), mobile perf risks, file:// and artifact CSP compliance (only pinned allowed CDNs, Google Fonts only, no other network, no doctype/html/head/body tags, no alert/print, localStorage try/catch), visibilitychange/pause, resize/orientation, AudioContext gesture rules.' },
  { key: 'player', lens: 'FIRST-TIME PLAYER + PRODUCT REVIEWER. Would someone pay for and rave about this? Judge onboarding (menu, tutorial clarity in Spanish), first 30 seconds, feedback/juice on every action, banners, end screen, settings, consistency of Spanish wording and volleyball terminology, delight moments. Use screenshots of menu, tutorial, HUD, end screen.' },
]

for (let round = 1; round <= 2; round++) {
  phase('Review')
  const reviews = await parallel(CRITICS.map(c => () => agent(`${CTX}

Read ${DIR}/CONTRACT.md. YOUR ROLE (review round ${round}, READ-ONLY on project files — write only to ${DIR}/tools/out/review-${round}-${c.key}/): ${c.lens}
Report concrete, verified findings only (each with evidence you actually observed: screenshot path you LOOKED at, command output, or file:line). Assign each to the owner whose files must change. Prioritize what most improves the final product; max ~15 findings, most important first. Give an overall 0-10 score for your lens.`, { label: `review${round}:${c.key}`, phase: 'Review', schema: FINDINGS_SCHEMA })))
  const all = reviews.filter(Boolean).flatMap((r, i) => r.findings.map(f => ({ ...f, critic: CRITICS[i].key })))
  reviews.forEach((r, i) => r && log(`round ${round} ${CRITICS[i].key}: ${r.overall_score}/10 — ${r.verdict.slice(0, 160)}`))
  const byOwner = {}
  for (const f of all) (byOwner[f.owner] = byOwner[f.owner] || []).push(f)
  const owners = Object.keys(byOwner)
  if (!owners.length) { log(`round ${round}: no findings`); break }
  phase('Fix')
  const fixes = await parallel(owners.map(o => () => agent(`${CTX}

Read ${DIR}/CONTRACT.md. YOUR ROLE: FIXER for owner "${o}" — you own ONLY: ${OWNERS[o]}. Other fixers are editing the other files right now; do not touch them; cross-file needs go to ${DIR}/notes/${o}.md with exact snippets.
Review findings assigned to you (round ${round}):
${JSON.stringify(byOwner[o], null, 1).slice(0, 20000)}
Fix critical and major ones first, then minor ones where cheap. Verify each fix (simtest / screenshots you LOOK at). If you disagree with a finding, say why in known_issues. Raise the quality bar beyond the findings where you see clear opportunities in your files.`, { label: `fix${round}:${o}`, phase: 'Fix', schema: BUILD_SCHEMA })))
  integ = await integrate('round' + round, fixes)
  log(`round ${round} integration: ` + (integ ? integ.summary.slice(0, 300) : 'FAILED'))
}

// ---------------- Final ----------------
phase('Final')
const final = await agent(`${CTX}

YOUR ROLE: FINAL QA. Do not add features. Run node tools/simtest.js, tools/console.sh on every debug scene, screenshots of menu/serve/rally/spike/block/point/end at 1280x720 and 844x390 (LOOK at all), confirm artifact constraints (index.html first lines, CDN pins, no external network, no forbidden tags/APIs). Fix only small breakages you find (any file). Return: what works (verified), any remaining issues honestly, the list of screenshot paths that best show the game (for the user), and a short Spanish feature list.`, { label: 'final-qa', phase: 'Final', schema: {
  type: 'object',
  properties: {
    works: { type: 'string' }, remaining_issues: { type: 'string' },
    best_screenshots: { type: 'array', items: { type: 'string' } },
    feature_list_es: { type: 'string' }, files: { type: 'array', items: { type: 'string' } },
  },
  required: ['works', 'remaining_issues', 'best_screenshots', 'feature_list_es', 'files'],
} })
return { foundation: foundation && foundation.summary, final }

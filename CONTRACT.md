# VOLEY 3D — Contrato de arquitectura

Juego de voley 2 contra 2 en 3D (Three.js r149), navegador, escritorio + móvil.
Proyecto personal. Este documento es la ley para los 6 especialistas que trabajan en paralelo.

## 1. Propiedad de ficheros (exacta)

```json
{"sim":"js/sim.js and js/ai.js (gameplay simulation, rules, AI, hit quality/timing, serve types, difficulty) and tools/simtest.js","players":"js/players.js (athlete models, materials, procedural animation state machine, celebrations)","arena":"js/arena.js and js/fx.js (pavilion, floor, lines, net, antennas, posts, lighting, shadows, stands, crowd, LED boards, hanging scoreboard, ball mesh+shadow+trail, particles/impact FX)","camera_input":"js/camera.js and js/input.js (third-person camera rig, transitions, shake, slow-mo hook, camera-relative input mapping, keyboard, gamepad, touch controls overlay)","audio":"js/audio.js (procedural WebAudio: hit sounds per touch type, spike crack, net, block, whistle, crowd ambience and reactions, UI clicks, music sting)","ui_main":"index.html, css (inline in index.html), js/ui.js and js/main.js (boot, loop, renderer setup, adaptive quality, menus, HUD, scoreboard overlay, pause, end screen, settings, tutorial/onboarding, debug scenes, tools/shot.sh, tools/console.sh)"}
```

`tools/drive.js`, `tools/eval.js`, `tools/shot.js`, `tools/cdp.js`, `tools/chrome.js`, `tools/chrome-env.sh`, `tools/perf.js`, `tools/touchplay.js` y `tools/padplay.js` también son de **ui_main**.
`tools/audiotest.js` es de **audio**; `tools/touchtest.js`, `tools/padtest.js` y `tools/courttest.js` son de **camera_input**.

**Reglas**
- Cada especialista edita SOLO sus ficheros. Nada de tocar ficheros ajenos "solo una línea".
- Si necesitas algo en un fichero ajeno, escríbelo en `notes/<owner>.md` (p. ej. `notes/ui_main.md`)
  con: qué, por qué, firma exacta propuesta. El integrador lo aplica.
- Nuevas capacidades se exponen como funciones OPCIONALES en tu propio módulo (main.js llama a todo
  con guarda: si la función no existe, no pasa nada). Lee de otros módulos solo con guarda
  (`VB.Players && VB.Players.rigOf && ...`).
- Nunca romper las interfaces de la sección 4. Puedes AÑADIR campos a eventos/estado (sim) o funciones (todos).
- Sin `alert/confirm/prompt`, sin `window.print`, `localStorage` solo dentro de try/catch.
- No crear ficheros nuevos de JS sin pasar por `notes/ui_main.md` (index.html carga la lista fija).

## 2. Restricciones técnicas

- Scripts clásicos (`<script src>`), SIN módulos ES, sin import/export, sin bundler. Un único espacio global `window.VB`.
- Orden de carga (index.html): `three.min.js` (cdnjs 0.149.0) → `js/sim.js` → `js/ai.js` → `js/arena.js` → `js/fx.js` →
  `js/players.js` → `js/camera.js` → `js/input.js` → `js/audio.js` → `js/ui.js` → `js/main.js` (main arranca).
- Three.js: `https://cdnjs.cloudflare.com/ajax/libs/three.js/0.149.0/three.min.js` (verificado 200; r149 es el último sin aviso de deprecación del build UMD).
  API r149: `outputEncoding`/`sRGBEncoding`, `CapsuleGeometry` disponible, `THREE.ColorManagement.legacyMode = false` (lo pone main.js:
  los hex de materiales son sRGB; **toda textura de color de canvas debe llevar `tex.encoding = THREE.sRGBEncoding`**).
- Cero peticiones de red en tiempo de ejecución salvo three.js y Google Fonts. Texturas procedurales (canvas) o data URIs.
- `index.html` sin `<!doctype>/<html>/<head>/<body>`; empieza por `<title>Voley 3D</title>`. Debe funcionar en `file://` y como Artifact.
- Sim (`sim.js`, `ai.js`) pura: sin DOM, sin THREE, sin `window` salvo vía el objeto VB
  (`var root = (typeof window!=='undefined')?window:globalThis; var VB = root.VB = root.VB || {}`).
- Rendimiento: 60 fps objetivo en móvil medio. Sin asignaciones por frame en bucles calientes (reutiliza Vector3/objetos),
  instancing para multitudes, respeta `ctx.quality`.
- Campos numéricos de objetos de larga vida (partido, jugadores, rigs, pools): si un campo nace entero (`0`, `-1`, `-99`) y luego recibe
  doubles, generalizarlo al crear el objeto (`dblFields(o)` en sim.js/players.js/fx.js; camera.js usa `0.5` y reasigna). Si no, V8 depreca el
  mapa en mitad del peloteo y desoptimiza a la vez el código caliente de todos los módulos.

## 3. Coordenadas

**Simulación (metros, z arriba):**
- `x` = largo. Red en `x = 0`. Equipo 0 (humano, rojo/naranja) en `x > 0`; equipo 1 (CPU, azul) en `x < 0`. Fondos en `x = ±9`.
- `y` = ancho. Laterales en `y = ±4.5`. Antenas en `y = ±4.5`, postes en `y = ±5.5`.
- `z` = altura. Suelo `z = 0`, borde superior de la red `z = 2.43` (`VB.C.NET_H`).
- `VB.Sim.side(team)` = `+1` (equipo 0) / `-1` (equipo 1).

**Three.js (y arriba):** `three.x = sim.x`, `three.y = sim.z`, `three.z = -sim.y` (base dextrógira).
Usar SIEMPRE `VB.toThree(x, y, z, out)` (acepta un `THREE.Vector3` o `{x,y,z}`; sin `out` devuelve un objeto nuevo: no usar así en bucles)
y `VB.fromThree(tx, ty, tz, out)`.
- Un modelo construido mirando a `+X` local con `rotation.y = atan2(simDy, simDx)` mira hacia la dirección de simulación `(simDx, simDy)`.
- Plano en el suelo: `PlaneGeometry` + `rotation.x = -PI/2`; luego `position.x = sim.x`, `position.z = -sim.y`.

**Pantalla/cámara (entrada):** `mx` derecha +, `my` hacia la red (arriba en pantalla) +.
main.js convierte con `VB.CameraRig.getBasis()` = `{fx, fy, rx, ry}` (adelante y derecha de la cámara en el suelo, coords de sim):
`world = (rx*mx + fx*my, ry*mx + fy*my)`. Con la cámara detrás del equipo humano: adelante = `(-1,0)`, derecha = `(0,1)`.

## 4. Interfaces

### 4.1 Contexto compartido `VB.ctx` (lo crea main.js)
| campo | descripción |
|---|---|
| `THREE, renderer, scene, camera` | motor; `camera` es `PerspectiveCamera` (la mueve camera.js) |
| `canvas, container` | `#stage` contiene el canvas WebGL |
| `width, height` | tamaño CSS actual del contenedor |
| `quality` | `{level:'high'|'medium'|'low', rank:2|1|0, pixelRatio, shadowSize:2048|1024|512, shadows, antialias, crowdDensity:1|0.7|0.4}` |
| `isTouch, isMobile` | detección (forzado con `?debug=mobile`) |
| `state` | `'menu' | 'playing' | 'paused' | 'over'` |
| `game` | partido actual (`VB.Sim.createGame`); en el menú es un partido demo CPU vs CPU |
| `timeScale` | escala del tiempo de juego; la gestiona camera.js (cámara lenta). main.js la aplica |
| `realDt, gameDt, time, frame, fps` | tiempos del frame (`time` real acumulado) |
| `debug, params, frozen` | escena de depuración, parámetros de URL, simulación congelada |
| `portraitBlock` | móvil en vertical en partido: la sim se detiene y UI muestra "Gira el móvil" |
| `renderFn` | si no es null, main.js llama `renderFn(ctx)` en vez de `renderer.render(scene,camera)` (post-proceso de arena) |
| `settings` | `{muted, difficulty, quality:'auto'|'high'|'medium'|'low', showHelp}` persistido en localStorage |
| `actions` | `startMatch(opts), toMenu(), pause(), resume(), togglePause(), restart(), setSetting(k,v), toggleMute()` |
| `shake(amount, dur)`, `slowmo(scale, realSeconds)` | atajos hacia camera.js |
| `simMove` | `[wx, wy]` entrada de MUNDO del frame (la misma matriz que recibe `Sim.step`; FX la lee para la retícula de apuntado) |
| `endHold` | lo escribe ui.js: celebración de victoria en curso antes de la tarjeta final (main.js pinta a ritmo completo) |
| `canvasAA`, `prewarm(mode)`, `prewarmMs` | MSAA del lienzo; precalentado de texturas al arrancar/empezar partido (ver notes/ui_main.md) |
| `frameMs`, `frameMsAvg` | coste JS del último frame / media de la ventana de 2 s (calidad adaptativa y `tools/perf.js`) |
| `qLog` | cambios de calidad adaptativa `{t, rt, level, scale, pr, fps, js, why}` (`rt` = s reales desde el arranque; `t` = `ctx.time`, que va por detrás con frames recortados). `why` incluye `'escala deshecha (xN)'` |
| `cpuBusy` | fracción ocupada del hilo principal en la ventana: máx.(JS del juego / intervalo, suma de tareas largas / 2 s; PerformanceObserver `longtask`). Decide si la escala de render ayuda |
| `fixShadowDepth()` | pone un `customDepthMaterial` compartido por variante a `SkinnedMesh`/`InstancedMesh` (evita recompilar el material de profundidad 4 veces por frame). Llamarlo si se crean casters nuevos después de `onGameStart`/`setQuality` |

### 4.2 Simulación `VB.Sim` (sim.js) + `VB.AI` (ai.js) + `VB.C` (constantes)
- `createGame(opts)` → `game`. `opts = {demo, autopilot, seed, difficulty ('easy'|'normal'|'hard'|'expert' = Fácil/Normal/Difícil/Experto, alias castellanos; orden en `VB.DIFF_ORDER`, nombre visible `VB.DIFF[k].name`), serveClock (false = sin regla de 8 s), stats, rookie (primer partido: la CPU saca más suave; sin efecto en Difícil/Experto)}`.
  `demo`: CPU vs CPU (menú). `autopilot`: partido "humano" pero el equipo 0 lo juega la IA (escenas de depuración).
- `step(game, dt, input)` — paso fijo `1/120`. `input` en coords de MUNDO: `{move:[wx,wy] (|v|≤1), hit, jump, switchPlayer}`;
  `hit/jump/switchPlayer` son flancos (pulsado en este paso). En saque humano: `move` desplaza al sacador a lo ancho y apunta.
- `drainEvents(game, outArray)` — mueve los eventos pendientes a `outArray`.
- `predict(game, zt, out)`, `predictLanding(game, out)`, `focusPoint(game)` (pr1 o pr3 según toque), `canReach(game, p)`, `other(game, p)`, `side(team)`, `isHuman(game,p)`.
- **Estado de `game`** (lectura para todos): `mode ('serve'|'rally'|'point'|'over')`, `demo`, `autopilot`, `time`,
  `players[4]`, `teams[2][2]`, `ball {x,y,z,vx,vy,vz,held,spin,speed}`, `score[2]`, `sets[2]`, `setNo`, `setScores[[a,b]...]`,
  `serving`, `serverIdx`, `touchTeam`, `touches`, `lastPlayer`, `lastTeam`, `lastKind`, `ctrl` (jugador humano), `jobs[2]`,
  `pr1`/`pr3` (`{x,y,z,t}` cruce a 1 m / 3 m bajando), `setPoint`/`matchPoint` (equipo o -1), `finished`, `lastPoint`, `rally {t, hits}`.
- **Jugador**: `{id, team, idx, num, x,y,z, vx,vy (velocidad real), vz, anim, cool, onGround, lastAction, actionT}`
  `lastAction ∈ '' | 'pass' | 'set' | 'spike' | 'free' | 'serve' | 'block' | 'swing' | 'jump' | 'toss' | 'dive'`, `actionT` = segundos desde entonces.
  Añadidos: `down` (>0 = en el suelo tras plancha), `shot` (subtipo del último toque; dejada = `lastAction 'spike'` + `shot 'tip'`), `grade`,
  `jvx/jvy` (deriva en el aire), `lvx/lvy` (impulso de plancha).
- **Añadidos al estado** (ver notes/sim.md §2): `difficulty`, `prof[team]`; saque: `server`, `serveState ('ready'|'toss')`, `serveJump`,
  `serveAuth` (ya pitó el árbitro), `serveClock` (s que quedan de los 8), `serveT`, `tossT`, `jumpAt`; gesto humano: `hitBuf`, `swingLive`, `swingShot`, `swingAim/swingHasAim`;
  `digMargin` (s; margen de defensa del último remate: >0 el defensor llega con tiempo, <0 al hueco); `lastLand` (`{x,y,inside,t}` primer bote del rally, `null` desde `serveReady`);
  `jobMem/jobMemT/jobSwT/jobHop` (memoria interna de la IA para quién va al balón);
  `lastGrade`, `lastShot`, `lastTouchT`, `netSince`; balón: `ball.dip`, `ball.wobA/wobF/wobP` (baile del flotante).
- **Revisión 2**: `g.tm` (`{assist, swing, lock}` ayuda de timing del humano por nivel, `VB.TIMING[nivel]`); `g.defRole` (`''|'dig'|'block'`:
  al colocar la CPU el humano defiende y su compañero bloquea; CAMBIAR durante la colocación = bloquear tú); `g.recvRisk` (dificultad del
  último saque para el receptor); `g.blockBy` (último bloqueador); `g.courtSwap3` (ya se cambió de campo a los 8 del 3.er set);
  `p.shot` admite `'body'` (el balón le da en el cuerpo: cuenta como toque).
- **R4 (verificación de reglas)**: `g.atkServe` (`{team, player}`: ataque del saque rival por encima de la red en zona de ataque pendiente; solo es falta si el balón cruza entero el plano de la red o lo toca el bloqueo rival; se borra en cada toque y en `serveReady`); `rookie` tiene efecto real en Fácil/Normal (`rookieProf(pr, on, diff)`: en Fácil solo saque suave y `srvErr` ×0,65; en Normal además remate un 10 % más lento, `atkErr` ×1,4, `aimNoise` ×1,25, `dig` ×0,8, `block` ×0,5).
- **R5 (verificación 2)**: criterio único de remate `isAttackContact(p, b)` (interno: `p.z > 0,25 && |b.x| < 3,8 && b.z > NET_H + 0,1`) que usan `hit()` y `aimPoint()` (la retícula promete el mismo tipo de golpe que sale). Un saque/remate que roza la cinta y cae dentro sin que nadie lo toque es `how:'ace'|'kill'` (ya no `'error'`).
- **Revisión 3**: `g.antennaHit` (`{x,y,z}` del contacto con la antena en este punto, o null; se borra en `serveReady`); `g.aimIn`/`g.aimOn`
  (dirección de apuntado de la entrada del último paso); `VB.DIFF.demo` (perfil de la demo del menú, fuera de `VB.DIFF_ORDER`).
- **Constantes nuevas en `VB.C`**: `IN_TOL` (0,03 m: tolerancia de la llamada de línea; úsese también para pintar dentro/fuera), `WINDUP` (0,07 s de armado del brazo),
  `ASSIST` (0,16 s), `SWING` (0,30 s), `HOLD_Z/HOLD_FWD/HOLD_SIDE` (balón en la mano izquierda del sacador antes del lanzamiento).
- **Funciones añadidas**: `hitWindow(g, p?, out?)` → `{t (s hasta el contacto ideal; <0 ya pasó), press (s hasta el momento ideal de PULSAR = t − WINDUP), d, dz, reach, kind, zc, x,y,z, active, canReach, attack, jumpT}`
  (reutiliza un objeto interno si no se pasa `out`), `aimPoint(g, out?, move?)` → `{x,y,kind:'serve'|'spike'|'tip'|'free', mode:1|2, aimed, spread, spreadPoor}`
  o null (destino previsto del golpe del humano sin el error de ejecución; `move` = `ctx.simMove`; lo usa fx.js para la retícula), `predictKind(g,p)`, `canDive(g,p)`, `timingQ(te)`, `gradeOf(q)`, `normDiff(d)`; `VB.DIFF`;
  `VB.AI.serveTarget(g, sv)`, `VB.AI.openSpot(g, p, minDepth, out, atk)`; `VB.DIFF_ORDER`, `VB.TIMING`; internos de test `_inBlockVol`, `_serveRisk`, `_recvFail`, `_refreshPred`.
- **Saque**: `serveReady` → silbato a los 0,7 s (antes no se puede lanzar) → GOLPEAR lanza flotante / SALTAR lanza en salto (`toss`)
  → GOLPEAR en el momento justo golpea (`hit kind:'serve'`). Si el balón cae sin golpearlo o pasan 8 s → falta de saque (`point reason:'serve'`).
- Solo sim escribe en `game`. Los demás módulos lo leen y NUNCA lo modifican.

### 4.3 Eventos (cada frame main.js pasa el mismo array `events` a todos los módulos)
Todos llevan `type` y `t` (tiempo de juego). `player` es la referencia al objeto jugador de `game.players`.
| type | payload | cuándo |
|---|---|---|
| `newMatch` | `{demo, difficulty}` | partido creado |
| `serveReady` | `{team, player, setPoint, matchPoint}` | sacador con el balón |
| `whistle` | `{reason:'serve'|'point'}` | autorización del saque / fin de jugada (el 1.er árbitro de arena señala con el brazo) |
| `hit` | `{kind:'serve'|'pass'|'set'|'spike'|'free', player, team, touch (0 saque,1..3), quality 0..1, x,y,z, speed, human, grade:'perfect'|'good'|'poor', timing (s, <0 pronto), power 0..1, shot, dive (bool), aim [x,y]|null, target [x,y]|null}` | toque válido. `shot`: saque `'float'|'jump'`; recepción `'forearm'|'dig'|'shank'|'dive'`; colocación `'overhead'`; ataque `'power'|'tip'`; 3er toque desde el suelo `'overhead'|'forearm'`. **La dejada es `kind:'free', shot:'tip'`**. `shot:'body'` = el balón da en el cuerpo sin gesto (`grade:'poor'`, `kind` según el toque) |
| `swing` | `{player, shot:''|'tip'}` | el humano pulsa golpear (gesto aunque no llegue) |
| `toss` | `{player, team, jump, human}` | el sacador lanza el balón (flotante / en salto) |
| `miss` | `{player, reason:'early'|'late'|'far', t2}` | gesto humano sin contacto con el balón cerca (UI: ¡Pronto! / ¡Tarde! / No llegas) |
| `dive` | `{player, x,y,z, dir:[dx,dy], miss?}` | plancha. `miss:true` = plancha de la IA que no llega (sin `hit` después) |
| `netTouch` | `{player, x,y,z}` | un jugador toca la red (justo antes del `point` con `reason:'net'`) |
| `jump` | `{player}` | despega |
| `landPlayer` | `{player}` | aterriza |
| `block` | `{player, team, x,y,z, result:'stuff'|'soft'|'tool'|'touch', quality, human}` | bloqueo efectivo (no cuenta como toque). `stuff` = al campo del atacante, `soft` = toque jugable, `tool` = block-out, `touch` = roce que sigue a su campo frenado |
| `net` | `{x,y,z, tape}` | el balón toca la red (`tape`: en la cinta) |
| `land` | `{x,y, inside, team (campo donde cae), speed}` | primer bote en rally |
| `bounce` | `{x,y,speed}` | botes de balón muerto |
| `point` | `{team, reason:'in'|'out'|'antenna'|'double'|'four'|'net'|'serve'|'under'|'block'|'attackServe', text, score, sideout, rallyTime, rallyHits, setWon, matchWon, how:'ace'|'kill'|'tip'|'block'|'free'|'error', player (falta personal o null), lastKind, lastShot, antenna ([x,y,z] del contacto con la antena \| null = cruzó por fuera; solo con reason 'antenna')}` | punto. `antenna` = toca la antena (aunque no cruce la red, 8.4.3) o cruza en todo o en parte por fuera del espacio de paso (8.4.4). `text` es la frase del árbitro (lista cerrada en simtest `POINT_TEXTS`; 'out' según el último toque: "Saque fuera", "Remate fuera", "Recepción fuera", "Defensa fuera"…; balón que toca la red y cae en el propio campo: "Saque a la red"/"Balón a la red" con `reason 'in'` (dentro) o `'out'` (fuera)). `attackServe` llega unos instantes DESPUÉS del `hit` (al cruzar el balón la red), no en el mismo paso. `net` = toque de red, `serve` = falta de saque (8 s / no golpea el lanzamiento), `under` = por debajo de la red, `block` = bloqueo del saque, `attackServe` = ataque del saque rival por encima de la red en zona de ataque (13.3.4) |
| `sideout` | `{team}` | cambio de saque (rota el sacador) |
| `set` | `{team, setNo, score, sets}` | set ganado |
| `match` | `{team, sets, setScores}` | partido ganado (al caer el balón) |
| `gameOver` | `{team, sets, setScores}` | fin de partido humano tras la pausa (UI muestra pantalla final) |
| `newSet` | `{setNo}` | empieza el set siguiente |
| `switch` | `{from, to, auto, reset?, reason?}` | cambia el jugador controlado (auto = lo decide el juego; `reason:'defense'` = al colocar la CPU, ~1,5 s antes del remate) |
| `courtChange` | `{setNo, why:'set'|'eight', score, sets, pause}` | cambio de campo (18.2.1 / 18.2.2): al acabar un set que no cierra el partido y a los 8 del 3.er set. Solo presentación (el humano sigue en x > 0) |

### 4.4 Módulos de presentación (todas las funciones son opcionales; main.js las llama con guarda y try/catch)
Objetos: `VB.Arena`, `VB.FX`, `VB.Players`, `VB.CameraRig`, `VB.Input`, `VB.Audio`, `VB.UI`.
| función | quién la llama / cuándo |
|---|---|
| `init(ctx)` | una vez al arrancar, en el orden Arena, FX, Players, CameraRig, Input, Audio, UI |
| `onGameStart(game)` | al crear un partido (menú demo, partido, escena de depuración). Players reconstruye rigs aquí |
| `onState(state, prev)` | al cambiar `ctx.state` |
| `onSettings(settings, changedKey)` | al cambiar un ajuste |
| `setQuality(q)` | al arrancar y cuando la calidad adaptativa baja |
| `resize(w, h)` | al cambiar el tamaño |
| `update(game, dt, events)` | cada frame. **Arena, Players, FX, UI** reciben `dt` = tiempo de JUEGO (0 en pausa/congelado: deben pintar la pose actual igualmente). **CameraRig** recibe `dt` real |
| `VB.Audio.handle(events, game)` / `VB.Audio.update(game, realDt)` | cada frame |
| `VB.Audio.unlock()` | primer gesto del usuario y al empezar partido |
| `VB.Audio.setMuted(b)`, `isMuted()`, `click()` | ajustes / botones de la UI |
| `VB.Input.poll(realDt)` → `{mx,my,hit,jump,switchPlayer,pause,mute,any,device}` | al principio de cada frame. `isTouchActive()` |
| `VB.CameraRig.getBasis()`, `snap(game)`, `shake(a,dur)`, `slowmo(scale,realSec)` | main.js / ctx |
| `VB.Players.rigOf(player)` | para que cámara/FX sigan partes del cuerpo |
| `VB.FX.burst(x,y,z,n,power)` | partículas (coords de sim) |
| `VB.UI.banner(t1,t2,t3,cls,dur)` | banner central |

**Añadidos opcionales** (detalle en `notes/<owner>.md`): `VB.Players.handWorld(p, right?, out?)`, `VB.Players.rigs` (cada rig: `lodFrac`, `lodBig`, `upT0`, `upDiveT` solo lectura; un atleta > 58 % del alto de pantalla usa la malla alta en media/baja); `VB.Arena.bounds`, `message(text, team, dur)`, `cheer(team, sec)`, `wave(sec)`, `postActive()`;
`courtChangeT()` (s que quedan del momento del cambio de campo; 0 = no hay), `landmarks` (`{scoreHung, screenPos, screenNeg}`, coords de sim);
`VB.FX.confetti(team, n)`, `ballObject()`, `dust(x, y, n, dirx, diry)`; `VB.CameraRig.slowmo(scale, realSec, easeOut?)`, `kick(deg)`, `getShot()` (incluye `'court'`), `getDebug()` (`.pf` = plan del plano del punto, `.ccU` = avance de la grúa del cambio de campo 0..1 o -1, `.mateLo` = NDC y de los hombros del compañero entre cámara y jugador (-9 = no aplica), `.mateUp` = m que sube la cámara en táctil para sacarlo del cuadro), `_setOrbit(a)` (pruebas); `VB.Input.rumble(s, ms)`, `poll()` añade `confirm, hitHeld, jumpHeld, padEvent (''|'connected'|'disconnected', un frame)`, `VB.Input.padInfo()` → `{connected, id, mapping}`, `VB.Input._debug()` (pruebas; `.pad.rest` = reposo aprendido del stick: la zona muerta se mide desde ahí, mando con deriva);
`VB.UI.nav(it, realDt)`, `back()`, `ingest(events, g)`, `callout(text, team)`, `isPanelOpen()`, `padEvent(kind)` (main.js con `it.padEvent`: "Mando desconectado" en la pausa); `VB.Audio.hover()`, `ui(kind)`, `setVolume/getVolume`, `play(name, gain?, x?, y?)`, `sting(name)`, `ready()`, `VARIANTS`, `LOOPS`, `LEVELS` (plan de mezcla en dB, solo lectura), `synthSteps(name, variant, rate)` (pruebas); `stats` añade `deferred`, `lateDrop`, `lateMax` (ms): sonidos críticos sin buffer aún que se aplazan / se descartan por llegar tarde.

**Cámara (convención)**: los cambios de jugador SIEMPRE deslizan (nunca corte). El plano de reacción del punto (camera.js `planPoint`) usa
cortes deliberados de retransmisión (a ~0,45 s del bote y de vuelta al saque si cruza la red o está a > 11 m); no son cambios de control.
**Señal de golpeo (una sola ventana)**: el brillo de GOLPEAR/SACAR (input.js `CUE_OFF/CUE_ON`), el aro que se cierra sobre el botón (`.vt-ring`, clase `.cue`),
el aro amarillo de la pista (fx.js) y el aviso "¡Golpea!" de ui.js (`HINT_OFF/HINT_ON`) usan `hitWindow().press` en (−0,15, 0,24). Si cambia, cambiar input.js, ui.js y simtest a la vez.
input.js escucha `pointerdown` en captura sobre `window` (1.er toque tras jugar con mando); un control de UI se excluye con `data-ui`.
El cambio de campo (`courtChange`, plano `'court'`) usa un corte deliberado (reacción → grúa alta por la banda de la mesa) y baja SIN corte al plano del saque; la base de control queda congelada durante la grúa.

## 5. Orden por frame (main.js)
1. `realDt = min(maxdt, Δ)`; `resize` si cambió el contenedor.
2. `it = Input.poll(realDt)`; `it.pause` → `togglePause`; `it.mute` → `toggleMute`; `it.any` → `Audio.unlock`.
3. Si no está en pausa/congelado/vertical: entrada → mundo con `CameraRig.getBasis()`; acumula `realDt*timeScale` y
   ejecuta `Sim.step(game, 1/120, input)` N veces (flancos solo en el primer subpaso); `drainEvents` → `events`.
   Si llega `gameOver` en partido → `state = 'over'`.
4. `Arena.update(g, gdt, ev)` → `Players.update` → `FX.update` → `CameraRig.update(g, realDt, ev)` →
   `Audio.handle(ev, g)` → `Audio.update(g, realDt)` → `UI.update(g, gdt, ev)`.
5. `renderFn(ctx)` o `renderer.render(scene, camera)`.
6. Calidad adaptativa (ventanas de 2 s): baja un nivel (`setQuality`) tras 2 ventanas < 45 fps o 3 seguidas < 52; en "baja" reduce la escala de render solo si
   el cuello es la GPU (`ctx.cpuBusy` < 0,40); tras cada escalón de escala mira 2 ventanas y, si los fps no suben ≥ 15 %, lo deshace y no vuelve a escalar en la
   sesión (cambiar Calidad en Ajustes lo reinicia); sube tras 5 ventanas > 58 fps; ignora la ventana que sigue a un cambio de calidad/estado/pausa
   y los primeros 8 s reales tras el arranque (`&aqwarm=s`).
   Desactivada con `?quality=` o en depuración (salvo `&aq=1`). En el móvil, bajar de calidad no cambia el tipo de sombra ni el número de luces
   (sin recompilar materiales). En el escritorio todos los niveles usan sombra PCF suave y "baja" usa mapa de 1024 (móvil: 512, PCF).

## 6. Depuración y verificación
- `node tools/simtest.js [min] [seed] [minMatriz=20] [semillas=4]` (+ `SIMTEST_ONLY=matrix`, `MATRIX_FILTER=<regex>`; rápido: `node tools/simtest.js 10 12345 0`) — sim headless: CPU vs CPU, autopilot, fuzz aleatorio, humano heurístico, reglas (4 toques, dobles,
  set a 25 con 2 de diferencia, tie-break a 15, punto de set). Sale ≠0 si falla. **Debe pasar siempre.**
- `tools/shot.sh <escena|all|a,b,c> [W] [H] [out.png|carpeta] [params]` — captura (envoltorio de `node tools/shot.js`). Viewport EXACTO
  (DevTools `Emulation.setDeviceMetricsOverride`; `--window-size` en headless de Windows recorta ~16×151 px) y GPU real.
  `WAIT=ms` (o `VTB`) = espera en tiempo real tras cargar (4000); `TOUCH=1` emula pantalla táctil. Con varias escenas reutiliza un Chrome.
- `tools/console.sh <escena|all> [W] [H] [params]` — mensajes de consola de la página; sale 1 si hay excepción, `console.error`, `[VB][ERROR]` o error de WebGL.
- Chrome: `tools/chrome.js` (node) y `tools/chrome-env.sh` (bash) eligen ejecutable y GPU (ANGLE d3d11 en Windows, metal en Mac, gl en Linux;
  `GL=swiftshader` para máquinas sin GPU, `CHROME=/ruta`). `tools/cdp.js` = cliente DevTools común (viewport exacto, errores, capturas).
- `node tools/drive.js [W] [H] [seg] [query]` — juega de verdad con teclado vía DevTools (menú → Intro → saque → peloteo → pausa).
- `node tools/perf.js [WxH=844x390] [s=20] [niveles=auto,high,medium,low] [cpu=4] [dpr=2.75]` — móvil emulado (viewport, dpr, táctil, UA,
  freno de CPU) y partido real con autopilot: fps, p5, coste JS, GC, draw calls, triángulos, sombra, calidad adaptativa. `STRICT=1` (sale con 1 si no se cumplen los objetivos o si la medida no es válida), `ALLOC=1`, `PROFILE=1`, `DESKTOP=1`, `WARM=s`
  (10 por defecto; 45 con `ALLOC/RETAIN`: V8 optimiza por número de llamadas), `HOSTMAX=%` (80 por defecto: si la CPU del PC anfitrión pasa de ahí de media en un nivel,
  la medida no es válida: columna `host%` con `!`; JSON `hostCpu`, `hostCpuMax`, `valid`, `invalid`). La CPU del anfitrión incluye al propio Chrome (~45-55 %).
  `ALLOC=1` (perfil de asignación muestreado) altera la optimización de V8: sus KB/s por fichero dan dirección, no valor absoluto; para GC, contar recolecciones sin `ALLOC`.
- `node tools/touchplay.js [tamaños] [s]` (multitáctil real sobre el overlay), `node tools/padplay.js [W] [H] [s]` (mando falso de mapeo estándar),
  `node tools/touchtest.js [WxH]` (30 casos de táctil), `node tools/padtest.js` (26 casos de mando), `node tools/courttest.js set|eight [WxH] [touch]`
  (plano del cambio de campo jugando hasta el evento), `node tools/audiotest.js` (mezcla medida: LUFS por escenario, partido renderizado en Chrome).
- `node tools/eval.js "<query>" "<expr>" [ms] [WxH]` — evalúa JS en la página (p. ej. `JSON.stringify(VB.ctx.renderer.info.render)`); espera Promises;
  `SHOT=out.png` captura DESPUÉS de evaluar (aislar artefactos, inyectar eventos con `VB.FX._event`, mover la cámara…).
- Escenas `?debug=`: `menu serve hud rally spike block point ace setpoint switch over|end mobile pause tutorial controls settings toss jumpserve dive`
  (detalle en notes/ui_main.md). Avanzan la sim (autopilot, semilla fija `&seed=N`)
  hasta el momento y congelan (`ctx.frozen`); `&live=1` sigue jugando. `&guide=1` fuerza los toques guiados del primer partido,
  `&hold=1` la celebración de victoria en depuración, `&prewarm=0|t|c|r` el modo de precalentado, `&diff=` el nivel. `&quality=low|medium|high` fuerza calidad.
  `&aq=1` activa la calidad adaptativa en depuración (`&aqwarm=s` cambia los 8 s de calentamiento); `dive` admite `&team=0|1|any`, `&n=N`, `&t=s` (por defecto plancha PROPIA del
  jugador no controlado delante de la cámara, congelada 0,22 s tras el contacto; sin candidata en 30 min, la primera de la CPU; `&team=` = criterio anterior).
  `&maxdt=0.25` permite dt grande en entornos lentos (SwiftShader va a ~1-5 fps; con GPU real headless va a 100+ fps).
  Las escenas congeladas envejecen los efectos del evento que las dispara (main.js `fxAge`) para que el destello no salga a plena intensidad.
- Los errores de módulos los registra main.js como `console.error('[VB][ERROR] Modulo.funcion: ...')` (máx. 3 por sitio) sin romper el bucle.
- Capturas y logs en `tools/out/`.

## 7. Terminología (castellano, árbitro FCVB)
saque, recepción, colocación, remate, bloqueo, toque, red, fuera, antena, dobles, 4 toques, set, punto de set,
punto de partido, cambio de saque. El bloqueo no cuenta como toque del equipo. Sets a 25 (3º a 15) con 2 de diferencia.
Arte y nombres originales; marcas de las vallas ficticias (NÓRDIKA, VOLTA, ALBA·SPORT, MARINA FM, TERRA, SALT·9; pabellón "PALAU DEL MAR").

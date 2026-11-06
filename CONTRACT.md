# VOLEY 3D — Contrato de arquitectura

Juego de voley 2 contra 2 en 3D (Three.js r149), navegador, escritorio + móvil.
Proyecto personal. Este documento es la ley para los 6 especialistas que trabajan en paralelo.

## 1. Propiedad de ficheros (exacta)

```json
{"sim":"js/sim.js and js/ai.js (gameplay simulation, rules, AI, hit quality/timing, serve types, difficulty) and tools/simtest.js","players":"js/players.js (athlete models, materials, procedural animation state machine, celebrations)","arena":"js/arena.js and js/fx.js (pavilion, floor, lines, net, antennas, posts, lighting, shadows, stands, crowd, LED boards, hanging scoreboard, ball mesh+shadow+trail, particles/impact FX)","camera_input":"js/camera.js and js/input.js (third-person camera rig, transitions, shake, slow-mo hook, camera-relative input mapping, keyboard, gamepad, touch controls overlay)","audio":"js/audio.js (procedural WebAudio: hit sounds per touch type, spike crack, net, block, whistle, crowd ambience and reactions, UI clicks, music sting)","ui_main":"index.html, css (inline in index.html), js/ui.js and js/main.js (boot, loop, renderer setup, adaptive quality, menus, HUD, scoreboard overlay, pause, end screen, settings, tutorial/onboarding, debug scenes, tools/shot.sh, tools/console.sh)"}
```

`tools/drive.js` y `tools/eval.js` también son de **ui_main**.

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

### 4.2 Simulación `VB.Sim` (sim.js) + `VB.AI` (ai.js) + `VB.C` (constantes)
- `createGame(opts)` → `game`. `opts = {demo, autopilot, seed, difficulty, stats}`.
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
  `lastAction ∈ '' | 'pass' | 'set' | 'spike' | 'free' | 'serve' | 'block' | 'swing' | 'jump'`, `actionT` = segundos desde entonces.
- Solo sim escribe en `game`. Los demás módulos lo leen y NUNCA lo modifican.

### 4.3 Eventos (cada frame main.js pasa el mismo array `events` a todos los módulos)
Todos llevan `type` y `t` (tiempo de juego). `player` es la referencia al objeto jugador de `game.players`.
| type | payload | cuándo |
|---|---|---|
| `newMatch` | `{demo}` | partido creado |
| `serveReady` | `{team, player, setPoint, matchPoint}` | sacador con el balón |
| `whistle` | `{reason:'serve'|'point'}` | autorización del saque / fin de rally |
| `hit` | `{kind:'serve'|'pass'|'set'|'spike'|'free', player, team, touch (0 saque,1..3), quality 0..1, x,y,z, speed, human}` | toque válido |
| `swing` | `{player}` | el humano pulsa golpear (gesto aunque no llegue) |
| `jump` | `{player}` | despega |
| `landPlayer` | `{player}` | aterriza |
| `block` | `{player, team, x,y,z}` | bloqueo efectivo (no cuenta como toque) |
| `net` | `{x,y,z, tape}` | el balón toca la red (`tape`: en la cinta) |
| `land` | `{x,y, inside, team (campo donde cae), speed}` | primer bote en rally |
| `bounce` | `{x,y,speed}` | botes de balón muerto |
| `point` | `{team, reason:'in'|'out'|'antenna'|'double'|'four', text, score, sideout, rallyTime, rallyHits, setWon, matchWon}` | punto |
| `sideout` | `{team}` | cambio de saque (rota el sacador) |
| `set` | `{team, setNo, score, sets}` | set ganado |
| `match` | `{team, sets, setScores}` | partido ganado (al caer el balón) |
| `gameOver` | `{team, sets, setScores}` | fin de partido humano tras la pausa (UI muestra pantalla final) |
| `newSet` | `{setNo}` | empieza el set siguiente |
| `switch` | `{from, to, auto, reset?}` | cambia el jugador controlado (auto = lo decide el juego) |

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

## 5. Orden por frame (main.js)
1. `realDt = min(maxdt, Δ)`; `resize` si cambió el contenedor.
2. `it = Input.poll(realDt)`; `it.pause` → `togglePause`; `it.mute` → `toggleMute`; `it.any` → `Audio.unlock`.
3. Si no está en pausa/congelado/vertical: entrada → mundo con `CameraRig.getBasis()`; acumula `realDt*timeScale` y
   ejecuta `Sim.step(game, 1/120, input)` N veces (flancos solo en el primer subpaso); `drainEvents` → `events`.
   Si llega `gameOver` en partido → `state = 'over'`.
4. `Arena.update(g, gdt, ev)` → `Players.update` → `FX.update` → `CameraRig.update(g, realDt, ev)` →
   `Audio.handle(ev, g)` → `Audio.update(g, realDt)` → `UI.update(g, gdt, ev)`.
5. `renderFn(ctx)` o `renderer.render(scene, camera)`.
6. Calidad adaptativa: si la media de 2 s < 45 fps dos veces seguidas → baja un nivel (`setQuality`). Desactivada con `?quality=` o en depuración.

## 6. Depuración y verificación
- `node tools/simtest.js [min] [seed]` — sim headless: CPU vs CPU, autopilot, fuzz aleatorio, humano heurístico, reglas (4 toques, dobles,
  set a 25 con 2 de diferencia, tie-break a 15, punto de set). Sale ≠0 si falla. **Debe pasar siempre.**
- `tools/shot.sh <escena> [W] [H] [out.png] [params]` — captura (`VTB=ms` cambia el tiempo virtual).
- `tools/console.sh <escena> [W] [H] [params]` — mensajes de consola de la página; sale 1 si hay `Uncaught` o `[VB][ERROR]`.
- `node tools/drive.js [W] [H] [seg] [query]` — juega de verdad con teclado vía DevTools (menú → Intro → saque → peloteo → pausa).
- `node tools/eval.js "<query>" "<expr>"` — evalúa JS en la página (p. ej. `JSON.stringify(VB.ctx.renderer.info.render)`).
- Escenas `?debug=`: `menu serve rally spike block point over mobile pause`. Avanzan la sim (autopilot, semilla fija `&seed=N`)
  hasta el momento y congelan (`ctx.frozen`); `&live=1` sigue jugando. `&quality=low|medium|high` fuerza calidad.
  `&maxdt=0.25` permite dt grande en entornos lentos (SwiftShader va a ~1-5 fps: es normal en headless).
- Los errores de módulos los registra main.js como `console.error('[VB][ERROR] Modulo.funcion: ...')` (máx. 3 por sitio) sin romper el bucle.
- Capturas y logs en `tools/out/`.

## 7. Terminología (castellano, árbitro FCVB)
saque, recepción, colocación, remate, bloqueo, toque, red, fuera, antena, dobles, 4 toques, set, punto de set,
punto de partido, cambio de saque. El bloqueo no cuenta como toque del equipo. Sets a 25 (3º a 15) con 2 de diferencia.
Arte y nombres originales; marcas de las vallas ficticias (NÓRDIKA, VOLTA, ALBA·SPORT, MARINA FM, TERRA, SALT·9; pabellón "PALAU DEL MAR").

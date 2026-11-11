# VOLEY 3D — Contrato de arquitectura

Juego de voley 2 contra 2 en 3D (Three.js r149), navegador, escritorio + móvil.
Proyecto personal. Este documento es la ley para los 6 especialistas que trabajan en paralelo.

## 1. Propiedad de ficheros (exacta)

```json
{"sim":"js/sim.js and js/ai.js (gameplay simulation, rules, AI, hit quality/timing, serve types, difficulty) and tools/simtest.js","players":"js/players.js (athlete models, materials, procedural animation state machine, celebrations)","arena":"js/arena.js and js/fx.js (pavilion, floor, lines, net, antennas, posts, lighting, shadows, stands, crowd, LED boards, hanging scoreboard, ball mesh+shadow+trail, particles/impact FX)","camera_input":"js/camera.js and js/input.js (third-person camera rig, transitions, shake, slow-mo hook, camera-relative input mapping, keyboard, gamepad, touch controls overlay)","audio":"js/audio.js (procedural WebAudio: hit sounds per touch type, spike crack, net, block, whistle, crowd ambience and reactions, UI clicks, music sting)","ui_main":"index.html, css (inline in index.html), js/ui.js and js/main.js (boot, loop, renderer setup, adaptive quality, menus, HUD, scoreboard overlay, pause, end screen, settings, tutorial/onboarding, debug scenes, tools/shot.sh, tools/console.sh)"}
```

`js/prog.js` (estadísticas y progresión de tus jugadores: `VB.Prog`, guardado en `voley3d.squad`) también es de **ui_main**; sim lo recibe ya convertido en `createGame({attrs: [[st7, st11], [st3, st9]]})` (atributos 1-99 con las claves `VB.ATTR_KEYS`; 50 = neutro; sin `attrs` la sim no cambia), que deja `p.st`, `p.prof` (perfil de IA, `Sim.statProf`) y `p.ak` (multiplicadores del humano, `Sim.attrK`; constantes en `VB.ATTR_K`). Integración (10-nov-2026): `p.ak` añade `eRecv/eDig/eSet/eAtk` (precisión del toque: dispersión ×1,5-0,6 y calidad del pase/colocación) y `rRecv/rDig` (alcance del 1r toque ×0,94-1,05); con Velocidad < 50 frenar y girar es al momento (la rampa `accT` solo al arrancar).
`tools/drive.js`, `tools/eval.js`, `tools/shot.js`, `tools/cdp.js`, `tools/chrome.js`, `tools/chrome-env.sh`, `tools/perf.js`, `tools/touchplay.js` y `tools/padplay.js` también son de **ui_main**.
`tools/audiotest.js` es de **audio**; `tools/touchtest.js`, `tools/padtest.js` y `tools/courttest.js` son de **camera_input**.
`js/badges.js` (`VB.Badges`, insignias), `js/career.js` (`VB.Career`, datos y lógica de la Carrera, sin DOM) y `js/career-ui.js` (`VB.CareerUI`, pantallas de la Carrera: crea su propio DOM `#career` y su `<style>` desde JS) son de **ui_main**, igual que `tools/badgetest.js` y `tools/careertest.js`. Guardados: `voley3d.squad` (v3: escuadrón inicial a media 50; los v1/v2 suben +10 cada atributo una vez) y `voley3d.career`.

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
- `index.html` sin `<!doctype>/<html>/<head>/<body>`; empieza por `<title>Make the Cut</title>`. Debe funcionar en `file://` y como Artifact.
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
| `settings` | `{muted, difficulty, quality:'auto'|'high'|'medium'|'low', showHelp (avisos «¡Golpea!»/«¡Salta!»), setPoints (11 | 15 | 21 | 25, por defecto 25: Partido rápido; main.js lo pasa a Sim.createGame como `points`, set decisivo a min(15, points), ver `Sim.setTarget`), ctrlMode ('both' \| 'one', por defecto 'both': fila «Controlar» de la preparación del Partido rápido (en la Carrera siempre 'one'), «A los dos jugadores» / «Un jugador»; main.js lo pasa a Sim.createGame como `ctrl`), ctrlPlayer (en desuso: loadSettings lo fuerza a 0; la fila se lee «Controlar ‹ a los dos jugadores ›» / «Controlar ‹ un jugador ›» —en filas estrechas «a los dos»— y en modo Uno llevas siempre al n.º 1), coachTips (true: consejos del partido; ui.js lo pone a false al ganar el 1r partido), camStable (false: con true el temblor de cámara es 0), rumble (true), hudScale (1 \| 1.15 \| 1.3), softFlash (false: destellos de luz y flashes suaves; arena/fx leen `ctx.settings.softFlash === true` cada frame), arena ('hall' \| 'beach', por defecto 'beach' desde el 10-nov —'hall' en `?debug`—: fila «Escenario» de la preparación del Partido rápido (menús v2; ya no está en Ajustes), Palau del Mar / Platja Llarga; `?map=beach` lo fuerza en pruebas; arena.js lo aplica con `onSettings(s, 'arena')`)}` persistido en localStorage (validado en `loadSettings`) |
| `introLeft`, `introSkipReq` | tarjeta de presentación del partido (UI-14): s reales que quedan (> 0 mientras se ve; la sim está PARADA y los eventos iniciales salvo `newMatch` se retienen hasta que acaba) / petición de saltarla |
| `uiDock` | `{side:'left', frac}` con la hoja final acoplada (pantallas ≥ 1000 px; `frac` = borde derecho / ancho) o `null`; lo publica ui.js cada 8 frames y lo lee camera.js (CAM-10) |
| `actions` | `startMatch(opts), toMenu(), pause(), resume(), togglePause(), restart(), setSetting(k,v), toggleMute()`. Un `startMatch` HUMANO pedido mientras el arranque aún ensaya estilos (`VB.UI.bootBusy()`) espera a que acabe (`startWait`, tope 9 s); los de autopilot empiezan al momento |
| `shake(amount, dur)`, `slowmo(scale, realSeconds)` | atajos hacia camera.js |
| `simMove` | `[wx, wy]` entrada de MUNDO del frame (la misma matriz que recibe `Sim.step`; FX la lee para la retícula de apuntado) |
| `endHold` | lo escribe ui.js: celebración de victoria en curso antes de la tarjeta final (main.js pinta a ritmo completo) |
| `canvasAA`, `prewarm(mode)`, `prewarmMs` | MSAA del lienzo; precalentado de texturas al arrancar/empezar partido (ver notes/ui_main.md) |
| `prewarmInfo()` | `{n, total, issueMs, waitMs, pending, drawMs}`: programas precompilados en paralelo bajo el telón (`KHR_parallel_shader_compile` con `VB.Arena.prewarmList()`; sin la extensión, `VB.Arena.prewarmCompile()`) y el render de calentamiento (`warmDraw`). `&warmdraw=0`, `&prewarm=sync`, `&bootwait=0` (pruebas) |
| `frameMs`, `frameMsAvg` | coste JS del último frame / media de la ventana de 2 s (calidad adaptativa y `tools/perf.js`) |
| `qLog` | cambios de calidad adaptativa `{t, rt, level, scale, pr, fps, js, why}` (`rt` = s reales desde el arranque; `t` = `ctx.time`, que va por detrás con frames recortados). `why` incluye `'escala deshecha (xN)'` |
| `cpuBusy` | fracción ocupada del hilo principal en la ventana: máx.(JS del juego / intervalo, suma de tareas largas / 2 s; PerformanceObserver `longtask`). Decide si la escala de render ayuda |
| `fixShadowDepth()` | pone un `customDepthMaterial` compartido por variante a `SkinnedMesh`/`InstancedMesh` (evita recompilar el material de profundidad 4 veces por frame). Llamarlo si se crean casters nuevos después de `onGameStart`/`setQuality` |
| `bootInfo` | tiempos del arranque por módulo en ms (`{t0, renderer, yield, Arena, FX, …, quality, end}`; UI-07) |
| `window.__vbFontFaces` | lo deja el script en línea de index.html: número de caras de Google Fonts cargadas DE VERDAD (0 si falla la red). Para comprobar fuentes, usar esto o buscar en `document.fonts` una cara con `status === 'loaded'`; nunca `document.fonts.check()` (da true sin ninguna cara) |

### 4.2 Simulación `VB.Sim` (sim.js) + `VB.AI` (ai.js) + `VB.C` (constantes)
- `createGame(opts)` → `game`. `opts = {demo, autopilot, seed, difficulty ('easy'|'normal'|'hard'|'expert' = Fácil/Normal/Difícil/Experto, alias castellanos; orden en `VB.DIFF_ORDER`, nombre visible `VB.DIFF[k].name`), serveClock (false = sin regla de 8 s), stats, rookie (primer partido: la CPU saca más suave; sin efecto en Difícil/Experto), present (pausas de presentación del punto, SIM-03: main.js lo pone en partidos humanos sin autopilot), ctrl ('both' por defecto: el control pasa a quien da el siguiente toque; 'one': el humano lleva siempre a `teams[0][0]` y la IA al compañero en todo, saque incluido, sin eventos `switch`; queda en `g.ctrlMode`; main.js lo toma de `ctx.settings.ctrlMode`), ctrlIdx (0 \| 1, solo con ctrl 'one': 0 = `teams[0][0]` n.º 1, 1 = `teams[0][1]` n.º 2; queda en `g.ctrlIdx`; con 1 el orden de saque del equipo 0 va en espejo; el juego pasa siempre 0, el 1 solo con `&ctrlidx=1` o `opts.ctrlIdx` en pruebas)}`.
  `demo`: CPU vs CPU (menú). `autopilot`: partido "humano" pero el equipo 0 lo juega la IA (escenas de depuración).
- `step(game, dt, input)` — paso fijo `1/120`. `input` en coords de MUNDO: `{move:[wx,wy] (|v|≤1), hit, jump, jset, switchPlayer}`;
  `hit/jump/jset/switchPlayer` son flancos (pulsado en este paso). En saque humano: `move` desplaza al sacador a lo ancho y apunta.
  `jset` (COLOCAR, opcional): en el suelo y en el saque = `jump`; en el aire = **colocación en salto** (ver «Colocación en salto» abajo).
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
  último saque para el receptor); `g.blockBy` (último bloqueador); `g.courtSwap3` (ya se cambió de campo a los 8 del 3r set);
  `p.shot` admite `'body'` (el balón le da en el cuerpo: cuenta como toque).
- **R4 (verificación de reglas)**: `g.atkServe` (`{team, player}`: ataque del saque rival por encima de la red en zona de ataque pendiente; solo es falta si el balón cruza entero el plano de la red o lo toca el bloqueo rival; se borra en cada toque y en `serveReady`); `rookie` tiene efecto real en Fácil/Normal (`rookieProf(pr, on, diff)`: en Fácil solo saque suave y `srvErr` ×0,65; en Normal además remate un 10 % más lento, `atkErr` ×1,4, `aimNoise` ×1,25, `dig` ×0,8, `block` ×0,5).
- **R5 (verificación 2)**: criterio único de remate `isAttackContact(p, b)` (interno: `p.z > 0,25 && |b.x| < 3,8 && b.z > NET_H + 0,1`) que usan `hit()` y `aimPoint()` (la retícula promete el mismo tipo de golpe que sale). Un saque/remate que roza la cinta y cae dentro sin que nadie lo toque es `how:'ace'|'kill'` (ya no `'error'`).
- **Revisión 3**: `g.antennaHit` (`{x,y,z}` del contacto con la antena en este punto, o null; se borra en `serveReady`); `g.aimIn`/`g.aimOn`
  (dirección de apuntado de la entrada del último paso); `VB.DIFF.demo` (perfil de la demo del menú, fuera de `VB.DIFF_ORDER`).
- **Pulido ola 1 (SIM-01/02/03)**: estado nuevo `present` (bool), `hold` (s de la pausa en curso; `g.timer` arranca con él), `streakTeam/streakN`, `rally.digs`,
  `atkHuman/atkGrade`. `g.lastPoint` copia `team, reason, text, how, highlight, digs, streak, savedSetPoint, signal, touchedOut, landSide, hold, setWon, matchWon`.
  Funciones: `VB.Sim.skipHold(g)` → bool (en `'point'`/`'over'`, tras ≥ 0,8 s de pausa, recorta `g.timer` a 0,3 s como mucho; nunca en `'serve'`/`'rally'` ni con el
  partido terminado), `VB.Sim.highlightOf(o)` (fórmula pura del `highlight`, notes/sim.md §P1); constantes `VB.HOLD` (`{routine 1.9, big 2.4, bigAt 0.55, set 4.0, match 4.2, eight 1.4, skipAfter 0.8, skipTo 0.3}`).
  Con `present` las pausas son 1,9 s (normal) / 2,4 s (`highlight ≥ 0,55`) / 4,0 s (set, con el cambio de campo; antes 3,4, cambiado por CAM-09) / 4,2 s en `'over'` antes de `gameOver`; sin él, como antes
  (1,9 / 3,6 / 2,2). `setupServe` coloca el balón en la mano del sacador ya en el paso del `serveReady`.
- **Pulido ola 2 (SIM-04, ritual del sacador CPU)**: estado nuevo `seed` (int), `serveNo` (saques puestos), `cpuTossIn` (s de juego hasta el lanzamiento
  programado de la CPU; decrece de forma monótona desde el `serveReady`, 0 en el paso del `toss` y hasta que acaba el saque; -1 con sacador humano y fuera
  de `'serve'`; `g.timer` vale lo mismo en el saque de la CPU), `ritual` (objeto persistente, solo lectura: `{on, phase:'none'|'wait'|'pre'|'dribble'|'post'|'done',
  t (s desde el silbato), dur (0,8-1,6), bounces (1-3), n, u (0..1 del bote en curso), player, rx, ry, cyc, td, tu, v0, vu, vc, vi, pre, post, still, press}`).
  `serveClock` corre también para la CPU tras el silbato (lanza siempre con ≥ 6,3 s; UI y audio solo lo muestran al humano). Durante el ritual `ball.held`
  sigue siendo el sacador, pero en `'dribble'` el balón bota delante de él con velocidad real: una regla que mire `b.z`/`b.vz` en `'serve'` debe usar
  `g.ritual.on` o la mano. `VB.Sim._holdPos(g, p, out)` = punto de la MANO izquierda (con el balón salvo en los botes). `VB.Sim.ritualAt(g, t, out?)` →
  balón del ritual en el instante `t` sin tocar nada (o null). `VB.RITUAL` (constantes; `tossBy` 4,5 s; demo del menú: `demoBounces` 1, `demoMax` 0,8 s, `demoWhistle` 0,2 s = silbato de la demo, `demoHold` 1,65 s = pausa rutinaria de la demo; solo con `g.demo`: partido humano y autopilot no cambian). `createGame({ritual:false})` = flujo anterior
  byte a byte (pruebas). El estilo (botes, tempo) sale de un hash de `seed` + `player.id`: no gasta `g.rng`, pero desplaza los resultados de cada semilla.
  Lanzamiento de la CPU 1,5-2,3 s tras `serveReady` en partido (demo 1,2-1,5). `VB.HOLD.set` = 4,0 s (antes 3,4: órbita del cierre + grúa, CAM-09).
- **Pulido ola 3 (SIM-05, highlight calibrado)**: `point` añade `clutch` (bool: final apretado — con el marcador de ANTES del punto, el que va delante está en los últimos 8 puntos del
  set, ≥ 17 de 25 o ≥ 7 de 15, y la diferencia es de 2 o menos); `g.lastPoint` también lo copia. `highlight` usa los pesos de `VB.HL` (solo lectura; notes/sim.md §P3:
  tope conjunto peloteo + defensas 0,4, bloqueo directo +0,4, ace +0,25, remate perfecto humano +0,1, punto de set +0,15 o final apretado +0,28 (el mayor), punto de partido +0,45).
  Función nueva: `VB.Sim.clutchOf(s0, s1, target)`. Umbrales para los demás: `VB.HOLD.bigAt` (0,55, «punto grande»: cinta grande, pausa larga) y 0,8 («enorme»: casi solo en
  punto de set/partido). CPU vs CPU: ~20 % de los puntos ≥ 0,55 y < 5 % ≥ 0,8 fuera de punto de set/partido (simtest lo comprueba en 20 partidos completos).
- **Constantes nuevas en `VB.C`**: `IN_TOL` (0,03 m: tolerancia de la llamada de línea; úsese también para pintar dentro/fuera), `WINDUP` (0,07 s de armado del brazo),
  `ASSIST` (0,16 s), `SWING` (0,30 s), `HOLD_Z/HOLD_FWD/HOLD_SIDE` (balón en la mano izquierda del sacador antes del lanzamiento).
- **Funciones añadidas**: `hitWindow(g, p?, out?)` → `{t (s hasta el contacto ideal; <0 ya pasó), press (s hasta el momento ideal de PULSAR = t − WINDUP), d, dz, reach, kind, zc, x,y,z, active, canReach, attack, jumpT}`
  (reutiliza un objeto interno si no se pasa `out`), `aimPoint(g, out?, move?)` → `{x,y,kind:'serve'|'spike'|'tip'|'free', mode:1|2, aimed, spread, spreadPoor}`
  o null (destino previsto del golpe del humano sin el error de ejecución; `move` = `ctx.simMove`; lo usa fx.js para la retícula), `predictKind(g,p)`, `canDive(g,p)`, `timingQ(te)`, `gradeOf(q)`, `normDiff(d)`; `VB.DIFF`;
  `VB.AI.serveTarget(g, sv)`, `VB.AI.openSpot(g, p, minDepth, out, atk)`; `VB.DIFF_ORDER`, `VB.TIMING`; internos de test `_inBlockVol`, `_serveRisk`, `_recvFail`, `_refreshPred`.
- **Sprint Carrera (9-nov-2026; detalle en notes/sim.md «Sprint Carrera»)**:
  - `opts.badges = [[b7, b11], [b3, b9]]` (misma forma que `attrs`), `b = {idInsignia: nivel 1-3}` o null → `p.badges = {id: nivel}` (o null). Sin `badges` la sim es idéntica
    (no gasta azar). `VB.Sim.BADGE_IDS` = `['canon','mira','rompemanos','seda','bombardero','flotador','muro','ancla','red','motor','sangrefria','lider']`; tablas por nivel en
    `VB.BADGE` (solo lectura); `VB.Sim.badgeLevel(p, id)`, `VB.Sim.aiReact(g, p, pr)`, `VB.Sim.aiTiming(g, p, pr)`, `VB.Sim.reachOf(g, p)`. Valen para humano e IA.
  - **Saque dirigible**: `g.aim3 = {on, x, y, kind:'spike'|'serve'}`. Con sacador humano `on = true`, `kind 'serve'` desde el `serveReady` (en `'ready'` el stick mueve al
    sacador y la diana queda quieta; durante el lanzamiento el stick la mueve a 12 m/s por el campo rival, |x| 1-9, |y| ≤ 4,5; empieza en (−7, 0)). `doServe` apunta a la diana
    con `VB.Sim.serveSpread(q, jump)` de dispersión (perfecto ≈ exacto; el flotante sigue bailando, conserva un 25 % del desvío). `aimPoint` en saque → `kind 'serve'`,
    `spread`, `spreadPoor`, `spreadNow` (null antes del silbato). `hit.target` del saque = la diana. `attrK().srvSpread`. La CPU no cambia.
  - `g.atkSet` (colocador del último ataque).
  - `opts.ref = {p1, p2, p3, d1?, d2?, d3?, chal}` (Carrera: error arbitral y challenge por competición, `VB.Career.matchSetup().ref`): sustituye a `VB.REF_ERR` en ese partido
    (`g.refErr`) y `chal` = challenges por set (`g.chalPerSet`; 0 = sin challenge, la UI oculta el contador). Sin `ref`, idéntico (`VB.Sim.refErrP(dist, g?)`).
  - `opts.nums = [[n1, n2], [n3, n9]]` (cada hueco o equipo puede ser null): dorsal propio (`p.num`); players.js y ui.js ya leen `p.num`.
  - **N jugadores (sprint 1 del 6v6, 10-nov-2026)**: `opts.format = '2v2' | '6v6'` (por defecto '2v2', idéntico byte a byte; '6v6' solo con
    `?format=6v6`; reglas, líbero e IA propia desde el sprint 2, ver §4.3). Estado: `g.format`, `g.size` (2 | 6), `g.rot[t][z-1]` (jugador en la zona z; `rot[t][0]` saca) y
    `g.lineup` (rotación de inicio de set), ambos `null` en 2v2. Jugador: `role` ('S'|'OH'|'MB'|'OPP'|'L', '' en 2v2), `zone` (1-6), `front`;
    `id = team·2 + idx` en 2v2 y `team·16 + idx` en 6v6 (claves dispersas: nadie debe suponer ids contiguos). Ningún módulo debe suponer 4
    jugadores: bucles con `g.players.length` / `g.teams[t].length`; «el compañero» = `VB.Sim.other(g, p)` (2v2: el otro; con más, el más
    cercano). Helpers puros (sin azar, sin asignar por frame): `mates(g, p)` (array cacheado, no modificar), `nearestMate(g, p, x?, y?)`,
    `mateBadge(g, p, id)`, `zoneOf(g, p)`, `zonePos(t, z, out?)`, `isFront(g, p)`, `ZONE`, `rotate(g, t)`, `serverOf(g, t)`,
    `refreshTeams(g)` (tras cambiar quién está en pista). Ganchos: si existe `VB.AI6`, `AI.computeJob` y `AI.pos` le delegan con `g.size !== 2`.
    Huella del 2v2: `tools/fingerprint6.js` + `tools/fp-2v2.json` (simtest la exige).
- **Vóley playa (10-nov-2026)**: `opts.venue = 'beach'` (solo 2v2; main.js lo pasa con `VB.Arena.venue()`, también a la demo del menú y a
  las escenas de depuración) → `g.beach = true`, `g.venue = 'beach'`. Sin `venue` (o `'hall'`), el pabellón byte a byte (huella idéntica).
  Pista POR PARTIDA: `g.HL` / `g.HW` (9 / 4,5 en el pabellón; **8 / 4** en la playa, `VB.C.BEACH`) y `g.cs` (escala respecto a 18×9: 1 / 8⁄9).
  `VB.Sim.court(g | 'beach' | 'hall')` → `{HL, HW, cs, beach}` (cacheado, no modificar): quien pinte o encuadre la pista debe usarlo, no
  `C.HL/C.HW`. `lineDist(x, y, g)` (sin g, la de 18×9). Reglas de playa (`VB.BEACH`, solo lectura): sets a 21 y el 3r a 15 (`g.points = 21`
  aunque se pida otro), cambio de campo cada 7 puntos jugados (cada 5 en el 3r; sin el de los 8), el toque de bloqueo cuenta como toque
  (`g.touches = 1` tras él; el bloqueador puede dar el siguiente), la dejada se juega de nudillos («pokey»: más tensa; `hit.pokey = true`,
  `shot` sigue `'tip'`; textos «Pokey fuera»), y una colocación de dedos «poor» puede ser **dobles** (`point reason 'double'`, texto
  «Dobles en la colocación de dedos»). Sin rotación (el saque alterna en el equipo como en 2v2). `newMatch.venue`. Evento `courtChange`
  con `why: 'swap'` (+ `every` 7|5, `pause` = `VB.BEACH.swapHold`). Cambiar el escenario en mitad de un partido espera al siguiente (main.js).
- **Saque**: `serveReady` → silbato a los 0,7 s (antes no se puede lanzar) → GOLPEAR lanza flotante / SALTAR lanza en salto (`toss`)
  → GOLPEAR en el momento justo golpea (`hit kind:'serve'`). Si el balón cae sin golpearlo o pasan 8 s → falta de saque (`point reason:'serve'`).
- Solo sim escribe en `game`. Los demás módulos lo leen y NUNCA lo modifican.

### 4.3 Eventos (cada frame main.js pasa el mismo array `events` a todos los módulos)
Todos llevan `type` y `t` (tiempo de juego). `player` es la referencia al objeto jugador de `game.players`.
| type | payload | cuándo |
|---|---|---|
| `newMatch` | `{demo, difficulty}` | partido creado |
| `serveReady` | `{team, player, setPoint, matchPoint}` | sacador con el balón |
| `whistle` | `{reason:'serve'|'point'}` | autorización del saque / fin de jugada (el 1r árbitro de arena señala con el brazo) |
| `hit` | `{kind:'serve'|'pass'|'set'|'spike'|'free', player, team, touch (0 saque,1..3), quality 0..1, x,y,z, speed, human, grade:'perfect'|'good'|'poor', timing (s, <0 pronto), power 0..1, shot, dive (bool), aim [x,y]|null, target [x,y]|null, jset (bool)}` | toque válido. `shot`: saque `'float'|'jump'`; recepción `'forearm'|'dig'|'shank'|'dive'`; colocación `'overhead'`, **colocación en salto `'jump'` (`kind 'set'`, `jset: true`, también con `touch 1`)**; ataque `'power'|'tip'`; 3er toque desde el suelo `'overhead'|'forearm'`. **La dejada es `kind:'free', shot:'tip'`**. `shot:'body'` = el balón da en el cuerpo sin gesto (`grade:'poor'`, `kind` según el toque) |
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
| `point` | `{team, reason:'in'|'out'|'antenna'|'double'|'four'|'net'|'serve'|'under'|'block'|'attackServe', text, score, sideout, rallyTime, rallyHits, setWon, matchWon, how:'ace'|'kill'|'tip'|'block'|'free'|'error', player (falta personal o null), lastKind, lastShot, antenna ([x,y,z] del contacto con la antena \| null = cruzó por fuera; solo con reason 'antenna'), highlight (0..1: lo grande que ha sido el punto; ≥ 0,55 «grande», ≥ 0,8 «clímax»), digs (int: defensas de remate del peloteo), streak (int ≥ 1: puntos seguidos del que puntúa en el set), savedSetPoint (bool: tenía en contra punto de set/partido), signal ('in'\|'out'\|'touched'\|'four'\|'double'\|'net'\|'under'\|'antenna'\|'attackFault'\|'delay8'\|'serveFault': señal oficial del árbitro), touchedOut (bool ⇔ signal 'touched'), landSide (0 = x > 0, 1 = x < 0, -1 sin bote), hold (s de juego hasta el siguiente saque o `gameOver`), clutch (bool: final apretado, SIM-05)}` | punto. `antenna` = toca la antena (aunque no cruce la red, 8.4.3) o cruza en todo o en parte por fuera del espacio de paso (8.4.4). `text` es la frase del árbitro (lista cerrada en simtest `POINT_TEXTS`; 'out' según el último toque: "Saque fuera", "Remate fuera", "Recepción fuera", "Defensa fuera"…; balón que toca la red y cae en el propio campo: "Saque a la red"/"Balón a la red" con `reason 'in'` (dentro) o `'out'` (fuera)). `attackServe` llega unos instantes DESPUÉS del `hit` (al cruzar el balón la red), no en el mismo paso. `net` = toque de red, `serve` = falta de saque (8 s / no golpea el lanzamiento), `under` = por debajo de la red, `block` = bloqueo del saque, `attackServe` = ataque del saque rival por encima de la red en zona de ataque (13.3.4) |
| `sideout` | `{team}` | cambio de saque (rota el sacador) |
| `set` | `{team, setNo, score, sets}` | set ganado |
| `match` | `{team, sets, setScores}` | partido ganado (al caer el balón) |
| `gameOver` | `{team, sets, setScores}` | fin de partido humano tras la pausa (UI muestra pantalla final) |
| `newSet` | `{setNo}` | empieza el set siguiente |
| `switch` | `{from, to, auto, reset?, reason?}` | cambia el jugador controlado (auto = lo decide el juego; `reason:'defense'` = al colocar la CPU, ~1,5 s antes del remate) |
| `dribble` | `{player, team, x, y, n (1..of), of (botes de este ritual), speed (m/s contra el suelo), last (bool)}` | cada bote del ritual del sacador CPU (SIM-04); en ese paso `ball.z === BR`. Audio: bote controlado |
| `courtChange` | `{setNo, why:'set'|'eight'|'swap', score, sets, pause, every?}` | cambio de campo (18.2.1 / 18.2.2): al acabar un set que no cierra el partido y a los 8 del 3r set; en la playa (`'swap'`), cada `every` puntos jugados (7; 5 en el 3r). Solo presentación (el humano sigue en x > 0) |
| `fx:highfive` / `fx:fistbump` / `fx:chestbump` / `fx:clap` | `{team, x, y, z (sim), strength 0..1}` | NO los emite sim: main.js vacía `VB.Players.drainFx()` justo después de `Players.update` y los añade al array del frame (contactos cosméticos de la celebración; FX, cámara, audio y UI los ven). Audio: `highfive` → choque, `fistbump` → puños, `chestbump` → pecho (PLY-15, victoria del partido, strength 1), `clap` → palmada de ánimo; `fx:catch` (players, cada recogida del bote en el ritual del sacador CPU, strength 0,6) → recogida blanda; `fx:call` (players, PLY-20: «¡mía!» del que va a por el balón, un evento por balón, `z` = cabeza, strength 0,6; audio lo ignora por ahora) |

**Añadidos del sprint Carrera a los eventos**: `hit.dig` (bool, defensa controlada de un remate rival), `hit.recv` (bool, 1r toque tras un saque);
`point.assist` (jugador de la colocación del remate que gana el punto, solo con `how 'kill'`, o null) y `point.tool` (bool, remate que toca el bloqueo rival y sale fuera);
`g.lastPoint` copia los dos. Los cuenta `VB.Badges.ingest` (insignias) y `VB.Career.ingest` (nota del partido).

**6v6 (sprint 2, solo con `createGame({format:'6v6'})`; el 2v2 no cambia y no emite nada de esto)**:
- Estado: `g.roster[t]` = los 7 del equipo (6 de la rotación + líbero); `g.libero[t]` (rol `'L'`, dorsal 13/14, id `team·16 + 6`);
  `g.liberoFor[t]` = central al que sustituye ahora (o null); `g.setPlan[t]` = decisión del colocador `{to, tempo:'high'|'shoot'|'quick', d, yl, apex, t, sys}`
  (válida mientras `t === g.lastTouchT`); `g.overlap = [n0, n1]` (pares solapados en el último saque; la IA siempre 0).
  Jugador 6v6: `p.bench` (true = en el banquillo, NO está en `g.players`), `p.fx/fy` (sitio de su formación de recepción), `p.toX`.
- **`g.players` y `g.teams[t]` = solo los que están en pista** (12). El líbero ocupa el hueco (índice) del central que sale. Quien
  dibuje a los atletas (players.js) debe crear rigs para **`g.roster`** (14) y ocultar/teletransportar a los `p.bench` al recibir `libero`.
- Eventos nuevos: `rotation` `{team, rot: [dorsales de zona 1..6], server}` (justo después de `sideout`, el equipo ha rotado);
  `libero` `{team, inP, outP}` (al preparar el saque, en `setupServe`, antes de `serveReady`: entra o sale el líbero; sin contar como cambio).
- Motivos nuevos de `point` (solo 6v6): `'backAttack'` («Ataque de zaguero» / «Ataque del líbero», como `attackServe`: se pita al cruzar la red
  o tocarlo el rival) y `'backBlock'` («Bloqueo de zaguero» / «Bloqueo del líbero»); `signal 'attackFault'`. La IA no los comete nunca.
- `VB.Sim`: `applyLibero(g)`, `overlapCount(g, t)`, `onCourt(g, t, zona)`, `ROLES6`; `VB.SIX` (afinado del 6v6). `VB.AI6` (js/ai6.js, cargado
  tras ai.js): `computeJob, pos, placeServe, passTarget, chooseSet, blockPlan, digK, canAttack, setterOf, FORM`.
- Revisión del sprint 2 (10-nov-2026, solo 6v6, detrás de `g.rot`): el defensor «perdido» (dado `g.digOk` en contra) lee 0,4 s tarde y va
  al 30 % (`BEAT6` en ai.js; en 2v2 0,12 s y 60 %, como siempre); el central zaguero cubre la colocación en el sitio del líbero.
  Pendiente (sprint 3): humano en 6v6 (control Uno por rol, «¡Pídela!», `AI6.decide`), sin eventos `switch` en 6v6, faltas de posición pitadas.

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
`VB.UI.nav(it, realDt)`, `back()`, `ingest(events, g)`, `callout(text, team)`, `isPanelOpen()`, `tabs(host, items, opts)` (pestañas reutilizables; ver notes/ui_main.md «Menús v2»), `padTabDir()`, `menuPage()` / `menuGo(p)` / `menuBack()` (páginas del menú `'main'` \| `'play'` \| `'quick'`), `padEvent(kind)` (main.js con `it.padEvent`: "Mando desconectado" en la pausa); `VB.Audio.hover()`, `ui(kind)`, `setVolume/getVolume`, `play(name, gain?, x?, y?)`, `sting(name)`, `ready()`, `VARIANTS`, `LOOPS`, `LEVELS` (plan de mezcla en dB, solo lectura), `synthSteps(name, variant, rate)` (pruebas); `stats` añade `deferred`, `lateDrop`, `lateMax` (ms): sonidos críticos sin buffer aún que se aplazan / se descartan por llegar tarde.

**Añadidos opcionales, pulido ola 1**: `VB.Players.drainFx(out)` (ver eventos `fx:*`), `VB.Players.heroShotAware` (true: la convergencia sigue `CameraRig.heroShot()`), `VB.Players._marker()` (pruebas),
rig de solo lectura `aMode/aw0/aw1, hipYaw, fk[].lock, pdW, diveTc, vh` (`offX/offY` incluye la convergencia del punto: hasta 4 m de la sim; `rigOf`/`handWorld` son la verdad visual);
`VB.Arena.prewarmList()` (copias que comparten geometría/material, sin tocar la escena), `VB.Arena.prewarmCompile()` (→ ms; compila contra el destino real del post), `VB.FX.prewarmList()`, `VB.FX._dbg()`,
`VB.Arena._dbg().crowdU` (uniform `uCrowdLight` de la grada);
`VB.CameraRig.heroShot()` → null o `{heroId, mateId, team, camX, camY, hx, hy, heroYaw, conv, mx, my, mateYaw, t}` (solo en `'point'`; objeto reutilizado, no modificar), `hitStop(ms, grade)`, `punch(deg)`, `clinchLeft()`,
`getDebug()` añade `cutN` (sube en cada corte deliberado), `lastCut {from, to, kind:'point'|'serve'|'court'|'over', t}`, `nextCutIn` (s reales al próximo corte; -1 ninguno), `timeScale, hitStop, punch, shake, fb`, `pf.mode/.how/.both/.team/.heroX/.backCut`;
`VB.Input.rumbleSig(name, k)` (firmas perfect/good/poor/body/won/lost/match/kill/block), `ctx.settings.rumble === false` apaga la vibración, sin gesto previo no se llama a `navigator.vibrate`, `_debug().sigs/.dead`;
`VB.Audio.stats.ticks`, `VB.Audio._debug()` (pruebas), sonidos `spikeHero, blockHero, sub, slamSub, tick, slap, fist`;
`VB.UI.bannerRect()` (px CSS o null), `VB.UI.onHoldSkip()` (main.js al recortar la pausa), `VB.UI.bootReady(bootEl)`, `VB.UI._gym()` (pruebas).

**Añadidos opcionales, pulido ola 2**: audio: la síntesis del banco va en un Worker creado desde el propio audio.js (función `VBAudioModule`, Blob, sin ficheros ni red; respaldo: cola troceada con una variante de cada sonido de juego primero); `VB.Audio.stats.worker` (`'none'|'starting'|'on'|'off'|'failed:<motivo>'`), `stats.workerMs`, `stats.workerHi` (ms hasta el saludo), `stats.bumped`, `stats.missed` (nombre → veces pedido sin buffer), `VB.Audio._bank(name)` (pruebas), `window.__vbAudioNoWorker = true` (pruebas: sin Worker).
ui_main: en táctil no hay consejo arriba durante el saque (los dos saques van en el aviso anclado `#prompt.two`, 2×2; `#promptKey` sigue visible para bots y herramientas); cintas grandes del punto como mucho 1 de cada 3 puntos (salvo `highlight ≥ 0,8`, punto de set/partido leído de `serveReady`, o punto de set salvado); durante el plano de héroe con el héroe a la izquierda (`getDebug().pf.heroX < -0,5`) el marcador `#sb` se atenúa.
camera.js: temblor del bote también tras un bloqueo (0,045 / 0,2 s); el plano de héroe lee `#sb`/`#pbug` (una vez por punto), predice el balón y los rivales. players.js: el que anota sigue de cara a la cámara del héroe (`c.hyaw`) hasta que acaba la pausa; colocación con los dos pies plantados (`layerG(P,T,w,plant)`, `SET_PLANT`, `SET_UP = 0,12`).

**Añadidos opcionales, pulido ola 2 (segunda tanda)**:
players: `VB.Players.faceOf(p)` (en `'point'`/`'over'` la orientación objetivo de la celebración; si no, `rig.yaw`); rig de solo lectura `celV`, `celId`,
`apOn`/`apS`/`apWarp` (carrera de ataque), `standW`, `yawV`, `lieW`. Durante ~1 s antes del salto de ataque de la CPU `offX/offY` puede valer hasta ~2,5 m
(carrera visual; 0 en el despegue): usar la posición VISUAL (`rigOf`, `visPos`) para sombras y encuadres. Las excepciones de `Players.onEvent` se registran
una vez como `[VB][ERROR] Players.onEvent`.
arena/fx: `VB.Arena._dbg().mood` (luz de tensión; `mood.force` 0..1 la fuerza en pruebas, -1 = automático), `_dbg().led` (`w` cortina del mensaje, `GLOW`);
mallas `hallShell` (cascarón del pabellón, sin luces) y `contactBlobs` (fx: manchas de contacto de balón + 4 atletas en un `InstancedMesh`; sustituye a la
sombra del balón); el material de los halos es `ShaderMaterial` (`halos.material.uniforms.opacity`); los mensajes LED entran con cortina de 0,38 s
(`led.msgOn` = pedido o visible); confeti dentro del plano en la victoria.
camera: `getShot()` añade `'clinch'`, `'cutaway'`, `'intro'`; `lastCut.kind` añade `'clinch'` (los dos cortes del cierre de set/partido, secos), `'cutaway'`
(vuelta seca del plano corto del sacador rival a la recepción; la ENTRADA a ese plano es un corte `'serve'`) e `'intro'` (entrada de la presentación;
sale con `'serve'`); `VB.CameraRig.playIntro(s)` (main.js al mostrar la tarjeta; 0 = cortar); `clinchLeft()` real; `getDebug()` añade `ft`,
`clinch {phase:''|...|'hero', left, team, why}`, `fovWant`, `fovBoost`, `tfBack`, `defW`, `defF` (`x` con `&camdbg=1`). Lee `ctx.uiDock` y
`ctx.settings.camStable` (temblor 0; `prefers-reduced-motion` lo deja al 30 %).
audio: `VB.Audio.ui('wipe'|'intro'|'introEnd'|'introSkip')`, `sting('intro')`, `introInfo()` → `{active, t}`, `voices()`; `stats.fxIn/fxOut/dribIn/dribOut/
pooled/poolFull/voicesMax/intro/wipe/react`; `ui(kind)` con un nombre desconocido no suena (sin argumento = clic). Sonidos `handclap`, `chest`, `dribble`,
`wipe`, `introSwell`, `introSting`.
ui_main: `VB.UI.introStart(g)`, `introEnd(skipped)`, `wipe(team, cb)` (cortinilla de marca; cortes punto → saque/cambio de campo armados con `nextCutIn`,
transiciones de pantalla de 450 ms), `resize(w,h)`, pruebas `_stamp()`, `_offArrow()`, `_wipe()`, `_wipeLog(on)`, `_endStats()`. El rótulo de set/partido
va en el hueco de ARRIBA durante la órbita del cierre (`getDebug().clinch.phase === 'hero'`) y el indicador de borde (UI-10) solo se ve en planos de juego
(oculto con `getShot()` `'clinch'|'cutaway'|'intro'|'point'|'court'|'over'`).

**Añadidos, arreglos tras la verificación de la ola 2 (8-nov-2026)**:
camera: `getDebug().clinch.x` (pruebas: `[aHd, aHn, pitch, handT, headN, hz0, hz1, vl, anc, ang]`). La órbita del PARTIDO filma a los ganadores desde la grada a la que
miran (de perfil mientras están de cara el uno al otro; de frente cuando players los abre hacia la cámara, frentes a < 60°); el seguimiento lento del cierre
mantiene en cuadro un SUJETO (el defensor más cercano a la marca o, si no, el atacante); en el cierre la mano más alta queda ~3,5 % del alto bajo
`VB.UI.bannerRect()`. En el peloteo, si el balón va a botar a > 0,4 m por fuera en ≤ 1,2 s, la cámara de juego sigue al balón, no al jugador (`lostBall`).
players: en la victoria del partido, 0,5 s después del choque de pecho los dos ganadores se giran hacia la cámara (`VB.ctx.camera.position`), como mucho
35° vueltos hacia el compañero. `sepOffset`: los compañeros nunca quedan a < 0,5 m (offset visual de la raíz, la sim no cambia; 0 en `serveReady`).
arena/fx: mallas fusionadas (para herramientas): `poles` (antenas + postes + protecciones, sustituye a `antennas`/`posts`/`pads`), los filos de luz de las
pantallas van en la malla emisiva (sin `screenStrip`), `focusRing` (un plano con `ShaderMaterial`; sin `focusTarget`/`focusFill`), `floorDecals`
(InstancedMesh: marcas del bote y filos, ondas, marcador de caída, retícula de apuntado, línea de altura; `landMarker`, `aimRet`, `ripple`, `mark`,
`markRim`, `dropLine` siguen como estado fuera de la escena), `impactBills` (destellos y ondas de choque). Nombres de objetos: `floor`, `outerFloor`,
`netFront/netBack`, `endScreen`, `hallName`, `halos`, `camFlashes`, `sparks`, `dust`, `confetti`, `ball`, `ballOutline`, `trail`, `aimArc`.
`VB.FX._dbg()` añade `ringD, ringOp, decals, decOrder, bills, billOrder, dropLine`; `VB.Arena._dbg().screens`; tabla de luz `LT[i].floor` (tinte de la
tarima por nivel). En pantallas de ≤ 560 px CSS de alto, durante saque/peloteo, los marcadores del pabellón que caen en el 40 % superior del cuadro se atenúan al 22 %.
ui_main: `VB.UI.preboot(ctx)` (main.js, con el contexto WebGL creado, antes de montar el pabellón), `VB.UI.bootBusy()`, `VB.UI._boot()` (pruebas);
fuente embebida «VB Marca» en index.html (recortes OFL de Barlow Condensed; solo `.logo` y el rótulo del telón; comprobar con `document.fonts` y una cara
`VB Marca` 900 italic en `status === 'loaded'`); `window.__vbFonts` avisa al momento si la hoja de Google no carga. Relevo del arranque en dos tiempos
(menú pulsable con la escena pintada o a 2,6 s; luego se funde el fondo del telón). Texto del ace con la recepción a la red: «La recepción de la CPU va a
la red» / «Tu recepción va a la red».

**Añadidos opcionales, pulido ola 3 (9-nov-2026)**:
players: `VB.Players._face(p, 'shout'|'effort'|'joy'|'sad'|'neutral'|'', sec)` (pruebas); rig de solo lectura: huesos `eyes, mouth, teeth, brow[2], hair` (27 huesos por
atleta, antes 21; misma textura de huesos y mismo programa), pesos de expresión `fxS/fxE/fxJ/fxD`, `hairAng` (coleta con muelle), `ritOn`, `tgtW`. Proporciones: cadera 1,042 m
(antes 1,0); hombros, cabeza y altura total iguales. Emite `fx:catch` y `fx:call` por `drainFx` (ver §4.3).
arena/fx: `VB.Arena.landmarks.benches[2]` (equipo 0 en x > 0, centro del banco a la altura de las cabezas), `.photographers[4]`, `.tvCamera` (coords de sim, fuera de la zona
libre: objetivos de plano, no posiciones de cámara); `_dbg().crew`, `_dbg().crewReact(team, big, 'point'|'set'|'match')`, `_dbg().POSE`; la malla `officials` incluye ahora
el entorno de pista (banquillos, fotógrafos, cámara de TV; `userData.lowIdx` = recorte de baja con `setDrawRange`); `ledRefl` tipo 3 (vidrio de la barandilla, uniforme
`glassK`); `Builder.cbox()` (caja achaflanada); programa de la grada `vb-crowd-6` (asientos de prensa sin ola ni saltos). `finishLedRefl()` cierra `ledRefl` tras la grada.
camera: `lastCut.kind` añade `'attract'` (cortes de la realización del menú; la UI no los tapa con cortinilla). `playIntro(s)` acaba en el encuadre del primer saque y cede
SIN corte (`nextCutIn` = -1 mientras dura; saltarla con `playIntro(0)` sigue cortando con `'serve'`). `getDebug()` añade `menu`, `menuT`, `blk`, `board`, `pbNar`, `pbW`, `pbD`;
pruebas `VB.CameraRig._serveDbg()`, `_boardGuard()`; URL `&camBreak=clinch|serve|board|menu|block|clutter|hitstop|intro|cut` (solo pruebas). El saque propio usa `ctx.isTouch`.
Lee (con guarda) `VB.Arena._dbg()` refs/judges, `VB.UI.bannerRect()` y `VB.Arena.landmarks.scoreHung`. input.js: degradados más oscuros en GOLPEAR/SACAR y SALTAR (≥ 4,5:1).
audio: `VB.Audio.ui('count', u, ts)`, `ui('countEnd')`, `ui('mvp', win)`, `ui('arrowHover', dir)`, `ui('arrow', dir, nivel, n)`, `ui('arrowEdge', dir)`, `ui('optHover')`,
`ui('toggle', on)`, `ui('select', i, n)`, `ui('slide', v)` (`ui()` acepta hasta 3 argumentos tras el nombre); `stats.count/countAt/countEnd/countEndAt/mvp`; `_debug()` añade
`crowd`, `endFocus`, `count`, `stingTeam`; sonidos `cntTick, cntLock, arwHover, optHover, stepUp, stepDown, arwEdge, tglOn, tglOff, optSel, mvpWin, mvpLose`. Con la hoja
final a la vista (state `over`) la grada baja 6 dB. ui.js lo cablea: tics en cada frame de la cuenta con cambio y «clac» en el último, MVP al empezar la cuenta, flechas
de dificultad (paso/tope/hover) y filas de Ajustes (hover, Sí/No, varios valores, deslizador).
ui_main: `VB.UI.callout(text, team, cls, dur, o)` (`cls` `'neg'|'good'|'tip'` = respuesta personal; `o.html`, `o.gauge` −1..1 medidor pronto/tarde), `VB.UI._prompt()` (pruebas);
Ajustes sin fila de dificultad (está en el menú), agrupados Audio · Imagen · Juego · Accesibilidad; glifos PlayStation (✕ ○ □ △) si `padInfo().id` es de Sony; `#srLive`
(aria-live) con el tanteo hablado y `lang="es"`. La cinta grande del punto sigue a `highlight ≥ VB.HOLD.bigAt` (+ ace y punto de set salvado; subtítulo «Final apretado» con `clutch`).

**Añadidos opcionales, arreglos tras la verificación de la ola 3 (9-nov-2026)**:
sim: `checkBody` no da toque de cuerpo de su propio equipo a un jugador de IA (no `isHuman`) cuando sería falta (`g.lastPlayer === p` o `g.touches >= 3`) o el
compañero soltó el balón hace < 0,3 s (el humano sigue expuesto a la regla); ai.js `TEAM_GAP` 0,2 s y `dodgeOwnBall` (`DODGE_R` 0,9 m). `VB.HOLD.set` = 4,0 (antes 3,4; CAM-09).
players: con la sim parada en una escena de depuración (`ctx.frozen && ctx.debug && dt <= 0 && g.mode === 'point'`) la celebración se representa como cuadro vivo
en bucle (re-emite el `point`, así que `fx:highfive` y familia llegan a FX/audio/UI también en `debug=point|ace`); pruebas `VB.Players._tab()` → `{t, max}`.
arena: la señal `antenna` del 1r árbitro es «balón fuera» (`POSE.outFa`); señalar la antena es del juez de línea (`judgeSignal`). `POSE.antenna` desaparece.
camera: `getDebug()` añade `svcEval`, `svcOff` (candidatos del saque y proyecciones de oficiales de este frame) y `bgP` (desvío de cabeceo del plano final, °);
en el plano `over`, `board` vale `'baja'|'fuera'` (marcador colgado y pantallas LED de los fondos siempre fuera por arriba). Hit-stop con tope nominal + 2 frames.
ui_main: chip de la jugada «JUGADA · N» y subtítulo «¡Jugada de N toques!» (visible: «Jugada», no «Peloteo»); `.rl.fade` (animación `rlFade` 0,25 s) al salir el rótulo de
set/partido; `placeT3` coloca `#banner` fuera del marcador entero, `.hud-btns` y la pausa táctil (mueve el centro con `style.left`; `&uidbg=1` registra candidatos);
`#coach.thru` (0,28) y `#guide.thru` (0,22) en todas las pantallas; `tryReveal` no empieza relevo en escenas `debug=`.

**Insignias y Carrera (ui_main)**:
- `VB.Badges` (js/badges.js, sin DOM): `LIST` (`{id, name, icon (SVG), desc, fx[3], cond, unit, th [bronce, plata, oro]}`), `IDS`, `BY`, `TIERS`, `ingest(e, g)` (ui.js la llama con
  cada evento; solo cuenta partidos humanos del equipo 0: no demo, autopilot ni depuración), `endMatch(g, win, athletes?)` → `[{slot, num, id, name, lvl, prev, tier, eq}]`
  (por defecto el escuadrón de Partido rápido, que guarda; con atletas propios —Carrera— guarda quien llama), `forPlayer(a)` → `{id: nivel}` de las EQUIPADAS,
  `forSquad()` → `[[b7, b11], null]` o null, `slots(a)` = mín(6, 2 + floor(nivel/5)), `toggle/equip/unequip(a, id)`, `progress`, `level`, `label(u)`.
  Progreso en cada atleta de `VB.Prog`: `a.bp` (contadores), `a.bd` (`{id: nivel}`), `a.beq` (equipadas).
- `VB.Prog` (js/prog.js) añade funciones sobre un atleta cualquiera (no guardan): `newAthlete(o)`, `saneAthlete(a)`, `athleteAddXP(a, xp)`, `athleteBump(a, k)`, `athleteAttrs(a)`, `squad()`.
  `attrs()` → `[[n.º 1, n.º 2], cpu]`: la CPU de Partido rápido juega sin atributos (`null`) mientras la media del escuadrón sea ≤ 50 y, por encima, con
  `cpuSt(m)` = 50 + `CPU_K` (0,6) × (m − 50) en todo (integración 10-nov-2026: con 90 ya no se gana el 75 % al Experto).
- `VB.Career` (js/career.js, sin DOM; guardado `voley3d.career`): `exists/get/create/abandon/save`, `next(c)`, `matchSetup(c)` → `{attrs, badges, points, difficulty, ctrl,
  ctrlIdx, ref, kit, rivalKit, career}`, `ingest(evs, g)`, `matchDone(r, st, g)` → resumen `{nota, xp, lvlUp, lvl, ptsGained, badges}`, `simulateNext(c)`, `abortMatch()`,
  `table(c, lvl)`, `bump(k)`, `toggleBadge(id)`, `acceptOffer(i, años)`, `stay(años)`, `lost()` (había un guardado que no se pudo reparar; copia en `voley3d.career.bak`).
  Gestión (v2, notes/carrera.md §Gestión): fase `'pick'` sin club al crear (`rejectAll()`, `moreTime()`), `negotiate(i)`, `setTraining(k)`, `requestTransfer(on)`,
  `changeMate(i)`, `clubInfo(c, k)`, `unread/readMsg/readAll`; `matchSetup().ctrl` siempre `'one'` (la Carrera no ofrece «Los dos»).
  Integración (10-nov-2026): `earlyExit(c)` (fichar ahora sería salir con contrato en vigor: el entrenador nuevo empieza con `EARLY_COACH` menos),
  `STYLE_TRAIN`/`STYLE_PROG` (el estilo del club suma progreso de entreno a un grupo), `ROLE_COACH`, `NEG_COACH` (negociación rechazada → `oferta.negNo`);
  la fatiga vuelve a 0 en verano y Equilibrado no cansa; la petición de traspaso caduca con la temporada.
  Ofertas: `{club, lvl, ovr, mate, interest, role, years}` (`lvl`/`ovr`: liga y media de la temporada en la que jugarías).
- `VB.CareerUI` (js/career-ui.js): `open(view?, o?)`, `isOpen()`, `back()`, `nav(it, dt)` (mando; main.js la llama en lugar de `VB.UI.nav` mientras está abierta).
  Sus dos barras (apartados u ofertas, y sub-pestañas) son `VB.UI.tabs` (ids `#crTabs`, `#crSub`): Q/E y LB/RB (o Y) el primer nivel, RePág/AvPág y LT/RT el
  segundo, ←/→ con el foco en una pestaña, deslizar el dedo sobre `#crBody`. «‹ Jugar» vuelve a la página Jugar del menú.
- main.js: `ctx.actions.startCareerMatch()` arranca el partido de Carrera con `createGame({attrs, badges, points, difficulty, ctrl, ctrlIdx, ref, nums})`, marca `g.career`
  (`{season, week, label, me, rival, meName, rivalName, player, num, mate, mateNum, …}`) y viste los dos equipos (`Players.setKit({...kit, rival: rivalKit})`). Con `g.career`
  ui.js no reparte XP ni insignias al escuadrón (lo hace `VB.Career.matchDone`, que main.js llama al llegar `gameOver`) y el marcador muestra las abreviaturas de los clubes.
  Partido rápido: `badges: VB.Badges.forSquad()` (salvo autopilot y depuración; `&nobadges=1` las quita).
- players: `setKit(st, g)` acepta `st.rival = {kitShirt, kitAccent, kitShorts, kitPattern}` para el equipo 1 (si se parece demasiado a la tuya, la CPU de siempre).
- fx: diana del saque (`g.mode === 'serve' && g.aim3.on && g.aim3.kind === 'serve'`), turquesa (dorada con `spreadNow` < ~0,45 m); notes/arena.md.
- main.js: en `g.mode === 'serve'` la entrada se pasa a mundo con los ejes de la PISTA (el más cercano de la base de la cámara), no con la
  base girada: ↑ lleva la diana recta al fondo y ←/→ solo a lo ancho.
- ai.js: la IA deja botar el saque rival que se va fuera (`leaveServe`, una decisión por saque y equipo en `g._lv`).
- ui.js: en un partido de Carrera los textos con «CPU» (cintas, avisos, consejo, lector de pantalla, rótulo del challenge) pasan por
  `cpuTxt` («Remate del rival», «Tú 3, PUE 1»), y el partido no cuenta para el récord de Partido rápido (`voley3d.record`).

**Cámara (convención)**: los cambios de jugador SIEMPRE deslizan (nunca corte). El plano de reacción del punto (camera.js `planPoint`) usa
cortes deliberados de retransmisión (a ~0,45 s del bote y de vuelta al saque si cruza la red o está a > 11 m); no son cambios de control.
**Señal de golpeo (una sola ventana)**: el brillo de GOLPEAR/SACAR (input.js `CUE_OFF/CUE_ON`), el aro que se cierra sobre el botón (`.vt-ring`, clase `.cue`),
el aro amarillo de la pista (fx.js) y el aviso "¡Golpea!" de ui.js (`HINT_OFF/HINT_ON`) usan `hitWindow().press` en (−0,15, 0,24). Si cambia, cambiar input.js, ui.js y simtest a la vez.
input.js escucha `pointerdown` en captura sobre `window` (1r toque tras jugar con mando); un control de UI se excluye con `data-ui`.
El plano de héroe dicta la coreografía de la celebración: el que anota, de cara a la cámara; el compañero llega por detrás y a un lado (`heroShot`). El plano de reacción entra siempre por corte a los 0,45 s;
la vuelta al saque se anuncia en `nextCutIn` y casi siempre es corte.
El cierre del set/partido (CAM-09) entra por corte al seguimiento del balón a cámara lenta y corta otra vez a la órbita de los ganadores (`'clinch'`). Antes de cada saque rival hay un plano corto del sacador (CAM-14, 0,95-1,4 s) que vuelve a la recepción ≥ 0,55 s antes del lanzamiento. Tras nuestro ataque la cámara sigue el balón hasta el bote (CAM-08), sin corte.
El cambio de campo (`courtChange`, plano `'court'`) usa un corte deliberado (reacción → grúa alta por la banda de la mesa) y baja SIN corte al plano del saque; la base de control queda congelada durante la grúa.

## 5. Orden por frame (main.js)
1. `realDt = min(maxdt, Δ)`; `resize` si cambió el contenedor.
2. `it = Input.poll(realDt)`; `it.pause` → `togglePause`; `it.mute` → `toggleMute`; `it.any` → `Audio.unlock`.
3. Si no está en pausa/congelado/vertical: entrada → mundo con `CameraRig.getBasis()`; acumula `realDt*timeScale` y
   ejecuta `Sim.step(game, 1/120, input)` N veces (flancos solo en el primer subpaso); `drainEvents` → `events`.
   Si llega `gameOver` en partido → `state = 'over'`. Con la tarjeta de presentación (`ctx.introLeft > 0`) la sim no avanza y los eventos iniciales salvo `newMatch` llegan al acabarla; cualquier botón la salta (sin golpear ni pausar). Antes del bucle de pasos: en `'point'`/`'over'` jugando, GOLPEAR, SALTAR, CAMBIAR o ACEPTAR llama a `Sim.skipHold(g)`; si recorta, se consume
   el flanco y se avisa a `UI.onHoldSkip()`.
4. `Arena.update(g, gdt, ev)` → `Players.update` → (main.js añade a `ev` los `fx:*` de `Players.drainFx`) → `FX.update` → `CameraRig.update(g, realDt, ev)` →
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
- `node tools/drive.js [W] [H] [seg] [query]` — juega de verdad con teclado vía DevTools (menú → Intro → saque → peloteo → colocación en salto con K y con clic central, `tools/jsetdrill.js` → pausa); touchplay.js y padplay.js hacen el mismo ejercicio con COLOCAR y con X.
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
  y, del 6v6 (espectador, sprint 2; no hace falta `&format=6v6`): `serve6` (sacador con el balón lanzado, `&n=N` el N-ésimo saque, 3r por defecto; `&t=s`),
  `rally6` (colocación del equipo 0 tras la recepción) y `point6` (el punto con su plano). Están en `shot.js all` / `console.sh all`.
- **6v6 espectador (sprint 2)**: `?format=6v6` (NO en el menú) hace que «Jugar» empiece CPU contra CPU (`autopilot` + `present`, sin presentación)
  con `g.watch = true` (marca de main.js, la sim no la lee) y `ctrl: 'one'` (sin eventos `switch`): ui.js rotula LOC / VIS (también en la pestaña del punto: «Remate del rival», nunca «de la CPU»), no enseña avisos de mando ni cuenta el partido en el récord;
  input.js no enseña los mandos táctiles; players.js no pinta el halo ni la flecha del controlado y fx.js no pinta el aro amarillo; camera.js usa el plano `tv` (cámara de televisión alta tras el fondo del equipo 0, encuadre de los 12
  jugadores; con `g.size === 6` también en partidos de autopilot) para saque, peloteo y punto (corte al saque siguiente); cambio de campo y final como en 2v2;
  sin plano de reacción, cierre de set ni plano del sacador rival. `node tools/tv6test.js [WxH] [s] [semilla]` lo comprueba (12 en cuadro).
  Rendimiento 6v6: `EXTRA=format=6v6 node tools/perf.js …` (tope provisional de 45 llamadas de dibujo en baja, frente a 35 en 2v2, hasta
  fundir los atletas lejanos en el sprint 4).
  (detalle en notes/ui_main.md). Avanzan la sim (autopilot, semilla fija `&seed=N`)
  hasta el momento y congelan (`ctx.frozen`); `&live=1` sigue jugando. `&guide=1` fuerza los toques guiados del primer partido,
  `&hold=1` la celebración de victoria en depuración, `&prewarm=0|t|c|r` el modo de precalentado, `&diff=` el nivel. `&quality=low|medium|high` fuerza calidad.
  `&aq=1` activa la calidad adaptativa en depuración (`&aqwarm=s` cambia los 8 s de calentamiento); `dive` admite `&team=0|1|any`, `&n=N`, `&t=s` (por defecto plancha PROPIA del
  jugador no controlado delante de la cámara, congelada 0,22 s tras el contacto; sin candidata en 30 min, la primera de la CPU; `&team=` = criterio anterior).
  `&maxdt=0.25` permite dt grande en entornos lentos (SwiftShader va a ~1-5 fps; con GPU real headless va a 100+ fps).
  Las escenas congeladas envejecen los efectos del evento que las dispara (main.js `fxAge`) para que el destello no salga a plena intensidad.
- Los errores de módulos los registra main.js como `console.error('[VB][ERROR] Modulo.funcion: ...')` (máx. 3 por sitio) sin romper el bucle.
- `node tools/camtest.js [s=75] [semillas] [tamaños]` (de camera_input; SPEED=2, PAR=4, LOG=1, ONLY=…, STRICT=0, PAGE_ROOT=carpeta, DIFF=nivel): regresión automática de la cámara
  en vivo (bounds, cuts, cutcount, servecut, nextcut, settle, mono, reverse, hero agregado por tamaño, scorer, bbox, ball, fovrate). Escribe solo en `tools/out/camtest/`.
- Las herramientas de DevTools (`tools/cdp.js`) crean un perfil temporal `vb3c-*` en %TEMP% y lo borran al cerrar (síncrono, 5 reintentos, y otra vez tras el `exit` de Chrome);
  al abrir barren los de más de 1 h (`VB_NOSWEEP=1` lo desactiva). `VB_PROFDEBUG=1` informa.
  `cdp.js` exporta `killOrphans(maxAgeMs, dry)`: cierra (`taskkill /T /F`) los Chrome huérfanos cuyo proceso Y carpeta `vb3c-*` tienen más de 1 h; `sweepProfiles` lo llama si un perfil viejo no se deja borrar o una vez por hora (marca `%TEMP%/vb3-orphans.stamp`).
  `node tools/clean.js` (ui_main; `DRY=1` solo lista, `AGE=min`) lo hace a mano.
  `cdp.js` exporta además `sweepDead(deadMs = 8 min, dry)` (borra las carpetas `vb3c-*` de más de `deadMs` que ningún proceso vivo nombra en su línea de órdenes; si no se puede
  listar, no borra nada; `open()` lo llama como mucho cada 2 min, marca `%TEMP%/vb3-dead.stamp`, al momento con ≥ 4) y `listVbProcs()`; `clean.js` acepta `DEAD=min`.
- Parámetros nuevos (ola 2): `&intro=0|1` (tarjeta de presentación; en depuración solo con `&intro=1`), `&stamp=1` (sello de calidad también con autopilot), `&vig=0` (sin viñeta CSS), `&wipe=0` (sin cortinilla), `&camdbg=1`. `tools/cdp.js` `page.frames(ms, {dir, start})` (fotogramas reales del compositor) y `VB_ROOT=carpeta`; `perf.js` `EXTRA=params`. camtest añade follow, fovpump, wide, spiker y cutaway.
- Parámetros nuevos (arreglos ola 2): `&preboot=0`, `&bootcap=ms`, `&gymintro=0`, `&camyaw=rad` (depuración: gira la cámara tras su update). `node tools/offarrow.js` (UI-10, escena `?debug=spike&camyaw=±1.2`).
  camtest: `fovpump` es la puerta de p95 ≤ 12°/s y balón fuera de cuadro 0; `fovpumpX` (p50 ≤ 2°/s y balón tras el HUD) y `spikerAll` (agregado CAM-13) son informativas salvo con `STRICT2=1`.
  simtest: bandas de la matriz con `MATRIX_STAT` (objetivo ± 3,5·sd/√(semillas × min/20)); las 6 casillas de banda estrecha juegan el doble de semillas. `perf.js` repite `startMatch` cada 0,5 s hasta `'playing'` (arranque lento).
- Ola 3: camtest añade `serve`, `board`, `clutter`, `block` en cada partida y partidas aparte `[menu]` (`menu` + `intro`), `[setend]` (`clinch`) y `[feel]` (hit-stop y punch);
  `EXTRA_JOBS=` las quita, `CAMBREAK=` fuerza una rotura y `node tools/camtest.js selftest` comprueba que cada `&camBreak=` hace fallar su comprobación. `tools/padplay.js` acepta
  `PADID="…"` (p. ej. DualSense → glifos ✕/○). `tools/audiotest.js` añade las partes 2d/2e/6 y `--endui-only`, `--no-endui`, `--w3-only`, `--sweep-only`, `--no-w3`, `--no-sweep`.
  simtest: sección de calibración del highlight (20 partidos completos de demo, también en el modo rápido) y comprobación de determinismo.
- Arreglos ola 3: simtest falla si la IA (equipo CPU, demo, autopilot o compañero IA del humano; no el jugador que controla el humano) comete un punto `double`/`four`.
  camtest: `feel` descuenta un frame lento del PC dentro de la congelación y `wide` ignora los frames a ≤ 0,4 s de un tirón del PC (lo indican); `serve` en pantalla
  baja/táctil admite el sacador en x ≥ −0,02 NDC.
- Capturas y logs en `tools/out/`.

## 7. Terminología (castellano, árbitro FCVB)
saque, recepción, colocación, remate, bloqueo, toque, red, fuera, antena, dobles, 4 toques, set, punto de set,
punto de partido, cambio de saque. El bloqueo no cuenta como toque del equipo. Sets a 25 (3º a 15) con 2 de diferencia.
Arte y nombres originales; marcas de las vallas ficticias (NÓRDIKA, VOLTA, ALBA·SPORT, MARINA FM, TERRA, SALT·9; pabellón "PALAU DEL MAR").

### VB.TOON (sprint cartoon, integración 9-nov-2026)
- Lo crea arena.js al cargar: `{ gradientMap (DataTexture de 3 pasos, NEAREST), ink 0x1d1530, shadow 0x2b2547, enabled, rank, px, toonMat(p), outline(mesh, m, opts), drop(o), setQuality(q), frame(cam, h) }`.
- `outline(mesh, m, opts)`: casco invertido hijo de `mesh` (Mesh, SkinnedMesh o InstancedMesh). Grosor = min(opts.max, max(m, px · opts.k de pantalla)); si la
  geometría trae el atributo `ow` (0..1) se usa como peso por vértice. Nunca devuelve null: en calidad baja queda oculto (`userData.inkRank` 1 = desde media,
  2 = solo alta; `userData.inkOn = false` lo apaga). `drop(o)` lo quita de la lista (players, al reconstruir los atletas).
- Un solo gradientMap y una sola tinta para atletas, pabellón y mobiliario. El balón (fx.js) usa el mismo gradientMap y su propio contorno de ~2 px.

### Pulido 10-nov-2026 (controles PC, dorsales, Control, separadores, pantallas grandes, playa)
- **Teclas (input.js; textos de ui.js salen de la tabla `GLYPH`):** moverse WASD/flechas; golpear y sacar **J** o **X** o **clic izquierdo**; saltar (en el
  aire: dejada) **Espacio** o **clic derecho**; colocar en salto **K** o **clic central** (acción `jset`; en el suelo salta, ver «Colocación en salto»); C cambiar jugador; V challenge; P/Esc pausa; M sonido; Intro aceptar;
  F pantalla completa. Espacio ya no golpea. El clic entra en el mismo mapa que las teclas (ids `Mouse0`/`Mouse2`: mantener = hitHeld/jumpHeld), solo con
  `pointerType 'mouse'`, solo en `playing`, nunca sobre `MOUSE_UI` (botones, paneles, overlay táctil) ni con los controles táctiles a la vista.
- **Dorsales:** tu pareja lleva el **1** y el **2** (`createGame`: `mkPlayer(0, 1, 0)`, `mkPlayer(0, 2, 1)`; CPU 3 y 9). `prog.js` renumera escuadrones
  guardados (7/11 → 1/2) sin perder progreso. Carrera: dorsal por defecto 1, compañero 2.
- **Control:** `ctrlMode` de dos valores ('both' \| 'one'); en 'one' siempre el n.º 1. La Carrera solo controla a tu jugador (v2: sin opción «Los dos»).
- **Separadores:** `VB.UI.sep(parts, kind, html)` (= `sepHTML` de ui.js; career-ui.js lo usa vía `sp()`): 'd' rombo (antetítulos), 'v' raya fina (ayudas de
  teclas, parciales, estadísticas), 's' barra inclinada (pares cortos), 'c' pastillas (datos de una opción). `parts` es array o texto con « · »; entre trozos
  va una coma `.sr` para lectores. Las frases van con puntuación normal, no con «·».
- **Escala de UI:** `--vs` en `#app` (ui.js `vpFit`): 1 hasta ~1280×760, 1,34 a 1920×1080, 1,71 a 2560×1440, tope 2; `.vs-up` con --vs > 1,05. Menú, Carrera
  (`.cr-in`) y tarjeta de presentación (`#intro .in-card`) usan `zoom: var(--vs)`; HUD y hojas usan `--hs` = Tamaño del HUD × --vs. Por debajo no cambia nada.
- **Escenario:** ajuste `arena` (arriba). `VB.Arena.venueName(id?)` da «Palau del Mar» / «Platja Llarga»; ui.js cambia el nombre en los textos visibles
  (los que nombran los dos se dejan). La playa se construye al elegirla y se libera al volver (sin fugas); el pabellón solo se oculta. Ver notes/arena.md «Playa».

### TAJO y playa completa (10-nov-2026)
Identidad propia de los atletas (dirección «TAJO», lo contrario de otros juegos de vóley playa low-poly: cabezones de ~5 cabezas, superficies lisas,
contorno grueso DE COLOR, cara grande dibujada, uniforme de equipo con el «tajo») y la playa «Platja Llarga» como mapa principal.
- **Escenario (venue).** Una sola fuente: `VB.Arena.venue()` → `'hall' | 'beach'` (ajuste `arena` o `?map=beach`). main.js crea el partido con
  `venue: venueNow()`; el 6v6 juega siempre en el pabellón y la **Carrera siempre en la playa** (los dos con `forceVenue`, ver «Muñeco,
  Carrera de playa y compañeros» abajo); players y fx miran
  `VB.Arena.venue()` cada frame. Cambiar el escenario en la pausa se aplica al salir del partido.
- **Pista de la partida (`g.court`).** Todo lo que pinte, mida o encuadre la pista usa `g.HL` / `g.HW` (o `VB.Sim.court(g)`), nunca `C.HL/C.HW`:
  arena (cintas, red, postes, oficiales: `beachLayout(g)`), fx (línea de la revisión del challenge y atenuación del marcador de caída fuera:
  `courtHL(g)`/`courtHW(g)`), cámara (`lostBall`, punto de saque, revisión). `C.HL/C.HW` solo como respaldo sin partida.
- **Personajes por escenario.** `VB.Players.venue()` → escenario con el que están vestidos; `VB.Players.setVenue(v, g?)` lo fuerza (pruebas;
  `''` vuelve a seguir a arena). Al cambiar, players libera los atletas (atlas, material, geometrías, contorno con `VB.TOON.drop` y **textura de
  huesos del esqueleto**) y los reconstruye; la clave de caché incluye el escenario. Pabellón: manga, tajo en zigzag, rodilleras, calcetines de
  acento y zapatillas; playa: camiseta de tirantes, malla corta del mismo color, descalzos y visera/gorra hacia atrás (sin gafas de sol).
- **Cara dibujada.** Los huesos `eyes, mouth, teeth, brow[2]` siguen existiendo (27 huesos) pero **vacíos**: la cara va en dos láminas que
  muestrean la hoja de caras del atlas de cada atleta (8 celdas de ojos × 8 de boca, uniformes `uEyeOff`/`uMouthOff`). `VB.Players._face(p, x)`
  acepta además `'c<ojos>/<boca>'` (p. ej. `'c5/2'`). Pieles oscuras: halo claro en ojos, cejas y boca (legibilidad).
- **Tinta de color.** `VB.TOON.outline(mesh, m, { color })` acepta un color de contorno (un material por color, el mismo programa). Los
  atletas usan `mixHex(tc.dark, INK, 0.35)`; pabellón y mobiliario siguen con `INK`.
- **Oficiales.** arena escala el hueso de la cabeza de árbitros, jueces y anotadores (`OFF_HEAD_K` 1,32) y les da ojos de dibujo, para que no
  queden realistas al lado de los atletas.
- **Cambio de campo de playa** (`courtChange why:'swap'`): videomarcadores «CAMBIO DE CAMPO · CADA 7 PUNTOS», silbato corto pegado al del punto.
- Sim y `g.rng` no cambian: huella 2v2 idéntica (simtest).

### Colocación en salto (10-nov-2026)
- **Controles, el mismo concepto en todo**: en el aire, GOLPEAR = remate (o el toque que toque) y **COLOCAR = colocación en salto**; SALTAR otra
  vez sigue siendo la dejada. COLOCAR en el suelo (y en el saque) salta, así que pulsarlo dos veces = salta y coloca.
  Teclado **K** (antes alias oculto de saltar) · ratón **clic central** (`Mouse1`, sin autodesplazamiento) · mando **X** (PS □; antes 2º botón de
  saltar, B sigue saltando) · táctil: botón contextual **COLOCAR** (verde, 64 px; 56/52 px en pantallas bajas) encima de SALTAR, solo en el aire con
  el balón jugable (`VB.Sim.jsetReady(g)`), se va al caer; deslizar de SALTAR a COLOCAR vale. `VB.Input.poll()` añade `jset` (flanco; con él
  `jump` también es true), `_debug().setOn`, `stats.press.set`, `stats.out.jset`, `stats.mouse.jset`; `glyphs().jset`. main.js pasa `simIn.jset`.
- **Sim**: `hit(..., shot 'jset')` (gesto del humano) en el 2º toque, o en el 1r con el balón alto en la red (`isAttackContact`): `kind 'set'`,
  `shot 'jump'`, `hit.jset`. Más tensa que la de suelo (cima = contacto + 0,75 m, mín. 4,1; 1r toque + 1,15), ventana ÷1,2 y `p.ak.wSet`;
  con mal timing (q < 0,45) a veces sale pegada a la red o larga. El remate que sigue a una buena tiene la defensa rival ×0,8 (`VB.JSET`).
  Donde no cabe (3r toque) COLOCAR es dejada en la red o el toque normal. Tras una colocación en salto en el 1r toque se ataca en el 2º:
  `VB.Sim.atkPhase(g, t)` sustituye a «touchTeam === t && touches === 2» (ai.js, hitWindow.attack, assistMove, aim3, aimPoint, focusPoint,
  updateDefense, players.js approachTime, fx.js retícula). `point.assist`/Manos de seda cuentan la colocación en salto. La IA no la usa: CPU contra
  CPU idéntico. Funciones nuevas: `VB.Sim.atkPhase`, `canJset(g,p,count)`, `jsetReady(g)`, `jsetVoid(g,p)`, `VB.JSET`; `stats.jsets`.
- **Arreglos tras la revisión (10-nov-2026)**: (1) el bloqueador CPU **lee** la colocación en salto: con `jsetReady` (humano en el aire en un
  toque donde puede colocar) va ya a la red frente al compañero del humano, sin saltar; si el humano arma GOLPEAR o dejada, salta a por él
  (ai.js `pos`; nunca en CPU contra CPU). (2) `JSET.dig` (×0,8) solo tras la del 2º toque. (3) `jsetReady` mira el contacto previsto
  (`hitWindow`): jugador aún > 0,25 m y, en el 1r toque, balón > NET_H + 0,1, lo mismo que pide `canJset`; caché por `g.time`.
  (4) `jsetVoid(g,p)`: con un remate rival en camino COLOCAR en el aire no hace nada (se bloquea) ni se ofrece. (5) COLOCAR pulsado
  justo al despegar se guarda `JSET.buf` (0,2 s, `g.jsetQ`): la doble pulsación rápida = salta y coloca.
- **UI**: aviso en el aire en rejilla 2×2 (`#prompt.two`): «[GOLPEAR] Rematar / [COLOCAR] Colocar» (táctil «… / [COLOCAR] en salto»,
  sin la línea de consejo repetida; teclado: J naranja y K verde); `GLYPH.*.jset/jsetT` (K, X/□, Colocar);
  `.key.tch.s` (verde); panel Controles, tutorial (paso 3) y consejos en los 3 dispositivos. Detalle en notes/sim.md, notes/camera_input.md y notes/ui_main.md.

### Muñeco, Carrera de playa y compañeros (10/11-nov-2026)
- **players.js con el muñeco.** El muñeco chibi de `js/doll.js` (`VB.Doll`, cargado justo después de players.js; players lo lee en init) es el ÚNICO modelo de personaje:
  `VB.Players.body()` → `'doll'` (los presets `?body=` ya no existen; `setBody` devuelve false). players.js monta el esqueleto de siempre
  (27 huesos) con `VB.Doll.dims()` / `VB.Doll.boneLayout()` y pide la geometría (`VB.Doll.geometry(r, lod)`, 3 niveles) y el material
  (`VB.Doll.material(tc, L, num, beach, px)`: atlas con equipación, dorsal y hoja de caras; caras con `VB.Doll.faceCells`). Las poses siguen
  en el espacio del atleta antiguo y `applyPose` las reproyecta (`ARM_K`, `ARM_UPK`, `LEG_K`); estirón cartoon del brazo en la IK hasta
  `ARM_STRETCH` 1,405 (`VB.Players.dims()`: `reach` 1,935 de reposo, `reachMax` 2,192 como antes). Aspecto por jugador (`lookOf`: tus n.º 1
  y 2 fijos, el resto determinista por dorsal/equipo/club rival), equipaciones de `setKit`, playa con tirantes, malla y descalzo. La sim no
  cambia: huella 2v2 idéntica. Los oficiales y el público (arena.js) siguen con su estilo propio. Detalle en notes/players.md «Muñeco».
- **Escenario forzado** (main.js): `forceVenue(v)` monta el escenario `v` como si fuera el ajuste (`onSettings(copia con arena v, 'arena')` a
  todos los módulos, sin tocar `ctx.settings`) y `unforceVenue()` (en `toMenu`) vuelve al del ajuste (si se cambió en la pausa, manda el ajuste).
  La **Carrera** (`startMatch` con `opts.career`) fuerza `'beach'`; el **6v6** (`?format=6v6`: partido, demo del menú y escenas serve6/rally6/
  point6) fuerza `'hall'`, porque la sim juega en su pista 18×9.
- **Carrera de vóley playa** (`voley3d.career` v3; v1/v2 migran sin perder nada): `matchSetup()` → `venue: 'beach'`, `points: 21` (3r a 15),
  clubes de playa con `club.beach` (sede), circuitos Regional / Nacional / Superliga de Playa / Continental / Mundial y el Open. `quickSim` también
  a 21/15. Detalle en notes/carrera.md «Sprint playa».
- **Compañeros**: media = media del club + desvío propio (`VB.Career.MATE_OFF` −9..+5, media −2), rol complementario, `mateProfile(m)`, forma
  `m.form` −3..+3; las ofertas traen su compañero (`o.mateP`); la plantilla (`c.squad`, `genSquad`) da 2 alternativas dentro de `MATE_OFF`, a ≥ 3
  del titular y distintas entre sí; `changeMate(i)`. El club renueva al compañero si queda a `MATE_RENEW` (7) o más bajo el club.
- **Precompilado asíncrono** (main.js `prewarmPrograms`): al devolver `getUniforms` a los programas recién compilados, los materiales afectados se
  marcan con `currentProgram = undefined`, `uniformsList = null` **y `__version = -1`** (sin esto, three r149 reutilizaba el programa
  indefinido tras cambiar la calidad y el partido se pintaba vacío con «reading 'getUniforms'» en cada frame).
- `tools/perf.js` sin `EXTRA` mide el escenario por defecto (la PLAYA); el pabellón se mide con `EXTRA=map=hall`.

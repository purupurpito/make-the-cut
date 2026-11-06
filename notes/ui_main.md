# notes/ui_main.md — shell, UI y bucle (owner: ui_main)

Ficheros: `index.html` (CSS inline), `js/ui.js`, `js/main.js`, `tools/shot.sh`, `tools/console.sh`, `tools/drive.js`, `tools/eval.js`.
Las interfaces de CONTRACT.md §4 siguen intactas. Todo lo de abajo son AÑADIDOS opcionales.

## Añadidos en `VB.ctx` (main.js)
- `ctx.settings` tiene campos nuevos (persistidos en `localStorage['voley3d.settings']`, validados al cargar):
  - `difficulty`: `'easy' | 'normal' | 'hard'` (en la UI: Fácil / Normal / Difícil). Se pasa a `Sim.createGame({difficulty})`.
  - `camSens`: 0,5..1,5 (pasos de 0,1). camera.js ya lo lee (ver notes/camera_input.md).
  - `sfxVol`, `musicVol`: 0..1 (pasos de 0,1). audio.js los lee en `onSettings` (petición de notes/audio.md, hecha).
  - `showHelp`: avisos "¡Golpea ahora!"/"¡Salta!" y consejos de toque.
- `ctx.inputDevice`: `'keyboard' | 'gamepad' | 'touch'`, copiado cada frame de `Input.poll().device`. La UI cambia los glifos de teclas con él.
- `ctx.fps`: media de las últimas ventanas de 2 s (siempre, también en depuración).
- `ctx.lastKeyT` (lo escribe ui.js): último instante con teclado; si hace >3 s y el dispositivo es táctil, la UI muestra glifos táctiles.

## Añadidos en `VB.UI` (ui.js) — main.js los llama con guarda
- `nav(it, realDt)`: navegación de menús con MANDO (stick arriba/abajo = elegir, izquierda/derecha = cambiar valor o paso del tutorial,
  A = aceptar, B = volver). main.js la llama cada frame cuando `ctx.state !== 'playing'`. Si el estado cambia dentro de nav
  (p. ej. A en "Seguir"), main anula `hit/jump/switchPlayer` de ese frame para que no golpee.
- `back()`: cierra el panel abierto (tutorial/controles/ajustes) y devuelve `true`. main.js lo llama ANTES de pausar/reanudar
  cuando llega `it.pause` (Esc / P / Start): Esc en un panel vuelve al menú/pausa en vez de reanudar.
- `ingest(events, g)`: solo estadísticas, sin banners. Lo usa main.js en escenas de depuración que avanzan la sim sin pintar.
- `callout(text, team)`: aviso corto bajo el contador de toques (lo usa la propia UI para "¡Bloqueo!", "Recepción perfecta").
- `isPanelOpen()`.
- Teclado en menús: ↑/↓/Tab eligen, ←/→ cambian valores (o pasos del tutorial), Intro acepta, Esc vuelve (vía Input → main → `UI.back`).

## Flujo de main.js (cambios respecto a la base)
- `it.pause` → `UI.back()` → si no lo consume, `togglePause` (solo en partido/pausa).
- Pausa automática al perder el foco (`blur`) y en `visibilitychange` (no en escenas de depuración).
- Calidad adaptativa con histéresis (ventanas de 2 s): baja un nivel tras 2 ventanas < 45 fps; sube uno (hasta el máximo
  automático: alta en escritorio, media en móvil) tras 5 ventanas > 57 fps y 30 s sin bajar; tras 2 bajadas no vuelve a subir.
  Desactivada con `?quality=`, calidad fija en Ajustes o en depuración. pixelRatio ≤2 escritorio, ≤1,5 móvil.
- Telón de carga `#boot` que se funde al 3er frame; `webglcontextlost` → mensaje de error en castellano.
- `?fps=1` → contador (fps, calidad, pixelRatio, draw calls, triángulos).

## Escenas de depuración (`?debug=`)
`menu serve hud rally spike block point ace setpoint switch over|end mobile pause tutorial controls settings`
- `tutorial&step=N` abre el paso N; `panel=tut|ctl|set` abre un panel sobre el menú.
- `pause` juega hasta el primer punto y pausa; `over/end` juega un partido entero headless y pasa los eventos a `UI.ingest`
  (la pantalla final muestra estadísticas reales).
- `diff=easy|hard` fuerza dificultad.

## Herramientas
- `tools/shot.sh` borra la captura anterior antes de generar (antes daba por buena una PNG vieja si Chrome fallaba).
  `TMO=segundos` cambia el tiempo máximo (por defecto 150; con la máquina cargada hace falta 240-300) y `VTB=ms` el tiempo virtual.
- `tools/drive.js` y `tools/eval.js` lanzan Chrome en su propio grupo de procesos y lo matan entero al salir
  (también con Ctrl-C, SIGTERM o tiempo agotado). Antes, si node moría, quedaban Chrome huérfanos consumiendo CPU.

## Peticiones a otros owners
### sim
- Ninguna obligatoria. La UI deduce el tipo de punto: **ace** (`!sideout && rallyHits===0 && reason==='in'`),
  **error de saque** (`rallyHits===0 && reason!=='in'`), **remate ganador** (último `hit` del ganador fue `spike`), **punto de bloqueo**
  (hubo `block` del ganador después del último `hit`). Si sim añade `point.kind` o `point.fault`, la UI lo preferirá encantada:
  ```js
  // en point(): ev.kind = 'ace' | 'kill' | 'block' | 'error' | 'serveError' | 'in';
  ```
- La UI usa `VB.Sim.canReach(g, g.ctrl)` para "¡Golpea ahora!" y `g.pr3` (+ `g.jobs[0]`) para "¡Salta!". Si cambia la semántica de `pr3.t`
  (segundos hasta el cruce), avisad.

### camera_input
- Hecho: escena `switch` (congela 0,18 s después del cambio).
- `UI.nav` usa `it.hit` (A) y `it.jump` (B) cuando `it.device === 'gamepad'`; no usa `it.confirm` para no duplicar con Intro del teclado.

### audio
- Hecho: sliders "Efectos" y "Música" (`sfxVol`, `musicVol`), `Audio.hover()` al pasar el ratón y al moverse por menús con teclado/mando,
  `Audio.ui('start')` en Jugar/Revancha/¡A jugar!, `Audio.ui('back')` en Volver/Menú/Esc. Al mover el slider de efectos suena `play('pass')` como muestra.

## Problema de entorno (no es código)
Durante la sesión había dos Chrome headless huérfanos de `tools/drive.js` (perfiles `/tmp/vb3d-0tW7m3` y `/tmp/vb3d-788h03`,
lanzados ~11:10, ~200 % CPU cada uno; su node ya no existía). Cargan la máquina (load ~60 en 8 núcleos) y hacen que
cada captura tarde 2-3 min. No los he matado (no tenía permiso). Para liberarlos:
`pkill -f 'user-data-dir=/tmp/vb3d-'` (solo afecta a Chrome lanzados por drive.js).

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
`menu serve hud rally spike block point ace setpoint switch over|end mobile pause tutorial controls settings toss jumpserve dive`
- `serve`/`hud` se crean con `serveClock:false` (sin falta de 8 s en capturas largas); `&clock=1` la vuelve a activar.
- `toss` (flotante, balón a ~3 m sobre el sacador) y `jumpserve` (sacador en el aire tras la carrera): saque humano congelado
  (código de notes/sim.md; no reenvían `newMatch` para que el banner "Set 1" no tape la escena congelada).
- `dive`: plancha (autopilot, seed 7 ≈ 45 s de juego), congela 0,12 s después del evento.
- `tutorial&step=N` abre el paso N; `panel=tut|ctl|set` abre un panel sobre el menú.
- `pause` juega hasta el primer punto y pausa; `over/end` juega un partido entero headless y pasa los eventos a `UI.ingest`
  (la pantalla final muestra estadísticas reales).
- `diff=easy|hard` fuerza dificultad.

## HUD (pasada de cierre, 6-nov-2026, PC de casa)
- `miss` del humano → aviso corto "¡Pronto!" / "¡Tarde!" / "No llegas" (petición de notes/sim.md).
- Saque humano antes del silbato (`g.serveAuth === false`): aviso "Espera el silbato" (estilo neutro `#prompt.wait`, sin tecla).
- Pantalla final en móvil apaisado (alto ≤ 560 px, ancho ≥ 600 px): dos columnas (resultado + botones | estadísticas);
  antes los botones Revancha/Menú quedaban fuera de la pantalla a 844×390.

## Herramientas
- Chrome con la GPU real por defecto (`tools/chrome-env.sh` para bash, `tools/chrome.js` para node): ANGLE d3d11 en Windows,
  metal en Mac, gl en Linux; `GL=swiftshader` para máquinas sin GPU, `CHROME=/ruta` para otro ejecutable.
- `tools/drive.js`: por defecto 1280×720 y sin `quality=low&maxdt=0.25` (con `GL=swiftshader` los añade solo).
  El saque son dos pulsaciones: espera `g.serveAuth`, Espacio lanza y Espacio golpea cuando `VB.Sim.hitWindow(g, g.server).t`
  llega a ~0 (función `serve()`); el bucle de juego usa lo mismo en cada saque humano.
- `tools/eval.js`: si la expresión devuelve una Promise, espera a que se resuelva (`awaitPromise`).
- `tools/shot.sh` acepta una ruta de salida relativa (la convierte en absoluta).
- `tools/shot.sh` borra la captura anterior antes de generar (antes daba por buena una PNG vieja si Chrome fallaba).
  `TMO=segundos` cambia el tiempo máximo (por defecto 150; con la máquina cargada hace falta 240-300) y `VTB=ms` el tiempo virtual.
- `tools/drive.js` y `tools/eval.js` lanzan Chrome en su propio grupo de procesos y lo matan entero al salir
  (también con Ctrl-C, SIGTERM o tiempo agotado). Antes, si node moría, quedaban Chrome huérfanos consumiendo CPU.

## Herramientas (Integrate)
- `tools/cdp.js`: cliente DevTools común. Fija el VIEWPORT EXACTO (`Emulation.setDeviceMetricsOverride`): con `--window-size`
  Chrome headless de Windows dejaba la página en 1264×569 (pedido 1280×720) y 828×239 (pedido 844×390).
- `tools/shot.js`: capturas + errores de consola; varias escenas en un solo Chrome (`all` = todas). `shot.sh` y `console.sh`
  son ahora envoltorios suyos (misma línea de comandos; `VTB` pasa a ser espera en tiempo real; `TOUCH=1` emula táctil).
- `tools/eval.js` y `tools/drive.js` usan `cdp.js` (viewport exacto). `eval.js` con `SHOT=out.png` captura tras evaluar
  (el "evalshot" que proponía arena).

## Aplicado (log)
- 6-nov-2026 (Integrate, PC de casa):
  - Pausa: el antetítulo decía "Tiempo muerto" (en vóley es el que pide un equipo) → "Partido en pausa". En pantallas bajas
    (alto ≤ 560 px) la hoja de pausa va a dos columnas: a 844×390 "Salir al menú" quedaba cortado.
  - Escenas congeladas: main.js envejece los efectos del evento disparador (`fxAge`, máx. 0,6 s) para que el destello/onda
    no salga a plena intensidad en la captura (petición de arena).
  - HUD táctil: en el saque la tecla del aviso dice SACAR (como el botón), no GOLPEAR.
  - Viewport exacto en las herramientas (petición de camera_input). Ruta relativa en shot.sh (petición de arena; ya estaba).
  - El halo blanco de las capturas lo arregló arena (reflejo especular del suelo + contraluz rasante; ver notes/arena.md §2).
  - sim ya emite `point.how` y la UI lo usa (con deducción de reserva si falta): petición `point.kind` cerrada.
- 6-nov-2026 (Review 1, arreglos ui_main, verificado con GPU real):
  - Ya estaban (comprobados de nuevo): consejo arriba y aviso anclado junto al pecho del jugador (no tapa pies ni aro);
    "¡Golpea ahora!" del saque solo con el balón BAJANDO (antes "Golpea al bajar" con barra); el aviso se borra al golpear
    y al cambiar de jugador; sin "¡Perfecto!" en balón libre (consejo "salta con K"); "Falta de saque"; filas de la pantalla
    final que suman Puntos (ataque + bloqueo + aces + errores del rival); primer JUGAR → "Ver cómo se juega / Jugar ya" y
    nivel Fácil por defecto para jugadores nuevos; diagrama del tutorial con la paleta de la pista; pérdida de contexto
    WebGL recuperable (pausa + "Recuperando los gráficos…"; mensaje definitivo a los 6 s); PCF simple y escala de render
    0,8/0,67 en "baja"; lienzo sin MSAA cuando hay post-proceso; renderer.info de frame completo; pausa/final a 1/3 de frames.
  - Nuevo: la cinta de PUNTO DE SET/PARTIDO va a la franja alta (top 8 px, sobre la grada) y el consejo se oculta mientras
    dura; en apaisado bajo (alto ≤ 560 px) sin subtítulo. Antes tapaba al sacador rival del fondo.
  - Nuevo: subtítulo propio para el ace ("Saque directo: nadie lo toca" / "La CPU no controla la recepción"); antes salía
    el texto de sim ("Balón a la red") cuando el ace venía de una recepción fallida a la red.
  - Escena `ace`: ace del equipo humano usando `point.how`, en Fácil salvo `&diff=` (con Normal y el autopilot casi no hay aces).
- 6-nov-2026 (integración tras Review 1):
  - main.js: `rookie: isRookie()` en `startMatch` (petición de sim); `debug=jumpserve` 145 pasos (petición de players).
  - ui.js: tutorial paso 4 con el apuntado del remate ("Sin dirección va en diagonal; arriba, al fondo; abajo, corta; izquierda o derecha, hacia esa línea").
  - index.html: en apaisado bajo (alto ≤ 560 px) la cinta compacta de PUNTO DE SET/PARTIDO va a la derecha, junto a la pausa:
    centrada (y 8-48 px a 844×390) tapaba la cabeza y el balón del sacador rival (y 35-81 px). Medido con eval y captura.
  - CONTRACT.md: §4.2/§4.3 con los campos y eventos nuevos de sim y §4.4 con las APIs opcionales de cada módulo.
- 6-nov-2026 (Review 2, arreglos ui_main, verificado con GPU real):
  - Aviso corto (`#callout`: "¡Bloqueo!", "Toque de bloqueo", "Recepción perfecta"…) DENTRO del marcador, justo debajo
    (franja izquierda); 0,8 s. Antes iba centrado arriba y tapaba red, bloqueador y balón en pleno ataque.
  - Contador de toques a ≤ 760 px de ancho: solo el chip activo lleva texto (a 667×375 pisaba el marcador; medido:
    marcador x16-202, contador x240-427; a 640×360 x227-413).
  - MSAA del lienzo: siempre en móvil y en escritorio salvo calidad FIJA baja (`ctx.canvasAA`). Antes el móvil iba sin AA
    y el escritorio se quedaba sin AA al bajar de alta a media (se apaga el post de arena).
  - `renderer.debug.checkShaderErrors = false` fuera de `?debug`. Precalentado (`ctx.prewarm`): sube todas las texturas
    al arrancar y al empezar partido (~40 ms). `?prewarm=c` compila además todos los programas y `?prewarm=r` pinta un frame
    con los objetos ocultos visibles, pero cuestan 3,7 s y 7 s tras el telón (ANGLE compila HLSL lento) y crean ~25-30
    programas que el juego no usa: por eso no van por defecto.
  - Picos al empezar partido (medidos con rAF, 1280×720): el marcador costaba un frame de 100-120 ms la primera vez que
    se mostraba → en el menú el HUD queda casi transparente (`.warm`) en vez de `display:none`; el banner animaba
    `filter:blur` y `letter-spacing` (frames de 40-55 ms en cada banner) → solo transform/opacity. Resultado: de ~10 frames
    > 28 ms en el primer segundo a 1-2 (el mayor, 55-65 ms en el primer frame).
  - Vertical en móvil: no se pinta nada bajo "Gira el móvil". `resize` solo lee el contenedor si un evento o un
    ResizeObserver lo marcan. `call()` de aridad fija (sin `arguments`/slice por llamada).
  - Sin `backdrop-filter` en el HUD de juego (marcador, toques, aviso, consejo, chip); en táctil tampoco en el menú.
  - Banner: subtítulo y chip CAMBIO DE SAQUE con fondo oscuro propio; titulares de la CPU con un solo estilo
    ("Remate de la CPU", "Dejada de la CPU", "Bloqueo de la CPU", "Falta de saque de la CPU", "Punto de la CPU");
    titular largo a cuerpo menor (`.long`). Punto por balón fuera: subtítulo de árbitro desde `lastKind`
    ("Remate fuera", "Recepción fuera", "Dejada fuera", "Toca el bloqueo y sale fuera"…) en vez del texto de sim.
  - Consejo de arriba: la pastilla no se atenúa (solo el texto) y desaparece con el balón del saque en el aire.
    Táctil: consejo compacto de una línea bajo el contador (primeros 3 partidos, 3 s de juego por tipo).
  - Ordinales "1.er / 2.º / 3.er" en HUD, tutorial y controles. Tutorial táctil: SACAR en el paso del saque. Tarjeta
    ANTENA: "El balón toca la antena o cruza por fuera de ella"; pie: "…recuperas el saque (cambio de saque) y saca tu compañero".
  - Primer partido: primera recepción/defensa, primera colocación y primer remate llegan a cámara lenta (0,4 durante 1,3 s,
    `CameraRig.slowmo`) con una tarjeta grande arriba ("PRIMER TOQUE · RECEPCIÓN — Ve al aro amarillo y pulsa ESPACIO").
    `&guide=1` la fuerza (también con autopilot) para probarla.
  - Victoria: 3,6 s reales de celebración antes de la tarjeta final (`ctx.endHold`; main.js pinta a ritmo completo),
    con "Intro / Toca para continuar". En depuración, inmediata salvo `&hold=1`. Botón "Revancha en <nivel>" (uno más
    tras ganar; uno menos tras perder salvo en Fácil) y "¿Te cuesta? Prueba el nivel Fácil". Racha: "1 punto seguido",
    y el aviso de récord solo desde 3.
  - Escenas `point`/`ace`: se reenvía el último `land` antes del punto para que FX pinte la marca del bote.
  - Nota para sim (anotada como pendiente en notes/sim.md §5): la UI ya no muestra el texto de sim para `reason:'out'`, pero el
    videomarcador y cualquier otro consumidor de `point.text` siguen viendo "Balón fuera de la CPU"/"Tu balón sale fuera".
- 6-nov-2026 (integración tras Review 2):
  - 4 niveles, cambio de campo, rol defensivo, `shot:'body'`, `block 'touch'`, tutorial (peticiones de sim; detalle en el log de
    notes/sim.md). `#touchbar.dim` (camera_input). `ctx.simMove` y `scene.matrixAutoUpdate = false` (arena).
  - "¡Golpea ahora!" ya no sale al jugador en el aire junto a la red con el remate rival aún en su campo (es un bloqueo; se veía
    en la escena `spike`). Subtítulo del punto de bloqueo: "Bloqueo directo al suelo" (antes "El balón cae en el campo rival").

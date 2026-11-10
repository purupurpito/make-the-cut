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
  El saque son dos pulsaciones: espera `g.serveAuth`, J lanza y J golpea cuando `VB.Sim.hitWindow(g, g.server).t`
  llega a ~0 (función `serve()`); el bucle de juego usa lo mismo en cada saque humano y golpea con J o con clic izquierdo (comprueba `VB.Input._debug().stats.mouse.hit > 0`); Espacio salta.
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

## Cierre de pendientes (7-nov-2026, PC de casa, GPU real) — rendimiento móvil, táctil, mando
### Herramientas nuevas (de ui_main)
- `node tools/perf.js [WxH=844x390] [s=20] [niveles=auto,high,medium,low] [cpu=4] [dpr=2.75]`: móvil emulado (viewport, dpr,
  táctil, UA Android, `Emulation.setCPUThrottlingRate`) y un partido REAL con autopilot (`SCENE=rally` = `?debug=rally&live=1&aq=1`).
  Por nivel: fps medio, p5, frame p95/p99, coste JS por frame (`ctx.frameMs`), tareas largas, heap (tras GC completo al empezar y
  al acabar = "retenido"), ritmo de asignación, MinorGC/MajorGC (traza de V8), draw calls/triángulos/texturas/geometrías/programas,
  pixelRatio, lienzo, sombra y lo que hizo la calidad adaptativa (`ctx.qLog`). Tabla + JSON en `tools/out/perf/`.
  `PROFILE=1` perfil de CPU por fichero/función; `ALLOC=1` asignaciones por función (KB/s); `RETAIN=1` solo lo que sigue vivo;
  `DESKTOP=1` sin emulación; `STRICT=1` sale con 1 si no cumple objetivos; `GL=swiftshader`.
- `node tools/touchplay.js [tamaños=844x390,667x375] [s=35] [toques=3]`: partido real con `Input.dispatchTouchEvent` multitáctil
  (joystick arrastrado + GOLPEAR/SACAR, SALTAR, ⇄, pausa), menú con toques (nivel, Ajustes/Volver, JUGAR → "Jugar ya"), pausa →
  Ajustes → Volver → Seguir, "Gira el móvil" a 390x844 (sim parada, sin overlay) y vuelta, Salir al menú. Capturas en
  `tools/out/touchplay/<WxH>/`. Nota CDP: `touchEnd` lleva SOLO los dedos que se levantan.
- `node tools/padplay.js [W] [H] [s] [toques]`: mando falso de mapeo estándar (`Page.addScriptToEvaluateOnNewDocument` sustituye
  `navigator.getGamepads`, con `vibrationActuator`). Menú con stick + A/B, ←/→ cambia el nivel, JUGAR, saque A+A, stick hacia el
  balón, A en el momento, RB cambia, Start pausa/reanuda, B reanuda, Select silencia/reactiva, glifos A/B en el HUD, vibración en
  los toques propios, desconexión en partido → pausa con "Mando desconectado" → reconexión. Capturas en `tools/out/padplay/`.
- `tools/cdp.js`: `open({dpr, mobile, ua, throttle, init, flags})`, `on(evento, fn)`, `setThrottle(rate)`, `setSize(size, touch, dpr)`;
  **vuelve a aplicar el freno de CPU tras cada navegación** (Chrome cambia de proceso de render al navegar y el freno se perdía:
  las medidas antiguas alternaban entre frenadas y sin frenar — eso explicaba los "tirones" y los fps dispares).

### Añadidos en main.js / ui.js (todo opcional, interfaces de CONTRACT intactas)
- `ctx.frameMs` (coste JS del último frame), `ctx.frameMsAvg` (media de la ventana de 2 s), `ctx.qLog` (cambios de calidad
  `{t, level, scale, pr, fps, js, why}`), `ctx.fixShadowDepth()`, `?aq=1` (calidad adaptativa también en depuración, para perf.js).
- `QUALITY.*.mobilePixelRatio`: tope de pixelRatio en el móvil por nivel: alta 1,5 · media 1,25 · baja 1 (antes 1,5 en media).
  Escritorio sin cambios (alta mantiene su aspecto).
- Sombras en el móvil: PCF simple en todos los niveles (cambiar de tipo recompilaba todos los materiales: ~2 s de parón con CPU ×10
  justo al bajar de calidad). Escritorio igual que antes (PCF suave en alta/media).
- `fixShadowDepth()`: `customDepthMaterial` compartido para `SkinnedMesh` y para `InstancedMesh`. El material de profundidad único
  de three r149 cambiaba de programa 4 veces por frame (getParameters + clave de programa en cadenas: ~650 KB/s de basura). Ahora 0.
- Calidad adaptativa (ventanas de 2 s): baja tras 2 ventanas < 45 fps o 3 seguidas < 52; la escala de render en "baja" solo si la
  GPU es el cuello (JS < 55 % del intervalo; si es la CPU, quitar píxeles no ayuda); sube tras 5 > 58 y 30 s sin bajar (máx. 2
  bajadas); la ventana que sigue a un cambio de calidad/estado/pausa no cuenta.
- `UI.padEvent(kind)` (main.js con `it.padEvent`): "Mando desconectado" en el antetítulo de la pausa; "Mando conectado" como aviso.
- Escena `dive`: plancha de la CPU que llega al balón, congelada 0,22 s después (tendido en el suelo, de frente al otro lado de la
  red). La del jugador propio no servía: el cambio automático de jugador llega en el paso siguiente y la cámara se va al compañero.
  `&team=0|1|any`, `&n=N`, `&t=s`.
- HUD: "TOQUES" en su propia pastilla oscura (texto claro); chips pendientes con texto `--muted` (antes `--dim`, poco contraste).
  Balón detrás del contador: clase `.thru` (chips casi transparentes, texto entero con sombra) en vez de opacidad .35.
  **Bug arreglado**: la clase antigua `.dim` heredaba la regla global `.dim{display:flex;padding:16px…}` de las pantallas: la barra
  saltaba 16 px hacia abajo y se ensanchaba (436x32 → 468x64) cada vez que el balón pasaba por detrás; lo mismo le pasaba al
  consejo (`#coach.dim` → `#coach.faint`).

### Rendimiento medido (`node tools/perf.js <tam> 20 … 4 2.75`, GPU real, móvil emulado, CPU ×4, partido en vivo)
| tamaño | nivel | fps | p5 | frame p95 | JS ms (media/p95) | draw | tri | pr / lienzo | sombra |
|---|---|---|---|---|---|---|---|---|---|
| 844x390 | auto→media | 115 | 82 | 12,2 | 5,6 / 8,2 | 45 | 195k | 1,25 / 1055x487 | 1024 |
| 844x390 | alta | 107 | 81 | 12,3 | 6,1 / 9,0 | 46 | 1142k | 1,5 / 1266x585 | 2048 |
| 844x390 | media | 109 | 82 | 12,2 | 6,0 / 8,8 | 47 | 197k | 1,25 | 1024 |
| 844x390 | baja | 119 | 82 | 12,2 | 5,2 / 7,3 | 34 | 81k | 1 / 844x390 | 512 |
| 915x412 | auto→media | 104 | 81 | 12,3 | 6,2 / 9,3 | 47 | 195k | 1,25 / 1143x515 | 1024 |
| 915x412 | media | 108 | 82 | 12,2 | 6,1 / 8,9 | 45 | 194k | 1,25 | 1024 |
| 915x412 | baja | 115 | 82 | 12,2 | 5,4 / 7,8 | 34 | 81k | 1 | 512 |
Objetivos (media/baja ≥ 55 fps; baja ≤ 150k tri y ≤ 60 draw; media ≤ 350k tri; sombra ≤ 1024 / 512): cumplidos. Asignación ~1,3-1,6 MB/s
(Runtime.getHeapUsage), ~75 MinorGC y ~9 MajorGC en 20 s; heap retenido tras GC completo +0,4-1,1 MB en 20 s y +0,9 MB en 60 s
(no crece con el tiempo: calentamiento de cachés + los búferes del propio perf.js). Lo que queda de basura por frame es sobre todo
de three.js (setters de uniformes: `uniformMatrix4fv`/`uniform3f`) y de módulos ajenos (pedido en notes/arena.md §10,
notes/players.md, notes/camera_input.md). Con CPU ×10 la calidad adaptativa baja de media a baja a los ~4 s y NO toca la escala
de render (el cuello es la CPU); queda un parón de ~1,6 s al bajar por el cambio de número de luces de arena (pedido en
notes/arena.md §10). Ojo: la GPU de este PC (RTX 3060 Ti) es mucho más rápida que la de un móvil; los presupuestos de triángulos,
draw calls, pixelRatio y sombra son la parte de GPU del objetivo.

### Verificado
- `tools/console.sh all 1280 720` y `TOUCH=1 tools/console.sh all 844 390`: 19 escenas sin errores JS.
- `node tools/simtest.js 10 12345 0` TODO OK · `node tools/drive.js 1280 720 30` y `844 390 20` TODO OK.
- `node tools/touchplay.js 844x390,667x375 30` TODO OK · `node tools/padplay.js 1280 720 25` TODO OK.
- Capturas miradas: dive (1280 y 844), rally con TOQUES, `.thru` forzado, pausa por mando desconectado, "Gira el móvil".

### Para el integrador
- CONTRACT §4.1: añadir `frameMs`, `frameMsAvg`, `qLog`, `fixShadowDepth()`; §4.4: `VB.UI.padEvent(kind)`; §6: `tools/perf.js`,
  `tools/touchplay.js`, `tools/padplay.js` y `&aq=1`, `&team/&n/&t` en `dive`; §1: perf/touchplay/padplay son de ui_main.
- TRASPASO "Sin comprobar o pendiente": rendimiento móvil medido con emulación (no un móvil real), táctil y mando probados con
  eventos reales de DevTools (no hardware), detalles visuales de TOQUES/dive hechos.

## Aplicado (log, integración de pendientes)
- 7-nov-2026 (integración de pendientes): CONTRACT §1 (perf/touchplay/padplay de ui_main), §4.1 (`frameMs`, `frameMsAvg`, `qLog`, `fixShadowDepth()`), §4.4 (`UI.padEvent`),
  §5.6 (calidad adaptativa nueva) y §6 (herramientas, `&aq=1`, parámetros de `dive`) al día. TRASPASO actualizado.
- ui.js: el subtítulo de 'out' usa `e.text` de sim (petición de sim). arena.js: mismo número de luces en el móvil (tu petición de §10).
- Perf tras la integración (`node tools/perf.js <tam> 20 … 4 2.75`):
  | tamaño | nivel | fps | p5 | draw | tri | prog | sombra |
  |---|---|---|---|---|---|---|---|
  | 844x390 | auto→media | 110,2 | 82 | 48 | 197k | 33 | 1024 |
  | 844x390 | alta | 112,8 | 82 | 47 | 1155k | 31 | 2048 |
  | 844x390 | media | 107,9 | 82 | 46 | 196k | 32 | 1024 |
  | 844x390 | baja | 122,6 | 82 | 33 | 80k | 28 | 512 |
  | 915x412 | auto→media | 98,4 | 55,2 | 47 | 198k | 32 | 1024 |
  | 915x412 | media | 106,3 | 82 | 47 | 197k | 32 | 1024 |
  | 915x412 | baja | 111,0 | 82 | 34 | 81k | 27 | 512 |
  CPU ×10 (auto, 844x390): baja a "baja" a los 4,5 s; 28 fps (no es objetivo); tarea larga máx. 470 ms (antes 1,6 s), programas 33.

## Arreglos ronda 1 de verificación (7-nov-2026, PC de casa, GPU real)
- Calidad adaptativa (main.js):
  - Escala de render solo si el hilo principal está libre: `ctx.cpuBusy` = máx.(JS del juego / intervalo, suma de tareas largas
    de la ventana / 2 s; PerformanceObserver 'longtask') y umbral 0,40 (antes JS < 0,55). Y tras cada escalón de escala se miran
    2 ventanas: si los fps no suben ≥ 15 % se deshace y no se vuelve a escalar en la sesión (Ajustes→Calidad lo reinicia).
    Medido con eval (rally `aq=1`, 1280×720): con 24 ms/frame de trabajo ajeno en el hilo (no visible en frameMs) → "escala" a
    0,8 con 38 fps y a las 2 ventanas "escala deshecha (x1.03)"; con un quemador de GPU (cuesta por píxel) → 0,8 (19→28 fps,
    se queda) y 0,67 (→41 fps, se queda).
  - Calentamiento: sin ventanas los primeros 8 s reales tras el arranque (`&aqwarm=s` lo cambia). Medido: menú con 30 ms/frame
    de carga → primera bajada a los 13,3 s reales (antes podía bajar a los ~3 s por los picos de compilación).
  - `qLog` lleva `rt` (s reales desde el arranque) además de `t` (ctx.time, que con frames > 50 ms va por detrás).
- Sombra en "baja" de ESCRITORIO: mapa de 1024 y PCF suave (antes 512 + PCF simple: pies escalonados en primeros planos).
  El escritorio usa ya un solo tipo de sombra en todos los niveles (bajar a "baja" no recompila). Móvil sin cambios (512, PCF).
  Mirado: `ace` con `quality=low` a 1280×720, recorte ampliado ×2 antes/después (tools/out/fx1/crop-cmp2.png).
- `debug=dive`: por defecto, plancha PROPIA del jugador no controlado, con el controlado ≥ 1,5 m más cerca de la red y el que se
  tira a < 4,8 m de ella (seed 7: ~325 s de juego). El que se tira pasa de ~85 a ~180 px a 1280×720 y de ~25 a ~70 px a 844×390.
  Sin candidata en 30 min → la primera de la CPU. `&team=` mantiene el comportamiento anterior.
- ui.js: "¡Golpea!" del saque con la MISMA ventana que el brillo de SACAR (`hitWindow().press` en [-0,06, 0,22)); medido con
  servehuman.js: aparece a 0,283 s del contacto, igual que el brillo (antes 0,175 s).
- ui.js + index.html: la pastilla del consejo se vuelve translúcida (`#coach.thru`) con el balón detrás, como el contador.
- Tutorial: "Tocar la red entre las antenas mientras se juega el balón es falta. Si el balón la toca y pasa, el juego sigue." (11.3.1).
- Para el integrador: CONTRACT §4.1 `ctx.cpuBusy`, `qLog[].rt`; §5.6: umbral 0,40 + deshacer escala + 8 s de calentamiento;
  §6: `&aqwarm=`, nuevo criterio por defecto de `dive`.

## Aplicado (log, integración ronda 1 de verificación, 7-nov-2026)
- ui.js: aviso «¡Golpea!»/«¡Golpea ahora!» con `press` en (−0,15, 0,24) en el rally y en el saque lanzado (petición de camera_input: el
  brillo de input.js se movió a esa ventana en esta misma ronda; tu [-0,06, 0,22) era la ventana vieja). Constantes `HINT_ON/HINT_OFF` junto a `hw()`.
- perf.js: `WARM` por defecto 45 s con `ALLOC=1`/`RETAIN=1` (propuesta de arena).
- CONTRACT §4.1 (`cpuBusy`, `qLog[].rt`, 'escala deshecha'), §5.6 (umbral 0,40, deshacer escala, 8 s, sombra de escritorio) y §6 (`&aqwarm=`, `dive` por defecto, `WARM`) al día.
- Perf tras la integración (`node tools/perf.js <tam> 20 … 4 2.75`, GPU real, móvil emulado):
  | tamaño | nivel | fps | p5 | draw | tri | prog | sombra |
  |---|---|---|---|---|---|---|---|
  | 844x390 | auto→media | 109,0 | 82 | 47 | 199k | 32 | 1024 |
  | 844x390 | alta | 112,8 | 82 | 47 | 1130k | 32 | 2048 |
  | 844x390 | media | 117,0 | 82 | 47 | 200k | 32 | 1024 |
  | 844x390 | baja | 117,2 | 82 | 34 | 82k | 28 | 512 |
  | 915x412 | auto→media | 107,1 | 82 | 47 | 195k | 32 | 1024 |
  | 915x412 | media | 113,2 | 82 | 47 | 197k | 32 | 1024 |
  | 915x412 | baja | 121,2 | 82 | 34 | 82k | 27 | 512 |
  CPU ×10 (auto, 844x390, 30 s): baja a «baja» a los 8,3 s (calentamiento), 28,9 fps, sin escalón de escala (CPU es el cuello). Escritorio
  1280×720 `rally`: alta 54 draw / 1,17 M tri, media 48 / 209k, baja 35 / 81k (sombra 1024 PCF suave).

## Arreglos ronda 2 de verificación (7-nov-2026, PC de casa, GPU real)
- ui.js `tally()`: "Falta de saque" SOLO si gana el receptor (`&& e.sideout`). Bloquear el saque o tocar la red durante el saque es
  falta del RECEPTOR (12.6 / 14.6.3 / 11.3.1): ahora "Punto de la CPU" / "Error de la CPU" con el subtítulo de sim ("Bloqueo del saque",
  "Toque de red"). Medido con tools/out/verify-rules/ui_point_banner.sh (3 casos) y faltas de saque reales (siguen "Falta de saque…").
- Tutorial: "…recuperas el saque (cambio de saque) y sacáis por turnos: saca el jugador de tu equipo que no sacó la última vez (y lo controlas tú)."
- `tbLabel1` se deduce del estado en `onGameStart` (`label1Of(g)`: RECEPCIÓN solo si el único contacto rival fue el saque). `debug=dive` → "DEFENSA".
- Aviso "¡Golpea ahora!/¡Salta!" (placePrompt): elige derecha / izquierda / sobre la cabeza según lo que tape de los otros 3 atletas y del balón
  (histéresis, salto sin deslizarse al cambiar de lado); si aún tapa, `#prompt.thru` (fondo translúcido). En táctil, más pequeño (30 px) y la franja
  derecha solo se evita a la altura de SALTAR/GOLPEAR. Medido en rally vivo 40 s: 1280x720 0 frames tapando atletas (antes 8, opacos);
  844x390 táctil 13 de 1455, todos translúcidos (antes 64, la mitad opacos); 667x375 20 de 1487 (1 opaco). 2 cambios de lado en 40 s.
- Móvil apaisado (≤ 420 px de alto): tarjeta guiada en UNA pastilla baja (y 38-67 en vez de 36-100) con texto corto; en ≤ 760 px de ancho, centrada en
  el hueco entre marcador y pausa. Consejo y tarjeta casi desaparecen (opacidad 0,3) con el balón detrás. vocclude.js: balón bajo el HUD 0,7 % (844x390,
  antes 2,5 %) y 0,9 % (667x375, antes 4,5 %).
- `#coach.thru` con fondo .38 y sombra de texto más fuerte (legible sobre LED).
- Menú y pausa en teléfonos: botones de 44 px (JUGAR 50) con 6 px de separación; sin la frase de presentación. REINICIAR PARTIDO en dos pasos
  («Toca/Pulsa otra vez para reiniciar», 2 s, sin confirm()). Probado con toques reales de CDP: 1 toque arma, a los 2,3 s se desarma, 2 toques reinician.
- Menú con foco de teclado/mando en otra opción: JUGAR pasa a contorno y la opción enfocada se rellena (`.mlist:has(.mi.kf)`).
  De paso: en táctil JUGAR había perdido su naranja (`.is-touch .mi` pisaba el degradado de `.mi.primary`): arreglado.
- perf.js: CPU del PC anfitrión por nivel (os.cpus; media y máx.) en la tabla (`host%`, `!` si no válida) y en el JSON (`hostCpu`, `hostCpuMax`,
  `valid`, `invalid`); aviso si la media pasa de `HOSTMAX` (80 %); con `STRICT=1` sale con 1. `WARM` por defecto 10 s (45 con ALLOC/RETAIN).
  Medido: `node tools/perf.js 844x390 20 medium` → 111,5 fps, CPU del PC 46 % (máx. 72 %), válido.
- Para el integrador: CONTRACT §6 (perf.js: `WARM` 10 s por defecto, `HOSTMAX`, columna host%, STRICT también por medida no válida).
- Para camera_input (no es de ui_main): `node tools/padtest.js` → 1 fallo "justo fuera de la zona muerta: respuesta pequeña y continua" (stick 0,3
  no convierte el mando en dispositivo activo: dev 'keyboard', mx 0); 2 de 2 ejecuciones. Y vtouch.js (verificador) "el dedo que seguía puesto
  vuelve a mover" falla igual que antes de esta ronda.

## Aplicado (log, integración ronda 2 de verificación, 7-nov-2026)
- CONTRACT §6 (perf.js): `WARM` 10 s por defecto (45 con ALLOC/RETAIN), `HOSTMAX`, columna `host%`, JSON `hostCpu/hostCpuMax/valid/invalid`, STRICT
  también por medida no válida, aviso de que ALLOC altera la optimización.
- Tu nota sobre padtest: pasa (26 ok) con el padtest actualizado por camera_input.
- Rendimiento final (`node tools/perf.js <tam> 20`, CPU ×4, dpr 2,75, GPU real; en el PC había Roblox, League y un grabador abiertos, CPU del PC ~50 %):

  | tamaño | nivel | fps | p5 | ft95 ms | draw | tri k | pr | sombra |
  |---|---|---|---|---|---|---|---|---|
  | 844x390 | auto→media | 98,2 | 82 | 12,2 | 47 | 198 | 1,25 | 1024 |
  | 844x390 | alta | 96,0 | 82 | 12,2 | 45 | 1142 | 1,5 | 2048 |
  | 844x390 | media | 95,7 | 82 | 12,2 | 46 | 196 | 1,25 | 1024 |
  | 844x390 | baja | 100,5 | 82 | 12,2 | 35 | 83 | 1 | 512 |
  | 667x375 | alta | 90,4 | 55 | 18,1 | 45 | 1135 | 1,5 | 2048 |
  | 667x375 | media | 87,3 | 55 | 18,2 | 46 | 196 | 1,25 | 1024 |
  | 667x375 | baja | 100,3 | 82 | 12,2 | 34 | 82 | 1 | 512 |

  «objetivos cumplidos» en las dos. La primera pasada de 844x390 dio 85-93 fps con más carga en el PC; un A/B inmediato contra la instantánea de la
  ronda 1 (`voley-3d-snapshots/verify1-before`) dio lo mismo (media 95 / 95 fps): sin regresión del código.

## Petición de sim (pulido ola 1, SIM-03): pausa de presentación y saltarla (2026-11-07)
sim.js ya expone (ver notes/sim.md §P1): `createGame({present:true})` (o `g.present = true`), `point.hold`, `VB.Sim.skipHold(g)`,
`VB.HOLD`. Con `present` la pausa del punto es 1,9 s (normal), 2,4 s (`highlight ≥ 0,55`), 4,0 s (set, con el cambio de campo) y
4,2 s en `'over'` antes de `gameOver` (antes 2,2: la pantalla final llega 2 s más tarde; UI-11 puede contar con ello).
1. **main.js `ctx.actions.startMatch`** (partidos humanos; el autopilot de depuración y la demo, sin presentación):
   ```js
   setGame(Sim.createGame({ demo: false, seed: seed(), difficulty: opts.difficulty || ctx.settings.difficulty, autopilot: !!opts.autopilot, rookie: isRookie(), present: !opts.autopilot }));
   ```
2. **main.js, bucle** (justo antes del `while (acc >= STEP ...)`, con los flancos del frame aún en `edge`): GOLPEAR o SALTAR durante la
   pausa la recorta (solo tras 0,8 s de pausa; nunca a menos de 0,3 s; sim decide). El flanco se consume para que no llegue al saque:
   ```js
   if (ctx.state === 'playing' && (g.mode === 'point' || g.mode === 'over') && (edge.hit || edge.jump) && Sim.skipHold) {
     if (Sim.skipHold(g)) { edge.hit = edge.jump = false; call('UI', 'onHoldSkip', g); } // onHoldSkip opcional (p. ej. acortar el banner)
   }
   ```
   (Con el balón en juego `skipHold` devuelve false sin tocar nada; en `'over'` ya terminado, también.)
3. **UI (UI-03/UI-04)**: `point.hold` es la duración real de la pausa; un banner que dure `min(e.hold − 0,35, …)` no se queda colgado
   sobre el saque. Si se salta, el siguiente `serveReady`/`newSet` llega antes: conviene que el banner del punto se cierre con él.

## Aviso de audio (pulido ola 1, AUD-03): «toc» del reloj de saque (2026-11-07)
- audio.js suena un «toc» al cruzar `g.serveClock` 3, 2 y 1 s (sacador humano, tras el silbato, solo con `serveState 'ready'`), el último más
  brillante. Cae justo en el cambio de cifra de «Saca ya N s» (`Math.ceil`). Si UI-05 pinta un aro de 8 s, conviene que sus pulsos de los
  últimos 3 s usen los mismos umbrales (cambio de `Math.ceil(g.serveClock)` de 4→3, 3→2, 2→1) para que sonido y aro vayan a la vez. Nada que
  cambiar en ui.js para que funcione.

## De camera_input (pulido ola 1, CAM-05/06/02/04): ganchos de corte, camtest, rótulo del héroe, vibración (2026-11-07)
1. **Cortes (UI-04, UI-13)**: `VB.CameraRig.getDebug()` da `cutN` (sube en cada corte deliberado), `lastCut` `{from, to, kind, t}` con kind
   `'point'` (al plano de reacción, a los 0,45 s del punto), `'serve'` (vuelta al saque), `'court'` (grúa del cambio de campo) u `'over'`, y
   `nextCutIn` (s reales hasta el próximo corte programado; −1 = ninguno; 0 en el frame del corte; cuenta cámara lenta, hit-stop y `skipHold`).
   Una cortinilla de 0,3 s centrada en el corte: empezarla cuando `0 < nextCutIn <= 0.15` y acabarla 0,15 s después de que `cutN` suba.
   Un banner sincronizado: mostrarlo cuando `cutN` sube con `lastCut.kind === 'point'` (el plano de reacción ya está asentado en ese frame).
2. **Rótulo y héroe (UI-03)**: en el plano de reacción `getDebug().pf.mode === 'hero'` y `pf.heroX` = NDC x donde queda el héroe (±0,42, en un
   tercio, con su cabeza a 0,45 NDC). El centro del cuadro queda libre: un rótulo centrado arriba (o desplazado hacia `-pf.heroX`) no le tapa la cara.
3. **CONTRACT §6**: añadir `node tools/camtest.js [s=75] [semillas] [tamaños]` (de camera_input; SPEED=2, PAR=4, LOG=1, ONLY=…, STRICT=0): regresión
   automática de la cámara en vivo (límites del pabellón, cortes, saque rival asentado, transiciones, héroe, balón en cuadro). Escribe solo en tools/out/camtest/.
4. **UI-16 (Ajustes > Accesibilidad)**: `ctx.settings.rumble === false` apaga toda la vibración (`VB.Input.rumble` y `rumbleSig`); el modo confort
   (`camStable` o `prefers-reduced-motion`) ya quita hit-stop y punch de FOV y deja el temblor al 30 %.
5. Visto al pasar `tools/touchplay.js`: «tocar NIVEL cambia la dificultad (easy → easy)» falla en el menú a 844×390 y 667×375 (ui.js, UI-06 en obras);
   el resto de touchplay (overlay en partido, joystick, botones, pausa) pasa.

## De players (pulido ola 1), 2026-11-07
- **CONTRACT §4.4** (añadidos opcionales de players): `VB.Players.drainFx(out)` → `{type:'highfive'|'fistbump'|'chestbump'|'clap', team, x, y, z,
  strength}` (contactos cosméticos de la celebración, coords de la sim, un evento por contacto); `VB.Players._marker()` (pruebas: estado del galón
  del jugador controlado); campos del rig de solo lectura `aMode/aw0/aw1`, `hipYaw`, `pdW`, `diveTc`, `vh`. `offX/offY` incluye también la
  convergencia de la pareja tras el punto (la raíz y las partes del cuerpo ya lo llevan: `rigOf`/`handWorld` siguen siendo la verdad visual).
- **Cableado (opcional, si más de un módulo quiere los contactos)**: hoy solo audio los necesita y puede vaciar la cola él mismo
  (notes/audio.md). Si también FX/UI los quieren, que main.js los vacíe una vez justo después de `Players.update` y los añada al array del frame
  (los módulos que van detrás —FX, cámara, audio, UI— los verán como eventos):
  ```js
  // main.js, tras call('Players', 'update', g, gdt, ev):
  if (VB.Players && VB.Players.drainFx) { var pfx = VB.Players.drainFx([]); for (var i = 0; i < pfx.length; i++) { pfx[i].t = g.time; pfx[i].type = 'fx:' + pfx[i].type; ev.push(pfx[i]); } }
  ```
  (en ese caso audio leería `ev[i].type === 'fx:highfive'…` en vez de llamar a `drainFx`).

## De camera_input (pulido ola 1, 2.ª pasada, 2026-11-08)
1. **CONTRACT §4.4** (añadidos opcionales de camera.js): `VB.CameraRig.heroShot()` → `null` o `{heroId, mateId, team, camX, camY, hx, hy,
   heroYaw, conv, mx, my, mateYaw, t}` (coreografía del plano de héroe; solo en `g.mode === 'point'`; objeto reutilizado, no modificar) y
   `VB.Players.heroShotAware` (players: la convergencia la sigue; ver notes/players.md). Convención de cámara: «el plano de héroe dicta la
   coreografía de la celebración: el que anota, de cara a la cámara; el compañero llega por detrás».
2. **CONTRACT §6**: `tools/camtest.js` admite ahora `PAGE_ROOT=carpeta` (otra copia del proyecto), `DIFF=nivel`, la comprobación `scorer` y el
   criterio `hero` agregado por tamaño.
3. **touchplay.js (informativo, tuyo)**: «tocar NIVEL cambia la dificultad (easy → easy)» falla en los dos tamaños: el toque en el CENTRO de
   `#optDiff` cae ahora en la flecha «‹» (UI-06), que en Fácil no baja más. No es input.js (el `pointerdown` de captura solo mira el
   overlay). O el test toca `.mv-val`/la flecha «›», o la fila deja el centro para el ciclo.

## Pulido ola 1 — ui_main (2026-11-08, PC de casa, RTX 3060 Ti): UI-01…UI-08
Todo medido con GPU real; scripts de prueba en `tools/out/ui1/` (no se suben). Interfaces de CONTRACT intactas; solo añadidos opcionales.

### UI-08 · perfiles de Chrome que se quedaban en %TEMP%
- `tools/cdp.js`: `close()` mata el árbol de Chrome y borra el perfil `vb3c-*` de forma SÍNCRONA con hasta 5 reintentos (200, 400… ms; Windows
  suelta los ficheros con retraso) y otra vez tras el evento `exit` de Chrome (devuelve esa Promise); `open()` barre los `vb3c-*` de más de 1 h
  (como mucho 1,5 s por arranque; `VB_NOSWEEP=1` lo desactiva; `VB_PROFDEBUG=1` dice «borrado / NO borrado»). `shot(file, clip)` admite recorte.
- Medido: `console.sh all` (1280×720), `TOUCH=1 console.sh all 844 390` y `node tools/perf.js` → los tres «perfil … borrado»; lista de `vb3c-*`
  idéntica antes y después.
- **Para el integrador (CONTRACT §6)**: «Las herramientas de DevTools (`tools/cdp.js`) crean un perfil temporal `vb3c-*` en %TEMP% y lo borran al
  cerrar (síncrono, 5 reintentos, y otra vez tras el `exit` de Chrome); al abrir barren los de más de 1 h. `VB_PROFDEBUG=1` informa.»

### UI-01 · sin parón en el primer peloteo
- main.js: programas precompilados EN PARALELO bajo el telón (`KHR_parallel_shader_compile`: escena + `VB.Arena.prewarmList()` con las luces y el
  destino de render reales, sombras y pasadas del post de arena; sin la extensión, `VB.Arena.prewarmCompile()`), y otra vez al empezar partido.
- Nuevo `warmDraw()`: con los programas ya enlazados, UN render con todo visible y sin recorte por cámara justo antes del primer frame (ANGLE/D3D11
  compila en el primer DIBUJO la variante de cada programa: eran los frames de 40-55 ms al empezar el partido). 25-110 ms bajo el telón.
  `&warmdraw=0` lo desactiva; `ctx.prewarmInfo()` añade `drawMs`.
- ui.js: **ensayo de estilos del HUD** (`gym`): tras el enlace de programas y aún con el telón, se pintan una vez (con el fondo del telón al 99,5 %,
  invisible) todos los estados del banner, la pestaña de punto, el aviso (con las teclas de teclado, mando y táctil), el consejo, la tarjeta
  guiada, el contador y (en táctil) los controles de input.js con sus estados, que luego se devuelven tal cual. Motivo medido con trazas: la primera vez que Chrome pinta una sombra con desenfoque (p. ej. el brillo de la tecla de
  «¡Golpea ahora!») Skia compila ~15 shaders en el proceso de GPU = un frame de 45-70 ms con el JS del frame en 1 ms. Con el ensayo: 0 tareas
  de compilación y raster de 3 ms. Notas: bajo una capa opaca Chrome no rasteriza; con `.warm` (opacidad .01 en cada descendiente) o 1/255
  tampoco; encima del telón al 3 % se veía. `VB.UI._gym()` (pruebas).
- Medido (`tools/out/ui1/u1.js`, partido real con el bot «perfecto» de simtest, gesto previo en el menú; CPU del PC 42-45 %):
  MENUWAIT 3000 y 15000 → 1 programa nuevo tras `startMatch` (sombra, 0,9-1,2 ms; ninguno > 8 ms); mayor hueco de frame en los primeros 60 s
  **24,2 ms** en los dos (antes 55-85 ms al empezar y 55-73 ms en el primer «¡Golpea ahora!»). `feel.js NOCAST=1` 62 s: mayor hueco 26 ms.
  Móvil emulado 844×390 táctil: mayor hueco 30 ms (antes 121-133 ms en el primer frame del partido, raster de los controles táctiles).
  `prewarmMs` 72-122 ms (antes ~40-53). Con la máquina saturada por otras pruebas (CPU 84-100 %) salen huecos de 250-480 ms sin ningún
  evento: no son del juego, hay que medir con el PC tranquilo.
- Ojo: el primer `AudioContext` cuesta 50-64 ms en este Chrome (constructor). Pasa en el primer gesto (menú), no al empezar partido.

### UI-02 · un solo árbitro de capas de texto
- banner/pestaña > tarjeta guiada > aviso corto > aviso de golpe > consejo; como mucho 2 a la vez. Un punto quita al momento guía, consejo y aviso;
  la guía y el consejo esperan a que no haya banner (también «SET n» y punto de set); con la guía no hay consejo.
- Medido (DOM cada 100 ms, `debug=rally&live=1&guide=1`, 120 s): 1280×720 y 844×390 táctil → 0 muestras con banner + guía, 0 con más de 2 capas.

### UI-03 · presentación del punto por niveles (`point.highlight`)
- Nivel 1 (trámite): pestaña del color del equipo que sale de detrás del marcador, junto a su fila («Remate», «Error de la CPU»…), ~1 s; segunda
  línea solo si informa: la llamada del árbitro TAL CUAL y sin pasarla a mayúsculas («Dobles: el mismo jugador toca dos veces», «Falta de saque: 8
  segundos», «Ataque sobre el saque», «Toque de red», «Balón toca la antena»…). Chip «⇄ Saque» con cambio de saque.
- Nivel 3 (set/partido) se coloca arriba, a media altura o en el tercio inferior, donde menos tape al héroe y nunca sobre el marcador.
- Nivel 2 (bloqueo, ace, jugada ≥ 10 toques, racha tuya de 3 o 5, punto de set salvado o `highlight ≥ 0,55`): cinta tras el corte al plano de
  reacción, en el tercio inferior (izq./dcha.) en escritorio y en la franja alta en táctil/alto ≤ 560 px, en el sitio que no tapa `pf.hero` /
  `pf.vic`; la misma cinta no se repite dos puntos seguidos (2.º ace del mismo equipo → pestaña). Nivel 3 (set/partido): centro, tras el héroe.
- Calibrado con la sim (`tierstat5.js`, 16 partidos por nivel): cinta grande en el 32,5 % (Fácil), 28,5 % (Normal), 27 % (Difícil) de los puntos.
- Medido: timeline de 120 s → 25 % con cinta, 0 subtítulos repetidos seguidos; `REF=1 pres.js` (motivo y texto del árbitro inyectados en puntos
  reales) → los 10 textos salen idénticos; 10 puntos a 1280×720 y 9 a 844×390: la cinta no corta las cajas del héroe ni de la víctima; titular
  44 px (40 px el largo) a 844×390 y 59-69 px a 1280×720. Los tres textos fijados por Ferran siguen en sim.js tal cual.

### UI-04 · banners al ritmo de los cortes; la pausa los quita
- Con `CameraRig.getDebug()` (`cutN`, `nextCutIn`, `lastCut`, `ccU`): la cinta del punto entra con el corte al plano de reacción y se funde en
  120 ms justo antes del corte de vuelta; «Cambio de campo» entra rápido (visible del todo a 0,09 s del plano `court`) y se va con `ccU` ≈ 0,88;
  «Set para ti» solo en el plano de reacción; **nuevo**: «Set 2» entra en la bajada de la grúa (ccU ≈ 0,9) y ya no se repite con el `newSet`.
- Pausa: banner, pestaña y aviso corto ocultos (también los que llegan con la pausa ya puesta, p. ej. `debug=pause`); al volver solo reaparecen si
  les quedaban > 0,4 s. `VB.UI.bannerRect()` → rect en px CSS o null (para CAM-18). `VB.UI.onHoldSkip()` (ver SIM-03 abajo).
- Medido (`seqcheck.js`, por frame): 8 cortes punto→saque con 0 frames de banner/pestaña del punto después; set: «Cambio de campo» 0,088 s,
  fuera con ccU 0,884, «Set para…» con ccU > 0,2: 0. `debug=pause`: banner y pestaña con opacidad 0.

### UI-05 · el aviso del saque enseña el momento bueno, y reloj de 8 s
- Balón subiendo: sin tecla (reloj de arena) y «Espera… golpea al bajar» con una barra que se llena hacia una muesca fija; la barra usa el mismo
  reloj que el brillo de SACAR y el aro (`hitWindow().press`, que cuenta de forma continua hacia el contacto de bajada). Tecla encendida y
  «¡Golpea ahora!» solo en la ventana (−0,15, 0,24).
- Reloj: aro alrededor de la tecla los últimos 5 s (ámbar; rojo en los 2 últimos), con un latido en cada segundo de los 3 últimos a la vez que el
  «toc» de audio.js; «Saca ya 3 s» con la cifra y la unidad sin mayúsculas. «Falta de saque: 8 segundos» intacto.
- Medido: novato que pulsa 200 ms después de ver cualquier tecla → 11 de 11 saques «perfect», 0 «Saque a la red»; captura a mitad de lanzamiento
  sin tecla; `clock.js` a los 3, 5 y 7 s: aro = reloj ±0,02 s, sin «N S».

### UI-06 · flechas de dificultad
- ‹ baja y › sube (zonas propias de 46×44 px en táctil, 36×54 en escritorio, chevrons SVG), sin dar la vuelta (rebote y sonido en el tope);
  el resto de la fila sigue avanzando; el valor entra deslizando desde el lado de la flecha. ←/→ del teclado igual. `drive.js` y
  `touchplay.js` (actualizado: toca › y ‹ y comprueba ≥ 44×44) TODO OK.

### UI-07 · arranque con marca
- Script en línea en index.html (tras `#boot`, antes de three.js): pide la fuente del logotipo desde el primer instante (tope 2,5 s desde la
  navegación) y avisa con `window.__vbFonts` / `window.__vbOnFonts`. main.js deja pintar UN frame con el logotipo antes del arranque pesado
  (tope 350 ms; en depuración, sin esperar).
- El telón usa el mismo marcado/CSS que `.logo` del menú; el logotipo se funde al llegar la fuente (animación de opacidad: la mueve el compositor) y,
  con la escena lista y el ensayo de estilos hecho (tope 0,9 s), vuela con FLIP (solo transform, 0,64 s) a su sitio en el menú mientras el menú
  entra en cascada (ya se puede pulsar); al aterrizar lo releva el del menú en el mismo frame. El arco punteado y el brillo no se animan mientras
  vuela (son animaciones de pintado). Movimiento reducido: fundido de 150 ms.
- Medido (`bootseq.js`, muestreo cada 50 ms + fotogramas reales): 0 muestras con dos logotipos; el primer frame con logotipo ya lleva la fuente;
  menú pulsable a 2,60-2,73 s con Google Fonts bloqueado (antes 3,5-3,8 s) y a 2,6 s normal y a 844×390.

### SIM-03 aplicado (petición de sim)
- main.js: `present: !opts.autopilot` en `startMatch`; GOLPEAR/SALTAR durante la pausa del punto llama a `Sim.skipHold(g)` (consume el flanco) y
  avisa a `UI.onHoldSkip()`.

### Para el integrador
- CONTRACT §4.1: `ctx.prewarmInfo()` (`{n, total, issueMs, waitMs, pending, drawMs}`); §4.4: `VB.UI.bannerRect()`, `VB.UI.onHoldSkip()`,
  `VB.UI.bootReady(bootEl)` (main.js), `VB.UI._gym()` (pruebas); §6: nota de perfiles de UI-08, `&warmdraw=0`, `&prewarm=sync`.
- notes/camera_input.md: `navigator.vibrate` sin gesto previo deja un error de consola (propuesta de guarda con `navigator.userActivation`).
- Parámetro nuevo `&bootwait=0` (main.js): arranca sin esperar a pintar el logotipo del telón (pruebas A/B del arranque).

## Aplicado (log, integración del pulido ola 1, 8-nov-2026, PC de casa)
- main.js: tras `Players.update`, `VB.Players.drainFx(PFX)` y cada contacto se añade al array del frame como `fx:<tipo>` (con `t`);
  si el frame no traía eventos se usa `frameEvents` en vez de `EMPTY`. Lo consumen audio (palmada/puños); los demás lo ignoran.
- touchplay «NIVEL»: ya resuelto por UI-06 (touchplay actualizado, TODO OK).
- CONTRACT: §4.1 `prewarmInfo()` y parámetros `&warmdraw=0`, `&prewarm=sync`, `&bootwait=0`; §4.4 `bannerRect`, `onHoldSkip`,
  `bootReady`, `_gym`; §5 `skipHold` y `fx:*`; §6 perfiles `vb3c-*` de cdp.js y camtest.

## Pulido ola 1 — arreglos de ui_main tras la verificación (2026-11-08, PC de casa)
Scripts y capturas en `tools/out/ui2/` (no se suben).
- **Saque en el móvil (aviso arriba que tapaba la red)**: en táctil ya no hay consejo arriba durante el saque. Los dos saques van en el
  aviso de abajo, junto al sacador, en una rejilla de 2×2 (`#prompt.two`): la tecla SACAR de siempre (`#promptKey`, la que leen los bots)
  con «Flotante» y la tecla SALTAR con «En salto». Mide 131×48 px a 844×390. La red y los receptores quedan libres (`serve_after2.png`,
  `z_chip5.png`). Cuando empieza el reloj, vuelve a la línea única «Saca ya 3 s» con el aro (clock.js táctil: TODO OK). El aviso anclado
  esquiva también el joystick por la izquierda, igual que ya esquivaba los botones por la derecha. Las teclas táctiles tienen más contraste
  (blanco con sombra). En tabletas (táctil y alto > 560 px) el aviso anclado es más grande.
- **3 capas de texto en el primer remate guiado**: el árbitro no contaba la tarjeta guiada cuando el balón le pasaba por detrás (`show thru`:
  comparaba `className === 'show'`). Además, un aviso de golpe «go» («¡Salta!», «¡Golpea ahora!») corta el elogio del toque anterior
  («Colocación perfecta») si ya hay tarjeta o banner. Medido: `layers.js` (debug=rally&live=1&guide=1, 120 s), 1280×720 y 844×390 táctil
  → 0 muestras con banner+guía y 0 con más de 2 capas. Dos partidos humanos reales de 300 s (play3 del verificador, primer partido, 844
  táctil y 1280 teclado): 0 muestras con más de 2 capas y ningún «TRI».
- **Ritmo de las cintas grandes**: como mucho una cada 3 puntos. Excepciones: highlight ≥ 0,8, punto jugado con punto de set o de partido
  (se lee de `serveReady`) y punto de set salvado. `tierstat6.js` usa los bots humanos de simtest contra la CPU, 6 partidos por casilla.
  Antes, del 23,9 al 52,5 % (perfecto en Fácil: 52,5 %; bueno: 33,7-47,7 %). Ahora, del 18,0 al 31,1 % en todas las casillas, también
  con autopilot (21-22 %). Partidos reales: 17,9 % (844 táctil) y 14,3 % (1280).
- **Ace que acaba en «Balón a la red»**: si sim trae un texto del árbitro (red, antena, dobles, 8 s, «… a la red»), ese texto es el
  subtítulo y sustituye a «La CPU no controla la recepción». Comprobado inyectando el evento: la pestaña muestra «¡Ace! / Balón a la red».
- **Reglas (paso 6)**: añadidas «Falta de saque: 8 segundos» y «Ataque sobre el saque» con la redacción fijada. Lista reordenada por
  parejas: Fuera/Antena, Red/4 toques, Dobles/Cuerpo, 8 s/Ataque sobre el saque, Cambio de campo/Sets. Fichas algo más compactas: a
  1280×720 cabe sin desplazar (685/685).
- **UI-07**: `document.fonts.check()` no prueba nada (da true sin ninguna cara). Ahora el script en línea deja `window.__vbFontFaces`, el
  número de caras cargadas de verdad. La comprobación buena recorre `document.fonts` buscando Barlow Condensed 900 italic con
  `status === 'loaded'` (`bootseq2.js`). Con la red normal sale true en el primer frame con logotipo (3 de 3, 4 caras). Con Google Fonts
  bloqueado sale false y 0 caras, como debe ser. El ensayo de estilos pasa de paso cuando hay 2 frames fluidos y han pasado 50 ms (antes 3
  frames y 70 ms). Menú pulsable a 2,80-3,18 s con el PC al 43-79 % por otras pruebas. El margen sigue siendo justo. Perfil del arranque
  (`bootprof.js`): el hilo principal está ocioso 2,4 de 3,8 s. Lo que manda es la compilación en paralelo de los 39 programas en la GPU
  (~1,05-1,1 s, todos de la escena; la lista de `prewarmList` no añade ninguno, A/B medido) y el primer paso del ensayo (~430 ms de
  raster/Skia). Aplazar `prewarmList` no gana nada.
- **Chrome huérfano**: `cdp.js` tiene ahora `killOrphans(maxAgeMs, dry)`. Busca procesos de navegador con un perfil `vb3c-*` en los que
  el proceso y la carpeta tengan más de 1 h, y los cierra con `taskkill /T /F`. `sweepProfiles` lo llama si un perfil viejo no se deja
  borrar, o una vez por hora (marca `%TEMP%/vb3-orphans.stamp`). Nuevo `node tools/clean.js` (`DRY=1`, `AGE=min`) para hacerlo a mano.
  En la primera pasada cerró los 3 huérfanos (`vb3c-aULURv` del 6-nov, `cydPCB`, `sW6w78`) y borró la carpeta del 7-nov.
- Regresión: `console.sh all` (1280 y 844 táctil) sin errores; drive/touchplay TODO OK. padplay TODO OK en 3 de 4 pasadas: la otra, con
  el PC cargado, dio «1 FALLOS» y no se vio cuál. perf 844×390: baja 100,8 fps, 34-39 draw calls y 87 k triángulos; media 95 fps y
  196 k; «objetivos cumplidos». u1 (UI-01): hueco máximo de 36 ms en los primeros 60 s (< 50). simtest rápido TODO OK.
- **Para el integrador (CONTRACT §6)**: `tools/clean.js` (ui_main) y `killOrphans` en cdp.js. `window.__vbFontFaces` (index.html).
- **Visto, no es de ui_main**: en partidos humanos sale a veces «Falta de saque: el balón cae sin golpearlo» también en el saque de la CPU
  («Error de la CPU», w2k1280). El verificador ya tiene `srvdrop.js`. Para sim/ai: mirar si la CPU puede dejar caer su propio lanzamiento
  cuando el PC va cargado.

## Aplicado (log, integración del pulido ola 2, 8-nov-2026, PC de casa)
- CONTRACT §4.1 `window.__vbFontFaces`; §6 `killOrphans(maxAgeMs, dry)` de cdp.js y `node tools/clean.js`; §4.4 «pulido ola 2» (aviso de saque táctil
  `#prompt.two`, ritmo de cintas grandes 1 de cada 3).
- Petición opcional de camera_input aplicada en ui.js + index.html: el marcador se atenúa (`#sb.dim`, hijos a 0,38) durante el plano de héroe
  con el que anota a la izquierda (`getDebug().pf.heroX < -0,5`).
- Tu aviso para sim/ai (la CPU deja caer su propio lanzamiento): ARREGLADO en sim.js. Causa: el desfase tardío del saque de la CPU
  (`aiServeTe`, hasta +0,25 s en Fácil de primer partido) pasaba del final de la ventana de `canReach` (~−0,23 s): la CPU esperaba y el
  balón caía. Tope tardío a 0,2 s. `srvdrop2.js` del verificador: 13 caídas en 5880 lanzamientos → 0 en 5880. Nueva comprobación en simtest.
- `tools/padplay.js`: «se juegan puntos (0)» fallaba 2 de 3 veces porque un peloteo largo del bot contra la CPU llenaba los 30 s sin punto
  (sonda: peloteo de 19 s y 13 toques, todo normal). Ahora la fase de juego se alarga hasta 25 s más mientras no haya habido punto. 3 de 3 TODO OK.
- `w2k1280.txt`/`w2k1280.an.txt` (sueltos en la raíz del repo) movidos a `tools/out/int-w2/`.

## De audio (pulido ola 2, AUD-06, 8-nov-2026): sonido de la cortinilla (UI-13) y de la presentación (UI-14)
Todo ya existe en `js/audio.js` (opcional, con guarda; antes del primer gesto son no-ops sin error; medido con `node tools/audiotest.js`).
- **Cortinilla (UI-13)** — llamar UNA vez al EMPEZAR la cortinilla de 0,3 s centrada en el corte (cuando `0 < nextCutIn <= 0.15`):
  ```js
  try { if (VB.Audio && VB.Audio.ui) VB.Audio.ui('wipe'); } catch (e) { }
  ```
  Soplido de aire filtrado que cruza de izquierda a derecha (el paneo va en el propio sonido) con el pico a 0,15 s, justo en el corte, y un
  golpe de aire grave muy suave en ese instante. Bus de interfaz (no le afecta la pausa ni la cámara lenta). Anti-repetición 0,25 s: si
  se llama también al salir de la cortinilla, la segunda llamada no suena. Nivel -25 LUFS (casi cada punto: discreto); pico real -12,7 dBTP
  sobre la grada. **Si la cortinilla barre de derecha a izquierda, decídmelo** y la invierto (hoy siempre izquierda → derecha).
- **Presentación (UI-14)** — al MOSTRAR la tarjeta (después del `newMatch` del primer frame o antes, da igual):
  ```js
  try { if (VB.Audio && VB.Audio.sting) VB.Audio.sting('intro'); } catch (e) { }
  ```
  Firma suave (campanas La-Re-Mi que se posan en Fa# sobre Re con novena, ~2,7 s) + crescendo de grada (~3,6 s) y el lecho de grada
  agachado -7 dB bajo la tarjeta (vuelve solo a los 3 s). La ovación de bienvenida de `newMatch` se cancela sola si la presentación llega en
  el mismo frame o antes (el crescendo ES la bienvenida). Al QUITAR la tarjeta:
  ```js
  // se va sola o con el gesto de continuar: el lecho vuelve, nada se corta
  try { if (VB.Audio && VB.Audio.ui) VB.Audio.ui('introEnd'); } catch (e) { }
  // si la SALTAN (GOLPEAR/Intro/toque nada más salir): grada y firma se apagan en ~0,5 s
  try { if (VB.Audio && VB.Audio.ui) VB.Audio.ui('introSkip'); } catch (e) { }
  ```
  Sin llamadas de cierre también funciona: el primer silbato del saque suelta la presentación, y a los 6,5 s se suelta sola.
  `VB.Audio.introInfo()` → `{active, t}` (s desde que empezó) por si la tarjeta quiere sincronizarse con la firma (el acorde entra a 0,52 s).
- **«El primer silbato cae en la entrada del marcador» (AUD-06)**: el silbato es el de la sim (`whistle` `reason:'serve'`, 0,7 s de juego
  después del `serveReady`). Para que caiga justo al asentarse el marcador: si la sim sigue corriendo bajo la tarjeta, que la entrada del HUD
  EMPIECE con `serveReady` + ~0,25 s y dure ~0,45 s (acaba en el silbato); si la sim está congelada bajo la tarjeta, que la entrada del HUD
  empiece al descongelar y dure ~0,7 s con salida suave. En los dos casos llamad `ui('introEnd')` al empezar la entrada del HUD.
  **Medido en la partida real** (`tools/out/aud-w3/liveintro.js`, llamando a `sting('intro')` justo tras `startMatch`): hoy la sim sigue
  corriendo y el silbato llega a los 0,7 s, así que suelta la presentación a los 0,7 s, con la tarjeta (si fuera más larga) aún en pantalla.
  **Recomendado**: congelar la sim bajo la tarjeta (el primer saque espera a que se vaya), y así el pitido cae justo con el marcador.
- Nombres desconocidos en `VB.Audio.ui(kind)` ya NO suenan como un clic (antes cualquier nombre nuevo daba un clic): `ui()` sin argumento
  sigue siendo el clic. Para AUD-08 (ola 3) diré los nombres de la pantalla final.

## Pulido ola 2 — ui_main (8-nov-2026, PC de casa, RTX 3060 Ti): UI-09…UI-16
Todo medido con GPU real; pruebas en `tools/out/w2/` (no se suben). Interfaces de CONTRACT intactas; solo añadidos opcionales.

### UI-16 · Ajustes > Accesibilidad
- `ctx.settings` nuevos (persistidos y validados en `loadSettings`): `camStable` (false), `rumble` (true; input.js ya lo respeta), `hudScale`
  (1 | 1,15 | 1,3; otro valor → 1), `softFlash` (false). Filas «Cámara estable», «Vibración», «Tamaño del HUD», «Destellos suaves» bajo el rótulo
  «Accesibilidad» (y «Juego» encima del resto). En pantallas ≥ 1000×600 los ajustes van a dos columnas (Juego | Accesibilidad) sin desplazar.
- Tamaño del HUD: variable `--hs` en `#app` (propiedad `scale` en marcador, contador, consejo, aviso, sello, indicador, botones; `zoom` en el
  subtítulo/chip del banner). Las hojas (pausa, final, paneles) llevan `zoom` = `--hs` como mucho lo que quepa en alto y ancho (`fitSheet`:
  los botones nunca quedan bajo el pliegue). Con el HUD grande, si el contador de toques entero pisaría el marcador solo rotula el toque activo
  (`.tb-compact`) y la franja alta (contador, consejo) se corre a la derecha del marcador (`--fx`, `fitX`).
- `tools/out/w2/a11y.js`: teclado (↓/→/Intro), mando (`UI.nav`), toque (130 % en táctil), persistencia, valores corruptos → TODO OK;
  130 % a 844×390 y 667×375 (rally, serve, spike): marcador, contador y botones táctiles sin solapes.
- Pendiente de camera_input (notes/camera_input.md): con `camStable` el temblor debe ser 0 (hoy 30 %).

### UI-12 · Capa de pantalla: viñeta en media/baja y pulso de impacto
- `#veil .vg`: viñeta CSS con la misma curva que el post de alta (paradas calculadas de `smoothstep(1.25,0.25,r)` al 0,32 en lineal → sRGB),
  solo con `VB.Arena.postActive() === false` (comprobado en `setQuality` y cada 32 frames); se quita bajo las hojas (pausa, final, paneles).
  `&vig=0` la desactiva (A/B). Medido (`tools/out/w2/vig.js`, 1280×720 rally, esquina 0,600-120,720): media/baja −15,5 %, alta (post) −12,8 %
  (+1,8 % del velo de siempre en las dos).
- `#veil .vp`: pulso del color del equipo 0 → 0,35 → 0 en 120 ms (Web Animations, opacidad) con remate perfecto o bloqueo directo del humano
  y en el punto que gana el partido (dorado si es tuyo). No con movimiento reducido ni «Destellos suaves». `pulse.js`: > 0,2 a los 40 ms y 0
  a los 200 ms; golpe bueno y destellos suaves: 0.

### UI-09 · Sello de calidad en el punto de contacto
- `#stamp`: «PERFECTO» dorado / «BIEN» blanco + «un pelín pronto/tarde» (|timing| > 0,03 s). Sale a ~72 px del contacto en la dirección que
  menos estorba (8 candidatas; se proyecta el vuelo del balón a 0,1/0,2/0,3 s, el cuerpo del que golpea, el marcador y los bordes), sube 30 px
  y se funde en 0,6 s (Web Animations, transform/opacidad; posición por frame siguiendo el punto del mundo). Nada en golpes flojos ni en el
  balón libre. Ya no sale «Recepción perfecta» etc. en el aviso de arriba a la izquierda: el lector de pantalla lo oye por `#srLive`
  (aria-live polite). Cuenta como aviso corto en el árbitro de capas (UI-02). `&stamp=1`: también con el autopilot (pruebas).
- `stamp.js` (vivo, autopilot, 45 s): 10-13 sellos a 1280×720 y 844×390 táctil: centro a 63-74 px del contacto a los 100 ms; separación
  mínima con el balón a los 200 ms 52-96 px.

### UI-15 · Peloteo largo
- Chip «PELOTEO · N» bajo el marcador desde el toque 8 (`g.rally.hits`, la misma cuenta que `point.rallyHits`); late en cada toque; desde 15 en
  naranja; al acabar la jugada se queda 1,5 s en dorado con la cuenta final. Cinta de nivel 2: «¡Peloteo de N toques!» (antes «Jugada de N
  toques»; ahora va antes que la racha). `rally.js` (seed 5, jugada de 18 toques, 667×375 táctil): chip en el 8, 8→18 de uno en uno, sin
  pisar el contador, cinta «¡Remate! / ¡Peloteo de 18 toques!».

### UI-10 · Indicador de borde
- `#offArrow`: insignia del color del equipo con el dorsal y una flecha. Fuera de cuadro (cabeza fuera o detrás de la cámara): en el borde,
  en la recta centro → jugador; solo cortado (pies a < 40 px de los bordes laterales/superior, o rodillas cortadas abajo, 0,3 s seguidos): en el
  borde más cercano a los pies, a un lado del jugador, apuntándole. Se aparta (tramos libres del borde) del marcador, botones del HUD y
  controles táctiles. 120 ms de fundido; solo en `serve`/`rally`, nunca durante la presentación. `offarrow.js` (cámara congelada y girada,
  54 encuadres por tamaño): 1280×720, 844×390, 667×375 → visible en 44-50, ángulo 0° de la recta, 0 solapes; con el jugador en cuadro, oculto.

### UI-13 · Cortinilla de marca
- `#wipe`: cinta sesgada del color del equipo que anota (o de la casa) con el sello «Palau del Mar». Cortes punto → saque / cambio de campo:
  cubre en 75 ms contados con `nextCutIn` (del todo en el frame del corte) y se va en 85 ms; el corte de reacción y los del cierre, secos.
  Transiciones de pantalla de 450 ms con la acción a mitad: menú → partido (también revancha, «Jugar ya», tutorial, reiniciar), partido → final y
  final/pausa → menú. Movimiento reducido: fundido de 150 ms. `VB.Audio.ui('wipe')` con `nextCutIn ≤ 0,15` o al empezar. `VB.UI.wipe(team, cb)`.
- `wipe.js` (80 s): 3/3 cortes al saque cubiertos al 100 % en su frame, 127-134 ms en pantalla, reacción seca, 0 frames > 33 ms.

### UI-14 · Tarjeta de presentación
- main.js: `startMatch` (partidos humanos; en depuración con `&intro=1`; `&intro=0` la quita) muestra 2,5 s de tarjeta con la sim PARADA: los
  eventos iniciales salvo `newMatch` se retienen y se entregan al acabar; el mundo se anima con dt real. `ctx.introLeft`, `ctx.introSkipReq`.
  Cualquier botón (golpear, saltar, cambiar, pausa, aceptar), tecla o toque la salta en el frame siguiente (el botón no golpea ni pausa).
  Llama con guarda `VB.CameraRig.playIntro(2.5)` (y `playIntro(0)` si se salta) y `VB.Audio.sting('intro')`.
- ui.js: «Palau del Mar · Vóley · 2 contra 2», «TÚ + compañero vs CPU», chip del nivel, «Al mejor de 3 sets», quién saca, pista del
  dispositivo y barra de 2,5 s. Sin marcador, consejo ni aviso (ni el banner «Set 1», ni el indicador de borde) hasta el primer silbato; el
  marcador entra deslizando 0,25 s después de irse la tarjeta (`ui('introEnd')`; `ui('introSkip')` si la saltan). Movimiento reducido: fundido.
- `intro.js` (1280×720 y 844×390 táctil): tarjeta de 0,06 a 2,4 s, 0 frames con consejo/aviso de 0 a 3 s, tecla y toque la quitan en el
  mismo frame, saque autorizado saltándola 699-701 ms tras la tecla (sin tarjeta: 702-703 ms).

### UI-11 · Hoja final
- MVP de cada equipo (puntos de ataque + bloqueo + aces atribuidos al jugador: último que golpeó del equipo que anota, sacador o bloqueador;
  los errores del rival no son de nadie), cifras con cuenta de 600 ms (rAF, cifras tabulares), sets en tira.
- Escritorio (≥ 1000 px): hoja acoplada a la izquierda (como el menú, sin desenfoque) y `ctx.uiDock = {side:'left', frac}` para CAM-10; llega
  con la cortinilla al `gameOver`. Móvil: la hoja espera a `clinchLeft() = 0` y ≥ 2,5 s desde el punto que gana el partido (cualquier botón o
  toque lo adelanta tras 0,8 s); «Ver celebración» aparta la hoja y «Ver resultado» la devuelve. «Revancha» a lo ancho y debajo los otros dos a
  partes iguales (también en escritorio). Se quitó la celebración vieja de 3,6 s (la pausa de 4,2 s de sim ya la da).
- main.js: GOLPEAR, SALTAR, CAMBIAR o ACEPTAR recortan la pausa del punto (`Sim.skipHold`), también la del punto final.
- `endtest.js`: MVP = puntos contados (#11 26, #9 17), suma por jugador = ataque + bloqueo + aces (44 / 27), hoja estable con la cuenta,
  acoplada a 1280 (`frac` 0,472), a 844×390 botones en 2 filas (166/166 px); con `&hold=1` la hoja sale a los 2,9 s; Intro recorta la pausa
  final en 5-11 ms.

### Herramientas
- `tools/cdp.js`: Chrome con `--remote-debugging-port=0` y el puerto leído de `DevToolsActivePort` (con puerto al azar, dos herramientas en
  paralelo podían conectarse a la pestaña de la otra: capturas con el tamaño ajeno). `VB_ROOT=carpeta` abre otra copia del proyecto.
  `page.frames(ms, {dir, start})`: fotogramas reales del compositor (Page.startScreencast) para mirar movimiento.
- `tools/perf.js`: `EXTRA=params` de la página (A/B, p. ej. `EXTRA=vig=0`).

### Para el integrador (CONTRACT)
- §4.1: `settings.camStable/rumble/hudScale/softFlash`; `ctx.introLeft`, `ctx.introSkipReq`, `ctx.uiDock`.
- §4.4: `VB.UI.introStart(g)`, `introEnd(skipped)`, `wipe(team, cb)`, `_stamp()`, `_offArrow()`, `_wipe()`, `_wipeLog(on)`, `_endStats()`,
  `resize(w,h)`; main.js llama `VB.CameraRig.playIntro(s)` (0 = cortar).
- §5.3: tarjeta de presentación (sim parada, eventos retenidos); `skipHold` también con CAMBIAR/ACEPTAR.
- §6: `&intro=0|1`, `&stamp=1`, `&vig=0`; `tools/cdp.js` `frames()`, `VB_ROOT`; `perf.js` `EXTRA`.

## De camera_input (pulido ola 2, segunda tanda: CAM-08…CAM-14), 2026-11-08
Tus peticiones UI-14 (`playIntro`), UI-16 (`camStable` → temblor 0) y CAM-10 (`ctx.uiDock`) están hechas (ver notes/camera_input.md).
1. **Rótulo grande del set / partido durante el cierre (CAM-09)**: con `VB.CameraRig.getDebug().clinch.phase === 'hero'` la cámara hace una
   órbita cerrada de los ganadores con las cabezas justo bajo el centro de la pantalla (deja libre la mitad de arriba para el rótulo). Por favor,
   en `placeT3` usa en ese caso el hueco de ARRIBA (`Math.max(Math.round(H * 0.04), 8)`), no el de abajo. Medido con `tools/out/cw2/clinch.js` a
   844×390 táctil: el rótulo (161 px de alto) salía en el hueco de abajo, 130-291 px, que en un móvil apaisado es el centro de la pantalla, y tapaba
   las cabezas en 314-404 frames de la órbita. A 1280×720 sale arriba y no tapa nada (0 frames). Propuesta (en `placeT3`, antes del bucle):
   ```js
   var clH = d && d.clinch && d.clinch.phase === 'hero';
   if (clH) cands = [Math.max(Math.round(H * 0.04), 8)];   // órbita del cierre: la cámara deja la mitad de arriba libre
   ```
   Si el rótulo cambia de tamaño o de sitio, la cámara lo sigue (lee `VB.UI.bannerRect()` cada frame en la órbita: cabezas 0,12 NDC por debajo
   de su borde inferior si su parte de arriba está en el 20 % superior).
2. **Indicador de borde (UI-10) en planos cinematográficos**: en el cutaway del sacador rival se ve el «7» del jugador controlado en el borde
   derecho (captura `tools/out/cw2/seq/cw-01.png`), y en el seguimiento del cierre la «11» a la izquierda. Propuesta: ocultarlo cuando
   `VB.CameraRig.getShot()` sea `'clinch'`, `'cutaway'`, `'intro'`, `'point'`, `'court'` u `'over'` (solo tiene sentido en los planos de juego).
3. **Tipos de corte nuevos** (para la cortinilla de UI-13 y los rótulos): `lastCut.kind`
   - `'clinch'`: los dos cortes del cierre de set/partido (al seguimiento del balón y a la órbita): secos.
   - cutaway del saque rival: el corte que SALE del punto al plano del sacador es `'serve'` (es la vuelta al saque: cortinilla y rótulos con él) y
     la vuelta a la cámara de recepción ~1 s después es `'cutaway'` (seco, dentro del saque; por favor, sin cortinilla).
   - presentación: `'intro'` al entrar (desde el menú, seco) y `'serve'` al salir al saque (cortinilla).
   `nextCutIn` anuncia todos. `getShot()` puede ser `'cutaway'` (en `'serve'`) e `'intro'`.
4. Petición nº 5 (pies del defensor en `defend`): con CAM-13 la defensa que se acerca deja la cabeza del defensor y el rematador rival; los pies
   pueden salir por abajo a propósito en ese tramo (~1-1,5 s por ataque rival).

### Ola 2 — ajustes finales y problemas conocidos (ui_main)
- Cortinilla de corte por DEBAJO de los gráficos (`#wipe.cutw`, z 2: marcador, avisos y controles táctiles quedan encima, como en la tele); las
  de pantalla, por encima de todo (z 30). También tapa el corte que sale del punto hacia el plano corto del sacador rival (`lastCut.kind
  'cutaway'`, CAM-14) y los que salen del cierre (`from 'clinch'`); los `cutaway → serve` y `attack → clinch` siguen secos. Si el corte llega
  sin aviso (o tarde), la salida se alarga para que la cortinilla dure ≥ ~125 ms; un frame largo no se come la salida (avance máx. 22 ms/frame).
  `&wipe=0` la quita (A/B).
- Nada de desenfoques en capas grandes: el `box-shadow` de 60 px de la cinta y el `text-shadow` difuso del sello «Palau del Mar» costaban un
  frame de 30-42 ms en el primer corte (raster en la GPU). Sin ellos, 0 frames > 33 ms en la cortinilla a 1280×720 (3 escenas × 70 s).
- Ensayo de estilos (UI-01): añade sello, chip de peloteo, indicador de borde y la cinta (un cuarto de pantalla, paso 3). Con perfil
  nuevo ~1,2 s (caché de shaders fría), con la caché ya hecha ~480 ms los 5 pasos (antes ~430 el primero).
- **Problema conocido (táctil, 844×390 emulado a dpr 1)**: en el PRIMER corte al saque con cortinilla hay un frame de 55-61 ms ~25 ms después del
  corte (traza: `RendererRasterWorker` / `DoEndRasterCHROMIUM` 34 ms en la GPU). No pasa sin cortinilla (`&wipe=0`), ni ocultando los botones
  táctiles (`#touch .vt-btn{display:none}`), ni en escritorio; no cambia con la cinta debajo o encima de los controles, con `will-change` en
  `#touch`/`.vt-btn`, sin filtros ni transiciones en los botones, ni con un ensayo invisible de la cortinilla bajo la tarjeta. Los siguientes
  cortes van a 6 ms. Repro: `TOUCH=1 NOSHOT=1 node tools/out/w2/wipe.js 844x390 45 ""` (línea «serve intervalo/JS»). Para camera_input
  (input.js) si alguien quiere mirarlo: raster de los botones táctiles cuando la cinta pasa por debajo/encima en el primer saque.

## Aplicado (log, integración del pulido ola 2, segunda tanda, 8-nov-2026, PC de casa)
- Petición 1 de camera_input (CAM-09): en `placeT3`, con `getDebug().clinch.phase === 'hero'` el rótulo de set/partido va al hueco de ARRIBA
  (`max(round(H·0,04), 8)`). Además, si el rótulo ya estaba puesto cuando la cámara entra en la órbita, se recoloca en ese frame (`cam.clPh`), y
  `presUpdate` lee `getDebug()` también con `getShot() === 'clinch'` y en `g.mode === 'over'` (antes, en el cierre del partido `d` podía ser null).
  Medido con `tools/out/cw2/clinch.js`: 844×390 táctil set 3/3 y partido 2/2 con «rótulo sobre cabeza 0» (antes 314-404 frames); 1280×720 set 2/2.
  Secuencia mirada: `tools/out/int-w2b/seq/cl844-*.png`.
- Petición 2 de camera_input: el indicador de borde (UI-10) se oculta con `getShot()` `'clinch'|'cutaway'|'intro'|'point'|'court'|'over'`
  (`OFF_CINE`, leído en el propio `offTick`) y durante 0,35 s tras cualquier cambio de plano si no estaba ya visible. Además, en `serveUs` y `defend`
  (planos que cortan las piernas a propósito: cámara detrás del sacador; defensa que se acerca, CAM-13) solo cuenta «fuera de cuadro» (cabeza fuera),
  no «cortado» (`OFF_FEETOK`): a 1280×720 la insignia salía en el 85 % del saque propio (detrás del aviso «ESPACIO LANZAR») y en el 51 % de `defend`.
  `tools/out/int-w2b/offcine.js` (70 s en vivo): cutaway 0/30 visible; 1280×720 serveUs 118/139 → 9/139, defend 216/426 → 0/427.
- Arreglo: `gymEnd()` (fin del ensayo de estilos, UI-01) ya no borra la tarjeta de presentación ni una cortinilla en marcha. Si el partido empezaba
  antes de acabar el ensayo, la tarjeta de UI-14 no se veía nunca (`#intro` sin clase `show` con `introLeft > 0`). En la práctica el menú solo es
  clicable cuando el telón se va (y eso acaba el ensayo), pero `startMatch` desde herramientas o un telón lento lo disparaban. `introchk.js`: tarjeta visible.
- `tools/padplay.js`: «se juegan puntos» también vale con un peloteo vivo de ≥ 20 toques (`__pp.rally`). En 2 de 6 pasadas el bot de mando contra la
  CPU sostuvo un peloteo de 41 toques sin punto en 55 s; el juego seguía bien (toques, vibración, glifos).
- CONTRACT §4.1 (settings `camStable/rumble/hudScale/softFlash`, `introLeft/introSkipReq`, `uiDock`), §4.4 (UI-09…UI-16), §5.3 (tarjeta), §6 (parámetros).

## De camera_input (arreglos tras la verificación de la ola 2), 2026-11-08
- **tools/touchplay.js (flaky: saque táctil y ⇄)**: diff exacto en `tools/out/ci3/touchplay.diff` (copia entera en `tools/out/ci3/touchplay.proposed.js`;
  probada 3/3 a 844×390 y 1/1 a 667×375, 0 toques de ⇄ sin cambio). El saque apunta a `hitWindow().press` (antes `t − 35 ms`, ~35 ms tarde); ⇄ solo
  con `!g.jobs[0]` (la sim no deja cambiar si el equipo humano tiene tarea) y reintento a los 1,2 s si el toque no cambia.
- **tools/perf.js**: con el ui.js actual el modo por defecto sale con «no arranca el partido: menu» (`startMatch` ya no deja `'playing'` en el mismo
  tick). Esperar a `VB.ctx.state === 'playing'` con un sondeo de hasta 2 s. `SCENE=rally` va bien.
- Informativo: en el cierre del partido la cámara deja las manos levantadas de los ganadores ~3,5 % del alto bajo el borde inferior de
  `VB.UI.bannerRect()`; si el rótulo cambia de sitio o de alto, lo sigue sola.

## Arreglos de ui_main tras la verificación de la ola 2 (8-nov-2026, PC de casa, RTX 3060 Ti)
Pruebas y capturas en `tools/out/fx3/` (no se suben). Medido con el PC muy cargado por los otros arregladores (CPU 80-90 %, ~57 Chrome):
para comparar A/B se usó una instantánea estable (`VB_ROOT=tools/out/fx3/snap`, `sync.sh` copia mis 3 ficheros) y pasadas intercaladas.

### UI-07 · arranque: logotipo en el primer frame, menú pulsable antes y relevo en dos tiempos
- **Fuente embebida «VB Marca»** (index.html, script al principio, antes de la hoja de Google): dos recortes de Barlow Condensed (OFL 1.1)
  con SOLO las letras del telón: Black Italic «VOLEY3D» (1,1 KB) y Bold «PALU DEMR» (1,1 KB), en base64, registrados con `FontFace` antes del
  primer pintado. Los usan `.logo` (telón y menú) y el rótulo «PALAU DEL MAR». Nombre propio para no mezclar letras con la fuente de reserva
  en el resto de textos si Google Fonts falla. Resultado: el primer frame con contenido ya trae el logotipo entero, opaco y en su fuente,
  con o sin Google Fonts (`boot.js`: «first logo frame … logo1@1.00 … marcatrue "VB Marca"», 3/3 normal y con fonts.googleapis/gstatic
  bloqueados). Telón: logotipo y rótulo quietos desde el primer frame; solo la barra entra con un fundido de 0,4 s.
  Comprobación buena de la fuente: `document.fonts` con una cara `VB Marca` 900 italic en `status === 'loaded'` y
  `getComputedStyle(.bt-logo .lg-voley).fontFamily` empezando por `"VB Marca"` (`check()` no sirve: da true sin caras).
- **Sin esperas a Google Fonts para arrancar**: main.js arranca tras el primer frame (antes esperaba a la fuente: ~0,3 s). El script en
  línea del final avisa YA si la hoja de Google no ha cargado (no hay caras Barlow en `document.fonts`); si no, con las caras o a los 2,5 s.
- **Ensayo de estilos solapado con el montaje** (`VB.UI.preboot`): con el contexto WebGL ya creado, main.js monta el paso 1 del ensayo y deja
  UN frame antes de construir el pabellón: la GPU lo rasteriza mientras el hilo principal monta la escena. (Montarlo antes de crear el
  contexto retrasaba la creación ~0,65 s: comparten el hilo principal de la GPU; medido.) `ctx.bootInfo` = tiempos del arranque por módulo.
  `&preboot=0` lo desactiva (A/B).
- **Relevo en dos tiempos** (ui.js `tryReveal`): 1) MENÚ: el logotipo vuela a su sitio y el menú entra en cascada (pulsable) en cuanto la
  escena está pintada (`bootReady`: programas enlazados y primeros frames hechos) o como muy tarde a `BOOT_CAP` = 2,6 s de la navegación; si
  el ensayo no ha acabado, el fondo del telón se queda DEBAJO del menú (`.bt-bg.under`, z 9: tapa lienzo, HUD y tarjeta) y el ensayo sigue
  ahí (se para durante el vuelo: cada paso es un frame largo de GPU y el vuelo daba tirones). 2) PABELLÓN: con el ensayo hecho (tope 1,7 s
  desde la escena lista) el fondo se funde en 0,6 s. «EN DIRECTO · DEMO» solo aparece con la demo a la vista. Con todo listo a la vez, un
  solo relevo como antes. Mientras se enlazan programas no hay frames fluidos en ningún sitio (la GPU está ocupada): por eso el vuelo no se
  adelanta más (con el vuelo a 2,2 s durante el enlace, huecos de 250-740 ms en pleno vuelo; medido y descartado).
- **JUGAR antes del tiempo 2**: la cortinilla de pantalla cubre y espera (`bootBusy()`) hasta que el pabellón está listo (0,5-1 s), luego
  partido con tarjeta. Con el telón entero el menú no navega. El ensayo ya no pisa una cortinilla en marcha (`gymWipe` con `wp.ph`).
  `early.js` (clic y Enter en el tiempo 1, 1280 y 844 táctil): cortinilla `on brand lock` → partido al llegar el tiempo 2, sin errores.
- **Medido** (`bgaps.js`/`bg2.sh`, rAF por fase, intercalado con la versión de antes, PC cargado): menú pulsable a **2,30-2,64 s** (antes
  2,9-4,0) y con Google Fonts bloqueado **2,30-2,89 s**; pabellón a la vista 3,9-4,4 s (antes 3,6-4,7 tras el vuelo). Vuelo: el primer frame
  llega ~200 ms tarde (raster del menú) y luego fluido. 0 muestras con dos logotipos (`boot.js`, cada rAF).

### UI-01 · el hueco tras startMatch era la tarjeta de presentación (no warmDraw)
- Traza (`smtrace.js`): el frame de 55-85 ms ~0,1 s después de `startMatch` era el primer raster de la tarjeta de presentación (sombra de
  80 px, degradado a pantalla completa, texto con degradado: compilación de shaders de Skia en la GPU). `warmDraw()` NO corre en
  `startMatch` (solo `needWarmDraw` en el arranque). Arreglo: la tarjeta (`#intro.show.gy`, sin animaciones) y la cortinilla de la casa
  entran en el paso 5 del ensayo de estilos; la cortinilla del ensayo va siempre con `.cutw` (z 2), bajo el fondo del telón.
- Un partido HUMANO pedido mientras el arranque aún ensaya (herramientas que llaman a `startMatch` a los ~2,5 s, como feel.js) espera a
  que acabe (`startWait`, como mucho hasta los 9 s); los de autopilot empiezan al momento como siempre (perf.js, audiotest.js).
- Medido: `smtime.js` (clic previo + startMatch): 6/6 sin frames > 25 ms (antes 79-85 ms en el frame ~86). `feel.js NOCAST=1` 62 s, 1280×720:
  arranque e intro ≤ 21 ms en todas las pasadas; **3 pasadas finales (árbol vivo): mayor hueco 23, 37 y 24 ms** (< 50); con el PC al 88 % salen huecos
  sueltos de 65-580 ms con JS del frame ≤ 2 ms y 0 programas nuevos (`feelgap.js` muestra `js`/`pg`): son de la máquina, no del juego.
  `progs.js` MENUWAIT 3000 y 15000: 1 programa tras startMatch (sombra, 2,3-2,9 ms), ninguno > 8 ms.
- Audio (no es mío): el `AudioContext` se crea en el gesto; ver nota en notes/audio.md.

### UI-10 · indicador de borde
- Ya no cruza la pantalla: con un salto > 90 px (otro borde o tramo libre) va directo; la interpolación cortaba la esquina y pasaba por
  encima del joystick (el «7» sobre la base en `ui10_844x390_-0.6`). Obstáculos: también `.vt-knob` y el rótulo `.vt-tip` del joystick
  (la `.vt-zone` es la zona táctil invisible: no estorba). Con los pies dentro del joystick, el borde de abajo da el hueco a su derecha.
- Escena de aceptación nueva y reproducible: `?debug=spike&camyaw=±1.2` (main.js: `&camyaw=rad` gira la cámara tras su update, solo en
  depuración). `node tools/offarrow.js` (nuevo): 1280×720, 844×390 y 667×375 táctil → visible, ángulo de la flecha a 0° de la recta
  centro → jugador, 0 solapes con marcador, botones del HUD y controles táctiles; sin giro, oculto. TODO OK. Capturas
  `tools/out/offarrow_*.png`. Con la cámara girada en vivo (ui10.js del verificador): 0 solapes visibles (solo la `.vt-zone` invisible).

### UI-11 · hoja final en el móvil
- MVP en filas (una tarjeta por fila): el desglose sale entero también en la versión corta (`22 ataque · 2 bloqueo · 2 aces`, suma = puntos).
  844×390: «26 PUNTOS» a la izquierda y desglose a la derecha; 667×375: desglose en segunda línea. « · CPU» solo en escritorio (el color ya
  lo dice). Las tarjetas ocupan las filas 1-2 de la rejilla (no estiran la fila del rótulo de la izquierda) y las estadísticas van más juntas.
- Secundarios con `minmax(0,1fr)`: 166/166 px a 844 y 124/124 a 667 (antes 158/128); a ≤ 740 px, si no caben, en dos líneas (36 px de alto,
  sin puntos suspensivos). Arreglado también: a 667 la columna izquierda se salía 10 px y el «6» de las estadísticas pisaba REVANCHA.
- Cuenta de cifras con un solo reloj (t0 = primer sello de rAF, y `u` acotado a 0..1): sin números negativos.
- Capturas: `tools/out/fx3/over667.png`, `over844.png`, `over1280.png` (escritorio sin cambios).

### Textos del punto
- Ace cuya recepción acaba en la red: «¡Ace!» + «La recepción de la CPU va a la red» / «Ace de la CPU» + «Tu recepción va a la red» (antes
  «Balón a la red», que se leía como saque a la red). Red/antena/dobles/8 s/ataque sobre el saque siguen con el texto del árbitro tal cual.
- Tutorial: «Ace: punto directo de saque, sin que el rival lo controle».
- Pestaña (nivel 1) sin «¡…!»: «Ace», «Punto de bloqueo» (la cinta grande sigue con «¡Ace!», «¡Punto de bloqueo!»). Un bloqueo directo tuyo
  con highlight ≥ 0,6 sale en cinta aunque haya habido otra hace poco (salta BIG_GAP).

### «PUNTO DE SET» compacto en táctil
- `#banner.compact` a `right: 80px` (antes 64): la cinta sesgada sobresale ~4 px y tocaba el botón de pausa. A 844×390 acaba en x≈765 con el
  botón en 787 (`tools/out/fx3/sp844.png`).

### Herramientas
- `tools/touchplay.js`: aplicado el diff de camera_input (`tools/out/ci3/touchplay.diff`: saque a `hitWindow().press`, ⇄ solo con
  `!g.jobs[0]` y reintento). TODO OK (⇄ 4 cambios, 0 toques sin cambio, en los dos tamaños).
- `tools/perf.js`: tras `startMatch` sondea `state === 'playing'` hasta 4 s (petición de camera_input; con autopilot ya no hacía falta, pero
  no estorba).
- `tools/offarrow.js` (nuevo, ver UI-10).

### Regresión (árbol vivo, al final)
- `console.sh all` 1280×720 y 844×390 táctil: sin errores. `drive.js`, `touchplay.js`, `padplay.js`: TODO OK. `simtest.js 10 7 0`: TODO OK.
- `perf.js 844x390 15 medium,low` (×4, dpr 2,75): media 141 fps, 41-46 draw calls, 200 k triángulos; baja 150 fps, 31-35 draw calls, 89 k.
  «objetivos cumplidos».

### Para el integrador (CONTRACT)
- §4.1: `ctx.bootInfo` (`{t0, renderer, yield, Arena, FX, …, quality, end}` ms); parámetros `&preboot=0`, `&bootcap=ms`, `&gymintro=0`,
  `&camyaw=rad` (depuración). `startMatch` de un partido humano durante el arranque espera a que acabe (`startWait`, tope 9 s); autopilot no.
- §4.4: `VB.UI.preboot(ctx)` (main.js, en el arranque), `VB.UI.bootBusy()`, `VB.UI._boot()` (pruebas). Fuente embebida «VB Marca» en
  index.html (solo .logo y rótulo del telón). `window.__vbFonts` avisa al momento si la hoja de Google no carga.
- §6: `node tools/offarrow.js` (UI-10).

## Aplicado (log, integración de los arreglos tras la verificación de la ola 2, 8-nov-2026 noche, PC de casa)
- CONTRACT §4.1 (`bootInfo`, espera de `startMatch` humano en el arranque), §4.4 (`preboot`, `bootBusy`, `_boot`, «VB Marca», `__vbFonts`, texto del ace
  a la red), §6 (`&preboot=0`, `&bootcap`, `&gymintro=0`, `&camyaw`, `offarrow.js`).
- perf.js: además del sondeo, repite `startMatch` cada 0,5 s mientras no esté en `'playing'` (arranque lento con el PC cargado, notes/arena.md §13).
- Regresión en la integración: console.sh all (1280×720 y 844×390 táctil) sin errores; drive.js, touchplay.js, padplay.js TODO OK.

## Desde sim (SIM-05, 2026-11-08): highlight calibrado
`point.highlight` ya está calibrado (notes/sim.md §P3): en CPU vs CPU ~20 % de los puntos llegan a `VB.HOLD.bigAt` (0,55) y < 5 % a 0,8
fuera de punto de set/partido; bot bueno vs Normal 23 % (antes 28 %). El bloqueo directo vale 0,55 por sí solo, la jugada épica
(peloteo largo + defensas) llega a 0,55, y el **final apretado** (`e.clutch`, nuevo: últimos 8 puntos del set con ≤ 2 de diferencia)
suma 0,28. Propuesta para `tierOf` en js/ui.js (las reglas propias ya están dentro del número; medir con tools/out/ui1/tierstat*.js):
```js
  function tierOf(e, k) {
    var hl = typeof e.highlight === 'number' ? e.highlight : 0, big = (VB.HOLD && VB.HOLD.bigAt) || 0.55;
    if (k === 'ace' || e.savedSetPoint) return 2;
    if (k === 'error' || k === 'srvErr') return 1;
    return hl >= big ? 2 : 1;
  }
```
Subtítulo opcional cuando no hay texto del árbitro y `tier > 1`: `if (!sub && e.clutch) sub = 'Final apretado';` (después de los de
punto de set salvado).

## De players (pulido ola 3, 8-nov-2026)
- `fx:catch` YA se emite: cada recogida del bote en el ritual del sacador CPU (`{team, x, y, z, strength:0.6}`), un evento por bote.
- Nuevo `fx:call` (opcional): «¡mía!» del que va a por el balón (un evento por balón, `{team, x, y, z (cabeza), strength:0.6}`). Si se quiere, un aviso de voz
  muy sutil; si no, se ignora (main.js ya lo reparte como cualquier `fx:*`).
- CONTRACT §4.3: `fx:catch` lo emite players; nuevo `fx:call` `{team, x, y, z, strength}`. §4.4: `VB.Players._face(p, 'shout'|'effort'|'joy'|'sad'|'neutral'|'', sec)`
  (pruebas); rig de solo lectura: huesos `eyes, mouth, teeth, brow[2], hair`, pesos `fxS/fxE/fxJ/fxD`, `hairAng`, `ritOn`, `tgtW`. Proporciones: cadera 1,042 m
  (hombros y altura total iguales). Sin cambios necesarios en main.js.

## De audio (pulido ola 3, AUD-08, 8-nov-2026): sonidos de la hoja final, de las flechas de dificultad y de Ajustes
Todo ya existe en `js/audio.js` (opcional, con guarda; antes del primer gesto son no-ops sin error). Falta cablearlo en `js/ui.js`.
**Probado tal cual**: `node tools/audiotest.js --endui-only` aplica EXACTAMENTE estos cambios a una copia del proyecto
(`tools/out/audio/endui-root/`, con `ui.js` de hoy) y juega la hoja final (`?debug=end`, 1280×720 y 844×390 táctil) y el menú/Ajustes en
Chrome real: 7 tics a 49-97 ms (≤ 20/s, se frenan con las cifras), «clac» EN el último frame de la cuenta (0 frames de desfase, 0 tics
después), MVP una vez; flechas → paso arriba/abajo/tope y hover propio; Ayudas Sí/No → `tglOn`/`tglOff`; Calidad → `optSel`; hover de fila
→ `optHover`. Cuando lo cablees, la misma prueba detecta `VB.Audio.ui('count'` en `ui.js` y prueba tu fichero sin tocarlo.
- API: `VB.Audio.ui('count', u, ts)` (en cada frame de la cuenta en que cambia alguna cifra y en el último, u = avance 0..1, ts = sello
  de rAF en ms) · `ui('mvp', win)` (al EMPEZAR la cuenta: el acento cae a 0,6 s, cuando se posan las cifras) · `ui('arrowHover', dir)` ·
  `ui('arrow', dir, nivel, nNiveles)` · `ui('arrowEdge', dir)` · `ui('optHover')` · `ui('toggle', on)` · `ui('select', i, n)` · `ui('slide', v)`.
- El ritmo de los tics lo pone audio.js (no hace falta limitar nada en ui.js): llamar en cada frame con cambio basta.
- Mientras se ve la hoja (state `over` tras la 1.ª cifra o el MVP), la grada baja 6 dB (≈ 3 dB a la salida) y vuelve al salir de `over`.
- Nota: el interruptor «Sonido: Sí» no puede sonar (el contexto se reanuda de forma asíncrona) y «Sonido: No» lo silencia: es lo esperado.
- Los cambios (sangría +2 por la lista; el texto es el del fichero):
- **cuenta: MVP al empezar** — sustituir:
  ```js
      cancelAnimationFrame(cuRaf);
      if (reduceMotion || !items.length) return;
  ```
  por:
  ```js
      cancelAnimationFrame(cuRaf);
      // AUD-08: revelación del MVP (el acento cae a 0,6 s, cuando se posan las cifras; con movimiento reducido, 0,6 s tras aparecer)
      if (el.endMvp && el.endMvp.firstChild) { try { if (VB.Audio && VB.Audio.ui) VB.Audio.ui('mvp', root.classList.contains('win')); } catch (e) { } }
      if (reduceMotion || !items.length) return;
  ```
- **cuenta: tics y clac** — sustituir:
  ```js
        for (var j = 0; j < items.length; j++) { var tv = String(Math.round(items[j][1] * e2)); if (items[j][0].textContent !== tv) items[j][0].textContent = tv; }
        if (u2 < 1) cuRaf = requestAnimationFrame(step);
  ```
  por:
  ```js
        var chg = false;
        for (var j = 0; j < items.length; j++) { var tv = String(Math.round(items[j][1] * e2)); if (items[j][0].textContent !== tv) { items[j][0].textContent = tv; chg = true; } }
        // AUD-08: tic en los frames en que cambia alguna cifra (audio.js los espacia: ≤ 20/s, se frenan con la cuenta) y «clac» en el último
        if (chg || u2 >= 1) { try { if (VB.Audio && VB.Audio.ui) VB.Audio.ui('count', u2, now); } catch (e) { } }
        if (u2 < 1) cuRaf = requestAnimationFrame(step);
  ```
- **opciones: sonido según el tipo** — sustituir:
  ```js
        ctx.actions.setSetting(k, o.vals[i]);
      }
      click();
    }
  ```
  por:
  ```js
        ctx.actions.setSetting(k, o.vals[i]);
      }
      optSound(k, arrowDir);
    }
    /** AUD-08: confirmación con el sonido de su tipo: flecha de dificultad (la nota sigue al nivel), Sí/No, varios valores, deslizador. */
    function optSound(k, arrowDir) {
      var A = VB.Audio; if (!A || !A.ui) return click();
      try {
        if (SLIDERS[k]) { if (k !== 'sfxVol') A.ui('slide', (slVal(k) - SLIDERS[k].min) / (SLIDERS[k].max - SLIDERS[k].min)); return; }
        var o = OPT[k], i = optIndex(k);
        if (arrowDir) A.ui('arrow', arrowDir, i, o.vals.length);
        else if (o.labels.length === 2 && o.labels[0] === 'Sí') A.ui('toggle', i === 0);
        else A.ui('select', i, o.vals.length);
      } catch (e) { }
    }
    function uiSound2(kind, a) { try { if (VB.Audio && VB.Audio.ui) VB.Audio.ui(kind, a); } catch (e) { } }
  ```
- **opciones: firma con la flecha** — sustituir:
  ```js
    function changeOpt(k, d, absIdx) {
  ```
  por:
  ```js
    function changeOpt(k, d, absIdx, arrowDir) {
  ```
- **flechas: paso y tope** — sustituir:
  ```js
  uiSound('back'); return; }
      changeOpt('difficulty', 0, j);
  ```
  por:
  ```js
  uiSound2('arrowEdge', d); return; }
      changeOpt('difficulty', 0, j, d);
  ```
- **flechas: hover propio** — sustituir:
  ```js
  arrs[ai].addEventListener('pointerenter', function (ev) { if (ev.pointerType === 'mouse') hoverSound(); });
  ```
  por:
  ```js
  arrs[ai].addEventListener('pointerenter', function (ev) { if (ev.pointerType === 'mouse') uiSound2('arrowHover', +this.getAttribute('data-d') || 1); });
  ```
- **filas de Ajustes: hover propio** — sustituir:
  ```js
  hb[h].addEventListener('pointerenter', function (ev) { if (ev.pointerType === 'mouse') hoverSound(); });
  ```
  por:
  ```js
  hb[h].addEventListener('pointerenter', function (ev) { if (ev.pointerType === 'mouse') { if (this.classList.contains('opt')) uiSound2('optHover'); else hoverSound(); } });
  ```
- **filas de Ajustes: foco con mando/teclado** — sustituir:
  ```js
      focusEl(list[i], true); hoverSound();
  ```
  por:
  ```js
      focusEl(list[i], true); if (list[i].classList && list[i].classList.contains('opt')) uiSound2('optHover'); else hoverSound();
  ```

## Pulido ola 3 — ui_main (8-nov-2026, PC de casa, RTX 3060 Ti): UI-13, UI-16 (verificados) y UI-17…UI-23
Pruebas y capturas en `tools/out/w3/` (no se suben). Interfaces de CONTRACT intactas; solo añadidos opcionales.

### UI-17 · respuesta personal y medidor pronto/tarde
- `callout(text, team, cls, dur, o)`: `cls` `'neg'` (blanco, filo rojo-naranja) / `'good'` (dorado) = respuesta PERSONAL; `c0/c1` solo para lo
  que hace un equipo. `o.html` (texto propio con glifos), `o.gauge` (−1..1: medidor ◀ ● ▶ con la raya verde del instante bueno; − pronto).
- «¡Pronto!» / «¡Tarde!» llevan el medidor (marca a ±(0,27…1) según `miss.t2`), «No llegas» y «¡Te ha dado!» van en `neg`; si el balón da en
  el cuerpo ≤ 0,7 s después de un «¡Pronto!», se queda el «¡Pronto!» (explica por qué). Tu bloqueo directo: «¡Bloqueo!» en `good`.
- `miss17.js` (partido humano real, teclado): «¡Pronto!» en vivo → color rgb(255,255,255), filo #ff5a2c, punto 16 px a la izquierda del centro;
  «¡Tarde!» (evento inyectado) → punto 19 px a la derecha.
### UI-18 · textos
- Ace / antenas / «Un punto para ganar el 1.er set» / «Un punto para ganar el partido» / «¡Ganas el partido!» / «Balón libre · [SALTAR] para
  rematar» / «3.er toque · Ataque: ponte bajo el balón, salta con K y golpea con ESPACIO arriba» / «Primer partido» / «Al mejor de 3 sets» /
  «Voley 3D se juega en horizontal». Antetítulos con contexto: pausa «Set 1 · 24-10 · Normal» («Mando desconectado» si se va el mando; en medio
  solo los sets), final «Palau del Mar · Nivel Normal · 3 sets», paneles «Botones y gestos» / «Se guardan en este navegador». Tarjeta guiada:
  solo el ordinal («SEGUNDO TOQUE»; el nombre ya está en el contador). `#sbTag` oculto mientras la cinta «Punto de set/partido» está a la vista.
- Hoja final: sin la cabecera «TÚ · CPU» de las estadísticas (cifras en el color del equipo); MVP en tabla: un solo rótulo vertical «MVP», cabecera
  «Ataque · Bloqueo · Saque» una vez y una fila por equipo (aria-label con la frase entera). Hoja centrada (600-999 px) compactada: botones a la vista.
- Fila de Dificultad quitada de Ajustes (estaba también en el menú; en la pausa no se aplicaba hasta el siguiente partido).
- `ui18.js`: grep de cadenas viejas/nuevas, frases del árbitro intactas en sim.js/ui.js; pausa, final, punto de set 1,0/2,5 s y primer toque
  guiado a 1280×720 y 844×390 táctil: cada frase visible una vez, sin desbordes → TODO OK.
### UI-19 · tamaños y contraste
- Marcador al 78 %: franja de arriba e historial a 12 px reales (15,5 px × 0,78); ≤ 420 px de alto, sin el nombre del pabellón (queda el balón).
  Token `--dim-text:#8a9cb3` para texto (`--dim` solo trazos). Naranjas con texto blanco pequeño oscurecidos a paradas ≥ 4,5:1 (botón base,
  JUGAR con subtítulo blanco al 100 %, teclas táctiles del aviso, pestaña de punto, insignias de dorsal, tecla encendida); segmento elegido y
  chip hecho del contador con texto oscuro. Etiqueta del tutorial 14 px, peso 700, `lining-nums tabular-nums` («6» se lee: `tutzoom-*.png`).
- `a11y19.js` (tamaño × escala real del rectángulo; contraste con fondos de antepasados y ::before/::after, degradados promediados, sobre arena
  oscura y tarima clara): 14 escenas × 844×390 y 667×375 (también HUD al 130 %) → 0 textos < 11 px; contraste: todo ≥ objetivo salvo «SACAR»
  del botón táctil (input.js, nota a camera_input). 1280×720 y 1920×1080: 0 < 11 px, contraste OK.
### UI-20 · el aviso nunca pisa un botón táctil
- `placePrompt`: cajas REALES de `#touch .vt-btn` (+10 px, medidas al cambiar de tamaño y cada 120 frames) como zonas prohibidas; si ningún sitio
  cabe, solo la tecla (`#prompt.konly`); si aun así no, se sube por encima de los botones; el suavizado nunca lo cruza por encima. `VB.UI._prompt()`.
- `prompt20.js` (40 s en vivo, táctil, rAF, cajas reales sin margen): 844×390 (semillas 3 y 7) y 667×375 → 0 frames con solape (~1900-2000 con aviso).
### UI-21 · Ajustes y Controles en el móvil
- Ajustes: grupos Audio · Imagen · Juego · Accesibilidad, dos columnas desde 600 px; Sonido = silencio general (altavoz o Intro) + volumen de
  efectos en la misma fila (mover el volumen quita el silencio); filas compactas en el móvil; `.has-more` (desvanecido con flecha) si hubiera que
  desplazar (`checkMore`, también pausa y final). Controles: pestañas pequeñas por dispositivo (marca «en uso»), el elegido grande en dos columnas,
  nota en 2 líneas, «Saltar (en el aire: dejada)»; ←/→ o el stick cambian de pestaña. `ui21.js` → TODO OK (sin desplazar a 844/667, 0 solapes, ≥ 13 px).
### UI-22 · glifos PlayStation
- `padInfo().id` con 054c / DualSense / DualShock / Wireless Controller (no Xbox/045e) → ✕ ○ □ △ (formas SVG neutras, el carácter queda en el texto
  y en aria-label), L1/R1, Options/Share; en aviso, panel de controles, menú, tarjeta y final. `tools/padplay.js` acepta `PADID="…"`:
  estándar → A/B y panel con A; DualSense → ✕/○ y panel con ✕ (TODO OK los dos).
### UI-23 · idioma y tanteo hablado
- main.js `boot()`: `document.documentElement.lang = 'es'`. `#srLive` (aria-live polite) tras cada punto: «Tú 1, CPU 0. Set 1.» (con «Set para ti.» /
  «Ganas el partido.» y los sets delante/detrás); también Pronto/Tarde y los elogios de calidad. Medido en `debug=rally&live=1`: coincide con el marcador.
### UI-13 / UI-16 (arrastrados)
- Cortinilla (`w2/wipe.js` en el flujo real, menú → partido): 1280×720 6/6 y 844×390 táctil 8/8 cortes cubiertos al 100 %, 133-134 ms, reacción
  seca, 0 frames > 33 ms. En escenas `debug=` táctiles el primer saque tiene un frame de 60-90 ms TAMBIÉN con `&wipe=0`: es el primer raster de los
  botones táctiles en estado `off` con `#touch` saliendo de `dead` (sin telón no hay ensayo de estilos); en el flujo real el ensayo lo cubre (máx. 18 ms).
- Accesibilidad (`w2/a11y.js` TODO OK) y `camStable` → temblor 0 medido (`getDebug().shake` máx. 0 con estable, 0,12 sin él).
### Regresión
- `simtest 10 12345 0` TODO OK; `console.sh all` 1280×720 y 844×390 táctil sin errores; drive, touchplay, padplay (estándar y DualSense) TODO OK;
  `perf.js 844x390 15 medium,low 4 2.75`: media 117 fps, 40/43 draw calls, 247 k tri; baja 104 fps, 31/33 draw calls, 113 k tri; «objetivos cumplidos».
### Para el integrador (CONTRACT)
- §4.4: `VB.UI.callout(text, team, cls, dur, o)` (`cls` 'neg'|'good'|'tip', `o.html`, `o.gauge`), `VB.UI._prompt()`. Ajustes sin fila de dificultad.
- §6: `tools/padplay.js` `PADID=`.

## Aplicado (log, integración del pulido ola 3, 9-nov-2026, PC de casa)
- **SIM-05 → UI-03**: `tierOf` = `highlight >= VB.HOLD.bigAt` (+ ace, punto de bloqueo y punto de set salvado); fuera las reglas propias (jugada ≥ 10, racha 3/5),
  que ya van dentro del número. `RALLY_BIG` solo queda para el subtítulo «¡Peloteo de N toques!». Subtítulo nuevo «Final apretado» (`e.clutch`, último recurso
  tras punto de set salvado / peloteo / racha y nunca con punto de set en juego). Medido (autopilot, 16 partidos por nivel, sin el freno `bigGap`): cinta grande
  34,1/30,3/28,2 % → 23,4/23,1/23,4 % (Fácil/Normal/Difícil), alineada con la pausa larga de 2,4 s (`tools/out/int3/tier.js`).
- **AUD-08**: los 8 cambios de la nota de audio aplicados tal cual (MVP al empezar la cuenta, tic/clac por frame, `optSound`, `changeOpt(k, d, absIdx, arrowDir)`,
  flechas paso/tope/hover, hover y foco de filas de Ajustes). `node tools/audiotest.js --endui-only` → TODO OK (7 tics, clac en el último frame, MVP 1, flechas y Ajustes).
- **Arreglo (debug)**: `tryReveal` no relevaba nada sin telón, pero en escenas `debug=` (telón oculto por main.js, sin `bootReady`) el tope de 2,6 s hacía un relevo
  PARCIAL y el fondo del telón tapaba el pabellón hasta los 7,6 s (`debug=menu` a 4 s salía sin escena en shot.sh/console.sh). Ahora, telón oculto y sin relevo
  empezado → `bootStage = 2`. El flujo real no cambia (verificado: sin `.bt-bg` ni `bt-wait` a los 5 s).
- **Arreglo (UI-18/UI-21, tutorial en el móvil)**: el texto nuevo del ace (4 líneas) dejaba Anterior/Siguiente medio tapados por el desvanecido en TODOS los pasos a 844×390
  y 667×375 (desbordaba 28-42 px) y «Reglas y faltas» desbordaba ~250 px. En `@media (max-height:560px)`: tutorial compacto (título 25 px, texto 13 px, regla 12 px,
  cabecera 6 px) y navegación `position:sticky` abajo con degradado (el desvanecido `.has-more` se quita en el tutorial). Pasos 1-5: 0 px de desborde a 844×390 y
  667×375; paso 6 desplaza por debajo con los botones siempre a la vista (`tools/out/int3/tutfit.sh`, `tutB.png`, `tutC_s6.png`). Escritorio sin cambios.
  Texto: «Ace: punto directo de saque: el balón…» (dos dos puntos seguidos) → «Ace (punto directo de saque): el balón…».

## Arreglos tras la verificación ola 3 — ui_main (9-nov-2026, PC de casa)
Pruebas y capturas en `tools/out/w4/` (no se suben). Interfaces de CONTRACT intactas; solo añadidos opcionales.
- **«¡GANAS EL PARTIDO!» tapaba el marcador a 1280×720 (mayor)**: `placeT3` (nivel 3, set/partido) trabaja con candidatos (x, y) y zonas
  prohibidas = marcador ENTERO (franja, cuerpo con historial, etiqueta de punto de set, chip de la jugada si no se está fundiendo), `.hud-btns`
  y, en táctil, `#touch .vt-pause` (+12/+10 px). Cada altura centrada; si pisa algo, desplazada a la derecha del marcador (si cabe la cinta
  real, sin el margen de centrado) o justo debajo de todo. Pesa 400/px² (manda sobre el héroe, 12). `#banner` sigue de lado a lado: el centro
  se mueve con `left = 2·x − (W − bw)`. `&uidbg=1` registra los candidatos. Medido con `tools/out/w4/mw.js` (partido ganado en vivo,
  0,7-3,5 s): 1280×720 → cinta bajo el marcador (y 156-308, 25-14 legible); 1680×720 y 1920×1080 → arriba a la derecha del marcador;
  844×390 táctil → arriba entre marcador y pausa; 667×375 → bajo el marcador (antes lo tapaba). 0 solapes con #sb/botones en todos.
  `debug=setpoint` (cinta compacta) a 1280/1680/1920: sin solape.
- **Chip de la jugada en la celebración**: `rallyFade()` (clase `.fade`, animación `rlFade` 0,25 s; la de entrada fija la opacidad, por eso no
  vale una transición) al salir el rótulo de set/partido o una cinta con «¡Jugada de N toques!». Medido: fundido a los 0,7 s del punto de partido.
- **«Peloteo» → «Jugada»**: chip «JUGADA · N» y subtítulo «¡Jugada de N toques!» (la hoja final ya decía «Jugada más larga»). Las frases del
  árbitro intactas (grep: sim.js 4, ui.js 5). 70 s de autopiloto: chips «Jugada 8…12», subtítulo «¡Jugada de 12 toques!», chip fundido.
- **Tarjeta del 1.er toque guiado sobre el balón en el remate rival**: la pastilla era `#coach` (ya tenía `.thru`, pero en escritorio solo
  aclaraba el fondo); ahora `#coach.thru` baja a opacidad 0,28 en todas las pantallas (0,14 s) y `#guide.thru` a 0,22 (antes solo en el móvil).
  `debug=spike&guide=1` a 1280×720: balón en (538,77) bajo la pastilla → opacidad 0,28, el balón se lee (`spike-guide2.png`).
- **Pestaña blanca vacía del marcador en el móvil**: el `letter-spacing:.2em` de `.sb-top` se hereda ya resuelto (2,5 px) y los 13 caracteres
  invisibles de «PALAU DEL MAR» con `font-size:0` ensanchaban la pestaña a 55 px. `letter-spacing:0` → 22 px, solo el balón (`rally-ph2.png`).
- **`debug=menu` sin pabellón (también a 1280×720, no solo en el móvil)**: carrera. En escenas `debug=` no hay `bootReady`; si el 3.er frame
  pintado llegaba pasado BOOT_CAP (2,6 s; enlace de programas lento), `tryReveal` hacía un relevo PARCIAL y el fondo del telón quedaba bajo el
  menú hasta los 7,6 s. Ahora `tryReveal` no empieza nunca un relevo en depuración (el telón lo quita main.js en el 3.er frame, como siempre).
  No se pasa `debug=menu` por el telón real: audiotest/camtest lo usan e interactúan a ~1,2 s y `bootBusy` los frenaría. 5/5 capturas con escena.
- **Perfiles vb3c-* huérfanos (UI-08)**: `cdp.js` `sweepDead(deadMs=8 min, dry)` borra carpetas de más de 8 min que NINGÚN proceso vivo nombra
  en su línea de órdenes (`listVbProcs()`, sacado de `killOrphans`; si no se puede listar, `null` → no se borra nada). `open()` lo llama si hay
  alguna así (como mucho cada 2 min, `%TEMP%/vb3-dead.stamp`; al momento con ≥ 4). `tools/clean.js` también (`DEAD=min`, `DRY=1` las lista).
  La regla de 1 h queda de reserva. Probado: carpeta falsa de 10 min sin proceso → la borra el siguiente `eval.js`; la de otro agente en marcha
  se respeta. Nota: cualquier proceso cuyo comando contenga el nombre la protege (conservador).
### Regresión
- `node --check` de todo js/ y tools/; `simtest 10 12345 0` TODO OK; `console.sh all` 1280×720 y 844×390 táctil sin errores (perfiles: 0 propios
  restantes); drive, touchplay, padplay (estándar y DualSense) TODO OK (padplay estándar falló una vez «el mando pasa a ser el dispositivo activo»
  con el PC cargado por otros agentes; repetido: TODO OK); `perf.js 844x390 15 medium,low 4 2.75`: media 78 fps (CPU del PC 58 %), baja 97 fps,
  29-34 draw calls, 112-120 k tri, «objetivos cumplidos».
### Para el integrador (CONTRACT)
- §6: `tools/cdp.js` exporta además `sweepDead(deadMs, dry)` y `listVbProcs()`; `tools/clean.js` acepta `DEAD=min`.

## Aplicado (log, integración de los arreglos tras la verificación de la ola 3, 9-nov-2026, PC de casa)
- CONTRACT §6: `sweepDead(deadMs, dry)`, `listVbProcs()`, `clean.js DEAD=min`; añadidos visibles («JUGADA · N», `.rl.fade`, `placeT3` con zonas prohibidas, `#coach/#guide.thru` en todas las pantallas, `tryReveal` sin relevo en depuración).
- SIM-03: línea 324 corregida a 4,0 s.
- **Cambio del lead en index.html (fuentes)**: tras las 4 caras que espera el arranque, se piden SIN esperar las demás que usa la UI (Barlow Condensed 800/700 cursiva, 600, 500, 900; Barlow 400/500/700). Antes, Barlow 500/700 (el #coach del aviso de los 8 s) se bajaban la primera vez que salía ese texto a mitad de partido y Chrome volvía a maquetar todo: frame de 55-82 ms (Layout 53 ms con CPU ×4). Ahora llegan bajo el telón: 49-52 ms (Layout 27 ms). Comprobado: todas las caras latinas «loaded» a los 7 s.
- Petición de camera_input (pre-pintar la cortinilla): evaluada y no aplicada; ver notes/camera_input.md (el hueco es del HUD del saque en `debug=rally`, no aparece en el partido real).
- Verificado en el árbol integrado: simtest completo + barrido `simtest <10|20> <1..25> 0` 50/50 TODO OK; console.sh 19 escenas (1280×720 y 844×390 táctil) sin errores; drive, touchplay, padplay (estándar y DualSense) y audiotest completo TODO OK; perf 844×390 ×4 «objetivos cumplidos» (ver TRASPASO).

## Sprint remate apuntado + challenge — ui_main (9-nov-2026, PC de casa): A5 y B7
Pruebas y capturas en `tools/out/chal/` (no se suben). Solo añadidos opcionales.
- **A5**: `aim3(g, p)` (lee `g.aim3.on`; sin él, humano en el aire en su lado). Consejo del 3.er toque en el aire: escritorio
  «3.er toque · Apunta con <glifo> y golpea con <glifo> en lo alto», táctil «Apunta con el joystick». Tutorial paso 4: mira libre
  y timing perfecto = exacto a la diana (texto acortado: 0 px de desborde a 844×390, 667×375, 1280×720, 1024×768).
- **B7**: contador `#sbChal` (2 iconos, `g.challenges[0]`) en la franja del marcador tras SET. `#chal` (botón, FUERA de `#hud`, z 6 > `#touch`)
  arriba a la derecha bajo los botones del HUD/pausa: ventana `Sim.canChallenge(g,0) > 0` → «Challenge · V» / LT (L2 en PlayStation) /
  «CHALLENGE» táctil, cuenta atrás y barra; `pointerdown` → `ctx.actions.challenge()`. Con `g.review`: «REVISIÓN · Challenge · TÚ/CPU»
  y barra `review.t/dur`. Eventos: `challenge` (CPU → callout «La CPU pide challenge»), `challengeResult` → banner «IN»/«OUT» +
  «N,N cm de la línea · Punto para ti/la CPU» o «Se mantiene · te queda(n)…»; `#srLive` lo anuncia. Paso 6: fila «Challenge».
  Controles (`ctlRows`): V / LT·L2 / botón CHALLENGE.
- **main.js**: `ctx.actions.challenge()` → `Sim.challenge(ctx.game, 0)` (solo en `'playing'`; llama `VB.UI.onChallenge` opcional);
  `it.challenge` (VB.Input.poll) → `ctx.actions.challenge()` fuera de la tarjeta de presentación.
- Medido: 844×390 táctil `#chal` 690,70-828,114; pausa 787,15-829,57; ⇄ 783,215-829,261; marcador 16,14-202,99 → sin solape;
  `elementFromPoint` en su centro = el botón (encima de `#touch`). E2E `debug=serve` con `g.call` inyectada: V → `g.review`, rótulo
  REVISIÓN, a los 4,5 s `challenges` 2→1, icono apagado, banner «IN · 1,2 cm… Se mantiene · te queda 1 challenge».
### Para el integrador (CONTRACT)
- §4.1 `actions.challenge()`; §4.4 `VB.UI.onChallenge(g, team)` (opcional, hoy no definida). `placeT3` aún no cuenta `#chal` como zona prohibida.

## Sprint cartoon — ui_main (9-nov-2026, PC de casa)
Capturas: `tools/out/cartoon/antes/` y `tools/out/cartoon/despues/` (no se suben).
- **Restyle cartoon** (index.html, bloque «DIRECCIÓN CARTOON» al final del CSS): tinta `#1d1530` (`--tk`), paneles violeta planos con
  2 bandas (`--cel`), contornos y sombras desplazadas duras SOLO con box-shadow/colores de bordes ya existentes (cero cambios de
  medidas: placeT3, zonas prohibidas y hudFit miden lo mismo), texto grueso con contorno (`--ring1/2/3` = text-shadow).
  Cubre botones, teclas (crema con tinta), menú, logotipo, marcador, pestaña, aviso corto, contador de toques, aviso del jugador,
  consejo, tarjeta guiada, sello, indicador de borde, challenge, banner (cinta OPACA), tarjeta de presentación, cortinilla, hojas
  (pausa, final, paneles), ajustes, controles, tutorial (figuras planas con contorno), telón. Los `.thru` siguen translúcidos.
  Sin efectos caros nuevos (nada de filtros salvo el sello PERFECTO y la flecha del indicador, ya con capa propia).
- **Acento de equipo = equipación** (contrato): ui.js `kitTick()` lee `VB.Players.kitColors()` (con guarda) en init, onSettings,
  onGameStart y cada 32 frames y pone en `#app` `--k0/--k1` (franja/chip; el negro se aclara), `--k0d/--k1d` (fondo con texto blanco,
  luminancia ≤ 0,2), `--k0l/--k1l` (texto sobre panel oscuro), `--k0rgb/--k1rgb`. Lo usan chip y sets del marcador, destello de
  fila, pestaña, aviso corto c0/c1, contador de toques, insignia de borde, banner win/lose, tarjeta de presentación, cortinilla,
  pulso de impacto, pausa, final (sets, barras, MVP) y las figuras del tutorial (`kitUI`). Lo de marca (JUGAR, botones) sigue naranja.
- **Control: Uno con elección de jugador** (contrato): fila «Control» con 3 valores virtuales: Los dos / Uno · n.º 7 / Uno · n.º 11
  (dorsales de `teams[0][i].num`). `ctrlSel(i)` → ajustes `ctrlMode` + `ctrlPlayer` (nuevo en main.js, 0|1, validado). main.js
  `ctrlIdxOf(opts)` → `createGame({ctrlIdx})` (`opts.ctrlIdx` > `&ctrlidx=` > ajuste). Subtítulo de JUGAR: «· Solo el n.º N».
- **Modo Uno sin «Cambiar jugador»**: Controles quita la fila (teclado C, mando Y/LB/RB, táctil ⇄) y cambia la nota; tutorial
  pasos 3 y 5 y el párrafo del paso 6 con textos propios (`oneMode()`: en partido manda `g.ctrlMode`, en el menú el ajuste).
- **Menú táctil (≤ 420 px de alto)**: filas de 44 px (JUGAR 48) y «Cómo se juega» + «Controles» en una fila de dos botones (solo
  CSS, el orden de navegación no cambia). Medido: 844×390 lista hasta y = 370; 667×375 hasta 362; sin desbordes.
- **Muestras de Equipación en táctil**: objetivo de 32×32 px (20 + 2×6); ≤ 820 px de ancho la fila pasa a rótulo arriba y muestras
  debajo (medido 32×32 sin desbordar a 844×390 y 667×375).
- **Punto anulado por challenge**: `onEvents` mira si el lote trae `challengeResult` con `overturned`; el `point` re-pitado no saca
  pestaña («REMATE») ni cinta (lo dice el banner IN/OUT) y `untally()` descuenta de las estadísticas de la hoja final el punto anulado
  (antes contaba los dos).
- **«OUT» cruzado por la red**: el banner de la UI era translúcido en los bordes de la cinta (gradiente a transparente, 0,92); ahora
  es opaco con contorno. Si lo que se cruza es el rótulo 3D (`screenMsg` de arena en el marcador colgado) con la cámara de punto
  detrás de la red, es de arena/camera_input, no de la UI.
Pruebas: simtest TODO OK; console.sh all sin errores JS; perf «objetivos cumplidos» (844×390 auto 81,5 fps); touchplay TODO OK.

## Integración sprint Carrera (9-nov-2026: saque dirigible + insignias + Carrera 2v2)
- **Saque dirigible (ui.js)**: consejo antes de lanzar «… · al lanzar, **diana** con <flechas/stick/joystick>»; mientras el balón SUBE,
  «Saque · apunta la diana con … · con buen timing va exacto» (táctil: «Apunta la diana con el joystick»); se quita al bajar.
  `.aimtip` solo con la mira del remate (`aim3.kind !== 'serve'`). Si la diana queda detrás del consejo, `.thrup` (sin fondo opaco);
  si queda detrás del marcador (esquina del fondo rival en 844×390), `.sb.aimthru` (hijos a 0,3). Tutorial paso 1, filas de
  Controles (teclado/mando/táctil) y nota de Controles mencionan la diana del saque.
- **Carrera**: marcador, presentación (`.in-t`), pausa (`.p-team`) y hoja final (`.es-t`) con las abreviaturas de los clubes
  (`teamNames` en ui.js; antes main.js sondeaba `#sbName1`). Hoja final de Carrera: insignias en fila compacta `.end-bd` con icono
  (con el texto largo «Menú principal» quedaba fuera a 844×390). main.js pasa `nums` (tus dorsales) y la equipación del rival.
  Sin challenge en la competición (`g.chalPerSet === 0`) no se ve el contador.
- **sim.js**: `opts.ref` y `opts.nums` (CONTRACT §4.2); simtest comprueba que sin ellos la sim es idéntica. **players.js**: `setKit`
  con `st.rival`. **career.js**: ofertas de fin de temporada con la liga de la temporada siguiente (`nextLvl`).
- **tools/padplay.js**: el menú tiene CARRERA entre JUGAR y NIVEL; comprueba A abre / B cierra la Carrera con el mando.
- CONTRACT.md: §1 (badges.js, career.js, career-ui.js, badgetest, careertest → ui_main), §4.2 «Sprint Carrera», §4.3 eventos
  nuevos, §4.4 «Insignias y Carrera».
- Recorrido completo (crear → hub → jugar → final forzado con falta de la CPU en punto de partido → hub → simular temporada →
  ofertas → fichar) con capturas en `tools/out/carrera/integ/` (1280×720 y 844×390 táctil).

## Dorsales 1 y 2 y «Control» de dos valores (nov-2026)
- Tu equipo lleva el **n.º 1 y el n.º 2** (antes 7 y 11): `sim.js createGame` (`mkPlayer(0, 1, 0)`, `mkPlayer(0, 2, 1)`; la CPU
  sigue con 3 y 9), `prog.js BASE` (1 «Atacante», 2 «Universal»), `ui.js teamNums()` y el `#offNum` de index.html. Migración del
  guardado `voley3d.squad`: `sane()` fuerza `num` desde BASE y, si el guardado traía otro dorsal (7/11), `load()` lo reescribe
  (nivel, XP, atributos e insignias intactos; badgetest lo comprueba).
- Fila «Control»: `OPT.ctrlMode = {vals: ['both', 'one'], labels: ['Los dos', 'Uno'], desc: [...]}` (fuera `ctrlSel` y los
  valores virtuales). La ayuda («Controlar a los dos jugadores» / «Controlar un jugador (el n.º 1; la IA lleva al n.º 2)») va en
  `title`/`aria-label` de `#optCtrl`. En modo Uno llevas siempre al n.º 1: main.js fuerza `ctrlPlayer = 0` y `ctrlIdxOf` ya no lee
  el ajuste (solo `opts.ctrlIdx` / `&ctrlidx=` para pruebas).
- Carrera: dorsal por defecto 1 (`career.js create`, formulario de `career-ui.js`); el compañero del club lleva el 2 salvo que tú
  lleves el 2 (entonces el sorteado de siempre, misma tirada del rng). El selector de control de la Carrera ya era de dos valores
  («Solo tu jugador» / «Los dos»); solo gana el `title` con la misma ayuda.

## Arreglos finales del sprint Carrera (10-nov-2026)
- **career-ui.js**: tras «Simular» el foco se queda en «Simular» (antes saltaba a «Jugar partido» y un 2.º Intro / A arrancaba un
  partido); al acabar la temporada (y al abrir el hub en fin de temporada) el foco va a la pestaña Partido con el cuerpo arriba (antes
  caía en «Seguir en…», que con otro Intro rechazaba todas las ofertas, y el `scrollIntoView` tapaba la tarjeta del resumen a 844×390).
  Posiciones «N.º» solo con la liga empezada; equipar sin hueco o una bloqueada explica por qué (`.bd-msg`, `aria-live`); textos «caducan
  al jugar o simular» y «solo con una nota media de 7 o más»; la oferta enseña `o.ovr`; `render` con red de seguridad (tarjeta «Guardado
  dañado» con «Borrar la carrera dañada», doble pulsación); aviso de guardado perdido en crear y en el menú; los botones del HUD ya no
  se ven detrás del hub (`#app.cr-on .hud-btns{visibility:hidden}`).
- **main.js**: «Menú principal» de la hoja final de Carrera va al menú principal (marca en captura sobre `document` antes del manejador
  de ui.js); «Volver a la Carrera» sigue abriendo el hub. Saque: entrada con los ejes de la pista (ver CONTRACT).
- **index.html**: táctil, botones de la hoja final ≥ 44 px (`#app.is-touch #end .row-btn button, … .end-peek button`); `.end-xp .lv` sin
  partir. A 667×375 la hoja de Carrera con subida de nivel e insignias sigue necesitando scroll para «Menú principal» (ya pasaba).
- **ui.js**: `cpuTxt` («la CPU» → «el rival», «CPU» → abreviatura del club) en cintas, presentación, avisos, consejo, lector de pantalla,
  rótulo del challenge e intro; la Carrera no suma al récord de Partido rápido ni enseña «Partidos ganados» / «Prueba el nivel …».
- **badges.js**: umbrales nuevos (Cañón 100/400/1200, Ojo de halcón 80/300/1000, Manos de seda 50/200/600, Ancla 30/120/350, Red de
  seguridad 100/400/1200; el resto igual) y Motor a la mitad (+1,5/3/4,5 %). Medido antes (bot medio, Carrera, control «uno»): Cañón
  bronce en 2 partidos y oro en 21; Red 3/26; Ojo de halcón 3/32; Ancla oro en 162-219. Con los mismos ritmos, ahora ~7-10 partidos el
  bronce y ~60-110 el oro (Ancla ~120-150). Con control «Los dos» (Partido rápido) los contadores se reparten entre los dos atletas y van
  más lentos. badgetest y simtest leen los umbrales/efectos de las tablas.
- Probado en Chrome (script `fixwalk.js` del scratchpad) a 1280×720, 844×390 y 667×375 táctil: doble Intro / doble A en «Simular» no
  arranca partido; fin de temporada con foco en la pestaña y tarjeta visible, un Intro más no rechaza las ofertas; oferta 38/41 →
  real 38/41; «Menú principal» → menú con la Carrera cerrada; guardados dañados (sin `sched`, sin `res`, `week: 99`, `myClub` 999, JSON
  roto) sin errores JS.

## Separadores con diseño y pantallas grandes (pulido 10-nov-2026)
- `sepHTML(trozos, tipo, html)` en ui.js (expuesto como `VB.UI.sep`; career-ui.js lo usa con su `sp()`): 'd' rombo naranja con tinta
  (antetítulos: menú, pausa, final, Carrera, titulares de banner con « · »), 'v' raya fina (parciales del marcador, consejos,
  líneas de datos de la Carrera), 's' barra inclinada (pares: «SET 3 / A 15», «Nombre / Club»), 'c' pastillas (metadatos: JUGAR,
  Carrera, Jugadores, fichas). Entre trozos va una coma `.sr` para lectores. `setSep(nodo, ...)` pinta solo si cambia.
  `coachHTML`: consejo y título del tutorial con la etiqueta corta («Tu saque», «1r toque») en pastilla `.tchip`.
  Pistas de teclas: grupos `.kh` con raya fina entre ellos. Prosa (ayudas, nota de Controles): puntos y comas, sin «·».
  `banner()` dibuja el rombo si el subtítulo trae « · ». CSS: bloque «SEPARADORES CON DISEÑO» al final del `<style>`.
- `--vs` (ui.js `vpFit`, en cada resize): 1 hasta ~1280×760; 1 + 0,8·(min(W/1280, H/760) − 1), tope 2 (1,34 a 1920×1080,
  1,71 a 2560×1440). Menú: `zoom: var(--vs)` en `.menu-col`, `.menu-foot`, `.live`, `.fs-btn`, y con `.vs-up` la rejilla compacta
  de 1280×720 (Cómo se juega · Controles · Ajustes en una fila). Carrera: zoom en `#career .cr-in`. HUD y hojas: `hudScale` =
  ajuste del jugador (`hudSet`) × `--vs`, así que `--hs`, `fitSheet` y todas las medidas de ui.js ya lo llevan.

## Correcciones tras la revisión visual (10-nov-2026, noche)
- Fila del menú «Controlar ‹ a los dos jugadores ›» / «Controlar ‹ un jugador ›» (`OPT.ctrlMode.labels`; «jugadores» va en
  `.cv-x` y se oculta con `max-width:900px` o `max-height:560px`, donde queda «a los dos»). `#ctrlVal` se pinta con innerHTML.
  La Carrera usa las mismas palabras y el mismo orden (career-ui.js, selector «Controlar»).
- `#intro .in-card` lleva `zoom: var(--vs)` (a 2560 medía ~500 px con letra de 9-11 px). Su antetítulo es «Palau del Mar ◆ 2 contra 2»,
  igual que el del menú (antes mezclaba rombo y raya).
- `checkMore`: el desvanecido de «hay más abajo» solo sale si sobran más de 20 px (la hoja final a 667×375 desbordaba 11 px de relleno
  y el desvanecido apagaba «Revancha en difícil» y «Menú principal»).
- Tutorial a `max-height:400px`: columna de texto más ancha (.78fr / 1.22fr) y letra un punto menor; el recuadro del ace ya no
  queda bajo los puntos de paso a 667×375.
- Panel Controles: el ratoncito es más grande, el botón pulsado va en ámbar y lleva «izq.» / «der.» al lado; táctil «Golpear y
  sacar (joystick: diana del saque)»; mando «Menús: aceptar y volver».
- Saque táctil: «SACAR Flotante / SALTAR Potente» (antes «SALTAR En salto»).
- Ordinales en castellano: «1.er set», «1.er toque» (antes «1r», abreviatura catalana).
- Sin cambiar (deliberado): el consejo de arriba se vuelve translúcido (`.thru`) cuando el balón o los jugadores pasan por detrás;
  el clic sobre el marcador cuenta como clic en pantalla (golpea), tal como pidió Ferran («clicar en la pantalla»).

## Colocación en salto — UI y herramientas (10-nov-2026)
- `GLYPH.keyboard/gamepad/touch` y `GLYPH_PS` añaden `jset` (K / X / Colocar, PS □) y `jsetT`. `.key.tch.s` (verde) en index.html. `M('c')` dibuja
  la rueda del ratón; `T(t, 's')` el botón COLOCAR.
- Aviso `#prompt` en el aire con `VB.Sim.jsetReady(g)` (y «Avisos» encendido): rejilla 2×2 `.two` con la tecla de GOLPEAR + «Rematar» (o «Golpear»
  si el balón no está alto en la red) y la de COLOCAR + «Colocar»; encendido (`go`) dentro de la ventana de golpeo.
- Consejos: 2.º toque «… o salta y coloca en el aire con K, más rápido» (táctil «Bajo el balón y Golpear · o salta y Colocar»); en el aire
  «En el aire: J remata · K coloca en salto a tu compañero» (táctil corto). Panel Controles: fila «Colocar en salto» en teclado (K o rueda),
  mando (X, «B» queda solo para saltar) y táctil. Tutorial paso 3 (colocación) lo explica en los dos modos de control.
- main.js: `simIn.jset`/`edge.jset` (se consumen como los demás flancos).
- Arreglos 10-nov-2026 (revisión de dispositivos): en `.two` los glifos ya no se estiran (`min-width:4.7em` solo para `.key.tch`; glifos
  centrados en su columna); encendido, la tecla de COLOCAR del teclado sale verde (J naranja, K verde). Táctil: «[GOLPEAR] Rematar /
  [COLOCAR] en salto» (no «COLOCAR Colocar») y sin la línea de consejo «GOLPEAR remata · COLOCAR coloca» mientras se ve el aviso (con
  «Avisos» apagado sigue saliendo). Panel Controles (teclado y mando): «Colocar en salto (en el aire, 1.er o 2.º toque; en el 3.º, dejada; en
  el suelo salta)»; en táctil el botón no sale en el 3.er toque. `nav` de mando: X/□ (COLOCAR, que también manda `jump`) ya no hace «volver».
  badges.js: la cuenta de reserva del colocador (sin `assist`) incluye la colocación en salto del 1.er toque.
- Herramientas: `tools/jsetdrill.js` (prepara un 2.º toque en el juego real y pulsa SALTAR y, en el aire, COLOCAR con el dispositivo de cada
  herramienta). drive.js: Espacio + K y clic derecho + clic central; touchplay.js: SALTAR + botón COLOCAR (comprueba que solo sale en el aire,
  ≥ 44 px y sin pisar joystick/GOLPEAR/SALTAR); padplay.js: B + X. Capturas en tools/out/colocar/.

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

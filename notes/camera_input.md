# notes/camera_input.md — cámara y controles (owner: camera_input)

Estado: `js/camera.js` y `js/input.js` reescritos. Interfaces de CONTRACT.md §4 intactas.
Nada de lo de abajo es obligatorio para que funcione: son añadidos OPCIONALES y peticiones a otros owners.

## Añadidos (funciones/campos opcionales)

### VB.CameraRig
- `slowmo(scale, realSeconds, easeOut?)` — 3er parámetro opcional: segundos (reales) de vuelta suave a 1.
  No pisa una cámara lenta más intensa en curso. Solo descuenta tiempo si no está en pausa.
- `kick(deg)` — "punch" de FOV (zoom rápido que vuelve solo). Lo usa la propia cámara en remates/bloqueos propios.
- `getShot()` → `'menu'|'serveUs'|'serveThem'|'rally'|'attack'|'defend'|'point'|'over'` (depuración).
- `getDebug()` → `{shot, yaw, pitch, fov, ballNdcX, ballNdcY, ctrlNdcY, ballVisible, pfd}` (depuración/tests).
- Lee `ctx.settings.camSens` (0,5..1,5): rapidez de seguimiento en los planos de juego.
- Respeta `prefers-reduced-motion` (temblor al 30 %, sin punch de FOV).
- La cámara reacciona sola a los eventos (no hace falta llamarla desde fuera):
  remate → temblor + punch; remate humano → micro‑pausa (hit‑stop 0,09 s a ×0,3; solo partido humano, no autopilot);
  bloqueo → temblor; balón a la red (no cinta) → temblor leve; punto de set → ×0,5 0,8 s; punto de partido → ×0,28 1,9 s.
  Vibración del mando/móvil en los toques del humano vía `VB.Input.rumble`.
- `getBasis()` ahora es la base de la cámara DE JUEGO limitada a ±26° de "hacia la red" y congelada durante
  planos cinemáticos (punto, fin, menú): los controles nunca dan bandazos.
- Usa `camera.filmOffset` en el menú (desplaza la imagen ~13 % a la derecha para que la pista no quede bajo
  el panel del menú, que está a la izquierda) cuando `ctx.width > 760`. Vuelve a 0 al jugar.

### VB.Input.poll() — campos nuevos en el objeto devuelto
- `confirm` (flanco): Intro / A / Start. Útil para menús.
- `hitHeld`, `jumpHeld`: golpear/saltar MANTENIDOS (teclado, táctil o mando). Por si sim quiere saltos
  variables o "cargar" el saque en el futuro.
- `device`: `'keyboard'|'gamepad'|'touch'` (último dispositivo usado; arranca en `'touch'` si `ctx.isTouch`).
- `VB.Input.rumble(strength0..1, ms)`: vibración corta (mando con `vibrationActuator` o `navigator.vibrate` en móvil). Silenciosa si no hay soporte.
- `VB.Input.resize()`: recalcula el tamaño del joystick (main ya llama `resize` a todos los módulos).

### Mapeo
- Teclado por `e.code` (vale en AZERTY/QWERTZ) con reserva por `e.key`; ignora auto‑repetición y combinaciones
  con Ctrl/Alt/Meta; si se pulsan dos direcciones opuestas, gana la última.
- Mando (mapeo estándar): stick izq./cruceta mover · A golpear · B o X saltar · RB/LB/Y cambiar · Start pausa · Select sonido.
  Zona muerta radial 0,18 con reescalado y curva suave.
- Táctil: joystick flotante (mitad izquierda; aparece donde pones el dedo; guía tenue "MOVER" abajo a la izquierda en reposo),
  GOLPEAR (naranja, grande; dice "SACAR" en tu saque y brilla en amarillo cuando tu jugador llega al balón),
  SALTAR (azul), botón pequeño de CAMBIAR (⇄) y pausa arriba a la derecha. Zonas seguras (notch) respetadas.
  El overlay se oculta solo si se juega con teclado/mando y vuelve al tocar la pantalla.

## Pasada de acabado (6-nov-2026, PC de casa)

Hecho en `js/camera.js`:
- **Temblor del remate escalado** por `e.power` (0..1; si falta, se deduce de `e.speed`) y `e.grade`
  (`perfect` ×1,25, `good` ×1, `poor` ×0,75). También el punch de FOV, la vibración y el hit-stop (0,12 s si es perfecto).
  La dejada (`kind:'free'`) no tiembla. Medido en la página (desplazamiento máx. de la cámara en 0,4 s):
  remate rival potente/perfecto 0,149 m · flojo/malo 0,048 · dejada 0 · bloqueo `stuff` 0,086 · bloqueo `soft` 0,033 ·
  plancha ajena 0,016 · saque en salto 0,031.
- **Bloqueo**: `result==='stuff'` (o sin campo) pesa (temblor + punch si es nuestro); `soft`/`tool` suave.
- **Plancha** (`dive`): temblor pequeño (mayor y con vibración si es el jugador que llevas).
- **Saque en salto** (`hit` `kind:'serve'`, `shot:'jump'`): golpe seco pequeño.
- **Encuadre en la red (petición de foundation)**: si el jugador controlado está a < 2,4 m de la red y el balón está en
  campo rival con el rival construyendo (o acaba de bloquear), la cámara sube ~1 m, se aparta ~1,25 m hacia el lado del
  balón y baja un poco el encuadre: se ve al rematador por encima del hombro del bloqueador. Entra en ~0,3 s y sale en ~0,6 s
  (factor suavizado `netK`, visible en `getDebug().netK`).
- `snap()` (escenas congeladas) ya aplica el apartado anti-oclusión del compañero (antes solo se aplicaba con dt > 0).

Hecho en `js/input.js` (overlay táctil):
- GOLPEAR dice **SACAR** durante todo nuestro saque (también con el balón lanzado, `serveState:'toss'`); brilla tras el
  silbato (`g.serveAuth`) y, con el balón en el aire, en el momento de golpear (`Sim.hitWindow(g, server).t` ∈ [−0,06, 0,14]).
- **SALTAR ya no se apaga en nuestro saque** antes de lanzar (es el saque en salto); se apaga con el balón lanzado y en el saque rival.

Verificado: `console.sh` sin errores en menu serve rally spike block point switch toss jumpserve dive mobile over pause
(+ rally/mobile con `live=1`); `simtest.js 10 12345 0` → TODO OK; juego real (autopilot, 40 s, viewport exacto con
`Emulation.setDeviceMetricsOverride`): 1280×720 balón en pantalla 98,8-100 % de los frames de peloteo, jugador 97-99 %,
0 NaN, giro máx. 37°/s; 844×390: 99,1 % / 99,1 %, 29°/s.

## Aplicado (log)
- 6-nov-2026 (Integrate, PC de casa): escena `switch` (ya estaba en main.js). Herramientas con viewport exacto: `tools/cdp.js` (lo usan shot.js, shot.sh,
  console.sh, eval.js y drive.js). El arnés `camtest.js` se escribió en el scratchpad de otra sesión y no está en este PC: no se añadió.
- Pendiente para Review (de notes/arena.md): en alguna captura antigua (drive-3-juego) el compañero salía cortado muy cerca de la
  cámara. En la captura de Integrate no se reproduce; revisar con `probe.js` si el compañero entra a < 2 m de la cámara.

## Review 1 — arreglos de cámara (fixer camera_input, 6-nov-2026 tarde)

Partí del trabajo a medias de una pasada anterior (tools/out/cfix) y lo completé/verifiqué:
- **Anticipación del cambio** (nuevo, `updateAnticipation`): con el rival construyendo y nuestro jugador delante (en la red),
  el sujeto se desliza ya durante su recepción/colocación hasta el 72 % del camino al compañero de atrás, y el cabeceo
  mete los pies del defensor a ~-0,8 NDC. En nuestra colocación (touchTeam 0, 1 toque, controla el colocador) se abre
  un 36 % hacia el rematador. Al llegar el evento `switch`, lo recorrido pasa al deslizamiento (sin salto).
  Medido (swstat.js, 50 s): cambios en defensa con el nuevo jugador fuera de cuadro 0,20-0,24 s -> 0-0,05 s (1280) y
  0,22 -> 0,13 s (844); oscilación de cabeceo <= 15° en todos los cambios; ritmo de cabeceo limitado a 40°/s (confort 30°/s).
- **Remate propio**: cámara más alta (h 3,6) y por encima del hombro 2,3 m hacia el lado al que está desplazado el
  bloqueador rival (antes: lado contrario al balón, que lo dejaba justo detrás del rematador), con histéresis.
- **Compañero pegado a la cámara**: se aparta en planta hasta 2,6 m.
- **Punto**: la mira calcula su altura para dejar el bote a -0,42 NDC a cualquier distancia (antes, de lejos, quedaba
  bajo el rótulo); bote al otro lado de la red -> cámara a >= 4,2 m de la red y 4,6 m de alto; ningún jugador a < 2,8 m;
  el desplazamiento de la mira hacia la pista escala con la distancia. Escena congelada `point`: plano ya asentado.
- **Confort**: el temblor al 30 % también con `settings.camStable`; desplazamiento lateral del remate al 60 %.
- **Móvil**: el balón no sube por encima del 13 % superior (la franja de toques del HUD es más alta).
- Aro del punto de juego bajo HUD/botones (landstat.js, 40 s): 0 de ~2280 fotogramas a 1280 y a 844 táctil.
- input.js: botones táctiles con >= 16 px de separación (844x390: GOLPEAR-SALTAR 18 px, CAMBIAR-GOLPEAR 18 px).

## Peticiones a otros owners
Ninguna pendiente.

## Aplicado (log, integración tras Review 1)
- sim.js guarda `g.lastLand` (primer bote del rally; `null` en serveReady). La escena `?debug=point` ya lo usa.
- Pendiente para Review 2 (visto en integración): a 844×390 en `debug=rally` los pies del colocador salen por abajo
  (`ctrlNdcY` -1,04; a 1280 -0,76). Es la regla "cadera por encima de -0,84, pies pueden salir"; el aro de foco sí se ve.
  El sacador rival en móvil sigue siendo pequeño (~45 px).

## Review 2 — arreglos de cámara y táctil (fixer camera_input, 6-nov-2026 noche, RTX 3060 Ti)

js/camera.js:
- **Saque propio** (`serveUs`): cámara a 5,4 m sobre el hombro y FOV/cabeceo AJUSTADOS (`fitServe`): línea de fondo rival a
  0,55 NDC (0,62 en móvil), pecho del sacador abajo (-0,88; táctil -0,70) y, con el balón lanzado, la cumbre prevista
  del lanzamiento por debajo de 0,72 (el FOV "respira" unos grados en el saque en salto). Campo rival: 1280x720 59 -> 122 px
  (17 % del alto); 844x390 táctil 32 -> 61 px; 844x390 sin táctil 66 px. (A >= 25 % no se llega sin perder al sacador:
  el campo rival está a 14-23 m; ver known issues del informe.)
- **Plano del punto rehecho** (`planPoint`/`pointShot`): 0,45 s mirando caer el balón y CORTE (o deslizamiento si el plano
  está en el mismo campo y cerca) a un plano bajo (1,65-1,9 m) y cerrado (FOV 32-35°) del bote + el que falló (infractor,
  el último que tocó del que pierde o el más cercano) + el que ganó si está cerca y en el mismo campo. Se elige entre 48
  posiciones puntuando: zona libre, >= 2 m de postes/silla/2º árbitro/mesa/jueces y de los jugadores, sin la red delante,
  nadie tapando, nada grande en primer plano (oficiales, jugadores ajenos, balón suelto), protagonistas enteros y a >= 4,3 m,
  y el que ganó al fondo. El borde superior nunca corta el marcador colgado. Ace con recepción desviada lejos: el foco es el
  receptor. Vuelta al saque: corte si el plano nuevo está al otro lado de la red o a > 11 m; si no, deslizamiento.
- **Límite de velocidad angular en todos los planos**: juego 40/70 °/s, saque rival 50 °/s de giro, vuelta al saque 55,
  punto/fin 60, menú 25; confort 30 (menú 20). Medido (probe3, 45 s): fuera de los cortes deliberados, máx. 40 °/s en
  rally/ataque/defensa y < 60 °/s en las transiciones.
- **Remate propio en el aire**: +0,7 m de altura, el salto ya no sube la cámara (zf x0,4) y desplazamiento lateral x1,35;
  con el bloqueador en línea, hacia el centro (campo abierto). Se ven bloqueadores y campo al lado del rematador.
- **Ataque rival con un compañero nuestro en la red**: la cámara se aparta hasta 2,2 m (lo justo para que la línea
  cámara->balón pase a ~1 m de él) y sube hasta 0,8 m (`mOcc`).
- **Táctil**: jugador más arriba (pies a ~-0,40 NDC; cadera por encima de -0,55, de -0,70 en el remate), fuera del joystick
  y de los botones en horizontal, y el compañero fuera de los botones cuando colocas tú. Balón por debajo de 0,62 NDC
  (cumbre prevista de la colocación en el remate y en táctil, compensación del retraso del cabeceo limitado con FOV, tope
  16° en remate/táctil, apertura de FOV más rápida). probe 40-45 s: balón tras el HUD en ataque 281/1451 -> 0/931 (844x390)
  y 175/1053 -> 0/709 (667x375); compañero tras un botón 281/4338 -> ~48/2600 (844) y 116/3664 -> ~29/1800 (667).
- **Menú**: elipse y = 9,5 (antes llegaba a y = -13, encima de la silla del árbitro) y +1,2 m en las laterales.
- Añadidos opcionales: `getDebug().pf` (plan del plano del punto), `_setOrbit(a)` (pruebas del menú).

js/input.js:
- Botones en reposo (1,4 s sin tocar): opacidad .55 y escala .94. Con el jugador o el compañero detrás (pecho/cadera
  proyectados dentro del botón), opacidad .3. Al tocar o al brillar (`.ready`) vuelven a plena opacidad.

### Petición a ui_main (opcional, refuerzo)
Aplicada la atenuación de `#touchbar` (ver log). El fundido negro de 80 ms en el corte del punto NO se aplicó (opcional).

## Aplicado (log, integración tras Review 2)
- 6-nov-2026 (integración tras Review 2): ui.js atenúa `#touchbar` a .35 si el balón proyectado cae dentro de su rectángulo (+12 px; rect cacheado cada 32
  frames). camera.js: `switch.reason === 'defense'` → deslizamiento 0,6-0,85 s (petición de sim). input.js: `poll()` ya no crea
  `edge = {}` por frame. CONTRACT §4.4: `getDebug().pf`, `_setOrbit` y la convención de cortes del plano del punto.
  Pendiente (opcional, de sim): plano de transición durante `courtChange`.

## Petición de arena (7-nov-2026): plano del cambio de campo
Arena ya marca el momento de `courtChange` (marcadores "CAMBIO DE CAMPO" con flechas, vallas doradas, público aplaudiendo).
Para el plano de transición (opcional): `VB.Arena && VB.Arena.courtChangeT && VB.Arena.courtChangeT() > 0` mientras dura
(≈3,2 s tras un set, ≈3,8 s a los 8 del 3r set), y `VB.Arena.landmarks.scoreHung = {x:0, y:0, z:11.4}` (sim) para mirar
al marcador colgado. Ver notes/arena.md §8.

## Cierre para publicar (7-nov-2026, PC de casa, RTX 3060 Ti): cambio de campo, táctil y mando robustos, coste

### js/camera.js
- **Plano `court` (cambio de campo)**: al llegar `courtChange` (solo partido, no demo), el plano de reacción del punto se ve
  1,45 s (1,25 s a los 8 del 3r set) y CORTE a una grúa alta por la banda de la mesa (y > 0; la silla del 1r árbitro no
  tapa la red): de encima del campo rival a detrás de nuestro equipo, 7,2 → 6,3 m de alto, ~85° de giro, mira casi fija cerca
  del centro (se ven los dos campos, los jugadores yendo a su sitio, el aviso "CAMBIO DE CAMPO" y el videomarcador). La duración
  se ajusta a la pausa real de sim (2,4 s tras un set con su cámara lenta; 2,0 s a los 8). Al empezar el saque, la grúa BAJA
  deslizando 1,4 s al plano del saque: sin corte. Base de control congelada durante la grúa; después, la de siempre (el humano
  sigue en x > 0). Modo confort: arco más corto.
  Medido (`tools/out/ci/courttest.js`, juego en vivo con autopilot hasta el evento): tras un set, 1280x720: 2,46 s de grúa, giro
  máx. 43-44°/s, cabeceo 6-7°/s, un único corte (reacción → grúa), base tras el cambio (-1, 0). A los 8 del 3r set: 2,06 s,
  56°/s. 844x390 táctil: 2,47 s, 43°/s. Capturas miradas en `tools/out/ci/shots/court-*`.
- `getShot()` puede devolver `'court'`; `getDebug().ccU` = avance de la grúa 0..1 (-1 fuera del plano).
- **Coste por frame**: `fitServe` creaba un objeto por frame (`fitLow = {…}`) → ahora reutiliza el suyo. El estado escalar del rig
  pasa de variables del cierre a campos de un objeto `K` (V8 guarda cada double de una variable de cierre como un HeapNumber nuevo
  en cada escritura). `clamp()` inlinado como `Math.min(Math.max())`. Comprobado que el encuadre es IDÉNTICO al anterior
  (`tools/out/ci/camcmp.js`: snap() de la versión anterior y de la nueva en 10 escenas a 1280x720 y 844x390, diferencia 0,0000).
  Muestreo de memoria en juego real (`tools/out/ci/alloctest.js`, HeapProfiler cada 64 B, 15 s tras 30 s de juego, 844x390
  táctil): la página asigna ~34 KB/frame, de ellos three.min.js ~26 KB; camera.js ~1,1 KB e input.js ~0,24 KB. Lo que queda
  en camera.js NO son objetos: son dobles encajonados mientras V8 ejecuta el código en Sparkplug/Maglev (log de V8 `--log-code`:
  gameplayShot no llega a Maglev hasta ~20 s de juego). No hay `new`, literales ni arrays por frame en camera.js/input.js.

### js/input.js
- **Gestor único de punteros** en todo el overlay (antes: un listener por botón + zona del joystick): cada dedo tiene un papel
  (`joy`/`hit`/`jump`/`sw`/`pause`/`none`) y el overlay captura el puntero.
  - Joystick + botones a la vez (multitáctil real); dos dedos en GOLPEAR cuentan bien (no se suelta al levantar uno).
  - Botones con margen de 16 px (GOLPEAR/SALTAR) y 8 px (⇄, pausa) para dedos gordos; gana el botón más "hondo".
  - **Deslizar** de SALTAR a GOLPEAR (o desde zona vacía de la derecha) pulsa el botón al que se llega: salto + remate de un
    gesto. Salir de un botón a zona vacía lo mantiene pulsado.
  - 2º dedo en la mitad izquierda: si se levanta el del joystick, lo hereda desde donde está.
  - pointercancel / lostpointercapture sueltan. **Dedos perdidos** (el SO se come el pointerup): si los touch events dicen 0 dedos
    y quedan punteros táctiles vivos > 0,12 s, se sueltan (`sweepLost`).
  - **Giro** con el dedo puesto (orientationchange, screen.orientation change, o resize que cambia la orientación o > 30 %): se
    suelta todo. Cambio pequeño (barra del navegador): el joystick sigue y su base se recoloca dentro. Un dedo que sigue puesto
    tras un reinicio (giro, blur) se ADOPTA como joystick al moverse en la mitad izquierda (en los botones no: pulsaría solo).
  - **Zonas seguras**: sonda `.vt-safe` con `padding: env(safe-area-inset-*)` (se relee al medir, cada ~30 frames): la base del
    joystick nunca nace bajo el notch ni la barra de gestos; la guía de reposo tampoco. Los botones ya usaban env().
  - Origen del overlay cacheado: sin getBoundingClientRect por pointermove. `#touch.on` con `touch-action:none`.
  - Oclusión de los botones (jugador detrás → transparente) 1 de cada 3 frames.
- **Mando**:
  - Varios mandos: manda el último que se usa (flancos por mando: cambiar de mando no pierde ni duplica pulsaciones).
  - **Si se desconecta el mando con el que juegas en pleno partido → PAUSA** (una vez; con evento o, si el navegador no lo emite,
    detectada por sondeo) y el dispositivo vuelve a teclado/táctil. Si juegas con teclado, desenchufar un mando no pausa.
  - **Mapeo no estándar** (`mapping !== 'standard'`): ≤ 11 botones = tipo XInput (A 0, B/X 1-2 saltar, Y/LB/RB 3-5 cambiar,
    Back 6 sonido, Start 7 pausa); si no, DirectInput genérico (Select 8, Start 9). Cruceta: botones 12-15 si hay ≥ 16 botones;
    si no, eje hat `axes[9]` (-1 arriba … +1 arriba-izq. en pasos de 2/7, reposo ~1,29) SOLO tras ver su valor de reposo (un eje
    que reposa en 0 no se lee como "abajo").
  - Zona muerta radial 0,18 con reescalado (deriva de 0,12-0,175 en reposo = 0; a 0,3 respuesta pequeña y continua; diagonal a
    fondo |v| = 1). Ejes NaN → 0.
  - `getGamepads()` (crea un array por llamada) solo cada 30 frames hasta ver el primer mando.
- **Añadidos opcionales** (para CONTRACT §4.4): `VB.Input.padInfo()` → `{connected, id, mapping}` (ya lo usa tools/padplay.js);
  `poll().padEvent` = `''|'connected'|'disconnected'` (un frame); `VB.Input._debug()` (pruebas: punteros, joystick, zonas
  seguras, geometría de botones, contadores de pulsaciones/flancos/deslizamientos/dedos perdidos, mando).

### Pruebas (scratch en tools/out/ci/, que git ignora; el lead puede subirlas a tools/ si quiere conservarlas)
- `node tools/out/ci/touchtest.js [WxH]`: 30 comprobaciones con `Input.dispatchTouchEvent` reales (touch + pointer events):
  multitáctil, deslizar, zona vacía → botón, touchcancel, dedo perdido (pointerup bloqueado en captura), dos dedos en un botón,
  herencia del joystick, blur + adopción, barra del navegador, giro a vertical y vuelta, zonas seguras
  (`Emulation.setSafeAreaInsetsOverride` 44/44/0/21) y pausa. **TODO OK** a 844x390, a 667x375 y a 844x390 con CPU ×4 y DPR 2.
- `node tools/out/ci/padtest.js`: 25 comprobaciones con un `getGamepads()` falso: conexión a mitad de partido, zona muerta,
  flancos, 2º mando, desconexión con y sin evento → pausa, mando olvidado que no pausa, DirectInput con hat, XInput no estándar.
  **TODO OK**.
- `node tools/out/ci/courttest.js set|eight [WxH] [touch]`: **TODO OK** (números arriba).
- Herramientas de ui_main con estos cambios: `tools/padplay.js 1280 720 25` TODO OK (incluye "desconectar el mando en pleno
  partido lo pausa"); `tools/touchplay.js 844x390,667x375 30` TODO OK; `tools/drive.js 1280 720 25` TODO OK;
  `tools/console.sh all 1280 720` y `TOUCH=1 tools/console.sh all 844 390` sin errores JS; `simtest.js 10 12345 0` TODO OK.

### Peticiones (opcionales)
- **ui_main** (ui.js): cuando `it.padEvent === 'disconnected'` llegue con la pausa, mostrar en ella "Mando desconectado ·
  conéctalo o sigue con el teclado". Hoy la pausa sale sin explicar por qué.
- **integrador**: CONTRACT §4.4: añadir `getShot()` `'court'`, `getDebug().ccU`, `VB.Input.padInfo()`, `poll().padEvent` y
  `VB.Input._debug()`; y en la convención de cámara: "el cambio de campo usa un corte deliberado (reacción → grúa) y baja sin
  corte al saque". En TRASPASO, "plano de transición durante `courtChange`" pasa a hecho.

## Respuesta de ui_main (7-nov-2026)
- Hecho: la pausa por mando desconectado dice "Mando desconectado" (ui.js `UI.padEvent(kind)`, main.js lo llama con
  `it.padEvent`; "Mando conectado" como aviso corto si se reconecta jugando). Texto corto (sin "o sigue con el teclado": en el
  móvil sería el dedo). `tools/padplay.js` lo comprueba.
- `tools/touchplay.js` (844x390 y 667x375) juega con `Input.dispatchTouchEvent` multitáctil sobre el overlay: TODO OK. Nota de
  CDP medida: `touchEnd` debe llevar SOLO los dedos que se levantan; un `touchMove` sin un dedo no lo suelta.
- Asignaciones atribuidas a camera.js (`ALLOC=1 node tools/perf.js 844x390 15 medium 1`, KB/s a ~160 fps, opcional):
  `gameplayShot` (~227) 230-310, `framing` (~729) 245, `apply` (~849) 97, `pickShot` / `onShotChange` pequeñas.

## Aplicado (log, integración de pendientes)
- 7-nov-2026 (integración de pendientes): CONTRACT §4.4 (`getShot()` `'court'`, `getDebug().ccU`, `VB.Input.padInfo()`, `poll().padEvent`, `VB.Input._debug()`) y convención de
  cámara del cambio de campo; TRASPASO: plano de transición hecho. Pruebas promovidas de `tools/out/ci/` a `tools/touchtest.js`,
  `tools/padtest.js` y `tools/courttest.js` (rutas a `cdp.js` y capturas en `tools/out/ci/shots/`). Ejecutadas tras la integración:
  touchtest 844x390 30 ok, padtest 25 ok, courttest set 1280x720 y eight 844x390 táctil 8 ok cada una.
- NO aplicado (opcional): asignaciones restantes de camera.js (números encajonados de V8, no objetos).

## Verificación ronda 1 — arreglos táctil/mando (fixer camera_input, 7-nov-2026, RTX 3060 Ti)

js/input.js:
- **Brillo de GOLPEAR/SACAR con el reloj del aro amarillo**: `.ready` ya no es `canReach()` (se encendía de media 0,047 s
  antes del instante ideal: siempre tarde). Ahora `hitWindow(g, ctrl).press` ∈ (−0,15, 0,24) en el rally (si `g.jobs[0] === ctrl`
  o `canReach`; no en bloqueo) y con el balón lanzado en tu saque. Además un **aro que se cierra** sobre el botón (`.vt-ring`,
  escala 1,8 → 1 entre press 0,75 y 0; clase `.cue` en el botón): toca el borde en el instante ideal, como el aro de fx.js.
  Al pulsar SACAR para lanzar, el brillo del silbato se apaga en el acto (antes seguía un frame con el balón ya lanzado).
  Medido con los scripts del verificador (`tools/out/verify-1-touch-pad/verify-input/`):
  - `servehuman.js 844x390 8`: reacción 100 ms 8 good · 150 ms 7 perfect 1 good · 200 ms 6 perfect 1 good 1 poor ·
    250 ms 7 perfect 1 good (antes: 200 ms 8 poor, 250 ms 8 poor). Brillo encendido a t ≈ 0,30 s del contacto (antes 0,13).
  - `CUE=glow humanplay.js`: 844x390 RT 200 → 12 perfect, 5 good, 1 poor (antes 11 de 11 poor); 915x412 RT 120 → 7/7/3
    (antes 1 good, 11 poor); 844x390 RT 250 → 5/9/5. Sin errores de página.
- **Base del joystick** limitada también al seguir al dedo (≤ 62 % del ancho, fuera del notch); el pomo se queda en el borde.
  touchverify T2: ox 523/414/567 = límite exacto a 844/667/915 (antes 716/542/784, encima de SALTAR/GOLPEAR).
- `preventDefault` solo si `e.cancelable` (touchmove, pointerdown/move, contextmenu, dblclick, gesturestart): touchverify2 a
  915x412 sin "[Intervention] Ignored attempt to cancel".
- **1r toque tras jugar con mando** (overlay oculto): `pointerdown` en captura sobre `window` → si es táctil, en partido, y no
  cae en un control de la UI (`button,a,input,select,textarea,[role=button],[data-ui]`), muestra el overlay al instante y le pasa
  el dedo (`onPtrDown(e, true)`, sin stopPropagation; el overlay lo captura). padverify: toque en GOLPEAR → press.hit +1, out.hit +1;
  dedo a la izquierda → joystick (mx 1).
- **Hat de un mando DirectInput** cuenta como actividad en `padActive()` (tras ver su reposo > 1,05 en ESE mando): padverify
  "hat arriba → hacia la red" my 1, mando activo idx 3.

js/camera.js:
- **Saque propio en pantalla baja** (`fitServe`): el encuadre táctil (pecho a −0,70, línea de fondo +0,07) también si
  `ctx.isMobile` o el alto < 480 px, aunque el overlay esté oculto (mando). 844x390 móvil + mando: cabeza −0,68 → −0,53 NDC,
  pecho −0,86 → −0,69 (con el balón lanzado −0,58). 1280x720 de escritorio no cambia.

### Petición (opcional) a ui_main
- ui.js muestra "¡Golpea!"/"¡Golpea ahora!" con `hitWindow().t` < 0,18-0,22 (≈ press < 0,11-0,15): llega ~0,1 s después que el
  brillo del botón. Para que las dos señales coincidan: en el rally y en el saque lanzado, usar
  `w.press > -0.15 && w.press < 0.24` (con `w.press = w.t - VB.C.WINDUP`) en lugar de `w.t < 0.22 && w.t > -0.06` / `w.t < 0.18 && w.t > -0.06`.

## Aplicado (log, integración ronda 1 de verificación, 7-nov-2026)
- Tu petición a ui_main: ui.js usa ya la MISMA ventana que el brillo (`HINT_ON = 0.24`, `HINT_OFF = -0.15` sobre `hitWindow().press`)
  en el rally y en el saque lanzado (ui_main la había puesto en [-0,06, 0,22), la ventana vieja del brillo). Mirado: jumpserve a 844×390
  táctil con «¡Golpea!» y SACAR encendido a la vez. simtest pasa a la misma ventana.
- CONTRACT §4.4: convención de la señal de golpeo (una sola ventana en input/ui/fx/simtest), `.vt-ring`/`.cue` y el `pointerdown` en captura con `data-ui`.
- Ejecutado tras la integración: touchtest 844x390 30 ok, padtest 25 ok, courttest set 1280x720 8 ok, touchplay y padplay TODO OK.

## Verificación ronda 2 — mando con deriva, basura de la cámara, compañero cortado en móvil (fixer camera_input, 7-nov-2026)

### js/input.js — mando con deriva (major)
- La zona muerta (0,18 radial) se mide desde el REPOSO de cada mando, no desde 0. Reposo = ejes al conectar (`gamepadconnected`,
  o la primera vez que se ve el mando); se reaprende cuando el stick lleva 1 s quieto (±0,02), sin botones y a < 0,4 del centro
  (2 s si en ese momento está moviendo al jugador); si el stick vuelve al centro real lejos del reposo guardado, el reposo vuelve a 0 al
  instante (sin tirón al lado contrario). El recorrido útil descuenta la deriva (a fondo sigue dando 1). Mando sano (reposo < 0,18):
  el stick crudo < 0,18 también es zona muerta, como antes.
- El stick solo convierte el mando en dispositivo activo pasado 0,5 (como `padActive`) o con un botón: la deriva ya no esconde los
  controles táctiles ni cambia los glifos. Un mando que no es el activo solo sustituye a teclado/dedo si empuja más que ellos y > 0,26.
  Un toque (`pointerdown`) sigue ganando y ya nada lo devuelve al mando por deriva.
- `VB.Input._debug().pad.rest` = reposo aprendido del mando activo (pruebas).
- `tools/padtest.js` (mío): el empujón 0,3 ya no cambia el dispositivo (lo pide el arreglo); añadido el caso "stick > 0,5 → mando activo".
- Pruebas: verificador `vfollow.js` (deriva 0,24 jugando con el dedo: device touch, overlay visible, joystick arriba my 1,00),
  `vkbdrift.js` (flecha con deriva 0 / 0,12 / 0,17 / 0,24: mx 1,00 siempre, device keyboard), `vpad.js mobile` y `vpad.js desk` sin fallos
  (el "toques de peloteo" del de escritorio es estadístico: 3 en una pasada, 6 en las otras dos), padtest 26 ok, touchtest 30 ok,
  touchplay y padplay TODO OK, y `tools/out/drift/drift.js` (mando gastado con reposo 0,25 como mando activo: 11 casos ok).

### js/camera.js — basura por frame (minor)
- Causa medida (arnés de node con sim/ai reales, `tools/out/camalloc/`): Maglev, el compilador intermedio de V8, NO integra
  `Math.min/max/hypot/atan2/sqrt` (cada llamada creaba 1-3 HeapNumber, ~48 B) y la cámara pasa mucho tiempo en Maglev o en
  Sparkplug porque sus funciones (grandes) se llaman una vez por frame. Cambiadas por `mn/mx/hyp/hyp3/at2/sq` (comparaciones,
  `Math.pow(x, 0.5)`, `Math.atan`), que Maglev y TurboFan sí integran sin basura. Además: escalares entre funciones internas por
  campos de `K` (sin dobles en caja como argumento), `VB.toThree` en línea en `apply`, `SHOTS` con la misma forma en todos los planos
  y `comfort()` cacheado una vez por frame (sin lecturas de campos inexistentes).
- Regresión: misma partida con la cámara anterior y la nueva (40 000 frames, táctil y escritorio): posición, mira y FOV iguales a 1e-14.
- Medido: arnés node solo-Maglev 3,3 KB/frame → 1,4 KB/frame. Navegador (`perf.js ALLOC=1 low`, 844x390): camera.js 280-333 KB/s →
  147-233 KB/s según la pasada (la varianza es del JIT). NO baja de 20 KB/s; lo que queda no es de la cámara:
  - `--log-function-events` en Chrome: `gameplayShot` está en Sparkplug (todo doble en caja) de 7,9 s a 39,1 s y vuelve tras cada
    desoptimización; `framing` igual (2,6 s → 28,4 s).
  - **Para sim / players / integración (afecta a TODOS los módulos):** cada ~10 s hay desoptimizaciones en masa en todos los ficheros
    («dependent prototype chain changed»: a 18,7 s, 28,4 s, 37,3 s… salen update/framing de cámara, sim.step, players.update, arena,
    fx, ui, input a la vez). Justo antes, `--log-maps` registra un `map,Deprecate` (p. ej. sim.js:995 `toss`, 56,872 s → desopt. en masa a
    56,872 s). En 57 s de partido hubo 3835 mapas deprecados; los que más: three `setValues` (168), sim.js `doServe` L1051 (72), `step`
    L1166 (63), players.js `locomotion` L518 (57), `update` L1597/L1620 (~160), `aimHead` L1332 (~100), `onEvent` L1491/L1499 (~144),
    sim.js `stepServe` L1100/L1116 (~95), `toss` L995 (48). Suele ser un campo que cambia de tipo (nace entero `0` o `null` y luego
    recibe un double u objeto, o al revés) en objetos que se crean a menudo: inicializar con el tipo definitivo (`0.5`→0 tras crear, o
    `-1.5`, nunca `null`/`undefined` donde luego va un número) lo cortaría. Script: `tools/out/camalloc/deopt3.js` (log en
    `tools/out/camalloc/v8log/`).

### js/camera.js — compañero cortado abajo en móvil (minor)
- En táctil, si el compañero está entre la cámara y el jugador, dentro del cuadro en horizontal y con los hombros ya fuera por abajo
  (solo asoma la coronilla), se saca entero: cabeceando lo justo si el jugador y el aro (pMax) lo permiten; si no, subiendo la
  cámara hasta 0,9 m (`K.mateUp`, suavizado, vuelve solo). Si sus hombros se ven, se deja (figura por encima del hombro, como en
  escritorio). Estable por construcción (al sacarlo, sus hombros bajan más).
- `rally`/`mobile` a 844x390 táctil: ya no hay mancha entre el joystick y SALTAR (cabeza a -1,01 NDC). Escritorio sin cambios
  (regresión 1e-14). En un partido autopilot táctil actúa en el 19,5 % de los frames de juego, subida máx. 0,79 m, salto máximo de
  altura por frame igual que antes (0,123 m, de los cortes). `getDebug()` añade `mateLo` y `mateUp`.

## Aplicado (log, integración ronda 2 de verificación, 7-nov-2026)
- CONTRACT §4.4: `getDebug().mateLo/.mateUp`, `VB.Input._debug().pad.rest`; §6: padtest 26 casos.
- Tu hallazgo para sim/players (deprecaciones de mapa → desoptimizaciones en masa): aplicado con `dblFields` en sim.js (partido, jugadores, eventos),
  players.js (rig, Pose) y fx.js (pools). Log de V8 de 110 s tras el cambio: desaparecen las deprecaciones del rig y de `g` en mitad del juego; las
  ráfagas «dependent prototype chain changed» pasan de 116 desopt. (máx. 42 a la vez, t = 67 s) a 71 (máx. 20), casi todas antes de t = 52 s.
  `perf.js ALLOC=1 low`: camera.js 114 → 197 KB/s entre dos pasadas A/B (ruido del JIT y del perfil: no se puede concluir mejora de basura).
- `node tools/padtest.js` → 26 ok (el fallo que vio ui_main era el caso viejo, ya actualizado por ti). touchtest 30 ok, courttest set 8 ok.

## Aviso de sim (pulido ola 1, SIM-01/03): `point.highlight`, `point.hold` y pausa saltable (2026-11-07)
Ver notes/sim.md §P1. En partidos humanos (main.js pasará `present: true`):
- `point.hold` (s) = pausa real hasta el siguiente `serveReady` (o `gameOver`): 1,9 normal, 2,4 si `highlight ≥ 0,55`, **4,0 al
  ganar un set** (antes 3,4 y antes 3,6; pedido por CAM-09; el comentario de `courtShot` habla de 3,6: con la cámara lenta del set son ~3,9 s reales y la grúa
  acaba a ~3,85: cabe justa) y 4,2 en `'over'`. Sugerencia: `CC.len = Math.max(1.6, (e.hold || 3.6) * 0.67)` al recibir
  `courtChange` en vez de los 2,4 fijos, y el plano de reacción (`planPoint`) puede alargarse con `e.hold`.
- El jugador puede **saltar la pausa** (`VB.Sim.skipHold`, tras 0,8 s): `serveReady`/`newSet` llegan entonces 0,3 s después de
  pulsar. La cámara debe aceptar el `serveReady` en mitad del plano de reacción o de la grúa (cortar o deslizar al saque).
- `point.highlight` (0..1) para elegir planos: ≥ 0,55 = momento grande; ≥ 0,8 = clímax (bloqueo directo o remate perfecto con
  punto de partido). `point.digs`, `point.streak`, `point.savedSetPoint` dan el porqué.

## Aviso de audio (pulido ola 1, AUD-04): hit-stop y `ctx.timeScale` (2026-11-07)
- audio.js ya no trata como cámara lenta una bajada de `ctx.timeScale` de menos de **0,25 s reales**, ni nunca un valor < 0,04 (congelación):
  el chasquido suena a tiempo real y la grada no cambia. Tu `hitStop()` (0 × ≤ 150 ms + vuelta de 80 ms) puede poner `ctx.timeScale = 0` sin
  más; comprobado en la partida real con `hitStop(70)` y `hitStop(150)` (tono de audio 1,00) y con `slowmo(0.28, 1.9)` (entra a los 255 ms, ×0,6).
- Si algún día encadenas un hit-stop con una cámara lenta corta, el audio solo «baja» si la bajada dura ≥ 0,25 s.

## Pulido ola 1 — camera_input (2026-11-07, RTX 3060 Ti): CAM-01…CAM-07

### js/camera.js
- **CAM-01 cámara fuera del pabellón**: causa = `K.nearK` (apartarse del compañero) era un MULTIPLICADOR suavizado del vector cámara→compañero;
  tras un corte, un peso viejo de ~7 por un vector nuevo de ~10 m mandaba la cámara a x = 49-75 m (medido antes del arreglo: 163-303 frames
  fuera por partida de 120 s, a 1280×720 y a 844×390). Ahora: empujón acotado `unit(q)·max(0, 2,6 − |q|)·w` (w suavizado 0..1).
  `settle(g)` en CADA corte deliberado (reacción, vuelta al saque, grúa, final): todos los suavizados de juego a su objetivo (dt = 0), cámara en la
  posición/mira deseadas y el encuadre fino convergido (24 pasadas). Al entrar en un plano de juego desde punto/grúa/final/menú sin corte, los
  suavizados también arrancan en su objetivo. Límite DURO a cualquier altura y también con el temblor: |x| ≤ `freeX − 0,3`, |y| ≤ `freeY − 0,2`
  (grúa: `freeY + 0,7`), z ≤ `hallH − 3` (lee `VB.Arena.bounds`; respaldo 15,2 / 9,3 / 10,2 / 19). Órbita del menú dentro (15,0 × 9,1).
- **CAM-03 saque rival**: la vuelta del punto al saque se decide (y anuncia) durante el punto con la cámara del saque prevista (sim coloca a los
  jugadores en sitios fijos): corte si cruza la red, > 7 m, ΔFOV > 7°, pasa a < 1,6 m de un jugador o la cámara está baja (casi siempre: el plano de
  reacción va a 1,6 m con FOV 32-38°). Si no, **transición fija**: destino calculado una vez (asentado) y una sola curva monótona y sin
  sobrepaso (mínimo tirón `10s³ − 15s⁴ + 6s⁵`: probé la críticamente amortiguada desde reposo y daba un latigazo de 20 m/s en el primer cuarto;
  esta tiene velocidad y aceleración nulas en los extremos, pico 13 m/s en 4 m, relevo 0,07 → 0 m/s; `tools/out/camtest/fbtest.js`) en posición,
  giro, cabeceo y FOV, sin encuadre fino ni FOV de ayuda por el camino; presupuesto 0,8 s
  (`g.cpuTossIn` si sim lo da: lista 0,45 s antes del lanzamiento); si necesitaría > 0,9 s, cruza > 8 m, cambia el FOV > 8° o pasa a < 1,5 m de un
  jugador, corta. En el saque rival se encuadra desde el principio la CUMBRE del lanzamiento (4,75 m sobre el sacador): el plano no cabecea con el
  lanzamiento (antes 26-35 inversiones de cabeceo por minuto; ahora 0).
- **CAM-02 plano de reacción**: héroe (remate, ace, bloqueo, dejada, balón libre ganado y errores del RIVAL) = el último de su equipo que tocó el
  balón en el peloteo (el sacador en el ace; si no tocó nadie, el más cercano al balón) y su compañero si están a < 4,2 m. Cámara baja (1,6 m) en el
  campo del héroe, FOV 34° (hasta 38° para meter a los dos), héroe al 37-52 % del alto en un TERCIO (NDC x = ±0,42, con aire hacia donde mira; el
  centro queda para el rótulo), cabeza a 0,45 NDC; 192 candidatos puntuando el frente (≤ 60°, tres cuartos ~28°, de espaldas casi prohibido),
  perdedores ≤ 55 % de su altura o fuera de cuadro, nadie delante y sin postes/oficiales/balón en primer plano. Se recalcula en el instante del corte
  (0,45 s) con el frente de ese momento. Víctima SOLO en los errores propios del equipo humano, y nunca de espaldas. El héroe siempre entra por corte.
- **CAM-04 impacto**: `hitStop(ms, grade)` = `ctx.timeScale = 0` durante `ms` reales y vuelta 0,25 → 1 en 80 ms (remate perfecto 60, bueno 35, bloqueo
  directo humano 70, defensa perfecta de un remate rival 40, saque en salto perfecto 35; nada en confort). `punch(deg)` = impulso de FOV que cierra la
  lente en 1 frame (perfecto 3°, bueno 1,8°, malo 0) y vuelve con un muelle de ~150 ms, directo a la lente (`kick()` pasa a ser `punch()`).
  Bote dentro tras un remate (o > 13 m/s): temblor 0,035 m · 0,18 s y vibración `kill` si el punto es nuestro. Vibración con firma (ver input.js).
- **CAM-05 cortes para la UI**: `getDebug().cutN` (sube en cada corte deliberado), `.lastCut` `{from, to, kind: 'point'|'serve'|'court'|'over', t}`,
  `.nextCutIn` (s reales hasta el próximo corte programado; −1 = ninguno; 0 en el frame del corte). Cuenta la cámara lenta y el hit-stop en curso y el
  frame de retraso de sim; con `skipHold` sim deja 0,3 s (queda anunciado). `VB.CameraRig.clinchLeft()` = 0 hasta CAM-09.
  `getDebug()` añade `timeScale`, `hitStop`, `punch`, `shake` (desplazamiento del temblor este frame), `fb` (avance de la transición fija o −1) y
  `pf.mode` ('hero'|'vic'), `pf.how`, `pf.both`, `pf.team`, `pf.heroX` (NDC x donde queda el héroe), `pf.backCut`, `pf.score`, `pf.parts`.
- La grúa del cambio de campo dura lo que dure la pausa real (`g.timer` con la cámara lenta del set ya en marcha): acaba ~0,3 s antes del saque.

### js/input.js
- `VB.Input.rumbleSig(name, k)`: firmas `perfect` (dos toques de 25 ms separados 40 ms), `good` (45 ms), `poor` (sordo 0,25 · 110 ms), `body`, `won`
  (doble pulso), `lost` (uno flojo 0,3), `match` (tres crecientes), `kill`, `block`; en el móvil, patrones de `navigator.vibrate`. `rumble()` y
  `rumbleSig()` no hacen nada si `ctx.settings.rumble === false` (UI-16). `_debug().sigs` (pruebas) y `_debug().dead`.
- **CAM-07**: overlay al 25 % con balón muerto (`g.mode` 'point'/'over'; fundido 0,3 s, vuelve en 150 ms al saque; las zonas de pulsación siguen
  activas). ⇄ y SALTAR desactivados: borde discontinuo, sin relieve ni color, icono atenuado y un candado pequeño. ⇄ activo con disco oscuro (0,78) y
  al 82 % en reposo; joystick con disco oscuro (corona 0,62) y borde blanco 0,6.

### Medido (ejecutado)
- `node tools/camtest.js` (nuevo, ver abajo): antes del arreglo (copia en `tools/out/camtest/base/`) FALLAN bounds, cuts, servecut, settle, mono,
  reverse, hero y bbox en 6/6 partidas; después pasan bounds, cuts, cutcount, servecut, nextcut, settle, mono, reverse, bbox y ball (16:9, 4:3, móvil).
  `hero`: el héroe sale grande, en su tercio, el más grande y con los perdedores ≤ 60 % en casi todos los puntos, pero los rematadores junto a la red
  miran a la red (~95° de cualquier cámara de su campo) hasta que players los gire en la celebración (PLY-07): ver petición en notes/players.md.
- `tools/out/cam04/feel.js` (partido humano, eventos inyectados, mando falso): remate perfecto 60 ms congelado (3,6 frames a 60 fps), bueno 36 ms, malo 0;
  bloqueo directo 73 ms; defensa perfecta 42 ms; saque en salto 36 ms; punch 3,00° en el frame del contacto y 0,17° a los 200 ms; temblor 0,040 m en el
  frame del bote; firmas distintas perfect/good/poor y won/lost/match; `settings.rumble = false` → nada. TODO OK.
- CAM-07: `debug=point` táctil → opacidad calculada del overlay 0,25; en vivo baja en 0,3 s y vuelve en ~150 ms con el saque. Sobre gris medio
  (`tools/out/cam07/contrast.js`): disco de ⇄ 3,1:1 (reposo) / 3,3:1, icono ⇄ vs disco 10-11:1, corona del joystick activo 3,1-3,25:1 (la guía de
  reposo «MOVER» se queda tenue a propósito, 50 %).
- courttest set 1280×720 y eight 844×390 táctil TODO OK; touchtest 30 ok; padtest 26 ok; padplay y drive TODO OK; touchplay: 2 fallos en el MENÚ
  («tocar NIVEL cambia la dificultad», ui.js en obras por UI-06); el resto (overlay en partido, joystick, botones, pausa) bien.
  simtest 10 12345 0 TODO OK; console.sh all 1280×720 y táctil 844×390 sin errores; perf.js 844×390 medium 78,9 fps / 196 k tri / 46 draws,
  low 84,6 fps / 81 k / 33 («objetivos cumplidos»; CPU del PC al 74-79 % por los otros agentes).

### tools/camtest.js (nuevo, de camera_input)
`node tools/camtest.js [s=75] [semillas=7,12345,3] [tamaños=1280x720,1680x720,1024x768,844x390t]` (SPEED=2, PAR=4, LOG=1, ONLY=…): partidas en vivo con
autopilot y registro por frame tras `CameraRig.update`. Comprobaciones: bounds, cuts, cutcount, servecut, nextcut, settle, mono, reverse, hero, bbox, ball
(21:9 en defensa = aviso hasta CAM-12) y fovrate. Sale con 1 si algo falla (STRICT=0 lo evita). Escribe solo en `tools/out/camtest/`. ~2,5-5 min.

### Para el integrador
- CONTRACT §4.4: `VB.CameraRig.hitStop(ms, grade)`, `punch(deg)`, `clinchLeft()`, `getDebug().cutN/.lastCut/.nextCutIn/.timeScale/.hitStop/.punch/.shake/.fb`,
  `pf.mode/.how/.both/.team/.heroX/.backCut`; `VB.Input.rumbleSig(name, k)`, `ctx.settings.rumble` (false = sin vibración), `_debug().sigs/.dead`.
  Convención de cámara: «el plano de reacción del héroe siempre entra por corte a los 0,45 s; la vuelta al saque se anuncia en `nextCutIn` y casi
  siempre es corte; la grúa del cambio de campo, siempre por corte».
- CONTRACT §6: añadir `node tools/camtest.js` (ver arriba).

## De players (pulido ola 1, PLY-07), 2026-11-07 — informativo
- Tras un punto ganado (salvo el que cierra el partido) la pareja ganadora se junta para chocar las manos: el que hizo el punto
  (`g.lastPlayer` del equipo que gana; sin él, a medio camino) se mueve como mucho 1,2 m y el compañero hasta 4 m, entre ~0,15 s y ~1,6 s
  del punto (contacto hacia 0,7-1,5 s). Es un desfase VISUAL de la raíz: la sim no se mueve. Si el plano de reacción encuadra con
  `p.x/p.y`, el compañero entra en cuadro andando hacia el héroe (bien); si se quiere encuadrar a los dos, usar
  `VB.Players.rigOf(p).root.position` (Three) en vez de la posición de la sim. En `serveReady` el desfase vuelve a 0.
- El galón del jugador controlado se apaga solo a menos de ~6 m de la cámara y en el saque propio (el aro del suelo lo marca).

## De ui_main (pulido ola 1, UI-04/UI-05), 2026-11-08
1. **`VB.UI.bannerRect()`** ya existe (CAM-18): rectángulo en px CSS `{left, top, right, bottom, width, height, x, y}` de lo visible del
   banner (cinta + subtítulo + chip) o `null` si no hay banner. La cinta de nivel 2 (UI-03) se coloca DESPUÉS del corte al plano de
   reacción evitando las cajas de `pf.hero`/`pf.vic`; en escritorio va al tercio inferior (izq./dcha.) y en táctil o alto ≤ 560 px a la
   franja alta. `VB.UI.onHoldSkip()` (main.js, al recortar la pausa con SIM-03) funde lo del punto en 120 ms.
2. **Vibración antes de un gesto** (visto con `TOUCH=1 node tools/out/ui1/clock.js 844x390`, escena `debug=serve&clock=1` que acaba en la
   falta de 8 s): Chrome registra un error de consola `Blocked call to navigator.vibrate because user hasn't tapped on the frame…`
   (`js/input.js`, líneas ~610 y ~648). `tools/console.sh` lo cuenta como error si una escena lo dispara. Propuesta (las dos llamadas):
   ```js
   var ua = navigator.userActivation; if (ua && !ua.hasBeenActive) return; // sin gesto previo no se puede vibrar (y ensucia la consola)
   ```
   justo antes de `navigator.vibrate(...)`.
3. Comprobado para UI-05 (no hace falta cambiar nada): durante el lanzamiento del saque `VB.Sim.hitWindow(g, server).press` cuenta de
   forma continua hacia el contacto de BAJADA (0,85 → 0; medido), así que el brillo de SACAR (`press` en (−0,15, 0,24)) se enciende con el
   balón ya bajando, igual que «¡Golpea ahora!» de ui.js. La barra del aviso «Espera… golpea al bajar» usa ahora ese mismo `press`.

## Pulido ola 1, segunda pasada — camera_input (2026-11-08, RTX 3060 Ti)

### CAM-02: el plano de héroe ya funciona… con un acuerdo con players
- **Diagnóstico** (camtest ampliado: dice quién es más grande y por qué): con la convergencia de PLY-07 el héroe se gira hacia su
  compañero y este acaba a 0,85 m DELANTE de él; desde cualquier sitio que le vea la cara al héroe (≤ 70°), el compañero queda igual de
  grande o más (0,46 vs 0,466) y a veces cruza delante del objetivo al 61 % del alto. Sin cambiar la coreografía es geometría imposible:
  2/36 planos bien en la pasada anterior; 1-4 % en 300 s.
- **Acuerdo cámara↔players** (nuevo `VB.CameraRig.heroShot()`): la cámara elige su sitio y PUBLICA la coreografía que se filma bien
  (`planHeroShot`): el héroe se queda y se gira hacia la cámara (abierto 35° hacia su compañero); el compañero va a un sitio a su lado y
  detrás (0,8 m más lejos de la cámara, 0,9 m de lado, hacia el centro del cuadro: el héroe mira hacia dentro), abierto también a la
  cámara; se miran solo en el choque. Candidatos: 24 ángulos × 5 tamaños (38-54 %) × 2 lados × 2 composiciones (tercio ±0,42 o abierta
  ±0,55; en 21:9 sin táctil hasta ±0,68; a la izquierda castigada: los brazos en alto se meten bajo el marcador), puntuando el camino del
  compañero (4 muestras + su sitio de la sim por si no llega a venir), perdedores ≤ 50 % con su posición a 0, 0,5 y 1 s, cuerpos cortados
  por el borde con el medio ancho real a esa distancia, postes/oficiales/balón. Poda en cuanto un candidato no puede ganar: 0,9 ms más que
  el plano antiguo, una vez por punto, con la CPU ×4 (`tools/out/cam02/plancost.js`). Zona de la cámara del héroe ampliada a la zona libre
  real (|x| ≤ 14,6, |y| ≤ 9,1 de `VB.Arena.bounds`): junto a la banda cabe a ≤ 5,7 m de un héroe en la red y deja fuera al rival de enfrente.
- La cámara solo usa el acuerdo si `VB.Players.heroShotAware === true`. **Parche exacto para players en notes/players.md** (probado con
  `tools/out/cam02/mkproj.js`, que genera una copia parcheada en `tools/out/cam02/proj`). Sin él: plano antiguo, con el camino del
  compañero vigilado (ya no cruza delante del objetivo).
- **Medido con el parche** (`PAGE_ROOT=tools/out/cam02/proj node tools/camtest.js`): TODO OK; héroe 19/19 (1280×720), 18/18 (1680×720),
  18/18 (1024×768), 17/18 (844×390 táctil); CPU experta 37/40; el héroe siempre es el que anotó. Capturas en `tools/out/cam02/shots/`
  (`heroshots.js`) y secuencia del choque de manos en `tools/out/cam02/seq/` (`seq.js`): el compañero entra por detrás, más pequeño, se
  miran en el choque y vuelven a la cámara. La UI ya coloca el rótulo al lado contrario del héroe (lee `pf.heroX`).

### tools/camtest.js
- Tope por partida (una partida colgada ya no deja la prueba esperando: antes, 14 min parada), `PAGE_ROOT=carpeta` (probar una copia
  parcheada), `DIFF=expert` (más saques rivales), duración en s reales de cámara, `scorer` (el héroe es el que anotó: sacador en el ace o
  el último del equipo que gana que tocó, de los eventos hit/block), `hero` agregado por tamaño sobre todas las semillas (≥ 90 %, como
  la aceptación) y diagnóstico (quién es más grande, perdedores, `hs` = acuerdo activo / players lo acepta).
- Sobre la versión ANTERIOR a la ola (copia `tools/out/cam02/prefix`, camera.js/input.js de HEAD): sale con 1 (bounds con la cámara a
  x = 53 m, cuts, servecut, nextcut, settle, mono, reverse, bbox).

### input.js
- Patrón táctil de `perfect` = [25, 40, 25] ms (dos toques de 25 ms separados 40 ms, como el mando).

### Verificado (ejecutado hoy)
- camtest 300 s × 3 semillas a 1280×720 y 844×390 táctil (proyecto real): bounds, cuts, cutcount, servecut, nextcut, settle, mono, reverse,
  bbox, ball OK en ~25 000 frames por partida; solo falla `hero` (sin el parche de players). Saques rivales asentados: 41/41 con la CPU experta.
- `tools/out/cam04/feel.js` TODO OK (remate perfecto 60 ms congelado = 3,6 frames, bueno 36, malo 0; bloqueo 73; defensa 42; saque en salto
  36; punch 3,00° → 0,17° a 200 ms; temblor en el frame del bote; firmas distintas; `rumble:false` = nada).
- simtest 10 12345 0 TODO OK; courttest set 1280×720 y eight 844×390 táctil TODO OK; touchtest 30 ok; padtest 26 ok; drive y padplay TODO OK;
  touchplay: solo los 2 fallos de NIVEL en el menú (ui.js, ver notes/ui_main.md); console.sh all 1280×720 y táctil 844×390 sin errores;
  overlay táctil con `debug=point` 0,25; perf 844×390: media 118,7 fps / 201 k tri / 47 draws, baja 129,5 / 85 k / 34 («objetivos cumplidos»).

## Aplicado (log, integración del pulido ola 1, 8-nov-2026, PC de casa)
- Parche de players (CAM-02) aplicado: `VB.Players.heroShotAware === true`. camtest completo en el proyecto real → TODO OK (133 s).
- Vibración sin gesto previo: `canVibrate()` en input.js (`navigator.userActivation.hasBeenActive`) antes de las dos llamadas a
  `navigator.vibrate`; `sigLog` sigue anotando la firma.
- Pausa del set recortada (SIM-03) antes de acabar la grúa: antes, la vuelta al saque deslizaba ~2 s desde el plano de reacción o media
  grúa barriendo media pista alrededor de la red. Ahora `ccAbort` (grúa con `u < 0,85` cuando sim sale de `'point'`) fuerza CORTE al
  saque (`markCut(…, 'serve')`), tanto desde `'point'` como desde `'court'`. Sin salto, la bajada de la grúa sigue deslizando.
  Medido (`tools/out/int1/skipcrane.js`): salto a 1,2 s y a 2,4 s (ccU 0,52) → cámara asentada en el saque en el primer frame;
  sin salto, bajada deslizada como antes. courttest set/eight TODO OK.
- CONTRACT §4.4/§6: `heroShot`, `hitStop`, `punch`, `clinchLeft`, `getDebug` (cortes), `rumbleSig`, camtest y convención del héroe.

## Pulido ola 2 — camera_input (2026-11-08, RTX 3060 Ti)

### Temblor del bote tras un bloqueo (CAM-04, hallazgo del verificador feel)
- camera.js, evento `land`: además de `lastKind === 'spike'` / velocidad > 13, también tiembla si el último contacto fue un BLOQUEO
  (block-out que entra, bloqueo directo nuestro o del rival): 0,045 / 0,2 s (un poco más que el bote de remate).
- Medido con el método del verificador (`tools/out/fixw1cam/play3.js` + `analyze.js`, partido humano real 300 s): botes de remate dentro
  con temblor ≤ 2 frames **16/16** a 1280×720 y **9/9** a 844×390 táctil (antes 8/10 y 3/8). Mismo registro: 0 frames fuera del
  pabellón, 0 saltos sin corte anotado, nextCutIn 0 fallos, deriva tras el corte al saque 0.

### Plano de héroe: HUD, postes, balón que cae, rival que cruza (CAM-02, hallazgo del verificador feel)
- `readHud()` (una vez por punto, try/catch): rectángulo NDC del marcador `#sb` y de la pestaña `#pbug` (estimada si aún no se ve) con
  0,06 de margen por debajo. Cada candidato castiga la CABEZA del héroe bajo el HUD (40·fracción) y los brazos en alto bajo el
  HUD (6·fracción + 40·(fracción − 0,4) si lo tapa casi entero) y el héroe cortado por el borde lateral. Pesos deliberadamente por
  debajo del castigo de «perdedor demasiado grande»: con 40 + 260·fracción el héroe se iba siempre a la derecha y camtest bajaba a
  65 % en 844×390 táctil (perdedores en el cuadro). Con los pesos finales: camtest igual que sin el cambio (17/18, el mismo fallo de
  bloqueo @71,5 que ya tenía) . En 844×390 humano (17 planos, `tools/out/fixw1cam/g844`): ninguna cabeza bajo el HUD, pero 1 de 3 planos «abiertos a la izquierda»
  (cut025) aún tiene las manos en alto rozando el borde inferior del marcador: ahí las alternativas tenían un rival demasiado grande.
  Pendiente si se quiere más: que ui.js baje la opacidad del marcador durante el plano de héroe con `pf.heroX < -0.5`.
- Postes: dentro del cuadro hasta 8 m y si están delante o a la altura del héroe (`od < hl + 1,5`), 90·(8−od)/8 (antes 45, solo delante),
  con margen angular = ancho del acolchado a esa distancia + deriva del plano.
- Balón: `predictBall()` (balística con botes y rodadura) a 0,45 / 0,9 / 1,5 s; vale el peor momento. Antes solo se miraba si `b.z < 3,5`
  en el instante del punto: en un balón a la antena o un block-out alto no contaba y luego caía rodando en primer plano.
- Rivales: la oclusión del héroe también con su posición prevista a 0,5 y 1,0 s (el bloqueador que cae junto a la red cruza por delante).

### PEDIDO A players (CAM-02, de espaldas a los ~1,2 s del punto) — parche probado en una copia
Diagnóstico (`tools/out/fixw1cam/heroan.js` sobre `play4.js`): a +0,5 s del corte el héroe está a ~35° de la cámara en casi todos los
planos, pero a +0,8 s pasa a 75-130°: al acabar la convergencia (`g.time >= c.tr + 0.05`) `cvYaw` devuelve NaN y `desiredYaw` le gira hacia
la red / su sitio mientras el plano de reacción sigue ~1-2 s más. Las capturas «de lado / de espaldas, agachado» del verificador
(s1280/cut001, cut013) son el «¡vamos!» (celeb 0) ya girado. Parche en `js/players.js`, `cvYaw`, justo ANTES de
`    if (c.hs && g.time < c.tr + 0.05) {`:
```js
    // (CAM-02) tras el choque de manos, el que anotó sigue de cara a la cámara del plano de héroe hasta que acaba la pausa
    if (c.hs && (A ? 0 : 1) === c.hero && g.time >= c.tr + 0.05 && g.mode === 'point' && (g.timer || 0) > 0.3) return c.hyaw;
```
Probado con `tools/out/fixw1cam/mkproj.js` (copia parcheada en `tools/out/fixw1cam/proj`, `PAGE_ROOT=proj node play5.js …`): a 1280×720,
de cara (≤ 70°) a +0,5/+0,8 s 38/44 (antes 36/44) y a +1,5/+2,2 s 2/3 (antes 0/3). Lo que queda de perfil a +0,8 s es la ventana del choque
de manos (cara a cara, a propósito) y el rugido del bloqueador hacia la red (celeb 3, players ~2224): si se quiere de frente también ahí,
que el bloqueador ruja hacia `c.hyaw` cuando `c.hs`.

## Aplicado (log, integración del pulido ola 2, 8-nov-2026, PC de casa)
- Tu parche para players (CAM-02, `cvYaw`): aplicado tal cual en js/players.js. El rugido del bloqueador hacia `c.hyaw` (opcional): no aplicado.
- Tu idea opcional para ui_main: aplicada. ui.js (`sbDimTick`, cada 8 frames) pone `#sb.dim` mientras el plano del punto es `pf.mode === 'hero'`
  con `pf.heroX < -0,5`; index.html atenúa los hijos del marcador a 0,38 con transición de 0,45 s (no la propia `.sb`, porque su animación
  de entrada `sbIn ... both` fija la opacidad). `readHud()` sigue leyendo el mismo rectángulo (la opacidad no lo cambia).
- CONTRACT §4.4 («pulido ola 2»): temblor del bote tras bloqueo y lo que lee el plano de héroe.

## De sim (pulido ola 2, SIM-04, 8-nov-2026): `g.cpuTossIn` ya existe
- `g.cpuTossIn` = s de juego hasta el lanzamiento de la CPU: lo fija `setupServe` (whistleAt + ritual = 1,5-2,3 s en partido; antes 1,3 s fijos
  de `g.timer`), decrece de forma monótona, vale 0 en el paso del `toss` y hasta el golpe, y -1 con sacador humano o fuera de `'serve'`
  (`g.timer` vale lo mismo durante el saque de la CPU). Tu `bud` de la vuelta al saque rival ya lo lee.
- Durante el ritual el balón BOTA (z 1,28 → 0,21 → 1,0, vz hasta ±6 m/s) con `ball.held` = sacador. Tu encuadre del saque rival fija la
  cumbre del lanzamiento y no se mueve: medido en vivo (`tools/out/sim-w2/camserve.js`, 4 saques rivales) cabeceo ±0,003° y FOV fijo, igual
  que sin ritual. Si alguna regla nueva mira `b.z`/`b.vz` en `'serve'`, usar `g.ritual.on` o la mano (`VB.Sim._holdPos`) en vez del balón.
- camtest (75 s, semillas 7 y 12345, 1280x720 y 844x390t) da `settle`/`reverse`/`spiker`/`fovpump` en rojo tanto CON ritual como con una copia
  SIN ritual (`PAGE_ROOT=tools/out/sim-w2/root_norit`, copia de antes de tus últimos cambios): no los causa SIM-04 (ver `tools/out/sim-w2/camtest*.txt`).

## De ui_main (pulido ola 2: UI-10, UI-11, UI-13, UI-14, UI-16), 8-nov-2026
1. **UI-16 «Cámara estable» → temblor 0** (criterio de aceptación de UI-16: `camStable` activo ⇒ amplitud del temblor 0, medido con
   `getDebug().shake`). Hoy el modo confort lo deja al 30 % (`camera.js`, en el cálculo del temblor: `* (comfort() ? 0.3 : 1)`). Propuesta: que
   solo `prefers-reduced-motion` se quede al 30 % y el ajuste explícito lo quite del todo. En `readComfort()`:
   ```js
   var stableNow = false;
   function readComfort() {
     var st = ctx && ctx.settings;
     stableNow = !!(st && Object.prototype.hasOwnProperty.call(st, 'camStable') && st.camStable);
     calmNow = reduceMotion || stableNow;
   }
   // y en el temblor:  ... * (stableNow ? 0 : comfort() ? 0.3 : 1)
   ```
   `ctx.settings.camStable` ya existe siempre (por defecto `false`, persistido; Ajustes > Accesibilidad).
2. **UI-14 `VB.CameraRig.playIntro(s)`**: main.js lo llama (con guarda) al empezar un partido humano, con la sim PARADA bajo la tarjeta de
   presentación de 2,5 s (`g.mode === 'serve'`; el `serveReady` inicial y lo que venga detrás se retienen y llegan el frame en que acaba la
   tarjeta). `playIntro(0)` = la tarjeta se ha saltado (cualquier botón/tecla/toque) o se ha salido al menú: cortar el plano de presentación y
   volver al plan normal. Mientras dure, `ctx.introLeft` (s reales que quedan, > 0). Si no existe la función, no pasa nada (hoy se ve el plano
   del saque normal).
3. **UI-11 / CAM-10 `ctx.uiDock`**: con la hoja final acoplada a la izquierda (pantallas ≥ 1000 px de ancho) ui.js publica
   `ctx.uiDock = {side:'left', frac}` (`frac` = borde derecho de la hoja / ancho; 0,472 a 1280×720); `null` sin hoja acoplada (móvil, o con
   «Ver celebración»). Se actualiza cada 8 frames. En el móvil la hoja sale cuando `clinchLeft()` llega a 0 y han pasado ≥ 2,5 s desde el punto
   que gana el partido.
4. **UI-13 cortinilla**: se arma con `getDebug().nextCutIn` (cubre en 75 ms; cubierta del todo en el frame del corte) y solo tapa cortes con
   `lastCut.kind` `'serve'` o `'court'`; el corte de reacción (`'point'`) y los de cierre (`'clinch'`) quedan secos. Se arma solo después del
   corte de reacción/cierre del punto (o si `pf.cut === false`) y con `getDebug().clinch.phase` vacío o `'hero'`. Si añadís un tipo de corte nuevo
   que vuelva al saque, decídmelo. Medido (`tools/out/w2/wipe.js`, 80 s): 3 de 3 cortes al saque tapados al 100 % en su frame, 127-134 ms en
   pantalla, reacción seca, 0 frames > 33 ms.
5. **Visto con UI-10 (indicador de borde)**: en el plano `defend` a 1280×720 el jugador controlado queda cortado por la cintura (pies fuera
   por abajo) en ~20 % de los frames del peloteo (`debug=rally&live=1&seed=4`, 60 s); el indicador lo marca. Con CAM-13 (acercar el plano)
   conviene que los pies queden ≥ 40 px por encima del borde inferior.

## Pulido ola 2, segunda tanda — camera_input (2026-11-08, RTX 3060 Ti): CAM-08 … CAM-14 + peticiones de ui_main

### js/camera.js
- **CAM-08 seguimiento del remate hasta el bote**: remate del jugador controlado (o saque en salto con potencia > 0,7): la mira va del
  rematador al punto de caída (`Sim.predictLanding`, recalculado cada frame) en 0,25 s de tiempo de JUEGO (el hit-stop lo congela), bote a
  -0,12 NDC centrado, FOV -3,5° (nada en confort), el plano no cambia hasta el bote (`pickShot` mantiene 'attack') y la base de control queda
  congelada. Se suelta en 0,35 s si el rival toca o bloquea. La mezcla cede lo justo (bisección) para que la cadera del rematador que cae no
  salga del cuadro. Luego manda `planPoint` como siempre. `getDebug().ft` = `{on, w, lx, ly}`.
- **CAM-09 cierre de set/partido** (plano interno `'clinch'`): (1) seguimiento: en punto de set/partido (del marcador), con el balón bajando,
  ≤ 0,42 s para el bote, cayendo en su lado, > 12 cm de la línea y nadie que llegue (alcance + plancha + carrera): cámara lenta (×0,28 partido,
  ×0,5 set) y CORTE a un plano bajo (1,15 m, FOV 34-36) del balón cayendo sobre su marca, de tres cuartos respecto a su trayectoria y sin postes ni
  oficiales delante. Si alguien lo toca: corte de vuelta al juego y sin cámara lenta. Sin bote (falta): 0,45 s de espera. (2) héroe: la
  coreografía se publica en el MISMO punto (`planHeroShot`/`heroShot()`, players la lee a los 0,12 s) y a los 0,4 s (set) / 0,75 s (partido) del
  bote CORTE a una órbita cerrada de los ganadores: 2,8-4,5 m, FOV 34-42, cámara a 1,2 m (heroica), ~6°/s que busca sus caras (cono ±35-50°),
  a ≥ 2,6 m de cada uno, cabezas justo bajo el centro (o 0,12 NDC bajo el rótulo si `VB.UI.bannerRect()` está arriba). Set: 1,85-2,4 s y luego la
  grúa (su arco se acorta si la pausa no da para más; con < 0,95 s, la órbita sigue hasta el corte al saque). Partido: hasta que sale la hoja
  final (`ctx.state === 'over' && !ctx.endHold`), luego 'over' se abre deslizando. `getShot()`: `'clinch'` en el seguimiento, `'point'` (set) /
  `'over'` (partido) en la órbita, con `getDebug().pf` de héroe (`pf.heroX` = NDC x real del que anotó). `getDebug().clinch` =
  `{phase:''|'track'|'hold'|'hero', left, team, why}`; `clinchLeft()` = s reales que quedan; `lastCut.kind` `'clinch'` en los dos cortes.
- **CAM-10**: `overShot` encuadra a los ganadores en la parte libre con `ctx.uiDock` (ya lo publica ui.js): FOV con el aspecto libre y
  `camera.filmOffset` = el de la hoja (como el menú); ángulo inicial (`overPick`) sin perdedores grandes en cuadro y en su campo; posiciones visuales.
- **CAM-11 (táctil/móvil)**: FOV de ayuda por TOQUE y con histéresis (se abre si hace falta > ~0,05 NDC, se mantiene ≥ 0,6 s); la ayuda sale del
  balón REAL contra el cabeceo real (fórmula exacta, sin la realimentación que la subía a escalones hasta el tope); antes que el FOV, cabeceo y
  distancia: la cadera puede bajar a -0,72 NDC y el aro a -0,7 con el jugador centrado entre joystick y botones (ahí no hay pulgares), balón hasta
  0,70 (0,74 con el balón que se va al rival, 0,78 en la defensa que se acerca; el contador de toques acaba en 0,88), el plano de remate se aleja y
  sube más con la colocación alta, la cámara se aleja por toque (`touchFitPlan`, hasta 3 m). Por último la LENTE va a ritmo limitado en
  rally/attack/defend: abre a ≤ 10°/s (16 con el balón ya arriba, 11 los primeros 0,6 s tras un plano de saque) y cierra a ≤ 1,4°/s. Táctil: +3°
  de base en el peloteo y +6° en la recepción del saque rival.
- **CAM-12**: `fovFor(base, h, vLow, wide)`: en aspecto > 2, planos rally/defend/attack con horizontal hasta 100° y VERTICAL ≥ 52°; la defensa usa
  también la cumbre prevista y el balón nunca por encima de 0,9 NDC; en 21:9 la cadera a ≥ -0,72 (y el cambio de jugador abre antes).
- **CAM-13 defensa que se acerca**: con el rival construyendo (recepción o colocación suya, balón en su campo): -2,5 m, -0,5 m de altura, FOV -8°
  (≤ 8°/s) y cabeceo hacia el pecho del rematador previsto (el que recibió; tras la colocación, el compañero del colocador) sin que la cabeza de
  nuestro defensor baje de -0,8 NDC (táctil -0,45; 21:9 la cadera a -0,9) ni la del compañero (el control puede pasar a él en el remate); nunca a
  menos de 4,2 m (21:9: 5 m) detrás de un compañero que esté más atrás. Se suelta en 0,4 s en el remate. `getDebug().defW/.defF`.
- **CAM-14 cutaway al sacador rival** (plano `'cutaway'`): tras un punto, en el `serveReady` de la CPU con `g.cpuTossIn` (SIM-04): CORTE a un plano
  corto del sacador (FOV 30, ~45 % del alto, de perfil / tres cuartos de frente, 1,3 m, aire hacia la pista, leve acercamiento de 0,35 m) durante su
  ritual y CORTE a la recepción ya asentada ≥ 0,55 s antes del lanzamiento. 0,95-1,4 s; si no hay tiempo, no hay cutaway. `lastCut.kind` `'serve'`
  al entrar (sale del punto: cortinilla de UI-13 y rótulos con él) y `'cutaway'` al volver (corte seco). Durante el punto `nextCutIn` ya lo anuncia.
- **UI-14 `playIntro(s)`** (petición de ui_main): plano `'intro'` bajo la tarjeta: corte desde el menú a una grúa alta desde la esquina del fondo
  rival hacia la banda de la mesa (7,6 → 5,8 m, FOV 52 → 48) y, al acabar o con `playIntro(0)`, corte al saque asentado con `lastCut.kind` `'serve'`.
- **UI-16** (petición de ui_main): `settings.camStable` → temblor 0 (`prefers-reduced-motion` sigue al 30 %).
- `getDebug()` añade `fovWant, fovBoost, tfBack, defW, defF, ft, clinch`; con `&camdbg=1`, `x` = componentes del encuadre fino (pruebas).

### js/input.js
- CAM-14: el overlay táctil se atenúa (como con balón muerto) mientras `getShot() === 'cutaway'`; vuelve con el corte a la recepción.

### Medido (ejecutado hoy)
- `node tools/camtest.js` completo (4 tamaños × 3 semillas, 75 s): bounds, cuts, cutcount, servecut, nextcut, settle, mono, reverse, hero, scorer,
  bbox, ball, fovrate, follow, fovpump (3/3 táctil), wide, cutaway y spiker por partida en verde; agregados hero 100/94/100/94 %, follow 100 %
  (17/17 a 1024 y a 1280 con 150 s × 4 semillas). Solo queda en rojo el agregado spiker de 844×390 (ver abajo).
- CAM-08: botes de remate propio en el 60 % central: 18/18 (1280), 18/18 (844 táctil), 10/10 (1680, 2560, 3440), 17/17 (1024); sin corte.
- CAM-09 (`tools/out/cw2/clinch.js`, autopilot con `present`): set 4/4 y partido 3/3 a 1280×720 (bote en cuadro |ndc| ≤ 0,13, órbita ≥ 1,85 s en
  el set / ≥ 3,1 s bien en el partido, cabezas nunca bajo el rótulo, sin perdedores delante, se mueve en cada ventana de 1 s, grúa tras el set).
  A 844×390 la UI pone el rótulo grande en su hueco de abajo (130-291 px de 390, el centro de la pantalla) y tapa las cabezas: petición a ui_main.
- CAM-10 (`tools/out/cw2/dock.js`, 10 s): ganadores fuera de la hoja 100 % a 1280×720, 1680×720 y 1024×768 (izq. 0,42), 95 % con la hoja a la
  derecha 0,35; nunca un perdedor como figura más grande.
- CAM-11 (844×390 táctil, 6 semillas × 75 s): p95 del ritmo de FOV 11,0-11,1°/s (antes 26-27), p50 1,4-2,4°/s (antes 7,5; ≤ 2 en 3-4 de 6),
  balón fuera 0 %, tras el HUD 0-1 frame (la pastilla del aviso).
- CAM-12 (1680×720, 2560×1080, 3440×1440 × 4 semillas): balón fuera 0, borde 0 %, cadera fuera 0 (12/12).
- CAM-13: 1280×720 rematador ≥ 18 % en 94-96 % (mediana 18,5-19,6 %, antes 15-16 %), jugador en pantalla 100 %, FOV p95 7,5-8°/s, balón fuera 0.
  844×390 táctil: mediana 15-16 % (pide 16 % en el 90 %): NO llega.
- CAM-14 (camtest `cutaway`, DIFF=expert): 30/30 saques rivales con cutaway bien (sacador ≥ 40 % ≥ 0,8 s, vuelta ≥ 0,5 s antes, `settle` verde).
- courttest set 1280×720 y eight 844×390 táctil TODO OK; touchtest 30 ok; padtest 26 ok; drive, padplay y touchplay TODO OK (touchplay falló una
  vez en una comprobación estadística de juego y pasó al repetir); simtest 10 12345 0 y 10 7 0 TODO OK; console.sh all 1280×720 y táctil 844×390
  sin errores (19/19); perf 844×390 ×4 dpr 2,75: baja 117 fps / 34-41 draws / 90 k tri, media 112 fps / 198-203 k tri («objetivos cumplidos»);
  escritorio alta 164 fps.

### Herramientas (scratch en tools/out/cw2/, git las ignora)
`clinch.js set|match [WxH] [n] [seed] [touch]`, `seq.js` (secuencias de fotogramas con reloj de rAF lento y `PRE=js`), `dock.js WxH side frac`,
`an.js size seed fov|hip|spk` (análisis de los registros `LOG=1` de camtest). `tools/camtest.js` (mío) tiene las comprobaciones nuevas.

### Para el integrador (CONTRACT)
- §4.4: `getShot()` añade `'clinch'`, `'cutaway'`, `'intro'`; `lastCut.kind` añade `'clinch'`, `'cutaway'`, `'intro'`; `VB.CameraRig.playIntro(s)`;
  `clinchLeft()` real; `getDebug()` añade `ft`, `clinch`, `fovWant`, `fovBoost`, `tfBack`, `defW`, `defF`. Consumido: `ctx.uiDock`.
- Convención de cámara: el cierre de set/partido entra por corte (seguimiento y órbita); el cutaway del saque rival entra con un corte `'serve'`
  y vuelve con uno `'cutaway'`; la presentación del partido entra con `'intro'` y sale con `'serve'`.
- §6: camtest con follow, fovpump, wide, spiker y cutaway.

### Pendiente / no llega
- CAM-11: p50 ≤ 2°/s solo en 3-4 de 6 semillas (p95, balón fuera y HUD sí).
- CAM-13 en 844×390: el rematador queda en ~15-16 % (pide ≥ 16 % en el 90 %). Más cerca o más cerrado choca con el FOV mínimo de 52° (CAM-12) y
  con la cabeza del defensor por encima de los pulgares (probado: acercar 3,2 m saca el balón del cuadro en la defensa y no agranda al rematador).
- Petición nº 5 de ui_main (pies del defensor ≥ 40 px sobre el borde en 'defend'): con CAM-13 mandan la cabeza del defensor y el rematador rival;
  en la defensa que se acerca los pies pueden salir por abajo a propósito.

### Peticiones (en notes/ui_main.md y notes/sim.md)
- ui_main: rótulo grande del set/partido en el hueco de ARRIBA durante la órbita del cierre; ocultar el indicador de borde (UI-10) en los planos
  cinematográficos; tipos de corte nuevos.
- sim: `VB.HOLD.set` 3,4 → ~4,0 (con `present`) para que la órbita del set (≥ 1,85 s) y la grúa (≥ 1,6 s) quepan con holgura.

## Aplicado (log, integración del pulido ola 2, segunda tanda, 8-nov-2026, PC de casa)
- Peticiones a ui_main aplicadas en ui.js: rótulo de set/partido arriba en la órbita del cierre (y recolocado al entrar en `'hero'`), indicador de borde
  oculto en planos cinematográficos y durante 0,35 s tras un cambio de plano; en `serveUs`/`defend` solo por «fuera de cuadro» (tu petición nº 5
  queda así resuelta del lado de la UI: los pies cortados a propósito en CAM-13 ya no sacan la insignia).
- Petición a sim aplicada: `VB.HOLD.set` 3,4 → 4,0 (con `present`). clinch.js: órbita del set 1,98-2,01 s; courttest set 1280×720 y 844×390 táctil TODO OK.
- CONTRACT §4.4: `getShot()`/`lastCut.kind` `'clinch'|'cutaway'|'intro'`, `playIntro(s)`, `clinchLeft()`, campos nuevos de `getDebug()`, `ctx.uiDock`,
  `camStable` → temblor 0; convención de cortes del cierre, del cutaway y de la presentación.
- camtest completo (2 min 14 s): todo verde salvo los dos parciales ya conocidos: `spiker 844x390t` 4/16 (CAM-13) y `fovpump` 2/3 (una semilla con
  el balón 4 frames tras el HUD; p50 1,44-1,64 °/s, p95 11,1-11,2 °/s).

## Arreglos tras la verificación de la ola 2 — camera_input (8-nov-2026, RTX 3060 Ti)

### js/camera.js — cierre de set/partido (CAM-09)
- **Seguimiento sin suelo vacío**: el seguimiento a cámara lenta tiene un SUJETO (`clinchSubject`): el atleta más cercano a la marca en el campo
  donde cae (el defensor que no llega, ≤ 7,5 m) o, si no, el que lo mandó allí (≤ 11 m). El sitio de la cámara (72 candidatos: 24 ángulos × 5,4 /
  6,6 / 7,8 m) lo deja dentro del cuadro abierto y también en el acercamiento final; la mira va al 42 % hacia su pecho y la lente abre lo justo (≤ 54°)
  para que quepan él, el balón y la marca. En los últimos ~0,3 s reales antes del bote la mira se cierra sobre el balón (peso del sujeto 0,28, como
  mucho en el borde) y tras el bote vuelve a abrir (su reacción con el confeti). El bote sigue en cuadro: |ndc| ≤ 0,47 en 27 cierres medidos.
- **Órbita del partido de cara**: players no sigue la coreografía del héroe en la victoria: tras el choque de pecho los dos se quedan de cara el uno
  al otro y miran a la grada de su banda (`look(x·1,15, ±13, 5)`). El ancla de la órbita es la perpendicular a la línea que los une, del lado de esa
  grada (perfiles abiertos a cámara, uno no tapa al otro, caras hacia la lente), buscada cada 0,25 s en ±90° (y su opuesta, con castigo) con un sitio
  válido: en su campo y lejos de la red (antes, cerca de la red la cámara acababa a 0,9 m de la red, subida a 2,95 m y a 1,3 m de un ganador), dentro
  del pabellón, sin postes/oficiales ni perdedores cerca o delante (`clAnchor`). Giro del ancla ≤ 25°/s; la órbita oscila ±22° a 6°/s. Si players
  llega a girarlos hacia la cámara (frentes a < 60° entre sí, a partir de 1,2 s), manda su frente medio.
- **Encuadre del partido**: la pareja siempre centrada (antes el centro iba al 30 % hacia el héroe con ellos a > 3,4 m: el compañero salía por el
  borde), margen lateral 0,9 m, R 3,6-5,6 m, FOV ≤ 46°, ganadores a ≥ 3,3 m de la cámara.
- **Manos bajo el rótulo** (set y partido): envolvente de la altura de las manos de cada ganador (`VB.Players.handWorld`; sube al momento, baja a
  0,6 m/s; en el partido, al menos brazos arriba = 1,22 × altura); el cabeceo deja la mano más alta ~3,5 % del alto por debajo del borde inferior de
  `VB.UI.bannerRect()` y, si de las manos a la cadera no cabe, abre la lente (fit2, ≤ 50°).
- **Siempre viva**: deriva lenta de la mira (±2,6°, dos senos) en la órbita: aunque el muro de 2,6 m de un ganador frene la órbita (pasaba en el set
  a 844), ninguna ventana de 1 s queda quieta. Nada en confort.
- `getDebug().clinch.x` (pruebas): `[aHd, aHn, pitch, handT, headN, hz0, hz1, vl, anc, ang]`.

### js/camera.js — balón perdido (CAM-11, hallado al ampliar semillas)
- `lostBall(g)`: en el peloteo, bote previsto en ≤ 1,2 s a > 0,4 m por fuera de la pista. Entonces el encuadre fino deja que mande el balón (±0,75 NDC
  en horizontal, por encima de -0,8 en vertical, giro ±0,7 rad) y la mira acompaña al balón (`lostFollow`, peso 0,75, entra/sale en ~0,2 s), aunque pase
  por detrás del plano de la cámara. Antes, con la semilla 11 a 844 táctil, una recepción desviada que se iba por detrás de la cámara dejaba el balón
  53 frames fuera de cuadro (pasaba igual antes de estos cambios). `predictLanding` cuesta 0,45 µs: una vez por frame.
- Lente en táctil: con el balón cerca del borde de arriba abre a 12°/s (antes 16) → el p95 de CAM-11 queda ≤ 12°/s por construcción (con el PC
  cargado salía 12,7).

### tools/camtest.js (CAM-06)
- `fovpump` es la puerta de p95 ≤ 12°/s y balón fuera 0; `fovpumpX` (p50 ≤ 2 y balón tras el HUD) y `spikerAll` (agregado CAM-13) son
  INFORMATIVAS por defecto (`info`) y cuentan como fallo con `STRICT2=1`. La puerta por defecto sale con 0 si pasa todo lo cerrado.

### Medido (ejecutado hoy; scratch en tools/out/ci3/)
- `node tools/camtest.js` completo (146 s): TODO OK, sale con 0. hero 4/4 tamaños, follow 4/4, spiker por partida 12/12; spikerAll 1280 15/16 (94 %),
  844 táctil 4/16 (informativa); fovpumpX 2/3 (una semilla con 16 frames tras el HUD, informativa). Con 6 semillas a 844 táctil: balón fuera 0 en las 6.
- CAM-09 (`ci3/clinch2.js` + `ci3/an2.js`, mide también el sujeto del seguimiento, manos sobre el rótulo y caras): partido 9/9 bien (1280 ×2
  semillas, 844 táctil), set 12/12 bien (1280 ×2 semillas, 844 táctil); manos sobre el rótulo 0,00 s en todos (antes 1,4-2,2 s por cierre); ventanas
  quietas 0; seguimiento con un atleta en cuadro (≥ 10 % del alto) el 100 % del tiempo en 23 de 24 cierres (un ace: 0,7 s con el receptor en el
  borde). Secuencias de fotogramas mirados: `ci3/s-m7.png`, `s-m21.png`, `s-m844.png`, `s-set.png`.
- courttest set 1280×720 y eight 844×390 táctil TODO OK; touchtest 30 ok; padtest 26 ok; drive y padplay TODO OK; simtest 10 12345 0 TODO OK;
  console.sh all 1280×720 y táctil 844×390 sin errores; perf 844×390 ×4 dpr 2,75 (SCENE=rally): media 103,6 fps / 201 k tri / 40-43 draws, baja
  108 fps / 89 k tri / 30-34 draws, «objetivos cumplidos».
- touchplay: la copia parcheada (`ci3/touchplay_fix.js`) 3/3 a 844×390 y 1/1 a 667×375 con 0 toques de ⇄ sin cambio; la original 3/3 hoy pero
  con 1-2 de 4 toques de ⇄ que no cambian (los que caen con `g.jobs[0]` puesto): falla cuando solo hay un intento y es de esos.

### Peticiones
- **ui_main (tools/touchplay.js, flaky)**: diff exacto en `tools/out/ci3/touchplay.diff` (copia completa en `tools/out/ci3/touchplay.proposed.js`).
  (1) el saque apunta a `hitWindow().press` (instante ideal de PULSAR) en vez de `t − 35 ms` (que era ~35 ms tarde) y sondea fino cerca de él;
  (2) ⇄ solo con `!g.jobs[0]` (la sim no deja cambiar si el equipo humano tiene tarea) y, si el toque no cambia, reintenta a los 1,2 s (máx. 6).
  input.js no pierde toques (las pulsaciones quedan retenidas hasta `poll()`).
- **ui_main (tools/perf.js)**: con el ui.js de ahora (20:57) el modo por defecto (`SCENE=match`) sale con «no arranca el partido: menu»:
  `actions.startMatch({autopilot:true})` ya no deja `ctx.state === 'playing'` en el mismo tick (¿transición de 450 ms?). Esperar a `playing` con
  un sondeo de hasta 2 s. `SCENE=rally` funciona.
- **players (opcional, remata CAM-09 al 100 %)**: en la victoria del partido, tras el choque de pecho (`g.time > c.tc + 0.5`), girar a los dos hacia la
  cámara (posición `VB.ctx.camera.position` → sim `(x, -z)`) ±35° hacia el compañero, en vez de seguir de cara el uno al otro. La cámara ya lo
  detecta (frentes a < 60°) y pasa a encuadrarlos de frente.
- **arena (informativo)**: durante la sesión, camtest vio 2 veces `[VB][ERROR] FX.init: TypeError: Cannot read properties of undefined (reading 'm'|'s')`
  en partidas táctiles mientras fx.js se estaba editando; al repetir no salió (console.sh limpio). Comprobar en la integración.

## Aplicado (log, integración de los arreglos tras la verificación de la ola 2, 8-nov-2026 noche, PC de casa)
- Petición a players (CAM-09, girar a los ganadores hacia la cámara) **aplicada** en players.js (`cvYaw`): con `c.match` y `g.time > c.tc + 0,5`, cada ganador
  mira a `VB.ctx.camera.position` (sim `(x, -z)`) con como mucho 35° vueltos hacia el compañero; el muelle de yaw suaviza el giro. A/B con `ci3/clinch2.js` +
  `an2.js` (partido, 1280×720 semilla 7): «los dos de frente» **1 % → 51 %** del plano de héroe (844×390 táctil semilla 5: 58 %); manos sobre el rótulo 0,00 s,
  cara tapada 0,00 s, ventanas quietas 0, 3/3 bien en los dos tamaños. Secuencias miradas: `tools/out/int3/seqm.png`, `seqm844.png` (de frente desde ~3,4 s).
- touchplay.js (diff de ci3) y perf.js: aplicados por ui_main; perf.js además repite `startMatch` cada 0,5 s hasta `'playing'` (propuesta de arena).
- CONTRACT §4.4 (`clinch.x`, convención del cierre y del balón perdido) y §6 (`STRICT2`, `fovpumpX`, `spikerAll`). `FX.init: TypeError` no reaparece
  (console.sh all 1280×720 y 844×390 táctil limpios). `tools/camtest.js` sigue sin seguimiento en git: el commit debe añadirlo.

## De arena (pulido ola 3, ARN-14), 8-nov-2026 — opcional
- Hay banquillos con suplentes que aplauden/levantan los brazos, fotógrafos y cámara de TV. `VB.Arena.landmarks.benches[team]` (sim; equipo 0 en
  x > 0, centro del banco a la altura de las cabezas), `.photographers[4]`, `.tvCamera`. Idea para un plano de reacción en el cierre de set/partido:
  ~0,8 s al banquillo del ganador (brazos arriba durante 4,2 s tras `point.matchWon`, aplauso 2,4-2,9 s tras `setWon`), cámara dentro de la zona
  libre (p. ej. sim `(bx * 0,8, 8,6, 1,5)` mirando a `benches[team]`). Con guardas: `var B = VB.Arena && VB.Arena.landmarks && VB.Arena.landmarks.benches;`.

## De ui_main (pulido ola 3, 8-nov-2026)
1. **Contraste del rótulo «SACAR»/«GOLPEAR» del botón táctil (UI-19)**: el auditor de texto (`tools/out/w3/a11y19.js`, escena `serve` táctil) da
   2,9:1 para el texto blanco de `.vt-hit` en el saque (objetivo 4,5:1 con < 18,66 px). En ui_main los naranjas con texto blanco pequeño ya van a
   paradas oscurecidas; propuesta para input.js, mismo criterio: fondo de `.vt-hit` `linear-gradient(180deg,#dd5421,#bd3611)` y de `.vt-jump`
   `linear-gradient(180deg,#2f6ef0,#2459d8)` (o el rótulo ≥ 19 px en negrita). Comprobar con `STRICTC=1 node tools/out/w3/a11y19.js`.
2. Informativo (UI-13): en escenas `debug=` táctiles el primer corte al saque tiene un frame de 60-90 ms aunque no haya cortinilla (`&wipe=0`):
   coincide con `.vt-sw/.vt-jump` pasando a `off` (filtro saturate/brightness) mientras `#touch` sale de `dead` (transición de opacidad). En el flujo
   real lo cubre el ensayo de estilos de ui.js (máx. 18 ms). Repro: `node tools/out/w3/cut1.js 844x390` (vs `REAL=1`).

## Pulido ola 3 — camera_input (9-nov-2026, RTX 3060 Ti): CAM-15 … CAM-20 (+ CAM-11/13 arrastradas, + UI-19 en input.js)

### js/camera.js
- **CAM-15 saque propio** (`serveUsComp`, sustituye la cámara alta de 5,4 m): por encima del hombro, ~3,35 m (táctil 3,5), 4,3 m detrás y a un lado;
  el sacador en el tercio derecho (hombros a ~+0,34 NDC; táctil +0,26) de rodillas para arriba; línea de fondo rival >= 0,56 NDC; balón >= 3,6 m
  de la lente (se aleja si hace falta). Lanzamiento en salto: grúa +1,4 m / +0,8 m y lente con el balón <= 76 px a 1080p; flotante: la lente respira
  hasta ~44° (balón <= ~122 px). El sitio lateral, el sesgo del sacador y un factor de lente se eligen entre 84 candidatos (también con la pose de la
  grúa del salto, para que ningún oficial cambie de dentro a fuera por el camino) con histéresis. Oficiales = `VB.Arena._dbg()` refs + judges
  (releídos cada 8 frames; el 2º árbitro se mueve). Red de seguridad en `apply()` sobre la pose REAL: si un oficial cruza un borde, cambio mínimo de
  lente (±24 %) y/o giro (±6°). En el saque propio no hay encuadre fino (`framing` lo salta). Prueba: `VB.CameraRig._serveDbg()`.
- **CAM-16 menú**: realización de 6 tipos de plano (`wide, side, net, server, setter, board`; `getDebug().menu`/`.menuT`) de 6,6-9,4 s con cortes
  secos (`lastCut.kind` **`'attract'`**, nuevo) nunca a ±0,3 s de un golpe (predicción de alcance 0,6 s), todas las cámaras del lado de la mesa
  (y > 0,3; el fondo del sacador sobre el eje), despeje de oficiales/postes/atletas, encuadre automático del balón y los 2 jugadores activos en
  ±0,42 NDC (con `filmOffset` quedan a la derecha del panel), giro combinado <= 24°/s. **`playIntro(s)`**: grúa desde la esquina alta de nuestro
  fondo que ACABA en el encuadre asentado del primer saque (planeado al empezar) y cede sin corte (`nextCutIn` = -1 durante la presentación).
  Saltarla (`playIntro(0)`) sigue cortando con `'serve'`.
- **CAM-17 red y bloqueo** (`blockMoment`, `getDebug().blk`): de la colocación (toque 2) a 0,35 s tras el bloqueo: escritorio FOV -16°, la acción de la
  red en el tercio de arriba (cabeza del controlado >= -0,85); bloqueando tú (netK) plano bajo 2,8-3,0 m en diagonal desde el lado de la mesa (silla
  fuera); táctil sin tocar la lente (CAM-11): travelling hacia la red. Lente <= 10°/s y giro combinado <= 38,5°/s mientras dura. Remate propio con
  bloqueo probable: la panorámica del seguimiento (CAM-08) espera 0,2 s y no gira rápido hasta que el balón pasa la red.
- **CAM-18**: `predictBall` a 2,1 s (9 muestras); `ballClutter` (balón a < 6 m dentro del cuadro = descartado) y `ballBand` (balón > 3,6 % del alto en la
  franja del 15 % del borde) en los dos planificadores del punto; red de seguridad en `apply()` (cierra la lente para sacarlo; en el frame del corte de
  golpe); `VB.UI.bannerRect()` leído cada frame del plano de héroe: la cabeza nunca bajo la cinta (mira hasta +5°).
- **CAM-19**: `boardGuard` en `apply()` para point/court/clinch/over/cutaway: caja del marcador colgado entera o fuera (>= 2° sobre el borde)
  cerrando la lente (manda sobre los pies del héroe); prueba `VB.CameraRig._boardGuard(...)`, `getDebug().board`.
- **CAM-20 / pruebas**: `&camBreak=clinch|serve|board|menu|block|clutter|hitstop|intro|cut` rompe a propósito cada regla (sin el parámetro nada cambia).

### js/input.js
- **UI-19** (petición de ui_main): `.vt-hit` `radial-gradient(#ec7444,#c9441a 55%,#a8300e)` y `.vt-jump` `(#6a9cf5,#2c62e0 55%,#1d4bbf)`: blanco de 15 px
  >= 4,5:1 en el centro (#c9441a 4,9:1, #2c62e0 5,2:1). touchtest 30 ok, padtest 26 ok.

### tools/camtest.js (CAM-20)
Comprobaciones nuevas: `serve`, `board`, `clutter`, `block` (en cada partida); partidas aparte por tamaño `[menu]` (`menu` + `intro`), `[setend]`
(`clinch`: órbita del héroe >= 1,8 s, grúa, marcador) y `[feel]` (hit-stop 60 ms y punch). `EXTRA_JOBS=` las quita. `node tools/camtest.js selftest`
lanza cada `camBreak` con su comprobación y sale 1 si alguna rotura no se detecta.

### Medido (ejecutado; scratch en tools/out/c3/)
- camtest completo (4 tamaños × 3 semillas + 12 partidas extra): ~220-230 s; todo verde salvo las informativas (ver abajo). selftest: 9/9 roturas
  detectadas (290 s).
- CAM-15 `servechk.js`: serve/toss/jumpserve × 1280, 1024, 1680, 844t (semillas 1-3): hombros/cabeza/brazos dentro y fuera de `#prompt`, 0 oficiales
  cortados, balón de jumpserve 65-76 px a 1080p, fondo >= 0,53 (táctil 0,57-0,66). En vivo (`serve`, 12 partidas) 0 frames mal.
- CAM-16 `menuchk.js` 60 s: 5-6 tipos, 7 cortes, 0 a ±0,3 s de un golpe, ningún plano < 6 s, giro <= 25°/s, balón+activos a NDC x > -0,3 en 91-96 %;
  `menuperf.js` móvil ×4: 99-102 fps. `introchk.js` (4 tamaños): salto en el relevo 0,000 m, sin cortes.
- CAM-17 `blockchk.js` (block 3,5,7,9,11 × 1280 y 844t): bbox 0,31-0,49 del alto, silla 1,5-9 % del área, balón dentro; camtest `block` 12/12 (<= 39°/s).
- CAM-18 `pointchk.js` (3 semillas × 150 s × 1280 y 844t, 38-39 puntos por tamaño, ~1400 frames con cinta): 0 balones > 4 % junto al borde/cinta, 0 cabezas.
- CAM-19 `boardchk.js` (3 cierres de set × 2 tamaños): 0 frames cortados; camtest `board` y `clinch` verdes.
- CAM-11 (844 táctil): p95 11,5°/s, balón fuera 0, p50 1,4-2,1°/s (<= 2 en 2 de 3 semillas); balón tras el HUD 0-21 frames (marcador/franja de toques). PARCIAL.
- CAM-13: rematador >= 18 % a 1280 ~100 % (mediana 20-22 %); 844 táctil 53-63 % (antes 20-24 %). PARCIAL en móvil.
- console.sh all 1280 y 844 táctil sin errores; simtest 10 12345 0 TODO OK; touchplay, padplay, drive, courttest set/eight TODO OK;
  perf 844×390 ×4 dpr 2,75: media 96 fps / 251 k tri / 40-44 draws, baja 98 fps / 113 k tri / 31-34 draws («objetivos cumplidos»).

### Para el integrador (CONTRACT §4.4 / §6)
- `lastCut.kind` añade `'attract'` (cortes del menú; UI no debe taparlos con cortinilla). La presentación ya NO acaba en corte `'serve'` salvo si se salta.
- `getDebug()` añade `menu`, `menuT`, `blk`, `board`, `pbNar`; pruebas `_serveDbg()`, `_boardGuard()`; parámetro de URL `&camBreak=`.
- §6: camtest con serve/board/clutter/block/menu/intro/clinch/feel, `EXTRA_JOBS`, `CAMBREAK`, `selftest`.

## Aplicado (log, integración del pulido ola 3, 9-nov-2026, PC de casa)
- CONTRACT §4.4/§6: `lastCut.kind 'attract'`, `playIntro` sin corte final, `getDebug()` `menu/menuT/blk/board/pbNar/pbW/pbD`, `_serveDbg`, `_boardGuard`, `&camBreak=`, camtest (serve/board/clutter/block/menu/intro/clinch/feel, `EXTRA_JOBS`, `CAMBREAK`, `selftest`).
- UI-19 en input.js: ya aplicado por camera_input. `node tools/camtest.js` en el árbol integrado → TODO OK (informativas: fovpumpX 2/3, spikerAll 1/2, las parciales conocidas de CAM-11/CAM-13).
- Plano del banquillo (ARN-14): sigue sin hacer (opcional).

## Pulido ola 4 — arreglos de cámara (fixer camera_input, 9-nov-2026, PC de casa)

js/camera.js:
- **UI-13 (tirón del corte punto→saque en el móvil)**. Antes: 84 candidatos del encuadre del saque cada frame (+ la pose de la grúa) y 24 veces
  en el asentado del corte: 120-140 ms por corte y 23-25 ms por frame en la espera, en el móvil ×4. Ahora:
  - `fit2` en forma cerrada (misma solución que la bisección, error 5e-12); `fovFor` fuera del bucle de `svcSolve`.
  - `offStraddle`: atajo EXACTO con la esfera que envuelve los 16 puntos de cada oficial (dentro de la banda interior o fuera de un borde = mismo
    resultado sin proyectar).
  - Búsqueda repartida: pasada completa al empezar el saque / asentar un corte (una vez: las vueltas del asentado la reutilizan), luego 12
    candidatos por frame en rueda (21 con el balón en el aire, y otra pasada completa al lanzar).
  - **Pasada de antemano** (`svcPrewarm`): durante el plano del punto, si el próximo saque es nuestro, los 84 candidatos se puntúan de 12 en 12
    con el sacador previsto (x 10,3, y ±1,5 según `g.serverIdx`); el corte la aprovecha.
  - Red de seguridad de oficiales (apply): si ya falló con la misma pose no se repite (~640 proyecciones/frame quieto), y tras un fallo con la
    cámara en marcha la búsqueda es corta.
  - Medido (`tools/out/fix4-cam/camdist.js`, partido autopilot 60 s, 844×390 dpr 2,75 CPU ×4): `CameraRig.update` en serveUs p50 0,5-0,7 ms,
    p95 1,3; **0 frames > 33 ms con la cortinilla** (low y medium; antes 3/3 cortes a 120-140 ms). `wiperun.js` (debug=rally&live=1, semillas
    3 y 7 low, 3 medium): todos los cortes salvo el PRIMERO <= 24 ms (antes 72-95 ms también en cortes posteriores). perf.js: long tasks 0-1 (50 ms)
    frente a 157/174 ms; «objetivos cumplidos».
- **Fallo encontrado y arreglado**: la red de seguridad de oficiales sumaba su giro a `K.outYaw` y lo volvía a aplicar cada frame; con un oficial
  cortado varios frames (grúa del saque en salto) la cámara se iba girando hacia la grada con el balón fuera. Ahora el giro es solo de ese frame.
- **Saque en el móvil (pantalla baja/táctil)**: el juez de línea cercano (10,4, −5,9) está a la misma profundidad que el sacador y salía de ~150 px
  encima del joystick. Penalización nueva `offForeground` (oficial entero > 30 % del alto o sobre la zona del joystick), sacador algo más centrado
  (preferencia +0,17 NDC: queda entre el joystick y los botones) y la lente normal pesa más (x6). `judge.js` (3 semillas, 60 s): en la espera y en el
  saque flotante el juez no entra nunca. En el saque en salto la grúa abre la lente y el juez entra entero abajo a la izquierda ~0,5 s; la red de
  seguridad (en pantalla baja: lente hasta ±32 %, giro hasta 10°) evita que quede cortado. Con el balón en el aire, en pantalla baja el candidato no
  cambia (cambiarlo metía al juez por el camino); en escritorio solo cambia para sacar a un oficial cortado.
- **Plano final (`over`)**: el marcador colgado y las dos pantallas LED de los fondos quedan SIEMPRE fuera por arriba (>= 2°): desvío de cabeceo propio
  continuo (sube al instante, vuelve a 5°/s, hasta 16°), la lente no se toca (cerrarla dejaba a un ganador enorme y cortado y saltaba 4-22°/frame).
  `overprobe.js` (debug=over&live=1, 12 s, medido tras cada render): 0 frames con una caja a medias a 1280×720, 1920×1080, 1680×720, 1024×768 y
  844×390; salto máximo de cabeceo 0,26°/frame. Coste: algo más de suelo abajo (5-8° a 16:9, ~12° a 4:3).
  `boardGuard` ahora mide cajas genéricas (`BGB`) y tiene en cuenta `filmOffset`; para point/court/clinch/cutaway sigue igual (solo el marcador).
- **Hit-stop**: tope de nominal + 2 frames pintados (`K.hsF/hsFMax`).
- `getDebug()` añade `svcEval`/`svcOff` (candidatos y proyecciones de oficiales del frame) y `bgP` (desvío del plano final, °).

tools/camtest.js: `feel` descuenta un frame lento del PC dentro de la congelación (lo indica); `wide` no cuenta los frames a <= 0,4 s de un tirón del PC
(dt > 4× la mediana y > 50 ms) y los indica; `serve` en pantalla baja/táctil admite el sacador en x >= −0,02 (centrado entre los controles).

Spike (escena `spike` 1280×720 low): en el árbol actual el aviso de toques va en la segunda línea del contador y `#prompt` está apagado; el balón queda a
0,65 NDC, por debajo. Sin cambio de cámara.

### Petición a ui_main (opcional; evidencia en tools/out/fix4-cam/)
- **Primer corte al saque del partido en el móvil: 68-92 ms con la cortinilla en fase 3, ~0,15 s después del corte**. NO es JS: `breakdown.js` envuelve
  `update`/`render` de todos los módulos y en ese frame y el anterior ninguno pasa de 2 ms (cámara < 2 ms); la traza muestra `RasterDecoderImpl::
  DoEndRasterCHROMIUM` de 40-60 ms en el hilo de GPU. Solo pasa la primera vez (los cortes siguientes <= 24 ms). Sospecha: primer raster de la capa de
  la cortinilla / del HUD del saque a dpr 2,75. Probar a pre-pintar la cortinilla una vez al cargar (opacity 0.001 un frame) o `will-change: transform`
  en su capa, y medir con `node tools/out/fix4-cam/wiperun.js 3 low`.

## Aplicado (log, integración de los arreglos tras la verificación de la ola 3, 9-nov-2026, PC de casa)
- CONTRACT §4.4: `getDebug()` `svcEval`, `svcOff`, `bgP`; `board` `'baja'|'fuera'` en el plano `over`; hit-stop con tope nominal + 2 frames. §6: cambios de camtest (`feel`, `wide`, `serve` en pantalla baja x ≥ −0,02).
- SIM-03: texto de la línea 345 corregido (4,0 s al ganar un set).
- **Petición a ui_main (pre-pintar la cortinilla) — evaluada, no se aplica**: la traza (`tools/out/w4lead/trace2.js`) muestra que el hueco de 65-77 ms del primer corte de `debug=rally&live=1` NO es la cinta: es el primer raster (flush de GPU de 40-65 ms) del HUD del saque (`#prompt`, `#touch`, `#coach`, SALTAR), que esa escena nunca ha pintado antes porque empieza a mitad de peloteo. Pre-pintar la cinta (opacidad 0,002, los dos colores) no lo cambia (68/64 ms frente a 76/77). En el partido real el HUD del saque ya se pinta al empezar (bajo la presentación) y el primer corte punto → saque no tiene hueco (`tools/out/w4lead/rmatch.js`: 0 frames > 40 ms en el corte; el único tirón es el del primer punto, que se ha recortado desde arena.js, ver notes/arena.md).
- Verificado en el árbol integrado: simtest completo + barrido `simtest <10|20> <1..25> 0` 50/50 TODO OK; console.sh 19 escenas (1280×720 y 844×390 táctil) sin errores; drive, touchplay, padplay (estándar y DualSense) y audiotest completo TODO OK; perf 844×390 ×4 «objetivos cumplidos» (ver TRASPASO).

## Sprint 9-nov-2026 — Challenge (B4 entrada, B5 cámara de revisión)

`js/input.js` (B4):
- Nueva intención de pulso `challenge` en `VB.Input.poll()` (flanco, una vez aunque se mantenga): teclado **V** (`KeyV`, reserva `v`),
  mando **LT/L2** (botón 6 del mapeo estándar y del DirectInput genérico; analógico, cuenta > 0,5). XInput no estándar: los
  gatillos son ejes sin mapeo fiable, sin challenge por mando (queda V o el botón táctil de la UI). `it.any` lo incluye.
- `VB.Input.glyph(action, dev?, fam?)` → texto: `glyph('challenge')` = «V» / «LT» (fam `'ps'`: «L2») / «CHALLENGE» (touch).
  `VB.Input.glyphs()` → tabla `{challenge:{keyboard,gamepad,ps,touch}}` para el panel de controles.
- `VB.Input.pressChallenge()`: pulso que sale en el siguiente poll (por si la UI prefiere pasar por la entrada; el botón táctil
  puede llamar directamente a `ctx.actions.challenge()`).
- `_debug().stats.out.chal` cuenta los pulsos. tools/padtest.js: 2 comprobaciones nuevas (LT a medias no; LT = un flanco).

`js/camera.js` (B5):
- Plano `'review'` (`getShot()`), con prioridad sobre los demás mientras `g.review` tenga `x`,`y` numéricos (lectura defensiva,
  sin demo). Entra por CORTE (`markCut(prev,'review','replay')`): cámara en la prolongación de la línea más cercana al bote
  (banda: del lado del fondo; fondo: hacia el centro), baja de 5,4 m a 1,25 m y de 5,6 a 2,9 m de la marca durante el 55 % de
  `g.review.dur` (según `g.review.t`), FOV 42→27, mirando a ras de suelo entre la marca y la línea (línea vertical en el centro).
- Cámara estable / reduced-motion: bajada corta (2,9→1,25 m), más suave, sin temblor (se corta el que hubiera y `shake()` se ignora).
- Al acabar (`g.review = null`) sale por corte: a `'point'` (replanificado) con `kind 'replay'`, al saque con `kind 'serve'` y
  `from 'point'` (la cortinilla de ui.js lo trata como la salida normal del punto), o al final con `'over'`.
- `heroShot()` devuelve null durante la revisión (players no orienta la celebración a la cámara del héroe).
- Medido (1280×720, revisión simulada): giro máx. ~34°/s (combinado) con y sin Cámara estable; 0 errores JS.

## Controles de PC (9-nov-2026)
- Teclado: **Espacio saltar** (pulgar), **J o X golpear/sacar** (J: mano derecha jugando con WASD; X: mano izquierda jugando
  con las flechas, junto a C cambiar y V challenge). K sigue saltando como alias mudo (no se anuncia). Resto igual.
- Ratón (solo `ctx.state === 'playing'`, overlay táctil oculto, y nunca si el clic cae en `button,a,input,…,[data-ui],[data-opt],
  [data-nav],.screen,.sheet,#touch`): **clic izquierdo = golpear, derecho = saltar**. Entra en el mismo mapa que las teclas
  (ids `Mouse0`/`Mouse2`), así que mantener pulsado da `hitHeld`/`jumpHeld`. Lee `e.buttons` en pointerdown/move/up (el 2º botón
  con otro ya pulsado llega como pointermove acordado). Solo `pointerType 'mouse'`: dedo y lápiz siguen en el overlay, que además
  para la propagación (sin golpe doble). Sin menú contextual sobre el canvas. `_debug().stats.mouse = {hit, jump}`.
- Textos: `GLYPH.keyboard` de ui.js (hit/serve «J», jump «Espacio»; `hitT 'J'`, `jumpT 'ESPACIO'`) y filas de teclado del panel
  Controles (ratón dibujado con `M('l'|'r')`). tools/drive.js juega con J, clic y Espacio.

## Colocación en salto — entrada (10-nov-2026)
- Acción nueva `jset` (COLOCAR). Teclado **K** (era alias oculto de saltar; `CODE.KeyK`/`KEY.k`), ratón **clic central** (`Mouse1`, bit 4 de
  `e.buttons`; `mousedown`/`auxclick` con `button 1` llevan `preventDefault` en partido para que la rueda no abra el autodesplazamiento), mando
  **X** (botón 2; PS □) en los tres mapas (`PB`, `PB_X`, `PB_D`: `jump` pasa a `[1]` y `jset: [2]`; `pad.prev[i][6]`).
- `poll()` → `it.jset` (flanco). Con `jset`, `jump` también es true: en el suelo salta igual que antes (K y X saltaban), y menús, presentación y
  pausa del punto lo tratan como SALTAR. La sim mira `jset` solo en el aire. `jumpHeld` incluye K/X/rueda.
- Táctil: rol nuevo `'set'` (5º de `ROLES`; los bucles usan `ROLES.length`), botón `.vt-set` «COLOCAR» verde con icono de arco, 64 px encima de
  SALTAR (`right 157`, `bottom 110`; 56 px a ≤ 420 px de alto, 52 a ≤ 340: 844×390 y 667×375 usan los dos 56), a 12 px de SALTAR (márgenes de
  toque de 12 y 16 px que se tocan, para deslizar de SALTAR a COLOCAR) y lejos de GOLPEAR y del joystick (≤ 62 % del ancho).
  Oculto con `visibility` (la geometría medida sigue valiendo; `hitTest` lo salta si `!T.setOn`). `touchContext` lo enciende con
  `VB.Sim.jsetReady(g)` (en el aire, balón jugable a < 3 m, toque donde cabe). Deslizar de SALTAR a COLOCAR pulsa COLOCAR. `_debug()` añade
  `setOn` y `geo.set`; `stats.press.set`, `stats.out.jset`, `stats.mouse.jset`. `glyphs().jset = {keyboard 'K', mouse 'clic central', gamepad 'X', ps '□', touch 'COLOCAR'}`.
- Medido: touchplay 844x390 → botón 60×60 px CSS en pantalla, huecos 24 px con GOLPEAR y 12 px (cajas) con SALTAR; padtest 28 ok, touchtest 30 ok.
- Arreglos 10-nov-2026 (revisión): la sim guarda COLOCAR pulsado justo al despegar (`g.jsetQ`, 0,2 s), así que la doble pulsación rápida (K K,
  X X, rueda dos veces, deslizar rápido de SALTAR a COLOCAR) coloca. `jsetReady` mira el contacto previsto (lo que se ofrece es lo que sale) y
  es falso bloqueando un remate rival. En menús, X/□ ya no hace «volver» (ui.js `nav`: `it.jump && !it.jset`). Sin verificar en headless: si el
  `preventDefault` de `pointerdown` suprime el `mousedown` (y con él `onAux`) y si la rueda abre el autodesplazamiento sobre controles de la
  interfaz (ahí no hay `preventDefault`, a propósito: el panel Controles se desplaza). Mirar con un ratón real en Windows.

## 6v6, sprint 2 (10-nov-2026): plano de televisión `tv`

- `pickShot`: con `g.size === 6` (y fuera del menú) saque, peloteo y punto usan `tv` (corte del punto al saque: `TVS.cut`); `court`, `over` y `review` como en 2v2. Sin
  `intro`, `clinch` ni `cutaway` en 6v6 (guardas `g.size !== 6` en `clinchDetect`, el cierre por `setWon` y `cutawayStart`).
- `tvShot`: cámara fija a x = min(14,2, bX − 0,8), z = 7,8, y = 0,25·balón.y (suavizado 0,9 s), mirando a −x. Cabeceo y lente con `fit2`:
  cabezas (z 2,1) del jugador más lejano − 0,9 m a +0,6 NDC (el marcador y la guía de toques encima) y pies del más cercano + 1,2 m (o el
  sacador cercano) a −0,84 NDC; como poco ±6,5 m. Abre deprisa (0,3 s) y cierra despacio (0,8 s). Si los laterales (±5 m en el fondo
  cercano) no caben en ±0,92 NDC, abre la lente. Suavizado del rig 0,4 s. Del `point` al `tv` siempre por corte (`backPending` + `PF.backCut`).
- Prueba: `node tools/tv6test.js [WxH] [s] [semilla]` (12 en cuadro el 100 % de los frames, balón ≤ 2 % fuera, límites, rótulos LOC/VIS,
  sin mandos táctiles). El 2v2 no pasa por nada de esto (todo tras `g.size === 6` o el plano `tv`).

## 6v6, revisión del sprint 2 (10-nov-2026)

- Sprint 1: camera.js recorre `g.players.length` en todos los bucles; `mateOf` / `mateOfP` / `mateIn` dan lo mismo en 2v2 y, con más
  jugadores, el compañero más cercano; atacante rival y bloqueador más cercano a la red sin índices fijos (mismo desempate). input.js: la
  transparencia de los botones táctiles recorre a todo el equipo y, con `g.watch`, no hay mandos táctiles.
- Espectador (`g.watch`, solo `?format=6v6`): main.js crea el partido con `ctrl:'one'` (antes iba con 'both' y `g.ctrl` saltaba de jugador:
  17 eventos `switch` en 70 s); players.js no pinta el halo ni la flecha del controlado y fx.js no pinta el aro amarillo (`focusRing`).
  La cámara `tv` no lee `g.ctrl`. El 2v2 no cambia (todo tras `g.watch`).
- Pendiente (sprint 3): plano detrás del humano (`gameplayShot` con más FOV, §1.6), oclusión mirando los 2 compañeros más cercanos al eje
  cámara-jugador (hoy `mateOf` = el más cercano al humano), planos de reacción / cierre de set / sacador rival en 6v6, `bench`, y quitar
  `switch` del 6v6 con humano (control Uno por rol).

### Playa (revisión final, 10-nov-2026)
- `lostBall` usa la pista de la partida (`g.HL`/`g.HW`, respaldo `VB.C`): en la playa un balón que va a caer entre 8,4 y 9,4 m ya cuenta como perdido.
- Pendiente: la grúa del fin de set en la playa mira a `landmarks.scoreHung` (en la playa, el cielo); no confirmado.

## Diana del saque dirigible en el móvil (11-nov-2026, camara-fx; fx.js)
Problema (TRASPASO, sprint Carrera): a 844×390 el campo rival mide ~30-50 px de fondo, la profundidad casi no se lee, el disco de
dispersión bueno/malo medía < 1 px frente a ~6 px y la diana cerca de la red la tapaban el compañero y el balón.
- `aimXray` (fx.js): copia de la diana con `depthTest: false` (renderOrder 12, opacidad `AIM_XOP` 0,42 × la de la diana) encima de
  jugadores, red y balón; misma posición/giro/escala/color que `aimRet`. +1 dibujo SOLO mientras se apunta el saque (el resto, 0).
- Guías `aimLx` / `aimLy` (lote de calcomanías, 0 dibujos, celda blanca): línea de la red al fondo por la y de la diana y línea a lo
  ancho por su x, ~2 px CSS (`AIM_LPX`; la transversal ×`aimSt` por lo rasante), opacidad `AIM_LOP` 0,45, color de la diana.
- Pantalla pequeña: cuando el aro mínimo legible (`AIM_SVPX` px) pasa de `AIM_SVMIN`, aro y disco crecen en la misma proporción
  (`svL = rmin / AIM_SVMIN`, tope `AIM_SVL` 1,8): radio mostrado = dispersión × svL. En 1280×720 svL = 1 (como antes).
- Cámara del saque (camera.js) SIN CAMBIOS: probé subirla en pantalla baja (3,5 → 3,9-4,3 m, con lente máx. +14°): el campo rival
  ganaba ~2× de fondo pero el sacador salía cortado por el pecho en el pabellón y en la playa el plano se abría demasiado
  (la búsqueda de candidatos de `serveUsComp`/`svcSolve` y `fit` dependen de esa altura). Si se retoma: hay que mover a la vez
  `H` de `serveUsComp`/`svcPrewarm`/`PRED.z` y `SVP.nBot`/`fMax0`, y pasar `tools/camtest.js` (SERVE, 844x390t).
- Capturas: antes `…/scratchpad/b/toss-*.png`, después `…/scratchpad/a/toss-*.png` (844×390 táctil, pabellón y playa, diana en
  x −7 / y 0 y x −1,6 / y 3,2).

## 6v6, sprint 3: humano (11-nov-2026)
- **input.js `touchContext`**: el botón ⇄ ya no se oculta en 6v6 aunque el control sea 'one' (`swHide = g.ctrlMode === 'one' && g.size !== 6`):
  en 6v6 es «¡Pídela!» (sim `g.ask6`); teclado C y mando Y/LB/RB igual (mismo `switchPlayer`). Sin `g.watch` (partido humano) los mandos
  táctiles salen como en el 2v2. Probado con `tools/drive6.js` (teclado y TOUCH=1: saque con SACAR, toques con GOLPEAR, ⇄),
  `EXTRA='format=6v6&human=1' node tools/touchplay.js 844x390 25` y `... padplay.js 1280 720 30` (joystick y stick hacia el balón, GOLPEAR,
  SALTAR, COLOCAR en el aire; fallan solo «SACAR en tu saque» —saca primero el colocador— y «⇄/RB cambia de jugador», a propósito).
- **Cámara**: sin cambios. El 6v6 humano usa el plano de televisión `tv` del sprint 2 (encuadra a los 12; adelante = (−1, 0), así que el
  mapeo de la entrada es el mismo que con la cámara detrás del equipo). **Pendiente** (diseño §1.6): plano detrás del humano
  (`gameplayShot` con más FOV), oclusión con los 2 compañeros más cercanos al eje, reacción, cierre de set y sacador rival en 6v6.
- Revisión del sprint 3: en 6v6 el botón ⇄ cambia de icono (mano levantada, `ICON_ASK`) y de etiqueta («Pedir el balón»), y sale
  apagado (`.off`) cuando pedir no vale (`VB.Sim.askOk`: saque, zaguero, colocación ya hecha). En 2v2 sigue con las flechas.

## 6v6: cámara en 3ª persona (11-nov-2026, camera_input; pedido de Ferran: «es más dinámico con la de 3a persona»)
Ajuste `ctx.settings.cam6`: `'3p'` (por defecto) o `'tv'` (la de televisión del sprint 2, tal cual). `?cam6=tv|3p` manda (pruebas; se lee
UNA vez al cargar). Solo con `g.size === 6`, sin `g.watch` y con `g.ctrl` (`tp6(g)` en pickShot): el espectador (`?format=6v6`, tv6test,
escenas serve6/rally6/point6) sigue con `tv`. El 2v2 no pasa por nada nuevo (comprobado abajo).
- **Planos** (camera.js): `tp` (juego) y `tpPoint` (punto; `getShot()` lo da como `'point'` para ui.js: rótulos, cortinilla, flecha de
  fuera de cuadro). `court` y `over` como en el 6v6 de televisión.
- **`tpShot`**: detrás y por encima del jugador que llevas, mirando a la red con algo del balón. Fases (`tpPhase`, parámetros `TPK`
  suavizados 0,6-0,7 s, sin saltos): `def` (el balón es del rival: 7,4 m detrás, 5,5 m de alto), `bld` (construimos: 6,8 / 5,5, 0,4 m de
  hombro), `atk` (tu remate o te toca el 3r toque: 5,8 / 4,9, 1 m por encima del hombro hacia el centro y mirando a tu zona de ataque),
  `srv` (tu saque: 4 m detrás, 5 m de alto, sobre el hombro derecho; abajo las RODILLAS del sacador a −0,9 NDC y arriba el fondo rival a
  0,46 —0,62 en pantalla baja— y el lanzamiento previsto de 3,9 m: el sacador grande y la diana del campo rival por encima de tus
  compañeros, como el saque del 2v2), `tsrv` (saca un compañero) y `rsrv` (saque rival: la mira tira hacia el sacador y el ajuste
  mete su cabeza y su lanzamiento de 4,75 m). Cámara a x ≤ 14,4 (lo que sobra, en altura).
  - **Encuadre por ajuste** (`fit2`, como la tele): pies del sujeto a nB (−0,6; táctil −0,74) y arriba lo que pida más lente: el fondo
    rival (0,3; pantalla baja 0,48), el balón adelantado 0,25 s con la cumbre prevista (0,8; táctil 0,64) y, en el saque rival, el sacador.
    A lo ancho, la red entera (postes en ±0,95 NDC) y el jugador en ±0,7. Lente 40-66° de vertical (28 en tu saque), que cambia a ritmo
    limitado (abre ≤ 14°/s, cierra ≤ 4°/s; confort 9 y 3): sin bombeo. El cabeceo sale de la lente REAL del frame (con lente de sobra, la
    holgura a medias; si falta, manda el balón hasta que los pies bajen 0,18 NDC más).
  - **Rumbo**: hacia la red ±20° (los mandos van con la cámara: `basis` se actualiza en `tp` como en los planos de juego del 2v2, ±26°);
    si el balón se sale de ±0,8 NDC a lo ancho, gira lo justo (hasta ±30°).
  - **Oclusión** (diseño §1.6): de los compañeros, los 2 más cercanos al eje cámara-jugador; tapa si está a < 0,8 m del eje y cubre > 20 %
    del alto del jugador en pantalla (desde 5 m, uno pegado a la cámara queda por debajo del cuadro y no cuenta). La cámara se aparta de
    lado (palanca hasta 2,2 m, entra en 0,35 s, sale en 0,7) y sube hasta 0,9 m. **Primer plano**: un compañero cortado por el borde de
    abajo a la altura del pecho o la cabeza → la cámara sube despacio hasta 0,8 m (`TP.fg`, integrador: sube 0,9 m/s, baja 0,3).
  - **El balón también abajo**: entre la cámara y el jugador (defiende o recibe un compañero de atrás), segundo ancla inferior a −0,84 NDC.
    Los pies del jugador se adelantan con su carrera hacia la cámara (0,35 s): la cámara va por detrás y se salían por abajo.
  - **Saca un compañero** (`tsrv`; integración 11-nov): el SUJETO pasa a ser el sacador (`TP.sox/soy`, desplazamiento suavizado 0,6 s
    desde tu jugador; `TPK.tsrv` = [4,6, 5,1, −0,9, 1,1]) y se encuadra como tu saque (`srvL`: entero y abajo, con su lanzamiento y el
    campo rival; sin oclusión), con tu jugador dentro de ±0,85 NDC a lo ancho. Al sacar, la cámara se desliza hasta detrás de tu jugador.
    Antes (3 m detrás del sacador mirando solo el punto del golpe) el sacador salía cortado (o bajo el joystick MOVER) y el balón cruzaba
    el centro enorme. Captura `tools/out/arte/cam6/final/c6-*/3p-saque-companero*.png`.
- **`tpPointShot` / `tpPlan`** (reacción tras el punto y cierre de set): la cámara de juego sigue 0,55 s (se ve el bote) y CORTA
  (`markCut('point','point','point')`, anunciado en `nextCutIn`) a un plano bajo (2,7 m; cierre de set 3,2 m y abierto al equipo, con
  órbita lenta de 3°/s salvo en confort) del autor del punto (si fue error del rival y ganas tú, tu jugador) con los compañeros que tenga
  cerca. Busca entre 72 sitios (24 rumbos × 3 distancias: 5,4 m ×0,8/1/1,3; cierre 6,8 m) el que no cruza la red ni se pega a ella, no se
  sale del pabellón, no tiene a nadie ni nada (postes, silla, mesa, jueces) entre la cámara y el héroe ni pegado a la cámara dentro del
  cuadro, le ve de frente y mete más compañeros. Si durante la celebración alguien se acerca a < 3 m dentro del cuadro, la cámara se aleja
  (hasta 2,5 m). Pausa corta (< 1,45 s reales) → sin corte. Vuelta al saque SIEMPRE por corte (`markCut('point','tp','serve')`: la
  cortinilla de ui.js la tapa). Entre `tp` y `tv` (cambio del ajuste a mitad de partido) también por corte (`'cam'`).
- **Escenas nuevas** (main.js `debugScene`, autopilot: la IA juega también al humano): `tserve6` (saque rival lanzado), `recv6`
  (recepción), `spike6` (tu remate), `block6` (bloqueo de tu equipo), `point6h` (punto con el plano de reacción; `&won=1`), `setend6`
  (punto que cierra el 1r set; ojo: a los 1,45 s entra la grúa del cambio de campo, también congelado). Todas con `&n=N`, `&t=s` y
  `&cam6=tv`. `serve6h` / `rally6h` siguen (humano sin pulsar nada).
- **Prueba nueva `tools/cam6test.js`** `[WxH] [s] [semilla] [puntos]` (`TOUCH=1`, `CAM6=tv`, `SHOTS=dir`): partido 6v6 en vivo con autopilot y,
  frame a frame, jugador en cuadro (≥ 99 %), balón en cuadro en el peloteo (≥ 95 %), suavidad sin cortes (p99 ≤ 14 m/s, 75°/s, 16°/s
  de lente), límites y cortes de reacción/vuelta. Con `SHOTS` congela tras cada momento y captura (saque propio, saque rival, recepción,
  colocación, remate propio, bloqueo, punto ganado/perdido, fin de set).
- **Medido** (11-nov-2026, RTX 3060 Ti; `cam6test` 120 s, semilla 11): 3ª persona 1280×720 jugador fuera 0,00 %, balón fuera 0,00 %, p99
  5,6 m/s / 49°/s / 11,9°/s de lente; 844×390 táctil 0 % / 0 %, 5,8 m/s / 49°/s / 11,2°/s; 667×375 táctil (semilla 5) 0 % / 4,4 % (balones
  desviados que se van por la banda o detrás de la cámara), 5,9 m/s / 53°/s; semilla 3 a 1280×720 0 % / 0 %. 7-10 cortes al plano de
  reacción y otros tantos de vuelta. Televisión (sin cambios): 0 % / 0 %, lente p99 14,6°/s.
  **perf** 844×390 dpr 2,75 CPU ×4, `EXTRA=format=6v6` (perf juega con autopilot sin `g.watch`, así que ahora mide la 3ª persona; con
  `&cam6=tv`, la tele): media 89,5 fps (p5 55) / baja 97,6 (81); dibujos media 58-64, baja 36-39; triángulos media 342 k de media y **369 k
  de pico** (> 350 k), baja 120-124 k. Con la tele: media 331-341 k, baja 121 k (objetivos cumplidos). El pico es del **plano de
  reacción** (cámara baja a 2,7 m con 6-8 atletas cerca: no lejanos → malla media en vez de baja; players.js `FAR_D`/`FAR_RIV`) y de
  algún saque; en el peloteo, 331-348 k (justo como con la tele). Ver «Para el integrador».
  **2v2 sin cambios**: estado exacto de la cámara (posición, giro, lente) en 10 escenas a 1280×720 y 8 a 844×390 táctil igual al de
  antes salvo el ruido de tiempo real que ya da la misma copia dos veces (≤ 1e-4); capturas antes/después en `tools/out/arte/cam6/antes2v2/`
  y `despues2v2/`. Huella 2v2 de simtest idéntica.
- **Capturas** `tools/out/arte/cam6/`: `live-d/` y `live-m/` (`3p-*` y `tv-*`: saque propio, saque rival, recepción, colocación, remate
  propio, bloqueo, punto ganado y perdido; 1280×720 y 844×390 táctil), `live-667/` (3ª persona a 667×375 táctil), `3p-d/` y `3p-m/`
  (escenas de depuración), `prep-6v6-*` y
  `ajustes-imagen-*` (las filas nuevas).
- **Integración (11-nov)**: (1) pico de triángulos resuelto en players.js `screenLod` (solo 6v6): fuera de cuadro = lejano siempre; en el
  punto, solo los `PT6_N` = 4 atletas en cuadro más cercanos llevan malla media/completa y trazo, y < 15 % del alto = lejano; en el punto
  y el saque solo dan sombra los `PT6_SH` = 3 más cercanos (media). perf 844×390 dpr 2,75 CPU ×4 `EXTRA=format=6v6`: media 329 k de media,
  **348 k de pico**, 56-62 dibujos, 88-92 fps (p5 55); baja 119-120 k, 36-40 dibujos: «objetivos cumplidos». Por fase (sonda por frame, 120 s):
  peloteo ≤ 348 k, punto ≤ 338 k, saques ≤ 347 k (algún frame suelto de corte a 352-359 k). (2) Temblor ×0,4 en `tp`/`tpPoint` (cámara
  cerca: los remates daban picos de 260-345°/s). (3) Cortinilla de vuelta al saque cuando el punto no corta al plano de reacción
  (`TPP.willCut` falso): `nextCutIn` da ya el tiempo del corte de vuelta y `getDebug().pf` = `{cut: false}` en `tpPoint`, así ui.js la arma.
  (4) `tsrv` (arriba). (5) cam6test captura también el saque de un compañero (`saque-companero-0` al lanzar, `saque-companero`).
  Medido tras la integración (cam6test 100 s): 1280×720 s11 0 % / 0 %, p99 7,1 m/s / 39°/s / 11,9°/s; 844×390 táctil s11 0 % / 0 %;
  667×375 táctil s5 0 % / 4,4 %; tele 1280 y 844 táctil 0 % / 0 %. Capturas finales en `tools/out/arte/cam6/final/` (`c6-d`, `c6-m`, `c6-667`,
  `tv-d`, `tv-m`).
- **Pendiente / ideas**: con el humano zaguero el campo rival ocupa ~15-18 % del alto a 844×390 (la tele ~20 %; geometría: ~1/3 del
  tramo pies-fondo rival); el plano de reacción no conoce la coreografía de players (no hay `heroShot` en 6v6: el héroe puede estar de
  espaldas si mira a sus compañeros); `bench` (tiempo muerto / líbero) y «Avanzar» siguen sin plano; sin seguimiento del remate (CAM-08)
  ni momento de red (CAM-17) en 6v6.

## Cámara lenta ANTES de golpear: solo en Fácil o en los primeros partidos (11-nov-2026, lote B; pedido de Ferran)
Ferran: «el modo este que mete como una cámara lenta antes de darle a la pelota solo exista en niveles bajos o las primeras
partidas. Hace el juego demasiado fácil». Vale para el 2v2 y el 6v6. Solo presentación: la sim no cambia (huella 2v2 idéntica).
- **Inventario de bajadas de `ctx.timeScale`** (todas las de camera.js y ui.js; main.js solo la aplica, audio.js solo la lee):
  | Dónde | Qué | ¿Antes del golpe del humano? | Decisión |
  |---|---|---|---|
  | ui.js `guideCheck` → `slowmo(0.4, 1.3, 0.35, 'novice')` | tarjeta guiada «Primer/Segundo/Tercer toque» a cámara lenta | **SÍ** (0,05-0,85 s antes de su ventana) | **Solo Fácil o primeros partidos** (abajo) |
  | camera.js `clinchDetect` → `slowmo(0.28/0.5, …)` | balón de set/partido cayendo sin que nadie llegue (CAM-09) | No: solo arranca si ningún jugador del lado donde cae puede llegar (alcance + plancha + carrera); si alguien lo toca se deshace con `timeScale = 1` | Se queda |
  | camera.js `point` → `slowmo(0.28, 1.9)` / `(0.5, 0.8)` | punto de partido / de set ya anotado | No (el punto ya está) | Se queda |
  | camera.js `hitStop` remate humano (60/35 ms), saque en salto perfecto (35), bloqueo directo (70), defensa perfecta de un remate (40) | congelación de impacto | No: todas suenan en el evento `hit`/`block` del humano, el golpe ya está dado (la de la defensa, 40 ms + 80 de vuelta, es el sello del toque, no ayuda al siguiente) | Se quedan (CAM-04 «feel»; confort las quita) |
  | camera.js `onGameStart`/`onState('menu')`/aborto del cierre | `timeScale = 1` | — | Son vueltas a 1 |
  La única cámara lenta previa al golpe era la **guía del novato**. Y su disparador (`record.played === 0`) tenía un agujero: el récord
  `voley3d.record` no cuenta el 6v6 ni la Carrera (ui.js `showEnd`), así que quien solo juega esos modos era «novato» para siempre y
  veía la cámara lenta en TODOS los partidos, también en Normal, Difícil y Experto. Eso es lo que Ferran veía en el 6v6.
- **Regla nueva** (ui.js `guideOn`, bloque «Primeros toques guiados»): novato = sin partidos en el récord (como antes). En **Fácil**, la
  guía sigue como antes (mientras el récord esté a 0). **A partir de Normal**, la guía solo sale en los **`GUIDE_MAX` = 3 primeros
  partidos con guía** de este dispositivo (contador local `voley3d.guided`: partidos en los que ha salido alguna tarjeta; `account.js` no
  lo sincroniza, es de presentación). `&guide=1` la fuerza siempre y no cuenta (pruebas y capturas). `ctx.debug` y la demo, nunca.
- **Gate en camera.js**: `slowmo(scale, realSeconds, easeOut, aid)` — con `aid` la cámara lenta es una ayuda ANTES del golpe y solo entra
  si `aidOk(aid === 'novice')`: Fácil siempre; Normal o más, solo con la certificación `'novice'` del que llama. Devuelve `true/false`.
  Cualquier ayuda previa al golpe que se añada (p. ej. pistas del lote A) debe pasar por ahí. Lo de después del golpe no pregunta.
- **Comprobado** con el juego real en Chrome (script de sesión, 5 escenarios × 22 s, 2v2 Partido rápido, 1280×720, récord y ajustes
  sembrados en localStorage): Normal con `guided = 3` → ni tarjeta ni `slowmo`, `timeScale` nunca < 0,9 antes del 1r toque humano;
  Normal con `guided = 0` → tarjeta y cámara lenta, `guided` pasa a 1; Fácil con `guided = 99` → tarjeta y cámara lenta; Normal con 5
  partidos en el récord → nada; Difícil sin guiar → primeros partidos, entra (y cuenta). Sin errores de página.

## Sprint 5, E3 + E6 + peticiones de E1 (12-nov-2026, camera_input; tarea CI del workflow)
Solo input.js, camera.js, tools/keytest.js (nuevo) y tools/padtest.js. Huella 2v2 de simtest idéntica (no toca la sim).
- **Teclas reasignables (input.js).** `DEFAULT_KEYS` = las de siempre (W/↑, S/↓, A/←, D/→, J/X golpear, Espacio saltar, K colocar,
  C cambiar, V challenge, P pausa, M sonido), dos casillas por acción. E1 no añade acciones (la finta es GOLPEAR y, antes del golpe,
  SALTAR o COLOCAR; el golpe colocado es COLOCAR en el 3r toque) y nada se mantiene: sin `holdMode`. `ctx.settings.keys` = SOLO
  diferencias `{acción:[c1,c2]}`; `effKeys` sanea (primero lo guardado, luego lo de fábrica sin repetir; lo inválido o reservado vuelve
  a la de fábrica de su casilla; una 2ª casilla guardada vacía se respeta). `buildCode()` rehace `CODE` (e.code) y `KEY` (e.key, solo
  para eventos sin código y para lo fijo). Fijas: Esc pausa, Intro/NumpadEnter aceptan. Reservadas: esas, Tab, F1-F24, Ctrl/Alt/Meta,
  ContextMenu, Retroceso/Supr (borran en la captura) y **F** (pantalla completa de main.js).
- **Mando.** `DEFAULT_PAD = {hit:[0], jump:[1], jset:[2], sw:[3], chal:[6]}` (+ LB/RB fijos de cambiar mientras nadie los use), solo
  en el mapeo estándar (PB se rehace en su sitio; PB_X/PB_D no cambian). Valen 0-7, 10, 11. `ctx.settings.padKeys` = diferencias.
  `poll()` añade `navOk` (botón 0), `navBack` (1), `navTab` (-1/+1 con 4/5): FIJOS aunque se reasigne; `confirm` del mando sale de
  `navOk || Start` (antes, de golpear).
- **API** (`VB.Input`): `OPTS ['keys','padKeys','padDead','touchSize']`, `DEFAULT_KEYS`, `DEFAULT_PAD`, `onSettings(s,k)`,
  `bindings()` → `{keys, pad, padStd, padFam, acts, padActs, fixed}` (copias), `rebind(kind, act, slot, code)` → `{keys|pad, swap, err}`
  (pura; err '' | 'reserved' | 'empty' | 'primary' | 'bad'), `captureNext(kind, cb)` → `cancel()` (cb(v, why): why 'key' | 'pad' |
  'clear' | 'cancel' | 'timeout'), `capturing()`, `keyName(code)` (getLayoutMap en caché + tabla española: «Espacio», «↑», «Num 4»,
  «Mayús der.», «Ñ»…), `padName(i, fam)` ('A','LB','RT' / '✕','L1','R2'). `glyph()`/`glyphs()` salen de las teclas efectivas y
  ahora tienen también `hit` y `jump`. `_debug()` añade `dz, padSoft, cap, hush, touchK, setRoll, code, pb` y `stats.out` añade
  `mute, navOk, navBack, navTab`.
- **Captura.** keydown/keyup en window, fase de captura, registrados en `init` (antes que career-ui): solo actúan con una captura viva,
  `stopImmediatePropagation` + `preventDefault` (ni el partido, ni ui.onKey, ni la F de main.js la ven) y se traga su keyup. Esc
  cancela, Retroceso/Supr → `''`, 6 s → 'timeout', blur / pestaña oculta → 'cancel'. La limpieza va antes del callback (una excepción
  en cb no deja el teclado muerto). Mando: en `poll`, primer flanco válido desde que empezó (lo que ya estaba pulsado no cuenta;
  Start cancela); durante la captura y hasta soltar todo, `poll` no da ningún flanco (`CAP.hush`).
- **padDead** (0,1-0,3, def. 0,18) → `DZ`, `PAD_SOFT = max(0,26, DZ + 0,08)`. **touchSize** (1-1,3) → variable CSS `--vts` en
  `#touch`: tamaño, letra y huecos de GOLPEAR, SALTAR y COLOCAR (⇄ solo sube con ellos; joystick y pausa igual). Medido a 1,3 en
  844×390 y 667×375: GOLPEAR r 60 px, huecos GOLPEAR-SALTAR 36 px y GOLPEAR-⇄ 39 px (a 1: 22 / 25).
- **E1:** el botón táctil COLOCAR usa `VB.Sim.altReady(g)` (con respaldo a `jsetReady`): con `'roll'` dice «COLOCADO» (aria «Golpe
  colocado»). M8 (flotante en salto) no se hizo en E1: `jumpOff` sigue con `tossing`.
- **Cámara (camera.js).** `VB.CameraRig.OPTS = ['camDist','camCuts','lessMotion']`. `readComfort` (una vez por frame) lee
  `distK` ('near' 0,86 | 'far' 1,18: `back`/`h` de rally/defend/attack en `gameplayShot` y `touchFitPlan`; medido en `debug=rally`:
  cámara a 4,34 / 5,15 / 6,20 m del jugador, altura 3,44 / 4 / 4,72), `cutsLess` (`camCuts 'less'`) y `reduceMotion` = `ctx.reduceMotion`
  si main.js lo publica (booleano propio de ctx); si no, `lessMotion` 'on'/'off'/'auto' (+ matchMedia en vivo).
  **Punto «tranquilo»** (`quietPoint(g)` = `cutsLess || g.drill`): en 'point' `pickShot` da 'rally' (la cámara de juego se queda; sin
  plano de reacción ni héroe) y al saque se va por corte asentado (`QP.on` → `PF.backCut` + `backPending`, `lastCut.kind 'serve'`);
  `cutawayNext` y el arranque del plano del sacador rival, false; `heroShot()` null. Presentación, cierre de set/partido y grúa del cambio
  de campo no cambian. **Gimnasio (E6):** además sin `clinchDetect`; el evento `drillStage` corta a la cámara asentada en el plano
  de juego (`settle`, `lastCut.kind 'drill'`, nuevo) y apaga cámara lenta, hit-stop, cutaway, cierre y seguimiento. El 6v6 no cambia.
- **Medido** (autopilot, `debug=rally&live=1`, 60 s): 'all' → 691 frames de cutaway, 1222 con héroe, cortes point 4 / serve 4 / cutaway 3;
  'less' → **0 cutaway, 0 héroe**, solo 4 cortes 'serve', salto máximo sin corte 0,57 m. Gimnasio `drill:'atk'` con autopilot (40 s):
  10 cortes 'drill', sin planos de punto, salto máximo sin corte 0,15 m. camtest 40 s con los valores por defecto: los mismos fallos que
  la copia de antes del cambio (spiker, clutter, wide, fovpump: preexistentes y de ruido); heroAll 3/4 en una pasada (86 % en 844×390t,
  7 puntos), 4/4 en la de antes: ruido, el código por defecto no cambia (distK 1, sin punto tranquilo).
- **Pruebas:** `node tools/keytest.js` (nuevo, 38 ok) y `node tools/padtest.js` (ampliado: 9-12, 52 ok).

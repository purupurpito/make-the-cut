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
  posiciones puntuando: zona libre, >= 2 m de postes/silla/2.º árbitro/mesa/jueces y de los jugadores, sin la red delante,
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
(≈3,2 s tras un set, ≈3,8 s a los 8 del 3.er set), y `VB.Arena.landmarks.scoreHung = {x:0, y:0, z:11.4}` (sim) para mirar
al marcador colgado. Ver notes/arena.md §8.

## Cierre para publicar (7-nov-2026, PC de casa, RTX 3060 Ti): cambio de campo, táctil y mando robustos, coste

### js/camera.js
- **Plano `court` (cambio de campo)**: al llegar `courtChange` (solo partido, no demo), el plano de reacción del punto se ve
  1,45 s (1,25 s a los 8 del 3.er set) y CORTE a una grúa alta por la banda de la mesa (y > 0; la silla del 1.er árbitro no
  tapa la red): de encima del campo rival a detrás de nuestro equipo, 7,2 → 6,3 m de alto, ~85° de giro, mira casi fija cerca
  del centro (se ven los dos campos, los jugadores yendo a su sitio, el aviso "CAMBIO DE CAMPO" y el videomarcador). La duración
  se ajusta a la pausa real de sim (2,4 s tras un set con su cámara lenta; 2,0 s a los 8). Al empezar el saque, la grúa BAJA
  deslizando 1,4 s al plano del saque: sin corte. Base de control congelada durante la grúa; después, la de siempre (el humano
  sigue en x > 0). Modo confort: arco más corto.
  Medido (`tools/out/ci/courttest.js`, juego en vivo con autopilot hasta el evento): tras un set, 1280x720: 2,46 s de grúa, giro
  máx. 43-44°/s, cabeceo 6-7°/s, un único corte (reacción → grúa), base tras el cambio (-1, 0). A los 8 del 3.er set: 2,06 s,
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
  - 2.º dedo en la mitad izquierda: si se levanta el del joystick, lo hereda desde donde está.
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
  flancos, 2.º mando, desconexión con y sin evento → pausa, mando olvidado que no pausa, DirectInput con hat, XInput no estándar.
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
- **1.er toque tras jugar con mando** (overlay oculto): `pointerdown` en captura sobre `window` → si es táctil, en partido, y no
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

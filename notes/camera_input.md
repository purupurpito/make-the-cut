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

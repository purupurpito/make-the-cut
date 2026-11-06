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

## Peticiones a otros owners

### ui_main (main.js / tools)
1. **Escena de depuración `switch`** (opcional, para ver el deslizamiento de cámara al cambiar de jugador):
   en `debugScene(name)` añadir:
   ```js
   case 'switch':
     g = Sim.createGame({ demo: false, autopilot: true, seed: sd });
     keep = advanceUntil(g, function (e) { return e && e.type === 'switch' && e.auto && !e.reset; }, 0.18); break;
   ```
   (congela a mitad del deslizamiento; con `&live=1` se ve entero).
2. (Comprobado, no requiere cambios) `.is-touch .hud-btns{display:none}` ya evita la doble pausa: en táctil
   la pausa es la del overlay (`.vt-pause`, arriba a la derecha con safe‑area).

### Arnés de cámara (propuesta de fichero nuevo, lo escribí fuera del proyecto)
Un test headless de la cámara (sim autopilot + cámara a 60 fps con THREE simulado) que mide velocidad máxima,
velocidad angular, % de frames con el balón y la cadera del jugador en pantalla, clipping con la red y límites.
Está en el scratchpad de la sesión (`camtest.js`); si ui_main quiere, se puede añadir como `tools/camtest.js`.
Resultados (4 min, 1280×720): balón en pantalla 99,7 % de los frames de peloteo, cadera del jugador controlado 99,4 %,
0 NaN, 0 cruces de red, 0 salidas de límites, giro máximo ~110°/s (90 % de los frames < 30°/s).

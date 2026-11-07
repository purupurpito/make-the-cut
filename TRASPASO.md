# TRASPASO — Voley 3D

Proyecto personal de Ferran: juego de vóley 2 contra 2 en 3D (Three.js) con cámara en tercera
persona detrás del jugador. Nace del prototipo isométrico (`prototipo-iso/index.html`, publicado
en https://claude.ai/artifact/EtrD29LcXsg9PgrYUuteGp), que funciona y se queda tal cual.

> Para Claude en el PC de casa: lee este fichero, `CONTRACT.md` y `notes/*.md` antes de tocar nada.
> Nada de reglas de Customer Care de Trilogi aquí: es un proyecto personal.

## Cómo se está construyendo

Un flujo multiagente (guion en `tools/workflow/voley-3d.workflow.js`) con estas fases:

1. **Foundation** ✅ — arquitectura, port de la simulación del prototipo, 3D mínimo jugable,
   arnés de pruebas. Resultado: `CONTRACT.md` (la ley: propiedad de ficheros, interfaces, eventos,
   coordenadas, orden por frame).
2. **Build** ✅ — 6 especialistas en paralelo, cada uno dueño de sus ficheros:
   - `sim` → `js/sim.js`, `js/ai.js`, `tools/simtest.js` (reglas, calidad de golpe, saques, dificultad)
   - `players` → `js/players.js` (atletas y animación procedural)
   - `arena` → `js/arena.js`, `js/fx.js` (pabellón, luces, público, red, balón, efectos)
   - `camera_input` → `js/camera.js`, `js/input.js` (cámara 3ª persona, teclado, mando, táctil)
   - `audio` → `js/audio.js` (sonido procedural) ✅ terminado
   - `ui_main` → `index.html`, `js/ui.js`, `js/main.js`, `tools/shot.sh`, `tools/console.sh`, `tools/drive.js`, `tools/eval.js`
   Lo que uno necesita en ficheros ajenos lo deja en `notes/<owner>.md`.
3. **Integrate** — aplicar `notes/*.md`, hacer que todo funcione junto, probar todo. ✅
4. **Review ×2** — 5 críticos (visual, jugabilidad+reglas, cámara, técnico, primer jugador) +
   arregladores por propietario + integración. ✅ (2 rondas)
5. **Final QA** ✅ (6-nov-2026, PC de casa)
6. **Pendientes** ✅ (7-nov-2026, PC de casa): cierre de lo que quedaba por owner + integración.
7. **Verificación ×2** ✅ (7-nov-2026, PC de casa): verificadores por área → arreglos por owner → integración (dos rondas).
8. **Final QA 2** ✅ (7-nov-2026, PC de casa): todas las pruebas, capturas y medidas finales; sin cambios de código.

## Estado (7-nov-2026, tras el Final QA 2, PC de casa con RTX 3060 Ti)

El juego está completo y todas las fases del guion están hechas (Foundation, Build, Integrate, Review ×2, Final QA, Pendientes,
Verificación ×2 y Final QA 2). Lo que hizo cada ronda está en `notes/informes-build.md` y en el log de cada `notes/<owner>.md`.
El Final QA 2 no encontró nada roto y no cambió código. Logs y capturas en `tools/out/` (`qa2_*.log`, `final2/`).

### Comprobado en el Final QA 2 (ejecutado, no supuesto)

- **Simulación y reglas**: `node tools/simtest.js` completo → «TODO OK», sale con 0. Cubre 4 toques, doble contacto, el bloqueo que no
  cuenta como toque, sets a 25 y tie-break a 15 con 2 de diferencia, red, antena (8.4.3/8.4.4), paso por debajo de la red, 8 s, bloqueo
  y ataque del saque, cambio de campo, textos del árbitro (lista cerrada) y los 4 niveles.
- **Equilibrio** (matriz de simtest: bots con modelo de jugador en 3.ª persona; % de puntos del humano, P(partido) estimada):

  | jugador \ CPU | Fácil | Normal | Difícil | Experto |
  |---|---|---|---|---|
  | perfecto | 94,1 % (≈100 %) | 82,0 % (≈100 %) | 77,1 % (≈100 %) | 57,7 % (≈94 %) |
  | bueno | 83,9 % (≈100 %) | 68,8 % (≈100 %) | 57,2 % (≈92 %) | 39,2 % (≈2 %) |
  | medio | 74,2 % (≈100 %) | 53,0 % (≈73 %) | 40,1 % (≈2 %) | 23,7 % (≈0 %) |
  | novato | 46,8 % (≈26 %) | 33,9 % (≈0 %) | 18,5 % (≈0 %) | 12,0 % (≈0 %) |

  Escalera limpia en las dos direcciones. El novato en Fácil gana más o menos 1 partido de cada 4 y el medio en Normal casi 3 de cada 4.
- **Consola**: `tools/console.sh all 1280 720` y `TOUCH=1 tools/console.sh all 844 390` → las 19 escenas sin errores JS ni de WebGL.
- **Partidas reales**:
  - `node tools/drive.js` (teclado): menú con demo, tutorial/jugar, saque en dos pulsaciones, puntos, toques del humano y pausa.
  - `node tools/touchplay.js` (multitáctil real con `Input.dispatchTouchEvent`): joystick, GOLPEAR, SALTAR, ⇄, pausa/ajustes, «Gira el
    móvil» en vertical y salida al menú.
  - `node tools/padplay.js` (mando falso de mapeo estándar): vibración, glifos, Start/B/Select, y desconexión → pausa «Mando desconectado»
    → reconexión.
  - Las tres → «TODO OK».
- **Rendimiento** (`node tools/perf.js`, móvil emulado: CPU ×4, dpr 2,75, táctil, partido en vivo 20 s por nivel; CPU del PC al 49-56 %,
  medida válida; «objetivos cumplidos» en los dos tamaños):

  | tamaño | nivel | fps | p5 fps | draw calls | triángulos | pixelRatio | sombra |
  |---|---|---|---|---|---|---|---|
  | 844×390 | auto (→ media) | 89,9 | 81,3 | 46 | 196 k | 1,25 | 1024 |
  | 844×390 | alta | 87,6 | 54,9 | 46 | 1,14 M | 1,5 | 2048 |
  | 844×390 | media | 88,1 | 55,2 | 46 | 200 k | 1,25 | 1024 |
  | 844×390 | baja | 91,4 | 55,2 | 34 | 81 k | 1 | 512 |
  | 667×375 | alta | 90,9 | 54,9 | 46 | 1,12 M | 1,5 | 2048 |
  | 667×375 | media | 93,1 | 55,2 | 46 | 198 k | 1,25 | 1024 |
  | 667×375 | baja | 102,5 | 82,0 | 34 | 82 k | 1 | 512 |

  JS ~7 ms por frame, montón plano (~7-9 MB), ~50 recolecciones menores y 8 mayores en 20 s. En escritorio, a 1280×720 en alta, las
  escenas en juego van a 164-165 fps (tope del headless).
- **Audio** (`node tools/audiotest.js` → «TODO OK»):
  - Mezcla: 37 de 37 escenarios dentro de su objetivo LUFS ±1,5. Hay 2 filas informativas (cama de público con saque local −1,1 y
    peloteo largo en punto de set +2,3, que sube a propósito).
  - Partido de 60 s renderizado en Chrome: −18,6 LUFS integrados, pico real −3,7 dBTP (−2,3 en el clímax), 0 muestras recortadas,
    balance L-R 0,15 LU, máximo 8 voces y 0 fuentes descartadas. El silbato queda ≥ 14,2 dB sobre la grada en su banda.
  - Robustez: 5 de 5.
- **Capturas** en `tools/out/final2/1280/` (alta) y `tools/out/final2/844/` (táctil, baja): menú, saque, peloteo, remate, bloqueo,
  punto, final y tutorial. Todas miradas: escena 3D completa, HUD, controles táctiles, guía de toques y textos en castellano bien.
  En baja el público y las vallas se simplifican, pero se ve bien.
- **Restricciones de Artifact**:
  - En estático: `index.html` empieza por `<title>Voley 3D</title>`, sin doctype/html/head/body ni `type="module"`. Lleva 10 scripts
    clásicos más three.js 0.149.0 de cdnjs, y Google Fonts. Sin alert/confirm/prompt/print/fetch/XHR, sin import/export.
    `localStorage` solo dentro de try/catch (6 sitios). `node --check` de todos los `js/*.js` y `tools/*.js` sin errores.
    `sim.js`/`ai.js` sin DOM ni THREE.
  - En ejecución por `file://` (menú y partido en vivo): los únicos orígenes pedidos son `cdnjs.cloudflare.com` y `fonts.googleapis.com`.
    Antes de un gesto no hay AudioContext (`VB.Audio.contextState()` = `'none'`).

### Solo lo puede comprobar una persona con un dispositivo real

1. **Rendimiento y temperatura en un móvil de verdad.** Un móvil medio en horizontal, unos 10 minutos: fluidez, si la calidad automática
   baja y se queda estable, y si calienta. El PC emula la CPU, pero no la GPU ni la tasa de relleno de un móvil.
2. **Táctil con los dedos.** Tamaño y alcance de joystick y botones, pulgares que tapan el balón, y las zonas seguras de muesca y barra
   de gestos en iPhone y Android.
3. **Mando físico.** Uno estándar (Xbox o PlayStation) y, si hay, uno no estándar (el mapeo es heurístico). Hay que comprobar la
   vibración y la deriva del stick.
4. **Escuchar el audio** con auriculares y con el altavoz del móvil. Incluye `scuff`/`slide`, que tras quitarles el DC solo se han medido.
5. **Sensación de juego y dificultad** con personas reales. La matriz sale de bots: hay que comprobar si Fácil es fácil para alguien
   que nunca ha jugado y si el tiempo de golpeo se siente justo.
6. **Decisión de Ferran como árbitro.** Faltan los textos propuestos en `notes/sim.md` §R5.5 («Ataque sobre el saque», «Retraso en el
   saque (8 s)», «Doble contacto»). Si se aceptan, hay que cambiarlos a la vez en sim.js, `POINT_TEXTS` de simtest, `REASON` de
   arena.js y el tutorial de ui.js.
7. **Publicarlo como Artifact** y abrirlo en claude.ai (escritorio y móvil). Cumple las restricciones, pero no se ha publicado.

### Deuda técnica conocida (no bloquea)

- Basura por frame ~1,9-2,1 MB/s, sobre todo three.js en el render. El montón está plano.
- Deprecaciones de mapa en los objetos de evento de sim (unos 40-80 por punto); se dejan como están.
- Por emulación, el p5 de alta y media se queda en ~55 fps (ft95 ~18 ms): es el ritmo de frames del headless, no tirones (≤ 3 frames
  de > 33 ms en 20 s).

## Cómo seguir en casa

1. `git clone https://github.com/purupurpito/voley-3d.git && cd voley-3d`
2. Abrir Claude Code en esa carpeta y decir: "sigue con el TRASPASO.md".
3. Claude debe relanzar desde la fase pendiente. La reanudación automática del flujo no sirve entre
   PCs, así que: copiar `tools/workflow/voley-3d.workflow.js`, quitar las fases ya hechas (Foundation
   y, si el commit dice Build completo, Build) dejando que `integrate('build', ...)` reciba como
   informes el contenido de `notes/*.md`, y lanzarlo con la herramienta Workflow.
4. Ajustar en el guion la constante `DIR` a la ruta de casa.
5. **Capturas con la gráfica**: en este PC (sin GPU) se usaba SwiftShader y saturaba la CPU.
   En casa, en `tools/shot.sh` y `tools/console.sh`, cambiar
   `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` por
   `--use-gl=angle --use-angle=vulkan` (o `--use-angle=gl`; en Windows `--use-angle=d3d11`) y
   comprobar con una captura que sale la escena 3D. Ajustar también la ruta de Chrome si no es
   `/usr/bin/google-chrome`.

## Pruebas

- `node tools/simtest.js` — simulación CPU contra CPU + jugador con teclas al azar. Debe acabar sin errores.
- `node tools/perf.js`, `touchplay.js`, `padplay.js`, `touchtest.js`, `padtest.js`, `courttest.js`, `audiotest.js`, `drive.js` — ver CONTRACT.md §6.
- `tools/shot.sh <escena> <ancho> <alto> <salida.png>` — captura. Escenas: `?debug=menu|serve|rally|spike|block|point|switch|mobile|end` (ver `CONTRACT.md`).
- `tools/console.sh` — errores de consola.
- `tools/out/` no se sube (capturas y logs); se regenera.

## Restricciones (se publicará como Artifact de claude.ai)

- `index.html` sin `<!doctype>`, `<html>`, `<head>` ni `<body>`; empieza por `<title>Voley 3D</title>`.
- Scripts clásicos con `window.VB`, sin módulos ES. Three.js r149 de cdnjs, versión fijada.
- Sin red en ejecución salvo Three.js y Google Fonts; texturas procedurales.
- Sin `alert/confirm/prompt/print`; `localStorage` solo con try/catch; audio tras gesto del usuario.

## Visión (lo que pidió Ferran)

"Lo mejor que hayan visto mis ojos", como si se fuera a vender al acabar. Cámara detrás del
jugador que controlas, que se desliza suave al cambiar de jugador. Controles relativos a la
cámara. Teclado, mando y táctil (móvil en horizontal). Reglas y vocabulario correctos: Ferran es
árbitro de la FCVB. Arte original, sin imitar juegos existentes.

## Cuentas

Repo privado en **purupurpito** (cuenta personal). En el PC del trabajo la cuenta habitual es
`fsanchis-tlg`; purupurpito se conectó solo para crear y subir este repo.

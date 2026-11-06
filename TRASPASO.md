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

## Estado (6-nov-2026, tras Final QA, PC de casa con RTX 3060 Ti)

Todas las fases del guion están hechas: Foundation, Build (los 6 especialistas, incluida la pasada
corta de cierre de `players`, `arena`, `camera_input` y `ui_main`), Integrate, Review 1 y Review 2,
cada una con su integración, y Final QA. El detalle de cada fase está en `notes/informes-build.md` y en el log
de cada `notes/<owner>.md`. Las capturas usan la GPU real (ANGLE D3D11, ~160 fps en headless); con
`GL=swiftshader` vuelven al modo software.

**Comprobado en Final QA (ejecutado, no supuesto):**
- `node tools/simtest.js` completo (con la matriz de dificultad) → "TODO OK", sale con 0. Incluye las
  comprobaciones de reglas: 4 toques, dobles, bloqueo sin toque, sets a 25 y 15 con 2 de diferencia,
  red, antena, por debajo de la red, 8 s, bloqueo del saque, cambio de campo y los 4 niveles.
- `node --check` de todos los `js/*.js` y `tools/*.js` → sin errores.
- `tools/console.sh all` a 1280×720 y `TOUCH=1 tools/console.sh all 844 390` → las 19 escenas sin errores JS.
- `node tools/drive.js 1280 720 40` y `node tools/drive.js 844 390 25` → "TODO OK". Prueban, con el teclado real:
  menú con la demo, elección tutorial/jugar, saque en dos pulsaciones, puntos jugados, toques del humano y pausa/reanudar.
- Capturas en `tools/out/final/1280/` y `tools/out/final/844/` (menú, saque, peloteo, remate, bloqueo,
  punto, ace, punto de set, final, tutorial, saque en salto, plancha, cambio). Todas miradas: la escena 3D
  completa, el HUD y los textos en castellano están bien.
- Restricciones de Artifact: `index.html` empieza por `<title>Voley 3D</title>`, sin doctype/html/head/body
  ni módulos; en ejecución por `file://` solo se pide three.js 0.149.0 de cdnjs y Google Fonts
  (`performance.getEntriesByType('resource')`). Sin alert/confirm/prompt/print, y `localStorage` siempre
  dentro de try/catch.
- Coste de render en `rally` a 1280×720: alta 78 draw calls / 1,17 M triángulos (pixelRatio 2), media 71 / 0,56 M
  (1,5), baja 51 / 0,34 M (1).

**Sin comprobar o pendiente:**
- Rendimiento en un móvil real: solo se ha medido en el PC con GPU. Falta comprobar que llega a 60 fps
  y que la calidad adaptativa baja bien en un móvil medio.
- Mando físico y táctil real: solo se ha probado el táctil emulado (DevTools) y la lógica del mando en código.
- Audio: está verificado con un arnés en node y sin errores en la página, pero nadie lo ha escuchado en esta pasada.
- El equilibrio de dificultad sale de bots (notes/informes-build.md §sim): falta probarlo con jugadores reales.
- Detalles visuales menores: la etiqueta "TOQUES" se lee poco sobre el público. La escena `dive` congela con el
  balón cerca de la cámara y no se ve bien al jugador que se tira.
- Opcional, de sim: `Sim.aimPoint`, antena tocada sin cruzar, texto de sim para 'out'. Opcional, de
  cámara/arena: plano de transición durante `courtChange`.
- Publicación como Artifact: todavía no se ha publicado (se ha comprobado que cumple las restricciones).

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

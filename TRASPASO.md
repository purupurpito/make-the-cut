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
2. **Build** — 6 especialistas en paralelo, cada uno dueño de sus ficheros:
   - `sim` → `js/sim.js`, `js/ai.js`, `tools/simtest.js` (reglas, calidad de golpe, saques, dificultad)
   - `players` → `js/players.js` (atletas y animación procedural)
   - `arena` → `js/arena.js`, `js/fx.js` (pabellón, luces, público, red, balón, efectos)
   - `camera_input` → `js/camera.js`, `js/input.js` (cámara 3ª persona, teclado, mando, táctil)
   - `audio` → `js/audio.js` (sonido procedural) ✅ terminado
   - `ui_main` → `index.html`, `js/ui.js`, `js/main.js`, `tools/shot.sh`, `tools/console.sh`, `tools/drive.js`, `tools/eval.js`
   Lo que uno necesita en ficheros ajenos lo deja en `notes/<owner>.md`.
3. **Integrate** — aplicar `notes/*.md`, hacer que todo funcione junto, probar todo. ⏳ PENDIENTE
4. **Review ×2** — 5 críticos (visual, jugabilidad+reglas, cámara, técnico, primer jugador) +
   arregladores por propietario + integración. ⏳ PENDIENTE
5. **Final QA** ⏳ PENDIENTE

## Estado al parar (6-nov-2026, 12:25, PC del trabajo)

Flujo parado a mano por Ferran a mitad de **Build**:

- ✅ Terminados con informe: `foundation`, `audio`, `sim`. Sus informes completos (qué hicieron,
  qué verificaron, qué piden a otros ficheros, problemas conocidos) están en `notes/informes-build.md`.
- ⚠️ Interrumpidos sin informe final: `players`, `arena`, `camera_input`, `ui_main`. Su trabajo está
  en disco tal como lo dejaron (llevaban 45-60 min iterando), pero sin su verificación final.
  Lo que pidieron a otros está en `notes/<owner>.md`.
- Comprobado al parar: `node tools/simtest.js` → "TODO OK"; `tools/console.sh rally` → sin errores JS;
  la escena `rally` se ve en 3D completa (pabellón, público, cámara detrás, HUD).
- Detalle visto en la captura: el destello de impacto del golpe sale demasiado blanco y grande (fx.js).

**Siguiente paso en casa:** antes de integrar, dar a `players`, `arena`, `camera_input` y `ui_main`
una pasada corta de "termina y verifica lo tuyo" (cada uno con sus ficheros), y después seguir
con Integrate → Review ×2 → Final QA tal como está en el guion.

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

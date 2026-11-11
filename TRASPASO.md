# TRASPASO — Make the Cut (antes «Voley 3D»)
n> **Siguientes tareas y decisiones de Ferran (11-nov-2026): ver SIGUIENTE.md** (lotes A/B/C para trabajar en paralelo).

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
- **Equilibrio** (matriz de simtest: bots con modelo de jugador en 3ª persona; % de puntos del humano, P(partido) estimada):

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

### Pulido ola 1 + arreglos (8-nov-2026, PC de casa)

Detalle por owner en `notes/<owner>.md` (secciones «Pulido ola 1/2» y sus logs «Aplicado»). Lo más visible:
- **Audio**: la síntesis del banco va en un Worker creado desde el propio audio.js (Blob, sin ficheros); sin Worker, cola troceada con
  primera pasada de una variante por sonido de juego. Móvil ×4 con JUGAR inmediato: 0 sonidos perdidos (antes ~27 en 20 s).
- **Cámara/jugadores**: plano de héroe que esquiva marcador, postes, balón y rivales; el que anota sigue de cara a la cámara hasta el saque;
  el marcador se atenúa si el héroe queda a la izquierda; temblor del bote también tras bloqueo; colocación con los dos pies plantados.
- **UI**: en táctil los dos saques van en el aviso junto al sacador (la red queda libre); cintas grandes como mucho 1 de cada 3 puntos;
  reglas con «Falta de saque: 8 segundos» y «Ataque sobre el saque»; `node tools/clean.js` cierra Chrome huérfanos de las pruebas.
- **Arena**: vomitorios de verdad en las gradas laterales (antes, rectángulos negros).
- **Sim**: la CPU ya no deja caer su propio lanzamiento de saque (~0,2 % de los saques, sobre todo en Fácil de primer partido).
- Verificado en la integración: simtest completo + barrido de semillas 1-25 (10 y 20 min) TODO OK; console.sh (19 escenas, 1280 y 844 táctil)
  sin errores; drive/touchplay/padplay/audiotest/camtest TODO OK; perf 844×390 ×4: ~141-145 fps en todos los niveles, baja 34-38 draw calls y
  87 k triángulos, media 194-197 k; escritorio alta 165 fps.

### Pulido ola 2, segunda tanda (8-nov-2026, PC de casa)

Detalle por owner en `notes/<owner>.md` («Pulido ola 2» y el log «Aplicado … segunda tanda»). Lo más visible:
- **Sim (SIM-04)**: el sacador de la CPU bota el balón 1-3 veces antes de lanzar, con un estilo propio por jugador (uno más en punto de set/partido).
  Evento `dribble`. Desplaza los resultados de cada semilla (documentado); `createGame({ritual:false})` = flujo anterior. `VB.HOLD.set` 3,4 → 4,0 s.
- **Jugadores (PLY-08…15)**: giros con muelle y pies plantados, aterrizaje con flexión, split-step del receptor, carrera de ataque de tres pasos,
  piernas en el aire, colocación con tiempos, 16 celebraciones sin repetir y victoria con choque de pecho / rodillas al suelo del que pierde.
- **Arena (ARN-08…13)**: la luz puntúa (tensión en punto de set/partido, contraluz del color del que anota, barrido en la victoria), cubierta
  procedural, tarima a dos tonos, manchas de contacto bajo cada atleta, halo de las vallas, confeti dentro del plano, «Destellos suaves».
- **Cámara (CAM-08…14)**: sigue el balón tras nuestro ataque; cierre de set/partido con cámara lenta y órbita de los ganadores; hoja final acoplada
  sin tapar a nadie; ultrapanorámico sin perder el balón; plano corto del sacador rival botando antes de su saque; grúa de presentación.
- **UI (UI-09…16)**: sello PERFECTO/BIEN junto al contacto, chip «PELOTEO · N», indicador de borde, cortinilla de marca, tarjeta de presentación,
  hoja final con MVP, Ajustes > Accesibilidad (cámara estable, vibración, tamaño del HUD, destellos suaves).
- **Audio (AUD-05…07)**: choque, puños, pecho, palmada y botes del ritual con sonido propio; cortinilla y firma de presentación; la grada reacciona
  en proporción a lo grande que ha sido el punto.
- **Integración**: rótulo del set/partido arriba en la órbita del cierre (en el móvil tapaba las cabezas); indicador de borde fuera de los planos
  cinematográficos y sin saltar con las piernas cortadas a propósito; la tarjeta de presentación ya no se pierde si el partido empieza antes de acabar
  el ensayo de estilos; CONTRACT al día.
- Verificado en la integración: simtest completo + barrido 1-25 × (10 y 20 min): 51/51 TODO OK; console.sh 19 escenas (1280 y 844 táctil) sin
  errores; drive, touchplay, padplay, audiotest, courttest (set 1280 y 844 táctil) TODO OK; camtest verde salvo los parciales conocidos (CAM-11, CAM-13
  en 844); perf 844×390 ×4 (PC libre): auto/media 131-133 fps, alta 139, baja 143 (33/41 draw calls, 90/119 k triángulos); escritorio alta 165 fps.
- Pendiente (ola 3): PLY-16 (mano que empuja el balón en el ritual, `fx:catch`), CAM-11/CAM-13 en móvil, ARN-09 (franja alta del plano de punto),
  SIM-05 (banda de la matriz «novato vs Fácil»), texto «Balón a la red» junto a «¡ACE!» cuando la recepción rival va a la red.

### Arreglos tras la verificación de la ola 2 (8-nov-2026 noche, PC de casa)

Detalle en `notes/<owner>.md` («Arreglos tras la verificación de la ola 2» y el log «Aplicado … arreglos tras la verificación»).
- **Arranque (UI-07/UI-01)**: logotipo entero en el primer frame (fuente embebida «VB Marca»), menú pulsable a ~2,3-2,6 s, relevo en dos tiempos;
  sin tirón al empezar el partido (la tarjeta de presentación entra en el ensayo de estilos).
- **Cierre de set/partido (CAM-09)**: la cámara lenta siempre tiene un atleta en cuadro; la órbita del partido filma a los ganadores de frente
  (integración: players los abre hacia la cámara tras el choque de pecho; «los dos de frente» 1 % → 51-58 % del plano); manos nunca bajo el rótulo.
- **Cámara (CAM-11)**: el balón desviado que se va fuera ya no se pierde por detrás de la cámara. camtest con puertas estrictas e informativas.
- **Arena (ARN-01/08/12)**: tarima algo más luminosa, baja con ≤ 35 draw calls de pico (mallas fusionadas), marcadores del pabellón atenuados bajo el HUD del móvil.
- **Sim (SIM-04/05)**: la demo del menú vuelve a su ritmo (1 bote), bandas de la matriz estadísticas (simtest sin falsos fallos).
- **UI**: hoja final del móvil con MVP completo, texto del ace con la recepción a la red («La recepción de la CPU va a la red»), indicador de borde sin cruzar la pantalla.
- Verificado en la integración: simtest completo + barrido 1-25 × (10 y 20 min) 51/51 TODO OK; console.sh 19 escenas (1280 y 844 táctil) sin errores;
  drive, touchplay, padplay, audiotest, camtest TODO OK; perf 844×390 ×4: auto/media 130 fps, alta 139, baja 152 (30/36 draw calls, 89 k tri), media 199 k tri;
  escritorio alta 164 fps.

### Pulido ola 3 (9-nov-2026, PC de casa)

Detalle por owner en `notes/<owner>.md` («Pulido ola 3» y el log «Aplicado … ola 3»). Lo más visible:
- **Sim (SIM-05)**: `highlight` calibrado (CPU vs CPU ~20 % de puntos grandes, < 5 % «enormes» fuera de punto de set); `point.clutch` (final apretado); simtest con
  calibración en 20 partidos completos y prueba de determinismo.
- **Jugadores (PLY-16…21)**: caras de una superficie con ojos y expresiones (grito, esfuerzo, alegría, abatimiento, parpadeo), coleta con muelle, mano del ritual de
  saque de la CPU sobre el balón (`fx:catch`), gesto de «¡mía!» (`fx:call`), piernas algo más largas.
- **Arena (ARN-14…16)**: banquillos con suplentes y entrenador que reaccionan, fotógrafos, cámara de TV, barandilla de vidrio, tribuna de prensa, silla del árbitro y mesa
  del anotador rehechas (con acta electrónica). Sin dibujos nuevos.
- **Cámara (CAM-15…20)**: saque propio por encima del hombro sin oficiales cortados, realización del menú con 6 planos, presentación que acaba en el saque sin corte,
  plano de red en el bloqueo, punto sin balón gigante en el borde, marcador colgado nunca cortado; camtest con autoprueba de roturas.
- **Audio (AUD-08/09)**: tics de la cuenta de la hoja final, «clac», revelación del MVP, sonidos propios de flechas y Ajustes; pasada de mezcla (70 escenarios).
- **UI (UI-17…23)**: respuesta personal con medidor pronto/tarde, textos revisados, contraste y tamaños, aviso que nunca pisa un botón táctil, Ajustes agrupados,
  glifos PlayStation, tanteo hablado (`aria-live`).
- **Integración**: cinta grande = `highlight ≥ 0,55` (+ ace, bloqueo, punto de set salvado; ~23 % de los puntos) con «Final apretado»; sonidos de AUD-08 cableados;
  tutorial del móvil compacto con la navegación pegada abajo (los botones quedaban tapados); escenas `debug=` sin el fondo del telón tapando el pabellón hasta 7,6 s;
  cola de audio sin Worker con `set`/`feet` al principio. CONTRACT al día.
- Verificado en la integración: simtest completo + barrido 1-25 × (10 y 20 min) 51/51 TODO OK; console.sh 19 escenas (1280 y 844 táctil) sin errores; drive, touchplay,
  padplay (estándar y DualSense), audiotest, camtest TODO OK; perf 844×390 ×4: auto/media 87-88 fps, alta 85, baja 93 (31/34 draw calls, 112 k tri), media 251 k tri;
  667×375: media 95, baja 92. Escritorio alta 127 fps = tope de rAF del headless en este momento (128 Hz medido con la escena en pausa; antes era 165).
- Pendiente: ARN-09 (franja alta del plano de punto), CAM-11/CAM-13 en móvil, PLY-01/03 (criterio con radio de balón 0,105), plano del banquillo ganador (idea).

### Arreglos tras la verificación de la ola 3 (9-nov-2026, PC de casa)

- **Sim**: la IA ya no comete dobles ni 4 toques (venían del balón que da en el cuerpo); simtest falla si vuelve a pasar. Pausa del set 4,0 s documentada (SIM-03 cerrado).
- **UI**: «¡GANAS EL PARTIDO!» ya no tapa el marcador en ningún tamaño; chip «JUGADA · N» que se funde en la celebración; pestaña del marcador del móvil sin hueco
  blanco; pastillas de ayuda que se apagan con el balón detrás; perfiles `vb3c-*` huérfanos barridos.
- **Cámara**: corte punto → saque del móvil sin tirón (candidatos repartidos y precalculados); juez de línea fuera del saque flotante en el móvil; plano final con
  el marcador y las pantallas siempre fuera por arriba; giro acumulado de la red de seguridad de oficiales arreglado.
- **Jugadores**: `debug=point|ace` muestran la celebración en movimiento (cuadro vivo); empujón visible de la mano en el bote del ritual de la CPU.
- **Arena**: grada lateral menos saturada en alta (ARN-02); el 1r árbitro señala «fuera» en la falta de antena.
- **Integración**: tallas de letra del videomarcador creadas bajo el telón (el primer punto del partido en el móvil bajaba de 155-163 ms de frame a 89-118 ms) y
  todas las caras de Google Fonts pedidas al cargar (el primer aviso de los 8 s ya no fuerza una maquetación completa: 55-82 → 49-52 ms).
- Verificado: simtest completo + barrido 50/50 TODO OK; console.sh 19 escenas × 2 tamaños sin errores; drive, touchplay, padplay (estándar y DualSense) y audiotest
  TODO OK; perf 844×390 dpr 2,75 ×4: auto→media 109,8 fps, alta 101,3, media 100,8 (250 k tri), baja 103,8 (112 k tri, 31/34 draw calls), heap 9 → 10-11 MB;
  escritorio alta 127 fps a 1280×720 y 1920×1080 = tope de rAF del headless (128,7/s medido en una página vacía).
- Pendiente: ARN-09, CAM-10 (sin su medida), CAM-11/CAM-13 en móvil, juez cercano ~0,5 s en el saque en salto del móvil, el marcador colgado puede cortarse por arriba en
  la grúa del saque en salto del móvil, cinta de set/partido a 667×375 bajo el marcador (sobre la grada).

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
6. ~~Decisión de Ferran como árbitro~~: DECIDIDO (7-nov-2026). «Ataque sobre el saque» aplicado; «Dobles» y «Falta de saque: 8 segundos» se quedan.
7. **Publicarlo como Artifact** y abrirlo en claude.ai (escritorio y móvil). Cumple las restricciones, pero no se ha publicado.

### Deuda técnica conocida (no bloquea)

- Basura por frame ~1,9-2,1 MB/s, sobre todo three.js en el render. El montón está plano.
- Deprecaciones de mapa en los objetos de evento de sim (unos 40-80 por punto); se dejan como están.
- Por emulación, el p5 de alta y media se queda en ~55 fps (ft95 ~18 ms): es el ritmo de frames del headless, no tirones (≤ 3 frames
  de > 33 ms en 20 s).

## Backlog por sprints (pedido por Ferran)

Desde el 9-nov-2026 el proyecto va por **sprints**, para controlar el gasto de tokens. Ferran abre un sprint
(«ponte a hacer los to-do») y se trabaja el backlog hasta donde se llegue. Dentro del sprint se pueden encadenar flujos largos.
Entre sprints no se empieza nada: solo se apunta aquí. Lo de abajo está apuntado, NO empezado.

### Preguntas abiertas para Ferran (11-nov-2026)
- **Circuito Mundial**: los clubes de élite (media ≥ 80, IA Experto) no los gana nadie. ¿Reto final o se suaviza (`DIFF_AT`, career.js)?
- **«Cerrar sesión»**: hoy no borra el progreso local del dispositivo (si se comparte el móvil, el siguiente ve tu progreso). ¿Debe borrarlo?
- **Tope de dibujos del 6v6**: perf.js acepta ≤ 45 en baja (37/39 medido el 11-nov; en media 60/63). ¿Se queda así o se baja a 33 como el 2v2?
- **Repo de redirección**: la URL antigua de Pages (/voley-3d/) da 404. ¿Se crea la redirección en el repo `purupurpito.github.io`?

### To-do
- **Pendiente del muñeco y la Carrera de playa** (11-nov-2026, tras las revisiones; nada roto). Fusionado en main y publicado
  el 11-nov-2026 (9a4f10c).
  - ~~Oficiales y público sin muñeco~~ HECHO 11-nov (arena; notes/arena.md «Muñeco oficial») (~~cabezas que se cruzan en el ace~~ HECHO 11-nov): ver «Mapa de playa» abajo.
  - ~~Compañero en lo alto de la horquilla (+4/+5) y Regional al 99-100 %~~ HECHO 11-nov (carrera): techo del compañero en el partido
    (`MATE_CAP`: media + racha ≤ club + 6) y escalón «Normal suave»: Regional con el bot medio 80 %, novato 41 % (notes/carrera.md
    §Escalón). `rookie` ya integrado en main.js (11-nov).
  - ~~Palmarés migrado de v2 con el nombre antiguo de la competición~~ HECHO 11-nov (carrera): pasa al de playa (`beachTrophies`).
  - Equipación del rival en la playa: si se parece a la tuya, la CPU sale de azul (con 8 camisetas por liga pasa a menudo); idea: segunda
    equipación del club en `setKit`.
  - Sin comprobar: partido de Carrera completo a 844×390 y 667×375, cambio de campo cada 5 en un 3r set jugado, mando y táctil reales.
  - `tools/touchplay.js` y `tools/padplay.js` fallan a veces («al menos 3 toques humanos con GOLPEAR»): intermitente desde antes; repetir.
  - Tras la integración del 11-nov (backlog 2): grúa del cambio de campo en la playa sin probar (`tools/courttest.js` no admite
    `map=beach`); camera.js `boardBoxes()` podría leer `VB.Arena.landmarks.scoreBoard` (la caja de la torre de playa es algo mayor);
    6v6 en media a 334 k de 350 k; colocación en salto, bloqueo y cuenta atrás de 5 s sin probar con mando y táctil reales;
    campo rival pequeño en el saque del móvil (camera.js `serveUsComp`/`svcSolve`, ver notes/camera_input.md).
- **Pendiente de la integración de menús v2** (10-nov-2026):
  - ~~Recepción y Colocación aún se notan poco en el resultado (bot medio ±1-2 puntos; Defensa y Control ya ±3-6): que la calidad del
    pase cuente en el remate del compañero IA (ai.js). Reacción del humano solo afecta a levantarse.~~ **HECHO 11-nov** (sim: la calidad del pase pasa a la colocación de la IA y la de la colocación al remate de la IA o a una bola de seguridad; `VB.SETQ`, notes/sim.md §Calidad que se arrastra).
  - ~~Escalón Regional → Nacional~~ HECHO 11-nov (carrera): Normal suave (Normal + rookie) en los mejores de la Regional y los peores
    de la Nacional; Difícil desde 56 (notes/carrera.md §Escalón).
  - ~~Carrera: rol prometido sin efecto, sueldo solo texto, firmar en mitad de temporada sin confirmación~~ HECHO 11-nov (carrera):
    banquillo en rotación, promesa de titular incumplida con salida libre, indiscutible con suelo de confianza, sueldo que se ahorra
    y paga el fisio, confirmación al fichar a mitad de temporada. Sigue: química de suplentes que se pierde en verano.
  - ~~Escuadrón a media 50: cada mejora cuesta ya 2 puntos (antes 1 hasta 50); valorar abaratar `cost()`.~~ HECHO 11-nov (integración: `cost()` 1/2/3/4 con cortes en 60/70/85; careertest y simtest OK).
  - ~~Hoja final: «Menú principal» vuelve al principal (cambiar dificultad/puntos son 2 pasos más); ¿botón «Cambiar opciones»?~~ HECHO 11-nov
    (ui.js `goOptions`: botón «Cambiar opciones» que lleva a la preparación del Partido rápido; no en Carrera ni en el 6v6 espectador).
  - ~~Primera visita en móvil: aviso de instalar (`js/install.js`) + panel «Primer partido» seguidos: decidir.~~ HECHO 11-nov: el aviso
    espera a la portada del menú libre 1,5 s (`VB.UI.menuIdle`); si se va a jugar antes, sale al volver del partido. Nunca a la vez.
  - Siguen los dorsales «N.º 1 / N.º 2» en Jugadores (son dorsales, no ordinales de menú): decidir con Ferran.
  - Sin probar a mano: mando y táctil reales en las páginas nuevas y en la Carrera.
- **Carrera en 6v6** (prioridad de Ferran, 9-nov-2026: «luego adaptarlo al 6v6 no debería ser tan difícil»): la Carrera 2v2 ya está
  hecha (ver Hecho). Falta llevarla al 6v6 cuando exista (posiciones, plantilla del club en vez de un compañero, VNL / Olimpiadas
  como competiciones de arriba). Plan en el §3 de `notes/diseno-6v6-carrera.md`.
- **Pendiente del sprint Carrera 2v2** (10-nov-2026, de los revisores; nada roto):
  - **Circuito Mundial**: manda la habilidad, no los atributos (bot medio 0 de 20 con media 35, 60 y 85; bot bueno 15/25/45 %), y
    los 1-2 clubes de élite (IA Experto, media 80-84) no los gana nadie (0 de 8 con media 85). ¿Subir el umbral de Experto
    (`DIFF_AT`, career.js) o dejarlo como reto final? Decisión de diseño de Ferran. (11-nov: sin tocar; sigue en pregunta.)
  - ~~**Diana del saque en el móvil**~~ HECHO 11-nov (camara-fx, fx.js): diana visible a través del compañero y el balón, guías a lo
    largo y ancho del campo rival, aro y disco más grandes en pantalla pequeña (notes/camera_input.md §Diana). La cámara del saque no
    cambia (subirla cortaba al sacador; ver la nota).
  - **Muro casi imposible en Carrera con control «uno»**: el bot de simtest no salta nunca a bloquear en ese modo (0 saltos en 6
    partidos; con «Los dos», 188). Sospecha de fallo del bot, no del juego: probar a mano.
  - Sin volver a medir con la tanda larga de los revisores (`tools/out/carrera/verif/career_balance.js`, `badge_matrix.js`): los
    umbrales nuevos de las insignias (calculados con sus ritmos), Líder subido y Motor a la mitad.
  - La nota del bot «bueno» en la Regional sale alta (media 9,1, máx. 9,7; ningún 10). Con «Los dos» la nota cuenta a la pareja
    (remates ×0,85): sin medir.
  - ~~A 667×375 la hoja final de Carrera necesita scroll para llegar a «Menú principal»~~ HECHO 11-nov (carrera): CSS `#end.career`
    en career-ui.js; main.js ya pone la clase `career` en `#end` (integración 11-nov; alto mínimo para que «Ver celebración» no pise las estadísticas).
  - Recargar a mitad de partido o «Reiniciar partido» evita una derrota sin penalización (¿diseño?).
  - Sin probar a mano: mando, teclado y móvil reales en la Carrera, una temporada entera jugada, la copa jugada y el control «Los dos».
- **Mapa de playa** (pedido de Ferran, 9-nov-2026): **escenario HECHO el 10-nov-2026** (sede «Platja Llarga», Ajustes · Imagen ·
  Escenario, `?map=beach`; detalle en `notes/arena.md` §Playa). Pendiente:
  - ~~Modo reglas de playa~~ **HECHO 10-nov-2026 en la sim y el menú** (`createGame({venue:'beach'})`, CONTRACT §4.2 «Vóley playa»,
    `notes/sim.md` §Vóley playa): pista 16×8 (`g.HL/g.HW`, `VB.Sim.court`), sets a 21 / 15, cambio de campo cada 7 (5 en el 3r, sin
    grúa: aviso «Cambio de campo · Cada 7 puntos»), bloqueo = toque, dejada de nudillos («pokey», legal; la de yema no se modela como
    gesto aparte), colocación de dedos más estricta (dobles), IA y cámara a la pista pequeña, tutorial y menú (fila «Escenario» junto a
    los puntos, que en la playa se fijan a «21 · 15»). ~~Cintas a 16×8, antenas, sin línea de ataque, texto y silbato de `'swap'`, Carrera
    que heredaba la playa~~ HECHO 10-nov (cierre TAJO + playa, ver Hecho; desde el 11-nov la Carrera es de vóley playa y el 6v6 se
    juega siempre en el pabellón). Pendientes: ~~regla de los 5 s del saque de playa (sigue la de 8 s)~~ (HECHO 11-nov en la sim: «Falta de saque: 5 segundos», `g.serveClockMax`; cuenta atrás y textos de ui.js integrados el 11-nov). Opcional: gesto del árbitro de 5 dedos (`'delay5'`, arena.js `refSignalStep`); hoy sale el de 8, ~~dibujo del tutorial a 16×8~~ (HECHO 11-nov, ui.js `beachFig`).
  - Idea para la Carrera (NO hecha): **torneos de playa** con cuadro (8 parejas, premios propios) además de la liga; la Carrera ya es
    toda de playa (circuitos a 21/15, ver Hecho).
  - ~~Jugadores descalzos / ropa de playa~~ HECHO (muñeco, ver Hecho). Pendiente de personajes (revisión visual del 11-nov):
    ~~**oficiales** (árbitros, jueces de línea, anotadores, fotógrafos, suplentes, entrenadores; arena.js) con la proporción del atleta
    antiguo: desentonan al lado del muñeco, sobre todo el juez de línea en primer plano en el saque de playa (pasarlos al muñeco o a
    una versión «oficial» del muñeco)~~ HECHO 11-nov (arena: muñeco oficial con el trazo del muñeco; notes/arena.md). ~~Cabezas que se meten una en otra en el ace de la playa, cara contra el suelo en la plancha,
    pose de celebración en la hoja final~~ HECHO 11-nov (camara-fx, players.js; notes/players.md §Celebraciones). ~~Público de playa cabezón con sombreros y grupos de aficionados por equipo~~ HECHO 11-nov (arena: muñeco de grada, peñas por tramos).
  - ~~Partículas de arena y huellas~~ HECHO 10-nov tarde (fx.js: arena que salta en plancha, caída, bote; huellas, surco y cráter que
    se apagan; `notes/arena.md` §Playa a mapa principal). Decidir: el polvo del pabellón nunca se veía (`dAlive++` comentado); arreglado
    pero sigue oculto en el pabellón para no cambiarlo. ¿Encenderlo?
  - Luz de tarde de la playa hecha (`?luz=tarde`, `VB.Arena.beachLight`); ~~falta la opción en Ajustes~~ HECHO 11-nov (Ajustes ◆ Imagen ◆ «Luz de playa: Día / Tarde», ajuste `beachLight`).
  - ~~Marcador en la playa: no hay videomarcadores ni marcador colgado (las vallas LED con mensajes tampoco). Un marcador de playa
    (torre pequeña con cifras) y la cámara del cambio de campo, que mira a `landmarks.scoreHung` (en la playa mira al cielo).~~ HECHO
    11-nov (arena: torre con pantalla tras nuestro fondo; en la playa `landmarks.scoreHung` apunta a ella; sin probar courttest en la playa).
  - ~~Piezas del pabellón que desentonan en la arena, banderas de canto, horizonte lateral vacío, baja a 140k~~ HECHO 10-nov tarde:
    silla del árbitro de madera con toldo, mesa de anotadores con caballetes y toldo, postes de aluminio con protección fina, red/cintas/
    oficiales a la medida de la pista de la partida (16×8), banderas con bolsa, telón de pueblo/pinar/cabo con faro, gaviotas, llaüts,
    ola que rompe, cintas coral y pinos (identidad propia frente a SetPoint). Baja: 109k triángulos, 31/33 dibujos (perf.js, partido real).
- **Pendiente del pulido 10-nov-2026** (controles PC, dorsales, separadores, pantallas grandes; menores, nada roto):
  - ~~A 2560 Ajustes y Jugadores ocupan casi todo el alto~~ (11-nov: con pestañas ya no; revisados Ajustes, Jugadores, Controles, Tutorial, Pausa,
    preparación y hoja final a 2560×1440, bien). ~~Carrera: cabecera pegada al borde y «Colocación25» pegado~~ HECHO 11-nov
    (integración, career-ui.js: aire arriba en pantallas grandes y `.prev` en auto-fill). La Carrera sigue ocupando solo el alto de su contenido.
  - El consejo de arriba se vuelve casi transparente (`.thru`) cuando la acción pasa por detrás: a 1280×720 en el saque se lee mal. Es
    deliberado; si molesta, subir el fondo de `#coach.thru`.
  - ~~Saque táctil: el aviso «SACAR Flotante / SALTAR Potente» pisa el balón del sacador a 667×375.~~ HECHO 11-nov (ui.js `collectObstacles`/`placePrompt`).
  - En el tutorial la tecla «ESPACIO» parece más pequeña que la «J» (mismo tamaño medido, 12,5 px; es la palabra larga en mayúsculas condensadas).
  - Portátil táctil con ratón: tras tocar la pantalla el clic deja de golpear (a propósito, para no contar doble) sin avisar.
  - Lanzar con clic izquierdo y pulsar el derecho no saca: es falta (como J y luego Espacio). El texto lo explica.
  - La ampliación usa CSS `zoom` (Firefox ≥ 126). Sin probar: ratón físico, Firefox, Safari, monitor con escalado de Windows, pestañas internas de la Carrera a 2560.
- **Modo 6v6** (9-nov-2026): llevar el juego de 2 contra 2 a 6 contra 6. Campo más grande (pista reglamentaria de 18×9 m
  con 6 por equipo), rotaciones y posiciones. Cambiar de jugador será poco habitual, así que el primer modo 6v6 será
  **controlando solo a un jugador** (ya existe: «Controlar ‹ un jugador ›», siempre el n.º 1). Se mantiene todo el motor de toques y reglas,
  que ya funciona bien. **Diseño hecho:** [`notes/diseno-6v6-carrera.md`](notes/diseno-6v6-carrera.md).
  **Sprint 1 hecho (10-nov-2026, «Sim a N jugadores»)**: sim/IA/cámara/atletas sin supuestos de 4 jugadores; 2v2 idéntico, comprobado con
  la huella `tools/fingerprint6.js` → `tools/fp-2v2.json` (150 partidas: puntos, eventos, posiciones finales exactas, nº de llamadas a
  `g.rng`; simtest la exige). `createGame({format:'6v6'})` y `?format=6v6` (NO en el menú) crean 6 por equipo (ids 0-5 / 16-21, dorsales
  1-6 / 7-12, alineación 5-1 S-OH-MB-OPP-OH-MB), `g.size`, `g.rot`/`g.lineup`, rotación al recuperar el saque, sacador `rot[t][0]`,
  colocación provisional en las zonas base y una IA de reserva genérica (`computeJobN`/`posN` en ai.js) que juega pero NO es vóley 6v6.
  API nueva en `VB.Sim`: `mates, nearestMate, mateBadge, zoneOf, zonePos, isFront, ZONE, rotate, serverOf, refreshTeams`; ganchos `VB.AI6`
  (`computeJob`, `pos`) ya despachados en `AI.computeJob`/`AI.pos` cuando `g.size !== 2`.
  - **Sim 6v6 (sprint 2, hecho, CPU contra CPU)**: `js/ai6.js` nuevo (`VB.AI6`, cargado tras ai.js en index.html y en simtest/huella).
    Líbero (`g.libero`, `g.roster`, `applyLibero` en cada `setupServe`: entra por el central zaguero salvo si saca; eventos `libero`),
    evento `rotation`, formaciones legales del saque (`AI6.placeServe`: el que saca en sus zonas, el que recibe en «W» con OH-OH-L y
    `legalize()` sin solapamientos), falta de posición CONTADA (`overlapCount`, `g.stats.overlap`; aún no se pita: no hay humano en 6v6),
    faltas de zaguero/líbero pitadas (`backAttack` con el mecanismo de `atkServe`, `backBlock` en `checkBlock`). IA: 1r toque por
    tiempo + puesto, 2º el colocador, 3r el atacante elegido (`g.setPlan`); recepción al punto de colocación (`passTarget`), colocador
    con bola alta a punta, tensa al opuesto o rápida al central en sistema (`chooseSet`); bloqueo de zona con doble del central, defensa
    perímetro, carrera de batida y cobertura. Afinado solo-6v6: `VB.SIX {stuff 0.6, dig 0.75}`, `FORM.blockErr 1.8`, `sysDig/oosDig`,
    lectura del 2º bloqueador en `openSpot` (solo con `g.rot`). simtest «6v6 CPU contra CPU» (16 semillas × 15 min) exige los objetivos
    del diseño: side-out ~60 %, mediana ~7 s, 0 faltas de posición/zaguero, líbero nunca delante ni sacando, colocador ~85 % de 2.os toques.
  - **Pendiente sim 6v6**: humano en 6v6 (sprint 3: hoy la IA le aparta del 2º toque y de los remates; si es el colocador y no hace
    nada, su equipo pierde casi todo); pitar la falta de posición del humano (Difícil/Experto) e «imán» en Fácil/Normal; regla del
    líbero colocando de dedos delante de 3 m (`g.liberoSet`, hoy la IA solo evita que coloque ahí); «pipe» y ataque de segunda; tiempos
    muertos y cambios; bloqueo de lectura y triple; `serveRisk`/`serveTarget` sin pensar en formaciones (sacan a `openSpot`).
  - Cámara: `mateOf` = el compañero más cercano al humano (el diseño pide «el más cercano al eje cámara-jugador», y mirar solo los 2 más
    cercanos para la oclusión). Atletas: celebración en corro (hoy solo convergen el protagonista y su compañero más cercano: `cvPair`).
  - ui.js: `teamNums()` y el marcador siguen pensando en 2 dorsales; `perP = stats.p[0], [1]` (el reparto al escuadrón está desactivado
    con `g.size === 6`). (Escenas `serve6/rally6/point6` y perf 6v6: ver «Cámara y arranque 6v6» y «Atletas 6v6».)
  - **Atletas 6v6 (sprint 2, hecho)**: 12 rigs, líbero con camiseta propia (`liberoKit`, verde/blanco por defecto), aspecto y altura
    por puesto, `syncRigs` para entradas/salidas del líbero, LOD lejano sin contorno en media y sombras parciales (2 en baja, 6 en
    media). Detalle en notes/players.md. perf.js 844×390 CPU ×4 en 6v6: alta 70-74 dibujos; media 58-60 dibujos / 315-340 k
    triángulos (antes 68-75 / 379-393 k); baja 38-41 dibujos / 138-145 k (antes 45-48 / 174-177 k). 2v2 sin cambios (baja 29-33 / 113 k).
    **Pendiente**: baja 6v6 sigue por encima de 35 dibujos (ARN-12; el diseño §1.8 admitía 60): con 12 mallas con piel separadas no
    baja de ~36 ni sin sombras; haría falta fundir los atletas lejanos en una SkinnedMesh con esqueleto conjunto y un atlas de atlas
    (sprint 4), o aceptar ≤ 45 en 6v6 en perf.js (owner ui_main). Media 6v6 queda justa (340 k de pico de 350 k) y su JS por frame
    sube de ~8,5 a ~12-13 ms (Players.update con 12): animación de los lejanos a 30 Hz si hace falta. Faltan también: celebración en
    corro, animaciones nuevas (batida de 3 pasos, paso cruzado de bloqueo, rápida del central), fundido al entrar el líbero.
  - **Cámara y arranque 6v6 (sprint 2, hecho)**: `?format=6v6` (sigue SIN estar en el menú) → «Jugar» empieza un partido **de espectador**:
    CPU contra CPU con el HUD y las pausas de partido (`autopilot` + `present`, sin presentación) y `g.watch = true` (main.js). Decidido así
    porque la IA 6v6 aparta al humano del 2º y 3r toque: el humano entra en el sprint 3. Cámara de televisión `tv` (camera.js `tvShot`):
    alta (7,8 m) tras el fondo del equipo 0 (x 14,2), encuadra a los 12 (abre/cierra con la formación, sigue un poco el balón a lo ancho,
    lente según el aspecto), también en el punto (corte al saque siguiente); cambio de campo y final como en 2v2; sin plano de reacción
    (entre 12 quedaba tapado por la silla del árbitro), cierre de set ni plano del sacador rival en 6v6. ui.js: rótulos LOC / VIS (`WATCH_CR`, también en cintas y lector), sin avisos de mando, hoja final «Gana el
    equipo local / el visitante» y el partido no cuenta en el récord. input.js: sin mandos táctiles con `g.watch`. Escenas `?debug=serve6`,
    `rally6`, `point6` (en `shot.js all`). `node tools/tv6test.js [WxH] [s] [semilla]`: 12 jugadores en cuadro el 100 % de los frames, balón,
    límites, rótulos y sin mandos (1280×720 y 844×390 táctil: TODO OK). 2v2: todo lo nuevo va tras `g.size === 6` / `g.watch` / plano `tv`.
    **Pendiente (sprint 3)**: plano detrás del humano en 6v6 (`gameplayShot` con más FOV, §1.6), oclusión con los 2 compañeros más
    cercanos al eje cámara-jugador, plano de cierre de set y del sacador rival en 6v6, `bench`, plano de reacción que prefiera al
    ganador (hoy a veces enfoca a los que pierden entre 12), indicador de rotación (mini pista) y sacador por dorsal en el marcador, menú
    «Formato», rótulos de la hoja final (nivel, «Revancha en Normal», «Partidos ganados» no pintan nada en espectador).
  - **Revisión de los sprints 1 y 2 (10-nov-2026, arreglado)**: revisión de regresión 2v2 sin hallazgos (diferencial estado a estado contra HEAD:
    60 semillas × 240 s, todo igual). Del 6v6: **M1** la pestaña del punto decía «Remate / Error de la CPU» en espectador (`showBug` no pasaba
    por `cpuTxt`): ahora con `g.watch` sale «del rival»; **M2** «Defensa fuera» en el 26 % de los puntos → ~16 % (`BEAT6` en ai.js, solo con
    `g.rot`: el defensor «perdido» lee 0,4 s tarde y va al 30 %); **M3** receptor y central zagueros superpuestos en la cobertura (`offPos`):
    el central cubre en el sitio del líbero; **M4** en espectador ya no salen el halo/flecha del controlado (players.js) ni el aro amarillo
    (fx.js) y el partido va con `ctrl:'one'` (sin eventos `switch`); **G1** perf.js con `EXTRA=format=6v6` usa un tope **provisional** de 45
    llamadas de dibujo en baja (2v2 sigue en 35; el diseño §1.8 contaba con ~60). **Decisión para Ferran**: aceptar ese tope o hacer en el
    sprint 4 la malla única de los atletas lejanos. La pestaña de Carrera 2v2 que decía «de la CPU» ya está arreglada
    (10-nov-2026: `showBug` pasa siempre por `cpuTxt`).
  - **Sprint 3 HECHO (11-nov-2026, «humano en 6v6 + Formato»)**: control Uno por puesto (siempre el **receptor**, OH1 = n.º 2, como
    pide el diseño §1.5: no pasa al que va al balón; indicador = halo y galón del jugador, más grandes en 6v6), «¡mía!» y área de
    responsabilidad del 1r toque, el colocador le coloca (y más con «¡Pídela!» = CAMBIAR / ⇄ / Y), saque humano con la rotación,
    recepción, colocación (también en salto, al atacante que elige `chooseSet`), remate y bloqueo con teclado/ratón, táctil y mando;
    posición asistida (sin stick vuelve a su sitio; al balón suyo, solo en Fácil/Normal); sin eventos `switch`. Fila **«Formato» 2 contra
    2 / 6 contra 6** en la preparación del Partido rápido (`ctx.settings.format`; Escenario fijo en Pabellón y Controlar fijo en Receptor,
    con el aspecto «fijo» de los Puntos en la playa) y tarjeta «6 contra 6» de Jugar activa (abre la preparación en 6 contra 6). Ayuda
    mínima: consejos «Llevas al n.º 2, el receptor» en los primeros saques (compañeros por su puesto: «Coloca tu colocador»), Controles («Pedir el balón») y la tarjeta de
    presentación («N.º 2, receptor» / «Equipo rival»). Pruebas: simtest «6v6 con humano» y `tools/drive6.js` (teclado y TOUCH=1).
    `?format=6v6` sigue siendo el espectador (tv6test, perf); `?format=6v6&human=1` = humano desde la URL; escenas `serve6h`/`rally6h`.
    Detalle en notes/sim.md, notes/ui_main.md, notes/camera_input.md y notes/players.md «6v6 sprint 3». Capturas `tools/out/arte/6v6s3/`.
    **Revisión del sprint 3 (corregido)**: el Formato ya no se queda pegado (la tarjeta Partido rápido abre en 2v2; revancha/reiniciar
    repiten el formato del partido; tutorial → 2v2); «¡Pídela!» con respuesta (sello «¡Aquí!» / «Ahora no» sobre el humano, sonido, brazo
    arriba; `VB.Sim.askOk` y evento 'ask'; botón ⇄ con mano, «Pedir el balón», apagado cuando no vale); aro amarillo solo con TU balón en
    6v6; galón visible en el aire en 6v6; consejos sin «aro» y con puestos en vez de dorsales («retírate a defender» fuera del bloqueo,
    «cubre el ataque»); tarjeta guiada que se va si el balón no es tuyo; el 6v6 no cuenta en el récord (ni apaga consejos ni quita el
    novato); «PANTALLA COMPLETA» en icono en la preparación a ≤ 420 px de alto (no tapa la fila Formato); `js/sim.js` y `TRASPASO.md` en LF.
  - **Pendiente tras el sprint 3**: ~~cámara detrás del humano (sigue la de televisión; ver punto 2)~~ HECHO 11-nov (camera_input: 3ª persona por
    defecto y Televisión como opción, en Ajustes · Imagen y en la preparación del 6 contra 6; notes/camera_input.md «6v6: cámara en 3ª persona»), falta de posición pitada al humano en
    Difícil/Experto e «imán» (hoy no puede solaparse: nadie se mueve durante el saque rival), elegir otro puesto (colocador v2: `CTRL_ROLES6`
    solo admite 'OH'), marcador con sacador por dorsal e indicador de rotación, hoja final del 6v6 (MVP y estadísticas aún de 2v2; ya no
    cuenta en el récord), fondo del menú con Formato 6 contra 6 (sigue la demo de playa), ~~el colocador coloca al humano delantero aunque
    esté quieto~~ (HECHO 11-nov: `VB.AI6.setReady`, solo si está cerca de la red y jugando), **equilibrio: DECISIÓN DE FERRAN** (11-nov: sin movimientos solos el 6v6
    en Fácil queda MÁS fácil: novato 61-71 % de los puntos —antes 45 %—, y un humano que no toca nada gana ~48 %; tabla en notes/sim.md), pocos remates del humano
    zaguero (no hay «pipe»), «Avanzar» en espectador. Toques del humano por rally (bot): novato 0,62, medio 0,76 (objetivo 0,7).
  - **Sin movimientos solos (11-nov, petición de Ferran, HECHO en la sim)**: fuera la «posición asistida» (`assist6`); el humano solo se
    mueve, salta y golpea con el mando (el imán corto de `assistMove` solo si ya empuja el stick; queda la colocación antes del saque); los compañeros no le quitan
    los balones de su zona (si no va, cae); aro celeste en el suelo con su sitio (fx `posMark`). Detalle e inventario en notes/sim.md.
  - **Qué faltaba para el sprint 3 (humano en 6v6 + menú «Formato»)** (lo hecho, tachado):
    1. ~~Sim/IA: `AI6.decide` (2º/3r toque del humano y «¡Pídela!»; hoy la IA le aparta del 2º toque y de los remates), responsabilidad
       («¡mía!») del 1r toque, posición asistida~~ e imán en Fácil/Normal, falta de posición pitada al humano en Difícil/Experto, ~~sin
       `switch` en 6v6 (control Uno por rol, receptor por defecto), medir toques del humano por rally (objetivo ≥ 0,7)~~.
    2. ~~Cámara: plano detrás del humano (`gameplayShot` con más FOV, §1.6), oclusión con los 2 compañeros más cercanos al eje
       cámara-jugador, planos de reacción, cierre de set y sacador rival en 6v6.~~ HECHO 11-nov (camera.js `tpShot`/`tpPointShot`, `tools/cam6test.js`;
       falta `bench` y «Avanzar»).
    3. ui_main: ~~fila **«Formato» 2v2 / 6v6** en el menú (`ctx.settings.format`)~~, elección de rol, ~~tutorial (mínimo) y
       Controles en 6v6~~, marcador con sacador por dorsal e indicador de rotación (ojo: el líbero queda con la zona de su central durante la
       pausa del punto, hasta `setupServe`), panel «Primer partido» que no salga en 6v6, hoja final sin textos de 2v2 (nivel, «Revancha en
       Normal», «Partidos ganados»; ~~«Cambiar opciones»~~ ya sale en el 6v6 humano), `teamNums()` con 2 dorsales, «Avanzar» o partido más corto en espectador (un 2-0 dura 18-27 min).
    4. Atletas/arena (sprint 4): baja 6v6 ≤ 35 llamadas (malla única de lejanos) o ratificar 45; equipo del fondo diminuto a 844×390
       (dorsales ilegibles); celebración en corro; animaciones nuevas.
    5. Menores de la revisión: recepción de la rotación 1 (colocador en zona 1 muy al fondo, 4 en línea), cruces entre compañeros (la sim
       no separa), pocos aces (2-3 %; `serveTarget` sin formación), colocación previsible con el colocador delante (sin pipe), simtest 6v6
       sin prueba de la secuencia del orden de saque y la del líbero solo en `rally`/`serve`; la huella 2v2 no cubre COLOCAR, `present`,
       `ritual`, `serveClock`, challenge, `nums`, `ctrlIdx` (el diferencial de la revisión está en el scratchpad de esa sesión, no en tools/).
- **Posiciones y estadísticas de jugador** (para el 6v6): colocador, opuesto, central, receptor, líbero; atributos (salto,
  remate, recepción, saque, bloqueo, velocidad…) que influyan en la sim. Diseño en [`notes/diseno-6v6-carrera.md`](notes/diseno-6v6-carrera.md).
- **Pendiente del sprint remate apuntado + challenge** (9-nov-2026, menores):
  - El error arbitral casi no se ve jugando (30 partidas con piloto: 23 botes a <= 10 cm, 1 mal cantado). Si Ferran quiere verlo
    más, subir `VB.REF_ERR` (p1/p2/p3) o ampliar d1-d3.
  - Sin probar a mano: diana con mando y en táctil, estrechez de `digTight`, LT/L2 (solo padtest).
- **Error arbitral por competición, lo que falta**: hecho para las 5 ligas de la Carrera 2v2 (ver Hecho). Falta la fila «Olímpicas
  y similares» (casi nulo, con challenge) cuando haya esas competiciones (Carrera 6v6) y cualquier modo nuevo fuera de la Carrera.
- **Más modos de juego**: el selector de puntos por set es la base de «Partido rápido»; los modos nuevos irán al lado.
- **Textos**: Ferran revisará el resto de textos y botones (lista numerada A–D que se le pasó el 9-nov-2026).
  Pregunta abierta: ¿«3r» → «3r» y «2º» → «2º»? (10-nov: «1r» pasó a «1r» en set y toque, que era la abreviatura catalana.)
- **Pulido profundo pausado**: el flujo de pulido se paró a mitad (oleadas 1-2 subidas en 94ba33d); falta la oleada 3,
  su verificación y el QA final. Solo si Ferran lo pide.
- **Pendiente del sprint cartoon** (9-nov-2026, menores, nada roto):
  - ~~El contorno de tinta del escenario (postes, silla del árbitro, mesa, árbitros) existe pero casi no se ve sobre las piezas azul marino
    o negras; si se quiere más «dibujo», aclarar esas piezas o subir el grosor de `props`/`poles` (cuesta 0 dibujos, ya están en la lista).~~
    HECHO 11-nov (arena: piezas aclaradas y tinta más gruesa, `PROP_INK`).
  - Camiseta negra: ahora se aclara a pizarra (#383c4a) en pista y la franja del marcador usa el color de los detalles; la CPU pasa a
    blanca con ella (antes seguía azul). Si Ferran quiere el negro puro, revisar `setKit` (players.js).
  - Público: sombreado por bandas y colores de bloque; se ha comprobado en planos de punto, peloteo (alta y baja) y táctil, pero no a mano
    en un móvil real (¿compite con los atletas naranjas en algún plano?).
  - `tools/drive.js` falló 1 vez de 4 («el humano llega a tocar el balón», con el PC al 60 % de CPU); las otras 3, TODO OK. Vigilar.

### Hecho
- **Logotipo «Make the Cut» (11-nov-2026; Ferran: «Vale, bien. Súbelos»)**: el rótulo partido en dos por la trayectoria del
  remate (un *cut* es el remate en diagonal cerrada). Es el SVG `#mtcLogo`, definido una vez en index.html (antes del telón)
  y usado en el menú y en el telón con `<use>`; mide 4,3 em de ancho, así que escala con el font-size de `.logo` y el FLIP
  del telón sigue igual. Letras de Barlow Condensed Black Italic pasadas a trazados (ya no dependen de la fuente «VB Marca»,
  que solo usa el rótulo PALAU DEL MAR). Icono nuevo en pages/ (balón partido en diagonal) con los PNG 180/192/512
  regenerados, y el balón de las vallas (arena.js `drawGameBall`) en teal como el del partido. Fuentes del logo (gen.py,
  symbol.py y las propuestas A-D en SVG) fuera del repo, en `carpetas/logo-make-the-cut` del PC de casa.
- **Muñeco integrado** (10/11-nov-2026, rama `wip-doll-carrera-playa`; pedido de Ferran: «Los nuevos Doll están bien. Mételos»): el muñeco
  chibi de `js/doll.js` es el único modelo de personaje (pabellón, playa, 6v6, Carrera). players.js monta su esqueleto con
  `VB.Doll.dims()`, estirón cartoon del brazo al golpear, caras del muñeco, squash con rebote de la cabeza, aspecto por jugador (tus n.º 1 y 2
  fijos), equipaciones y playa con tirantes, malla y descalzo. Sim intacta (huella 2v2 idéntica). Tras la revisión del 11-nov: gorra del n.º 1
  sin aro negro sobre los ojos, visera del afro en su sitio, afro con rizos, tupé sin «orejas de gato» y borrado el código muerto del atleta
  TAJO en players.js (4.065 → 3.397 líneas). Detalle en notes/players.md «Muñeco (doll.js)».
- **Carrera de vóley playa** (10/11-nov-2026, misma rama; «Te pueden fichar clubes, pero de vóley playa»): partidos en Platja Llarga a
  21/15 aunque el ajuste sea el pabellón (`forceVenue`), clubes de playa con sede, circuitos y Open, guardado v3 con migración sin pérdidas.
  Detalle en notes/carrera.md «Sprint playa».
- **Compañeros de distinto nivel** (misma rama; «nerfear un poco al compañero» y «mejores y peores compañeros»): desvío propio −9..+5
  respecto al club (media −2), rol, forma, puntos fuertes y flojos; ofertas con su compañero; plantilla con 2 alternativas a ≥ 3 del
  titular (arreglado el 11-nov: a veces salía una con la misma media). Ficha, hub y Comparar enseñan el desvío.
- **Arreglos de la revisión de regresión** (11-nov-2026): (1) GRAVE, venía de antes: tras cambiar la calidad (a mano o la automática en el
  móvil) el siguiente partido se pintaba sin jugadores, balón ni red (`getUniforms` en cada frame): el precompilado asíncrono (main.js)
  no invalidaba la versión del material; ahora sí (`__version = -1`). Comprobado: medium y low tras cambiar la calidad, 44 y 28 dibujos sin
  errores. (2) El 6v6 se pintaba con el decorado de playa (ajuste por defecto): ahora fuerza el pabellón. (3) `perf.js` sin `EXTRA` mide la
  playa; el pabellón con `EXTRA=map=hall` (documentado).
- **Des-IA-ficar los textos** (10-nov-2026, pedido de Ferran: «los separadores con "·" cantan»): ya no hay un pegamento universal « · ».
  Etiquetas y datos cortos con el separador que toca (barra fina en el HUD y las fichas, barra inclinada en pares, raya larga en
  enfrentamientos, paréntesis para lo secundario, pastillas solo para metadatos sueltos); consejos, avisos, ayudas y descripciones
  como frases cortas; rótulos del pabellón «PUNTO PARA TI» / «SET PARA LA CPU» / «REVISIÓN». Guía en notes/ui_main.md «Textos»;
  capturas en `tools/out/textos/`.
- **Cuentas** (10-nov-2026, pedido de Ferran, como emPat Data pero sin cifrar): `js/account.js` (botón «Cuenta» en el menú
  principal; entrar, crear, cerrar sesión, borrar) con Firebase `make-the-cut-vb` por REST. Sincroniza escuadrón, Carrera, ajustes
  y récord; pregunta si hay dos Carreras distintas. Diseño y pruebas en [`notes/cuentas.md`](notes/cuentas.md). También: el **balón
  es teal** (paneles teal, crema y teal oscuro), y en la playa la **silla del árbitro va sin toldo** y la **red es como la de la AVP** (cuerda negra, bandas amarillas, banda superior alta con el logo repetido, postes negros con protección amarilla) y en las dos sedes las cuerdas del centro van pintadas de teal formando «M T C».
  Pendiente: «cerrar sesión» no borra lo del dispositivo (si se comparte el móvil, el siguiente ve tu progreso); sin probar en un
  móvil real.
- **Menús v2 + atributos que se notan + gestión de Carrera, integrados** (10-nov-2026; pedido de Ferran: menú sin números, submenús
  por pestañas como EA FC, «Jugar» con los modos, en Carrera solo tu jugador, que se noten las estadísticas, elegir club al empezar):
  principal con 5 entradas sin números → JUGAR (Partido rápido · Carrera · 6v6 «Próximamente») → preparación; pestañas comunes
  `VB.UI.tabs` en Jugadores (Físico · Defensa · Ataque · Insignias), Ajustes, Controles **y la Carrera** (Q/E, LB/RB, RePág/AvPág,
  LT/RT, deslizar); atributos en la física (velocidad, aceleración, salto, ventanas, precisión y alcance del toque; frenar al momento);
  Carrera que empieza sin club (ofertas, prueba, comparar, negociar con riesgo), entreno/fatiga que se recupera, contrato con coste
  de salida, estilo del club que entrena, bandeja, química, plantilla. Escuadrón de Partido rápido a media 50 (v3) y CPU con
  atributos si el escuadrón pasa de 50. Cartel «MAKE THE CUT» con el balón nuevo. Todas las pruebas OK (huella attrs regenerada,
  cpu/human idénticas). Capturas `tools/out/menus/final/`; detalle en CONTRACT y notes (ui_main «Menús v2» e «Integración de menús
  v2», sim, carrera, arena).
- **Personajes propios (dirección «TAJO») y playa completa** (10-nov-2026; pedido de Ferran tras ver «SetPoint Volleyball»): atletas
  cabezones (~5 cabezas, rig y alcance iguales), superficies lisas, contorno grueso del color del equipo, cara grande dibujada en el atlas
  (8×8 expresiones con 2 uniformes, halo claro en pieles oscuras), raya de guerra / zinc neón como sello, 7 peinados de mechones, manopla,
  uniforme con el «tajo» en zigzag; en la playa camiseta de tirantes unisex, malla del mismo color, descalzos y visera o gorra hacia atrás
  (sin gafas de sol). Playa «Platja Llarga» a mapa principal: reglas de vóley playa (16×8, 21/15, cambio cada 7, bloqueo = toque, pokey,
  dobles), menú «04 Escenario», cintas coral, piezas propias (silla de madera, mesa con toldo, postes de aluminio), telón con pueblo y faro,
  llaüts de vela tostada, socorrista fuera del eje, árbitros y jueces cabezones, arena y huellas, luz de tarde (`?luz=tarde`). Cierre:
  fuga de la textura de huesos al cambiar de escenario/equipación arreglada, revisión del challenge y marcador de caída con la pista de la
  partida, «CAMBIO DE CAMPO · CADA 7 PUNTOS» y silbato corto, consejo que ya no tapa TOQUES a 2560×1440. Huella 2v2 idéntica; perf
  «objetivos cumplidos» en pabellón, playa y 6v6. Capturas `tools/out/arte/final/`; detalle en CONTRACT «TAJO y playa completa» y notes.
- **6v6, sprint 3: humano y fila «Formato»** (11-nov-2026): llevas al receptor (n.º 2) con teclado/ratón, táctil y mando; la IA mueve
  al resto (saque con la rotación, recepción, colocación y en salto, remate, bloqueo, «¡mía!», «¡Pídela!», posición asistida). Fila
  «Formato» en Partido rápido y tarjeta «6 contra 6» activa; el 6v6 fuerza el pabellón. simtest «6v6 con humano», `tools/drive6.js`,
  escenas `serve6h`/`rally6h`. Huella 2v2 idéntica; perf 6v6 «objetivos cumplidos». Detalle y pendientes en «Modo 6v6» (To-do).
- **6v6, sprints 1 y 2 + revisión** (10-nov-2026): sim a N jugadores (2v2 idéntico, huella en simtest), 6v6 CPU contra CPU con rotaciones,
  líbero, formaciones, reglas de zaguero e IA 5-1 (`js/ai6.js`), 12 atletas, cámara de televisión y partido espectador con `?format=6v6`
  (NO en el menú). Detalle, arreglos de la revisión y lo que falta para el sprint 3 en «Modo 6v6» (To-do).
- **Colocación en salto** (10-nov-2026, pedido de Ferran: «colocar saltando, incluyendo móvil y mando siempre»): en el aire GOLPEAR remata y
  **COLOCAR** coloca en salto hacia la zona de ataque del compañero (2º toque, o 1r con el balón alto en la red: el compañero ataca en el 2º).
  Teclado **K**, ratón **clic central**, mando **X** (□), táctil botón **COLOCAR** que solo sale en el aire; en el suelo COLOCAR salta. Más rápida
  y con menos margen; con mal timing sale pegada a la red o larga. El compañero IA la remata; Manos de seda y asistencias la cuentan. Aviso
  «Rematar / Colocar», Controles, tutorial y consejos en los 3 dispositivos. La IA no la usa (CPU contra CPU idéntico). Ver notes/sim.md.
  - **Arreglos tras la revisión** (10-nov-2026): el bloqueador CPU lee la colocación en salto y llega a la red (antes 0 bloqueos y 76 % de
    puntos en «controlar a los dos»; ahora 54 % frente al 51,5 % de la de suelo, y con mal timing 42-43 %); el bonus de defensa solo vale tras
    la del 2º toque (en el 1r, rematar el balón regalado vuelve a ser igual o mejor); el botón y el aviso COLOCAR solo salen si la
    colocación va a salir de verdad; COLOCAR ya no «coloca» el remate rival desde el bloqueo; la doble pulsación rápida funciona (búfer de
    0,2 s); aviso 2×2 más limpio (glifos sin estirar, K verde, sin palabras repetidas en táctil); X/□ ya no hace «volver» en menús.
    CPU contra CPU idéntico. Pendiente: ~~GOLPEAR en el bloqueo devuelve el remate CPU (anterior), la IA no coloca en salto~~ (HECHO 11-nov, notes/sim.md), móvil y mando reales.
- **Pulido 10-nov-2026** (pedido de Ferran, en paralelo a la Carrera 2v2):
  - **Mapa de playa — escenario**: sede «Platja Llarga» (Ajustes · Imagen · Escenario, `?map=beach`): cielo con sol y nubes, mar con olas,
    arena con huellas, cinta azul, gradas con toldo y público animado, palmeras, socorrista, barcos. Se construye al elegirla y se libera al
    volver (sin fugas). Las reglas de playa siguen pendientes (To-do).
  - **Controles PC**: Espacio salta, J o X golpean, clic izquierdo golpea y clic derecho salta sobre la pista (K era alias oculto de saltar; desde la colocación en salto es COLOCAR).
    Todos los textos salen de una tabla (`GLYPH`); el panel Controles dibuja el ratón con el botón en ámbar.
  - **Dorsales 1 y 2** para tu pareja (CPU 3 y 9); escuadrones guardados 7/11 renumerados sin perder progreso; Carrera con dorsal 1 por defecto.
  - **Control simplificado**: «Controlar ‹ a los dos jugadores ›» / «Controlar ‹ un jugador ›» (siempre el n.º 1); la Carrera usa las mismas palabras.
  - **Separadores con diseño**: rombo en antetítulos, raya fina en ayudas, barra inclinada en pares, pastillas en datos (`VB.UI.sep`); frases sin «·».
  - **Pantallas grandes**: menú, Carrera, presentación del partido, HUD y paneles crecen con `--vs` (1,34 a 1920×1080, 1,71 a 2560×1440).
  - Arreglos de la revisión: hoja final a 667×375 sin desvanecido sobre los botones, tutorial que cabe a 667×375, LED sin «PUNTO DE SETPUNTO DE SET»,
    «1r set», textos táctiles del panel Controles.
- **Carrera 2v2** (sprint del 9/10-nov-2026; botón «02 Carrera»): creas tu jugador (nombre, dorsal, rol atacante / universal /
  colocador-receptor, puntos por set, control «uno» o «Los dos»; media 35) y empiezas en un club modesto de la Liga Regional con un
  compañero que pone el club. 5 ligas de 8 clubes inventados (Regional, Nacional, Superliga, Continental, Circuito Mundial), liga a doble
  vuelta (14 jornadas) + copa de los 4 primeros; cada jornada se juega de verdad o se simula (mitad de XP). Nota del partido 1-10,
  objetivo del club, confianza del entrenador, ofertas a mitad (solo con nota media ≥ 7) y al final de temporada, ascensos y
  descensos en todas las ligas, palmarés. Progresión propia (más generosa que la de Partido rápido) y las insignias en tu atleta.
  Arbitraje por liga (`createGame({ref})`): alto / medio / medio / jueces de línea / jueces + challenge. Calibrado con la sim en
  autopilot (la IA rival sale de la media del club: Fácil en toda la Regional, Normal, Difícil, Experto ≥ 80) y en los arreglos finales
  con los bots de simtest: nota (antes casi siempre 10 con control «uno»; ahora novato 6,1 / medio 7,8 / bueno 9,1, techo suave), XP
  jugada 242-339 por partido frente a 123 simulada, ofertas con la media real de la temporada siguiente, guardado dañado reparado o
  apartado (`voley3d.career.bak`) sin romper la pantalla, foco seguro con teclado y mando (doble Intro en «Simular» ya no arranca un
  partido ni rechaza las ofertas). Detalle en `notes/carrera.md`; prueba `tools/careertest.js`.
- **Insignias** (sprint Carrera): 12 insignias con bronce, plata y oro (nombres inventados: Cañón, Ojo de halcón, Rompemanos, Manos de
  seda, Bombardero, Hoja seca, Muro, Ancla, Red de seguridad, Motor, Sangre fría, Líder) que se desbloquean haciendo cosas en los
  partidos (`VB.Badges`, eventos de la sim) y se equipan en huecos (2 + 1 cada 5 niveles, hasta 6), en Partido rápido (escuadrón) y en
  la Carrera. Efectos en la sim (`createGame({badges})`, `VB.BADGE`). Calibrado en los arreglos finales: Cañón, Ojo de halcón, Red y
  Manos de seda salían de bronce en 2-3 partidos y de oro en ~20 → umbrales ×3-4 (bronce ~7-10 partidos, oro ~60-110); Ancla al revés
  (oro en ~200 → ~120-150); Motor, que llega sola, a la mitad (+3,3 puntos de % con oro); Líder subido (con oro no se notaba). Combos de 6
  de oro: +5-6 puntos de %. Prueba `tools/badgetest.js` y simtest «insignias».
- **Saque dirigible** (sprint Carrera): al lanzar, una diana que mueves con flechas / stick / joystick por todo el campo rival; con
  buen timing el saque va exacto (dispersión `serveSpread` según la calidad: salto perfecto ~1 cm, tarde 0,13 s ~0,7 m). En los
  arreglos finales: la IA deja botar los saques que se van fuera (antes los tocaba todos y apuntar a la esquina no tenía riesgo: 35-42 %
  de aces y 0-2 % de fallos; ahora 30-47 % de aces con 13-37 % de fallos, +2-4,5 puntos de % frente a no apuntar), el término de línea
  de `serveRisk` baja de 0,4 a 0,27, y en el saque ↑/↓/←/→ van por los ejes de la pista (antes ↑ desviaba la diana hacia un lado).
- **Error arbitral y challenge por competición** (concepto de Ferran, 9-nov-2026), en la Carrera 2v2: Liga Regional alto y sin
  challenge; Nacional y Superliga medio, sin challenge; Continental jueces de línea, sin challenge; Circuito Mundial jueces de línea
  y challenge (2 por set). Partido rápido sigue con `VB.REF_ERR` y challenge. (`career.js` `REF`, `sim.js` `opts.ref`.)
- **Estadísticas de jugador y sistema de mejora** (9-nov-2026): 10 atributos 1-99 por atleta (Salto, Velocidad, Reacción, Recepción,
  Defensa, Bloqueo, Colocación, Potencia, Control, Saque). En la sim (`createGame({attrs})`): perfil de IA por jugador (`statProf`) y,
  al humano, ventanas de timing por toque ±12 %, velocidad de remate/saque, tamaño de la diana, salto ±6 % y carrera ±8 %; 50 = neutro
  (simtest comprueba que sin atributos / con 50 en todo la sim es idéntica, y la monotonía: equipo CPU con 15/50/85 gana 31/41/48 % de
  los puntos). Progresión en `js/prog.js`: tus dos atletas empiezan con media 40 (el 7 atacante, el 11 universal), ganan experiencia
  en cada partido (base + puntos propios + victoria + sets, × dificultad), 3 puntos de mejora por nivel, coste 1/2/3/4 según el valor
  (<50/<65/<80/resto), mejoras definitivas. Panel «Jugadores» en el menú (05) y experiencia en la hoja final. La CPU no lleva atributos
  (juega con el perfil de su nivel). Pendiente: atributos de la CPU por rival (para Carrera) y opción de reiniciar la progresión. (9-nov-2026)
- **Gráficos cartoonish** (sprint del 9-nov-2026): sombreado por bandas (`VB.TOON`: rampa de 3 pasos y contorno de tinta #1d1530 por
  casco invertido en atletas, balón, postes, utillaje y oficiales; apagado en calidad baja), paleta saturada (parquet cálido y plano,
  gradas con bloques de color), atletas caricaturescos con caras expresivas y squash & stretch, FX de dibujo (estrellas, explosión de
  cómic, nubes de polvo, líneas de velocidad, «¡PAM!» en el remate perfecto, que respeta «Destellos suaves» y se apaga en baja) y UI
  de cómic (tipografía con contorno, paneles con borde y sombra desplazada). Arreglos finales: el público 3D pasa a sombreado por
  bandas con colores de bloque (antes casi realista en los planos de punto); la red lleva contorno de tinta pintado en la textura;
  en baja las estrellas sustituyen a chispas y destellos (pico de 37 → 35 dibujos, ARN-12; perf.js ahora exige ≤ 35 de pico en
  baja, antes ≤ 60); el consejo se vuelve translúcido también si tapa a un jugador (táctil, remate rival); camiseta negra legible.
- **Pendientes resueltos en el sprint cartoon**: modo Uno con elección de jugador (n.º 7 / n.º 11, `ctrlIdx`, ajuste `ctrlPlayer`) y sin
  «⇄ Cambiar jugador» en Controles ni en el tutorial; filas del menú táctil a 44 px; muestras de Equipación de 32×32 px en el móvil;
  acento de equipo en la UI = color de la equipación (`--k0`/`--k1`, marcador «TÚ», tutorial); tras un punto anulado ya no sale la
  etiqueta «REMATE»; el cartel «OUT» de la UI es opaco con contorno (la red ya no lo ensucia). simtest prueba además que el humano
  bloquea en modo Uno (n.º 7 y n.º 11) sin que el compañero IA salte a la vez.
- **Nombre del juego: «Make the Cut»** (sin exclamación; elegido por Ferran el 9-nov-2026; doble sentido: el *cut shot* del vóley y «pasar el corte»,
  ganarse la plaza, como en el modo Carrera). Cambiado en título, logos (menú y telón), rótulo del pabellón, aviso de girar el móvil
  y nombre de la app instalable. Repo renombrado a `purupurpito/make-the-cut` (GitHub redirige el repo antiguo); web en https://purupurpito.github.io/make-the-cut/. La URL antigua de Pages (/voley-3d/) da 404 salvo que se cree la redirección en el repo `purupurpito.github.io`.
  Marcas (revisado en TMview/OMPI el 9-nov-2026): nadie tiene «Make the Cut» para videojuegos (clases 9/28/41 de juegos).
  Única marca viva cercana: FR 4948864 «Make The Cut» (INPI, particular de París; clases 35, 41 solo formación/información
  de entretenimiento, 42 desarrollo de software para terceros; solicitada 26-3-2023, registrada 7-7-2023, vence 26-3-2033).
  Sin uso visible: anulable por falta de uso desde el 7-7-2028. Para el juego gratuito no afecta (no hay uso comercial y solo
  vale en Francia). Si algún día se vende: registrar en la OEPM (clases 9, 28, 41) y consultar a un agente antes de ir a la UE.
  El «Make the Cut!» de itch.io (GMTK Game Jam 2019) no tiene marca; «Making the Cut» de Amazon está en ropa y venta.
- Equipación personalizable (Ajustes · Equipación): color de camiseta (8), detalles (6), pantalón (5) y diseño (Diagonal, Liso,
  Franjas, Rayas). players.js `setKit` deriva los tonos (dorsal oscuro en camisetas claras) y la CPU cambia a una equipación
  alternativa (roja, verde o blanca) si la suya se parece a la tuya. Vista previa en vivo sobre la demo del menú.
  ~~Pendiente: muestras pequeñas en el móvil; UI con el naranja/azul~~ (resuelto en el sprint cartoon: 32×32 px y acento = equipación).
- Selector «Control: Los dos / Uno» en el menú (ajuste `ctrlMode`, `createGame({ctrl})`, `g.ctrlMode`). En modo Uno el humano lleva
  siempre a `teams[0][0]` y la IA al compañero (toques, posición, defensa/bloqueo y su saque); sin cambio de jugador ni botón ⇄.
  El bloqueo se reparte de forma dinámica durante la colocación de la CPU (sim.js `updateDefense`): si el humano sube a la red,
  el compañero se echa atrás; si se va al fondo (>3,2 m), sube el compañero. ~~Pendiente: «⇄ Cambiar jugador» en Controles y tutorial;
  elegir a cuál controlar; filas táctiles a 42 px~~ (resuelto en el sprint cartoon).
- **Remate apuntado**: mira libre en el aire por el campo rival (`g.aim3`), dispersión según el timing (`Sim.spikeSpread`,
  perfecto = exacto a la diana), diana grande desde el despegue con radio = dispersión, defensa más justa tras remate perfecto
  (`g.digTight`, aro ×0.7), consejo «Apunta con…» (legible aunque el balón pase por detrás) y tutorial paso 4.
- **Error arbitral + challenge** (`notes/challenge-fivb.md`): llamadas al revés en botes a <= 10 cm (`VB.REF_ERR`, `g.call`),
  2 challenges por set (`Sim.canChallenge`/`Sim.challenge`, ventana de 7 s, fallar gasta uno), revisión de 4,5 s con plano de
  tele, huella y línea resaltada, señal del árbitro, bocina y público, V / LT / botón táctil CHALLENGE, contador junto al marcador.
  Arreglos finales: la ventana que cruza al set siguiente usa los challenges del set de la llamada (no se puede pedir sin quedar
  ninguno ni gasta uno del set nuevo); la CPU pide sobre todo cuando el árbitro se equivocó (~60 %) y rara vez si acertó (~7 %);
  en el punto de partido la ventana dura los 7 s (saltar la pausa renuncia); el plano de revisión de un bote de banda cerca de la
  red se pone entre la red y la marca (el poste ya no tapa el plano).
- Textos del tutorial: «1r toque», «círculo», «se hace más pequeño», sin la explicación de la defensa ni la falta «Cuerpo».
- Consejos del partido solo hasta la 1a victoria; luego se apagan (ajuste `coachTips`, Ajustes · Juego · Consejos).
- Partido rápido: selector de puntos por set (11/15/21/25) en el menú.
- Móvil: sin zoom por doble toque (el `<meta name="viewport">` quedaba en el `<body>` de la versión de Pages y los móviles lo
  ignoraban; tools/build-pages.js ahora lo sube al `<head>`) y pantalla completa: sola en el primer toque y al empezar partido,
  botón en el menú, botón en el HUD de escritorio y tecla F. En iPhone (sin API) aviso de «Añadir a pantalla de inicio":
  Pages lleva manifest (display: fullscreen, horizontal) e iconos (`pages/`).

## Cómo seguir en casa

1. `git clone https://github.com/purupurpito/make-the-cut.git && cd make-the-cut`
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

- `node tools/simtest.js` — simulación CPU contra CPU + jugador con teclas al azar. Debe acabar sin errores. Incluye la huella del 2v2
  (`node tools/fingerprint6.js`, 15 s: compara con `tools/fp-2v2.json`; `--write` la regenera, SOLO si se cambia el 2v2 a propósito).
- 6v6: `EXTRA=format=6v6 node tools/perf.js 844x390 20 high,medium,low 4 2.75` (tope provisional de 45 llamadas en baja) y
  `node tools/tv6test.js [WxH] [s] [semilla]` (partido espectador: 12 en cuadro, sin ayudas del humano).
- 6v6 con humano: `node tools/drive6.js [W=1280] [H=720] [s=70]` (menú → tarjeta 6 contra 6 → Formato → partido con teclado, saque
  humano, «¡Pídela!»; `TOUCH=1` con toques de dedo, p. ej. `TOUCH=1 node tools/drive6.js 844 390 50`); touchplay/padplay admiten
  `EXTRA='format=6v6&human=1'` (en 6v6 fallan a propósito «SACAR en tu saque» —saca primero el colocador— y «⇄/RB cambia de jugador»).
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

Repo público en **purupurpito** (cuenta personal), publicado en GitHub Pages:
https://purupurpito.github.io/make-the-cut/ (se despliega solo en cada push a main con .github/workflows/pages.yml).

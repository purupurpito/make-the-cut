# TRASPASO — Make the Cut (antes «Voley 3D»)

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
- **Arena**: grada lateral menos saturada en alta (ARN-02); el 1.er árbitro señala «fuera» en la falta de antena.
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

### To-do
- **Modo 6v6** (9-nov-2026): llevar el juego de 2 contra 2 a 6 contra 6. Campo más grande (pista reglamentaria de 18×9 m
  con 6 por equipo), rotaciones y posiciones. Cambiar de jugador será poco habitual, así que el primer modo 6v6 será
  **controlando solo a un jugador** (ya existe: «Control: Uno», con elección del n.º 7 o el n.º 11). Se mantiene todo el motor de toques y reglas,
  que ya funciona bien. **Diseño hecho:** [`notes/diseno-6v6-carrera.md`](notes/diseno-6v6-carrera.md) (solo diseño, nada empezado).
- **Posiciones y estadísticas de jugador** (para el 6v6): colocador, opuesto, central, receptor, líbero; atributos (salto,
  remate, recepción, saque, bloqueo, velocidad…) que influyan en la sim. Diseño en [`notes/diseno-6v6-carrera.md`](notes/diseno-6v6-carrera.md).
- **Pendiente del sprint remate apuntado + challenge** (9-nov-2026, menores):
  - El error arbitral casi no se ve jugando (30 partidas con piloto: 23 botes a <= 10 cm, 1 mal cantado). Si Ferran quiere verlo
    más, subir `VB.REF_ERR` (p1/p2/p3) o ampliar d1-d3.
  - Sin probar a mano: diana con mando y en táctil, estrechez de `digTight`, LT/L2 (solo padtest).
- **Modo Carrera** (9-nov-2026, el que más ilusión le hace a Ferran; el más largo): un jugador con estadísticas bajas que se
  inscribe en equipos modestos, recibe ofertas de equipos mejores, mejora sus estadísticas y acaba jugando VNL, Olimpiadas, etc.
  Depende del 6v6, del modo de un solo jugador y de las posiciones/estadísticas. Diseño en [`notes/diseno-6v6-carrera.md`](notes/diseno-6v6-carrera.md).
- **Error arbitral y challenge por nivel de competición** (concepto de Ferran, 9-nov-2026; para Carrera y modos futuros):
  | Competición | Error arbitral | Challenge |
  |---|---|---|
  | Partido rápido | el de base actual (`VB.REF_ERR`), sin modificador | sí |
  | Ligas bajas | alto | no |
  | Ligas medias | medio | no |
  | Ligas altas | bajo, porque hay jueces de línea | no |
  | Ligas muy altas | bajo | sí |
  | Olímpicas y similares | casi nulo | sí (casi no hace falta) |
- **Más modos de juego**: el selector de puntos por set es la base de «Partido rápido»; los modos nuevos irán al lado.
- **Textos**: Ferran revisará el resto de textos y botones (lista numerada A–D que se le pasó el 9-nov-2026).
  Pregunta abierta: ¿«3.er» → «3r» y «2.º» → «2º»?
- **Pulido profundo pausado**: el flujo de pulido se paró a mitad (oleadas 1-2 subidas en 94ba33d); falta la oleada 3,
  su verificación y el QA final. Solo si Ferran lo pide.
- **Pendiente del sprint cartoon** (9-nov-2026, menores, nada roto):
  - El contorno de tinta del escenario (postes, silla del árbitro, mesa, árbitros) existe pero casi no se ve sobre las piezas azul marino
    o negras; si se quiere más «dibujo», aclarar esas piezas o subir el grosor de `props`/`poles` (cuesta 0 dibujos, ya están en la lista).
  - Camiseta negra: ahora se aclara a pizarra (#383c4a) en pista y la franja del marcador usa el color de los detalles; la CPU pasa a
    blanca con ella (antes seguía azul). Si Ferran quiere el negro puro, revisar `setKit` (players.js).
  - Público: sombreado por bandas y colores de bloque; se ha comprobado en planos de punto, peloteo (alta y baja) y táctil, pero no a mano
    en un móvil real (¿compite con los atletas naranjas en algún plano?).
  - `tools/drive.js` falló 1 vez de 4 («el humano llega a tocar el balón», con el PC al 60 % de CPU); las otras 3, TODO OK. Vigilar.

### Hecho (9-nov-2026)
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

Repo público en **purupurpito** (cuenta personal), publicado en GitHub Pages:
https://purupurpito.github.io/make-the-cut/ (se despliega solo en cada push a main con .github/workflows/pages.yml).

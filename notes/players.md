# notes/players.md — atletas y animación (owner: players)

Fichero: `js/players.js`. Interfaces de CONTRACT.md §4 intactas. Fecha: 2026-11-06 (pasada de cierre).

## Estado
- Atletas procedurales: UNA SkinnedMesh por atleta (piel rígida por hueso, ~10k triángulos, 1 dibujo + 1 sombra), atlas por jugador, brillo de contorno en el shader estándar,
  IK de dos huesos para brazos y piernas, pose objetivo por capas amortiguada, pies sin patinar.
- **Dorsales** (pendiente de foundation): HECHO. Número grande en la espalda y pequeño en el pecho, blanco con filo del color
  oscuro del equipo, pegado a la curva del tronco; se redibuja cuando la UI ha cargado Barlow Condensed (sin peticiones nuevas).
- Peticiones de `notes/sim.md` §5 "players": todas HECHAS y comprobadas con capturas cercanas:
  1. `toss`: flotante = brazo izquierdo sube con el balón, derecho armado atrás (arco), golpe al bajar el balón;
     saque en salto = lanzamiento alto, carrera con brazos atrás, en el aire pose de remate (no de bloqueo).
     Arreglado en esta pasada: mientras el balón del lanzamiento SUBE, `hitWindow().t` es negativo (ya cruzó la altura de contacto
     de subida) y el brazo se soltaba 0,5 s antes de tiempo; ahora se usa el tiempo hasta la bajada.
  2. `dive`: salida rápida hacia el balón (ya lanzado en el contacto), cuerpo horizontal con brazos estirados, tumbado mientras
     `p.down > 0` y se levanta al acabar. Dirección: `dive.dir`.
  3. Dejada (`shot === 'tip'`): brazo extendido arriba con empuje de muñeca, sin latigazo ni giro de tronco.
  4. `grade === 'perfect'` en remate/saque: latigazo más largo y cruzado, más cierre de tronco. `point.how === 'block'`:
     el bloqueador "ruge" (cae, abre los brazos con los puños cerrados, pecho fuera); su compañero celebra a su manera.
- Plancha cosmética: solo si se lee como intento real (`cosmeticDiveOk`): balón dentro a 1,3–2,8 m del defensor más cercano, >= 0,4 s
  desde el último toque, él no lo tocó en los últimos 0,6 s, no se alejaba del balón y el balón está por delante o a un lado (< ~107º).
  Las manos acaban junto al balón (`diveDist = bd - 1,55`). En 12 min de autopilot (3 semillas): 12 cosméticas de 52 balones dentro (+20 de la sim).
- LOD por calidad (ver API). Levantarse de la plancha sin deslizarse y brazo de golpeo que rodea la cabeza (ver log 7-nov).

## API (sin cambios de firma; todo opcional)
- `VB.Players.rigOf(p)` → rig con `root, body, pelvis, chest, head, handL, handR, footL, footR` (Object3D) y `scale`.
- `VB.Players.handWorld(p, right?, out?)` → posición mundial (Three) de la mano derecha (o izquierda con `right === false`).
- `VB.Players.rigs` (array de rigs del partido actual).
- `setQuality(q)`: elige el nivel de detalle de la malla por `q.rank` (alta = como antes ~10,7-11,4k triángulos por atleta; media ~4,8k;
  baja ~3,8k) y el filtrado del atlas. Misma piel y huesos: la geometría de cada nivel se construye una vez (desde la pose de reposo
  guardada) y se cambia `skin.geometry`. Cambio en caliente: ~15-20 ms en el PC la primera vez; el nivel inferior al actual se
  prepara ya en `onGameStart`, así que el paso abajo de la calidad adaptativa no espera a la geometría.
- Campos nuevos del rig (lectura): `offX/offY` (desfase visual de la raíz respecto a la sim tras una plancha, coords de sim; la raíz y
  las partes del cuerpo YA lo incluyen, así que `rigOf`/`handWorld` siguen siendo la verdad visual), `diveUp` (0..1 levantándose).

## Problemas conocidos
- El acompañamiento del remate (~0,05-0,1 s tras el contacto) pasa por delante de la barbilla: visto desde abajo y de frente
  parece cruzar la cara. Es el gesto real (el brazo baja cruzando el cuerpo), se deja.
- Si la sim echa a correr justo al acabar `p.down`, el cuerpo se levanta en ~0,3 s y luego recupera el desfase corriendo
  (velocidad visual <= max(4 m/s, la de la sim)). Se lee bien en tira de fotogramas; un apoyo de mano más marcado sería un extra.

## Peticiones a otros owners
Ninguna pendiente.

## Aplicado (log)
- 6-nov-2026 (Integrate, PC de casa): escenas `toss`, `jumpserve` y `dive` ya están en main.js (`tools/shot.sh toss|jumpserve|dive`).

- 6-nov-2026 (Review 1, fixer players):
  - Coste: medido a `quality=low` en `debug=rally`: 4 mallas de atletas en el pase principal y 4 en sombras (antes 71 + 40).
  - Remate: armado "arco y flecha" real (mano junto a la oreja, codo alto y atrás, tronco girado y arqueado, rodillas atrás),
    latigazo en arco cúbico de ~0,15 s hasta el contacto previsto (antes 0,2 s lineal: se leía como empujón a dos manos),
    contacto con el brazo estirado delante del hombro derecho, izquierda recogida al pecho, acompañamiento en 0,14 s cruzando
    hasta la cadera izquierda. Despegue: los dos brazos vienen estirados de atrás y suben por delante (arco).
  - Bloqueo: comprobado con `debug=block` y `debug=spike`: manos por encima de la cinta (~3,0 m) y 0,15-0,2 m al otro lado de la red.
    En postura de red (espera del ataque rival) el paso lateral ya no baja las manos a la carrera.
  - Comprobación con tira de fotogramas: `tools/out/fix-players/film.js` (reproduce la jugada con la misma semilla y cámara
    relativa al jugador; uso en la cabecera del fichero).

## Aplicado (log, integración tras Review 1)
- main.js `debug=jumpserve`: 145 pasos tras el lanzamiento (antes 105): sacador a ~1 m en el aire, armado, contacto a ~0,12 s
  (150 dejaba el contacto a 0,075 s, ya en pleno latigazo). Comprobado con captura y en node (el balón aún no se ha golpeado).

## Aplicado (log, Review 2, fixer players)
- Recepción de antebrazos (`passPose`): plataforma con brazos RECTOS (manos a un brazo exacto del centro de hombros, calculado con
  `shoulderC`), muñecas juntas, hombros encogidos; la altura se busca con piernas/cadera. Ángulo de plataforma limitado a
  [-49º, -11º] (balón alto: plataforma alta a la altura del pecho con el tronco algo atrás); el acompañamiento sale de las piernas
  (+6º de plataforma como mucho). Nunca manos juntas delante de la cara. 3er toque `free` con `shot:'forearm'` usa también la plataforma.
- Bloqueo: de frente a la red en el aire (giro limitado a ±10º), hombros a las orejas, brazos rectos y paralelos inclinados 20-40º
  hacia el rival según la distancia a la red (se echa hasta 0,5 m hacia la red, solo visual); manos ~0,1-0,25 m al otro lado.
- Remate: armado "arco y flecha" más legible (mano junto a la oreja, codo alto, abierto y atrás). Acompañamiento sin "plegarse":
  pecho <= ~27º, cabeza arriba, brazo cruzando a la cadera izquierda, izquierda recogida. Contacto bajo para el salto: el cuerpo
  visual baja hasta 0,22 m (anticipado con la predicción) para golpear con el brazo estirado en vez de con el codo junto a la cabeza.
- Saque flotante: contacto con el brazo totalmente estirado arriba-delante y muñeca firme, sin acompañamiento (~0,16 s), la
  izquierda cae al costado; el brazo arma en arco por el lado de la cabeza (ya no cruza la cara). Saque en salto: arco y flecha.
- Plancha: en ~0,1-0,2 s el cuerpo va horizontal a 0,25-0,4 m del suelo con los brazos estirados (mano derecha plana delante),
  piernas detrás; cae de pecho y se desliza 0,12 m; luego se levanta como antes.
- Modelo: antebrazos más gruesos (0,05→0,037 m), brazo algo más grueso, mano "manopla" (palma ancha y plana con cápsulas, dedos de
  punta redonda algo abiertos, pulgar marcado). El "cinturón" de la cintura era el pantalón que asomaba por la camiseta (parpadeo):
  bajo de la camiseta algo abierto y cintura del pantalón más estrecha, ribete del bajo fino en tono de la camiseta (sin franja
  oscura de 18 px). Dorsal del pecho más ancho (la curva lo estrechaba). Postura de red: manos a la altura del hombro, delante.
- Comprobado con tiras de fotogramas (`tools/out/fix2-players/film.js`, `LOOKZ=` altura del punto de mira) y primeros planos
  (`tools/out/fix2-players/close.sh`), `console.sh` sin errores en rally/spike/block/dive/jumpserve/toss/point, simtest rápido OK.

## Aplicado (log, integración tras Review 2)
- 6-nov-2026 (integración tras Review 2): reacción a `hit.shot === 'body'` (se encoge, gira el tronco apartándose, manos al pecho; antes salía la pose de
  antebrazos); marcador blanco (petición de arena) y cono oculto en el aire / con el saque lanzado; con `VB.FX.dust` las planchas
  cosméticas (evento `land`) sueltan polvo a los ~0,18 s (`r.cosDust`). `block.result 'touch'` usa el gesto de 'soft'.

## Aplicado (log, 7-nov-2026, pasada de rendimiento móvil, fixer players)
- **LOD por calidad** (`LOD_K = [0,42, 0,62, 1]` sobre los segmentos de cada primitiva, con mínimos por pieza: tronco 16-18 lados,
  cráneo 14×10, hombros 10, extremidades 8; pelo rizado icosaedro de detalle 0 en media/baja). Medido en `debug=rally` 844×390:
  triángulos por atleta alta 10.730-11.442 (sin cambios) / media 4.780-4.944 / baja 3.748-3.944 (antes 10,7k en todas).
  Total de la escena en baja: 335k → 278k con solo este cambio (los atletas pasan de ~88k a ~31k contando la sombra); con lo de
  arena ya en el árbol: **baja 81k triángulos / 45 draw calls, media 189-199k / 47-58** (844×390 y 915×412, táctil, dpr 2,75).
  Cada atleta sigue siendo 1 dibujo + 1 sombra; los 4 materiales (uno por atlas con su dorsal) comparten un único programa.
- **Asignaciones por frame**: `solveIK` recibe vectores en vez de 8 números (cada número calculado que se pasa a una función no
  integrada crea un HeapNumber: 16 llamadas por frame), `toBodyV`, raíz sin `VB.toThree` (asignación directa), `Math.hypot` → `sqrt`
  en los caminos calientes, `faceKeep` siempre numérico (`hasFace`). Muestreo de montón (CDP HeapProfiler, incluidos objetos ya
  recogidos) a 162 fps: bytes atribuidos a players.js 7,1 MB → 4,2 MB en 15 s (applyPose de 2,9 MB a ~0). Lo que queda son
  HeapNumbers de V8 en funciones grandes (no hay `new` en el bucle). JSHeapUsedSize en 30 s de peloteo con CPU ×4: 7,15 → 7,71 MB (plano).
- **Coste de CPU** (CPU ×4, dpr 2,75, táctil): `Players.update` 1,5-1,7 ms de media (p95 3,8-5,3 ms) de un frame de 22-29 ms → los
  atletas son ~7 % del frame. **El objetivo de 55 fps con CPU ×4 NO se cumple en el conjunto**: baja 42,7 fps (844×390), media
  34,2 (844×390) y 44,8 (915×412). El resto del frame no es de players (three.js render/arena/cámara; el muestreo atribuye ~39 MB
  en 20 s a three.min.js y 4 MB a camera.js frente a ~4-9 MB a players.js). Hay tirones sueltos de 0,7-3 s (máx. del frame) que
  conviene que mire ui_main (¿compilación de shaders tras el precalentado?).
- **Levantarse de la plancha sin deslizarse**: el avance del cuerpo en el suelo pasa del cuerpo (`OZ`) a la raíz (`offX/offY`) a medida
  que se levanta, así que se incorpora DONDE cayó; mientras está tumbado o levantándose la raíz no sigue a la sim; si la sim ya lo
  mueve se levanta antes (~0,3 s); luego el desfase se recupera con zancada (la velocidad visual entra en la locomoción) a
  <= max(4 m/s, la de la sim). La ventana de la plancha dura hasta que está de pie (`diveActive`). `serveReady` pone el desfase a 0.
  Traza (`tools/out/players/divetrace.js 7 1 dive`): las manos se quedan en x≈7,0 mientras se levanta aunque la sim ya va por 5,1;
  antes la pelvis volvía 0,27 m (sim) / hasta 1,3 m (cosmética) hacia atrás deslizándose. Tira: `tools/out/players/dive7-sheet.png`.
- **Brazo de golpeo en arco**: contacto como mínimo a 0,15 m a la derecha del eje (antes 0,10: el brazo cruzaba sobre la cabeza),
  puntos de control del latigazo más por fuera (-0,38 / contacto-0,14), y `headClear()` en `applyPose`: en gestos por arriba
  (`r.guard`: remate/saque en salto en el aire, saque, golpe por arriba de pie y su acompañamiento) la mano derecha no entra en un
  cilindro de 0,25 m alrededor de la cabeza (banda de la barbilla a un palmo por encima; se aparta hacia fuera-derecha).
  Tiras `tools/out/players/spkB2-sheet.png` (detrás) y `spkR2-sheet.png` (delante-derecha).
- Primeros planos alta/baja: `tools/out/players/close/{toss,jumpserve,block,dive,point,spike}-{high,low}.png`, `serve-*.png`.
- Comprobado: `node tools/simtest.js 10 12345 0` TODO OK; `tools/console.sh all` 1280×720 y `TOUCH=1 … 844 390` sin errores JS;
  `node tools/drive.js 844 390 25` y `1280 720 30` TODO OK. Medidor: `node tools/out/players/perf.js "<query>" WxH s throttle dpr`.

## Peticiones a otros owners (7-nov)
- ui_main (informativo, sin cambios de código pedidos): con CPU ×4 la escena no llega a 55 fps ni en baja (42,7 fps a 844×390) y los
  atletas solo son ~1,6 ms del frame. Hay frames sueltos de 0,7-3 s durante el peloteo en vivo con CPU ×4 (medido con rAF en
  `perf.js`). `Players.setQuality` ahora cambia geometría: ~15-20 ms la primera vez para un nivel no preparado (el inferior ya
  está preparado desde `onGameStart`).

## Respuesta de ui_main (7-nov-2026, rendimiento)
- Los tirones de 0,7-3 s con CPU ×4 eran: (1) el freno de CPU de DevTools se perdía al navegar (las medidas alternaban entre
  frenadas y sin frenar; `tools/cdp.js` lo vuelve a aplicar tras cada navegación) y (2) cambios de calidad que recompilaban todos
  los materiales (tipo de sombra: arreglado en main.js; número de luces: pedido a arena). Medido ahora (`node tools/perf.js
  844x390 20 auto,medium,low 4`): ver notes/ui_main.md §Rendimiento.
- Asignaciones por frame atribuidas a players.js (`ALLOC=1 node tools/perf.js 844x390 15 medium 1`, KB/s a ~160 fps):
  `predictHit` (~705) → `Sim.hitWindow` 250-390, `computeTarget` (~733) 180, `update` (~1475) 160, `aimHead` (~1206) 87,
  `locomotion` (~467) 71. Opcional: pasar un `out` propio a `hitWindow` y llamarlo menos (p. ej. cada 2-3 frames o solo con el balón
  en tu campo); revisar temporales en `computeTarget`/`aimHead`.

## Aplicado (log, integración de pendientes)
- 7-nov-2026 (integración de pendientes): nada pendiente de código. `predictHit` ya pasa su `out` (`HW`) a `Sim.hitWindow`; lo que queda son números encajonados de V8 (opcional, no aplicado).
  El objetivo de 55 fps con CPU ×4 SÍ se cumple ahora en el conjunto (ver notes/ui_main.md §Rendimiento y la tabla de la integración): las
  medidas de players se hicieron con el freno de CPU que se perdía/reaplicaba al navegar y antes de las fusiones de arena.

## Aplicado (log, 7-nov-2026, verificación 1, fixer players)
- **Remate (latigazo y acompañamiento)**: el brazo se quedaba recto arriba ~0,09 s esperando el balón porque el latigazo iba al
  contacto IDEAL (`hitWindow().t`) y la sim golpea en el REAL: IA cuando `w.t <= -p.aiTe` (saque: `-g.aiServeTe`) o al bajar del
  salto; humano con la pulsación. Nuevo `contactIn(g, p, hw)` estima el contacto real (humano sin pulsar: brazo armado; pulsado:
  espera al ideal). Latigazo de `SWING_T` = 0,12 s con aceleración (a 0,06 s la mano sigue detrás de la cabeza). Seed 7, 1er remate:
  error de la estimación 0,09 s → ~0,015 s. Contacto con el brazo ESTIRADO desde el hombro derecho (`contactHand`: dirección al
  balón limitada a delante-arriba del hombro; si el balón llega tarde golpea más por delante en vez de doblar el codo junto a la
  cabeza). Acompañamiento con curva de salida rápida (0,22 s) hacia la cadera izquierda, codo hacia abajo, izquierda recogida con el
  codo abajo: la mano no vuelve a subir. Tiras: `tools/out/fix3-players/spkSide-sheet.png`, `spkFront-sheet.png`,
  `spk3Side-sheet.png` (semilla 12345, 3er remate), `jsSide-sheet.png` (saque en salto). Script: `tools/out/fix3-players/film.js`.
- **Artefactos de la malla media**: las piezas superpuestas (calcetín, franja, rodillera, pernera y su ribete) tenían otro número
  de lados que la extremidad de debajo (p. ej. media: pierna 9, calcetín 8) y casi sin holgura: los vértices de la piel asomaban
  entre las caras planas (dientes de sierra). Ahora mismos lados (14 → mismo LOD y misma fase) y >= 3-4 mm de holgura sobre el
  perfil; manga algo más ancha (la piel asomaba entre manga y ribete en media/baja). Rodillera con piel a dos huesos (la mitad de
  arriba sigue un 50 % al muslo: `Geo.bone2/w2`, `kneeW`), sin el muslo asomando al doblar. Primeros planos:
  `tools/out/fix3-players/close/m-ace4.png`, `m-pt5.png` (alta/media/baja) con `close.js`.
- **Detalle por tamaño en pantalla** (`screenLod`): un atleta en el encuadre que ocupa > 58 % del alto (baja de 50 %) usa la malla
  completa en media/baja (puntos, aces, celebraciones). En peloteo en 3ª persona el más cercano ocupa <= ~0,55 → no cambia el coste
  del juego (rally baja: 81.330 triángulos, igual). La malla alta se prepara en `onGameStart` (nada se construye en mitad de la jugada).
  Medido (baja): ace 84k (1 atleta en alta), punto 95k.
- **Levantarse de la plancha**: duración fija de 0,5 s (`GET_T`) desde que empieza (antes el inicio se adelantaba frame a frame con
  `upBoost` y se incorporaba en ~0,25 s): flexión con los brazos (pecho arriba, manos bajo los hombros) → rodilla izquierda delante con
  la derecha apoyada y mano en la rodilla → de pie (pose base). Traza (seq.js dive1 semilla 7): cabeza 0,14 → 1,42 m entre t+0,90 y
  t+1,38; la pelvis no se desliza. Tira: `tools/out/fix3-players/dive1c-sheet.png`.
- Comprobado: `node tools/simtest.js` completo TODO OK; `console.sh all` 1280×720 y `TOUCH=1 … 844 390` sin errores JS;
  `node tools/drive.js 1280 720 30` TODO OK.

## Aplicado (log, integración ronda 1 de verificación, 7-nov-2026)
- Nada pendiente de código. CONTRACT §4.4: campos de solo lectura del rig (`lodFrac`, `lodBig`, `upT0`, `upDiveT`) y la malla alta por tamaño en pantalla.
  Capturas de las 19 escenas en alta y baja (1280×720) y táctil 844×390 miradas tras la integración: remate, plancha (dive), ace y punto bien.

## Aplicado (log, integración ronda 2 de verificación, 7-nov-2026)
- Petición de camera_input (deprecaciones de mapa en `onEvent`/`update`/`aimHead`/`diveOffset`/`locomotion`): aplicada con `dblFields(r)` al final de
  `buildRig` (los `-99` de los tiempos y los `0` de yaw/vf/fase… pasan por un double al crear el rig) y `Pose` (`ra/rb`). Antes, el primer bloqueo de la
  partida (`r.blockT = tm`) deprecaba ~46 mapas del rig y desoptimizaba 42 funciones de todos los módulos a la vez (t = 67 s en el log); ahora el rig no
  depreca nada durante el juego. Sin cambios de comportamiento (mismos valores).
- Comprobado: console.sh all (1280×720 y táctil 844×390) sin errores; drive.js, touchplay.js, padplay.js TODO OK; capturas de remate, plancha, ace y punto bien.

## Petición de camera_input (pulido ola 1, CAM-02 ↔ PLY-07/PLY-14): que el que anota se gire para celebrar, y `faceOf(p)` (2026-11-07)
**Qué.** El plano de reacción ya es del que anota (camera.js `planHero`): cámara baja en SU campo, en tres cuartos de frente. Medido
(`tools/out/camtest/heroprobe.js`, autopilot): 0,45 s después del punto los rematadores siguen a 1,5-1,9 m de la red MIRANDO A LA RED
(`rig.yaw` ~140-175° en el equipo 0, ~0° en el 1) y el compañero a 4-6 m, así que `mateHF` (< 3,2 m) casi nunca se cumple y no se giran.
Desde su propio campo, una cámara a 6-7 m de un jugador de cara a la red queda a ~95° de su frente (de perfil); en 3/4 de frente habría que
ponerla al otro lado de la red (malla delante). camtest `hero` falla solo por eso en el 30-60 % de los remates.
**Pedido.**
1. ~~PLY-07: que el que anotó se gire hacia su compañero y converjan~~ — HECHO por players en esta misma ola. La cámara ya usa la posición
   VISUAL (`p + rig.offX/offY`) y prevé el punto de encuentro (el héroe ≤ 1,2 m si es `g.lastPlayer`; si no, a medio camino). Medido: el frente
   del héroe queda a 6-70° de la cámara en la mayoría de los puntos (antes ~95°). Consecuencia de geometría (informativo): cara a cara a 0,85 m,
   el compañero solo queda más lejos que el héroe con la cámara a >= ~68° por la derecha del héroe, así que en el plano de dos salen del mismo
   tamaño (±5 %). Si se quisiera que el que anota destaque más, opción de players: que el compañero llegue algo por DETRÁS del héroe (hacia el
   fondo de su campo) en vez de enfrente.
2. Función opcional (la cámara ya la usa con guarda si existe; si no, lee `rig.yaw`):
   ```js
   /** Frente (rad, coords de sim, como rig.yaw) hacia el que mirará el jugador durante la celebración en curso (el objetivo del giro, no el actual). */
   faceOf: function (p) { var r = this.rigOf(p); if (!r) return NaN; return (r.celebYaw != null && ctx.game && (ctx.game.mode === 'point' || ctx.game.mode === 'over')) ? r.celebYaw : r.yaw; }
   ```
   (`r.celebYaw` = el `desiredYaw` de la celebración: hacia el compañero en el choque de manos, hacia la grada en el rugido…). Así el plano, que se
   decide en el instante del corte (0,45 s), ya encuadra el frente que tendrá durante el resto de la celebración.

## Pulido ola 1 (7-nov-2026, players) — PLY-01…PLY-07

Solo `js/players.js`. Herramientas de medida en `tools/out/ply1/` (`m.js` métricas extendidas sobre `audit-animation/metrics.js`,
`fclass.js`/`ftrace.js` pies, `film.js` tiras con `CAMFIX=1|yaw|dive`, `LOOKF`, `CROPW`, `crop.js` recorte ampliado, `bench.js` coste de
`Players.update` frente a `players.orig.js`).

### Lo nuevo
- **Pies bloqueados (PLY-02)**: el pie de apoyo queda fijo en el MUNDO (`footLock`, tras `dampPose`) y entra a la IK como objetivo en el
  espacio del cuerpo; también va bloqueado en el despegue (w < 0,1) y en la llegada (w > 0,86), con la altura del ciclo. Vuelo con
  tangentes de Hermite a la velocidad del suelo. Carrera: apoyo 0,32, 3,2-3,6 pasos/s por encima de 4 m/s, excursión limitada por el
  alcance real de la pierna. **Caderas que giran hacia donde corre** (`r.hipYaw`, ±0,75 rad; el pecho compensa y sigue mirando al balón):
  en diagonal no se cruzan las piernas. Primer paso al arrancar (la sim sale a toda velocidad): el pie se planta donde estaba. Capas de
  gesto con `layerG` (brazos enteros, pies solo en lo que no corre) y `layerF` (todo). Al parar, el pie que no está en su sitio da un
  pasito (se levanta) en vez de arrastrarse. Pierna al límite: la cadera baja hasta 9 cm antes de soltar el pie.
- **Anclaje de contacto (PLY-01)**: `anchorSource` (computeTarget) deja en el rig la fuente en coords de la sim: balón previsto en el
  contacto REAL (`contactIn`, últimos 0,14 s, curva suave) o el contacto ocurrido (peso 1 durante 0,03 s, se suelta en 0,13-0,2 s).
  `applyPose` lo resuelve contra los hombros reales: palm/tip (palma en la superficie del balón detrás de él en la dirección del golpe),
  plat (antebrazos 0,12 m por encima de las muñecas, plano girado hacia el destino), set (ventana de dedos del lado de los hombros), dive,
  hold (palma bajo el balón del saque) y pt (puntos dados: choques de manos). Corrección de cuerpo solo en ese frame: inclinación de la pelvis
  (0,25-0,4 m según el modo), rodillas para lo bajo y, en golpes por arriba, puntillas y saltito (`aUp`). La IK se resuelve primero a la
  muñeca y el objetivo final es esa muñeca + PALM en la dirección real del antebrazo (exacto con el codo doblado). Golpes por arriba con el
  balón bajando: se apunta 35 ms por delante en la trayectoria (la mano nunca baja antes de golpear). Si el contacto llega tarde sobre lo
  previsto (hasta 0,15 s), el anclaje se mantiene en el balón.
- **Colocación en salto** (visual, `jumpSetHop`): balón de colocación por encima del alcance de pie, parábola que culmina en el contacto.
- **Saque flotante (PLY-03)**: balón en la palma izquierda (anclaje hold; el punto se calcula con `VB.Sim._holdPos`, porque en el frame de
  `serveReady` la sim aún no ha movido el balón), derecha relajada lejos del balón; la IA flexiona antes de lanzar; la palma acompaña el
  lanzamiento y el brazo queda estirado señalando el balón; codo derecho por encima del hombro con la mano junto a la oreja; paso corto
  del pie izquierdo (~0,3 m) con la cadera que rota; puntillas en los últimos 0,3 s (`svH`); mano que sube sin bajar hasta el contacto;
  puñetazo corto y posición de defensa con las dos manos delante (la izquierda recogida delante del pecho con el codo abajo).
- **Plancha (PLY-04)**: `predictDive` repite las condiciones de ai.js sobre balón y jugador extrapolados (hasta 0,2 s); el impulso empieza
  hasta 0,15 s antes del contacto (`r.pdW`), así que en el contacto va estirado un 70-80 % con las manos bajo el balón. Tiempos relativos
  al contacto (`r.diveTc`), raíz quieta desde el contacto, deslizamiento de pecho de 0,38 m que frena, cadera algo girada, pecho y cabeza
  levantados mirando el balón (la cara gira alrededor de la columna, medida desde la CABEZA), se levanta 0,35 s antes de que la sim lo suelte
  (`GET_T` 0,45 s).
- **Indicador del controlado (PLY-05)**: galón plano naranja (#ff7a3d, lineal ×0,78: por debajo del umbral del bloom) con filo oscuro, una
  geometría con color por vértice (1 dibujo, como el cono), de cara a la cámara, tamaño constante en pantalla, justo encima de la cabeza
  REAL; se apaga a menos de ~6 m de la cámara, con el saque propio y en el aire.
- **Equipación CPU (PLY-06)**: azul real (#3363ea) con canesú y paneles blancos, pantalón casi negro, acentos #bcd8ff (c1 de la UI).
- **Convergencia tras el punto (PLY-07)**: ver API `drainFx`. El que hizo el punto se mueve como mucho 1,2 m (plano de héroe) y el compañero
  hasta 4 m; llegan a la vez, contacto alternando choque arriba / choque abajo / puños (suma del marcador % 3), palmada en el hombro y vuelta
  a trote (hasta 3 m/s; si se acaba la pausa del punto, lo que falte lo absorbe la recolocación de la sim en `serveReady`, donde el desfase
  es 0). La pareja que pierde, si está a menos de 4 m: el compañero del que cometió la falta da dos palmadas de ánimo. En `serveReady` todas
  las poses se colocan sin muelle (la sim recoloca a todos en ese instante).
- Brazos relajados (postura 0) colgando rectos con los codos algo atrás (antes se leían «en jarras»).

### API nueva (opcional)
- `VB.Players.drainFx(out)` añade a `out` los contactos cosméticos desde la última llamada:
  `{type:'highfive'|'fistbump'|'chestbump'|'clap', team, x, y, z (coords de la sim), strength 0..1}` (un evento por contacto; `chestbump`
  reservado para PLY-15). Sin llamadas, la cola se limita a 32.
- `VB.Players._marker()` (pruebas): `{visible, opacity, y, scale, calls}` del galón.
- Campos de solo lectura del rig: `aMode/aw0/aw1` (anclaje del frame), `hipYaw`, `fk[0..1].lock`, `pdW` (plancha prevista), `diveTc`,
  `vh` (subida visual: colocación en salto / puntillas del saque). `offX/offY` incluye ahora también la convergencia del punto.

### Medido (ejecutado)
- `m.js 240 7 normal` y `240 99 hard` (gapWin; columna «superficie» = distancia de la muñeca a la SUPERFICIE real del balón, radio
  `VB.C.BR` = 0,21): saque flotante 0,031/0,032 (mediana) · remate 0,024/0,034 · colocación −0,04 (muñecas bajo el balón) · dejada
  0,043/0,054 · saque en salto 0,032/0,028 · antebrazos 0,061/0,074 · defensa 0,061/0,056 · plancha 0,019/0,025; p90 hasta 0,08 en todos.
  **Ojo**: `metrics.js` resta 0,105 (balón reglamentario), pero el balón del juego es de 0,21 m de radio (`C.BR`, «exagerado para
  legibilidad»): con las manos en la superficie real esa columna marca ~0,13-0,17 (ver «Problemas conocidos»).
- Pies (`audit-animation/foottrace.js`): 1-2 m/s 0,04 m/s · 2-3,5 m/s 0,04 · 3,5+ 0,02 (antes 1,08 / 1,96 / 2,46); por encima de 0,5 m/s
  2 % / 2 % / 0 % (antes 86 / 85 / 85 %). `slide.pctBadMoving` 0,7 % / 1,2 % (antes 84 / 85 %).
- Saque: palma bajo el balón, 0,226-0,239 m de la muñeca al centro (radio 0,21) en todos los frames; antebrazo derecho a 0,58 m o más del
  balón; paso del pie izquierdo 0,31 m; manos a 0,36 m o más de la cadera de +0,05 a +0,5 s; altura de la mano 1,96 a 2,54 m sin bajar.
- Plancha (semilla 7, 1.ª): tronco 60º en el contacto; cabeza 0,25-0,63 m sobre el suelo y a 41-44º del balón de +0,35 a +0,8 s;
  de pie (cabeza por encima de 1,3 m) 0,82 s después de apoyar el pecho.
- Convergencia: 19/19 (semilla 7) y 19/20 (semilla 99) puntos con manos de la pareja a 0,12 m o menos entre 0,3 y 1,6 s; 1 evento por punto.
- Galón: 1920×1080 alta, relleno RGB 208,125,68 (tono 24º, objetivo 19º), luma máxima 204; no aparece en saque ni en punto de set.
- Equipación CPU: peloteo 1920×1080, cuerpo luma 72 frente a 117 del fondo (Δ45) y tono 223º frente a 192º (Δ31º); 844×390 baja Δ68-71.
- Coste: `bench.js` (CPU ×4) `Players.update` 0,40 ms/frame (antes 0,28). `perf.js 844x390 20 medium,low 4 2.75`: media 89,6 fps, baja
  99,3, draw 48-51 / 34-38, triángulos 203 k / 84 k, «objetivos cumplidos».
- `console.sh all` 1280×720 y `TOUCH=1 … 844 390` sin errores; `simtest.js 10 12345 0` TODO OK.

### Problemas conocidos
- **Radio del balón**: los criterios de PLY-01/PLY-03 en `metrics.js` (−0,105) y `hbd ≤ 0,12` suponen un balón de 0,105 m; el del juego es
  de 0,21. Con la mano en la superficie real la muñeca queda a ~0,23 m del centro. Meter la mano hasta la mitad del balón cumpliría el número
  pero se ve mal en primeros planos; se ha elegido la superficie real. Si se quiere el criterio literal, cambiar la resta a `VB.C.BR`.
- Plancha con el balón ya casi detrás del que se lanza (p. ej. semilla 7, 2.ª): la cabeza gira hasta ~110º, pero queda a ~55º del balón.
- Pausa del punto (1,9 s normal): en convergencias largas el compañero no tiene tiempo de volver a trote; el resto lo absorbe la
  recolocación de la sim en `serveReady` (que mueve a todos a la formación de saque en ese mismo instante).

### Peticiones a otros owners (ola 1)
- audio (AUD-05): consumir `VB.Players.drainFx` (ver notes/audio.md).
- ui_main: CONTRACT §4.4 añade `VB.Players.drainFx(out)` y `_marker()`; propuesta de cableado en notes/ui_main.md.
- camera_input: durante 'point' la posición VISUAL de los jugadores (`rigOf(p).root.position`) se separa de la sim hasta 4 m (compañero que
  va al que hizo el punto); ver notes/camera_input.md.
- sim (informativo, opcional): ver notes/sim.md.

## Petición de camera_input (pulido ola 1, CAM-02): coreografía del plano de héroe dictada por la cámara (2026-11-08) — PARCHE PROBADO
**Qué.** Que la convergencia del choque de manos (PLY-07) siga la coreografía que publica la cámara con `VB.CameraRig.heroShot()`:
el que anota se queda en su sitio y se gira hacia la cámara (abierto ~35° hacia su compañero); el compañero va a un sitio que la
cámara elige a su lado y algo DETRÁS (0,8 m más lejos de la cámara y 0,9 m de lado, hacia el centro del cuadro), abierto también a la
cámara; justo en el choque (de −0,28 a +0,22 s) se miran; luego vuelven a la cámara. Si el compañero está demasiado lejos (> 4,4 m de su
sitio) o no cabe, `conv:false`: el héroe celebra solo de cara a la cámara y no hay choque ni sonido de palmada.
**Por qué.** Con la convergencia actual (cara a cara a 0,85 m, el héroe mirando al compañero) las dos condiciones de CAM-02 («el que anota,
la figura más grande» y «la cámara a ≤ 70° de su frente») son geométricamente incompatibles: desde cualquier sitio que le vea la cara al
héroe, el compañero queda igual de grande o más (medido: 2/36 planos bien; el compañero cruza delante del objetivo al 61 % del alto).
Con el parche, medido con `tools/camtest.js` (PAGE_ROOT = copia parcheada): 70/73 planos bien con la CPU normal (≥ 94 % en cada tamaño:
1280×720, 1680×720, 1024×768, 844×390 táctil) y 37/40 con la CPU experta; héroe a 35° de la cámara, compañero ≤ 0,87 de su altura.
Capturas: `tools/out/cam02/shots/` (`node tools/out/cam02/heroshots.js <semilla> <WxH[t]> <s> tools/out/cam02/proj`).
**Contrato.** `heroShot()` → `null` o `{heroId, mateId, team, camX, camY, hx, hy, heroYaw, conv, mx, my, mateYaw, t}` (coords de sim, rad
como `rig.yaw`; objeto reutilizado: no modificar). Solo existe en `g.mode === 'point'`; el plan se hace en el frame del punto, así que en
`cvStart` (≥ 0,12 s después) ya está. La cámara solo cambia de comportamiento si `VB.Players.heroShotAware === true` (sin el parche
sigue con la convergencia de ahora y no rompe nada).
**Parche exacto** (aplicado y probado sobre la copia que genera `node tools/out/cam02/mkproj.js`; diff completo en
`tools/out/cam02/players.patch`):
```diff
@@ function cvNew()
-    rax: 0, ray: 0, rbx: 0, rby: 0, rStart: false, d0: 0 }); }
+    rax: 0, ray: 0, rbx: 0, rby: 0, rStart: false, d0: 0, hs: false, solo: false, hero: 0, hyaw: 0.5, myaw: 0.5 }); }
@@ function cvStart(g, c, won)  (justo después de la línea `var ax = A.x + ra.offX, ... D = Math.sqrt(dx * dx + dy * dy);`)
+    // ACUERDO CON LA CÁMARA (CAM-02): el plano de héroe dice dónde está la cámara, hacia dónde mira el héroe y adónde va el compañero
+    var hs = VB.CameraRig && VB.CameraRig.heroShot ? VB.CameraRig.heroShot() : null;
+    c.hs = false; c.solo = false;
+    if (hs && hs.team === won && (hs.heroId === A.id || hs.heroId === B.id)) {
+      var hA = hs.heroId === A.id, mX0 = hA ? bx : ax, mY0 = hA ? by : ay;
+      var mTx = hs.conv ? hs.mx : mX0, mTy = hs.conv ? hs.my : mY0, wm = Math.sqrt((mTx - mX0) * (mTx - mX0) + (mTy - mY0) * (mTy - mY0));
+      c.hs = true; c.solo = !hs.conv; c.hyaw = hs.heroYaw; c.myaw = hs.mateYaw; c.scorer = hs.heroId; c.hero = hA ? 0 : 1;
+      c.a0x = ax; c.a0y = ay; c.b0x = bx; c.b0y = by;
+      if (hA) { c.ax = ax; c.ay = ay; c.bx = mTx; c.by = mTy; c.twa = 0.3; c.twb = Math.max(0.3, wm / CV_WALK); }
+      else { c.bx = bx; c.by = by; c.ax = mTx; c.ay = mTy; c.twb = 0.3; c.twa = Math.max(0.3, wm / CV_WALK); }
+      var Th = Math.max(c.twa, c.twb); c.da = Th - c.twa; c.db = Th - c.twb;
+      c.ts = tm; c.tc = tm + 0.14 + Th + 0.16; c.tr = c.tc + 0.46;
+      var sch = (ra.scale + rb.scale) * 0.5;
+      c.mx = (c.ax + c.bx) * 0.5; c.my = (c.ay + c.by) * 0.5; c.mz = (c.type === 0 ? 2.02 : c.type === 1 ? 0.98 : 1.32) * sch;
+      return;
+    }
@@ function cvPose(g, r, P)
-    if (!c.on || c.ts < 0) return false;
+    if (!c.on || c.ts < 0 || c.solo) return false;
@@ function cvEmit(g, dt)
-      if (c.on && c.ts >= 0 && !c.emitted && g.time >= c.tc) {
+      if (c.on && c.ts >= 0 && !c.emitted && !c.solo && g.time >= c.tc) {
@@ function cvYaw(g, r)  (justo después de `if (!c.on || c.ts < 0) return NaN;`)
+    if (c.hs && g.time < c.tr + 0.05) {
+      var mh = byId[g.teams[r.team][A ? 1 : 0].id], dtc = g.time - c.tc, isH = (A ? 0 : 1) === c.hero;
+      var toM = mh ? Math.atan2(mh.p.y + mh.offY - p.y - r.offY, mh.p.x + mh.offX - p.x - r.offX) : NaN;
+      var hf = !c.solo && dtc > -0.28 && dtc < 0.22 && toM === toM;   // el choque de manos: cara a cara un instante
+      if (isH) return hf ? toM : c.hyaw;
+      var tx = A ? c.ax : c.bx, ty = A ? c.ay : c.by, ex = tx - p.x - r.offX, ey = ty - p.y - r.offY;
+      if (!c.solo && ex * ex + ey * ey > 0.12) return Math.atan2(ey, ex);
+      return hf ? toM : c.myaw;
+    }
@@ VB.Players = {
     rigs: rigs,
+    /** La convergencia sigue la coreografía de VB.CameraRig.heroShot() (CAM-02). */
+    heroShotAware: true,
```
Libre para players (PLY-14): la pose del héroe mientras mira a la cámara (puño, rugido, brazos arriba) y el gesto del choque lateral; la
cámara solo necesita el SITIO y el FRENTE de los dos. Si se cambia `HS_BACK/HS_LAT` (camera.js), el compañero sigue ≤ 0,9 de la altura del héroe.

## Aplicado (log, integración del pulido ola 1, 8-nov-2026, PC de casa)
- Parche CAM-02 de camera_input aplicado tal cual (`heroShotAware: true`, `cvStart`/`cvPose`/`cvEmit`/`cvYaw` según `CameraRig.heroShot()`).
  camtest completo en el proyecto real → TODO OK; héroe 18/18 (1280×720, 1680×720, 1024×768) y 17/18 (844×390 táctil).
- Petición de arena (PLY-05): el halo del controlado se encoge (×0,62) y se atenúa (×0,45) cuando el aro amarillo (`focusPoint`, mismas
  condiciones que fx.js) está a < 0,9-2,4 m de sus pies; además sigue los pies VISUALES (`offX/offY`).
- Integración (pulido): con el balón muerto (`'point'`/`'over'`) el halo se funde al 25 % (como los controles táctiles, CAM-07) y el galón
  se apaga: el plano de héroe queda limpio. `markerDim` (estado del módulo).
- `drainFx`: lo vacía main.js tras `Players.update` y lo reparte como eventos `fx:*` (audio suena palmada/puños).

## Pulido ola 2 (fixer players, 8-nov-2026): colocación con los dos pies plantados
- `layerG(P, T, w, plant)` acepta un peso `plant` (0-1) que quita los pies al ciclo de locomoción aunque el jugador se mueva.
- Colocación: el pie en el aire aterriza con un pasito entre 0,4 y 0,18 s antes del contacto (`plant = sstep(0.4, 0.18, ht)`) y los dos pies
  siguen plantados hasta 0,12 s después del toque, fundiéndose a 0,3 s (`SET_PLANT = 1`). El ancla de la colocación sube como mucho
  `SET_UP = 0,12` m (puntillas; antes 0,3, un saltito sin salto). Las colocaciones en salto siguen con `jumpSetHop`.
- Capturas: `tools/out/ply-setfeet/` (switch-old/now, fin-set1/3/5-sheet). PLY-01 (gapWin de saque/remate/dejada) y PLY-02 (foottrace) siguen parciales.

## Aplicado (log, integración del pulido ola 2, 8-nov-2026, PC de casa)
- Pedido de camera_input (CAM-02, de espaldas a los ~1,2 s del punto): aplicado tal cual en `cvYaw`, justo antes de
  `if (c.hs && g.time < c.tr + 0.05)`: el que anota sigue de cara a `c.hyaw` mientras `g.mode === 'point'` y quedan > 0,3 s de pausa.
  El rugido del bloqueador hacia la red (opcional) NO se ha tocado.
- Nota de la colocación con los dos pies (arriba) añadida por el integrador a partir del informe del fixer.

## De audio (pulido ola 2, AUD-05, 8-nov-2026): contactos de celebración
- audio.js ya suena los cuatro `fx:*` de `drainFx` con un sonido propio cada uno y SIEMPRE uno por evento (sin anti-repetición: dos parejas
  a la vez son dos sonidos), en la posición `x, y` del evento y con la ganancia por `strength` (0..1):
  `highfive` → choque de manos (`slap`), `fistbump` → puños (`fist`, ahora con «toc» de nudillos que se oye en el altavoz del móvil),
  `chestbump` → choque de pecho (`chest`: golpe de tórax + ropa + las manos que se agarran a los hombros 25-40 ms después),
  `clap` → palmada de ánimo de UNA persona (`handclap`: manos ahuecadas, distinta del choque). Medido: en una partida real (index.html) los
  `fx:*` que reparte main.js = los que suenan; en 240 s de partido con contactos 48/48; 12 en un mismo frame → 12 sonidos.
- **PLY-15 (choque de pecho)**: con emitir `{type:'chestbump', team, x, y, z, strength}` en el instante del contacto basta; `strength` 1 = choque
  a tope (si lo hay más flojo, 0,6-0,8). El sonido ya incluye el agarre de las manos: no hace falta un `highfive` aparte en el mismo choque.
- **Opcional, PLY-16 (ritual de saque de la CPU)**: la sim ya emite `dribble` en cada bote y suena. Si la mano que RECOGE el balón al final de
  cada bote es visible, podéis emitir `{type:'catch', team, x, y, z, strength:0.6}` por `drainFx` en ese instante y audio sonará una palmada
  blanda de recogida (`fx:catch`, ya implementado). Si no se emite, no pasa nada.

## De sim (pulido ola 2, SIM-04, 8-nov-2026): ritual del sacador CPU — datos para PLY-16
Ya en sim.js (detalle y texto de contrato en notes/sim.md §P2). Nada se rompe sin cambios en players.js: la palma izquierda (anclaje
`'hold'`) sigue a `VB.Sim._holdPos(g, p)`, que ahora es el punto de la MANO durante el ritual: lleva el balón en `'wait'/'pre'/'post'/'done'`
y en `'dribble'` se aparta 0,30 m a la izquierda del sacador (a ~0,95 m) mientras el balón bota delante, y vuelve a por él al final de cada
bote. Capturas del estado actual: `tools/out/sim-w2/front0/*.png` (se ve natural de lejos; de cerca la palma va DEBAJO del balón, no encima).
Lo que falta para PLY-16 (todo de solo lectura en `g.ritual`, mientras `g.ritual.on && g.ritual.player === p`):
- `phase` `'wait'|'pre'|'dribble'|'post'|'done'`; `t` (s desde el silbato); `bounces`, `n` (botes hechos), `u` (0..1 del bote en curso);
  `td/cyc` = fracción del bote en la que el balón toca el suelo (bajada empujada `td` s, 17 ms en el suelo, subida `tu` s); `rx, ry` punto
  del bote (sim); `vi` velocidad contra el suelo; `press` (punto de set/partido: bota uno más); `dur`; `g.cpuTossIn` = s hasta el lanzamiento.
- Mano que empuja por ARRIBA: en `u` ∈ [0, ~0,15] la palma sobre la parte alta del balón (`ball.z + BR`) acompañándolo hacia abajo; en
  `u` ∈ [~0,8, 1] la palma baja a recibirlo por arriba (amortigua). `VB.Sim.ritualAt(g, t, out)` da el balón en cualquier instante del ritual
  sin tocar nada (para anticipar la mano 2-3 frames).
- Rodillas: flexión al empujar (u≈0-0,3) y estirar al recoger; tronco algo inclinado durante `'dribble'`; mirada al campo rival en `'done'`.
- Evento `dribble {player, team, x, y, n, of, speed, last}` en el paso del contacto (opcional: `fx:catch` al recoger, ya suena en audio).

## Pulido ola 2 (8-nov-2026, players) — PLY-08…PLY-15

Solo `js/players.js`. Herramientas en `tools/out/ply2/`: `m2.js` (+`m2.page.js`: métricas de la ola 2 sobre partido autopilot:
giro, deslizamiento de pies, carrera hacia atrás, aterrizajes, split-step, carrera de ataque, piernas en el aire, colocación,
acompañamientos, variantes de celebración), `mw.js` (fin de partido), `film.js` (tiras; `ABS=1` cámara fija lateral hacia el centro
de la pista, `HIDE=1` oculta a los demás, `FWD/DIST/CH/LOOKZ`, `AT=` + pred `at`), `apstat.js`/`apspd.js` (carrera de la sim en node),
`bench.js` (coste frente a `players.orig.js` = estado al empezar la ola), `pp.py` (parches exactos con LF).

### Lo nuevo
- **Giro (PLY-13)**: `turnSpring`: muelle angular crítico con límites: 9 rad/s de pie (hasta 11,9 a la carrera), 4 en el aire, 22 en el
  impulso de la plancha, aceleración limitada. La cabeza se adelanta ~0,08 s al giro. **Apoyo de pie** (`standFeet`): parado, cada pie
  queda fijo en el mundo; si la postura se separa (> 0,13 m o > 35º, o la pierna se estira) da un paso corto (uno a la vez; el otro pivota
  sobre la punta). Girar en el sitio ya no activa la carrera. Capas con pasos propios (saque, plancha) marcan `FEX` y quedan fuera.
  En carrera, el pie de apoyo bloqueado tiene peso completo (`1 - FEX·(1-own)`): al frenar no patina.
- **Aterrizaje (PLY-11)**: las rodillas se doblan desde el tiempo previsto de contacto (`landPrep`, 0,18 s antes), pico ~0,08 s tras
  apoyar, rebote de recuperación; se mantiene aunque empiece la celebración. Carrera rápida alejándose del balón (> 2,2 m/s, > 90º):
  el cuerpo gira hacia donde corre (60º hacia el balón) y la cabeza mira atrás. Tras una plancha, ya de pie, el giro queda libre.
- **Split-step (PLY-12)**: `splitStep`: saltito de 5 cm que aterriza a +0,08 s del saque/ataque rival (contacto previsto publicado por el
  atacante en `TEAM_TC`), pies 10 cm más abiertos, brazos delante; sin previsión, sale en el golpe. Esperas del saque: balanceo de pelvis
  ±3º con periodo propio por jugador.
- **Carrera de ataque (PLY-08)**: `approachTime/approachFeet/approachPose/approachOffset`. Despegue previsto (IA: regla de ai.js,
  error medido ~15 ms; humano: `hitWindow().jumpT`; saque en salto: `g.jumpAt`). Tres apoyos fijos en el mundo (izquierda, DERECHA larga
  con talón, cierre izquierda girada), brazos atrás en el penúltimo, tronco ~36º, rodillas abajo ~0,25 m en el cierre, brazos delante y
  arriba al despegar. **Desfase visual de la IA**: la sim llega al sitio a 5 m/s y espera parada; el cuerpo recorre ese camino con perfil
  de carrera (`apProf`) que termina justo en el despegue (`offX/offY`, hasta ~2,5 m durante ≤ 1 s; 0 en el despegue). El humano no lleva
  desfase (se mueve él).
- **Piernas en el aire (PLY-10)**: estela al despegar, rodillas más atrás en el arco y flecha, "navaja" de cadera (~45-50º) en el latigazo,
  se deshace hacia abajo con la izquierda delante para caer. Igual en el saque en salto.
- **Colocación y acompañamientos (PLY-09)**: `setPose2` por tiempos (ventana en la frente con codos a ~87º desde t-0,35, amortigua en
  0,06 s, brazos y piernas se estiran a la vez hacia la salida del balón, se asienta con rebote). Recepción: la plataforma sube con las
  piernas y los brazos se separan y bajan a preparado en 0,18 s. Anclaje de colocación más tardío (0,075 s) y suelta rápida.
- **Celebraciones (PLY-14)**: tres tiempos (reacción 0-0,42 s → gesto social → recuperación aplaudiendo). Variantes (`r.celV`/`r.celId`):
  vamos, vArms, kill (señala al colocador si no hay choque), mateCheer, ace (puño a la grada), roar, bigV (set), comeback (punto de set
  salvado o racha ≥ 4), tiredWin/tiredLose (peloteo ≥ 10 toques: manos en las rodillas resoplando a 2 Hz), headHands, shake, lookSpot,
  lookAntenna (mira la antena), clapUp (el que da ánimos). Nunca la misma variante dos puntos seguidos para el mismo jugador. Mirada
  por tiempo (`r.lk*`: compañero, grada, bote, antena). El héroe del plano sigue con su gesto mientras llega el compañero.
- **Fin de partido (PLY-15)**: la pareja ganadora corre con los puños arriba, choque de pecho (o de las dos manos, alterna) con evento
  `fx:chestbump`/`fx:highfive`, y saltos con los brazos arriba toda la pausa (no vuelven). Los que pierden: uno de rodillas con la mano en
  la frente, el otro agachado con las manos en la cabeza.
- API: `VB.Players.faceOf(p)` (la que pedía camera_input): frente objetivo de la celebración en el punto; si no, `rig.yaw`.

### Medido (ejecutado; `m2.js 240 7 normal` / `240 99 hard`)
- Giro: yawPop 0 / 0 (frames > 14 rad/s fuera de saques y planchas; antes 372), yawMax 11,9 rad/s; pies en giros parados 0,009 / 0,010 m/s
  (antes 0,29); deslizamiento general 0,27 % / 0,30 % (antes 3,6 %).
- Carrera hacia atrás > 3,5 m/s: 8,2 % / 9,4 % (antes 31,7 %).
- Aterrizajes bloqueo/remate: flexión en el primer frame en el suelo mín. 39º / 41º (mediana 51º), pico en 0,12 s p10 58º.
- Split-step: 100 % / 100 % de los saques y remates rivales (cada jugador del equipo que recibe, > 3 cm de vuelo).
- Carrera de ataque: 3 apoyos (mediana), manos 0,26 m por detrás de la cadera, tronco 36º, pies 0,006 m/s en el último segundo.
  Saque en salto: 3 apoyos, tronco 37º. Tiras: `tools/out/ply2/app7-sheet.png`, `js7-sheet.png`.
- Piernas en el aire: cambio de flexión de cadera t-0,15 → t+0,05 mediana 48º / 55º (p10 33 / 45); pies bajo la pelvis en la bajada 0,04 m.
  Tira: `air7-sheet.png`.
- Colocación: codo 86º / 88º a t-0,1 y 176º / 171º a t+0,1 (p10 148 / 152); gapWin set p90 0,084 / 0,072. Acompañamientos a +0,35 s:
  recepción 27/28 y 28/28, colocación 35/35 y 34/34 (manos bajas y separadas ≥ 0,25 m).
- Celebraciones (300 s por semilla, 44 puntos): 0 repeticiones seguidas, 11-12 variantes distintas. Tira `pt7-sheet.png`.
- Fin de partido (`mw.js 7`, `99 hard`): pareja a 0,6 m a 1,25 s, `chestbump` a 1,05-1,26 s, perdedores: pelvis −0,43 m a 1,25 s (rodillas /
  manos en la cabeza a 0,2-0,3 m). Tiras `mww-sheet.png`, `mwl-sheet.png`, `mwl3-sheet.png`.
- Coste: `bench.js 60 low 4`: `Players.update` 0,26 ms (inicio de la ola 0,35 ms en la misma pasada; PC cargado por otros agentes).
  `perf.js 844x390 20 medium,low 4 2.75`: 76,6 / 86 fps, draw 47 / 34, tri 198 k / 89 k (PC cargado: ver aviso de la herramienta).
- `simtest.js 10 12345 0` TODO OK; `console.sh all` 1280×720 y táctil 844×390 sin errores; `drive.js 1280 720 30` TODO OK.

### Problemas conocidos
- PLY-01/PLY-03 siguen con el criterio literal sin cumplir por el radio del balón (0,21 m, no 0,105): ver ola 1. Medianas en la superficie
  real 0,02-0,06 m.
- Choque de pecho: a 0,6 m los hombros casi se tocan; desde algunos ángulos un brazo atraviesa un poco al otro.
- `camtest.js 40`: fallan `spiker`, `wide`, `fovpump`, `spikerAll` (pruebas nuevas de CAM-11/12/13 en curso por camera_input).

### Peticiones a otros owners (ola 2)
- arena (ARN-11, sombras de contacto): poner la mancha bajo la posición VISUAL (`VB.Players.rigOf(p).root.position`, o `p + rig.offX/offY`):
  la carrera de ataque de la IA y la convergencia separan el cuerpo de la sim hasta ~2,5-4 m.
- audio (AUD-05): ya sale `fx:chestbump` (fin de partido, strength 1) además de highfive/fistbump/clap.
- camera_input: `VB.Players.faceOf(p)` existe ya (la cámara lo usa con guarda). Durante la carrera de ataque de la IA `offX/offY` ≠ 0
  (`visPos` ya lo cubre).

## Aplicado (log, integración del pulido ola 2, segunda tanda, 8-nov-2026, PC de casa)
- CONTRACT §4.4: `faceOf(p)`, rig de solo lectura `celV/celId/apOn/apS/apWarp/standW/yawV/lieW`, `offX/offY` de la carrera de ataque, registro de
  errores de `onEvent`; §4.3: `fx:chestbump` (y `fx:catch` opcional).
- Petición a arena (ARN-11, posición visual) ya hecha por arena en la misma ola (`updateAthleteBlobs` lee `VB.Players.rigs`).
- `fx:catch` (PLY-16, opcional) no se emite todavía: queda para la ola 3. PLY-01/PLY-03 siguen parciales por el criterio del radio (0,105 frente a 0,21).
- Secuencia de victoria mirada: `tools/out/int-w2b/seq/mw-*.png` (choque/salto de los ganadores, confeti en cuadro, hoja final acoplada).

## De camera_input (opcional, CAM-09), 2026-11-08
En la victoria del PARTIDO, tras el choque de pecho los dos ganadores se quedan de cara el uno al otro (`cvYaw` con `c.match`: `c.tr = 1e9`) y la
cabeza a la grada de su banda. La cámara ya los filma de perfil desde esa grada (caras visibles), pero de frente quedaría mejor: tras el choque
(`g.time > c.tc + 0.5`), girar a los dos hacia la cámara (`VB.ctx.camera.position` → sim `(x, -z)`), unos ±35° hacia el compañero. La órbita lo
detecta sola (frentes a < 60° entre sí) y pasa a encuadrarlos de frente; no hace falta tocar camera.js.

## Aplicado (log, integración de los arreglos tras la verificación de la ola 2, 8-nov-2026 noche, PC de casa)
- Petición opcional de camera_input (CAM-09) **aplicada** por el integrador en `cvYaw`: en la victoria del partido, 0,5 s después del choque de pecho, los dos ganadores
  se abren hacia la cámara (≤ 35° vueltos hacia el compañero) en vez de quedarse de cara el uno al otro. Medido: ambos de frente 1 % → 51-58 % del plano de héroe.
- Aviso de fx.js con error de sintaxis: ya no existe (`node --check` de todos los js/ limpio; console.sh sin errores).
- `sepOffset` y el aterrizaje en celebración, sin cambios. CONTRACT §4.4 al día. `approachOffset` (0,43 m un frame en 240 s) no se toca.

## Pulido ola 3 (8-nov-2026, players) — PLY-16…PLY-21
Solo `js/players.js`. Herramientas en `tools/out/ply3/`: `face.js` (primer plano de las 4 caras + métricas de luma; arg. 6 = expresión forzada),
`closeup.js` (tira de primeros planos en un momento de juego: `spike|blockpoint|dive|ritual…`; `BODY=1 DOWN= CW= CH=` para cuerpo entero),
`hair.js` (traza del hueso del pelo), `ritual.js` (mano del ritual frente al balón), `call.js` (cobertura del «¡mía!»), `tris.sh` (triángulos por LOD),
`players.w3start.js` (estado al empezar la ola).

### Lo nuevo
- **Caras (PLY-17)**: cabeza de UNA superficie (esfera deformada con normales calculadas: mandíbula, mentón, pómulos, arco superciliar y cuencas; adiós al
  «hocico» de dos esferas), ojos con esclerótica, iris, brillo (solo alta) y línea del párpado, cejas redondeadas, nariz más fina, labio inferior del tono
  de la piel. Contraste por tono (`faceTone`): en piel oscura esclerótica más clara e iris más pequeño. Piel con **difusa envolvente** (SKIN_WRAP 0,42, terminador
  cálido) y contorno cálido más fuerte; ojos con algo de luz propia (se leen en sombra). Piel y ojos se reconocen en el shader por su `v` del atlas
  (`SKIN_UV_V`/`EYE_UV_V`, zona blanca): mismo programa para los 4 atletas (`customProgramCacheKey` 'vbRimSkin'; programas 43 → 43). Piel más oscura 0x7a4a2f → 0x8a5638.
  La barba cerrada del jugador «buzz» pasa a patillas (en primer plano se leía como un agujero negro).
- **Expresiones (PLY-18)**: huesos nuevos hijos de la cabeza (`eyes, mouth, teeth, brow[2]`); su escala y posición dan grito (latigazo y contacto del remate
  ±0,15 s, bloqueo, rugido), esfuerzo (plancha y su impulso, despegue, defensa, saque), alegría (celebración) y abatimiento (los que pierden), más parpadeo
  cada 2,2-5,5 s. Sin texturas ni programas nuevos (la piel usa textura de huesos: 21 → 27 huesos, mismo programa). Pruebas: `VB.Players._face(p, 'shout'|'effort'|'joy'|'sad'|'neutral'|'', sec)`.
- **Pelo (PLY-19)**: coleta alta (jugadora «bun») en un hueso con muelle amortiguado sobre el desfase de la punta, movido por la aceleración de la cabeza con
  acoplamiento 0,55 (la sim arranca a 5 m/s en un paso: con la física completa iba siempre al tope), ±25º, ζ≈0,55 (~3,6 Hz). Todas las calidades (coste ínfimo).
- **Ritual de la CPU (PLY-16)**: `ritualHand`. En 'pre' la palma izquierda pasa de debajo del balón, por fuera, a encima; en 'dribble' va ENCIMA del balón
  mientras está por encima de la altura de espera (empuje ~14 cm y recogida que amortigua) y espera sobre el punto del bote; en 'post' vuelve por fuera a debajo;
  'wait'/'done' = anclaje 'hold'. Modo de anclaje nuevo `drib` (8). Tronco inclinado, rodillas en cada empujón y en la recogida, cabeza al balón. La derecha
  cuelga suelta (antes se leía como mano en la cadera). Emite `{type:'catch', team, x, y, z, strength:0.6}` por `drainFx` en cada recogida (audio ya suena `fx:catch`).
- **«¡Mía!» (PLY-20)**: `callGesture`. Cuando el balón va a este jugador (`g.jobs`) y el contacto previsto está a 0,8-1,15 s, brazo izquierdo ~45º por encima del
  hombro 0,42 s con la cabeza al balón (solo el brazo, sobre la carrera); un aviso por balón; emite `{type:'call', team, x, y, z, strength:0.6}` por `drainFx`.
  El compañero cerca de la red enseña la mano derecha como objetivo mientras llega el saque o un balón fácil del rival (nunca durante un ataque: en 2x2 chocaría
  con el bloqueo; así se interpreta «setter raises a hand as target»).
- **Silueta (PLY-21)**: piernas +4,6 % (muslo/espinilla 0,46 → 0,481, cadera 1,0 → 1,042) y tronco más corto en lo mismo (hombros, cabeza y alcance en su
  sitio: todas las poses de brazos siguen valiendo); cintura más estrecha (ABS ×1,22 → ×1,14) con el bajo algo abierto; manga corta que se estrecha; esfera de
  unión en el codo. Para compensar triángulos: palma 12 → 10 lados, zapatilla 18 → 16.

### Medido (ejecutado)
- Triángulos por atleta (`tris.sh`; inicio de la ola → ahora): alta 10714/11426/11050/10786 → 10962/11674/11426/10954 (+1,6…+3,4 %); media 4772/4936/4908/4806 →
  4858/5022/5082/4874 (+1,4…+3,5 %); baja 3748/3944/3820/3759 → 3798/3994/3978/3822 (+1,3…+4,1 %). Programas 43 = 43. Dibujos por atleta: 1 + 1 sombra (igual).
- Caras (`face.js … serve high 0.85 0`, `player_close.png`): desviación de luma de la cara 32,2 / 39,9 / 39,5 / 43,2 (≥ 18). Ojo frente a mejilla: contraste
  medio |píxel − piel| 53-54 / 37-84 / 42-61 / 55-67; la diferencia de MEDIAS es 2-68 (esclerótica blanca + iris oscuro promedian cerca del tono medio de la piel).
- Expresiones: `closeup.js spike` (semilla 7): grito 0,93-1 y boca 0,94-1 de −0,025 a +0,1 s del contacto; `closeup.js blockpoint`: rugido = 1 de 0,1 a 1,4 s.
  Tiras `cu-spike-sheet.png`, `cu-bp-sheet.png`. Programas y dibujos sin cambios.
- Pelo (`hair.js 7 240 2`, `99 240 2`): pico en los 0,1 s tras despegue/aterrizaje: mín. 12,0 / 12,1 (semilla 7), 12,9 / 10,3 (99), mediana 15-17º; planchas 16-25º.
  Quieto 1,5º de media, carrera ~5º. La respuesta propia decae a < 1 % en 0,5 s (ζω ≈ 12,5/s); los que no «asientan» a +0,5 s es porque llega otro movimiento
  (despegue → latigazo del remate a +0,5 s): 13/18 y 11/18 despegues, 15/18 y 12/18 aterrizajes dentro del criterio estricto.
- Ritual (`ritual.js 7 1`, `99 2`): muñeca a 0,24 m del CENTRO del balón (0,03 m de la superficie, radio 0,21) en cada suelta y recogida; palma nunca dentro del balón
  (mín. 0,218-0,230 ≥ 0,21); velocidad de la muñeca al pasar a sostener 0,90-0,98 m/s (< 3). Tira `rit7c-sheet.png`.
- «¡Mía!» (`call.js 7 240`, `99 240 hard`): 13/15 (86,7 %) y 11/13 (84,6 %) de las primeras recepciones (no defensas) con la muñeca izquierda sobre el hombro ≥ 0,25 s
  en los 1,2 s previos. Tira `call7b-sheet.png`.
- Contactos (`ply1/m.js 240 7 normal`): iguales que en la ola 1 (saque 0,025 de la superficie, remate 0,022, antebrazos 0,061…).
- `perf.js 844x390 20 medium,low 4`: media 68,1 fps, baja 75,5-77,1 (PC cargado 73-79 %; «objetivos cumplidos»); baja 112 k triángulos y media 247 k: el aumento
  respecto a la ola 2 NO es de players (con `players.w3start.js` la misma escena da 113 k).
- `console.sh all` 1280×720 y táctil 844×390 sin errores; `simtest.js 10 12345 0` TODO OK.

### Problemas conocidos
- PLY-01/PLY-03 siguen con el criterio literal sin cumplir por el radio del balón (0,21, no 0,105): ver olas 1-2. El criterio de PLY-16 «muñeca a ≤ 0,15 m del balón»
  se cumple medido a la superficie (0,03 m), no al centro (imposible sin meter la mano en el balón).
- PLY-17: el criterio «ojo ≥ 40 de luma respecto a la piel» con diferencia de medias no se cumple en tonos medios (esclerótica + iris promedian cerca de la piel);
  con el contraste medio por píxel sí salvo un ojo en sombra (37). PLY-19: el «asentado» estricto falla cuando a +0,5 s llega otro gesto.
- Piernas +4,6 % en vez de ~6 %: con 6 % el tronco quedaba demasiado corto para mantener los hombros en su sitio.

### Peticiones a otros owners (ola 3)
- audio (opcional): `fx:call` ya sale por `drainFx` (un «¡mía!» por balón, en la cabeza del que va). `fx:catch` ya se emite (ritual). Ver notes/audio.md.
- ui_main / integrador: CONTRACT §4.3/§4.4, ver notes/ui_main.md.

## Aplicado (log, integración del pulido ola 3, 9-nov-2026, PC de casa)
- CONTRACT §4.3: `fx:catch` (players, ritual) y `fx:call` (PLY-20) documentados; §4.4: `_face`, huesos y pesos de expresión, `hairAng`, `ritOn`, `tgtW`, cadera 1,042 m.
- `fx:call`: audio no lo suena por ahora (opcional). Visto en la secuencia real (`tools/out/int3/seq/cpuserve_sheet.png`): ritual de la CPU en el plano corto y brazo del «¡mía!» en la recepción.

## Aplicado (log, ola 4, fixer players — 9-nov-2026)
- `debug=point` / `debug=ace` ya no son una pose congelada: con la sim parada (`ctx.frozen`, `dt = 0`, modo `point`)
  `Players.update` representa la celebración como un **cuadro vivo** en tiempo real: adelanta `g.time`/`g.timer` con
  `ctx.realDt` solo durante su propio update (y anula `vx/vy` de la sim, que con posiciones fijas harían correr en el sitio) y lo
  restaura todo al salir (los demás módulos no ven nada). Dura hasta 3,6 s tras el punto (convergencia, choque, separación y
  vuelta), espera 0,6 s y vuelve a empezar re-emitiendo el mismo `point` (pickCeleb no repite: cada vuelta enseña otra
  variante). No se activa con `dt > 0` (film.js/ritual.js, que avanzan la sim a mano con `ctx.frozen`, siguen igual).
  Hook de pruebas: `VB.Players._tab()` → `{t, max}`. Comprobado: `tools/out/fix-ply-w4/pointseq.js` (pt-*.png: acercamiento
  0,8 s, choque de puños 1,2 s, separación 1,6 s, vuelta 2,4 s, nueva variante en el siguiente ciclo).
- Ritual del sacador CPU: empujón visible. En cada bote la palma acompaña al balón 0,13 m por debajo de la altura de espera
  (máximo suave, sin frenazo seco), con flexión de muñeca (+0,6 rad) al soltar, baja 0,04 m a buscarlo y arma la muñeca antes
  de la recogida; rodillas y tronco se hunden más en el empujón (DROP 0,11, rodilla 0,3). Muñeca izquierda (seed 7): 1,24 →
  0,975 m en cada empujón (antes quieta ~1,10). ritual.js: palma-balón mínima 0,226 m (radio 0,21: sin interpenetración),
  muñeca en recogida/suelta a 0,25-0,28 m del centro, entrada a la pose de sostener 0,9 m/s. Tira: `tools/out/fix-ply-w4/rf-*.png`.

## Aplicado (log, integración de los arreglos tras la verificación de la ola 3, 9-nov-2026, PC de casa)
- CONTRACT (añadidos de los arreglos ola 3): cuadro vivo de `debug=point|ace` (condición exacta, re-emite el `point`) y `VB.Players._tab()`.
- Visto en secuencia real (`tools/out/w4lead/seqpoint/`, 371 fotogramas en 4 s, debug=point alta): acercamiento, choque y vuelta; sin saltos. Las capturas de `debug=point` dependen ahora de WAIT.
- Verificado en el árbol integrado: simtest completo + barrido `simtest <10|20> <1..25> 0` 50/50 TODO OK; console.sh 19 escenas (1280×720 y 844×390 táctil) sin errores; drive, touchplay, padplay (estándar y DualSense) y audiotest completo TODO OK; perf 844×390 ×4 «objetivos cumplidos» (ver TRASPASO).

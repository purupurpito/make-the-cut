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

# notes/arena.md — pabellón, luces, público, balón y efectos (owner: arena)

Ficheros: `js/arena.js`, `js/fx.js`. Interfaces de CONTRACT.md §4 intactas; todo lo de abajo son AÑADIDOS opcionales.
Fecha: 2026-11-06 (pasada de "termina y verifica", PC de casa con RTX 3060 Ti).

## 1. Qué hay (resumen)
- **arena.js**: suelo de tarima procedural con líneas FIVB (incluida la prolongación discontinua de la línea de ataque y
  las marcas de zona de saque), red con malla real que ondula, antenas, postes acolchados, silla del 1.er árbitro,
  2.º árbitro, jueces de línea con bandera (señalan dentro/fuera/antena), mesa del anotador, gradas con público instanciado
  animado en GPU (botes, brazos, ola, tensión en punto de set/partido), vallas LED con marcas ficticias y mensajes,
  videomarcadores en los fondos, **marcador central colgado (4 caras)**, cerchas, focos, haces de luz, banderolas,
  flashes de cámaras en la grada, mapa de entorno PMREM y post-proceso propio (bloom + viñeta) en calidad alta de escritorio.
- **fx.js**: balón de 18 paneles con efecto según el toque, sombra de contacto, aro de caída, línea de altura, estela,
  destellos, ondas de choque, chispas, marcas en el suelo, polvo, confeti.

## 2. Cambios de esta pasada
- **Mancha blanca enorme en las capturas** (`rally`, `block`, `serve`): NO era el destello del golpe. Era el reflejo
  especular del foco principal y de las lámparas del mapa de entorno en el suelo (rugosidad 0,36) + el contraluz bajo
  (22° de elevación, justo el ángulo rasante de la cámara de juego), y el bloom lo convertía en una mancha blanca detrás
  del jugador. Arreglo: suelo `roughness 0.6` / `envMapIntensity 0.85`; contraluz más alto (~52°) y suave (0,3).
  Comprobado aislando cada fuente con capturas (fx oculto, post off, foco off, contraluz off).
- **Destello del golpe**: más pequeño, más cálido y con intensidad 0,62 (solo el núcleo llega al umbral del bloom);
  se encoge al apagarse en vez de crecer. Tamaño por toque: colocación/dejada ~0,4 m, recepción 0,5, saque 0,6-0,95,
  remate 1,0-1,45 según `power`.
- **Calidad `perfect` (solo `hit.human`)**: anillo dorado + chispas doradas (+ un destello extra, salvo en colocación).
- **`block.result`**: `'stuff'` = destello, doble onda (color del equipo + blanca), muchas chispas, público y valla
  "¡BLOQUEO!"; `'soft'`/`'tool'` = roce suave, sin mensaje ni público.
- **`netTouch`**: chispa fría en la cinta (plano de la red) y la malla vibra (arena).
- **`dive`**: polvo de parquet (nuevo pool `Points` con alfa por vértice y mezcla normal) que sale en la dirección de
  la plancha + onda en el suelo. `landPlayer` también levanta un poco de polvo.
- **Saque**: lee `hit.shot` (`'float'`/`'jump'`): flotante sin giro y con baile; en salto, estela y onda.
- **Dejada** (`kind:'free', shot:'tip'`): toque suave, sin estela.
- **Marcador colgado**: las 4 pantallas quedaban 9 cm DENTRO de la carcasa y se veía un cubo negro. Ahora están fuera,
  y la caja es cuadrada (4,2 × 4,2 m) para que las 4 caras tengan la proporción 16:9 de la textura.
- **Videomarcador**: subtítulo del punto con `point.how` (¡ACE!, REMATE, DEJADA, BLOQUEO) y las razones nuevas
  (TOQUE DE RED, FALTA DE SAQUE, BAJO LA RED, BLOQUEO DEL SAQUE).
- Densidad del público por calidad: ya estaba en `Arena.setQuality` (`q.crowdDensity` → `InstancedMesh.count`;
  los asientos están barajados, así que con 0,4 se quita gente repartida). Verificado con `quality=low`.

## 3. API opcional (para quien la quiera)
- `VB.Arena.bounds` → `{freeX, freeY, boardsX, boardsY, standsX, standsY, hallX, hallY, hallH}` (sim, metros). Útil para limitar la cámara.
- `VB.Arena.message(text, team, dur)` — mensaje en las vallas LED.
- `VB.Arena.cheer(team, sec)`, `VB.Arena.wave(sec)` — público.
- `VB.Arena.postActive()` — ¿post-proceso activo? (`ctx.renderFn` lo pone arena con `?post=0|1` para forzar).
- `VB.FX.confetti(team, n)`, `VB.FX.ballObject()` (pivote del balón), `VB.FX.burst(x,y,z,n,power)` (contrato).

## 4. Peticiones / avisos a otros owners
- camera_input: el compañero cortado cerca de la cámara (drive-3-juego) pasa a notes/camera_input.md como pendiente de Review.

## 5. Review 1 — arreglos (fixer arena, 6-nov-2026 tarde)
- Vallas LED fuera de la carcasa (pantalla 1,5 cm delante de su cara frontal, misma inclinación): las marcas se leen enteras.
- UNA textura por lienzo LED compartida por todas las vallas (repetición/fase/desplazamiento en uniformes); un `needsUpdate`
  por mensaje (antes 8). Retícula LED en el shader con `fwidth` (se apaga a distancia: sin moiré).
- Marcador colgado 1024×576 en escritorio, dos cifras enormes + nombres cortos, retícula en shader. Legible a distancia de juego.
- Videomarcadores de los fondos: un comentario se había tragado `rotation`+`root.add` y NO se pintaban; arreglado.
- Público: figura torneada con hombros, cuello, pelo, bufanda opcional, 4 % niños, complexión variable, sesgo de color por
  grada + bolsas visitantes, filas altas más oscuras/desaturadas, balanceo y reacción escalonados por instancia (GPU).
- Oficiales rehechos: proporciones de atleta (tronco torneado, pelvis, piernas y brazos con perfil, manos), polo oscuro con
  cuello blanco y escudo, pantalón largo, zapatillas con suela, cara (orejas, nariz, ojos, cejas, boca). Pivote `upper` con
  respiración/balanceo. 1.er árbitro en plataforma acolchada con barandilla, peto y 3 peldaños; brazo hacia el equipo que saca
  en el silbato de saque (`whistle reason:'serve'`) y al pitar el punto. Jueces de línea: bandera abajo = dentro, arriba = fuera,
  agitada = antena.
- Sombras: en calidad baja ni utillaje, ni postes, ni oficiales proyectan (5 casters: jugadores y balón).
- r149 transparente+DoubleSide: conos de luz fusionados en 1 malla (transparent:false aditivo), red en dos mallas de una cara,
  estela del balón transparent:false aditiva. `material.version` constante entre frames (medido).
- fx.js: logo del balón ya no sale en espejo; tinte de calor máx. 25 %, aplastamiento máx. ~1,15:1; estela blanco-amarilla;
  onda de choque con filo fino y sin "disco gris" (quitado el segundo aro blanco del bloqueo), más corta (0,18-0,26 s).
- Protección del poste: texto ajustado a la longitud útil con márgenes (se lee "PALAU DEL MAR" entero).

## Aplicado (log)
- 6-nov-2026 (Integrate, PC de casa): escenas congeladas → main.js envejece los efectos del disparador (`fxAge`); ruta relativa en shot.sh (ya estaba);
  "evalshot" → `SHOT=out.png node tools/eval.js ...`.
- 6-nov-2026 (integración tras Review 1): fx.js color dentro/fuera del aro de caída con `C.IN_TOL` (petición de sim);
  arena.js `REASON.attackServe = 'ATAQUE DEL SAQUE'` para el videomarcador.

## 6. Review 2 — arreglos (fixer arena, 6-nov-2026 noche)
Comprobado con capturas en `tools/out/r2-arena/` (GPU real) y `tools/console.sh` sin errores.
- **Una sola sombra del balón**: `ball.castShadow = false`; queda la de contacto (vertical bajo el balón).
- **Balón legible a distancia**: el pivote se escala con la distancia a la cámara para que el radio en pantalla no baje
  del 1,1 % del alto del visor (máx. ×1,6; el radio físico no cambia) + contorno oscuro de caras traseras con grosor
  constante (~1,4 px) que lo separa del público (mismos colores que el balón).
- **"Aro amarillo" = focusRing** (dónde jugará el balón tu equipo, pr1/pr3): amarillo saturado con filo oscuro,
  opacidad 0,82-1, se cierra con `Sim.hitWindow(g, g.jobs[0]).press` y se rellena en el instante de pulsar.
  El marcador de caída pasa a secundario: blanco cuando el aro amarillo está activo, amarillo solo si nadie tuyo
  va a jugar el balón (p. ej. va fuera), azul en campo rival. Ambos con filo oscuro (se leen sobre la tarima).
- **Apuntado**: retícula naranja en el campo rival + arco punteado balón → objetivo por encima de la red, en el saque
  humano (`ready` tras el silbato = previsualización tenue; `toss` = activo) y en el remate (control en el aire,
  3.er toque propio). Reproduce las fórmulas de `sim.js` (`doServe` sin objetivo de IA, `attackTarget` con dd = 6),
  sin el error aleatorio. Se apaga en el contacto. Usa `Sim.aimPoint(g, out)` si algún día existe.
- **Marca del bote**: huella oscura orientada según el vuelo + filo verde (dentro) / rojo (fuera), opacidad 0,9,
  5,2 s de vida (cubre el plano del punto), pulso de entrada.
- **Nada brillante tras la franja superior del HUD**: los videomarcadores de los fondos y el marcador colgado se apagan
  enteros (pantalla y filos) si menos del ~70 % de su alto queda por debajo de la franja del HUD (≈7,5 % del alto,
  mínimo 64 px); halos de los focos y tiras emisivas se funden en la franja superior (shader). Cifras de los
  marcadores en blanco roto y `boost` 1,12 con post (a 1,55 el bloom convertía cada cifra en una mancha).
- **Coste de CPU** (la escalera de calidad ahora sí lo baja): oficiales = 1 SkinnedMesh por persona (antes 5 mallas:
  −24 dibujos y −24 en sombras), banderolas en un atlas (5→1), marcador colgado en 1 malla (4→1), matrices del pabellón
  congeladas (`matrixAutoUpdate = false`, salvo personas), público con `frustumCulled = true` (r149 crea los
  InstancedMesh con false). En baja: sin reflejos de vallas, sin luces de relleno/contraluz (sube la hemisférica).
  Medido en `debug=mobile&quality=low` 844×390: 74 → 53 dibujos.
- **Público**: en media solo la grada de fondo cercana (crowd2) usa la LOD detallada (desktop medio: 798k → 553k tris);
  la LOD sencilla gana codo y dos piernas; posturas de reposo por instancia (manos en muslos/regazo/barbilla/levantada)
  y encorvado/recostado variable, todo en el shader.

## 7. Peticiones (Review 2) a otros owners
Aplicadas (ver log). Pendiente: `Sim.aimPoint` (anotado en notes/sim.md §5).

## Aplicado (log, integración tras Review 2)
- 6-nov-2026 (integración tras Review 2): main.js `ctx.simMove = simIn.move` (retícula de apuntado en vivo) y `scene.matrixAutoUpdate = false`; players.js halo del
  jugador controlado BLANCO y fino + cono blanco (y el cono se oculta en el aire / con el balón del saque lanzado: tapaba la mano que
  golpea); ui.js tutorial "aro amarillo donde tienes que jugarlo; se cierra y se llena en el momento de pulsar" y pista de saque
  "la diana naranja marca adónde va"; flecha "TÚ" del tutorial en blanco. fx.js: `VB.FX.dust(x, y, n, dirx, diry)` (petición de
  players) y golpe apagado sin destello para `hit.shot:'body'`. arena.js: "CAMBIO DE CAMPO" en los videomarcadores encadenado tras
  el mensaje de SET/PUNTO (`SB.next`); la etiqueta PUNTO DE SET/PARTIDO del marcador colgado se borra al acabar el set
  (`g.pendingSet`; antes seguía durante la pausa entre sets).

## 8. Rendimiento móvil + cambio de campo (arena, 7-nov-2026)
Medido con scripts propios en `tools/out/arena-perf/` (perf.js = fps/coste con DPR y `Emulation.setCPUThrottlingRate`,
trace.js = GC y duración de los rAF, brk.js = triángulos por objeto). Escena `debug=rally&live=1&quality=X`, táctil, 844×390,
DPR 2,75, CPU ×4. Capturas antes/después en `tools/out/arena-perf/` (before-*, m1-*, f-*, close-*, cc1/cc2).

| | antes | después |
|---|---|---|
| móvil baja: dibujos / triángulos | 46 / 327k | 35 / 81k |
| móvil media: dibujos / triángulos | 66 / 502k | 48 / 199k |
| escritorio alta (1280×720): dibujos / triángulos | 79 / 1,17 M | 54 / 1,17 M (mismo aspecto) |
| móvil baja ×4: fps / ms JS+tarea por frame | 64 / 14,7 | 85 / 10,8 |
| móvil media ×4: fps / ms JS+tarea por frame | 59 / 16,1 | 81 / 12,0 |

Traza de 30 s de peloteo (×4): rAF p95 11,5 ms (baja) / 15,4 ms (media); 11 GC menores + 1 mayor (≈1-14 ms), montón plano
(+2 MB que se recogen). arena/fx no asignan por frame (muestreo de HeapProfiler).
- **Público impostor** (`crowdImp`): cada aficionado = cartel de 2 triángulos orientado a cámara con una figura de un atlas
  de lienzo (máscaras camiseta/piel/pelo/pantalón + sombreado; 4 posturas × 2 peinados). Mismos colores y animación (alegría,
  ola, tensión/aplauso, botes) que el 3D. Media: filas cercanas (4 laterales / 3 fondos) en 3D y el resto impostor; baja: todo
  impostor; alta: todo 3D como antes. 1 dibujo para las 4 gradas. Las gradas 3D ordenan filas cercanas primero (`userData.near`).
- **Fusiones estáticas** (mismo material, mismo aspecto): 9 vallas LED → 1 malla (`ledBoards`, repetición/fase/velocidad/retícula
  en atributos; desplazamiento `fract(v·scrollT)`), 4 reflejos → 1 (`ledRefl`), 6 oficiales + 2 banderas → 1 SkinnedMesh con
  esqueleto común (`officials`; 1 textura de huesos por frame en vez de 6), antenas/postes/protecciones 6 → 3.
- **Sombras**: en baja solo jugadores (utillaje, postes, oficiales fuera); mapa 1024 en media / 512 en baja (lo fija main.js).
- **Post-proceso**: solo alta de escritorio (media y baja sin `renderFn`).
- **fx.js**: pools por calidad (chispas 220/150/90, polvo 96/72/40, confeti 520/360/200; `setDrawRange`), además de `qScale`.
- **Cambio de campo** (`courtChange`): videomarcadores y marcador colgado "CAMBIO DE CAMPO" con icono de intercambio (encadenado
  tras SET/PUNTO), vallas "<<< CAMBIO DE CAMPO >>>" en dorado (encadenado al mensaje LED en curso), público aplaudiendo
  (tensión) y flashes durante la pausa. Comprobado inyectando el evento (`tools/out/arena-perf/cc1.png`, `cc2.png`).
- API nueva (opcional): `VB.Arena.courtChangeT()` (s que quedan del momento; 0 = no hay), `VB.Arena.landmarks`
  (`scoreHung`, `screenPos`, `screenNeg`, coords de sim) para planos de cámara.
- Calidad adaptativa: con `debug=rally&live=1&aq=1`, 915×412, CPU ×12 baja de media a baja y arena pasa a 36 dibujos / 79k.

## 9. Peticiones (7-nov-2026)
- camera_input (notes/camera_input.md): plano de transición durante `courtChange` usando `VB.Arena.courtChangeT()` y
  `VB.Arena.landmarks.scoreHung` (p. ej. subir la mirada al marcador colgado mientras `courtChangeT() > 0`).
- ui_main: al bajar de calidad hay un parón de ~1-2 s con CPU ×12 (recompilado por el cambio de tipo de sombra + estreno del
  programa del público impostor en escritorio). Si `ctx.prewarm` precompila, incluir `crowdImp` (visible en media/baja).

## 10. Peticiones de ui_main (7-nov-2026, rendimiento móvil medido con `tools/perf.js`)
- **Parón al bajar de calidad en el móvil (prioridad alta)**: `setQuality` hace `fillLight.visible = q.rank >= 1` y
  `rimLight.visible = …`. Cambiar el NÚMERO de luces cambia `NUM_DIR_LIGHTS` en todos los materiales iluminados y three r149
  los recompila todos de golpe: con CPU ×10 (`node tools/perf.js 844x390 30 auto 10`) la bajada media→baja da una tarea larga
  de **1,6 s** (programas 38 → 52). La parte de main.js ya está quitada (en el móvil la sombra es PCF en todos los niveles, ya no
  cambia de tipo). Propuesta: en el móvil (`ctx.isMobile`) no cambiar la visibilidad, solo la intensidad:
  ```js
  var keepLights = ctx.isMobile; // mismo número de luces en todos los niveles: bajar de calidad no recompila
  if (fillLight) { fillLight.visible = keepLights || q.rank >= 1; fillLight.intensity = q.rank >= 1 ? FILL_I : 0; }
  if (rimLight)  { rimLight.visible  = keepLights || q.rank >= 1; rimLight.intensity  = q.rank >= 1 ? RIM_I : 0; }
  ```
  (guardar `FILL_I`/`RIM_I` al crear las luces). Una luz a intensidad 0 cuesta unas pocas instrucciones por píxel; el parón
  de 0,6-1,6 s en pleno peloteo se nota mucho más. Lo mismo para cualquier otro `visible` de luz por calidad.
- **Asignaciones por frame** (`ALLOC=1 node tools/perf.js 844x390 15 medium 1`, KB/s a ~160 fps): `updateFlashes` (arena.js ~1752)
  176 KB/s con `Math.random()` (cada número es un HeapNumber nuevo si se guarda en un campo no-double); `updateOfficials` (~541)
  73 KB/s; `fx.js update` (~524) 250-290 KB/s. Si se puede, un generador propio sobre un `Float32Array`/entero (p. ej. xorshift
  en un entero de 32 bits) y reutilizar objetos temporales.
- Hecho por ui_main: el material de profundidad de sombras compartido cambiaba de programa 4 veces por frame (mallas con esqueleto
  de jugadores/oficiales e instanciadas alternando con normales). main.js pone `customDepthMaterial` por variante a todas las
  `SkinnedMesh` e `InstancedMesh` (función `fixShadowDepth`, tras `onGameStart` y `setQuality`). Si arena crea casters nuevos
  más tarde, llamar a `VB.ctx.fixShadowDepth()` (expuesto) o ponerles el suyo.

## Aplicado (log, integración de pendientes)
- 7-nov-2026 (integración de pendientes): §10 parón al bajar de calidad en el móvil: `setQuality` deja `fillLight`/`rimLight` visibles en el móvil (`ctx.isMobile`) y pone
  su intensidad a 0 en baja (`FILL_I`/`RIM_I` guardadas al crearlas). Escritorio igual que antes. Medido: `perf.js 844x390 30 auto 10`
  baja media→baja con 33 programas (antes 38 → 52) y tarea larga máxima 470 ms (antes 1,6 s); forzar baja en móvil emulado: 32 → 32
  programas, siguiente frame 12 ms. Mismo aspecto en baja (capturas `tools/out/int3/m844/`).
- 7-nov-2026 (integración de pendientes): petición de sim (antena): el juez de línea que agita la bandera es el del lado del contacto real (`point.antenna[1]`) o, si cruzó
  por fuera, el del lado del balón. La vibración de una sola antena no se hace: las antenas son ahora una única malla fusionada.
- 7-nov-2026 (integración de pendientes): fx.js `aimTarget` llama a `Sim.aimPoint(g, out, ctx.simMove)` (entrada del mismo frame). La retícula no se escala con `spread` (opcional, no aplicado).
- NO aplicado (opcional): asignaciones en `updateFlashes`/`updateOfficials`/`fx update`. No hay objetos ni literales por frame; lo medido son
  números encajonados de V8 en código aún no optimizado (~1 KB/frame). §9 precalentado de `crowdImp`: el precalentado por defecto solo sube
  texturas (`r.compile` de three r149 no compila objetos ocultos); en escritorio bajar de alta ya recompila por el cambio de tipo de sombra, así
  que el programa del impostor es marginal; en el móvil el impostor ya es visible desde el principio.

## Aplicado (log, ronda 1 de arreglos)
- 7-nov-2026: videomarcador tras un error de red del rival. `point` con `reason 'in'` + `how 'error'` + texto «Saque a la red» / «Balón a la red»
  ya no pone «DENTRO»: pone «SAQUE A LA RED» / «BALÓN A LA RED» (`pointSub(e)`). Comprobado con sim real (6 partidos demo, 600 s cada uno):
  19 de 19 errores de red con el subtítulo correcto; el resto de subtítulos no cambian.
- 7-nov-2026: basura por frame. `updateOfficials` reescrito: estado plano por oficial (`P.st`), factores de amortiguado una vez por frame
  (`OFK`), funciones pequeñas `refStep`/`judgeStep`, escritura directa en `Euler._x/_y/_z` + una sola `quaternion.setFromEuler` y solo si
  el valor cambia (brazos en reposo = 0 escrituras), seno por tabla en la respiración. `screenVis`: vectores fijos precalculados y uniformes
  `vis` escritos solo si cambian. fx.js: el aro amarillo guarda en caché `Sim.hitWindow` (42 % menos llamadas, aro exacto con |press| < 0,5 s).
  Medido con `ALLOC=1 node tools/perf.js 844x390 15 low 4 2.75` (2 veces): arena.js 201 → 66/115 KB/s, y `updateOfficials` sale del top 25
  (antes 73 KB/s). Con WARM 40 s (`tools/out/alloc-arena.js`): `updateOfficials` 32–55 → unos 12 KB/s.
- PARA ui_main (tools/perf.js) y para todos (dato medido): V8 sube de nivel por NÚMERO DE LLAMADAS (Maglev tras ~400 llamadas, TurboFan tras ~3000).
  Una función que se llama una vez por frame sigue en baseline unos 6 s y en Maglev hasta ~45 s, y en baseline CADA operación con doubles asigna
  un HeapNumber. Comprobado con `--js-flags=--allow-natives-syntax` + `%GetOptimizationStatus` (`tools/out/optstat.js`): a 12 s con CPU ×4,
  `FX.update`, `Arena.update` y `Sim.hitWindow` estaban en baseline; a 40 s, en Maglev/TurboFan. Con WARM=4, `perf.js ALLOC=1` mide sobre todo
  esa fase de arranque. Propuesta: medir el presupuesto de asignaciones con `WARM=45`.
- NO aplicado: «fog/lights uniform churn». En baja solo hay 2 luces activas (hemi + key; fill/rim a intensidad 0) y 27 materiales con niebla.
  `refreshFogUniforms`/`refreshMaterialUniforms`/`setup` son de three r149 y se ejecutan en cada cambio de programa o material. Quitar la niebla
  de materiales cercanos cambia los shaders y el aspecto del fondo. No compensa para unos 80 KB/s.

## Aplicado (log, integración ronda 1 de verificación, 7-nov-2026)
- Petición de sim R4.1: `pointSub` también con `reason 'out'` + texto «a la red» → «SAQUE/BALÓN A LA RED» (antes «FUERA»). Con 'out' no se
  consulta `HOW`. Comprobado en node con los 6 casos (in/out × red/ace/fuera/net).
- Tu propuesta para perf.js: `WARM` por defecto 45 s con `ALLOC=1`/`RETAIN=1` (4 s sin ellos). CONTRACT §6 al día.
- CONTRACT: nota de `Euler._x/_y/_z` válida solo para three r149 (queda en este fichero; three está fijado).

## Aplicado (ronda 2 de verificación, 7-nov-2026) — polvo de plancha
- fx.js `dustAt(x, y, n, spread, dirx, diry, push, back, fwd)`: con dirección, el polvo se reparte por la LÍNEA DEL CUERPO
  (de piernas a pecho, nunca cabeza/manos), a ras de suelo (z 0,02-0,06, vz 0,06-0,22), sale hacia los lados y algo
  hacia delante; vida 0,22-0,4 s; alfa pico ~0,42·s; tono serrín (0.88, 0.72, 0.52); sprite 0.42 (antes 0.75, blanco,
  vz hasta 0,95 y vida 0,7-1,3 s: el "halo" blanco sobre la cabeza). `VB.FX.dust` (players.js) y el evento `dive` usan
  back 1,5 / fwd 0,1 desde su punto de referencia (≈ pecho). Firma pública de `VB.FX.dust` sin cambios.
  Comprobado: tools/out/arena-dust/cmp.png (antes/después), cmp3.png (evento dive inyectado en cámara lenta), cmp4.png
  (ruta cosmética y calidad baja).

## Aplicado (log, integración ronda 2 de verificación, 7-nov-2026)
- fx.js: los pools de chispas, polvo y confeti se crean con `dblFields` (campos enteros generalizados a double al crearlos: la primera ráfaga de la
  partida deprecaba el mapa de las chispas, `addSpark` L161 + `update` L701, dentro de una desoptimización en masa). Mismos valores.
- Polvo de plancha (ronda 2): visto en `debug=dive` (alta y baja) y en la escena viva; nada pendiente.

## Aviso de sim (pulido ola 1, SIM-02): `point.signal` para el 1.er árbitro y los jueces de línea (ARN-07) (2026-11-07)
Ver notes/sim.md §P1. Cada `point` trae `signal` (lista cerrada), `touchedOut` y `landSide` (0 = campo x > 0, 1 = x < 0, -1 sin bote):
| `signal` | 1.er árbitro (FIVB) | jueces de línea |
|---|---|---|
| `in` | balón dentro (brazo y dedos hacia el suelo, lado de `landSide`) | bandera abajo (los del lado `landSide`) |
| `out` | balón fuera (antebrazos verticales, palmas hacia el cuerpo) | bandera arriba |
| `touched` | balón tocado (roza con la palma de una mano los dedos de la otra, en vertical) | bandera arriba + palma de la otra mano sobre ella |
| `four` | cuatro toques (4 dedos) | — |
| `double` | doble contacto (2 dedos) | — |
| `net` | toque de red: señala con la mano el lado de la red del infractor (`e.player`) | — |
| `under` | balón por debajo de la red: señala la línea central | — |
| `antenna` | balón fuera | agita la bandera por encima de la cabeza y señala la antena o la banda (el de ese lado) |
| `attackFault` | `reason 'attackServe'`: falta de ataque (antebrazo hacia abajo, mano abierta); `reason 'block'` (bloqueo del saque): falta de bloqueo (los dos brazos en vertical, palmas al frente) | — |
| `delay8` | retraso en el saque: ocho dedos abiertos | — |
| `serveFault` | balón no lanzado o soltado sin golpear: brazo extendido hacia arriba, palma hacia arriba | — |
Siempre después: brazo extendido hacia el lado del equipo que saca a continuación (`e.team`). Referencia: señales oficiales de las Reglas Oficiales de Voleibol (FIVB). Los textos del videomarcador (`REASON`) no cambian.

## 11. Pulido, ola 1 (arena, 7-nov-2026): ARN-01 … ARN-07
Scripts de medida en `tools/out/arn/` (`tune.js`, `crowd.js`, `endview.js`, `marks.js`, `ring.js`, `ringshots.js`, `ringbot.js`,
`ballpx.js`, `progs.js`, `sig.js`, `jsig.js`, `pp.js`). Capturas en las carpetas del mismo nombre.

- **ARN-01 luces**: tabla `LT` por nivel `[baja, media, alta]` en `setQuality` (principal/hemisférica/relleno/contraluz/reflejo del
  suelo); hemisférica con suelo oscuro (`#0d1118`); degradado de la tarima `#c98a50` (bordes) / `#d9995c` (centro).
  **Arreglo de fondo en el post-proceso de alta**: la cadena del post pintaba la escena con otra curva que la pintura directa
  (negros levantados +15, luces comprimidas: medido píxel a píxel con `pp.js`, misma escena con y sin `renderFn`). Era la causa de la
  pista «crema» en alta. `comp` aplica ahora `pow(c, gam)` (`gam` 1,16) antes de sRGB y la alta queda igual que media/baja
  (diferencia ≤ 5 niveles en todo el rango). Bloom 0,72 (antes 0,9) y umbral 0,82.
  Medido 1920×1080 (`fin/`): pista luma 195,0 / 192,1 / 190,9 y saturación 0,445 / 0,442 / 0,465 (alta/media/baja), diferencia ≤ 4,1;
  sombra del jugador 31-43 % más oscura que el suelo; máx. luma detrás del bloqueador 241. 1280×720: 195,0 / 192,4 / 191,2.
- **ARN-02 grada**: `vbCrowdFall` (×0,42 de 1,6 a 5,4 m de altura —las gradas solo suben hasta 6-7 m, con 2→7,5 m apenas cambiaba—,
  ×0,8 por distancia) y `vbCrowdTone` (desatura 28-58 %) en público 3D, impostores y banderas; peldaños y asientos con la misma
  caída (colores por vértice). Bruma de pabellón sobre la grada (`uHaze` 0,34, `uHazeC` LINEAL vía `linearToOutputTexel`: igual a
  pantalla que al destino del post). `uCrowdLight` (multiplicador, 1) para ARN-08. Bloques de afición: fondo +x local
  (naranja/arena), bloque visitante azul en el centro del fondo rival, neutros oscuros (grises cálidos, sin azules); camisetas
  desaturadas un 25 %; neutros claros solo en filas < 5. Asientos azul pizarra y franja `#8e432d`. Vallas LED altas (anillos de
  grada) ×0,62 (`aCells.z`). Banderas: atlas de 8 banderas originales (ola, estrella, «12», balón) en un solo `InstancedMesh`.
  Medido: grada sat 0,413-0,418 / std ≤ 30,5 (alta), 0,32-0,35 / ≤ 26 (media/baja); mitad alta del fondo 39,7 / 31,1 / 37,5 % más
  oscura que sus 3 primeras filas (`endview.js`, filas proyectadas). Mismos dibujos.
- **ARN-03** `VB.Arena.prewarmList()` (copias que comparten geometría y material de TODO arena + `VB.FX.prewarmList()`) y
  **`VB.Arena.prewarmCompile()`** (lo hace todo y con el destino de render real: con post activo los programas son la variante de
  salida lineal; compilar a pantalla NO sirve en alta). Con la llamada simulada antes de `startMatch`: 0 programas compilados en juego
  en 50-60 s de partido (alta con MENUWAIT 3000 y 15000, media y baja). Coste 290-570 ms.
- **ARN-04** marca del bote: disco claro del color de la llamada + aro; FUERA con X diagonal gruesa (forma legible en gris).
  Sombra de contacto: disco solo en el aire; en el suelo, contacto pequeño. Medido (`marks.js`): dentro luma 202 sobre suelo 201,
  matiz 116° (aro 126°); fuera luma 105 sobre 102,5, matiz 4°; deuteranopía/protanopía/acromatopsia distinguibles (`mk4/crop-*`).
- **ARN-05** aro de aproximación: diana fija 0,8 m con marcas hacia dentro + aro móvil 2,6 m → 0,8 m lineal en `hitWindow().press`
  (0,9 s → 0), `depthTest` off encima de todo; relleno en la ventana HINT (−0,15, 0,24). Medido (`ring.js`): 773 frames, error máx.
  0,8 %, coincide a press 0 (± 0,02 s). Bot que solo mira el aro y pulsa con 250 ms de reacción (`ringbot.js`): 27 de 32 toques
  de peloteo buenos/perfectos (84 %). +1 dibujo (la diana) solo cuando se ve.
- **ARN-06** balón: diámetro ≥ 9,6 px CSS (o 1,8 % del alto), rodilla suave, escala exactamente 1 a < 8 m, máx. ×3,2; sombra y estela
  escalan con él; brillo de borde (fresnel, `uRim` ≤ 0,3) lejos o > 12 m/s. Medido 844×390 táctil: mín. 10,5-11,5 px en 8 remates
  de la CPU; 2000 frames a < 8 m con escala 1. `VB.FX._dbg()` → `{ballBs, rim}`.
- **ARN-07** oficiales con codo (7 huesos por persona) y dedos en los dos árbitros (4 huesos por mano, se pliegan por escala).
  `refSignal`: silbato a la boca (0,32 s) → brazo hacia el equipo que saca → señal de `point.signal` (1,2-1,3 s) → reposo.
  in, out, touched, four, double, net, under, antenna (señala la antena), attackFault (antebrazo hacia abajo; con `reason 'block'`
  falta de bloqueo: dos brazos arriba), delay8 (8 dedos), serveFault (brazo extendido que sube, palma arriba, señal FIVB de «balón
  no lanzado o soltado»). Autorización del saque con su propio gesto (silbato + mano que indica el saque). Jueces: bandera abajo /
  arriba / arriba + mano libre sobre la bandera (tocado, al llegar `point.signal 'touched'`) / agitada + señala la antena.
  Mismos dibujos (23 = 23 en la misma vista, baja). Capturas `s2/montage.png`, `js1/`.

### Peticiones (ola 1)
- **ui_main (UI-01)**: al arrancar (bajo el telón, tras `applyQuality`) y tras cada `applyQuality` que cambie el nivel:
  ```js
  if (VB.Arena && VB.Arena.prewarmCompile) { try { ctx.prewarmMs = VB.Arena.prewarmCompile(); } catch (e) { } }
  ```
  (alta→media apaga el post: otra variante de todos los programas; mejor pagarla en el cambio de nivel que en el primer remate).
  Si preferís hacerlo a mano con `prewarmList()`: grupo temporal DENTRO de `ctx.scene`, `renderer.setRenderTarget(destino del post si
  `VB.Arena.postActive()`)`, `compile`, restaurar. No hagáis `dispose` de las copias.
- **players (PLY-05)**: el halo blanco grande a los pies del jugador controlado se superpone con el aro de aproximación amarillo
  (que ahora se pinta encima de todo): conviene que el halo sea más pequeño o se atenúe cuando `VB.Sim.focusPoint` está cerca.
- **lead / CONTRACT §4.4**: añadir `VB.Arena.prewarmList()`, `prewarmCompile()`, `VB.FX.prewarmList()`, `VB.FX._dbg()`; crowd uniform
  `uCrowdLight` (vía `VB.Arena._dbg().crowdU`).
- Rendimiento: dibujos/triángulos 844×390 media 46/204k, baja 35/84k (perf.js). Los fps de esta sesión no son válidos (CPU del PC
  97-100 % por otros agentes); repetir `node tools/perf.js` con el PC libre.

## Aplicado (log, integración del pulido ola 1, 8-nov-2026, PC de casa)
- UI-01 (precompilado con `prewarmList`/`prewarmCompile`): ya cableado por ui_main en main.js (ver notes/ui_main.md UI-01).
- PLY-05 (halo frente al aro amarillo): aplicado en players.js (se encoge y atenúa cerca de `focusPoint`; al 25 % con balón muerto).
- CONTRACT §4.4: `prewarmList()`, `prewarmCompile()`, `VB.FX.prewarmList()`, `VB.FX._dbg()`, `_dbg().crowdU` añadidos.
- perf.js re-medido con el PC libre (CPU 34-35 %): 844×390 dpr 2,75 CPU×4 → media 138,8 fps (202 k tri, 47-51 dibujos), baja 155,1 fps
  (84 k tri, 34-38 dibujos), alta 141,2; escritorio 1280×720 alta 164,8 fps. «objetivos cumplidos».

## Aplicado (log, integración del pulido ola 2, 8-nov-2026, PC de casa)
- Vomitorios (`buildVomitory`, `vomCut`, constantes `VOM_*`): nada que cablear en otros ficheros. Revisado en capturas de punto/ace (ver informe de integración).

## Petición de players (pulido ola 2, 8-nov-2026) — ARN-11
- Sombras de contacto bajo los atletas: usar la posición VISUAL del atleta (`VB.Players.rigOf(p).root.position` en Three, o
  `p.x + rig.offX`, `p.y + rig.offY` en sim). La carrera de ataque de la IA (PLY-08) y la convergencia del punto separan el cuerpo de la
  sim hasta ~2,5-4 m; con la posición de la sim la mancha se quedaría atrás.

## 12. Pulido, ola 2 (arena, 8-nov-2026): ARN-03 (verificado), ARN-08 … ARN-13
Scripts de medida en `tools/out/arn2/` (`blobm.js`, `moodm.js`, `rim.expr.js`, `softm.js`, `confm.js`, `glowm.js`, `ceil.js`, `wide.js`,
`sweep.js`, `divem.js`, `calls.expr.js`). Capturas en las subcarpetas del mismo nombre.

- **ARN-03** (verificado de nuevo con todo lo nuevo): `audit-feel/progs.js` con MENUWAIT 3000 y 15000 → tras `startMatch` solo un
  `MeshDepthMaterial` de 1,3-2,6 ms; ningún programa > 8 ms. Las mallas nuevas (manchas, cascarón, halos, halo LED) entran solas en `prewarmList()`.
- **ARN-08 luz como puntuación** (`MOOD`, `applyMood`, solo uniformes/colores/intensidades): punto de set/partido → `uCrowdLight` 1 → 0,5
  (grada 3D, impostores, banderas y ahora también peldaños/asientos/paredes de la malla estática vía `standDim`, y el cascarón), bruma +0,14,
  haces ×1,8, principal más fría, vallas con latido 0,8 Hz del color del equipo con el punto (uniforme `tint` del shader LED). Punto → contraluz
  teñido hacia el color del que anota (sube 0,3 s, vuelve a 0,95 s) + destello de vallas/halos escalado por `point.highlight`. `match` →
  barrido lento de los haces (atributo `aApex` + uniformes `sweep/uT`) y pulso de 0,3 Hz en la luz de grada; se borra en `newMatch`/`onGameStart`.
  Medido (cámara y animación de grada congeladas): zonas de grada −22 a −39 % de luma en el plano de saque; mismas llamadas y triángulos
  (48/48, 1,159 M). Contraluz tras un punto real: matiz 0,075 → 0,018 → 0,075 en 0,95 s.
- **ARN-09 cascarón** (`buildShell`, `SHELL_VS/FS`): la caja negra iluminada pasa a UNA malla sin luces: cubierta con paneles acústicos
  procedurales (juntas con fwidth, tono por panel, microperforado), degradado frío desde el centro, paredes con degradado y franja cálida del
  anfiteatro a 9,6-10,1 m (por encima de los anillos LED), pasarela técnica perimetral a 17,2 m, 2 racimos de altavoces junto al marcador
  colgado. Halos de focos con tamaño por lámpara ±12 % (`haloMaterial`, atributo `aS`; ya no es PointsMaterial). +~1,7 k triángulos, 0 dibujos.
  `ceil_up` (cámara 14,4,0 → 0,16,0, fov 70): cubierta luma 21,9-22,0, std 6,6-9,8. **No cumple** «hi1080 point top band ≥ 35»: el plano de
  punto actual encuadra la grada lateral (22,4); subir la caída de la grada de 0,42 a 0,5 solo daba +0,4 y rompía ARN-02, así que se deja.
- **ARN-10 tarima**: pista `#db9e5c` / borde `#cd9254` / zona de ataque `#bf7d47`; tablas de 1,8-3,6 m con tono ±0,16; brillo de barniz en
  bandas a lo largo. Medido ataque vs fondo: −13,1 (low720) / −17,6 (hi1080) de luma; std del fondo 9,2; pista 193-198, sat 0,36-0,40.
  Con anisotropía 1 sin moiré (`floor/c_aniso1.png`).
- **ARN-11 manchas de contacto** (fx.js `buildBlobs`/`setBlob`/`updateAthleteBlobs`): 1 `InstancedMesh` (5 instancias: balón + 4 atletas),
  mezcla multiplicativa `CustomBlending ZERO/SRC_COLOR`, igual con o sin post; sustituye a la sombra del balón (0 dibujos más). Lee la posición
  VISUAL de `VB.Players.rigs` (raíz, `yaw`, `lieW`); se apaga con la altura (0 a 1,5 m) y se alarga bajo el cuerpo en la plancha.
  Medido con los atletas ocultos: 29-31 % más oscuro en el centro (baja), 23-24 % (alta).
- **ARN-12 halo de las vallas**: tarjetas aditivas en el plano de cada valla (borde superior; también inferior en los anillos de grada), con el
  color medio del tramo de valla (mip bajo) o del mensaje. Van en la MISMA malla que los reflejos del suelo (`ledRefl`, `aCells.x` = tipo,
  `reflK`/`glowK`): media sin dibujos nuevos; baja +1 (esa malla antes se ocultaba). Apagado con bloom (alta de escritorio). Medido 10-20 px por
  encima de la valla del fondo: +21 a +23 de luma (baja y media), matiz del tramo de debajo. perf.js 844×390 ×4: baja 35/41 dibujos (media/máx.),
  89 k tri; media 49/53, 200 k (el PC estaba al 91-100 % por otros agentes: fps no válidos, aun así ≥ 80).
- **ARN-13**: confeti del partido DENTRO del plano (`confettiInFrame`: 4 cañonazos desde puntos del cuadro a 3,2-5,5 m de altura + cortina desde
  el borde superior; tamaño por distancia para medir ≥ 7 px; caída más lenta, 1,6 m/s). Medido: 271 papelitos dentro del frustum a 1,0 s (alta),
  109 (baja). `ctx.settings.softFlash` (lo pone UI-16): destellos/ondas de impacto, destello de vallas y halos, latido LED, subida del contraluz y
  filo de la cortina LED al 40 %; flashes de cámara de la grada al 35 % y más largos (0,3 s, sin estrobo). Medido (destellos aislados):
  salto máx. de luma media entre frames 0,21× (alta) / 0,24× (baja) del normal.
- **Extra (pulido)**: los mensajes de las vallas ya no sustituyen a las marcas de golpe: cortina de 0,38 s con filo de luz (`msgW`, `edgeK`);
  un mensaje encadenado recoge el anterior (0,27 s) antes de pintarse.

### Para el integrador / otros owners (ola 2)
- **ui_main (UI-16)**: el ajuste se lee como `ctx.settings.softFlash === true` (arena.js y fx.js, en cada frame; no hace falta llamar a nada).
- **lead / CONTRACT §4.4**: `VB.Arena._dbg().mood` (estado de luz; `mood.force` 0..1 fuerza la tensión en pruebas, -1 = automático),
  `_dbg().led` (`w` cortina, `GLOW`), malla `hallShell` (cascarón), `contactBlobs` (fx.js). Lectura nueva: `VB.Players.rigs[i].lieW` (solo lectura).
- Nada que cablear en main.js: todo lo nuevo se dispara con los eventos que ya llegan (`point`, `match`, `newMatch`) y el estado de `game`.

## De ui_main (pulido ola 2: UI-12, UI-16), 8-nov-2026
- `ctx.settings.softFlash` (bool, por defecto `false`, persistido; Ajustes > Accesibilidad > «Destellos suaves») ya existe siempre: ARN-08/ARN-13
  pueden leerlo directamente (`ctx.settings.softFlash === true` ⇒ destellos de luz y flashes suaves). ui.js apaga además su pulso de pantalla.
- UI-12: la viñeta CSS de media/baja imita la del post de alta (`P.comp` `vig = 0.32`, `smoothstep(1.25, 0.25, r·1,05)`); sale solo con
  `VB.Arena.postActive() === false`. Medido a 1280×720 (`tools/out/w2/vig.js`): esquina inferior izquierda −15,5 % en media/baja con la capa,
  −12,8 % en alta con el post (más −1,8 % del velo de siempre). Si cambiáis `vig` o la curva del post, avisad para reajustar las paradas.

## Aplicado (log, integración del pulido ola 2, segunda tanda, 8-nov-2026, PC de casa)
- Nada que cablear (como decías). CONTRACT §4.4: `_dbg().mood`, `_dbg().led`, mallas `hallShell` y `contactBlobs`, halos con `ShaderMaterial`,
  cortina de los mensajes LED, lectura de `rigs[i].lieW`.
- perf.js re-medido con el PC libre (CPU 35-37 %): 844×390 dpr 2,75 ×4 → auto→media 132,8 fps, alta 139,4, media 131,4 (198/203 k tri, 48/52 dibujos),
  baja 142,8 (90/119 k tri, 33/41 dibujos); 667×375 media 134,4, baja 149,4; escritorio 1280×720 alta (sin freno) 164,6 fps. «objetivos cumplidos».
- ARN-09 (franja alta del plano de punto ≥ 35) sigue sin cumplirse: depende del encuadre de camera_input; no se ha tocado.

## 13. Arreglos tras la verificación de la ola 2 (fixer arena, 8-nov-2026 noche)
Scripts y capturas en `tools/out/arn3/` (`calls.js` = dibujos por frame y por objeto en un partido en vivo; `ringshot.js`, `aimab.js`,
`billab.js`, `dropab.js`, `scrshot.js` = antes/después en la MISMA página; `lum/`, `m844/`, `dec/`, `pole/`).
- **Marcador del pabellón bajo el aviso del HUD en el móvil** (lo que se veía bajo «Bajo el balón y GOLPEAR» era el videomarcador del
  fondo, no el colgado): `screenVis(rdt, g)` atenúa al 22 % cualquier pantalla de marcador (fondos y colgado, con sus filos de luz) que
  quede en el 40 % superior del cuadro cuando el alto es ≤ 560 px CSS, en `playing` con `mode` `serve`/`rally` y sin cambio de campo.
  En el punto vuelve a encenderse (fundido de ~0,3 s), igual que en escritorio. Capturas `m844/sheet2.png` (844×390 baja, 667×375 media, 1280 sin cambios).
- **ARN-01 pista**: tinte de la tarima por nivel (`LT[i].floor`, `floorMat.color`: 1,11 baja / 1,09 media / 1,05 alta; solo la tarima, ni
  jugadores ni sombras). px.js rally 1920×1080 (700,700,1500,900): alta 192,5 / media 190,1 / baja 189,8; 1280×720 baja 190,2; sat 0,43-0,45;
  diferencia entre niveles 2,7. ARN-10 se mantiene (ataque vs fondo low720 −12,8, hi1080 −18; std fondo 7,4). Bloqueo hi1080: máx. 239 tras el jugador.
- **ARN-08**: `CROWD_DIM` 0,5 → 0,45. moodm.js (serve 1280×720, grada): −17,9 / −27,8 / −20,5 % (media −22 %).
- **ARN-12 dibujos en baja** (el ≤ 35 se toma como PICO, frame a frame): de 34,9 medios / 43 máx. a **30,3 / 35** (7389 frames, 45 s de partido
  autopilot 844×390 dpr 2,75; `calls.js low 45`); media 39,3 / 45 (antes 49 / 53). Nada cambia de aspecto (comparado en la misma página):
  - antenas + postes + protecciones en UNA malla (`poles`, atlas 512×512 y PBR por vértice `aPbr`): −2 dibujos siempre y −2 en sombras (media/alta).
  - fx: aro de golpeo (relleno + diana + aro móvil) en UN plano con shader que compone las 3 capas (`focusRing`; `_dbg().ringD/ringOp`).
  - fx: calcomanías del suelo (marcas del bote y sus filos, ondas, marcador de caída, retícula de apuntado y la línea de altura como tira de
    ~1,3 px) en UN InstancedMesh (`floorDecals`, atlas 1024×512). Las mallas de antes siguen como estado fuera de la escena (`writeDecals`).
  - fx: destellos + ondas de choque (8 Sprites) en UN InstancedMesh aditivo orientado a cámara (`impactBills`).
  - fx: las chispas ya no dibujan el pool vacío en cada frame (`sparks.visible` solo con chispas vivas).
  - arena: los filos de luz de las 3 pantallas van dentro de la malla emisiva (`aScr` + uniforme `uScrVis`; con post ×1/2,2 para compensar el ×2,2 de los emisivos).
  perf (copia con espera de arranque, `tools/out/arn3/perfw.js`, válida, PC 49 %): baja 123,1 fps, 30/34 dibujos (muestras de 1 s), 89-90 k tri.
- ARN-05 re-medido con el plano único (`arn/ring.js 3`): 599 frames en rango, error máx. 0,0 %, coincide en press 0.
- Nombres nuevos (para herramientas): `floor`, `outerFloor`, `netFront/netBack`, `poles`, `endScreen`, `hallName`, `halos`, `camFlashes`,
  `focusRing`, `floorDecals`, `impactBills`, `sparks`, `dust`, `confetti`, `ball`, `ballOutline`, `trail`, `aimArc`. `_dbg().screens` (arena).

### Para ui_main
- `tools/perf.js` llama a `startMatch` a los 1,5 s de navegar; con CPU ×4 y el PC cargado el arranque (precompilado + primer dibujo) tarda
  2,4-3,3 s (igual con el arena/fx de antes) y sale «no arranca el partido: menu». Propuesta (la usa `tools/out/arn3/perfw.js`):
  ```js
  let ok; for (let tr = 0; tr < 40 && ok !== 'playing'; tr++) {
    ok = await page.evalJs("(function(){if(!window.VB||!VB.ctx||!VB.ctx.actions)return false;VB.ctx.actions.startMatch({autopilot:true});return VB.ctx.state})()");
    if (ok !== 'playing') await CDP.sleep(500);
  }
  if (ok !== 'playing') throw new Error('no arranca el partido: ' + ok);
  ```
- `ctx.prewarm`: los programas nuevos (`vb-pole-pbr`, `vb-emis-top-scr`, aro, calcomanías, destellos) entran solos por `prewarmList()`.

## Aplicado (log, integración de los arreglos tras la verificación de la ola 2, 8-nov-2026 noche, PC de casa)
- perf.js: la propuesta de §13 aplicada (ui_main ya sondeaba `'playing'`; el integrador añade repetir `startMatch` cada 0,5 s hasta ~20 s).
- CONTRACT §4.4: mallas fusionadas y nombres nuevos, `FX._dbg()` (`ringD/ringOp/decals/decOrder/bills/billOrder/dropLine`), `Arena._dbg().screens`,
  `LT[i].floor`, atenuación de marcadores en pantallas bajas.
- perf.js en la integración (844×390 dpr 2,75 ×4, 20 s, PC 34-43 %): auto→media 130 fps, alta 138,9, media 130,4 (199/203 k tri, 39/43 dibujos), baja 152,3
  (89/90 k tri, 30/36 dibujos); escritorio 1280×720 alta sin freno 164,3 fps. «objetivos cumplidos». Retenido < 1,2 MB.

## 14. Pulido, ola 3 (arena, 8-nov-2026 noche): ARN-14, ARN-15, ARN-16 (+ ARN-09 re-medido, halo LED)
Scripts y capturas en `tools/out/arn4/` (`views.js` = una carga y cámara libre a vistas fijas, `anim.js` = secuencias, `sheet.js` = hojas de
contacto, `ik.js` = IK numérico de los brazos de makePerson, `cpucost.js`/`crewcost.js` = coste por frame, `ptband.js`/`band.js` = franja alta).
- **ARN-16 silla del 1.er árbitro y mesa del anotador** (todo en la malla `props`, 0 dibujos nuevos, +1 064 triángulos en `props` y +36 en `emissive`):
  `Builder.cbox()` = caja achaflanada (aristas verticales y bisel superior, ~44 tri; `chamferGeo` con caché). Silla: acolchado como la protección
  de los postes (azul marino `#1d4a6e`, banda naranja abajo, filete amarillo arriba), base/columna/plataforma/peto achaflanados, remates redondos en
  la barandilla acolchada, zancas inclinadas y pasamanos de acero a los dos lados de la escalera con poste al pie. Mesa: tablero achaflanado con canto
  naranja hacia los anotadores, laterales acolchados, sillas acolchadas, acta electrónica (tableta inclinada con pantalla encendida, tono bajo, sin
  bloom molesto) para cada anotador, monitor central de cara a ellos, paletas de cambio numeradas (naranja en x > 0 = equipo 0, azul en x < 0) y zumbador.
  Capturas: `arn4/w5/high_refC.png`, `high_refB.png`, `high_refstand.png`, `high_scorerC.png`, `medium_scorerC.png`.
- **ARN-14 entorno de pista** (`buildCrew`, `crewStep`, `crewReact`): 2 banquillos (tarima con filo de luz del color del equipo, banco con cojín
  del equipo, caja de botellas, toalla) con 3 suplentes sentados con la equipación (canesú de acento, pantalón corto, calcetín, rodillera) y el
  entrenador de pie (polo con cuello del equipo); 4 fotógrafos arrodillados en las esquinas tras los fondos (peto de prensa, cámara con
  teleobjetivo claro/negro); cámara de TV en tarima tras las vallas del lado −y (x = −2,7) con operador con auriculares. Fuera de la zona libre
  (bancos en y = 10,2-11,0; entrenadores y = 10,5; fotógrafos |x| ≥ 16,25 en los huecos de las esquinas; TV y = −10,6). makePerson amplía opciones:
  `lo` (versión ligera, ~1,6 k tri por persona), `kneel`, `shorts`, `spread`, `restR/restL` = [x, z, y, e, t] como POSE (IK resuelta con `ik.js`),
  `lean`, `upperProps/headProps/rootProps/extraBones`; el tronco usa orden `YXZ` (giro del fotógrafo). Van en la MISMA SkinnedMesh `officials`
  (0 dibujos nuevos). **Baja**: el 3.er suplente de cada banquillo y la cámara de TV quedan al final del índice y `setQuality` los recorta con
  `geometry.setDrawRange` (`userData.lowIdx`): ni se dibujan ni cuentan triángulos. Animación (misma técnica sin basura que los oficiales, a media
  cadencia: cada frame la mitad del entorno con dt doble): cabezas que siguen el balón, posturas de espera que se alternan cada 4-11 s (manos en las
  rodillas / en el regazo / inclinado; entrenador: brazos cruzados / manos en la cintura / mano en la barbilla), fotógrafos que giran el tronco con
  la cámara y tras un punto a veces la bajan para mirar la pantalla, panorámica/inclinación suave de la cámara de TV hacia el balón. Puntos: el
  banquillo que gana aplaude (entrenador: puño y aplauso), el otro baja la cabeza y su entrenador se lleva las manos a la cabeza si el punto es
  grande (`highlight ≥ 0,6`) o cierra set; partido: brazos arriba con vaivén. Capturas: `arn4/w4/high_endwide.png` (banquillos, prensa, barandilla),
  `crop_left.png`, `w2/high_benchC*.png`, `w2/high_photoC*.png`, `w2/high_tvC.png`, `w3/low_press.png` (baja: 2 suplentes, sin TV); secuencias
  `arn4/clap0.png`, `win1.png`, `idle.png`, `chimp.png`, `tvpan.png`.
- **ARN-15 grada**: barandilla de vidrio y acero sobre el antepecho de las 4 gradas (`buildRailing`: postes cada ~1,5 m, pasamanos tubular, perfil
  de apoyo, canto del vidrio con filo tenue; el vidrio son paneles aditivos «tipo 3» en la malla `ledRefl`, uniforme `glassK`, cara hacia la pista).
  `buildLED` ya no cierra `ledRefl`: lo hace `finishLedRefl()` tras la grada. Tribuna de prensa (`buildPress`, `PRESS_X` 6,45, filas 0-3 del lado
  +y): filas pares = mesas corridas con faldón y filo de luz fría; impares = periodistas (asientos `press:true`: camisas sobrias, energía 0,06 → no
  saltan, y `vbWave` × `step(0,2, aAnim.y)` → tampoco hacen la ola; programa `vb-crowd-6`) con un portátil por plaza (pantalla encendida hacia el
  periodista, piloto en la tapa hacia la pista). Público: 3 076 → 3 039 instancias (no crece). Vomitorios: los de la ola 2.
- **ARN-12 (extra)**: el halo de las vallas tomaba UNA muestra de mip 6 y de cerca salía a rayas («código de barras», visible en media al lado de
  la mesa): ahora 3 muestras de mip 7,5 repartidas a lo ancho (color medio del tramo). `arn4/w5A/medium_railE.png` (antes) vs `w6/medium_railE.png`.
- **Medidas**: triángulos por malla (baja): `officials` 21 876 → 44 175 (recorte de baja 38 850), `static` +3 388 (barandillas, prensa, bancos,
  tarima TV), `props` +1 064 (ARN-16), `emissive` +1 128, `ledRefl` +212. perf.js 844×390 dpr 2,75 ×4 (PC al 71-88 % por otros agentes): media
  77,8 fps, 245/250 k tri, 40/43 dibujos; baja 75,5 fps, 114/128 k tri, 30/34 dibujos; montón 8,5→9,9 MB (plano); «objetivos cumplidos». Repetido con el PC más libre (47-64 %, medida válida): media 108,5 fps (p5 82),
  247/251 k tri, 40/44 dibujos; baja 94,8 fps (p5 54,9), 113 k tri, 30/35 dibujos; «objetivos cumplidos».
  Escritorio 1280×720 alta: 162,7 fps. Coste del entorno (misma página, CPU ×4, mediana, encendido/apagado alternos): ~0,1 ms por frame.
  ceil_up: cubierta 21,9 (std 6,8) / 23,3 (std 11,9) en el centro (sin cambios). **ARN-09 sigue sin «hi1080 point top band ≥ 35»**: el plano de
  punto encuadra la mitad alta de la grada lateral; 15,3 sin HUD / 20 con HUD (con `uCrowdLight` 1,6: 21,6). Llegar a 35 exige iluminar toda la
  grada alta ×2,2 y rompe la jerarquía de valores de ARN-02; no se fuerza.

### Para el integrador / otros owners (ola 3)
- **lead / CONTRACT §4.4**: `VB.Arena.landmarks.benches[2]` (equipo 0 en x > 0), `.photographers[4]`, `.tvCamera` (coords de sim, fuera de la zona
  libre: objetivos de plano, no posiciones de cámara); `_dbg().crew` (entorno), `_dbg().crewReact(team, big, 'point'|'set'|'match')`, `_dbg().POSE`;
  `officials` incluye ahora el entorno (`userData.lowIdx` = recorte de baja); `ledRefl` tipo 3 (vidrio, `glassK`); `Builder.cbox`.
- Nada que cablear en main.js: las reacciones salen del evento `point` que ya llega.

## Aplicado (log, integración del pulido ola 3, 9-nov-2026, PC de casa)
- CONTRACT §4.4: `landmarks.benches/photographers/tvCamera`, `_dbg().crew/crewReact/POSE`, `officials` con el entorno (`userData.lowIdx`), `ledRefl` tipo 3, `Builder.cbox`, `vb-crowd-6`.
- Plano del banquillo ganador (petición opcional a camera_input): no hecho en esta ola (camera_input no lo implementó; queda como idea).
- perf integrado 844×390 ×4: baja 112 k tri / 31-34 dibujos; media 246-251 k tri; ARN-09 sigue parcial (decisión pendiente: encuadre o relajar el objetivo).

## Arreglos ola 4 (arena, 9-nov-2026)
- Señal `antenna` del 1.er árbitro: ahora «balón fuera» (POSE.outFa, las dos manos), como dice la tabla §10; señalar la antena queda solo para el juez de línea (`judgeSignal`). Se quita `POSE.antenna` (sin uso). Capturas: tools/out/arn-w4/sig/{out,antenna}-c.png (idénticas); dibujos 23 → 23 en baja.
- ARN-02 (saturación de grada lateral): `vbCrowdTone` desatura 0,33 + k·0,3 (antes 0,28), camisetas de afición con `SHIRT_DESAT_TEAM` 0,30 (neutras 0,25), `nLight` algo más apagadas, asientos `seatA/B/C` con menos croma y bruma `uHazeC` más neutra. hi1080 rally: (1600,150,1900,300) sat 0,413 / std 31,3 (antes 0,440 / 32,2); (700,120,1400,300) sat 0,380 / std 27,0. Pista 192,5 (sin cambio). Solo colores: dibujos y triángulos iguales.

## Aplicado (log, integración de los arreglos tras la verificación de la ola 3, 9-nov-2026, PC de casa)
- CONTRACT: `POSE.antenna` fuera; la señal `antenna` del 1.er árbitro es `POSE.outFa` (§4.4, añadidos de los arreglos ola 3).
- **Cambio del lead en arena.js (rendimiento, primer punto en el móvil)**: `warmMsgFonts()` (al construir y otra vez en `document.fonts.ready`) crea de antemano, en un lienzo de 8×8, las tallas de letra del mensaje del videomarcador (`drawMsgOverlay`: italic 900 a `bh·0,46`/`bh·0,6`, 800 a `bh·0,22`, en el ancho y el colgado) y la de las vallas (`drawMsg`, italic 900 a `H·0,66`), y da forma a sus textos (PUNTO/SET + equipo, HOW, REASON, mensajes de las vallas). Medido con `tools/out/w4lead/trace3.js` (partido real, 844×390 dpr 2,75 CPU ×4): en el primer punto `measureText` de `fitFont` era ~65 muestras (~45 ms) de un frame de 155-163 ms; ahora no aparece o 5 muestras, frame del primer punto 89-118 ms (3 tomas). Sin dibujos ni texturas nuevas.
- ARN-02 y la señal de antena vistos en las capturas `tools/out/w4lead/hi/*.png` (alta 1280×720) y `lo/*.png` (baja 844×390).
- Verificado en el árbol integrado: simtest completo + barrido `simtest <10|20> <1..25> 0` 50/50 TODO OK; console.sh 19 escenas (1280×720 y 844×390 táctil) sin errores; drive, touchplay, padplay (estándar y DualSense) y audiotest completo TODO OK; perf 844×390 ×4 «objetivos cumplidos» (ver TRASPASO).

## Sprint 9-nov-2026 tarde: remate apuntado (A4) y challenge (B6)
- **A4 (fx.js)**: la retícula del remate sale desde el despegue cuando `g.aim3.on` (antes: `hp.z >= 0,12` y balón sobre la red) y va a
  `g.aim3.x/y` (o lo que devuelva `Sim.aimPoint`). Su RADIO = `out.spreadNow` (mín. 0,25 m, tope 2,2 m; `AIM_R1` = 0,584 m es el radio del
  aro de `aimTex` a escala 1), suavizado 22/s. Con dispersión ≤ ~0,25 m pasa de naranja a amarillo dorado y late más rápido (≤ 0,12 m).
  Disco tenue del mismo radio debajo (`aimFill`, celda de `fillTex`). Con mira libre la retícula sigue el punto sin retardo (la sim ya lo suaviza).
  Saque: sin cambios. `g.digTight === true` → el aro de golpeo (`focusRing`) entero ×0,7 (`DIG_TIGHT`; las escalas relativas de las 3 capas no
  cambian: sigue cerrándose en press = 0). `_dbg().ringD` devuelve ya el diámetro ×0,7.
- **B6 (fx.js)**: durante `g.review` (y 2,2 s tras el resultado) huella del balón en (x, y) con borde nítido (`revTex`, celda 7 del atlas; radio
  `C.BR` hacia la línea y +18 % a lo largo) y la línea más cercana (fondo |x| = HL o lateral |y| = HW, 5 cm por dentro) resaltada en cian con
  halo (`revLine` celda 6 blanca, `revGlow` con `fillTex`). La huella aparece a `review.t` 0,55-0,9 s, blanca; con `challengeResult` se tiñe
  verde (dentro) / rojo (fuera) según `truthIn`. El evento `challenge` borra las marcas del bote (llevan la llamada del árbitro).
  Todo va en el lote `floorDecals`: **0 dibujos nuevos** (N de instancias 17 → 21).
- **B6 (arena.js)**: evento `challenge` → 1.er árbitro: silbato + `POSE.chal` (los dos índices dibujan un rectángulo, vaivén 9, 2,6 s;
  `R1.sig = 'challenge'`), vallas «VIDEO CHALLENGE», pantallas «CHALLENGE / REVISIÓN · equipo», la grada deja de animar.
  `challengeResult` → marcador desde `g` (`scoreFromGame`), pantallas «IN|OUT · x,x cm» + «PUNTO equipo» / «SE MANTIENE», brazo hacia el
  equipo que gana el punto; si se anula, ánimo de ese lado y reacción del banquillo. «VIDEO CHALLENGE» añadido a `warmMsgFonts`.

## Sprint cartoon (arena_fx, 9-nov-2026 noche): restyle del pabellón, VB.TOON y FX de dibujo
Capturas: antes `tools/out/cartoon/antes/arena/` (serve, rally, spike, block, point, dive, menu; `touch/` = 844×390 táctil en baja);
después `tools/out/cartoon/despues/arena/` (las mismas + `fx-spike.png`, `fx-block.png`, `fx-dive.png` con los FX inyectados:
`tools/out/cartoon/fxinject.js`, uso en su cabecera).
- **VB.TOON (contrato del sprint, en arena.js; se crea al cargar el script si `window.THREE` existe y, si no, en `Arena.init`)**:
  `{ gradientMap, ink: 0x1d1530, shadow: 0x2b2547, enabled, rank, px, toonMat(params), outline(mesh, metros), setQuality(q), frame(cam, h), _list }`.
  - `gradientMap`: DataTexture RGBA de 10 texels NEAREST con 3 niveles lineales 0,18 / 0,55 / 1 (N·L < 0 sombra, 0..0,4 media, > 0,4 luz).
  - `outline(mesh, m)`: casco invertido (MeshBasic BackSide, normal empujada DESPUÉS del esqueleto: vale para Mesh, SkinnedMesh
    —mismo esqueleto y bindMatrix— e InstancedMesh —comparte instanceMatrix y count—). Grosor = max(m, ~1,8 px CSS a 720 p, escalado
    con el alto del lienzo entre ×0,75 y ×1,6). Se cuelga como hijo de `mesh` y se devuelve SIEMPRE (no null): en calidad baja queda
    oculto y vuelve al subir. `userData.inkRank` (1 media, 2 solo alta) y `userData.inkOn = false` para apagar uno. 1 dibujo por contorno.
  - `toonMat(p)`: MeshToonMaterial con el gradientMap puesto.
  - players: si usa `VB.TOON.outline` en sus SkinnedMesh no tiene que hacer nada más (calidad y grosor por píxel los lleva arena).
- **Pabellón**: paleta nueva (PAL; pista miel `#f7c470`, zona libre azul plano `#1f8fd0` con anillo más claro, gradas y paredes azul violáceo);
  tarima redibujada: tablas de 15 cm en 3 tonos de bloque, juntas de tinta, vetas como arcos sencillos, 2 brillos de barniz «pintados» y
  filo de tinta POR FUERA de las líneas (las líneas FIVB no cambian). Asientos por bloques de 6 colores (`SEAT_BLOCKS`, sin tocar la secuencia
  aleatoria del público). Techo luminoso azul violeta, paredes, pasarela y pilastras más claras, niebla `#1d1a44`. Público algo más saturado
  (`SHIRT_DESAT` 0,12 / 0,15).
- **Materiales toon** (sin especular ni entorno): tarima, suelo exterior, red, antenas/postes/protecciones (`aPbr` queda en la geometría sin uso),
  malla estática de gradas + utillaje, oficiales, banderolas. Público 3D, impostores, LED, pantallas y cascarón: sin cambios de técnica.
- **Luces**: mismas intensidades (los atletas se ajustan contra ellas); hemisférica cielo `#d6d0ff` / suelo `#5a4f8c` (sombras violáceas, no negras).
  `LT[i].floor` (tinte del toon de la tarima) 0,68 / 0,72 / 0,64: con 1 el ACES lavaba la pista. El mapa de entorno PMREM sigue (lo usan los
  materiales Standard que queden, p. ej. los de players si no pasan a toon).
- **Contornos de arena**: postes/antenas (`poles:ink`, 0,4 k tri), utillaje (`props:ink`, 2 k) en media y alta; oficiales (`officials:ink`, 44 k)
  solo en alta (en media el presupuesto de 350 k no da).
- **fx.js**: balón MeshToon con paneles planos y costuras de tinta (sigue el brillo de borde y el calor), contorno de tinta ~2 px (se mantiene en
  todas las calidades: es legibilidad); sombras de contacto como disco de borde definido y violáceo. FX cartoon en UN InstancedMesh (`toonFx`,
  atlas 1024×512, mezcla normal, 0 dibujos si no hay nada vivo): estrellas de impacto (remate, saque fuerte, bloqueo, toque perfecto), explosión
  de cómic (remate, saque fuerte, bloqueo directo), chispas de 4 puntas (toques suaves, red), nubes de polvo de dibujo (plancha, aterrizajes,
  botes fuertes, `VB.FX.dust`), líneas de velocidad que siguen al balón (remate fuerte o perfecto, saque en salto) y «¡PAM!» en el remate
  perfecto del humano. Tope de tamaño en pantalla por tipo (`TB_MAXF`) y casi transparentes pegados a la cámara; con bloom el dibujo se queda
  bajo el umbral (`uGain` 0,8). Calidad baja: mitad de estrellas y nubes, sin líneas ni onomatopeya. softFlash: explosión al 45 % sin rebote,
  onomatopeya más pequeña y translúcida. El destello aditivo baja de 0,62 a 0,48 (`FLASH_K`).
  API nueva opcional: `VB.FX.stars(x, y, z, n, size)`, `comicBurst(x, y, z, size)`, `puffs(x, y, n, dirx, diry, size)`, `onomatopoeia(x, y, z)`;
  `_dbg().toon`, `_dbg().toonN`.
- **Rendimiento** (`perf.js 844x390 15 high,medium,low`, PC cargado por los otros flujos del sprint: fps no válidos): low 31/34 dibujos y 113 k
  triángulos (objetivo ≤ 60 / ≤ 150 k), medium 282 k en `debug=rally` tras quitar el contorno de los oficiales (antes de quitarlo 313-327 k),
  objetivos cumplidos. Repetir con el PC libre.

### Para otros owners (sprint cartoon)
- **ui_main (main.js)**: el ACES (`toneMapping`) desatura y aplasta los colores planos del cartoon; arena lo compensa con tintes, pero merece
  probar `THREE.LinearToneMapping` (exposición ~0,9) o ACES con `toneMappingExposure` 0,85 cuando estén players y UI.
  Ajuste opcional que fx.js ya respeta: `ctx.settings.comicText === false` apaga el «¡PAM!» (si se quiere una fila en Ajustes · Accesibilidad).
- **Challenge fallado: la red cruza el cartel «OUT»**: no es de arena/fx. El cartel es el de ui.js (`banner(io, …)`) o el texto «IN|OUT · x cm» de
  los videomarcadores; la malla solo puede cruzarlo si la cámara de punto queda detrás de la red (camera_input: no poner el plano del punto/revisión
  con la red entre cámara y objetivo) o si el fondo del cartel de ui es translúcido (ui_main: fondo opaco). Arena no oculta la red a propósito.

### Integración (9-nov-2026)
- `VB.TOON.outline(mesh, m, opts)` acepta `opts = {max, k}` (tope en metros y multiplicador de píxeles) y el atributo `ow` por vértice. players lo usa para
  los atletas (`OUT_MIN`, `{max: OUT_MAX, k: OUT_PX / VB.TOON.px}`): un único contorno y una única calidad. Nuevo `VB.TOON.drop(o)`.
- Arreglo: la tinta (`uInk`) se creaba al cargar arena.js, antes de que main.js ponga `ColorManagement.legacyMode = false`, y salía lavanda (~#6a5a90 en
  pantalla) en postes, mobiliario y árbitros. `frame()` la vuelve a fijar una vez, ya en modo lineal: ahora es #1d1530, como el contorno de los atletas.

### Arreglos finales del sprint cartoon (9-nov-2026)
- **ARN-12 en baja (pico 37 → 35)**: fx.js `_event` con `tbSwap = tbLow && toon`: en baja, donde salen estrellas/explosión de cómic
  (remate, saque rápido, toque perfecto, bloqueo, bote fuerte) no se lanzan chispas, destellos ni ondas (la explosión de cómic hace de
  destello). Además `burstAt` no lanza chispas en baja con piezas cartoon vivas, y `tbAdd` descarta la pieza (hueco mudo `tbMute`) si en
  baja ya se dibujan chispas e `impactBills` a la vez. Medido (`tools/out/cartoon/fix/calls.js low 40`, 844×390 dpr 2,75): 30,5/35,
  30,5/35 (seed 77), 29,0/34 (seed 5); antes 30,5/37. perf.js exige ahora ≤ 35 dibujos de pico en baja (antes ≤ 60): baja 29/34.
- **Público cartoon**: el público 3D pasa de Lambert a MeshToonMaterial con rampa propia (0,5 · 0,78 · 1, `crowdRamp`); neutros de
  colores de bloque (mismo número de entradas: la secuencia aleatoria no cambia); caída con la altura 0,42 → 0,6 y desaturación
  0,33 + k·0,3 → 0,12 + k·0,22 (también en los impostores, mismo GLSL). Programa `vb-crowd-7`. Triángulos y dibujos iguales.
- **Red con contorno**: tinta #1d1530 pintada en la textura de la red (filo de las dos bandas y de los extremos, ~2,5 cm): 0 dibujos.

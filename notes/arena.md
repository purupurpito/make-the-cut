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

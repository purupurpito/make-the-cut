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

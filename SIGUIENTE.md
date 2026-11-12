# Siguientes tareas (traspaso para otras sesiones, 11-nov-2026)

Este fichero recoge lo que Ferran ha pedido y aún no está hecho, con todas las decisiones que ya tomó. Cada **lote** se puede
trabajar en una sesión distinta y en paralelo: cada uno tiene sus ficheros y no debe tocar los de otro lote. Si necesitas un
cambio en un fichero ajeno, apúntalo aquí, en «Peticiones entre lotes», y no lo hagas tú.

Contexto general: CONTRACT.md (propiedad de ficheros y API), TRASPASO.md (backlog completo e historial), notes/*.md (una nota
por sistema) y notes/ui_main.md (guía de estilo de textos).

## Reglas que valen para todos los lotes
- **Git**
  - Commit y push como purupurpito: `export GH_TOKEN=$(gh auth token -u purupurpito)`. Al final de cada mensaje de commit,
    `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Con varias sesiones a la vez, antes de cada commit haz `git pull --rebase` y añade solo tus ficheros con
    `git add <ficheros>`, nunca `-A` sobre todo el árbol.
  - Los agentes de un workflow NUNCA hacen commit, push, checkout, reset ni stash.
- **Publicar y comprobar.** Publicar = push a main; GitHub Actions publica en Pages
  (https://purupurpito.github.io/make-the-cut/). DESPUÉS DEL PUSH, COMPRUEBA QUE EL RUN DE ACTIONS ACABA EN «success»
  (`gh run list -R purupurpito/make-the-cut -L 1`). El 11-nov se pasaron horas creyendo publicado algo que fallaba en CI.
  El CI pasa simtest.
- **Huella 2v2.** `node tools/simtest.js` debe decir «huella 2v2 idéntica». Ningún lote de este fichero debe cambiar el 2v2,
  salvo el lote B (cámara lenta), que solo toca la cámara y la UI, no la sim. tools/fingerprint6.js compara posiciones con
  tolerancia 1e-7 (Linux y Windows redondean distinto).
- **Pruebas antes de publicar**
  - `node tools/simtest.js`, `tools/badgetest.js` y `tools/careertest.js`.
  - `bash tools/console.sh all`, también con `EXTRA=format=6v6` y `EXTRA=map=beach`.
  - `node tools/drive.js 1280 720 30` y `node tools/drive6.js 1280 720 60` (y con `TOUCH=1`, 844 390).
  - `tools/touchplay.js 844x390 25` y `tools/padplay.js 1280 720 20`. Fallan a veces en «3 toques»: repítelos.
  - `tools/cam6test.js`, `tools/tv6test.js` y `tools/perf.js`.
  - Capturas con `tools/shot.js <escena> W H out.png [k=v]`, `tools/eval.js` (SHOT=, TOUCH=1) y `tools/cam6test.js`;
    míralas.
- **Textos** (guía en notes/ui_main.md)
  - Etiquetas cortas con abreviaturas («Nv 1», «⇄ Saque»).
  - Separadores variados según contexto (sepHTML/setSep de ui.js: 'd' rombo, 'v' barra, 's' barra inclinada, 'c' pastilla),
    nunca «·» para todo.
  - Ordinales «1r», «2º», «3r»; NUNCA «1.er», «2.º» ni «3.er» (función `ordn` en career.js y career-ui.js).
  - Se mantienen «Dobles» y «Falta de saque: 8 segundos» (en la playa son 5).
- **Juego**
  - **Género neutro:** el juego no separa por género.
  - **Correo:** el correo de la cuenta de Google de pruebas de Ferran no se escribe en ningún fichero.
  - **Repo de redirección:** `purupurpito.github.io` no se crea sin que Ferran diga que sí.
- **Versión (sprint 5).** Cada publicación visible sube `VB.VERSION` en js/version.js y añade su entrada al principio de
  `VB.CHANGELOG` (textos cortos, sin «·» ni «navegador»). build-pages falla si no cuadran. `node tools/abouttest.js` lo comprueba.
- **Pruebas nuevas (sprint 5):** `tools/settest.js`, `tools/keytest.js`, `tools/animtest.js`, `tools/gymtest.js`, `tools/abouttest.js`,
  `tools/audiotest.js`, y `node tools/fingerprint6.js --variant mastery` («huella de la maestría idéntica»).
  Al tocar el juego del humano, mirar también `SIMTEST_MASTERY=1 SIMTEST_ONLY=matrix node tools/simtest.js 0 <semilla> 20 <n>`: todo
  partido 2v2 de verdad va con `mastery:true` y la matriz por defecto no lo cubre (así se vio que el colocador plantado bajaba la escala).
- **Fusión pendiente (sprint 5):** la rama sprint5 salió de 6313ac5 y origin/main va 10 commits por delante (lote C y 0565a4f). Al
  fusionar: resolver los 15 ficheros tocados por los dos lados, repasar los ganchos de career-world con el career.js de lote C, pasar
  simtest, fingerprint6 y careertest (con y sin `NOWORLD=1`) y regenerar `tools/fp-mastery.json` (`--variant mastery --write`).

---

## Lote A: 6v6 con todas las posiciones, rotaciones de verdad y pistas dibujadas en el campo
**Estado (11-nov-2026): HECHO y publicado** (ver notes/sim.md «6v6, lote A»). Queda: la petición a main.js de abajo (hasta entonces
ui.js aplica el puesto con `VB.Sim.setCtrlRole` al empezar), el texto de CONTRACT §4.3, la IA no coloca pipe en salto, los aros tenues y
el chevrón se leen justos a 844×390, y el equilibrio de Fácil (novato 65,8 %: decisión de Ferran). Decisión tomada sin Ferran: cuando el
líbero entra por el central del humano, el humano lleva al líbero hasta que su central vuelve (así «sale por el líbero» y sigue jugando).
**Ficheros:** js/sim.js (solo 6v6: `g.rot`), js/ai6.js, js/fx.js, js/players.js, la parte 6v6 de js/ui.js (coach6, fila
Controlar, roleName), tools/simtest.js (sección 6v6), tools/drive6.js, notes/sim.md.

**Lo que pide Ferran**
1. **Jugar en cualquier posición.** Hoy solo se puede llevar al receptor (`CTRL_ROLES6 = ['OH']` en sim.js). Hay que añadir
   colocador, opuesto y central. El líbero queda fuera salvo que Ferran diga lo contrario, porque solo juega atrás.
   - **Dónde se elige:** en la fila «Controlar» de la preparación (hoy está fija en «Receptor»).
   - **Colocador humano:** el 2º toque es suyo. Necesita elegir a quién colocar (dirección del stick o botón) y la
     colocación en salto.
   - **Central:** bloqueo, primer tiempo y salida por el líbero cuando pasa a zaguero.
   - **Opuesto:** ataque por zona 2/1 y bloqueo al receptor rival.
2. **Pistas visuales en el campo** en lugar de texto. Por ejemplo: «cuando toca bloquear, un círculo cerca de la red, o algo».
   - Una marca en el suelo para cada fase: bloquear (dónde saltar junto a la red), recibir (tu zona), colocar (punto de
     colocación), atacar (zona de batida) y defender (dónde cubrir).
   - Más pistas en los niveles bajos y menos en los altos.
   - Ya existe el aro celeste `posMark` de fx.js, que marca el sitio del humano sin balón: amplíalo.
   - Dibuja dentro del lote de calcomanías que ya existe, sin subir las draw calls. Topes de perf.js en 6v6: media ≤ 350 k
     triángulos; baja ≤ 45 dibujos.
3. **Rotaciones como en el vóley real** («así parecerá más VOLEY»). Hoy hay un 5-1 básico (notes/diseno-6v6-carrera.md §1.2).
   Repásalo y replica:
   - **Recepción:** las 6 formaciones del 5-1, una por rotación, escondiendo al colocador. Reciben 2 o 3 (líbero y
     receptores) y no hay falta de posición.
   - **Penetración** del colocador zaguero en cuanto saca el rival.
   - **Cambio a los puestos de especialidad** tras el saque: colocador a la derecha, centrales al centro, receptores a la
     izquierda.
   - **Líbero:** entra y sale por el central zaguero. El central que saca no es sustituido; si su equipo pierde el saque,
     entra el líbero.
   - **«Pipe»:** ataque de zaguero desde detrás de los 3 m. Hoy no existe.
   - **Defensa en perímetro** y **cobertura del atacante propio** (agachados alrededor del rematador).
   - **Falta de posición** pitada si hay solapamiento en el saque, sobre todo en Difícil/Experto. Hoy al humano se le coloca
     en `placeServe`; con las rotaciones nuevas, valora dejarle colocarse él en los niveles altos.
   - Opcional, para más adelante: sistemas 4-2 o 6-2 como opción.
   - Si el humano está en una posición, que siga esas mismas rotaciones, y que las pistas del suelo le digan adónde ir en
     cada una.

**Contexto del 6v6 hoy**
- El humano NUNCA se mueve solo (decisión de Ferran: «deja que el jugador decida»). Sin stick, 0 m (simtest 6v6 (e)).
- Los compañeros no le quitan sus balones (`humanOwns`/`computeJob` en ai6). El colocador solo le coloca si está en la batida
  (`setReady`).
- «¡Pídela!» = CAMBIAR (botón ⇄ / RB / C).
- Cámara en 3a persona por defecto; Televisión como opción (ajuste `cam6`, camera.js `tpShot`).
- **Decisión pendiente de Ferran:** el equilibrio de Fácil. El equipo humano gana mucho: el novato en Fácil se lleva el 61 %
  de los puntos.

## Lote B: la cámara lenta antes de golpear, solo en niveles bajos o en las primeras partidas
**Ficheros:** js/camera.js y, de js/ui.js, solo el bloque de cámara lenta del principiante (alrededor de la línea 1444,
`slowmo(0.4, 1.3, 0.35)`). notes/camera_input.md.

**Lo que pide Ferran:** «el modo este que mete como una cámara lenta antes de darle a la pelota solo exista en niveles bajos o
las primeras partidas. Hace el juego demasiado fácil».
1. Haz inventario de todas las cámaras lentas e hit-stops que pasan ANTES de que el humano golpee: `VB.CameraRig.slowmo` y
   `ctx.timeScale` en camera.js (27 apariciones) y en ui.js.
2. Que solo actúen en Fácil o en los primeros partidos del jugador (récord en `voley3d.record`; mira cómo se calcula el
   novato). A partir de Normal, nada.
3. Lo que pasa DESPUÉS de la jugada se puede quedar: cámara lenta del punto de set o de partido, repeticiones, hit-stop del
   remate ya golpeado. Justifica cada uno.
4. Vale para el 2v2 y el 6v6. Si dudas de si Ferran lo quería solo para el 6v6, pregúntale; por defecto, para los dos.
5. La sim no cambia (la huella sigue idéntica): esto es solo presentación.

## Lote C: Carrera de pista (6v6) con ligas de los países importantes
**Ficheros:** js/career.js, js/career-ui.js, un fichero nuevo de datos (p. ej. js/leagues.js, cargado en index.html antes de
career.js), tools/careertest.js, notes/carrera.md. Necesita que el 6v6 humano funcione (ya funciona). Si toca main.js
(`startCareerMatch` con format 6v6), apúntalo en «Peticiones entre lotes», o coordínalo con el lote A si este ya ha
terminado.

**Lo que pide Ferran**
- **Ligas de pista de los países importantes:** unos 25-30 países. Nada de ligas marginales: «no quiero jugar en un club de la
  India con 7 jugadores».
  - Europa: Italia, Polonia, Turquía, Francia, Alemania, Rusia, España, Bélgica, Países Bajos, Grecia, Portugal, Suiza,
    Austria, Chequia, Serbia, Eslovenia, Rumanía.
  - América: Brasil, Argentina, EE. UU., Canadá, Perú.
  - Asia: Japón, Corea del Sur, China, Irán, Catar, Filipinas.
  - Divisiones: 1ª y 2ª en los países fuertes; solo 1ª en el resto.
- **Fichajes desde fuera:** si tu jugador es bueno, le fichan clubes de ligas extranjeras más fuertes. Cada oferta enseña
  país, liga, nivel, rol y sueldo.
- **Copas internacionales** con nombre cambiado: «Champions Cup», «Copa VEC»…
- **Un solo género, mezclado y neutro:** una única liga por país y división, que mezcla los clubes fuertes de la masculina y
  de la femenina reales. Sin «masculino» ni «femenino» en ningún texto. La personalización completa de los personajes llegará
  más adelante; ahora no.
- **La Carrera de playa 2v2 se queda.** Al crear la Carrera se elige «Playa (2v2)» o «Pista (6v6)».
- **En la Carrera de pista, el jugador elige su posición** (depende del lote A).

**Nombres de clubes y competiciones (reglas de Ferran, obligatorias)**
- **Equipaciones:** los MISMOS COLORES que el club real, incluido el líbero (p. ej. Manacor: rojo, y el líbero lila). El
  diseño de la camiseta NUNCA igual al real: otras franjas, otro cuello, otros cortes.
- **Nombres de club:** cambiados, con un pequeño guiño al real (estilo «Manshine» por Manchester en Blue Lock).
- **Clubes que se llaman por su ciudad:** directamente «Voley [Ciudad]», PERO comprobando que ningún club real se llame así
  oficialmente. Si choca, otra variante («Vòlei Teruel», «Teruel Voley», «Voley Turia»…). Ningún nombre de club ni de
  competición puede coincidir exactamente con uno oficial.
- **Competiciones:** cambiadas pero reconocibles: Superliga → «Hiperliga», SuperLega → «IperLega», PlusLiga → algo
  parecido, VNL → «VBN»…
- **Patrocinadores reales: NUNCA**, ni en nombres ni en camisetas. Muchos clubes llevan el patrocinador en el nombre: se
  quita.
- **Sin escudos reales:** escudos propios.
- **Jugadores siempre inventados:** derecho a la imagen.
- **Antes de meter las ligas en el juego, pasa a Ferran la lista** (club real → nuestro nombre, colores, nombre oficial
  comprobado) para que la revise y elija.
- Opcional: un editor local de clubes para que cada jugador ponga los nombres que quiera en su copia, sin que salgan del
  dispositivo o de su cuenta.

**Paso previo que puede hacerse ya en paralelo (sin código):** reunir por país las ligas y los clubes reales de 1ª y 2ª, con
sus colores (camiseta y líbero), y proponer los nombres cambiados según las reglas. Déjalo en notes/clubes-reales.md para que
Ferran lo revise. Usa búsqueda web.

**Estado (11-nov-2026, integración del workflow; SIN COMMIT):** hecho y probado, falta la revisión de Ferran.
- **Motor y UI:** Carrera de pista completa (js/career.js, js/career-ui.js; main.js `startCareerMatch` con 6v6; index.html carga
  js/leagues.js). Diseño en notes/carrera.md «Carrera de pista 6v6»; API en CONTRACT.md «Carrera de pista 6v6 y ligas reales».
- **Datos reales ya en el juego:** js/leagues.js con 28 países, 37 ligas y 390 clubes, GENERADO por `node tools/build-leagues.js` desde
  notes/clubes/*.json (no se edita a mano). Competiciones unificadas (Champions Cup VEC, Copa VEC, Mundial de Clubes VBF…).
- **Lista para Ferran: notes/clubes-reales.md** (club real → nuestro nombre, colores, ovr, nombre oficial, búsqueda, ⚠). Su regla era
  revisarla «antes de meter las ligas en el juego»: los datos ya están en js/leagues.js porque así lo pidió el workflow, pero **no se
  publica (push) hasta que Ferran la revise**. Si cambia algo: el JSON de notes/clubes/ y `node tools/build-leagues.js`.
- **Pendiente:** búsqueda entre comillas de 204 clubes y de casi todas las copas (se agotó el cupo de los investigadores); 36 clubes
  con ⚠; color del líbero del club y 2ª equipación en los choques (petición al lote A, abajo); colocador, opuesto y central (lote A);
  editor local de clubes (opcional, sin empezar); escudos propios (la ficha enseña los tres colores).

## Preguntas abiertas para Ferran (no decidir sin él)
1. **Circuito Mundial de la Carrera de playa:** los clubes de élite no los gana nadie. ¿Reto final o se suaviza?
2. **«Cerrar sesión»:** ¿borra el progreso local del dispositivo? Hoy no lo borra.
3. **Tope de dibujos del 6v6:** perf acepta ≤ 45 en baja (hoy 36-40). En media llega a 56-63. ¿Se queda así?
4. **Repo de redirección `purupurpito.github.io`:** la URL antigua /voley-3d/ da 404.
5. **Equilibrio de Fácil en el 6v6:** el equipo humano gana mucho.
6. **«N.º 1 / N.º 2»** en Jugadores (dorsales).
7. **Su revisión de textos**, lista A–D del 9-nov-2026.
8. **Lista de clubes y competiciones de la Carrera de pista** (notes/clubes-reales.md, sección «Decisiones para Ferran»): los ⚠
   (nombres casi iguales al real como «Volley Verona», «Vòlei Manacor», «Partisan Beograd»; colores de Jastrzębie; «Champions Cup» a
   secas, que es oficial en rugby y fútbol, frente a «Champions Cup VEC»; clubes que faltan o que no jugaron la 2025-26) y los niveles
   de Catar e Irán.

## Peticiones entre lotes
(Escribe aquí: lote que pide → fichero, función y cambio exacto.)
- **Vida de la Carrera (12-nov-2026) → lote C (rama `carrera-pista`)**: main ya tiene js/career-life.js y js/career-life-ui.js y 5 llamadas
  `life(c, tipo, …)` en career.js (create, `matchSetup` → `var out = {…}; life(c, 'setup', out); return out;`, closeMine y benchNext antes de
  `c.last = sum`, final de endSeason y de newSeason) + un sumando en `offerScore` + exports `_msg/_addXP/_wkKey`; en career-ui.js la pestaña
  `life` y los ganchos `LUI()`. Al rebasar, consérvalos también en `renderMatch6`/`lastCard` de la pista. Ver notes/carrera.md §Vida.
- **Vida de la Carrera → ui.js (HUD)**, opcional: enseñar `g.career.goal` (reto de la jornada) en la tarjeta de presentación o en el marcador.
- **Lote B → js/ui.js `showEnd` (ui_main, fuera del bloque de la guía)**, opcional: el récord `voley3d.record` no cuenta el 6v6 ni la
  Carrera, así que quien solo juega esos modos es «novato» (`record.played === 0`) para siempre. El lote B lo tapa con un contador
  local `voley3d.guided` (partidos con guía, tope 3 a partir de Normal). Mejor de raíz: un campo nuevo `record.anyPlayed` que suba en
  TODOS los partidos humanos (2v2, 6v6, Carrera) sin tocar `played/wins` (que siguen siendo del 2v2), y que `guideOn` e `isRookie`
  (main.js) miren `anyPlayed`. account.js ya sincroniza el documento entero (`recPlayed` compara `played`: revisar).
- **Bloqueo activo (sim.js, 11-nov-2026, pedido de Ferran; ver notes/sim.md «Bloqueo activo») → js/players.js (lote A)**: pose sobre
  el evento nuevo `blockPress` (`player`, `ok`): con `ok:true` las manos pasan por encima de la red con las muñecas hacia abajo
  («bajar el bloqueo», ~0,3 s); con `ok:false` un amago corto. El evento `block` lleva ahora `pressed:true|false`: con `pressed` el
  contacto puede ser más seco (brazos rígidos). Sin esto la mecánica funciona pero no se ve. **Hecho (lote A, 12-nov-2026).**
- **Bloqueo activo → js/ui.js consejos (lote A, coach/coach6)**: cuando el humano está en el bloqueo (`g.defRole === 'block'` o
  sitio de bloqueo en 6v6) y la CPU va a rematar: «Salta y pulsa GOLPEAR justo cuando remata: muro. Antes de tiempo: toque de red».
  Y en el aviso del contacto, `e.pressed` → «¡Muro!» en el sello del bloqueo directo. **Hecho (lote A, 12-nov-2026)**: también el aviso «Al remate: ¡muro!» en el aire.
- **Bloqueo activo → js/audio.js (audio)**, opcional: `blockPress ok:true` = golpe seco de manos sobre la cinta; `ok:false` nada.
- **Lote A → js/main.js (ui_main)**: `loadSettings`: añadir `ctrlRole6: 'OH'` al ajuste por defecto y validarlo
  (`VB.Sim.CTRL_ROLES6.indexOf(s.ctrlRole6) >= 0`, si no 'OH'); `startMatch` (createGame, ~línea 361):
  `ctrlRole: fmt ? (opts.ctrlRole || ctx.settings.ctrlRole6 || 'OH') : undefined` en vez de `ctrlRole: fmt ? 'OH' : undefined`.
  Hoy ui.js guarda la elección en `localStorage 'voley3d.role6'` y la aplica con `VB.Sim.setCtrlRole(ctx.game, role)` justo después
  de `startMatch` (puente que puede quedarse); con el cambio, la Carrera de pista (lote C) podrá pasar `opts.ctrlRole`.
- **Lote A → CONTRACT.md §4.3 (lead)**, texto a añadir tras «6v6 con humano (sprint 3…)»: «**Lote A (11-nov-2026)**:
  `VB.Sim.CTRL_ROLES6 = ['OH','S','OPP','MB']`; `createGame({ctrlRole})` y `VB.Sim.setCtrlRole(g, role)` → `g.ctrl` (primer jugador del
  equipo 0 con ese puesto: OH n.º 2, S n.º 1, OPP n.º 4, MB n.º 3); `g.ctrlBase` = su atleta: cuando el líbero entra por el central del
  humano, `g.ctrl = g.libero[0]` hasta que vuelve (evento `libero` con `human: true`, sin `switch`). Colocador humano: 2º toque suyo
  (`VB.AI6.humanOwns`) y carril por la dirección del stick (`VB.AI6.laneOf` → `chooseSet(g, p, lane)`); `askOk` también para el zaguero
  no líbero. Falta de posición: en Difícil/Experto (`g.posRule6`) el humano se mueve durante el saque y, solapado al golpe (`overlapOf`),
  `point` con `reason 'position'` («Falta de posición», `SIGNAL.position = 'attackFault'`). `VB.AI6`: `FORM.RECV[1..6]`, tempo `'pipe'`
  (`canPipe`), `spot(g, p).phase`. fx.js: pistas por fase (`posMark`, `posMark2`, `posArrow`; 0 dibujos) con densidad por nivel.
  players.js: postura de cobertura. ui.js: fila Controlar con 4 puestos, `localStorage 'voley3d.role6'`.»
- **Lote A → js/sim.js `blockPressCase` en 2v2 (dueño de «Bloqueo activo»; cambia la huella 2v2, regenerar con `--write`)**: revisión del
  12-nov. Un overpass o un balón que cruza sin atacar (`!spiked && toward`) con el balón aún a más de 0,6 m en el campo rival hace que
  GOLPEAR en el aire sea pulsación de bloqueo con `lead = ∞`, y eso acaba en toque de red (prob. NET_PRESS) en vez de golpe. En 6v6 ya va
  arreglado (`g.rot ||`); en 2v2 basta quitar `(g.rot || Math.abs(b.x) < 0.6)` y dejar `if (!spiked && toward) return false;`. Cambia 7 de 150
  partidas de la huella (variantes human/attrs del bot). **Hecho (12-nov-2026, pedido de Ferran)**: en 2v2 también, huella regenerada. El overpass sigue existiendo como
  error de recepción; solo cambia que GOLPEAR en el aire ante él es un golpe.
- **Lote A → tools/console.sh (ui_main)**: la línea 9 `EXTRA="${4:-}"` pisa la variable de entorno `EXTRA`, así que
  `EXTRA=format=6v6 bash tools/console.sh all` prueba el 2v2 normal. Cambio: `EXTRA="${4:-${EXTRA:-}}"`. Mientras tanto, pásalo como
  4º argumento: `bash tools/console.sh all 1280 720 format=6v6`.
- **Sprint 5 (E3/E6) → lote B (camera.js; rama de la cámara lenta)**: camera.js ya trae del sprint 5 `OPTS = ['camDist','camCuts','lessMotion']`,
  `readComfort()` una vez por frame (`distK` en `gameplayShot`/`touchFitPlan`, `cutsLess`, `reduceMotion` desde `ctx.reduceMotion` si es
  propiedad propia de ctx), `quietPoint(g) = cutsLess || g.drill` (sin plano de reacción/héroe/sacador rival en 'point'; vuelta al saque con
  corte 'serve') y el evento `drillStage` (corte seco `lastCut.kind 'drill'` que además APAGA cámara lenta, hit-stop, cutaway, clinch y
  seguimiento del remate). Al rebasar: conserva esas ramas; la cámara lenta antes del golpe NO debe actuar con `g.drill` (el Entrenamiento
  va siempre a velocidad 1) ni saltarse `ctx.reduceMotion`; si añades un ajuste nuevo, publícalo en `OPTS` (ui.js esconde las filas con
  `data-need` si no está). Detalle en notes/camera_input.md «Sprint 5, E3 + E6».
- **Mundo de la Carrera (sprint 5, E4/E5) → lote C (rama `carrera-pista`)**: al rebasar, conservar en career.js el reparto de `life()`
  (llama a `VB.CareerLife` y después a `VB.CareerWorld`, cada uno con guarda) y `life(c, 'join', o)` al final de `joinClub`; en career-ui.js
  los ganchos `WUI()` (tarjeta de Faro y «Titulares» tras `lastCard`) también en `renderMatch6` de la pista, `SUBS.league` con «Noticias» y
  «Clubes», y en `renderTable` de la pista el nombre del club como `<button class="cw-tl-b" data-act="cw-club" data-id>`; en career-life.js
  `setup()` deja `m.career.rivalNum = l.rival.num` solo en los duelos (main.js lo pasa como `nums[1]` y a `VB.Players.setRival`). Las ligas
  de las noticias y los anales salen de `leaguesOf(c)` / `topLv(c)` en career-world.js (hoy los 5 circuitos de playa, 8 clubes, 14
  jornadas): con las ligas por país, cambia solo esas dos. Detalle en notes/carrera.md «Mundo de la Carrera (C1/C2)».
- **Merge sprint 5 + main (12-nov-2026): Mundo de la Carrera en la pista HECHO.** Faro, Noticias y Clubes funcionan también en la
  Carrera de pista (career-world.js con las ligas por país: `leaguesOf`/`topLv`/`otherLv` por `lid`, `BEATS_H`; career-ui.js `SUBS6.league`,
  `lgSw6`, botones de club en `renderTable6`, mentor y Titulares en `renderMatch6`; careertest «Mundo de la Carrera en la pista»). Queda:
  en la pista `m.nums` manda (main.js) y el dorsal del rival personal (`m.career.rivalNum`) no se coloca en el equipo rival; y la ficha
  de un club de otra liga no enseña la forma reciente («Esta temporada»), porque la pista solo guarda los resultados de tu liga (`c.myRes`).
- **Sprint 5 → Ferran (decisiones)**: `MKT = true` en career-world.js (rumores de verano con jugadores inventados; false para quitarlos);
  línea «Claude Code» en los créditos (TODO en version.js); salto a 1.0.0; desplegar firebase/firestore.rules (con 'gym') y DESPUÉS poner
  `GYM_SYNC = true` en account.js; probar el oro del bloqueo (16) con humanos; la recompensa de la finta (tirada «batida» por hash en vez
  del retraso puro de la spec).
- **HECHO (12-nov-2026) · Lote C → lote A, js/players.js (color del líbero del club):** `matchSetup()` de la Carrera de pista ya pasa `kit.kitLibero` y
  `rivalKit.kitLibero` (main.js los deja en `opts.kit` y `opts.kit.rival`). En `setKit(st)`, guardar `st.kitLibero` (equipo 0) y
  `st.rival.kitLibero` (equipo 1); en `liberoKit(team)`, usarlos como camiseta del líbero si son número y se distinguen de las dos
  camisetas (`kitDist` ≥ 0,8); si no, el cálculo de ahora. Fuera de la Carrera no cambia nada.
- **HECHO (12-nov-2026) · Lote C → lote A, js/players.js (choque de equipaciones):** cuando la camiseta del rival se parece a la tuya, `setKit` le pone la
  de la CPU (roja). En la Carrera sería mejor su 2ª equipación: camiseta = `rival.kitAccent` (su segundo color) si se distingue.
  *Hecho:* `setKit` guarda `kitLibero` (tuyo; el del rival solo si viste de su club) y `liberoKit` lo usa si `kitDist` ≥ 0,8 con las
  dos camisetas (y el rival, con tu líbero); si la 1ª del rival choca y su setup trae `kitLibero` (solo la pista), 2ª = camiseta
  `kitAccent`, detalles = su 1ª, pantalón el suyo (o su 1ª si se funde); si también choca, la CPU. Playa, Carrera de playa, 2v2/6v6
  normales: igual que antes. Prueba: `node tools/kittest.js` (16 comprobaciones + huella de 400 casos sin Carrera); capturas en
  tools/out/kits/. El comentario viejo de main.js `startCareerMatch` ya está corregido. Revisión: el hub de pista enseña la 2ª del rival («2ª equipación») con `Players.rivalKit`.
- **Para Ferran (datos, build-leagues):** solo hay 5 colores de líbero en las ligas de pista (#f2c200 el 39 %, blanco, #f39200, #e4002b, #111111); el negro casi nunca pasa el umbral (mkKit lo aclara a pizarra). Variar más los `libero` o no dar negros. Y detrás del hub de pista se ve la playa: es la demo del menú con el escenario de Ajustes (ya pasaba antes); forzar el pabellón con la pista activa sería cosa de main.js/ui.
- **HECHO (12-nov-2026) · Colores de líbero buscados en internet:** de los 390 clubes, 150 confirmados (`liberoEstimated: false`), 79 probables (color nuevo, pero sigue `liberoEstimated: true`) y 161 sin encontrar (se queda el color de antes). Ahora hay 184 colores de líbero distintos, antes 100. 77 se parecen mucho (distancia RGB < 70) a la 1ª o la 2ª camiseta de nuestro JSON: se dejan porque son los reales (hay plan B si chocan) y cada uno lo apunta en su `check` con «Ojo: casi igual que…». Muchos de esos choques son blancos o negros iguales a la `shirt2`.
- **Lote C (hecho, aviso):** main.js `startMatch`/`startCareerMatch` pasan `format: '6v6'`, `ctrlRole` y `nums` en la Carrera de pista,
  y tools/simtest.js carga js/leagues.js (una línea). No eran ficheros del lote C.

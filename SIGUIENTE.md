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

---

## Lote A: 6v6 con todas las posiciones, rotaciones de verdad y pistas dibujadas en el campo
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

## Preguntas abiertas para Ferran (no decidir sin él)
1. **Circuito Mundial de la Carrera de playa:** los clubes de élite no los gana nadie. ¿Reto final o se suaviza?
2. **«Cerrar sesión»:** ¿borra el progreso local del dispositivo? Hoy no lo borra.
3. **Tope de dibujos del 6v6:** perf acepta ≤ 45 en baja (hoy 36-40). En media llega a 56-63. ¿Se queda así?
4. **Repo de redirección `purupurpito.github.io`:** la URL antigua /voley-3d/ da 404.
5. **Equilibrio de Fácil en el 6v6:** el equipo humano gana mucho.
6. **«N.º 1 / N.º 2»** en Jugadores (dorsales).
7. **Su revisión de textos**, lista A–D del 9-nov-2026.

## Peticiones entre lotes
(Escribe aquí: lote que pide → fichero, función y cambio exacto.)
- **Lote B → js/ui.js `showEnd` (ui_main, fuera del bloque de la guía)**, opcional: el récord `voley3d.record` no cuenta el 6v6 ni la
  Carrera, así que quien solo juega esos modos es «novato» (`record.played === 0`) para siempre. El lote B lo tapa con un contador
  local `voley3d.guided` (partidos con guía, tope 3 a partir de Normal). Mejor de raíz: un campo nuevo `record.anyPlayed` que suba en
  TODOS los partidos humanos (2v2, 6v6, Carrera) sin tocar `played/wins` (que siguen siendo del 2v2), y que `guideOn` e `isRookie`
  (main.js) miren `anyPlayed`. account.js ya sincroniza el documento entero (`recPlayed` compara `played`: revisar).

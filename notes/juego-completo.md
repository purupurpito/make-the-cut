# Make the Cut: de «parece un Doodle» a juego completo (plan revisado)

No he tocado el repo ni he usado git. Esta versión corrige el plan anterior con dos críticas. La primera viene de la percepción del jugador, contrastada con las capturas de la auditoría. La segunda es de viabilidad y está contrastada con el código en solo lectura. Cambios principales:
- **La causa número 1 está dentro del partido** (luz plana, público quieto, HUD de tutorial), no en los menús. El Sprint 1 pasa a ser «los primeros 60 segundos», no textos.
- **Varias cosas que se daban por nuevas ya existen:** juice, rótulos de momento, tarjeta de previa, química visible, bandeja de mensajes, insignias en el partido rápido, cuentas en Firestore y el botón 6v6 visible.
- **Otras se daban por existentes y no existen:** el grabador de repeticiones y el nivel de cuenta.
- **Esfuerzos corregidos:** repeticiones L, música procedural L, guardado y ranuras M.
- **Columna de dueño** (CONTRACT §1): ui_main, players, arena, camera_input, audio y sim.

## Por qué parece un minijuego

El estilo chibi **no** es la causa. Beastieball, Super Mega Baseball, Retro Bowl y Fall Guys son cartoon y se perciben como juegos completos. A Switch Sports, Mario Strikers BL y Windjammers 2 los llamaron «barebones» o «thin» siendo preciosos. Lo que falla es la **ejecución** del cartoon y lo que rodea al partido.

1. **Cartoon «plano», no cartoon «premium».** En las capturas shots/rally.png, spike.png y beach/rally.png se ve luz uniforme sin dirección ni contraste, sin luz de borde ni sombras de contacto. El público son recortes iguales y quietos, y el balón es casi del tamaño de la cabeza. Así se lee como un Doodle o un Mii. *Referencia: Beastieball, Fall Guys y Overwatch, que son cartoon con luz, gradación de color y multitudes vivas.*
2. **El partido parece una demo guiada.** Hay una frase de tutorial («ponte debajo del balón y pulsa J…»), la barra TOQUES/DEFENSA/COLOCACIÓN/ATAQUE y un anillo amarillo gigante (rally.png). *Referencia: Golf Story «va pronto al golf». A Mario Golf Super Rush se le criticó el tutorial extenso.*
3. **Silencio.** No hay música de menú ni de Carrera: el canal «music» de audio.js solo lleva sintonías cortas. Los contactos tampoco suenan con cuerpo. *Referencia: las bandas sonoras de Beastieball y Lethal League Blaze son de lo más elogiado. Beach Spikers fue castigado por su «bland music».*
4. **Nadie tiene nombre ni cara.** El marcador dice «TÚ 2-0 CPU», el MVP sale por dorsal en un círculo y el botón gigante es «REVANCHA» (over.png). El creador de la Carrera solo pide nombre, dorsal y rol (career-ui.js:22). *Referencia: Beach Spikers World Tour («almost a volleyball RPG»), los rivales con nombre de Punch-Out!! y Everybody's Golf.*
5. **La interfaz parece un panel web.** Todo es el mismo rectángulo morado redondeado: menú, cierre, Carrera y el modal «PRIMER PARTIDO» sobre fondo borroso (match-intro.png). La Carrera son tarjetas de texto (career-hub.png). Se suman «SE GUARDAN EN ESTE NAVEGADOR» (ui.js:2591) y un botón fijo PANTALLA COMPLETA. *Referencia: el lenguaje de retransmisión de FIFA y NBA 2K, y el hub de OlliOlli World.*
6. **El partido es una ronda, no un evento.** La tarjeta de presentación es breve, no hay repeticiones (el challenge solo enfoca la marca del bote) y el cierre es una hoja de datos. *Referencia: el banner y la repetición de Rocket League, la previa y el cierre de NBA 2K.*
7. **La meta entre partidos no se ve.** Las insignias existen (Carrera, partido rápido, pestaña en Jugadores y hoja final), pero no en la portada. No hay álbum con huecos, retos ni nada que diga «vuelve mañana». La portada vende un partido suelto («Palau del Mar ◆ 2 contra 2», index.html:1905-1918) y la Carrera es una pastilla dentro de JUGAR. *Referencia: el garaje de Rocket League, los sellos de Wii Sports Resort, la franquicia como puerta en Retro Bowl.*

## Qué hacen los juegos parecidos

| Juego | Qué copiar (la idea, no el diseño) |
|---|---|
| Beastieball / Fall Guys | Cartoon con luz de borde, gradación de color, multitudes animadas y banda sonora propia |
| Sega Beach Spikers | Compañera IA con relación, World Tour con progresión y sedes con personalidad |
| Retro Bowl / Super Mega Baseball | La franquicia o carrera es la puerta principal. Mundo ficticio coherente |
| Rocket League | Repetición del punto, banner, colección con huecos y cosméticos que lucen en el momento clave |
| Punch-Out!! / Everybody's Golf | Rivales «jefe» con nombre, estilo propio y un premio que te llevas al ganarles |
| Wii Sports Resort / Mario Tennis Aces | Retos con sellos y torneos periódicos que dan motivo para volver |
| NBA 2K / FIFA | Previa y cierre de retransmisión, todo saltable y con versión corta |
| Golf Story | Arco corto con mentor que da sentido a la temporada, sin hub para caminar |
| Juice It or Lose It / Art of Screenshake | El impacto (pausa, temblor, partículas, sonido) separa un prototipo de un producto |
| Contraejemplos | Spike Volleyball (muchos modos, 3/10), Sports Story (abarcar demasiado), Haikyu!! Fly High (gacha), Mario Strikers BL (cinemáticas sin saltar, 5 estadios) |

## Propuestas por prioridad

Esfuerzo: S (menos de 1 día), M (1-3 días), L (más de 3 días o un lote). Dueño según CONTRACT §1. Lo que no es de ui_main se pide en notes/<dueño>.md.

| # | Propuesta | Referencia | Esf. | Ficheros (dueño) | Impacto |
|---|---|---|---|---|---|
| A1 | **Pasada de dirección de arte dentro del cartoon.** Luz principal con dirección más hemisférica, luz de borde (fresnel en el material toon), tone mapping del core (ACES), sombras de contacto falsas (blob) bajo jugadores y balón, gradación de paleta por sede, público con variedad de colores y un «salto» animado en los puntos, y escala visual del balón revisada (sin tocar el radio de la sim). Bloom solo si cabe sin peticiones de red (CONTRACT §2: el EffectComposer habría que incrustarlo). Medir con tools/perf.js en móvil ×4 y respetar ≤35 draw calls en calidad baja. | Beastieball, Fall Guys | M-L | arena.js, fx.js (arena); players.js, doll.js (players) | **Alto** |
| A2 | **HUD limpio.** Consejos de una línea con icono de tecla, que desaparecen tras el primer uso correcto de cada acción. **El anillo y la barra de toques también** pasan a ser discretos o se ocultan fuera de la guía. Ya existen `showHelp` (ui.js:1468) y `GUIDE_MAX`: solo es nuevo el criterio por acción. Coordinar con el Lote B. | Golf Story | S | ui.js, main.js (ui_main); el anillo hay que verificar si está en fx.js (arena) | **Alto** |
| A3 | **Pantalla de título con un tema de menú.** «PULSA PARA EMPEZAR» con #mtcLogo animado. Desbloquea el AudioContext y arranca **un** tema de menú. Sin música no vale la pena: sería otra pantalla en silencio. El relevo del telón ya espera a la escena (`bootReady`/`tryReveal`, ui.js:51-66). Antes hay que reproducir con capturas el «fondo morado vacío». En el primer arranque no se muestra. | Attract mode; Poki y GameAnalytics | S (pantalla) + M (tema, ver A4) | ui.js, main.js, index.html (ui_main); audio.js (audio) | **Alto** |
| A4 | **Música: 3 temas (menú, Carrera, final con variante triste); en partido solo grada.** El motor actual (`musicPlan`, audio.js:1146) renderiza cada partitura entera en un Float32Array: un bucle de 60-90 s ocupa unos 15-23 MB por pista y no cabe en móvil. **Dos opciones (decide Ferran):** (a) ogg CC0 o CC-BY de bitrate bajo en data URI dentro de index.html (unos 0,5-1 MB por tema, cumple CONTRACT §2), que es M y suena bien enseguida; (b) secuenciador en tiempo real con notas cortas cacheadas y `AC.currentTime`, que es L y conlleva riesgo de sonar a politono. Recomendación: (a) para el tema de menú. Criterio de aceptación: presupuesto de memoria y LUFS en tools/audiotest.js. | Beastieball, Lethal League; contra: Beach Spikers | M (a) / L (b) | audio.js (audio), index.html, ui.js (ui_main) | **Alto** |
| A5 | **Impacto con cuerpo: ajustar, no construir.** Hit-stop, temblor, golpe de FOV, polvo y huella del bote **ya existen** (camera.js:42, 94, 3603; fx.js:8-182). Queda: la huella dura hasta el siguiente saque, polvo de arena propio en la playa, estela en el remate fuerte y **sonido de impacto con más grave** (remate seco, bote en la madera, grada que sube con la duración del rally). Coordinar con el Lote B, que está recortando cámaras lentas. | Juice It or Lose It | S-M | fx.js (arena), camera.js (camera_input), audio.js (audio) | **Alto** |
| A6 | **Cámara en momentos clave.** Plano de tele en el saque, y encuadre o cámara lenta breve en el punto de set o de partido. Siempre saltable, con `reduceMotion` y coordinado con el Lote B. | NBA 2K, Rocket League | S-M | camera.js (camera_input) | Alto |
| A7 | **Nombres en todas partes.** Marcador y cierre con nombres en lugar de «TÚ / CPU», pareja rival paródica con club y colores, y MVP por nombre. Depende de la pregunta abierta 6 (N.º 1 / N.º 2). Es el requisito de B5. | Super Volley Blast, Punch-Out!! | S | ui.js (1574, 1595, 511, 821-834, showEnd), prog.js, career.js (FIRST/LAST) (ui_main) | Medio (alto junto con B5) |
| A8 | **Integrar el modal «PRIMER PARTIDO»** en la pantalla de título o en la escena, en lugar del diálogo sobre fondo borroso. Sacar PANTALLA COMPLETA del arranque (a Ajustes, o un icono en táctil). | — | S-M | ui.js, index.html (ui_main) | Medio |
| B1 | **Creador de personaje.** Piel, pelo, peinado y complemento, con vista previa 3D. La base está en doll.js. **Choca con el Lote C («la personalización completa llegará más adelante»): preguntar antes a Ferran.** El aspecto tiene que llegar a `lookOf` en players.js:219-226. Fuera: la «altura con efecto» (la sim usa un alcance fijo; si acaso, por `attrs`) y la «expresión base» (las caras son dinámicas). Necesita migración versionada de `voley3d.career` y `voley3d.squad`. | Beach Spikers, Everybody's Golf | M | career-ui.js, career.js (ui_main); players.js, doll.js (players) | **Alto** |
| B2 | **Carrera con imágenes.** Retrato del muñeco renderizado una vez con el renderer principal a un render target y cacheado (**nunca** un segundo WebGLRenderer, por iOS). Escudo paródico en canvas o SVG (S). Vitrina de palmarés con huecos. | FIFA/FM, Rocket League | M | career-ui.js, career.js (ui_main); players.js (rig posado) | **Alto** |
| B3 | **Carrera como puerta principal**, solo cuando estén B1 y B2. Sin ellos, anunciarías la pantalla más fea. «CONTINUAR CARRERA · T1 J3 vs …» con la camiseta y el retrato, y lo demás debajo. Corregir los textos que contradicen la Carrera: «Vóley en pista cubierta» y «Palau del Mar», cuando la Carrera es en la playa (Platja Llarga). | Retro Bowl, SMB | S-M | index.html, ui.js (~2143), career.js (ui_main; Lote C) | Alto |
| B4 | **Lenguaje visual de retransmisión.** Cortes diagonales, tipografía de marcador de tele, paneles que entran y salen animados y un sonido por botón, en lugar del rectángulo morado redondeado. Navegación con mando y táctil (`VB.UI.tabs`, `data-nav`). | FIFA, NBA 2K | M | index.html (CSS), ui.js, career-ui.js (ui_main); audio.js | **Alto** |
| B5 | **Previa corta.** Ampliar la tarjeta existente (ui.js:821-858, `playIntro`, `sting('intro')`). Por defecto 4-5 s, con nombres, retrato, rasgo e historial. La versión larga solo en Carrera, finales y jefes. Sin moneda de sorteo (el saque lo decide la sim). La salida caminando de las parejas es opcional (animación nueva en players). | NBA 2K, Punch-Out!! | S-M (+M si se camina) | ui.js, main.js (ui_main); camera.js; players.js | Alto |
| B6 | **Cierre como resumen de jornada.** Celebración de 3 s, MVP por nombre, XP, insignias, desbloqueo, clasificación con tu movimiento (▲2), «SIGUIENTE JORNADA» como botón principal y «Revancha» solo en partido rápido. Las «Mejores jugadas» esperan a C1. | Rocket League, FM | M | ui.js (showEnd ~2288-2333), career-ui.js (ui_main) | Alto |
| C1 | **Grabador y repetición mínima.** **El grabador no existe** (`g.review`, sim.js:1815, solo guarda la marca del bote). Hay que construir un búfer circular de balón y 4 rigs sin asignar memoria por frame, o resimular con la semilla, y reproducirlo con la sim parada. Primera versión: solo en punto de set o de partido, desde la cámara de tele (perdona los descuadres), saltable. Antes, revisar los contactos mano-balón. Después, «Mejores jugadas» en B6. | Rocket League | L | players.js (players), camera.js (camera_input), main.js, ui.js | **Alto** |
| C2 | **Personalidad en pista.** Celebración propia y gesto de rabia del compañero y de los jefes. Lucen en el cierre y en las repeticiones. | Mario Strikers | M | players.js, doll.js (players) | Alto |
| C3 | **Rivales «jefe» por circuito,** con un rival de toda la vida que asciende contigo. El estilo (muro, sacador, defensor) se hace con `attrs` y `Sim.statProf`, **sin tocar ai.js**. Comprobar en simtest que la diferencia **se nota** jugando: un nombre sobre la misma IA se descubre en dos partidos. Cosmético del jefe al ganarle. | Everybody's Golf, Punch-Out!! | M | career.js, career-ui.js (ui_main; Lote C) | Alto |
| C4 | **Rótulos cinéticos**, no locutor de frases. «¡ACE!», «¡MURO!», «BOLA DE SET», con golpe de sonido y reacción de la grada, sobre la base existente (ui.js:1207-1248). La frase con nombre («¡Belmonte salva su tercera bola de set!») va solo en el cierre. | Rocket League, SMB4 | S | ui.js (ui_main), audio.js | Medio |
| C5 | **Química con nombre de nivel.** La barra ya existe (career-ui.js:491, 700-704). Faltan los niveles («Conocidos → Pareja de oro»), una celebración conjunta y alguna decisión rara entre partidos (no en cada jornada). | Beach Spikers, SMB4 | S | career.js, career-ui.js (ui_main) | Medio |
| D1 | **Retos de maestría y diarios.** 15-20 retos con bronce, plata y oro sobre badges.js, más un reto diario y un torneo semanal con la fecha como semilla, sin servidor. Si hace falta un retos.js, pedirlo en notes/ui_main.md (index.html carga una lista fija). | Wii Sports Resort, Mario Tennis Aces | M | badges.js, ui.js (ui_main) | Alto |
| D2 | **Perfil y álbum con huecos, sin moneda al principio.** Insignias y nivel en la portada. Desbloqueos por hitos: equipaciones, balones, celebraciones, estelas y sedes. El nivel de cuenta **no existe** (prog.js va por atleta): es un concepto nuevo con su guardado. Si luego hace falta moneda, decidir con Ferran si se reutiliza `c.money` de la Carrera o se crea otra con un nombre claramente distinto. | Rocket League, Lethal League | M | prog.js, badges.js, ui.js, index.html (ui_main) | Alto |
| D3 | **Cosméticos que lucen.** Celebración equipable en el cierre y la repetición, estela en el remate ganador y la equipación de Ajustes pasa a «Mi equipo». Sin dinero real. | Rocket League; VGC sobre Mario Strikers | M | fx.js (arena), players.js (players), ui.js | Medio |
| D4 | **Sincronización y migraciones.** Añadir cada guardado nuevo (perfil, álbum, retos, ranuras) a `DOCS` (account.js:19), a la fusión (138-139) y a las reglas de firebase/. Migraciones versionadas con `.bak` y `lost()`. Sin esto, D1 y D2 se pierden al cambiar de dispositivo. La nube sincroniza, nunca es requisito. | Switch Sports (lo que no hay que hacer) | M | account.js, career.js, prog.js (ui_main), firebase/ | Bajo (pero imprescindible) |
| D5 | **Una sede nocturna de verdad,** mejor que cuatro paletas. Playa nocturna con focos sobre el mecanismo `beachLight` (arena.js:3404-3420): S. Un pabellón de barrio o un estadio de final son geometría nueva: L cada uno, dentro del tope de draw calls. | Beach Spikers; contra: reskins | S (noche) / L (geometría) | arena.js (arena), main.js, ui.js | Medio |
| E1 | **Profundidad jugable y techo de habilidad.** Tipos de saque y remate, finta, colocación a zonas, ventanas de timing que premien y un compañero IA que no frustre. Es lo que hace que el partido 30 no sea el 1. Hay que preservar la huella 2v2 (simtest) y pasa por el dueño sim: decisión de Ferran. | Lethal League, Mario Tennis | L | sim.js, ai.js (sim), players.js | Alto (a largo plazo) |
| E2 | **Calidad de animación.** Carrera hacia el balón, anticipación del salto, variedad de golpes, plancha y celebraciones por punto. | Mario Strikers | L | players.js (players) | Alto |
| E3 | **Ajustes de juego de PC.** Calidad gráfica, reasignar teclas, accesibilidad y sensibilidad. Partir de lo que ya hay (`showHelp`, `reduceMotion`). | — | M | ui.js, index.html (ui_main) | Medio |
| E4 | **Mentor e hitos** desde la bandeja `c.inbox` existente (career.js:500-513), no como un sistema aparte. Escenas cortas y saltables, sin hub. | Golf Story | S-M | career.js, career-ui.js (ui_main) | Bajo-medio |
| E5 | **Noticias de la liga y enciclopedia de clubes.** Plantillas variadas y nada obligatorio. «Hiperliga» exige migrar historial y palmarés (el código dice «Superliga de Playa», career.js:63) con el mecanismo de renombrado existente. | FM, Super Mega League | S-M / M | career.js, career-ui.js (ui_main; Lote C) | Bajo |
| E6 | **Gimnasio.** Antes, revisar el tutorial, tools/jsetdrill.js y el entreno automático (`c.train`, `c.tp`) para no duplicar. | Windjammers 2 | M | ui.js, career.js | Bajo-medio |
| E7 | **Escaparate fuera del juego.** Página en itch.io (o dominio) con miniatura, tráiler en GIF y notas de versión. Número de versión y créditos en Ajustes. La URL de github.io predispone a «proyecto de hobby». | Vampire Survivors, Venge.io | S | tools/build-pages.js, ui.js | Medio |
| H | **Bolsa de higiene** (para cualquier hueco; nadie la nota en la primera impresión): quitar «Beach» y los nombres de pila repetidos (sin pasar los clubes de playa a «Voley X», que exige migración); «GUARDADO EN ESTE DISPOSITIVO» (o «EN TU CUENTA» solo con sesión iniciada) en ui.js:2591 y career-ui.js:371; título de pestaña dinámico; `record.anyPlayed`; ranuras de Carrera y exportar o importar (M, con migración de `voley3d.career` v3 y aviso de conflicto). | — | S cada una (ranuras M) | ui.js, career.js, career-ui.js, main.js, account.js | Bajo |

## Sprints recomendados

**Antes de empezar, preguntas a Ferran:**
1. ¿Creador de personaje ahora o tras el Lote C?
2. Música: ¿ogg en data URI o procedural?
3. ¿Moneda única, separada de los ahorros, o ninguna?
4. ¿Se oculta el 6v6 de JUGAR o se queda? Hoy está visible (index.html:1930).
5. Pregunta abierta 6 (N.º 1 / N.º 2).

Coordinar en «Peticiones entre lotes» los choques con el Lote B (A2, A5, A6) y el Lote C (B3, C3, E5).

**Métrica de éxito para cada sprint:** enseñar a las mismas personas que dijeron «Doodle» 10 segundos de vídeo de partido, sin menús, y hacer una pregunta abierta.

1. **S1 «Los primeros 60 segundos»** (lo que ve quien dijo «Doodle»): A1 (empezar por luz, tone mapping, sombras de contacto y público), A2, A3 con el tema de menú de A4, A5, A6, A7 y A8. *Dueños:* arena, players, camera_input, audio y ui_main en paralelo, a diferencia del plan anterior, que cargaba todo en ui_main.
2. **S2 «Tu carrera»:** B1 (si Ferran lo aprueba), B2, B3, B4, B5 y B6 sin mejores jugadas. Termina con el resto de los temas de A4.
3. **S3 «Partidos que se recuerdan»:** revisión de contactos y C1, C2, C3, C4, C5, y «Mejores jugadas» en B6.
4. **S4 «Volver mañana»:** D1, D2, D3, D4 y D5 (noche).
5. **Después, según Ferran:** E1, E2 (son las horas de verdad, y caras), E3, E4, E5, E6 y E7. La bolsa H, en los huecos de cualquier sprint.

## Lo que no conviene hacer

- **Ir al realismo.** El chibi es una decisión del dueño. Lo que hay que hacer es pulir el cartoon (A1).
- **Música procedural mediocre.** Suena a juguete web, justo lo contrario de lo que se busca. Si el secuenciador no da la calidad, mejor ogg CC0.
- **Cuatro paletas de sede como «contenido».** Se leen como un reskin. Mejor una sede distinta de verdad.
- **Una tienda de moneda.** Huele a juego de móvil. Nada de gacha, pase de pago, temporizadores ni pop-ups (Haikyu!! Fly High).
- **Un locutor de frases sobre el HUD.** Es más texto encima de lo que se está vaciando. Rótulos cortos y la frase solo en el cierre.
- **Ascender la Carrera a puerta principal antes de darle imagen** (B1 y B2).
- **Inflar la lista de modos o hacer un hub para caminar** (Spike Volleyball 3/10, Sports Story, Super Rush).
- **Cinemáticas largas o que no se puedan saltar.** Todo lo que se repite, con versión corta.
- **Lanzar repeticiones sin revisar los contactos,** ni hacerlas con primeros planos al principio.
- **Tocar ai.js para los jefes, escalar la altura del muñeco con efecto en juego o abrir un segundo WebGLRenderer para los retratos.**
- **Pedir recursos por red.** CONTRACT §2: solo three.js y Google Fonts, y tiene que funcionar en `file://`. Nada de que la progresión dependa de Firebase.
- **Renombrar Superliga a Hiperliga sin migrar** el historial guardado.
- **Las reglas del dueño:** sin patrocinadores, escudos ni nombres reales. Nombres paródicos, colores sin copiar diseños, un solo género neutro mixto y rivales sin estereotipos nacionales.
- **Optimizar para portal** («jugar en 3 segundos» en Poki o CrazyGames). Entrada directa solo la primera vez.

## Fuentes

Las valoraciones y citas de crítica salen de la investigación previa del plan. Las URLs siguientes son páginas de referencia de cada juego o charla y **no se han vuelto a comprobar en este paso**.

- https://en.wikipedia.org/wiki/Beastieball
- https://en.wikipedia.org/wiki/Fall_Guys
- https://en.wikipedia.org/wiki/Beach_Spikers
- https://en.wikipedia.org/wiki/Retro_Bowl
- https://en.wikipedia.org/wiki/Super_Mega_Baseball
- https://en.wikipedia.org/wiki/Rocket_League
- https://en.wikipedia.org/wiki/Punch-Out!!
- https://en.wikipedia.org/wiki/Everybody%27s_Golf
- https://en.wikipedia.org/wiki/Wii_Sports_Resort
- https://en.wikipedia.org/wiki/Nintendo_Switch_Sports
- https://en.wikipedia.org/wiki/Mario_Strikers:_Battle_League
- https://en.wikipedia.org/wiki/Windjammers_2
- https://en.wikipedia.org/wiki/Lethal_League_Blaze
- https://en.wikipedia.org/wiki/Golf_Story
- https://en.wikipedia.org/wiki/Sports_Story
- https://en.wikipedia.org/wiki/Mario_Golf:_Super_Rush
- https://en.wikipedia.org/wiki/OlliOlli_World
- https://en.wikipedia.org/wiki/Football_Manager
- https://en.wikipedia.org/wiki/Vampire_Survivors
- https://doodles.google/doodle/doodle-champion-island-games-begin/
- https://www.youtube.com/watch?v=Fy0aCDmgnxg (Juice It or Lose It, GDC 2012)
- https://www.youtube.com/watch?v=AJdEqssNZ-U (The Art of Screenshake, Jan Willem Nijman)
- https://threejs.org/docs/#api/en/renderers/WebGLRenderer.toneMapping
- https://threejs.org/docs/#examples/en/postprocessing/EffectComposer

**Capturas consultadas:** C:\Users\Puru\AppData\Local\Temp\claude\256b3765683db9c6\e1a50e81-850e-48ad-9094-a71e1a1141a5\scratchpad\fullgame (subcarpetas shots, beach, career, touch).

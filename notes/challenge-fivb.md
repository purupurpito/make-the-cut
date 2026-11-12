# Challenge (Video Challenge System) de la FIVB: cómo funciona y cómo llevarlo al juego

Revisión del 9-nov-2026 a partir del reglamento oficial **FIVB Video Challenge System Regulations 2025** (pista cubierta,
4 páginas): https://www.fivb.com/wp-content/uploads/2024/05/Video-Challenge-System-Regulations-2025_final_v03.pdf
Existe una edición 2026 (CEV, https://inside.cev.eu/media/xkre2nzd/vcs-regs-2026-5.pdf) que no se ha podido leer; puede cambiar detalles.

## El reglamento (resumen con número de punto)

- **Cuándo** (2, 4, 7): solo **al acabar la jugada**, nunca a mitad. Hay **7 segundos** desde que acaba para pedirlo, y el sistema lo
  bloquea 7 s después de anotar el punto. Se puede revisar **cualquier acción de la jugada**, saque incluido.
- **Cuántos** (2, 11, 20, 24): **máximo 2 por set**, no se acumulan entre sets.
  - Acertado: lo **conserva**.
  - Fallado: lo **pierde**. Con el 2º fallado ya no puede pedir más en ese set.
  - Dudoso (las imágenes no lo aclaran): se mantiene la decisión del árbitro y el equipo **conserva** el challenge.
  - Pulsar el botón y no elegir motivo en 7 s: lo pierde.
- **Quién y cómo** (4, 8, 21): el entrenador, con la tableta del banquillo, en **dos pasos**: botón CHALLENGE (suena una bocina)
  y luego el motivo en un menú (7 s para elegirlo). Si falla la tableta, de palabra y con la señal.
- **Qué se puede pedir** (3b), si no hay sistema automático de dentro/fuera:
  a) **Dentro / fuera** (líneas laterales y de fondo); b) **toque de bloqueo** (con el balón fuera, o seguido de 3 toques, 4 toques o dobles);
  c) **red** entre las antenas al jugar el balón; d) **antena** (jugador o balón); e) **pie**: del sacador en la línea de fondo
  o fuera de la zona de saque, en la línea de 3 m, o cruzar del todo la línea central; f) **balón que toca el suelo** («pancake»);
  g) **último toque** en balones simultáneos sobre la red; h) **invasión por encima de la red** (solo con la tecnología necesaria).
  Pedir algo que no está en la lista cuenta como challenge fallado, y repetirlo se puede sancionar como retraso (5).
- **Con ojo de halcón automático** (3a): el dentro/fuera ya **no se puede pedir**; el sistema lo muestra solo
  (en la pantalla gigante, los botes a menos de 20 cm de la línea; en la tele, a menos de 7 cm).
- **El procedimiento** (9, 10): el 2º árbitro aclara con el entrenador qué y cuándo («toque de red en el 2º ataque…»), el 1r hace la
  señal de aceptar, el árbitro de vídeo revisa (prima la precisión sobre la rapidez), se ve la imagen en la **pantalla gigante**,
  el 1r anuncia y señala quién gana el punto y saca. El marcador se corrige si hace falta.
- **La primera falta manda** (13, 18): si en las imágenes aparece una falta anterior, aunque no sea la pedida, es la que decide el punto.
  Si la falta pedida existe pero no es la primera, el equipo pierde el punto pero conserva el challenge.
- **El 1r árbitro también puede pedir revisión** (12): al acabar cualquier jugada, si duda (señal con las dos manos). El equipo que pierde
  el punto por esa revisión puede pedir otro challenge en la misma interrupción.
- **Otros** (6, 14, 16, 19, 23): el challenge va antes que tiempos muertos y cambios. Si el equipo que lo pide gana la jugada igualmente,
  se anula. Si el rival admite el toque, punto para el que lo pidió y lo conserva. Cada equipo, 1 por interrupción (los dos pueden pedir).
  Nadie entra a la pista durante la revisión. La decisión es **definitiva**.

## Cómo llevarlo al juego (propuesta; está en el backlog de TRASPASO.md)

- **Error arbitral**: solo en botes muy cerca de la línea. Probabilidad de que el árbitro se equivoque que baja con la distancia
  (por ejemplo ~35 % a 0-2 cm, ~15 % a 2-5 cm, ~5 % a 5-10 cm, 0 % a más de 10 cm), afinada con simtest. **Sin avisar al jugador**:
  el árbitro canta y el juego sigue normal. Determinista con la semilla del partido (sim.js ya usa `g.rng`).
- **Challenge del jugador**: botón CHALLENGE (tecla, mando y táctil) durante **7 s** tras cada punto, con el contador visible
  junto al marcador (2 por set: acertar no gasta, fallar sí y sin ninguno ya no se puede pedir).
  Para empezar, solo **dentro/fuera**; más adelante, toque de bloqueo, red y antena, que la sim ya conoce (`g.antennaHit`, toques).
- **La revisión**: plano de la cámara bajando al punto de bote con la **marca del balón** y la distancia a la línea («IN / OUT», cm),
  como en la tele; el árbitro confirma o cambia y el marcador se corrige. Con «Cámara estable» o en táctil, versión corta.
- **La CPU también pide challenges** (con criterio: solo si el bote fue muy justo y tiene alguno), para que se vea el sistema.
- Encaja con el modo 6v6 y con Carrera (VNL/Olimpiadas siempre con challenge; ligas modestas, sin él: más errores sin remedio).

## Dentro / fuera con el balón entero (12-nov-2026, petición de Ferran)

«El challenge debería medir todo el diámetro de la bola: 1 solo píxel de la bola que toque la línea significa que ha ido dentro.»
Es la regla FIVB 8.3 (el balón es «dentro» cuando toca el suelo de la pista, **líneas incluidas**, con cualquier parte de él).

- Antes: `C.IN_TOL = 0,03` (huella de contacto del balón real, 3 cm). Pero el balón del juego se dibuja con `C.BR = 0,21` y la huella
  de la revisión (fx.js `placeReview`) también: una huella que pisaba la línea hasta 18 cm salía «OUT».
- Ahora: `C.IN_TOL = C.BR = 0,21`. `lineDist(x, y, g) = min(HL + BR − |x|, HW + BR − |y|)`: distancia firmada del borde de la huella
  del balón dibujado al borde exterior de la línea (g.HL/g.HW miden hasta el borde exterior: arena.js pinta las líneas de 5 cm por
  dentro). Dentro ⇔ `dist ≥ 0`.
- Usan esa misma definición: `land()` (verdad `truthIn`, evento `land.inside`/`dist`), el error arbitral B1 (bandas de ≤ 10 cm desde
  el borde de la huella), el challenge (`g.review`, `challengeResult.truthIn/dist`), la decisión de la CPU (B3, `cpuChallengeDecide`),
  la IA que deja botar el saque (ai.js `leaveServe`), `serveRisk` (sim.js: saque fuera = `lineDist < 0`), el aro de caída de fx.js
  (`C.IN_TOL`) y la huella de la revisión (fx.js, radio `C.BR`). Con «IN», `dist` = cuánto pisa la huella la línea; con «OUT», el hueco.
- simtest «llamada de línea» (pabellón y playa, lateral y fondo: centro a BR − 5 mm fuera = dentro, a BR + 5 mm = fuera) y
  «challenge con la huella entera» (pisa 5 mm = IN y se anula la llamada; 5 mm de hueco = OUT).

### Dibujo de la revisión ajustado a la regla (fx.js, verificador 12-nov-2026)
- `revTex`: el filo oscuro de la huella va por dentro del disco (r 106..114 de 128): el borde exterior visible es exactamente `C.BR`.
  Antes el trazo salía ~7 mm y un OUT por 5 mm parecía tocar.
- `placeReview`: la línea resaltada (5 cm + 1,2 cm) acaba justo en el borde exterior de la línea pintada (antes sobresalía 6 mm
  hacia fuera) y el halo (`revGlow`, 24 cm) va solo hacia dentro de la pista: no ilumina el hueco de un OUT.
- `revLine` color 0.42/0.74/0.80 (antes 0.55/0.95/1): por debajo del umbral del bloom (0,82), sin halo que tape milímetros.
- Comprobado proyectando la escena: a 1280×720 en la revisión 1 cm ≈ 4 px; huella a 5 mm = 2 px de la línea (OUT) o 2 px dentro (IN).
- Esquinas (12-nov, revisión): `Sim.lineDist` mide la huella como DISCO. Con el centro fuera por las dos líneas devuelve
  `C.IN_TOL - hypot(|x|-HL, |y|-HW)` (antes un cuadrado de lado R: 224/728 botes de esquina mal cantados). El resto, igual.
  El marcador de caída de fx.js y `serveRisk` usan ya `lineDist` (mismo criterio). simtest lo prueba («esquinas en disco»).
- `placeReview` elige la línea con la regla firmada de `lineDist` (`dEnd <= dSide`, antes por valor absoluto: junto a la
  prolongación de la lateral cogía la lateral y la huella alargada parecía tocar). La barra resaltada y el halo acaban en la
  esquina de la pista; cerca de la esquina (centro fuera y a < 1,2·R de la prolongación) la huella no se alarga.
- Texto del resultado (ui.js `challengeResult`, arena.js pantalla): IN con dist <= 5 cm «Pisa la línea x cm» / «IN POR x cm»;
  hasta 2·R + 5 cm «Sobre la línea» / «IN · SOBRE LÍNEA»; más, «Dentro» / «IN» (dist mide desde el borde exterior de la línea
  hasta el borde interior de la huella; solo hasta 5 cm es «cuánto pisa»). OUT sin cambios: «A x cm de la línea».

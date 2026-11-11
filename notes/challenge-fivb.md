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

#!/usr/bin/env bash
# VOLEY 3D — vuelca los mensajes de consola de una escena (owner: ui_main)
# Uso: tools/console.sh <escena|all> [W=1280] [H=720] [params extra]
# Imprime la consola de la página y sale con 1 si hay errores JS (excepción, console.error, [VB][ERROR], error de WebGL).
# Delegado en tools/shot.js (sin captura; viewport exacto y GPU real; GL=swiftshader para software).
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCENE="${1:-menu}"; W="${2:-1280}"; H="${3:-720}"; EXTRA="${4:-}"
JS="$DIR/tools/shot.js"; command -v cygpath >/dev/null 2>&1 && JS="$(cygpath -m "$JS")"
if [ "$SCENE" = all ] || [[ "$SCENE" == *,* ]]; then
  # varias escenas: captura igualmente (es barato) en tools/out/console-WxH/
  OUT="$DIR/tools/out/console-${W}x$H"; command -v cygpath >/dev/null 2>&1 && OUT="$(cygpath -m "$OUT")"
  node "$JS" "$SCENE" "$W" "$H" "$OUT" "$EXTRA"; exit $?
fi
node "$JS" none "$W" "$H" "" "debug=$SCENE${EXTRA:+&$EXTRA}"

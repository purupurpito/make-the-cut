#!/usr/bin/env bash
# VOLEY 3D — captura de pantalla headless (owner: ui_main)
# Uso: tools/shot.sh <escena> [W=1280] [H=720] [out.png] [params extra, p.ej. "seed=3&live=1"]
# Escenas: ver CONTRACT.md §6 (o "all" + carpeta de salida para todas).
# Delegado en tools/shot.js: viewport EXACTO vía DevTools y GPU real (GL=swiftshader para software).
# WAIT=ms (o VTB=ms, compatibilidad) = espera en tiempo real tras cargar (4000 por defecto). TOUCH=1 emula táctil.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCENE="${1:-menu}"; W="${2:-1280}"; H="${3:-720}"; OUT="${4:-}"; EXTRA="${5:-}"
if [ -z "$OUT" ]; then
  if [ "$SCENE" = all ] || [[ "$SCENE" == *,* ]]; then OUT="$DIR/tools/out/shots-${W}x$H"; else OUT="$DIR/tools/out/$SCENE-${W}x$H.png"; fi
fi
case "$OUT" in /*|[A-Za-z]:*) ;; *) OUT="$PWD/$OUT" ;; esac  # ruta relativa → absoluta
command -v cygpath >/dev/null 2>&1 && OUT="$(cygpath -m "$OUT")"
QUIET=1 node "$(command -v cygpath >/dev/null 2>&1 && cygpath -m "$DIR/tools/shot.js" || echo "$DIR/tools/shot.js")" "$SCENE" "$W" "$H" "$OUT" "$EXTRA" >&2 || true
if [ "$SCENE" = all ] || [[ "$SCENE" == *,* ]]; then echo "$OUT"; exit 0; fi
[ -s "$OUT" ] && echo "$OUT" || { echo "no se generó $OUT" >&2; exit 1; }

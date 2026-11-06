#!/usr/bin/env bash
# VOLEY 3D — vuelca los mensajes de consola de una escena (owner: ui_main)
# Uso: tools/console.sh <escena> [W=1280] [H=720] [params extra]
# Imprime las líneas de consola (CONSOLE/ERROR) y sale con 1 si hay errores JS.
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCENE="${1:-menu}"; W="${2:-1280}"; H="${3:-720}"; EXTRA="${4:-}"
URL="file://$DIR/index.html?debug=$SCENE${EXTRA:+&$EXTRA}"
PROFILE="$(mktemp -d)"; LOG="$(mktemp)"
trap 'rm -rf "$PROFILE" "$LOG"' EXIT
timeout -k 5 "${TMO:-150}" google-chrome --headless=new --no-sandbox --user-data-dir="$PROFILE" \
  --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --mute-audio \
  --enable-logging=stderr --v=0 --window-size="$W,$H" --virtual-time-budget="${VTB:-6000}" \
  --dump-dom "$URL" >/dev/null 2>"$LOG" || true
# solo mensajes de la página (file://) o de las librerías de CDN
grep -E 'CONSOLE' "$LOG" | grep -E 'source: (file://|https://(cdnjs|cdn\.jsdelivr|unpkg))' | sed -E 's/^.*CONSOLE[^]]*\] //' || true
if grep -E 'CONSOLE' "$LOG" | grep -E 'source: (file://|https://(cdnjs|cdn\.jsdelivr|unpkg))' | grep -qE 'Uncaught|\[VB\]\[ERROR\]|THREE\.WebGL(Program|Renderer).*(rror|fail)'; then echo "== HAY ERRORES ==" >&2; exit 1; fi
echo "== sin errores JS =="

#!/usr/bin/env bash
# VOLEY 3D — vuelca los mensajes de consola de una escena (owner: ui_main)
# Uso: tools/console.sh <escena> [W=1280] [H=720] [params extra]
# Imprime las líneas de consola (CONSOLE/ERROR) y sale con 1 si hay errores JS.
# Usa la GPU por defecto (ver tools/chrome-env.sh); GL=swiftshader para render por software.
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$DIR/tools/chrome-env.sh"
SCENE="${1:-menu}"; W="${2:-1280}"; H="${3:-720}"; EXTRA="${4:-}"
URL="$(file_url "$DIR/index.html")?debug=$SCENE${EXTRA:+&$EXTRA}"
PROFILE="$(mktemp -d)"; LOG="$(mktemp)"
trap 'rm -rf "$PROFILE" "$LOG"' EXIT
timeout -k 5 "${TMO:-90}" "$CHROME_BIN" --headless=new --no-sandbox --no-first-run --no-default-browser-check \
  --user-data-dir="$(native_path "$PROFILE")" "${GPU_FLAGS[@]}" --mute-audio \
  --enable-logging=stderr --v=0 --window-size="$W,$H" --virtual-time-budget="${VTB:-6000}" \
  --dump-dom "$URL" >/dev/null 2>"$LOG" || true
# solo mensajes de la página (file://) o de las librerías de CDN
grep -E 'CONSOLE' "$LOG" | grep -E 'source: (file://|https://(cdnjs|cdn\.jsdelivr|unpkg))' | sed -E 's/^.*CONSOLE[^]]*\] //' || true
if grep -E 'CONSOLE' "$LOG" | grep -E 'source: (file://|https://(cdnjs|cdn\.jsdelivr|unpkg))' | grep -qE 'Uncaught|\[VB\]\[ERROR\]|THREE\.WebGL(Program|Renderer).*(rror|fail)'; then echo "== HAY ERRORES ==" >&2; exit 1; fi
# Si Chrome no dejó ninguna línea de consola, avisar (el log puede no haberse capturado)
grep -q 'CONSOLE' "$LOG" || echo "(aviso: Chrome no volcó mensajes de consola)" >&2
echo "== sin errores JS =="

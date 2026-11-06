#!/usr/bin/env bash
# VOLEY 3D — captura de pantalla headless (owner: ui_main)
# Uso: tools/shot.sh <escena> [W=1280] [H=720] [out.png] [params extra, p.ej. "seed=3&live=1"]
# Escenas: menu serve rally spike block point over mobile pause
# Usa la GPU por defecto (ver tools/chrome-env.sh); GL=swiftshader para render por software.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$DIR/tools/chrome-env.sh"
SCENE="${1:-menu}"; W="${2:-1280}"; H="${3:-720}"; OUT="${4:-$DIR/tools/out/$SCENE-${W}x$H.png}"; EXTRA="${5:-}"
URL="$(file_url "$DIR/index.html")?debug=$SCENE${EXTRA:+&$EXTRA}"
mkdir -p "$(dirname "$OUT")"; rm -f "$OUT"
PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT
timeout -k 5 "${TMO:-90}" "$CHROME_BIN" --headless=new --no-sandbox --no-first-run --no-default-browser-check \
  --user-data-dir="$(native_path "$PROFILE")" "${GPU_FLAGS[@]}" --hide-scrollbars --mute-audio \
  --window-size="$W,$H" --virtual-time-budget="${VTB:-6000}" --screenshot="$(native_path "$OUT")" "$URL" >/dev/null 2>&1 || true
[ -s "$OUT" ] && echo "$OUT" || { echo "no se generó $OUT" >&2; exit 1; }

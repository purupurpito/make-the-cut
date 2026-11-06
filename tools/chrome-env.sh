#!/usr/bin/env bash
# VOLEY 3D — configuración común de Chrome para tools/shot.sh y tools/console.sh (owner: ui_main)
# Elige el ejecutable de Chrome, las banderas de GPU y la forma de la URL file:// según el sistema.
#   CHROME=/ruta/a/chrome   fuerza el ejecutable
#   GL=swiftshader          fuerza render por software (máquinas sin GPU)
#   GL=d3d11|vulkan|gl      fuerza el backend de ANGLE
# Uso: source "$(dirname "$0")/chrome-env.sh"  →  define CHROME_BIN, GPU_FLAGS (array), file_url <ruta>

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) VB_OS=win ;;
  Darwin) VB_OS=mac ;;
  *) VB_OS=linux ;;
esac

if [ -n "${CHROME:-}" ]; then
  CHROME_BIN="$CHROME"
else
  CHROME_BIN=""
  case "$VB_OS" in
    win)
      for c in "/c/Program Files/Google/Chrome/Application/chrome.exe" \
               "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" \
               "$LOCALAPPDATA/Google/Chrome/Application/chrome.exe" \
               "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"; do
        [ -x "$c" ] && { CHROME_BIN="$c"; break; }
      done ;;
    mac) CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ;;
    *) CHROME_BIN="$(command -v google-chrome || command -v chromium || command -v chromium-browser || echo google-chrome)" ;;
  esac
fi

# Backend por defecto: la tarjeta gráfica real (D3D11 en Windows, Metal en Mac, Vulkan/GL en Linux).
if [ -z "${GL:-}" ]; then
  case "$VB_OS" in win) GL=d3d11 ;; mac) GL=metal ;; *) GL=gl ;; esac
fi
if [ "$GL" = swiftshader ]; then
  GPU_FLAGS=(--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader)
else
  GPU_FLAGS=(--use-gl=angle "--use-angle=$GL" --enable-gpu --ignore-gpu-blocklist --enable-gpu-rasterization)
fi

# Ruta local → URL file:// válida en cada sistema (en Windows: file:///C:/...)
file_url() {
  if [ "$VB_OS" = win ]; then echo "file:///$(cygpath -m "$1")"; else echo "file://$1"; fi
}
# Ruta local → ruta que entiende el propio Chrome (en Windows, C:/...)
native_path() {
  if [ "$VB_OS" = win ]; then cygpath -m "$1"; else echo "$1"; fi
}

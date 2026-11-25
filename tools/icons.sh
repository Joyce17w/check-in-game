#!/bin/sh
# Renders icons/icon.svg to the PNG sizes the app uses.
# Needs Google Chrome (to draw the SVG) and sips (built into macOS).
set -e
cd "$(dirname "$0")/.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP=$(mktemp -d)
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1024,1024 --default-background-color=00000000 \
  --screenshot="$TMP/icon-1024.png" "file://$PWD/icons/icon.svg" >/dev/null 2>&1
for size in 180 192 512; do
  sips -s format png -z $size $size "$TMP/icon-1024.png" --out "icons/icon-$size.png" >/dev/null
done
rm -rf "$TMP"
echo "Wrote icons/icon-180.png, icon-192.png, icon-512.png"

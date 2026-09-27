#!/usr/bin/env bash
# Arayüz yazı tiplerini (OFL lisanslı) web/fonts altına indirir; internet yoksa sistem yazı tipi kullanılır.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)/web/fonts"
mkdir -p "$DIR"
GF=https://raw.githubusercontent.com/google/fonts/main/ofl/barlowcondensed
PLEX=https://raw.githubusercontent.com/IBM/plex/master/packages/plex-sans/fonts/complete/woff2
for f in BarlowCondensed-Medium BarlowCondensed-SemiBold BarlowCondensed-Bold; do
  [ -s "$DIR/$f.ttf" ] || curl -fsSL -o "$DIR/$f.ttf" "$GF/$f.ttf" || echo "indirilemedi: $f"
done
for f in IBMPlexSans-Regular IBMPlexSans-Medium IBMPlexSans-SemiBold; do
  [ -s "$DIR/$f.woff2" ] || curl -fsSL -o "$DIR/$f.woff2" "$PLEX/$f.woff2" || echo "indirilemedi: $f"
done
echo "yazı tipleri: $DIR"

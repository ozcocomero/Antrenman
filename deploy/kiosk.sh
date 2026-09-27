#!/usr/bin/env bash
# Started by the desktop session (labwc/wayfire autostart): waits for the backend, then opens
# the UI full screen. Chromium restarts if it crashes.
URL="${PT_URL:-http://localhost:8080/}"
BROWSER="$(command -v chromium || command -v chromium-browser)"
for _ in $(seq 60); do curl -fs -o /dev/null "$URL" && break; sleep 1; done
while true; do
  "$BROWSER" --kiosk --app="$URL" --noerrdialogs --disable-infobars --no-first-run \
    --disable-session-crashed-bubble --disable-features=Translate,TouchpadOverscrollHistoryNavigation \
    --overscroll-history-navigation=0 --disable-pinch --check-for-update-interval=31536000 \
    --ozone-platform=wayland --password-store=basic
  sleep 2
done

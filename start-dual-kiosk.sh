#!/usr/bin/env bash
# Dual-TV kiosk launcher for a Raspberry Pi 4/5 (two HDMI outputs, no splitter).
#
# TV 1 (HDMI-0) shows the primary app; TV 2 (HDMI-1) shows the secondary
# display (?screen=2). Press 7 on the keyboard to cycle display modes:
# Mirror → Clock + Timer → Split Timers.
#
# Notes:
# - SCREEN2_X must match TV 1's horizontal resolution (1920 for 1080p, 3840
#   for 4K) so the second window lands on the second TV.
# - --window-position requires X11. On Raspberry Pi OS Bookworm the default
#   is Wayland: run `sudo raspi-config` → Advanced Options → Wayland → X11.
# - The secondary window is launched first so the primary ends up with
#   keyboard focus (keys pressed on the secondary are relayed anyway).

set -u
cd "$(dirname "$0")"
children=()
cleanup() {
  trap - EXIT INT TERM
  for pid in "${children[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  for pid in "${children[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

SCREEN2_X="${SCREEN2_X:-1920}"
CHROMIUM="$(command -v chromium-browser || command -v chromium || true)"
if [ -z "$CHROMIUM" ]; then
  echo "start-dual-kiosk: no chromium-browser or chromium binary found in PATH" >&2
  exit 1
fi

node update-server.js &
children+=("$!")
npx serve . &
children+=("$!")

# Wait for the static server to come up
for _ in $(seq 1 30); do
  curl -sf -o /dev/null http://localhost:3000/ && break
  sleep 1
done

"$CHROMIUM" --kiosk --noerrdialogs --disable-infobars \
  --user-data-dir="$HOME/.config/bjj-kiosk-2" \
  --window-position="$SCREEN2_X,0" \
  "http://localhost:3000/?screen=2" &
children+=("$!")

sleep 2

"$CHROMIUM" --kiosk --noerrdialogs --disable-infobars \
  --autoplay-policy=no-user-gesture-required \
  --user-data-dir="$HOME/.config/bjj-kiosk-1" \
  --window-position=0,0 \
  "http://localhost:3000/?dual=1" &
children+=("$!")

wait

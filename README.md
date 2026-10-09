Screen Modes

# Main Screen

## Next Class Info (Top left)
## Todays Clock (Top Right)
## Rounds Timer (Top Center)
## Rest Timer (Bottom Center)
## Legend (Bottom Right)
## Rounds Info (Bottom Left)
## Next Class Info (Bottom Left)

# Preset Screen

## IBJJF Presets (Top)
## Advanced Presets (Botom)

# Settings Screen

# Remote control

The kiosk is driven by an **Apple Remote** (aluminum, 7 buttons) through a
**Flirc USB** receiver. Flirc turns each infrared button into an ordinary
keystroke, so a keyboard works the same way and no driver is needed on the Pi.

| Button | Tap | Hold |
| --- | --- | --- |
| ▶⏸ | ready → start → pause → resume | stop (back to ready) |
| OK (center) | same as ▶ outside menus; select in menus; start in editing | reset to defaults |
| Menu | open the main menu; back / close; cancel editing | reset to defaults |
| Ring ▲▼ | enter editing and adjust the value; move the highlight in menus | adjust by ×5 |
| Ring ◀▶ | next / previous field in editing | — |

While idle the main menu lists Training, Competition, Schedule, Screens (dual
mode only), Blank screen, Holiday theme and Weekly schedule (OK toggles ON/OFF
in place), Update app (asks for confirmation, highlight starts on No) and About.
While a timer runs it is just Pause/Resume, Reset timer and Blank screen; each
closes the menu. Whenever the app is not in its default state (a timer running
or paused, the ready state, a preset or custom settings selected, dual timer
on) a **Reset** row is added as the first option: it stops everything, clears
the selection and returns to the defaults (or the active class preset). Training value prompts step with the ring
and confirm with OK; typing digits still works from a keyboard.

Program Flirc with these keys (Flirc GUI → full keyboard; holds via the CLI):

| Remote button | Tap key | Long-press key |
| --- | --- | --- |
| ▶⏸ | Space | 0 |
| OK | Enter | — |
| Menu | Escape | Delete |
| Up / Down | Up / Down arrow | Page Up / Page Down |
| Left / Right | Left / Right arrow | — |

```
flirc_util record_lp 0         # hold ▶⏸
flirc_util record_lp delete    # hold Menu
flirc_util record_lp pageup    # hold Up
flirc_util record_lp pagedown  # hold Down
```

Flirc's long-press keys replace the in-app 800 ms hold timer, which still
works for a keyboard: hold Space or Escape instead. The original numpad
bindings (`Enter`, `0`, `+`/`-`, `*`, `/`, `9`, `7`, `.`) remain as shortcuts.

# Schedule sync

`sync-schedule.js` (also reachable from About: press ▶ Right twice, or `*` `*`, then pick "Sync class schedule")
pulls the live class list from Gymdesk and writes it to `schedule.json`. That
file is git-ignored and, when present, replaces the `schedule` array bundled in
`config.json` at load time, so syncing never dirties the working tree and
`git pull` on the kiosk cannot conflict with it. Delete `schedule.json` to fall
back to the bundled schedule.

# Tests

`npm test` runs the vitest suite in `app.test.js` (jsdom environment). It
covers the timer engine, storage, schedule logic, renderer, overlays, key
handling, dual-screen sync, the update server and the schedule sync parser.

# Dual-TV Setup (Raspberry Pi 4/5)

Plug each TV into its own micro-HDMI port (no splitter) and run
`./start-dual-kiosk.sh`. It starts the static server (3000) and the update
server (3001), then opens two Chromium kiosk windows:

- TV 1: `http://localhost:3000/?dual=1` — the primary; runs the timers and
  takes keyboard input
- TV 2: `http://localhost:3000/?screen=2` — a display-only window fed UI
  snapshots by the primary through the update server (SSE on port 3001)

Dual-screen support is strictly opt-in via those URL params. The plain URL
(`http://localhost:3000/`) runs the original single-screen app with none of
the dual-screen behavior — no state broadcasting, no Screens menu item.

Pick **Screens** from the main menu (or press **7**) to cycle display modes
(persisted across restarts):

1. **Mirror** — both TVs show the same content
2. **Clock + Timer** — TV 1 shows the timer, TV 2 a dedicated big clock
   with the schedule
3. **Split Timers** — activates dual-timer mode with timer 1 fullscreen on
   TV 1 and timer 2 fullscreen on TV 2

Keys pressed while TV 2's window has focus are relayed to the primary, so
the remote works whichever window has focus. Set `SCREEN2_X` (default 1920) to TV 1's
horizontal resolution so the second window lands on the second TV.
`--window-position` needs X11 — on Raspberry Pi OS Bookworm switch via
`sudo raspi-config` → Advanced Options → Wayland → X11.


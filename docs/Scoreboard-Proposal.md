# Proposal: optional match scoreboard for competition presets

Status: implemented October 23, 2026 (app.js `Scoreboard`, InputHandler ring
routing, `#scoreboard` markup and styles in index.html; see README
"Scoreboard"). Mockups kept for reference: `scoreboard-mockup-start.png`
(match just started, 0-0) and `scoreboard-mockup.png` (mid-match, a +2 burst
on Blue). Two details changed while implementing: the panels go compact and
both timers step down a size during the rest phase so the screen never
overflows, and the toggle row in Competition Presets is reached with ▲▼ while
the digit keys still pick presets directly.

## Goal

Let a table official keep an IBJJF-style score (points, advantages, penalties)
for one match while a competition preset runs, using only the Apple Remote /
Flirc buttons we already map. Time stays first: the round timer keeps its size
and place, and the mode is off unless someone turns it on.

## Turning it on

- A toggle row `Scoreboard  Off/On` at the top of the Competition Presets
  list. OK flips it in place (same pattern as Holiday theme). Persisted in
  localStorage (`bjj-timer-scoreboard`), so a tournament day sets it once.
- The same toggle appears in the main menu while a competition preset is the
  active preset.
- Training presets, chainsaw and plain custom times never show the scoreboard.

## Screen

Below the round timer, where the rest timer sits today (the `Round 1` line
stays underneath):

- Two panels, blue (left) and white (right), the gi colours a referee calls.
  The colour alone identifies the side; there are no "Blue" / "White" labels.
- Six fields. The ADV/PEN stack sits on the outer side of each panel and
  the points on the inner side, so ◀ ▶ always move the border the same
  direction on screen. Ring order:
  `Blue PEN · Blue ADV · Blue POINTS | White POINTS · White ADV · White PEN`
  (on the blue side ◀ from POINTS goes up the stack to ADV, then PEN; on the
  white side ▶ from POINTS goes to ADV, then PEN).
  Points are the large DSEG7 number and take most of the panel; ADV and PEN
  are a small stacked pair beside it (ADV above PEN), and every label sits
  underneath its number. A penalty count of 1 or more turns
  red (4 is a disqualification under IBJJF rules; the count is shown, no
  automatic action).
- The selected number gets a border around the whole number that blinks
  together with the digits, the same treatment as the active digit group in
  time-setting mode (white on the Blue panel, black on the White panel).
  Nothing else is drawn between the panels: no cues, no instructions.
- The rest timer still takes over the big slot during the rest phase exactly
  as today; the panels keep their values through rest so the table can read
  the result.
- Both panels are plain DOM, so the second TV mirrors them through the
  existing snapshot sync.

## Remote mapping while a round is live or paused

While a round is live the ring currently only shows "stop the timer first", so
all four directions are free:

| Button | Action |
| --- | --- |
| Match start | Scores reset to 0-0, border on Blue POINTS. |
| ◀ / ▶ | Move the border one field along the ring order. From Blue POINTS, ◀ goes to Blue ADV, then Blue PEN; ▶ goes to White POINTS, then White ADV, then White PEN. Stops at the ends. |
| ▲ / ▼ | Add / remove 1 from the focused value (never below 0). |
| After an ADV or PEN change | Border returns to that side's POINTS. |
| ▶ tap, OK tap | Pause / resume, unchanged. |
| ▶ hold, OK hold, Menu hold | Stop / reset, unchanged. A reset also clears the panels. |
| Menu tap | Running menu, unchanged, plus a `Reset score` row. |

Flirc's held-ring keys (PageUp / PageDown) are not used by the scoreboard, so
nothing changes if they arrive.

## Burst superscript

Every ▲ or ▼ shows a small yellow superscript at the top right of the focused
value with the net change of the current burst: the first press shows `+1`,
another press within the window shows `+2`, a ▼ after that shows `+1` again,
and a lone ▼ shows `-1`. The superscript fades out about two seconds after
the last press; the next press after it has faded starts a new burst at `+1`
or `-1`. The number underneath always shows the committed total, so the
superscript is feedback only.

## Feedback and sound

- Moving the border: existing soft click (`playMuffle`).
- Each ▲ / ▼: a short tick.
- End of round: panels stay as they are. No automatic winner; the referee
  decides ties and submissions.

## Not in scope

- Competitor names, brackets, match lists, results history.
- Submission / DQ / walkover outcomes.
- Scoring in dual-timer mode (Scoreboard is ignored while Screens is in dual
  mode).

## Implementation sketch

- `ScoreState` on the InputHandler: `{ blue: { points, adv, pen }, white:
  {...}, focus: 0..5 (ring order), burst: { field, delta, timer } }`. Not
  persisted; reset on start and on timer reset.
- `InputHandler._onKeyDown`: when the scoreboard is on and `_sessionLive()`,
  route ◀ ▶ ▲ ▼ to `_handleScoreKey` instead of the stop-first notice.
- `Renderer.renderScoreboard(state)` writes `#scoreboard` before
  `#round-counter`; `body.scoreboard` hides `#rest-section` while a round runs
  (the rest phase swap is untouched).
- Strings for Blue / White / Points / Adv / Pen / Reset score / Scoreboard in
  en and pt. Snapshot sync needs `#scoreboard` in `SYNC_SECTION_IDS`.
- Tests: key routing live vs idle, ring-order focus walk with end stops,
  ADV/PEN change returns focus to points, burst superscript timing with fake
  timers, floor at 0, reset clears, toggle persistence, snapshot includes the
  panel.

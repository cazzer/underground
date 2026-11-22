# ost.11: frame a bare station's entrances on phones

Measured with `measure.mjs` (Playwright, dev server). "Before" is origin/main `68e81ee`, with the dev-only
`__underground.entrancesAt()` probe copied in (never committed there). "After" is this branch with the review fixes:
a 100 m target radius, the neighbour and centred-target limits, nearest-first entrances, and deep-link
classification. Each page lands on 127 Times Sq-42 St (`select('127')`), then on 120 96 St, whose streets load during
the flight, waiting 5 s per landing. A last phone page opens `#station=127` directly: it selects before the station
index loads. Phone: 390x844, isMobile, hasTouch, scale 3. Desktop: 1440x900. Every row is in the JSON files.

Two panel heights:
- **Live:** with `VITE_RT_URL` set to the deployed Worker, the phone panel shows six arrival rows and the entrances
  row, so the free strip is only 60..249.5 px.
- **No live:** with no `VITE_RT_URL`, the panel holds one line and the free area runs 60..510.5 px.

Columns:
- **distance:** camera distance, m.
- **|T-S|:** the target's distance from the station point, m.
- **marks in:** entrance marks inside the free rect / total.
- **min margin:** the smallest margin of any mark or the station to the free rect's edge, px. Negative means outside.
- **station margin:** the same for the station alone.
- **focused after:** the focused station 2 s after landing, which gives the 400 ms auto-focus dwell its chance.

| Case | | distance | \|T-S\| | marks in | min margin | station margin | focused after |
|---|---|---|---|---|---|---|---|
| phone, live, 127 | before | 400 | 138.3 | 8/11 | -63.7 | 35.9 | 127 |
| | after | 400 | 98.1 | 6/11 | -129.4 | **-14.6** | 127 |
| phone, live, 120 | before | 400 | 138.3 | 2/6 | -120.2 | 35.9 | 120 |
| | after | 400 | 98.1 | 2/6 | -195.5 | **-14.6** | 120 |
| phone, live, 127, reduced motion | before | 400 | 123.8 | 8/11 | -86.2 | 18.5 | 127 |
| | after | 400 | 98.2 | 3/11 | -152.8 | **-22.8** | 127 |
| phone, live, 127, deep link | before | 400 | 138.3 | 8/11 | -63.7 | 35.9 | |
| | after | 400 | 98.1 | 6/11 | -129.4 | **-14.6** | |
| phone, no live, 127 | before | 400 | 70.8 | 9/11 | -71.4 | 195 | 127 |
| | after | 560 | 52.6 | 11/11 | 12.0 | 161 | 127 |
| phone, no live, 120 | before | 400 | 70.8 | 4/6 | -58.8 | 195 | 120 |
| | after | 400 | 86.8 | 6/6 | 12.0 | 141.9 | 120 |
| phone, no live, 127, reduced motion | before | 400 | 56.3 | 9/11 | -78.1 | 186 | 127 |
| | after | 560 | 52.6 | 11/11 | 12.0 | 161 | 127 |
| phone, no live, 127, deep link | before | 400 | 70.8 | 9/11 | -71.4 | 195 | |
| | after | 560 | 52.6 | 11/11 | 12.0 | 161 | |
| desktop, 127 (live and no live) | before | 400 | 44.9 | 11/11 | 192.1 | 386.5 | 127 |
| | after | 400 | 45.0 | 11/11 | 192.1 | 386.5 | 127 |
| desktop, 120 (live and no live) | before | 400 | 44.9 | 6/6 | 97.6 | 386.5 | 120 |
| | after | 400 | 45.0 | 6/6 | 97.6 | 386.5 | 120 |

## Findings

**The one-line panel works.** Every entrance lands in the free area at the 12 px pad, including on the deep link
(the index-late path) and under reduced motion. 127 pulls back to 560 m; 120 stays at 400 m. 127 stays focused with
725 drawn 27 m away.

**The live six-row panel is worse than main.**
- On main, 127 shows 8 of 11 marks and the station sits 36 px inside the strip. Now it shows 6 of 11, and the station
  marker sits 15 px under the panel's top edge, half hidden.
- The cause is the 190 px strip combined with the 100 m target radius. The plain landing's target is 138 m from the
  station, and no target within 100 m keeps the station point inside the strip. The helper then falls back to the
  plain target pulled to 100 m.
- With the earlier 120 m radius the station stayed inside, 13.7 px above the panel.
- No distance in 400..600 m fits 127's 193 m north-south spread, or 120's 154 m, into that strip at any radius.
  Meeting the acceptance needs a shorter panel at landing.

**The live reduced-motion row is its own case.** It snaps at once, most likely before the panel reaches its final
size (inferred, not traced), so it lands on an earlier panel's framing: 3 of 11 marks, and the station 23 px under the panel. Reframing when the panel grows after
landing is underground-ost.18.

**Desktop is unchanged.** It stays at 400 m with the centred target. The sub-metre differences come from the target
now being exact under perspective (`followTargetInto`), where main used a linear shift.

## Screenshots

Live panel: `before-phone-127.jpg`, `after-phone-127.jpg`, `before-phone-120.jpg`, `after-phone-120.jpg`,
`after-phone-reduced-127.jpg`, `after-phone-deeplink-127.jpg`.

One-line panel: `before-nolive-phone-127.jpg`, `after-nolive-phone-127.jpg`, `before-nolive-phone-120.jpg`,
`after-nolive-phone-120.jpg`, `after-nolive-phone-reduced-127.jpg`, `after-nolive-phone-deeplink-127.jpg`.

Desktop: `before-desktop-127.jpg`, `after-desktop-127.jpg`.

# ost.11: frame a bare station's entrances on phones

Measured with `measure.mjs` (Playwright, dev server) on origin/main `02ad077` ("before", with the dev-only
`__underground.entrancesAt()` probe copied in, never committed there) and on this branch ("after"). Each page lands on
127 Times Sq-42 St (`select('127')`), then 120 96 St (the second landing loads its streets during the flight), 5 s per
landing. Phone: 390x844, isMobile, hasTouch, scale 3. Desktop: 1440x900. The JSON files hold every row.

Two panel heights. With live trains (`VITE_RT_URL` set to the deployed Worker) the phone panel shows six arrival rows and
the entrances row, leaving a free strip of only 60..249.5 px. Without live data (no `VITE_RT_URL`) the panel holds one
line and the free area runs 60..510.5 px.

Columns: camera distance (m); |T-S|, the target's distance from the station point (m, clamped at 120); marks inside the
free rect / total; the smallest margin of any mark or the station to the free rect's edge (px, negative = outside);
the station's screen point; the focused station 2 s after the landing (the 400 ms auto-focus dwell had its chance).

| Case | | distance | \|T-S\| | marks inside | min margin | station px | focused after |
|---|---|---|---|---|---|---|---|
| phone, live, 127 | before | 400 | 138.3 | 8/11 | -63.7 | 195, 214 | 127 |
| | after | 400 | 120.0 | 7/11 | -92.4 | 195, 236 | 127 |
| phone, live, 120 | before | 400 | 138.3 | 2/6 | -120.2 | 195, 214 | 120 |
| | after | 400 | 120.0 | 2/6 | -153.0 | 195, 236 | 120 |
| phone, live, 127, reduced motion | before | 400 | 123.8 | 8/11 | -86.2 | 195, 231 | 127 |
| | after | 400 | 120.0 | 7/11 | -92.4 | 195, 236 | 127 |
| phone, no live, 127 | before | 400 | 70.8 | 9/11 | -71.4 | 195, 303 | 127 |
| | after | 500 | 113.8 | 11/11 | 12.0 | 167, 268 | 127 |
| phone, no live, 120 | before | 400 | 70.8 | 4/6 | -58.8 | 195, 303 | 120 |
| | after | 400 | 86.8 | 6/6 | 12.0 | 248, 282 | 120 |
| phone, no live, 127, reduced motion | before | 400 | 56.3 | 9/11 | -78.1 | 195, 324 | 127 |
| | after | 500 | 113.8 | 11/11 | 12.0 | 167, 268 | 127 |
| desktop, 127 (live and no live) | before | 400 | 44.9 | 11/11 | 192.1 | 561, 447 | 127 |
| | after | 400 | 45.0 | 11/11 | 192.1 | 560, 446 | 127 |
| desktop, 120 (live and no live) | before | 400 | 44.9 | 6/6 | 97.6 | 561, 447 | 120 |
| | after | 400 | 45.0 | 6/6 | 97.6 | 560, 446 | 120 |

Findings:
- Where the free area allows it (the one-line panel), every entrance lands in the free area at the 12 px pad, at 500 m
  for 127 and 400 m for 120, the target within 120 m; reduced motion lands in the same place. 127 stays focused with
  its neighbour 725 drawn nearby.
- With the live six-row panel the phone's free strip is 190 px tall. The station's own centred target is 138 m off its
  point, so the 120 m clamp binds at once; it holds the station 13.7 px above the strip's bottom, the entrances that
  don't fit are dropped (all of 127's nearest lie south of it, below it on screen), and the result matches main
  (7 vs 8 of 11, 2 of 6). No distance from 400 to 600 m fits 127's 193 m north-south spread, or 120's 154 m, in a 190 px
  strip with or without the clamp: the acceptance needs a shorter panel at landing.
- Desktop is unchanged: 400 m and the centred target (sub-metre differences: the target is now exact under
  perspective, `followTargetInto`, where main used a linear shift).

Screenshots: `before-phone-127.jpg`, `after-phone-127.jpg`, `before-phone-120.jpg`, `after-phone-120.jpg`,
`after-phone-reduced-127.jpg` (live panel); `before-nolive-phone-127.jpg`, `after-nolive-phone-127.jpg`,
`before-nolive-phone-120.jpg`, `after-nolive-phone-120.jpg`, `after-nolive-phone-reduced-127.jpg` (short panel);
`before-desktop-127.jpg`, `after-desktop-127.jpg`.

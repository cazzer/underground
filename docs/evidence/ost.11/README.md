# ost.11: frame a bare station's entrances on phones

Measured with `measure.mjs` (Playwright, dev server).

- **Before:** origin/main `5b08d63`, with the dev-only `__underground.entrancesAt()` probe patched in. It was never
  committed there.
- **After:** this branch, final round:
  - The target stays within 100 m of the station whenever entrances are framed, and within 120 m when only the
    station fits.
  - The target stays within 100 m of the centred target. Across the phone panels this never cost an entrance.
  - The neighbour rule is gone.
  - A stacked station panel shows the 3 destinations due soonest and "Show all N destinations" (card ost.11.1
    option A). The collapsed rows sit at the fixed height of three two-line-destination rows.
  - The live phone rows were re-measured after the panel-cap review fixes; the other rows are from the round before,
    whose framing is unchanged.

Each page lands on 127 Times Sq-42 St (`select('127')`), then on 120 96 St, whose streets load during the flight.
Each landing gets 5 s. A last phone page opens `#station=127` directly, which selects before the station index loads.
Phone: 390x844, isMobile, hasTouch, scale 3. Desktop: 1440x900. Every row is in the JSON files.

Two data states:
- **Live:** `VITE_RT_URL` points at the deployed Worker.
  - Main's phone panel shows every arrival group (six here), so the free strip runs 60..249.5 px.
  - The branch shows three destinations at a fixed height and the toggle, so the strip runs 60..337.5 px.
- **No live:** there is no `VITE_RT_URL`. The panel holds one line, and the free area runs 60..510.5 px.

Columns:
- **distance:** camera distance, m.
- **|T-S|:** the target's distance from the station point, m.
- **marks in:** entrance marks inside the free rect / total.
- **min margin:** the smallest margin of any mark or the station to the free rect's edge, px. Negative means outside.
- **station margin:** the same, for the station alone.
- **focused after:** the focused station 2 s after landing, after the 400 ms auto-focus dwell had its chance.

| Case | | distance | \|T-S\| | marks in | min margin | station margin | focused after |
|---|---|---|---|---|---|---|---|
| phone, live, 127 | before | 400 | 138.3 | 8/11 | -63.7 | 35.9 | 127 |
| | after | 400 | 98.7 | **9/11** | -83.3 | 68.9 | 127 |
| phone, live, 120 | before | 400 | 138.3 | 2/6 | -120.2 | 35.9 | 120 |
| | after | 400 | 98.1 | 2/6 | -107.5 | 73.4 | 120 |
| phone, live, 127, reduced motion | before | 400 | 123.8 | 8/11 | -86.2 | 18.5 | 127 |
| | after | 400 | 98.1 | 8/11 | -67.7 | 73.4 | 127 |
| phone, live, 127, deep link | before | 400 | 138.3 | 8/11 | -63.7 | 35.9 | |
| | after | 400 | 98.7 | 9/11 | -83.3 | 68.9 | |
| phone, no live, 127 | before | 400 | 70.8 | 9/11 | -71.4 | 195 | 127 |
| | after | 520 | 98.7 | 11/11 | 12.0 | 169.9 | 127 |
| phone, no live, 120 | before | 400 | 70.8 | 4/6 | -58.8 | 195 | 120 |
| | after | 400 | 86.8 | 6/6 | 12.0 | 141.9 | 120 |
| phone, no live, 127, reduced motion | before | 400 | 56.3 | 9/11 | -78.1 | 186 | 127 |
| | after | 520 | 98.7 | 11/11 | 12.0 | 169.9 | 127 |
| phone, no live, 127, deep link | before | 400 | 70.8 | 9/11 | -71.4 | 195 | |
| | after | 520 | 98.7 | 11/11 | 12.0 | 169.9 | |
| desktop, 127 (live and no live) | before | 400 | 44.9 | 11/11 | 192.1 | 386.5 | 127 |
| | after | 400 | 45.0 | 11/11 | 192.1 | 386.5 | 127 |
| desktop, 120 (live and no live) | before | 400 | 44.9 | 6/6 | 97.6 | 386.5 | 120 |
| | after | 400 | 45.0 | 6/6 | 97.6 | 386.5 | 120 |

## Findings

**127 on a live phone meets main's acceptance.** At least 8/11 marks with the station inside: it gets 9/11 with the
station 69 px inside the free area (8/11 under reduced motion). Main has 8/11 with the station 36 px inside.

The collapsed list now has a fixed height, so the strip no longer depends on which destinations are soonest. Earlier
runs with the height ratchet got strips of 358.5 and 376.5 px, landing with 9/11 and 10/11.

**120 on a live phone stays at 2/6**, the same as main. The station is now 73 px inside the free area. 120's
entrances spread 154 m north to south, and they don't fit above a three-destination panel within the 100 m target
radius. With the one-line panel it gets 6/6.

**The one-line panel frames every entrance** at the 12 px pad, including on the deep link (the index-late path) and
under reduced motion. 127 stays focused with 725 drawn 27 m away.

**Desktop is unchanged**, with every arrival group and no toggle. It stays at 400 m with the centred target. The
sub-metre differences come from the target now being exact under perspective.

**The collapsed list holds one fixed height.** That height is three rows whose destinations wrap to two lines,
split over both directions (`CollapsedSizer`). Polls neither grow nor shrink it. Shorter rows leave a blank band
under them inside the list (see `after-phone-127.jpg`); that is the cost of a panel that doesn't move. Expanding it
after landing makes the panel taller; reframing then is underground-ost.18.

## Screenshots

Live panel:
- `before-phone-127.jpg`, `after-phone-127.jpg`
- `before-phone-120.jpg`, `after-phone-120.jpg`
- `after-phone-reduced-127.jpg`, `after-phone-deeplink-127.jpg`

One-line panel:
- `before-nolive-phone-127.jpg`, `after-nolive-phone-127.jpg`
- `before-nolive-phone-120.jpg`, `after-nolive-phone-120.jpg`
- `after-nolive-phone-reduced-127.jpg`, `after-nolive-phone-deeplink-127.jpg`

Desktop:
- `before-desktop-127.jpg`, `after-desktop-127.jpg`

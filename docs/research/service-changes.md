# Service changes: sources, structure and presentation (underground-08r)

_Researched 2026-11-23 (one alerts sample, 18:44 UTC, Monday afternoon; one live /rt-equivalent pull of all 8 trip feeds; the
deployed dated timetables for 11-23, 11-24, 11-26; both GTFS zips as of 13:24 ET). The raw samples and analysis
scripts were kept out of the repo (MTA data; re-fetch to reproduce)._

## TL;DR
1. **The alerts feed is the only source that names skips reliably, and it is mostly machine-readable.** 206 alerts; 187 (91%)
   carry `stop_id`s in `informed_entity`, every one a parent id in our `stations.json` (0 unknown). 147 (71%) are of the four
   drawable types (Stops Skipped 84, Part Suspended 37, Express to Local 20, Suspended 6). The stop lists are *not* exactly
   "the skipped stops": they often add the stretch's end stations (or a far alternative), so the exact set needs the header text.
   A naive header parser matched every named station to an informed stop in 76 of 84 Stops Skipped alerts (90%).
2. **The supplemented GTFS misses most stop skips.** Of 22 Stops Skipped alert-days inside the dated window, the dated files
   changed the stop list for 4 (N, J, F, and the 7 in the *opposite* direction: it adds 52 St back while the alert and live
   trains skip it). All 3 suspensions were encoded; 0 of 2 Express to Local. Confirmed on the raw zip: all 12 Manhattan-bound R
   trips before 05:00 on 11-24 call 25 St, which the alert says they skip.
3. **Live TripUpdates can't say "skipping X".** No `SKIPPED` stop relationship and no ADDED/CANCELED trips in 734 trips;
   predicted stop lists follow the schedule (downtown 1 trains list 125 St, Woodlawn-bound 4 trains list Burnside Av, both
   "skipped" per active alerts). Live can only confirm a skip the schedule already has (the 7 at 52/69 St).
4. **Terms:** same MTA developer terms (they cover "MTA's data feeds" generally): serve from our own server (a Worker `/alerts`,
   a new external API the user must approve), "may not be real time", don't imply accuracy, and clause 5 "You will not modify or
   delete any of the data. You may, however, create an app that uses some but not all of the data." So show MTA's header text
   verbatim (brackets to route chips is presentation) and draw only what the structured fields plus header say.

## 1. Sources

### 1a. GTFS-RT subway alerts (camsys)
`https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts` (protobuf, 475 KB) and `...subway-alerts.json`
(1.0 MB, `application/json`, ACAO `*`). FULL_DATASET, `mercury_version` 1.0. Spec: MTA "GTFS Alerts Feed Documentation"
(Dec 2021, https://www.mta.info/document/90881) and nymta `feeds/subway/gtfs-rt/stations_affected.md`.

Structure (counts over 206 entities):
- `id`: `lmm:planned_work:<n>` (202) or `lmm:alert:<n>:<v>` (4, unplanned). "When an alert has multiple impacts, each impact will be
  displayed as a separate entity" (doc p.3), so one notice can be several entities.
- `active_period[]`: every alert; median 2 periods, max 231 (recurring nights). The *ends* matter: "show now" = any period
  containing now. First start ranges from 266 days ago (long-term) to 26 days ahead.
- `informed_entity[]`: `agency_id` MTASBWY, `route_id` always, `stop_id` (parent, no N/S) on 1,829 of 1,886, `direction_id` on
  1,161: **0 = northbound, 1 = southbound** (stations_affected.md; matches "Coney Island-bound" = 1 in the F reroute); absent = both
  directions. `trip` never used. `mercury_entity_selector.sort_order` = `MTASBWY:<route>:<priority>` (priority enum, e.g. 17
  PLANNED_STATIONS_SKIPPED, 25 PLANNED_PART_SUSPENDED; see pkg.go.dev/github.com/cedarbaum/gtfs/proto).
- `header_text` / `description_text`: `en` (route bullets as `[A]`, icons as `[shuttle bus icon]`, `[accessibility icon]`) and
  `en-html`. Headers capped at 160 chars.
- `mercury_alert`: `alert_type` (free text per the doc: "consumers should treat this as a free text field"), `created_at`,
  `updated_at`, `display_before_active` (3600 on 191, 0 on 13), `human_readable_active_period` (202, e.g. "Nov 23 - 25, Mon to Wed,
  11:45 PM to 5:00 AM"), `station_alternative[]` (23 alerts, 115 rows: stop + note such as "[shuttle bus icon] Lenox Ave at 135 St"),
  `affected_stations[]` (126 alerts, planned only). **`affected_stations` are the stations *upstream* of the change, where boarding
  riders are affected** (for the A skipping 81 St: southbound 125 St..86 St and northbound 34 St..72 St), not the skipped ones;
  don't draw them as skipped. `clone_id`, `service_plan_number`, `screens_summary` absent in this sample.

Alert types now: Planned - Stops Skipped 84, Planned - Part Suspended 37, Planned - Express to Local 20, Reduced Service 17,
Boarding Change 16, Planned - Reroute 7, Planned - Suspended 6, Delays 4, Station Notice 4, Extra Service 4, No Scheduled Service 3,
Saturday/Sunday Schedule 2, Planned - Extra Transfer 1, Expect Delays 1. Active at the sample time: 10 (4 Delays, 3 Stops Skipped,
2 Station Notice, 1 Boarding Change); 29 within 24 h. Weeknights and weekends will carry many more (UNVERIFIED: one sample only).

What each type's stop list means (from the samples):
| Type | informed stops | Drawable as |
|---|---|---|
| Stops Skipped | the skipped stations, often plus the two ends of the stretch (R 35972: 36 St..Atlantic Av for 25 St..Union St), sometimes a far alternative (1 35124: 168 St, 125 St, 116 St) or a station that is only a boarding change (7 31498: 61 St-Woodside) | skipped set = header-named stations ∩ informed (90% parse); fallback: informed minus ends, marked "probably" |
| Part Suspended | the suspended stretch *including* both ends, which stay served (N 36548: Queensboro Plaza..Times Sq) | segment between first and last informed stop on the route's drawn line |
| Express to Local | the whole stretch, including stops already served (D 36538: Grand St..116 St) | added stops = informed minus the route's normal stops (our timetable) |
| Suspended | the route's stops | whole route |
| Reroute | one or two stations only (Q 36553: Canal St) | the path is in text only ("runs via the [R] between Canal St and DeKalb Av") |
| Delays (unplanned) | route only | route badge; MTA says station metadata is "not yet" populated for unplanned changes |
| Reduced Service, Boarding Change, Station Notice, schedules | route, sometimes all stops | badge / panel line only |

Examples (trimmed; full in `examples.json`):
- `lmm:planned_work:36685` Stops Skipped: "In Manhattan, [A] local skips 81 St-Museum of Natural History in both directions due to
  the Thanksgiving Day Parade"; informed `[A, A21, both]`; 11 affected_stations upstream; "Nov 26, Thursday, 4:00 AM to 7:45 AM".
- `35972` Stops Skipped: "In Brooklyn, Manhattan-bound [R] skips 25 St, Prospect Av, 4 Av-9 St and Union St"; informed R36..R31,
  direction 0 (ends 36 St and Atlantic Av included); periods 11-23 23:45 to 11-24 05:00 and the next night.
- `36548` Part Suspended: "No [N] between Queensboro Plaza, Queens and Times Sq-42 St, Manhattan"; informed R09, R11, R13, R14,
  R15, R16, both directions.
- `36541` Part Suspended with alternatives: "In Brooklyn, no [Q] between Brighton Beach and Coney Island-Stillwell Av"; 4
  station_alternative rows with shuttle-bus stops.
- `36538` Express to Local: "uptown [D] runs local from 59 St-Columbus Circle to 125 St"; informed 15 stops D22..A16 direction 0,
  of which 72 St..116 St are the added ones.
- `36553` Reroute: "[Q] runs via the [R] in both directions between Canal St and DeKalb Av"; informed only Q01, R23.
- `lmm:alert:277632:26` Delays: route R only, no stops, no human period.

### 1b. Supplemented GTFS / dated timetables
`scripts/lib/datedTimetable.ts:79` picks dates whose trip *sets* differ; a client or build step could diff each route and
direction's stop shares (dated vs the regular service file) cheaply: a 50-line pure pass per date over files the trip planner
already fetches (820 KB raw for 11-23; well under a second in Python here). But the content is wrong for this purpose:
- Encoded: part suspensions and suspensions (N 49 St 0/27 trips on 11-24 vs 13/13; D at Norwood; overnight 5), a few skips
  (Jamaica-bound F at 75 Av/Briarwood 13/45 vs 45/45; Manhattan-bound J; Manhattan-bound N local).
- Not encoded: 17 of 22 Stops Skipped alert-days (6 local skips tonight, R/D at 25 St, Q at Avenue M, the parade skips on 11-26,
  1 at 125 St, 4 at Burnside), and both Express to Local checks. Script: `scripts/encoded.py`; raw-zip check above.
- Contradicts the alert once (7 northbound at 52 St: regular 0/195, dated 181/195, live trains skip it).
- Our pipeline doesn't read `pickup_type`/`drop_off_type`; neither zip has those columns, so no skip is hidden there.
Verdict: useful as a cross-check and for the trip planner (already used), not as the service-change source. The dated files are
built at deploy (daily 09:23 UTC), so they can lag a same-day alert edit.

### 1c. Live TripUpdates (`/rt`)
- `worker/proto/subway-rt.proto` drops `schedule_relationship`; decoding with it (`scripts/rt.cjs`) found no SKIPPED/NO_DATA stops
  and no ADDED/CANCELED trips in 734 trips (protobufjs defaults make unset and 0 indistinguishable; either way nothing else).
- Predicted stop lists follow the schedule: 8 of 8 downtown 1 trains spanning 125 St list it; 11 of 11 Woodlawn-bound 4 trains list
  Burnside Av; 13 of 13 Flushing-bound 7 trains omit 52 St (as the regular schedule does). So "skipping X live" is detectable only
  where the schedule already has it, and the MTA's own trip feed contradicts two active skip alerts (whether trains really stop
  there is UNVERIFIED; the alert is the MTA's customer-facing statement).
- Feed-only routes and reroutes (`joinTrip.ts:121`, `ROUTE_FEED`) show trains on other lines' shapes; that can confirm a reroute is
  running (e.g. Q trains joined to R shapes) but not describe it. UNVERIFIED on a night with a reroute active.

### Terms
MTA developer terms (https://www.mta.info/developers/terms-and-conditions) speak of "MTA's data feeds" generally; nothing
singles out alerts, and data-sources.md §5 already treats every feed alike. Clauses that matter: 1 (no serving from MTA servers:
a Worker `/alerts` route, a new external API the user must approve), 2 ("may not be real time"), 4 (not "inaccurate,
misleading"), 5 (no modifying or deleting data; using some of it is fine). Implications: show `header_text` verbatim (maybe the
description behind a disclosure); our drawing is derived and must be labelled as such where it guesses (the "informed minus ends"
fallback); no licence beyond the MTA credit (the `[shuttle bus icon]` tokens are text, not MTA marks). The Worker would trim the
1 MB JSON (or decode the 475 KB pb with an extended proto) to active and next-24 h alerts with route, type, stops, direction,
periods and the en header: estimated 10-30 KB gzipped (UNVERIFIED), cached 60-120 s like `/ene`.

## 2. Presentation (Blueprint only)
**Corner indicator and list.** (a) A header chip beside LiveStatus, "3 service changes", opening a list panel in the bottom slot
(same `frontPanel()` order as the trip panel); (b) route chips with a small mark on each affected line in the header; (c) only a
line in the station panel, no global indicator. Recommend (a): one button, a polite count, rows = route chips + MTA header text +
"Now" / "Tonight 11:45 PM"; filters to "now" and "next 24 h" only. The count is never spoken on polls (as `outageAnnounce.ts`).

**Route view on pick.** Reuse the trip emphasis (`tripEmphasis.ts`, `lineDim.ts`: dim the network, keep the picked route at full
color on its band lines), then: (a) skipped stations as hollow markers with a short cross stroke, suspended segment drawn dashed
in the route color at reduced contrast (like `TripDashes.tsx`), alternative stops as small `exitPath`-style marks; (b) only
recolor affected stations with `statusError`; (c) no map change, list only. Recommend (a): shape not color (cross, dash), the
camera frames the affected stretch (the trip route's `useRouteFlight`), and a reroute (text-only path) shows only its named
stations plus the header. Express to local: the added stops as filled marks with a ring. Directions matter: a one-direction change
marks only that direction's track (each shape is already its own offset track, `TRACK_OFFSET_M`).

**Station panel.** A line under `InteriorStatus`/`OutageStatus`, same pattern as the outage disclosure: "Service changes (2)" closed
disclosure, rows "[A] skips this station · until 7:45 AM" (derived, our words) over the MTA header; spoken once in the panel's
heading text when the station itself is skipped ("Downtown 1 trains skip this station now"). Recommend this over always-open rows.

**Train panel next stops.** Strike through a stop an active alert says this train's route and direction skips, with sr text
"skips 125 St" (never strike-through alone); drop its ETA. Since live predictions still list such stops, the strike-through is
the alert's claim over the feed's; label "per MTA notice". **Arrivals rows**: a row for a route that skips this station gets a dim
"skips this station" note (and the row stays, since the feed predicts it), or the route chip in `LineFilter` gets an
`aria-description`.

## 3. First slice and order
1. Worker `/alerts` (after the user approves the new API): trimmed JSON, active + next 24 h, 120 s cache; client `useAlerts` beside
   `useEne`; pure `alertJoin.ts` (route, direction, informed stops, header-parsed skipped set, suspended segment). Station panel
   line only, for the focused station (skipped / suspended here / boarding change). Smallest visible value, mirrors OutageStatus.
2. Header indicator and list panel (verbatim headers, "Now" and "Later today").
3. Route view on pick: dim plus skipped markers and dashed suspended segment.
4. Train panel strike-through and arrivals notes.
5. Express to local (needs the normal-pattern diff) and reroutes (text parse of "via the [X] between A and B"), last.

## Gaps / UNVERIFIED
- One alerts sample on a Monday afternoon; no second sample to measure churn or `clone_id` use.
- Whether trains really pass 125 St (1) and Burnside Av (4) without stopping while live predictions list them.
- Trimmed `/alerts` size; the pb's fields beyond the JSON (not decoded with a Mercury proto, which the MTA doesn't publish).
- Reroute detection from live joins.

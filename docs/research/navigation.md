# Navigation

Research for epic underground-2q7 (2026-11-21). Three parallel investigations: trip planning on the
subway, paths through a station, and address search plus walking. Anything marked UNVERIFIED was not
checked against a primary source. Built since: see the tickets named in each section.

## Recommendation

Door-to-door navigation can mostly run on the device; the one external API is address and place search, through our Worker:

1. **Trip planning:** our own RAPTOR over an exact per-service timetable, loaded on demand, with live
   TripUpdates replacing the schedule for the next 30 minutes.
2. **In-station paths:** "which exit / which end" at every station with an interior (marked "probably"
   on generated ones), and full transfer routes only where a station is hand-authored, Union Sq first.
3. **Walking and search:** per-station OSM walk graphs (shared with the street layer, epic
   underground-ost) with a small A* router; search over stations and streets on the device, and
   addresses and places through our Worker (NYC GeoSearch, Photon as the fallback; decided 2026-11-22, 2q7.33).

Three things needed the user's decision (cards on underground-2q7): a geocoding API for places
our data lacks (decided: first own data only, then on 2026-11-22 GeoSearch and Photon through the Worker), how to get Union Sq's real layout, and whether to add the supplemented GTFS feed for
planned service changes (decided: yes, as dated timetable files; 2q7.7).

## 1. Trip planning

**Algorithm.** RAPTOR, about 200 lines, pure, in `src/lib/route/`. It gives Pareto results on arrival
time and transfer count. A Node prototype over the weekday timetable (496 stations, 207 patterns, 8,498
trips; no pattern has overtaking) answers a one-to-all query in 0.28 ms on a Mac; on a phone, 1-3 ms per
query and 20-100 ms for a 60-minute range query (UNVERIFIED, extrapolated). CSA over the same data
is about as fast and is a fine substitute.

**Data.** Measured from the regular GTFS (fall 2026: 20,310 trips, 562,943 stop_times, every time a
multiple of 30 s), gzip -9:

| Encoding | Weekday | Saturday | Sunday |
|---|---|---|---|
| JSON rows: origin delta, per-stop run times in 30 s units, sparse dwell | 31.7 KB | 9.5 KB | 9.4 KB |
| Binary streams (origins, runs, dwell) | ~21 KB | ~6 KB | ~6 KB |
| Runs and dwell only, keyed to trip-index order | ~15.5 KB | ~4.3 KB | ~4.3 KB |

One service file loads per query day (plus yesterday's before about 03:00, for times past 24:00),
outside the 60 KB startup budget with its own cap, like interiors. (The shipped weekday file is
39,662 B (node zlib level 9) because it also carries each pattern's stop list and the file's indentation, which the 31.7 KB
figure left out.) Store each trip's first departure
explicitly: 240 trips' trip-id origin differs from it by more than 30 s.

**Not good enough:** the already-loaded `trip-index` origins plus `segments.json` medians (p90 4 min
at a stop, 7.5 min at the terminal; too loose for timed transfers), and a headway approximation (can't
say "leave at 08:12").

**Libraries.** None fit. minotor (MIT) runs in the browser but brings its own protobuf timetable and
dependencies and has no realtime; planarnetwork's RAPTOR and CSA are GPL-3.0; OpenTripPlanner and r5
are Java servers. A hosted fallback (Transitous/MOTIS) is free only for non-commercial FOSS, best
effort, and would send trip endpoints to a third party; not recommended.

**Transfers.** `transfers.txt` has 613 rows, all type 2. `buildTransfers` drops the 463 same-station rows
(`scripts/lib/network.ts:64-73`): 400 at 180 s, 57 at 0 s (cross-platform), 6 at 300 s. The router needs
them (about 0.5 KB). The 150 between-station rows are kept, including the out-of-system pairs (59
St-Lexington Av/63 St, Junius St-Livonia Av, 300 s). A complex is several parent stations (Times Sq is
127/725/902/R16/A27); seed all of them. Walking between unlinked stations (a new fare) isn't modelled.

**Realtime.** The NYCT feed replaces scheduled trips within its 30-minute replacement period, and a
scheduled trip missing from it counts as cancelled (nyct-subway.proto). For each feed that isn't stale:
drop scheduled trips starting in [now, now + 30 min], add realtime trips with predicted times (joined by
`joinTrip`), extend past the last prediction with scheduled run times, and build a one-off pattern for a
reroute. Read the raw snapshot, not `prepareTrips` (its ghost filter drops unassigned trips, which are
real departures). The Worker drops `trip_replacement_period` and schedule_relationship
(`worker/proto/subway-rt.proto:9-34`) and arrivals past 30 min (`worker/src/schema.ts:4-5`). A stale or
erroring feed falls back to the schedule, so gaps aren't invented.

**Planned service changes** (weekend work) are only in the supplemented feed (19.5 MB, hourly, 7 days). Each Pages deploy
reads it (`npm run data:dated`) into the dated timetable files (`timetable/dated/`, one per date planned work changes, never committed;
a failed build ships an empty index), and the planner
uses a date's file when the manifest lists it and the per-service files otherwise (2q7.7). The UI doesn't say yet
that a trip follows planned work ("planned work through <date>" is a follow-up).

**MVP:** timetable files plus same-station change times in `npm run data`; pure RAPTOR with tests on
`src/lib/realtime/fixture.ts`; station to station, departing now, schedule only, labelled scheduled;
then the realtime overlay.

## 2. Paths through a station

The `StationInterior` schema routes as a graph (nodes: entrances, slabs, platforms; edges: connectors).
Over all 254 interiors:

| Class | Count | What a route can honestly say |
|---|---|---|
| Hand-authored (L08) | 1 | Full route, step-free through EL358/EL359; stair positions are UNVERIFIED and there are no fare lines |
| Generated cut-and-cover and elevated | 187 | Which end or entrance is nearer, "probably the X St end". Every entrance reaches every track in 186 by construction (`scripts/lib/templates/stairs.ts:140-160`) |
| Generated shallow, per-direction entrances | 66 | "This entrance is uptown only" (inferred from street side, `scripts/lib/archetype.ts:55-59`); never claim "no crossover" |
| Complexes, deep, unclassified | 242 | Nothing: 85 of the 87 complex stations have no interior, including all of Union Sq, Times Sq and Atlantic Av |

Step-free routing can't rest on generated geometry: in 13 generated stations the elevator-only graph
misses a track, 9 of them ADA "full".

**Schema gaps** (`src/data/stationSchema.ts`):
- `Endpoint` (88-92) has only a level; add `area` (slab or platform id). 15 endpoints sit just outside every outline.
- No paid/unpaid: `FareLine` (125-130) is geometry only and empty in every file. Add `paid` on `Slab` (80-86) and fare and exit-only gates as edges.
- No passages: `ConnectorKind` (24) has no `walkway`, and an elevator has only two stops.
- A transfer can't span files: `StationInterior.stationId` (33) is one station. A complex needs one file with `memberStationIds`.
- `Entrance` (110-124) has no corner or street label (the street layer can supply it).
- Car position ("board near the front"): no open dataset found (UNVERIFIED); derive it from where stairs land along `Track.path`, only where stair positions are real.

**Union Sq.** The user's L-to-N/Q/R/W staircase exists. OSM has 37 `highway=steps` ways with levels, two
of them `level=-3;-2` (ways 509025053, 509025055: the likely L-to-Broadway stairs, geometry UNVERIFIED),
some carrying MTA stair numbers, plus elevators, but no mezzanine or corridor areas. The 2021 draft
pathways feed (evaluation only, its terms forbid public use) shows direct stairs from both Broadway
platforms to the L and the step-free route (EL217, mezzanine C, fare gate, walkway, EL218). The
mezzanines' positions are in no open source, so a full model needs a site visit or an OSM-only partial
(card). Of the 35 complexes, the draft covers 32 (not Grand Central); only 12 have direct
platform-to-platform stairs; Times Sq has 0, so every transfer there goes through passages.

**Transfers (2q7.19).** Built over the same graph in transfer mode (`src/lib/interiorTransfer.ts`):
- The router's change time stays transfers.json's (180 s at L03, R20 and 635). Plans run before interiors load and must
  not reorder when one arrives; only two interiors are hand-authored; and the graph omits the platform walk to the car,
  so its times understate (the direct L to N stair is about 50 s, the step-free way about 190 s). A possible follow-up:
  graph-derived footpaths for authored complexes.
- A transfer never touches the street or stands in a slab with `paid: false`: leaving fare control means a new fare, and no
  fare line opens an unpaid area to it (`FareLine` stays geometry only). Exits are unchanged and may cross unpaid areas.
  Platforms are paid; a slab with no `paid` (all of Union Sq's) is assumed inside, so the transfer is "probably".
- Only changes whose two stops are in one hand-authored interior get a path (Union Sq; L08 has none). Generated or missing
  interiors keep the bare "Change at" row; a change across one platform says "Across the platform" and draws nothing.

**Accessibility and outages.** The MTA E&E outage feed (`nyct_ene.json`, 60 KB, 147 rows) and equipment
list (`nyct_ene_equipments.json`, 644 KB: `serving`, ADA, a written `alternativeroute`) are MTA feeds,
so they go through the Worker (already planned, `docs/research/data-sources.md:210`). `Connector.id`
already holds the equipment code, so outages join directly. `alternativeroute` can run to several
paragraphs; the panel needs a truncation design.

**v1:** "which exit" at any interior station (highlight entrance, stair, slab, platform stair,
platform end; dashed and "probably" on generated ones, no car numbers); accessibility from station ADA,
the E&E `serving` text and live outages; transfers only where hand-authored, Union Sq first, then
Atlantic Av, Times Sq last.

## 3. Search and walking

**Google is ruled out.** Maps Platform terms 3.2.3(e) forbid showing Places or Routes content on a
non-Google map, and our scene is one.

| Option | Cost | Terms | What leaves the device | Effort |
|---|---|---|---|---|
| On-device addresses: NYC AddressPoint `uf93-f8nk` (967,871) + CommonPlace `t95h-5fsr` (20,447 landmarks) | $0 | NYC Open Data | A hash-bucket shard request to GitHub Pages | M (not built: superseded, 2q7.15) |
| On-device walk graph: OSM `highway=*`, sidewalks included | $0 | ODbL (already shipped) | Nothing beyond a station-keyed shard request | M |
| NYC GeoSearch (Pelias on PAD) | Free, no key, CORS `*` | No published terms or limits found (UNVERIFIED) | Typed text, to NYC Planning | S |
| Photon (komoot) | Free | Throttled when heavy; no guarantee | Typed text | S |
| Nominatim | Free | Autocomplete prohibited; 1 req/s | Typed text | S |
| Stadia (Pelias + Valhalla) | Free tier | Free tier non-commercial | Text and origin | S |
| GraphHopper, OSRM demo | Free | Non-commercial; demo not for production | Text and origin | not viable |
| Mapbox | 100k free/mo, then paid | Temporary results not storable; reported "Mapbox map only" (UNVERIFIED) | Text and origin | S |
| Google Places/Routes | 10k free/mo, then paid | Incompatible (above) | Text and origin | no |

Tested 2026-11-21: GeoSearch found "120 Broadway", the Empire State Building and Barclays Center but not
Katz's Deli or "Bedford Av & N 7 St"; Photon found Katz's. Any of these can go through our Worker, which
hides the user's IP and can cache popular queries; the query text still leaves the device.

**Walk graph sizes** (OSM ways within 800 m, graph only, gzipped): Bedford Av 3,693 nodes, 5,387 edges,
44.6 KB; Times Sq 3,104 nodes, 4,553 edges, 38.3 KB. Footways are 83% and 69% of the ways, so OSM
beats LION (one centerline per street). Citywide, the 800 m circles cover 358 km² once merged; about
5-7 MB in total (UNVERIFIED), but a user fetches one shard per station. A binary-heap A* is about 100
lines and should take milliseconds on 4k nodes (not benchmarked).

**Street and intersection index (built, 2q7.13; shipped in the Worker, 2q7.14):** `npm run data:search:streets` files 3,222 street
records (a street per borough, a site per nearby station) and 11,512 intersections from the street pin, within 300 m of a station,
into one JSON module, `worker/data/streetIndex.json`: 689 KB raw, 181 KB gzipped (it first shipped as 64 hash-bucket shards fetched by
the client, 523 KB gzipped in all; moving it into the Worker kept the typed text off the static host, below). The Worker's bundle
goes from 182 KiB (35 KiB gzipped) to 981 KiB (226 KiB gzipped), against a 64 MiB limit. The index is a dynamic import, loaded on the first
`/geocode` miss of an isolate, so `wrangler check startup` (local, warm runs) still reads 15 to 16 ms of active startup, as before (a static
import cost 22 to 27 ms); the JSON parse is about 3 ms and `loadStreetIndex` about 6 ms cold in node, once, and the index holds roughly 3.5 MB of heap. A name is filed under the
first two characters of each distinctive token (not st, av, a compass letter and the like), spelled as published, canonical and as a long form, so
a query finds it from any prefix of 2+ characters of that token (a query like "w 4" reads only the "4" key); a key lists at most 108 of the
3,222 streets, so a query scores about 5 to 108 candidates (under 0.5 ms), never all. An intersection query is split at the first
"&", "/", "@", "+" or the words "and" / "at"; each side is scored, the pairs joined through each street's crossings. The borough is
the nearest station's, wrong on a few land-border streets.

**Address index (not built):** Manhattan (63,245 points, 872 streets) is 264 KB gzipped at 1 m; citywide about 4 MB
(UNVERIFIED), in hash-bucket shards. Dropped on 2026-11-22 (2q7.15 closed as superseded) for the Worker's `/geocode`.

**Address and place search (decided 2026-11-22, 2q7.33 and 2q7.16):** the Worker's `GET /geocode?q=&focus=lat,lon` calls
the bundled street index first (streets and intersections, local), then NYC GeoSearch (Pelias on PAD, autocomplete) and, when neither has
a place-like hit or the query reads like a business name, Photon bounded to the NYC bbox; an intersection hit calls neither. Their
`street` rows are dropped, the index's replace them. It merges and dedupes them, trims each to `{label, kind, lat, lon, source}`, at most 8,
drops anything outside the bbox, returns the attribution with the results (NYC Planning; © OpenStreetMap contributors, for Photon rows and the street index), caches
by normalized query for 1 h, rate-limits Photon per isolate and each client (Cloudflare's Workers Rate Limiting binding keyed on
`CF-Connecting-IP`, 30 per 60 s, checked before the cache; the address is never logged or stored; 2q7.36), logs no query text, and answers only the site's origins. The client
never calls either service directly. The station search dialog queries it after stations (3+
characters, about 250 ms debounce, stale requests aborted) and says so in one line: "Addresses and places are looked up through
our server; your location is never sent." `focus` is the map center or the chosen station, never the location fix.

Built in 2q7.33 (`worker/src/serveGeocode.ts`; the client is 2q7.16): `/geocode` refuses a request with no allowed Origin (403), rounds `focus` to 2
decimals and drops it outside the NYC bbox, skips Photon for a house-number query GeoSearch answered with an address, drops Photon's
transit rows and rows outside New York state, keeps upstream casing in labels (the client decides display), answers `Cache-Control: no-store` always
(the 1 h cache is server-side, so no typed query lands in a device's disk cache) with no `x-rt-cache` header, backs a source off
only when it looks to be struggling (timeout, network failure, 429, 5xx), and keeps every query out of its logs (Workers Logs
invocation logs are off, query strings redacted, traces off; `wrangler tail` may still show full URLs to whoever tails production).

**Privacy.**
- `/geocode` answers carry no cache-state header, but response timing still hints whether a query was recently searched in
  that isolate (a memory hit is faster than an upstream call).
- Static shards still reveal a little to GitHub Pages: walk shards are keyed by the station the user
  picked or focused, never by the fix. Street and intersection search is not a static shard any more: fetching the
  index in hash buckets would have shown the Pages log the first two letters of the word typed (measured on the old shards: 247 of
  the 283 two-character keys were pinned exactly), so the index lives in the Worker and nothing about a typed street reaches the
  static host (2q7.14, privacy card underground-2q7.14.1). No page URL ever holds
  the text typed. Address, place and street search does send it (3+ characters) to our Worker. An intersection the street index finds goes
  to neither upstream; a street the index finds still goes to NYC Planning's GeoSearch (not to Photon); anything else goes to GeoSearch and,
  for places, komoot's Photon, and a business-looking name asks both. All from the Worker's address, not the user's. Routing runs on
  the fix in memory, so the rule that no request carries the location holds.
- Any hosted routing API needs the origin, which breaks that rule; it would need the user to change it,
  plus consent on every request. Not recommended.
- The geocoding route sends typed text with a standing disclosure in the search dialog rather than a per-search
  opt-in (the user's call, 2026-11-22), biased by the map center or chosen station, never the fix, never logged by the Worker.

**v1:** extend `stationSearch.ts` to streets and intersections (from the street index), then addresses and
places from the Worker's `/geocode`; per-station walk shards (with topology and junction ids kept, shared with
underground-ost) and A* to each entrance to pick the best exit; beyond 800 m, a straight-line
"~N min walk" estimate.

## Risks

- Phone timings for RAPTOR and A* are extrapolated; measure on a device.
- Dropping trips as cancelled on a stale feed could invent gaps; fall back to the schedule per feed.
- Generated interiors make routes look more certain than they are; keep the "probably" wording and dashes.
- The walk-graph total is an extrapolation; the per-shard sizes are measured.
- GeoSearch publishes no terms or limits (UNVERIFIED) and Photon is best-effort with fair-use throttling; either can
  vanish or slow down, so station search never waits on them, an intersection is answered from the bundled index alone, and a
  street (which still waits on GeoSearch for its places) survives a failed upstream as an incomplete 200, not an error.
- The draft pathways feed may only guide a survey, never be a source.

## Sources

- [nyct-subway.proto](https://api.mta.info/nyct-subway.proto.txt); [MTA fares](https://www.mta.info/fares-and-tolls/subway-bus-and-staten-island-railway)
- [minotor](https://www.npmjs.com/package/minotor); [connection-scan-algorithm](https://www.npmjs.com/package/connection-scan-algorithm); [Transitous API](https://transitous.org/api/)
- [Draft GTFS-Pathways post](https://groups.google.com/g/mtadeveloperresources/c/j-vVGirkKkc) (evaluation only)
- [MTA E&E developer page](https://www.mta.info/developers/display-elevators-NYCT); [Overpass](https://overpass-api.de) (ODbL); [Wikipedia, 14th Street–Union Square](https://en.wikipedia.org/wiki/14th_Street–Union_Square_station) (CC BY-SA, facts only)
- [NYC GeoSearch](https://geosearch.planninglabs.nyc/docs/); [Photon](https://photon.komoot.io/); [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/); [Stadia pricing](https://stadiamaps.com/pricing/); [Google Maps Platform terms](https://cloud.google.com/maps-platform/terms)
- NYC Open Data: AddressPoint `uf93-f8nk`, CommonPlace `t95h-5fsr`

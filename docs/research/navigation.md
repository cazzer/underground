# Navigation

Research for epic underground-2q7 (2026-11-21). Three parallel investigations: trip planning on the
subway, paths through a station, and address search plus walking. Anything marked UNVERIFIED was not
checked against a primary source. Nothing here is built yet.

## Recommendation

Door-to-door navigation can mostly run on the device with no new external API:

1. **Trip planning:** our own RAPTOR over an exact per-service timetable, loaded on demand, with live
   TripUpdates replacing the schedule for the next 30 minutes.
2. **In-station paths:** "which exit / which end" at every station with an interior (marked "probably"
   on generated ones), and full transfer routes only where a station is hand-authored, Union Sq first.
3. **Walking and search:** per-station OSM walk graphs (shared with the street layer, epic
   underground-ost) with a small A* router, and search over stations, streets, addresses and landmarks
   from lazy shards of NYC Open Data.

Three things need the user's decision (cards on underground-2q7): an optional geocoding API for places
our data lacks, how to get Union Sq's real layout, and whether to add the supplemented GTFS feed for
planned service changes.

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

**Planned service changes** (weekend work) are only in the supplemented feed (19.5 MB, hourly, 7 days);
we build from the regular zip. Adding it is a data-pipeline change (card).

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
| On-device addresses: NYC AddressPoint `uf93-f8nk` (967,871) + CommonPlace `t95h-5fsr` (20,447 landmarks) | $0 | NYC Open Data | A hash-bucket shard request to GitHub Pages | M |
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

**Address index:** Manhattan (63,245 points, 872 streets) is 264 KB gzipped at 1 m; citywide about 4 MB
(UNVERIFIED), in hash-bucket shards.

**Privacy.**
- Static shards still reveal a little to GitHub Pages: walk shards are keyed by the station the user
  picked or focused, never by the fix; address shards by hash bucket, not street name. Routing runs on
  the fix in memory, so the rule that no request carries the location holds.
- Any hosted routing API needs the origin, which breaks that rule; it would need the user to change it,
  plus consent on every request. Not recommended.
- A geocoding API sends typed text only after an explicit opt-in ("Search beyond our data: your text
  is sent to NYC Planning via our server"), biased by the map center or chosen station, never the fix,
  never logged by the Worker, and listed in an about/privacy line.

**v1:** extend `stationSearch.ts` to streets and intersections (from the street layer), addresses and
landmarks (lazy shards); per-station walk shards (with topology and junction ids kept, shared with
underground-ost) and A* to each entrance to pick the best exit; beyond 800 m, a straight-line
"~N min walk" estimate.

## Risks

- Phone timings for RAPTOR and A* are extrapolated; measure on a device.
- Dropping trips as cancelled on a stale feed could invent gaps; fall back to the schedule per feed.
- Generated interiors make routes look more certain than they are; keep the "probably" wording and dashes.
- The address and walk-graph totals are extrapolations; the per-shard sizes are measured.
- The draft pathways feed may only guide a survey, never be a source.

## Sources

- [nyct-subway.proto](https://api.mta.info/nyct-subway.proto.txt); [MTA fares](https://www.mta.info/fares-and-tolls/subway-bus-and-staten-island-railway)
- [minotor](https://www.npmjs.com/package/minotor); [connection-scan-algorithm](https://www.npmjs.com/package/connection-scan-algorithm); [Transitous API](https://transitous.org/api/)
- [Draft GTFS-Pathways post](https://groups.google.com/g/mtadeveloperresources/c/j-vVGirkKkc) (evaluation only)
- [MTA E&E developer page](https://www.mta.info/developers/display-elevators-NYCT); [Overpass](https://overpass-api.de) (ODbL); [Wikipedia, 14th Street–Union Square](https://en.wikipedia.org/wiki/14th_Street–Union_Square_station) (CC BY-SA, facts only)
- [NYC GeoSearch](https://geosearch.planninglabs.nyc/docs/); [Photon](https://photon.komoot.io/); [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/); [Stadia pricing](https://stadiamaps.com/pricing/); [Google Maps Platform terms](https://cloud.google.com/maps-platform/terms)
- NYC Open Data: AddressPoint `uf93-f8nk`, CommonPlace `t95h-5fsr`

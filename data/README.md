# Station inputs

Inputs to `npm run data:stations`, which writes `public/data/stations/<id>.json`. Nothing here
is shipped to the site.

An authored `{ "entrance": ... }` connector end, and an E&E machine's `entrance` override, go on whichever
end is at the street: the upper end below ground, the lower end at an elevated station (where the street,
y 0, is the lowest level). An escalator override may give `ends` (`{ "lower": [u, v], "upper": [u, v] }`, by elevation) instead of `at`
for a run of its own; with an `entrance`, its street end sits on the entrance point.

This project is not endorsed by the MTA. Data may not be real time and is not guaranteed to
be accurate.

## Files

- `stations/<id>.authored.json`: hand-authored levels, tracks, mezzanine slabs, stairs, entrance
  names, and position corrections. Geometry that no source confirms is marked `UNVERIFIED:` in
  its `notes`.
- `stations/<id>.sources.json`: pinned extracts of the public sources, written only by
  `npm run data:stations:fetch -- --station <id>`. Each section records its query or URL, when it
  was fetched, and the source's own update time or version. The build never touches the network.
- `stations/catalog/{stations,entrances,equipment,envelopes,osm-platforms,osm-tracks}.json`: citywide
  pinned extracts (all 496 stations, 2,120 entrance rows, 759 E&E machines, 475 NYCT station
  envelopes, and OSM platform and subway-track ways within 250 to 300 m of a station), written only
  by `npm run data:catalog:fetch`. Station, entrance and equipment rows share the keys `gtfsStopId`,
  `stationId` (the E&E station MRN without leading zeros) and `complexId`; envelopes and OSM ways
  carry no station key. `catalog/stations.json` is also read by `npm run data` (borough and ADA status
  for `public/data/stations.json`) together with `stations/access-exceptions.json`; after a catalog refresh, run `npm run data:access` (offline). `npm run data:stations` reads
  `stations.json`, `entrances.json`, `equipment.json`, `osm-platforms.json` and `osm-tracks.json` (with the
  committed `public/data/shapes.json` and `stations.json`) to generate interiors; `envelopes.json` is not used. The DOS Track LRS is not pinned (see `../docs/research/data-sources.md` §5.1).
  **E&E coordinates are unreliable:** the dataset's own overview says they are the station center
  when a machine's exact location is not known, and some are plainly wrong (25 machines are over 500 m
  from their station; EL100 is at Jay St, 15 km from 149 St-Hostos). Place machines from their `serving` text, not from `lat`/`lon`.

- `stations/layout-oracle.json`: 62 stations (and 13 complexes or multi-level ones the classifier should
  decline) with their platform type, platform and track counts and whether a mezzanine exists, each with
  the English Wikipedia article title and revision id it was read from. The tuning set for
  `scripts/score-archetypes.ts`, which scores the archetype classifier. The header's `mezzanineRule` says what
  true, false and null mean. The facts were checked by an agent against the articles, not by a person.
  Facts only: no article text is copied.
- `stations/layout-holdout.json`: 30 more stations, drawn by a fixed rule from the catalog rows the oracle does
  not use and checked by a second agent. Never tune on it: run
  `node scripts/score-archetypes.ts <feedDir> --oracle data/stations/layout-holdout.json` against frozen code.
  Entries flagged `complex` or `multiLevel` are expected to stay below the confidence bar. It was first
  scored on 2026-11-21 with frozen code (precision at the bar 19/19), then once more after a review fix motivated
  by tuning-set knowledge that also restored 726 and F14 (21/21). Any later change motivated by one of its
  stations counts as tuning on it.

## Refreshing

1. `npm run data:stations:fetch -- --station L08` (needs network; Overpass can answer 502 when busy,
   so retry after a minute).
2. Review the diff of `stations/L08.sources.json`.
3. `npm run data:stations`. It fails if the sources gained a row the authored file doesn't map, or
   if a moved machine no longer lands inside a platform or slab. Fix the authored file, rerun.
4. Commit the sources, the authored file, and `public/data/stations/` together. A test fails if the
   committed output is stale.

## Citing OSM stairs and elevators

`fetch.osmLines` (open or closed OSM ways: stairs, an elevator's way) and `fetch.osmNodes` (a street elevator) pin
more OSM elements next to the platform `osmWays`. The fetch then asks for `(way(id:ways,lines);node(id:nodes););`
instead of the plain `way(id:...)` query, and `sources.json` gains `osm.lines` and `osm.nodes` (id, version,
timestamp, the tags `level`, `highway`, `incline`, `step_count`, and the geometry). A station that lists neither keeps
the plain query and its sources unchanged.

An authored connector or an `equipment` override may carry `osmRef` (`"way/N"` or `"node/N"`). The merge looks it up
among the pinned ways, lines and nodes, requires at least one authored `at` end (an entrance end does not count; for a
machine its `at`, or an escalator's `ends`) within 1 m of the element (a node's point; an open way's nearest vertex, since a stair's vertices are its landings; a closed way counts as its area), adds `osm` to
the connector's `sources` and writes `osmRef`. The client ignores it. An unknown ref, or an end too far, fails the build.

An E&E row can have no notes, so no serving text. It needs a `levels` override or the merge fails. With `levels`, a
serving text that is not "A to B" (two " to ", none) is accepted: the direction of an escalator is read from the text cut
at its first " for " if that leaves exactly one " to ", else it has none. Without `levels` the strict reading is unchanged.

## Station complexes

One authored file can cover a station complex (a transfer between several GTFS stations). Name the file after the
lowest-sorted member (`635.authored.json` for Union Sq; the catalog's complex id can collide with a GTFS station id) and
add these keys, all optional and all written to the output only when authored:

- `memberStationIds`: every member's GTFS station id, sorted, at least 2, `stationId` first. Track `stopId`s may belong to
  any member; `public/data/station-depths.json` gets one entry per member, and `index.json` maps each other member to the
  file (`{ provenance, file }`). A generated interior for any member is dropped ("hand-authored wins").
- `fetch.entrancesGtfsStopId` and `fetch.equipmentStationMrn` become arrays, one value per member. `data:stations:fetch` then
  asks with one `$where` filter (`in(...)` for equipment; a `like` per member for entrances, whose `gtfs_stop_id` can list
  several stops, "A12; D13", and the rows are then kept by exact stop), and drops exact duplicate entrance rows and
  identical repeated equipment codes (two equipment rows that disagree fail the fetch). Values are letters and digits only. `equipmentStationMrn` is
  the dataset's `station_mrn` as written, leading zeros kept (Broadway's R20 is `"015"`; the catalog's `stationId` drops them).
- `slabs[].paid`: `true` inside fare control; leave it out when not stated.
- A connector end's `area`: the id of the platform or slab it stands on (an `at` end only, on that end's level). The
  containment check then tests that area alone, within 0.5 m. Optional on stairs and ramps; never inferred.
- `kind: "walkway"` connectors join two areas on one non-street level: both ends `at` with an `area`, the two areas
  different, a plan run of at least 1 m. The lower-below-upper rule does not apply. They draw as two flat sides, dashed when both ends are approximate slabs or the interior is generated.

## Generated stations

`npm run data:stations` also generates an interior for every station the archetype classifier puts in a template
archetype (elevated 2 or 3 tracks, cut-and-cover under a mezzanine, shallow side platforms) at confidence 0.7 or
more, unless `stations/<id>.authored.json` exists (hand-authored wins). The generator builds the same inputs an
authored station has, in memory: an `AuthoredStation` (levels from the classifier's depths, platforms from the OSM
ways, N/S tracks matched to the map's direction lines, one mezzanine slab per cluster of entrances, stairs, and an
`at` for every elevator and escalator) and a `StationSources` slice of the catalog. Nothing of it is written to
`data/`. Source rows the merge can't take are left out of the slice and printed: E&E serving texts with more than
one " to ", machines joining two levels of one kind (mezzanine to mezzanine), elevator or escalator entrances with
no machine of their kind, duplicate entrance points, entrance rows over 200 m from every platform, and entrances
whose street stair would run more than 20 m (or finds no free landing within it). Stations listed in
`scripts/lib/deepArchetype.ts`, or with an E&E rise over 60 ft, are deep and get no generated interior; so do
multi-level stations (E&E rows naming an upper, lower or intermediate mezzanine, a concourse or balcony, or joining
two mezzanines), which need hand authoring. Every position the template places is a guess (the output carries
`generated` and per-level `depthSource`).

## Refreshing the catalog

1. `npm run data:catalog:fetch` (needs network; Overpass is often busy, and the script retries
   429, 502, 503, 504 and network errors after 30, 60 and 120 s, or the Retry-After). It writes
   nothing unless every request succeeds, each row count matches `count(*)`, every station has a
   platform and a track way nearby, no file is over 2 MB (the OSM data is split into
   `osm-platforms.json` and `osm-tracks.json` for headroom) and the total is under 5 MB.
2. Re-check the OPEN-NY Terms of Use and the datasets' overview PDFs for changes (links and quotes
   in `../docs/research/data-sources.md` §5.1).
3. Review the diff of `stations/catalog/`. The E&E file changes most often (new machines).
4. Run `npm run data:access` (offline, no GTFS download) so `public/data/stations.json` picks up
   borough and ADA changes (`stationAccess.test.ts` fails while it is stale). If it names a GTFS
   station with no catalog row, or a catalog row with no GTFS station, edit
   `stations/access-exceptions.json` (below).
5. Run `npm run data:stations` to regenerate the generated interiors (`generatedOutputs.test.ts` fails while they
   are stale) and review what it prints as skipped or dropped.
6. Commit. `catalogData.test.ts` checks the files against each other.

## Street pin

`streets/` holds the OSM streets and walking ways within 300 m of every station point of `public/data/stations.json`:
`manifest.json` (license, query, shard list with way and node counts, the stations feed version it was cut for) and
`cell-<lat>_<lon>.json` shards on a 0.02 x 0.025 degree grid (a way sits in the shard of its first vertex). Each shard
has its node table (`[id, lat, lon]`, sorted, 1e-6 degrees) and its ways (`id`, tags, node ids), one per line. Today:
132 shards, 96,808 ways, 25 MB (4.7 MB gzipped), largest shard 1.5 MB. Nothing ships from it; `npm run data:streets:fetch`
is the only writer and the only reader of the network (Overpass, by hand: one request, or eight latitude batches if
Overpass refuses it; the script retries as the catalog fetch does). It writes nothing unless every station has a named
way nearby, no shard passes 2 MB and the total stays under 30 MB (`-- --no-walk` keeps only the named roads, under 8 MB).
Review the diff, then commit; `scripts/lib/streetsData.test.ts` checks the files against each other and against
`stations.json` (a station added since the fetch fails it until the fetch is rerun, or the station is listed in
`UNCOVERED_STATIONS` in `scripts/lib/streetsOsm.ts` with a reason). The source choice is in
`../docs/research/data-sources.md` §5.2.

`npm run data:streets` (offline) turns the pin and `stations/catalog/entrances.json` into `public/data/streets/<id>.json`, one
per station. Rerun it after `data`, `data:streets:fetch` or `data:catalog:fetch`; `streetsOutputs.test.ts` fails while the files
are stale. Each file clips the pinned ways to 300 m (footways, steps and paths to `WALK_RADIUS_M`, 100 m: 200 m left two
dense downtown stations over the 16 KB cap, 150 m one), simplifies to 0.5 m, rounds to decimeters around the station point, and
joins every entrance row that lists the station to the street it opens onto. The pin's manifest lists the `stationIds` it was fetched for: a station added to `stations.json` since gets a file from whatever
pinned ways lie near it and a `WARNING:` line from the build (not a failure) until `data:streets:fetch` is rerun. The build prints where the join is doubtful
(no street within 40 m, near misses for a median, bridge and tunnel ways, entrances near the 300 m edge); read it after a refresh.

`npm run data:walk` (offline) turns the same pin into `public/data/walk/<id>.json`, one walk graph per station for routing
(`src/data/walkSchema.ts`). Rerun it after `data` or `data:streets:fetch`; `walkOutputs.test.ts` fails while the files are stale.
Each file keeps every walkable pinned way within 300 m, named roads included (as kind `road`; the router prices them), minus
`foot=no|private|use_sidepath` and `access=no|private` without a `foot` that allows it. Vehicle `oneway` is ignored (the graph is
undirected). Ways are clipped with the street files' method, at 300 m for every class (the street files clip footways at 100 m), and rounded to decimeters
as they are (a node has the same x/z in both),
simplified to 0.5 m, and cut into edges at every shared node, so junctions are real graph nodes; `steps` edges are the
step-free flag. Caps are in `scripts/lib/budget.ts` (64 KB per file, 4.6 MB total gzipped), outside the startup budget; the
build also fails if the startup total moves. A station missing from the pin's `stationIds` gets a `WARNING:` line (its file may
be partial or empty, not a failure). It prints stations with no walkable way, the number of excluded ways, the largest files, the
stations whose largest connected piece holds under 90% of the walkable length (dead-end underground footways and
gaps in OSM; check that list after a refresh) and the totals.

`npm run data:search:streets` (offline) turns the same pin and `public/data/stations.json` into the citywide street and
intersection search index, 64 hash-bucket shards under `public/data/search/streets/` (`src/data/searchSchema.ts`,
`src/lib/searchBucket.ts`). Rerun it after `data`, `data:streets:fetch`, a change to the `searchText.ts` synonyms, `GENERIC_TOKENS`
or `isStreet`; `streetIndexOutputs.test.ts` fails while the files are stale. It keeps the ways `isStreet` accepts (named
roadways, service ways included, no plazas): one record per borough and street key ("North 7th Street" and "N 7th St" are "N 7 St"),
with a site per station the street runs nearest to, and one intersection per pair of differently named streets that share a node
(shared nodes within 100 m count once, so a divided street's two carriageways are one crossing). The borough is the nearest
`stations.json` station's, which can be wrong on a land border (the build counts the street vertices near one). Coverage is
the pin's: streets within 300 m of a station point. Caps are in `scripts/lib/budget.ts` (36 KB per shard, 660 KB total gzipped),
outside the startup budget (it writes only under `search/streets/`). A shard over its cap means 128 buckets, not
dropped content.

## Access exceptions

`stations/access-exceptions.json` is hand-written and empty today:
`{ "missing": { "<gtfsStopId>": { "borough", "ada": "none|full|partial", "adaPartial"?, "reason" } }, "orphans": { "<gtfsStopId>": "reason" } }`.
`missing` gives the borough and ADA status of a GTFS station that 39hk-dx4f doesn't list yet (for
example a new station); `orphans` lets the join ignore a catalog row whose station the GTFS feed
doesn't have. Without an entry the join fails, so the daily data refresh stops instead of shipping
a station with no access fields. An entry that is no longer needed is to be removed, and how loudly
depends on the cause. If the catalog made it stale (it now has the `missing` row, or the orphan
row is gone), every command fails. If a GTFS change did (an `orphans` entry that is a GTFS station
now, a `missing` entry for a station the feed dropped), `npm run data` only prints a warning, so
the unattended refresh isn't blocked (it lands in the refresh PR's data.log); `npm run data:access` and
`stationAccess.test.ts` still fail until the entry is removed.

## Timetables

`public/data/timetable/<serviceId>.json` (one file per service: Weekday, Saturday, Sunday) has no inputs in
this directory. `npm run data` builds it from the regular GTFS zip along with the other GTFS files (the
contract is `src/data/timetableSchema.ts`). Each file loads on demand, outside the 60 KB startup budget,
under its own gzip cap (`TIMETABLE_FILE_GZIP_CAP_BYTES` in `scripts/lib/budget.ts`); the build fails above it,
and removes a file for a service the feed no longer has. Never commit a zip. `scripts/lib/timetableOutputs.test.ts`
checks the committed files against the rest of the data.

### Dated timetables

`public/data/timetable/dated/<YYYYMMDD>.json` plus `dated/index.json` come from the MTA's supplemented GTFS
(`https://rrgtfsfeeds.s3.amazonaws.com/gtfs_supplemented.zip`, rebuilt hourly, the next seven days with planned
work applied). `npm run data -- --zip <regular> --supplemented-zip <supplemented>` (or `$GTFS_ZIP` and
`$GTFS_SUPPLEMENTED_ZIP`; both are downloaded when absent) writes them; the regular zip still builds everything
else, because about 7,000 supplemented trips have no `shape_id` (the supplemented shapes.txt isn't read). A dated file has the same layout as a service
file plus `date` (equal to its name); its `services` lists that day's active supplemented service ids (the base
calendars split into chunks, minus chunks removed for work, plus date-only services). It replaces the day's
service files in the client's router; `index.json` (`{ format, feedVersion, dates }`) lists the dates that have one.

- Which dates: of every date with a supplemented `calendar_dates` row, plus every date from the first to the last on
  which a date-only service runs (a `calendar_dates` add that `calendar.txt` doesn't list), those whose active trip ids
  (`servicesOn` over each feed's calendar and exceptions) differ between the supplemented and the regular feed. Work
  that only removes trains counts; a holiday both feeds treat alike does not (so 20261225 gets no file). The set need
  not be contiguous. Nothing reads the clock to choose it. More than 14 dates (`DATED_MAX_DAYS`) fails the build,
  naming them; none writes an empty index. Each date must be a real YYYYMMDD, since it becomes a file name.
- On any other date the two feeds run the same trips, so the client falls back to the per-service files, which are
  exact there. Dated files that lapse between refreshes are therefore harmless.
- Caps: each file under `TIMETABLE_FILE_GZIP_CAP_BYTES` (the largest, a heavy weekday, is about 40.6 KB of 48 KB), the
  directory under `TIMETABLE_DATED_TOTAL_GZIP_CAP_BYTES` (400 KB; the nine measured days total about 238 KB).
- Fails the whole run, writing nothing (the refresh opens no PR that day): the supplemented download or parse, the
  set over 14 dates, a bad date, a pattern calling at a stop `stations.json` lacks (the error names the stop and dates), and the
  checks above. A differing `feed_version` between the two zips, no dated date at all and a last dated file already past are only
  `WARNING:` lines.
- Churn: the files change daily, so each merged refresh adds about 5.7 MB raw (a few hundred KB packed) to git history.
- `scripts/lib/datedTimetableOutputs.test.ts` and `src/data/datedTimetable.data.test.ts` check the committed files.

The build throws, and writes nothing, when a timetable can't be built safely: a time that isn't a multiple of
30 s, a departure before its arrival, an arrival before the previous departure, a stop that isn't a child stop
(or isn't in `stops.txt`), a service id that isn't a plain file name (letters, digits, `_`, `-`) or collides
with another by case, a blank or repeated same-station transfer, or a file over its cap. This is deliberate
(a bad file never ships), but it also stops the unattended daily refresh. The error names the trip and stop.
Look at the feed first: if the MTA really changed its format, change the encoding (`timetableSchema.ts`,
bump `TIMETABLE_FORMAT`) or the cap in one reviewed PR; don't loosen a check to get a refresh through.

## Licenses

- The `osm` section of `*.sources.json` is © OpenStreetMap contributors, available under the
  ODbL 1.0 (see `../public/data/LICENSE-ODbL.md`).
- The `entrances` and `equipment` sections are MTA data from data.ny.gov (datasets i9wp-a4ja and
  94fv-bak7), as are `catalog/stations.json`, `catalog/entrances.json`, `catalog/equipment.json` and
  `catalog/envelopes.json` (39hk-dx4f, i9wp-a4ja, 94fv-bak7, vkng-7ivg). Attribution: Metropolitan
  Transportation Authority. No license is set on the datasets, so the OPEN-NY Terms of Use apply;
  see `../docs/research/data-sources.md` §5.1 (licensing decisions included).
- `catalog/osm-platforms.json` and `catalog/osm-tracks.json` are © OpenStreetMap contributors,
  available under the ODbL 1.0.
- `streets/` is © OpenStreetMap contributors, available under the ODbL 1.0 (see `../public/data/LICENSE-ODbL.md`).
  The street files built from it (`public/data/streets/`) are ODbL derivatives; their entrance points are MTA data (i9wp-a4ja)
  under the OPEN-NY Terms of Use, which each file's `attribution` says. The walk files (`public/data/walk/`) are ODbL derivatives
  of the same pin and carry the OSM credit only: the anchor is the station's `stations.json` point (MTA GTFS), everything else is OSM.
  The street search shards (`public/data/search/streets/`) are ODbL derivatives too and carry the OSM credit only; their borough
  labels come from `stations.json`, which takes them from the MTA Subway Stations dataset (39hk-dx4f, OPEN-NY Terms of Use; joined
  by `scripts/lib/stationAccess.ts`), and the station id on each site from MTA GTFS; the rest is OSM. The shards keep the OSM-only
  attribution line.
- `layout-oracle.json` and `layout-holdout.json` hold facts read from English Wikipedia articles, which are available under
  CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/); each entry names its article and revision.
  No text is copied and the file is not shipped with the site.
- The `*.authored.json` files are offered under the ODbL 1.0, because their frame is registered to
  OpenStreetMap geometry.

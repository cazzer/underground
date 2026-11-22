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
- `layout-oracle.json` and `layout-holdout.json` hold facts read from English Wikipedia articles, which are available under
  CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/); each entry names its article and revision.
  No text is copied and the file is not shipped with the site.
- The `*.authored.json` files are offered under the ODbL 1.0, because their frame is registered to
  OpenStreetMap geometry.

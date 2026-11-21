# Station inputs

Inputs to `npm run data:stations`, which writes `public/data/stations/<id>.json`. Nothing here
is shipped to the site.

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
  for `public/data/stations.json`) together with `stations/access-exceptions.json`; after a catalog refresh, run `npm run data:access` (offline). Nothing here is read by
  `npm run data:stations`; the rest is input for the planned station generator. The DOS Track LRS is not pinned (see `../docs/research/data-sources.md` §5.1).
  **E&E coordinates are unreliable:** the dataset's own overview says they are the station center
  when a machine's exact location is not known, and some are plainly wrong (25 machines are over 500 m
  from their station; EL100 is at Jay St, 15 km from 149 St-Hostos). Place machines from their `serving` text, not from `lat`/`lon`.

- `stations/layout-oracle.json`: 62 stations (and 14 complexes or multi-level ones the classifier should decline) with their platform type, platform and track counts and
  whether a mezzanine exists, each with the English Wikipedia article title and revision id it was read
  from. Used only by `scripts/score-archetypes.ts` to score the archetype classifier. The facts were checked
  by an agent against the articles, not by a person. Facts only: no article text is copied.

## Refreshing

1. `npm run data:stations:fetch -- --station L08` (needs network; Overpass can answer 502 when busy,
   so retry after a minute).
2. Review the diff of `stations/L08.sources.json`.
3. `npm run data:stations`. It fails if the sources gained a row the authored file doesn't map, or
   if a moved machine no longer lands inside a platform or slab. Fix the authored file, rerun.
4. Commit the sources, the authored file, and `public/data/stations/` together. A test fails if the
   committed output is stale.

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
5. Commit. `catalogData.test.ts` checks the files against each other.

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
- `layout-oracle.json` holds facts read from English Wikipedia articles, which are available under
  CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/); each entry names its article and revision.
  No text is copied and the file is not shipped with the site.
- The `*.authored.json` files are offered under the ODbL 1.0, because their frame is registered to
  OpenStreetMap geometry.

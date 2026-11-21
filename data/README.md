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
  carry no station key. Nothing here is read by `npm run data:stations`; it is input for the planned
  station generator. The DOS Track LRS is not pinned (see `../docs/research/data-sources.md` §5.1).
  **E&E coordinates are unreliable:** the dataset's own overview says they are the station center
  when a machine's exact location is not known, and some are plainly wrong (25 machines are over 500 m
  from their station; EL100 is at Jay St, 15 km from 149 St-Hostos). Place machines from their `serving` text, not from `lat`/`lon`.

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
   429, 502, 503, 504 and network errors after 30, 60 and 120 s, or the Retry-After). It writes nothing unless every request succeeds, each row count
   matches `count(*)`, no file is over 2 MB (`osm-platforms.json` and `osm-tracks.json` are separate for headroom) and the total is under 5 MB.
2. Review the diff of `stations/catalog/`. The E&E file changes most often (new machines).
3. Commit. `catalogData.test.ts` checks the files against each other.

## Licenses

- The `osm` section of `*.sources.json` is © OpenStreetMap contributors, available under the
  ODbL 1.0 (see `../public/data/LICENSE-ODbL.md`).
- The `entrances` and `equipment` sections are MTA data from data.ny.gov (datasets i9wp-a4ja and
  94fv-bak7), as are `catalog/stations.json`, `catalog/entrances.json`, `catalog/equipment.json` and
  `catalog/envelopes.json` (39hk-dx4f, i9wp-a4ja, 94fv-bak7, vkng-7ivg). Attribution: Metropolitan
  Transportation Authority. No license is set on the datasets, so the OPEN-NY Terms of Use apply;
  see `../docs/research/data-sources.md` §5.1 (licensing decisions included).
- `catalog/osm-platforms.json` and `catalog/osm-tracks.json` are © OpenStreetMap contributors, available under the ODbL 1.0.
- The `*.authored.json` files are offered under the ODbL 1.0, because their frame is registered to
  OpenStreetMap geometry.

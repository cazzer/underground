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

## Refreshing

1. `npm run data:stations:fetch -- --station L08` (needs network; Overpass can answer 502 when busy,
   so retry after a minute).
2. Review the diff of `stations/L08.sources.json`.
3. `npm run data:stations`. It fails if the sources gained a row the authored file doesn't map, or
   if a moved machine no longer lands inside a platform or slab. Fix the authored file, rerun.
4. Commit the sources, the authored file, and `public/data/stations/` together. A test fails if the
   committed output is stale.

## Licenses

- The `osm` section of `*.sources.json` is © OpenStreetMap contributors, available under the
  ODbL 1.0 (see `../public/data/LICENSE-ODbL.md`).
- The `entrances` and `equipment` sections are MTA data from data.ny.gov (datasets i9wp-a4ja and
  94fv-bak7). Attribution: Metropolitan Transportation Authority. Their license terms are not yet
  verified.
- The `*.authored.json` files are offered under the ODbL 1.0, because their frame is registered to
  OpenStreetMap geometry.

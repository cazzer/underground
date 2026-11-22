# Data sources for a live NYC subway web app

_Researched 2026-11-20 using live curl requests, protobuf decodes, and Overpass queries. The raw downloads and prototype scripts stayed in the session's scratch space and were not committed._

## TL;DR
1. **Realtime access.** The 8 subway GTFS-RT feeds need **no API key** and return `access-control-allow-origin: *` on GET. **The MTA terms still forbid serving data "directly from MTA's server(s)"**, so we need a small proxy (a Cloudflare Worker). The terms require it, not CORS.
2. **No coordinates.** VehiclePositions **never carry lat/lon**: 0 of 515 vehicles across all 8 feeds had one. They give only `stop_id` + `current_status`. Dots must be interpolated along `shapes.txt` using TripUpdate times.
3. **Static GTFS.** The zip is 5.6 MB (regular) or 19.5 MB (supplemented) and has stops, shapes, routes with colors, and transfers. It has **no `levels.txt` or `pathways.txt`**. Preprocessed to JSON it is about 160 KB, or about 30 KB gzipped.
4. **Station interiors.** No machine-readable source exists. Pieces do: OSM platform polygons with `level`, NY Open Data entrances, the E&E inventory with rise heights, and the E&E feed's `serving` text, which spells out street→mezzanine→platform. Mezzanines, stairs, and how levels stack must be hand-authored.
5. **Starter stations.** **Bedford Av (L), 1 Av (L), 96 St (Q), and Park Pl (S)**, with **34 St-Hudson Yards (7)** as a stretch.

---

## 1. Realtime feeds

All endpoints share the base `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/`.

| Feed path | Routes seen live | Bytes (raw / gzip on wire) |
|---|---|---|
| `nyct%2Fgtfs` | 1 2 3 4 5 6 7 7X GS | 149,671 / 34,211 |
| `nyct%2Fgtfs-ace` | A C E H | 90,859 / 17,134 |
| `nyct%2Fgtfs-bdfm` | B D F M FS | 103,810 / 20,921 |
| `nyct%2Fgtfs-g` | G | 15,431 / 3,197 |
| `nyct%2Fgtfs-jz` | J Z | 20,196 / 3,926 |
| `nyct%2Fgtfs-nqrw` | N Q R W | 93,891 / 18,131 |
| `nyct%2Fgtfs-l` | L | 27,878 / 5,072 |
| `nyct%2Fgtfs-si` | SI | 6,422 / 1,462 |

- **Poll size.** One full poll of all 8 feeds is about 510 KB raw, or about 104 KB gzipped. The server honors `Accept-Encoding: gzip`.
- **No separate 7 feed.** The 7 is in the main feed; `nyct%2Fgtfs-7` returns `NoSuchKey`.
- **Alerts.** `camsys%2Fsubway-alerts` (protobuf, 514 KB) and `camsys%2Fsubway-alerts.json` (1.08 MB). Both send ACAO `*`.
- **No API key.** Every GET returned 200 without an `x-api-key` header. [mta.info/developers](https://www.mta.info/developers) asks for a key only for Bus Time.
- **CORS.** A GET with `Origin: https://cazzer.github.io` returns `200`, `content-type: text/plain`, `access-control-allow-origin: *`. HEAD returns 403 `MissingAuthenticationTokenException` only because no HEAD route exists. OPTIONS returns 200 with `allow-methods: OPTIONS,GET`.
- **Cadence.** Header timestamps advance every 5–10 s (3–6 s on the main feed). Median feed age at fetch time was 4 s, so polling every 15–30 s is plenty.

**What the feeds contain.** Decoded with protobufjs and `nyct-subway.proto`:
- **Structure.** Each feed is a FULL_DATASET with TripUpdates and VehiclePositions in roughly 1:1 pairs.
- **VehiclePosition.** Fields are `trip, current_stop_sequence, current_status, timestamp, stop_id`; L also sends `congestion_level`. **`position` appeared 0 times.** Example from L: `{"current_stop_sequence":20,"current_status":"IN_TRANSIT_TO","timestamp":1795228551,"stop_id":"L26S"}`.
- **Missing status.** `current_status` is often missing (unset on 59 of 140 in the main feed). Per the spec, missing means IN_TRANSIT_TO.
- **StopTimeUpdates.** Each carries arrival/departure plus a directional child `stop_id`, e.g. `L26S`. L, which uses CBTC signalling, also fills `delay`, `uncertainty`, and `stop_sequence`. The list starts at the next stop, so the previous stop has to come from static data.
- **Drawing a dot.** Take the previous stop (from the static sequence) and the next stop, then interpolate along the shape using the predicted arrival and the scheduled segment run time.

**NYCT extensions** (field 1001; [nyct-subway.proto](https://api.mta.info/nyct-subway.proto.txt)):
- `NyctFeedHeader`: `nyct_subway_version`, `trip_replacement_period[]`
- `NyctTripDescriptor`: `train_id` (e.g. `"0L 2102+8AV/RPY"`), `is_assigned`, `direction`
- `NyctStopTimeUpdate`: `scheduled_track`, `actual_track`

**Joining realtime to static trips.** A realtime `trip_id` is the tail of the static one. For example, `126250_L..S` matches `BFA26GEN-L054-Weekday-00_126250_L..S21R`, whose shape is `L..S21R`. Match on `<origin time>_<route>..<dir>`. SI is a quirk: realtime `126600_SI.S03R` uses a single dot, while static has `126600_SI..S03R`.

**Browser decoders** (minified, then gzip -9):

| Option | min | gzip | Notes |
|---|---|---|---|
| `gtfs-realtime-bindings@2.2.0` | 197 KB | 31.5 KB | **Drops the NYCT extensions** |
| `protobufjs@8.8.1` full | 122 KB | 34.7 KB | Handles the extensions |
| `protobufjs/light` | 108 KB | 29.5 KB | Needs a JSON descriptor |
| pbjs static decode + `protobufjs/minimal` | 96 KB | 18.9 KB | Includes the extensions |
| `pbf@5.2.0` | 9.3 KB | 2.6 KB | Hand-written decoders |
| `@bufbuild/protobuf` runtime | 16.6 KB | 5.6 KB | Plus generated code |

If the Worker decodes and serves JSON (§6), the client ships **no protobuf library**.

## 2. Static GTFS

- **Regular feed.** `https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip`, 5,606,305 bytes. `feed_version` is `20261028-fall-2026-pick-with-long-term-supplements`, valid 2026-11-01 to 2027-05-15.
- **Supplemented feed.** `https://rrgtfsfeeds.s3.amazonaws.com/gtfs_supplemented.zip`, 19,537,376 bytes, updated hourly, covering the next 7 days. 7,785 of its 77,957 trips have an empty `shape_id`.
- **Build-time only.** The S3 zips send **no ACAO**, so the browser can't fetch them.
- **Missing files.** Both zips lack `levels.txt`, `pathways.txt`, and entrances.

Files that matter:
- **`stops.txt`:** 496 parent stations (`location_type=1`), each with `<id>N`/`<id>S` children. Realtime uses the children.
- **`shapes.txt`:** 261 shapes, 153,567 points.
- **`routes.txt`:** 29 routes with `route_color`/`route_text_color`, e.g. A `0062CF`, L `7C858C`.
- **`transfers.txt`:** 613 rows, all `transfer_type=2`. 150 link different stations.
- **`stop_times.txt`:** 36.7 MB unzipped. Build-time only, used for segment run times.

## 3. Station interior geometry

| Source | Machine-readable content | Gaps |
|---|---|---|
| GTFS | One coordinate per station | No levels, pathways, or entrances |
| NY Open Data: Subway Stations [`39hk-dx4f`](https://data.ny.gov/Transportation/MTA-Subway-Stations/39hk-dx4f/about_data) | `gtfs_stop_id`, `complex_id`, `structure` (Subway/Elevated/Open Cut/…), ADA per direction | No layout |
| Subway Entrances and Exits 2024 [`i9wp-a4ja`](https://data.ny.gov/Transportation/MTA-Subway-Entrances-and-Exits-2024/i9wp-a4ja/about_data) | Entrance lat/lon, type (Stair, Elevator, Escalator, …), entry/exit, `gtfs_stop_id` | Static; no link to mezzanine or platform |
| E&E Asset Inventory `94fv-bak7` (updated daily) | Lat/lon per machine, `escalator_rise` (messy units), mezzanine/platform/street access flags | Messy units; MRN station codes |
| MTA E&E feeds: `nyct%2Fnyct_ene_equipments.json`, `nyct%2Fnyct_ene.json` (outages), `…_upcoming.json` | 707 machines with `elevatorsgtfsstopid`. The `serving` text gives topology, e.g. Bedford EL359 "…to mezzanine", EL358 "mezzanine to platform". Live outages. | Free text; no stairs |
| OSM (Overpass) | `railway=platform` closed polygons with `level`; `railway=subway` tracks; entrances; some `highway=steps` | No mezzanine/corridor areas; steps mostly lack levels |
| MTA diagrams | None found on mta.info | — |
| Community | [Project Subway NYC](https://www.projectsubwaynyc.com/blog) isometric drawings, which are a visual reference only and assumed all rights reserved | No open interior dataset |

**Derive from data:**
- platform footprint
- track centerlines
- depth order
- entrances
- elevator/escalator positions, rise, and connections
- live outages

**Hand-author:**
- mezzanine outlines
- fare control
- stair runs
- absolute level heights (escalator rise gives hints)
- walls and ceilings

UNVERIFIED: Wikipedia "Station layout" tables (CC BY-SA) could cross-check level order.

## 4. Starter stations

All five are ADA-accessible in `39hk-dx4f`.

1. **Bedford Av (L08, L).** One island platform (OSM 906963980, level -2) and one mezzanine. The E&E chain is complete: EL359 runs street→mezzanine and EL358 runs mezzanine→platform. There are 8 stair entrances and 1 elevator. The L's CBTC feed is the richest.
2. **1 Av (L06, L).** Two **side platforms** (OSM 906964310/311). Elevators go from the street straight to each platform (EL292, EL293). Whether there's a mezzanine is UNVERIFIED.
3. **96 St (Q05, Q).** Modern island terminal with one mezzanine. 9 escalators with rises (16.5 ft platform↔mezzanine, 27–32 ft mezzanine↔street) give most of the vertical dimensions.
4. **Park Pl (S03, Franklin Av Shuttle).** One track, one platform, open cut: the simplest "hello world". It has 1 stair and 1 ramp. OSM tags it `level=1`, which looks wrong and needs checking.
5. **Stretch: 34 St-Hudson Yards (726, 7).** Island platform at level -4, two mezzanines, 16 escalators (rises up to about 82 ft), and 4 elevators.

## 5. Licensing and terms

- **MTA data terms** ([terms](https://www.mta.info/developers/terms-and-conditions), updated 2024-03-13):
  - Apps may not serve data "directly from MTA's server(s)". Data must be stored on a non-MTA server that users access.
  - Don't imply MTA endorses the app.
  - Indicate that data "may not be real time".
  - Don't claim the data is accurate. Citing MTA as the source is fine.
  - The terms state no rate limits or caching rules.
- **MTA IP** ([licensing-info](https://www.mta.info/developers/licensing-info)): logos, maps, and symbols need a license; it's free for free apps. Avoid the official route bullets and the map. Using hex colors from `routes.txt` is probably fine (UNVERIFIED).
- **NY Open Data:** attribute to "Metropolitan Transportation Authority", linking `https://www.mta.info/open-data`. The terms are in §5.1.
- **OSM ODbL** (UNVERIFIED for 2026): show "© OpenStreetMap contributors". A committed derived database, such as extracted platform polygons, must be offered under ODbL; add a LICENSE note next to those files. Extract once at build time rather than querying Overpass from the app.

### 5.1 Station catalog datasets and licensing decisions

`npm run data:catalog:fetch` pins four data.ny.gov datasets, plus OSM platform and track ways, into
`data/stations/catalog/` (sizes and counts: `data/README.md`). The `license` field in each dataset's
view metadata (`https://data.ny.gov/api/views/<id>.json`) is **not set** for any of them, so the
governing terms are the site-wide OPEN-NY Terms of Use. Rows updated are as of the 2026-11-21 fetch.

| Dataset | Title | License field | Attribution | Rows updated | Overview PDF, "Limitations of Data Use" |
|---|---|---|---|---|---|
| `39hk-dx4f` | MTA Subway Stations | none | Metropolitan Transportation Authority, `https://www.mta.info/open-data` | 2026-11-21 | "There are no limitations on the data at this time." |
| `i9wp-a4ja` | MTA Subway Entrances and Exits: 2024 | none | same | 2025-12-05 | "None." |
| `94fv-bak7` | MTA Subway Elevator and Escalator Asset Inventory | none | same | 2026-11-21 (daily) | "There are no limitations on the data at this time." |
| `vkng-7ivg` | MTA Subway and Rail Station Envelopes | none | same | 2025-08-26 | "There are no limitations on the data at this time." It says the polygons are "for informational purposes only" |

The four overview PDFs (read 2026-11-21 from data.ny.gov) state no usage limit that conflicts with our use.
Two data-quality notes from them matter for the catalog: the E&E "X Coordinate" and "Y Coordinate"
are "the center of the subway station if the exact location of the subway elevator or escalator
asset is not known", and the entrances dataset is "a point-in-time dataset as of August 2024" with
one December 2025 update for F/M service changes.

**OPEN-NY Terms of Use** (PDF at `https://data.ny.gov/download/77gx-ii52/application/pdf`, "LAST
MODIFIED: March 8, 2013", read 2026-11-21):
- The preamble says the terms "do not contain restrictions requiring members of the public to use
  attribution, to re-post the license terms with any re-uses of the data, to impose share-alike or
  technical restrictions, nor require the public to obtain pre-approval before re-use of the data".
  The one guard is lawful use: "Keep your re-uses lawful."
- Grant: "The State grants you a non-exclusive, revocable license to use the Content contained on
  this website in a manner consistent with the Terms of Use." Content may carry logos and marks that
  are not licensed; do not remove proprietary rights notices.
- Disclaimer: the State "does not assume legal liability or responsibility for the accuracy,
  timeliness, completeness, or quality of the Content" and "makes no warranty, express or implied".
  It also does not vouch for the Content "after it has been downloaded", nor for "any analyses or
  re-uses".
- Indemnity: the user agrees "to defend, indemnify and hold harmless the State" against claims
  "arising out of or in any way connected with your access to or use of the OPEN-NY website".
- Termination: the State may "terminate your access to OPEN-NY for any reason, without notice";
  "all licenses and other rights granted to you ... will immediately cease". It may also require
  a user, by written notice, to stop using Content it believes is used unlawfully or in breach of the
  Terms of Use.
- Public Participation, scoped by its opening sentence ("To the extent OPEN-NY activates a module or
  forum for public comment or the uploading of Content or other information from members of the
  general public, the following provisions concerning acceptable use apply"): "You must not create
  accounts with OPEN-NY or access the site through unauthorized means, including but not limited to,
  by using an automated device, script, bot, spider, crawler or scraper."

Not pinned:
- **DOS Track LRS** (`dyuj-5if7`) is a file geodatabase download only and needs GDAL, so it is not
  in the catalog. OSM `railway=subway` ways are the track source (Staten Island Railway is tagged the
  same way).
- The 2021 draft NYCT GTFS-Pathways feed must never be added: the MTA says not to use it in
  public-facing applications.

The OSM parts (`osm-platforms.json`, `osm-tracks.json`) are © OpenStreetMap contributors under the
ODbL 1.0 (§5 above). Each way keeps its OSM id; `baseTimestamp` is the Overpass database time. The
fetch uses `out geom` without `meta`, so contributor names and ids are never downloaded. Tracks drop
the operator "New York City Transit Authority" (nearly every track has it) and keep any other value;
the fetch throws on a nearby track with no `operator` tag, so a missing one is never read as NYCT.
`network` is kept raw where present (95% of tracks have none). Platforms keep both raw, so PATH
platforms stay identifiable.

**Decisions (the user, 2026-11-21)**
- (a) Whole-file ODbL station outputs may contain OPEN-NY rows. We ship them with a split attribution
  line: the OSM-derived parts are ODbL, and the MTA-sourced elements are NY Open Data under the
  OPEN-NY Terms of Use. Landed with 9wc.2: `StationInterior.attribution` gains the line "Elements whose sources include nyopendata contain MTA data from data.ny.gov under the OPEN-NY Terms of Use, not ODbL" after the MTA credit. `station-depths.json` carries no such line; it gets its own ("Some railY values come from E&E rises and are MTA data under the OPEN-NY Terms of Use") only when a platform level's depth is an `ee-rise`.
- (b) OPEN-NY governs the pinned data.ny.gov extracts. The MTA developer terms (§5) stay in force for
  the realtime feeds and GTFS, and the "may not be real time" and no-endorsement notices stay
  everywhere.
- (c) The hand-run SODA scripts stay. This is our reading, not settled law. First, the Public
  Participation bullets apply "to the extent OPEN-NY activates a module or forum for public comment
  or the uploading of Content", so they govern those features, not downloading Content. Second, the
  SODA API is data.ny.gov's documented programmatic interface, so it is not an "unauthorized means"
  either. The scripts are run by hand, make 12 SODA requests (view metadata, `count(*)` and rows for
  each of four datasets) plus one Overpass request, send a descriptive `User-Agent`, and never run in
  CI or from the site.

### 5.2 Street ways

The street layer (epic ost) needs the streets and walking ways around each station: names for the entrance join,
node ids for a later walk graph (underground-2q7). Three sources were compared.

| Source | Terms | Node ids | Names | Verdict |
|---|---|---|---|---|
| OpenStreetMap via Overpass | ODbL 1.0, credit "© OpenStreetMap contributors" | yes (way nodes) | as mapped ("North 9th Street") | **chosen** |
| NYC CSCL centerline ([`inkn-q76z`](https://data.cityofnewyork.us/api/views/inkn-q76z.json)) | NYC.gov Terms of Use, not OPEN-NY | no (segments only) | abbreviated ("N  7 ST") | rejected |
| NYC LION ([`2v4z-66xt`](https://data.cityofnewyork.us/api/views/2v4z-66xt.json)) | as CSCL | segment from/to node ids and a node layer, roadway only (no sidewalks, crossings or steps) | as CSCL | rejected: file geodatabase only, needs GDAL |

OSM is already a source (§5, platforms and tracks), its licence is already handled, and it is the only one of the
three that has sidewalks, crossings and steps with shared node ids, which a walk graph needs (LION's node ids cover
the roadway only). CSCL has no node ids and its names would need expanding before they match what a rider sees on a sign.

`npm run data:streets:fetch` pins the result in `data/streets/`. One Overpass request (`out geom`, no meta, so no
contributor names) takes every way within 300 m of any `public/data/stations.json` point: named roads
(trunk to service, living_street, pedestrian) and, named or not, pedestrian, footway (sidewalks and crossings),
steps and path. No motorway, no `*_link`. A way is kept whole when any segment of it passes within the radius;
the per-station build (ost.3) clips. The pin is tiled by station coordinates only, never by a location fix, and the
request carries only public station points. Each shard holds its own node table, so a way is a list of OSM node ids.
Measured before the pin: around Bedford Av (300 m) 30 named ways were 3.3 KB gzipped and 252 walking ways 8.2 KB.
The pin (fetched 2026-11-22, OSM base 2026-11-22T04:33:58Z, one request that succeeded on the first try): 96,808 ways
(75,465 footway, 8,360 residential, 3,672 secondary, 3,060 primary, 2,186 steps, 1,686 tertiary, 1,358 pedestrian,
365 service, 349 unclassified, 128 path, 110 trunk, 69 living_street), 276,489 distinct nodes (285,761 rows, since
border nodes repeat across shards), 132 shards, 25.1 MB raw and 4.7 MB gzipped, the largest shard 1.5 MB (Lower Manhattan,
cell-40.70_-74.025). Every one of the 496 stations has a named way within 300 m. The caps are 2 MB a file and 30 MB in
all (8 MB with `--no-walk`, which keeps the named roads only); GitHub Pages serves none of it, since the per-station
files (ost.3) are what ship.

### 5.3 Basemap tiles

The citywide basemap (epic ost.9: streets, water and parks from a same-origin PMTiles file) is vector tiles cut from a
Protomaps daily build ([build.protomaps.com](https://build.protomaps.com), planetiler, basemap schema 4.15.2 at the time
of writing). The file is on demand only: no startup file mentions it, and the client reads it in HTTP Range requests (ost.9.2).
It is never in git (`.gitignore`: `public/basemap/`, `*.pmtiles`).

**Pipeline.** `.github/workflows/basemap.yml` (manual) runs `pmtiles extract` (go-pmtiles v1.31.2, sha256-checked) for the five
boroughs' bbox (`-74.2591,40.4774,-73.7004,40.9176`) up to z15 (`data/basemap/basemap.json` `spec`), checks the source
metadata against the terms below (`scripts/gate-basemap.ts`), drops the unused layers with tippecanoe's `tile-join` (tag
2.79.0, built from source in that workflow only), verifies the result with `pmtiles verify`, checks the output metadata
again, and publishes it as a GitHub Release (`basemap-<build>-<sha8>`, asset `nyc.pmtiles`, with the licence notes in the
release text). The release is our own copy because Protomaps asks not to hotlink builds and keeps them only about a week.
A normal PR then sets the `pin` in `data/basemap/basemap.json` (build, release, sha256, bytes); `deploy.yml` downloads that
asset into `dist/basemap/nyc.pmtiles` (sha256-checked, skipped with a warning while the pin is null), and its
`verify-basemap` job measures Range on the live site. `npm run basemap:fetch` fetches the same file into the gitignored
`public/basemap/` for dev (offline after the first fetch).

**Layers.** Kept: `earth`, `water`, `landuse`, `roads`. Dropped: `buildings`, `landcover`, `places`, `pois`, `boundaries`
(`tile-join -l` for each kept layer; note `-x` is *attribute* exclusion, not layer exclusion). The gate fails the workflow if
the source metadata's attribution is anything but "© OpenStreetMap", its description changes from "Basemap layers derived from
OpenStreetMap and Natural Earth", the major version is not 4, a layer or metadata key is new, or the output still holds a
dropped layer. It was run against build 20261121's real metadata (kept as `data/basemap/source-metadata.20261121.json`, the
test fixture).

| Source (per Protomaps' [LICENSE_DATA.md](https://github.com/protomaps/basemaps/blob/main/LICENSE_DATA.md)) | Terms | Feeds | Shipped |
|---|---|---|---|
| OpenStreetMap | ODbL 1.0, credit "© OpenStreetMap" | roads, landuse, earth, water | yes, covered by the footer's OSM credit |
| osmdata.openstreetmap.de (OSM-derived water and earth polygons) | ODbL | water, earth | yes, same credit |
| Natural Earth | public domain, credit not required | `earth` land and `water` ocean and lakes at z0 to z5 (ne_50m, ne_10m), and `places` minzoom values | yes, in earth and water (public domain, so no credit is needed) |
| Tilezen | not stated | `places` minzoom for countries | no (`places` is dropped) |
| ESA WorldCover (Daylight landcover) | CC BY 4.0, needs its own credit | `landcover` (z0 to z7) | **no: dropped.** Shipping it would need a licensing card |
| Tangrams (Mapzen) icons | MIT | `pois` icons for the default styles only | no |

The archive's own `attribution` is the OSM link and nothing else, so `Attribution.tsx` needs no change. The release file is an
ODbL derivative database; its notes carry the notice.

**Sizes** (build 20261121, tile bytes as stored, gzip; the same bbox and z15):

| Zoom | Tiles | Full extract | Subset |
|---|---|---|---|
| 0 | 1 | 66,953 | 20,263 |
| 1 | 1 | 72,269 | 17,492 |
| 2 | 1 | 62,964 | 17,715 |
| 3 | 1 | 55,424 | 21,003 |
| 4 | 1 | 50,114 | 20,642 |
| 5 | 1 | 29,825 | 17,351 |
| 6 | 1 | 86,391 | 74,800 |
| 7 | 1 | 185,758 | 174,423 |
| 8 | 1 | 170,248 | 162,254 |
| 9 | 2 | 358,708 | 346,711 |
| 10 | 6 | 713,839 | 675,150 |
| 11 | 16 | 1,033,300 | 911,761 |
| 12 | 56 | 2,702,442 | 2,241,109 |
| 13 | 195 | 6,081,584 | 4,486,831 |
| 14 | 728 | 17,895,047 | 9,117,171 |
| 15 | 2,808 | 66,617,712 | 14,703,181 |
| file | | 95,736,212 | 32,962,204 |

The subset is about 33 MB, a third of the full extract, and z15 is under half of it, so z15 stays. The workflow prints the same
table to its job summary and fails above 200 MB. The Pages artifact limit is 1 GB (the deploy fails above 900 MB).

**tile-join side effects** (checked on the real output): it rewrites the metadata `version` to "2" and `type` to "overlay",
adds `format`, `generator` and `generator_options`, and resets `bounds` to the whole world (the tiles are only the bbox's);
the layer fields, attribution and description are kept. A client must not rely on `version` or `bounds`. It adds a tilestats
table unless run with `-pg`, which the workflow does.

## 6. Static-hosting fit and pipeline

**The MTA terms require a proxy; CORS doesn't.** The plan is a Cloudflare Worker at `/rt` that:
1. fetches the 8 feeds in parallel and decodes them with protobufjs and the NYCT proto;
2. emits compact JSON per trip: route, direction, `train_id`, next `stop_id`, status, timestamp, and the next N arrivals;
3. caches that JSON at the edge for 15 s;
4. optionally merges E&E outages every 5 minutes.

GitHub Actions cron runs at most every 5 minutes, so it can't provide realtime. Cloudflare limits and pricing in 2026 are UNVERIFIED.

**Build step:** a Node script run in CI, using the regular zip.

| Output | Keep | Size (JSON / gzip) |
|---|---|---|
| `stations.json` | 496 parents: id, name, lat/lon (5 dp) | 20.0 / 7.4 KB |
| `routes.json` | id, name, colors | 0.8 / 0.2 KB |
| `shapes.json` | Most-used shape per route+direction (58), Douglas-Peucker 3 m | 103 / 15 KB |
| `segments.json` | Median run time per stop pair (1,149) | 17.4 / 5.0 KB |
| `transfers.json` | 150 inter-station links | 2.6 / 0.7 KB |
| `trip-index.json` | trip key → shape_id plus stop sequence | est. 20–40 KB (UNVERIFIED) |
| `stations/<id>.json` ×5 | Hand-authored levels merged with OSM, entrances, and E&E data | est. 5–20 KB each |

That totals about 170 KB raw, or about 35 KB gzipped. Refresh it with a scheduled Action whenever the zip's `Last-Modified` changes.

**Range requests on Pages (the basemap, ost.9.1).** The PMTiles client reads `nyc.pmtiles` in ranges, so GitHub Pages must
answer a correct uncompressed 206. Measured on the live site with curl (2026-11-22) on a JSON file of the same size class
(`data/shapes.json`, 211,122 bytes), since `.pmtiles` is not deployed yet:

- `Range: bytes=0-126`, `Accept-Encoding: identity`: `206`, `content-range: bytes 0-126/211122`, `content-length: 127`, no
  `content-encoding`, `etag: "6b027b5f-338b2"`, `accept-ranges: bytes`, `cache-control: max-age=600`,
  `vary: Accept-Encoding`, `content-type: application/json; charset=utf-8`.
- The same with `Accept-Encoding: gzip, deflate, br, zstd` (what a browser sends): `206` but `content-encoding: gzip`,
  `content-range: bytes 0-126/22952` (the real file is 211,122 bytes; 22,952 is its gzipped size), a weak `etag: W/"..."`.
  `bytes=0-16383` the same (`content-range: bytes 0-16383/22952`, `content-length: 16384`), and a range at the real end
  (`bytes=211122-`) gets `416` with `content-range: bytes */22952`. So Pages applies a range to the gzipped body and reports
  the gzipped total.
- Who sends which header: a page's JavaScript cannot set `Accept-Encoding` (it is a forbidden header), and spec-following
  browsers send `identity` on a Range request, so the client normally gets the correct answer. Firefox before 148 reportedly
  sends gzip on a Range request (UNVERIFIED here); that cannot be fixed client-side. The only lever is the server's choice of
  compression by `content-type`: the deploy's `verify-basemap` records the `.pmtiles` content-type and prints "BLOCKS ost.9.2
  if the .pmtiles is compressed on the wire" (a warning, not a job failure) when the gzip probe differs from the identity one.
  Because a gzipped answer reports a total other than the file's, **ost.9.2 should treat a `content-range` total different
  from `pin.bytes` as a hard error**, never read the archive from it.
- Cache: `cache-control: max-age=600`, so a cached range can go stale for up to 10 minutes after a deploy; the `etag` changes
  with each deploy. The CDN varies on `Accept-Encoding`.
- Vite dev (sirv) answered `bytes=0-126` on the real file with a correct uncompressed 206 (checked with
  `verify-basemap`); `vite preview` compresses only text and JSON. Neither is Pages.

The headers for `.pmtiles` itself are recorded here after the first deploy with a pin (`verify-basemap` writes them to the
job summary): TODO fill in from that run.

## Gaps / UNVERIFIED
- The exact feed publish interval; polling aliased it, and 5–10 s is what was observed.
- What VehiclePosition `timestamp` means.
- The OSM ODbL wording, Cloudflare limits, and the Project Subway NYC license.
- The MTA terms were read through WebFetch summaries, because curl is blocked by Akamai.
- OSM coverage beyond the 5 stations surveyed.
- Whether 1 Av has a mezzanine, and whether Park Pl's `level=1` is correct.
- Wikipedia layout tables; MTA tunnel beacon coordinates (`mta.info/document/226876`); [nymta/gtfs-documentation](https://github.com/nymta/gtfs-documentation).

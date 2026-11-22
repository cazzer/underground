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
  Measured 2026-11-22 (18,225,633 bytes, 72,437 trips, 6,958 with an empty `shape_id`, all on L-prefixed services): same feed_version
  string, `stops.txt` and `transfers.txt` byte-identical to the regular zip. The three base calendars are split into
  chunks (Weekday, Weekday_C4/_C5/_C11; Saturday_C1-C3; Sunday_C6-C9) that partition the regular trips exactly; planned work is
  `calendar_dates`: type 2 removes chunks, type 1 adds date-only services (L0S1..9, L1S1..5, L2S1..3) absent from `calendar.txt`. The
  add-window was 20261121..20261129 (nine contiguous days; all nine run trips the regular feed doesn't, and no removal-only day lies outside it); outside it the feed is hash-identical to the regular one (the
  following Monday, Saturday and Sunday equal Weekday, Saturday, Sunday). `npm run data` turns the window into
  `public/data/timetable/dated/<date>.json`: 14.9 to 40.6 KB gzipped each (the heavy weekdays), about 238 KB for the nine days,
  about 200 ms per date. Only the timetable comes from it; the static network stays on the regular zip. Loading both zips
  peaks near 2 GB of memory.
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
| MTA E&E feeds: `nyct%2Fnyct_ene_equipments.json`, `nyct%2Fnyct_ene.json` (outages), `…_upcoming.json` | 707 machines with `elevatorsgtfsstopid`. The `serving` text gives topology, e.g. Bedford EL359 "…to mezzanine", EL358 "mezzanine to platform". Live outages. | Free text; no stairs. The outage feed needs no API key (checked 2026-11-22), but its content-type is the literal `${header.s3FileType}` (never check it), and `isupcomingoutage` is unreliable (started outages flagged `Y`, overdue ones `N`) |
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
  - The supplemented GTFS feed (`gtfs_supplemented.zip`) is under the same developer terms as the regular one.
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

The citywide basemap (epic ost.9: streets, water and parks from same-origin vector tiles) is cut from a
Protomaps daily build ([build.protomaps.com](https://build.protomaps.com), planetiler, basemap schema 4.15.2 at the time
of writing). It is served as a static directory of Mapbox Vector Tiles, `basemap/tiles/{z}/{x}/{y}.mvt`, each gzip-compressed on
disk since ost.9.5 (still named `.mvt`; the first release, before it, held plain tiles, and every reader still takes both), fetched
on demand only (no startup file mentions it; the client loads tiles in ost.9.2). Nothing reads a byte range: GitHub Pages
gzips a Range answer with a wrong total (section 6), which is why the first design, one `nyc.pmtiles` read in ranges, was
dropped (ost.9.4). It is never in git (`.gitignore`: `public/basemap/`, `*.pmtiles`).

**Pipeline.** `.github/workflows/basemap.yml` (manual) runs `pmtiles extract` (go-pmtiles v1.31.2, sha256-checked) for the five
boroughs' bbox (`-74.2591,40.4774,-73.7004,40.9176`) up to z15 (`data/basemap/basemap.json` `spec`), checks the source
metadata against the terms below (`scripts/gate-basemap.ts`), drops the unused layers with tippecanoe's `tile-join` (tag
2.79.0, built from source in that workflow only) and verifies the subset with `pmtiles verify`, checks the output metadata
again, then writes the tile directory from that subset (`tile-join -pC -e`: one uncompressed tile per file, named
`<z>/<x>/<y>.pbf`, XYZ rows; renamed `.mvt`; its `metadata.json` is left out, the gate having read the metadata already) and
gzips each tile in place (`gzip -n -9`: no name, no time, so the bytes follow the content alone; the file keeps its `.mvt` name).
`scripts/basemap-tiles.ts check --gzip` reads every tile (each must be gzip, an MVT once inflated, named on its zoom's grid, at
most z15; a tree mixing plain and gzip tiles is refused) before the tree is
packed into one deterministic tarball (sorted names, files only, mtime 0, owner 0, ustar, `gzip -9n`; the outer gzip gains
little on already-compressed tiles, and the deploy's reader expects the format), which is unpacked again
with the deploy's own extractor and compared with the tree. The tarball, `nyc-tiles.tar.gz`, is published as a GitHub Release
(`basemap-<build>-<sha8>`, with the licence notes and the counts in the release text). The release is our own copy because
Protomaps asks not to hotlink builds and keeps them only about a week.
A normal PR then sets the `pin` in `data/basemap/basemap.json` (build, release, asset, sha256 and bytes of the tarball, `files`
and `tileBytes` of the unpacked tree: the sum of the stored, compressed file sizes); `deploy.yml` runs `scripts/fetch-basemap.ts --out dist/basemap`, which downloads the
asset (sha256 and size checked, byte-limited), refuses any tar entry that is not exactly `tiles/<z>/<x>/<y>.mvt` as a regular file
(an allowlist: no absolute path, `..`, link, directory entry or extension; nothing is written before every entry and the file
count and byte total pass), and unpacks to `dist/basemap/tiles/`; the unpacked tree is checked again against the pin. A pin
without `asset` (the first, `nyc.pmtiles` format) is skipped with a warning, as is a null pin. Its `verify-basemap` job
fetches three tiles from the live site (z0, a z15 tile over Midtown and one over Brooklyn), with and without a browser's
`Accept-Encoding`, and fails unless each is a 200 with the tile's exact bytes (for a gzip tree, `--gzip`: gzip bytes, inflated
to a valid MVT; the summary lists the served and inflated sizes). `npm run basemap:fetch` fetches the same tree
into the gitignored `public/basemap/tiles/` for dev (offline after the first fetch; vite serves it, and answers 404 for a tile
that is not in the tree, as Pages does).

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

The archive's own `attribution` is the OSM link and nothing else, so `Attribution.tsx` needs no change. The tiles are an
ODbL derivative database; the release notes carry the notice (the tile directory has no metadata file, so a client must hold the
attribution itself, which the footer already does).

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
table to its job summary and fails above 200 MB.

**The tile directory** (built locally from the same subset with tippecanoe 2.79.0 `tile-join -f -pk -pg -pC -e`, 2026-11-22):
3,820 files (1 each at z0 to z8, 2, 6, 16, 56, 195, 728 and 2,808 at z9 to z15), 44,878,229 bytes unpacked (z15 19.9 MB, z14 12.7 MB,
z13 5.9 MB), larger than the 33 MB `.pmtiles` because that stores each tile gzipped and these are plain. The tarball is
31,372,949 bytes (`gzip -9n`). Unpacking takes about 0.6 s with `scripts/basemap-tiles.ts unpack` (2.4 s for the deploy's whole
`ensureTiles`, which also hashes and scans). Measured on the first tile-pinned deploy (basemap-20261121-ddcef445, section 6):
Pages serves `.mvt` as `application/vnd.mapbox-vector-tile` and does not compress it, so a tile costs its raw size on the wire,
more than its gzipped entry in the `.pmtiles` did.

**Gzipped tiles (ost.9.5).** The fix is to store the tiles gzipped: Pages never compresses this content type, so the stored bytes are the wire bytes and the browser hands the worker a gzip body, which `inflate.ts`
(`DecompressionStream('gzip')`, every target browser has it) inflates before decoding; raw MVT still passes through, so the client
needs no release for the switch and the two formats can coexist during it. The name stays `.mvt`: a `.gz` suffix would not make
the browser decode anything. In the scripts, `node:zlib` inflates (`tileProbe.ts` `readTile`, capped at 2 MiB a tile, as `inflate.ts` is). The pin's
`tileBytes` is the stored size (the sum of the gzip files); the workflow report, release notes and probe line also give the
inflated size.
Wire size of the live Midtown tile `15/9649/12314.mvt`: before (plain, deploy 44991770994) 12,993 B. After: to be recorded
once the gzip release is published and deployed (`verify-basemap`'s summary lists the served bytes of each probe tile, and the
tile-directory report of the workflow run lists both sizes). The
Pages artifact limit is
1 GB (the deploy fails above 900 MB and prints the artifact's size and file count); the tiles add 45 MB to it. The artifact is
uploaded as a single tar, so the 3,820 files should not slow `upload-pages-artifact` (the job summary times it).

**tile-join side effects** (checked on the real output): it rewrites the metadata `version` to "2" and `type` to "overlay",
adds `format`, `generator` and `generator_options`, and resets `bounds` to the whole world (the tiles are only the bbox's);
the layer fields, attribution and description are kept. A client must not rely on `version` or `bounds`. It adds a tilestats
table unless run with `-pg`, which the workflow does.

**Client (ost.9.2).** `src/data/basemapTiles.ts` asks for `basemap/tiles/{z}/{x}/{y}.mvt?v=<release>` (same origin; the
release tag busts caches) for the tiles the camera's ground footprint touches, inside the spec bbox and never above its
maxzoom, z 9 at the coarsest, at most 24 at once (the zoom steps down past that), at most 6 in flight, nearest the view
center first; a tile no longer wanted is aborted, and a reply to an aborted or repeated load is dropped by its sequence
number. It picks again on a 10% pan, a 15% zoom, a 10° turn, a resize, or once the footprint leaves the last chosen one plus
its margin, after 150 ms still (every 500 ms while moving). Nothing is asked for before the first map frame and an idle
callback. The basemap worker (`basemapWorker.ts`) fetches, inflates a gzip body (`DecompressionStream`; raw MVT passes
through) and decodes (`@mapbox/vector-tile` 3.0.0, `pbf` 5.2.0, worker chunk only); no tile is decoded on the main thread, and
without a worker the basemap is off (logged). Empty-tile policy: a 404 is "not served" and a 200 that is not MVT once inflated
(an HTML page, a corrupt tile) "not MVT"; both draw nothing, are never asked for again in the session, and log one line each per
session (the 404 at info level, with z/x/y only). Network failures and other statuses retry after 15 s.

Privacy: tiles follow the camera, never the GPS fix. A location fly-to frames the fix, so street-level tiles for that view
would tell GitHub where the user is: from such a flight on, tiles load no finer than z12 (about 7 km a tile at NYC's latitude,
borough scale) until the user moves the view themselves (a drag past the 6 px mouse / 10 px touch click slop, any wheel step,
a second finger) or picks a station (tap, panel, search result). A tap that doesn't move, or the controls' `start` alone,
keeps the cap. On the lift the tiles are picked again for the view as it is then (`lib/basemap/locationCap.ts`, fed by
`src/scene/useBasemapTiles.ts`; tested with the store and a fake worker in `basemapTiles.test.ts`).

Measured (the pinned release basemap-20261121-ddcef445 via `npm run basemap:fetch`, Vite dev, Chrome on an Apple-silicon
laptop, `?debug`; decode times as the worker reports them):
- First paint 328 ms; first tile request 664 ms, after the first map frame and the idle callback. The city view at load wants
  the six z10 tiles (about 930 KB raw), decoded in 2.2 to 5.6 ms each (16,519 segments in the largest, 215 KB).
- A station flight to Brooklyn Bridge-City Hall asks for 24 z15 tiles mid-flight, settling on 4 at 400 m tilted; then Times
  Sq asks for 5 more and wants 3. Every request was a tile of the view or its margin.
- The densest z15 tile, 15/9647/12320 (City Hall, 86,949 B, 3,300 segments), 1.5 ms in the worker (1.1 ms warm, median of 10
  on the page with the same code); the Times Sq tiles 0.4 to 0.8 ms; the densest Midtown tile, 15/9650/12317 (45,518 B), 0.7 ms
  warm. Far under the 25 ms desktop target; a phone 4 to 6 times slower stays under 25 ms (not measured on a phone).

**Drawing (ost.9.3).** `src/scene/Basemap.tsx` draws the decoded segments as six faint line layers; it adds no source and no
credit: everything drawn is OSM-derived (the "© OpenStreetMap contributors" line already shown; the client loads z9 and finer,
so the z0 to z5 Natural Earth water, public domain anyway, is never drawn); landcover stays dropped. `Attribution.tsx` is unchanged.

## 6. Static-hosting fit and pipeline

**The MTA terms require a proxy; CORS doesn't.** The plan is a Cloudflare Worker at `/rt` that:
1. fetches the 8 feeds in parallel and decodes them with protobufjs and the NYCT proto;
2. emits compact JSON per trip: route, direction, `train_id`, next `stop_id`, status, timestamp, and the next N arrivals;
3. caches that JSON at the edge for 15 s;
4. serves trimmed E&E outages at `/ene` (120 s cache).

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

**Range requests on Pages (the basemap, ost.9.1, measured; why it ships as tiles, ost.9.4).** The first basemap design read
`nyc.pmtiles` in HTTP Range requests, so GitHub Pages had to answer a correct uncompressed 206. Measured twice.

Before deploying the file, with curl (2026-11-22) on a JSON file of the same size class (`data/shapes.json`, 211,122 bytes):

- `Range: bytes=0-126`, `Accept-Encoding: identity`: `206`, `content-range: bytes 0-126/211122`, no `content-encoding`,
  `etag: "6b027b5f-338b2"`, `accept-ranges: bytes`, `cache-control: max-age=600`, `vary: Accept-Encoding`.
- The same with `Accept-Encoding: gzip, deflate, br, zstd`: `206` but `content-encoding: gzip`, `content-range: bytes 0-126/22952`
  (22,952 is the gzipped size), a weak `etag`; `bytes=211122-` gets `416` with `content-range: bytes */22952`. Pages applies a
  range to the gzipped body and reports the gzipped total.

On the deployed `nyc.pmtiles` (the first pinned deploy, Actions run 44989770200, `content-type: application/octet-stream`,
32,962,122 bytes, `cache-control: max-age=600`, `accept-ranges: bytes`):

| Request | Result |
|---|---|
| identity, `bytes=0-126`, `bytes=32961995-32962121`, `bytes=0-16383` | `206`, `content-range: bytes <a>-<b>/32962122`, exact lengths, no `content-encoding`: correct |
| browser-style Accept-Encoding, `bytes=0-126` | `206`, `content-encoding: gzip`, `content-range: bytes 0-126/32958802` (the gzipped total), weak etag |
| the same, `bytes=0-16383` | the same, `bytes 0-16383/32958802` |
| the same, the real last 127 bytes | `416`, `content-range: bytes */32958802` |

So Pages gzips `application/octet-stream` and applies the range to the compressed body. A client that sends gzip on a Range request
(Firefox before 148 reportedly does; UNVERIFIED here) would read a gzip fragment as the archive, and nothing client-side can fix it:
`Accept-Encoding` is a forbidden header, and the server's compression is not ours to turn off. The user approved dropping Range
altogether (ost.9.4): the basemap is a directory of plain tile files, each fetched whole, which Pages may compress and every
browser decodes transparently. There is no Range dependency anywhere now (`scripts/lib/rangeProbe.ts` is gone).

- Cache: `cache-control: max-age=600` (an `etag` changes with each deploy), so a tile can be stale for up to 10 minutes after a
  deploy; the CDN varies on `Accept-Encoding`.
- Tiles, measured on the first tile-pinned deploy (basemap-20261121-ddcef445, 3,820 tiles): `200`,
  `content-type: application/vnd.mapbox-vector-tile`, no `content-encoding` with or without gzip offered (Pages does not
  compress this type), `cache-control: max-age=600`. So a tile's wire size is its raw size. A tile the pack lacks (z15, x 0,
  y 0) answers `404` with `text/html`, which the client treats as an empty tile. Each deploy's `verify-basemap` job records
  these headers in its summary. (ost.9.5 ships the tiles pre-gzipped for this reason; Pages then sends the stored bytes with the
  same headers, so the worker inflates them. Whether Pages adds a `content-encoding` to a gzip-bodied `.mvt` is checked by the
  first `verify-basemap` run on the gzip release, which fails if the served body is not the stored gzip file.)
- That deploy's artifact: 69.75 MB in 5,149 files; `upload-pages-artifact` took 4 s; the basemap download 0.9 s and the unpack
  1.1 s.
- Vite dev (sirv) serves `public/basemap/tiles/...` uncompressed with an empty content type, and a small dev-only middleware in
  `vite.config.ts` answers 404 for a tile not in the tree (without it the SPA fallback returned `index.html` with status 200); `vite preview` compresses only text and
  JSON. Neither is Pages.
- The build job's `upload-pages-artifact` step is timed in the job summary. Baseline, run 44989770200 (one 33 MB file, a 42 MB
  artifact): the upload step started 05:32:12 and the deploy job started 05:32:24, so upload plus job teardown took under 12 s;
  deploy-pages took 5 s.

## Gaps / UNVERIFIED
- The exact feed publish interval; polling aliased it, and 5–10 s is what was observed.
- What VehiclePosition `timestamp` means.
- The OSM ODbL wording, Cloudflare limits, and the Project Subway NYC license.
- The MTA terms were read through WebFetch summaries, because curl is blocked by Akamai.
- OSM coverage beyond the 5 stations surveyed.
- Whether 1 Av has a mezzanine, and whether Park Pl's `level=1` is correct.
- Wikipedia layout tables; MTA tunnel beacon coordinates (`mta.info/document/226876`); [nymta/gtfs-documentation](https://github.com/nymta/gtfs-documentation).

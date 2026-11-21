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
- **NY Open Data:** attribute to "Metropolitan Transportation Authority", linking `https://www.mta.info/open-data`. License terms are UNVERIFIED.
- **OSM ODbL** (UNVERIFIED for 2026): show "© OpenStreetMap contributors". A committed derived database, such as extracted platform polygons, must be offered under ODbL; add a LICENSE note next to those files. Extract once at build time rather than querying Overpass from the app.

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

## Gaps / UNVERIFIED
- The exact feed publish interval; polling aliased it, and 5–10 s is what was observed.
- What VehiclePosition `timestamp` means.
- The OSM ODbL wording, Cloudflare limits, NY Open Data terms, and the Project Subway NYC license.
- The MTA terms were read through WebFetch summaries, because curl is blocked by Akamai.
- OSM coverage beyond the 5 stations surveyed.
- Whether 1 Av has a mezzanine, and whether Park Pl's `level=1` is correct.
- Wikipedia layout tables; MTA tunnel beacon coordinates (`mta.info/document/226876`); [nymta/gtfs-documentation](https://github.com/nymta/gtfs-documentation).

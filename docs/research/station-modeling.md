# Modeling more station interiors

Research for bead underground-hwc (2026-11-21). Three parallel investigations: public records and
datasets, photo and scan capture, and procedural generation. Everything marked UNVERIFIED was not
confirmed against a primary source.

## Recommendation

1. **Generate most stations from archetypes.** A generator that classifies each station by structure
   and platform layout, then fills a template from data we already pin (OSM platforms, entrances,
   E&E elevators and escalators) plus two new MTA datasets, can give an honest low-fi interior to
   roughly 65-75% of the ~445 station complexes (UNVERIFIED estimate). Generated stations are shown
   as approximate.
2. **Hand-author the hard ones:** the 35 multi-station complexes, the 15-20 deep stations,
   multi-level stations, and anything the classifier scores low. Bedford Av stays hand-authored.
3. **Survey a few stations in person** to calibrate the generator's depth and stair defaults and to
   replace the UNVERIFIED guesses in the starter stations. About an hour per station with a phone.
4. **Ask the MTA for the pathways data.** One email could unlock station topology for 138 complexes.

## Sources, ranked

| Source | What it gives | Coverage | Terms |
|---|---|---|---|
| NYCT draft GTFS-Pathways ([post](https://groups.google.com/g/mtadeveloperresources/c/j-vVGirkKkc), zip dated 2021-10-11) | Entrance → mezzanine → platform topology: 985 named entrances with lat/lon, 844 named area nodes (paid/unpaid), 3,810 pathways (stairs, escalators, elevators with E&E ids, fare gates with control-area ids). No levels.txt, lengths or elevations | 138 complexes, 186 GTFS stations, incl. all starter stations | Draft; "do not use this release in public-facing applications"; no license. Calibration and validation only until the MTA says otherwise |
| MTA Subway Stations [`39hk-dx4f`](https://data.ny.gov/d/39hk-dx4f) | `structure` (Subway 283, Elevated 145, Open Cut 39, Viaduct 12, At Grade 11, Embankment 6), division, line, complex, routes, ADA | All 496 | NY Open Data ([terms](data-sources.md#51-station-catalog-datasets-datanygov)) |
| E&E inventory [`94fv-bak7`](https://data.ny.gov/d/94fv-bak7) | Elevator and escalator rise (free text, e.g. `10' 11-3/8in`), landings, serving text | 172 elevators and 228 escalators with rise; real depth for ~140 complexes | NY Open Data |
| Station Envelopes [`vkng-7ivg`](https://data.ny.gov/d/vkng-7ivg) (Jan 2025) | One 2D polygon around each station's public areas | 473 NYCT stations | NY Open Data ([terms](data-sources.md#51-station-catalog-datasets-datanygov)) |
| DOS Track LRS [`dyuj-5if7`](https://data.ny.gov/d/dyuj-5if7) (May 2026) | Every mainline and yard track centerline, from track single-line drawings | All tracks | NY Open Data ([terms](data-sources.md#51-station-catalog-datasets-datanygov)). FGDB download only, so not pinned; accuracy and Z UNVERIFIED |
| OSM (already pinned) | Platform polygons with ordinal `level` (no elevations); indoor areas and stairs | Platforms at 493 of 496 stations, levels on 471; rich indoor mapping at only ~9 big complexes | ODbL, handled |
| Station Amenities [`6yjv-fk7g`](https://data.ny.gov/d/6yjv-fk7g) | Asset counts per station (turnstiles, escalators) | All | Sanity checks only |
| Wikipedia station layout tables | Level order and platform type for nearly every station | Nearly all | CC BY-SA; extract facts only |
| Environmental reviews (e.g. [SAS Phase 2](https://www.mta.info/document/179396)) | Sections and stair counts | Second Avenue Subway stations | Public documents |
| LOC HAER NY-122, NY-325 | Historic drawings and photos | A few stations | Public domain; often out of date |

Two OSM platform ways can mean side platforms or an island split in halves. The classifier needs
the track centerlines to tell them apart.

### Not usable

- **Google Street View and Apple/Google indoor maps:** terms forbid building models from them.
- **YouTube walkthroughs:** downloading violates the terms, so no structure-from-motion.
- **nycsubway.org photos and track maps, vanshnookenraggen maps:** copyrighted; check facts by hand only.
- **MTA bid and contract drawings:** released only under a security NDA.
- **NYC LiDAR, the city 3D building model, DOT and DOB records:** above ground, or not held. The MTA
  is a state authority, so there are no "town office" records for the subway.
- **Depth tables:** no complete public list. E&E rise is the best depth source.

## Records worth requesting

1. **MTA Open Data (highest value, low effort).** Email opendata@mtahq.org and post in the
   mtadeveloperresources group. Ask: (a) is there a newer or final pathways and levels release;
   (b) may we use the 2021 draft publicly with attribution; (c) can they share mezzanine coordinates
   or level elevations?
2. **FOIL** via [mtany.govqa.us](https://mtany.govqa.us/WEBAPP/_rs/). Ask narrowly, per station:
   customer-facing station layout or accessible-pathway diagrams; platform, mezzanine and street
   elevations or elevator travel heights; general-arrangement plans with security rooms redacted.
   Full drawings are usually withheld under the public-safety exemption (POL §87(2)(f)). A release
   grants no reuse license, so ask about reuse explicitly. Expect months.
3. **New York Transit Museum archive** (collections@nytransitmuseum.org, by appointment): about
   7,000 Jay Street drawings and 600 contract books. Drawings of active stations need an approved
   FOIL first.

## Photo and scan capture

Every capture method needs someone on site, so it calibrates and validates; it doesn't scale.

- **Best ratio: a visit with a phone and a tape.** Count risers, tape one riser and one tread,
  pace widths, take photos. Gives depths to about 0.2 m and positions to 1-2 m, which is more than
  the wireframe needs. About 1 hour on site and 1-2 hours authoring per station.
- **Add short LiDAR scans** (iPhone or iPad Pro with Polycam, Scaniverse or 3D Scanner App) of each
  stair and the mezzanine, never the whole station in one pass. Read off about 30 numbers in
  CloudCompare. A Toronto mapper did this for an OSM station
  ([write-up](https://wilkinson.graphics/blog/2025-10-25-3d-mapping/)).
- **Not worth it:** Gaussian splats and NeRF (worse geometry, crowds), Apple RoomPlan (rooms only),
  video structure-from-motion (no scale; fails on repetitive tile and long corridors), and vision
  models estimating distances from photos ([VSI-Bench](https://arxiv.org/abs/2412.14171): unreliable
  at metric distances). A model can draft an authored file from measurements for a person to check.
- **Rules:** NYCT Rules of Conduct §1050.9(c) allow photography and filming without lights,
  reflectors or tripods; personal handheld filming needs no permit
  ([MTA filming](https://www.mta.info/doing-business-with-us/filming)). Keep raw footage private
  (bystanders); publish only derived geometry.

### Field protocol (one station)

Weekday 10:00-15:00 or after 20:00, phone only, flashlight off. Bring a printed plan from the OSM
outline and entrance points with the authored file's u/v axes and stair ids.

- **Each street stair:** photo from the top; count risers and landings; tape one riser and tread;
  run direction, width between handrails, where it lands relative to the fare line.
- **Mezzanine:** pace length and width from a fixed point; sketch fare line and turnstiles; one
  360° photo or a short scan.
- **Each platform stair:** risers, width, distance from the platform end (fixed by OSM), which way
  it rises.
- **Platform:** which track each direction uses; island width; photos from each end.
- **Elevators:** shaft position per level, door side.
- Same day: fill the authored JSON and turn `UNVERIFIED:` notes into "surveyed <date>".

## Archetypes

Counts are estimates (UNVERIFIED).

| Archetype | ~Count | Identified by |
|---|---|---|
| Elevated or viaduct, 2 tracks, side platforms, station house or mezzanine below | 110 | `structure`; two platform ways ≥10 m apart; OSM level 1-2 |
| Elevated, 3 tracks (island express plus sides) | 45 | express and local routes; 2-3 platform ways |
| Shallow cut-and-cover, separate entrance per direction (early IRT locals) | 80-100 | platform level -1; entrances split by street side; per-direction fare areas in pathways |
| Cut-and-cover with mezzanine, side or island (IND standard) | 120 | level -2; E&E serving text "mezzanine to platform" |
| Underground express, 4 tracks, two islands | 50 | express and local routes; two island polygons |
| Deep, elevator or escalator only | 15-20 | elevator rise over 60 ft; level ≤ -3 (191 St, 181 St, 168 St, Clark St, Roosevelt Island, 63 St line, Second Ave, 34 St-Hudson Yards) |
| Open cut, at grade, embankment | ~56 | `structure` |

## Generator design

The generator writes an `AuthoredStation`, not a `StationInterior`, so `scripts/lib/stationMerge.ts`
and its checks (row claiming, containment, attribution) run unchanged.

- `scripts/fetch-station-catalog.ts` pins citywide extracts in `data/stations/catalog/` (five files):
  the `39hk` rows, every OSM subway platform and track way, all entrances, all E&E rows, envelopes.
- `scripts/lib/archetype.ts` (pure): inputs → `{archetype, params, confidence, reasons[]}`.
- `scripts/lib/depth.ts` (pure), in priority order: E&E rise, a short published deep-station list,
  OSM ordinal level × 4.5 m, structure default (subway mezzanine -4.5 m and platform -9 m, or
  platform -5 m without a mezzanine; elevated +4 m and +8 m).
- `scripts/lib/templates/{elevated,cutCover,express,openCut}.ts`: the u/v frame is the OSM platform's
  principal axis; tracks come from the nearest track ways (or the Track LRS); stairs run from
  entrances toward the platform axis; E&E units are placed from their serving text; the envelope
  bounds the mezzanine.
- `scripts/build-stations.ts`: `<id>.authored.json` wins over the generated file.
- Schema: add `'generated'` to the source kinds, and `provenance`, `archetype` and `confidence` to
  `StationInterior`. Replace the hand-kept registry with a generated `public/data/stations/index.json`.
  About 450 files at ~1.2 KB gzipped each, loaded lazily, is fine.
- Honesty in the UI: "Approximate layout from station type" in the panel, generated strokes dashed
  or dimmer (a theme token), depth labels "≈ 9 m" unless they come from E&E, and no interior for
  low-confidence stations.
- Validation (offline, never shipped): score the classifier against the 186 stations in the draft
  pathways feed by topology (number of mezzanines, whether entrances reach a platform directly).

### Risks

Stair positions and mezzanine extents are guessed; OSM level conventions vary by mapper; side vs.
island from two platform ways is error-prone; right-hand running isn't universal; E&E rise needs a
tolerant parser; data.ny.gov licenses are unverified; the pathways draft can't ship and is five
years old.

## Already found for Bedford Av

The draft pathways feed shows two mezzanines, each split into paid and unpaid areas, with fare
control H009 (Bedford) and H010 (Driggs); platform stairs P2-P5 at the Bedford end and P1 and P6 at
Driggs; and Driggs entrances on the NE and SE corners. The authored file guesses two stairs at the
west end, one at the east, and west corners at Driggs. Confirm on a visit before changing it (the
draft can't be shipped as a source).

# underground

## Purpose
A live view of the NYC subway as a static site on GitHub Pages
(github.com/cazzer/underground). It opens on a zoomed-out, low-fi architectural
wireframe map with small dots for moving trains. Pinch/scroll zooms. Zooming toward
a station continuously tilts the camera from top-down to isometric; later that view
shows the station's levels, stairways, and upcoming arrivals.

Status: the real static network (every route shape and station from `public/data/`) renders, and
trains are live: the client polls the deployed realtime Worker (`worker/`) and draws dots from the
pure realtime library. The station panel shows real arrivals. Bedford Av (L08) has a hand-authored interior, the 14 St-Union Sq complex
(`data/stations/635.authored.json`, members 635, L03, R20) an authored approximate one from OSM stairs and elevators, and
about 250 more stations have generated ones (labelled "Estimated layout"), shown to everyone since 9wc.5.
With no `VITE_RT_URL` there is no live data (the HUD says "Live trains off") and no fake motion. The client also polls the
Worker's `/ene` (a sibling of `/rt`) and the station panel and interior mark elevators and escalators out of service.
A faint citywide basemap (roads, water, parks from the pinned tile release) draws under the lines for everyone since ost.9.3.

## Stack
Vite 8, React 19, TypeScript (strict), Tailwind v4 (`@tailwindcss/vite`), three.js,
`@react-three/fiber`, `@react-three/drei`, Vitest. npm. Vite `base` is `/underground/`,
so dev and preview serve under that path.

## Commands
- `npm run dev`: dev server (open the printed URL, path `/underground/`)
- `npm run build`: `tsc -b && vite build` to `dist/`
- `npm run preview`: serve the production build
- `npm test`: Vitest, run once
- `npm run typecheck`: `tsc --noEmit` for `src/`, then `tsc --noEmit -p scripts`
- `npm run data [-- --zip path --supplemented-zip path]`: rebuild `public/data/*.json` from the regular GTFS zip
  (downloads it unless `--zip` or `$GTFS_ZIP` is given; needs Node >= 22.18) and the dated timetables from the
  supplemented zip (`--supplemented-zip` / `$GTFS_SUPPLEMENTED_ZIP`, else downloaded; about 2 GB peak memory). Never commit a zip.
  Also writes `public/data/timetable/<serviceId>.json` (stop times by stop pattern in 30 s units plus the
  same-station transfer rows; outside the 60 KB budget, each under its own 48 KB gzip cap, fails above it;
  removes a file for a service the feed dropped).
  Also writes `public/data/timetable/dated/<YYYYMMDD>.json` (one per date on which the supplemented feed runs different
  trips than the regular one, so work that only removes trains counts; at most 14, not necessarily contiguous) and
  `dated/index.json` (the dates): the day's regular service plus planned work, each file under the same 48 KB cap and the
  directory under `TIMETABLE_DATED_TOTAL_GZIP_CAP_BYTES`; a failed supplemented download, more than 14 such dates, a
  date that isn't a real YYYYMMDD or a stop `stations.json` lacks fails the whole run; other dated files are removed.
  Also reads the pinned `data/stations/catalog/stations.json` for each station's borough and ADA status;
  after `data:catalog:fetch` run `npm run data:access` instead (offline).
  A station the catalog lacks, or an orphan catalog row, needs an entry in
  `data/stations/access-exceptions.json` (see `data/README.md`); the join fails loudly otherwise.
- `npm run data:access`: offline; reruns the borough/ADA join on the committed `public/data/stations.json`
  with the pinned catalog and exceptions, prints the gzip total against the budget.
- `npm run data:stations`: merge `data/stations/*.authored.json` with the pinned `*.sources.json`
  into `public/data/stations/*.json`, generate the template stations from `data/stations/catalog/` plus the
  committed `public/data/shapes.json` and `stations.json` (a hand-authored station wins; it prints each skipped
  candidate with its reason and each dropped source row), write `public/data/stations/equipment.json` (every revenue elevator and
  escalator of the catalog's E&E inventory with the stations that list each, a complex's machines under every member; fetched on the
  first station focus, so outside the startup budget with its own 16 KB gzip cap), and pack `public/data/station-depths.json` (every interior's
  platform tracks and rail heights; it counts toward the shared 60 KB budget). It prints a `WARNING:` line listing
  interior tracks no drawn line rides (packed as no track, so the client stays quiet about them), and fails if any
  track packs more than 2 m off its runs. Offline.
- `npm run data:stations:fetch -- --station L08`: uses the network (Overpass, data.ny.gov); refreshes the
  pinned `data/stations/L08.sources.json` (an authored `fetch.osmLines` / `osmNodes` also pins open ways and nodes,
  which connectors and machines cite by `osmRef`; see `data/README.md`). Review the diff, then rerun `data:stations`. A complex's `fetch` lists
  one GTFS stop id and one station MRN per member (arrays; one `$where ... in(...)` filter, duplicates dropped).
- `npm run data:catalog:fetch`: uses the network (data.ny.gov, Overpass); re-pins the citywide catalog in
  `data/stations/catalog/`. Review the diff, then rerun `data:access` and `data:stations` (the generated interiors
  are built from it; `generatedOutputs.test.ts` fails while they are stale). `npm run data` reads only `catalog/stations.json`.
- `npm run data:streets:fetch -- [--no-walk]`: uses the network (Overpass, by hand); re-pins the OSM streets and walking ways
  within 300 m of any station point into `data/streets/` (a manifest plus sharded `cell-*.json`; ODbL). Review the diff;
  `streetsData.test.ts` checks it. Rerun `data:streets`, `data:walk` and `data:search:streets` after it.
- `npm run data:streets`: offline; builds `public/data/streets/<stationId>.json` for every `stations.json` station from
  the street pin and the catalog entrances (clip to 300 m, simplify, project to decimeters, join each entrance to its street).
  Every member of a station complex gets the complex's entrance set (membership: `catalog/stations.json`
  `gtfsStopId` to `complexId`; a row's own `complexId` is not trusted), each at x/z around that member's own point;
  a shared entrance (one that doesn't list the member) is dropped when it is an elevator, since it doesn't serve the
  member's trains, or lies more than 260 m (`radiusM` minus the 40 m edge margin) from the member's point, with one
  "dropped N shared" log line per station; the rows that list the member itself always stay.
  Rerun it after `data`, `data:streets:fetch`, `data:catalog:fetch` or a change to the `searchText.ts` synonyms (street join
  keys use them); `streetsOutputs.test.ts` fails while the files are stale. It builds and cap-checks every file before
  writing, prints the largest files, the totals and the join log (no street, near misses, bridge/tunnel ways, far entrances),
  and checks the startup budget total did not move. If a file passes its cap, lower the one global `WALK_RADIUS_M` in
  `scripts/lib/streetsBuild.ts` (footways only), never per file.
- `npm run basemap:fetch [-- --out dir]`: downloads the pinned NYC basemap (`data/basemap/basemap.json` `pin`, a GitHub Release
  tarball of MVT tiles, plain or gzip-compressed, still named `.mvt`) and unpacks it to the gitignored `public/basemap/tiles/<z>/<x>/<y>.mvt` (vite serves
  `/underground/basemap/tiles/...`, and a dev-only middleware in `vite.config.ts` answers 404 for a tile not in the tree), sha256-, size- and path-checked, no network once the tree matches; fails while the pin is
  null or the old `nyc.pmtiles` format. `npm run basemap:gate -- <source|output> <metadata.json>` is the workflow's licensing gate
  (offline); `npm run basemap:tiles -- check|unpack|probe-sizes|pin-state ...` checks a tile tree (a gzip tile is inflated and its MVT checked; `--gzip` refuses a plain one; the stored and inflated sizes are
  printed, and `probe-sizes` prints both for the probe tiles to stderr), unpacks a tarball, classifies the pin (offline);
  `npm run basemap:verify -- <tiles-url> '<probe-sizes-json>' [--gzip]` fetches three tiles from the live site and inflates the
  gzip bodies (network; the deploy's `verify-basemap` job runs it, with `--gzip` when the tree's tiles are gzip). The basemap is built by hand-dispatching `.github/workflows/basemap.yml` (see Data below), then
  pinned in a normal PR.
- `npm run data:walk`: offline; builds `public/data/walk/<stationId>.json` (the walk graph: every walkable pinned way within
  300 m, junctions shared, OSM node ids, x/z in dm around the stations.json point, edges with kind and length; oneway ignored)
  for every station from the street pin. Rerun after `data` or `data:streets:fetch`; `walkOutputs.test.ts` fails while stale.
  Caps in `budget.ts` (64 KB per file, 4.6 MB total), outside the startup budget.
- `npm run data:search:streets`: offline; builds the citywide street and intersection search index from the street pin and
  `stations.json` into 64 hash-bucket shards, `public/data/search/streets/00.json` to `3f.json` (`src/data/searchSchema.ts`;
  about 3,200 streets with a site per nearby station, 11,500 intersections; the borough is the nearest station's). Rerun after
  `data`, `data:streets:fetch`, a change to the `searchText.ts` synonyms, `GENERIC_TOKENS` (`src/lib/searchBucket.ts`) or
  `isStreet`; `streetIndexOutputs.test.ts` fails while stale. Caps in `budget.ts` (36 KB per shard, 660 KB total); a shard over
  its cap means 128 buckets, not dropped content. Outside the startup budget, and nothing loads it yet (2q7.14).

Run typecheck, test, and build before reporting work done. Pushing to `main` deploys
via `.github/workflows/deploy.yml` (Actions to Pages).

Worker (its own package and lockfile; run `npm --prefix worker ci` once):
- `npm --prefix worker run dev`: `wrangler dev` serves `/rt`, `/ene` and `/geocode` on `http://localhost:8787`
  (`/geocode` answers only an allowed Origin: `curl -H 'Origin: http://localhost:5173' 'http://localhost:8787/geocode?q=120%20Broadway'`)
- `npm --prefix worker run typecheck` / `test` / `gen`: `gen` regenerates `src/gen/`
  from `proto/subway-rt.proto`
- Root `npm test` does not run worker tests; the `worker` CI job does.
- Worker deploys are controlled by GitHub Actions: the `worker-deploy` job in `deploy.yml` runs
  `wrangler deploy` on every push to `main` after the `worker` checks pass, using the repo secrets
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (skipped with a warning while they're unset).
  Agents never run `wrangler deploy` or `wrangler login` themselves; merging to `main` is the deploy.
- The Pages build reads the repo variable `VITE_RT_URL` (the deployed Worker's `/rt` URL).
- The Worker's Cache API layer is a no-op on workers.dev; edge caching needs a custom
  domain (tracked in 8x4.5). The per-isolate memo and upstream `cf.cacheTtl` still apply; `/geocode` likewise keeps a
  per-isolate 1 h LRU (500 entries) and upstream `cf` caching.
- `worker/wrangler.jsonc` sets `observability.logs.invocation_logs` to false, `observability.redact_query_string` to true and
  `observability.traces.enabled` to false (`src/wrangler.test.ts` pins all three): Workers Logs invocation logs record the full
  request URL, and `/geocode`'s carries the user's query; traces record subrequest URLs. Our own `console.log` lines stay on
  (so the `*-miss` lines still show). `wrangler tail` and the dashboard's live logs may still show full URLs to whoever tails
  production. Never enable traces.
- The client finds the Worker through `VITE_RT_URL` (copy `.env.example` to `.env.local`).

## Directory map
- `src/main.tsx`, `src/App.tsx`, `src/index.css`: entry, root layout, Tailwind + theme CSS vars
- `src/theme.ts`: all colors, line widths, fonts. Blueprint is the only theme (the user's pick): don't add
  other presets, and don't make evidence or cards in other themes. Route colors are
  GTFS data drawn through `theme.routeLineMix` (mixed toward a theme color; amount 1 = mono), then
  pushed to at least 3:1 against `theme.background`.
  TEMPORARY: `?lines=a|b|c` picks the lines look until the 8x4.3 options round is decided (default b)
  Interior tokens (`interiorStroke`, `interiorTrack`, `interiorEntrance`, `interiorFine`,
  `interiorElevator`, `interiorEscalator`, `interiorOutage` (an out-of-service machine; the value of `statusError`), the two widths,
  `interiorDepthFade`) color the station interior. Dev only: `?ene=EL358,EL359` fakes an outage snapshot for those codes (with or
  without `VITE_RT_URL`; `eneDevFixture.ts`)
  TEMPORARY: `?interior=a|b|c` (veil, cutaway, ghost under; default a) and `?interiorY=1|2|3`
  (vertical exaggeration; default 2) until the 8x4.11 cards are decided; the removal list is in
  `src/scene/interiorLook.ts`
  Street tokens `streetStroke` (faint by color, not alpha) and `streetWidth` draw the focused station's streets.
  Default (auto): under the route lines at 0.35 at full color, but above the veil at 7.5, drawn at a fainter stroke
  (1.9:1, `veiledStreetHex` in `src/lib/streetVeil.ts`), while the focused station's interior is loaded under look A.
  TEMPORARY: `?streets=under|over` forces one order until the ost.7 card is decided; the removal list is in
  `src/scene/streetsLook.ts`
  `basemap` holds one `{ stroke, width }` per basemap class (highway, major, minor, path, water, park), faint by color;
  `src/themeBasemap.test.ts` holds its contrasts (roads under `streetStroke` and every line, highway over major
  (≥ 1.95:1) over minor (≤ 1.5:1) over path (≥ 1.3:1), highway apart from major by tone too, water and park 1.5 to 2.5:1; every class
  1 px, so width marks only the subway) and distances (`src/lib/colorMetrics.ts`, shared with `theme.test.ts`).
  TEMPORARY: `?basemap=off` draws no basemap and loads no tiles until ost.9.3's look is signed off; the removal list is
  in `src/scene/basemapLook.ts`
  TEMPORARY: `?landturn=half` lets a landing on an interior with a priority frame (trip path, machines out of service) turn half
  way round when the far side shows more of it (`priorityTurn` in `lib/pathFrame.ts`; south up at Pelham Pkwy on a phone) until the
  2q7.25 landing-turn card is decided (default off: the usual landing turn); the removal list is in `src/scene/landingLook.ts`
  TEMPORARY: `?twist=both` lets a two-finger touch that locked to rotate keep zooming (a twist and a pinch at once) until the
  pah.6 twist card is decided (default `lock`: a rotate lock holds zoom until the lift); the removal list is in `src/scene/twistLook.ts`
  Exit tokens `exitPath` (pink, 3:1, held apart from the interior, focus, location and route colors, also under simulated
  red-green color blindness; theme.test.ts), `exitPathWidth` (3 px), `exitPathDash` / `exitPathGap` (world m) draw the trip's
  way out.
  Car tokens `trainCarSideShade`, `trainCarEndShade` are linear multipliers of a car's route color.
  `bandPitchPx` (2.5) is the gap between routes drawn side by side in a shared corridor.
- `src/scene/`: the r3f scene
  - `Scene.tsx` canvas; `CameraRig.tsx` MapControls,
    HUD-aware fit-to-city framing, zoom-driven tilt, fly-to, auto focus, interrupted-fly-to focus hold;
    `cameraFlight.ts` its fly-to destinations (interior, bare station, point; `interiorFlight` takes the focused station id, which for a complex member is not the file's `stationId`, so the focus hold follows the member; `follows` marks a flight to the selected
    train; a bare station's `stationFlight` frames its entrance marks, `bareStationPoints`, through `bareStationFrame` in `lib/freeFrame.ts`; `interiorFlight` frames the interior's priority frame when there is one, `priorityLanding`, and under TEMPORARY `?landturn=half` may land half a turn round, `priorityTurn`), `newFlight`, `flushMotion` and the landing turn;
    `useStationFlights.ts` the fly-request effect and the mid-flight retarget (interior, bare streets, the trip's path frame, panel size);
    `useEntranceProbe.ts` dev-only `__underground.entrancesAt()` (entrance marks and station in viewport px, free rect);
    `usePathProbe.ts` dev-only `__underground.stationPathAt()` (the priority frame's path marker ends and centerline, and its out-of-service machines' ends, in viewport px, free rect);
    `useStationOrbit.ts` the focused-station orbit (azimuth bounds per frame, pivot, pan-radius clamp, first-turn signal);
    `useTouchOrbit.ts` its two-finger twist on touch (see Rendering conventions; dev-only `__underground.orbit(at?)`: azimuth,
    distance, target, lock, zoomSpeed, rotateSpeed, and a ground point's viewport px);
    `useInteriorReframe.ts` frames an interior that loaded too late for its station flight (after LATE_TURN_PROGRESS
    or after landing): once landed, a 0.6-1 s eased flight onto it with the landing turn decided then (reduced motion
    snaps, no turn); a gesture, another flight, a follow or a focus change cancels it (`interiorReframe.ts`, pure; its `ready` is `interiorReadyFor`, `interiorCovers(interior, awaited station)`, so a complex's other member reframes too, or for a bare station awaiting its streets (`kind: 'streets'`) `streetsReadyFor`: the same reframe onto its entrances, no turn; with the trip panel open a framed interior goes on
    awaiting its priority frame (`kind: 'frame'`, `nextAwaiting`, `frameReadyFor`; the trip's path, then the machines out of service): its arrival, a change to it or a panel move reframes onto it, no turn, until a gesture, a focus change, a follow or the panel closing; with the trip panel closed the landing (which frames the machines out, as known by then, the late-interior reframe included) is final, so a later /ene poll, an outage list expanded or the trip panel opened never moves the camera (on a phone the expanded list leaves about 32 px above the panel, too little to frame anyway); a reframe with nothing to move is skipped);
    `useTrainFollow.ts` the camera follow of the selected train (see Rendering conventions); `useFollowAnchor.ts`
    LiveTrains' -3 frame: steps every slot and writes the selected train's drawn point (`lib/live/followAnchor.ts`)
  - `SubwayLines.tsx` (one merged LineSegments2 via `useLineLayer.ts`; draws `network.shapes` until the banded
    shapes arrive, then eases them in over 300 ms (`BandView.ease`: offset and split blend linearly from unbanded, so no fold); writes the shared `BandView` (Scene owns it; LiveTrains reads
    it) and the band uniforms per frame at priority -0.25); `usePlatformFade.ts` (given `interiorSpans`, `memberSpans` of the loaded interior: a complex's members unioned) writes the loaded interior's
    per-segment platform fade for every band layer (the `?lines=` overlays too); `bandLineMaterial.ts` `BandLineMaterial` (LineMaterial
    with `BAND_GLSL` patched into its vertex shader and the platform fade into its fragment alpha; the patches throw
    if three's anchors move) and the shared `BAND_UNIFORMS`; `useLineLayer` uses it for buffers that carry `bands`; `StationTies.tsx` a thin vertical tie
    from each station marker with a depth down to its sunken platform tracks (`network.stationTrackY`; one
    LineSegments2, `theme.stationTieWidth`; `scale.y` = the depth factor, opacity ramping in from depth 0.35 to 0.65; the focused station's tie is dropped when it has an interior, and so are its complex siblings' (`hiddenSiblings`, `compactTies` in `lib/stationTie.ts`), kept (or a `STUB_DEPTH_M` stub in `lib/stationTie.ts` when it has no depth) when it has none or its load failed); `LineHighlight.tsx` holds the
    temporary `?lines=a|c` layers; `Stations.tsx` (two InstancedMeshes; the focused station's
    instance, and its complex siblings' once the interior covering them is loaded (`hiddenSiblings`, `hiddenSiblingIds` in `interiorLoad.ts`: the index's siblings intersected with the model's members), are scaled to 0 (`writeMarkerMatrices`' `hidden` list) when it has an interior (ready or loading), so it has no marker, and drawn when it has none or its load failed, with a `theme.stationFocus` `FocusRing.tsx` over the trains (`focusedMarkerShown` in `interiorLoad.ts`, passed down as `focusedMarker`); `markerShape.ts` the marker constants);
    `ScenePicker.tsx` click/tap picking of stations and trains in screen space (see Rendering conventions);
    `LiveTrains.tsx` (instanced dots plus a background-colored halo, sized by `trainSize.ts`, `theme.train` if `routeLineMix.amount` is 1 (mono lines); stable per-trip slots, fades in
    and out; the selected train (dot 1.6×) gets a background gap and then a
    `theme.trainSelectedRim` rim. Its dot is drawn on its own above every other dot; its cars get the top widen
    level, a 0.2 m lift (so its roof wins the depth test on shared corridors) and an outline, and it is cars at any zoom
    to 12 km (`selectedCarMix`, laid out wherever it is; `useSelectedSlot.ts` maps the selected trip to its slot and
    eases it on and off over 0.4 s, `src/lib/live/selectedMix.ts`; picks read the same per-slot mix through
    `TrainPickSource.mixOf`); wrapped in an `ErrorBoundary` so a crash shows in the HUD, not a blank map). Zoomed in, the
    dots hand off to `TrainCars.tsx` (car bodies plus per-car background footprints; `useTrainCars.ts` owns
    their instances, consists and per-frame writes; `carGeometry.ts` the shaded chamfered-prism body (its dimension constants live in `src/lib/carDims.ts`)
    and the open outline tube plus its end face. The selected outline is two shells per car (`CarFrame.outlineM`: grown by the gap,
    then gap plus rim, joined across the joints), drawn as back faces, so only a band around the train's silhouette shows at any
    tilt or turn; the tubes are open so no end face crosses a joint, and two 2-instance cap meshes (`writeEndCaps`) close the train's two ends);
    `YouAreHere.tsx` the location marker (constant-size reticle ringed by a thin background halo inside a translucent
    accuracy disc; `hereShape.ts` its line buffers; no event handlers, so it never takes a pick);
    `cameraDistance.ts` helpers; `renderOrder.ts` (also `strokeOrders` and `spanCarOrders`, the per-band and per-deck orders)
  - `SpanCars.tsx` / `useSpanCars.ts` the above-veil copies of the cars on a revealed station's platforms, one layer
    per platform deck (LiveTrains keeps three, splitting the spans with `deckSpans`; 12
    trains each, most on the platforms first; only cars with a weight above 0; the selected rim with them; overflow
    in `?debug`); `veilTint.ts` (its pure shader patch in `veilTintShader.ts`, tested against three's ShaderLib; a missing anchor logs once, never throws) their material, mixing each instance toward the background after shading, as the
    veil blends, so a copy at weight 0 renders exactly like its veiled street car. Along those platforms the map
    track fades out as the interior reveals, in the band line shader (per-segment fade weights, `platformMask.ts`)
  - `StationInterior.tsx` the focused station's interior (two line layers per stroke band, up to four bands; for a generated interior every material is dashed (`interiorApproxDash` / `interiorApproxGap`) and per-segment `distances` cut only platform/slab outlines and slab guides; `InteriorVeil.tsx`, level
    labels: plain DOM divs in the canvas container, placed per frame by `useLevelLabels.ts` (not drei `Html`, whose per-label React root unmounts inside a layout-effect cleanup and logged "unmount a root while already rendering" under StrictMode), text with a background-colored `text-shadow` halo instead of a filled chip so strokes show through); `interiorModel.ts` interior JSON to a
    drawable model (theme colors, labels, camera target; `STEP_RISE_M`); `interiorLook.ts` TEMPORARY look overrides;
    `StationInterior` renders its `children` inside the interior group
  - `ExitPath.tsx` a station path (`StationPathChoice`): the trip's way out at its To station, or a change of trains
    through a hand-authored complex (with a second marker on the next train's track), a child of `StationInterior`
    (Scene's `stationPaths`, the first for the focused interior file; only while that interior is the focused one, in an
    `ErrorBoundary` keyed by `stationPathKey`): `exitPathBuffers` in one LineMaterial layer per stroke band (`model.decks`), at
    `strokeOrders(band, count).exitPath`: over that band's strokes, under the next deck's lifted trains (9.3 band 0, 9.8
    the top band, 9.545 / 9.578 Union Sq's mid bands), `theme.exitPathWidth`, dashed (`exitPathDash`/`exitPathGap`)
    when the layout is estimated or the walk outside is; opacity `interiorOpacity`.
    It hands its start and markers (`ExitPathLayers.keepOut`) to the level labels, which drop just below it on screen
    (`src/lib/labelKeepOut.ts`). The exit's entrance (`TripExit.mapLabel`: ground x/z and raw type) goes to
    `StationStreets` as `exitLabel`, which finds it in the street file it shows (`exitEntranceIndex`, within 1.5 m, same
    type; any complex member's file); the label with it among its `EntranceText.members` (its own index plus each same-text
    twin merged into it) is the exit label: `rankEntrances` (entranceLabelBoxes.ts) ranks it above every other entrance
    (an 8e9 tier over the elevators' 4e9), `exemptExitFromMarks` (streetLabelPlacement.ts) lets it cover other entrances'
    marks (only those; panel, header, footer, station markers, focus ring and level labels still block), and
    `useStreetLabels` tints it `theme.exitPath`
  - `StationStreets.tsx` the focused station's streets (interior or not): one plain LineMaterial layer at y = 0 in a
    group at the street file's anchor, `theme.streetStroke` / `streetWidth`, opacity `interiorOpacity` (so it fades in
    with the reveal and goes with the focus); keyed by station. Street pieces running under a route line are left out
    (the route clip, see `src/lib/routeClip.ts` below, over `localTracks`: the runs within the file's radius + its reach),
    so no 1 px centerline reads as one more track in a bundle; the labels still name the street. Not while the station
    has an interior (loaded or loading): its tracks sink under it, so the streets above stay whole. Its draw order is auto: above the veil (7.5), built from
    `StreetLayer.veiledBuffers` (the 1.9:1 stroke, fading to the background like the others; material color stays
    white), while the station's interior is loaded under look A; else 0.35 at full color; `streetsLook.ts` TEMPORARY
    override. It also draws a fine `theme.interiorEntrance` square (`ENTRANCE_SIZE_M` from interiorModel.ts) at each
    street-file entrance the interior doesn't draw itself (`src/lib/entranceMarks.ts`: no interior entrance within
    1.5 m on the scene ground with the same type; none while an interior is still loading;
    `entranceMarks.data.test.ts` checks L08 adds none), and calls `useStreetLabels.ts`: one aria-hidden wrapper div
    in the canvas container (z-index 0, its opacity the labels' fade) holding a div per label, with the level labels'
    halo `LABEL_HALO`. Placement (`streetLabelPlacement.ts` over `labelPlacementState.ts`, `entranceLabelBoxes.ts`,
    `streetLabelBoxes.ts`, then `labelDeclutter.ts` in two passes) runs only on a frame where the camera, canvas,
    insets, panel, level labels, interior, focus ring or opacity changed, last placement's spot tried first, and once
    more after 10 still frames for the labels that weren't on their first spot. Entrances first (`text-ink`, normal
    case; on a phone, shorter side under 600 px, on two lines, street part then the rest), ranked elevators, then
    labels no other entrance shares, then each head house's best (entrances within 25 m) before any second, then
    nearest the free area's middle, last placement's winners 48 px nearer; six spots: right or left of the mark (its
    first line level with the mark), or a label corner at a mark corner. Then streets (`text-ink-dim`, uppercase, not
    letter-spaced), those a placed entrance label names first, last placement's winners first, then longest; turned
    along the street and kept reading the same way until 15° past vertical; offset off the centerline (half the label
    height + 3 px) away from the station, then the other side, then centered; where subway lines run along the street
    (`src/lib/routeBundles.ts`, once per station: routes within 12 m and near-parallel, and their tracks' lateral
    extent) the offsets clear that extent plus half a band pitch per route and the centered spot is unused; on the
    run with the most on-screen points within 150 m on a phone / 250 m on a desktop (250 m on a phone too for a
    street an entrance label names; last placement's run while it has at most one fewer), nearest the station first,
    falling back to the other runs. Every label keeps clear of the header, footer, panel (+8 px), every entrance
    mark, the other stations' markers within 300 m and the focus ring (sized as Stations.tsx and FocusRing.tsx draw
    them now; an entrance ignores a marker its own mark sits in), and the level labels (`useLevelLabels` writes their rects into Scene's `LabelBlockers`, `src/lib/labelBlockers.ts`,
    at priority 0 each frame; read a frame late); street names also keep clear of the interior's outlines
    (`InteriorModel.outline`, `src/lib/interiorOutline.ts`, padded by half their screen spacing). Sized after mount,
    after `document.fonts.ready` and when a resize flips phone and desktop sizes; opacity `streetLabelOpacity` (the level labels' depth gate)
    While mounted it writes Scene's `StreetMask` (anchor and file radius), which the basemap's roads give way to
  - `Basemap.tsx` the citywide basemap: `useBasemapTiles` plus six class layers (`basemapLayer.ts`: one LineSegments2
    over a pooled buffer per class, tiles in `lib/basemap/tilePool.ts` order so a new tile set rewrites and uploads
    only from the first moved tile; it grows on demand and shrinks after `SHRINK_AFTER_S` (2 s) under a quarter full,
    never below 1024 segments; DynamicDrawUsage, frustumCulled off, hidden at strength 0 or with no segments). Each
    class fades by mixing its stroke toward the background with camera distance (`lib/basemap/classFade.ts`: water to
    0.6 by 20 km, parks and highways down to half by 60 km, major roads out by 25 km, minor by 8 km, paths by 2400 m);
    never by opacity. `CLASS_FADE`'s distances are named constants of their own, the one exception to taking camera
    distances only from the tilt and reveal helpers (paths reuse `DEFAULT_TILT.farDistance` and `DOTS_FROM_M`). Every
    class draws with `basemapLineMaterial.ts` (LineMaterial with three factors on its fragment alpha, a fragment at 0
    discarded; anchors throw, naming the file, if three moves them; not in `BAND_UNIFORMS`), all twins of
    `lib/basemap/edgeFade.ts` or `streetMask.ts`: the network fade (`NETWORK_GLSL` / `networkAlpha`: 1 within 5 km of
    the stations' convex hull, `lib/basemap/networkHull.ts`, one half-plane per hull edge (at most 32; the vertex loop and uniform array
    are sized by the `NET_EDGES` define), then smoothstep
    to 0 over 7 km more; the network's bounding box would sit outside the bbox once padded), the bbox edge (`EDGE_GLSL` /
    `edgeAlpha`: 0 at the spec bbox, in over `edgeFadeFor(distance)`, 4% of the camera distance held to 100 m..3 km and
    written per frame, so a station near the edge keeps its streets close in), and for roads the street mask
    (`MASK_GLSL` / `maskAlpha`): inside the focused station's street radius they fade out as its streets fade in, the
    exact complement of that layer's 70 m edge fade, at the station layer's `interiorOpacity`. Scene wraps it in an
    `ErrorBoundary` with a null fallback: a crash there logs once and draws no basemap. Dev only:
    `__underground.basemapSegments()` (camera distance, per-class used/capacity/visible) and a `basemap:apply`
    performance measure per tile-set change
- `src/ui/Hud.tsx`: Tailwind overlay (the header has a `from-canvas` to transparent gradient behind it, `pointer-events-none`, so strokes panned under its text stay out of the way; title, live status, a screen-reader-only announcer for the gone notice, arrivals
  panel: the station name, a focusable heading (`tabIndex -1`) that ends with the access glyph (`StationName` in `AccessIcon.tsx`: an aria-hidden glyph kept on the last word
  plus sr-only ", <accessLabel>." text, so the heading announces it; none for stations that aren't accessible) and, for partly accessible stations only,
  a dim aria-hidden `PartialAccessNote` line, then `InteriorStatus` and the arrival rows (their "Arrivals" heading is sr-only; `ArrivalsList.tsx`: on a stacked panel only the 3 destinations due soonest (`lib/live/arrivalsCollapse.ts`; the focused row's destination is always kept, in place of the latest, and if a row still unmounts with focus it goes to the heading) and one "Show all N destinations" / "Show fewer" button (aria-expanded, keeps focus; keyed `arrivals-<id>` so a new station, or the panel coming back after a train pick, starts collapsed, as EntranceList does); collapsed, the rows sit at the fixed height of three two-line-destination rows (`CollapsedSizer`), so polls neither grow nor shrink the panel; a row whose train the map draws is a button that selects the soonest such train, `selectableArrival` over `ArrivalGroup.tripKeys` and `ArrivalsSource.drawnKeys`, so the keyboard reaches trains; the others are `aria-disabled` no-ops that look like text, so a poll never drops focus; every enabled row has an `aria-description` naming the arrival it picks), nothing else; the station panel has no ×: its down chevron (`CollapseButton` in `PanelBar.tsx`, `usePanelToggle.ts`) collapses it to a one-line bar in the same `aside` (`ExpandBar`: the station name with its access glyph, plus an up chevron; the body stays mounted but `hidden`, so list states and scroll survive; the aside's padding drops, so the HUD's panel observer reports the smaller rect and the free area grows), tapping the bar expands it, the collapse is sticky for the session (it survives station changes, auto-focus drops and a trip or train in front), the panel's `headingRef` points at the heading, or at the bar while collapsed, so every focus return lands on what shows, and each toggle moves focus to the bar or the heading one frame later (a touch user leaves a station by zooming or panning away; Esc dismisses it); closing the station panel (Esc) moves focus to the Search button; `TrainPanel.tsx` holds the selected-train panel, which covers the station panel and takes focus on
  each pick (one row under the heading: "Following" with a Stop button while the camera follows the train, else a "Follow
  train" button; the same button node, so toggling keeps focus and the panel's size; its `TrainStops.tsx` lists the next stops: 3 rows, "Show all N stops", a 15 s tick; on phones the expanded list is capped at whole rows by
  `useListScroll.ts`, about 5 rows or a quarter of the screen, with a "more below" fade), and the "no longer tracked" panel shown for 10 s; Esc or × closes the train first (the train panel and the gone notice keep ×; the station and trip panels have none), then the
  notice, then the trip panel, then the station, and closing either of the first two returns focus to the trip heading, else the station heading, else
  the Search button; `ArrivalsPanel.tsx` is the station panel (moved out of Hud.tsx), whose last section is `EntranceList.tsx`: an "Entrances" heading and the street file's entrance labels via `useStationStreets` (`entranceRows`, `lib/entranceList.ts`: elevators first, then by street; the map labels' words, same-text stairs within 15 m one row with a count; each row's visible text is aria-hidden and a sr-only `entranceSpoken` form, full names and corners spelled out, is what screen readers get). Wider screens show 3 rows and "Show all N entrances"; a panel stacked over the map (`useStackedPanel`, below `sm`; also the cap rule `useListScroll` uses for the train's stops) a closed "Entrances (N)" disclosure, its list capped by `useListScroll`. Not a live region, nothing while the file loads or when there is none; `TripButton.tsx` the third header button (aria-expanded toggle) with
  `useTripPanel.ts` (opens with `defaultEnds`, closes; Esc, when focus was in the panel, focuses the station heading else the Trip button one frame later) and `TripPanel.tsx`, the trip
  panel (see Navigation UI below), which sits behind a train or notice and in front of the station panel and shares its `panel` ref); `LoadStatus.tsx` loading/error panel
  plus `SceneCrash`/`HudCrash`; `LiveStatus.tsx` the HUD live-trains badge (a polite live region);
  `FocusAnnouncer.tsx` a polite sr-only live region ("Showing <station>", name only) for any newly focused station (auto-focus, tap, link,
  "Go to"), 300 ms after it is entered and only if still focused, not covered by a train panel and not already holding focus (a
  search pick moves focus to the heading, so it stays silent); pure rules in `focusAnnounce.ts`; never moves focus;
  `ErrorBoundary.tsx`; `LiveDebug.tsx` dev-only `?debug` overlay (drawn count, drops by reason, join
  stages, per-feed trips/stale, offset/skew/age; updates per poll)
  `LocateButton.tsx` the header's location button (shows locating and located); `LocateStatus.tsx` its message (the sentence alone is the always-mounted live region)
  with a "Go to <nearest station>" action and a clear ×
  `InteriorStatus.tsx` the panel's station-layout line, one always-mounted live region: loading, error with Retry,
  and `ReadyLine` for a loaded interior (null for authored ones; for a generated one the dim line "Estimated layout",
  shown whether or not the interior is in view so it is announced once, and keyed by station so a cached generated
  station after another one is announced too; the one place a ready-state line goes)
  `OutageStatus.tsx` the panel's out-of-service machines under `InteriorStatus`: up to 2 rows as plain text (title; levels on one line, "EL358 · back about 6 AM" on the next, each part
  whole; the levels line of a machine only the equipment index lists is the inventory's text, wrapped and clamped to 3 lines, and absent when it has none; a first line "No step-free access now", also in the heading's sr-only access text, when an outage leaves an accessible station's
  platform with no step-free route, `stepFreeLoss.ts`; no live region, so opening a panel never speaks them over "Showing <station>" or
  "Estimated layout"), a "Show N more" toggle (focus goes to the station heading if it unmounts while focused), or a dim
  "status unavailable" line; one always-mounted polite sr-only region speaks only a change to the machines out at the station
  whose panel stays open and clears its text after 6 s (`outageAnnounce.ts`, pure; silent on open, station change or stale data)
  `SearchButton.tsx` (top bar) opens `StationSearch.tsx`, a full-screen native `<dialog>` (always mounted; the tap handler calls its `open()` so iOS raises the keyboard) with a combobox over a
  listbox of `SearchResult.tsx` rows (name and access icon, the borough on a dim line only for names whose stations span boroughs
  (`multiBoroughNames` in `labels.ts`), plus route chips, which tell same-borough duplicates apart); choosing a result
  calls `select` (focus then moves to the panel heading; Cancel and Esc return it to the button). Optional `label`
  (dialog name and input label, default "Search stations"), `placeholder` and `onClose` props let the trip panel mount two more
  instances (From, To). The dialog's keydown stops Escape (the native cancel still closes it), so the HUD's window Esc
  handler never also closes a panel; the HUD's `searchOpen` guard stays. `useKeyboardInset.ts`
  pads the list above the on-screen keyboard. `LinkNotice.tsx` is the "link's station isn't on this map" line (with a Search action) under the
  location message
  `OrbitHint.tsx` the header's muted turn hint under the status lines (right- or Shift-drag; two fingers on a
  coarse pointer), shown while a station is focused and no train is followed, until the session's first user turn (about 17° of an armed gesture on one focused station; flights, springs and the cap don't count; `src/lib/orbitTurned.ts`)
- `src/lib/`: pure logic
  - `projection.ts` lat/lon to scene meters; `tilt.ts` zoom distance to polar angle
  - `network.ts` public/data → render model (projected stations, routes, shape paths without bands, bounds,
    `trackLines` for the corridor search; `drawnPath` resamples one shape); `networkBands.ts` `bandShapes` redraws
    the banded shapes (`BandedShapes`) and sets each variant's `cover`, `bandNetwork` runs the search too (tests, the worker fallback);
    `variantCover.ts` `coverVariants`: a variant's segments with the same ends, y and band inputs as one of its route
    and direction's primary's (1 mm, 1e-4), outside the primary's platform spans (its fade would show the variant
    under it), so the lines skip them (about half of the variant segments; trains keep every shape whole;
    `variantCover.data.test.ts` checks the skipped ones draw within 0.05 px of the primary at six views);
    `trackLine.ts` a shape's drawn track (decode, project, `dropSpurs` removes out-and-back tips of
    160°+ turns, then offset); `trackOffset.ts` `offsetPolyline` (miter joins, capped at 2× on sharp
    bends) plus the `TRACK_OFFSET_M` constant (4.7 m). Both use explicit `.ts` imports because a scripts/
    test loads them;
    `trackProfile.ts` a shape's vertical profile (knots, `profileAt`, `resampleForProfile`) and
    `trackAnchors.ts` `profileRuns` (which shapes ride which authored platform track, and where); both use
    `.ts` imports for `scripts/lib/trackDepth.test.ts`;
    `platformSpan.ts` per station and shape the platform span `[d0, d1]` (`network.platformSpans`; `memberSpans` unions a complex's members per shape, the `interiorSpans` that SubwayLines, LineHighlight and usePlatformFade take instead of a station; `deckSpans` splits them by `PlatformSpan.stopId` per deck for LiveTrains id) and its
    weights (`trainSpanWeight`, `maskSpanWeight`, `veilTint`: a lifted car keeps `PLATFORM_RESIDUAL_TINT` 0.2 of the veil on the platform); `platformMask.ts` the platform fade (`maskBreaks`
    adds line vertices through its ramps, `writePlatformFade` the per-segment weights); `trackBreaks.ts`
    `lineBreaks`, every extra vertex a drawn line needs (ramps via `rampSampling.ts`, band tapers every 30 m but only once the slot
    moved 0.25, fade ramps);
    `corridors.ts` shared corridors at load (`corridorBands` gives each shape a `ShapeBands`: slot and corridor
    half-width as `TrackProfile`s. 30 m samples, other band keys within 18 m heading within 15 degrees, gaps under
    150 m filled, runs under 200 m dropped, slot = place minus the middle; band key = short name minus a trailing X),
    over `corridorHash.ts` (flat segment grid grouped by band rank, then line), `corridorSearch.ts` (per-sample
    neighbour masks; a same-route line on the same track copies an earlier one's samples), `corridorOrient.ts` (one
    sign per corridor run, by union-find with parity over side-by-side runs: same heading same sign, opposite
    heading opposite, heaviest first; also each run's connected group), `corridorLateral.ts` (each group's band
    order: primaries vote, weighed by offset (0.5 m or more, capped at 3 m), for the side each neighbour's track lies
    on, times the run sign; greedy single moves from route_sort_order, then unvoted neighbours back in rank order;
    so a band shift adds to the real spacing and no pair swaps along a run) and `corridorProfile.ts` (blips under 200 m dropped, changes within 300 m
    eased as one; a join eases before the change, a leave after). About 100 ms in node, off the main thread
    (`src/data/bandWorker.ts`); `corridorData.test.ts` checks it on the real data (full mirrored bundles at stations,
    B/D west of A/C on CPW, the G beside the F at Bergen St, no clashes, no swaps) and `bandOverlap.test.ts` the
    drawn result (under 5% of shared Manhattan track within 1 px of another colour at 600 m and 1 km; A/B/C/D
    never within 1 px between 59 and 116 St, where the GTFS B/D line lies west of the A/C one);
    `bandOffset.ts` the band offset formula (`bandShift`, `BandView`, `writeBandView`; pitch fades out 25 to 80 km;
    per point, the direction tracks merge under 6.5 px apart and split by 8.5 px, plus the bundle's width, so they
    split only once both bundles fit); `trackOffset.ts` also exports `miterNormals`;
    `focusMachine.ts` camera-driven focus transitions; `focusDwell.ts` `settled`, the 400 ms stillness auto-focus
    waits for; `focusHold.ts` interrupted-flight release rule; `freeFrame.ts` `freeFrame` (3D points in the free rect: required ones, then wanted ones in priority order, each
    joining only if it still fits; heights drawn at the depth factor of each distance tried, one exact quad per height; the
    target within TARGET_RADIUS_M (100 m) of the best of several anchors and `centerRadius` of the centred target) and
    `bareStationFrame`, a bare station's landing on it (the smallest
    distance in 400..600 m, and there the target nearest the centred one, that fit the station and as many entrance marks
    as fit in the free rect less 12 px, the target within PAN_RADIUS_BARE (100 m) of the station and of the centred
    target. Entrances join nearest first, each only if it still fits; when not even the station fits within 100 m it is
    framed alone within STATION_ONLY_RADIUS_M (120 m), else the centred target is pulled within 120 m) over
    `convexRegion.ts` (half-plane clipping, nearest point); `interiorReframe.ts` when a landed station flight reframes onto its interior, and how long; `follow.ts` the train follow's math (`followTargetInto`:
    the ground target that puts a world point on a screen point, exact under perspective at any height; the catch-up
    ease, the 8 px pan break (16 px on touch), the 100 px jump re-fly, `followDistanceFor`); `followStep.ts` `stepFollow`,
    one follow frame (pan break, the 0.35 s lag `stepLag`, catch-up), tested on its own
  - `lineBuffers.ts` (positions, colors, `bands`: each segment end's band inputs from `vertexBandInputs` (miter
    vector normal / cosHalf, slot, corridor half-width), and `segments` per shape: each of its segments' buffer index, -1 when skipped; `skipCovered` leaves out
    `ShapePath.cover` segments whose primary is drawn too, for opaque layers only, so not `?lines=c`), `routeColor.ts` (theme mix plus a 3:1 contrast floor), `framing.ts` (fit
    between HUD insets), `markerMatrices.ts` (incl. `writeChordMatrix`, a car pitched along its chord), `pick.ts` (hit radii, nearest station,
    station-or-train choice): pure render helpers; `labels.ts`
    HUD text (route chips, schedule date)
  - `interiorGeometry.ts` interior to strong/fine line buffers (levels, outlines, entrances);
    `interiorConnectors.ts` stairs, ramps, walkways (`drawWalkway`: a flat connector between two areas of one level, two strong outline-colored sides, no end caps, dashed on a generated interior or between two approximate slabs), escalators (a zero-run one gets a 30 degree run along the
    station axis; on its listing entrance its street end sits there and the run heads toward the plan center,
    down below ground and up at an elevated station; else it is centered, descending toward the center) and elevators (shaft squared to the axis, a stop at each end in that level's pass; machines take
    half the depth fade). An escalator is a band with fine handrails and travel chevrons; an elevator is four
    shaft verticals, a doored square at each stop and a fine cab inside it. A machine in `ConnectorContext.outOfService` (from
    `InteriorBufferOptions.outOfService`) takes the `outage` role, strong and fine, on both sides of the roof cut: an escalator loses its
    chevrons and gets a 3 m cross over the band at mid-run, an elevator a cross over each stop's whole shaft square, in strong strokes at a fixed size so it reads at the landing zoom; tested in `interiorOutage.test.ts`; `escalatorBanks.ts` `spreadBanks`: zero-run escalators whose bands would touch
    sit side by side across the axis in id order (an authored one off its entrance stays put; one listed
    by two entrances throws);
    `interiorAxis.ts` `stationAxis`, the principal direction of the longest platform outline;
    `interiorSegments.ts` the shared segment writer (`SplitAtY` nests, one cut per deck roof); `interiorDecks.ts` the platform
    decks (`interiorDecks`, deepest first, at most `MAX_DECKS` 3), `strokeBandOf`, `bandCutYs`, `trainRoofY`, `trackDecks`;
    `interiorFixture.ts` the tests' mini interior;
    `interiorFraming.ts` bounds, focus anchor (plan center, toward-camera shift, half-extent), level
    labels (`levelHeightText`: authored levels "−4.3 m"; on a generated interior an `ee-rise` depth is signed to one
    decimal, "+" above the street, and any other is "≈ −9 m", signed whole meters), padded hull; `interiorFade.ts` per-level fade share by distance from the street level;
    `interiorReveal.ts` distance to interior opacity. These have `.ts` imports
    because a scripts/ test loads them. `interiorCamera.ts` centers an interior fly-to (always `LANDING_DISTANCE`, the tilt's
    near distance) in the screen area the header, footer and station panel leave free, at the current azimuth, or
    on a portrait free area (`landingAzimuth`, ground height ≥ 1.5× width: phones) turned just enough that the
    platforms (`stationAxis`, `InteriorModel.axis`) run within 25° of screen-vertical, decided once per flight;
    `orbitLimits.ts` azimuth cap by tilt, short-way spring to north-up, soft pan radius, focus-point pivot;
    `touchOrbit.ts` the two-finger gesture lock and turn (pure, allocation-free); `orbitTurned.ts` the session's first-turn flag (set by `useStationOrbit`, read by `OrbitHint`); `turnMeter.ts` the
    hint's max net turn (signed, wrapped steps); `reducedMotion.ts` `prefersReducedMotion()`, one live query shared by
    the camera, live and line code
  - Exit choice (pure; 2q7.11): `minHeap.ts` (`MinHeap`, typed-array binary heap, no decrease-key); `planGeometry.ts`
    (`distanceToRing`, a client copy of the scripts one, `nearestOnPolyline`, `slicePolyline`); `walkRoute.ts`
    (`walkQuery` per-edge seconds at `WALK_SPEED_MPS` with roads x1.3 and, step-free, no steps, plus the largest connected
    component; `snapToWalk` the nearest point on an edge of it; `routeWalk` multi-source A* with a virtual target, so exits
    snap to edge points, not nodes); `interiorGraphCore.ts` the graph both searches share (`buildInteriorGraph`: connector
    ends as nodes, connectors priced stair/escalator 0.5 m/s of slope, elevator 45 s plus 1 m/s, ramp and walkway at walking
    pace, escalators one way when `travel` says so; step-free keeps elevator, ramp, walkway; same-area walks; transfer mode
    drops every connector with an end on the street or in a `paid: false` slab, so a transfer never leaves fare control;
    `shortestFrom` the multi-source Dijkstra from a stop's tracks, `pathBack`); `interiorGraph.ts` (`endpointArea`: authored
    `Endpoint.area`, else the outline within 0.5 m; `routesToStreet`: from a stop's platform to each exit, an `exit: true`
    entrance, or the street end of a connector no entrance lists, `entranceId` null; exits may cross unpaid slabs);
    `interiorTransfer.ts` (`transferRoute`, track to track in transfer mode, or across one platform with no connector;
    `chooseTransfer`: the quickest plus `stepFreeAlt` when it has steps, else `noStepFree` (layout or outage); `probable` for an estimated layout or
    `paidAssumed`, a slab with no `paid` stood on); `complexFixture.ts` the tests' two-deck complex (T01/U01, a direct
    stair, elevators, a walkway, override helpers); `exitChoice.ts` (`chooseExit`: the exit minimizing in-station plus outside time, the outside walk
    over the shard when the destination is within its radius, else a straight-line estimate at `WALK_DETOUR` 1.3;
    `probable` for a generated or `approximate` interior; `street` joins the street-file entrance within 1.5 m of the same type;
    `walkMinutes`; `quickestExit`: no destination, the least in-station time, `walk` and `destination` null;
    `streetEntranceIndex`); `interiorPath.ts` (`exitPathBuffers`: a `StationPathChoice` (exit or transfer; the walk itself in
    `interiorPathWalk.ts`) as group-local buffers: from platform
    height over the track point below the first connector, each connector's centerline between its drawn ends
    (`planEnds` in interiorConnectors.ts, shared with the drawing; `connectorContext` in interiorGeometry.ts), the street
    walk to the exit, then the walk outside (solid over the graph, one dashed line when estimated), a board marker (the
    track at rail height, `BOARD_HALF_M` 9 either side), and with restroke each connector redrawn and the exit's entrance
    square 1 m larger; a transfer instead ends on the next train's track with a second marker, no walk outside or
    square; `interiorPathStrokes.ts` its writers: one per stroke band (`strokeBandOf`), a connector crossing
    bands cut at each deck roof it spans (`bandCutYs`, nested SplitAtY like the interior's), the restroke; one dash phase
    runs along the path, across bands); `exitView.ts` (`finalRideStops`, `exitLineView`: the panel's
    "Quickest way out: Bedford Av & N 7 St" plus a dim note (label tail, "probably", walk, a machine's unknown status),
    and the spoken sentence via `streetSpoken`; `machinesUsed`); `transferView.ts` (`transferLegs`, `transferLegKey`
    (`from>to>nextRoute`; only walks `isChangeWalk` calls a change row), `firstTransferDraws` (per interior the first
    journey's change, none when it takes no connector), `transferLineView`: "Stairs up to the N platform · probably",
    one phrase per connector in travel order, merged when repeated; a dim note (a machine's unknown status); the
    step-free line, or "No step-free way" when the layout has none (silent when only an outage removed it); the spoken
    sentence);
    `walkFixture.ts` the tests' synthetic walk graphs
  - `searchBucket.ts` which hash bucket a street or intersection entry is filed in and which one a query reads
    (`entryBucketKeys`, `queryBucketKey`, FNV-1a over the first two characters of the first distinctive token; `.ts` imports,
    scripts share it); `searchText.ts` name/query tokens (accents, ordinals, abbreviation synonyms) and `osaDistance`;
    `stationSearch.ts` ranks stations for a query (exact, prefix, typo-tolerant; a number only prefix-matches as the
    last word and never with an explicit ordinal, so "14 st" and "14th" skip 145 St; half-typed long forms and ordinals
    like "14 stre" and "14t" keep matching). `stationHash.ts` parses and builds `#station=<id>`
  - `panelCollapse.tsx` `PanelCollapseProvider` (in `App.tsx`, inside `TripProvider`) and the collapse flags of the station and trip panels
    (`panelCollapseState.ts`, pure: `frontPanel` mirrors Hud's bottom slot order, `collapseReducer`, `collapsedFront`).
    `usePanelCollapse(): { collapsed, seq }` is the scene's read-only view (memoised): `collapsed` is true only while the panel in front is a
    collapsed station or trip panel (false with none, and with a train panel or notice in front), and `seq` increments only on a user collapse or expand of
    the panel in front (never on a size change, a station change, a panel closing or a cover; `collapsed` can change without it, so key on `seq`);
    `usePanelCollapseControls()` is the panels' (`usePanelToggle`). The trip flag resets silently when the trip panel closes (opening Trip
    is a request to plan, so it opens expanded). `tripBar.ts` `tripBarText`: the trip bar's "A → B", "From A", "To B" or "Trip" and its spoken form
  - `focus.tsx` focused/dismissed-station React context (not pure); it also carries point flights
    (`flyToPoint`, used by the location button; drops focus, so an orbited view springs back north-up during the flight). In dev only it exposes
    `window.__underground.select(stationId)` for screenshots and Playwright checks
  - `locate.ts` a geolocation fix to a placement (near a station: frame the fix; inside the network but far:
    frame the fix and its nearest station; outside: nearest station only, no marker), failure codes, and the
    state transitions (the last good fix stays drawn through a re-locate or a failure); `locateMessage.ts` its HUD text (never
    coordinates); `framing.ts` `framePoint` frames a radius around a point between the HUD insets
  - `trainSelection.tsx` selected-train context keyed by trip key (the station focus and interior stay; a
    station pick clears it), plus `following`, `follow` and `unfollow` (a point flight, the location button, unfollows). Dev only: `__underground.selectTrain(key)`, `trainKeys()`, and `trainAt(key)`
    (viewport px of the dot and car ends, added by `ScenePicker`)
- `src/lib/live/`: pure helpers for the live layer (no React or three.js; tests colocated)
  - `clock.ts` the live clock: `now = offsetS + performance.now()/1000`, where `offsetS` is the maximum over
    polls of `generatedAt - receivedPerfMs/1000`. Monotone (a poll served from the Worker's 15 s memo
    can't move it back), never reads the device clock; `SNAPSHOT_MAX_AGE_S` (120) drops old data
  - `backoff.ts` poll delay (20 s; jittered exponential backoff on failure; Retry-After capped at 5 min; "warming" 503s);
    `pollOutcome.ts` the pure per-poll decision (state, delay, log; a too-old success is a failure; a schema
    mismatch sticks until a success) that `useRealtimeFeed` runs
  - `liveStatus.ts` `deriveLiveStatus` for the HUD (off/connecting/live/stale/error; one failed poll with
    a snapshot is not shown, two show a delay while trains stay drawn; technical text never appears)
  - `slots.ts` stable instance slots keyed by trip (fade in/out, a grace period for a trip missing from one
    poll, `stepSlot` per frame); `motion.ts` how a dot absorbs a new plan: nothing teleports (ease, a smoothstep-eased
    glide sized from the gap at 60 m/s catch-up within 3-10 s that a new poll continues on its curve rather than
    restarts, moved along the old glide to the poll's time first so that frame keeps its speed, or cross-fade past 1200 m; reduced motion cross-fades). On a shape change (`shapeCarry.ts`) the dot's
    drawn point, in the last frame's `BandView`, is projected onto the new shape's drawn line (`nearestOnTrack`):
    within 25 m and 40 px on screen (`CARRY_MAX_PX`) it carries over and the gap left (a band pitch, or a
    junction's few meters) eases out as a world offset at about 30 px/s on screen (0.6-2 s; dot, cars and picks add
    it; under reduced motion only a gap under 1 px carries, snapped), else it shrinks on the old shape
    (`drawGeometry`) and grows on the new one. `carryReplay.ts` is the shapeCarry tests' replay helper (app camera,
    screen px); `shapeCarry.data.test.ts` replays every same-route shape pair at three junctions on the real bands;
    `trainRoute.ts` dot color route
  - `trackPoint.ts` `trackPointInto`: a train's drawn point at a distance, on its route's band as the band line
    shader draws it (vertices shifted by `bandShift`, straight between) at the profile's height; `nearestOnTrack`
    projects a point onto that drawn line (per poll, a shape change). Dots, cars (and so
    the platform copies), picks and `trainAt` all go through it, with the frame's `BandView` (SubwayLines writes it);
  - `trainPick.ts` the nearest drawn train to a click (dot, or the chord line through its car ends, track points);
    `trainSelection.ts` the selection reducer (two polls in a row without the trip clear it, with a notice; no live layer, an outage, keeps it;
    `following` is set by every select and `follow`, cleared by `unfollow`, a clear and a loss);
    `followAnchor.ts` the selected train's drawn point per frame (as the dot draws it, carry included) and its `cut`
    flag (just valid, a new slot or shape, or a 60 m jump);
    `trainSummary.ts` route and headsign for the train panel and the notice;
    `trainStops.ts` the train's next stops (feed arrivals not yet passed, the dwell stop kept), `nyClockTime`
    (New York 12 h without AM/PM), `stopEta` (clock plus "Now"/"3 min"), `tripTimesDelayed`, `deriveTrainStopsView` (states). Minutes away
    come from `minutesAway` in `arrivals.ts`, shared by the station and train panels: "Now" under 30 s, else
    the arrival's clock minute minus the current one (not floor of seconds), so adjacent rows and both
    panels agree
  - `consist.ts` cars and car length per route, `consistCenter` (the train kept on its shape), `carMix`
    (dots from 2400 m, cars by 1600 m, so a train is a flat footprint before the camera tips), `selectedCarMix` (the
    selected train: dots from 20 km, cars by 12 km) and `carsReach`; `consistLayout.ts` `writeConsist`: cars end to end along the shape
    (`consistSpanInto`, shared with picking), each on its chord between two track points (pitched on the profile), unfolding from the dot point (spacing and length by mix, section by the slot fade);
    `dirtyRanges.ts` upload ranges for runs of changed slots. Only trains within `carsReach` of the view center
    ((1 + 2 × tilt) camera distances plus 300 m, so 1 top-down and 3 at full tilt) are laid out; the rest are zeroed once
- `src/lib/route/`: pure RAPTOR trip router (no fetch, React or three.js), used by the trip panel through `src/data/planTrip.ts`; tests colocated,
  `timetableFixture.ts` is the tests' mini timetable on `realtime/fixture.ts`'s stations
  - `types.ts` `Timetable` (immutable typed arrays), `Journey`/legs and the per-round `Labels`; `NO_TIME`
  - `stops.ts` `buildStopIndex` (child stops, stations, footpaths in CSR: a stop's own station at its change time,
    `DEFAULT_CHANGE_S` 180, plus each `transfers.json` link) and `stopsOfStations` (a complex is every member station)
  - `patterns.ts` `makePatterns` (validates, sorts trips, splits overtaking trips into FIFO sub-patterns `key#1`, ...) and
    `buildTimetable` (the stop to pattern CSR; the overlay swaps patterns and rebuilds it). `Pattern.live` (per trip) and
    `RideLeg.live` say whether a trip's times are realtime predictions (`TripInput.live`)
  - `raptor.ts` `route(tt, from, to, departS, { maxTransfers })`: two labels per round, `arr` (stepped off a train) and
    `ready` (can board, after a same-station change or a walk between stations), so the change time also holds on the
    same platform; Pareto on arrival and transfers (a round's journey is returned only if it beats every earlier
    round); `seed.ts` its round-0 seeding and egress walks; `journey.ts` rebuilds legs from the labels (every change
    is a walk leg, possibly 0 s) and keeps only the Pareto set on (arrival, transfers)
  - `serviceDay.ts` `serviceWindow(atS, calendar, exceptions, datedDates)`: the service-day frames a query at epoch seconds reads
    (yesterday before 04:00, today, tomorrow from 22:00; each with its `servicesOn` services, a `dated` flag when the
    date has a dated file (then `sourcesFor` reads that file, label `<date>:dated`, instead of the services' files), and exact `shiftS` onto the
    query day's time base from `serviceDayStart` in `realtime/serviceDate.ts`, an hour off midnight on DST days;
    no frames = neither calendar nor dated file has service) and `windowKey`; `timetable.ts` `buildRouterTimetable(sources, stations, transfers)`: decodes
    timetable files (`timetableCodec.ts`) into a `Timetable` (stop index = `stations.json`'s stops; pattern key
    `<label>/<file index>` so split lanes stay apart, trip id `<key>/<trip>`, label `<date>:<service>`; unknown
    stops and stations are skipped with one `console.warn`); `plan.ts` `planOn` runs `route` for epoch seconds and
    returns `TripJourney`s (`departAt`/`arriveAt`/`startAt`/`endAt` in epoch seconds; a ride leg's `terminalStop` is its
    pattern's last stop, the headsign, looked up by pattern key in a per-timetable map, so `key#1` lanes resolve too)
  - `overlay.ts` `overlayRealtime(scheduled, { snapshot, nowS, day, lookup })`: for each healthy feed (not stale, no
    error; a snapshot over `SNAPSHOT_MAX_AGE_S` old overlays nothing) replaces the scheduled trips running or leaving in
    the next `REPLACEMENT_WINDOW_S` (30 min) with the feed's trips at predicted times, cancels the ones it lacks, and
    returns `{ timetable, counts }` (the scheduled timetable itself when nothing changed). Per trip: `matchScheduled`
    (`joinTrip.ts`, shared) names its scheduled key, `overlayMatch.ts` `assignTwins` pairs it with a row (same route
    and direction, first departure within 120 s, stop run in the row's sequence preferred, one to one, feeds
    ignored), `overlayRows.ts` fits the predicted stops on a stop sequence (`rowOnPattern`: before them the twin's
    shifted times capped at now, after them its run times only when the feed's horizon cut the predictions off, else a
    short turn and a pattern of its own `rt:<stop ids>`), `overlayGroups.ts` regroups lanes (`key` minus `#j`) and
    rebuilds only the changed ones. Ids are `<feed>:<tripId>`, never a loader id. Feeds come from `ROUTE_FEED`
    (`live/feedHealth.ts`). `planLive.ts` runs it for the trip panel; `overlayFixture.ts` is the tests' scheduled evening and snapshots
  - Times are integer seconds since the service day's start (`serviceDayStart`: noon minus 12 h, an hour off midnight on DST days; may be negative or past 86400, |t| < 2^29); a loader shifts other
    service days itself and keeps their patterns separate
- `src/lib/realtime/`: pure realtime-to-position library (no fetch, React or three.js); tests colocated,
  `fixture.ts` is the mini static world they share
  - `serviceDate.ts` addDays, servicesOn (calendar + exceptions), nyDate
  - `tripLookup.ts` trip-index to per-service trip-key maps and primary shapes
  - `joinTrip.ts` realtime trip to shape: path code, then origin key (startDate-aware; `matchScheduled` returns that hit
    as day, service, origin, route and shapes, which the router overlay shares), then the route's pattern
    that calls at the train's stop and covers most of its predicted stops (ties go to the primary)
  - `polyline.ts` cumulative length, point/heading at distance, forward-only projection
  - `shapeGeometry.ts` each pattern's track line, the map's own (the banded `shapeById`: same vertices, profile and
    band inputs; `trackLine` only for a shape the map lacks) and its stop distances, computed at load
  - `position.ts` `planHop` (once per poll: hop, run time, arrival) and `hopDistance` (per frame, no
    allocation); `positionAlongShape` is their composition. A trip with no VehiclePosition doesn't advance
    to its next hop until the next poll. Segment run times are arrival-to-arrival and include dwell, so the
    first `dwellFor(runS)` (30 s, at most 35% of the hop) of every hop is held at its origin stop: the train
    leaves at `arriveAt - (runS - dwellS)` and still arrives on time, for every status. The run itself is eased
    (`runEase.ts` `easeRun`: a trapezoid, 20% accelerating, cruise at 1.25x the average, 20% braking; monotone, at
    rest at both ends; `rampShareFor` shortens the ramps so no run cruises above 25 m/s; an INCOMING_AT floor
    eases over the rest of the hop). The predicted arrival is
    capped by the schedule from the trip's last stop (`capArrival` in `stopVisit.ts`): MTA final-approach
    predictions run about 40 s late
  - `stopVisit.ts` `nextVisit`: the last stop a train was seen at (STOPPED_AT time; `here` and `leftAfter` on the
    1234567 and L feeds, whose STOPPED_AT ends on departure), carried across polls. `capArrival`: a train still
    `here` never leaves before `leftAfter`; once gone, arrival = min(prediction, schedule from the stop + 6 s),
    pulled in by at most 45 s; never capped leaving the trip's own origin (`LiveTrip.origin`: the shape's first stop,
    or for a primary-fallback join the first stop seen), though the `here` floor applies there. `?debug` counts
    capped plans
  - `smoothing.ts` smoothDistance: per-frame ease that never goes backward
  - `filters.ts` ghostReason: unassigned, stale vehicle, no future arrival
  - `prepareTrips.ts` per poll: filter, join, plan; returns live trips (each with its `HopPlan` and `visit`) and
    per-reason drop counts. Takes the trip memory `carryMemory` builds (shape for join ties, visit and origin for
    the cap), which keeps a trip missing from one poll
- `src/test-fixtures/`: `rt-polls.json` (18 recorded `/rt` polls trimmed to 21 trips) and `rt-static.json` (their
  static subset), which `src/lib/live/lagReplay.test.ts` replays to bound lag both ways and early departures
- `src/data/loadNetwork.ts` fetches stations/routes/shapes/station-depths JSON and validates their outer shape (a
  missing depths file fails the load like the others); `depthsCodec.ts` (pure, `.ts` imports for the scripts'
  encoder) decodes the packed depths in `buildNetwork` against stations.json and the drawn lines into the per-track
  `StationDepthsFile` that `profileRuns` reads (tracks no shape rides: one `console.warn` line);
  `useNetwork.ts` is the loading/error/ready hook (ready also carries the raw `files` the realtime join needs, and
  `bands`, loadBands.ts' promise; `useBands.ts` resolves it for the map); it passes
  `TRACK_OFFSET_M` and `interiorLook.yScale` to `buildNetwork`
- `src/data/useLive.ts` composes live trains for `App`: `useRealtimeStatic` (trip-index + segments, only when
  `RT_URL` is set), `useRealtimeFeed` (one request at a time; a hidden tab aborts and stops polling, becoming
  visible polls at once), `prepareTrips` once per snapshot, and `deriveLiveStatus`. `realtimeFetch.ts` fetches and
  validates one snapshot (the Worker doesn't expose `Retry-After`/`X-Rt-Cache` cross-origin yet; the client copes)
- `src/data/basemapTiles.ts` the basemap tile store (no React; `createBasemapTiles`, types in `basemapTypes.ts`; the
  worker is injected, so `basemapTiles.test.ts` drives it with a fake): reselects tiles on a meaningful view change or
  once the footprint leaves the last chosen one plus its margin (`lib/basemap/reselect.ts`), at most 6 in flight
  nearest the view center first, unwanted ones cancelled, each load's sequence number echoed so a stale reply is
  dropped, an LRU (24 MB / 128), what to draw meanwhile (`drawn`, `version`), the location zoom cap (`capZoom`), one
  log line per failure reason per session; no worker or a crashed one turns the basemap off (logged).
  `basemapWorker.ts` fetches, inflates a gzip body (`lib/basemap/inflate.ts`) and decodes (`basemapProtocol.ts` the
  messages; `init` carries the layers and the drawn tracks, `packTracks(network.shapes)` from Basemap (167 distinct paths,
  about 290 KB), cloned not transferred, from which the worker builds its road clip once (8-18 ms in node, about 3 MB
  kept); a throw there fails the worker, so the basemap goes off, logged); `basemapConfig.ts` `BASEMAP` (the build-time `__BASEMAP__`: bbox, maxzoom, layers, the tile pin's
  release as version; null for a legacy or absent pin; under `vite serve`, `VITE_BASEMAP_DEV=1` in `.env.local` loads
  the local `public/basemap/tiles` with version "dev") and `tileUrl` (`basemap/tiles/{z}/{x}/{y}.mvt?v=<release>`).
  `src/scene/useBasemapTiles.ts` runs it (starts after the first frame and an idle callback; feeds the location cap,
  see Data), mounted by `src/scene/Basemap.tsx`, with `__underground.basemap()` for its counters, decode times and the
  request log
- `src/lib/basemap/`: pure basemap helpers, tests colocated: `tileMath.ts` (Web Mercator tiles, numeric `tileKey`,
  `zoomFor` with 512 px tiles clamped to [`MIN_Z` 9, maxzoom]), `footprint.ts` (`groundFootprint` from the frustum's
  corner rays, misses stopped at 4 camera distances; `selectTiles`, a 0.1 × distance margin, at most 24, stepping the
  zoom down; `footprintInside`), `reselect.ts`, `tileCover.ts` (`drawnTiles`: ready, else previous children that
  cover it, else nearest ready ancestor, else partial previous children), `tileLru.ts`, `locationCap.ts` (the
  location zoom cap's state machine), `clip.ts` (Liang–Barsky; a ring's cut along a tile edge dropped), `featureClass.ts`
  (`classOf`: highway, major, minor, path, water, park; tunnels, sidewalks and crossings (a path's `kind_detail`), rail,
  ferry, earth and points dropped), `areaFilter.ts` (`keepRing`: park and water rings under 1 ha only in z14+ tiles,
  about 7 km in; under 5 ha only in z13+, about 14 km in; a ring reaching the tile edge always stays),
  `decodeTile.ts` (one MVT to per-class xyz segment pairs in scene meters at y 0; `isMvtBytes` rejects HTML and gzip;
  road classes (`isRoadClass`) in z13+ tiles are cut by the worker's route clip; z12 and coarser, water and parks never),
  `mvtFixture.ts` (tests' MVT writer). `projection.ts` exports `groundX`/`groundZ` for per-vertex use
- `src/lib/routeClip.ts`: the route clip both street layers share (pure; ost.10), so no street centerline reads as one
  more track inside a bundle. `buildRouteClip` grids the tracks (corridorHash, 100 m cells, streets sampled every 50 m,
  reach hypot(clip, pad) + 25 m); `keptPieces` cuts a street piece within `ROUTE_CLIP_M` (5 m; routeBundles' 12 m
  `ROUTE_NEAR_M` is for labels only) and 15° of a track, projected inside the track segment ± 3 m, drops a stretch under
  2 m left by a cut, and allocates nothing per call. 5 m is the narrowest that still cuts every
  centerline between two direction tracks (4.7 m off each) and leaves most of a dual carriageway beside a bundle
  (Broadway at 96 St; `docs/evidence/ost.10/diff-*`). `src/lib/routeTracks.ts`: `distinctTracks` (one per ground path),
  `packTracks`/`unpackTracks` (finite-checked) for the basemap worker, `localTracks` for one station.
  `src/lib/clipLineBuffers.ts` cuts a plain layer's buffers, positions and colors interpolated at the cuts. The clip reads
  ground paths only, not depth, so the station layer skips it at a station with an interior (the basemap's roads,
  masked there, stay cut)
- `src/data/useEne.ts` polls the Worker's `/ene` (`ENE_URL` = `eneUrlFrom(RT_URL)`, never an MTA host) beside `useRealtimeFeed`: every 120 s,
  one request at a time, a hidden tab aborts and stops, backoff via `lib/live/enePoll.ts`; `eneFetch.ts` validates one body
  (`realtimeFetch.ts`'s timeout, errors and `parseRetryAfter` are reused). Pure joins in `lib/live/`: `eneJoin.ts`
  (`joinStationOutages`: outage codes to the focused interior's `Connector.id`, each row's levels street-first ("Mezzanine to
  platform"), or for an escalator with `travel` its direction ("Mezzanine up to street"); a snapshot over `ENE_MAX_AGE_S` 480 s old
  by the /rt live clock, else the device clock, is unknown, never "in service" (`useEne` republishes 20 s after it would go stale);
  `closedForRouting(join)` is the step-free routing's input: `chooseExit({ closed })`, or null when status is unknown (callers must
  then say step-free status is unknown; checked on L08 in `exitOutage.test.ts`; no UI routes with it yet), `eneText.ts` (panel text, New York return times). `App` passes `outages.outIds` to `Scene` > `StationInterior`, which
  rebuilds its four line layers only when that set changes (`interiorLayers`; `InteriorModel` itself never changes). `outIds` is a new
  array every render, so Scene keys on its joined ids for `outageFramePoints` (`lib/outageFrame.ts`: each machine's two drawn ends,
  `planEnds` over `connectorContext`, so a zero-run escalator's 30 degree run and its bank spread are where they draw), the camera's
  priority frame (`lib/pathFrame.ts`), so a poll with the same machines out leaves a flight's destination alone.
  The panel alone also names machines only the equipment index lists (every station, interior or not): `useEquipmentIndex.ts` fetches
  `stations/equipment.json` (`loadEquipmentIndex.ts`, contract `equipmentSchema.ts`) on the first focus, only while `/ene` is configured
  (`loading` from the first render that wants it, a failure retried on the next focus change), and `eneIndexJoin.ts` (`joinPanelOutages`,
  pure) adds those machines to the interior's join as `source: 'catalog'` rows, never changing `outIds` or `closed` (drawing, routing and
  `noStepFree` stay interior-only; `useTripExit` keeps the interior join). Until the interior and the index have both settled the join is
  not `known`, so a late source is never announced; stale data reads "status unavailable" for the union of kinds
- `src/data/useStationHash.ts` keeps `#station=<id>` and the focused station in step with `history.replaceState`
  (no history entries): reads on mount and `hashchange`, writes on every focus change; an unknown id clears the
  hash and raises `linkNotice`. Called in `MapView` as a passive effect, after the HUD's inset measuring
- `src/data/loadTimetable.ts` (`expectTimetable`, `expectDatedIndex`, `expectServiceCalendar`; one lazy cached promise per file via
  `interiorCache.ts`: `timetable/<service>.json`, `timetable/dated/<date>.json` and its `index.json`, `transfers.json`, and the calendar from `trip-index.json`) and
  `planTrip.ts` (`planTripLive(stations, from, to, atS, live)`: reads the calendar and the dated index (fetched together; a failed
  index fetch rejects the plan, retried by the next one, never a silent fallback), picks the window, fetches the files it
  needs (a date the index lists reads its dated file, not its service files), builds one `RouterTimetable` per window and `feedVersion`, kept as a single cache entry, then `planOnLive`
  (`lib/route/planLive.ts`, pure: `overlayRealtime` over it with the snapshot, memoised on the timetable and snapshot
  identity, a snapshot over `SNAPSHOT_MAX_AGE_S` old never cached; a throwing overlay is one `console.error` per snapshot and the
  schedule answers, `overlay` null; `planTrip` is the scheduled-only form); `NoServiceError`
  when the calendar has no service on that date; User Timing measures `trip:fetch`, `trip:build`, `trip:overlay` and `trip:route`).
  Nothing here loads at startup; the trip panel opening is the first caller
- Navigation UI (2q7.9): `src/lib/trip.tsx` `TripProvider` (wraps `MapView` in `App.tsx`)
  and `useTrip` hold open, From and To in memory for the session (no URL, history or storage). `src/data/useTripPlan.ts` plans when
  both ends are set and differ, leaving now (live clock once a snapshot has set it, else the device's), drops stale replies by request
  id, replans every 30 s, and on each snapshot newer than the one planned on (trigger `poll`, never announced), while open and not covered by a train panel or notice (silent; once more when the cover goes), on the schedule with the next 30 minutes from the latest snapshot (`overlay` counts ride the ready plan; `?debug` prints them), warms the
  timetable on open and shows "Finding trips…" only after 250 ms. It loads `planTrip.ts` by dynamic `import()`, so the router and its
  loaders are their own chunk, not the startup bundle. `planTripBetween` expands each end to its complex (`lib/route/ends.ts`
  `complexMembers`: same-named stations linked in transfers.json) so a trip never starts or ends with a walk to a same-named station;
  `journeySource` tags a journey Live (every ride leg live), Live and scheduled (a dim "scheduled" on the others) or Scheduled, in the summary ("Leaves in 4 min · Live") and as the spoken sentence's last words; a live ride leg the map draws (`ArrivalsSource.drawnKeys`) has a "Show train" button calling `selectTrain`, so the train panel covers the trip and its × returns focus to the trip heading. A journey's key is its legs' routes and stops, not trip ids, so a scheduled-to-live swap keeps its disclosure and focus; the "Show train" button, once offered, stays as an `aria-disabled` no-op while the train is off the map. A silent poll that first turns a journey's tag from Scheduled to Live (or mixed) stays silent, like any refresh. `journeyView` still words a mid-trip walk between same-named stations as a change.
  `src/lib/tripView.ts` (pure, tested; `tripOnMap.ts` holds `shouldAnnounceOnMap`): `defaultEnds` (a marked fix's nearest station is From, the focused station To; no fix: focused
  is From), `tripMessage`, `orderJourneys`, `journeyView` (a journey departs with its first train), the spoken text, and the
  announce rules (`shouldAnnounceTrip`: a settled plan once, not a refresh). `TripAnnouncer.tsx` is the one polite live region for it,
  mounted in the HUD header (so it outlasts the panel being covered): it speaks a settled plan, the message for ends that can't be planned
  and "On the map: X" only when the focused station really changes while the panel is in front (`shouldAnnounceOnMap`: never on
  open, a swap, an end pick or an uncover, and not while a result loads or in the 1.5 s after one settles); it is emptied whenever its text could be stale and refilled after a gap so a
  repeated sentence is spoken again. `TripPanel.tsx` (`aside` "Trip"; heading takes focus on mount; a down chevron instead of × collapses it to a bar, `tripBarText`'s From → To, in the same aside, body hidden and kept; tapping the bar expands it; the header Trip button closes a shown panel, collapsed or not, and reopening starts expanded; `useScrollHint.ts` a "more below" fade
  while the capped panel scrolls) with `TripEnds.tsx` (From/To rows take focus, then open their own `StationSearch`; a shortcut that fills an
  end returns focus to that row; "Nearest to you" never offers a From equal to To; "On the map" is not offered, nor announced, for
  a station sharing a complex with an end, `isTripEnd` in `lib/tripEnds.ts` over the App's `siblingIdsOf`) and `TripJourneys.tsx` (disclosures, first open; a
  station name calls `select`, the only camera move; a journey ending on a train ends with `TripExitLine.tsx`, its way out: the
  visible text and note aria-hidden, one sr-only sentence, never a live region; a change through a hand-authored complex has
  `TripTransferLine.tsx` under its "Change at …" row, the same way). The header button's aria-expanded is true only while the panel is in front; pressing
  it when a train or notice covers the panel (or the panel is closed) closes that cover first. Esc moves focus only from inside the
  panel. The trip panel stays mounted (hidden, inert) under a train panel or notice, so its journeys, scroll and focus survive and a
  notice's auto-dismiss never moves focus; only an explicit open, the button, or a deliberate train/notice close focuses its heading.
  The HUD's window Esc handler skips while any `dialog:modal` is open. Nothing typed or located is sent
- `src/data/loadStationIndex.ts` fetches and validates `public/data/stations/index.json` (the ids that have an
  interior; generated by `data:stations`, so nothing is hand-kept; `scripts/lib/stationOutputs.test.ts` checks it
  against the files; authored and generated entries count alike); `loadStationInterior.ts` fetch and outer-shape check; `interiorCache.ts` one promise per id, failures
  evicted (`useEquipmentIndex.ts` reuses it for `stations/equipment.json`); `interiorLoad.ts` the load types (interior and index) and their pure derivation, plus the complex helpers:
  `interiorCovers` (the one test for "this interior is this station's": a member, else `stationId`), `interiorStationIds`,
  `interiorIdOf` (a member id to its complex's file id, via the index), `siblingIdsOf` (the other members); a ready
  model that doesn't cover the station is an error; `useStationInterior.ts` the
  focused station's interior load (the index is fetched once on mount; stations it doesn't list never fetch; it also
  returns `siblings`, the focused complex's other members, empty while the street marker shows); `useLocate.ts` the location button's one-shot
  geolocation (on press only, never watched; the fix lives in React state and nowhere else)
- `src/data/loadStationStreets.ts` fetches `public/data/streets/<id>.json` (contract `src/data/streetSchema.ts`) and
  checks its outer shape; a 404 is null with one warning (cached for the session), other failures reject (evicted,
  retried on the next focus). `useStationStreets.ts` loads the focused station's file on focus only (never at
  startup) into a cached `StreetLayer`: `src/lib/streetBuffers.ts` (pure) keeps the `isStreet` ways
  (`src/lib/streetClass.ts`, which also holds `streetKey`, shared with the entrance join), decimeters to meters,
  mixing to the background over the last 70 m of `radiusM` (`edgeFade`; segments are split at the ramp's ends), plus
  the label sources: `src/lib/streetRuns.ts` (`streetLabelSources`: street ways grouped by `streetKey`, chained into
  runs at shared end nodes while the street turns under 60°, so a dual carriageway is two runs of one label;
  candidates every 40 m, nearest the station first), `src/lib/streetName.ts` (`abbreviateStreet`, MTA style "W 96 St",
  "Park Av S", "Flatbush Av Ext"; `entranceParts` / `entranceLabel`, street first: "Bedford Av & N 7 St · NE corner",
  "Broadway median at W 95 St", "elevator", "exit only", "entry only") and `src/lib/entranceText.ts` (`entranceTexts`,
  the station's labels worded together, client-side only: one order per street pair, avenue-type first; an entrance
  with no cross street names the nearest other street within 60 m, "Broadway · west side at W 94 St" (a median one
  "between W 95 & W 96 St" or "near W 95 St"); two that still match take a compass side of it, "east side · north of
  N 7 St"; same-text entrances within 15 m share one label; head houses chain entrances within 25 m).
  `src/lib/labelGeometry.ts` (oriented screen boxes, separating-axis overlap) and `labelDeclutter.ts` (greedy, by
  priority, sticky; blocked rects packed in a Float32Array) are pure and allocation-free; `streetLabelReveal.ts` the labels' opacity and radius. `fetchJson` throws `HttpError` (with `status`) on a non-OK response
- `src/data/schema.ts`: types of the six `public/data/*.json` files (`Station` carries `borough`, `ada`,
  and `adaPartial` on the 8 partial stations, from 39hk-dx4f via `scripts/lib/stationAccess.ts`); `src/data/codec.ts`: shared
  pure helpers (trip-id parsing, trip/segment keys, delta codec, shape decode). Scripts and client both import these
- `src/data/timetableSchema.ts`: the `TimetableFile` contract for `public/data/timetable/<serviceId>.json` and
  `timetable/dated/<date>.json` (patterns by stop sequence, 30 s units, same-station change rows; its header lists
  the rules a client may rely on; `DatedTimetableIndex` for `dated/index.json`) and
  `timetableCodec.ts` `decodePatternTimes` (pure, `.ts` imports): a pattern's trips to arrival and departure seconds
- `src/data/realtime.ts`: client re-export of the realtime JSON types and `RT_URL`; no fetching
- `src/data/stationSchema.ts`: the `StationInterior` contract for `public/data/stations/<id>.json`,
  `PackedDepthsFile` for `public/data/station-depths.json`, and `StationDepthsFile`, its per-track decoded form
- `public/data/`: preprocessed static JSON (generated; `npm run data`, `npm run data:stations`)
- `public/data/streets/<stationId>.json`: one file per station (`StationStreets`, `src/data/streetSchema.ts`), built by
  `scripts/build-streets.ts` (IO only) from the pin and `catalog/entrances.json`. Pure: `scripts/lib/streetsPin.ts`
  (`loadPin`, `waysNear`), `streetsBuild.ts` (`buildStationStreets`: `clipSpan`, `simplifySpans`, `onewayOf`, packing),
  `streetsEntrances.ts` (the station's entrances: `entrancesByStation` expands a complex's rows to every member by
  `parseComplexOf`; `joinEntrance` from `entranceStreet.ts` and the join log), with
  `streetsFixture.ts` the tests' mini pin. Outside the startup budget; own caps in `scripts/lib/budget.ts`
- `data/basemap/`: `basemap.json` (the NYC basemap's `spec`: bbox, z15, layers kept and dropped; and its `pin`, null until the
  first publish: `asset`, sha256 and bytes of the tarball, `files` and `tileBytes` of the unpacked tiles; a pin without `asset`
  is the old `nyc.pmtiles` format, parsed as legacy and skipped by the deploy) and `source-metadata.20261121.json` (the Protomaps
  metadata the terms were reviewed against, the gate's test fixture). `scripts/lib/basemapSpec.ts` (parse, release tag and URL),
  `basemapGate.ts` (licensing gate over `pmtiles show --metadata`), `basemapFetch.ts` (`ensureTiles`: download, check, unpack,
  swap into place), `basemapUnpack.ts` (`unpackTarGz`), `tarTiles.ts` (`listTarFiles`: our tar reader, an allowlist of
  `tiles/<z>/<x>/<y>.mvt` regular files, so path traversal, links and extensions are refused before any write; chosen over the
  system `tar` because bsdtar and GNU tar differ on those and nothing is written before every entry passes), `tileTree.ts` (scan a
  tile directory: counts, per zoom, every file an MVT), `tileProbe.ts` (tile coordinates, `mvtProblems`, what a correct tile
  answer is; pure, `tarFixture.ts` the tests' tar writer); IO in `scripts/fetch-basemap.ts`, `gate-basemap.ts`,
  `basemap-tiles.ts` and `verify-basemap.ts`. The tiles are never in git
- `public/data/walk/<stationId>.json`: one walk graph per station (`StationWalk`, `src/data/walkSchema.ts`), built by
  `scripts/build-walk.ts` (IO only) from the pin through `scripts/lib/walkGraph.ts` (pure; reuses `clipSpan`/`simplifySpans`/`waysNear`).
  Loaded by `src/data/loadStationWalk.ts` (`decodeStationWalk`: meters, CSR adjacency, per-edge checks, to `WalkGraph`) and
  `useStationWalk.ts` (cached per station). The request names a station, so fetch a shard only for a station the user picked,
  focused or chose as a trip endpoint, never the one nearest a location fix without a user action.
- `public/data/search/streets/<bucket>.json`: 64 street and intersection search shards (`StreetSearchShard`,
  `src/data/searchSchema.ts`), built by `scripts/build-street-index.ts` (IO only) through `scripts/lib/streetIndex.ts` (pure:
  `buildStreetIndex`, `displayStreetName`; reads the pin with `loadPin`, `isStreet` and `streetKey`) and `streetIndexShards.ts`
  (`bucketStreetShards`). Not loaded by the client yet (2q7.14).
- `public/favicon.svg` (also the logo mark) and `public/apple-touch-icon.png`, rendered from
  `data/icons/apple-touch-icon.svg` (thinner strokes for 180 px; rebuild command in its header)
- `data/stations/`: authored station interiors and pinned source extracts (not shipped); see `data/README.md`
  - `data/stations/catalog/`: citywide pinned extracts (stations, entrances, equipment, envelopes,
    osm-platforms, osm-tracks), written only by `scripts/fetch-station-catalog.ts`. Rows are keyed by
    `gtfsStopId`/`stationId`/`complexId`; envelopes have no station key (join by containment or name
    downstream), and OSM ways have none either (join by distance)
  - `data/stations/layout-oracle.json` (tuning, 62 layouts and 13 to decline) and `layout-holdout.json` (30, never tune
    on it): platform type, platforms, tracks, mezzanine per station, agent-checked against English Wikipedia
    (CC BY-SA 4.0, facts only, revision ids); scoring only, not shipped
- `data/streets/`: the street pin (OSM named roads, plus sidewalks, crossings, steps and paths, within 300 m of any
  station), written only by `scripts/fetch-streets.ts`; `manifest.json` (license, query, the station ids fetched for, shard list) and `cell-<lat>_<lon>.json`
  shards, each with its own node table (ways index OSM node ids; coordinates 1e-6 deg). Pure trim and shard layout in
  `scripts/lib/streetsOsm.ts` and `streetsShard.ts`; `fetchJson.ts` is the retrying fetch both pin scripts share
- `scripts/`: `lib/timetable.ts` (`buildTimetables`, `patternsOf`, `buildStationChanges`: pure, used by `build-data.ts`),
  `lib/datedTimetable.ts` (`datedWindow`, `buildDatedTimetables`: the supplemented feed to one file per date; `datedFixture.ts` its tests' feeds),
  `build-data.ts`, `build-access.ts`, `build-stations.ts`, `fetch-station-sources.ts` and `fetch-station-catalog.ts`
  (the only IO) and pure transforms in `scripts/lib/`, tests colocated. `lib/stationMerge.ts` is the station
  merge (its connector half, with the walkway and `area` rules and the containment check, is `lib/stationConnectors.ts`);
  `lib/stationMembers.ts` the complex helpers (`membersOf`, `trackOwner`, `checkMembers`; the client has its own copy
  in `interiorLoad.ts`); `lib/complexFixture.ts` the tests' two-member complex; `lib/stationProvenance.ts` (`markGenerated`: authored to generated, depth sources, archetype and
  confidence) and `lib/stationIndex.ts` (`buildStationIndex`, `NOT_INTERIOR_FILES`) and `lib/equipmentIndex.ts` (`buildEquipmentIndex`, `cleanServing`: `stations/equipment.json` from the catalog) are pure, and `build-stations.ts`
  joins the generated stations to the authored ones (hand-authored wins); `lib/catalog*.ts` trim the catalog fetch (`catalogData.test.ts` checks the committed files)
  - Archetype classifier (offline, nothing ships): `lib/archetype.ts` (`classifyStation`: facts to archetype,
    params, confidence and a reason per deduction; `INTERIOR_MIN_CONFIDENCE` 0.7), `stationFacts.ts` (its input
    types), `stationFactsCheck.ts` (drops or rejects bad geometry), `platformAxis.ts` (PCA axis, [u, v] frame),
    `crossSection.ts` + `platformVote.ts` + `trackSpan.ts` + `platformSides.ts` + `platformFallback.ts`
    (island/side by cross-section vote, track count, curve penalty; `platformLayout.ts` the types),
    `mezzanineEvidence.ts`, `depth.ts` + `deepStations.ts` + `riseParse.ts` (level elevations from E&E rises,
    a cited deep list, OSM level, then structure defaults), `deepArchetype.ts` (`PINNED_DEEP`, the stations always
    called `deep`, and the 60 ft E&E rise above which any station is: no template, no generated interior)
  - Station generator: `lib/generate.ts` (`generateStations`: classify, dispatch to a template, validate with the
    merge; a throw skips the station with its reason; multi-level stations, whose E&E rows name an upper, lower or
    intermediate mezzanine, a concourse or balcony, or join two mezzanines, are skipped for hand authoring) and
    `lib/generatorInputs.ts` (parsed catalog files, shapes and stations to its inputs). `lib/templates/`:
    `context.ts` (frame from the classifier's anchor and bearing, platforms in it), `slice.ts` (the in-memory
    `StationSources` cut from the catalog; never written), `tracks.ts` (`mapTrackLines`; N/S on the two outermost
    platform-edge tracks by the map's direction lines; paths are the OSM way clipped to the platform and 6 m of the
    map line), `slabs.ts` (one rectangle per entrance cluster, within the platforms plus 15 m along and 10 m
    across), `stairs.ts` (street stairs capped at 20 m of plan run, one per landing; slab-to-platform stairs sized
    for the drawn rise; every platform gets a street stair or machine (no mezzanine: from the nearest entrance that
    doesn't cross another platform, else the station is skipped)), `machines.ts` (E&E rows the merge can take, entrance links), `machineSites.ts` (`at`
    overrides; machines of one level pair at one site bank width + 0.3 m apart), `build.ts` (assembly; entrances
    whose stair can't land within the cap are dropped; dropped rows in notes and the log), `subway.ts`
    (`cutCover`, `shallow`), `elevated.ts`; `templateFixture.ts` synthetic one-station catalogs for
    `generate.test.ts`. `generatedOutputs.test.ts` checks the committed generated files are fresh
  - `lib/catalogFacts.ts` catalog to `StationFacts` (platforms go to their nearest station point; complexes
    flagged); `lib/pathwaysTopology.ts`, `layoutOracle.ts`, `archetypeScore.ts` score it;
    `score-archetypes.ts <feedDir> [--oracle file]` prints the report to stdout and writes nothing. The 2021 draft NYCT
    pathways feed it reads must never be committed, shipped, or used as a source; it refuses a dir inside any git work tree
- `worker/`: Cloudflare Worker that serves decoded MTA realtime as JSON at `/rt`, the trimmed E&E outage
  list at `/ene` (equipment code, reason, since, returnAt; the client re-export is 2q7.21), and `/geocode` (NYC GeoSearch
  then Photon, merged, at most 8 `{label, kind, lat, lon, source}`)
  - `src/schema.ts` the JSON contracts (types and consts only); the client re-exports the `/rt` one (`src/data/realtime.ts`
    will re-export the `/geocode` types in 2q7.16, not yet)
  - `src/index.ts` routing (a `Map` of path to handler: `/rt` and `/ene` are `CachedRoute`s through `serveCached`, `/geocode`
    goes to `serveGeocode`; `/rt` 15 s, `/ene` 120 s), CORS;
    `serveCached.ts` the per-route memo, Cache API layer and herd guard (`serveCached`, with a 15 s backoff after a failed
    refresh; its `x-rt-cache` and `x-rt-expires` header names are shared by both routes); `cache.ts` pure memo/herd-guard
    decision and the per-route TTLs; `upstream.ts` feed and outage fetches (`fetchBytes`: 5 s timeout, 2 MB cap; `readBody`
    takes its cap); `edgeCache.ts` the Cache API read and write both routes share (`EdgeCache`, `readEdge`, `writeEdge`)
  - `/geocode`: `serveGeocode.ts` (IO orchestration, never throws: 403 unless an allowed Origin, 400, the per-isolate LRU, the
    edge cache, then the sources: GeoSearch first and Photon only when it had no place-like hit (an address hit satisfies a
    house-number query), or both at once for a query that looks like a business; only complete answers are cached, a source
    that timed out, failed to connect or answered 429 or 5xx is skipped for 30 s, 503 `busy` (with `retry-after`, exposed to CORS)
    when nothing may be called; one `geocode-miss` log line, counts and fixed codes
    only, never `q`, the focus or a label); `geocodeQuery.ts` / `geocodeText.ts` (parse, normalize, key, heuristics);
    `geosearch.ts` / `photon.ts` (the pure trims; Photon rows for transit, another state or country dropped) over
    `geocodeCandidate.ts`; `geocodeMerge.ts` (dedupe: PAD aliases, cross-source twins; rank); `geocodeOutcome.ts` (status,
    attribution, `incomplete`, the log line); `rateLimit.ts` (per-isolate token buckets: 20 at 2/s overall, 5 at 0.5/s for
    Photon); `lru.ts` (`TtlLru`, 500 entries, 1 h); `geocodeUpstream.ts` (3 s timeout, 256 KB cap, descriptive User-Agent,
    fixed error codes only: a fetch error's text can hold the query)
  - `src/transform.ts` pure decode-to-snapshot logic; `ene.ts` pure E&E transform (`parseNyTime`,
    `transformEne`; the feed's `isupcomingoutage` is unreliable, so it is ignored: a row is skipped only if it has
    not started yet); `cors.ts` allowed origins
  - `src/gen/` generated protobufjs decoder (`npm run gen`); never hand-edit
  - `proto/subway-rt.proto` trimmed subset of gtfs-realtime + nyct-subway
  - `fixtures/` recorded feeds for tests (see its README; `ene.json` is the E&E sample, `geocode.json` the GeoSearch and
    Photon answers)
- `docs/research/`: research notes (`data-sources.md`)

## Hard rules
- Hand-written source files stay at or under 300 lines (aim for 200). Split before exceeding.
  Exempt: generated JSON in `public/data/` (one entry per line so refresh diffs stay small) and
  generated code in `worker/src/gen/` (CI regenerates it and fails on any diff).
- Tests only where they verify real functionality: pure logic and data transforms.
  No snapshot tests, no component tests by default. Colocate as `*.test.ts`.
- No backend, except the `worker/` realtime proxy. The site is static.
- Static data is preprocessed into small JSON under `public/data/` by scripts in
  `scripts/`. Never ship raw GTFS or other large source files.
- No ESLint/Prettier, routing library, or state library until there is a reason.
  React state/context is enough.
- Named exports, interface for props, no `any`, no silent error handling.

## Rendering conventions
- One r3f scene for both the map and station interiors.
- Scene units are meters. x = east, z = south (north is up top-down), y = up.
  Convert lat/lon only through `src/lib/projection.ts`.
- Every color, line width, and font comes from `src/theme.ts`. Never hardcode them.
- The Canvas is `flat` (no tone mapping), so theme tokens render exactly as written.
  HUD uses Tailwind tokens (`bg-panel`, `text-ink`, ...) backed by theme CSS variables.
- Camera polar angle is a pure function of zoom distance (`src/lib/tilt.ts`): `ISO_POLAR × tiltT(d)`. The same
  `tiltT` is `depthFactor`, the one parameter for every drawn depth (track profile, car height, ties, interior
  levels, veil, level labels), so depth only shows as the camera tips: 0 top-down, 1 (the authored ×yScale) fully tilted.
  The zoom stages, by camera distance: above 2400 m dots and station markers; 2400 to 1600 m dots unfold
  into flat true-length footprints; the tilt runs from 1450 m (top-down) to 400 m (isometric, `nearDistance`), with a
  short ease-in to about 1340 m and a long ease-out (two parabolas joined with equal slope at `easeIn` 0.06 of the
  log-distance span), so it shows from about 1250 m (9°; 25° at 1000 m, 38° at 800 m); 1250 to 1000 m the interior
  fades in as a flat plan (depth 0.17 to 0.46, a level gap of about 5 px on a phone at most); 1000 to 400 m the levels
  separate and the veil and labels come in; at 400 m everything is full 3D.
  The user may rotate (right-drag, shift/ctrl/meta+drag, two-finger touch) only while a station is
  focused or a train is followed (focus engages inside 1250 m within 140 m of a station once the view has held still for 400 ms
  (`ENTER_DWELL_S`: target and distance within 0.2% of the distance, no gesture active, and a gesture's end
  restarts the wait), so a pan across the city opens no panels; it drops at once past 1450 m, where the view is top-down, or 350 m away;
  taps and flights focus immediately; `focusMachine.ts`): |azimuth| is capped by tilt, rising from 0 top-down to π at tiltT 0.67 and a full spin
  (azimuth bounds ±Infinity) from there, and the turn pivots on the focus point
  (the interior's mid-depth center, or a bare station's point, at the middle of the free area).
  The focus point pans within the interior's reach (farthest outline vertex or entrance from its plan
  center) + 20 m (100 m of a bare station; 180 m at most), with a soft edge (`src/lib/orbitLimits.ts`), so
  on a phone a drag can bring every part of the interior to the free area at any angle. The pan clamp applies
  only from tiltT 0.5, about 970 m (further out a pan is free), and arms only once the view is inside the radius. Dropping focus (zoom out,
  close the panel) springs the view back to north-up the short way round (an exponential ease capped at
  180°/s; under prefers-reduced-motion it snaps to north-up at once), so the city and top-down views
  are always north-up. `enableRotate` stays on; the azimuth bounds alone stop a turn (toggling it
  mid-gesture applies a stale rotate start). A gesture turns the view only if it was armed at its start
  (`rotateArmed`: focused and tiltT ≥ 0.5, set by `onStart`, cleared by `onEnd`); otherwise `rotateSpeed` is 0
  for all of it, so an unarmed gesture never turns the view: a pinch that starts unfocused or nearly top-down
  doesn't, whatever its fingers do. Each new contact (a second finger down fires `onStart` again) re-checks the
  arming. On touch the controls never turn a two-finger gesture (`rotateSpeed` 0 for touch); `useTouchOrbit.ts` follows the two
  live touches and `src/lib/touchOrbit.ts` locks each gesture once: to zoom when the spread changes by 15% (checked first), else,
  armed only, to rotate on a 12° twist or a midpoint slide of 40 px plus the spread's change. Under the rotate lock the view
  turns by the twist (a clockwise twist turns the content clockwise) plus the slide as before (-2π · dx / height), the whole
  turn since the gesture started. Moves only move an unwrapped goal, clamped to the azimuth window on the turn nearest the
  last goal (the damped view may trail it by over π); a -2 frame applies it through `setAzimuthalAngle` (which runs a controls
  `update()` itself) only on a frame where a move changed it, once however many moves
  came in (so the controls' damped lag and glide stay, and fingers held still never pull the view back against a fly-to). `zoomSpeed` is 0 until the lock ends (not under `?twist=both`), so a mouse
  wheel on a touchscreen laptop doesn't zoom either until the lift (or a mouse or pen press, which also forgets the fingers). A third finger, any lift or a cancel ends it, a new
  first touch forgets every finger (a lost pointerup can't count a stale one), and only a later touch making exactly two
  fingers down starts the next. A pinch with modest drift turns nothing.
  A bare station pivots on its own point while that point is within its 100 m pan radius of the free
  area's middle, else on that middle, so a far-off or held station can't swing the view away. Markers and dots rescale with distance
  (`screenScale`) so they stay legible when zoomed out.
- Every `on*` handler passed to `MapControls` (today `onStart` and `onEnd`) stays referentially
  stable (`useCallback` + refs): a changed handler makes drei dispose and reconnect the controls,
  which can lock them mid-drag. Set control limits imperatively in `useFrame` (priority -2, before
  drei's `update()` at -1; the pivot and pan clamp at -0.5; the band view at -0.25), not as changing props. Never use a
  positive `useFrame` priority (it takes over rendering). The frame order: -3 LiveTrains steps every slot and writes
  the follow anchor (with the last frame's band view); -2 CameraRig (the follow's `beforeFlight`, the flight step,
  focus, the polar lock), the touch twist's goal (`useTouchOrbit`) and the orbit's bounds; -1 drei's `update()`; -0.75 the train follow; -0.5 the orbit's pivot
  and pan clamp; -0.25 the band view; 0 the draws (and `useBasemapTiles` reading the camera, read-only).
- Selecting a train follows it (`useTrainFollow.ts`): a flight retargeted each frame to the moving train, at the
  distance where its consist spans 80% of the free width, held to 400..600 m (`followDistanceFor`; a desktop stays at
  400), never started over another flight. Then at -0.75 `stepFollow` moves target and camera by one step so its dot
  sits mid-free-area (`followTargetInto`, exact under perspective) through a critically damped 0.35 s lag that tracks
  the train's velocity too: steady travel and stops settle exact, a departure or a catch-up glide is rounded off (a few
  px at most). It never passes the train along its last direction of travel (no overshoot at a stop), reads at most
  `FOLLOW_MAX_GOAL_MPS` (a glide's peak plus a train's top speed; a faster frame-to-frame move is eased as position
  error), and after a flight starts at the speed the train was seen moving during it. Wheel zoom (zoom-to-cursor is off while following) and turns keep it there, and a turn pivots on it
  (the orbit's pivot and pan clamp stand down; turning is armed as if focused, and counts as the first turn).
  Discontinuities (a flight cut short, a panel resize, a cut in the anchor) become a catch-up offset easing out at 5/s
  (snapped under reduced motion); a cut over 100 px on screen re-flies at the current zoom. A pan of 8 px in one
  gesture (16 px on touch, so a pinch's staggered release doesn't count; the pointer type is read on the element the
  controls listen on) ends the follow; the train stays selected and
  keeps the azimuth (a selected train holds it like a focused station; clearing it with no station focused springs
  back to north-up). Esc, ×, a station pick or search choice (they clear the train), the panel's Stop and the
  location button (`unfollow`) end it too. Auto-focus never enters while following; its exits still apply.
- Overlay layers (lines, markers, trains) are `transparent` with `depthTest={false}` and
  an explicit `renderOrder` from `src/scene/renderOrder.ts`: focused station's streets 0.35 (7.5 above the veil
  while the interior is loaded under look A; TEMPORARY `?streets=` forces either), basemap park 0.36, water 0.37, path 0.38, minor 0.39, major
  0.40 and highway 0.41 (all depthWrite off too, since cars on a station ramp run below the street), lines 1, station tie 1.5, line focus 2,
  you-are-here accuracy disc 0.5 and edge 0.6, station fill 3, station ring 4, train halo 5,
  car halo 5.5, trains 6, the selected train's outline shells 6.03 (rim) and 6.06 (gap) while the other trains are still dots
  (carMix below 1; painted before any body, which covers their inside), otherwise 6.51 and 6.52 (after the bodies,
  depth-tested against them), selected train rim 6.1, halo 6.15 and dot 6.2, you-are-here halo 6.4, cars 6.5,
  you-are-here reticle 6.55, street-file entrance marks 7.6 (above the veil at 7, under the interior strokes),
  above-veil platform cars 9.45 (footprints), 9.5 (bodies), then 9.51 (selected rim shell) and 9.52 (gap shell),
  at a multi-deck interior the band between decks 9.53 (fine) and 9.54 (strong) and the next deck's cars 9.55 to
  9.565 (a third deck: 9.57 to 9.595; `strokeOrders`, `spanCarOrders`),
  the trip's exit path over each stroke band, under the next deck's cars (`strokeOrders(...).exitPath`: 9.3 band 0,
  9.545 and 9.578 the mid bands, 9.8 the top band),
  interior levels above the lifted trains 9.6 (fine) and 9.7 (strong), focus ring 10 (`FocusRing.tsx`, `theme.stationFocus`, only for a focused station with no interior).
  The focused station (picked or auto-focused by zoom), and the other members of its complex once the interior that covers them is loaded, draw no marker and no
  station tie: its panel and interior mark it, and it stays pickable.
  The one depth-tested layer is the car bodies (depthTest and depthWrite on, still `transparent`): at iso
  tilt a far car would otherwise paint over a near one. It is safe because nothing before it writes depth and everything after it (veil, interior) has depthTest false.
  The above-veil platform car bodies (9.5) test and write depth too: they copy their street cars' matrices, so
  they pass where those drew and a nearer street car stays in front. The selected outline shells (street and platform)
  test depth but never write it, and so do the platform car footprints of every deck above the deepest (9.55, 9.58).
  three.js draws all opaque objects before all transparent ones, so `renderOrder` only sorts within a list; depth precision is too coarse at map
  zoom for z-offsets to work.
- All route shapes draw as one merged `LineSegments2` (one draw call, per-vertex colors in linear
  space via three's `Color`). Buffer order is the overlap rule: non-primary shapes, then
  route_sort_order. A variant's stretches under its primary are left out (`variantCover.ts`): the primary draws
  the same pixels after them. Don't add per-route `<Line>`s.
- Routes sharing a corridor draw as side-by-side bands `theme.bandPitchPx` apart on screen at any zoom and tilt.
  Each shape point carries band inputs (`ShapePath.bandInputs`: miter, slot and half-width, from corridors.ts via
  networkBands.ts) and the vertex shader moves it along its miter normal by `bandShift` (`src/lib/bandOffset.ts`);
  `BAND_GLSL` in `bandLineMaterial.ts` is its GLSL twin, so change both together (`bandGlsl.test.ts` pins the GLSL
  and checks a port of it against `bandShift`; they agree only while the line object's world matrix is identity).
  Until the two direction tracks have room on screen for both bundles, the same shift pulls them onto the
  centerline. The buffers keep the unshifted points. Trains ride the bands: dots, cars and picks are placed only
  through `trackPointInto` (`src/lib/live/trackPoint.ts`) plus the slot's shape-change offset (`shapeCarry.ts`),
  never `pointAtDistance` on the raw line. Anything else
  that must sit on a route line goes through the band line material (as the platform fade does) or trackPointInto.
  The corridor search runs after the first paint, in a Web Worker (`src/data/loadBands.ts`; on the main thread when
  idle if the worker fails, logged): useNetwork's ready state carries `bands`, a promise of the banded shapes. The
  map draws the unbanded shapes until it resolves (a pitch of 0 draws exactly as no bands, so the swap is
  invisible and the bands then ease in), and the realtime join waits for it, so trains only ever ride the bands.
- Each shape draws `trackOffsetM` to the right of its own travel direction (`trackLine` in
  `buildNetwork`), so the two directions are parallel tracks; zoomed out the pair reads as one line.
  The offset is `TRACK_OFFSET_M` (4.7 m, measured at Bedford Av); code that needs it reads `network.trackOffsetM`. Live trains ride the same `trackLine`
  (`network.shapeById` passed through `useLive` to `buildShapeGeometries`), so dots and cars sit on their direction's track.
- Tracks follow a vertical profile y(d) per shape (`trackProfile.ts`), and the lines and the trains share it:
  `ShapePath.y` feeds the line buffers, the shapes go through `useLive` to `buildShapeGeometries`, and
  dots, cars and picks take `profileAt` × `BandView.depth` through trackPointInto (never blended by interior opacity);
  the line layers draw it with `scale.y` = the depth factor (floored at 1e-3, `depthScaleY`), and car height
  (`CarFrame.extrude`) and the pick roof scale by it too, so cars are flat footprints top-down. It is anchored only at
  stations with an interior, authored or generated (`station-depths.json`, decoded): flat at the rail height (`level.y - RAIL_DROP_M`, × the interior's yScale)
  along each platform track a shape rides (route serves the station, direction is the stop suffix, both track
  ends within 6 m), smoothstep ramps at a 3% average real grade (horizontal true, so 340 m for Bedford Av's
  10.2 m) to 0, and 0 everywhere else. Close stations ease from one depth to the next. Ramps get the fewest
  vertices that keep the drawn chords within 0.5 m of the ease (`rampSampling.ts`, densest where it curves most;
  flat runs add none), and the platform fade one per ramp end; trains take y on the drawn chord between those vertices
  (`trackPointInto`), so they sit exactly on their line. Top-down everything is flat.
- Station markers are instanced: matrices are rewritten only when the scale or focus changes.
- Picking is screen space, on click only: `ScenePicker` listens on the canvas (never stopping or
  preventing MapControls' events; multi-touch and moves past 6 px mouse / 10 px touch are not clicks),
  projects stations (22 px) and live trains (16 px, dot or car line, read from the slot table) to pixels,
  and a station wins unless a train is 6 px closer or the station is the open one or a hidden sibling of its complex (`hiddenSiblings`, passed to `choosePick` and `trainHitPx` as a set of indices with the open station; a direct tap on a hidden sibling with no train in reach still picks it). A station's target grows
  to its drawn marker at close zoom; a touch with no station in reach (the open station and its hidden siblings, whose markers are hidden, don't count) gets 22 px
  for trains; cars are tested
  along their floor and roof lines. No meshes carry r3f pointer handlers.
- Live train dots and cars are instanced too, with per-slot colors (`routeLineColor` like the lines; car
  instance `slot * MAX_CARS + c`). Their per-frame
  path (`useFrame` in `LiveTrains.tsx`) must not allocate or throw: errors there bypass error boundaries.
- The station interior is a group at `toGround(anchor)` with depths drawn ×2 × the depth factor (the group's
  `scale.y`; x/z true and never rescaled, since dashes are object-space; labels give real depths). Merged `LineSegments2` (fine, then strong strokes, a pair per stroke band below) are built from the deepest
  level up, so upper levels paint over lower ones; levels farther from the street (in level count; deeper, or
  higher at an elevated station) mix toward the background (`src/lib/interiorFade.ts`). The camera aims at the
  interior's mid-height, halfway between its lowest and highest level. It fades
  in between 1250 m and 1000 m (`interiorReveal.ts`), as a flat plan while the camera is only slightly tipped. A background-colored veil (render order 7) dims every street
  layer, live trains included, in one draw call, at `veilWeight` (opacity × depth factor, `interiorReveal.ts`);
  level labels show by `labelOpacity` (gated between depth 0.35 and 0.65); the interior draws at 8 (fine) and 9 (strong);
  look C uses -0.6 and -0.3. Trains on the revealed station's platforms
  are redrawn above the veil and the strokes of their platform level (`SpanCars.tsx`, 9.45 to 9.52; not in look C),
  and the levels above it draw over those trains. A deck is a level with a platform track (`interiorDecks`, deepest
  first); level i draws in stroke band `strokeBandOf(i, decks)`, the number of decks deeper than it, so band j is deck
  j and the levels between it and the deck below, and deck j's lifted trains draw right after band j: band 0 at 8/9,
  the top band (above the shallowest deck) at 9.6 (fine) and 9.7 (strong), the bands between decks in between
  (`buildInteriorBuffers`' `decks`, the model's `mid` layers). A stair, escalator or elevator shaft rising from one
  band to a later one is cut at each lower deck's train roof (`bandCutYs`, `trainRoofY`: rail ×yScale plus the car's
  floor and body height from `src/lib/carDims.ts`, not exaggerated; nested `SplitAtY` in `interiorSegments.ts`), so a
  car in front of a stair foot hides it and the stair above the roof draws over the car (an elevator's stop stays with
  its level's band). The cut is by height alone, so a foot behind a car is hidden too. The lifted trains split by deck
  the same way: each span carries its track's `stopId` (`ProfileRun.stopId`), the model's `trackDecks` maps it to its
  deck and `deckSpans` (Scene) gives each deck's SpanCars layer its own spans; above deck 0 the footprints test depth,
  so where decks cross on screen a farther deck's footprint never covers a nearer lifted car. At Union Sq (635) the L
  draws over the Canarsie deck and under the Lexington and Broadway deck, whose trains draw under the mezzanine; every
  other shipped interior has one deck and draws exactly as before. At most eight interior line layers (two per band);
  look C doesn't split. Every car within
  `TRAIN_RAMP_M` (40 m) of a platform span (`network.platformSpans`, the profile's kept runs) is copied, mixed
  toward the background after shading by `veilTint` (veil opacity × veilWeight × (1 − weight), look A only), so a car
  leaving the platform matches the veiled street cars. Along the platform the map track fades out with the reveal
  (the route lines' alpha times 1 − weight × reveal in the band line shader, the weight easing back to 0 over the
  last 10 m; `platformMask.ts`), so only the interior's track shows there. Mezzanine guides and a
  street-level copy of each mezzanine outline give a street reference. A click centers the interior
  beside the station panel at the tilt's near distance, in full 3D (on a phone turned so the platforms run nearly
  up the screen); a station flight to an interior with a priority frame (`pathFrame.ts` `priorityFrameOf`: with the trip
  panel open the trip's path there, its way out or a change of trains, then the machines out of service, `outageFrame.ts`; wanted in that
  order: path marker ends at rail height, the centerline, the machines' ends, the outline per level, an
  exit's walk) lands as usual when that already shows the whole path and every machine, else on `freeFrame`'s frame of it (400 to 600 m, the
  target within 100 m of a member) when that shows more of the path, or as much of it and more machines (`priorityLanding`); under the
  TEMPORARY `?landturn=half` (`landingLook.ts`), deciding its landing turn it also tries half a turn round and takes that when it shows
  more by the same rule (`priorityTurn`). Above a phone's panel the target sits 130 m or
  more toward the camera from what the free area shows, so at Union Sq the Lexington and Canarsie paths, and the station-house
  machines at Pelham Pkwy (211), can't be framed within 100 m looking north and land as usual, part of them under the panel
  (with `?landturn=half` they land half a turn round, where the far side fits; `pathFrame.data.test.ts`, `outageFrame.data.test.ts`; a phone panel with the outage list expanded leaves too little free area
  for any frame); a bare station lands with its point and as many entrance marks as fit in the free area above the panel, at that distance or farther (to 600 m), its target within 100 m of the station (120 m when only the station fits; `bareStationFrame` in `freeFrame.ts`; streets loading late reframe after landing like an interior). Both
  retarget mid-flight when the interior, a bare station's streets (or the index, for a deep link) or the panel's final size arrives. An interior arriving after 90% of the
  flight, or after landing, is framed after landing by a 0.6-1 s eased flight that decides the landing turn then,
  unless a gesture, another flight, a follow or a focus change came first (`useInteriorReframe.ts`,
  `interiorReframe.ts`). Under prefers-reduced-motion station and point flights snap with no turn, and a late
  interior snaps once onto it, no turn. The
  location button frames its fix at EXIT_DISTANCE (1450 m, top-down, outside the focus range) or farther.
  The level labels sit at z-index 0 in the canvas container, so they stay under the HUD panel.

## Station interior format
`public/data/stations/<id>.json`, type `StationInterior` in `src/data/stationSchema.ts`. Built by
`scripts/build-stations.ts` from the hand-authored `data/stations/<id>.authored.json` plus pinned OSM,
NY Open Data entrance, and E&E extracts (`<id>.sources.json`).
- Render in a group at `toGround(anchor)`. `x`/`z` are local meters (east, south); `y` comes from
  `levels[].y`, relative to the street (0), negative below and positive above (elevated stations). Levels are
  sorted high to low.
- `platforms` are OSM outlines (level + open ring) plus `tracks`, one centerline per served child stop.
  `slabs` are mezzanines and other walkable floors (`paid: true` marks one inside fare control; absent = not stated).
- A station complex is one file named after its lowest-sorted member (`stationId`; Union Sq is `635.json`, members 635,
  L03, R20) with `memberStationIds` (every member, sorted, 2+, `stationId` first; absent for an ordinary station). Track
  stops may belong to any member. Authored only; a generated interior for any member is dropped. No complex ships yet.
- `connectors` (stair, escalator, elevator, ramp, walkway) have `lower`/`upper` endpoints `{x, z, level}` and a
  `width`. An authored `at` end may carry `area`, the id of the platform or slab it stands on (checked against that
  area alone; never on a street end). A walkway (authored only) joins two different areas on one non-street level:
  both ends `at` with an `area`, a plan run of 1 m or more, and no lower-below-upper rule. A walkway draws as two flat sides (`drawWalkway`). An authored connector may carry `osmRef` ("way/N" or "node/N"; the merge checks an authored end within 1 m of that pinned element and adds `osm` to its sources; the client ignores it). Elevators and escalators use the MTA equipment code as `id` ("EL358"), the join key for
  outages. Elevators, and escalators from the E&E inventory, have identical x/z at both ends (the renderer
  gives such an escalator a 30 degree run; when an entrance lists it and it sits there, its street end is pinned
  at the entrance: the upper end below ground, the lower end at an elevated station). An escalator override's
  `ends` (escalators only, instead of `at`) gives it a run of its own; generated escalators always have one, sized
  about 30 degrees at the drawn rise (`DRAWN_Y_SCALE` in `scripts/lib/templates/stairs.ts`, kept equal to `?interiorY`).
- `entrances` are street-level points (raw NY Open Data type, entry/exit) listing the `connectors`
  that reach them. An entrance is whichever connector end sits on the street level: the upper end below ground,
  the lower end at an elevated station (street 0 is the lowest level; the other levels have positive `y`). The
  same holds for an E&E machine's `entrance` override (one of its two levels must be the street). The merge
  requires every entrance to have a connector and lists each connector under at most one entrance.
- Every element has `sources` (`osm`, `nyopendata`, `authored`, `generated`). The file is marked ODbL 1.0 and
  carries `attribution`. Licensing is split: OSM-derived parts are ODbL, `nyopendata` elements, and level heights whose
  `depthSource` is `ee-rise`, are MTA data under the OPEN-NY Terms of Use, and `attribution` says so (`OPEN_NY_NOTE` in `stationMerge.ts`).
- An authored interior may set `approximate: true` (whole file) and `approximate: true` on slabs (a rough trace): the
  panel says "Estimated layout" for the file flag, and an approximate slab's outline and guides draw dashed (platforms
  stay solid; the layer material is dashed when any slab is). An authored non-street level may carry `depthSource`,
  which gives its label the generated rule ("-4.3 m" for `ee-rise`, "≈ -9 m" otherwise). The merge rejects a non-`true`
  flag, an unknown source and one on the street.
- `generated` (`{ archetype, confidence }`) exists only on template-generated interiors (absent = hand-authored);
  generated interiors use `generated` in place of `authored` in `sources`. Their non-street levels carry
  `depthSource`: only `ee-rise` is measured, the rest are estimates (label "≈", see `levelHeightText`). The panel
  says "Estimated layout" for them. About 250 are committed, shown to everyone.
- `public/data/stations/index.json` (`StationIndex`) maps each station id with an interior file to its
  `provenance` (`authored` or `generated`); every member of a complex but its first adds `file` (the first member's id:
  its interior is `stations/<file>.json`), validated as a plain id naming a listed non-alias entry. The client fetches it on mount, after the startup files and not
  render-blocking, so it is outside the 60 KB startup budget and has its own cap (the build fails above 8 KB
  gzipped); a station not listed never fetches an interior, and until it loads (or if it fails, retried on the next
  focus change) no station shows an interior panel. The object's key order lists integer-like ids first; don't rely on it. `index` and `equipment` are not valid station ids (`stations/index.json` and `stations/equipment.json` share the directory).
- `public/data/stations/equipment.json` (`EquipmentIndexFile`, `src/data/equipmentSchema.ts`, format 1) lists every revenue
  elevator and escalator of the pinned E&E inventory by equipment code (`machines`: `kind` and the inventory's `serving` text, cleaned,
  never truncated) and, per GTFS station, the codes of every machine in its complex (`stations`: a complex's machines under every
  member; a station with none has no key), so the panel can name an outage at a station whose interior doesn't draw the machine. It
  carries the inventory's `rowsUpdatedAt` and no build time (the freshness test compares it exactly), and is MTA data under the OPEN-NY
  Terms of Use (no OSM content). Fetched on the first station focus and only while `/ene` is configured, so it is outside the 60 KB
  startup budget with its own cap (the build fails above 16 KB gzipped; 13.0 KB today). Non-revenue machines, machines with no
  station and codes the Worker's `/ene` reader would reject are left out and logged. Key order is not an API.
- `public/data/station-depths.json` (`PackedDepthsFile`, format 2) is packed from every interior, authored and
  generated, by the same build (`scripts/lib/depthsPack.ts`), small enough for the startup budget. A complex file
  contributes one entry per member (each track goes to the member whose id is the longest prefix of its stop).
  Columns, one entry per station: `station` (stations.json index, delta-coded), `y` (rail height = platform level y - RAIL_DROP_M, in
  decimeters), and in whole meters along the drawn line of the stop's direction nearest the station's stations.json
  point, from that point's projection d: the N track runs d + `a` ± `h`, the S track d - `a` + `da` ± (`h` + `dh`).
  `tracks` overrides a stop the columns don't reproduce with its own `[y, x, z, h]` (centre in meters from the station
  point, decoded onto the nearest line of its direction within 15 m), or `null` for no track. The encoder decodes every
  choice and checks the runs `profileRuns` finds against the full per-track ends (`PACK_TOL_M`, 2 m; the committed file
  is checked to 3 m by `depthsPack.test.ts`). `feedVersion` is stations.json's at packing time: on a mismatch (a stale or
  mixed deploy) the decoder logs one error and returns no depths, so tracks stay flat and the map still loads; a
  malformed file (bad index or delta, non-number value, override not four numbers) throws. Since ends land on a drawn line, a sibling shape that just missed the 6 m
  match may ride too. ODbL, with the union of the interiors' credits minus the OPEN-NY note, plus its own line
  ("Some railY values come from E&E rises and are MTA data under the OPEN-NY Terms of Use") only when a platform
  level's `depthSource` is `ee-rise`. It depends on stations.json and shapes.json, so rerun `data:stations` after `data`.
- Authoring uses a `[u, v]` frame aligned to the platform; the merge converts it. Guesses are marked
  `UNVERIFIED:` in the authored file's `notes`; they are not copied to the output.

## Agent model routing
- opus: planning and architecture
- sonnet: implementation
- opus is also fine for three.js modeling work (station interiors, geometry)

## Work tracking
Track work in beads (`bd`). File tickets in Breakdown, not GitHub issues. Include a
description and an acceptance criterion on create.

## Review
Every change gets a `reviewer` agent pass. When the review is critical, file the
findings for the user as review cards on the work item's bead in Breakdown. Hold the
merge until they decide.
A review is critical when:
- it finds a blocker or a should-fix,
- the change touches deploy/CI, the data pipeline, the CORS worker, or licensing, or
- it involves a look or feel decision.

How to file:
- Open a draft PR first so the cards can link to it.
- Write one decision card per finding: a markdown file with frontmatter `question`,
  `options`, `recommend`, `on_accept`, `key`. The body is the evidence with file:line,
  at most 300 words.
- File them with `review-request <bead-id> a.md b.md …` (up to 6 per call). The format
  is in `~/.claude/skills/context/visual-review.md`.
- Never use the Breakdown inbox (`brain_write` inbox items) for reviews.
- Group nits into one card. Only the top-level session files cards; subagents write
  cards and return their paths.
- Fallback: until this checkout is registered with Breakdown, `review-request`
  refuses. Put the question, options and recommendation in the session report
  instead, and still hold the merge.

Reviews with nits only can be fixed in-loop without filing.

## Data
Sources, sizes, and terms are in `docs/research/data-sources.md`. Constraints:
- **The client never fetches MTA servers directly.** The MTA terms require serving
  through a non-MTA host, even though the feeds send ACAO `*`. Realtime goes through
  the `worker/` proxy, which returns decoded JSON with a 15 s edge cache (outages at `/ene`: 120 s).
- **The client never fetches GeoSearch or Photon directly; addresses and places go through the Worker's `/geocode`.**
  `q` is never logged (custom logs carry counts only, invocation logs are off, query strings are redacted, never enable
  traces). Its responses are `Cache-Control: no-store` (the 1 h cache is server-side only, so no typed query reaches a
  device's disk cache) and carry no `x-rt-cache` header (it would be a cross-user oracle for recent searches). `focus` is the map
  centre or a chosen station, never the location fix; the Worker rounds it to 2 decimals and drops it outside the NYC bbox.
  Answers carry `attribution`, which the UI must show beside the results (2q7.16). Upstreams see the Worker, never the
  client's IP or headers. `/geocode` refuses a request with no allowed Origin (403).
- **Walk shards are fetched only on a user action.** `data/walk/<id>.json` reveals its station id to the static host, so
  `useStationWalk` is called only with a station the user picked, focused or chose as a trip endpoint (never `nearestStation`
  of a fix); no request carries the fix or the destination, and routing runs on the device.
- **Trip exit.** Once a plan for the trip panel's ends is ready, `src/data/useTripExit.ts` loads the To station's interior
  (`useInteriorModel`, the focused interior's cache) and street files (the interior file id's and, for a complex, the
  alighting member's; `useStationStreetsLoad` tells loading from missing, and the line waits for both). Both trip ends are
  chosen by the user (a swap counts: the new To was chosen as From), so this fetch reveals nothing they did not pick. It
  finds each journey's quickest way out (`quickestExit`, avoiding machines out of service; with no fresh outage data none
  are closed, and the line says the status is unknown only when the station panel would: never while still connecting). The map draws the first journey's (ending on a train) at the To station while the trip panel
  is open, even under a train panel; only once that station is focused. It fetches no walk graph: only the DEV
  `__underground.exitTo(x, z | null)` seam aims it at a point (and loads that station's walk graph) until 2q7.14.
- **Trip transfers.** While a plan is ready, `src/data/useTripTransfers.ts` loads every hand-authored interior in the index
  (`authoredInteriorIds`, `useInteriorModels`; today 635 and L08, under 5 KB gzipped), not only the change station's, because
  the change station is derived from the plan rather than chosen, and fetching it alone would reveal it. Each change whose two
  stops are in one of them gets `chooseTransfer` (machines out avoided as for the exit) and a transfer line; the map draws, per
  interior, the first journey's change there (none when it is across one platform). The router's change time stays transfers.json's (180 s at
  Union Sq). Revisit fetching all of them above about 8 authored files.
- **Location never leaves the device.** The location button makes one `getCurrentPosition` per press (no
  `watchPosition`) and keeps the result in memory only: no storage, URL, log or request carries it. Basemap tiles
  follow the camera, never the fix. After a location fly-to, tiles load no finer than z12 (several km a tile) until
  the user moves the view (a drag past the 6 px mouse / 10 px touch slop, a wheel step, a second finger) or picks a
  station (tap, panel, search); a tap that doesn't move, or the controls' `start` alone, keeps the cap
  (`lib/basemap/locationCap.ts`, fed by `useBasemapTiles.ts`, which sets the cap in a layout effect, so it is in force
  before any frame of the flight, even a reduced-motion one). Following a train or keyboard input doesn't lift it.
  Tiles already loaded still draw.
- **Realtime has no lat/lon.** Vehicle positions are stop-relative, so dots are
  interpolated along shapes from TripUpdate times and scheduled segment run times.
- **Static GTFS is processed at build time only.** `scripts/` turns the regular zip
  into `public/data/*.json` and the supplemented zip into `public/data/timetable/dated/`. The 60 KB gzip budget (`scripts/lib/budget.ts`) is the one size limit, shared by
  every top-level `public/data/*.json` the client loads up front, `station-depths.json` included (59.8 KB today,
  about 150 B of headroom; the depths file is about 1.6 KB of it); `data`, `data:access` and `data:stations` each fail above it. Per-station interiors, street, walk and timetable files don't count (they have their own caps in `budget.ts`: 16 KB gzipped each for streets, 64 KB for walk, a total for each of those two, 48 KB per `public/data/timetable/` file (the dated ones too, plus a total for `timetable/dated/`), and 36 KB per `public/data/search/streets/` shard with a total, 16 KB for `public/data/stations/equipment.json`).
- **Data refresh is automated.** `.github/workflows/refresh-data.yml` runs daily and
  opens or updates one PR on `chore/data-refresh` (its title and body name the dated timetable files, `first..last(count)`
  or `none`; the dated files roll daily, so nearly every day has a PR) when `npm run data`, then `npm run data:stations` (the
  generated interiors follow the new shapes and stations), then `npm run data:streets` (the street files follow
  the stations), then `npm run data:walk`, then `npm run data:search:streets`, change `public/data`. A station new to the feed gets a street file from whatever pinned ways lie
  near it, with a `WARNING:` line in the log (`data:streets` prints it for any station the pin manifest's `stationIds`
  lacks); it does not block the refresh, and the next `data:streets:fetch` covers it. The workflow runs typecheck, tests, and build before pushing, but the
  PR itself shows no check status (GITHUB_TOKEN PRs don't trigger workflows).
- **The NYC basemap (vector tiles for streets, water and parks) is never in git and loads on demand only.** It is a static
  directory of Mapbox Vector Tiles, `basemap/tiles/{z}/{x}/{y}.mvt`: the five boroughs at z0 to z15 (3,820 files,
  about 45 MB inflated), only the earth, water, landuse and roads layers of a Protomaps daily build, cut by
  `.github/workflows/basemap.yml` (manual; go-pmtiles `extract`, tippecanoe `tile-join -l` to drop layers, then `tile-join -pC -e`
  for the directory, each tile then gzipped in place with `gzip -n -9`, keeping the `.mvt` name) and published as one tarball
  (`nyc-tiles.tar.gz`) on a GitHub Release. Tiles built before ost.9.5 are plain; every reader takes both (a body starting `1f 8b`
  is inflated, then checked as an MVT), and the pin's `tileBytes` counts the stored sizes. Nothing reads a byte range: Pages
  gzips a Range answer with a wrong total (measured, `docs/research/data-sources.md` section 6), so each tile is a whole file.
  Pages adds no content-encoding to `.mvt`, so a gzip tile goes over the wire as stored and the basemap worker inflates it
  (`DecompressionStream`); never name a tile `.gz`. `deploy.yml` unpacks the pinned release into `dist/basemap/tiles/` (sha256, size,
  allowlisted entry names, file count and byte total all checked; a null or old-format pin is skipped with a warning), times
  the unpack and the Pages upload in the job summary, and fails above 900 MB; its `verify-basemap` job fetches three tiles from
  the live site with and without gzip offered, and for a gzip tree requires the served bytes to be gzip and the inflated MVT valid. Nothing in the startup files names it, and it is not the walk graph.
  The licensing gate (`basemapGate.ts`) fails the workflow on any credit beyond "© OpenStreetMap" (so never the landcover
  layer, which is CC BY 4.0, nor places or pois); a failure goes to a person as a licensing card. The pin changes only by a
  normal PR. Details and sizes: `docs/research/data-sources.md` §5.3. The client never fetches Protomaps' servers.
  Tiles load on demand (the view's tiles only, after the first frame and an idle callback) and decode in a worker,
  never on the main thread. `__BASEMAP__` (vite.config.ts, from basemap.json) is null while the pin names no tile
  directory, and then nothing loads.
- **Station interiors are hand-authored or generated.** Bedford Av (L08) and the 14 St-Union Sq complex (635, approximate:
  dashed mezzanines, "Estimated layout") are hand-authored and win over a generated one; 253 more are generated from archetype templates (`scripts/lib/generate.ts`) and labelled "Estimated layout".
  Both are merged with OSM platform polygons, NY Open Data entrances, and E&E elevator/escalator data.
- **Attribution.** Credit MTA and show "© OpenStreetMap contributors". Include a
  "may not be real time" notice. Don't use the MTA logo, route bullets, or the map. A `/geocode` answer's `attribution`
  ("NYC GeoSearch, NYC Department of City Planning" for address results; "© OpenStreetMap contributors, via komoot Photon"
  for Photon rows) is shown beside the results.

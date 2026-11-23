# underground

## Purpose
A live view of the NYC subway as a static site on GitHub Pages
(github.com/cazzer/underground). It opens on a zoomed-out, low-fi architectural
wireframe map with small dots for moving trains. Pinch/scroll zooms. Zooming toward
a station continuously tilts the camera from top-down to isometric; later that view
shows the station's levels, stairways, and upcoming arrivals.

Status: the real static network (every route shape and station from `public/data/`) renders, a station complex (the catalog's
complex_id: Times Sq with 42 St-Port Authority, Union Sq, Atlantic Av) is one station (one search row, focus and panel; every member keeps its own marker on its line, and a tap on any selects the complex), and
trains are live: the client polls the deployed realtime Worker (`worker/`) and draws dots from the
pure realtime library. The station panel shows real arrivals. Bedford Av (L08) has a hand-authored interior, the 14 St-Union Sq complex
(`data/stations/635.authored.json`, members 635, L03, R20) an authored approximate one from OSM stairs and elevators, and
about 250 more stations have generated ones (labelled "Estimated layout"), shown to everyone since 9wc.5.
Interiors draw by view, not only by focus (o3r.4): inside 1250 m the interiors of up to `MAX_VIEW_INTERIORS` (3, in
`lib/viewStations.ts`; 2, `PHONE_VIEW_INTERIORS`, when the window's shorter side is under 600 px: `viewInteriorCap`; the cap is for a
phone's frame rate) stations in view reveal with no tap or dwell, the focused one first and counted, each easing in and out over
250 ms (`lib/presence.ts`); only the focused one has a panel, level labels, the trip's path, outages and the camera framing. With a
bare station focused (no interior of its own drawn) its neighbours' interiors draw with no veil, so its marker, trains and streets
keep full contrast.
Streets and entrance marks of up to `MAX_VIEW_STREETS` (4) stations in view draw the same way with no tap inside 1250 m, focused
first (o3r.5), each easing in and out over 250 ms; where two 300 m files overlap each street draws once; a neighbour's
entrance marks draw a tier dimmer. Their street and entrance labels place in one declutter pass, focused first (o3r.6), a
neighbour's budgeted (beside a focused station a phone's 1 entrance and 1 street, with none focused 2 and 1; a desktop's 4
and 3) and its entrances dim beside a focused station (full ink with none focused).
With no `VITE_RT_URL` there is no live data (the HUD says "Live trains off") and no fake motion. The client also polls the
Worker's `/ene` (a sibling of `/rt`) and the station panel and interior mark elevators and escalators out of service.
A faint citywide basemap (roads, water, parks from the pinned tile release) draws under the lines for everyone since ost.9.3.
With the Worker configured the search dialog also finds streets, intersections ("Bedford Av & N 7 St"), addresses and places through `/geocode` (2q7.16, 2q7.14; none of it without `VITE_RT_URL`).
Trip planning is behind `FEATURES.navigation` (`src/config.ts`), off by default.

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
- `npm run data [-- --zip path]`: rebuild `public/data/*.json` from the regular GTFS zip
  (downloads it unless `--zip` or `$GTFS_ZIP` is given; needs Node >= 22.18; it never reads the supplemented feed). Never commit a zip.
  Also writes `public/data/timetable/<serviceId>.json` (stop times by stop pattern in 30 s units plus the
  same-station transfer rows; outside the 60 KB budget, each under its own 48 KB gzip cap, fails above it;
  removes a file for a service the feed dropped).
  Also reads the pinned `data/stations/catalog/stations.json` for each station's borough and ADA status, and writes its
  `complex_id` groups as `complexes` in stations.json (`scripts/lib/stationComplexes.ts`: lead first, the member nearest the
  members' centroid, distances within 1 m tying, then more routes, then lower id; `stationComplexes.test.ts` checks the committed
  file is fresh); the router's `transfers.json` goes to `public/data/route/transfers.json` (loaded by the trip planner, outside the
  startup budget, under `TRANSFERS_GZIP_CAP_BYTES`); after `data:catalog:fetch` run `npm run data:access` instead (offline).
  A station the catalog lacks, or an orphan catalog row, needs an entry in
  `data/stations/access-exceptions.json` (see `data/README.md`); the join fails loudly otherwise.
- `npm run data:dated [-- --out dir --zip path --supplemented-zip path | --empty]`: downloads both GTFS zips (capped at 32 MB and
  64 MB; `$GTFS_ZIP` / `$GTFS_SUPPLEMENTED_ZIP` or the flags use local ones; about 2 GB peak memory) and writes
  `public/data/timetable/dated/<YYYYMMDD>.json` (one per date on which the supplemented feed runs different trips than the regular
  one, so work that only removes trains counts; at most 14, not necessarily contiguous) and `dated/index.json` (the dates): the
  day's regular service plus planned work, each file under the 48 KB cap and the directory under
  `TIMETABLE_DATED_TOTAL_GZIP_CAP_BYTES`. The directory is gitignored: every Pages deploy runs this into
  `dist/data/timetable/dated/` and fails open (any failure ships `--empty`'s `EMPTY_DATED_INDEX`, with a workflow warning and a
  summary line; the client then plans on the regular schedule). A failed download, more than 14 such dates, a date that isn't a
  real YYYYMMDD or a stop `stations.json` lacks fails the run, writing nothing, as does any problem `lib/datedCheck.ts`
  finds in the output before it is written (routes, stops and station changes the committed data lacks, bad service ids, an index
  that disagrees with its files, a file the client's `expectTimetable` or `decodePatternTimes` rejects, an overtaking trip).
  Exit 3 is a failed download, 1 anything else; the deploy warns on 3 (or a timeout or kill) and annotates an error on the rest,
  and fails open either way. `--out` must end in a folder named `dated`
  (other `*.json` in it are removed). The baseline and station changes come from the downloaded regular zip, the stops from the
  committed `stations.json`; a differing `feed_version` is a `WARNING:`. `vite preview` of a local build has no dated files
  (planning warns and uses the regular schedule) until you run it.
- `npm run data:access`: offline; reruns the borough/ADA join and the `complexes` on the committed `public/data/stations.json`
  with the pinned catalog and exceptions, prints the gzip total against the budget (a catalog member stations.json lacks throws).
- `npm run data:stations`: (it also fails unless every interior covering a complex member covers its lead, `checkComplexLeads`)
  merge `data/stations/*.authored.json` with the pinned `*.sources.json`
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
  member's trains (not in a complex's lead file, `stations.json` `complexes[i][0]`: the map focuses only the lead, so its
  file stands for the merged station and keeps every member's elevators, 2q7.43), or lies more than 260 m (`radiusM` minus the 40 m edge margin) from the member's point, with one
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
- `npm run data:search:streets`: offline; builds the citywide street and intersection index from the street pin and
  `stations.json` into one file, `worker/data/streetIndex.json` (`worker/src/streetIndexSchema.ts`: about 3,200 streets with a
  site per nearby station, 11,500 intersections as pairs of street indices, and the two-character `keys` that pick a query's
  candidates; the borough is the nearest station's). The Worker bundles it, so the client never loads it and it is outside the
  startup budget. Rerun after `data`, `data:streets:fetch`, a change to the `searchText.ts` synonyms (`worker/src/searchText.ts`),
  `GENERIC_TOKENS` (`worker/src/streetKeys.ts`) or `isStreet`; `streetIndexOutputs.test.ts` fails while stale. Cap in `budget.ts`:
  `STREET_INDEX_RAW_CAP_BYTES` (900,000 raw bytes: a Worker's size limit counts the script uncompressed; 689,437 today, 181 KB gzipped).

Run typecheck, test, and build before reporting work done. Pushing to `main` deploys
via `.github/workflows/deploy.yml` (Actions to Pages), which also runs daily (09:23 UTC schedule: it redeploys Pages and the unchanged Worker) so the dated
timetables, built in each deploy, roll forward; GitHub disables schedules after 60 days without repo activity.

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
- `worker/wrangler.jsonc` has a `ratelimits` entry, `GEOCODE_CLIENT_LIMIT` (namespace_id "2736", 30 per 60 s; Wrangler 4.36+),
  Cloudflare's Workers Rate Limiting binding: `/geocode` calls `env.GEOCODE_CLIENT_LIMIT.limit({ key: CF-Connecting-IP })`. It is
  per Cloudflare location and eventually consistent, not a strict global limit, and not visible in the dashboard. The namespace id
  must be unique within the account (change it if another Worker there uses 2736). A request with no CF-Connecting-IP skips
  the limit.
- `worker/wrangler.jsonc` sets `observability.logs.invocation_logs` to false, `observability.redact_query_string` to true and
  `observability.traces.enabled` to false (`src/wrangler.test.ts` pins all three): Workers Logs invocation logs record the full
  request URL, and `/geocode`'s carries the user's query; traces record subrequest URLs. Our own `console.log` lines stay on
  (so the `*-miss` lines still show). `wrangler tail` and the dashboard's live logs may still show full URLs to whoever tails
  production. Never enable traces.
- The client finds the Worker through `VITE_RT_URL` (copy `.env.example` to `.env.local`).

## Directory map
- `src/main.tsx`, `src/App.tsx`, `src/index.css`: entry, root layout, Tailwind + theme CSS vars
- `src/config.ts`: build-time feature switches, plain constants (no remote flag service). `FEATURES.navigation` (default
  false, 2q7.51): off, the HUD offers no directions (no From/To on search rows, no "Directions from/to here", no trip panel or
  `TripAnnouncer`), so the trip never opens and nothing trip-only draws or loads (the router chunk, timetables, transfers,
  `tripPatterns()`, the trip's interiors and street files); search, its flights and the location row are unchanged. True restores navigation.
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
  Street tokens `streetStroke` (faint by color, not alpha) and `streetWidth` draw the station street layers (focused and in view).
  `interiorEntranceNeighbourMix` (0.5) mixes `interiorEntrance` toward the background (sRGB, mixHex) for the entrance marks
  of a station in view that isn't focused (3.68:1; at least 1.5:1 and at most half the focused marks' contrast,
  `src/themeStreets.test.ts`); the focused station's marks keep the full color.
  Default (auto): each street layer draws both strokes, cross-faded by look A's veil share `s` (`PresenceStore.veilShare`,
  the veil's own eased presence): under the route lines at 0.35 at full color at opacity x (1 - s), and above the veil at
  7.5 at a fainter stroke (1.9:1, `veiledStreetHex` in `src/lib/streetVeil.ts`) at opacity x s; both draw only while
  0 < s < 1, so the streets follow the veil and never lead it.
  TEMPORARY: `?streets=under|over` forces one order until the ost.7 card is decided; the removal list is in
  `src/scene/streetsLook.ts`
  `basemap` holds one `{ stroke, width }` per basemap class (highway, major, minor, path, water, park), faint by color;
  `src/themeBasemap.test.ts` holds its contrasts (roads under `streetStroke` and every line, highway over major
  (≥ 1.95:1) over minor (≤ 1.5:1) over path (≥ 1.3:1), highway apart from major by tone too, water and park 1.5 to 2.5:1; every class
  1 px, so width marks only the subway) and distances (`src/lib/colorMetrics.ts`, shared with `theme.test.ts`).
  TEMPORARY: `?basemap=off` draws no basemap and loads no tiles until ost.9.3's look is signed off; the removal list is
  in `src/scene/basemapLook.ts`
  Exit tokens `exitPath` (pink, 3:1, held apart from the interior, focus, location and route colors, also under simulated
  red-green color blindness; theme.test.ts), `exitPathWidth` (3 px), `exitPathDash` / `exitPathGap` (world m) draw the trip's
  way out.
  Place pin tokens `placePin` (lemon, 3:1, held apart from the location, focus and exit colors, the selected-train rim and every route color, also under simulated red-green
  color blindness; theme.test.ts) and `placePinWidth` (2 px) draw the pin on a searched place.
  Trip route tokens (TripLines.tsx, 2q7.45.3): `tripNetworkDim` (0.7) mixes every other route line toward the background
  while the trip panel is in front, `tripLineWidth` (2.5 px) is an opened journey's ride legs, `tripFaintDim` (0.35) the list
  view's first journey at the base width; `themeTrip.test.ts` holds the floors (dimmed at least 1.3:1, faint at least 1.45x its
  route's dimmed contrast, every full route at least 1.4x the brightest dimmed one).
  Trip walk tokens (TripDashes.tsx, 2q7.45.4): `tripWalkDashPx` (6) and `tripWalkGapPx` (4), CSS px at the view's target, dash the
  trip's walks between stations and its straight-drawn rides; the walks and the trip marks are `exitPath`, at least 2.5:1 over every
  route dimmed by `tripNetworkDim` (2.66:1 over N/Q/R/W) and, faint, on the background (3.03:1; themeTrip.test.ts).
  Car tokens `trainCarSideShade`, `trainCarEndShade` are linear multipliers of a car's route color.
  `bandPitchPx` (2.5) is the gap between routes drawn side by side in a shared corridor.
- `src/scene/`: the r3f scene
  - `Scene.tsx` canvas; `CameraRig.tsx` MapControls,
    HUD-aware fit-to-city framing, zoom-driven tilt, fly-to, auto focus, interrupted-fly-to focus hold;
    `cameraFlight.ts` its fly-to destinations (interior, bare station, point; `interiorFlight` takes the focused station id, which for a complex member is not the file's `stationId`, so the focus hold follows the member; `follows` marks a flight to the selected
    train; a bare station's `stationFlight` frames its entrance marks, `bareStationPoints`, and its complex's other members' points, `complexMemberPoints` (`network.groupById`), through `bareStationFrame` in `lib/freeFrame.ts`; `bareStationTiers` the same points by tier (station, members, marks) for the collapse and resize reframe; `interiorFlight` frames the interior's priority frame when there is one, `priorityLanding`), `newFlight`, `flushMotion` and the landing turn;
    `useStationFlights.ts` the fly-request effect and the mid-flight retarget (interior, bare streets, the trip's path frame, panel size; a point flight, place or location, on a viewport or HUD inset change only, same pace, `rebaseFlight`, `pointFlight` recomputed whole, so its distance may grow slightly with a taller header (intended); matched by identity, so a follow or reframe that replaced it is left alone; under reduced motion, where it snapped in its first frame, one change within 500 ms of the request snaps it once more unless the camera moved or a gesture began since, `shouldResnapPoint` in `lib/pointResnap.ts`);
    `useEntranceProbe.ts` dev-only `__underground.entrancesAt()` (entrance marks and station in viewport px, free rect);
    `usePathProbe.ts` dev-only `__underground.stationPathAt()` (the priority frame's path marker ends and centerline, and its out-of-service machines' ends, in viewport px, free rect);
    `useStationOrbit.ts` the focused-station orbit (azimuth bounds per frame, pivot, pan-radius clamp, first-turn signal; CameraRig passes the focused complex's member points, `members`);
    `useTouchOrbit.ts` its two-finger twist on touch (see Rendering conventions; dev-only `__underground.orbit(at?)`: azimuth,
    distance, target, lock, zoomSpeed, rotateSpeed, and a ground point's viewport px);
    `useInteriorReframe.ts` frames an interior that loaded too late for its station flight (after LATE_TURN_PROGRESS
    or after landing): once landed, a 0.6-1 s eased flight onto it with the landing turn decided then (reduced motion
    snaps, no turn); a gesture, another flight, a follow or a focus change cancels it (`interiorReframe.ts`, pure; its `ready` is `interiorReadyFor`, `interiorCovers(interior, awaited station)`, so a complex's other member reframes too, or for a bare station awaiting its streets (`kind: 'streets'`) `streetsReadyFor`: the same reframe onto its entrances, no turn; with the trip panel open a framed interior goes on
    awaiting its priority frame (`kind: 'frame'`, `nextAwaiting`, `frameReadyFor`; the trip's path, then the machines out of service): its arrival, a change to it or a panel move reframes onto it, no turn, until a gesture, a focus change, a follow or the panel closing; with the trip panel closed the landing (which frames the machines out, as known by then, the late-interior reframe included) is final, so a later /ene poll, an outage list expanded or the trip panel opened never moves the camera (on a phone the expanded list leaves about 32 px above the panel, too little to frame anyway); a reframe with nothing to move is skipped; while a panel toggle settles, `CameraRig`'s `collapse` ref, every check waits and `useCollapseReframe` asks again after);
    `useCollapseReframe.ts` the collapse reframe: only a user collapse or expand of the panel in front (`usePanelCollapse().seq`; never
    `collapsed`, a panel size change, an /ene poll or arrival rows; the one exception is a bare station's resize within 2 s of its
    landing, at most one move per landing, below) arms it, unless a flight is under way (its retarget takes the new
    panel) or a train is followed; once the panel's rect holds still 150 ms (at most 600 ms after the toggle; `lib/collapseReframe.ts`,
    pure: `collapseDueIn`, `reframeGains`, `collapseAction`) a 0.6-1 s eased flight, no turn, onto the focused interior's priority frame
    (`interiorFlight` with the frame: trip path, then machines out of service), an interior's usual landing when it has no priority
    frame, or a bare station's point and entrance marks (`stationFlight`) in the new free rect; reduced motion snaps; nothing when
    `reframeDuration` finds nothing to move. With a priority frame or a bare station it moves only when the view doesn't already
    frame every priority point there and the new framing shows no less (`reframeGains` over `framedCount` per tier; a tie moves, so
    an expand returns to the open panel's landing). It declines once the user took the view over (a gesture since the last landing:
    CameraRig's `tookOver`, set in `onStart`, cleared when a flight lands) and while `useInteriorReframe` awaits a late interior or
    streets (`kind: 'interior' | 'streets'`; that reframe moves once, with its landing turn). When it declines or has nothing to move
    it asks `useInteriorReframe` again, so with the trip panel open the `'frame'` await (#113) may still frame the trip's path onto
    the new panel. A gesture, another flight or fly request, a follow or a focus change cancels it. A desktop collapse frees no room
    (the free rect ends at the panel's left edge), so the landed view already frames it and nothing moves. On a 390×844 phone the
    bar leaves the free rect's bottom at 690 px (`collapseFixture.ts`): collapsed, Union Sq's Lexington and Canarsie ways out fit
    (635N's reframes onto a path frame; the others already show) and Pelham Pkwy's station-house machines already show
    (`pathFrame.data.test.ts`, `outageFrame.data.test.ts`). A bare station's resize (ost.18, `lib/resizeReframe.ts`): a bare
    station's own landing (its fly request made with the station panel in front, so a pick from a train panel gets none; the
    late streets reframe's landing counts, the collapse or resize reframe's own never does) opens a `RESIZE_WINDOW_MS` (2 s) window
    (`opensResizeWindow`). Inside it, with nothing pending, one measured panel move that changes the free rect's bottom, or a panel
    already moved past the bottom the landed flight framed in (`Destination.freeBottom`), arms the same settle
    (`CollapsePending.kind: 'resize'`; `panelMoveArms`: same station, the viewport recorded at the landing, no gesture, flight,
    follow or late interior/streets await; a desktop side panel never moves the bottom). It reframes onto `stationFlight` in the
    final free rect only when that frames strictly more (`moveGains`: `showsMore`, lexicographic over the tiers: the station, its complex's other members, then marks; no tie move), no
    turn, reduced motion snaps. The window closes on that reframe, on any `pointerdown` or `keydown` (so "Show all N destinations",
    "Show fewer" or the outage disclosure never move the camera, even tapped within 2 s), a fly request, or its expiry; after it, of the panel's changes
    only a user collapse or expand moves the camera. What can still grow a bare station's phone panel after landing: the "Out of
    service (N)" disclosure once the equipment index or /ene joins, "status unavailable", the first arrivals and their "Show all N
    destinations" button, arrivals notes. An interior's panel size alone still never moves the camera. On a 390×844 phone (free
    bottom 393.5 px under the open panel, 690 px under the bar) 127 lands with 10 of its 16 marks and 120 with 2 of 6; collapsed, all
    of both; the outage disclosure arriving (52 px) reframes 127 from 8 to 10 and leaves 120 at 2 (`panelGrow.data.test.ts`);
    `useRouteFlight.ts` the trip route frame (2q7.45.5; see Rendering conventions: `lib/routeFrame.ts` the route's ground points and `frameTopDown`, the pure top-down fit into the free rect;
    `lib/routeFrameRule.ts` `routeFrameDecision`, when it fires; `useViewMoved.ts` a drag, pinch or wheel past the click slop (locationCap.ts's rules, unchanged); `useRouteReframe.ts` and `lib/routeReframe.ts`
    its reframes after landing; `routeFlightState.ts` what they share; CameraRig calls the hook and passes its landing call every landing, `onStart` is untouched);
    `useTrainFollow.ts` the camera follow of the selected train (see Rendering conventions); `useFollowAnchor.ts`
    LiveTrains' -3 frame: steps every slot and writes the selected train's drawn point (`lib/live/followAnchor.ts`)
  - `SubwayLines.tsx` (one merged LineSegments2 via `useLineLayer.ts`; draws `network.shapes` until the banded
    shapes arrive, then eases them in over 300 ms (`BandView.ease`: offset and split blend linearly from unbanded, so no fold); writes the shared `BandView` (Scene owns it; LiveTrains reads
    it) and the band uniforms per frame at priority -0.25); `usePlatformFade.ts` (given `interiorSpans`, a `SpanSet` of every drawn interior's spans: `memberSpans` unions a complex's members, never two interiors) writes the drawn interiors'
    per-segment platform fade for every band layer (the `?lines=` overlays too), each span's weight times its interior's
    presence; while any presence changes a frame rewrites only the shapes the spans touch (`writeShapeFade`) and uploads only
    their ranges, and with every presence still nothing; `bandLineMaterial.ts` `BandLineMaterial` (LineMaterial
    with `BAND_GLSL` patched into its vertex shader and the platform fade into its fragment alpha; the patches throw
    if three's anchors move) and the shared `BAND_UNIFORMS`; `useLineLayer` uses it for buffers that carry `bands`.
    Each BandLineMaterial also has its own `lineDim` uniform (not in `BAND_UNIFORMS`): `DIM_GLSL`'s `dimLine` mixes the
    fragment's color toward `lineDimColor` (theme.background, sRGB) in sRGB, exactly as `mixHex` does, never by opacity
    (`src/lib/lineDim.ts` `dimLineRgb` is its JS twin; `lineDim.test.ts` pins the GLSL and checks both against mixHex); with
    `{ windowed: true }` (the `TRIP_WINDOW` define; buffers carrying `windows`) it discards each segment's fragments outside its
    `WINDOW_ATTRIBUTE` (t0, t1), t being 0 at the segment's start and 1 at its end (caps keep their end's t; an end the span
    doesn't cut is -1 or 2, so no fragment sits on the cut). A plain layer gets the same dim as `DimLineMaterial`
    (`useLineLayer`'s `dimmable`; the focused station's streets). While the trip
    panel is in front with a route (`usePanelCollapse().front === 'trip'`, collapsed or not; a train panel or notice in front
    ends it), SubwayLines eases one `TripEmphasis` at -0.25 (`src/lib/tripEmphasis.ts`, 0.25 s, reduced motion snaps) and
    writes `lineDim` = `tripNetworkDim` on the main layer into Scene's `EmphasisLevels` (read at 0): the `?lines=` overlays and
    StationStreets write the same `lineDim`, and Basemap mixes every class's stroke the same amount toward the background in
    sRGB after its distance fade (`basemapLayer.ts` `setVisibility`'s `dim`), so no road, water or park outshines a dimmed line
    (`themeTrip.test.ts`). `TripLines.tsx` (render order 2.1, a child of SubwayLines in a null-fallback ErrorBoundary keyed by
    the last route's key, so a new route remounts it): the selected journey's ride legs (`useTripRoute`)
    as `tripLineBuffers` (`src/lib/tripLineBuffers.ts`, pure: each ride span's overlapping shape segments copied with the same
    positions, heights and band inputs as `buildLineBuffers`, cover ignored, plus `segmentWindow`'s (t0, t1); no new
    vertices, `lineBreaks` untouched), in route colors under `theme.routeLineMix` whatever `?lines=` says (a route routes.json
    lacks warns once and takes its drawn shape's route's color, else the ride is left out), with
    `usePlatformFade` (a stretch two rides share fades on the first copy only); per frame at 0 its `scale.y`, width (base to
    `tripLineWidth` as a journey is opened) and own dim (`tripFaintDim` in the list view, 0 opened); it keeps the last route,
    held by SubwayLines (`useHeld.ts`, the last non-null route), so closing or covering the panel eases it out. Beside it in the
    same boundary (a crash un-dims the map), 2q7.45.4: `TripDashes.tsx`, two plain dashed `DimLineMaterial` layers at y 0: the
    walks at 4.45 (over the marks' halo discs and under their rings, so a short walk between touching marks still shows; 7.55,
    above the veil, while look A's veil is up (`veiled`: any interior drawn, and the focused station's own when one is focused) and `interiorOpacity` is above 0, like the way out's walk
    outside) and the straight rides at 2.2 (over the ride legs, under the station markers)
    (`tripDashBuffers`, `src/lib/tripDashBuffers.ts`, pure: each walk between stations a segment in `exitPath`, each `straight`
    ride its stop polyline in its route color, a route routes.json lacks warned once and left out; dash distances in meters
    restarting at 0 per polyline), `dashScale` = 1 / `metersPerPx` (lib/follow.ts) per frame so `tripWalkDashPx`/`GapPx` hold on
    screen at the target, width `tripWidthPx`, the faint dim, opacity `tripOpacity` (`EmphasisLevels`, the shown ease); and
    `TripMarks.tsx`, three InstancedMeshes at MARKER_Y (a `theme.background` disc 4.4 at `TRIP_MARK_HALO` 1.2, the `exitPath`
    ring 4.5 from `TRIP_MARK_INNER` 0.62 to 1, a dot 4.55 at `TRIP_MARK_DOT` 0.4 for the start and end only, so a change reads
    hollow), radius `screenScale(d, tripMarkRadiusPx(d), TRIP_MARK_MIN_METERS 9)` (cameraDistance.ts: 1.6x the station marker,
    5..13 px), a change at `CHANGE_MARK_SHARE` 0.7 of it, and a start the location reticle overlaps (the fix within its radius
    plus the reticle's outer radius, `reticleClearanceInto` in hereShape.ts: `TICK_OUTER` × its scale) grown so its ring ends
    2 px past the reticle's far edge, at most `START_GROWTH_CAP` 2.5×, easing in over the reticle's radius of offset
    (`tripMarkRadius` in `lib/tripMarkSize.ts`, shared with FocusRing; Scene passes `here.ground` to both, read only); matrices
    rewritten only when one of its inputs (scale, reticle size, fix, marks) changes, the color (`dimLineRgbInto`, the faint dim) only when it changes.
    The marks at stations any drawn interior covers (Scene's `markHidden`, `coveredStationIds`) are a second set of
    meshes fading by 1 − `interiorOpacity(distance)`, so they go as the interior reveals, not when it loads. A focused station
    with no interior that carries a mark draws its FocusRing just outside it (`FOCUS_OUTSIDE_INNER` 1.25 to `OUTER` 1.45 of the
    mark's drawn radius, a grown start included) while the trip shows. The marks
    are `tripMarks` (`src/lib/tripMarks.ts`, pure: the first leg's start, the last leg's end, every other leg boundary a change,
    one per station, start or end over change; a walk between complex members marks both). No handler and not in ScenePicker, so
    neither takes a pick. While the trip shows, `Stations.tsx` mixes the rings of stations the journey doesn't call at
    (`TripRouteDraw.stations`, `tripStationIds`, held) toward the background by `networkDim` (instance colors, rewritten only as it
    or the set changes) and every `StationTies.tsx` tie dims by it (`DimLineMaterial`); the fills and the trains don't dim;
    `StationTies.tsx` a thin vertical tie
    from each station marker with a depth down to its sunken platform tracks (`network.stationTrackY`; one
    LineSegments2, `theme.stationTieWidth`; `scale.y` = the depth factor, opacity ramping in from depth 0.35 to 0.65; the focused station's tie is dropped when it has an interior, and so are its complex siblings' (`hiddenStations`, `compactTies` in `lib/stationTie.ts`); every other drawn interior's stations' ties move to `useCoveredTies.ts`' own layer, per-vertex colors mixed toward the background by `interiorOpacity` × that interior's presence (rewritten only on a change; a fully faded one leaves the drawn ties), kept (or a `STUB_DEPTH_M` stub in `lib/stationTie.ts` when it has no depth) when it has none or its load failed); `LineHighlight.tsx` holds the
    temporary `?lines=a|c` layers; `Stations.tsx` (two InstancedMeshes; the focused station's
    instance, and its complex siblings' once the interior covering them is loaded (`hiddenSiblingIds` in `interiorLoad.ts`: the index's siblings intersected with the model's members) are scaled to 0 (`writeMarkerMatrices`' `hidden` list) when it has an interior (ready or loading), so it has no marker, and drawn when it has none or its load failed, with a `theme.stationFocus` `FocusRing.tsx` over the trains (`focusedMarkerShown` in `interiorLoad.ts`, passed down as `focusedMarker`); every other drawn interior's stations (`covered`, o3r.4) keep their marker, the ring color mixed toward the background by `interiorOpacity` × that interior's presence (the fill is the background already), so the 1250 m gate and a swap leave no gap, and a fully faded one collapses to scale 0; `markerShape.ts` the marker constants);
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
    `PlacePin.tsx` the searched place's pin (a diamond outline and centre dot, `placePinShape.ts`, inside a thin background halo band, constant screen size, `theme.placePin`; no event handlers; Scene mounts it while the place line shows);
    `cameraDistance.ts` helpers; `renderOrder.ts` (also `strokeOrders` and `spanCarOrders`, the per-band and per-deck orders)
  - `SpanCars.tsx` / `useSpanCars.ts` the above-veil copies of the cars on a revealed station's platforms, one layer
    per platform deck (LiveTrains keeps three, splitting the spans with `deckSpans`; deck k's layer holds deck k of every
    drawn interior that lifts (not a bare focused station's neighbours), `deckSpanSets`, each car's weight times its interior's presence; 24 trains each, most on the platforms first; only cars with a weight above 0; the selected rim with them; overflow
    in `?debug`); `veilTint.ts` (its pure shader patch in `veilTintShader.ts`, tested against three's ShaderLib; a missing anchor logs once, never throws) their material, mixing each instance toward the background after shading, as the
    veil blends, so a copy at weight 0 renders exactly like its veiled street car. Along those platforms the map
    track fades out as the interior reveals, in the band line shader (per-segment fade weights, `platformMask.ts`)
  - `useSceneInteriors.ts` (o3r.4) the interiors Scene draws: the focused one, then `useViewInteriors` over the
    `ViewStationSet` (read with `useSyncExternalStore`), through `drawnInteriors`, capped by `viewInteriorCap` of the window
    (it also returns `view`, `drawn` and `viewFiles`, the requested files, for the street layers, o3r.5);
    `shown` is those plus any dropped one still fading out (`mergeShown` / `withoutFaded` in `lib/presence.ts`). Each has a
    `Presence` (0 to 1, smoothstep over `PRESENCE_S` 0.25 s; reduced motion snaps), which `InteriorPresence.tsx`'s
    `PresenceDriver` steps at -0.25 into a Scene-owned `PresenceStore` (`items`; the veil's own presence, whose
    value is `veilShare`) and reports a faded one so it unmounts. Presence multiplies into the interior's strokes, footprint veil
    and level labels, its lifted cars' weight (`ShownSpan.presence`, `trainWeightIn`), its map-track platform fade (`maskWeightIn`)
    and its stations' marker and tie fade; a covered marker or tie fully faded collapses (scale 0, left out of the covered ties) so
    it masks no passing line. The veil eases on its own: its target is 1 while the veil rule allows one (look A, and the focused
    station's own interior drawn when one is focused) and any interior is shown or a view interior is loading, so a swap or a
    brief empty drawn set never dips it.
    Outputs: their `SpanSet`, deck sets, `hiddenSiblings` (the focused one's, only while its model is drawn), `covered` (every other
    shown interior's stations with that presence), `hiddenStations` (both; ScenePicker's hidden set, so a train in reach beats a
    neighbour's hidden point and a direct tap with none still picks it), `markHidden` and `veiled`: look A, any interior drawn, and
    the focused station's own drawn or nothing focused. With a bare station focused (`veiled` false) its neighbours' trains don't
    lift (no deck spans for them). Dev `__underground.drawnInteriors()` the drawn file ids. Each shown interior mounts a
    `StationInterior` in one keyed list, each in its own null-fallback `ErrorBoundary` (a crash draws nothing for it); only the
    focused one gets the trip path, `outOfService` and level labels (`labels`; the others claim no blocker slot).
    `ScreenVeil.tsx` look A's one screen-wide veil at the orbit target, always mounted under look A, at `veilShare`, so the veil
    darkens once however many reveal and eases in and out on its own
  - `StationInterior.tsx` a drawn station's interior (two line layers per stroke band, up to four bands; for a generated interior every material is dashed (`interiorApproxDash` / `interiorApproxGap`) and per-segment `distances` cut only platform/slab outlines and slab guides; `InteriorVeil.tsx` (look B's footprint veil per interior; look A's plane, in ScreenVeil), level
    labels: plain DOM divs in the canvas container, placed per frame by `useLevelLabels.ts` (not drei `Html`, whose per-label React root unmounts inside a layout-effect cleanup and logged "unmount a root while already rendering" under StrictMode), text with a background-colored `text-shadow` halo instead of a filled chip so strokes show through); `interiorModel.ts` interior JSON to a
    drawable model (theme colors, labels, camera target; `STEP_RISE_M`); `interiorLook.ts` TEMPORARY look overrides;
    `StationInterior` renders its `children` inside the interior group
  - `ExitPath.tsx` a station path (`StationPathChoice`): the trip's way out at its To station, its way in at its From
    station (a `BoardChoice`, drawn exactly as a way out with no walk outside: board marker, centerline, entrance square), or a change of trains
    through a hand-authored complex (with a second marker on the next train's track), a child of `StationInterior`
    (Scene's `stationPaths`, in App's order exit, way in, changes, the first for the focused interior file; only while that interior is the focused one, in an
    `ErrorBoundary` keyed by `stationPathKey`): `exitPathBuffers` in one LineMaterial layer per stroke band (`model.decks`), at
    `strokeOrders(band, count).exitPath`: over that band's strokes, under the next deck's lifted trains (9.3 band 0, 9.8
    the top band, 9.545 / 9.578 Union Sq's mid bands), `theme.exitPathWidth`, dashed (`exitPathDash`/`exitPathGap`)
    when the layout is estimated or the walk outside is; opacity `interiorOpacity`.
    It hands its start and markers (`ExitPathLayers.keepOut`) to the level labels, which drop just below it on screen
    (`src/lib/labelKeepOut.ts`). The exit's entrance (`TripExit.mapLabel`: ground x/z and raw type) and the way in's
    (`TripBoard.mapLabel`) go to `StationStreets` as `pathLabels`, which takes the first it finds in the street file it shows
    (`exitEntranceIndex`, within 1.5 m, same type; any complex member's file; a focused station is one end, never both); the label with it among its `EntranceText.members` (its own index plus each same-text
    twin merged into it) is the exit label: `rankEntrances` (entranceLabelBoxes.ts) ranks it above every other entrance
    (an 8e9 tier over the elevators' 4e9), `exemptExitFromMarks` (streetLabelPlacement.ts) lets it cover other entrances'
    marks (only those; panel, header, footer, station markers, focus ring and level labels still block), and
    `useStreetLabels` tints it `theme.exitPath` (all three the focused station's only, the first segment: a neighbour's entrance
    with the same file index is neither ranked nor tinted)
  - `StationStreets.tsx` the streets of the focused station (interior or not) and of up to `MAX_VIEW_STREETS` - 1 more
    station leads from o3r.2's view set (`viewStreetIds` in `lib/viewStations.ts`, loaded by `useStreetLayers`), focused
    first (o3r.5); each a `StreetLines.tsx` keyed by station. Where layers' discs overlap each draws only its power-diagram
    cell (`src/lib/streetCells.ts`, pure: `streetCells`, `clipToCell`, `inCell`; with equal radii the nearest anchor, so the
    cut sits where both edge fades agree and the basemap mask's least-alpha rule still complements it; re-cut only when a
    cell's key, its overlapping neighbours, changes; `streetCells.data.test.ts` checks that the nearest pair of station
    leads with street files draws every street once). Each layer has its own `Presence` (`lib/presence.ts`, 250 ms,
    reduced motion snaps), stepped by its `StreetLines` at -0.25: it eases in on joining the set and out on leaving, a
    leaving layer staying mounted (and holding its mask slot) until faded. `admitShown` keeps the mounted layers within
    `MASK_N`: while leaving layers fill the slots a joining neighbour waits, in view order, until one fades (up to 250
    ms); the focused station's layer never waits: the oldest leaving layers are dropped at once to make room
    (`admitShown`'s `firstUrgent`; their slots free in that commit). The cells are cut among the settled layers only (drawn and fully in): a joining or leaving
    layer draws its whole disc while it eases, so nothing in an overlap dips or pops (its faded edge band shows doubled for
    that moment); a settled layer takes over a leaving one's part at once and gives up its part to a joining one once
    that one is in. A layer in view takes the shown interior covering it, drawn or fading out (`viewStreetInterior` in
    `interiorLoad.ts`: marks wait while its file is requested and not shown; a listed file past the cap or failed lately
    draws every mark and whole streets; route clip only with no interior file); for every layer, the focused one too, the
    interior's own entrances stand in for the matching marks only while its presence is past one half (both mark sets
    are built once and switched per frame), so marks neither double while it fades out nor vanish before it fades in.
    A neighbour's marks draw at `interiorEntranceNeighbourMix`. One `StreetLabels.tsx` labels every mounted layer in one
    pass (o3r.6, below); `useEntranceProbe` only on the focused one. Dev only: `__underground.streetLayers()` (the station
    ids drawn, focused first). Each layer: a plain LineMaterial layer at y = 0 in a
    group at the street file's anchor, `theme.streetStroke` / `streetWidth`, opacity `interiorOpacity` x its presence
    (so it fades in with the reveal and goes with the focus or the view). Street pieces running under a route line are left out
    (the route clip, see `src/lib/routeClip.ts` below, over `localTracks`: the runs within the file's radius + its reach),
    so no 1 px centerline reads as one more track in a bundle; the labels still name the street. Not while the station
    has an interior (loaded or loading): its tracks sink under it, so the streets above stay whole. Its draw order is auto: above the veil (7.5), built from
    `StreetLayer.veiledBuffers` (the 1.9:1 stroke, fading to the background like the others; material color stays
    white), cross-faded with the full-color stroke at 0.35 by look A's veil share `s` (`PresenceStore.veilShare`): the
    full one at opacity x (1 - s), the veiled one at opacity x s, each drawn only while its share is above 0, so the
    stroke never changes ahead of the veil. Both are cut once per layer, so the cross-fade re-cuts nothing; `streetsLook.ts` TEMPORARY override (one stroke only). It also draws a fine `theme.interiorEntrance` square (`ENTRANCE_SIZE_M` from interiorModel.ts) at each
    street-file entrance the interior doesn't draw itself (`src/lib/entranceMarks.ts`: no interior entrance within
    1.5 m on the scene ground with the same type; none while an interior is still loading;
    `entranceMarks.data.test.ts` checks L08 adds none). The labels of every mounted layer (o3r.6): `StreetLabels.tsx`
    calls `useStreetLabels.ts`: per layer one aria-hidden wrapper div in the canvas container (z-index 0, opacity the
    labels' fade x the layer's presence; `streetLabelDom.ts`; a new layer creates and measures only its own divs) holding
    a div per label, with the level labels' halo `LABEL_HALO`. One placement (`streetLabelPlacement.ts` over
    `labelPlacementState.ts`, `labelPlacementLayout.ts`, `labelRects.ts`, `entranceLabelBoxes.ts`, `streetLabelBoxes.ts`,
    then `labelDeclutter.ts`) takes the stations in label order (`src/lib/labelStationOrder.ts`: the focused station
    first, then the others in the order they joined, new ones in view order, so a joining station never outranks one
    already labelled), each station's entrances then its streets, each around every label placed before it; the focused
    station places unbudgeted (alone it places exactly as before, `streetLabelPlacement.alone.test.ts`), every other
    one (all of them with nothing focused) at most `NEIGHBOUR_LABEL_BUDGET` (`streetLabelReveal.ts`,
    `neighbourLabelBudget(viewport, focused)`: a phone 1 entrance and 1 street beside a focused station, 2 and 1 with
    none focused; a desktop 4 and 3 either way; `declutter`'s `limit`), and a street an earlier station placed (same
    `streetKey`) gets no second label, so a street two files hold is named once; a leaving layer (presence target 0)
    keeps placing its own labels as they fade but claims no street (`LabelPlacement.leaving`), so a remaining station
    names it at once. A set change rebuilds the arrays and carries each
    kept layer's last picks over by layer object (`carryPlacement`), so the others' labels hold. It runs only on a
    frame where the camera, canvas, insets, panel, level labels, interiors, focus, focus ring, drawn station markers or
    opacity changed, last placement's spot tried first, and once more after 10 still frames for the labels that weren't
    on their first spot. Dev only: `__underground.streetLabels(reset?)` (per station placed/total entrances and
    streets; the pass's last, max and p95 ms). Entrances first (`text-ink`, normal case; `text-ink-dim` for a station
    beside a focused one, every station full ink with none focused;
    on a phone, shorter side under 600 px, on two lines, street part then the rest), ranked elevators, then
    labels no other entrance shares, then each head house's best (entrances within 25 m) before any second, then
    nearest the free area's middle (a budgeted station: nearest its own station point on screen, so its few labels
    gather at its marker and hold through a pan), last placement's winners 48 px nearer; six spots: right or left of the mark (its
    first line level with the mark), or a label corner at a mark corner. Then streets (`text-ink-dim`, uppercase, not
    letter-spaced), those a placed entrance label names first (a budgeted station: those none of its placed entrance
    labels name first, so its few labels name more streets), last placement's winners first, then longest; turned
    along the street and kept reading the same way until 15° past vertical; offset off the centerline (half the label
    height + 3 px) away from the station, then the other side, then centered; where subway lines run along the street
    (`src/lib/routeBundles.ts`, once per station: routes within 12 m and near-parallel, and their tracks' lateral
    extent) the offsets clear that extent plus half a band pitch per route and the centered spot is unused; on the
    run with the most on-screen points within 150 m on a phone / 250 m on a desktop (250 m on a phone too for a
    street an entrance label names; last placement's run while it has at most one fewer), nearest the station first,
    falling back to the other runs. Each station's street labels offset away from its own station point. Every label
    keeps clear of the header, footer, panel (+8 px), every mounted layer's entrance marks, the station markers within
    300 m of any layer's anchor (`src/lib/labelNearby.ts`; not the focused station's nor those its interior covers)
    that are still drawn (a covered station whose marker its view interior has faded out, `interiorOpacity`
    x presence at 1 as Stations.tsx collapses it, blocks nothing: a per-frame `LabelContext.markerHidden` flag; a change
    to it bumps `markersVersion`, which places the labels again without rebuilding the DOM)
    and the focus ring (sized as Stations.tsx and FocusRing.tsx draw
    them now; an entrance ignores a marker its own mark sits in), and the level labels (`useLevelLabels` writes their rects into Scene's `LabelBlockers`, `src/lib/labelBlockers.ts`, a slot claimed by each interior that has labels, today the focused one alone (`claimBlockerSlot` / `releaseBlockerSlot`, `BLOCKER_SLOTS` 3, `MAX_LEVEL_BLOCKERS` 16 each; the street labels read every slot; the label divs are `aria-hidden`),
    at priority 0 each frame; read a frame late); street names also keep clear of every drawn interior's outlines
    (`InteriorModel.outline`, `src/lib/interiorOutline.ts`, padded by half their screen spacing; the first
    `MAX_LABEL_INTERIORS`). Each run of blocked rects (the fixed ones, each layer's marks, the markers and ring, each
    level label slot, each interior's outline) is a rect group (`labelDeclutter.ts` `GROUP`, `src/lib/labelRectGroups.ts`)
    whose bounds a candidate must touch before its rects are tested. The marker exemption is one bit per label in as
    many 32-bit words per rect as the labels need (`setExempt`), so no label count caps it. Sized after mount,
    after `document.fonts.ready` and when a resize flips phone and desktop sizes; opacity `streetLabelOpacity` (the level labels' depth gate)
    While mounted each `StreetLines` claims one slot of Scene's `StreetMask` (`claimMaskSlot`, `writeMaskSlot` with anchor
    and file radius, `writeMaskStrength` per frame with its presence, `releaseMaskSlot`; `MASK_N` 4 slots, at most 4
    layers mounted, `admitShown`; a full mask logs once and returns no slot), which the basemap's roads give way to
  - `useLocationCap.ts` / `LocationCapSource.tsx` the location zoom cap's driver (the fly request in a layout effect, pointer
    events through `useViewMoves`), run once by Scene inside the Canvas whether or not the basemap is; the shared handle is
    `lib/basemap/locationCapHandle.ts` (`isCapped()`, `subscribe`), which Scene creates and passes to Basemap
  - `useViewStations.ts` / `ViewStationsSource.tsx` (o3r.2) the stations in view, run once by Scene inside the Canvas at
    `useFrame` priority 0, read-only and allocation-free per frame (the id list once per change): the pose each frame, timing from
    `reselectDue` (`lib/basemap/reselect.ts`) but "changed enough" from its own `viewMovedEnough` (2% pan, 3% zoom, 3 degrees,
    a resize; the tiles' 10% pan is over 100 px), passed as its `slidOut`, plus a dirty flag set by a free-rect change
    (`interiorFreeRect`, as CameraRig), a focus change, a `gateZone` change and every frame the location cap is on; flights are
    evaluated like any move. It writes Scene's `ViewStationSet` (`lib/viewStationSet.ts`: `get`, `subscribe`, `set`, listeners
    isolated like `locationCapHandle`; created in Scene, no App state, so only readers re-render: o3r.4 reads it through
    `useSyncExternalStore`) only when the members change, or the first slot does (only while a station is focused), compared
    with what was last written, not with the last choice (`chosen` is the hysteresis input); it is emptied on unmount.
    While `cap.isCapped()` it chooses nothing and writes an empty set (the focused station too); dev
    `__underground.viewStations()` returns the store's ids.
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
    written per frame, so a station near the edge keeps its streets close in), and for the street classes the street mask
    (`MASK_GLSL` / `maskAlphaAt`, over `maskAlpha` per disc): inside a drawn station's street radius they fade out as its
    streets fade in, the exact complement of that layer's 70 m edge fade, at the station layer's `interiorOpacity` times
    its presence (`MaskSlot.strength`). The mask
    is `MASK_N` (4) discs in fixed uniform arrays (`maskDiscs` vec4 x, z, ramp start, radius; `maskStrength` per slot, the
    reveal times the slot's strength, 0 when free; `writeMaskUniforms` per frame), a loop sized by the `MASK_N` define like
    `NET_EDGES`, read from one interpolated ground point (`vGround`); overlapping discs keep the least alpha. Masked: the
    highway, major and minor roads only (`isMaskedClass` in `featureClass.ts`); paths, water and parks never, since a
    station layer draws no footway or park path. Scene wraps it in an
    `ErrorBoundary` with a null fallback: a crash there logs once and draws no basemap. Dev only:
    `__underground.basemapSegments()` (camera distance, per-class used/capacity/visible) and a `basemap:apply`
    performance measure per tile-set change
- `src/ui/MapReveal.tsx` the opening reveal: an aria-hidden, pointer-events-none `theme.background` cover after `<Scene>` (inside its ErrorBoundary, in a null-fallback one of its own), wiped open from the middle of the free area (`interiorFreeRect`: the HUD bands and the station panel left out; insets and panel kept in refs, read once) as a radial gradient over `REVEAL_MS` (1 s of its own clock, ease-out cubic, soft edge `REVEAL_FEATHER_SHARE` 0.18 of the farthest-viewport-corner radius), started on the rAF after r3f's second after-render tick (`addAfterEffect`, so Scene is untouched; the first real frame is drawn by then); the clock advances by at most `REVEAL_MAX_STEP_MS` (34 ms) a frame from the rAF timestamps, so a stall slows the wipe instead of jumping it; under reduced motion a 200 ms opacity fade on the same clock; a throw in a frame logs and unmounts it (fails open); unmounted when done. Pure maths in `src/lib/mapReveal.ts`.
- `src/ui/Hud.tsx`: Tailwind overlay (its bottom slot renders the panel `frontPanel()` (`lib/panelCollapseState.ts`) names; `useHudInsets.ts` reports `onInsets`: the top band from the header's bottom, the bottom band from the footer (Attribution) alone, never the panel sharing its slot, which reports through `onPanel` (`lib/hudInsets.ts`, pure), before the scene mounts and again, only when the value changed, on a resize of the root, header or footer, so a rotation or a header status line adding a row updates them; a changed inset starts no flight (a flight in progress retargets, a followed train re-centres, the zoom-out limit and a focused orbit's pivot follow the new free area), and the opening city fit and a point flight already set off keep the value they read; the header has a `from-canvas` to transparent gradient behind it, `pointer-events-none`, so strokes panned under its text stay out of the way; title, live status, a screen-reader-only announcer for the gone notice, arrivals
  panel: the station name, a focusable heading (`tabIndex -1`) that ends with the access glyph (`StationName` in `AccessIcon.tsx`: an aria-hidden glyph kept on the last word
  plus sr-only ", <accessLabel>." text, so the heading announces it; none for stations that aren't accessible) and, for partly accessible stations only,
  a dim aria-hidden `PartialAccessNote` line, then the "Directions from here" / "Directions to here" buttons (`openTrip`, below), then `InteriorStatus` and the arrival rows (their "Arrivals" heading is sr-only; `ArrivalsList.tsx`: on a stacked panel only the 3 destinations due soonest (`lib/live/arrivalsCollapse.ts`; the focused row's destination is always kept, in place of the latest, and if a row still unmounts with focus it goes to the heading) and one "Show all N destinations" / "Show fewer" button (aria-expanded, keeps focus; keyed `arrivals-<id>` so a new station, or the panel coming back after a train pick, starts collapsed); collapsed, the rows sit at the fixed height of three two-line-destination rows (`CollapsedSizer`), so polls neither grow nor shrink the panel; above the list a `LineFilter.tsx` group ("Filter by line") of one toggle chip per line of the station (a complex: every member's routes, in route order; none under two lines), fixed by the station so no poll adds, removes or moves one (`aria-pressed`, a 44 px target round the 36 px chip, pressed = ink fill; named "Show only the A train"; a line with nothing due is dimmed at opacity 50 with an `aria-description` "No trains due", never removed), pure in `lib/live/lineFilter.ts` (`lineKey` folds an express into its line, 6X into 6; `stationLines`, `linesDue`, `toggledFilter`, `filterArrivals`): one line at a time, tap it again for all; the filter applies first, then the collapse (so "Show all N" counts the line's destinations); the choice lives in `useLineFilter.ts`, called in Hud, so it survives a train panel covering the station panel and arrivals coming and going, and only a tap or a station change ends it (reads as unset, and is dropped, at another station); a chosen line with nothing due says "No upcoming A trains" (holding the collapsed height on a stacked panel) or its feed note ("Live times unavailable for A"); feed-only routes (reroutes) show under all lines only; a tap sets one polite sr-only line ("Showing A trains, 3 destinations" / "Showing all trains", emptied after 6 s; polls never touch it); a chip that unmounts holding focus (a status message replaced the list) sends it to the heading; expanded on a stacked panel, the list scrolls by whole rows in a TrainStops-style scroller (`useListScroll`'s `rowSelector` `li[data-group]`, a focusable region while it overflows or holds focus, a "more below" fade), desktop uncapped; the row, sizer and "Show all" parts are in `ArrivalRows.tsx`; a row whose train the map draws is a button that selects the soonest such train, `selectableArrival` over `ArrivalGroup.tripKeys` and `ArrivalsSource.drawnKeys`, so the keyboard reaches trains; the others are `aria-disabled` no-ops that look like text, so a poll never drops focus; every enabled row has an `aria-description` naming the arrival it picks), nothing else; the station panel has no ×: its down chevron (`CollapseButton` in `PanelBar.tsx`, `usePanelToggle.ts`) collapses it to a one-line bar in the same `aside` (`ExpandBar`: the station name with its access glyph, plus an up chevron; the body stays mounted but `hidden`, so list states and scroll survive; the aside's padding drops, so the HUD's panel observer reports the smaller rect and the free area grows), tapping the bar expands it, the collapse is sticky for the session (it survives station changes, auto-focus drops and a trip or train in front), the panel's `headingRef` points at the heading, or at the bar while collapsed, so every focus return lands on what shows, and each toggle moves focus to the bar or the heading one frame later (a touch user leaves a station by zooming or panning away; Esc dismisses it); closing the station panel (Esc) moves focus to the Search button; `TrainPanel.tsx` holds the selected-train panel, which covers the station panel and takes focus on
  each pick (one row under the heading: "Following" with a Stop button while the camera follows the train, else a "Follow
  train" button; the same button node, so toggling keeps focus and the panel's size; its `TrainStops.tsx` lists the next stops: 3 rows, "Show all N stops", a 15 s tick; on phones the expanded list is capped at whole rows by
  `useListScroll.ts` (rows are the list's children, or its `rowSelector` matches), about 5 rows or a quarter of the screen, with a "more below" fade), and the "no longer tracked" panel shown for 10 s; Esc or × closes the train first (the train panel and the gone notice keep ×; the station and trip panels have none), then the
  notice, then the trip panel (an opened journey goes back to the list first), then the station, and closing either of the first two returns focus to the trip heading, else the station heading, else
  the Search button; `ArrivalsPanel.tsx` is the station panel (moved out of Hud.tsx), whose last section is `EntranceList.tsx`: a screen-reader-only "Entrances" heading and the street file's entrance labels via `useStationStreets` (`entranceRows`, `lib/entranceList.ts`: elevators first, then by street; the map labels' words, same-text stairs within 15 m one row with a count; each row is its `entranceSpoken` form, full names and corners spelled out). The list is screen-reader only (sr-only section, never shown: sighted users read the map's entrance labels, the user's call). Not a live region, nothing while the file loads or when there is none. The header has one Search button and no Trip button.
  The trip panel: `useTripPanel.ts` (`openTrip`: a directions pick from a search row or the station panel; it closes a train panel or notice in front, expands a collapsed trip (`tripRequested`, no seq), sets the ends by `directionsTrip` (`lib/tripDirections.ts`: the picked end, then the other from the trip's earlier other end (an end already chosen stays), the fix's nearest station (From only), the focused station, then the trip's earlier picked end, which gives the way back; none may be the picked station or in its complex, `siblingsOf`; a place sets its nearest station and note; `fixStation` names an end the fix filled, see Data, "Trip board") and hands `TripPanel` a `focusRequest`: the end left empty, else the heading; it moves no camera; `closeTrip`: "Close trip", or Esc through `escapeTrip` (an opened journey goes back to the list first; a collapsed bar closes), when focus was in the panel, focuses the station heading else the Search button one frame later) and `TripPanel.tsx`, the trip
  panel (see Navigation UI below), which sits behind a train or notice and in front of the station panel and shares its `panel` ref); `LoadStatus.tsx` loading/error panel
  plus `SceneCrash`/`HudCrash`; `LiveStatus.tsx` the HUD live-trains badge (a polite live region);
  `FocusAnnouncer.tsx` a polite sr-only live region ("Showing <station>", name only) for any newly focused station (auto-focus, tap, link,
  "Go to"), 300 ms after it is entered and only if still focused, not covered by a train panel and not already holding focus (a
  search pick moves focus to the heading, so it stays silent); pure rules in `focusAnnounce.ts`; never moves focus;
  `ErrorBoundary.tsx`; `LiveDebug.tsx` dev-only `?debug` overlay (drawn count, drops by reason, join
  stages, per-feed trips/stale, offset/skew/age; updates per poll)
  `LocateButton.tsx` the header's location button (shows locating and located; the crosshair is `LocateIcon.tsx`, shared with the search dialog); `LocateStatus.tsx` its message (the sentence alone is the always-mounted live region)
  with a "Go to <nearest station>" action and a clear × (it exports `LOCATE_GLYPH` / `LOCATE_TONE`, which the search dialog's status line reuses)
  `InteriorStatus.tsx` the panel's station-layout line, one always-mounted live region: loading, error with Retry,
  and `ReadyLine` for a loaded interior (null for authored ones; for a generated one the dim line "Estimated layout",
  shown whether or not the interior is in view so it is announced once, and keyed by station so a cached generated
  station after another one is announced too; the one place a ready-state line goes)
  `OutageStatus.tsx` the panel's out-of-service machines under `InteriorStatus`: a closed "Out of service (N)" disclosure (one button, aria-expanded; the user's call) over the rows as plain text (title; levels on one line, "EL358 · back about 6 AM" on the next, each part
  whole; the levels line of a machine only the equipment index lists is the inventory's text, wrapped and clamped to 3 lines, and absent when it has none; a first line "No step-free access now", also in the heading's sr-only access text, when an outage leaves an accessible station's
  platform with no step-free route, `stepFreeLoss.ts`; no live region, so opening a panel never speaks them over "Showing <station>" or
  "Estimated layout"; the disclosure's focus goes to the station heading if it unmounts while focused), or a dim
  "status unavailable" line; one always-mounted polite sr-only region speaks only a change to the machines out at the station
  whose panel stays open and clears its text after 6 s (`outageAnnounce.ts`, pure; silent on open, station change or stale data)
  `SearchButton.tsx` (top bar) opens `StationSearch.tsx`, a full-screen native `<dialog>` (always mounted; the tap handler calls its `open()` so iOS raises the keyboard) with a labelled input over lists of result rows (`ResultRow.tsx`: a primary button with `SearchResult.tsx` or `PlaceResult.tsx` content and, in the HUD's search, given `onDirections`, "From" and "To" buttons named "Directions from/to <name>", `lib/searchRowActions.ts`; a directions pick calls `openTrip`, with a place's nearest station and name). The top bar is `SearchBar.tsx`. It is not a combobox, because a listbox option can't hold buttons. Every button is in Tab order; arrows move focus (`lib/searchNav.ts`: Down from the input, Up/Down between rows, Left/Right/Home/End within one, a printable key back to the input); Enter in the input picks the highlighted first row (the input's description says so, read on focus); a first row that came from `/geocode` is neither highlighted nor picked while the lookup is pending, since it belongs to the previous text (`enterTarget` in `lib/searchItems.ts`; a station first row always is the current text's). A station row shows the name and access icon, the borough on a dim line only for names whose stations span boroughs
  (`multiBoroughNames` in `labels.ts`), plus route chips, which tell same-borough duplicates apart; choosing a result
  calls `select` (focus then moves to the panel heading; Cancel and Esc return it to the button). Optional `label`
  (dialog name and input label, default "Search stations and places", or "Search stations" with places off), `placeholder` and `onClose` props let the trip panel mount two more
  instances (From, To), whose rows have the one button. Every instance takes the required `locate` (`LocateControls`, 2q7.46: its marked fix is read to keep the geocode bias away and to rank, never sent) and, with `onChooseHere`, offers location (`SearchHere.tsx`, `useSearchHere.ts`, pure `lib/searchHere.ts`): while the input is blank, a full-width "Use my location" button ("Update my location" while a fix is known, name included) at the top of the results (`locate.find()`: the same one-shot `getCurrentPosition` as the header's, no camera move, since a flight behind a modal would drop focus, end a follow and clear the place line; a header request already pending still flies), and under it, once a marked fix (near or far, from this press or the header's: one shared `locate.state`) exists, a "My location" row (dim "Nearest station Bedford Av · about 0.2 mi", the header's miles (`formatDistance`), plus " · approximate"; named "My location, nearest station Bedford Av, about 0.2 mi"; an outside fix gets no row). In the HUD's search the row has From and To ("Directions from my location", `onDirections` with the nearest station and the note `HERE_NOTE` "you") and its main button flies as the header button does (`locate.showFix()`, a `'locate'` point flight, so the 1450 m top-down landing and the z12 basemap cap apply; focus returns to the header's locate button); in a trip end's search choosing it sets that end to the nearest station with the note "you" ("near you", spoken "nearest station to you"; the end counts as a chosen end, like "Nearest to you", which now sets the same note). The control and row take the first `data-row`s (results are offset by `lead`; Left/Right onto a column a row lacks lands on its first button) and are outside `items`, so Enter and `enterTarget` are unchanged. A press in this dialog that settles on a marked fix moves focus to the My location row's main button, which speaks the rest. Status (finding, denied, unavailable, timeout, unsupported, outside, "Found your location.") goes through the dialog's first polite region only after a press in this dialog session (reset on open and on a query change, so the station count takes the region back), with an aria-hidden visible line for the failures; no new live region. While a marked fix is known, station results with equal scores sort by distance to it (`searchStations`' optional `distanceOf`, after the score and before the route count; a complex by its nearest member, `fixDistanceOf`), on the device. Places are on only when `GEOCODE_URL` (`realtime.ts`, from `VITE_RT_URL`) is set and the instance gets `onChoosePlace`:
  then the stations still rank synchronously and unchanged, and `useGeocode.ts` (one per dialog, only while it is open) adds
  addresses and places under them through `/geocode`: `lib/geocodeSearch.ts` the pure debounce and abort machine (250 ms after the
  last keystroke, 3 to 100 code points of `normalizeQuery` text, a stale request aborted and its late answer ignored, `answerKey`
  and `rememberAnswer`: a session memory cache of complete answers only, 50 entries), `data/geocodeFetch.ts` (`geocodeRequestUrl`,
  `parseGeocodeResponse` checking every row at the boundary, `fetchGeocode`: `cache: 'no-store'`, `credentials: 'omit'`, 8 s timeout,
  failures as `GeocodeAnswer` kinds, never an error's message), `lib/geocodeView.ts` (what shows and what the polite region says: one
  sentence per settled query, "Still searching streets, addresses and places" only after 2 s, the empty line "No stations, streets, addresses or places match.", the unavailable text "Street and address search isn't available right now.", the unavailable sentence once per dialog session (`nextErrorSpoken`); `creditSources` drops the bare OSM credit when Photon's, which names OpenStreetMap contributors too, is listed),
  `lib/searchItems.ts` (stations, then the Worker's rows in its order as one keyed list: kinds `address`, `place` (an area too), `street`, `intersection`),
  `lib/placeLabel.ts` (`displayCase`: GeoSearch names are UPPERCASE, so an all-caps segment is re-cased; `placeText`, `distanceText`,
  `placePick`: the place's ground point, nearest station and kind; the kind words are Address, Place, Street, Intersection). `SearchResults.tsx` renders them: a "Stations" list and, with places, a "Streets, addresses and places" heading over a second list of `PlaceResult.tsx` rows (the name, then a dim "Brooklyn · Intersection" line that fits at 375 px), each primary button named
  by one spoken sentence "120 Broadway, Manhattan, address" or "Bedford Av & N 7 St, Brooklyn, intersection", the "Searching" and error notes (aria-hidden; the two status
  regions speak them), and the credit for the sources of the rows shown ("Search data: " and the contract's `GEOCODE_ATTRIBUTION` strings; `OsmCredit` links the OpenStreetMap contributors name in the street index's and Photon's). A 503 or 429 answer reads as unavailable and is never retried (the next keystroke's request is the only retry). The dialog says "Streets, addresses and places are looked up
  through our server; your location is never sent." (the input's description) and, before typing, "Try 14 st, bedford av & n 7, 120 broadway or empire state." Picking a street, an intersection or a place in the HUD's search is a point
  flight, not a station pick (`flyToPoint(…, 'place')`, which lands at `PLACE_LANDING_DISTANCE` (600 m, tilted: `pointFlight` by the request's source), the place in the free area's middle at the real tilt (`framePoint`, `followTargetInto`); it neither expands
  a collapsed station panel nor bumps the collapse seq, and like any point flight it ends a train follow) and shows `PlaceStatus.tsx`
  (`usePlaceLine.ts`): the place's label and "Go to <nearest station> · about 250 m", focus moved onto the sentence, gone with
  the next flight of any kind (a followed train included) or the ×, with a pin on the place for as long (`PlacePin.tsx`; `usePlaceLine` lives in App, so the scene gets its point). Auto-focus may not enter a station from the place's fly request until the user moves the view (the place hold, `lib/placeHold.ts`, `usePlaceHold.ts`: the location cap's detector, `useViewMoves.ts`, a drag past the slop, a pinch or a wheel step; a tap that doesn't move keeps it; any other flight or a followed train ends it; exits still apply); the landing at 600 m is inside the focus range. In a trip's From or To search a place sets that end to
  its nearest station and keeps a "near <place>" note (`nearNote`: the name, or for a street its full label, "near Broadway, Brooklyn"; "My location" and "Nearest to you" set "near you", `HERE_NOTE`; `TripProvider`'s `places`, shown under the end's name and in its spoken text;
  any station pick, swap aside, clears it); it flies nowhere, and the place is not an exit walking destination. The dialog's keydown stops Escape (the native cancel still closes it), so the HUD's window Esc
  handler never also closes a panel; the HUD's `searchOpen` guard stays. `useKeyboardInset.ts`
  pads the list above the on-screen keyboard. `LinkNotice.tsx` is the "link's station isn't on this map" line (with a Search action) under the
  location message
  `OrbitHint.tsx` the header's muted turn hint under the status lines (right- or Shift-drag; two fingers on a
  coarse pointer), shown while a station is focused and no train is followed, until the session's first user turn (about 17° of an armed gesture on one focused station; flights, springs and the cap don't count; `src/lib/orbitTurned.ts`)
- `src/lib/`: pure logic
  - `stationGroups.ts` a complex as one station (`StationGroup`: the lead's id, point, borough and leadId; the most common member name,
    `otherNames` the rest; routes and stops the union; `groupAccess`: all full is full, else a partly accessible note naming the fully
    accessible routes and each partial member's own; `stationLeads` validates stations.json `complexes`); `Network.stationGroups`
    (one per station as the UI shows it: search rows, focus; the markers are `Network.stations`, one per member), `Network.groupById` (every member id to its group) and `Station.leadId`. Over it: `stationSearch.ts` matches a group's `otherNames` too (`ALIAS_PENALTY` 0.5 below its own name) and
    `SearchResult` shows a dim "with …" line; `locate.ts` `nearestStation` / `placeFix` and `placeLabel.ts` `placePick` lift the nearest member
    to its group (id, name, point; the distance stays the member's); `arrivalsAt` takes a group's `stops` and `memberIds` (a trip once at its
    soonest member, one ending at any member skipped, north first then soonest); the panel, announcers and trip bar name the group;
    `useStationHash` writes the lead and resolves any member id to it;
  - `viewStations.ts` (o3r.2, pure; `viewStations.test.ts`) the stations in view: nothing from `REVEAL_FAR` (1250 m) out; a
    group (complex lead, `viewStationSpace`: member points in CSR typed arrays) qualifies when any member projects (`ToScreen`)
    inside the free rect and lies within `REACH_SHARE` (1.5) x the camera distance of the orbit target on the ground (a horizon
    guard; a test pins it against the real camera at both free rects); ranked by the nearest member's screen distance to the
    free rect's middle; the focused lead first, counted in the cap `MAX_VIEW_STATIONS` (4); hysteresis (`KEEP_PAD_SHARE` 15%
    rect padding, `KEEP_REACH_FACTOR` 1.25, `KEEP_RANK_SHARE` 0.1 of the half-diagonal rank bonus) for a previous pick, and at
    the gate (`gateZone`: a non-empty set keeps its own members, nothing new, out to `REVEAL_FAR` x `GATE_KEEP_FACTOR` 1.04).
    `chooseViewStations` allocates nothing and leaves its scratch clean. Never takes the location fix or `nearestStation`.
    `MAX_VIEW_STREETS` (= `MAX_VIEW_STATIONS`, at most `MASK_N`) and `viewStreetIds` (o3r.5: the view's leads but the focused
    one, room kept for it; `viewStreetIds.test.ts`) pick the street layers
  - `projection.ts` lat/lon to scene meters; `tilt.ts` zoom distance to polar angle
  - `network.ts` public/data → render model (projected stations, routes, shape paths without bands, bounds,
    `trackLines` for the corridor search; `drawnPath` resamples one shape); `networkBands.ts` `bandShapes` redraws
    the banded shapes (`BandedShapes`) and sets each variant's `cover`, `bandNetwork` runs the search too (tests, the worker fallback);
    `variantCover.ts` `coverVariants`: a variant's segments with the same ends, y and band inputs as one of its route
    and direction's primary's (1 mm, 1e-4), outside the primary's platform spans (its fade would show the variant
    under it), so the lines skip them (about 57% of the variant segments; trains keep every shape whole;
    `variantCover.data.test.ts` checks the skipped ones draw within 0.05 px of the primary at six views);
    `trackLine.ts` a shape's drawn track (decode, project, `dropSpurs` removes out-and-back tips of
    160°+ turns, then offset); `trackOffset.ts` `offsetPolyline` (miter joins, capped at 2× on sharp
    bends) plus the `TRACK_OFFSET_M` constant (4.7 m). Both use explicit `.ts` imports because a scripts/
    test loads them;
    `trackProfile.ts` a shape's vertical profile (knots, `profileAt`, `resampleForProfile`) and
    `trackAnchors.ts` `profileRuns` (which shapes ride which authored platform track, and where); both use
    `.ts` imports for `scripts/lib/trackDepth.test.ts`;
    `platformSpan.ts` per station and shape the platform span `[d0, d1]` (`network.platformSpans`; `memberSpans` unions a complex's members per shape, the `interiorSpans` that SubwayLines, LineHighlight and usePlatformFade take instead of a station; `deckSpans` splits them by `PlatformSpan.stopId` per deck for LiveTrains id; `SpanSet` several drawn interiors' spans by shape, a list each, never unioned across interiors so the track between two stations stays, from `spanSet`, `deckSpanSets` (deck k of every interior) and `maskWeightIn` / `trainWeightIn`, the highest weight over a list) and its
    weights (`trainSpanWeight`, `maskSpanWeight`, `veilTint`: a lifted car keeps `PLATFORM_RESIDUAL_TINT` 0.2 of the veil on the platform); `platformMask.ts` the platform fade (`maskBreaks`
    adds line vertices through its ramps, `writePlatformFade` the per-segment weights, `writeShapeFade` one shape's, each at its interior's presence); `trackBreaks.ts`
    `lineBreaks`, every extra vertex a drawn line needs (ramps via `rampSampling.ts`, band tapers every 30 m but only once the slot
    moved 0.25, less 1e-5 so a variant's mapped knots keep its primary's breaks; `trackBreaks.data.test.ts` checks no primary's
    breaks change with it; fade ramps);
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
    eased as one; a join eases before the change, a leave after), then `corridorShare.ts` (`sharePrimaryBands`: a
    variant takes its route and direction's primary's slot and half-width knots, mapped to its own distances, along each
    run on the primary's track, `sharedTrack.ts` `sharedRuns`: vertices within 1 mm (the cover's tolerance) both ways,
    moving along both together; it hands over only where all four profiles are flat and agree, or at the variant's own
    start or end, so its own taper stays across a run's ends; else each shape's own 30 m grid put its knots up to 15 m
    off the primary's and the cover couldn't skip it: about 2.9k more segments skipped, about 5 ms). About 80 ms in node, off the main thread
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
    framed alone within STATION_ONLY_RADIUS_M (120 m), else the centred target is pulled within 120 m. A complex (2q7.42)
    wants its other members' points before the marks, nearest the lead first, and every member is an anchor: the target
    within 100 m of the lead or a member (its focused distance is the nearest member's, so under ENTER_RADIUS 140 focus
    stays), `centerRadius` 100 m plus the farthest member's distance. `complexFrame.data.test.ts`: Times Sq under the
    open phone panel frames 3 of its 4 other members and 17 of 18 marks (was 1 and 9), Canal St 3 of 3 and 14 of 15 (1, 7),
    Fulton St 2 of 3 and 14 of 28 (1, 7); never less for any complex at 390x844 or 1440x900; a lone station lands exactly as before) over
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
    pace, escalators one way when `travel` says so (`reverse`: the arcs point the way a rider came, so a search from a
    platform finds the ways in, a one-way escalator only ridden the way it runs); step-free keeps elevator, ramp, walkway; same-area walks; transfer mode
    drops every connector with an end on the street or in a `paid: false` slab, so a transfer never leaves fare control;
    `shortestFrom` the multi-source Dijkstra from a stop's tracks, `pathBack`); `interiorGraph.ts` (`endpointArea`: authored
    `Endpoint.area`, else the outline within 0.5 m; `routesToStreet`: from a stop's platform to each exit, an `exit: true`
    entrance, or the street end of a connector no entrance lists, `entranceId` null; exits may cross unpaid slabs;
    `routesFromStreet`: the ways in, the same search over the reversed graph to each `entry: true` entrance or unlisted street
    end, each route still listed platform first (`connectorIds` against travel, `exit` the entry); `interiorGraphEntryCheck.ts`
    the tests' `escalatorsAgainstTravel`; at 302 and A03 the uptown platform's stairs are all exit-only, so it has no way in);
    `interiorTransfer.ts` (`transferRoute`, track to track in transfer mode, or across one platform with no connector;
    `chooseTransfer`: the quickest plus `stepFreeAlt` when it has steps, else `noStepFree` (layout or outage); `probable` for an estimated layout or
    `paidAssumed`, a slab with no `paid` stood on); `complexFixture.ts` the tests' two-deck complex (T01/U01, a direct
    stair, elevators, a walkway, override helpers); `exitChoice.ts` (`chooseExit`: the exit minimizing in-station plus outside time, the outside walk
    over the shard when the destination is within its radius, else a straight-line estimate at `WALK_DETOUR` 1.3;
    `probable` for a generated or `approximate` interior; `street` joins the street-file entrance within 1.5 m of the same type;
    `walkMinutes`; `quickestExit`: no destination, the least in-station time, `walk` and `destination` null; `quickestEntry`:
    the way in (`BoardChoice`, `kind: 'board'`, `routesFromStreet`'s first; `none` reasons `no-track`, `no-entrance`);
    `streetEntranceIndex`); `interiorPath.ts` (`exitPathBuffers`: a `StationPathChoice` (exit, way in or transfer; the walk itself in
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
    and the spoken sentence via `streetSpoken`; for a `BoardChoice` "Quickest way in: Bedford Av & N 7 St", or with no
    label "Quickest way in: northeast entrance", its unknown-status machines in the order the rider meets them; `machinesUsed`);
    `boardView.ts` (`drawnBoardStop`, `firstRideStops`: the first
    ride's boarding stop when it is at the From complex, none for a journey that walks to another station first;
    `boardLineKey`, the way-in line's key: first ride's trip id and boarding station; `BoardLine`, a line or `no-entrance`);
    `tripFix.ts` (the trip end filled from the location fix: `fixEndOf`, derived from the ends, so a swap moves it and a pick
    replacing it leaves none; `afterPick`, `afterFocus`: picking or focusing that station chooses it); `transferView.ts` (`transferLegs`, `transferLegKey`
    (`from>to>nextRoute`; only walks `isChangeWalk` calls a change row), `firstTransferDraws` (per interior the first
    journey's change, none when it takes no connector), `transferLineView`: "Stairs up to the N platform · probably",
    one phrase per connector in travel order, merged when repeated; a dim note (a machine's unknown status); the
    step-free line, or "No step-free way" when the layout has none (silent when only an outage removed it); the spoken
    sentence);
    `walkFixture.ts` the tests' synthetic walk graphs
  - Name matching lives in the Worker's source, shared the way `normalizeQuery` is (the client imports `worker/src/...`; scripts load
    it through `.ts` imports): `worker/src/searchText.ts` name/query tokens (accents, ordinals, abbreviation synonyms) and
    `osaDistance`; `worker/src/nameMatch.ts` (`matchName`: the exact/prefix/fuzzy token scoring, with `whole` when every name word
    was used and `partialLast` false for a finished last word; `typedTokens`); `worker/src/streetKeys.ts` (`entryKeys`, `queryKey`,
    `GENERIC_TOKENS`: the two-character key a street is filed under and a query reads; the guarantee and its limits are in its header).
    `stationSearch.ts` ranks stations for a query with `matchName` (exact, prefix, typo-tolerant; a number only prefix-matches as the
    last word and never with an explicit ordinal, so "14 st" and "14th" skip 145 St; half-typed long forms and ordinals
    like "14 stre" and "14t" keep matching). `stationHash.ts` parses and builds `#station=<id>`
  - `panelCollapse.tsx` `PanelCollapseProvider` (in `App.tsx`, inside `TripProvider`) and the collapse flags of the station and trip panels
    (`panelCollapseState.ts`, pure: `frontPanel` mirrors Hud's bottom slot order, `collapseReducer`, `collapsedFront`).
    `usePanelCollapse(): { collapsed, seq, front }` is the scene's read-only view (memoised; `front` is `frontPanel`'s, which the trip route reads): `collapsed` is true only while the panel in front is a
    collapsed station or trip panel (false with none, and with a train panel or notice in front), and `seq` increments only on a user collapse or expand of
    the panel in front (never on a size change, a station change, a panel closing or a cover; `collapsed` can change without it, so key on `seq`;
    `useCollapseReframe` does);
    `usePanelCollapseControls()` is the panels' (`usePanelToggle`). The trip flag resets silently when the trip panel closes, and `tripRequested` (a directions pick, never a `seq`
    bump) expands a collapsed trip panel. `tripBar.ts` `tripBarText`: the trip bar's "A → B", "From A", "To B" or "Trip" and its spoken form
  - `focus.tsx` focused/dismissed-station React context (not pure; `FocusProvider groups` is `Network.groupById`: `select` focuses and
    flies to a member's lead, so `focusedId` is always a lead, and `membersOf` gives the complex); it also carries point flights
    (`flyToPoint(center, radiusM, source)`, `source` `'locate'` or `'place'`, returns the request's nonce; used by the location button and a
    searched place; drops focus, so an orbited view springs back north-up during the flight; `select` and `flyToPoint` share one nonce counter,
    so `usePlaceLine` can tell whether its flight is still the latest) and `viewCenter()`, the camera target read on demand (registered by
    `scene/ViewCenterSource.tsx`, which re-renders nothing; the address search's bias). In dev only it exposes
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
- `src/data/useTripRoute.ts` (2q7.45.3): the selected journey's draw (`TripRouteDraw`: key, `rides` for TripLines and the route
  frame, `straights` and `walks` (a complex's members aside) for TripDashes, `marks` and `stations` (2q7.45.4), `faint` in the list view), while the trip panel is open with a ready plan and a journey selected; `journeySpans` on the drawn
  paths (banded once they arrive) with `tripPatterns()` as the hint, loaded through `import('./loadTimetable')` (the planner's
  chunk and its one fetch, so nothing at startup); nothing draws until the patterns settle; a failed load logs once and spans go
  by geometry; a journey that can't be mapped, or has no ride, straight ride or walk between stations to draw, gives null (nothing
  drawn, nothing dimmed).
  Memoised on each ride's route and stop run.
- `src/lib/tripSpans.ts` (pure, 2q7.45.2): a trip's legs on the drawn map. `rideSpan` maps a ride leg to `{ shapeId, d0, d1, maxOffsetM, matched }` on a `network.shapes` or banded path of the stop suffix's direction (each stop's own station point, `projectForward`, offsets over `MAX_STOP_OFFSET_M` 150 m rejected, d1 > d0), by tier: a route shape whose trip-index pattern holds the leg's stops (`SpanContext.patterns`, optional hint), the route's shapes, any route's shape whose pattern holds them, any shape of the direction, else a `straight` line through the stop points; within a route primary first, then smallest offset (ties under `OFFSET_TIE_M` 0.01 m), then id (across routes offset first); `walkSpan` the two station points (none for `sameStation`; `sameComplex` marks a change inside a complex), `journeySpans` all legs, `spanPoints` a span's ground points; `stopStations` stop to station. `tripSpans.data.test.ts` plans L08 to 127 and checks banded and unbanded pick the same shapes (ends within a metre, so recompute on the banded paths)
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
  `src/scene/useBasemapTiles.ts` runs it (starts after the first frame and an idle callback; mirrors the shared location cap onto
  `capZoom`, which `useLocationCap.ts` owns, see Data), mounted by `src/scene/Basemap.tsx`, with `__underground.basemap()` for its counters, decode times and the
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
- `src/data/loadTimetable.ts` (`expectTimetable`, `expectDatedIndex`, `expectServiceCalendar`, `expectTripPatterns`: one
  `trip-index.json` fetch keeps the calendar and the patterns (each pattern's stop run), each checked on its own, so
  `serviceCalendar()` never fails on a malformed pattern and `tripPatterns()` rejects alone; a check's failure is cached for
  the session, a failed fetch is evicted and retried; one lazy cached promise per file via
  `interiorCache.ts`: `timetable/<service>.json`, `timetable/dated/<date>.json` and its `index.json` (built by each deploy, never in git; a 404 on the index is
  an empty one with one console warning, any other failure rejects), `route/transfers.json`, and the calendar from `trip-index.json`) and
  `planTrip.ts` (`planTripLive(stations, from, to, atS, live)`: reads the calendar and the dated index (fetched together; a failed
  index fetch rejects the plan, retried by the next one, never a silent fallback, except a 404, which reads as the empty index with one warning), picks the window, fetches the files it
  needs (a date the index lists reads its dated file, not its service files), builds one `RouterTimetable` per window and `feedVersion`, kept as a single cache entry, then `planOnLive`
  (`lib/route/planLive.ts`, pure: `overlayRealtime` over it with the snapshot, memoised on the timetable and snapshot
  identity, a snapshot over `SNAPSHOT_MAX_AGE_S` old never cached; a throwing overlay is one `console.error` per snapshot and the
  schedule answers, `overlay` null; `planTrip` is the scheduled-only form); `NoServiceError`
  when the calendar has no service on that date; User Timing measures `trip:fetch`, `trip:build`, `trip:overlay` and `trip:route`).
  Nothing here loads at startup; the trip panel opening is the first caller
- Navigation UI (2q7.9): Behind `FEATURES.navigation` (`src/config.ts`, default false): `Hud.tsx` passes `openTrip` to the search dialog and the station panel (`ArrivalsPanel`'s `onDirections` is optional) and mounts `TripAnnouncer` only while it is true; every hook and scene input below keys on `useTrip().open`, which only `openTrip` sets, so with it false none of them fetches or draws. `src/lib/trip.tsx` `TripProvider` (wraps `MapView` in `App.tsx`)
  and `useTrip` hold open, From and To in memory for the session (no URL, history or storage). `src/data/useTripPlan.ts` plans when
  both ends are set and differ, leaving now (live clock once a snapshot has set it, else the device's), drops stale replies by request
  id, replans every 30 s, and on each snapshot newer than the one planned on (trigger `poll`, never announced), while open and not covered by a train panel or notice (silent; once more when the cover goes), on the schedule with the next 30 minutes from the latest snapshot (`overlay` counts ride the ready plan; `?debug` prints them), warms the
  timetable on open and shows "Finding trips…" only after 250 ms. It loads `planTrip.ts` by dynamic `import()`, so the router and its
  loaders are their own chunk, not the startup bundle. `planTripBetween` expands each end to its complex (`lib/route/ends.ts`
  `complexMembers(complexes, id)`: stations.json `complexes`) so a trip never starts or ends with a walk to another member;
  `journeySource` tags a journey Live (every ride leg live), Live and scheduled (a dim "scheduled" on the others) or Scheduled, in the summary ("Leaves in 4 min · Live") and as the spoken sentence's last words; a live ride leg the map draws (`ArrivalsSource.drawnKeys`) has a "Show train" button calling `selectTrain`, so the train panel covers the trip and its × returns focus to the trip heading. A journey's key is its legs' routes and stops, not trip ids, so a scheduled-to-live swap keeps the opened journey and focus; the "Show train" button, once offered, stays as an `aria-disabled` no-op while the train is off the map. A silent poll that first turns a journey's tag from Scheduled to Live (or mixed) stays silent, like any refresh. `journeyView` still words a mid-trip walk between same-named stations as a change.
  `src/lib/tripView.ts` (pure, tested; `tripOnMap.ts` holds `shouldAnnounceOnMap`): `tripMessage`, `orderJourneys`, `journeyView` (a journey departs with its first train), the spoken text, and the
  announce rules (`shouldAnnounceTrip`: a settled plan once, not a refresh). `TripAnnouncer.tsx` is the one polite live region for it,
  mounted in the HUD header (so it outlasts the panel being covered): it speaks a settled plan, the message for ends that can't be planned
  and "On the map: X" only when the focused station really changes while the panel is in front (`shouldAnnounceOnMap`: never on
  open, a swap, an end pick or an uncover, for the station the visitor just stepped to (`stepped`: `TripProvider`'s `activeStepLead`; a step press instead says "Showing <station>" once, FocusAnnouncer's wording, which stays covered), and not while a result loads or in the 1.5 s after one settles); it is emptied whenever its text could be stale and refilled after a gap so a
  repeated sentence is spoken again. `TripPanel.tsx` (`aside` "Trip"; the directions pick's focus target (heading or the empty end's row) takes focus; a down chevron instead of × collapses it to a bar, `tripBarText`'s From → To, in the same aside, body hidden and kept; tapping the bar expands it; a "Close trip" text button beside the chevron closes it (no ×, 2q7.34; the collapsed bar has none) and a directions pick reopens or expands it; closing keeps the ends; `useScrollHint.ts` a "more below" fade
  while the capped panel scrolls) with `TripEnds.tsx` (From/To rows take focus, then open their own `StationSearch`; a shortcut that fills an
  end returns focus to that row; "Nearest to you" never offers a From equal to To; "On the map" is not offered, nor announced, for
  a station sharing a complex with an end, `isTripEnd` in `lib/tripEnds.ts` over the App's `siblingsOf`, the group's other members) and `TripJourneys.tsx` (2q7.45.1, 2q7.47: the journeys as a
  list of collapsed rows, soonest arrival first, none open; a row opens that journey as its own detail view, `TripJourneyDetail.tsx` (Back "All trips", an h3 heading, the
  summary chips and `TripLegs.tsx`' itinerary); a plan with one journey opens it directly, with no Back. The opened journey is state in `TripProvider`
  (`opened: { planKey, key }`, reset when the panel closes; `selection`, `selectedJourney` = opened, else the first, `openJourney`, `backToList`, `dropped`, `dropNoteShown`), and the view
  is derived from it by the pure rules in `lib/tripSelection.ts` (`journeyKey`, `journeyKeys`, `tripSelection`, `reconcileOpened`, `droppedNote`, `focusAfterViewChange`,
  `selectedFirst`), so a refresh never flashes a dropped journey: a poll or tick that drops the opened journey returns to the list (or opens the one left) with a dim "The trip you opened is no longer offered." (cleared by the next settled refresh or after 6 s; not for a journey the panel opened itself, `OpenedJourney.auto`)
  line and one polite `TripAnnouncer` sentence (`droppedNote`). Focus: opening moves it to the detail heading, Back (the button, or Esc while the trip panel is expanded, `escapeTrip` in `useTripPanel`) to that row, and a view that unmounts
  holding focus (`useJourneyFocusLost`) hands it on one frame later, to the panel heading when the row is gone; a collapsed bar's Esc closes the trip.
  The detail is an itinerary of steps (2q7.45.6, `lib/tripSteps.ts`, pure: `journeyItinerary`, `stepStatus`, `activeStepKey`; `TripStepButton.tsx`): a Board step before
  the first ride (and before a ride that follows a plain walk between two stations, the walk its own row), a Change step in place of each change leg (it carries the connecting train: "Change at 14 St-Union Sq · 4 min walk · 4 train at 8:20"), an Exit step after
  the last ride, then a trailing walk (the exit line belongs to the Exit step only when the last ride is the journey's last leg); a ride row says "· off 8:12", with "at <station>" when a walk follows; a walk-only journey has none. A step is a button (`data-step`, "Show on map", `aria-current="step"` while active) whose visible
  text and dim status are aria-hidden and whose one sr-only sentence is its name ("Step 2 of 3: change at 14 St-Union Sq to the 4 train at 8:20, a 4-minute walk."), with its status appended. Pressing
  one calls `TripProvider`'s `stepTo(key, stationId)`: `select(stationId)`, the only camera move, so the existing station flight with the trip panel open frames that
  station's priority path (no camera code of its own), and it stores the step with the lead of its station; it keeps focus. The active step shows a leading border and the focus colour (hover is a thicker underline).
  The step is active (`activeStep`, `activeStepLead`) only while the opened journey and the focused station are still the ones it was pressed on, so panning away or tapping
  another station ends it, and a stored step that stops holding is dropped, so focusing that station again later is not a step; it is also cleared on open, Back and close. The way through the station sits beside the button, never inside it: the Exit step has
  `TripExitLine.tsx` (its way out: the visible text and note aria-hidden, one sr-only sentence, never a live region), a Change step through a hand-authored complex
  `TripTransferLine.tsx`, the first Board step its way in (`TripLines.boards`, by `boardLineKey` of the first ride; shown with `TripExitLine`; `hasBoardPath` when the journey has one). A step whose station has no path says so in a dim status
  (`stepStatus` over `layoutOf(stationId, index)` in `interiorLoad.ts`: the index's provenance, `'none'` when unlisted, null while it loads, which says nothing): "No station
  layout" where there is no interior, "No path shown for this change" for a change at a generated one (it has a layout, but they never connect two tracks); Board and Exit at a generated or
  authored station say nothing (the path may still be loading), except at a trip end filled from the location fix and not yet
  picked or focused (`StepContext.fixPending`, `trip.fixEnd`): with a layout, the first Board step (of a journey starting on a ride)
  says "Tap to show the way in" and the Exit step "Tap to show the way out" (the tap focuses the station, which lets its files
  load); and a first Board step whose layout has no way in to the track (`BoardLine` `no-entrance`, only when no machine outage
  caused it: 302N, A03N) says "No way in on the layout". Each status is also the end of the step's spoken sentence. `TripPanel` takes one `lines: TripLines` prop (exits, transfers, the station index, boards) from App. Esc in
  the detail, one level a press (`escapeTrip`): end the active step (`endStep` clears it only: the station stays focused with its interior and path, the camera and focus stay), then Back, then close (ending a step says "Back to the trip" once, `stepEnds`); a collapsed bar closes. A directions pick closes a train panel or notice in front of it first. No control carries the
  panel's aria-expanded: the picks are actions that move focus in, and Close returns it. Esc moves focus only from inside the
  panel. The trip panel stays mounted (hidden, inert) under a train panel or notice, so its journeys, scroll and focus survive and a
  notice's auto-dismiss never moves focus; only a directions pick or a deliberate train/notice close focuses its heading.
  The HUD's window Esc handler skips while any `dialog:modal` is open. The trip's two searches are the same dialog as the HUD's (a place
  picked there sets the end to its nearest station, see `StationSearch`). Nothing located is sent anywhere. What is typed in a search
  dialog goes to the Worker's `/geocode` alone, and only with the Worker configured (see Data, "Address search"); the trip itself
  sends nothing.
- `src/data/loadStationIndex.ts` fetches and validates `public/data/stations/index.json` (the ids that have an
  interior; generated by `data:stations`, so nothing is hand-kept; `scripts/lib/stationOutputs.test.ts` checks it
  against the files; authored and generated entries count alike); `loadStationInterior.ts` fetch and outer-shape check; `interiorCache.ts` one promise per id, failures
  evicted (`useEquipmentIndex.ts` reuses it for `stations/equipment.json`); `interiorLoad.ts` the load types (interior and index) and their pure derivation, plus the complex helpers:
  `interiorCovers` (the one test for "this interior is this station's": a member, else `stationId`), `interiorStationIds`,
  `interiorIdOf` (a member id to its complex's file id, via the index), `siblingIdsOf` (the other members), and the view
  helpers (o3r.4): `viewInteriorIds` (the file ids for the stations in view, focused file dropped but its slot counted, a
  `skip`ped file passed over without a slot, at most the cap), `drawnInteriors` (focused first, each file once, capped; a model covering a station the map lacks
  is left out with one warning), `coveredStationIds`; a ready
  model that doesn't cover the station is an error; `useStationInterior.ts` the
  focused station's interior load (the index is fetched once on mount; stations it doesn't list never fetch; it also
  returns `siblings`, the focused complex's other members, empty while the street marker shows; `useViewInteriors` the
  loaded interiors of the stations in view other than the focused one, through `useInteriorModels` (its `onError`), and `files`,
  the ids requested; the result
  keeps its identity while the files and models stay the same (keyed on the ids' string), and a file that failed is passed over
  for `VIEW_RETRY_MS` (30 s, `lib/viewStations.ts`, `failedRecently`; for o3r.5's streets too), its slot going to the next station); `useLocate.ts` the location button's one-shot
  geolocation (on press only, never watched; the fix lives in React state and nowhere else; `locate` asks and flies, `find` asks with no flight (the search dialog), `showFix` flies to the shown fix and marks it viewed: a marked placement carries `viewed`, set by a flight to it, and the header's near message reads "Found your location." until then, "Showing where you are." after, `lib/locate.ts` `markViewed`)
- `src/data/loadStationStreets.ts` fetches `public/data/streets/<id>.json` (contract `src/data/streetSchema.ts`) and
  checks its outer shape; a 404 is null with one warning (cached for the session), other failures reject (evicted,
  retried on the next focus). `useStationStreets.ts` loads the focused station's file on focus, and through
  `useStreetLayers(ids)` the in-view leads' (same store and keys, so a focus reuses the layer; a failed view key, or one
  missing a member, is asked again only once `VIEW_RETRY_MS` old, `requestDue` in `streetLoadRule.ts`; the layer cache is unbounded), never at
  startup, into a cached `StreetLayer`; for a complex's lead (`membersOf`, lead first) it also loads each member's file
  and merges them (`src/lib/streetMerge.ts`, `streetFileIds`, `mergeComplexStreets`): the lead's file plus every member
  entrance no earlier file has (same type within 1.5 m on the ground), moved to the lead's frame, the lead's own first
  then the added ones nearest the lead's point first, worded in one `entranceTexts` pass with the members' named streets
  as extra lines (`NamedLine`, `namedLines`); lines, street labels, route clip and street mask stay the lead's, member
  lines are not drawn, and the far marks sit on the basemap's roads. A member 404 is skipped; a member that fails
  otherwise is warned about once (id and reason) and left out, the lead's layer showing without it, retried once that
  layer is 5 s old when a hook asks for it (mount or key change; a lead's failure fails the layer, retried on the next focus). Raw files and layers
  are cached separately (one fetch per file per page load). The merge adds Times Sq 10 entrances, WTC 9, 6 Av 7, Grand
  Central 2, Borough Hall 1, Bryant Pk 1 (`streetMerge.data.test.ts`). `src/lib/streetBuffers.ts` (pure) keeps the `isStreet` ways
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
- `src/data/realtime.ts`: client re-export of the realtime JSON types and `RT_URL`, the `/geocode` contract and the Worker's
  `normalizeQuery` / `NYC_BBOX` (so the client's minimum length and cache key agree with the Worker's), `ENE_URL` and `GEOCODE_URL`
  (siblings of `RT_URL`; an MTA host gives null); no fetching
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
- `worker/data/streetIndex.json`: the street and intersection index (`StreetIndexFile`, `worker/src/streetIndexSchema.ts`, format 2;
  one row per line, ODbL, credited "© OpenStreetMap contributors"), built by `scripts/build-street-index.ts` (IO only) through
  `scripts/lib/streetIndex.ts` (pure: `buildStreetIndex`, `displayStreetName`; reads the pin with `loadPin`, `isStreet` and
  `streetKey`; its entry types are `streetIndexTypes.ts`) and `streetIndexPack.ts` (`packStreetIndex`: drops each site's station id,
  turns intersections into street-index pairs, writes `keys`; refuses a name holding ", "). Bundled into the Worker and searched by
  `/geocode` (2q7.14); never imported by the client (the build is checked: a street-only name must not appear in `dist/assets`).
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
  `build-dated.ts` (IO: the deploy's dated timetables, `--empty` its fallback), `lib/datedCheck.ts` (`checkDatedOutputs`, its pre-write
  checks), `lib/feedZip.ts` (the zip URLs, the size-capped `loadZip`/`readCapped` and `DownloadError`, `decodeTables` with its zip-bomb
  limits, `pruneJson`, shared with `build-data.ts`),
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
  list at `/ene` (equipment code, reason, since, returnAt; the client re-export is 2q7.21), and `/geocode` (the bundled street
  index, NYC GeoSearch, then Photon, merged, at most 8 `{label, kind, lat, lon, source}`; kinds `address`, `place`, `street`,
  `intersection`, `area`; sources `geosearch`, `photon`, `osm`)
  - `src/schema.ts` the JSON contracts (types and consts only); the client re-exports them (`src/data/realtime.ts`)
  - `src/index.ts` routing (a `Map` of path to handler: `/rt` and `/ene` are `CachedRoute`s through `serveCached`, `/geocode`
    goes to `serveGeocode`; `/rt` 15 s, `/ene` 120 s), CORS;
    `serveCached.ts` the per-route memo, Cache API layer and herd guard (`serveCached`, with a 15 s backoff after a failed
    refresh; its `x-rt-cache` and `x-rt-expires` header names are shared by both routes); `cache.ts` pure memo/herd-guard
    decision and the per-route TTLs; `upstream.ts` feed and outage fetches (`fetchBytes`: 5 s timeout, 2 MB cap; `readBody`
    takes its cap); `edgeCache.ts` the Cache API read and write both routes share (`EdgeCache`, `readEdge`, `writeEdge`)
  - `/geocode`: `serveGeocode.ts` (IO orchestration, never throws: 403 unless an allowed Origin, then 429 `rate-limited` (with
    `retry-after` 60, exposed to CORS, no upstream call) for a client over `clientLimit.ts`'s limit, before parsing and both
    caches so a client can't probe the cache, then 400, the per-isolate LRU, the
    edge cache, then the street index (local, free of the upstream budgets), then the sources: an intersection hit calls neither;
    else GeoSearch first and Photon only when the index had no row and GeoSearch no place-like hit (an address hit satisfies a
    house-number query), or both at once for a query that looks like a business; only complete answers are cached, a source
    that timed out, failed to connect or answered 429 or 5xx is skipped for 30 s, 503 `busy` (with `retry-after`, exposed to CORS)
    when nothing may be called; one `geocode-miss` log line, counts and fixed codes
    only, never `q`, the focus or a label); `geocodeQuery.ts` / `geocodeText.ts` (parse, normalize, key, heuristics);
    `geosearch.ts` / `photon.ts` (the pure trims; Photon rows for transit, another state or country dropped; both drop every
    `street` row, the index's replace them) over `geocodeCandidate.ts`; `geocodeMerge.ts` (dedupe: PAD aliases, cross-source
    twins; rank; `combineRows`: the index's whole-name rows, at most 5, then the upstream rows, then its half-typed rows, at least
    2 places kept for them); `geocodeOutcome.ts` (status, attribution, `incomplete`, the log line, whose `osm` count is the index's
    rows shown; with index rows and every upstream failed the answer is a 200, `incomplete`, never cached; 502 or 503 only with no
    index row either);
    the street index: `streetIndexData.ts` (`STREET_INDEX`: `../data/streetIndex.json` parsed at startup, eager on purpose: startup has its own 1 s
    limit, while a lazy load would put about 10 ms into the first `/geocode` miss, over the Free plan's 10 ms CPU per request;
    `wrangler check startup` reads 22 to 27 ms, base 15 to 16; a bad index fails startup, caught first by the root freshness test and worker CI; only `index.ts` and its test import
    it, so the client never bundles it; 3.5 MB of heap once loaded) over `streetIndex.ts` (`loadStreetIndex`: checks
    the format and every index, throws a fixed message so a bad index fails `/geocode` loudly; builds the key map and per-street
    crossings), `streetSearch.ts` (`searchStreets` -> `{ whole, partial }` candidates, source `osm`, label "Name, Borough", an
    intersection "A & B, Borough" in the index's order whatever the typed order; the query's key picks at most about 110 streets to
    score, under 0.5 ms; a query with "&", "/", "@", "+" or the words "and" / "at" looks for intersections first (a separator with nothing after it yet is cut off, so "bedford av &" still finds Bedford Av), the side before the
    separator a finished word, then streets on the whole text; ranked by score, nearness to the focus, street class, label; one
    row per label; a street answers with its site nearest the focus, else its middle one, `streetQuery.ts`), `streetIndexSchema.ts`
    (the file contract and `BOROUGH_NAMES`; types only, safe for the client), `streetKeys.ts`, `nameMatch.ts`, `searchText.ts`;
    `streetFixture.ts` is the tests' mini index; the helper tests (`searchText`, `nameMatch`, `streetKeys`) run in the Worker's CI (`npm --prefix worker test`), the root `stationSearch` tests cover them only indirectly; `clientLimit.ts` (the per-client limit: Cloudflare's Workers Rate Limiting
    binding `GEOCODE_CLIENT_LIMIT`, 30 per 60 s per client per location, approximate; the key is `CF-Connecting-IP` through `clientKey.ts` (IPv4 and
    IPv4-mapped IPv6 on the full address, other IPv6 on its /64; clients sharing an address, CGNAT or Private Relay, share the
    count); Cloudflare holds the counter and the address is never logged, stored or echoed; fails open, logging one fixed code
    once per isolate, with no binding, a malformed address or a throwing binding (and silently with no header), since the buckets below still protect Photon; `src/wrangler.test.ts` pins the `ratelimits`
    entry to its constants); `rateLimit.ts` (per-isolate token buckets: 20 at 2/s overall, 5 at 0.5/s for
    Photon); `lru.ts` (`TtlLru`, 500 entries, 1 h); `geocodeUpstream.ts` (3 s timeout, 256 KB cap, descriptive User-Agent,
    fixed error codes only: a fetch error's text can hold the query)
  - `src/transform.ts` pure decode-to-snapshot logic; `ene.ts` pure E&E transform (`parseNyTime`,
    `transformEne`; the feed's `isupcomingoutage` is unreliable, so it is ignored: a row is skipped only if it has
    not started yet); `cors.ts` allowed origins
  - `src/gen/` generated protobufjs decoder (`npm run gen`); never hand-edit
  - `proto/subway-rt.proto` trimmed subset of gtfs-realtime + nyct-subway
  - `fixtures/` recorded feeds for tests (see its README; `ene.json` is the E&E sample, `geocode.json` the GeoSearch and
    Photon answers)
  - `data/streetIndex.json` the generated street index (`npm run data:search:streets`; see the scripts entry above), a plain JSON
    import that wrangler's bundler inlines (evaluated lazily): about 690 KB raw, 181 KB gzipped, the Worker's bundle 981 KiB (226 KiB gzipped)
    against a 64 MiB limit; `npx wrangler check startup` measures its startup (15 to 16 ms, unchanged by the index)
- `docs/research/`: research notes (`data-sources.md`)

## Hard rules
- Hand-written source files stay at or under 300 lines (aim for 200). Split before exceeding.
  Exempt: generated JSON in `public/data/` and `worker/data/` (one entry per line so refresh diffs stay small) and
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
- On first load a background-coloured cover over the canvas (`MapReveal.tsx`, below the HUD and above the canvas's DOM labels by tree order, z-index auto) wipes open centre-out after the first frame and then unmounts; it never takes a pointer event.
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
  taps and flights focus immediately, but a searched place's landing holds auto-focus out until the view is moved, `lib/placeHold.ts`; `focusMachine.ts`): |azimuth| is capped by tilt, rising from 0 top-down to π at tiltT 0.67 and a full spin
  (azimuth bounds ±Infinity) from there, and the turn pivots on the focus point
  (the interior's mid-depth center, or a bare station's point, at the middle of the free area).
  The focus point pans within the interior's reach (farthest outline vertex or entrance from its plan
  center) + 20 m (100 m of a bare station; 180 m at most), with a soft edge (`src/lib/orbitLimits.ts`), so
  on a phone a drag can bring every part of the interior to the free area at any angle. The pan clamp applies
  only from tiltT 0.5, about 970 m (further out a pan is free), and arms only once the view is inside the radius. A bare
  complex pans within the union of discs round its members, each of `complexPanRadius` (100 m, or half the longest edge of
  the members' shortest joining tree plus 20 m, so the discs join; 180 m at most: Times Sq 153 m, reaching Port Authority),
  held to the member nearest the free area's middle (`clampToDiscs`, `insideDiscs`). The wider pan can bring a neighbour
  within ENTER_RADIUS of a still view, which then focuses it by the usual auto-focus rule (accepted, as an interior's
  180 m pan already can): at 14 St (L02, 132, D19; 166 m) a view held about 160 m west of 132 focuses 8 Av (L01). The
  landing itself never does (within 100 m of a member, `bareStationFrame`). Dropping focus (zoom out,
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
  came in (so the controls' damped lag and glide stay, and fingers held still never pull the view back against a fly-to). The pinch keeps zooming under a rotate lock, so a twist and a pinch in one
  gesture do both (pah.6.1); a gesture locked to zoom never turns. A mouse or pen press forgets the fingers. A third finger, any lift or a cancel ends it, a new
  first touch forgets every finger (a lost pointerup can't count a stale one), and only a later touch making exactly two
  fingers down starts the next. A pinch with modest drift turns nothing.
  A bare station pivots on its own point (a complex on its member nearest the free area's middle) while that point is
  within 100 m of the free area's middle, else on that middle, so a far-off or held station can't swing the view away. Markers and dots rescale with distance
  (`screenScale`) so they stay legible when zoomed out.
- Every `on*` handler passed to `MapControls` (today `onStart` and `onEnd`) stays referentially
  stable (`useCallback` + refs): a changed handler makes drei dispose and reconnect the controls,
  which can lock them mid-drag. Set control limits imperatively in `useFrame` (priority -2, before
  drei's `update()` at -1; the pivot and pan clamp at -0.5; the band view at -0.25), not as changing props. Never use a
  positive `useFrame` priority (it takes over rendering). The frame order: -3 LiveTrains steps every slot and writes
  the follow anchor (with the last frame's band view); -2 CameraRig (the follow's `beforeFlight`, the flight step,
  focus, the polar lock), the touch twist's goal (`useTouchOrbit`) and the orbit's bounds; -1 drei's `update()`; -0.75 the train follow; -0.5 the orbit's pivot
  and pan clamp; -0.25 the band view and the interiors' presence (`PresenceDriver`); 0 the draws (and `useBasemapTiles` reading the camera, read-only).
- The trip route frame (`useRouteFlight.ts`, 2q7.45.5): with the trip panel in front, a settled plan (its ends and attempt, never a
  silent tick or poll) or a journey or list the visitor opens or leaves (the token is the view plus the journey key, so the first
  journey reframes too) flies the camera top-down and north-up to the whole selected journey, every point of its spans and stations
  (`routeFramePoints` over `useTripRoute`'s ride spans, the same ones TripLines draws, and its straight ones (TripDashes), which App passes down through Scene as CameraRig's `tripRoute`, plus the journey's stations; with no route to draw, its patterns still loading, its spans unmappable or only changes inside a station, nothing frames; `front` is `usePanelCollapse().front === 'trip'`) inside the free rect less 32 px (`frameTopDown`: the
  smallest distance at or above `ROUTE_MIN_DISTANCE`, EXIT_DISTANCE plus 0.1%, so the fit is exact and focus drops, the focus machine's
  test being strict; clamped to the zoom-out limit). It is not a `FlyRequest`: it starts through CameraRig's `startFlight` (clearing
  the hold and the pending reframes), never sets or lifts the basemap's location cap, and records its flight only if one started. It
  never fires (`routeFrameDecision`) behind a train panel or notice, over a follow, a gesture or another flight, or for a plan the
  visitor moved the view during (a drag, pinch or wheel past the click slop, `useViewMoved`, or a station request since the plan began
  loading, or since the ends changed or the panel opened: a plain tap is not a move); a skipped route never fires later. A panel or
  viewport change retargets its flight. After it lands, while it is the last landing, the trip panel is in front and no gesture has
  begun (`useRouteReframe`, `lib/routeReframe.ts`): a user collapse or expand of the panel (`usePanelCollapse().seq`), or one measured
  panel move that shifts the free rect's bottom within 2 s of the landing (a press or key closes that window), waits for the panel to
  hold still (`collapseDueIn`) and reframes once onto the route in the new free rect, 0.6-1 s eased, no turn, only when it moves
  anything; a reduced-motion landing snaps and re-snaps once just after on a panel, size or inset change (`shouldResnapPoint`). The reframes frame only the route still drawn: an ends change, a non-ready plan or a different route (skipped or none) forgets the landed flight (`routeIsFramed`); a retry's settling, new ends and the panel opening reset the visitor's move.
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
  an explicit `renderOrder` from `src/scene/renderOrder.ts`: station streets (focused and in view) 0.35, cross-fading by look A's
  veil share into their veiled stroke at 7.5 above the veil (`PresenceStore.veilShare`; TEMPORARY `?streets=` forces either), basemap park 0.36, water 0.37, path 0.38, minor 0.39, major
  0.40 and highway 0.41 (all depthWrite off too, since cars on a station ramp run below the street), lines 1, station tie 1.5, line focus 2, trip route 2.1 (`TripLines.tsx`), a straight-drawn trip ride 2.2 (`TripDashes.tsx`),
  you-are-here accuracy disc 0.5 and edge 0.6, station fill 3, station ring 4, trip mark halo 4.4, trip walks 4.45
  (`TripDashes.tsx`; 7.55 above the veil while look A's veil is up (`veiled`: any interior drawn, and the focused station's own when one is focused) and it reveals), trip mark ring 4.5 and dot 4.55
  (`TripMarks.tsx`), train halo 5,
  car halo 5.5, trains 6, the selected train's outline shells 6.03 (rim) and 6.06 (gap) while the other trains are still dots
  (carMix below 1; painted before any body, which covers their inside), otherwise 6.51 and 6.52 (after the bodies,
  depth-tested against them), selected train rim 6.1, halo 6.15 and dot 6.2, you-are-here halo 6.4, cars 6.5,
  you-are-here reticle 6.55, the place pin's halo 6.57 and the pin 6.58, street-file entrance marks 7.6 (above the veil at 7, under the interior strokes),
  above-veil platform cars 9.45 (footprints), 9.5 (bodies), then 9.51 (selected rim shell) and 9.52 (gap shell),
  at a multi-deck interior the band between decks 9.53 (fine) and 9.54 (strong) and the next deck's cars 9.55 to
  9.565 (a third deck: 9.57 to 9.595; `strokeOrders`, `spanCarOrders`),
  the trip's exit path over each stroke band, under the next deck's cars (`strokeOrders(...).exitPath`: 9.3 band 0,
  9.545 and 9.578 the mid bands, 9.8 the top band),
  interior levels above the lifted trains 9.6 (fine) and 9.7 (strong), focus ring 10 (`FocusRing.tsx`, `theme.stationFocus`, only for a focused station with no interior).
  The focused station (picked or auto-focused by zoom), and the other members of its complex once the interior that covers them is loaded, draw no marker and no
  station tie: its panel and interior mark it, and it stays pickable. Every other drawn interior's stations (o3r.4) keep
  theirs, faded toward the background by `interiorOpacity` × that interior's presence, and stay pickable; ScenePicker treats
  them as hidden like the open station (a train in reach wins; a direct tap with none picks the station).
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
  the same pixels after them. Along those a variant rides its primary's band slot and half-width (`corridorShare.ts`),
  so its trains ride where the primary's do. Don't add per-route `<Line>`s.
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
- Station markers are instanced: matrices are rewritten only when the scale or focus changes. A complex keeps one marker and tie per
  member, each on its own line; a tap on any selects the complex (`select` focuses its lead), and auto-focus enters from any member
  (`nextFocus` maps the nearest member to its lead and measures the exit from the nearest member). With the complex's interior
  loaded every member's marker and tie hide (`hiddenSiblings`); a bare focused complex keeps them all, the lead with the focus ring.
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
  layer, live trains included, in one draw call (under look A one `ScreenVeil` for all drawn interiors, never one each, scaled by `veilShare`: none while a bare station is focused), at `veilWeight` (opacity × depth factor, `interiorReveal.ts`);
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
  target within 100 m of a member) when that shows more of the path, or as much of it and more machines (`priorityLanding`). Above a phone's panel the target sits 130 m or
  more toward the camera from what the free area shows, so at Union Sq the Lexington and Canarsie paths, and the station-house
  machines at Pelham Pkwy (211), can't be framed within 100 m looking north and land as usual, part of them under the panel
  (collapsing the panel to its bar frames them, `useCollapseReframe.ts`; `pathFrame.data.test.ts`, `outageFrame.data.test.ts`; a phone panel with the outage list expanded leaves too little free area
  for any frame); a bare station lands with its point (a complex's other members' points next) and as many entrance marks as fit in the free area above the panel, at that distance or farther (to 600 m), its target within 100 m of the station or a member (120 m when only the station fits; `bareStationFrame` in `freeFrame.ts`; streets loading late reframe after landing like an interior; a phone panel that changes height within 2 s of landing reframes once onto the marks when that frames more, `useCollapseReframe.ts`). Both
  retarget mid-flight when the interior, a bare station's streets (or the index, for a deep link) or the panel's final size arrives. An interior arriving after 90% of the
  flight, or after landing, is framed after landing by a 0.6-1 s eased flight that decides the landing turn then,
  unless a gesture, another flight, a follow or a focus change came first (`useInteriorReframe.ts`,
  `interiorReframe.ts`). Under prefers-reduced-motion station and point flights snap with no turn, and a late
  interior snaps once onto it, no turn. The
  location button frames its fix at EXIT_DISTANCE (1450 m, top-down, outside the focus range) or farther; a searched place lands at
  600 m, tilted, inside it, and auto-focus stays out until the view is moved (`lib/placeHold.ts`).
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
  stops may belong to any member. Authored only; a generated interior for any member is dropped. A complex file must cover its catalog complex's lead
  (`data:stations` checks), since the map focuses only leads.
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
  Answers carry `attribution`; the search dialog shows each source's credit under the results that use it (2q7.16). Upstreams see the Worker, never the
  client's IP or headers. `/geocode` refuses a request with no allowed Origin (403).
- **Address search (2q7.16).** Only `/geocode` carries what the user types in a search dialog (a street or an intersection too: an intersection the index finds goes to neither upstream, a street the index finds still goes to NYC GeoSearch (not Photon), and anything else goes to GeoSearch and, as before, Photon; a business-looking name always asks both), and only with `VITE_RT_URL` set
  (without it the dialog finds stations only, shows no street search, no disclosure and sends nothing). A request goes 250 ms after the last keystroke,
  for 3 to 100 code points of normalized text, the stale one aborted, with `cache: 'no-store'` and `credentials: 'omit'`; complete
  answers are remembered in memory for the session (no storage, URL or history). The query is never in the page URL, history, storage
  or a console line (failures log a fixed kind and status). `focus` is the focused station, else the camera target, rounded to
  2 decimals, and is left out whenever it lies within 2 km (or twice the framing radius) of a shown location fix, or of the last
  location flight's center, or is the station nearest the fix (`lib/geocodeFocus.ts`; `lib/locateMemory.ts` remembers the flight's circle
  and nearest station id in memory, through later flights and a cleared fix, until the camera target is farther from it than the guard,
  when it is forgotten; a fix the search dialog found with no flight is remembered the same way (`rememberUnviewedFix`) in a list beside the flight's slot (`locateMemoryFor` returns all of them, each held until its own rule forgets it: an armed flight when the view leaves, an unviewed fix only once the camera target has come within the guard and left, so a far view never forgets it; a later find is added, never written over an earlier one, except that a find of the same station whose guard covers a never-visited entry's whole guard (a press repeated on the spot, 100 m slack) takes that one entry's place; no cap drops the oldest); the fix is only read there, to exclude, and no URL builder takes it; `searchFocus` is the one builder StationSearch's request calls, and `src/data/geocodePrivacy.test.ts` builds request URLs through it for shown, unviewed, flown, flown-then-found-elsewhere, two-found-fixes and far-view cases and finds only `q` and a far `focus`). The dialog states this on screen.
- **Street and intersection search runs in the Worker, on a bundled index (2q7.14).** `worker/data/streetIndex.json` (OSM
  streets within 300 m of a station, ODbL; the file, its pin `data/streets/` and the scripts that build it are in the public repo,
  which is how the derivative database is offered) is a module of the Worker, not a client file: the client downloads nothing of
  it, and a typed street goes to `/geocode` like any address (so it falls under the Address search rules above, no query logged).
  `/geocode` rows from it carry source `osm` and the credit "© OpenStreetMap contributors" in `attribution`. It is refreshed by
  `refresh-data.yml` with the rest of the data and deployed by merging to `main`; a malformed committed index fails `/geocode` (a 500, no query logged) and nothing else, which `streetIndexOutputs.test.ts`, the Worker's `streetIndexData.test.ts` and the PR review catch first.
  Contract v2 (`GEOCODE_SCHEMA_VERSION`): an old client against the new Worker reads "address search unavailable" until reload.
- **Walk shards are fetched only on a user action.** `data/walk/<id>.json` reveals its station id to the static host, so
  `useStationWalk` is called only with a station the user picked, focused or chose as a trip endpoint (never `nearestStation`
  of a fix); no request carries the fix or the destination, and routing runs on the device.
- **View interiors are fetched only for the stations in view (o3r.4).** `useViewInteriors` loads interior files only for the
  ids in o3r.2's `ViewStationSet`, which is camera-driven, empty from 1250 m out and while the location cap is in force, and
  never keyed by the location fix or `nearestStation`; so no interior is fetched after a locate flight until the user moves
  the view. Each interior file is cached for the session (unbounded; a few KB each); one that failed is not asked for again for
  `VIEW_RETRY_MS` (30 s).
- **Member street files are fetched only for a complex lead the user focused or the camera shows** (and the trip's To and
  From complexes, through `useTripExit` and `useTripBoard`): each member is part of the station opened or in view; never for
  a fix's nearest station. View-driven street fetches (`useStreetLayers`, o3r.5) take only o3r.2's view set: nothing from
  `REVEAL_FAR` out, nothing while the location cap is in force (empty until the user moves the view), never keyed by the
  fix or its nearest station.
- **Trip exit.** Once a plan for the trip panel's ends is ready, `src/data/useTripExit.ts` loads the To station's interior
  (`useInteriorModel`, the focused interior's cache) and street files (the interior file id's and, for a complex, the
  alighting member's; `useStationStreetsLoad` tells loading from missing, and the line waits for both). An end filled from
  the location fix and never picked or focused since (`trip.fixEnd`, `lib/tripFix.ts`; through a swap or the way-back pick too)
  fetches nothing until the rider picks or focuses it, for From and To alike (App passes `allowed: trip.fixEnd !== 'to'` here,
  `!== 'from'` to the trip board); every other end the user chose, so this fetch reveals nothing they did not pick. It
  finds each journey's quickest way out (`quickestExit`, avoiding machines out of service; with no fresh outage data none
  are closed, and the line says the status is unknown only when the station panel would: never while still connecting). The map draws the selected journey's (opened, else the first; one ending on a train) at the To station while the trip panel
  is open, even under a train panel; only once that station is focused. It fetches no walk graph: only the DEV
  `__underground.exitTo(x, z | null)` seam aims it at a point (and loads that station's walk graph) until 2q7.14.
- **Trip board (2q7.45.7).** `src/data/useTripBoard.ts` mirrors the trip exit at the From station: once a plan is ready it
  loads the From station's interior and street files (the interior file id's and the boarding member's) and gives each
  journey that boards its first train in the From complex its quickest way in (`quickestEntry`, machines out avoided as for the
  exit), drawn for the selected journey while that interior is focused. Only when the visitor chose From: a From filled from
  the location fix (`directionsTrip`'s `fixStation`; `TripProvider`'s `fixStation`/`fixEnd`, kept through later picks and swaps,
  cleared when the visitor picks that station or focuses it) fetches nothing (App's `allowed: trip.fixEnd !== 'from'`), since
  the request would name the fix's nearest station. A journey that walks to another station first gets no way in (that station
  comes from the plan). Never a walk graph, no dev seam.
- **Trip transfers.** While a plan is ready, `src/data/useTripTransfers.ts` loads every hand-authored interior in the index
  (`authoredInteriorIds`, `useInteriorModels`; today 635 and L08, under 5 KB gzipped), not only the change station's, because
  the change station is derived from the plan rather than chosen, and fetching it alone would reveal it. Each change whose two
  stops are in one of them gets `chooseTransfer` (machines out avoided as for the exit) and a transfer line; the map draws, per
  interior, the selected journey's change there (none when it is across one platform). The router's change time stays transfers.json's (180 s at
  Union Sq). Revisit fetching all of them above about 8 authored files.
- **Location never leaves the device.** The location button, and the search dialog's "Use my location" (2q7.46: no camera
  move; its "My location" row in the HUD's search flies as a `'locate'` point flight), make one `getCurrentPosition` per press (no
  `watchPosition`) and keep the result in memory only: no storage, URL, log or request carries it (the address search's `focus` is
  the map's, kept away from the fix). A trip end set from "My location" is its nearest station with the note "you", a chosen end
  like any other: it fetches nothing that carries the fix and no walk graph (the To station's interior and streets through
  `useTripExit`, as for any To; a From end's files only as the trip's other consumers load them), and the ranking by distance runs on the device. Basemap tiles
  follow the camera, never the fix. After a location fly-to, tiles load no finer than z12 (several km a tile) until
  the user moves the view (a drag past the 6 px mouse / 10 px touch slop, a wheel step, a second finger) or picks a
  station or a searched place (tap, panel, search; only a `'locate'` point flight sets the cap); a tap that doesn't move, or the controls' `start` alone, keeps the cap
  (`lib/basemap/locationCap.ts` the machine, `locationCapHandle.ts` the one shared object, `isCapped()` plus `subscribe`; fed by
  `src/scene/useLocationCap.ts`, run by `LocationCapSource.tsx` which Scene always mounts, so it exists with no basemap pin or
  `?basemap=off`; it applies the fly request in a layout effect, so the cap is in force before any frame of the flight, even a
  reduced-motion one, and takes pointer events through `useViewMoves.ts`; dev `__underground.locationCapped()`). `useBasemapTiles.ts`
  mirrors it onto `store.capZoom`, and view-driven station fetches (o3r) will read the same handle. Following a train or keyboard
  input doesn't lift it. Tiles already loaded still draw.
  The stations-in-view set (`useViewStations.ts`, o3r.2) reads the same handle: while the cap is in force it chooses nothing and the
  set is empty (the focused station too), and its inputs are the camera, the free rect and the focused id, never the fix or `nearestStation`.
- **Realtime has no lat/lon.** Vehicle positions are stop-relative, so dots are
  interpolated along shapes from TripUpdate times and scheduled segment run times.
- **Static GTFS is processed at build time only.** `scripts/` turns the regular zip
  into `public/data/*.json`; the supplemented zip becomes `timetable/dated/` in each Pages deploy, never in git (`npm run data:dated`). The 60 KB gzip budget (`scripts/lib/budget.ts`) is the one size limit, shared by
  every top-level `public/data/*.json` the client loads up front, `station-depths.json` included (59.2 KB today,
  about 800 B of headroom; the depths file is about 1.6 KB of it; `route/transfers.json` is on demand, in the trip planner's chunk, with its own cap); `data`, `data:access` and `data:stations` each fail above it. Per-station interiors, street, walk and timetable files don't count (they have their own caps in `budget.ts`: 16 KB gzipped each for streets, 64 KB for walk, a total for each of those two, 48 KB per `public/data/timetable/` file (the dated ones too, plus a total for `timetable/dated/`), 16 KB for `public/data/stations/equipment.json`; the Worker's `worker/data/streetIndex.json` is outside `public/data` and has a raw cap of its own).
- **Data refresh is automated.** `.github/workflows/refresh-data.yml` runs daily and
  opens or updates one PR on `chore/data-refresh` when `npm run data`, then `npm run data:stations` (the
  generated interiors follow the new shapes and stations), then `npm run data:streets` (the street files follow
  the stations), then `npm run data:walk`, then `npm run data:search:streets`, change `public/data` or `worker/data/streetIndex.json` (the one file the refresh writes outside `public/data`; both workflow jobs allow exactly that path). A station new to the feed gets a street file from whatever pinned ways lie
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
  for Photon rows, "© OpenStreetMap contributors" for the street index's `osm` rows) is shown under the results that use them, in the search dialog.

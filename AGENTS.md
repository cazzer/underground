# underground

## Purpose
A live view of the NYC subway as a static site on GitHub Pages
(github.com/cazzer/underground). It opens on a zoomed-out, low-fi architectural
wireframe map with small dots for moving trains. Pinch/scroll zooms. Zooming toward
a station continuously tilts the camera from top-down to isometric; later that view
shows the station's levels, stairways, and upcoming arrivals.

Status: the real static network (every route shape and station from `public/data/`) renders, and
trains are live: the client polls the deployed realtime Worker (`worker/`) and draws dots from the
pure realtime library. The station panel shows real arrivals. Bedford Av (L08) has a hand-authored interior, and
about 250 more stations have generated ones (labelled "Estimated layout"), shown to everyone since 9wc.5.
With no `VITE_RT_URL` there is no live data (the HUD says "Live trains off") and no fake motion.

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
  (downloads it unless `--zip` or `$GTFS_ZIP` is given; needs Node >= 22.18). Never commit the zip.
  Also reads the pinned `data/stations/catalog/stations.json` for each station's borough and ADA status;
  after `data:catalog:fetch` run `npm run data:access` instead (offline).
  A station the catalog lacks, or an orphan catalog row, needs an entry in
  `data/stations/access-exceptions.json` (see `data/README.md`); the join fails loudly otherwise.
- `npm run data:access`: offline; reruns the borough/ADA join on the committed `public/data/stations.json`
  with the pinned catalog and exceptions, prints the gzip total against the budget.
- `npm run data:stations`: merge `data/stations/*.authored.json` with the pinned `*.sources.json`
  into `public/data/stations/*.json`, generate the template stations from `data/stations/catalog/` plus the
  committed `public/data/shapes.json` and `stations.json` (a hand-authored station wins; it prints each skipped
  candidate with its reason and each dropped source row), and pack `public/data/station-depths.json` (every interior's
  platform tracks and rail heights; it counts toward the shared 60 KB budget). It prints a `WARNING:` line listing
  interior tracks no drawn line rides (packed as no track, so the client stays quiet about them), and fails if any
  track packs more than 2 m off its runs. Offline.
- `npm run data:stations:fetch -- --station L08`: uses the network (Overpass, data.ny.gov); refreshes the
  pinned `data/stations/L08.sources.json`. Review the diff, then rerun `data:stations`.
- `npm run data:catalog:fetch`: uses the network (data.ny.gov, Overpass); re-pins the citywide catalog in
  `data/stations/catalog/`. Review the diff, then rerun `data:access` and `data:stations` (the generated interiors
  are built from it; `generatedOutputs.test.ts` fails while they are stale). `npm run data` reads only `catalog/stations.json`.
- `npm run data:streets:fetch -- [--no-walk]`: uses the network (Overpass, by hand); re-pins the OSM streets and walking ways
  within 300 m of any station point into `data/streets/` (a manifest plus sharded `cell-*.json`; ODbL). Review the diff;
  `streetsData.test.ts` checks it. Rerun `data:streets` and `data:walk` after it.
- `npm run data:streets`: offline; builds `public/data/streets/<stationId>.json` for every `stations.json` station from
  the street pin and the catalog entrances (clip to 300 m, simplify, project to decimeters, join each entrance to its street).
  Rerun it after `data`, `data:streets:fetch`, `data:catalog:fetch` or a change to the `searchText.ts` synonyms (street join
  keys use them); `streetsOutputs.test.ts` fails while the files are stale. It builds and cap-checks every file before
  writing, prints the largest files, the totals and the join log (no street, near misses, bridge/tunnel ways, far entrances),
  and checks the startup budget total did not move. If a file passes its cap, lower the one global `WALK_RADIUS_M` in
  `scripts/lib/streetsBuild.ts` (footways only), never per file.
- `npm run basemap:fetch [-- --out path]`: downloads the pinned NYC basemap (`data/basemap/basemap.json` `pin`, a GitHub Release
  asset) to the gitignored `public/basemap/nyc.pmtiles`, sha256-checked, no network once it matches; fails while the pin is
  null. `npm run basemap:gate -- <source|output> <metadata.json>` is the workflow's licensing gate (offline) and
  `npm run basemap:verify -- <url> <bytes>` its Range check (network; the deploy's `verify-basemap` job runs it). The basemap is
  built by hand-dispatching `.github/workflows/basemap.yml` (see Data below), then pinned in a normal PR.
- `npm run data:walk`: offline; builds `public/data/walk/<stationId>.json` (the walk graph: every walkable pinned way within
  300 m, junctions shared, OSM node ids, x/z in dm around the stations.json point, edges with kind and length; oneway ignored)
  for every station from the street pin. Rerun after `data` or `data:streets:fetch`; `walkOutputs.test.ts` fails while stale.
  Caps in `budget.ts` (64 KB per file, 4.5 MB total), outside the startup budget.

Run typecheck, test, and build before reporting work done. Pushing to `main` deploys
via `.github/workflows/deploy.yml` (Actions to Pages).

Worker (its own package and lockfile; run `npm --prefix worker ci` once):
- `npm --prefix worker run dev`: `wrangler dev` on `http://localhost:8787/rt`
- `npm --prefix worker run typecheck` / `test` / `gen`: `gen` regenerates `src/gen/`
  from `proto/subway-rt.proto`
- Root `npm test` does not run worker tests; the `worker` CI job does.
- Worker deploys are controlled by GitHub Actions: the `worker-deploy` job in `deploy.yml` runs
  `wrangler deploy` on every push to `main` after the `worker` checks pass, using the repo secrets
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (skipped with a warning while they're unset).
  Agents never run `wrangler deploy` or `wrangler login` themselves; merging to `main` is the deploy.
- The Pages build reads the repo variable `VITE_RT_URL` (the deployed Worker's `/rt` URL).
- The Worker's Cache API layer is a no-op on workers.dev; edge caching needs a custom
  domain (tracked in 8x4.5). The per-isolate memo and upstream `cf.cacheTtl` still apply.
- The client finds the Worker through `VITE_RT_URL` (copy `.env.example` to `.env.local`).

## Directory map
- `src/main.tsx`, `src/App.tsx`, `src/index.css`: entry, root layout, Tailwind + theme CSS vars
- `src/theme.ts`: all colors, line widths, fonts. Blueprint is the only theme (the user's pick): don't add
  other presets, and don't make evidence or cards in other themes. Route colors are
  GTFS data drawn through `theme.routeLineMix` (mixed toward a theme color; amount 1 = mono), then
  pushed to at least 3:1 against `theme.background`.
  TEMPORARY: `?lines=a|b|c` picks the lines look until the 8x4.3 options round is decided (default b)
  Interior tokens (`interiorStroke`, `interiorTrack`, `interiorEntrance`, `interiorFine`,
  `interiorElevator`, `interiorEscalator`, the two widths, `interiorDepthFade`) color the station interior.
  TEMPORARY: `?interior=a|b|c` (veil, cutaway, ghost under; default a) and `?interiorY=1|2|3`
  (vertical exaggeration; default 2) until the 8x4.11 cards are decided; the removal list is in
  `src/scene/interiorLook.ts`
  Street tokens `streetStroke` (faint by color, not alpha) and `streetWidth` draw the focused station's streets.
  TEMPORARY: `?streets=under|over` (under the route lines at 0.35, or above the veil at 7.5; default under) until
  the ost.7 card is decided; the removal list is in `src/scene/streetsLook.ts`
  Car tokens `trainCarSideShade`, `trainCarEndShade` are linear multipliers of a car's route color.
  `bandPitchPx` (2.5) is the gap between routes drawn side by side in a shared corridor.
- `src/scene/`: the r3f scene
  - `Scene.tsx` canvas; `MapGrid.tsx` ground grid (fades out by 30 km); `CameraRig.tsx` MapControls,
    HUD-aware fit-to-city framing, zoom-driven tilt, fly-to, auto focus, interrupted-fly-to focus hold;
    `cameraFlight.ts` its fly-to destinations (interior, bare station, point; `follows` marks a flight to the selected
    train), `newFlight`, `flushMotion` and the landing turn;
    `useStationOrbit.ts` the focused-station orbit (azimuth bounds per frame, pivot, pan-radius clamp, first-turn signal);
    `useInteriorReframe.ts` frames an interior that loaded too late for its station flight (after LATE_TURN_PROGRESS
    or after landing): once landed, a 0.6-1 s eased flight onto it with the landing turn decided then (reduced motion
    snaps, no turn); a gesture, another flight, a follow or a focus change cancels it (`interiorReframe.ts`, pure);
    `useTrainFollow.ts` the camera follow of the selected train (see Rendering conventions); `useFollowAnchor.ts`
    LiveTrains' -3 frame: steps every slot and writes the selected train's drawn point (`lib/live/followAnchor.ts`)
  - `SubwayLines.tsx` (one merged LineSegments2 via `useLineLayer.ts`; draws `network.shapes` until the banded
    shapes arrive, then eases them in over 300 ms (`BandView.ease`: offset and split blend linearly from unbanded, so no fold); writes the shared `BandView` (Scene owns it; LiveTrains reads
    it) and the band uniforms per frame at priority -0.25); `usePlatformFade.ts` writes the loaded interior's
    per-segment platform fade for every band layer (the `?lines=` overlays too); `bandLineMaterial.ts` `BandLineMaterial` (LineMaterial
    with `BAND_GLSL` patched into its vertex shader and the platform fade into its fragment alpha; the patches throw
    if three's anchors move) and the shared `BAND_UNIFORMS`; `useLineLayer` uses it for buffers that carry `bands`; `StationTies.tsx` a thin vertical tie
    from each station marker with a depth down to its sunken platform tracks (`network.stationTrackY`; one
    LineSegments2, `theme.stationTieWidth`; `scale.y` = the depth factor, opacity ramping in from depth 0.35 to 0.65; the focused station's tie is dropped when it has an interior, kept (or a `STUB_DEPTH_M` stub in `lib/stationTie.ts` when it has no depth) when it has none or its load failed); `LineHighlight.tsx` holds the
    temporary `?lines=a|c` layers; `Stations.tsx` (two InstancedMeshes; the focused station's
    instance is scaled to 0 when it has an interior (ready or loading), so it has no marker, and drawn when it has none or its load failed, with a `theme.stationFocus` `FocusRing.tsx` over the trains (`focusedMarkerShown` in `interiorLoad.ts`, passed down as `focusedMarker`); `markerShape.ts` the marker constants);
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
    `cameraDistance.ts` helpers; `renderOrder.ts`
  - `SpanCars.tsx` / `useSpanCars.ts` the above-veil copies of the cars on a revealed station's platforms (12
    trains, most on the platforms first; only cars with a weight above 0; the selected rim with them; overflow
    in `?debug`); `veilTint.ts` (its pure shader patch in `veilTintShader.ts`, tested against three's ShaderLib; a missing anchor logs once, never throws) their material, mixing each instance toward the background after shading, as the
    veil blends, so a copy at weight 0 renders exactly like its veiled street car. Along those platforms the map
    track fades out as the interior reveals, in the band line shader (per-segment fade weights, `platformMask.ts`)
  - `StationInterior.tsx` the focused station's interior (two line layers on each side of the lifted-train split; for a generated interior every material is dashed (`interiorApproxDash` / `interiorApproxGap`) and per-segment `distances` cut only platform/slab outlines and slab guides; `InteriorVeil.tsx`, level
    labels: plain DOM divs in the canvas container, placed per frame by `useLevelLabels.ts` (not drei `Html`, whose per-label React root unmounts inside a layout-effect cleanup and logged "unmount a root while already rendering" under StrictMode), text with a background-colored `text-shadow` halo instead of a filled chip so strokes show through); `interiorModel.ts` interior JSON to a
    drawable model (theme colors, labels, camera target); `interiorLook.ts` TEMPORARY look overrides
  - `StationStreets.tsx` the focused station's streets (interior or not): one plain LineMaterial layer at y = 0 in a
    group at the street file's anchor, `theme.streetStroke` / `streetWidth`, opacity `interiorOpacity` (so it fades in
    with the reveal and goes with the focus); keyed by station; `streetsLook.ts` TEMPORARY draw-order switch
- `src/ui/Hud.tsx`: Tailwind overlay (the header has a `from-canvas` to transparent gradient behind it, `pointer-events-none`, so strokes panned under its text stay out of the way; title, live status, a screen-reader-only announcer for the gone notice, arrivals
  panel: the station name, a focusable heading (`tabIndex -1`) that ends with the access glyph (`StationName` in `AccessIcon.tsx`: an aria-hidden glyph kept on the last word
  plus sr-only ", <accessLabel>." text, so the heading announces it; none for stations that aren't accessible) and, for partly accessible stations only,
  a dim aria-hidden `PartialAccessNote` line, then `InteriorStatus` and the arrival rows (their "Arrivals" heading is sr-only; `ArrivalsList.tsx`: a row whose train the map draws is a button that selects the soonest such train, `selectableArrival` over `ArrivalGroup.tripKeys` and `ArrivalsSource.drawnKeys`, so the keyboard reaches trains; the others are `aria-disabled` no-ops that look like text, so a poll never drops focus; every enabled row has an `aria-description` naming the arrival it picks), nothing else; closing the station panel (× or Esc) moves focus to the Search button; `TrainPanel.tsx` holds the selected-train panel, which covers the station panel and takes focus on
  each pick (one row under the heading: "Following" with a Stop button while the camera follows the train, else a "Follow
  train" button; the same button node, so toggling keeps focus and the panel's size; its `TrainStops.tsx` lists the next stops: 3 rows, "Show all N stops", a 15 s tick; on phones the expanded list is capped at whole rows by
  `useStopListScroll.ts`, about 5 rows or a quarter of the screen, with a "more below" fade), and the "no longer tracked" panel shown for 10 s; Esc or × closes the train first, then the
  notice, then the station, and closing either of the first two returns focus to the station heading or else
  the location button); `LoadStatus.tsx` loading/error panel
  plus `SceneCrash`/`HudCrash`; `LiveStatus.tsx` the HUD live-trains badge (a polite live region);
  `ErrorBoundary.tsx`; `LiveDebug.tsx` dev-only `?debug` overlay (drawn count, drops by reason, join
  stages, per-feed trips/stale, offset/skew/age; updates per poll)
  `LocateButton.tsx` the header's location button (shows locating and located); `LocateStatus.tsx` its message (the sentence alone is the always-mounted live region)
  with a "Go to <nearest station>" action and a clear ×
  `InteriorStatus.tsx` the panel's station-layout line, one always-mounted live region: loading, error with Retry,
  and `ReadyLine` for a loaded interior (null for authored ones; for a generated one the dim line "Estimated layout",
  shown whether or not the interior is in view so it is announced once, and keyed by station so a cached generated
  station after another one is announced too; the one place a ready-state line goes)
  `SearchButton.tsx` (top bar) opens `StationSearch.tsx`, a full-screen native `<dialog>` (always mounted; the tap handler calls its `open()` so iOS raises the keyboard) with a combobox over a
  listbox of `SearchResult.tsx` rows (name and access icon, the borough on a dim line only for names whose stations span boroughs
  (`multiBoroughNames` in `labels.ts`), plus route chips, which tell same-borough duplicates apart); choosing a result
  calls `select` (focus then moves to the panel heading; Cancel and Esc return it to the button). `useKeyboardInset.ts`
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
    `platformSpan.ts` per station and shape the platform span `[d0, d1]` (`network.platformSpans`) and its
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
    waits for; `focusHold.ts` interrupted-flight release rule; `interiorReframe.ts` when a landed station flight reframes onto its interior, and how long; `follow.ts` the train follow's math (`followTargetInto`:
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
    `interiorConnectors.ts` stairs, ramps, escalators (a zero-run one gets a 30 degree run along the
    station axis; on its listing entrance its street end sits there and the run heads toward the plan center,
    down below ground and up at an elevated station; else it is centered, descending toward the center) and elevators (shaft squared to the axis, a stop at each end in that level's pass; machines take
    half the depth fade). An escalator is a band with fine handrails and travel chevrons; an elevator is four
    shaft verticals, a doored square at each stop and a fine cab inside it; `escalatorBanks.ts` `spreadBanks`: zero-run escalators whose bands would touch
    sit side by side across the axis in id order (an authored one off its entrance stays put; one listed
    by two entrances throws);
    `interiorAxis.ts` `stationAxis`, the principal direction of the longest platform outline;
    `interiorSegments.ts` the shared segment writer; `interiorFixture.ts` the tests' mini interior;
    `interiorFraming.ts` bounds, focus anchor (plan center, toward-camera shift, half-extent), level
    labels (`levelHeightText`: authored levels "−4.3 m"; on a generated interior an `ee-rise` depth is signed to one
    decimal, "+" above the street, and any other is "≈ −9 m", signed whole meters), padded hull; `interiorFade.ts` per-level fade share by distance from the street level;
    `interiorReveal.ts` distance to interior opacity. These have `.ts` imports
    because a scripts/ test loads them. `interiorCamera.ts` centers an interior fly-to (always `LANDING_DISTANCE`, the tilt's
    near distance) in the screen area the header, footer and station panel leave free, at the current azimuth, or
    on a portrait free area (`landingAzimuth`, ground height ≥ 1.5× width: phones) turned just enough that the
    platforms (`stationAxis`, `InteriorModel.axis`) run within 25° of screen-vertical, decided once per flight;
    `orbitLimits.ts` azimuth cap by tilt, short-way spring to north-up, soft pan radius, focus-point pivot;
    `orbitTurned.ts` the session's first-turn flag (set by `useStationOrbit`, read by `OrbitHint`); `turnMeter.ts` the
    hint's max net turn (signed, wrapped steps); `reducedMotion.ts` `prefersReducedMotion()`, one live query shared by
    the camera, live and line code
  - `searchText.ts` name/query tokens (accents, ordinals, abbreviation synonyms) and `osaDistance`;
    `stationSearch.ts` ranks stations for a query (exact, prefix, typo-tolerant; a number only prefix-matches as the
    last word and never with an explicit ordinal, so "14 st" and "14th" skip 145 St; half-typed long forms and ordinals
    like "14 stre" and "14t" keep matching). `stationHash.ts` parses and builds `#station=<id>`
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
- `src/lib/realtime/`: pure realtime-to-position library (no fetch, React or three.js); tests colocated,
  `fixture.ts` is the mini static world they share
  - `serviceDate.ts` addDays, servicesOn (calendar + exceptions), nyDate
  - `tripLookup.ts` trip-index to per-service trip-key maps and primary shapes
  - `joinTrip.ts` realtime trip to shape: path code, then origin key (startDate-aware), then the route's pattern
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
- `src/data/useStationHash.ts` keeps `#station=<id>` and the focused station in step with `history.replaceState`
  (no history entries): reads on mount and `hashchange`, writes on every focus change; an unknown id clears the
  hash and raises `linkNotice`. Called in `MapView` as a passive effect, after the HUD's inset measuring
- `src/data/loadStationIndex.ts` fetches and validates `public/data/stations/index.json` (the ids that have an
  interior; generated by `data:stations`, so nothing is hand-kept; `scripts/lib/stationOutputs.test.ts` checks it
  against the files; authored and generated entries count alike); `loadStationInterior.ts` fetch and outer-shape check; `interiorCache.ts` one promise per id, failures
  evicted; `interiorLoad.ts` the load types (interior and index) and their pure derivation; `useStationInterior.ts` the
  focused station's interior load (the index is fetched once on mount; stations it doesn't list never fetch); `useLocate.ts` the location button's one-shot
  geolocation (on press only, never watched; the fix lives in React state and nowhere else)
- `src/data/loadStationStreets.ts` fetches `public/data/streets/<id>.json` (contract `src/data/streetSchema.ts`) and
  checks its outer shape; a 404 is null with one warning (cached for the session), other failures reject (evicted,
  retried on the next focus). `useStationStreets.ts` loads the focused station's file on focus only (never at
  startup) into a cached `StreetLayer`: `src/lib/streetBuffers.ts` (pure) keeps the `isStreet` ways
  (`src/lib/streetClass.ts`), decimeters to meters, mixing to the background over the last 70 m of `radiusM` (`edgeFade`;
  segments are split at the ramp's ends). `fetchJson` throws `HttpError` (with `status`) on a non-OK response
- `src/data/schema.ts`: types of the six `public/data/*.json` files (`Station` carries `borough`, `ada`,
  and `adaPartial` on the 8 partial stations, from 39hk-dx4f via `scripts/lib/stationAccess.ts`); `src/data/codec.ts`: shared
  pure helpers (trip-id parsing, trip/segment keys, delta codec, shape decode). Scripts and client both import these
- `src/data/realtime.ts`: client re-export of the realtime JSON types and `RT_URL`; no fetching
- `src/data/stationSchema.ts`: the `StationInterior` contract for `public/data/stations/<id>.json`,
  `PackedDepthsFile` for `public/data/station-depths.json`, and `StationDepthsFile`, its per-track decoded form
- `public/data/`: preprocessed static JSON (generated; `npm run data`, `npm run data:stations`)
- `public/data/streets/<stationId>.json`: one file per station (`StationStreets`, `src/data/streetSchema.ts`), built by
  `scripts/build-streets.ts` (IO only) from the pin and `catalog/entrances.json`. Pure: `scripts/lib/streetsPin.ts`
  (`loadPin`, `waysNear`), `streetsBuild.ts` (`buildStationStreets`: `clipSpan`, `simplifySpans`, `onewayOf`, packing),
  `streetsEntrances.ts` (the station's entrances, `joinEntrance` from `entranceStreet.ts` and the join log), with
  `streetsFixture.ts` the tests' mini pin. Outside the startup budget; own caps in `scripts/lib/budget.ts`
- `data/basemap/`: `basemap.json` (the NYC basemap's `spec`: bbox, z15, layers kept and dropped; and its `pin`, null until the
  first publish) and `source-metadata.20261121.json` (the Protomaps metadata the terms were reviewed against, the gate's test
  fixture). `scripts/lib/basemapSpec.ts` (parse, release tag and URL), `basemapGate.ts` (licensing gate over `pmtiles show
  --metadata`), `basemapFetch.ts` (`ensureBasemap`), `rangeProbe.ts` (what a correct Range answer is); IO in
  `scripts/fetch-basemap.ts`, `gate-basemap.ts` and `verify-basemap.ts`. The file itself is never in git
- `public/data/walk/<stationId>.json`: one walk graph per station (`StationWalk`, `src/data/walkSchema.ts`), built by
  `scripts/build-walk.ts` (IO only) from the pin through `scripts/lib/walkGraph.ts` (pure; reuses `clipSpan`/`simplifySpans`/`waysNear`).
  Not loaded by the client yet (2q7.11).
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
- `scripts/`: `build-data.ts`, `build-access.ts`, `build-stations.ts`, `fetch-station-sources.ts` and `fetch-station-catalog.ts`
  (the only IO) and pure transforms in `scripts/lib/`, tests colocated. `lib/stationMerge.ts` is the station
  merge; `lib/stationProvenance.ts` (`markGenerated`: authored to generated, depth sources, archetype and
  confidence) and `lib/stationIndex.ts` (`buildStationIndex`, `NOT_INTERIOR_FILES`) are pure, and `build-stations.ts`
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
    for the drawn rise), `machines.ts` (E&E rows the merge can take, entrance links), `machineSites.ts` (`at`
    overrides; machines of one level pair at one site bank width + 0.3 m apart), `build.ts` (assembly; entrances
    whose stair can't land within the cap are dropped; dropped rows in notes and the log), `subway.ts`
    (`cutCover`, `shallow`), `elevated.ts`; `templateFixture.ts` synthetic one-station catalogs for
    `generate.test.ts`. `generatedOutputs.test.ts` checks the committed generated files are fresh
  - `lib/catalogFacts.ts` catalog to `StationFacts` (platforms go to their nearest station point; complexes
    flagged); `lib/pathwaysTopology.ts`, `layoutOracle.ts`, `archetypeScore.ts` score it;
    `score-archetypes.ts <feedDir> [--oracle file]` prints the report to stdout and writes nothing. The 2021 draft NYCT
    pathways feed it reads must never be committed, shipped, or used as a source; it refuses a dir inside any git work tree
- `worker/`: Cloudflare Worker that serves decoded MTA realtime as JSON at `/rt`
  - `src/schema.ts` the JSON contract (types and consts only); the client re-exports it
  - `src/index.ts` routing, memo + Cache API (15 s), CORS; `cache.ts` pure memo/herd-guard
    decision; `upstream.ts` feed fetches
  - `src/transform.ts` pure decode-to-snapshot logic; `cors.ts` allowed origins
  - `src/gen/` generated protobufjs decoder (`npm run gen`); never hand-edit
  - `proto/subway-rt.proto` trimmed subset of gtfs-realtime + nyct-subway
  - `fixtures/` recorded feeds for tests (see its README)
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
  arming. A bare station pivots on its own point while that point is within its 100 m pan radius of the free
  area's middle, else on that middle, so a far-off or held station can't swing the view away. Markers and dots rescale with distance
  (`screenScale`) so they stay legible when zoomed out.
- Every `on*` handler passed to `MapControls` (today `onStart` and `onEnd`) stays referentially
  stable (`useCallback` + refs): a changed handler makes drei dispose and reconnect the controls,
  which can lock them mid-drag. Set control limits imperatively in `useFrame` (priority -2, before
  drei's `update()` at -1; the pivot and pan clamp at -0.5; the band view at -0.25), not as changing props. Never use a
  positive `useFrame` priority (it takes over rendering). The frame order: -3 LiveTrains steps every slot and writes
  the follow anchor (with the last frame's band view); -2 CameraRig (the follow's `beforeFlight`, the flight step,
  focus, the polar lock) and the orbit's bounds; -1 drei's `update()`; -0.75 the train follow; -0.5 the orbit's pivot
  and pan clamp; -0.25 the band view; 0 the draws.
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
  an explicit `renderOrder` from `src/scene/renderOrder.ts`: grid -1, focused station's streets 0.35 (7.5 under
  the TEMPORARY `?streets=over`), lines 1, station tie 1.5, line focus 2,
  you-are-here accuracy disc 0.5 and edge 0.6, station fill 3, station ring 4, train halo 5,
  car halo 5.5, trains 6, the selected train's outline shells 6.03 (rim) and 6.06 (gap) while the other trains are still dots
  (carMix below 1; painted before any body, which covers their inside), otherwise 6.51 and 6.52 (after the bodies,
  depth-tested against them), selected train rim 6.1, halo 6.15 and dot 6.2, you-are-here halo 6.4, cars 6.5,
  you-are-here reticle 6.55, above-veil platform cars 9.45 (footprints), 9.5 (bodies), then 9.51 (selected rim shell) and 9.52 (gap shell),
  interior levels above the lifted trains 9.6 (fine) and 9.7 (strong), focus ring 10 (`FocusRing.tsx`, `theme.stationFocus`, only for a focused station with no interior).
  The focused station (picked or auto-focused by zoom) draws no marker and no
  station tie: its panel and interior mark it, and it stays pickable.
  The one depth-tested layer is the car bodies (depthTest and depthWrite on, still `transparent`): at iso
  tilt a far car would otherwise paint over a near one. It is safe because nothing before it writes depth
  (MapGrid turns off the drei grid's depthWrite, since cars on a station ramp run below the street), and everything after it (veil, interior) has depthTest false.
  The above-veil platform car bodies (9.5) test and write depth too: they copy their street cars' matrices, so
  they pass where those drew and a nearer street car stays in front. The selected outline shells (street and platform)
  test depth but never write it.
  drei's Grid is transparent, and three.js draws all opaque objects before all transparent
  ones, so `renderOrder` only sorts within a list; depth precision is too coarse at map
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
  and a station wins unless a train is 6 px closer or the station is the open one. A station's target grows
  to its drawn marker at close zoom; a touch with no station in reach (the open station, whose marker is hidden, doesn't count) gets 22 px
  for trains; cars are tested
  along their floor and roof lines. No meshes carry r3f pointer handlers.
- Live train dots and cars are instanced too, with per-slot colors (`routeLineColor` like the lines; car
  instance `slot * MAX_CARS + c`). Their per-frame
  path (`useFrame` in `LiveTrains.tsx`) must not allocate or throw: errors there bypass error boundaries.
- The station interior is a group at `toGround(anchor)` with depths drawn ×2 × the depth factor (the group's
  `scale.y`; x/z true and never rescaled, since dashes are object-space; labels give real depths). Merged `LineSegments2` (fine, then strong strokes, a pair on each side of the split below) are built from the deepest
  level up, so upper levels paint over lower ones; levels farther from the street (in level count; deeper, or
  higher at an elevated station) mix toward the background (`src/lib/interiorFade.ts`). The camera aims at the
  interior's mid-height, halfway between its lowest and highest level. It fades
  in between 1250 m and 1000 m (`interiorReveal.ts`), as a flat plan while the camera is only slightly tipped. A background-colored veil (render order 7) dims every street
  layer, live trains included, in one draw call, at `veilWeight` (opacity × depth factor, `interiorReveal.ts`);
  level labels show by `labelOpacity` (gated between depth 0.35 and 0.65); the interior draws at 8 (fine) and 9 (strong);
  look C uses -0.6 and -0.3. Trains on the revealed station's platforms
  are redrawn above the veil and the strokes of their platform level (`SpanCars.tsx`, 9.4 to 9.5; not in look C),
  and the levels above it draw over those trains at 9.6 (fine) and 9.7 (strong): `buildInteriorBuffers` splits at
  `splitLevel` (`trainLevelIndex`, the deepest level with a platform track). That level and below stay at 8/9; a
  level above it goes over; a stair, escalator or elevator shaft from it (or below) up to a level above it is cut
  at the trains' roof (`trainRoofY`: rail ×yScale plus the car's floor and body height from `src/lib/carDims.ts`,
  not exaggerated; `SplitAtY` in `interiorSegments.ts`), so a car in front of a stair foot hides it and the
  stair above the roof draws over the car (an elevator's stop stays with its level). The cut is by height alone, so a
  foot behind a car is hidden too. One platform level is assumed: a two-deck interior logs a warning (none ships). At most four interior line layers; look C doesn't split. Every car within
  `TRAIN_RAMP_M` (40 m) of a platform span (`network.platformSpans`, the profile's kept runs) is copied, mixed
  toward the background after shading by `veilTint` (veil opacity × veilWeight × (1 − weight), look A only), so a car
  leaving the platform matches the veiled street cars. Along the platform the map track fades out with the reveal
  (the route lines' alpha times 1 − weight × reveal in the band line shader, the weight easing back to 0 over the
  last 10 m; `platformMask.ts`), so only the interior's track shows there. Mezzanine guides and a
  street-level copy of each mezzanine outline give a street reference. A click centers the interior
  beside the station panel at the tilt's near distance, in full 3D (on a phone turned so the platforms run nearly
  up the screen); a bare station lands at the same distance with its point in the free area above the panel. Both
  retarget mid-flight when the interior or the panel's final size arrives. An interior arriving after 90% of the
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
  `slabs` are mezzanines and other walkable floors.
- `connectors` (stair, escalator, elevator, ramp) have `lower`/`upper` endpoints `{x, z, level}` and a
  `width`. Elevators and escalators use the MTA equipment code as `id` ("EL358"), the join key for
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
  carries `attribution`. Licensing is split: OSM-derived parts are ODbL, `nyopendata` elements are MTA data under
  the OPEN-NY Terms of Use, and `attribution` says so (`OPEN_NY_NOTE` in `stationMerge.ts`).
- `generated` (`{ archetype, confidence }`) exists only on template-generated interiors (absent = hand-authored);
  generated interiors use `generated` in place of `authored` in `sources`. Their non-street levels carry
  `depthSource`: only `ee-rise` is measured, the rest are estimates (label "≈", see `levelHeightText`). The panel
  says "Estimated layout" for them. About 250 are committed, shown to everyone.
- `public/data/stations/index.json` (`StationIndex`) maps each station id with an interior file to its
  `provenance` (`authored` or `generated`). The client fetches it on mount, after the startup files and not
  render-blocking, so it is outside the 60 KB startup budget and has its own cap (the build fails above 8 KB
  gzipped); a station not listed never fetches an interior, and until it loads (or if it fails, retried on the next
  focus change) no station shows an interior panel. The object's key order lists integer-like ids first; don't rely on it. `index` is not a valid station id.
- `public/data/station-depths.json` (`PackedDepthsFile`, format 2) is packed from every interior, authored and
  generated, by the same build (`scripts/lib/depthsPack.ts`), small enough for the startup budget. Columns, one entry
  per station: `station` (stations.json index, delta-coded), `y` (rail height = platform level y - RAIL_DROP_M, in
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
  the `worker/` proxy, which returns decoded JSON with a 15 s edge cache.
- **Location never leaves the device.** The location button makes one `getCurrentPosition` per press (no
  `watchPosition`) and keeps the result in memory only: no storage, URL, log or request carries it.
- **Realtime has no lat/lon.** Vehicle positions are stop-relative, so dots are
  interpolated along shapes from TripUpdate times and scheduled segment run times.
- **Static GTFS is processed at build time only.** `scripts/` turns the regular zip
  into `public/data/*.json`. The 60 KB gzip budget (`scripts/lib/budget.ts`) is the one size limit, shared by
  every top-level `public/data/*.json` the client loads up front, `station-depths.json` included (59.8 KB today,
  about 150 B of headroom; the depths file is about 1.6 KB of it); `data`, `data:access` and `data:stations` each fail above it. Per-station interiors and street files don't count (street and walk files have their own caps in `budget.ts`: 16 KB gzipped each for streets, 64 KB for walk, and a total for each).
- **Data refresh is automated.** `.github/workflows/refresh-data.yml` runs daily and
  opens or updates one PR on `chore/data-refresh` when `npm run data`, then `npm run data:stations` (the
  generated interiors follow the new shapes and stations), then `npm run data:streets` (the street files follow
  the stations), then `npm run data:walk`, change `public/data`. A station new to the feed gets a street file from whatever pinned ways lie
  near it, with a `WARNING:` line in the log (`data:streets` prints it for any station the pin manifest's `stationIds`
  lacks); it does not block the refresh, and the next `data:streets:fetch` covers it. The workflow runs typecheck, tests, and build before pushing, but the
  PR itself shows no check status (GITHUB_TOKEN PRs don't trigger workflows).
- **The NYC basemap (vector tiles for streets, water and parks) is never in git and loads on demand only.** It is a
  PMTiles file: the five boroughs at z0 to z15 (about 33 MB), only the earth, water, landuse and roads layers of a Protomaps
  daily build, cut by `.github/workflows/basemap.yml` (manual; go-pmtiles `extract`, then tippecanoe `tile-join -l` to drop
  layers) and published as a GitHub Release. `deploy.yml` copies the pinned release into `dist/basemap/nyc.pmtiles`
  (sha256-checked; skipped with a warning while the pin is null) and fails above 900 MB; its `verify-basemap` job checks
  uncompressed 206 Range answers on the live site. Nothing in the startup files names it, and it is not the walk graph.
  The licensing gate (`basemapGate.ts`) fails the workflow on any credit beyond "© OpenStreetMap" (so never the landcover
  layer, which is CC BY 4.0, nor places or pois); a failure goes to a person as a licensing card. The pin changes only by a
  normal PR. Details and sizes: `docs/research/data-sources.md` §5.3. The client never fetches Protomaps' servers.
- **Station interiors are hand-authored or generated.** Bedford Av (L08) is hand-authored and wins over a generated
  one; 253 more are generated from archetype templates (`scripts/lib/generate.ts`) and labelled "Estimated layout".
  Both are merged with OSM platform polygons, NY Open Data entrances, and E&E elevator/escalator data.
- **Attribution.** Credit MTA and show "© OpenStreetMap contributors". Include a
  "may not be real time" notice. Don't use the MTA logo, route bullets, or the map.

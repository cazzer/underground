# underground

## Purpose
A live view of the NYC subway as a static site on GitHub Pages
(github.com/cazzer/underground). It opens on a zoomed-out, low-fi architectural
wireframe map with small dots for moving trains. Pinch/scroll zooms. Zooming toward
a station continuously tilts the camera from top-down to isometric; later that view
shows the station's levels, stairways, and upcoming arrivals.

Status: the real static network (every route shape and station from `public/data/`) renders, and
trains are live: the client polls the deployed realtime Worker (`worker/`) and draws dots from the
pure realtime library. The station panel shows real arrivals, and Bedford Av (L08) has an interior.
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
  into `public/data/stations/*.json`, and extract `public/data/station-depths.json` (each platform track's
  ends and rail height; it counts toward the shared 60 KB budget). Offline.
- `npm run data:stations:fetch -- --station L08`: uses the network (Overpass, data.ny.gov); refreshes the
  pinned `data/stations/L08.sources.json`. Review the diff, then rerun `data:stations`.
- `npm run data:catalog:fetch`: uses the network (data.ny.gov, Overpass); re-pins the citywide catalog in
  `data/stations/catalog/`. Review the diff. `data:stations` stays offline and never reads it (`npm run data` reads only `catalog/stations.json`).

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
- `src/theme.ts`: all colors, line widths, fonts; presets selected by `?theme=`. Route colors are
  GTFS data drawn through `theme.routeLineMix` (mixed toward a theme color; amount 1 = mono), then
  pushed to at least 3:1 against `theme.background`.
  TEMPORARY: `?lines=a|b|c` picks the lines look until the 8x4.3 options round is decided (default b)
  Interior tokens (`interiorStroke`, `interiorTrack`, `interiorEntrance`, `interiorFine`,
  `interiorElevator`, `interiorEscalator`, the two widths, `interiorDepthFade`) color the station interior.
  TEMPORARY: `?machines=a|b|c` (rails and cab, plain band and box, plan symbols; default a) until the
  9wc.8 card is decided, and the dev-only `?machinesDemo` (demo escalators and a three-level elevator at
  Bedford Av, `src/data/machineDemo.ts`); the removal list is in `src/scene/machineLook.ts`
  TEMPORARY: `?interior=a|b|c` (veil, cutaway, ghost under; default a) and `?interiorY=1|2|3`
  (vertical exaggeration; default 2) until the 8x4.11 cards are decided; the removal list is in
  `src/scene/interiorLook.ts`
  Car tokens `trainCarSideShade`, `trainCarEndShade` are linear multipliers of a car's route color.
  TEMPORARY: `?orbit=a|b|c` (azimuth window ±30/45/60 degrees; default b) until pah.5 decides; the
  removal list is in `src/scene/orbitLook.ts`
- `src/scene/`: the r3f scene
  - `Scene.tsx` canvas; `MapGrid.tsx` ground grid (fades out by 30 km); `CameraRig.tsx` MapControls,
    HUD-aware fit-to-city framing, zoom-driven tilt, fly-to, auto focus, interrupted-fly-to focus hold;
    `useStationOrbit.ts` the focused-station orbit (azimuth window per frame, pan-radius clamp);
    `orbitLook.ts` TEMPORARY `?orbit=` override
  - `SubwayLines.tsx` (one merged LineSegments2 via `useLineLayer.ts`); `StationTies.tsx` a thin vertical tie
    from each station marker with a depth down to its sunken platform tracks (`network.stationTrackY`; one
    LineSegments2, `theme.stationTieWidth`, faded out between 350 and 550 m); `LineHighlight.tsx` holds the
    temporary `?lines=a|c` layers; `Stations.tsx` (two InstancedMeshes; `FocusRing.tsx` redraws the focused ring above the
    trains and the veil; `markerShape.ts` the shared marker constants);
    `ScenePicker.tsx` click/tap picking of stations and trains in screen space (see Rendering conventions);
    `LiveTrains.tsx` (instanced dots plus a background-colored halo, sized by `trainSize.ts`, theme.train in mono themes; stable per-trip slots, fades in
    and out; the selected train (dot 1.6×) gets a background gap and then a
    `theme.trainSelectedRim` rim. Its dot is drawn on its own above every other dot; its cars get the top widen
    level, a 0.2 m lift (so its roof wins the depth test on shared corridors) and rim footprints; wrapped in an `ErrorBoundary` so a crash shows in the HUD, not a blank map). Zoomed in, the
    dots hand off to `TrainCars.tsx` (car bodies plus per-car background footprints; `useTrainCars.ts` owns
    their instances, consists and per-frame writes; `carGeometry.ts` the shaded chamfered-prism body and its dimension constants);
    `YouAreHere.tsx` the location marker (constant-size reticle ringed by a thin background halo inside a translucent
    accuracy disc; `hereShape.ts` its line buffers; no event handlers, so it never takes a pick);
    `cameraDistance.ts` helpers; `renderOrder.ts`
  - `StationInterior.tsx` the focused station's interior (two line layers, `InteriorVeil.tsx`, drei Html
    level labels); `interiorModel.ts` interior JSON to a
    drawable model (theme colors, labels, camera target); `interiorLook.ts` TEMPORARY look overrides;
    `machineLook.ts` TEMPORARY `?machines=` escalator/elevator look
- `src/ui/Hud.tsx`: Tailwind overlay (title, live status, a screen-reader-only announcer for the gone notice, arrivals
  panel; `TrainPanel.tsx` holds the selected-train panel, which covers the station panel and takes focus on
  each pick (its `TrainStops.tsx` lists the next stops: 3 rows, "Show all N stops", a 15 s tick; on phones the expanded list is capped at whole rows by
  `useStopListScroll.ts`, about 5 rows or a quarter of the screen, with a "more below" fade), and the "no longer tracked" panel shown for 10 s; Esc or × closes the train first, then the
  notice, then the station, and closing either of the first two returns focus to the station heading or else
  the location button); `LoadStatus.tsx` loading/error panel
  plus `SceneCrash`/`HudCrash`; `LiveStatus.tsx` the HUD live-trains badge (a polite live region);
  `ErrorBoundary.tsx`; `LiveDebug.tsx` dev-only `?debug` overlay (drawn count, drops by reason, join
  stages, per-feed trips/stale, offset/skew/age; updates per poll)
  `LocateButton.tsx` the header's location button (shows locating and located); `LocateStatus.tsx` its message (the sentence alone is the always-mounted live region)
  with a "Go to <nearest station>" action and a clear ×
  `InteriorStatus.tsx` the panel's station-layout line (loading, error with Retry, ready, zoom-in hint)
  `SearchButton.tsx` (top bar) opens `StationSearch.tsx`, a full-screen native `<dialog>` (always mounted; the tap handler calls its `open()` so iOS raises the keyboard) with a combobox over a
  listbox of `SearchResult.tsx` rows (name plus route chips, which tell duplicate names apart); choosing a result
  calls `select` (focus then moves to the panel heading; Cancel and Esc return it to the button). `useKeyboardInset.ts`
  pads the list above the on-screen keyboard. `LinkNotice.tsx` is the "link's station isn't on this map" line (with a Search action) under the
  location message
  `OrbitHint.tsx` the panel's turn hint (right- or Shift-drag; two fingers on a coarse pointer)
- `src/lib/`: pure logic
  - `projection.ts` lat/lon to scene meters; `tilt.ts` zoom distance to polar angle
  - `network.ts` public/data → render model (projected stations, routes, shape paths, bounds);
    `trackLine.ts` a shape's drawn track (decode, project, `dropSpurs` removes out-and-back tips of
    160°+ turns, then offset); `trackOffset.ts` `offsetPolyline` (miter joins, capped at 2× on sharp
    bends) plus the `TRACK_OFFSET_M` constant (4.7 m). Both use explicit `.ts` imports because a scripts/
    test loads them;
    `trackProfile.ts` a shape's vertical profile (knots, `profileAt`, `resampleForProfile`) and
    `trackAnchors.ts` `profileRuns` (which shapes ride which authored platform track, and where); both use
    `.ts` imports for `scripts/lib/trackDepth.test.ts`;
    `focusMachine.ts` camera-driven focus transitions; `focusHold.ts` interrupted-flight release rule
  - `lineBuffers.ts`, `routeColor.ts` (theme mix plus a 3:1 contrast floor), `framing.ts` (fit
    between HUD insets), `markerMatrices.ts` (incl. `writeChordMatrix`, a car pitched along its chord), `pick.ts` (hit radii, nearest station,
    station-or-train choice): pure render helpers; `labels.ts`
    HUD text (route chips, schedule date)
  - `interiorGeometry.ts` interior to strong/fine line buffers (levels, outlines, entrances);
    `interiorConnectors.ts` stairs, ramps, escalators (a zero-run one gets a 30 degree run along the
    station axis, from its listing entrance or centered, descending toward the plan center) and elevators
    (shaft squared to the axis, a stop at each end in that level's pass; machines take half the depth fade);
    `interiorAxis.ts` `stationAxis`, the principal direction of the longest platform outline;
    `interiorSegments.ts` the shared segment writer; `interiorFixture.ts` the tests' mini interior;
    `interiorFraming.ts` bounds, focus anchor (plan center, toward-camera shift, half-extent), level
    labels, padded hull; `interiorReveal.ts` distance to interior opacity. These have `.ts` imports
    because a scripts/ test loads them. `interiorCamera.ts` centers an interior fly-to (always 180 m,
    at the current azimuth) in the screen area the header, footer and station panel leave free;
    `orbitLimits.ts` azimuth window, spring to north-up, soft pan radius, focus-point pivot
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
    station pick clears it). Dev only: `__underground.selectTrain(key)`, `trainKeys()`, and `trainAt(key)`
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
    poll, `stepSlot` per frame); `motion.ts` how a dot absorbs a new plan: nothing teleports (ease, glide to
    arrive on time, or cross-fade; reduced motion cross-fades). On a shape change the dot's ground point is
    projected onto the new shape: within 25 m it carries over, else it shrinks on the old shape
    (`drawGeometry`) and grows on the new one; `trainRoute.ts` dot color route
  - `trainPick.ts` the nearest drawn train to a click (dot, or the chord line through its car ends, at the
    profile's height);
    `trainSelection.ts` the selection reducer (two polls in a row without the trip clear it, with a notice; no live layer, an outage, keeps it);
    `trainSummary.ts` route and headsign for the train panel and the notice;
    `trainStops.ts` the train's next stops (feed arrivals not yet passed, the dwell stop kept), `nyClockTime`
    (New York 12 h without AM/PM), `stopEta` (clock plus "Now"/"3 min"), `tripTimesDelayed`, `deriveTrainStopsView` (states). Minutes away
    come from `minutesAway` in `arrivals.ts`, shared by the station and train panels: "Now" under 30 s, else
    the arrival's clock minute minus the current one (not floor of seconds), so adjacent rows and both
    panels agree
  - `consist.ts` cars and car length per route, `consistCenter` (the train kept on its shape), `carMix`
    (dots from 1400 m, cars by 900 m); `consistLayout.ts` `writeConsist`: cars end to end along the shape
    (`consistSpanInto`, shared with picking), each on its chord (pitched on the profile, `trackY`), unfolding from the dot point (spacing and length by mix, section by the slot fade);
    `dirtyRanges.ts` upload ranges for runs of changed slots. Only trains within about 3 camera distances
    of the view center are laid out; the rest are zeroed once
- `src/lib/realtime/`: pure realtime-to-position library (no fetch, React or three.js); tests colocated,
  `fixture.ts` is the mini static world they share
  - `serviceDate.ts` addDays, servicesOn (calendar + exceptions), nyDate
  - `tripLookup.ts` trip-index to per-service trip-key maps and primary shapes
  - `joinTrip.ts` realtime trip to shape: path code, then origin key (startDate-aware), then the route's pattern
    that calls at the train's stop and covers most of its predicted stops (ties go to the primary)
  - `polyline.ts` cumulative length, point/heading at distance, forward-only projection
  - `shapeGeometry.ts` each pattern's track line (`trackLine` resampled on `network.profiles`, the map's line) and
    its stop distances, computed at load; `ShapeGeometry.profile` is the shape's profile (`EMPTY_PROFILE` when flat)
  - `position.ts` `planHop` (once per poll: hop, run time, arrival) and `hopDistance` (per frame, no
    allocation); `positionAlongShape` is their composition. A trip with no VehiclePosition doesn't advance
    to its next hop until the next poll. Segment run times are arrival-to-arrival and include dwell, so the
    first `dwellFor(runS)` (30 s, at most 35% of the hop) of every hop is held at its origin stop: the train
    leaves at `arriveAt - (runS - dwellS)` and still arrives on time, for every status
  - `smoothing.ts` smoothDistance: per-frame ease that never goes backward
  - `filters.ts` ghostReason: unassigned, stale vehicle, no future arrival
  - `prepareTrips.ts` per poll: filter, join, plan; returns live trips (each with its `HopPlan`) and
    per-reason drop counts
- `src/data/loadNetwork.ts` fetches stations/routes/shapes/station-depths JSON and validates their outer shape (a
  missing depths file fails the load like the others);
  `useNetwork.ts` is the loading/error/ready hook (ready also carries the raw `files` the realtime join needs); it passes
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
  against the files); `loadStationInterior.ts` fetch and outer-shape check; `interiorCache.ts` one promise per id, failures
  evicted; `interiorLoad.ts` the load types (interior and index) and their pure derivation; `useStationInterior.ts` the
  focused station's interior load (the index is fetched once on mount; stations it doesn't list never fetch); `useLocate.ts` the location button's one-shot
  geolocation (on press only, never watched; the fix lives in React state and nowhere else)
- `src/data/schema.ts`: types of the six `public/data/*.json` files (`Station` carries `borough`, `ada`,
  and `adaPartial` on the 8 partial stations, from 39hk-dx4f via `scripts/lib/stationAccess.ts`); `src/data/codec.ts`: shared
  pure helpers (trip-id parsing, trip/segment keys, delta codec, shape decode). Scripts and client both import these
- `src/data/realtime.ts`: client re-export of the realtime JSON types and `RT_URL`; no fetching
- `src/data/stationSchema.ts`: the `StationInterior` contract for `public/data/stations/<id>.json`, and
  `StationDepthsFile` for `public/data/station-depths.json`
- `public/data/`: preprocessed static JSON (generated; `npm run data`, `npm run data:stations`)
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
- `scripts/`: `build-data.ts`, `build-access.ts`, `build-stations.ts`, `fetch-station-sources.ts` and `fetch-station-catalog.ts`
  (the only IO) and pure transforms in `scripts/lib/`, tests colocated. `lib/stationMerge.ts` is the station
  merge; `lib/stationProvenance.ts` (`markGenerated`: authored to generated, depth sources, archetype and
  confidence) and `lib/stationIndex.ts` (`buildStationIndex`) are pure, and `build-stations.ts` has the seam where
  generated stations join the authored ones (hand-authored wins); `lib/catalog*.ts` trim the catalog fetch (`catalogData.test.ts` checks the committed files)
  - Archetype classifier (offline, nothing ships): `lib/archetype.ts` (`classifyStation`: facts to archetype,
    params, confidence and a reason per deduction; `INTERIOR_MIN_CONFIDENCE` 0.7), `stationFacts.ts` (its input
    types), `stationFactsCheck.ts` (drops or rejects bad geometry), `platformAxis.ts` (PCA axis, [u, v] frame),
    `crossSection.ts` + `platformVote.ts` + `trackSpan.ts` + `platformSides.ts` + `platformFallback.ts`
    (island/side by cross-section vote, track count, curve penalty; `platformLayout.ts` the types),
    `mezzanineEvidence.ts`, `depth.ts` + `deepStations.ts` + `riseParse.ts` (level elevations from E&E rises,
    a cited deep list, OSM level, then structure defaults)
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
- Camera polar angle is a pure function of zoom distance (`src/lib/tilt.ts`).
  The user may rotate (right-drag, shift/ctrl/meta+drag, two-finger touch) only while a station is
  focused: azimuth stays within ±45 degrees (`?orbit=`), and the turn pivots on the focus point (the
  interior's mid-depth center at the middle of the free area, or the view center for a bare station).
  The focus point pans within the interior's half-extent + 20 m of its plan center (100 m of a bare
  station; 180 m at most), with a soft edge (`src/lib/orbitLimits.ts`). The window closes to 0 toward top-down, and
  dropping focus (zoom out, close the panel) springs the view back to north-up, so the city and
  top-down views are always north-up. `enableRotate` stays on; the azimuth window alone stops a turn
  (toggling it mid-gesture applies a stale rotate start), and `rotateSpeed` is 0 while unfocused so
  drift can't replay when the window opens. Markers and dots rescale with distance
  (`screenScale`) so they stay legible when zoomed out.
- Every `on*` handler passed to `MapControls` (today `onStart`) stays referentially
  stable (`useCallback` + refs): a changed handler makes drei dispose and reconnect the controls,
  which can lock them mid-drag. Set control limits imperatively in `useFrame` (priority -2, before
  drei's `update()` at -1; the pivot and pan clamp at -0.5), not as changing props. Never use a
  positive `useFrame` priority (it takes over rendering).
- Overlay layers (lines, markers, trains) are `transparent` with `depthTest={false}` and
  an explicit `renderOrder` from `src/scene/renderOrder.ts`: grid -1, lines 1, station tie 1.5, line focus 2,
  you-are-here accuracy disc 0.5 and edge 0.6, station fill 3, station ring 4, train halo 5, car rim 5.25,
  car halo 5.5, trains 6, selected train rim 6.1, halo 6.15 and dot 6.2, you-are-here halo 6.4, cars 6.5,
  you-are-here reticle 6.55, focused ring 10
  (whenever a station is focused, so a train never covers it).
  The one depth-tested layer is the car bodies (depthTest and depthWrite on, still `transparent`): at iso
  tilt a far car would otherwise paint over a near one. It is safe because nothing before it writes depth
  (MapGrid turns off the drei grid's depthWrite, since cars on a station ramp run below the street), and everything after it (veil, interior, focus ring) has depthTest false.
  drei's Grid is transparent, and three.js draws all opaque objects before all transparent
  ones, so `renderOrder` only sorts within a list; depth precision is too coarse at map
  zoom for z-offsets to work.
- All route shapes draw as one merged `LineSegments2` (one draw call, per-vertex colors in linear
  space via three's `Color`). Buffer order is the overlap rule: non-primary shapes, then
  route_sort_order. Don't add per-route `<Line>`s.
- Each shape draws `trackOffsetM` to the right of its own travel direction (`trackLine` in
  `buildNetwork`), so the two directions are parallel tracks; zoomed out the pair reads as one line.
  The offset is `TRACK_OFFSET_M` (4.7 m, measured at Bedford Av); code that needs it reads `network.trackOffsetM`. Live trains ride the same `trackLine`
  (passed through `useLive` to `buildShapeGeometries`), so dots and cars sit on their direction's track.
- Tracks follow a vertical profile y(d) per shape (`trackProfile.ts`), and the lines and the trains share it:
  `ShapePath.y` feeds the line buffers, `network.profiles` goes through `useLive` to `buildShapeGeometries`, and
  dots, cars and picks add `profileAt` (never blended by interior opacity). It is anchored only at authored
  interiors (`station-depths.json`): flat at the rail height (`level.y - RAIL_DROP_M`, × the interior's yScale)
  along each platform track a shape rides (route serves the station, direction is the stop suffix, both track
  ends within 6 m), smoothstep ramps at a 3% average real grade (horizontal true, so 340 m for Bedford Av's
  10.2 m) to 0, and 0 everywhere else. Close stations ease from one depth to the next. Ramps are resampled every
  10 m, so the line and the trains (same distances) agree. Top-down nothing moves.
- Station markers are instanced: matrices are rewritten only when the scale or focus changes.
- Picking is screen space, on click only: `ScenePicker` listens on the canvas (never stopping or
  preventing MapControls' events; multi-touch and moves past 6 px mouse / 10 px touch are not clicks),
  projects stations (22 px) and live trains (16 px, dot or car line, read from the slot table) to pixels,
  and a station wins unless a train is 6 px closer or the station is the open one. A station's target grows
  to its drawn marker at close zoom; a touch with no station in reach gets 22 px for trains; cars are tested
  along their floor and roof lines. No meshes carry r3f pointer handlers.
- Live train dots and cars are instanced too, with per-slot colors (`routeLineColor` like the lines; car
  instance `slot * MAX_CARS + c`). Their per-frame
  path (`useFrame` in `LiveTrains.tsx`) must not allocate or throw: errors there bypass error boundaries.
- The station interior is a group at `toGround(anchor)` with depths drawn ×2 (x/z true; labels give
  real depths). Two merged `LineSegments2` (fine, then strong strokes) are built from the deepest
  level up, so upper levels paint over lower ones; deeper levels mix toward the background. It fades
  in between 320 m and 180 m (full tilt). A background-colored veil (render order 7) dims every street
  layer, live trains included, in one draw call; the interior draws at 8 (fine) and 9 (strong); the
  focused ring stays above it at 10; look C uses -0.6 and -0.3. Mezzanine guides and a
  street-level copy of each mezzanine outline give a street reference. A click centers the interior
  beside the station panel at 180 m (a partial fit on small screens).
  drei `Html` labels need `zIndexRange={[0, 0]}`, or they paint over the HUD panel.

## Station interior format
`public/data/stations/<id>.json`, type `StationInterior` in `src/data/stationSchema.ts`. Built by
`scripts/build-stations.ts` from the hand-authored `data/stations/<id>.authored.json` plus pinned OSM,
NY Open Data entrance, and E&E extracts (`<id>.sources.json`).
- Render in a group at `toGround(anchor)`. `x`/`z` are local meters (east, south); `y` comes from
  `levels[].y`, relative to the street (0), negative below. Levels are sorted high to low.
- `platforms` are OSM outlines (level + open ring) plus `tracks`, one centerline per served child stop.
  `slabs` are mezzanines and other walkable floors.
- `connectors` (stair, escalator, elevator, ramp) have `lower`/`upper` endpoints `{x, z, level}` and a
  `width`. Elevators and escalators use the MTA equipment code as `id` ("EL358"), the join key for
  outages. Elevators, and escalators from the E&E inventory, have identical x/z at both ends (the renderer
  gives such an escalator a 30 degree run, pinned at its street entrance when one lists it).
- `entrances` are street-level points (raw NY Open Data type, entry/exit) listing the `connectors`
  that reach them.
- Every element has `sources` (`osm`, `nyopendata`, `authored`, `generated`). The file is marked ODbL 1.0 and
  carries `attribution`. Licensing is split: OSM-derived parts are ODbL, `nyopendata` elements are MTA data under
  the OPEN-NY Terms of Use, and `attribution` says so (`OPEN_NY_NOTE` in `stationMerge.ts`).
- `generated` (`{ archetype, confidence }`) exists only on template-generated interiors (absent = hand-authored);
  generated interiors use `generated` in place of `authored` in `sources`. Their non-street levels carry
  `depthSource`: only `ee-rise` is measured, the rest are estimates (label "≈"). Nothing generated ships yet.
- `public/data/stations/index.json` (`StationIndex`) maps each station id with an interior file to its
  `provenance` (`authored` or `generated`). The client fetches it on mount, after the startup files and not
  render-blocking, so it is outside the 60 KB startup budget and has its own cap (the build fails above 8 KB
  gzipped); a station not listed never fetches an interior, and until it loads (or if it fails, retried on the next
  focus change) no station shows an interior panel. The object's key order lists integer-like ids first; don't rely on it. `index` is not a valid station id.
- `public/data/station-depths.json` (`StationDepthsFile`) is extracted from these files by the same build: per
  station its anchor and, per track, `stopId`, real `railY` and the path's two ends. ODbL, with the union of the
  interiors' credits minus the OPEN-NY note, plus its own line ("Some railY values come from E&E rises and are MTA data under
  the OPEN-NY Terms of Use") only when a platform level's `depthSource` is `ee-rise`.
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
  every top-level `public/data/*.json` the client loads up front, `station-depths.json` included (about 58.5 KB
  today); `data`, `data:access` and `data:stations` each fail above it. Per-station interiors don't count.
- **Data refresh is automated.** `.github/workflows/refresh-data.yml` runs daily and
  opens or updates one PR on `chore/data-refresh` when `npm run data` changes
  `public/data`. The workflow runs typecheck, tests, and build before pushing, but the
  PR itself shows no check status (GITHUB_TOKEN PRs don't trigger workflows).
- **Station interiors are hand-authored per station.** They're merged with OSM platform
  polygons, NY Open Data entrances, and E&E elevator/escalator data. The starter
  stations are Bedford Av, 1 Av, 96 St (Q), and Park Pl.
- **Attribution.** Credit MTA and show "© OpenStreetMap contributors". Include a
  "may not be real time" notice. Don't use the MTA logo, route bullets, or the map.

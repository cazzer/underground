# underground

## Purpose
A live view of the NYC subway as a static site on GitHub Pages
(github.com/cazzer/underground). It opens on a zoomed-out, low-fi architectural
wireframe map with small dots for moving trains. Pinch/scroll zooms. Zooming toward
a station continuously tilts the camera from top-down to isometric; later that view
shows the station's levels, stairways, and upcoming arrivals.

Status: the real static network (every route shape and station from `public/data/`) renders, and
trains are live: the client polls the realtime Worker (`worker/`, built, not yet deployed) and draws
dots from the pure realtime library. With no `VITE_RT_URL` there is no live data (the HUD says
"Live trains off") and no fake motion. Arrivals are still placeholders (8x4.8).

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
- `npm run data:stations`: merge `data/stations/*.authored.json` with the pinned `*.sources.json`
  into `public/data/stations/*.json`. Offline.
- `npm run data:stations:fetch -- --station L08`: uses the network (Overpass, data.ny.gov); refreshes the
  pinned `data/stations/L08.sources.json`. Review the diff, then rerun `data:stations`.

Run typecheck, test, and build before reporting work done. Pushing to `main` deploys
via `.github/workflows/deploy.yml` (Actions to Pages).

Worker (its own package and lockfile; run `npm --prefix worker ci` once):
- `npm --prefix worker run dev`: `wrangler dev` on `http://localhost:8787/rt`
- `npm --prefix worker run typecheck` / `test` / `gen`: `gen` regenerates `src/gen/`
  from `proto/subway-rt.proto`
- Root `npm test` does not run worker tests; the `worker` CI job does.
- Deploying the Worker is manual (`wrangler deploy`, needs the user's Cloudflare login).
  Agents never deploy.
- The Worker's Cache API layer is a no-op on workers.dev; edge caching needs a custom
  domain (tracked in 8x4.5). The per-isolate memo and upstream `cf.cacheTtl` still apply.
- The client finds the Worker through `VITE_RT_URL` (copy `.env.example` to `.env.local`).

## Directory map
- `src/main.tsx`, `src/App.tsx`, `src/index.css`: entry, root layout, Tailwind + theme CSS vars
- `src/theme.ts`: all colors, line widths, fonts; presets selected by `?theme=`. Route colors are
  GTFS data drawn through `theme.routeLineMix` (mixed toward a theme color; amount 1 = mono), then
  pushed to at least 3:1 against `theme.background`.
  TEMPORARY: `?lines=a|b|c` picks the lines look until the 8x4.3 options round is decided (default b)
- `src/scene/`: the r3f scene
  - `Scene.tsx` canvas; `MapGrid.tsx` ground grid (fades out by 30 km); `CameraRig.tsx` MapControls,
    HUD-aware fit-to-city framing, zoom-driven tilt, fly-to, auto focus, interrupted-fly-to focus hold
  - `SubwayLines.tsx` (one merged LineSegments2 via `useLineLayer.ts`); `LineHighlight.tsx` holds the
    temporary `?lines=a|c` layers; `Stations.tsx` (two InstancedMeshes; picks raycast an invisible
    22 px hit disc per station and take the nearest);
    `LiveTrains.tsx` (instanced dots plus a background-colored halo, sized by `trainSize.ts`, theme.train in mono themes; stable per-trip slots, fades in
    and out; wrapped in an `ErrorBoundary` so a crash shows in the HUD, not a blank map);
    `cameraDistance.ts` helpers; `renderOrder.ts`
- `src/ui/Hud.tsx`: Tailwind overlay (title, live status, arrivals panel); `LoadStatus.tsx` loading/error panel
  plus `SceneCrash`/`HudCrash`; `LiveStatus.tsx` the HUD live-trains badge (a polite live region);
  `ErrorBoundary.tsx`; `LiveDebug.tsx` dev-only `?debug` overlay (drawn count, drops by reason, join
  stages, per-feed trips/stale, offset/skew/age; updates per poll)
- `src/lib/`: pure logic
  - `projection.ts` lat/lon to scene meters; `tilt.ts` zoom distance to polar angle
  - `network.ts` public/data → render model (projected stations, routes, shape paths, bounds);
    `focusMachine.ts` camera-driven focus transitions; `focusHold.ts` interrupted-flight release rule
  - `lineBuffers.ts`, `routeColor.ts` (theme mix plus a 3:1 contrast floor), `framing.ts` (fit
    between HUD insets), `markerMatrices.ts`, `pickStation.ts`: pure render helpers; `labels.ts`
    HUD text (route chips, schedule date)
  - `focus.tsx` focused/dismissed-station React context (not pure). In dev only it exposes
    `window.__underground.select(stationId)` for screenshots and Playwright checks
- `src/lib/live/`: pure helpers for the live layer (no React or three.js; tests colocated)
  - `clock.ts` the live clock: `now = offsetS + performance.now()/1000`, where `offsetS` is the maximum over
    polls of `generatedAt - receivedPerfMs/1000`. Monotone (a poll served from the Worker's 15 s memo
    can't move it back), never reads the device clock; `SNAPSHOT_MAX_AGE_S` (120) drops old data
  - `backoff.ts` poll delay (20 s; jittered exponential backoff on failure; Retry-After; "warming" 503s)
  - `liveStatus.ts` `deriveLiveStatus` for the HUD (off/connecting/live/stale/error; one failed poll with
    a snapshot is not shown, two show a delay while trains stay drawn; technical text never appears)
  - `slots.ts` stable instance slots keyed by trip (fade in/out, a grace period for a trip missing from one
    poll, `stepSlot` per frame); `motion.ts` how a dot absorbs a new plan: nothing teleports (ease, glide to
    arrive on time, or cross-fade; reduced motion cross-fades); `trainRoute.ts` dot color route
- `src/lib/realtime/`: pure realtime-to-position library (no fetch, React or three.js); tests colocated,
  `fixture.ts` is the mini static world they share
  - `serviceDate.ts` addDays, servicesOn (calendar + exceptions), nyDate
  - `tripLookup.ts` trip-index to per-service trip-key maps and primary shapes
  - `joinTrip.ts` realtime trip to shape: path code, then origin key (startDate-aware), then the route's pattern
    that calls at the train's stop and covers most of its predicted stops (ties go to the primary)
  - `polyline.ts` cumulative length, point/heading at distance, forward-only projection
  - `shapeGeometry.ts` stop distances along each shape, computed at load
  - `position.ts` `planHop` (once per poll: hop, run time, arrival) and `hopDistance` (per frame, no
    allocation); `positionAlongShape` is their composition. A trip with no VehiclePosition doesn't advance
    to its next hop until the next poll
  - `smoothing.ts` smoothDistance: per-frame ease that never goes backward
  - `filters.ts` ghostReason: unassigned, stale vehicle, no future arrival
  - `prepareTrips.ts` per poll: filter, join, plan; returns live trips (each with its `HopPlan`) and
    per-reason drop counts
- `src/data/loadNetwork.ts` fetches stations/routes/shapes JSON and validates their outer shape;
  `useNetwork.ts` is the loading/error/ready hook (ready also carries the raw `files` the realtime join needs)
- `src/data/useLive.ts` composes live trains for `App`: `useRealtimeStatic` (trip-index + segments, only when
  `RT_URL` is set), `useRealtimeFeed` (one request at a time; a hidden tab aborts and stops polling, becoming
  visible polls at once), `prepareTrips` once per snapshot, and `deriveLiveStatus`. `realtimeFetch.ts` fetches and
  validates one snapshot (the Worker doesn't expose `Retry-After`/`X-Rt-Cache` cross-origin yet; the client copes)
- `src/data/schema.ts`: types of the six `public/data/*.json` files; `src/data/codec.ts`: shared
  pure helpers (trip-id parsing, trip/segment keys, delta codec, shape decode). Scripts and client both import these
- `src/data/realtime.ts`: client re-export of the realtime JSON types and `RT_URL`; no fetching
- `src/data/stationSchema.ts`: the `StationInterior` contract for `public/data/stations/<id>.json`
- `public/data/`: preprocessed static JSON (generated; `npm run data`, `npm run data:stations`)
- `data/stations/`: authored station interiors and pinned source extracts (not shipped); see `data/README.md`
- `scripts/`: `build-data.ts`, `build-stations.ts` and `fetch-station-sources.ts` (the only IO) and pure
  transforms in `scripts/lib/`, tests colocated. `lib/stationMerge.ts` is the station merge
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
  User rotation is disabled. Markers and dots rescale with distance
  (`screenScale`) so they stay legible when zoomed out.
- Overlay layers (lines, markers, trains) are `transparent` with `depthTest={false}` and
  an explicit `renderOrder` from `src/scene/renderOrder.ts`: grid -1, lines 1, line focus 2,
  station fill 3, station ring 4, train halo 5, trains 6.
  drei's Grid is transparent, and three.js draws all opaque objects before all transparent
  ones, so `renderOrder` only sorts within a list; depth precision is too coarse at map
  zoom for z-offsets to work.
- All route shapes draw as one merged `LineSegments2` (one draw call, per-vertex colors in linear
  space via three's `Color`). Buffer order is the overlap rule: non-primary shapes, then
  route_sort_order. Don't add per-route `<Line>`s.
- Station markers are instanced: matrices are rewritten only when the scale or focus changes.
- Live train dots are instanced too, with per-slot colors (`routeLineColor` like the lines). Their per-frame
  path (`useFrame` in `LiveTrains.tsx`) must not allocate or throw: errors there bypass error boundaries.

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
  outages. Elevators have identical x/z at both ends.
- `entrances` are street-level points (raw NY Open Data type, entry/exit) listing the `connectors`
  that reach them.
- Every element has `sources` (`osm`, `nyopendata`, `authored`). The whole file is ODbL 1.0 and carries
  `attribution`.
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
- **Realtime has no lat/lon.** Vehicle positions are stop-relative, so dots are
  interpolated along shapes from TripUpdate times and scheduled segment run times.
- **Static GTFS is processed at build time only.** `scripts/` turns the regular zip
  into `public/data/*.json` (about 57 KB gzipped; the build fails above 60 KB).
- **Data refresh is automated.** `.github/workflows/refresh-data.yml` runs daily and
  opens or updates one PR on `chore/data-refresh` when `npm run data` changes
  `public/data`. The workflow runs typecheck, tests, and build before pushing, but the
  PR itself shows no check status (GITHUB_TOKEN PRs don't trigger workflows).
- **Station interiors are hand-authored per station.** They're merged with OSM platform
  polygons, NY Open Data entrances, and E&E elevator/escalator data. The starter
  stations are Bedford Av, 1 Av, 96 St (Q), and Park Pl.
- **Attribution.** Credit MTA and show "© OpenStreetMap contributors". Include a
  "may not be real time" notice. Don't use the MTA logo, route bullets, or the map.

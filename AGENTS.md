# underground

## Purpose
A live view of the NYC subway as a static site on GitHub Pages (github.com/cazzer/underground). It opens on a
zoomed-out, low-fi architectural wireframe map with small dots for moving trains. Pinch/scroll zooms; zooming toward a
station tilts the camera from top-down to isometric and reveals the station's interior (levels, stairs, elevators) with
its arrivals panel.

What ships: every route and station from `public/data/`; live trains, elevator/escalator outages and MTA service changes
through the `worker/` proxy (none of it without `VITE_RT_URL`: the HUD says "Live trains off" and nothing moves); station
interiors (Bedford Av L08 and the Union Sq complex `635` hand-authored, about 250 generated and labelled "Estimated
layout"); streets and entrances near stations; restroom and 24/7 customer service amenity marks; a faint citywide
basemap; station, street and address search. A station
complex (catalog `complex_id`) is one station in the UI; every member keeps its own marker. Trip planning is behind
`FEATURES.navigation` (`src/config.ts`), off by default (`?nav=1` turns it on for one page load): with it off nothing
trip-only loads or draws.

Behaviour details live in each file's header comment and in `docs/research/*.md`; read those before changing a system.

## Stack
Vite 8, React 19, TypeScript (strict), Tailwind v4 (`@tailwindcss/vite`), three.js, `@react-three/fiber`,
`@react-three/drei`, Vitest. npm. Vite `base` is `/underground/`, so dev and preview serve under that path.

## Commands
- `npm run dev` (path `/underground/`), `npm run build` (`tsc -b && vite build`), `npm run preview`, `npm test`,
  `npm run typecheck` (`src/`, then `-p scripts`).
- Run typecheck, test, and build before reporting work done.

Data scripts (offline unless marked network; each one's checks and caps are in its script and `scripts/lib/budget.ts`):
- `npm run data [-- --zip path]` (network unless `--zip`): rebuild `public/data/*.json`, `timetable/<serviceId>.json` and
  `route/transfers.json` from the regular GTFS zip (downloads unless `--zip`/`$GTFS_ZIP`; Node >= 22.18). Never commit a
  zip. Never reads the supplemented feed. A station missing from the catalog (or an orphan row) needs an entry in
  `data/stations/access-exceptions.json` (see `data/README.md`).
- `npm run data:dated [-- --out dir | --empty]` (network): the supplemented feed's planned work as
  `timetable/dated/<YYYYMMDD>.json`. Gitignored; every Pages deploy runs it and fails open (ships `--empty`).
- `npm run data:access`: rerun the borough/ADA join and `complexes` on the committed `stations.json`.
- `npm run data:stations`: merge `data/stations/*.authored.json` with pinned sources, generate template interiors,
  write `stations/index.json`, `stations/equipment.json`, `stations/amenities.json` and `station-depths.json`.
- `npm run data:stations:fetch -- --station L08` (network): re-pin one station's sources; review the diff, then
  rerun `data:stations`.
- `npm run data:catalog:fetch` (network): re-pin `data/stations/catalog/` (`-- --only amenities.json`
  for just the restrooms); then rerun `data:access`, `data:stations` and `data:streets`.
- `npm run data:streets:fetch -- [--no-walk]` (network): re-pin `data/streets/`; then rerun `data:streets`,
  `data:walk` and `data:search:streets`.
- `npm run data:streets`: `public/data/streets/<id>.json`. If a file passes its cap, lower the one global
  `WALK_RADIUS_M` in `scripts/lib/streetsBuild.ts`, never per file.
- `npm run data:walk`: `public/data/walk/<id>.json`.
- `npm run data:search:streets`: `worker/data/streetIndex.json` (the Worker bundles it; raw-byte cap, since the
  Worker size limit counts uncompressed).
- `npm run basemap:fetch` (network): unpack the pinned basemap release into gitignored `public/basemap/tiles/`. The
  `basemap:gate`, `basemap:tiles` and `basemap:verify` scripts serve `.github/workflows/basemap.yml` and the deploy.

Rerun order: `data` -> `data:stations` -> `data:streets` -> `data:walk` -> `data:search:streets`. `data:streets` and
`data:search:streets` also follow a change to the `worker/src/searchText.ts` synonyms; `data:search:streets` also
follows `GENERIC_TOKENS` (`worker/src/streetKeys.ts`) or `isStreet`. Freshness tests
(`*Outputs.test.ts`, `stationComplexes.test.ts`) fail while committed outputs are stale.

Deploy: pushing to `main` deploys via `.github/workflows/deploy.yml` (Pages, and the Worker once its checks pass), also daily at 09:23 UTC
so dated timetables roll forward (GitHub disables schedules after 60 days without repo activity). The Pages build reads
the repo variable `VITE_RT_URL`.

Worker (own package and lockfile; `npm --prefix worker ci` once):
- `npm --prefix worker run dev`: `wrangler dev` on `http://localhost:8787` serving `/rt`, `/ene`, `/alerts`,
  `/geocode` (`/geocode` answers only an allowed Origin: add `-H 'Origin: http://localhost:5173'`).
- `npm --prefix worker run typecheck` / `test` / `gen` (`gen` regenerates `src/gen/` from `proto/subway-rt.proto`).
  Root `npm test` does not run worker tests; the `worker` CI job does.
- Agents never run `wrangler deploy` or `wrangler login`; merging to `main` is the deploy (`worker-deploy` job, repo
  secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`).
- The client finds the Worker through `VITE_RT_URL` (copy `.env.example` to `.env.local`).
- `worker/wrangler.jsonc` keeps invocation logs off, query strings redacted and traces off (`src/wrangler.test.ts`
  pins them): `/geocode` URLs carry the user's query. Never enable traces. The `GEOCODE_CLIENT_LIMIT` rate-limit
  binding's namespace id must be unique within the Cloudflare account.
- Cache API is a no-op on workers.dev (edge caching needs a custom domain).

## Directory map
- `src/main.tsx`, `src/App.tsx`, `src/index.css`: entry, root layout, Tailwind + theme CSS vars.
- `src/config.ts`: build-time feature switches (no remote flags).
- `src/theme.ts`: every color, line width and font. `theme*.test.ts` hold the contrast floors.
- `src/scene/`: the r3f scene. `Scene.tsx` canvas; `CameraRig.tsx` and its `use*Flight`/`use*Reframe`/`useTrainFollow`/
  `useStationOrbit`/`useTouchOrbit` hooks (camera, fly-to, focus, orbit, follow); `SubwayLines.tsx` + `useLineLayer.ts` +
  `bandLineMaterial.ts` (the route lines); `Stations.tsx`, `StationTies.tsx`, `FocusRing.tsx` (markers);
  `LiveTrains.tsx`, `TrainCars.tsx`, `SpanCars.tsx` (trains); `StationInterior.tsx`, `useSceneInteriors.ts`,
  `interiorModel.ts`, `ScreenVeil.tsx` (interiors); `StationStreets.tsx`, `StreetLabels.tsx` (station streets);
  `Basemap.tsx` (citywide basemap); `TripLines.tsx`, `TripDashes.tsx`, `TripMarks.tsx`, `ExitPath.tsx` (trip and
  service-change drawing); `ScenePicker.tsx` (picking); `renderOrder.ts`; `*Look.ts` (TEMPORARY look overrides).
- `src/ui/`: the HUD (`Hud.tsx`), panels (`ArrivalsPanel`, `TrainPanel`, `TripPanel`, `ServiceChangesPanel`),
  `StationSearch.tsx` (native `<dialog>`), live-region announcers, `MapReveal.tsx` (opening wipe).
- `src/lib/`: pure logic, tests colocated (the `*.tsx` files are React contexts: focus, trip, panel collapse, train
  selection). `live/` the live layer's helpers, `realtime/` realtime-to-position,
  `route/` the RAPTOR trip router, `basemap/` tile maths and decoding. Also network/bands/corridors, interior geometry,
  framing, focus, labels and declutter, exit/transfer choice, search.
- `src/data/`: loaders, hooks and file contracts (`schema.ts`, `stationSchema.ts`, `streetSchema.ts`,
  `timetableSchema.ts`, `walkSchema.ts`, `equipmentSchema.ts`; `realtime.ts` re-exports the Worker's contracts).
- `public/data/`: generated JSON (never hand-edit). `data/`: pinned sources (stations, catalog, streets, basemap
  spec, icons); see `data/README.md`.
- `scripts/`: data build IO scripts; pure transforms in `scripts/lib/`, tests colocated.
- `worker/`: Cloudflare Worker (`src/index.ts` routes, `src/schema.ts` contracts, `src/gen/` generated, never
  hand-edit; `fixtures/` recorded feeds, `data/streetIndex.json` generated).
- `docs/research/`: research notes (`data-sources.md`, `navigation.md`, `service-changes.md`,
  `station-modeling.md`). `docs/evidence/`: screenshots for look decisions.

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
- A `src/` file that `scripts/` imports (directly or transitively) uses explicit `.ts` import extensions: scripts run
  under Node type stripping, so an extensionless import passes `npm test` (Vitest resolves it) and fails `npm run data*`.
- Blueprint is the only theme (the user's pick): don't add other presets, and don't make evidence or cards in other
  themes.
- `TEMPORARY` query flags (`?lines=`, `?interior=`, `?interiorY=`, `?streets=`, `?basemap=off`) stay until their look
  cards are decided; each `src/scene/*Look.ts` (for `?lines=`, `LineHighlight.tsx`) lists what to remove. Dev-only seams live on `window.__underground`.

## Rendering conventions
- One r3f scene for both the map and station interiors.
- Scene units are meters. x = east, z = south (north is up top-down), y = up. Convert lat/lon only through
  `src/lib/projection.ts`.
- Every color, line width, and font comes from `src/theme.ts`. Never hardcode them. The Canvas is `flat` (no tone
  mapping), so tokens render exactly as written. HUD uses Tailwind tokens (`bg-panel`, `text-ink`, ...) backed by
  theme CSS variables. Route colors go through `theme.routeLineMix` and a 3:1 contrast floor (`routeColor.ts`).
  Dimming mixes toward the background in sRGB (`mixHex`, `lineDim.ts`), never by opacity.
- Camera polar angle is a pure function of zoom distance (`src/lib/tilt.ts`). The same `tiltT` is `depthFactor`, the
  one parameter for every drawn depth (track profile, car height, ties, interior levels, veil, labels): 0 top-down, 1
  fully tilted. Take camera distances from the tilt and reveal helpers, not new constants.
- Rotation is allowed only while a station is focused or a train is followed, and only if the gesture was armed at
  its start (`rotateArmed`). `enableRotate` stays on; azimuth bounds alone stop a turn (toggling it mid-gesture applies
  a stale rotate start). Unfocused views spring back north-up.
- Every `on*` handler passed to `MapControls` stays referentially stable (`useCallback` + refs): a changed handler makes
  drei dispose and reconnect the controls, which can lock them mid-drag. Set control limits imperatively in `useFrame`,
  not as changing props.
- Never use a positive `useFrame` priority (it takes over rendering). Frame order: -3 LiveTrains steps slots and writes
  the follow anchor; -2 CameraRig (flight, focus, polar lock), touch twist goal, orbit bounds; -1 drei's `update()`;
  -0.75 train follow; -0.5 orbit pivot and pan clamp; -0.25 band view and interior presence; 0 draws (read-only camera).
- Per-frame paths (`useFrame` in LiveTrains, labels, presence, etc.) must not allocate or throw: errors there bypass
  error boundaries.
- Inside a keyed r3f list that can reorder (Scene's shown interiors, StationStreets' layers), never declare in JSX a
  prop that a cached `useFrame` writes (`visible`, a material's `opacity`): r3f re-applies a moved subtree's JSX props,
  and a frame that skips unchanged values never writes them back. Check the written value in the early return
  as a backstop.
- Overlay layers are `transparent` with `depthTest={false}` and an explicit `renderOrder` from
  `src/scene/renderOrder.ts`. Only car layers test depth: the car bodies and their above-veil platform copies test and
  write it (a far car would otherwise paint over a near one at iso tilt); the selected train's outline shells and the
  upper decks' platform footprints test without writing. Safe because nothing before the street cars writes depth and
  every non-car layer has depthTest off. three.js draws all opaque objects before all
  transparent ones, so `renderOrder` only sorts within a list; depth precision is too coarse at map zoom for z-offsets.
- All route shapes draw as one merged `LineSegments2` (one draw call). Buffer order is the overlap rule: non-primary
  shapes, then route_sort_order. Don't add per-route `<Line>`s.
- Shared corridors draw as side-by-side bands, shifted in the vertex shader (`BAND_GLSL`, the GLSL twin of `bandShift`
  in `src/lib/bandOffset.ts`; change both together, `bandGlsl.test.ts` pins them; they agree only while the line object's
  world matrix is identity). Buffers keep unshifted points. Anything that must sit on a route line goes through the band
  line material or `trackPointInto` (`src/lib/live/trackPoint.ts`); trains, cars and picks never use `pointAtDistance`
  on the raw line. The band search runs in a Web Worker after first paint; the realtime join waits for it.
- Each shape draws `network.trackOffsetM` to the right of its travel direction, and tracks follow a vertical profile
  (`trackProfile.ts`) anchored only at stations with an interior. Lines and trains share both.
- Picking is screen space, on click only (`ScenePicker`), never stopping or preventing MapControls' events. No meshes
  carry r3f pointer handlers.
- Interiors render in a group at `toGround(anchor)`; x/z are true (never rescaled, since dashes are object-space) and
  only `scale.y` carries the depth exaggeration. Level labels are plain DOM divs placed per frame (not drei `Html`).

## Station interior format
`public/data/stations/<id>.json`, type `StationInterior` in `src/data/stationSchema.ts` (the contract; read it before
authoring). Built by `npm run data:stations` from `data/stations/<id>.authored.json` plus pinned `<id>.sources.json`
(OSM, NY Open Data entrances, E&E); authoring rules in `data/README.md`.
- Local meters around `anchor`; `y` relative to the street (0), negative below, positive above. Levels sorted high to low.
- A complex is one file named after its lowest-sorted member, with `memberStationIds`; authored only, and it must cover
  its catalog complex's lead (the map focuses only leads).
- Elevators and escalators use the MTA equipment code as `id` (the outage join key).
- Every element has `sources`. The file is ODbL 1.0 with `attribution`; `nyopendata` elements and `ee-rise` depths are
  MTA data under the OPEN-NY Terms of Use, and `attribution` says so.
- `generated` marks template interiors (hand-authored wins). `approximate: true` and non-`ee-rise` `depthSource` mean
  estimated, shown as such.
- Authoring uses a `[u, v]` frame aligned to the platform; the merge converts it. Guesses are marked `UNVERIFIED:` in
  the authored file's `notes`; they are not copied to the output.
- `stations/index.json` lists every station with an interior; `index`, `equipment` and `amenities` are not valid
  station ids (those files share the directory).

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
- **The client never fetches MTA servers directly.** The MTA terms require serving through a non-MTA host, even
  though the feeds send ACAO `*`. Realtime, outages and alerts go through the `worker/` proxy; an MTA host in
  `VITE_RT_URL` turns those features off.
- **MTA alert text is never edited** (terms, clause 5): the `en` `header_text` passes through byte for byte and shows as
  a plain text node under our own derived line, never truncated, re-cased, rebuilt from `en-html` or put through html.
  Our line stays apart from the MTA's and says "probably" when it is a guess. Skipped stations come from the header's
  named stations ∩ the informed stops (`skipSetsOf`), never `affected_stations`; `description_text` is not shipped.
- **The client never fetches GeoSearch, Photon or Protomaps directly.** Addresses and places go through `/geocode`,
  only with `VITE_RT_URL` set. `q` is never logged anywhere (custom logs carry counts only, invocation logs off, query
  strings redacted, traces never on), never in the page URL, history, storage or a console line. Responses are
  `Cache-Control: no-store` with no `x-rt-cache` header (a cross-user oracle). `focus` is the map centre or a chosen
  station, never the location fix, and is dropped near a shown or recent fix (`lib/geocodeFocus.ts`,
  `geocodePrivacy.test.ts`). `/geocode` refuses a request with no allowed Origin.
- **Location never leaves the device.** One `getCurrentPosition` per press (no `watchPosition`), kept in memory only:
  no storage, URL, log or request carries it. After a location fly-to, basemap tiles load no finer than z12 and the
  view-driven station sets are empty until the user moves the view or picks a station or place (the location cap,
  `lib/basemap/locationCapHandle.ts`).
- **Station-named fetches reveal the station id to the static host.** Walk shards: only for a station the user
  picked, focused or chose as a trip end (`useStationWalk`), never one the camera merely shows. Interiors and street
  files: also for stations the camera shows (the view and prefetch sets, camera-driven, empty under the location
  cap). None is ever keyed by the fix or `nearestStation`. A trip end filled from the fix fetches nothing until the
  user picks or focuses it. Trip transfers load every authored interior so the change station isn't revealed (revisit
  above about 8 authored files).
- **Realtime has no lat/lon.** Vehicle positions are stop-relative, so dots are interpolated along shapes from
  TripUpdate times and scheduled run times.
- **Static GTFS is processed at build time only.** The 60 KB gzip budget (`scripts/lib/budget.ts`) is shared by every
  top-level `public/data/*.json` the client loads up front; per-station, timetable, equipment and street-index files
  have their own caps there and never block first render.
- **Data refresh is automated.** `.github/workflows/refresh-data.yml` runs daily and opens or updates one PR on
  `chore/data-refresh` (it writes `public/data` and `worker/data/streetIndex.json` only). That PR shows no check status
  (GITHUB_TOKEN PRs don't trigger workflows).
- **The basemap is never in git and loads on demand only.** Gzip MVT tiles from a pinned GitHub Release, unpacked by
  the deploy. Never name a tile `.gz` and never read byte ranges (Pages mishandles Range). The licensing gate
  (`basemapGate.ts`) fails on any credit beyond "© OpenStreetMap": never the landcover layer, places or pois; a failure
  goes to a person as a licensing card. The pin changes only by a normal PR.
- **The 2021 draft NYCT pathways feed** (read only by `scripts/score-archetypes.ts` for scoring) must never be
  committed, shipped, or used as a source.
- **Attribution.** Credit MTA and show "© OpenStreetMap contributors". Include a "may not be real time" notice. Don't
  use the MTA logo, route bullets, or the map. Show each `/geocode` source's credit under the results that use it.

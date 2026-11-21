# underground

## Purpose
A live view of the NYC subway as a static site on GitHub Pages
(github.com/cazzer/underground). It opens on a zoomed-out, low-fi architectural
wireframe map with small dots for moving trains. Pinch/scroll zooms. Zooming toward
a station continuously tilts the camera from top-down to isometric; later that view
shows the station's levels, stairways, and upcoming arrivals.

Status: scaffold. All data is hand-made sample data (`src/data/sample.ts`). The
realtime Worker (`worker/`) is built and not yet deployed; the client doesn't call it yet.

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
- `src/theme.ts`: all colors, line widths, fonts; presets selected by `?theme=`
- `src/scene/`: the r3f scene
  - `Scene.tsx` canvas and grid; `CameraRig.tsx` MapControls, zoom-driven tilt, fly-to, auto focus
  - `SubwayLines.tsx`, `Stations.tsx`, `Trains.tsx` (instanced dots); `cameraDistance.ts` helpers
- `src/ui/Hud.tsx`: Tailwind overlay (title, arrivals panel)
- `src/lib/`: pure logic
  - `projection.ts` lat/lon to scene meters; `tilt.ts` zoom distance to polar angle
  - `network.ts` sample data to routes/stations; `focusMachine.ts` camera-driven focus
    transitions; `pingPong.ts` triangle wave
  - `focus.tsx` focused/dismissed-station React context (not pure)
- `src/data/sample.ts`: sample lines and stations in lat/lon
- `src/data/schema.ts`: types of the six `public/data/*.json` files; `src/data/codec.ts`: shared
  pure helpers (trip-id parsing, trip/segment keys, delta codec, shape decode). Scripts and client both import these
- `src/data/realtime.ts`: client re-export of the realtime JSON types and `RT_URL`; no fetching
- `public/data/`: preprocessed static JSON (generated; `npm run data`)
- `scripts/`: `build-data.ts` (the only IO) and pure transforms in `scripts/lib/`, tests colocated
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
  HUD uses Tailwind tokens (`bg-panel`, `text-ink`, ...) backed by theme CSS variables.
- Camera polar angle is a pure function of zoom distance (`src/lib/tilt.ts`).
  User rotation is disabled. Markers and dots rescale with distance
  (`screenScale`) so they stay legible when zoomed out.
- Overlay layers (lines, markers, trains) are `transparent` with `depthTest={false}` and
  an explicit `renderOrder`: grid -1, lines 1, station fill 2, station ring 3, trains 4.
  drei's Grid is transparent, and three.js draws all opaque objects before all transparent
  ones, so `renderOrder` only sorts within a list; depth precision is too coarse at map
  zoom for z-offsets to work.

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
- **Station interiors are hand-authored per station.** They're merged with OSM platform
  polygons, NY Open Data entrances, and E&E elevator/escalator data. The starter
  stations are Bedford Av, 1 Av, 96 St (Q), and Park Pl.
- **Attribution.** Credit MTA and show "© OpenStreetMap contributors". Include a
  "may not be real time" notice. Don't use the MTA logo, route bullets, or the map.

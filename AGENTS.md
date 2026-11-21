# underground

## Purpose
A live view of the NYC subway as a static site on GitHub Pages
(github.com/cazzer/underground). It opens on a zoomed-out, low-fi architectural
wireframe map with small dots for moving trains. Pinch/scroll zooms. Zooming toward
a station continuously tilts the camera from top-down to isometric; later that view
shows the station's levels, stairways, and upcoming arrivals.

Status: scaffold. All data is hand-made sample data (`src/data/sample.ts`).

## Stack
Vite 8, React 19, TypeScript (strict), Tailwind v4 (`@tailwindcss/vite`), three.js,
`@react-three/fiber`, `@react-three/drei`, Vitest. npm. Vite `base` is `/underground/`,
so dev and preview serve under that path.

## Commands
- `npm run dev`: dev server (open the printed URL, path `/underground/`)
- `npm run build`: `tsc -b && vite build` to `dist/`
- `npm run preview`: serve the production build
- `npm test`: Vitest, run once
- `npm run typecheck`: `tsc --noEmit`

Run typecheck, test, and build before reporting work done. Pushing to `main` deploys
via `.github/workflows/deploy.yml` (Actions to Pages).

## Directory map
- `src/main.tsx`, `src/App.tsx`, `src/index.css`: entry, root layout, Tailwind + theme CSS vars
- `src/theme.ts`: all colors, line widths, fonts; presets selected by `?theme=`
- `src/scene/`: the r3f scene
  - `Scene.tsx` canvas and grid; `CameraRig.tsx` MapControls, zoom-driven tilt, fly-to, auto focus
  - `SubwayLines.tsx`, `Stations.tsx`, `Trains.tsx` (instanced dots); `cameraDistance.ts` helpers
- `src/ui/Hud.tsx`: Tailwind overlay (title, arrivals panel)
- `src/lib/`: pure logic
  - `projection.ts` lat/lon to scene meters; `tilt.ts` zoom distance to polar angle
  - `network.ts` sample data to routes/stations; `focus.tsx` focused-station context
- `src/data/sample.ts`: sample lines and stations in lat/lon
- `public/data/`: (planned) preprocessed static JSON
- `scripts/`: (planned) data preprocessing
- `worker/`: (planned) Cloudflare Worker CORS proxy for MTA realtime feeds
- `docs/research/`: research notes

## Hard rules
- Files stay at or under 300 lines (aim for 200). Split before exceeding.
- Tests only where they verify real functionality: pure logic and data transforms.
  No snapshot tests, no component tests by default. Colocate as `*.test.ts`.
- No backend, except the planned `worker/` CORS proxy. The site is static.
- Static data is preprocessed into small JSON under `public/data/` by scripts in
  `scripts/` (planned). Never ship raw GTFS or other large source files.
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
- Overlay markers/trains draw with `depthTest={false}` plus `renderOrder`; depth
  precision is too coarse at map zoom for z-offsets to work.

## Agent model routing
- opus: planning and architecture
- sonnet: implementation
- opus is also fine for three.js modeling work (station interiors, geometry)

## Work tracking
Track work in beads (`bd`). File tickets in Breakdown, not GitHub issues. Include a
description and an acceptance criterion on create.

## Review
Every change gets a `reviewer` agent pass. When the review is critical, send the
findings to the user as Breakdown review items and hold the merge until they decide.
A review is critical when:
- it finds a blocker or a should-fix,
- the change touches deploy/CI, the data pipeline, the CORS worker, or licensing, or
- it involves a look or feel decision.

How to file:
- Open a draft PR first so the items have a link.
- File one inbox item per finding with `brain_write`: `nodeType: inbox_item`,
  `sourceSystem: inbox`, `externalId: underground:pr/<n>/review/<slug>`, and metadata
  `{source: session, action: decide, status: pending, priority, url, links}`.
- Group nits into one item.
- The content gives the finding with file:line, then the proposed fix.

Reviews with nits only can be fixed in-loop without filing.

## Data
Research is pending in `docs/research/data-sources.md` (MTA static GTFS, GTFS-realtime
feeds, station geometry sources). Until it lands, use only `src/data/sample.ts`.
Do not fetch real MTA data yet.

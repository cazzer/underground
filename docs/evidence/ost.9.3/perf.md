# ost.9.3 basemap: phone perf, basemap on vs off

Production build (`npm run build`, `vite preview`), the pinned tiles (basemap-20261121-ddcef445), headless Chrome for
Testing (Playwright chromium-1200) on an Apple-silicon laptop, viewport 390×844 at 3× with touch, CDP CPU throttle 4×. The GPU is not
throttled and the display runs at 120 Hz, so a steady frame is 8.3 ms. Same script both ways, `?basemap=off` (no
basemap mounted, no tile requested) against the default. Measured after the network fade, area filter and road retune.

Scenario, one page load each: cold load and 10 s idle at the city view; "Bedford Av" typed into search and Enter, 6 s for the
flight to land; zoom out to about 1 km and a 10 s drag; 70 wheel steps out to about 35 km. Long tasks from a
`longtask` PerformanceObserver; frame times from requestAnimationFrame deltas.

| Phase | Basemap | Frame p95 (ms) | Longest frame (ms) | Long tasks (> 50 ms) | Longest task (ms) |
|---|---|---|---|---|---|
| Cold load | on (2 runs) | 10.2 / 10.2 | 216 / 183 | 4 / 4 | 218 / 192 |
| Cold load | off (2 runs) | 10.1 / 10.1 | 183 / 175 | 4 / 4 | 186 / 185 |
| Station flight (L08) | on | 10.1 / 10.1 | 34 / 18 | 0 / 0 | none |
| Station flight (L08) | off | 10.2 / 10.0 | 25 / 18 | 0 / 0 | none |
| 10 s pan at ~1 km | on | 10.1 / 10.1 | 10.4 / 10.4 | 0 / 0 | none |
| 10 s pan at ~1 km | off | 10.1 / 9.9 | 10.4 / 10.4 | 0 / 0 | none |
| Zoom out to ~35 km | on | 10.1 / 10.2 | 17 / 10.4 | 0 / 0 | none |
| Zoom out to ~35 km | off | 10.1 / 10.1 | 10.4 / 10.4 | 0 / 0 | none |

The four load long tasks are app startup (data parse, network build, first render) and happen with the basemap off
too; with it on the longest is 7 to 32 ms longer. After load no phase has a long task either way, and every p95 is
under 16.7 ms.

Dev build, same scenario, `performance.measure('basemap:apply')` (one per change of the drawn tile set): at load 3
applies, p50 4.0 ms, max 12.3 ms (the first city tiles into empty pools); station flight max 5.3 ms; pan 14 applies,
max 2.1 ms; zoom out 19, max 6.8 ms. Worker decode (off the main thread): mean 1.9 ms a tile, max 13 ms.

Caveats: a desktop CPU slowed 4× is not a phone (memory bandwidth, thermal limits and the GPU differ), and headless
Chrome composites differently; these are main-thread numbers. No physical phone was measured. The prod run has no dev hook, so the station step was not checked to land on L08 (in dev, with `select("L08")`, the numbers match).

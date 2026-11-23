# Test fixtures

## `rt-polls.json`

18 consecutive `/rt` responses from the deployed Worker (about 20 s apart, 2026-11-21 around 21:56 UTC),
each with the wall-clock time it arrived (`receivedAt`, epoch s). `src/lib/live/lagReplay.test.ts` replays
them (through `pollReplay.ts`) to time how far dots trail the feed and to check they don't leave a platform early
(underground-d80), and what the station panel shows around each arrival (`panelReplay.test.ts`, underground-dk6). The
asserted bounds lean early on purpose (`src/lib/realtime/arrivalShift.ts`): the median arrival at or before the feed's,
the p90 within 25 s, and the panel reading "Now" by the time the train is in on most rows. The recording itself is
about 20 s apart, so it says nothing about the client's 15 s poll; the full-hour tuning runs were done on scratch data.

Trimmed from the full recording (about 180 KB a poll) to 21 trips:
- 17 that appear in every poll and turn STOPPED_AT at least twice, most first, spread over feeds: 6 from the
  1234567 feed, 8 across the B-division and SI feeds, 3 L trains;
- 4 picked because they sit at a platform across polls (two 1234567, two L), where a cap that ignored the
  hold let dots leave about 250 m early.

Arrivals more than 15 minutes past `generatedAt` are dropped (the first two are always kept, like the
Worker's `ARRIVALS_MIN`). Feed headers, errors and staleness are as recorded; `droppedEntities` is 0.

## `rt-static.json`

The static data those trips need, cut from `public/data` (feed version `20261028-fall-2026-pick-with-long-term-
supplements`) so schedule refreshes can't move the test: the shapes the trips join to, the primary shape of each
of their routes and directions, every shape of their routes with one of their trip origins (origins trimmed to
those), the stations on those shapes, and the segments between their stops. The replay gives the same numbers
on it as on the full `public/data`. It is written one entry per line (a shape, a pattern, a station, a segment),
so a re-cut reads as a diff.

Both are MTA data (realtime through the Worker; static GTFS); see `docs/research/data-sources.md` for terms.

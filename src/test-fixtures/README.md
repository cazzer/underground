# Test fixtures

## `rt-polls.json`

18 consecutive `/rt` responses from the deployed Worker (about 20 s apart, 2026-11-21 around 21:56 UTC),
each with the wall-clock time it arrived (`receivedAt`, epoch s). `src/lib/live/lagReplay.test.ts` replays
them to time how far dots trail the feed (underground-d80).

Trimmed from the full recording (about 180 KB a poll) to 14 trips that appear in every poll and turn
STOPPED_AT at least twice: 5 from the 1234567 feed, 6 across the B-division and SI feeds, and 3 L trains.
Arrivals more than 15 minutes past `generatedAt` are dropped (the first two are always kept, like the
Worker's `ARRIVALS_MIN`). Feed headers, errors and staleness are as recorded; `droppedEntities` is 0.

The test joins these trips against the committed `public/data`. If a new schedule pick stops them joining,
record a fresh run of polls and trim it the same way.

MTA realtime data, served through the Worker; see `docs/research/data-sources.md` for its terms.

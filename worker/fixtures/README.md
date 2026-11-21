# Fixtures

Recorded MTA GTFS-RT protobuf feeds, used by `src/transform.test.ts`.

- `feed-l.pb`: `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l` (27,878 B)
- `feed-si.pb`: `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si` (5,471 B)
- Recorded 2026-11-20. Data: MTA.

Tests hardcode values from these files. If you re-record, update the constants.

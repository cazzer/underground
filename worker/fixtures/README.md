# Fixtures

Recorded MTA feeds: GTFS-RT protobuf for `src/transform.test.ts`, E&E outages JSON for `src/ene.test.ts`.

- `feed-l.pb`: `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l` (27,878 B)
- `feed-si.pb`: `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si` (5,471 B)
- Recorded 2026-11-20. Data: MTA.
- `ene.json`: `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fnyct_ene.json`, recorded 2026-11-22 05:10:06 GMT (epoch 1795324206, used as `generatedAt` in tests); 8 of 151 rows, values verbatim; upstream 61,897 B. Data: MTA.

Tests hardcode values from these files. If you re-record, update the constants.

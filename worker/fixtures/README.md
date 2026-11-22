# Fixtures

Recorded feeds: MTA GTFS-RT protobuf for `src/transform.test.ts`, MTA E&E outages JSON for `src/ene.test.ts`, geocoder answers for the geocode tests.

- `feed-l.pb`: `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l` (27,878 B)
- `feed-si.pb`: `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si` (5,471 B)
- Recorded 2026-11-20. Data: MTA.
- `ene.json`: `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fnyct_ene.json`, recorded 2026-11-22 05:10:06 GMT (epoch 1795324206, used as `generatedAt` in tests); 8 of 151 rows, values verbatim; upstream 61,897 B. Data: MTA.
- `geocode.json`: trimmed upstream answers for `src/geosearch.test.ts`, `src/photon.test.ts`, `src/geocodeMerge.test.ts`,
  keyed by source then normalized query ("120 broadway", "katz's deli", "barclays center"). Recorded 2026-11-22 15:54 GMT
  with focus 40.73,-73.99 (the request text was mixed case; both APIs ignore case).
  - `geosearch`: `https://geosearch.planninglabs.nyc/v2/autocomplete?text=…&focus.point.lat=40.73&focus.point.lon=-73.99`;
    only `geometry` and `properties.{layer,name,housenumber,borough}` kept; all features kept (6, 0, 10). Data: NYC Department of City Planning (PAD).
  - `photon`: `https://photon.komoot.io/api?q=…&lat=40.73&lon=-73.99&limit=8&lang=en&bbox=-74.2591,40.4774,-73.7004,40.9176`;
    only `geometry` and `properties.{osm_key,osm_value,type,name,housenumber,street,district,city,state,countrycode}` kept (8, 1, 8).
    Data © OpenStreetMap contributors (ODbL), via komoot Photon.

Tests hardcode values from these files. If you re-record, update the constants.

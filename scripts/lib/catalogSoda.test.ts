import { describe, expect, it } from 'vitest'
import { assertRowCount, normalizeMrn, parseCount, parseLatestMonth, parseViewMeta, trimCatalogAmenities, trimCatalogEntrances, trimCatalogEquipment, trimCatalogStations } from './catalogSoda.ts'

const stationRow = (over: Record<string, unknown> = {}) => ({
  gtfs_stop_id: 'L08', station_id: '120', complex_id: '120', division: 'BMT', line: 'Canarsie', stop_name: 'Bedford Av',
  borough: 'Bk', cbd: 'false', daytime_routes: 'L', structure: 'Subway', gtfs_latitude: '40.717304', gtfs_longitude: '-73.956872',
  north_direction_label: 'Manhattan', south_direction_label: 'Outbound', ada: '1', ada_northbound: '1', ada_southbound: '0', ada_notes: 'NaN', ...over,
})

describe('normalizeMrn', () => {
  it('strips the zero padding and passes absent through', () => {
    expect(normalizeMrn('059')).toBe('59')
    expect(normalizeMrn('120')).toBe('120')
    expect(normalizeMrn('000')).toBe('0')
    expect(normalizeMrn(undefined)).toBeNull()
  })
  it('rejects non-digits, naming the path', () => {
    expect(() => normalizeMrn('A1', 'equipment[3].station_mrn')).toThrow(/equipment\[3\]\.station_mrn/)
  })
})

describe('trimCatalogStations', () => {
  it('converts types, splits routes and nulls the NaN note', () => {
    expect(trimCatalogStations([stationRow({ daytime_routes: 'N  W' })])).toEqual([
      {
        gtfsStopId: 'L08', stationId: '120', complexId: '120', division: 'BMT', line: 'Canarsie', name: 'Bedford Av', borough: 'Bk',
        routes: ['N', 'W'], structure: 'Subway', lat: 40.717304, lon: -73.956872, ada: 1, adaNorth: true, adaSouth: false, adaNotes: null,
        northLabel: 'Manhattan', southLabel: 'Outbound',
      },
    ])
  })
  it('trims the routes and throws on a blank list', () => {
    expect(trimCatalogStations([stationRow({ daytime_routes: ' N W ' })])[0]!.routes).toEqual(['N', 'W'])
    expect(() => trimCatalogStations([stationRow({ daytime_routes: '   ' })])).toThrow(/daytime_routes/)
  })
  it('sorts by gtfsStopId and keeps real ADA notes', () => {
    const rows = trimCatalogStations([stationRow({ gtfs_stop_id: 'R01' }), stationRow({ gtfs_stop_id: 'A02', ada_notes: 'Uptown only' })])
    expect(rows.map((r) => r.gtfsStopId)).toEqual(['A02', 'R01'])
    expect(rows[0]!.adaNotes).toBe('Uptown only')
  })
  it('throws on an unknown structure, naming the row', () => {
    expect(() => trimCatalogStations([stationRow(), stationRow({ structure: 'Tunnel' })])).toThrow(/stations\[1\]\.structure/)
  })
})

const entrance = (over: Record<string, unknown> = {}) => ({
  gtfs_stop_id: 'L08', station_id: '120', complex_id: '120', entrance_type: 'Stair', entry_allowed: 'YES', exit_allowed: 'NO',
  entrance_latitude: '40.717778', entrance_longitude: '-73.9574692', ...over,
})

describe('trimCatalogEntrances', () => {
  it('splits shared stop ids and keeps the coordinates exactly', () => {
    const [row] = trimCatalogEntrances([entrance({ gtfs_stop_id: 'A32; D20', station_id: '167', complex_id: '167' })])
    expect(row).toEqual({ type: 'Stair', entry: true, exit: false, lat: 40.717778, lon: -73.9574692, gtfsStopIds: ['A32', 'D20'], stationId: '167', complexId: '167' })
  })
  it('sorts by numeric stationId, then lat, then lon', () => {
    const rows = trimCatalogEntrances([
      entrance({ station_id: '27', entrance_latitude: '40.5' }),
      entrance({ station_id: '120', entrance_latitude: '40.2', entrance_longitude: '-73.9' }),
      entrance({ station_id: '120', entrance_latitude: '40.2', entrance_longitude: '-74' }),
      entrance({ station_id: '9', entrance_latitude: '40.9' }),
    ])
    expect(rows.map((r) => [r.stationId, r.lat, r.lon])).toEqual([['9', 40.9, -73.9574692], ['27', 40.5, -73.9574692], ['120', 40.2, -74], ['120', 40.2, -73.9]])
  })
})

const elevator = {
  equipment_code: 'EL358', elevator_or_escalator: 'Elevator', station_mrn: '059', station_complex_mrn: '059', x_coordinate: '40.717735', y_coordinate: '-73.95772',
  revenue_machine: 'YES', notes: 'mezzanine to platform', elevator_rise: "10' - 9 7/8in", elevator_number_of_landings: '2', elevator_direction_serviced: 'Both',
  ada_compliant: 'YES', street_access: 'NO', elevator_mezzanine_1_access: '+', elevator_mezzanine_2_access: '-', elevator_platform_access: '+',
  service_status: 'Installed-Functioning-In Service', alternative_route: 'Use the other one',
}

describe('trimCatalogEquipment', () => {
  it('normalizes MRNs, maps +/- flags and picks the rise column by kind', () => {
    const rows = trimCatalogEquipment([elevator, { equipment_code: 'ES1', elevator_or_escalator: 'Escalator', revenue_machine: 'YES', escalator_rise: "27'" }])
    expect(rows[0]).toEqual({
      code: 'EL358', kind: 'elevator', revenue: true, stationId: '59', complexId: '59', lat: 40.717735, lon: -73.95772, serving: 'mezzanine to platform',
      rise: "10' - 9 7/8in", landings: '2', direction: 'Both', ada: true, streetAccess: false, mezzanine1Access: true, mezzanine2Access: false, platformAccess: true,
    })
    expect(rows[1]).toMatchObject({ code: 'ES1', kind: 'escalator', rise: "27'", landings: null, mezzanine1Access: null })
  })
  it('keeps yard machines with no station, position or notes', () => {
    const [row] = trimCatalogEquipment([{ equipment_code: 'EL151', elevator_or_escalator: 'Elevator', revenue_machine: 'NO' }])
    expect(row).toMatchObject({ code: 'EL151', revenue: false, stationId: null, complexId: null, lat: null, lon: null, serving: null, rise: null, platformAccess: null })
  })
  it('throws when only one coordinate is present', () => {
    expect(() => trimCatalogEquipment([{ ...elevator, y_coordinate: undefined }])).toThrow(/equipment\[0\].*only one/)
  })
  it('throws on an unknown flag and on a duplicate code', () => {
    expect(() => trimCatalogEquipment([{ ...elevator, elevator_platform_access: 'yes' }])).toThrow(/elevator_platform_access/)
    expect(() => trimCatalogEquipment([elevator, elevator])).toThrow(/duplicate code EL358/)
  })
  it('sorts by code', () => {
    expect(trimCatalogEquipment([{ ...elevator, equipment_code: 'EL9' }, elevator]).map((r) => r.code)).toEqual(['EL358', 'EL9'])
  })
})

describe('trimCatalogAmenities', () => {
  const restroom = { month: '2026-10-01T00:00:00.000', amenity_id: '403589', amenity_type: 'PUBLIC_RESTROOM', station_mrn: '330', station_name: 'Whitehall St-South Ferry', lines: '1 R W', borough: 'MANHATTAN', latitude: '40.7', longitude: '-74.0' }
  it('keeps id, type, station and month, with a padded MRN unpadded', () => {
    expect(trimCatalogAmenities([{ ...restroom, station_mrn: '059' }])).toEqual([{ id: '403589', type: 'PUBLIC_RESTROOM', stationId: '59', month: '2026-10-01' }])
  })
  it('sorts by id', () => {
    expect(trimCatalogAmenities([{ ...restroom, amenity_id: '9' }, restroom]).map((r) => r.id)).toEqual(['403589', '9'])
  })
  it('throws, naming the row, on a bad type, month, station or a duplicate id', () => {
    expect(() => trimCatalogAmenities([{ ...restroom, amenity_type: 'ELEVATOR' }])).toThrow(/amenities\[0\].amenity_type/)
    expect(() => trimCatalogAmenities([{ ...restroom, month: '2026-10-15T00:00:00.000' }])).toThrow(/amenities\[0\].month/)
    expect(() => trimCatalogAmenities([{ ...restroom, station_mrn: undefined }])).toThrow(/amenities\[0\]: has no station_mrn/)
    expect(() => trimCatalogAmenities([{ ...restroom, amenity_id: undefined }])).toThrow(/amenities\[0\].amenity_id/)
    expect(() => trimCatalogAmenities([restroom, restroom])).toThrow(/duplicate id 403589/)
  })
  it('reads the latest month from max(month)', () => {
    expect(parseLatestMonth([{ max_month: '2026-10-01T00:00:00.000' }], 'x')).toBe('2026-10-01')
    expect(() => parseLatestMonth([{}], 'x')).toThrow(/max_month/)
  })
})

describe('count and metadata checks', () => {
  it('reads count(*) and refuses a row count mismatch', () => {
    expect(parseCount([{ count: '496' }], 'x')).toBe(496)
    expect(() => assertRowCount([1, 2], 3, '39hk-dx4f')).toThrow(/got 2 rows but count\(\*\) says 3/)
    expect(() => assertRowCount([1, 2, 3], 3, 'x')).not.toThrow()
  })
  it('reads view metadata and rejects a missing attribution', () => {
    const view = { name: 'MTA Subway Stations', attribution: 'MTA', attributionLink: 'https://www.mta.info/open-data', rowsUpdatedAt: 1756239866 }
    expect(parseViewMeta(view, 'x')).toEqual({ title: 'MTA Subway Stations', attribution: 'MTA', attributionLink: 'https://www.mta.info/open-data', rowsUpdatedAt: '2025-08-26T20:24:26.000Z' })
    expect(() => parseViewMeta({ ...view, attribution: undefined }, 'x')).toThrow(/attribution/)
  })
})

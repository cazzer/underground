import { describe, expect, it } from 'vitest'
import { groupByTrip, parseGtfsTime, parseNum, readFeed } from './gtfs.ts'

function texts(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'feed_info.txt': 'feed_version\nv-test\n',
    'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n101,Van,40.5,-73.5,1,\n101N,Van,40.5,-73.5,,101\n',
    'routes.txt':
      'route_id,route_short_name,route_long_name,route_color,route_text_color,route_sort_order\n1,1,Broadway,EE352E,FFFFFF,3\n',
    'trips.txt': 'route_id,trip_id,service_id,direction_id,shape_id\n1,X_000600_1..S03R,Sunday,1,1..S03R\n',
    'stop_times.txt':
      'trip_id,stop_id,arrival_time,departure_time,stop_sequence\nX_000600_1..S03R,101S,25:10:30,25:11:00,10\nX_000600_1..S03R,103S,25:12:00,25:12:00,9\n',
    'shapes.txt': 'shape_id,shape_pt_sequence,shape_pt_lat,shape_pt_lon\n1..S03R,10,40.5,-73.5\n',
    'transfers.txt': 'from_stop_id,to_stop_id,min_transfer_time\n101,103,180\n',
    'calendar.txt':
      'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nSunday,0,0,0,0,0,0,1,20261101,20270515\n',
    'calendar_dates.txt': 'service_id,date,exception_type\nSunday,20261126,1\n',
    ...overrides,
  }
}

describe('parseGtfsTime', () => {
  it('converts clock times to seconds, including past 24h', () => {
    expect(parseGtfsTime('00:06:00')).toBe(360)
    expect(parseGtfsTime('25:10:30')).toBe(90630)
    expect(parseGtfsTime('5:10:00')).toBe(18600)
  })
  it('throws on garbage', () => {
    expect(() => parseGtfsTime('x')).toThrow()
    expect(() => parseGtfsTime('')).toThrow()
  })
})

describe('parseNum', () => {
  it('throws on blank and non-numeric input', () => {
    expect(parseNum('1.5', 'x')).toBe(1.5)
    expect(() => parseNum('', 'x')).toThrow(/x/)
    expect(() => parseNum('abc', 'x')).toThrow()
  })
})

describe('readFeed', () => {
  it('maps the needed columns to typed values', () => {
    const feed = readFeed(texts())
    expect(feed.feedVersion).toBe('v-test')
    expect(feed.stops[0]).toEqual({ id: '101', name: 'Van', lat: 40.5, lon: -73.5, locationType: 1, parent: '' })
    expect(feed.stops[1]!.locationType).toBe(0)
    expect(feed.routes[0]!.sortOrder).toBe(3)
    expect(feed.trips[0]).toMatchObject({ direction: 'S', shapeId: '1..S03R' })
    expect(feed.stopTimes[0]).toMatchObject({ arrival: 90630, departure: 90660, sequence: 10 })
    expect(feed.calendar[0]!.days).toEqual([0])
    expect(feed.calendarDates[0]).toEqual({ serviceId: 'Sunday', date: '20261126', exceptionType: 1 })
  })
  it('parses sequences as numbers so 10 sorts after 9', () => {
    const rows = groupByTrip(readFeed(texts()).stopTimes).get('X_000600_1..S03R')!
    expect(rows.map((r) => r.sequence)).toEqual([9, 10])
  })
  it('throws on a missing table', () => {
    const t = texts()
    delete t['shapes.txt']
    expect(() => readFeed(t)).toThrow(/shapes\.txt/)
  })
  it('throws on a non-numeric lat', () => {
    const bad = 'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n101,Van,north,-73.5,1,\n'
    expect(() => readFeed(texts({ 'stops.txt': bad }))).toThrow(/stop_lat/)
  })
  it('throws when feed_version is missing or blank', () => {
    expect(() => readFeed(texts({ 'feed_info.txt': 'feed_version\n\n' }))).toThrow(/feed_version/)
    expect(() => readFeed(texts({ 'feed_info.txt': 'feed_version\n,\n' }))).toThrow()
  })
  it('throws on an unknown direction_id', () => {
    const bad = 'route_id,trip_id,service_id,direction_id,shape_id\n1,X_000600_1..S03R,Sunday,2,1..S03R\n'
    expect(() => readFeed(texts({ 'trips.txt': bad }))).toThrow(/direction_id/)
  })
})

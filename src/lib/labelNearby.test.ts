import { describe, expect, it } from 'vitest'
import { nearbyMarkers } from './labelNearby'

describe('nearbyMarkers', () => {
  const stations = [
    { id: 'a', pos: { x: 0, z: 0 } },
    { id: 'b', pos: { x: 150, z: 0 } },
    { id: 'c', pos: { x: 300, z: 0 } },
    { id: 'd', pos: { x: 900, z: 0 } },
  ]

  it('takes each station within reach of any anchor once, in station order', () => {
    const near = nearbyMarkers(stations, [{ x: 0, z: 0 }, { x: 300, z: 0 }], new Set(), 200)
    expect(near.ids).toEqual(['a', 'b', 'c'])
    expect(near.points).toEqual([stations[0]!.pos, stations[1]!.pos, stations[2]!.pos])
  })

  it('leaves out the excluded stations', () => {
    expect(nearbyMarkers(stations, [{ x: 0, z: 0 }], new Set(['a']), 200).ids).toEqual(['b'])
  })

  it('counts a station exactly at the reach', () => {
    expect(nearbyMarkers(stations, [{ x: 0, z: 0 }], new Set(), 150).ids).toEqual(['a', 'b'])
    expect(nearbyMarkers(stations, [{ x: 0, z: 0 }], new Set(), 149.9).ids).toEqual(['a'])
    expect(nearbyMarkers(stations, [], new Set(), 1000).ids).toEqual([])
  })
})

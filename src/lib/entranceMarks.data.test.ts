/** Entrance marks on the committed Bedford Av (L08) files: the street file's entrances and the hand-authored
 *  interior's are the same nine, so the street layer must add no mark of its own there. */
import { describe, expect, it } from 'vitest'
import interiorRaw from '../../public/data/stations/L08.json?raw'
import streetsRaw from '../../public/data/streets/L08.json?raw'
import type { StationInterior } from '../data/stationSchema'
import type { StationStreets } from '../data/streetSchema'
import { unmatchedEntrances } from './entranceMarks'
import { toGround } from './projection'

const interior = JSON.parse(interiorRaw) as StationInterior
const streets = JSON.parse(streetsRaw) as StationStreets

describe('entrance marks at Bedford Av (L08)', () => {
  it('doubles none of the interior’s entrances', () => {
    expect(streets.entrances.length).toBeGreaterThan(0)
    const at = { origin: toGround(interior.anchor), entrances: interior.entrances }
    expect(unmatchedEntrances(streets, toGround(streets.anchor), at)).toEqual([])
  })
})

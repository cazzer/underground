/** Every committed street file's entrance labels: at most 32, the street label placement's marker-exemption cap
 *  (one bit per label, `exemptExitFromMarks`). A complex's members share entrances, so the build keeps this true. */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StationStreets } from '../data/streetSchema'
import { entranceTexts } from './entranceText'

const DIR = new URL('../../public/data/streets/', import.meta.url)

describe('street file entrance labels', () => {
  it('number at most 32 per file', () => {
    const names = readdirSync(DIR).filter((f) => f.endsWith('.json'))
    expect(names.length).toBeGreaterThan(400)
    for (const name of names) {
      const file = JSON.parse(readFileSync(new URL(name, DIR), 'utf8')) as StationStreets
      expect(entranceTexts(file).length, name).toBeLessThanOrEqual(32)
    }
  })
})

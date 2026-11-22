import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StationIndex, StationInterior } from '../data/stationSchema'
import { routesToStreet } from './interiorGraph'

const index = JSON.parse(readFileSync('public/data/stations/index.json', 'utf8')) as StationIndex
const files = [...new Set(Object.entries(index.stations).map(([id, entry]) => entry.file ?? id))].sort()

describe('routesToStreet on every committed interior', () => {
  const load = (id: string) => JSON.parse(readFileSync(`public/data/stations/${id}.json`, 'utf8')) as StationInterior

  it('finds an exit from every track, without throwing', () => {
    expect(files.length).toBeGreaterThan(250)
    const none: string[] = []
    for (const id of files) {
      const interior = load(id)
      const tracks = interior.platforms.flatMap((p) => p.tracks.map((t) => ({ stop: t.stopId })))
      expect(tracks.length, id).toBeGreaterThan(0)
      for (const { stop } of tracks) {
        const routes = routesToStreet(interior, stop)
        if (routes && routes.length > 0) continue
        none.push(`${id} ${stop}`)
      }
    }
    expect(none).toEqual([])
  }, 60_000)

  it('reaches the street step-free from station 109 only through unlisted street ends', () => {
    const interior = load('109')
    for (const stop of new Set(interior.platforms.flatMap((p) => p.tracks.map((t) => t.stopId)))) {
      const routes = routesToStreet(interior, stop, { stepFree: true })!
      expect(routes.length, stop).toBeGreaterThan(0)
      expect(routes.every((r) => r.exit.entranceId === null), stop).toBe(true)
    }
  }, 60_000)
})

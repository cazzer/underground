/** The street cells (streetCells.ts) on the real street files: the two nearest station leads that both have one. */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StationsFile } from '../data/schema'
import type { StationStreets } from '../data/streetSchema'
import type { LineBuffers } from './lineBuffers'
import { toGround, type Ground } from './projection'
import { streetBuffers } from './streetBuffers'
import { clipToCell, streetCells } from './streetCells'

const DIR = new URL('../../public/data/', import.meta.url)
const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, DIR), 'utf8')) as T
const stations = read<StationsFile>('stations.json')
const followers = new Set((stations.complexes ?? []).flatMap((ids) => ids.slice(1)))
const leads = stations.stations.filter((s) => !followers.has(s.id) && existsSync(new URL(`streets/${s.id}.json`, DIR)))
const files = new Map(leads.map((s) => [s.id, read<StationStreets>(`streets/${s.id}.json`)]))

/** Two files' simplified lines may sit apart by both Douglas-Peucker tolerances (0.5 m each) plus a decimeter. */
const COVER_M = 1.1
/** Within this of the cut both layers' ends are near a sample. */
const CUT_SLACK_M = 2
const SAMPLE_M = 2
const RGB: [number, number, number] = [1, 1, 1]

function nearestPair(): [string, string] {
  let best: [string, string] = ['', '']
  let bestD = Infinity
  const points = leads.map((s) => ({ id: s.id, g: toGround(files.get(s.id)!.anchor) }))
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(points[i]!.g.x - points[j]!.g.x, points[i]!.g.z - points[j]!.g.z)
      if (d > 1 && d < bestD) {
        bestD = d
        best = [points[i]!.id, points[j]!.id]
      }
    }
  }
  return best
}

/** Every segment of `b` in scene meters (anchor added), four floats each. */
function sceneSegments(b: LineBuffers, at: Ground): Float64Array {
  const out = new Float64Array((b.positions.length / 6) * 4)
  for (let i = 0, k = 0; i + 6 <= b.positions.length; i += 6, k += 4) {
    out[k] = b.positions[i]! + at.x
    out[k + 1] = b.positions[i + 2]! + at.z
    out[k + 2] = b.positions[i + 3]! + at.x
    out[k + 3] = b.positions[i + 5]! + at.z
  }
  return out
}

function distanceTo(segs: Float64Array, x: number, z: number): number {
  let best = Infinity
  for (let k = 0; k < segs.length; k += 4) {
    const ax = segs[k]!
    const az = segs[k + 1]!
    const dx = segs[k + 2]! - ax
    const dz = segs[k + 3]! - az
    const len2 = dx * dx + dz * dz
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2))
    best = Math.min(best, Math.hypot(ax + t * dx - x, az + t * dz - z))
  }
  return best
}

describe('street cells on the nearest pair of station leads', () => {
  const [idA, idB] = nearestPair()
  const fileA = files.get(idA)!
  const fileB = files.get(idB)!
  const a = toGround(fileA.anchor)
  const b = toGround(fileB.anchor)
  const [cellA, cellB] = streetCells([
    { id: idA, x: a.x, z: a.z, radiusM: fileA.radiusM },
    { id: idB, x: b.x, z: b.z, radiusM: fileB.radiusM },
  ])
  const keptA = sceneSegments(clipToCell(streetBuffers(fileA, RGB, RGB), cellA!), a)
  const keptB = sceneSegments(clipToCell(streetBuffers(fileB, RGB, RGB), cellB!), b)

  it(`${idA} and ${idB} overlap, so each is cut`, () => {
    expect(cellA!.planes.length).toBeGreaterThan(0)
    expect(cellB!.planes.length).toBeGreaterThan(0)
  })

  it('draws every street in the overlap once', () => {
    const ux = b.x - a.x
    const uz = b.z - a.z
    const gap = Math.hypot(ux, uz)
    let samples = 0
    for (const segs of [sceneSegments(streetBuffers(fileA, RGB, RGB), a), sceneSegments(streetBuffers(fileB, RGB, RGB), b)]) {
      for (let k = 0; k < segs.length; k += 4) {
        const len = Math.hypot(segs[k + 2]! - segs[k]!, segs[k + 3]! - segs[k + 1]!)
        for (let s = 0; s <= len; s += SAMPLE_M) {
          const t = len === 0 ? 0 : s / len
          const x = segs[k]! + t * (segs[k + 2]! - segs[k]!)
          const z = segs[k + 1]! + t * (segs[k + 3]! - segs[k + 1]!)
          // Well inside both discs, where both files hold every street.
          if (Math.hypot(x - a.x, z - a.z) > fileA.radiusM - 5 || Math.hypot(x - b.x, z - b.z) > fileB.radiusM - 5) continue
          samples++
          const inA = distanceTo(keptA, x, z) <= COVER_M
          const inB = distanceTo(keptB, x, z) <= COVER_M
          expect(inA || inB, `(${x.toFixed(1)}, ${z.toFixed(1)}) drawn by neither`).toBe(true)
          // Signed distance past the equal-radius bisector, toward B.
          const along = ((x - a.x) * ux + (z - a.z) * uz) / gap - gap / 2
          if (Math.abs(along) > CUT_SLACK_M) expect(inA && inB, `(${x.toFixed(1)}, ${z.toFixed(1)}) drawn twice`).toBe(false)
        }
      }
    }
    expect(samples).toBeGreaterThan(100)
  })
})

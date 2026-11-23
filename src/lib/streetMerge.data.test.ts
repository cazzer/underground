/** Every committed complex's merged street layer (src/lib/streetMerge.ts) on the real street files. */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StationStreets, StreetEntrance } from '../data/streetSchema'
import { ENTRANCE_MATCH_M } from './entranceMarks'
import { entranceTexts } from './entranceText'
import { toGround } from './projection'
import { mergeComplexStreets } from './streetMerge'

const DIR = new URL('../../public/data/', import.meta.url)
const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, DIR), 'utf8')) as T
const complexes = read<{ complexes: string[][] }>('stations.json').complexes

/** Entrances added to the lead's, by complex lead. Update deliberately when the street files change. */
const ADDED: Record<string, number> = { '725': 10, E01: 9, L02: 7, '631': 2, '232': 1, D16: 1 }

function streetsOf(id: string): StationStreets | null {
  return existsSync(new URL(`streets/${id}.json`, DIR)) ? read<StationStreets>(`streets/${id}.json`) : null
}

/** Scene ground meters of an entrance of `file`. */
function ground(file: StationStreets, e: StreetEntrance): { x: number; z: number } {
  const g = toGround(file.anchor)
  return { x: g.x + e.x / 10, z: g.z + e.z / 10 }
}

describe('merged complex street layers', () => {
  for (const ids of complexes) {
    const [leadId, ...memberIds] = ids as [string, ...string[]]
    const lead = streetsOf(leadId)
    const members = memberIds.flatMap((id) => streetsOf(id) ?? [])
    const group = `${leadId} (${ids.join(', ')})`

    it(`${group}: keeps every member entrance, none twice, and labels the added ones`, () => {
      expect(lead, `street file of ${leadId}`).not.toBeNull()
      const { file: merged, extraLines } = mergeComplexStreets(lead!, members)
      const added = merged.entrances.slice(lead!.entrances.length)
      expect(merged.entrances.slice(0, lead!.entrances.length), group).toEqual(lead!.entrances)
      expect(added.length, `${group}: entrances added`).toBe(ADDED[leadId] ?? 0)

      // None lost: every entrance of every file has a merged one of its type within the match distance.
      const mergedAt = merged.entrances.map((e) => ({ type: e.type, ...ground(merged, e) }))
      for (const file of [lead!, ...members]) {
        for (const e of file.entrances) {
          const g = ground(file, e)
          const found = mergedAt.some((m) => m.type === e.type && Math.hypot(m.x - g.x, m.z - g.z) <= ENTRANCE_MATCH_M)
          expect(found, `${group}: ${file.stationId} ${e.type} at ${e.x},${e.z} lost`).toBe(true)
        }
      }

      // No duplicates: added entrances of different source files are never within the match distance (less the
      // decimeter rounding of the merged position).
      const source = added.map((a) => {
        const g = ground(merged, a)
        return members.findIndex((m) =>
          m.entrances.some((e) => e.type === a.type && Math.hypot(ground(m, e).x - g.x, ground(m, e).z - g.z) < 0.1),
        )
      })
      source.forEach((s) => expect(s, `${group}: an added entrance has no source`).toBeGreaterThanOrEqual(0))
      const all = [...lead!.entrances.map((e) => ({ e, from: -1, ...ground(lead!, e) })), ...added.map((e, i) => ({ e, from: source[i]!, ...ground(merged, e) }))]
      for (let i = 0; i < all.length; i++) {
        for (let j = 0; j < i; j++) {
          const [a, b] = [all[i]!, all[j]!]
          if (a.from === b.from || a.e.type !== b.e.type) continue
          expect(Math.hypot(a.x - b.x, a.z - b.z), `${group}: ${a.e.type} twice`).toBeGreaterThan(ENTRANCE_MATCH_M - 0.1)
        }
      }

      // The members' entrances follow the lead's, nearest the lead first.
      const dist = added.map((a) => Math.hypot(a.x, a.z))
      expect(dist, `${group}: order`).toEqual([...dist].sort((a, b) => a - b))

      // Every added entrance is on some label (so it has a list row and a mark's label).
      const labels = entranceTexts(merged, extraLines)
      const labelled = new Set(labels.flatMap((t) => t.members))
      for (let i = lead!.entrances.length; i < merged.entrances.length; i++) {
        expect(labelled.has(i), `${group}: added entrance ${i} (${merged.entrances[i]!.type}) has no label`).toBe(true)
      }
    })
  }
})

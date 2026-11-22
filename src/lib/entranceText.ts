/** One station's entrance labels, worded together: one order per street pair, a nearby street for an entrance with
 *  no cross street, and a compass side of it when two labels would still read the same. Pure; reads the street file
 *  as it is (the join and the files are left alone). */
import type { StationStreets } from '../data/streetSchema'
import { isClosedRing, isStreet, streetKey } from './streetClass'
import { abbreviateStreet, entranceLabel, entranceParts, joinParts, type EntranceWording } from './streetName'

/** The file's coordinates are integer decimeters. */
const DM_PER_M = 10
/** A nearby street names an entrance with no cross street only within this far of it, meters. */
export const NEAR_STREET_M = 60

/** One labelled entrance of the file. */
export interface EntranceText {
  /** Its index in the file's entrances. */
  index: number
  /** Meters from the file's anchor. */
  x: number
  z: number
  /** The label's street part and the rest ('' for none), and both on one line. */
  head: string
  tail: string
  text: string
  elevator: boolean
  /** No other entrance of the station has this text. */
  unique: boolean
  /** The `streetKey`s of the streets the label names. */
  keys: string[]
}

interface NamedLine {
  name: string
  key: string
  points: [number, number][]
}

/** The nearest point to p on the lines that `match` accepts, with its line and distance; null when none does. */
function nearest(lines: readonly NamedLine[], p: readonly [number, number], match: (l: NamedLine) => boolean) {
  let best: { line: NamedLine; d: number; qx: number; qz: number } | null = null
  for (const line of lines) {
    if (!match(line)) continue
    for (let i = 1; i < line.points.length; i++) {
      const [ax, az] = line.points[i - 1]!
      const [bx, bz] = line.points[i]!
      const dx = bx - ax
      const dz = bz - az
      const len2 = dx * dx + dz * dz
      const t = len2 > 0 ? Math.min(Math.max(((p[0] - ax) * dx + (p[1] - az) * dz) / len2, 0), 1) : 0
      const qx = ax + dx * t
      const qz = az + dz * t
      const d = Math.hypot(p[0] - qx, p[1] - qz)
      if (best === null || d < best.d) best = { line, d, qx, qz }
    }
  }
  return best
}

/** Sign order of a street name, as MTA signs pair them: avenue-type first, then streets, then the rest. */
export function pairRank(name: string): number {
  const words = abbreviateStreet(name).split(' ')
  if (words.some((w) => w === 'Av' || w === 'Blvd' || w === 'Pkwy' || w === 'Broadway')) return 0
  if (words.slice(1).includes('St')) return 1
  return 2
}

function compass(dx: number, dz: number): 'N' | 'S' | 'E' | 'W' {
  if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? 'E' : 'W'
  return dz > 0 ? 'S' : 'N'
}

/** Every entrance of `file` that has a label (a street or a plaza), worded for the station as a whole. */
export function entranceTexts(file: StationStreets): EntranceText[] {
  const at = (n: number): [number, number] => [file.x[n]! / DM_PER_M, file.z[n]! / DM_PER_M]
  const lines: NamedLine[] = file.ways
    .filter((w) => isStreet(w, isClosedRing(w.nodes)))
    .map((w) => ({ name: w.name!, key: streetKey(w.name!), points: w.nodes.map(at) }))
  const pairFirst = new Map<string, string>()
  const drafts = file.entrances.map((e, index) => {
    const p: [number, number] = [e.x / DM_PER_M, e.z / DM_PER_M]
    const w: EntranceWording = {}
    const keys: string[] = []
    let near: NamedLine | null = null
    if (e.street !== null) {
      const own = streetKey(e.street)
      keys.push(own)
      if (e.cross !== null) {
        const other = streetKey(e.cross)
        keys.push(other)
        const [ra, rb] = [pairRank(e.street), pairRank(e.cross)]
        const pair = [own, other].sort().join('|')
        if (!pairFirst.has(pair)) pairFirst.set(pair, ra !== rb ? (ra < rb ? own : other) : own)
        w.swap = pairFirst.get(pair) !== own
      } else {
        const hit = nearest(lines, p, (l) => l.key !== own)
        if (hit && hit.d <= NEAR_STREET_M) {
          near = hit.line
          w.near = hit.line.name
          keys.push(hit.line.key)
        }
      }
    }
    return { e, index, p, w, keys, near }
  })
  const texts = drafts.map((d) => entranceLabel(d.e, d.w))
  // Two labels that still read the same tell their entrances apart by the side of the nearby street they are on.
  const count = (t: string | null) => texts.filter((u) => u === t).length
  drafts.forEach((d, i) => {
    if (texts[i] === null || d.near === null || count(texts[i]!) < 2) return
    const near = d.near
    const hit = nearest(lines, d.p, (l) => l.key === near.key)
    if (hit) d.w.of = compass(d.p[0] - hit.qx, d.p[1] - hit.qz)
  })
  const out: EntranceText[] = []
  for (const d of drafts) {
    const parts = entranceParts(d.e, d.w)
    if (!parts) continue
    out.push({
      index: d.index,
      x: d.p[0],
      z: d.p[1],
      head: parts.head,
      tail: parts.tail,
      text: joinParts(parts),
      elevator: d.e.type === 'Elevator',
      unique: true,
      keys: d.keys,
    })
  }
  for (const t of out) t.unique = out.filter((u) => u.text === t.text).length === 1
  return out
}

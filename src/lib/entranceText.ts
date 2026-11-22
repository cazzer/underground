/** One station's entrance labels, worded together: one order per street pair, a nearby street (or two, around a
 *  median entrance) for an entrance with no cross street, a compass side of it when two labels would still read the
 *  same, and one label for a head house's same-corner stairs. Pure; reads the street file
 *  as it is (the join and the files are left alone). */
import type { StationStreets } from '../data/streetSchema'
import { isClosedRing, isStreet, streetKey } from './streetClass'
import { abbreviateStreet, entranceLabel, entranceParts, entranceSpoken, joinParts, type EntranceWording } from './streetName'

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
  /** The label as a screen reader says it (full street names, corners spelled out). */
  spoken: string
  elevator: boolean
  /** No other entrance of the station has this text. */
  unique: boolean
  /** The `streetKey`s of the streets the label names. */
  keys: string[]
  /** Its head house: entrances chained within HEAD_HOUSE_M share one index. */
  headHouse: number
  /** How many entrances this label stands for: itself and the same-text ones within MERGE_M it absorbed. */
  count: number
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

/** The nearest point of each other street (by key, nearest first) within NEAR_STREET_M of p. */
function nearStreets(lines: readonly NamedLine[], p: readonly [number, number], own: string) {
  const byKey = new Map<string, NonNullable<ReturnType<typeof nearest>>>()
  for (const line of lines) {
    if (line.key === own) continue
    const hit = nearest([line], p, () => true)
    const was = byKey.get(line.key)
    if (hit && hit.d <= NEAR_STREET_M && (!was || hit.d < was.d)) byKey.set(line.key, hit)
  }
  return [...byKey.values()].sort((a, b) => a.d - b.d)
}

/** Groups points (meters) chained within `m` of each other; returns a group index per point. */
export function clusters(points: readonly (readonly [number, number])[], m: number): number[] {
  const parent = points.map((_, i) => i)
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)))
  for (let i = 0; i < points.length; i++) {
    for (let j = 0; j < i; j++) {
      if (Math.hypot(points[i]![0] - points[j]![0], points[i]![1] - points[j]![1]) <= m) parent[root(i)] = root(j)
    }
  }
  const ids = new Map<number, number>()
  return points.map((_, i) => {
    const r = root(i)
    if (!ids.has(r)) ids.set(r, ids.size)
    return ids.get(r)!
  })
}

/** Entrances whose labels read the same within this far of each other share one label (one head house's stairs). */
export const MERGE_M = 15
/** Entrances within this far of each other chain into one head house. */
export const HEAD_HOUSE_M = 25

/**
 * Every entrance of `file` that has a label (a street or a plaza), worded for the station as a whole. Same-text
 * entrances within MERGE_M share one label (the first's mark carries it); each label has its head house's index.
 */
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
        const hits = nearStreets(lines, p, own)
        const first = hits[0]
        if (first) {
          near = first.line
          w.near = first.line.name
          keys.push(first.line.key)
          // A median entrance between two cross streets names both.
          const other = hits.find((h) => (h.qx - p[0]) * (first.qx - p[0]) + (h.qz - p[1]) * (first.qz - p[1]) < 0)
          if (e.side === 'median' && other) {
            const names = [first.line.name, other.line.name].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
            w.between = [names[0]!, names[1]!]
            keys.push(other.line.key)
          }
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
    const text = joinParts(parts)
    const twin = out.find((u) => u.text === text && Math.hypot(u.x - d.p[0], u.z - d.p[1]) <= MERGE_M)
    if (twin) {
      twin.count++
      continue
    }
    out.push({
      index: d.index,
      x: d.p[0],
      z: d.p[1],
      head: parts.head,
      tail: parts.tail,
      text,
      spoken: entranceSpoken(d.e, d.w)!,
      elevator: d.e.type === 'Elevator',
      unique: true,
      keys: d.keys,
      headHouse: 0,
      count: 1,
    })
  }
  for (const t of out) t.unique = out.filter((u) => u.text === t.text).length === 1
  const houses = clusters(
    out.map((t) => [t.x, t.z] as const),
    HEAD_HOUSE_M,
  )
  out.forEach((t, i) => (t.headHouse = houses[i]!))
  return out
}

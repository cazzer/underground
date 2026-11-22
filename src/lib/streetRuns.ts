/** The street labels' sources: each named street around a station as one label, with the points it may sit at. Pure. */
import type { StationStreets, StreetWay } from '../data/streetSchema'
import { isClosedRing, isStreet, streetKey } from './streetClass'
import { abbreviateStreet } from './streetName'

/** The file's coordinates are integer decimeters. */
const DM_PER_M = 10
/** Two same-street ways meeting end to end chain into one run only if the street goes on within this turn, so two
 *  carriageways that meet at a fork stay two runs instead of folding into a U. */
const CHAIN_MAX_TURN_DEG = 60
const CHAIN_MIN_COS = Math.cos((CHAIN_MAX_TURN_DEG * Math.PI) / 180)

/** A point a label may be centered on, in meters from the file's anchor, with the street's unit direction there. */
export interface LabelCandidate {
  x: number
  z: number
  tx: number
  tz: number
}

/** One street (every way with one `streetKey`) as one label. */
export interface StreetLabelSource {
  key: string
  /** The street's most common name among its ways, abbreviated (`abbreviateStreet`). */
  text: string
  /** Total length of its ways, meters: longer streets label first. */
  lengthM: number
  /** One list per run of ways chained end to end (a dual carriageway is two runs), candidates in run order. */
  runs: LabelCandidate[][]
}

type Point = readonly [number, number]

function unit(a: Point, b: Point): Point {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len = Math.hypot(dx, dz)
  return len > 0 ? [dx / len, dz / len] : [0, 0]
}

/** Chains a street's ways into runs of node indices: closed ways alone, open ones joined at shared end nodes while
 *  the street goes on straight enough, the straightest continuation first (ties to the lower way id). */
export function chainRuns(ways: readonly StreetWay[], at: (node: number) => Point): number[][] {
  const runs: number[][] = []
  const open = ways.filter((w) => !isClosedRing(w.nodes) && w.nodes.length >= 2)
  for (const w of ways) if (isClosedRing(w.nodes)) runs.push([...w.nodes])
  const used = new Set<StreetWay>()
  // The best unused way going on from `end`, whose run arrives there heading `dir`, oriented to start at `end`.
  const next = (end: number, dir: Point): number[] | null => {
    let best: { nodes: number[]; way: StreetWay; cos: number } | null = null
    for (const v of open) {
      if (used.has(v)) continue
      const first = v.nodes[0]!
      const last = v.nodes[v.nodes.length - 1]!
      if (first !== end && last !== end) continue
      const nodes = first === end ? v.nodes : [...v.nodes].reverse()
      const go = unit(at(nodes[0]!), at(nodes[1]!))
      const cos = dir[0] * go[0] + dir[1] * go[1]
      if (cos >= CHAIN_MIN_COS && (best === null || cos > best.cos)) best = { nodes, way: v, cos }
    }
    if (best) used.add(best.way)
    return best?.nodes ?? null
  }
  for (const w of open) {
    if (used.has(w)) continue
    used.add(w)
    const run = [...w.nodes]
    for (;;) {
      if (run[0] === run[run.length - 1]) break
      const ahead = next(run[run.length - 1]!, unit(at(run[run.length - 2]!), at(run[run.length - 1]!)))
      if (!ahead) break
      run.push(...ahead.slice(1))
    }
    for (;;) {
      if (run[0] === run[run.length - 1]) break
      const behind = next(run[0]!, unit(at(run[1]!), at(run[0]!)))
      if (!behind) break
      run.unshift(...behind.slice(1).reverse())
    }
    runs.push(run)
  }
  return runs
}

/** Points every `spacingM` along the polyline, centered on it (one at the middle when shorter than the spacing). */
export function runCandidates(points: readonly Point[], spacingM: number): LabelCandidate[] {
  const cum = [0]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    cum.push(cum[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
  const length = cum[cum.length - 1]!
  if (!(length > 0)) return []
  const n = Math.max(Math.floor(length / spacingM), 1)
  const start = (length - (n - 1) * spacingM) / 2
  const out: LabelCandidate[] = []
  let seg = 1
  for (let k = 0; k < n; k++) {
    const s = n === 1 ? length / 2 : start + k * spacingM
    while (seg < points.length - 1 && cum[seg]! < s) seg++
    const a = points[seg - 1]!
    const b = points[seg]!
    const span = cum[seg]! - cum[seg - 1]!
    const t = span > 0 ? (s - cum[seg - 1]!) / span : 0
    const [tx, tz] = unit(a, b)
    out.push({ x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, tx, tz })
  }
  return out
}

function polylineLength(points: readonly Point[]): number {
  let length = 0
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1])
  return length
}

/**
 * The file's streets (`isStreet`) grouped by `streetKey`, longest first (ties by key), each with its label text and
 * candidates every `spacingM` along each of its runs. Throws on a node index outside the node table.
 */
export function streetLabelSources(file: StationStreets, spacingM = 40): StreetLabelSource[] {
  const nodes = file.x.length
  const at = (n: number): Point => {
    if (!Number.isInteger(n) || n < 0 || n >= nodes) {
      throw new Error(`Streets of station ${file.stationId}: node index ${n} outside its ${nodes} nodes`)
    }
    return [file.x[n]! / DM_PER_M, file.z[n]! / DM_PER_M]
  }
  const byKey = new Map<string, StreetWay[]>()
  for (const w of file.ways) {
    if (!isStreet(w, isClosedRing(w.nodes))) continue
    const key = streetKey(w.name!)
    byKey.set(key, [...(byKey.get(key) ?? []), w])
  }
  const sources: StreetLabelSource[] = []
  for (const [key, ways] of byKey) {
    const counts = new Map<string, number>()
    for (const w of ways) counts.set(w.name!, (counts.get(w.name!) ?? 0) + 1)
    let name = ways[0]!.name!
    for (const [n, c] of counts) if (c > counts.get(name)!) name = n
    const runs = chainRuns(ways, at)
      .map((run) => runCandidates(run.map(at), spacingM))
      .filter((c) => c.length > 0)
    if (runs.length === 0) continue
    const lengthM = ways.reduce((sum, w) => sum + polylineLength(w.nodes.map(at)), 0)
    sources.push({ key, text: abbreviateStreet(name), lengthM, runs })
  }
  return sources.sort((a, b) => b.lengthM - a.lengthM || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

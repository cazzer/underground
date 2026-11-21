/** Per cross-section island/side calls, and the vote that turns them into one layout per physical platform. */
import { EDGE_INSIDE_M, edgeCrossing } from './crossSection.ts'
import type { Crossing, SectionInterval } from './crossSection.ts'
import { capAt, deduct } from './platformLayout.ts'
import type { Ledger, PlatformLayout } from './platformLayout.ts'
import type { UV } from './platformAxis.ts'

const AGREE_PENALTY_BELOW = 0.8
const AGREE_CAP_BELOW = 0.6
const AGREE_CAP = 0.4
/** A platform left out of the layout puts the whole station below the interior bar. */
const MISSING_PLATFORM_CAP = 0.6
/** Platforms of one physical platform split end to end: v-ranges overlap and u-ranges come this close. */
const SPLIT_JOIN_GAP_M = 5

type EdgeHit = { side: -1 | 1; v: number; ref: string }
export interface SectionRec {
  /** Root of the platform's group; polygons that are one physical platform share it. */
  group: number
  kind: 'island' | 'side' | 'orphan' | 'dropped'
  v0: number
  v1: number
  edges: EdgeHit[]
}

export class Groups {
  private readonly parent: number[]
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
  }
  find(i: number): number {
    while (this.parent[i] !== i) i = this.parent[i] = this.parent[this.parent[i]!]!
    return i
  }
  union(a: number, b: number): void {
    this.parent[this.find(a)] = this.find(b)
  }
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[(xs.length - 1) >> 1]!
const range = (xs: number[]): [number, number] => [Math.min(...xs), Math.max(...xs)]

/** Joins polygons that continue each other end to end (a split island), however the cuts fall. */
export function joinSplitPlatforms(rings: UV[][], groups: Groups): void {
  const boxes = rings.map((r) => ({ u: range(r.map((p) => p[0])), v: range(r.map((p) => p[1])) }))
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!
      const b = boxes[j]!
      const vOverlap = Math.min(a.v[1], b.v[1]) - Math.max(a.v[0], b.v[0])
      const uGap = Math.max(a.u[0], b.u[0]) - Math.min(a.u[1], b.u[1])
      const narrower = Math.min(a.v[1] - a.v[0], b.v[1] - b.v[0])
      if (vOverlap >= 0.5 * narrower && uGap <= SPLIT_JOIN_GAP_M) groups.union(i, j)
    }
  }
}

/** Classifies one merged interval; a track drawn inside the polygon voids it. */
export function classifySection(iv: SectionInterval, allCrossings: Crossing[], group: number, u: number, notes: Set<string>): SectionRec {
  const crossings = allCrossings.filter((c) => !c.service) // a way drawn inside a polygon voids it only if main-line
  const rec = { group, v0: iv.v0, v1: iv.v1 }
  const inside = crossings.find((c) => c.v > iv.v0 + EDGE_INSIDE_M && c.v < iv.v1 - EDGE_INSIDE_M)
  if (inside) {
    notes.add(`track ${inside.ref} drawn inside a platform polygon (u ${u.toFixed(0)} m); that section is ignored for the platform`)
    return { ...rec, kind: 'dropped', edges: [] }
  }
  const right = edgeCrossing(allCrossings, iv, 1)
  const left = edgeCrossing(allCrossings, iv, -1)
  const edges: EdgeHit[] = []
  if (left) edges.push({ side: -1, v: left.v, ref: left.ref })
  if (right) edges.push({ side: 1, v: right.v, ref: right.ref })
  return { ...rec, kind: edges.length === 2 ? 'island' : edges.length === 1 ? 'side' : 'orphan', edges }
}

function mostCommon(xs: string[]): string {
  const counts = new Map<string, number>()
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
}

/** One layout per platform group. A group that yields none costs 0.3 and is named. `spreadM` is the
 *  largest range of any layout's center across the cuts it was read from (0 for a straight platform). */
export function buildLayouts(ways: number[], rings: UV[][], recs: SectionRec[], groups: Groups, ledger: Ledger): { layouts: PlatformLayout[]; spreadM: number; keptGroups: Set<number> } {
  const layouts: PlatformLayout[] = []
  const keptGroups = new Set<number>()
  let spreadM = 0
  for (const g of new Set(ways.map((_, i) => groups.find(i)))) {
    const members = ways.map((_, i) => i).filter((i) => groups.find(i) === g)
    const wayList = members.map((i) => ways[i]!).sort((a, b) => a - b)
    const name = `platform ${wayList.join('+')}`
    const mine = recs.filter((r) => r.group === g)
    const valid = mine.filter((r) => r.kind === 'island' || r.kind === 'side')
    if (valid.length === 0) {
      const why = mine.some((r) => r.kind === 'orphan')
        ? 'has no track beside either edge (orphan)'
        : mine.length === 0 ? 'is not reached by any cross-section' : 'has a track drawn inside it at every cut'
      deduct(ledger, 0.3, `${name} ${why} and is left out of the layout`)
      capAt(ledger, MISSING_PLATFORM_CAP, `${name} is missing from the layout`)
      continue
    }
    const islands = valid.filter((r) => r.kind === 'island').length
    const kind = islands > valid.length - islands ? 'island' : 'side'
    const agreement = Math.max(islands, valid.length - islands) / (valid.length + mine.filter((r) => r.kind === 'orphan').length)
    if (agreement < AGREE_PENALTY_BELOW) deduct(ledger, 0.2, `${name}: only ${(agreement * 100).toFixed(0)}% of cross-sections agree on ${kind}`)
    if (agreement < AGREE_CAP_BELOW) capAt(ledger, AGREE_CAP, `${name}: cross-sections disagree`)
    const agreeing = valid.filter((r) => r.kind === kind)
    let edges = ([-1, 1] as const).flatMap((side) => {
      const hits = agreeing.flatMap((r) => r.edges.filter((e) => e.side === side))
      return hits.length === 0 ? [] : [{ side, offsetV: median(hits.map((h) => h.v)), trackRef: mostCommon(hits.map((h) => h.ref)) }]
    })
    if (kind === 'side' && edges.length === 2) {
      const count = (side: -1 | 1): number => agreeing.filter((r) => r.edges.some((e) => e.side === side)).length
      const keep = count(1) >= count(-1) ? 1 : -1
      deduct(ledger, 0.2, `${name}: cross-sections put its one track on different edges; kept the ${keep > 0 ? 'right' : 'left'} one`)
      edges = edges.filter((e) => e.side === keep)
    }
    keptGroups.add(g)
    const centers = agreeing.map((r) => (r.v0 + r.v1) / 2)
    spreadM = Math.max(spreadM, range(centers)[1] - range(centers)[0])
    layouts.push({
      osmWays: wayList,
      kind,
      centerV: median(centers),
      widthM: median(agreeing.map((r) => r.v1 - r.v0)),
      uRange: range(members.flatMap((i) => rings[i]!.map((p) => p[0]))),
      edges,
    })
  }
  return { layouts, spreadM, keptGroups }
}

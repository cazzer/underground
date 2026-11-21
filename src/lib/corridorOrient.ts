/**
 * One sign per corridor run (a shape's stretch beside other routes) for its band slots, shared by every run beside
 * it heading the same way and opposite to every run beside it heading the other way. Slots are signed right of
 * travel, so this keeps the routes in one order across the street in both directions and all along a run: a
 * per-place sign (say, the leading route's direction) would flip the bundle wherever the lead changes. Signs are
 * per run, not per shape, because lines like the M loop through the network: no single sign per shape fits
 * everywhere, but between runs a shape runs alone at slot 0, where its sign doesn't show. Pure.
 */
import { cellIndex, segmentDistance, type SegmentGrid } from './corridorHash'
import { pointAtDistanceInto, type Polyline } from './realtime/polyline'

/** Runs are probed about this far apart; agreement is weighed by how many probes run side by side. */
const ORIENT_STEP_M = 500

export interface OrientInput {
  line: Polyline
  /** The GTFS direction, used only to pick each group's overall sign (so a N run is usually +1). */
  southbound: boolean
  /** Per corridor sample (every `sampleM`): the run id there (0 .. runCount - 1), or -1 where the shape runs alone. */
  runOf: Int32Array
  /** Per sample, the earlier shape on the same track it was copied from (-1 if searched), and that shape's sample. */
  source: Int32Array
  sourceAt: Int32Array
}

export interface Orientation {
  /** +1 or -1 per run id. */
  sign: Int8Array
  /** Per run id, its connected group of runs (a root run id): runs side by side are always in one. */
  group: Int32Array
  /** Side-by-side samples whose relation contradicted a heavier one; 0 is ideal. */
  conflicts: number
}

/** Union-find by size, with each node's parity relative to its parent (0 same sign, 1 opposite). */
function makeSets(n: number) {
  const parent = Int32Array.from({ length: n }, (_, i) => i)
  const parity = new Uint8Array(n)
  const size = new Int32Array(n).fill(1)
  /** [root, parity to the root]; the depth stays logarithmic, so no compression. */
  const find = (i: number): [number, number] => {
    let p = 0
    let node = i
    while (parent[node] !== node) {
      p ^= parity[node]!
      node = parent[node]!
    }
    return [node, p]
  }
  /** Joins a and b so their parities differ by `want`; false when they already disagree. */
  const join = (a: number, b: number, want: number): boolean => {
    const [ra, pa] = find(a)
    const [rb, pb] = find(b)
    if (ra === rb) return (pa ^ pb) === want
    const [big, small] = size[ra]! >= size[rb]! ? [ra, rb] : [rb, ra]
    parent[small] = big
    parity[small] = pa ^ pb ^ want
    size[big]! += size[small]!
    return true
  }
  return { find, join }
}

/**
 * Pairs of runs within `reachM` of each other heading the same way (within the cosMax angle) want the same sign;
 * heading opposite ways (the other direction's track), opposite signs. The heaviest relations win where they
 * disagree. Each connected group then takes the sign that makes its longest run's sign match its direction.
 */
export function orientRuns(
  grid: SegmentGrid,
  shapes: readonly OrientInput[],
  runCount: number,
  sampleM: number,
  reachM: number,
  cosMax: number,
): Orientation {
  const runAt = (shape: OrientInput, d: number) => shape.runOf[Math.min(Math.round(d / sampleM), shape.runOf.length - 1)]!
  // Weights from the current own run to each other run, flushed into `edges` when the own run changes.
  const acc = new Float64Array(runCount)
  const touched: number[] = []
  const edges: [number, number, number][] = []
  let accRun = -1
  const flush = () => {
    for (const other of touched) {
      if (acc[other] !== 0) edges.push([accRun, other, acc[other]!])
      acc[other] = 0
    }
    touched.length = 0
  }
  const runLength = new Float64Array(runCount)
  const runSouth = new Uint8Array(runCount)
  const lastSample = new Int32Array(shapes.length).fill(-1)
  const point = { x: 0, z: 0 }
  const stride = Math.max(1, Math.round(ORIENT_STEP_M / sampleM))
  let sampleId = 0
  const probe = (li: number, d: number) => {
    sampleId++
    const shape = shapes[li]!
    const heading = pointAtDistanceInto(shape.line, d, point)
    const hx = Math.sin(heading)
    const hz = -Math.cos(heading)
    const c = cellIndex(grid, point.x, point.z)
    if (c < 0) return
    for (let j = grid.start[c]!, end = grid.start[c + 1]!; j < end; ) {
      const s = grid.items[j]!
      const other = grid.owner[s]!
      if (other === li || lastSample[other] === sampleId) {
        j = grid.lineEnd[j]!
        continue
      }
      const dot = grid.ux[s]! * hx + grid.uz[s]! * hz
      if (Math.abs(dot) < cosMax || segmentDistance(grid, s, point.x, point.z) > reachM) {
        j++
        continue
      }
      j = grid.lineEnd[j]!
      const px = point.x - grid.ax[s]!
      const pz = point.z - grid.az[s]!
      const along = Math.min(Math.max(px * grid.ux[s]! + pz * grid.uz[s]!, 0), grid.len[s]!)
      const otherRun = runAt(shapes[other]!, grid.startD[s]! + along)
      if (otherRun < 0) continue
      lastSample[other] = sampleId
      if (acc[otherRun] === 0) touched.push(otherRun)
      acc[otherRun]! += dot > 0 ? 1 : -1
    }
  }
  // Each run is probed every `stride` samples, and always at its two ends and middle, so short runs count too.
  shapes.forEach((shape, li) => {
    const runs = shape.runOf
    for (let i0 = 0; i0 < runs.length; i0++) {
      const run = runs[i0]!
      if (run < 0 || (i0 > 0 && runs[i0 - 1] === run)) continue
      let i1 = i0
      while (i1 + 1 < runs.length && runs[i1 + 1] === run) i1++
      flush()
      accRun = run
      runLength[run] = (i1 - i0 + 1) * sampleM
      runSouth[run] = shape.southbound ? 1 : 0
      // A sample copied from an earlier shape on the same track ties the two runs directly; only searched
      // samples are probed.
      for (let i = i0; i <= i1; i++) {
        const src = shape.source[i]!
        if (src < 0) continue
        const other = shapes[src]!.runOf[shape.sourceAt[i]!]!
        if (other < 0) continue
        if (acc[other] === 0) touched.push(other)
        acc[other]! += 1
      }
      const at = (i: number) => {
        if (shape.source[i]! < 0) probe(li, Math.min(i * sampleM, shape.line.length))
      }
      for (let i = i0; i < i1; i += stride) at(i)
      at(i1)
      at((i0 + i1) >> 1)
    }
  })
  flush()
  edges.sort((a, b) => Math.abs(b[2]) - Math.abs(a[2]) || a[0] - b[0] || a[1] - b[1])
  const sets = makeSets(runCount)
  let conflicts = 0
  for (const [a, b, w] of edges) {
    if (!sets.join(a, b, w > 0 ? 0 : 1)) conflicts += Math.abs(w)
  }

  // Each group's sign: its longest run keeps its own direction's sign.
  const longest = new Map<number, number>()
  for (let r = 0; r < runCount; r++) {
    const [root] = sets.find(r)
    const best = longest.get(root)
    if (best === undefined || runLength[r]! > runLength[best]!) longest.set(root, r)
  }
  const sign = new Int8Array(runCount)
  const group = new Int32Array(runCount)
  for (let r = 0; r < runCount; r++) {
    const [root, parity] = sets.find(r)
    group[r] = root
    const lead = longest.get(root)!
    const leadSign = runSouth[lead] ? -1 : 1
    sign[r] = parity === sets.find(lead)[1] ? leadSign : -leadSign
  }
  return { sign, group, conflicts }
}

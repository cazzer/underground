import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeStationWalk } from '../data/loadStationWalk'
import type { StationWalk, WalkGraph } from '../data/walkSchema'
import { gridGraph, walkGraph } from './walkFixture'
import { routeWalk, snapToWalk, walkQuery, WALK_SPEED_MPS, type WalkOptions, type WalkQuery, type WalkSnap } from './walkRoute'

const S = 1 / WALK_SPEED_MPS

function snapAt(q: WalkQuery, x: number, z: number): WalkSnap {
  const snap = snapToWalk(q, { x, z })
  if (!snap) throw new Error(`no snap at ${x}, ${z}`)
  return snap
}

function route(graph: WalkGraph, from: [number, number], to: [number, number], opts?: WalkOptions) {
  const q = walkQuery(graph, opts)
  return routeWalk(q, [{ snap: snapAt(q, ...from), startS: 0 }], snapAt(q, ...to))
}

describe('routeWalk', () => {
  it('finds the shortest path across a grid', () => {
    const path = route(gridGraph(3, 10), [0, 0], [20, 20])!
    expect(path.meters).toBeCloseTo(40, 9)
    expect(path.seconds).toBeCloseTo(40 * S, 9)
    expect(path.points[0]).toEqual({ x: 0, z: 0 })
    expect(path.points[path.points.length - 1]).toEqual({ x: 20, z: 20 })
  })

  it.each([
    ['a 120 m sidewalk beats a 100 m road (x1.3)', 33.2, 'sidewalk'],
    ['a 100 m road beats a 140 m sidewalk', 49, 'road'],
  ])('prices roads up: %s', (_, h, winner) => {
    const graph = walkGraph(
      [[0, 0], [100, 0], [50, h]],
      [{ kind: 'road', nodes: [0, 1] }, { kind: 'sidewalk', nodes: [0, 2, 1] }],
    )
    const path = route(graph, [0, 0], [100, 0])!
    expect(path.points.length).toBe(winner === 'road' ? 2 : 3)
    expect(path.seconds).toBeCloseTo(winner === 'road' ? 100 : (2 * Math.hypot(50, h) * S), 1)
  })

  const steps = walkGraph(
    [[0, 0], [10, 0], [5, 29.6]],
    [{ kind: 'steps', nodes: [0, 1] }, { kind: 'sidewalk', nodes: [0, 2, 1] }],
  )

  it('takes steps by default and the detour when step-free', () => {
    const direct = route(steps, [0, 0], [10, 0])!
    expect(direct.meters).toBeCloseTo(10, 9)
    expect(direct.points.length).toBe(2)
    const free = route(steps, [0, 0], [10, 0], { stepFree: true })!
    expect(free.meters).toBeGreaterThan(59)
    expect(free.points.length).toBe(3)
  })

  it('snaps away from the steps when step-free', () => {
    const near = snapAt(walkQuery(steps), 5, 1)
    expect(near.edge).toBe(0)
    expect(near.offsetM).toBeCloseTo(1, 9)
    const free = snapAt(walkQuery(steps, { stepFree: true }), 5, 1)
    expect(free.edge).toBe(1)
    expect(free.offsetM).toBeGreaterThan(1)
  })

  it('walks through a zero-length edge', () => {
    const graph = walkGraph(
      [[0, 0], [10, 0], [10, 0], [10, 10]],
      [{ nodes: [0, 1] }, { nodes: [1, 2] }, { nodes: [2, 3] }],
    )
    const path = route(graph, [0, 0], [10, 10])!
    expect(path.meters).toBeCloseTo(20, 9)
    expect(path.seconds).toBeCloseTo(20 * S, 9)
    expect(path.points).toEqual([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }])
  })

  describe('a ring on one node', () => {
    const ring = walkGraph(
      [[0, 0], [10, 0], [10, 10], [0, 10], [-20, 0]],
      [{ nodes: [4, 0] }, { nodes: [0, 1, 2, 3, 0] }],
    )
    it('goes the short way round to a point on the far side', () => {
      const path = route(ring, [-20, 0], [10, 6])!
      expect(path.meters).toBeCloseTo(36, 9)
      expect(path.seconds).toBeCloseTo(36 * S, 9)
      expect(path.points).toEqual([{ x: -20, z: 0 }, { x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 6 }])
    })
    it('goes the other way when that is shorter', () => {
      const path = route(ring, [-20, 0], [0, 6])!
      expect(path.meters).toBeCloseTo(26, 9)
      expect(path.points).toEqual([{ x: -20, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 6 }])
    })
  })

  it('goes straight along an edge when source and target share it', () => {
    const graph = walkGraph([[0, 0], [100, 0], [50, 50]], [{ nodes: [0, 1] }, { nodes: [0, 2] }, { nodes: [2, 1] }])
    const fwd = route(graph, [20, 0], [70, 0])!
    expect(fwd.seconds).toBeCloseTo(50 * S, 9)
    expect(fwd.points).toEqual([{ x: 20, z: 0 }, { x: 70, z: 0 }])
    const back = route(graph, [70, 0], [20, 0])!
    expect(back.meters).toBeCloseTo(50, 9)
    expect(back.points).toEqual([{ x: 70, z: 0 }, { x: 20, z: 0 }])
  })

  it('picks the source with the least start plus walk, and adds its head start', () => {
    const graph = gridGraph(3, 10)
    const q = walkQuery(graph)
    const target = snapAt(q, 20, 20)
    const at = (x: number, z: number, startS: number) => ({ snap: snapAt(q, x, z), startS })
    // Source 0 is 40 m away, source 1 is 20 m away.
    const near = routeWalk(q, [at(0, 0, 0), at(20, 0, 25)], target)!
    expect(near.source).toBe(0)
    expect(near.seconds).toBeCloseTo(40 * S, 9)
    const far = routeWalk(q, [at(0, 0, 20), at(20, 0, 25)], target)!
    expect(far.source).toBe(1)
    expect(far.seconds).toBeCloseTo(25 + 20 * S, 9)
    expect(far.points[0]).toEqual({ x: 20, z: 0 })
    expect(routeWalk(q, [], target)).toBeNull()
  })

  it('never snaps to a nearer, disconnected component', () => {
    const graph = walkGraph([[100, 0], [110, 0], [0, 0], [2, 0]], [{ nodes: [0, 1] }, { nodes: [2, 3] }])
    const snap = snapAt(walkQuery(graph), 1, 1)
    expect(snap.edge).toBe(0)
    expect(snap.point).toEqual({ x: 100, z: 0 })
  })

  it('returns null when the target is unreachable from every source', () => {
    // Two components of three nodes and two: step-free leaves the bigger one, but sources may be forced elsewhere.
    const graph = walkGraph([[0, 0], [10, 0], [20, 0], [100, 0], [110, 0]], [{ nodes: [0, 1] }, { nodes: [1, 2] }, { nodes: [3, 4] }])
    const q = walkQuery(graph)
    const target = snapAt(q, 20, 0)
    const stray = { edge: 2, share: 0.5, point: { x: 105, z: 0 }, offsetM: 0 }
    expect(routeWalk(q, [{ snap: stray, startS: 0 }], target)).toBeNull()
  })
})

describe('routeWalk on the real L08 shard', () => {
  const graph: WalkGraph = decodeStationWalk(JSON.parse(readFileSync('public/data/walk/L08.json', 'utf8')) as StationWalk)

  /** A plain O(N^2) Dijkstra over the same edge costs, with no heuristic and no shared code with routeWalk. */
  function reference(q: WalkQuery, src: WalkSnap, dst: WalkSnap): number {
    const n = graph.x.length
    const d = new Float64Array(n).fill(Infinity)
    const done = new Uint8Array(n)
    const ends = (e: number) => [graph.edgeNodes[e]![0]!, graph.edgeNodes[e]![graph.edgeNodes[e]!.length - 1]!] as const
    const [sa, sb] = ends(src.edge)
    d[sa] = Math.min(d[sa]!, src.share * q.edgeS[src.edge]!)
    d[sb] = Math.min(d[sb]!, (1 - src.share) * q.edgeS[src.edge]!)
    for (;;) {
      let u = -1
      for (let i = 0; i < n; i++) if (!done[i] && d[i]! < Infinity && (u < 0 || d[i]! < d[u]!)) u = i
      if (u < 0) break
      done[u] = 1
      for (let e = 0; e < q.edgeS.length; e++) {
        if (q.edgeS[e] === Infinity) continue
        const [a, b] = ends(e)
        if (a === u) d[b] = Math.min(d[b]!, d[u]! + q.edgeS[e]!)
        if (b === u) d[a] = Math.min(d[a]!, d[u]! + q.edgeS[e]!)
      }
    }
    const [ta, tb] = ends(dst.edge)
    let best = Math.min(d[ta]! + dst.share * q.edgeS[dst.edge]!, d[tb]! + (1 - dst.share) * q.edgeS[dst.edge]!)
    if (src.edge === dst.edge) best = Math.min(best, Math.abs(src.share - dst.share) * q.edgeS[src.edge]!)
    return best
  }

  it.each([false, true])('matches a reference Dijkstra on 30 seeded random snap pairs (stepFree %s)', (stepFree) => {
    const q = walkQuery(graph, { stepFree })
    let seed = 12345
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return (seed / 2 ** 32 - 0.5) * 300
    }
    for (let i = 0; i < 30; i++) {
      const a = snapAt(q, rand(), rand())
      const b = snapAt(q, rand(), rand())
      const path = routeWalk(q, [{ snap: a, startS: 0 }], b)!
      expect(path.seconds).toBeCloseTo(reference(q, a, b), 9)
      expect(path.points[0]).toEqual(a.point)
      expect(path.points[path.points.length - 1]).toEqual(b.point)
    }
  }, 60_000)
})

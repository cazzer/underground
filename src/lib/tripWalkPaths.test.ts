import { describe, expect, it } from 'vitest'
import type { WalkGraph } from '../data/walkSchema'
import type { Ground } from './projection'
import { MAX_SNAP_M, transferWalkPath, walkPathIn, withWalkPaths } from './tripWalkPaths'
import type { WalkSpan } from './tripSpans'
import { walkGraph } from './walkFixture'

/** An L: east along z = 0 to (100, 0), then south to (100, 100). */
const ell = walkGraph([[0, 0], [100, 0], [100, 100]], [{ nodes: [0, 1] }, { nodes: [1, 2] }])
const at = (g: WalkGraph, x: number, z: number): Ground => ({ x: g.anchor.x + x, z: g.anchor.z + z })
function expectPath(actual: readonly Ground[], expected: readonly Ground[]): void {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((p, i) => {
    expect(p.x).toBeCloseTo(expected[i]!.x, 6)
    expect(p.z).toBeCloseTo(expected[i]!.z, 6)
  })
}
const graphs = (...entries: [string, WalkGraph][]): ReadonlyMap<string, WalkGraph> => new Map(entries)

describe('transferWalkPath', () => {
  const a = at(ell, 0, 0)
  const b = at(ell, 100, 100)

  it('follows the corner of the street, from station point to station point', () => {
    const r = transferWalkPath(a, b, 'A', 'B', graphs(['A', ell]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expectPath(r.path, [a, at(ell, 100, 0), b])
    expect(r.meters).toBeCloseTo(200, 6)
  })

  it('walks the same path back, reversed', () => {
    const there = transferWalkPath(a, b, 'A', 'B', graphs(['A', ell]))
    const back = transferWalkPath(b, a, 'B', 'A', graphs(['A', ell]))
    if (!there.ok || !back.ok) throw new Error('no path')
    expect(back.path).toEqual([...there.path].reverse())
  })

  it('routes in the other station\'s graph when only it is loaded', () => {
    const r = transferWalkPath(a, b, 'A', 'B', graphs(['B', ell]))
    expect(r.ok).toBe(true)
  })

  it('keeps a stub from a station point off the street, and drops one under a meter', () => {
    const off = at(ell, 40, 8)
    const stubbed = transferWalkPath(a, off, 'A', 'B', graphs(['A', ell]))
    if (!stubbed.ok) throw new Error('no path')
    expectPath(stubbed.path, [a, at(ell, 40, 0), off])
    const near = at(ell, 40, 0.5)
    const trimmed = transferWalkPath(a, near, 'A', 'B', graphs(['A', ell]))
    if (!trimmed.ok) throw new Error('no path')
    expectPath(trimmed.path, [a, near])
  })

  it('fails with a reason with no graph loaded, a station off the graph, or a detour past 2.5x', () => {
    expect(transferWalkPath(a, b, 'A', 'B', graphs())).toMatchObject({ ok: false, reason: 'no walk graph loaded' })
    const far = at(ell, 100, 100 + MAX_SNAP_M + 20)
    expect(transferWalkPath(a, far, 'A', 'B', graphs(['A', ell]))).toMatchObject({ ok: false })
    // Round the block: the stations stand 100 m apart but the street joining them is 700 m.
    const block = walkGraph([[0, 0], [0, 300], [100, 300], [100, 0]], [{ nodes: [0, 1] }, { nodes: [1, 2] }, { nodes: [2, 3] }])
    const r = transferWalkPath(at(block, 0, 0), at(block, 100, 0), 'A', 'B', graphs(['A', block]))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/700 m against 100 m/)
  })
})

describe('walkPathIn', () => {
  it('follows the street from a station point to a place on it', () => {
    const r = walkPathIn(ell, at(ell, 0, 0), at(ell, 100, 60))
    if (!r.ok) throw new Error(r.reason)
    expectPath(r.path, [at(ell, 0, 0), at(ell, 100, 0), at(ell, 100, 60)])
    expect(r.meters).toBeCloseTo(160, 6)
  })

  it('fails for a place past the graph radius, even one the graph could reach', () => {
    const long = walkGraph([[0, 0], [500, 0]], [{ nodes: [0, 1] }], 300)
    expect(walkPathIn(long, at(long, 0, 0), at(long, 450, 0))).toMatchObject({ ok: false, reason: 'the place is past the walk graph' })
  })

  it('fails for a place off the graph, and for a detour past 2.5x', () => {
    expect(walkPathIn(ell, at(ell, 0, 0), at(ell, 100, 100 + MAX_SNAP_M + 20))).toMatchObject({ ok: false })
    const block = walkGraph([[0, 0], [0, 200], [100, 200], [100, 0]], [{ nodes: [0, 1] }, { nodes: [1, 2] }, { nodes: [2, 3] }])
    const r = walkPathIn(block, at(block, 0, 0), at(block, 100, 0))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/500 m against 100 m/)
  })
})

describe('withWalkPaths', () => {
  const walk = (fromStationId: string, toStationId: string, from: Ground, to: Ground): WalkSpan => ({
    kind: 'walk',
    legIndex: 1,
    fromStationId,
    toStationId,
    sameComplex: false,
    from,
    to,
  })

  it('sets the path where one is found and reports the walks left straight', () => {
    const found = walk('A', 'B', at(ell, 0, 0), at(ell, 100, 100))
    const lost = walk('C', 'D', at(ell, 0, 0), at(ell, 100, 100))
    const heard: string[] = []
    const [first, second] = withWalkPaths([found, lost], graphs(['A', ell]), (w, reason) => heard.push(`${w.fromStationId}:${reason}`))
    expect(first!.path).toHaveLength(3)
    expect(second!.path).toBeUndefined()
    expect(heard).toEqual(['C:no walk graph loaded'])
  })
})

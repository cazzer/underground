import { describe, expect, it } from 'vitest'
import { buildStation } from './archetypeFixtures.ts'
import { MERGE_GAP_M, mergeIntervals, polygonIntervals, trackCrossings } from './crossSection.ts'
import { analyzePlatforms } from './platformSides.ts'
import type { StationFacts } from './stationFacts.ts'

const run = (f: StationFacts) => analyzePlatforms(f.platforms, f.tracks)

/** Keeps the part of a straight two-point track between two fractions of its length. */
function clipTrack(f: StationFacts, index: number, from: number, to: number): void {
  const t = f.tracks[index]!
  const [[x0, z0], [x1, z1]] = [t.path[0]!, t.path[1]!]
  const at = (k: number): [number, number] => [x0 + (x1 - x0) * k, z0 + (z1 - z0) * k]
  t.path = [at(from), at(to)]
}

describe('cross-section pieces', () => {
  it('finds polygon intervals (even-odd) along a line of constant u', () => {
    const ring: [number, number][] = [[0, -3], [10, -3], [10, 3], [0, 3]]
    expect(polygonIntervals(ring, 5)).toEqual([[-3, 3]])
    expect(polygonIntervals(ring, 20)).toEqual([])
    const u: [number, number][] = [[0, 0], [10, 0], [10, 6], [6, 6], [6, 2], [4, 2], [4, 6], [0, 6]]
    expect(polygonIntervals(u, 5)).toEqual([[0, 2]])
    expect(polygonIntervals(u, 8)).toEqual([[0, 6]])
  })

  it('counts a crossing once, drops steep segments and tracks beyond 40 m', () => {
    const tracks = [
      { ref: 'A', pts: [[-50, 4.7], [50, 4.7]] as [number, number][] },
      { ref: 'A2', pts: [[-50, 5.5], [50, 5.5]] as [number, number][] },
      { ref: 'RAMP', pts: [[-3, -12], [3, 12]] as [number, number][] },
      { ref: 'FAR', pts: [[-50, 55], [50, 55]] as [number, number][] },
    ]
    expect(trackCrossings(tracks, 0).map((c) => c.ref)).toEqual(['A'])
  })

  it('merges across a gap under 4 m only when no track is between', () => {
    const raw = [{ v0: -3, v1: -0.2, platforms: [0] }, { v0: 0.2, v1: 3, platforms: [1] }]
    expect(mergeIntervals(raw, []).intervals).toHaveLength(1)
    expect(mergeIntervals(raw, [{ v: 0, ref: 'T', service: false }]).intervals).toHaveLength(2)
    const far = [{ v0: -3, v1: -0.5, platforms: [0] }, { v0: MERGE_GAP_M, v1: 8, platforms: [1] }]
    expect(mergeIntervals(far, []).gapWithoutTrack).toBe(true)
  })
})

describe('analyzePlatforms', () => {
  it('reads an island between two tracks, with centered v and the track beside each edge', () => {
    const a = run(buildStation('A', 'subway', 55, [[-3, 3]], [-4.7, 4.7]))
    expect(a.platformType).toBe('island')
    expect(a.trackCount).toBe(2)
    expect(a.penalty).toBe(0)
    expect(a.layouts[0]).toMatchObject({ kind: 'island', widthM: expect.closeTo(6, 1), centerV: expect.closeTo(0, 1) })
    expect(a.layouts[0]!.edges).toEqual([
      { side: -1, offsetV: expect.closeTo(-4.7, 1), trackRef: 'T1' },
      { side: 1, offsetV: expect.closeTo(4.7, 1), trackRef: 'T2' },
    ])
    expect(a.trackOffsetsV[0]).toBeCloseTo(-4.7, 1)
    expect(a.trackOffsetsV[1]).toBeCloseTo(4.7, 1)
    expect(a.bearingDeg).toBeCloseTo(55, 1)
  })

  it('reads two side platforms and counts the express tracks between them', () => {
    const a = run(buildStation('B', 'subway', 55, [[-14, -9], [9, 14]], [-6.6, -2.9, 2.9, 6.6]))
    expect(a.platformType).toBe('side')
    expect(a.trackCount).toBe(4)
    expect(a.layouts.map((l) => l.edges.map((e) => e.side))).toEqual([[1], [-1]])
    expect(a.penalty).toBe(0)
  })

  it('does not count a track drawn beyond the platforms', () => {
    const a = run(buildStation('C', 'subway', 55, [[-3, 3]], [-4.7, 4.7, 30]))
    expect(a.trackCount).toBe(2)
  })

  it('takes the majority when a track runs beside only part of a side platform, and 60% does not cap', () => {
    const f = buildStation('D', 'subway', 55, [[-7.5, -3.5], [3.5, 7.5]], [-9.5, -1.85, 1.85])
    clipTrack(f, 0, 0, 0.45) // an outer track beside the left platform ends before mid-station: 2 cuts see an island, 3 a side
    const a = run(f)
    expect(a.layouts.map((l) => l.kind)).toEqual(['side', 'side'])
    expect(a.reasons.join('\n')).toMatch(/60% of cross-sections agree on side: -0.2/)
    expect(a.cap).toBe(1)
  })

  it('caps the confidence when the cross-sections split below 60%', () => {
    const f = buildStation('E', 'subway', 55, [[-3, 3]], [-4.7, 4.7])
    clipTrack(f, 0, 0, 0.3) // each track covers one end only, so the middle three cuts find an orphan
    clipTrack(f, 1, 0.7, 1)
    const a = run(f)
    expect(a.cap).toBe(0.4)
    expect(a.reasons.join('\n')).toMatch(/disagree; confidence capped at 0.4/)
  })

  it('marks a platform with no track beside it as an orphan', () => {
    const a = run(buildStation('F', 'subway', 55, [[-3, 3], [30, 34]], [-4.7, 4.7]))
    expect(a.layouts).toHaveLength(1)
    expect(a.penalty).toBeGreaterThanOrEqual(0.3)
    expect(a.reasons.join('\n')).toMatch(/orphan/)
  })

  it('penalizes a platform axis well off the station axis', () => {
    const f = buildStation('G', 'subway', 55, [[-3, 3], [8, 12]], [-4.7, 4.7])
    const cross = buildStation('G2', 'subway', 145, [[-3, 3]], []).platforms[0]!
    f.platforms.push({ ...cross, osmWay: 77, outline: cross.outline.map(([x, z]) => [x * 0.1 + 40, z * 0.1 + 40]) })
    expect(run(f).reasons.join('\n')).toMatch(/off the station axis/)
  })

  it('has no tracks to speak of with only platforms: geometry-only, estimated edges', () => {
    const a = run(buildStation('H', 'subway', 55, [[-3.3, 3.3]], []))
    expect(a.geometryOnly).toBe(true)
    expect(a.cap).toBe(0.5)
    expect(a.layouts[0]!.edges.every((e) => e.trackRef === 'estimated')).toBe(true)
  })

  it('keeps one edge for a side platform whose sections put the track on different edges, and says so', () => {
    const f = buildStation('I', 'subway', 55, [[-3, 3]], [-4.7, 4.7])
    clipTrack(f, 0, 0, 0.5) // left track: first half only
    clipTrack(f, 1, 0.5, 1) // right track: second half only
    const a = run(f)
    expect(a.layouts[0]!.kind).toBe('side')
    expect(a.layouts[0]!.edges).toHaveLength(1)
    expect(a.layouts[0]!.edges[0]!.side).toBe(1)
    expect(a.reasons.join('\n')).toMatch(/put its one track on different edges; kept the right one: -0.2/)
  })

  it('leaves a lone side platform with one track alone (Park Pl, Aqueduct)', () => {
    const a = run(buildStation('K1', 'subway', 55, [[-7.5, -3.5]], [-1.85]))
    expect(a.cap).toBe(1)
    expect(a.reasons.join('\n')).not.toMatch(/lone side/)
  })

  it('penalizes a lone side platform whose partner may be missing', () => {
    const a = run(buildStation('K', 'subway', 55, [[-9, -5]], [-3.2, -0.5, 3, 6.5]))
    expect(a.layouts).toHaveLength(1)
    expect(a.cap).toBe(0.6)
    expect(a.reasons.join('\n')).toMatch(/lone side platform.*may be missing from the data: -0.3/)
  })

  it('does not read two wide polygons without tracks as side platforms', () => {
    const a = run(buildStation('J', 'subway', 55, [[-12, -7], [7, 12]], []))
    expect(a.platformType).toBeNull()
    expect(a.reasons.join('\n')).toMatch(/neither an island .* nor two narrow side platforms/)
  })

  it('counts a siding, spur or yard way between the outermost platform edges (an unused center track)', () => {
    const a = run(buildStation('S1', 'subway', 55, [[-14, -9], [9, 14]], [-6.6, 6.6], { serviceTracks: [0] }))
    expect(a.trackCount).toBe(3)
    expect(a.trackOffsetsV[1]).toBeCloseTo(0, 1)
  })

  it('does not count a service way in the margin when a main-line way is beside that edge', () => {
    const island = run(buildStation('S2', 'subway', 55, [[-3, 3]], [-4.7, 4.7], { serviceTracks: [7.5] }))
    expect(island.trackCount).toBe(2)
    const side = run(buildStation('S3', 'subway', 55, [[-7.5, -3.5], [3.5, 7.5]], [-1.85, 1.85, -9.5], { serviceTracks: [-11.5] }))
    expect(side.trackCount).toBe(3)
    expect(side.layouts.map((l) => l.kind)).toEqual(['island', 'side'])
  })

  it('prefers the main-line way when it coincides with a service way', () => {
    const a = run(buildStation('S4', 'subway', 55, [[-3, 3]], [-4.7, 4.7], { serviceTracks: [-4.7] }))
    expect(a.trackCount).toBe(2)
    expect(a.layouts[0]!.kind).toBe('island')
  })

  it('ignores layup ways between the platforms when counting them would give more than 4 tracks', () => {
    const a = run(buildStation('S5', 'subway', 55, [[-15, -11.6], [11.6, 15]], [-10, -2, 2, 10], { serviceTracks: [-6, 6] }))
    expect(a.trackCount).toBe(4)
    expect(a.reasons.join('\n')).toMatch(/2 siding, spur or yard ways between the platforms ignored: counting them gives 6 tracks/)
  })

  it('uses a siding, spur or yard way as a platform edge track when no main-line way is beside that edge', () => {
    const both = run(buildStation('Y1', 'subway', 55, [[-5.3, 5.3]], [], { serviceTracks: [-6.8, 6.8] }))
    expect(both.layouts[0]!.kind).toBe('island')
    expect(both.trackCount).toBe(2)
    expect(both.geometryOnly).toBe(false)
    const one = run(buildStation('Y2', 'subway', 55, [[-3, 3]], [-4.7], { serviceTracks: [4.7] }))
    expect(one.layouts[0]!.kind).toBe('island')
    expect(one.trackCount).toBe(2)
  })

  it('prefers a main-line way beside an edge over a service way nearer to it', () => {
    const a = run(buildStation('Y3', 'subway', 55, [[-3, 3]], [-4.7, 6.5], { serviceTracks: [3.5] }))
    expect(a.layouts[0]!.edges.find((e) => e.side === 1)!.offsetV).toBeCloseTo(6.5, 0)
  })
})

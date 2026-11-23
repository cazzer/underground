import { describe, expect, it } from 'vitest'
import { MAX_OUTLINE_SAMPLES } from '../lib/interiorOutline'
import { BLOCKER_SLOTS, MAX_LEVEL_BLOCKERS } from '../lib/labelBlockers'
import { GROUP, isExempt, setExempt } from '../lib/labelDeclutter'
import { BOX, RECT } from '../lib/labelGeometry'
import { crowdedStation, fixtureStation, run } from './labelFixture'
import { carryPlacement, createLabelPlacement, groupCapacity } from './labelPlacementLayout'
import { ENTRANCE_SLOTS, FIXED_RECTS, MAX_LABEL_INTERIORS, STREET_SLOTS } from './labelPlacementState'

const A = crowdedStation('A')
const B = fixtureStation('B', { x: 200, z: 0 }, {
  entrances: [{ x: 0, z: 0, w: 50 }],
  streets: [
    { key: 'grand st', w: 50, runs: [run(0, 0, 1, 0, 2)] },
    { key: 'broadway', w: 64, runs: [run(0, 10, 1, 0, 3)] },
  ],
})
const stationsOf = (...list: (typeof A)[]) => list.map((s) => ({ layer: s.layer, bundles: s.bundles }))

describe('createLabelPlacement', () => {
  const p = createLabelPlacement(stationsOf(A, B), [{ x: 0, z: 0 }, { x: 5, z: 5 }])

  it('lays the stations out one after another: entrances, then streets', () => {
    expect(Array.from(p.segItem0)).toEqual([0, 13])
    expect(Array.from(p.segStreet0)).toEqual([8, 14])
    expect(Array.from(p.segEnd)).toEqual([13, 16])
    expect(Array.from(p.local.subarray(13, 16))).toEqual([0, 0, 1])
    expect(Array.from(p.stationOf.subarray(12, 15))).toEqual([0, 1, 1])
    expect(p.cand.count).toBe(16)
  })

  it('gives a street key both stations hold one id, and entrances none', () => {
    const broadwayA = A.streets.findIndex((s) => s.key === 'broadway')
    expect(p.keyId[8 + broadwayA]).toBe(p.keyId[15])
    expect(p.keyId[14]).not.toBe(p.keyId[15])
    expect(p.keyId[0]).toBe(-1)
    expect(p.keyPlaced.length).toBe(6)
  })

  it('sizes boxes and rects for the sum of the stations', () => {
    const candidates = (s: typeof A) => s.streets.reduce((n, st) => n + st.runs.reduce((m, r) => m + r.length, 0), 0)
    const boxes = (A.entrances.length + B.entrances.length) * ENTRANCE_SLOTS + (candidates(A) + candidates(B)) * STREET_SLOTS
    expect(p.cand.boxes.length).toBe(boxes * BOX)
    expect(Array.from(p.segMark0)).toEqual([FIXED_RECTS, FIXED_RECTS + A.marks.length])
    expect(p.markerRect).toBe(FIXED_RECTS + A.marks.length + B.marks.length)
    expect(p.levelRect).toBe(p.markerRect + 3)
    const rects = p.levelRect + BLOCKER_SLOTS * MAX_LEVEL_BLOCKERS + MAX_LABEL_INTERIORS * MAX_OUTLINE_SAMPLES
    expect(p.bounds.rects.length).toBe(rects * RECT)
    expect(p.bounds.exemptWords).toBe(1)
    // Only marks and markers are ever exempt: the words stop at the level labels.
    expect(p.bounds.exempt!.length).toBe(p.levelRect)
    expect(isExempt(p.bounds, p.levelRect + 5, 0)).toBe(false)
    expect(() => setExempt(p.bounds, p.levelRect, 0)).toThrow()
    expect(p.bounds.groups!.length).toBe(groupCapacity(2) * GROUP)
    expect(createLabelPlacement(stationsOf(A, A, A, A, A), []).bounds.exemptWords).toBe(3)
  })
})

describe('carryPlacement', () => {
  it('carries last picks by layer object, leaving a new or rebuilt layer fresh', () => {
    const prev = createLabelPlacement(stationsOf(A, B), [])
    prev.lastSrc.fill(3)
    prev.lastRun.fill(1)
    prev.lastFirst.fill(1)
    // B rebuilt (a new layer object for the same station) and C new; A moves to second.
    const rebuilt = { ...B, layer: { ...B.layer } }
    const C = fixtureStation('C', { x: 0, z: 0 }, { entrances: [{ x: 0, z: 0, w: 10 }], streets: [] })
    const next = createLabelPlacement(stationsOf(C, A, rebuilt), [])
    carryPlacement(next, prev)
    const a0 = next.segItem0[1]!
    expect(Array.from(next.lastSrc.subarray(a0, next.segEnd[1]!)).every((v) => v === 3)).toBe(true)
    expect(Array.from(next.lastFirst.subarray(a0, next.segEnd[1]!)).every((v) => v === 1)).toBe(true)
    expect(next.lastSrc[0]).toBe(-1)
    expect(Array.from(next.lastSrc.subarray(next.segItem0[2]!, next.segEnd[2]!))).toEqual([-1, -1, -1])
    expect(Number.isNaN(next.lastAngle[0]!)).toBe(true)
  })
})

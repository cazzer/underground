import { describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { createLabelBlockers } from '../lib/labelBlockers'
import { isExempt } from '../lib/labelDeclutter'
import { boxesOverlap } from '../lib/labelGeometry'
import type { Ground } from '../lib/projection'
import { crowdedStation, fixturePlacement, fixtureStation, run, topDownCamera, type FixtureEntrance, type FixtureStation } from './labelFixture'
import { carryPlacement } from './labelPlacementLayout'
import { FIXED_RECTS, newView, type LabelPlacement, type PlacementView } from './labelPlacementState'

// The placement module reads the TEMPORARY look flags from window.location on import; tests run in node.
vi.stubGlobal('window', { location: { search: '' } })
const { exemptExitFromMarks, placeLabels } = await import('./streetLabelPlacement')
vi.unstubAllGlobals()

const a = new Vector3()
const b = new Vector3()

/** An 800 px desktop canvas, top-down over (x, 0), the first station focused, neighbours budgeted 4 and 3. */
function view(x = 0, over: Partial<PlacementView> = {}): PlacementView {
  const v = newView(topDownCamera(x), 1.25)
  Object.assign(v, { width: 800, height: 800, radiusM: 250, markerRadiusM: 3, focusedFirst: true, budgetEntrances: 4, budgetStreets: 3 }, over)
  return v
}

function place(p: LabelPlacement, v: PlacementView): LabelPlacement {
  placeLabels(p, v, createLabelBlockers(), a, b)
  return p
}

/** Station `s`'s results. */
const outOf = (p: LabelPlacement, s: number) => Array.from(p.out.subarray(p.segItem0[s]!, p.segEnd[s]!))
const placedIn = (p: LabelPlacement, from: number, to: number) => Array.from(p.out.subarray(from, to)).filter((k) => k >= 0).length

/** One entrance label of width 60 at each point. */
const lone = (id: string, anchor: Ground, points: FixtureEntrance[] = [{ x: 0, z: 0, w: 60 }]): FixtureStation =>
  fixtureStation(id, anchor, { entrances: points, streets: [] })

describe('exemptExitFromMarks', () => {
  it('clears every station’s entrance-mark rects, for the focused exit label alone', () => {
    const p = fixturePlacement([lone('A', { x: 0, z: 0 }, [{ x: 0, z: 0, w: 60 }, { x: 5, z: 0, w: 60, members: [7, 9] }]), lone('B', { x: 40, z: 0 })], [{ x: 50, z: 0 }])
    const v = view(0, { priorityEntrance: 9 })
    p.bounds.exempt!.fill(0)
    exemptExitFromMarks(p, v)
    const rects = p.bounds.rects.length / 4
    for (let k = 0; k < rects; k++) {
      // Both stations' marks; header, footer, panel, station markers, focus ring and level labels stay blocking.
      const mark = k >= FIXED_RECTS && k < p.markerRect
      expect(isExempt(p.bounds, k, 1), `rect ${k}`).toBe(mark)
      expect(isExempt(p.bounds, k, 0), `rect ${k}`).toBe(false)
    }
  })

  it('clears nothing without an exit, for an exit no label stands for, or with nothing focused', () => {
    const p = fixturePlacement([lone('A', { x: 0, z: 0 }, [{ x: 0, z: 0, w: 60, members: [9] }])])
    for (const v of [view(0, { priorityEntrance: -1 }), view(0, { priorityEntrance: 3 }), view(0, { priorityEntrance: 9, focusedFirst: false })]) {
      p.bounds.exempt!.fill(0)
      exemptExitFromMarks(p, v)
      expect(p.bounds.exempt!.every((w) => w === 0)).toBe(true)
    }
  })
})

describe('placeLabels: markers and marks', () => {
  // A station marker 15 m east of the entrance, under its first spot (right of the mark).
  it('moves a label off a drawn marker, and takes that spot when the marker is hidden', () => {
    const placed = (hidden: Uint8Array | null) => place(fixturePlacement([lone('A', { x: 0, z: 0 })], [{ x: 15, z: 0 }]), view(0, { markerHidden: hidden })).out[0]
    expect(placed(null)).toBe(1)
    expect(placed(new Uint8Array([0]))).toBe(1)
    expect(placed(new Uint8Array([1]))).toBe(0)
  })

  it('moves a label off another station’s entrance mark, as off its own', () => {
    const placed = (other: Ground) => place(fixturePlacement([lone('A', { x: 0, z: 0 }), lone('B', other, [])]), view()).out[0]
    expect(placed({ x: 400, z: 400 })).toBe(0)
    // B's only mark 15 m east of A's entrance, under its first spot (fixtureStation marks every entrance; add one).
    const b2 = fixtureStation('B', { x: 15, z: 0 }, { entrances: [], streets: [], extraMarks: [{ x: 0, z: 0 }] })
    expect(place(fixturePlacement([lone('A', { x: 0, z: 0 }), b2]), view()).out[0]).toBe(1)
  })

  it('lets an entrance past the 32nd ignore the station marker its own mark sits in', () => {
    // 35 entrances far off screen, then the 36th on a station marker large enough to cover its first spot.
    const far = Array.from({ length: 35 }, (_, i): FixtureEntrance => ({ x: 3000 + i * 10, z: 0, w: 60 }))
    const p = fixturePlacement([lone('A', { x: 0, z: 0 }, [...far, { x: 0, z: 0, w: 60 }])], [{ x: 0, z: 0 }])
    place(p, view(0, { markerRadiusM: 12 }))
    expect(p.out[35]).toBe(0)
  })
})

describe('placeLabels: two stations', () => {
  const A = crowdedStation('A', { x: 10, z: -5 })

  it('never overlaps two placed labels, across stations', () => {
    const p = place(fixturePlacement([A, crowdedStation('B', { x: -40, z: 30 })], [{ x: 60, z: 35 }]), view())
    const picked: number[] = []
    for (let i = 0; i < p.cand.count; i++) if (p.out[i]! >= 0) picked.push(p.cand.start[i]! + p.out[i]!)
    expect(picked.length).toBeGreaterThan(10)
    for (let x = 0; x < picked.length; x++) {
      for (let y = x + 1; y < picked.length; y++) expect(boxesOverlap(p.cand.boxes, picked[x]!, picked[y]!, 0)).toBe(false)
    }
  })

  it('places the focused station exactly as alone when the neighbour is far', () => {
    const alone = place(fixturePlacement([A]), view())
    const both = place(fixturePlacement([A, crowdedStation('B', { x: 5000, z: 0 })]), view())
    expect(outOf(both, 0)).toEqual(outOf(alone, 0))
  })

  it('labels a street both stations hold once, the first station’s, and the other’s when the first can’t', () => {
    const broadway = (x0: number) => ({ key: 'broadway', w: 64, runs: [run(x0, -40, 1, 0, 4)] })
    const at = (ax: number, x0: number) => fixtureStation(ax < 0 ? 'A' : 'B', { x: ax, z: 0 }, { entrances: [], streets: [broadway(x0)] })
    // Both in reach: A's places, B's gets no candidates.
    let p = place(fixturePlacement([at(-60, -60), at(60, -60)]), view(0, { radiusM: 100 }))
    expect([p.out[0], p.cand.size[1]]).toEqual([0, 0])
    expect(p.out[1]).toBe(-1)
    // A's copy lies past its radius: B's places.
    p = place(fixturePlacement([at(-60, 150), at(60, -60)]), view(0, { radiusM: 100 }))
    expect(p.out[0]).toBe(-1)
    expect(p.out[1]).toBeGreaterThanOrEqual(0)
  })

  it('holds a neighbour to its budget, and to the same labels after a small pan', () => {
    const B = crowdedStation('B', { x: -40, z: 60 })
    const p = fixturePlacement([lone('A', { x: 120, z: -120 }), B])
    const v = view(0, { budgetEntrances: 2, budgetStreets: 1 })
    place(p, v)
    const e0 = p.segItem0[1]!
    const s0 = p.segStreet0[1]!
    expect(placedIn(p, e0, s0)).toBe(2)
    expect(placedIn(p, s0, p.segEnd[1]!)).toBe(1)
    const before = outOf(p, 1).map((k) => k >= 0)
    place(p, view(2, { budgetEntrances: 2, budgetStreets: 1 }))
    expect(outOf(p, 1).map((k) => k >= 0)).toEqual(before)
  })

  it('ranks a neighbour’s entrances by its own point, so its picks hold through a large pan', () => {
    const B = crowdedStation('B', { x: -40, z: 60 })
    const picks = (x: number) => {
      // A fresh placement each time: no stickiness from the last pass.
      const p = place(fixturePlacement([lone('A', { x: 120, z: -120 }), B]), view(x, { budgetEntrances: 2, budgetStreets: 1 }))
      return outOf(p, 1).slice(0, B.entrances.length).map((k) => k >= 0)
    }
    const before = picks(0)
    expect(before.filter(Boolean).length).toBe(2)
    // 40 m, about 100 px.
    expect(picks(40)).toEqual(before)
    expect(picks(-40)).toEqual(before)
  })

  it('names a budgeted station’s streets its placed entrance labels don’t name first', () => {
    const B = fixtureStation('B', { x: -40, z: 40 }, {
      entrances: [{ x: 0, z: 0, w: 60, streets: [0] }],
      streets: [
        { key: 'grand st', w: 50, runs: [run(-60, -30, 1, 0, 4)] },
        { key: 'kent av', w: 50, runs: [run(-60, 30, 1, 0, 4)] },
      ],
    })
    const p = place(fixturePlacement([lone('A', { x: 120, z: -120 }), B]), view(0, { budgetEntrances: 1, budgetStreets: 1 }))
    expect(outOf(p, 1).map((k) => k >= 0)).toEqual([true, false, true])
  })

  it('lets a leaving station keep its street label without claiming the street', () => {
    const broadway = (ax: number) => fixtureStation(ax < 0 ? 'A' : 'B', { x: ax, z: 0 }, { entrances: [], streets: [{ key: 'broadway', w: 64, runs: [run(-60, -40, 1, 0, 4)] }] })
    const p = fixturePlacement([broadway(-60), broadway(60)])
    p.leaving[0] = 1
    place(p, view(0, { radiusM: 100, focusedFirst: false }))
    expect(p.out[0]).toBeGreaterThanOrEqual(0)
    expect(p.out[1]).toBeGreaterThanOrEqual(0)
  })

  it('leaves the others’ labels alone when a later station joins or one leaves', () => {
    const B = crowdedStation('B', { x: -60, z: 60 })
    const C = lone('C', { x: 150, z: 150 })
    const ab = place(fixturePlacement([A, B]), view())
    const abc = fixturePlacement([A, B, C])
    carryPlacement(abc, ab)
    place(abc, view())
    expect(outOf(abc, 0)).toEqual(outOf(ab, 0))
    expect(outOf(abc, 1)).toEqual(outOf(ab, 1))
    const ac = fixturePlacement([A, C])
    carryPlacement(ac, abc)
    place(ac, view())
    // A keeps every label it had; B's marks gone, it may only gain.
    outOf(ab, 0).forEach((k, i) => {
      if (k >= 0) expect(outOf(ac, 0)[i]).toBe(k)
    })
  })

  it('never ranks a neighbour’s entrance first for the focused station’s exit index', () => {
    // B's entrance 0 has street-file index 0, as A's exit; with a budget of 1 B places its elevator, not it.
    const B = fixtureStation('B', { x: -60, z: 60 }, {
      entrances: [
        { x: 0, z: 0, w: 60 },
        { x: 0, z: 40, w: 60, elevator: true },
      ],
      streets: [],
    })
    const p = place(fixturePlacement([lone('A', { x: 120, z: -120 }), B]), view(0, { priorityEntrance: 0, budgetEntrances: 1 }))
    expect(outOf(p, 1).map((k) => k >= 0)).toEqual([false, true])
  })
})

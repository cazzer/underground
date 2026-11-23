import { describe, expect, it } from 'vitest'
import { declutter, GROUP, isExempt, setExempt, type LabelBounds, type LabelCandidates } from './labelDeclutter'
import { BOX, RECT, writeBox, writeRect } from './labelGeometry'
import { closeGroup } from './labelRectGroups'

const viewport = { left: 0, top: 0, right: 400, bottom: 300 }

/** Items as lists of candidate centers; every box is 40 by 10, unturned. */
function candidates(items: [number, number][][]): LabelCandidates {
  const total = items.reduce((n, c) => n + c.length, 0)
  const boxes = new Float32Array(total * BOX)
  const start = new Int32Array(items.length)
  const size = new Int32Array(items.length)
  let b = 0
  items.forEach((list, i) => {
    start[i] = b
    size[i] = list.length
    for (const [x, y] of list) writeBox(boxes, b++, x, y, 40, 10, 0)
  })
  const order = new Int16Array(items.length).map((_, i) => i)
  return { boxes, start, size, order, count: items.length }
}

type Rect = { left: number; top: number; right: number; bottom: number }

function place(c: LabelCandidates, bounds: { rects?: Rect[]; count?: number } = {}, prefer?: number[]): number[] {
  const out = new Int16Array(c.count)
  const p = new Int16Array(prefer ?? new Array<number>(c.count).fill(-1))
  const list = bounds.rects ?? []
  const rects = new Float32Array(list.length * RECT)
  list.forEach((r, i) => writeRect(rects, i, r.left, r.top, r.right, r.bottom))
  const b: LabelBounds = { viewport, rects, count: bounds.count ?? 0 }
  declutter(c, b, p, out)
  return [...out]
}

describe('declutter', () => {
  it('lets the higher priority item take a contested spot', () => {
    expect(place(candidates([[[100, 100]], [[110, 100], [200, 200]]]))).toEqual([0, 1])
    expect(place(candidates([[[100, 100]], [[110, 100]]]))).toEqual([0, -1])
  })

  it('keeps clear of the screen edge and blocked rects (header, panel)', () => {
    const c = candidates([[[10, 100], [100, 20], [100, 100]]])
    expect(place(c)).toEqual([1])
    const header = { left: 0, top: 0, right: 400, bottom: 40 }
    expect(place(c, { rects: [header], count: 1 })).toEqual([2])
    const panel = { left: 60, top: 80, right: 400, bottom: 300 }
    expect(place(c, { rects: [header, panel], count: 2 })).toEqual([-1])
    // Only the first `count` rects apply.
    expect(place(c, { rects: [header, panel], count: 1 })).toEqual([2])
  })

  it('holds last frame’s pick while it still fits, then falls back in order', () => {
    const c = candidates([[[100, 100], [200, 100], [300, 100]]])
    expect(place(c, {}, [2])).toEqual([2])
    const blocker = { left: 260, top: 0, right: 400, bottom: 300 }
    expect(place(c, { rects: [blocker], count: 1 }, [2])).toEqual([0])
    // An out-of-range preference is ignored.
    expect(place(c, {}, [7])).toEqual([0])
  })

  it('lets an item ignore the rects it is exempt from', () => {
    const c = candidates([[[100, 100]], [[300, 100]]])
    const rects = new Float32Array(2 * RECT)
    writeRect(rects, 0, 80, 90, 120, 110)
    writeRect(rects, 1, 280, 90, 320, 110)
    const out = new Int16Array(2)
    declutter(c, { viewport, rects, count: 2, exempt: new Uint32Array([0b01, 0]) }, new Int16Array([-1, -1]), out)
    expect([...out]).toEqual([0, -1])
  })

  it('reads exemptions past the 32nd item from the rect’s later words', () => {
    // 42 items all wanting the same spot, apart: item 40 exempt from the rect over it, item 41 not.
    const items: [number, number][][] = Array.from({ length: 42 }, (_, i) => [[20 + (i % 6) * 60, 20 + Math.floor(i / 6) * 30]])
    const c = candidates(items)
    const rects = new Float32Array(2 * RECT)
    writeRect(rects, 0, 250, 198, 270, 202)
    writeRect(rects, 1, 310, 198, 330, 202)
    const b: LabelBounds = { viewport, rects, count: 2, exempt: new Uint32Array(2 * 2), exemptWords: 2 }
    setExempt(b, 0, 40)
    expect(isExempt(b, 0, 40)).toBe(true)
    expect(isExempt(b, 0, 41)).toBe(false)
    expect(isExempt(b, 0, 8)).toBe(false)
    const out = new Int16Array(42)
    declutter(c, b, new Int16Array(42).fill(-1), out)
    // Item 40 sits at (260, 200) over rect 0, item 41 at (320, 200) over rect 1.
    expect([out[40], out[41]]).toEqual([0, -1])
  })

  it('stops at `limit` placed items and leaves the rest unplaced', () => {
    const c = candidates([[[50, 50]], [[150, 50]], [[250, 50]], [[350, 50]]])
    const out = new Int16Array(4)
    const placed = declutter(c, { viewport, rects: new Float32Array(0), count: 0 }, new Int16Array(4).fill(-1), out, 0, 4, 2)
    expect(placed).toBe(2)
    expect([...out]).toEqual([0, 0, -1, -1])
  })

  it('places the same with rect groups as without, and an empty group never blocks', () => {
    let seed = 7
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const items: [number, number][][] = Array.from({ length: 200 }, () => Array.from({ length: 3 }, (): [number, number] => [random() * 400, random() * 300]))
    const c = candidates(items)
    const n = 120
    const rects = new Float32Array(n * RECT)
    for (let k = 0; k < n; k++) {
      const x = random() * 400
      const y = random() * 300
      // Every fifth rect empty, as a hidden marker's.
      if (k % 5 === 0) writeRect(rects, k, 0, 0, 0, 0)
      else writeRect(rects, k, x, y, x + 4 + random() * 10, y + 4 + random() * 10)
    }
    // Twelve rects a group.
    const groups = new Float32Array(10 * GROUP)
    for (let g = 0; g < 10; g++) closeGroup(groups, g, rects, g * 12, (g + 1) * 12)
    const none = new Int16Array(200).fill(-1)
    const plain = new Int16Array(200)
    const grouped = new Int16Array(200)
    declutter(c, { viewport, rects, count: n }, none, plain)
    declutter(c, { viewport, rects, count: n, groups, groupCount: 10 }, none, grouped)
    expect([...grouped]).toEqual([...plain])
    expect(plain.some((k) => k < 0)).toBe(true)
    expect(plain.some((k) => k >= 0)).toBe(true)
    // A group of only empty rects has bounds no box touches, so it is never tested.
    const empty = new Float32Array(2 * RECT)
    writeRect(empty, 1, 200, 100, 200, 140)
    closeGroup(groups, 0, empty, 0, 2)
    expect(Array.from(groups.subarray(0, GROUP))).toEqual([0, 2, Infinity, Infinity, -Infinity, -Infinity])
    const one = candidates([[[200, 120]]])
    const out = new Int16Array(1)
    declutter(one, { viewport, rects: empty, count: 2, groups, groupCount: 1 }, new Int16Array([-1]), out)
    expect(out[0]).toBe(0)
  })

  it('places nothing for an item with no candidates', () => {
    expect(place(candidates([[], [[100, 100]]]))).toEqual([-1, 0])
  })

  it('ranks by `order`, not by index, and places a range around what is already placed', () => {
    const c = candidates([[[110, 100]], [[100, 100]]])
    c.order.set([1, 0])
    expect(place(c)).toEqual([-1, 0])
    // Phase two places item 0 around item 1, placed in phase one.
    const out = new Int16Array(2)
    const none = new Int16Array([-1, -1])
    const b: LabelBounds = { viewport, rects: new Float32Array(0), count: 0 }
    declutter(c, b, none, out, 0, 1)
    expect(out[1]).toBe(0)
    declutter(c, b, none, out, 1, 2)
    expect([...out]).toEqual([-1, 0])
  })
})

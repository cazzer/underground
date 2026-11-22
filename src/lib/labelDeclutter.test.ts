import { describe, expect, it } from 'vitest'
import { declutter, type LabelBounds, type LabelCandidates } from './labelDeclutter'
import { BOX, RECT, writeBox, writeRect } from './labelGeometry'

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
  return { boxes, start, size, count: items.length }
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

  it('places nothing for an item with no candidates', () => {
    expect(place(candidates([[], [[100, 100]]]))).toEqual([-1, 0])
  })
})

import { describe, expect, it } from 'vitest'
import { groupPatterns } from './overlayGroups'
import { TWIN_TOLERANCE_S, assignTwins, type TwinQuery } from './overlayMatch'
import { overlayScheduled } from './overlayFixture'

const tt = overlayScheduled()
const groups = [...groupPatterns(tt).values()]
const stop = (id: string) => tt.stops.stopOf.get(id)!
const query = (originS: number, run: string[], over: Partial<TwinQuery> = {}): TwinQuery => ({
  routes: new Set(['1']),
  direction: 'N',
  originS,
  run: Int32Array.from(run, stop),
  ...over,
})
const ids = (twins: ReturnType<typeof assignTwins>) => twins.map((r) => r?.id ?? null)

describe('assignTwins', () => {
  it('matches the nearest first departure within the tolerance', () => {
    const w = (t: number) => query(t, ['101N', '102N', '103N'], { routes: new Set(['W']) })
    expect(ids(assignTwins(groups, [w(77250 + TWIN_TOLERANCE_S)]))).toEqual(['W-2127'])
    expect(ids(assignTwins(groups, [w(77250 + TWIN_TOLERANCE_S + 1)]))).toEqual([null])
  })

  it('prefers the row whose stop sequence holds the run over a nearer one', () => {
    // 1-2140 (one-n, 78000) and 1x-2140 (one-n05, 78000) tie on time; only one-n05 has 102N, 103N, 104N.
    expect(ids(assignTwins(groups, [query(78000, ['102N', '103N', '104N'])]))).toEqual(['1x-2140'])
    expect(ids(assignTwins(groups, [query(78000, ['101N', '102N', '103N'])]))).toEqual(['1-2140'])
  })

  it('pairs one to one, the better score winning a contested row and the earlier query a tie', () => {
    const run = ['101N', '102N', '103N']
    const twins = assignTwins(groups, [query(77800, run), query(77760, run), null])
    expect(ids(twins)).toEqual([null, '1-2136', null])
    expect(ids(assignTwins(groups, [query(77760, run), query(77760, run)]))).toEqual(['1-2136', null])
  })

  it('ignores rows of other routes and directions', () => {
    expect(ids(assignTwins(groups, [query(77250, ['101N', '102N'], { routes: new Set(['W']) })]))).toEqual(['W-2127'])
    expect(ids(assignTwins(groups, [query(77250, ['101N', '102N'])]))).toEqual([null])
    expect(ids(assignTwins(groups, [query(77760, ['101N', '102N'], { direction: 'S' })]))).toEqual([null])
  })

  it('tries every route a key named', () => {
    const both = query(77300, ['101N', '102N'], { routes: new Set(['1', 'W']) })
    expect(ids(assignTwins(groups, [both]))).toEqual(['W-2127'])
  })
})

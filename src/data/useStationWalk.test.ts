import { describe, expect, it } from 'vitest'
import { walkLoadAt, type WalkLoad } from './useStationWalk'
import type { WalkGraph } from './walkSchema'

const graph = (stationId: string) => ({ stationId }) as WalkGraph

describe('walkLoadAt', () => {
  const loads = new Map<string, WalkLoad>([
    ['A1', { graph: graph('A1'), settled: true }],
    ['A2', { graph: null, settled: false }],
  ])

  it("gives a stop its own station's load, so a stop at another member of the complex reads that member's shard", () => {
    expect(walkLoadAt(loads, 'A1N')?.graph?.stationId).toBe('A1')
    expect(walkLoadAt(loads, 'A2S')).toEqual({ graph: null, settled: false })
  })

  it('waits per stop: one member still loading leaves the other settled', () => {
    expect([walkLoadAt(loads, 'A1S')?.settled, walkLoadAt(loads, 'A2N')?.settled]).toEqual([true, false])
  })

  it('has none for a station the end did not ask about, or with no loads at all', () => {
    expect(walkLoadAt(loads, 'C1N')).toBeNull()
    expect(walkLoadAt(null, 'A1N')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { loadPin, waysNear } from './streetsPin.ts'
import { manifestOf, pinOf, shardOf, STATION, way } from './streetsFixture.ts'

const nodes = { 1: [0, 0], 2: [100, 0], 3: [5000, 0], 4: [5100, 0] } as const
const near = way(10, { highway: 'residential', name: 'Near St' }, [1, 2])
const far = way(11, { highway: 'residential', name: 'Far St' }, [3, 4])

describe('loadPin', () => {
  it('merges shards, keeps ways by id and a bounding box of each', () => {
    const a = shardOf(nodes, [far])
    const b = shardOf(nodes, [near])
    const pin = loadPin(manifestOf(['a.json', 'b.json']), new Map([['a.json', a], ['b.json', b]]))
    expect(pin.ways.map((w) => w.way.id)).toEqual([10, 11])
    expect(pin.nodes.size).toBe(4)
    expect(pin.ways[0]!.maxLon).toBeGreaterThan(pin.ways[0]!.minLon)
  })

  it('rejects a way id in two shards', () => {
    const a = shardOf(nodes, [near])
    expect(() => loadPin(manifestOf(['a.json', 'b.json']), new Map([['a.json', a], ['b.json', a]]))).toThrow(/way 10 is in two shards/)
  })

  it('rejects a node with two coordinates across shards', () => {
    const a = shardOf(nodes, [near])
    const b = shardOf({ ...nodes, 2: [200, 0] }, [way(12, { highway: 'residential', name: 'X' }, [2, 3])])
    expect(() => loadPin(manifestOf(['a.json', 'b.json']), new Map([['a.json', a], ['b.json', b]]))).toThrow(/node 2 is at/)
  })

  it('rejects a way node missing from its shard, a missing shard and a non-safe node id', () => {
    const a = shardOf(nodes, [near])
    a.nodes = a.nodes.filter(([id]) => id !== 2)
    expect(() => loadPin(manifestOf(['a.json']), new Map([['a.json', a]]))).toThrow(/node 2 is not in the shard/)
    expect(() => loadPin(manifestOf(['a.json']), new Map())).toThrow(/listed in the manifest/)
    const bad = shardOf(nodes, [near])
    bad.nodes[0] = [2 ** 53, 40.7, -74]
    expect(() => loadPin(manifestOf(['a.json']), new Map([['a.json', bad]]))).toThrow(/safe integer/)
  })
})

describe('waysNear', () => {
  it('returns the ways whose box is within the radius, in id order, and not a far one', () => {
    const pin = pinOf(nodes, [far, near])
    expect(waysNear(pin, STATION, 300).map((w) => w.way.id)).toEqual([10])
    expect(waysNear(pin, STATION, 6000).map((w) => w.way.id)).toEqual([10, 11])
  })
})

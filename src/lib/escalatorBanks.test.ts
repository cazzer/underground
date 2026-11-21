import { describe, expect, it } from 'vitest'
import type { Connector, Entrance } from '../data/stationSchema'
import { BANK_GAP_M, spreadBanks } from './escalatorBanks'

/** An inventory-style escalator: both ends at (x, z). */
const esc = (id: string, x: number, z: number, width = 1.2): Connector => ({
  id,
  kind: 'escalator',
  lower: { x, z, level: 'mezz' },
  upper: { x, z, level: 'street' },
  width,
  sources: ['nyopendata'],
})

const entrance = (id: string, x: number, z: number, connectors: string[]): Entrance => ({
  id,
  x,
  z,
  type: 'Escalator',
  entry: true,
  exit: true,
  connectors,
  sources: ['nyopendata'],
})

describe('spreadBanks', () => {
  it('pins an escalator on the entrance that lists it, unshifted', () => {
    const anchors = spreadBanks([esc('ES1', 4, 5)], [entrance('E1', 4, 5, ['ES1'])])
    expect(anchors.get('ES1')).toEqual({ point: [4, 5], atEntrance: true, lateral: 0 })
  })

  it('centers one moved off its entrance by an authored `at` on its own point', () => {
    const anchors = spreadBanks([esc('ES1', 4, 8)], [entrance('E1', 4, 5, ['ES1'])])
    expect(anchors.get('ES1')).toEqual({ point: [4, 8], atEntrance: false, lateral: 0 })
  })

  it('spreads a bank at one entrance across the axis in id order, centered on the entrance', () => {
    const anchors = spreadBanks([esc('ES3', 4, 5), esc('ES1', 4, 5), esc('ES2', 4, 5)], [entrance('E1', 4, 5, ['ES3', 'ES1', 'ES2'])])
    const pitch = 1.2 + BANK_GAP_M
    expect(anchors.get('ES1')!.lateral).toBeCloseTo(-pitch)
    expect(anchors.get('ES2')!.lateral).toBeCloseTo(0)
    expect(anchors.get('ES3')!.lateral).toBeCloseTo(pitch)
    for (const a of anchors.values()) expect(a).toMatchObject({ point: [4, 5], atEntrance: true })
  })

  it('keeps a clear gap between neighbors of different widths', () => {
    const anchors = spreadBanks([esc('A', 0, 0, 1), esc('B', 0, 0, 2)], [])
    const [a, b] = [anchors.get('A')!, anchors.get('B')!]
    expect(b.lateral - a.lateral).toBeCloseTo(1 / 2 + 2 / 2 + BANK_GAP_M)
    // The bank's outer edges sit symmetrically about the point.
    expect(a.lateral - 1 / 2 + (b.lateral + 2 / 2)).toBeCloseTo(0)
    expect(a).toMatchObject({ point: [0, 0], atEntrance: false })
  })

  it('banks only escalators that share an anchor: an unlisted one on the entrance point stays apart', () => {
    const anchors = spreadBanks([esc('ES1', 4, 5), esc('ES2', 4, 5), esc('ES3', 9, 9)], [entrance('E1', 4, 5, ['ES1'])])
    expect(anchors.get('ES1')).toEqual({ point: [4, 5], atEntrance: true, lateral: 0 })
    expect(anchors.get('ES2')).toEqual({ point: [4, 5], atEntrance: false, lateral: 0 })
    expect(anchors.get('ES3')).toEqual({ point: [9, 9], atEntrance: false, lateral: 0 })
  })

  it('skips escalators with a run of their own and every other kind', () => {
    const run: Connector = { ...esc('ES1', 0, 0), upper: { x: 6, z: 0, level: 'street' } }
    const stair: Connector = { ...esc('ST1', 0, 0), kind: 'stair' }
    expect(spreadBanks([run, stair], [entrance('E1', 0, 0, ['ES1', 'ST1'])]).size).toBe(0)
  })

  it('throws when two entrances list the same connector', () => {
    const twice = [entrance('E1', 4, 5, ['ES1']), entrance('E2', 6, 5, ['ES1'])]
    expect(() => spreadBanks([esc('ES1', 4, 5)], twice)).toThrow(/"ES1" is listed by entrances "E1" and "E2"/)
  })
})

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

  it('banks an unlisted escalator with a pinned one on the same entrance point, pinned there', () => {
    const anchors = spreadBanks([esc('ES1', 4, 5), esc('ES2', 4, 5)], [entrance('E1', 4, 5, ['ES1'])])
    const pitch = 1.2 + BANK_GAP_M
    expect(anchors.get('ES1')).toEqual({ point: [4, 5], atEntrance: true, lateral: expect.closeTo(-pitch / 2) })
    expect(anchors.get('ES2')).toEqual({ point: [4, 5], atEntrance: true, lateral: expect.closeTo(pitch / 2) })
  })

  it("banks a chain transitively, whatever the input order, on the first member's point", () => {
    // ES3 is 0.6 m from ES1 and 0.36 m from ES2, which is 0.36 m from ES1.
    const anchors = spreadBanks([esc('ES3', 4.6, 5), esc('ES2', 4.3, 5.2), esc('ES1', 4, 5)], [])
    for (const id of ['ES1', 'ES2', 'ES3']) expect(anchors.get(id)).toMatchObject({ point: [4, 5], atEntrance: false })
    const pitch = 1.2 + BANK_GAP_M
    expect(['ES1', 'ES2', 'ES3'].map((id) => anchors.get(id)!.lateral)).toEqual([-pitch, 0, pitch].map((v) => expect.closeTo(v)))
  })

  it('banks escalators whose bands would touch (1 m apart), not ones 3 m apart', () => {
    const near = spreadBanks([esc('ES1', 0, 0), esc('ES2', 1, 0)], [])
    expect(near.get('ES2')).toMatchObject({ point: [0, 0], lateral: expect.closeTo((1.2 + BANK_GAP_M) / 2) })
    const far = spreadBanks([esc('ES1', 0, 0), esc('ES2', 3, 0)], [])
    expect(far.get('ES1')).toEqual({ point: [0, 0], atEntrance: false, lateral: 0 })
    expect(far.get('ES2')).toEqual({ point: [3, 0], atEntrance: false, lateral: 0 })
  })

  it('never banks an authored escalator centered on its own point; one authored on its entrance still banks', () => {
    const authored = (c: Connector): Connector => ({ ...c, sources: ['nyopendata', 'authored'] })
    const anchors = spreadBanks(
      [authored(esc('ES1', 4, 8)), esc('ES2', 4, 8), authored(esc('ES3', 0, 0)), esc('ES4', 0, 0)],
      [entrance('E1', 0, 0, ['ES3'])],
    )
    expect(anchors.get('ES1')).toEqual({ point: [4, 8], atEntrance: false, lateral: 0 })
    expect(anchors.get('ES2')).toEqual({ point: [4, 8], atEntrance: false, lateral: 0 })
    expect(anchors.get('ES3')).toEqual({ point: [0, 0], atEntrance: true, lateral: expect.closeTo(-(1.2 + BANK_GAP_M) / 2) })
    expect(anchors.get('ES4')).toEqual({ point: [0, 0], atEntrance: true, lateral: expect.closeTo((1.2 + BANK_GAP_M) / 2) })
  })

  it('skips escalators with a run of their own and every other kind', () => {
    const run: Connector = { ...esc('ES1', 0, 0), upper: { x: 6, z: 0, level: 'street' } }
    const stair: Connector = { ...esc('ST1', 0, 0), kind: 'stair' }
    expect(spreadBanks([run, stair], [entrance('E1', 0, 0, ['ES1', 'ST1'])]).size).toBe(0)
  })

  it('throws when two entrances list the same zero-run escalator; another connector listed twice is not its concern', () => {
    const twice = [entrance('E1', 4, 5, ['ES1', 'ST1']), entrance('E2', 6, 5, ['ES1', 'ST1'])]
    expect(() => spreadBanks([esc('ES1', 4, 5)], twice)).toThrow(/"ES1" is listed by entrances "E1", "E2"/)
    const stair: Connector = { ...esc('ST1', 4, 5), kind: 'stair', upper: { x: 8, z: 5, level: 'street' } }
    expect(spreadBanks([stair], twice).size).toBe(0)
  })
})

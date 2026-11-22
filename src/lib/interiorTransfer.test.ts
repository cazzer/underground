import { describe, expect, it } from 'vitest'
import { complexFixture, connector, without, withFreeMezzanine, withSlab } from './complexFixture'
import { routesToStreet, STAIR_MPS } from './interiorGraph'
import { chooseTransfer, transferRoute, type TransferChoice } from './interiorTransfer'
import { WALK_SPEED_MPS } from './walkRoute'

const W = WALK_SPEED_MPS
const base = complexFixture()

function transfer(interior = base, fromStop = 'U01N', toStop = 'T01S', closed?: ReadonlySet<string>): TransferChoice {
  const r = chooseTransfer({ interior, fromStop, toStop, closed })
  if (r.kind !== 'transfer') throw new Error(`no transfer: ${r.reason}`)
  return r
}

describe('chooseTransfer: the shortest transfer', () => {
  it('takes the direct stair from the lower platform up to the upper one, priced walk + stair + walk', () => {
    const t = transfer()
    expect(t.connectorIds).toEqual(['st-tu'])
    expect(t.areaIds).toEqual(['island-u', 'island-t'])
    // Track U01N (z 10.5) to the stair foot (20, 11); 9 m of run and 5 m of rise; the stair top (20, 2) to T01S (z 2.5).
    expect(t.inStationS).toBeCloseTo(0.5 / W + Math.hypot(9, 5) / STAIR_MPS + 0.5 / W, 9)
    expect(t).toMatchObject({ kind: 'transfer', stopId: 'U01N', toStopId: 'T01S', stepFree: false, paidAssumed: false, probable: false })
  })

  it('changes across one platform with no connector, priced as the walk between its tracks', () => {
    const t = transfer(base, 'T01N', 'T01S')
    expect(t.connectorIds).toEqual([])
    expect(t.areaIds).toEqual(['island-t'])
    expect(t.inStationS).toBeCloseTo(5 / W, 9)
    expect(t.stepFree).toBe(true)
    expect(t.stepFreeAlt).toBeNull()
  })

  it('is no-track for a stop with no platform track here', () => {
    expect(chooseTransfer({ interior: base, fromStop: 'U01N', toStop: 'X99N' })).toEqual({ kind: 'none', reason: 'no-track' })
    expect(transferRoute(base, 'X99S', 'T01N')).toBe('no-track')
  })

  it('takes an up-only escalator upward only', () => {
    const es = connector('es-tu', 'escalator', [20, 11, 'platform-u', 'island-u'], [20, 2, 'platform-t', 'island-t'], { travel: 'up', width: 1.5 })
    const i = { ...without(base, 'st-tu'), connectors: [...without(base, 'st-tu').connectors, es] }
    expect(transfer(i, 'U01N', 'T01S').connectorIds).toEqual(['es-tu'])
    expect(transfer(i, 'T01S', 'U01N').connectorIds).toEqual(['st-t', 'wk-tu', 'st-u'])
  })
})

describe('chooseTransfer: the step-free transfer', () => {
  it('offers the elevators and the walkway when the quickest way has steps', () => {
    const alt = transfer().stepFreeAlt
    expect(alt?.connectorIds).toEqual(['EL-U', 'wk-tu', 'EL-T'])
    expect(alt?.areaIds).toEqual(['island-u', 'mezz-u', 'mezz-t', 'island-t'])
    expect(alt?.stepFree).toBe(true)
  })

  it('offers none when an elevator it needs is out of service', () => {
    const t = transfer(base, 'U01N', 'T01S', new Set(['EL-T']))
    expect(t.connectorIds).toEqual(['st-tu'])
    expect(t.stepFreeAlt).toBeNull()
  })

  it('offers none when the quickest way is already step-free', () => {
    const t = transfer(without(base, 'st-tu', 'st-t', 'st-u'))
    expect(t.connectorIds).toEqual(['EL-U', 'wk-tu', 'EL-T'])
    expect(t.stepFree).toBe(true)
    expect(t.stepFreeAlt).toBeNull()
  })
})

describe('chooseTransfer: fare control', () => {
  const noDirect = without(base, 'st-tu')

  it('takes the paid mezzanines over a quicker way through an unpaid one', () => {
    expect(transfer(noDirect).connectorIds).toEqual(['st-u', 'wk-tu', 'st-t'])
    expect(transfer(withFreeMezzanine(noDirect, false)).connectorIds).toEqual(['st-u', 'wk-tu', 'st-t'])
    // The same slab inside fare control is the quicker way, so only the unpaid flag kept the route off it.
    expect(transfer(withFreeMezzanine(noDirect, true)).connectorIds).toEqual(['st-free-u', 'st-free-t'])
  })

  it('finds no route when the only way between the platforms crosses an unpaid slab, though the exit still does', () => {
    const i = withSlab(noDirect, 'mezz-u', { paid: false })
    expect(chooseTransfer({ interior: i, fromStop: 'U01N', toStop: 'T01S' })).toEqual({ kind: 'none', reason: 'no-route' })
    expect(routesToStreet(i, 'U01N')![0]!.connectorIds).toEqual(['st-u', 'st-street-u'])
  })

  it('finds no route when the platforms join only through the street', () => {
    const i = without(base, 'st-tu', 'wk-tu')
    expect(chooseTransfer({ interior: i, fromStop: 'U01N', toStop: 'T01S' })).toEqual({ kind: 'none', reason: 'no-route' })
    expect(routesToStreet(i, 'U01N')!.length).toBeGreaterThan(0)
  })

  it('assumes a slab that does not say is inside fare control, so the transfer is probable', () => {
    const i = withSlab(withSlab(noDirect, 'mezz-u', { paid: undefined }), 'mezz-t', { paid: undefined })
    const t = transfer(i)
    expect(t.connectorIds).toEqual(['st-u', 'wk-tu', 'st-t'])
    expect(t).toMatchObject({ paidAssumed: true, probable: true })
    // Platform to platform touches no slab: nothing is assumed.
    expect(transfer(withSlab(base, 'mezz-u', { paid: undefined }))).toMatchObject({ paidAssumed: false, probable: false })
  })

  it('is probable on an approximate layout', () => {
    expect(transfer({ ...base, approximate: true }).probable).toBe(true)
  })
})

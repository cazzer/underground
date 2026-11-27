import { describe, expect, it } from 'vitest'
import { MAX_DECKS } from '../lib/interiorDecks'
import { RENDER_ORDER, spanCarOrders, strokeOrders } from './renderOrder'

/** Every interior order, bottom to top, for an interior with `decks` decks: band 0, deck 0's trains, band 1, ... */
function stack(decks: number): number[] {
  const out: number[] = []
  for (let band = 0; band <= decks; band++) {
    const s = strokeOrders(band, decks + 1)
    out.push(s.fine, s.strong, s.exitPath)
    if (band === decks) break
    const t = spanCarOrders(band)
    out.push(t.halo, t.body, t.rim, t.gap)
  }
  return out
}

describe('interior band and deck render orders', () => {
  it.each([0, 1, 2, MAX_DECKS])('rise strictly through %i deck(s), above the streets over the veil and under the focus ring', (decks) => {
    const orders = stack(decks)
    for (let i = 1; i < orders.length; i++) expect(orders[i]!, `step ${i}`).toBeGreaterThan(orders[i - 1]!)
    expect(orders[0]!).toBeGreaterThan(RENDER_ORDER.streetEntrance)
    expect(orders.at(-1)!).toBeLessThan(RENDER_ORDER.focusRing)
  })

  it('are the single-deck orders of before for one deck', () => {
    expect(strokeOrders(0, 2)).toMatchObject({ fine: 8, strong: 9 })
    expect(spanCarOrders(0)).toEqual({ halo: 9.45, body: 9.5, rim: 9.51, gap: 9.52 })
    expect(strokeOrders(1, 2)).toMatchObject({ fine: 9.6, strong: 9.7 })
    expect(strokeOrders(0, 1)).toMatchObject({ fine: 8, strong: 9 })
  })

  it("draw the place pin's halo under it, both over the location reticle and under the veil", () => {
    expect(RENDER_ORDER.placePinHalo).toBeGreaterThan(RENDER_ORDER.here)
    expect(RENDER_ORDER.placePin).toBeGreaterThan(RENDER_ORDER.placePinHalo)
    expect(RENDER_ORDER.placePin).toBeLessThan(RENDER_ORDER.interiorVeil)
  })

  it("draw the trip's walks over the marks' halos and under their rings, or above the veil under the entrance marks", () => {
    expect(RENDER_ORDER.tripMarkHalo).toBeLessThan(RENDER_ORDER.tripWalk)
    expect(RENDER_ORDER.tripWalk).toBeLessThan(RENDER_ORDER.tripMark)
    expect(RENDER_ORDER.tripMark).toBeLessThan(RENDER_ORDER.tripMarkDot)
    expect(RENDER_ORDER.interiorVeil).toBeLessThan(RENDER_ORDER.streetsOver)
    expect(RENDER_ORDER.streetsOver).toBeLessThan(RENDER_ORDER.tripWalkOver)
    expect(RENDER_ORDER.tripWalkOver).toBeLessThan(RENDER_ORDER.streetEntrance)
  })

  it("draw a trip's place pins above the veil, over the walks and under the entrance marks, the halo under the pin", () => {
    expect(RENDER_ORDER.tripPlacePinHaloOver).toBeGreaterThan(RENDER_ORDER.tripWalkOver)
    expect(RENDER_ORDER.tripPlacePinOver).toBeGreaterThan(RENDER_ORDER.tripPlacePinHaloOver)
    expect(RENDER_ORDER.tripPlacePinOver).toBeLessThan(RENDER_ORDER.streetEntrance)
  })

  it("draw a straight-drawn ride over the ride legs and under the station markers", () => {
    expect(RENDER_ORDER.tripLine).toBeLessThan(RENDER_ORDER.tripStraight)
    expect(RENDER_ORDER.tripStraight).toBeLessThan(RENDER_ORDER.stationFill)
  })

  it('throw past the decks there are orders for', () => {
    expect(() => strokeOrders(3, 3)).toThrow()
    expect(() => spanCarOrders(MAX_DECKS)).toThrow()
  })
})

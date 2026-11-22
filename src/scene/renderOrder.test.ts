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

  it('throw past the decks there are orders for', () => {
    expect(() => strokeOrders(3, 3)).toThrow()
    expect(() => spanCarOrders(MAX_DECKS)).toThrow()
  })
})

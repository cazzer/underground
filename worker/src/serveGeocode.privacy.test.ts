import { describe, expect, it, vi } from 'vitest'
import type { SourceOutcome } from './geocodeOutcome'
import { FAILED, GS_EMPTY, GS_PLACE, PH_KATZ, fakeCtx, fakeEdge, get, harness, installFakeClock, type Harness } from './serveHarness'

installFakeClock()

const SECRET = 'zqxsecret deli'
const FOCUS = 'focus=40.71,-74.00'
const QS = `q=${encodeURIComponent(SECRET)}&${FOCUS}`

describe('privacy: no query or focus in any log', () => {
  it('keeps the query, its words and the focus out of console output in every scenario', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined))
    const leaky = (): Promise<SourceOutcome> => Promise.reject(new Error(`GET https://upstream/?q=${SECRET}&lat=40.71&lon=-74.00 failed`))
    const scenarios: Harness[] = [harness(GS_EMPTY, PH_KATZ), harness(FAILED, FAILED), harness(GS_PLACE, FAILED), harness(GS_EMPTY, GS_EMPTY)]
    const rejecting = harness()
    rejecting.fetchGeoSearch.mockImplementation(leaky)
    rejecting.fetchPhoton.mockImplementation(leaky)
    scenarios.push(rejecting)
    const busy = harness(GS_PLACE)
    for (let i = 0; i < 21; i++) await get(busy, `q=name+${i}&${FOCUS}`)

    for (const deps of scenarios) {
      const ctx = fakeCtx()
      const edge = fakeEdge()
      edge.put = () => Promise.reject(new Error(`put https://w.example/?q=${SECRET}`))
      await get(deps, QS, edge, ctx)
      await ctx.flush()
      await get(deps, QS, edge, ctx)
    }
    const unreadable = fakeEdge()
    unreadable.match = () => Promise.reject(new Error(`match ${SECRET}`))
    await get(harness(), QS, unreadable)
    const broken = harness()
    broken.state.lru.get = () => {
      throw new Error(`lru ${SECRET}`)
    }
    await get(broken, QS)

    const logged = spies.flatMap((s) =>
      s.mock.calls.map((args) => args.map((a) => (typeof a === 'string' ? a : (JSON.stringify(a) ?? String(a)))).join(' ')),
    )
    expect(logged.length).toBeGreaterThan(5)
    for (const line of logged) expect(line).not.toMatch(/zqxsecret|40\.71|-74\.00/)
    for (const event of ['geocode-miss', 'geocode-edge-put-failed', 'geocode-edge-read-failed', 'geocode-internal']) {
      expect(logged.some((l) => l.includes(event))).toBe(true)
    }
  })
})

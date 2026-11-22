import { describe, expect, it, vi } from 'vitest'
import { ALLOWED, fakeCtx, fakeEdge, get, harness, installFakeClock, type Harness } from './serveHarness'
import { createGeocodeState, serveGeocode } from './serveGeocode'

installFakeClock()

const QS = 'q=barclays+center&focus=40.71,-74.00'
const IP_A = '203.0.113.7'
const IP_B = '198.51.100.9'

/** A fake binding: `limit` successes per key, then refusals. Records every key it was given. */
function fakeBinding(limit: number) {
  const counts = new Map<string, number>()
  const keys: string[] = []
  const binding: RateLimit = {
    async limit({ key }) {
      keys.push(key)
      const n = (counts.get(key) ?? 0) + 1
      counts.set(key, n)
      return { success: n <= limit }
    },
  }
  return { binding, keys }
}

function call(deps: Harness, ip: string | null, qs = QS, origin: string | null = ALLOWED) {
  const headers = new Headers()
  if (ip) headers.set('CF-Connecting-IP', ip)
  return serveGeocode(new Request(`https://w.example/geocode?${qs}`, { headers }), fakeCtx(), origin, fakeEdge(), deps)
}

const errorLines = (needle: string) => vi.mocked(console.error).mock.calls.filter((c) => String(c[0]).includes(needle))

describe('/geocode per-client limit', () => {
  it('answers 429 rate-limited to the client over the limit, with no upstream call, while another client is served', async () => {
    const deps = harness()
    deps.clientLimit = fakeBinding(2).binding
    expect((await call(deps, IP_A)).status).toBe(200)
    expect((await call(deps, IP_A)).status).toBe(200)
    const calls = deps.fetchGeoSearch.mock.calls.length
    const res = await call(deps, IP_A, 'q=a+different+query')
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate-limited' })
    expect(res.headers.get('retry-after')).toBe('60')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('access-control-expose-headers')).toBe('retry-after')
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED)
    expect(deps.fetchGeoSearch.mock.calls.length).toBe(calls)
    expect(deps.fetchPhoton).not.toHaveBeenCalled()
    expect((await call(deps, IP_B)).status).toBe(200)
  })

  it('limits before the caches: a query the isolate just cached is refused too', async () => {
    const deps = harness()
    deps.clientLimit = fakeBinding(1).binding
    expect((await call(deps, IP_A)).status).toBe(200)
    expect(deps.fetchGeoSearch).toHaveBeenCalledTimes(1)
    expect((await call(deps, IP_A)).status).toBe(429)
    expect((await call(deps, IP_B)).status).toBe(200)
    expect(deps.fetchGeoSearch).toHaveBeenCalledTimes(1)
  })

  it('limits before parsing, so a bad query counts, and after the Origin check, so a foreign site does not', async () => {
    const { binding, keys } = fakeBinding(1)
    const deps = harness()
    deps.clientLimit = binding
    expect((await call(deps, IP_A, 'q=ab')).status).toBe(400)
    expect((await call(deps, IP_A, 'q=ab')).status).toBe(429)
    expect((await call(deps, IP_B, QS, null)).status).toBe(403)
    expect((await call(deps, IP_B, QS, 'https://evil.example')).status).toBe(403)
    expect(keys).toEqual([IP_A, IP_A])
  })

  it('keys on CF-Connecting-IP alone, and skips the limit when the header is absent', async () => {
    const { binding, keys } = fakeBinding(0)
    const deps = harness()
    deps.clientLimit = binding
    expect((await call(deps, null)).status).toBe(200)
    expect(keys).toEqual([])
    expect((await call(deps, IP_A)).status).toBe(429)
    expect(keys).toEqual([IP_A])
  })

  it('counts the addresses of one IPv6 /64 together and another /64 apart', async () => {
    const { binding, keys } = fakeBinding(1)
    const deps = harness()
    deps.clientLimit = binding
    expect((await call(deps, '2001:db8:1:2::1')).status).toBe(200)
    expect((await call(deps, '2001:db8:1:2:abcd:ef01:2345:6789', 'q=another+query')).status).toBe(429)
    expect((await call(deps, '2001:db8:1:3::1')).status).toBe(200)
    expect(keys).toEqual(['2001:db8:1:2::/64', '2001:db8:1:2::/64', '2001:db8:1:3::/64'])
  })

  it('skips the limit for a malformed address, logging one fixed code once and never the value', async () => {
    const { binding, keys } = fakeBinding(0)
    const deps = harness()
    deps.clientLimit = binding
    const bad = 'not-an-address-zz9'
    for (let i = 0; i < 3; i++) expect((await call(deps, bad)).status).toBe(200)
    expect(keys).toEqual([])
    expect(errorLines('geocode-client-limit')).toEqual([['{"event":"geocode-client-limit-bad-address"}']])
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(bad)
  })

  it('fails open and logs one fixed code once when there is no binding', async () => {
    const deps = harness()
    for (let i = 0; i < 3; i++) expect((await get(deps, QS)).status).toBe(200)
    expect(errorLines('geocode-client-limit')).toEqual([['{"event":"geocode-client-limit-missing"}']])
  })

  it('fails open and logs one fixed code once when the binding throws', async () => {
    const deps = harness()
    deps.clientLimit = { limit: () => Promise.reject(new Error(`limit failed for ${IP_A}`)) }
    for (let i = 0; i < 3; i++) expect((await call(deps, IP_A)).status).toBe(200)
    expect(errorLines('geocode-client-limit')).toEqual([['{"event":"geocode-client-limit-failed"}']])
  })

  it('a fresh isolate state warns again', async () => {
    const deps = harness()
    await get(deps, QS)
    deps.state = createGeocodeState(Date.now())
    await get(deps, QS)
    expect(errorLines('geocode-client-limit-missing')).toHaveLength(2)
  })

  it('never puts the client address in a log, header or body', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined))
    const limited = harness()
    limited.clientLimit = fakeBinding(1).binding
    const throwing = harness()
    throwing.clientLimit = { limit: () => Promise.reject(new Error(`boom ${IP_A}`)) }
    const seen: string[] = []
    for (const deps of [limited, throwing]) {
      for (let i = 0; i < 3; i++) {
        const res = await call(deps, IP_A)
        seen.push(await res.text(), ...[...res.headers].flat())
      }
    }
    const logged = spies.flatMap((s) => s.mock.calls.map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')))
    expect(logged.length).toBeGreaterThan(0)
    for (const text of [...logged, ...seen]) expect(text).not.toContain(IP_A)
  })
})

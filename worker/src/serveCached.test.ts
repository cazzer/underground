import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FAILURE_BACKOFF_MS, REFRESH_GRACE_MS } from './cache'
import { serveCached, type CachedRoute, type EdgeCache } from './serveCached'

const T0 = 1_800_000_000_000
const ALLOWED = 'https://cazzer.github.io'

function fakeEdge(): EdgeCache & { store: Map<string, Response>; puts: string[] } {
  const store = new Map<string, Response>()
  const puts: string[] = []
  return {
    store,
    puts,
    async match(request) {
      return store.get(request.url)?.clone()
    },
    async put(request, response) {
      puts.push(request.url)
      store.set(request.url, response)
    },
  }
}

function fakeCtx(): { waitUntil(p: Promise<unknown>): void; flush(): Promise<void> } {
  const pending: Promise<unknown>[] = []
  return {
    waitUntil: (p) => void pending.push(p),
    flush: async () => void (await Promise.all(pending)),
  }
}

function makeRoute(cachePath: string, ttlMs: number, build: CachedRoute['build']): CachedRoute {
  return { cachePath, ttlMs, build, state: { memo: null, refreshingSince: null, failedUntil: null } }
}

function deferred<T>(): { promise: Promise<T>; resolve(v: T): void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const req = (path = '/rt') => new Request(`https://rt.example${path}`)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('serveCached', () => {
  it('builds on a miss, then serves memory, then rebuilds after expiry', async () => {
    const build = vi.fn().mockResolvedValueOnce('one').mockResolvedValueOnce('two')
    const route = makeRoute('/rt?v=1', 15_000, build)
    const edge = fakeEdge()
    const ctx = fakeCtx()

    const first = await serveCached(route, req(), ctx, null, edge)
    expect(first.headers.get('x-rt-cache')).toBe('miss')
    expect(await first.text()).toBe('one')

    const second = await serveCached(route, req(), ctx, null, edge)
    expect(second.headers.get('x-rt-cache')).toBe('memory')
    expect(await second.text()).toBe('one')
    expect(build).toHaveBeenCalledTimes(1)

    vi.setSystemTime(T0 + 15_000)
    const third = await serveCached(route, req(), ctx, null, edge)
    expect(third.headers.get('x-rt-cache')).toBe('miss')
    expect(await third.text()).toBe('two')
  })

  it('sends exactly the response headers, echoing only an allowed origin', async () => {
    const build = vi.fn().mockResolvedValue('{}')
    const allowed = await serveCached(makeRoute('/rt?v=1', 15_000, build), req(), fakeCtx(), ALLOWED, fakeEdge())
    expect(Object.fromEntries(allowed.headers)).toEqual({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-rt-cache': 'miss',
      vary: 'Origin',
      'access-control-allow-origin': ALLOWED,
    })
    const denied = await serveCached(makeRoute('/rt?v=1', 15_000, build), req(), fakeCtx(), 'https://evil.example', fakeEdge())
    expect(denied.headers.get('access-control-allow-origin')).toBeNull()
    expect(denied.headers.get('vary')).toBe('Origin')
  })

  it('writes the edge entry at the cache path with the route ttl, and serves a fresh one without building', async () => {
    const build = vi.fn().mockResolvedValue('body')
    const edge = fakeEdge()
    const ctx = fakeCtx()
    await serveCached(makeRoute('/ene?v=1', 120_000, build), req('/ene'), ctx, null, edge)
    await ctx.flush()
    expect(edge.puts).toEqual(['https://rt.example/ene?v=1'])
    const stored = edge.store.get('https://rt.example/ene?v=1') as Response
    expect(stored.headers.get('cache-control')).toBe('public, max-age=120')
    expect(stored.headers.get('x-rt-expires')).toBe(String(T0 + 120_000))
    expect(stored.headers.get('content-type')).toBe('application/json; charset=utf-8')

    // A new isolate: empty memo, shared edge.
    vi.setSystemTime(T0 + 60_000)
    const fresh = makeRoute('/ene?v=1', 120_000, build)
    const res = await serveCached(fresh, req('/ene'), ctx, null, edge)
    expect(res.headers.get('x-rt-cache')).toBe('edge')
    expect(await res.text()).toBe('body')
    expect(build).toHaveBeenCalledTimes(1)
    expect(fresh.state.memo).toEqual({ body: 'body', expiresAt: T0 + 120_000 })
  })

  it('keeps separate memos and edge keys per route', async () => {
    const edge = fakeEdge()
    const ctx = fakeCtx()
    const rt = makeRoute('/rt?v=1', 15_000, vi.fn().mockResolvedValue('rt body'))
    const ene = makeRoute('/ene?v=1', 120_000, vi.fn().mockResolvedValue('ene body'))
    await serveCached(rt, req('/rt'), ctx, null, edge)
    await serveCached(ene, req('/ene'), ctx, null, edge)
    await ctx.flush()
    expect([...edge.store.keys()].sort()).toEqual(['https://rt.example/ene?v=1', 'https://rt.example/rt?v=1'])
    expect(await (await serveCached(rt, req('/rt'), ctx, null, edge)).text()).toBe('rt body')
    expect(await (await serveCached(ene, req('/ene'), ctx, null, edge)).text()).toBe('ene body')
  })

  it('serves the old body as stale when a refresh throws, and rejects with no body to fall back on', async () => {
    const build = vi.fn().mockResolvedValueOnce('old').mockRejectedValue(new Error('upstream down'))
    const route = makeRoute('/rt?v=1', 15_000, build)
    const edge = fakeEdge()
    const ctx = fakeCtx()
    await serveCached(route, req(), ctx, null, edge)
    vi.setSystemTime(T0 + 15_000)
    const stale = await serveCached(route, req(), ctx, null, edge)
    expect(stale.headers.get('x-rt-cache')).toBe('stale')
    expect(await stale.text()).toBe('old')
    expect(route.state.refreshingSince).toBeNull()

    const empty = makeRoute('/rt?v=1', 15_000, vi.fn().mockRejectedValue(new Error('upstream down')))
    await expect(serveCached(empty, req(), ctx, null, fakeEdge())).rejects.toThrow('upstream down')
    expect(empty.state.refreshingSince).toBeNull()
  })

  it('backs off after a failed refresh: stale (or 503 busy) without calling build, then retries', async () => {
    const build = vi.fn().mockResolvedValueOnce('old').mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce('new')
    const route = makeRoute('/ene?v=1', 15_000, build)
    const edge = fakeEdge()
    const ctx = fakeCtx()
    await serveCached(route, req('/ene'), ctx, null, edge)
    vi.setSystemTime(T0 + 15_000)
    expect((await serveCached(route, req('/ene'), ctx, null, edge)).headers.get('x-rt-cache')).toBe('stale')
    expect(build).toHaveBeenCalledTimes(2)

    vi.setSystemTime(T0 + 15_000 + FAILURE_BACKOFF_MS - 1)
    const backedOff = await serveCached(route, req('/ene'), ctx, null, edge)
    expect(backedOff.headers.get('x-rt-cache')).toBe('stale')
    expect(await backedOff.text()).toBe('old')
    expect(build).toHaveBeenCalledTimes(2)

    vi.setSystemTime(T0 + 15_000 + FAILURE_BACKOFF_MS)
    const retried = await serveCached(route, req('/ene'), ctx, null, edge)
    expect(retried.headers.get('x-rt-cache')).toBe('miss')
    expect(await retried.text()).toBe('new')
    expect(route.state.failedUntil).toBeNull()
  })

  it('backs off with no memo too: the first failure rejects, the next requests get 503 busy', async () => {
    const build = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce('fresh')
    const route = makeRoute('/ene?v=1', 120_000, build)
    const edge = fakeEdge()
    const ctx = fakeCtx()
    await expect(serveCached(route, req('/ene'), ctx, null, edge)).rejects.toThrow('down')
    const busy = await serveCached(route, req('/ene'), ctx, ALLOWED, edge)
    expect(busy.status).toBe(503)
    expect(busy.headers.get('retry-after')).toBe('1')
    expect(busy.headers.get('access-control-allow-origin')).toBe(ALLOWED)
    expect(build).toHaveBeenCalledTimes(1)

    vi.setSystemTime(T0 + FAILURE_BACKOFF_MS)
    expect(await (await serveCached(route, req('/ene'), ctx, null, edge)).text()).toBe('fresh')
  })

  it('answers a concurrent request with the stale body, or 503 busy with no body', async () => {
    const gate = deferred<string>()
    const build = vi.fn().mockResolvedValueOnce('old').mockReturnValueOnce(gate.promise)
    const route = makeRoute('/rt?v=1', 15_000, build)
    const edge = fakeEdge()
    const ctx = fakeCtx()
    await serveCached(route, req(), ctx, null, edge)
    vi.setSystemTime(T0 + 15_000)
    const refreshing = serveCached(route, req(), ctx, null, edge)
    const stale = await serveCached(route, req(), ctx, null, edge)
    expect(stale.headers.get('x-rt-cache')).toBe('stale')
    expect(await stale.text()).toBe('old')
    gate.resolve('new')
    expect(await (await refreshing).text()).toBe('new')

    const cold = makeRoute('/rt?v=1', 15_000, vi.fn().mockReturnValue(deferred<string>().promise))
    void serveCached(cold, req(), ctx, null, fakeEdge())
    const busy = await serveCached(cold, req(), ctx, ALLOWED, fakeEdge())
    expect(busy.status).toBe(503)
    expect(busy.headers.get('retry-after')).toBe('1')
    expect(busy.headers.get('access-control-allow-origin')).toBe(ALLOWED)
    expect(await busy.text()).toBe('{"error":"warming"}')
  })

  it('never moves the memo backwards when overlapping refreshes finish out of order', async () => {
    // First refresh waits on a slow edge read that returns an entry expiring at T0 + 15 s.
    const slowEdge = deferred<Response | undefined>()
    let reads = 0
    const edge: EdgeCache = {
      match: () => (reads++ === 0 ? slowEdge.promise : Promise.resolve(undefined)),
      put: async () => undefined,
    }
    const build = vi.fn().mockResolvedValue('newer')
    const route = makeRoute('/rt?v=1', 15_000, build)
    const ctx = fakeCtx()

    const slow = serveCached(route, req(), ctx, null, edge)
    // The claim goes stale, so a second request takes over, builds and finishes first.
    vi.setSystemTime(T0 + REFRESH_GRACE_MS + 1)
    const fast = await serveCached(route, req(), ctx, null, edge)
    expect(await fast.text()).toBe('newer')
    const newerExpiry = T0 + REFRESH_GRACE_MS + 1 + 15_000

    slowEdge.resolve(new Response('older', { headers: { 'x-rt-expires': String(T0 + 15_000) } }))
    const late = await slow
    expect(late.headers.get('x-rt-cache')).toBe('edge')
    expect(await late.text()).toBe('older')
    expect(route.state.memo).toEqual({ body: 'newer', expiresAt: newerExpiry })
    expect(route.state.refreshingSince).toBeNull()
  })
})

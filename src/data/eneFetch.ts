import { ENE_SCHEMA_VERSION, type EneOutage, type EneSnapshot } from './realtime'
import { FETCH_TIMEOUT_MS, parseRetryAfter, SchemaMismatchError, type FetchResult } from './realtimeFetch'

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function parseOutage(raw: unknown, index: number): EneOutage {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const { code, reason, since, returnAt } = r
  if (typeof code !== 'string' || code === '') throw new Error(`outage ${index} has no code`)
  if (!isNumber(since)) throw new Error(`outage ${index} (${code}) has no since`)
  if (returnAt !== null && !isNumber(returnAt)) throw new Error(`outage ${index} (${code}) has a bad returnAt`)
  if (reason !== null && typeof reason !== 'string') throw new Error(`outage ${index} (${code}) has a bad reason`)
  return { code, reason, since, returnAt }
}

/** Checks a /ene body: the version, `generatedAt`, and every outage row (which row, in the message, when one is bad). */
export function parseEneSnapshot(raw: unknown): EneSnapshot {
  if (typeof raw !== 'object' || raw === null) throw new Error('outage response is not an object')
  const r = raw as Record<string, unknown>
  if (r.version !== ENE_SCHEMA_VERSION) {
    throw new SchemaMismatchError(`outage schema v${String(r.version)}, client expects v${ENE_SCHEMA_VERSION}; reload`)
  }
  if (!isNumber(r.generatedAt)) throw new Error('outage response has no generatedAt')
  if (!isNumber(r.dropped)) throw new Error('outage response has no dropped count')
  if (!Array.isArray(r.outages)) throw new Error('outage response has no outages array')
  return { version: ENE_SCHEMA_VERSION, generatedAt: r.generatedAt, dropped: r.dropped, outages: r.outages.map(parseOutage) }
}

export type EneFetchResult = { ok: true; snapshot: EneSnapshot } | Extract<FetchResult, { ok: false }>

/**
 * One /ene poll, shaped like `fetchSnapshot`: failures come back as `ok: false` (never thrown); the only throw is
 * the caller's own abort. A 503 `{"error":"warming"}` is flagged `warming`.
 */
export async function fetchEne(url: string, signal: AbortSignal): Promise<EneFetchResult> {
  const fail = (error: string, warming = false, retryAfterS: number | null = null, schemaMismatch = false): EneFetchResult => ({
    ok: false,
    warming,
    schemaMismatch,
    error,
    retryAfterS,
  })
  try {
    const res = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]), cache: 'no-store' })
    const retryAfterS = parseRetryAfter(res.headers.get('Retry-After'), Date.now())
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null
      if (res.status === 503 && body?.error === 'warming') return fail('HTTP 503 warming', true, retryAfterS)
      return fail(`HTTP ${res.status}`, false, retryAfterS)
    }
    return { ok: true, snapshot: parseEneSnapshot(await res.json()) }
  } catch (err) {
    if (signal.aborted) throw err
    if (err instanceof DOMException && err.name === 'TimeoutError') return fail(`timeout after ${FETCH_TIMEOUT_MS / 1000} s`)
    return fail(err instanceof Error ? err.message : String(err), false, null, err instanceof SchemaMismatchError)
  }
}

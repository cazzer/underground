import { FETCH_TIMEOUT_MS, parseRetryAfter, SchemaMismatchError, type FetchResult } from './realtimeFetch'

/** One poll of a Worker JSON route: the parsed snapshot, or a failure shaped like `fetchSnapshot`'s. */
export type WorkerFetchResult<S> = { ok: true; snapshot: S } | Extract<FetchResult, { ok: false }>

/**
 * One poll of a Worker route that answers a JSON snapshot (/ene, /alerts), shaped like `fetchSnapshot`: failures come
 * back as `ok: false` (never thrown); the only throw is the caller's own abort. A 503 `{"error":"warming"}` is flagged
 * `warming`. `parse` checks the body and throws (a `SchemaMismatchError` for another version).
 */
export async function fetchWorkerJson<S>(url: string, signal: AbortSignal, parse: (raw: unknown) => S): Promise<WorkerFetchResult<S>> {
  const fail = (error: string, warming = false, retryAfterS: number | null = null, schemaMismatch = false): WorkerFetchResult<S> => ({
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
    return { ok: true, snapshot: parse(await res.json()) }
  } catch (err) {
    if (signal.aborted) throw err
    if (err instanceof DOMException && err.name === 'TimeoutError') return fail(`timeout after ${FETCH_TIMEOUT_MS / 1000} s`)
    return fail(err instanceof Error ? err.message : String(err), false, null, err instanceof SchemaMismatchError)
  }
}

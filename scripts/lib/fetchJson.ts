/** One retrying JSON fetch for the scripts that use the network (the catalog and street pins). */

const HEADERS = { 'User-Agent': 'underground-data-build/1.0', Accept: 'application/json' }
const TIMEOUT_MS = 90_000
const RETRY_STATUSES = [429, 502, 503, 504]
const RETRY_DELAYS_S = [30, 60, 120]

/** Seconds from a Retry-After header, as a number of seconds; an HTTP date or junk is ignored. */
function retryAfterS(res: Response): number | undefined {
  const n = Number(res.headers.get('Retry-After'))
  return Number.isFinite(n) && n > 0 ? Math.min(n, 300) : undefined
}

/** undici reports a dropped connection as TypeError "fetch failed" (cause: the socket error) and a cut
 *  body as TypeError "terminated"; a timeout is a TimeoutError, a stalled request an AbortError. Anything
 *  else (a bug, bad JSON) is not retried. */
function isTransient(err: unknown): boolean {
  if (err instanceof TypeError) return err.message === 'fetch failed' || err.message === 'terminated'
  return err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')
}

/** A non-2xx answer; `status` lets a caller tell an overloaded server (504) from a bad request (400). */
export class HttpError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

/** Whether `getJson` would retry this failure: a retryable status or a transient network error. */
export function isRetryable(err: unknown): boolean {
  return (err instanceof HttpError && RETRY_STATUSES.includes(err.status)) || isTransient(err)
}

export const sleep = (s: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, s * 1000))

/** GET or POST returning JSON. Retries 429/502/503/504 and thrown network errors (reset, timeout) after
 *  30, 60 and 120 s, or the Retry-After the server sent; `retries` caps how many (0: the first failure throws). */
export async function getJson(url: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS, retries = RETRY_DELAYS_S.length): Promise<unknown> {
  const what = `${init.method ?? 'GET'} ${url}`
  for (let attempt = 0; ; attempt++) {
    const delay = attempt < retries ? RETRY_DELAYS_S[attempt] : undefined
    let wait: number | undefined
    let why: string
    try {
      const res = await fetch(url, { ...init, headers: { ...HEADERS, ...init.headers }, signal: AbortSignal.timeout(timeoutMs) })
      if (res.ok) return await res.json()
      await res.body?.cancel()
      if (!RETRY_STATUSES.includes(res.status) || delay === undefined) throw new HttpError(`${what}: HTTP ${res.status} ${res.statusText}`, res.status)
      why = `HTTP ${res.status}`
      wait = retryAfterS(res)
    } catch (err) {
      if (delay === undefined || !isTransient(err)) throw err
      why = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    }
    console.log(`${what}: ${why}; retry ${attempt + 1} of ${RETRY_DELAYS_S.length} in ${wait ?? delay} s`)
    await sleep(wait ?? delay!)
  }
}

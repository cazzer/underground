/**
 * The per-client limit on /geocode: Cloudflare's Workers Rate Limiting binding (`ratelimits` in wrangler.jsonc),
 * keyed on the CF-Connecting-IP header. Cloudflare holds the counter; the address goes to the binding as its key
 * and nowhere else: it is never logged, stored, put in a header or a body.
 *
 * 30 requests per 60 s per client per Cloudflare location. The search box asks after 3+ characters and a 250 ms
 * pause, aborting stale requests, so a person typing sends a handful of requests per search; 30 a minute (one
 * every two seconds on average, in any burst) is several searches a minute, with room for a phone on a shared
 * carrier address. A script sending random queries to drain the per-isolate Photon budget (about 0.5/s) is held to
 * that rate or below. The binding is approximate (eventually consistent, counted per location): it bounds a
 * single client, the per-isolate buckets still bound everyone together. wrangler.test.ts pins these two numbers
 * against wrangler.jsonc.
 */
export const CLIENT_LIMIT = 30
/** The binding's period: 10 or 60 seconds only. Also the `retry-after` of a refusal. */
export const CLIENT_PERIOD_S = 60

/** Which fixed codes this isolate has logged already; each is logged once, so a misconfig can't flood the logs. */
export interface ClientLimitWarned {
  missing: boolean
  failed: boolean
}

export function createClientLimitWarned(): ClientLimitWarned {
  return { missing: false, failed: false }
}

/**
 * Whether this client may make a /geocode request. Fails open, since the per-isolate buckets still protect the
 * upstream services: with no binding (local tests, a misconfigured deploy), with no CF-Connecting-IP header, or
 * when the binding throws. A missing binding and a throwing one are logged once per isolate; the lines carry
 * only a fixed code.
 */
export async function clientAllowed(binding: RateLimit | undefined, request: Request, warned: ClientLimitWarned): Promise<boolean> {
  if (!binding) {
    if (!warned.missing) {
      warned.missing = true
      console.error('{"event":"geocode-client-limit-missing"}')
    }
    return true
  }
  const ip = request.headers.get('CF-Connecting-IP')
  if (!ip) return true
  try {
    return (await binding.limit({ key: ip })).success
  } catch {
    if (!warned.failed) {
      warned.failed = true
      console.error('{"event":"geocode-client-limit-failed"}')
    }
    return true
  }
}

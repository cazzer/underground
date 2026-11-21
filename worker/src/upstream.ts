import { decodeFeed } from './decode'
import { FEED_IDS, type FeedId } from './schema'
import type { FeedOutcome } from './transform'

const BASE_URL = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/'
const TIMEOUT_MS = 5000
const MAX_BYTES = 2 * 1024 * 1024
const UPSTREAM_CACHE_TTL_S = 15

export const FEED_PATHS: Record<FeedId, string> = {
  '1234567': 'nyct%2Fgtfs',
  ace: 'nyct%2Fgtfs-ace',
  bdfm: 'nyct%2Fgtfs-bdfm',
  g: 'nyct%2Fgtfs-g',
  jz: 'nyct%2Fgtfs-jz',
  nqrw: 'nyct%2Fgtfs-nqrw',
  l: 'nyct%2Fgtfs-l',
  si: 'nyct%2Fgtfs-si',
}

function describe(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200)
}

/** Reads at most MAX_BYTES; a missing or wrong content-length cannot bypass the cap. */
async function readBody(res: Response): Promise<Uint8Array | string> {
  if (!res.body) return 'empty body'
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BYTES) {
      await reader.cancel()
      return `body too large (over ${MAX_BYTES} bytes)`
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function fetchFeed(id: FeedId): Promise<FeedOutcome> {
  let bytes: Uint8Array | string
  try {
    const res = await fetch(BASE_URL + FEED_PATHS[id], {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Shares one upstream fetch per feed across isolates in a colo.
      cf: { cacheTtl: UPSTREAM_CACHE_TTL_S, cacheEverything: true },
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    bytes = await readBody(res)
  } catch (e) {
    if ((e as { name?: unknown } | null)?.name === 'TimeoutError') return { ok: false, error: `timeout after ${TIMEOUT_MS} ms` }
    return { ok: false, error: `fetch failed: ${describe(e)}` }
  }
  if (typeof bytes === 'string') return { ok: false, error: bytes }
  try {
    return { ok: true, message: decodeFeed(bytes) }
  } catch (e) {
    return { ok: false, error: `decode failed: ${describe(e)}` }
  }
}

/** Never rejects: every failure becomes an `ok: false` outcome for that feed. */
export async function fetchAllFeeds(): Promise<Record<FeedId, FeedOutcome>> {
  const outcomes = await Promise.all(FEED_IDS.map(fetchFeed))
  return Object.fromEntries(FEED_IDS.map((id, i) => [id, outcomes[i]])) as Record<FeedId, FeedOutcome>
}

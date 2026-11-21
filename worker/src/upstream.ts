import { decodeFeed } from './decode'
import { FEED_IDS, type FeedId } from './schema'
import type { FeedOutcome } from './transform'

const BASE_URL = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/'
const TIMEOUT_MS = 5000
const MAX_BYTES = 2 * 1024 * 1024

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

async function readBody(res: Response): Promise<Uint8Array | string> {
  const declared = Number(res.headers.get('content-length'))
  if (declared > MAX_BYTES) return `body too large (${declared} bytes)`
  const bytes = new Uint8Array(await res.arrayBuffer())
  return bytes.byteLength > MAX_BYTES ? `body too large (${bytes.byteLength} bytes)` : bytes
}

async function fetchFeed(id: FeedId): Promise<FeedOutcome> {
  let bytes: Uint8Array | string
  try {
    const res = await fetch(BASE_URL + FEED_PATHS[id], { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    bytes = await readBody(res)
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') return { ok: false, error: `timeout after ${TIMEOUT_MS} ms` }
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

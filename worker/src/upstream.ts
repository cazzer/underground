import { ENE_TTL_MS, RT_TTL_MS } from './cache'
import { decodeFeed } from './decode'
import { FEED_IDS, type FeedId } from './schema'
import type { FeedOutcome } from './transform'

const BASE_URL = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/'
const TIMEOUT_MS = 5000
const MAX_BYTES = 2 * 1024 * 1024

const ENE_PATH = 'nyct%2Fnyct_ene.json'

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

type BytesOutcome =
  | { ok: true; bytes: Uint8Array; cacheStatus: string | null }
  | { ok: false; error: string; cacheStatus: string | null }

/** Never rejects. Shares one upstream fetch per path across isolates in a colo; errors are not cached. */
async function fetchBytes(path: string, cacheTtlS: number): Promise<BytesOutcome> {
  let bytes: Uint8Array | string
  let cacheStatus: string | null = null
  try {
    const res = await fetch(BASE_URL + path, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cf: { cacheTtlByStatus: { '200-299': cacheTtlS, '400-599': 0 }, cacheEverything: true },
    })
    cacheStatus = res.headers.get('cf-cache-status')
    if (!res.ok) {
      await res.body?.cancel()
      return { ok: false, error: `HTTP ${res.status}`, cacheStatus }
    }
    bytes = await readBody(res)
  } catch (e) {
    if ((e as { name?: unknown } | null)?.name === 'TimeoutError') return { ok: false, error: `timeout after ${TIMEOUT_MS} ms`, cacheStatus }
    return { ok: false, error: `fetch failed: ${describe(e)}`, cacheStatus }
  }
  if (typeof bytes === 'string') return { ok: false, error: bytes, cacheStatus }
  return { ok: true, bytes, cacheStatus }
}

async function fetchFeed(id: FeedId): Promise<FeedOutcome> {
  const got = await fetchBytes(FEED_PATHS[id], RT_TTL_MS / 1000)
  if (!got.ok) return got
  try {
    return { ok: true, message: decodeFeed(got.bytes), cacheStatus: got.cacheStatus }
  } catch (e) {
    return { ok: false, error: `decode failed: ${describe(e)}`, cacheStatus: got.cacheStatus }
  }
}

/** Never rejects: every failure becomes an `ok: false` outcome for that feed. */
export async function fetchAllFeeds(): Promise<Record<FeedId, FeedOutcome>> {
  const outcomes = await Promise.all(FEED_IDS.map(fetchFeed))
  return Object.fromEntries(FEED_IDS.map((id, i) => [id, outcomes[i]])) as Record<FeedId, FeedOutcome>
}

export type EneFetch =
  | { ok: true; json: unknown; cacheStatus: string | null }
  | { ok: false; error: string; cacheStatus: string | null }

/**
 * The outage list as parsed JSON. Never rejects. The upstream content-type is the literal
 * `${header.s3FileType}` (broken on their side), so it is ignored; the body is parsed as UTF-8 JSON.
 */
export async function fetchEne(): Promise<EneFetch> {
  const got = await fetchBytes(ENE_PATH, ENE_TTL_MS / 1000)
  if (!got.ok) return got
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(got.bytes)
    return { ok: true, json: JSON.parse(text), cacheStatus: got.cacheStatus }
  } catch (e) {
    return { ok: false, error: `parse failed: ${describe(e)}`, cacheStatus: got.cacheStatus }
  }
}

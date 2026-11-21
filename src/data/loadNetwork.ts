import { buildNetwork, type Network } from '../lib/network'
import type { DataFile, RoutesFile, ShapesFile, StationsFile } from './schema'

/**
 * Checks the outer shape of a fetched data file: an object with a string `feedVersion` and an
 * array under `key`. Entries are trusted; the pipeline that writes them is typed against schema.ts.
 */
export function expectDataFile<T extends DataFile>(raw: unknown, key: string, url: string): T {
  if (
    typeof raw !== 'object' ||
    raw === null ||
    typeof (raw as Partial<DataFile>).feedVersion !== 'string' ||
    !Array.isArray((raw as Record<string, unknown>)[key])
  ) {
    throw new Error(`${url}: not a ${key} file`)
  }
  return raw as T
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  // no-cache revalidates (cheap 304s), so a stale cached file can't mix two builds.
  const res = await fetch(url, { signal, cache: 'no-cache' })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  try {
    return await res.json()
  } catch (err) {
    if (signal.aborted) throw err
    throw new Error(`${url}: invalid JSON (${err instanceof Error ? err.message : String(err)})`)
  }
}

/** Fetches stations, routes, and shapes from `<baseUrl>data/` in parallel and builds the network. */
export async function loadNetwork(baseUrl: string, signal: AbortSignal): Promise<Network> {
  async function file<T extends DataFile>(key: string): Promise<T> {
    const url = `${baseUrl}data/${key}.json`
    return expectDataFile<T>(await fetchJson(url, signal), key, url)
  }
  const [stations, routes, shapes] = await Promise.all([
    file<StationsFile>('stations'),
    file<RoutesFile>('routes'),
    file<ShapesFile>('shapes'),
  ])
  return buildNetwork(stations, routes, shapes)
}

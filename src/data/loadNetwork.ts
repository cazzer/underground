import { buildNetwork, type Network } from '../lib/network'
import type { DataFile, RoutesFile, ShapesFile, StationId, StationsFile } from './schema'
import type { StationDepthsFile } from './stationSchema'

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

/** Like `expectDataFile`, but `key` holds an object (a record) rather than an array. */
export function expectDataRecord<T extends DataFile>(raw: unknown, key: string, url: string): T {
  const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)[key] : undefined
  if (
    typeof (raw as Partial<DataFile> | null)?.feedVersion !== 'string' ||
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error(`${url}: not a ${key} file`)
  }
  return raw as T
}

/** Checks station-depths.json's outer shape: an ODbL file with a `stations` array. Entries are trusted (see above). */
export function expectStationDepths(raw: unknown, url: string): StationDepthsFile {
  const file = raw as Partial<StationDepthsFile> | null
  if (typeof raw !== 'object' || raw === null || file?.license !== 'ODbL-1.0' || !Array.isArray(file.stations)) {
    throw new Error(`${url}: not a station-depths file`)
  }
  return raw as StationDepthsFile
}

/** Fetches and parses JSON, throwing `<url>: HTTP <status>` or `<url>: invalid JSON (...)`. */
export async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  // no-cache revalidates (cheap 304s), so a stale cached file can't mix two builds.
  const res = await fetch(url, { signal, cache: 'no-cache' })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  try {
    return await res.json()
  } catch (err) {
    if (signal?.aborted) throw err
    throw new Error(`${url}: invalid JSON (${err instanceof Error ? err.message : String(err)})`)
  }
}

/** The raw files the realtime loader joins against (it needs their ids, stops and points, not the render model). */
export interface NetworkFiles {
  stations: StationsFile
  shapes: ShapesFile
}

export interface LoadedNetwork {
  network: Network
  files: NetworkFiles
}

/**
 * `base` plus the stations of `extra` it doesn't already have (a station in both keeps `base`'s entry and is listed
 * in `shadowed`), sorted by station id; credits are `base`'s followed by `extra`'s new ones. Pure.
 */
export function mergeStationDepths(
  base: StationDepthsFile,
  extra: StationDepthsFile,
): { depths: StationDepthsFile; shadowed: StationId[] } {
  const have = new Set(base.stations.map((s) => s.stationId))
  const shadowed = extra.stations.filter((s) => have.has(s.stationId)).map((s) => s.stationId)
  const stations = [...base.stations, ...extra.stations.filter((s) => !have.has(s.stationId))]
  stations.sort((a, b) => (a.stationId < b.stationId ? -1 : a.stationId > b.stationId ? 1 : 0))
  const attribution = [...base.attribution, ...extra.attribution.filter((c) => !base.attribution.includes(c))]
  return { depths: { license: base.license, attribution, stations }, shadowed }
}

/**
 * TEMPORARY (generatedLook.ts): stations/depths-generated.json, or null after logging when it is missing or bad
 * (the map then keeps generated stations' tracks at street level). Rejects only when aborted.
 */
async function loadGeneratedDepths(baseUrl: string, signal: AbortSignal): Promise<StationDepthsFile | null> {
  const url = `${baseUrl}data/stations/depths-generated.json`
  try {
    return expectStationDepths(await fetchJson(url, signal), url)
  } catch (err) {
    if (signal.aborted) throw err
    console.error('Failed to load generated station depths; their tracks stay at street level', err)
    return null
  }
}

export interface LoadNetworkOptions {
  /** TEMPORARY (generatedLook.ts): also fetch stations/depths-generated.json. */
  generatedDepths?: boolean
}

/**
 * Fetches stations, routes, shapes, and station depths from `<baseUrl>data/` in parallel and builds the network,
 * drawing each shape `trackOffsetM` right of its travel direction, down to the station depths scaled by `yScale`.
 * With `generatedDepths` (TEMPORARY `?generated=1`) it also fetches stations/depths-generated.json in the same
 * parallel batch and merges it in; that file failing never fails the load.
 */
export async function loadNetwork(
  baseUrl: string,
  trackOffsetM: number,
  yScale: number,
  signal: AbortSignal,
  { generatedDepths = false }: LoadNetworkOptions = {},
): Promise<LoadedNetwork> {
  async function file<T extends DataFile>(key: string): Promise<T> {
    const url = `${baseUrl}data/${key}.json`
    return expectDataFile<T>(await fetchJson(url, signal), key, url)
  }
  const depthsUrl = `${baseUrl}data/station-depths.json`
  const [stations, routes, shapes, authoredDepths, generated] = await Promise.all([
    file<StationsFile>('stations'),
    file<RoutesFile>('routes'),
    file<ShapesFile>('shapes'),
    fetchJson(depthsUrl, signal).then((raw) => expectStationDepths(raw, depthsUrl)),
    generatedDepths ? loadGeneratedDepths(baseUrl, signal) : null,
  ])
  let depths = authoredDepths
  if (generated) {
    const merged = mergeStationDepths(authoredDepths, generated)
    if (merged.shadowed.length > 0) console.warn('Generated depths ignored for stations with authored depths:', merged.shadowed)
    depths = merged.depths
  }
  return { network: buildNetwork(stations, routes, shapes, trackOffsetM, depths, yScale), files: { stations, shapes } }
}

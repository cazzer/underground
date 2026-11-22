import { buildNetwork, type Network } from '../lib/network'
import type { DataFile, RoutesFile, ShapesFile, StationsFile } from './schema'
import type { PackedDepthsFile } from './stationSchema'

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

const DEPTH_COLUMNS = ['station', 'y', 'a', 'h', 'da', 'dh'] as const

/** Checks station-depths.json's outer shape: an ODbL file in packed format 2, with its columns and overrides. Entries are trusted (see above). */
export function expectStationDepths(raw: unknown, url: string): PackedDepthsFile {
  const file = raw as Partial<PackedDepthsFile> | null
  if (
    typeof raw !== 'object' ||
    raw === null ||
    file?.license !== 'ODbL-1.0' ||
    file.format !== 2 ||
    !DEPTH_COLUMNS.every((k) => Array.isArray(file[k])) ||
    typeof file.tracks !== 'object' ||
    file.tracks === null
  ) {
    throw new Error(`${url}: not a station-depths file`)
  }
  return raw as PackedDepthsFile
}

/** A non-OK response from `fetchJson`; the message is `<url>: HTTP <status>`. */
export class HttpError extends Error {
  readonly status: number

  constructor(url: string, status: number) {
    super(`${url}: HTTP ${status}`)
    this.name = 'HttpError'
    this.status = status
  }
}

/** Fetches and parses JSON, throwing an `HttpError` (`<url>: HTTP <status>`) or `<url>: invalid JSON (...)`. */
export async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  // no-cache revalidates (cheap 304s), so a stale cached file can't mix two builds.
  const res = await fetch(url, { signal, cache: 'no-cache' })
  if (!res.ok) throw new HttpError(url, res.status)
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
 * Fetches stations, routes, shapes, and station depths from `<baseUrl>data/` in parallel and builds the network,
 * drawing each shape `trackOffsetM` right of its travel direction, down to the station depths scaled by `yScale`.
 */
export async function loadNetwork(baseUrl: string, trackOffsetM: number, yScale: number, signal: AbortSignal): Promise<LoadedNetwork> {
  async function file<T extends DataFile>(key: string): Promise<T> {
    const url = `${baseUrl}data/${key}.json`
    return expectDataFile<T>(await fetchJson(url, signal), key, url)
  }
  const depthsUrl = `${baseUrl}data/station-depths.json`
  const [stations, routes, shapes, depths] = await Promise.all([
    file<StationsFile>('stations'),
    file<RoutesFile>('routes'),
    file<ShapesFile>('shapes'),
    fetchJson(depthsUrl, signal).then((raw) => expectStationDepths(raw, depthsUrl)),
  ])
  return { network: buildNetwork(stations, routes, shapes, trackOffsetM, depths, yScale), files: { stations, shapes } }
}

import { useEffect, useMemo, useState } from 'react'
import { Color } from 'three'
import { entranceLocal } from '../lib/entranceMarks'
import { entranceTexts, type EntranceText, type NamedLine } from '../lib/entranceText'
import { useFocus } from '../lib/focus'
import type { LineBuffers, Rgb } from '../lib/lineBuffers'
import { toGround, type Ground } from '../lib/projection'
import { streetBuffers } from '../lib/streetBuffers'
import { mergeComplexStreets, streetFileIds } from '../lib/streetMerge'
import { streetLabelSources, type StreetLabelSource } from '../lib/streetRuns'
import { veiledStreetHex } from '../lib/streetVeil'
import { theme } from '../theme'
import { createInteriorCache } from './interiorCache'
import { HttpError } from './loadNetwork'
import { loadStationStreets } from './loadStationStreets'
import { requestDue } from './streetLoadRule'
import type { StationStreets } from './streetSchema'

const BASE_URL = import.meta.env.BASE_URL

/** A labelled entrance (entranceText.ts), with the indexes into `StreetLayer.streets` of the streets it names. */
export interface EntranceLabelSource extends EntranceText {
  streets: number[]
}

/** One station's streets, ready to draw: line buffers in meters from `anchor` (its scene ground point), the street
 *  and entrance labels' sources, every entrance's mark point, and the file itself (its entrances' marks depend on the
 *  interior, drawn later). A complex lead's layer is merged (streetMerge.ts): the lead's lines and anchor, its
 *  members' far entrances added. */
export interface StreetLayer {
  stationId: string
  anchor: Ground
  buffers: LineBuffers
  /** The same streets at the veiled stroke (`veiledStreetHex`, about 1.9:1), drawn above the interior veil. */
  veiledBuffers: LineBuffers
  /** The station's file, or for a complex lead the merged one: its entrances are not in the fetched order (the
   *  lead's, then each added one nearest the lead first) and may lie past `radiusM`. */
  file: StationStreets
  streets: StreetLabelSource[]
  entrances: EntranceLabelSource[]
  /** Every entrance of the file, labelled or not, meters from `anchor`: labels keep clear of their marks. */
  marks: Ground[]
}

function entranceLabels(
  file: StationStreets,
  streets: readonly StreetLabelSource[],
  extraLines: readonly NamedLine[],
): EntranceLabelSource[] {
  const byKey = new Map(streets.map((s, i) => [s.key, i]))
  return entranceTexts(file, extraLines).map((t) => ({
    ...t,
    streets: t.keys.map((k) => byKey.get(k)).filter((i): i is number => i !== undefined),
  }))
}

function buildLayer(id: string, file: StationStreets, extraLines: readonly NamedLine[]): StreetLayer {
  const streets = streetLabelSources(file)
  return {
    stationId: id,
    anchor: toGround(file.anchor),
    buffers: streetBuffers(file, STREET_RGB, BACKGROUND_RGB),
    veiledBuffers: streetBuffers(file, VEILED_RGB, BACKGROUND_RGB),
    file,
    streets,
    entrances: entranceLabels(file, streets, extraLines),
    marks: file.entrances.map((_, i) => entranceLocal(file, i)),
  }
}

// Color(hex) converts sRGB to linear, which is what vertex colors must be.
const STREET_COLOR = new Color(theme.streetStroke)
const STREET_RGB: Rgb = [STREET_COLOR.r, STREET_COLOR.g, STREET_COLOR.b]
const BACKGROUND = new Color(theme.background)
const BACKGROUND_RGB: Rgb = [BACKGROUND.r, BACKGROUND.g, BACKGROUND.b]
const VEILED = new Color(veiledStreetHex(theme.streetStroke, theme.background))
const VEILED_RGB: Rgb = [VEILED.r, VEILED.g, VEILED.b]

/** Raw street files, one fetch per file per page load (null: no file, cached; a failure is evicted and retried). */
const files = createInteriorCache((id) => loadStationStreets(BASE_URL, id))

interface Loaded {
  layer: StreetLayer | null
  /** Members whose file failed (not a 404): the layer lacks their entrances. */
  missing: readonly string[]
  at: number
}

function reasonOf(err: unknown): string {
  return err instanceof HttpError ? `HTTP ${err.status}` : 'network or data error'
}

/**
 * The layer of the street files `ids` (lead first), the buffers built inside the promise so a data error rejects. A
 * lead that fails rejects the layer, as for any station. A member with no file (404, warned by the loader) is skipped;
 * a member that fails otherwise is warned about once (id and reason) and left out, the lead's layer being worth
 * showing without it (`missing`).
 */
async function loadLayer(ids: readonly string[]): Promise<{ layer: StreetLayer | null; missing: string[] }> {
  const [leadResult, ...memberResults] = await Promise.allSettled(ids.map((id) => files.get(id)))
  if (leadResult!.status === 'rejected') throw leadResult!.reason
  const lead = leadResult!.value
  if (!lead) return { layer: null, missing: [] }
  const members: StationStreets[] = []
  const missing: string[] = []
  memberResults.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      if (r.value) members.push(r.value)
      return
    }
    missing.push(ids[i + 1]!)
    console.warn(`Streets of station ${ids[i + 1]} (complex ${ids[0]}) did not load (${reasonOf(r.reason)}); its entrances are left out`, r.reason)
  })
  if (members.length === 0) return { layer: buildLayer(ids[0]!, lead, []), missing }
  const merged = mergeComplexStreets(lead, members)
  return { layer: buildLayer(ids[0]!, merged.file, merged.extraLines), missing }
}

// Layers by key (the file ids joined with '+': station ids are alphanumeric), loads in flight, keys whose last load
// failed (to the failure's time, performance.now() ms), and how many loads of each key have settled.
const loaded = new Map<string, Loaded>()
const pending = new Set<string>()
const failedAt = new Map<string, number>()
const settledCount = new Map<string, number>()
/** Called with a key once a load of it settles: the hooks showing that key re-render. */
const listeners = new Set<(key: string) => void>()

/**
 * Starts the load of `key` when `requestDue` says so (streetLoadRule.ts): not while loading; a layer missing a member
 * once it is PARTIAL_RETRY_MS old, so the next focus retries without a retry storm; a failed key at once; for a
 * view-driven caller (`viewDriven`) either only once VIEW_RETRY_MS old. A retry still missing the same members
 * keeps the old layer object, so nothing rebuilds. A failure is logged here, once per load however many components
 * wait on it, and leaves any older layer in place.
 */
function request(key: string, viewDriven: boolean): void {
  const hit = loaded.get(key)
  if (!requestDue(hit && { missing: hit.missing.length, at: hit.at }, pending.has(key), failedAt.get(key), performance.now(), viewDriven)) return
  pending.add(key)
  const ids = key.split('+')
  loadLayer(ids)
    .then(
      (r) => {
        const same = hit && hit.missing.length > 0 && hit.missing.join() === r.missing.join()
        loaded.set(key, { layer: same ? hit.layer : r.layer, missing: r.missing, at: performance.now() })
        failedAt.delete(key)
      },
      (err: unknown) => {
        console.error(`Failed to load the streets of station ${ids[0]}${ids.length > 1 ? ` (complex ${ids.join(', ')})` : ''}`, err)
        failedAt.set(key, performance.now())
      },
    )
    .finally(() => {
      pending.delete(key)
      settledCount.set(key, (settledCount.get(key) ?? 0) + 1)
      for (const listen of listeners) listen(key)
    })
}

/** The store key of a station's layer: its street file ids, lead first. */
function layerKey(stationId: string, membersOf: (id: string) => readonly string[]): string {
  return streetFileIds(stationId, membersOf(stationId)).join('+')
}

/** The store key of a station's layer; null for no station. */
function useLayerKey(stationId: string | null): string | null {
  const { membersOf } = useFocus()
  return stationId === null ? null : layerKey(stationId, membersOf)
}

/** How many loads of each key have settled, joined: it changes whenever a load of any of them settles. */
function settledSignature(keys: readonly string[]): string {
  return keys.map((k) => settledCount.get(k) ?? 0).join(',')
}

const NO_KEYS: readonly string[] = Object.freeze([])

/**
 * Requests `keys` on mount and on a change of them, and re-renders when a load of any of them settles (a retry by
 * another hook too). Returns their settled signature at render, for a memo over what they hold.
 */
function useRequestedKeys(keys: readonly string[], viewDriven: boolean): string {
  const [, setSettles] = useState(0)
  const joined = keys.join(',')
  const signature = settledSignature(keys)
  useEffect(() => {
    if (joined === '') return
    const watched = joined.split(',')
    const listen = (settledKey: string) => {
      if (watched.includes(settledKey)) setSettles((n) => n + 1)
    }
    listeners.add(listen)
    for (const key of watched) request(key, viewDriven)
    // A load that settled between this render and now was announced to nobody.
    if (settledSignature(watched) !== signature) setSettles((n) => n + 1)
    return () => {
      listeners.delete(listen)
    }
    // Only a change of keys asks again; `signature` is the render's snapshot and `viewDriven` is fixed per caller.
  }, [joined])
  return signature
}

/** The focus path's request: a failed key is asked again at once. */
function useRequested(key: string | null): void {
  useRequestedKeys(key === null ? NO_KEYS : [key], false)
}

/**
 * The focused station's streets, once loaded; null with no focus or no street file; undefined while loading or after
 * a failure (logged; the next focus retries). Nothing is fetched until a station is focused: for a complex's lead
 * (`membersOf`) that is its members' files too, which are part of the station the user opened. A member that fails
 * leaves its entrances out of the layer, and the next focus tries it again.
 */
export function useStationStreets(stationId: string | null): StreetLayer | null | undefined {
  const key = useLayerKey(stationId)
  useRequested(key)
  return key === null ? null : loaded.get(key)?.layer
}

/**
 * A station's street layer and whether its load has settled (loaded, no file, or failed), for a caller that must tell
 * loading apart from missing. Fetches as `useStationStreets` does, from the same store (a failure is logged once).
 */
export function useStationStreetsLoad(stationId: string | null): { layer: StreetLayer | null; settled: boolean } {
  const key = useLayerKey(stationId)
  useRequested(key)
  if (key === null) return { layer: null, settled: true }
  const hit = loaded.get(key)
  return { layer: hit?.layer ?? null, settled: hit !== undefined || failedAt.has(key) }
}

/**
 * Warms the street layers of `stationIds` (leads; o3r.8's prefetch, from the camera-driven prefetch set only): the
 * same keys and view-driven retry rule as `useStreetLayers`, so a layer that later draws is already built. A complex
 * lead's member files go with it. Starts nothing for a key already loaded or loading.
 */
export function prefetchStreetLayers(stationIds: readonly string[], membersOf: (id: string) => readonly string[]): void {
  for (const id of stationIds) request(layerKey(id, membersOf), true)
}

const NO_LAYERS: readonly StreetLayer[] = Object.freeze([])

/**
 * The loaded layers of `stationIds` (leads, and only from o3r.2's view set: `viewStreetIds`), in order; loading,
 * no-file and failed ones left out. Same store and keys as useStationStreets (a complex lead loads and merges its
 * members' files, part of the station in view), so focusing one reuses its layer. A failed one, or one missing a
 * member, is asked again only once VIEW_RETRY_MS old, on a change of the set. The list keeps its identity until a key changes or a load of one
 * settles.
 */
export function useStreetLayers(stationIds: readonly string[]): readonly StreetLayer[] {
  const { membersOf } = useFocus()
  const joinedIds = stationIds.join(',')
  const keys = useMemo(
    () => (joinedIds === '' ? NO_KEYS : joinedIds.split(',').map((id) => layerKey(id, membersOf))),
    [joinedIds, membersOf],
  )
  const signature = useRequestedKeys(keys, true)
  return useMemo(() => {
    const out = keys.flatMap((k) => loaded.get(k)?.layer ?? [])
    return out.length > 0 ? out : NO_LAYERS
    // `signature` changes whenever a load of one of the keys settles, the only time `loaded` changes for them.
  }, [keys, signature])
}

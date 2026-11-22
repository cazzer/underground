import { useEffect, useState } from 'react'
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

/** How old a layer that lacks a failed member's entrances is before a focus tries that member again. */
const PARTIAL_RETRY_MS = 5000

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

// Layers by key (the file ids joined with '+': station ids are alphanumeric), loads in flight, keys whose last load failed.
const loaded = new Map<string, Loaded>()
const pending = new Set<string>()
const failed = new Set<string>()
/** Called with a key once a load of it settles: the hooks showing that key re-render. */
const listeners = new Set<(key: string) => void>()

/**
 * Starts the load of `key` unless it is loaded or loading. A layer missing a member is tried again when a hook asks
 * for it (mount or key change) once it is PARTIAL_RETRY_MS old, so the next focus retries without a retry storm. A retry
 * still missing the same members keeps the old layer object, so nothing rebuilds. A failure is
 * logged here, once per load however many components wait on it, and leaves any older layer in place.
 */
function request(key: string): void {
  const hit = loaded.get(key)
  if (pending.has(key) || (hit && !(hit.missing.length > 0 && performance.now() - hit.at >= PARTIAL_RETRY_MS))) return
  pending.add(key)
  const ids = key.split('+')
  loadLayer(ids)
    .then(
      (r) => {
        const same = hit && hit.missing.length > 0 && hit.missing.join() === r.missing.join()
        loaded.set(key, { layer: same ? hit.layer : r.layer, missing: r.missing, at: performance.now() })
        failed.delete(key)
      },
      (err: unknown) => {
        console.error(`Failed to load the streets of station ${ids[0]}${ids.length > 1 ? ` (complex ${ids.join(', ')})` : ''}`, err)
        failed.add(key)
      },
    )
    .finally(() => {
      pending.delete(key)
      for (const listen of listeners) listen(key)
    })
}

/** The store key of a station's layer: its street file ids, lead first; null for no station. */
function useLayerKey(stationId: string | null): string | null {
  const { membersOf } = useFocus()
  return stationId === null ? null : streetFileIds(stationId, membersOf(stationId)).join('+')
}

/** Requests `key` on mount and on a change of it, and re-renders when a load of it settles (a retry by another hook too). */
function useRequested(key: string | null): void {
  const [, setSettles] = useState(0)
  const seen = key === null ? undefined : loaded.get(key)
  const failedAtRender = key !== null && failed.has(key)
  useEffect(() => {
    if (key === null) return
    const listen = (settledKey: string) => {
      if (settledKey === key) setSettles((n) => n + 1)
    }
    listeners.add(listen)
    request(key)
    // A load that settled between this render and now was announced to nobody.
    if (loaded.get(key) !== seen || failed.has(key) !== failedAtRender) listen(key)
    return () => {
      listeners.delete(listen)
    }
  }, [key])
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
  return { layer: hit?.layer ?? null, settled: hit !== undefined || failed.has(key) }
}

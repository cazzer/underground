import { useEffect, useState } from 'react'
import { Color } from 'three'
import { entranceLocal } from '../lib/entranceMarks'
import type { LineBuffers, Rgb } from '../lib/lineBuffers'
import { toGround, type Ground } from '../lib/projection'
import { streetBuffers } from '../lib/streetBuffers'
import { entranceTexts, type EntranceText } from '../lib/entranceText'
import { streetLabelSources, type StreetLabelSource } from '../lib/streetRuns'
import { veiledStreetHex } from '../lib/streetVeil'
import { theme } from '../theme'
import { createInteriorCache } from './interiorCache'
import { loadStationStreets } from './loadStationStreets'
import type { StationStreets } from './streetSchema'

const BASE_URL = import.meta.env.BASE_URL

/** A labelled entrance (entranceText.ts), with the indexes into `StreetLayer.streets` of the streets it names. */
export interface EntranceLabelSource extends EntranceText {
  streets: number[]
}

/** One station's streets, ready to draw: line buffers in meters from `anchor` (its scene ground point), the street
 *  and entrance labels' sources, every entrance's mark point, and the file itself (its entrances' marks depend on the
 *  interior, drawn later). */
export interface StreetLayer {
  stationId: string
  anchor: Ground
  buffers: LineBuffers
  /** The same streets at the veiled stroke (`veiledStreetHex`, about 1.9:1), drawn above the interior veil. */
  veiledBuffers: LineBuffers
  file: StationStreets
  streets: StreetLabelSource[]
  entrances: EntranceLabelSource[]
  /** Every entrance of the file, labelled or not, meters from `anchor`: labels keep clear of their marks. */
  marks: Ground[]
}

function entranceLabels(file: StationStreets, streets: readonly StreetLabelSource[]): EntranceLabelSource[] {
  const byKey = new Map(streets.map((s, i) => [s.key, i]))
  return entranceTexts(file).map((t) => ({
    ...t,
    streets: t.keys.map((k) => byKey.get(k)).filter((i): i is number => i !== undefined),
  }))
}

function buildLayer(id: string, file: StationStreets): StreetLayer {
  const streets = streetLabelSources(file)
  return {
    stationId: id,
    anchor: toGround(file.anchor),
    buffers: streetBuffers(file, STREET_RGB, BACKGROUND_RGB),
    veiledBuffers: streetBuffers(file, VEILED_RGB, BACKGROUND_RGB),
    file,
    streets,
    entrances: entranceLabels(file, streets),
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

/**
 * One fetch per station per page load. The buffers are built inside the promise, so a data error rejects (and is
 * evicted, so the next focus retries). A station with no street file resolves to null, which stays cached.
 */
const cache = createInteriorCache((id) =>
  loadStationStreets(BASE_URL, id)
    .then((file): StreetLayer | null => file && buildLayer(id, file))
    .catch((err: unknown) => {
      // Logged here, once per load, however many components (the scene, the panel) wait on it.
      console.error(`Failed to load the streets of station ${id}`, err)
      throw err
    }),
)

/**
 * The focused station's streets, once loaded; null while loading, with no focus, with no street file, or after a
 * failure (logged). Nothing is fetched until a station is focused.
 */
export function useStationStreets(stationId: string | null): StreetLayer | null {
  // The last station whose load settled: set only to re-render once the cache holds it.
  const [, setLoadedId] = useState<string | null>(null)

  useEffect(() => {
    if (!stationId || cache.peek(stationId) !== undefined) return
    let cancelled = false
    // Not aborted on refocus: a small file may as well finish and land in the cache.
    cache.get(stationId).then(
      () => {
        if (!cancelled) setLoadedId(stationId)
      },
      () => {
        // The loader logged it; the load is evicted, so the next focus retries.
      },
    )
    return () => {
      cancelled = true
    }
  }, [stationId])

  return (stationId && cache.peek(stationId)) || null
}

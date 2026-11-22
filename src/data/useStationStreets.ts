import { useEffect, useState } from 'react'
import { Color } from 'three'
import type { LineBuffers, Rgb } from '../lib/lineBuffers'
import { toGround, type Ground } from '../lib/projection'
import { streetBuffers } from '../lib/streetBuffers'
import { theme } from '../theme'
import { createInteriorCache } from './interiorCache'
import { loadStationStreets } from './loadStationStreets'

const BASE_URL = import.meta.env.BASE_URL

/** One station's streets, ready to draw: line buffers in meters from `anchor` (its scene ground point). */
export interface StreetLayer {
  stationId: string
  anchor: Ground
  buffers: LineBuffers
}

// Color(hex) converts sRGB to linear, which is what vertex colors must be.
const STREET_COLOR = new Color(theme.streetStroke)
const STREET_RGB: Rgb = [STREET_COLOR.r, STREET_COLOR.g, STREET_COLOR.b]
const BACKGROUND = new Color(theme.background)
const BACKGROUND_RGB: Rgb = [BACKGROUND.r, BACKGROUND.g, BACKGROUND.b]

/**
 * One fetch per station per page load. The buffers are built inside the promise, so a data error rejects (and is
 * evicted, so the next focus retries). A station with no street file resolves to null, which stays cached.
 */
const cache = createInteriorCache((id) =>
  loadStationStreets(BASE_URL, id).then(
    (file): StreetLayer | null =>
      file && { stationId: id, anchor: toGround(file.anchor), buffers: streetBuffers(file, STREET_RGB, BACKGROUND_RGB) },
  ),
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
      (err: unknown) => {
        console.error(`Failed to load the streets of station ${stationId}`, err)
      },
    )
    return () => {
      cancelled = true
    }
  }, [stationId])

  return (stationId && cache.peek(stationId)) || null
}

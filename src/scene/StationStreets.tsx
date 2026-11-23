import { Fragment, useEffect, useMemo, useRef } from 'react'
import { interiorCovers, viewStreetInterior, type IndexLoad } from '../data/interiorLoad'
import { useStationStreets, useStreetLayers, type StreetLayer } from '../data/useStationStreets'
import type { StreetMask } from '../lib/basemap/streetMask'
import type { ExitLabel } from '../lib/exitView'
import { useFocus } from '../lib/focus'
import type { Insets } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import type { LabelBlockers } from '../lib/labelBlockers'
import type { Network } from '../lib/network'
import { streetCells } from '../lib/streetCells'
import type { EmphasisLevels } from '../lib/tripEmphasis'
import { MAX_VIEW_STREETS, viewStreetIds } from '../lib/viewStations'
import type { InteriorModel } from './interiorModel'
import { StreetLabels } from './StreetLabels'
import { StreetLines } from './StreetLines'
import type { CoveredStation } from './useSceneInteriors'

interface StationStreetsProps {
  /** The focused station's interior, once loaded: its entrances get no second mark. */
  interior: InteriorModel | null
  /** The focused station has an interior still loading: no marks yet, so none flash before it lands. */
  interiorPending: boolean
  /** The station leads in view (o3r.2's set, focused first; empty from REVEAL_FAR out and under the location cap). */
  view: readonly string[]
  /** The interiors drawn now (useSceneInteriors): a station in view takes the one covering it. */
  drawn: readonly InteriorModel[]
  /** The view interior files requested, loaded or not: a station in view waits on its marks while its file loads. */
  viewFiles: readonly string[]
  /** Stations another drawn interior stands in for: the focused labels ignore a marker it has faded out. */
  covered: readonly CoveredStation[]
  /** Which stations have an interior file. */
  index: IndexLoad
  /** Look A's screen veil is up (any interior drawn, the focused one's or one in view): the streets rest above it, faint. */
  veiled: boolean
  insets: Insets
  panel: ScreenRect | null
  /** The level labels' screen rects, which the street labels keep clear of. */
  labelBlockers: LabelBlockers
  network: Network
  /** Each drawn layer claims a slot, so the basemap's roads give way inside its radius (Basemap.tsx). */
  mask: StreetMask
  /** The entrances of the trip's way out and way in, which the focused labels place first; empty for none. */
  pathLabels: readonly ExitLabel[]
  /** The trip emphasis (SubwayLines, -0.25): the street lines dim with the route lines by its `networkDim`. */
  tripLevels: EmphasisLevels
}

/**
 * The streets and entrance marks of the focused station (fetched on focus) and of up to MAX_VIEW_STREETS - 1 more
 * station leads in view (o3r.5; fetched only for o3r.2's camera-driven set, `useStreetLayers`), focused first. Each
 * is a StreetLines keyed by station that draws only its power cell where layers overlap (streetCells.ts), so a street
 * two files hold draws once. Only the focused one is labelled (StreetLabels). All fade in with the interior reveal.
 */
export function StationStreets({
  interior,
  interiorPending,
  view,
  drawn,
  viewFiles,
  covered,
  index,
  veiled,
  insets,
  panel,
  labelBlockers,
  network,
  mask,
  pathLabels,
  tripLevels,
}: StationStreetsProps) {
  const { focusedId } = useFocus()
  const focusedLayer = useStationStreets(focusedId)
  const otherIds = useMemo(() => viewStreetIds(view, focusedId), [view, focusedId])
  const others = useStreetLayers(otherIds)
  const layers = useMemo(() => {
    const out: StreetLayer[] = focusedLayer ? [focusedLayer] : []
    for (const l of others) {
      if (out.length >= MAX_VIEW_STREETS) break
      if (!out.some((o) => o.stationId === l.stationId)) out.push(l)
    }
    return out
  }, [focusedLayer, others])
  const cells = useMemo(
    () => streetCells(layers.map((l) => ({ id: l.stationId, x: l.anchor.x, z: l.anchor.z, radiusM: l.file.radiusM }))),
    [layers],
  )

  const ids = useRef<string[]>([])
  useEffect(() => {
    ids.current = layers.map((l) => l.stationId)
  }, [layers])
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__underground = { ...window.__underground, streetLayers: () => [...ids.current] }
    return () => {
      if (window.__underground) delete window.__underground.streetLayers
    }
  }, [])

  return layers.map((layer, i) => {
    const isFocused = layer === focusedLayer
    // A complex's interior covers every member: focused on any of them, it is this station's.
    const own = isFocused && interiorCovers(interior, layer.stationId) ? interior : null
    const rules = isFocused
      ? { interior: own, pending: interiorPending, clipped: !own && !interiorPending }
      : viewStreetInterior(layer.stationId, drawn, viewFiles, index)
    return (
      <Fragment key={layer.stationId}>
        <StreetLines
          layer={layer}
          interior={rules.interior}
          interiorPending={rules.pending}
          clipped={rules.clipped}
          cell={cells[i]!}
          veiled={veiled}
          network={network}
          mask={mask}
          tripLevels={tripLevels}
        />
        {isFocused && (
          <StreetLabels
            layer={layer}
            interior={own}
            interiorPending={interiorPending}
            insets={insets}
            panel={panel}
            labelBlockers={labelBlockers}
            network={network}
            pathLabels={pathLabels}
            covered={covered}
          />
        )}
      </Fragment>
    )
  })
}

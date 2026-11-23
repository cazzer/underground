import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { interiorCovers, viewStreetInterior, type IndexLoad } from '../data/interiorLoad'
import { useStationStreets, useStreetLayers, type StreetLayer } from '../data/useStationStreets'
import { MASK_N, type StreetMask } from '../lib/basemap/streetMask'
import type { ExitLabel } from '../lib/exitView'
import { useFocus } from '../lib/focus'
import type { Insets } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import type { LabelBlockers } from '../lib/labelBlockers'
import type { Network } from '../lib/network'
import { admitShown, newPresence, type Presence } from '../lib/presence'
import { NO_CELL, streetCells } from '../lib/streetCells'
import type { EmphasisLevels } from '../lib/tripEmphasis'
import { MAX_VIEW_STREETS, viewStreetIds } from '../lib/viewStations'
import type { PresenceStore } from './InteriorPresence'
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
  /** The interiors shown now, drawn or fading out (useSceneInteriors): a station in view takes the one covering it. */
  shownInteriors: readonly InteriorModel[]
  /** Each shown interior's presence, by file id. */
  interiorPresences: ReadonlyMap<string, Presence>
  /** The view interior files requested, loaded or not: a station in view waits on its marks while its file loads. */
  viewFiles: readonly string[]
  /** Stations another drawn interior stands in for: the focused labels ignore a marker it has faded out. */
  covered: readonly CoveredStation[]
  /** Which stations have an interior file. */
  index: IndexLoad
  /** The interiors' presences: the veil's drawn share picks each layer's stroke. */
  veil: PresenceStore
  insets: Insets
  panel: ScreenRect | null
  /** The level labels' screen rects, which the street labels keep clear of. */
  labelBlockers: LabelBlockers
  network: Network
  /** Each mounted layer claims a slot, so the basemap's roads give way inside its radius (Basemap.tsx). */
  mask: StreetMask
  /** The entrances of the trip's way out and way in, which the focused labels place first; empty for none. */
  pathLabels: readonly ExitLabel[]
  /** The trip emphasis (SubwayLines, -0.25): the street lines dim with the route lines by its `networkDim`. */
  tripLevels: EmphasisLevels
}

/** Every entrance mark of the layers, scene ground x, z pairs; null for none. */
function marksOf(layers: readonly StreetLayer[]): Float32Array | null {
  const n = layers.reduce((sum, l) => sum + l.marks.length, 0)
  if (n === 0) return null
  const out = new Float32Array(2 * n)
  let k = 0
  for (const l of layers) {
    for (const m of l.marks) {
      out[k++] = l.anchor.x + m.x
      out[k++] = l.anchor.z + m.z
    }
  }
  return out
}

/**
 * The streets and entrance marks of the focused station (fetched on focus) and of up to MAX_VIEW_STREETS - 1 more
 * station leads in view (o3r.5; fetched only for o3r.2's camera-driven set, `useStreetLayers`), focused first. Each
 * is a StreetLines keyed by station that eases in and out with its own presence (a leaving one stays mounted, holding
 * its mask slot, until faded; a joining one waits while the slots are full, `admitShown`) and, once settled, draws only
 * its power cell where layers overlap (streetCells.ts), so a street two files hold draws once. Only the focused one is labelled
 * (StreetLabels), clear of the others' marks.
 */
export function StationStreets(props: StationStreetsProps) {
  const { interior, interiorPending, view, shownInteriors, interiorPresences, viewFiles, covered, index, veil } = props
  const { insets, panel, labelBlockers, network, mask, pathLabels, tripLevels } = props
  const { focusedId } = useFocus()
  const focusedLayer = useStationStreets(focusedId)
  const otherIds = useMemo(() => viewStreetIds(view, focusedId), [view, focusedId])
  const others = useStreetLayers(otherIds)
  const wanted = useMemo(() => {
    const out: StreetLayer[] = focusedLayer ? [focusedLayer] : []
    for (const l of others) {
      if (out.length >= MAX_VIEW_STREETS) break
      if (!out.some((o) => o.stationId === l.stationId)) out.push(l)
    }
    return out
  }, [focusedLayer, others])

  // The mounted layers: the wanted ones admitted while the slots allow, then the leaving ones until faded (adjusted during render).
  const [shownState, setShown] = useState<readonly StreetLayer[]>([])
  const { drawn, shown } = admitShown(shownState, wanted, MASK_N)
  if (shown !== shownState) setShown(shown)
  const presences = useState(() => new Map<string, Presence>())[0]
  for (const l of shown) if (!presences.has(l.stationId)) presences.set(l.stationId, newPresence(l.stationId))
  useLayoutEffect(() => {
    for (const id of [...presences.keys()]) if (!shown.some((l) => l.stationId === id)) presences.delete(id)
    for (const l of shown) presences.get(l.stationId)!.target = drawn.includes(l) ? 1 : 0
  })
  const onFaded = useCallback(
    (id: string) => setShown((s) => (presences.get(id)?.target === 0 ? s.filter((l) => l.stationId !== id) : s)),
    [presences],
  )
  // Bumped when a joining layer's presence reaches 1, so the cells take it in.
  const [, setSettles] = useState(0)
  const onSettled = useCallback(() => setSettles((n) => n + 1), [])

  const drawnKey = drawn.map((l) => l.stationId).join(',')
  // The cells are cut among the settled layers (drawn, fully in). A joining or leaving layer draws its whole disc while
  // it eases, over the settled ones, so no street in the overlap dips or pops: only its faded edge band shows doubled
  // for that moment. A settled layer takes over a leaving one's part at once, and gives up its part to a joining one
  // only once that one is fully in.
  const settled = drawn.filter((l) => {
    const p = presences.get(l.stationId)
    return p !== undefined && p.target === 1 && p.value === 1
  })
  const settledKey = settled.map((l) => l.stationId).join(',')
  const cells = useMemo(() => {
    const list = streetCells(settled.map((l) => ({ id: l.stationId, x: l.anchor.x, z: l.anchor.z, radiusM: l.file.radiusM })))
    return new Map(settled.map((l, i) => [l.stationId, list[i]!]))
    // The anchors and radii are fixed per station: the ids say it all.
  }, [settledKey])
  const neighbourMarks = useMemo(() => marksOf(drawn.filter((l) => l !== focusedLayer)), [drawnKey, focusedLayer])

  const ids = useRef<string[]>([])
  useEffect(() => {
    ids.current = drawn.map((l) => l.stationId)
  }, [drawnKey])
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__underground = { ...window.__underground, streetLayers: () => [...ids.current] }
    return () => {
      if (window.__underground) delete window.__underground.streetLayers
    }
  }, [])

  return shown.map((layer) => {
    const isFocused = layer === focusedLayer && drawn.includes(layer)
    // A complex's interior covers every member: focused on any of them, it is this station's.
    const own = isFocused && interiorCovers(interior, layer.stationId) ? interior : null
    const rules = isFocused
      ? { interior: own, pending: interiorPending, clipped: !own && !interiorPending }
      : viewStreetInterior(layer.stationId, shownInteriors, viewFiles, index)
    const presence = presences.get(layer.stationId)!
    return (
      <Fragment key={layer.stationId}>
        <StreetLines
          layer={layer}
          focused={isFocused}
          presence={presence}
          onFaded={onFaded}
          onSettled={onSettled}
          interior={rules.interior}
          interiorPresence={rules.interior ? (interiorPresences.get(rules.interior.stationId) ?? null) : null}
          interiorPending={rules.pending}
          clipped={rules.clipped}
          cell={cells.get(layer.stationId) ?? NO_CELL}
          veil={veil}
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
            neighbourMarks={neighbourMarks}
            presence={presence}
          />
        )}
      </Fragment>
    )
  })
}

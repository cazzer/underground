import { useThree } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import { interiorStationIds } from '../data/interiorLoad'
import { coveredRow } from '../lib/amenityCovered'
import type { Insets } from '../lib/framing'
import { FOCUS_FRAME_PAD_M, FOOTPRINT_PAD_M } from '../lib/interiorFootprint'
import { interiorFreeRect, LANDING_DISTANCE, type ScreenRect } from '../lib/interiorCamera'
import type { Presence } from '../lib/presence'
import type { AmenityFrame } from './amenityFrame'
import { markSizesInto, newMarkSizes } from './amenitySizes'
import type { InteriorModel } from './interiorModel'

/** How far a covered row keeps past the pick footprint: out to the focused interior's frame loop. */
const FRAME_EXTRA_M = FOCUS_FRAME_PAD_M - FOOTPRINT_PAD_M
/** The camera's field of view (Scene's Canvas). */
const FOV_DEG = 35

/**
 * Which shown interior covers each mark's station (its presence) and where the mark's row goes past that hull
 * (coveredRow: just off the hull plus FRAME_EXTRA_M, on a side a landing on the interior shows in the free rect),
 * written into `frame` before the next frame. Rechosen when the shown interiors or the canvas size change; the insets
 * and panel are read then, not watched, so a panel growing never moves a row.
 */
export function useAmenityCovers(
  frame: AmenityFrame,
  shown: readonly InteriorModel[],
  presences: ReadonlyMap<string, Presence>,
  insets: Insets,
  panel: ScreenRect | null,
): void {
  const width = useThree((s) => s.size.width)
  const height = useThree((s) => s.size.height)
  const hud = useRef({ insets, panel })
  hud.current = { insets, panel }
  useLayoutEffect(() => {
    const viewport = { width, height }
    const view = { viewport, free: interiorFreeRect(viewport, hud.current.insets, hud.current.panel), fovDeg: FOV_DEG }
    const sizes = markSizesInto(newMarkSizes(), LANDING_DISTANCE, false)
    const covers = shown.map((m) => ({ ids: new Set(interiorStationIds(m)), model: m }))
    const rows = new Map<string, ReturnType<typeof coveredRow>>()
    frame.marks.forEach((mark, i) => {
      const hit = covers.find((c) => mark.memberIds.some((id) => c.ids.has(id)))
      frame.cover[i] = hit ? (presences.get(hit.model.stationId) ?? null) : null
      let row = hit ? rows.get(mark.stationId) : undefined
      if (hit && !row) {
        const m = hit.model
        row = coveredRow(m.footprint, m.focusAnchor, m.axis, mark.n, sizes, FRAME_EXTRA_M, view)
        rows.set(mark.stationId, row)
      }
      frame.coverOX[i] = row?.origin.x ?? 0
      frame.coverOZ[i] = row?.origin.z ?? 0
      frame.coverX[i] = row?.dir.x ?? 0
      frame.coverZ[i] = row?.dir.z ?? 0
      frame.reach[i] = row?.reach ?? 0
    })
    frame.last.d = NaN
  }, [frame, shown, presences, width, height])
}

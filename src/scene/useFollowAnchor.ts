import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, type RefObject } from 'react'
import type { BandView } from '../lib/bandOffset'
import { clockNow } from '../lib/live/clock'
import { writeFollowAnchor, type FollowAnchor } from '../lib/live/followAnchor'
import { stepSlot, type SlotTable } from '../lib/live/slots'
import { createTrackPoint } from '../lib/live/trackPoint'
import { hopDistance } from '../lib/realtime/position'

/** This frame's clock, read by LiveTrains' draw loop so its fades and carries share the step's instant. */
export interface TrainFrameClock {
  /** performance.now() in seconds: the fades' and carries' clock. */
  localS: number
}

/**
 * Priority -3, before the camera moves: steps every slot's displayed distance (LiveTrains' draw loop at 0 reads
 * `table.displayed`) and writes the selected train's drawn point into `anchor`, with the last frame's band view (it
 * changes by under a pixel in a frame), lifted by `liftM` to where its dot is drawn. Cleared to invalid on unmount.
 * No allocation.
 */
export function useFollowAnchor(
  table: SlotTable,
  selectedSlot: RefObject<number>,
  anchor: FollowAnchor,
  view: BandView,
  offsetS: number,
  liftM: number,
): TrainFrameClock {
  const clock = useMemo<TrainFrameClock>(() => ({ localS: 0 }), [])
  const scratch = useMemo(createTrackPoint, [])
  useLayoutEffect(
    () => () => {
      anchor.valid = false
      anchor.slot = -1
    },
    [anchor],
  )
  useFrame((_, dt) => {
    const perfMs = performance.now()
    const now = clockNow(offsetS, perfMs)
    const localS = perfMs / 1000
    clock.localS = localS
    for (let i = 0; i < table.high; i++) {
      const trip = table.trips[i]
      if (trip) stepSlot(table, i, hopDistance(trip.plan, trip.geometry, now), now, localS, dt)
    }
    writeFollowAnchor(anchor, table, selectedSlot.current, view, localS, scratch)
    anchor.y += liftM
  }, -3)
  return clock
}

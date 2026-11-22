import { type RefObject, useLayoutEffect, useMemo, useRef } from 'react'
import type { LiveTrip } from '../lib/realtime/prepareTrips'
import { createSelectedMix, selectSlot, type SelectedMix } from '../lib/live/selectedMix'
import type { SlotTable } from '../lib/live/slots'
import { useTrainSelection } from '../lib/trainSelection'
import type { TrainCarsLayer } from './useTrainCars'

export interface SelectedSlot {
  /** The slot drawn as selected, -1 for none. Read once per frame. */
  slot: RefObject<number>
  /** The selected train's own car mix (selectedMix.ts), so it is cars at zooms where the rest are dots. */
  mix: SelectedMix
  reducedMotion: MediaQueryList
}

/**
 * Follows the selected trip to its slot: the cars' selection rim and the selected car mix. Runs after the slot
 * reconcile (declare it after that effect), so a slot reused by another trip since the last poll loses the
 * highlight and doesn't inherit the cars.
 */
export function useSelectedSlot(table: SlotTable, trips: readonly LiveTrip[], cars: TrainCarsLayer): SelectedSlot {
  const { selectedKey } = useTrainSelection()
  const slot = useRef(-1)
  /** The trip the selected slot held, to tell whether the old slot still holds it. */
  const slotKey = useRef<string | null>(null)
  const mix = useMemo(createSelectedMix, [])
  const reducedMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)'), [])

  useLayoutEffect(() => {
    const next = selectedKey === null ? -1 : (table.byKey.get(selectedKey) ?? -1)
    const old = slot.current
    if (next === old) return
    selectSlot(mix, next, old >= 0 && table.keys[old] === slotKey.current)
    cars.setSelected(next)
    slot.current = next
    slotKey.current = selectedKey
  }, [selectedKey, trips, table, cars, mix])

  return useMemo(() => ({ slot, mix, reducedMotion }), [mix, reducedMotion])
}

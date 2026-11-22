import { type RefObject, useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { createSelectedMix, selectSlot, type SelectedMix } from '../lib/live/selectedMix'
import type { SlotTable } from '../lib/live/slots'
import { useTrainSelection } from '../lib/trainSelection'
import type { TrainCarsLayer } from './useTrainCars'

export interface SelectedSlot {
  /** The slot drawn as selected, -1 for none. Read once per frame. */
  slot: RefObject<number>
  /** The selected train's own car mix (selectedMix.ts), so it is cars at zooms where the rest are dots. */
  mix: SelectedMix
  /**
   * Re-finds the selected trip's slot. Call it after every slot reconcile, so a slot reused by another trip since
   * the last poll loses the highlight and doesn't inherit the cars. Stable.
   */
  sync: () => void
}

/** Follows the selected trip to its slot: the cars' selection rim and the selected car mix. */
export function useSelectedSlot(table: SlotTable, cars: TrainCarsLayer): SelectedSlot {
  const { selectedKey } = useTrainSelection()
  const key = useRef(selectedKey)
  const slot = useRef(-1)
  /** The trip the selected slot held, to tell whether the old slot still holds it. */
  const slotKey = useRef<string | null>(null)
  const mix = useMemo(createSelectedMix, [])

  const sync = useCallback(() => {
    const next = key.current === null ? -1 : (table.byKey.get(key.current) ?? -1)
    const old = slot.current
    if (next === old) return
    selectSlot(mix, next, old >= 0 && table.keys[old] === slotKey.current)
    cars.setSelected(next)
    slot.current = next
    slotKey.current = key.current
  }, [table, cars, mix])

  useLayoutEffect(() => {
    key.current = selectedKey
    sync()
  }, [selectedKey, sync])

  return useMemo(() => ({ slot, mix, sync }), [mix, sync])
}

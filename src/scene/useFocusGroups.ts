import { useLayoutEffect, useRef, type RefObject } from 'react'
import type { IndexLoad } from '../data/interiorLoad'
import { focusGroupOf, NO_FOCUS_GROUP, type FocusInput } from '../lib/focusMachine'
import type { InteriorModel } from './interiorModel'

/**
 * Keeps CameraRig's reused focus input in step with the focused and the closed station's complexes
 * (`FocusInput.focusGroup`, `dismissedGroup`), from the station index (it outlives the interior, which unloads when
 * focus clears) cut to the loaded interior's members. Layout effect on the index, the stations and the interior,
 * never per frame. Returns the focused group's ref, for a hold's member positions.
 */
export function useFocusGroups(
  input: RefObject<FocusInput>,
  index: IndexLoad,
  interior: InteriorModel | null,
  focusedId: string | null,
  dismissedId: string | null,
): RefObject<ReadonlySet<string>> {
  const focusGroup = useRef<ReadonlySet<string>>(NO_FOCUS_GROUP)
  useLayoutEffect(() => {
    focusGroup.current = input.current.focusGroup = focusGroupOf(focusedId, index, interior)
    input.current.dismissedGroup = focusGroupOf(dismissedId, index, null)
  }, [input, index, interior, focusedId, dismissedId])
  return focusGroup
}

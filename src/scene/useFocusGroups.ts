import { useLayoutEffect, useRef, type RefObject } from 'react'
import type { IndexLoad } from '../data/interiorLoad'
import { useFocus } from '../lib/focus'
import { focusGroupOf, NO_FOCUS_GROUP, type FocusInput } from '../lib/focusMachine'
import type { InteriorModel } from './interiorModel'

/**
 * Keeps CameraRig's reused focus input in step with the focused and the closed station's complexes
 * (`FocusInput.focusGroup`, `dismissedGroup`): the station complex (`membersOf`, stations.json `complexes`) cut to the
 * loaded interior's members. Layout effect on the focused ids and the interior, never per frame. Returns the focused
 * group's ref, for a hold's member positions. `_index` is unused (the complex no longer comes from the station
 * index); CameraRig drops the argument later.
 */
export function useFocusGroups(
  input: RefObject<FocusInput>,
  _index: IndexLoad,
  interior: InteriorModel | null,
  focusedId: string | null,
  dismissedId: string | null,
): RefObject<ReadonlySet<string>> {
  const { membersOf } = useFocus()
  const focusGroup = useRef<ReadonlySet<string>>(NO_FOCUS_GROUP)
  useLayoutEffect(() => {
    focusGroup.current = input.current.focusGroup = focusGroupOf(focusedId, membersOf(focusedId), interior)
    input.current.dismissedGroup = focusGroupOf(dismissedId, membersOf(dismissedId), null)
  }, [input, membersOf, interior, focusedId, dismissedId])
  return focusGroup
}

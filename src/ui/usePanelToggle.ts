import { useCallback, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { usePanelCollapseControls } from '../lib/panelCollapse'
import type { CollapsiblePanel } from '../lib/panelCollapseState'

export interface PanelToggle {
  collapsed: boolean
  collapse: () => void
  expand: () => void
}

/**
 * One panel's collapse. The toggle commits at once and focus goes to `focusTarget` in the same task (the bar when
 * collapsed, the heading when expanded: the panel points the one ref at whichever is showing), so no frame has focus on
 * the body; a tap doesn't focus a button on iOS, so it always moves.
 */
export function usePanelToggle(panel: CollapsiblePanel, focusTarget: RefObject<HTMLElement | null>): PanelToggle {
  const { stationCollapsed, tripCollapsed, changesCollapsed, setCollapsed } = usePanelCollapseControls()
  const flags = { station: stationCollapsed, trip: tripCollapsed, changes: changesCollapsed }
  const set = useCallback(
    (next: boolean) => {
      flushSync(() => setCollapsed(panel, next))
      focusTarget.current?.focus({ preventScroll: true })
    },
    [panel, setCollapsed, focusTarget],
  )
  const collapse = useCallback(() => set(true), [set])
  const expand = useCallback(() => set(false), [set])
  return { collapsed: flags[panel], collapse, expand }
}

import { useCallback, type RefObject } from 'react'
import { usePanelCollapseControls } from '../lib/panelCollapse'
import type { CollapsiblePanel } from '../lib/panelCollapseState'

export interface PanelToggle {
  collapsed: boolean
  collapse: () => void
  expand: () => void
}

/**
 * One panel's collapse. After each toggle focus goes to `focusTarget` one frame later (the bar when collapsed, the
 * heading when expanded: the panel points the one ref at whichever is showing), since a tap doesn't focus a button on iOS.
 */
export function usePanelToggle(panel: CollapsiblePanel, focusTarget: RefObject<HTMLElement | null>): PanelToggle {
  const { stationCollapsed, tripCollapsed, setCollapsed } = usePanelCollapseControls()
  const set = useCallback(
    (next: boolean) => {
      setCollapsed(panel, next)
      requestAnimationFrame(() => focusTarget.current?.focus({ preventScroll: true }))
    },
    [panel, setCollapsed, focusTarget],
  )
  const collapse = useCallback(() => set(true), [set])
  const expand = useCallback(() => set(false), [set])
  return { collapsed: panel === 'station' ? stationCollapsed : tripCollapsed, collapse, expand }
}

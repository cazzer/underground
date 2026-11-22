import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react'
import { useFocus } from './focus'
import {
  collapseReducer,
  collapsedFront,
  frontPanel,
  INITIAL_COLLAPSE,
  type CollapsiblePanel,
} from './panelCollapseState'
import { useTrainSelection } from './trainSelection'
import { useTrip } from './trip'

/** What the scene reads: the panel in front is collapsed, and `seq`, which changes only on a user collapse or expand. */
export interface PanelCollapse {
  collapsed: boolean
  seq: number
}

/** What the panels read and write. */
export interface PanelCollapseControls {
  stationCollapsed: boolean
  tripCollapsed: boolean
  setCollapsed: (panel: CollapsiblePanel, collapsed: boolean) => void
}

const ViewContext = createContext<PanelCollapse | null>(null)
const ControlsContext = createContext<PanelCollapseControls | null>(null)

/**
 * Whether the station and trip panels are collapsed to a bar. The station flag lasts the session (browsing passes
 * through no-focus states, and a reset there would reopen the panel on every station); the trip flag resets when the
 * trip panel closes.
 */
export function PanelCollapseProvider({ children }: { children: ReactNode }) {
  const { focusedId } = useFocus()
  const { open } = useTrip()
  const { selectedSummary, notice } = useTrainSelection()
  const [state, dispatch] = useReducer(collapseReducer, INITIAL_COLLAPSE)
  const front = frontPanel({ trainShown: selectedSummary !== null, noticeShown: notice !== null, tripOpen: open, focusedId })

  useEffect(() => {
    if (!open) dispatch({ type: 'tripClosed' })
  }, [open])

  const collapsed = collapsedFront(state, front)
  const view = useMemo(() => ({ collapsed, seq: state.seq }), [collapsed, state.seq])
  const setCollapsed = useCallback((panel: CollapsiblePanel, next: boolean) => dispatch({ type: 'set', panel, collapsed: next, front }), [front])
  const controls = useMemo(
    () => ({ stationCollapsed: state.station, tripCollapsed: state.trip, setCollapsed }),
    [state.station, state.trip, setCollapsed],
  )
  return (
    <ViewContext value={view}>
      <ControlsContext value={controls}>{children}</ControlsContext>
    </ViewContext>
  )
}

export function usePanelCollapse(): PanelCollapse {
  const value = useContext(ViewContext)
  if (!value) throw new Error('usePanelCollapse must be used inside <PanelCollapseProvider>')
  return value
}

export function usePanelCollapseControls(): PanelCollapseControls {
  const value = useContext(ControlsContext)
  if (!value) throw new Error('usePanelCollapseControls must be used inside <PanelCollapseProvider>')
  return value
}

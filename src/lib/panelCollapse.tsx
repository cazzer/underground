import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react'
import { useFocus } from './focus'
import {
  collapseReducer,
  collapsedFront,
  frontPanel,
  INITIAL_COLLAPSE,
  type ChangePick,
  type CollapsiblePanel,
  type FrontPanel,
} from './panelCollapseState'
import { useTrainSelection } from './trainSelection'
import { useTrip } from './trip'

/** What the scene reads: the panel in front is collapsed, and `seq`, which changes only on a user collapse or expand. */
export interface PanelCollapse {
  collapsed: boolean
  seq: number
  /** The panel in front (frontPanel): the trip's route draws while it is the trip panel, collapsed or not; the changes list in front covers it like a train panel does. */
  front: FrontPanel
  /** The service change the map draws (a list row's pick; 08r.6), or null; App draws it only while the list is in front. */
  changePick: ChangePick | null
}

/** What the panels read and write. */
export interface PanelCollapseControls {
  stationCollapsed: boolean
  tripCollapsed: boolean
  changesCollapsed: boolean
  /** The header's service-changes list is open (it may be under a train panel or notice). */
  changesOpen: boolean
  setCollapsed: (panel: CollapsiblePanel, collapsed: boolean) => void
  /** A directions pick: expands a collapsed trip panel without counting as a toggle (no `seq`: the pick's own focus move is the signal). */
  tripRequested: () => void
  /** The header chip opens the list expanded, or closes it and forgets its collapse; neither counts as a toggle (no `seq`). */
  openChanges: () => void
  closeChanges: () => void
  /** A drawable row's press: draws its change, or clears it when it is the one drawn (no `seq`). */
  pickChange: (alertId: string) => void
  /** Esc in the list with a change drawn: the drawing goes, the list stays. */
  clearChangePick: () => void
}

const ViewContext = createContext<PanelCollapse | null>(null)
const ControlsContext = createContext<PanelCollapseControls | null>(null)

/**
 * Whether the station, trip and service-changes panels are collapsed to a bar, and whether the changes list is open
 * (the one panel opened by the header chip, so its open flag lives here with the rest of the front-panel rule). The
 * station flag lasts the session (browsing passes through no-focus states, and a reset there would reopen the panel on
 * every station); the trip and changes flags reset when their panel closes. An explicit pick (a station flight request) expands a collapsed station panel without counting
 * as a toggle: the pick's own flight frames it.
 */
export function PanelCollapseProvider({ children }: { children: ReactNode }) {
  const { focusedId, flyRequest } = useFocus()
  const { open } = useTrip()
  const { selectedSummary, notice } = useTrainSelection()
  const [state, dispatch] = useReducer(collapseReducer, INITIAL_COLLAPSE)
  const front = frontPanel({ trainShown: selectedSummary !== null, noticeShown: notice !== null, changesOpen: state.changesOpen, tripOpen: open, focusedId })

  useEffect(() => {
    if (!open) dispatch({ type: 'tripClosed' })
  }, [open])

  // Every explicit pick goes through `select`, which asks for a station flight; auto-focus never does.
  useEffect(() => {
    if (flyRequest?.kind === 'station') dispatch({ type: 'picked' })
  }, [flyRequest])

  const collapsed = collapsedFront(state, front)
  const view = useMemo(() => ({ collapsed, seq: state.seq, front, changePick: state.changePick }), [collapsed, state.seq, front, state.changePick])
  const setCollapsed = useCallback((panel: CollapsiblePanel, next: boolean) => dispatch({ type: 'set', panel, collapsed: next, front }), [front])
  const tripRequested = useCallback(() => dispatch({ type: 'tripRequested' }), [])
  const openChanges = useCallback(() => dispatch({ type: 'changesOpened' }), [])
  const closeChanges = useCallback(() => dispatch({ type: 'changesClosed' }), [])
  const pickChange = useCallback((alertId: string) => dispatch({ type: 'changePicked', alertId }), [])
  const clearChangePick = useCallback(() => dispatch({ type: 'changePickCleared' }), [])
  const controls = useMemo(
    () => ({
      stationCollapsed: state.station,
      tripCollapsed: state.trip,
      changesCollapsed: state.changes,
      changesOpen: state.changesOpen,
      setCollapsed,
      tripRequested,
      openChanges,
      closeChanges,
      pickChange,
      clearChangePick,
    }),
    [state.station, state.trip, state.changes, state.changesOpen, setCollapsed, tripRequested, openChanges, closeChanges, pickChange, clearChangePick],
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

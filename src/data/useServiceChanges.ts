import { useEffect, useMemo } from 'react'
import { ALERTS_URL } from './realtime'
import { useAlerts } from './useAlerts'
import { useChangeRoute } from './useChangeRoute'
import { useNormalStops } from './useNormalStops'
import { changeDrawable, changeDrawNote, type ChangeDraw } from '../lib/changeDraw'
import { serviceOrNull } from '../lib/live/alertAdded'
import { joinStationChanges } from '../lib/live/alertJoin'
import { alertListView, listedAs, type AlertListBody } from '../lib/live/alertList'
import { alertSkipsOf, type AlertSkips } from '../lib/live/alertSkips'
import { alertKindOf } from '../lib/live/alertStations'
import { serviceChangeView, type ServiceChangeView } from '../lib/live/alertText'
import { nyWhen } from '../lib/live/nyWhen'
import { terminalsOf } from '../lib/live/routeTerminals'
import type { Network, ShapePath } from '../lib/network'
import { usePanelCollapse, usePanelCollapseControls } from '../lib/panelCollapse'
import type { TripLookup } from '../lib/realtime/tripLookup'

/** The panel's service changes with no station focused: nothing, and nothing known. */
const NO_CHANGES: ServiceChangeView = { known: false, body: { kind: 'none' }, skipSpoken: '' }

interface ServiceChangesInput {
  network: Network
  /** The drawn shapes (banded once the bands arrive). */
  paths: readonly ShapePath[]
  focusedId: string | null
  /** The live clock (eneNowS). */
  nowS: number
  /** The live layer's trip lookup, once its static load is ready: normal service for an Express to Local change. */
  lookup: TripLookup | null
  /** That load failed, or live data is off: normal service falls back to the planner's patterns. */
  lookupFailed: boolean
}

export interface ServiceChanges {
  /** The focused station's panel rows. */
  changes: ServiceChangeView
  /** The skip sets, for the train panel's stops and the arrivals rows. */
  skips: AlertSkips | null
  /** The header chip and its list. */
  changeList: AlertListBody
  /** The picked row's dim line (changeDrawNote), or null with nothing picked. */
  changeNote: string | null
  /** The picked change's route view, or null. */
  changeRoute: ChangeDraw | null
}

/**
 * The MTA's service changes (08r.4 to 08r.8): the focused station's rows (its group: any member's stops), the skip
 * sets, every change in effect or within a day for the header's list (the ones the map can draw are buttons), and the
 * picked one's drawing and note. A pick the list no longer shows (ended, gone, data stale) is dropped, so Esc closes
 * the list at once.
 */
export function useServiceChanges({ network, paths, focusedId, nowS, lookup, lookupFailed }: ServiceChangesInput): ServiceChanges {
  const alerts = useAlerts(ALERTS_URL)
  const skips = useMemo(() => alertSkipsOf(alerts.snapshot, alerts.schemaMismatch, network.stationById), [alerts.snapshot, alerts.schemaMismatch, network])
  const routeOrder = useMemo(() => new Map(network.routes.map((r, i) => [r.id, i])), [network])
  const terminalOf = useMemo(() => terminalsOf(network.shapes, network.stations), [network])
  const wantsService = useMemo(() => (alerts.snapshot?.alerts ?? []).some((a) => alertKindOf(a.type) === 'local'), [alerts.snapshot])
  const normal = useNormalStops(lookup, lookupFailed, wantsService, network)
  const serviceOf = serviceOrNull(normal)
  const focusedGroup = focusedId ? network.groupById.get(focusedId) : undefined
  const changes = focusedGroup
    ? serviceChangeView(
        joinStationChanges(focusedGroup, network.stationById, alerts, nowS, routeOrder, normal),
        focusedGroup,
        network.routeById,
        nowS,
        terminalOf,
      )
    : NO_CHANGES
  const drawableIds = useMemo(
    () => new Set((alerts.snapshot?.alerts ?? []).filter((a) => changeDrawable(a, network.stationById, serviceOf)).map((a) => a.id)),
    [alerts.snapshot, network, serviceOf],
  )
  const changeList = alertListView(alerts, routeOrder, nowS, (a) => drawableIds.has(a.id))
  const { changePick } = usePanelCollapse()
  const changeRoute = useChangeRoute({ network, paths, snapshot: alerts.snapshot, pick: changePick, listed: changeList, serviceOf })
  // A change not in effect yet says when it starts, so the drawing isn't read as now.
  const picked = changePick ? listedAs(changeList, changePick.alertId) : null
  const changeNote = picked ? changeDrawNote(changeRoute, picked.group === 'later' ? nyWhen(picked.startS, nowS) : null) : null
  const { clearChangePick } = usePanelCollapseControls()
  const stalePick = changePick !== null && picked === null
  useEffect(() => {
    if (stalePick) clearChangePick()
  }, [stalePick, clearChangePick])
  return { changes, skips, changeList, changeNote, changeRoute }
}

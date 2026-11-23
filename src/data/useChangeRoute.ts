import { useMemo } from 'react'
import type { AlertsSnapshot } from './realtime'
import { serviceChangeDraw, type ChangeDraw } from '../lib/changeDraw'
import type { ServiceOf } from '../lib/live/alertAdded'
import { listedAs, type AlertListBody } from '../lib/live/alertList'
import type { Network, ShapePath } from '../lib/network'
import type { ChangePick } from '../lib/panelCollapseState'
import { stopStations } from '../lib/tripSpans'

interface ChangeRouteInput {
  network: Network
  /** The drawn shapes (banded once the bands arrive): the stretches are found on what TripLines draws. */
  paths: readonly ShapePath[]
  snapshot: AlertsSnapshot | null
  /** The list row picked (usePanelCollapse().changePick). */
  pick: ChangePick | null
  /** The header's list now: a pick it no longer lists (ended, gone, or the data unknown) draws nothing. */
  listed: AlertListBody
  /** Normal service (useNormalStops), for an Express to Local change; null while it loads. */
  serviceOf: ServiceOf | null
}

/**
 * The picked service change as the route view (changeDraw.ts), or null: nothing picked, the pick no longer listed, or
 * nothing to draw. Recomputed only when the pick, what the alert says (a poll makes new objects of the same alert),
 * the drawn shapes, the normal service or the network change. No fetch. A throw (a broken network) logs and draws nothing.
 */
export function useChangeRoute({ network, paths, snapshot, pick, listed, serviceOf }: ChangeRouteInput): ChangeDraw | null {
  const alert = pick !== null && listedAs(listed, pick.alertId) !== null ? (snapshot?.alerts.find((a) => a.id === pick.alertId) ?? null) : null
  const content = alert ? JSON.stringify([alert.type, alert.header, alert.entities]) : null
  const key = alert && pick ? `${pick.alertId}#${pick.seq}` : null
  const stops = useMemo(() => stopStations(network.stations), [network])
  return useMemo(() => {
    if (alert === null || key === null) return null
    try {
      return serviceChangeDraw(alert, { shapes: paths, stationById: network.stationById, stopStations: stops, serviceOf }, key)
    } catch (err) {
      console.error(`Service change ${alert.id}: ${err instanceof Error ? err.message : String(err)}; not drawn`)
      return null
    }
    // `alert` is a new object every poll; `content` says when what it says really changes.
  }, [key, content, paths, network, stops, serviceOf])
}

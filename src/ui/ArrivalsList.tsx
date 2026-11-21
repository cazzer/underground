import { useEffect, useMemo, useState } from 'react'
import { arrivalsAt, formatArrivalTimes, type ArrivalGroup, type ArrivalsSource } from '../lib/live/arrivals'
import { deriveArrivalsView } from '../lib/live/arrivalsView'
import { clockNow } from '../lib/live/clock'
import { stationFeedHealth } from '../lib/live/feedHealth'
import type { LiveStatus } from '../lib/live/liveStatus'
import { routeSpokenName } from '../lib/labels'
import type { Network, Station } from '../lib/network'
import { RouteChip } from './RouteChip'

/** How often the relative times are recomputed from the live clock; a new poll updates them sooner. */
const TICK_MS = 15_000

interface ArrivalRowProps {
  group: ArrivalGroup
  network: Network
  nowS: number
}

function ArrivalRow({ group, network, nowS }: ArrivalRowProps) {
  const route = network.routeById.get(group.routeId)
  if (!route) throw new Error(`Arrival for unknown route "${group.routeId}"`)
  return (
    <li className="flex items-start gap-2 py-1.5">
      <RouteChip route={route} as="span" className="mt-px min-w-9 shrink-0 text-center" />
      <span className="min-w-0 flex-1">
        <span className="block leading-tight">
          <span className="sr-only">{routeSpokenName(route.shortName)} train </span>
          <span className="text-ink-dim">to</span> {group.headsign}
        </span>
        <span className="mt-0.5 block font-mono text-sm tabular-nums">{formatArrivalTimes(group.times, nowS)}</span>
      </span>
    </li>
  )
}

interface ArrivalsListProps {
  network: Network
  station: Station
  source: ArrivalsSource | null
  status: LiveStatus
}

/**
 * Next arrivals at one station, a list per direction. The clock ticks in here, so a tick re-renders this list
 * and nothing else. The list is not a live region (it would announce every tick); only the state line is,
 * and not while the header already announces that live data is delayed.
 */
export function ArrivalsList({ network, station, source, status }: ArrivalsListProps) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  // `tick` is not read: it is what makes this recompute against the advancing clock.
  const { nowS, groups, health } = useMemo(() => {
    if (!source) return { nowS: 0, groups: null, health: null }
    const now = clockNow(source.offsetS, performance.now())
    const found = arrivalsAt(source.snapshot, station, now, {
      lookup: source.lookup,
      routeById: network.routeById,
      stationName: (id) => network.stationById.get(id)?.name,
    })
    return { nowS: now, groups: found, health: stationFeedHealth(source.snapshot, station.routeIds, source.failures, now) }
  }, [source, station, network, tick])

  const routeName = (id: string) => network.routeById.get(id)?.shortName ?? id
  const view = deriveArrivalsView(status, groups, health, routeName)
  const stateLines = view.kind === 'message' ? [view.text] : view.notes
  const announce = status.kind !== 'stale' ? ({ role: 'status', 'aria-live': 'polite' } as const) : {}
  return (
    <section className="mt-3 min-h-24">
      <h3 className="sr-only">Arrivals</h3>
      <div {...announce}>
        {stateLines.map((line) => (
          <p key={line} className="mt-1 text-xs text-ink-dim">
            {line}
          </p>
        ))}
      </div>
      {view.kind === 'empty' && <p className="mt-1 text-sm">No upcoming trains</p>}
      {view.kind === 'rows' &&
        view.sections.map((groupsOfDirection, i) => (
          <ul
            key={groupsOfDirection[0]!.direction}
            className={`divide-y divide-edge/30 text-sm ${i === 0 ? 'mt-1' : 'mt-1.5 border-t border-edge pt-0.5'}`}
          >
            {groupsOfDirection.map((g) => (
              <ArrivalRow key={`${g.routeId}|${g.headsign}`} group={g} network={network} nowS={nowS} />
            ))}
          </ul>
        ))}
    </section>
  )
}

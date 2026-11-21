import { useEffect, useMemo, useState } from 'react'
import { arrivalsAt, formatArrivalTimes, type ArrivalGroup, type ArrivalsSource } from '../lib/live/arrivals'
import { deriveArrivalsView } from '../lib/live/arrivalsView'
import { clockNow } from '../lib/live/clock'
import type { LiveStatus } from '../lib/live/liveStatus'
import { routeChipLabel } from '../lib/labels'
import type { Network, Station } from '../lib/network'
import { routeLineColor } from '../lib/routeColor'
import { theme } from '../theme'

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
    <li className="flex items-center gap-2 py-1.5">
      <span
        title={route.longName}
        className="min-w-9 shrink-0 border-2 px-1.5 text-center text-xs text-ink"
        style={{ borderColor: routeLineColor(route.color, theme.routeLineMix, theme.background) }}
      >
        <span aria-hidden="true">{routeChipLabel(route.shortName)}</span>
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="sr-only">{route.shortName} train </span>
        <span className="text-ink-dim">to</span> {group.headsign}
      </span>
      <span className="shrink-0 font-mono text-xs tabular-nums">{formatArrivalTimes(group.times, nowS)}</span>
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
 * Next arrivals at one station. The clock ticks in here, so a tick re-renders this list and nothing else.
 * The list is not a live region (it would announce every tick); only the state line is.
 */
export function ArrivalsList({ network, station, source, status }: ArrivalsListProps) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  // `tick` is not read: it is what makes this recompute against the advancing clock.
  const { nowS, groups } = useMemo(() => {
    if (!source) return { nowS: 0, groups: null }
    const now = clockNow(source.offsetS, performance.now())
    const found = arrivalsAt(source.snapshot, station, now, {
      lookup: source.lookup,
      routeById: network.routeById,
      stationName: (id) => network.stationById.get(id)?.name,
    })
    return { nowS: now, groups: found }
  }, [source, station, network, tick])

  const view = deriveArrivalsView(status, groups)
  const stateLine = view.kind === 'message' ? view.text : view.note
  return (
    <>
      <p className="mt-3 text-xs uppercase tracking-widest text-ink-dim">Arrivals</p>
      <div role="status" aria-live="polite">
        {stateLine && <p className="mt-1 text-xs text-ink-dim">{stateLine}</p>}
      </div>
      {view.kind === 'empty' && <p className="mt-1 text-sm">No upcoming trains</p>}
      {view.kind === 'rows' && (
        <ul aria-label={`Next arrivals at ${station.name}`} className="mt-1 divide-y divide-edge/30 text-sm">
          {view.groups.map((g) => (
            <ArrivalRow key={`${g.routeId}|${g.direction}|${g.headsign}`} group={g} network={network} nowS={nowS} />
          ))}
        </ul>
      )}
    </>
  )
}

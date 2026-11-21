import { useEffect, useLayoutEffect, useRef, type Ref } from 'react'
import { useFocus } from '../lib/focus'
import type { Insets } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import { routeChipLabel, scheduleLabel } from '../lib/labels'
import type { ArrivalsSource } from '../lib/live/arrivals'
import type { LiveStatus as LiveStatusValue } from '../lib/live/liveStatus'
import type { Network, Route } from '../lib/network'
import { routeLineColor } from '../lib/routeColor'
import { theme } from '../theme'
import { ArrivalsList } from './ArrivalsList'
import { Attribution } from './Attribution'
import { LiveStatus } from './LiveStatus'
import { InteriorStatus, type InteriorStatusInfo } from './InteriorStatus'

interface RouteChipProps {
  route: Route
}

/** Ink text on a route-colored border; the full name is in the tooltip and for screen readers. */
function RouteChip({ route }: RouteChipProps) {
  return (
    <li
      title={route.longName}
      className="border-2 px-1.5 text-xs text-ink"
      style={{ borderColor: routeLineColor(route.color, theme.routeLineMix, theme.background) }}
    >
      <span aria-hidden="true">{routeChipLabel(route.shortName)}</span>
      <span className="sr-only">
        {route.shortName}: {route.longName}
      </span>
    </li>
  )
}

interface ArrivalsPanelProps {
  network: Network
  stationId: string
  live: LiveStatusValue
  arrivals: ArrivalsSource | null
  onClose: () => void
  interior: InteriorStatusInfo
  ref: Ref<HTMLElement>
}

function ArrivalsPanel({ network, stationId, live, arrivals, onClose, interior, ref }: ArrivalsPanelProps) {
  const station = network.stationById.get(stationId)
  if (!station) throw new Error(`Arrivals panel for unknown station "${stationId}"`)
  return (
    <aside
      ref={ref}
      aria-label={`Arrivals at ${station.name}`}
      className="pointer-events-auto max-h-full min-h-0 w-72 max-w-full overflow-auto border border-edge bg-panel p-4 text-ink backdrop-blur-sm sm:shrink-0"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg leading-tight">{station.name}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close station panel"
          className="-m-2 flex min-h-11 min-w-11 cursor-pointer items-center justify-center p-2 text-ink-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
        >
          ×
        </button>
      </div>
      <ul aria-label="Routes" className="mt-1 flex flex-wrap gap-1.5">
        {station.routeIds.map((id) => {
          const route = network.routeById.get(id)
          if (!route) throw new Error(`Station ${station.id} lists unknown route "${id}"`)
          return <RouteChip key={id} route={route} />
        })}
      </ul>
      <InteriorStatus info={interior} />
      <ArrivalsList network={network} station={station} source={arrivals} status={live} />
    </aside>
  )
}

interface HudProps {
  network: Network
  /** Live-trains state, shown under the schedule line. */
  live: LiveStatusValue
  /** What the station panel lists arrivals from. */
  arrivals: ArrivalsSource | null
  /** Reports the screen bands the header and footer cover. */
  onInsets: (insets: Insets) => void
  /** The focused station's interior load and reveal, shown in its panel. */
  interior: InteriorStatusInfo
  /** Reports where the station panel sits (viewport px), or null when it closes. */
  onPanel: (rect: ScreenRect | null) => void
}

export function Hud({ network, live, arrivals, onInsets, interior, onPanel }: HudProps) {
  const { focusedId, dismiss } = useFocus()
  const root = useRef<HTMLDivElement>(null)
  const header = useRef<HTMLElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)

  // Measured once, before the scene mounts, for its opening view.
  useLayoutEffect(() => {
    if (!root.current || !header.current || !bottom.current) return
    const r = root.current.getBoundingClientRect()
    onInsets({
      top: header.current.getBoundingClientRect().bottom - r.top,
      bottom: r.bottom - bottom.current.getBoundingClientRect().top,
    })
  }, [onInsets])

  // Tracked while the panel is open, so a station fly-to can frame the view beside it. Resizes
  // move a stacked (phone) panel's top; window resizes move a desktop panel's left edge.
  useLayoutEffect(() => {
    const el = panel.current
    if (!el) {
      onPanel(null)
      return
    }
    const measure = () => {
      const p = el.getBoundingClientRect()
      onPanel({ left: p.left, top: p.top, right: p.right, bottom: p.bottom })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [focusedId, onPanel])

  useEffect(() => {
    if (!focusedId) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusedId, dismiss])

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-4 p-4 text-ink">
      <header ref={header}>
        <h1 className="text-xl tracking-[0.3em] uppercase">underground</h1>
        <p className="text-xs text-ink-dim">{scheduleLabel(network.feedVersion)} / theme: {theme.name}</p>
        <LiveStatus status={live} />
      </header>
      {/* DOM order is footer, then panel: matches desktop (left to right); mobile stacks the panel above. */}
      <div ref={bottom} className="flex min-h-0 flex-col-reverse gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <Attribution />
        {focusedId && (
          <ArrivalsPanel
            network={network}
            stationId={focusedId}
            live={live}
            arrivals={arrivals}
            onClose={dismiss}
            interior={interior}
            ref={panel}
          />
        )}
      </div>
    </div>
  )
}

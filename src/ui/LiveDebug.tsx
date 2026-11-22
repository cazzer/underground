import type { LiveDebugInfo } from '../data/useLive'
import { useTrip } from '../lib/trip'
import type { OverlayCounts } from '../lib/route/overlay'
import { SPAN_TRAINS, spanCarStats } from '../scene/useSpanCars'

interface LiveDebugProps {
  debug: LiveDebugInfo | null
  /** The technical cause behind an error or delay state. */
  technical: string | null
}

const enabled = import.meta.env.DEV && new URLSearchParams(window.location.search).has('debug')

const fixed = (n: number, digits = 1): string => n.toFixed(digits)

/** The trip planner's last overlay: what it replaced and added, and how long the last one took. */
function TripOverlayLine() {
  const { plan } = useTrip()
  const counts: OverlayCounts | null = plan.status === 'ready' ? (plan.overlay ?? null) : null
  const ms = performance.getEntriesByName('trip:overlay').at(-1)?.duration
  if (!counts) return <p>trip overlay none</p>
  return (
    <p>
      trip live {counts.liveFeeds.length} / schedule {counts.scheduleFeeds.length} feeds, replaced {counts.replaced}, cancelled{' '}
      {counts.cancelled}, oneOff {counts.oneOff}, extended {counts.extended}, {ms === undefined ? 'n/a' : `${fixed(ms)} ms`}
    </p>
  )
}

/** Dev-only `?debug` overlay: what the last poll did. Updates per poll, never per frame. */
export function LiveDebug({ debug, technical }: LiveDebugProps) {
  if (!enabled) return null
  if (!debug) {
    return (
      <aside className="pointer-events-none fixed top-4 right-4 max-w-64 border border-edge bg-panel p-2 font-mono text-[10px] text-ink">
        no snapshot{technical && ` (${technical})`}
      </aside>
    )
  }
  const dropped = Object.entries(debug.dropped).filter(([, n]) => n > 0)
  return (
    <aside
      aria-label="Live debug"
      className="pointer-events-none fixed top-4 right-4 max-w-64 border border-edge bg-panel p-2 font-mono text-[10px] leading-tight text-ink"
    >
      <p>
        drawn {debug.drawn} (arrival from schedule {debug.capped})
      </p>
      <p>dropped {dropped.length === 0 ? 'none' : dropped.map(([k, n]) => `${k} ${n}`).join(', ')}</p>
      <p>
        join {debug.stages.path} path / {debug.stages.tripKey} tripKey / {debug.stages.primary} primary
      </p>
      <p>
        feeds{' '}
        {Object.entries(debug.perFeed)
          .map(([f, v]) => `${f} ${v.trips}${v.stale ? ' STALE' : ''}${v.error ? ` ERR(${v.error})` : ''}`)
          .join(', ')}
      </p>
      <p>
        cache {debug.cache ?? 'n/a'} / age {fixed(debug.ageS)} s / skew {fixed(debug.skewS)} s
      </p>
      {technical && <p>error {technical}</p>}
      <p>
        offset {fixed(debug.offsetS, 2)} / prepare {fixed(debug.prepareMs)} ms / failures {debug.failures}
      </p>
      {/* Read when a poll re-renders this; the scene updates it per frame. */}
      <TripOverlayLine />
      <p>
        platform lift overflow (peak, over {SPAN_TRAINS}) {spanCarStats.peakOverflow}
      </p>
    </aside>
  )
}

import type { LiveDebugInfo } from '../data/useLive'

interface LiveDebugProps {
  debug: LiveDebugInfo | null
}

const enabled = import.meta.env.DEV && new URLSearchParams(window.location.search).has('debug')

const fixed = (n: number, digits = 1): string => n.toFixed(digits)

/** Dev-only `?debug` overlay: what the last poll did. Updates per poll, never per frame. */
export function LiveDebug({ debug }: LiveDebugProps) {
  if (!enabled) return null
  if (!debug) return <aside className="pointer-events-none fixed top-4 right-4 border border-edge bg-panel p-2 font-mono text-[10px] text-ink">no snapshot</aside>
  const dropped = Object.entries(debug.dropped).filter(([, n]) => n > 0)
  return (
    <aside
      aria-label="Live debug"
      className="pointer-events-none fixed top-4 right-4 max-w-64 border border-edge bg-panel p-2 font-mono text-[10px] leading-tight text-ink"
    >
      <p>drawn {debug.drawn}</p>
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
      <p>
        offset {fixed(debug.offsetS, 2)} / prepare {fixed(debug.prepareMs)} ms / failures {debug.failures}
      </p>
    </aside>
  )
}

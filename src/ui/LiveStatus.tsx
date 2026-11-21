import type { LiveStatus as LiveStatusValue, LiveStatusKind } from '../lib/live/liveStatus'

interface LiveStatusProps {
  status: LiveStatusValue
}

/** A glyph per state, so color is never the only cue. */
const GLYPH: Record<LiveStatusKind, string> = { live: '●', connecting: '◐', stale: '▲', error: '✕', off: '○' }
const TONE: Record<LiveStatusKind, string> = {
  live: 'text-status-live',
  connecting: 'text-ink-dim',
  stale: 'text-status-warn',
  error: 'text-status-error',
  off: 'text-ink-dim',
}

/** Live-trains state for the HUD header. The region stays mounted, so changes are announced politely. */
export function LiveStatus({ status }: LiveStatusProps) {
  return (
    <p role="status" aria-live="polite" className={`mt-1 text-xs ${TONE[status.kind]}`}>
      <span aria-hidden="true">{GLYPH[status.kind]} </span>
      {status.label}
      {status.detail && <span className="text-ink-dim"> ({status.detail})</span>}
    </p>
  )
}

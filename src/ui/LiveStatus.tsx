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

/**
 * Live-trains state for the HUD. Only the label is in the live region, so a screen reader hears
 * state changes and not the delayed-lines detail beside it (that stays readable in the page).
 */
export function LiveStatus({ status }: LiveStatusProps) {
  return (
    <p className={`mt-1 text-xs ${TONE[status.kind]}`}>
      <span role="status" aria-live="polite">
        <span aria-hidden="true">{GLYPH[status.kind]} </span>
        {status.label}
      </span>
      {status.detail && <span className="text-ink-dim"> ({status.detail})</span>}
    </p>
  )
}

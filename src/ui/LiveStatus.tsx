import { updatedLabel } from '../lib/labels'
import type { LiveStatus as LiveStatusValue, LiveStatusKind } from '../lib/live/liveStatus'

interface LiveStatusProps {
  status: LiveStatusValue
}

const DOT: Record<LiveStatusKind, string> = {
  live: 'bg-status-live',
  connecting: 'bg-ink-dim animate-pulse motion-reduce:animate-none',
  stale: 'bg-status-warn',
  error: 'bg-status-error',
  off: 'border border-ink-dim',
}

/**
 * Live-trains state as a small dot at the end of the schedule line: green live, yellow offline or delayed
 * (with the time of the data still drawn), red failed, hollow when live trains are off. The label stays in
 * a live region for screen readers and is the dot's tooltip; colour is never the only cue for them.
 */
export function LiveStatus({ status }: LiveStatusProps) {
  const title = status.detail ? `${status.label} (${status.detail})` : status.label
  const updated = status.updatedAt === null ? null : updatedLabel(status.updatedAt)
  return (
    <span className="inline-flex items-center gap-1.5" title={title}>
      <span aria-hidden="true" className={`inline-block size-2 shrink-0 rounded-full ${DOT[status.kind]}`} />
      <span role="status" className="sr-only">
        {updated ? `${status.label}, ${updated}` : title}
      </span>
      {updated && (
        <span aria-hidden="true" className="text-status-warn">
          {updated}
        </span>
      )}
    </span>
  )
}

import type { ArrivalGroup } from './arrivals'
import type { LiveStatus } from './liveStatus'

/** What the arrivals list shows: a message with no rows, or rows with an optional note above them. */
export type ArrivalsView =
  | { kind: 'message'; text: string }
  | { kind: 'empty'; note: string | null }
  | { kind: 'rows'; groups: ArrivalGroup[]; note: string | null }

const DELAYED_NOTE = 'Times may be delayed'

/**
 * Which state the arrivals list is in. `groups` is null until there is a snapshot and the join data to
 * read it with. A delayed feed still shows its times, with a note; no feed at all shows only a message.
 */
export function deriveArrivalsView(status: LiveStatus, groups: ArrivalGroup[] | null): ArrivalsView {
  if (status.kind === 'off') return { kind: 'message', text: 'Live arrivals not available yet' }
  if (status.kind === 'error') return { kind: 'message', text: 'Live arrivals unavailable' }
  if (groups === null) return { kind: 'message', text: 'Connecting to live arrivals' }
  const note = status.kind === 'stale' ? DELAYED_NOTE : null
  return groups.length === 0 ? { kind: 'empty', note } : { kind: 'rows', groups, note }
}

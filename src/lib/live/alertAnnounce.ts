import type { ChangeKind } from './alertJoin'
import type { ServiceChangeView } from './alertText'

/** What the panel showed for a station at one moment, for telling what changed. */
export interface ChangesSeen {
  stationId: string
  /** Fresh data: only then is a difference news (stale or missing data is not "the change ended"). */
  known: boolean
  /** The rows by key (alert, kind, direction): what each says and whether it is in effect. */
  rows: ReadonlyMap<string, { kind: ChangeKind; now: boolean; spoken: string; ended: string }>
}

export function changesSeen(stationId: string, view: ServiceChangeView): ChangesSeen {
  const rows = new Map<string, { kind: ChangeKind; now: boolean; spoken: string; ended: string }>()
  if (view.body.kind === 'changes') for (const r of view.body.rows) rows.set(r.key, { kind: r.kind, now: r.now, spoken: r.spoken, ended: r.ended })
  return { stationId, known: view.known, rows }
}

/**
 * The spoken change for a poll or a clock tick that left the same station's panel open: changes that are new
 * ("1: skips this station, from 11:45 PM."), a skip or suspension that has just come into effect, and changes gone.
 * Empty (silent) for everything else: no earlier view, another station (a panel just opened or changed: its
 * heading speaks, or "Showing <station>" with the skip sentence when focus came from the map), either side without
 * fresh data, or no change.
 */
export function changesAnnouncement(prev: ChangesSeen | null, next: ChangesSeen): string {
  if (!prev || prev.stationId !== next.stationId || !prev.known || !next.known) return ''
  const added = [...next.rows].filter(([key]) => !prev.rows.has(key))
  const started = [...next.rows].filter(([key, r]) => prev.rows.get(key)?.now === false && r.now && r.kind !== 'other')
  const gone = [...prev.rows].filter(([key]) => !next.rows.has(key))
  const sentences: string[] = []
  if (added.length === 1) sentences.push(`New service change. ${added[0]![1].spoken}`)
  else if (added.length > 1) sentences.push(`${added.length} new service changes at this station.`)
  for (const [, r] of started) sentences.push(`Now in effect. ${r.spoken}`)
  if (gone.length === 1) sentences.push(gone[0]![1].ended)
  else if (gone.length > 1) sentences.push(`${gone.length} service changes ended.`)
  return sentences.join(' ')
}

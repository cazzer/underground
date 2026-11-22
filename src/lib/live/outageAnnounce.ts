import type { OutagePanelView } from './eneText'

type Kind = 'elevator' | 'escalator'

/** What the panel showed for a station at one moment, for telling what changed. */
export interface OutageSeen {
  stationId: string
  /** Fresh data: only then is a difference news (stale or missing data is not "back in service"). */
  known: boolean
  /** Machines out of service, by id. */
  out: ReadonlyMap<string, Kind>
}

export function outageSeen(stationId: string, view: OutagePanelView): OutageSeen {
  const out = new Map<string, Kind>()
  if (view.body.kind === 'out') for (const row of view.body.rows) out.set(row.id, row.kind)
  return { stationId, known: view.known, out }
}

function phrase(machines: readonly [string, Kind][], ending: string): string {
  if (machines.length === 0) return ''
  if (machines.length === 1) {
    const [id, kind] = machines[0]!
    return `${kind === 'elevator' ? 'Elevator' : 'Escalator'} ${id} is ${ending}.`
  }
  return `${machines.length} machines are ${ending}.`
}

/**
 * The spoken change for a poll that left the same station's panel open: machines newly out of service, and machines
 * back. Empty (silent) for everything else: no earlier view, another station (a panel just opened or changed:
 * its heading, "Showing <station>" and "Estimated layout" speak then), either side without fresh data, or no change.
 */
export function outageAnnouncement(prev: OutageSeen | null, next: OutageSeen): string {
  if (!prev || prev.stationId !== next.stationId || !prev.known || !next.known) return ''
  const added = [...next.out].filter(([id]) => !prev.out.has(id))
  const removed = [...prev.out].filter(([id]) => !next.out.has(id))
  return [phrase(added, 'now out of service'), phrase(removed, 'back in service')].filter(Boolean).join(' ')
}

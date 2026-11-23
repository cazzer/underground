import { nyDate } from '../realtime/serviceDate'
import type { MachineOutage, OutageJoin } from './eneJoin'
import { nyTime, nyWhen } from './nyWhen'

/**
 * When a machine is due back, as the words after "back": "about 6 AM" later today (New York days),
 * "tomorrow 6 AM", "Thu 6 AM" within the next six days, else "Dec 31". Null for a time that has passed.
 */
export function nyReturnLabel(returnAt: number, nowS: number): string | null {
  if (returnAt <= nowS) return null
  return nyDate(returnAt) === nyDate(nowS) ? `about ${nyTime(returnAt)}` : nyWhen(returnAt, nowS)
}

const KIND_NAME = { elevator: 'Elevator', escalator: 'Escalator' } as const

export interface OutageRow {
  id: string
  kind: MachineOutage['kind']
  /** "Elevator out of service". */
  title: string
  /** "Mezzanine to platform": the panel's first detail line; null for an index-only machine whose inventory row has no text. */
  levels: string | null
  /** The text is the inventory's, so it can be long: the panel wraps it (clamped) instead of keeping it on one line. */
  wraps: boolean
  /** The second line's parts, each kept whole: the code, then "back about 6 AM" or "return time passed" (none when the MTA gave no time). */
  meta: string[]
}

export type OutagePanelBody =
  | { kind: 'none' }
  | { kind: 'unknown'; text: string }
  | { kind: 'out'; rows: OutageRow[] }

export interface OutagePanelView {
  /** Fresh data says which machines are out (or that none are): the only time a change is news. */
  known: boolean
  /** An outage leaves some platform of an accessible station with no step-free way to the street (`noStepFreeNow`). */
  noStepFree: boolean
  body: OutagePanelBody
}

export function unknownText(kinds: 'elevator' | 'escalator' | 'both'): string {
  return kinds === 'both' ? 'Elevator and escalator status unavailable' : `${KIND_NAME[kinds]} status unavailable`
}

function outageRow(o: MachineOutage, nowS: number): OutageRow {
  const meta = [o.id]
  if (o.returnAt !== null) {
    const back = nyReturnLabel(o.returnAt, nowS)
    meta.push(back === null ? 'return time passed' : `back ${back}`)
  }
  return { id: o.id, kind: o.kind, title: `${KIND_NAME[o.kind]} out of service`, levels: o.levels, wraps: o.source === 'catalog', meta }
}

/** What the station panel shows for a join, as of `nowS`. */
export function outagePanelView(join: OutageJoin, nowS: number, noStepFree = false): OutagePanelView {
  const { panel } = join
  const known = join.known
  switch (panel.kind) {
    case 'none':
      return { known, noStepFree: false, body: { kind: 'none' } }
    case 'unknown':
      return { known, noStepFree: false, body: { kind: 'unknown', text: unknownText(panel.kinds) } }
    case 'out':
      return { known, noStepFree, body: { kind: 'out', rows: panel.outages.map((o) => outageRow(o, nowS)) } }
  }
}

import { addDays, nyDate } from '../realtime/serviceDate'
import type { MachineOutage, OutageJoin } from './eneJoin'

/** Rows shown before "Show N more". */
export const OUTAGE_ROWS_SHOWN = 2

const NY_TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true })
const NY_WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' })
const NY_MONTH_DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })

/** "6 AM" or "6:30 AM" in New York time (the AM/PM is needed: an outage can last a day). */
function nyTime(epochS: number): string {
  const part = (type: Intl.DateTimeFormatPartTypes) => NY_TIME.formatToParts(epochS * 1000).find((p) => p.type === type)!.value
  const minute = part('minute')
  return `${part('hour')}${minute === '00' ? '' : `:${minute}`} ${part('dayPeriod')}`
}

/**
 * When a machine is due back, as the words after "back": "about 6 AM" later today (New York days),
 * "tomorrow 6 AM", "Thu 6 AM" within the next six days, else "Dec 31". Null for a time that has passed.
 */
export function nyReturnLabel(returnAt: number, nowS: number): string | null {
  if (returnAt <= nowS) return null
  const day = nyDate(returnAt)
  const today = nyDate(nowS)
  if (day === today) return `about ${nyTime(returnAt)}`
  if (day === addDays(today, 1)) return `tomorrow ${nyTime(returnAt)}`
  for (let n = 2; n <= 6; n++) {
    if (day === addDays(today, n)) return `${NY_WEEKDAY.format(returnAt * 1000)} ${nyTime(returnAt)}`
  }
  return NY_MONTH_DAY.format(returnAt * 1000)
}

const KIND_NAME = { elevator: 'Elevator', escalator: 'Escalator' } as const

export interface OutageRow {
  id: string
  kind: MachineOutage['kind']
  /** "Elevator out of service". */
  title: string
  /** "Mezzanine to platform · EL358 · back about 6 AM"; no return part when the MTA gave none. */
  detail: string
}

export type OutagePanelBody =
  | { kind: 'none' }
  | { kind: 'unknown'; text: string }
  | { kind: 'out'; rows: OutageRow[]; shown: number }

export interface OutagePanelView {
  /** Fresh data says which machines are out (or that none are): the only time a change is news. */
  known: boolean
  body: OutagePanelBody
}

export function unknownText(kinds: 'elevator' | 'escalator' | 'both'): string {
  return kinds === 'both' ? 'Elevator and escalator status unavailable' : `${KIND_NAME[kinds]} status unavailable`
}

function outageRow(o: MachineOutage, nowS: number): OutageRow {
  const parts = [o.levels, o.id]
  if (o.returnAt !== null) {
    const back = nyReturnLabel(o.returnAt, nowS)
    parts.push(back === null ? 'return time passed' : `back ${back}`)
  }
  return { id: o.id, kind: o.kind, title: `${KIND_NAME[o.kind]} out of service`, detail: parts.join(' · ') }
}

/** What the station panel shows for a join, as of `nowS`. */
export function outagePanelView(join: OutageJoin, nowS: number): OutagePanelView {
  const { panel } = join
  const known = join.status.known
  switch (panel.kind) {
    case 'none':
      return { known, body: { kind: 'none' } }
    case 'unknown':
      return { known, body: { kind: 'unknown', text: unknownText(panel.kinds) } }
    case 'out':
      return { known, body: { kind: 'out', rows: panel.outages.map((o) => outageRow(o, nowS)), shown: OUTAGE_ROWS_SHOWN } }
  }
}

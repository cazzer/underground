import { useMemo, useState } from 'react'
import type { LocateControls } from '../data/useLocate'
import { markedPlacement, type MarkedPlacement } from '../lib/locate'
import type { Network } from '../lib/network'
import { fixDistanceOf, hereRow, hereStatus, type HereRow, type HereStatus } from '../lib/searchHere'
import type { StationGroup } from '../lib/stationGroups'

interface SearchHereArgs {
  locate: LocateControls
  /** The dialog offers "Use my location" and the "My location" row (it was given somewhere to send a pick). */
  enabled: boolean
  /** The dialog is open (a new session forgets that the control was pressed). */
  open: boolean
  query: string
  network: Network
}

export interface SearchHere {
  /** The marked fix, from either the header or this dialog: read to rank and to keep the geocode bias away, never sent. */
  fix: MarkedPlacement | null
  /** Station ties sort nearer this fix first; absent with none. */
  distanceOf: ((group: StationGroup) => number) | undefined
  /** The control and its row show only while the input is blank. */
  showControl: boolean
  /** The "My location" row, while the control shows and a fix is known. */
  row: HereRow | null
  /** What shows under the control (aria-hidden), after a press in this dialog session. */
  visible: HereStatus['visible']
  /** What the dialog's polite region says after a press, else null (the station count speaks). */
  spoken: string | null
  locating: boolean
  /** Runs one position request (no camera move). Call only from the user's press. */
  press: () => void
}

/**
 * The search dialog's view of the shared location state. `asked` is whether this dialog session pressed the control
 * for the current query: the status speaks only then, so opening the dialog with a fix from the header says nothing,
 * and typing hands the polite region back to the station count.
 */
export function useSearchHere({ locate, enabled, open, query, network }: SearchHereArgs): SearchHere {
  const [asked, setAsked] = useState(false)
  const [seen, setSeen] = useState({ open, query })
  if (seen.open !== open || seen.query !== query) {
    setSeen({ open, query })
    setAsked(false)
  }
  const fix = markedPlacement(locate.state)
  const distanceOf = useMemo(() => (fix ? fixDistanceOf(fix.ground, network.stationById) : undefined), [fix, network])
  const showControl = enabled && query.trim() === ''
  const status = asked ? hereStatus(locate.state) : null
  return {
    fix,
    distanceOf,
    showControl,
    row: showControl ? hereRow(fix) : null,
    visible: status?.visible ?? null,
    spoken: status && status.spoken !== '' ? status.spoken : null,
    locating: locate.state.status === 'locating',
    press: () => {
      setAsked(true)
      locate.find()
    },
  }
}

import type { TripEnd } from '../lib/trip'
import type { TripEnds as Ends } from '../lib/tripView'
import type { Network } from '../lib/network'

interface TripEndsProps {
  network: Network
  ends: Ends
  /** The station under the camera, offered as an end while it is neither. */
  focusedId: string | null
  /** The station nearest a marked fix, offered as From while it is not. In memory only. */
  nearestId: string | null
  /** Opens that end's search. The row has already taken focus, so the dialog hands it back there. */
  onPick: (end: TripEnd) => void
  onSet: (end: TripEnd, stationId: string) => void
  onSwap: () => void
}

const LINK =
  'flex min-h-11 cursor-pointer items-center px-2 text-ink-dim underline hover:text-ink focus-visible:outline-2 focus-visible:outline-focus'

interface EndRowProps {
  label: string
  name: string | null
  onPress: (button: HTMLButtonElement) => void
}

function EndRow({ label, name, onPress }: EndRowProps) {
  return (
    <button
      type="button"
      onClick={(e) => onPress(e.currentTarget)}
      aria-haspopup="dialog"
      className="flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-2 border border-edge px-2 text-left hover:text-focus focus-visible:outline-2 focus-visible:outline-focus"
    >
      <span aria-hidden="true" className="w-9 shrink-0 text-xs text-ink-dim uppercase">
        {label}
      </span>
      {name ? (
        <span aria-hidden="true" className="min-w-0 py-1">
          {name}
        </span>
      ) : (
        <span aria-hidden="true" className="text-ink-dim">
          Choose a station
        </span>
      )}
      <span className="sr-only">{name ? `${label}: ${name}` : `${label}: choose a station`}</span>
    </button>
  )
}

/**
 * From and To as two rows that open a station search, a swap, and the one or two shortcuts that fill an end:
 * the station nearest a marked fix, and the station on the map. A row takes focus before its dialog opens (iOS
 * doesn't focus a tapped button, and the dialog hands focus back to what had it).
 */
export function TripEnds({ network, ends, focusedId, nearestId, onPick, onSet, onSwap }: TripEndsProps) {
  const nameOf = (id: string | null) => (id ? (network.stationById.get(id)?.name ?? null) : null)
  const press = (end: TripEnd) => (button: HTMLButtonElement) => {
    button.focus({ preventScroll: true })
    onPick(end)
  }
  const nearest = nearestId !== null && nearestId !== ends.from ? nameOf(nearestId) : null
  const onMap = focusedId !== null && focusedId !== ends.from && focusedId !== ends.to ? nameOf(focusedId) : null
  return (
    <div className="mt-2">
      <div className="flex items-center gap-1">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <EndRow label="From" name={nameOf(ends.from)} onPress={press('from')} />
          <EndRow label="To" name={nameOf(ends.to)} onPress={press('to')} />
        </div>
        <button
          type="button"
          onClick={onSwap}
          aria-label="Swap From and To"
          className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center text-ink-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M8 4v16M8 4 4.5 7.5M8 4l3.5 3.5M16 20V4M16 20l-3.5-3.5M16 20l3.5-3.5" />
          </svg>
        </button>
      </div>
      {nearest !== null && nearestId !== null && (
        <button type="button" onClick={() => onSet('from', nearestId)} className={`${LINK} -ml-2`}>
          Nearest to you: {nearest}
        </button>
      )}
      {onMap !== null && focusedId !== null && (
        <p className="flex flex-wrap items-center text-sm">
          <span className="text-ink-dim">On the map: {onMap}</span>
          <button type="button" onClick={() => onSet('from', focusedId)} className={LINK}>
            Use as From
          </button>
          <button type="button" onClick={() => onSet('to', focusedId)} className={LINK}>
            Use as To
          </button>
        </p>
      )}
    </div>
  )
}

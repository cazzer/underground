import type { Ref } from 'react'
import { distanceText, type PlacePick } from '../lib/placeLabel'

interface PlaceStatusProps {
  /** The place the map was flown to, or null (nothing renders). */
  place: PlacePick | null
  /** "Go to <station>": the parent selects it. */
  onGo: (stationId: string) => void
  /** The × button; the parent moves focus back to the Search button afterwards. */
  onClear: () => void
  ref: Ref<HTMLParagraphElement>
}

const FOCUS = 'pointer-events-auto cursor-pointer focus-visible:outline-2 focus-visible:outline-focus'

/**
 * The header line for a place picked in the HUD search: its name, and the station nearest it to go to. Not a live
 * region: the dialog hands focus to the sentence, which a screen reader then reads once. Plain dim text, like the
 * location line's info tone.
 */
export function PlaceStatus({ place, onGo, onClear, ref }: PlaceStatusProps) {
  if (!place) return null
  const { nearest } = place
  const away = distanceText(nearest.distanceM)
  return (
    <div className="mt-1 flex max-w-72 items-start gap-3 text-xs text-ink-dim">
      <div className="min-w-0">
        <p ref={ref} tabIndex={-1} className="line-clamp-2 outline-none focus-visible:outline-2 focus-visible:outline-focus">
          <span className="sr-only">Showing </span>
          {place.label}
          <span className="sr-only">
            . Nearest station {nearest.name}, {away}.
          </span>
        </p>
        <button type="button" onClick={() => onGo(nearest.id)} className={`${FOCUS} -my-1 inline-flex min-h-6 items-center underline hover:text-ink`}>
          Go to {nearest.name}
        </button>
        <span aria-hidden="true"> · {away}</span>
      </div>
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear place"
        className={`${FOCUS} -m-2 flex min-h-11 min-w-11 shrink-0 items-center justify-center p-2 text-ink-dim hover:text-ink`}
      >
        ×
      </button>
    </div>
  )
}

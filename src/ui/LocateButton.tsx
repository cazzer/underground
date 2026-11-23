import type { Ref } from 'react'
import { LocateIcon } from './LocateIcon'

interface LocateButtonProps {
  onLocate: () => void
  /** Pressed while a location is shown: clears it (the button is a toggle). */
  onClear: () => void
  /** A request is pending: the icon pulses (static and dimmed under reduced motion) and the button reports busy. */
  locating: boolean
  /** A location is drawn on the map: the button shows as active (marker colour, tinted fill, aria-pressed). */
  located: boolean
  ref: Ref<HTMLButtonElement>
}

/** Asks for the browser's location, only when pressed. Stays enabled while locating; repeat presses are ignored upstream. */
export function LocateButton({ onLocate, onClear, locating, located, ref }: LocateButtonProps) {
  const state = located ? 'border-here bg-here/15 text-here' : 'border-edge bg-panel text-ink hover:text-focus'
  const label = located ? 'Hide my location' : 'Show my location'
  return (
    <button
      ref={ref}
      type="button"
      onClick={located ? onClear : onLocate}
      aria-label="My location"
      aria-pressed={located}
      aria-busy={locating}
      title={label}
      className={`pointer-events-auto flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center border backdrop-blur-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${state}`}
    >
      <LocateIcon pulsing={locating} />
    </button>
  )
}

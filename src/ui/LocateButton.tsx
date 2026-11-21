import type { Ref } from 'react'

interface LocateButtonProps {
  onLocate: () => void
  /** A request is pending: the icon pulses (static and dimmed under reduced motion) and the button reports busy. */
  locating: boolean
  /** A location is drawn on the map: the icon takes the marker's color. */
  located: boolean
  ref: Ref<HTMLButtonElement>
}

/** Asks for the browser's location, only when pressed. Stays enabled while locating; repeat presses are ignored upstream. */
export function LocateButton({ onLocate, locating, located, ref }: LocateButtonProps) {
  const color = located ? 'text-here' : 'text-ink'
  return (
    <button
      ref={ref}
      type="button"
      onClick={onLocate}
      aria-label="Show my location"
      aria-busy={locating}
      title="Show my location"
      className={`pointer-events-auto flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center border border-edge bg-panel backdrop-blur-sm hover:text-focus focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${color}`}
    >
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
        className={locating ? 'animate-pulse opacity-60 motion-reduce:animate-none' : undefined}
      >
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
        <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
      </svg>
    </button>
  )
}

import type { Ref } from 'react'

interface TripButtonProps {
  open: boolean
  onToggle: () => void
  ref: Ref<HTMLButtonElement>
}

/** Opens and closes the trip panel (a toggle: aria-expanded says which). */
export function TripButton({ open, onToggle, ref }: TripButtonProps) {
  const state = open ? 'border-focus text-focus' : 'border-edge text-ink hover:text-focus'
  return (
    <button
      ref={ref}
      type="button"
      onClick={onToggle}
      aria-label="Plan a trip"
      aria-expanded={open}
      title="Plan a trip"
      className={`pointer-events-auto flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center border bg-panel backdrop-blur-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${state}`}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="6" cy="5" r="2" />
        <circle cx="18" cy="19" r="2" />
        <path d="M6 7v4a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v0" />
      </svg>
    </button>
  )
}

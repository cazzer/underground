import type { Ref } from 'react'
import { GEOCODE_URL } from '../data/realtime'

interface SearchButtonProps {
  onOpen: () => void
  ref: Ref<HTMLButtonElement>
}

/** Opens the full-screen search: stations, and addresses and places when the Worker is configured. */
export function SearchButton({ onOpen, ref }: SearchButtonProps) {
  const label = GEOCODE_URL ? 'Search stations and places' : 'Search stations'
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      aria-label={label}
      aria-haspopup="dialog"
      title={label}
      className="pointer-events-auto flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center border border-edge bg-panel text-ink backdrop-blur-sm hover:text-focus focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="10" cy="10" r="6" />
        <path d="M14.5 14.5 21 21" />
      </svg>
    </button>
  )
}

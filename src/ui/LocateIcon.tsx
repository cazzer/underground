interface LocateIconProps {
  /** A request is pending: the icon pulses (static and dimmed under reduced motion). */
  pulsing: boolean
}

/** The crosshair on the header's locate button and the search dialog's "Use my location". */
export function LocateIcon({ pulsing }: LocateIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      className={pulsing ? 'animate-pulse opacity-60 motion-reduce:animate-none' : undefined}
    >
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
    </svg>
  )
}

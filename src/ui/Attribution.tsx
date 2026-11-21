const LINK_CLASS =
  'underline underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

/** Required data attribution and not-real-time notice (MTA terms, OSM ODbL). */
export function Attribution() {
  return (
    <footer className="pointer-events-auto min-w-0 text-xs leading-snug text-ink-dim">
      <p>Data: MTA. Not endorsed by MTA. Arrival times may not be real time.</p>
      <p>
        ©{' '}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer noopener"
          className={LINK_CLASS}
        >
          OpenStreetMap contributors
        </a>
      </p>
    </footer>
  )
}

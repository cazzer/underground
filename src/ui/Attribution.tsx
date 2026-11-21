import type { ReactNode } from 'react'

const LINK_CLASS =
  'underline underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

interface ExternalLinkProps {
  href: string
  children: ReactNode
}

function ExternalLink({ href, children }: ExternalLinkProps) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={LINK_CLASS}>
      {children}
      <span className="sr-only"> (opens in new tab)</span>
    </a>
  )
}

/** Required data attribution and not-real-time notice (MTA terms, OSM ODbL). */
export function Attribution() {
  return (
    <footer className="pointer-events-auto w-fit min-w-0 self-start border border-edge bg-panel p-2 text-xs leading-snug text-ink-dim backdrop-blur-sm sm:self-auto">
      <p>
        <ExternalLink href="https://www.mta.info/open-data">Data: MTA</ExternalLink>. Not endorsed by MTA. Data may not
        be real time.
      </p>
      <p>
        © <ExternalLink href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</ExternalLink>
      </p>
    </footer>
  )
}

import { accessLabel } from '../lib/labels'
import type { StationAccessInfo } from '../lib/network'
import { accessLook } from './accessLook'

/** The International Symbol of Access (public domain), drawn in currentColor on a 24-unit grid. */
interface AccessGlyphProps {
  className: string
}

function AccessGlyph({ className }: AccessGlyphProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}>
      <circle cx="10.5" cy="3.6" r="2.3" fill="currentColor" />
      <path
        d="M10 7.6V14H15.6L18.2 20.2M10 10.2H14.8M6 11.6A6.2 6.2 0 1 0 15.6 19.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface AccessIconProps {
  access: StationAccessInfo
  /**
   * `row` (search results) says "partly" beside a partly accessible glyph; `card` leaves that to
   * `PartialAccessNote`, the line under the heading.
   */
  context: 'card' | 'row'
}

/**
 * Follows a station name, inside its heading or option so it is announced with it. One labelled image:
 * the visible "partly" is part of it, not read twice. Nothing for a station that isn't accessible.
 */
function AccessIcon({ access, context }: AccessIconProps) {
  const label = accessLabel(access)
  if (label === null) return null
  const partial = access.status === 'partial'
  const partly = partial && context === 'row' && <span className="text-xs text-ink-dim">partly</span>

  if (accessLook === 'b') {
    const badge = partial ? 'border border-access-badge text-access-badge' : 'bg-access-badge text-access-badge-ink'
    return (
      <span role="img" aria-label={label} className="ml-1.5 inline-flex items-center gap-1 align-[-0.15em] whitespace-nowrap">
        <span className={`inline-flex size-[1.05em] items-center justify-center ${badge}`}>
          <AccessGlyph className="size-[0.8em]" />
        </span>
        {partly}
      </span>
    )
  }
  if (accessLook === 'c') {
    return (
      <span
        role="img"
        aria-label={label}
        className={`ml-1.5 inline-flex items-center gap-1 border-2 px-1.5 align-[0.1em] text-xs whitespace-nowrap ${
          partial ? 'border-ink-dim text-ink-dim' : 'border-ink text-ink'
        }`}
      >
        <AccessGlyph className="size-[1.1em]" />
        {partial ? 'Partly' : 'Accessible'}
      </span>
    )
  }
  return (
    <span role="img" aria-label={label} className="ml-1.5 inline-flex items-baseline gap-1 whitespace-nowrap">
      <AccessGlyph className={`size-[0.9em] ${partial ? 'text-ink-dim' : 'text-ink'}`} />
      {partly}
    </span>
  )
}

interface StationNameProps extends AccessIconProps {
  name: string
}

/** The station name, then its access icon; the last word and the icon wrap together, so the icon never sits alone. */
export function StationName({ name, access, context }: StationNameProps) {
  if (access.status === 'none') return name
  const cut = name.lastIndexOf(' ') + 1
  return (
    <>
      {name.slice(0, cut)}
      <span className="whitespace-nowrap">
        {name.slice(cut)}
        <AccessIcon access={access} context={context} />
      </span>
    </>
  )
}

/**
 * The dim line under a partly accessible station's heading ("Partly accessible · Downtown only"). Hidden from
 * screen readers: the heading's icon already says it.
 */
export function PartialAccessNote({ access }: Pick<AccessIconProps, 'access'>) {
  if (access.status !== 'partial') return null
  return (
    <p aria-hidden="true" className="mt-1 text-xs text-ink-dim">
      Partly accessible{access.note && ' · '}
      {access.note && <span className="whitespace-nowrap">{access.note}</span>}
    </p>
  )
}

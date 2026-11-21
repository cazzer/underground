import { accessLabel } from '../lib/labels'
import type { StationAccessInfo } from '../lib/network'
import { accessLook } from './accessLook'

interface AccessGlyphProps {
  className: string
}

/** The International Symbol of Access (public domain), drawn in currentColor on a 24-unit grid. */
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

/** The visible mark only; `StationName` gives screen readers the label as text. */
function AccessIcon({ access, context }: AccessIconProps) {
  const partial = access.status === 'partial'
  const partly = partial && context === 'row' && <span className="text-xs text-ink-dim">partly</span>

  if (accessLook === 'b') {
    const badge = partial ? 'border border-access-badge text-access-badge' : 'bg-access-badge text-access-badge-ink'
    return (
      <span aria-hidden="true" className="ml-1 inline-flex items-center gap-1 align-[-0.15em]">
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
        aria-hidden="true"
        className={`ml-1 inline-flex items-center gap-1 border-2 px-1.5 align-[0.1em] text-xs ${
          partial ? 'border-ink-dim text-ink-dim' : 'border-ink text-ink'
        }`}
      >
        <AccessGlyph className="size-[1.1em]" />
        {partial ? 'Partly' : 'Accessible'}
      </span>
    )
  }
  return (
    <span aria-hidden="true" className="ml-1 inline-flex items-baseline gap-1">
      <AccessGlyph className={`size-[0.9em] ${partial ? 'text-ink-dim' : 'text-ink'}`} />
      {partly}
    </span>
  )
}

interface StationNameProps extends AccessIconProps {
  name: string
}

/**
 * The station name, then its access icon; the last word and the icon wrap together, so the icon never sits
 * alone. Screen readers get ", <accessLabel>." as hidden text instead of the icon, so a heading or option name
 * is real text with fixed punctuation. A search row also shows a partly accessible station's note after the icon.
 */
export function StationName({ name, access, context }: StationNameProps) {
  const label = accessLabel(access)
  if (label === null) return name
  const cut = name.lastIndexOf(' ') + 1
  return (
    <>
      {name.slice(0, cut)}
      <span className="whitespace-nowrap">
        {name.slice(cut)}
        <AccessIcon access={access} context={context} />
        <span className="sr-only">, {label}.</span>
      </span>
      {context === 'row' && access.note && (
        <span aria-hidden="true" className="text-xs text-ink-dim">
          {' '}
          <span className="whitespace-nowrap">·&nbsp;{access.note}</span>
        </span>
      )}
    </>
  )
}

/**
 * The dim line under a partly accessible station's heading, in the screen reader's words ("Partly accessible:
 * Downtown only"); the note itself doesn't break. Hidden from screen readers: the heading already says it.
 */
export function PartialAccessNote({ access }: Pick<AccessIconProps, 'access'>) {
  const label = accessLabel(access)
  if (access.status !== 'partial' || label === null) return null
  const note = access.note ?? ''
  return (
    <p aria-hidden="true" className="mt-1 text-xs text-ink-dim">
      {label.slice(0, label.length - note.length)}
      <span className="whitespace-nowrap">{note}</span>
    </p>
  )
}

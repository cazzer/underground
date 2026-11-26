import { GLYPHS, type AmenityKind } from '../lib/amenityGlyphs'

/** Each glyph's pieces as SVG `points`, y flipped (glyph y is up, SVG y is down); built once. */
const svgPoints = (kind: AmenityKind) => GLYPHS[kind].map((piece) => piece.map(([x, y]) => `${x},${-y}`).join(' '))
const POINTS: Record<AmenityKind, readonly string[]> = { restroom: svgPoints('restroom'), csc: svgPoints('csc') }

interface AmenityIconsProps {
  kinds: readonly AmenityKind[]
}

/** The visible amenity glyphs, in currentColor at the access glyph's size; `StationName` gives screen readers the words. */
export function AmenityIcons({ kinds }: AmenityIconsProps) {
  if (kinds.length === 0) return null
  return (
    <span aria-hidden="true" className="ml-1 inline-flex items-baseline gap-1 text-ink">
      {kinds.map((kind) => (
        <svg key={kind} viewBox="-1 -1 2 2" focusable="false" className="size-[0.9em]">
          {POINTS[kind].map((points) => (
            <polygon key={points} points={points} fill="currentColor" />
          ))}
        </svg>
      ))}
    </span>
  )
}

interface CscNoteProps {
  /** The MTA page's entrance text ("Enter at 42 St and Park Av"), or null for a station with no customer service center. */
  entrance: string | null
}

/** The dim line under a customer service center station's heading. Hidden from screen readers: the heading already says it. */
export function CscNote({ entrance }: CscNoteProps) {
  if (entrance === null) return null
  return (
    <p aria-hidden="true" className="mt-1 text-xs text-ink-dim">
      Customer service center, staffed 24/7 · <span className="whitespace-nowrap">{entrance}</span>
    </p>
  )
}

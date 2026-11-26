import { Fragment } from 'react'
import { GLYPHS, type AmenityKind } from '../lib/amenityGlyphs'

/** Room left either side of a glyph's own width, in glyph units, so the gap between glyphs stays even. */
const SIDE_PAD = 0.08

interface GlyphSvg {
  viewBox: string
  /** Each piece as SVG `points`, y flipped (glyph y is up, SVG y is down). */
  points: readonly string[]
}

/** A glyph's SVG, its viewBox cut to its own x extent (full height), so a narrow "i" takes a narrow box; built once. */
function glyphSvg(kind: AmenityKind): GlyphSvg {
  const pieces = GLYPHS[kind]
  const xs = pieces.flatMap((piece) => piece.map(([x]) => x))
  const x0 = Math.min(...xs) - SIDE_PAD
  const width = Math.max(...xs) + SIDE_PAD - x0
  return { viewBox: `${x0} -1 ${width} 2`, points: pieces.map((piece) => piece.map(([x, y]) => `${x},${-y}`).join(' ')) }
}

const SVGS: Record<AmenityKind, GlyphSvg> = { restroom: glyphSvg('restroom'), csc: glyphSvg('csc') }

interface AmenityIconsProps {
  kinds: readonly AmenityKind[]
}

/**
 * The visible amenity glyphs, drawn in currentColor (text-ink here) at the access glyph's height, each as wide as
 * its own shape; `StationName`'s caller gives screen readers the words.
 */
export function AmenityIcons({ kinds }: AmenityIconsProps) {
  if (kinds.length === 0) return null
  return (
    <span aria-hidden="true" className="ml-1 inline-flex items-baseline gap-1 text-ink">
      {kinds.map((kind) => (
        <svg key={kind} viewBox={SVGS[kind].viewBox} focusable="false" className="h-[0.9em] w-auto">
          {SVGS[kind].points.map((points) => (
            <polygon key={points} points={points} fill="currentColor" />
          ))}
        </svg>
      ))}
    </span>
  )
}

interface AmenityNoteProps {
  kinds: readonly AmenityKind[]
  /** The MTA page's entrance text ("Enter at 42 St and Park Av"), quoted as is; null with no customer service center. */
  cscEntrance: string | null
}

/**
 * The dim line under the heading of a station with amenities: the glyphs' legend with the hedge, the hours and the
 * entrance ("Restroom listed by the MTA · Customer service center, staffed 24/7 · Enter at 42 St and Park Av").
 * Read by screen readers (the heading says the kinds only), as sentences: each dot is said as a full stop. Not a live region.
 */
export function AmenityNote({ kinds, cscEntrance }: AmenityNoteProps) {
  // [text that may wrap, its unbroken tail]: a part's tail keeps its trailing dot, so no line starts with one. The
  // panel holds about 35 characters of this text a line, so only the short tails are kept whole (a long entrance,
  // "Enter at Westchester Av and Metropolitan Av", wraps rather than overflow).
  const parts: [string, string][] = []
  if (kinds.includes('restroom')) parts.push(['', 'Restroom listed by the MTA'])
  if (kinds.includes('csc')) {
    parts.push(['Customer service center, ', 'staffed 24/7'])
    if (cscEntrance !== null) parts.push([cscEntrance, ''])
  }
  if (parts.length === 0) return null
  return (
    <p className="mt-1 text-xs text-ink-dim">
      {parts.map(([head, tail], i) => {
        const last = i === parts.length - 1
        return (
          <Fragment key={head + tail}>
            {head}
            {(tail !== '' || !last) && (
              <span className="whitespace-nowrap">
                {tail}
                {!last && (
                  <>
                    <span aria-hidden="true"> ·</span>
                    <span className="sr-only">.</span>
                  </>
                )}
              </span>
            )}
            {!last && ' '}
          </Fragment>
        )
      })}
    </p>
  )
}

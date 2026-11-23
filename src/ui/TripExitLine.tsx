import type { ExitLineView } from '../lib/exitView'

interface TripExitLineProps {
  view: ExitLineView
}

/**
 * The way out under a journey's Exit step: the exit, then a dim note (its corner, "probably", a machine whose status
 * is unknown). The visible text is hidden from assistive tech, which hears one sentence with the street names in full
 * instead. Not a live region; never takes focus.
 */
export function TripExitLine({ view }: TripExitLineProps) {
  return (
    <>
      <p aria-hidden="true">{view.text}</p>
      {view.note !== null && (
        <p aria-hidden="true" className="text-xs text-ink-dim">
          {view.note}
        </p>
      )}
      <span className="sr-only">{view.spoken}</span>
    </>
  )
}

import type { TransferLineView } from '../lib/transferView'

interface TripTransferLineProps {
  view: TransferLineView
}

/**
 * The way through a complex under a journey's "Change at …" row: the connectors to the next train's platform (a dim
 * "· probably" after them on an estimated layout), then dim lines for the note (a machine whose status is unknown) and
 * the step-free way ("No step-free way" when the layout has none). The visible text is hidden
 * from assistive tech, which hears one sentence instead. Not a live region; never takes focus.
 */
export function TripTransferLine({ view }: TripTransferLineProps) {
  return (
    <>
      <p aria-hidden="true" className="text-sm text-ink">
        {view.text}
        {view.probably && <span className="text-ink-dim"> · probably</span>}
      </p>
      {view.note !== null && (
        <p aria-hidden="true" className="text-xs text-ink-dim">
          {view.note}
        </p>
      )}
      {view.stepFree !== null && (
        <p aria-hidden="true" className="text-xs text-ink-dim">
          {view.stepFree}
        </p>
      )}
      <span className="sr-only">{view.spoken}</span>
    </>
  )
}

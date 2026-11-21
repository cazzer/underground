import type { InteriorLoad } from '../data/useStationInterior'
import type { InteriorModel } from '../scene/interiorModel'

export interface InteriorStatusInfo {
  load: InteriorLoad
  onRetry: () => void
}

interface InteriorStatusProps {
  info: InteriorStatusInfo
}

interface ReadyLineProps {
  model: InteriorModel
}

/**
 * The line for a loaded interior. The card stays just name and arrivals, so an authored interior shows nothing
 * here and the live region collapses. A generated one says it is estimated; the line shows whether or not the
 * interior is in view, so the live region announces it once per station, not per zoom. Keyed by station: going
 * from one generated station to another whose interior is cached keeps the same text, and only a new node
 * makes the region speak again.
 */
function ReadyLine({ model }: ReadyLineProps) {
  if (!model.approximate) return null
  return (
    <p key={model.stationId} className="text-ink-dim">
      Estimated layout
    </p>
  )
}

function StatusLine({ info: { load, onRetry } }: InteriorStatusProps) {
  switch (load.status) {
    case 'none':
      return null
    case 'loading':
      return <p className="text-ink-dim">Loading station layout…</p>
    case 'error':
      return (
        <>
          <p>Couldn't load the station layout.</p>
          <code className="mt-1 block font-mono break-words text-ink-dim">{load.message}</code>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 min-h-11 cursor-pointer border border-edge px-4 hover:bg-edge/20 focus-visible:outline-2 focus-visible:outline-focus"
          >
            Retry
          </button>
        </>
      )
    case 'ready':
      return <ReadyLine model={load.model} />
  }
}

/** The station panel's interior line. One live region stays mounted, so loading → ready → error is announced. */
export function InteriorStatus({ info }: InteriorStatusProps) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="mt-2 text-xs empty:hidden">
      <StatusLine info={info} />
    </div>
  )
}

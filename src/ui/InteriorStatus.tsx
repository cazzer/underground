import type { InteriorLoad } from '../data/useStationInterior'

export interface InteriorStatusInfo {
  load: InteriorLoad
  /** False while the camera is too far out for the interior to show (past the reveal). */
  revealed: boolean
  onRetry: () => void
}

interface InteriorStatusProps {
  info: InteriorStatusInfo
}

function StatusLine({ info: { load, revealed, onRetry } }: InteriorStatusProps) {
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
      return revealed ? (
        <p className="whitespace-nowrap text-ink-dim">Below street · depth ×{load.model.yScale}</p>
      ) : (
        <p className="text-ink-dim">Zoom in to see the station layout</p>
      )
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

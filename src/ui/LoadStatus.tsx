import type { NetworkLoad } from '../data/useNetwork'

interface LoadStatusProps {
  load: Exclude<NetworkLoad, { status: 'ready' }>
  onRetry: () => void
}

const PANEL = 'border border-edge bg-panel p-4 text-sm text-ink backdrop-blur-sm'

/** Centered loading or error panel shown until the network data is ready. */
export function LoadStatus({ load, onRetry }: LoadStatusProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4">
      {load.status === 'loading' ? (
        <p role="status" className={PANEL}>
          Loading subway map…
        </p>
      ) : (
        <div role="alert" className={`${PANEL} max-w-md`}>
          <p>The subway map data could not be loaded.</p>
          <p className="mt-2 font-mono text-xs break-all text-ink-dim">{load.message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 min-h-11 cursor-pointer border border-edge px-4 hover:bg-edge/20 focus-visible:outline-2 focus-visible:outline-focus"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  )
}

import { useEffect, useRef } from 'react'
import type { NetworkLoad } from '../data/useNetwork'

interface LoadStatusProps {
  load: Exclude<NetworkLoad, { status: 'ready' }>
  onRetry: () => void
}

const PANEL = 'border border-edge bg-panel p-4 text-sm text-ink backdrop-blur-sm'

interface LoadErrorProps {
  message: string
  onRetry: () => void
}

function LoadError({ message, onRetry }: LoadErrorProps) {
  const retry = useRef<HTMLButtonElement>(null)
  // Move focus to the only action, so keyboard users land on it.
  useEffect(() => retry.current?.focus(), [])
  return (
    <div className={`${PANEL} max-w-md`}>
      <p>Couldn't load the subway map. Check your connection and try again.</p>
      <p className="mt-2 font-mono text-xs break-all text-ink-dim">{message}</p>
      <button
        ref={retry}
        type="button"
        onClick={onRetry}
        className="mt-3 min-h-11 cursor-pointer border border-edge px-4 hover:bg-edge/20 focus-visible:outline-2 focus-visible:outline-focus"
      >
        Retry
      </button>
    </div>
  )
}

/** Centered loading or error panel shown until the network data is ready. */
export function LoadStatus({ load, onRetry }: LoadStatusProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4">
      {/* One live region that stays mounted, so loading → error → loading is announced. */}
      <div role="status" aria-live="polite" aria-atomic="true">
        {load.status === 'loading' ? (
          <p className={PANEL}>Loading subway map…</p>
        ) : (
          <LoadError message={load.message} onRetry={onRetry} />
        )}
      </div>
    </div>
  )
}

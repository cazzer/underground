import { useEffect, useRef } from 'react'
import type { NetworkLoad } from '../data/useNetwork'
import { Attribution } from './Attribution'

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

interface CrashProps {
  message: string
}

function ReloadButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="mt-3 min-h-11 cursor-pointer border border-edge px-4 hover:bg-edge/20 focus-visible:outline-2 focus-visible:outline-focus"
    >
      Reload
    </button>
  )
}

/** The scene crashed while rendering: say so (as an alert) and offer the only fix, a reload. */
export function SceneCrash({ message }: CrashProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4">
      <div role="alert" className={`${PANEL} max-w-md`}>
        <p>The map stopped working. Reload the page to try again.</p>
        <p className="mt-2 font-mono text-xs break-all text-ink-dim">{message}</p>
        <ReloadButton />
      </div>
    </div>
  )
}

interface HudCrashProps extends CrashProps {
  /** Called on mount: the HUD never reported its insets, so the scene (which waits for them) must not wait forever. */
  onMounted: () => void
}

/** Stands in for the HUD after it crashes, so the required attribution is never lost. */
export function HudCrash({ message, onMounted }: HudCrashProps) {
  useEffect(onMounted, [onMounted])
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-4 p-4 text-ink">
      <div role="alert" className={`${PANEL} pointer-events-auto w-fit max-w-md`}>
        <p>The panels stopped working. Reload the page to try again.</p>
        <p className="mt-2 font-mono text-xs break-all text-ink-dim">{message}</p>
        <ReloadButton />
      </div>
      <Attribution />
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

import { useState } from 'react'
import { useLive } from './data/useLive'
import { useNetwork } from './data/useNetwork'
import { FocusProvider } from './lib/focus'
import type { Insets } from './lib/framing'
import { Scene } from './scene/Scene'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { Hud } from './ui/Hud'
import { HudCrash, LoadStatus, SceneCrash } from './ui/LoadStatus'
import { LiveDebug } from './ui/LiveDebug'

export function App() {
  const { load, retry } = useNetwork()
  const live = useLive(load.status === 'ready' ? load.files : null)
  // The scene waits for the HUD's measured insets so its opening view can frame around them.
  const [insets, setInsets] = useState<Insets | null>(null)
  return (
    <FocusProvider>
      <main className="relative h-full w-full bg-canvas">
        {load.status === 'ready' ? (
          <>
            <ErrorBoundary fallback={(e) => <SceneCrash message={e.message} />}>
              {insets && <Scene network={load.network} insets={insets} live={live.layer} onLiveError={live.onLayerError} />}
            </ErrorBoundary>
            <ErrorBoundary fallback={(e) => <HudCrash message={e.message} />}>
              <Hud network={load.network} live={live.status} onInsets={setInsets} />
            </ErrorBoundary>
            <LiveDebug debug={live.debug} />
          </>
        ) : (
          <LoadStatus load={load} onRetry={retry} />
        )}
      </main>
    </FocusProvider>
  )
}

import { useState } from 'react'
import { useNetwork } from './data/useNetwork'
import { FocusProvider } from './lib/focus'
import type { Insets } from './lib/framing'
import { Scene } from './scene/Scene'
import { Hud } from './ui/Hud'
import { LoadStatus } from './ui/LoadStatus'

export function App() {
  const { load, retry } = useNetwork()
  // The scene waits for the HUD's measured insets so its opening view can frame around them.
  const [insets, setInsets] = useState<Insets | null>(null)
  return (
    <FocusProvider>
      <main className="relative h-full w-full bg-canvas">
        {load.status === 'ready' ? (
          <>
            {insets && <Scene network={load.network} insets={insets} />}
            <Hud network={load.network} onInsets={setInsets} />
          </>
        ) : (
          <LoadStatus load={load} onRetry={retry} />
        )}
      </main>
    </FocusProvider>
  )
}

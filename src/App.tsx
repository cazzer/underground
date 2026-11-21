import { useNetwork } from './data/useNetwork'
import { FocusProvider } from './lib/focus'
import { Scene } from './scene/Scene'
import { Hud } from './ui/Hud'
import { LoadStatus } from './ui/LoadStatus'

export function App() {
  const { load, retry } = useNetwork()
  return (
    <FocusProvider>
      <main className="relative h-full w-full bg-canvas">
        {load.status === 'ready' ? (
          <>
            <Scene network={load.network} />
            <Hud network={load.network} />
          </>
        ) : (
          <LoadStatus load={load} onRetry={retry} />
        )}
      </main>
    </FocusProvider>
  )
}

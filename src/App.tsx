import { useCallback, useState } from 'react'
import { useLive } from './data/useLive'
import { useNetwork } from './data/useNetwork'
import { useLocate } from './data/useLocate'
import { useStationHash } from './data/useStationHash'
import { useStationInterior } from './data/useStationInterior'
import { FocusProvider, useFocus } from './lib/focus'
import { markedPlacement } from './lib/locate'
import type { Insets } from './lib/framing'
import type { ScreenRect } from './lib/interiorCamera'
import type { Network } from './lib/network'
import { TrainSelectionProvider } from './lib/trainSelection'
import { Scene } from './scene/Scene'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { Hud } from './ui/Hud'
import { HudCrash, LoadStatus, SceneCrash } from './ui/LoadStatus'
import { LiveDebug } from './ui/LiveDebug'

interface MapViewProps {
  network: Network
  live: ReturnType<typeof useLive>
}

/** The map and its HUD; owns the focused station's interior load. */
function MapView({ network, live }: MapViewProps) {
  const { focusedId, flyToPoint } = useFocus()
  const locate = useLocate(network, flyToPoint)
  const interior = useStationInterior(focusedId)
  const stationHash = useStationHash(network)
  // The scene waits for the HUD's measured insets so its opening view can frame around them.
  const [insets, setInsets] = useState<Insets | null>(null)
  // If the HUD crashes before measuring itself, the scene still mounts, framed with no HUD bands.
  const defaultInsets = useCallback(() => setInsets((prev) => prev ?? { top: 0, bottom: 0 }), [])
  const [panel, setPanel] = useState<ScreenRect | null>(null)
  const [interiorRevealed, setInteriorRevealed] = useState(false)
  const placement = markedPlacement(locate.state)
  const here = placement && { ground: placement.ground, accuracyM: placement.accuracyM }
  const model = interior.load.status === 'ready' ? interior.load.model : null
  return (
    <>
      <ErrorBoundary fallback={(e) => <SceneCrash message={e.message} />}>
        {insets && (
          <Scene
            network={network}
            insets={insets}
            live={live.layer}
            onLiveError={live.onLayerError}
            panel={panel}
            interior={model}
            onInteriorRevealed={setInteriorRevealed}
            here={here}
          />
        )}
      </ErrorBoundary>
      <ErrorBoundary fallback={(e) => <HudCrash message={e.message} onMounted={defaultInsets} />}>
        <Hud
          network={network}
          live={live.status}
          arrivals={live.arrivals}
          onInsets={setInsets}
          onPanel={setPanel}
          locate={locate}
          linkNotice={{ show: stationHash.linkNotice, onDismiss: stationHash.dismissLinkNotice }}
          interior={{ load: interior.load, revealed: interiorRevealed, onRetry: interior.retry }}
        />
      </ErrorBoundary>
      <LiveDebug debug={live.debug} technical={live.technical} />
    </>
  )
}

export function App() {
  const { load, retry } = useNetwork()
  const live = useLive(
    load.status === 'ready' ? load.files : null,
    load.status === 'ready' ? load.network.trackOffsetM : 0,
  )
  return (
    <FocusProvider>
      <main className="relative h-full w-full bg-canvas">
        {load.status === 'ready' ? (
          <TrainSelectionProvider layer={live.layer} network={load.network}>
            <MapView network={load.network} live={live} />
          </TrainSelectionProvider>
        ) : (
          <LoadStatus load={load} onRetry={retry} />
        )}
      </main>
    </FocusProvider>
  )
}

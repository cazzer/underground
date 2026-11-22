import { useCallback, useState } from 'react'
import { useBands } from './data/useBands'
import { useEne } from './data/useEne'
import { ENE_URL } from './data/realtime'
import { useLive } from './data/useLive'
import { useNetwork } from './data/useNetwork'
import { useLocate } from './data/useLocate'
import { useStationHash } from './data/useStationHash'
import { useStationInterior } from './data/useStationInterior'
import { FocusProvider, useFocus } from './lib/focus'
import { eneNowS, joinStationOutages } from './lib/live/eneJoin'
import { outagePanelView } from './lib/live/eneText'
import { markedPlacement } from './lib/locate'
import type { Insets } from './lib/framing'
import type { ScreenRect } from './lib/interiorCamera'
import type { Network } from './lib/network'
import type { BandedShapes } from './lib/networkBands'
import { TrainSelectionProvider } from './lib/trainSelection'
import { Scene } from './scene/Scene'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { Hud } from './ui/Hud'
import { HudCrash, LoadStatus, SceneCrash } from './ui/LoadStatus'
import { LiveDebug } from './ui/LiveDebug'

interface MapViewProps {
  network: Network
  /** useNetwork's bands, found after the first paint. */
  bands: Promise<BandedShapes>
  live: ReturnType<typeof useLive>
}

/** The map and its HUD; owns the focused station's interior load. */
function MapView({ network, bands, live }: MapViewProps) {
  const { focusedId, flyToPoint } = useFocus()
  const banded = useBands(bands)
  const locate = useLocate(network, flyToPoint)
  const interior = useStationInterior(focusedId)
  const stationHash = useStationHash(network)
  // The scene waits for the HUD's measured insets so its opening view can frame around them.
  const [insets, setInsets] = useState<Insets | null>(null)
  // If the HUD crashes before measuring itself, the scene still mounts, framed with no HUD bands.
  const defaultInsets = useCallback(() => setInsets((prev) => prev ?? { top: 0, bottom: 0 }), [])
  const [panel, setPanel] = useState<ScreenRect | null>(null)
  const placement = markedPlacement(locate.state)
  const here = placement && { ground: placement.ground, accuracyM: placement.accuracyM }
  const model = interior.load.status === 'ready' ? interior.load.model : null
  // Elevators and escalators out of service at the loaded interior; `outages.status` is the step-free routing's input.
  const ene = useEne(ENE_URL)
  const nowS = eneNowS(live.arrivals?.offsetS ?? null, performance.now(), Date.now())
  const outages = joinStationOutages(model?.interior ?? null, ene, nowS)
  return (
    <>
      <ErrorBoundary fallback={(e) => <SceneCrash message={e.message} />}>
        {insets && (
          <Scene
            network={network}
            banded={banded}
            insets={insets}
            live={live.layer}
            onLiveError={live.onLayerError}
            panel={panel}
            interior={model}
            outOfService={outages.outIds}
            focusedMarker={interior.streetMarker}
            siblings={interior.siblings}
            index={interior.index}
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
          interior={{ load: interior.load, onRetry: interior.retry }}
          outages={outagePanelView(outages, nowS)}
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
    load.status === 'ready' ? load.bands : null,
  )
  return (
    <FocusProvider>
      <main className="relative h-full w-full bg-canvas">
        {load.status === 'ready' ? (
          <TrainSelectionProvider layer={live.layer} network={load.network}>
            <MapView network={load.network} bands={load.bands} live={live} />
          </TrainSelectionProvider>
        ) : (
          <LoadStatus load={load} onRetry={retry} />
        )}
      </main>
    </FocusProvider>
  )
}

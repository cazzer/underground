import { useCallback, useMemo, useState } from 'react'
import { useBands } from './data/useBands'
import { useEne } from './data/useEne'
import { useEquipmentIndex } from './data/useEquipmentIndex'
import { ENE_URL } from './data/realtime'
import { useLive } from './data/useLive'
import { useNetwork } from './data/useNetwork'
import { useLocate } from './data/useLocate'
import { useStationHash } from './data/useStationHash'
import { NO_SIBLINGS } from './data/interiorLoad'
import { useStationInterior } from './data/useStationInterior'
import { useTripExit } from './data/useTripExit'
import { useTripTransfers } from './data/useTripTransfers'
import { FocusProvider, useFocus } from './lib/focus'
import { eneNowS, joinStationOutages } from './lib/live/eneJoin'
import { joinPanelOutages, stationEquipment } from './lib/live/eneIndexJoin'
import { outagePanelView } from './lib/live/eneText'
import { noStepFreeNow } from './lib/live/stepFreeLoss'
import { markedPlacement } from './lib/locate'
import type { Insets } from './lib/framing'
import type { ScreenRect } from './lib/interiorCamera'
import type { StationPathDraw } from './lib/interiorPath'
import type { Network } from './lib/network'
import type { BandedShapes } from './lib/networkBands'
import { PanelCollapseProvider } from './lib/panelCollapse'
import { TrainSelectionProvider } from './lib/trainSelection'
import { TripProvider, useTrip } from './lib/trip'
import { tripNamesOf } from './lib/tripView'
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
  // Elevators and escalators out of service at the loaded interior; `closedForRouting(outages)` is the step-free routing's input.
  const ene = useEne(ENE_URL)
  const nowS = eneNowS(live.arrivals?.offsetS ?? null, performance.now(), Date.now())
  const interiorOutages = joinStationOutages(model?.interior ?? null, ene, nowS)
  // The panel also names machines only the equipment index lists (loaded on the first focus); drawing and routing stay the interior's.
  const equipment = useEquipmentIndex(focusedId, ene.configured)
  const interiorSettled = interior.index.status !== 'loading' && interior.load.status !== 'loading'
  const outages = joinPanelOutages(interiorOutages, model?.interior ?? null, interiorSettled, stationEquipment(equipment, focusedId), ene, nowS)
  const trip = useTrip()
  // The quickest way out at the trip's To station: drawn there, and named in the trip panel.
  const tripExit = useTripExit({ open: trip.open, ends: trip.ends, plan: trip.plan, index: interior.index, ene, nowS, selected: trip.selectedJourney })
  const names = useMemo(() => tripNamesOf(network), [network])
  // The changes of trains inside hand-authored complexes: described in the trip panel, drawn in their interiors.
  const tripTransfers = useTripTransfers({ open: trip.open, ends: trip.ends, plan: trip.plan, index: interior.index, ene, nowS, names, selected: trip.selectedJourney })
  const tripLines = useMemo(
    () => ({ exits: tripExit?.lines ?? null, transfers: tripTransfers.lines, index: interior.index }),
    [tripExit?.lines, tripTransfers.lines, interior.index],
  )
  const exitDraw = tripExit?.drawn ?? null
  const exitInterior = tripExit?.interiorId ?? null
  // The exit first: where an interior has both (a trip can't change at its To station), the exit wins.
  const stationPaths = useMemo<StationPathDraw[]>(
    () => [...(exitDraw && exitInterior ? [{ interiorId: exitInterior, choice: exitDraw }] : []), ...tripTransfers.drawn],
    [exitDraw, exitInterior, tripTransfers.drawn],
  )
  // A complex is one station (the catalog's complex): its other members, for the trip panel and directions.
  const siblingsOf = useCallback(
    (id: string): readonly string[] => network.groupById.get(id)?.memberIds.filter((m) => m !== id) ?? NO_SIBLINGS,
    [network],
  )
  const focusSiblings = useMemo(() => (focusedId === null ? NO_SIBLINGS : siblingsOf(focusedId)), [focusedId, siblingsOf])
  const accessible = focusedId !== null && (network.groupById.get(focusedId)?.access.status ?? 'none') !== 'none'
  const outKey = outages.outIds.join(',')
  const unknownStatus = outages.closed === null
  // Searches the interior's graph, so it reruns only when the machines out (or whether that is known) change.
  const noStepFree = useMemo(
    () => (model ? noStepFreeNow(model.interior, accessible, outages.closed) : false),
    // `outages.closed` is a new Set per render: outKey and unknownStatus say when it really differs.
    [model, accessible, outKey, unknownStatus],
  )
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
            stationPaths={stationPaths}
            exitLabel={tripExit?.drawn ? tripExit.mapLabel : null}
            tripOpen={trip.open}
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
          outages={outagePanelView(outages, nowS, noStepFree)}
          tripLines={tripLines}
          focusSiblings={focusSiblings}
          siblingsOf={siblingsOf}
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
    <main className="relative h-full w-full bg-canvas">
      {load.status === 'ready' ? (
        <FocusProvider groups={load.network.groupById}>
          <TrainSelectionProvider layer={live.layer} network={load.network}>
            <TripProvider stations={load.files.stations} arrivals={live.arrivals}>
              <PanelCollapseProvider>
                <MapView network={load.network} bands={load.bands} live={live} />
              </PanelCollapseProvider>
            </TripProvider>
          </TrainSelectionProvider>
        </FocusProvider>
      ) : (
        <LoadStatus load={load} onRetry={retry} />
      )}
    </main>
  )
}

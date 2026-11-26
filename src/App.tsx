import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAmenities } from './data/useAmenities'
import { useBands } from './data/useBands'
import { useEne } from './data/useEne'
import { useEquipmentIndex } from './data/useEquipmentIndex'
import { ENE_URL } from './data/realtime'
import { useLive } from './data/useLive'
import { useNetwork } from './data/useNetwork'
import { useServiceChanges } from './data/useServiceChanges'
import { useLocate } from './data/useLocate'
import { useStationHash } from './data/useStationHash'
import { NO_SIBLINGS } from './data/interiorLoad'
import { useStationInterior } from './data/useStationInterior'
import { useTripBoard } from './data/useTripBoard'
import { useTripExit } from './data/useTripExit'
import { useTripRoute } from './data/useTripRoute'
import { useTripTransfers } from './data/useTripTransfers'
import { usePlaceLine } from './ui/usePlaceLine'
import { FocusProvider, useFocus } from './lib/focus'
import { eneNowS, joinStationOutages } from './lib/live/eneJoin'
import { joinPanelOutages, stationEquipment } from './lib/live/eneIndexJoin'
import { outagePanelView } from './lib/live/eneText'
import { noStepFreeNow } from './lib/live/stepFreeLoss'
import { markedPlacement } from './lib/locate'
import type { Insets } from './lib/framing'
import type { ExitLabel } from './lib/exitView'
import type { ScreenRect } from './lib/interiorCamera'
import type { StationPathDraw } from './lib/interiorPath'
import type { Network } from './lib/network'
import type { BandedShapes } from './lib/networkBands'
import { PanelCollapseProvider, usePanelCollapse } from './lib/panelCollapse'
import { TrainSelectionProvider, useTrainSelection } from './lib/trainSelection'
import { TripProvider, useTrip } from './lib/trip'
import { tripNamesOf } from './lib/tripView'
import { Scene } from './scene/Scene'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { Hud } from './ui/Hud'
import { HudCrash, LoadStatus, SceneCrash } from './ui/LoadStatus'
import { LiveDebug } from './ui/LiveDebug'
import { MapReveal } from './ui/MapReveal'

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
  const paths = banded?.shapes ?? network.shapes
  const locate = useLocate(network, flyToPoint)
  // The picked place: its line is the HUD's, its pin the scene's.
  const place = usePlaceLine()
  // Following a train is a flight like any other: it ends the place line, and so its pin.
  const { following } = useTrainSelection()
  const { clear: clearPlace } = place
  useEffect(() => {
    if (following) clearPlace()
  }, [following, clearPlace])
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
  // Restrooms and customer service centers: fetched once after mount (not gated on the Worker), retried on a focus change after a failure.
  const amenities = useAmenities(focusedId)
  const interiorSettled = interior.index.status !== 'loading' && interior.load.status !== 'loading'
  const outages = joinPanelOutages(interiorOutages, model?.interior ?? null, interiorSettled, stationEquipment(equipment, focusedId), ene, nowS)
  // The MTA's service changes: the focused station's rows, the skip sets, the header's list and the picked one's drawing.
  const { changes, skips, changeList, changeNote, changeRoute } = useServiceChanges({ network, paths, focusedId, nowS, lookup: live.lookup, lookupFailed: live.lookupFailed })
  const trip = useTrip()
  // The quickest way out at the trip's To station: drawn there, and named in the trip panel.
  // Only once the visitor chose the To (an end filled from the fix, then swapped there, waits for a focus or pick).
  const tripExit = useTripExit({
    open: trip.open,
    ends: trip.ends,
    plan: trip.plan,
    index: interior.index,
    ene,
    nowS,
    selected: trip.selectedJourney,
    allowed: trip.fixEnd !== 'to',
  })
  // The selected journey's ride legs on the drawn lines; drawn (and the network dimmed) while the trip panel is in front.
  const tripRoute = useTripRoute({
    network,
    paths,
    open: trip.open,
    plan: trip.plan,
    selection: trip.selection,
    journey: trip.selectedJourney,
  })
  // A picked service change draws in the trip's place while the changes list is in front (a trip under it waits).
  const { front } = usePanelCollapse()
  const route = changeRoute?.route ?? tripRoute
  const routeShown = route !== null && (route.kind === 'change' ? front === 'changes' : front === 'trip')
  // A complex is one station (the catalog's complex): its other members, for the trip panel and directions.
  const siblingsOf = useCallback(
    (id: string): readonly string[] => network.groupById.get(id)?.memberIds.filter((m) => m !== id) ?? NO_SIBLINGS,
    [network],
  )
  const fromId = trip.ends.from
  const fromStations = useMemo(() => new Set(fromId === null ? [] : [fromId, ...siblingsOf(fromId)]), [fromId, siblingsOf])
  // The quickest way in at the From station, only once the visitor chose it (a From filled from the fix waits for a focus or pick).
  const tripBoard = useTripBoard({
    open: trip.open,
    ends: trip.ends,
    plan: trip.plan,
    index: interior.index,
    ene,
    nowS,
    selected: trip.selectedJourney,
    fromStations,
    allowed: trip.fixEnd !== 'from',
  })
  const names = useMemo(() => tripNamesOf(network), [network])
  // The changes of trains inside hand-authored complexes: described in the trip panel, drawn in their interiors.
  const tripTransfers = useTripTransfers({ open: trip.open, ends: trip.ends, plan: trip.plan, index: interior.index, ene, nowS, names, selected: trip.selectedJourney })
  const tripLines = useMemo(
    () => ({ exits: tripExit?.lines ?? null, transfers: tripTransfers.lines, index: interior.index, boards: tripBoard?.lines ?? null }),
    [tripExit?.lines, tripTransfers.lines, interior.index, tripBoard?.lines],
  )
  const exitDraw = tripExit?.drawn ?? null
  const exitInterior = tripExit?.interiorId ?? null
  const boardDraw = tripBoard?.drawn ?? null
  const boardInterior = tripBoard?.interiorId ?? null
  // The exit, then the way in, then the changes: the first for an interior draws. From and To are never one complex,
  // and where the From complex also holds a change of trains, the way in wins.
  const stationPaths = useMemo<StationPathDraw[]>(
    () => [
      ...(exitDraw && exitInterior ? [{ interiorId: exitInterior, choice: exitDraw }] : []),
      ...(boardDraw && boardInterior ? [{ interiorId: boardInterior, choice: boardDraw }] : []),
      ...tripTransfers.drawn,
    ],
    [exitDraw, exitInterior, boardDraw, boardInterior, tripTransfers.drawn],
  )
  // The drawn exit's and way in's entrances, which the street labels place first and tint.
  const exitLabel = tripExit?.drawn ? tripExit.mapLabel : null
  const boardLabel = tripBoard?.drawn ? tripBoard.mapLabel : null
  const pathLabels = useMemo(() => [exitLabel, boardLabel].filter((l): l is ExitLabel => l !== null), [exitLabel, boardLabel])
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
          <>
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
              placePin={place.shown?.ground ?? null}
              stationPaths={stationPaths}
              pathLabels={pathLabels}
              tripOpen={trip.open}
              route={route}
              routeShown={routeShown}
              tripRoute={tripRoute}
              amenities={amenities.state === 'ready' ? amenities.index : null}
            />
            {/* Decoration: a crash here shows the map at once. */}
            <ErrorBoundary fallback={null}>
              <MapReveal insets={insets} panel={panel} />
            </ErrorBoundary>
          </>
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
          place={place}
          linkNotice={{ show: stationHash.linkNotice, onDismiss: stationHash.dismissLinkNotice }}
          interior={{ load: interior.load, onRetry: interior.retry }}
          outages={outagePanelView(outages, nowS, noStepFree)}
          changes={changes}
          skips={skips}
          amenities={amenities.state === 'ready' ? amenities.index : null}
          changeList={changeList}
          changeNote={changeNote}
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

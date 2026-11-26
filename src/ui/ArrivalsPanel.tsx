import { useCallback, useId, useMemo, type Ref, type RefObject } from 'react'
import type { ArrivalsSource } from '../lib/live/arrivals'
import type { AlertSkips } from '../lib/live/alertSkips'
import type { ServiceChangeView } from '../lib/live/alertText'
import type { OutagePanelView } from '../lib/live/eneText'
import type { LiveStatus as LiveStatusValue } from '../lib/live/liveStatus'
import { useStationStreets } from '../data/useStationStreets'
import { listsStationFn } from '../lib/entranceList'
import type { AmenitiesFile } from '../data/amenitiesSchema'
import { groupAmenities } from '../lib/amenityGlyphs'
import { accessLabel, amenityLabel, spokenAfterName } from '../lib/labels'
import type { Network } from '../lib/network'
import type { TripEnd } from '../lib/trip'
import { PartialAccessNote, StationName } from './AccessIcon'
import { CscNote } from './AmenityIcon'
import { ArrivalsList } from './ArrivalsList'
import { EntranceList } from './EntranceList'
import { InteriorStatus, type InteriorStatusInfo } from './InteriorStatus'
import { OutageAnnouncer, OutageStatus } from './OutageStatus'
import { ServiceChangeAnnouncer, ServiceChangeStatus } from './ServiceChangeStatus'
import { CollapseButton, ExpandBar } from './PanelBar'
import type { LineFilterControl } from './useLineFilter'
import { usePanelToggle } from './usePanelToggle'

interface ArrivalsPanelProps {
  network: Network
  stationId: string
  live: LiveStatusValue
  arrivals: ArrivalsSource | null
  interior: InteriorStatusInfo
  /** Elevators and escalators out of service at the focused station. */
  outages: OutagePanelView
  /** The MTA service changes that concern the focused station (skips, suspensions, notices). */
  changes: ServiceChangeView
  /** The MTA's skip alerts: a row whose route and direction skip this station says so. */
  skips: AlertSkips | null
  /** The arrivals' line filter, held by the HUD so a train panel covering this one doesn't reset it. */
  lineFilter: LineFilterControl
  /** The station amenities (restrooms, customer service centers), or null until loaded (or when the load failed): no glyphs. */
  amenities: AmenitiesFile | null
  /** "Directions from here" and "Directions to here": open the trip panel with this station as that end. Absent when navigation is off: no directions row. */
  onDirections?: (end: TripEnd) => void
  ref: Ref<HTMLElement>
  /** The heading, or the bar while collapsed: takes focus when a panel that covered this one closes, or after the visitor picks this station from search. */
  headingRef: RefObject<HTMLElement | null>
}

const LINK =
  'flex min-h-11 cursor-pointer items-center px-2 text-ink-dim underline hover:text-ink focus-visible:outline-2 focus-visible:outline-focus'

export function ArrivalsPanel({ network, stationId, live, arrivals, interior, outages, changes, skips, lineFilter, amenities, onDirections, ref, headingRef }: ArrivalsPanelProps) {
  // The street file loads on focus only (the scene's streets share it through the cache); nothing shows until it is in.
  const streets = useStationStreets(stationId)
  // The merged station's members all count as "listing" the station, so another member's elevators rank like the lead's own.
  const memberIds = network.groupById.get(stationId)?.memberIds ?? [stationId]
  const listsStation = useMemo(() => (streets ? listsStationFn(streets.file.entrances, memberIds) : undefined), [streets, memberIds])
  const { collapsed, collapse, expand } = usePanelToggle('station', headingRef)
  const bodyId = useId()
  const setHeading = useCallback((el: HTMLElement | null) => { headingRef.current = el }, [headingRef])
  const station = network.groupById.get(stationId)
  if (!station) throw new Error(`Arrivals panel for unknown station "${stationId}"`)
  const access = accessLabel(station.access)
  // Said after the name (and its access words) only when this station is skipped right now, so a rider hears it first.
  const skipSaid = changes.skipSpoken
  const { kinds, cscEntrance } = groupAmenities(amenities?.stations ?? {}, memberIds)
  const nameSaid = spokenAfterName(access, outages.noStepFree, amenityLabel(kinds, cscEntrance))
  const barLabel = `Arrivals at ${station.name}${nameSaid}${skipSaid === '' ? '' : `${nameSaid === '' ? '. ' : ' '}${skipSaid}`}`
  return (
    <aside
      ref={ref}
      aria-label={`Arrivals at ${station.name}`}
      className={`pointer-events-auto max-h-full min-h-0 ${collapsed ? 'w-full' : 'w-72'} max-w-full overflow-auto border border-edge bg-panel text-ink backdrop-blur-sm sm:w-72 sm:shrink-0 ${collapsed ? '' : 'p-4'}`}
    >
      {collapsed ? (
        <ExpandBar ref={setHeading} label={barLabel} controls={bodyId} onExpand={expand}>
          <span aria-hidden="true">
            <StationName name={station.name} access={station.access} context="card" amenities={kinds} />
          </span>
        </ExpandBar>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <h2 ref={setHeading} tabIndex={-1} className="text-lg leading-tight outline-none focus-visible:outline-2 focus-visible:outline-focus">
            <StationName name={station.name} access={station.access} context="card" noStepFreeNow={outages.noStepFree} amenities={kinds} cscEntrance={cscEntrance} />
            {skipSaid !== '' && <>{' '}<span className="sr-only">{skipSaid}</span></>}
          </h2>
          <CollapseButton label="Collapse station panel" controls={bodyId} onCollapse={collapse} />
        </div>
      )}
      {/* Outside the body, which is hidden when collapsed: a hidden live region says nothing. */}
      <OutageAnnouncer view={outages} stationId={stationId} />
      <ServiceChangeAnnouncer view={changes} stationId={stationId} />
      <div id={bodyId} hidden={collapsed}>
        {station.otherNames.length > 0 && <p className="mt-1 text-sm text-ink-dim">with {station.otherNames.join(', ')}</p>}
        <PartialAccessNote access={station.access} />
        <CscNote entrance={cscEntrance} />
        {onDirections && (
          <p className="-ml-2 mt-1 flex flex-wrap text-sm">
            <button type="button" onClick={() => onDirections('from')} className={LINK}>
              Directions from here
            </button>
            <button type="button" onClick={() => onDirections('to')} className={LINK}>
              Directions to here
            </button>
          </p>
        )}
        <InteriorStatus info={interior} />
        <OutageStatus view={outages} stationId={stationId} onFocusLost={() => headingRef.current?.focus()} />
        <ServiceChangeStatus view={changes} stationId={stationId} routeById={network.routeById} onFocusLost={() => headingRef.current?.focus()} />
        <ArrivalsList key={`arrivals-${stationId}`} network={network} station={station} source={arrivals} status={live} skips={skips} lineFilter={lineFilter} onFocusLost={() => headingRef.current?.focus()} />
        <EntranceList entrances={streets?.entrances ?? null} listsStation={listsStation} />
      </div>
    </aside>
  )
}

import { useCallback, useId, useMemo, type Ref, type RefObject } from 'react'
import type { ArrivalsSource } from '../lib/live/arrivals'
import type { OutagePanelView } from '../lib/live/eneText'
import type { LiveStatus as LiveStatusValue } from '../lib/live/liveStatus'
import { useStationStreets } from '../data/useStationStreets'
import { listsStationFn } from '../lib/entranceList'
import { accessLabel } from '../lib/labels'
import type { Network } from '../lib/network'
import { PartialAccessNote, StationName } from './AccessIcon'
import { ArrivalsList } from './ArrivalsList'
import { EntranceList } from './EntranceList'
import { InteriorStatus, type InteriorStatusInfo } from './InteriorStatus'
import { OutageStatus } from './OutageStatus'
import { CollapseButton, ExpandBar } from './PanelBar'
import { usePanelToggle } from './usePanelToggle'

interface ArrivalsPanelProps {
  network: Network
  stationId: string
  live: LiveStatusValue
  arrivals: ArrivalsSource | null
  interior: InteriorStatusInfo
  /** Elevators and escalators out of service at the focused station. */
  outages: OutagePanelView
  ref: Ref<HTMLElement>
  /** The heading, or the bar while collapsed: takes focus when a panel that covered this one closes, or after the visitor picks this station from search. */
  headingRef: RefObject<HTMLElement | null>
}

export function ArrivalsPanel({ network, stationId, live, arrivals, interior, outages, ref, headingRef }: ArrivalsPanelProps) {
  // The street file loads on focus only (the scene's streets share it through the cache); nothing shows until it is in.
  const streets = useStationStreets(stationId)
  const listsStation = useMemo(() => (streets ? listsStationFn(streets.file.entrances, stationId) : undefined), [streets, stationId])
  const { collapsed, collapse, expand } = usePanelToggle('station', headingRef)
  const bodyId = useId()
  const setHeading = useCallback((el: HTMLElement | null) => { headingRef.current = el }, [headingRef])
  const station = network.stationById.get(stationId)
  if (!station) throw new Error(`Arrivals panel for unknown station "${stationId}"`)
  const access = accessLabel(station.access)
  const barLabel = `Arrivals at ${station.name}${access === null ? '' : `, ${access}${outages.noStepFree ? '; no step-free access now' : ''}.`}`
  return (
    <aside
      ref={ref}
      aria-label={`Arrivals at ${station.name}`}
      className={`pointer-events-auto max-h-full min-h-0 ${collapsed ? 'w-full' : 'w-72'} max-w-full overflow-auto border border-edge bg-panel text-ink backdrop-blur-sm sm:w-72 sm:shrink-0 ${collapsed ? '' : 'p-4'}`}
    >
      {collapsed ? (
        <ExpandBar ref={setHeading} label={barLabel} controls={bodyId} onExpand={expand}>
          <span aria-hidden="true">
            <StationName name={station.name} access={station.access} context="card" />
          </span>
        </ExpandBar>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <h2 ref={setHeading} tabIndex={-1} className="text-lg leading-tight outline-none focus-visible:outline-2 focus-visible:outline-focus">
            <StationName name={station.name} access={station.access} context="card" noStepFreeNow={outages.noStepFree} />
          </h2>
          <CollapseButton label="Collapse station panel" controls={bodyId} onCollapse={collapse} />
        </div>
      )}
      <div id={bodyId} hidden={collapsed}>
        <PartialAccessNote access={station.access} />
        <InteriorStatus info={interior} />
        <OutageStatus view={outages} stationId={stationId} onFocusLost={() => headingRef.current?.focus()} />
        <ArrivalsList key={`arrivals-${stationId}`} network={network} station={station} source={arrivals} status={live} onFocusLost={() => headingRef.current?.focus()} />
        <EntranceList key={stationId} entrances={streets?.entrances ?? null} listsStation={listsStation} onFocusLost={() => headingRef.current?.focus()} />
      </div>
    </aside>
  )
}

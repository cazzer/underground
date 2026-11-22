import type { Ref, RefObject } from 'react'
import type { ArrivalsSource } from '../lib/live/arrivals'
import type { OutagePanelView } from '../lib/live/eneText'
import type { LiveStatus as LiveStatusValue } from '../lib/live/liveStatus'
import { useStationStreets } from '../data/useStationStreets'
import type { Network } from '../lib/network'
import { PartialAccessNote, StationName } from './AccessIcon'
import { ArrivalsList } from './ArrivalsList'
import { EntranceList } from './EntranceList'
import { InteriorStatus, type InteriorStatusInfo } from './InteriorStatus'
import { OutageStatus } from './OutageStatus'

interface ArrivalsPanelProps {
  network: Network
  stationId: string
  live: LiveStatusValue
  arrivals: ArrivalsSource | null
  onClose: () => void
  interior: InteriorStatusInfo
  /** Elevators and escalators out of service at the focused station. */
  outages: OutagePanelView
  ref: Ref<HTMLElement>
  /** Takes focus when a panel that covered this one closes, or after the visitor picks this station from search. */
  headingRef: RefObject<HTMLHeadingElement | null>
}

export function ArrivalsPanel({ network, stationId, live, arrivals, onClose, interior, outages, ref, headingRef }: ArrivalsPanelProps) {
  // The street file loads on focus only (the scene's streets share it through the cache); nothing shows until it is in.
  const streets = useStationStreets(stationId)
  const station = network.stationById.get(stationId)
  if (!station) throw new Error(`Arrivals panel for unknown station "${stationId}"`)
  return (
    <aside
      ref={ref}
      aria-label={`Arrivals at ${station.name}`}
      className="pointer-events-auto max-h-full min-h-0 w-72 max-w-full overflow-auto border border-edge bg-panel p-4 text-ink backdrop-blur-sm sm:shrink-0"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg leading-tight outline-none focus-visible:outline-2 focus-visible:outline-focus">
          <StationName name={station.name} access={station.access} context="card" noStepFreeNow={outages.noStepFree} />
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close station panel"
          className="-m-2 flex min-h-11 min-w-11 cursor-pointer items-center justify-center p-2 text-ink-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
        >
          ×
        </button>
      </div>
      <PartialAccessNote access={station.access} />
      <InteriorStatus info={interior} />
      <OutageStatus view={outages} stationId={stationId} onFocusLost={() => headingRef.current?.focus()} />
      <ArrivalsList network={network} station={station} source={arrivals} status={live} />
      <EntranceList key={stationId} entrances={streets?.entrances ?? null} onFocusLost={() => headingRef.current?.focus()} />
    </aside>
  )
}

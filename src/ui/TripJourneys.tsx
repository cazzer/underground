import { useId, useState } from 'react'
import type { Network } from '../lib/network'
import type { JourneyView, LegView } from '../lib/tripView'
import { RouteChip } from './RouteChip'

interface TripJourneysProps {
  network: Network
  views: readonly JourneyView[]
  /** A station name was pressed: the one place the trip panel moves the camera. */
  onStation: (stationId: string) => void
  /** The trips the map draws as trains (keyed as a live ride leg's `tripId`); only those can be shown. */
  drawnKeys: ReadonlySet<string> | null
  /** "Show train" was pressed on a live ride leg: selects that train (its panel then covers the trip). */
  onShowTrain: (tripId: string) => void
}

interface LegProps {
  network: Network
  leg: LegView
  /** The journey mixes live and scheduled trains, so a scheduled one says so. */
  mixed: boolean
  drawnKeys: ReadonlySet<string> | null
  onStation: (stationId: string) => void
  onShowTrain: (tripId: string) => void
}

interface StationLinkProps {
  stationId: string
  name: string
  onStation: (stationId: string) => void
}

function StationLink({ stationId, name, onStation }: StationLinkProps) {
  return (
    <button
      type="button"
      onClick={() => onStation(stationId)}
      aria-description="Show on map"
      className="-my-3 inline-flex min-h-11 cursor-pointer items-center text-left underline hover:text-focus focus-visible:outline-2 focus-visible:outline-focus"
    >
      {name}
    </button>
  )
}

function Leg({ network, leg, mixed, drawnKeys, onStation, onShowTrain }: LegProps) {
  if (leg.kind === 'change') {
    return (
      <li className="text-ink-dim">
        Change at {leg.name}
        {leg.minutes !== null && ` · ${leg.minutes} min`}
      </li>
    )
  }
  if (leg.kind === 'walk') {
    return (
      <li className="text-ink-dim">
        Walk to {leg.to} · {leg.minutes} min
      </li>
    )
  }
  const route = network.routeById.get(leg.routeId)
  return (
    <li>
      <p className="flex items-center gap-2">
        {route ? <RouteChip route={route} as="span" className="min-w-9 shrink-0 text-center" /> : <span>{leg.routeId}</span>}
        <span className="min-w-0">
          <span className="text-ink-dim">to</span> {leg.headsign}
          {mixed && !leg.live && <span className="text-ink-dim"> · scheduled</span>}
        </span>
      </p>
      <p className="text-sm">
        Board {leg.board.clock} at <StationLink stationId={leg.board.stationId} name={leg.board.name} onStation={onStation} />
      </p>
      <p className="text-sm">
        {leg.stopsText}, off {leg.alight.clock} at <StationLink stationId={leg.alight.stationId} name={leg.alight.name} onStation={onStation} />
      </p>
      {leg.live && drawnKeys?.has(leg.tripId) && (
        <button
          type="button"
          onClick={() => onShowTrain(leg.tripId)}
          aria-label={`Show train, ${route?.shortName ?? leg.routeId} to ${leg.headsign}`}
          className="-ml-2 flex min-h-11 cursor-pointer items-center px-2 text-sm underline hover:text-focus focus-visible:outline-2 focus-visible:outline-focus"
        >
          Show train
        </button>
      )}
    </li>
  )
}

interface JourneyProps {
  network: Network
  view: JourneyView
  open: boolean
  onToggle: () => void
  onStation: (stationId: string) => void
  drawnKeys: ReadonlySet<string> | null
  onShowTrain: (tripId: string) => void
}

function Journey({ network, view, open, onToggle, onStation, drawnKeys, onShowTrain }: JourneyProps) {
  const legsId = useId()
  return (
    <li className="border-t border-edge first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={legsId}
        className="flex min-h-11 w-full cursor-pointer flex-col items-start gap-1 py-2 text-left hover:text-focus focus-visible:outline-2 focus-visible:outline-focus"
      >
        <span aria-hidden="true" className="flex flex-wrap gap-x-2 text-base">
          <span className="whitespace-nowrap">
            {view.departClock} → {view.arriveClock} ·
          </span>
          <span className="whitespace-nowrap">{view.minutes} min ·</span>
          <span className="whitespace-nowrap">{view.transfersText.toLowerCase()}</span>
        </span>
        <span aria-hidden="true" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-dim">
          {view.routes.map((id, i) => {
            const route = network.routeById.get(id)
            return route ? <RouteChip key={i} route={route} as="span" className="min-w-7 text-center" /> : <span key={i}>{id}</span>
          })}
          <span className="whitespace-nowrap">
            {view.departAway === 'Now' ? 'Leaves now' : `Leaves in ${view.departAway}`} · {view.sourceText}
          </span>
        </span>
        <span className="sr-only">{view.spoken}</span>
      </button>
      <ol id={legsId} hidden={!open} className="flex flex-col gap-2 pb-3 pl-1 text-sm">
        {view.legs.map((leg, i) => (
          <Leg key={i} network={network} leg={leg} mixed={view.source === 'mixed'} drawnKeys={drawnKeys} onStation={onStation} onShowTrain={onShowTrain} />
        ))}
      </ol>
    </li>
  )
}

/** The journeys as disclosures, soonest arrival first; the first starts open, the rest collapsed. */
export function TripJourneys({ network, views, onStation, drawnKeys, onShowTrain }: TripJourneysProps) {
  // Only the ones the visitor toggled are kept; the rest follow the default (the first is open).
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map())
  if (views.length === 0) return null
  return (
    <ol className="mt-2" aria-label="Trips">
      {views.map((view, i) => (
        <Journey
          key={view.key}
          network={network}
          view={view}
          open={toggled.get(view.key) ?? i === 0}
          onToggle={() => setToggled((m) => new Map(m).set(view.key, !(m.get(view.key) ?? i === 0)))}
          onStation={onStation}
          drawnKeys={drawnKeys}
          onShowTrain={onShowTrain}
        />
      ))}
    </ol>
  )
}

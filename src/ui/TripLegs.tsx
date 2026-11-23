import { useRef } from 'react'
import type { ExitLineView } from '../lib/exitView'
import type { Network } from '../lib/network'
import type { TransferLineView } from '../lib/transferView'
import type { JourneyView, LegView, RideLegView } from '../lib/tripView'
import { RouteChip } from './RouteChip'
import { TripExitLine } from './TripExitLine'
import { TripTransferLine } from './TripTransferLine'

interface LegProps {
  network: Network
  leg: LegView
  /** The journey mixes live and scheduled trains, so a scheduled one says so. */
  mixed: boolean
  drawnKeys: ReadonlySet<string> | null
  onStation: (stationId: string) => void
  onShowTrain: (tripId: string) => void
  transfers: ReadonlyMap<string, TransferLineView> | null
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

interface ShowTrainProps {
  leg: RideLegView
  routeName: string
  /** The leg is live and the map draws its train. */
  drawn: boolean
  onShowTrain: (tripId: string) => void
}

/**
 * Once offered, the button stays: a poll that moves the train off the map leaves it as an aria-disabled no-op (the
 * station panel's arrival rows do the same), so focus is never dropped from under the visitor.
 */
function ShowTrain({ leg, routeName, drawn, onShowTrain }: ShowTrainProps) {
  const offered = useRef(false)
  if (drawn) offered.current = true
  if (!offered.current) return null
  return (
    <button
      type="button"
      aria-disabled={drawn ? undefined : true}
      aria-label={`Show train, ${routeName} to ${leg.headsign}`}
      aria-description={drawn ? undefined : "This train isn't on the map right now"}
      onClick={() => drawn && onShowTrain(leg.tripId)}
      className="-ml-2 inline-flex min-h-11 cursor-pointer items-center self-start px-2 text-sm underline hover:text-focus focus-visible:outline-2 focus-visible:outline-focus aria-disabled:cursor-default aria-disabled:text-ink-dim aria-disabled:no-underline aria-disabled:hover:text-ink-dim"
    >
      Show train
    </button>
  )
}

function Leg({ network, leg, mixed, drawnKeys, onStation, onShowTrain, transfers }: LegProps) {
  if (leg.kind === 'change') {
    const transfer = transfers?.get(leg.transferKey)
    return (
      <li>
        <p className="text-ink-dim">
          Change at {leg.name}
          {leg.minutes !== null && ` · ${leg.minutes} min`}
        </p>
        {transfer && <TripTransferLine view={transfer} />}
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
      <ShowTrain leg={leg} routeName={route?.shortName ?? leg.routeId} drawn={leg.live && drawnKeys?.has(leg.tripId) === true} onShowTrain={onShowTrain} />
    </li>
  )
}

export interface JourneyLegsProps {
  network: Network
  view: JourneyView
  onStation: (stationId: string) => void
  drawnKeys: ReadonlySet<string> | null
  onShowTrain: (tripId: string) => void
  exits: ReadonlyMap<string, ExitLineView> | null
  transfers: ReadonlyMap<string, TransferLineView> | null
}

/** A journey's legs in travel order, then the way out at its To station when it ends on a train. */
export function JourneyLegs({ network, view, onStation, drawnKeys, onShowTrain, exits, transfers }: JourneyLegsProps) {
  const last = view.legs.at(-1)
  const exit = last?.kind === 'ride' ? exits?.get(last.tripId) : undefined
  return (
    <ol className="flex flex-col gap-2 pb-3 pl-1 text-sm">
      {view.legs.map((leg, i) => (
        <Leg
          key={i}
          network={network}
          leg={leg}
          mixed={view.source === 'mixed'}
          drawnKeys={drawnKeys}
          onStation={onStation}
          onShowTrain={onShowTrain}
          transfers={transfers}
        />
      ))}
      {exit && <TripExitLine view={exit} />}
    </ol>
  )
}

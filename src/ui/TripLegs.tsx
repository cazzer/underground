import { useRef } from 'react'
import type { ExitLineView } from '../lib/exitView'
import { routeSpokenName } from '../lib/labels'
import type { Network } from '../lib/network'
import type { TransferLineView } from '../lib/transferView'
import type { StationLayout } from '../data/interiorLoad'
import { journeyItinerary, type StepContext } from '../lib/tripSteps'
import type { JourneyView, LegView, RideLegView } from '../lib/tripView'
import { RouteChip } from './RouteChip'
import { TripExitLine } from './TripExitLine'
import { TripStepButton } from './TripStepButton'
import { TripTransferLine } from './TripTransferLine'

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

interface LegProps {
  network: Network
  leg: LegView
  /** The ride says when it gets off (no Exit step follows it with the time), and where when `offPlace` names the station (a walk follows). */
  showOff: boolean
  offPlace: string | null
  /** The journey mixes live and scheduled trains, so a scheduled one says so. */
  mixed: boolean
  drawnKeys: ReadonlySet<string> | null
  onShowTrain: (tripId: string) => void
}

/** A ride (route, headsign, stops and when it gets off, Show train) or a walk; a change is a step, never a leg row. */
function Leg({ network, leg, showOff, offPlace, mixed, drawnKeys, onShowTrain }: LegProps) {
  if (leg.kind === 'change') return null // unreachable: a change is always a step
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
      <p className="text-sm text-ink-dim">
        {leg.stopsText}
        {showOff && ` · off ${leg.alight.clock}${offPlace !== null ? ` at ${offPlace}` : ''}`}
      </p>
      <ShowTrain leg={leg} routeName={route?.shortName ?? leg.routeId} drawn={leg.live && drawnKeys?.has(leg.tripId) === true} onShowTrain={onShowTrain} />
    </li>
  )
}

export interface JourneyLegsProps {
  network: Network
  view: JourneyView
  drawnKeys: ReadonlySet<string> | null
  onShowTrain: (tripId: string) => void
  exits: ReadonlyMap<string, ExitLineView> | null
  transfers: ReadonlyMap<string, TransferLineView> | null
  /** What the station's interior is (null until the station index is ready): a step says where there is none. */
  layoutOf: (stationId: string) => StationLayout
  /** The way to the first platform at the From station (2q7.45.7): the visible line and the sentence a screen reader hears; null or absent: none. */
  board?: { text: string; spoken: string } | null
  /** The pressed step's key while it holds. */
  activeStep: string | null
  /** A step was pressed: flies to its station and makes it the active step. */
  onStep: (key: string, stationId: string) => void
}

/**
 * The journey as an itinerary in travel order: a Board step, the ride, a Change step per change, the next ride, the Exit
 * step. A step is a button that flies to its station, with the way through it (the change's transfer line, the exit line)
 * beside the button, never inside it.
 */
export function JourneyLegs({ network, view, drawnKeys, onShowTrain, exits, transfers, layoutOf, board = null, activeStep, onStep }: JourneyLegsProps) {
  const ctx: StepContext = {
    layoutOf,
    routeName: (id) => network.routeById.get(id)?.shortName ?? id,
    routeSpoken: (id) => routeSpokenName(network.routeById.get(id)?.shortName ?? id),
    hasBoardPath: board !== null,
    hasExitPath: (tripId) => exits?.has(tripId) === true,
    hasTransferPath: (key) => transfers?.has(key) === true,
  }
  const rows = journeyItinerary(view.legs, ctx)
  const firstBoard = rows.find((r) => r.kind === 'step' && r.step.kind === 'board')
  return (
    <ol className="flex flex-col gap-2 pb-3 pl-1 text-sm">
      {rows.map((row) => {
        if (row.kind === 'leg') {
          return <Leg key={`leg:${row.index}`} network={network} leg={row.leg} showOff={row.showOff} offPlace={row.offPlace} mixed={view.source === 'mixed'} drawnKeys={drawnKeys} onShowTrain={onShowTrain} />
        }
        const { step } = row
        const transfer = step.transferKey !== null ? transfers?.get(step.transferKey) : undefined
        const exit = step.tripId !== null ? exits?.get(step.tripId) : undefined
        return (
          <li key={step.key}>
            <TripStepButton step={step} active={activeStep === step.key} onPress={onStep} />
            {row === firstBoard && board && (
              <>
                <p aria-hidden="true">{board.text}</p>
                <span className="sr-only">{board.spoken}</span>
              </>
            )}
            {transfer && <TripTransferLine view={transfer} />}
            {exit && <TripExitLine view={exit} />}
          </li>
        )
      })}
    </ol>
  )
}

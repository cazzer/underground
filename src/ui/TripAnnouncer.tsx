import { useEffect, useRef, useState } from 'react'
import { ANNOUNCE_DELAY_MS } from '../lib/focusAnnounce'
import { useFocus } from '../lib/focus'
import type { ArrivalsSource } from '../lib/live/arrivals'
import type { Network } from '../lib/network'
import { useTrip } from '../lib/trip'
import { isTripEnd } from '../lib/tripEnds'
import { shouldAnnounceOnMap } from '../lib/tripOnMap'
import { droppedNote } from '../lib/tripSelection'
import { planViews, shouldAnnounceTrip, tripAnnounceId, tripAnnouncement, tripMessage, tripNamesOf, tripNowS } from '../lib/tripView'

/** A gap between clearing the region and refilling it, so the same sentence twice is spoken twice. */
const REFILL_MS = 80

interface TripAnnouncerProps {
  network: Network
  arrivals: ArrivalsSource | null
  /** A train panel or the gone notice is in front of the trip panel. */
  covered: boolean
  /** The focused station's complex siblings (its group's other members): a member of an end's complex counts as that end. */
  focusSiblings: readonly string[]
}

/**
 * What a screen reader hears from the trip panel, in one polite region that is mounted from the start (a region
 * that appears with its text is not spoken) and lives in the HUD, so it outlasts the panel being covered and shown
 * again. It speaks a plan once it settles (new ends or a Retry, never the 30 s refresh), the message for ends that
 * can't be planned (a missing end, the same station twice), and "On the map: X" when the camera focuses a station
 * that is neither end, and says so once when the opened journey is no longer offered. It is emptied whenever its text could be stale: the panel closing, a plan running, the ends
 * changing.
 */
export function TripAnnouncer({ network, arrivals, covered, focusSiblings }: TripAnnouncerProps) {
  const { open, ends, plan, dropped, activeStepLead } = useTrip()
  const { focusedId } = useFocus()
  const [text, setText] = useState('')
  const lastId = useRef<string | null>(null)
  const lastEnds = useRef('')
  const wasOpen = useRef(false)
  const refill = useRef(0)
  const lastFocused = useRef<string | null>(focusedId)
  const settledAt = useRef<number | null>(null)
  const latest = useRef({ ends, plan, focusSiblings, activeStepLead })
  latest.current = { ends, plan, focusSiblings, activeStepLead }

  const say = (next: string | null) => {
    window.clearTimeout(refill.current)
    setText('')
    if (next) refill.current = window.setTimeout(() => setText(next), REFILL_MS)
  }

  useEffect(() => {
    const endsKey = `${ends.from}>${ends.to}`
    const opened = open && !wasOpen.current
    const endsChanged = endsKey !== lastEnds.current
    wasOpen.current = open
    lastEnds.current = endsKey
    if (!open) {
      lastId.current = null
      say(null)
      return
    }
    if (plan.status === 'idle') {
      // Opening says nothing more than the heading does; changing the ends to something unplannable says why.
      say(!opened && endsChanged ? tripMessage(ends, plan, false) : null)
      return
    }
    if (plan.status === 'loading') {
      say(null)
      return
    }
    settledAt.current = performance.now()
    if (shouldAnnounceTrip(plan, lastId.current)) {
      lastId.current = tripAnnounceId(plan)
      const names = tripNamesOf(network)
      say(tripAnnouncement(ends, plan, planViews(plan, tripNowS(arrivals, performance.now(), Date.now()), names)))
    } else if (endsChanged) say(null)
    // The plan answers the ends; it is what settles, so it is the trigger.
  }, [open, plan, ends.from, ends.to])

  // The journey the visitor had open left a refreshed plan: said once, whatever view shows now (even a collapsed bar).
  useEffect(() => {
    if (dropped.seq === 0 || !open) return
    say(droppedNote(dropped.remaining))
    // The drop counter is what settles, so it is the trigger.
  }, [dropped.seq])

  // A station that newly takes focus behind the panel is named once it has held. Only a change of focus counts:
  // opening, a swap, an end pick or the cover going leave `focusedId` as it was and say nothing.
  const shown = open && !covered
  useEffect(() => {
    const previousId = lastFocused.current
    lastFocused.current = focusedId
    const station = focusedId !== null ? network.groupById.get(focusedId) : undefined
    if (!station) return
    const timer = window.setTimeout(() => {
      const { ends: now, plan: current, focusSiblings: siblings, activeStepLead: stepLead } = latest.current
      const settled = settledAt.current
      if (
        shouldAnnounceOnMap({
          focusedId,
          previousId,
          shown,
          isEnd: isTripEnd(station.id, siblings, now),
          planLoading: current.status === 'loading',
          // A step press focuses its station on purpose: the button and the map say it, so this region stays silent.
          stepped: stepLead === focusedId,
          sinceSettledMs: settled === null ? null : performance.now() - settled,
        })
      ) {
        say(`On the map: ${station.name}`)
      }
    }, ANNOUNCE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [focusedId, shown])

  useEffect(() => () => window.clearTimeout(refill.current), [])

  return (
    <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {text}
    </p>
  )
}

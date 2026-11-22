import { useEffect, useMemo, useRef, useState } from 'react'
import { answerKey, geocodeStep, INITIAL_GEOCODE, rememberAnswer, type GeocodeAnswer, type GeocodeEffect, type GeocodeEvent, type GeocodeFailure, type GeocodeMachine } from '../lib/geocodeSearch'
import { geocodeView, type GeocodeView, type SearchingTier } from '../lib/geocodeView'
import type { LatLon } from '../lib/projection'
import { fetchGeocode, geocodeRequestUrl } from './geocodeFetch'
import type { GeocodeResponse } from './realtime'

/** Complete answers of this session, shared by every search dialog. Memory only: no storage, URL or history. */
const answers = new Map<string, GeocodeResponse>()
/** One warning per failure kind per session. */
const warned = new Set<GeocodeFailure>()

const TIER_1_MS = 400
const TIER_2_MS = 2000

/** Failure kind and status only: never the URL, query, focus or a label. */
function warnOnce(answer: Extract<GeocodeAnswer, { ok: false }>): void {
  if (warned.has(answer.error)) return
  warned.add(answer.error)
  console.warn(`Address search failed: ${answer.error}${answer.status ? ` (HTTP ${answer.status})` : ''}`)
}

interface EngineInputs {
  url: () => string | null
  focus: () => LatLon | null
  onChange: (m: GeocodeMachine) => void
}

/** The machine plus its timer and request: `run` applies an event and performs the effects it asks for. */
function createEngine({ url, focus, onChange }: EngineInputs) {
  let machine = INITIAL_GEOCODE
  let timer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null

  const cancel = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    controller?.abort()
    controller = null
  }

  function perform(effect: GeocodeEffect): void {
    if (effect.type === 'cancel') return cancel()
    if (effect.type === 'schedule') {
      timer = setTimeout(() => {
        timer = null
        if (machine.seq !== effect.seq) return
        const at = focus()
        run({ type: 'fire', seq: effect.seq, focus: at, cached: answers.get(answerKey(machine.query, at)) ?? null })
      }, effect.delayMs)
      return
    }
    const base = url()
    if (base === null) return
    const own = new AbortController()
    controller = own
    fetchGeocode(geocodeRequestUrl(base, effect.query, effect.focus), own.signal)
      .then((answer) => {
        if (own.signal.aborted) return
        if (answer.ok) rememberAnswer(answers, answerKey(effect.query, effect.focus), answer.response)
        else warnOnce(answer)
        run({ type: 'answer', seq: effect.seq, answer })
      })
      .catch(() => {
        // Our own abort is expected; anything else is a bug in the fetch layer, logged without the request.
        if (own.signal.aborted) return
        console.error('Address search failed unexpectedly')
        run({ type: 'answer', seq: effect.seq, answer: { ok: false, error: 'network', status: null } })
      })
  }

  function run(event: GeocodeEvent): void {
    const step = geocodeStep(machine, event)
    const changed = step.next !== machine
    machine = step.next
    if (changed) onChange(machine)
    for (const effect of step.effects) perform(effect)
  }

  return { run }
}

/**
 * The address lookup for one search dialog: a request 250 ms after the last keystroke, only for 3 to 100 code
 * points, the stale one aborted, a complete answer remembered for the session. `url` null or `active` false is the
 * lookup off. `focus` is read once per request (through a ref, so a new function each render restarts nothing).
 */
export function useGeocode(url: string | null, text: string, active: boolean, focus: () => LatLon | null): GeocodeView {
  const [machine, setMachine] = useState(INITIAL_GEOCODE)
  const [slow, setSlow] = useState<{ seq: number; tier: SearchingTier }>({ seq: -1, tier: 0 })
  const latest = useRef({ url, focus })
  useEffect(() => {
    latest.current = { url, focus }
  })
  const [engine] = useState(() => createEngine({ url: () => latest.current.url, focus: () => latest.current.focus(), onChange: setMachine }))

  const enabled = url !== null && active
  useEffect(() => {
    engine.run(enabled ? { type: 'input', text } : { type: 'reset' })
  }, [engine, enabled, text])
  useEffect(() => () => engine.run({ type: 'reset' }), [engine])

  // The "still searching" tiers: set by timers started when a request goes out, so there is no synchronous setState.
  const { phase, seq } = machine
  useEffect(() => {
    if (phase !== 'loading') return
    const first = setTimeout(() => setSlow({ seq, tier: 1 }), TIER_1_MS)
    const second = setTimeout(() => setSlow({ seq, tier: 2 }), TIER_2_MS)
    return () => {
      clearTimeout(first)
      clearTimeout(second)
    }
  }, [phase, seq])

  const tier: SearchingTier = slow.seq === seq ? slow.tier : 0
  return useMemo(() => geocodeView(machine, enabled, tier), [machine, enabled, tier])
}

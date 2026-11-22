import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { OutagePanelBody, OutagePanelView } from '../lib/live/eneText'
import { outageAnnouncement, outageSeen, type OutageSeen } from '../lib/live/outageAnnounce'

/** The first line of the block when an outage takes away an accessible station's only step-free way out. */
export const NO_STEP_FREE_TEXT = 'No step-free access now'
/** How long the announcement text stays in its live region after it is spoken. */
const ANNOUNCEMENT_MS = 6000

interface ToggleProps {
  expanded: boolean
  count: number
  controls: string
  onToggle: () => void
  /** Called when the button goes away while it has focus. */
  onFocusLost: () => void
}

/** "Out of service (N)": the one control that opens and closes the rows, so toggling keeps focus. */
function Toggle({ expanded, count, controls, onToggle, onFocusLost }: ToggleProps) {
  const button = useRef<HTMLButtonElement>(null)
  const lost = useRef(onFocusLost)
  useLayoutEffect(() => {
    lost.current = onFocusLost
  })
  // The layout cleanup of an unmounting child runs before React removes its node, so focus can still be read.
  // Empty deps: it must run only on unmount, however the parent's callback changes.
  useLayoutEffect(
    () => () => {
      if (button.current !== null && button.current === document.activeElement) lost.current()
    },
    [],
  )
  return (
    <button
      ref={button}
      type="button"
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      onClick={onToggle}
      className="-mx-2 flex min-h-11 w-[calc(100%+1rem)] cursor-pointer items-center justify-between gap-2 px-2 text-xs text-ink hover:text-focus focus-visible:outline-2 focus-visible:outline-focus"
    >
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="size-2 shrink-0 bg-status-error" />
        Out of service ({count})
      </span>
      <span aria-hidden="true" className="text-ink-dim">
        {expanded ? '−' : '+'}
      </span>
    </button>
  )
}

interface OutageListProps {
  body: OutagePanelBody
  /** Show "No step-free access now" before the rows. */
  noStepFree: boolean
  onFocusLost: () => void
}

/**
 * The rows as plain panel text (no live region: opening a panel must not speak them over the station's name). They
 * start collapsed behind "Out of service (N)" (the user's call: keep the panel short); "No step-free access now"
 * stays visible above it, since it changes whether the station is usable at all.
 */
function OutageList({ body, noStepFree, onFocusLost }: OutageListProps) {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  if (body.kind === 'none') return null
  if (body.kind === 'unknown') return <p className="mt-2 text-xs text-ink-dim">{body.text}</p>
  return (
    <div className="mt-2 text-xs">
      {noStepFree && <p className="mb-1 text-ink">{NO_STEP_FREE_TEXT}</p>}
      <Toggle expanded={expanded} count={body.rows.length} controls={listId} onToggle={() => setExpanded((e) => !e)} onFocusLost={onFocusLost} />
      {expanded && (
        <ul id={listId} aria-label="Out of service" className="mt-1 space-y-1.5">
          {body.rows.map((row) => (
            <li key={row.id} className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-0.5 size-2 shrink-0 bg-status-error" />
              <span className="min-w-0">
                <span className="block text-ink">{row.title}</span>
                {row.levels !== null && (
                  <span className={row.wraps ? 'line-clamp-3 text-ink-dim' : 'block whitespace-nowrap text-ink-dim'}>{row.levels}</span>
                )}
                <span className="block text-ink-dim">
                  {row.meta.map((part, i) => (
                    <span key={part}>
                      {i > 0 && ' · '}
                      <span className="whitespace-nowrap">{part}</span>
                    </span>
                  ))}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * What to say when a poll changes the machines out of service at the station whose panel stays open. Nothing is
 * said for a panel that has just opened or changed station (see `outageAnnouncement`). The text belongs to the
 * station it was made for, so another station's panel never shows or speaks it.
 */
function useOutageAnnouncement(stationId: string, view: OutagePanelView): string {
  const prev = useRef<OutageSeen | null>(null)
  const [said, setSaid] = useState({ stationId, text: '' })
  const seen = outageSeen(stationId, view)
  // The effect depends on this key, not on `view`, which is a new object every render.
  const key = `${seen.known}|${[...seen.out].map(([id, kind]) => `${id}:${kind}`).join(',')}`
  useEffect(() => {
    const next = outageSeen(stationId, view)
    setSaid({ stationId, text: outageAnnouncement(prev.current, next) })
    prev.current = next
  }, [stationId, key])
  // Spoken once, then cleared, so the region isn't left holding a stale sentence for a screen-reader cursor to find.
  useEffect(() => {
    if (said.text === '') return
    const timer = window.setTimeout(() => setSaid((s) => (s === said ? { ...s, text: '' } : s)), ANNOUNCEMENT_MS)
    return () => window.clearTimeout(timer)
  }, [said])
  return said.stationId === stationId ? said.text : ''
}

interface OutageStatusProps {
  view: OutagePanelView
  stationId: string
  /** Takes focus when the toggle goes away (the list shrank) while it had it. */
  onFocusLost: () => void
}

/**
 * The station panel's out-of-service machines: a closed "Out of service (N)" disclosure over the rows, or a dim
 * "status unavailable" line. One polite screen-reader-only region stays mounted and speaks only a change to the
 * machines out at the station already open.
 */
export function OutageStatus({ view, stationId, onFocusLost }: OutageStatusProps) {
  const announcement = useOutageAnnouncement(stationId, view)
  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
      <OutageList key={stationId} body={view.body} noStepFree={view.noStepFree} onFocusLost={onFocusLost} />
    </>
  )
}

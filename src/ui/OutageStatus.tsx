import { useEffect, useId, useRef, useState } from 'react'
import type { OutagePanelBody, OutagePanelView } from '../lib/live/eneText'
import { outageAnnouncement, outageSeen, type OutageSeen } from '../lib/live/outageAnnounce'
import { DisclosureToggle } from './DisclosureToggle'

/** The first line of the block when an outage takes away an accessible station's only step-free way out. */
export const NO_STEP_FREE_TEXT = 'No step-free access now'
/** How long the announcement text stays in its live region after it is spoken. */
const ANNOUNCEMENT_MS = 6000

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
      <DisclosureToggle label="Out of service" markClass="bg-status-error" expanded={expanded} count={body.rows.length} controls={listId} onToggle={() => setExpanded((e) => !e)} onFocusLost={onFocusLost} />
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
 * One polite screen-reader-only region that speaks only a change to the machines out at the station already open.
 * Mounted outside the panel's collapsible body, so it still speaks while the panel is collapsed to its bar.
 */
export function OutageAnnouncer({ view, stationId }: Pick<OutageStatusProps, 'view' | 'stationId'>) {
  const announcement = useOutageAnnouncement(stationId, view)
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement}
    </div>
  )
}

/** The station panel's out-of-service machines: a closed "Out of service (N)" disclosure over the rows, or a dim "status unavailable" line. */
export function OutageStatus({ view, stationId, onFocusLost }: OutageStatusProps) {
  return <OutageList key={`${stationId}|${view.body.kind}`} body={view.body} noStepFree={view.noStepFree} onFocusLost={onFocusLost} />
}

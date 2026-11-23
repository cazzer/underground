import { useEffect, useId, useRef, useState } from 'react'
import type { RouteId } from '../data/schema'
import { routeSpokenName } from '../lib/labels'
import { changesAnnouncement, changesSeen, type ChangesSeen } from '../lib/live/alertAnnounce'
import type { ServiceChangeBody, ServiceChangeView } from '../lib/live/alertText'
import type { Route } from '../lib/network'
import { DisclosureToggle } from './DisclosureToggle'
import { RouteChip } from './RouteChip'

/** How long the announcement text stays in its live region after it is spoken. */
const ANNOUNCEMENT_MS = 6000

interface ChangeListProps {
  body: ServiceChangeBody
  routeById: ReadonlyMap<RouteId, Route>
  onFocusLost: () => void
}

/**
 * The rows as plain panel text (no live region: opening a panel must not speak them over the station's name), closed
 * behind "Service changes (N)" like the outages. Each row is our short line (route chips, what it does here, when)
 * over the MTA's header, which is the MTA's own text: a plain text node, never edited, truncated or re-cased, and
 * only the `en` string (never the html one).
 */
function ChangeList({ body, routeById, onFocusLost }: ChangeListProps) {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  if (body.kind === 'none') return null
  if (body.kind === 'unknown') return <p className="mt-2 text-xs text-ink-dim">{body.text}</p>
  return (
    <div className="mt-2 text-xs">
      <DisclosureToggle label="Service changes" markClass="bg-status-warn" expanded={expanded} count={body.rows.length} controls={listId} onToggle={() => setExpanded((e) => !e)} onFocusLost={onFocusLost} />
      {expanded && (
        <ul id={listId} aria-label="Service changes" className="mt-1">
          {body.rows.map((row) => (
            <li key={row.key} className="border-t border-edge py-2 last:pb-0">
              <div className="flex items-start gap-1.5 text-ink">
                <span className="flex shrink-0 gap-1">
                  {row.routes.map((id) => {
                    const route = routeById.get(id)
                    return route ? (
                      <RouteChip key={id} route={route} as="span">
                        <span className="sr-only">{routeSpokenName(route.shortName)} train</span>
                      </RouteChip>
                    ) : (
                      <span key={id}>{id}</span>
                    )
                  })}
                </span>
                <span className="min-w-0">
                  {row.parts.map((part, i) => (
                    <span key={part}>
                      {i > 0 && ' · '}
                      <span className="whitespace-nowrap">{part}</span>
                    </span>
                  ))}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-line break-words border-l-2 border-edge pl-2 text-ink-dim">{row.header}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * What to say when a poll changes the service changes at the station whose panel stays open. Nothing is said for a
 * panel that has just opened or changed station (see `changesAnnouncement`). The text belongs to the station it was
 * made for, so another station's panel never shows or speaks it.
 */
function useChangesAnnouncement(stationId: string, view: ServiceChangeView): string {
  const prev = useRef<ChangesSeen | null>(null)
  const [said, setSaid] = useState({ stationId, text: '' })
  const seen = changesSeen(stationId, view)
  // The effect depends on this key, not on `view`, which is a new object every render.
  const key = `${seen.known}|${[...seen.rows].map(([k, r]) => `${k}:${r.now}`).join(',')}`
  useEffect(() => {
    const next = changesSeen(stationId, view)
    setSaid({ stationId, text: changesAnnouncement(prev.current, next) })
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

/**
 * One polite screen-reader-only region that speaks only a change at the station already open. It is mounted outside
 * the panel's collapsible body, so it still speaks while the panel is collapsed to its bar.
 */
export function ServiceChangeAnnouncer({ view, stationId }: { view: ServiceChangeView; stationId: string }) {
  const announcement = useChangesAnnouncement(stationId, view)
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement}
    </div>
  )
}

interface ServiceChangeStatusProps {
  view: ServiceChangeView
  stationId: string
  routeById: ReadonlyMap<RouteId, Route>
  /** Takes focus when the toggle goes away (the list shrank) while it had it. */
  onFocusLost: () => void
}

/**
 * The station panel's service changes: a closed "Service changes (N)" disclosure over the rows, or a dim "Service
 * changes unavailable" line (never "none" when the data is old). Nothing renders without the Worker.
 */
export function ServiceChangeStatus({ view, stationId, routeById, onFocusLost }: ServiceChangeStatusProps) {
  return <ChangeList key={`${stationId}|${view.body.kind}`} body={view.body} routeById={routeById} onFocusLost={onFocusLost} />
}

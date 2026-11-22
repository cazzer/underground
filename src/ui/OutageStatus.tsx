import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { OutagePanelBody, OutagePanelView } from '../lib/live/eneText'
import { outageAnnouncement, outageSeen, type OutageSeen } from '../lib/live/outageAnnounce'

interface ToggleProps {
  expanded: boolean
  hidden: number
  controls: string
  onToggle: () => void
  /** Called when the button goes away while it has focus. */
  onFocusLost: () => void
}

function Toggle({ expanded, hidden, controls, onToggle, onFocusLost }: ToggleProps) {
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
      aria-controls={controls}
      onClick={onToggle}
      className="-mx-2 flex min-h-11 cursor-pointer items-center px-2 text-sm text-ink-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
    >
      {expanded ? 'Show fewer' : `Show ${hidden} more`}
    </button>
  )
}

interface OutageListProps {
  body: OutagePanelBody
  onFocusLost: () => void
}

/** The rows as plain panel text (no live region: opening a panel must not speak them over the station's name). */
function OutageList({ body, onFocusLost }: OutageListProps) {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  if (body.kind === 'none') return null
  if (body.kind === 'unknown') return <p className="mt-2 text-xs text-ink-dim">{body.text}</p>
  const hidden = Math.max(0, body.rows.length - body.shown)
  const rows = expanded ? body.rows : body.rows.slice(0, body.shown)
  return (
    <div className="mt-2 text-xs">
      <ul id={listId} className="space-y-1.5">
        {rows.map((row) => (
          <li key={row.id} className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-0.5 size-2 shrink-0 bg-status-error" />
            <span className="min-w-0">
              <span className="block text-ink">{row.title}</span>
              <span className="block text-ink-dim">{row.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      {hidden > 0 && <Toggle expanded={expanded} hidden={hidden} controls={listId} onToggle={() => setExpanded((e) => !e)} onFocusLost={onFocusLost} />}
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
  return said.stationId === stationId ? said.text : ''
}

interface OutageStatusProps {
  view: OutagePanelView
  stationId: string
  /** Takes focus when the toggle goes away (the list shrank) while it had it. */
  onFocusLost: () => void
}

/**
 * The station panel's out-of-service machines: a short list as plain text (two rows, then "Show N more") or a dim
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
      <OutageList key={stationId} body={view.body} onFocusLost={onFocusLost} />
    </>
  )
}

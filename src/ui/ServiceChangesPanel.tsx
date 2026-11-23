import { useCallback, useId, useRef, type Ref, type RefObject } from 'react'
import type { RouteId } from '../data/schema'
import type { AlertChip, AlertListBody, AlertListRow } from '../lib/live/alertList'
import type { Route } from '../lib/network'
import { CollapseButton, ExpandBar } from './PanelBar'
import { ServiceChangeRow } from './ServiceChangeRow'
import { usePanelToggle } from './usePanelToggle'
import { useScrollHint } from './useScrollHint'

/** The id the header chip's `aria-controls` names while the panel is in front. */
export const SERVICE_CHANGES_PANEL_ID = 'service-changes-panel'

const PANEL =
  'pointer-events-auto min-h-0 w-full max-w-full max-h-[55dvh] overflow-auto border border-edge bg-panel text-ink backdrop-blur-sm sm:max-h-full sm:w-80 sm:shrink-0'

interface ServiceChangesPanelProps {
  body: AlertListBody
  /** The header chip's text: the collapsed bar's. */
  chip: AlertChip | null
  routeById: ReadonlyMap<RouteId, Route>
  /** A train panel or notice is in front: the panel stays mounted but hidden and inert. */
  covered: boolean
  /** The heading, or the bar while collapsed: takes focus when the chip opens the list. */
  headingRef: RefObject<HTMLElement | null>
  /** "Close". */
  onClose: () => void
  ref: Ref<HTMLElement>
}

function Group({ title, rows, routeById }: { title: string; rows: AlertListRow[]; routeById: ReadonlyMap<RouteId, Route> }) {
  if (rows.length === 0) return null
  return (
    <section className="mt-3 first:mt-0">
      <h3 className="text-xs text-ink-dim">{title}</h3>
      <ul>
        {rows.map((row) => (
          <ServiceChangeRow key={row.id} row={row} routeById={routeById} />
        ))}
      </ul>
    </section>
  )
}

function Body({ body, routeById }: { body: AlertListBody; routeById: ReadonlyMap<RouteId, Route> }) {
  switch (body.kind) {
    case 'off':
      return null
    case 'connecting':
      return <p className="text-sm text-ink-dim">Checking for service changes</p>
    case 'unknown':
      return <p className="text-sm text-ink-dim">Service changes unavailable</p>
    case 'list':
      if (body.now.length === 0 && body.later.length === 0) return <p className="text-sm text-ink-dim">No service changes in the next 24 hours.</p>
      return (
        <>
          <Group title="Now" rows={body.now} routeById={routeById} />
          <Group title="Later today" rows={body.later} routeById={routeById} />
        </>
      )
  }
}

/**
 * The MTA's service changes in effect now or starting within a day: the header chip opens it into the bottom slot
 * (in front of the trip and station panels, behind a train panel or notice, which it stays mounted under). Rows are
 * plain text, no live region: polls never speak the list or its count. "Close" or Esc closes it; the chevron
 * collapses it to a bar.
 */
export function ServiceChangesPanel({ body, chip, routeById, covered, headingRef, onClose, ref }: ServiceChangesPanelProps) {
  const own = useRef<HTMLElement | null>(null)
  const content = useRef<HTMLDivElement>(null)
  const { collapsed, collapse, expand } = usePanelToggle('changes', headingRef)
  const bodyId = useId()
  const setHeading = useCallback((el: HTMLElement | null) => { headingRef.current = el }, [headingRef])
  const { more, onScroll } = useScrollHint(own, content)
  const setRef = useCallback(
    (el: HTMLElement | null) => {
      own.current = el
      if (typeof ref === 'function') ref(el)
      else if (ref) ref.current = el
    },
    [ref],
  )
  return (
    <aside id={SERVICE_CHANGES_PANEL_ID} ref={setRef} onScroll={onScroll} aria-label="Service changes" hidden={covered} inert={covered} className={`${PANEL} ${collapsed ? '' : 'p-4'}`}>
      <div ref={content}>
        {collapsed ? (
          <ExpandBar ref={setHeading} label={chip?.text ?? 'Service changes'} controls={bodyId} onExpand={expand}>
            <span aria-hidden="true" className="line-clamp-2 min-w-0">
              {chip?.text ?? 'Service changes'}
            </span>
          </ExpandBar>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <h2 ref={setHeading} tabIndex={-1} className="text-lg leading-tight outline-none focus-visible:outline-2 focus-visible:outline-focus">
              Service changes
            </h2>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                aria-label="Close service changes"
                className="-my-2 flex min-h-11 cursor-pointer items-center px-2 text-sm text-ink-dim underline hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
              >
                Close
              </button>
              <CollapseButton label="Collapse service changes" controls={bodyId} onCollapse={collapse} />
            </div>
          </div>
        )}
        <div id={bodyId} hidden={collapsed} className="mt-2">
          <Body body={body} routeById={routeById} />
        </div>
      </div>
      {more && !collapsed && <div aria-hidden="true" className="pointer-events-none sticky bottom-0 -mx-4 -mb-8 h-8 bg-linear-to-t from-panel to-transparent" />}
    </aside>
  )
}

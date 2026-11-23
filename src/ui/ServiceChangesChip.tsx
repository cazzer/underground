import type { Ref } from 'react'
import type { AlertChip } from '../lib/live/alertList'

interface ServiceChangesChipProps {
  /** What it says, or null for nothing to show (not configured, still connecting, nothing listed). */
  chip: AlertChip | null
  /** The list is in front. */
  expanded: boolean
  /** The id of the list panel; named only while it is in front. */
  controls: string
  onToggle: () => void
  ref: Ref<HTMLButtonElement>
}

/**
 * The header's service-changes toggle: "3 service changes", "Service changes unavailable". The count is the button's
 * own name, never a live region, so no poll speaks it. A warning swatch marks a count and the pressed state reads as
 * an ink fill, so neither rests on color alone. A 44 px target round a 24 px row.
 */
export function ServiceChangesChip({ chip, expanded, controls, onToggle, ref }: ServiceChangesChipProps) {
  if (chip === null) return null
  return (
    <div className="mt-1">
      <button
        ref={ref}
        type="button"
        aria-expanded={expanded}
        aria-controls={expanded ? controls : undefined}
        onClick={onToggle}
        className="pointer-events-auto -my-2.5 -ml-2 inline-flex min-h-11 max-w-full min-w-0 cursor-pointer items-center px-2 text-xs hover:text-focus focus-visible:outline-2 focus-visible:outline-focus"
      >
        <span
          className={`inline-flex min-w-0 items-center gap-1.5 border border-edge px-2 py-0.5 backdrop-blur-sm ${expanded ? 'bg-ink text-canvas' : 'bg-panel'} ${chip.mark || expanded ? '' : 'text-ink-dim'}`}
        >
          {chip.mark && <span aria-hidden="true" className="size-2 shrink-0 bg-status-warn" />}
          {chip.text}
        </span>
      </button>
    </div>
  )
}

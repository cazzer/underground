import { useLayoutEffect, type RefObject } from 'react'
import type { AlertChip } from '../lib/live/alertList'

interface ServiceChangesChipProps {
  /** What it says, or null for nothing to show (not configured, still connecting, nothing listed). */
  chip: AlertChip | null
  /** The list is in front. */
  expanded: boolean
  /** The id of the list panel; named only while it is in front. */
  controls: string
  onToggle: () => void
  /** Called when the button goes away (the chip became null) while it has focus. */
  onFocusLost: () => void
  ref: RefObject<HTMLButtonElement | null>
}

interface ChipButtonProps extends Omit<ServiceChangesChipProps, 'chip'> {
  chip: AlertChip
}

function ChipButton({ chip, expanded, controls, onToggle, onFocusLost, ref }: ChipButtonProps) {
  // The layout cleanup of an unmounting child runs before React removes its node, so focus can still be read (as DisclosureToggle).
  // Empty deps: it must run only on unmount, however the parent's callback changes.
  useLayoutEffect(
    () => () => {
      if (ref.current !== null && ref.current === document.activeElement) onFocusLost()
    },
    [],
  )
  const tone = expanded ? 'bg-ink text-canvas' : chip.mark ? 'bg-panel' : 'bg-panel text-ink-dim group-hover:text-focus'
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      onClick={onToggle}
      className="group pointer-events-auto -my-2.5 -ml-2 inline-flex min-h-11 max-w-full min-w-0 cursor-pointer items-center px-2 text-xs outline-none hover:text-focus"
    >
      <span
        className={`inline-flex min-w-0 items-center gap-1.5 border border-edge px-2 py-0.5 backdrop-blur-sm group-focus-visible:outline-2 group-focus-visible:outline-focus ${tone}`}
      >
        {chip.mark && <span aria-hidden="true" className="size-2 shrink-0 bg-status-warn" />}
        {chip.text}
      </span>
    </button>
  )
}

/**
 * The header's service-changes toggle: "3 service changes", "Service changes unavailable". The count is the button's
 * own name, never a live region, so no poll speaks it. A warning swatch marks a count and the pressed state reads as
 * an ink fill, so neither rests on color alone. A 44 px target round a 24 px row; the focus outline is drawn on the
 * 24 px chip, not the target, so it doesn't cover the lines around it.
 */
export function ServiceChangesChip({ chip, ...rest }: ServiceChangesChipProps) {
  if (chip === null) return null
  return (
    <div className="mt-1">
      <ChipButton chip={chip} {...rest} />
    </div>
  )
}

import { useLayoutEffect, useRef } from 'react'

interface DisclosureToggleProps {
  /** "Out of service" or "Service changes": the button reads "<label> (N)". */
  label: string
  /** The swatch's background class, a theme token (`bg-status-error`, `bg-status-warn`). */
  markClass: string
  expanded: boolean
  count: number
  controls: string
  onToggle: () => void
  /** Called when the button goes away while it has focus. */
  onFocusLost: () => void
}

/** "Out of service (N)", "Service changes (N)": the one control that opens and closes a list, so toggling keeps focus. */
export function DisclosureToggle({ label, markClass, expanded, count, controls, onToggle, onFocusLost }: DisclosureToggleProps) {
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
        <span aria-hidden="true" className={`size-2 shrink-0 ${markClass}`} />
        {label} ({count})
      </span>
      <span aria-hidden="true" className="text-ink-dim">
        {expanded ? '−' : '+'}
      </span>
    </button>
  )
}

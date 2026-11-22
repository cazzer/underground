import type { ReactNode, Ref } from 'react'

function Chevron({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
      <path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
    </svg>
  )
}

interface CollapseButtonProps {
  label: string
  /** The id of the body this button collapses. */
  controls: string
  onCollapse: () => void
}

/** A panel header's down chevron: collapses the panel to its bar. */
export function CollapseButton({ label, controls, onCollapse }: CollapseButtonProps) {
  return (
    <button
      type="button"
      onClick={onCollapse}
      aria-label={label}
      aria-expanded={true}
      aria-controls={controls}
      className="-m-2 flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center p-2 text-ink-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
    >
      <Chevron up={false} />
    </button>
  )
}

interface ExpandBarProps {
  controls: string
  onExpand: () => void
  ref: Ref<HTMLButtonElement>
  children: ReactNode
}

/** A collapsed panel: one line of text and an up chevron; pressing it expands the panel. */
export function ExpandBar({ controls, onExpand, ref, children }: ExpandBarProps) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onExpand}
      aria-expanded={false}
      aria-controls={controls}
      className="flex min-h-11 w-full min-w-0 cursor-pointer items-center justify-between gap-3 px-4 py-2 text-left text-lg leading-tight hover:text-focus focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
    >
      <span className="min-w-0 truncate">{children}</span>
      <span className="shrink-0 text-ink-dim">
        <Chevron up />
      </span>
    </button>
  )
}

import type { KeyboardEvent, RefObject } from 'react'

interface SearchBarProps {
  inputRef: RefObject<HTMLInputElement | null>
  /** The dialog's id prefix: the input is `<id>-q`. */
  id: string
  label: string
  placeholder: string
  /** The input's `aria-describedby`. */
  describedBy: string
  query: string
  onQuery: (query: string) => void
  onFocusChange: (focused: boolean) => void
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  onCancel: () => void
}

/** The dialog's top bar: the labelled input with its clear button, and Cancel. */
export function SearchBar({ inputRef, id, label, placeholder, describedBy, query, onQuery, onFocusChange, onKeyDown, onCancel }: SearchBarProps) {
  return (
    <div className="flex items-center gap-2 border-b border-edge p-3">
      <label htmlFor={`${id}-q`} className="sr-only">
        {label}
      </label>
      <div className="relative min-w-0 flex-1">
        <input
          ref={inputRef}
          id={`${id}-q`}
          type="text"
          aria-describedby={describedBy}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="go"
          placeholder={placeholder}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onFocus={() => onFocusChange(true)}
          onBlur={() => onFocusChange(false)}
          onKeyDown={onKeyDown}
          className="min-h-11 w-full border border-edge bg-panel pr-11 pl-3 text-base text-ink placeholder:text-ink-dim focus-visible:outline-2 focus-visible:outline-focus"
        />
        {query !== '' && (
          <button
            type="button"
            onClick={() => {
              onQuery('')
              inputRef.current?.focus()
            }}
            aria-label="Clear search text"
            className="absolute inset-y-0 right-0 flex min-w-11 cursor-pointer items-center justify-center text-ink-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
          >
            ×
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="min-h-11 shrink-0 cursor-pointer px-2 text-base text-ink-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
      >
        Cancel
      </button>
    </div>
  )
}

import { useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import { sharedNames } from '../lib/labels'
import type { Network } from '../lib/network'
import { buildSearchIndex, SEARCH_LIMIT, searchStations } from '../lib/stationSearch'
import { SearchResult } from './SearchResult'
import { useKeyboardInset } from './useKeyboardInset'

export interface StationSearchHandle {
  /**
   * Opens the dialog and focuses the input. Call it synchronously from the tap handler: iOS Safari only
   * raises the keyboard for a focus() made inside a user gesture.
   */
  open: () => void
}

interface StationSearchProps {
  network: Network
  onChoose: (stationId: string) => void
  /** The dialog closed (Esc, the Android back gesture, Cancel, or a choice); mirrors the native close event. */
  onClose: () => void
  ref: Ref<StationSearchHandle>
}

function statusText(typed: boolean, count: number): string {
  if (!typed) return ''
  if (count === 0) return 'No stations match'
  if (count >= SEARCH_LIMIT) return `Top ${SEARCH_LIMIT} stations`
  return `${count} station${count === 1 ? '' : 's'}`
}

/**
 * Full-screen station search in a native modal dialog: the page behind is inert, Esc closes it and focus
 * is trapped. Always mounted (closed, hence hidden) so `open()` can focus the input inside the tap. The input
 * is an ARIA combobox over a listbox; focus stays in the input and `aria-activedescendant` points at the
 * highlighted result. Closing hands focus back to whatever had it when the dialog opened.
 */
export function StationSearch({ network, onChoose, onClose, ref }: StationSearchProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const id = useId()
  const listId = `${id}-list`
  const hintId = `${id}-hint`
  const index = useMemo(() => buildSearchIndex(network.stations), [network])
  const shared = useMemo(() => sharedNames(network.stations), [network])
  const keyboardInset = useKeyboardInset()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const results = useMemo(() => searchStations(index, query), [index, query])
  const current = Math.min(active, results.length - 1)
  const optionId = (stationId: string) => `${listId}-${stationId}`
  const activeOption = results[current]
  const typed = query.trim() !== ''

  const reset = (text: string) => {
    setQuery(text)
    setActive(0)
  }
  useImperativeHandle(ref, () => ({
    open: () => {
      reset('')
      dialog.current?.showModal()
      input.current?.focus()
    },
  }))
  const close = () => dialog.current?.close()
  const choose = (stationId: string) => {
    onChoose(stationId)
    close()
  }
  const move = (next: number) => {
    setActive(next)
    list.current?.children[next]?.scrollIntoView({ block: 'nearest' })
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(Math.min(current + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(Math.max(current - 1, 0))
    } else if (e.key === 'Enter' && activeOption && !e.nativeEvent.isComposing) {
      e.preventDefault()
      choose(activeOption.id)
    }
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-label="Search stations"
      className="pointer-events-auto m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-canvas p-0 text-ink backdrop:bg-canvas"
    >
      <div className="mx-auto flex h-full max-w-xl flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
        <div className="flex items-center gap-2 border-b border-edge p-3">
          <label htmlFor={`${id}-q`} className="sr-only">
            Search stations
          </label>
          <div className="relative min-w-0 flex-1">
            <input
              ref={input}
              id={`${id}-q`}
              type="text"
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls={results.length > 0 ? listId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={activeOption ? optionId(activeOption.id) : undefined}
              aria-describedby={typed ? undefined : hintId}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="go"
              placeholder="Station name"
              value={query}
              onChange={(e) => reset(e.target.value)}
              onKeyDown={onKeyDown}
              className="min-h-11 w-full border border-edge bg-panel pr-11 pl-3 text-base text-ink placeholder:text-ink-dim focus-visible:outline-2 focus-visible:outline-focus"
            />
            {query !== '' && (
              <button
                type="button"
                onClick={() => {
                  reset('')
                  input.current?.focus()
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
            onClick={close}
            className="min-h-11 shrink-0 cursor-pointer px-2 text-base text-ink-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
          >
            Cancel
          </button>
        </div>
        <p role="status" className="sr-only">
          {statusText(typed, results.length)}
        </p>
        {!typed && (
          <p id={hintId} className="p-3 text-sm text-ink-dim">
            Try a name like 14 st, bedford or times sq.
          </p>
        )}
        {typed && results.length === 0 && (
          <p className="p-3 text-sm text-ink-dim" aria-hidden="true">
            No stations match.
          </p>
        )}
        {results.length > 0 && (
          <ul
            ref={list}
            id={listId}
            role="listbox"
            aria-label="Stations"
            style={{ paddingBottom: keyboardInset }}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          >
            {results.map((station, i) => (
              <SearchResult
                key={station.id}
                id={optionId(station.id)}
                network={network}
                station={station}
                sharedName={shared.has(station.name)}
                active={i === current}
                onChoose={() => choose(station.id)}
                onActive={() => setActive(i)}
              />
            ))}
          </ul>
        )}
      </div>
    </dialog>
  )
}

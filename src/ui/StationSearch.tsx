import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import { GEOCODE_URL } from '../data/realtime'
import { useGeocode } from '../data/useGeocode'
import { useFocus } from '../lib/focus'
import { geocodeFocus } from '../lib/geocodeFocus'
import { geocodeAnnouncement, searchEmptyText } from '../lib/geocodeView'
import { multiBoroughNames } from '../lib/labels'
import type { MarkedPlacement } from '../lib/locate'
import type { Network, Station } from '../lib/network'
import { placePick, type PlacePick } from '../lib/placeLabel'
import { activeIndex, searchItems, type SearchItem } from '../lib/searchItems'
import { buildSearchIndex, SEARCH_LIMIT, searchStations } from '../lib/stationSearch'
import { SearchResults } from './SearchResults'
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
  /**
   * Given, with the Worker configured, the search also finds addresses and places and calls this for one. Without
   * it (or without `VITE_RT_URL`) the dialog finds stations only and sends nothing anywhere.
   */
  onChoosePlace?: (pick: PlacePick) => void
  /** The marked location fix: read only to keep the search's bias away from it, never sent. */
  fix?: MarkedPlacement | null
  /** The dialog closed (Esc, the Android back gesture, Cancel, or a choice); mirrors the native close event. */
  onClose?: () => void
  /** The dialog's name and the input's label; a second instance says what it picks. Default "Search stations and places", or "Search stations" with places off. */
  label?: string
  /** The input's placeholder. Default "Station, address or place", or "Station name" with places off. */
  placeholder?: string
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
 * highlighted result. Closing hands focus back to whatever had it when the dialog opened. Esc closes it and goes no
 * further: the dialog stops the keydown, so a window-level Esc handler (the HUD's panels) never also acts on it.
 */
export function StationSearch({ network, onChoose, onChoosePlace, fix = null, onClose, label, placeholder, ref }: StationSearchProps) {
  const placesOn = GEOCODE_URL !== null && onChoosePlace !== undefined
  label ??= placesOn ? 'Search stations and places' : 'Search stations'
  placeholder ??= placesOn ? 'Station, address or place' : 'Station name'
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const listId = `${id}-list`
  const hintId = `${id}-hint`
  const disclosureId = `${id}-disclosure`
  const index = useMemo(() => buildSearchIndex(network.stations), [network])
  const multiBorough = useMemo(() => multiBoroughNames(network.stations), [network])
  const keyboardInset = useKeyboardInset()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const results = useMemo(() => searchStations(index, query), [index, query])
  // The bias is read when a request goes out, not per render.
  const { focusedId, viewCenter, flyRequest } = useFocus()
  const latest = useRef({ focusedId, flyRequest, fix })
  useEffect(() => {
    latest.current = { focusedId, flyRequest, fix }
  })
  const focusFn = () =>
    geocodeFocus({
      station: network.stationById.get(latest.current.focusedId ?? '')?.pos ?? null,
      view: viewCenter(),
      fix: latest.current.fix,
      lastFly: latest.current.flyRequest,
    })
  const geo = useGeocode(placesOn ? GEOCODE_URL : null, query, open, focusFn)
  const items = useMemo(
    () => searchItems(results, geo.status === 'ready' || geo.status === 'pending' ? geo.places : []),
    [results, geo],
  )
  const current = activeIndex(items, activeKey)
  const optionId = (key: string) => `${listId}-${key}`
  const activeOption = items[current]
  const typed = query.trim() !== ''

  const reset = (text: string) => {
    setQuery(text)
    setActiveKey(null)
  }
  useImperativeHandle(ref, () => ({
    open: () => {
      reset('')
      setOpen(true)
      dialog.current?.showModal()
      input.current?.focus()
    },
  }))
  const close = () => dialog.current?.close()
  const choose = (item: SearchItem<Station>) => {
    if (item.kind === 'station') onChoose(item.station.id)
    else {
      const pick = placePick(item.result, item.text, network.stations)
      if (!pick || !onChoosePlace) throw new Error('A place was picked with no station to name or nobody to tell')
      onChoosePlace(pick)
    }
    close()
  }
  const move = (next: number) => {
    const item = items[next]
    if (!item) return
    setActiveKey(item.key)
    document.getElementById(optionId(item.key))?.scrollIntoView({ block: 'nearest' })
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(Math.min(current + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(Math.max(current - 1, 0))
    } else if (e.key === 'Enter' && activeOption && !e.nativeEvent.isComposing) {
      e.preventDefault()
      choose(activeOption)
    }
  }

  return (
    <dialog
      ref={dialog}
      onClose={() => {
        setOpen(false)
        onClose?.()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') e.stopPropagation()
      }}
      aria-label={label}
      className="pointer-events-auto m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-canvas p-0 text-ink backdrop:bg-canvas"
    >
      <div className="mx-auto flex h-full max-w-xl flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
        <div className="flex items-center gap-2 border-b border-edge p-3">
          <label htmlFor={`${id}-q`} className="sr-only">
            {label}
          </label>
          <div className="relative min-w-0 flex-1">
            <input
              ref={input}
              id={`${id}-q`}
              type="text"
              role="combobox"
              aria-expanded={items.length > 0}
              aria-controls={items.length > 0 ? listId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={activeOption ? optionId(activeOption.key) : undefined}
              aria-describedby={[placesOn && disclosureId, !typed && hintId].filter(Boolean).join(' ') || undefined}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="go"
              placeholder={placeholder}
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
        {placesOn && (
          <p id={disclosureId} className="px-3 pt-2 text-xs text-ink-dim">
            Addresses and places are looked up through our server; your location is never sent.
          </p>
        )}
        <p role="status" className="sr-only">
          {statusText(typed, results.length)}
        </p>
        <p role="status" className="sr-only">
          {geocodeAnnouncement(geo)}
        </p>
        {!typed && (
          <p id={hintId} className="p-3 text-sm text-ink-dim">
            {placesOn ? 'Try 14 st, 120 broadway or empire state.' : 'Try a name like 14 st, bedford or times sq.'}
          </p>
        )}
        <SearchResults
          network={network}
          listId={listId}
          items={items}
          current={current}
          optionId={optionId}
          multiBorough={multiBorough}
          view={geo}
          emptyText={searchEmptyText(typed, results.length, geo)}
          keyboardInset={keyboardInset}
          onChoose={choose}
          onActive={(i) => {
            const item = items[i]
            if (item) setActiveKey(item.key)
          }}
        />
      </div>
    </dialog>
  )
}

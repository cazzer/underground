import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import { GEOCODE_URL } from '../data/realtime'
import { useGeocode } from '../data/useGeocode'
import { useFocus } from '../lib/focus'
import { geocodeFocus } from '../lib/geocodeFocus'
import { locateMemoryFor } from '../lib/locateMemory'
import { announcementFor, nextErrorSpoken, searchEmptyText, type ErrorSpoken } from '../lib/geocodeView'
import { multiBoroughNames } from '../lib/labels'
import type { MarkedPlacement } from '../lib/locate'
import type { Network } from '../lib/network'
import type { StationGroup } from '../lib/stationGroups'
import { placePick, type PlacePick } from '../lib/placeLabel'
import { searchItems, type SearchItem } from '../lib/searchItems'
import { rowActions } from '../lib/searchRowActions'
import { searchNav, type NavSpot } from '../lib/searchNav'
import { buildSearchIndex, SEARCH_LIMIT, searchStations } from '../lib/stationSearch'
import type { TripEnd } from '../lib/trip'
import type { DirectionsTarget } from '../lib/tripDirections'
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
  /**
   * Given (the HUD's search), every row also offers From and To, which call this and close the dialog; the trip
   * panel's own searches leave it out and their rows have one button. A place's target is its nearest station and its name.
   */
  onDirections?: (end: TripEnd, target: DirectionsTarget) => void
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
 * is trapped. Always mounted (closed, hence hidden) so `open()` can focus the input inside the tap. A labelled
 * input over lists of result rows, each a real button (not a combobox: a listbox option can't hold the From and To
 * buttons). Every button is in Tab order; ArrowDown from the input, Up and Down between rows, Left and Right within
 * one, and a printable key back to the input are shortcuts (`searchNav`). Enter in the input picks the highlighted
 * first row. Closing hands focus back to whatever had it when the dialog opened. Esc closes it and goes no
 * further: the dialog stops the keydown, so a window-level Esc handler (the HUD's panels) never also acts on it.
 */
export function StationSearch({ network, onChoose, onChoosePlace, onDirections, fix = null, onClose, label, placeholder, ref }: StationSearchProps) {
  const placesOn = GEOCODE_URL !== null && onChoosePlace !== undefined
  label ??= placesOn ? 'Search stations and places' : 'Search stations'
  placeholder ??= placesOn ? 'Station, address or place' : 'Station name'
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const hintId = `${id}-hint`
  const disclosureId = `${id}-disclosure`
  const enterId = `${id}-enter`
  const index = useMemo(() => buildSearchIndex(network.stationGroups), [network])
  const multiBorough = useMemo(() => multiBoroughNames(network.stationGroups), [network])
  const keyboardInset = useKeyboardInset()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)
  const results = useMemo(() => searchStations(index, query), [index, query])
  // The bias is read when a request goes out, not per render.
  const { focusedId, viewCenter } = useFocus()
  const latest = useRef({ focusedId, fix })
  useEffect(() => {
    latest.current = { focusedId, fix }
  })
  const focusFn = () => {
    const view = viewCenter()
    return geocodeFocus({
      station: network.stationById.get(latest.current.focusedId ?? '')?.pos ?? null,
      stationId: latest.current.focusedId,
      view,
      fix: latest.current.fix,
      locate: locateMemoryFor(view),
    })
  }
  const geo = useGeocode(placesOn ? GEOCODE_URL : null, query, open, focusFn)
  // The unavailable sentence is spoken once per dialog session; the state follows the view during render.
  const [errorSpoken, setErrorSpoken] = useState<ErrorSpoken>('none')
  const nextSpoken = nextErrorSpoken(errorSpoken, geo, open)
  if (nextSpoken !== errorSpoken) setErrorSpoken(nextSpoken)
  const items = useMemo(
    () => searchItems(results, geo.status === 'ready' || geo.status === 'pending' ? geo.places : []),
    [results, geo],
  )
  const typed = query.trim() !== ''
  const actions = rowActions(onDirections !== undefined)

  useImperativeHandle(ref, () => ({
    open: () => {
      setQuery('')
      setOpen(true)
      dialog.current?.showModal()
      input.current?.focus()
    },
  }))
  const close = () => dialog.current?.close()
  // A pick sets the caller's state before `close()`: the dialog hands focus back to the opener, then the caller's own focus move lands.
  const placeOf = (item: Exclude<SearchItem<StationGroup>, { kind: 'station' }>) => {
    const pick = placePick(item.result, item.text, network.stations, network.groupById)
    if (!pick || !onChoosePlace) throw new Error('A place was picked with no station to name or nobody to tell')
    return pick
  }
  const choose = (item: SearchItem<StationGroup>) => {
    if (item.kind === 'station') onChoose(item.station.id)
    else onChoosePlace?.(placeOf(item))
    close()
  }
  const directions = (item: SearchItem<StationGroup>, end: TripEnd) => {
    if (!onDirections) throw new Error('Directions were picked in a search that offers none')
    if (item.kind === 'station') onDirections(end, { stationId: item.station.id, place: null })
    else {
      const pick = placeOf(item)
      onDirections(end, { stationId: pick.nearest.id, place: pick.name })
    }
    close()
  }
  const focusSpot = (spot: NavSpot) => {
    if (spot === 'input') input.current?.focus()
    else dialog.current?.querySelector<HTMLElement>(`[data-row="${spot.row}"][data-col="${spot.col}"]`)?.focus()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const first = items[0]
    if (e.key === 'Enter' && first && !e.nativeEvent.isComposing) {
      e.preventDefault()
      choose(first)
      return
    }
    const nav = searchNav('input', e, items.length, actions.length)
    if (!nav) return
    e.preventDefault()
    focusSpot(nav.to)
  }
  const onRowKey = (e: KeyboardEvent<HTMLElement>) => {
    const row = Number(e.target instanceof HTMLElement ? e.target.dataset.row : undefined)
    const col = Number(e.target instanceof HTMLElement ? e.target.dataset.col : undefined)
    if (!Number.isInteger(row) || !Number.isInteger(col)) return
    const nav = searchNav({ row, col }, e, items.length, actions.length)
    if (!nav) return
    if (!nav.keepDefault) e.preventDefault()
    focusSpot(nav.to)
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
              aria-describedby={[placesOn && disclosureId, !typed && hintId, enterId].filter(Boolean).join(' ')}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="go"
              placeholder={placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              onKeyDown={onKeyDown}
              className="min-h-11 w-full border border-edge bg-panel pr-11 pl-3 text-base text-ink placeholder:text-ink-dim focus-visible:outline-2 focus-visible:outline-focus"
            />
            {query !== '' && (
              <button
                type="button"
                onClick={() => {
                  setQuery('')
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
        {/* The input's description, read when it takes focus, not on every keystroke. */}
        <p id={enterId} className="sr-only">
          Press Enter to choose the first result.
        </p>
        {placesOn && (
          <p id={disclosureId} className="px-3 pt-2 text-xs text-ink-dim">
            Streets, addresses and places are looked up through our server; your location is never sent.
          </p>
        )}
        <p role="status" className="sr-only">
          {statusText(typed, results.length)}
        </p>
        <p role="status" className="sr-only">
          {announcementFor(geo, nextSpoken)}
        </p>
        {!typed && (
          <p id={hintId} className="p-3 text-sm text-ink-dim">
            {placesOn ? 'Try 14 st, bedford av & n 7, 120 broadway or empire state.' : 'Try a name like 14 st, bedford or times sq.'}
            {onDirections && ' From or To on a result plans a trip.'}
          </p>
        )}
        <SearchResults
          network={network}
          items={items}
          highlightFirst={inputFocused && typed && items.length > 0}
          actions={actions}
          multiBorough={multiBorough}
          view={geo}
          emptyText={searchEmptyText(typed, results.length, geo)}
          keyboardInset={keyboardInset}
          onChoose={choose}
          onDirections={directions}
          onRowKey={onRowKey}
        />
      </div>
    </dialog>
  )
}

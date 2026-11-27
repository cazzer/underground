import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import { GEOCODE_URL } from '../data/realtime'
import type { LocateControls } from '../data/useLocate'
import { useGeocode } from '../data/useGeocode'
import { useFocus } from '../lib/focus'
import { searchFocus } from '../lib/geocodeFocus'
import { announcementFor, nextErrorSpoken, searchEmptyText, type ErrorSpoken } from '../lib/geocodeView'
import { multiBoroughNames } from '../lib/labels'
import type { Network } from '../lib/network'
import type { StationGroup } from '../lib/stationGroups'
import { placePick, tripPlaceOf, type PlacePick } from '../lib/placeLabel'
import { enterTarget, searchItems, type SearchItem } from '../lib/searchItems'
import { HERE_PLACE, searchStatusText } from '../lib/searchHere'
import { rowActions } from '../lib/searchRowActions'
import { searchNav, type NavSpot } from '../lib/searchNav'
import { buildSearchIndex, SEARCH_LIMIT, searchStations } from '../lib/stationSearch'
import type { TripEnd } from '../lib/trip'
import type { DirectionsTarget } from '../lib/tripDirections'
import { SearchResults } from './SearchResults'
import { SearchBar } from './SearchBar'
import { SearchHere } from './SearchHere'
import { useKeyboardInset } from './useKeyboardInset'
import { useSearchHere } from './useSearchHere'

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
  /**
   * The shared location state. Its fix is read to keep the geocode bias away from it and to offer "My location" and rank
   * nearer stations first on ties, never sent anywhere; pressing "Use my location" runs `locate.find()`, no camera move.
   */
  locate: LocateControls
  /**
   * Given, the dialog offers "Use my location" while the input is blank, and a "My location" row once a fix is known:
   * choosing it calls this with the nearest station's id and closes the dialog. With `onDirections` the row also
   * offers From and To (the nearest station, noted as "you").
   */
  onChooseHere?: (nearestStationId: string) => void
  /** The dialog closed (Esc, the Android back gesture, Cancel, or a choice); mirrors the native close event. */
  onClose?: () => void
  /** The dialog's name and the input's label; a second instance says what it picks. Default "Search stations and places", or "Search stations" with places off. */
  label?: string
  /** The input's placeholder. Default "Station, address or place", or "Station name" with places off. */
  placeholder?: string
  ref: Ref<StationSearchHandle>
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
export function StationSearch({ network, onChoose, onChoosePlace, onDirections, locate, onChooseHere, onClose, label, placeholder, ref }: StationSearchProps) {
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
  const here = useSearchHere({ locate, enabled: onChooseHere !== undefined, open, query, network })
  const { fix, distanceOf } = here
  const results = useMemo(() => searchStations(index, query, SEARCH_LIMIT, distanceOf), [index, query, distanceOf])
  // The bias is read when a request goes out, not per render.
  const { focusedId, viewCenter } = useFocus()
  const latest = useRef({ focusedId, fix })
  useEffect(() => {
    latest.current = { focusedId, fix }
  })
  const focusFn = () =>
    searchFocus({ focusedId: latest.current.focusedId, stationById: network.stationById, view: viewCenter(), fix: latest.current.fix })
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
  const target = enterTarget(items, geo)
  const actions = rowActions(onDirections !== undefined)
  // The location control and its row sit above the results and take the first data-rows.
  const lead = here.showControl ? 1 + (here.row ? 1 : 0) : 0
  const rowCount = lead + items.length

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
      onDirections(end, { stationId: pick.nearest.id, place: tripPlaceOf(pick) })
    }
    close()
  }
  const chooseHere = () => {
    if (here.row) onChooseHere?.(here.row.nearestId)
    close()
  }
  const directionsHere = (end: TripEnd) => {
    if (!onDirections || !here.row) throw new Error('Directions were picked from a location row that offers none')
    onDirections(end, { stationId: here.row.nearestId, place: HERE_PLACE })
    close()
  }
  const focusSpot = (spot: NavSpot) => {
    if (spot === 'input') {
      input.current?.focus()
      return
    }
    const at = (col: number) => dialog.current?.querySelector<HTMLElement>(`[data-row="${spot.row}"][data-col="${col}"]`)
    // The location control has one button: a move to a column it lacks lands on its first.
    ;(at(spot.col) ?? at(0))?.focus()
  }
  // Only a new arrival moves focus. A press here that found you hands it to the My location row, which speaks the rest of the answer.
  const { arrived } = here
  useEffect(() => {
    if (arrived) focusSpot({ row: 1, col: 0 })
  }, [arrived])
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && items.length > 0 && !e.nativeEvent.isComposing) {
      e.preventDefault()
      // A first row from an earlier lookup is not picked: the list is about to change under the typed text.
      if (target) choose(target)
      return
    }
    const nav = searchNav('input', e, rowCount, actions.length)
    if (!nav) return
    e.preventDefault()
    focusSpot(nav.to)
  }
  const onRowKey = (e: KeyboardEvent<HTMLElement>) => {
    const row = Number(e.target instanceof HTMLElement ? e.target.dataset.row : undefined)
    const col = Number(e.target instanceof HTMLElement ? e.target.dataset.col : undefined)
    if (!Number.isInteger(row) || !Number.isInteger(col)) return
    const nav = searchNav({ row, col }, e, rowCount, actions.length)
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
        <SearchBar
          inputRef={input}
          id={id}
          label={label}
          placeholder={placeholder}
          describedBy={[placesOn && disclosureId, !typed && hintId, enterId].filter(Boolean).join(' ')}
          query={query}
          onQuery={setQuery}
          onFocusChange={setInputFocused}
          onKeyDown={onKeyDown}
          onCancel={close}
        />
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
          {here.spoken ?? searchStatusText(typed, results.length)}
        </p>
        <p role="status" className="sr-only">
          {announcementFor(geo, nextSpoken)}
        </p>
        {!typed && (
          <p id={hintId} className="p-3 text-sm text-ink-dim">
            {placesOn ? 'Try 14 st, bedford\u00a0av\u00a0&\u00a0n\u00a07, 120 broadway or empire state.' : 'Try a name like 14 st, bedford or times sq.'}
            {onDirections && ' From or To on a result plans a trip.'}
          </p>
        )}
        <SearchResults
          network={network}
          items={items}
          highlightFirst={inputFocused && typed && target !== null}
          actions={actions}
          multiBorough={multiBorough}
          view={geo}
          emptyText={searchEmptyText(typed, results.length, geo)}
          keyboardInset={keyboardInset}
          onChoose={choose}
          onDirections={directions}
          rowOffset={lead}
          lead={
            here.showControl && (
              <SearchHere
                firstRow={0}
                row={here.row}
                visible={here.visible}
                locating={here.locating}
                actions={actions}
                onPress={here.press}
                onChoose={chooseHere}
                onDirections={directionsHere}
              />
            )
          }
          onRowKey={onRowKey}
        />
      </div>
    </dialog>
  )
}

import { useRef, useState, type RefObject } from 'react'
import type { LocateControls } from '../data/useLocate'
import type { PlacePick } from '../lib/placeLabel'
import type { StationSearchHandle } from './StationSearch'
import type { PlaceLine } from './usePlaceLine'

interface HudSearchArgs {
  searchButton: RefObject<HTMLButtonElement | null>
  locateButton: RefObject<HTMLButtonElement | null>
  stationHeading: RefObject<HTMLElement | null>
  place: PlaceLine
  locate: LocateControls
  /** The service changes list is open: a station pick closes it, so it doesn't hide the station's panel. */
  changesOpen: boolean
  closeChanges: () => void
  select: (stationId: string) => void
}

export interface HudSearch {
  search: RefObject<StationSearchHandle | null>
  /** Mirrors the dialog's native open state (set on open and on its close event); the Esc guard reads it. */
  searchOpen: boolean
  openSearch: () => void
  onSearchClosed: () => void
  onSearchChoose: (stationId: string) => void
  onSearchChoosePlace: (pick: PlacePick) => void
  onSearchChooseHere: () => void
}

/**
 * The HUD's search dialog: opening it from the header, and where focus goes when it closes. Cancel and Esc leave focus
 * to the dialog, which hands it back to the button that was focused when it opened. A station choice instead moves it
 * to the new station's panel heading, a place choice to the place line, once the dialog has closed; a directions pick
 * hands focus to the trip panel (its own request), not this close event.
 */
export function useHudSearch({ searchButton, locateButton, stationHeading, place, locate, changesOpen, closeChanges, select }: HudSearchArgs): HudSearch {
  const search = useRef<StationSearchHandle>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const focusOnClose = useRef<'station' | 'place' | 'locate' | null>(null)
  const openSearch = () => {
    // A tap doesn't focus a button on iOS; the dialog restores focus to whatever had it when it opened.
    searchButton.current?.focus()
    search.current?.open()
    setSearchOpen(true)
  }
  const onSearchClosed = () => {
    setSearchOpen(false)
    const target = focusOnClose.current
    focusOnClose.current = null
    if (target) (target === 'place' ? place.lineRef : target === 'locate' ? locateButton : stationHeading).current?.focus()
  }
  const onSearchChoose = (stationId: string) => {
    focusOnClose.current = 'station'
    // A search pick asks for that station, so the list doesn't hide its panel (a map tap keeps the list open).
    if (changesOpen) closeChanges()
    select(stationId)
  }
  const onSearchChoosePlace = (pick: PlacePick) => {
    focusOnClose.current = 'place'
    place.show(pick)
  }
  // The dialog's "My location" row flies where the header button does; focus ends on that button.
  const onSearchChooseHere = () => {
    focusOnClose.current = 'locate'
    locate.showFix()
  }
  return { search, searchOpen, openSearch, onSearchClosed, onSearchChoose, onSearchChoosePlace, onSearchChooseHere }
}

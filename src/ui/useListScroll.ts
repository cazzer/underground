import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { isStackedPanel } from './useStackedPanel'

/** Most rows the list shows at once on a phone, and the most of the screen it may take (a share of the height). */
const MAX_ROWS = 5
const MAX_SHARE = 0.25
/** Never cap below the three collapsed rows. */
const MIN_ROWS = 3

export interface ListScroll<L extends HTMLElement = HTMLOListElement> {
  scroller: RefObject<HTMLDivElement | null>
  list: RefObject<L | null>
  /** Height to cap the scroller at, ending exactly at a row's bottom edge so no row is clipped; null for no cap. */
  capPx: number | null
  /** The list is taller than its scroller, so it scrolls: it takes keyboard focus and shows a "more below" fade. */
  overflows: boolean
  /** Scrolled to the bottom (nothing more below). */
  atEnd: boolean
  onScroll: () => void
}

/**
 * While the panel is stacked over the map (`isStackedPanel`), caps the list at whole rows (at most five, and at most a quarter of the screen, but
 * never fewer than the collapsed three), so the panel stays short enough to leave the map in view
 * (the train's stop list, the station's entrance list). A side-column panel gets no cap. `rowCount` re-measures when rows come and go; resizes and wrapping are
 * observed.
 */
export function useListScroll<L extends HTMLElement = HTMLOListElement>(rowCount: number): ListScroll<L> {
  const scroller = useRef<HTMLDivElement>(null)
  const list = useRef<L>(null)
  const [capPx, setCapPx] = useState<number | null>(null)
  const [overflows, setOverflows] = useState(false)
  const [atEnd, setAtEnd] = useState(true)

  const onScroll = useCallback(() => {
    const box = scroller.current
    if (box) setAtEnd(box.scrollTop + box.clientHeight >= box.scrollHeight - 2)
  }, [])

  const measureCap = useCallback(() => {
    const ol = list.current
    if (!ol) return
    const rows = [...ol.children]
    let cap: number | null = null
    if (isStackedPanel() && rows.length > MIN_ROWS) {
      const top = ol.getBoundingClientRect().top
      const limit = window.innerHeight * MAX_SHARE
      let fit = MIN_ROWS
      for (let k = MIN_ROWS; k < Math.min(rows.length, MAX_ROWS); k++) {
        if (rows[k]!.getBoundingClientRect().bottom - top <= limit) fit = k + 1
      }
      if (fit < rows.length) cap = Math.ceil(rows[fit - 1]!.getBoundingClientRect().bottom - top)
    }
    setCapPx(cap)
  }, [])

  useLayoutEffect(() => {
    measureCap()
    const ol = list.current
    if (!ol) return
    const observer = new ResizeObserver(measureCap)
    observer.observe(ol)
    window.addEventListener('resize', measureCap)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measureCap)
    }
  }, [measureCap, rowCount])

  // Once the cap is applied to the DOM, whether the list really overflows, and where it is scrolled.
  useLayoutEffect(() => {
    const box = scroller.current
    if (!box) return
    setOverflows(box.scrollHeight > box.clientHeight + 1)
    onScroll()
  }, [capPx, rowCount, onScroll])

  return { scroller, list, capPx, overflows, atEnd, onScroll }
}

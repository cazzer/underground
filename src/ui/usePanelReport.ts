import { useLayoutEffect, type RefObject } from 'react'
import type { ScreenRect } from '../lib/interiorCamera'

interface PanelReport {
  /** The bottom slot's panel element, or null while none shows. */
  panel: RefObject<HTMLElement | null>
  onPanel: (rect: ScreenRect | null) => void
  /** What the panel is for: a change of any of these re-reads the element. */
  focusedId: string | null
  trainOpen: boolean
  noticeOpen: boolean
  tripOpen: boolean
}

/**
 * Tracked while the panel is open, so a station fly-to can frame the view beside it. Resizes move a stacked
 * (phone) panel's top; window resizes move a desktop panel's left edge.
 */
export function usePanelReport({ panel, onPanel, focusedId, trainOpen, noticeOpen, tripOpen }: PanelReport): void {
  useLayoutEffect(() => {
    const el = panel.current
    if (!el) {
      onPanel(null)
      return
    }
    // The list inside changes height with every poll; only a real move of the panel reaches the scene.
    let last: ScreenRect | null = null
    const measure = () => {
      const p = el.getBoundingClientRect()
      if (last && last.left === p.left && last.top === p.top && last.right === p.right && last.bottom === p.bottom) return
      last = { left: p.left, top: p.top, right: p.right, bottom: p.bottom }
      onPanel(last)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [panel, focusedId, trainOpen, noticeOpen, tripOpen, onPanel])
}

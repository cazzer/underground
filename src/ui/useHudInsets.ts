import { useLayoutEffect, type RefObject } from 'react'
import type { Insets } from '../lib/framing'
import { hudInsets, sameInsets } from '../lib/hudInsets'

interface HudInsetElements {
  root: RefObject<HTMLElement | null>
  header: RefObject<HTMLElement | null>
  /** The Attribution footer alone, never the bottom slot that a panel shares. */
  footer: RefObject<HTMLElement | null>
}

/**
 * Reports the bands the header and footer cover: once before the scene mounts (its opening view), then again
 * whenever the header, the footer or the root changes size (a window resize or rotation, a status line adding a
 * row). Only a changed value is reported; the scene keeps its camera on an inset change, and only a flight in
 * progress retargets (useStationFlights). `onInsets` must be stable.
 */
export function useHudInsets({ root, header, footer }: HudInsetElements, onInsets: (insets: Insets) => void): void {
  useLayoutEffect(() => {
    const r = root.current
    const h = header.current
    const f = footer.current
    if (!r || !h || !f) return
    let last: Insets | null = null
    const measure = () => {
      const next = hudInsets(r.getBoundingClientRect(), h.getBoundingClientRect(), f.getBoundingClientRect())
      if (sameInsets(last, next)) return
      last = next
      onInsets(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(r)
    observer.observe(h)
    observer.observe(f)
    return () => observer.disconnect()
  }, [root, header, footer, onInsets])
}

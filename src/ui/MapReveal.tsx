import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { addAfterEffect } from '@react-three/fiber'
import type { Insets } from '../lib/framing'
import { interiorFreeRect, type ScreenRect } from '../lib/interiorCamera'
import {
  REVEAL_FADE_MS,
  REVEAL_MS,
  advanceClock,
  fadeOpacity,
  revealFront,
  revealGeometry,
  revealGradient,
  revealProgress,
} from '../lib/mapReveal'
import { prefersReducedMotion } from '../lib/reducedMotion'
import { theme } from '../theme'

interface MapRevealProps {
  /** The HUD's measured bands; read once when the wipe starts. */
  insets: Insets
  /** The station panel's rect, if one is up; read once when the wipe starts. */
  panel: ScreenRect | null
}

/**
 * The opening reveal: a `theme.background` cover over the canvas, wiped open from the middle of
 * the free area (the HUD bands and the panel left out), then unmounted. It starts on the rAF after
 * the scene's second after-render tick, so the first real frame is already drawn. Its clock
 * advances by at most `REVEAL_MAX_STEP_MS` a frame, so a stall slows it rather than jumping it.
 * z-index stays auto: tree order puts it over the canvas's DOM labels and under the HUD. Under
 * reduced motion it fades out over 200 ms instead of sweeping. A crash in a frame removes it.
 */
export function MapReveal({ insets, panel }: MapRevealProps) {
  const [done, setDone] = useState(false)
  const el = useRef<HTMLDivElement>(null)
  const inputs = useRef({ insets, panel })
  useLayoutEffect(() => {
    inputs.current = { insets, panel }
  })

  useEffect(() => {
    const node = el.current
    if (!node) return
    node.style.background = theme.background
    node.style.opacity = '1'
    let ticks = 0
    let raf = 0

    function start(target: HTMLDivElement): void {
      const rect = target.getBoundingClientRect()
      const free = interiorFreeRect(
        { width: rect.width, height: rect.height },
        inputs.current.insets,
        inputs.current.panel,
      )
      const geometry = revealGeometry(rect.width, rect.height, free)
      const reduced = prefersReducedMotion()
      let acc = 0
      let last = -1
      const step = (now: number): void => {
        try {
          if (last >= 0) acc = advanceClock(acc, last, now)
          last = now
          if (reduced) {
            target.style.opacity = String(fadeOpacity(acc))
            if (acc >= REVEAL_FADE_MS) {
              setDone(true)
              return
            }
          } else {
            const p = revealProgress(acc, REVEAL_MS)
            target.style.background = revealGradient(geometry, revealFront(geometry, p), theme.background)
            if (p >= 1) {
              setDone(true)
              return
            }
          }
          raf = requestAnimationFrame(step)
        } catch (error) {
          console.error('Map reveal failed; showing the map', error)
          setDone(true)
        }
      }
      raf = requestAnimationFrame(step)
    }

    const unsubscribe = addAfterEffect(() => {
      ticks += 1
      if (ticks < 2) return
      unsubscribe()
      raf = requestAnimationFrame(() => start(node))
    })

    return () => {
      unsubscribe()
      cancelAnimationFrame(raf)
    }
  }, [])

  if (done) return null
  return (
    <div
      ref={el}
      data-map-reveal
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{ background: theme.background }}
    />
  )
}

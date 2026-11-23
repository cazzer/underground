import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { interiorOpacity } from '../lib/interiorReveal'
import type { Presence } from '../lib/presence'
import { theme } from '../theme'
import { cameraDistance } from './cameraDistance'
import type { PresenceStore } from './InteriorPresence'
import type { InteriorModel } from './interiorModel'
import { RENDER_ORDER } from './renderOrder'
import { useLineLayer } from './useLineLayer'

interface InteriorFocusFrameProps {
  model: InteriorModel
  /** The focused interior's own presence. */
  presence: Presence
  /** Every shown interior's presence: the frame shows by the most present other one. */
  store: PresenceStore
}

/**
 * The focused interior's footprint (o3r.7) as a solid theme.stationFocus loop at street level, so it reads apart from
 * the neighbours drawn beside it. Only while another interior shows: its opacity is the reveal's × its own presence ×
 * the most present other interior's, so it eases in and out with them. A child of the interior's group (its anchor).
 * Allocates nothing per frame.
 */
export function InteriorFocusFrame({ model, presence, store }: InteriorFocusFrameProps) {
  const line = useLineLayer(model.focusFrame, RENDER_ORDER.interiorFocusFrame, theme.interiorLineWidth)
  const shown = useRef(-1)
  const shownLine = useRef<typeof line>(null)

  useFrame((state) => {
    if (!line) return
    let others = 0
    for (let i = 0; i < store.items.length; i++) {
      const p = store.items[i]!
      if (p !== presence && p.value > others) others = p.value
    }
    const o = interiorOpacity(cameraDistance(state)) * presence.value * others
    if (o === shown.current && line === shownLine.current) return
    shown.current = o
    shownLine.current = line
    line.material.opacity = o
    line.visible = o > 0
  })

  return line ? <primitive object={line} /> : null
}

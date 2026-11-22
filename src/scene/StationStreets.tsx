import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Group } from 'three'
import { useStationStreets, type StreetLayer } from '../data/useStationStreets'
import { useFocus } from '../lib/focus'
import { interiorOpacity } from '../lib/interiorReveal'
import { theme } from '../theme'
import { cameraDistance } from './cameraDistance'
import { RENDER_ORDER } from './renderOrder'
import { streetsLook } from './streetsLook'
import { useLineLayer } from './useLineLayer'

const ORDER = streetsLook === 'over' ? RENDER_ORDER.streetsOver : RENDER_ORDER.streets

/**
 * The focused station's streets, interior or not: fetched on focus, drawn while it stays focused, gone with the
 * focus. Keyed by station, so a new station starts hidden and fades in from its own first frame.
 */
export function StationStreets() {
  const { focusedId } = useFocus()
  const layer = useStationStreets(focusedId)
  return layer && <StreetLines key={layer.stationId} layer={layer} />
}

interface StreetLinesProps {
  layer: StreetLayer
}

/** One merged line layer at street level (y = 0) at the station's anchor, fading in with the interior reveal. */
function StreetLines({ layer }: StreetLinesProps) {
  const group = useRef<Group>(null)
  const shown = useRef(-1)
  const lines = useLineLayer(layer.buffers, ORDER, theme.streetWidth)

  useFrame((state) => {
    const g = group.current
    if (!g || !lines) return
    const o = interiorOpacity(cameraDistance(state))
    if (o === shown.current) return
    shown.current = o
    lines.material.opacity = o
    g.visible = o > 0
  })

  return (
    <group ref={group} position={[layer.anchor.x, 0, layer.anchor.z]} visible={false}>
      {lines && <primitive object={lines} />}
    </group>
  )
}

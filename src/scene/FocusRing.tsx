import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { RingGeometry, type Mesh } from 'three'
import type { Ground } from '../lib/projection'
import { theme } from '../theme'
import { cameraDistance, focusScaleFactor, markerRadiusPx, screenScale } from './cameraDistance'
import { MARKER_MIN_METERS, MARKER_Y, RING_INNER, SEGMENTS } from './markerShape'
import { RENDER_ORDER } from './renderOrder'

interface FocusRingProps {
  position: Ground
}

/**
 * The focus ring of a focused station that has no interior (the fallback marker): `theme.stationFocus`,
 * a little larger than its neighbours, drawn above the trains so a passing train can't hide which station is
 * selected. Same geometry and per-frame size as the instanced ring it covers; the scale is written only when it
 * changes. A station with an interior draws no ring (the interior marks it).
 */
export function FocusRing({ position }: FocusRingProps) {
  const mesh = useRef<Mesh>(null)
  const geometry = useMemo(() => new RingGeometry(RING_INNER, 1, SEGMENTS).rotateX(-Math.PI / 2), [])
  const drawn = useRef(NaN)

  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame((state) => {
    const m = mesh.current
    if (!m) return
    const d = cameraDistance(state)
    const base = screenScale(d, markerRadiusPx(d), MARKER_MIN_METERS)
    const s = base * focusScaleFactor(d, base)
    if (s === drawn.current) return
    drawn.current = s
    m.scale.setScalar(s)
  })

  return (
    <mesh ref={mesh} geometry={geometry} position={[position.x, MARKER_Y, position.z]} renderOrder={RENDER_ORDER.focusRing}>
      <meshBasicMaterial color={theme.stationFocus} transparent depthTest={false} depthWrite={false} />
    </mesh>
  )
}

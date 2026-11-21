import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { RingGeometry, type Mesh } from 'three'
import type { Ground } from '../lib/projection'
import { theme } from '../theme'
import { cameraDistance, focusScaleFactor, markerRadiusPx, screenScale } from './cameraDistance'
import { RENDER_ORDER } from './renderOrder'
import { MARKER_MIN_METERS, MARKER_Y, RING_INNER, SEGMENTS } from './markerShape'

interface FocusRingProps {
  position: Ground
}

/**
 * A copy of the focused station's ring drawn above the live trains and the interior veil, so a passing
 * train or the veil hides every other marker but not this one. Same geometry and per-frame size as the
 * instanced ring it covers.
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

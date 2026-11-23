import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { CircleGeometry, type Group } from 'three'
import type { Ground } from '../lib/projection'
import { theme } from '../theme'
import { cameraDistance, screenScale } from './cameraDistance'
import { DOT_RADIUS, HALO_RADIUS, pinOutlineBuffers } from './placePinShape'
import { RENDER_ORDER } from './renderOrder'
import { useLineLayer } from './useLineLayer'

interface PlacePinProps {
  /** The searched place's ground point (the user's pick, never the location fix). */
  ground: Ground
}

/** The pin's radius on screen, and the smallest it gets in meters when zoomed right in. */
const PIN_PX = 8
const PIN_MIN_METERS = 5
const Y_PIN = 0.35

/**
 * The pin on a searched place (or street, or intersection): a diamond outline and dot in `theme.placePin` on a thin
 * background-colored halo, constant size on screen like the location reticle. Mounted only while the place line shows.
 * No event handlers, so it never takes a pick.
 */
export function PlacePin({ ground }: PlacePinProps) {
  const pin = useRef<Group>(null)
  const drawn = useRef(NaN)
  // A circle of four segments is a diamond, corners on the axes.
  const halo = useMemo(() => new CircleGeometry(HALO_RADIUS, 4).rotateX(-Math.PI / 2), [])
  const dot = useMemo(() => new CircleGeometry(DOT_RADIUS, 24).rotateX(-Math.PI / 2), [])
  const outlineBuffers = useMemo(() => pinOutlineBuffers(theme.placePin), [])
  const outline = useLineLayer(outlineBuffers, RENDER_ORDER.placePin, theme.placePinWidth)

  useEffect(
    () => () => {
      halo.dispose()
      dot.dispose()
    },
    [halo, dot],
  )

  useFrame((state) => {
    const g = pin.current
    if (!g) return
    const s = screenScale(cameraDistance(state), PIN_PX, PIN_MIN_METERS)
    if (s === drawn.current) return
    drawn.current = s
    g.scale.setScalar(s)
  })

  return (
    <group ref={pin} position={[ground.x, Y_PIN, ground.z]}>
      <mesh geometry={halo} renderOrder={RENDER_ORDER.placePinHalo}>
        <meshBasicMaterial color={theme.background} transparent depthTest={false} depthWrite={false} />
      </mesh>
      <mesh geometry={dot} renderOrder={RENDER_ORDER.placePin}>
        <meshBasicMaterial color={theme.placePin} transparent depthTest={false} depthWrite={false} />
      </mesh>
      {outline && <primitive object={outline} />}
    </group>
  )
}

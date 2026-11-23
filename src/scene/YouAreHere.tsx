import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { CircleGeometry, RingGeometry, type Group } from 'three'
import type { Ground } from '../lib/projection'
import { theme } from '../theme'
import { cameraDistance, screenScale } from './cameraDistance'
import { accuracyEdgeBuffers, DOT_RADIUS, HALO_INNER, HALO_OUTER, RETICLE_MIN_METERS, RETICLE_PX, reticleBuffers } from './hereShape'
import { RENDER_ORDER } from './renderOrder'
import { useLineLayer } from './useLineLayer'

interface YouAreHereProps {
  ground: Ground
  /** Radius (meters) of the translucent accuracy disc. */
  accuracyM: number
}

const SEGMENTS = 48
const Y_ACCURACY = 0.1
const Y_RETICLE = 0.3

/**
 * "You are here": a reticle (ring and four ticks on a thin background-colored halo band, center dot) that keeps a
 * constant size on screen, inside a translucent disc of the fix's accuracy radius. No event handlers,
 * so it never takes a pick. Location lives in props only.
 */
export function YouAreHere({ ground, accuracyM }: YouAreHereProps) {
  const reticle = useRef<Group>(null)
  const drawn = useRef(NaN)
  const disc = useMemo(() => new CircleGeometry(1, SEGMENTS * 2).rotateX(-Math.PI / 2), [])
  const dot = useMemo(() => new CircleGeometry(DOT_RADIUS, SEGMENTS).rotateX(-Math.PI / 2), [])
  const halo = useMemo(() => new RingGeometry(HALO_INNER, HALO_OUTER, SEGMENTS).rotateX(-Math.PI / 2), [])
  const edgeBuffers = useMemo(() => accuracyEdgeBuffers(theme.here), [])
  const reticleLines = useMemo(() => reticleBuffers(theme.here), [])
  const edge = useLineLayer(edgeBuffers, RENDER_ORDER.hereAccuracyEdge, theme.hereLineWidth)
  const ring = useLineLayer(reticleLines, RENDER_ORDER.here, theme.hereLineWidth)

  useEffect(
    () => () => {
      disc.dispose()
      dot.dispose()
      halo.dispose()
    },
    [disc, dot, halo],
  )

  useFrame((state) => {
    const g = reticle.current
    if (!g) return
    const s = screenScale(cameraDistance(state), RETICLE_PX, RETICLE_MIN_METERS)
    if (s === drawn.current) return
    drawn.current = s
    g.scale.setScalar(s)
  })

  const r = Math.max(accuracyM, 1)
  return (
    <>
      <group position={[ground.x, Y_ACCURACY, ground.z]} scale={[r, 1, r]}>
        <mesh geometry={disc} renderOrder={RENDER_ORDER.hereAccuracy}>
          <meshBasicMaterial color={theme.here} opacity={theme.hereAccuracyOpacity} transparent depthTest={false} depthWrite={false} />
        </mesh>
        {edge && <primitive object={edge} />}
      </group>
      <group ref={reticle} position={[ground.x, Y_RETICLE, ground.z]}>
        <mesh geometry={halo} renderOrder={RENDER_ORDER.hereHalo}>
          <meshBasicMaterial color={theme.background} transparent depthTest={false} depthWrite={false} />
        </mesh>
        <mesh geometry={dot} renderOrder={RENDER_ORDER.here}>
          <meshBasicMaterial color={theme.here} transparent depthTest={false} depthWrite={false} />
        </mesh>
        {ring && <primitive object={ring} />}
      </group>
    </>
  )
}

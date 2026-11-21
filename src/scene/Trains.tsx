import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { DynamicDrawUsage, Object3D, type InstancedMesh } from 'three'
import { pointAlong, type ShapePath } from '../lib/network'
import { pingPong } from '../lib/pingPong'
import { theme } from '../theme'
import { cameraDistance, screenScale } from './cameraDistance'
import { RENDER_ORDER } from './renderOrder'

const TRAINS_PER_SHAPE = 3
/** Fake motion: much faster than real service so movement is visible when zoomed out. */
const SPEED_MPS = 60
const DOT_PX = 3.5
const DOT_MIN_METERS = 2.5

interface Train {
  path: ShapePath
  /** Offset along the ping-pong cycle, meters. */
  phase: number
}

interface TrainsProps {
  /** Fake motion until live trains (8x4.7): a few dots ping-pong along each path. */
  paths: readonly ShapePath[]
}

export function Trains({ paths }: TrainsProps) {
  const mesh = useRef<InstancedMesh>(null)
  const dummy = useMemo(() => {
    const o = new Object3D()
    o.rotation.x = -Math.PI / 2
    return o
  }, [])
  const point = useMemo(() => ({ x: 0, z: 0 }), [])
  const trains = useMemo<Train[]>(
    () =>
      paths.flatMap((path, pathIndex) =>
        Array.from({ length: TRAINS_PER_SHAPE }, (_, i) => ({
          path,
          phase: ((i + pathIndex * 0.37) / TRAINS_PER_SHAPE) * 2 * path.length,
        })),
      ),
    [paths],
  )

  useLayoutEffect(() => {
    mesh.current?.instanceMatrix.setUsage(DynamicDrawUsage)
  }, [trains])

  useFrame((state) => {
    const m = mesh.current
    if (!m) return
    const scale = screenScale(cameraDistance(state), DOT_PX, DOT_MIN_METERS)
    const travelled = state.clock.elapsedTime * SPEED_MPS
    for (let i = 0; i < trains.length; i++) {
      const train = trains[i]!
      pointAlong(train.path, pingPong(travelled + train.phase, train.path.length), point)
      dummy.position.set(point.x, 0.5, point.z)
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    }
    m.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, trains.length]} frustumCulled={false} renderOrder={RENDER_ORDER.trains}>
      <circleGeometry args={[1, 20]} />
      <meshBasicMaterial color={theme.train} transparent depthTest={false} depthWrite={false} />
    </instancedMesh>
  )
}

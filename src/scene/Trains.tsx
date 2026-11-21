import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Object3D, type InstancedMesh } from 'three'
import { network, pointAlong } from '../lib/network'
import { theme } from '../theme'
import { cameraDistance, screenScale } from './cameraDistance'

const TRAINS_PER_ROUTE = 5
/** Fake motion: much faster than real service so movement is visible when zoomed out. */
const SPEED_MPS = 60
const DOT_PX = 3.5
const DOT_MIN_METERS = 2.5

interface Train {
  routeIndex: number
  /** Offset along the ping-pong cycle, meters. */
  phase: number
}

/** Triangle wave: 0 -> length -> 0 over a 2*length cycle. */
function pingPong(distance: number, length: number): number {
  const m = ((distance % (2 * length)) + 2 * length) % (2 * length)
  return m <= length ? m : 2 * length - m
}

export function Trains() {
  const mesh = useRef<InstancedMesh>(null)
  const dummy = useMemo(() => new Object3D(), [])
  const trains = useMemo<Train[]>(
    () =>
      network.routes.flatMap((route, routeIndex) =>
        Array.from({ length: TRAINS_PER_ROUTE }, (_, i) => ({
          routeIndex,
          phase: ((i + routeIndex * 0.37) / TRAINS_PER_ROUTE) * 2 * route.length,
        })),
      ),
    [],
  )

  useFrame((state) => {
    const m = mesh.current
    if (!m) return
    const scale = screenScale(cameraDistance(state), DOT_PX, DOT_MIN_METERS)
    const travelled = state.clock.elapsedTime * SPEED_MPS
    trains.forEach((train, i) => {
      const route = network.routes[train.routeIndex]!
      const p = pointAlong(route, pingPong(travelled + train.phase, route.length))
      dummy.position.set(p.x, 0.5, p.z)
      dummy.rotation.set(-Math.PI / 2, 0, 0)
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    })
    m.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, trains.length]} frustumCulled={false} renderOrder={4}>
      <circleGeometry args={[1, 20]} />
      <meshBasicMaterial color={theme.train} depthTest={false} depthWrite={false} />
    </instancedMesh>
  )
}

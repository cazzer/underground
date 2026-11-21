import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { DynamicDrawUsage, Object3D, type InstancedMesh } from 'three'
import { network, pointAlong, type Route } from '../lib/network'
import { pingPong } from '../lib/pingPong'
import { theme } from '../theme'
import { cameraDistance, screenScale } from './cameraDistance'

const TRAINS_PER_ROUTE = 5
/** Fake motion: much faster than real service so movement is visible when zoomed out. */
const SPEED_MPS = 60
const DOT_PX = 3.5
const DOT_MIN_METERS = 2.5

interface Train {
  route: Route
  /** Offset along the ping-pong cycle, meters. */
  phase: number
}

export function Trains() {
  const mesh = useRef<InstancedMesh>(null)
  const dummy = useMemo(() => {
    const o = new Object3D()
    o.rotation.x = -Math.PI / 2
    return o
  }, [])
  const point = useMemo(() => ({ x: 0, z: 0 }), [])
  const trains = useMemo<Train[]>(
    () =>
      network.routes.flatMap((route, routeIndex) =>
        Array.from({ length: TRAINS_PER_ROUTE }, (_, i) => ({
          route,
          phase: ((i + routeIndex * 0.37) / TRAINS_PER_ROUTE) * 2 * route.length,
        })),
      ),
    [],
  )

  useLayoutEffect(() => {
    mesh.current?.instanceMatrix.setUsage(DynamicDrawUsage)
  }, [])

  useFrame((state) => {
    const m = mesh.current
    if (!m) return
    const scale = screenScale(cameraDistance(state), DOT_PX, DOT_MIN_METERS)
    const travelled = state.clock.elapsedTime * SPEED_MPS
    for (let i = 0; i < trains.length; i++) {
      const train = trains[i]!
      pointAlong(train.route, pingPong(travelled + train.phase, train.route.length), point)
      dummy.position.set(point.x, 0.5, point.z)
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    }
    m.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, trains.length]} frustumCulled={false} renderOrder={4}>
      <circleGeometry args={[1, 20]} />
      <meshBasicMaterial color={theme.train} transparent depthTest={false} depthWrite={false} />
    </instancedMesh>
  )
}

import { MapControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useRef, type ComponentRef } from 'react'
import { Vector3 } from 'three'
import { useFocus } from '../lib/focus'
import { nextFocus, type FocusInput } from '../lib/focusMachine'
import { network } from '../lib/network'
import type { Ground } from '../lib/projection'
import { tiltForDistance } from '../lib/tilt'

type MapControlsImpl = ComponentRef<typeof MapControls>

const START_DISTANCE = 7000
const MIN_DISTANCE = 40
const MAX_DISTANCE = 12000
/** Camera distance after clicking a station: inside the fully-tilted range. */
const FOCUS_DISTANCE = 170

interface Flight {
  target: Vector3
  distance: number
}

interface CameraRigProps {
  center: Ground
}

export function CameraRig({ center }: CameraRigProps) {
  const controls = useRef<MapControlsImpl>(null)
  const flight = useRef<Flight | null>(null)
  const scratch = useRef(new Vector3())
  const camera = useThree((s) => s.camera)
  const { focusedId, dismissedId, flyRequest, updateFromCamera } = useFocus()
  // Reused every frame so the per-frame focus check doesn't allocate.
  const input = useRef<FocusInput>({
    focusedId,
    dismissedId,
    distance: 0,
    target: { x: 0, z: 0 },
    stations: network.stations,
  })

  useLayoutEffect(() => {
    camera.position.set(center.x, START_DISTANCE, center.z + 0.001)
    controls.current?.target.set(center.x, 0, center.z)
    controls.current?.update()
  }, [camera, center.x, center.z])

  useEffect(() => {
    if (!flyRequest) return
    const station = network.stations.find((s) => s.id === flyRequest.stationId)
    if (!station) throw new Error(`Fly request for unknown station "${flyRequest.stationId}"`)
    flight.current = { target: new Vector3(station.pos.x, 0, station.pos.z), distance: FOCUS_DISTANCE }
  }, [flyRequest])

  // Runs before drei's controls.update() (priority -1) so the polar clamp applies the same frame.
  useFrame((_, delta) => {
    const c = controls.current
    if (!c) return
    let distance = camera.position.distanceTo(c.target)

    const f = flight.current
    if (f) {
      const k = 1 - Math.exp(-delta * 4)
      const step = scratch.current.copy(f.target).sub(c.target).multiplyScalar(k)
      c.target.add(step)
      camera.position.add(step)
      distance += (f.distance - distance) * k
      const offset = scratch.current.copy(camera.position).sub(c.target).setLength(distance)
      camera.position.copy(c.target).add(offset)
      if (c.target.distanceTo(f.target) < 0.5 && Math.abs(distance - f.distance) < 1) flight.current = null
    } else {
      const cur = input.current
      cur.focusedId = focusedId
      cur.dismissedId = dismissedId
      cur.distance = distance
      cur.target = c.target
      // Cheap pre-check on the reused input; only a real change pays for a copied target and
      // a functional update, which re-runs the rules against the latest state.
      if (nextFocus(cur) !== cur) {
        updateFromCamera(distance, { x: c.target.x, z: c.target.z }, network.stations)
      }
    }

    const polar = tiltForDistance(distance)
    c.minPolarAngle = polar
    c.maxPolarAngle = polar
  }, -2)

  return (
    <MapControls
      ref={controls}
      makeDefault
      enableRotate={false}
      enableDamping
      zoomToCursor
      minDistance={MIN_DISTANCE}
      maxDistance={MAX_DISTANCE}
      onStart={() => {
        flight.current = null
      }}
    />
  )
}

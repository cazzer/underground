import { MapControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useRef, type ComponentRef } from 'react'
import { Vector3 } from 'three'
import { useFocus } from '../lib/focus'
import { network } from '../lib/network'
import type { Ground } from '../lib/projection'
import { tiltForDistance } from '../lib/tilt'

type MapControlsImpl = ComponentRef<typeof MapControls>

const START_DISTANCE = 7000
const MIN_DISTANCE = 40
const MAX_DISTANCE = 12000
/** Camera distance after clicking a station: inside the fully-tilted range. */
const FOCUS_DISTANCE = 170
/** Zooming inside ENTER with a station within ENTER_RADIUS of the view center focuses it. */
const ENTER_DISTANCE = 260
const ENTER_RADIUS = 140
/** Focus is dropped once zoomed out past EXIT_DISTANCE or panned EXIT_RADIUS away. */
const EXIT_DISTANCE = 420
const EXIT_RADIUS = 300

interface Flight {
  target: Vector3
  distance: number
}

function nearestStation(at: Vector3) {
  let best: { id: string; d: number } | null = null
  for (const s of network.stations) {
    const d = Math.hypot(s.pos.x - at.x, s.pos.z - at.z)
    if (!best || d < best.d) best = { id: s.id, d }
  }
  return best
}

export function CameraRig({ center }: { center: Ground }) {
  const controls = useRef<MapControlsImpl>(null)
  const flight = useRef<Flight | null>(null)
  const scratch = useRef(new Vector3())
  const camera = useThree((s) => s.camera)
  const { focusedId, flyRequest, setFocusedFromCamera } = useFocus()

  useLayoutEffect(() => {
    camera.position.set(center.x, START_DISTANCE, center.z + 0.001)
    controls.current?.target.set(center.x, 0, center.z)
    controls.current?.update()
  }, [camera, center.x, center.z])

  useEffect(() => {
    if (!flyRequest) return
    const station = network.stations.find((s) => s.id === flyRequest.stationId)
    if (!station) return
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
      const nearest = nearestStation(c.target)
      if (nearest && distance < ENTER_DISTANCE && nearest.d < ENTER_RADIUS) {
        if (nearest.id !== focusedId) setFocusedFromCamera(nearest.id)
      } else if (focusedId && (distance > EXIT_DISTANCE || !nearest || nearest.d > EXIT_RADIUS)) {
        setFocusedFromCamera(null)
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

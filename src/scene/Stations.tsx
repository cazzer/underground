import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Group } from 'three'
import { useFocus } from '../lib/focus'
import { network, type Station } from '../lib/network'
import { theme } from '../theme'
import { cameraDistance, screenScale } from './cameraDistance'

const MARKER_PX = 8
const MARKER_MIN_METERS = 6

interface StationMarkerProps {
  station: Station
  focused: boolean
}

function StationMarker({ station, focused }: StationMarkerProps) {
  const group = useRef<Group>(null)
  const { select } = useFocus()

  useFrame((state) => {
    group.current?.scale.setScalar(screenScale(cameraDistance(state), MARKER_PX, MARKER_MIN_METERS))
  })

  return (
    <group ref={group} position={[station.pos.x, 0.2, station.pos.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh
        renderOrder={2}
        onClick={(e) => {
          e.stopPropagation()
          select(station.id)
        }}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = '')}
      >
        <circleGeometry args={[focused ? 1.1 : 1, 24]} />
        <meshBasicMaterial color={theme.stationFill} transparent depthTest={false} depthWrite={false} />
      </mesh>
      <mesh renderOrder={3}>
        <ringGeometry args={[focused ? 1.1 : 0.78, focused ? 1.5 : 1, 24]} />
        <meshBasicMaterial
          color={focused ? theme.stationFocus : theme.stationStroke}
          transparent
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

export function Stations() {
  const { focusedId } = useFocus()
  return (
    <group>
      {network.stations.map((s) => (
        <StationMarker key={s.id} station={s} focused={s.id === focusedId} />
      ))}
    </group>
  )
}

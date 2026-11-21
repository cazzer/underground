import { Line } from '@react-three/drei'
import { network } from '../lib/network'
import { theme } from '../theme'

export function SubwayLines() {
  return (
    <group>
      {network.routes.map((route) => (
        <Line
          key={route.id}
          points={route.points.map((p) => [p.x, 0, p.z] as [number, number, number])}
          color={theme.lines[route.colorIndex % theme.lines.length]}
          lineWidth={theme.lineWidth}
          transparent
          depthTest={false}
          depthWrite={false}
          renderOrder={1}
        />
      ))}
    </group>
  )
}

import type { RefObject } from 'react'
import { BackSide, type BufferGeometry, FrontSide, type InstancedMesh } from 'three'
import { theme } from '../theme'
import { MAX_CARS } from '../lib/live/consist'
import { RENDER_ORDER } from './renderOrder'
import { CAR_CAPACITY, type TrainCarsLayer } from './useTrainCars'

interface TrainCarsProps {
  layer: TrainCarsLayer
}

/**
 * The car instances of every live train: a background-colored footprint per car (so the line doesn't show
 * between cars), then the bodies. Bodies test and write depth, so at iso tilt a near car hides a far one; they stay
 * `transparent` (opacity 1) so they sort after the lines. The selected train is outlined by the back faces of two
 * shells around its cars (rim, then a background gap inside it): drawn after the bodies they depth-test against
 * them, so only a band around the train's silhouette shows, at any tilt or turn. LiveTrains writes them per frame.
 */
export function TrainCars({ layer }: TrainCarsProps) {
  return (
    <>
      <instancedMesh
        ref={layer.halos}
        args={[layer.geometry.halo, undefined, CAR_CAPACITY]}
        frustumCulled={false}
        renderOrder={RENDER_ORDER.carHalo}
      >
        <meshBasicMaterial color={theme.background} transparent depthTest={false} depthWrite={false} />
      </instancedMesh>
      <instancedMesh
        ref={layer.bodies}
        args={[layer.geometry.body, undefined, CAR_CAPACITY]}
        frustumCulled={false}
        renderOrder={RENDER_ORDER.cars}
      >
        {/* White material: vertex shading times the per-instance route color. */}
        <meshBasicMaterial vertexColors transparent depthTest depthWrite side={FrontSide} />
      </instancedMesh>
      {/* The selected outline; useTrainCars.commit sets the counts and orders. */}
      <Shell mesh={layer.rims} geometry={layer.geometry.outline} count={MAX_CARS} color={theme.trainSelectedRim} order={RENDER_ORDER.carRim} />
      <Shell mesh={layer.rimCaps} geometry={layer.geometry.cap} count={2} color={theme.trainSelectedRim} order={RENDER_ORDER.carRim} />
      <Shell mesh={layer.gaps} geometry={layer.geometry.outline} count={MAX_CARS} color={theme.background} order={RENDER_ORDER.carGap} />
      <Shell mesh={layer.gapCaps} geometry={layer.geometry.cap} count={2} color={theme.background} order={RENDER_ORDER.carGap} />
    </>
  )
}

interface ShellProps {
  mesh: RefObject<InstancedMesh | null>
  geometry: BufferGeometry
  count: number
  color: string
  order: number
}

/** One part of the selected outline: back faces only, depth-tested against the bodies, never writing depth. */
function Shell({ mesh, geometry, count, color, order }: ShellProps) {
  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, count]} frustumCulled={false} renderOrder={order}>
      <meshBasicMaterial color={color} transparent depthTest depthWrite={false} side={BackSide} />
    </instancedMesh>
  )
}

import { BackSide, FrontSide } from 'three'
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
      {/* The selected outline; useTrainCars.commit sets both counts and orders. */}
      <instancedMesh
        ref={layer.rims}
        args={[layer.geometry.outline, undefined, MAX_CARS]}
        frustumCulled={false}
        renderOrder={RENDER_ORDER.carRim}
      >
        <meshBasicMaterial color={theme.trainSelectedRim} transparent depthTest depthWrite={false} side={BackSide} />
      </instancedMesh>
      <instancedMesh
        ref={layer.gaps}
        args={[layer.geometry.outline, undefined, MAX_CARS]}
        frustumCulled={false}
        renderOrder={RENDER_ORDER.carGap}
      >
        <meshBasicMaterial color={theme.background} transparent depthTest depthWrite={false} side={BackSide} />
      </instancedMesh>
    </>
  )
}

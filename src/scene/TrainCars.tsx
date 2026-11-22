import { FrontSide } from 'three'
import { theme } from '../theme'
import { MAX_CARS } from '../lib/live/consist'
import { RENDER_ORDER } from './renderOrder'
import { CAR_CAPACITY, type TrainCarsLayer } from './useTrainCars'

interface TrainCarsProps {
  layer: TrainCarsLayer
}

/**
 * The car instances of every live train: a background-colored footprint per car (so the line doesn't show
 * between cars), then the bodies. The selected train also gets a rim-colored footprint under its own, so a
 * background gap and then the rim outline it. Bodies test and write depth, so at iso tilt a near car hides a far one;
 * they stay `transparent` (opacity 1) so they sort after the lines. LiveTrains writes both per frame.
 */
export function TrainCars({ layer }: TrainCarsProps) {
  return (
    <>
      <instancedMesh
        ref={layer.rims}
        args={[layer.geometry.halo, undefined, MAX_CARS]}
        frustumCulled={false}
        renderOrder={RENDER_ORDER.carRim}
      >
        <meshBasicMaterial color={theme.trainSelectedRim} transparent depthTest={false} depthWrite={false} />
      </instancedMesh>
      <instancedMesh
        ref={layer.halos}
        args={[layer.geometry.halo, undefined, CAR_CAPACITY]}
        frustumCulled={false}
        renderOrder={RENDER_ORDER.carHalo}
      >
        <meshBasicMaterial color={theme.background} transparent depthTest={false} depthWrite={false} />
      </instancedMesh>
      {/* The selected train's gap over the other trains' dots; useTrainCars.commit sets its count and the rim's order. */}
      <instancedMesh
        ref={layer.gaps}
        args={[layer.geometry.halo, undefined, MAX_CARS]}
        frustumCulled={false}
        renderOrder={RENDER_ORDER.selectedCarGap}
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
    </>
  )
}

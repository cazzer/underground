import { FrontSide } from 'three'
import { theme } from '../theme'
import { RENDER_ORDER } from './renderOrder'
import { CAR_CAPACITY, type TrainCarsLayer } from './useTrainCars'

interface TrainCarsProps {
  layer: TrainCarsLayer
}

/**
 * The car instances of every live train: a background-colored footprint per car (so the line doesn't show
 * between cars), then the bodies. Bodies test and write depth, so at iso tilt a near car hides a far one;
 * they stay `transparent` (opacity 1) so they sort after the lines. LiveTrains writes both per frame.
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
    </>
  )
}

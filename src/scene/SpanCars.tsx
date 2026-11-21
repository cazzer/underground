import { FrontSide } from 'three'
import { MAX_CARS } from '../lib/live/consist'
import { theme } from '../theme'
import { RENDER_ORDER } from './renderOrder'
import { SPAN_CARS, type SpanCarsLayer } from './useSpanCars'
import type { TrainCarsLayer } from './useTrainCars'

interface SpanCarsProps {
  layer: SpanCarsLayer
  /** For the shared car geometry. */
  cars: TrainCarsLayer
}

/**
 * The cars of trains on a revealed station's platforms, redrawn above the interior veil and strokes in the same
 * three passes as TrainCars (selected rim, background footprints, bodies). The bodies test depth against the
 * street cars (they share matrices with their originals, so they pass where those drew), which keeps a nearer
 * street car in front. LiveTrains writes them per frame.
 */
export function SpanCars({ layer, cars }: SpanCarsProps) {
  return (
    <>
      <instancedMesh ref={layer.rims} args={[cars.geometry.halo, undefined, MAX_CARS]} frustumCulled={false} renderOrder={RENDER_ORDER.spanCarRim}>
        {/* White material: the per-instance colors are the rim color, tinted toward the veil. */}
        <meshBasicMaterial transparent depthTest={false} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={layer.halos} args={[cars.geometry.halo, undefined, SPAN_CARS]} frustumCulled={false} renderOrder={RENDER_ORDER.spanCarHalo}>
        <meshBasicMaterial color={theme.background} transparent depthTest={false} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={layer.bodies} args={[cars.geometry.body, undefined, SPAN_CARS]} frustumCulled={false} renderOrder={RENDER_ORDER.spanCars}>
        <meshBasicMaterial vertexColors transparent depthTest depthWrite side={FrontSide} />
      </instancedMesh>
    </>
  )
}

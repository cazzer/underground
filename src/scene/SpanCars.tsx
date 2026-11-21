import { theme } from '../theme'
import { MAX_CARS } from '../lib/live/consist'
import { RENDER_ORDER } from './renderOrder'
import { SPAN_CARS, type SpanCarsLayer } from './useSpanCars'

interface SpanCarsProps {
  layer: SpanCarsLayer
}

/**
 * The cars of trains on a revealed station's platforms, redrawn above the interior veil and strokes in the same
 * three passes as TrainCars (selected rim, background footprints, bodies). The bodies test depth against the
 * street cars (they share matrices with their originals, so they pass where those drew), which keeps a nearer
 * street car in front. LiveTrains writes them per frame.
 * The footprints don't test depth, so where a nearer street car that isn't lifted (another route's, outside the
 * span) overlaps a lifted car on screen, the footprint paints over it and the lifted body fails the depth test
 * there: a background-colored hole. Bedford Av has one route on two parallel tracks, so it can't happen there; a
 * multi-route interior with crossing tracks would need the footprints depth-tested too.
 * Any car with weight above 0 also draws (with its footprint) above the interior strokes, so a stroke crossing a car
 * inside the 40 m ramp hides until the weight reaches 0, then returns. Bedford Av's interior barely reaches past its
 * platform ends; an interior that extends past its platforms should check this.
 */
export function SpanCars({ layer }: SpanCarsProps) {
  return (
    <>
      <instancedMesh
        ref={layer.rims}
        args={[layer.geometry.rim, layer.material.rim, MAX_CARS]}
        frustumCulled={false}
        renderOrder={RENDER_ORDER.spanCarRim}
      />
      <instancedMesh
        ref={layer.halos}
        args={[layer.geometry.halo, undefined, SPAN_CARS]}
        frustumCulled={false}
        renderOrder={RENDER_ORDER.spanCarHalo}
      >
        <meshBasicMaterial color={theme.background} transparent depthTest={false} depthWrite={false} />
      </instancedMesh>
      <instancedMesh
        ref={layer.bodies}
        args={[layer.geometry.body, layer.material.body, SPAN_CARS]}
        frustumCulled={false}
        renderOrder={RENDER_ORDER.spanCars}
      />
    </>
  )
}

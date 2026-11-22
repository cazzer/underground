import { useLayoutEffect } from 'react'
import { theme } from '../theme'
import { MAX_CARS } from '../lib/live/consist'
import { spanCarOrders } from './renderOrder'
import { SPAN_CARS, type SpanCarsLayer } from './useSpanCars'

interface SpanCarsProps {
  layer: SpanCarsLayer
  /** The platform deck these trains ride (interiorDecks.ts; 0 is the deepest, and a single-deck station's only one). */
  deck: number
}

/**
 * The cars of trains on a revealed station's platforms, redrawn above the interior veil and the strokes of their
 * platform level and below, and the feet of the stairs from it up to their roof (the rest and the levels above draw
 * over them, StationInterior's `over` layers), in the same three
 * passes as TrainCars (background footprints, bodies, then the selected outline's rim and gap shells and end faces).
 * The bodies test depth against the street cars (they share matrices with their originals, so they pass where those
 * drew), which keeps a nearer street car in front; the shells, after them, test against both, as on the street. LiveTrains writes them per frame.
 * The footprints don't test depth, so where a nearer street car that isn't lifted (another route's, outside the
 * span) overlaps a lifted car on screen, the footprint paints over it and the lifted body fails the depth test
 * there: a background-colored hole. Bedford Av has one route on two parallel tracks, so it can't happen there; a
 * multi-route interior with crossing tracks would need the footprints depth-tested too.
 * Any car with weight above 0 also draws (with its footprint) above the platform-level strokes, so one crossing a car
 * inside the 40 m ramp hides until the weight reaches 0, then returns. Bedford Av's interior barely reaches past its
 * platform ends; an interior that extends past its platforms should check this.
 * At a multi-deck interior each deck has its own layer, drawn right after its own stroke band (spanCarOrders). A
 * deeper deck's lifted car can be nearer the camera than a shallower deck's where the decks cross on screen, so above
 * deck 0 the footprints test depth too: a farther car's footprint can't cut a hole in a nearer lifted car.
 */
export function SpanCars({ layer, deck }: SpanCarsProps) {
  const orders = spanCarOrders(deck)
  // Before LiveTrains' own layout effect (a child's runs first), and again on a remount.
  useLayoutEffect(() => layer.prepare(), [layer])
  return (
    <>
      <instancedMesh
        ref={layer.halos}
        args={[layer.geometry.halo, undefined, SPAN_CARS]}
        frustumCulled={false}
        renderOrder={orders.halo}
      >
        <meshBasicMaterial color={theme.background} transparent depthTest={deck > 0} depthWrite={false} />
      </instancedMesh>
      <instancedMesh
        ref={layer.bodies}
        args={[layer.geometry.body, layer.material.body, SPAN_CARS]}
        frustumCulled={false}
        renderOrder={orders.body}
      />
      <instancedMesh
        ref={layer.rims}
        args={[layer.geometry.rim, layer.material.rim, MAX_CARS]}
        frustumCulled={false}
        renderOrder={orders.rim}
      />
      <instancedMesh
        ref={layer.rimCaps}
        args={[layer.geometry.rimCap, layer.material.rim, 2]}
        frustumCulled={false}
        renderOrder={orders.rim}
      />
      <instancedMesh
        ref={layer.gaps}
        args={[layer.geometry.gap, layer.material.gap, MAX_CARS]}
        frustumCulled={false}
        renderOrder={orders.gap}
      />
      <instancedMesh
        ref={layer.gapCaps}
        args={[layer.geometry.gapCap, layer.material.gap, 2]}
        frustumCulled={false}
        renderOrder={orders.gap}
      />
    </>
  )
}

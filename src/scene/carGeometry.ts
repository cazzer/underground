import { BufferAttribute, type BufferGeometry, ExtrudeGeometry, PlaneGeometry, Shape } from 'three'

/** Car body dimensions in meters: a chamfered prism (look card pah.5.2, option B). */
export const CAR_WIDTH_M = 3
export const CAR_HEIGHT_M = 3.6
/** How far each roof edge is set in from the side walls. */
export const CAR_ROOF_INSET_M = 0.6

/**
 * Shading per vertex from its face normal, as a linear multiplier of the instance color: the roof is 1,
 * sides `side`, ends and the floor `end`; a chamfer in between shades between side and roof.
 */
function shadeByNormal(geometry: BufferGeometry, side: number, end: number): BufferGeometry {
  const normals = geometry.getAttribute('normal')
  const colors = new Float32Array(normals.count * 3)
  for (let v = 0; v < normals.count; v++) {
    const ny = normals.getY(v)
    const nz = normals.getZ(v)
    const shade = Math.abs(nz) > 0.5 || ny < -0.5 ? end : side + (1 - side) * Math.max(ny, 0)
    colors.fill(shade, v * 3, v * 3 + 3)
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return geometry
}

/** Hexagonal section: vertical walls, then roof edges set in by `inset` at 45 degrees. */
function prism(width: number, height: number, inset: number): BufferGeometry {
  const w = width / 2
  const shape = new Shape()
  shape.moveTo(-w, 0)
  shape.lineTo(w, 0)
  shape.lineTo(w, height - inset)
  shape.lineTo(w - inset, height)
  shape.lineTo(-w + inset, height)
  shape.lineTo(-w, height - inset)
  shape.closePath()
  return new ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5)
}

/**
 * One car body: full width and height, unit length along z (the instance matrix scales it to the car's
 * length), floor at y = 0, with per-vertex shading in a `color` attribute.
 */
export function createCarBodyGeometry(sideShade: number, endShade: number): BufferGeometry {
  return shadeByNormal(prism(CAR_WIDTH_M, CAR_HEIGHT_M, CAR_ROOF_INSET_M), sideShade, endShade)
}

/** A unit ground-plane quad facing up; the instance matrix sizes it to a car's footprint. */
export function createCarHaloGeometry(): BufferGeometry {
  return new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
}

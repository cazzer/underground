import { type BufferGeometry, Color, DynamicDrawUsage, InstancedBufferAttribute, MeshBasicMaterial, type MeshBasicMaterialParameters } from 'three'
import { theme } from '../theme'

/** Per-instance attribute: how far (0..1) the instance's final color mixes toward the veil. */
export const VEIL_TINT_ATTRIBUTE = 'instanceVeilTint'

/**
 * A copy of `geometry` with a zeroed per-instance tint attribute for `count` instances (the geometry is shared with
 * the street cars, which must not carry it).
 */
export function withTintAttribute(geometry: BufferGeometry, count: number): { geometry: BufferGeometry; tint: Float32Array } {
  const copy = geometry.clone()
  const tint = new Float32Array(count)
  copy.setAttribute(VEIL_TINT_ATTRIBUTE, new InstancedBufferAttribute(tint, 1).setUsage(DynamicDrawUsage))
  return { geometry: copy, tint }
}

/**
 * A basic material whose output mixes toward the background by the instance's tint after shading and after the
 * sRGB conversion, as the veil blends over the framebuffer: at tint t an opaque instance renders exactly like its
 * street original under a veil of opacity t.
 */
export function veilTintMaterial(params: MeshBasicMaterialParameters): MeshBasicMaterial {
  const material = new MeshBasicMaterial(params)
  // sRGB components: they mix with the shader's output after its colorspace conversion.
  const veil = new Color(theme.background).convertLinearToSRGB()
  material.onBeforeCompile = (shader) => {
    // A three upgrade that renames these chunks would silently drop the tint: fail loudly instead.
    for (const chunk of ['#include <begin_vertex>', '#include <colorspace_fragment>']) {
      if (!shader.vertexShader.includes(chunk) && !shader.fragmentShader.includes(chunk)) throw new Error(`veilTintMaterial: no ${chunk}`)
    }
    shader.uniforms.uVeilColor = { value: veil }
    shader.vertexShader = `attribute float ${VEIL_TINT_ATTRIBUTE};\nvarying float vVeilTint;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n\tvVeilTint = ${VEIL_TINT_ATTRIBUTE};`,
    )
    shader.fragmentShader = `uniform vec3 uVeilColor;\nvarying float vVeilTint;\n${shader.fragmentShader}`.replace(
      '#include <colorspace_fragment>',
      '#include <colorspace_fragment>\n\tgl_FragColor.rgb = mix( gl_FragColor.rgb, uVeilColor, vVeilTint );',
    )
  }
  material.customProgramCacheKey = () => 'veil-tint'
  return material
}

import { type BufferGeometry, Color, DynamicDrawUsage, InstancedBufferAttribute, MeshBasicMaterial, type MeshBasicMaterialParameters } from 'three'
import { theme } from '../theme'
import { patchVeilTint, VEIL_TINT_ATTRIBUTE } from './veilTintShader'

export { VEIL_TINT_ATTRIBUTE } from './veilTintShader'

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

let reported = false

/**
 * A basic material whose output mixes toward the background by the instance's tint after shading and after the
 * sRGB conversion, as the veil blends over the framebuffer: at tint t an opaque instance renders exactly like its
 * street original under a veil of opacity t. onBeforeCompile runs inside gl.render (past every error boundary), so a
 * missing anchor is reported once, never thrown.
 */
export function veilTintMaterial(params: MeshBasicMaterialParameters): MeshBasicMaterial {
  const material = new MeshBasicMaterial(params)
  // sRGB components: they mix with the shader's output after its colorspace conversion.
  const veil = new Color(theme.background).convertLinearToSRGB()
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uVeilColor = { value: veil }
    if (!patchVeilTint(shader) && !reported) {
      reported = true
      console.error('veilTintMaterial: three renamed begin_vertex or colorspace_fragment; platform cars render untinted')
    }
  }
  material.customProgramCacheKey = () => 'veil-tint'
  return material
}

/** Per-instance attribute: how far (0..1) the instance's final color mixes toward the veil. */
export const VEIL_TINT_ATTRIBUTE = 'instanceVeilTint'

const VERTEX_ANCHOR = '#include <begin_vertex>'
const FRAGMENT_ANCHOR = '#include <colorspace_fragment>'

export interface ShaderSource {
  vertexShader: string
  fragmentShader: string
}

/**
 * Adds the per-instance veil tint to a basic material's shaders, mixing toward `uVeilColor` after the colorspace
 * conversion. Returns false and leaves `shader` untouched if three renamed either anchor chunk (the copies then
 * render untinted: visible, not fatal). `veilTint.test.ts` checks the anchors against the installed three.
 */
export function patchVeilTint(shader: ShaderSource): boolean {
  if (!shader.vertexShader.includes(VERTEX_ANCHOR) || !shader.fragmentShader.includes(FRAGMENT_ANCHOR)) return false
  shader.vertexShader = `attribute float ${VEIL_TINT_ATTRIBUTE};\nvarying float vVeilTint;\n${shader.vertexShader}`.replace(
    VERTEX_ANCHOR,
    `${VERTEX_ANCHOR}\n\tvVeilTint = ${VEIL_TINT_ATTRIBUTE};`,
  )
  shader.fragmentShader = `uniform vec3 uVeilColor;\nvarying float vVeilTint;\n${shader.fragmentShader}`.replace(
    FRAGMENT_ANCHOR,
    `${FRAGMENT_ANCHOR}\n\tgl_FragColor.rgb = mix( gl_FragColor.rgb, uVeilColor, vVeilTint );`,
  )
  return true
}

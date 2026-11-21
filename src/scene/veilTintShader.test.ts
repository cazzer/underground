import { ShaderLib } from 'three'
import { describe, expect, it } from 'vitest'
import { patchVeilTint, VEIL_TINT_ATTRIBUTE } from './veilTintShader'

describe('patchVeilTint', () => {
  it("patches three's basic material shaders (fails on a three upgrade that renames the anchors)", () => {
    const shader = { vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader }
    expect(patchVeilTint(shader)).toBe(true)
    expect(shader.vertexShader).toContain(`vVeilTint = ${VEIL_TINT_ATTRIBUTE};`)
    expect(shader.fragmentShader).toContain('mix( gl_FragColor.rgb, uVeilColor, vVeilTint )')
  })

  it('leaves the shader untouched when an anchor is missing', () => {
    const shader = { vertexShader: 'void main() {}', fragmentShader: ShaderLib.basic.fragmentShader }
    expect(patchVeilTint(shader)).toBe(false)
    expect(shader.vertexShader).toBe('void main() {}')
    expect(shader.fragmentShader).toBe(ShaderLib.basic.fragmentShader)
  })
})

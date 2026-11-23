/**
 * The route lines' dim (bandLineMaterial.ts DIM_GLSL) in JS: a linear vertex color mixed toward the background in
 * sRGB, as mixHex mixes two '#rrggbb' colors. DIM_GLSL's dimLine is this file's twin, statement for statement; change
 * both together (lineDim.test.ts pins the GLSL).
 */

export type Rgb3 = readonly [number, number, number]

/** '#rrggbb' as sRGB channels in 0..1 (the dim's target, a shader uniform). */
export function srgb01(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`Not a #rrggbb color: ${JSON.stringify(hex)}`)
  const n = parseInt(m[1]!, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** One sRGB channel (0..1) to linear, the exact piecewise curve. */
export function srgbToLinear(s: number): number {
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** One linear channel (0..1) to sRGB, the exact piecewise curve. */
export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
}

/** dimLine: a linear color mixed toward `towardSrgb` (sRGB 0..1) by `amount` in sRGB, back in linear. 0 is the identity. */
export function dimLineRgb(linear: Rgb3, towardSrgb: Rgb3, amount: number): [number, number, number] {
  return dimLineRgbInto([0, 0, 0], linear, towardSrgb, amount)
}

/** dimLineRgb written into `out` (which may be `linear`), for per-frame use: no allocation. Returns `out`. */
export function dimLineRgbInto<T extends [number, number, number] | Float32Array>(out: T, linear: Rgb3 | Float32Array, towardSrgb: Rgb3, amount: number): T {
  for (let i = 0; i < 3; i++) {
    const c = linear[i]!
    if (amount <= 0) {
      out[i] = c
      continue
    }
    const s = linearToSrgb(c)
    out[i] = srgbToLinear(s + (towardSrgb[i]! - s) * amount)
  }
  return out
}

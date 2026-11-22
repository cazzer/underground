/** Color distances the theme tests hold tokens apart by. '#rrggbb' in, no allocation concerns (tests only). */

/** Straight-line distance between two '#rrggbb' colors in sRGB (0 to about 441). */
export function colorDistance(a: string, b: string): number {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const [ra, rb] = [rgb(a), rgb(b)]
  return Math.hypot(...ra.map((v, i) => v - rb[i]!))
}

/** OKLab distance (about 0.1 is a clearly different color): rims are told apart from lines by hue, not only lightness. */
export function oklabDistance(a: string, b: string): number {
  const lab = (hex: string): number[] => {
    const n = parseInt(hex.slice(1), 16)
    const [r, g, bl] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl)
    const k = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl)
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * k, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * k, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * k]
  }
  const p = lab(a)
  const q = lab(b)
  return Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!)
}

/**
 * Machado, Oliveira and Fernandes (2009) dichromacy matrices at severity 1, applied in linear sRGB:
 * deuteranopia and protanopia, the common red-green color blindness.
 */
export const CVD = {
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
} as const

/** '#rrggbb' as a dichromat sees it, per `CVD`. */
export function simulateCvd(hex: string, m: (typeof CVD)[keyof typeof CVD]): string {
  const n = parseInt(hex.slice(1), 16)
  const lin = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const out = m.map((row) => Math.min(1, Math.max(0, row[0] * lin[0]! + row[1] * lin[1]! + row[2] * lin[2]!)))
  const srgb = out.map((c) => Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255))
  return `#${srgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/**
 * OKLab distance a machine color keeps from the stroke, track and entrance colors under simulated
 * red-green color blindness. Lower than the 0.1 used for normal vision: dichromacy collapses a whole
 * axis of color, and the line shapes (no step hatch, shafts) carry the rest.
 */
export const MIN_CVD_DISTANCE = 0.06

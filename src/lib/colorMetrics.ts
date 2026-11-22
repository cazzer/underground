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

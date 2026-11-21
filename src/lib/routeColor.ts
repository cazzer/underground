export interface RouteLineMix {
  /** '#rrggbb' the route color is pulled toward. */
  toward: string
  /** 0 keeps the route color, 1 replaces it with `toward`. */
  amount: number
}

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`Not a #rrggbb color: ${JSON.stringify(hex)}`)
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Linear blend of two '#rrggbb' colors in sRGB space; t = 0 gives `a`, 1 gives `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a)
  const cb = parseHex(b)
  return `#${ca
    .map((v, i) => Math.round(v + (cb[i]! - v) * t).toString(16).padStart(2, '0'))
    .join('')}`
}

/** WCAG relative luminance of a '#rrggbb' color. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** WCAG non-text contrast for graphical objects such as map lines. */
export const MIN_LINE_CONTRAST = 3

/**
 * A route's GTFS color as drawn: mixed toward the rule color, then pushed further away from
 * `background` until it reaches `minContrast`. It is pushed toward the rule color when that
 * raises contrast, otherwise toward black or white (whichever is opposite the background).
 */
export function routeLineColor(
  routeHex: string,
  rule: RouteLineMix,
  background: string,
  minContrast = MIN_LINE_CONTRAST,
): string {
  const mixed = mixHex(routeHex, rule.toward, rule.amount)
  const base = contrastRatio(mixed, background)
  if (base >= minContrast) return mixed
  const opposite = relativeLuminance(background) > 0.18 ? '#000000' : '#ffffff'
  const targets = contrastRatio(rule.toward, background) > base ? [rule.toward, opposite] : [opposite]
  for (const target of targets) {
    for (let step = 1; step <= 100; step++) {
      const c = mixHex(mixed, target, step / 100)
      if (contrastRatio(c, background) >= minContrast) return c
    }
  }
  return opposite
}

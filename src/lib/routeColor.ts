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

export function routeLineColor(routeHex: string, rule: RouteLineMix): string {
  return mixHex(routeHex, rule.toward, rule.amount)
}

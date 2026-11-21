/** Parses the free-text "rise" of an E&E elevator or escalator ("10' 11-3/8in", "23,519 mm (77' 1 15/16in)")
 *  into meters. Anything that does not match the grammar is rejected with a reason; nothing is guessed. */

export type RiseResult = { ok: true; m: number; warning?: string } | { ok: false; reason: string }

const INCH_M = 0.0254
const FOOT_M = 0.3048
const METRIC_DISAGREE = 0.02
const VULGAR: Record<string, string> = { '¼': ' 1/4', '½': ' 1/2', '¾': ' 3/4' }

function normalize(s: string): string {
  return s
    .replace(/[’‘′]/g, "'")
    .replace(/[”“″]/g, '"')
    .replace(/[¼½¾]/g, (c) => VULGAR[c]!)
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/=/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

// INCH = whole [sep frac] | frac. Captures: whole, fracNum, fracDen, loneNum, loneDen.
const INCH = String.raw`(?:(\d+(?:\.\d+)?)(?:[\s-]+(\d+)\/(\d+))?|(\d+)\/(\d+))`
const INCH_MARK = String.raw`(?:"|in\b|inch(?:es)?\b)`
const WITH_FOOT_MARK = new RegExp(String.raw`^(\d+(?:\.\d+)?)\s*(?:'|ft\b|feet\b)\s*-?\s*(?:${INCH}\s*(?:${INCH_MARK})?)?$`, 'i')
const NO_FOOT_MARK = new RegExp(String.raw`^(\d+)\s*-\s*${INCH}\s*${INCH_MARK}$`, 'i')
const METRIC = /^(\d+(?:\.\d+)?)\s*mm\s*(?:\((.*)\))?$/i

function fraction(num: string, den: string): number | string {
  const d = Number(den)
  const f = Number(num) / d
  if (d === 0 || f > 1) return `fraction ${num}/${den} is not a proper fraction`
  return f
}

/** Inches from the INCH captures; a string is the rejection reason. */
function inchesOf(g: (string | undefined)[]): number | string {
  const [whole, fn, fd, ln, ld] = g
  let inches = whole === undefined ? 0 : Number(whole)
  for (const [n, d] of [[fn, fd], [ln, ld]] as const) {
    if (n === undefined || d === undefined) continue
    const f = fraction(n, d)
    if (typeof f === 'string') return f
    inches += f
  }
  return inches >= 12 ? `${inches} inches is 12 or more` : inches
}

function parseImperial(s: string): RiseResult {
  const m = WITH_FOOT_MARK.exec(s) ?? NO_FOOT_MARK.exec(s)
  if (!m) return { ok: false, reason: `unrecognized rise ${JSON.stringify(s)}` }
  const inches = m[2] === undefined && m[5] === undefined ? 0 : inchesOf(m.slice(2, 7))
  if (typeof inches === 'string') return { ok: false, reason: `${inches} in ${JSON.stringify(s)}` }
  return { ok: true, m: Number(m[1]) * FOOT_M + inches * INCH_M }
}

export function parseRise(raw: string): RiseResult {
  const s = normalize(raw)
  if (s === '') return { ok: false, reason: 'empty rise' }
  const metric = METRIC.exec(s)
  if (metric) {
    const m = Number(metric[1]) / 1000
    const imperial = metric[2] === undefined ? null : parseImperial(normalize(metric[2]))
    if (imperial?.ok && Math.abs(imperial.m - m) / m > METRIC_DISAGREE) {
      return { ok: true, m, warning: `metric ${m.toFixed(3)} m and imperial ${imperial.m.toFixed(3)} m disagree in ${JSON.stringify(s)}; metric used` }
    }
    return { ok: true, m }
  }
  return parseImperial(s)
}

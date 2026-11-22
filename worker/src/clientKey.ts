const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const GROUP = /^[0-9a-f]{1,4}$/

function v4Octets(text: string): number[] | null {
  const m = V4.exec(text)
  if (!m) return null
  const octets = m.slice(1).map(Number)
  return octets.every((o) => o <= 255) ? octets : null
}

/** Eight 16-bit groups of an IPv6 address (`::` expanded, a trailing dotted quad as two groups), or null when malformed. */
function v6Groups(text: string): number[] | null {
  let rest = text
  const lastColon = rest.lastIndexOf(':')
  const tail = rest.slice(lastColon + 1)
  let quad: number[] = []
  if (tail.includes('.')) {
    const octets = v4Octets(tail)
    if (!octets) return null
    quad = [(octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!]
    rest = rest.slice(0, lastColon + 1) + '0:0'
  }
  const halves = rest.split('::')
  if (halves.length > 2) return null
  const parse = (part: string): number[] | null => {
    if (part === '') return []
    const groups = part.split(':')
    return groups.every((g) => GROUP.test(g)) ? groups.map((g) => parseInt(g, 16)) : null
  }
  const left = parse(halves[0] ?? '')
  const right = halves.length === 2 ? parse(halves[1] ?? '') : []
  if (!left || !right) return null
  let groups: number[]
  if (halves.length === 2) {
    const missing = 8 - left.length - right.length
    if (missing < 1) return null
    groups = [...left, ...new Array<number>(missing).fill(0), ...right]
  } else {
    groups = left
  }
  if (groups.length !== 8) return null
  if (quad.length === 2) {
    groups[6] = quad[0]!
    groups[7] = quad[1]!
  }
  return groups
}

/**
 * The rate-limit key for a CF-Connecting-IP value, or null when it is not an address. An IPv4 client is keyed on
 * its full address, an IPv4-mapped IPv6 one (`::ffff:a.b.c.d`) likewise; any other IPv6 client on its /64, which a
 * single subscriber or host can rotate through at will, so a per-address key would give it unlimited keys.
 * Pure, and it never logs.
 */
export function clientKey(ip: string): string | null {
  const text = ip.trim().toLowerCase()
  const octets = v4Octets(text)
  if (octets) return octets.join('.')
  if (!text.includes(':')) return null
  const g = v6Groups(text)
  if (!g) return null
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return [g[6]! >> 8, g[6]! & 255, g[7]! >> 8, g[7]! & 255].join('.')
  return `${g
    .slice(0, 4)
    .map((x) => x.toString(16))
    .join(':')}::/64`
}

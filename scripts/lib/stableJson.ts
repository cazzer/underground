function isContainer(value: unknown): boolean {
  return typeof value === 'object' && value !== null
}

function inline(value: unknown): string {
  return JSON.stringify(value)
}

function render(value: unknown, depth: number, lineDepth: number): string {
  if (!isContainer(value) || depth >= lineDepth) return inline(value)
  const pad = '  '.repeat(depth + 1)
  const close = '  '.repeat(depth)
  if (Array.isArray(value)) {
    if (value.length === 0 || !value.some(isContainer)) return inline(value)
    const items = value.map((v) => pad + render(v, depth + 1, lineDepth))
    return `[\n${items.join(',\n')}\n${close}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return '{}'
  const items = entries.map(([k, v]) => `${pad}${inline(k)}: ${render(v, depth + 1, lineDepth)}`)
  return `{\n${items.join(',\n')}\n${close}}`
}

/** Deterministic JSON, one entry per line for objects and arrays of containers shallower than
 *  `lineDepth`; everything deeper (and arrays of primitives) stays inline. Never reorders keys:
 *  builders own the sort order. Ends with a newline. */
export function toStableJson(value: unknown, lineDepth: number): string {
  return render(value, 0, lineDepth) + '\n'
}

/** Boundary checkers for hand-edited or fetched JSON. Each throws naming the JSON path. */

export function finite(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`${path}: expected a finite number, got ${JSON.stringify(v)}`)
  }
  return v
}

export function text(v: unknown, path: string): string {
  if (typeof v !== 'string' || v === '') {
    throw new Error(`${path}: expected a non-empty string, got ${JSON.stringify(v)}`)
  }
  return v
}

export function pair(v: unknown, path: string): [number, number] {
  if (!Array.isArray(v) || v.length !== 2) {
    throw new Error(`${path}: expected [number, number], got ${JSON.stringify(v)}`)
  }
  return [finite(v[0], `${path}[0]`), finite(v[1], `${path}[1]`)]
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], path: string): T {
  const hit = allowed.find((a) => a === v)
  if (hit === undefined) throw new Error(`${path}: expected one of ${allowed.join(' | ')}, got ${JSON.stringify(v)}`)
  return hit
}

export function list(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`${path}: expected an array, got ${JSON.stringify(v)}`)
  return v
}

export function record(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Error(`${path}: expected an object, got ${JSON.stringify(v)}`)
  }
  return v as Record<string, unknown>
}

export function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') throw new Error(`${path}: expected true or false, got ${JSON.stringify(v)}`)
  return v
}

/** Throws on any key of `obj` that is not in `allowed`. */
export function onlyKeys(obj: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k))
  if (extra.length > 0) throw new Error(`${path}: unknown key ${extra.map((k) => JSON.stringify(k)).join(', ')} (allowed: ${allowed.join(', ')})`)
}

/** A string, or null when the field is absent; present but empty or not a string still throws. */
export function optText(v: unknown, path: string): string | null {
  return v === undefined ? null : text(v, path)
}

export interface InteriorCache<T> {
  /** One shared promise per id; a rejected load is forgotten so the next `get` retries. */
  get(id: string): Promise<T>
  /** The loaded value, once its promise has resolved. */
  peek(id: string): T | undefined
}

export function createInteriorCache<T>(load: (id: string) => Promise<T>): InteriorCache<T> {
  const pending = new Map<string, Promise<T>>()
  const loaded = new Map<string, T>()
  return {
    get(id) {
      const existing = pending.get(id)
      if (existing) return existing
      const p = load(id).then(
        (value) => {
          loaded.set(id, value)
          return value
        },
        (err: unknown) => {
          pending.delete(id)
          throw err
        },
      )
      pending.set(id, p)
      return p
    },
    peek: (id) => loaded.get(id),
  }
}

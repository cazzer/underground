import type { Memo } from './cache'

/** The part of the Cache API used here (`caches.default` fits). */
export interface EdgeCache {
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<void>
}

/** A fresh entry, or null. Expiry comes from our own header, not Age. */
export async function readEdge(edge: EdgeCache, cacheKey: Request, now: number): Promise<Memo | null> {
  const cached = await edge.match(cacheKey)
  if (!cached) return null
  const expiresAt = Number(cached.headers.get('x-rt-expires'))
  return expiresAt > now ? { body: await cached.text(), expiresAt } : null
}

/** Stores `memo` for `ttlMs`; a failed put goes to `onError` and never reaches the caller. */
export function writeEdge(
  edge: EdgeCache,
  ctx: { waitUntil(p: Promise<unknown>): void },
  cacheKey: Request,
  memo: Memo,
  ttlMs: number,
  onError: (e: unknown) => void = console.error,
): void {
  ctx.waitUntil(
    edge
      .put(
        cacheKey,
        new Response(memo.body, {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': `public, max-age=${ttlMs / 1000}`,
            'x-rt-expires': String(memo.expiresAt),
          },
        }),
      )
      .catch(onError),
  )
}

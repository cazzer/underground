const PAGES_ORIGIN = 'https://cazzer.github.io'
const LOCAL_DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/

function isAllowedOrigin(origin: string | null): origin is string {
  return origin !== null && (origin === PAGES_ORIGIN || LOCAL_DEV_ORIGIN.test(origin))
}

/** Allowed origins are echoed; everyone else gets the response without ACAO. */
export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = { Vary: 'Origin' }
  if (isAllowedOrigin(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

export const PREFLIGHT_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

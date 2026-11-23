/**
 * When the camera frames the route view (2q7.45.5; 08r.6). Pure; useRouteFlight applies it. A trip's route is a plan
 * (the ends and the visitor's attempt, which a silent refresh never raises) and the journey the map draws. A new plan
 * frames it once, unless the visitor moved the view while it loaded; a journey the visitor opened or went back to
 * frames it again; a silent replan frames nothing, however it swaps the journey. A picked service change is a token of
 * its own (CHANGE_PLAN + its pick's key, never silent), so each pick frames once while the list is in front.
 */

export interface RouteToken {
  /** `<tripKey>#<attempt>` of the settled plan; a change's CHANGE_PLAN + `<alertId>#<pick seq>`. */
  plan: string
  /** `journeyKey` of the journey the map draws; a change's `<alertId>#<pick seq>`. */
  journey: string
}

/** The plan prefix of a picked service change's token. */
export const CHANGE_PLAN = 'change:'

/** The token of a picked service change's route view, keyed by its pick (TripRouteDraw.key). */
export function changeToken(key: string): RouteToken {
  return { plan: `${CHANGE_PLAN}${key}`, journey: key }
}

/** Whether `token` frames a picked service change, not a trip. */
export function isChangeToken(token: RouteToken): boolean {
  return token.plan.startsWith(CHANGE_PLAN)
}

/** What the hook remembers between runs. */
export interface RouteMemo {
  /** The last route decided on, framed or skipped: a skipped one never fires later. */
  framed: RouteToken | null
  /** The visitor moved the camera (a gesture or a station request) since the plan last started loading. */
  interrupted: boolean
}

export interface RouteInput {
  /** The ready plan's route; null while loading, failed or with no journey. */
  route: RouteToken | null
  /** The plan object just changed and its trigger was a tick or a poll. */
  silent: boolean
  /** The route's panel is in front (the trip panel for a trip, the changes list for a change; no train panel or notice over it). */
  front: boolean
  /** A flight is under way: this rule's own (it flies again) or another's (it skips). */
  flying: 'mine' | 'other' | null
  following: boolean
  /** A gesture is in progress. */
  gesture: boolean
}

export type RouteDecision = 'fly' | 'skip' | 'none'

/** Whether `framed` is the route `route` names. */
export function routeIsFramed(framed: RouteToken | null, route: RouteToken | null): boolean {
  return framed !== null && route !== null && framed.plan === route.plan && framed.journey === route.journey
}

export function routeFrameDecision(memo: RouteMemo, input: RouteInput): RouteDecision {
  const { route } = input
  const { framed } = memo
  if (route === null || routeIsFramed(framed, route)) return 'none'
  const samePlan = framed !== null && framed.plan === route.plan
  if (samePlan && input.silent) return 'skip'
  const fresh = !samePlan
  if (!input.front || input.following || input.gesture || input.flying === 'other' || (fresh && memo.interrupted)) return 'skip'
  return 'fly'
}

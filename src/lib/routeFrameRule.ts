/**
 * When the camera frames the selected trip route (2q7.45.5). Pure; useRouteFlight applies it. A route is a plan (the
 * ends and the visitor's attempt, which a silent refresh never raises) and the journey the map draws. A new plan
 * frames it once, unless the visitor moved the view while it loaded; a journey the visitor opened or went back to
 * frames it again; a silent replan frames nothing, however it swaps the journey.
 */

export interface RouteToken {
  /** `<tripKey>#<attempt>` of the settled plan. */
  plan: string
  /** `journeyKey` of the journey the map draws. */
  journey: string
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
  /** The trip panel is in front (no train panel or notice over it). */
  front: boolean
  /** A flight is under way: this rule's own (it flies again) or another's (it skips). */
  flying: 'mine' | 'other' | null
  following: boolean
  /** A gesture is in progress. */
  gesture: boolean
}

export type RouteDecision = 'fly' | 'skip' | 'none'

export function routeFrameDecision(memo: RouteMemo, input: RouteInput): RouteDecision {
  const { route } = input
  const { framed } = memo
  if (route === null || (framed !== null && framed.plan === route.plan && framed.journey === route.journey)) return 'none'
  const samePlan = framed !== null && framed.plan === route.plan
  if (samePlan && input.silent) return 'skip'
  const fresh = !samePlan
  if (!input.front || input.following || input.gesture || input.flying === 'other' || (fresh && memo.interrupted)) return 'skip'
  return 'fly'
}

import type { ReactNode } from 'react'
import { routeChipLabel } from '../lib/labels'
import type { Route } from '../lib/network'
import { routeLineColor } from '../lib/routeColor'
import { theme } from '../theme'

interface RouteChipProps {
  route: Route
  /** `li` inside a route list, `span` inline. */
  as: 'li' | 'span'
  className?: string
  /** Screen-reader text; the visible label is hidden from assistive tech. */
  children?: ReactNode
}

/** Ink text on a route-colored border; the full name is in the tooltip. */
export function RouteChip({ route, as: Tag, className = '', children }: RouteChipProps) {
  return (
    <Tag
      title={route.longName}
      className={`border-2 px-1.5 text-xs text-ink ${className}`}
      style={{ borderColor: routeLineColor(route.color, theme.routeLineMix, theme.background) }}
    >
      <span aria-hidden="true">{routeChipLabel(route.shortName)}</span>
      {children}
    </Tag>
  )
}

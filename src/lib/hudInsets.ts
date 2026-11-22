import type { Insets } from './framing'

/** The vertical extent of an element, viewport px (a DOMRect satisfies it). */
export interface VerticalBox {
  top: number
  bottom: number
}

/**
 * The bands the HUD's header and footer cover: from the root's top edge to the header's bottom, and from the
 * footer's top to the root's bottom. The footer is the Attribution alone, never the bottom slot: a panel in that
 * slot reports through `onPanel`, and counting it here would cap the free rect twice. Never negative.
 */
export function hudInsets(root: VerticalBox, header: VerticalBox, footer: VerticalBox): Insets {
  return {
    top: Math.max(0, header.bottom - root.top),
    bottom: Math.max(0, root.bottom - footer.top),
  }
}

/** Equal insets: a re-measure that finds the same bands must not reach the scene. */
export function sameInsets(a: Insets | null, b: Insets): boolean {
  return a !== null && a.top === b.top && a.bottom === b.bottom
}

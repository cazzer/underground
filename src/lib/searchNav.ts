/** Where the arrow, Home, End and printable keys move focus in the search dialog (pure). */

/** The input, or the button at a row and a column of that row's actions. */
export type NavSpot = 'input' | { row: number; col: number }

export interface NavKey {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

export interface NavMove {
  to: NavSpot
  /** Let the browser deliver the key too: a printable key typed on a row lands in the input. */
  keepDefault: boolean
}

const move = (to: NavSpot): NavMove => ({ to, keepDefault: false })

/**
 * The focus move a key makes, or null when the key is not ours (Enter, Space, Tab and every shortcut stay native). From
 * the input only ArrowDown is ours, so the input keeps its caret keys. On a row: Up and Down change row (Up from the
 * first returns to the input; Down at the last stays, handled, so the page doesn't scroll), Left, Right, Home and End move
 * within the row, and a printable key goes back to the input and is typed there.
 */
export function searchNav(at: NavSpot, key: NavKey, rows: number, cols: number): NavMove | null {
  if (at === 'input') return key.key === 'ArrowDown' && rows > 0 ? move({ row: 0, col: 0 }) : null
  switch (key.key) {
    case 'ArrowUp':
      return move(at.row === 0 ? 'input' : { row: at.row - 1, col: at.col })
    case 'ArrowDown':
      return move({ row: Math.min(at.row + 1, rows - 1), col: at.col })
    case 'ArrowLeft':
      return move({ row: at.row, col: Math.max(at.col - 1, 0) })
    case 'ArrowRight':
      return move({ row: at.row, col: Math.min(at.col + 1, cols - 1) })
    case 'Home':
      return move({ row: at.row, col: 0 })
    case 'End':
      return move({ row: at.row, col: cols - 1 })
  }
  if (key.key.length === 1 && key.key !== ' ' && !key.ctrlKey && !key.metaKey && !key.altKey) return { to: 'input', keepDefault: true }
  return null
}

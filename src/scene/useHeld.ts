import { useState } from 'react'

/** The last non-null `value`: a layer keeps drawing what it last drew while it eases out after `value` goes null. */
export function useHeld<T>(value: T | null): T | null {
  const [held, setHeld] = useState(value)
  if (value !== null && value !== held) setHeld(value)
  return value ?? held
}

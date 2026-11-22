import { useSyncExternalStore } from 'react'
import { isPhoneViewport } from '../lib/streetLabelReveal'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

const snapshot = () => isPhoneViewport({ width: window.innerWidth, height: window.innerHeight })

/** Whether the window is phone-sized (the same rule the street labels use: its shorter side under 600 px), live. */
export function usePhoneViewport(): boolean {
  return useSyncExternalStore(subscribe, snapshot)
}

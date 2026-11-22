import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { useFocus } from '../lib/focus'
import type { MapControlsImpl } from './cameraFlight'

/**
 * Lets the HUD ask where the camera is looking, without re-rendering for it: registers a getter of the controls'
 * target (the ground point under the screen center) with the focus context. It runs only when the address search
 * sends a request.
 */
export function ViewCenterSource(): null {
  const controls = useThree((s) => s.controls)
  const { setViewCenterSource } = useFocus()
  useEffect(() => {
    const target = (controls as MapControlsImpl | null)?.target
    if (!target) return
    setViewCenterSource(() => ({ x: target.x, z: target.z }))
    return () => setViewCenterSource(null)
  }, [controls, setViewCenterSource])
  return null
}

import { FocusProvider } from './lib/focus'
import { Scene } from './scene/Scene'
import { Hud } from './ui/Hud'

export function App() {
  return (
    <FocusProvider>
      <main className="relative h-full w-full bg-canvas">
        <Scene />
        <Hud />
      </main>
    </FocusProvider>
  )
}

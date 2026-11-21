import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  /** Shown instead of the children after a render error; null shows nothing. */
  fallback: ReactNode | ((error: Error) => ReactNode)
  /** Called once per caught error (the boundary also logs it). */
  onError?: (error: Error) => void
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Keeps a render crash in one subtree from blanking the whole app. It does not catch errors
 * thrown in event handlers, effects' async work, or `useFrame` callbacks.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Render error caught by boundary', error, info.componentStack)
    this.props.onError?.(error)
  }

  render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children
    const { fallback } = this.props
    return typeof fallback === 'function' ? fallback(error) : fallback
  }
}

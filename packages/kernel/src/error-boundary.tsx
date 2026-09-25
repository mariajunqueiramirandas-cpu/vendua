import { Component, type ReactNode } from 'react';

// a throwing override degrades to the Kernel default, never to broken (04: override rules)
export class ErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode; onError?: (err: unknown) => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    this.props.onError?.(err);
    console.error('[vendua] slot override failed, rendering kernel default', err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

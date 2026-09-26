import { Component, type ReactNode } from 'react';

// A throwing override/section degrades to the Kernel default, never to broken
// (04: override rules). `resetKey` lets a changed input retry the child.
export class ErrorBoundary extends Component<
  {
    fallback: ReactNode;
    children: ReactNode;
    onError?: (err: unknown) => void;
    resetKey?: unknown;
  },
  { failed: boolean; key: unknown }
> {
  state = { failed: false, key: this.props.resetKey };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  static getDerivedStateFromProps(
    props: { resetKey?: unknown },
    state: { failed: boolean; key: unknown },
  ) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }
  componentDidCatch(err: unknown) {
    if (this.props.onError) this.props.onError(err);
    else console.error('[vendua] render failed, showing the Kernel fallback', err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

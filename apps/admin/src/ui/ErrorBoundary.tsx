import { Component, type ReactNode } from 'react';
import { ErrorState } from './feedback.tsx';

/** A screen that throws (a lazy chunk that never arrived, a render bug) must not unmount the
 * whole app into a bare background — say so and offer a fresh start. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error('unknown') };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-lg p-6 pt-12">
        <ErrorState error={this.state.error} retry={() => location.reload()} />
      </div>
    );
  }
}

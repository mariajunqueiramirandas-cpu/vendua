import { Component, type ReactNode } from 'react';
import { ErrorState } from './feedback.tsx';

/** One broken screen never takes the shell (nav, status, alerts) down with it. */
export class Boundary extends Component<
  { children: ReactNode; resetKey?: string },
  { error: unknown }
> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error)
      return (
        <div className="mx-auto max-w-lg p-6">
          <ErrorState error={this.state.error} retry={() => this.setState({ error: null })} />
        </div>
      );
    return this.props.children;
  }
}

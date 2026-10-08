import { Component, type ReactNode } from "react";

type Props = { fallback: (error: unknown) => ReactNode; children: ReactNode };

// Shows the fallback in place of whatever failed to render. It stays until the boundary is remounted, so give it a key
// that changes when there's something new to try.
export class ErrorBoundary extends Component<Props, { error?: unknown; failed: boolean }> {
  state = { error: undefined, failed: false };

  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback(this.state.error) : this.props.children;
  }
}

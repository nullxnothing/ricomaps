'use client';

import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  onReset?: () => void;
  resetKey?: string | number;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[ErrorBoundary]', error, info.componentStack);
    }
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  reset = () => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="w-full h-full flex items-center justify-center p-4 bg-bg-void">
        <div className="glass-panel-danger p-5 max-w-md w-full">
          <div className="flex items-center gap-2 mb-3">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-primary">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <h2 className="text-sm font-semibold text-text-primary">Something broke</h2>
          </div>
          <p className="text-[11px] font-mono text-text-tertiary leading-relaxed mb-4 break-words">
            {error.message || 'Render failure'}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={this.reset}
              className="btn-primary text-[11px] px-3 py-1.5"
            >
              Retry
            </button>
            <button
              onClick={() => window.location.reload()}
              className="btn-ghost text-[11px] px-3 py-1.5"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}

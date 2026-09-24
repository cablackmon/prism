import * as React from 'react';

export class WidgetErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg bg-destructive/10 p-4 text-destructive">
          <p className="font-bold">Widget Error</p>
          {process.env.NODE_ENV === 'development' && (
            <>
              <p className="text-sm">{this.state.error.message}</p>
              <pre className="mt-2 max-h-40 overflow-auto text-xs">{this.state.error.stack}</pre>
            </>
          )}
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-2 text-xs underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

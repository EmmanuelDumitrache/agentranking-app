"use client";
import type { ReactNode } from "react";
import { Component } from "react";
import { Button } from "@/components/ui/button";
type Props = {
  children: ReactNode;
  onRetry?: () => void;
};
type State = {
  error: Error | null;
};
export class StakingErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (process.env.NODE_ENV === "development") {
      console.error("[staking] render error:", error, info.componentStack);
    }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-center">
          <p className="text-sm font-semibold text-destructive">Something went wrong on the staking page</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {this.state.error.message || "An unexpected error occurred."}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => {
              this.setState({ error: null });
              this.props.onRetry?.();
            }}
          >
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

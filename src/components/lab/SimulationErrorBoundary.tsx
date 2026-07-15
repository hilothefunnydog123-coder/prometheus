"use client";

import { Component, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  resetKey: string;
};

type State = {
  failed: boolean;
};

export class SimulationErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(): void {
    // The learner gets a safe recovery message. Avoid logging experiment or
    // upload-derived content from a rendering failure.
  }

  override componentDidUpdate(previous: Props): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  override render() {
    if (this.state.failed) {
      return (
        <div className="canvas-fallback" role="alert">
          <strong>The 3D world could not start.</strong>
          <p>
            Reset the simulation, enable hardware acceleration, or use a
            bundled example in a WebGL-capable browser.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

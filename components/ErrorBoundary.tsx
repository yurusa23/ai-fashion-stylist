import React, { Component, ErrorInfo, ReactNode } from 'react';
import { logError } from '../lib/logger';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(_: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logError(error, { componentStack: errorInfo.componentStack });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-theme-bg text-theme-text p-4">
            <div className="text-center max-w-md">
                <h1 className="text-3xl font-bold text-theme-accent mb-4">앗, 무언가 잘못되었어요.</h1>
                <p className="text-lg text-theme-gray-dark mb-6">
                    애플리케이션에 예기치 않은 오류가 발생했습니다. 페이지를 새로고침하거나 잠시 후 다시 시도해주세요.
                </p>
                <button
                    onClick={() => window.location.reload()}
                    className="bg-theme-accent text-white font-semibold py-2 px-6 rounded-lg shadow-sm hover:bg-theme-accent-hover transition-colors"
                >
                    새로고침
                </button>
            </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

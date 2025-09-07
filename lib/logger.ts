/**
 * Logs a significant user event for analytics purposes.
 * In a real-world application, this would send data to a service like Google Analytics, Mixpanel, etc.
 * @param eventName The name of the event.
 * @param params Additional data associated with the event.
 */
export function logEvent(eventName: string, params?: Record<string, unknown>): void {
  console.log(`[ANALYTICS] Event: ${eventName}`, params ?? '');
  // Example integration:
  // if (window.gtag) {
  //   window.gtag('event', eventName, params);
  // }
}

/**
 * Logs an error for monitoring and debugging.
 * In a real-world application, this would send data to a service like Sentry, LogRocket, etc.
 * @param error The error object.
 * @param context Additional context about where the error occurred.
 */
export function logError(error: Error, context?: Record<string, unknown>): void {
  console.error('[ERROR LOG]', {
    message: error.message,
    name: error.name,
    stack: error.stack,
    context: context ?? {},
  });
  // Example integration:
  // Sentry.withScope(scope => {
  //   if (context) {
  //     scope.setContext("custom_context", context);
  //   }
  //   Sentry.captureException(error);
  // });
}

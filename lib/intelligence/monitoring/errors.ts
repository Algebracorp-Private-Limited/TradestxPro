/** Domain error for monitoring (plans, alerts, watchlist): safe message + HTTP status. */
export class MonitorError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

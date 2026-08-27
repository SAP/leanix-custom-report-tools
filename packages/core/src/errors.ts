/**
 * Flattens an error and its `cause` chain into one raw, technical string.
 *
 * Node's `fetch` throws a terse `TypeError: fetch failed` and hides the real
 * reason (DNS failure, connection refused, TLS/cert error) in `err.cause` —
 * sometimes an `AggregateError` of several attempts. Walking the chain keeps it.
 */
export function describeError(err: unknown): string {
  if (err instanceof AggregateError && err.errors.length) {
    return err.errors.map(describeError).join('; ');
  }
  if (err instanceof Error) {
    return err.cause
      ? `${err.message}: ${describeError(err.cause)}`
      : err.message;
  }
  return String(err);
}

/**
 * An HTTP request that completed but returned a non-2xx status.
 *
 * Carries the `status` as a field (so callers can branch on e.g. 401) while
 * keeping `message` a readable one-liner for the terminal — rather than
 * `JSON.stringify`-ing structure into the message, which is neither readable
 * nor parsed back.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body?: unknown
  ) {
    const detail =
      body == null
        ? ''
        : typeof body === 'string'
          ? `: ${body}`
          : `: ${JSON.stringify(body)}`;
    super(`HTTP ${status}${detail}`);
    this.name = 'HttpError';
  }
}

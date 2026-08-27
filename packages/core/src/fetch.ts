import { describeError } from './errors';

/**
 * Global `fetch`, but network-level failures throw the full underlying cause
 * chain instead of a bare `TypeError: fetch failed`.
 *
 * A completed request with a non-2xx status resolves normally, so callers
 * still inspect `res.ok`.
 */
export async function fetchOrThrow(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    throw new Error(describeError(err), { cause: err });
  }
}

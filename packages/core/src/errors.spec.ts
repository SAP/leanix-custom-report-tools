import { describeError, HttpError } from './errors';

describe('describeError', () => {
  it('returns the message for a plain Error', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });

  it('unwraps the cause chain that fetch hides', () => {
    // Mirrors Node's fetch: `TypeError: fetch failed` with the real reason in cause.
    const cause = new Error('getaddrinfo ENOTFOUND app.leanix.net');
    const err = new TypeError('fetch failed', { cause });

    expect(describeError(err)).toBe(
      'fetch failed: getaddrinfo ENOTFOUND app.leanix.net'
    );
  });

  it('flattens AggregateError sub-errors', () => {
    const err = new AggregateError(
      [
        new Error('connect ECONNREFUSED ::1:443'),
        new Error('connect ECONNREFUSED 127.0.0.1:443')
      ],
      'fetch failed'
    );

    expect(describeError(err)).toBe(
      'connect ECONNREFUSED ::1:443; connect ECONNREFUSED 127.0.0.1:443'
    );
  });

  it('stringifies non-Error values', () => {
    expect(describeError('just a string')).toBe('just a string');
  });
});

describe('HttpError', () => {
  it('exposes status as a field and a readable message', () => {
    const err = new HttpError(401, 'Unauthorized');
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(401);
    expect(err.message).toBe('HTTP 401: Unauthorized');
  });

  it('serializes object bodies into the message', () => {
    const err = new HttpError(422, { errorMessage: 'bad version' });
    expect(err.message).toBe('HTTP 422: {"errorMessage":"bad version"}');
  });

  it('omits detail when there is no body', () => {
    expect(new HttpError(500).message).toBe('HTTP 500');
  });
});

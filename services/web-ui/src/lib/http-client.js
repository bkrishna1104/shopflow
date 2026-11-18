// Minimal client for calling other services (uses Node's built-in fetch).
// WHY a timeout: without one, a hung downstream service holds the request open
// forever and failures cascade. Fail fast, return 503, let the caller decide.
import { HttpError } from './errors.js';

export function createServiceClient({ baseUrl, name, timeoutMs = 3000, fetchImpl = fetch }) {
  async function request(method, path, body) {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new HttpError(503, `${name} is unavailable`, { cause: err.name === 'TimeoutError' ? 'timeout' : err.message });
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    // Which version of the downstream service answered — lets callers show it (canary!).
    const version = res.headers?.get?.('x-app-version') ?? null;
    return { status: res.status, ok: res.ok, data, version };
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
  };
}

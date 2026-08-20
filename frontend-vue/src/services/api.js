/**
 * HTTP client.
 *
 * Two behaviours here are worth knowing about, because both are invisible to
 * calling code:
 *
 *   1. The access token lives in memory only. Persisting it in localStorage
 *      would make any XSS a permanent account takeover; the refresh token is
 *      in an httpOnly cookie the browser attaches automatically, so a reload
 *      still restores the session.
 *
 *   2. A 401 triggers exactly one refresh attempt, and concurrent requests
 *      queue behind it rather than each firing their own - otherwise a page
 *      with six parallel calls performs six refreshes and the rotation
 *      detection on the server treats that as token theft.
 */

import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/';
const API_PREFIX = import.meta.env.VITE_API_PREFIX || '/api/v1';

let accessToken = null;
let refreshPromise = null;

/**
 * Bumped every time the token changes.
 *
 * Each request records the generation it was sent under. When a 401 comes back
 * stamped with an older generation, the token has *already* been renewed since
 * that request left - so it only needs retrying, not another refresh.
 *
 * Without this, a request issued while a refresh was in flight lands after the
 * refresh finished, finds no shared promise to join, and starts a second one.
 * The refresh token rotates, so that second call presents a cookie the server
 * has already consumed - which is indistinguishable from a stolen token being
 * replayed. The server kills the whole session family and the user is signed
 * out for no reason they can see, in a way that is very hard to reproduce.
 */
let tokenGeneration = 0;

/**
 * Subscribers notified whenever the token changes.
 *
 * The interceptor needs the token synchronously, so this module owns it - but
 * a plain module variable is invisible to Vue's reactivity. A Pinia getter
 * reading it directly has no reactive dependency, so it is computed once and
 * cached forever: the router guard evaluated `isAuthenticated` as false on the
 * way to /login and kept returning false after a successful sign-in, bouncing
 * the user straight back. Publishing changes lets the store mirror the token
 * into reactive state without giving up single ownership.
 */
const subscribers = new Set();

/** Called by the auth store on login, refresh and logout. */
export function setAccessToken(token) {
  accessToken = token;
  tokenGeneration += 1;
  for (const notify of subscribers) notify(token);
}

export function getAccessToken() {
  return accessToken;
}

/** @returns {() => void} unsubscribe */
export function subscribeToToken(notify) {
  subscribers.add(notify);
  return () => subscribers.delete(notify);
}

const client = axios.create({
  baseURL: `${BASE_URL.replace(/\/$/, '')}${API_PREFIX}`,
  timeout: 30000,
  // Sends the refresh cookie on same-origin calls.
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' }
});

client.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;

  // Which token this request is carrying. Read on the way back out.
  config.__tokenGeneration = tokenGeneration;

  // Lets a server log line be correlated with a specific browser session.
  const deviceId = localStorage.getItem('device-id');
  if (deviceId) config.headers['X-Device-Id'] = deviceId;

  return config;
});

/** Error codes that mean "the token is stale", as opposed to "you may not". */
const REFRESHABLE = new Set(['TOKEN_EXPIRED', 'PERMISSIONS_CHANGED']);

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { response, config } = error;

    if (!response) {
      return Promise.reject(
        new ApiError({ code: 'NETWORK_ERROR', message: 'Could not reach the server.', status: 0 })
      );
    }

    const body = response.data || {};
    const code = body.error?.code;

    const shouldRefresh =
      response.status === 401 && REFRESHABLE.has(code) && !config.__isRetry && !config.url.includes('/auth/refresh');

    if (shouldRefresh) {
      // The token was already renewed while this request was in flight. It
      // failed on a token that no longer exists, so retrying is enough -
      // refreshing again would present an already-rotated cookie.
      if (config.__tokenGeneration < tokenGeneration) {
        config.__isRetry = true;
        config.headers.Authorization = `Bearer ${accessToken}`;
        return client(config);
      }

      try {
        // Every caller awaits the same in-flight refresh. Cleared in `finally`
        // on the promise itself, so it is released exactly once however many
        // callers are queued behind it and whichever of them settles first.
        if (!refreshPromise) {
          refreshPromise = performRefresh().finally(() => {
            refreshPromise = null;
          });
        }

        const token = await refreshPromise;

        config.__isRetry = true;
        config.headers.Authorization = `Bearer ${token}`;
        return client(config);
      } catch (refreshError) {
        // Refresh failed: the session is genuinely over.
        window.dispatchEvent(new CustomEvent('auth:session-expired'));
        return Promise.reject(refreshError);
      }
    }

    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent('auth:session-expired'));
    }

    return Promise.reject(
      new ApiError({
        code: code || 'UNKNOWN_ERROR',
        message: body.error?.message || 'Something went wrong.',
        details: body.error?.details,
        status: response.status,
        requestId: body.requestId
      })
    );
  }
);

async function performRefresh() {
  const { data } = await axios.post(
    `${BASE_URL.replace(/\/$/, '')}${API_PREFIX}/auth/refresh`,
    {},
    { withCredentials: true }
  );
  const token = data.data.accessToken;
  setAccessToken(token);
  return token;
}

/**
 * Typed error surfaced to callers. `details` carries per-field validation
 * messages in the shape forms expect: `{ fieldName: ['message'] }`.
 */
export class ApiError extends Error {
  constructor({ code, message, details, status, requestId }) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.status = status;
    this.requestId = requestId;
  }

  get isValidation() {
    return this.code === 'VALIDATION_ERROR';
  }

  get isForbidden() {
    return this.status === 403;
  }
}

/** Unwraps the response envelope so callers work with payloads, not wrappers. */
function unwrap(promise) {
  return promise.then((response) => response.data.data);
}

/** Same, but keeps `meta` for paginated endpoints. */
function unwrapWithMeta(promise) {
  return promise.then((response) => ({ items: response.data.data, meta: response.data.meta }));
}

export const api = {
  get: (url, config) => unwrap(client.get(url, config)),
  list: (url, params) => unwrapWithMeta(client.get(url, { params })),
  post: (url, data, config) => unwrap(client.post(url, data, config)),
  put: (url, data, config) => unwrap(client.put(url, data, config)),
  patch: (url, data, config) => unwrap(client.patch(url, data, config)),
  delete: (url, config) => unwrap(client.delete(url, config)),
  raw: client
};

export default api;

import { DEFAULT_API_BASE, validateApiKeyFormat } from './constants.mjs';

export class CardzApiError extends Error {
  constructor(message, { status = 500, errorCode = 'UPSTREAM_ERROR', retryAfterSeconds = null } = {}) {
    super(message);
    this.name = 'CardzApiError';
    this.status = status;
    this.errorCode = errorCode;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function assertSafeApiBase(apiBase) {
  const url = new URL(apiBase ?? DEFAULT_API_BASE);
  const isLoopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new CardzApiError('API base URL must use HTTPS (or loopback HTTP for local testing).', {
      status: 400,
      errorCode: 'INVALID_ORIGIN',
    });
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new CardzApiError('API base URL must not contain credentials, query, or hash.', {
      status: 400,
      errorCode: 'INVALID_ORIGIN',
    });
  }
  return url.origin;
}

async function readBoundedText(body, maxBytes) {
  if (!body) return '';
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new CardzApiError('Upstream response exceeded size limit.', { status: 502, errorCode: 'RESPONSE_TOO_LARGE' });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks).text();
}

export async function requestJson({
  path,
  method = 'GET',
  query = null,
  body = null,
  apiBase = DEFAULT_API_BASE,
  apiKey = null,
  fetcher = fetch,
  timeoutMs = 15_000,
  maxResponseBytes = 4 * 1024 * 1024,
}) {
  const origin = assertSafeApiBase(apiBase);
  const target = new URL(path, origin);
  if (target.origin !== origin) {
    throw new CardzApiError('Rejected cross-origin upstream path.', { status: 400, errorCode: 'INVALID_ORIGIN' });
  }
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    }
    target.search = params.toString();
  }

  const headers = { Accept: 'application/json' };
  const validKey = validateApiKeyFormat(apiKey);
  if (validKey) {
    headers['X-API-Key'] = validKey;
  }
  const init = {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
    headers,
  };
  if (body !== null && method === 'POST') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetcher(target.toString(), init);
  } catch (err) {
    throw new CardzApiError('CARDZ market API is temporarily unreachable. Please try again later.', {
      status: 503,
      errorCode: err?.name === 'TimeoutError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNREACHABLE',
    });
  }

  if (response.status >= 300 && response.status < 400) {
    throw new CardzApiError('Upstream redirect rejected.', { status: 502, errorCode: 'REDIRECT_REJECTED' });
  }
  if (response.status === 429) {
    const retryAfter = Number.parseInt(response.headers?.get?.('Retry-After') ?? '60', 10);
    throw new CardzApiError(
      'Rate limit exceeded. Wait before retrying or attach a commercial CARDZ_API_KEY for higher quotas.',
      {
        status: 429,
        errorCode: 'RATE_LIMITED',
        retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : 60,
      }
    );
  }
  if (response.status === 404) {
    throw new CardzApiError('Card not found. Use search_cards to obtain a published CARDZ card ID first.', {
      status: 404,
      errorCode: 'NOT_FOUND',
    });
  }
  if (!response.ok) {
    throw new CardzApiError(`CARDZ returned HTTP ${response.status}. Try again later.`, {
      status: response.status,
      errorCode: 'UPSTREAM_HTTP_ERROR',
    });
  }
  const contentType = response.headers?.get?.('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new CardzApiError('CARDZ returned an unexpected non-JSON response.', {
      status: 502,
      errorCode: 'INVALID_CONTENT_TYPE',
    });
  }
  const text = response.body ? await readBoundedText(response.body, maxResponseBytes) : await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new CardzApiError('CARDZ returned invalid JSON.', { status: 502, errorCode: 'INVALID_JSON' });
  }
}

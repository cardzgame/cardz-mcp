import {
  DEFAULT_API_BASE,
  IP_SCOPES,
  PROTOCOL_VERSIONS,
  PUBLIC_MCP_ORIGIN,
  SERVER_INFO,
  dispatchRpc,
  extractValidatedApiKey,
  rpcError,
  tools,
} from '@cardz/mcp-core';
import { APP_TOOL_META, APP_URI, readAppResource } from './app-resource.mjs';

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

const PUBLIC_TOOLS = tools.map((t) => ({ ...t, _meta: APP_TOOL_META }));

async function readBounded(stream, max, binary = false) {
  const reader = stream?.getReader();
  const parts = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) {
          await reader.cancel();
          throw new RangeError('Body too large.');
        }
        parts.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  return binary ? new Blob(parts) : new Blob(parts).text();
}

export async function handleRequest(
  request,
  env,
  ctx,
  {
    upstream = fetch,
    cache = globalThis.caches?.default ?? null,
    assets = { appHtml: '', landingHtml: '', publicCopy: '', logoSvg: '', iconPng: new Uint8Array(), landingPreviewPng: new Uint8Array() },
  } = {}
) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const allowedOrigins = [
    url.origin,
    ...(env.ALLOWED_ORIGINS ?? '').split(',').map((v) => v.trim()).filter(Boolean),
  ];

  const headers = {
    ...BASE_HEADERS,
    ...(origin && allowedOrigins.includes(origin)
      ? {
          'Access-Control-Allow-Origin': origin,
          Vary: 'Origin',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, MCP-Protocol-Version, MCP-Session-Id',
        }
      : {}),
  };

  const reply = (data, status = 200, extra = {}) =>
    new Response(data === null ? null : JSON.stringify(data), {
      status,
      headers: { ...headers, ...(data === null ? {} : { 'Content-Type': 'application/json' }), ...extra },
    });

  if (origin && !allowedOrigins.includes(origin)) {
    return reply(rpcError(null, -32000, 'Origin not allowed.'), 403);
  }
  if (env.PUBLIC_MCP_ENABLED !== 'true') {
    return reply({ status: 'disabled', service: SERVER_INFO.name }, 503, { 'Retry-After': '60' });
  }

  try {
    if (!env.CLIENT_LIMITER || !env.SERVICE_LIMITER) throw new Error('Missing limiter binding');
    const clientIp = request.headers.get('CF-Connecting-IP') ?? 'local';
    const client = await env.CLIENT_LIMITER.limit({ key: clientIp });
    const service = await env.SERVICE_LIMITER.limit({ key: 'cardz-public-v2' });
    if (!client.success || !service.success) {
      return reply(rpcError(null, -32000, 'Rate limit exceeded. Try again later.'), 429, { 'Retry-After': '60' });
    }
  } catch {
    return reply(rpcError(null, -32603, 'Service temporarily unavailable.'), 503);
  }

  // Allowlisted SHA-256 public WebP card artwork proxy with RIFF/WEBP magic-byte verification
  const art = url.pathname.match(/^\/card-art\/([a-f0-9]{64}(?:_(?:200|600))?\.webp)$/);
  if (art) {
    if (!['GET', 'HEAD'].includes(request.method)) {
      return reply({ error: 'Method not allowed.' }, 405, { Allow: 'GET, HEAD' });
    }
    if (url.search) return reply({ error: 'Invalid image request.' }, 400);
    const key = new Request(`https://cardzmarketcap.com/market-assets/${art[1]}`);
    try {
      let image = await cache?.match(key);
      if (!image) {
        const res = await upstream(key.url, {
          method: 'GET',
          headers: { Accept: 'image/webp' },
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok || res.headers.get('Content-Type')?.split(';')[0] !== 'image/webp') {
          throw new Error('Invalid image response');
        }
        const bytes = new Uint8Array(await (await readBounded(res.body, 512 * 1024, true)).arrayBuffer());
        if (
          String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF' ||
          String.fromCharCode(...bytes.slice(8, 12)) !== 'WEBP'
        ) {
          throw new Error('Invalid WebP header');
        }
        image = new Response(bytes, {
          headers: {
            ...BASE_HEADERS,
            'Content-Type': 'image/webp',
            'Cross-Origin-Resource-Policy': 'cross-origin',
            'Cache-Control': 'public, max-age=86400',
          },
        });
        if (cache) ctx?.waitUntil?.(cache.put(key, image.clone()).catch(() => {}));
      }
      return request.method === 'HEAD' ? new Response(null, { headers: image.headers }) : image;
    } catch {
      return reply({ error: 'Public card image unavailable.' }, 502);
    }
  }

  if (url.pathname === '/mcp') {
    if (request.method === 'OPTIONS') return reply(null, 204);
    if (request.method !== 'POST') {
      return reply(
        rpcError(null, -32000, 'Use Streamable HTTP POST; legacy SSE or session termination is unsupported.'),
        405,
        { Allow: 'POST, OPTIONS' }
      );
    }
    const accepted = (request.headers.get('Accept') ?? '')
      .toLowerCase()
      .split(',')
      .map((v) => v.trim().split(';')[0]);
    if (!accepted.includes('application/json') || !accepted.includes('text/event-stream')) {
      return reply(rpcError(null, -32000, 'Accept must include application/json and text/event-stream.'), 406);
    }
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return reply(rpcError(null, -32600, 'Use application/json.'), 415);
    }
    const protocol = request.headers.get('MCP-Protocol-Version');
    if (protocol && !PROTOCOL_VERSIONS.includes(protocol)) {
      return reply(rpcError(null, -32000, 'Unsupported MCP-Protocol-Version.'), 400);
    }

    let body;
    try {
      body = JSON.parse(await readBounded(request.body, 16 * 1024));
    } catch (e) {
      return reply(
        rpcError(null, e instanceof RangeError ? -32600 : -32700, e instanceof RangeError ? 'Request too large.' : 'Invalid JSON.'),
        e instanceof RangeError ? 413 : 400
      );
    }

    const validatedApiKey = extractValidatedApiKey(request.headers);
    const apiBase = env.API_BASE_URL || DEFAULT_API_BASE;

    try {
      const cachedFetcher = async (target, init) => {
        // Only cache keyless GET requests; never cache authenticated or POST portfolio calls.
        const isCacheable = init.method === 'GET' && !validatedApiKey;
        const cacheKey = isCacheable ? new Request(target, { method: 'GET' }) : null;
        if (cacheKey) {
          const hit = await cache?.match(cacheKey);
          if (hit) return hit;
        }
        // Only validated API key and standard JSON headers are forwarded; Cookie/MerchantId/other headers are stripped.
        const res = await upstream(target, { ...init, redirect: 'manual' });
        if (res.status >= 300 && res.status < 400) throw new Error('Upstream redirect rejected.');
        if (!isCacheable || !res.ok || !res.headers.get('Content-Type')?.includes('application/json')) return res;
        const text = await readBounded(res.body, 4 * 1024 * 1024);
        JSON.parse(text);
        const clean = new Response(text, {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
        });
        if (cache && cacheKey) ctx?.waitUntil?.(cache.put(cacheKey, clean.clone()).catch(() => {}));
        return clean;
      };

      let result = await dispatchRpc(body, {
        apiBase,
        apiKey: validatedApiKey,
        fetcher: cachedFetcher,
        proxyOrigin: PUBLIC_MCP_ORIGIN,
        tools: PUBLIC_TOOLS,
        capabilities: { tools: {}, resources: {} },
        toolResultMeta: APP_TOOL_META,
      });

      if (
        result?.error?.code === -32601 &&
        ['resources/list', 'resources/read', 'resources/templates/list'].includes(body.method)
      ) {
        result = await readAppResource(body, request, assets.appHtml);
      }

      if (result === null) return reply(null, 202);
      return reply(result, result.error?.code === -32600 ? 400 : 200);
    } catch {
      return reply(rpcError(null, -32603, 'Service temporarily unavailable.'), 503);
    }
  }

  if (request.method !== 'GET') return reply({ error: 'Method not allowed.' }, 405, { Allow: 'GET' });
  if (url.pathname === '/health') {
    return reply({ status: 'ok', ...SERVER_INFO, toolCount: tools.length, accountConnection: false, mcpApps: true });
  }
  if (url.pathname === '/tools.json') {
    return reply({
      ...SERVER_INFO,
      category: 'Collectibles & Trading Card Games (TCG)',
      supportedGames: IP_SCOPES,
      transport: 'streamable-http',
      endpoint: '/mcp',
      authentication: 'optional-api-key',
      uiResource: APP_URI,
      tools: PUBLIC_TOOLS,
    });
  }
  if (url.pathname === '/logo.svg') return new Response(assets.logoSvg, { headers: { ...headers, 'Content-Type': 'image/svg+xml' } });
  if (url.pathname === '/icon.png' || url.pathname === '/favicon.ico') {
    return new Response(assets.iconPng, { headers: { ...headers, 'Content-Type': 'image/png' } });
  }
  if (url.pathname === '/landing-card.png') {
    return new Response(assets.landingPreviewPng, { headers: { ...headers, 'Content-Type': 'image/png' } });
  }
  if (url.pathname === '/' && (request.headers.get('Accept') ?? '').includes('text/html')) {
    return new Response(assets.landingHtml, {
      headers: {
        ...headers,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy':
          "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    });
  }
  if (['/', '/privacy', '/terms', '/support'].includes(url.pathname)) {
    return new Response(assets.publicCopy, { headers: { ...headers, 'Content-Type': 'text/markdown; charset=utf-8' } });
  }
  return reply({ error: 'Not found.' }, 404);
}

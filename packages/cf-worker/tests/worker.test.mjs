import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleRequest } from '../src/worker.mjs';
import { APP_URI, LEGACY_APP_URIS } from '../src/app-resource.mjs';

const repoRoot = new URL('../../../', import.meta.url);
const assets = {
  appHtml: '<!doctype html><title>CARDZ MCP App 2.0</title>',
  landingHtml: readFileSync(new URL('../src/landing.html', import.meta.url), 'utf8'),
  publicCopy: readFileSync(new URL('docs/legal/public-copy.md', repoRoot), 'utf8'),
  logoSvg: readFileSync(new URL('assets/brand/logo.svg', repoRoot), 'utf8'),
  iconPng: new Uint8Array(readFileSync(new URL('assets/brand/icon.png', repoRoot))),
  landingPreviewPng: new Uint8Array(readFileSync(new URL('assets/brand/landing-preview.png', repoRoot))),
};

const makeEnv = (overrides = {}) => ({
  PUBLIC_MCP_ENABLED: 'true',
  ALLOWED_ORIGINS: 'https://claude.ai,https://chatgpt.com',
  CLIENT_LIMITER: { limit: async () => ({ success: true }) },
  SERVICE_LIMITER: { limit: async () => ({ success: true }) },
  ...overrides,
});

const mcpReq = (body, extraHeaders = {}) =>
  new Request('https://mcp.cardz.game/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

test('T4 worker: /health, /tools.json, landing HTML (zero legacy disabled service), and policy routes', async () => {
  const env = makeEnv();
  const h = await handleRequest(new Request('https://mcp.cardz.game/health'), env, null, { assets });
  assert.equal(h.status, 200);
  const hj = await h.json();
  assert.equal(hj.version, '2.0.0');
  assert.equal(hj.toolCount, 6);
  assert.equal(hj.accountConnection, false);

  const landing = await handleRequest(new Request('https://mcp.cardz.game/', { headers: { Accept: 'text/html' } }), env, null, { assets });
  assert.equal(landing.status, 200);
  const html = await landing.text();
  assert.ok(html.includes('npx'));
  assert.ok(html.includes('evaluate_portfolio'));
  assert.equal(/CARDZ\.GAME/.test(html), false);
  assert.equal(/workers\.dev/i.test(html), false);

  const privacy = await handleRequest(new Request('https://mcp.cardz.game/privacy'), env, null, { assets });
  assert.equal(privacy.status, 200);
  assert.ok((await privacy.text()).includes('support@cardz.game'));
});

test('T4 worker: enforces CORS allowlist, 429 rate limits, and disabled fail-closed switch', async () => {
  const disabled = await handleRequest(new Request('https://mcp.cardz.game/health'), makeEnv({ PUBLIC_MCP_ENABLED: 'false' }), null, { assets });
  assert.equal(disabled.status, 503);

  const badOrigin = await handleRequest(
    mcpReq({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'https://evil.invalid' }),
    makeEnv(),
    null,
    { assets }
  );
  assert.equal(badOrigin.status, 403);

  const limited = await handleRequest(
    mcpReq({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    makeEnv({ CLIENT_LIMITER: { limit: async () => ({ success: false }) } }),
    null,
    { assets }
  );
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '60');
});

test('T4 worker: forwards ONLY validated API key and strips Cookie/MerchantId/arbitrary Authorization', async () => {
  let seenHeaders;
  const upstream = async (_url, init) => {
    seenHeaders = init.headers;
    return new Response(JSON.stringify({ effectiveAt: '2026-11-20T00:00:00Z', total: 0, hits: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  // Unvalidated headers must be stripped
  await handleRequest(
    mcpReq(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_cards', arguments: { q: 'Pikachu' } } },
      { Cookie: 'session=secret', MerchantId: '12345', Authorization: 'Bearer not-a-cardz-key' }
    ),
    makeEnv(),
    null,
    { assets, upstream }
  );
  assert.equal(seenHeaders['X-API-Key'], undefined);
  assert.equal(seenHeaders.Cookie, undefined);
  assert.equal(seenHeaders.MerchantId, undefined);

  // Valid API key is forwarded cleanly
  const validKey = 'cz_live_9f3a7b2c_' + 'Q'.repeat(32);
  await handleRequest(
    mcpReq(
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_cards', arguments: { q: 'Pikachu' } } },
      { 'X-API-Key': validKey, Cookie: 'session=secret' }
    ),
    makeEnv(),
    null,
    { assets, upstream }
  );
  assert.equal(seenHeaders['X-API-Key'], validKey);
  assert.equal(seenHeaders.Cookie, undefined);
});

test('T4 worker: MCP Apps 2.0 resource + legacy 1.1.5/1.1.4 URIs readable + Claude sandbox hash', async () => {
  const env = makeEnv();
  const listRes = await handleRequest(
    mcpReq({ jsonrpc: '2.0', id: 1, method: 'resources/list' }, { 'User-Agent': 'Claude-User' }),
    env,
    null,
    { assets }
  ).then((r) => r.json());
  assert.equal(listRes.result.resources[0].uri, APP_URI);
  assert.ok(listRes.result.resources[0]._meta.ui.domain.endsWith('.claudemcpcontent.com'));

  for (const uri of [APP_URI, LEGACY_APP_URIS[0], LEGACY_APP_URIS[1]]) {
    const readRes = await handleRequest(
      mcpReq({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri } }),
      env,
      null,
      { assets }
    ).then((r) => r.json());
    assert.equal(readRes.result.contents[0].uri, uri);
    assert.ok(readRes.result.contents[0].text.includes('CARDZ MCP App 2.0'));
  }
});

test('T4 worker: /card-art proxy verifies WebP magic bytes and rejects forged payloads', async () => {
  const hash = 'd'.repeat(64);
  const validWebp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
  const okRes = await handleRequest(
    new Request(`https://mcp.cardz.game/card-art/${hash}_600.webp`),
    makeEnv(),
    null,
    { assets, upstream: async () => new Response(validWebp, { status: 200, headers: { 'Content-Type': 'image/webp' } }) }
  );
  assert.equal(okRes.status, 200);
  assert.equal(okRes.headers.get('Cross-Origin-Resource-Policy'), 'cross-origin');

  const forgedRes = await handleRequest(
    new Request(`https://mcp.cardz.game/card-art/${hash}_600.webp`),
    makeEnv(),
    null,
    { assets, upstream: async () => new Response('<html>not webp</html>', { status: 200, headers: { 'Content-Type': 'image/webp' } }) }
  );
  assert.equal(forgedRes.status, 502);
});

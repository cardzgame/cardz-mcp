import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSafeApiBase,
  callTool,
  dispatchRpc,
  extractValidatedApiKey,
  requestJson,
  sanitizePublicImage,
} from '../src/index.mjs';

test('T3 security: enforces unified API key regex and strips malformed keys', () => {
  const valid = 'cz_live_9f3a7b2c_' + 'A'.repeat(32);
  assert.equal(extractValidatedApiKey(new Headers({ Authorization: `Bearer ${valid}` })), valid);
  assert.equal(extractValidatedApiKey(new Headers({ 'X-API-Key': valid })), valid);
  // Malformed keys must be rejected (returns null)
  assert.equal(extractValidatedApiKey(new Headers({ Authorization: 'Bearer sk_invalid' })), null);
  assert.equal(extractValidatedApiKey(new Headers({ 'X-API-Key': 'cz_live_short_' + 'A'.repeat(32) })), null);
  assert.equal(extractValidatedApiKey(new Headers({ 'X-API-Key': 'cz_live_9f3a7b2c_tooshort' })), null);
});

test('T3 security: rejects non-HTTPS non-loopback origin, 3xx redirects, and maps 429 cleanly', async () => {
  assert.throws(() => assertSafeApiBase('http://evil.example.com'), /HTTPS/);
  assert.throws(() => assertSafeApiBase('https://user:pass@api.cardzmarketcap.com'), /credentials/);
  assert.equal(assertSafeApiBase('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');

  const redirectFetcher = async () => new Response(null, { status: 302, headers: { Location: 'https://evil.invalid' } });
  await assert.rejects(() => requestJson({ path: '/v2/cards/1', fetcher: redirectFetcher }), /redirect rejected/i);

  const limitFetcher = async () => new Response('too many', { status: 429, headers: { 'Retry-After': '45' } });
  const rpcOut = await dispatchRpc(
    { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'search_cards', arguments: { q: 'Pikachu' } } },
    { fetcher: limitFetcher }
  );
  assert.equal(rpcOut.result.isError, true);
  const parsed = JSON.parse(rpcOut.result.content[0].text);
  assert.equal(parsed.errorCode, 'RATE_LIMITED');
  assert.equal(parsed.retryAfterSeconds, 45);
});

test('T3 security: image sanitizer blocks untrusted origins and path traversal', () => {
  const hash = 'b'.repeat(64);
  assert.equal(sanitizePublicImage({ kind: 'raw_front', url: `https://evil.invalid/market-assets/${hash}.webp` }), null);
  assert.equal(sanitizePublicImage({ kind: 'raw_front', url: '/market-assets/../secret.webp' }), null);
  assert.equal(sanitizePublicImage({ kind: 'watermarked', url: `/market-assets/${hash}.webp` }), null);
  assert.equal(
    sanitizePublicImage({ kind: 'raw_front', url: `/market-assets/${hash}.webp` }, { proxyOrigin: 'https://mcp.cardz.game' }).url,
    `https://mcp.cardz.game/card-art/${hash}.webp`
  );
});

test('T3 security: requestJson only sends X-API-Key when valid, never forwards arbitrary headers', async () => {
  let seenHeaders;
  const fetcher = async (_url, init) => {
    seenHeaders = init.headers;
    return new Response(JSON.stringify({ effectiveAt: '2026-11-20T00:00:00Z', total: 0, hits: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  await callTool('search_cards', { q: 'Pikachu' }, { fetcher, apiKey: 'invalid-key' });
  assert.equal(seenHeaders['X-API-Key'], undefined);

  const valid = 'cz_live_12345678_' + 'Z'.repeat(32);
  await callTool('search_cards', { q: 'Pikachu' }, { fetcher, apiKey: valid });
  assert.equal(seenHeaders['X-API-Key'], valid);
});

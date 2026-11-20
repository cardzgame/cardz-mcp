import test from 'node:test';
import assert from 'node:assert/strict';
import { startLocalHttpServer } from '../src/http.mjs';

test('T4 local HTTP: stateless POST /mcp works keyless and forwards validated X-API-Key; GET /mcp returns 405', async () => {
  let seenKey = null;
  const mockFetcher = async (_url, init) => {
    seenKey = init.headers['X-API-Key'] ?? null;
    return new Response(
      JSON.stringify({ effectiveAt: '2026-11-20T00:00:00Z', total: 0, hits: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const { server, port } = await startLocalHttpServer({ port: 0, fetcher: mockFetcher, errOutput: { write: () => {} } });
  const base = `http://127.0.0.1:${port}`;
  try {
    const health = await fetch(`${base}/health`).then((r) => r.json());
    assert.equal(health.status, 'ok');
    assert.equal(health.toolCount, 6);

    const getMcp = await fetch(`${base}/mcp`);
    assert.equal(getMcp.status, 405);

    // Keyless request
    const r1 = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_cards', arguments: { q: 'Luffy' } } }),
    });
    assert.equal(r1.status, 200);
    const j1 = await r1.json();
    assert.equal(j1.result.structuredContent.totalMatches, 0);
    assert.equal(seenKey, null);

    // Paid API key via Bearer header
    const validKey = 'cz_live_abcd1234_' + '9'.repeat(32);
    const r2 = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${validKey}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_cards', arguments: { q: 'Luffy' } } }),
    });
    assert.equal(r2.status, 200);
    assert.equal(seenKey, validKey);
  } finally {
    server.close();
  }
});

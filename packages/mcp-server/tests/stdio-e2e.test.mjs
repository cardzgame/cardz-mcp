import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI_PATH = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));

function startMockApi() {
  let lastApiKey = null;
  const server = http.createServer((req, res) => {
    lastApiKey = req.headers['x-api-key'] ?? null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        effectiveAt: '2026-11-20T00:00:00Z',
        total: 1,
        hits: [
          {
            id: 'cmc_pikachu_001',
            officialName: 'Pikachu',
            collectorNumber: '001/165',
            setName: '151',
            tcg: 'pokemon',
            cardLanguage: 'en',
            marketRank: 10,
            image: null,
            pricePsa10: { value: 120, status: 'verified', asOf: '2026-11-19T00:00:00Z' },
            populationPsa10: { value: 500, status: 'verified', asOf: '2026-11-19T00:00:00Z' },
            marketCap: { value: 60000, status: 'verified', asOf: '2026-11-19T00:00:00Z' },
          },
        ],
      })
    );
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}`, getLastApiKey: () => lastApiKey });
    });
  });
}

test('T4 stdio E2E: child process emits pure JSON-RPC on stdout (zero banner noise) and supports optional CARDZ_API_KEY', async () => {
  const mock = await startMockApi();
  const validKey = 'cz_live_9f3a7b2c_' + 'K'.repeat(32);
  try {
    const child = spawn(process.execPath, [CLI_PATH, '--transport', 'stdio', '--api-base', mock.baseUrl], {
      env: { ...process.env, CARDZ_API_KEY: validKey },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdoutLines = [];
    let stderrText = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderrText += chunk; });

    const done = new Promise((resolve, reject) => {
      let buf = '';
      child.stdout.on('data', (chunk) => {
        buf += chunk;
        const parts = buf.split('\n');
        buf = parts.pop();
        for (const p of parts) {
          if (p.trim()) stdoutLines.push(p.trim());
        }
        if (stdoutLines.length >= 3) resolve();
      });
      child.on('error', reject);
    });

    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_cards', arguments: { q: 'Pikachu' } } }) + '\n');

    await done;
    child.stdin.end();
    child.kill();

    assert.ok(stderrText.includes('stdio transport ready'), 'banner goes to stderr');
    // Every single line on stdout MUST be valid JSON-RPC
    const parsed = stdoutLines.map((line) => JSON.parse(line));
    assert.equal(parsed[0].result.serverInfo.version, '2.0.0');
    assert.equal(parsed[1].result.tools.length, 6);
    assert.equal(parsed[2].result.structuredContent.cards[0].id, 'cmc_pikachu_001');
    assert.equal(mock.getLastApiKey(), validKey);
  } finally {
    mock.server.close();
  }
});

import http from 'node:http';
import {
  PROTOCOL_VERSIONS,
  SERVER_INFO,
  dispatchRpc,
  extractValidatedApiKey,
  rpcError,
  tools,
  validateApiKeyFormat,
} from '@cardz/mcp-core';

const MAX_BODY_BYTES = 16 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy();
        reject(new RangeError('Request too large.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createLocalHttpServer({
  apiBase,
  apiKey: defaultApiKey = null,
  fetcher,
} = {}) {
  const validDefaultKey = validateApiKeyFormat(defaultApiKey);

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const sendJson = (status, data, extraHeaders = {}) => {
      const payload = data === null ? '' : JSON.stringify(data);
      res.writeHead(status, {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        ...(data === null ? {} : { 'Content-Type': 'application/json' }),
        ...extraHeaders,
      });
      res.end(payload);
    };

    if (url.pathname === '/health' && req.method === 'GET') {
      sendJson(200, { status: 'ok', ...SERVER_INFO, transport: 'streamable-http', toolCount: tools.length, accountConnection: false });
      return;
    }

    if (url.pathname !== '/mcp') {
      sendJson(404, { error: 'Not found.' });
      return;
    }

    if (req.method === 'OPTIONS') {
      sendJson(204, null, {
        Allow: 'POST, OPTIONS',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, MCP-Protocol-Version',
      });
      return;
    }

    if (req.method !== 'POST') {
      sendJson(405, rpcError(null, -32000, 'Use Streamable HTTP POST; legacy SSE is not supported.'), { Allow: 'POST, OPTIONS' });
      return;
    }

    const contentType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      sendJson(415, rpcError(null, -32600, 'Use application/json.'));
      return;
    }

    const proto = req.headers['mcp-protocol-version'];
    if (proto && !PROTOCOL_VERSIONS.includes(String(proto))) {
      sendJson(400, rpcError(null, -32000, 'Unsupported MCP-Protocol-Version.'));
      return;
    }

    let raw;
    try {
      raw = await readBody(req);
    } catch (err) {
      sendJson(err instanceof RangeError ? 413 : 400, rpcError(null, -32600, err instanceof RangeError ? 'Request too large.' : 'Invalid body.'));
      return;
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      sendJson(400, rpcError(null, -32700, 'Invalid JSON.'));
      return;
    }

    const requestKey = extractValidatedApiKey(req.headers) ?? validDefaultKey;
    const result = await dispatchRpc(body, { apiBase, apiKey: requestKey, fetcher });
    if (result === null) {
      sendJson(202, null);
      return;
    }
    sendJson(result.error?.code === -32600 ? 400 : 200, result);
  });
}

export async function startLocalHttpServer({
  host = '127.0.0.1',
  port = 3333,
  apiBase,
  apiKey,
  fetcher,
  errOutput = process.stderr,
} = {}) {
  const server = createLocalHttpServer({ apiBase, apiKey, fetcher });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  errOutput.write(`[cardz-mcp] Streamable HTTP listening on http://${host}:${actualPort}/mcp\n`);
  return { server, host, port: actualPort };
}

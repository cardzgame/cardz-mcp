#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertSafeApiBase, DEFAULT_API_BASE, validateApiKeyFormat } from '@cardz/mcp-core';
import { startStdioServer } from './stdio.mjs';
import { startLocalHttpServer } from './http.mjs';

export function parseArgs(argv) {
  const opts = {
    transport: process.env.MCP_TRANSPORT || 'stdio',
    host: '127.0.0.1',
    port: Number.parseInt(process.env.PORT ?? '3333', 10),
    apiBase: process.env.CARDZ_API_BASE || DEFAULT_API_BASE,
    apiKey: process.env.CARDZ_API_KEY || null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--transport' && argv[i + 1]) opts.transport = argv[++i];
    else if (arg === '--stdio') opts.transport = 'stdio';
    else if (arg === '--http') opts.transport = 'http';
    else if (arg === '--port' && argv[i + 1]) opts.port = Number.parseInt(argv[++i], 10);
    else if (arg === '--host' && argv[i + 1]) opts.host = argv[++i];
    else if (arg === '--api-base' && argv[i + 1]) opts.apiBase = argv[++i];
    else if (arg === '--help' || arg === '-h') opts.help = true;
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stderr.write(
      'Usage: cardz-mcp [--transport stdio|http] [--port 3333] [--host 127.0.0.1] [--api-base https://api.cardzmarketcap.com]\n' +
      'Optional env: CARDZ_API_KEY=cz_live_<prefix8>_<secret32>\n'
    );
    return;
  }

  assertSafeApiBase(opts.apiBase);
  if (opts.apiKey && !validateApiKeyFormat(opts.apiKey)) {
    process.stderr.write('[cardz-mcp] warning: CARDZ_API_KEY format invalid; falling back to keyless anonymous tier.\n');
    opts.apiKey = null;
  }

  if (opts.transport === 'http') {
    await startLocalHttpServer(opts);
  } else if (opts.transport === 'stdio') {
    startStdioServer(opts);
  } else {
    throw new Error(`Unsupported transport: ${opts.transport}. Use 'stdio' or 'http'.`);
  }
}

const isMain =
  Boolean(process.argv[1]) &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`[cardz-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}

import readline from 'node:readline';
import { dispatchRpc, rpcError } from '@cardz/mcp-core';

export function startStdioServer({
  input = process.stdin,
  output = process.stdout,
  errOutput = process.stderr,
  apiBase,
  apiKey,
  fetcher,
} = {}) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const writeLine = (obj) => {
    output.write(`${JSON.stringify(obj)}\n`);
  };

  let pending = Promise.resolve();
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    pending = pending.then(async () => {
      let body;
      try {
        body = JSON.parse(trimmed);
      } catch {
        writeLine(rpcError(null, -32700, 'Invalid JSON.'));
        return;
      }
      try {
        const res = await dispatchRpc(body, { apiBase, apiKey, fetcher });
        if (res !== null) writeLine(res);
      } catch (err) {
        errOutput.write(`[cardz-mcp] internal error: ${err instanceof Error ? err.message : String(err)}\n`);
        writeLine(rpcError(body?.id ?? null, -32603, 'Internal server error.'));
      }
    });
  });

  errOutput.write('[cardz-mcp] stdio transport ready (read-only public market data)\n');
  return {
    close: () => rl.close(),
  };
}

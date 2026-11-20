import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const pkgRoot = new URL('../', import.meta.url);
await mkdir(new URL('build/', pkgRoot), { recursive: true });

const result = await build({
  entryPoints: [fileURLToPath(new URL('src/entry.mjs', pkgRoot))],
  outfile: fileURLToPath(new URL('build/worker.js', pkgRoot)),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: ['es2022'],
  mainFields: ['module', 'main'],
  conditions: ['worker', 'browser', 'import'],
  loader: {
    '.html': 'text',
    '.md': 'text',
    '.svg': 'text',
    '.png': 'binary',
  },
  metafile: true,
});

const outBytes = Object.values(result.metafile.outputs).reduce((s, o) => s + o.bytes, 0);
console.log(`CARDZ CF Worker bundle built: ${outBytes} bytes`);

import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const pkgRoot = new URL('../', import.meta.url);
const repoRoot = new URL('../../../', import.meta.url);

const [template, css, logo] = await Promise.all([
  readFile(new URL('src/index.html', pkgRoot), 'utf8'),
  readFile(new URL('src/style.css', pkgRoot), 'utf8'),
  readFile(new URL('assets/brand/logo.svg', repoRoot)),
]);

const entryPath = fileURLToPath(new URL('src/app.mjs', pkgRoot));
const bundle = await build({
  entryPoints: [entryPath],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  legalComments: 'eof',
});

const script = bundle.outputFiles[0].text.replaceAll('</script', '<\\/script');
const html = template
  .replace('/* STYLE */', () => css)
  .replace('ICON', () => `data:image/svg+xml;base64,${logo.toString('base64')}`)
  .replace('/* SCRIPT */', () => script);

if (html.includes('/* SCRIPT */') || html.includes('/* STYLE */')) {
  throw new Error('MCP App UI build markers unresolved.');
}

await mkdir(new URL('dist/', pkgRoot), { recursive: true });
await writeFile(new URL('dist/cardz-app.html', pkgRoot), html, 'utf8');
console.log(`CARDZ MCP Apps 2.0 UI built: ${Buffer.byteLength(html)} bytes`);

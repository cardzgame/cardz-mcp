#!/usr/bin/env node
/**
 * 5-Layer Security, Sanitization, OPSEC & License Gate for CARDZ Dev repositories.
 * Usage: node scripts/check-sanitization.mjs [targetDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.wrangler']);
const FORBIDDEN_EXTENSIONS = new Set(['.sqlite', '.sqlite3', '.pem', '.key', '.exe', '.difypkg', '.zip', '.mp4']);
const BINARY_EXTENSIONS = new Set(['.png', '.webp', '.jpg', '.jpeg', '.gif', '.ico', '.woff2', '.pdf']);
const MAX_FILE_BYTES = 1 * 1024 * 1024; // 1 MB hard cap
const COPYLEFT_RE = /\b(GPL|AGPL|SSPL|LGPL)\b/i;

// Layer 1: High-confidence secret signatures
const SECRET_PATTERNS = [
  { name: 'private-key-pem', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
  { name: 'github-pat', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'live-cardz-key-non-placeholder', re: /\bcz_live_[A-Za-z0-9]{8}_(?!(?:x{32,48}|([A-Za-z0-9])\1{31,47})\b)[A-Za-z0-9]{32,48}\b/ },
];

// Layer 2 (Public OPSEC layer): Generic structural patterns only.
// Company-specific identifiers, private upstream provider names, internal domains,
// and retired third-party service terms MUST be supplied exclusively via the
// PRIVATE_DENYLIST_REGEX_B64 CI secret so the public repo never reveals them.
const PUBLIC_DENYLIST = [
  { name: 'cf-account-id-field', re: /"account_id"\s*:\s*"[a-f0-9]{16,}"/i },
  { name: 'openai-sites-project-id', re: /\bappgprj_[a-z0-9]{12,}\b/i },
  { name: 'private-chatgpt-site', re: /\.chatgpt\.site\b/i },
  { name: 'unbound-workers-dev-subdomain', re: /\b[a-z0-9-]{1,63}\.workers\.dev\b/i },
  { name: 'local-user-home-path', re: /(?:\/home\/[a-z0-9_-]{3,}|C:\\Users\\[a-z0-9_-]{3,})/i },
];

// Layer 3: Customer-facing copy brand lint (CARDZ, never CARDZ.GAME outside URLs/emails)
const COPY_LINT_EXTS = new Set(['.md', '.html']);

function walk(dir, root, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      walk(full, root, out);
    } else if (entry.isFile()) {
      out.push({ full, rel, name: entry.name });
    }
  }
  return out;
}

export function scanRepository(targetDir, { privateDenylistB64 = process.env.PRIVATE_DENYLIST_REGEX_B64 || '' } = {}) {
  const root = path.resolve(targetDir);
  const violations = [];
  const files = walk(root, root);

  const privateRegexes = [];
  if (privateDenylistB64.trim()) {
    const decoded = Buffer.from(privateDenylistB64.trim(), 'base64').toString('utf8');
    for (const line of decoded.split(/\r?\n/)) {
      const pattern = line.trim();
      if (pattern && !pattern.startsWith('#')) {
        privateRegexes.push(new RegExp(pattern, 'i'));
      }
    }
  }

  for (const file of files) {
    const ext = path.extname(file.name).toLowerCase();
    const stat = fs.statSync(file.full);

    // Layer 4: Forbidden filenames, extensions, oversized files, and stray binaries
    if (/^\.env(\..+)?$/i.test(file.name) && file.name !== '.env.example') {
      violations.push({ layer: 'L4', file: file.rel, rule: 'forbidden-env-file' });
    }
    if (/^wrangler\.release\.jsonc?$/i.test(file.name)) {
      violations.push({ layer: 'L4', file: file.rel, rule: 'forbidden-wrangler-release' });
    }
    if (FORBIDDEN_EXTENSIONS.has(ext)) {
      violations.push({ layer: 'L4', file: file.rel, rule: `forbidden-extension:${ext}` });
    }
    if (stat.size > MAX_FILE_BYTES) {
      violations.push({ layer: 'L4', file: file.rel, rule: `oversized-file:${stat.size}` });
      continue;
    }
    const allowedBinaryDir = file.rel.startsWith('assets/') || file.rel.startsWith('registry/');
    if (BINARY_EXTENSIONS.has(ext) && !allowedBinaryDir) {
      violations.push({ layer: 'L4', file: file.rel, rule: 'stray-binary-outside-assets' });
    }
    if (BINARY_EXTENSIONS.has(ext) || FORBIDDEN_EXTENSIONS.has(ext)) continue;

    const text = fs.readFileSync(file.full, 'utf8');

    // Skip self-regex definitions in the scanner and its unit test
    const isScannerSelf = file.rel === 'scripts/check-sanitization.mjs' || file.rel === 'scripts/check-sanitization.test.mjs';

    if (!isScannerSelf) {
      // Layer 1: Secrets
      for (const rule of SECRET_PATTERNS) {
        if (rule.re.test(text)) {
          violations.push({ layer: 'L1', file: file.rel, rule: rule.name });
        }
      }
      // Layer 2: Public OPSEC denylist + optional private B64 secret denylist
      for (const rule of PUBLIC_DENYLIST) {
        if (rule.re.test(text)) {
          violations.push({ layer: 'L2', file: file.rel, rule: rule.name });
        }
      }
      for (let i = 0; i < privateRegexes.length; i++) {
        if (privateRegexes[i].test(text)) {
          violations.push({ layer: 'L2-private', file: file.rel, rule: `private-denylist-#${i + 1}` });
        }
      }
    }

    // Layer 3: Brand copy lint (non-URL / non-email occurrences of CARDZ.GAME)
    if (COPY_LINT_EXTS.has(ext) && !isScannerSelf) {
      const stripped = text
        .replace(/https?:\/\/[^\s)"'>]+/gi, '')
        .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, '');
      if (/CARDZ\.GAME/i.test(stripped)) {
        violations.push({ layer: 'L3', file: file.rel, rule: 'brand-copy-use-CARDZ-not-CARDZ.GAME' });
      }
    }

    // Layer 5: License compliance check on package.json files
    if (file.name === 'package.json') {
      try {
        const pkg = JSON.parse(text);
        if (typeof pkg.license === 'string' && COPYLEFT_RE.test(pkg.license)) {
          violations.push({ layer: 'L5', file: file.rel, rule: `incompatible-license:${pkg.license}` });
        }
      } catch {
        violations.push({ layer: 'L5', file: file.rel, rule: 'invalid-package-json' });
      }
    }
  }

  return { scannedFiles: files.length, violations };
}

const isMain =
  Boolean(process.argv[1]) &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const target = process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const report = scanRepository(target);
  if (report.violations.length > 0) {
    console.error(JSON.stringify({ status: 'FAILED', ...report }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ status: 'PASS', scannedFiles: report.scannedFiles, violations: [] }));
}

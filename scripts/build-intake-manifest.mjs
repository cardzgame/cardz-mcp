#!/usr/bin/env node
/**
 * Builds a deterministic, read-only SHA-256 intake manifest for Layer 1 Pull-Only consumers.
 * Never connects to any external database or pushes data.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRegistry } from './validate-registry.mjs';

function listJsonFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listJsonFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith('.json')) out.push(full);
  }
  return out.sort();
}

export function buildIntakeManifest(rootDir, { releaseSha = 'local-dev' } = {}) {
  const root = path.resolve(rootDir);
  const check = validateRegistry(root);
  if (!check.ok) {
    throw new Error(`Cannot build intake manifest with validation errors: ${JSON.stringify(check.errors)}`);
  }

  const entries = [];
  for (const full of listJsonFiles(path.join(root, 'registry'))) {
    const rel = path.relative(root, full).replace(/\\/g, '/');
    const raw = fs.readFileSync(full, 'utf8');
    const doc = JSON.parse(raw);
    const kind = rel.split('/')[1];
    const submissionId = doc.submissionId ?? doc.listingId ?? doc.identitySubmissionId ?? doc.exchangeSlug;
    entries.push({
      submissionId,
      kind,
      path: rel,
      sha256: crypto.createHash('sha256').update(raw).digest('hex'),
      payload: doc,
    });
  }

  const manifestCore = {
    manifestVersion: '1.0.0',
    releaseSha,
    generatedAt: new Date().toISOString(),
    entryCount: entries.length,
    entries,
  };
  const manifestSha256 = crypto
    .createHash('sha256')
    .update(JSON.stringify(entries))
    .digest('hex');

  return { ...manifestCore, entriesSha256: manifestSha256 };
}

const isMain =
  Boolean(process.argv[1]) &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const manifest = buildIntakeManifest(root, { releaseSha: process.env.GITHUB_SHA || 'local-dev' });
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  const outPath = path.join(root, 'dist', 'intake-manifest.json');
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ status: 'BUILT', outPath, entryCount: manifest.entryCount, entriesSha256: manifest.entriesSha256 }));
}

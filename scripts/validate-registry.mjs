#!/usr/bin/env node
/**
 * Community registry validator (JSON Schema Draft 2020-12 + artwork checks + anti-executable guard).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const FORBIDDEN_REGISTRY_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.py', '.sh', '.ps1', '.bat', '.exe', '.wasm']);
const MAX_IMAGE_BYTES = 512 * 1024;
const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/i;

function readPngDimensions(buf) {
  if (buf.length < 24 || buf.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: 'png' };
}

function readWebpDimensions(buf) {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width, height, format: 'webp' };
  }
  return { width: null, height: null, format: 'webp' };
}

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function collectHttpsUrls(obj, urls = []) {
  if (typeof obj === 'string' && /^https?:\/\//i.test(obj)) urls.push(obj);
  else if (Array.isArray(obj)) obj.forEach((v) => collectHttpsUrls(v, urls));
  else if (obj && typeof obj === 'object') Object.values(obj).forEach((v) => collectHttpsUrls(v, urls));
  return urls;
}

export function validateRegistry(rootDir) {
  const root = path.resolve(rootDir);
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);

  const loadSchema = (name) => JSON.parse(fs.readFileSync(path.join(root, 'schemas', 'registry', name), 'utf8'));
  const validators = {
    corrections: ajv.compile(loadSchema('correction.schema.json')),
    listings: ajv.compile(loadSchema('new-card-listing.schema.json')),
    exchanges: ajv.compile(loadSchema('exchange-onboarding.schema.json')),
    identities: ajv.compile(loadSchema('identity-alias.schema.json')),
  };

  const registryDir = path.join(root, 'registry');
  const files = walkFiles(registryDir);
  const errors = [];
  const counts = { corrections: 0, listings: 0, exchanges: 0, identities: 0 };
  const seenExternalIdentities = new Map();

  for (const full of files) {
    const rel = path.relative(root, full).replace(/\\/g, '/');
    const ext = path.extname(full).toLowerCase();

    if (FORBIDDEN_REGISTRY_EXTS.has(ext)) {
      errors.push({ file: rel, message: `Executable file forbidden inside registry/: ${ext}` });
      continue;
    }

    if (ext !== '.json') {
      if (!['.png', '.webp'].includes(ext)) {
        errors.push({ file: rel, message: `Unsupported file type inside registry/: ${ext}` });
      }
      continue;
    }

    const parts = rel.split('/');
    const bucket = parts[1];
    if (!validators[bucket]) {
      errors.push({ file: rel, message: `Unknown registry category: ${bucket}` });
      continue;
    }

    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (e) {
      errors.push({ file: rel, message: `Invalid JSON: ${e.message}` });
      continue;
    }

    const ok = validators[bucket](doc);
    if (!ok) {
      errors.push({ file: rel, message: `Schema validation failed: ${ajv.errorsText(validators[bucket].errors)}` });
      continue;
    }

    // Anti-SSRF URL validation
    for (const rawUrl of collectHttpsUrls(doc)) {
      let parsed;
      try {
        parsed = new URL(rawUrl);
      } catch {
        errors.push({ file: rel, message: `Invalid URL: ${rawUrl}` });
        continue;
      }
      if (parsed.protocol !== 'https:' || PRIVATE_HOST_RE.test(parsed.hostname)) {
        errors.push({ file: rel, message: `Disallowed non-public HTTPS URL: ${rawUrl}` });
      }
    }

    // Verify optional listing artwork binary, dimensions, aspect ratio, and SHA-256
    if (bucket === 'listings' && doc.artwork) {
      const artPath = path.resolve(path.dirname(full), doc.artwork.relativePath);
      if (!artPath.startsWith(path.dirname(full)) || !fs.existsSync(artPath)) {
        errors.push({ file: rel, message: `Missing or escaping artwork file: ${doc.artwork.relativePath}` });
        continue;
      }
      const buf = fs.readFileSync(artPath);
      if (buf.length > MAX_IMAGE_BYTES) {
        errors.push({ file: rel, message: `Artwork exceeds 512KB limit: ${buf.length} bytes` });
        continue;
      }
      const actualSha = crypto.createHash('sha256').update(buf).digest('hex');
      if (actualSha !== doc.artwork.sha256) {
        errors.push({ file: rel, message: `Artwork SHA-256 mismatch: expected ${doc.artwork.sha256}, got ${actualSha}` });
        continue;
      }
      const dim = readPngDimensions(buf) ?? readWebpDimensions(buf);
      if (!dim) {
        errors.push({ file: rel, message: 'Artwork binary failed PNG/WebP magic-byte check.' });
        continue;
      }
      if (dim.width !== null && (dim.width !== doc.artwork.widthPx || dim.height !== doc.artwork.heightPx)) {
        errors.push({ file: rel, message: `Artwork dimension mismatch: actual ${dim.width}x${dim.height}` });
        continue;
      }
      const ratio = doc.artwork.widthPx / doc.artwork.heightPx;
      if (ratio < 0.65 || ratio > 0.78) {
        errors.push({ file: rel, message: `Artwork aspect ratio out of standard card range (0.65-0.78): ${ratio.toFixed(3)}` });
        continue;
      }
    }

    // Verify no duplicate (namespace, externalId) conflict across identity alias submissions
    if (bucket === 'identities' && Array.isArray(doc.externalIdentities)) {
      const localSeen = new Set();
      let conflict = false;
      for (const ext of doc.externalIdentities) {
        const key = `${ext.namespace}:${ext.externalId.trim().toLowerCase()}`;
        if (localSeen.has(key)) {
          errors.push({ file: rel, message: `Duplicate external identity within submission: ${key}` });
          conflict = true;
          continue;
        }
        localSeen.add(key);
        const prev = seenExternalIdentities.get(key);
        if (prev && prev.cardId !== doc.cardId) {
          errors.push({ file: rel, message: `Conflicting external identity ${key} already mapped to ${prev.cardId} in ${prev.file}` });
          conflict = true;
        } else {
          seenExternalIdentities.set(key, { cardId: doc.cardId, file: rel });
        }
      }
      if (conflict) continue;
    }

    counts[bucket]++;
  }

  return { ok: errors.length === 0, counts, errors };
}

const isMain =
  Boolean(process.argv[1]) &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const root = process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const res = validateRegistry(root);
  if (!res.ok) {
    console.error(JSON.stringify(res, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(res));
}

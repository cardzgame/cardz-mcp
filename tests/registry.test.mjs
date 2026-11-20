import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { validateRegistry } from '../scripts/validate-registry.mjs';
import { buildIntakeManifest } from '../scripts/build-intake-manifest.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'build', 'packages', 'assets', 'docs', 'integrations'].includes(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

test('T5 governance: repository passes validation across all 4 canonical sample channels (corrections, listings, exchanges, identities)', () => {
  const res = validateRegistry(REPO_ROOT);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.counts.corrections, 1);
  assert.equal(res.counts.listings, 1);
  assert.equal(res.counts.exchanges, 1);
  assert.equal(res.counts.identities, 1);
});

test('T5 governance: blocks executable scripts, bad artwork, SSRF URLs, private namespaces, and conflicting identity aliases', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cardz-reg-bad-'));
  try {
    copyDir(REPO_ROOT, tmp);
    // 1. Executable code injection attempt inside registry/
    fs.writeFileSync(path.join(tmp, 'registry/exchanges/example-tcg-market/adapter.js'), 'export default () => {}');
    // 2. Private loopback SSRF URL in correction
    fs.writeFileSync(
      path.join(tmp, 'registry/corrections/2026-11/cor-20261120-bad02.json'),
      JSON.stringify({
        schemaVersion: '1.0.0',
        submissionId: 'cor-20261120-bad02',
        cardId: 'cmc_1',
        issueType: 'name_typo',
        proposedPatch: { officialName: 'Test' },
        evidenceUrls: ['https://127.0.0.1/internal'],
        submittedAt: '2026-11-20T00:00:00Z',
      })
    );
    // 3. Listing with watermarkFreeDeclared=false
    const validListing = JSON.parse(
      fs.readFileSync(path.join(tmp, 'registry/listings/pokemon/sv8/lst-pokemon-sv8-pikachu238.json'), 'utf8')
    );
    validListing.listingId = 'lst-pokemon-sv8-bad01';
    validListing.artwork.watermarkFreeDeclared = false;
    fs.writeFileSync(path.join(tmp, 'registry/listings/pokemon/sv8/lst-pokemon-sv8-bad.json'), JSON.stringify(validListing));

    // 4. Identity PR with disallowed private namespace
    fs.writeFileSync(
      path.join(tmp, 'registry/identities/2026-11/idn-20261120-badns.json'),
      JSON.stringify({
        schemaVersion: '1.0.0',
        identitySubmissionId: 'idn-20261120-badns',
        cardId: 'c_other_card',
        externalIdentities: [{ namespace: 'private_vendor', externalId: '999' }],
        samePrintingAttested: true,
        evidenceUrls: ['https://www.pokemon-card.com/'],
        submittedAt: '2026-11-20T01:00:00Z',
      })
    );

    // 5. Conflicting external identity mapped to a different canonical card_id
    fs.writeFileSync(
      path.join(tmp, 'registry/identities/2026-11/idn-20261120-conflict.json'),
      JSON.stringify({
        schemaVersion: '1.0.0',
        identitySubmissionId: 'idn-20261120-conflict',
        cardId: 'c_different_card_id',
        externalIdentities: [{ namespace: 'snkrdunk', externalId: '102424' }],
        samePrintingAttested: true,
        evidenceUrls: ['https://snkrdunk.com/apparels/102424'],
        submittedAt: '2026-11-20T01:00:00Z',
      })
    );

    const res = validateRegistry(tmp);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.message.includes('Executable file forbidden')), 'blocks .js file');
    assert.ok(res.errors.some((e) => e.message.includes('Disallowed non-public HTTPS URL')), 'blocks loopback SSRF');
    assert.ok(res.errors.some((e) => e.file.includes('lst-pokemon-sv8-bad.json')), 'blocks watermarkFreeDeclared=false');
    assert.ok(res.errors.some((e) => e.file.includes('idn-20261120-badns.json')), 'blocks non-allowlisted namespace');
    assert.ok(res.errors.some((e) => e.message.includes('Conflicting external identity')), 'blocks cross-card externalId conflict');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('T5 governance: Pull-Only manifest imports all 4 channels idempotently into isolated Layer 1 community_intake_staging SQLite table', () => {
  const manifest = buildIntakeManifest(REPO_ROOT, { releaseSha: 'test-sha-002' });
  assert.equal(manifest.entryCount, 4);
  assert.match(manifest.entriesSha256, /^[a-f0-9]{64}$/);
  assert.ok(manifest.entries.some((e) => e.kind === 'identities' && e.submissionId === 'idn-20261120-demo01'));

  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE community_intake_staging (
      submission_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      release_sha TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_internal_apply',
      payload_json TEXT NOT NULL
    );
  `);

  const upsert = db.prepare(`
    INSERT INTO community_intake_staging (submission_id, kind, payload_sha256, release_sha, status, payload_json)
    VALUES (?, ?, ?, ?, 'pending_internal_apply', ?)
    ON CONFLICT(submission_id) DO UPDATE SET
      payload_sha256 = excluded.payload_sha256,
      release_sha = excluded.release_sha,
      payload_json = excluded.payload_json
  `);

  for (let round = 0; round < 2; round++) {
    for (const entry of manifest.entries) {
      upsert.run(entry.submissionId, entry.kind, entry.sha256, manifest.releaseSha, JSON.stringify(entry.payload));
    }
  }
  const count = db.prepare('SELECT COUNT(*) AS c FROM community_intake_staging WHERE status = ?').get('pending_internal_apply').c;
  assert.equal(count, 4);

  // Verify rollback by submission_id
  db.prepare('DELETE FROM community_intake_staging WHERE submission_id = ?').run('idn-20261120-demo01');
  const afterRollback = db.prepare('SELECT COUNT(*) AS c FROM community_intake_staging').get().c;
  assert.equal(afterRollback, 3);
});

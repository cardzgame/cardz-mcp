import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanRepository } from './check-sanitization.mjs';

test('T5 red-team: 5-layer sanitization gate blocks injected secrets, OPSEC leaks, bad brand copy, forbidden files, and copyleft', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cardz-redteam-'));
  try {
    // L1: simulated private key + high-entropy live key (while all-x placeholder should pass)
    fs.writeFileSync(path.join(tmp, 'leak-key.txt'), '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\ncz_live_9f3a7b2c_aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY');
    fs.writeFileSync(path.join(tmp, 'ok-placeholder.md'), 'example: cz_live_9f3a7b2c_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    // L2: generic structural leaks (CF account_id, unbound workers.dev) + private B64 denylist pattern
    fs.writeFileSync(path.join(tmp, 'wrangler.json'), '{"account_id": "0123456789abcdef0123456789abcdef"}');
    fs.writeFileSync(path.join(tmp, 'contact.txt'), 'preview https://demo-preview.workers.dev and secret_upstream_vendor_xyz test@private-corp.invalid');
    // L3: brand copy violation outside URL
    fs.writeFileSync(path.join(tmp, 'marketing.md'), 'Welcome to CARDZ.GAME official trading data!');
    // L4: forbidden wrangler.release.json and oversized file
    fs.writeFileSync(path.join(tmp, 'wrangler.release.json'), '{}');
    fs.writeFileSync(path.join(tmp, 'huge.txt'), 'a'.repeat(1024 * 1024 + 10));
    // L5: GPL copyleft package
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'bad', license: 'GPL-3.0-only' }));

    const b64 = Buffer.from('secret_upstream_vendor_xyz\n', 'utf8').toString('base64');
    const res = scanRepository(tmp, { privateDenylistB64: b64 });
    const layers = new Set(res.violations.map((v) => v.layer));
    assert.ok(layers.has('L1'), 'L1 secret caught');
    assert.ok(layers.has('L2'), 'L2 public OPSEC caught');
    assert.ok(layers.has('L2-private'), 'L2 private OPSEC caught');
    assert.ok(layers.has('L3'), 'L3 brand copy caught');
    assert.ok(layers.has('L4'), 'L4 forbidden/oversized file caught');
    assert.ok(layers.has('L5'), 'L5 copyleft license caught');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

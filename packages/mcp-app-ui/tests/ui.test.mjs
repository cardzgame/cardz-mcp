import test from 'node:test';
import assert from 'node:assert/strict';
import { cardUrl, historySeries, imageUrl, money, percent } from '../src/format.mjs';

test('T4 UI: imageUrl & cardUrl strictly enforce origin allowlist and prevent traversal/XSS', () => {
  const hash = 'c'.repeat(64);
  assert.equal(imageUrl(`https://cardzmarketcap.com/market-assets/${hash}_600.webp`), `https://mcp.cardz.game/card-art/${hash}_600.webp`);
  assert.equal(imageUrl(`https://mcp.cardz.game/card-art/${hash}.webp`), `https://mcp.cardz.game/card-art/${hash}.webp`);
  assert.equal(imageUrl(`https://evil.invalid/card-art/${hash}.webp`), null);
  assert.equal(imageUrl('https://mcp.cardz.game/card-art/../etc/passwd'), null);
  assert.equal(imageUrl('javascript:alert(1)'), null);

  assert.equal(cardUrl('https://cardzmarketcap.com/card/cmc_abc123'), 'https://cardzmarketcap.com/card/cmc_abc123');
  assert.equal(cardUrl('https://cardzmarketcap.com/card/cmc_abc123?x=1'), null);
  assert.equal(cardUrl('https://evil.invalid/card/cmc_abc123'), null);
});

test('T4 UI: historySeries breaks SVG path segments on missing days and null prices', () => {
  const series = historySeries([
    { date: '2026-11-01', closeUsd: 100 },
    { date: '2026-11-02', closeUsd: null },
    { date: '2026-11-03', closeUsd: 120 },
    { date: '2026-11-10', closeUsd: 130 },
  ]);
  assert.equal(series.segments.length, 3);
  assert.equal(money(null), 'Unavailable');
  assert.equal(percent(12.345), '+12.35%');
});

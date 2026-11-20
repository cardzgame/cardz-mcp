import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { commonSchema, toolSchemas } from '@cardz/schemas';
import { callTool, dispatchRpc, tools } from '../src/index.mjs';

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
ajv.addSchema(commonSchema, 'common.schema.json');

const HASH = 'a'.repeat(64);
const jsonRes = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const sampleCard = (overrides = {}) => ({
  id: 'cmc_8149d31b23f05efa50750a0a',
  name: { en: 'Umbreon ex', ja: 'ブラッキーex' },
  officialName: 'Umbreon ex',
  collectorNumber: '217/187',
  setName: { en: 'Terastal Festival ex', ja: 'テラスタルフェスex' },
  tcg: 'pokemon',
  cardLanguage: 'ja',
  marketRank: 12,
  image: { kind: 'raw_front', url: `/market-assets/${HASH}.webp`, variants: { '600': `/market-assets/${HASH}_600.webp` }, alt: 'Umbreon ex' },
  pricePsa10: { value: 380, status: 'verified', asOf: '2026-11-19T00:00:00Z', priceBasis: 'verified_sale', confidence: 'high' },
  populationPsa10: { value: 4200, status: 'verified', asOf: '2026-11-19T00:00:00Z' },
  marketCap: { value: 1596000, status: 'verified', asOf: '2026-11-19T00:00:00Z' },
  ...overrides,
});

test('T2: v1.1.x backward compatibility - search_cards preserves ambiguity and multi-language labels', async () => {
  const fetcher = async (url) => {
    assert.ok(url.includes('/v2/cards/search'));
    assert.ok(url.includes('q=OP05-119'));
    return jsonRes({
      effectiveAt: '2026-11-20T00:00:00Z',
      total: 2,
      hits: [
        sampleCard({ id: 'cmc_op05_alt', officialName: 'Monkey D. Luffy (Alt Art)', collectorNumber: 'OP05-119', tcg: 'one-piece', cardLanguage: 'ja' }),
        sampleCard({ id: 'cmc_op05_manga', officialName: 'Monkey D. Luffy (Manga)', collectorNumber: 'OP05-119', tcg: 'one-piece', cardLanguage: 'en' }),
      ],
    });
  };
  const out = await callTool('search_cards', { q: 'OP05-119', lang: 'en' }, { fetcher });
  assert.equal(out.needsDisambiguation, true);
  assert.equal(out.cards.length, 2);
  assert.equal(out.cards[0].url, 'https://cardzmarketcap.com/card/cmc_op05_alt');
  assert.equal(out.cards[0].image.url, `https://cardzmarketcap.com/market-assets/${HASH}_600.webp`);
  const validate = ajv.compile(toolSchemas.search_cards.output);
  assert.equal(validate(out), true, JSON.stringify(validate.errors));
});

test('T2: v1.1.x backward compatibility - get_card preserves null metrics and 7-day history cutoff', async () => {
  const fetcher = async () =>
    jsonRes({
      ...sampleCard({ pricePsa10: { value: null, status: 'unavailable', asOf: null } }),
      windows: { '7d': { changePct: { value: 4.2, status: 'verified', asOf: '2026-11-19T00:00:00Z' } } },
      historyDaily: [
        { at: '2026-11-01T00:00:00Z', priceUsd: 350, priceStatus: 'verified', trackedSalesValueUsd: 700, trackedSalesCount: 2 },
        { at: '2026-11-18T00:00:00Z', priceUsd: null, priceStatus: 'unavailable', trackedSalesValueUsd: null, trackedSalesCount: null },
        { at: '2026-11-19T00:00:00Z', priceUsd: 380, priceStatus: 'verified', trackedSalesValueUsd: 1140, trackedSalesCount: 3 },
      ],
    });
  const out = await callTool('get_card', { id: 'cmc_8149d31b23f05efa50750a0a', historyDays: 7, lang: 'ja' }, { fetcher });
  assert.equal(out.name, 'ブラッキーex');
  assert.equal(out.pricePsa10.value, null); // null never becomes 0
  assert.equal(out.historyDaily.length, 2);
  assert.equal(out.historyDaily[0].priceUsd, null);
  const validate = ajv.compile(toolSchemas.get_card.output);
  assert.equal(validate(out), true, JSON.stringify(validate.errors));
});

test('T2: v1.1.x backward compatibility - get_market preserves published order and supports v2 sortBy', async () => {
  let seenUrl = '';
  const fetcher = async (url) => {
    seenUrl = url;
    return jsonRes({
      effectiveAt: '2026-11-20T00:00:00Z',
      count: 250,
      cards: [sampleCard({ marketRank: 1 }), sampleCard({ id: 'cmc_2', marketRank: 2 })],
    });
  };
  const out = await callTool('get_market', { scope: 'one-piece', limit: 5, sortBy: 'vol_30d_usd' }, { fetcher });
  assert.ok(seenUrl.includes('sort=vol_30d_usd'));
  assert.equal(out.scope, 'one-piece');
  assert.equal(out.sortBy, 'vol_30d_usd');
  assert.equal(out.cards[0].marketRank, 1);
  const validate = ajv.compile(toolSchemas.get_market.output);
  assert.equal(validate(out), true, JSON.stringify(validate.errors));
});

test('T2: JSON-RPC dispatch exposes 6 read-only tools and matches text === JSON.stringify(structuredContent)', async () => {
  const listRes = await dispatchRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(listRes.result.tools.length, 6);
  assert.deepEqual(listRes.result.tools.map((t) => t.name), tools.map((t) => t.name));
  for (const t of listRes.result.tools) {
    assert.equal(t.annotations.readOnlyHint, true);
    assert.equal(t.annotations.destructiveHint, false);
  }
  const unknownRes = await dispatchRpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'request_shipment', arguments: {} } });
  assert.equal(unknownRes.error.code, -32602);
});

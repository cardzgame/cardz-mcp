import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { commonSchema, toolSchemas } from '@cardz/schemas';
import { callTool } from '../src/index.mjs';

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
ajv.addSchema(commonSchema, 'common.schema.json');

const jsonRes = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('T3: evaluate_portfolio computes exact PnL, isolates ambiguous printings, and never turns null into zero', async () => {
  const fetcher = async (url, init) => {
    assert.equal(init.method, 'POST');
    assert.ok(url.endsWith('/v2/portfolio/evaluate'));
    const body = JSON.parse(init.body);
    assert.equal(body.items[0].conditionKey, 'graded:PSA:10');
    return jsonRes({
      evaluatedAt: '2026-11-20T00:00:00Z',
      positions: [
        {
          status: 'matched_priced',
          matchedCard: { id: 'cmc_1', name: 'Charizard ex', collectorNumber: '199/165', setName: '151', tcg: 'pokemon', cardLanguage: 'en' },
          unitMarketPriceUsd: 500,
          priceBasis: 'verified_sale',
          priceAsOf: '2026-11-19T00:00:00Z',
        },
        {
          status: 'ambiguous',
          candidates: [
            { id: 'cmc_op_alt', name: 'Luffy Alt Art', collectorNumber: 'OP05-119', setName: 'OP05', cardLanguage: 'ja', tcg: 'one-piece', referencePriceUsd: 180 },
            { id: 'cmc_op_manga', name: 'Luffy Manga', collectorNumber: 'OP05-119', setName: 'OP05', cardLanguage: 'ja', tcg: 'one-piece', referencePriceUsd: 3200 },
          ],
        },
        {
          status: 'matched_priced',
          matchedCard: { id: 'cmc_ref', name: 'Promo Pikachu', collectorNumber: '001/SV-P', setName: 'Promo', tcg: 'pokemon', cardLanguage: 'ja' },
          unitMarketPriceUsd: 80,
          priceBasis: 'market_reference',
          priceAsOf: '2026-11-19T00:00:00Z',
        },
        {
          status: 'not_found',
        },
      ],
    });
  };

  const out = await callTool(
    'evaluate_portfolio',
    {
      items: [
        { itemRef: 'pos-1', cardId: 'cmc_1', quantity: 2, buyPriceUsd: 400 },
        { itemRef: 'pos-2', collectorNumber: 'OP05-119', tcg: 'one-piece', quantity: 1, buyPriceUsd: 200 },
        { itemRef: 'pos-3', cardId: 'cmc_ref', quantity: 1 },
        { itemRef: 'pos-4', name: 'Nonexistent Card XYZ', quantity: 1, buyPriceUsd: 50 },
      ],
    },
    { fetcher }
  );

  assert.equal(out.disambiguationRequired, true);
  assert.equal(out.summary.totalItemsSubmitted, 4);
  assert.equal(out.summary.pricedItemsCount, 2);
  assert.equal(out.summary.ambiguousItemsCount, 1);
  assert.equal(out.summary.unmatchedItemsCount, 1);
  assert.equal(out.summary.referencePricedItemsCount, 1);
  // Total market value = 2*500 + 1*80 = 1080
  assert.equal(out.summary.totalMarketValueUsd, 1080);
  // Cost basis paired ONLY across priced items WITH buyPriceUsd (pos-1: 2*400 = 800; pos-3 has no buyPrice; pos-2/pos-4 unpriced)
  assert.equal(out.summary.totalCostBasisUsd, 800);
  assert.equal(out.summary.totalUnrealizedPnlUsd, 200);
  assert.equal(out.summary.totalUnrealizedPnlPct, 25);
  assert.equal(out.positions[1].candidates.length, 2);
  assert.equal(out.positions[3].positionMarketValueUsd, null);

  const validate = ajv.compile(toolSchemas.evaluate_portfolio.output);
  assert.equal(validate(out), true, JSON.stringify(validate.errors));
});

test('T3: evaluate_portfolio verified_only excludes market_reference fallback and rejects >50 items', async () => {
  const fetcher = async () =>
    jsonRes({
      evaluatedAt: '2026-11-20T00:00:00Z',
      positions: [
        {
          status: 'matched_priced',
          matchedCard: { id: 'cmc_ref', name: 'Promo Pikachu', collectorNumber: '001/SV-P', setName: 'Promo', tcg: 'pokemon', cardLanguage: 'ja' },
          unitMarketPriceUsd: 80,
          priceBasis: 'market_reference',
          priceAsOf: '2026-11-19T00:00:00Z',
        },
      ],
    });
  const out = await callTool('evaluate_portfolio', { items: [{ cardId: 'cmc_ref' }], pricePreference: 'verified_only' }, { fetcher });
  assert.equal(out.summary.pricedItemsCount, 0);
  assert.equal(out.summary.unpricedItemsCount, 1);
  assert.equal(out.summary.totalMarketValueUsd, null);

  const tooMany = Array.from({ length: 51 }, (_, i) => ({ cardId: `cmc_${i}` }));
  await assert.rejects(() => callTool('evaluate_portfolio', { items: tooMany }, { fetcher }), /maxItems 50/);
});

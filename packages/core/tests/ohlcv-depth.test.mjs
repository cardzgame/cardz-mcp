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

test('T3: get_card_ohlcv aggregates daily rows to ISO weekly candles and preserves gaps', async () => {
  let seenUrl = '';
  const fetcher = async (url) => {
    seenUrl = url;
    return jsonRes({
      card: { id: 'cmc_charizard', name: 'Charizard ex', collectorNumber: '199/165', tcg: 'pokemon', cardLanguage: 'en' },
      effectiveAt: '2026-11-20T00:00:00Z',
      seriesStartDate: '2025-01-01',
      candles: [
        { date: '2026-11-09', openUsd: 400, highUsd: 420, lowUsd: 390, closeUsd: 410, medianUsd: 405, volumeUsd: 1200, salesCount: 3, priceBasis: 'verified_sale', activeMarketsCount: 2 },
        { date: '2026-11-11', openUsd: 410, highUsd: 450, lowUsd: 405, closeUsd: 440, medianUsd: 430, volumeUsd: 2200, salesCount: 5, priceBasis: 'mixed', activeMarketsCount: 3 },
        { date: '2026-11-17', openUsd: 445, highUsd: 460, lowUsd: 440, closeUsd: 455, medianUsd: 450, volumeUsd: 900, salesCount: 2, priceBasis: 'verified_sale', activeMarketsCount: 2 },
      ],
    });
  };
  const out = await callTool('get_card_ohlcv', { id: 'cmc_charizard', grade: 'PSA10', interval: '1w', region: 'US', days: 30 }, { fetcher });
  assert.ok(seenUrl.includes('condition=graded%3APSA%3A10'));
  assert.ok(seenUrl.includes('region=US'));
  assert.equal(out.candles.length, 2);
  assert.equal(out.candles[0].date, '2026-11-09');
  assert.equal(out.candles[0].openUsd, 400);
  assert.equal(out.candles[0].highUsd, 450);
  assert.equal(out.candles[0].lowUsd, 390);
  assert.equal(out.candles[0].closeUsd, 440);
  assert.equal(out.candles[0].salesCount, 8);
  assert.equal(out.candles[0].priceBasis, 'mixed');
  const validate = ajv.compile(toolSchemas.get_card_ohlcv.output);
  assert.equal(validate(out), true, JSON.stringify(validate.errors));
});

test('T3: get_card_ohlcv rejects date spans > 730 days or before 2025-01-01', async () => {
  await assert.rejects(() => callTool('get_card_ohlcv', { id: 'cmc_1', from: '2024-12-31' }, { fetcher: fetch }), /Invalid from/);
  await assert.rejects(() => callTool('get_card_ohlcv', { id: 'cmc_1', from: '2025-01-01', to: '2027-02-01' }, { fetcher: fetch }), /730 days/);
});

test('T3: get_market_depth emits anonymized regional bands for Top 500 and honest supported=false otherwise', async () => {
  const fetcherTop = async () =>
    jsonRes({
      cardId: 'cmc_top1',
      cardName: 'Pikachu',
      supported: true,
      snapshotAt: '2026-11-20T00:00:00Z',
      liquidityTier: 'tier1_top100',
      liquidityRank: 5,
      summary: { lowestAskUsd: 500, highestBidUsd: 470, recentSaleMedianUsd: 485, askToSaleSpreadPct: 3.09 },
      askLevels: [
        { bucketIndex: 0, priceLowUsd: 500, priceHighUsd: 520, midPriceUsd: 510, itemCount: 4, cumulativeCount: 4, regionBreakdown: { US: 2, JP: 1, CN: 1, leaked_vendor: 99 } },
      ],
      recentSaleLevels: [
        { bucketIndex: 0, priceLowUsd: 480, priceHighUsd: 495, midPriceUsd: 488, itemCount: 9, cumulativeCount: 9, windowDays: 30, regionBreakdown: { US: 5, JP: 4 } },
      ],
      bidLevels: [
        { bucketIndex: 0, priceLowUsd: 465, priceHighUsd: 470, midPriceUsd: 468, itemCount: 2, cumulativeCount: 2, regionBreakdown: { CARDZ_MKT: 2 } },
      ],
    });
  const topOut = await callTool('get_market_depth', { id: 'cmc_top1', grade: 'PSA10' }, { fetcher: fetcherTop });
  assert.equal(topOut.supported, true);
  assert.equal(topOut.askLevels[0].regionBreakdown.leaked_vendor, undefined);
  assert.deepEqual(topOut.summary.coveredRegions.sort(), ['CARDZ_MKT', 'CN', 'JP', 'US']);
  const validate = ajv.compile(toolSchemas.get_market_depth.output);
  assert.equal(validate(topOut), true, JSON.stringify(validate.errors));

  const fetcherLow = async () => jsonRes({ cardId: 'cmc_rare', cardName: 'Obscure Card', supported: false, snapshotAt: '2026-11-20T00:00:00Z' });
  const lowOut = await callTool('get_market_depth', { id: 'cmc_rare' }, { fetcher: fetcherLow });
  assert.equal(lowOut.supported, false);
  assert.equal(lowOut.liquidityTier, 'untracked');
  assert.deepEqual(lowOut.askLevels, []);
  assert.equal(validate(lowOut), true, JSON.stringify(validate.errors));
});

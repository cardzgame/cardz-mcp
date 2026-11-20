import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { commonSchema, toolSchemas } from '../src/index.mjs';

function makeAjv() {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(commonSchema, 'common.schema.json');
  return ajv;
}

test('T1: all 6 MCP tool input & output schemas compile cleanly in ajv Draft 2020-12 strict mode', () => {
  const ajv = makeAjv();
  for (const [name, bundle] of Object.entries(toolSchemas)) {
    assert.ok(ajv.compile(bundle.input), `${name} input compiled`);
    assert.ok(ajv.compile(bundle.output), `${name} output compiled`);
  }
});

test('T1: input schemas accept valid payloads and reject out-of-bounds / unknown properties', () => {
  const ajv = makeAjv();
  const vSearch = ajv.compile(toolSchemas.search_cards.input);
  assert.equal(vSearch({ q: 'OP05-119', tcg: 'one-piece' }), true);
  assert.equal(vSearch({ q: 'a' }), true); // minLength=1 per unified contract
  assert.equal(vSearch({ q: '' }), false);
  assert.equal(vSearch({ q: 'Charizard', unknownField: 1 }), false);
  assert.equal(vSearch({ q: 'Charizard', limit: 9 }), false);

  const vMarket = ajv.compile(toolSchemas.get_market.input);
  assert.equal(vMarket({ scope: 'all', sortBy: 'vol_30d_usd', limit: 20 }), true);
  assert.equal(vMarket({ scope: 'kpop', sortBy: 'vol_30d_count' }), true);
  assert.equal(vMarket({ sortBy: 'change_30d' }), true);
  assert.equal(vMarket({ limit: 21 }), false);
  assert.equal(vMarket({ sortBy: 'volume_30d' }), false); // deprecated name rejected

  const vOhlcv = ajv.compile(toolSchemas.get_card_ohlcv.input);
  assert.equal(vOhlcv({ id: 'cmc_abc123', interval: '1w', days: 730, region: 'US', from: '2025-01-01', to: '2031-12-31' }), true);
  assert.equal(vOhlcv({ id: 'cmc_abc123', from: '2024-12-31' }), false);
  assert.equal(vOhlcv({ id: 'cmc_abc123', days: 731 }), false);

  const vPortfolio = ajv.compile(toolSchemas.evaluate_portfolio.input);
  assert.equal(vPortfolio({ items: [{ cardId: 'cmc_1', quantity: 2, buyPriceUsd: 100 }] }), true);
  assert.equal(vPortfolio({ items: [{ jlpName: '2023 Pikachu [SV2a 025/165] JP' }, { externalId: 'tcgplayer:518881' }] }), true);
  assert.equal(vPortfolio({ items: [{ externalId: 'private_vendor:999' }] }), false);
  assert.equal(vPortfolio({ items: [] }), false);
  assert.equal(vPortfolio({ items: Array.from({ length: 51 }, (_, i) => ({ cardId: `cmc_${i}` })) }), false);
  assert.equal(vPortfolio({ items: [{ quantity: 1 }] }), false); // requires cardId|externalId|jlpName|name|collectorNumber

  const vCard = ajv.compile(toolSchemas.get_card.input);
  assert.equal(vCard({ id: 'cmc_8149d31b23f05efa50750a0a' }), true);
  assert.equal(vCard({ id: 'snkrdunk:102424' }), true);
  assert.equal(vCard({ id: 'jlp_standard:2023 Pikachu [SV2a 025/165] JP' }), true);
  assert.equal(vCard({ id: 'private_source:123' }), false);
});

test('T1: output schemas accept mixed PriceBasis, indicative ConfidenceTier, and regional depth bands', () => {
  const ajv = makeAjv();
  const vOhlcvOut = ajv.compile(toolSchemas.get_card_ohlcv.output);
  assert.equal(vOhlcvOut({
    source: 'CardZ Marketcap',
    currency: 'USD',
    card: { id: 'cmc_1', name: 'Charizard', collectorNumber: '199/165', tcg: 'pokemon', cardLanguage: 'en', url: 'https://cardzmarketcap.com/card/cmc_1' },
    grade: 'PSA10',
    interval: '1d',
    region: 'GLOBAL',
    seriesStartDate: '2025-01-01',
    effectiveAt: '2026-11-20T00:00:00Z',
    summary: { periodHighUsd: 500, periodLowUsd: 420, periodChangePct: 12.5, totalVolumeUsd: 14500, totalSalesCount: 31, activeTradingDays: 20, totalDaysInWindow: 30 },
    candles: [{
      date: '2026-11-19', openUsd: 450, highUsd: 470, lowUsd: 440, closeUsd: 465, medianUsd: 460,
      volumeUsd: 2300, salesCount: 5, priceBasis: 'mixed', activeMarketsCount: 3, isSyntheticFlat: false
    }],
  }), true);

  const vDepthOut = ajv.compile(toolSchemas.get_market_depth.output);
  assert.equal(vDepthOut({
    source: 'CardZ Marketcap',
    currency: 'USD',
    cardId: 'cmc_1',
    cardName: 'Charizard',
    url: 'https://cardzmarketcap.com/card/cmc_1',
    grade: 'PSA10',
    supported: true,
    unsupportedReason: null,
    snapshotAt: '2026-11-20T00:00:00Z',
    liquidityTier: 'tier1_top100',
    liquidityRank: 3,
    summary: {
      lowestAskUsd: 480, highestBidUsd: null, recentSaleMedianUsd: 460,
      askToSaleSpreadPct: 4.35, totalAskCount: 12, totalRecentSaleCount: 28,
      coveredRegions: ['US', 'JP', 'CN'],
    },
    askLevels: [{ bucketIndex: 0, priceMinUsd: 480, priceMaxUsd: 500, midPriceUsd: 490, itemCount: 5, cumulativeCount: 5, regionBreakdown: { US: 3, JP: 2 } }],
    recentSaleLevels: [{ bucketIndex: 0, priceMinUsd: 450, priceMaxUsd: 470, midPriceUsd: 460, itemCount: 14, cumulativeCount: 14, windowDays: 30, regionBreakdown: { US: 8, JP: 4, CN: 2 } }],
    bidLevels: [],
  }), true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { commonSchema, toolSchemas } from '@cardz/schemas';
import {
  callTool,
  normalizeIdentityClue,
  parseExternalIdentity,
  parseJlpStandardName,
  sanitizeCrossMarketQuotes,
  sanitizeExternalIdentities,
} from '../src/index.mjs';

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
ajv.addSchema(commonSchema, 'common.schema.json');

const jsonRes = (data) =>
  new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('Identity parser: parses JLP standard alias and rejects non-allowlisted namespaces', () => {
  const jlp = parseJlpStandardName('2023 Pikachu [SV2a 025/165] JP');
  assert.deepEqual(jlp, {
    year: 2023,
    cardName: 'Pikachu',
    setCode: 'SV2a',
    collectorNumber: '025/165',
    cardLanguage: 'ja',
  });

  const opJlp = parseJlpStandardName('2024 Monkey D. Luffy [OP05-119] EN');
  assert.equal(opJlp.setCode, 'OP05');
  assert.equal(opJlp.collectorNumber, 'OP05-119');
  assert.equal(opJlp.cardLanguage, 'en');

  assert.deepEqual(parseExternalIdentity('tcgplayer:518881'), { namespace: 'tcgplayer', externalId: '518881' });
  assert.deepEqual(parseExternalIdentity('snkrdunk:102424'), { namespace: 'snkrdunk', externalId: '102424' });
  // Private or unknown namespaces MUST be rejected
  assert.equal(parseExternalIdentity('private_vendor:9999'), null);
  assert.equal(parseExternalIdentity('internal_db:123'), null);

  const clue = normalizeIdentityClue('2023 Pikachu [SV2a 025/165] JP');
  assert.equal(clue.kind, 'jlp_standard');
  assert.equal(clue.setCode, 'SV2a');
  assert.equal(clue.collectorNumber, '025/165');
  assert.equal(clue.cardLanguage, 'ja');
});

test('Identity sanitizer: strips non-allowlisted namespaces and regions from crossMarketQuotes & externalIdentities', () => {
  const ids = sanitizeExternalIdentities([
    { namespace: 'tcgplayer', externalId: '518881', canonicalUrl: 'https://www.tcgplayer.com/product/518881' },
    { namespace: 'snkrdunk', externalId: '102424' },
    { namespace: 'private_source', externalId: 'secret-999' },
  ]);
  assert.equal(ids.length, 2);
  assert.deepEqual(ids.map((i) => i.namespace), ['tcgplayer', 'snkrdunk']);

  const quotes = sanitizeCrossMarketQuotes([
    { region: 'US', verifiedSaleUsd: 480, marketReferenceUsd: 495, nativePrice: 480, nativeCurrency: 'USD', salesCount30d: 18, asOf: '2026-11-19T00:00:00Z', confidence: 'high' },
    { region: 'JP', verifiedSaleUsd: 455, marketReferenceUsd: 465, nativePrice: 70000, nativeCurrency: 'JPY', salesCount30d: 12, asOf: '2026-11-19T00:00:00Z', confidence: 'high' },
    { region: 'CN', verifiedSaleUsd: 460, marketReferenceUsd: 472, nativePrice: 3310, nativeCurrency: 'CNY', salesCount30d: 9, asOf: '2026-11-19T00:00:00Z', confidence: 'medium' },
    { region: 'UNKNOWN_PRIVATE', verifiedSaleUsd: 999, marketReferenceUsd: null, asOf: null, confidence: 'low' },
  ]);
  assert.equal(quotes.length, 3);
  assert.deepEqual(quotes.map((q) => q.region), ['US', 'JP', 'CN']);
});

test('search_cards & get_card: normalize JLP standard alias and public external IDs to canonical card_id with US/JP/CN quotes', async () => {
  let seenSearchUrl = '';
  const searchFetcher = async (url) => {
    seenSearchUrl = url;
    return jsonRes({
      effectiveAt: '2026-11-20T00:00:00Z',
      total: 1,
      hits: [
        {
          id: 'c24b961b6a7701ce5',
          officialName: 'Pikachu',
          collectorNumber: '025/165',
          setName: { en: 'Pokemon Card 151', ja: 'ポケモンカード151' },
          tcg: 'pokemon',
          cardLanguage: 'ja',
          marketRank: 42,
          image: null,
          jlpStandardName: '2023 Pikachu [SV2a 025/165] JP',
          aliases: ['2023 Pikachu [SV2a 025/165] JP', 'ピカチュウ 025/165', '皮卡丘 SV2a 025/165', '피카츄 025/165'],
          externalIdentities: [
            { namespace: 'jlp_standard', externalId: '2023 Pikachu [SV2a 025/165] JP' },
            { namespace: 'snkrdunk', externalId: '102424' },
            { namespace: 'tcgplayer', externalId: '518881' },
            { namespace: 'private_leak', externalId: 'should-be-dropped' },
          ],
          crossMarketQuotes: [
            { region: 'US', verifiedSaleUsd: 35, marketReferenceUsd: 38, nativePrice: 35, nativeCurrency: 'USD', salesCount30d: 14, asOf: '2026-11-19T00:00:00Z', confidence: 'high' },
            { region: 'JP', verifiedSaleUsd: 31, marketReferenceUsd: 33, nativePrice: 4800, nativeCurrency: 'JPY', salesCount30d: 22, asOf: '2026-11-19T00:00:00Z', confidence: 'high' },
            { region: 'CN', verifiedSaleUsd: 32, marketReferenceUsd: 34, nativePrice: 230, nativeCurrency: 'CNY', salesCount30d: 11, asOf: '2026-11-19T00:00:00Z', confidence: 'medium' },
          ],
          pricePsa10: { value: 33, status: 'verified', asOf: '2026-11-19T00:00:00Z', priceBasis: 'verified_sale', confidence: 'high' },
          populationPsa10: { value: 9800, status: 'verified', asOf: '2026-11-19T00:00:00Z' },
          marketCap: { value: 323400, status: 'verified', asOf: '2026-11-19T00:00:00Z' },
        },
      ],
    });
  };

  const searchOut = await callTool('search_cards', { q: '2023 Pikachu [SV2a 025/165] JP' }, { fetcher: searchFetcher });
  assert.ok(seenSearchUrl.includes('setCode=SV2a'));
  assert.ok(seenSearchUrl.includes('collectorNumber=025%2F165'));
  assert.ok(seenSearchUrl.includes('cardLanguage=ja'));
  assert.equal(searchOut.normalizedQuery.kind, 'jlp_standard');
  assert.equal(searchOut.cards[0].id, 'c24b961b6a7701ce5');
  assert.equal(searchOut.cards[0].externalIdentities.length, 3);
  assert.equal(searchOut.cards[0].crossMarketQuotes.length, 3);
  const vSearchOut = ajv.compile(toolSchemas.search_cards.output);
  assert.equal(vSearchOut(searchOut), true, JSON.stringify(vSearchOut.errors));

  // Direct lookup via public namespaced external ID resolves to canonical card_id
  let seenCardUrl = '';
  const cardFetcher = async (url) => {
    seenCardUrl = url;
    return jsonRes({
      id: 'c24b961b6a7701ce5',
      officialName: 'Pikachu',
      collectorNumber: '025/165',
      setName: 'Pokemon Card 151',
      tcg: 'pokemon',
      cardLanguage: 'ja',
      marketRank: 42,
      image: null,
      jlpStandardName: '2023 Pikachu [SV2a 025/165] JP',
      externalIdentities: [{ namespace: 'snkrdunk', externalId: '102424' }],
      crossMarketQuotes: [
        { region: 'US', verifiedSaleUsd: 35, marketReferenceUsd: 38, asOf: '2026-11-19T00:00:00Z', confidence: 'high' },
        { region: 'JP', verifiedSaleUsd: 31, marketReferenceUsd: 33, asOf: '2026-11-19T00:00:00Z', confidence: 'high' },
        { region: 'CN', verifiedSaleUsd: 32, marketReferenceUsd: 34, asOf: '2026-11-19T00:00:00Z', confidence: 'medium' },
      ],
      pricePsa10: { value: 33, status: 'verified', asOf: '2026-11-19T00:00:00Z' },
      populationPsa10: { value: 9800, status: 'verified', asOf: '2026-11-19T00:00:00Z' },
      marketCap: { value: 323400, status: 'verified', asOf: '2026-11-19T00:00:00Z' },
      windows: {},
      historyDaily: [{ at: '2026-11-19T00:00:00Z', priceUsd: 33, priceStatus: 'verified', trackedSalesValueUsd: 99, trackedSalesCount: 3 }],
    });
  };
  const cardOut = await callTool('get_card', { id: 'snkrdunk:102424' }, { fetcher: cardFetcher });
  assert.ok(seenCardUrl.includes('identityNamespace=snkrdunk'));
  assert.ok(seenCardUrl.includes('externalId=102424'));
  assert.equal(cardOut.id, 'c24b961b6a7701ce5');
  assert.equal(cardOut.resolvedFrom, 'external_identity');
  assert.equal(cardOut.crossMarketQuotes.length, 3);
  const vCardOut = ajv.compile(toolSchemas.get_card.output);
  assert.equal(vCardOut(cardOut), true, JSON.stringify(vCardOut.errors));

  // Private namespace rejected at input validation layer
  await assert.rejects(() => callTool('get_card', { id: 'private_vendor:123' }, { fetcher: cardFetcher }), /Invalid id/);
});

test('evaluate_portfolio: resolves JLP standard name, public externalId, and multilingual alias to canonical card_id with cross-market quotes', async () => {
  let seenBody;
  const fetcher = async (_url, init) => {
    seenBody = JSON.parse(init.body);
    return jsonRes({
      evaluatedAt: '2026-11-20T00:00:00Z',
      positions: [
        {
          status: 'matched_priced',
          resolvedFrom: 'jlp_standard',
          matchedCard: { id: 'c24b961b6a7701ce5', name: 'Pikachu', collectorNumber: '025/165', setName: '151', tcg: 'pokemon', cardLanguage: 'ja', jlpStandardName: '2023 Pikachu [SV2a 025/165] JP' },
          unitMarketPriceUsd: 33,
          priceBasis: 'verified_sale',
          priceAsOf: '2026-11-19T00:00:00Z',
          crossMarketQuotes: [
            { region: 'US', verifiedSaleUsd: 35, marketReferenceUsd: 38, asOf: '2026-11-19T00:00:00Z', confidence: 'high' },
            { region: 'JP', verifiedSaleUsd: 31, marketReferenceUsd: 33, asOf: '2026-11-19T00:00:00Z', confidence: 'high' },
            { region: 'CN', verifiedSaleUsd: 32, marketReferenceUsd: 34, asOf: '2026-11-19T00:00:00Z', confidence: 'medium' },
          ],
        },
        {
          status: 'matched_priced',
          resolvedFrom: 'external_identity',
          matchedCard: { id: 'cmc_charizard_199', name: 'Charizard ex', collectorNumber: '199/165', setName: '151', tcg: 'pokemon', cardLanguage: 'en' },
          unitMarketPriceUsd: 500,
          priceBasis: 'verified_sale',
          priceAsOf: '2026-11-19T00:00:00Z',
        },
        {
          status: 'matched_priced',
          resolvedFrom: 'multilingual_alias',
          matchedCard: { id: 'cmc_umbreon_217', name: 'Umbreon ex', collectorNumber: '217/187', setName: 'Terastal Festival ex', tcg: 'pokemon', cardLanguage: 'ja' },
          unitMarketPriceUsd: 380,
          priceBasis: 'verified_sale',
          priceAsOf: '2026-11-19T00:00:00Z',
        },
      ],
    });
  };

  const out = await callTool(
    'evaluate_portfolio',
    {
      items: [
        { jlpName: '2023 Pikachu [SV2a 025/165] JP', quantity: 2, buyPriceUsd: 25 },
        { externalId: 'tcgplayer:518881', quantity: 1, buyPriceUsd: 400 },
        { name: '月亮伊布 ex 217/187', quantity: 1, buyPriceUsd: 350 },
      ],
    },
    { fetcher }
  );

  assert.equal(seenBody.items[0].identityNamespace, 'jlp_standard');
  assert.equal(seenBody.items[0].setCode, 'SV2a');
  assert.equal(seenBody.items[0].collectorNumber, '025/165');
  assert.equal(seenBody.items[0].cardLanguage, 'ja');
  assert.equal(seenBody.items[1].identityNamespace, 'tcgplayer');
  assert.equal(seenBody.items[1].externalIdValue, '518881');

  assert.equal(out.summary.totalMarketValueUsd, 946);
  assert.equal(out.summary.totalCostBasisUsd, 800);
  assert.equal(out.summary.totalUnrealizedPnlUsd, 146);
  assert.equal(out.positions[0].crossMarketQuotes.length, 3);

  const vOut = ajv.compile(toolSchemas.evaluate_portfolio.output);
  assert.equal(vOut(out), true, JSON.stringify(vOut.errors));
});

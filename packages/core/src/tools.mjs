import { toolSchemas } from '@cardz/schemas';
import {
  CANONICAL_SITE,
  DEPTH_REGIONS,
  GRADE_TO_CONDITION_KEY,
  PUBLIC_MCP_ORIGIN,
} from './constants.mjs';
import { requestJson } from './client.mjs';
import {
  normalizeIdentityClue,
  parseExternalIdentity,
  sanitizeAliases,
  sanitizeCrossMarketQuotes,
  sanitizeExternalIdentities,
} from './identity.mjs';
import { validateToolArgs } from './validate.mjs';

const READ_ONLY_ANNOTATIONS = (title) => ({
  title,
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
  idempotentHint: true,
});

function makeTool(name, title, description) {
  return {
    name,
    title,
    description,
    inputSchema: toolSchemas[name].input,
    annotations: READ_ONLY_ANNOTATIONS(title),
    securitySchemes: [{ type: 'noauth' }],
  };
}

export const tools = [
  makeTool(
    'search_cards',
    'Search TCG cards',
    'Search CARDZ by card name, multilingual alias (EN/ZH/JA/KO), collector number, JLP standard alias (e.g. "2023 Pikachu [SV2a 025/165] JP"), or public external ID (e.g. "tcgplayer:518881", "snkrdunk:102424"). Normalizes clues to canonical card_id and returns up to 8 candidates with US/JP/CN cross-market quotes.'
  ),
  makeTool(
    'get_card',
    'Card metrics & history',
    'Read a canonical CARDZ card ID, legacy cmc_* ID, or namespaced public external ID (tcgplayer:*, snkrdunk:*, pricecharting:*, jlp_standard:*): returns PSA 10 reference/verified price, US/JP/CN cross-market side-by-side pricing, external identities, aliases, population, market cap, and daily history.'
  ),
  makeTool(
    'get_market',
    'TCG market rankings',
    'Read CARDZ published market rankings for Pokémon, One Piece, K-pop, Sports, Naruto, or the combined index. Supports market_cap, vol_30d_usd, vol_30d_count, and change_30d sorting up to 20 cards.'
  ),
  makeTool(
    'get_card_ohlcv',
    'Card OHLCV candles & volume',
    'Read 2025+ daily (1d) or edge-aggregated weekly (1w) OHLCV candles, median price, and cross-market sales volume for an exact CARDZ card ID and grade, up to 730 days. Missing trading days remain gaps and are never fabricated.'
  ),
  makeTool(
    'get_market_depth',
    'Top 500 cross-region market depth',
    'Read aggregated cross-region (US, JP, CN, CARDZ_MKT) ask, recent-sale, and bid price bands for Top 500 high-liquidity cards. Returns supported=false for cards outside Top 500 rather than fabricating an order book.'
  ),
  makeTool(
    'evaluate_portfolio',
    'Portfolio valuation & PnL',
    'Batch evaluate up to 50 collectible cards by canonical cardId, namespaced externalId (tcgplayer:*, snkrdunk:*), JLP standard alias (e.g. "2023 Pikachu [SV2a 025/165] JP"), or multilingual search clues. Returns total market value, unrealized PnL, US/JP/CN cross-market quotes, and explicit ambiguity candidates.'
  ),
];

const localized = (value, locale) =>
  typeof value === 'string' ? value : value?.[locale] ?? value?.en ?? null;

export function sanitizePublicImage(image, { proxyOrigin = null } = {}) {
  if (!image || image.kind !== 'raw_front' || typeof image.url !== 'string') return null;
  let pathname = image.url;
  if (pathname.startsWith('https://')) {
    try {
      const parsed = new URL(pathname);
      if (parsed.origin !== CANONICAL_SITE && parsed.origin !== PUBLIC_MCP_ORIGIN) return null;
      pathname = parsed.pathname;
    } catch {
      return null;
    }
  }
  const m = pathname.match(/^\/(?:market-assets|card-art)\/([a-f0-9]{64}(?:_(?:200|600))?\.webp)$/);
  if (!m) return null;
  let filename = m[1];
  const variant = image.variants?.['600'];
  if (typeof variant === 'string' && variant.endsWith('_600.webp')) {
    const vm = variant.match(/([a-f0-9]{64}_600\.webp)$/);
    if (vm) filename = vm[1];
  }
  const url = proxyOrigin ? `${proxyOrigin}/card-art/${filename}` : `${CANONICAL_SITE}/market-assets/${filename}`;
  return {
    url,
    alt: typeof image.alt === 'string' ? image.alt.slice(0, 500) : 'Trading card',
    kind: 'raw_front',
  };
}

function normalizeMetric(value) {
  if (!value || typeof value.status !== 'string') {
    throw new Error('Published metric is unavailable.');
  }
  if (value.value != null && (typeof value.value !== 'number' || !Number.isFinite(value.value))) {
    throw new Error('Invalid published metric.');
  }
  const out = {
    value: value.value ?? null,
    status: value.status,
    asOf: value.asOf ?? null,
  };
  if (value.priceBasis) out.priceBasis = value.priceBasis;
  if (value.confidence) out.confidence = value.confidence;
  return out;
}

function normalizeCardSummary(card, locale, imageOpts) {
  if (!card || typeof card.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(card.id)) {
    throw new Error('Invalid published card.');
  }
  const summary = {
    id: card.id,
    name: localized(card.name, locale) ?? card.officialName,
    officialName: card.officialName ?? localized(card.name, locale) ?? card.id,
    collectorNumber: card.collectorNumber ?? null,
    setName: localized(card.setName, locale),
    tcg: card.tcg ?? card.franchise ?? 'pokemon',
    cardLanguage: card.cardLanguage ?? card.langCode ?? null,
    marketRank: card.marketRank ?? null,
    url: `${CANONICAL_SITE}/card/${card.id}`,
    image: sanitizePublicImage(card.image, imageOpts),
    pricePsa10: normalizeMetric(card.pricePsa10),
    populationPsa10: normalizeMetric(card.populationPsa10),
    marketCap: normalizeMetric(card.marketCap),
  };
  if (card.volume30dUsd) summary.volume30dUsd = normalizeMetric(card.volume30dUsd);
  if (card.salesCount30d !== undefined) summary.salesCount30d = card.salesCount30d;
  if (card.jlpStandardName !== undefined) summary.jlpStandardName = typeof card.jlpStandardName === 'string' ? card.jlpStandardName.slice(0, 240) : null;
  const aliases = sanitizeAliases(card.aliases);
  if (aliases.length) summary.aliases = aliases;
  const externalIdentities = sanitizeExternalIdentities(card.externalIdentities);
  if (externalIdentities.length) summary.externalIdentities = externalIdentities;
  const crossMarketQuotes = sanitizeCrossMarketQuotes(card.crossMarketQuotes);
  if (crossMarketQuotes.length) summary.crossMarketQuotes = crossMarketQuotes;
  return summary;
}

function isoWeekMonday(dateStr) {
  const dt = new Date(`${dateStr}T00:00:00Z`);
  const day = dt.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + offset);
  return dt.toISOString().slice(0, 10);
}

export function aggregateDailyToWeekly(dailyCandles) {
  const sorted = [...dailyCandles].sort((a, b) => a.date.localeCompare(b.date));
  const groups = new Map();
  for (const c of sorted) {
    const key = isoWeekMonday(c.date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const weekly = [];
  for (const [weekStart, list] of groups.entries()) {
    const priced = list.filter((x) => typeof x.closeUsd === 'number');
    const opens = list.filter((x) => typeof x.openUsd === 'number');
    const highs = list.map((x) => x.highUsd).filter((n) => typeof n === 'number');
    const lows = list.map((x) => x.lowUsd).filter((n) => typeof n === 'number');
    const medians = list.map((x) => x.medianUsd).filter((n) => typeof n === 'number').sort((a, b) => a - b);
    const vols = list.map((x) => x.volumeUsd).filter((n) => typeof n === 'number');
    const totalSales = list.reduce((s, x) => s + (x.salesCount ?? 0), 0);
    const bases = new Set(list.map((x) => x.priceBasis).filter(Boolean));
    const priceBasis = bases.size === 0 ? 'unavailable' : bases.size === 1 ? [...bases][0] : 'mixed';
    const midIdx = Math.floor(medians.length / 2);
    const medianUsd = medians.length === 0 ? null : medians.length % 2 === 1 ? medians[midIdx] : Number(((medians[midIdx - 1] + medians[midIdx]) / 2).toFixed(2));
    weekly.push({
      date: weekStart,
      openUsd: opens.length ? opens[0].openUsd : null,
      highUsd: highs.length ? Math.max(...highs) : null,
      lowUsd: lows.length ? Math.min(...lows) : null,
      closeUsd: priced.length ? priced.at(-1).closeUsd : null,
      medianUsd,
      vwapUsd: null,
      volumeUsd: vols.length ? Number(vols.reduce((a, b) => a + b, 0).toFixed(2)) : null,
      salesCount: totalSales,
      priceBasis,
      activeMarketsCount: Math.max(0, ...list.map((x) => x.activeMarketsCount ?? 0)),
      isSyntheticFlat: list.every((x) => Boolean(x.isSyntheticFlat)),
    });
  }
  return weekly;
}

function sanitizeRegionBreakdown(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const region of DEPTH_REGIONS) {
    if (Number.isInteger(raw[region]) && raw[region] >= 0) {
      out[region] = raw[region];
    }
  }
  return out;
}

function round2(n) {
  return Number(n.toFixed(2));
}

export async function callTool(name, args = {}, options = {}) {
  const definition = tools.find((t) => t.name === name);
  if (!definition) throw new Error('Unknown tool.');
  validateToolArgs(definition, args);

  const locale = args.lang ?? 'en';
  const reqOpts = {
    apiBase: options.apiBase,
    apiKey: options.apiKey ?? null,
    fetcher: options.fetcher ?? fetch,
  };
  const imageOpts = { proxyOrigin: options.proxyOrigin ?? null };

  if (name === 'search_cards') {
    const limit = args.limit ?? 8;
    const normalized = normalizeIdentityClue(args.q, args.externalNamespace ?? null);
    const result = await requestJson({
      ...reqOpts,
      path: '/v2/cards/search',
      query: {
        q: normalized.cardName ?? args.q.trim(),
        lang: locale,
        limit,
        franchise: args.tcg,
        cardLanguage: args.cardLanguage ?? normalized.cardLanguage ?? undefined,
        externalNamespace: normalized.namespace ?? undefined,
        externalId: normalized.externalId ?? undefined,
        setCode: normalized.setCode ?? undefined,
        collectorNumber: normalized.collectorNumber ?? undefined,
        releaseYear: normalized.year ?? undefined,
      },
    });
    const hits = result.hits ?? result.cards;
    if (!Array.isArray(hits) || typeof result.effectiveAt !== 'string') {
      throw new Error('Invalid published search response.');
    }
    return {
      source: 'CardZ Marketcap',
      currency: 'USD',
      effectiveAt: result.effectiveAt,
      totalMatches: result.total ?? result.totalMatches ?? hits.length,
      needsDisambiguation: hits.length > 1,
      normalizedQuery: normalized,
      cards: hits.slice(0, limit).map((c) => normalizeCardSummary(c, locale, imageOpts)),
    };
  }

  if (name === 'get_market') {
    const scope = args.scope ?? 'all';
    const limit = args.limit ?? 10;
    const sortBy = args.sortBy ?? 'market_cap';
    const result = await requestJson({
      ...reqOpts,
      path: '/v2/market/rankings',
      query: { franchise: scope, sort: sortBy, limit, lang: locale },
    });
    if (!Array.isArray(result.cards) || typeof result.effectiveAt !== 'string') {
      throw new Error('Invalid published ranking response.');
    }
    return {
      source: 'CardZ Marketcap',
      url: `${CANONICAL_SITE}/api/v1/market?scope=${encodeURIComponent(scope)}`,
      currency: 'USD',
      effectiveAt: result.effectiveAt,
      scope,
      sortBy,
      publishedRankedCount: result.count ?? result.publishedRankedCount ?? result.cards.length,
      cards: result.cards.slice(0, limit).map((c) => normalizeCardSummary(c, locale, imageOpts)),
    };
  }

  if (name === 'get_card') {
    const grade = args.grade ?? 'PSA10';
    const parsedExt = parseExternalIdentity(args.id);
    const card = await requestJson({
      ...reqOpts,
      path: `/v2/cards/${encodeURIComponent(args.id)}`,
      query: {
        condition: GRADE_TO_CONDITION_KEY[grade],
        lang: locale,
        ...(parsedExt ? { identityNamespace: parsedExt.namespace, externalId: parsedExt.externalId } : {}),
      },
    });
    const validResolved = Boolean(card && typeof card.id === 'string' && (card.id === args.id || parsedExt || args.id.startsWith('cmc_')));
    if (!validResolved || !Array.isArray(card.historyDaily)) {
      throw new Error('Invalid published card response.');
    }
    const history = card.historyDaily;
    const timestamps = history.map((p) => Date.parse(p.at)).filter(Number.isFinite);
    const latest = timestamps.length ? Math.max(...timestamps) : NaN;
    const days = args.historyDays ?? 90;
    const cutoff = Number.isFinite(latest) ? latest - (days - 1) * 86_400_000 : -Infinity;
    const resolvedFrom = parsedExt
      ? (parsedExt.namespace === 'jlp_standard' ? 'jlp_standard' : 'external_identity')
      : (card.id !== args.id ? 'legacy_alias' : 'canonical_id');
    const out = {
      source: 'CardZ Marketcap',
      currency: 'USD',
      resolvedFrom,
      ...normalizeCardSummary(card, locale, imageOpts),
      windows: card.windows ?? {},
      historyDays: days,
      historyThrough: Number.isFinite(latest) ? new Date(latest).toISOString() : null,
      historyDaily: history
        .filter((p) => !Number.isFinite(latest) || Date.parse(p.at) >= cutoff)
        .map((p) => ({
          at: p.at,
          priceUsd: p.priceUsd ?? null,
          priceStatus: p.priceStatus ?? 'unavailable',
          trackedSalesValueUsd: p.trackedSalesValueUsd ?? null,
          trackedSalesCount: p.trackedSalesCount ?? null,
        })),
    };
    if (card.quotesByGrade) out.quotesByGrade = card.quotesByGrade;
    if (typeof card.hasOrderBookDepth === 'boolean') out.hasOrderBookDepth = card.hasOrderBookDepth;
    return out;
  }

  if (name === 'get_card_ohlcv') {
    const grade = args.grade ?? 'PSA10';
    const interval = args.interval ?? '1d';
    const region = args.region ?? 'GLOBAL';
    const days = args.days ?? 90;
    const data = await requestJson({
      ...reqOpts,
      path: `/v2/cards/${encodeURIComponent(args.id)}/ohlcv`,
      query: {
        condition: GRADE_TO_CONDITION_KEY[grade],
        region,
        days: args.from ? undefined : days,
        from: args.from,
        to: args.to,
        lang: locale,
      },
    });
    if (!data?.card || !Array.isArray(data.candles)) {
      throw new Error('Invalid published OHLCV response.');
    }
    const daily = data.candles.map((c) => ({
      date: c.date ?? c.tradeDate,
      openUsd: c.openUsd ?? null,
      highUsd: c.highUsd ?? null,
      lowUsd: c.lowUsd ?? null,
      closeUsd: c.closeUsd ?? null,
      medianUsd: c.medianUsd ?? null,
      vwapUsd: c.vwapUsd ?? null,
      volumeUsd: c.volumeUsd ?? null,
      salesCount: c.salesCount ?? c.volumeCount ?? 0,
      priceBasis: c.priceBasis ?? 'unavailable',
      activeMarketsCount: c.activeMarketsCount ?? c.activeVenues ?? 0,
      isSyntheticFlat: Boolean(c.isSyntheticFlat),
    }));
    const candles = interval === '1w' ? aggregateDailyToWeekly(daily) : daily;
    const highs = candles.map((c) => c.highUsd).filter((n) => typeof n === 'number');
    const lows = candles.map((c) => c.lowUsd).filter((n) => typeof n === 'number');
    const closes = candles.map((c) => c.closeUsd).filter((n) => typeof n === 'number');
    const vols = candles.map((c) => c.volumeUsd).filter((n) => typeof n === 'number');
    const totalSalesCount = candles.reduce((sum, c) => sum + (c.salesCount ?? 0), 0);
    const activeTradingDays = daily.filter((c) => (c.salesCount ?? 0) > 0).length;
    const firstClose = closes.length >= 2 ? closes[0] : null;
    const lastClose = closes.length >= 2 ? closes.at(-1) : null;
    const periodChangePct = firstClose && firstClose > 0 && lastClose != null ? round2(((lastClose - firstClose) / firstClose) * 100) : null;

    return {
      source: 'CardZ Marketcap',
      currency: 'USD',
      card: {
        id: data.card.id,
        name: localized(data.card.name, locale) ?? data.card.officialName ?? data.card.id,
        collectorNumber: data.card.collectorNumber ?? null,
        tcg: data.card.tcg ?? data.card.franchise ?? 'pokemon',
        cardLanguage: data.card.cardLanguage ?? null,
        url: `${CANONICAL_SITE}/card/${data.card.id}`,
      },
      grade,
      interval,
      region,
      seriesStartDate: data.seriesStartDate ?? (daily[0]?.date ?? null),
      effectiveAt: data.effectiveAt,
      summary: {
        periodHighUsd: highs.length ? Math.max(...highs) : null,
        periodLowUsd: lows.length ? Math.min(...lows) : null,
        periodChangePct,
        totalVolumeUsd: vols.length ? round2(vols.reduce((a, b) => a + b, 0)) : null,
        totalSalesCount,
        activeTradingDays,
        totalDaysInWindow: data.totalDaysInWindow ?? daily.length,
      },
      candles,
    };
  }

  if (name === 'get_market_depth') {
    const grade = args.grade ?? 'PSA10';
    const maxLevels = args.maxLevels ?? 10;
    const data = await requestJson({
      ...reqOpts,
      path: `/v2/cards/${encodeURIComponent(args.id)}/depth`,
      query: { condition: GRADE_TO_CONDITION_KEY[grade], maxLevels, lang: locale },
    });
    const base = {
      source: 'CardZ Marketcap',
      currency: 'USD',
      cardId: data.cardId ?? args.id,
      cardName: localized(data.cardName, locale) ?? data.cardId ?? args.id,
      url: `${CANONICAL_SITE}/card/${data.cardId ?? args.id}`,
      grade,
      supported: Boolean(data.supported),
      unsupportedReason: data.supported ? null : (data.unsupportedReason ?? 'Card is outside Top 500 liquid cards. Use get_card or get_card_ohlcv instead.'),
      snapshotAt: data.snapshotAt ?? new Date().toISOString(),
      liquidityTier: data.supported ? (data.liquidityTier ?? 'tier2_top500') : 'untracked',
      liquidityRank: data.supported ? (data.liquidityRank ?? null) : null,
    };
    if (!base.supported) {
      return { ...base, summary: null, askLevels: [], recentSaleLevels: [], bidLevels: [] };
    }
    const mapBand = (b, withWindow = false) => ({
      bucketIndex: b.bucketIndex,
      priceMinUsd: b.priceMinUsd ?? b.priceLowUsd,
      priceMaxUsd: b.priceMaxUsd ?? b.priceHighUsd,
      midPriceUsd: b.midPriceUsd,
      itemCount: b.itemCount,
      cumulativeCount: b.cumulativeCount,
      ...(withWindow ? { windowDays: b.windowDays ?? 30 } : {}),
      regionBreakdown: sanitizeRegionBreakdown(b.regionBreakdown),
    });
    const askLevels = (data.askLevels ?? []).slice(0, maxLevels).map((b) => mapBand(b));
    const recentSaleLevels = (data.recentSaleLevels ?? []).slice(0, maxLevels).map((b) => mapBand(b, true));
    const bidLevels = (data.bidLevels ?? []).slice(0, maxLevels).map((b) => mapBand(b));
    const regionSet = new Set();
    for (const lvl of [...askLevels, ...recentSaleLevels, ...bidLevels]) {
      for (const [reg, cnt] of Object.entries(lvl.regionBreakdown)) {
        if (cnt > 0 && DEPTH_REGIONS.includes(reg)) regionSet.add(reg);
      }
    }
    return {
      ...base,
      summary: {
        lowestAskUsd: data.summary?.lowestAskUsd ?? (askLevels[0]?.priceMinUsd ?? null),
        highestBidUsd: data.summary?.highestBidUsd ?? (bidLevels[0]?.priceMaxUsd ?? null),
        recentSaleMedianUsd: data.summary?.recentSaleMedianUsd ?? null,
        askToSaleSpreadPct: data.summary?.askToSaleSpreadPct ?? null,
        totalAskCount: data.summary?.totalAskCount ?? askLevels.reduce((s, x) => s + x.itemCount, 0),
        totalRecentSaleCount: data.summary?.totalRecentSaleCount ?? recentSaleLevels.reduce((s, x) => s + x.itemCount, 0),
        coveredRegions: [...regionSet],
      },
      askLevels,
      recentSaleLevels,
      bidLevels,
    };
  }

  // evaluate_portfolio
  const pricePreference = args.pricePreference ?? 'verified_first';
  const payloadItems = args.items.map((item) => {
    const clueSource = item.externalId ?? item.jlpName ?? item.name ?? '';
    const parsed = item.cardId ? null : normalizeIdentityClue(clueSource);
    return {
      ...item,
      grade: item.grade ?? 'PSA10',
      conditionKey: GRADE_TO_CONDITION_KEY[item.grade ?? 'PSA10'],
      quantity: item.quantity ?? 1,
      ...(parsed?.namespace ? { identityNamespace: parsed.namespace, externalIdValue: parsed.externalId } : {}),
      ...(parsed?.setCode && !item.setName ? { setCode: parsed.setCode } : {}),
      ...(parsed?.collectorNumber && !item.collectorNumber ? { collectorNumber: parsed.collectorNumber } : {}),
      ...(parsed?.cardLanguage && !item.cardLanguage ? { cardLanguage: parsed.cardLanguage } : {}),
      ...(parsed?.year ? { releaseYear: parsed.year } : {}),
      ...(parsed?.kind === 'jlp_standard' && parsed.cardName ? { name: parsed.cardName } : {}),
    };
  });
  const data = await requestJson({
    ...reqOpts,
    method: 'POST',
    path: '/v2/portfolio/evaluate',
    body: { items: payloadItems, lang: locale, pricePreference },
  });
  if (!Array.isArray(data?.positions)) {
    throw new Error('Invalid published portfolio evaluation response.');
  }

  let pricedItemsCount = 0;
  let ambiguousItemsCount = 0;
  let unmatchedItemsCount = 0;
  let unpricedItemsCount = 0;
  let referencePricedItemsCount = 0;
  let totalMarketValue = 0;
  let pairedMarketValueForPnl = 0;
  let totalCostBasis = 0;
  let pairedCostCount = 0;

  const positions = data.positions.map((pos, idx) => {
    const inputItem = payloadItems[idx] ?? {};
    const quantity = pos.quantity ?? inputItem.quantity ?? 1;
    const grade = pos.grade ?? inputItem.grade ?? 'PSA10';
    const unitBuyPriceUsd = typeof inputItem.buyPriceUsd === 'number' ? inputItem.buyPriceUsd : null;

    let status = pos.status;
    let unitMarketPriceUsd = typeof pos.unitMarketPriceUsd === 'number' && Number.isFinite(pos.unitMarketPriceUsd) ? pos.unitMarketPriceUsd : null;
    let priceBasis = pos.priceBasis ?? 'unavailable';

    if (pricePreference === 'verified_only' && status === 'matched_priced' && priceBasis !== 'verified_sale') {
      status = 'matched_unpriced';
      unitMarketPriceUsd = null;
      priceBasis = 'unavailable';
    }

    let positionMarketValueUsd = null;
    let positionCostBasisUsd = null;
    let unrealizedPnlUsd = null;
    let unrealizedPnlPct = null;

    if (status === 'matched_priced' && unitMarketPriceUsd !== null) {
      pricedItemsCount++;
      if (priceBasis === 'market_reference') referencePricedItemsCount++;
      positionMarketValueUsd = round2(unitMarketPriceUsd * quantity);
      totalMarketValue += positionMarketValueUsd;
      if (unitBuyPriceUsd !== null) {
        positionCostBasisUsd = round2(unitBuyPriceUsd * quantity);
        unrealizedPnlUsd = round2(positionMarketValueUsd - positionCostBasisUsd);
        unrealizedPnlPct = positionCostBasisUsd > 0 ? round2((unrealizedPnlUsd / positionCostBasisUsd) * 100) : null;
        totalCostBasis += positionCostBasisUsd;
        pairedMarketValueForPnl += positionMarketValueUsd;
        pairedCostCount++;
      }
    } else if (status === 'ambiguous') {
      ambiguousItemsCount++;
    } else if (status === 'not_found') {
      unmatchedItemsCount++;
    } else {
      status = 'matched_unpriced';
      unpricedItemsCount++;
    }

    const resolvedFrom =
      pos.resolvedFrom ??
      (inputItem.cardId
        ? 'canonical_id'
        : inputItem.identityNamespace === 'jlp_standard'
          ? 'jlp_standard'
          : inputItem.identityNamespace
            ? 'external_identity'
            : 'fuzzy_clue');
    const crossMarketQuotes = sanitizeCrossMarketQuotes(pos.crossMarketQuotes);

    const outPos = {
      index: idx,
      itemRef: inputItem.itemRef ?? pos.itemRef ?? null,
      status,
      resolvedFrom,
      grade,
      quantity,
      matchedCard: pos.matchedCard
        ? {
            id: pos.matchedCard.id,
            name: localized(pos.matchedCard.name, locale) ?? pos.matchedCard.officialName ?? pos.matchedCard.id,
            collectorNumber: pos.matchedCard.collectorNumber ?? null,
            setName: localized(pos.matchedCard.setName, locale),
            tcg: pos.matchedCard.tcg ?? 'pokemon',
            cardLanguage: pos.matchedCard.cardLanguage ?? null,
            ...(pos.matchedCard.jlpStandardName !== undefined ? { jlpStandardName: pos.matchedCard.jlpStandardName } : {}),
            url: `${CANONICAL_SITE}/card/${pos.matchedCard.id}`,
          }
        : null,
      unitMarketPriceUsd,
      priceBasis,
      priceAsOf: unitMarketPriceUsd !== null ? (pos.priceAsOf ?? null) : null,
      positionMarketValueUsd,
      unitBuyPriceUsd,
      positionCostBasisUsd,
      unrealizedPnlUsd,
      unrealizedPnlPct,
      ...(crossMarketQuotes.length ? { crossMarketQuotes } : {}),
      message: pos.message ?? (status === 'ambiguous' ? 'Multiple printings matched. Confirm an exact cardId from candidates and re-evaluate.' : null),
    };

    if (status === 'ambiguous' && Array.isArray(pos.candidates)) {
      outPos.candidates = pos.candidates.slice(0, 5).map((c) => ({
        id: c.id,
        name: localized(c.name, locale) ?? c.officialName ?? c.id,
        collectorNumber: c.collectorNumber ?? null,
        setName: localized(c.setName, locale),
        cardLanguage: c.cardLanguage ?? null,
        tcg: c.tcg ?? 'pokemon',
        ...(c.jlpStandardName !== undefined ? { jlpStandardName: c.jlpStandardName } : {}),
        url: `${CANONICAL_SITE}/card/${c.id}`,
        referencePriceUsd: typeof c.referencePriceUsd === 'number' ? c.referencePriceUsd : null,
      }));
    }
    return outPos;
  });

  const totalSubmitted = payloadItems.length;
  const totalUnrealizedPnlUsd = pairedCostCount > 0 ? round2(pairedMarketValueForPnl - totalCostBasis) : null;
  const totalUnrealizedPnlPct = pairedCostCount > 0 && totalCostBasis > 0 ? round2((totalUnrealizedPnlUsd / totalCostBasis) * 100) : null;

  return {
    source: 'CardZ Marketcap',
    currency: 'USD',
    evaluatedAt: data.evaluatedAt ?? new Date().toISOString(),
    pricePreference,
    summary: {
      totalItemsSubmitted: totalSubmitted,
      pricedItemsCount,
      ambiguousItemsCount,
      unmatchedItemsCount,
      unpricedItemsCount,
      valuationCoveragePct: round2((pricedItemsCount / totalSubmitted) * 100),
      totalMarketValueUsd: pricedItemsCount > 0 ? round2(totalMarketValue) : null,
      totalCostBasisUsd: pairedCostCount > 0 ? round2(totalCostBasis) : null,
      totalUnrealizedPnlUsd,
      totalUnrealizedPnlPct,
      referencePricedItemsCount,
    },
    positions,
    disambiguationRequired: ambiguousItemsCount > 0,
    disclaimer: 'Values are dated USD market observations, not live executable bids or financial advice. Unpriced, unmatched, and ambiguous items are excluded from totals rather than counted as zero.',
  };
}

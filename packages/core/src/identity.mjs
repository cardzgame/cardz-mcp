export const PUBLIC_IDENTITY_NAMESPACES = Object.freeze([
  'jlp_standard',
  'tcgplayer',
  'snkrdunk',
  'pricecharting',
  'cmc',
  'psa_spec',
  'official_dex',
]);

const NAMESPACE_SET = new Set(PUBLIC_IDENTITY_NAMESPACES);
const ALLOWED_REGIONS = new Set(['US', 'JP', 'CN', 'CARDZ_MKT']);
const ALLOWED_CURRENCIES = new Set(['USD', 'JPY', 'CNY', 'HKD', 'KRW']);
const ALLOWED_CONFIDENCE = new Set(['high', 'medium', 'low', 'indicative', 'unavailable']);

const LANG_TOKEN_MAP = Object.freeze({
  JP: 'ja',
  JA: 'ja',
  JPN: 'ja',
  EN: 'en',
  ENG: 'en',
  US: 'en',
  CN: 'zh',
  ZH: 'zh',
  TC: 'zh',
  SC: 'zh',
  ZHTW: 'zh',
  ZHCN: 'zh',
  KR: 'ko',
  KO: 'ko',
  KOR: 'ko',
});

// Pure deterministic JLP standard alias parser:
// e.g. "2023 Pikachu [SV2a 025/165] JP", "2024 Monkey D. Luffy [OP05-119] EN", "Pikachu [SV2a 025/165]"
const JLP_BRACKET_RE = /^(?:(?<year>199\d|20\d{2})\s+)?(?<name>[^[\]]+?)\s*\[(?<bracket>[^[\]]+)\](?:\s+(?<lang>JP|JA|JPN|EN|ENG|US|CN|ZH|TC|SC|ZHTW|ZHCN|KR|KO|KOR))?$/i;

export function parseExternalIdentity(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const idx = trimmed.indexOf(':');
  if (idx <= 0) return null;
  const ns = trimmed.slice(0, idx).toLowerCase();
  const value = trimmed.slice(idx + 1).trim();
  if (!NAMESPACE_SET.has(ns) || !value || value.length > 128) return null;
  return { namespace: ns, externalId: value };
}

export function parseJlpStandardName(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  const m = trimmed.match(JLP_BRACKET_RE);
  if (!m?.groups) return null;

  const year = m.groups.year ? Number.parseInt(m.groups.year, 10) : null;
  const cardName = m.groups.name.trim();
  const bracket = m.groups.bracket.trim().replace(/\s+/g, ' ');
  const langToken = m.groups.lang ? m.groups.lang.toUpperCase() : null;
  const cardLanguage = langToken ? (LANG_TOKEN_MAP[langToken] ?? null) : null;

  let setCode = null;
  let collectorNumber = null;
  const tokens = bracket.split(' ');
  if (tokens.length >= 2) {
    setCode = tokens[0];
    collectorNumber = tokens.slice(1).join(' ');
  } else if (/^[A-Za-z]{1,6}\d{1,3}-\d{1,4}[A-Za-z]?$/.test(bracket)) {
    // e.g. OP05-119 -> setCode=OP05, collectorNumber=OP05-119
    setCode = bracket.split('-')[0];
    collectorNumber = bracket;
  } else {
    collectorNumber = bracket;
  }

  return {
    year,
    cardName: cardName || null,
    setCode,
    collectorNumber,
    cardLanguage,
  };
}

export function normalizeIdentityClue(rawQuery, explicitNamespace = null) {
  const raw = typeof rawQuery === 'string' ? rawQuery.trim() : '';
  if (explicitNamespace && NAMESPACE_SET.has(explicitNamespace.toLowerCase()) && raw) {
    return {
      raw,
      kind: 'external_id',
      namespace: explicitNamespace.toLowerCase(),
      externalId: raw,
      year: null,
      setCode: null,
      collectorNumber: null,
      cardLanguage: null,
      cardName: null,
    };
  }

  const ext = parseExternalIdentity(raw);
  if (ext) {
    const jlpInner = ext.namespace === 'jlp_standard' ? parseJlpStandardName(ext.externalId) : null;
    return {
      raw,
      kind: ext.namespace === 'jlp_standard' ? 'jlp_standard' : 'external_id',
      namespace: ext.namespace,
      externalId: ext.externalId,
      year: jlpInner?.year ?? null,
      setCode: jlpInner?.setCode ?? null,
      collectorNumber: jlpInner?.collectorNumber ?? null,
      cardLanguage: jlpInner?.cardLanguage ?? null,
      cardName: jlpInner?.cardName ?? null,
    };
  }

  const jlp = parseJlpStandardName(raw);
  if (jlp) {
    return {
      raw,
      kind: 'jlp_standard',
      namespace: 'jlp_standard',
      externalId: raw,
      ...jlp,
    };
  }

  return {
    raw,
    kind: 'free_text',
    namespace: null,
    externalId: null,
    year: null,
    setCode: null,
    collectorNumber: null,
    cardLanguage: null,
    cardName: raw || null,
  };
}

export function sanitizeExternalIdentities(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const ns = typeof item.namespace === 'string' ? item.namespace.toLowerCase() : '';
    const externalId = typeof item.externalId === 'string' ? item.externalId.trim() : '';
    if (!NAMESPACE_SET.has(ns) || !externalId || externalId.length > 128) continue;
    const key = `${ns}:${externalId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let canonicalUrl = null;
    if (typeof item.canonicalUrl === 'string' && item.canonicalUrl.startsWith('https://')) {
      try {
        const u = new URL(item.canonicalUrl);
        if (!u.username && !u.password) canonicalUrl = u.href;
      } catch {
        canonicalUrl = null;
      }
    }

    out.push({
      namespace: ns,
      externalId,
      displayLabel: typeof item.displayLabel === 'string' ? item.displayLabel.slice(0, 200) : null,
      canonicalUrl,
    });
    if (out.length >= 16) break;
  }
  return out;
}

export function sanitizeCrossMarketQuotes(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const region = typeof item.region === 'string' ? item.region.toUpperCase() : '';
    if (!ALLOWED_REGIONS.has(region) || seen.has(region)) continue;
    seen.add(region);

    const verifiedSaleUsd = typeof item.verifiedSaleUsd === 'number' && Number.isFinite(item.verifiedSaleUsd) ? item.verifiedSaleUsd : null;
    const marketReferenceUsd = typeof item.marketReferenceUsd === 'number' && Number.isFinite(item.marketReferenceUsd) ? item.marketReferenceUsd : null;
    const nativePrice = typeof item.nativePrice === 'number' && Number.isFinite(item.nativePrice) ? item.nativePrice : null;
    const nativeCurrency = typeof item.nativeCurrency === 'string' && ALLOWED_CURRENCIES.has(item.nativeCurrency.toUpperCase())
      ? item.nativeCurrency.toUpperCase()
      : null;
    const salesCount30d = Number.isInteger(item.salesCount30d) && item.salesCount30d >= 0 ? item.salesCount30d : null;
    const confidence = typeof item.confidence === 'string' && ALLOWED_CONFIDENCE.has(item.confidence)
      ? item.confidence
      : 'unavailable';

    out.push({
      region,
      verifiedSaleUsd,
      marketReferenceUsd,
      nativePrice,
      nativeCurrency,
      salesCount30d,
      asOf: typeof item.asOf === 'string' ? item.asOf : null,
      confidence,
    });
  }
  return out;
}

export function sanitizeAliases(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const cleaned = item.trim().slice(0, 240);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= 20) break;
  }
  return out;
}

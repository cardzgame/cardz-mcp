export const CANONICAL_SITE = 'https://cardzmarketcap.com';
export const DEFAULT_API_BASE = 'https://api.cardzmarketcap.com';
export const PUBLIC_MCP_ORIGIN = 'https://mcp.cardz.game';

export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
export const SERVER_INFO = {
  name: 'cardz-mcp',
  version: '2.0.0',
  title: 'CARDZ',
};

export const API_KEY_PATTERN = /^cz_live_[A-Za-z0-9]{8}_[A-Za-z0-9]{32,48}$/;

export const DISPLAY_LANGUAGES = ['en', 'zh-TW', 'ja', 'ko'];
export const CARD_LANGUAGES = ['en', 'ja', 'zh', 'ko'];
export const IP_SCOPES = ['pokemon', 'one-piece', 'kpop', 'sports', 'naruto'];
export const MARKET_SCOPES = ['all', ...IP_SCOPES];
export const RANKING_SORTS = ['market_cap', 'vol_30d_usd', 'vol_30d_count', 'change_30d'];
export const GRADE_CODES = ['PSA10', 'PSA9', 'PSA8', 'BGS10', 'BGS9.5', 'CGC10', 'RAW'];
export const DEPTH_GRADES = ['PSA10', 'PSA9', 'RAW'];
export const MARKET_REGIONS = ['GLOBAL', 'US', 'JP', 'CN', 'CARDZ_MKT'];
export const DEPTH_REGIONS = ['US', 'JP', 'CN', 'CARDZ_MKT'];

export const GRADE_TO_CONDITION_KEY = Object.freeze({
  PSA10: 'graded:PSA:10',
  PSA9: 'graded:PSA:9',
  PSA8: 'graded:PSA:8',
  CGC10: 'graded:CGC:10',
  'BGS9.5': 'graded:BGS:9.5',
  BGS10: 'graded:BGS:10:black',
  RAW: 'raw:ungraded',
});

export const INSTRUCTIONS = [
  'Use these tools only for CARDZ public collectible-card and TCG market data.',
  'Cite canonical CARDZ card URLs and original metric asOf dates.',
  'Values are in USD; never convert currencies or replace null with zero.',
  'Distinguish verified cross-market sale prices (verified_sale) from market reference listings (market_reference).',
  'Never combine different printings or silently guess when search_cards or evaluate_portfolio reports ambiguity; ask the user to confirm.',
  'This service is strictly read-only: provide no trading, purchase, pack-opening, bidding, wallet, or shipping actions.',
].join(' ');

export function validateApiKeyFormat(key) {
  return typeof key === 'string' && API_KEY_PATTERN.test(key.trim()) ? key.trim() : null;
}

export function extractValidatedApiKey(headers) {
  if (!headers) return null;
  const get = (name) => (typeof headers.get === 'function' ? headers.get(name) : headers[name] ?? headers[name.toLowerCase()]);
  const auth = get('authorization');
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return validateApiKeyFormat(auth.slice(7));
  }
  const xKey = get('x-api-key');
  if (typeof xKey === 'string') {
    return validateApiKeyFormat(xKey);
  }
  return null;
}

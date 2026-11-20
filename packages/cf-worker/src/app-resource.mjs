export const APP_URI = 'ui://cardz-marketcap/cardz-2.0.0.html';
export const LEGACY_APP_URIS = [
  'ui://cardz-marketcap/cardz-1.1.5.html',
  'ui://cardz-marketcap/cardz-1.1.4.html',
  'ui://cardz-marketcap/market-data-v1.1.5.html',
  'ui://cardz-marketcap/market-data-v1.1.4-2.html',
  'ui://cardz-marketcap/market-data-v1.1.4.html',
  'ui://cardz-marketcap/market-data-v1.1.3.html',
  'ui://cardz-marketcap/market-data-v1.1.2.html',
  'ui://cardz-marketcap/market-data-v1.1.1.html',
  'ui://cardz-marketcap/market-data-v1.html',
];

const MIME_TYPE = 'text/html;profile=mcp-app';

const RESOURCE_META = {
  ui: {
    prefersBorder: true,
    csp: { connectDomains: [], resourceDomains: ['https://mcp.cardz.game'] },
  },
  'openai/widgetDescription':
    'CARDZ collectibles and trading-card market data: exact-printing search, verified vs reference USD prices, 2025+ OHLCV candles, Top 500 market depth, rankings, and portfolio valuation.',
};

export const APP_TOOL_META = {
  ui: { resourceUri: APP_URI, visibility: ['model', 'app'] },
  'ui/resourceUri': APP_URI,
  'openai/outputTemplate': APP_URI,
  'openai/widgetAccessible': true,
};

export const APP_RESOURCE = {
  uri: APP_URI,
  name: 'CARDZ',
  title: 'CARDZ · Collectibles & TCG',
  description:
    'Interactive CARDZ market data viewer supporting exact-printing search, 2025+ OHLCV candles, Top 500 market depth, rankings, and portfolio PnL.',
  mimeType: MIME_TYPE,
  _meta: RESOURCE_META,
};

export async function readAppResource(body, request, appHtml) {
  const meta = { ...RESOURCE_META, ui: { ...RESOURCE_META.ui } };
  if (request.headers.get('User-Agent') === 'Claude-User') {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(request.url)));
    meta.ui.domain = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32) + '.claudemcpcontent.com';
  }
  const result =
    body.method === 'resources/list'
      ? { resources: [{ ...APP_RESOURCE, _meta: meta }] }
      : body.method === 'resources/templates/list'
        ? { resourceTemplates: [] }
        : [APP_URI, ...LEGACY_APP_URIS].includes(body.params?.uri)
          ? { contents: [{ uri: body.params.uri, mimeType: MIME_TYPE, text: appHtml, _meta: meta }] }
          : null;
  return result
    ? { jsonrpc: '2.0', id: body.id, result }
    : { jsonrpc: '2.0', id: body.id, error: { code: -32002, message: 'Resource not found.' } };
}

# Migration Guide: MCP v1.1.x to v2.0.0

`@cardz/mcp-server` 2.0 is **100% backward compatible** with all v1.1.x clients:

- All three v1 tools (`search_cards`, `get_card`, `get_market`) retain identical parameter names, defaults, and required response keys (`source`, `currency`, `id`, `name`, `officialName`, `collectorNumber`, `setName`, `tcg`, `cardLanguage`, `marketRank`, `url`, `image`, `pricePsa10`, `populationPsa10`, `marketCap`, `windows`, `historyDaily`).
- Legacy MCP Apps resource URIs (`ui://cardz-marketcap/cardz-1.1.5.html`, `cardz-1.1.4.html`, and earlier `market-data-v1*.html`) remain readable alongside the new `ui://cardz-marketcap/cardz-2.0.0.html`.
- New capabilities (`get_card_ohlcv`, `get_market_depth`, `evaluate_portfolio`, multi-IP scopes, optional `CARDZ_API_KEY`) are purely additive.

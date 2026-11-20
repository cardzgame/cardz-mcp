# CARDZ

Collectible cards, trading card games (TCG), and graded collectibles market data.

This public MCP 2.0 release brings **CARDZ** market data directly into AI assistants and developer tools: exact-printing search, dated PSA 10 and multi-grade reference vs verified sale prices, 2025+ daily and weekly OHLCV candles, Top 500 cross-region market depth, published market rankings, and batch portfolio valuation.

## Privacy

- Public market lookup requires no CARDZ account, password, wallet, or payment details.
- Optional commercial API keys (`Authorization: Bearer` or `X-API-Key`) are validated at the edge solely for rate-limit tiering and are never written to application logs.
- Source IP addresses are used only for anti-scraping rate limits at the Cloudflare edge. No user query history database or player profile is created.
- Public JSON responses and allowlisted WebP card artwork may be cached at the edge to reduce latency.

## Terms of Use

- All tools are strictly read-only. No buying, selling, pack opening, bidding, wallet, or shipping actions exist in this service.
- Values are dated USD market observations, not live executable bids or financial advice. Missing observations remain `null` and are never substituted with zero.
- Automated bulk scraping or rate-limit evasion is prohibited. Exceeding anonymous quotas returns HTTP `429` with `Retry-After`.

## Publisher & Support

**CARDZ** is operated by Jackz Intelligent Technology Co., Ltd., Japan.

- Website: https://cardzmarketcap.com/
- Support & Privacy: support@cardz.game
- Developer & Community Governance: dev@cardz.game

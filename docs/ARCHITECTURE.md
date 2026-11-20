# CARDZ MCP 2.0 Architecture

## Four-Layer Isolation Boundary

1. **Layer 1 (Private Core)**: Ingestion, card recognition, deduplication, watermark checks, and internal index weights remain strictly private.
2. **Layer 2 (Public Cloud Read-Only Store)**: Sanitized Cloudflare D1 + R2 read-only projection.
3. **Layer 3 (Public API v2 Gateway)**: `https://api.cardzmarketcap.com/v2` with anonymous anti-scrape rate limits and optional commercial API keys (`cz_live_<prefix8>_<secret32>`).
4. **Layer 4 (This Open-Source Repository)**: `@cardz/schemas`, `@cardz/mcp-core`, `@cardz/mcp-server` (`npx` stdio + local HTTP), `@cardz/mcp-app-ui`, and `@cardz/cf-worker` (`https://mcp.cardz.game/mcp`).

## Cross-Layer Contract Summary

- **API Key Format**: `^cz_live_[A-Za-z0-9]{8}_[A-Za-z0-9]{32,48}$` accepted via `Authorization: Bearer <key>` or `X-API-Key: <key>`.
- **Grade Mapping (`grade` -> `condition_key`)**:
  - `PSA10` -> `graded:PSA:10`
  - `PSA9` -> `graded:PSA:9`
  - `PSA8` -> `graded:PSA:8`
  - `CGC10` -> `graded:CGC:10`
  - `BGS9.5` -> `graded:BGS:9.5`
  - `BGS10` -> `graded:BGS:10:black`
  - `RAW` -> `raw:ungraded`
- **Anonymized Regions**: `GLOBAL`, `US`, `JP`, `CN`, `CARDZ_MKT` (depth tables and `crossMarketQuotes` emit `US`, `JP`, `CN`, `CARDZ_MKT` only).
- **Cross-Market Identity & JLP Standard Alias Normalization**:
  - Public allowlisted namespaces: `jlp_standard`, `tcgplayer`, `snkrdunk`, `pricecharting`, `cmc`, `psa_spec`, `official_dex`.
  - Deterministic JLP standard alias parser (e.g. `2023 Pikachu [SV2a 025/165] JP`) and multilingual aliases (EN/ZH/JA/KO) normalize queries in `search_cards`, `get_card`, and `evaluate_portfolio` to a single canonical `card_id` while surfacing side-by-side `US`/`JP`/`CN`/`CARDZ_MKT` regional quotes.
- **Rankings Sort Modes**: `market_cap`, `vol_30d_usd`, `vol_30d_count`, `change_30d`.
- **OHLCV Granularity**: `1d` (direct daily candles from 2025-01-01) and `1w` (edge-aggregated ISO weeks), up to 730 calendar days.

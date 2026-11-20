# CARDZ MCP

**Collectibles & TCG market data inside your AI conversation**

Free, read-only, open-source MCP 2.0 server, JSON Schemas, interactive MCP Apps UI, and community card registry for **CARDZ** market data. Search exact printings, inspect dated verified vs reference USD prices, query 2025+ OHLCV candles, explore Top 500 cross-region market depth, and evaluate portfolios — no login or API key required.

| | |
|---|---|
| Endpoint | `https://mcp.cardz.game/mcp` |
| Transport | Streamable HTTP (remote) & `npx @cardz/mcp-server` (`stdio` / local HTTP) |
| Authentication | None required (optional commercial `CARDZ_API_KEY` for higher quotas) |
| Pricing | Free keyless tier |
| Website | https://mcp.cardz.game/ |
| MCP Registry | `io.github.cardzgame/cardz-mcp` (`server.json` & `glama.json` preserved) |

```bash
claude mcp add --transport http cardz https://mcp.cardz.game/mcp
```

## Tools (6 Read-Only Market Data Tools)

All v1.1.x tools (`search_cards`, `get_card`, `get_market`) remain **100% backward compatible**.

| Tool | Version | Description |
|------|---------|-------------|
| `search_cards` | v1 compatible + v2 | Search by card name, EN/ZH/JA/KO alias, collector number, JLP standard alias (e.g. `2023 Pikachu [SV2a 025/165] JP`), or public external ID (`tcgplayer:*`, `snkrdunk:*`). Preserves printing ambiguity. |
| `get_card` | v1 compatible + v2 | Look up a canonical card ID, legacy `cmc_*` ID, or public external ID for PSA 10 & multi-grade reference/verified USD prices, side-by-side `US`/`JP`/`CN`/`CARDZ_MKT` quotes, population, market cap, and daily history. |
| `get_market` | v1 compatible + v2 | Published rankings (`market_cap`, `vol_30d_usd`, `vol_30d_count`, `change_30d`) across Pokémon, One Piece, K-pop, Sports, Naruto, or combined index (up to 20 cards per call). |
| `get_card_ohlcv` | v2 new | 2025+ daily (`1d`) or edge-aggregated weekly (`1w`) OHLCV candles, median price, and cross-market sales volume up to 730 days. Missing days remain gaps; never fabricated. |
| `get_market_depth` | v2 new | Aggregated cross-region (`US`, `JP`, `CN`, `CARDZ_MKT`) ask, recent-sale, and bid price bands for Top 500 high-liquidity cards (`supported: false` outside Top 500). |
| `evaluate_portfolio` | v2 new | Batch valuation and unrealized PnL for up to 50 cards via canonical IDs, public external IDs, JLP standard aliases, or multilingual clues, returning explicit disambiguation candidates instead of silent guessing. |

## Setup

### Option A: Remote Streamable HTTP (Zero Install, No API Key)

#### Generic MCP JSON config (Claude Desktop / Cursor / Windsurf)

```json
{
  "mcpServers": {
    "cardz": {
      "url": "https://mcp.cardz.game/mcp"
    }
  }
}
```

#### VS Code (Copilot Chat MCP)

```json
{
  "servers": {
    "cardz": {
      "url": "https://mcp.cardz.game/mcp"
    }
  }
}
```

#### Claude Code / Codex / Gemini CLI

```bash
claude mcp add --transport http cardz https://mcp.cardz.game/mcp
codex mcp add cardz --url https://mcp.cardz.game/mcp
gemini mcp add --transport http cardz https://mcp.cardz.game/mcp
```

### Option B: Local CLI via `npx` (`stdio` or Local Stateless HTTP)

```json
{
  "mcpServers": {
    "cardz": {
      "command": "npx",
      "args": ["-y", "@cardz/mcp-server"]
    }
  }
}
```

Optional commercial quota tier (pass via `CARDZ_API_KEY` env var or `Authorization: Bearer` / `X-API-Key` header):

```json
{
  "mcpServers": {
    "cardz": {
      "command": "npx",
      "args": ["-y", "@cardz/mcp-server"],
      "env": {
        "CARDZ_API_KEY": "cz_live_9f3a7b2c_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

## Community Data Governance (`registry/`)

This repository includes four community contribution channels backed by GitHub Issue Forms (`.github/ISSUE_TEMPLATE/`) and Draft 2020-12 JSON Schemas (`schemas/registry/`):

1. **Card Metadata / Artwork Correction** (`registry/corrections/`)
2. **New Card Listing** (`registry/listings/` + optional watermark-free artwork)
3. **Marketplace / Exchange Volume Onboarding** (`registry/exchanges/`)
4. **Cross-Market Identity & Alias Mapping** (`registry/identities/`) — maps one canonical `card_id` to allowlisted public IDs (`jlp_standard`, `tcgplayer`, `snkrdunk`, `pricecharting`, `cmc`, `psa_spec`, `official_dex`) and EN/ZH/JA/KO aliases.

All PRs are strictly declarative (executable scripts inside `registry/` are rejected by CI). Merged entries produce a read-only SHA-256 intake manifest pulled asynchronously into isolated internal staging tables after human and watermark verification — external PRs never write directly to production databases.

## Repository Structure

```text
cardz-mcp/
├── server.json                 # Official MCP Registry manifest (io.github.cardzgame/cardz-mcp)
├── glama.json                  # Glama MCP directory manifest
├── packages/
│   ├── schemas/                # @cardz/schemas (Draft 2020-12 JSON Schemas)
│   ├── core/                   # @cardz/mcp-core (6 tools, identity/JLP normalizer, RPC)
│   ├── mcp-server/             # @cardz/mcp-server (npx stdio + local HTTP CLI)
│   ├── mcp-app-ui/             # @cardz/mcp-app-ui (MCP Apps 2.0 interactive UI)
│   └── cf-worker/              # @cardz/cf-worker (Cloudflare Worker runtime)
├── integrations/               # Claude, Cursor, Gemini, Grok, Hermes, OpenAI templates
├── registry/                   # Community-governed catalog corrections, listings, exchanges & identities
├── schemas/registry/           # Draft 2020-12 validation schemas for community PRs
├── scripts/                    # Validation, read-only intake manifest & 5-layer sanitization gate
└── docs/                       # Architecture, migration guide, legal copy & CI workflow templates
```

## Privacy & Security Boundaries

- **Read-only public market data only**: no player accounts, passwords, wallets, purchases, pack openings, auctions, or shipping.
- **USD & null honesty**: missing values remain `null` and are never substituted with zero.
- **Anonymized cross-region outputs**: no private upstream provider names, third-party watermarks, or internal index weights.
- **5-layer sanitization gate**: automated checks enforce zero secrets, zero internal infrastructure IDs, zero copyleft contamination, and strict file/size boundaries.

## Local Development & Verification

```bash
npm install
npm run build
npm test
npm run build:manifest
```

## About & Contact

**CARDZ** — operated by Jackz Intelligent Technology Co., Ltd., Japan.

- Market Data: https://cardzmarketcap.com
- Platform: https://cardz.game
- Support & Privacy: support@cardz.game · Marketing@cardz.game
- Developer & Registry Governance: dev@cardz.game

## License

MIT — applies to code and configuration in this repository (see `LICENSE`). Community catalog submissions under `registry/` are licensed under CC-BY-4.0 (see `docs/legal/LICENSE-DATA.md`).

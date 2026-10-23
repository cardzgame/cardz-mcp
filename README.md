# CARDZ MCP

**Graded card prices inside your AI conversation**

Free, read-only MCP server for graded TCG card data. PSA 10 prices, population, market cap and daily history for Pokémon and One Piece, no login required.

| | |
|---|---|
| Endpoint | `https://mcp.cardz.game/mcp` |
| Transport | Streamable HTTP |
| Authentication | None |
| Pricing | Free |
| Website | https://mcp.cardz.game/ |
| MCP Registry | `io.github.cardzgame/cardz-mcp` |

```bash
claude mcp add --transport http cardz https://mcp.cardz.game/mcp
```

> This repository is the public listing for the hosted remote server (README, `server.json` for the Official MCP Registry). Hosted remote server; source not public.

CARDZ MCP is a hosted, read-only MCP server that brings CardZ Marketcap's graded Pokémon and One Piece card data into any MCP-compatible AI conversation. It exposes three tools over Streamable HTTP — no API key, no account, no login.

**What it does**

`search_cards` finds candidate printings by name or collector number, returning language, set and canonical card-page links. `get_card` returns a single printing's dated PSA 10 reference price, PSA 10 population, market capitalisation (reference price × population), percentage changes, and up to 365 days of daily price history. `get_market` returns published market-cap rankings for Pokémon, One Piece, or the combined tracked index.

All prices are daily reference observations in USD — not live executable quotes. Null values mean unavailable data; the server never substitutes zeros.

**Interactive view in supported hosts**

In MCP Apps-capable hosts such as ChatGPT and Claude, each tool renders an interactive in-chat view showing card artwork, a printing selector and price-history controls. Other hosts receive the same structured data alongside card-page links users can open directly.

**Data scope and freshness**

Current coverage is graded Pokémon and One Piece PSA 10 cards tracked by CardZ Marketcap. Data dates are included in every response and may differ from the time of query. Successful responses may be cached at the Cloudflare edge for 60 seconds; card images may be cached for 24 hours.

**Privacy**

Public lookup requires no CARDZ.Game account. The tools never request passwords, addresses, payment details or wallet information. Search terms are sent to the CardZ Marketcap public API. The service uses source IP addresses for rate limiting only and does not create player profiles or maintain a query-history database.

**What it is not**

CARDZ MCP is data only. It provides no trading, buying, pack-opening, auction, shipping or payment functionality.

## Features

1. **Three focused tools** — search cards, read per-printing metrics, explore market-cap rankings.
2. **Zero authentication** — no API key, no account, no login; connect and query immediately.
3. **Interactive in-chat view** — MCP Apps-capable hosts (e.g. ChatGPT, Claude) render card artwork, printing selection and price-history controls inline.
4. **Daily PSA 10 reference prices** — dated USD observations with up to 365 days of history per printing.
5. **Market-cap rankings** — published rankings for Pokémon, One Piece, or the combined tracked index, with effective dates.
6. **Privacy-first** — no player profiles, no query-history database, no analytics or browser storage in the interactive view.
7. **Streamable HTTP transport** — single URL endpoint, compatible with any MCP client that supports the protocol.

## Tools

| Tool | Description |
|------|-------------|
| `search_cards` | Search graded Pokémon or One Piece cards by name or collector number; returns candidate printings, languages, sets and card-page links. |
| `get_card` | Read one printing's PSA 10 reference price, population, market cap, percentage changes, metric dates and up to 365 days of daily history. |
| `get_market` | Retrieve published market-cap rankings for Pokémon, One Piece or the combined index in its published order. |

## Setup

### Generic MCP JSON config

```json
{
  "mcpServers": {
    "cardz": {
      "url": "https://mcp.cardz.game/mcp"
    }
  }
}
```

### Claude Desktop / Claude Code

Add the JSON block above to your Claude MCP settings. No API key or environment variables needed.

### ChatGPT (custom MCP connector)

Point a Streamable HTTP MCP connector at `https://mcp.cardz.game/mcp` — no authentication header required.

### Cursor

In Cursor Settings → MCP, add a new server with URL `https://mcp.cardz.game/mcp` and transport type **Streamable HTTP**.

### VS Code (Copilot Chat MCP)

Add to `.vscode/mcp.json` or user settings:

```json
{
  "servers": {
    "cardz": {
      "url": "https://mcp.cardz.game/mcp"
    }
  }
}
```

## Example prompts

1. **"What is the PSA 10 price of Charizard ex SAR 217/187?"**
2. **"Show me the top 10 Pokémon cards by market cap."**
3. **"Compare the 90-day price history of Luffy OP05-119 and Enel OP05-118."**
4. **"Search for Pikachu cards and list all tracked printings."**
5. **"What are the highest market-cap One Piece cards right now?"**

## FAQ

**Q: Do I need an API key or account?**
A: No. CARDZ MCP requires no authentication, no API key and no CARDZ.Game account. Connect to the URL and start querying.

**Q: Is it free?**
A: Yes. The server is free to use. Requests are rate-limited; retry after an HTTP 429 response.

**Q: What cards are covered?**
A: Current coverage is graded Pokémon and One Piece PSA 10 cards tracked by CardZ Marketcap.

**Q: How fresh is the data?**
A: Prices are daily reference observations in USD, not live quotes. Each response includes the data's effective date. Successful API responses may be cached at the Cloudflare edge for 60 seconds.

**Q: What data is collected about me?**
A: The tools do not request passwords, payment details or wallet information. Source IP addresses are used for rate limiting only. No player profiles or query-history database are maintained, and the interactive view includes no analytics or browser storage.

## About

CARDZ — CardZ Marketcap and Cardz.Game are related sites under the CARDZ brand.

- CardZ Marketcap: https://cardzmarketcap.com
- Cardz.Game: https://cardz.game

## Contact

Marketing@cardz.game

## License

MIT — applies to the contents of this repository.

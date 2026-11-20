import commonSchema from './common.schema.json' with { type: 'json' };
import searchCardsSchema from './search-cards.schema.json' with { type: 'json' };
import getCardSchema from './get-card.schema.json' with { type: 'json' };
import getMarketSchema from './get-market.schema.json' with { type: 'json' };
import getCardOhlcvSchema from './get-card-ohlcv.schema.json' with { type: 'json' };
import getMarketDepthSchema from './get-market-depth.schema.json' with { type: 'json' };
import evaluatePortfolioSchema from './evaluate-portfolio.schema.json' with { type: 'json' };

export {
  commonSchema,
  searchCardsSchema,
  getCardSchema,
  getMarketSchema,
  getCardOhlcvSchema,
  getMarketDepthSchema,
  evaluatePortfolioSchema,
};

export const toolSchemas = {
  search_cards: searchCardsSchema,
  get_card: getCardSchema,
  get_market: getMarketSchema,
  get_card_ohlcv: getCardOhlcvSchema,
  get_market_depth: getMarketDepthSchema,
  evaluate_portfolio: evaluatePortfolioSchema,
};

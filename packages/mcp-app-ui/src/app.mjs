import { App, applyDocumentTheme } from '@modelcontextprotocol/ext-apps';
import { cardUrl, date, historySeries, money, number, percent } from './format.mjs';

const app = new App({ name: 'CARDZ Collectibles', version: '2.0.0' });
const results = document.getElementById('results');
const status = document.getElementById('status');
const errorBox = document.getElementById('error');
let pending = false;

const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};

const btn = (text, onClick, cls) => {
  const b = el('button', text, cls);
  b.type = 'button';
  b.disabled = pending;
  b.addEventListener('click', onClick);
  return b;
};

function setBusy(flag) {
  pending = flag;
  document.querySelectorAll('button,input,select').forEach((n) => { n.disabled = flag; });
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = false;
}

async function call(name, args) {
  const allowed = ['search_cards', 'get_card', 'get_market', 'get_card_ohlcv', 'get_market_depth', 'evaluate_portfolio'];
  if (pending || !allowed.includes(name)) return;
  setBusy(true);
  errorBox.hidden = true;
  status.textContent = 'Reading public CARDZ data…';
  try {
    render(await app.callServerTool({ name, arguments: args }));
  } catch {
    showError('Card data could not be loaded. Please try again.');
  } finally {
    setBusy(false);
  }
}

function renderChart(points) {
  const series = historySeries(points);
  if (!series.available.length) return el('p', 'No price observations available for this window.');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add('chart');
  svg.setAttribute('viewBox', '0 0 520 150');
  for (const seg of series.segments) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('d', seg.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
    svg.append(path);
  }
  return svg;
}

function renderOhlcv(data) {
  results.append(el('h1', `${data.card.name} · ${data.grade} (${data.interval})`));
  const grid = el('div', undefined, 'kpi-grid');
  grid.append(
    el('div', `High: ${money(data.summary.periodHighUsd)}`, 'kpi-box'),
    el('div', `Low: ${money(data.summary.periodLowUsd)}`, 'kpi-box'),
    el('div', `Volume: ${money(data.summary.totalVolumeUsd)} (${number(data.summary.totalSalesCount)} sales)`, 'kpi-box'),
    el('div', `Change: ${percent(data.summary.periodChangePct)}`, 'kpi-box')
  );
  results.append(grid, renderChart(data.candles));
}

function renderDepth(data) {
  results.append(el('h1', `${data.cardName ?? data.cardId} · Market Depth (${data.grade})`));
  if (!data.supported) {
    results.append(el('p', data.unsupportedReason ?? 'Outside Top 500 high-liquidity cards.'));
    return;
  }
  const maxCnt = Math.max(1, ...data.askLevels.map((x) => x.itemCount), ...data.recentSaleLevels.map((x) => x.itemCount));
  const tbl = el('table');
  const head = el('tr');
  ['Band', 'Price Range (USD)', 'Count', 'Regions'].forEach((h) => head.append(el('th', h)));
  tbl.append(el('thead')).firstChild.append(head);
  const body = el('tbody');
  for (const [label, list] of [['Ask', data.askLevels], ['Recent Sales', data.recentSaleLevels], ['Bid', data.bidLevels]]) {
    for (const lvl of list) {
      const tr = el('tr');
      tr.append(
        el('td', label),
        el('td', `${money(lvl.priceMinUsd)} – ${money(lvl.priceMaxUsd)}`),
        el('td', `${lvl.itemCount} (cum ${lvl.cumulativeCount})`),
        el('td', Object.entries(lvl.regionBreakdown ?? {}).map(([k, v]) => `${k}:${v}`).join(' '))
      );
      body.append(tr);
    }
  }
  tbl.append(body);
  results.append(el('div', undefined, 'table-wrap')).lastChild.append(tbl);
  void maxCnt;
}

function renderPortfolio(data) {
  results.append(el('h1', 'Portfolio Valuation'));
  const grid = el('div', undefined, 'kpi-grid');
  const pnlCls = (data.summary.totalUnrealizedPnlUsd ?? 0) >= 0 ? 'kpi-box pnl-up' : 'kpi-box pnl-down';
  grid.append(
    el('div', `Market Value: ${money(data.summary.totalMarketValueUsd)}`, 'kpi-box'),
    el('div', `Cost Basis: ${money(data.summary.totalCostBasisUsd)}`, 'kpi-box'),
    el('div', `Unrealized PnL: ${money(data.summary.totalUnrealizedPnlUsd)} (${percent(data.summary.totalUnrealizedPnlPct)})`, pnlCls),
    el('div', `Coverage: ${data.summary.pricedItemsCount}/${data.summary.totalItemsSubmitted} (${data.summary.ambiguousItemsCount} ambiguous)`, 'kpi-box')
  );
  results.append(grid);
  for (const pos of data.positions) {
    const box = el('div', undefined, 'card-choice');
    const title = pos.matchedCard ? `${pos.matchedCard.name} (${pos.grade} × ${pos.quantity})` : `Item #${pos.index + 1} · ${pos.status}`;
    box.append(el('strong', title));
    box.append(el('div', `Value: ${money(pos.positionMarketValueUsd)} | PnL: ${money(pos.unrealizedPnlUsd)} (${percent(pos.unrealizedPnlPct)})`));
    if (pos.status === 'ambiguous' && Array.isArray(pos.candidates)) {
      box.append(el('span', 'Disambiguation required', 'badge warn'));
      for (const c of pos.candidates) {
        box.append(btn(`Inspect ${c.name} (${c.collectorNumber ?? ''} ${c.cardLanguage ?? ''})`, () => call('get_card', { id: c.id })));
      }
    }
    results.append(box);
  }
}

function render(result) {
  setBusy(false);
  if (result?.isError) {
    showError(result.content?.find((i) => i.type === 'text')?.text ?? 'Data unavailable.');
    return;
  }
  let data = result?.structuredContent;
  if (!data) {
    try { data = JSON.parse(result?.content?.find((i) => i.type === 'text')?.text ?? 'null'); } catch { data = null; }
  }
  if (!data || data.source !== 'CardZ Marketcap' || data.currency !== 'USD') {
    showError('Unsupported CARDZ payload.');
    return;
  }
  errorBox.hidden = true;
  results.replaceChildren();

  if (Array.isArray(data.candles)) {
    renderOhlcv(data);
    status.textContent = `OHLCV · ${date(data.effectiveAt)} · CARDZ`;
  } else if (typeof data.supported === 'boolean' && data.cardId) {
    renderDepth(data);
    status.textContent = `Depth snapshot · ${date(data.snapshotAt)} · CARDZ`;
  } else if (Array.isArray(data.positions)) {
    renderPortfolio(data);
    status.textContent = `Portfolio evaluated · ${date(data.evaluatedAt)} · CARDZ`;
  } else if (Array.isArray(data.cards)) {
    const list = el('div', undefined, 'card-list');
    for (const card of data.cards) {
      const choice = btn(`${card.name} · ${money(card.pricePsa10?.value)}`, () => call('get_card', { id: card.id }), 'card-choice');
      list.append(choice);
    }
    results.append(list);
    status.textContent = `Published ${date(data.effectiveAt)} · CARDZ`;
  } else if (data.id) {
    results.append(el('h1', `${data.name} · ${money(data.pricePsa10?.value)}`));
    if (data.jlpStandardName) {
      results.append(el('p', `JLP Standard: ${data.jlpStandardName}`, 'badge'));
    }
    const u = cardUrl(data.url);
    if (u) results.append(btn('Open on CARDZ', () => app.openLink({ url: u })));
    if (Array.isArray(data.crossMarketQuotes) && data.crossMarketQuotes.length) {
      const tbl = el('table');
      const head = el('tr');
      ['Region', 'Verified Sale (USD)', 'Reference (USD)', '30D Sales'].forEach((h) => head.append(el('th', h)));
      tbl.append(el('thead')).firstChild.append(head);
      const tbody = el('tbody');
      for (const q of data.crossMarketQuotes) {
        const tr = el('tr');
        tr.append(
          el('td', q.region),
          el('td', money(q.verifiedSaleUsd)),
          el('td', money(q.marketReferenceUsd)),
          el('td', number(q.salesCount30d))
        );
        tbody.append(tr);
      }
      tbl.append(tbody);
      results.append(el('div', undefined, 'table-wrap')).lastChild.append(tbl);
    }
    results.append(renderChart(data.historyDaily));
    status.textContent = `Exact printing · ${date(data.pricePsa10?.asOf)} · CARDZ`;
  }
}

document.getElementById('search-form').addEventListener('submit', (e) => e.preventDefault());
document.getElementById('search-button').addEventListener('click', () => {
  const q = document.getElementById('query').value.trim();
  const tcg = document.getElementById('game').value;
  if (q) call('search_cards', { q, ...(tcg ? { tcg } : {}) });
});
document.querySelectorAll('[data-scope]').forEach((b) =>
  b.addEventListener('click', () => call('get_market', { scope: b.dataset.scope, limit: 10 }))
);

app.ontoolresult = render;
app.onhostcontextchanged = (ctx) => { if (ctx.theme) applyDocumentTheme(ctx.theme); };
app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
}).catch(() => {});

export const money = (value) =>
  typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)
    : 'Unavailable';

export const number = (value) =>
  typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('en-US').format(value)
    : 'Unavailable';

export const percent = (value) =>
  typeof value === 'number' && Number.isFinite(value)
    ? `${value > 0 ? '+' : ''}${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)}%`
    : 'Unavailable';

export const date = (value) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value))
    : 'Date unavailable';

export function cardUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://cardzmarketcap.com' &&
      !url.username &&
      !url.password &&
      /^\/card\/[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(url.pathname) &&
      !url.search &&
      !url.hash
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function imageUrl(value) {
  try {
    const url = new URL(value);
    const validMain =
      url.origin === 'https://cardzmarketcap.com' &&
      /^\/market-assets\/[a-f0-9]{64}(?:_(?:200|600))?\.webp$/.test(url.pathname);
    const validProxy =
      url.origin === 'https://mcp.cardz.game' &&
      /^\/card-art\/[a-f0-9]{64}(?:_(?:200|600))?\.webp$/.test(url.pathname);
    return (validMain || validProxy) && !url.username && !url.password && !url.search && !url.hash
      ? `https://mcp.cardz.game/card-art/${url.pathname.split('/').at(-1)}`
      : null;
  } catch {
    return null;
  }
}

export function historySeries(pointsInput) {
  const points = Array.isArray(pointsInput)
    ? pointsInput
        .filter((p) => p && typeof (p.at ?? p.date) === 'string' && Number.isFinite(Date.parse(p.at ?? p.date)))
        .map((p) => {
          const at = p.at ?? p.date;
          const val = p.priceUsd ?? p.closeUsd ?? null;
          return {
            at,
            time: Date.parse(at),
            value: typeof val === 'number' && Number.isFinite(val) ? val : null,
            volumeUsd: typeof p.volumeUsd === 'number' && Number.isFinite(p.volumeUsd) ? p.volumeUsd : 0,
          };
        })
        .sort((a, b) => a.time - b.time)
    : [];

  const available = points.filter((p) => p.value !== null);
  if (!available.length) return { points, available, segments: [], min: null, max: null };
  const min = Math.min(...available.map((p) => p.value));
  const max = Math.max(...available.map((p) => p.value));
  const pad = Math.max((max - min) * 0.12, Math.abs(max) * 0.005, 0.01);
  const lower = Math.max(0, min - pad);
  const upper = max + pad;
  const start = points[0].time;
  const end = points.at(-1).time;
  const segments = [];
  let current = [];
  for (const p of points) {
    if (p.value === null) {
      if (current.length) segments.push(current);
      current = [];
      continue;
    }
    if (current.length && p.time - current.at(-1).time > 86_400_000 * 1.5) {
      segments.push(current);
      current = [];
    }
    current.push({
      ...p,
      x: (end === start ? 0.5 : (p.time - start) / (end - start)) * 520,
      y: ((upper - p.value) / (upper - lower)) * 130 + 10,
    });
  }
  if (current.length) segments.push(current);
  return { points, available, segments, min: lower, max: upper };
}

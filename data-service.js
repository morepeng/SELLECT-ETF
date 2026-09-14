// data-service-4.js — optimized and backward-compatible replacement
const DataService = (() => {
  const cache = new Map();
  const pending = new Map();
  const CACHE_TTL = 10 * 60 * 1000;
  const TIMEOUT = 5000;

  const PROXIES = [
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    url => url,
  ];

  const PERIOD_MAP = { '1y': '1y', '60d': '60d', '5d': '5d', '3mo': '3mo' };
  const chartUrl = (ticker, interval, range) =>
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}&events=history&includePrePost=false`;

  function parseChart(data) {
    const result = data?.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    if (!result?.timestamp || !quote) return null;
    const adj = result.indicators?.adjclose?.[0]?.adjclose || quote.close;
    const rows = [];
    for (let i = 0; i < result.timestamp.length; i++) {
      const open = quote.open?.[i], high = quote.high?.[i], low = quote.low?.[i], close = quote.close?.[i];
      if (open == null || high == null || low == null || close == null) continue;
      rows.push({ date: new Date(result.timestamp[i] * 1000), open, high, low, close, volume: quote.volume?.[i] || 0, adj: adj?.[i] || close });
    }
    return rows.length >= 5 ? rows : null;
  }

  async function fetchJson(url) {
    for (const makeProxy of PROXIES) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT);
      try {
        const response = await fetch(makeProxy(url), { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) continue;
        const text = await response.text();
        if (!text || !text.trim().startsWith('{')) continue;
        return JSON.parse(text);
      } catch (_) {
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  async function getOHLCV(ticker, period = '1y', interval = '1d') {
    const key = `${ticker}|${period}|${interval}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.time < CACHE_TTL) return hit.rows;
    if (pending.has(key)) return pending.get(key);
    const request = fetchJson(chartUrl(ticker, interval, PERIOD_MAP[period] || period))
      .then(parseChart)
      .then(rows => { if (rows) cache.set(key, { rows, time: Date.now() }); return rows; })
      .finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }

  async function getETFHoldings(ticker, maxN = 20) {
    const key = `holdings|${ticker}|${maxN}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.time < CACHE_TTL) return hit.rows;
    if (pending.has(key)) return pending.get(key);

    const fallback = (typeof ETF_HOLDINGS !== 'undefined' && ETF_HOLDINGS[ticker])
      ? ETF_HOLDINGS[ticker].slice(0, maxN)
      : [];

    const request = Promise.resolve(fallback).then(rows => {
      cache.set(key, { rows, time: Date.now() });
      return rows;
    }).finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }

  function col(rows, field) { return rows.map(row => row[field]); }
  function rollingMean(arr, n) {
    const out = new Array(arr.length).fill(NaN);
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      sum += Number(arr[i]) || 0;
      if (i >= n) sum -= Number(arr[i - n]) || 0;
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }
  function ewmMean(arr, com) {
    const alpha = 1 / (com + 1), out = new Array(arr.length).fill(NaN);
    let prev = NaN;
    for (let i = 0; i < arr.length; i++) {
      if (!Number.isFinite(arr[i])) continue;
      prev = Number.isNaN(prev) ? arr[i] : alpha * arr[i] + (1 - alpha) * prev;
      out[i] = prev;
    }
    return out;
  }
  function clearCache() { cache.clear(); pending.clear(); }
  return { getOHLCV, getETFHoldings, col, rollingMean, ewmMean, clearCache };
})();
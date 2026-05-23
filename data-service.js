// data-service.js — Yahoo Finance OHLCV fetcher with local cache

const DataService = (() => {
  const _cache = {};
  // Multiple CORS proxies; try in order
  const PROXIES = [
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    url => url, // direct (works in some setups)
  ];

  const YF_CHART = (ticker, interval, range) =>
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}&events=history&includePrePost=false`;

  const PERIOD_MAP = {
    '1y': '1y', '60d': '60d', '5d': '5d', '3mo': '3mo'
  };

  function parseChart(data) {
    const result = data?.chart?.result?.[0];
    if (!result || !result.timestamp) return null;
    const ts   = result.timestamp;
    const q    = result.indicators.quote[0];
    const adj  = result.indicators.adjclose?.[0]?.adjclose || q.close;
    const rows = [];
    for (let i = 0; i < ts.length; i++) {
      if (q.open[i] == null || q.close[i] == null) continue;
      rows.push({
        date:   new Date(ts[i] * 1000),
        open:   q.open[i],
        high:   q.high[i],
        low:    q.low[i],
        close:  q.close[i],
        volume: q.volume[i] || 0,
        adj:    adj[i] || q.close[i],
      });
    }
    return rows.length >= 5 ? rows : null;
  }

  async function fetchWithProxy(url) {
    for (const makeProxy of PROXIES) {
      try {
        const res = await fetch(makeProxy(url), { signal: AbortSignal.timeout(12000) });
        if (!res.ok) continue;
        const data = await res.json();
        return data;
      } catch { /* try next */ }
    }
    return null;
  }

  async function getOHLCV(ticker, period = '1y', interval = '1d') {
    const key = `${ticker}|${period}|${interval}`;
    if (_cache[key]) return _cache[key];

    const url = YF_CHART(ticker, interval, PERIOD_MAP[period] || period);
    const data = await fetchWithProxy(url);
    if (!data) return null;

    const rows = parseChart(data);
    if (!rows) return null;

    _cache[key] = rows;
    return rows;
  }

  // Helper: field array from rows
  function col(rows, field) { return rows.map(r => r[field]); }

  // Rolling mean
  function rollingMean(arr, n) {
    return arr.map((_, i) => {
      if (i < n - 1) return NaN;
      const slice = arr.slice(i - n + 1, i + 1);
      return slice.reduce((a, b) => a + b, 0) / n;
    });
  }

  // EWM mean (com-style, pandas-like)
  function ewmMean(arr, com) {
    const alpha = 1 / (com + 1);
    const out = new Array(arr.length).fill(NaN);
    let prev = NaN;
    for (let i = 0; i < arr.length; i++) {
      if (isNaN(arr[i])) continue;
      if (isNaN(prev)) { prev = arr[i]; out[i] = arr[i]; continue; }
      prev = alpha * arr[i] + (1 - alpha) * prev;
      out[i] = prev;
    }
    return out;
  }

  function clearCache() { Object.keys(_cache).forEach(k => delete _cache[k]); }

  return { getOHLCV, col, rollingMean, ewmMean, clearCache };
})();

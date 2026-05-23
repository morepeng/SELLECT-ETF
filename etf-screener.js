// etf-screener.js — Round 1 ETF Pre-Screener (JS port)

class ETFPreScreener {
  constructor(cfg) {
    this.cfg    = cfg;
    this.engine = new StructureEngine(cfg);
  }

  async screen(ticker, market = 'US') {
    const r = {
      ticker, market, pass: false, score: 0, price: null,
      change_5d: 0, avg_vol_20d: 0, liquidity_ok: false,
      trend_ok: false, flow_ok: false, ma60: null, vol_ratio: 0,
      top_holdings: [], reasons: [], structure: 'RANGING', bos_bull: false,
    };

    const rows = await DataService.getOHLCV(ticker, '1y', '1d');
    if (!rows || rows.length < 65) return r;

    const close  = rows.map(r => r.close);
    const vol    = rows.map(r => r.volume);
    const latest = close.at(-1);

    r.price       = +latest.toFixed(4);
    r.change_5d   = close.length >= 6 ? +((latest - close.at(-6)) / close.at(-6) * 100).toFixed(2) : 0;

    const vol20   = vol.slice(-20);
    const avg20   = vol20.reduce((a, b) => a + b, 0) / vol20.length;
    r.avg_vol_20d = Math.round(avg20);

    // Liquidity check
    let liq_ok;
    if (market !== 'TW') {
      liq_ok = avg20 >= this.cfg.R1_MIN_VOL_US;
    } else {
      const price20 = close.slice(-20);
      const turnover20 = price20.map((p, i) => p * vol20[i]);
      liq_ok = turnover20.reduce((a, b) => a + b, 0) / 20 >= this.cfg.R1_MIN_TURNOVER_TW;
    }
    r.liquidity_ok = liq_ok;

    // Trend: MA60
    const ma60arr = DataService.rollingMean(close, this.cfg.R1_TREND_MA);
    const ma60    = ma60arr.at(-1);
    r.trend_ok = latest > ma60;
    r.ma60     = +ma60.toFixed(4);

    // Flow: vol ratio short/long
    const short_n = this.cfg.R1_FLOW_SHORT;
    const long_n  = this.cfg.R1_FLOW_LONG;
    const avgShort = vol.slice(-short_n).reduce((a, b) => a + b, 0) / short_n;
    const avgLong  = vol.slice(-long_n).reduce((a, b) => a + b, 0) / long_n;
    r.vol_ratio    = +(avgShort / (avgLong + 1e-10)).toFixed(2);
    r.flow_ok      = r.vol_ratio > 1.0;

    // Scoring
    let score = 0, reasons = [];
    if (liq_ok)      { score += 15; reasons.push('流動性✅'); }
    if (r.trend_ok)  { score += 20; reasons.push('MA60趨勢✅'); }
    if (r.flow_ok)   { score += 15; reasons.push('量增✅'); }

    const chg = r.change_5d;
    if (chg >= 5) score += 30;
    else if (chg >= 2) score += 20;
    else if (chg >= 0) score += 10;
    else score -= 10;

    const bos = this.engine.detectBosChoch(rows);
    r.structure = bos.structure;
    r.bos_bull  = bos.bos_bull;
    if (bos.bos_bull)  { score += 10; reasons.push('BOS多頭'); }
    else if (bos.bos_bear) { score -= 10; reasons.push('BOS空頭'); }

    r.score   = score;
    r.pass    = (liq_ok || ['CN', 'HK'].includes(market)) && score >= this.cfg.R1_ETF_SCORE_PASS;
    r.reasons = reasons;
    r.top_holdings = (ETF_HOLDINGS[ticker] || []).slice(0, this.cfg.R1_TOP_HOLDINGS);
    return r;
  }

  async scanAll(universe, onProgress) {
    const passed = [], failed = [];
    const markets = Object.entries(universe);

    for (const [market, tickers] of markets) {
      onProgress?.(`📡 掃描 ${market} ETF (${tickers.length} 檔)...`);
      for (const ticker of tickers) {
        const res = await this.screen(ticker, market);
        if (res.price !== null) {
          (res.pass ? passed : failed).push(res);
        }
        onProgress?.(`  → ${ticker}: ${res.pass ? '✅' : '❌'} score=${res.score}`);
        await sleep(this.cfg.REQUEST_DELAY);
      }
    }

    // Also scan TW leverage ETFs
    onProgress?.('📌 掃描台灣槓桿ETF...');
    for (const t of TW_LEVERAGE_ETF) {
      if (!alreadyScanned(passed, failed, t)) {
        const res = await this.screen(t, 'TW');
        if (res.price !== null) (res.pass ? passed : failed).push(res);
        await sleep(this.cfg.REQUEST_DELAY);
      }
    }

    passed.sort((a, b) => b.score - a.score);
    failed.sort((a, b) => b.score - a.score);
    return { passed, failed };
  }
}

// Helpers
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function alreadyScanned(passed, failed, ticker) {
  return [...passed, ...failed].some(r => r.ticker === ticker);
}

function selectTopEtfsByMarket(passed, keepMap, topN) {
  const selected = [], seen = new Set();
  for (const market of ['US', 'TW', 'HK', 'CN']) {
    const n = keepMap[market] || 0;
    const mkt = passed.filter(r => r.market === market);
    for (const r of mkt.slice(0, n)) {
      if (!seen.has(r.ticker)) { selected.push(r.ticker); seen.add(r.ticker); }
    }
  }
  // Fill up to topN
  for (const r of passed) {
    if (selected.length >= topN) break;
    if (!seen.has(r.ticker)) { selected.push(r.ticker); seen.add(r.ticker); }
  }
  return selected;
}

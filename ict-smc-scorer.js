// ict-smc-scorer.js — Round 2 ICT/SMC Elite Scorer (JS port)

class ICTSMCScorer {
  constructor(cfg) {
    this.cfg    = cfg;
    this.engine = new StructureEngine(cfg);
  }

  async analyze(ticker, sourceEtf = '') {
    const r = {
      ticker, source_etf: sourceEtf, success: false, price: null,
      score: 0, action: 'SKIP', action_zh: '略過 ─', grade: '條件不足',
      change_5d: 0, stop_hunt: {}, fvg: {}, ob: {}, ote: {}, bos: {}, pd_zone: {},
      mtf_bull: false, kill_zone: null, kill_zone_ok: false,
      stop_loss: null, kill_price_lo: null, kill_price_hi: null,
      ma5: null, ma20: null, ma60: null, rsi: null, vol_ratio: null,
      zone: null, structure: 'RANGING', reasons: [], error: '',
    };

    try {
      const rows1d = await DataService.getOHLCV(ticker, '1y', '1d');
      if (!rows1d || rows1d.length < 65) { r.error = '日線資料不足'; return r; }

      const close = rows1d.map(x => x.close);
      const vol   = rows1d.map(x => x.volume);
      const price = close.at(-1);
      r.price = +price.toFixed(4);

      if (close.length >= 6) r.change_5d = +((price - close.at(-6)) / close.at(-6) * 100).toFixed(2);

      // MAs
      const ma5arr  = DataService.rollingMean(close, 5);
      const ma20arr = DataService.rollingMean(close, 20);
      const ma60arr = DataService.rollingMean(close, 60);
      const ma5 = ma5arr.at(-1), ma20 = ma20arr.at(-1), ma60 = ma60arr.at(-1);
      r.ma5 = +ma5.toFixed(4); r.ma20 = +ma20.toFixed(4); r.ma60 = +ma60.toFixed(4);

      // ICT/SMC detections
      const bos = this.engine.detectBosChoch(rows1d);
      const fvg = this.engine.detectFvg(rows1d);
      const ob  = this.engine.detectOrderBlock(rows1d);
      const sh  = this.engine.detectStopHunt(rows1d);
      const ote = this.engine.calcOte(rows1d);
      const pdz = this.engine.premiumDiscount(rows1d);
      Object.assign(r, { bos, fvg, ob, stop_hunt: sh, ote, pd_zone: pdz });

      // MTF confluence (1h + 15m)
      const rows1h  = await DataService.getOHLCV(ticker, '60d', '1h');
      const rows15m = await DataService.getOHLCV(ticker, '5d', '15m');
      r.mtf_bull = false;
      if (rows1h?.length >= 25 && rows15m?.length >= 25) {
        r.mtf_bull = this._checkMtfConfluence(rows1d, rows1h, rows15m);
      }

      // Kill zone
      const kz = new KillZoneFilter();
      r.kill_zone    = kz.currentZone();
      r.kill_zone_ok = kz.isInKillZone();

      // RSI (EWM, com=13)
      const delta = close.map((v, i) => i === 0 ? 0 : v - close[i - 1]);
      const gain  = delta.map(d => Math.max(d, 0));
      const loss  = delta.map(d => Math.max(-d, 0));
      const avgGain = DataService.ewmMean(gain, 13);
      const avgLoss = DataService.ewmMean(loss, 13);
      const rsiNow  = 100 - 100 / (1 + (avgGain.at(-1) / (avgLoss.at(-1) + 1e-10)));
      r.rsi = +rsiNow.toFixed(1);

      // Volume ratio
      const vol5avg  = vol.slice(-5).reduce((a, b) => a + b, 0) / 5;
      const vol20avg = vol.slice(-20).reduce((a, b) => a + b, 0) / 20;
      r.vol_ratio = +(vol5avg / (vol20avg + 1e-10)).toFixed(2);

      // ── SCORING ──────────────────────────────────────────────────
      let score = 0, reasons = [];

      // MA structure
      if (price > ma60) { score += 10; reasons.push('MA60上方+10'); } else score -= 5;
      if (price > ma20) { score += 8;  reasons.push('MA20上方+8'); }
      if (ma5 > ma20)   { score += 7;  reasons.push('MA5強勢+7'); }

      // RSI
      if (rsiNow > 30 && rsiNow < 50)       { score += 8; reasons.push(`RSI低位回升+8(${rsiNow.toFixed(0)})`); }
      else if (rsiNow >= 50 && rsiNow < 65)  { score += 5; reasons.push(`RSI中性+5(${rsiNow.toFixed(0)})`); }
      else if (rsiNow >= 75)                 { score -= 5; reasons.push(`RSI超買-5(${rsiNow.toFixed(0)})`); }

      // Volume
      if (r.vol_ratio >= 1.5)      { score += 7; reasons.push(`量比${r.vol_ratio}x+7`); }
      else if (r.vol_ratio >= 1.0) { score += 3; reasons.push(`量比${r.vol_ratio}x+3`); }

      // 5-day change
      const chg5 = r.change_5d;
      if (chg5 >= 5)        { score += 5; reasons.push(`5日強勢+${chg5.toFixed(1)}%`); }
      else if (chg5 >= 2)   { score += 3; reasons.push(`5日小漲+${chg5.toFixed(1)}%`); }
      else if (chg5 < -3)   { score -= 5; reasons.push(`5日走弱${chg5.toFixed(1)}%`); }

      // ICT signals
      if (sh.bull_stop_hunt)     { score += this.cfg.R2_STOP_HUNT_SCORE; reasons.push('Stop Hunt多頭+30'); }
      else if (sh.bear_stop_hunt){ score -= 15; reasons.push('Stop Hunt空頭-15'); }

      if (fvg.in_bullish_fvg)    { score += this.cfg.R2_FVG_SCORE; reasons.push('Bullish FVG+25'); }

      if (ob.in_bull_ob) {
        score += this.cfg.R2_OB_SCORE; reasons.push('Bullish OB+25');
        if (ob.vol_contraction) { score += 5; reasons.push('OB量縮+5'); }
      }

      if (ote.in_ote)            { score += this.cfg.R2_OTE_SCORE; reasons.push('OTE區+20'); }

      if (bos.bos_bull)          { score += this.cfg.R2_BOS_BULL_SCORE; reasons.push('BOS多頭+20'); }
      else if (bos.choch_bear || bos.bos_bear) { score += this.cfg.R2_CHOCH_BEAR_PENALTY; reasons.push('CHoCH/BOS空頭-30'); }

      if (r.mtf_bull)            { score += this.cfg.R2_MTF_BONUS; reasons.push('MTF共振+15'); }

      // Premium/Discount
      const zone = pdz.zone || 'UNKNOWN';
      if (zone === 'DISCOUNT')   { score += this.cfg.R2_DISCOUNT_BONUS; reasons.push('Discount+10'); }
      else if (zone === 'PREMIUM'){ score += this.cfg.R2_PREMIUM_PENALTY; reasons.push('Premium-10'); }

      if (price < ma20)          { score += this.cfg.R2_MA20_PENALTY; reasons.push('跌破MA20-20'); }

      // Risk levels
      r.stop_loss      = +(ma5 * 0.985).toFixed(4);
      r.kill_price_lo  = +(price * 0.985).toFixed(4);
      r.kill_price_hi  = +(price * 1.015).toFixed(4);
      r.zone           = zone;
      r.structure      = bos.structure || 'RANGING';

      // Action
      if (score >= this.cfg.BUY_SCORE)         { r.action = 'BUY';  r.action_zh = '買進 ▲'; r.grade = '強勢進場'; }
      else if (score >= this.cfg.HOLD_SCORE)   { r.action = 'WATCH'; r.action_zh = '觀察 ◆'; r.grade = '等待進場點'; }
      else if (bos.choch_bear || bos.bos_bear) { r.action = 'SELL'; r.action_zh = '賣出 ▼'; r.grade = '空頭結構'; }
      else                                     { r.action = 'SKIP'; r.action_zh = '略過 ─'; r.grade = '條件不足'; }

      r.score   = score;
      r.reasons = reasons;
      r.success = true;
    } catch (e) {
      r.error = String(e).slice(0, 120);
    }
    return r;
  }

  _checkMtfConfluence(rows1d, rows1h, rows15m) {
    let bulls = 0;
    for (const rows of [rows1d, rows1h, rows15m]) {
      if (!rows || rows.length < 25) continue;
      const close = rows.map(r => r.close);
      const ma20arr = DataService.rollingMean(close, 20);
      const ma20 = ma20arr.at(-1);
      const latest = close.at(-1);
      const bos = this.engine.detectBosChoch(rows);
      if (latest > ma20 && (bos.bos_bull || bos.structure === 'BULLISH')) bulls++;
    }
    return bulls >= 2;
  }
}

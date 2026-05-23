// structure-engine.js — JS port of Python StructureEngine & KillZoneFilter

class KillZoneFilter {
  constructor(zones) {
    this.zones = zones || CONFIG.KILL_ZONES;
  }
  nowTW() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  }
  currentZone() {
    const now = this.nowTW();
    const cur = now.getHours() * 60 + now.getMinutes();
    for (const [name, [sh, sm, eh, em]] of Object.entries(this.zones)) {
      if (sh * 60 + sm <= cur && cur <= eh * 60 + em) return name;
    }
    return null;
  }
  isInKillZone() { return this.currentZone() !== null; }
}

class StructureEngine {
  constructor(cfg) { this.cfg = cfg; }

  // rows: [{open, high, low, close, volume, date}]
  swingPoints(rows, lookback) {
    const lb = lookback || this.cfg.SWING_LOOKBACK;
    if (!rows || rows.length < lb * 2 + 1) return [[], []];
    const h = rows.map(r => r.high);
    const l = rows.map(r => r.low);
    const sh = [], sl = [];
    for (let i = lb; i < rows.length - lb; i++) {
      const hSlice = h.slice(i - lb, i + lb + 1);
      const lSlice = l.slice(i - lb, i + lb + 1);
      if (h[i] === Math.max(...hSlice)) sh.push([i, h[i]]);
      if (l[i] === Math.min(...lSlice)) sl.push([i, l[i]]);
    }
    return [sh, sl];
  }

  detectBosChoch(rows) {
    const r = {
      bos_bull: false, bos_bear: false, choch_bull: false, choch_bear: false,
      structure: 'RANGING', last_sh: null, last_sl: null
    };
    const [sh_list, sl_list] = this.swingPoints(rows);
    if (!sh_list.length || !sl_list.length) return r;

    const latestClose = rows[rows.length - 1].close;
    r.last_sh = sh_list[sh_list.length - 1][1];
    r.last_sl = sl_list[sl_list.length - 1][1];
    r.bos_bull = latestClose > r.last_sh;
    r.bos_bear = latestClose < r.last_sl;

    if (sh_list.length >= 2 && sl_list.length >= 2) {
      const hh = sh_list.at(-1)[1] > sh_list.at(-2)[1];
      const hl = sl_list.at(-1)[1] > sl_list.at(-2)[1];
      const lh = sh_list.at(-1)[1] < sh_list.at(-2)[1];
      const ll = sl_list.at(-1)[1] < sl_list.at(-2)[1];
      if (hh && hl) r.structure = 'BULLISH';
      else if (lh && ll) r.structure = 'BEARISH';
      if (r.structure === 'BEARISH' && r.bos_bull) r.choch_bull = true;
      if (r.structure === 'BULLISH' && r.bos_bear) r.choch_bear = true;
    }
    return r;
  }

  detectFvg(rows) {
    const empty = {
      has_bullish_fvg: false, in_bullish_fvg: false, bull_fvg_top: null, bull_fvg_bot: null,
      has_bearish_fvg: false, in_bearish_fvg: false, bear_fvg_top: null, bear_fvg_bot: null,
      fvg_count: 0
    };
    if (!rows || rows.length < 3) return empty;

    const minGap = this.cfg.FVG_MIN_GAP_PCT;
    const close = rows.at(-1).close;
    const hi = rows.map(r => r.high);
    const lo = rows.map(r => r.low);
    const bull = [], bear = [];
    const scanRange = Math.min(rows.length, 60);

    for (let i = scanRange - 2; i > 0; i--) {
      if (lo[i] > hi[i - 2]) {
        const gapPct = (lo[i] - hi[i - 2]) / (hi[i - 2] + 1e-10);
        if (gapPct >= minGap) bull.push({ top: lo[i], bot: hi[i - 2], in_fvg: hi[i - 2] <= close && close <= lo[i] });
      } else if (hi[i] < lo[i - 2]) {
        const gapPct = (lo[i - 2] - hi[i]) / (hi[i] + 1e-10);
        if (gapPct >= minGap) bear.push({ top: lo[i - 2], bot: hi[i], in_fvg: hi[i] <= close && close <= lo[i - 2] });
      }
    }

    const bb = bull[0] || null;
    const br = bear[0] || null;
    return {
      has_bullish_fvg: !!bb, in_bullish_fvg: bb?.in_fvg || false, bull_fvg_top: bb?.top || null, bull_fvg_bot: bb?.bot || null,
      has_bearish_fvg: !!br, in_bearish_fvg: br?.in_fvg || false, bear_fvg_top: br?.top || null, bear_fvg_bot: br?.bot || null,
      fvg_count: bull.length + bear.length
    };
  }

  detectOrderBlock(rows) {
    const empty = {
      in_bull_ob: false, in_bear_ob: false, bull_ob_top: null, bull_ob_bot: null,
      bear_ob_top: null, bear_ob_bot: null, vol_contraction: false, bull_ob_count: 0, bear_ob_count: 0
    };
    if (!rows || rows.length < 3) return empty;

    const minImpulse = this.cfg.OB_MIN_IMPULSE_PCT;
    const n = rows.length;
    const close   = rows.map(r => r.close);
    const open_   = rows.map(r => r.open);
    const high    = rows.map(r => r.high);
    const low     = rows.map(r => r.low);
    const vol     = rows.map(r => r.volume);
    const latestClose = close[n - 1];

    const avgVol5 = n > 6 ? vol.slice(-6, -1).reduce((a, b) => a + b, 0) / 5 : vol.reduce((a, b) => a + b, 0) / vol.length;
    const volContraction = vol[n - 1] < avgVol5;

    const bull_obs = [], bear_obs = [];
    const scanN = Math.min(n - 2, 60);

    for (let i = 1; i < scanN; i++) {
      if (close[i] < open_[i] && i + 1 < n) {
        const impulse = (high[i + 1] - close[i]) / (close[i] + 1e-10);
        if (impulse >= minImpulse) bull_obs.push({ top: high[i], bot: low[i], impulse });
      } else if (close[i] > open_[i] && i + 1 < n) {
        const impulse = (close[i] - low[i + 1]) / (close[i] + 1e-10);
        if (impulse >= minImpulse) bear_obs.push({ top: high[i], bot: low[i], impulse });
      }
    }

    const hitOB = (list, price) => {
      for (let j = list.length - 1; j >= 0; j--) {
        if (list[j].bot <= price && price <= list[j].top) return list[j];
      }
      return null;
    };
    const bh = hitOB(bull_obs, latestClose);
    const rh = hitOB(bear_obs, latestClose);

    return {
      in_bull_ob: !!bh, in_bear_ob: !!rh,
      bull_ob_top: bh?.top || null, bull_ob_bot: bh?.bot || null,
      bear_ob_top: rh?.top || null, bear_ob_bot: rh?.bot || null,
      vol_contraction: volContraction, bull_ob_count: bull_obs.length, bear_ob_count: bear_obs.length
    };
  }

  detectStopHunt(rows) {
    const [sh_list, sl_list] = this.swingPoints(rows);
    const r = { bull_stop_hunt: false, bear_stop_hunt: false, hunt_level: null, hunt_type: null, bull_engulf: false };
    if (!sl_list.length || !sh_list.length) return r;

    const latest = rows.at(-1);
    const prev   = rows.at(-2);
    const wigPct = this.cfg.STOP_HUNT_WIG_PCT;

    for (const [, sl_price] of sl_list.slice(-3)) {
      if (latest.low < sl_price * (1 - wigPct) && latest.close > sl_price) {
        r.bull_stop_hunt = true; r.hunt_level = sl_price; r.hunt_type = 'Bullish Stop Hunt'; break;
      }
    }
    if (!r.bull_stop_hunt) {
      for (const [, sh_price] of sh_list.slice(-3)) {
        if (latest.high > sh_price * (1 + wigPct) && latest.close < sh_price) {
          r.bear_stop_hunt = true; r.hunt_level = sh_price; r.hunt_type = 'Bearish Stop Hunt'; break;
        }
      }
    }
    r.bull_engulf = latest.close > prev.high && latest.close > prev.close;
    return r;
  }

  calcOte(rows) {
    const [sh_list, sl_list] = this.swingPoints(rows);
    const r = { in_ote: false, ote_low: null, ote_high: null, fib_pct: null, ote_direction: null };
    if (!sh_list.length || !sl_list.length) return r;

    const close = rows.at(-1).close;
    const [last_sh_idx, last_sh] = sh_list.at(-1);
    const [last_sl_idx, last_sl] = sl_list.at(-1);
    const rng = last_sh - last_sl;
    if (rng <= 0) return r;

    let ote_lo, ote_hi, fib_pct, direction;
    if (last_sh_idx > last_sl_idx) {
      ote_lo = last_sh - this.cfg.OTE_HIGH * rng;
      ote_hi = last_sh - this.cfg.OTE_LOW * rng;
      fib_pct = (last_sh - close) / (rng + 1e-10);
      direction = 'BULL';
    } else {
      ote_lo = last_sl + this.cfg.OTE_LOW * rng;
      ote_hi = last_sl + this.cfg.OTE_HIGH * rng;
      fib_pct = (close - last_sl) / (rng + 1e-10);
      direction = 'BEAR';
    }

    r.in_ote = ote_lo <= close && close <= ote_hi;
    r.ote_low = +ote_lo.toFixed(4);
    r.ote_high = +ote_hi.toFixed(4);
    r.fib_pct = +(fib_pct * 100).toFixed(1);
    r.ote_direction = direction;
    return r;
  }

  premiumDiscount(rows) {
    const [sh_list, sl_list] = this.swingPoints(rows);
    if (!sh_list.length || !sl_list.length) return { zone: 'UNKNOWN', eq_price: null, pct_from_eq: null };

    const close = rows.at(-1).close;
    const swing_hi = Math.max(...sh_list.slice(-3).map(x => x[1]));
    const swing_lo = Math.min(...sl_list.slice(-3).map(x => x[1]));
    if (swing_hi <= swing_lo) return { zone: 'UNKNOWN', eq_price: null, pct_from_eq: null };

    const eq  = (swing_hi + swing_lo) / 2;
    const pct = (close - eq) / (swing_hi - swing_lo + 1e-10) * 100;
    const zone = close < eq * 0.995 ? 'DISCOUNT' : close > eq * 1.005 ? 'PREMIUM' : 'EQUILIBRIUM';
    return {
      zone,
      eq_price:   +eq.toFixed(4),
      swing_hi:   +swing_hi.toFixed(4),
      swing_lo:   +swing_lo.toFixed(4),
      pct_from_eq: +pct.toFixed(1),
    };
  }
}

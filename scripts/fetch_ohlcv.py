#!/usr/bin/env python3
"""Download 1y daily OHLCV with yfinance and save as static JSON for GitHub Pages.

Output: data/ohlcv/<TICKER>.json  ->  {"updated": "...", "rows": [[ts,o,h,l,c,v,adj], ...]}
Tickers: read from tickers.txt (one per line, '#' comments allowed), else DEFAULT_TICKERS.
"""
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "ohlcv"
TICKER_FILE = ROOT / "tickers.txt"
PERIOD = "1y"
BATCH = 50

DEFAULT_TICKERS = [
    # ETFs seen in the dashboard
    "QQQ", "XLK", "SOXX", "SMH", "HACK",
    # large caps
    "AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "AMD",
]


def load_tickers():
    if TICKER_FILE.exists():
        out = []
        for line in TICKER_FILE.read_text(encoding="utf-8").splitlines():
            line = line.split("#")[0].strip()
            if line:
                out.append(line)
        if out:
            return list(dict.fromkeys(out))
    return DEFAULT_TICKERS


def extract(df, ticker, multi):
    """Return the OHLCV frame for one ticker from a yf.download result."""
    if multi:
        if ticker not in df.columns.get_level_values(0):
            return None
        sub = df[ticker]
    else:
        sub = df
    if isinstance(sub.columns, pd.MultiIndex):  # defensive: flatten
        sub = sub.copy()
        sub.columns = sub.columns.get_level_values(-1)
    return sub


def to_rows(sub):
    sub = sub.dropna(subset=["Open", "High", "Low", "Close"])
    if len(sub) < 5:
        return None
    adj_col = "Adj Close" if "Adj Close" in sub.columns else "Close"
    rows = []
    for idx, r in sub.iterrows():
        ts = pd.Timestamp(idx)
        ts = ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")
        adj = r[adj_col]
        rows.append([
            int(ts.timestamp()),
            round(float(r["Open"]), 4),
            round(float(r["High"]), 4),
            round(float(r["Low"]), 4),
            round(float(r["Close"]), 4),
            int(r["Volume"]) if pd.notna(r["Volume"]) else 0,
            round(float(adj), 4) if pd.notna(adj) else round(float(r["Close"]), 4),
        ])
    return rows


def main():
    tickers = load_tickers()
    OUT.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    ok, bad = [], []

    for i in range(0, len(tickers), BATCH):
        batch = tickers[i:i + BATCH]
        df = None
        for attempt in range(3):
            try:
                df = yf.download(batch, period=PERIOD, interval="1d", auto_adjust=False,
                                 group_by="ticker", threads=True, progress=False)
                if df is not None and not df.empty:
                    break
            except Exception as e:  # noqa: BLE001
                print(f"batch {i} attempt {attempt + 1} failed: {e}", file=sys.stderr)
            time.sleep(3 * (attempt + 1))
        if df is None or df.empty:
            bad.extend(batch)
            continue

        multi = isinstance(df.columns, pd.MultiIndex)
        for t in batch:
            try:
                sub = extract(df, t, multi)
                rows = to_rows(sub) if sub is not None else None
            except Exception as e:  # noqa: BLE001
                print(f"{t}: parse error {e}", file=sys.stderr)
                rows = None
            if rows:
                (OUT / f"{t}.json").write_text(
                    json.dumps({"updated": now, "rows": rows}, separators=(",", ":")),
                    encoding="utf-8")
                ok.append(t)
            else:
                bad.append(t)  # keep the previous file if it exists
        time.sleep(1)

    (OUT / "index.json").write_text(
        json.dumps({"updated": now, "ok": ok, "failed": bad}, ensure_ascii=False),
        encoding="utf-8")
    print(f"done: {len(ok)} ok, {len(bad)} failed {bad}")
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()

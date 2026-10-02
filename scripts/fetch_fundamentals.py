#!/usr/bin/env python3
"""Fetch a few fundamentals per ticker with yfinance -> data/fundamentals/<TICKER>.json

{"ok": true, "updated": "...", "pe": 28.1, "roe": 0.15 (fraction), "debtRatio": 150.2 (debt/equity %),
 "capexRatio": 12.3 (|capex| / operating cash flow * 100)}
Best effort: Yahoo may rate-limit; failures keep the previous file.
"""
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "fundamentals"
LIST = ROOT / "fundamentals.txt"
MAX_TICKERS = 150


def load():
    if not LIST.exists():
        return ["AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "AVGO"]
    out = []
    for line in LIST.read_text(encoding="utf-8").splitlines():
        line = line.split("#")[0].strip()
        if line:
            out.append(line)
    return list(dict.fromkeys(out))[:MAX_TICKERS]


def num(v):
    try:
        v = float(v)
        return None if v != v else v  # NaN -> None
    except (TypeError, ValueError):
        return None


def one(t):
    tk = yf.Ticker(t)
    info = tk.info or {}
    pe, roe, debt = num(info.get("trailingPE")), num(info.get("returnOnEquity")), num(info.get("debtToEquity"))
    capex_ratio = None
    try:
        cf = tk.cashflow
        ocf = num(cf.loc["Operating Cash Flow"].dropna().iloc[0])
        capex = num(cf.loc["Capital Expenditure"].dropna().iloc[0])
        if ocf and ocf > 0 and capex is not None:
            capex_ratio = abs(capex) / ocf * 100
    except Exception:  # noqa: BLE001
        pass
    if pe is None and roe is None and debt is None and capex_ratio is None:
        return None
    return {"ok": True, "pe": pe, "roe": roe, "debtRatio": debt, "capexRatio": capex_ratio}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    ok = bad = 0
    for t in load():
        data = None
        for attempt in range(2):
            try:
                data = one(t)
                break
            except Exception as e:  # noqa: BLE001
                print(f"{t}: {e}", file=sys.stderr)
                time.sleep(3)
        if data:
            data["updated"] = now
            (OUT / f"{t}.json").write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
            ok += 1
        else:
            bad += 1
        time.sleep(1.0)
    print(f"fundamentals: {ok} ok, {bad} failed")


if __name__ == "__main__":
    main()

# MJ Sniper v9 – deploy notes

Repo root (GitHub Pages) must contain:

- `index.html`                  (the page – all JS is inline; js/*.js files are NOT loaded)
- `tickers.txt`, `fundamentals.txt`
- `scripts/fetch_ohlcv.py`, `scripts/fetch_fundamentals.py`
- `.github/workflows/update-data.yml`
- `.nojekyll`

1. Settings > Actions > General > Workflow permissions = Read and write.
2. Actions > "Update market data" > Run workflow (first run, ~3-8 min).
3. Check `data/ohlcv/index.json` -> `"failed"` lists tickers Yahoo could not return (dead/renamed symbols).
4. Open the page, press "API 診斷": it should show 靜態資料 data/ohlcv：N 檔.

Flags (CONFIG in index.html): R2_MTF_PRESCREEN, R2_MAX_STOCKS, ALLOW_FALLBACK_PASS.

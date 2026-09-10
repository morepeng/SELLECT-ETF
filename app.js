// app-2.js — GitHub Pages / mobile optimized replacement
const State = {
  running: false,
  r1Results: { passed: [], failed: [] },
  r2Results: [],
  topEtfs: [],
  log: [],
};

const $ = id => document.getElementById(id);
const el = (tag, cls) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
};

let logPaintQueued = false;
function log(msg, type = 'info') {
  State.log.push({ msg, type, ts: new Date().toLocaleTimeString() });
  if (State.log.length > 250) State.log.shift();
  if (logPaintQueued) return;
  logPaintQueued = true;
  requestAnimationFrame(() => {
    logPaintQueued = false;
    const div = $('log');
    if (!div) return;
    const start = Math.max(0, State.log.length - 80);
    const fragment = document.createDocumentFragment();
    for (let i = start; i < State.log.length; i++) {
      const item = State.log[i];
      const line = el('div', `log-line log-${item.type}`);
      line.textContent = `[${item.ts}] ${item.msg}`;
      fragment.appendChild(line);
    }
    div.replaceChildren(fragment);
    div.scrollTop = div.scrollHeight;
  });
}

function updateKillZone() {
  const kz = new KillZoneFilter();
  const zone = kz.currentZone();
  const target = $('kill-zone');
  if (!target) return;
  if (zone) {
    target.textContent = `🎯 Kill Zone: ${zone}`;
    target.className = 'kill-zone active';
  } else {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    target.textContent = `⏸ 非Kill Zone 台北 ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    target.className = 'kill-zone inactive';
  }
}
setInterval(updateKillZone, 30000);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function mapLimit(items, limit, worker, onProgress) {
  const output = new Array(items.length);
  let next = 0;
  let done = 0;

  async function runner() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try {
        output[index] = await worker(items[index], index);
      } catch (error) {
        output[index] = null;
      }
      done++;
      onProgress?.(done, items.length, output[index]);
      await sleep(80);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return output;
}

async function runAnalysis() {
  log('🚀 MJ Sniper v9.0 啟動 · 手機高速模式', 'header');
  updateKillZone();

  const workers = Math.max(2, Math.min(4, Number(CONFIG.MAX_WORKERS) || 4));
  const topCount = Math.max(1, Math.min(4, Number(CONFIG.R1_TOP_N_ETF) || 4));
  const holdingCount = Math.max(1, Math.min(8, Number(CONFIG.R1_TOP_HOLDINGS) || 8));

  log('════ 第一輪：ETF 賽道篩選 ════', 'section');
  const screener = new ETFPreScreener(CONFIG);
  const etfTasks = Object.entries(ETF_UNIVERSE).flatMap(([market, tickers]) =>
    tickers.map(ticker => ({ ticker, market }))
  );

  const r1Rows = await mapLimit(
    etfTasks,
    workers,
    ({ ticker, market }) => screener.screen(ticker, market),
    (done, total, row) => {
      $('stats-bar').textContent = `第一輪：${done}/${total}`;
      if (row?.price != null) log(`→ ${row.ticker}: ${row.pass ? '✅' : '❌'} score=${row.score}`);
    }
  );

  const passed = r1Rows.filter(row => row?.price != null && row.pass).sort((a, b) => b.score - a.score);
  const failed = r1Rows.filter(row => row?.price != null && !row.pass).sort((a, b) => b.score - a.score);
  State.r1Results = { passed, failed };
  renderR1Table(passed, failed);
  log(`✅ 通過: ${passed.length} 檔 ❌ 淘汰: ${failed.length} 檔`, 'success');

  const topEtfs = selectTopEtfsByMarket(passed, CONFIG.R1_MIN_KEEP_BY_MARKET, topCount);
  State.topEtfs = topEtfs;
  log(`📋 第二輪 ETF: ${topEtfs.join(', ') || '無'}`, 'info');

  const stockTasks = [];
  const seen = new Set();
  for (const etf of topEtfs) {
    for (const stk of (ETF_HOLDINGS[etf] || []).slice(0, holdingCount)) {
      if (!seen.has(stk)) {
        seen.add(stk);
        stockTasks.push({ stk, etf });
      }
    }
  }

  log(`📊 第二輪並行分析 ${stockTasks.length} 檔成分股`, 'section');
  const scorer = new ICTSMCScorer(CONFIG);
  const results = (await mapLimit(
    stockTasks,
    workers,
    ({ stk, etf }) => scorer.analyze(stk, etf),
    (done, total, row) => {
      $('stats-bar').textContent = `第二輪：${done}/${total}`;
      if (row?.success) log(`${row.action}: ${row.ticker} score=${row.score}`);
    }
  )).filter(Boolean);

  const actionOrder = { BUY: 0, WATCH: 1, SELL: 2, SKIP: 3 };
  results.sort((a, b) => (actionOrder[a.action] - actionOrder[b.action]) || (b.score - a.score));
  State.r2Results = results;
  renderR2Table(results);
  document.dispatchEvent(new CustomEvent('r2-complete', { detail: results }));

  const buy = results.filter(row => row.action === 'BUY').length;
  const watch = results.filter(row => row.action === 'WATCH').length;
  const skip = results.filter(row => row.action === 'SKIP').length;
  $('r1-count').textContent = `${passed.length}/${passed.length + failed.length} 通過`;
  $('stats-bar').textContent = `✅ 完成 | BUY: ${buy} | WATCH: ${watch} | SKIP: ${skip}`;
  $('btn-export').disabled = false;
  log(`🎯 分析完成 · BUY: ${buy} · WATCH: ${watch}`, 'success');
}

function renderR1Table(passed, failed) {
  const tbody = $('r1-table-body');
  const rows = [
    ...passed.map(row => ({ ...row, _pass: true })),
    ...failed.slice(0, 20).map(row => ({ ...row, _pass: false })),
  ];
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.className = row._pass ? 'row-pass' : 'row-fail';
    const change = row.change_5d >= 0 ? `+${row.change_5d}%` : `${row.change_5d}%`;
    const structure = row.structure === 'BULLISH' ? 'BULL' : row.structure === 'BEARISH' ? 'BEAR' : row.structure;
    tr.innerHTML = `<td>${row.ticker}</td><td>${row.market}</td><td>${row.price ?? '-'}</td><td>${change}</td><td>${row.score}</td><td>${row.liquidity_ok ? '✅' : '—'}</td><td>${row.trend_ok ? '✅' : '—'}</td><td>${row.flow_ok ? '✅' : '—'}</td><td>${row.vol_ratio ?? '-'}</td><td>${structure}</td><td>${row._pass ? '✅' : '—'}</td>`;
    fragment.appendChild(tr);
  }
  tbody.replaceChildren(fragment);
}

function renderR2Table(results) {
  const tbody = $('r2-table-body');
  const fragment = document.createDocumentFragment();
  const shown = results.filter(row => row.success).slice(0, 60);
  for (const row of shown) {
    const tr = document.createElement('tr');
    tr.className = `row-${String(row.action || 'skip').toLowerCase()}`;
    const signals = [
      row.stop_hunt?.bull_stop_hunt ? 'SH' : '',
      row.fvg?.in_bullish_fvg ? 'FVG' : '',
      row.ob?.in_bull_ob ? 'OB' : '',
      row.ote?.in_ote ? 'OTE' : '',
      row.mtf_bull ? 'MTF' : '',
    ].filter(Boolean).join(' ');
    tr.innerHTML = `<td>${row.ticker}</td><td>${row.source_etf || ''}</td><td>${row.price ?? '-'}</td><td>${row.change_5d ?? 0}%</td><td>${row.score}</td><td>${row.action_zh || row.action}</td><td>${row.grade || ''}</td><td>${row.structure || ''}</td><td>${row.rsi ?? '-'}</td><td>${row.vol_ratio ?? '-'}</td><td>${row.zone || '-'}</td><td>${signals || '—'}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>${row.macro_bonus ?? 0}</td><td>${row.vix ?? '-'}</td><td>—</td><td>${row.stop_loss ?? '-'}</td>`;
    fragment.appendChild(tr);
  }
  tbody.replaceChildren(fragment);
  $('r2-count').textContent = `${shown.length} 檔`;
}

$('btn-run').addEventListener('click', async () => {
  if (State.running) return;
  State.running = true;
  $('btn-run').disabled = true;
  $('btn-run').textContent = '⚡ 分析中...';
  State.log = [];
  $('log').replaceChildren();
  $('r1-table-body').replaceChildren();
  $('r2-table-body').replaceChildren();
  $('stats-bar').textContent = '';
  try {
    await runAnalysis();
  } catch (error) {
    log(`❌ ${error.message || error}`, 'warn');
  } finally {
    State.running = false;
    $('btn-run').disabled = false;
    $('btn-run').textContent = '▶ 執行掃描';
  }
});

$('btn-export')?.addEventListener('click', () => {
  const rows = State.r2Results.filter(row => row.success);
  if (!rows.length) return;
  const headers = ['ticker', 'source_etf', 'price', 'change_5d', 'score', 'action', 'grade', 'rsi', 'vol_ratio', 'zone', 'stop_loss'];
  const csv = [headers.join(','), ...rows.map(row => headers.map(key => JSON.stringify(row[key] ?? '')).join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `MJ_Sniper_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

updateKillZone();
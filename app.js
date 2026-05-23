// app.js — MJ Sniper v9.0 Main Application Controller

// ── State ───────────────────────────────────────────────────────────────────
const State = {
  running: false,
  r1Results: { passed: [], failed: [] },
  r2Results: [],
  topEtfs: [],
  log: [],
};

// ── DOM helpers ─────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls)  e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

// ── Logger ───────────────────────────────────────────────────────────────────
function log(msg, type = 'info') {
  State.log.push({ msg, type, ts: new Date().toLocaleTimeString() });
  const div = $('log');
  const line = el('div', `log-line log-${type}`);
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  div.appendChild(line);
  div.scrollTop = div.scrollHeight;
}

// ── Kill Zone ticker ─────────────────────────────────────────────────────────
function updateKillZone() {
  const kz = new KillZoneFilter();
  const zone = kz.currentZone();
  const el$ = $('kill-zone');
  if (zone) {
    el$.textContent = `🎯 Kill Zone: ${zone}`;
    el$.className = 'kill-zone active';
  } else {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    el$.textContent = `⏸ 非Kill Zone  台北 ${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`;
    el$.className = 'kill-zone inactive';
  }
}
setInterval(updateKillZone, 30000);

// ── Run Button ───────────────────────────────────────────────────────────────
$('btn-run').addEventListener('click', async () => {
  if (State.running) return;
  State.running = true;
  $('btn-run').disabled = true;
  $('btn-run').textContent = '⚡ 分析中...';
  $('log').innerHTML = '';
  $('r1-table-body').innerHTML = '';
  $('r2-table-body').innerHTML = '';
  $('stats-bar').textContent = '';

  try {
    await runAnalysis();
  } finally {
    State.running = false;
    $('btn-run').disabled = false;
    $('btn-run').textContent = '▶ 執行掃描';
  }
});

async function runAnalysis() {
  log('🚀 MJ Sniper v9.0 啟動 · ICT/SMC Elite System', 'header');
  updateKillZone();

  // ── Round 1: ETF Screener ────────────────────────────────────────────────
  log('════ 第一輪: ETF賽道篩選 ════', 'section');
  const screener = new ETFPreScreener(CONFIG);
  const { passed, failed } = await screener.scanAll(ETF_UNIVERSE, msg => log(msg));
  State.r1Results = { passed, failed };

  log(`✅ 通過: ${passed.length} 檔  ❌ 淘汰: ${failed.length} 檔`, 'success');
  renderR1Table(passed, failed);

  // ── Select top ETFs by market ────────────────────────────────────────────
  const topEtfs = selectTopEtfsByMarket(passed, CONFIG.R1_MIN_KEEP_BY_MARKET, CONFIG.R1_TOP_N_ETF);
  State.topEtfs = topEtfs;
  log(`📋 第二輪選用ETF: ${topEtfs.join(', ')}`, 'info');

  // ── Round 2: ICT/SMC Scorer ─────────────────────────────────────────────
  log('════ 第二輪: ICT/SMC 精密評分 ════', 'section');
  const scorer  = new ICTSMCScorer(CONFIG);
  const allStks = [];
  const seen    = new Set();
  for (const etf of topEtfs) {
    for (const stk of (ETF_HOLDINGS[etf] || []).slice(0, CONFIG.R1_TOP_HOLDINGS)) {
      if (!seen.has(stk)) { allStks.push({ stk, etf }); seen.add(stk); }
    }
  }

  log(`📊 分析 ${allStks.length} 檔成分股...`, 'info');
  const r2 = [];
  let done = 0;
  for (const { stk, etf } of allStks) {
    const res = await scorer.analyze(stk, etf);
    r2.push(res);
    done++;
    if (res.success) {
      const icon = res.action === 'BUY' ? '🟢' : res.action === 'WATCH' ? '🟡' : res.action === 'SELL' ? '🔴' : '⚪';
      log(`${icon} ${stk} (${etf}) score=${res.score} ${res.action_zh}`, res.action === 'BUY' ? 'buy' : res.action === 'SELL' ? 'sell' : 'info');
    } else {
      log(`⚠ ${stk}: ${res.error || '無資料'}`, 'warn');
    }
    $('stats-bar').textContent = `進度: ${done}/${allStks.length}`;
    await sleep(CONFIG.REQUEST_DELAY);
  }

  r2.sort((a, b) => {
    const order = { BUY: 0, WATCH: 1, SELL: 2, SKIP: 3 };
    if (order[a.action] !== order[b.action]) return order[a.action] - order[b.action];
    return b.score - a.score;
  });
  State.r2Results = r2;
  renderR2Table(r2);
  document.dispatchEvent(new CustomEvent('r2-complete', { detail: r2 }));
  document.getElementById('r1-count').textContent =
    State.r1Results.passed.length + '/' +
    (State.r1Results.passed.length + State.r1Results.failed.length) + ' 通過';

  const buyCount = r2.filter(r => r.action === 'BUY').length;
  log(`🎯 分析完成 · BUY: ${buyCount} · WATCH: ${r2.filter(r=>r.action==='WATCH').length}`, 'success');
  $('stats-bar').textContent = `✅ 完成 | 買進訊號: ${buyCount} | WATCH: ${r2.filter(r=>r.action==='WATCH').length} | 略過: ${r2.filter(r=>r.action==='SKIP').length}`;
  $('btn-export').disabled = false;
}

// ── Render R1 Table ──────────────────────────────────────────────────────────
function renderR1Table(passed, failed) {
  const tbody = $('r1-table-body');
  tbody.innerHTML = '';
  const all = [
    ...passed.map(r => ({ ...r, _pass: true })),
    ...failed.slice(0, 20).map(r => ({ ...r, _pass: false })),
  ];
  for (const r of all) {
    const tr = document.createElement('tr');
    tr.className = r._pass ? 'row-pass' : 'row-fail';
    const change = r.change_5d >= 0 ? `<span class="green">+${r.change_5d}%</span>` : `<span class="red">${r.change_5d}%</span>`;
    const struct = r.structure === 'BULLISH' ? '<span class="green">BULL</span>' : r.structure === 'BEARISH' ? '<span class="red">BEAR</span>' : r.structure;
    tr.innerHTML = `
      <td class="mono bold">${r.ticker}</td>
      <td>${r.market}</td>
      <td class="mono">${r.price ?? '-'}</td>
      <td class="mono">${change}</td>
      <td class="score-cell">${r.score}</td>
      <td>${r.liquidity_ok ? '✅' : '❌'}</td>
      <td>${r.trend_ok ? '✅' : '❌'}</td>
      <td>${r.flow_ok ? '✅' : '❌'}</td>
      <td>${r.vol_ratio}</td>
      <td>${struct}</td>
      <td class="pass-cell">${r._pass ? '<span class="green">通過</span>' : '<span class="dim">淘汰</span>'}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ── Render R2 Table ──────────────────────────────────────────────────────────
function renderR2Table(results) {
  const tbody = $('r2-table-body');
  tbody.innerHTML = '';
  const success = results.filter(r => r.success);
  const top = success.slice(0, 60);
  $('r2-count').textContent = success.length + ' 檔';

  for (const r of top) {
    const tr = document.createElement('tr');
    tr.className = `row-${r.action.toLowerCase()}`;

    const actionClass = r.action === 'BUY' ? 'green bold' : r.action === 'WATCH' ? 'amber' : r.action === 'SELL' ? 'red' : 'dim';
    const change = r.change_5d >= 0 ? `<span class="green">+${r.change_5d}%</span>` : `<span class="red">${r.change_5d}%</span>`;
    const struct = r.structure === 'BULLISH' ? '<span class="green">●</span>' : r.structure === 'BEARISH' ? '<span class="red">●</span>' : '<span class="dim">●</span>';
    const signals = [
      r.stop_hunt?.bull_stop_hunt ? '<span class="green" title="Stop Hunt">SH</span>' : '',
      r.fvg?.in_bullish_fvg ? '<span class="green" title="Fair Value Gap">FVG</span>' : '',
      r.ob?.in_bull_ob ? '<span class="green" title="Order Block">OB</span>' : '',
      r.ote?.in_ote ? '<span class="amber" title="Optimal Trade Entry">OTE</span>' : '',
      r.mtf_bull ? '<span class="cyan" title="Multi-Timeframe Confluence">MTF</span>' : '',
    ].filter(Boolean).join(' ');

    tr.innerHTML = `
      <td class="mono bold">${r.ticker}</td>
      <td class="dim">${r.source_etf}</td>
      <td class="mono">${r.price ?? '-'}</td>
      <td>${change}</td>
      <td class="score-cell ${r.score >= 80 ? 'score-high' : r.score >= 60 ? 'score-mid' : ''}">${r.score}</td>
      <td class="${actionClass}">${r.action_zh}</td>
      <td class="dim">${r.grade}</td>
      <td>${struct} ${r.structure}</td>
      <td class="mono dim">${r.rsi ?? '-'}</td>
      <td class="mono dim">${r.vol_ratio ?? '-'}</td>
      <td class="zone-${(r.zone||'').toLowerCase()}">${r.zone ?? '-'}</td>
      <td class="signals-cell">${signals || '<span class="dim">─</span>'}</td>
      <td class="mono dim">${r.stop_loss ?? '-'}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ── Export CSV ───────────────────────────────────────────────────────────────
$('btn-export').addEventListener('click', () => {
  if (!State.r2Results.length) return;
  exportCSV(State.r2Results.filter(r => r.success), 'MJ_Sniper_v9_R2');
  exportCSV([...State.r1Results.passed, ...State.r1Results.failed], 'MJ_Sniper_v9_R1');
});

function exportCSV(rows, filename) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]).filter(k => typeof rows[0][k] !== 'object');
  const header = keys.join(',');
  const body = rows.map(r => keys.map(k => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + header + '\n' + body], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${filename}_${new Date().toISOString().slice(0,16).replace(/[T:]/g,'-')}.csv`;
  a.click();
}

// ── Table sorting ─────────────────────────────────────────────────────────────
function makeSortable(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return;
  table.querySelectorAll('th[data-sort]').forEach(th => {
    let asc = true;
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const col = parseInt(th.dataset.sort);
      const tbody = table.querySelector('tbody');
      const rows = Array.from(tbody.querySelectorAll('tr'));
      rows.sort((a, b) => {
        const va = a.cells[col]?.textContent.replace(/[^0-9.\-]/g, '') || '';
        const vb = b.cells[col]?.textContent.replace(/[^0-9.\-]/g, '') || '';
        const na = parseFloat(va), nb = parseFloat(vb);
        if (!isNaN(na) && !isNaN(nb)) return asc ? na - nb : nb - na;
        return asc ? va.localeCompare(vb) : vb.localeCompare(va);
      });
      rows.forEach(r => tbody.appendChild(r));
      asc = !asc;
    });
  });
}

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $(btn.dataset.tab).classList.add('active');
  });
});

// ── Config panel toggle ───────────────────────────────────────────────────────
$('btn-config').addEventListener('click', () => {
  const panel = $('config-panel');
  panel.classList.toggle('open');
  $('btn-config').textContent = panel.classList.contains('open') ? '⚙ 收合設定' : '⚙ 顯示設定';
});

// ── Init ─────────────────────────────────────────────────────────────────────
updateKillZone();
makeSortable('r1-table');
makeSortable('r2-table');
log('MJ Sniper v9.0 · ICT/SMC Elite Trading System 就緒', 'header');
log('按下 ▶ 執行掃描 開始分析', 'info');

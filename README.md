# 🎯 MJ Sniper v9.0 · ICT/SMC Elite Trading System

> 兩輪智能篩選 · ICT/SMC 六維評分 · 多時框共振分析  
> Web 版本移植自 Python `MJ_Sniper_v9.0` — 可直接部署至 GitHub Pages，無需後端

---

## 🖥️ 線上展示

部署後訪問：`https://<your-username>.github.io/MJ-Sniper-v9/`

---

## 📁 專案結構

```
MJ-Sniper-v9/
├── index.html              # 主儀表板
├── css/
│   └── style.css           # 黑色軍事終端機主題
├── js/
│   ├── config.js           # 系統設定 & ETF資料庫
│   ├── data-service.js     # Yahoo Finance OHLCV 抓取 (帶快取)
│   ├── structure-engine.js # ICT/SMC 結構引擎
│   ├── etf-screener.js     # 第一輪 ETF 賽道篩選
│   ├── ict-smc-scorer.js   # 第二輪 ICT/SMC 精密評分
│   └── app.js              # 主控制器 & UI 渲染
└── README.md
```

---

## 🚀 快速部署到 GitHub Pages

### 方法一：直接上傳

1. 在 GitHub 建立新 Repository（例如 `MJ-Sniper-v9`）
2. 上傳所有檔案（保持目錄結構）
3. 進入 **Settings → Pages → Source → Deploy from branch → main / root**
4. 等待約 2 分鐘，訪問 `https://<username>.github.io/MJ-Sniper-v9/`

### 方法二：Git CLI

```bash
git init
git add .
git commit -m "🎯 MJ Sniper v9.0 initial deploy"
git branch -M main
git remote add origin https://github.com/<username>/MJ-Sniper-v9.git
git push -u origin main
```

然後到 GitHub Settings → Pages 開啟即可。

---

## ⚙️ 系統架構

### 第一輪 · ETF 賽道篩選（R1）

| 過濾條件 | 說明 |
|---|---|
| 流動性 | 美股日均量 > 50萬；台股日均成交額 > 1000萬 |
| MA60 趨勢 | 收盤價 > 60日均線 |
| 量能流向 | 5日均量 / 20日均量 > 1.0 |
| BOS 多頭 | 突破最後擺動高點（加分） |
| ETF 得分門檻 | ≥ 50 分通過（可設定） |

市場覆蓋：🇺🇸 US（34檔）· 🇹🇼 TW（7檔）· 🇭🇰 HK（3檔）· 🇨🇳 CN A股（6檔）

---

### 第二輪 · ICT/SMC 六維評分（R2）

| 訊號 | 分數 | 說明 |
|---|---|---|
| Stop Hunt 多頭 | +30 | 掃低後回收（流動性獵殺） |
| Bullish FVG | +25 | 多頭公平價值缺口（Fair Value Gap） |
| Bullish OB | +25 | 多頭訂單塊（Order Block） |
| OB 量縮 | +5 | 訂單塊伴隨量能收縮 |
| OTE 最佳進場 | +20 | Fibonacci 0.62–0.79 區間 |
| BOS 多頭 | +20 | 結構突破（Break of Structure） |
| MTF 共振 | +15 | 日線/1H/15M 三框架同向 |
| Discount 折價 | +10 | 處於折價交易區間 |
| MA60 上方 | +10 | 站上長期均線 |
| CHoCH/BOS 空頭 | -30 | 結構反轉 |
| 跌破 MA20 | -20 | 短期弱勢 |
| Premium 溢價 | -10 | 處於溢價交易區間 |

### 行動閾值

| 得分 | 動作 | 說明 |
|---|---|---|
| ≥ 80 | 🟢 BUY 買進 | 強勢進場 |
| ≥ 60 | 🟡 WATCH 觀察 | 等待進場點 |
| 空頭結構 | 🔴 SELL 賣出 | CHoCH/BOS 空頭 |
| 其他 | ⚪ SKIP 略過 | 條件不足 |

---

## 🕐 Kill Zone 時區（台北時間）

| Kill Zone | 台北時間 |
|---|---|
| Asia Session | 09:00 – 11:00 |
| London Open | 15:00 – 17:00 |
| New York Open | 21:30 – 23:30 |

---

## 🔧 參數調整

所有參數可在 UI 上方「⚙ 顯示設定」面板即時調整，或直接編輯 `js/config.js`：

```javascript
const CONFIG = {
  R1_ETF_SCORE_PASS:  50,   // ETF 通過門檻
  R1_TOP_N_ETF:        5,   // 第二輪使用的 ETF 數量
  R1_TOP_HOLDINGS:    15,   // 每 ETF 取前 N 檔成分股
  BUY_SCORE:          80,   // 買進門檻
  HOLD_SCORE:         60,   // 觀察門檻
  REQUEST_DELAY:     250,   // API 請求間隔 (ms)，避免被封鎖
  // ...更多參數見 config.js
};
```

---

## 📡 資料來源

- **Yahoo Finance** `query1.finance.yahoo.com/v8/finance/chart/`
- 透過 CORS Proxy 抓取（`api.allorigins.win` → `corsproxy.io` 依序嘗試）
- 本地 Session 快取，同一次執行不重複請求
- 資料可能有 15 分鐘延遲

> ⚠️ **免責聲明**：本系統分析結果僅供參考，非投資建議。請自行評估風險。

---

## 📋 ETF 資料庫覆蓋

**美股 ETF（34檔）**：QQQ, XLK, SOXX, SMH, HACK, IGV, SKYY, ARKG, XLE, XOP, OIH, XLF, KRE, KBE, XLV, IBB, XBI, XLI, ITA, XLY, XLP, XLB, GDX, COPX, VNQ, IYR, SPY, IWM, DIA, BIL, TLT, HYG

**台股 ETF（7檔）**：0050, 00981A, 00992A, 00987A, 00991A, 00995A, 00403A（含槓桿）

**港股 ETF（3檔）**：2800, 2823, 3033

**A股 ETF（6檔）**：512480, 515050, 588000, 159949, 512000, 159941

---

## 🛠️ 本地開發

由於 CORS 限制，直接用瀏覽器開啟 `index.html` 可能無法抓取資料，建議用本地伺服器：

```bash
# Python
python -m http.server 8080

# Node.js
npx serve .

# VS Code: 安裝 Live Server 插件，右鍵 → Open with Live Server
```

---

## 📜 版本紀錄

| 版本 | 說明 |
|---|---|
| v9.2 | 修復多個評分欄位 Bug，統一 ★交易決策 輸出格式 |
| v9.0 | ICT/SMC 六維評分引擎，多時框共振（MTF），Stop Hunt 偵測 |
| v8.5 | Wyckoff 分析，台指期模組，PCR 美股分析 |

---

*MJ Sniper — 精準狙擊，順勢而為*

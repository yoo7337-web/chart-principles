/* 주식차트분석 대시보드 — results.json 로드 → 원칙 순위표 + 사례 캔들차트 + 2026 적용 */
let DATA = null;
let APPLY = null;
let COMMENT = null;
let REGIME = null;
let RCOMMENT = null;
let TODAY = null;
let SIM = null;
let MARKET = null;
let NEWS = null;
let MPRO = null;
let FUND = null;
let GURUS = null;
let VAL = null;
let DEALS = null;
let NEWS_BRIEFS = null, DEALS_BRIEFS = null, NEWS_ARCH = null, DEALS_ARCH = null;
let dealsRendered = false;
let gurusRendered = false;
let valRendered = false;
let VAL_CUR = null;  // 현재 선택 종목 {key, rec, mk}
let heatmapRendered = false;
let macroRendered = false;
let newsRendered = false;
let calRendered = false;
let CAL = null;
let internalsRendered = false;
let rotationRendered = false;
let intCharts = [];
let LOOKUP_INDEX = null;
let LOOKUP_ST = null;
let chart = null;
let indChart = null;
let lookupChart = null;
let lookupInd = null;
let lookupSupply = null;
let simChart = null;
let applyRendered = false;
let rankRendered = false;
let regimeRendered = false;
let todayRendered = false;
let simRendered = false;
let lookupRendered = false;
let journalRendered = false;
let portfolioRendered = false;

const $ = (s) => document.querySelector(s);
const pct = (x, d = 2) => (x == null ? "-" : (x >= 0 ? "+" : "") + (x * 100).toFixed(d) + "%");

function tickerLabel(mk, tk) {
  if (mk === "kr") return (DATA.kr_names?.[tk] || tk) + ` (${tk})`;
  return tk;
}

/* ---------- 중분류(그룹) + 탭 ---------- */
const lastTabOfGroup = { research: "rank", discover: "today", market: "heatmap", journal: "portfolio" };

function activateTab(tabId) {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === tabId));
  document.querySelectorAll(".panel").forEach((x) => x.classList.toggle("active", x.id === "tab-" + tabId));
  const group = document.querySelector(`.tabs [data-tab="${tabId}"]`)?.closest(".tabs")?.dataset.groupTabs;
  if (group) lastTabOfGroup[group] = tabId;
  if (tabId === "rank" && !rankRendered) renderRank();
  if (tabId === "chart" && !chart) renderChartTab();
  if (tabId === "apply" && !applyRendered) renderApply();
  if (tabId === "today" && !todayRendered) renderToday();
  if (tabId === "lookup" && !lookupRendered) initLookup();
  if (tabId === "journal" && !journalRendered) initJournal();
  if (tabId === "portfolio" && !portfolioRendered) initPortfolio();
  if (tabId === "heatmap" && !heatmapRendered) renderHome();
  if (tabId === "calendar" && !calRendered) renderCalendar();
  if (tabId === "news" && !newsRendered) renderNews();
  if (tabId === "internals" && !internalsRendered) renderInternals();
  if (tabId === "rotation" && !rotationRendered) renderRotation();
  if (tabId === "gurus" && !gurusRendered) renderGurus();
}

document.querySelectorAll(".tab").forEach((b) =>
  b.addEventListener("click", () => activateTab(b.dataset.tab)));

document.querySelectorAll(".group").forEach((g) =>
  g.addEventListener("click", () => {
    document.querySelectorAll(".group").forEach((x) => x.classList.toggle("active", x === g));
    document.querySelectorAll(".tabs").forEach((nav) => {
      nav.style.display = (nav.dataset.groupTabs === g.dataset.group && !nav.classList.contains("solo")) ? "" : "none";
    });
    activateTab(lastTabOfGroup[g.dataset.group]);
  }));

/* ---------- 원칙 미니 도식 (어떤 차트 모양일 때 발동하나) ---------- */
// rule_id → 도식 shape. 없으면 side 기반 일반형.
const MINI_SHAPE = {
  disparity_low: "dispLow", capitulation: "dispLow",
  bb_lower_rsi: "bandLower", bb_lower_touch: "bandLower",
  bb_upper_rsi: "bandUpper", bb_upper_touch: "bandUpper",
  rsi_oversold_exit: "rsiLow", rsi_overbought_exit: "rsiHigh",
  macd_cross_up: "crossUp", macd_cross_up_below0: "crossUp",
  macd_cross_dn: "crossDn", macd_cross_dn_above0: "crossDn",
  golden_cross_5_20: "maCrossUp", golden_cross_20_60: "maCrossUp", aligned_up_first: "maCrossUp",
  dead_cross_5_20: "maCrossDn", dead_cross_20_60: "maCrossDn", aligned_down_first: "maCrossDn",
  ma60_break_dn: "maBreakDn", ma120_break_dn: "maBreakDn", ma20_break_dn_vol: "maBreakDnVol",
  ma60_support_bounce: "maBounce", pullback_ma20: "maBounce",
  long_bull_vol: "bigBullVol", long_bear_vol: "bigBearVol", bear_after_rally: "bigBearVol",
  hi52_obv_fade: "divergence", obv_breakout: "obvUp",
  stoch_overbought_turn: "stochHigh", stoch_oversold_turn: "stochLow",
  new_hi52: "newHigh", new_hi52_vol: "newHigh", new_lo52: "newLow",
  box_break: "boxUp", vol3_box_break: "boxUpVol", box_break_dn: "boxDn", box_break_dn_vol: "boxDn",
  gap_up_vol: "gapUp", gap_dn_ma20: "gapDn", squeeze_break_up: "boxUpVol",
  disparity_high: "dispHigh",
};
// 원칙별 추가 조건 주석 (도식 우상단에 표시)
const MINI_NOTE = {
  bb_lower_rsi: "+ RSI<30 동반", capitulation: "20일 -20% + 거래량 3배",
  bb_upper_rsi: "+ RSI>70 동반",
  macd_cross_up_below0: "0선 아래에서", macd_cross_dn_above0: "0선 위에서",
  golden_cross_5_20: "MA5 × MA20", golden_cross_20_60: "MA20 × MA60",
  dead_cross_5_20: "MA5 × MA20", dead_cross_20_60: "MA20 × MA60",
  aligned_up_first: "정배열 첫날", aligned_down_first: "역배열 첫날",
  ma60_break_dn: "60일선", ma120_break_dn: "120일선",
  ma60_support_bounce: "60일선 지지", pullback_ma20: "20일선 눌림목",
  new_hi52_vol: "+ 거래량 2배", vol3_box_break: "+ 거래량 3배",
  box_break_dn_vol: "+ 거래량 2배", squeeze_break_up: "스퀴즈 후 돌파",
  bear_after_rally: "20일 +20% 급등 후", gap_up_vol: "+ 거래량 2배",
  gap_dn_ma20: "+ 20일선 이탈",
};
// 도식 좌표계: viewBox 200×84. 가격영역 y6~58, 거래량 스트립 y64~78. 색: 가격 회색/MA 주황/장기 보라/기준 점선
const _T = (x, y, s, c = "#475569", a = "start", w = "") =>
  `<text x="${x}" y="${y}" font-size="9" fill="${c}" text-anchor="${a}" font-weight="${w || 400}" font-family="'Segoe UI','Malgun Gothic',sans-serif">${s}</text>`;
const _SIG = (x, y, buy) => buy
  ? `<path d="M${x},${y} l-5,9 h10 z" fill="#16a34a"/>${_T(x, y + 19, "매수", "#16a34a", "middle", 700)}`
  : `<path d="M${x},${y} l-5,-9 h10 z" fill="#dc2626"/>${_T(x, y - 13, "매도", "#dc2626", "middle", 700)}`;
const _VOLS = (bars) => bars.map(([x, h, big]) =>
  `<rect x="${x - 4}" y="${78 - h}" width="8" height="${h}" fill="${big ? "#f59e0b" : "#cbd5e1"}"/>`).join("");

const MINI = {
  dispLow: (b) => `${_T(6, 14, "주가가 20일선에서 -15% 이상 급락", "#64748b")}
    <path d="M6,30 Q100,32 194,38" stroke="#f39c12" fill="none" stroke-width="2"/>${_T(192, 27, "20일선", "#f39c12", "end")}
    <polyline points="6,30 40,35 75,40 118,58 150,50 194,42" stroke="#64748b" fill="none" stroke-width="2"/>
    <line x1="118" y1="35" x2="118" y2="56" stroke="#16a34a" stroke-dasharray="3 2"/>${_T(124, 48, "-15%↓", "#16a34a", "start", 700)}
    ${_SIG(118, 62, b)}`,
  dispHigh: (b) => `${_T(6, 78, "주가가 20일선에서 +15% 이상 과열", "#64748b")}
    <path d="M6,48 Q100,46 194,42" stroke="#f39c12" fill="none" stroke-width="2"/>${_T(192, 56, "20일선", "#f39c12", "end")}
    <polyline points="6,48 40,42 75,36 118,14 150,22 194,30" stroke="#64748b" fill="none" stroke-width="2"/>
    <line x1="118" y1="16" x2="118" y2="40" stroke="#dc2626" stroke-dasharray="3 2"/>${_T(124, 30, "+15%↑", "#dc2626", "start", 700)}
    ${_SIG(118, 10, b)}`,
  bandLower: (b) => `<path d="M6,16 Q100,13 194,18" stroke="#94a3b8" stroke-dasharray="4 3" fill="none" stroke-width="1.5"/>${_T(8, 12, "볼린저 상단(+2σ)", "#94a3b8")}
    <path d="M6,56 Q100,60 194,52" stroke="#94a3b8" stroke-dasharray="4 3" fill="none" stroke-width="1.5"/>${_T(8, 70, "볼린저 하단(-2σ)", "#94a3b8")}
    <polyline points="6,32 45,40 90,58 135,44 194,28" stroke="#64748b" fill="none" stroke-width="2"/>
    <circle cx="90" cy="58" r="3.5" fill="none" stroke="#16a34a" stroke-width="1.8"/>
    ${_T(100, 62, "종가가 하단 터치", "#16a34a", "start", 700)}${_SIG(90, 64, b)}`,
  bandUpper: (b) => `<path d="M6,16 Q100,13 194,18" stroke="#94a3b8" stroke-dasharray="4 3" fill="none" stroke-width="1.5"/>${_T(8, 12, "볼린저 상단(+2σ)", "#94a3b8")}
    <path d="M6,56 Q100,60 194,52" stroke="#94a3b8" stroke-dasharray="4 3" fill="none" stroke-width="1.5"/>${_T(8, 70, "볼린저 하단(-2σ)", "#94a3b8")}
    <polyline points="6,42 45,34 90,14 135,28 194,44" stroke="#64748b" fill="none" stroke-width="2"/>
    <circle cx="90" cy="14" r="3.5" fill="none" stroke="#dc2626" stroke-width="1.8"/>
    ${_T(100, 14, "종가가 상단 터치", "#dc2626", "start", 700)}${_SIG(90, 8, b)}`,
  rsiLow: (b) => `${_T(8, 14, "RSI(14)", "#2563eb", "start", 700)}
    <line x1="6" y1="52" x2="194" y2="52" stroke="#16a34a" stroke-dasharray="4 3" stroke-width="1.5"/>${_T(192, 48, "RSI 30 (과매도선)", "#16a34a", "end")}
    <polyline points="6,28 45,40 85,60 112,52 150,38 194,24" stroke="#2563eb" fill="none" stroke-width="2"/>
    <circle cx="112" cy="52" r="3.5" fill="none" stroke="#16a34a" stroke-width="1.8"/>
    ${_T(118, 68, "30을 상향 돌파", "#16a34a", "start", 700)}${_SIG(112, 58, b)}`,
  rsiHigh: (b) => `${_T(8, 76, "RSI(14)", "#2563eb", "start", 700)}
    <line x1="6" y1="30" x2="194" y2="30" stroke="#dc2626" stroke-dasharray="4 3" stroke-width="1.5"/>${_T(192, 26, "RSI 70 (과열선)", "#dc2626", "end")}
    <polyline points="6,54 45,42 85,20 112,30 150,44 194,58" stroke="#2563eb" fill="none" stroke-width="2"/>
    <circle cx="112" cy="30" r="3.5" fill="none" stroke="#dc2626" stroke-width="1.8"/>
    ${_T(118, 18, "70을 하향 이탈", "#dc2626", "start", 700)}${_SIG(112, 24, b)}`,
  crossUp: (b) => `<line x1="6" y1="40" x2="194" y2="40" stroke="#9ca3af" stroke-dasharray="4 3"/>${_T(192, 37, "0선", "#9ca3af", "end")}
    <polyline points="6,64 60,58 110,56 194,26" stroke="#2563eb" fill="none" stroke-width="2"/>${_T(8, 60, "MACD", "#2563eb", "start", 700)}
    <polyline points="6,54 60,58 110,58 194,48" stroke="#f59e0b" fill="none" stroke-width="1.8"/>${_T(8, 46, "시그널(9)", "#f59e0b")}
    <circle cx="116" cy="57" r="3.5" fill="none" stroke="#16a34a" stroke-width="1.8"/>
    ${_T(124, 74, "시그널 상향 교차", "#16a34a", "start", 700)}${_SIG(116, 63, b)}`,
  crossDn: (b) => `<line x1="6" y1="44" x2="194" y2="44" stroke="#9ca3af" stroke-dasharray="4 3"/>${_T(192, 56, "0선", "#9ca3af", "end")}
    <polyline points="6,20 60,26 110,28 194,58" stroke="#2563eb" fill="none" stroke-width="2"/>${_T(8, 18, "MACD", "#2563eb", "start", 700)}
    <polyline points="6,30 60,26 110,26 194,36" stroke="#f59e0b" fill="none" stroke-width="1.8"/>${_T(8, 40, "시그널(9)", "#f59e0b")}
    <circle cx="116" cy="27" r="3.5" fill="none" stroke="#dc2626" stroke-width="1.8"/>
    ${_T(124, 16, "시그널 하향 교차", "#dc2626", "start", 700)}${_SIG(116, 21, b)}`,
  maCrossUp: (b) => `<polyline points="6,56 80,48 130,38 194,18" stroke="#f39c12" fill="none" stroke-width="2"/>${_T(192, 14, "단기선", "#f39c12", "end", 700)}
    <polyline points="6,40 100,42 194,40" stroke="#8e44ad" fill="none" stroke-width="2"/>${_T(192, 52, "장기선", "#8e44ad", "end")}
    <circle cx="122" cy="41" r="3.5" fill="none" stroke="#16a34a" stroke-width="1.8"/>
    ${_T(10, 20, "단기선이 장기선을 상향 돌파", "#16a34a", "start", 700)}${_SIG(122, 47, b)}`,
  maCrossDn: (b) => `<polyline points="6,24 80,32 130,42 194,60" stroke="#f39c12" fill="none" stroke-width="2"/>${_T(192, 70, "단기선", "#f39c12", "end", 700)}
    <polyline points="6,40 100,38 194,40" stroke="#8e44ad" fill="none" stroke-width="2"/>${_T(192, 32, "장기선", "#8e44ad", "end")}
    <circle cx="118" cy="39" r="3.5" fill="none" stroke="#dc2626" stroke-width="1.8"/>
    ${_T(10, 66, "단기선이 장기선을 하향 돌파", "#dc2626", "start", 700)}${_SIG(118, 27, b)}`,
  maBreakDn: (b) => `<path d="M6,50 Q90,36 194,34" stroke="#f39c12" fill="none" stroke-width="2"/>${_T(192, 28, "추세선(MA)", "#f39c12", "end")}
    <polyline points="6,30 60,36 100,38 130,52 194,60" stroke="#64748b" fill="none" stroke-width="2"/>
    <circle cx="116" cy="43" r="3.5" fill="none" stroke="#dc2626" stroke-width="1.8"/>
    ${_T(10, 16, "종가가 이동평균선을 하향 돌파", "#dc2626", "start", 700)}${_SIG(116, 32, b)}`,
  maBreakDnVol: (b) => `<path d="M6,42 Q90,30 194,28" stroke="#f39c12" fill="none" stroke-width="2"/>${_T(192, 24, "20일선", "#f39c12", "end")}
    <polyline points="6,24 60,28 100,32 130,46 194,54" stroke="#64748b" fill="none" stroke-width="2"/>
    <circle cx="114" cy="36" r="3.5" fill="none" stroke="#dc2626" stroke-width="1.8"/>
    ${_T(10, 14, "20일선 하향 돌파 + 거래량 2배", "#dc2626", "start", 700)}
    ${_VOLS([[40, 6], [60, 5], [80, 7], [100, 6], [116, 13, 1], [140, 5]])}${_T(126, 76, "거래량 2배↑", "#b45309", "start", 700)}
    ${_SIG(114, 8, b)}`,
  maBounce: (b) => `<path d="M6,58 Q90,46 194,26" stroke="#f39c12" fill="none" stroke-width="2"/>${_T(192, 40, "이동평균(우상향)", "#f39c12", "end")}
    <polyline points="6,40 50,46 90,54 130,42 194,22" stroke="#64748b" fill="none" stroke-width="2"/>
    <circle cx="90" cy="54" r="3.5" fill="none" stroke="#16a34a" stroke-width="1.8"/>
    ${_T(10, 16, "이동평균선 터치 후 양봉 반등", "#16a34a", "start", 700)}${_SIG(90, 60, b)}`,
  bigBullVol: (b) => `${_T(10, 14, "장대양봉 + 거래량 3배", "#dc2626", "start", 700)}
    <g stroke="#94a3b8" stroke-width="1.5"><line x1="40" y1="36" x2="40" y2="52"/><line x1="64" y1="32" x2="64" y2="48"/><line x1="88" y1="34" x2="88" y2="50"/></g>
    <rect x="35" y="40" width="10" height="8" fill="#93c5fd"/><rect x="59" y="36" width="10" height="8" fill="#fecaca"/><rect x="83" y="38" width="10" height="8" fill="#93c5fd"/>
    <line x1="126" y1="12" x2="126" y2="56" stroke="#ef4444" stroke-width="1.5"/><rect x="119" y="16" width="14" height="36" fill="#ef4444"/>
    ${_VOLS([[40, 5], [64, 6], [88, 5], [126, 14, 1]])}${_T(138, 76, "거래량 3배↑", "#b45309", "start", 700)}
    ${_SIG(160, 40, b)}`,
  bigBearVol: (b) => `${_T(10, 78, "장대음봉 + 거래량 3배 (세력 이탈)", "#2563eb", "start", 700)}
    <g stroke="#94a3b8" stroke-width="1.5"><line x1="40" y1="18" x2="40" y2="34"/><line x1="64" y1="14" x2="64" y2="30"/><line x1="88" y1="16" x2="88" y2="32"/></g>
    <rect x="35" y="20" width="10" height="8" fill="#fecaca"/><rect x="59" y="18" width="10" height="8" fill="#93c5fd"/><rect x="83" y="20" width="10" height="8" fill="#fecaca"/>
    <line x1="126" y1="14" x2="126" y2="58" stroke="#3b82f6" stroke-width="1.5"/><rect x="119" y="18" width="14" height="36" fill="#3b82f6"/>
    ${_VOLS([[40, 5], [64, 6], [88, 5], [126, 14, 1]])}${_T(138, 76, "거래량 3배↑", "#b45309", "start", 700)}
    ${_SIG(126, 8, b)}`,
  divergence: (b) => `<polyline points="6,50 60,34 120,16 194,20" stroke="#64748b" fill="none" stroke-width="2"/>
    ${_T(116, 10, "주가는 52주 신고가", "#64748b", "start", 700)}
    <polyline points="6,38 60,36 120,42 194,58" stroke="#2563eb" fill="none" stroke-width="2"/>
    ${_T(126, 70, "OBV(수급)는 꺾임", "#2563eb", "start", 700)}
    <circle cx="146" cy="48" r="3.5" fill="none" stroke="#dc2626" stroke-width="1.8"/>${_SIG(158, 26, b)}`,
  obvUp: (b) => `<polyline points="6,36 70,34 130,32 194,30" stroke="#64748b" fill="none" stroke-width="2"/>${_T(8, 28, "주가(20일선 위)", "#64748b")}
    <polyline points="6,60 70,54 110,52 194,24" stroke="#2563eb" fill="none" stroke-width="2"/>${_T(8, 74, "OBV가 OBV 20일선 돌파", "#2563eb", "start", 700)}
    ${_SIG(116, 58, b)}`,
  stochHigh: (b) => `${_T(8, 76, "스토캐스틱 K(14,3)", "#2563eb")}
    <line x1="6" y1="24" x2="194" y2="24" stroke="#dc2626" stroke-dasharray="4 3" stroke-width="1.5"/>${_T(192, 20, "80 (과열)", "#dc2626", "end")}
    <polyline points="6,58 60,30 100,16 130,26 194,48" stroke="#2563eb" fill="none" stroke-width="2"/>
    <circle cx="112" cy="19" r="3.5" fill="none" stroke="#dc2626" stroke-width="1.8"/>
    ${_T(126, 12, "80 위에서 하락 반전", "#dc2626", "start", 700)}${_SIG(112, 13, b)}`,
  stochLow: (b) => `${_T(8, 14, "스토캐스틱 K(14,3)", "#2563eb")}
    <line x1="6" y1="56" x2="194" y2="56" stroke="#16a34a" stroke-dasharray="4 3" stroke-width="1.5"/>${_T(192, 70, "20 (과매도)", "#16a34a", "end")}
    <polyline points="6,22 60,48 100,62 130,52 194,32" stroke="#2563eb" fill="none" stroke-width="2"/>
    <circle cx="112" cy="59" r="3.5" fill="none" stroke="#16a34a" stroke-width="1.8"/>
    ${_T(126, 74, "20 아래서 상승 반전", "#16a34a", "start", 700)}${_SIG(112, 65, b)}`,
  newHigh: (b) => `<line x1="6" y1="26" x2="140" y2="26" stroke="#9ca3af" stroke-dasharray="4 3" stroke-width="1.5"/>${_T(8, 20, "기존 52주 최고가", "#9ca3af")}
    <polyline points="6,52 50,30 90,42 130,28 160,14 194,18" stroke="#64748b" fill="none" stroke-width="2"/>
    <circle cx="152" cy="18" r="3.5" fill="none" stroke="#16a34a" stroke-width="1.8"/>
    ${_T(120, 66, "종가가 신고가 경신", "#16a34a", "start", 700)}${_SIG(152, 24, b)}`,
  newLow: (b) => `<line x1="6" y1="52" x2="140" y2="52" stroke="#9ca3af" stroke-dasharray="4 3" stroke-width="1.5"/>${_T(8, 66, "기존 52주 최저가", "#9ca3af")}
    <polyline points="6,26 50,48 90,38 130,50 160,64 194,60" stroke="#64748b" fill="none" stroke-width="2"/>
    <circle cx="152" cy="61" r="3.5" fill="none" stroke="#dc2626" stroke-width="1.8"/>
    ${_T(120, 16, "종가가 신저가 경신", "#dc2626", "start", 700)}${_SIG(152, 55, b)}`,
  boxUp: (b) => `<line x1="6" y1="26" x2="194" y2="26" stroke="#9ca3af" stroke-dasharray="4 3" stroke-width="1.5"/>${_T(8, 20, "60일 박스 상단", "#9ca3af")}
    <polyline points="6,44 40,36 80,46 110,34 145,18 194,14" stroke="#64748b" fill="none" stroke-width="2"/>
    <circle cx="132" cy="26" r="3.5" fill="none" stroke="#16a34a" stroke-width="1.8"/>
    ${_T(60, 68, "박스권 상향 돌파", "#16a34a", "start", 700)}${_SIG(132, 32, b)}`,
  boxUpVol: (b) => `<line x1="6" y1="26" x2="194" y2="26" stroke="#9ca3af" stroke-dasharray="4 3" stroke-width="1.5"/>${_T(8, 20, "60일 박스 상단", "#9ca3af")}
    <polyline points="6,44 40,36 80,46 110,34 145,16 194,12" stroke="#64748b" fill="none" stroke-width="2"/>
    <circle cx="130" cy="26" r="3.5" fill="none" stroke="#16a34a" stroke-width="1.8"/>
    ${_VOLS([[50, 5], [75, 6], [100, 5], [130, 13, 1], [160, 6]])}${_T(140, 76, "거래량 급증", "#b45309", "start", 700)}
    ${_SIG(130, 32, b)}`,
  boxDn: (b) => `<line x1="6" y1="52" x2="194" y2="52" stroke="#9ca3af" stroke-dasharray="4 3" stroke-width="1.5"/>${_T(8, 66, "60일 박스 하단", "#9ca3af")}
    <polyline points="6,34 40,42 80,32 110,44 145,60 194,64" stroke="#64748b" fill="none" stroke-width="2"/>
    <circle cx="132" cy="52" r="3.5" fill="none" stroke="#dc2626" stroke-width="1.8"/>
    ${_T(60, 16, "박스권 하향 이탈", "#dc2626", "start", 700)}${_SIG(132, 46, b)}`,
  gapUp: (b) => `<polyline points="6,54 60,50 100,46" stroke="#64748b" fill="none" stroke-width="2"/>
    <polyline points="112,26 150,22 194,16" stroke="#64748b" fill="none" stroke-width="2"/>
    <line x1="100" y1="46" x2="112" y2="26" stroke="#dc2626" stroke-dasharray="3 2" stroke-width="1.5"/>
    ${_T(118, 42, "시가 갭 +3%↑", "#dc2626", "start", 700)}
    ${_VOLS([[40, 5], [70, 6], [112, 13, 1], [150, 6]])}${_T(124, 76, "거래량 2배↑", "#b45309", "start", 700)}
    ${_SIG(112, 32, b)}`,
  gapDn: (b) => `<polyline points="6,24 60,28 100,32" stroke="#64748b" fill="none" stroke-width="2"/>
    <polyline points="112,52 150,56 194,62" stroke="#64748b" fill="none" stroke-width="2"/>
    <line x1="100" y1="32" x2="112" y2="52" stroke="#3b82f6" stroke-dasharray="3 2" stroke-width="1.5"/>
    ${_T(118, 40, "시가 갭 -3%↓", "#2563eb", "start", 700)}${_SIG(112, 46, b)}`,
  _default: (b) => `<polyline points="6,${b ? 58 : 22} 70,${b ? 50 : 30} 120,${b ? 38 : 42} 194,${b ? 16 : 60}"
    stroke="#64748b" fill="none" stroke-width="2"/>${_SIG(120, b ? 44 : 36, b)}`,
};
function miniSvg(r) {
  const fn = MINI[MINI_SHAPE[r.rule_id]] || MINI._default;
  const note = MINI_NOTE[r.rule_id];
  return `<svg class="mini" viewBox="0 0 200 84" role="img" aria-label="${r.name} 도식">
    ${fn(r.side === "buy")}
    ${note ? `<rect x="${196 - note.length * 9 - 10}" y="2" width="${note.length * 9 + 8}" height="13" rx="3" fill="#eef2ff"/>` +
      _T(192, 12, note, "#4338ca", "end", 600) : ""}
  </svg>`;
}

/* ---------- 순위표 ---------- */
function card(r) {
  return `<div class="card ${r.side}">
    <h3>${r.name}</h3>
    <div class="desc">${r.desc}</div>
    ${miniSvg(r)}
    <div class="badges">
      <span class="badge hero">edge(20일) ${pct(r.edge20)}</span>
      <span class="badge">승률 ${(r.win_rate * 100).toFixed(1)}%</span>
      <span class="badge">표본 ${r.n.toLocaleString()}건</span>
      <span class="badge dim">t+5 ${pct(r.edge5)} · t+60 ${pct(r.edge60)}</span>
      <span class="badge dim">🇰🇷 ${pct(r.edge_kr)} · 🇺🇸 ${pct(r.edge_us)}</span>
      <span class="badge dim">전반 ${pct(r.edge_h1)} · 후반 ${pct(r.edge_h2)}</span>
      <span class="badge dim">p=${r.p20 < 1e-4 ? r.p20.toExponential(1) : r.p20.toFixed(4)}</span>
    </div>
  </div>`;
}

function rejectReason(r) {
  const why = [];
  if (!r.pass_n) why.push("표본 부족");
  if (!r.pass_halves) why.push("기간 불안정");
  if (!r.pass_markets) why.push(r.single_market ? `시장 편중(${r.single_market.toUpperCase()}만)` : "양시장 무의미");
  if (!r.pass_p) why.push("유의성 부족");
  return why.join(", ");
}

function ruleTable(rows, withReason) {
  const head = `<tr><th>원칙</th><th>방향</th><th>표본</th><th>edge(20일)</th><th>승률</th>
    <th>🇰🇷</th><th>🇺🇸</th>${withReason ? "<th>탈락 사유</th>" : ""}</tr>`;
  const body = rows.map((r) => `<tr>
    <td>${r.name}</td><td>${r.side === "buy" ? "매수" : "매도"}</td>
    <td>${r.n.toLocaleString()}</td>
    <td class="${r.edge20 >= 0 ? "pos" : "neg"}">${pct(r.edge20)}</td>
    <td>${(r.win_rate * 100).toFixed(0)}%</td>
    <td>${pct(r.edge_kr, 1)}</td><td>${pct(r.edge_us, 1)}</td>
    ${withReason ? `<td>${rejectReason(r)}</td>` : ""}</tr>`).join("");
  return head + body;
}

function renderRank() {
  rankRendered = true;
  if (!regimeRendered) renderRegime();  // 국면별 원칙(흡수 섹션)
  const m = DATA.meta;
  const nextRevalidate = (() => {
    const d = new Date(DATA.generated);
    d.setDate(d.getDate() + 90);
    return d.toISOString().slice(0, 10);
  })();
  $("#meta").innerHTML =
    `한국 ${m.n_kr}종목 + 미국 ${m.n_us}종목 · ${m.period} 일봉 · 신호 표본 ${m.n_events.toLocaleString()}건<br>
     원칙 기준일 <b>${DATA.generated}</b> · 다음 재검증 가능일 <b>${nextRevalidate}</b>
     <span title="재검증(update_rules.py)은 90일 텀 — 잦은 재검증은 과최적화. 재검증 시 사례차트·2026적용·국면별원칙 탭도 함께 갱신됨">ⓘ 90일 텀</span>
     · 오늘의 신호는 매일 07:40 자동 갱신`;
  $("#criteria").innerHTML =
    `<b>edge(우위)</b> = 신호 후 20영업일 수익률이 같은 시장·기간 '아무 날' 평균 대비 유리한 정도
     (매도원칙은 '팔았더니 평균보다 더 빠졌다'가 성공) · <b>생존 조건</b>: ${m.criteria}`;
  const sel = DATA.rules.filter((r) => r.selected);
  $("#buy-cards").innerHTML = sel.filter((r) => r.side === "buy").map(card).join("") || "<p>통과 원칙 없음</p>";
  $("#sell-cards").innerHTML = sel.filter((r) => r.side === "sell").map(card).join("") || "<p>통과 원칙 없음</p>";
  $("#passed-table").innerHTML = ruleTable(DATA.rules.filter((r) => r.passed && !r.selected), false);
  $("#rejected-table").innerHTML = ruleTable(DATA.rules.filter((r) => !r.passed), true);
}

/* ---------- 사례 차트 ---------- */
function renderChartTab() {
  const selRules = DATA.rules.filter((r) => r.selected && (DATA.examples[r.rule_id] || []).length);
  const ruleSel = $("#sel-rule");
  ruleSel.innerHTML = selRules.map((r) =>
    `<option value="${r.rule_id}">[${r.side === "buy" ? "매수" : "매도"}] ${r.name}</option>`).join("");
  ruleSel.onchange = () => fillExamples();
  $("#sel-example").onchange = () => drawChart();
  fillExamples();
}

function fillExamples() {
  const exs = DATA.examples[$("#sel-rule").value] || [];
  $("#sel-example").innerHTML = exs.map((e, i) =>
    `<option value="${i}">${tickerLabel(e.market, e.ticker)} · ${e.date}</option>`).join("");
  drawChart();
}

/* 원칙 → 하단 지표 패널 매핑 */
const IND_PANE = {
  bb_lower_rsi: "rsi", rsi_oversold_exit: "rsi",
  macd_cross_up_below0: "macd", macd_cross_dn: "macd", macd_cross_dn_above0: "macd",
  disparity_low: "disp",
  hi52_obv_fade: "obv",
  stoch_oversold_turn: "stoch", stoch_overbought_turn: "stoch",
};
const IND_LEGEND = {
  rsi: '보조지표: <span style="color:#2563eb">RSI(14)</span> + 30/70 기준선',
  macd: '보조지표: <span style="color:#2563eb">MACD(12,26)</span> · <span style="color:#f59e0b">시그널(9)</span> · 히스토그램 + 0선',
  disp: '보조지표: <span style="color:#2563eb">20일선 이격도</span> + -15%/0% 기준선',
  obv: '보조지표: <span style="color:#2563eb">OBV</span> · <span style="color:#f59e0b">OBV 20일선</span>',
  stoch: '보조지표: <span style="color:#2563eb">스토캐스틱 K(14,3)</span> + 20/80 기준선',
};

function chartWidth(el) {
  // 탭이 늦게 표시돼 clientWidth가 0일 때 대비한 폴백
  return el.clientWidth || el.parentElement.clientWidth || document.querySelector("main").clientWidth || 800;
}

function baseChartOpts(el, height) {
  return {
    width: chartWidth(el), height,
    layout: { background: { color: "#ffffff" }, textColor: "#374151" },
    grid: { vertLines: { color: "#f3f4f6" }, horzLines: { color: "#f3f4f6" } },
    rightPriceScale: { borderColor: "#e5e7eb", minimumWidth: 72 },
    timeScale: { borderColor: "#e5e7eb" },
  };
}

/* ---------- 클라이언트 TA (주봉·월봉 재계산용 — 일봉은 사전계산 컬럼 사용) ---------- */
function taEnrich(bars) {
  const c = bars.map((b) => b.c);
  const sma = (n, i) => (i + 1 >= n ? c.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n : null);
  const emaArr = (n) => { const k = 2 / (n + 1); let e = null; return c.map((v, i) => { e = e == null ? v : v * k + e * (1 - k); return i >= n - 1 ? e : null; }); };
  const e12 = emaArr(12), e26 = emaArr(26);
  const macd = c.map((_, i) => (e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null));
  let s9 = null;
  const macds = macd.map((m) => { if (m == null) return null; s9 = s9 == null ? m : m * 0.2 + s9 * 0.8; return s9; });
  let au = 0, ad = 0;
  const rsi = c.map((v, i) => {
    if (i === 0) return null;
    const ch = v - c[i - 1], up = Math.max(ch, 0), dn = Math.max(-ch, 0);
    if (i <= 14) { au += up / 14; ad += dn / 14; return i === 14 ? 100 - 100 / (1 + au / (ad || 1e-9)) : null; }
    au = (au * 13 + up) / 14; ad = (ad * 13 + dn) / 14;
    return 100 - 100 / (1 + au / (ad || 1e-9));
  });
  const rawK = bars.map((b, i) => {
    if (i < 13) return null;
    const w = bars.slice(i - 13, i + 1);
    const hh = Math.max(...w.map((x) => x.h)), ll = Math.min(...w.map((x) => x.l));
    return hh === ll ? 50 : (b.c - ll) / (hh - ll) * 100;
  });
  const stoch = rawK.map((v, i) => (v == null || rawK[i - 1] == null || rawK[i - 2] == null ? null : (rawK[i] + rawK[i - 1] + rawK[i - 2]) / 3));
  let o = 0;
  const obv = bars.map((b, i) => { if (i > 0) { if (b.c > bars[i - 1].c) o += b.v; else if (b.c < bars[i - 1].c) o -= b.v; } return o; });
  bars.forEach((b, i) => {
    b.ma5 = sma(5, i); b.ma20 = sma(20, i); b.ma60 = sma(60, i); b.ma120 = sma(120, i);
    if (b.ma20 != null) {
      const w = c.slice(i - 19, i + 1);
      const sd = Math.sqrt(w.reduce((a, v) => a + (v - b.ma20) ** 2, 0) / 20);
      b.bbu = b.ma20 + 2 * sd; b.bbd = b.ma20 - 2 * sd; b.disp = b.c / b.ma20 - 1;
    }
    b.rsi = rsi[i]; b.macd = macd[i]; b.macds = macds[i]; b.stoch = stoch[i];
    b.obv = obv[i]; b.obvm = i >= 19 ? obv.slice(i - 19, i + 1).reduce((a, v) => a + v, 0) / 20 : null;
  });
  return bars;
}

// 일봉 시계열 → 주봉/월봉 리샘플 (마지막 거래일을 봉 날짜로) + 지표 재계산
function resampleBars(series, tf) {
  if (tf === "d") return series;
  const keyOf = tf === "w"
    ? (t) => { const d = new Date(t + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10); }
    : (t) => t.slice(0, 7);
  const out = [];
  let cur = null, k0 = null;
  for (const x of series) {
    const k = keyOf(x.t);
    if (k !== k0) { if (cur) out.push(cur); cur = { t: x.t, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v }; k0 = k; }
    else { cur.h = Math.max(cur.h, x.h); cur.l = Math.min(cur.l, x.l); cur.c = x.c; cur.v += x.v; cur.t = x.t; }
  }
  if (cur) out.push(cur);
  return taEnrich(out);
}

// 오실레이터 패널 (종류 직접 지정 — 원칙 연동·수동 선택 공용)
function drawOscKind(el, kind, s, markerDates) {
  if (!kind) { el.style.display = "none"; return null; }
  el.style.display = "block";
  el.style.height = "160px";
  const c = LightweightCharts.createChart(el, baseChartOpts(el, 160));
  c.timeScale().applyOptions({ visible: false });

  const pts = (key) => s.filter((x) => x[key] != null).map((x) => ({ time: x.t, value: x[key] }));
  const addLine = (key, color, width = 2) => {
    const ser = c.addLineSeries({ color, lineWidth: width, priceLineVisible: false, lastValueVisible: false });
    ser.setData(pts(key));
    return ser;
  };
  const hline = (ser, value, color) =>
    ser.createPriceLine({ price: value, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true });

  let main;
  if (kind === "rsi") {
    main = addLine("rsi", "#2563eb");
    hline(main, 30, "#16a34a");
    hline(main, 70, "#dc2626");
  } else if (kind === "macd") {
    const hist = c.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
    hist.setData(s.filter((x) => x.macd != null && x.macds != null)
      .map((x) => ({ time: x.t, value: x.macd - x.macds, color: x.macd - x.macds >= 0 ? "#fca5a5" : "#93c5fd" })));
    addLine("macds", "#f59e0b");
    main = addLine("macd", "#2563eb");
    hline(main, 0, "#9ca3af");
  } else if (kind === "disp") {
    main = addLine("disp", "#2563eb");
    hline(main, -0.15, "#16a34a");
    hline(main, 0, "#9ca3af");
  } else if (kind === "obv") {
    addLine("obvm", "#f59e0b");
    main = addLine("obv", "#2563eb");
  } else if (kind === "stoch") {
    main = addLine("stoch", "#2563eb");
    hline(main, 20, "#16a34a");
    hline(main, 80, "#dc2626");
  }
  main.setMarkers((markerDates || []).map((d) => ({ time: d, position: "inBar", color: "#111827", shape: "circle" })));
  return c;
}

function drawIndicatorPane(el, ruleId, s, markerDates) {
  return drawOscKind(el, IND_PANE[ruleId], s, markerDates);
}

function drawChart() {
  const rule = DATA.rules.find((r) => r.rule_id === $("#sel-rule").value);
  const ex = (DATA.examples[rule.rule_id] || [])[+$("#sel-example").value];
  if (!ex) return;

  $("#rule-info").innerHTML =
    `<b>${rule.name}</b> — ${rule.desc}<br>
     ${tickerLabel(ex.market, ex.ticker)} · 신호일 <b>${ex.date}</b> ·
     이후 20영업일 실제 수익률 <b style="color:${(ex.fwd20 ?? 0) >= 0 ? "#16a34a" : "#dc2626"}">${pct(ex.fwd20)}</b>
     ${rule.side === "sell" ? "(매도원칙: 하락해야 성공)" : ""}`;

  if (chart) { chart.remove(); chart = null; }
  if (indChart) { indChart.remove(); indChart = null; }
  const el = $("#chart");
  chart = LightweightCharts.createChart(el, baseChartOpts(el, 420));

  const s = ex.series;
  const candles = chart.addCandlestickSeries({
    upColor: "#ef4444", downColor: "#3b82f6", borderUpColor: "#ef4444",
    borderDownColor: "#3b82f6", wickUpColor: "#ef4444", wickDownColor: "#3b82f6",
  }); // 국내 관례: 상승=빨강, 하락=파랑
  candles.setData(s.map((x) => ({ time: x.t, open: x.o, high: x.h, low: x.l, close: x.c })));

  const line = (key, color) => {
    const ser = chart.addLineSeries({ color, lineWidth: key === "ma20" || key === "ma60" ? 2 : 1,
      priceLineVisible: false, lastValueVisible: false });
    ser.setData(s.filter((x) => x[key] != null).map((x) => ({ time: x.t, value: x[key] })));
  };
  line("ma20", "#f39c12");
  line("ma60", "#8e44ad");
  line("bbu", "#b0b8bf");
  line("bbd", "#b0b8bf");

  const vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "" });
  chart.priceScale("").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  vol.setData(s.map((x) => ({ time: x.t, value: x.v, color: x.c >= x.o ? "#fecaca" : "#bfdbfe" })));

  const isBuy = rule.side === "buy";
  candles.setMarkers([{
    time: ex.date, position: isBuy ? "belowBar" : "aboveBar",
    color: isBuy ? "#16a34a" : "#dc2626", shape: isBuy ? "arrowUp" : "arrowDown",
    text: isBuy ? "매수신호" : "매도신호",
  }]);

  // 원칙에 해당하는 보조지표 서브차트 (두 패널 모두 동일 타임스탬프 → fitContent로 정렬)
  indChart = drawIndicatorPane($("#vol-chart"), rule.rule_id, s, [ex.date]);
  const legend = IND_PANE[rule.rule_id] ? " · " + IND_LEGEND[IND_PANE[rule.rule_id]] + " (●=신호일)" : "";
  $(".legend").innerHTML =
    `─ <span style="color:#f39c12">MA20</span> · <span style="color:#8e44ad">MA60</span> ·
     <span style="color:#95a5a6">볼린저밴드(20,2σ)</span> · ▲/▼ 신호 발생일${legend}`;

  fitAll();
  observeChartResize();
}

function fitAll() {
  const cw = chartWidth($("#chart"));
  if (chart) { chart.applyOptions({ width: cw }); chart.timeScale().fitContent(); }
  if (indChart) { indChart.applyOptions({ width: cw }); indChart.timeScale().fitContent(); }
}

// 컨테이너 폭 변화(탭 전환·창 크기·모바일 회전)에 맞춰 캔버스 재조정 — 0폭 생성 문제 방지
let _ro = null;
function observeChartResize() {
  if (_ro) return;
  _ro = new ResizeObserver(() => fitAll());
  _ro.observe($("#chart"));
}
window.addEventListener("resize", fitAll);

/* ---------- 2026 적용 ---------- */
const VERDICT_CLS = { "적용됨": "ok", "부분 적용": "partial", "적용 안됨": "fail", "신호 없음": "none", "진행중": "none" };

function renderApply() {
  if (!APPLY) { $("#apply-context").textContent = "apply2026.json 로드 실패 — python analysis\\apply2026.py 실행 필요"; return; }
  applyRendered = true;
  if (!simRendered) renderSim();  // 시뮬레이션(흡수 섹션)
  const c = APPLY.context;
  $("#apply-context").innerHTML =
    `<b>검증 기간</b> ${APPLY.period} · 신호 후 <b>${APPLY.horizon}영업일</b> 수익률로 판정<br>
     <b>2026년 시장 상황</b> — 🇰🇷 동일가중 평균 ${pct(c.kr.ew_ytd, 1)} (20일 베이스라인 ${pct(c.kr.base20)}),
     🇺🇸 동일가중 평균 ${pct(c.us.ew_ytd, 1)} (20일 베이스라인 ${pct(c.us.base20)})<br>
     <b>성공 기준</b> — 매수: 신호 후 상승 / 매도: 신호 후 하락 · <b>edge</b>는 시장 베이스라인 차감`;

  $("#apply-rule-table").innerHTML =
    `<tr><th>원칙</th><th>방향</th><th>신호</th><th>판정완료</th><th>적중률</th>
      <th>평균수익</th><th>edge</th><th>과거 edge</th><th>판정</th></tr>` +
    APPLY.rules.map((r) => `<tr>
      <td>${r.name}</td><td>${r.side === "buy" ? "매수" : "매도"}</td>
      <td>${r.n}</td><td>${r.n_done}</td>
      <td>${r.hit_rate == null ? "-" : (r.hit_rate * 100).toFixed(0) + "%"}</td>
      <td class="${(r.avg_ret ?? 0) >= 0 ? "pos" : "neg"}">${pct(r.avg_ret)}</td>
      <td class="${(r.avg_edge ?? 0) >= 0 ? "pos" : "neg"}">${pct(r.avg_edge)}</td>
      <td>${pct(r.hist_edge20)}</td>
      <td><span class="verdict ${VERDICT_CLS[r.verdict] || "none"}">${r.verdict}</span></td>
    </tr>`).join("");

  if (COMMENT) {
    $("#apply-commentary").innerHTML =
      `<h3>💡 왜 적용됐고, 왜 안 됐나</h3><p>${COMMENT.overall}</p>` +
      APPLY.rules.filter((r) => COMMENT.rules[r.rule_id])
        .map((r) => `<h3>${r.side === "buy" ? "🟢" : "🔴"} ${r.name} — ${r.verdict}</h3><p>${COMMENT.rules[r.rule_id]}</p>`).join("");
  }

  const ruleName = Object.fromEntries(APPLY.rules.map((r) => [r.rule_id, r.name]));
  $("#apply-stocks").innerHTML =
    `<div class="chart-legend">
       <span><span class="mk buy">▲</span> 매수신호 · <span class="mk sell">▼</span> 매도신호 &nbsp;|&nbsp;
       색: <span class="dot" style="background:#16a34a"></span> 적중 ·
       <span class="dot" style="background:#dc2626"></span> 실패 ·
       <span class="dot" style="background:#9ca3af"></span> 진행중(20일 미경과)</span>
     </div>` +
    APPLY.stocks.map((s, i) => {
      const done = s.signals.filter((x) => x.done);
      const wins = done.filter((x) => x.success).length;
      const rows = s.signals.map((x) => `<tr>
        <td>${x.date}</td>
        <td>${x.side === "buy" ? "🟢" : "🔴"} ${ruleName[x.rule_id] || x.rule_id}</td>
        <td class="${x.ret >= 0 ? "pos" : "neg"}">${pct(x.ret)}${x.done ? "" : " (진행중)"}</td>
        <td>${x.edge == null ? "-" : pct(x.edge)}</td>
        <td>${x.done ? (x.success ? "✅" : "❌") : "⏳"}</td>
      </tr>`).join("");
      return `<details class="stock-block" data-idx="${i}">
        <summary><b>${tickerLabel(s.market, s.ticker)}</b>
          <span class="ytd ${s.ytd >= 0 ? "pos" : "neg"}">2026 주가 ${pct(s.ytd, 1)}</span>
          <span class="sigcount">신호 ${s.signals.length}건${done.length ? ` · 적중 ${wins}/${done.length}` : ""}</span>
        </summary>
        ${s.signals.length ? `<div class="stock-chart" id="sc-${i}"></div>` : ""}
        <div class="tablewrap">${s.signals.length
          ? `<details class="sig-table"><summary>신호 표 (숫자 상세)</summary>
             <table><tr><th>신호일</th><th>원칙</th><th>이후 ${APPLY.horizon}일 수익률</th><th>edge</th><th>판정</th></tr>${rows}</table></details>`
          : `<p class="mini-note">2026년에 발생한 신호 없음</p>`}</div>
      </details>`;
    }).join("");

  // 상세 열 때 해당 종목 차트를 지연 렌더 (20개 동시 생성 방지)
  document.querySelectorAll("#apply-stocks .stock-block").forEach((el) => {
    el.addEventListener("toggle", () => {
      if (!el.open) return;
      const i = +el.dataset.idx;
      const host = document.getElementById("sc-" + i);
      if (!host || host.dataset.drawn) return;
      host.dataset.drawn = "1";
      drawStockChart(host, APPLY.stocks[i], ruleName);
    });
  });
}

function drawStockChart(host, stock, ruleName) {
  const s = stock.series;
  if (!s || !s.length) return;
  const c = LightweightCharts.createChart(host, baseChartOpts(host, 300));
  const candles = c.addCandlestickSeries({
    upColor: "#ef4444", downColor: "#3b82f6", borderUpColor: "#ef4444",
    borderDownColor: "#3b82f6", wickUpColor: "#ef4444", wickDownColor: "#3b82f6",
  });
  candles.setData(s.map((x) => ({ time: x.t, open: x.o, high: x.h, low: x.l, close: x.c })));

  const ma = c.addLineSeries({ color: "#f39c12", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  ma.setData(s.filter((x) => x.ma20 != null).map((x) => ({ time: x.t, value: x.ma20 })));

  const vol = c.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "" });
  c.priceScale("").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
  vol.setData(s.map((x) => ({ time: x.t, value: x.v, color: x.c >= x.o ? "#fecaca" : "#bfdbfe" })));

  // 신호 마커: 방향=화살표, 색=적중(초록)/실패(빨강)/진행중(회색)
  const markers = stock.signals.map((x) => {
    const color = x.done ? (x.success ? "#16a34a" : "#dc2626") : "#9ca3af";
    const buy = x.side === "buy";
    return {
      time: x.date, position: buy ? "belowBar" : "aboveBar",
      color, shape: buy ? "arrowUp" : "arrowDown",
      text: (ruleName[x.rule_id] || "").replace(/\(.*\)/, "").slice(0, 8),
    };
  }).sort((a, b) => (a.time < b.time ? -1 : 1));
  candles.setMarkers(markers);

  c.timeScale().fitContent();
  new ResizeObserver(() => c.applyOptions({ width: chartWidth(host) })).observe(host);
}

/* ---------- 국면별 원칙 ---------- */
const RG_LABEL = { bull: "🚀 급등장", neutral: "일반장", bear: "🐻 하락장" };
const GVERDICT_CLS = { "전천후": "ok", "일반장 중심": "partial" };

function edgeCell(v) {
  return v == null ? "<td>-</td>" : `<td class="${v >= 0 ? "pos" : "neg"}">${pct(v)}</td>`;
}

function renderRegime() {
  if (!REGIME) { $("#regime-def").textContent = "regimes.json 로드 실패 — python analysis\\regime_report.py 실행 필요"; return; }
  regimeRendered = true;

  const sh = REGIME.shares;
  $("#regime-def").innerHTML =
    `<b>국면 정의</b> — ${REGIME.def.text}<br>
     <b>지난 10년 국면 비중</b> — 🇰🇷 급등장 ${(sh.kr.bull * 100).toFixed(0)}% · 일반장 ${(sh.kr.neutral * 100).toFixed(0)}% · 하락장 ${(sh.kr.bear * 100).toFixed(0)}% /
     🇺🇸 급등장 ${(sh.us.bull * 100).toFixed(0)}% · 일반장 ${(sh.us.neutral * 100).toFixed(0)}% · 하락장 ${(sh.us.bear * 100).toFixed(0)}%<br>
     <b>${REGIME.criteria}</b>`;

  $("#regime-timeline").innerHTML = ["kr", "us"].map((mk) =>
    `<div class="tl-row"><b>${mk === "kr" ? "🇰🇷" : "🇺🇸"}</b> ` +
    REGIME.timeline[mk].map((p) =>
      `<span class="tl-chip ${p.regime}">${p.regime === "bull" ? "🚀" : "🐻"} ${p.start.slice(0, 7)}~${p.end.slice(0, 7)}</span>`
    ).join(" ") + `</div>`).join("");

  $("#regime-general-table").innerHTML =
    `<tr><th>원칙</th><th>방향</th><th>전체 edge</th><th>🚀 급등장</th><th>일반장</th><th>🐻 하락장</th><th>재분류</th></tr>` +
    REGIME.general_profile.map((r) => `<tr>
      <td>${r.name}</td><td>${r.side === "buy" ? "매수" : "매도"}</td>
      ${edgeCell(r.overall_edge)}${edgeCell(r.edge_bull)}${edgeCell(r.edge_neutral)}${edgeCell(r.edge_bear)}
      <td><span class="verdict ${GVERDICT_CLS[r.verdict] || "fail"}">${r.verdict}</span></td>
    </tr>`).join("");

  const byKey = {};
  REGIME.table.forEach((r) => { byKey[r.rule_id + "|" + r.regime] = r; });
  const regimeCard = (rid, rg) => {
    const r = byKey[rid + "|" + rg];
    if (!r) return "";
    return `<div class="card ${r.side}">
      <h3>${r.side === "buy" ? "🟢" : "🔴"} ${r.name}</h3>
      <div class="desc">${r.desc}</div>
      ${miniSvg(r)}
      <div class="badges">
        <span class="badge hero">edge(20일) ${pct(r.edge20)}</span>
        <span class="badge">승률 ${(r.win_rate * 100).toFixed(1)}%</span>
        <span class="badge">표본 ${r.n.toLocaleString()}건</span>
        <span class="badge dim">🇰🇷 ${pct(r.edge_kr)} (${r.n_kr}) · 🇺🇸 ${pct(r.edge_us)} (${r.n_us})</span>
        <span class="badge dim">p=${r.p20 < 1e-4 ? r.p20.toExponential(1) : r.p20.toFixed(4)}</span>
        ${r.single_market ? `<span class="badge dim">⚠ ${r.single_market.toUpperCase()} 표본 위주</span>` : ""}
      </div>
    </div>`;
  };
  $("#regime-bull").innerHTML =
    [...REGIME.picks.bull_buy.map((id) => regimeCard(id, "bull")),
     ...REGIME.picks.bull_sell.map((id) => regimeCard(id, "bull"))].join("") || "<p>생존 원칙 없음</p>";
  $("#regime-bear").innerHTML =
    [...REGIME.picks.bear_buy.map((id) => regimeCard(id, "bear")),
     ...REGIME.picks.bear_sell.map((id) => regimeCard(id, "bear"))].join("") || "<p>생존 원칙 없음</p>";

  if (RCOMMENT) {
    $("#regime-commentary").innerHTML =
      `<h3>💡 종합 판단 — 2026년 재검증과 국면별 원칙</h3><p>${RCOMMENT.overall}</p>` +
      (RCOMMENT.sections || []).map((s) => `<h3>${s.title}</h3><p>${s.body}</p>`).join("");
  }
}

/* ---------- 오늘의 신호 ---------- */
const REGIME_KO = { bull: "🚀 급등장", neutral: "일반장", bear: "🐻 하락장" };

function renderToday() {
  if (!TODAY) { $("#today-context").textContent = "today_signals.json 없음 — python analysis\\scan_today.py 실행 필요"; return; }
  todayRendered = true;
  $("#today-context").innerHTML =
    `<b>기준일</b> ${TODAY.asof} (최근 ${TODAY.lookback_days}영업일 신호) · <b>현재 국면</b>
     🇰🇷 ${REGIME_KO[TODAY.regime.kr]} · 🇺🇸 ${REGIME_KO[TODAY.regime.us]}<br>
     회색 신호 = 검증된 원칙이지만 <b>현재 국면에서는 꺼짐</b>(참고만). 갱신:
     <code>collect.py --refresh</code> → <code>scan_today.py</code>`;

  $("#today-rules").innerHTML =
    `<tr><th>원칙</th><th>방향</th><th>구분</th><th>🇰🇷</th><th>🇺🇸</th></tr>` +
    TODAY.rules.map((r) => `<tr>
      <td>${r.name}</td><td>${r.side === "buy" ? "🟢 매수" : "🔴 매도"}</td>
      <td>${r.scope === "general" ? "일반" : r.scope === "bull" ? "급등장 전용" : "하락장 전용"}</td>
      <td>${r.active_kr ? "✅ 켜짐" : "⛔ 꺼짐"}</td><td>${r.active_us ? "✅ 켜짐" : "⛔ 꺼짐"}</td>
    </tr>`).join("");

  ["today-mk", "today-side", "today-active-only"].forEach((id) =>
    document.getElementById(id).addEventListener("change", fillTodayTable));
  fillTodayTable();
}

function fillTodayTable() {
  const mk = $("#today-mk").value, side = $("#today-side").value;
  const activeOnly = $("#today-active-only").checked;
  const rows = TODAY.signals.filter((s) =>
    (!mk || s.market === mk) && (!side || s.side === side) && (!activeOnly || s.active));
  $("#today-table").innerHTML =
    `<tr><th>신호일</th><th>종목</th><th>원칙</th><th>방향</th><th>종가</th><th>국면상</th><th>차트</th></tr>` +
    (rows.length ? rows.map((s, i) => `<tr style="${s.active ? "" : "opacity:.45"}">
      <td>${s.date}</td>
      <td><a href="#" class="goto-lookup" data-key="${s.market}_${s.ticker}">${s.market === "kr" ? s.name + " (" + s.ticker + ")" : s.ticker}</a></td>
      <td>${s.rule}</td><td>${s.side === "buy" ? "🟢 매수" : "🔴 매도"}</td>
      <td>${s.price.toLocaleString()}</td><td>${s.active ? "✅ 유효" : "⛔ 꺼짐"}</td>
      <td><button class="today-chart-btn" data-i="${i}">📈 보기</button></td>
    </tr>`).join("") : `<tr><td colspan="7">조건에 맞는 신호 없음</td></tr>`);
  document.querySelectorAll(".goto-lookup").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      document.querySelector('[data-tab="lookup"]').click();
      loadLookup(a.dataset.key);
    }));
  document.querySelectorAll(".today-chart-btn").forEach((b) =>
    b.addEventListener("click", () => toggleTodayChart(b, rows[+b.dataset.i])));
}

// 신호 행 아래에 해당 종목 미니차트 펼침 — 신호일 ★ 강조 + 같은 원칙의 과거 신호 + 원칙 보조지표 패널
let todayChart = null;
let todayInd = null;
function toggleTodayChart(btn, sig) {
  const tr = btn.closest("tr");
  const open = tr.nextElementSibling?.classList.contains("today-chart-row");
  document.querySelectorAll(".today-chart-row").forEach((r) => r.remove());
  if (todayChart) { todayChart.remove(); todayChart = null; }
  if (todayInd) { todayInd.remove(); todayInd = null; }
  document.querySelectorAll(".today-chart-btn").forEach((x) => { x.textContent = "📈 보기"; });
  if (open) return;  // 이미 열려 있었으면 닫기만
  btn.textContent = "▲ 닫기";
  const row = document.createElement("tr");
  row.className = "today-chart-row";
  row.innerHTML = `<td colspan="7"><div class="chart" style="height:300px"></div>
    <div class="chart today-ind" style="height:150px;margin-top:6px;display:none"></div><p class="legend"></p></td>`;
  tr.after(row);
  fetch(`data/stocks/${sig.market}_${sig.ticker}.json` + _cb)
    .then((r) => (r.ok ? r.json() : null)).then((st) => {
      const el = row.querySelector(".chart");
      if (!st) { el.textContent = "차트 데이터 없음 (stocks JSON 미생성 종목)"; el.style.padding = "20px"; return; }
      if (!st._ta) { taEnrich(st.series); st._ta = true; }
      const s = st.series.slice(-130);
      todayChart = LightweightCharts.createChart(el, baseChartOpts(el, 300));
      const cd = todayChart.addCandlestickSeries({
        upColor: "#ef4444", downColor: "#3b82f6", borderUpColor: "#ef4444",
        borderDownColor: "#3b82f6", wickUpColor: "#ef4444", wickDownColor: "#3b82f6",
      });
      cd.setData(s.map((x) => ({ time: x.t, open: x.o, high: x.h, low: x.l, close: x.c })));
      const line = (k, color) => {
        const ser = todayChart.addLineSeries({ color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
        ser.setData(s.filter((x) => x[k] != null).map((x) => ({ time: x.t, value: x[k] })));
      };
      line("ma20", "#f39c12"); line("ma60", "#8e44ad");
      // 볼린저 계열 원칙은 밴드 오버레이 (점선)
      const bbRule = /^bb_|bollinger/.test(sig.rule_id);
      if (bbRule) {
        const dashed = (k) => {
          const ser = todayChart.addLineSeries({ color: "#b0b8bf", lineWidth: 1, lineStyle: 2,
            priceLineVisible: false, lastValueVisible: false });
          ser.setData(s.filter((x) => x[k] != null).map((x) => ({ time: x.t, value: x[k] })));
        };
        dashed("bbu"); dashed("bbd");
      }
      const t0 = s[0].t;
      const marks = st.markers.filter((m) => m.rule_id === sig.rule_id && m.t >= t0);
      cd.setMarkers(marks.map((m) => ({
        time: m.t, position: m.side === "buy" ? "belowBar" : "aboveBar",
        color: m.t === sig.date ? "#111827" : (m.side === "buy" ? "#16a34a" : "#dc2626"),
        shape: m.side === "buy" ? "arrowUp" : "arrowDown",
        text: m.t === sig.date ? "★오늘" : "",
      })));
      todayChart.timeScale().fitContent();
      // 원칙의 보조지표 패널 (MACD 교차·RSI·스토캐·OBV·이격도 원칙이면 해당 지표 표시)
      const kind = IND_PANE[sig.rule_id];
      let indLegend = "";
      if (kind) {
        todayInd = drawOscKind(row.querySelector(".today-ind"), kind, s, marks.map((m) => m.t));
        todayInd?.timeScale().fitContent();
        indLegend = " · " + IND_LEGEND[kind] + " (●=신호일)";
      }
      row.querySelector(".legend").innerHTML =
        `<b>${sig.rule}</b> 신호 — ★=이번 신호(${sig.date}) · 초록/빨강 화살표=같은 원칙의 최근 6개월 신호 ·
         ─ <span style="color:#f39c12">MA20</span> <span style="color:#8e44ad">MA60</span>${bbRule ? ' · <span style="color:#b0b8bf">볼린저밴드(점선)</span>' : ""}${indLegend} ·
         상세 분석은 종목명 클릭 → 종목 조회`;
    });
}

/* ---------- 종목 조회 ---------- */
function initLookup() {
  lookupRendered = true;
  fetch("data/stocks/index.json" + _cb).then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (!j) { $("#lookup-info").style.display = "block"; $("#lookup-info").textContent = "stocks/index.json 없음 — python analysis\\stock_pages.py 실행 필요"; return; }
    LOOKUP_INDEX = j.stocks;
    $("#lookup-list").innerHTML = LOOKUP_INDEX.map((s) =>
      `<option value="${s.market === "kr" ? s.name + " (" + s.ticker + ")" : s.ticker}">`).join("");
    $("#lookup-q").addEventListener("change", () => {
      const q = $("#lookup-q").value.trim().toLowerCase();
      const hit = LOOKUP_INDEX.find((s) =>
        q === s.ticker.toLowerCase() || q === s.name.toLowerCase() ||
        q === (s.name + " (" + s.ticker + ")").toLowerCase() ||
        s.name.toLowerCase().includes(q) || s.ticker.toLowerCase().includes(q));
      if (hit) loadLookup(hit.market + "_" + hit.ticker);
    });
  });
}

function loadLookup(key) {
  fetch(`data/stocks/${key}.json` + _cb).then((r) => (r.ok ? r.json() : null)).then((st) => {
    if (!st) return;
    LOOKUP_ST = st;
    ["lookup-info", "lookup-chart", "lookup-legend", "lookup-stats-title", "lookup-stats-wrap",
     "lookup-rule-wrap", "lookup-two", "lookup-filter", "lookup-profile"]
      .forEach((id) => { document.getElementById(id).style.display = ""; });
    $("#lookup-rule-wrap").style.display = "inline";
    $("#lookup-two").style.display = "grid";
    $("#lookup-filter").style.display = "flex";
    $("#lookup-q").value = st.market === "kr" ? `${st.name} (${st.ticker})` : st.ticker;
    renderLookupFund(st.market, st.ticker, st.series);  // 재무 스냅샷 카드
    renderLookupLinks(st);                     // 외부 심층 정보 링크
    renderLookupProfile(st);                   // 종목 프로파일(자체 계산)+참고 내재가치
    renderLookupStory(st);                     // 원칙 내러티브
    drawSupply(st);                            // 수급(외국인·기관 누적 순매수)
    buildSigChips(st);                         // 원칙별 신호수 칩
    // 봉 주기·보조지표 컨트롤 (1회 바인딩)
    const tfbar = $("#lookup-tfbar");
    tfbar.style.display = "flex";
    if (!tfbar.dataset.bound) {
      tfbar.dataset.bound = "1";
      tfbar.querySelectorAll("#lookup-tf button").forEach((b) => b.onclick = () => {
        lookupTf = b.dataset.tf;
        tfbar.querySelectorAll("#lookup-tf button").forEach((x) => x.classList.toggle("active", x === b));
        drawLookupChart();
      });
      $("#lookup-osc").onchange = () => { lookupOsc = $("#lookup-osc").value; drawLookupChart(); };
      tfbar.querySelectorAll("#lookup-range button").forEach((b) => b.onclick = () => {
        lookupRange = +b.dataset.n;
        tfbar.querySelectorAll("#lookup-range button").forEach((x) => x.classList.toggle("active", x === b));
        drawLookupChart();
      });
    }
    // 심화 데이터(개요·컨센서스·연간실적·공시·뉴스) — lazy 로드 후 렌더
    renderLookupHead(st);
    loadExtras().then(() => {
      if (LOOKUP_ST !== st) return;  // 로드 중 다른 종목으로 이동한 경우
      renderLookupHead(st);
      renderLookupOverview(st);
      renderLookupCons(st);
      renderLookupFin(st);
      renderLookupFeed(st);
    });
    document.querySelectorAll('input[name="sigfilter"]').forEach((r) => { r.onchange = drawLookupChart; });

    // 원칙 드롭다운: 전체 + 이 종목에 신호가 있는 원칙만
    const present = st.stats.filter((s) => st.markers.some((m) => m.rule_id === s.rule_id));
    $("#lookup-rule").innerHTML =
      `<option value="">전체 신호 (화살표만)</option>` +
      present.map((s) => `<option value="${s.rule_id}">${s.side === "buy" ? "🟢" : "🔴"} ${s.name}</option>`).join("");
    $("#lookup-rule").onchange = drawLookupChart;
    drawLookupChart();

    $("#lookup-stats").innerHTML =
      `<tr><th>원칙</th><th>방향</th><th>구분</th><th>신호수</th><th>승률</th><th>평균 20일 수익</th></tr>` +
      st.stats.map((s) => `<tr>
        <td>${s.name}</td><td>${s.side === "buy" ? "🟢" : "🔴"}</td>
        <td>${s.scope === "general" ? "일반" : s.scope === "bull" ? "급등장" : "하락장"}</td>
        <td>${s.n}</td><td>${(s.win * 100).toFixed(0)}%</td>
        <td class="${s.avg_fwd20 >= 0 ? "pos" : "neg"}">${pct(s.avg_fwd20)}</td>
      </tr>`).join("");
  });
}

let lookupTf = "d";   // 일/주/월봉
let lookupOsc = "";   // 수동 선택 오실레이터 ("" = 원칙 연동)
const TF_KO = { d: "일봉", w: "주봉", m: "월봉" };

let lookupRange = 250;  // 표시 봉 수: 1년 250 / 3년 750 / 5년 1250

function drawLookupChart() {
  const st = LOOKUP_ST;
  if (!st._ta) { taEnrich(st.series); st._ta = true; }  // 지표는 클라이언트 계산(OHLCV 슬림 JSON)
  const tf = lookupTf;
  const ranged = st.series.slice(-lookupRange);
  const s = resampleBars(ranged, tf);
  const selRule = $("#lookup-rule").value;  // "" = 전체
  $("#lookup-info").innerHTML =
    `<b>${st.market === "kr" ? st.name + " (" + st.ticker + ")" : st.ticker}</b> · 기준일 ${st.asof} · ${TF_KO[tf]}`
    + (tf === "d" ? " · 최근 1.5년" : " (1.5년 일봉 집계)")
    + (selRule ? ` · 선택 원칙 신호만` : ` · 신호 라벨 = 원칙 축약(범례 하단)`);

  if (lookupChart) { lookupChart.remove(); lookupChart = null; }
  if (lookupInd) { lookupInd.remove(); lookupInd = null; }
  const el = $("#lookup-chart");
  lookupChart = LightweightCharts.createChart(el, baseChartOpts(el, 420));
  const candles = lookupChart.addCandlestickSeries({
    upColor: "#ef4444", downColor: "#3b82f6", borderUpColor: "#ef4444",
    borderDownColor: "#3b82f6", wickUpColor: "#ef4444", wickDownColor: "#3b82f6",
  });
  candles.setData(s.map((x) => ({ time: x.t, open: x.o, high: x.h, low: x.l, close: x.c })));

  const line = (key2, color, width, dashed) => {
    const ser = lookupChart.addLineSeries({ color, lineWidth: width || 1,
      lineStyle: dashed ? 2 : 0, priceLineVisible: false, lastValueVisible: false });
    ser.setData(s.filter((x) => x[key2] != null).map((x) => ({ time: x.t, value: x[key2] })));
  };
  line("ma20", "#f39c12", 2);
  line("ma60", "#8e44ad", 2);
  line("ma120", "#0891b2", 2);         // 120일선 추가
  line("bbu", "#b0b8bf", 1, true);     // 볼린저 상단(점선)
  line("bbd", "#b0b8bf", 1, true);     // 볼린저 하단(점선)

  const vol = lookupChart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "" });
  lookupChart.priceScale("").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
  vol.setData(s.map((x) => ({ time: x.t, value: x.v, color: x.c >= x.o ? "#fecaca" : "#bfdbfe" })));

  // 마커: 축약 라벨로 어떤 원칙인지 항상 식별 + 국면 적용(진한색)/미적용(회색) 구분 + 필터
  const filt = document.querySelector('input[name="sigfilter"]:checked')?.value || "core";
  const shown = st.markers.filter((m) => {
    if (selRule && m.rule_id !== selRule) return false;
    if (filt === "core" && !SELECTED_RULES.has(m.rule_id)) return false;  // ⭐ 최종 채택 원칙만(기본)
    const on = ruleActive(m.rule_id, st.market);
    if (filt === "on" && !on) return false;
    if (filt === "off" && on) return false;
    return true;
  });
  // 주/월봉에서는 일 단위 신호일을 해당 봉으로 스냅
  const barTimes = s.map((x) => x.t);
  const t0 = barTimes[0];
  const snap = (t) => {
    if (t < t0) return null;  // 표시 범위 밖
    if (tf === "d") return t;
    for (const bt of barTimes) if (bt >= t) return bt;
    return null;
  };
  candles.setMarkers(shown.map((m) => {
    const bt = snap(m.t);
    if (!bt) return null;
    const on = ruleActive(m.rule_id, st.market);
    return {
      time: bt, position: m.side === "buy" ? "belowBar" : "aboveBar",
      color: on ? (m.side === "buy" ? "#16a34a" : "#dc2626") : "#9ca3af",
      shape: m.side === "buy" ? "arrowUp" : "arrowDown",
      text: selRule ? m.name.replace(/\(.*\)/, "").slice(0, 8) : (RULE_ABBR[m.rule_id] || ""),
    };
  }).filter(Boolean));

  // 보조지표 패널: 수동 선택 우선, 없으면 선택 원칙 연동
  let legendExtra = "";
  const oscKind = lookupOsc || (selRule && IND_PANE[selRule]) || "";
  if (oscKind) {
    const dates = (!lookupOsc && selRule) ? shown.map((m) => snap(m.t)).filter(Boolean) : [];
    lookupInd = drawOscKind($("#lookup-ind"), oscKind, s, dates);
    legendExtra = " · " + IND_LEGEND[oscKind] + (dates.length ? " (●=신호일)" : "");
  } else {
    $("#lookup-ind").style.display = "none";
  }

  const abbrLegend = st.stats.filter((s) => RULE_ABBR[s.rule_id])
    .map((s) => `<b>${RULE_ABBR[s.rule_id]}</b>=${s.name.replace(/\(.*\)/, "")}`).join(" · ");
  $("#lookup-legend").innerHTML =
    `─ <span style="color:#f39c12">MA20</span> · <span style="color:#8e44ad">MA60</span> ·
     <span style="color:#0891b2">MA120</span> · <span style="color:#95a5a6">볼린저밴드(20,2σ 점선)</span> ·
     <span style="color:#16a34a">▲매수</span>/<span style="color:#dc2626">▼매도</span> ·
     <span style="color:#9ca3af">회색=현 국면 미적용 원칙</span>${legendExtra}<br>
     <span class="sub-note">신호 축약: ${abbrLegend}</span>`;

  const cw = chartWidth(el);
  lookupChart.applyOptions({ width: cw });
  lookupChart.timeScale().fitContent();
  if (lookupInd) { lookupInd.applyOptions({ width: cw }); lookupInd.timeScale().fitContent(); }
}

/* ---------- 시뮬레이션 ---------- */
const SIM_COLORS = { combo: "#2563eb", combo_regime: "#16a34a", combo_sellexit: "#8e44ad", bench: "#9ca3af" };
const RULE_COLORS = ["#f59e0b", "#ec4899", "#14b8a6", "#f97316", "#6366f1"];

function renderSim() {
  if (!SIM) { $("#sim-method").textContent = "strategy.json 없음 — python analysis\\simulate.py 실행 필요"; return; }
  simRendered = true;
  $("#sim-method").innerHTML = `<b>방법론</b> — ${SIM.method}`;

  let ri = 0;
  const colors = {};
  SIM.curves.forEach((c) => { colors[c.id] = SIM_COLORS[c.id] || RULE_COLORS[ri++ % RULE_COLORS.length]; });
  const defaultOn = new Set(["combo", "combo_regime", "combo_sellexit", "bench"]);

  $("#sim-toggle").innerHTML = SIM.curves.map((c) => `<label style="white-space:nowrap">
    <input type="checkbox" class="sim-cb" value="${c.id}" ${defaultOn.has(c.id) ? "checked" : ""}>
    <span style="color:${colors[c.id]};font-weight:600">■</span> ${c.name}</label>`).join(" ");

  const draw = () => {
    const on = new Set([...document.querySelectorAll(".sim-cb:checked")].map((x) => x.value));
    if (simChart) { simChart.remove(); simChart = null; }
    const el = $("#sim-chart");
    simChart = LightweightCharts.createChart(el, {
      ...baseChartOpts(el, 400),
      rightPriceScale: { borderColor: "#e5e7eb", mode: LightweightCharts.PriceScaleMode.Logarithmic },
    });
    SIM.curves.filter((c) => on.has(c.id)).forEach((c) => {
      const ser = simChart.addLineSeries({ color: colors[c.id], lineWidth: c.kind === "bench" ? 1 : 2,
        priceLineVisible: false, lastValueVisible: false, title: c.name });
      ser.setData(c.points.map((p) => ({ time: p.t, value: p.v })));
    });
    simChart.timeScale().fitContent();
  };
  document.querySelectorAll(".sim-cb").forEach((cb) => cb.addEventListener("change", draw));
  draw();

  $("#sim-stats").innerHTML =
    `<tr><th>전략</th><th>최종 배수</th><th>CAGR</th><th>MDD</th><th>거래수</th><th>거래 승률</th></tr>` +
    SIM.curves.map((c) => `<tr>
      <td><span style="color:${colors[c.id]}">■</span> ${c.name}</td>
      <td>${c.stats.final}x</td>
      <td class="${c.stats.cagr >= 0 ? "pos" : "neg"}">${pct(c.stats.cagr, 1)}</td>
      <td class="neg">${pct(c.stats.mdd, 1)}</td>
      <td>${c.stats.trades.toLocaleString()}</td>
      <td>${c.stats.win_rate == null ? "-" : (c.stats.win_rate * 100).toFixed(0) + "%"}</td>
    </tr>`).join("");
}

/* ---------- 마켓: 홈 (히트맵·지수카드·오늘의종목·주요뉴스) ---------- */
// 이산 7단계 다이버징, 라이트 배경용 (상승=빨강/하락=파랑 국내 관례 유지)
// light=true 구간은 옅은 배경이라 진회색 글자를 써야 4.5:1 유지
const HM_STEPS = [
  { min: 3, c: "#d93036", label: "+3%↑" },
  { min: 2, c: "#e0575c", label: "+2%" },
  { min: 0.25, c: "#f2b0b3", label: "+1%", light: true },
  { min: -0.25, c: "#e8eaef", label: "0", light: true },
  { min: -2, c: "#adc6f0", label: "-1%", light: true },
  { min: -3, c: "#4f7de0", label: "-2%" },
  { min: -Infinity, c: "#1e63e0", label: "-3%↓" },
];
function hmStep(chgPct) {
  if (chgPct >= 3) return HM_STEPS[0];
  if (chgPct >= 2) return HM_STEPS[1];
  if (chgPct >= 0.25) return HM_STEPS[2];
  if (chgPct > -0.25) return HM_STEPS[3];
  if (chgPct > -2) return HM_STEPS[4];
  if (chgPct > -3) return HM_STEPS[5];
  return HM_STEPS[6];
}
function hmColor(chgPct) { return hmStep(chgPct).c; }
function hmText(chgPct) { return hmStep(chgPct).light ? "#374151" : "#ffffff"; }
function chgColor(chg) { return hmColor(chg * 100); }  // 섹터 로테이션 테이블 셀에서 재사용

// 홈 탭 상태: 국내/미국 토글(카드·히트맵·오늘의종목 공유) + 섹터 확대 + 무버스 카테고리
let homeMk = "kr";
let hmZoomSector = null;
let moverCat = "value";

// squarify 간이 구현: 남은 영역의 짧은 변을 따라 한 줄씩, worst aspect가 나빠지기 직전까지 채움
function layoutTreemap(items, W, H) {
  const rects = [];
  const list = items.filter((it) => it.w > 0);
  let x0 = 0, y0 = 0, w = W, h = H, i = 0;
  while (i < list.length && w > 1 && h > 1) {
    const remaining = list.slice(i);
    const remSum = remaining.reduce((s, x) => s + x.w, 0);
    const horiz = w >= h;          // true면 왼쪽에 세로 줄(열)로 배치
    const side = horiz ? h : w;    // 줄이 늘어서는 변의 길이
    let best = null;
    for (let j = 1; j <= remaining.length; j++) {
      const row = remaining.slice(0, j);
      const rowSum = row.reduce((s, x) => s + x.w, 0);
      const thick = (rowSum / remSum) * (horiz ? w : h);
      let worst = 0;
      for (const it of row) {
        const len = (it.w / rowSum) * side;
        worst = Math.max(worst, thick / len, len / thick);
      }
      if (!best || worst <= best.worst) best = { row, rowSum, thick, worst };
      else break;
    }
    let off = 0;
    for (const it of best.row) {
      const len = (it.w / best.rowSum) * side;
      rects.push(horiz
        ? { ...it, x: x0, y: y0 + off, w2: best.thick, h2: len }
        : { ...it, x: x0 + off, y: y0, w2: len, h2: best.thick });
      off += len;
    }
    if (horiz) { x0 += best.thick; w -= best.thick; }
    else { y0 += best.thick; h -= best.thick; }
    i += best.row.length;
  }
  return rects;
}

// "YYYY-MM-DD HH:MM"(KST) → "N분 전"/"N시간 전" 상대시간 (신선도 즉시 인지용)
function relTime(genStr) {
  if (!genStr) return "";
  const t = new Date(genStr.replace(" ", "T") + ":00+09:00");
  if (isNaN(t)) return "";
  const min = Math.max(0, Math.round((Date.now() - t.getTime()) / 60000));
  if (min < 60) return `${min}분 전`;
  if (min < 60 * 24) return `${Math.floor(min / 60)}시간 ${min % 60}분 전`;
  return `${Math.floor(min / 1440)}일 전`;
}

// TradingView 티커 로딩 감시 — 6초 내 iframe 미렌더 시 숨기고 자체 티커 유지("!" 재발 방지)
function watchTvTicker() {
  const tv = $("#tv-ticker");
  if (!tv) return;
  setTimeout(() => {
    const frame = tv.querySelector("iframe");
    const ok = frame && frame.clientHeight > 10;
    if (ok) { renderMacroTicker(["^KS11", "^KQ11", "^SOX", "^VIX"]); }  // TV가 못 싣는 지수(라이선스)만 자체 배치 티커로
    else tv.style.display = "none";
  }, 6000);
}

// 자체 매크로 데이터로 지수 티커 스트립 렌더 (TradingView 로딩 실패 시 폴백 — 사이트 데이터와 일치)
function renderMacroTicker(pickOverride) {
  const host = $("#macro-ticker");
  if (!host || !MARKET?.macro) return;
  const pick = pickOverride || ["^KS11", "^KQ11", "^GSPC", "^IXIC", "^SOX", "KRW=X", "^VIX", "^TNX", "CL=F"];
  const byId = Object.fromEntries(MARKET.macro.map((m) => [m.id, m]));
  host.innerHTML = pick.filter((id) => byId[id]).map((id) => {
    const m = byId[id]; const up = m.chg >= 0;
    return `<span class="tick"><span class="tick-name">${m.name}</span>
      <span class="tick-val">${m.last.toLocaleString()}${m.unit}</span>
      <span class="tick-chg ${up ? "pos" : "neg"}">${up ? "▲" : "▼"} ${pct(m.chg, 1)}</span></span>`;
  }).join("");
}

function renderHome() {
  if (!MARKET) { $("#hm-context").textContent = "market.json 없음 — python analysis\\market_dash.py 실행 필요"; return; }
  heatmapRendered = true;
  renderMacroTicker();
  watchTvTicker();
  $("#hm-asof").textContent = `🕒 ${relTime(MARKET.generated)} 갱신 (${MARKET.generated} KST · 30분 주기)`;
  const b = MARKET.breadth, r = MARKET.regime;
  $("#hm-context").innerHTML =
    `국면 🇰🇷 ${REGIME_KO[r.kr]} · 🇺🇸 ${REGIME_KO[r.us]} ·
     <b>등락</b> 🇰🇷 ▲${b.kr.up} ▼${b.kr.down} (신고가 ${b.kr.hi52}·신저가 ${b.kr.lo52}) ·
     🇺🇸 ▲${b.us.up} ▼${b.us.down} (신고가 ${b.us.hi52}·신저가 ${b.us.lo52})
     <span class="sub-note">· 확정 종가는 다음날 07:40</span>`;
  // 그라데이션 범례: -3% 파랑 → 중립 → +3% 빨강 (국내 관례)
  $("#hm-legend").innerHTML =
    `<span class="hm-leg-lab">-3%</span>
     <span class="hm-grad" style="background:linear-gradient(90deg,#1e63e0,#adc6f0,#e8eaef,#f2b0b3,#d93036)"></span>
     <span class="hm-leg-lab">+3%</span>`;
  // 국내/미국 토글 → 카드+히트맵+오늘의종목 동기 재렌더 (rAF 금지 — 동기 실행)
  $("#home-mk").querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      homeMk = btn.dataset.mk;
      hmZoomSector = null;
      $("#hm-back").style.display = "none";
      $("#home-mk").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === btn));
      renderIdxCards(); drawTreemap(); renderMovers();
    };
  });
  $("#hm-back").onclick = () => {
    hmZoomSector = null;
    $("#hm-back").style.display = "none";
    drawTreemap();
  };
  $("#home-news-more").onclick = (e) => { e.preventDefault(); activateTab("news"); };
  renderIdxCards();
  drawTreemap();
  renderMovers();
  renderHomeNews();
}

// 지수 2(macro 재사용) + 시총 대표종목 2(featured) 카드
function renderIdxCards() {
  const host = $("#home-cards");
  if (!host) return;
  const idxIds = homeMk === "kr" ? ["^KS11", "^KQ11"] : ["^GSPC", "^IXIC"];
  const byId = Object.fromEntries((MARKET.macro || []).map((m) => [m.id, m]));
  const cards = [];
  for (const id of idxIds) {
    const m = byId[id];
    if (m) cards.push({ name: m.name, last: m.last, chg: m.chg, spark: m.spark, unit: m.unit });
  }
  for (const f of (MARKET.featured?.[homeMk] || [])) {
    cards.push({ name: f.name, last: f.last, chg: f.chg, spark: f.spark, unit: homeMk === "kr" ? "원" : "$", t: f.t });
  }
  host.innerHTML = cards.map((c) => {
    const up = c.chg >= 0;
    const val = c.unit === "$" ? `$${c.last.toLocaleString()}` : `${c.last.toLocaleString()}${c.unit || ""}`;
    return `<div class="idx-card${c.t ? " clickable" : ""}" ${c.t ? `data-t="${c.t}"` : ""}>
      <div class="idx-name">${c.name}</div>
      <div class="idx-val">${val}</div>
      <div class="idx-chg ${up ? "pos" : "neg"}">${up ? "▲" : "▼"} ${pct(c.chg, 2)}</div>
      ${sparkSvg(c.spark, up ? "#dc2626" : "#2563eb")}
    </div>`;
  }).join("");
  host.querySelectorAll(".idx-card.clickable").forEach((el) => {
    el.onclick = () => {
      document.querySelector('.group[data-group="research"]').click();
      activateTab("lookup");
      if (!lookupRendered) initLookup();
      loadLookup(`${homeMk}_${el.dataset.t}`);
    };
  });
}

// 오늘의 종목: 거래대금/거래량/급등/급락 칩 + 순위 리스트
const MV_CATS = [["value", "거래대금"], ["volume", "거래량"], ["gainers", "급등"], ["losers", "급락"]];
function renderMovers() {
  const chips = $("#mv-chips"), list = $("#mv-list");
  if (!chips || !MARKET.movers) return;
  chips.innerHTML = MV_CATS.map(([k, lab]) =>
    `<button class="chip${k === moverCat ? " active" : ""}" data-cat="${k}">${lab}</button>`).join("");
  chips.querySelectorAll(".chip").forEach((b) => {
    b.onclick = () => { moverCat = b.dataset.cat; renderMovers(); };
  });
  const rows = MARKET.movers[homeMk]?.[moverCat] || [];
  list.innerHTML = rows.map((r, i) => {
    const up = r.chg >= 0;
    const sub = moverCat === "volume"
      ? `거래량 ${r.vol.toLocaleString()}주` : `거래대금 ${fmtMcap(r.value, homeMk)}`;
    return `<div class="mv-row" data-t="${r.t}">
      <span class="mv-rank">${i + 1}</span>
      ${r.logo ? `<img class="mv-logo" src="${r.logo}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="mv-logo"></span>`}
      <span class="mv-name"><b>${r.name}</b><span class="sub-note"> ${r.t}</span><br>
        <span class="mv-sub">${sub}</span></span>
      <span class="mv-price">${fmtPrice(r.last, homeMk)}
        <span class="${up ? "pos" : "neg"}">${up ? "▲" : "▼"} ${pct(r.chg, 1)}</span></span>
    </div>`;
  }).join("") || `<p class="mini-note">데이터 없음</p>`;
  list.querySelectorAll(".mv-row").forEach((el) => {
    el.onclick = () => {
      document.querySelector('.group[data-group="research"]').click();
      activateTab("lookup");
      if (!lookupRendered) initLookup();
      loadLookup(`${homeMk}_${el.dataset.t}`);
    };
  });
}

// 주요 뉴스 미리보기 (뉴스 탭 데이터 재사용, 상위 5건)
function renderHomeNews() {
  const host = $("#home-news");
  if (!host) return;
  host.innerHTML = NEWS?.market?.length
    ? newsList(NEWS.market.slice(0, 5), false)
    : `<p class="mini-note">뉴스 데이터 없음</p>`;
}

function hmTooltip() {
  let tip = document.getElementById("hm-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "hm-tip";
    document.body.appendChild(tip);
  }
  return tip;
}

function drawTreemap() {
  const mk = homeMk;
  const host = $("#hm-tree");
  const W = host.clientWidth || 800, H = host.clientHeight || 560;
  const tiles = MARKET.heatmap.filter((t) => t.m === mk && t.mcap > 0);
  const bySector = {};
  tiles.forEach((t) => (bySector[t.sector] = bySector[t.sector] || []).push(t));
  let sectors = Object.entries(bySector)
    .map(([name, arr]) => {
      const w = arr.reduce((s, x) => s + x.mcap, 0);
      const chg = arr.reduce((s, x) => s + x.chg * x.mcap, 0) / w;  // 시총가중 섹터 등락
      return { name, w, chg, items: arr.sort((a, b) => b.mcap - a.mcap) };
    })
    .sort((a, b) => b.w - a.w).slice(0, 14);
  if (hmZoomSector) {  // 섹터 확대: 해당 섹터만 전체 영역에
    const one = sectors.filter((s) => s.name === hmZoomSector);
    if (one.length) sectors = one;
    else hmZoomSector = null;
  }
  host.innerHTML = "";
  const tip = hmTooltip();
  const HDR = 18;  // 섹터 헤더 높이
  const secRects = layoutTreemap(sectors, W, H);
  for (const sr of secRects) {
    const block = document.createElement("div");
    block.className = "hm-sector";
    block.style.cssText = `left:${sr.x}px;top:${sr.y}px;width:${sr.w2}px;height:${sr.h2}px`;
    const secPct = pct(sr.chg, 1);
    const zoomBtn = hmZoomSector ? "" : `<button class="hm-zoom" title="이 섹터만 크게 보기">⤢</button>`;
    block.innerHTML = `<div class="hm-sec-head"><span class="hm-sec-name">${sr.name}</span>
      <span class="hm-sec-chg" style="color:${sr.chg >= 0.0025 ? "#d93036" : sr.chg <= -0.0025 ? "#1e63e0" : "#6b7280"}">${secPct}</span>${zoomBtn}</div>`;
    const zb = block.querySelector(".hm-zoom");
    if (zb) zb.onclick = (e) => {
      e.stopPropagation();
      hmZoomSector = sr.name;
      $("#hm-back").style.display = "";
      drawTreemap();
    };
    const inner = layoutTreemap(sr.items.map((t) => ({ ...t, w: t.mcap })), sr.w2 - 2, Math.max(4, sr.h2 - HDR - 2));
    for (const t of inner) {
      const d = document.createElement("div");
      d.className = "hm-tile";
      const chgPct = t.chg * 100;
      d.style.cssText = `left:${t.x + 1}px;top:${t.y + HDR + 1}px;width:${Math.max(1, t.w2 - 1)}px;height:${Math.max(1, t.h2 - 1)}px;background:${hmColor(chgPct)};color:${hmText(chgPct)}`;
      if (t.w2 > 68 && t.h2 > 38) d.innerHTML = `<b class="big">${t.name}</b><span>${pct(t.chg, 1)}</span>`;
      else if (t.w2 > 44 && t.h2 > 24) d.innerHTML = `<b>${t.name.length > 6 ? (t.t.length <= 6 ? t.t : t.name.slice(0, 5)) : t.name}</b>`;
      d.addEventListener("mousemove", (e) => {
        tip.style.display = "block";
        tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 230) + "px";
        tip.style.top = (e.clientY + 14) + "px";
        tip.innerHTML = `<b>${t.name}</b> <span class="${t.chg >= 0 ? "tip-up" : "tip-dn"}">${pct(t.chg, 2)}</span><br>
          <span>${t.sector}</span><br><span>시총 ${fmtMcap(t.mcap, t.m)}</span>`;
      });
      d.addEventListener("mouseleave", () => { tip.style.display = "none"; });
      d.addEventListener("click", () => {
        tip.style.display = "none";
        document.querySelector('.group[data-group="research"]').click();
        activateTab("lookup");
        if (!lookupRendered) initLookup();
        loadLookup(`${t.m}_${t.t}`);
      });
      block.appendChild(d);
    }
    host.appendChild(block);
  }
}

/* ---------- 마켓: 매크로 지표 ---------- */
function sparkSvg(vals, color) {
  if (!vals || vals.length < 2) return "";
  const min = Math.min(...vals), max = Math.max(...vals), rng = max - min || 1;
  const pts = vals.map((v, i) =>
    `${(i / (vals.length - 1)) * 120},${34 - ((v - min) / rng) * 30}`).join(" ");
  return `<svg viewBox="0 0 120 36" class="spark"><polyline points="${pts}" fill="none"
    stroke="${color}" stroke-width="1.6"/></svg>`;
}

function renderMacro() {
  if (!MARKET) { $("#macro-context").textContent = "market.json 없음 — python analysis\\market_dash.py 실행 필요"; return; }
  macroRendered = true;
  $("#macro-context").innerHTML =
    `<b>기준 시각 ${MARKET.generated}</b> — ${relTime(MARKET.generated)} 갱신 (<b>클라우드 30분 주기</b>)<br>
     각 지표 아래 줄 = <b>트레이더 관점 한 줄</b> — 시장 대응 시 왜 보는가`;
  $("#macro-cards").innerHTML = MARKET.macro.map((m) => {
    const up = m.chg >= 0;
    return `<div class="card macro-card">
      <div class="macro-head"><span class="macro-name">${m.name}</span>
        <span class="badge dim">${m.group}</span></div>
      <div class="macro-val"><b>${m.last.toLocaleString()}${m.unit}</b>
        <span class="${up ? "pos" : "neg"}">${pct(m.chg)}</span></div>
      ${sparkSvg(m.spark, up ? "#dc2626" : "#2563eb")}
      <div class="desc">${m.note}</div>
    </div>`;
  }).join("");
}

/* ---------- 마켓: 경제일정 ---------- */
let calMk = "kr";
function renderCalendar() {
  calRendered = true;
  if (!CAL) {
    $("#cal-context").textContent = "calendar.json 없음 — python analysis\\calendar_events.py 실행 필요";
    return;
  }
  $("#cal-context").innerHTML =
    `<b>기준 시각 ${CAL.generated}</b> — ${relTime(CAL.generated)} 갱신 (하루 1회)<br>
     국내=한국거래소 KIND 기업설명회(IR) 공시 · 미국=yfinance 실적발표 예정일(EPS 컨센서스 병기).
     일정은 회사 사정에 따라 변경될 수 있음`;
  $("#cal-mk").querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      calMk = btn.dataset.mk;
      $("#cal-mk").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === btn));
      drawCalList();
    };
  });
  drawCalList();
}

function drawCalList() {
  const host = $("#cal-earnings");
  const rows = CAL?.earnings?.[calMk] || [];
  $("#cal-src").textContent = calMk === "kr"
    ? `(KIND 공시 · ${CAL.kr_updated ? relTime(CAL.kr_updated) + " 갱신" : "미수집"})`
    : `(yfinance · ${CAL.us_updated ? relTime(CAL.us_updated) + " 갱신" : "미수집"})`;
  if (!rows.length) { host.innerHTML = `<p class="mini-note">예정된 일정 없음</p>`; return; }
  const byDay = {};
  rows.forEach((r) => (byDay[r.date] = byDay[r.date] || []).push(r));
  const today = new Date().toISOString().slice(0, 10);
  host.innerHTML = Object.entries(byDay).map(([d, items]) => {
    const dt = new Date(d + "T00:00:00+09:00");
    const yo = "일월화수목금토"[dt.getDay()];
    const isToday = d === today;
    return `<div class="cal-day${isToday ? " today" : ""}">
      <div class="cal-date">${d.slice(5).replace("-", "/")} (${yo})${isToday ? " · 오늘" : ""}
        <span class="sub-note">${items.length}건</span></div>
      ${items.map((r) => `<div class="cal-row${r.t ? " clickable" : ""}" ${r.t ? `data-t="${r.t}"` : ""}>
        ${r.logo ? `<img class="cal-logo" src="${r.logo}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="cal-logo"></span>`}
        <span class="cal-name"><b>${r.name}</b>${r.t ? `<span class="sub-note"> ${r.t}</span>` : ""}</span>
        <span class="cal-info">${calMk === "kr"
          ? `${r.event || ""}${r.time ? ` · ${r.time}` : ""}`
          : (r.eps_est != null ? `EPS 컨센서스 $${r.eps_est}` : "실적발표 예정")}</span>
      </div>`).join("")}
    </div>`;
  }).join("");
  host.querySelectorAll(".cal-row.clickable").forEach((el) => {
    el.onclick = () => {
      document.querySelector('.group[data-group="research"]').click();
      activateTab("lookup");
      if (!lookupRendered) initLookup();
      loadLookup(`${calMk}_${el.dataset.t}`);
    };
  });
}

/* ---------- 마켓: 뉴스·속보 ---------- */
function newsList(items, withStock) {
  if (!items.length) return `<p class="mini-note">최근 24시간 항목 없음</p>`;
  return items.map((n) => `<a class="news-item" href="${n.link}" target="_blank" rel="noopener">
    <span class="news-time">${n.t}</span>
    ${withStock && n.stock ? `<span class="news-stock">${n.stock}</span>` : ""}
    <span class="news-title">${n.title}</span>
    <span class="news-src">${n.src || ""}</span></a>`).join("");
}

// 브리핑 시점 히스토리 드롭다운 채우기 (공통)
function fillBriefHist(selId, wrapId, briefs) {
  const wrap = $("#" + wrapId), sel = $("#" + selId);
  if (!briefs || !briefs.entries || briefs.entries.length <= 1) { wrap.style.display = "none"; return null; }
  wrap.style.display = "inline";
  sel.innerHTML = briefs.entries.map((e, i) =>
    `<option value="${i}">${e.ts}${i === 0 ? " (최신)" : ""}</option>`).join("");
  return sel;
}

// 누적 아카이브를 날짜별 그룹 리스트로
function archiveList(arch, withStock) {
  if (!arch || !arch.items || !arch.items.length) return `<p class="mini-note">누적 기록 없음</p>`;
  const byDay = {};
  arch.items.forEach((it) => { (byDay[it.first_seen.slice(0, 10)] ||= []).push(it); });
  return Object.entries(byDay).sort((a, b) => b[0] < a[0] ? -1 : 1).map(([day, its]) =>
    `<div class="arch-day"><div class="arch-date">${day} <span class="sub-note">(${its.length}건)</span></div>` +
    its.map((n) => `<a class="news-item" href="${n.link}" target="_blank" rel="noopener">
      <span class="news-time">${(n.first_seen || "").slice(11)}</span>
      ${withStock && n.stock ? `<span class="news-stock">${n.stock}</span>` : ""}
      <span class="news-title">${n.title}</span><span class="news-src">${n.src || ""}</span></a>`).join("")
    + `</div>`).join("");
}

function renderNews() {
  if (!NEWS) { $("#news-context").textContent = "news.json 없음 — python analysis\\market_news.py 실행 필요"; return; }
  newsRendered = true;
  if (!dealsRendered) renderDeals();  // 딜 레이더(흡수 서브뷰)
  document.querySelectorAll("#nd-toggle button").forEach((b) => b.onclick = () => {
    document.querySelectorAll("#nd-toggle button").forEach((x) => x.classList.toggle("active", x === b));
    $("#nd-news").style.display = b.dataset.nd === "news" ? "" : "none";
    $("#nd-deals").style.display = b.dataset.nd === "deals" ? "" : "none";
  });
  $("#news-context").innerHTML =
    `<b>기사 수집</b> ${NEWS.generated} (${relTime(NEWS.generated)} · <b>클라우드 30분 주기</b>) · <b>AI 큐레이션</b> ${NEWS.curation_at || "-"} ·
     Google News · 30일 누적 보관`;

  const drawBrief = (cur) => {
    const box = $("#news-brief-box");
    if (!cur || (!cur.market && !cur.holdings)) { box.style.display = "none"; return; }
    box.style.display = "";
    box.innerHTML =
      (cur.market ? `<h3>🧭 AI 시장 브리핑 <span class="sub-note">(Gemini · [#n]=근거 기사)</span></h3>
        <p>${cur.market.replace(/\n/g, "<br>")}</p>` : "") +
      (cur.holdings ? `<h3>📌 보유종목 한 줄 요약</h3><p>${cur.holdings.replace(/\n/g, "<br>")}</p>` : "");
  };
  const sel = fillBriefHist("news-hist", "news-hist-wrap", NEWS_BRIEFS);
  if (sel) sel.onchange = () => drawBrief(NEWS_BRIEFS.entries[+sel.value].curation);
  drawBrief(NEWS.curation);

  const drawList = () => {
    const view = document.querySelector('input[name="newsview"]:checked').value;
    if (view === "archive") {
      $("#news-holdings").innerHTML = archiveList({ items: (NEWS_ARCH?.items || []).filter((x) => x.stock) }, true);
      $("#news-market").innerHTML = archiveList({ items: (NEWS_ARCH?.items || []).filter((x) => !x.stock) }, false);
      $("#news-market-h").innerHTML = `📰 시장 뉴스 <span class="sub-note">(30일 누적 · 최초 등장 시각)</span>`;
    } else {
      $("#news-holdings").innerHTML = newsList(NEWS.holdings, true);
      $("#news-market").innerHTML = newsList(NEWS.market, false);
      $("#news-market-h").innerHTML = `📰 시장 뉴스`;
    }
  };
  document.querySelectorAll('input[name="newsview"]').forEach((r) => { r.onchange = drawList; });
  drawList();
}

/* ---------- 마켓: 시장 내부 ---------- */
function lineChart(hostSel, series, color, refLine) {
  const el = $(hostSel);
  el.innerHTML = "";
  const c = LightweightCharts.createChart(el, baseChartOpts(el, el.clientHeight || 200));
  const ser = c.addLineSeries({ color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
  ser.setData(series.map((p) => ({ time: p.t, value: p.v })));
  if (refLine != null)
    ser.createPriceLine({ price: refLine, color: "#9ca3af", lineWidth: 1, lineStyle: 2, axisLabelVisible: true });
  c.timeScale().fitContent();
  intCharts.push(c);
  return c;
}

function renderInternals() {
  if (!MPRO) { $("#int-context").textContent = "market_pro.json 없음 — python analysis\\market_pro.py 실행 필요"; return; }
  internalsRendered = true;
  if (!macroRendered) renderMacro();  // 매크로 카드(흡수 섹션)

  if (MPRO.brief) {
    $("#int-brief").style.display = "";
    $("#int-brief").innerHTML = `<h3>🤖 AI 마켓 브리핑 <span class="sub-note">(${MPRO.brief_at || MPRO.generated} · Gemini · 하루 3회)</span></h3>
      <p>${MPRO.brief.replace(/\n/g, "<br>")}</p>`;
  }
  $("#int-context").innerHTML =
    `시장 내부(internals) — 지수가 아니라 <b>구성 종목 전체의 체력</b>을 봅니다.
     지표 갱신 ${MPRO.generated} (${relTime(MPRO.generated)} · <b>클라우드 30분 주기</b>)`;

  const r = MPRO.risk || {};
  const scoreColor = r.score >= 60 ? "#16a34a" : r.score <= 40 ? "#dc2626" : "#f59e0b";
  $("#risk-gauge").innerHTML = `
    <div class="risk-row">
      <div class="risk-score">
        <div class="risk-num" style="color:${scoreColor}">${r.score ?? "-"}</div>
        <div class="risk-label">리스크온/오프<br>(0=공포 100=탐욕)</div>
      </div>
      <div class="risk-meta">
        <div>코스피 실현변동성(20일, 연율) <b>${r.rv20 ?? "-"}%</b> · VIX(미국) <b>${r.vix ?? "-"}</b></div>
        <div>60일 상관: 달러 <b>${r.corr60?.dollar ?? "-"}</b> · 미10Y <b>${r.corr60?.us10y ?? "-"}</b> · VIX <b>${r.corr60?.vix ?? "-"}</b>
          <span class="sub-note">(음수=역상관, 코스피 기준)</span></div>
        <div class="sub-note">${r.formula || ""} · 구성: ${r.score_note || ""}</div>
      </div>
    </div>`;

  $("#int-mk").onchange = drawInternals;
  drawInternals();
}

// 시장내부 결론 대시보드 — 지표별 신호등 + 룰 기반 한 줄 결론 (AI 아님, 항상 표시)
function renderIntVerdict(mk) {
  const h = MPRO.breadth_hist?.[mk];
  const host = $("#int-verdict");
  if (!h) { host.style.display = "none"; return; }
  host.style.display = "";
  const last = (arr) => arr?.[arr.length - 1]?.v;
  const ago = (arr, n) => arr?.[Math.max(0, arr.length - 1 - n)]?.v;
  const adr = last(h.adr), ma50 = last(h.ma50), ma200 = last(h.ma200);
  const nhnlNow = last(h.nhnl), nhnlPrev = ago(h.nhnl, 20);
  const nhnlTrend = nhnlNow != null && nhnlPrev != null ? nhnlNow - nhnlPrev : null;

  // 판정: st = good(🟢)/warn(🟡)/bad(🔴), 기준은 각 카드에 명시
  const cards = [];
  if (adr != null) {
    const st = adr >= 120 ? "warn" : adr >= 100 ? "good" : adr >= 80 ? "warn" : "bad";
    const note = adr >= 120 ? "과열 구간 — 단기 되돌림 주의" : adr >= 100 ? "상승 종목 우위"
      : adr >= 80 ? "하락 종목 우위" : "침체 — 과매도 접근(역발상 관찰)";
    cards.push(["ADR (20일 등락비율)", adr.toFixed(0), st, note, "100=중립"]);
  }
  if (nhnlTrend != null) {
    const st = nhnlTrend > 0 ? "good" : nhnlTrend < 0 ? "bad" : "warn";
    cards.push(["신고−신저 누적 (20일 추세)", (nhnlTrend > 0 ? "+" : "") + Math.round(nhnlTrend).toLocaleString(), st,
      nhnlTrend > 0 ? "체력 확장 — 신고가가 더 많음" : "체력 위축 — 신저가가 더 많음", "우상향=건강"]);
  }
  if (ma50 != null) {
    const st = ma50 >= 50 ? "good" : ma50 >= 30 ? "warn" : "bad";
    cards.push(["50일선 위 종목", ma50.toFixed(0) + "%", st,
      ma50 >= 50 ? "과반이 중기 상승추세" : ma50 >= 30 ? "중기 추세 참여 저조" : "대다수가 중기 하락추세", "50%=중립"]);
  }
  if (ma200 != null) {
    const st = ma200 >= 50 ? "good" : ma200 >= 30 ? "warn" : "bad";
    cards.push(["200일선 위 종목", ma200.toFixed(0) + "%", st,
      ma200 >= 50 ? "장기 추세 건재" : ma200 >= 30 ? "장기 추세 약화" : "장기 하락장 성격", "50%=중립"]);
  }

  const nBad = cards.filter((c) => c[2] === "bad").length;
  const nGood = cards.filter((c) => c[2] === "good").length;
  const risk = MPRO.risk?.score;
  let emoji, verdict;
  if (nBad >= 2) {
    emoji = "⚠️";
    verdict = `<b>시장 내부 체력이 약합니다.</b> 지수 방향과 별개로 다수 종목이 하락 추세 — 신규 진입은 보수적으로, 매수 원칙은 종목별 신호 확인 후.`;
  } else if (nGood >= 3) {
    emoji = "✅";
    verdict = `<b>시장 체력 양호.</b> 상승이 소수 주도가 아니라 폭넓게 확산 — 원칙 신호의 신뢰도가 높은 환경.`;
  } else {
    emoji = "➖";
    verdict = `<b>혼조.</b> 지표들이 엇갈립니다 — 지수보다 종목 선별이 중요한 구간.`;
  }
  if (risk != null) verdict += ` <span class="sub-note">(리스크 점수 ${risk} — ${risk >= 60 ? "리스크온" : risk <= 40 ? "리스크오프" : "중립"})</span>`;

  const ICON = { good: "🟢", warn: "🟡", bad: "🔴" };
  host.innerHTML = `
    <div class="vd-conclusion">${emoji} ${verdict}</div>
    <div class="vd-grid">${cards.map(([name, val, st, note, ref]) => `
      <div class="vd-card ${st}">
        <div class="vd-name">${name} <span class="sub-note">${ref}</span></div>
        <div class="vd-val">${ICON[st]} <b>${val}</b></div>
        <div class="vd-note">${note}</div>
      </div>`).join("")}</div>
    <p class="sub-note" style="margin-top:8px">판정 기준은 카드에 표기 — 룰 기반 자동 판정(참고용, 매수·매도 지시 아님) · 상세 추이는 아래 120일 차트</p>`;
}

function drawInternals() {
  intCharts.forEach((c) => c.remove());
  intCharts = [];
  const mk = $("#int-mk").value;
  renderIntVerdict(mk);
  const h = MPRO.breadth_hist?.[mk];
  if (!h) return;
  lineChart("#int-adr", h.adr, "#2563eb", 100);
  lineChart("#int-nhnl", h.nhnl, "#8e44ad", null);
  // MA50/200 두 선을 한 차트에
  const el = $("#int-ma");
  el.innerHTML = "";
  const c = LightweightCharts.createChart(el, baseChartOpts(el, el.clientHeight || 200));
  const s50 = c.addLineSeries({ color: "#f59e0b", lineWidth: 2, priceLineVisible: false, title: "MA50 상회 %" });
  s50.setData(h.ma50.map((p) => ({ time: p.t, value: p.v })));
  const s200 = c.addLineSeries({ color: "#0891b2", lineWidth: 2, priceLineVisible: false, title: "MA200 상회 %" });
  s200.setData(h.ma200.map((p) => ({ time: p.t, value: p.v })));
  s50.createPriceLine({ price: 50, color: "#9ca3af", lineWidth: 1, lineStyle: 2 });
  c.timeScale().fitContent();
  intCharts.push(c);
}

/* ---------- 마켓: 섹터 로테이션 ---------- */
function rsCell(v) {
  // 로테이션은 주간~분기 수익률이라 스케일을 3배 완화(±9% 포화)
  return `<td class="heat-cell" style="background:${hmColor((v * 100) / 3)}">${pct(v, 1)}</td>`;
}

function renderRotation() {
  if (!MPRO || !MPRO.rotation) { $("#rot-context").textContent = "market_pro.json 없음"; return; }
  rotationRendered = true;
  $("#rot-context").innerHTML =
    `섹터별 <b>시가총액 가중 수익률</b>과 <b>상대강도(RS = 섹터 − 시장 전체)</b>.
     RS가 1주<1개월<3개월로 갈수록 커지면 자금 유입 지속, 1주만 튀면 단기 순환매.
     갱신 ${MPRO.generated} (${relTime(MPRO.generated)} · <b>클라우드 30분 주기</b>)`;
  $("#rot-mk").onchange = drawRotation;
  drawRotation();
}

function drawRotation() {
  const mk = $("#rot-mk").value;
  const rot = MPRO.rotation[mk];
  if (!rot) return;
  const m = rot.market;
  $("#rot-table").innerHTML =
    `<tr><th>섹터 (종목수)</th><th>1주</th><th>1개월</th><th>3개월</th>
       <th>RS 1주</th><th>RS 1개월</th><th>RS 3개월</th></tr>
     <tr style="font-weight:700"><td>시장 전체</td>${rsCell(m.w1)}${rsCell(m.m1)}${rsCell(m.m3)}<td>-</td><td>-</td><td>-</td></tr>` +
    rot.sectors.map((s) => `<tr class="rot-row" data-sector="${s.sector}" title="클릭 = 소속 종목 보기">
      <td>▸ ${s.sector} <span class="sub-note">(${s.n})</span></td>
      ${rsCell(s.w1)}${rsCell(s.m1)}${rsCell(s.m3)}${rsCell(s.rs_w1)}${rsCell(s.rs_m1)}${rsCell(s.rs_m3)}
    </tr>`).join("");
  document.querySelectorAll("#rot-table .rot-row").forEach((tr) =>
    tr.addEventListener("click", () => toggleRotMembers(tr, tr.dataset.sector, mk)));
}

// 섹터 행 클릭 → 소속 종목(히트맵 유니버스, 시총순) 펼침
function toggleRotMembers(tr, sector, mk) {
  const open = tr.nextElementSibling?.classList.contains("rot-members");
  document.querySelectorAll(".rot-members").forEach((r) => r.remove());
  document.querySelectorAll("#rot-table .rot-row td:first-child").forEach((td) => {
    td.innerHTML = td.innerHTML.replace("▾", "▸");
  });
  if (open) return;
  tr.querySelector("td").innerHTML = tr.querySelector("td").innerHTML.replace("▸", "▾");
  const members = (MARKET?.heatmap || [])
    .filter((t) => t.m === mk && t.sector === sector)
    .sort((a, b) => b.mcap - a.mcap);
  const row = document.createElement("tr");
  row.className = "rot-members";
  row.innerHTML = `<td colspan="7"><div class="rot-mem-grid">${
    members.length ? members.map((t) => `
      <a href="#" class="rot-mem" data-key="${t.m}_${t.t}">
        <span class="rot-mem-name">${t.name}</span>
        <b class="${t.chg >= 0 ? "pos" : "neg"}">${pct(t.chg, 1)}</b>
        <span class="sub-note">${fmtMcap(t.mcap, mk)}</span>
      </a>`).join("")
    : `<span class="mini-note">이 섹터의 종목 정보 없음</span>`
  }</div>
  <p class="sub-note" style="margin:6px 0 2px">시총순 · 등락=당일 · 클릭 = 종목 조회로 이동 (분석 유니버스 내 종목만 표시)</p></td>`;
  tr.after(row);
  row.querySelectorAll(".rot-mem").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelector('.group[data-group="discover"]').click();
    document.querySelector('[data-tab="lookup"]').click();
    if (!lookupRendered) initLookup();
    loadLookup(a.dataset.key);
  }));
}

/* ---------- 종목 조회: 신호 라벨·게이팅·내러티브·프로파일 ---------- */
// 차트 마커용 원칙 축약 (2~4자)
let SELECTED_RULES = new Set();  // 최종 채택 원칙(매수5·매도5) — DATA 로드 후 채움
const RULE_ABBR = {
  disparity_low: "이격", bb_lower_rsi: "BB·R", bb_lower_touch: "BB",
  rsi_oversold_exit: "R30", macd_cross_up_below0: "M↑",
  macd_cross_dn: "M↓", macd_cross_dn_above0: "M↓0",
  long_bear_vol: "장음", ma20_break_dn_vol: "20V", hi52_obv_fade: "수급",
  golden_cross_5_20: "GC", ma60_break_dn: "60↓", ma120_break_dn: "120↓",
  stoch_overbought_turn: "스토",
};

// 현재 국면에서 이 원칙이 켜져 있나 (오늘의 신호 패널 데이터 재사용)
function ruleActive(ruleId, mk) {
  const r = TODAY?.rules?.find((x) => x.rule_id === ruleId);
  if (!r) return true;
  return mk === "kr" ? r.active_kr : r.active_us;
}

function renderLookupLinks(st) {
  const host = $("#lookup-links");
  host.style.display = "";
  const links = st.market === "kr" ? [
    ["네이버 금융", `https://finance.naver.com/item/main.naver?code=${st.ticker}`],
    ["DART 공시", `https://dart.fss.or.kr/dsab007/main.do?option=corp&textCrpNm=${encodeURIComponent(st.name)}`],
    ["구글 뉴스", `https://news.google.com/search?q=${encodeURIComponent(st.name + " 주가")}&hl=ko`],
    ["TradingView", `https://kr.tradingview.com/chart/?symbol=KRX:${st.ticker}`],
  ] : [
    ["Yahoo Finance", `https://finance.yahoo.com/quote/${st.ticker}`],
    ["SEC 공시", `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${st.ticker}&type=10-K&dateb=&owner=include&count=10`],
    ["구글 뉴스", `https://news.google.com/search?q=${encodeURIComponent(st.ticker + " stock")}&hl=ko`],
    ["TradingView", `https://kr.tradingview.com/chart/?symbol=${st.ticker}`],
  ];
  host.innerHTML = `<span class="sub-note">심층 정보:</span> ` +
    links.map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener" class="ext-link">${t} ↗</a>`).join("");
}

function renderLookupProfile(st) {
  const host = $("#lookup-profile");
  const p = st.profile || {};
  // 수익률 미니 막대: 0 중심 좌(-)/우(+), ±30%에서 만폭
  const perfBar = (label, v) => {
    if (v == null) return "";
    const w = Math.min(48, Math.abs(v) * 100 / 30 * 48);
    const up = v >= 0;
    return `<div class="perf-row"><span class="perf-lab">${label}</span>
      <span class="perf-track"><span class="perf-fill ${up ? "pos-bg" : "neg-bg"}"
        style="width:${w}%;${up ? "left:50%" : "right:50%"}"></span></span>
      <b class="${up ? "pos" : "neg"}">${pct(v, 1)}</b></div>`;
  };
  const perfViz =
    `<div class="perf-two">
      <div><div class="perf-h">시장 대비 초과성과</div>
        ${perfBar("1주", p.rel_w1)}${perfBar("1개월", p.rel_m1)}${perfBar("3개월", p.rel_m3)}${perfBar("1년", p.rel_y1)}</div>
      <div><div class="perf-h">절대 수익률</div>
        ${perfBar("1개월", p.ret_m1)}${perfBar("3개월", p.ret_m3)}${perfBar("1년", p.ret_y1)}</div>
    </div>`;
  const rows = [
    ["베타 (1년, 시장 대비)", p.beta != null ? `<b>${p.beta}</b> ${p.beta > 1.3 ? "(시장보다 크게 움직임)" : p.beta < 0.7 ? "(방어적)" : ""}` : "-"],
    ["변동성 (20일, 연율)", p.vol20 != null ? `<b>${p.vol20}%</b> ${p.vol20 > 60 ? "⚠ 고변동" : ""}` : "-"],
    ["거래대금 (20일 평균)", p.val20 != null ? `<b>${st.market === "kr" ? (p.val20 / 1e8).toFixed(0) + "억원" : "$" + (p.val20 / 1e6).toFixed(0) + "M"}</b>` : "-"],
    ["섹터", p.sector ? `${p.sector}${p.sector_rank ? ` <span class="sub-note">(시총 ${p.sector_rank}/${p.sector_n}위)</span>` : ""}` : "-"],
  ];
  const sup = st.supply_sum;
  if (sup) {
    const amt = (v) => {
      if (v == null) return "-";
      const s = v >= 0 ? "+" : "";
      const t = Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(1)}조` : `${Math.round(v).toLocaleString()}억`;
      return `<b class="${v >= 0 ? "pos" : "neg"}">${s}${t}</b>`;
    };
    const rchg = sup.frgn_ratio_chg;
    rows.push(["외국인 순매수", `20일 ${amt(sup.frgn_20)} · 5일 ${amt(sup.frgn_5)}` +
      (sup.frgn_ratio != null ? ` <span class="sub-note">보유율 ${sup.frgn_ratio}%${rchg != null ? ` (20일 ${rchg >= 0 ? "+" : ""}${rchg}%p)` : ""}</span>` : "")]);
    rows.push(["기관 순매수", `20일 ${amt(sup.inst_20)} · 5일 ${amt(sup.inst_5)}`]);
  }
  // 참고 내재가치(기본 가정 RIM) — 내재가치 탭 연동
  const rec = VAL?.map?.[`${st.market}_${st.ticker}`];
  let valLine = "";
  if (rec) {
    let bps0 = null, roe0 = null;
    if (st.market === "kr" && rec.bps?.length && rec.roe?.length) {
      const valid = rec.bps.map((v, i) => [v, i]).filter(([v]) => v != null);
      bps0 = valid.length > 1 ? valid[valid.length - 2][0] : valid[valid.length - 1]?.[0];
      const roes = rec.roe.filter((v) => v != null);
      roe0 = roes[roes.length - 1];
    } else if (st.market === "us" && rec.bps && rec.roe) {
      bps0 = rec.bps; roe0 = rec.roe;
    }
    if (bps0 && roe0 != null) {
      const iv = rimValue(bps0, roe0, 9, 0.7);
      const gap = rec.price ? iv / rec.price - 1 : null;
      valLine = `<div class="prof-val">참고 내재가치(RIM 기본가정 r9%·w0.7): <b>${fmtPrice(iv, st.market)}</b>
        ${gap != null ? `<span class="${gap >= 0 ? "pos" : "neg"}">(현재가 대비 ${pct(gap, 0)})</span>` : ""}
        <a href="#" id="goto-value">가정 조정 →</a></div>`;
    }
  }
  host.innerHTML = `<div class="fund-head">종목 프로파일 <span class="sub-note">(자체 계산 · 시장=유니버스 동일가중)</span></div>
    ${perfViz}
    <div class="prof-grid wide">${rows.map(([k, v]) => `<div class="prof-row"><span>${k}</span><span>${v}</span></div>`).join("")}</div>
    ${valLine}`;
  const gv = document.getElementById("goto-value");
  if (gv) gv.addEventListener("click", (e) => {
    e.preventDefault();
    const box = document.getElementById("value-inline");
    box.open = true;
    if (!valRendered) initValue();
    loadValue(`${st.market}_${st.ticker}`, st.name);
    $("#val-q").value = st.market === "kr" ? `${st.name} (${st.ticker})` : st.ticker;
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function drawSupply(st) {
  const ids = ["lookup-supply-h", "lookup-supply", "lookup-supply-legend"];
  if (lookupSupply) { lookupSupply.remove(); lookupSupply = null; }
  const sup = st.supply;
  if (!sup || !sup.length) {  // US 또는 데이터 없음
    ids.forEach((id) => { $("#" + id).style.display = "none"; });
    return;
  }
  ids.forEach((id) => { $("#" + id).style.display = ""; });
  const el = $("#lookup-supply");
  lookupSupply = LightweightCharts.createChart(el, baseChartOpts(el, 220));
  const line = (key, color, scale) => {
    const s = lookupSupply.addLineSeries({ color, lineWidth: 2, priceLineVisible: false,
      lastValueVisible: true, priceScaleId: scale });
    s.setData(sup.filter((x) => x[key] != null).map((x) => ({ time: x.t, value: x[key] })));
    return s;
  };
  line("fc", "#2563eb");   // 외국인 누적 (좌축)
  line("ic", "#f59e0b");   // 기관 누적 (좌축)
  const fr = line("fr", "#16a34a", "right");  // 외국인 보유율 (우축)
  lookupSupply.priceScale("right").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
  // 0선
  lookupSupply.addLineSeries({ color: "#9ca3af", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false })
    .setData(sup.map((x) => ({ time: x.t, value: 0 })));
  lookupSupply.timeScale().fitContent();
  $("#lookup-supply-legend").innerHTML =
    `─ <span style="color:#2563eb">외국인 누적 순매수</span> · <span style="color:#f59e0b">기관 누적 순매수</span> (좌축, 억원) ·
     <span style="color:#16a34a">외국인 보유율</span> (우축, %) · 출처: 네이버(순매매량×종가 추정)`;
}

function renderLookupStory(st) {
  const host = $("#lookup-story");
  const mk = st.market;
  const good = st.stats.filter((s) => s.n >= 8).sort((a, b) => (b.win - a.win) || (b.avg_fwd20 - a.avg_fwd20));
  const best = good.slice(0, 2);
  const worst = good.length > 2 ? good[good.length - 1] : null;
  const regime = TODAY?.regime?.[mk];
  const regimeKo = regime ? REGIME_KO[regime] : null;

  // 최근 90일 신호 분포
  const cutoff = new Date(st.asof); cutoff.setDate(cutoff.getDate() - 90);
  const recent = st.markers.filter((m) => new Date(m.t) >= cutoff);
  const cnt = {};
  recent.forEach((m) => { cnt[m.rule_id] = (cnt[m.rule_id] || 0) + 1; });
  const topRecent = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const nameOf = (rid) => st.stats.find((s) => s.rule_id === rid)?.name || rid;
  const last3 = st.markers.slice(-3).reverse();

  let p1 = "";
  if (best.length) {
    p1 = `이 종목에서 지난 10년 가장 신뢰도가 높았던 원칙은 ` + best.map((b) =>
      `<b>${b.name}</b>(${b.side === "buy" ? "매수" : "매도"} — 신호 ${b.n}회, 승률 <b>${(b.win * 100).toFixed(0)}%</b>, 신호 후 20일 평균 <span class="${b.avg_fwd20 >= 0 ? "pos" : "neg"}">${pct(b.avg_fwd20, 1)}</span>)`).join("과 ") + `입니다.`;
    if (worst && worst.win < 0.5) p1 += ` 반면 <b>${worst.name}</b>은 승률 ${(worst.win * 100).toFixed(0)}%로 이 종목에서는 잘 통하지 않았습니다.`;
  } else {
    p1 = `이 종목은 원칙별 신호 표본이 적어(8회 미만) 통계적 판단이 어렵습니다.`;
  }

  let p2 = "";
  if (regimeKo) {
    const off = st.stats.filter((s) => !ruleActive(s.rule_id, mk)).map((s) => s.name);
    p2 = `현재 ${mk === "kr" ? "🇰🇷" : "🇺🇸"} 시장은 <b>${regimeKo}</b> 국면 — ` +
      (off.length ? `<b>${off.slice(0, 3).join(" · ")}</b>${off.length > 3 ? " 등" : ""} 원칙은 이 국면에서 꺼져 있어 신호가 떠도 참고만 해야 합니다.`
                  : `이 종목에 걸린 원칙 전부가 켜져 있는 국면입니다.`);
  }

  let p3 = "";
  if (topRecent.length) {
    p3 = `최근 90일간은 ` + topRecent.map(([rid, n]) => `<b>${nameOf(rid)}</b> ${n}회`).join(", ") +
      ` 신호가 발생했습니다.` +
      (last3.length ? ` 가장 최근: ` + last3.map((m) =>
        `${m.t.slice(5)} ${m.side === "buy" ? "🟢" : "🔴"}${m.name}${ruleActive(m.rule_id, mk) ? "" : "<span class='sub-note'>(국면상 꺼짐)</span>"}`).join(" · ") : "");
  } else {
    p3 = `최근 90일간 발생한 신호가 없습니다 — 원칙 관점에선 관망 구간입니다.`;
  }

  host.style.display = "";
  host.innerHTML = `<h3>📖 이 종목의 원칙 이야기</h3><p>${p1}</p>${p2 ? `<p>${p2}</p>` : ""}<p>${p3}</p>`;
}

function buildSigChips(st) {
  const cnt = {};
  st.markers.forEach((m) => { cnt[m.rule_id] = (cnt[m.rule_id] || 0) + 1; });
  const chips = Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([rid, n]) => {
    const s = st.stats.find((x) => x.rule_id === rid);
    const on = ruleActive(rid, st.market);
    return `<button class="sig-chip ${on ? "" : "chip-off"}" data-rid="${rid}"
      title="${s?.name || rid}${on ? "" : " (현 국면 꺼짐)"}">${RULE_ABBR[rid] || rid} ${n}</button>`;
  }).join("");
  $("#lookup-chips").innerHTML = chips;
  document.querySelectorAll(".sig-chip").forEach((c) => c.addEventListener("click", () => {
    const rs = $("#lookup-rule");
    rs.value = rs.value === c.dataset.rid ? "" : c.dataset.rid;  // 재클릭=해제
    drawLookupChart();
  }));
}

/* ---------- 종목 조회: TradingView 위젯 + 재무 카드 ---------- */
function tvSymbol(mk, tk) {
  return mk === "kr" ? `KRX:${tk}` : tk;
}

// 종목조회 심화 데이터 (company.json 주1 + feed.json 일1) — 최초 조회 시 1회 lazy 로드
let EXTRAS = { company: null, feed: null, loading: null };
function loadExtras() {
  if (EXTRAS.loading) return EXTRAS.loading;
  EXTRAS.loading = Promise.all([
    fetch("data/company.json" + _cb).then((r) => (r.ok ? r.json() : null)),
    fetch("data/feed.json" + _cb).then((r) => (r.ok ? r.json() : null)),
  ]).then(([c, f]) => { EXTRAS.company = c; EXTRAS.feed = f; });
  return EXTRAS.loading;
}

// 최신 시세: market.json quotes(30분 갱신, 히트맵과 동일 소스) 우선 → 없으면 종목 시계열 폴백
function freshQuote(st) {
  const q = MARKET?.quotes?.[`${st.market}_${st.ticker}`];
  if (q) return { cur: q[0], chg: q[1], src: `${relTime(MARKET.generated)} 시세 (히트맵과 동일 · 30분 갱신)` };
  const s = st.series;
  const cur = s[s.length - 1]?.c, prev = s[s.length - 2]?.c;
  return { cur, chg: cur != null && prev ? cur / prev - 1 : null, src: `종가 기준 ${st.asof}` };
}

// 헤더: 로고 + 종목명 + 현재가/등락
function renderLookupHead(st) {
  const host = $("#lookup-head");
  host.style.display = "";
  const co = EXTRAS.company?.map?.[`${st.market}_${st.ticker}`] || {};
  const { cur, chg, src } = freshQuote(st);
  const up = (chg ?? 0) >= 0;
  host.innerHTML = `
    ${co.logo ? `<img class="lk-logo" src="${co.logo}" alt="" onerror="this.style.display='none'">` : ""}
    <div class="lk-title">
      <div class="lk-name">${st.name}<span class="sub-note"> ${st.ticker} · ${st.market === "kr" ? "KRX" : "US"}</span></div>
      <div class="lk-price">${fmtPrice(cur, st.market)}
        ${chg != null ? `<span class="${up ? "pos" : "neg"}">${up ? "▲" : "▼"} ${pct(chg, 2)}</span>` : ""}
        <span class="sub-note">${src}</span></div>
    </div>`;
}

// 기업개요 카드
function renderLookupOverview(st) {
  const host = $("#lookup-overview");
  const co = EXTRAS.company?.map?.[`${st.market}_${st.ticker}`];
  const f = FUND?.map?.[`${st.market}_${st.ticker}`];
  if (!co?.overview) { host.style.display = "none"; return; }
  host.style.display = "";
  const ind = co.industry || f?.industry;
  host.innerHTML = `<h3 class="lk-h3">🏢 기업 개요 ${ind ? `<span class="badge dim">${ind}</span>` : ""}
      ${co.website ? `<a class="ext-link" href="${co.website}" target="_blank" rel="noopener">홈페이지 ↗</a>` : ""}</h3>
    <p class="lk-ov-text">${co.overview}</p>
    <p class="sub-note">출처: ${st.market === "kr" ? "네이버·와이즈리포트" : "Yahoo Finance"} (주 1회 갱신)</p>`;
}

// 증권가 컨센서스 카드: 목표주가 vs 현재가 + 투자의견
const US_RECO = { strong_buy: "적극 매수", buy: "매수", hold: "중립", underperform: "매도우위", sell: "매도" };
function renderLookupCons(st) {
  const host = $("#lookup-cons");
  const co = EXTRAS.company?.map?.[`${st.market}_${st.ticker}`];
  const cons = co?.cons;
  if (!cons?.target) { host.style.display = "none"; return; }
  host.style.display = "";
  const { cur } = freshQuote(st);  // 히트맵과 동일한 30분 시세로 괴리율 계산
  const upside = cur ? cons.target / cur - 1 : null;
  let opLabel = "-", opDesc = "";
  if (st.market === "kr" && cons.opinion != null) {
    const v = cons.opinion;
    opLabel = v >= 4.2 ? "적극 매수" : v >= 3.5 ? "매수" : v >= 2.5 ? "중립" : "매도";
    opDesc = `${v.toFixed(2)} / 5.0`;
  } else if (cons.opinion_key) {
    opLabel = US_RECO[cons.opinion_key] || cons.opinion_key;
    opDesc = cons.n ? `애널리스트 ${cons.n}명` : "";
  }
  // 현재가→목표가 위치 바 (0%=현재가-30%, 100%=목표가+10% 구간)
  const barPos = upside != null ? Math.max(4, Math.min(96, 70 / (1 + Math.max(0, upside)) )) : 50;
  host.innerHTML = `<div class="fund-head">증권가 컨센서스
      <span class="sub-note">(${st.market === "kr" ? "네이버 집계" : "Yahoo 집계"}${cons.at ? " · " + cons.at : ""})</span></div>
    <div class="cons-grid">
      <div class="cons-item"><span>목표주가 평균</span><b>${fmtPrice(cons.target, st.market)}</b></div>
      <div class="cons-item"><span>현재가 대비</span>
        <b class="${(upside ?? 0) >= 0 ? "pos" : "neg"}">${upside != null ? pct(upside, 1) : "-"}</b></div>
      <div class="cons-item"><span>투자의견</span><b>${opLabel}</b> <span class="sub-note">${opDesc}</span></div>
    </div>
    ${upside != null ? `<div class="cons-bar"><div class="cons-bar-fill" style="width:${barPos}%"></div>
      <span class="cons-cur" style="left:${barPos}%">현재가</span></div>
    <div class="cons-bar-lab"><span>&nbsp;</span><span>목표가 ${fmtPrice(cons.target, st.market)}</span></div>` : ""}
    <p class="sub-note" style="margin-top:6px">컨센서스는 증권사 추정 평균 — 매수·매도 판단이 아닌 참고 지표</p>`;
}

// 연간 재무 차트: 매출·영업이익 막대 + 영업이익률 라인 (SVG)
function finFmt(v, unit) {
  if (v == null) return "-";
  if (unit === "억원") return Math.abs(v) >= 10000 ? (v / 10000).toFixed(1) + "조" : Math.round(v).toLocaleString() + "억";
  return Math.abs(v) >= 1000 ? "$" + (v / 1000).toFixed(1) + "B" : "$" + Math.round(v) + "M";
}
function renderLookupFin(st) {
  const host = $("#lookup-fin");
  const co = EXTRAS.company?.map?.[`${st.market}_${st.ticker}`];
  const fin = co?.fin;
  if (!fin?.length) { host.style.display = "none"; return; }
  host.style.display = "";
  const W = 640, H = 210, padL = 8, padB = 34, padT = 26;
  const n = fin.length, gw = (W - padL * 2) / n;
  const maxV = Math.max(...fin.map((r) => Math.max(r.rev || 0, r.op || 0)), 1);
  const minOp = Math.min(0, ...fin.map((r) => r.op ?? 0));
  const y0 = padT + (H - padT - padB) * (maxV / (maxV - minOp));  // 0선
  const yScale = (v) => padT + (maxV - v) / (maxV - minOp) * (H - padT - padB);
  const opms = fin.filter((r) => r.opm != null).map((r) => r.opm);
  const opmMin = Math.min(...opms, 0), opmMax = Math.max(...opms, 1);
  const opmY = (v) => padT + 4 + (opmMax - v) / (opmMax - opmMin || 1) * 52;  // 상단 60px 대역
  let bars = "", line = "", labels = "";
  const pts = [];
  fin.forEach((r, i) => {
    const cx = padL + gw * i + gw / 2;
    const bw = Math.min(34, gw / 3);
    if (r.rev != null) {
      const y = yScale(r.rev);
      bars += `<rect x="${cx - bw - 2}" y="${y}" width="${bw}" height="${Math.max(1, y0 - y)}" fill="${r.est ? "#c7d7f5" : "#7ba6e8"}" rx="2"/>
        <text x="${cx - bw / 2 - 2}" y="${y - 4}" font-size="9" text-anchor="middle" fill="#4b5563">${finFmt(r.rev, co.fin_unit)}</text>`;
    }
    if (r.op != null) {
      const y = yScale(Math.max(0, r.op)), y2 = yScale(Math.min(0, r.op));
      bars += `<rect x="${cx + 2}" y="${r.op >= 0 ? y : y0}" width="${bw}" height="${Math.max(1, Math.abs(y0 - (r.op >= 0 ? y : y2)))}" fill="${r.op >= 0 ? (r.est ? "#f6c8ad" : "#f0955a") : "#dc2626"}" rx="2"/>
        <text x="${cx + bw / 2 + 2}" y="${(r.op >= 0 ? y : y2) - 4}" font-size="9" text-anchor="middle" fill="#92400e">${finFmt(r.op, co.fin_unit)}</text>`;
    }
    if (r.opm != null) pts.push([cx, opmY(r.opm), r.opm]);
    labels += `<text x="${cx}" y="${H - 14}" font-size="10" text-anchor="middle" fill="#6b7280">${r.y}${r.est ? "(E)" : ""}</text>`;
  });
  if (pts.length > 1) {
    line = `<polyline points="${pts.map((p) => p[0] + "," + p[1]).join(" ")}" fill="none" stroke="#16a34a" stroke-width="2"/>` +
      pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="#16a34a"/>
        <text x="${p[0]}" y="${p[1] - 6}" font-size="9" text-anchor="middle" fill="#15803d">${p[2].toFixed(1)}%</text>`).join("");
  }
  // 확장 지표 표: 순이익·순이익률·EPS·ROE·부채비율·주당배당금
  let extTable = "";
  const ext = co.fin_ext;
  if (ext?.length) {
    const kr = st.market === "kr";
    const fmtN = (v) => v == null ? "-" : finFmt(v, co.fin_unit);
    const fmtP = (v, warn) => v == null ? "-" :
      `<span class="${warn ? (v >= 200 ? "neg" : "") : (v >= 0 ? "pos" : "neg")}">${v.toLocaleString(undefined, { maximumFractionDigits: 1 })}%</span>`;
    const fmtE = (v) => v == null ? "-" : (kr ? Math.round(v).toLocaleString() + "원" : "$" + v);
    const ROWS = [
      ["순이익", (r) => fmtN(r.net)],
      ["순이익률", (r) => fmtP(r.npm)],
      ["EPS", (r) => fmtE(r.eps)],
      ["ROE", (r) => fmtP(r.roe)],
      ["부채비율", (r) => fmtP(r.debt, true)],
    ];
    if (ext.some((r) => r.dps != null)) ROWS.push(["주당배당금", (r) => fmtE(r.dps)]);
    extTable = `<div class="tablewrap" style="margin-top:6px"><table class="fin-ext">
      <tr><th></th>${ext.map((r) => `<th>${r.y}${r.est ? "(E)" : ""}</th>`).join("")}</tr>
      ${ROWS.map(([name, f]) => `<tr><td>${name}</td>${ext.map((r) => `<td>${f(r)}</td>`).join("")}</tr>`).join("")}
    </table></div>`;
  }
  host.innerHTML = `<h3 class="lk-h3">📊 연간 실적 <span class="sub-note">(단위 ${co.fin_unit === "억원" ? "조/억원" : "USD"} · (E)=컨센서스 추정 · ${st.market === "kr" ? (co.fin_src === "DART" ? "DART 전자공시 실적 + 네이버 추정" : "네이버") : "Yahoo"})</span></h3>
    <svg viewBox="0 0 ${W} ${H}" class="fin-svg">
      <line x1="${padL}" y1="${y0}" x2="${W - padL}" y2="${y0}" stroke="#e5e7eb"/>
      ${bars}${line}${labels}
    </svg>
    <p class="legend" style="margin-top:2px"><span style="color:#7ba6e8">■</span> 매출액 ·
      <span style="color:#f0955a">■</span> 영업이익 · <span style="color:#16a34a">●─</span> 영업이익률(%)
      · 옅은색 = 추정치</p>
    ${extTable}`;
}

// 공시(6개월)·뉴스(1주일) 피드
function renderLookupFeed(st) {
  const wrap = $("#lookup-feed");
  const fd = EXTRAS.feed?.map?.[`${st.market}_${st.ticker}`];
  if (!fd || (!fd.disc?.length && !fd.news?.length)) { wrap.style.display = "none"; return; }
  wrap.style.display = "grid";
  $("#lookup-disc").innerHTML = fd.disc?.length
    ? fd.disc.map((d) => `<div class="lk-feed-row"><span class="lk-feed-date">${d.d.slice(5)}</span>
        ${d.link ? `<a href="${d.link}" target="_blank" rel="noopener">${d.title}</a>` : `<span>${d.title}</span>`}</div>`).join("")
    : `<p class="mini-note">최근 6개월 공시 없음</p>`;
  $("#lookup-news").innerHTML = fd.news?.length
    ? fd.news.map((n) => `<div class="lk-feed-row"><span class="lk-feed-date">${n.t}</span>
        <a href="${n.link}" target="_blank" rel="noopener">${n.title}</a>
        ${n.src ? `<span class="sub-note">${n.src}</span>` : ""}</div>`).join("")
    : `<p class="mini-note">최근 1주일 뉴스 없음</p>`;
}

const FUND_FIELDS = [
  ["per", "PER", (v) => v.toFixed(1) + "배"], ["per_fwd", "선행 PER", (v) => v.toFixed(1) + "배"],
  ["pbr", "PBR", (v) => v.toFixed(2) + "배"], ["roe", "ROE", (v) => v.toFixed(1) + "%"],
  ["op_margin", "영업이익률", (v) => v.toFixed(1) + "%"], ["profit_margin", "순이익률", (v) => v.toFixed(1) + "%"],
  ["rev_growth", "매출 성장", (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + "%"],
  ["div_yield", "배당수익률", (v) => v.toFixed(2) + "%"], ["beta", "베타", (v) => v.toFixed(2)],
];

function fmtMcap(v, mk) {
  if (mk === "kr") return v >= 1e12 ? (v / 1e12).toFixed(1) + "조원" : (v / 1e8).toFixed(0) + "억원";
  return v >= 1e12 ? "$" + (v / 1e12).toFixed(2) + "T" : "$" + (v / 1e9).toFixed(0) + "B";
}

function renderLookupFund(mk, tk, series) {
  const host = $("#lookup-fund");
  const f = FUND?.map?.[`${mk}_${tk}`];
  if (!f || !Object.keys(f).length) { host.style.display = "none"; return; }
  host.style.display = "";
  // 52주 고저는 로드된 시계열에서 직접 계산 (약 1.5년 중 최근 252봉)
  const closes = series.slice(-252).map((x) => x.c);
  const hi52 = f.hi52 ?? Math.max(...closes), lo52 = f.lo52 ?? Math.min(...closes);
  const cur = closes[closes.length - 1];
  const pos = ((cur - lo52) / (hi52 - lo52) * 100);
  const items = FUND_FIELDS.filter(([k]) => f[k] != null)
    .map(([k, label, fmt]) => `<div class="fund-item"><span>${label}</span><b>${fmt(f[k])}</b></div>`);
  if (f.mcap != null)
    items.push(`<div class="fund-item"><span>시가총액</span><b>${fmtMcap(f.mcap, mk)}</b></div>`);
  items.push(`<div class="fund-item"><span>52주 위치</span><b>${pos.toFixed(0)}%</b></div>`);
  if (f.industry) items.push(`<div class="fund-item"><span>업종</span><b>${f.industry}</b></div>`);
  host.innerHTML = `<div class="fund-head">재무 스냅샷
      <span class="sub-note">(주 1회 갱신 · KR=네이버 / US=Yahoo · 52주 위치: 저가 0%~고가 100%)</span></div>
    <div class="fund-grid">${items.join("")}</div>`;
}

/* ---------- 딜 레이더 (M&A — deal-radar 소스 재사용) ---------- */
function renderDeals() {
  if (!DEALS) { $("#deals-context").textContent = "deals.json 없음 — python analysis\\deal_news.py 실행 필요"; return; }
  dealsRendered = true;
  $("#deals-context").innerHTML =
    `<b>기사 수집</b> ${DEALS.generated} (${relTime(DEALS.generated)} · <b>클라우드 30분 주기</b>) · <b>AI 딜 브리핑</b> ${DEALS.brief_at || "-"} ·
     소스: deal-radar 공유(더벨·딜사이트 site: + 국내외 M&A/자본시장) · 30일 누적 보관`;

  const drawBrief = (brief) => {
    const box = $("#deals-brief");
    if (!brief) { box.style.display = "none"; return; }
    box.style.display = "";
    box.innerHTML = `<h3>🧭 딜 브리핑 <span class="sub-note">(Gemini · [#n]=근거)</span></h3>
      <p>${brief.replace(/\n/g, "<br>")}</p>`;
  };
  const sel = fillBriefHist("deals-hist", "deals-hist-wrap", DEALS_BRIEFS);
  if (sel) sel.onchange = () => drawBrief(DEALS_BRIEFS.entries[+sel.value].curation);
  drawBrief(DEALS.brief);

  const drawList = () => {
    const view = document.querySelector('input[name="dealsview"]:checked').value;
    if (view === "archive") {
      $("#deals-latest").style.display = "none";
      $("#deals-archive-list").style.display = "";
      $("#deals-archive-list").innerHTML =
        `<h2>📁 30일 누적 <span class="sub-note">(최초 등장 시각순)</span></h2>
         <div class="news-list card-flat">${archiveList(DEALS_ARCH, false)}</div>`;
    } else {
      $("#deals-latest").style.display = "";
      $("#deals-archive-list").style.display = "none";
      $("#deals-premium").innerHTML = newsList(DEALS.premium, false);
      $("#deals-kr").innerHTML = newsList(DEALS.kr, false);
      $("#deals-global").innerHTML = newsList(DEALS.global, false);
    }
  };
  document.querySelectorAll('input[name="dealsview"]').forEach((r) => { r.onchange = drawList; });
  drawList();
}

/* ---------- 매매일지 (localStorage — 서버 전송 없음) ---------- */
const JR_KEY = "cp_journal_v1";
const JR_EMOTIONS = ["차분", "확신", "조급", "공포", "탐욕", "FOMO", "복수심", "피곤"];
let jrFilter = "all";
let jrEditId = null;

function jrLoad() { try { return JSON.parse(localStorage.getItem(JR_KEY)) || []; } catch (e) { return []; } }
function jrSave(arr) { localStorage.setItem(JR_KEY, JSON.stringify(arr)); }
function jrIsKr(t) { return /^\d{6}$/.test(t); }
function jrPnl(r) {
  if (r.exit == null || r.exit === "") return null;
  const d = (r.exit - r.entry) * (r.side === "short" ? -1 : 1);
  return { amt: d * r.qty, pct: r.entry ? d / r.entry : 0 };
}
function jrMoney(v, kr) {
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  const a = Math.abs(v);
  return sign + (kr ? Math.round(a).toLocaleString() + "원" : "$" + a.toLocaleString(undefined, { maximumFractionDigits: 2 }));
}

function initJournal() {
  journalRendered = true;
  if (!LOOKUP_INDEX) initLookup();  // 종목 자동완성 datalist 재사용
  $("#jr-new").onclick = () => jrOpenModal(null);
  $("#jr-close").onclick = $("#jr-cancel").onclick = () => $("#jr-modal").close();
  $("#jr-filter").querySelectorAll(".chip").forEach((b) => b.onclick = () => {
    jrFilter = b.dataset.f;
    $("#jr-filter").querySelectorAll(".chip").forEach((x) => x.classList.toggle("active", x === b));
    jrRenderList();
  });
  $("#jr-side").querySelectorAll("button").forEach((b) => b.onclick = () =>
    $("#jr-side").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b)));
  $("#jr-emo-chips").innerHTML = JR_EMOTIONS.map((e) => `<span class="badge jr-emo">${e}</span>`).join("");
  $("#jr-emo-chips").querySelectorAll(".jr-emo").forEach((c) => c.onclick = () => {
    const inp = $("#jr-emotion");
    inp.value = inp.value ? (inp.value.includes(c.textContent) ? inp.value : inp.value + ", " + c.textContent) : c.textContent;
  });
  $("#jr-form").onsubmit = (e) => { e.preventDefault(); jrSubmit(); };
  $("#jr-delete").onclick = () => {
    if (!jrEditId || !confirm("이 거래 기록을 삭제할까요?")) return;
    jrSave(jrLoad().filter((r) => r.id !== jrEditId));
    $("#jr-modal").close(); jrRender();
  };
  $("#jr-export").onclick = () => {
    const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), trades: jrLoad() }, null, 2)],
      { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `매매일지_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  $("#jr-import").onclick = () => $("#jr-import-file").click();
  $("#jr-import-file").onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    f.text().then((txt) => {
      try {
        const d = JSON.parse(txt);
        const arr = Array.isArray(d) ? d : d.trades;
        if (!Array.isArray(arr)) throw new Error("bad");
        const cur = jrLoad();
        const ids = new Set(cur.map((r) => r.id));
        const add = arr.filter((r) => r.id && !ids.has(r.id));
        jrSave(cur.concat(add));
        alert(`${add.length}건 가져옴 (중복 ${arr.length - add.length}건 제외)`);
        jrRender();
      } catch (err) { alert("JSON 형식이 올바르지 않습니다"); }
      e.target.value = "";
    });
  };
  jrRender();
}

function jrOpenModal(trade) {
  jrEditId = trade?.id || null;
  $("#jr-modal-title").textContent = trade ? "거래 수정 · 복기" : "새 거래 기록";
  $("#jr-save").textContent = trade ? "저장" : "＋ 기록";
  $("#jr-delete").style.display = trade ? "" : "none";
  $("#jr-ticker").value = trade ? (jrIsKr(trade.ticker) ? `${trade.name} (${trade.ticker})` : trade.ticker) : "";
  $("#jr-qty").value = trade?.qty ?? "";
  $("#jr-entry").value = trade?.entry ?? "";
  $("#jr-exit").value = trade?.exit ?? "";
  $("#jr-etime").value = trade?.etime || new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  $("#jr-xtime").value = trade?.xtime || "";
  $("#jr-reason").value = trade?.reason || "";
  $("#jr-emotion").value = trade?.emotion || "";
  $("#jr-note").value = trade?.note || "";
  const side = trade?.side || "buy";
  $("#jr-side").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x.dataset.s === side));
  $("#jr-modal").showModal();
}

function jrSubmit() {
  const raw = $("#jr-ticker").value.trim();
  const m = raw.match(/\(([A-Za-z0-9.]+)\)\s*$/);  // "삼성전자 (005930)" → 005930
  const ticker = (m ? m[1] : raw).toUpperCase();
  const hit = LOOKUP_INDEX?.find((x) => x.ticker.toUpperCase() === ticker || x.name === raw);
  const rec = {
    id: jrEditId || ("t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    ticker: hit ? hit.ticker : ticker,
    name: m ? raw.replace(/\s*\(.*\)$/, "") : (hit?.name || ticker),
    side: $("#jr-side").querySelector(".active")?.dataset.s || "buy",
    qty: +$("#jr-qty").value,
    entry: +$("#jr-entry").value,
    exit: $("#jr-exit").value === "" ? null : +$("#jr-exit").value,
    etime: $("#jr-etime").value, xtime: $("#jr-xtime").value || null,
    reason: $("#jr-reason").value.trim(), emotion: $("#jr-emotion").value.trim(), note: $("#jr-note").value.trim(),
  };
  const arr = jrLoad();
  const i = arr.findIndex((r) => r.id === rec.id);
  if (i >= 0) arr[i] = rec; else arr.unshift(rec);
  jrSave(arr);
  $("#jr-modal").close();
  jrRender();
}

function jrRender() { jrRenderStats(); jrRenderList(); }

function jrRenderStats() {
  const arr = jrLoad();
  const closed = arr.filter((r) => jrPnl(r));
  let krSum = 0, usSum = 0, win = 0;
  closed.forEach((r) => {
    const p = jrPnl(r);
    if (jrIsKr(r.ticker)) krSum += p.amt; else usSum += p.amt;
    if (p.amt > 0) win++;
  });
  const pnlTxt = [krSum ? jrMoney(krSum, true) : null, usSum ? jrMoney(usSum, false) : null]
    .filter(Boolean).join(" · ") || "0";
  const cls = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
  $("#jr-stats").innerHTML = `
    <div class="idx-card"><div class="sub-note">총 손익 (종료 거래)</div>
      <div class="lk-name ${cls(krSum + usSum)}">${pnlTxt}</div></div>
    <div class="idx-card"><div class="sub-note">승률</div>
      <div class="lk-name">${closed.length ? Math.round(win / closed.length * 100) + "%" : "-"}
        <span class="sub-note">${closed.length ? `(${win}/${closed.length})` : ""}</span></div></div>
    <div class="idx-card"><div class="sub-note">거래</div>
      <div class="lk-name">${arr.length}<span class="sub-note"> 종료 ${closed.length} · 진행 ${arr.length - closed.length}</span></div></div>`;
}

function jrRenderList() {
  const host = $("#jr-list");
  let arr = jrLoad();
  if (jrFilter === "open") arr = arr.filter((r) => !jrPnl(r));
  if (jrFilter === "closed") arr = arr.filter((r) => jrPnl(r));
  if (!arr.length) {
    host.innerHTML = `<div class="card-flat" style="text-align:center;padding:36px 16px;color:var(--muted)">
      아직 기록이 없습니다 — <b>＋ 새 거래</b>로 첫 매매를 기록해 보세요.<br>
      <span class="sub-note">기록하는 것만으로도 충동 매매가 줄어듭니다.</span></div>`;
    return;
  }
  host.innerHTML = arr.map((r) => {
    const p = jrPnl(r);
    const kr = jrIsKr(r.ticker);
    const logo = kr ? `https://ssl.pstatic.net/imgstock/fn/real/logo/stock/Stock${r.ticker}.svg` :
      (EXTRAS.company?.map?.[`us_${r.ticker}`]?.logo || "");
    return `<div class="card-flat jr-row" data-id="${r.id}">
      ${logo ? `<img class="mv-logo" src="${logo}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="mv-logo"></span>`}
      <span class="jr-main"><b>${r.name}</b> <span class="sub-note">${r.ticker}</span>
        <span class="badge ${r.side === "buy" ? "hero" : "dim"}">${r.side === "buy" ? "매수" : "공매도"}</span>
        <span class="badge dim" style="${p ? "" : "background:#eef2ff;color:#3730a3;border-color:#c7d2fe"}">${p ? "종료" : "진행중"}</span><br>
        <span class="jr-sub">${r.qty}주 · ${fmtPrice(r.entry, kr ? "kr" : "us")} → ${r.exit != null ? fmtPrice(r.exit, kr ? "kr" : "us") : "—"}
          · ${(r.etime || "").replace("T", " ")}</span>
        ${r.reason ? `<br><span class="jr-sub">📝 ${r.reason.slice(0, 80)}</span>` : ""}
        ${r.emotion ? `<span class="jr-sub"> · 😶 ${r.emotion}</span>` : ""}</span>
      <span class="jr-pnl">${p ? `<b class="${p.amt >= 0 ? "pos" : "neg"}">${jrMoney(p.amt, kr)}</b><br>
        <span class="${p.amt >= 0 ? "pos" : "neg"}">${pct(p.pct, 1)}</span>` : ""}</span>
    </div>`;
  }).join("");
  host.querySelectorAll(".jr-row").forEach((el) => el.onclick = () => {
    jrOpenModal(jrLoad().find((r) => r.id === el.dataset.id));
  });
}

/* ---------- 포트폴리오 점검 (localStorage — 서버 전송 없음) ---------- */
const PF_KEY = "cp_portfolio_v1";
const pfStockCache = new Map();  // key -> stocks/{key}.json

function pfLoad() { try { return JSON.parse(localStorage.getItem(PF_KEY)) || []; } catch (e) { return []; } }
function pfSave(a) { localStorage.setItem(PF_KEY, JSON.stringify(a)); }

function pfResolve(raw) {
  const m = raw.match(/\(([A-Za-z0-9.]+)\)\s*$/);
  const tk = (m ? m[1] : raw).toUpperCase();
  const hit = LOOKUP_INDEX?.find((x) => x.ticker.toUpperCase() === tk || x.name === raw.trim() ||
    (x.name + " (" + x.ticker + ")") === raw.trim());
  return hit ? { ticker: hit.ticker, name: hit.name, mk: hit.market } : null;
}

function initPortfolio() {
  portfolioRendered = true;
  if (!LOOKUP_INDEX) initLookup();
  $("#pf-add").onclick = () => {
    const r = pfResolve($("#pf-ticker").value);
    if (!r) { alert("유니버스에서 종목을 찾지 못했습니다 — 자동완성 목록에서 선택해 주세요"); return; }
    const arr = pfLoad();
    if (arr.some((x) => x.ticker === r.ticker)) { alert("이미 보유 목록에 있습니다"); return; }
    arr.push({ ...r, qty: +$("#pf-qty").value || 0, avg: +$("#pf-avg").value || 0 });
    pfSave(arr);
    $("#pf-ticker").value = $("#pf-qty").value = $("#pf-avg").value = "";
    pfRender();
  };
  $("#pf-import").onclick = () => {
    const open = (typeof jrLoad === "function" ? jrLoad() : []).filter((t) => t.exit == null && t.side === "buy");
    if (!open.length) { alert("매매일지에 진행중(매수) 거래가 없습니다"); return; }
    const arr = pfLoad();
    let added = 0;
    open.forEach((t) => {
      if (!arr.some((x) => x.ticker === t.ticker)) {
        arr.push({ ticker: t.ticker, name: t.name, mk: /^\d{6}$/.test(t.ticker) ? "kr" : "us", qty: t.qty, avg: t.entry });
        added++;
      }
    });
    pfSave(arr);
    alert(added + "종목 불러옴 (중복 제외)");
    pfRender();
  };
  pfRender();
}

async function pfRender() {
  const arr = pfLoad();
  const statsEl = $("#pf-stats"), listEl = $("#pf-list");
  if (!arr.length) {
    statsEl.style.display = "none";
    listEl.innerHTML = `<div class="card-flat" style="text-align:center;padding:36px;color:var(--muted)">
      보유종목을 추가하면 뉴스·수급·섹터 흐름·원칙 신호를 종합 점검합니다.<br>
      <span class="sub-note">매매일지의 진행중 거래를 한 번에 불러올 수도 있습니다.</span></div>`;
    return;
  }
  listEl.innerHTML = `<p class="mini-note">점검 데이터 로드 중...</p>`;
  await loadExtras();
  await Promise.all(arr.map((h) => {
    const key = h.mk + "_" + h.ticker;
    if (pfStockCache.has(key)) return null;
    return fetch(`data/stocks/${key}.json` + _cb).then((r) => (r.ok ? r.json() : null))
      .then((j) => pfStockCache.set(key, j));
  }));
  pfRenderStats(arr);
  pfRenderList(arr);
}

// 종목별 점검 — 감점 룰: 유효 매도신호 -2 / 섹터 RS 전구간 음수 -1 / 외인+기관 동반매도 -1 / 1M 상대 -10%p -1
function pfCheck(h) {
  const key = h.mk + "_" + h.ticker;
  const st = pfStockCache.get(key);
  const q = MARKET?.quotes?.[key];
  const cur = q ? q[0] : st?.series?.[st.series.length - 1]?.c;
  const tile = MARKET?.heatmap?.find((t) => t.m === h.mk && t.t === h.ticker);
  const sector = tile?.sector || st?.profile?.sector;
  const rs = MPRO?.rotation?.[h.mk]?.sectors?.find((x) => x.sector === sector);
  const p = st?.profile || {};
  const sup = st?.supply_sum;
  const cons = EXTRAS.company?.map?.[key]?.cons;
  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const recentSell = (st?.markers || []).filter((m) => m.side === "sell" && m.t >= cutoff && ruleActive(m.rule_id, h.mk));
  const recentBuy = (st?.markers || []).filter((m) => m.side === "buy" && m.t >= cutoff && ruleActive(m.rule_id, h.mk));

  let score = 0;
  const reasons = [];
  if (recentSell.length) { score -= 2; reasons.push(`검증된 매도신호 ${recentSell.length}건(30일)`); }
  if (rs && rs.rs_w1 < 0 && rs.rs_m1 < 0 && rs.rs_m3 < 0) { score -= 1; reasons.push("섹터가 전 기간 시장 대비 약세"); }
  if (sup && sup.frgn_20 != null && sup.inst_20 != null && sup.frgn_20 < 0 && sup.inst_20 < 0) {
    score -= 1; reasons.push("외국인·기관 20일 동반 순매도");
  }
  if (p.rel_m1 != null && p.rel_m1 < -0.10) { score -= 1; reasons.push(`1개월 시장 대비 ${pct(p.rel_m1, 0)} 뒤처짐`); }
  const grade = score <= -3 ? "bad" : score < 0 ? "warn" : "good";
  const gradeTxt = grade === "bad" ? "🔴 논거 재점검" : grade === "warn" ? "🟡 점검 필요" : "🟢 흐름 양호";
  if (!reasons.length) reasons.push(recentBuy.length ? `매수신호 ${recentBuy.length}건(30일) — 원칙상 우호적` : "감점 요인 없음");
  return { st, cur, sector, rs, p, sup, cons, recentSell, recentBuy, grade, gradeTxt, reasons };
}

function pfRenderStats(arr) {
  const statsEl = $("#pf-stats");
  statsEl.style.display = "";
  let krVal = 0, krCost = 0, usVal = 0, usCost = 0;
  const secW = {};
  let nBad = 0, nWarn = 0;
  arr.forEach((h) => {
    const c = pfCheck(h);
    const v = (c.cur || 0) * h.qty;
    if (h.mk === "kr") { krVal += v; krCost += h.avg * h.qty; } else { usVal += v; usCost += h.avg * h.qty; }
    if (c.sector) secW[c.sector] = (secW[c.sector] || 0) + v;
    if (c.grade === "bad") nBad++;
    if (c.grade === "warn") nWarn++;
  });
  const totV = krVal + usVal;
  const topSec = Object.entries(secW).sort((a, b) => b[1] - a[1])[0];
  const conc = topSec && totV ? topSec[1] / totV : 0;
  const ret = (v, c) => (c ? v / c - 1 : null);
  const fmtR = (r) => r == null ? "" : `<span class="${r >= 0 ? "pos" : "neg"}">${pct(r, 1)}</span>`;
  const rg = MARKET?.regime || {};
  const valTxt = [krVal ? Math.round(krVal).toLocaleString() + "원" : null,
                  usVal ? "$" + usVal.toLocaleString(undefined, { maximumFractionDigits: 0 }) : null]
    .filter(Boolean).join(" · ") || "-";
  statsEl.innerHTML = `
    <div class="idx-card"><div class="sub-note">평가액 (30분 시세)</div>
      <div class="lk-name" style="font-size:.98rem">${valTxt}</div>
      <div class="sub-note">수익률 🇰🇷${fmtR(ret(krVal, krCost)) || "-"} 🇺🇸${fmtR(ret(usVal, usCost)) || "-"}</div></div>
    <div class="idx-card"><div class="sub-note">시장 국면</div>
      <div class="lk-name" style="font-size:.98rem">🇰🇷 ${REGIME_KO[rg.kr] || "-"}<br>🇺🇸 ${REGIME_KO[rg.us] || "-"}</div></div>
    <div class="idx-card"><div class="sub-note">섹터 집중도</div>
      <div class="lk-name">${topSec ? `${Math.round(conc * 100)}%` : "-"}
        <span class="sub-note">${topSec ? topSec[0] : ""}</span></div>
      <div class="sub-note">${conc >= 0.4 ? "⚠ 단일 섹터 40%↑ — 분산 점검" : "집중도 양호"}</div></div>
    <div class="idx-card"><div class="sub-note">점검 결과</div>
      <div class="lk-name">${nBad ? `🔴 ${nBad}` : ""} ${nWarn ? `🟡 ${nWarn}` : ""} 🟢 ${arr.length - nBad - nWarn}</div>
      <div class="sub-note">${nBad ? "빨간 종목의 보유 논거부터 재점검" : nWarn ? "노란 종목 사유 확인" : "전 종목 흐름 양호"}</div></div>`;
}

function pfRenderList(arr) {
  const listEl = $("#pf-list");
  listEl.innerHTML = arr.map((h, idx) => {
    const key = h.mk + "_" + h.ticker;
    const c = pfCheck(h);
    const logo = h.mk === "kr" ? `https://ssl.pstatic.net/imgstock/fn/real/logo/stock/Stock${h.ticker}.svg`
      : (EXTRAS.company?.map?.[key]?.logo || "");
    const ret = h.avg && c.cur ? c.cur / h.avg - 1 : null;
    const fd = EXTRAS.feed?.map?.[key];
    const rsArrow = c.rs ? (c.rs.rs_w1 > c.rs.rs_m1 ? "↗ 가속" : "↘ 감속") : "";
    const upside = c.cons?.target && c.cur ? c.cons.target / c.cur - 1 : null;
    const rowsHtml = `
      <div class="prof-grid wide" style="margin-top:8px">
        <div class="prof-row"><span>보유 손익 (평단 ${h.avg ? fmtPrice(h.avg, h.mk) : "-"})</span>
          <span>${c.cur ? fmtPrice(c.cur, h.mk) : "-"} ${ret != null ? `<b class="${ret >= 0 ? "pos" : "neg"}">${pct(ret, 1)}</b>` : ""}</span></div>
        <div class="prof-row"><span>시장 대비 성과</span>
          <span>1개월 ${c.p.rel_m1 != null ? `<b class="${c.p.rel_m1 >= 0 ? "pos" : "neg"}">${pct(c.p.rel_m1, 1)}</b>` : "-"}
            · 3개월 ${c.p.rel_m3 != null ? `<b class="${c.p.rel_m3 >= 0 ? "pos" : "neg"}">${pct(c.p.rel_m3, 1)}</b>` : "-"}</span></div>
        <div class="prof-row"><span>섹터 흐름 (${c.sector || "-"})</span>
          <span>${c.rs ? `RS 1주 <b class="${c.rs.rs_w1 >= 0 ? "pos" : "neg"}">${pct(c.rs.rs_w1, 1)}</b>
            · 1개월 <b class="${c.rs.rs_m1 >= 0 ? "pos" : "neg"}">${pct(c.rs.rs_m1, 1)}</b>
            · 3개월 <b class="${c.rs.rs_m3 >= 0 ? "pos" : "neg"}">${pct(c.rs.rs_m3, 1)}</b> ${rsArrow}` : "섹터 데이터 없음"}</span></div>
        <div class="prof-row"><span>수급 (20일)</span>
          <span>${c.sup ? `외국인 <b class="${(c.sup.frgn_20 || 0) >= 0 ? "pos" : "neg"}">${c.sup.frgn_20 > 0 ? "+" : ""}${Math.round(c.sup.frgn_20 || 0).toLocaleString()}억</b>
            · 기관 <b class="${(c.sup.inst_20 || 0) >= 0 ? "pos" : "neg"}">${c.sup.inst_20 > 0 ? "+" : ""}${Math.round(c.sup.inst_20 || 0).toLocaleString()}억</b>` : "미국 종목 미지원"}</span></div>
        <div class="prof-row"><span>컨센서스</span>
          <span>${c.cons?.target ? `목표가 ${fmtPrice(c.cons.target, h.mk)} <b class="${upside >= 0 ? "pos" : "neg"}">(${pct(upside, 0)})</b>` : "-"}</span></div>
        <div class="prof-row"><span>원칙 신호 (30일, 현 국면 유효)</span>
          <span>${c.recentSell.length ? `<b class="neg">매도 ${c.recentSell.length}건</b> (${[...new Set(c.recentSell.map((m) => RULE_ABBR[m.rule_id] || m.rule_id))].join("·")})` : ""}
            ${c.recentBuy.length ? `<b class="pos">매수 ${c.recentBuy.length}건</b>` : ""}
            ${!c.recentSell.length && !c.recentBuy.length ? "없음" : ""}</span></div>
      </div>`;
    const feedHtml = fd ? `
      <div class="lookup-two" style="margin-top:10px">
        <div><div class="perf-h">📰 최근 1주 뉴스</div>
          ${fd.news?.length ? fd.news.slice(0, 5).map((n) => `<div class="lk-feed-row"><span class="lk-feed-date">${n.t}</span>
            <a href="${n.link}" target="_blank" rel="noopener">${n.title}</a></div>`).join("") : `<p class="mini-note">없음</p>`}</div>
        <div><div class="perf-h">📢 최근 공시</div>
          ${fd.disc?.length ? fd.disc.slice(0, 5).map((d) => `<div class="lk-feed-row"><span class="lk-feed-date">${d.d.slice(5)}</span>
            ${d.link ? `<a href="${d.link}" target="_blank" rel="noopener">${d.title}</a>` : `<span>${d.title}</span>`}</div>`).join("") : `<p class="mini-note">없음</p>`}</div>
      </div>` : "";
    return `<details class="card-flat pf-card ${c.grade}" ${c.grade !== "good" ? "open" : ""}>
      <summary class="pf-sum">
        ${logo ? `<img class="mv-logo" src="${logo}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="mv-logo"></span>`}
        <span class="pf-name"><b>${h.name}</b> <span class="sub-note">${h.ticker} · ${h.qty}주</span></span>
        <span class="pf-ret">${ret != null ? `<b class="${ret >= 0 ? "pos" : "neg"}">${pct(ret, 1)}</b>` : ""}</span>
        <span class="pf-grade ${c.grade}">${c.gradeTxt}</span>
      </summary>
      <p class="pf-reason">${c.grade === "good" ? "✅" : "⚠"} ${c.reasons.join(" · ")}</p>
      ${rowsHtml}${feedHtml}
      <div style="margin-top:10px;display:flex;gap:14px">
        <a href="#" class="goto-lookup pf-goto" data-key="${key}">종목 조회에서 상세 분석 →</a>
        <span style="flex:1"></span>
        <a href="#" class="pf-edit" data-i="${idx}">수정</a>
        <a href="#" class="pf-del" data-i="${idx}" style="color:#b91c1c">삭제</a>
      </div>
    </details>`;
  }).join("") + `<p class="sub-note" style="margin-top:10px">판정 룰: 유효 매도신호(-2) · 섹터 전기간 약세(-1) ·
    외인+기관 동반매도(-1) · 1개월 상대성과 -10%p(-1) → 합계 -3↓=🔴 / -1~-2=🟡 / 0=🟢. 참고용 자동 판정.</p>`;

  listEl.querySelectorAll(".pf-goto").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelector('.group[data-group="discover"]').click();
    document.querySelector('[data-tab="lookup"]').click();
    if (!lookupRendered) initLookup();
    loadLookup(a.dataset.key);
  }));
  listEl.querySelectorAll(".pf-del").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    const arr = pfLoad();
    if (!confirm(arr[+a.dataset.i].name + " 을(를) 목록에서 삭제할까요?")) return;
    arr.splice(+a.dataset.i, 1);
    pfSave(arr); pfRender();
  }));
  listEl.querySelectorAll(".pf-edit").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    const arr = pfLoad(), it = arr[+a.dataset.i];
    const qty = prompt(`${it.name} 수량(주)`, it.qty);
    if (qty == null) return;
    const avg = prompt(`${it.name} 평균단가`, it.avg);
    if (avg == null) return;
    it.qty = +qty || 0; it.avg = +avg || 0;
    pfSave(arr); pfRender();
  }));
}

/* ---------- 투자 대가 (13F) ---------- */
const GURU_CHG = { new: ["🆕 신규", "#4338ca"], add: ["➕ 증액", "#065f46"],
                   trim: ["➖ 축소", "#92400e"], hold: ["— 유지", "#6b7280"] };

function renderGurus() {
  if (!GURUS) { $("#gurus-context").textContent = "gurus.json 없음 — python analysis\\gurus.py 실행 필요"; return; }
  gurusRendered = true;
  $("#gurus-context").innerHTML =
    `SEC 13F 의무공시 기반(분기말 <b>+45일 지연</b> — '최신'의 한계) · 확인 주기 <b>주 1회</b>(13F가 분기
     공시라 이것으로 충분, 마지막 확인 ${GURUS.generated}) ·
     Thesis는 보유·변화 기반 <b>AI 추정</b>이며 본인 발언이 아님 · 트럼프는 13F 비대상 — <b>공개 재산신고 기반 별도 카드</b>(추정·부정기)`;
  // 버핏 현금(유동성) 추이 SVG: 막대=현금성 $B, 라인=현금비중 %
  const cashSvg = (c) => {
    const s = c.series;
    if (!s?.length) return "";
    const W = 620, H = 170, padL = 8, padB = 30, padT = 24;
    const gw = (W - padL * 2) / s.length;
    const maxV = Math.max(...s.map((r) => r.cash), 1);
    const rMin = Math.min(...s.map((r) => r.ratio)), rMax = Math.max(...s.map((r) => r.ratio));
    const yBar = (v) => padT + (maxV - v) / maxV * (H - padT - padB);
    const yR = (v) => padT + 2 + (rMax - v) / (rMax - rMin || 1) * 46;
    let bars = "", labels = "";
    const pts = [];
    s.forEach((r, i) => {
      const cx = padL + gw * i + gw / 2, bw = Math.min(30, gw / 2);
      const y = yBar(r.cash);
      bars += `<rect x="${cx - bw / 2}" y="${y}" width="${bw}" height="${H - padB - y}" fill="#93c5fd" rx="2"/>
        <text x="${cx}" y="${y - 4}" font-size="9" text-anchor="middle" fill="#4b5563">$${r.cash}B</text>`;
      pts.push([cx, yR(r.ratio), r.ratio]);
      labels += `<text x="${cx}" y="${H - 12}" font-size="9" text-anchor="middle" fill="#6b7280">${r.d.slice(2, 7).replace("-", ".")}</text>`;
    });
    const line = `<polyline points="${pts.map((p) => p[0] + "," + p[1]).join(" ")}" fill="none" stroke="#dc2626" stroke-width="2"/>` +
      pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="#dc2626"/>` +
        (i === pts.length - 1 || i % 2 === 0 ? `<text x="${p[0]}" y="${p[1] - 6}" font-size="9" text-anchor="middle" fill="#b91c1c">${p[2]}%</text>` : "")).join("");
    return `<div class="guru-cash"><b>💰 현금성 자산 추이</b>
        <span class="sub-note">(막대=현금·현금성+채권 $B · <span style="color:#dc2626">라인=현금비중</span>
        =현금성/(현금성+주식포트) · SEC 10-Q, 단기 T-bill 별도태그 미포함)</span>
      <svg viewBox="0 0 ${W} ${H}" class="fin-svg">${bars}${line}${labels}</svg></div>`;
  };

  const mk = window._guruMk || "us";
  document.querySelectorAll("#guru-mk button").forEach((b) => {
    b.classList.toggle("active", b.dataset.mk === mk);
    b.onclick = () => { window._guruMk = b.dataset.mk; renderGurus(); };
  });
  $("#gurus-list").innerHTML = GURUS.managers.filter((m) => (m.country || "us") === mk).map((m) => {
    // 13F 비대상(트럼프 등) — 공개 재산신고 기반 정적 카드
    if (m.type === "disclosure") {
      return `<details class="stock-block guru-block">
        <summary><b>${m.name}</b> <span class="sub-note">${m.fund}</span>
          <span class="badge dim">13F 비대상 · 공개 신고 기반</span>
          <span class="badge dim">${m.report_date}</span></summary>
        <div class="guru-body">
          <p class="guru-style">투자 스타일: ${m.style}</p>
          <p class="mini-note">⚠ ${m.source} — 비중·평가액 추정 불가 항목은 서술형으로만 표기</p>
          ${m.thesis ? `<div class="commentary guru-thesis"><b>구성 해설</b><br>${m.thesis}</div>` : ""}
          <div class="tablewrap"><table class="guru-table">
            <tr><th>주요 자산</th></tr>
            ${m.holdings.map((h) => `<tr><td>${h.issuer}</td></tr>`).join("")}</table></div>
        </div>
      </details>`;
    }
    const rows = m.holdings.map((h) => {
      const [label, color] = GURU_CHG[h.change] || GURU_CHG.hold;
      return `<tr>
        <td>${h.issuer}</td>
        <td><div class="wbar"><div style="width:${Math.min(100, h.weight * 100 / 0.5 * 100 / 100 * 2)}%"></div></div>
            ${(h.weight * 100).toFixed(1)}%</td>
        <td><span style="color:${color};font-weight:600">${label}</span>
            ${h.chg_shares != null && h.change !== "hold" ? `<span class="sub-note">(주식수 ${pct(h.chg_shares, 0)})</span>` : ""}</td>
      </tr>`;
    }).join("");
    const exits = m.exits.length
      ? `<p class="guru-exits">❌ 청산: ${m.exits.map((e) => `${e.issuer}(전분기 ${(e.weight_prev * 100).toFixed(1)}%)`).join(" · ")}</p>` : "";
    return `<details class="stock-block guru-block" ${m.id === "buffett" ? "open" : ""}>
      <summary><b>${m.name}</b> <span class="sub-note">${m.fund}</span>
        <span class="badge dim">${m.report_date} 분기</span>
        <span class="badge dim">${m.n_positions}종목 · $${(m.total_value / 1e9).toFixed(1)}B</span>
      </summary>
      <div class="guru-body">
        <p class="guru-style">투자 스타일: ${m.style}</p>
        ${m.cash ? cashSvg(m.cash) : ""}
        ${m.thesis ? `<div class="commentary guru-thesis"><b>🤖 AI 추정 Thesis</b><br>${m.thesis}</div>` : ""}
        <div class="tablewrap"><table class="guru-table">
          <tr><th>보유 종목 (상위 15)</th><th>비중</th><th>분기 변화</th></tr>${rows}</table></div>
        ${exits}
      </div>
    </details>`;
  }).join("");
}

/* ---------- 내재가치 (DCF·RIM — 브라우저 계산) ---------- */
function initValue() {
  valRendered = true;
  $("#val-context").innerHTML =
    `가정을 슬라이더로 바꾸면 <b>즉시 재계산</b>됩니다. 데이터: 🇰🇷 네이버 실적·추정 / 🇺🇸 Yahoo 재무제표(주 1회 갱신)
     · <b>모든 값은 추정 기반 참고용</b>이며 매수·매도 판단이 아닙니다`;
  if (!VAL) { $("#val-context").textContent = "valuation.json 없음 — python analysis\\valuation.py 실행 필요"; return; }
  // 종목 검색: lookup-list datalist 재사용 (initLookup이 채움)
  if (!LOOKUP_INDEX) initLookup();
  $("#val-q").addEventListener("change", () => {
    const q = $("#val-q").value.trim().toLowerCase();
    const hit = (LOOKUP_INDEX || []).find((s) =>
      q === s.ticker.toLowerCase() || q === s.name.toLowerCase() ||
      q === (s.name + " (" + s.ticker + ")").toLowerCase() ||
      s.name.toLowerCase().includes(q) || s.ticker.toLowerCase().includes(q));
    if (hit) loadValue(hit.market + "_" + hit.ticker, hit.name);
  });
}

function loadValue(key, name) {
  const rec = VAL.map[key];
  const mk = key.split("_")[0];
  const canRIM = rec && ((mk === "kr" && rec.roe?.length && rec.bps?.length) || (mk === "us" && rec.bps && rec.roe));
  const canDCF = mk === "us" && rec && rec.fcf?.length && rec.shares;
  if (!rec || (!canRIM && !canDCF)) {
    $("#val-body").style.display = "none";
    $("#val-empty").style.display = "";
    return;
  }
  $("#val-empty").style.display = "none";
  $("#val-body").style.display = "";
  VAL_CUR = { key, rec, mk, name };
  const ms = $("#val-model");
  ms.innerHTML = (canRIM ? `<option value="rim">RIM (잔여이익모형)</option>` : "") +
                 (canDCF ? `<option value="dcf">DCF (현금흐름할인)</option>` : "");
  $("#val-model-wrap").style.display = "inline";
  ms.onchange = buildSliders;
  buildSliders();
}

function sliderRow(id, label, min, max, step, val, unit, hint) {
  return `<div class="sl-row"><label for="${id}">${label} <span class="sub-note">${hint || ""}</span></label>
    <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}">
    <b id="${id}-v">${val}${unit}</b></div>`;
}

function buildSliders() {
  const { rec, mk } = VAL_CUR;
  const model = $("#val-model").value;
  let html = "";
  if (model === "rim") {
    // 기본 ROE: 추정치(마지막 값) 또는 실적 평균
    const roes = (mk === "kr" ? rec.roe : [rec.roe]).filter((v) => v != null);
    const roe0 = roes.length ? roes[roes.length - 1] : 10;
    html = sliderRow("sl-roe", "지속 ROE", 0, Math.max(40, Math.ceil(roe0 * 1.3)), 0.5, Math.round(roe0 * 2) / 2, "%",
                     mk === "kr" ? "(기본=올해 추정치 — 과열이면 낮춰보세요)" : "(기본=최근 ROE)") +
      sliderRow("sl-r", "요구수익률 r", 5, 15, 0.5, 9, "%", "(국고채+위험프리미엄, 보수적일수록 높게)") +
      sliderRow("sl-w", "초과이익 지속계수 w", 0, 1, 0.1, 0.7, "", "(1=영원히 지속, 0.7≈매년 30% 감소)");
  } else {
    const g0 = Math.min(20, Math.max(0, (rec.growth_est || 0.1) * 100));
    html = sliderRow("sl-g1", "성장률(5년) g₁", -5, 30, 1, Math.round(Math.min(15, g0)), "%", "(기본=애널리스트 추정, 상한 15% 권장)") +
      sliderRow("sl-r", "할인율 r (WACC)", 6, 15, 0.5, Math.min(15, Math.max(6, 6 + 4 * (rec.beta || 1))), "%", `(베타 ${rec.beta ?? "?"} 반영 기본값)`) +
      sliderRow("sl-g2", "영구성장률 g₂", 0, 3, 0.5, 2, "%", "(장기 물가상승률 수준)");
  }
  html += sliderRow("sl-mos", "안전마진", 0, 50, 5, 20, "%", "(내재가치에서 추가 할인)");
  $("#val-sliders").innerHTML = html;
  $("#val-sliders").querySelectorAll("input[type=range]").forEach((s) =>
    s.addEventListener("input", calcValue));
  calcValue();
}

function slv(id) { return parseFloat($("#" + id).value); }

function rimBreakdown(bps0, roePct, rPct, w) {
  const roe = roePct / 100, r = rPct / 100;
  const spread = roe - r;                       // 초과수익률(ROE−r)
  const ri = bps0 * spread;                     // 연간 초과이익/주
  const riValue = ri * w / (1 + r - w);         // 초과이익의 현재가치 합(w 감쇠 영구 합산)
  return { spread, ri, riValue, v: bps0 + riValue };
}
function rimValue(bps0, roePct, rPct, w) { return rimBreakdown(bps0, roePct, rPct, w).v; }

function dcfBreakdown(rec, g1Pct, rPct, g2Pct) {
  const fcf0 = rec.fcf.slice(0, 3).reduce((s, x) => s + x, 0) / Math.min(3, rec.fcf.length);
  const g1 = g1Pct / 100, r = rPct / 100, g2 = g2Pct / 100;
  const rows = [];
  let pv = 0, f = fcf0;
  for (let t = 1; t <= 5; t++) {
    f *= 1 + g1;
    const df = 1 / Math.pow(1 + r, t);
    rows.push({ t, fcf: f, df, pv: f * df });
    pv += f * df;
  }
  const tv = (r - g2 > 0.001) ? f * (1 + g2) / (r - g2) : 0;
  const pvTv = tv / Math.pow(1 + r, 5);
  const ev = pv + pvTv;
  const equity = ev - (rec.net_debt || 0);
  return { fcf0, rows, sumPv: pv, tv, pvTv, ev, netDebt: rec.net_debt || 0,
           equity, shares: rec.shares, per: equity / rec.shares };
}
function dcfValue(rec, g1Pct, rPct, g2Pct) { return dcfBreakdown(rec, g1Pct, rPct, g2Pct).per; }

function fmtB(v) { return (v >= 0 ? "" : "−") + "$" + Math.abs(v / 1e9).toFixed(1) + "B"; }

function calcValue() {
  const { rec, mk } = VAL_CUR;
  const model = $("#val-model").value;
  ["sl-roe", "sl-r", "sl-w", "sl-g1", "sl-g2", "sl-mos"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) $("#" + id + "-v").textContent = el.value + (id === "sl-w" ? "" : "%");
  });
  const mos = slv("sl-mos") / 100;
  let iv, sens = "", detail = "";
  if (model === "rim") {
    let bps0, bpsYear = "";
    if (mk === "kr") {
      const valid = rec.bps.map((v, i) => [v, i]).filter(([v]) => v != null);
      const pick = valid.length > 1 ? valid[valid.length - 2] : valid[valid.length - 1];  // 최근 확정연도
      bps0 = pick[0];
      bpsYear = rec.years?.[pick[1]] || "최근 확정";
    } else {
      bps0 = rec.bps;
      bpsYear = "최근 보고";
    }
    iv = rimValue(bps0, slv("sl-roe"), slv("sl-r"), slv("sl-w"));
    const bd = rimBreakdown(bps0, slv("sl-roe"), slv("sl-r"), slv("sl-w"));
    const roeSrc = mk === "kr" ? `네이버 컨센서스(연간 ${rec.years?.join("→") || ""} ROE: ${rec.roe?.map((v) => v == null ? "-" : v + "%").join(" → ")})` : "최근 보고 ROE";
    detail = `
      <h4>주요 변수</h4>
      <table class="detail-table">
        <tr><th>변수</th><th>값</th><th>의미 · 출처</th></tr>
        <tr><td>B₀ (주당순자산, BPS)</td><td><b>${fmtPrice(bps0, mk)}</b></td><td>${bpsYear} 기준 — 지금 청산해도 남는 주주 몫</td></tr>
        <tr><td>지속 ROE</td><td><b>${slv("sl-roe")}%</b></td><td>자기자본이익률 가정 · ${roeSrc}</td></tr>
        <tr><td>요구수익률 r</td><td><b>${slv("sl-r")}%</b></td><td>이 주식에 요구하는 최소 수익률(무위험금리+위험프리미엄)</td></tr>
        <tr><td>지속계수 w</td><td><b>${slv("sl-w")}</b></td><td>초과이익이 매년 유지되는 비율 (1=영원, 0.7≈매년 30%씩 소멸)</td></tr>
      </table>
      <h4>단계별 계산 — V = B₀ + B₀×(ROE−r)×w/(1+r−w)</h4>
      <table class="detail-table">
        <tr><th>단계</th><th>계산</th><th>결과</th></tr>
        <tr><td>① 초과수익률 스프레드</td><td>ROE − r = ${slv("sl-roe")}% − ${slv("sl-r")}%</td><td><b>${(bd.spread * 100).toFixed(1)}%p</b></td></tr>
        <tr><td>② 연간 초과이익/주</td><td>B₀ × 스프레드 = ${fmtPrice(bps0, mk)} × ${(bd.spread * 100).toFixed(1)}%</td><td><b>${fmtPrice(bd.ri, mk)}</b></td></tr>
        <tr><td>③ 초과이익의 가치</td><td>② × w/(1+r−w) = ② × ${(slv("sl-w") / (1 + slv("sl-r") / 100 - slv("sl-w"))).toFixed(2)}</td><td><b>${fmtPrice(bd.riValue, mk)}</b></td></tr>
        <tr><td>④ 내재가치</td><td>B₀ + ③</td><td><b>${fmtPrice(bd.v, mk)}</b></td></tr>
      </table>
      <p class="sub-note">읽는 법: ROE가 r보다 높을 때만 순자산(B₀)에 프리미엄이 붙습니다.
      스프레드가 음수면 내재가치 &lt; BPS. w가 낮을수록 "초과이익은 경쟁에 의해 사라진다"는 보수적 가정.</p>`;
    // 민감도: ROE × r
    const roes = [-4, -2, 0, 2, 4].map((d) => slv("sl-roe") + d);
    const rs = [-2, -1, 0, 1, 2].map((d) => slv("sl-r") + d);
    sens = `<tr><th>ROE\\r</th>${rs.map((r) => `<th>${r}%</th>`).join("")}</tr>` +
      roes.map((roe) => `<tr><th>${roe}%</th>${rs.map((r) => {
        const v = rimValue(bps0, roe, r, slv("sl-w"));
        const gap = rec.price ? v / rec.price - 1 : 0;
        return `<td class="heat-cell" style="background:${hmColor(gap * 100 / 10)}">${fmtPrice(v, mk)}</td>`;
      }).join("")}</tr>`).join("");
  } else {
    iv = dcfValue(rec, slv("sl-g1"), slv("sl-r"), slv("sl-g2"));
    const bd = dcfBreakdown(rec, slv("sl-g1"), slv("sl-r"), slv("sl-g2"));
    const fcfHist = rec.fcf.map((v) => fmtB(v)).join(" · ");
    detail = `
      <h4>주요 변수</h4>
      <table class="detail-table">
        <tr><th>변수</th><th>값</th><th>의미 · 출처</th></tr>
        <tr><td>FCF₀ (기준 잉여현금흐름)</td><td><b>${fmtB(bd.fcf0)}</b></td><td>최근 3년 평균 — 개별 연도(최신→과거): ${fcfHist}</td></tr>
        <tr><td>성장률 g₁ (1~5년)</td><td><b>${slv("sl-g1")}%</b></td><td>향후 5년 FCF 성장 가정 (기본=애널리스트 추정, 과열 주의)</td></tr>
        <tr><td>할인율 r (WACC)</td><td><b>${slv("sl-r")}%</b></td><td>미래 현금의 현재가치 환산율 · 베타 ${rec.beta ?? "?"} 반영 기본값</td></tr>
        <tr><td>영구성장률 g₂</td><td><b>${slv("sl-g2")}%</b></td><td>6년차 이후 영원한 성장률 (장기 물가 수준이 상한)</td></tr>
        <tr><td>순부채</td><td><b>${fmtB(bd.netDebt)}</b></td><td>총부채 − 현금 (음수=순현금, 가치에 가산됨)</td></tr>
        <tr><td>주식수</td><td><b>${(bd.shares / 1e9).toFixed(2)}B주</b></td><td>발행주식수 — 주당 가치 환산용</td></tr>
      </table>
      <h4>단계별 계산 — V = Σ FCFₜ/(1+r)ᵗ + 잔존가치 − 순부채</h4>
      <table class="detail-table">
        <tr><th>연차</th><th>예상 FCF = FCF₀×(1+g₁)ᵗ</th><th>할인계수 1/(1+r)ᵗ</th><th>현재가치(PV)</th></tr>
        ${bd.rows.map((row) => `<tr><td>${row.t}년차</td><td>${fmtB(row.fcf)}</td>
          <td>×${row.df.toFixed(3)}</td><td><b>${fmtB(row.pv)}</b></td></tr>`).join("")}
        <tr><td colspan="3">① 5년 현금흐름 현재가치 합</td><td><b>${fmtB(bd.sumPv)}</b></td></tr>
        <tr><td colspan="3">② 잔존가치 TV = FCF₅×(1+g₂)/(r−g₂) = ${fmtB(bd.tv)} → 현재가치</td><td><b>${fmtB(bd.pvTv)}</b></td></tr>
        <tr><td colspan="3">③ 기업가치 EV = ① + ②</td><td><b>${fmtB(bd.ev)}</b></td></tr>
        <tr><td colspan="3">④ 주주가치 = ③ − 순부채(${fmtB(bd.netDebt)})</td><td><b>${fmtB(bd.equity)}</b></td></tr>
        <tr><td colspan="3">⑤ 주당 내재가치 = ④ ÷ 주식수</td><td><b>${fmtPrice(bd.per, "us")}</b></td></tr>
      </table>
      <p class="sub-note">읽는 법: 잔존가치(②)가 전체의 ${(bd.pvTv / bd.ev * 100).toFixed(0)}%를 차지 —
      DCF 값의 대부분이 '6년차 이후' 가정에서 나오므로 g₂·r에 극도로 민감합니다. 민감도 표를 반드시 함께 보세요.</p>`;
    const gs = [-4, -2, 0, 2, 4].map((d) => slv("sl-g1") + d);
    const rs = [-2, -1, 0, 1, 2].map((d) => slv("sl-r") + d);
    sens = `<tr><th>g₁\\r</th>${rs.map((r) => `<th>${r}%</th>`).join("")}</tr>` +
      gs.map((g) => `<tr><th>${g}%</th>${rs.map((r) => {
        const v = dcfValue(rec, g, r, slv("sl-g2"));
        const gap = rec.price ? v / rec.price - 1 : 0;
        return `<td class="heat-cell" style="background:${hmColor(gap * 100 / 10)}">${fmtPrice(v, mk)}</td>`;
      }).join("")}</tr>`).join("");
  }
  const buyBelow = iv * (1 - mos);
  const gap = rec.price ? iv / rec.price - 1 : null;
  const gapColor = gap == null ? "#6b7280" : gap > 0.15 ? "#16a34a" : gap < -0.15 ? "#dc2626" : "#f59e0b";
  $("#val-result").innerHTML = `
    <div class="val-name">${VAL_CUR.name || VAL_CUR.key} <span class="sub-note">현재가 ${fmtPrice(rec.price, mk)} (${rec.price_date})</span></div>
    <div class="val-iv">내재가치 <b>${fmtPrice(iv, mk)}</b></div>
    <div class="val-gap" style="color:${gapColor}">현재가 대비 ${gap == null ? "-" : pct(gap, 1)}
      ${gap != null ? (gap > 0.15 ? "(저평가 영역)" : gap < -0.15 ? "(고평가 영역)" : "(적정 부근)") : ""}</div>
    <div class="val-mos">안전마진 ${(mos * 100).toFixed(0)}% 적용 매수기준: <b>${fmtPrice(buyBelow, mk)}</b> 이하</div>`;
  $("#val-sens").innerHTML = `<div class="fund-head">민감도 (내재가치, 색=현재가 대비)</div>
    <div class="tablewrap"><table class="sens-table">${sens}</table></div>`;
  $("#val-detail").innerHTML = detail;
  $("#val-notes").innerHTML = model === "rim"
    ? `<b>RIM</b>: V = BPS + BPS×(ROE−r)×w/(1+r−w) · BPS 기준 ${mk === "kr" ? "최근 확정연도" : "최근 보고"} ·
       ROE 추정치는 ${mk === "kr" ? "네이버 컨센서스" : "최근 실적"} — <b>과열기 추정치는 과대평가 위험</b>`
    : `<b>DCF</b>: 5년 성장(g₁)+영구성장(g₂), FCF₀=최근 3년 평균(${fmtPrice(rec.fcf.slice(0,3).reduce((s,x)=>s+x,0)/Math.min(3,rec.fcf.length)/1e9, "us")}B),
       순부채 차감 · 성장주는 g₁ 가정에 극도로 민감 — 민감도 표를 함께 볼 것`;
}

function fmtPrice(v, mk) {
  if (v == null || !isFinite(v)) return "-";
  return mk === "kr" ? Math.round(v).toLocaleString() + "원" : "$" + v.toFixed(2);
}

/* ---------- 로드 ---------- */
// 데이터 JSON은 파이프라인 재실행 시 갱신되므로 캐시버스터를 붙여 항상 최신본을 받음
const _cb = "?t=" + Date.now();
const getJSON = (name, required) =>
  fetch("data/" + name + _cb).then((r) => {
    if (!r.ok) { if (required) throw new Error(r.status); return null; }
    return r.json();
  }).catch((e) => { if (required) throw e; return null; });

Promise.all([
  getJSON("results.json", true),
  getJSON("apply2026.json"),
  getJSON("apply_commentary.json"),
  getJSON("regimes.json"),
  getJSON("regime_commentary.json"),
  getJSON("today_signals.json"),
  getJSON("strategy.json"),
  getJSON("market.json"),
  getJSON("news.json"),
  getJSON("market_pro.json"),
  getJSON("fundamentals.json"),
  getJSON("gurus.json"),
  getJSON("valuation.json"),
  getJSON("deals.json"),
  getJSON("news_briefings.json"),
  getJSON("deals_briefings.json"),
  getJSON("news_archive.json"),
  getJSON("deals_archive.json"),
  getJSON("calendar.json"),
])
  .then(([j, a, cm, rg, rcm, td, sm, mk, nw, mp, fd, gu, vl, dl, nb, db, na, da, cal]) => {
    DATA = j; APPLY = a; COMMENT = cm; REGIME = rg; RCOMMENT = rcm; TODAY = td; SIM = sm;
    MARKET = mk; NEWS = nw; MPRO = mp; FUND = fd; GURUS = gu; VAL = vl; DEALS = dl;
    NEWS_BRIEFS = nb; DEALS_BRIEFS = db; NEWS_ARCH = na; DEALS_ARCH = da; CAL = cal;
    SELECTED_RULES = new Set((DATA?.rules || []).filter((r) => r.selected).map((r) => r.rule_id));
    renderHome();  // 첫 화면 = 마켓 홈 (IA 재편)
  })
  .catch((e) => { $("#meta").textContent = "results.json 로드 실패 — 먼저 python analysis\\report.py 실행: " + e; });

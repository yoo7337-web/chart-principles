/* 주식차트분석 대시보드 — results.json 로드 → 원칙 순위표 + 사례 캔들차트 + 2026 적용 */
let DATA = null;
let APPLY = null;
let COMMENT = null;
let REGIME = null;
let RCOMMENT = null;
let TODAY = null;
let SIM = null;
let MARKET = null;
let TOSSM = null;   // toss_market.json — 랭킹·국고채 커브(토스 Open API, 허용IP 필요 → 없을 수 있음)
let NEWS = null;
let MPRO = null;
let FUND = null;
let GURUS = null;
let VAL = null;
let DEALS = null;
let NEWS_BRIEFS = null, DEALS_BRIEFS = null, NEWS_ARCH = null, DEALS_ARCH = null;
let SECNEWS = null;
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
let lookupInds = [];   // 보조지표 패널 차트들(복수)
let lookupCandles = null;       // 메인 캔들 시리즈 (그리기 좌표 변환용)
let _barIdxByTime = null, _barTimeByIdx = null;  // 봉 시간↔논리인덱스 (그리기 좌표 안정화)
let drawMode = "";     // "" | "trend" | "box" | "erase"
let drawColor = "#4391ff";   // 현재 펜 색(새로 그리는 선/박스에 적용)
let drawStyle = "solid";     // solid | dashed | dotted
const DRAW_COLORS = ["#4391ff", "#f5445a", "#22c07a", "#f0b34c", "#9d7bff", "#e7e7ec"];
const DASH = { solid: "", dashed: "7 4", dotted: "2 3.5" };
function hexRGBA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
function drawShapeStyle(color, style, isBox) {
  const dash = DASH[style] || "";
  return `stroke:${color};stroke-dasharray:${dash || "none"};fill:${isBox ? hexRGBA(color, 0.1) : "none"}`;
}
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
let holdingsRendered = false;
let memoRendered = false;
let screenerRendered = false;

const $ = (s) => document.querySelector(s);
const pct = (x, d = 2) => (x == null ? "-" : (x >= 0 ? "+" : "") + (x * 100).toFixed(d) + "%");

function tickerLabel(mk, tk) {
  if (mk === "kr") return (DATA.kr_names?.[tk] || tk) + ` (${tk})`;
  return tk;
}

// 회사 로고 URL — KR=네이버(코드), US=parqet(티커, clearbit 종료 대체). 실패 시 onerror로 숨김.
function logoUrl(mk, tk) {
  return mk === "kr"
    ? `https://ssl.pstatic.net/imgstock/fn/real/logo/stock/Stock${tk}.svg`
    : `https://assets.parqet.com/logos/symbol/${encodeURIComponent(tk)}?format=png`;
}

/* ---------- 중분류(그룹) + 탭 ---------- */
const lastTabOfGroup = { research: "rank", discover: "screener", market: "heatmap", journal: "holdings" };

/* ---------- 소탭(통합 페이지) — nav에는 부모탭만, 자식은 섹션 상단 pill로 전환 ----------
   기존 섹션(id=tab-X)·렌더·딥링크는 그대로 두고 표시만 부모탭으로 묶는다. */
const SUB_PILLS = {   // 부모탭(nav에 남는 쪽) → [자식탭, 라벨][]
  internals: [["internals", "시장 진단"], ["rotation", "섹터 로테이션"]],
  news:      [["news", "뉴스·딜"], ["calendar", "실적발표"], ["econcal", "경제지표"]],
  rank:      [["rank", "원칙"], ["chart", "사례 차트"]],
  holdings:  [["holdings", "보유 현황"], ["portfolio", "포트폴리오 점검"]],
};
const PILL_PARENT = { rotation: "internals", calendar: "news", econcal: "news", chart: "rank", portfolio: "holdings" };
const navIdOf = (tabId) => PILL_PARENT[tabId] || tabId;

function injectSubtabs() {  // 부팅 시 1회 — 자식 섹션마다 동일한 pill 바 주입
  Object.values(SUB_PILLS).forEach((pair) => {
    pair.forEach(([child]) => {
      const sec = document.getElementById("tab-" + child);
      if (!sec || sec.querySelector(".subtab-bar")) return;
      const bar = document.createElement("div");
      bar.className = "subtab-bar";
      bar.innerHTML = pair.map(([id, lab]) =>
        `<button class="subtab${id === child ? " active" : ""}" data-tab="${id}">${lab}</button>`).join("");
      bar.querySelectorAll(".subtab").forEach((b) => b.onclick = () => activateTab(b.dataset.tab));
      sec.prepend(bar);
    });
  });
}

/* ---------- 탭 네비게이션 히스토리 (뒤로 가기) ---------- */
const TAB_KO = { heatmap: "홈", macro: "매크로", internals: "시장 진단", rotation: "섹터 로테이션", news: "뉴스·딜",
  calendar: "실적발표", econcal: "경제지표", gurus: "투자 대가", today: "오늘의 신호", lookup: "종목 조회", screener: "주식찾기", value: "내재가치",
  holdings: "보유 포트폴리오", portfolio: "포트폴리오 점검", journal: "매매일지", memo: "종목 메모",
  rank: "원칙", apply: "실전 검증", chart: "사례 차트" };
let navStack = [];
let navSuppress = false;
let currentTab = "heatmap";

// 그룹 nav·탭바 표시까지 동기화하는 완전 이동 (뒤로가기·해시 복원용)
function gotoTabFull(tabId) {
  const nav = document.querySelector(`.tabs [data-tab="${navIdOf(tabId)}"]`)?.closest(".tabs");
  if (!nav) return;
  const group = nav.dataset.groupTabs;
  document.querySelectorAll(".group").forEach((x) => x.classList.toggle("active", x.dataset.group === group));
  document.querySelectorAll(".tabs").forEach((n) => {
    n.style.display = (n.dataset.groupTabs === group && !n.classList.contains("solo")) ? "" : "none";
  });
  activateTab(tabId);
}

function updateBackBtn() {
  const b = document.getElementById("nav-back");
  if (!b) return;
  const prev = navStack[navStack.length - 1];
  b.style.display = prev ? "" : "none";
  if (prev) b.textContent = `← ${TAB_KO[prev] || prev}(으)로`;
}

window.addEventListener("popstate", () => {
  const t = location.hash.slice(1);
  if (!t || !document.getElementById("tab-" + t)) return;
  navSuppress = true;
  gotoTabFull(t);
  navSuppress = false;
  if (navStack[navStack.length - 1] === t) navStack.pop();  // 브라우저 뒤로 = 스택 소비
  updateBackBtn();
});

function activateTab(tabId) {
  const from = currentTab;
  const navId = navIdOf(tabId);  // 소탭(자식)은 nav에 버튼이 없음 → 부모 버튼 하이라이트
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === navId));
  document.querySelectorAll(".panel").forEach((x) => x.classList.toggle("active", x.id === "tab-" + tabId));
  document.querySelectorAll(".subtab-bar .subtab").forEach((x) => x.classList.toggle("active", x.dataset.tab === tabId));
  const group = document.querySelector(`.tabs [data-tab="${navId}"]`)?.closest(".tabs")?.dataset.groupTabs;
  if (group) lastTabOfGroup[group] = tabId;  // 자식 id 저장 → 그룹 재진입 시 마지막 소탭 복원
  if (tabId === "rank" && !rankRendered) renderRank();
  if (tabId === "chart" && !chart) renderChartTab();
  if (tabId === "apply" && !applyRendered) renderApply();
  if (tabId === "today" && !todayRendered) renderToday();
  if (tabId === "lookup" && !lookupRendered) initLookup();
  if (tabId === "screener" && !screenerRendered) initScreener();
  if (tabId === "value" && !valRendered) initValue();
  if (tabId === "journal" && !journalRendered) initJournal();
  if (tabId === "holdings" && !holdingsRendered) initHoldings();
  if (tabId === "portfolio" && !portfolioRendered) initPortfolio();
  if (tabId === "memo") renderMemo();
  if (tabId === "heatmap") { if (!heatmapRendered) renderHome(); else setTimeout(syncHomeHeights, 0); }  // 재진입 시 우측 높이 재동기화(숨김상태 offsetHeight=0 회피)
  if (tabId === "calendar" && !calRendered) renderCalendar();
  if (tabId === "econcal" && !ecRendered) renderEconCal();
  if (tabId === "news" && !newsRendered) renderNews();
  if (tabId === "macro" && !macroRendered) renderMacroTab();
  if (tabId === "internals" && !internalsRendered) renderInternals();
  if (tabId === "rotation" && !rotationRendered) renderRotation();
  if (tabId === "gurus" && !gurusRendered) renderGurus();
  if (tabId !== from) {
    if (!navSuppress) {
      navStack.push(from);
      if (navStack.length > 20) navStack.shift();
      try { history.pushState({ tab: tabId }, "", "#" + tabId); } catch (e) { /* file:// 등 */ }
    }
    currentTab = tabId;
    updateBackBtn();
  }
}

document.querySelectorAll(".tab").forEach((b) =>
  b.addEventListener("click", () => activateTab(b.dataset.tab)));
injectSubtabs();  // 통합 페이지 소탭 pill 주입(섹션은 정적 HTML이라 즉시 가능)
bindChartDialog();  // 5년 차트 팝업 닫기 — 부팅 시 1회(매크로 탭 렌더에 의존하면 홈에서만 쓸 때 ✕가 죽음)

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
  ? `<path d="M${x},${y} l-5,9 h10 z" fill="#22c07a"/>${_T(x, y + 19, "매수", "#22c07a", "middle", 700)}`
  : `<path d="M${x},${y} l-5,-9 h10 z" fill="#f5445a"/>${_T(x, y - 13, "매도", "#f5445a", "middle", 700)}`;
const _VOLS = (bars) => bars.map(([x, h, big]) =>
  `<rect x="${x - 4}" y="${78 - h}" width="8" height="${h}" fill="${big ? "#f59e0b" : "#cbd5e1"}"/>`).join("");

const MINI = {
  dispLow: (b) => `${_T(6, 14, "주가가 20일선에서 -15% 이상 급락", "#64748b")}
    <path d="M6,30 Q100,32 194,38" stroke="#f39c12" fill="none" stroke-width="2"/>${_T(192, 27, "20일선", "#f39c12", "end")}
    <polyline points="6,30 40,35 75,40 118,58 150,50 194,42" stroke="#64748b" fill="none" stroke-width="2"/>
    <line x1="118" y1="35" x2="118" y2="56" stroke="#22c07a" stroke-dasharray="3 2"/>${_T(124, 48, "-15%↓", "#22c07a", "start", 700)}
    ${_SIG(118, 62, b)}`,
  dispHigh: (b) => `${_T(6, 78, "주가가 20일선에서 +15% 이상 과열", "#64748b")}
    <path d="M6,48 Q100,46 194,42" stroke="#f39c12" fill="none" stroke-width="2"/>${_T(192, 56, "20일선", "#f39c12", "end")}
    <polyline points="6,48 40,42 75,36 118,14 150,22 194,30" stroke="#64748b" fill="none" stroke-width="2"/>
    <line x1="118" y1="16" x2="118" y2="40" stroke="#f5445a" stroke-dasharray="3 2"/>${_T(124, 30, "+15%↑", "#f5445a", "start", 700)}
    ${_SIG(118, 10, b)}`,
  bandLower: (b) => `<path d="M6,16 Q100,13 194,18" stroke="#94a3b8" stroke-dasharray="4 3" fill="none" stroke-width="1.5"/>${_T(8, 12, "볼린저 상단(+2σ)", "#94a3b8")}
    <path d="M6,56 Q100,60 194,52" stroke="#94a3b8" stroke-dasharray="4 3" fill="none" stroke-width="1.5"/>${_T(8, 70, "볼린저 하단(-2σ)", "#94a3b8")}
    <polyline points="6,32 45,40 90,58 135,44 194,28" stroke="#64748b" fill="none" stroke-width="2"/>
    <circle cx="90" cy="58" r="3.5" fill="none" stroke="#22c07a" stroke-width="1.8"/>
    ${_T(100, 62, "종가가 하단 터치", "#22c07a", "start", 700)}${_SIG(90, 64, b)}`,
  bandUpper: (b) => `<path d="M6,16 Q100,13 194,18" stroke="#94a3b8" stroke-dasharray="4 3" fill="none" stroke-width="1.5"/>${_T(8, 12, "볼린저 상단(+2σ)", "#94a3b8")}
    <path d="M6,56 Q100,60 194,52" stroke="#94a3b8" stroke-dasharray="4 3" fill="none" stroke-width="1.5"/>${_T(8, 70, "볼린저 하단(-2σ)", "#94a3b8")}
    <polyline points="6,42 45,34 90,14 135,28 194,44" stroke="#64748b" fill="none" stroke-width="2"/>
    <circle cx="90" cy="14" r="3.5" fill="none" stroke="#f5445a" stroke-width="1.8"/>
    ${_T(100, 14, "종가가 상단 터치", "#f5445a", "start", 700)}${_SIG(90, 8, b)}`,
  rsiLow: (b) => `${_T(8, 14, "RSI(14)", "#4391ff", "start", 700)}
    <line x1="6" y1="52" x2="194" y2="52" stroke="#22c07a" stroke-dasharray="4 3" stroke-width="1.5"/>${_T(192, 48, "RSI 30 (과매도선)", "#22c07a", "end")}
    <polyline points="6,28 45,40 85,60 112,52 150,38 194,24" stroke="#4391ff" fill="none" stroke-width="2"/>
    <circle cx="112" cy="52" r="3.5" fill="none" stroke="#22c07a" stroke-width="1.8"/>
    ${_T(118, 68, "30을 상향 돌파", "#22c07a", "start", 700)}${_SIG(112, 58, b)}`,
  rsiHigh: (b) => `${_T(8, 76, "RSI(14)", "#4391ff", "start", 700)}
    <line x1="6" y1="30" x2="194" y2="30" stroke="#f5445a" stroke-dasharray="4 3" stroke-width="1.5"/>${_T(192, 26, "RSI 70 (과열선)", "#f5445a", "end")}
    <polyline points="6,54 45,42 85,20 112,30 150,44 194,58" stroke="#4391ff" fill="none" stroke-width="2"/>
    <circle cx="112" cy="30" r="3.5" fill="none" stroke="#f5445a" stroke-width="1.8"/>
    ${_T(118, 18, "70을 하향 이탈", "#f5445a", "start", 700)}${_SIG(112, 24, b)}`,
  crossUp: (b) => `<line x1="6" y1="40" x2="194" y2="40" stroke="#9ca3af" stroke-dasharray="4 3"/>${_T(192, 37, "0선", "#9ca3af", "end")}
    <polyline points="6,64 60,58 110,56 194,26" stroke="#4391ff" fill="none" stroke-width="2"/>${_T(8, 60, "MACD", "#4391ff", "start", 700)}
    <polyline points="6,54 60,58 110,58 194,48" stroke="#f59e0b" fill="none" stroke-width="1.8"/>${_T(8, 46, "시그널(9)", "#f59e0b")}
    <circle cx="116" cy="57" r="3.5" fill="none" stroke="#22c07a" stroke-width="1.8"/>
    ${_T(124, 74, "시그널 상향 교차", "#22c07a", "start", 700)}${_SIG(116, 63, b)}`,
  crossDn: (b) => `<line x1="6" y1="44" x2="194" y2="44" stroke="#9ca3af" stroke-dasharray="4 3"/>${_T(192, 56, "0선", "#9ca3af", "end")}
    <polyline points="6,20 60,26 110,28 194,58" stroke="#4391ff" fill="none" stroke-width="2"/>${_T(8, 18, "MACD", "#4391ff", "start", 700)}
    <polyline points="6,30 60,26 110,26 194,36" stroke="#f59e0b" fill="none" stroke-width="1.8"/>${_T(8, 40, "시그널(9)", "#f59e0b")}
    <circle cx="116" cy="27" r="3.5" fill="none" stroke="#f5445a" stroke-width="1.8"/>
    ${_T(124, 16, "시그널 하향 교차", "#f5445a", "start", 700)}${_SIG(116, 21, b)}`,
  maCrossUp: (b) => `<polyline points="6,56 80,48 130,38 194,18" stroke="#f39c12" fill="none" stroke-width="2"/>${_T(192, 14, "단기선", "#f39c12", "end", 700)}
    <polyline points="6,40 100,42 194,40" stroke="#8e44ad" fill="none" stroke-width="2"/>${_T(192, 52, "장기선", "#8e44ad", "end")}
    <circle cx="122" cy="41" r="3.5" fill="none" stroke="#22c07a" stroke-width="1.8"/>
    ${_T(10, 20, "단기선이 장기선을 상향 돌파", "#22c07a", "start", 700)}${_SIG(122, 47, b)}`,
  maCrossDn: (b) => `<polyline points="6,24 80,32 130,42 194,60" stroke="#f39c12" fill="none" stroke-width="2"/>${_T(192, 70, "단기선", "#f39c12", "end", 700)}
    <polyline points="6,40 100,38 194,40" stroke="#8e44ad" fill="none" stroke-width="2"/>${_T(192, 32, "장기선", "#8e44ad", "end")}
    <circle cx="118" cy="39" r="3.5" fill="none" stroke="#f5445a" stroke-width="1.8"/>
    ${_T(10, 66, "단기선이 장기선을 하향 돌파", "#f5445a", "start", 700)}${_SIG(118, 27, b)}`,
  maBreakDn: (b) => `<path d="M6,50 Q90,36 194,34" stroke="#f39c12" fill="none" stroke-width="2"/>${_T(192, 28, "추세선(MA)", "#f39c12", "end")}
    <polyline points="6,30 60,36 100,38 130,52 194,60" stroke="#64748b" fill="none" stroke-width="2"/>
    <circle cx="116" cy="43" r="3.5" fill="none" stroke="#f5445a" stroke-width="1.8"/>
    ${_T(10, 16, "종가가 이동평균선을 하향 돌파", "#f5445a", "start", 700)}${_SIG(116, 32, b)}`,
  maBreakDnVol: (b) => `<path d="M6,42 Q90,30 194,28" stroke="#f39c12" fill="none" stroke-width="2"/>${_T(192, 24, "20일선", "#f39c12", "end")}
    <polyline points="6,24 60,28 100,32 130,46 194,54" stroke="#64748b" fill="none" stroke-width="2"/>
    <circle cx="114" cy="36" r="3.5" fill="none" stroke="#f5445a" stroke-width="1.8"/>
    ${_T(10, 14, "20일선 하향 돌파 + 거래량 2배", "#f5445a", "start", 700)}
    ${_VOLS([[40, 6], [60, 5], [80, 7], [100, 6], [116, 13, 1], [140, 5]])}${_T(126, 76, "거래량 2배↑", "#b45309", "start", 700)}
    ${_SIG(114, 8, b)}`,
  maBounce: (b) => `<path d="M6,58 Q90,46 194,26" stroke="#f39c12" fill="none" stroke-width="2"/>${_T(192, 40, "이동평균(우상향)", "#f39c12", "end")}
    <polyline points="6,40 50,46 90,54 130,42 194,22" stroke="#64748b" fill="none" stroke-width="2"/>
    <circle cx="90" cy="54" r="3.5" fill="none" stroke="#22c07a" stroke-width="1.8"/>
    ${_T(10, 16, "이동평균선 터치 후 양봉 반등", "#22c07a", "start", 700)}${_SIG(90, 60, b)}`,
  bigBullVol: (b) => `${_T(10, 14, "장대양봉 + 거래량 3배", "#f5445a", "start", 700)}
    <g stroke="#94a3b8" stroke-width="1.5"><line x1="40" y1="36" x2="40" y2="52"/><line x1="64" y1="32" x2="64" y2="48"/><line x1="88" y1="34" x2="88" y2="50"/></g>
    <rect x="35" y="40" width="10" height="8" fill="#93c5fd"/><rect x="59" y="36" width="10" height="8" fill="#fecaca"/><rect x="83" y="38" width="10" height="8" fill="#93c5fd"/>
    <line x1="126" y1="12" x2="126" y2="56" stroke="#f5445a" stroke-width="1.5"/><rect x="119" y="16" width="14" height="36" fill="#f5445a"/>
    ${_VOLS([[40, 5], [64, 6], [88, 5], [126, 14, 1]])}${_T(138, 76, "거래량 3배↑", "#b45309", "start", 700)}
    ${_SIG(160, 40, b)}`,
  bigBearVol: (b) => `${_T(10, 78, "장대음봉 + 거래량 3배 (세력 이탈)", "#4391ff", "start", 700)}
    <g stroke="#94a3b8" stroke-width="1.5"><line x1="40" y1="18" x2="40" y2="34"/><line x1="64" y1="14" x2="64" y2="30"/><line x1="88" y1="16" x2="88" y2="32"/></g>
    <rect x="35" y="20" width="10" height="8" fill="#fecaca"/><rect x="59" y="18" width="10" height="8" fill="#93c5fd"/><rect x="83" y="20" width="10" height="8" fill="#fecaca"/>
    <line x1="126" y1="14" x2="126" y2="58" stroke="#4391ff" stroke-width="1.5"/><rect x="119" y="18" width="14" height="36" fill="#4391ff"/>
    ${_VOLS([[40, 5], [64, 6], [88, 5], [126, 14, 1]])}${_T(138, 76, "거래량 3배↑", "#b45309", "start", 700)}
    ${_SIG(126, 8, b)}`,
  divergence: (b) => `<polyline points="6,50 60,34 120,16 194,20" stroke="#64748b" fill="none" stroke-width="2"/>
    ${_T(116, 10, "주가는 52주 신고가", "#64748b", "start", 700)}
    <polyline points="6,38 60,36 120,42 194,58" stroke="#4391ff" fill="none" stroke-width="2"/>
    ${_T(126, 70, "OBV(수급)는 꺾임", "#4391ff", "start", 700)}
    <circle cx="146" cy="48" r="3.5" fill="none" stroke="#f5445a" stroke-width="1.8"/>${_SIG(158, 26, b)}`,
  obvUp: (b) => `<polyline points="6,36 70,34 130,32 194,30" stroke="#64748b" fill="none" stroke-width="2"/>${_T(8, 28, "주가(20일선 위)", "#64748b")}
    <polyline points="6,60 70,54 110,52 194,24" stroke="#4391ff" fill="none" stroke-width="2"/>${_T(8, 74, "OBV가 OBV 20일선 돌파", "#4391ff", "start", 700)}
    ${_SIG(116, 58, b)}`,
  stochHigh: (b) => `${_T(8, 76, "스토캐스틱 K(14,3)", "#4391ff")}
    <line x1="6" y1="24" x2="194" y2="24" stroke="#f5445a" stroke-dasharray="4 3" stroke-width="1.5"/>${_T(192, 20, "80 (과열)", "#f5445a", "end")}
    <polyline points="6,58 60,30 100,16 130,26 194,48" stroke="#4391ff" fill="none" stroke-width="2"/>
    <circle cx="112" cy="19" r="3.5" fill="none" stroke="#f5445a" stroke-width="1.8"/>
    ${_T(126, 12, "80 위에서 하락 반전", "#f5445a", "start", 700)}${_SIG(112, 13, b)}`,
  stochLow: (b) => `${_T(8, 14, "스토캐스틱 K(14,3)", "#4391ff")}
    <line x1="6" y1="56" x2="194" y2="56" stroke="#22c07a" stroke-dasharray="4 3" stroke-width="1.5"/>${_T(192, 70, "20 (과매도)", "#22c07a", "end")}
    <polyline points="6,22 60,48 100,62 130,52 194,32" stroke="#4391ff" fill="none" stroke-width="2"/>
    <circle cx="112" cy="59" r="3.5" fill="none" stroke="#22c07a" stroke-width="1.8"/>
    ${_T(126, 74, "20 아래서 상승 반전", "#22c07a", "start", 700)}${_SIG(112, 65, b)}`,
  newHigh: (b) => `<line x1="6" y1="26" x2="140" y2="26" stroke="#9ca3af" stroke-dasharray="4 3" stroke-width="1.5"/>${_T(8, 20, "기존 52주 최고가", "#9ca3af")}
    <polyline points="6,52 50,30 90,42 130,28 160,14 194,18" stroke="#64748b" fill="none" stroke-width="2"/>
    <circle cx="152" cy="18" r="3.5" fill="none" stroke="#22c07a" stroke-width="1.8"/>
    ${_T(120, 66, "종가가 신고가 경신", "#22c07a", "start", 700)}${_SIG(152, 24, b)}`,
  newLow: (b) => `<line x1="6" y1="52" x2="140" y2="52" stroke="#9ca3af" stroke-dasharray="4 3" stroke-width="1.5"/>${_T(8, 66, "기존 52주 최저가", "#9ca3af")}
    <polyline points="6,26 50,48 90,38 130,50 160,64 194,60" stroke="#64748b" fill="none" stroke-width="2"/>
    <circle cx="152" cy="61" r="3.5" fill="none" stroke="#f5445a" stroke-width="1.8"/>
    ${_T(120, 16, "종가가 신저가 경신", "#f5445a", "start", 700)}${_SIG(152, 55, b)}`,
  boxUp: (b) => `<line x1="6" y1="26" x2="194" y2="26" stroke="#9ca3af" stroke-dasharray="4 3" stroke-width="1.5"/>${_T(8, 20, "60일 박스 상단", "#9ca3af")}
    <polyline points="6,44 40,36 80,46 110,34 145,18 194,14" stroke="#64748b" fill="none" stroke-width="2"/>
    <circle cx="132" cy="26" r="3.5" fill="none" stroke="#22c07a" stroke-width="1.8"/>
    ${_T(60, 68, "박스권 상향 돌파", "#22c07a", "start", 700)}${_SIG(132, 32, b)}`,
  boxUpVol: (b) => `<line x1="6" y1="26" x2="194" y2="26" stroke="#9ca3af" stroke-dasharray="4 3" stroke-width="1.5"/>${_T(8, 20, "60일 박스 상단", "#9ca3af")}
    <polyline points="6,44 40,36 80,46 110,34 145,16 194,12" stroke="#64748b" fill="none" stroke-width="2"/>
    <circle cx="130" cy="26" r="3.5" fill="none" stroke="#22c07a" stroke-width="1.8"/>
    ${_VOLS([[50, 5], [75, 6], [100, 5], [130, 13, 1], [160, 6]])}${_T(140, 76, "거래량 급증", "#b45309", "start", 700)}
    ${_SIG(130, 32, b)}`,
  boxDn: (b) => `<line x1="6" y1="52" x2="194" y2="52" stroke="#9ca3af" stroke-dasharray="4 3" stroke-width="1.5"/>${_T(8, 66, "60일 박스 하단", "#9ca3af")}
    <polyline points="6,34 40,42 80,32 110,44 145,60 194,64" stroke="#64748b" fill="none" stroke-width="2"/>
    <circle cx="132" cy="52" r="3.5" fill="none" stroke="#f5445a" stroke-width="1.8"/>
    ${_T(60, 16, "박스권 하향 이탈", "#f5445a", "start", 700)}${_SIG(132, 46, b)}`,
  gapUp: (b) => `<polyline points="6,54 60,50 100,46" stroke="#64748b" fill="none" stroke-width="2"/>
    <polyline points="112,26 150,22 194,16" stroke="#64748b" fill="none" stroke-width="2"/>
    <line x1="100" y1="46" x2="112" y2="26" stroke="#f5445a" stroke-dasharray="3 2" stroke-width="1.5"/>
    ${_T(118, 42, "시가 갭 +3%↑", "#f5445a", "start", 700)}
    ${_VOLS([[40, 5], [70, 6], [112, 13, 1], [150, 6]])}${_T(124, 76, "거래량 2배↑", "#b45309", "start", 700)}
    ${_SIG(112, 32, b)}`,
  gapDn: (b) => `<polyline points="6,24 60,28 100,32" stroke="#64748b" fill="none" stroke-width="2"/>
    <polyline points="112,52 150,56 194,62" stroke="#64748b" fill="none" stroke-width="2"/>
    <line x1="100" y1="32" x2="112" y2="52" stroke="#4391ff" stroke-dasharray="3 2" stroke-width="1.5"/>
    ${_T(118, 40, "시가 갭 -3%↓", "#4391ff", "start", 700)}${_SIG(112, 46, b)}`,
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
  rsi: '보조지표: <span style="color:#4391ff">RSI(14)</span> + 30/70 기준선',
  macd: '보조지표: <span style="color:#4391ff">MACD(12,26)</span> · <span style="color:#f59e0b">시그널(9)</span> · 히스토그램 + 0선',
  disp: '보조지표: <span style="color:#4391ff">20일선 이격도</span> + -15%/0% 기준선',
  obv: '보조지표: <span style="color:#4391ff">OBV</span> · <span style="color:#f59e0b">OBV 20일선</span>',
  stoch: '보조지표: <span style="color:#4391ff">스토캐스틱 K(14,3)</span> + 20/80 기준선',
};

function chartWidth(el) {
  // 탭이 늦게 표시돼 clientWidth가 0일 때 대비한 폴백
  return el.clientWidth || el.parentElement.clientWidth || document.querySelector("main").clientWidth || 800;
}

function baseChartOpts(el, height) {
  return {
    width: chartWidth(el), height,
    layout: { background: { color: "#1b1b21" }, textColor: "#9a9aa2" },
    grid: { vertLines: { color: "#25252c" }, horzLines: { color: "#25252c" } },
    rightPriceScale: { borderColor: "#33333b", minimumWidth: 72 },
    timeScale: { borderColor: "#33333b" },
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

// 축 라벨 컴팩트 포맷 (OBV 등 큰 수 → 5.0B/999M/4.7K, 작은 수는 소수) — 가격축 폭 억제·가독성
function fmtCompact(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1) + "B";
  if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return a >= 10 ? v.toFixed(0) : v.toFixed(2);
}
const OSC_PRICE_FMT = { type: "custom", formatter: fmtCompact, minMove: 0.01 };

// 오실레이터 패널 (종류 직접 지정 — 원칙 연동·수동 선택 공용). minWidth=메인과 가격축 폭 통일용(선택).
function drawOscKind(el, kind, s, markerDates, minWidth, rightOffset) {
  if (!kind) { el.style.display = "none"; return null; }
  el.style.display = "block";
  el.style.height = "160px";
  const opts = baseChartOpts(el, 160);
  if (minWidth) opts.rightPriceScale = { ...opts.rightPriceScale, minimumWidth: minWidth };
  const c = LightweightCharts.createChart(el, opts);
  c.timeScale().applyOptions({ visible: false, rightOffset: rightOffset || 0 });  // 메인과 동일 미래 여백 → 초기 정렬 유지

  // 워밍업(null) 구간도 whitespace({time})로 채워 메인 차트와 동일 길이·동일 논리인덱스 유지
  // → 줌/스크롤 시 시간축 동기화(logical range)가 어긋나지 않음
  const pts = (key) => s.map((x) => (x[key] != null ? { time: x.t, value: x[key] } : { time: x.t }));
  const addLine = (key, color, width = 2) => {
    const ser = c.addLineSeries({ color, lineWidth: width, priceLineVisible: false, lastValueVisible: false,
      priceFormat: OSC_PRICE_FMT });
    ser.setData(pts(key));
    return ser;
  };
  const hline = (ser, value, color) =>
    ser.createPriceLine({ price: value, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true });

  let main;
  if (kind === "rsi") {
    main = addLine("rsi", "#4391ff");
    hline(main, 30, "#22c07a");
    hline(main, 70, "#f5445a");
  } else if (kind === "macd") {
    const hist = c.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false, priceFormat: OSC_PRICE_FMT });
    hist.setData(s.map((x) => (x.macd != null && x.macds != null
      ? { time: x.t, value: x.macd - x.macds, color: x.macd - x.macds >= 0 ? "#fca5a5" : "#93c5fd" }
      : { time: x.t })));
    addLine("macds", "#f59e0b");
    main = addLine("macd", "#4391ff");
    hline(main, 0, "#9ca3af");
  } else if (kind === "disp") {
    main = addLine("disp", "#4391ff");
    hline(main, -0.15, "#22c07a");
    hline(main, 0, "#9ca3af");
  } else if (kind === "obv") {
    addLine("obvm", "#f59e0b");
    main = addLine("obv", "#4391ff");
  } else if (kind === "stoch") {
    main = addLine("stoch", "#4391ff");
    hline(main, 20, "#22c07a");
    hline(main, 80, "#f5445a");
  }
  main.setMarkers((markerDates || []).map((d) => ({ time: d, position: "inBar", color: "#111827", shape: "circle" })));
  c._syncSeries = main;  // 십자선 동기화용 시리즈 참조
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
     이후 20영업일 실제 수익률 <b style="color:${(ex.fwd20 ?? 0) >= 0 ? "#22c07a" : "#f5445a"}">${pct(ex.fwd20)}</b>
     ${rule.side === "sell" ? "(매도원칙: 하락해야 성공)" : ""}`;

  if (chart) { chart.remove(); chart = null; }
  if (indChart) { indChart.remove(); indChart = null; }
  const el = $("#chart");
  chart = LightweightCharts.createChart(el, baseChartOpts(el, 420));

  const s = ex.series;
  const candles = chart.addCandlestickSeries({
    upColor: "#f5445a", downColor: "#4391ff", borderUpColor: "#f5445a",
    borderDownColor: "#4391ff", wickUpColor: "#f5445a", wickDownColor: "#4391ff",
  }); // 국내 관례: 상승=빨강, 하락=파랑
  candles.setData(s.map((x) => ({ time: x.t, open: x.o, high: x.h, low: x.l, close: x.c })));

  const line = (key, color) => {
    const ser = chart.addLineSeries({ color, lineWidth: key === "ma20" || key === "ma60" ? 2 : 1,
      priceLineVisible: false, lastValueVisible: false });
    ser.setData(s.filter((x) => x[key] != null).map((x) => ({ time: x.t, value: x[key] })));
  };
  line("ma20", "#f39c12");
  line("ma60", "#8e44ad");
  line("bbu", "#6a6a72");
  line("bbd", "#6a6a72");

  const vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "" });
  chart.priceScale("").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  vol.setData(s.map((x) => ({ time: x.t, value: x.v, color: x.c >= x.o ? "#fecaca" : "#bfdbfe" })));

  const isBuy = rule.side === "buy";
  candles.setMarkers([{
    time: ex.date, position: isBuy ? "belowBar" : "aboveBar",
    color: isBuy ? "#22c07a" : "#f5445a", shape: isBuy ? "arrowUp" : "arrowDown",
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
       색: <span class="dot" style="background:#22c07a"></span> 적중 ·
       <span class="dot" style="background:#f5445a"></span> 실패 ·
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
    upColor: "#f5445a", downColor: "#4391ff", borderUpColor: "#f5445a",
    borderDownColor: "#4391ff", wickUpColor: "#f5445a", wickDownColor: "#4391ff",
  });
  candles.setData(s.map((x) => ({ time: x.t, open: x.o, high: x.h, low: x.l, close: x.c })));

  const ma = c.addLineSeries({ color: "#f39c12", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  ma.setData(s.filter((x) => x.ma20 != null).map((x) => ({ time: x.t, value: x.ma20 })));

  const vol = c.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "" });
  c.priceScale("").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
  vol.setData(s.map((x) => ({ time: x.t, value: x.v, color: x.c >= x.o ? "#fecaca" : "#bfdbfe" })));

  // 신호 마커: 방향=화살표, 색=적중(초록)/실패(빨강)/진행중(회색)
  const markers = stock.signals.map((x) => {
    const color = x.done ? (x.success ? "#22c07a" : "#f5445a") : "#9ca3af";
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
      <td class="td-stock"><img class="tbl-logo" src="${logoUrl(s.market, s.ticker)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <a href="#" class="goto-lookup" data-key="${s.market}_${s.ticker}">${s.market === "kr" ? s.name + " (" + s.ticker + ")" : s.ticker}</a></td>
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
  // 표 폭을 삽입 '전'에 측정해 차트를 그 폭에 고정 — 차트가 표를 밀어 넓히는 되먹임 방지
  const fixedW = Math.max(320, tr.closest("table").clientWidth - 24);
  const row = document.createElement("tr");
  row.className = "today-chart-row";
  row.innerHTML = `<td colspan="7"><div class="chart" style="height:300px;width:${fixedW}px;max-width:100%"></div>
    <div class="chart today-ind" style="height:150px;margin-top:6px;display:none;width:${fixedW}px;max-width:100%"></div>
    <p class="legend" style="width:${fixedW}px;max-width:100%"></p></td>`;
  // 범례도 고정폭 필수 — 표 셀은 한 줄 텍스트의 최대폭만큼 늘어나 표 전체를 밀어냄(1,314px 실측)
  tr.after(row);
  fetch(`data/stocks/${sig.market}_${sig.ticker}.json` + _cb)
    .then((r) => (r.ok ? r.json() : null)).then((st) => {
      const el = row.querySelector(".chart");
      if (!st) { el.textContent = "차트 데이터 없음 (stocks JSON 미생성 종목)"; el.style.padding = "20px"; return; }
      if (!st._ta) { taEnrich(st.series); st._ta = true; }
      const s = st.series.slice(-130);
      todayChart = LightweightCharts.createChart(el, baseChartOpts(el, 300));
      const cd = todayChart.addCandlestickSeries({
        upColor: "#f5445a", downColor: "#4391ff", borderUpColor: "#f5445a",
        borderDownColor: "#4391ff", wickUpColor: "#f5445a", wickDownColor: "#4391ff",
      });
      todayChart._syncSeries = cd;   // 십자선 동기화용
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
          const ser = todayChart.addLineSeries({ color: "#6a6a72", lineWidth: 1, lineStyle: 2,
            priceLineVisible: false, lastValueVisible: false });
          ser.setData(s.filter((x) => x[k] != null).map((x) => ({ time: x.t, value: x[k] })));
        };
        dashed("bbu"); dashed("bbd");
      }
      const t0 = s[0].t;
      const marks = st.markers.filter((m) => m.rule_id === sig.rule_id && m.t >= t0);
      // ⚠stocks/*.json의 markers는 주1 재생성이라 '오늘 신호'(scan_today, 매일)가 아직 없을 수 있음.
      // 그 경우 과거 마커(예: 한 달 전)가 최신처럼 보임(2026-07-23 제보) → 신호 자신을 반드시 추가.
      if (!marks.some((m) => m.t === sig.date))
        marks.push({ t: sig.date, side: sig.side, rule_id: sig.rule_id });
      marks.sort((a, b) => (a.t < b.t ? -1 : 1));
      cd.setMarkers(marks.map((m) => ({
        time: m.t, position: m.side === "buy" ? "belowBar" : "aboveBar",
        color: m.t === sig.date ? "#111827" : (m.side === "buy" ? "#22c07a" : "#f5445a"),
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
        if (todayInd) syncCharts([todayChart, todayInd]);   // 종목조회처럼 시간축·십자선 연동(확대·축소 동기)
      }
      row.querySelector(".legend").innerHTML =
        `<b>${sig.rule}</b> 신호 — ★=이번 신호(${sig.date}) · 초록/빨강 화살표=같은 원칙의 최근 6개월 신호 ·
         ─ <span style="color:#f39c12">MA20</span> <span style="color:#8e44ad">MA60</span>${bbRule ? ' · <span style="color:#6a6a72">볼린저밴드(점선)</span>' : ""}${indLegend} ·
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
    if (!st) {  // 유니버스엔 있으나 종목 파일이 아직 없음(주1 갱신 지연) — 안내만
      const h = document.getElementById("lookup-head");
      if (h) { h.style.display = ""; h.innerHTML = `<div class="lk-title"><div class="lk-name">데이터 준비 중 <span class="sub-note">이 종목은 곧 수집 예정입니다</span></div></div>`; }
      const ind = document.getElementById("lookup-industry"); if (ind) ind.style.display = "none";
      return;
    }
    LOOKUP_ST = st;
    ["lookup-info", "lookup-chart", "lookup-legend", "lookup-stats-title", "lookup-stats-wrap",
     "lookup-rule-wrap", "lookup-filter", "lookup-profile", "draw-tools"]
      .forEach((id) => { document.getElementById(id).style.display = ""; });
    $("#lookup-rule-wrap").style.display = "inline";
    $("#lookup-filter").style.display = "flex";
    $("#lookup-q").value = st.market === "kr" ? `${st.name} (${st.ticker})` : st.ticker;
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
        if (lookupTf === "1m") {   // 분봉은 개별 파일 lazy 로드 후 그림
          loadMinuteBars(LOOKUP_ST).then(() => drawLookupChart());
          return;
        }
        drawLookupChart();
      });
      // 보조지표 체크박스 — 복수 선택, 변경 시 재그림
      tfbar.querySelectorAll("#lookup-osc input[type=checkbox]").forEach((cb) => cb.onchange = () => {
        lookupOscs = [...tfbar.querySelectorAll("#lookup-osc input:checked")].map((x) => x.value);
        drawLookupChart();
      });
    }
    // 당일 분봉 버튼 — 수집된 종목만 노출(유동성 상위). 없으면 일봉으로 되돌림.
    loadIntradayIndex().then((idx) => {
      if (LOOKUP_ST !== st) return;
      const has = !!idx?.stocks?.[`${st.market}_${st.ticker}`];
      const btn = document.getElementById("tf-1m");
      if (btn) btn.style.display = has ? "" : "none";
      if (lookupTf !== "1m") return;
      if (has) {           // 분봉 유지 — 새 종목 분봉 로드 후 재그림
        loadMinuteBars(st).then(() => { if (LOOKUP_ST === st) drawLookupChart(); });
      } else {             // 이 종목은 분봉 없음 → 일봉으로 복귀
        lookupTf = "d";
        document.querySelectorAll("#lookup-tf button").forEach((x) => x.classList.toggle("active", x.dataset.tf === "d"));
        drawLookupChart();
      }
    });
    // 심화 데이터(개요·컨센서스·연간실적·공시·뉴스) — lazy 로드 후 렌더
    appendLiveBar(st);   // 헤더의 '차트와 시세 차이' 경고 계산 전에 잠정 당일봉부터 반영
    renderLookupHead(st);
    renderLookupIndustry(st);   // 분류된 산업·밸류체인 배지(클릭 시 주식찾기로 링크)
    renderLookupReportBtn(st);  // 📖 기업 이해 보고서(있는 종목만 버튼 노출)
    renderLookupMicro(st);      // 호가·체결 스냅샷(토스, 랭킹 상위 종목만)
    loadExtras().then(() => {
      if (LOOKUP_ST !== st) return;  // 로드 중 다른 종목으로 이동한 경우
      renderLookupHead(st);
      renderLookupOverview(st);
      renderLookupCons(st);
      renderLookupMetrics(st);
      renderLookupFin(st);
      renderLookupFinQ(st);
      renderLookupStability(st);
      renderLookupSurprise(st);
      renderLookupDividend(st);
      renderLookupPeers(st);
      renderLookupReports(st);
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
    bindDrawTools();            // 그리기 도구(추세선·박스권) 1회 바인딩
    setDrawMode("");            // 종목 전환 시 이동 모드로 초기화(+저장된 그림 재배치)
    renderLookupMemo(st);       // 이 종목 메모 카드

    $("#lookup-stats").innerHTML =
      `<tr><th>원칙</th><th>방향</th><th>구분</th><th>신호수</th><th>승률</th><th>평균 20일 수익</th></tr>` +
      st.stats.map((s) => `<tr>
        <td>${s.name}</td><td>${s.side === "buy" ? "🟢" : "🔴"}</td>
        <td>${s.scope === "general" ? "일반" : s.scope === "bull" ? "급등장" : "하락장"}</td>
        <td>${s.n}</td><td>${(s.win * 100).toFixed(0)}%</td>
        <td class="${s.avg_fwd20 >= 0 ? "pos" : "neg"}">${pct(s.avg_fwd20)}</td>
      </tr>`).join("");
    setTimeout(alignRail, 60);   // 레이아웃 안정 후 우측 레일을 차트 상단에 정렬
  });
}

// 우측 레일(기업개요~) 시작을 왼쪽 차트 박스 상단에 맞춤 — 헤더·컨트롤 높이만큼 아래로 내림
function alignRail() {
  const side = document.querySelector(".lk-side");
  const chartWrap = document.getElementById("lookup-chart-wrap");
  const grid = document.querySelector(".lk-grid");
  if (!side || !chartWrap || !grid) return;
  if (window.innerWidth <= 1100) { side.style.marginTop = ""; return; }   // 1열 스택 구간은 정렬 해제
  const offset = chartWrap.getBoundingClientRect().top - grid.getBoundingClientRect().top;
  side.style.marginTop = Math.max(0, Math.round(offset)) + "px";
}
if (!window._railResizeBound) {   // 리사이즈 시 재정렬(1회 바인딩)
  window._railResizeBound = true;
  window.addEventListener("resize", () => { if (document.querySelector("#tab-lookup.active")) alignRail(); });
}

let lookupTf = "d";   // 1m/일/주/월봉
let lookupOscs = [];   // 수동 선택 오실레이터 배열([] = 원칙 연동)
const TF_KO = { "1m": "당일 분봉", d: "일봉", w: "주봉", m: "월봉" };

// 당일 분봉 (intraday/*.json — yfinance 1m, 유동성 상위만 수집) ─────────────
let INTRADAY = null;  // index.json {generated, date, stocks:{key:봉수}}
function loadIntradayIndex() {
  if (INTRADAY) return Promise.resolve(INTRADAY);
  return fetch("data/intraday/index.json" + _cb)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (INTRADAY = j || { stocks: {} }));
}
// 분봉 rows(["HH:MM",o,h,l,c,v] 배열 포맷) → 차트 시리즈.
// 벽시계 시각을 UTC로 취급해 차트에 현지시간 그대로 표시.
function minuteSeries(rows, dateStr) {
  const [Y, M, D] = (dateStr || "1970-01-01").split("-").map(Number);
  return rows.map((r) => {
    const [hh, mm] = r[0].split(":").map(Number);
    return { t: Date.UTC(Y, M - 1, D, hh, mm) / 1000,
             o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] };
  });
}
function loadMinuteBars(st) {
  const key = `${st.market}_${st.ticker}`;
  if (st._min) return Promise.resolve(st._min);
  return fetch(`data/intraday/${key}.json` + _cb)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (!j?.rows?.length) return null;
      st._min = minuteSeries(j.rows, INTRADAY?.date);
      taEnrich(st._min);   // 분봉 기준 지표(MA·RSI·MACD 등) 재계산
      return st._min;
    });
}
const OSC_KO = { rsi: "RSI(14)", macd: "MACD", stoch: "스토캐스틱", obv: "OBV", disp: "이격도" };

// 시장 현지 시각(요일·날짜·시분) — 미국장은 뉴욕 기준이어야 당일봉 날짜가 맞음(DST 자동)
function marketClock(mk) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: mk === "us" ? "America/New_York" : "Asia/Seoul", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
  }).formatToParts(new Date());
  const g = (t) => parts.find((x) => x.type === t)?.value || "";
  return { day: `${g("year")}-${g("month")}-${g("day")}`, hm: `${g("hour")}:${g("minute")}`, dow: g("weekday") };
}

// 잠정 당일봉 합성 — 차트(stocks/*.json, 다음날 07:40 확정)가 어제 종가에 머무는 문제 해소.
// 30분 시세(quotes)로 시가=전일종가·종가=현재가 봉을 붙임(고저는 미확정 → max/min(o,c)로 근사, 잠정 명시).
// 주말·휴장일(토스 달력)·장 시작 전·이미 오늘 봉 존재 시엔 붙이지 않음.
function appendLiveBar(st) {
  if (st._live) return;
  const q = MARKET?.quotes?.[`${st.market}_${st.ticker}`];
  const s = st.series;
  if (!q || !s?.length || !(q[0] > 0)) return;
  const clk = marketClock(st.market);
  if (clk.dow === "Sat" || clk.dow === "Sun") return;
  if ((TOSSM?.calendar?.[st.market]?.holidays || []).includes(clk.day)) return;
  const openHm = st.market === "us" ? "09:30" : "09:00";
  const closeHm = st.market === "us" ? "16:00" : "15:30";
  const last = s[s.length - 1];
  if (last.t === clk.day) {
    // 오늘 봉이 이미 있음(따라잡기 배치의 장중 스냅샷 등) — 장중이면 종가·고저만 최신 시세로 갱신.
    // 장 마감 후엔 갱신 금지: 애프터마켓 시세(미국)가 확정 종가를 덮으면 안 됨.
    if (clk.hm >= openHm && clk.hm <= closeHm && q[0] !== last.c) {
      last.c = q[0]; last.h = Math.max(last.h, q[0]); last.l = Math.min(last.l, q[0]);
      last.live = true; st._live = true;
    }
    return;
  }
  if (last.t > clk.day) return;
  if (clk.hm < openHm) return;
  const c = q[0], r = q[1];
  const o = r != null && 1 + r !== 0 ? +(c / (1 + r)).toFixed(4) : c;
  st.series = s.concat([{ t: clk.day, o, h: Math.max(o, c), l: Math.min(o, c), c, v: 0, live: true }]);
  st._live = true;
}

function drawLookupChart() {
  const st = LOOKUP_ST;
  appendLiveBar(st);                                    // 잠정 당일봉(있으면) 먼저 — 지표도 포함해 계산
  if (!st._ta) { taEnrich(st.series); st._ta = true; }  // 지표는 클라이언트 계산(OHLCV 슬림 JSON)
  const tf = lookupTf;
  const isMin = tf === "1m" && st._min?.length;   // 당일 분봉 모드(원칙 신호는 일봉 기준이라 미표시)
  const s = isMin ? st._min : resampleBars(st.series, tf);
  const selRule = $("#lookup-rule").value;  // "" = 전체
  $("#lookup-info").innerHTML =
    `<b>${st.market === "kr" ? st.name + " (" + st.ticker + ")" : st.ticker}</b> · `
    + (isMin
      ? `${INTRADAY?.date || ""} 당일 1분봉 · ${INTRADAY?.generated || ""} 수집 · 원칙 신호는 일봉 기준이라 표시되지 않습니다`
      : `기준일 ${st.asof} · ${TF_KO[tf]} · 최근 5년 (좌우로 드래그·스크롤)`
        + (st._live ? ` · <b>오늘 봉=30분 지연 잠정치</b><span class="sub-note">(고저 미확정 · 확정봉은 다음날 07:40)</span>` : "")
        + (selRule ? ` · 선택 원칙 신호만` : ` · 신호 라벨 = 원칙 축약(범례 하단)`));

  if (lookupChart) { lookupChart.remove(); lookupChart = null; }
  (lookupInds || []).forEach((c) => { try { c.remove(); } catch (e) {} });
  lookupInds = [];
  $("#lookup-inds").innerHTML = "";
  const el = $("#lookup-chart");
  // 메인 가격축 라벨 포맷을 고정 → 폭이 줌/데이터와 무관하게 일정 → psW가 항상 유효.
  //  KR=정수+콤마("45,650") / US=소수 2자리("45.65"). (기본 포맷은 "45650.00"처럼 폭이 커져 어긋남)
  const fmtPx = st.market === "us"
    ? (v) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : (v) => Math.round(v).toLocaleString();
  const pxFormat = { type: "custom", formatter: fmtPx, minMove: st.market === "us" ? 0.01 : 1 };
  // 가격축(우측 눈금) 폭 = 최대 라벨 길이 기준(기본포맷 "374500.00" 최악치까지 커버) → 전 패널 동일
  //  minimumWidth로 고정 → 플롯 폭 일치 → 일자 정렬(초기·줌·스크롤 모두 유지).
  const maxAbs = Math.max(1, ...s.map((x) => Math.abs(x.h ?? x.c ?? 0)));
  const worstLen = Math.round(maxAbs).toString().length + 3;  // 정수부 + ".00" (기본포맷 상한)
  const psW = Math.max(60, 16 + Math.max(worstLen, fmtPx(maxAbs).length) * 7.5);
  // 초기 뷰는 오른쪽 공백 없음(rightOffset 0 → 마지막 봉이 우측 끝). 미래에 그림 그리려면 우측으로 스크롤하면
  // 빈 공간이 나타남(fixRightEdge 기본 false). 전 패널 동일 적용해 정렬 유지.
  const rOff = 0;
  const opts = baseChartOpts(el, 420);
  opts.rightPriceScale = { ...opts.rightPriceScale, minimumWidth: psW };
  opts.timeScale = { ...(opts.timeScale || {}), rightOffset: rOff };
  lookupChart = LightweightCharts.createChart(el, opts);
  const candles = lookupChart.addCandlestickSeries({
    upColor: "#f5445a", downColor: "#4391ff", borderUpColor: "#f5445a",
    borderDownColor: "#4391ff", wickUpColor: "#f5445a", wickDownColor: "#4391ff",
    priceFormat: pxFormat,
  });
  candles.setData(s.map((x) => ({ time: x.t, open: x.o, high: x.h, low: x.l, close: x.c })));
  lookupChart._syncSeries = candles;  // 십자선 동기화용
  lookupCandles = candles;            // 그리기 좌표 변환용
  _barIdxByTime = new Map(s.map((x, i) => [x.t, i]));
  _barTimeByIdx = s.map((x) => x.t);

  const line = (key2, color, width, dashed) => {
    const ser = lookupChart.addLineSeries({ color, lineWidth: width || 1,
      lineStyle: dashed ? 2 : 0, priceLineVisible: false, lastValueVisible: false, priceFormat: pxFormat });
    ser.setData(s.filter((x) => x[key2] != null).map((x) => ({ time: x.t, value: x[key2] })));
  };
  line("ma20", "#f39c12", 2);
  line("ma60", "#8e44ad", 2);
  line("ma120", "#0891b2", 2);         // 120일선 추가
  line("bbu", "#6a6a72", 1, true);     // 볼린저 상단(점선)
  line("bbd", "#6a6a72", 1, true);     // 볼린저 하단(점선)

  const vol = lookupChart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "", lastValueVisible: false });
  lookupChart.priceScale("").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
  vol.setData(s.map((x) => ({ time: x.t, value: x.v, color: x.c >= x.o ? "#fecaca" : "#bfdbfe" })));

  // 마커: 축약 라벨로 어떤 원칙인지 항상 식별 + 국면 적용(진한색)/미적용(회색) 구분 + 필터
  const filt = document.querySelector('input[name="sigfilter"]:checked')?.value || "core";
  const shown = (isMin ? [] : st.markers).filter((m) => {   // 분봉엔 일봉 기준 신호 미표시
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
      color: on ? (m.side === "buy" ? "#22c07a" : "#f5445a") : "#9ca3af",
      shape: m.side === "buy" ? "arrowUp" : "arrowDown",
      text: selRule ? m.name.replace(/\(.*\)/, "").slice(0, 8) : (RULE_ABBR[m.rule_id] || ""),
    };
  }).filter(Boolean));

  // 보조지표 패널: 체크박스 복수 선택 우선, 미선택 시 선택 원칙 연동
  let legendExtra = "";
  const indHost = $("#lookup-inds");
  const ruleLinked = !lookupOscs.length && selRule && IND_PANE[selRule] ? IND_PANE[selRule] : null;
  const kinds = lookupOscs.length ? lookupOscs : (ruleLinked ? [ruleLinked] : []);
  kinds.forEach((kind, i) => {
    const pane = document.createElement("div");
    pane.className = "chart vol ind-pane";
    indHost.appendChild(pane);
    const dates = (ruleLinked && i === 0) ? shown.map((m) => snap(m.t)).filter(Boolean) : [];
    const oc = drawOscKind(pane, kind, s, dates, psW, rOff);  // 메인과 동일 가격축 폭·미래 여백
    if (oc) {
      lookupInds.push(oc);
      // 지표명 라벨(패널 좌상단)
      const tag = document.createElement("span");
      tag.className = "ind-tag";
      tag.textContent = OSC_KO[kind] || kind;
      pane.appendChild(tag);
    }
  });
  if (kinds.length) legendExtra = " · 보조지표: " + kinds.map((k) => OSC_KO[k] || k).join(", ")
    + (ruleLinked ? " (●=신호일)" : "");

  const abbrLegend = st.stats.filter((s) => RULE_ABBR[s.rule_id])
    .map((s) => `<b>${RULE_ABBR[s.rule_id]}</b>=${s.name.replace(/\(.*\)/, "")}`).join(" · ");
  $("#lookup-legend").innerHTML =
    `─ <span style="color:#f39c12">MA20</span> · <span style="color:#8e44ad">MA60</span> ·
     <span style="color:#0891b2">MA120</span> · <span style="color:#95a5a6">볼린저밴드(20,2σ 점선)</span> ·
     <span style="color:#22c07a">▲매수</span>/<span style="color:#f5445a">▼매도</span> ·
     <span style="color:#9ca3af">회색=현 국면 미적용 원칙</span>${legendExtra}<br>
     <span class="sub-note">신호 축약: ${abbrLegend}</span>`;

  const cw = chartWidth(el);
  lookupChart.applyOptions({ width: cw });
  lookupInds.forEach((c) => c.applyOptions({ width: cw }));
  // 첫 화면 = 최근 봉(기본 뷰, 좌우 스크롤로 5년 탐색). 전 패널 동일 데이터·배율이라 초기 정렬됨.
  // 메인·지표 패널 시간축·십자선 연동(스크롤/줌·날짜 커서 공유).
  // 메인·지표 패널 시간축·십자선 연동(스크롤/줌·날짜 커서 공유). 가격축 폭은 위에서 동일 고정.
  syncCharts([lookupChart, ...lookupInds]);
  // 그리기 오버레이 재배치 (줌/스크롤에 연동해 추세선·박스가 봉 위치를 따라감)
  lookupChart.timeScale().subscribeVisibleLogicalRangeChange(() => redrawDrawings());
  requestAnimationFrame(() => redrawDrawings());
}

// 여러 lightweight-charts 인스턴스의 시간축·십자선 연동 (좌우 스크롤/줌·날짜 커서 공유)
function syncCharts(charts) {
  if (charts.length < 2) return;
  let guard = false;
  charts.forEach((src) => {
    src.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (guard || !r) return;
      guard = true;
      charts.forEach((c) => { if (c !== src) c.timeScale().setVisibleLogicalRange(r); });
      guard = false;
    });
    src.subscribeCrosshairMove((param) => {
      if (guard) return;
      guard = true;
      charts.forEach((c) => {
        if (c === src) return;
        try {
          if (param.time != null && c._syncSeries) c.setCrosshairPosition(0, param.time, c._syncSeries);
          else c.clearCrosshairPosition();
        } catch (e) {}
      });
      guard = false;
    });
  });
}

/* ---------- 차트 그리기 도구 (추세선·박스권 — localStorage, 종목별) ---------- */
const DRAW_KEY = "cp_draw_v1";
function drawLoad() { try { return JSON.parse(localStorage.getItem(DRAW_KEY)) || {}; } catch (e) { return {}; } }
function drawSaveAll(o) { localStorage.setItem(DRAW_KEY, JSON.stringify(o)); }
function drawKey() { return LOOKUP_ST ? LOOKUP_ST.market + "_" + LOOKUP_ST.ticker : null; }

// 저장 (시간·가격) → 현재 화면 좌표. 시간→논리인덱스→logicalToCoordinate(오프스크린도 연장), 가격→priceToCoordinate.
function redrawDrawings() {
  const svg = document.getElementById("lookup-draw"), el = document.getElementById("lookup-chart");
  if (!svg || !el || !lookupChart || !lookupCandles || !LOOKUP_ST) return;
  const w = el.clientWidth, h = el.clientHeight;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.style.width = w + "px"; svg.style.height = h + "px";
  const ts = lookupChart.timeScale();
  const last = _barTimeByIdx ? _barTimeByIdx.length - 1 : 0;
  // 과거 앵커=시간(t)→논리인덱스, 미래 앵커=fo(마지막 봉 기준 봉 오프셋)→논리 last+fo. 둘 다 오프스크린 연장 지원.
  const X = (t, fo) => {
    let c;
    if (fo != null) c = ts.logicalToCoordinate(last + fo);
    else { const i = _barIdxByTime && _barIdxByTime.get(t); c = i != null ? ts.logicalToCoordinate(i) : ts.timeToCoordinate(t); }
    return c == null ? null : c;
  };
  const Y = (p) => { const c = lookupCandles.priceToCoordinate(p); return c == null ? null : c; };
  const arr = drawLoad()[drawKey()] || [];
  svg.innerHTML = arr.map((d, i) => {
    const x1 = X(d.t1, d.fo1), y1 = Y(d.p1), x2 = X(d.t2, d.fo2), y2 = Y(d.p2);
    if ([x1, y1, x2, y2].some((v) => v == null)) return "";
    const stl = drawShapeStyle(d.color || "#4391ff", d.style || "solid", d.type === "box");
    if (d.type === "trend") return `<line class="dw" data-i="${i}" style="${stl}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    return `<rect class="dw" data-i="${i}" style="${stl}" x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}" width="${Math.abs(x2 - x1)}" height="${Math.abs(y2 - y1)}"/>`;
  }).join("");
  if (drawMode === "erase") svg.querySelectorAll(".dw").forEach((sh) => sh.onclick = () => {
    const o = drawLoad(), k = drawKey();
    if (o[k]) { o[k].splice(+sh.dataset.i, 1); if (!o[k].length) delete o[k]; drawSaveAll(o); redrawDrawings(); }
  });
}

function setDrawMode(m) {
  drawMode = m;
  const svg = document.getElementById("lookup-draw");
  if (svg) svg.style.pointerEvents = m ? "auto" : "none";  // 이동 모드에선 차트로 이벤트 통과
  document.querySelectorAll("#draw-mode button").forEach((b) => b.classList.toggle("active", b.dataset.dm === m));
  const hint = document.getElementById("draw-hint");
  if (hint) hint.textContent = m === "erase" ? "지우고 싶은 선/박스를 클릭하세요"
    : m ? "차트에서 드래그해 그리세요 · 줌/스크롤에 따라 봉에 고정됩니다"
    : "추세선/박스권 선택 후 차트에서 드래그 · 이 브라우저에 저장";
  redrawDrawings();
}

function bindDrawTools() {
  const tools = document.getElementById("draw-tools");
  if (!tools || tools.dataset.bound) return;
  tools.dataset.bound = "1";
  tools.querySelectorAll("#draw-mode button").forEach((b) => b.onclick = () => setDrawMode(b.dataset.dm));
  // 색 스와치
  const cwrap = document.getElementById("draw-color");
  cwrap.innerHTML = DRAW_COLORS.map((c) =>
    `<button class="draw-sw${c === drawColor ? " active" : ""}" data-c="${c}" style="background:${c}" title="${c}"></button>`).join("");
  cwrap.querySelectorAll(".draw-sw").forEach((b) => b.onclick = () => {
    drawColor = b.dataset.c;
    cwrap.querySelectorAll(".draw-sw").forEach((x) => x.classList.toggle("active", x === b));
  });
  // 선모양(실선/파선/점선)
  document.querySelectorAll("#draw-linestyle button").forEach((b) => b.onclick = () => {
    drawStyle = b.dataset.ls;
    document.querySelectorAll("#draw-linestyle button").forEach((x) => x.classList.toggle("active", x === b));
  });
  document.getElementById("draw-clear").onclick = () => {
    if (!confirm("이 종목의 그림을 모두 지울까요?")) return;
    const o = drawLoad(); delete o[drawKey()]; drawSaveAll(o); redrawDrawings();
  };
  const svg = document.getElementById("lookup-draw");
  let start = null;
  const toData = (ev) => {
    const r = svg.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    const ts = lookupChart.timeScale();
    let t = null, fo = null;
    const logical = ts.coordinateToLogical(x);
    if (logical != null && _barTimeByIdx) {
      const last = _barTimeByIdx.length - 1;
      if (logical > last + 0.5) fo = logical - last;   // 마지막 봉 오른쪽(미래 여백) → 봉 오프셋 저장
      else t = _barTimeByIdx[Math.max(0, Math.round(logical))];
    }
    const p = lookupCandles.coordinateToPrice(y);
    return { x, y, t, fo, p };
  };
  svg.addEventListener("pointerdown", (ev) => {
    if (!drawMode || drawMode === "erase" || !lookupCandles) return;
    start = toData(ev);
    try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!start) return;
    const c = toData(ev);
    const prev = svg.querySelector(".dw-preview"); if (prev) prev.remove();
    const stl = drawShapeStyle(drawColor, drawStyle, drawMode === "box");
    const el = drawMode === "trend"
      ? `<line class="dw dw-preview" style="${stl}" x1="${start.x}" y1="${start.y}" x2="${c.x}" y2="${c.y}"/>`
      : `<rect class="dw dw-preview" style="${stl}" x="${Math.min(start.x, c.x)}" y="${Math.min(start.y, c.y)}" width="${Math.abs(c.x - start.x)}" height="${Math.abs(c.y - start.y)}"/>`;
    svg.insertAdjacentHTML("beforeend", el);
  });
  const finish = (ev) => {
    if (!start) return;
    const end = toData(ev);
    const okA = start.t != null || start.fo != null, okB = end.t != null || end.fo != null;
    if (okA && okB && start.p != null && end.p != null && (Math.abs(end.x - start.x) > 3 || Math.abs(end.y - start.y) > 3)) {
      const o = drawLoad(), k = drawKey();
      (o[k] = o[k] || []).push({ type: drawMode, t1: start.t, fo1: start.fo, p1: start.p, t2: end.t, fo2: end.fo, p2: end.p,
        color: drawColor, style: drawStyle });   // 선택한 색·선모양 저장
      drawSaveAll(o);
    }
    start = null;
    redrawDrawings();
  };
  svg.addEventListener("pointerup", finish);
  svg.addEventListener("pointercancel", () => { start = null; redrawDrawings(); });
}

/* ---------- 종목 메모 (localStorage, 종목별 · 복수) ---------- */
const MEMO_KEY = "cp_memo_v1";
// 저장 구조: { "kr_005930": { name, items:[{id,text,created,updated}] } }
function memoLoad() {
  let o; try { o = JSON.parse(localStorage.getItem(MEMO_KEY)) || {}; } catch (e) { return {}; }
  // 구(舊) 단일 메모 { text, name, updated } → 복수 구조로 자동 이관
  let migrated = false;
  Object.keys(o).forEach((k) => {
    const v = o[k];
    if (v && v.text != null && !Array.isArray(v.items)) {
      o[k] = { name: v.name, items: [{ id: "m" + k, text: v.text, created: v.updated || "", updated: v.updated || "" }] };
      migrated = true;
    }
  });
  if (migrated) { try { localStorage.setItem(MEMO_KEY, JSON.stringify(o)); } catch (e) {} }
  return o;
}
function memoSaveAll(o) { localStorage.setItem(MEMO_KEY, JSON.stringify(o)); }
function memoNewId() { return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function memoItems(key) { return (memoLoad()[key] || {}).items || []; }
const memoSortDesc = (a, b) => (b.updated || "").localeCompare(a.updated || "") || (b.id > a.id ? 1 : -1);

function renderLookupMemo(st) {
  const host = document.getElementById("lookup-memo");
  if (!host) return;
  host.style.display = "";
  const key = st.market + "_" + st.ticker;
  const nm = st.market === "kr" ? st.name : st.ticker;
  const items = memoItems(key).slice().sort(memoSortDesc);
  const esc = (t) => t.replace(/</g, "&lt;");
  const list = items.length ? items.map((it) => `
    <div class="lk-memo-item" data-id="${it.id}">
      <div class="lk-memo-itxt">${esc(it.text).replace(/\n/g, "<br>")}</div>
      <div class="lk-memo-meta"><span class="sub-note">${it.updated || ""}${it.updated && it.created && it.updated !== it.created ? " · 수정됨" : ""}</span>
        <span style="flex:1"></span>
        <a href="#" class="lk-memo-edit" data-id="${it.id}">수정</a>
        <a href="#" class="lk-memo-del" data-id="${it.id}" style="color:#b91c1c;margin-left:10px">삭제</a></div>
    </div>`).join("") : `<div class="sub-note" style="padding:2px 0 4px">아직 메모가 없습니다.</div>`;
  host.innerHTML = `<div class="fund-head">🗒️ 이 종목 메모 <span class="sub-note">(${items.length}) · 이 브라우저에만 저장</span></div>
    <div style="padding:0 14px 12px">
      <div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:10px">
        <textarea id="lk-memo-new" rows="2" placeholder="새 메모 입력 후 [추가] (Ctrl+Enter)"
          style="flex:1;box-sizing:border-box;resize:vertical;border:1px solid var(--line);border-radius:8px;padding:9px 11px;font:inherit;font-size:.9rem"></textarea>
        <button class="today-chart-btn" id="lk-memo-add" style="white-space:nowrap">추가</button>
      </div>
      <div id="lk-memo-list">${list}</div>
    </div>`;
  const add = () => {
    const ta = document.getElementById("lk-memo-new");
    if (!ta.value.trim()) return;
    const o = memoLoad(), e = o[key] || { name: nm, items: [] };
    e.name = nm; e.items = e.items || [];
    e.items.push({ id: memoNewId(), text: ta.value, created: pfToday(), updated: pfToday() });
    o[key] = e; memoSaveAll(o); renderLookupMemo(st);
  };
  document.getElementById("lk-memo-add").onclick = add;
  document.getElementById("lk-memo-new").addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") { ev.preventDefault(); add(); }
  });
  host.querySelectorAll(".lk-memo-del").forEach((a) => a.onclick = (ev) => {
    ev.preventDefault();
    if (!confirm("이 메모를 삭제할까요?")) return;
    const o = memoLoad(), e = o[key]; if (!e) return;
    e.items = (e.items || []).filter((x) => x.id !== a.dataset.id);
    if (!e.items.length) delete o[key];
    memoSaveAll(o); renderLookupMemo(st);
  });
  host.querySelectorAll(".lk-memo-edit").forEach((a) => a.onclick = (ev) => {
    ev.preventDefault();
    const wrap = host.querySelector(`.lk-memo-item[data-id="${a.dataset.id}"]`);
    const it = memoItems(key).find((x) => x.id === a.dataset.id); if (!wrap || !it) return;
    wrap.innerHTML = `<textarea class="lk-memo-etext" rows="3" style="width:100%;box-sizing:border-box;resize:vertical;border:1px solid var(--line);border-radius:8px;padding:9px 11px;font:inherit;font-size:.9rem">${esc(it.text)}</textarea>
      <div class="lk-memo-meta"><span style="flex:1"></span>
        <a href="#" class="lk-memo-save">저장</a>
        <a href="#" class="lk-memo-cancel" style="margin-left:10px">취소</a></div>`;
    wrap.querySelector(".lk-memo-cancel").onclick = (e2) => { e2.preventDefault(); renderLookupMemo(st); };
    wrap.querySelector(".lk-memo-save").onclick = (e2) => {
      e2.preventDefault();
      const nt = wrap.querySelector(".lk-memo-etext").value;
      if (!nt.trim()) return;
      const o = memoLoad(), e = o[key]; if (!e) return;
      const tgt = (e.items || []).find((x) => x.id === it.id);
      if (tgt) { tgt.text = nt; tgt.updated = pfToday(); }
      memoSaveAll(o); renderLookupMemo(st);
    };
  });
}

// 내 투자 → 종목 메모 탭 — 모든 메모 모아보기(메모 1건 = 1행)
function renderMemo() {
  memoRendered = true;
  const host = document.getElementById("memo-list");
  const q = (document.getElementById("memo-search")?.value || "").trim().toLowerCase();
  const all = memoLoad();
  let rows = [];
  Object.entries(all).forEach(([k, v]) => (v.items || []).forEach((it) => { if (it && it.text) rows.push({ key: k, name: v.name, it }); }));
  rows.sort((a, b) => memoSortDesc(a.it, b.it));
  if (q) rows = rows.filter((r) => (r.name || r.key).toLowerCase().includes(q) || r.it.text.toLowerCase().includes(q));
  // 검색 바인딩(1회) + 내보내기/가져오기
  const sb = document.getElementById("memo-search");
  if (sb && !sb.dataset.bound) {
    sb.dataset.bound = "1";
    sb.addEventListener("input", () => renderMemo());
    document.getElementById("memo-export").onclick = () => {
      const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), memos: memoLoad() }, null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = `종목메모_${new Date().toISOString().slice(0, 10)}.json`; a.click();
    };
    document.getElementById("memo-import").onclick = () => document.getElementById("memo-import-file").click();
    document.getElementById("memo-import-file").onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      f.text().then((txt) => {
        try {
          const d = JSON.parse(txt), src = d.memos || d;
          const cur = memoLoad(); let n = 0;
          Object.entries(src).forEach(([k, v]) => {
            // 구/신 구조 모두 items 배열로 정규화 후 병합(id 중복 제외)
            const incoming = Array.isArray(v.items) ? v.items
              : (v && v.text ? [{ id: "m" + k, text: v.text, created: v.updated || "", updated: v.updated || "" }] : []);
            if (!incoming.length) return;
            const e = cur[k] || { name: v.name, items: [] };
            e.name = e.name || v.name; e.items = e.items || [];
            const seen = new Set(e.items.map((x) => x.id));
            incoming.forEach((it) => { if (it && it.text && !seen.has(it.id)) { e.items.push(it); n++; } });
            cur[k] = e;
          });
          memoSaveAll(cur); alert(n + "개 메모 가져옴 (기존 유지)"); renderMemo();
        } catch (err) { alert("JSON 형식이 올바르지 않습니다"); }
        e.target.value = "";
      });
    };
  }
  if (!rows.length) {
    host.innerHTML = `<div class="card-flat" style="text-align:center;padding:36px;color:var(--muted)">
      ${q ? "검색 결과가 없습니다." : "아직 메모가 없습니다 — <b>종목 조회</b>에서 종목을 열고 <b>🗒️ 이 종목 메모</b>에 적어보세요."}</div>`;
    return;
  }
  host.innerHTML = rows.map((r) => {
    const k = r.key, mk = k.split("_")[0], tk = k.slice(mk.length + 1);
    const logo = logoUrl(mk, tk);
    return `<div class="card-flat memo-row" data-key="${k}" data-id="${r.it.id}">
      <div class="memo-head"><img class="mv-logo" src="${logo}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <b>${r.name || tk}</b> <span class="sub-note">${tk} · ${r.it.updated || ""}</span>
        <span style="flex:1"></span>
        <a href="#" class="memo-goto" data-key="${k}">종목 조회 →</a>
        <a href="#" class="memo-del" data-key="${k}" data-id="${r.it.id}" style="color:#b91c1c;margin-left:10px">삭제</a></div>
      <div class="memo-body">${r.it.text.replace(/</g, "&lt;").replace(/\n/g, "<br>")}</div>
    </div>`;
  }).join("");
  host.querySelectorAll(".memo-goto").forEach((a) => a.onclick = (e) => {
    e.preventDefault(); gotoTabFull("lookup");
    if (!lookupRendered) initLookup();
    loadLookup(a.dataset.key);
  });
  host.querySelectorAll(".memo-del").forEach((a) => a.onclick = (e) => {
    e.preventDefault();
    if (!confirm("이 메모를 삭제할까요?")) return;
    const o = memoLoad(), ent = o[a.dataset.key]; if (!ent) return;
    ent.items = (ent.items || []).filter((x) => x.id !== a.dataset.id);
    if (!ent.items.length) delete o[a.dataset.key];
    memoSaveAll(o); renderMemo();
  });
}

/* ---------- 주식찾기 (스크리너) — 국가/산업/시가총액 ---------- */
// 데이터 소스: MARKET.heatmap = [{m,t,name,sector,mcap,chg}] (국내+미국 유니버스)
const SCR_FX = 1350;  // '전체' 국가 비교 시 미국 시총 원화 환산(1$≈1,350원) — 대략치
const scrState = { country: "kr", sectors: null, min: null, max: null, sort: "mcap" };  // 국가 필수(전체 제거) — 기본 한국. sectors=null → 업종 전체
const scrMetricSel = {};        // metricId → Set(bucketIdx) — 세부 지표 필터 선택
let scrVals = new Map();         // "m_t" → 지표값 캐시(company.json 로드 후 구축)
let scrValsReady = false;

/* --- 세부 지표 계산 헬퍼 (연도별 재무 시계열 기반) --- */
const _nn = (a) => a.filter((v) => v != null && !isNaN(v));
function scrYoY(a) { const s = _nn(a); if (s.length < 2) return null; const p = s[s.length - 2]; if (!p) return null; return (s[s.length - 1] - p) / Math.abs(p) * 100; }
function scrCagr(a) { const s = _nn(a); if (s.length < 2) return null; const a0 = s[0], b = s[s.length - 1], n = s.length - 1; if (a0 <= 0 || b <= 0) return null; return (Math.pow(b / a0, 1 / n) - 1) * 100; }
function scrStreak(a) { const s = _nn(a); let c = 0; for (let i = s.length - 1; i > 0; i--) { if (s[i] > s[i - 1]) c++; else break; } return c; }
function scrPayStreak(a) { let c = 0; for (let i = a.length - 1; i >= 0; i--) { if (a[i] != null && a[i] > 0) c++; else break; } return c; }
function scrDivGrowStreak(a) { let c = 0; for (let i = a.length - 1; i > 0; i--) { if (a[i] != null && a[i - 1] != null && a[i] > a[i - 1] && a[i] > 0) c++; else break; } return c; }

// 한 종목의 모든 세부 지표값 계산 (없으면 null)
function scrComputeVals(t) {
  const key = t.m + "_" + t.t;
  const f = (FUND && FUND.map && FUND.map[key]) || {};
  const c = (EXTRAS.company && EXTRAS.company.map && EXTRAS.company.map[key]) || {};
  const m = c.metrics || {};
  const num = (x) => (x == null || isNaN(x)) ? null : +x;
  const finA = (c.fin || []).filter((r) => !r.est);        // 실적 연도(추정 제외)
  const fxA = (c.fin_ext || []).filter((r) => !r.est);
  const rev = finA.map((r) => r.rev), op = finA.map((r) => r.op);
  const net = fxA.map((r) => r.net), dpsS = fxA.map((r) => r.dps);
  const epsLatest = fxA.length ? num(fxA[fxA.length - 1].eps) : num(m.eps);
  // PSR: 미국=제공값 / 한국=시총÷최근매출(억원→원)
  let psr = num(m.psr);
  if (psr == null && t.m === "kr") { const rv = rev.length ? rev[rev.length - 1] : null; if (rv > 0 && f.mcap) psr = f.mcap / (rv * 1e8); }
  // 배당성향: 미국=제공값 / 한국=DPS÷EPS
  let payout = num(m.payout);
  if (payout == null && t.m === "kr") { const d = dpsS.length ? dpsS[dpsS.length - 1] : null; if (d > 0 && epsLatest > 0) payout = d / epsLatest * 100; }
  let debt = num(m.debtRatio); if (debt == null && fxA.length) debt = num(fxA[fxA.length - 1].debt);
  const roe = num(m.roe) != null ? num(m.roe) : num(f.roe);
  const roa = (roe != null && debt != null) ? roe / (1 + debt / 100) : null;  // 추정: ROA=ROE÷(1+부채비율/100)
  return {
    per: num(m.per) != null ? num(m.per) : num(f.per),
    pbr: num(m.pbr) != null ? num(m.pbr) : num(f.pbr),
    psr,
    rev_yoy: scrYoY(rev), rev_cagr: scrCagr(rev), rev_streak: scrStreak(rev),
    op_yoy: scrYoY(op), op_streak: scrStreak(op),
    net_yoy: scrYoY(net), net_cagr: scrCagr(net), net_streak: scrStreak(net),
    opm: finA.length && finA[finA.length - 1].opm != null ? num(finA[finA.length - 1].opm) : num(f.op_margin),
    npm: fxA.length ? num(fxA[fxA.length - 1].npm) : null,
    roe, roa, debt,
    curr: num(m.currentRatio),
    intcov: num(m.interestCoverage),
    dyield: num(f.div_yield), payout,
    div_pay: scrPayStreak(dpsS), div_grow: scrDivGrowStreak(dpsS),
    c5: num(t.c5), upstreak: num(t.up),  // 모멘텀(heatmap 제공): 5거래일 수익률·연속 상승일
  };
}
function scrBuildVals() {
  scrVals = new Map();
  ((MARKET && MARKET.heatmap) || []).forEach((t) => scrVals.set(t.m + "_" + t.t, scrComputeVals(t)));
  scrValsReady = true;
}

/* --- 세부 지표 레지스트리 (버킷=구간 필터, 다중선택=OR) --- */
function _b(l, lo, hi) { return { l, lo, hi }; }
const SCR_METRICS = [
  // 기업가치 (배)
  { id: "per", cat: "기업가치", label: "PER", unit: "배", buckets: [_b("적자", null, 0), _b("0~5", 0, 5), _b("5~10", 5, 10), _b("10~15", 10, 15), _b("15~20", 15, 20), _b("20~30", 20, 30), _b("30↑", 30, null)] },
  { id: "pbr", cat: "기업가치", label: "PBR", unit: "배", buckets: [_b("0~0.5", 0, 0.5), _b("0.5~1", 0.5, 1), _b("1~1.5", 1, 1.5), _b("1.5~2", 1.5, 2), _b("2~3", 2, 3), _b("3↑", 3, null)] },
  { id: "psr", cat: "기업가치", label: "PSR", unit: "배", note: "한국은 시총÷최근매출로 계산", buckets: [_b("0~0.5", 0, 0.5), _b("0.5~1", 0.5, 1), _b("1~2", 1, 2), _b("2~3", 2, 3), _b("3~5", 3, 5), _b("5↑", 5, null)] },
  // 성장성 (%)
  { id: "rev_yoy", cat: "성장성", label: "매출 증감률", unit: "%", buckets: [_b("감소", null, 0), _b("0~10", 0, 10), _b("10~20", 10, 20), _b("20~30", 20, 30), _b("30↑", 30, null)] },
  { id: "rev_cagr", cat: "성장성", label: "매출 연평균성장(CAGR)", unit: "%", buckets: [_b("감소", null, 0), _b("0~10", 0, 10), _b("10~20", 10, 20), _b("20~30", 20, 30), _b("30↑", 30, null)] },
  { id: "rev_streak", cat: "성장성", label: "매출 연속증가", unit: "년", buckets: [_b("2년↑", 2, null), _b("3년↑", 3, null), _b("4년↑", 4, null)] },
  { id: "op_yoy", cat: "성장성", label: "영업이익 증감률", unit: "%", buckets: [_b("감소", null, 0), _b("0~10", 0, 10), _b("10~20", 10, 20), _b("20~30", 20, 30), _b("30↑", 30, null)] },
  { id: "op_streak", cat: "성장성", label: "영업이익 연속증가", unit: "년", buckets: [_b("2년↑", 2, null), _b("3년↑", 3, null), _b("4년↑", 4, null)] },
  { id: "net_yoy", cat: "성장성", label: "순이익 증감률", unit: "%", buckets: [_b("감소", null, 0), _b("0~10", 0, 10), _b("10~20", 10, 20), _b("20~30", 20, 30), _b("30↑", 30, null)] },
  { id: "net_cagr", cat: "성장성", label: "순이익 연평균성장(CAGR)", unit: "%", buckets: [_b("감소", null, 0), _b("0~10", 0, 10), _b("10~20", 10, 20), _b("20~30", 20, 30), _b("30↑", 30, null)] },
  { id: "net_streak", cat: "성장성", label: "순이익 연속증가", unit: "년", buckets: [_b("2년↑", 2, null), _b("3년↑", 3, null), _b("4년↑", 4, null)] },
  // 수익성 (%)
  { id: "opm", cat: "수익성", label: "영업이익률", unit: "%", buckets: [_b("적자", null, 0), _b("0~5", 0, 5), _b("5~10", 5, 10), _b("10~20", 10, 20), _b("20↑", 20, null)] },
  { id: "npm", cat: "수익성", label: "순이익률", unit: "%", buckets: [_b("적자", null, 0), _b("0~5", 0, 5), _b("5~10", 5, 10), _b("10~20", 10, 20), _b("20↑", 20, null)] },
  { id: "roe", cat: "수익성", label: "ROE", unit: "%", buckets: [_b("적자", null, 0), _b("0~5", 0, 5), _b("5~10", 5, 10), _b("10~15", 10, 15), _b("15~20", 15, 20), _b("20↑", 20, null)] },
  { id: "roa", cat: "수익성", label: "ROA", unit: "%", note: "ROE·부채비율로 추정", buckets: [_b("적자", null, 0), _b("0~3", 0, 3), _b("3~6", 3, 6), _b("6~10", 6, 10), _b("10↑", 10, null)] },
  // 재무건전성
  { id: "debt", cat: "재무건전성", label: "부채비율", unit: "%", buckets: [_b("0~50", 0, 50), _b("50~100", 50, 100), _b("100~200", 100, 200), _b("200↑", 200, null)] },
  { id: "curr", cat: "재무건전성", label: "유동비율", unit: "%", note: "주로 미국(국내는 당좌비율만 제공)", buckets: [_b("100미만", null, 100), _b("100~150", 100, 150), _b("150~200", 150, 200), _b("200↑", 200, null)] },
  { id: "intcov", cat: "재무건전성", label: "이자보상배율", unit: "배", note: "미국만 제공", buckets: [_b("1미만", null, 1), _b("1~3", 1, 3), _b("3~5", 3, 5), _b("5↑", 5, null)] },
  // 배당
  { id: "dyield", cat: "배당", label: "배당수익률", unit: "%", buckets: [_b("0~1", 0, 1), _b("1~2", 1, 2), _b("2~3", 2, 3), _b("3~5", 3, 5), _b("5↑", 5, null)] },
  { id: "payout", cat: "배당", label: "배당성향", unit: "%", note: "한국은 DPS÷EPS로 계산", buckets: [_b("0~20", 0, 20), _b("20~40", 20, 40), _b("40~60", 40, 60), _b("60~100", 60, 100), _b("100↑", 100, null)] },
  { id: "div_pay", cat: "배당", label: "배당 연속지급", unit: "년", note: "국내만(최근 수년 데이터 한정)", buckets: [_b("3년↑", 3, null), _b("5년↑", 5, null)] },
  { id: "div_grow", cat: "배당", label: "배당 연속증가", unit: "년", note: "국내만(최근 수년 데이터 한정)", buckets: [_b("2년↑", 2, null), _b("3년↑", 3, null)] },
];
const SCR_METRIC_BY_ID = Object.fromEntries(SCR_METRICS.map((m) => [m.id, m]));
const SCR_CATS = ["기업가치", "성장성", "수익성", "재무건전성", "배당"];
// 구현 불가 항목(원인) — UI에 안내
const SCR_UNAVAIL = [
  ["PFCR", "잉여현금흐름(FCF) 미수집 — 현금흐름표 수집 필요"],
  ["EV/EBITDA", "EBITDA(감가상각 전 이익) 미수집 — EV는 있으나 EBITDA 산출 데이터 없음"],
  ["매출총이익률·매출총이익 증감/연속", "매출원가·매출총이익 미수집(영업이익까지만 제공)"],
  ["ROA(실측)", "총자산 미수집 → ROE·부채비율 기반 '추정 ROA'로 대체 구현"],
  ["영업이익·순이익 어닝 서프라이즈", "컨센서스 실적 추정치 미수집(목표주가·투자의견만 보유)"],
  ["주당배당금(절대액)", "원/달러 통화가 달라 절대액 구간필터 부적합 → 배당수익률·배당성향으로 대체"],
  ["배당주기(분기/반기/연)", "배당 지급일 이력 미수집"],
];
function scrBucketMatch(b, v) { return (b.lo == null || v >= b.lo) && (b.hi == null || v < b.hi); }

/* --- 테마(원클릭 프리셋) — 지표 조건 조합(정확값). cond: {m, min(≥), max(<), gt(>)} --- */
const SCR_THEMES = [
  { id: "momentum", name: "🚀 연속상승세", desc: "1주일 전보다 상승 + 3일 연속 상승",
    conds: [{ m: "c5", gt: 0 }, { m: "upstreak", min: 3 }] },
  { id: "growth_value", name: "🌱 저평가 성장주", desc: "매출·순이익 3년평균 성장 + PER 0~20배",
    conds: [{ m: "rev_cagr", min: 10 }, { m: "per", min: 0, max: 20 }, { m: "net_cagr", min: 20 }] },
  { id: "cheap_value", name: "💎 저렴한 가치주", desc: "PBR 0~1.5 + PER 0~15 + 순이익 성장 0%↑",
    conds: [{ m: "pbr", min: 0, max: 1.5 }, { m: "per", min: 0, max: 15 }, { m: "net_cagr", min: 0 }] },
  { id: "dividend", name: "💰 배당주", desc: "배당성향 30%↑ + 3년+ 연속지급 + 순이익 최근 3개년 우상향 (실적 데이터 3개년 기준)",
    conds: [{ m: "payout", min: 30 }, { m: "div_pay", min: 3 }, { m: "net_streak", min: 2 }] },
  { id: "cashcow", name: "🏆 돈 잘버는 회사", desc: "영업이익률 20%↑ + ROE 15%↑ (매출총이익률 미수집→영업이익률 대체)",
    conds: [{ m: "opm", min: 20 }, { m: "roe", min: 15 }] },
  { id: "turnaround", name: "🔄 실적 턴어라운드", desc: "순이익 흑자 + 순이익 증감률 30%↑ (적자탈출·급반등)",
    conds: [{ m: "npm", gt: 0 }, { m: "net_yoy", min: 30 }] },
  { id: "quality", name: "🏰 재무 우량주", desc: "부채비율 50% 미만 + ROE 10%↑ + 영업이익 흑자",
    conds: [{ m: "debt", max: 50 }, { m: "roe", min: 10 }, { m: "opm", gt: 0 }] },
  { id: "highdiv", name: "💵 고배당 안정주", desc: "배당수익률 4%↑ + 부채비율 100% 미만 + 순이익 흑자",
    conds: [{ m: "dyield", min: 4 }, { m: "debt", max: 100 }, { m: "npm", gt: 0 }] },
  { id: "earnmom", name: "📈 이익 모멘텀 성장주", desc: "매출 증감률 15%↑ + 영업이익 증감률 15%↑ (외형·수익 동반성장)",
    conds: [{ m: "rev_yoy", min: 15 }, { m: "op_yoy", min: 15 }] },
  { id: "deepvalue", name: "🩸 초저평가 자산주", desc: "PBR 1배 미만 + PER 10배 미만 + 순이익 흑자",
    conds: [{ m: "pbr", min: 0, max: 1 }, { m: "per", min: 0, max: 10 }, { m: "npm", gt: 0 }] },
  { id: "rebound", name: "⚡ 낙폭과대 반등후보", desc: "1주간 하락(주간수익률<0) + 최근 2일+ 상승 전환",
    conds: [{ m: "c5", max: 0 }, { m: "upstreak", min: 2 }] },
  { id: "intcov_us", name: "🛡️ 이자보상 우량주(미국)", desc: "이자보상배율 5배↑ + ROE 15%↑ (이자보상배율은 미국 종목만 제공)",
    conds: [{ m: "intcov", min: 5 }, { m: "roe", min: 15 }] },
];
let scrThemeActive = null;
function scrCondMatch(c, v) {
  if (v == null) return false;
  return (c.min == null || v >= c.min) && (c.max == null || v < c.max) && (c.gt == null || v > c.gt);
}
function scrThemePass(vals) {
  const th = SCR_THEMES.find((x) => x.id === scrThemeActive);
  if (!th) return true;
  return th.conds.every((c) => scrCondMatch(c, vals[c.m]));
}

function scrUnit() { return scrState.country === "us" ? "$B" : "조원"; }  // 시총 입력 단위
function scrMcapVal(t) {  // 현재 단위(조원 or $B)로 변환한 시총값
  if (scrState.country === "us") return t.mcap / 1e9;                    // $B
  return (t.m === "us" ? t.mcap * SCR_FX : t.mcap) / 1e12;              // 조원(미국주 환산)
}
function scrTiers() {  // 국가별 시총 티어(현재 단위 하한/상한)
  return scrState.country === "us"
    ? [{ k: "대형주", min: 10 }, { k: "중형주", min: 2, max: 10 }, { k: "소형주", max: 2 }]     // $B
    : [{ k: "대형주", min: 2 }, { k: "중형주", min: 0.3, max: 2 }, { k: "소형주", max: 0.3 }];  // 조원
}
function scrPool() {
  const all = (MARKET && MARKET.heatmap) || [];
  return all.filter((t) => t.mcap > 0 && (!scrState.country || t.m === scrState.country));
}
function scrSectorsFor(country) {
  const cnt = {};
  ((MARKET && MARKET.heatmap) || []).filter((t) => t.mcap > 0 && (!country || t.m === country))
    .forEach((t) => cnt[t.sector] = (cnt[t.sector] || 0) + 1);
  return Object.entries(cnt).sort((a, b) => b[1] - a[1]);  // [name, n] 내림차순
}

function initScreener() {
  if (!MARKET || !MARKET.heatmap) return;  // 데이터 로딩 전 — 다음 진입 시 재시도
  screenerRendered = true;
  $("#scr-context").innerHTML = `<b>주식찾기</b> — 시장(한국/미국)을 고른 뒤 <b>산업·시가총액 + 세부 지표</b>(기업가치·성장성·수익성·재무건전성·배당)로 종목을 걸러냅니다. 지표 여러 개 = AND, 한 지표의 구간 여러 개 = OR.`;
  // 국가 토글
  document.querySelectorAll("#scr-country button").forEach((b) => b.onclick = () => {
    document.querySelectorAll("#scr-country button").forEach((x) => x.classList.toggle("active", x === b));
    scrState.country = b.dataset.c;
    scrState.sectors = null; scrState.min = scrState.max = null; scrOpenGroup = null;
    $("#scr-mcap-min").value = ""; $("#scr-mcap-max").value = "";
    buildScrSectors(); buildScrTiers(); setScrUnitLabel(); scrSyncFilterVisibility();
    renderScreener();
  });
  // 시총 직접 입력
  const onMcap = () => {
    scrState.min = $("#scr-mcap-min").value === "" ? null : parseFloat($("#scr-mcap-min").value);
    scrState.max = $("#scr-mcap-max").value === "" ? null : parseFloat($("#scr-mcap-max").value);
    document.querySelectorAll("#scr-tiers .scr-tier").forEach((x) => x.classList.remove("active"));
    renderScreener();
  };
  $("#scr-mcap-min").addEventListener("input", onMcap);
  $("#scr-mcap-max").addEventListener("input", onMcap);
  // 산업 초기화(전체)
  $("#scr-sec-reset").onclick = () => { scrState.sectors = null; scrOpenGroup = null; buildScrSectors(); renderScreener(); };
  // 정렬
  $("#scr-sort").onchange = () => { scrState.sort = $("#scr-sort").value; renderScreener(); };
  // 세부 지표·테마 초기화
  const rb = $("#scr-reset");
  if (rb) rb.onclick = () => { Object.keys(scrMetricSel).forEach((k) => delete scrMetricSel[k]);
    scrThemeActive = null;
    document.querySelectorAll("#scr-metrics .scr-bk.active").forEach((x) => x.classList.remove("active"));
    renderScrThemes(); renderScreener(); };

  const cc = $("#scr-chain-clear");
  if (cc) cc.onclick = () => { scrChainSel.clear(); renderScrChain(); renderScreener(); };
  setScrUnitLabel(); buildScrSectors(); buildScrTiers(); scrSyncFilterVisibility(); renderScrChain(); renderScrThemes(); renderScrMetrics(); renderScreener();
  // 세부 지표는 company.json(연도별 재무) 로드 후 활성화
  loadExtras().then(() => { scrBuildVals(); const n = $("#scr-detail-note"); if (n) n.style.display = "none"; renderScreener(); });
}

function setScrUnitLabel() {
  $("#scr-mcap-unit").textContent = scrState.country === "us" ? "$B(십억달러)" : "조원";
}

// 산업 대분류(아이콘 그룹) — 세부 업종(네이버/GICS)을 큰 산업으로 묶어 직관적 선택
const SCR_GROUPS = [
  { key: "it", icon: "🔌", name: "반도체·IT·전자", sectors: ["반도체와반도체장비", "전자장비와기기", "전자제품", "디스플레이패널", "디스플레이장비및부품", "IT서비스", "소프트웨어", "통신장비", "핸드셋", "기술"] },
  { key: "auto", icon: "🚗", name: "자동차", sectors: ["자동차", "자동차부품"] },
  { key: "bio", icon: "💊", name: "바이오·헬스", sectors: ["제약", "생물공학", "건강관리장비와용품", "생명과학도구및서비스", "헬스케어"] },
  { key: "fin", icon: "🏦", name: "금융·부동산", sectors: ["은행", "증권", "손해보험", "생명보험", "창업투자", "금융", "부동산"] },
  { key: "ind", icon: "🏭", name: "산업재·기계", sectors: ["기계", "조선", "우주항공과국방", "건설", "건축자재", "상업서비스와공급품", "복합기업", "전기장비", "산업재"] },
  { key: "cons", icon: "🛒", name: "소비재·유통", sectors: ["백화점과일반상점", "식품", "화장품", "섬유,의류,신발,호화품", "담배", "인터넷과카탈로그소매", "무역회사와판매업체", "호텔,레스토랑,레저", "가정용기기와용품", "전기제품", "임의소비재", "필수소비재"] },
  { key: "mat", icon: "⚗️", name: "소재·화학", sectors: ["화학", "철강", "비철금속", "소재"] },
  { key: "energy", icon: "⛽", name: "에너지·유틸리티", sectors: ["석유와가스", "에너지장비및서비스", "전기유틸리티", "에너지", "유틸리티"] },
  { key: "media", icon: "📱", name: "미디어·통신·게임", sectors: ["방송과엔터테인먼트", "게임엔터테인먼트", "무선통신서비스", "다각화된통신서비스", "양방향미디어와서비스", "광고", "커뮤니케이션"] },
  { key: "transport", icon: "🚢", name: "운송·물류", sectors: ["해운사", "항공사", "항공화물운송과물류", "운송인프라"] },
];
const SCR_GROUP_ETC = { key: "etc", icon: "🏢", name: "기타" };
function scrGroupOf(sec) { for (const g of SCR_GROUPS) if (g.sectors.includes(sec)) return g.key; return "etc"; }
let scrOpenGroup = null;  // 펼쳐진 그룹(아코디언)

// 산업별 밸류체인(시범) — company.json 사업개요 기반 수작업 큐레이션. codes=국내 종목코드. flow=공정흐름(화살표) 여부.
const CHAINS = {
  semi: { name: "반도체", icon: "🔌", flow: true, stages: [
    // 흐름: 설계 → 소재 → 장비 → 제조(파운드리) → 후공정 → 기판·패키징 (상류→하류)
    { key: "design", icon: "🎨", name: "설계 (팹리스)", desc: "반도체 설계·디자인하우스", codes: ["399720", "200710", "080220"] },
    { key: "fe_mat", icon: "🧪", name: "전공정 소재·부품", desc: "포토레지스트·특수가스·석영·마스크", codes: ["005290", "357780", "014680", "093370", "064760", "183300", "074600", "059090", "166090", "170920", "101490"] },
    { key: "fe_equip", icon: "⚙️", name: "전공정 장비", desc: "증착·식각·세정 등 Fab 장비", codes: ["036930", "240810", "403870", "095610", "089970", "084370", "319660", "281820", "039030", "144960", "160980", "417840", "122640", "083450", "045100", "030530"] },
    { key: "foundry", icon: "🏭", name: "종합·파운드리", desc: "IDM·위탁생산(메모리/파운드리)", codes: ["005930", "000660", "000990"] },
    { key: "be_equip", icon: "🔬", name: "후공정 장비·소재", desc: "테스트·본딩·검사 장비/소재", codes: ["042700", "058470", "095340", "089030", "131290", "003160", "025560", "232140", "252990", "064290", "420770", "089890", "033160", "077360", "098460", "327260"] },
    { key: "osat", icon: "📦", name: "후공정 OSAT·테스트", desc: "외주 패키징·테스트(OSAT)", codes: ["067310", "036540", "131970", "330860"] },
    { key: "substrate", icon: "🔲", name: "기판·패키징", desc: "PCB·Substrate·리드프레임", codes: ["009150", "011070", "353200", "007660", "195870", "222800", "007810", "356860", "323280"] },
    { key: "semi_etc", icon: "🧩", name: "기타 반도체·장비", desc: "위 단계 외 반도체·장비 업종 전체", sectors: ["반도체와반도체장비"] },
    { key: "disp_parts", icon: "🖥️", name: "디스플레이 장비·부품", desc: "디스플레이 장비·부품", sectors: ["디스플레이장비및부품"] },
  ] },
  battery: { name: "2차전지", icon: "🔋", flow: true, stages: [
    // 흐름: 광물 → 양극·음극재 → 소재 → 장비 → 셀(완제)
    { key: "mineral", icon: "⛏️", name: "소재·광물(모기업)", desc: "리튬·니켈·화학 모기업", codes: ["005490", "051910"] },
    { key: "cathode", icon: "⚡", name: "양극·음극재", desc: "양극재·음극재", codes: ["247540", "066970", "003670", "086520"] },
    { key: "bmat", icon: "🧱", name: "소재(전해질·분리막·동박)", desc: "전해액·분리막·동박·첨가제", codes: ["011790", "020150", "357780", "093370", "014680", "457190"] },
    { key: "bequip", icon: "🛠️", name: "장비·부품", desc: "케이스·검사 등", codes: ["178320", "064290"] },
    { key: "cell", icon: "🔋", name: "셀·배터리", desc: "배터리 셀 제조사", codes: ["373220", "006400", "096770", "082920"] },
  ] },
  auto: { name: "자동차", icon: "🚗", flow: true, stages: [
    // 흐름: 부품·모듈 → 타이어 → 완성차
    { key: "parts", icon: "⚙️", name: "부품·모듈", desc: "모듈·공조·제동·구동", codes: ["012330", "018880", "005850", "204320", "011210", "007340", "010690"] },
    { key: "parts_etc", icon: "🔧", name: "기타 자동차부품", desc: "위 단계 외 자동차부품 업종 전체", sectors: ["자동차부품"] },
    { key: "tire", icon: "🛞", name: "타이어", desc: "타이어", codes: ["161390", "073240"] },
    { key: "oem", icon: "🚗", name: "완성차", desc: "완성차 제조", codes: ["005380", "000270"] },
    { key: "oem_etc", icon: "🚙", name: "기타 완성차·차량", desc: "위 단계 외 자동차 업종 전체", sectors: ["자동차"] },
  ] },
  bio: { name: "바이오·헬스", icon: "💊", flow: true, stages: [
    // 흐름: 신약 연구(바이오) → 원료·위탁생산(CDMO) → 제약(완제·판매) → 의료기기 → 진단
    { key: "biotech", icon: "🧬", name: "바이오·신약", desc: "신약개발·바이오", codes: ["068270", "326030", "196170", "141080", "087010", "226950", "028300", "298380", "950160", "310210", "397030", "039200", "007390"] },
    { key: "bio_etc", icon: "🧬", name: "기타 바이오", desc: "생물공학·생명과학도구", sectors: ["생물공학", "생명과학도구및서비스"] },
    { key: "cdmo", icon: "🏭", name: "CDMO·원료", desc: "위탁생산·원료의약품", codes: ["207940", "237690"] },
    { key: "pharma", icon: "💊", name: "제약", desc: "전통 제약사", codes: ["000100", "128940", "000250", "086450", "009420"] },
    { key: "pharma_etc", icon: "💊", name: "기타 제약", desc: "위 단계 외 제약 업종 전체", sectors: ["제약"] },
    { key: "device", icon: "💉", name: "의료기기·미용", desc: "의료기기·미용", codes: ["214450", "290650", "145020", "214150", "041830"] },
    { key: "device_etc", icon: "🩺", name: "기타 의료기기·서비스", desc: "건강관리 장비·서비스·기술", sectors: ["건강관리장비와용품", "건강관리업체및서비스", "건강관리기술"] },
    { key: "dx", icon: "🔬", name: "진단", desc: "체외진단", codes: ["096530"] },
  ] },
  display: { name: "디스플레이", icon: "🖥️", flow: true, stages: [
    // 흐름: 소재·장비 → 부품·모듈 → 패널(완제)
    { key: "dmat", icon: "🧪", name: "소재·장비", desc: "소재·제조장비", codes: ["005290", "170920", "101490", "036930"] },
    { key: "dmod", icon: "🔩", name: "부품·모듈", desc: "FPCB·BLU 등", codes: ["090460", "290550", "004710"] },
    { key: "panel", icon: "🖥️", name: "패널", desc: "디스플레이 패널", codes: ["034220"] },
    { key: "panel_etc", icon: "📺", name: "기타 패널", desc: "위 단계 외 디스플레이패널 업종 전체", sectors: ["디스플레이패널"] },
  ] },
  defense: { name: "방산·우주항공", icon: "🛡️", flow: true, stages: [
    // 흐름: 부품·소재 → 체계(완제)
    { key: "dparts", icon: "🔩", name: "부품·소재", desc: "탄약·구동·복합소재", codes: ["103140", "011210", "017960"] },
    { key: "system", icon: "🛡️", name: "방산·우주 체계", desc: "무기체계·발사체·완제", codes: ["012450", "064350", "079550", "272210", "047810", "000880"] },
    { key: "defense_etc", icon: "✈️", name: "기타 우주항공·방산", desc: "위 단계 외 우주항공과국방 업종 전체", sectors: ["우주항공과국방"] },
  ] },
  ship: { name: "조선·해운", icon: "🚢", flow: true, stages: [
    // 흐름: 엔진·기자재 → 조선사(건조) → 해운(운항)
    { key: "sequip", icon: "⚙️", name: "엔진·기자재", desc: "선박엔진·기자재", codes: ["082740", "071970", "017960", "100090"] },
    { key: "yard", icon: "🚢", name: "조선사", desc: "조선·해양플랜트", codes: ["329180", "042660", "009540", "010140", "267250", "097230"] },
    { key: "shipping", icon: "🚚", name: "해운", desc: "해운선사", codes: ["011200", "028670", "003280"] },
    { key: "ship_etc", icon: "⚓", name: "기타 조선·해운", desc: "위 단계 외 조선·해운사 업종 전체", sectors: ["조선", "해운사"] },
  ] },
  chem: { name: "화학·소재", icon: "⚗️", flow: true, stages: [
    { key: "petro", icon: "🛢️", name: "석유화학", desc: "기초 석유화학", codes: ["051910", "011780", "011170", "298000", "120110", "005950"] },
    { key: "fine", icon: "🧪", name: "정밀·특수화학", desc: "정밀·특수화학", codes: ["014680", "093370", "010060", "457190", "011790"] },
    { key: "steel", icon: "🏗️", name: "철강", desc: "철강", codes: ["005490", "004020", "001430", "058430"] },
    { key: "nonferrous", icon: "⛏️", name: "비철금속", desc: "비철·제련", codes: ["010130", "103140"] },
    { key: "chem_etc", icon: "⚗️", name: "기타 화학", desc: "위 단계 외 화학 업종 전체", sectors: ["화학"] },
    { key: "metal_etc", icon: "🪙", name: "기타 철강·비철", desc: "철강·비철금속", sectors: ["철강", "비철금속"] },
    { key: "packaging", icon: "📦", name: "포장재·제지", desc: "포장재·종이/목재", sectors: ["포장재", "종이와목재"] },
  ] },
  construction: { name: "건설·건자재", icon: "🏗️", flow: true, stages: [
    // 흐름: 건자재 → 건설(시공) → 부동산(운영)
    { key: "cmat", icon: "🧱", name: "건자재·시멘트", desc: "건축자재·시멘트", codes: ["002380", "023410", "038500"] },
    { key: "cmat_etc", icon: "🧱", name: "기타 건축자재", desc: "위 단계 외 건축자재 업종 전체", sectors: ["건축자재"] },
    { key: "build", icon: "🏗️", name: "건설", desc: "종합건설·플랜트", codes: ["028260", "000720", "028050", "047040", "006360", "375500", "002990"] },
    { key: "build_etc", icon: "🏢", name: "기타 건설", desc: "위 단계 외 건설 업종 전체", sectors: ["건설"] },
    { key: "realestate", icon: "🏘️", name: "부동산·리츠", desc: "부동산·리츠", sectors: ["부동산"] },
  ] },
  internet: { name: "인터넷·게임·엔터", icon: "📱", flow: false, stages: [
    { key: "platform", icon: "🌐", name: "인터넷 플랫폼", desc: "포털·플랫폼", codes: ["035420", "035720"] },
    { key: "game", icon: "🎮", name: "게임", desc: "게임 개발·퍼블리싱", codes: ["259960", "036570", "251270", "263750", "293490"] },
    { key: "ent", icon: "🎤", name: "엔터·콘텐츠", desc: "엔터테인먼트", codes: ["352820", "035900", "041510"] },
    { key: "telecom", icon: "📡", name: "통신", desc: "통신사", codes: ["017670", "030200", "032640"] },
    { key: "adcomm", icon: "📢", name: "광고·커머스", desc: "광고·이커머스", codes: ["030000", "257720"] },
    { key: "itsvc", icon: "💻", name: "IT서비스·소프트웨어", desc: "IT서비스·소프트웨어", sectors: ["IT서비스", "소프트웨어"] },
    { key: "telecom_eq", icon: "📶", name: "통신장비·핸드셋", desc: "통신장비·핸드셋", sectors: ["통신장비", "핸드셋"] },
    { key: "media_etc", icon: "🎬", name: "기타 미디어·게임", desc: "방송·게임·광고·양방향미디어", sectors: ["방송과엔터테인먼트", "게임엔터테인먼트", "광고", "양방향미디어와서비스", "인터넷과카탈로그소매", "무선통신서비스", "다각화된통신서비스"] },
  ] },
  finance: { name: "금융", icon: "🏦", flow: false, stages: [
    { key: "bank", icon: "🏦", name: "은행·지주", desc: "은행 금융지주", codes: ["105560", "055550", "086790", "316140", "024110", "323410", "138930", "175330", "139130", "006220"] },
    { key: "sec", icon: "📈", name: "증권", desc: "증권사", codes: ["006800", "071050", "005940", "016360", "039490", "138040", "001510"] },
    { key: "insure", icon: "🛡️", name: "보험", desc: "생명·손해보험", codes: ["032830", "000810", "005830", "088350", "001450", "085620"] },
    { key: "vc", icon: "💰", name: "벤처·캐피탈", desc: "벤처캐피탈", codes: ["100790", "027360"] },
    { key: "sec_etc", icon: "📊", name: "기타 증권", desc: "위 단계 외 증권 업종 전체", sectors: ["증권"] },
    { key: "insure_etc", icon: "☂️", name: "기타 보험", desc: "손해·생명보험", sectors: ["손해보험", "생명보험"] },
    { key: "fin_etc", icon: "💳", name: "카드·기타금융", desc: "카드·창업투자·기타금융·은행", sectors: ["카드", "기타금융", "창업투자", "은행"] },
  ] },
  consumer: { name: "소비재·유통", icon: "🛒", flow: false, stages: [
    { key: "food", icon: "🍜", name: "식음료·담배", desc: "식품·음료·담배", codes: ["003230", "271560", "097950", "004370", "033780", "003380"] },
    { key: "cosmetic", icon: "💄", name: "화장품·생활", desc: "화장품·생활용품", codes: ["090430", "051900", "161890", "192820", "241710", "439090", "021240"] },
    { key: "retail", icon: "🛍️", name: "유통·리테일", desc: "백화점·마트·편의점", codes: ["004170", "023530", "069960", "139480", "282330", "047050"] },
    { key: "fashion", icon: "👕", name: "패션·레저", desc: "의류·호텔·레저", codes: ["111770", "081660", "035250", "034230", "032350", "008770"] },
    { key: "food_etc", icon: "🍚", name: "기타 식음료", desc: "식품·음료·담배·식품소매", sectors: ["식품", "음료", "담배", "식품과기본식료품소매"] },
    { key: "cosmetic_etc", icon: "🧴", name: "기타 화장품·생활", desc: "화장품·가정용기기·가구", sectors: ["화장품", "가정용기기와용품", "가구"] },
    { key: "fashion_etc", icon: "👗", name: "기타 패션·레저", desc: "섬유의류·호텔레저·레저장비", sectors: ["섬유,의류,신발,호화품", "호텔,레스토랑,레저", "레저용장비와제품"] },
    { key: "retail_etc", icon: "🏬", name: "기타 유통·서비스", desc: "백화점·무역·판매업체·교육", sectors: ["백화점과일반상점", "무역회사와판매업체", "판매업체", "교육서비스"] },
  ] },
  // 아래 2개 산업 + 각 산업 '그 외'로 국내 전 종목 100% 커버. stages는 sectors(네이버 업종)로 동적 산출 가능.
  energy: { name: "에너지·유틸리티", icon: "⛽", flow: false, stages: [
    { key: "oil", icon: "🛢️", name: "정유·석유", sectors: ["석유와가스"] },
    { key: "eequip", icon: "⚙️", name: "에너지 장비·서비스", sectors: ["에너지장비및서비스"] },
    { key: "util", icon: "💡", name: "전력·가스 유틸리티", sectors: ["전기유틸리티", "가스유틸리티", "복합유틸리티"] },
  ] },
  machinery: { name: "산업재·기계·운송", icon: "🏭", flow: false, stages: [
    { key: "machine", icon: "⚙️", name: "기계·중공업", sectors: ["기계"] },
    { key: "elec", icon: "🔌", name: "전기장비·전자부품", sectors: ["전기장비", "전기제품", "전자장비와기기", "전자제품", "사무용전자제품"] },
    { key: "indsvc", icon: "🏢", name: "복합·산업서비스", sectors: ["복합기업", "상업서비스와공급품"] },
    { key: "transport", icon: "🚚", name: "운송·항공", sectors: ["항공사", "항공화물운송과물류", "운송인프라", "도로와철도운송"] },
  ] },
};
const CHAIN_ORDER = ["semi", "battery", "auto", "bio", "display", "defense", "ship", "chem", "energy", "machinery", "construction", "internet", "finance", "consumer"];
// 네이버 업종 → 밸류체인 산업(그 외 단계 산출용 파티션). 국내 전 업종 배정.
const CHAIN_SECTORS = {
  "반도체와반도체장비": "semi", "디스플레이장비및부품": "semi",
  "디스플레이패널": "display",
  "자동차": "auto", "자동차부품": "auto",
  "제약": "bio", "생물공학": "bio", "건강관리장비와용품": "bio", "생명과학도구및서비스": "bio",
  "조선": "ship", "해운사": "ship",
  "우주항공과국방": "defense",
  "화학": "chem", "철강": "chem", "비철금속": "chem",
  "건설": "construction", "건축자재": "construction",
  "방송과엔터테인먼트": "internet", "게임엔터테인먼트": "internet", "무선통신서비스": "internet", "다각화된통신서비스": "internet",
  "양방향미디어와서비스": "internet", "광고": "internet", "IT서비스": "internet", "소프트웨어": "internet", "통신장비": "internet", "핸드셋": "internet", "인터넷과카탈로그소매": "internet",
  "은행": "finance", "증권": "finance", "손해보험": "finance", "생명보험": "finance", "창업투자": "finance",
  "백화점과일반상점": "consumer", "식품": "consumer", "화장품": "consumer", "섬유,의류,신발,호화품": "consumer", "담배": "consumer", "무역회사와판매업체": "consumer", "호텔,레스토랑,레저": "consumer", "가정용기기와용품": "consumer",
  "석유와가스": "energy", "에너지장비및서비스": "energy", "전기유틸리티": "energy", "가스유틸리티": "energy", "복합유틸리티": "energy",
  "기계": "machinery", "전기장비": "machinery", "전기제품": "machinery", "전자장비와기기": "machinery", "전자제품": "machinery", "사무용전자제품": "machinery", "복합기업": "machinery", "상업서비스와공급품": "machinery", "항공사": "machinery", "항공화물운송과물류": "machinery", "운송인프라": "machinery", "도로와철도운송": "machinery",
  // 종목조회(heatmap 밖) 추가 업종 — 매핑 완결용
  "부동산": "construction", "포장재": "chem", "종이와목재": "chem",
  "음료": "consumer", "가구": "consumer", "식품과기본식료품소매": "consumer", "판매업체": "consumer", "레저용장비와제품": "consumer", "교육서비스": "consumer",
  "건강관리업체및서비스": "bio", "건강관리기술": "bio",
  "카드": "finance", "기타금융": "finance",
};
// 단계 codes 산출: codes(직접) 또는 sectors(네이버 업종 동적)
function scrStageCodes(st) {
  if (st.codes) return st.codes;
  if (st.sectors) return ((MARKET && MARKET.heatmap) || []).filter((t) => t.m === "kr" && st.sectors.includes(t.sector)).map((t) => t.t);
  return [];
}
// 산업 내 '그 외' = 해당 산업 업종인데 어느 단계에도 없는 국내 종목
function scrIndustryEtc(indKey) {
  const used = new Set();
  CHAINS[indKey].stages.forEach((st) => scrStageCodes(st).forEach((c) => used.add(c)));
  return ((MARKET && MARKET.heatmap) || []).filter((t) => t.m === "kr" && CHAIN_SECTORS[t.sector] === indKey && !used.has(t.t)).map((t) => t.t);
}
// 산업의 전체 단계(큐레이션 + '그 외'), 각 단계에 _codes 부여
function scrChainAllStages(indKey) {
  const base = CHAINS[indKey].stages.map((st) => ({ ...st, _codes: scrStageCodes(st) }));
  const etc = scrIndustryEtc(indKey);
  if (etc.length) base.push({ key: "_etc", icon: "📁", name: "그 외", desc: "해당 산업 내 기타", _codes: etc });
  return base;
}
// 종목 → 산업/밸류체인 링크 (종목조회 표시용, 티커+업종 기반 · heatmap 비의존)
function stockChainLinks(mk, tk, sector) {
  if (mk !== "kr" || !sector) return [];
  const res = [], seen = new Set();
  CHAIN_ORDER.forEach((ind) => {
    CHAINS[ind].stages.forEach((st) => {
      const inCodes = st.codes && st.codes.includes(tk);
      const inSectors = st.sectors && st.sectors.includes(sector) && CHAIN_SECTORS[sector] === ind;
      if (inCodes || inSectors) {
        const k = ind + "/" + st.key;
        if (!seen.has(k)) { seen.add(k); res.push({ ind, indName: CHAINS[ind].name, indIcon: CHAINS[ind].icon, stageKey: st.key, stage: st.name, stageIcon: st.icon }); }
      }
    });
  });
  if (!res.length) {
    const ind = CHAIN_SECTORS[sector];
    if (ind) res.push({ ind, indName: CHAINS[ind].name, indIcon: CHAINS[ind].icon, stageKey: "_etc", stage: "그 외", stageIcon: "📁" });
  }
  return res;
}
// 미국 GICS 영문 업종 → 한글(종목파일 profile은 영문, heatmap은 한글)
const US_SECTOR_KO = { "Technology": "기술", "Communication Services": "커뮤니케이션", "Consumer Cyclical": "임의소비재",
  "Consumer Defensive": "필수소비재", "Financial Services": "금융", "Healthcare": "헬스케어", "Industrials": "산업재",
  "Energy": "에너지", "Utilities": "유틸리티", "Real Estate": "부동산", "Basic Materials": "소재" };
// 미국 GICS 업종 → 대분류 그룹
function stockGroupLink(sector) {
  if (!sector) return null;
  const gk = scrGroupOf(sector);
  const g = [...SCR_GROUPS, SCR_GROUP_ETC].find((x) => x.key === gk);
  return g ? { key: gk, name: g.name, icon: g.icon } : null;
}
// 종목조회 → 주식찾기 밸류체인으로 이동(국내)
function scrOpenFromChain(ind, stageKey) {
  gotoTabFull("screener");
  if (!screenerRendered) initScreener();
  scrState.country = "kr";
  document.querySelectorAll("#scr-country button").forEach((x) => x.classList.toggle("active", x.dataset.c === "kr"));
  scrState.sectors = null; scrState.min = scrState.max = null; scrOpenGroup = null;
  buildScrSectors(); buildScrTiers(); setScrUnitLabel(); scrSyncFilterVisibility();
  scrChainIndustry = ind; scrChainSel.clear();
  if (stageKey) scrChainSel.add(stageKey);
  renderScrChain(); renderScreener();
}
// 종목조회 → 주식찾기 미국 업종필터로 이동
function scrOpenFromGroupUS(gk, sector) {
  gotoTabFull("screener");
  if (!screenerRendered) initScreener();
  scrState.country = "us";
  document.querySelectorAll("#scr-country button").forEach((x) => x.classList.toggle("active", x.dataset.c === "us"));
  scrState.sectors = sector ? new Set([sector]) : null; scrOpenGroup = gk;
  scrChainIndustry = null; scrChainSel.clear();
  buildScrSectors(); buildScrTiers(); setScrUnitLabel(); scrSyncFilterVisibility();
  renderScrChain(); renderScreener();
}
/* ---------- 호가·체결 스냅샷 (토스 orderbook/trades — 랭킹 상위 종목만, 배치 시점 명시) ---------- */
function renderLookupMicro(st) {
  const host = $("#lookup-micro");
  if (!host) return;
  const mi = TOSSM?.micro?.[`${st.market}_${st.ticker}`];
  if (!mi || (!mi.asks?.length && !mi.trades?.length)) { host.style.display = "none"; host.innerHTML = ""; return; }
  host.style.display = "";
  const fmtP = (v) => fmtPrice(v, st.market);
  let obHtml = "";
  if (mi.asks?.length && mi.bids?.length) {
    const maxV = Math.max(...mi.asks.map((x) => x[1]), ...mi.bids.map((x) => x[1])) || 1;
    const row = (p, v, side) => `<div class="ob-row ${side}">
      <span class="ob-bar" style="width:${Math.max(3, v / maxV * 100)}%"></span>
      <span class="ob-p">${fmtP(p)}</span><span class="ob-v">${v.toLocaleString()}</span></div>`;
    obHtml = `<div class="ob-col"><div class="ob-h">매도 호가</div>${[...mi.asks].reverse().map((x) => row(x[0], x[1], "ask")).join("")}</div>
      <div class="ob-col"><div class="ob-h">매수 호가</div>${mi.bids.map((x) => row(x[0], x[1], "bid")).join("")}</div>`;
  }
  let trHtml = "";
  if (mi.trades?.length) {
    let prev = null;
    trHtml = `<div class="tr-col"><div class="ob-h">최근 체결</div>` + mi.trades.map((t) => {
      const cls = prev == null ? "" : t[1] > prev ? "kup" : t[1] < prev ? "kdn" : "";
      prev = t[1];
      return `<div class="tr-row"><span class="sub-note">${t[0]}</span><span class="${cls}">${fmtP(t[1])}</span><span class="ob-v">${t[2].toLocaleString()}</span></div>`;
    }).join("") + `</div>`;
  }
  host.innerHTML = `<h2>호가·체결 스냅샷 <span class="sub-note">(토스증권 · ${TOSSM.generated} 수집${mi.at ? ` · 호가 ${mi.at} 기준` : ""} — 실시간 아님, 거래대금 상위 종목만)</span></h2>
    <div class="micro-wrap card-flat">${obHtml}${trHtml}</div>`;
}

/* ---------- 📖 기업 이해 보고서 (감사관점×투자관점, 분기 갱신) ---------- */
// 저장: data/reports/{mk}_{ticker}.json — {name, tier, date(기준일), next_due, version, md, changelog}
// 심층(deep)은 Claude 세션에서 DART·웹 검증 후 작성, 골격(auto)은 추후 report_gen.py(분기 클라우드).
let REPORTS_IDX = null;
function loadReportsIdx() {
  if (REPORTS_IDX) return Promise.resolve(REPORTS_IDX);
  return fetch("data/reports/index.json" + _cb).then((r) => (r.ok ? r.json() : null))
    .then((j) => (REPORTS_IDX = j || { reports: {} }));
}
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

function renderLookupReportBtn(st) {
  const host = $("#lookup-report");
  if (!host) return;
  host.style.display = "none";
  host.innerHTML = "";
  loadReportsIdx().then((idx) => {
    const key = `${st.market}_${st.ticker}`;
    const meta = idx.reports?.[key];
    if (!meta || LOOKUP_ST !== st) return;   // 종목 전환 경쟁 방지
    const stale = meta.next_due && kstDay() > meta.next_due;
    host.style.display = "";
    host.innerHTML = `<button class="rep-btn" id="rep-open">📖 기업 이해 보고서</button>
      <span class="sub-note">기준일 ${meta.date} · ${meta.tier === "deep" ? "심층(감사×투자 14장)" : "자동 골격"} · 분기 갱신</span>
      ${stale ? `<span class="lk-stale">⚠ 갱신 필요(분기 경과)</span>` : ""}`;
    $("#rep-open").onclick = () => openReport(key);
  });
}

function openReport(key) {
  fetch(`data/reports/${key}.json` + _cb).then((r) => (r.ok ? r.json() : null)).then((rep) => {
    if (!rep) return;
    let ov = document.getElementById("report-overlay");
    if (!ov) { ov = document.createElement("div"); ov.id = "report-overlay"; document.body.appendChild(ov); }
    const close = () => { ov.style.display = "none"; document.body.style.overflow = ""; };
    ov.innerHTML = `<div class="rep-doc">
      <div class="rep-head"><b>📖 ${rep.name}</b>
        <span class="sub-note">기준일 ${rep.date} · v${rep.version} · 다음 갱신 예정 ${rep.next_due || "-"}</span>
        <span style="flex:1"></span><button class="jr-x" id="rep-close">✕</button></div>
      <div class="rep-body">${mdToHtml(rep.md)}</div></div>`;
    ov.style.display = "block";
    document.body.style.overflow = "hidden";
    document.getElementById("rep-close").onclick = close;
    ov.onclick = (e) => { if (e.target === ov) close(); };
  });
}

// 최소 마크다운 렌더러 — 보고서에 필요한 부분집합만(제목·굵게·표·목록·인용·수평선·코드).
// 외부 라이브러리 없이 유지(오프라인·보안). XSS 방지 위해 전부 이스케이프 후 인라인만 되살림.
function mdToHtml(md) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s) => s
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[DART 확인 필요\]|\[[^\]]*확인 필요[^\]]*\]/g, (m) => `<span class="rep-todo">${m}</span>`)
    .replace(/✅ 확인/g, `<span class="rep-ok">✅ 확인</span>`);
  const lines = md.split("\n");
  let html = "", i = 0, listOpen = false, quoteOpen = false;
  const closeAll = () => {
    if (listOpen) { html += "</ul>"; listOpen = false; }
    if (quoteOpen) { html += "</blockquote>"; quoteOpen = false; }
  };
  while (i < lines.length) {
    const l = lines[i].trimEnd();
    if (l.startsWith("|") && lines[i + 1] && /^\|[\s:|-]+\|?$/.test(lines[i + 1].trim())) {  // 표
      closeAll();
      const cells = (s) => s.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(esc(c.trim())));
      const heads = cells(l);
      i += 2;
      let rows = "";
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++)
        rows += "<tr>" + cells(lines[i]).map((c) => `<td>${c}</td>`).join("") + "</tr>";
      html += `<div class="rep-twrap"><table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) { closeAll(); const n = Math.min(h[1].length + 1, 5); html += `<h${n}>${inline(esc(h[2]))}</h${n}>`; i++; continue; }
    if (/^-{3,}$/.test(l)) { closeAll(); html += "<hr>"; i++; continue; }
    if (l.startsWith("> ")) {
      if (!quoteOpen) { closeAll(); html += "<blockquote>"; quoteOpen = true; }
      html += inline(esc(l.slice(2))) + " ";
      i++; continue;
    }
    if (/^[-*]\s+/.test(l)) {
      if (!listOpen) { closeAll(); html += "<ul>"; listOpen = true; }
      html += `<li>${inline(esc(l.replace(/^[-*]\s+/, "")))}</li>`;
      i++; continue;
    }
    if (!l.trim()) { closeAll(); i++; continue; }
    closeAll();
    html += `<p>${inline(esc(l))}</p>`;
    i++;
  }
  closeAll();
  return html;
}

function renderLookupIndustry(st) {
  const host = $("#lookup-industry"); if (!host) return;
  const tileSec = MARKET?.heatmap?.find((t) => t.m === st.market && t.t === st.ticker)?.sector;
  if (st.market === "kr") {
    const sector = st.profile?.sector || tileSec || null;
    const links = stockChainLinks("kr", st.ticker, sector);
    if (!links.length) { host.style.display = "none"; return; }
    host.style.display = "";
    host.innerHTML = `<span class="lk-ind-label">🏭 산업·밸류체인</span>` + links.map((l) =>
      `<button class="lk-ind-badge" data-ind="${l.ind}" data-stage="${l.stageKey}">${l.indIcon} ${l.indName}<span class="lk-ind-arrow">›</span>${l.stageIcon} ${l.stage}</button>`).join("");
    host.querySelectorAll(".lk-ind-badge").forEach((b) => b.onclick = () => scrOpenFromChain(b.dataset.ind, b.dataset.stage));
  } else {
    let sector = tileSec || US_SECTOR_KO[st.profile?.sector] || st.profile?.sector || null;  // 한글 업종 우선
    const g = stockGroupLink(sector);
    if (!g) { host.style.display = "none"; return; }
    host.style.display = "";
    host.innerHTML = `<span class="lk-ind-label">🏭 업종</span><button class="lk-ind-badge" data-us="${g.key}">${g.icon} ${g.name}${sector ? ` <span class="sub-note">(${sector})</span>` : ""}</button>`;
    host.querySelector(".lk-ind-badge").onclick = () => scrOpenFromGroupUS(g.key, sector);
  }
}
let scrChainIndustry = null;    // 선택된 산업 key
const scrChainSel = new Set();  // 선택된 단계 key (현 산업 내)
function scrChainKeys() {
  const s = new Set();
  if (!scrChainIndustry) return s;
  scrChainAllStages(scrChainIndustry).forEach((st) => { if (scrChainSel.has(st.key)) st._codes.forEach((c) => s.add("kr_" + c)); });
  return s;
}
function renderScrChain() {
  const indHost = $("#scr-chain-inds"), flowHost = $("#scr-chain-flow");
  if (!indHost || !flowHost) return;
  const uni = new Set(((MARKET && MARKET.heatmap) || []).map((t) => t.m + "_" + t.t));
  // 산업 선택 칩
  indHost.innerHTML = CHAIN_ORDER.map((k) => {
    const c = CHAINS[k];
    return `<button class="scr-cind ${scrChainIndustry === k ? "on" : ""}" data-ind="${k}"><span>${c.icon}</span>${c.name}</button>`;
  }).join("");
  indHost.querySelectorAll(".scr-cind").forEach((b) => b.onclick = () => {
    const k = b.dataset.ind;
    scrChainSel.clear();
    scrChainIndustry = (scrChainIndustry === k) ? null : k;
    renderScrChain(); renderScreener();
  });
  // 단계 플로우
  if (!scrChainIndustry) {
    flowHost.innerHTML = `<span class="sub-note">위에서 산업을 선택하면 밸류체인 단계가 표시됩니다.</span>`;
  } else {
    const c = CHAINS[scrChainIndustry];
    const stages = scrChainAllStages(scrChainIndustry);
    flowHost.innerHTML = stages.map((st, i) => {
      const n = st._codes.filter((x) => uni.has("kr_" + x)).length;
      const arrow = (c.flow && i) ? '<span class="scr-arrow">›</span>' : "";
      return `${arrow}<button class="scr-stage ${scrChainSel.has(st.key) ? "on" : ""}" data-k="${st.key}" title="${st.desc || ""}"><span class="scr-si">${st.icon}</span><span class="scr-sn">${st.name}</span><span class="scr-sc">${n}</span></button>`;
    }).join("");
    flowHost.querySelectorAll(".scr-stage").forEach((b) => b.onclick = () => {
      const k = b.dataset.k;
      if (scrChainSel.has(k)) scrChainSel.delete(k); else scrChainSel.add(k);
      renderScrChain(); renderScreener();
    });
  }
  const clr = $("#scr-chain-clear"); if (clr) clr.style.display = (scrChainIndustry || scrChainSel.size) ? "" : "none";
}

function buildScrSectors() {
  const host = $("#scr-sectors");
  const secs = scrSectorsFor("us");          // 산업(업종)필터는 미국 전용 → 미국 GICS 업종만
  const byG = {};
  secs.forEach(([nm, n]) => { const k = scrGroupOf(nm); (byG[k] = byG[k] || { subs: [], total: 0 }); byG[k].subs.push([nm, n]); byG[k].total += n; });
  const metaMap = Object.fromEntries([...SCR_GROUPS, SCR_GROUP_ETC].map((g) => [g.key, g]));
  const order = [...SCR_GROUPS.map((g) => g.key), "etc"].filter((k) => byG[k]);
  const selHas = (nm) => scrState.sectors && scrState.sectors.has(nm);
  host.innerHTML = order.map((k) => {
    const g = metaMap[k], grp = byG[k];
    const subs = grp.subs.sort((a, b) => b[1] - a[1]);
    const selN = subs.filter(([nm]) => selHas(nm)).length;
    const cls = selN === 0 ? "" : (selN === subs.length ? "all" : "some");
    const open = scrOpenGroup === k;
    const chips = subs.map(([nm, n]) =>
      `<button class="scr-sub ${selHas(nm) ? "on" : ""}" data-sec="${nm.replace(/"/g, "&quot;")}">${nm}<span class="scr-subn"> ${n}</span></button>`).join("");
    return `<div class="scr-group">
      <button class="scr-gchip ${cls} ${open ? "open" : ""}" data-gk="${k}"><span class="scr-gi">${g.icon}</span>${g.name}<span class="scr-gc">${grp.total}</span>${selN ? `<span class="scr-gsel">${selN}</span>` : ""} <span class="scr-gcaret">${open ? "▲" : "▾"}</span></button>
      <div class="scr-subs" style="display:${open ? "flex" : "none"}">
        <button class="scr-sub-all" data-gk="${k}">${selN === subs.length && selN > 0 ? "그룹 해제" : "그룹 전체"}</button>${chips}
      </div></div>`;
  }).join("");
  host.querySelectorAll(".scr-gchip").forEach((b) => b.onclick = () => {
    scrOpenGroup = scrOpenGroup === b.dataset.gk ? null : b.dataset.gk; buildScrSectors();
  });
  host.querySelectorAll(".scr-sub").forEach((b) => b.onclick = () => {
    const nm = b.dataset.sec;
    if (!scrState.sectors) scrState.sectors = new Set();
    if (scrState.sectors.has(nm)) scrState.sectors.delete(nm); else scrState.sectors.add(nm);
    if (!scrState.sectors.size) scrState.sectors = null;
    buildScrSectors(); renderScreener();
  });
  host.querySelectorAll(".scr-sub-all").forEach((b) => b.onclick = () => {
    const grp = byG[b.dataset.gk];
    if (!scrState.sectors) scrState.sectors = new Set();
    const all = grp.subs.every(([nm]) => scrState.sectors.has(nm));
    grp.subs.forEach(([nm]) => { if (all) scrState.sectors.delete(nm); else scrState.sectors.add(nm); });
    if (!scrState.sectors.size) scrState.sectors = null;
    buildScrSectors(); renderScreener();
  });
  updateScrSecCount();
}
function updateScrSecCount() {
  const n = scrState.sectors ? scrState.sectors.size : 0;
  const total = scrSectorsFor("us").length;
  $("#scr-sec-count").textContent = n ? `${n}개 업종 선택` : `전체 업종 (${total})`;
}
// 국가에 따라 필터 UI 전환: 한국=밸류체인만 / 미국=산업(업종)필터만 / 전체=둘 다
function scrSyncFilterVisibility() {
  const c = scrState.country;
  const chainCard = $("#scr-chain-card"), secRow = $("#scr-sector-row");
  if (chainCard) chainCard.style.display = (c === "us") ? "none" : "";
  if (secRow) secRow.style.display = (c === "kr") ? "none" : "";
}

function buildScrTiers() {
  const host = $("#scr-tiers");
  host.innerHTML = scrTiers().map((t) =>
    `<button class="scr-tier" data-min="${t.min == null ? "" : t.min}" data-max="${t.max == null ? "" : t.max}">${t.k}</button>`).join("");
  host.querySelectorAll(".scr-tier").forEach((b) => b.onclick = () => {
    const on = b.classList.contains("active");
    host.querySelectorAll(".scr-tier").forEach((x) => x.classList.remove("active"));
    if (on) { scrState.min = scrState.max = null; $("#scr-mcap-min").value = ""; $("#scr-mcap-max").value = ""; }
    else {
      b.classList.add("active");
      scrState.min = b.dataset.min === "" ? null : parseFloat(b.dataset.min);
      scrState.max = b.dataset.max === "" ? null : parseFloat(b.dataset.max);
      $("#scr-mcap-min").value = scrState.min == null ? "" : scrState.min;
      $("#scr-mcap-max").value = scrState.max == null ? "" : scrState.max;
    }
    renderScreener();
  });
}

// 테마 프리셋 칩
function renderScrThemes() {
  const host = $("#scr-themes"); if (!host) return;
  host.innerHTML = SCR_THEMES.map((t) => `<button class="scr-theme ${scrThemeActive === t.id ? "on" : ""}" data-id="${t.id}" title="${t.desc}">${t.name}</button>`).join("");
  const setDesc = () => { const d = $("#scr-theme-desc"); if (d) d.textContent = scrThemeActive ? SCR_THEMES.find((x) => x.id === scrThemeActive).desc : ""; };
  host.querySelectorAll(".scr-theme").forEach((b) => b.onclick = () => {
    scrThemeActive = (scrThemeActive === b.dataset.id) ? null : b.dataset.id;
    renderScrThemes(); renderScreener();
  });
  setDesc();
}

// 세부 지표 필터 UI (카테고리별 접이식 · 버킷 칩)
function renderScrMetrics() {
  const host = $("#scr-metrics");
  if (!host) return;
  host.innerHTML = SCR_CATS.map((cat) => {
    const ms = SCR_METRICS.filter((m) => m.cat === cat);
    const rows = ms.map((m) => {
      const chips = m.buckets.map((b, i) =>
        `<button class="scr-bk" data-mid="${m.id}" data-i="${i}">${b.l}</button>`).join("");
      const note = m.note ? `<span class="scr-mnote">${m.note}</span>` : "";
      return `<div class="scr-metric-row"><span class="scr-mlabel">${m.label}<span class="sub-note"> (${m.unit})</span>${note}</span><span class="scr-bks">${chips}</span></div>`;
    }).join("");
    return `<details class="scr-cat"${cat === "기업가치" ? " open" : ""}><summary>${cat} <span class="sub-note scr-cat-n" data-cat="${cat}"></span></summary>${rows}</details>`;
  }).join("");
  host.querySelectorAll(".scr-bk").forEach((b) => b.onclick = () => {
    const mid = b.dataset.mid, i = +b.dataset.i;
    const set = scrMetricSel[mid] || (scrMetricSel[mid] = new Set());
    if (set.has(i)) set.delete(i); else set.add(i);
    if (!set.size) delete scrMetricSel[mid];
    b.classList.toggle("active");
    renderScreener();
  });
  const ul = $("#scr-unavail-list");
  if (ul) ul.innerHTML = SCR_UNAVAIL.map(([a, b]) => `<li><b>${a}</b> — ${b}</li>`).join("");
}
function updateScrCatCounts() {
  document.querySelectorAll(".scr-cat-n").forEach((el) => {
    const n = SCR_METRICS.filter((m) => m.cat === el.dataset.cat && scrMetricSel[m.id]).length;
    el.textContent = n ? `· ${n}개 적용` : "";
  });
}

function renderScreener() {
  if (!MARKET || !MARKET.heatmap) return;
  const active = Object.keys(scrMetricSel).filter((id) => scrMetricSel[id] && scrMetricSel[id].size);
  const useDetail = scrValsReady && active.length > 0;
  const useTheme = scrValsReady && scrThemeActive;
  const chainKeys = (scrChainIndustry && scrChainSel.size) ? scrChainKeys() : null;  // 밸류체인 단계 선택 시 해당 종목만
  let rows = scrPool().filter((t) => {
    if (chainKeys && t.m === "kr" && !chainKeys.has(t.m + "_" + t.t)) return false;  // 밸류체인=국내만
    if (scrState.sectors && t.m === "us" && !scrState.sectors.has(t.sector)) return false;  // 산업(업종)필터=미국만
    const v = scrMcapVal(t);
    if (scrState.min != null && v < scrState.min) return false;
    if (scrState.max != null && v > scrState.max) return false;
    if (useDetail || useTheme) {
      const vals = scrVals.get(t.m + "_" + t.t) || {};
      if (useTheme && !scrThemePass(vals)) return false;
      if (useDetail) for (const id of active) {
        const val = vals[id];
        if (val == null) return false;  // 지표값 없으면 제외
        const M = SCR_METRIC_BY_ID[id];
        if (![...scrMetricSel[id]].some((i) => scrBucketMatch(M.buckets[i], val))) return false;
      }
    }
    return true;
  });
  const s = scrState.sort;
  rows.sort((a, b) => {
    switch (s) {
      case "mcap_asc": return scrMcapVal(a) - scrMcapVal(b);
      case "chg": return b.chg - a.chg;
      case "chg_asc": return a.chg - b.chg;
      case "name": return (a.name || "").localeCompare(b.name || "");
      default: return scrMcapVal(b) - scrMcapVal(a);
    }
  });
  updateScrCatCounts();
  const themeNote = useTheme ? ` · <b>${SCR_THEMES.find((x) => x.id === scrThemeActive).name}</b>` : "";
  $("#scr-summary").innerHTML = `<b>${rows.length}</b>개 종목 <span class="sub-note">/ 유니버스 ${scrPool().length}${active.length ? ` · 지표 ${active.length}종` : ""}${themeNote}</span>`;
  const tb = $("#scr-table");
  if (!rows.length) {
    tb.innerHTML = `<tbody><tr><td style="padding:26px;text-align:center;color:var(--muted)">조건에 맞는 종목이 없습니다.</td></tr></tbody>`;
    return;
  }
  const themeCols = useTheme ? SCR_THEMES.find((x) => x.id === scrThemeActive).conds.map((c) => c.m) : [];
  const cols = [...new Set([...themeCols, ...active])].slice(0, 4);  // 테마·적용 지표값을 컬럼으로 표시(최대 4)
  const colHead = cols.map((id) => `<th class="scr-r">${scrColLabel(id)}</th>`).join("");
  const head = `<thead><tr><th>종목</th><th>국가</th><th>산업</th><th class="scr-r">시가총액</th><th class="scr-r">등락</th>${colHead}</tr></thead>`;
  const body = rows.map((t) => {
    const col = t.chg >= 0 ? "#f5445a" : "#4391ff";
    const vals = scrVals.get(t.m + "_" + t.t) || {};
    const extra = cols.map((id) => `<td class="scr-r">${scrFmtMetric(id, vals[id])}</td>`).join("");
    return `<tr class="scr-row" data-key="${t.m}_${t.t}" title="클릭 = 종목 조회">
      <td class="scr-name"><img class="mv-logo" src="${logoUrl(t.m, t.t)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><b>${t.name}</b> <span class="sub-note">${t.t}</span></td>
      <td>${t.m === "kr" ? "🇰🇷" : "🇺🇸"}</td>
      <td>${t.sector}</td>
      <td class="scr-r">${fmtMcap(t.mcap, t.m)}</td>
      <td class="scr-r" style="color:${col}">${pct(t.chg, 2)}</td>${extra}
    </tr>`;
  }).join("");
  tb.innerHTML = head + `<tbody>${body}</tbody>`;
  tb.querySelectorAll(".scr-row").forEach((tr) => tr.onclick = () => {
    gotoTabFull("lookup");
    if (!lookupRendered) initLookup();
    loadLookup(tr.dataset.key);
  });
}
const SCR_EXTRA_META = { c5: { label: "1주수익률", unit: "%pt" }, upstreak: { label: "연속상승", unit: "일" } };
function scrColLabel(id) { return SCR_METRIC_BY_ID[id]?.label || SCR_EXTRA_META[id]?.label || id; }
function scrFmtMetric(id, v) {
  if (v == null) return "-";
  if (id === "c5") return (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%";
  if (id === "upstreak") return v + "일";
  const u = SCR_METRIC_BY_ID[id]?.unit;
  if (u === "배") return v.toFixed(1) + "배";
  if (u === "년") return v + "년";
  return v.toFixed(1) + "%";
}

/* ---------- 시뮬레이션 ---------- */
const SIM_COLORS = { combo: "#4391ff", combo_regime: "#22c07a", combo_sellexit: "#8e44ad", bench: "#9ca3af" };
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
  { min: 3, c: "#e5384e", label: "+3%↑" },
  { min: 2, c: "#a63042", label: "+2%" },
  { min: 0.25, c: "#55272f", label: "+1%" },
  { min: -0.25, c: "#2a2a31", label: "0" },
  { min: -2, c: "#274468", label: "-1%" },
  { min: -3, c: "#2f65b8", label: "-2%" },
  { min: -Infinity, c: "#3f8cf5", label: "-3%↓" },
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

// TradingView 티커 로딩 감시 — 6초 내 iframe 미렌더 시에만 자체 티커로 완전 대체(정상 로딩 시 이중 티커
// 노출 방지 — TV 티커+자체 티커가 동시에 보이는 것은 중복 UI였음). "!" 문제는 TV 실패 시의 자체 티커
// 기본 목록에 DX-Y.NYB를 포함시켜 해결(TV 심볼 자체가 불안정했던 것).
function watchTvTicker() {
  const tv = $("#tv-ticker");
  if (!tv) return;
  setTimeout(() => {
    const frame = tv.querySelector("iframe");
    const ok = frame && frame.clientHeight > 10;
    if (ok) { $("#macro-ticker").style.display = "none"; }
    else tv.style.display = "none";
  }, 6000);
}

// 자체 매크로 데이터로 지수 티커 스트립 렌더 — TradingView 로딩 실패 시의 전체 대체용(정상 로딩 시 watchTvTicker가 숨김)
function renderMacroTicker(pickOverride) {
  const host = $("#macro-ticker");
  if (!host || !MARKET?.macro) return;
  const pick = pickOverride || ["^KS11", "^KQ11", "^GSPC", "^IXIC", "^SOX", "KRW=X", "^VIX", "DX-Y.NYB", "CL=F"];
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
     <span class="hm-grad" style="background:linear-gradient(90deg,#4391ff,#274468,#2a2a31,#55272f,#f5445a)"></span>
     <span class="hm-leg-lab">+3%</span>`;
  // 국내/미국 토글 → 카드+히트맵+오늘의종목 동기 재렌더 (rAF 금지 — 동기 실행)
  $("#home-mk").querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      homeMk = btn.dataset.mk;
      hmZoomSector = null;
      $("#hm-back").style.display = "none";
      $("#home-mk").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === btn));
      renderIdxCards(); drawTreemap(); renderMovers(); renderRankings(); renderHomeNews();
    };
  });
  $("#hm-back").onclick = () => {
    hmZoomSector = null;
    $("#hm-back").style.display = "none";
    drawTreemap();
  };
  $("#home-news-more").onclick = (e) => { e.preventDefault(); activateTab("news"); };
  const dealsMore = $("#home-deals-more");
  if (dealsMore) dealsMore.onclick = (e) => { e.preventDefault(); activateTab("news"); };  // 딜=뉴스·일정 탭 내 딜 코너
  renderIdxCards();
  drawTreemap();
  renderMovers();
  renderRankings();
  renderHomeNews();
  renderHomeDeals();
  setTimeout(syncHomeHeights, 60);   // 레이아웃 안정 후 재동기화(초기 렌더 타이밍 보정)
  if (!renderHome._resizeBound) {   // 리사이즈 시 우측 높이 재동기화(1회 바인딩)
    renderHome._resizeBound = true;
    window.addEventListener("resize", () => { if (heatmapRendered) syncHomeHeights(); });
  }
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
    if (m) cards.push({ id: m.id, name: m.name, last: m.last, chg: m.chg, spark: m.spark, unit: m.unit });
  }
  for (const f of (MARKET.featured?.[homeMk] || [])) {
    cards.push({ name: f.name, last: f.last, chg: f.chg, spark: f.spark, unit: homeMk === "kr" ? "원" : "$", t: f.t });
  }
  host.innerHTML = cards.map((c, i) => {
    const up = c.chg >= 0;
    const val = c.unit === "$" ? `$${c.last.toLocaleString()}` : `${c.last.toLocaleString()}${c.unit || ""}`;
    return `<div class="idx-card clickable" data-i="${i}" ${c.t ? `data-t="${c.t}"` : ""} ${c.id ? `data-mid="${c.id}"` : ""} title="클릭 = 5년 차트">
      <div class="idx-name">${c.name}</div>
      <div class="idx-val">${val}</div>
      <div class="idx-chg ${up ? "pos" : "neg"}">${up ? "▲" : "▼"} ${pct(c.chg, 2)}</div>
      ${sparkSvg(c.spark, up ? "#f5445a" : "#4391ff")}
    </div>`;
  }).join("");
  // 카드 클릭 = 5년 차트 팝업 (지수=macro w5 / 개별종목=종목파일 5년 시계열 lazy 로드)
  host.querySelectorAll(".idx-card.clickable").forEach((el) => {
    el.onclick = () => {
      const c = cards[+el.dataset.i];
      if (c.id) { openMacroDialog(byId[c.id]); return; }
      openStockDialog(homeMk, c.t, c.name, c.last, c.chg, c.unit);
    };
  });
}

// 개별종목 5년 차트 팝업 — data/stocks/{key}.json(주1 갱신)의 5년 일봉을 주봉으로 솎아 표시
function openStockDialog(mk, t, name, last, chg, unit) {
  const key = `${mk}_${t}`;
  openChartDialog(name, `<p class="mini-note">5년 차트 불러오는 중…</p>`, [], []);
  fetch(`data/stocks/${key}.json` + _cb).then((r) => (r.ok ? r.json() : null)).then((st) => {
    const s = st?.series || [];
    if (!s.length) {
      openChartDialog(name, `현재 <b>${(last ?? 0).toLocaleString()}${unit || ""}</b> · <span class="sub-note">5년 데이터를 찾지 못했습니다</span>`, [], []);
      return;
    }
    const w = s.filter((_, i) => i % 5 === 0);           // 주 1개꼴로 솎기(약 260포인트)
    const dates = w.map((x) => x.t), vals = w.map((x) => x.c);
    const link = `<div style="margin-top:8px"><a href="#" id="wd-golookup" class="home-more">종목 조회에서 자세히 보기 →</a></div>`;
    openChartDialog(name, _fiveYrStats(last, chg, vals, unit) + link, dates, vals);
    const a = document.getElementById("wd-golookup");
    if (a) a.onclick = (e) => {
      e.preventDefault();
      $("#world-dialog").close();
      gotoTabFull("lookup");
      if (!lookupRendered) initLookup();
      loadLookup(key);
    };
  });
}

// 오늘의 종목: 거래대금/거래량/급등/급락 칩 + 순위 리스트
// 현재 시장에 토스 랭킹이 있는지 — 있으면 '오늘의 종목'은 중복이라 숨김(랭킹이 없을 때만 폴백 표시)
function rankingsAvailable() {
  const rk = TOSSM?.rankings;
  return !!rk && RANK_CATS.some(([k]) => rk[`${homeMk}_${k}`]?.rows?.length);
}

const MV_CATS = [["value", "거래대금"], ["volume", "거래량"], ["gainers", "급등"], ["losers", "급락"]];
function renderMovers() {
  const wrap = $("#mv-wrap");
  if (wrap) wrap.style.display = rankingsAvailable() ? "none" : "";   // 랭킹 있으면 중복 → 숨김
  const chips = $("#mv-chips"), list = $("#mv-list");
  if (!chips || !MARKET.movers || rankingsAvailable()) return;
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
      <img class="mv-logo" src="${logoUrl(homeMk, r.t)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <span class="mv-name"><b>${r.name}</b><span class="sub-note"> ${r.t}</span><br>
        <span class="mv-sub">${sub}</span></span>
      <span class="mv-price">${fmtPrice(r.last, homeMk)}
        <span class="${up ? "pos" : "neg"}">${up ? "▲" : "▼"} ${pct(r.chg, 1)}</span></span>
    </div>`;
  }).join("") || `<p class="mini-note">데이터 없음</p>`;
  list.querySelectorAll(".mv-row").forEach((el) => {
    el.onclick = () => {
            gotoTabFull("lookup");
      if (!lookupRendered) initLookup();
      loadLookup(`${homeMk}_${el.dataset.t}`);
    };
  });
}

// 주요 뉴스 미리보기 (뉴스 탭 데이터 재사용, 상위 5건)
// 실시간 랭킹 (toss_market.json) — 홈 시장 토글(homeMk)에 연동. TOSSM 없으면 섹션 숨김.
const RANK_CATS = [["amount", "거래대금"], ["volume", "거래량"], ["gainers", "급등"],
                   ["losers", "급락"], ["toss", "🟦 토스 고객"]];
let rankCat = "amount";

function renderRankings() {
  const wrap = $("#rank-wrap");
  if (!wrap) return;
  const rk = TOSSM?.rankings;
  if (!rk) { wrap.style.display = "none"; return; }

  // 현재 시장에서 제공되는 카테고리만 노출(미국은 거래량 랭킹 미수집)
  const cats = RANK_CATS.filter(([k]) => rk[`${homeMk}_${k}`]?.rows?.length);
  if (!cats.length) { wrap.style.display = "none"; return; }
  wrap.style.display = "";
  if (!cats.some(([k]) => k === rankCat)) rankCat = cats[0][0];

  const g = rk[`${homeMk}_${rankCat}`];
  // 토스는 15:40 노트북 배치라 노트북이 꺼져 있으면 스냅샷이 하루 이상 낡는다. "실시간"으로만 적으면
  // 홈 '오늘의 종목'(30분 클라우드 갱신)과 값이 달라 보여 오해 → 경과 시간을 반드시 함께 표기.
  const ageH = TOSSM.generated
    ? (Date.now() - new Date(TOSSM.generated.replace(" ", "T") + "+09:00").getTime()) / 3.6e6 : null;
  const stale = ageH != null && ageH >= 12;
  $("#rank-note").innerHTML =
    `(토스증권 ${g.duration === "realtime" ? "체결 기준" : "1일"} · ${relTime(TOSSM.generated)} 수집)` +
    (stale ? ` <span class="rank-stale">⚠ ${Math.floor(ageH)}시간 전 스냅샷 (장중엔 지연)</span>` : "");

  $("#rank-chips").innerHTML = cats.map(([k, lab]) =>
    `<button class="chip${k === rankCat ? " active" : ""}" data-cat="${k}">${lab}</button>`).join("");
  $("#rank-chips").querySelectorAll(".chip").forEach((b) => {
    b.onclick = () => { rankCat = b.dataset.cat; renderRankings(); };
  });

  $("#rank-list").innerHTML = g.rows.map((r) => {
    const up = (r.chg ?? 0) >= 0;
    const sub = rankCat === "volume"
      ? `거래량 ${(r.volume || 0).toLocaleString()}주`
      : `거래대금 ${fmtMcap(r.amount || 0, homeMk)}`;
    // 변동액 = 현재가 - 전일종가(현재가/(1+등락률)). 가격=검정, 변동액(액수+%) 전체를 국내 관례 색상(상승 빨강/하락 파랑)
    const c = r.chg;
    const flat = c == null || isNaN(c) || c === 0;
    const cls = flat ? "" : up ? "kup" : "kdn";
    const diff = c != null && !isNaN(c) && 1 + c !== 0 ? r.last - r.last / (1 + c) : null;
    const diffTxt = diff == null ? "" : `${up ? "▲" : "▼"} ${fmtPrice(Math.abs(diff), homeMk)} `;
    return `<div class="mv-row" data-t="${r.t}">
      <span class="mv-rank">${r.rank}</span>
      <img class="mv-logo" src="${logoUrl(homeMk, r.t)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <span class="mv-name"><b>${r.name}</b><span class="sub-note"> ${r.t}</span>${r.halted ? ` <span class="rank-halt">거래정지</span>` : ""}<br>
        <span class="mv-sub">${sub}</span></span>
      <span class="mv-price"><span class="mv-p">${fmtPrice(r.last, homeMk)}</span>
        <span class="mv-d ${cls}">${diffTxt}${flat ? "" : "("}${pct(r.chg, 1)}${flat ? "" : ")"}</span></span>
    </div>`;
  }).join("") || `<p class="mini-note">데이터 없음</p>`;

  // 유니버스 안의 종목만 종목조회로 연결(밖이면 클릭 무시)
  const uni = new Set((MARKET?.heatmap || []).filter((t) => t.m === homeMk).map((t) => t.t));
  $("#rank-list").querySelectorAll(".mv-row").forEach((el) => {
    if (!uni.has(el.dataset.t)) { el.classList.add("mv-row-flat"); return; }
    el.onclick = () => {
      gotoTabFull("lookup");
      if (!lookupRendered) initLookup();
      loadLookup(`${homeMk}_${el.dataset.t}`);
    };
  });
}

// 홈 주요 뉴스 — 국내/미국 토글 연동(mk 태그가 없는 구버전 news.json이면 전체 표시)
function renderHomeNews() {
  const host = $("#home-news");
  if (!host) return;
  const all = NEWS?.market || [];
  const tagged = all.filter((n) => n.mk === homeMk);
  const rows = tagged.length ? tagged : all.some((n) => n.mk) ? [] : all;
  host.innerHTML = rows.length
    ? newsList(rows.slice(0, 12), false)   // 우측 절반 스크롤 영역 — 넉넉히 채움
    : `<p class="mini-note">${all.length ? "이 시장 뉴스가 아직 없습니다(다음 갱신 후 표시)" : "뉴스 데이터 없음"}</p>`;
  syncHomeHeights();
}

// 💼 딜 레이더 — deals.json(더벨·딜사이트 등) 상위. 시장 토글과 무관(국내외 자본거래).
function renderHomeDeals() {
  const host = $("#home-deals");
  if (!host) return;
  const d = DEALS || {};
  const items = [...(d.premium || []), ...(d.kr || []), ...(d.global || [])]
    .filter((x) => x && x.title)
    .sort((a, b) => (b.t || "").localeCompare(a.t || ""))
    .slice(0, 12);
  host.innerHTML = items.length ? newsList(items, false)
    : `<p class="mini-note">딜 데이터 없음(다음 갱신 후 표시)</p>`;
  syncHomeHeights();
}

// 우측(뉴스+딜) 전체 높이를 히트맵 컬럼 높이에 맞춤 → 각 절반은 grid 1fr, 넘치면 자체 스크롤
function syncHomeHeights() {
  const heat = document.querySelector(".home-heat"), right = document.querySelector(".home-right");
  if (!heat || !right) return;
  if (window.innerWidth <= 1100) { right.style.height = ""; return; }  // 1열 스택 구간은 자연 높이
  const h = heat.offsetHeight;
  if (h > 100) right.style.height = h + "px";   // 패널 숨김(offsetHeight≈0) 땐 건드리지 않음
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
      <span class="hm-sec-chg" style="color:${sr.chg >= 0.0025 ? "#f5445a" : sr.chg <= -0.0025 ? "#4391ff" : "#6b7280"}">${secPct}</span>${zoomBtn}</div>`;
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
                gotoTabFull("lookup");
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

const MACRO_HIDE = new Set(["^KS11", "^KQ11", "^GSPC", "^IXIC"]);  // 홈에 이미 있는 지수 → 매크로 탭에서 제외
function renderMacro() {
  if (!MARKET) { $("#macro-context").textContent = "market.json 없음 — python analysis\\market_dash.py 실행 필요"; return; }
  macroRendered = true;
  $("#macro-context").innerHTML =
    `<b>기준 시각 ${MARKET.generated}</b> — ${relTime(MARKET.generated)} 갱신 (<b>클라우드 30분 주기</b>) ·
     카드 아래 줄 = <b>트레이더 관점 한 줄</b> · 카드 클릭 = <b>5년 차트</b>`;
  const items = MARKET.macro.filter((m) => !MACRO_HIDE.has(m.id));
  $("#macro-cards").innerHTML = items.map((m) => {
    const up = m.chg >= 0;
    const clk = m.w5 && m.w5.length > 1;
    return `<div class="card macro-card${clk ? " clickable" : ""}" ${clk ? `data-mid="${m.id}"` : ""}>
      <div class="macro-head"><span class="macro-name">${m.name}</span>
        <span class="badge dim">${m.group}</span></div>
      <div class="macro-val"><b>${m.last.toLocaleString()}${m.unit}</b>
        <span class="${up ? "pos" : "neg"}">${pct(m.chg)}</span></div>
      ${sparkSvg(m.spark, up ? "#f5445a" : "#4391ff")}
      <div class="desc">${m.note}</div>
    </div>`;
  }).join("");
  $("#macro-cards").querySelectorAll(".macro-card.clickable").forEach((c) =>
    c.onclick = () => openMacroDialog(MARKET.macro.find((m) => m.id === c.dataset.mid)));
}

/* ---------- 매크로 탭 (지표 카드 + 세계 지도[증시/기준금리]) ---------- */
function renderMacroTab() {
  renderMacro();       // 매크로 카드 (macroRendered 세팅)
  renderBondCurve();   // 국고채 금리 커브 (toss_market.json — 없으면 섹션 숨김)
  renderWorld();       // 세계 지도 — 증시/기준금리 토글 (중앙은행 금리는 MARKET.cbanks)
}

// 국고채 금리 커브 — 만기별 수익률 막대 + 장단기 스프레드. TOSSM 없으면 섹션 자체를 숨김.
function renderBondCurve() {
  const wrap = $("#bond-curve-wrap");
  const b = TOSSM?.bonds;
  if (!wrap || !b || !b.curve?.length) { if (wrap) wrap.style.display = "none"; return; }
  wrap.style.display = "";
  $("#bond-curve-note").textContent = `(${TOSSM.generated} 기준 · 만기별 수익률)`;

  const sp = b.spreads || {};
  $("#bond-spreads").innerHTML = Object.entries(sp).map(([k, v]) => {
    const neg = v < 0;
    return `<span class="bond-sp ${neg ? "neg" : ""}">${k} <b>${v >= 0 ? "+" : ""}${v.toFixed(3)}%p</b>${neg ? " 역전" : ""}</span>`;
  }).join("") + (b.inverted
    ? `<span class="bond-warn">⚠ 장단기 금리 역전 — 경기침체 신호</span>`
    : `<span class="sub-note">정상 우상향 커브</span>`);

  const ys = b.curve.map((c) => c.yield);
  const lo = Math.min(...ys), hi = Math.max(...ys), span = Math.max(0.001, hi - lo);
  $("#bond-curve").innerHTML = b.curve.map((c) => {
    const h = 24 + ((c.yield - lo) / span) * 76;  // 24~100%
    return `<div class="bond-bar"><span class="bond-val">${c.yield.toFixed(3)}</span>
      <div class="bond-fill" style="height:${h}%"></div>
      <span class="bond-lbl">${c.label}</span></div>`;
  }).join("");
}

// 세계 증시 지도 — world.svg 인라인 + 국가 색칠 + 칩(getBBox 좌표) + 클릭 5년 차트 팝업
const WORLD_SVG_IDS = {  // 야후티커 -> 색칠할 svg path id들 (칩 위치 = 첫 id의 bbox 중심)
  "^GSPC": ["usa"], "^GSPTSE": ["canada"], "^BVSP": ["brazil"],
  "^FTSE": ["britain"], "^FCHI": ["france"], "^GDAXI": ["germany"], "^STOXX50E": [],
  "^BSESN": ["india"], "000001.SS": ["china"], "^HSI": [], "^TWII": ["taiwan"],
  "^KS11": ["south korea"], "^N225": ["honshu", "hokkaido", "kyushu", "shikoku"], "^AXJO": ["australia"],
};
const WORLD_CHIP_FALLBACK = { "^STOXX50E": [48.5, 42], "^HSI": [77.5, 50.5] };  // path 없는 지역(% 좌표)
// 중앙은행 코드 → svg path id (기준금리 모드). ECB(XM)는 유로존 대표국 색칠 + 유럽 좌표 칩.
const CB_SVG = { US: ["usa"], KR: ["south korea"], JP: ["honshu", "hokkaido", "kyushu", "shikoku"],
  GB: ["britain"], CN: ["china"], CA: ["canada"], AU: ["australia"],
  XM: ["france", "germany", "italy", "spain", "poland"] };
// 중앙은행 칩 위치(% 좌표, 수기 — 동아시아 겹침 방지). 한국 포함.
const CB_XY = { US: [18, 44], CA: [17, 30], XM: [49, 36], GB: [45, 29], KR: [83, 39],
  JP: [88, 43], CN: [75, 44], AU: [85, 74] };
const CB_SHORT = { US: "미국", KR: "한국", XM: "유로존", JP: "일본", GB: "영국", CN: "중국", CA: "캐나다", AU: "호주" };
let worldChart = null;
let worldMode = "stocks";   // "stocks" | "rates"
let worldSvgLoaded = false;

function worldColor(chg) {
  if (chg == null) return "#d8dce3";
  if (chg >= 0.02) return "#f5445a";
  if (chg >= 0.003) return "#e8888c";
  if (chg > -0.003) return "#c9ced8";
  if (chg > -0.02) return "#8fb0e8";
  return "#4391ff";
}
function rateColor(bp) {  // 최근 변경 방향: 인상=빨강 / 인하=파랑 / 동결=회색
  if (bp == null || bp === 0) return "#c9ced8";
  return bp > 0 ? "#e0888c" : "#8fb0e8";
}

async function renderWorld() {
  const host = $("#world-map");
  if (!host) return;
  if (!MARKET?.world?.length && !MARKET?.cbanks?.length) {
    host.innerHTML = `<p class="mini-note" style="padding:20px">세계 데이터 없음 — 다음 클라우드 갱신(30분) 후 표시됩니다.</p>`; return;
  }
  if (!worldSvgLoaded) {
    let svgTxt;
    try { svgTxt = await (await fetch("assets/world.svg" + _cb)).text(); }
    catch (e) { host.innerHTML = `<p class="mini-note">지도 로드 실패</p>`; return; }
    host.innerHTML = svgTxt;
    const svg = host.querySelector("svg");
    if (!svg) return;
    svg.removeAttribute("width"); svg.removeAttribute("height");
    svg.classList.add("world-svg");
    worldSvgLoaded = true;
  }
  const tg = $("#world-mode");
  if (tg && !tg.dataset.bound) {
    tg.dataset.bound = "1";
    tg.querySelectorAll("button").forEach((b) => b.onclick = () => {
      worldMode = b.dataset.mode;
      tg.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      paintWorld();
    });
  }
  paintWorld();
}

function paintWorld() {
  const host = $("#world-map"), svg = host.querySelector("svg");
  if (!svg) return;
  host.querySelectorAll(".world-chip").forEach((c) => c.remove());
  svg.querySelectorAll("path").forEach((p) => {
    p.style.fill = "#26262c"; p.style.stroke = "#17171c"; p.style.strokeWidth = ".5"; p.style.cursor = ""; p.onclick = null;
  });
  const byId = (id) => svg.querySelector(`path[id="${id}"]`);
  // 국가 path는 id로 색칠, 칩 위치는 수기 xy(%)로 고정 → 동아시아(한국·일본·중국 등) 칩 겹침 방지
  const place = (ids, xy, color, labelHtml, chipClass, onClick) => {
    (ids || []).forEach((pid) => {
      const p = byId(pid); if (!p) return;
      p.style.fill = color; p.style.cursor = "pointer"; p.onclick = onClick;
    });
    if (!xy) return;
    const chip = document.createElement("button");
    chip.className = "world-chip " + (chipClass || "");
    chip.style.left = xy[0] + "%"; chip.style.top = xy[1] + "%";
    chip.innerHTML = labelHtml;
    chip.onclick = onClick;
    host.appendChild(chip);
  };
  $("#world-context").innerHTML = worldMode === "stocks"
    ? `<b>세계 증시 당일 등락</b> — 상승 빨강·하락 파랑. 국가/칩 클릭 = <b>5년 지수 차트</b>.`
    : `<b>중앙은행 정책금리(BIS)</b> — 색: 최근 <span class="pos">인상(빨강)</span>·<span class="neg">인하(파랑)</span>·동결(회색).
       국가/칩 클릭 = <b>상세</b>(금리 이력·다음 결정일·시장 기대).`;
  if (worldMode === "stocks") {
    (MARKET.world || []).forEach((r) => place(
      WORLD_SVG_IDS[r.id] || [], WORLD_CHIP_FALLBACK[r.id] || [r.x, r.y], worldColor(r.chg),
      `${r.flag} ${r.name} <b>${r.chg != null ? pct(r.chg, 1) : "-"}</b>`,
      (r.chg ?? 0) >= 0 ? "up" : "down", () => openIndexDialog(r)));
  } else {
    (MARKET.cbanks || []).forEach((cb) => place(
      CB_SVG[cb.code] || [], CB_XY[cb.code], rateColor(cb.changed?.bp),
      `${cb.flag} ${CB_SHORT[cb.code] || ""} <b>${cb.rate}%</b>`, "rate", () => openCbDialog(cb)));
  }
  deconflictChips(host);
}

// 지도 칩 겹침 해소 — 수기 좌표는 화면 폭에 따라 겹칠 수 있어(유럽·동아시아 밀집) 배치 후 보정.
// 겹치는 쌍은 아래쪽 칩을 필요한 만큼 아래로 밀어냄(%가 아닌 px로 재고정, 3패스면 수렴).
function deconflictChips(host) {
  const chips = [...host.querySelectorAll(".world-chip")];
  if (chips.length < 2) return;
  const hostR = host.getBoundingClientRect();
  // %좌표 → px 고정(이후 계산 안정)
  chips.forEach((c) => {
    const r = c.getBoundingClientRect();
    c.style.left = (r.left - hostR.left + r.width / 2) + "px";
    c.style.top = (r.top - hostR.top + r.height / 2) + "px";
  });
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    const rs = chips.map((c) => c.getBoundingClientRect());
    for (let i = 0; i < chips.length; i++) {
      for (let j = i + 1; j < chips.length; j++) {
        const a = rs[i], b = rs[j];
        const ovX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const ovY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ovX > 2 && ovY > 1) {                 // 실질 겹침
          const lower = a.top <= b.top ? j : i;   // 더 아래에 있는 쪽을 밀어냄
          const dy = ovY + 3;
          chips[lower].style.top = (parseFloat(chips[lower].style.top) + dy) + "px";
          rs[lower] = chips[lower].getBoundingClientRect();
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

// 5년 차트 팝업 공용 (지수·매크로) — dates/values + area 차트
// 5년 차트 팝업 닫기 바인딩 — ✕ / 배경 클릭 / Esc 모두 차트까지 정리
function bindChartDialog() {
  const dlg = $("#world-dialog");
  if (!dlg || dlg.dataset.bound) return;
  dlg.dataset.bound = "1";
  const kill = () => { if (worldChart) { worldChart.remove(); worldChart = null; } };
  $("#wd-close").onclick = () => { dlg.close(); kill(); };
  dlg.addEventListener("close", kill);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });  // 배경 클릭
}

function openChartDialog(title, statsHtml, dates, values, opts) {
  opts = opts || {};
  const dlg = $("#world-dialog");
  $("#wd-title").textContent = title;
  $("#wd-stats").innerHTML = statsHtml;
  if (!dlg.open) dlg.showModal();   // 이미 열려 있을 때 재호출하면 InvalidStateError → 아래 차트 생성이 통째로 건너뛰어짐
  if (worldChart) { worldChart.remove(); worldChart = null; }
  const el = $("#wd-chart"); el.innerHTML = "";
  const pts = (dates || []).map((d, i) => ({ time: d, value: values[i] })).filter((x) => x.value != null);
  if (pts.length > 1) {
    worldChart = LightweightCharts.createChart(el, baseChartOpts(el, 300));
    const stepType = (LightweightCharts.LineType && LightweightCharts.LineType.WithSteps) ?? 1;
    const ser = opts.step
      ? worldChart.addLineSeries({ color: "#e0912f", lineWidth: 2, lineType: stepType, priceLineVisible: false })
      : worldChart.addAreaSeries({ lineColor: "#4391ff", topColor: "rgba(30,99,224,.25)", bottomColor: "rgba(30,99,224,.02)", lineWidth: 2 });
    ser.setData(pts);
    worldChart.timeScale().fitContent();
  } else {
    el.innerHTML = `<p class="mini-note" style="padding:20px">차트 데이터가 아직 없습니다(다음 갱신 후 표시).</p>`;
  }
}

function _fiveYrStats(last, chg, w5, unit) {
  if (!(w5 && w5.length > 1)) return last != null ? `현재 <b>${last.toLocaleString()}${unit || ""}</b>` : "";
  const ret5 = w5[w5.length - 1] / w5[0] - 1, hi = Math.max(...w5), lo = Math.min(...w5);
  return `현재 <b>${(last ?? w5[w5.length - 1]).toLocaleString()}${unit || ""}</b>
    ${chg != null ? `<span class="${chg >= 0 ? "pos" : "neg"}">(${pct(chg, 2)})</span>` : ""}
    · 5년 변화 <b class="${ret5 >= 0 ? "pos" : "neg"}">${pct(ret5, 0)}</b>
    · 5년 최고 ${hi.toLocaleString()} · 최저 ${lo.toLocaleString()}`;
}

function openIndexDialog(r) {
  openChartDialog(`${r.flag} ${r.country} — ${r.name}`, _fiveYrStats(r.last, r.chg, r.w5), r.w5d, r.w5);
}
function openMacroDialog(m) {
  if (!m) return;
  openChartDialog(m.name, _fiveYrStats(m.last, m.chg, m.w5, m.unit), m.w5d, m.w5);
}

// 중앙은행 상세 팝업 — 현재 금리·최근 변경 사이클·다음 결정일·시장 기대 + 금리 이력 스텝차트
function openCbDialog(cb) {
  const ch = cb.changed;
  const cyc = ch ? (ch.bp > 0 ? `<span class="pos">▲ ${ch.bp}bp 인상</span>` : `<span class="neg">▼ ${Math.abs(ch.bp)}bp 인하</span>`) + ` <span class="sub-note">(${ch.d})</span>` : "변경 이력 없음";
  const n = cb.next ? Math.ceil((new Date(cb.next + "T00:00:00+09:00") - Date.now()) / 864e5) : null;
  const imp = cb.implied;
  const stats = `<div class="cb-detail">
    <div>현재 기준금리 <b style="font-size:1.15rem">${cb.rate}%</b> <span class="sub-note">(${cb.asof} 기준)</span></div>
    <div>최근 변경: ${cyc}</div>
    <div>다음 결정: <b>${cb.next || "일정 미정"}</b> ${n != null && n >= 0 ? `<span class="badge hero">D-${n}</span>` : ""}</div>
    ${imp ? `<div class="cb-imp ${imp.diff_bp < 0 ? "cut" : imp.diff_bp > 0 ? "hike" : ""}" style="margin-top:6px">
      시장 기대: <b>${imp.label}</b><div class="sub-note">${imp.src} ${imp.rate}%</div></div>` : ""}
  </div>`;
  openChartDialog(`${cb.flag} ${cb.name}`, stats, cb.rhistd, cb.rhist, { step: true });
}

/* ---------- 마켓: 경제일정 ---------- */
let calMk = "kr";
let calMonth = null;   // 표시 중인 달의 1일 (로컬 Date)
let calSel = null;     // 선택된 날짜 문자열 YYYY-MM-DD
const localDay = (dt) => new Date(dt.getTime() - dt.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

function renderCalendar() {
  calRendered = true;
  if (!CAL) {
    $("#cal-context").textContent = "calendar.json 없음 — python analysis\\calendar_events.py 실행 필요";
    return;
  }
  $("#cal-context").innerHTML =
    `<b>기준 시각 ${CAL.generated}</b> — ${relTime(CAL.generated)} 갱신 (하루 1회)<br>
     국내=한국거래소 KIND 기업설명회(IR) 공시 · 미국=yfinance 실적발표 예정일(EPS 컨센서스 병기).
     날짜를 클릭하면 그날 일정이 아래에 표시됩니다 · 일정은 회사 사정에 따라 변경될 수 있음`;
  const now = new Date();
  calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  calSel = localDay(now);
  $("#cal-mk").querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      calMk = btn.dataset.mk;
      $("#cal-mk").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === btn));
      calDetailSel = null;  // 시장 전환 시 상세 초기화(다른 시장 종목이 남지 않게)
      drawCalMonth();
    };
  });
  $("#cal-prev").onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); drawCalMonth(); };
  $("#cal-next").onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); drawCalMonth(); };
  $("#cal-today-btn").onclick = () => {
    const t = new Date();
    calMonth = new Date(t.getFullYear(), t.getMonth(), 1);
    calSel = localDay(t);
    drawCalMonth();
  };
  drawCalMonth();
}

function calByDay() {
  const byDay = {};
  (CAL?.earnings?.[calMk] || []).forEach((r) => (byDay[r.date] = byDay[r.date] || []).push(r));
  return byDay;
}

function drawCalMonth() {
  $("#cal-src").textContent = calMk === "kr"
    ? `(KIND 공시 · ${CAL.kr_updated ? relTime(CAL.kr_updated) + " 갱신" : "미수집"})`
    : `(yfinance · ${CAL.us_updated ? relTime(CAL.us_updated) + " 갱신" : "미수집"})`;
  const byDay = calByDay();
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  $("#cal-month").textContent = `${y}. ${String(m + 1).padStart(2, "0")}`;
  const today = localDay(new Date());
  const first = new Date(y, m, 1), startDow = first.getDay();
  const dim = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(new Date(y, m, d));
  while (cells.length % 7) cells.push(null);

  const head = "일월화수목금토".split("").map((w, i) =>
    `<div class="cal-hd${i === 0 ? " sun" : i === 6 ? " sat" : ""}">${w}</div>`).join("");
  // 휴장일(토스 market-calendar, 향후 ~90일) — 현재 시장 탭 기준으로 셀에 배지
  const hol = new Set(TOSSM?.calendar?.[calMk]?.holidays || []);
  const body = cells.map((dt) => {
    if (!dt) return `<div class="cal-cell empty"></div>`;
    const ds = localDay(dt), items = byDay[ds] || [], dow = dt.getDay();
    const isHol = hol.has(ds);
    const cls = [ds === today ? "today" : "", ds === calSel ? "sel" : "", items.length ? "has" : "",
      isHol ? "hol" : "", dow === 0 ? "sun" : dow === 6 ? "sat" : ""].filter(Boolean).join(" ");
    const chips = items.slice(0, 2).map((r) =>
      `<span class="cal-ev">${(r.name || "").slice(0, 6)}</span>`).join("");
    const more = items.length > 2 ? `<span class="cal-ev more">+${items.length - 2}</span>` : "";
    return `<div class="cal-cell ${cls}" data-d="${ds}">
      <span class="cal-cell-d">${dt.getDate()}</span>${isHol ? `<span class="cal-hol">휴장</span>` : ""}${items.length ? `<span class="cal-cnt">${items.length}</span>` : ""}
      <div class="cal-evs">${chips}${more}</div></div>`;
  }).join("");
  $("#cal-grid").innerHTML = `<div class="cal-hdrow">${head}</div><div class="cal-cells">${body}</div>`;
  // 다음 휴장일 안내(달력 상단) — 현재 시장 기준
  const nextHol = (TOSSM?.calendar?.[calMk]?.holidays || []).filter((d) => d >= today).slice(0, 3);
  const holHost = document.getElementById("cal-holidays");
  if (holHost) holHost.innerHTML = nextHol.length
    ? `🛑 다음 휴장일(${calMk === "kr" ? "국내" : "미국"}): <b>${nextHol.join(" · ")}</b> <span class="sub-note">(토스 장운영 API · 90일 내)</span>`
    : "";
  $("#cal-grid").querySelectorAll(".cal-cell[data-d]").forEach((c) =>
    c.onclick = () => { calSel = c.dataset.d; drawCalMonth(); });
  drawCalDay();
}

function drawCalDay() {
  const host = $("#cal-daylist");
  const byDay = calByDay();
  const items = byDay[calSel] || [];
  const dt = calSel ? new Date(calSel + "T00:00:00") : null;
  const yo = dt ? "일월화수목금토"[dt.getDay()] : "";
  const head = `<div class="cal-date">${calSel ? calSel.replace(/-/g, ".") + ` (${yo})` : ""}
    <span class="sub-note">${items.length}건</span></div>`;
  if (!items.length) { host.innerHTML = head + `<p class="mini-note">이 날짜에 예정된 일정이 없습니다.</p>`; calDetailPlaceholder(); return; }
  host.innerHTML = head + items.map((r) => `<div class="cal-row${r.t ? " clickable" : ""}" ${r.t ? `data-t="${r.t}"` : ""}>
      ${r.t ? `<img class="cal-logo" src="${logoUrl(calMk, r.t)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
        : (r.logo ? `<img class="cal-logo" src="${r.logo}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="cal-logo"></span>`)}
      <span class="cal-name"><b>${r.name}</b>${r.t ? `<span class="sub-note"> ${r.t}</span>` : ""}</span>
      <span class="cal-info">${calMk === "kr"
        ? `${r.event || ""}${r.time ? ` · ${r.time}` : ""}`
        : (r.eps_est != null ? `EPS 컨센서스 $${r.eps_est}` : "실적발표 예정")}</span>
    </div>`).join("");
  // 회사 클릭 → 우측 상세 패널(실적발표 내용 + 컨퍼런스콜) — 종목조회 이동은 상세 패널의 버튼으로
  host.querySelectorAll(".cal-row").forEach((el, i) => {
    el.classList.add("clickable");
    el.onclick = () => {
      host.querySelectorAll(".cal-row").forEach((x) => x.classList.toggle("sel", x === el));
      calShowDetail(items[i]);
    };
  });
  calDetailPlaceholder();
}

/* ---------- 경제일정: 회사 상세(실적발표 내용 + 컨퍼런스콜) ---------- */
let calDetailSel = null;

function calDetailPlaceholder() {
  if (calDetailSel) return;  // 선택된 게 있으면 유지
  const host = $("#cal-detail");
  if (host) host.innerHTML = `<p class="mini-note" style="margin:8px 0">👈 왼쪽 일정에서 회사를 클릭하면<br>
    <b>실적발표 내용</b>과 <b>컨퍼런스콜·IR 정보</b>가 여기에 표시됩니다.</p>`;
}

function calShowDetail(r) {
  calDetailSel = r;
  const host = $("#cal-detail");
  host.innerHTML = `<p class="mini-note">불러오는 중…</p>`;
  loadExtras().then(() => renderCalDetail(r, calMk));
}

function renderCalDetail(r, mk) {
  if (calDetailSel !== r) return;  // 그새 다른 회사를 클릭했으면 무시
  const host = $("#cal-detail");
  const key = r.t ? `${mk}_${r.t}` : null;
  const co = key ? EXTRAS.company?.map?.[key] : null;
  const fd = key ? EXTRAS.feed?.map?.[key] : null;
  const today = localDay(new Date());
  const upcoming = r.date >= today;
  const dday = Math.round((new Date(r.date) - new Date(today)) / 864e5);
  const yo = "일월화수목금토"[new Date(r.date + "T00:00:00").getDay()];
  const esc = (s) => String(s ?? "").replace(/</g, "&lt;");

  let h = `<div class="cd-head">
    ${r.t ? `<img src="${logoUrl(mk, r.t)}" alt="" onerror="this.style.display='none'">` : ""}
    <div><b>${esc(r.name)}</b>${r.t ? ` <span class="sub-note">${r.t}</span>` : ""}
      <span class="cd-badge ${upcoming ? "upcoming" : "done"}">${upcoming ? (dday === 0 ? "오늘 발표" : `D-${dday}`) : "발표 완료"}</span></div>
    ${r.t ? `<button class="today-chart-btn cd-goto" id="cd-goto">종목조회 →</button>` : ""}
  </div>
  <div class="cd-when">📅 ${r.date.replace(/-/g, ".")} (${yo})${r.time ? ` ${r.time}` : ""}${mk === "kr" && r.event ? ` · ${esc(r.event)}` : ""}</div>`;

  // ── 📊 실적발표 내용 ──
  h += `<h4>📊 실적발표 내용</h4>`;
  const finq = (co?.fin_q || []).filter((q) => q.rev != null);
  if (finq.length) {
    const unit = co.fin_unit || (mk === "kr" ? "억원" : "$M");
    const n = (v) => v == null ? "-" : Math.round(v).toLocaleString();
    // 전년 동기(YoY) — fin_q에 같은 분기 전년치가 있으면 계산
    const byQ = {}; finq.forEach((q) => byQ[q.q] = q);
    const yoy = (q, f) => {
      const m2 = /^(\d{2})Q(\d)$/.exec(q.q); if (!m2) return null;
      const prev = byQ[`${+m2[1] - 1}Q${m2[2]}`];
      return prev && prev[f] ? (q[f] / prev[f] - 1) * 100 : null;
    };
    const rows = finq.slice(-4).map((q) => {
      const g = yoy(q, "rev");
      return `<tr><td>${q.q}${q.est ? "<span class='sub-note'>(E)</span>" : ""}</td>
        <td>${n(q.rev)}</td><td>${n(q.op)}</td><td>${n(q.np)}</td>
        <td>${g == null ? "-" : `<span class="${g >= 0 ? "pos" : "neg"}">${g >= 0 ? "+" : ""}${g.toFixed(1)}%</span>`}</td></tr>`;
    }).join("");
    h += `<table><tr><th>분기</th><th>매출</th><th>영업익</th><th>순이익</th><th>매출YoY</th></tr>${rows}</table>
      <p class="sub-note" style="margin:3px 0 0">(단위 ${unit} · (E)=컨센서스 추정${upcoming ? " · 발표 전 — 직전 분기까지" : ""})</p>`;
  } else {
    h += `<p class="mini-note">${r.t ? "분기 실적 데이터 없음" : "우리 유니버스 밖 종목 — 수치 미보유"}</p>`;
  }
  // US: EPS 서프라이즈(발표 vs 예상)
  const sup = co?.surprise?.eps || [];
  if (sup.length) {
    h += `<h4>🎯 EPS — 발표 vs 예상</h4><table><tr><th>분기</th><th>예상</th><th>발표</th><th>서프라이즈</th></tr>`
      + sup.slice(-4).map((s) => `<tr><td>${s.q}</td><td>$${s.est}</td><td>$${s.actual}</td>
        <td><span class="${s.pct >= 0 ? "pos" : "neg"}">${s.pct >= 0 ? "+" : ""}${s.pct}%</span></td></tr>`).join("") + `</table>`;
    if (upcoming && r.eps_est != null) h += `<p class="sub-note" style="margin:3px 0 0">이번 분기 EPS 컨센서스: <b>$${r.eps_est}</b></p>`;
  } else if (mk === "us" && r.eps_est != null) {
    h += `<p class="sub-note">이번 분기 EPS 컨센서스: <b>$${r.eps_est}</b></p>`;
  }
  // 컨센서스 목표가
  if (co?.cons?.target) {
    h += `<p class="sub-note" style="margin:6px 0 0">🎯 목표주가 ${mk === "kr" ? Math.round(co.cons.target).toLocaleString() + "원" : "$" + Math.round(co.cons.target)}`
      + (co.cons.opinion ? ` · 투자의견 ${co.cons.opinion}/5` : co.cons.opinion_key ? ` · ${co.cons.opinion_key}` : "")
      + (co.cons.n ? ` (${co.cons.n}명)` : "") + `</p>`;
  }

  // ── 🎙 컨퍼런스콜·IR ──
  h += `<h4>🎙 컨퍼런스콜·IR</h4>`;
  if (mk === "kr") {
    if (r.time) h += `<p style="margin:0 0 4px">일시: <b>${r.date.replace(/-/g, ".")} ${r.time}</b> <span class="sub-note">(KIND 기업설명회 공시 기준 · 참여방법은 공시 원문에 기재)</span></p>`;
    const ir = (fd?.disc || []).filter((d) => /실적|설명회|IR|잠정|컨퍼런스/i.test(d.title)).slice(0, 3);
    const rec = ir.length ? ir : (fd?.disc || []).slice(0, 2);
    if (rec.length) h += `<div class="cd-disc">${rec.map((d) =>
      `<a href="${d.link}" target="_blank" rel="noopener">📄 ${esc(d.title)} <span class="sub-note">${d.d}</span></a>`).join("")}</div>`;
    h += `<div class="cd-links">
      ${r.t ? `<a href="https://www.tossinvest.com/stocks/A${r.t}" target="_blank" rel="noopener">토스증권 (어닝콜·요약)</a>` : ""}
      <a href="https://dart.fss.or.kr/dsab007/main.do?option=corp&textCrpNm=${encodeURIComponent(r.name)}" target="_blank" rel="noopener">DART 공시검색</a>
      ${r.t ? `<a href="https://m.stock.naver.com/domestic/stock/${r.t}/total" target="_blank" rel="noopener">네이버 증권</a>` : ""}
    </div>`;
  } else {
    h += `<div class="cd-links">
      <a href="https://www.tossinvest.com/stocks/${r.t}" target="_blank" rel="noopener">토스증권 (어닝콜·요약)</a>
      ${co?.website ? `<a href="${co.website}" target="_blank" rel="noopener">회사 IR·홈페이지</a>` : ""}
      <a href="https://finance.yahoo.com/quote/${r.t}/analysis" target="_blank" rel="noopener">Yahoo 실적 분석</a>
      <a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${r.t}&type=8-K&dateb=&owner=include&count=10" target="_blank" rel="noopener">SEC 8-K 공시</a>
    </div>`;
  }
  h += `<p class="sub-note" style="margin-top:8px">토스증권 링크의 어닝콜 AI 요약은 토스 로그인 후 열람 가능</p>`;

  host.innerHTML = h;
  const go = document.getElementById("cd-goto");
  if (go) go.onclick = () => {
    gotoTabFull("lookup");
    if (!lookupRendered) initLookup();
    loadLookup(`${mk}_${r.t}`);
  };
}

/* ---------- 경제지표 캘린더 (econcal — calendar.json econ, TradingView 수집) ---------- */
let ecRendered = false, ecMonth = null, ecSel = null, ecCountry = "", ecImpOnly = false;
const EC_FLAG = { US: "🇺🇸", KR: "🇰🇷", CN: "🇨🇳", JP: "🇯🇵", EU: "🇪🇺" };
// 자주 나오는 지표명 한글화(구문 치환, 긴 것 우선) — 못 찾으면 영문 그대로
const EC_KO = [
  ["Fed Interest Rate Decision", "연준(Fed) 기준금리 결정"], ["ECB Interest Rate Decision", "ECB 기준금리 결정"],
  ["BoJ Interest Rate Decision", "일본은행 기준금리 결정"], ["Interest Rate Decision", "기준금리 결정"],
  ["FOMC Economic Projections", "FOMC 경제전망"], ["FOMC Minutes", "FOMC 의사록"], ["Fed Press Conference", "연준 기자회견"],
  ["ECB Press Conference", "ECB 기자회견"], ["Deposit Facility Rate", "예금금리(ECB)"],
  ["Loan Prime Rate", "대출우대금리(LPR)"], ["Non Farm Payrolls", "비농업 고용"],
  ["Initial Jobless Claims", "신규 실업수당 청구"], ["Continuing Jobless Claims", "연속 실업수당 청구"],
  ["Unemployment Rate", "실업률"], ["Core Inflation Rate", "근원 소비자물가"], ["Inflation Rate", "소비자물가"],
  ["Core PCE Price Index", "근원 PCE 물가"], ["PCE Price Index", "PCE 물가"],
  ["Michigan Consumer Sentiment", "미시간 소비자심리"], ["Consumer Confidence", "소비자신뢰"],
  ["Business Confidence", "기업신뢰"], ["GDP Growth Rate", "GDP 성장률"], ["GDP Price Index", "GDP 물가지수"],
  ["Retail Sales", "소매판매"], ["Industrial Production", "산업생산"], ["Balance of Trade", "무역수지"],
  ["Manufacturing PMI", "제조업 PMI"], ["Services PMI", "서비스업 PMI"], ["Composite PMI", "종합 PMI"],
  ["Manufacturing Production", "제조업 생산"], ["Durable Goods Orders", "내구재 주문"],
  ["Factory Orders", "공장 주문"], ["Housing Starts", "주택착공"], ["Building Permits", "건축허가"],
  ["Existing Home Sales", "기존주택 판매"], ["New Home Sales", "신규주택 판매"], ["Pending Home Sales", "잠정주택 판매"],
  ["Producer Price Index", "생산자물가"], ["PPI", "생산자물가"], ["Core CPI", "근원 CPI"],
  ["Tokyo CPI", "도쿄 CPI"], ["Tokyo Core CPI", "도쿄 근원 CPI"], ["KTB Auction", "국고채 입찰"],
  ["Bond Auction", "국채 입찰"], ["Bill Auction", "단기국채 입찰"], ["Note Auction", "국채 입찰"],
  ["Exports", "수출"], ["Imports", "수입"], ["Current Account", "경상수지"],
  ["Foreign Exchange Reserves", "외환보유액"], ["Personal Income", "개인소득"], ["Personal Spending", "개인지출"],
  ["Crude Oil Stocks Change", "원유 재고"], ["Capacity Utilization", "설비가동률"],
  ["Speech", "연설"], ["Testimony", "의회 증언"],
];
function ecKo(t) {
  let s = t;
  for (const [en, ko] of EC_KO) if (s.includes(en)) s = s.replace(en, ko);
  return s;
}

function ecByDay() {
  const byDay = {};
  (CAL?.econ || []).forEach((e) => {
    if (ecCountry && e.c !== ecCountry) return;
    if (ecImpOnly && e.imp < 1) return;
    (byDay[e.d] = byDay[e.d] || []).push(e);
  });
  return byDay;
}

function renderEconCal() {
  ecRendered = true;
  if (!CAL?.econ?.length) {
    $("#ec-context").textContent = "경제지표 데이터 없음 — 다음 클라우드 갱신을 기다려 주세요.";
    return;
  }
  $("#ec-context").innerHTML =
    `<b>경제지표 캘린더</b> — 미국·한국·중국·일본·유럽의 주요 지표 발표 일정(중요도 중·상만).
     시각은 한국시간(KST) · ${CAL.econ_updated ? relTime(CAL.econ_updated) + " 갱신(하루 1회)" : ""} ·
     발표치는 갱신 시점 기준 — 장중 실시간은 아래 TradingView 참고`;
  const now = new Date();
  ecMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  ecSel = localDay(now);
  $("#ec-country").querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      ecCountry = btn.dataset.c;
      $("#ec-country").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === btn));
      drawEcMonth();
    };
  });
  $("#ec-imp").onchange = (e) => { ecImpOnly = e.target.checked; drawEcMonth(); };
  $("#ec-prev").onclick = () => { ecMonth = new Date(ecMonth.getFullYear(), ecMonth.getMonth() - 1, 1); drawEcMonth(); };
  $("#ec-next").onclick = () => { ecMonth = new Date(ecMonth.getFullYear(), ecMonth.getMonth() + 1, 1); drawEcMonth(); };
  $("#ec-today-btn").onclick = () => {
    const t = new Date();
    ecMonth = new Date(t.getFullYear(), t.getMonth(), 1);
    ecSel = localDay(t);
    drawEcMonth();
  };
  drawEcMonth();
}

function drawEcMonth() {
  $("#ec-src").textContent = `(TradingView 캘린더 · ${CAL.econ_updated ? relTime(CAL.econ_updated) + " 갱신" : "미수집"})`;
  const byDay = ecByDay();
  const y = ecMonth.getFullYear(), m = ecMonth.getMonth();
  $("#ec-month").textContent = `${y}. ${String(m + 1).padStart(2, "0")}`;
  const today = localDay(new Date());
  const first = new Date(y, m, 1), startDow = first.getDay();
  const dim = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(new Date(y, m, d));
  while (cells.length % 7) cells.push(null);
  const head = "일월화수목금토".split("").map((w, i) =>
    `<div class="cal-hd${i === 0 ? " sun" : i === 6 ? " sat" : ""}">${w}</div>`).join("");
  const body = cells.map((dt) => {
    if (!dt) return `<div class="cal-cell empty"></div>`;
    const ds = localDay(dt), dow = dt.getDay();
    const items = (byDay[ds] || []).slice().sort((a, b) => b.imp - a.imp || a.tm.localeCompare(b.tm));
    const cls = [ds === today ? "today" : "", ds === ecSel ? "sel" : "", items.length ? "has" : "",
      dow === 0 ? "sun" : dow === 6 ? "sat" : ""].filter(Boolean).join(" ");
    const chips = items.slice(0, 2).map((e) =>
      `<span class="cal-ev${e.imp >= 1 ? " imp" : ""}">${EC_FLAG[e.c] || ""}${ecKo(e.t).slice(0, 8)}</span>`).join("");
    const more = items.length > 2 ? `<span class="cal-ev more">+${items.length - 2}</span>` : "";
    return `<div class="cal-cell ${cls}" data-d="${ds}">
      <span class="cal-cell-d">${dt.getDate()}</span>${items.length ? `<span class="cal-cnt">${items.length}</span>` : ""}
      <div class="cal-evs">${chips}${more}</div></div>`;
  }).join("");
  $("#ec-grid").innerHTML = `<div class="cal-hdrow">${head}</div><div class="cal-cells">${body}</div>`;
  $("#ec-grid").querySelectorAll(".cal-cell[data-d]").forEach((c) =>
    c.onclick = () => { ecSel = c.dataset.d; drawEcMonth(); });
  drawEcDay();
}

function drawEcDay() {
  const host = $("#ec-daylist");
  const items = (ecByDay()[ecSel] || []).slice().sort((a, b) => a.tm.localeCompare(b.tm) || b.imp - a.imp);
  const dt = ecSel ? new Date(ecSel + "T00:00:00") : null;
  const yo = dt ? "일월화수목금토"[dt.getDay()] : "";
  const head = `<div class="cal-date">${ecSel ? ecSel.replace(/-/g, ".") + ` (${yo})` : ""}
    <span class="sub-note">${items.length}건 · 한국시간</span></div>`;
  if (!items.length) { host.innerHTML = head + `<p class="mini-note">이 날짜에 예정된 지표가 없습니다.</p>`; return; }
  const n = (v, u) => v == null ? "-" : `${v}${u && u !== "%" ? " " + u : (u || "")}`;
  host.innerHTML = head + `<table class="ec-table"><tr>
      <th>시각</th><th></th><th>지표</th><th>발표</th><th>예상</th><th>이전</th></tr>` +
    items.map((e) => `<tr class="${e.imp >= 1 ? "imp" : ""}">
      <td>${e.tm}</td><td>${EC_FLAG[e.c] || e.c}</td>
      <td>${e.imp >= 1 ? "⭐ " : ""}${ecKo(e.t)}${e.per ? ` <span class="sub-note">(${e.per})</span>` : ""}</td>
      <td><b>${n(e.a, e.u)}</b></td><td>${n(e.f, e.u)}</td><td>${n(e.p, e.u)}</td></tr>`).join("") + `</table>`;
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

// market_pro.json의 breadth_hist는 날짜축 공유 압축 포맷({t:[…], adr:[…]}) — 1회만 {t,v} 배열로 복원
function unpackBreadth(bh) {
  if (!bh || bh._u) return bh;
  for (const mk of Object.keys(bh)) {
    const h = bh[mk];
    if (!h || !Array.isArray(h.t)) continue;
    const t = h.t, o = {};
    for (const k of Object.keys(h)) {
      if (k === "t") continue;
      o[k] = h[k].map((v, i) => (v == null ? null : { t: t[i], v })).filter(Boolean);
    }
    bh[mk] = o;
  }
  bh._u = true;
  return bh;
}

// 시장 진단 차트 스펙 — k(단일)/ks(복수 시리즈), base=기준선, mk 지정 시 해당 시장만
const INT_CHARTS = [
  { k: "adr", c: "#4391ff", base: 100, t: "ADR (20일 등락비율)",
    n: "100↑ 상승 종목 우위. <b>지수는 오르는데 ADR이 내려가면</b> 소수 주도 장세(경고)" },
  { k: "nhnl", c: "#8e44ad", t: "신고가−신저가 누적 지수",
    n: "우상향=시장 체력 확장. 지수는 신고가인데 이 선이 꺾이면 다이버전스" },
  { ks: ["ma50", "ma200"], cs: ["#f59e0b", "#0891b2"], labs: ["MA50 상회", "MA200 상회"], base: 50,
    t: "MA50/MA200 상회 종목 비율(%)", n: "추세 참여도 — 50% 아래면 절반이 하락추세" },
  { ks: ["hi52", "lo52"], cs: ["#f5445a", "#4391ff"], labs: ["신고가 비율", "신저가 비율"],
    t: "신고가·신저가 비율(%)", n: "<b>둘 다 동시에 높으면 시장 분열</b> — 추세가 갈라지는 위험 구간(Hindenburg류)" },
  { k: "mcc", c: "#0891b2", base: 0, t: "McClellan 오실레이터",
    n: "등락 <b>모멘텀</b>(EMA19−EMA39) — 0선 돌파가 ADR 레벨보다 먼저 전환을 알림" },
  { k: "ddmed", c: "#e11d48", base: 0, t: "52주 고점 대비 낙폭 중앙값(%)",
    n: "<b>체감 하락률</b> — 지수가 아니라 '중간 종목'이 고점에서 얼마나 빠졌는지" },
  { k: "corr60", c: "#7c3aed", t: "종목 간 평균 상관계수(60일)",
    n: "급등=동조화(시스템 리스크·패닉), 하락=종목 선별 장세. <span class='sub-note'>변동성 가중 평균</span>" },
  { k: "rv20", c: "#f59e0b", t: "지수 실현변동성(20일, 연율 %)",
    n: "변동성 체제 — 급등 구간에선 원칙 신호보다 리스크 관리 우선" },
  { k: "ewcw", c: "#22c07a", base: 0, t: "동일가중 − 시총가중 60일 수익률차(%p)",
    n: "양수=상승이 <b>폭넓게 확산</b>, 음수=<b>대형주 쏠림</b>(지수만 오르는 장세)" },
  { k: "conc10", c: "#ea580c", t: "거래대금 상위 10종목 집중도(%)",
    n: "유동성 쏠림 — 높을수록 소수 종목에 자금이 몰림(순환매 약화)" },
  { ks: ["frgn20", "inst20"], cs: ["#4391ff", "#ea580c"], labs: ["외국인", "기관"], base: 0, mk: "kr",
    t: "외국인·기관 20일 누적 순매수(억원)",
    n: "수급 주체 방향. <span class='sub-note'>네이버 수급 데이터 · 노트북 배치라 갱신 주기가 김</span>" },
  { curve: true, c: "#0f766e", base: 0, mk: "kr", t: "국고채 장단기 스프레드(10Y−2Y, %p)",
    n: "<b>음수=장단기 역전</b>(경기 침체 선행 신호). <span class='sub-note'>토스 국고채 캔들 API — 2020년~ 일봉 이력</span>" },
];

function renderInternals() {
  if (!MPRO) { $("#int-context").textContent = "market_pro.json 없음 — python analysis\\market_pro.py 실행 필요"; return; }
  unpackBreadth(MPRO.breadth_hist);
  internalsRendered = true;

  if (MPRO.brief) {
    $("#int-brief").style.display = "";
    $("#int-brief").innerHTML = `<h3>🤖 AI 마켓 브리핑 <span class="sub-note">(${MPRO.brief_at || MPRO.generated} · Gemini · 하루 3회)</span></h3>
      <p>${MPRO.brief.replace(/\n/g, "<br>")}</p>`;
  }
  $("#int-context").innerHTML =
    `시장 내부(internals) — 지수가 아니라 <b>구성 종목 전체의 체력</b>을 봅니다.
     지표 갱신 ${MPRO.generated} (${relTime(MPRO.generated)} · <b>클라우드 30분 주기</b>)`;

  const r = MPRO.risk || {};
  const scoreColor = r.score >= 60 ? "#22c07a" : r.score <= 40 ? "#f5445a" : "#f59e0b";
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
  $("#int-range").querySelectorAll("button").forEach((b) => b.onclick = () => {
    intRange = +b.dataset.r;
    $("#int-range").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
    drawInternals();
  });
  drawInternals();
}

// 시장 진단 차트 표시 기간(년) — 데이터는 5년 보관, 1/3/5년 확대만 조절
let intRange = 5;
function intSlice(arr) {
  if (!arr?.length) return arr || [];
  const d = new Date();
  d.setFullYear(d.getFullYear() - intRange);
  const cut = d.toISOString().slice(0, 10);
  const out = arr.filter((p) => p.t >= cut);
  return out.length > 1 ? out : arr;
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
  // ── 신규 지표 판정 ─────────────────────────────────────────────
  const dd = last(h.ddmed), cor = last(h.corr60), ew = last(h.ewcw);
  const hiR = last(h.hi52), loR = last(h.lo52);
  // 집중도는 시장별 구조적 수준이 달라 절대값 대신 자기 이력(최근 1년) 백분위로 판정
  const pct1y = (arr, v) => {
    const w = (arr || []).slice(-250).map((p) => p.v);
    return w.length < 30 || v == null ? null : w.filter((x) => x <= v).length / w.length * 100;
  };
  const conc = last(h.conc10), concP = pct1y(h.conc10, conc);
  if (dd != null) {
    const st = dd >= -10 ? "good" : dd >= -20 ? "warn" : "bad";
    cards.push(["52주 고점 대비 낙폭(중앙값)", dd.toFixed(0) + "%", st,
      dd >= -10 ? "대다수 종목이 고점 부근" : dd >= -20 ? "평균적 조정 국면" : "체감상 이미 하락장 — 지수보다 개별 종목 피해 큼",
      "0%=고점"]);
  }
  if (cor != null) {
    const st = cor <= 0.3 ? "good" : cor <= 0.5 ? "warn" : "bad";
    cards.push(["종목 간 평균 상관", cor.toFixed(2), st,
      cor <= 0.3 ? "종목별로 따로 움직임 — 선별 효과 큼" : cor <= 0.5 ? "동조화 진행 중"
        : "전 종목 동반 등락 — 분산 효과 소멸(시스템 리스크)", "낮을수록 좋음"]);
  }
  if (ew != null) {
    const st = ew > 0 ? "good" : ew > -5 ? "warn" : "bad";
    cards.push(["동일가중 − 시총가중(60일)", (ew > 0 ? "+" : "") + ew.toFixed(1) + "%p", st,
      ew > 0 ? "상승이 폭넓게 확산" : ew > -5 ? "대형주가 소폭 우위" : "지수만 오르는 대형주 쏠림 장세", "0=중립"]);
  }
  if (concP != null) {
    const st = concP <= 60 ? "good" : concP <= 85 ? "warn" : "bad";
    cards.push(["거래대금 상위10 집중도", conc.toFixed(0) + "%", st,
      `최근 1년 중 ${concP.toFixed(0)}번째 백분위 — ` +
      (concP <= 60 ? "유동성 분산 양호" : concP <= 85 ? "쏠림 진행" : "소수 종목 과열"), "1년 백분위 기준"]);
  }
  if (hiR != null && loR != null && hiR >= 2.5 && loR >= 2.5) {
    cards.push(["신고가·신저가 동시 과다", `${hiR.toFixed(1)}% / ${loR.toFixed(1)}%`, "bad",
      "시장이 두 방향으로 갈라짐 — 추세 신뢰도 하락(Hindenburg류 경고)", "둘 다 2.5%↑면 경고"]);
  }

  // 카드 수가 4개→최대 9개로 늘어 절대 개수 대신 비율로 판정
  const nBad = cards.filter((c) => c[2] === "bad").length;
  const nGood = cards.filter((c) => c[2] === "good").length;
  const risk = MPRO.risk?.score;
  let emoji, verdict;
  if (nBad >= Math.max(2, cards.length * 0.4)) {
    emoji = "⚠️";
    verdict = `<b>시장 내부 체력이 약합니다.</b> 지수 방향과 별개로 다수 종목이 하락 추세 — 신규 진입은 보수적으로, 매수 원칙은 종목별 신호 확인 후.`;
  } else if (nGood >= cards.length * 0.6) {
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
    <p class="sub-note" style="margin-top:8px">판정 기준은 카드에 표기 — 룰 기반 자동 판정(참고용, 매수·매도 지시 아님) · 상세 추이는 아래 5년 차트(1년 이전 구간은 주 1회 표본)</p>`;
}

function drawInternals() {
  intCharts.forEach((c) => c.remove());
  intCharts = [];
  const mk = $("#int-mk").value;
  renderIntVerdict(mk);
  const h = MPRO.breadth_hist?.[mk];
  if (!h) return;
  const host = $("#int-charts");
  const specs = INT_CHARTS.filter((s) => !s.mk || s.mk === mk);
  host.innerHTML = specs.map((s, i) => `
    <div class="int-card">
      <h3>${s.t}</h3>
      <p class="int-note">${s.n}</p>
      <div class="int-chart" id="intc-${i}"></div>
      ${s.labs ? `<div class="int-legend">${s.labs.map((l, j) =>
        `<span style="color:${s.cs[j]}">━</span> ${l}`).join(" · ")}</div>` : ""}
    </div>`).join("");

  specs.forEach((s, i) => {
    const sel = `#intc-${i}`;
    const sets = s.curve ? [intSlice(intCurveSpread())] : (s.ks || [s.k]).map((k) => intSlice(h[k]));
    if (!sets.some((a) => a && a.length > 1)) {
      $(sel).outerHTML = `<p class="int-empty">${s.curve
        ? `적재 중 — 아직 ${sets[0]?.length || 0}일치 (매일 1점씩 쌓임)`
        : "데이터 없음(다음 갱신 후 표시)"}</p>`;
      return;
    }
    if (sets.length === 1) { lineChart(sel, sets[0], s.c, s.base ?? null); return; }
    const el = $(sel); el.innerHTML = "";
    const c = LightweightCharts.createChart(el, baseChartOpts(el, el.clientHeight || 170));
    sets.forEach((data, j) => {
      const ser = c.addLineSeries({ color: s.cs[j], lineWidth: 2, priceLineVisible: false, title: s.labs[j] });
      ser.setData((data || []).map((p) => ({ time: p.t, value: p.v })));
      if (j === 0 && s.base != null)
        ser.createPriceLine({ price: s.base, color: "#9ca3af", lineWidth: 1, lineStyle: 2 });
    });
    c.timeScale().fitContent();
    intCharts.push(c);
  });
}

// 국고채 10Y−2Y 스프레드 시계열 (toss_market.json curve_hist — 매일 1점씩 적재, 소급 백필 불가)
function intCurveSpread() {
  return (TOSSM?.curve_hist || [])
    .filter((r) => r && r["10_2"] != null)
    .map((r) => ({ t: r.t, v: r["10_2"] }));
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
       <th>RS 1주</th><th>RS 1개월</th><th>RS 3개월</th><th>오늘 상승</th><th>20일선 위</th><th>52주 신고</th></tr>
     <tr style="font-weight:700"><td>시장 전체</td>${rsCell(m.w1)}${rsCell(m.m1)}${rsCell(m.m3)}<td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td></tr>` +
    rot.sectors.map((s) => {
      const part = (v, warnLow) => v == null ? "<td>-</td>" :
        `<td class="${v >= 60 ? "pos" : v < (warnLow ?? 30) ? "neg" : ""}">${v}%</td>`;
      return `<tr class="rot-row" data-sector="${s.sector}" title="클릭 = 소속 종목·최신 기사 보기">
      <td>▸ ${s.sector} <span class="sub-note">(${s.n})</span></td>
      ${rsCell(s.w1)}${rsCell(s.m1)}${rsCell(s.m3)}${rsCell(s.rs_w1)}${rsCell(s.rs_m1)}${rsCell(s.rs_m3)}
      ${part(s.up)}${part(s.ma20)}<td>${s.hi52 ?? "-"}</td>
    </tr>`;}).join("");
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
  ${(() => {
    const arts = SECNEWS?.[mk]?.[sector];
    if (!arts?.length) return "";
    return `<div class="perf-h" style="margin-top:10px">📰 ${sector} 최신 기사 <span class="sub-note">(구글뉴스 · 하루 1회 수집)</span></div>` +
      arts.map((n) => `<div class="lk-feed-row"><span class="lk-feed-date">${n.t}</span>
        <a href="${n.link}" target="_blank" rel="noopener">${n.title}</a>
        ${n.src ? `<span class="sub-note">${n.src}</span>` : ""}</div>`).join("");
  })()}
  <p class="sub-note" style="margin:6px 0 2px">시총순 · 등락=당일 · 클릭 = 종목 조회로 이동 (분석 유니버스 내 종목만 표시)</p></td>`;
  tr.after(row);
  row.querySelectorAll(".rot-mem").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    gotoTabFull("lookup");
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
    gotoTabFull("value");
    if (!valRendered) initValue();
    $("#val-q").value = st.market === "kr" ? `${st.name} (${st.ticker})` : st.ticker;
    loadValue(`${st.market}_${st.ticker}`, st.name);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
  line("fc", "#4391ff");   // 외국인 누적 (좌축)
  line("ic", "#f59e0b");   // 기관 누적 (좌축)
  const fr = line("fr", "#22c07a", "right");  // 외국인 보유율 (우축)
  lookupSupply.priceScale("right").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
  // 0선
  lookupSupply.addLineSeries({ color: "#9ca3af", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false })
    .setData(sup.map((x) => ({ time: x.t, value: 0 })));
  lookupSupply.timeScale().fitContent();
  $("#lookup-supply-legend").innerHTML =
    `─ <span style="color:#4391ff">외국인 누적 순매수</span> · <span style="color:#f59e0b">기관 누적 순매수</span> (좌축, 억원) ·
     <span style="color:#22c07a">외국인 보유율</span> (우축, %) · 출처: 네이버(순매매량×종가 추정)`;
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
  const s = st.series || [];
  const barLast = s[s.length - 1]?.c;
  if (q) {
    // 헤더 시세(30분 갱신)와 차트 마지막 봉(stocks/*.json, 노트북 배치)이 어긋나면 반드시 표시.
    // 2026-07-23 실사고: 헤더 260,500원인데 차트 끝은 243,000원(7/20)이었음 — 같은 화면 다른 숫자.
    const gap = barLast != null && barLast > 0 ? Math.abs(q[0] / barLast - 1) : 0;
    // 같은 날짜인데 장 마감 후 차이 = 시간외 거래(특히 미국 애프터마켓) — 지연이 아니라 정상
    const clk = marketClock(st.market);
    const afterHours = s[s.length - 1]?.t === clk.day && clk.hm > (st.market === "us" ? "16:00" : "15:30");
    const warn = gap <= 0.005 ? ""
      : afterHours
        ? ` <span class="sub-note">(시세엔 시간외 거래 반영 · 차트는 정규장 종가)</span>`
        : ` <span class="lk-stale">⚠ 차트는 ${st.asof} 종가까지 — 시세와 ${pct(q[0] / barLast - 1, 1)} 차이</span>`;
    return { cur: q[0], chg: q[1], src: `${relTime(MARKET.generated)} 시세 (히트맵과 동일 · 30분 갱신)${warn}` };
  }
  const prev = s[s.length - 2]?.c;
  return { cur: barLast, chg: barLast != null && prev ? barLast / prev - 1 : null, src: `종가 기준 ${st.asof}` };
}

// 헤더: 로고 + 종목명 + 현재가/등락
function renderLookupHead(st) {
  const host = $("#lookup-head");
  host.style.display = "";
  const co = EXTRAS.company?.map?.[`${st.market}_${st.ticker}`] || {};
  const { cur, chg, src } = freshQuote(st);
  const up = (chg ?? 0) >= 0;
  const col = chg == null ? "" : (up ? "#f5445a" : "#4391ff");  // 한국식: 상승=빨강 / 하락=파랑, 주가·변동% 함께 색칠
  const shortBadge = st.short_history ? `<span class="lk-short-badge">이력 부족 · 원칙 검증 제외</span>` : "";
  host.innerHTML = `
    <img class="lk-logo" src="${logoUrl(st.market, st.ticker)}" alt="" onerror="this.style.display='none'">
    <div class="lk-title">
      <div class="lk-name">${st.name}<span class="sub-note"> ${st.ticker} · ${st.market === "kr" ? "KRX" : "US"}</span>${shortBadge}</div>
      <div class="lk-price"><span${col ? ` style="color:${col}"` : ""}>${fmtPrice(cur, st.market)}${chg != null ? ` ${up ? "▲" : "▼"} ${pct(chg, 2)}` : ""}</span>
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
  // 사업구조: 개요 불릿(1행=회사, 2행~=사업/전략) 분리 서술
  const biz = co.biz_lines?.length > 1 ? co.biz_lines.slice(1) : null;
  const intro = co.biz_lines?.length ? co.biz_lines[0] : co.overview;
  // 매출구성 바
  let mixHtml = "";
  if (co.sales_mix?.length) {
    const max = Math.max(...co.sales_mix.map((x) => x.pct), 1);
    mixHtml = `<div class="ov-sec"><b>📊 매출 구성</b><div class="mix-bars">` +
      co.sales_mix.map((x) => `<div class="mix-row"><span class="mix-name">${x.name}</span>
        <span class="mix-track"><span class="mix-fill" style="width:${x.pct / max * 100}%"></span></span>
        <b>${x.pct.toFixed(1)}%</b></div>`).join("") + `</div></div>`;
  }
  // 주주구성
  let shHtml = "";
  if (co.holders?.length || co.holders_pct || co.minor_pct != null) {
    const rows = (co.holders || []).map((x) => `<div class="mix-row"><span class="mix-name">${x.name}
        <span class="sub-note">${x.rel || ""}</span></span>
        <span class="mix-track"><span class="mix-fill sh" style="width:${Math.min(100, x.pct)}%"></span></span>
        <b>${x.pct}%</b></div>`).join("");
    const extra = co.minor_pct != null ? `<p class="sub-note" style="margin-top:4px">소액주주 지분 ${co.minor_pct}% (사업보고서 기준)</p>`
      : co.holders_pct ? `<p class="sub-note" style="margin-top:4px">내부자 ${co.holders_pct.insider}% · 기관 ${co.holders_pct.inst}% 보유</p>` : "";
    shHtml = `<div class="ov-sec"><b>👥 주주 구성</b><div class="mix-bars">${rows}</div>${extra}</div>`;
  }
  host.innerHTML = `<h3 class="lk-h3">🏢 기업 개요 ${ind ? `<span class="badge dim">${ind}</span>` : ""}
      ${co.website ? `<a class="ext-link" href="${co.website}" target="_blank" rel="noopener">홈페이지 ↗</a>` : ""}</h3>
    <div class="ov-sec"><b>무엇을 하는 회사인가</b><p class="lk-ov-text">${intro}</p></div>
    ${biz ? `<div class="ov-sec"><b>🧩 사업 구조·전략</b><ul class="ov-biz">${biz.map((x) => `<li>${x}</li>`).join("")}</ul></div>` : ""}
    ${mixHtml}${shHtml}
    <p class="sub-note">출처: ${st.market === "kr" ? "와이즈리포트(개요·매출구성) · DART 사업보고서(주주)" : "Yahoo Finance"} · 주 1회 갱신 · 매출구성·지분율은 최근 보고서 기준</p>`;
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
    ${renderConsAnalyst(st, co, cur)}
    <p class="sub-note" style="margin-top:6px">컨센서스는 증권사 추정 평균 — 매수·매도 판단이 아닌 참고 지표</p>`;
}

// 애널리스트 심화(미국): 목표가 최고/평균/최저 + 매수/중립/매도 의견 분포
function renderConsAnalyst(st, co, cur) {
  const a = co?.analyst;
  if (!a) return "";
  let html = "";
  if (a.targetHigh != null && a.targetLow != null) {
    const pu = (v) => (cur ? pct(v / cur - 1, 1) : "");
    html += `<div class="an-tgt">
      <div><span class="sub-note">최저</span><b class="neg">${fmtPrice(a.targetLow, st.market)}</b><span class="sub-note">${pu(a.targetLow)}</span></div>
      <div><span class="sub-note">평균</span><b>${fmtPrice(a.targetMean, st.market)}</b><span class="sub-note">${pu(a.targetMean)}</span></div>
      <div><span class="sub-note">최고</span><b class="pos">${fmtPrice(a.targetHigh, st.market)}</b><span class="sub-note">${pu(a.targetHigh)}</span></div>
    </div>`;
  }
  const op = a.opinion;
  if (op) {
    const cats = [["strongBuy", "적극매수", "#f5445a"], ["buy", "매수", "#e0575c"],
                  ["hold", "중립", "#9aa4b2"], ["sell", "매도", "#5b8def"], ["strongSell", "적극매도", "#4391ff"]];
    const total = cats.reduce((s, [k]) => s + (op[k] || 0), 0) || 1;
    const bars = cats.map(([k, lab, c]) => {
      const v = op[k] || 0, h = Math.max(3, v / total * 60);
      return `<div class="an-bar"><span class="an-n">${v}</span>
        <span class="an-fill" style="height:${h}px;background:${c}"></span><span class="an-lab">${lab}</span></div>`;
    }).join("");
    const buys = (op.strongBuy || 0) + (op.buy || 0);
    html += `<div class="an-dist-h sub-note">애널리스트 ${total}명 중 <b class="pos">${buys}명</b>이 매수 의견</div>
      <div class="an-dist">${bars}</div>`;
  }
  return html;
}

// 투자 지표 카드 (가치평가·수익·배당) + 재무(부채·유동·이자보상) + 시총·EV
// 통합 투자 지표 카드 — company.metrics(주1 최신) 우선 + FUND(fundamentals.json) 폴백·보강
// (구 "재무 스냅샷" 카드 흡수: 선행PER·영업/순이익률·매출성장·베타·52주 위치)
function renderLookupMetrics(st) {
  const host = $("#lookup-metrics");
  const key = `${st.market}_${st.ticker}`;
  const co = EXTRAS.company?.map?.[key] || {};
  const m = co.metrics || {};
  const f = FUND?.map?.[key] || {};
  if (!co.metrics && !Object.keys(f).length) { host.style.display = "none"; return; }
  host.style.display = "";
  const kr = st.market === "kr";
  const { cur } = freshQuote(st);
  const dps = m.dps ?? co.dividend?.dps;
  const yld = dps && cur ? dps / cur * 100 : (f.div_yield ?? null);
  const payout = m.payout ?? co.dividend?.payout;
  const mult = (v) => (v == null ? "-" : v.toFixed(1) + "배");
  const pctv = (v, warn) => (v == null ? "-" : `<span class="${warn && v >= 200 ? "neg" : ""}">${v.toLocaleString(undefined, { maximumFractionDigits: v >= 1000 ? 0 : 1 })}%</span>`);
  const pcts = (v) => (v == null ? "-" : `<span class="${v >= 0 ? "pos" : "neg"}">${v >= 0 ? "+" : ""}${v.toFixed(1)}%</span>`);
  const money = (v) => (v == null ? "-" : kr ? Math.round(v).toLocaleString() + "원" : "$" + v.toFixed(2));
  const box = (title, rows) => {
    const body = rows.filter(Boolean).map(([k, v]) => `<div class="lk-mrow"><span>${k}</span><b>${v}</b></div>`).join("");
    return body ? `<div class="lk-mbox"><div class="lk-mbox-h">${title}</div>${body}</div>` : "";
  };

  // 상단 캡슐: 시총 · EV · 52주 위치 · 베타
  const pos52 = f.hi52 != null && f.lo52 != null && cur != null && f.hi52 > f.lo52
    ? Math.max(0, Math.min(100, (cur - f.lo52) / (f.hi52 - f.lo52) * 100)) : null;
  const caps = [
    f.mcap != null && `<div><span class="sub-note">시가총액</span><b>${fmtMcap(f.mcap, st.market)}</b></div>`,
    m.ev != null && `<div><span class="sub-note">실제 기업가치(EV)</span><b>${fmtMcap(m.ev, "us")}</b></div>`,
    pos52 != null && `<div><span class="sub-note">52주 위치 <span style="font-weight:400">(저가0~고가100)</span></span>
      <b>${pos52.toFixed(0)}%</b><div class="lk-52bar"><i style="left:${pos52.toFixed(0)}%"></i></div></div>`,
    f.beta != null && `<div><span class="sub-note">베타 (시장 민감도)</span><b>${f.beta.toFixed(2)}</b></div>`,
  ].filter(Boolean);
  const capRow = caps.length ? `<div class="lk-cap">${caps.join("")}</div>` : "";

  const valBox = box("가치평가", [
    ["PER", mult(m.per ?? f.per)],
    f.per_fwd != null && ["선행 PER", mult(f.per_fwd)],
    m.psr != null && ["PSR", mult(m.psr)],
    ["PBR", mult(m.pbr ?? f.pbr)],
  ]);
  const earnBox = box("수익성", [
    m.eps != null && ["EPS", money(m.eps)],
    m.bps != null && ["BPS", money(m.bps)],
    ["ROE", pctv(m.roe ?? f.roe)],
    f.op_margin != null && ["영업이익률", pctv(f.op_margin)],
    f.profit_margin != null && ["순이익률", pctv(f.profit_margin)],
  ]);
  const growDivBox = box("성장·배당", [
    f.rev_growth != null && ["매출 성장률", pcts(f.rev_growth)],
    dps != null && ["주당배당금", money(dps)],
    yld != null && ["배당수익률", "연 " + yld.toFixed(2) + "%"],
    payout != null && ["배당성향", pctv(payout)],
  ]);
  const dRatio = m.debtRatio ?? co.stability_q?.[co.stability_q.length - 1]?.debtRatio ?? co.fin_ext?.[co.fin_ext.length - 1]?.debt;
  const liqVal = m.currentRatio != null ? m.currentRatio : m.quickRatio;
  const stabBox = box("재무 안정성", [
    dRatio != null && ["부채비율", pctv(dRatio, true)],
    liqVal != null && [m.currentRatio != null ? "유동비율" : "당좌비율", pctv(liqVal)],
    m.interestCoverage != null && ["이자보상비율", pctv(m.interestCoverage)],
  ]);

  host.innerHTML = `<div class="fund-head">투자 지표 <span class="sub-note">(주 1회 갱신 · ${kr ? "네이버" : "Yahoo"} 집계${kr ? " · PSR·EV·이자보상은 미국 종목만" : ""})</span></div>
    ${capRow}
    <div class="lk-mgrid four">${valBox}${earnBox}${growDivBox}${stabBox}</div>
    <p class="sub-note" style="margin-top:8px">부채비율=총부채/자기자본(한국식) · 200%↑ 빨간색 표시 · 컨센서스·실적 상세는 아래 카드 참고</p>`;
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
      bars += `<rect x="${cx + 2}" y="${r.op >= 0 ? y : y0}" width="${bw}" height="${Math.max(1, Math.abs(y0 - (r.op >= 0 ? y : y2)))}" fill="${r.op >= 0 ? (r.est ? "#f6c8ad" : "#f0955a") : "#f5445a"}" rx="2"/>
        <text x="${cx + bw / 2 + 2}" y="${(r.op >= 0 ? y : y2) - 4}" font-size="9" text-anchor="middle" fill="#92400e">${finFmt(r.op, co.fin_unit)}</text>`;
    }
    if (r.opm != null) pts.push([cx, opmY(r.opm), r.opm]);
    labels += `<text x="${cx}" y="${H - 14}" font-size="10" text-anchor="middle" fill="#6b7280">${r.y}${r.est ? "(E)" : ""}</text>`;
  });
  if (pts.length > 1) {
    line = `<polyline points="${pts.map((p) => p[0] + "," + p[1]).join(" ")}" fill="none" stroke="#22c07a" stroke-width="2"/>` +
      pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="#22c07a"/>
        <text x="${p[0]}" y="${p[1] + (i % 2 ? 14 : -6)}" font-size="9" text-anchor="middle" fill="#15803d">${p[2].toFixed(1)}%</text>`).join("");
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
      <span style="color:#f0955a">■</span> 영업이익 · <span style="color:#22c07a">●─</span> 영업이익률(%)
      · 옅은색 = 추정치</p>
    ${extTable}`;
}

// 분기 실적 추이: 매출·순이익 막대 + 순이익률 라인 + 성장률 표 (수익성/성장성)
function renderLookupFinQ(st) {
  const host = $("#lookup-finq");
  const co = EXTRAS.company?.map?.[`${st.market}_${st.ticker}`];
  const fq = co?.fin_q;
  if (!fq || fq.length < 2) { host.style.display = "none"; return; }
  host.style.display = "";
  const unit = co.fin_unit;
  const W = 660, H = 244, padL = 8, padB = 34, padT = 40;
  const n = fq.length, gw = (W - padL * 2) / n;
  const maxV = Math.max(...fq.map((r) => Math.max(r.rev || 0, r.np || 0)), 1);
  const minV = Math.min(0, ...fq.map((r) => r.np ?? 0));
  const y0 = padT + (H - padT - padB) * (maxV / (maxV - minV));
  const yS = (v) => padT + (maxV - v) / (maxV - minV) * (H - padT - padB);
  const npms = fq.filter((r) => r.npm != null).map((r) => r.npm);
  const npmMin = Math.min(...npms, 0), npmMax = Math.max(...npms, 1);
  const npmY = (v) => padT + 2 + (npmMax - v) / (npmMax - npmMin || 1) * 50;
  let bars = "", labels = "";
  const pts = [];
  fq.forEach((r, i) => {
    const cx = padL + gw * i + gw / 2, bw = Math.min(22, gw / 3);
    if (r.rev != null) {
      const y = yS(Math.max(0, r.rev));
      bars += `<rect x="${cx - bw - 1}" y="${y}" width="${bw}" height="${Math.max(1, y0 - y)}" fill="${r.est ? "#c7d7f5" : "#7ba6e8"}" rx="1.5"/>
        <text x="${cx - bw / 2 - 1}" y="${y - (i % 2 ? 13 : 4)}" font-size="8.5" text-anchor="middle" fill="#3b5e93">${finFmt(r.rev, unit)}</text>`;
    }
    if (r.np != null) {
      const y = yS(Math.max(0, r.np)), y2 = yS(Math.min(0, r.np));
      const topY = r.np >= 0 ? y : y2;
      bars += `<rect x="${cx + 1}" y="${r.np >= 0 ? y : y0}" width="${bw}" height="${Math.max(1, Math.abs(y0 - (r.np >= 0 ? y : y2)))}" fill="${r.np >= 0 ? (r.est ? "#b9c6dd" : "#3f6fb5") : "#f5445a"}" rx="1.5"/>
        <text x="${cx + bw / 2 + 1}" y="${r.np >= 0 ? topY - (i % 2 ? 4 : 13) : topY + 11}" font-size="8.5" text-anchor="middle" fill="${r.np >= 0 ? "#274e86" : "#b91c1c"}">${finFmt(r.np, unit)}</text>`;
    }
    if (r.npm != null) pts.push([cx, npmY(r.npm), r.npm]);
    labels += `<text x="${cx}" y="${H - 14}" font-size="9" text-anchor="middle" fill="#6b7280">${r.q}${r.est ? "(E)" : ""}</text>`;
  });
  let line = "";
  if (pts.length > 1) {
    line = `<polyline points="${pts.map((p) => p[0] + "," + p[1]).join(" ")}" fill="none" stroke="#e0912f" stroke-width="2"/>` +
      pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.3" fill="#e0912f"/>
        <text x="${p[0]}" y="${p[1] + (i % 2 ? 13 : -6)}" font-size="8.5" text-anchor="middle" fill="#b56a10">${p[2].toFixed(1)}%</text>`).join("");
  }
  // 성장률(직전 분기 대비) 계산
  const grow = (arr, i, key) => {
    if (i === 0) return null;
    const c = arr[i][key], p = arr[i - 1][key];
    return c != null && p ? (c - p) / Math.abs(p) * 100 : null;
  };
  const fmtN = (v) => (v == null ? "-" : finFmt(v, unit));
  const fmtPct = (v) => (v == null ? "-" : `<span class="${v >= 0 ? "pos" : "neg"}">${v >= 0 ? "+" : ""}${v.toFixed(2)}%</span>`);
  const ROWS = [
    ["매출", (r) => fmtN(r.rev)],
    ["영업이익", (r) => fmtN(r.op)],
    ["순이익", (r) => fmtN(r.np)],
    ["영업이익률", (r) => (r.opm == null ? "-" : r.opm.toFixed(1) + "%")],
    ["순이익률", (r) => (r.npm == null ? "-" : r.npm.toFixed(1) + "%")],
    ["순이익 성장률", (r, i) => fmtPct(grow(fq, i, "np"))],
  ];
  const table = `<div class="tablewrap" style="margin-top:8px"><table class="fin-ext">
    <tr><th></th>${fq.map((r) => `<th>${r.q}${r.est ? "(E)" : ""}</th>`).join("")}</tr>
    ${ROWS.map(([nm, f]) => `<tr><td>${nm}</td>${fq.map((r, i) => `<td>${f(r, i)}</td>`).join("")}</tr>`).join("")}
  </table></div>`;

  host.innerHTML = `<h3 class="lk-h3">📈 분기 실적 추이 <span class="sub-note">(단위 ${unit === "억원" ? "조/억원" : "USD"} · 성장률=직전 분기 대비 · (E)=추정)</span></h3>
    <svg viewBox="0 0 ${W} ${H}" class="fin-svg">
      <line x1="${padL}" y1="${y0}" x2="${W - padL}" y2="${y0}" stroke="#e5e7eb"/>${bars}${line}${labels}</svg>
    <p class="legend" style="margin-top:2px"><span style="color:#7ba6e8">■</span> 매출 ·
      <span style="color:#3f6fb5">■</span> 순이익 · <span style="color:#e0912f">●─</span> 순이익률(%) · 옅은색 = 추정</p>
    ${table}`;
}

// 안정성 분기 추이: 부채비율·유동비율(당좌비율) 라인 (총자본/총부채 있으면 병기)
function renderLookupStability(st) {
  const host = $("#lookup-stability");
  const co = EXTRAS.company?.map?.[`${st.market}_${st.ticker}`];
  const sq = co?.stability_q;
  if (!sq || sq.length < 2) { host.style.display = "none"; return; }
  host.style.display = "";
  const W = 660, H = 300, padL = 34, padT = 24, padB = 34, padR = 10;
  const n = sq.length, gw = (W - padL - padR) / n;
  const series = [["debtRatio", "부채비율", "#e0912f"],
                  [sq.some((r) => r.currentRatio != null) ? "currentRatio" : "quickRatio",
                   sq.some((r) => r.currentRatio != null) ? "유동비율" : "당좌비율", "#3f6fb5"]];
  const allV = sq.flatMap((r) => series.map(([k]) => r[k]).filter((v) => v != null));
  // y축을 데이터 범위에 맞춤(0 강제 포함 제거) — 값이 100% 근처에 몰릴 때 변화가 보이도록 확대
  const rawMax = Math.max(...allV, 1), rawMin = Math.min(...allV, 0);
  const pad = (rawMax - rawMin) * 0.18 || rawMax * 0.1 || 10;
  const maxV = rawMax + pad, minV = Math.max(0, rawMin - pad);
  const yS = (v) => padT + (maxV - v) / (maxV - minV || 1) * (H - padT - padB);
  let lines = "", labels = "", legend = "";
  series.forEach(([k, lab, c], j) => {
    const pts = sq.map((r, i) => (r[k] != null ? [padL + gw * i + gw / 2, yS(r[k]), r[k]] : null)).filter(Boolean);
    if (pts.length > 1) {
      lines += `<polyline points="${pts.map((p) => p[0] + "," + p[1]).join(" ")}" fill="none" stroke="${c}" stroke-width="2"/>` +
        pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.3" fill="${c}"/>
          <text x="${p[0]}" y="${p[1] + (j === 0 ? -(i % 2 ? 14 : 6) : (i % 2 ? 21 : 13))}" font-size="8.5" text-anchor="middle" fill="${c}">${p[2].toFixed(p[2] >= 100 ? 0 : 1)}%</text>`).join("");
      legend += `<span style="color:${c}">●─</span> ${lab} `;
    }
  });
  sq.forEach((r, i) => {
    labels += `<text x="${padL + gw * i + gw / 2}" y="${H - 12}" font-size="9" text-anchor="middle" fill="#6b7280">${r.q}${r.est ? "(E)" : ""}</text>`;
  });
  // y축 눈금 3개 (상·중·하) + 기준선
  const yticks = [maxV, (maxV + minV) / 2, minV].map((v) =>
    `<line x1="${padL}" y1="${yS(v)}" x2="${W - padR}" y2="${yS(v)}" stroke="#eef0f4"/>
     <text x="2" y="${yS(v) + 3}" font-size="8" fill="#9aa4b2">${Math.round(v)}%</text>`).join("");
  host.innerHTML = `<h3 class="lk-h3">🛡️ 재무 안정성 추이 <span class="sub-note">(분기별 · ${st.market === "kr" ? "네이버" : "Yahoo"})</span></h3>
    <svg viewBox="0 0 ${W} ${H}" class="fin-svg">${yticks}${lines}${labels}</svg>
    <p class="legend">${legend}</p>`;
}

// 배당 이력 (미국): 분기 배당금 막대
function renderLookupDividend(st) {
  const host = $("#lookup-dividend");
  const co = EXTRAS.company?.map?.[`${st.market}_${st.ticker}`];
  const h = co?.dividend?.history;
  if (!h || h.length < 2) { host.style.display = "none"; return; }
  host.style.display = "";
  const total = h.reduce((s, x) => s + (x.amt || 0), 0);
  const W = 660, H = 130, padL = 8, padT = 12, padB = 30;
  const n = h.length, gw = (W - padL * 2) / n;
  const maxV = Math.max(...h.map((x) => x.amt || 0), 0.01);
  let bars = "", labels = "";
  h.forEach((x, i) => {
    const cx = padL + gw * i + gw / 2, bw = Math.min(20, gw * 0.5);
    const bh = (x.amt || 0) / maxV * (H - padT - padB);
    bars += `<rect x="${cx - bw / 2}" y="${H - padB - bh}" width="${bw}" height="${Math.max(1, bh)}" fill="#8b5cf6" rx="1.5"/>
      <text x="${cx}" y="${H - padB - bh - 3}" font-size="8" text-anchor="middle" fill="#6b21a8">$${x.amt}</text>`;
    if (i % 2 === 0 || n <= 8) labels += `<text x="${cx}" y="${H - 14}" font-size="8" text-anchor="middle" fill="#6b7280">${x.d.slice(2, 7)}</text>`;
  });
  host.innerHTML = `<h3 class="lk-h3">💰 배당금 지급 이력 <span class="sub-note">(최근 ${n}회 · 주당 총 $${total.toFixed(2)})</span></h3>
    <svg viewBox="0 0 ${W} ${H}" class="fin-svg">${bars}${labels}</svg>`;
}

// 실적 서프라이즈 (미국): EPS 발표치 vs 예상치 + 서프라이즈%
function renderLookupSurprise(st) {
  const host = $("#lookup-surprise");
  const co = EXTRAS.company?.map?.[`${st.market}_${st.ticker}`];
  const eps = co?.surprise?.eps;
  if (!eps || eps.length < 2) { host.style.display = "none"; return; }
  host.style.display = "";
  const W = 660, H = 172, padL = 8, padT = 30, padB = 30;
  const n = eps.length, gw = (W - padL * 2) / n;
  const maxV = Math.max(...eps.flatMap((r) => [r.actual, r.est].filter((v) => v != null)), 0.1);
  const minV = Math.min(0, ...eps.flatMap((r) => [r.actual, r.est]));
  const yS = (v) => padT + (maxV - v) / (maxV - minV) * (H - padT - padB);
  const y0 = yS(0);
  let bars = "", labels = "";
  eps.forEach((r, i) => {
    const cx = padL + gw * i + gw / 2, bw = Math.min(16, gw / 3);
    [["est", "#c4cad6"], ["actual", "#3f6fb5"]].forEach(([k, c], j) => {
      const v = r[k]; if (v == null) return;
      const y = yS(Math.max(0, v)), yn = yS(Math.min(0, v));
      const x = cx + (j === 0 ? -bw - 1 : 1);
      bars += `<rect x="${x}" y="${v >= 0 ? y : y0}" width="${bw}" height="${Math.max(1, Math.abs(y0 - (v >= 0 ? y : yn)))}" fill="${c}" rx="1.5"/>`;
    });
    // 발표치 $값(막대 위) + 서프라이즈 %(상단, pos/neg)
    if (r.actual != null) {
      const ay = yS(Math.max(0, r.actual));
      bars += `<text x="${cx + bw / 2 + 1}" y="${ay - 4}" font-size="8" text-anchor="middle" fill="#274e86">$${r.actual}</text>`;
    }
    if (r.pct != null) {
      bars += `<text x="${cx}" y="${padT - 16}" font-size="9" font-weight="700" text-anchor="middle" fill="${r.pct >= 0 ? "#f5445a" : "#4391ff"}">${r.pct >= 0 ? "+" : ""}${r.pct}%</text>`;
    }
    labels += `<text x="${cx}" y="${H - 14}" font-size="9" text-anchor="middle" fill="#6b7280">${r.q}</text>`;
  });
  const rows = [
    ["발표치", (r) => (r.actual == null ? "-" : "$" + r.actual)],
    ["예상치", (r) => (r.est == null ? "-" : "$" + r.est)],
    ["서프라이즈", (r) => (r.pct == null ? "-" : `<span class="${r.pct >= 0 ? "pos" : "neg"}">${r.pct >= 0 ? "+" : ""}${r.pct}%</span>`)],
  ];
  host.innerHTML = `<h3 class="lk-h3">🎯 실적 서프라이즈 <span class="sub-note">(주당순이익 발표치 vs 애널리스트 예상치 · Yahoo)</span></h3>
    <svg viewBox="0 0 ${W} ${H}" class="fin-svg"><line x1="${padL}" y1="${y0}" x2="${W - padL}" y2="${y0}" stroke="#e5e7eb"/>${bars}${labels}</svg>
    <p class="legend"><span style="color:#c4cad6">■</span> 예상치 · <span style="color:#3f6fb5">■</span> 발표치</p>
    <div class="tablewrap" style="margin-top:6px"><table class="fin-ext">
      <tr><th></th>${eps.map((r) => `<th>${r.q}</th>`).join("")}</tr>
      ${rows.map(([nm, f]) => `<tr><td>${nm}</td>${eps.map((r) => `<td>${f(r)}</td>`).join("")}</tr>`).join("")}
    </table></div>`;
}

// 동종업계 비교. KR=네이버 동일업종(주가·등락·3개월) / US=유니버스 내 동일 산업 시총 상위(PER·시총·주가)
function renderLookupPeers(st) {
  const host = $("#lookup-peers");
  const key = `${st.market}_${st.ticker}`;
  const co = EXTRAS.company?.map?.[key];
  const goto = (mk, tk) => `data-goto="${mk}_${tk}"`;
  if (st.market === "kr") {
    const peers = co?.peers;
    if (!peers?.length) { host.style.display = "none"; return; }
    host.style.display = "";
    const rows = peers.map((p) => `<tr ${goto("kr", p.ticker)}>
      <td class="hld-name"><img class="mv-logo" src="https://ssl.pstatic.net/imgstock/fn/real/logo/stock/Stock${p.ticker}.svg" onerror="this.style.visibility='hidden'">
        <span><b>${p.name}</b> <span class="sub-note">${p.ticker}</span></span></td>
      <td>${p.price != null ? Math.round(p.price).toLocaleString() + "원" : "-"}</td>
      <td class="${(p.chg || 0) >= 0 ? "pos" : "neg"}">${p.chg != null ? (p.chg >= 0 ? "+" : "") + p.chg + "%" : "-"}</td>
      <td class="${(p.ret3m || 0) >= 0 ? "pos" : "neg"}">${p.ret3m != null ? (p.ret3m >= 0 ? "+" : "") + p.ret3m + "%" : "-"}</td></tr>`).join("");
    host.innerHTML = `<h3 class="lk-h3">🏢 동종업계 비교 <span class="sub-note">(네이버 동일업종)</span></h3>
      <div class="tablewrap"><table class="hld-table peer-table">
        <thead><tr><th>종목</th><th>주가</th><th>등락률</th><th>3개월</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  } else {
    const self = FUND?.map?.[key];
    const ind = self?.industry;
    if (!ind || !FUND?.map) { host.style.display = "none"; return; }
    let list = Object.entries(FUND.map).filter(([k, v]) => k.startsWith("us_") && v.industry === ind && v.mcap)
      .map(([k, v]) => ({ ticker: k.slice(3), name: v.name_full || k.slice(3), self: k === key,
        per: v.per, mcap: v.mcap, price: (MARKET?.quotes?.[k] || [])[0] }))
      .sort((a, b) => (b.mcap || 0) - (a.mcap || 0)).slice(0, 6);
    if (list.length < 2) { host.style.display = "none"; return; }
    host.style.display = "";
    const rows = list.map((p) => `<tr class="${p.self ? "peer-self" : ""}" ${p.self ? "" : goto("us", p.ticker)}>
      <td class="hld-name"><b>${p.name}</b> <span class="sub-note">${p.ticker}</span></td>
      <td>${p.per != null ? p.per.toFixed(1) + "배" : "-"}</td>
      <td>${p.mcap != null ? fmtMcap(p.mcap, "us") : "-"}</td>
      <td>${p.price != null ? fmtPrice(p.price, "us") : "-"}</td></tr>`).join("");
    host.innerHTML = `<h3 class="lk-h3">🏢 동종업계 비교 <span class="sub-note">(${ind} · 시총순)</span></h3>
      <div class="tablewrap"><table class="hld-table peer-table">
        <thead><tr><th>종목</th><th>PER</th><th>시가총액</th><th>주가</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  host.querySelectorAll("tr[data-goto]").forEach((tr) => tr.onclick = () => {
    if (!lookupRendered) initLookup();
    loadLookup(tr.dataset.goto);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

// 공시(6개월)·뉴스(1주일) 피드
function renderLookupReports(st) {
  const host = $("#lookup-reports");
  const fd = EXTRAS.feed?.map?.[`${st.market}_${st.ticker}`];
  const reps = fd?.reports || [];
  if (!reps.length) { host.style.display = "none"; return; }
  host.style.display = "";
  const esc = (s) => String(s ?? "").replace(/</g, "&lt;");
  if (st.market === "kr") {
    // 네이버 증권사 리서치 — 제목·미리보기·상세(PDF 다운로드 버튼 포함) 링크
    host.innerHTML = `<h3 class="lk-h3">📑 증권사 리포트 <span class="sub-note">(네이버 리서치 · 최신순)</span></h3>
      <div class="lk-reports">` + reps.map((r) => `<a class="lk-rep" href="${r.link}" target="_blank" rel="noopener">
        <div class="lk-rep-top"><span class="lk-rep-broker">${esc(r.broker)}</span><span class="lk-rep-date">${esc(r.d)}</span></div>
        <div class="lk-rep-title">${esc(r.title)}</div>
        ${r.preview ? `<div class="lk-rep-prev">${esc(r.preview)}</div>` : ""}</a>`).join("") + `</div>
      <p class="sub-note" style="margin:6px 0 0">클릭 시 네이버 리서치 상세(원문 PDF 다운로드 가능)로 이동</p>`;
  } else {
    // 미국 — 애널리스트 등급변경(증권사·등급·목표가 변화)
    host.innerHTML = `<h3 class="lk-h3">📑 애널리스트 등급 변경 <span class="sub-note">(최근 6건 · yfinance)</span></h3>
      <div class="lk-reports us">` + reps.map((r) => `<div class="lk-rep static">
        <div class="lk-rep-top"><span class="lk-rep-broker">${esc(r.broker)}</span><span class="lk-rep-date">${esc(r.d)}</span></div>
        <div class="lk-rep-title">${esc(r.grade)}${r.action ? ` <span class="lk-rep-act">${esc(r.action)}</span>` : ""}${r.target ? ` · ${esc(r.target)}` : ""}</div>
      </div>`).join("") + `</div>
      <p class="sub-note" style="margin:6px 0 0">미국 리서치 원문은 대부분 유료 — 공개된 등급·목표가 변경 이력으로 대체</p>`;
  }
}

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

function fmtMcap(v, mk) {
  if (mk === "kr") return v >= 1e12 ? (v / 1e12).toFixed(1) + "조원" : (v / 1e8).toFixed(0) + "억원";
  return v >= 1e12 ? "$" + (v / 1e12).toFixed(2) + "T" : "$" + (v / 1e9).toFixed(0) + "B";
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


/* ---------- 투자대가 보유 종합 (13F 종목 기준 집계) ---------- */
// 13F 이슈어명 → 유니버스 티커 (시총·로고·조회 연동용 — 미포함 종목은 텍스트만)
const ISSUER_TICKER = {
  "APPLE INC": "AAPL", "AMAZON COM INC": "AMZN", "ALPHABET INC": "GOOGL", "MICROSOFT CORP": "MSFT",
  "NVIDIA CORP": "NVDA", "NVIDIA CORPORATION": "NVDA", "META PLATFORMS INC": "META", "TESLA INC": "TSLA",
  "TAIWAN SEMICONDUCTOR MANUFAC": "TSM", "BERKSHIRE HATHAWAY INC": "BRK-B", "OCCIDENTAL PETE CORP": "OXY",
  "COCA COLA CO": "KO", "COCA-COLA CO": "KO", "BANK AMER CORP": "BAC", "BANK OF AMERICA CORP": "BAC",
  "AMERICAN EXPRESS CO": "AXP", "CHEVRON CORP NEW": "CVX", "CHEVRON CORP": "CVX", "MOODYS CORP": "MCO",
  "KRAFT HEINZ CO": "KHC", "BROADCOM INC": "AVGO", "ADVANCED MICRO DEVICES INC": "AMD",
  "MICRON TECHNOLOGY INC": "MU", "INTEL CORP": "INTC", "QUALCOMM INC": "QCOM", "NETFLIX INC": "NFLX",
  "WALMART INC": "WMT", "JPMORGAN CHASE & CO": "JPM", "UNITEDHEALTH GROUP INC": "UNH",
  "ELI LILLY & CO": "LLY", "EXXON MOBIL CORP": "XOM", "JOHNSON & JOHNSON": "JNJ", "VISA INC": "V",
  "MASTERCARD INC": "MA", "PALANTIR TECHNOLOGIES INC": "PLTR", "COINBASE GLOBAL INC": "COIN",
  "UBER TECHNOLOGIES INC": "UBER", "SALESFORCE INC": "CRM", "ORACLE CORP": "ORCL", "ADOBE INC": "ADBE",
};
const GURU_SHORT = { "워런 버핏": "버핏", "하워드 막스": "막스", "빌 애크먼": "애크먼", "마이클 버리": "버리",
  "스탠리 드러켄밀러": "드러켄밀러", "데이비드 테퍼": "테퍼", "레이 달리오": "달리오", "세스 클라만": "클라만",
  "리 루": "리루", "캐시 우드": "캐시우드" };

function renderGuruAgg() {
  const host = $("#guru-agg");
  // 전체 종목 인덱스 확보(소형주까지 클릭 가능) — 아직이면 로드 후 1회 재렌더
  if (!LOOKUP_INDEX && !renderGuruAgg._loading) {
    renderGuruAgg._loading = true;
    fetch("data/stocks/index.json" + _cb).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (j) LOOKUP_INDEX = j.stocks;
      renderGuruAgg._loading = false;
      if ((window._guruMk || "us") === "agg") renderGuruAgg();
    });
  }
  const usM = GURUS.managers.filter((m) => (m.country || "us") === "us" && m.type !== "disclosure");
  // 이슈어 기준 집계
  const agg = new Map();
  usM.forEach((m) => {
    const short = GURU_SHORT[m.name] || m.name;
    m.holdings.forEach((hh) => {
      const key = hh.issuer.toUpperCase();
      const r = agg.get(key) || { issuer: hh.issuer, holders: [], total: 0, newBy: [], addBy: [], trimBy: [] };
      r.holders.push({ name: short, weight: hh.weight, change: hh.change });
      r.total += hh.value || 0;
      if (hh.change === "new") r.newBy.push(short);
      if (hh.change === "add") r.addBy.push(short);
      if (hh.change === "trim") r.trimBy.push(short);
      agg.set(key, r);
    });
    (m.exits || []).forEach((e) => {
      const key = e.issuer.toUpperCase();
      const r = agg.get(key) || { issuer: e.issuer, holders: [], total: 0, newBy: [], addBy: [], trimBy: [] };
      (r.exitBy = r.exitBy || []).push(short);
      agg.set(key, r);
    });
  });
  // 시총 매핑
  agg.forEach((r, key) => {
    const tk = ISSUER_TICKER[key];
    if (tk) {
      r.ticker = tk;
      const tile = MARKET?.heatmap?.find((x) => x.m === "us" && x.t === tk);
      r.mcap = tile?.mcap || 0;
      r.logo = EXTRAS.company?.map?.[`us_${tk}`]?.logo || "";
    }
  });
  const rows = [...agg.values()].filter((r) => r.holders.length);
  rows.sort((a, b) => (b.mcap || 0) - (a.mcap || 0) || b.total - a.total);

  const CHG_ICON = { new: "🆕", add: "➕", trim: "➖", hold: "" };
  const holderBadges = (r) => r.holders
    .sort((a, b) => b.weight - a.weight)
    .map((x) => `<span class="badge ${x.change === "new" ? "hero" : x.change === "trim" ? "" : "dim"}"
      title="포트 비중 ${(x.weight * 100).toFixed(1)}%">${CHG_ICON[x.change]}${x.name} ${(x.weight * 100).toFixed(0)}%</span>`).join(" ");

  // 신규 매수 섹션
  const newRows = rows.filter((r) => r.newBy.length)
    .sort((a, b) => b.newBy.length - a.newBy.length || (b.mcap || 0) - (a.mcap || 0));
  // 전원 청산 섹션
  const exitRows = [...agg.values()].filter((r) => (r.exitBy || []).length && !r.holders.length)
    .sort((a, b) => b.exitBy.length - a.exitBy.length);

  host.innerHTML = `
    <div class="criteria">종목 기준으로 뒤집은 13F 집계 — 각 대가의 <b>상위 15 보유</b>만 대상(전체 포트 아님).
      비중 %는 그 대가 포트폴리오 내 비중 · 🆕신규 ➕증액 ➖축소 · 시총순 정렬(유니버스 밖 종목은 13F 금액순)</div>

    <h2>🆕 이번 분기 신규 매수 <span class="sub-note">(${newRows.length}종목 — 대가들이 새로 담은 것)</span></h2>
    ${newRows.length ? `<div class="tablewrap card-flat"><table>
      <tr><th>종목</th><th>신규 매수</th><th>기존 보유</th></tr>
      ${newRows.slice(0, 20).map((r) => `<tr>
        <td>${r.logo ? `<img class="cal-logo" src="${r.logo}" onerror="this.style.visibility='hidden'">` : ""}${r.ticker ? `<a href="#" class="goto-lookup agg-goto" data-key="us_${r.ticker}"><b>${r.issuer}</b></a>` : `<b>${r.issuer}</b>`}</td>
        <td><b class="pos">${r.newBy.join(" · ")}</b></td>
        <td class="sub-note">${r.holders.filter((x) => x.change !== "new").map((x) => x.name).join(" · ") || "-"}</td>
      </tr>`).join("")}</table></div>` : `<p class="mini-note">신규 편입 없음</p>`}

    <h2 style="margin-top:26px">📊 대가 보유 전체 <span class="sub-note">(${rows.length}종목 · 시총순 · 배지 클릭 안내: 비중은 각 대가 포트 내 %)</span></h2>
    <div class="tablewrap card-flat"><table>
      <tr><th>종목</th><th>시총</th><th>대가</th><th>보유 중인 대가 (비중·변화)</th></tr>
      ${rows.map((r) => `<tr>
        <td style="white-space:nowrap">${r.logo ? `<img class="cal-logo" src="${r.logo}" onerror="this.style.visibility='hidden'">` : ""}${r.ticker ? `<a href="#" class="goto-lookup agg-goto" data-key="us_${r.ticker}"><b>${r.issuer}</b></a>` : r.issuer}</td>
        <td>${r.mcap ? fmtMcap(r.mcap, "us") : "-"}</td>
        <td><b>${r.holders.length}</b></td>
        <td style="white-space:normal;text-align:left">${holderBadges(r)}${(r.exitBy || []).length ? ` <span class="badge" style="background:#fef2f2;color:#991b1b">❌청산: ${r.exitBy.join("·")}</span>` : ""}</td>
      </tr>`).join("")}</table></div>

    ${exitRows.length ? `<h2 style="margin-top:26px">❌ 전원 청산 <span class="sub-note">(상위 15에서 사라진 대형 포지션)</span></h2>
    <div class="tablewrap card-flat"><table><tr><th>종목</th><th>청산한 대가</th></tr>
      ${exitRows.slice(0, 15).map((r) => `<tr><td>${r.issuer}</td><td class="neg">${r.exitBy.join(" · ")}</td></tr>`).join("")}</table></div>` : ""}

    <p class="sub-note" style="margin-top:10px">13F는 분기말 +45일 지연 공시 · 롱 포지션만 표시(숏·옵션 제외) ·
      각 대가의 상위 15 보유만 집계하므로 소형 포지션은 누락될 수 있음</p>

    ${krAggHtml()}`;

  host.querySelectorAll(".agg-goto").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    gotoTabFull("lookup");
    if (!lookupRendered) initLookup();
    loadLookup(a.dataset.key);
  }));
}


// 한국 대가 보유 집계 — DART 대량보유 공시 기반(corps 전체 리스트)
function krAggHtml() {
  const krM = GURUS.managers.filter((m) => m.country === "kr" && m.corps?.length);
  if (!krM.length) return "";
  const agg = new Map();  // 종목명 → {holders:[{name, d, n}], latest}
  krM.forEach((m) => {
    const short = m.name.replace(/\s*\(.*\)$/, "");
    m.corps.forEach(([c, d, n]) => {
      const r = agg.get(c) || { name: c, holders: [], latest: "0" };
      r.holders.push({ name: short, d, n });
      if (d > r.latest) r.latest = d;
      agg.set(c, r);
    });
  });
  // 티커 매칭: 전체 인덱스(LOOKUP_INDEX, 843종목) 우선 → 히트맵(코어) 폴백
  const idxByName = {};
  (LOOKUP_INDEX || []).forEach((x) => { if (x.market === "kr") idxByName[x.name] = x.ticker; });
  const tileByName = {};
  (MARKET?.heatmap || []).forEach((t) => { if (t.m === "kr" && t.name) tileByName[t.name] = t; });
  agg.forEach((r) => {
    r.ticker = idxByName[r.name] || tileByName[r.name]?.t;
    r.mcap = tileByName[r.name]?.mcap || 0;
  });
  const rows = [...agg.values()];
  const fmtD = (d) => `${d.slice(4, 6)}/${d.slice(6, 8)}`;
  const nameCell = (r) => r.ticker
    ? `<img class="cal-logo" src="https://ssl.pstatic.net/imgstock/fn/real/logo/stock/Stock${r.ticker}.svg" onerror="this.style.visibility='hidden'"><a href="#" class="goto-lookup agg-goto" data-key="kr_${r.ticker}"><b>${r.name}</b></a>`
    : `<b>${r.name}</b>`;
  const holderBadges = (r) => r.holders
    .sort((a, b) => (b.d > a.d ? 1 : -1))
    .map((x) => `<span class="badge ${x.name === "국민연금" ? "dim" : "hero"}" title="최근 보고 ${fmtD(x.d)}${x.n > 1 ? " · 공시 " + x.n + "건" : ""}">${x.name}</span>`).join(" ");

  // ① 겹침: 국민연금 외 2곳 이상 보유 (겹칠수록 확신 신호)
  const overlap = rows.filter((r) => r.holders.filter((x) => x.name !== "국민연금").length >= 2)
    .sort((a, b) => b.holders.length - a.holders.length || (b.mcap || 0) - (a.mcap || 0));
  // ② 최근 30일 보고 (신규·변동 움직임)
  const now = new Date();
  const cut = new Date(now.getTime() - 30 * 864e5);
  const cutS = `${cut.getFullYear()}${String(cut.getMonth() + 1).padStart(2, "0")}${String(cut.getDate()).padStart(2, "0")}`;
  const recent = rows.filter((r) => r.latest >= cutS && r.holders.some((x) => x.name !== "국민연금"))
    .sort((a, b) => (b.latest > a.latest ? 1 : -1)).slice(0, 20);

  return `<h2 style="margin-top:34px">🇰🇷 한국 대가·기관 보유 종합 <span class="sub-note">(DART 대량보유(5%) 공시 최근 6개월 · ${rows.length}종목 — 5% 미만 비공시라 전체 포트 아님)</span></h2>

    ${overlap.length ? `<h3 style="margin:12px 0 4px">🤝 겹치는 보유 <span class="sub-note">(국민연금 제외 2곳 이상 — 겹칠수록 강한 확신 신호)</span></h3>
    <div class="tablewrap card-flat"><table>
      <tr><th>종목</th><th>시총</th><th>보유</th><th>보유 주체 (최신 보고순)</th></tr>
      ${overlap.map((r) => `<tr>
        <td style="white-space:nowrap">${nameCell(r)}</td>
        <td>${r.mcap ? fmtMcap(r.mcap, "kr") : "-"}</td><td><b>${r.holders.length}</b></td>
        <td style="white-space:normal;text-align:left">${holderBadges(r)}</td></tr>`).join("")}
    </table></div>` : `<p class="mini-note">국민연금 외 2곳 이상 겹치는 종목 없음</p>`}

    <h3 style="margin:18px 0 4px">🕒 최근 30일 보고 <span class="sub-note">(지분 신규·변동 공시 — 최신 움직임)</span></h3>
    <div class="tablewrap card-flat"><table>
      <tr><th>종목</th><th>최근 보고</th><th>보유 주체</th></tr>
      ${recent.map((r) => `<tr>
        <td style="white-space:nowrap">${nameCell(r)}</td>
        <td>${fmtD(r.latest)}</td>
        <td style="white-space:normal;text-align:left">${holderBadges(r)}</td></tr>`).join("")}
    </table></div>

    <p class="sub-note" style="margin-top:8px">배지 초록=대가·운용사, 회색=국민연금 · 배지에 마우스를 올리면 보고일·공시 횟수 ·
      국민연금 단독 보유(${rows.filter((r) => r.holders.every((x) => x.name === "국민연금")).length}종목)는 목록에서 생략 — 개별 카드(🇰🇷 한국 탭)에서 확인</p>`;
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

// 토스 체결내역(FILLED) → 매매일지 자동 기록.
// BUY=신규 진행중 거래 / SELL=동일 종목·동일 수량의 가장 오래된 진행중 매수를 청산(FIFO),
// 짝이 없으면 손익 0의 단독 기록으로 보존. dedup은 주문 id("toss_…") 기준 — 재가져오기 시 0건.
function jrImportToss(orders) {
  const arr = jrLoad();
  const ids = new Set(arr.flatMap((r) => [r.id, r.tossExit].filter(Boolean)));
  let added = 0, closed = 0, solo = 0, dup = 0;
  const sorted = [...orders].sort((a, b) => (a.filledAt || "").localeCompare(b.filledAt || ""));
  sorted.forEach((o) => {
    if (!o.oid || !o.ticker || !(o.qty > 0)) return;
    const id = "toss_" + String(o.oid).slice(0, 16);
    if (ids.has(id)) { dup++; return; }
    ids.add(id);
    const tk = String(o.ticker);
    const hit = LOOKUP_INDEX?.find((x) => x.ticker.toUpperCase() === tk.toUpperCase());
    const name = hit?.name || tk;
    const t16 = (o.filledAt || "").slice(0, 16);
    const feeTxt = `수수료 ${o.fee ?? 0}${o.tax ? ` · 세금 ${o.tax}` : ""}`;
    if (o.side === "BUY") {
      arr.unshift({ id, ticker: tk, name, side: "buy", qty: o.qty, entry: o.price,
        exit: null, etime: t16, xtime: null,
        reason: `[토스 자동기록] 매수 체결 · ${feeTxt}`, emotion: "", note: "" });
      added++;
    } else {  // SELL
      const tgt = arr.filter((r) => r.ticker === tk && r.side === "buy" && r.exit == null && r.qty === o.qty)
        .sort((a, b) => (a.etime || "").localeCompare(b.etime || ""))[0];
      if (tgt) {
        tgt.exit = o.price; tgt.xtime = t16; tgt.tossExit = id;
        tgt.note = ((tgt.note || "") + `\n[토스 자동기록] 매도 체결 · ${feeTxt}`).trim();
        closed++;
      } else {
        arr.unshift({ id, ticker: tk, name, side: "buy", qty: o.qty, entry: o.price,
          exit: o.price, etime: t16, xtime: t16,
          reason: `[토스 자동기록] 매도 단독 체결 · ${feeTxt}`, emotion: "",
          note: "짝이 되는 매수 기록이 없어 손익 0으로 보존(진입가는 수기 보정)" });
        solo++;
      }
    }
  });
  jrSave(arr);
  jrRender();
  return { added, closed, solo, dup };
}

/* ---------- 포트폴리오 점검 (localStorage — 서버 전송 없음) ---------- */
const PF_KEY = "cp_portfolio_v1";
const TOSS_KEY = "cp_toss_v1";   // 토스 동기화 스냅샷(현금·요약·경고·체결·시장 수급) — 브라우저에만 저장
const pfStockCache = new Map();  // key -> stocks/{key}.json
let pfConc = null;               // pfRenderStats → pfRenderList로 넘기는 섹터 집중도 [비중, 섹터명]
let pfMkSel = "kospi";           // 수급 컨텍스트 토글 상태

function pfLoad() { try { return JSON.parse(localStorage.getItem(PF_KEY)) || []; } catch (e) { return []; } }
function pfSave(a) { localStorage.setItem(PF_KEY, JSON.stringify(a)); }

// 보유 포트폴리오 rich 저장소 (v2, 항상 원화 통일 — 해외주식도 원화 환산가)
const PF2_KEY = "cp_portfolio_v2";
function pf2Load() {
  try { const d = JSON.parse(localStorage.getItem(PF2_KEY)); if (d && Array.isArray(d.holdings)) return d; } catch (e) {}
  return null;
}
function pf2Save(d) { localStorage.setItem(PF2_KEY, JSON.stringify(d)); }
// 점검·보유 탭 공통 보유목록 (rich). v2 우선, 없으면 legacy v1을 승격.
function pfHoldings() {
  const d = pf2Load();
  if (d) return d.holdings;
  return pfLoad().map((x) => ({ ...x }));
}
/* ── 실시간 평가 — 저장된 평균가·수량(사실)은 두고, 현재가만 최신 시세로 갈아끼워 재계산 ──
   저장값(price/val/pl)은 토스 동기화 시점(15:40)에 굳은 값이라 그대로 쓰면 시세가 멈춰 보임.
   시세 소스: MARKET.quotes(30분 갱신) — 미국은 native USD라 원/달러(KRW=X)로 환산해 원화 통일 유지. */
function pfFxRate() {
  const m = (MARKET?.macro || []).find((x) => x.id === "KRW=X");
  return m?.last || tossLoad()?.fx || null;   // 30분 갱신 환율 우선, 없으면 동기화 시점 환율
}
function pfLiveRow(h) {
  const q = MARKET?.quotes?.[`${h.mk}_${h.ticker}`];
  if (!q || !(+h.qty > 0)) return h;                       // 시세 없음(유니버스 밖 등) → 저장값 유지
  let price = +q[0];
  if (h.mk === "us") {
    const fx = pfFxRate();
    if (!fx) return h;                                     // 환율 불명 → 원화 통일 깨지므로 저장값 유지
    price *= fx;
  }
  if (!(price > 0)) return h;
  const val = Math.round(price * h.qty);
  const cost = h.cost;                                     // 원금 = 평균가×수량 (불변)
  const pl = val - cost;
  const r = +q[1];                                         // 당일 등락률
  const dayPl = r != null && !isNaN(r) && 1 + r !== 0 ? Math.round(val - val / (1 + r)) : h.dayPl;
  return { ...h, price, val, pl, plRate: cost ? pl / cost : null,
           dayPl, dayRate: r != null && !isNaN(r) ? r : h.dayRate, live: true };
}
function pfHoldingsLive() { return pfHoldings().map(pfLiveRow); }

// 누락 필드 파생 (평가금·원금·손익·손익률). 입력값 우선, 없으면 계산.
function pfDerive(h) {
  const qty = +h.qty || 0, avg = +h.avg || 0, price = +h.price || 0;
  const fee = h.fee == null || h.fee === "" ? null : +h.fee;
  const tax = h.tax == null || h.tax === "" ? null : +h.tax;
  const cost = h.cost != null ? +h.cost : Math.round(avg * qty);
  const val = h.val != null ? +h.val : Math.round(price * qty - (fee || 0) - (tax || 0));
  const pl = h.pl != null ? +h.pl : val - cost;
  const plRate = h.plRate != null ? +h.plRate : (cost ? pl / cost : null);
  const dayPl = h.dayPl == null || h.dayPl === "" ? null : +h.dayPl;
  const dayRate = h.dayRate != null ? +h.dayRate : (dayPl != null && val - dayPl ? dayPl / (val - dayPl) : null);
  return { ticker: h.ticker, name: h.name || h.ticker, mk: h.mk, lev: h.lev || null,
    qty, avg, price, cost, val, pl, plRate, dayPl, dayRate, fee, tax };
}
// 가져오기 정규화 → 원화 통일 rich (manual=krw 그대로 / API=native면 fx로 환산)
function pfNormalizeImport(d) {
  const krwUnified = d.krw === true;
  const fx = d.fx || null;
  return (d.holdings || []).filter((x) => x.ticker && +x.qty > 0).map((x) => {
    const mk = x.mk || (/^\d{6}$/.test(String(x.ticker)) ? "kr" : "us");
    const k = (v) => (v == null ? null : (!krwUnified && mk === "us" && fx ? v * fx : v));
    return pfDerive({ ticker: String(x.ticker), name: x.name || x.ticker, mk, lev: x.lev || null,
      qty: +x.qty, avg: k(x.avg), price: k(x.last != null ? x.last : x.price),
      val: k(x.val), cost: k(x.cost), pl: k(x.pl), plRate: x.plRate,
      dayPl: k(x.dayPl), dayRate: x.dayRate, fee: k(x.fee), tax: k(x.tax) });
  });
}
// 원화 금액 포맷 (signed=부호 강제)
function won(v, signed) {
  if (v == null || isNaN(v)) return "-";
  const s = signed ? (v > 0 ? "+" : v < 0 ? "-" : "") : (v < 0 ? "-" : "");
  return s + Math.round(Math.abs(v)).toLocaleString() + "원";
}
function pfToday() { return new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16).replace("T", " "); }

let _toss;  // undefined=미로드, null=없음
function tossLoad() {
  if (_toss === undefined) { try { _toss = JSON.parse(localStorage.getItem(TOSS_KEY)); } catch (e) { _toss = null; } }
  return _toss;
}
function tossSave(d) { _toss = d; localStorage.setItem(TOSS_KEY, JSON.stringify(d)); }

// 토스 매수유의 유형: [라벨, 배지색, 감점]
const TOSS_WARN = {
  LIQUIDATION_TRADING: ["정리매매", "red", -2],
  INVESTMENT_RISK: ["투자위험", "red", -2],
  INVESTMENT_WARNING: ["투자경고", "org", -1],
  OVERHEATED: ["단기과열", "org", -1],
  VI_STATIC: ["VI 정적", "dim", 0],
  VI_DYNAMIC: ["VI 동적", "dim", 0],
  VI_STATIC_AND_DYNAMIC: ["VI 정+동", "dim", 0],
  STOCK_WARRANTS: ["신주인수권", "dim", 0],
};
function tossActiveWarns(ticker) {
  const w = tossLoad()?.warnings?.[ticker];
  if (!w) return [];
  const today = new Date().toISOString().slice(0, 10);
  return w.filter((x) => TOSS_WARN[x.type] && (!x.end || x.end >= today));
}

function pfResolve(raw) {
  const m = raw.match(/\(([A-Za-z0-9.]+)\)\s*$/);
  const tk = (m ? m[1] : raw).toUpperCase();
  const hit = LOOKUP_INDEX?.find((x) => x.ticker.toUpperCase() === tk || x.name === raw.trim() ||
    (x.name + " (" + x.ticker + ")") === raw.trim());
  return hit ? { ticker: hit.ticker, name: hit.name, mk: hit.market } : null;
}

/* ===== 보유 포트폴리오 탭 (토스 스타일 표) ===== */
let hldEditTicker = null;

function initHoldings() {
  holdingsRendered = true;
  if (!LOOKUP_INDEX) initLookup();
  $("#hld-add").onclick = () => hldOpenModal(null);
  $("#hld-close").onclick = $("#hld-cancel").onclick = () => $("#hld-modal").close();
  $("#hld-form").onsubmit = (e) => { e.preventDefault(); hldSubmit(); };
  $("#hld-delete").onclick = () => {
    if (!hldEditTicker || !confirm("이 종목을 목록에서 삭제할까요?")) return;
    const d = pf2Load() || { holdings: [] };
    d.holdings = d.holdings.filter((x) => x.ticker !== hldEditTicker);
    d.krw = true; d.updated = pfToday();
    pf2Save(d); $("#hld-modal").close(); hldRefresh();
  };
  $("#hld-clear").onclick = () => {
    if (!pfHoldings().length || !confirm("보유 포트폴리오를 전부 삭제할까요?")) return;
    localStorage.removeItem(PF2_KEY); pfSave([]); hldRefresh();
  };
  $("#hld-import").onclick = () => {
    const open = (typeof jrLoad === "function" ? jrLoad() : []).filter((t) => t.exit == null && t.side === "buy");
    if (!open.length) { alert("매매일지에 진행중(매수) 거래가 없습니다"); return; }
    const d = pf2Load() || { krw: true, holdings: [] };
    let added = 0;
    open.forEach((t) => {
      if (!d.holdings.some((x) => x.ticker === t.ticker)) {
        d.holdings.push(pfDerive({ ticker: t.ticker, name: t.name, mk: /^\d{6}$/.test(t.ticker) ? "kr" : "us",
          qty: t.qty, avg: t.entry, price: t.entry }));
        added++;
      }
    });
    d.krw = true; d.updated = pfToday(); pf2Save(d);
    alert(added + "종목 불러옴 (중복 제외) — 현재가는 종목 편집에서 갱신하세요");
    hldRefresh();
  };
  $("#hld-file").onclick = () => $("#hld-file-input").click();
  $("#hld-file-input").onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    f.text().then((txt) => {
      try {
        const raw = JSON.parse(txt);
        const d = Array.isArray(raw) ? { holdings: raw } : raw;
        const incoming = pfNormalizeImport(d);
        if (!incoming.length) throw new Error("empty");
        const cur = pf2Load() || { krw: true, holdings: [] };
        let added = 0, updated = 0;
        incoming.forEach((x) => {
          const i = cur.holdings.findIndex((c) => c.ticker === x.ticker);
          if (i >= 0) { cur.holdings[i] = x; updated++; } else { cur.holdings.push(x); added++; }
        });
        cur.krw = true; cur.updated = d.synced || pfToday();
        pf2Save(cur);
        let extraTxt = "";
        if (d.ver >= 2 && (d.cash || d.warnings || d.market || d.orders)) {  // API 확장(현금·경고·수급)은 점검 탭에서 사용
          tossSave(d);
          const got = ["cash", "warnings", "orders", "market"].filter((k) => d[k]);
          if (got.length) extraTxt = "\n확장 데이터: " + got.join(" · ");
        }
        alert(`가져오기 완료 — 신규 ${added} · 갱신 ${updated}종목${d.synced ? ` (기준 ${d.synced})` : ""}${extraTxt}`);
        if (d.ver >= 2 && Array.isArray(d.orders) && d.orders.length &&
            confirm(`체결내역 ${d.orders.length}건을 매매일지에도 기록할까요? (이미 기록된 건은 건너뜁니다)`)) {
          const r = jrImportToss(d.orders);
          alert(`매매일지 기록 완료 — 신규 매수 ${r.added}건 · 청산 반영 ${r.closed}건 · 단독 매도 ${r.solo}건 · 중복 제외 ${r.dup}건`);
        }
        hldRefresh();
      } catch (err) { alert("JSON 형식이 올바르지 않습니다 (toss_sync.py 생성 파일 또는 {holdings:[...]} / [{ticker,qty,avg}] 배열)"); }
      e.target.value = "";
    });
  };
  hldRender();
}

// 보유 변경 후: 보유 탭 + (열려 있으면) 점검 탭 동시 갱신
function hldRefresh() {
  if (holdingsRendered) hldRender();
  if (portfolioRendered) pfRender();
}

function hldOpenModal(h) {
  hldEditTicker = h?.ticker || null;
  $("#hld-modal-title").textContent = h ? "종목 편집" : "종목 추가";
  $("#hld-ticker").value = h ? (h.mk === "kr" ? `${h.name} (${h.ticker})` : h.ticker) : "";
  $("#hld-mk").value = h?.mk || "us";
  $("#hld-qty").value = h?.qty ?? "";
  $("#hld-avg").value = h?.avg ?? "";
  $("#hld-price").value = h?.price ?? "";
  $("#hld-daypl").value = h?.dayPl ?? "";
  $("#hld-fee").value = h?.fee ?? "";
  $("#hld-tax").value = h?.tax ?? "";
  $("#hld-delete").style.display = h ? "" : "none";
  $("#hld-modal").showModal();
}

function hldResolve() {
  const raw = $("#hld-ticker").value.trim();
  const m = raw.match(/\(([A-Za-z0-9.]+)\)\s*$/);
  const tk = (m ? m[1] : raw).toUpperCase();
  const hit = LOOKUP_INDEX?.find((x) => x.ticker.toUpperCase() === tk || x.name === raw ||
    (x.name + " (" + x.ticker + ")") === raw);
  const name = hit ? hit.name : (m ? raw.replace(/\s*\(.*\)$/, "") : tk);
  return { ticker: hit ? hit.ticker : tk, name, mk: $("#hld-mk").value };
}

function hldSubmit() {
  const r = hldResolve();
  if (!r.ticker || !(+$("#hld-qty").value > 0)) { alert("종목과 보유수량을 입력해 주세요"); return; }
  const rec = pfDerive({ ...r, qty: +$("#hld-qty").value, avg: +$("#hld-avg").value, price: +$("#hld-price").value,
    dayPl: $("#hld-daypl").value, fee: $("#hld-fee").value, tax: $("#hld-tax").value });
  let list = (pf2Load()?.holdings || []).slice();
  if (hldEditTicker) list = list.filter((x) => x.ticker !== hldEditTicker);
  const j = list.findIndex((x) => x.ticker === rec.ticker);
  if (j >= 0) list[j] = rec; else list.push(rec);
  pf2Save({ krw: true, updated: pfToday(), holdings: list });
  $("#hld-modal").close();
  hldRefresh();
}

function hldRender() {
  const host = $("#hld-list"), sumEl = $("#hld-summary");
  const all = pfHoldingsLive();   // 현재가·평가금·수익률은 최신 시세로 재계산
  if (!all.length) {
    sumEl.style.display = "none";
    host.innerHTML = `<div class="card-flat" style="text-align:center;padding:40px 16px;color:var(--muted)">
      보유종목이 없습니다 — <b>＋ 종목 추가</b>로 입력하거나 <b>📂 파일 가져오기</b>로 토스 동기화 파일을 불러오세요.<br>
      <span class="sub-note">입력한 종목은 <b>포트폴리오 점검</b> 탭에서 산업·시장 흐름까지 진단됩니다.</span></div>`;
    return;
  }
  const secs = [["kr", "🇰🇷 국내주식"], ["us", "🇺🇸 해외주식"]];
  let gVal = 0, gCost = 0, gDay = 0, gDayHas = false;
  const secHtml = secs.map(([mk, label]) => {
    const rows = all.filter((h) => h.mk === mk);
    if (!rows.length) return "";
    const sVal = rows.reduce((a, h) => a + (h.val || 0), 0);
    const sCost = rows.reduce((a, h) => a + (h.cost || 0), 0);
    const sPl = sVal - sCost;
    gVal += sVal; gCost += sCost;
    rows.forEach((h) => { if (h.dayPl != null) { gDay += h.dayPl; gDayHas = true; } });
    const rowsHtml = rows.map((h) => {
      const logo = h.mk === "kr" ? `https://ssl.pstatic.net/imgstock/fn/real/logo/stock/Stock${h.ticker}.svg`
        : (EXTRAS.company?.map?.[`us_${h.ticker}`]?.logo || "");
      const rc = (v) => (v >= 0 ? "pos" : "neg");
      return `<tr data-tk="${h.ticker}">
        <td class="hld-name">${logo ? `<img class="mv-logo" src="${logo}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="mv-logo"></span>`}
          <span><b>${h.name}</b>${h.lev ? ` <span class="pf-warn-badge dim">${h.lev}</span>` : ""}<br><span class="sub-note">${h.ticker}</span></span></td>
        <td class="${rc(h.plRate)}">${pct(h.plRate, 2)}</td>
        <td class="${rc(h.pl)}">${won(h.pl, true)}</td>
        <td>${won(h.avg)}</td>
        <td>${won(h.price)}</td>
        <td>${h.qty}주</td>
        <td><b>${won(h.val)}</b></td>
        <td>${won(h.cost)}</td>
        <td class="${rc(h.dayRate)}">${h.dayRate != null ? pct(h.dayRate, 2) : "-"}</td>
        <td class="${rc(h.dayPl)}">${h.dayPl != null ? won(h.dayPl, true) : "-"}</td>
        <td>${h.fee != null ? won(h.fee) : "-"}</td>
        <td>${h.tax ? won(h.tax) : "-"}</td></tr>`;
    }).join("");
    return `<div class="hld-sec">
      <div class="hld-sec-head"><b>${label}</b>
        <span>${won(sVal)} <b class="${sPl >= 0 ? "pos" : "neg"}">${won(sPl, true)} (${pct(sCost ? sPl / sCost : 0, 2)})</b></span></div>
      <div class="tablewrap"><table class="hld-table">
        <thead><tr><th>종목</th><th>총수익률</th><th>총수익금</th><th>평균가</th><th>현재가</th><th>수량</th>
          <th>평가금</th><th>원금</th><th>일간%</th><th>일간액</th><th>수수료</th><th>세금</th></tr></thead>
        <tbody>${rowsHtml}</tbody></table></div></div>`;
  }).join("");

  const gPl = gVal - gCost;
  const toss = tossLoad();
  const cashKrw = toss?.cash ? (toss.cash.krw || 0) + (toss.fx ? (toss.cash.usd || 0) * toss.fx : 0) : 0;
  sumEl.style.display = "";
  sumEl.innerHTML = `
    <div class="idx-card"><div class="sub-note">총 평가금${cashKrw ? " (주식)" : ""}</div>
      <div class="lk-name" style="font-size:1.02rem">${won(gVal)}</div>
      <div class="sub-note">${cashKrw ? "현금 " + won(cashKrw) + " · " : ""}원금 ${won(gCost)}</div></div>
    <div class="idx-card"><div class="sub-note">총 손익</div>
      <div class="pf-day ${gPl >= 0 ? "pos" : "neg"}">${won(gPl, true)}</div>
      <div class="sub-note">${pct(gCost ? gPl / gCost : 0, 2)}</div></div>
    ${gDayHas ? `<div class="idx-card"><div class="sub-note">오늘 손익</div>
      <div class="pf-day ${gDay >= 0 ? "pos" : "neg"}">${won(gDay, true)}</div>
      <div class="sub-note">${pct(gVal - gDay ? gDay / (gVal - gDay) : 0, 2)}</div></div>` : ""}
    <div class="idx-card"><div class="sub-note">보유 종목</div>
      <div class="lk-name">${all.length}<span class="sub-note"> 국내 ${all.filter((h) => h.mk === "kr").length} · 해외 ${all.filter((h) => h.mk === "us").length}</span></div>
      <div class="sub-note">${toss ? "동기 " + (pf2Load()?.updated || "") : "수기 입력"}</div></div>`;

  const liveN = all.filter((h) => h.live).length;
  const fx = pfFxRate();
  host.innerHTML = secHtml + `<p class="sub-note" style="margin-top:10px">
    ${liveN ? `💹 <b>${liveN}/${all.length}종목</b>은 <b>최신 시세</b>(${MARKET?.generated || ""} · 30분 갱신)로 평가금·수익률을 다시 계산했습니다`
            : `⚠️ 최신 시세를 찾지 못해 <b>동기화 시점 가격</b>으로 표시 중입니다`}${
      all.length - liveN > 0 && liveN ? ` · 나머지 ${all.length - liveN}종목은 동기화 시점 가격(유니버스 밖)` : ""}.
    평균가·수량·원금은 토스 동기화 값 그대로입니다.<br>
    해외주식은 <b>원화 환산</b>(${fx ? "1$≈" + Math.round(fx).toLocaleString() + "원" : "환율 불명"}) 기준이라 토스 앱 화면과 소폭 다를 수 있어요.
    행을 클릭하면 편집·삭제할 수 있고, 산업·수급·원칙 진단은 <b>포트폴리오 점검</b> 탭에서 확인하세요.</p>`;
  host.querySelectorAll(".hld-table tbody tr").forEach((tr) => tr.onclick = () =>
    hldOpenModal(pfHoldings().find((h) => h.ticker === tr.dataset.tk)));
}

function initPortfolio() {
  portfolioRendered = true;
  if (!LOOKUP_INDEX) initLookup();
  pfRender();
}

async function pfRender() {
  const arr = pfHoldingsLive();   // 점검 탭도 동일하게 최신 시세 기준
  const statsEl = $("#pf-stats"), listEl = $("#pf-list");
  pfMarketRender();  // 수급 컨텍스트는 보유 여부와 무관(토스 스냅샷 존재 시)
  if (!arr.length) {
    statsEl.style.display = "none";
    listEl.innerHTML = `<div class="card-flat" style="text-align:center;padding:36px;color:var(--muted)">
      <b>보유 포트폴리오</b> 탭에서 종목을 입력하면 뉴스·수급·섹터 흐름·원칙 신호를 종합 점검합니다.<br>
      <span class="sub-note">파일 가져오기(토스 동기화)로 한 번에 불러올 수도 있습니다.</span></div>`;
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

// 시장 수급 컨텍스트 — 토스 스냅샷의 KOSPI/KOSDAQ 투자자별 순매수 20일 + 국채 스프레드 (참고 표시 전용)
function pfMarketRender() {
  const host = $("#pf-market");
  if (!host) return;
  const t = tossLoad();
  const inv = t?.market?.investor;
  const bonds = t?.market?.bonds;
  if (!inv && !bonds) { host.style.display = "none"; host.innerHTML = ""; return; }
  host.style.display = "";
  const recs = inv?.[pfMkSel] ? [...inv[pfMkSel]].sort((a, b) => (a.d || "").localeCompare(b.d || "")) : [];
  let svg = "";
  if (recs.length) {
    const W = 640, H = 120, pad = 4, y0 = H / 2;
    const max = Math.max(1, ...recs.flatMap((r) => [Math.abs(r.indiv || 0), Math.abs(r.frgn || 0), Math.abs(r.inst || 0)]));
    const gw = (W - pad * 2) / recs.length;
    const bw = Math.max(2, gw / 3 - 1.5);
    const colors = { indiv: "#9aa4b2", frgn: "#f5445a", inst: "#4391ff" };
    let bars = "";
    recs.forEach((r, i) => ["indiv", "frgn", "inst"].forEach((k, j) => {
      const v = r[k] || 0;
      const hh = Math.abs(v) / max * (H / 2 - 6);
      const x = pad + i * gw + j * (bw + 1.5);
      bars += `<rect x="${x.toFixed(1)}" y="${(v >= 0 ? y0 - hh : y0).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, hh).toFixed(1)}" fill="${colors[k]}" rx="1"/>`;
    }));
    svg = `<svg viewBox="0 0 ${W} ${H}" class="pf-invbar" preserveAspectRatio="none">
      <line x1="0" y1="${y0}" x2="${W}" y2="${y0}" stroke="#d5d9e0" stroke-width="1"/>${bars}</svg>`;
  }
  const won = (v) => (v >= 0 ? "+" : "-") + (Math.abs(v) >= 1e12 ? (Math.abs(v) / 1e12).toFixed(1) + "조" : Math.round(Math.abs(v) / 1e8).toLocaleString() + "억");
  const frgnSum = recs.reduce((a, r) => a + (r.frgn || 0), 0);
  const pensionSum = recs.reduce((a, r) => a + (r.pension || 0), 0);
  const b2 = bonds?.KR_BOND_2Y, b10 = bonds?.KR_BOND_10Y;
  const spread = b2 != null && b10 != null ? b10 - b2 : null;
  host.innerHTML = `<div class="card-flat">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <h3 class="lk-h3" style="margin:0">🏦 시장 수급 컨텍스트 <span class="sub-note">토스 동기 ${t.synced || ""} 기준 · 참고용</span></h3>
      <span style="flex:1"></span>
      ${inv ? `<span class="mk-toggle" id="pf-mk-toggle">
        <button data-m="kospi" class="${pfMkSel === "kospi" ? "active" : ""}">코스피</button>
        <button data-m="kosdaq" class="${pfMkSel === "kosdaq" ? "active" : ""}">코스닥</button></span>` : ""}
    </div>
    ${recs.length ? `${svg}
      <p class="legend"><span style="color:#9aa4b2">■</span> 개인 · <span style="color:#f5445a">■</span> 외국인 · <span style="color:#4391ff">■</span> 기관 — 일별 순매수 (최근 ${recs.length}일)</p>
      <div class="prof-grid wide">
        <div class="prof-row"><span>외국인 ${recs.length}일 누적 순매수</span>
          <span><b class="${frgnSum >= 0 ? "pos" : "neg"}">${won(frgnSum)}</b></span></div>
        <div class="prof-row"><span>연기금 ${recs.length}일 누적 순매수</span>
          <span><b class="${pensionSum >= 0 ? "pos" : "neg"}">${won(pensionSum)}</b> <span class="sub-note">— 연기금은 저점 분할매수 성향의 장기 자금</span></span></div>
      </div>` : `<p class="mini-note">투자자별 매매대금 데이터 없음</p>`}
    ${spread != null ? `<p class="sub-note" style="margin-top:6px">국채 금리: 2년 ${b2}% · 10년 ${b10}% → 장단기 스프레드
      <b class="${spread >= 0 ? "pos" : "neg"}">${spread.toFixed(2)}%p</b>${spread < 0 ? " ⚠ 금리 역전 — 역사적으로 경기 둔화 선행 신호" : ""}</p>` : ""}
  </div>`;
  host.querySelectorAll("#pf-mk-toggle button").forEach((b) => b.onclick = () => { pfMkSel = b.dataset.m; pfMarketRender(); });
}

// 종목별 점검 — 감점 룰: 유효 매도신호 -2 / 섹터 RS 전구간 음수 -1 / 외인+기관 동반매도 -1 / 1M 상대 -10%p -1
//                + 토스 거래소 경고: 정리매매·투자위험 -2 / 투자경고·단기과열 -1
function pfCheck(h) {
  const key = h.mk + "_" + h.ticker;
  const st = pfStockCache.get(key);
  const q = MARKET?.quotes?.[key];
  const nativeCur = q ? q[0] : st?.series?.[st.series.length - 1]?.c;  // 유니버스 원통화 시세(컨센 괴리 계산용)
  const rich = h.val != null;                       // 보유 포트폴리오 rich 항목(원화 통일)
  const cur = rich ? h.price : nativeCur;            // 표시용 현재가
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
  const warns = tossActiveWarns(h.ticker);
  warns.forEach((w) => {
    const [label, , pen] = TOSS_WARN[w.type];
    if (pen) { score += pen; reasons.push(`거래소 ${label} 지정${w.end ? `(~${w.end.slice(5)})` : ""}`); }
  });
  const toss = rich ? h : null;  // rich 항목이면 오늘손익·수수료 등을 그대로 사용
  const grade = score <= -3 ? "bad" : score < 0 ? "warn" : "good";
  const gradeTxt = grade === "bad" ? "🔴 논거 재점검" : grade === "warn" ? "🟡 점검 필요" : "🟢 흐름 양호";
  if (!reasons.length) reasons.push(recentBuy.length ? `매수신호 ${recentBuy.length}건(30일) — 원칙상 우호적` : "감점 요인 없음");
  return { st, cur, nativeCur, rich, sector, rs, p, sup, cons, recentSell, recentBuy, grade, gradeTxt, reasons, warns, toss };
}

function pfRenderStats(arr) {
  const statsEl = $("#pf-stats");
  statsEl.style.display = "";
  let stockKrw = 0, costKrw = 0, dayKrw = 0, hasDay = false;
  const secW = {};
  let nBad = 0, nWarn = 0;
  arr.forEach((h) => {
    const c = pfCheck(h);
    const valK = h.val != null ? h.val : (c.cur || 0) * h.qty;  // rich=원화 평가금, legacy=시세×수량
    stockKrw += valK;
    costKrw += h.cost != null ? h.cost : (h.avg || 0) * h.qty;
    if (h.dayPl != null) { dayKrw += h.dayPl; hasDay = true; }
    if (c.sector) secW[c.sector] = (secW[c.sector] || 0) + valK;
    if (c.grade === "bad") nBad++;
    if (c.grade === "warn") nWarn++;
  });
  const topSec = Object.entries(secW).sort((a, b) => b[1] - a[1])[0];
  pfConc = topSec && stockKrw ? [topSec[1] / stockKrw, topSec[0]] : null;  // 집중도는 리스트 상단 배지로
  const totRet = costKrw ? (stockKrw - costKrw) / costKrw : null;
  const rg = MARKET?.regime || {};
  const toss = tossLoad();
  const cashKrw = toss?.cash ? (toss.cash.krw || 0) + (toss.fx ? (toss.cash.usd || 0) * toss.fx : 0) : 0;
  const asof = pf2Load()?.updated || toss?.synced;

  // 카드1: 총 자산(현금 있으면 합산) — 없으면 평가액
  const card1 = cashKrw
    ? `<div class="idx-card"><div class="sub-note">총 자산 (주식+현금)</div>
        <div class="lk-name" style="font-size:1.0rem">${won(stockKrw + cashKrw)}</div>
        <div class="sub-note">주식 ${won(stockKrw)} · 현금 ${won(cashKrw)}${asof ? `<br>기준 ${asof}` : ""}</div></div>`
    : `<div class="idx-card"><div class="sub-note">평가액</div>
        <div class="lk-name" style="font-size:1.0rem">${won(stockKrw)}</div>
        <div class="sub-note">총수익률 <span class="${totRet >= 0 ? "pos" : "neg"}">${pct(totRet, 1)}</span> · 원금 ${won(costKrw)}</div></div>`;

  // 카드2: 오늘의 손익 (rich dayPl 합) — 없으면 생략
  const card2 = hasDay
    ? `<div class="idx-card"><div class="sub-note">오늘의 손익 (동기 시점)</div>
        <div class="pf-day ${dayKrw >= 0 ? "pos" : "neg"}">${won(dayKrw, true)}</div>
        <div class="sub-note">일간 ${pct(stockKrw - dayKrw ? dayKrw / (stockKrw - dayKrw) : 0, 2)} · 총 <span class="${totRet >= 0 ? "pos" : "neg"}">${pct(totRet, 1)}</span></div></div>`
    : "";

  statsEl.innerHTML = card1 + card2 + `
    <div class="idx-card"><div class="sub-note">시장 국면</div>
      <div class="lk-name" style="font-size:.98rem">🇰🇷 ${REGIME_KO[rg.kr] || "-"}<br>🇺🇸 ${REGIME_KO[rg.us] || "-"}</div></div>
    <div class="idx-card"><div class="sub-note">점검 결과</div>
      <div class="lk-name">${nBad ? `🔴 ${nBad}` : ""} ${nWarn ? `🟡 ${nWarn}` : ""} 🟢 ${arr.length - nBad - nWarn}</div>
      <div class="sub-note">${nBad ? "빨간 종목의 보유 논거부터 재점검" : nWarn ? "노란 종목 사유 확인" : "전 종목 흐름 양호"}</div></div>`;
}

function pfRenderList(arr) {
  const listEl = $("#pf-list");
  const concHtml = pfConc && pfConc[0] >= 0.4 ?
    `<p class="mini-note">⚠ <b>${pfConc[1]}</b> 섹터에 평가액의 ${Math.round(pfConc[0] * 100)}% 집중 — 분산을 점검하세요.</p>` : "";
  listEl.innerHTML = concHtml + arr.map((h, idx) => {
    const key = h.mk + "_" + h.ticker;
    const c = pfCheck(h);
    const logo = h.mk === "kr" ? `https://ssl.pstatic.net/imgstock/fn/real/logo/stock/Stock${h.ticker}.svg`
      : (EXTRAS.company?.map?.[key]?.logo || "");
    const rich = c.rich;
    const ret = rich ? h.plRate : (h.avg && c.cur ? c.cur / h.avg - 1 : null);
    const fd = EXTRAS.feed?.map?.[key];
    const rsArrow = c.rs ? (c.rs.rs_w1 > c.rs.rs_m1 ? "↗ 가속" : "↘ 감속") : "";
    const upside = c.cons?.target && c.nativeCur ? c.cons.target / c.nativeCur - 1 : null;
    const wonNote = h.mk === "us" ? ' <span class="sub-note">(원화환산)</span>' : "";
    const valRow = rich ? `
        <div class="prof-row"><span>평가금 · 손익</span>
          <span><b>${won(h.val)}</b> <b class="${h.pl >= 0 ? "pos" : "neg"}">${won(h.pl, true)}</b> (${pct(ret, 1)})</span></div>
        <div class="prof-row"><span>평균가 → 현재가${wonNote}</span>
          <span>${won(h.avg)} → ${won(h.price)} · ${h.qty}주</span></div>${h.dayPl != null ? `
        <div class="prof-row"><span>오늘 손익 (동기 시점)</span>
          <span><b class="${h.dayPl >= 0 ? "pos" : "neg"}">${won(h.dayPl, true)}</b>${h.dayRate != null ? ` (${pct(h.dayRate, 2)})` : ""}
            ${h.fee != null ? ` · 수수료 ${won(h.fee)}` : ""}${h.tax ? ` · 세금 ${won(h.tax)}` : ""}</span></div>` : ""}`
      : `<div class="prof-row"><span>보유 손익 (평단 ${h.avg ? fmtPrice(h.avg, h.mk) : "-"})</span>
          <span>${c.cur ? fmtPrice(c.cur, h.mk) : "-"} ${ret != null ? `<b class="${ret >= 0 ? "pos" : "neg"}">${pct(ret, 1)}</b>` : ""}</span></div>`;
    const rowsHtml = `
      <div class="prof-grid wide" style="margin-top:8px">${valRow}
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
        <span class="pf-name"><b>${h.name}</b> <span class="sub-note">${h.ticker} · ${h.qty}주</span>
          ${c.warns.map((w) => `<span class="pf-warn-badge ${TOSS_WARN[w.type][1]}">${TOSS_WARN[w.type][0]}</span>`).join("")}</span>
        <span class="pf-ret">${ret != null ? `<b class="${ret >= 0 ? "pos" : "neg"}">${pct(ret, 1)}</b>` : ""}</span>
        <span class="pf-grade ${c.grade}">${c.gradeTxt}</span>
      </summary>
      <p class="pf-reason">${c.grade === "good" ? "✅" : "⚠"} ${c.reasons.join(" · ")}</p>
      ${rowsHtml}${feedHtml}
      <div style="margin-top:10px;display:flex;gap:14px">
        <a href="#" class="goto-lookup pf-goto" data-key="${key}">종목 조회에서 상세 분석 →</a>
        <span style="flex:1"></span>
        <a href="#" class="pf-edit" data-tk="${h.ticker}">보유 포트폴리오에서 편집 →</a>
      </div>
    </details>`;
  }).join("") + `<p class="sub-note" style="margin-top:10px">판정 룰: 유효 매도신호(-2) · 섹터 전기간 약세(-1) ·
    외인+기관 동반매도(-1) · 1개월 상대성과 -10%p(-1) · 거래소 정리매매/투자위험(-2) · 투자경고/단기과열(-1)
    → 합계 -3↓=🔴 / -1~-2=🟡 / 0=🟢. 참고용 자동 판정.</p>`;

  listEl.querySelectorAll(".pf-goto").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    gotoTabFull("lookup");
    if (!lookupRendered) initLookup();
    loadLookup(a.dataset.key);
  }));
  listEl.querySelectorAll(".pf-edit").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    gotoTabFull("holdings");
    if (!holdingsRendered) initHoldings();
    hldOpenModal(pfHoldings().find((h) => h.ticker === a.dataset.tk));
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
    const line = `<polyline points="${pts.map((p) => p[0] + "," + p[1]).join(" ")}" fill="none" stroke="#f5445a" stroke-width="2"/>` +
      pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="#f5445a"/>` +
        (i === pts.length - 1 || i % 2 === 0 ? `<text x="${p[0]}" y="${p[1] - 6}" font-size="9" text-anchor="middle" fill="#b91c1c">${p[2]}%</text>` : "")).join("");
    return `<div class="guru-cash"><b>💰 현금성 자산 추이</b>
        <span class="sub-note">(막대=현금·현금성+채권 $B · <span style="color:#f5445a">라인=현금비중</span>
        =현금성/(현금성+주식포트) · SEC 10-Q, 단기 T-bill 별도태그 미포함)</span>
      <svg viewBox="0 0 ${W} ${H}" class="fin-svg">${bars}${line}${labels}</svg></div>`;
  };

  const mk = window._guruMk || "us";
  document.querySelectorAll("#guru-mk button").forEach((b) => {
    b.classList.toggle("active", b.dataset.mk === mk);
    b.onclick = () => { window._guruMk = b.dataset.mk; renderGurus(); };
  });
  $("#guru-agg").style.display = mk === "agg" ? "" : "none";
  $("#gurus-list").style.display = mk === "agg" ? "none" : "";
  if (mk === "agg") { renderGuruAgg(); return; }
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
  const gapColor = gap == null ? "#6b7280" : gap > 0.15 ? "#22c07a" : gap < -0.15 ? "#f5445a" : "#f59e0b";
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
  getJSON("sector_news.json"),
  getJSON("toss_market.json"),
])
  .then(([j, a, cm, rg, rcm, td, sm, mk, nw, mp, fd, gu, vl, dl, nb, db, na, da, cal, sn, tm]) => {
    DATA = j; APPLY = a; COMMENT = cm; REGIME = rg; RCOMMENT = rcm; TODAY = td; SIM = sm;
    MARKET = mk; NEWS = nw; MPRO = mp; FUND = fd; GURUS = gu; VAL = vl; DEALS = dl;
    NEWS_BRIEFS = nb; DEALS_BRIEFS = db; NEWS_ARCH = na; DEALS_ARCH = da; CAL = cal; SECNEWS = sn;
    TOSSM = tm;
    SELECTED_RULES = new Set((DATA?.rules || []).filter((r) => r.selected).map((r) => r.rule_id));
    document.getElementById("nav-back").onclick = () => {
      const prev = navStack.pop();
      if (!prev) return;
      navSuppress = true;
      gotoTabFull(prev);
      navSuppress = false;
      try { history.replaceState({ tab: prev }, "", "#" + prev); } catch (e) {}
      updateBackBtn();
    };
    const h0 = location.hash.slice(1);
    if (h0 && h0 !== "heatmap" && document.getElementById("tab-" + h0)) {
      navSuppress = true; gotoTabFull(h0); navSuppress = false;  // 딥링크 복원
    } else {
      renderHome();  // 첫 화면 = 마켓 홈 (IA 재편)
    }
  })
  .catch((e) => { $("#meta").textContent = "results.json 로드 실패 — 먼저 python analysis\\report.py 실행: " + e; });

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
let INVESTOR = null;   // investor.json — 시장별 투자자(개인·외국인·기관) 일별 동향 + 외국인/기관 순매수 랭킹(KR)
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
// ⚠상위 그룹을 새로 만들면 **여기에 기본 탭을 반드시 등록**할 것.
//   빠지면 그룹 버튼을 눌러도 activateTab(undefined)가 되어 화면이 비어 보인다(v245 딜 구조 실사고).
const lastTabOfGroup = { research: "rank", discover: "screener", market: "heatmap", journal: "holdings",
                         watch: "watch",            // 관심종목은 탭 1개짜리 상위 그룹(v210)
                         dealstruct: "dealstruct", ownership: "ownership" };

/* ---------- 소탭(통합 페이지) — nav에는 부모탭만, 자식은 섹션 상단 pill로 전환 ----------
   기존 섹션(id=tab-X)·렌더·딥링크는 그대로 두고 표시만 부모탭으로 묶는다. */
const SUB_PILLS = {   // 부모탭(nav에 남는 쪽) → [자식탭, 라벨][]
  // rotation(산업 진단)은 v163에서 nav 최상위로 승격 — 소탭에서 제외
  news:      [["news", "뉴스·딜"], ["calendar", "실적발표"], ["econcal", "경제지표"]],
  rank:      [["rank", "원칙"], ["chart", "사례 차트"]],
  holdings:  [["holdings", "보유 현황"], ["portfolio", "포트폴리오 점검"]],
};
const PILL_PARENT = { calendar: "news", econcal: "news", chart: "rank", portfolio: "holdings" };
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
const TAB_KO = { heatmap: "홈", macro: "매크로", internals: "시장 진단", rotation: "산업 진단", news: "뉴스·딜",
  calendar: "실적발표", econcal: "경제지표", gurus: "투자 대가", today: "오늘의 신호", trends: "트렌드", crypto: "크립토", assets: "자산시장", watch: "관심종목", disc: "공시 스캐너", lookup: "종목 조회", screener: "주식찾기", value: "내재가치",
  holdings: "보유 포트폴리오", portfolio: "포트폴리오 점검", journal: "매매일지", memo: "종목 메모", devlog: "개발일지",
  rank: "원칙", apply: "실전 검증", chart: "사례 차트",
  diary: "투자 다이어리", dealstruct: "딜 구조", ownership: "소유지분도" };
let navStack = [];
let navSuppress = false;
let currentTab = "heatmap";

// 그룹 nav·탭바 표시까지 동기화하는 완전 이동 (뒤로가기·해시 복원용)
function gotoTabFull(tabId) {
  const nav = document.querySelector(`.tabs [data-tab="${navIdOf(tabId)}"]`)?.closest(".tabs");
  /* v277: '종목 조회'는 어느 그룹에도 속하지 않는 **전역 화면**이 됐다(제목 라인 검색으로 진입).
     nav 버튼이 없으므로 여기서 그냥 return하면 화면이 안 바뀐다 → 소탭 줄만 접고 섹션을 연다.
     상단 그룹 버튼은 그대로 있어 언제든 원래 그룹으로 돌아갈 수 있다. */
  if (!nav) {
    if (!document.getElementById("tab-" + tabId)) return;
    document.querySelectorAll(".group").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".tabs").forEach((n) => { n.style.display = "none"; });
    activateTab(tabId);
    return;
  }
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
  if (tabId === "diary" && !diaryRendered) initDiary();
  if (tabId === "dealstruct" && !dealsStructRendered) initDealsStruct();
  if (tabId === "ownership" && !ownRendered) initOwnership();
  if (tabId === "holdings" && !holdingsRendered) initHoldings();
  if (tabId === "portfolio" && !portfolioRendered) initPortfolio();
  if (tabId === "memo") renderMemo();
  if (tabId === "devlog") renderDevlog();
  if (tabId === "heatmap") { if (!heatmapRendered) renderHome(); else setTimeout(syncHomeHeights, 0); }  // 재진입 시 우측 높이 재동기화(숨김상태 offsetHeight=0 회피)
  if (tabId === "calendar" && !calRendered) renderCalendar();
  if (tabId === "econcal" && !ecRendered) renderEconCal();
  if (tabId === "trends" && !trendsRendered) renderTrends();
  if (tabId === "crypto" && !cryptoRendered) renderCrypto();
  if (tabId === "assets" && !assetsRendered) renderAssets();
  if (tabId === "watch") renderWatch();
  if (tabId === "disc" && !discRendered) initDisc();
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

/* 데이터 출처·기준일 — 최하단 footer(#meta). 특정 탭이 아니라 사이트 전역 정보라
   부팅 시 1회 채운다(예전엔 헤더에 있고 원칙 탭 렌더 때만 채워졌음). */
function renderMetaFooter() {
  const el = $("#meta");
  if (!el || !DATA?.meta) return;
  const m = DATA.meta;
  const nextRevalidate = (() => {
    const d = new Date(DATA.generated);
    d.setDate(d.getDate() + 90);
    return d.toISOString().slice(0, 10);
  })();
  el.innerHTML =
    `한국 ${m.n_kr}종목 + 미국 ${m.n_us}종목 · ${m.period} 일봉 · 신호 표본 ${m.n_events.toLocaleString()}건<br>
     원칙 기준일 <b>${DATA.generated}</b> · 다음 재검증 가능일 <b>${nextRevalidate}</b>
     <span title="재검증(update_rules.py)은 90일 텀 — 잦은 재검증은 과최적화. 재검증 시 사례차트·2026적용·국면별원칙 탭도 함께 갱신됨">ⓘ 90일 텀</span>
     · 오늘의 신호는 매일 07:40 자동 갱신`;
}

function renderRank() {
  rankRendered = true;
  if (!regimeRendered) renderRegime();  // 국면별 원칙(흡수 섹션)
  const m = DATA.meta;
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

  renderTodayDash();
  ["today-mk", "today-side", "today-active-only"].forEach((id) =>
    document.getElementById(id).addEventListener("change", () => { renderTodayDash(); fillTodayTable(); }));
  fillTodayTable();
}

/* 📋 최신일 신호 요약 대시보드 — 매수/매도별 집계 + 상태(전환·최초·지속)별 종목 */
const SIG_STATUS = {
  flip: ["🔄", "방향 전환", "직전 신호와 반대 방향 — 흐름이 바뀌는 자리"],
  first: ["🆕", "첫 신호", "최근 120일간 이 종목에 신호가 없었음"],
  repeat: ["🔁", "같은 방향 지속", "직전에도 같은 방향 신호 — 추세가 이어지는 중"],
};
function todayLatest() {
  const ds = [...new Set(TODAY.signals.map((s) => s.date))].sort();
  return ds[ds.length - 1];
}
function renderTodayDash() {
  const host = $("#today-dash"); if (!host) return;
  const mk = $("#today-mk").value, activeOnly = $("#today-active-only").checked;
  const day = todayLatest();
  const rows = TODAY.signals.filter((s) => s.date === day && (!mk || s.market === mk) && (!activeOnly || s.active));
  // 종목 단위로 묶기(한 종목에 여러 원칙이 걸릴 수 있음)
  const byStock = {};
  rows.forEach((s) => {
    const k = `${s.market}_${s.ticker}`;
    const o = byStock[k] = byStock[k] || { s, rules: [], side: s.side, conflict: s.conflict };
    o.rules.push(s.rule);
    if (o.side !== s.side) o.mixed = true;
  });
  const list = Object.values(byStock);
  const bucket = (side, st) => list.filter((o) => !o.mixed && o.side === side && o.s.status === st);
  // 종목 타일 — 로고 + 이름 + (지속이면) 연속 횟수. 로고가 있어 한눈에 어느 회사인지 읽힌다.
  const tile = (o, side) => {
    const s = o.s, nm = s.market === "kr" ? s.name : s.ticker;
    const prev = s.prev_date ? `직전 ${s.prev_side === "buy" ? "매수" : "매도"} ${s.prev_date}` +
      (s.days_since ? ` (${s.days_since}거래일 전)` : "") : "최근 120일 내 이전 신호 없음";
    return `<button class="td-tile ${side}" data-key="${s.market}_${s.ticker}"
      title="${nm} · ${o.rules.join(" · ")}\n${prev}${s.streak > 1 ? `\n${s.streak}회 연속 ${side === "buy" ? "매수" : "매도"} 신호` : ""}">
      <img src="${logoUrl(s.market, s.ticker)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <span class="td-tnm">${nm}</span>
      ${s.streak > 1 ? `<span class="td-streak">${s.streak}</span>` : ""}</button>`;
  };
  const card = (side) => {
    const all = list.filter((o) => !o.mixed && o.side === side);
    const isBuy = side === "buy";
    const cells = ["flip", "first", "repeat"].map((st) => {
      const g = bucket(side, st);
      const [ico, label, tip] = SIG_STATUS[st];
      if (!g.length) return `<div class="td-cell empty"><div class="td-cell-h">${ico} ${label} <b>0</b></div></div>`;
      return `<div class="td-cell" title="${tip}">
        <div class="td-cell-h">${ico} ${label} <b>${g.length}</b>
          <span class="sub-note">${tip}</span></div>
        <div class="td-tiles">${g.slice(0, 16).map((o) => tile(o, side)).join("")}
          ${g.length > 16 ? `<span class="td-more">+${g.length - 16}</span>` : ""}</div></div>`;
    }).join("");
    return `<div class="td-card ${isBuy ? "buy" : "sell"}">
      <div class="td-card-h"><span class="td-dot ${isBuy ? "buy" : "sell"}"></span>
        ${isBuy ? "매수 신호" : "매도 신호"} <b>${all.length}</b><span class="sub-note">종목</span></div>
      ${cells}</div>`;
  };
  // ── 원칙(신호)별 정리 — 어떤 원칙이 오늘 많이 터졌나 ──
  const byRule = {};
  rows.forEach((s) => {
    const r = byRule[s.rule] = byRule[s.rule] || { rule: s.rule, side: s.side, list: [] };
    r.list.push(s);
  });
  const rules = Object.values(byRule).sort((a, b) => b.list.length - a.list.length);
  const ruleRow = (r) => {
    const isBuy = r.side === "buy";
    const uniq = [...new Map(r.list.map((s) => [`${s.market}_${s.ticker}`, s])).values()];
    return `<div class="td-rrow">
      <span class="td-rname ${isBuy ? "buy" : "sell"}">${isBuy ? "🟢" : "🔴"} ${r.rule}</span>
      <span class="td-rn">${uniq.length}</span>
      <span class="td-rtiles">${uniq.slice(0, 10).map((s) => `
        <button class="td-mini" data-key="${s.market}_${s.ticker}" title="${s.market === "kr" ? s.name : s.ticker}">
          <img src="${logoUrl(s.market, s.ticker)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('noimg')">
        </button>`).join("")}${uniq.length > 10 ? `<span class="td-more">+${uniq.length - 10}</span>` : ""}</span>
    </div>`;
  };
  const mixed = list.filter((o) => o.mixed || o.conflict);
  host.innerHTML = `<div class="td-dash-h">📋 <b>${day}</b> 신호 요약
      <span class="sub-note">종목 ${list.length}곳 · 숫자 배지 = 같은 방향 연속 횟수 · 타일 클릭 = 종목 조회</span></div>
    <div class="td-cards">${card("buy")}${card("sell")}</div>
    ${mixed.length ? `<div class="td-mixed"><b>⚠ 매수·매도 동시 발생 ${mixed.length}곳</b>
      <span class="sub-note">방향이 엇갈리니 판단을 미루는 편이 안전합니다</span>
      <div class="td-tiles">${mixed.slice(0, 12).map((o) => tile(o, "mix")).join("")}</div></div>` : ""}
    ${rules.length ? `<div class="td-rules"><b>📐 원칙별 <span class="sub-note">(오늘 어떤 원칙이 몇 종목에서 켜졌나 · 많이 터진 순)</span></b>
      ${rules.map(ruleRow).join("")}</div>` : ""}`;
  host.querySelectorAll(".td-tile, .td-mini").forEach((b) => b.onclick = () => {
    document.querySelector('[data-tab="lookup"]').click();
    loadLookup(b.dataset.key);
  });
}

function fillTodayTable() {
  const mk = $("#today-mk").value, side = $("#today-side").value;
  const activeOnly = $("#today-active-only").checked;
  const rows = TODAY.signals.filter((s) =>
    (!mk || s.market === mk) && (!side || s.side === side) && (!activeOnly || s.active));
  const stat = (s) => {
    const d = SIG_STATUS[s.status];
    if (!d) return "-";
    const prev = s.prev_date ? `직전 ${s.prev_side === "buy" ? "매수" : "매도"} ${s.prev_date}` +
      (s.days_since ? ` (${s.days_since}거래일 전)` : "") : "최근 120일 내 이전 신호 없음";
    return `<span class="td-stat ${s.status}" title="${d[2]} · ${prev}">${d[0]} ${d[1]}${
      s.status === "repeat" && s.streak > 1 ? ` <i>${s.streak}회</i>` : ""}</span>` +
      (s.conflict ? ` <span class="td-stat conflict" title="같은 날 반대 방향 신호도 발생">⚠ 엇갈림</span>` : "");
  };
  $("#today-table").innerHTML =
    `<tr><th>신호일</th><th>종목</th><th>원칙</th><th>방향</th><th>상태</th><th>종가</th><th>국면상</th><th>차트</th></tr>` +
    (rows.length ? rows.map((s, i) => `<tr style="${s.active ? "" : "opacity:.45"}">
      <td>${s.date}</td>
      <td class="td-stock"><img class="tbl-logo" src="${logoUrl(s.market, s.ticker)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <a href="#" class="goto-lookup" data-key="${s.market}_${s.ticker}">${s.market === "kr" ? s.name + " (" + s.ticker + ")" : s.ticker}</a></td>
      <td>${s.rule}</td><td>${s.side === "buy" ? "🟢 매수" : "🔴 매도"}</td>
      <td>${stat(s)}</td>
      <td>${s.price.toLocaleString()}</td><td>${s.active ? "✅ 유효" : "⛔ 꺼짐"}</td>
      <td><button class="today-chart-btn" data-i="${i}">📈 보기</button></td>
    </tr>`).join("") : `<tr><td colspan="8">조건에 맞는 신호 없음</td></tr>`);
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
    .then((r) => (r.ok ? r.json() : null)).then(normStock).then((st) => {
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
// 보조지표 설명(의미 + 숫자 읽는 법)
const OSC_TIP = {
  rsi: "<b>RSI (상대강도지수)</b><br>최근 14일 상승폭/하락폭의 비율을 0~100으로 나타낸 값.<br>· <b>70 이상</b> = 과매수(단기 과열, 조정 주의)<br>· <b>30 이하</b> = 과매도(단기 낙폭 과다, 반등 가능)<br>· 50 = 중립",
  macd: "<b>MACD (이동평균 수렴·확산)</b><br>단기(12)−장기(26) 지수이동평균의 차이. 시그널선(9일)과 함께 봅니다.<br>· MACD가 시그널선을 <b>상향 돌파</b> = 매수 신호<br>· <b>0선 위</b> = 상승 추세, 0선 아래 = 하락 추세<br>· 막대(히스토그램)가 커질수록 추세 강함",
  stoch: "<b>스토캐스틱</b><br>최근 N일 고저 범위에서 오늘 종가의 위치(%K, 0~100)와 그 평균선(%D).<br>· <b>80 이상</b> = 과매수, <b>20 이하</b> = 과매도<br>· %K가 %D를 상향 돌파 = 매수 신호",
  obv: "<b>OBV (온밸런스볼륨)</b><br>상승일 거래량은 더하고 하락일은 빼서 누적한 '매집/분산' 지표.<br>· 절대 숫자보다 <b>방향(추세)</b>이 중요<br>· 가격은 횡보인데 OBV가 우상향 = 매집(선행 상승 신호)<br>· 가격 신고가인데 OBV 미확인 = 세력 이탈 경계",
  disp: "<b>이격도</b><br>현재가가 이동평균선에서 얼마나 떨어졌는지(%).<br>· <b>100</b> = 이평선과 일치<br>· <b>110</b> = 이평 대비 10% 위(단기 과열)<br>· <b>90</b> = 10% 아래(단기 과냉, 되돌림 가능)",
};
function bindOscTips() {
  let tip = document.getElementById("osc-tip");
  if (!tip) { tip = document.createElement("div"); tip.id = "osc-tip"; document.body.appendChild(tip); }
  document.querySelectorAll("#lookup-osc .osc-i").forEach((ic) => {
    if (ic.dataset.bound) return; ic.dataset.bound = "1";
    const show = (e) => {
      tip.innerHTML = OSC_TIP[ic.dataset.tip] || "";
      tip.style.display = "block";
      const r = ic.getBoundingClientRect();
      tip.style.left = Math.min(r.left, window.innerWidth - 320) + "px";
      tip.style.top = (r.bottom + 8) + "px";
    };
    ic.addEventListener("mouseenter", show);
    ic.addEventListener("mouseleave", () => { tip.style.display = "none"; });
  });
}

function initLookup() {
  lookupRendered = true;
  bindOscTips();
  fetch("data/stocks/index.json" + _cb).then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (!j) { $("#lookup-info").style.display = "block"; $("#lookup-info").textContent = "stocks/index.json 없음 — python analysis\\stock_pages.py 실행 필요"; return; }
    LOOKUP_INDEX = j.stocks;
    $("#lookup-list").innerHTML = LOOKUP_INDEX.map((s) =>
      `<option value="${s.market === "kr" ? s.name + " (" + s.ticker + ")" : s.ticker}">`).join("");
  });
}

/* 🔍 전역 종목 검색(v277) — 헤더에 상시 노출. 어느 탭에서든 종목 조회로 이동한다.
   ⚠종목조회 탭에 처음 들어가기 전에도 동작해야 하므로 인덱스를 **앱 시작 시** 받아 둔다
     (전에는 initLookup 안에서만 받아 다른 탭에선 검색이 죽어 있었다). */
async function initHeaderSearch() {
  const el = document.getElementById("hdr-q");
  if (!el) return;
  if (!LOOKUP_INDEX) await aiIndexReady();
  const dl = document.getElementById("lookup-list");
  if (dl && !dl.children.length && LOOKUP_INDEX)
    dl.innerHTML = LOOKUP_INDEX.map((x) =>
      `<option value="${x.market === "kr" ? x.name + " (" + x.ticker + ")" : x.ticker}">`).join("");
  const go = () => {
    const q = el.value.trim().toLowerCase();
    if (!q) return;
    const hit = (LOOKUP_INDEX || []).find((x) =>
      q === x.ticker.toLowerCase() || q === x.name.toLowerCase() ||
      q === (x.name + " (" + x.ticker + ")").toLowerCase() ||
      x.name.toLowerCase().includes(q) || x.ticker.toLowerCase().includes(q));
    if (!hit) return;
    gotoTabFull("lookup");
    if (!lookupRendered) initLookup();
    loadLookup(hit.market + "_" + hit.ticker);
  };
  el.addEventListener("change", go);
  el.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
}

/* v214: stocks/*.json의 series는 용량 때문에 **압축 배열** [t,o,h,l,c,v]로 저장된다.
   (10년 2,520봉을 담고도 구 dict 5년보다 작다) 로드 직후 여기서 객체로 되돌려
   기존 소비자 코드(st.series[i].c 등)는 그대로 동작하게 한다. 구 dict 파일도 통과. */
function normStock(st) {
  const s = st && st.series;
  if (Array.isArray(s) && Array.isArray(s[0]))
    st.series = s.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
  return st;
}

function loadLookup(key) {
  fetch(`data/stocks/${key}.json` + _cb).then((r) => (r.ok ? r.json() : null)).then(normStock).then((st) => {
    if (!st) {  // 유니버스엔 있으나 종목 파일이 아직 없음(주1 갱신 지연) — 안내만
      const h = document.getElementById("lookup-head");
      if (h) { h.style.display = ""; h.innerHTML = `<div class="lk-title"><div class="lk-name">데이터 준비 중 <span class="sub-note">이 종목은 곧 수집 예정입니다</span></div></div>`; }
      const ind = document.getElementById("lookup-industry"); if (ind) ind.style.display = "none";
      return;
    }
    LOOKUP_ST = st;
    ["lookup-info", "lookup-chart", "lookup-legend", "lookup-stats-title", "lookup-stats-wrap",
     "lookup-filter", "lookup-profile", "draw-tools"]
      .forEach((id) => { document.getElementById(id).style.display = ""; });
    $("#lookup-filter").style.display = "flex";
    const hq = document.getElementById("hdr-q");
    if (hq) hq.value = st.market === "kr" ? `${st.name} (${st.ticker})` : st.ticker;
    // v213: 위 sticky 바의 종목 요약은 아래 헤더(#lookup-head)와 같은 정보라 제거 — 헤더 자체를 고정한다.
    $("#lk-sticky").classList.remove("empty");
    const hint = $("#lk-sticky-hint");
    if (hint) hint.style.display = "none";       // 종목 선택 후엔 안내문 숨김(검색창만 남김)
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
        if (TF_INTRA.has(lookupTf)) {   // 분봉은 주기별 개별 파일 lazy 로드 후 그림
          const tf = lookupTf;
          (tf === "1m" ? loadMinuteBars(LOOKUP_ST) : loadHistBars(LOOKUP_ST, tf))
            .then(() => { if (lookupTf === tf) drawLookupChart(); });
          return;
        }
        drawLookupChart();
      });
      // 보조지표 체크박스 — 복수 선택, 변경 시 재그림 (차트 안 상단 오버레이로 이동해 tfbar 밖에 있다)
      document.querySelectorAll("#lookup-osc input[type=checkbox]").forEach((cb) => cb.onchange = () => {
        lookupOscs = [...document.querySelectorAll("#lookup-osc input:checked")].map((x) => x.value);
        drawLookupChart();
      });
    }
    const oscRail = $("#lookup-osc");
    if (oscRail) oscRail.style.display = "flex";
    // 분봉 버튼(당일 1분 / 5분 60일 / 60분 2년) — 수집된 종목만 노출. 없으면 일봉으로 되돌림.
    const key0 = `${st.market}_${st.ticker}`;
    Promise.all([loadIntradayIndex(), loadIntraHistIndex()]).then(([idx, hidx]) => {
      if (LOOKUP_ST !== st) return;
      const avail = {
        "1m": !!idx?.stocks?.[key0],
        "5m": (hidx?.stocks?.[key0] || []).includes("5m"),
        "60m": (hidx?.stocks?.[key0] || []).includes("60m"),
      };
      Object.entries(avail).forEach(([tf, has]) => {
        const b = document.getElementById(`tf-${tf}`);
        if (b) b.style.display = has ? "" : "none";
      });
      if (!TF_INTRA.has(lookupTf)) return;
      if (avail[lookupTf]) {   // 분봉 유지 — 새 종목 데이터 로드 후 재그림
        (lookupTf === "1m" ? loadMinuteBars(st) : loadHistBars(st, lookupTf))
          .then(() => { if (LOOKUP_ST === st) drawLookupChart(); });
      } else {                 // 이 종목엔 해당 분봉 없음 → 일봉으로 복귀
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
      // 실적·재무 추이는 renderLookupFinancials(financials fetch) 완료 후 renderFinTrends가 통합 렌더
      // (구 renderLookupFin/FinQ/Stability는 v132에서 통합 카드로 대체 — 연간/분기 정보 통일)
      renderLookupSurprise(st);
      renderLookupDividend(st);
      renderLookupPeers(st);
      renderLookupFinancials(st);
      renderLookupReports(st);
      renderLookupFeed(st);
    });

    drawLookupChart();
    bindDrawTools();            // 그리기 도구(추세선·박스권) 1회 바인딩
    setDrawMode("");            // 종목 전환 시 이동 모드로 초기화(+저장된 그림 재배치)
    renderLookupMemo(st);       // 이 종목 메모 카드
    renderLookupWhy(st);        // 🤔 AI 변동 사유(공시·뉴스·수급 근거)

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
let lookupHideSignals = false;   // '전체 해제' — 신호 마커 전부 숨김(캔들만 보기)
const TF_KO = { "1m": "당일 1분", "5m": "5분(60일)", "60m": "60분(2년)", d: "일봉", w: "주봉", m: "월봉" };
const TF_INTRA = new Set(["1m", "5m", "60m"]);   // 분봉 계열(원칙 신호는 일봉 기준이라 미표시)

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

/* 과거 분봉(5분 60일 · 60분 2년) — intraday_hist.py 산출물. 유동성 상위 종목만 존재. ────────── */
let INTRA_HIST = null;
function loadIntraHistIndex() {
  if (INTRA_HIST) return Promise.resolve(INTRA_HIST);
  return fetch("data/intraday/hist_index.json" + _cb)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (INTRA_HIST = j || { stocks: {} }));
}
/* rows(["MM-DD HH:MM",o,h,l,c,v]) → 차트 시리즈.
   ⚠연도가 없다 — 60분봉은 2년치라 월이 되돌아가는 지점(12월→1월)에서 해를 넘겨야 한다.
     뒤에서부터 훑으며 월이 커지면 연도를 하나 줄이는 방식으로 복원한다. */
function histSeries(rows) {
  const now = new Date();
  let y = now.getFullYear(), prevM = null;
  const out = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    const [md, hm] = r[0].split(" ");
    const [M, D] = md.split("-").map(Number);
    const [hh, mm] = hm.split(":").map(Number);
    if (prevM != null && M > prevM) y -= 1;     // 역순 주행 중 월이 커짐 = 연말을 넘어감
    prevM = M;
    out.push({ t: Date.UTC(y, M - 1, D, hh, mm) / 1000, o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] });
  }
  out.reverse();
  return out;
}
function loadHistBars(st, tf) {
  const key = `${st.market}_${st.ticker}`;
  st._hist = st._hist || {};
  if (st._hist[tf]) return Promise.resolve(st._hist[tf]);
  return fetch(`data/intraday/${key}_${tf}.json` + _cb)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (!j?.rows?.length) return null;
      const s = histSeries(j.rows);
      taEnrich(s);
      st._hist[tf] = s;
      return s;
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
  const hol = TOSSM?.calendar?.[st.market]?.holidays || [];
  const openHm = st.market === "us" ? "09:30" : "09:00";
  const closeHm = st.market === "us" ? "16:00" : "15:30";
  const isTradingDay = clk.dow !== "Sat" && clk.dow !== "Sun" && !hol.includes(clk.day);
  // 봉을 붙일 날짜: 개장 후=오늘 / 개장 전(자정~)·주말·휴장일=직전 영업일
  // (자정 넘으면 잠정 당일봉이 '내일 장 시작 전'으로 판정돼 어제 봉이 사라지던 문제 — 확정 배치는 07:40에나 붙음)
  let barDay;
  if (isTradingDay && clk.hm >= openHm) {
    barDay = clk.day;
  } else {
    const [y, m, d] = clk.day.split("-").map(Number);
    let dt = new Date(y, m - 1, d);
    for (let i = 0; i < 10 && !barDay; i++) {
      dt = new Date(dt.getTime() - 864e5);
      const ds = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      if (dt.getDay() !== 0 && dt.getDay() !== 6 && !hol.includes(ds)) barDay = ds;
    }
    if (!barDay) return;
  }
  const inSession = isTradingDay && clk.hm >= openHm && clk.hm <= closeHm;
  const last = s[s.length - 1];
  if (last.t === barDay) {
    // 해당 봉이 이미 있음(따라잡기 배치의 장중 스냅샷 등) — 최신 시세로 종가·고저 갱신.
    // 한국: 마감 후 시세=정규장 확정 종가라 항상 안전(장중 스냅샷이 멈춘 종가도 교정).
    // 미국: 장중에만 — 애프터마켓 시세가 확정 종가를 덮으면 안 됨.
    const canUpdate = st.market === "kr" ? true : inSession;
    if (canUpdate && q[0] !== last.c) {
      last.c = q[0]; last.h = Math.max(last.h, q[0]); last.l = Math.min(last.l, q[0]);
      last.live = true; st._live = true;
    }
    return;
  }
  if (last.t > barDay) return;
  const c = q[0], r = q[1];
  const o = r != null && 1 + r !== 0 ? +(c / (1 + r)).toFixed(4) : c;
  st.series = s.concat([{ t: barDay, o, h: Math.max(o, c), l: Math.min(o, c), c, v: 0, live: true }]);
  st._live = true;
}

function drawLookupChart() {
  const st = LOOKUP_ST;
  appendLiveBar(st);                                    // 잠정 당일봉(있으면) 먼저 — 지표도 포함해 계산
  if (!st._ta) { taEnrich(st.series); st._ta = true; }  // 지표는 클라이언트 계산(OHLCV 슬림 JSON)
  const tf = lookupTf;
  // 분봉 계열(1m 당일 / 5m 60일 / 60m 2년) — 원칙 신호는 일봉 기준이라 미표시
  const minBars = tf === "1m" ? st._min : (TF_INTRA.has(tf) ? st._hist?.[tf] : null);
  const isMin = TF_INTRA.has(tf) && minBars?.length;
  const s = isMin ? minBars : resampleBars(st.series, tf);
  const selRule = lookupRuleSel;           // "" = 전체(원칙 목록 클릭으로 선택)
  $("#lookup-info").innerHTML =
    `<b>${st.market === "kr" ? st.name + " (" + st.ticker + ")" : st.ticker}</b> · `
    + (isMin
      ? (tf === "1m"
          ? `${INTRADAY?.date || ""} 당일 1분봉 · ${INTRADAY?.generated || ""} 수집 · 원칙 신호는 일봉 기준이라 표시되지 않습니다`
          : `${TF_KO[tf]} · ${s.length.toLocaleString()}봉 · 원칙 신호는 일봉 기준이라 표시되지 않습니다`)
      : `기준일 ${st.asof} · ${TF_KO[tf]} · 최근 10년 (좌우로 드래그·스크롤)`
        + (st._live ? ` · <b>최신 봉=30분 지연 잠정치</b><span class="sub-note">(고저 미확정 · 확정봉은 다음 배치 07:40)</span>` : "")
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
  /* v278: 라디오 필터를 없앴다. 기본을 "core"로 두면 **참고(미채택) 원칙을 눌러도 마커가 안 뜬다**
     → 전체를 그리고, 어떤 원칙을 볼지는 원칙 목록 클릭(lookupRuleSel)이 결정한다. */
  const filt = "all";
  // '전체 해제'(sig-none)면 마커를 전부 숨긴다 — 캔들만 깨끗하게 보고 싶을 때
  const shown = (isMin || lookupHideSignals ? [] : st.markers).filter((m) => {   // 분봉엔 일봉 기준 신호 미표시
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
  // 그리기 오버레이 + 공시 띠 재배치 (줌/스크롤에 연동해 봉 위치를 따라감)
  lookupChart.timeScale().subscribeVisibleLogicalRangeChange(() => { redrawDrawings(); drawDiscBand(); });
  requestAnimationFrame(() => { redrawDrawings(); drawDiscBand(); });
  // ⚠공시 띠는 timeToCoordinate가 필요한데 차트 레이아웃 **한 프레임 뒤**에야 좌표가 나온다.
  // 게다가 미리보기 도구는 rAF를 발화시키지 않으므로 setTimeout 폴백을 함께 건다(양쪽 다 멱등).
  setTimeout(drawDiscBand, 0);
  setTimeout(drawDiscBand, 180);
}

/* ---------- 공시 띠 — 차트 x축 아래 공시일 표시 ----------
   소스: feed.json의 종목별 disc(최근 1년·최대 15건, {d,title,link}).
   좌표는 차트 timeScale().timeToCoordinate()로 뽑아 **캔들과 같은 x**에 찍는다
   (SVG 폭 = 차트 폭이라 가격축 영역만큼 오른쪽이 비는 것도 차트와 동일). */
function discBandItems() {
  const st = LOOKUP_ST;
  if (!st) return [];
  const arr = EXTRAS.feed?.map?.[`${st.market}_${st.ticker}`]?.disc || [];
  const by = {};
  arr.forEach((x) => {
    const d = (x.d || "").slice(0, 10);
    if (!d) return;
    (by[d] = by[d] || []).push({ title: (x.title || "").replace(/\s+/g, " ").trim(), link: x.link });
  });
  return Object.entries(by).map(([d, list]) => ({ d, list })).sort((a, b) => (a.d < b.d ? -1 : 1));
}

function drawDiscBand() {
  const host = document.getElementById("lookup-discband");
  const el = document.getElementById("lookup-chart");
  if (!host || !el || !lookupChart || !LOOKUP_ST) return;
  const items = discBandItems();
  if (!items.length) { host.style.display = "none"; return; }
  const ts = lookupChart.timeScale();
  const w = el.clientWidth, H = 30;
  // 주/월봉은 공시일이 봉 사이에 있어 좌표가 안 나온다 → 그 이상의 첫 봉으로 스냅
  const bars = (LOOKUP_ST.series || []).map((x) => x.t);
  const snapTo = (d) => {
    if (lookupTf === "d") return d;
    for (const b of bars) if (b >= d) return b;
    return null;
  };
  const dots = [];
  items.forEach((it) => {
    const t = snapTo(it.d);
    if (!t) return;
    let x = null;
    try { x = ts.timeToCoordinate(t); } catch (e) { x = null; }
    if (x == null || x < 0 || x > w) return;      // 화면 밖(줌/스크롤)이면 생략
    dots.push({ x, ...it });
  });
  host.style.display = "";
  if (!dots.length) {
    host.innerHTML = `<div class="disc-band-empty">이 구간에 공시 없음 — 좌우로 스크롤하면 공시일이 표시됩니다</div>`;
    return;
  }
  host.innerHTML = `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" class="disc-band-svg">
      <line x1="0" y1="${H / 2}" x2="${w}" y2="${H / 2}" stroke="var(--line)"/>
      ${dots.map((p, i) => {
        const multi = p.list.length > 1;
        return `<g class="disc-dot" data-i="${i}" style="cursor:pointer">
          <circle cx="${p.x.toFixed(1)}" cy="${H / 2}" r="${multi ? 7 : 5}"
            fill="${multi ? "#f0b34c" : "#4391ff"}" fill-opacity=".85" stroke="var(--bg)" stroke-width="1.5"/>
          ${multi ? `<text x="${p.x.toFixed(1)}" y="${H / 2 + 3.5}" text-anchor="middle"
            font-size="9" font-weight="700" fill="#17171c">${p.list.length}</text>` : ""}
        </g>`;
      }).join("")}
    </svg><span class="disc-band-label">📢 공시</span>`;
  // 말풍선: 마우스를 툴팁 위로 옮겨 링크를 누를 수 있게 pointer-events 유지 + 지연 숨김
  let tip = document.getElementById("disc-tip");
  if (!tip) { tip = document.createElement("div"); tip.id = "disc-tip"; document.body.appendChild(tip); }
  let hideT = null;
  const keep = () => { if (hideT) { clearTimeout(hideT); hideT = null; } };
  const hide = () => { hideT = setTimeout(() => { tip.style.display = "none"; }, 260); };
  tip.onmouseenter = keep;
  tip.onmouseleave = hide;
  host.querySelectorAll(".disc-dot").forEach((g) => {
    const p = dots[+g.dataset.i];
    g.addEventListener("mouseenter", () => {
      keep();
      tip.innerHTML = `<div class="dt-h">${p.d} · 공시 ${p.list.length}건</div>` +
        p.list.map((x) => `<a class="dt-row" href="${x.link}" target="_blank" rel="noopener">${x.title}<span class="dt-go">DART ↗</span></a>`).join("");
      tip.style.display = "block";
      const r = g.getBoundingClientRect();
      tip.style.left = Math.max(8, Math.min(r.left - 130, window.innerWidth - 340)) + "px";
      const th = tip.offsetHeight || 120;
      // 아래 공간이 부족하면 위로 뒤집는다
      tip.style.top = (r.bottom + th + 12 > window.innerHeight ? r.top - th - 10 : r.bottom + 10) + "px";
    });
    g.addEventListener("mouseleave", hide);
    g.addEventListener("click", () => { if (p.list[0]?.link) window.open(p.list[0].link, "_blank", "noopener"); });
  });
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
  svg.innerHTML = arr.map((d, i) => drawShapeSvg(d, i, X, Y, w, h)).join("")
    + `<g id="dw-sel-layer"></g>`;
  /* ⚠클릭 히트영역 — 1px 선은 정확히 누르기가 매우 어렵다(사용자: "지우기가 너무 어려움").
     같은 좌표에 **투명 굵은 선(12px)** 을 겹쳐 깔아 그것으로 집는다. */
  svg.querySelectorAll(".dw-hit").forEach((sh) => {
    // 선택은 '이동/선택' 모드에서만 — 그리기 중에는 도형 위에서 시작해도 그려져야 한다
    sh.onclick = (ev) => { if (drawMode) return; ev.stopPropagation(); drawSelect(+sh.dataset.i); };
    sh.oncontextmenu = (ev) => { ev.preventDefault(); ev.stopPropagation(); drawDelete(+sh.dataset.i); };
  });
  drawPaintSelection();
}

/* 도형 1개 → SVG. 보이는 도형 + 그 위에 투명 히트영역(클릭용)을 함께 낸다. */
function drawShapeSvg(d, i, X, Y, w, h) {
  const col = d.color || "#4391ff";
  const stl = drawShapeStyle(col, d.style || "solid", d.type === "box");
  const hit = `class="dw-hit" data-i="${i}" stroke="transparent" stroke-width="12" fill="none"`;
  const x1 = X(d.t1, d.fo1), y1 = Y(d.p1);
  if (x1 == null || y1 == null) return "";
  // 수평선·수직선·텍스트는 한 점만 있으면 그려진다(끝점 없어도 됨)
  if (d.type === "hline")
    return `<line class="dw" data-i="${i}" style="${stl}" x1="0" y1="${y1}" x2="${w}" y2="${y1}"/>
      <text class="dw-lab" x="4" y="${y1 - 4}" fill="${col}">${fmtPrice(d.p1, LOOKUP_ST?.market)}</text>
      <line ${hit} x1="0" y1="${y1}" x2="${w}" y2="${y1}"/>`;
  if (d.type === "vline")
    return `<line class="dw" data-i="${i}" style="${stl}" x1="${x1}" y1="0" x2="${x1}" y2="${h}"/>
      <line ${hit} x1="${x1}" y1="0" x2="${x1}" y2="${h}"/>`;
  if (d.type === "text")
    return `<text class="dw dw-text" data-i="${i}" x="${x1}" y="${y1}" fill="${col}">${String(d.text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</text>
      <rect ${hit} x="${x1 - 4}" y="${y1 - 14}" width="${Math.max(24, (d.text || "").length * 9 + 8)}" height="20" stroke="none" fill="transparent"/>`;
  const x2 = X(d.t2, d.fo2), y2 = Y(d.p2);
  if (x2 == null || y2 == null) return "";
  if (d.type === "trend")
    return `<line class="dw" data-i="${i}" style="${stl}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>
      <line ${hit} x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  if (d.type === "arrow")
    return `<line class="dw" data-i="${i}" style="${stl}" marker-end="url(#dw-arrow)" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>
      <line ${hit} x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  if (d.type === "fib") {
    // 되돌림 = 시작가(p1)~끝가(p2) 구간의 23.6/38.2/50/61.8/78.6%
    const lv = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
    return lv.map((r) => {
      const p = d.p1 + (d.p2 - d.p1) * r, y = Y(p);
      if (y == null) return "";
      return `<line class="dw dw-fib" data-i="${i}" stroke="${col}" stroke-dasharray="${r === 0 || r === 1 ? "none" : "4 3"}"
          x1="${lo}" y1="${y}" x2="${hi}" y2="${y}"/>
        <text class="dw-lab" x="${hi + 3}" y="${y - 3}" fill="${col}">${(r * 100).toFixed(1)}%</text>`;
    }).join("") + `<line ${hit} x1="${lo}" y1="${Y(d.p1)}" x2="${hi}" y2="${Y(d.p1)}"/>
      <line ${hit} x1="${lo}" y1="${Y(d.p2)}" x2="${hi}" y2="${Y(d.p2)}"/>`;
  }
  // box
  return `<rect class="dw" data-i="${i}" style="${stl}" x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}"
      width="${Math.abs(x2 - x1)}" height="${Math.abs(y2 - y1)}"/>
    <rect ${hit} x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}" width="${Math.abs(x2 - x1)}" height="${Math.abs(y2 - y1)}"/>`;
}

/* ── 선택·삭제·되돌리기 ── */
let drawSel = null;          // 선택된 그림 인덱스
const DRAW_UNDO = [];        // 스냅샷 스택(종목 전환 시 비움)
function drawPush() {        // 변경 직전 상태 저장
  const k = drawKey(); if (!k) return;
  DRAW_UNDO.push(JSON.stringify(drawLoad()[k] || []));
  if (DRAW_UNDO.length > 30) DRAW_UNDO.shift();
}
function drawSelect(i) {
  drawSel = (drawSel === i) ? null : i;
  drawPaintSelection();
}
function drawPaintSelection() {
  const svg = document.getElementById("lookup-draw");
  if (!svg) return;
  svg.querySelectorAll(".dw").forEach((el) => el.classList.toggle("on", +el.dataset.i === drawSel));
  const del = document.getElementById("draw-del");
  if (del) del.disabled = drawSel == null;
}
function drawDelete(i) {
  const o = drawLoad(), k = drawKey();
  if (!o[k] || i == null || !o[k][i]) return;
  drawPush();
  o[k].splice(i, 1);
  if (!o[k].length) delete o[k];
  drawSaveAll(o);
  drawSel = null;
  redrawDrawings();
}
function drawUndo() {
  const k = drawKey();
  if (!k || !DRAW_UNDO.length) return;
  const o = drawLoad();
  const prev = JSON.parse(DRAW_UNDO.pop());
  if (prev.length) o[k] = prev; else delete o[k];
  drawSaveAll(o);
  drawSel = null;
  redrawDrawings();
}

const DRAW_HINT = {
  "": "그림을 클릭하면 선택됩니다 (Delete=삭제 · 우클릭=바로 삭제) · 빈 곳 드래그는 차트 이동",
  trend: "두 점을 드래그해 추세선을 그립니다",
  hline: "누른 지점의 가격에 수평선을 긋습니다(지지·저항)",
  vline: "누른 지점의 날짜에 수직선을 긋습니다",
  box: "드래그해 박스권을 그립니다",
  arrow: "드래그 방향으로 화살표를 그립니다",
  fib: "고점→저점(또는 반대)을 드래그하면 되돌림 비율선이 나옵니다",
  text: "클릭한 자리에 메모를 남깁니다",
};
// 한 번 클릭으로 끝나는 도구(드래그 불필요)
const DRAW_CLICK1 = new Set(["hline", "vline", "text"]);

function setDrawMode(m) {
  drawMode = m;
  drawSel = null;
  const svg = document.getElementById("lookup-draw");
  // ⚠선택 모드("")에서도 그림은 클릭할 수 있어야 한다 → SVG는 항상 이벤트를 받고,
  //   빈 곳(도형 밖)은 CSS `pointer-events:none`(SVG 자체) + 도형만 auto로 통과시킨다.
  if (svg) svg.style.pointerEvents = m ? "auto" : "none";
  document.querySelectorAll("#draw-mode button").forEach((b) => b.classList.toggle("active", b.dataset.dm === m));
  const msg = DRAW_HINT[m] || DRAW_HINT[""];
  const hint = document.getElementById("draw-hint");
  if (hint) hint.textContent = msg;
  const rail = document.getElementById("draw-tools");
  if (rail) rail.title = `✏️ 그리기 — ${msg}`;
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
    drawPush();
    const o = drawLoad(); delete o[drawKey()]; drawSaveAll(o); drawSel = null; redrawDrawings();
  };
  document.getElementById("draw-undo").onclick = drawUndo;
  document.getElementById("draw-del").onclick = () => drawDelete(drawSel);
  // 키보드: Delete=선택 삭제 · Ctrl+Z=되돌리기 · Esc=선택 해제 (입력 중일 땐 무시)
  if (!window.__drawKeys) {
    window.__drawKeys = true;
    document.addEventListener("keydown", (ev) => {
      if (currentTab !== "lookup") return;
      const tag = (ev.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || ev.target.isContentEditable) return;
      if ((ev.key === "Delete" || ev.key === "Backspace") && drawSel != null) { ev.preventDefault(); drawDelete(drawSel); }
      else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") { ev.preventDefault(); drawUndo(); }
      else if (ev.key === "Escape") { drawSel = null; drawPaintSelection(); }
    });
  }
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
    if (!drawMode || !lookupCandles) return;
    const c = toData(ev);
    if (DRAW_CLICK1.has(drawMode)) {          // 수평선·수직선·텍스트는 클릭 한 번으로 완성
      if (c.p == null || (c.t == null && c.fo == null)) return;
      let text = null;
      if (drawMode === "text") {
        text = prompt("메모 내용");
        if (!text) return;
      }
      drawPush();
      const o = drawLoad(), k = drawKey();
      (o[k] = o[k] || []).push({ type: drawMode, t1: c.t, fo1: c.fo, p1: c.p,
        color: drawColor, style: drawStyle, ...(text ? { text } : {}) });
      drawSaveAll(o);
      redrawDrawings();
      return;
    }
    start = c;
    try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!start) return;
    const c = toData(ev);
    const prev = svg.querySelector(".dw-preview"); if (prev) prev.remove();
    const stl = drawShapeStyle(drawColor, drawStyle, drawMode === "box");
    let el;
    if (drawMode === "box")
      el = `<rect class="dw dw-preview" style="${stl}" x="${Math.min(start.x, c.x)}" y="${Math.min(start.y, c.y)}" width="${Math.abs(c.x - start.x)}" height="${Math.abs(c.y - start.y)}"/>`;
    else if (drawMode === "fib") {           // 미리보기는 양 끝선만(확정 시 비율선 전체)
      el = `<rect class="dw dw-preview" style="stroke:${drawColor};fill:${hexRGBA(drawColor, 0.07)}"
        x="${Math.min(start.x, c.x)}" y="${Math.min(start.y, c.y)}" width="${Math.abs(c.x - start.x)}" height="${Math.abs(c.y - start.y)}"/>`;
    } else
      el = `<line class="dw dw-preview" style="${stl}"${drawMode === "arrow" ? ' marker-end="url(#dw-arrow)"' : ""}
        x1="${start.x}" y1="${start.y}" x2="${c.x}" y2="${c.y}"/>`;
    svg.insertAdjacentHTML("beforeend", el);
  });
  const finish = (ev) => {
    if (!start) return;
    const end = toData(ev);
    const okA = start.t != null || start.fo != null, okB = end.t != null || end.fo != null;
    if (okA && okB && start.p != null && end.p != null && (Math.abs(end.x - start.x) > 3 || Math.abs(end.y - start.y) > 3)) {
      drawPush();
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
/* ---------- 개발일지 (개발 내역 타임라인 + 아이디어 관리, localStorage) ---------- */
// 관리자 전용 메뉴 — yoo7337@gmail.com 로그인 시(또는 localhost 개발 환경)만 우측 버튼 노출
const ADMIN_EMAIL = "yoo7337@gmail.com";
function adminSetup() {
  const btn = document.getElementById("admin-devlog");
  if (!btn) return;
  btn.onclick = () => activateTab("devlog");
  const show = () => { btn.style.display = ""; };   // 위치는 페이지 최하단(.admin-foot) 고정
  if (["localhost", "127.0.0.1"].includes(location.hostname)) show();
  else if ((window.__userEmail || "") === ADMIN_EMAIL) show();
  window.addEventListener("authuser", (e) => { if (e.detail === ADMIN_EMAIL) show(); });
}
adminSetup();

// 개발 내역(버전별 릴리스) — 최신순. 새 기능 배포 시 여기 맨 위에 한 줄 추가.

/* ==========================================================================
   🤖 전역 AI 어시스턴트 (v231) — 어느 탭에서나 종목·시장 전반 질문에 답한다.
   설계: 질문에서 ①종목 ②의도를 규칙으로 뽑아 **필요한 JSON만** 로드→컨텍스트 조립→Gemini.
   무료 등급이라 라우팅을 LLM에 맡기지 않는다(호출 2배). 컨텍스트는 8k자 예산으로 압축.
   ⚠검색 그라운딩·모델 지식은 못 쓴다(2026-08-01 실측) → 자료에 없으면 "자료 없음"이라 답하게 강제.
   ========================================================================== */
const AI_ALIAS = {   // 한글 통칭 → 티커 (US는 LOOKUP_INDEX에 한글명이 없다)
  메타: "META", 페북: "META", 페이스북: "META", 애플: "AAPL", 테슬라: "TSLA", 엔비디아: "NVDA",
  구글: "GOOGL", 알파벳: "GOOGL", 아마존: "AMZN", 마소: "MSFT", 마이크로소프트: "MSFT",
  넷플릭스: "NFLX", 브로드컴: "AVGO", 팔란티어: "PLTR", 버크셔: "BRK-B", 인텔: "INTC",
  삼전: "005930", 하닉: "000660", 삼바: "207940",
  // 영문 사명 KR 종목(94개) — 한글로 부르는 통칭을 티커로 이어준다
  네이버: "035420", 에스오일: "010950", 에쓰오일: "010950", 엘지: "003550", 엘지전자: "066570",
  현대글로비스: "086280", 하이브: "352820", 케이티: "030200", 에이치엠엠: "011200",
};
let AI_LOG = [];          // [{role:"user"|"ai", text}]
let AI_BUSY = false;

function aiIndexReady() {
  if (LOOKUP_INDEX) return Promise.resolve(LOOKUP_INDEX);
  return fetch("data/stocks/index.json" + _cb).then((r) => (r.ok ? r.json() : null))
    .then((j) => (LOOKUP_INDEX = j?.stocks || [], LOOKUP_INDEX));
}

/* 질문에서 종목 찾기 — 별칭 → 한글명(긴 것 우선) → 티커(대문자 토큰) → 6자리 코드 */
function aiResolveStock(q) {
  const idx = LOOKUP_INDEX || [];
  for (const [k, v] of Object.entries(AI_ALIAS)) {
    if (q.includes(k)) {
      const hit = idx.find((s) => s.ticker === v);
      if (hit) return hit;
    }
  }
  /* KR 종목명 매칭은 **점수제**로 한다. 단순 `q.includes(name)`만 쓰면 짧은 사명이 긴 사명 안에 박혀
     오답이 난다(실측: "하이닉스 실적" → SK하이닉스가 아니라 '이닉스'가 잡힘).
     또 사용자는 이름을 줄여 쓴다("와이지엔터"→와이지엔터테인먼트) → 토큰 접두사 매칭도 함께 본다. */
  const STOP = new Set(["최근", "뉴스", "공시", "실적", "주가", "목표", "목표주가", "컨센서스", "배당", "재무",
    "사업", "시장", "오늘", "어때", "정리", "언제", "발표", "수급", "신호", "분기", "매출", "영업이익", "알려줘",
    "어떻게", "얼마야", "뭐야", "무슨", "회사", "지표", "전망", "이슈", "어떤가", "괜찮나"]);
  const toks = (q.match(/[가-힣A-Za-z0-9]{2,}/g) || []).filter((x) => !STOP.has(x));
  let best = null, bestScore = 0;
  for (const s of idx) {
    if (s.market !== "kr" || s.name.length < 2) continue;
    const nm = s.name.replace(/\s/g, "");
    let sc = 0;
    if (q.includes(s.name)) sc = nm.length;                       // 사명이 질문에 통째로 등장
    for (const tk of toks) {
      if (tk.length < 3) continue;
      if (nm.startsWith(tk)) sc = Math.max(sc, tk.length + 0.5);  // 접두사 = 약칭일 확률 높음
      else if (nm.includes(tk)) sc = Math.max(sc, tk.length);
    }
    if (sc > bestScore) { bestScore = sc; best = s; }
  }
  if (best) return best;
  const code = q.match(/\b(\d{6})\b/);
  if (code) { const h = idx.find((s) => s.ticker === code[1]); if (h) return h; }
  for (const m of q.toUpperCase().match(/\b[A-Z][A-Z.\-]{1,5}\b/g) || []) {
    const h = idx.find((s) => s.market === "us" && s.ticker === m);
    if (h) return h;
  }
  return null;
}

const AI_INTENT = [
  ["edate", /실적\s*발표|발표\s*일|어닝\s*콜|컨콜|실적\s*일정|언제/],
  ["earn", /실적|어닝|매출|영업이익|순이익|EPS|서프라이즈|잠정|분기/i],
  ["cons", /목표\s*주가|목표가|컨센서스|애널리스트|투자\s*의견|적정\s*주가/],
  ["news", /뉴스|이슈|소식|왜|무슨 일|배경|호재|악재/],
  ["disc", /공시|DART|정정|증자|자사주|배당\s*결정/i],
  ["fin", /재무|부채|자산|현금흐름|ROE|PER|PBR|밸류|저평가|고평가|지표/i],
  ["biz", /사업|무슨\s*회사|뭐\s*하는|제품|매출\s*구성|경쟁|사업부/],
  ["div", /배당|시가배당|배당성향/],
  ["supply", /수급|외국인|기관|개인|순매수|순매도/],
  ["sig", /신호|매수|매도|원칙|타이밍/],
  ["price", /주가|등락|올랐|내렸|하락|상승|추이|차트/],
  ["market", /시장|코스피|코스닥|나스닥|S&P|다우|환율|금리|지수|증시|오늘/i],
  ["econ", /경제\s*지표|CPI|FOMC|고용|금리\s*결정|일정/i],
  ["sector", /업종|섹터|산업/],
];
function aiIntents(q) {
  const s = new Set();
  AI_INTENT.forEach(([k, re]) => { if (re.test(q)) s.add(k); });
  return s;
}

const aiNum = (v, d = 0) => (v == null ? "-" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));

/* 컨텍스트 조립 — 의도에 걸린 항목만 넣는다(토큰 예산). 종목 없으면 시장 요약. */
async function aiBuildContext(q) {
  const it = aiIntents(q);
  const st = aiResolveStock(q);
  const parts = [];
  const today = kstDay();
  parts.push(`[오늘] ${today}`);

  if (st) {
    const key = `${st.market}_${st.ticker}`;
    await loadExtras();
    const co = EXTRAS.company?.map?.[key] || {};
    const label = `${st.name}${st.market === "kr" ? `(${st.ticker})` : ""}`;
    parts.push(`[종목] ${label} · ${st.market === "kr" ? "한국" : "미국"} 시장`);

    // 실적 발표 일정
    if (it.has("edate") || it.size === 0) {
      const rows = (CAL?.earnings?.[st.market] || []).filter((e) => e.t === st.ticker || e.name === st.name);
      parts.push(rows.length
        ? `[실적 발표 일정] ${rows.map((e) => `${e.date}${e.eps_est != null ? ` (EPS 컨센 ${e.eps_est})` : ""}`).join(" / ")}` +
          `\n  ※ 일정 데이터 보유 범위: ${(CAL?.earnings?.[st.market] || []).map((e) => e.date).sort()[0] || "-"} ~ ${(CAL?.earnings?.[st.market] || []).map((e) => e.date).sort().slice(-1)[0] || "-"}`
        : `[실적 발표 일정] 보유 일정(${(CAL?.earnings?.[st.market] || []).length}건) 안에 이 종목 없음 — 해당 기간 발표 예정 없음`);
    }
    // 분기 실적 + 서프라이즈
    if (it.has("earn") || it.has("edate") || it.size === 0) {
      const fq = co.fin_q || [];
      if (fq.length) {
        parts.push(`[분기 실적] 단위 ${co.fin_unit || (st.market === "kr" ? "억원" : "백만달러")}\n` +
          fq.slice(-6).map((x) => `  ${x.q}${x.est ? "(추정)" : ""} 매출 ${aiNum(x.rev)} · 영업익 ${aiNum(x.op)}` +
            `${x.opm != null ? `(OPM ${x.opm}%)` : ""} · 순이익 ${aiNum(x.np)}`).join("\n"));
      }
      const sp = co.surprise?.eps;
      if (sp?.length) {
        parts.push(`[EPS 서프라이즈] ` + sp.slice(-6).map((x) =>
          `${x.q} 실제 ${x.actual} vs 예상 ${x.est} (${x.pct >= 0 ? "+" : ""}${x.pct}%)`).join(" / "));
      }
      const fin = co.fin || [];
      if (fin.length && it.has("earn")) {
        parts.push(`[연간 실적] ` + fin.map((x) => `${x.y}${x.est ? "(추정)" : ""} 매출 ${aiNum(x.rev)}·영업익 ${aiNum(x.op)}`).join(" / "));
      }
    }
    // 컨센서스
    if (it.has("cons") || it.has("earn") || it.size === 0) {
      if (co.cons?.target) {
        const a = co.analyst;
        parts.push(`[컨센서스] 목표주가 ${aiNum(co.cons.target)} · 투자의견 ${co.cons.opinion ?? co.cons.opinion_key ?? "-"}` +
          `${co.cons.at ? ` (${co.cons.at} 기준)` : ""}${a ? ` · 애널리스트 ${a.n}명(최고 ${aiNum(a.targetHigh)}/최저 ${aiNum(a.targetLow)})` : ""}`);
      }
    }
    // 주가·수급·신호
    if (it.has("price") || it.has("supply") || it.has("sig") || it.size === 0) {
      try {
        const sd = await fetch(`data/stocks/${key}.json` + _cb).then((r) => (r.ok ? r.json() : null)).then(normStock);
        if (sd?.series?.length) {
          const s = sd.series, l = s[s.length - 1];
          const back = (n) => s[Math.max(0, s.length - 1 - n)];
          const pc = (n) => ((l.c / back(n).c - 1) * 100).toFixed(1);
          parts.push(`[주가] 최근 ${l.t} 종가 ${aiNum(l.c)} · 5일 ${pc(5)}% · 20일 ${pc(20)}% · 60일 ${pc(60)}% · 1년 ${pc(250)}%`);
          if (it.has("sig")) {
            const mk = (sd.markers || []).slice(-5).reverse()
              .map((m) => `${m.t} ${m.side === "buy" ? "매수" : "매도"}(${m.rule_id})`);
            if (mk.length) parts.push(`[최근 원칙 신호] ${mk.join(" / ")}`);
          }
          if (it.has("supply") && sd.supply?.length >= 21) {
            const sp = sd.supply, a = sp[sp.length - 1], b = sp[sp.length - 21];
            const d = (x, y) => (x == null || y == null ? "-" : `${Math.round(x - y) >= 0 ? "+" : ""}${aiNum(Math.round(x - y))}억`);
            parts.push(`[수급 20일] 외국인 ${d(a.fc, b.fc)} · 기관 ${d(a.ic, b.ic)} · 개인 ${d(a.pc, b.pc)}`);
          }
        }
      } catch (e) { /* 주가 없으면 생략 */ }
    }
    // 뉴스
    if (it.has("news") || it.has("earn") || it.size === 0) {
      const arc = await loadStockNews(key);
      if (arc?.length) parts.push(`[최근 뉴스 헤드라인]\n` + arc.slice(0, 18).map((x) => `  ${x[0]} [${x[1]}] ${x[2]}`).join("\n"));
      else {
        const fd = EXTRAS.feed?.map?.[key];
        if (fd?.news?.length) parts.push(`[최근 뉴스] ` + fd.news.slice(0, 8).map((n) => `${n.t} ${n.title}`).join(" | "));
      }
    }
    // 공시
    if (it.has("disc")) {
      const fd = EXTRAS.feed?.map?.[key];
      if (fd?.disc?.length) parts.push(`[공시 최근]\n` + fd.disc.slice(0, 15).map((d) => `  ${d.d} ${d.title.trim()}`).join("\n"));
    }
    // 재무·밸류
    if (it.has("fin") || it.has("div")) {
      if (co.metrics) parts.push(`[투자지표] ` + Object.entries(co.metrics).map(([k, v]) => `${k} ${v}`).join(" · "));
      if (co.fin_ext?.length) parts.push(`[연간 재무] ` + co.fin_ext.slice(-4).map((x) =>
        `${x.y} 순익 ${aiNum(x.net)}·ROE ${x.roe ?? "-"}·부채비율 ${x.debt ?? "-"}`).join(" / "));
      const pr = co.profile;
      if (it.has("div") && pr?.dps_y) parts.push(`[배당] 주당배당 3년 ${pr.dps_y.join(" → ")} · 배당성향 ${pr.payout ?? "-"}% · 시가배당률 ${pr.yld ?? "-"}%`);
    }
    // 사업 개요
    if (it.has("biz") || it.size === 0) {
      if (co.overview) parts.push(`[사업 개요] ${co.overview.slice(0, 400)}`);
      if (co.sales_mix?.length) parts.push(`[매출 구성] ` + co.sales_mix.map((x) => `${x.name} ${x.pct}%`).join(" · "));
      if (it.has("biz")) {
        const bd = await fetchBizDeep(key);
        if (bd?.sections?.length) parts.push(`[사업보고서 발췌] ${bd.src}\n  ` + bd.sections[0].t.slice(0, 700));
      }
    }
    // 기업 정보
    if (co.profile && (it.has("biz") || it.size === 0)) {
      const p = co.profile;
      const f = [p.ceo && `대표 ${p.ceo}`, p.est && `설립 ${p.est.slice(0, 7)}`, p.emp && `직원 ${aiNum(p.emp)}명`,
        p.hq, p.sector].filter(Boolean);
      if (f.length) parts.push(`[기업 정보] ${f.join(" · ")}`);
    }
  } else {
    // ---- 종목이 특정되지 않은 질문: 시장·일정 ----
    if (MARKET?.macro?.length) {   // chg는 **비율**(0.0179=1.79%) — pct()와 같은 단위 규칙
      // ⚠chg는 '직전 보유 데이터 대비'라 시계열에 결측이 있으면 하루치가 아니다(코스피 +17.9% 실측).
      //   지수가 ±8%를 넘으면 신뢰 표시를 붙여 AI가 '오늘 폭등'으로 단정하지 않게 한다.
      parts.push(`[주요 지수·매크로] 기준일 ${MARKET.asof || "-"} · 등락은 **직전 보유 데이터 대비**\n` +
        MARKET.macro.slice(0, 10).map((x) =>
          `  ${x.name} ${aiNum(x.last, 2)}${x.unit || ""} (${pct(x.chg, 2)}` +
          `${Math.abs(x.chg ?? 0) > 0.08 ? " ⚠비정상적으로 큼 — 데이터 결측 가능, 단정 금지" : ""})`).join("\n"));
    }
    if (MPRO?.risk) parts.push(`[리스크온/오프] ${JSON.stringify(MPRO.risk).slice(0, 200)}`);
    if (MPRO?.brief) parts.push(`[시장 브리핑${MPRO.brief_at ? ` ${MPRO.brief_at}` : ""}] ${String(MPRO.brief).slice(0, 600)}`);
    if (it.has("econ") || it.has("edate") || it.has("market")) {
      const ec = (CAL?.econ || []).filter((e) => e.d >= today).slice(0, 12);
      if (ec.length) parts.push(`[다가오는 경제지표]\n` + ec.map((e) => `  ${e.d} ${e.c} ${e.t}${e.f != null ? ` (예상 ${e.f}${e.u || ""})` : ""}`).join("\n"));
      const ea = [["us", "미국"], ["kr", "한국"]].flatMap(([m, lb]) =>
        (CAL?.earnings?.[m] || []).filter((e) => e.date >= today).slice(0, 10).map((e) => `${e.date} ${lb} ${e.name || e.t}`));
      if (ea.length) parts.push(`[다가오는 실적 발표] ${ea.join(" / ")}`);
    }
    if (it.has("sector")) {
      for (const mk of ["kr", "us"]) {
        const g = (MPRO?.rotation?.[mk]?.groups || []).slice(0, 10)
          .map((x) => `${x.name} 1M ${pct(x.m1, 1)}`);
        if (g.length) parts.push(`[${mk === "kr" ? "한국" : "미국"} 업종 1개월] ${g.join(" · ")}`);
      }
    }
    if (TODAY?.signals?.length) parts.push(`[오늘의 원칙 신호] 총 ${TODAY.signals.length}건`);
  }
  return { text: parts.join("\n\n"), stock: st, intents: [...it] };
}

async function aiAsk(qRaw) {
  const q = (qRaw ?? document.getElementById("ai-q").value).trim();
  if (!q || AI_BUSY) return;
  const key = geminiKey();
  const log = document.getElementById("ai-log");
  if (!key) {
    aiPush("ai", "🔑 버튼으로 Gemini API 키를 먼저 등록하세요. aistudio.google.com/apikey 에서 무료 발급됩니다.");
    return;
  }
  AI_BUSY = true;
  document.getElementById("ai-q").value = "";
  aiPush("user", q);
  aiPush("ai", "…자료 찾는 중");
  try {
    await aiIndexReady();
    const ctx = await aiBuildContext(q);
    const hist = AI_LOG.slice(-7, -2).map((m) => `${m.role === "user" ? "질문" : "답변"}: ${m.text.slice(0, 200)}`).join("\n");
    const prompt = `당신은 개인 투자자용 리서치 어시스턴트다. 아래 [보유 자료]만 근거로 한국어로 답하라.

규칙
① 자료에 있는 수치·날짜는 그대로 인용해 **구체적으로** 답한다(에두르지 말 것).
② 자료에 없으면 "보유 자료에 없습니다"라고 명확히 말하고, 어떤 자료가 있으면 답할 수 있는지 한 줄로 덧붙인다.
   추측으로 지어내지 말 것(특히 발표 일정·수치).
③ 답은 결론부터. 필요하면 짧은 불릿. 표는 쓰지 말 것. 3~8문장 분량.
④ 투자 권유·단정적 예측 금지.
${hist ? `\n[직전 대화]\n${hist}\n` : ""}
[보유 자료]
${ctx.text}

[질문] ${q}`;
    const ans = (await gemCall(prompt, { maxTokens: 1600 })).text;
    AI_LOG.pop();                       // "자료 찾는 중" 제거
    aiPush("ai", ans || "응답을 받지 못했습니다(한도 초과). 잠시 후 다시 시도하세요.",
      ctx.stock ? `${ctx.stock.name} · ${ctx.intents.join(",") || "종합"}` : (ctx.intents.join(",") || "시장"));
  } catch (e) {
    AI_LOG.pop();
    aiPush("ai", `오류: ${String(e.message || e).slice(0, 140)}`);
  }
  AI_BUSY = false;
}

function aiPush(role, text, tag) {
  AI_LOG.push({ role, text, tag });
  aiRender();
}
function aiRender() {
  const log = document.getElementById("ai-log");
  if (!log) return;
  const esc = (x) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  log.innerHTML = AI_LOG.map((m) => `<div class="ai-msg ai-${m.role}">${
    m.tag ? `<div class="ai-tag">📎 ${esc(m.tag)}</div>` : ""}${esc(m.text)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/^[-*•]\s+(.+)$/gm, "• $1")
      .replace(/\n/g, "<br>")}</div>`).join("");
  log.scrollTop = log.scrollHeight;
}

function initAiPanel() {
  const fab = document.getElementById("ai-fab");
  const panel = document.getElementById("ai-panel");
  if (!fab || !panel || fab.dataset.bound) return;
  fab.dataset.bound = "1";
  const open = (v) => {
    panel.style.display = v ? "flex" : "none";
    fab.style.display = v ? "none" : "";
    if (v) setTimeout(() => document.getElementById("ai-q")?.focus(), 50);
  };
  fab.onclick = () => {
    open(true);
    if (!AI_LOG.length) {
      aiPush("ai", "무엇이든 물어보세요. 보유한 시세·실적·공시·뉴스·일정 자료를 찾아 답합니다.\n" +
        "예) META 실적발표 언제야 · 삼성전자 실적 정리해줘 · SK하이닉스 목표주가 · 오늘 시장 어때");
    }
  };
  document.getElementById("ai-close").onclick = () => open(false);
  document.getElementById("ai-go").onclick = () => aiAsk();
  document.getElementById("ai-key").onclick = () => {
    const v = prompt("Gemini API 키 (aistudio.google.com/apikey 무료 발급 · 이 브라우저에만 저장)", geminiKey() || "");
    if (v != null && v.trim()) { localStorage.setItem("gemini_key", v.trim()); alert("저장됨"); }
  };
  document.getElementById("ai-q").addEventListener("keydown", (e) => { if (e.key === "Enter") aiAsk(); });
  panel.querySelectorAll(".ai-eg").forEach((b) => b.onclick = () => aiAsk(b.textContent.trim()));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.style.display === "flex") open(false);
  });
}


/* ---------- 📔 투자 다이어리 (v242) — 느낀 점·궁금한 것을 그때그때 적는 공간 ----------
   매매일지가 '거래 기록'이라면 이건 '생각 기록'이다. 종목·수익률과 무관하게 써도 되고,
   ❓궁금 유형은 답을 찾으면 해결 표시를 해 **미해결 질문만 따로 모아본다**(질문이 묻히지 않게).
   ⚠개인 기록이라 localStorage(+로그인 시 개인 Firestore)에만 저장 — 공개 저장소로 나가지 않는다. */
const DI_KEY = "cp_diary_v1";
const DI_TYPES = [
  { k: "think", ico: "💭", name: "생각" },
  { k: "ask", ico: "❓", name: "궁금" },
  { k: "learn", ico: "📌", name: "배움" },
  { k: "regret", ico: "⚠️", name: "반성" },
];
let diFilter = "all";
let diEditId = null;
let diaryRendered = false;

function diLoad() { try { return JSON.parse(localStorage.getItem(DI_KEY)) || []; } catch (e) { return []; } }
function diSave(a) { localStorage.setItem(DI_KEY, JSON.stringify(a)); }
const diMeta = (k) => DI_TYPES.find((x) => x.k === k) || DI_TYPES[0];
const diEsc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/* 제목은 선택 입력 — 비어 있으면 본문 첫 줄(최대 60자)을 제목처럼 쓴다.
   제목 칸이 없던 시절의 기록도 그대로 읽히게 하기 위한 호환 장치. */
const diTitle = (x) => (x.title || "").trim() ||
  ((x.body || "").split("\n")[0].trim().slice(0, 60) || "(제목 없음)");

function initDiary() {
  diaryRendered = true;
  if (!LOOKUP_INDEX) initLookup();          // 종목 자동완성 datalist 재사용
  $("#di-types").innerHTML = DI_TYPES.map((t, i) =>
    `<button type="button" class="chip${i === 0 ? " active" : ""}" data-t="${t.k}">${t.ico} ${t.name}</button>`).join("");
  $("#di-types").querySelectorAll(".chip").forEach((b) => b.onclick = () =>
    $("#di-types").querySelectorAll(".chip").forEach((x) => x.classList.toggle("active", x === b)));
  $("#di-filter").querySelectorAll(".chip").forEach((b) => b.onclick = () => {
    diFilter = b.dataset.f;
    $("#di-filter").querySelectorAll(".chip").forEach((x) => x.classList.toggle("active", x === b));
    diRender();
  });
  $("#di-save").onclick = diSubmit;
  $("#di-cancel").onclick = () => diReset();
  // Ctrl+Enter 저장 — 길게 쓰다 마우스로 옮기지 않게
  $("#di-body").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); diSubmit(); }
  });
  $("#di-title").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $("#di-body").focus(); }   // 제목 → 본문으로
  });
  $("#di-search").addEventListener("input", diRender);
  $("#di-export").onclick = () => {
    const blob = new Blob([JSON.stringify(diLoad(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `투자다이어리_${kstDay()}.json`;
    a.click();
  };
  $("#di-import").onclick = () => $("#di-import-file").click();
  $("#di-import-file").onchange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const inc = JSON.parse(rd.result);
        if (!Array.isArray(inc)) throw new Error("형식 오류");
        const cur = diLoad(), byId = new Map(cur.map((x) => [x.id, x]));
        inc.forEach((x) => { if (x?.id) byId.set(x.id, x); });
        diSave([...byId.values()]);
        alert(`가져오기 완료 — 총 ${byId.size}건`);
        diRender();
      } catch (err) { alert("가져오기 실패: " + err.message); }
    };
    rd.readAsText(f);
    e.target.value = "";
  };
  diRender();
}

function diReset() {
  diEditId = null;
  $("#di-title").value = "";
  $("#di-body").value = "";
  $("#di-tags").value = "";
  $("#di-ticker").value = "";
  $("#di-types").querySelectorAll(".chip").forEach((x, i) => x.classList.toggle("active", i === 0));
  $("#di-save").textContent = "＋ 기록";
  $("#di-cancel").style.display = "none";
}

function diSubmit() {
  const body = $("#di-body").value.trim();
  if (!body) { $("#di-body").focus(); return; }
  const title = $("#di-title").value.trim().slice(0, 80);
  const type = $("#di-types .chip.active")?.dataset.t || "think";
  const tags = $("#di-tags").value.split(/[,#\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 6);
  const tkRaw = $("#di-ticker").value.trim();
  let tk = null;
  if (tkRaw) {
    const hit = (LOOKUP_INDEX || []).find((s) =>
      tkRaw === s.ticker || tkRaw === s.name || tkRaw === `${s.name} (${s.ticker})`);
    if (hit) tk = { key: `${hit.market}_${hit.ticker}`, name: hit.name };
  }
  const all = diLoad();
  if (diEditId) {
    const it = all.find((x) => x.id === diEditId);
    if (it) Object.assign(it, { title, type, body, tags, tk, updated: kstDay() });
  } else {
    all.unshift({ id: "d" + Date.now().toString(36), d: kstDay(), title, type, body, tags, tk, resolved: false });
  }
  diSave(all);
  diReset();
  diRender();
}

function diRender() {
  const host = $("#di-list");
  if (!host) return;
  const q = ($("#di-search")?.value || "").trim().toLowerCase();
  let all = diLoad();
  // 미해결 질문 배너 — 답을 못 찾은 궁금증이 묻히지 않게 맨 위에
  const openQ = all.filter((x) => x.type === "ask" && !x.resolved);
  const bn = $("#di-open-q");
  if (bn) {
    bn.style.display = openQ.length ? "" : "none";
    bn.innerHTML = openQ.length
      ? `<b>❓ 아직 답을 못 찾은 질문 ${openQ.length}건</b>` +
        openQ.slice(0, 5).map((x) => `<div class="di-openq-row" data-id="${x.id}">
          <span class="sub-note">${x.d}</span> ${diEsc(diTitle(x))}</div>`).join("")
      : "";
    bn.querySelectorAll(".di-openq-row").forEach((r) => r.onclick = () => {
      const el = host.querySelector(`[data-card="${r.dataset.id}"]`);
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("di-flash"); setTimeout(() => el.classList.remove("di-flash"), 1200); }
    });
  }
  if (diFilter === "ask-open") all = all.filter((x) => x.type === "ask" && !x.resolved);
  else if (diFilter !== "all") all = all.filter((x) => x.type === diFilter);
  if (q) all = all.filter((x) => ((x.title || "") + " " + x.body + " " + (x.tags || []).join(" ") +
    " " + (x.tk?.name || "")).toLowerCase().includes(q));
  $("#di-count").textContent = `${all.length}건`;
  if (!all.length) {
    host.innerHTML = `<p class="mini-note">${q || diFilter !== "all" ? "조건에 맞는 기록이 없습니다." :
      "아직 기록이 없습니다. 위에 오늘의 생각을 적어보세요 — 종목·수익률과 무관해도 됩니다."}</p>`;
    return;
  }
  host.innerHTML = all.map((x) => {
    const m = diMeta(x.type);
    return `<div class="di-card" data-card="${x.id}">
      <div class="di-head"><span class="di-type t-${x.type}">${m.ico} ${m.name}</span>
        <span class="sub-note">${x.d}${x.updated && x.updated !== x.d ? ` (수정 ${x.updated})` : ""}</span>
        ${x.tk ? `<button class="di-tk" data-go="${x.tk.key}">${diEsc(x.tk.name)} →</button>` : ""}
        <span style="flex:1"></span>
        ${x.type === "ask" ? `<button class="di-mini" data-res="${x.id}">${x.resolved ? "✅ 해결됨" : "☐ 해결 표시"}</button>` : ""}
        <button class="di-mini" data-edit="${x.id}">수정</button>
        <button class="di-mini" data-del="${x.id}">삭제</button></div>
      <div class="di-title${x.resolved ? " done" : ""}">${diEsc(diTitle(x))}</div>
      <div class="di-body${x.resolved ? " done" : ""}">${diEsc(x.body).replace(/\n/g, "<br>")}</div>
      ${(x.tags || []).length ? `<div class="di-tags">${x.tags.map((t) =>
        `<span class="badge" data-tag="${diEsc(t)}">#${diEsc(t)}</span>`).join("")}</div>` : ""}
    </div>`;
  }).join("");
  host.querySelectorAll("[data-go]").forEach((b) => b.onclick = () => {
    gotoTabFull("lookup"); if (!lookupRendered) initLookup(); loadLookup(b.dataset.go);
  });
  host.querySelectorAll("[data-res]").forEach((b) => b.onclick = () => {
    const all2 = diLoad(), it = all2.find((x) => x.id === b.dataset.res);
    if (it) { it.resolved = !it.resolved; diSave(all2); diRender(); }
  });
  host.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => {
    if (!confirm("이 기록을 삭제할까요?")) return;
    diSave(diLoad().filter((x) => x.id !== b.dataset.del));
    diRender();
  });
  host.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => {
    const it = diLoad().find((x) => x.id === b.dataset.edit);
    if (!it) return;
    diEditId = it.id;
    $("#di-title").value = it.title || "";
    $("#di-body").value = it.body;
    $("#di-tags").value = (it.tags || []).join(", ");
    $("#di-ticker").value = it.tk?.name || "";
    $("#di-types").querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.t === it.type));
    $("#di-save").textContent = "저장";
    $("#di-cancel").style.display = "";
    $("#di-body").focus();
    window.scrollTo({ top: $("#di-body").getBoundingClientRect().top + scrollY - 120, behavior: "smooth" });
  });
  host.querySelectorAll("[data-tag]").forEach((b) => b.onclick = () => {
    $("#di-search").value = b.dataset.tag; diRender();
  });
}


/* ---------- 🤝 딜 구조 (v245) — DART 주요사항보고서의 구조화 필드로 M&A 구조도 ----------
   기사 대신 공시 원본 필드를 쓴다(금액·지분율·목적·일정이 그대로 들어있다).
   선정은 노출도가 아니라 score(금액 로그 + 자산대비 + 지분율)로 — '기사 많은 딜'이 아니라 '큰 딜'. */
let DEALS_ST = null;
let dsFilter = "all";
let dsSort = "score";
let dealsStructRendered = false;

const dsAmt = (v) => {
  if (!v) return null;
  if (v >= 1e12) return (v / 1e12).toFixed(v >= 1e13 ? 0 : 1) + "조원";
  if (v >= 1e8) return Math.round(v / 1e8).toLocaleString() + "억원";
  return Math.round(v / 1e4).toLocaleString() + "만원";
};
const dsEsc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dsName = (s) => dsEsc(String(s || "").replace(/\s*\(.*?\)\s*$/, "").trim() || "-");

function renderDealsStruct() {
  dealsStructRendered = true;
  const host = $("#ds-list");
  if (!host) return;
  if (!DEALS_ST) {
    host.innerHTML = `<p class="mini-note">불러오는 중…</p>`;
    fetch("data/deals_struct.json" + _cb).then((r) => (r.ok ? r.json() : null)).then((j) => {
      DEALS_ST = j || { deals: [] };
      loadExtras().finally(dsRender);          // 사업개요(company.json) 함께
    });
    return;
  }
  dsRender();
}

function dsRender() {
  const host = $("#ds-list");
  const all = DEALS_ST?.deals || [];
  if (!all.length) {
    host.innerHTML = `<p class="mini-note">수집된 딜이 없습니다 — <code>python analysis\\deal_structure.py</code> 실행 필요</p>`;
    return;
  }
  let rows = dsFilter === "all" ? all.slice()
    : dsFilter === "big" ? all.filter((x) => (x.amount || 0) >= 1e11)
      : all.filter((x) => x.side === dsFilter);
  rows.sort((a, b) => dsSort === "score" ? (b.score || 0) - (a.score || 0)
    : dsSort === "amount" ? (b.amount || 0) - (a.amount || 0)
      : (b.d || "").localeCompare(a.d || ""));
  $("#ds-count").textContent = `${rows.length}건`;
  $("#ds-asof").textContent = DEALS_ST.generated ? `수집 ${DEALS_ST.generated}` : "";
  host.innerHTML = rows.map(dsCard).join("");
  host.querySelectorAll("[data-go]").forEach((b) => b.onclick = () => {
    gotoTabFull("lookup"); if (!lookupRendered) initLookup(); loadLookup(b.dataset.go);
  });
  dsFillNews();
  dsEnrich(host);          // 지분도 데이터로 구조도 보강(있는 딜만 교체)
  host.querySelectorAll("[data-aibtn]").forEach((b) => {
    const id = b.dataset.aibtn;
    if (dealAiLoad()[id]) { b.style.display = "none"; dsRenderAi(id); }
    b.onclick = () => dsAiBrief(id, b);
  });
}

/* 구조도(v247) — 좁은 좌측 열에 맞춰 **세로 흐름**으로. 가로형은 폭을 많이 먹고 글자도 커진다.
   노드 2~3개를 위→아래로 연결하고 화살표에 금액·지분율을 얹는다. */
/* 딜 구조도 보강(v271) — "누가 누구를 샀다"만으로는 **어떤 구조의 회사를 샀는지**가 안 보인다.
   대상 회사의 기존 지배구조(모회사·자회사)를 소유지분도 데이터에서 찾아 함께 그린다.
   ⚠추가 수집 없음: app/data/ownership 의 그래프와 search.json 색인을 그대로 쓴다. */
let DS_OWN_IDX = null;
const DS_OWN_CACHE = {};

function dsOwnClean(nm) {
  // 공시 회사명은 지저분하다 — 영문 병기, 각주, 줄바꿈이 섞여 온다.
  //   예) "SK실트론(주) (SK Siltron Co., Ltd.)" · 라프텔은 이름 뒤에 줄바꿈 + (Laftel)
  //   → 첫 줄만 쓰고 **괄호 안은 전부 버린다**.
  let s = String(nm || "").split(String.fromCharCode(10))[0];
  s = s.replace(/\(주\)|㈜|주식회사|\(유\)|유한회사/g, "");
  s = s.replace(/\([^)]*\)?/g, "");
  s = s.replace(/\s+/g, "").trim();
  const alias = [["에스케이", "SK"], ["엘지", "LG"], ["지에스", "GS"], ["케이티앤지", "KT&G"],
                 ["케이티", "KT"], ["씨제이", "CJ"], ["에이치디현대", "HD현대"], ["엘엑스", "LX"]];
  for (const [a, b] of alias) if (s.startsWith(a)) return b + s.slice(a.length);
  return s;
}

async function dsOwnCtx(name) {
  /* 회사명 → {parents:[{name,rate,listed,ticker}], kids:[...]} · 없으면 null */
  if (!name) return null;
  if (DS_OWN_IDX === null) {
    DS_OWN_IDX = await fetch("data/ownership/search.json" + _cb)
      .then((r) => (r.ok ? r.json() : false)).catch(() => false);
  }
  if (!DS_OWN_IDX) return null;
  const id = dsOwnClean(name);
  const keys = DS_OWN_IDX.members?.[id];
  if (!keys || !keys.length) return null;
  const k = keys[0];                        // 색인이 '루트에 가까운 그룹' 순으로 정렬돼 있다
  if (!DS_OWN_CACHE[k]) {
    DS_OWN_CACHE[k] = await fetch(`data/ownership/${k}.json` + _cb)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  const g = DS_OWN_CACHE[k];
  if (!g) return null;
  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  if (!byId[id]) return null;
  const info = (nid, rate) => ({ name: byId[nid]?.name || nid, rate,
                                 listed: !!byId[nid]?.listed, ticker: byId[nid]?.ticker });
  const self = byId[id];
  /* ⚠법인 키워드를 요구하면 접미어 없는 사명이 빠진다(SK스퀘어·삼성물산 실측 누락).
     → 반대로 **개인 이름만 제외**한다. 한국인 이름은 대개 공백 없는 순한글 2~3자다. */
  const isCorp = (n) => !/^[가-힣]{2,3}$/.test(String(n.name).replace(/\s/g, ""));
  /* 상위 = ①소유구조에서 자기보다 위에 있는 지배회사 ②법인 최대주주.
     ⚠단순히 '자기로 들어오는 간선'을 다 담으면 **자기 자회사가 모회사 주식을 조금 들고 있는 것**까지
       상위로 뒤집혀 나온다(실측: 삼성전자 상위에 동진쎄미켐 0%). 지분율 1% 미만·개인은 뺀다. */
  const up = g.edges.filter((e) => e.t === id && byId[e.f] && (e.rate || 0) >= 1
      && (byId[e.f].lvl < (self?.lvl ?? 0) || byId[e.f].lvl === -1) && isCorp(byId[e.f]))
    .sort((a, b) => b.rate - a.rate).slice(0, 3).map((e) => info(e.f, e.rate));
  const parents = up;
  // 하위는 **상장 계열사를 먼저** — 해외 판매법인(SPC)이 100%라 지분율만으로 정렬하면 그것만 나온다
  const kids = g.edges.filter((e) => e.f === id && byId[e.t] && ownIsCtrl(byId[e.t], e.rate))
    .sort((a, b) => (byId[b.t].listed ? 1 : 0) - (byId[a.t].listed ? 1 : 0) || b.rate - a.rate)
    .slice(0, 6).map((e) => info(e.t, e.rate));
  return (parents.length || kids.length) ? { parents, kids, group: g.name } : null;
}

/* 구조도 공통(v280) — 회사명이 길어 잘리던 문제를 **2줄 래핑**으로 푼다.
   한글은 글자당 폰트크기와 비슷한 폭, 영문·숫자는 그 55% 정도를 먹는다. */
const DS_W = 420;                       // 구조도 캔버스 폭(좌측 열과 같은 값)

function dsTextW(s, fs) {
  let w = 0;
  for (const ch of String(s)) w += /[가-힣ㄱ-ㅎ]/.test(ch) ? fs : fs * 0.56;
  return w;
}

function dsWrap(name, boxW, fs, maxLines = 2) {
  const s = dsName(name);
  const lim = boxW - 10;
  if (dsTextW(s, fs) <= lim) return [s];
  // 공백이 있으면 **단어 단위**로 끊는다 — 글자 단위로 자르면 'THE GROWHUB LIMITE / D'처럼 어색해진다
  const units = s.includes(" ") ? s.split(/(\s+)/).filter((u) => u.trim() !== "") : [...s];
  const glue = s.includes(" ") ? " " : "";
  const lines = [];
  let cur = "";
  for (const u of units) {
    const next = cur ? cur + glue + u : u;
    if (cur && dsTextW(next, fs) > lim) { lines.push(cur); cur = u; } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const keep = lines.slice(0, maxLines);
    keep[maxLines - 1] = keep[maxLines - 1].slice(0, -1) + "…";
    return keep;
  }
  return lines;
}

/* 박스 하나 — 이름 줄 수에 따라 높이가 자란다(잘라내지 않는다) */
function dsBox(x, y, w, cls, name, sub, tk, fs = 11) {
  const lines = dsWrap(name, w, fs);
  const h = Math.max(sub ? 34 : 24, lines.length * (fs + 3) + (sub ? 14 : 9));
  const y0 = y + (h - (lines.length * (fs + 3) + (sub ? 11 : 0))) / 2 + fs;
  const body = lines.map((l, i) => `<text x="${x + w / 2}" y="${(y0 + i * (fs + 3)).toFixed(1)}"
      class="ds-box-t" style="font-size:${fs}px">${i === 0 && tk ? "★" : ""}${dsEsc(l)}</text>`).join("");
  return {
    h,
    svg: `<g class="ds-node${tk ? " go" : ""}"${tk ? ` data-go="kr_${tk}"` : ""}>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" class="ds-box ds-box-${cls}"/>
      ${body}${sub ? `<text x="${x + w / 2}" y="${(y + h - 6).toFixed(1)}" class="ds-box-s">${dsEsc(sub)}</text>` : ""}
    </g>`,
  };
}

/* 대상의 지배구조 + 인수자 — 세로축은 소유(위=지배), 가로축은 이번 거래.
   ctx가 없으면(지분도 색인에 없는 딜) 소유 계보 없이 **거래 당사자만** 같은 형식으로 그린다. */
function dsDiagramOwn(x, ctx, acquirer, acqLabel) {
  const W = DS_W, LX = 8, BW = 236, AX = LX + BW + 42, AW = W - AX - 8;
  const amtTxt = [dsAmt(x.amount), x.stake_after ? `${x.stake_after}%` : null].filter(Boolean).join(" · ");
  const parents = ctx?.parents || [], kids = ctx?.kids || [];
  /* 📌원칙: **대상을 지금 지배하고 있는 회사(=이번 거래의 매도자)는 반드시 대상 위에** 지분율과 함께 그린다.
     그래야 "어떤 구조의 회사를 누가 넘기는가"가 보인다.
     ⚠매도자는 side에 따라 다른 필드다 — 매각(out)이면 **공시 제출자(corp)**가 매도자이고 counter가 인수자,
       취득(in)이면 counter가 매도자다. 이걸 뒤집어 읽어 엔켐(자회사 지분 매각)이 구조도에서 빠졌다. */
  const sellerName = x.side === "out" ? x.corp : (x.counter || null);
  const ups = parents.map((n) => [n.name, n.rate != null ? n.rate + "%" : "", "지배회사", n.ticker]);
  if (sellerName) {
    const sk = dsOwnClean(sellerName);
    const i = ups.findIndex((u) => dsOwnClean(u[0]) === sk);
    if (i >= 0) ups[i][2] = "매도자 · 지배회사";      // 지분도에도 있으면 라벨만 합친다
    else ups.unshift([sellerName, "", "매도자", null]);
  }
  let svg = "";
  let y = 6;

  // ① 위: 대상을 지배하는 회사(매도자 포함)
  let yTgt = 6;
  if (ups.length) {
    const uw = ups.length > 1 ? (BW - 8) / 2 : BW;
    let hMax = 0;
    ups.slice(0, 2).forEach(([nm, , sub, tk], i) => {
      const bx = LX + i * (uw + 8);
      const b = dsBox(bx, y, uw, "seller", nm, sub, tk, ups.length > 1 ? 10 : 11);
      svg += b.svg;
      hMax = Math.max(hMax, b.h);
    });
    yTgt = y + hMax + 34;
    ups.slice(0, 2).forEach(([, rate], i) => {
      const uw2 = ups.length > 1 ? (BW - 8) / 2 : BW;
      const cx = LX + i * (uw2 + 8) + uw2 / 2;
      svg += `<path d="M${cx},${y + hMax} L${cx},${yTgt - 5}" class="ds-arrow"/>
        ${rate ? `<text x="${cx + 4}" y="${y + hMax + 15}" class="ds-arrow-t">${rate}</text>` : ""}`;
    });
  }

  // ② 가운데: 대상
  const tgt = dsBox(LX, yTgt, BW, "tgt", x.target || x.corp, "대상", null, 12);
  svg += tgt.svg;

  // ③ 오른쪽: 인수자 → 대상
  if (acquirer) {
    const ab = dsBox(AX, yTgt, AW, "acq", acquirer, acqLabel, null, 11);
    svg += ab.svg;
    const my = yTgt + Math.min(tgt.h, ab.h) / 2;
    svg += `<path d="M${AX - 4},${my} L${LX + BW + 6},${my}" class="ds-arrow"/>
      <text x="${(LX + BW + AX) / 2}" y="${yTgt - 5}" class="ds-arrow-t"
        text-anchor="middle">${dsEsc(amtTxt || "취득")}</text>`;
  }

  // ④ 아래: 대상의 자회사
  let bottom = yTgt + tgt.h;
  let ky = bottom + 22;
  const IND = 46;                       // 배선 + 지분율 라벨 자리(우측정렬이라 여유가 필요하다)
  kids.forEach((kn) => {
    const b = dsBox(LX + IND, ky, BW - IND, "sub", kn.name, null, kn.ticker, 10);
    svg += `<path d="M${LX + 8},${bottom} L${LX + 8},${ky + b.h / 2} L${LX + IND - 4},${ky + b.h / 2}" class="ds-arrow nohead"/>`;
    svg += b.svg;
    // ⚠라벨을 박스보다 먼저 그리면 박스가 덮어 '100%'가 '00%'로 보인다 → 박스 다음에, 배선 왼쪽에 우측정렬
    svg += `<text x="${LX + IND - 8}" y="${(ky + b.h / 2 + 3).toFixed(1)}" class="ds-arrow-t"
      text-anchor="end">${kn.rate != null ? kn.rate + "%" : ""}</text>`;
    ky += b.h + 6;
  });
  const H = Math.max(ky + 4, yTgt + tgt.h + 10);
  const note = ctx
    ? `세로=소유구조(위가 지배) · 가로=이번 거래 · 출처: ${dsEsc(ctx.group)} 소유지분도`
    : "가로=이번 거래 · 대상의 소유구조는 지분도 수집 범위(시총 상위 400 그룹) 밖입니다";
  return `<svg viewBox="0 0 ${W} ${H}" class="ds-svg">
    <defs><marker id="dsah" markerWidth="8" markerHeight="8" refX="6" refY="2.5" orient="auto">
      <path d="M0,0 L0,5 L7,2.5 z" fill="#7cb1ff"/></marker></defs>${svg}</svg>
    <p class="ds-own-note">${note}</p>`;
}

/* 카드가 그려진 뒤 비동기로 구조도를 교체 — 지분도 파일이 없으면 기존 그림 유지 */
async function dsEnrich(host) {
  const cells = [...host.querySelectorAll(".ds-left[data-deal]")];
  for (const el of cells) {
    let x;
    try { x = JSON.parse(el.dataset.deal); } catch { continue; }
    if (x.side === "merge") continue;                    // 합병은 존속·소멸 그림이 더 맞다
    // ⚠지분도에 없는 딜(해외·소규모 비상장)이 대부분이다 → ctx 없이도 **같은 형식**으로 다시 그린다
    //   (기존엔 이 경우 옛 3박스 그림이 남아 카드마다 모양이 달랐다)
    const ctx = await dsOwnCtx(x.target || x.corp);
    const acq = x.side === "out" ? (x.counter || null) : x.corp;
    if (!ctx && !acq && !x.target) continue;
    el.innerHTML = dsDiagramOwn(x, ctx, acq, "인수자");
    el.querySelectorAll("[data-go]").forEach((g) => g.onclick = () => {
      gotoTabFull("lookup"); if (!lookupRendered) initLookup(); loadLookup(g.dataset.go);
    });
  }
}

function dsDiagram(x) {
  // 유형별 노드 순서: [윗박스, 아랫박스...] + 화살표 라벨
  const amtTxt = [dsAmt(x.amount), x.stake_after ? `${x.stake_after}%` : null].filter(Boolean).join(" · ");
  // 합병비율은 "A(주) : B(주) = 1.0000000 : 0.0000000" 형태 → 숫자 부분만 뽑아 좁은 폭에 맞춘다
  let ratio = null;
  if (x.ratio) {
    const raw = String(x.ratio).split("\n")[0];
    const m = /([\d.]+)\s*:\s*([\d.]+)\s*$/.exec(raw.trim());
    ratio = m ? `${parseFloat(m[1])} : ${parseFloat(m[2])}` : raw.slice(0, 16);
  }
  let nodes, arrows;
  if (x.side === "merge") {
    nodes = [{ t: x.target, s: "소멸", c: "tgt" }, { t: x.corp, s: "존속", c: "acq" }];
    arrows = [ratio ? `합병비율 ${ratio}` : "흡수합병"];
  } else if (x.side === "out") {
    nodes = [{ t: x.corp, s: "매각자", c: "acq" }];
    if (x.target && x.target !== x.counter) nodes.push({ t: x.target, s: "대상", c: "tgt" });
    if (x.counter) nodes.push({ t: x.counter, s: "인수자", c: "seller" });
    arrows = nodes.length === 3 ? [amtTxt || "매각", "이전"] : [amtTxt || "매각"];
  } else {
    nodes = [];
    if (x.counter) nodes.push({ t: x.counter, s: "매도자", c: "seller" });
    nodes.push({ t: x.corp, s: "인수자", c: "acq" });
    if (x.target) nodes.push({ t: x.target, s: "대상", c: "tgt" });
    arrows = nodes.length === 3 ? ["매각", amtTxt || "취득"] : [amtTxt || "취득"];
  }
  const W = 250, BH = 38, GAP = 34;
  const H = nodes.length * BH + (nodes.length - 1) * GAP + 8;
  let svg = "";
  nodes.forEach((n, i) => {
    const y = 4 + i * (BH + GAP);
    svg += `<rect x="4" y="${y}" width="${W - 8}" height="${BH}" rx="7" class="ds-box ds-box-${n.c}"/>
      <text x="${W / 2}" y="${y + 16}" class="ds-box-t">${dsName(n.t).slice(0, 14)}</text>
      <text x="${W / 2}" y="${y + 29}" class="ds-box-s">${dsEsc(n.s)}</text>`;
    if (i < nodes.length - 1) {
      const ay = y + BH, by = y + BH + GAP;
      svg += `<line x1="${W / 2}" y1="${ay + 3}" x2="${W / 2}" y2="${by - 5}" class="ds-arrow"/>
        <text x="${W / 2}" y="${(ay + by) / 2 + 4}" class="ds-arrow-t mid">${dsEsc(arrows[i] || "")}</text>`;
    }
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="ds-svg">
    <defs><marker id="dsah" markerWidth="8" markerHeight="8" refX="6" refY="2.5" orient="auto">
      <path d="M0,0 L0,5 L7,2.5 z" fill="#7cb1ff"/></marker></defs>${svg}</svg>`;
}

/* 한국어 조사 — 받침 유무로 골라 붙인다("삼성바이오로직스이(가)" 같은 어색함 제거).
   괄호·영문이 섞인 사명은 마지막 한글/숫자 글자로 판정한다. */
function dsJosa(word, pair) {
  const s = String(word || "").replace(/[^가-힣0-9A-Za-z]/g, "");
  const ch = s.slice(-1);
  const [a, b] = pair;                       // [받침O, 받침X]
  if (!ch) return b;
  const code = ch.charCodeAt(0);
  let jong;
  if (code >= 0xac00 && code <= 0xd7a3) jong = (code - 0xac00) % 28 !== 0;
  else if (/[0-9]/.test(ch)) jong = "0134678".includes(ch);   // 0,1,3,6,7,8 = 받침 있음
  else {
    // 영문은 **한국식 발음의 끝소리**로 판단한다(SK=에스케이 → 받침 없음).
    //   알파벳별 한글 발음 끝글자: 받침 있는 것은 L(엘)·M(엠)·N(엔)·R(알) 정도.
    jong = "LMNRlmnr".includes(ch);
  }
  return jong ? a : b;
}
/* 서술 생성(v249) — 공시 필드를 조합해 "무엇을·어떻게·왜"를 한국어 문장으로 만든다.
   AI를 쓰지 않는다(모든 문장이 필드에서 나오므로 지어낼 여지가 없다). 값이 없으면 그 문장만 빠진다. */
function dsEvalAmt(op) {                     // 외부평가 의견문에서 '2,089,897백만원' 같은 금액 추출
  if (!op) return null;
  const m = /([\d,]+)\s*(백만원|억원|천원|원)/.exec(String(op));
  if (!m) return null;
  const v = parseFloat(m[1].replace(/,/g, ""));
  const mul = { "백만원": 1e6, "억원": 1e8, "천원": 1e3, "원": 1 }[m[2]];
  return v * mul;
}

function dsNarrative(x) {
  const S = [];
  const nm = dsName(x.corp), tg = dsName(x.target), ct = dsName(x.counter);
  const amt = dsAmt(x.amount);

  if (x.side === "merge") {
    S.push(`<b>${nm}</b>${dsJosa(nm, ["이", "가"])} <b>${tg}</b>${dsJosa(tg, ["을", "를"])} 흡수합병한다. 합병 후 ${nm}만 남고 ${tg}${dsJosa(tg, ["은", "는"])} 소멸한다.`);
    if (x.counter) S.push(`${tg}${dsJosa(tg, ["은", "는"])} ${nm}의 <b>${dsEsc(x.counter)}</b>이다.`);
    if (x.target_asset) {
      const dbt = x.target_debt ? ` · 부채 ${dsAmt(x.target_debt)}` : "";
      S.push(`소멸회사 규모는 자산 ${dsAmt(x.target_asset)}${dbt} · 자본 ${dsAmt(x.target_eq)} 수준이다.`);
    }
    if (x.ratio_basis) S.push(`합병비율 근거: ${dsEsc(String(x.ratio_basis).replace(/\s+/g, " ").slice(0, 150))}`);
  } else if (x.side === "out") {
    S.push(`<b>${nm}</b>${dsJosa(nm, ["이", "가"])} 보유한 <b>${tg}</b> 지분을 ${x.counter ? `<b>${ct}</b>에 ` : ""}매각한다${amt ? ` (거래금액 ${amt})` : ""}.`);
  } else {
    const via = x.counter ? `<b>${ct}</b>${dsJosa(ct, ["으로부터", "로부터"])} ` : "";
    const st = x.stake_after ? ` 지분 <b>${x.stake_after}%</b>` : " 지분";
    S.push(`<b>${nm}</b>${dsJosa(nm, ["이", "가"])} ${via}<b>${tg}</b>의${st}를 ${amt ? `<b>${amt}</b>에 ` : ""}인수한다.`);
    // 신규 진입 vs 추가 취득 — 취득 후 보유주식 - 이번 취득분
    if (x.shares && x.shares_after) {
      const before = x.shares_after - x.shares;
      const pb = x.target_shares ? (before / x.target_shares) * 100 : null;
      S.push(before <= 0
        ? `이번 거래로 <b>처음</b> 지분을 확보하는 신규 인수다.`
        : `기존 ${pb != null ? `${pb.toFixed(1)}%(${before.toLocaleString()}주)` : `${before.toLocaleString()}주`}에서 추가 취득하는 거래다.`);
    }
    if (x.target_shares && x.shares) {
      const per = x.amount ? x.amount / x.shares : null;
      if (per) S.push(`주당 ${Math.round(per).toLocaleString()}원 · 대상회사 전체 가치로 환산하면 약 ${dsAmt(per * x.target_shares)} 수준이다.`);
    }
    // 부담 규모
    const burden = [];
    if (x.equity_vs) burden.push(`자기자본의 <b>${x.equity_vs}%</b>`);
    if (x.amount_vs_asset) burden.push(`자산총액의 ${x.amount_vs_asset}%`);
    if (burden.length) S.push(`인수 규모는 ${burden.join(" · ")}에 해당한다.`);
    // 가격 적정성 — 외부평가액 대비
    const ev = dsEvalAmt(x.eval_op);
    if (ev && x.amount) {
      const gap = (x.amount / ev - 1) * 100;
      S.push(`외부평가(${dsEsc(x.evaluator || "평가기관")}) 산정가치 ${dsAmt(ev)} 대비 ` +
        (Math.abs(gap) < 3 ? "비슷한 수준이다." :
          `<b class="${gap > 0 ? "neg" : "pos"}">${Math.abs(gap).toFixed(0)}% ${gap > 0 ? "높은" : "낮은"}</b> 가격이다.`) +
        ` <span class="sub-note">(평가액이 범위로 제시되면 하단값 기준)</span>`);
    }
  }
  // 대금지급·자금조달 — 공시는 "1) 대금 지급방법: … 2) 지급시기: … 3) 자금조달: …" 형태의 여러 줄이다.
  //   별도 접이식으로 두면 눈에 안 띄어(사용자 피드백) 설명 문단에 한 줄로 합친다.
  if (x.pay) {
    const parts = String(x.pay).split(/\s*\d\)\s*/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
    const txt = (parts.length > 1 ? parts : [String(x.pay).replace(/\s+/g, " ").trim()])
      .map((s) => s.replace(/^(대금\s*)?지급\s*(방법|형태)\s*[:：]?\s*/, "지급방법 ")
        .replace(/^(대금\s*)?지급\s*시기\s*[:：]?\s*/, "지급시기 ")
        .replace(/^자금\s*조달\s*(방법)?\s*[:：]?\s*/, "재원 ")
        .replace(/\s*[:：]\s*/, " "))
      .join(" · ").slice(0, 300);
    if (txt) S.push(`<b>대금·자금조달</b> — ${dsEsc(txt)}`);
  }
  if (x.purpose) S.push(`<b>추진 이유</b> — ${dsEsc(String(x.purpose).replace(/\s+/g, " ").slice(0, 240))}`);
  // 규제·계약 특이사항
  const flags = [];
  if (x.ftc && x.ftc !== "미해당") flags.push(`공정위 신고 ${dsEsc(x.ftc)}`);
  if (x.putopt && x.putopt !== "아니오") flags.push("풋옵션 등 부가계약 있음");
  if (x.backdoor && x.backdoor !== "아니오") flags.push("우회상장 해당");
  if (flags.length) S.push(`⚖ ${flags.join(" · ")}`);
  return S.length ? `<div class="ds-narr">${S.map((s) => `<p>${s}</p>`).join("")}</div>` : "";
}

/* 진행 일정 — 이사회 결의 → (평가기간) → 대금지급 → 취득/합병 예정일 */
function dsTimeline(x) {
  const steps = [];
  if (x.board_d) steps.push(["이사회 결의", x.board_d]);
  if (x.eval_pd) steps.push(["외부평가", dsEsc(String(x.eval_pd).replace(/\s+/g, " ").slice(0, 34))]);
  if (x.sched) steps.push(["일정", dsEsc(x.sched)]);
  if (x.when) steps.push([x.side === "merge" ? "합병기일" : x.side === "out" ? "이전 예정일" : "취득 예정일", x.when]);
  if (steps.length < 2) return "";
  return `<div class="ds-tl">${steps.map(([k, v], i) =>
    `<div class="ds-tl-step${i === steps.length - 1 ? " last" : ""}">
      <span class="ds-tl-dot"></span><span class="sub-note">${k}</span><b>${v}</b></div>`).join("")}</div>`;
}

/* 관련 기사(v253) — 두 소스에서 회사명 + 공시일 전후로 찾는다.
   ① deals_archive.json : deal-radar가 모은 M&A 전문 기사(3,500건, 국내외)
   ② stocknews/{key}.json: 종목별 1년치 헤드라인(링크 포함) — 인수자가 시총 400위 안이면 존재
   회사명은 괄호·법인격을 떼고 핵심어만 쓴다("SK실트론(주) (SK Siltron…)" → "SK실트론"). */
let DEAL_ARCH = null;
function dsCoreName(s) {
  return String(s || "")
    .replace(/\(.*?\)/g, " ")
    .replace(/(주식회사|㈜|\(주\)|Co\.,? ?Ltd\.?|Inc\.?|Corp\.?|Group|AG|B\.V\.|LLC)/gi, " ")
    .replace(/\s+/g, " ").trim();
}
function dsLoadArch() {
  if (DEAL_ARCH) return Promise.resolve(DEAL_ARCH);
  return fetch("data/deals_archive.json" + _cb).then((r) => (r.ok ? r.json() : null))
    .then((j) => (DEAL_ARCH = j?.items || [], DEAL_ARCH));
}
/* 'MM-DD HH:MM' → 'YYYY-MM-DD' (아카이브에 연도가 없어 딜 날짜 기준으로 연도를 붙인다) */
function dsArchDate(tstr, refYmd) {
  const m = /^(\d{2})-(\d{2})/.exec(String(tstr || ""));
  if (!m) return null;
  const y = +(refYmd || "").slice(0, 4) || new Date().getFullYear();
  const cand = `${y}-${m[1]}-${m[2]}`;
  // 딜이 1월인데 기사가 12월이면 전년도로 본다(연말·연초 경계)
  if (refYmd && cand > refYmd && (+m[1] - +refYmd.slice(5, 7)) > 6) return `${y - 1}-${m[1]}-${m[2]}`;
  return cand;
}

async function dsNews(x) {
  const names = [dsCoreName(x.corp), dsCoreName(x.target), dsCoreName(x.counter)]
    .filter((s) => s && s.length >= 2);
  if (!names.length) return [];
  const hit = new Map();                     // link → {d, title, src, sc}
  // ⚠회사명만으로 걸면 '노조 재심'·'브랜드평판' 같은 무관 기사가 섞인다(실측) → 관련도 점수로 거른다.
  const DEALKW = /인수|합병|매각|양수|양도|M&A|지분|분할|취득|피인수|딜|베팅|계약 ?체결|출자|공개매수/i;
  const tgt = [dsCoreName(x.target), dsCoreName(x.counter)].filter((s) => s && s.length >= 4);
  /* 짧은 사명(SK·두산 등 3자 이하)은 그냥 포함 검사하면 'SKT'·'SK하이닉스'가 걸린다(실측).
     앞뒤 경계를 본다 — 뒤에 조사나 기호가 오면 그 회사, 한글·영문이 이어지면 다른 회사로 판정. */
  const JOSA = "이가은는을를의에와과도만로부서까지";
  const nameHit = (ti, n) => {
    if (!n) return false;
    if (n.length >= 4) return ti.includes(n);
    for (let i = ti.indexOf(n); i !== -1; i = ti.indexOf(n, i + 1)) {
      const nx = ti[i + n.length] || "", pv = ti[i - 1] || "";
      const okN = !nx || /[^가-힣A-Za-z0-9]/.test(nx) || JOSA.includes(nx);
      const okP = !pv || /[^가-힣A-Za-z0-9]/.test(pv);
      if (okN && okP) return true;
    }
    return false;
  };
  /* 제목에 이 딜의 금액이 있으면 강한 신호 — 한국 기사는 대상 사명을 한글로 옮겨 적어(폴리펩타이드)
     영문 사명 매칭이 안 되는 경우가 많다. "2.7조" "2조7천억" 같은 표기를 만들어 대조한다. */
  const amtKeys = [];
  if (x.amount) {
    const jo = x.amount / 1e12;
    if (jo >= 0.95) {
      amtKeys.push(`${jo.toFixed(1)}조`);
      const w = Math.floor(jo), r = Math.round((jo - w) * 10);
      amtKeys.push(r ? `${w}조${r}` : `${w}조`);
    } else {
      const eok = Math.round(x.amount / 1e8);
      amtKeys.push(`${eok.toLocaleString()}억`);
      if (eok >= 1000) amtKeys.push(`${Math.round(eok / 1000)}천억`);
    }
  }
  const relScore = (ti) => {
    let s = 0;
    if (tgt.some((n) => nameHit(ti, n))) s += 3;   // 대상·상대방이 제목에 = 이 딜 기사일 확률 높음
    if (amtKeys.some((k) => ti.includes(k))) s += 3;
    if (DEALKW.test(ti)) s += 2;
    return s;
  };
  const near = (d) => {                      // 공시일 -21 ~ +14일
    if (!d || !x.d) return true;
    const gap = (new Date(d) - new Date(x.d)) / 864e5;
    return gap >= -21 && gap <= 14;
  };
  try {
    const arch = await dsLoadArch();
    for (const a of arch) {
      const ti = a.title || "";
      if (!names.some((n) => nameHit(ti, n))) continue;
      const sc = relScore(ti);
      if (sc < 2) continue;                        // 회사명만 스친 기사는 제외
      const d = dsArchDate(a.t, x.d);
      if (!near(d)) continue;
      hit.set(a.link, { d, title: ti, src: a.src || "", sc });
    }
  } catch (e) { /* 아카이브 없으면 종목 뉴스만 */ }
  if (x.code) {
    const arr = await loadStockNews(`kr_${x.code}`);
    (arr || []).forEach((n) => {
      if (!names.some((s) => nameHit(n[2], s))) return;
      const sc = relScore(n[2]);
      if (sc < 2 || !near(n[0])) return;
      const url = n[3] ? `https://n.news.naver.com/article/${n[3]}` : null;
      if (url && !hit.has(url)) hit.set(url, { d: n[0], title: n[2], src: n[1], sc });
    });
  }
  const arr = [...hit.entries()].map(([link, v]) => ({ link, ...v }));
  const best = Math.max(0, ...arr.map((a) => a.sc));
  const cut = best >= 5 ? best - 2 : 2;          // 확실한 기사가 있으면 애매한 건 제외
  return arr.filter((a) => a.sc >= cut)
    .sort((a, b) => (b.sc - a.sc) || (a.d || "").localeCompare(b.d || "")).slice(0, 6);
}

/* 기사 기반 배경 설명(v258)
   공시 필드는 '무엇을 얼마에'까지만 알려준다. 왜 지금인지·어떤 경쟁 구도였는지·시장 반응은 기사에 있다.
   ⚠전 딜을 자동 호출하면 무료 등급 하루 한도(모델당 20회)를 즉시 소진한다 → **버튼식 + 캐시**.
   캐시는 localStorage(공개 저장소로 안 나감). 자료에 없는 내용은 쓰지 말라고 프롬프트에서 강제한다. */
const DEAL_AI_KEY = "cp_deal_ai_v1";
function dealAiLoad() { try { return JSON.parse(localStorage.getItem(DEAL_AI_KEY)) || {}; } catch (e) { return {}; } }
function dealAiSave(o) { localStorage.setItem(DEAL_AI_KEY, JSON.stringify(o)); }

async function dsAiBrief(rcept, btn) {
  const x = (DEALS_ST?.deals || []).find((d) => d.rcept === rcept);
  const box = document.querySelector(`[data-ai="${rcept}"]`);
  if (!x || !box) return;
  if (!geminiKey()) {
    box.innerHTML = `<p class="mini-note">🔑 Gemini API 키가 필요합니다 — 우측 아래 🤖 어시스턴트의 🔑 버튼에서 등록하세요.</p>`;
    return;
  }
  btn.disabled = true; btn.textContent = "작성 중…";
  box.innerHTML = `<p class="mini-note">관련 기사를 읽고 배경을 정리하는 중…</p>`;
  try {
    const arts = await dsNews(x);
    const facts = [
      `유형: ${x.label}`, `인수(주체): ${x.corp}`, x.target && `대상: ${x.target}`,
      x.counter && `거래상대방: ${x.counter}`, x.target_biz && `대상 사업: ${x.target_biz}`,
      x.amount && `금액: ${dsAmt(x.amount)}`, x.stake_after && `취득 후 지분: ${x.stake_after}%`,
      x.equity_vs && `자기자본 대비: ${x.equity_vs}%`, x.purpose && `공시상 목적: ${x.purpose}`,
      x.when && `예정일: ${x.when}`, x.d && `공시일: ${x.d}`,
    ].filter(Boolean).join("\n");
    const prompt = `당신은 M&A 리서치 애널리스트다. 아래 [공시 사실]과 [관련 기사 제목]만 근거로
이 거래의 **배경과 의미**를 한국어로 정리하라.

규칙
① 공시에 이미 있는 수치를 그대로 반복하지 말고, **왜 지금 이 거래인지·어떤 맥락에서 나왔는지**를 설명한다.
② 기사 제목에서 읽히는 사실(협상 경과·경쟁 구도·업황·시장 반응)을 활용하되, **제목에 없는 내용은 지어내지 말 것**.
③ 확실하지 않으면 "기사에서는 …로 보인다"처럼 완곡하게 쓴다.
④ 3~5문장, 불릿 없이 문단 하나. 투자 권유·목표주가 언급 금지.

[공시 사실]
${facts}

[관련 기사 제목]
${arts.length ? arts.map((a) => `- ${a.d || ""} ${a.title}`).join("\n") : "(없음)"}`;
    const r = await gemCall(prompt, { maxTokens: 900 });
    const o = dealAiLoad();
    o[rcept] = { text: r.text.trim(), at: kstDay(), n: arts.length };
    dealAiSave(o);
    dsRenderAi(rcept);
  } catch (e) {
    box.innerHTML = `<p class="mini-note">생성 실패: ${dsEsc(String(e.message || e)).slice(0, 120)}</p>`;
    btn.disabled = false; btn.textContent = "🤖 기사로 배경 설명";
  }
}

function dsRenderAi(rcept) {
  const box = document.querySelector(`[data-ai="${rcept}"]`);
  if (!box) return;
  const c = dealAiLoad()[rcept];
  if (!c) return;
  box.innerHTML = `<div class="ds-ai"><b>🤖 배경 설명</b>
    <p>${dsEsc(c.text).replace(/\n+/g, "<br>")}</p>
    <p class="sub-note">관련 기사 ${c.n}건 + 공시 사실 기반 · ${c.at} 작성 · 기사 제목 범위 내 해석입니다</p></div>`;
}

/* 카드가 그려진 뒤 비동기로 채운다(기사 조회가 카드 렌더를 막지 않게) */
function dsFillNews() {
  document.querySelectorAll("#ds-list [data-news]").forEach(async (el) => {
    if (el.dataset.done) return;
    el.dataset.done = "1";
    const x = (DEALS_ST?.deals || []).find((d) => d.rcept === el.dataset.news);
    if (!x) return;
    const arts = await dsNews(x);
    if (!arts.length) return;
    el.innerHTML = `<div class="ds-news"><b>📰 관련 기사 ${arts.length}건</b>` +
      arts.map((a) => `<div class="ds-news-row"><span class="sub-note">${dsEsc(a.d || "")}${
        a.src ? " " + dsEsc(String(a.src).split("·")[0].trim().slice(0, 12)) : ""}</span>
        <a href="${a.link}" target="_blank" rel="noopener">${dsEsc(a.title).slice(0, 70)} ↗</a></div>`).join("") +
      `</div>`;
  });
}

/* 사업개요 — 우리가 이미 가진 company.json(상장사)에서. 비상장이면 공시의 업종 한 줄. */
function dsBiz(x) {
  const co = x.code ? EXTRAS.company?.map?.[`kr_${x.code}`] : null;
  const cards = [];
  if (co) {
    const mx = (co.sales_mix || []).slice(0, 4).map((m) => `${m.name} ${m.pct}%`).join(" · ");
    const fin = (co.fin || []).filter((f) => !f.est).slice(-1)[0];
    cards.push(`<div class="ds-biz-card"><b>${dsEsc(x.corp)}</b>
      <button class="ds-go" data-go="kr_${x.code}">종목조회 →</button>
      <p>${dsEsc((co.overview || "").slice(0, 190))}</p>
      ${mx ? `<p class="sub-note">매출구성 ${dsEsc(mx)}</p>` : ""}
      ${fin ? `<p class="sub-note">${fin.y} 매출 ${(fin.rev || 0).toLocaleString()}억 · 영업익 ${(fin.op ?? 0).toLocaleString()}억</p>` : ""}
    </div>`);
  }
  if (x.target_biz || x.target) {
    cards.push(`<div class="ds-biz-card"><b>${dsName(x.target)}</b>
      <span class="badge dim">${x.target_nation && x.target_nation !== "대한민국" ? dsEsc(x.target_nation) : "대상회사"}</span>
      <p>${dsEsc(x.target_biz || "공시에 업종 정보 없음")}</p>
      ${x.shares ? `<p class="sub-note">취득 주식수 ${x.shares.toLocaleString()}주</p>` : ""}
      ${x.target_asset ? `<p class="sub-note">자산 ${dsAmt(x.target_asset)} · 자본 ${dsAmt(x.target_eq)}</p>` : ""}
    </div>`);
  }
  return cards.length ? `<div class="ds-biz">${cards.join("")}</div>` : "";
}

const dsAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function dsCard(x) {
  const facts = [
    ["거래금액", dsAmt(x.amount)],
    ["자산 대비", x.amount_vs_asset ? x.amount_vs_asset + "%" : null],
    ["취득 후 지분", x.stake_after ? x.stake_after + "%" : null],
    ["예정일", x.when],
    ["외부평가", x.evaluator],
  ].filter(([, v]) => v);
  return `<div class="ds-card">
    <div class="ds-head">
      <span class="ds-kind k-${x.side}">${dsEsc(x.label)}</span>
      <b>${dsEsc(x.corp)}</b>
      <span class="sub-note">${x.d}</span>
      <span style="flex:1"></span>
      ${x.amount ? `<span class="ds-amt">${dsAmt(x.amount)}</span>` : ""}
      <a class="ext-link" href="${x.url}" target="_blank" rel="noopener">공시 원문 ↗</a>
    </div>
    <div class="ds-body">
      <div class="ds-left" data-deal="${dsAttr(JSON.stringify({
        side: x.side, corp: x.corp, target: x.target, counter: x.counter,
        amount: x.amount, stake_after: x.stake_after }))}">${dsDiagram(x)}</div>
      <div class="ds-right">
        ${facts.length ? `<div class="ds-facts">${facts.map(([k, v]) =>
          `<span><span class="sub-note">${k}</span> <b>${dsEsc(v)}</b></span>`).join("")}</div>` : ""}
        ${dsNarrative(x)}
        ${dsTimeline(x)}
        ${x.method ? `<p class="sub-note">방식: ${dsEsc(String(x.method).replace(/\n/g, " ").slice(0, 180))}</p>` : ""}
        ${dsBiz(x)}
        <div data-news="${x.rcept}"></div>
        <div class="ds-aiwrap"><button class="today-chart-btn ds-aibtn" data-aibtn="${x.rcept}">🤖 기사로 배경 설명</button>
          <div data-ai="${x.rcept}"></div></div>
      </div>
    </div>
  </div>`;
}

function initDealsStruct() {
  $("#ds-filter").querySelectorAll(".chip").forEach((b) => b.onclick = () => {
    dsFilter = b.dataset.f;
    $("#ds-filter").querySelectorAll(".chip").forEach((x) => x.classList.toggle("active", x === b));
    dsRender();
  });
  $("#ds-sort").querySelectorAll("button").forEach((b) => b.onclick = () => {
    dsSort = b.dataset.s;
    $("#ds-sort").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
    dsRender();
  });
  renderDealsStruct();
}


/* ---------- 🏛 소유지분도 (v261) — DART 타법인출자현황으로 그룹 지배구조 ----------
   공정위 지분도(PDF)와 같은 그림을 데이터로 재현한다. ★=상장사 → 종목조회로 이동.
   노드가 수십 개라 SVG 배선 대신 **계층 카드**로 그린다(읽기·클릭이 쉽다). */
let OWN_IDX = null, OWN_G = null, ownSel = null, ownRendered = false;

/* 출자 목적 분류 — 공정위 지분도는 '지배' 관계만 그린다. 보험·지주는 단순투자 지분이 수백 건이라
   섞으면 계열 1,300사처럼 보인다(현대해상 실측) → 기본은 지배관계만, 투자분은 토글. */
function ownIsCtrl(n, rate) {
  const p = String(n.purpose || "");
  if (/경영\s*(참여|참가)|지배|출자|설립/.test(p)) return true;
  if (/단순|일반\s*투자|스타트업|벤처|재무/.test(p)) return false;
  return (rate ?? 0) >= 20;            // 목적 표기가 없으면 지분율로 판단
}
let ownShowInv = false;
let ownView = "dia";        // dia=공정위式 도식 / list=카드 목록
let ownFit = true;          // 화면 폭에 맞춰 축소(끄면 원래 크기 + 가로 스크롤)
function ownPct(v) { return (v >= 100 ? "100" : v.toFixed(v >= 10 ? 1 : 2)) + "%"; }
const ownEsc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* 소유지분도 도식(v263) — 공정위 소유지분도와 같은 모양으로 그린다.
   도형 규약(공정위 표기): 타원=동일인(개인) · 마름모=지주/주요 지배회사 · 오각형=계열사 · 사각형=하위 계열사.
   ★=상장사(클릭 시 종목조회). 화살표 라벨=지분율.
   카드 나열로는 '누가 누구를 지배하는지'가 안 보여 도식으로 바꿨다(사용자 요청). */
const OWN_W = { col: 178, gap: 14, boxH: 40, subH: 30, subGap: 6 };

function ownShape(x, y, w, h, kind) {
  if (kind === "person") return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" class="og-sh og-person"/>`;
  if (kind === "root" || kind === "holder") {                       // 마름모
    const cx = x + w / 2, cy = y + h / 2;
    return `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" class="og-sh og-${kind}"/>`;
  }
  if (kind === "unit") {                                            // 오각형(집 모양)
    const cx = x + w / 2;
    return `<polygon points="${cx},${y} ${x + w},${y + h * 0.32} ${x + w - 6},${y + h} ${x + 6},${y + h} ${x},${y + h * 0.32}" class="og-sh og-unit"/>`;
  }
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" class="og-sh og-sub"/>`;
}

function ownLabel(x, y, w, h, n, small) {
  const nm = ownEsc(String(n.name).replace(/\(주\)|㈜|주식회사|\(유\)/g, "").trim());
  // 검색해서 들어온 회사는 도식 안에서 바로 찾을 수 있게 테두리로 표시
  const mark = ownHL && n.id === ownHL
    ? `<rect x="${x - 3}" y="${y - 3}" width="${w + 6}" height="${h + 6}" rx="5" class="og-hl"/>` : "";
  const star = n.listed ? "★" : "";
  const fs = small ? 9.5 : 10.5;
  // 긴 이름은 두 줄로
  const lines = nm.length > (small ? 10 : 9) ? [nm.slice(0, small ? 10 : 9), nm.slice(small ? 10 : 9, small ? 20 : 18)] : [nm];
  const y0 = y + h / 2 + (lines.length > 1 ? -3 : 4);
  return mark + `<g class="og-lb${n.listed ? " listed" : ""}" ${n.listed ? `data-go="kr_${n.ticker}"` : ""}>
    ${lines.map((s, i) => `<text x="${x + w / 2}" y="${y0 + i * 11}" font-size="${fs}">${i === 0 ? star : ""}${ownEsc(s)}</text>`).join("")}
  </g>`;
}

function ownArrow(x1, y1, x2, y2, rate, side, at) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const path = x1 === x2
    ? `M${x1},${y1} L${x2},${y2}`
    : `M${x1},${y1} L${x1},${my} L${x2},${my} L${x2},${y2}`;   // ㄱ자 배선
  /* 라벨 위치(v269): 중간점에 두면 **한 점으로 수렴하는 화살표들의 지분율이 겹쳐** 읽을 수 없다
     (최대주주 여럿 → 루트 하나). 여러 화살표가 공유하는 끝점 말고 **서로 다른 쪽 끝**에 붙인다.
       at="src" = 출발점 아래(최대주주 → 루트: 출발 x가 제각각) / 기본 = 도착점 위(루트 → 계열사) */
  const lx = at === "src" ? x1 : x2 + 4;
  const ly = at === "src" ? y1 + 11 : (x1 === x2 ? my - 3 : my - 4);
  return `<path d="${path}" class="og-ar"/>
    <text x="${lx}" y="${ly}" class="og-rt"
      text-anchor="${at === "src" ? "middle" : (side || "start")}">${ownPct(rate)}</text>`;
}

function ownDiagram(g, byId, out, root, kids) {
  /* 폭 압축(v264): 18개 계열사를 한 줄로 늘어놓으면 3,470px가 되어 한눈에 안 들어온다.
     공정위 원본도 **자회사 없는 100% 계열사는 한 열에 세로로 쌓아** 폭을 줄인다 → 같은 방식.
       · 자회사 있는 계열사 = 각자 한 열(아래로 손자회사)
       · 자회사 없는 계열사 = STACK개씩 묶어 한 열에 세로로 */
  const COL = 138, GAP = 10, BOX = 34, SUB = 26, SGAP = 4;
  const LIMIT = 48;          // 도식에 그릴 계열사 상한 — 초과분은 목록 보기로 안내(삼성전자 341사)
  // ⚠계열이 많은 그룹(삼성전자 373사)은 '자회사 있는 계열사'만도 수십 개라 폭이 5,000px까지 간다
  //   → 열은 MAXCOL개로 제한하고(지분율·자회사수 순), 나머지는 세로 스택으로 보낸다.
  const MAXCOL = 10;
  const nSub = (e) => (out[byId[e.t].id] || []).filter((x) => ownIsCtrl(byId[x.t], x.rate)).length;
  /* 열 선정 기준(v269): 자회사 '수'만 보면 **상장 계열사가 밀려난다**
     (실측: SK스퀘어는 자회사가 1개뿐이라 상위 10열에 못 들어 SK하이닉스가 도식에서 통째로 빠졌다)
     → 그 열이 품는 **상장사 수**를 1순위로 본다. 사람이 찾는 건 대개 상장 계열사다. */
  const nListed = (e) => (byId[e.t].listed ? 1 : 0)
    + (out[byId[e.t].id] || []).filter((x) => ownIsCtrl(byId[x.t], x.rate) && byId[x.t].listed).length;
  const withAll = kids.filter((e) => nSub(e) > 0)
    .sort((a, b) => (nListed(b) - nListed(a)) || (nSub(b) - nSub(a)) || (b.rate - a.rate));
  const kidsWith = withAll.slice(0, MAXCOL);
  const kidsNoneAll = kids.filter((e) => !kidsWith.includes(e))
    .sort((a, b) => (byId[b.t].listed ? 1 : 0) - (byId[a.t].listed ? 1 : 0) || (b.rate - a.rate));
  const kidsNone = kidsNoneAll.slice(0, Math.max(0, LIMIT - kidsWith.length));
  const omitted = kidsNoneAll.length - kidsNone.length;
  // 스택 열 수를 제한해 폭이 무한정 늘어나지 않게(세로로 길어지는 편이 읽기 낫다)
  const stackCols = Math.max(1, Math.min(6, Math.ceil(kidsNone.length / 8)));
  const per = Math.ceil(kidsNone.length / stackCols) || 1;
  const stacks = [];
  for (let i = 0; i < kidsNone.length; i += per) stacks.push(kidsNone.slice(i, i + per));
  const nCol = kidsWith.length + stacks.length;

  const holders = g.edges.filter((e) => e.t === root.id && byId[e.f] && byId[e.f].lvl === -1)
    .sort((a, b) => b.rate - a.rate);
  const person = holders.filter((e) => !/\(주\)|㈜|회사|법인|Ltd|Inc/i.test(byId[e.f].name));
  const corp = holders.filter((e) => !person.includes(e));

  const GAPL = 44;                     // 스택 왼쪽 지분율 라벨 자리(우측정렬이라 여백이 필요하다)
  const W = Math.max(880, nCol * (COL + GAP) + GAPL + GAP);
  const yPer = 10, yHold = 78, yRoot = 158, yKid = 244, ySub = yKid + BOX + 26;
  const cx = W / 2;
  let svg = "";

  person.slice(0, 2).forEach((e, i) => {
    const w = 108, x = cx - w / 2 + (i - (person.length - 1) / 2) * 124;
    svg += ownShape(x, yPer, w, 30, "person") + ownLabel(x, yPer, w, 30, byId[e.f]);
    svg += ownArrow(x + w / 2, yPer + 30, cx, yRoot, e.rate, null, "src");
  });
  corp.slice(0, 6).forEach((e, i) => {
    const half = Math.ceil(corp.length / 2), left = i < half, idx = left ? i : i - half;
    const x = left ? GAP + idx * (COL + GAP) : W - GAP - (idx + 1) * (COL + GAP) + GAP;
    svg += ownShape(x, yHold, COL, BOX, "holder") + ownLabel(x, yHold, COL, BOX, byId[e.f]);
    svg += ownArrow(x + COL / 2, yHold + BOX, cx, yRoot, e.rate, null, "src");
  });
  const rw = 178, rx = cx - rw / 2;
  svg += ownShape(rx, yRoot, rw, 42, "root") + ownLabel(rx, yRoot, rw, 42, root);

  let maxBottom = ySub;
  // ① 자회사 있는 계열사 — 각자 한 열
  kidsWith.forEach((e, i) => {
    const x = GAPL + i * (COL + GAP), n = byId[e.t];
    svg += ownArrow(cx, yRoot + 42, x + COL / 2, yKid, e.rate);
    svg += ownShape(x, yKid, COL, BOX, "unit") + ownLabel(x, yKid, COL, BOX, n);
    const gk = (out[n.id] || []).filter((x2) => ownIsCtrl(byId[x2.t], x2.rate)).sort((a, b) => b.rate - a.rate);
    /* ⚠지분율 라벨을 박스보다 **먼저** 그리면 박스가 덮어 숫자가 잘려 보인다(신세계 실측: '61.2%'가 '6'만 보임).
       → 박스를 먼저 그리고 라벨을 마지막에, 그리고 배선 왼쪽 여백(IND)을 라벨 폭만큼 확보한다. */
    const IND = 34;
    gk.forEach((e2, j) => {
      const sy = ySub + j * (SUB + SGAP);
      svg += `<path d="M${x + 8},${yKid + BOX} L${x + 8},${sy + SUB / 2} L${x + IND},${sy + SUB / 2}" class="og-ar"/>`;
      svg += ownShape(x + IND, sy, COL - IND, SUB, "sub") + ownLabel(x + IND, sy, COL - IND, SUB, byId[e2.t], true);
      svg += `<text x="${x + IND - 2}" y="${sy + SUB / 2 - 3}" class="og-rt" text-anchor="end">${ownPct(e2.rate)}</text>`;
      maxBottom = Math.max(maxBottom, sy + SUB);
    });
  });
  // ② 자회사 없는 계열사 — 한 열에 세로로 쌓기(공정위 원본과 같은 압축)
  stacks.forEach((grp, si) => {
    const x = GAPL + (kidsWith.length + si) * (COL + GAP);
    grp.forEach((e, j) => {
      const y = yKid + j * (BOX + 8), n = byId[e.t];
      if (j === 0) svg += ownArrow(cx, yRoot + 42, x + COL / 2, yKid, e.rate);
      else svg += `<path d="M${x - 7},${yKid + BOX / 2} L${x - 7},${y + BOX / 2} L${x - 1},${y + BOX / 2}" class="og-ar"/>`;
      svg += ownShape(x, y, COL, BOX, "unit") + ownLabel(x, y, COL, BOX, n);
      if (j > 0) svg += `<text x="${x - 9}" y="${y + BOX / 2 - 3}" class="og-rt" text-anchor="end">${ownPct(e.rate)}</text>`;
      const sn = nSub(e);
      if (sn) svg += `<text x="${x + COL - 6}" y="${y + BOX - 5}" class="og-sn">+${sn}</text>`;
      maxBottom = Math.max(maxBottom, y + BOX);
    });
  });
  if (omitted > 0) {
    svg += `<text x="${W - GAP}" y="${maxBottom + 16}" class="og-omit" text-anchor="end">`
      + `+ ${omitted}사는 도식에서 생략 — '목록' 보기에서 전체 확인</text>`;
    maxBottom += 22;
  }
  const H = maxBottom + 16;
  return `<div class="og-wrap"><svg viewBox="0 0 ${W} ${H}" class="og-svg" data-w="${W}"
      preserveAspectRatio="xMidYMin meet">
    <defs><marker id="ogah" markerWidth="7" markerHeight="7" refX="5" refY="2.2" orient="auto">
      <path d="M0,0 L0,4.4 L6,2.2 z" fill="#8aa0c0"/></marker></defs>${svg}</svg></div>`;
}

let OWN_SEARCH = null, OWN_NAMES = [], ownQ = "", ownHL = null;

async function initOwnership() {
  ownRendered = true;
  if (!LOOKUP_INDEX) await aiIndexReady();
  if (!OWN_IDX) {
    OWN_IDX = await fetch("data/ownership/index.json" + _cb).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    OWN_SEARCH = await fetch("data/ownership/search.json" + _cb)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  OWN_NAMES = OWN_IDX.map((k) => {
    const code = k.slice(3);
    const s = (LOOKUP_INDEX || []).find((x) => x.ticker === code);
    const gi = OWN_SEARCH?.groups?.[k] || {};
    return { key: k, code, name: s?.name || gi.name || code, n: gi.n || 0, rank: gi.rank ?? 9999 };
  }).sort((a, b) => a.rank - b.rank);   // ⚠계열사 수 순으로 두면 단순투자가 수백 건인 보험사가 앞에 온다
  if (!OWN_NAMES.length) {
    $("#own-body").innerHTML = `<p class="mini-note">아직 수집된 지분도가 없습니다 —
      <code>python analysis\\ownership.py --top 300</code> 실행 필요</p>`;
    return;
  }
  const q = $("#own-q");
  if (q) q.oninput = () => { ownQ = q.value.trim(); ownPickRender(); };
  ownPickRender();
  ownLoad(ownSel && OWN_IDX.includes(ownSel) ? ownSel : OWN_NAMES[0].key);
}

/* 회사 선택 — 드롭다운은 300개를 훑기 어렵다 → 목록 + 검색.
   ⚠검색은 **그룹명만이 아니라 계열사명으로도** 걸린다(사용자 요청: "호텔신라를 치면 어느 도식에 있는지").
   근거 데이터는 ownership.py가 만드는 search.json(계열사 정제명 → 그 이름이 등장하는 그룹들). */
function ownPickRender() {
  const host = $("#own-list");
  if (!host) return;
  const q = ownQ.replace(/\s+/g, "");
  const hit = (s) => q && String(s).replace(/\s+/g, "").toLowerCase().includes(q.toLowerCase());
  const btn = (g, extra) => `<button class="own-pill${g.key === ownSel ? " active" : ""}"
      data-k="${g.key}" title="지배 계열 ${g.n}사">${ownEsc(g.name)}<i>${g.n}</i>${extra || ""}</button>`;

  if (!q) {
    const top = OWN_NAMES.slice(0, 40);
    host.innerHTML = `<div class="own-pills">${top.map((g) => btn(g)).join("")}</div>
      <p class="sub-note">시가총액 상위 ${top.length}개 · 전체 ${OWN_NAMES.length}개 —
        회사명이나 <b>계열사명</b>(예: 호텔신라)을 검색하면 그 회사가 속한 지분도를 찾아줍니다.</p>`;
  } else {
    const groups = OWN_NAMES.filter((g) => hit(g.name));
    const mem = OWN_SEARCH?.members || {};
    const memHits = Object.keys(mem).filter((k) => hit(k)).slice(0, 12);
    const gName = (k) => OWN_NAMES.find((g) => g.key === k)?.name || k;
    /* 계열사 매칭을 **맨 위에** 둔다(사용자 요청): 한 회사가 여러 그룹 그래프에 걸치므로
       "어느 지분도에 들어 있는지"를 먼저 보여주고 고르게 한다. 골라 들어가면 그 회사를 강조한다. */
    const memHtml = memHits.map((k) => {
      const keys = (mem[k] || []).filter((x) => OWN_IDX.includes(x));
      if (!keys.length) return "";
      return `<div class="own-memrow"><span class="own-memnm">${ownEsc(k)}</span>
        <span class="own-memcnt">지분도 ${keys.length}개</span>
        ${keys.map((x, i) => `<button class="own-pill sm${x === ownSel ? " active" : ""}"
          data-k="${x}" data-hl="${ownEsc(k)}"
          title="${i === 0 ? "이 회사와 가장 가까운 그룹" : ""}">${ownEsc(gName(x))}${i === 0 ? " ★" : ""}</button>`).join("")}</div>`;
    }).join("");
    host.innerHTML =
      (memHtml ? `<div class="own-sec-lab">🔎 '${ownEsc(ownQ)}'이(가) 포함된 지분도 — 골라서 여세요
        <span class="sub-note">★=이 회사와 가장 가까운(상위에 있는) 그룹</span></div>
        <div class="own-mem">${memHtml}</div>` : "") +
      (groups.length ? `<div class="own-sec-lab">🏛 그룹 지분도</div>
        <div class="own-pills">${groups.slice(0, 20).map((g) => btn(g)).join("")}</div>` : "") +
      (!groups.length && !memHtml
        ? `<p class="mini-note">'${ownEsc(ownQ)}' 검색 결과가 없습니다. 지분도는 시총 상위 그룹부터 수집합니다.</p>` : "");
  }
  host.querySelectorAll("[data-k]").forEach((b) => b.onclick = () => ownLoad(b.dataset.k, b.dataset.hl));
}

async function ownLoad(key, hl) {
  ownSel = key;
  ownHL = hl || null;          // 검색으로 들어온 회사 — 도식에서 노랗게 강조
  ownPickRender();
  $("#own-body").innerHTML = `<p class="mini-note">불러오는 중…</p>`;
  OWN_G = await fetch(`data/ownership/${key}.json` + _cb).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  ownRender();
}

function ownRender() {
  const host = $("#own-body");
  if (!OWN_G) { host.innerHTML = `<p class="mini-note">지분도를 불러오지 못했습니다.</p>`; return; }
  const g = OWN_G;
  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  const out = g.edges.reduce((m, e) => ((m[e.f] = m[e.f] || []).push(e), m), {});
  const root = g.nodes.find((n) => n.lvl === 0);
  const holders = (out[""] || []).concat(g.edges.filter((e) => e.t === root?.id && byId[e.f]?.lvl === -1)
    .map((e) => ({ ...e })));

  const chip = (n, rate, sub) => {
    const nm = ownEsc(n.name.replace(/\s*\(.*?\)\s*$/, "").trim() || n.name);
    return `<div class="own-node${n.listed ? " listed" : ""}${ownHL && n.id === ownHL ? " hl" : ""}"
      ${n.listed ? `data-go="kr_${n.ticker}"` : ""}>
      <span class="own-rate">${rate != null ? ownPct(rate) : ""}</span>
      <span class="own-nm">${n.listed ? "★ " : ""}${nm}</span>
      ${sub ? `<span class="own-sub">${sub}</span>` : ""}</div>`;
  };

  // 1) 최대주주 → 루트
  const hs = holders.map((e) => chip(byId[e.f], e.rate)).join("");
  // 2) 루트 → 자회사(지분율 높은 순), 자회사가 다시 자회사를 가지면 접이식으로
  const allKids = (out[root.id] || []).slice().sort((a, b) => b.rate - a.rate);
  const ctrl = allKids.filter((e) => ownIsCtrl(byId[e.t], e.rate));
  const inv = allKids.filter((e) => !ownIsCtrl(byId[e.t], e.rate));
  const kids = ownShowInv ? allKids : ctrl;
  const kidHtml = kids.map((e) => {
    const n = byId[e.t];
    const gk = (out[n.id] || []).slice().sort((a, b) => b.rate - a.rate);
    const purpose = n.purpose && n.purpose !== "경영참여" ? n.purpose : null;
    return `<div class="own-branch">
      ${chip(n, e.rate, purpose)}
      ${gk.length ? `<details class="own-gk"><summary>하위 ${gk.length}사</summary>
        <div class="own-grid sm">${gk.map((e2) => chip(byId[e2.t], e2.rate)).join("")}</div></details>` : ""}
    </div>`;
  }).join("");

  const nListed = g.nodes.filter((n) => n.listed).length;
  const hlNode = ownHL ? g.nodes.find((n) => n.id === ownHL) : null;
  host.innerHTML = `
    <div class="own-head"><b>${ownEsc(g.name)}</b> 소유지분도
      <span class="sub-note">${g.year}년 사업보고서 기준 · <b>직접 지배 ${ctrl.length}사</b>
        · 전체 계열 ${g.nodes.length}사(상장 ${nListed})${inv.length ? ` · 단순투자 ${inv.length}건` : ""} · 수집 ${g.at}</span>
      <span class="mk-toggle own-view" id="own-view">
        <button data-v="dia" class="${ownView === "dia" ? "active" : ""}">도식</button>
        <button data-v="list" class="${ownView === "list" ? "active" : ""}">목록</button></span>
      ${ownView === "dia" ? `<button class="own-toggle" id="own-fit">${ownFit ? "원래 크기" : "화면에 맞추기"}</button>` : ""}
      ${hlNode ? `<span class="own-hl-tag">🔎 ${ownEsc(hlNode.name)} 강조 중</span>` : ""}
      ${inv.length ? `<button class="own-toggle" id="own-inv">${ownShowInv
        ? "지배 계열사만" : `단순투자 ${inv.length}건 포함`}</button>` : ""}</div>
    ${ownView === "dia" && ctrl.length <= 3 && inv.length > 10 ? `<p class="mini-note">
      이 회사는 <b>지배 계열사가 ${ctrl.length}곳</b>뿐이고 나머지 ${inv.length}건은 <b>단순투자 지분</b>입니다
      (증권·보험사에 흔합니다). 위의 '단순투자 ${inv.length}건 포함'을 누르면 전부 표시됩니다.</p>` : ""}
    ${ownView === "dia" ? ownDiagram(g, byId, out, root, kids) : `
      ${hs ? `<div class="own-sec"><span class="own-lab">최대주주·특수관계인</span>
        <div class="own-grid">${hs}</div><div class="own-arrow">▼</div></div>` : ""}
      <div class="own-sec own-root">${chip(root, null, "지주·모회사")}</div>
      <div class="own-arrow">▼</div>
      <div class="own-sec"><span class="own-lab">${ownShowInv ? "출자처" : "지배 계열사"} ${kids.length}사</span>
        <div class="own-grid">${kidHtml}</div></div>`}
    <p class="sub-note" style="margin-top:10px">
      <span class="og-lg"><i class="og-i person"></i>동일인·개인</span>
      <span class="og-lg"><i class="og-i holder"></i>주요주주</span>
      <span class="og-lg"><i class="og-i root"></i>지주·모회사</span>
      <span class="og-lg"><i class="og-i unit"></i>계열사</span>
      <span class="og-lg"><i class="og-i sub"></i>하위 계열사</span>
      · 출처: DART 정기보고서 '타법인 출자현황'·'최대주주 현황'.
      ★는 상장사(클릭하면 종목조회로 이동). 비상장 자회사는 사업보고서를 내지 않으면 하위가 비어 있을 수 있습니다.</p>`;

  host.querySelectorAll("[data-go]").forEach((el) => el.onclick = () => {
    gotoTabFull("lookup"); if (!lookupRendered) initLookup(); loadLookup(el.dataset.go);
  });
  const tg = document.getElementById("own-inv");
  if (tg) tg.onclick = () => { ownShowInv = !ownShowInv; ownRender(); };
  const vw = document.getElementById("own-view");
  if (vw) vw.querySelectorAll("button").forEach((b) => b.onclick = () => { ownView = b.dataset.v; ownRender(); });
  const ft = document.getElementById("own-fit");
  if (ft) ft.onclick = () => { ownFit = !ownFit; ownRender(); };
  // 폭 맞춤: viewBox 비율대로 축소해 한 화면에 담는다(끄면 원래 크기 + 가로 스크롤)
  const svg = host.querySelector(".og-svg");
  if (svg) {
    // ⚠폭 압축 후 viewBox가 작아졌는데 width:100%로 두면 **확대**돼 글자가 커진다(898→1552, 1.7배).
    //   맞춤 모드는 '넘칠 때만 축소' — 원래 크기보다 키우지 않는다.
    const w = +svg.dataset.w || 900;
    const avail = (host.querySelector(".og-wrap") || host).clientWidth || w;
    svg.style.width = (ownFit ? Math.min(w, avail) : w) + "px";
    svg.style.maxWidth = "none";
    // 검색으로 들어온 회사는 큰 도식(삼성전자 2,230px)에서 화면 밖일 수 있다 → 그 자리로 스크롤
    const hl = svg.querySelector(".og-hl");
    if (hl) setTimeout(() => hl.scrollIntoView({ block: "center", inline: "center" }), 60);
  }
}

const DEV_HISTORY = [
  ["v287", "2026-08-03", "이격도 과대낙폭 원칙 강화 — '떨어지는 칼날' 제외",
   "**제보에서 시작한 재검증입니다.** SK하이닉스에 7월 세 번(7/8·7/16·7/24) 매수 신호가 떴는데 계속 "
   + "하락했다는 지적을 받고 전 종목 116,111건을 다시 검증했습니다. 확인 결과 **아직 장기추세(MA120) 위에서 "
   + "난 낙폭은 승률 41.5%·초과수익 −1.61%로 오히려 손실**이었습니다 — 하이닉스 3건이 모두 여기였습니다.\n\n"
   + "그래서 원칙에 **MA120 아래(추세 이탈 확인) + 거래량 1.5배 이상(투매 흔적)**을 붙였습니다. "
   + "승률 54.5% → **60.9%**, 20일 초과수익 +4.46% → **+7.11%**로 올라갔고 신호는 1/3로 줄었습니다. "
   + "하이닉스도 7월 신호 3건이 사라지고, 그중 둘은 오히려 '하락 초입' 매도 경고로 바뀌었습니다.\n\n"
   + "같은 재검증에서 매도 원칙 '20일선 이탈+거래량2배'가 탈락하고 '60일선 하향돌파'가 새로 채택됐습니다. "
   + "원칙 해설도 함께 갱신했습니다."],
  ["v288", "2026-08-03", "산업분류 감사 — 실리콘투 교정 · 동종업계를 우리 분류 기준으로",
   "수동 배정된 222종목을 사업설명과 대조해 감사했고, **실리콘투**를 '인터넷 > 광고·커머스'에서 "
   + "**'소비재 > 화장품·생활'**로 옮겼습니다(K-뷰티 브랜드 유통사인데 네이버 업종이 '인터넷과카탈로그소매'라 "
   + "잘못 묶여 있었습니다).\n\n"
   + "더 중요한 건 **동종업계 비교 방식**입니다. 지금까지는 네이버 업종 기준 피어를 그대로 써서 우리가 분류를 "
   + "고쳐도 동종업계가 바뀌지 않았습니다(실리콘투 → 예스24·미트박스). 이제 **같은 밸류체인 단계에서 "
   + "시가총액이 가까운 종목**을 뽑습니다."],
  ["v286", "2026-08-02", "수급 영역을 종목 프로파일과 같은 카드·높이로",
   "수급이 제목+차트만 떠 있어 옆의 종목 프로파일과 모양이 달랐습니다. 같은 카드 테두리·같은 제목 크기로 "
   + "맞추고, 카드 높이도 프로파일과 동일하게 맞춰 남는 공간만큼 차트를 키웠습니다(220 → 377px)."],
  ["v285", "2026-08-02", "종목조회 — 원칙 카드가 차트와 나란히 시작하도록",
   "처음 종목을 열면 원칙 카드가 기업개요 옆에 붙어 차트와 어긋나 보이던 문제를 고쳤습니다. "
   + "헤더와 기업개요를 좌우 분할 **바깥의 전폭 영역**으로 빼서, 그 아래부터 왼쪽 차트와 오른쪽 원칙이 "
   + "같은 높이에서 시작합니다."],
  ["v284", "2026-08-02", "기업개요 — 사업 심층 버튼을 헤더 우측으로",
   "'📚 사업 심층 보기'를 카드 맨 아래에서 **헤더 오른쪽**으로 올렸습니다. "
   + "'소유지분도 전체 보기' 링크도 주변 글씨 크기에 맞춰 줄였습니다."],
  ["v283", "2026-08-02", "종목조회 배치 — 투자지표를 오른쪽으로 · 수급 옆은 종목 프로파일",
   "**투자지표**를 오른쪽 분할 화면(원칙 목록과 같은 열)으로 옮기고, 원칙 영역이 오른쪽 폭을 덜 쓰던 것도 "
   + "맞췄습니다(내부 스크롤바 때문에 좁아 보였습니다). **수급 옆 카드는 증권가 컨센서스 → 종목 프로파일**로 "
   + "바꾸고 컨센서스는 오른쪽으로 보냈습니다. 이제 오른쪽 카드가 모두 같은 폭으로 정렬됩니다."],
  ["v282", "2026-08-02", "종목조회 헤더의 '원칙' 드롭다운 제거",
   "헤더의 원칙 선택 드롭다운을 없앴습니다. 어떤 원칙의 신호를 볼지는 오른쪽 **원칙 목록을 클릭**해서 "
   + "정하고, 지금 선택된 항목은 목록에서 파랗게 표시됩니다(다시 누르면 전체로 돌아갑니다)."],
  ["v281", "2026-08-02", "구조도에 매도자 명시 · 공시 띠 대량 누락 복구",
   "딜 구조도에서 **대상을 지금 지배하는 회사(=매도자)를 항상 대상 위에** 그리도록 했습니다. "
   + "엔켐이 자회사(Enchem America) 지분을 매각하는 건인데 정작 엔켐이 구조도에 없던 문제입니다 "
   + "— 매각 공시에서는 공시 제출자가 매도자인데 상대방을 매도자로 읽고 있었습니다. "
   + "자회사 지분율이 박스에 가려 '100%'가 '00%'로 보이던 것과 긴 영문 사명이 어색하게 끊기던 것도 고쳤습니다.\n\n"
   + "**차트 공시 띠에 공시가 안 뜨던 문제**를 고쳤습니다. 메카로의 인수 공시가 안 보인다는 지적에서 시작해 "
   + "전수 점검한 결과, 게시된 데이터에서 **811개 종목의 공시가 5건 미만**이었습니다(현대차·LG에너지솔루션 등 "
   + "대형주도 1건). 전 종목 공시를 다시 올려 **5건 미만이 2종목**으로 줄었고, 메카로는 2건 → 67건이 됐습니다."],
  ["v280", "2026-08-02", "딜 구조도 확대 — 이름 잘림 해소 · 모든 딜을 같은 형식으로",
   "구조도 영역을 **320 → 420px**로 넓히고, 회사명이 13자에서 잘리던 문제를 **줄바꿈**으로 고쳤습니다 "
   + "('SK Siltron Am' → 'SK Siltron America, Inc.'). 이름이 길면 박스 높이가 자동으로 늘어납니다.\n\n"
   + "지분도에 없는 딜(해외·소규모 비상장)은 옛 그림이 그대로 남아 카드마다 모양이 달랐는데, "
   + "이제 **모든 딜이 같은 형식**입니다 — 소유 계보가 있으면 지배회사·자회사까지, 없으면 "
   + "매도자 → 대상 ← 인수자 구조로 그리고 그 사실을 아래에 명시합니다."],
  ["v279", "2026-08-02", "종목조회 정리 — 신호는 원칙 목록만 · 개요+투자지표 · 수급+컨센서스",
   "신호 영역에서 **라디오 필터 4종·'신호 끄기'·축약 칩**을 뺐습니다. 이제 **채택 원칙 / 참고 원칙(미채택)** "
   + "두 목록만 남고, 항목을 클릭하면 그 원칙의 신호가 차트에 표시됩니다.\n\n"
   + "배치도 정리했습니다 — **기업 개요 옆에 투자지표**를 나란히 두고, 전폭을 쓰던 **수급 차트는 왼쪽 절반**으로 "
   + "줄여 오른쪽에 **증권가 컨센서스**(목표주가·투자의견)를 붙였습니다."],
  ["v277", "2026-08-02", "종목 조회를 제목 라인으로 — 어느 화면에서든 바로 검색",
   "**종목 조회를 '종목 찾기' 그룹에서 꺼내 제목(시장분석) 옆에 상시 배치**했습니다. "
   + "이제 시장·원칙·내 투자 어느 화면을 보고 있든 종목명을 입력하면 곧바로 그 종목의 조회 화면으로 넘어갑니다. "
   + "그룹 버튼을 누르면 보던 곳으로 그대로 돌아옵니다.\n\n"
   + "Snapshot의 **배당 차트 글자 크기**가 실적·현금흐름 뷰와 달라 보이던 것도 맞췄습니다 "
   + "(좌표계가 좁아 같은 폰트가 1.4배로 확대돼 보이던 문제)."],
  ["v276", "2026-08-02", "종목조회 재배치 — 기업개요 최상단 · 신호는 우측 레일 · 그룹 관계 추가",
   "종목을 열면 **기업개요가 가장 먼저** 보이도록 위로 올렸습니다(어떤 회사인지 먼저 확인). "
   + "원칙 신호 필터와 채택/참고 원칙 목록은 차트를 읽는 도구이므로 **오른쪽 분할 화면**으로 옮겼습니다 "
   + "(차트 폭은 그대로 유지).\n\n"
   + "기업개요에 **🏛 그룹 관계**를 새로 넣었습니다 — 소유지분도 데이터를 재사용해 그 회사의 "
   + "**상위(지배) 회사와 하위(자회사)**를 지분율과 함께 보여줍니다. ★는 상장사로 눌러서 바로 이동할 수 있고, "
   + "'소유지분도 전체 보기'로 그룹 도식까지 이어집니다. 예) 삼성전자 → 상위 삼성생명 8.52%·삼성물산 5.05%, "
   + "하위 레인보우로보틱스 35%·삼성바이오로직스 31.2%·제일기획 25.2%."],
  ["v274", "2026-08-02", "딜 구조도에 지배구조 반영 · 관심종목 카드 확대 · 배당을 Snapshot으로",
   "**딜 구조**: '누가 누구를 샀다'만 보이던 구조도에 **대상 회사의 기존 지배구조**를 넣었습니다. "
   + "위에 지배회사, 가운데 대상, 아래 그 자회사를 그리고 인수자를 오른쪽에서 화살표로 붙입니다 "
   + "(예: SK → SK실트론 ← 두산). 소유지분도 데이터를 재사용하며, 지분도에 없는 해외·소규모 딜은 기존 그림을 유지합니다.\n\n"
   + "**관심종목**: 산업 맥락 카드를 좌우 전폭으로 넓히고 **동종업계 상대주가 추이**(6개월, 시작=100)를 "
   + "옆에 붙였습니다. 수급 카드에 **증권가 컨센서스**(목표주가·투자의견), 밸류에이션 카드에 **시가총액·기간 수익률**을 "
   + "추가했습니다. 재무 그래프는 **분기/연간 전환**이 가능해졌고, 값을 그래프 안에 표기하면서 오른쪽·아래 숫자는 뺐습니다.\n\n"
   + "**종목조회**: 배당을 별도 섹션에서 **Snapshot의 '배당' 뷰**로 옮기고, 다른 뷰처럼 아래에 금액 표(주당배당금·"
   + "배당수익률·배당성향·전년 대비)를 붙였습니다.\n\n"
   + "**소유지분도 수록 기준 수정**: 대상 선정에 쓰던 순위가 **시장별 순위**여서 '상위 300'이 실제로는 "
   + "코스피 150 + 코스닥 150이었습니다(이마트가 빠진 이유). 실제 시가총액 기준으로 바꾸고 상위 400으로 넓혔습니다.\n\n"
   + "**추정치 가드**: 시세 제공처가 일부 종목에 비정상적으로 큰 추정 EPS를 주고 있어(삼성전자 2026년 추정 "
   + "47,929원 — 2025년 실적의 7.3배, 2,685종목 중 93건) 선행 PER·추정 배당이 사실과 다르게 표시됐습니다. "
   + "실적 대비 3배를 넘는 추정치는 화면에서 제외합니다."],
  ["v270", "2026-08-02", "지분도 표기 정리 — '합계' 노드·각주·가려진 지분율",
   "지분도에서 눈에 거슬리던 것들을 정리했습니다. 공시 표의 **'합계' 행이 회사처럼 그려지던 것**을 없앴고, "
   + "회사명 뒤에 붙던 **(주1)·(계열회사)·(*1) 같은 각주**를 떼어냈습니다(1,539건). 각주 때문에 "
   + "'호텔신라'가 세 회사로 갈라져 있던 검색 결과도 하나로 합쳐집니다. "
   + "하위 계열사의 **지분율 숫자가 박스에 가려 안 보이던 문제**도 고쳤습니다. "
   + "그리고 공시에 적힌 이름과 거래소 종목명이 다른 회사들(한국전력기술=한전기술, 현대자동차=현대차, "
   + "엘에스일렉트릭=LS ELECTRIC)이 상장으로 인식되도록 **종목코드 기준 매칭**을 넣었습니다(50개 추가 인식). "
   + "머리말 숫자도 도식과 기준이 달라 헷갈리던 것을 '직접 지배 N사 · 전체 계열 M사 · 단순투자 K건'으로 나눴습니다."],
  ["v269", "2026-08-02", "지분도 누락 보완·검색 신설 / 자산시장 압축 + 지표 보강",
   "**지분도**: SK에 SK하이닉스가, 두산에 두산테스나가 없던 문제를 고쳤습니다. 원인이 셋이었습니다 — "
   + "①비상장 중간지주(두산포트폴리오홀딩스)에서 계보가 끊겼고 ②같은 회사가 '에스케이하이닉스'와 "
   + "'SK하이닉스'로 갈라져 있었으며 ③도식이 자회사 수 순으로 열을 골라 상장 계열사가 밀려났습니다. "
   + "회사 선택은 드롭다운 대신 **검색**으로 바꿨습니다. **계열사 이름으로도 검색**되어, 예를 들어 "
   + "'호텔신라'를 치면 그 회사가 들어 있는 지분도 목록이 먼저 뜨고 골라서 열면 도식에서 노랗게 강조됩니다. "
   + "화살표에 겹쳐 보이던 지분율 숫자도 정리했습니다.\n\n"
   + "**자산시장**: 차트 4개를 2열로 묶어 스크롤을 줄이고, 빠져 있던 지표를 채웠습니다. "
   + "**자산군 성과 비교**(코스피·S&P500·나스닥·아파트·금·비트코인을 같은 기간 100에서 출발시켜 비교, "
   + "해외 자산은 원화 환산 선택 가능)와 **유동성·물가**(M2 증가율·소비자물가·실질금리)를 새로 넣었습니다. "
   + "작업 중 원/달러·신용스프레드 등 11개 시계열이 수집 실패로 비어 있던 것을 발견해 함께 복구했습니다.\n\n"
   + "**종목조회** 검색창은 내재가치 탭과 같은 모양으로 통일했습니다."],
  ["v267", "2026-08-02", "지분도 글자가 커지던 문제 수정", "도식 폭을 줄인 뒤 글자가 갑자기 커 보이던 문제를 고쳤습니다. 도식이 작아졌는데도 화면 폭에 맞춰 늘리다 보니 1.7배로 확대되고 있었습니다. 이제 **넘칠 때만 축소**하고 원래 크기보다 키우지 않습니다."],
  ["v264", "2026-08-02", "소유지분도 폭 압축 — 한 화면에 들어오게", "계열사를 한 줄로 늘어놓아 도식이 3,470px까지 벌어지던 것을 고쳤습니다. **공정위 원본과 같은 방식**으로 자회사가 없는 계열사(대개 100% 자회사)는 한 열에 세로로 묶고, 자회사가 있는 계열사만 각자 열을 차지합니다. 기본은 **화면 폭에 맞춰 축소**되며 '원래 크기' 버튼으로 확대해 볼 수 있습니다. 지분도 영역도 좌우 여백을 넓게 씁니다."],
  ["v263", "2026-08-02", "소유지분도를 공정위式 도식으로", "카드 나열로는 지배관계가 한눈에 안 들어와, **공정거래위원회 소유지분도와 같은 도식**으로 바꿨습니다. 도형 규약도 그대로 따릅니다 — 타원=동일인(개인), 마름모=주요주주·지주회사, 오각형=계열사, 사각형=하위 계열사. 화살표에 지분율이 붙고 **★ 상장사는 눌러서 종목조회로** 갑니다. 목록 보기로 전환하는 버튼도 남겼습니다."],
  ["v261", "2026-08-02", "🏛 소유지분도 탭 신설", "공정거래위원회 소유지분도(PDF·이미지)와 같은 그림을 **데이터로** 재현했습니다. DART 정기보고서의 '타법인 출자현황'·'최대주주 현황'에서 지분율을 그대로 가져와 최대주주 → 지주·모회사 → 출자 계열사 순으로 보여주고, 계열사가 다시 자회사를 가지면 접어서 펼칩니다. **★는 상장사이며 누르면 종목조회로 이동**합니다. 검증: 하림지주 — 김홍국 21.1%·제일사료 88.11%·팬오션 54.72%, 계열 72사 중 상장 5사로 공정위 지분도와 일치."],
  ["v258", "2026-08-02", "딜 배경 설명(기사 기반) + 대금 정보 통합", "①**🤖 기사로 배경 설명** — 버튼을 누르면 그 딜의 관련 기사 제목과 공시 사실을 함께 읽고 '왜 지금 이 거래인지·어떤 협상 경과와 업황 속에서 나왔는지'를 3~5문장으로 정리합니다. 공시 수치 반복 대신 **맥락**을 채우며, 기사 제목에 없는 내용은 쓰지 않도록 강제했습니다. 한 번 만들면 저장돼 다시 부르지 않습니다(무료 한도 보호). ②자금조달·대금지급을 접이식에서 빼내 **인수 설명 문단에 합쳤습니다**. ③회사명 조사 처리를 보완했습니다(SK으로부터 → SK로부터)."],
  ["v253", "2026-08-02", "딜 카드에 관련 기사 연결", "각 딜에 **그 딜을 다룬 기사**를 붙였습니다. M&A 전문 기사 아카이브(3,500건)와 종목별 뉴스 아카이브에서 인수자·대상회사·매도자 이름으로 찾고, **공시일 전후(-21~+14일) 기사만** 골라 최대 6건을 보여줍니다. 제목을 누르면 원문으로 이동합니다. 예: 두산-SK실트론 딜에 'SK, 두산에 SK실트론 지분 70% 판다…매각가 2.3조원' 기사가 붙습니다."],
  ["v252", "2026-08-02", "딜 구조 여백 정리 + 문장 다듬기", "딜 구조 본문이 상단 메뉴에 바짝 붙어 있던 것을 띄웠고, 회사명 받침에 따라 조사(이/가·을/를·로부터)를 자동으로 골라 문장이 자연스럽게 읽히도록 했습니다."],
  ["v249", "2026-08-02", "딜 구조에 '어떻게·왜' 서술 추가", "숫자만 나열되던 것을 **문장으로 설명**하도록 했습니다. 공시 필드를 조합해 ① 누가 누구로부터 무엇을 얼마에 인수하는지, ② **처음 확보하는 지분인지 추가 취득인지**, ③ 주당 단가와 대상회사 전체 환산가치, ④ 인수 규모가 자기자본·자산의 몇 %인지, ⑤ **외부평가액 대비 비싸게/싸게 사는지**, ⑥ 추진 이유(공시 원문), ⑦ 공정위 신고·풋옵션 등 특이사항을 서술합니다. **진행 일정 타임라인**(이사회 결의 → 외부평가 → 취득/합병 예정일)도 추가했습니다. AI가 아니라 공시 필드에서 직접 만들기 때문에 지어낸 문장이 없습니다."],
  ["v247", "2026-08-02", "딜 구조 카드 2단 배치 + 도식 축소", "구조도가 카드 전체 폭을 쓰고 글자도 커서 한 딜이 화면을 가득 채웠습니다. **구조도를 왼쪽 좁은 열에 세로 흐름으로** 줄이고(매도자→인수자→대상), 거래금액·지분율·목적·자금조달·양측 사업개요는 **오른쪽에 배치**했습니다. 글자 크기도 전반적으로 줄여 한 화면에 더 많은 딜이 들어옵니다."],
  ["v246", "2026-08-02", "딜 구조 탭이 빈 화면으로 뜨던 문제 수정", "🤝 딜 구조를 눌러도 아무것도 안 나오던 문제를 고쳤습니다. 새 상위 그룹의 기본 탭이 등록되지 않아 그룹만 눌렀을 때 아무 탭도 열리지 않았습니다(제가 검증할 때는 탭을 직접 눌러 확인해서 놓쳤습니다). 전체 그룹 6개가 모두 정상 표시되는지 다시 확인했고, 뒤로가기 라벨에 쓰이는 탭 이름(딜 구조·투자 다이어리)도 함께 등록했습니다."],
  ["v245", "2026-08-02", "🤝 딜 구조 탭 신설 — 공시 원본으로 M&A 구조도·사업개요", "M&A를 기사로만 보던 것을 **공시 원본 데이터**로 바꿨습니다. 국내 상장사 딜은 주요사항보고서에 거래상대방·대상회사·금액·주식수·취득 후 지분율·목적·자금조달·일정이 **필드로** 들어 있어 그대로 씁니다. 화면에는 **구조도**(인수자 →금액·지분율→ 대상, 위에 매도자)와 **양측 사업개요**(보유한 기업개요·매출구성·실적), 취득 목적·외부평가·대금지급 방식, 공시 원문 링크가 함께 나옵니다. 중요 딜 선정은 기사 노출이 아니라 **거래금액·자산 대비 비중·취득 지분율** 정량 점수로 합니다. 예: 두산→SK실트론 2.3조·70.61%, 삼성바이오로직스→PolyPeptide 2.7조·100%. 해외·비상장 딜은 공시 대상이 아니라 별도 보고서로 보완합니다."],
  ["v244", "2026-08-02", "📔 다이어리에 제목 칸 추가", "기록마다 **제목**을 붙일 수 있습니다(선택 — 비우면 본문 첫 줄이 제목이 됩니다). 목록에서 제목이 굵게 먼저 보여 훑어보기 쉽고, 검색·미해결 질문 배너·Notion 동기화의 페이지 제목에도 그대로 반영됩니다. 제목 칸에서 Enter를 누르면 본문으로 넘어갑니다. 이전에 쓴 기록도 그대로 보입니다."],
  ["v243", "2026-08-02", "📔 다이어리 Notion 연동 + 기기 간 동기화 수정", "①**다른 노트북에서 다이어리가 안 보이던 문제 수정** — 기기 간 동기화 대상 목록에 다이어리가 빠져 있었습니다(백업 목록과 별개인 걸 놓침). 이제 같은 구글 계정으로 로그인하면 어느 기기에서든 따라옵니다. ②**Notion 연동** — Claude에게 '다이어리 노션에 올려줘'라고 하면 Notion 데이터베이스로 보냅니다. 날짜·유형·내용·태그·종목·해결 여부가 그대로 들어가고, **기록 ID 기준으로 갱신**되어 여러 번 올려도 중복이 생기지 않으며 수정한 글도 반영됩니다. (Notion은 브라우저 직접 호출을 막아둬서 사이트가 아닌 스크립트가 대신 올리는 구조입니다.)"],
  ["v242", "2026-08-01", "📔 투자 다이어리 — 생각·궁금증을 그때그때 적는 공간", "내 투자에 **투자 다이어리** 탭을 새로 만들었습니다. 매매일지가 '거래 기록'이라면 이건 '생각 기록'으로, 종목이나 수익률과 무관하게 자유롭게 씁니다. 유형을 💭생각·❓궁금·📌배움·⚠️반성으로 구분하고, **❓궁금은 답을 찾으면 해결 표시**를 할 수 있어 **아직 답 못 찾은 질문만 맨 위 배너에 모아** 보여줍니다 — 궁금증이 묻히지 않게. 태그(#반도체 등)로 묶어 클릭 검색, 종목을 연결하면 종목조회로 바로 이동, Ctrl+Enter로 빠르게 저장, JSON 내보내기/가져오기도 됩니다. 모든 기록은 이 브라우저(로그인 시 개인 계정)에만 저장되며 공개되지 않습니다."],
  ["v241", "2026-08-01", "💰 배당 섹션 — 배당수익률 추이까지 (한국 종목 신규 지원)", "배당 카드가 미국 종목의 분기 지급 이력만 보여주던 것을 전면 개편했습니다. ①**한국 종목도 지원** — 주당배당금 연도별 추이(추정 연도 포함). ②**배당수익률 시계열** — 저장된 값은 최신 1개뿐이라, 보유한 10년 일봉으로 **그해 배당÷그해 평균주가**를 직접 계산해 5~6개년 추이를 그립니다. '지금이 역사적으로 배당 매력이 높은 구간인가'를 판단할 수 있고, 현재값이 평균 대비 높/낮은지 한 줄로 짚어줍니다. ③**요약 타일 3개** — 시가배당률(기간 평균 대비), 배당성향, 연속 증액 연수. 미국 배당 이력도 3년 → 6년으로 늘려 재수집했습니다(94종목). 무배당 종목은 카드가 숨겨집니다."],
  ["v240", "2026-08-01", "AI 답변에 근거 원문 링크 + 후속 질문 + 모델 자동 전환", "①**근거 링크** — AI가 인용한 뉴스·공시에 번호(#3)가 붙고, 답변 아래 목록에서 눌러 **원문 기사·DART 공시로 바로 이동**합니다. 모델이 URL을 직접 쓰면 없는 주소를 지어내므로, 자료에 번호를 매겨 인용시키고 코드가 실제 링크로 바꿉니다. ②**후속 질문** — 답변 뒤 이어서 물으면 같은 구간·맥락을 유지한 채 대화가 쌓입니다('그때 수급은?' 식). 🗑로 초기화. ③**모델 자동 전환** — 무료 등급은 모델마다 한도가 따로라(gemini-3.5-flash는 하루 20회) 한도에 걸리면 다음 모델로 자동 전환해 계속 쓸 수 있게 했습니다. ④보조지표 툴바 테두리가 차트 오른쪽 끝까지 늘어나던 것을 내용 폭에 맞췄습니다."],
  ["v236", "2026-08-01", "실적발표 위젯 기본값을 '전체'로 — 미국 종목이 안 보이던 문제", "홈 화면 실적발표 목록의 시장 필터 기본값이 '한국'이라, META처럼 미국 종목의 발표 일정이 달력에는 있는데도 화면에 안 보였습니다(사용자 제보). **기본을 '전체'로 바꿔 한·미를 국기와 함께 한 목록에 날짜순으로** 보여주고, 선택한 필터는 브라우저에 기억되도록 했습니다."],
  ["v231", "2026-08-01", "🤖 AI 어시스턴트 — 어느 화면에서나 종목·시장 전반 질문", "우측 아래 🤖 버튼을 누르면 어디서든 질문할 수 있는 AI 패널이 열립니다. 질문에서 **종목과 의도를 자동으로 인식**해 필요한 자료만 찾아 답합니다 — 실적 발표 일정, 분기 실적·EPS 서프라이즈, 목표주가·애널리스트 분포, 최근 뉴스, 공시, 재무·밸류에이션, 배당, 사업 개요·매출 구성, 수급, 원칙 신호, 그리고 종목 없이 물으면 지수·업종·경제지표 일정까지. 예) \"META 실적발표 언제야\" · \"삼성전자 실적 정리해줘\" · \"SK하이닉스 목표주가\" · \"오늘 시장 어때\". 보유 자료에 없으면 지어내지 않고 '자료에 없다'고 답하도록 강제했습니다."],
  ["v230", "2026-08-01", "종목조회 레이아웃 정리 — 보조지표 위치 이동 + 투자지표 압축", "①**보조지표(RSI·MACD 등)를 차트 바로 아래**로 옮겼습니다. 이전에는 'AI 왜 움직였나' 카드 아래에 생겨 가격 차트와 떨어져 있었는데, 이제 x축이 이어져 함께 읽힙니다. ②**투자 지표 카드를 2열로 압축** — 우측 레일에서 4개 항목이 세로로 쌓여 577px까지 늘어지던 것을 351px로 줄여 한 화면에 들어옵니다(값 잘림 없음, 한국·미국 종목 모두 확인)."],
  ["v228", "2026-08-01", "🤔 AI 변동 사유 — 당시 뉴스·실적·업종을 근거로 '진짜 이유'를 답한다", "답변이 [추정]만 늘어놓아 쓸모없다는 지적을 반영해 **근거 자료 자체를 대폭 보강**했습니다. ①**종목별 과거 뉴스 아카이브**(최근 1년 헤드라인, 네이버 종목뉴스)를 새로 수집해, 질문한 기간의 실제 기사 제목·매체·날짜를 근거로 제공합니다(급락·급등일 전후 기사 우선). ②**분기 실적**을 구간 직전·중·직후로 나눠 제공 — 실적이 좋았는데 왜 빠졌는지, 이후 실적 둔화를 선반영한 것인지 판단할 수 있습니다. ③**동종업계 같은 기간 등락**으로 업종 이슈인지 개별 이슈인지 구분합니다. ④컨센서스·밸류에이션 추가. 예: YG 2025년 11월 → '3분기 영업익 311억(+270%)으로 좋았으나 블랙핑크 MD 매출이 기대 미달, 11/10 iM·NH·유진 목표가 일제 하향 + 한한령 해제 기대 소멸로 엔터 업종 동반 급락'처럼 매체·날짜를 인용해 답합니다."],
  ["v227", "2026-08-01", "AI 변동 사유 — 무료 등급 검색 한계 확인 및 대체 설계", "구글 검색 그라운딩이 무료 등급에서 전 모델 429(쿼터 0)로 막혀 있고, 무료 Gemini 모델들의 학습 데이터가 최근 국내 이슈를 담지 못한다는 점을 실측으로 확인했습니다(2025년 11월을 '미래'로 인식). 그래서 검색에 의존하지 않고 **우리가 보유한 데이터로 답하는 구조**로 전환했습니다 — 그 결과가 v228입니다."],
  ["v226", "2026-08-01", "Gemini 모델 교체 — 키 재발급으로 멈춘 AI 기능 전면 복구", "API 키를 새로 발급받자 **모든 AI 기능이 동시에 멈추는** 문제가 발생했습니다. 원인은 `gemini-2.5-flash`(및 2.0-flash)가 신규 발급 키에는 더 이상 제공되지 않기 때문으로(기존 키만 사용 가능), 사이트 AI 분석·시장 브리핑·텔레그램 봇 2종·거인의 어깨·아파트 추천 6곳이 함께 영향을 받았습니다. 전부 **gemini-3.5-flash**로 교체하고 실제 호출로 검증했습니다. 또한 구글 검색 보강은 무료 등급에서 사용할 수 없어(한도 0), 검색이 막히면 **자동으로 내부 자료만으로 재분석**하고 그 사실을 하단에 명시하도록 했습니다 — 근거 표시도 [검색]/[추정]을 정확히 구분합니다."],
  ["v225", "2026-08-01", "📚 사업 심층 — 팝업으로 전환", "사업 심층을 카드 안 접이식 대신 **팝업(심층 보고서와 같은 전체화면 뷰어)**으로 바꿨습니다. 카드에는 '📚 사업 심층 보기' 버튼 한 줄만 남고, 누르면 소제목별 전체 내용(표 포함)을 넓은 화면에서 스크롤로 읽습니다. 종목조회·관심종목 동일 적용."],
  ["v224", "2026-08-01", "📚 사업 심층 — 원문 표를 실제 표로 복원", "사업 심층에서 원문의 표(매출실적·매입처·생산능력 등)가 셀마다 한 줄씩 세로로 풀려 읽기 어렵다는 피드백을 반영했습니다. 수집기가 표 블록을 구조 그대로(셀 구분 유지) 뽑아내고, 화면에서 **실제 표**(헤더행 강조·가로 스크롤)로 복원합니다. DART XML의 특수 구조 3종(셀 안 문단 중첩·닫는 행 태그 생략·TABLE-GROUP 유사 태그)을 각각 처리했고, 전 종목(한 636) 재수집으로 반영했습니다."],
  ["v223", "2026-08-01", "🤔 AI 변동 사유 — 과거 질문 답변 가능(기간 인식+급락일 상세+웹 검색)", "'25년 11월 와이지 하락 이유'처럼 **과거 시점 질문에 답을 못 하던 문제**를 고쳤습니다(내부 뉴스가 최근 1주치뿐 + 구간 통계가 전체 평균으로 뭉개짐 + 자료 밖 지식 차단이 원인). ①질문 속 기간('25년 11월'/'2025년')을 자동 인식해 **그 기간의 일봉으로 자료를 좁히고**, ②구간 내 **최대 급락 3일·급등 2일**(날짜·등락률)을 자료에 추가, ③Gemini **구글 검색 그라운딩**을 켜서 그 시기 뉴스를 웹에서 찾아 [검색] 표시·출처 링크와 함께 인용합니다(무료 한도 내). 과거 구간 질문일 땐 최신 뉴스를 자료에서 빼 오답 유도를 제거했습니다. 실측: 같은 질문에 '3분기 실적 컨센 하회(11-07 공시·-9.4% 급락일 일치) + 증권사 목표가 일제 하향' — 출처 5건과 함께 정확히 답합니다."],
  ["v222", "2026-08-01", "📚 사업 심층 접기 — 기본은 한 줄, 클릭해야 펼쳐짐", "사업 심층이 종목조회·관심종목에서 소제목 목록만으로도 세로 공간을 크게 차지한다는 피드백을 반영해, 전체를 **한 줄 접이식**('📚 사업 심층 · N개 섹션 — 눌러서 펼치기')으로 감쌌습니다. 펼치면 기존처럼 소제목별로 다시 열어볼 수 있고, 공시 원문 링크는 펼친 안쪽으로 이동했습니다."],
  ["v221", "2026-08-01", "기업개요 대보강 — 기업 정보 팩트 + 📚 사업 심층(공식 원문 발췌)", "①**🪪 기업 정보 팩트**(종목조회 기업개요 카드): 한국은 DART 공식 API에서 대표자·설립일·직원 수·평균 연봉·평균 근속·주당배당 3개년·배당성향·시가배당률을, 미국은 직원 수·본사·섹터·경영진 명단을 가져와 표시합니다. ②**📚 사업 심층**: 한국 시총 상위 500은 최신 사업보고서의 'II. 사업의 내용'(사업 개요·주요 제품·원재료와 생산설비·매출과 수주·연구개발 등 소제목별), 미국 전 종목은 10-K Item 1(Business)을 원문 발췌로 제공 — 요약본에 없던 시장점유율·수주잔고·가동률급 정보를 공식 출처 그대로 봅니다(원문 링크 포함, 분기 갱신). 종목조회 기업개요 카드와 관심종목 워크스페이스 보고서 카드 양쪽에 접이식으로 들어갑니다."],
  ["v220", "2026-08-01", "🤔 AI 변동 사유 Q&A — 차트 아래에서 '왜 움직였나' 질문", "종목조회 차트 아래에 **AI 변동 사유 카드**를 추가했습니다. 기간(최근 5일/1개월/차트에 보이는 구간)을 고르고 분석을 누르면 **그 구간의 주가 등락·고저·거래량 급증일 + 공시 + 뉴스 헤드라인 + 외국인·기관·개인 수급 + 원칙 신호**를 한 번에 모아 Gemini에게 넘기고, '이 자료 안에서만 답하라(자료 밖 추정은 [추정] 표시)'를 강제해 근거 있는 설명을 받습니다. 자유 질문도 가능(비우면 상승/하락 사유 분석). Gemini 키는 🔑 버튼으로 브라우저에만 저장되며(youtube-mentor와 공유) 서버로 전송되지 않습니다."],
  ["v219", "2026-08-01", "관심종목 재무 그래프를 추이형 스파크라인으로 교체", "막대 방식은 분기 간 값 차이가 작으면 전부 비슷한 높이로 보여 추이가 읽히지 않았습니다(사용자 피드백). **매출·영업이익·순이익 각각을 면적 스파크라인**(자기 범위로 증폭, 높이 확대)으로 바꿔 방향과 굴곡이 한눈에 보이게 했고, 각 줄 오른쪽에 최근 분기 값을 붙였습니다. 적자 구간이 있으면 0선(점선)이 표시되고 점에 커서를 올리면 분기별 값이 나옵니다. 함께: 전년 동분기가 0에 가까울 때 YoY가 '-5,815%' 같은 허수로 표시되던 것을 **흑자전환/적자전환** 표기로 정리했습니다."],
  ["v218", "2026-08-01", "관심종목 카드 심화(재무 3종 그래프·밸류 확장·산업지표) + UI 정리", "①**관심종목 재무 카드** — 매출만 있던 분기 그래프를 **매출·영업이익·순이익 3줄 미니 막대**로 확장(각자 스케일, 적자 분기는 파란 막대). ②**밸류에이션 카드 보강** — PBR도 동종 평균과 비교, **PSR**(시총÷최근 연매출), **EPS 4개년 추이 막대**(추정치는 빗금) 추가. ③**산업 맥락 카드에 산업 진단의 실물 지표 연동** — 소속 산업의 수출금액지수(한국은행)·글로벌 프록시(SOX 등) 3종을 3개월 변화율과 함께 표시. 월간·주간 시계열의 주기가 섞여 있어 잘못 계산되던 문제(+229%로 표시)도 함께 수정. ④**종목조회 검색창을 맨 왼쪽으로** 이동, '전체 적용' 버튼 제거(라디오 '전체 신호'와 중복) 후 '신호 끄기' 버튼을 주변 요소와 같은 크기로 정리."],
  ["v217", "2026-08-01", "유니버스 전 상장 확장 + 관심종목 카드 정보 확대 + 공시 1년 전량", "①**한국 유니버스를 1,200 → 2,564종목(전 상장, 스팩·우선주 제외)으로 확장** — 이제 코스피·코스닥 거의 모든 종목이 조회됩니다(10년 일봉·원칙 신호 포함). 신규 종목의 재무·기업개요는 며칠에 걸쳐 자동 충전됩니다. ②**관심종목 카드 정보 확대** — 심층 보고서 카드에 신호등 3개+한 줄 결론, 추이 카드에 기간 수익률 4구간·신호 이력·베타/변동성, 재무 카드에 최근 분기 매출/영업이익/순이익 YoY 표, 밸류에이션에 동종업계 평균 대비·배당수익률, 수급을 5일/20일 2단 표로, 산업 카드에 동종 상위 3사 등락, 공시 4건+뉴스 3건, 원칙 성적 상위 3+워스트. ③**종목별 공시가 실제 1년치로** — 기존엔 최신 15건에서 끊겨 활발한 대형주는 2~3주치만 보였습니다(SK하이닉스 실측 15건 → 400건). 기본 12건 표시 + '더 보기'로 펼침. ④동종업계 비교에 기준 종목의 주가·등락률 표시."],
  ["v216", "2026-07-31", "그리기 도구 대폭 개선 + 크립토 전체선택 + 공시 전량 수집", "①**차트 그리기 도구 개편** — 그린 선을 지우기 어렵던 문제를 해결했습니다. 얇은 선도 쉽게 집도록 **투명한 두꺼운 클릭 영역**을 깔았고, 그림을 클릭하면 선택(강조)된 뒤 **Delete 키·✕ 버튼·우클릭** 어느 쪽으로도 지울 수 있습니다. **Ctrl+Z 되돌리기**(최근 30단계, 전체삭제도 복구)도 넣었습니다. 도구는 추세선·박스권에 더해 **수평선(지지·저항, 가격 라벨 자동)·수직선(날짜)·화살표·피보나치 되돌림(23.6~78.6% 자동)·텍스트 메모** 5종을 추가했습니다. 수평선·수직선·텍스트는 클릭 한 번으로 그려집니다. ②**크립토 차트에 전체 선택/해제 버튼** 추가(코인 12개를 하나씩 끄던 수고 제거). ③**공시 스캐너가 전체 공시를 담도록** 변경 — 코스피·코스닥만 남기던 필터 때문에 전체의 39%(기타·코넥스)가 빠져 정기공시가 누락돼 보였습니다. 하루 평균 501건 → 729건. ④종목조회 고정 헤더 위 빈틈 제거. ⑤재무 차트가 통째로 사라지던 버그 수정(대한항공 등 37종목 — 값이 없는 해에서 계산이 깨지며 차트 전체 좌표가 무효화되던 문제)."],
  ["v214", "2026-07-31", "차트 기간 10년 확대 + 분봉 3주기(당일 1분·5분 60일·60분 2년)", "①**일봉 차트를 5년 → 10년으로** 늘렸습니다(2016~2026, 2,520봉). 저장 형식을 압축 배열로 바꿔 기간이 2배가 됐는데도 용량 증가는 17%에 그쳤습니다. ②**분봉을 3가지 주기로 확대** — 기존엔 '당일 1분봉'만 있어 며칠 전 급등이 어떻게 만들어졌는지 볼 수 없었습니다. 이제 **5분봉으로 최근 60일**, **60분봉으로 최근 2년**을 되짚을 수 있습니다(유동성 상위 90종목 대상, 없는 종목은 버튼이 자동으로 숨겨집니다). ⚠1분봉의 과거 소급은 데이터 제공처가 최근 7일까지만 주기 때문에 불가능하며, 그래서 5분·60분으로 과거를 덮는 방식을 택했습니다."],
  ["v213", "2026-07-31", "종목조회 헤더 중복 제거 + 공시 스캐너 회사명 복구", "①**종목조회 상단의 고정 바와 아래 종목 헤더가 같은 정보**(종목명·현재가·등락)를 두 번 보여주던 것을 정리했습니다. 위쪽 중복 표시를 없애고 **아래 종목 헤더 자체를 고정 영역**으로 만들었으며, 원칙 선택 드롭다운도 그 헤더 안으로 합쳤습니다(검색창은 맨 위 유지). ②**공시 스캐너에서 회사명이 아예 안 보이던 문제 수정** — 앞선 수정에서 최소 너비를 제거하자, 회사 칸이 표의 열 너비(244px)를 따르지 않고 내용 크기(44px)로 줄어들며 이름이 사라졌습니다. 원인은 그 칸에 걸린 flex 배치가 표의 열 너비 계산에서 빠지는 것이었고, 일반 표 셀 배치로 되돌려 해결했습니다(689건 전부 정상 표시)."],
  ["v211", "2026-07-31", "관심종목 워크스페이스 — 종목별 종합 대시보드", "관심종목 탭을 단순 목록표에서 **종목별 리서치 워크스페이스**로 개편. 왼쪽 목록(현재가·등락·최근 신호·보고서 보유 배지, 등록순/등락률/시총/신호 정렬)에서 종목을 고르면 오른쪽에 그 종목의 사이트 전체 정보가 **8개 카드 한 화면**으로 모입니다: ①심층 보고서(있으면 열기, 없으면 '보고서 요청' 문구 복사) ②추이·신호(6개월 미니차트+최근 신호+국면) ③재무(분기 매출 막대+YoY·이익률·ROE·부채비율) ④밸류에이션(PER·PBR·선행PER+참고 내재가치 괴리) ⑤수급(외국인·기관·개인 20일) ⑥산업 맥락(소속 산업 1개월 수익률·순위) ⑦공시·뉴스 ⑧원칙 성적(이 종목 10년 베스트/워스트 원칙). 각 카드의 '자세히 →'는 해당 탭 상세로 이동. 새 수집 없이 기존 데이터 전부 재사용. 상대 주가 추이 비교는 하단 접이식으로 유지."],
  ["v210", "2026-07-31", "메뉴 재배치 + 공시 스캐너 회사명 잘림 수정", "①**관심종목을 상위 메뉴로 승격** — '내 투자' 오른쪽에 독립 메뉴로 분리했습니다(기존엔 종목 찾기 안의 탭). ②**산업 진단을 '종목 찾기'로 이동** — 산업을 좁혀 종목으로 좁혀가는 흐름이라 종목 찾기의 첫 번째 탭에 배치했습니다(기존엔 시장 보기). ③**공시 스캐너에서 회사명이 '…'로 잘리던 문제 수정** — 원인은 열 너비가 아니라, 이름을 담는 영역이 넓어진 열을 쓰지 못하고 최소 폭으로 눌려 있던 것이었습니다. 501건 전부 온전히 표시되며, 되찾은 공간은 '공시 내용' 열에 돌려줬습니다(285 → 407px)."],
  ["v209", "2026-07-31", "주식찾기 필터 재설계 — 발굴 3단계 + 조건 칩", "상단에 흩어져 있던 산업/테마/기술적 테마 3필터를 **종목 발굴 순서**로 재구성: ① 어디서 찾을까(산업·밸류체인) → ② 어떤 회사를(투자 스타일) → ③ 언제 살까(차트 신호). 카드를 클릭하면 해당 단계만 펼쳐지고(다시 클릭=접힘), 고른 조건은 상단 **조건 칩바**에 색깔 칩으로 모입니다 — 칩의 ×로 바로 해제, 전체 초기화, 결과 종목 수 실시간 표시. 가장 큰 기능 변화는 **투자 스타일과 차트 신호를 동시에 걸 수 있게 된 것**(기존엔 한쪽을 고르면 다른 쪽이 풀렸음): 이제 '저평가 성장주이면서 플래그 패턴이 뜬 종목' 같은 조합 검색이 됩니다. 세 단계는 모두 AND로 겹치고 각 단계는 건너뛰어도 됩니다."],
  ["v207", "2026-07-30", "오늘의 신호 자동화 복구 + 종목별 개인 수급 + 종목조회 3건 수정", "①**오늘의 신호가 7/24에 멈춰 있던 문제 해결**(사용자 제보). 원인은 계산 오류가 아니라 **배치가 아예 실행되지 않은 것** — 노트북이 예정 시각(07:40·12:30·17:40)에 꺼져 있다가 깨어날 때 밀린 작업이 한꺼번에 몰리고 곧 절전에 들어가며 중도 종료됐습니다(로그가 7/26 이후 없음). 살아남는 30분 간격 경량 배치엔 신호 계산이 빠져 있었습니다. → 즉시 재생성(7/24 → **7/29**, 1,393건)하고, 신호 계산을 **클라우드(GitHub Actions)로 이관**해 노트북 전원과 무관하게 30분마다 갱신되도록 했습니다. ②**종목별 수급에 개인 추가** — 시장진단의 개인은 외국인·기관의 반대로 유도한 근사치인데, 종목별로는 네이버에서 **실제 개인 순매매량**을 받을 수 있어 실측치로 넣었습니다(1,200종목 전부, 3주체 합 검산 통과). 프로파일 막대와 누적 순매수 차트 모두 반영. ③**차트 숫자 겹침 해소** — 값 라벨을 그리는 자리에서 바로 찍어 서로 포개지던 것을, 전부 모아 우선순위대로 빈자리를 찾아 배치하도록 바꿨습니다(겹침 30여 건 → 대부분 0, 생략된 숫자 없음). ④**엑셀 다운로드 '로드 실패' 수정** — 라이브러리 문제가 아니라 연결/별도 재무 포맷을 거치지 않아 난 오류였는데, 에러 메시지가 원인을 가리고 있었습니다. 원인별 안내로 분리. ⑤프로파일 '시장 대비' 흰 점의 초과수익을 %p로 함께 표기. ⑥보조지표 선택줄을 차트 안 상단으로 이동."],
  ["v205", "2026-07-29", "밸류에이션 밴드 재작성(분기 TTM) + 전광판·그리기·개인 수급", "①**PER/PBR 밴드를 분기 TTM 기준으로 재작성** — 기존엔 연간 확정 실적만 써서 밴드가 1년에 한 번만 꺾였는데, 최근 4개 분기 합(TTM)으로 바꿔 주가를 따라 기간마다 변하게 함. 실적은 발표돼야 시장이 아는 값이므로 분기 +45일·연간 +90일의 공시 시차를 적용해 그 시점부터 반영(미래 정보 사용 차단). 두산테스나 PER 32.3 → 17.3배로 정상화. **PSR·P-FCF 탭과 선행 PER, ROE 추이 그래프**도 함께 추가. ②차트 그리기 툴바를 **차트 안쪽 왼쪽 세로 레일**로 옮겨 차트 영역 확보(평소 반투명, 마우스 올리면 진해짐). ③홈 전광판이 일부 항목에서 '!'만 뜨던 문제 해결 — TradingView 무료 위젯이 원유·금 **선물 시세 권한이 없어** 생긴 것이라, 위젯을 걷어내고 우리가 직접 수집한 데이터로 만든 전광판을 상시 사용(항목 9→11개). ④시장진단 투자자별 수급에 **개인**을 추가(외국인+기관의 반대 방향으로 유도한 근사치, 기타법인 제외로 1~2% 오차) + 한국 기준이 '코스피·코스닥을 합친 거래대금 상위 300종목'임을 화면에 명시."],
  ["v202", "2026-07-29", "투매 클라이맥스 원칙 채택 + PER/PBR 밴드 + 매출구성 30% 오류 교정", "①'떨어지는 칼날' 검증(47,926건): 이격도 과대낙폭이 반복될수록 오히려 성적이 좋고(4~12회차 +6.8~9.6%p) 13회차부터 무너짐. 반등을 가르는 건 상식과 반대로 52주 신저가·거래량 폭증·극단 과매도(승률 72~75%)였고, MA120 위 낙폭은 승률 41%. → **투매 클라이맥스(이격도-15%+52주신저가+거래량2배)** 신규 채택 — 승률 65.6% edge20 +8.21%p로 매수 원칙 1위(생존조건 4개 전부 통과). 반대편 '고점 이탈 초입'은 전·후반 부호가 뒤집혀(p=0.20) 탈락. ②종목조회에 **PER/PBR 밴드** 신설(그 시점 EPS·BPS × 배수, 이 종목 이력의 10~90 백분위 5개 밴드 + 현재 위치 게이지). ③매출구성 파싱 버그 교정 — 제품명에 공백이 있으면 짝이 어긋나 전체 30%가 불완전했음(두산테스나 5.6% → 100%). 보유 904→1,166종목. ④동종업계 비교에 PER·PBR 열 + 조회 종목 자기 행 추가. ⑤신호 목록을 채택/미채택 × 매수/매도 4구획으로 구조화. ⑥Snapshot 분기 5→9분기(2년+). ⑦관심종목 표 ★열 제거·로고 정렬, 공시 스캐너 열 너비 고정."],
  ["v198", "2026-07-29", "☁️ 기기 간 자동 동기화 (Firestore)", "노트북을 바꾸면 관심종목·개발일지가 빈 화면이던 문제 해결. 원인은 버그가 아니라 설계 — 개인 데이터가 브라우저(localStorage)에만 있어 서버로 가지 않았음(보유·매매 기록을 공개 저장소에 올리지 않기 위함). 이제 구글 로그인 계정별 비공개 Firestore에 보관해 어느 기기에서든 자동으로 같아짐. 대상 9종(관심종목·개발일지·메모·매매일지·포트폴리오·토스 스냅샷·보유 비중 이력·차트 그리기). localStorage.setItem을 한 곳에서 가로채 변경분만 1.2초 디바운스 업로드하고, 충돌은 키별 타임스탬프로 최신 쪽 채택. 동기화 실패는 개발일지 탭 배지에 노출. 파일 백업·복원은 보조 수단으로 유지."],
  ["v187", "2026-07-26", "⭐ 관심종목 + Snapshot 라벨 확대", "종목조회 헤더·주식찾기 표에 ⭐ 버튼 추가(어디서 눌러도 상태가 함께 갱신). 종목 찾기 그룹에 ⭐관심종목 탭 신설 — 요약 카드(담은 수·오늘 상승·매수/매도 신호), 로고·시세·산업·최근 신호·메모 표, 산업별 묶기, 관심종목 상대 주가 추이 차트, 내보내기/가져오기. localStorage 전용(서버 전송 없음). Snapshot 그래프 숫자 폰트 확대(7.5→10.5)."],
  ["v186", "2026-07-26", "동종업계 상대 주가 추이", "동종업계 비교에서 값이 비어 있던 3개월 열을 삭제하고, 조회 종목과 동종업계의 5년 상대 주가 추이 차트를 추가(출발점=100, 조회 종목은 굵은 빨간 선). 상장일이 달라 시작점이 제각각인 문제는 전 종목이 공통으로 존재하는 날짜를 찾아 그 시점을 100으로 재정규화해 해결."],
  ["v185", "2026-07-26", "산업 분류를 밸류체인 14산업으로 일원화", "앞서 만든 12산업군이 밸류체인과 이름이 겹쳐 중복이었음 → **밸류체인(CHAINS) 14산업을 표준**으로 통일. 디스플레이가 반도체에서 분리되고 조선·해운과 산업재·기계·운송이 나뉨. 주식찾기·산업 진단·종목조회가 전부 같은 14산업을 쓰고, 산업 키가 밸류체인 키와 1:1이라 산업을 고르면 공정 단계가 바로 이어짐(디스플레이→소재·장비→부품·모듈→패널). KR 기타 5(0.4%)·US 기타 0."],
  ["v184", "2026-07-26", "산업 필터 중복 제거 — 밸류체인을 산업군에 종속", "주식찾기 왼쪽 '산업(12산업군)'과 오른쪽 '산업 밸류체인(12산업)'이 이름·키까지 겹쳐(10/12 동일) 중복이었음. 밸류체인의 산업 선택 칩을 없애고 **산업군 선택을 그대로 따라가도록** 통합(디스플레이→반도체·IT 흡수). 이제 산업군 클릭 한 번으로 세부업종 + 밸류체인 단계가 함께 펼쳐지고, 밸류체인은 '공정 단계' 축만 담당. 크립토 상관 표는 하단으로 이동."],
  ["v182", "2026-07-26", "자산시장에 환율·금 추가", "💱환율: 원화 대비 8개 통화(ECOS 매매기준율 2000~) 지수화 + 달러인덱스·유로/달러 + 원화 강약(주요 통화 평균, 실효환율 근사). 🥇금·귀금속: 금·은 추이와 증시 관계 — 금은 코스피와 동행(+0.18)이라 '주식 빠지면 금 오른다'가 항상 성립하지 않고, 금이 국고채 3년을 2개월·비트코인을 3개월 선행. 로테이션 분석에 환율 3종·은·유로달러 추가로 코스피 관련 변수 27→32건."],
  ["v181", "2026-07-26", "코인↔증시 상관 + 그래프 값 라벨", "크립토 탭에 코인별×지수별(코스피·코스닥·S&P500·나스닥·반도체) 일간 수익률 상관 히트맵 신설. 핵심 발견: BTC와 코스피는 같은 날 상관 +0.00으로 무관이지만 코인을 하루 앞세우면 +0.15(최근 1년 +0.23, p=0.003) — 코스피가 미국 마감 뒤 열리는 세션 구조 때문. 코인은 코스피보다 나스닥과 훨씬 강하게 동행(ETH +0.41). Snapshot 실적·현금흐름 막대에 값 라벨 추가하고 '만' 축약을 없애 표 값과 일치시킴."],
  ["v180", "2026-07-26", "산업 진단을 주식찾기 12산업군으로 통합 + 코스피 변수 분석", "산업 진단이 원천 업종 77개를 쓰던 것을 주식찾기와 같은 12산업군으로 교체(산업군 클릭=세부 업종 펼침→종목). 이제 두 화면의 산업이 완전히 일치. 자산시장 로테이션에 글로벌 변수 9종(반도체지수·나스닥·VIX·미국10년물·달러인덱스·유가·구리·금·상해·닛케이) 추가하고, 코스피를 종속변수로 고정한 뷰 신설 — 주가는 선행 변수가 4개뿐이고 대부분 동행이라 선행/동행/후행을 구분해 표기."],
  ["v179", "2026-07-26", "공시 오류 클라우드 반영 + 단위 체계 개편", "⚠공시 버그가 로컬에선 고쳐졌으나 feed.json이 CLOUD_OWNED라 배포되지 않고 클라우드 엔진도 옛 코드였음 → engine 동기화 + 수정본 직접 시딩으로 라이브 반영(두산테스나 7건→15건). Snapshot에 단위 선택(원·백만원·십억원·억원) 추가 + 현금흐름 막대에 값 라벨 표시. 상세 재무제표 단위도 동일 체계로 통일."],
  ["v178", "2026-07-26", "🏙 자산시장 탭 — 부동산·채권 + 로테이션 검증", "주식만 보면 놓치는 '돈의 이동'을 보는 탭 신설. 2000년 이후 월간 데이터로 19개 시장의 교차상관(-12~+12개월)을 전수 계산해 유의한 선행관계 99건을 추출. 핵심 발견: 신용 스프레드가 부동산을 2개월 선행(r=-0.72)으로 압도적 1위, 코스피는 서울 아파트를 2개월 선행, 부동산은 12개월 뒤 코스피와 역상관. 화면=요약 카드 5 + 로테이션 표 + 부동산(가격지수·전년대비·공급) + 채권(금리·스프레드)."],
  ["v177", "2026-07-26", "산업 분류 한·미 통일(12산업군) + 신호 원칙별 정리", "화면마다 달랐던 5개 산업 분류를 산업지표가 붙어 있는 12산업군으로 통일. 수집 단계에서 타일에 grp를 계산해 주식찾기·산업진단·종목조회가 같은 기준을 쓴다. 미국은 GICS 대분류가 12개뿐이라 company.json의 세부 업종을 우선 사용(미분류 38종목은 yfinance로 보강 → 기타 0%). 밸류체인은 복수 소속·공정 순서를 담으므로 대체하지 않고 산업군 하위 축으로 병존. 오늘의 신호에 원칙별 정리 추가."],
  ["v175", "2026-07-26", "'불타기' 추세추종 매수 원칙 5종 채택 + 공시 오류 수정", "기존 채택 매수 원칙이 전부 역추세(BB하단·과매도)라 '오를 때 더 산다'는 원칙이 없었음 → 추세 필터를 얹은 후보 6종을 10년 검증해 5종 통과. 플래그 돌파 +3.45%·신고가+거래량+추세필터 +2.37%가 신규 채택되어 최종 매수 원칙 5개 중 4개가 돌파형으로 바뀜. ⚠공시 치명 오류 수정: DART corp_code 매핑 정규식이 항목 경계를 넘어 짝지어 상장사 63%가 남의 공시를 보고 있었음(실리콘투 1건→15건, 전체 1,153종목 정상화). 신호 요약 대시보드를 회사 로고 타일로 개편."],
  ["v174", "2026-07-26", "오늘의 신호 대시보드 + 종목별 매매 추이 + 대가 차트 개편", "오늘의 신호: 최신일 매수/매도 요약 대시보드(방향 전환·첫 신호·지속으로 분류, 연속 횟수 배지, 매수·매도 동시 발생 경고) + 표에 상태 열. 보유 포트폴리오: 종목별 매매 추이(계단형 보유 수량 + 편입·증량·감량·전량매도 마커, 수량·단가 툴팁). 투자 대가: 같은 분기 중복·부분 공시 제외로 차트 붕괴 수정, 라벨 잘림 해결, 편입/처분 지점 점 표시, 최근 1년 편입·제외를 로고+종목조회 링크 카드로 분리."],
  ["v172", "2026-07-26", "투자 대가 비중·3년 시계열·공시 후 보도 + 크립토 5년 + 수급 20일 누적", "투자 대가: 국내 대가 포트폴리오 비중 신설(DART 보유주식수×주가, '공시된 5%↑ 보유분 내 비중') · 국내/미국 전원 3년(13분기) 보유 비중 변화 차트 · 분기 공시 이후 나온 보도를 대가별로 수집(13F는 45일 지연이라 그 사이 매매 확인용). 크립토 전 차트 5년으로 확대. 포트폴리오 점검 수급 컨텍스트를 일별 막대 3세트 → 20일 누적 라인 1개로 통합하고 금액 표기."],
  ["v171", "2026-07-26", "보유 비중 변화 시계열", "보유 포트폴리오에 📅 보유 비중 변화 차트 신설 — 100% 누적 영역(종목별/산업별 토글)에 편입▲·제외▼ 마커. 과거는 토스 체결내역(90일)으로 현재 보유에서 거꾸로 되감아 복원하고, 앞으로는 가져오기 때마다 날짜별 스냅샷이 쌓여 정확해집니다. 90일 이전은 API가 체결을 안 줘서 복원 불가(차트에 명시)."],
  ["v170", "2026-07-25", "₿ 크립토 마켓 overview", "시장 보기에 크립토 탭 신설 — 전체 시가총액·BTC 점유율·공포탐욕·김치 프리미엄 카드 + 총 시총 추이 + 주요 코인 12종 상대 수익률 멀티라인(시작=100) + 코인별 시세 표. CoinGecko·yfinance·alternative.me·업비트(전부 무키)."],
  ["v169", "2026-07-25", "실적 vs 주가 괴리 테마 2종", "💎실적↑주가↓(저평가 후보)·🎈실적↓주가↑(고평가 경계) 신설. 실적=최근 분기 vs 전년 동분기 매출·영업이익 + TTM FCF마진 변화, 주가=6·12개월 절대+시장대비 4종 백분위. 백분위는 시장별로 산출(통합 시 KR/US 지수 등락차가 선별을 지배). 연간재무 10년 검증(4,019관측): 저평가는 12개월 뒤 중앙값 +5.8%·승률 58%, 고평가는 −6.5%·43.7%로 방향은 맞으나 표본(134·142<300)·유의성 부족 → '부분 검증' 표기. 소액매출·적자기업 오탐 차단 게이트 추가."],
  ["v166", "2026-07-25", "테마 말풍선 + 트렌드 탭 이동", "기술적 테마에 마우스를 올리면 패턴의 의미·판정 기준·10년 검증 수치(한국/미국 각각)·탈락 사유를 말풍선으로 표시. 🔥트렌드를 종목 찾기 → 시장 보기로 이동."],
  ["v164", "2026-07-25", "기술적 테마 8종(10년 검증) + 산업지표 팝업", "차트 패턴 8개를 원칙과 같은 잣대로 10년 검증(1,249종목·23.5만 이벤트) 후 주식찾기 테마로 추가 — 칩에 20일 초과수익·표본 병기. 통과 4종(플래그 +2.38%p·V반등 +1.36%p·신고가눌림 +0.80%p·추세선돌파 +0.26%p) / 미통과 4종(신고가·삼각수렴·컵핸들·박스저항)은 ⚠ 표시와 각주로 '근거 약함' 명시. 산업지표 %를 3개월 전 대비로 통일하고 카드 클릭 시 의미·5년 차트 팝업."],
  ["v158", "2026-07-25", "종목 프로파일 그래프 재설계", "기간 수익률을 한 줄 통합(막대=절대·점=시장대비), 베타·변동성 게이지, 수급 좌우 대비 막대 — 좁은 레일에서 직관적으로."],
  ["v156", "2026-07-25", "글로벌 금리커브", "미국 국채 만기별 커브(3M·5Y·10Y·30Y 실시간) + 주요국 6개국 장·단기 금리 비교(ECOS). 매크로 탭 하단."],
  ["v148", "2026-07-25", "섹터 산업지표 + 외국인 랭킹 수정", "섹터 클릭 시 ECOS 수출금액지수·BSI·프록시 15종·섹터 합산 CAPEX/매출 표시. 외국인 순매수·순매도가 같던 버그를 자체 수급 집계로 해결."],
  ["v146", "2026-07-25", "점검 근거 상세화 + 밸류체인 전폭", "포트폴리오 점검에 판정 스코어카드 표(감점·통과·제외 전 항목 근거) + 리스크 매트릭스(종목×항목)·점검 점수 막대 도표. 산업 선택 시 밸류체인 카드 전폭 확장."],
  ["v138", "2026-07-24", "종목조회 고정헤더+검색 · 아마존 · 주식찾기 재배치", "종목조회 상단 sticky 헤더(종목명·현재가+검색, 스크롤 고정) / 트렌드에 아마존 미국 베스트셀러(쿠팡은 봇차단 불가) / 투자자 매매동향 왼쪽 분할·금액표시·일간7일 / 주식찾기 산업·밸류체인·테마를 시장선택 아래 전체폭, 우측은 시총+지표만."],
  ["v136", "2026-07-24", "투자자 동향·외국인 랭킹·시장분석 개편", "홈에 투자자 매매동향 그래프(개인/외국인/기관 일간·주간·월간, 네이버 KR) / 실시간 랭킹에 외국인 순매수·순매도 추가 / 금주 실적발표 KR·US 토글 / 홈 좌우 분할 상하단 정렬 / 앱명 '시장분석'으로 변경."],
  ["v134", "2026-07-24", "홈 개편·Snapshot 카드·다수 개선", "홈: 실시간랭킹=movers(30분,지연해소)+금주 실적/경제지표 우측 / Snapshot(구 실적추이): 연결·별도 토글·재무안정성 확대·현금흐름 FCF·뷰별 표 / 등락색(상승빨강·하락파랑) / 보조지표 ⓘ툴팁 / 공시1년·뉴스3개월 / 오늘의신호 종가=차트 일치 / 개발일지 관리자 아이콘."],
  ["v131", "2026-07-24", "트렌드 확장 + 실적차트 통합 + 관리자 메뉴", "워치리스트 52개 확장·급등 구간 필터(×1.5↑/×1.2/×1.0/미만)·글로벌(위키 조회수) 소스 토글·쇼핑 카테고리 인기검색어 TOP10. 분기/연간 실적 차트 토글 통합. 개발일지=우측 관리자 전용."],
  ["v130", "2026-07-24", "트렌드 레이더 탭", "구글 급상승 검색어(KR/US)+Gemini 관련주 추정, 네이버 데이터랩 워치리스트(키워드 스파크라인·급등 배지)+쇼핑 카테고리 트렌드. 소비 트렌드 → 관련주 선제 포착."],
  ["v129", "2026-07-24", "재무제표 v2 + 자동화", "연결/별도 구분·KR 분기(차감 분기화)·단위 선택(억원/백만원/원). 리포트=매일·재무=분기 자동 갱신 체제. 자정 이후 차트 공백(어제 봉 사라짐) 수정."],
  ["v128", "2026-07-24", "리포트 한경 컨센서스 교체", "유안타 등 네이버 미제휴 증권사 커버 + 목표가·투자의견·애널리스트·PDF 직링크."],
  ["v127", "2026-07-24", "개발일지 탭", "개발 내역 타임라인 + 아이디어 관리(우선순위·상태·백업)."],
  ["v126", "2026-07-24", "상세 재무제표 + 엑셀 추출", "DART 10년 연간(손익·재무상태·현금흐름·CAPEX) + yfinance(EBITDA·FCF·분기), 종목조회 3표 + .xlsx 다운로드. 재무안정성 차트 확대."],
  ["v124", "2026-07-24", "증권사 리포트 카드", "KR=네이버 리서치 최신 5건(미리보기+PDF 링크), US=애널리스트 등급변경 6건."],
  ["v123", "2026-07-24", "실적발표/경제지표 분리", "경제일정→실적발표 개명, 경제지표 별도 탭(TradingView 캘린더 월간 달력·국가/중요도 필터)."],
  ["v122", "2026-07-23", "경제일정 실적 상세 패널", "달력 회사 클릭→우측 분할(분기실적·EPS 서프라이즈·컨퍼런스콜·IR·토스 딥링크)."],
  ["v112", "2026-07-23", "홈 재구성·딜 코너·다크 마감", "히트맵|뉴스/딜 2분할, TV 티커 다크, 세계지도 칩 가독성."],
  ["v106", "2026-07-23", "레이아웃 재배치", "전역 1440px, 홈·종목조회 2단 그리드, 시장진단 3열."],
  ["v105", "2026-07-23", "토스증권 다크 테마 전환", "전 14탭 토스 실측 토큰(bg #17171c·상승 빨강/하락 파랑) 일괄 적용."],
  ["v101", "2026-07-23", "토스 미활용 API 5종", "휴장일·종목 분봉·국고채 금리이력·호가·체결 도입."],
  ["v97", "2026-07-23", "시장 진단 지표 14종", "52주 신고/신저·McClellan·평균상관·실현변동성·집중도 등 + 5년 시계열."],
  ["v100", "2026-07-23", "기업 이해 보고서 30종", "감사×투자 14장 보고서, 시총 상위 30 게시(DART 실검증)."],
  ["v85", "2026-07-22", "메뉴 개편 4그룹 14탭", "투자 퍼널(시장보기→종목찾기→원칙검증→내투자) + 소탭 통합."],
  ["v83", "2026-07-22", "당일 분봉 차트", "yfinance 1분봉(KR 200+US 99), 종목조회 타임프레임 버튼."],
  ["v68", "2026-07-20", "주식찾기(스크리너)", "국가·업종·시총·밸류체인·세부지표·테마 필터 종목 발굴."],
  ["v64", "2026-07-19", "차트 그리기 + 종목 메모", "추세선·박스권 그리기(색·선모양 편집), 종목별 메모."],
  ["v57", "2026-07-19", "매크로 탭 신설", "중앙은행 금리 지도 + 세계 증시 지도 + 5년 팝업 차트."],
  ["v52", "2026-07-18", "종목조회 토스식 심화", "분기실적·투자지표·컨센서스·재무안정성·동종비교 16섹션."],
  ["기반", "2026-07-11", "원칙 검증 파이프라인", "한·미 279종목 10년 일봉으로 차트 격언 이벤트스터디 검증→생존 원칙 선별. 오늘의 신호·마켓·뉴스 자동화."],
];

const DEVLOG_KEY = "cp_devlog_v1";
let devFilter = "all", devlogBound = false;
function devLoad() { try { return JSON.parse(localStorage.getItem(DEVLOG_KEY)) || []; } catch (e) { return []; } }
function devSave(a) { localStorage.setItem(DEVLOG_KEY, JSON.stringify(a)); }
const DEV_PRI = { 3: ["🔴", "높음"], 2: ["🟡", "중간"], 1: ["🔵", "낮음"] };
const DEV_ST = { idea: ["💡", "아이디어"], doing: ["🔨", "진행중"], done: ["✅", "완료"] };

function devAdd(text, pri) {
  if (!text.trim()) return;
  const a = devLoad();
  a.push({ id: "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text: text.trim(), pri: +pri || 2, status: "idea", created: new Date().toISOString().slice(0, 10) });
  devSave(a);
  renderDevlog();
}

/* ---------- 💾 전체 데이터 백업·복원 (기기 이전용) ----------
   이 사이트의 개인 데이터는 전부 localStorage에 있다. localStorage는 **브라우저+도메인(origin)에 묶여**
   서버로 가지 않으므로 노트북·브라우저가 바뀌면 빈 상태로 보인다(설계 의도 — 보유·매매 기록을 공개
   저장소에 올리지 않기 위함). 그래서 기기 이전은 '파일로 내보내고 새 기기에서 넣는' 방식만 가능하다. */
const BACKUP_KEYS = [
  ["cp_watch_v1", "⭐ 관심종목"],
  ["cp_devlog_v1", "🛠 개발일지 아이디어"],
  ["cp_memo_v1", "📝 종목 메모"],
  ["cp_journal_v1", "📒 매매일지"],
  ["cp_diary_v1", "📔 투자 다이어리"],
  ["cp_portfolio_v2", "💼 보유 포트폴리오"],
  ["cp_portfolio_v1", "💼 보유(구버전)"],
  ["cp_toss_v1", "🔗 토스 스냅샷"],
  ["cp_pf_hist_v1", "📅 보유 비중 이력"],
  ["cp_draw_v1", "✏️ 차트 그리기"],
];

function backupCount(raw) {           // 항목 수를 대략 세어 사용자에게 보여준다(빈 백업 오인 방지)
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.length;
    if (v && typeof v === "object") {
      if (Array.isArray(v.holdings)) return v.holdings.length;
      if (Array.isArray(v.items)) return v.items.length;
      if (v.snaps && typeof v.snaps === "object") return Object.keys(v.snaps).length;
      return Object.keys(v).length;
    }
    return v == null ? 0 : 1;
  } catch (e) { return raw ? 1 : 0; }
}

function renderBackupStatus() {
  const host = document.getElementById("backup-status");
  if (!host) return;
  const rows = BACKUP_KEYS.map(([k, label]) => {
    const raw = localStorage.getItem(k);
    const n = raw ? backupCount(raw) : 0;
    return `<div class="bk-row${raw ? "" : " empty"}"><span>${label}</span>
      <b>${raw ? n.toLocaleString() + "건" : "없음"}</b></div>`;
  }).join("");
  const total = BACKUP_KEYS.filter(([k]) => localStorage.getItem(k)).length;
  host.innerHTML = `<div class="bk-grid">${rows}</div>
    <p class="mini-note" style="margin-top:6px">이 브라우저에 저장된 항목: <b>${total}/${BACKUP_KEYS.length}</b>
      · 도메인 <b>${location.origin}</b> 기준</p>`;
}

/* 동기화 상태 배지 — 실패(보안 규칙 미설정 등)를 조용히 넘기지 않고 눈에 보이게 */
function renderSyncBadge(d) {
  const el = document.getElementById("sync-badge");
  if (!el) return;
  const s = d || window.__cpSync || {};
  el.textContent = s.msg || "확인 중…";
  el.className = "sync-badge " + (s.kind || "");
}
window.addEventListener("cpsync", (e) => renderSyncBadge(e.detail));

function bindBackupAll() {
  const bk = document.getElementById("backup-all");
  const rs = document.getElementById("restore-all");
  const f = document.getElementById("restore-all-file");
  if (!bk || !rs || !f) return;
  renderBackupStatus();
  renderSyncBadge();

  bk.onclick = () => {
    const data = {};
    BACKUP_KEYS.forEach(([k]) => {
      const raw = localStorage.getItem(k);
      if (raw != null) { try { data[k] = JSON.parse(raw); } catch (e) { data[k] = raw; } }
    });
    const pack = { app: "chart-principles", kind: "full-backup", ver: 1,
                   at: new Date().toISOString(), origin: location.origin, data };
    const blob = new Blob([JSON.stringify(pack, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `시장분석_전체백업_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  rs.onclick = () => f.click();
  f.onchange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    file.text().then((txt) => {
      let pack;
      try { pack = JSON.parse(txt); } catch (err) { alert("JSON을 읽을 수 없습니다."); return; }
      const d = pack?.data;
      if (!d || pack.kind !== "full-backup") { alert("이 사이트의 전체 백업 파일이 아닙니다."); return; }
      const lines = BACKUP_KEYS.filter(([k]) => d[k] != null)
        .map(([k, label]) => `· ${label}: ${backupCount(JSON.stringify(d[k])).toLocaleString()}건`);
      if (!lines.length) { alert("백업 파일에 복원할 데이터가 없습니다."); return; }
      if (!confirm(`아래 데이터를 이 브라우저에 복원합니다.\n같은 항목이 이미 있으면 덮어씁니다.\n\n${
        lines.join("\n")}\n\n백업 시점: ${(pack.at || "").slice(0, 16).replace("T", " ")}\n계속할까요?`)) return;
      let n = 0;
      BACKUP_KEYS.forEach(([k]) => {
        if (d[k] == null) return;
        localStorage.setItem(k, typeof d[k] === "string" ? d[k] : JSON.stringify(d[k]));
        n++;
      });
      alert(`${n}개 항목을 복원했습니다. 페이지를 새로고침합니다.`);
      location.reload();
    });
    f.value = "";
  };
}

function renderDevlog() {
  bindBackupAll();
  // 개발 내역(정적)
  const hist = document.getElementById("dev-history-list");
  if (hist) hist.innerHTML = DEV_HISTORY.map(([v, d, title, desc]) =>
    `<div class="dev-hist-row"><div class="dev-hv"><span class="dev-ver">${v}</span><span class="sub-note">${d}</span></div>
      <div><b>${title}</b><div class="sub-note">${desc}</div></div></div>`).join("");

  // 아이디어 목록
  const host = document.getElementById("dev-list");
  let items = devLoad();
  const counts = { all: items.length, idea: 0, doing: 0, done: 0 };
  items.forEach((it) => counts[it.status] = (counts[it.status] || 0) + 1);
  const cnt = document.getElementById("dev-count");
  if (cnt) cnt.textContent = `(${counts.idea}💡 ${counts.doing}🔨 ${counts.done}✅)`;
  document.querySelectorAll("#dev-filters button").forEach((b) =>
    b.classList.toggle("active", b.dataset.f === devFilter));
  let shown = devFilter === "all" ? items : items.filter((it) => it.status === devFilter);
  // 진행중 → 아이디어 → 완료, 각 그룹 내 우선순위 높은 순 → 최신순
  const order = { doing: 0, idea: 1, done: 2 };
  shown = shown.slice().sort((a, b) =>
    order[a.status] - order[b.status] || b.pri - a.pri || (b.created > a.created ? 1 : -1));
  host.innerHTML = shown.length ? shown.map((it) => {
    const [pe] = DEV_PRI[it.pri] || DEV_PRI[2];
    return `<div class="dev-item ${it.status === "done" ? "done" : ""}" data-id="${it.id}">
      <button class="dev-check" title="상태 변경">${DEV_ST[it.status][0]}</button>
      <div class="dev-body">
        <span class="dev-text" contenteditable="true" spellcheck="false">${it.text.replace(/</g, "&lt;")}</span>
        <div class="dev-meta"><span class="dev-pri" title="우선순위">${pe}</span>
          <span class="sub-note">${it.created}</span></div>
      </div>
      <button class="dev-del" title="삭제">✕</button></div>`;
  }).join("") : `<p class="mini-note">${devFilter === "all" ? "아직 아이디어가 없습니다. 위에 입력해 추가하세요." : "이 상태의 항목이 없습니다."}</p>`;

  // 상태 순환(💡→🔨→✅→💡), 우선순위 순환, 삭제, 인라인 편집
  host.querySelectorAll(".dev-item").forEach((el) => {
    const id = el.dataset.id;
    el.querySelector(".dev-check").onclick = () => {
      const a = devLoad(), it = a.find((x) => x.id === id);
      if (it) { it.status = { idea: "doing", doing: "done", done: "idea" }[it.status]; devSave(a); renderDevlog(); }
    };
    el.querySelector(".dev-pri").onclick = () => {
      const a = devLoad(), it = a.find((x) => x.id === id);
      if (it) { it.pri = it.pri === 3 ? 1 : it.pri + 1; devSave(a); renderDevlog(); }
    };
    el.querySelector(".dev-del").onclick = () => {
      const a = devLoad().filter((x) => x.id !== id); devSave(a); renderDevlog();
    };
    const txt = el.querySelector(".dev-text");
    txt.onblur = () => {
      const a = devLoad(), it = a.find((x) => x.id === id);
      if (it && txt.textContent.trim() && txt.textContent.trim() !== it.text) { it.text = txt.textContent.trim(); devSave(a); }
    };
    txt.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); txt.blur(); } };
  });

  if (devlogBound) return;
  devlogBound = true;
  const add = () => { const i = document.getElementById("dev-new"); devAdd(i.value, document.getElementById("dev-new-pri").value); i.value = ""; i.focus(); };
  document.getElementById("dev-add").onclick = add;
  document.getElementById("dev-new").onkeydown = (e) => { if (e.key === "Enter") add(); };
  document.querySelectorAll("#dev-filters button").forEach((b) =>
    b.onclick = () => { devFilter = b.dataset.f; renderDevlog(); });
  document.getElementById("dev-export").onclick = () => {
    const blob = new Blob([JSON.stringify(devLoad(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "개발일지_아이디어.json"; a.click();
  };
  document.getElementById("dev-import").onclick = () => document.getElementById("dev-import-file").click();
  document.getElementById("dev-import-file").onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const imp = JSON.parse(rd.result);
        if (!Array.isArray(imp)) throw 0;
        const cur = devLoad(), ids = new Set(cur.map((x) => x.id));
        imp.forEach((x) => { if (x && x.id && !ids.has(x.id)) cur.push(x); });
        devSave(cur); renderDevlog();
        alert(`가져오기 완료 (${imp.length}건 중 신규 병합)`);
      } catch (x) { alert("가져오기 실패 — 올바른 백업 파일이 아닙니다."); }
    };
    rd.readAsText(f);
  };
}

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
const scrState = { country: "kr", groups: null, sectors: null, min: null, max: null, sort: "mcap" };  // 국가 필수(전체 제거) — 기본 한국. sectors=null → 업종 전체
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
  $("#scr-context").innerHTML = `<b>주식찾기</b> — 종목 발굴 3단계: <b>① 어디서</b>(산업·밸류체인) → <b>② 어떤 회사를</b>(투자 스타일) → <b>③ 언제</b>(차트 신호). 각 단계는 건너뛰어도 되고, 고른 조건은 <b>모두 동시 적용(AND)</b>됩니다. 오른쪽 세부 지표(PER·성장률 등)로 더 좁힐 수 있습니다.`;
  // 발굴 3단계 카드 — 클릭=해당 패널 펼침(하나만), 활성 카드 재클릭=접힘
  document.querySelectorAll("#scr-steps .scr-step").forEach((b) =>
    b.onclick = () => scrSetStep(b.dataset.step));
  scrStep = null; scrSetStep("industry");   // 첫 진입은 ①산업 펼침
  // 국가 토글
  document.querySelectorAll("#scr-country button").forEach((b) => b.onclick = () => {
    document.querySelectorAll("#scr-country button").forEach((x) => x.classList.toggle("active", x === b));
    scrState.country = b.dataset.c;
    scrState.groups = scrState.sectors = null; scrState.min = scrState.max = null; scrOpenGroup = null;
    $("#scr-mcap-min").value = ""; $("#scr-mcap-max").value = "";
    buildScrSectors(); buildScrTiers(); setScrUnitLabel(); scrSyncFilterVisibility();
    renderScrTech();  // 기술 테마 배지 수를 선택 국가 기준으로 재계산
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
  $("#scr-sec-reset").onclick = () => { scrState.groups = scrState.sectors = null; scrOpenGroup = null; buildScrSectors(); renderScreener(); };
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
/* 한·미 공통 12산업군 — 수집 단계(market_dash)가 타일에 `grp`를 넣어준다.
   같은 기준을 주식찾기·산업 진단·종목조회가 함께 쓰므로 화면 간 산업이 어긋나지 않는다.
   (밸류체인 CHAINS는 대체가 아니라 이 아래의 '공정 단계' 축으로 병존) */
const IND_GROUPS = [
  { key: "semi", icon: "🔌", name: "반도체" },
  { key: "battery", icon: "🔋", name: "2차전지" },
  { key: "auto", icon: "🚗", name: "자동차" },
  { key: "bio", icon: "💊", name: "바이오·헬스" },
  { key: "display", icon: "🖥️", name: "디스플레이" },
  { key: "defense", icon: "🛡️", name: "방산·우주항공" },
  { key: "ship", icon: "🚢", name: "조선·해운" },
  { key: "chem", icon: "⚗️", name: "화학·소재" },
  { key: "energy", icon: "⛽", name: "에너지·유틸리티" },
  { key: "machinery", icon: "🏭", name: "산업재·기계·운송" },
  { key: "construction", icon: "🏗️", name: "건설·건자재" },
  { key: "internet", icon: "📱", name: "인터넷·게임·엔터" },
  { key: "finance", icon: "🏦", name: "금융" },
  { key: "consumer", icon: "🛒", name: "소비재·유통" },
  // 사업이 여러 산업에 걸쳐 하나로 묶을 수 없는 복합 지주회사(LG·CJ·두산·롯데지주 등).
  // 자회사가 한 산업에 몰린 지주(POSCO홀딩스=철강)는 그 산업에 그대로 둔다.
  { key: "holding", icon: "🏛️", name: "지주회사" },
];
const IND_BY_KEY = Object.fromEntries(IND_GROUPS.map((g) => [g.key, g]));
/* 산업군 → 밸류체인(CHAINS) 매핑. 12개 중 10개는 키가 같고 디스플레이는 반도체·IT에 흡수,
   건설은 이름만 다르다. **밸류체인은 별도 산업 선택 없이 산업군을 따라간다**(중복 제거). */
// 산업 = 밸류체인 산업과 **키가 완전히 동일**해졌다(14개 1:1) → 매핑 없이 키를 그대로 쓴다.
// ⚠CHAINS는 아래에서 선언되므로 즉시 참조하면 TDZ 오류 — 호출 시점에 확인한다.
const chainOf = (grp) => (grp && CHAINS[grp] ? grp : null);
const indName = (k) => (IND_BY_KEY[k] || SCR_GROUP_ETC).name;
const indLabel = (k) => { const g = IND_BY_KEY[k] || SCR_GROUP_ETC; return `${g.icon} ${g.name}`; };
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
    { key: "adcomm", icon: "📢", name: "광고·커머스", desc: "광고·이커머스", codes: ["030000"] },
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
    // 실리콘투(257720)는 K-뷰티 브랜드를 전 세계에 파는 유통사다 — 네이버 업종이 '인터넷과카탈로그소매'라
    // 광고·커머스에 들어가 있었고, 그 탓에 동종업계가 예스24·미트박스로 잡혔다(2026-08-03 교정).
    { key: "cosmetic", icon: "💄", name: "화장품·생활", desc: "화장품·생활용품", codes: ["090430", "051900", "161890", "192820", "241710", "439090", "021240", "257720"] },
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
  scrState.groups = scrState.sectors = null; scrState.min = scrState.max = null; scrOpenGroup = null;
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
  if (!flowHost) return;
  const uni = new Set(((MARKET && MARKET.heatmap) || []).map((t) => t.m + "_" + t.t));
  /* ⚠밸류체인의 '산업 선택 칩'은 제거했다 — 12개 중 10개가 산업군과 키까지 같아 중복이었다.
     이제 **왼쪽 산업군 선택을 그대로 따라가고**(GRP2CHAIN), 밸류체인은 '공정 단계' 축만 담당한다. */
  if (indHost) indHost.innerHTML = "";
  // 단계 플로우
  if (!scrChainIndustry) {
    flowHost.innerHTML = "";
  } else {
    const c = CHAINS[scrChainIndustry];
    const stages = scrChainAllStages(scrChainIndustry);
    flowHost.innerHTML = `<div class="scr-chain-head"><b>${c.icon} ${c.name} 밸류체인</b>
        <span class="sub-note">${c.flow ? "상류 → 하류 공정 순서" : "카테고리"} · 단계 클릭=필터</span></div>` +
      stages.map((st, i) => {
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
  /* 산업 필터 = **한·미 공통 12산업군**(타일의 grp). 산업 진단 지표·종목조회와 같은 기준이라
     화면 사이에 산업이 어긋나지 않는다. 그룹을 누르면 그 안의 원천 업종(세부)이 하단에 펼쳐진다. */
  const pool = scrPool();
  const byG = {};
  pool.forEach((t) => {
    const k = t.grp || "etc";
    const g = byG[k] = byG[k] || { subs: {}, total: 0 };
    g.subs[t.sector] = (g.subs[t.sector] || 0) + 1;
    g.total += 1;
  });
  Object.values(byG).forEach((g) => { g.subs = Object.entries(g.subs).sort((a, b) => b[1] - a[1]); });
  const metaMap = Object.fromEntries([...IND_GROUPS, SCR_GROUP_ETC].map((g) => [g.key, g]));
  const order = [...IND_GROUPS.map((g) => g.key), "etc"].filter((k) => byG[k]);
  const selHas = (nm) => scrState.sectors && scrState.sectors.has(nm);
  host.innerHTML = order.map((k) => {
    const g = metaMap[k], grp = byG[k];
    const selN = grp.subs.filter(([nm]) => selHas(nm)).length;
    const grpOn = scrState.groups && scrState.groups.has(k);
    const cls = grpOn ? "all" : selN ? "some" : "";
    const open = scrOpenGroup === k;
    // 세부업종 칩은 그룹 안이 아니라 하단 전폭 행(#scr-sub-host)에 — 국내 밸류체인 단계와 동일한 UX
    return `<div class="scr-group">
      <button class="scr-gchip ${cls} ${open ? "open" : ""}" data-gk="${k}"
        title="${g.name} ${grp.total}종목 — 클릭=선택/해제, 다시 클릭하면 세부업종 펼침"
        ><span class="scr-gi">${g.icon}</span>${g.name}<span class="scr-gn">${grp.total}</span>${
        selN ? `<span class="scr-gsel">${selN}</span>` : ""}</button>
      </div>`;
  }).join("");

  // ── 하단 전폭: 선택된 그룹의 세부업종 ──
  const subHost = $("#scr-sub-host");
  if (subHost) {
    const g = metaMap[scrOpenGroup], grp = byG[scrOpenGroup];
    subHost.innerHTML = (g && grp)
      ? `<div class="scr-subs-wide">
          <div class="scr-subs-head"><b>${g.icon} ${g.name}</b> <span class="sub-note">세부업종</span>
            <button class="scr-sub-all" data-gk="${scrOpenGroup}">${grp.subs.every(([nm]) => selHas(nm)) && grp.subs.length ? "그룹 해제" : "그룹 전체"}</button></div>
          <div class="scr-subs">${grp.subs.sort((a, b) => b[1] - a[1]).map(([nm, n]) =>
            `<button class="scr-sub ${selHas(nm) ? "on" : ""}" data-sec="${nm.replace(/"/g, "&quot;")}">${nm}<span class="scr-subn"> ${n}</span></button>`).join("")}</div>
        </div>`
      : `<p class="mini-note">위에서 업종을 선택하면 세부업종이 표시됩니다.</p>`;
  }
  // 산업군 칩: 선택 토글 + 펼치기(선택된 상태에서 다시 누르면 세부업종 표시)
  host.querySelectorAll(".scr-gchip").forEach((b) => b.onclick = () => {
    const k = b.dataset.gk;
    if (!scrState.groups) scrState.groups = new Set();
    if (scrState.groups.has(k)) { scrState.groups.delete(k); scrOpenGroup = null; }
    else { scrState.groups.add(k); scrOpenGroup = k; }
    if (!scrState.groups.size) scrState.groups = null;
    // 밸류체인은 산업군을 따라간다 — 국내에서 해당 산업에 체인이 있으면 단계 표시
    scrChainSel.clear();
    scrChainIndustry = scrState.country === "us" ? null : chainOf(scrOpenGroup);
    buildScrSectors(); renderScrChain(); renderScreener();
  });
  // 세부업종 칩은 하단 전폭 행에 있으므로 document 기준으로 바인딩
  document.querySelectorAll("#scr-sub-host .scr-sub").forEach((b) => b.onclick = () => {
    const nm = b.dataset.sec;
    if (!scrState.sectors) scrState.sectors = new Set();
    if (scrState.sectors.has(nm)) scrState.sectors.delete(nm); else scrState.sectors.add(nm);
    if (!scrState.sectors.size) scrState.sectors = null;
    buildScrSectors(); renderScreener();
  });
  document.querySelectorAll("#scr-sub-host .scr-sub-all").forEach((b) => b.onclick = () => {
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
  const g = scrState.groups ? scrState.groups.size : 0;
  const n = scrState.sectors ? scrState.sectors.size : 0;
  const el = $("#scr-sec-count");
  if (!el) return;
  el.textContent = g || n
    ? [g ? `산업군 ${g}` : "", n ? `세부업종 ${n}` : ""].filter(Boolean).join(" · ") + " 선택"
    : `전체 산업 (${IND_GROUPS.length}개 산업군)`;
}
// 국가에 따라 필터 UI 전환: 한국=밸류체인만 / 미국=산업(업종)필터만 / 전체=둘 다
function scrSyncFilterVisibility() {
  const c = scrState.country;
  // 산업군 필터는 이제 **한·미 공통**이라 항상 표시. 밸류체인(공정 단계)만 국내 전용.
  const secRow = $("#scr-sector-row");
  if (secRow) secRow.style.display = "";
  // 밸류체인은 국내 전용 — 미국으로 바꾸면 단계 선택을 해제한다
  if (c === "us") { scrChainIndustry = null; scrChainSel.clear(); }
  // ⚠하단 전폭 세부 행은 밸류체인 단계와 세부업종이 공유 → 전환 시 잔상 제거
  const flow = $("#scr-chain-flow");
  if (c === "us" && flow) flow.innerHTML = "";          // 미국인데 국내 밸류체인 단계가 남는 문제
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

/* ── 발굴 3단계 패널(v209) — 카드=탭(하나만 펼침·재클릭=접힘), 선택 상태는 칩바·카드 요약에 집계 ── */
let scrStep = "industry";
function scrSetStep(s) {
  scrStep = (scrStep === s) ? null : s;   // 활성 카드 재클릭 = 접힘(첫 화면을 결과 위주로)
  document.querySelectorAll("#scr-steps .scr-step").forEach((b) =>
    b.classList.toggle("active", b.dataset.step === scrStep));
  ["industry", "style", "signal"].forEach((k) => {
    const p = $("#scr-panel-" + k);
    if (p) p.style.display = (k === scrStep) ? "" : "none";
  });
}
function scrIndustryLabel() {
  // 구체적인 선택(밸류체인 단계 > 세부업종 > 산업군) 순으로 요약
  if (scrChainIndustry && scrChainSel.size) {
    const ind = CHAINS[scrChainIndustry];
    const st = [...scrChainSel].map((k) => ind?.stages.find((x) => x.key === k)?.name || k);
    return `${ind?.name || scrChainIndustry} › ${st.slice(0, 2).join("·")}${st.length > 2 ? ` 외 ${st.length - 2}` : ""}`;
  }
  if (scrState.sectors) {
    const s = [...scrState.sectors];
    return `${s.slice(0, 2).join("·")}${s.length > 2 ? ` 외 ${s.length - 2}` : ""}`;
  }
  if (scrState.groups) {
    const meta = Object.fromEntries([...IND_GROUPS, SCR_GROUP_ETC].map((g) => [g.key, g.name]));
    const s = [...scrState.groups].map((k) => meta[k] || k);
    return `${s.slice(0, 2).join("·")}${s.length > 2 ? ` 외 ${s.length - 2}` : ""}`;
  }
  return null;
}
function scrSignalLabel() {
  if (!scrTechActive) return null;
  if (scrTechActive.startsWith("gap_")) return GAP_DEF[scrTechActive]?.name || scrTechActive;
  return TECHPAT?.patterns?.find((p) => p.id === scrTechActive)?.name || scrTechActive;
}
function scrChips(nRows, nPool) {
  const bar = $("#scr-chipbar"); if (!bar) return;
  const defs = [
    ["industry", "c1", "①", scrIndustryLabel()],
    ["style", "c2", "②", scrThemeActive ? SCR_THEMES.find((x) => x.id === scrThemeActive)?.name : null],
    ["signal", "c3", "③", scrSignalLabel()],
  ];
  // 카드 요약도 같은 텍스트로 동기화
  defs.forEach(([k, , , label]) => {
    const el = $("#scr-sum-" + k);
    if (el) { el.textContent = label || "전체"; el.classList.toggle("set", !!label); }
  });
  const chips = defs.filter(([, , , label]) => label)
    .map(([k, c, num, label]) => `<button class="scr-chip ${c}" data-act="${k}" title="클릭=이 조건 해제">${num} ${label} <span class="x">×</span></button>`);
  bar.innerHTML = `<span class="lbl">적용 조건</span>
    ${chips.length ? chips.join("") : `<span class="lbl">없음 — 아래 카드에서 조건을 고르세요</span>`}
    ${chips.length > 1 ? `<span class="lbl">모두 동시 적용(AND)</span>` : ""}
    <span class="scr-chip-count">결과 <b>${(nRows ?? 0).toLocaleString()}</b> / ${(nPool ?? 0).toLocaleString()}종목</span>
    ${chips.length ? `<button class="scr-chip-reset" data-act="all">전체 초기화</button>` : ""}`;
  const clear = {
    industry: () => { scrState.groups = scrState.sectors = null; scrOpenGroup = null;
      scrChainIndustry = null; scrChainSel.clear(); buildScrSectors(); renderScrChain(); },
    style: () => { scrThemeActive = null; renderScrThemes(); },
    signal: () => { scrTechActive = null; renderScrTech(); },
  };
  bar.querySelectorAll("[data-act]").forEach((b) => b.onclick = () => {
    if (b.dataset.act === "all") Object.values(clear).forEach((f) => f());
    else clear[b.dataset.act]();
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
    // v209: 기술 패턴과 상호배타 해제 — 차원이 달라 AND 조합("저평가 성장주이면서 플래그")이 이 화면의 강점
    renderScrThemes(); renderScrTech(); renderScreener();
  });
  setDesc();
  renderScrTech();
}

/* ── 기술적 테마(차트 패턴) — tech_patterns.json 사전 검증 결과 + 현재 신호 종목 ── */
let TECHPAT = null, techLoading = null, scrTechActive = null;
function loadTechPat() {
  if (TECHPAT) return Promise.resolve(TECHPAT);
  if (techLoading) return techLoading;
  techLoading = fetch("data/tech_patterns.json" + _cb).then((r) => (r.ok ? r.json() : null))
    .then((j) => { TECHPAT = j; return j; }).catch(() => null);
  return techLoading;
}
const TECH_ICON = { flag: "🚩", v_rebound: "✅", high_pullback: "📈", trend_break: "📐",
                    new_high: "🏔", triangle: "🔺", cup_handle: "☕", box_resist: "📦" };
// 패턴별 '무엇을 뜻하는가' — 시장 심리 해석과 쓰는 법(판정 조건·검증 수치는 tech_patterns.json에서 붙임)
const TECH_TIP = {
  flag: "급등 후 <b>차익실현 물량이 적게 나온</b> 상태. 깃대(급등)에 이어 좁은 조정이 깃발 모양을 만들며, 팔 사람이 없다는 뜻이라 재차 상승으로 이어지기 쉽습니다. 조정이 깊거나(−10% 초과) 길어지면(15일↑) 힘이 빠진 것으로 봅니다.",
  v_rebound: "공포로 급락한 뒤 <b>저점에서 되돌아선</b> 자리. 투매가 끝나고 매수세가 들어왔다는 신호로, 낙폭이 클수록 되돌림 여력도 큽니다. 다만 하락 추세 자체는 아직 살아 있을 수 있어 손절선을 저점 아래로 두고 봅니다.",
  high_pullback: "신고가를 낸 강한 종목이 <b>얕게 쉬어가는</b> 자리. 추세는 살아 있는데(MA20 위) 단기 과열만 식힌 상태라 진입 가격이 유리해집니다. 조정이 −12%를 넘어가면 추세 훼손으로 봅니다.",
  trend_break: "내리막 추세선을 <b>위로 뚫은</b> 자리. 하락하던 고점 흐름을 종가가 넘어서면 매도 우위가 꺾였다는 뜻으로, 추세 전환의 첫 신호로 씁니다. 거래량이 함께 늘면 신뢰도가 올라갑니다.",
  new_high: "52주 최고가 경신 — <b>물려 있는 매물이 없는</b> 상태. 강세의 증거지만 검증에서 <b>한국은 +1.62%p, 미국은 −0.52%p</b>로 방향이 엇갈려 채택하지 않았습니다(국내 한정 신호). 신고가만 보고 사기보다 눌림(신고가 눌림)까지 기다리는 편이 안전합니다.",
  triangle: "고점은 낮아지고 저점은 높아지며 <b>변동성이 말라가는</b> 구간. 교과서에선 곧 큰 방향이 나온다고 보지만, 방향이 위인지 아래인지는 알려주지 않습니다 — 검증에서도 수렴 자체는 수익으로 이어지지 않았습니다(돌파를 확인한 뒤 대응).",
  cup_handle: "긴 U자 하락·회복 뒤 짧은 눌림을 거쳐 <b>전고점을 넘는</b> 형태. 유명한 패턴이지만 컵의 깊이·기간을 어떻게 잡느냐에 따라 결과가 크게 달라지고, 우리 기준(120일)으로는 초과수익이 나오지 않았습니다.",
  box_resist: "좁은 박스 상단(저항선)에 <b>붙어 있는</b> 상태. 뚫으면 상승이라고들 하지만, 실제로는 저항에 막혀 되밀리는 경우가 더 많아 8개 패턴 중 성적이 가장 나빴습니다. 돌파 후 안착을 확인하고 접근하세요.",
};
function techTipHtml(p, n) {
  const pct = (v) => (v == null ? "-" : (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + "%p");
  // pass_markets = 한·미 '둘 다 +' 조건 — 둘 다 음수인 경우와 한쪽만 +인 경우를 구분해 표기
  const mkFail = !p.pass_markets && (p.edge_kr <= 0 && p.edge_us <= 0
    ? "한국·미국 모두 초과수익 음수" : `${p.edge_kr > 0 ? "미국" : "한국"}에선 초과수익 음수(한·미 불일치)`);
  const fail = [mkFail, !p.pass_halves && "전·후반 기간 불안정",
                !p.pass_p && "통계 유의성 부족", !p.pass_n && "표본 부족"].filter(Boolean).join(" · ");
  return `<div class="tt-h">${TECH_ICON[p.id] || "📊"} ${p.name}
      <span class="${p.passed ? "tt-ok" : "tt-bad"}">${p.passed ? "✅ 검증 통과" : "⚠ 검증 미통과"}</span></div>
    <p class="tt-mean">${TECH_TIP[p.id] || ""}</p>
    <div class="tt-cond"><b>판정 기준</b> ${p.desc || ""}</div>
    <table class="tt-tb"><tr><td>20일 초과수익</td><td class="${p.edge20 >= 0 ? "tt-p" : "tt-n"}">${pct(p.edge20)}</td>
        <td>승률</td><td>${(p.win20 * 100).toFixed(1)}%</td></tr>
      <tr><td>5일 / 60일</td><td colspan="3">${pct(p.edge5)} / ${pct(p.edge60)}</td></tr>
      <tr><td>한국 / 미국</td><td colspan="3">${pct(p.edge_kr)} / ${pct(p.edge_us)}</td></tr>
      <tr><td>표본</td><td>${(p.n || 0).toLocaleString()}건</td>
        <td>p값</td><td>${p.p < 0.001 ? "&lt;0.001" : (p.p ?? 0).toFixed(4)}</td></tr></table>
    <div class="tt-foot">${p.passed
      ? `현재 신호 <b>${n}종목</b> · 초과수익 = 신호 20일 뒤 수익률 − 같은 종목 무작위 시점(시장) 평균`
      : `<b>탈락 사유: ${fail || "초과수익 음수"}</b> — 근거가 약하니 참고만 하세요 (현재 ${n}종목)`}</div>`;
}

function renderScrTech() {
  const host = $("#scr-tech"); if (!host) return;
  Promise.all([loadTechPat(), loadGap()]).then(([d]) => {
    const pats = d?.patterns || [], cur = d?.current || {};
    if (!pats.length) { host.innerHTML = ""; return; }
    // 스캔 대상은 화면 유니버스·선택 국가보다 넓음 — 실제로 표에 뜰 종목 수만 배지에 표시
    const pool = new Set(scrPool().map((t) => t.m + "_" + t.t));
    const chip = (p) => {
      const n = (cur[p.id] || []).filter((k) => pool.has(k)).length;
      const weak = !p.passed;
      const edge = p.edge20 != null ? `${p.edge20 >= 0 ? "+" : ""}${(p.edge20 * 100).toFixed(2)}%p` : "-";
      return `<button class="scr-theme tech ${scrTechActive === p.id ? "on" : ""} ${weak ? "weak" : ""} ${n ? "" : "none"}"
        data-id="${p.id}">${TECH_ICON[p.id] || "📊"} ${p.name}
        <span class="tech-edge ${weak ? "" : "ok"}">${edge}</span>
        <span class="tech-n">${n}</span>${weak ? `<span class="tech-warn">⚠</span>` : ""}</button>`;
    };
    const passed = pats.filter((p) => p.passed), failed = pats.filter((p) => !p.passed);
    // 💰 실적 vs 주가 괴리 — 별도 데이터(valuation_gap.json), 없으면 구획 자체를 숨김
    const gapChip = (id) => {
      const D = GAP_DEF[id];
      const n = ((id === "gap_under" ? GAPD.undervalued : GAPD.overvalued) || [])
        .filter((k) => k.startsWith(scrState.country + "_")).length;
      const b = GAPD.backtest?.[D.side] || {};
      const med = b.med == null ? "-" : `${b.med >= 0 ? "+" : ""}${(b.med * 100).toFixed(1)}%`;
      return `<button class="scr-theme tech weak ${scrTechActive === id ? "on" : ""} ${n ? "" : "none"}"
        data-id="${id}">${D.icon} ${D.name}
        <span class="tech-edge">${med}</span><span class="tech-n">${n}</span><span class="tech-warn">⚠</span></button>`;
    };
    const gapHtml = GAPD ? `<div class="scr-themes-head" style="margin-top:10px">💰 실적 vs 주가
        <span class="sub-note">분기 실적(전년 동기 대비)과 주가의 괴리 · 12개월 뒤 성적은 중앙값</span></div>
      <div class="scr-themes">${["gap_under", "gap_over"].map(gapChip).join("")}</div>` : "";
    host.innerHTML = `<div class="scr-themes-head">📊 기술적 테마
        <span class="sub-note">최근 5일 발생 · 10년 검증(초과수익=20일 시장 대비)</span></div>
      <div class="scr-themes">${passed.map(chip).join("")}</div>
      ${failed.length ? `<div class="scr-themes" style="margin-top:5px">${failed.map(chip).join("")}</div>` : ""}
      ${gapHtml}
      <p class="sub-note tech-foot">⚠ 표시 = <b>검증 미통과·부분 검증</b>(초과수익 음수 / 한·미 방향 불일치 /
        표본·통계 유의성 부족). 널리 쓰이는 기준이라 제공하지만 <b>근거가 약하니 참고만</b> 하세요.
        각 항목에 마우스를 올리면 의미와 검증 수치가 나옵니다.</p>`;
    const byId = Object.fromEntries(pats.map((p) => [p.id, p]));
    let tip = $("#tech-tip");
    if (!tip) { tip = document.createElement("div"); tip.id = "tech-tip"; document.body.appendChild(tip); }
    // (아래는 기술적 테마 칩 바인딩 — 대가 카드의 편입·처분 칩은 renderGurus 말미에서 바인딩)
  host.querySelectorAll(".scr-theme.tech").forEach((b) => {
      b.onclick = () => {
        scrTechActive = (scrTechActive === b.dataset.id) ? null : b.dataset.id;
        // v209: 재무 테마와 상호배타 해제 — 세 단계(산업·스타일·신호)는 전부 AND
        tip.style.display = "none";
        renderScrTech(); renderScreener();
      };
      // 말풍선: 패턴의 의미 + 판정 기준 + 10년 검증 수치(통과/탈락 사유)
      b.onmouseenter = () => {
        const id = b.dataset.id;
        if (id.startsWith("gap_")) {
          const n = ((id === "gap_under" ? GAPD.undervalued : GAPD.overvalued) || [])
            .filter((k) => k.startsWith(scrState.country + "_")).length;
          tip.innerHTML = gapTipHtml(id, n);
        } else {
          const p = byId[id]; if (!p) return;
          tip.innerHTML = techTipHtml(p, (cur[p.id] || []).filter((k) => pool.has(k)).length);
        }
        tip.style.display = "block";
        const r = b.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
        tip.style.left = Math.max(8, Math.min(r.left, window.innerWidth - tw - 12)) + "px";
        // 아래 공간이 부족하면 칩 위쪽으로 뒤집어 표시
        tip.style.top = (r.bottom + th + 12 > window.innerHeight ? Math.max(8, r.top - th - 8) : r.bottom + 8) + "px";
      };
      b.onmouseleave = () => { tip.style.display = "none"; };
    });
  });
}
// 기술 패턴 / 괴리 테마 필터 통과 여부(선택 없으면 전부 통과)
function scrTechPass(t) {
  if (!scrTechActive) return true;
  const key = `${t.m}_${t.t}`;
  if (scrTechActive.startsWith("gap_")) {
    const list = (scrTechActive === "gap_under" ? GAPD?.undervalued : GAPD?.overvalued) || [];
    return list.includes(key);
  }
  return (TECHPAT?.current?.[scrTechActive] || []).includes(key);
}

/* ── 💰 실적 vs 주가 괴리 테마 (valuation_gap.json) ── */
let GAPD = null, gapLoading = null;
function loadGap() {
  if (GAPD) return Promise.resolve(GAPD);
  if (gapLoading) return gapLoading;
  gapLoading = fetch("data/valuation_gap.json" + _cb).then((r) => (r.ok ? r.json() : null))
    .then((j) => { GAPD = j; return j; }).catch(() => null);
  return gapLoading;
}
const GAP_DEF = {
  gap_under: { icon: "💎", name: "실적↑ 주가↓", side: "under",
    mean: "매출·영업이익이 <b>전년 동기보다 늘고</b> FCF 마진까지 좋아졌는데, 주가는 오히려 뒤처진 종목. 시장이 아직 실적 개선을 반영하지 않았다면 기회지만, <b>시장이 이미 아는 악재</b>(수주 절벽·규제·업황 꺾임)를 선반영 중일 수도 있어 '왜 안 오르는지'를 반드시 따로 확인해야 합니다.",
    cond: "펀더멘털 상위 30% · 주가 하위 30% · 괴리 40p↑ · TTM 영업흑자" },
  gap_over: { icon: "🎈", name: "실적↓ 주가↑", side: "over",
    mean: "매출·영업이익이 <b>전년 동기보다 줄었는데</b> 주가는 크게 오른 종목. 미래 기대(신사업·업황 반등)를 선반영한 것일 수도, 실적이 못 따라오는 과열일 수도 있습니다. <b>보유 중이라면 기대가 실적으로 확인되는지</b> 점검하는 용도로 보세요.",
    cond: "펀더멘털 하위 30% · 주가 상위 30% · 괴리 −40p↓" },
};
function gapTipHtml(id, n) {
  const D = GAP_DEF[id], b = GAPD?.backtest?.[D.side] || {};
  const pct = (v) => (v == null ? "-" : (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + "%");
  const fail = [!b.pass_n && `표본 부족(${b.n}건 < 300)`, !b.pass_halves && "전·후반 기간 불안정",
                !b.pass_markets && "한·미 방향 불일치", !b.pass_p && "통계 유의성 부족"].filter(Boolean).join(" · ");
  return `<div class="tt-h">${D.icon} ${D.name}<span class="tt-bad">⚠ 부분 검증</span></div>
    <p class="tt-mean">${D.mean}</p>
    <div class="tt-cond"><b>선정 기준</b> ${D.cond}<br>
      실적 = 최근 분기 vs <b>전년 동분기</b>(매출·영업이익) + TTM FCF 마진 변화 ·
      주가 = 6개월·12개월 <b>절대 + 시장 대비</b> 4종 백분위 평균</div>
    <table class="tt-tb"><tr><td>이후 12개월</td><td class="${b.med >= 0 ? "tt-p" : "tt-n"}">${pct(b.med)}</td>
        <td>승률</td><td>${b.win == null ? "-" : (b.win * 100).toFixed(1) + "%"}</td></tr>
      <tr><td>전반 / 후반</td><td colspan="3">${pct(b.h1)} / ${pct(b.h2)}</td></tr>
      <tr><td>한국 / 미국</td><td colspan="3">${pct(b.kr)} / ${pct(b.us)}</td></tr>
      <tr><td>표본</td><td>${(b.n || 0).toLocaleString()}건</td>
        <td>부호검정</td><td>p=${(b.p ?? 0).toFixed(3)}</td></tr></table>
    <div class="tt-foot"><b>한계: ${fail || "-"}</b> — 방향은 10년 데이터에서 맞았지만
      (연간 재무 2017~2024년 기준) 표본이 적어 <b>확정 근거로 보기엔 약합니다</b>. 현재 ${n}종목.
      <br>수치는 <b>중앙값</b> 기준 — 12개월 수익률은 꼬리가 두꺼워 평균은 소수 급등주에 좌우됩니다.</div>`;
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
    if (!scrTechPass(t)) return false;                                              // 기술적 테마(차트 패턴)
    if (chainKeys && t.m === "kr" && !chainKeys.has(t.m + "_" + t.t)) return false;  // 밸류체인=국내만
    // 산업군(12개 공통) → 세부업종 순으로 좁힌다. 둘 다 한·미 공통 기준이라 시장 구분 없이 적용.
    if (scrState.groups && !scrState.groups.has(t.grp || "etc")) return false;
    if (scrState.sectors && !scrState.sectors.has(t.sector)) return false;
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
  scrChips(rows.length, scrPool().length);   // 조건 칩바 + 카드 요약 + 결과 수(v209)
  const themeNote = useTheme ? ` · <b>${SCR_THEMES.find((x) => x.id === scrThemeActive).name}</b>` : "";
  $("#scr-summary").innerHTML = `<b>${rows.length}</b>개 종목 <span class="sub-note">/ 유니버스 ${scrPool().length}${active.length ? ` · 지표 ${active.length}종` : ""}${themeNote}</span>`;
  const tb = $("#scr-table");
  if (!rows.length) {
    tb.innerHTML = `<tbody><tr><td style="padding:26px;text-align:center;color:var(--muted)">조건에 맞는 종목이 없습니다.</td></tr></tbody>`;
    return;
  }
  // 항상 표시하는 고정 재무 열(사용자 요청) + 테마·적용 지표(중복 제외)
  const FIXED_COLS = ["per", "pbr", "rev_yoy", "opm", "debt", "payout"];
  const themeCols = useTheme ? SCR_THEMES.find((x) => x.id === scrThemeActive).conds.map((c) => c.m) : [];
  const dynCols = [...new Set([...themeCols, ...active])].filter((id) => !FIXED_COLS.includes(id)).slice(0, 3);
  const cols = [...FIXED_COLS, ...dynCols];
  const colHead = cols.map((id) => `<th class="scr-r">${scrColLabel(id)}</th>`).join("");
  const head = `<thead><tr><th class="scr-star">★</th><th>종목</th><th>국가</th><th>산업</th><th class="scr-r">시가총액</th><th class="scr-r">등락</th>${colHead}</tr></thead>`;
  const body = rows.map((t) => {
    const col = t.chg >= 0 ? "#f5445a" : "#4391ff";
    const vals = scrVals.get(t.m + "_" + t.t) || {};
    const extra = cols.map((id) => `<td class="scr-r">${scrFmtMetric(id, vals[id])}</td>`).join("");
    return `<tr class="scr-row" data-key="${t.m}_${t.t}" title="클릭 = 종목 조회">
      <td class="scr-star">${starBtn(`${t.m}_${t.t}`, t.name)}</td>
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
/* 전광판은 이제 자체 데이터(renderMacroTicker)가 담당한다 — TradingView 위젯 제거.
   ⚠제거 이유: 무료 위젯이 선물 심볼(CL1!·GC1!) 권한이 없어 "!"만 표시되는데, iframe이 **교차 출처**라
   내부 오류를 스크립트로 감지할 수 없다(기존 감시 로직은 iframe 높이만 보고 성공으로 오판했다).
   남은 TV 마크업이 있으면 숨기기만 한다(구 캐시 대응). */
function watchTvTicker() {
  const tv = $("#tv-ticker");
  if (tv) tv.style.display = "none";
  const mt = $("#macro-ticker");
  if (mt) mt.style.display = "";
}

// 자체 매크로 데이터로 지수 티커 스트립 렌더 — TradingView 로딩 실패 시의 전체 대체용(정상 로딩 시 watchTvTicker가 숨김)
function renderMacroTicker(pickOverride) {
  const host = $("#macro-ticker");
  if (!host || !MARKET?.macro) return;
  // 전광판이 자체 데이터로 바뀌면서 상시 노출 → 항목을 늘려 한눈에 더 많이 보이게 한다
  const pick = pickOverride || ["^KS11", "^KQ11", "^GSPC", "^IXIC", "^SOX", "KRW=X",
                                "^VIX", "DX-Y.NYB", "CL=F", "GC=F", "^TNX"];
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
      renderIdxCards(); drawTreemap(); renderMovers(); renderRankings(); renderHomeNews(); renderHomeSchedule();
      setTimeout(syncHomeHeights, 60);
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
  renderHomeSchedule();
  renderInvestor();
  $("#home-sch-more").onclick = (e) => { e.preventDefault(); activateTab("calendar"); };
  $("#home-econ-more").onclick = (e) => { e.preventDefault(); activateTab("econcal"); };
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
  fetch(`data/stocks/${key}.json` + _cb).then((r) => (r.ok ? r.json() : null)).then(normStock).then((st) => {
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
  // movers(30분 클라우드) 또는 토스 랭킹 중 하나라도 있으면 실시간 랭킹 섹션이 대체
  return !!(MARKET?.movers?.[homeMk] || TOSSM?.rankings);
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

// 투자자 매매동향 그래프 (investor.json — KR 개인/외국인/기관 순매수, 일간/주간/월간)
let invMkt = "kospi", invPeriod = "day";
function invAggregate(daily, period) {
  if (period === "day") return daily.slice(-7);   // 일간 = 최근 7거래일
  const bucket = {};
  daily.forEach((r) => {
    const dt = new Date(r.d + "T00:00:00");
    let key;
    if (period === "week") { const dow = (dt.getDay() + 6) % 7; const mon = new Date(dt); mon.setDate(dt.getDate() - dow); key = localDay(mon); }
    else key = r.d.slice(0, 7);  // 월간
    const b = bucket[key] || (bucket[key] = { d: key, indi: 0, foreign: 0, inst: 0 });
    b.indi += r.indi || 0; b.foreign += r.foreign || 0; b.inst += r.inst || 0;
  });
  const arr = Object.values(bucket).sort((a, b) => a.d.localeCompare(b.d));
  return arr.slice(period === "week" ? -16 : -12);
}
function renderInvestor() {
  const wrap = $("#inv-wrap");
  if (!wrap) return;
  const daily = INVESTOR?.trend?.[invMkt];
  if (!daily?.length) { wrap.style.display = "none"; return; }
  wrap.style.display = "";
  wrap.querySelectorAll("#inv-mkt button").forEach((b) => { b.classList.toggle("active", b.dataset.m === invMkt); b.onclick = () => { invMkt = b.dataset.m; renderInvestor(); }; });
  wrap.querySelectorAll("#inv-period button").forEach((b) => { b.classList.toggle("active", b.dataset.p === invPeriod); b.onclick = () => { invPeriod = b.dataset.p; renderInvestor(); }; });

  const rows = invAggregate(daily, invPeriod);
  const W = 720, H = 340, padL = 8, padR = 8, padT = 30, padB = 34;
  const n = rows.length, gw = (W - padL - padR) / n, plotH = H - padT - padB;
  const keys = [["indi", "개인", "#9aa4b2"], ["foreign", "외국인", "#4391ff"], ["inst", "기관", "#f0b34c"]];
  const fmtEok = (v) => v == null ? "" : Math.abs(v) >= 10000 ? (v / 10000).toFixed(1) + "조"
    : Math.round(v).toLocaleString();  // 억원 단위(1조 이상만 '조' 표기)
  const vals = rows.flatMap((r) => keys.map(([k]) => r[k])).filter((v) => v != null);
  const maxV = Math.max(...vals, 0), minV = Math.min(...vals, 0);
  const yS = (v) => padT + (maxV - v) / (maxV - minV || 1) * plotH;
  const y0 = yS(0);
  const bw = Math.min(16, gw / 3.6);
  let bars = "", labels = "";
  rows.forEach((r, i) => {
    const cx = padL + gw * i + gw / 2;
    keys.forEach(([k, , c], j) => {
      const v = r[k]; if (v == null) return;
      const x = cx + (j - 1) * (bw + 1.5) - bw / 2;
      const yv = yS(v), up = v >= 0;
      bars += `<rect x="${x}" y="${Math.min(yv, y0)}" width="${bw}" height="${Math.max(1, Math.abs(yv - y0))}" fill="${c}" rx="1.5"/>`
        // 금액 라벨(막대 끝) — 순매수=위, 순매도=아래
        + `<text x="${x + bw / 2}" y="${up ? yv - 5 : yv + 13}" font-size="11" font-weight="600" text-anchor="middle" fill="${c}">${fmtEok(v)}</text>`;
    });
    const lab = invPeriod === "month" ? r.d.slice(2) : r.d.slice(5);
    labels += `<text x="${cx}" y="${H - 8}" font-size="12.5" text-anchor="middle" fill="#8b8b93">${lab}</text>`;
  });
  const zero = `<line x1="${padL}" y1="${y0}" x2="${W - padR}" y2="${y0}" stroke="#3a3a44"/>`;
  const legend = keys.map(([, lab, c]) => `<span style="color:${c}">■</span> ${lab}`).join("  ");
  $("#inv-chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="fin-svg">${zero}${bars}${labels}</svg>
    <p class="legend">${legend} <span class="sub-note">· 순매수(+)/순매도(−) · 단위 억원 · 네이버</span></p>`;
}

// 금주(월~일) 실적발표·경제지표 — 홈 하단 우측. calendar.json(CAL) 재사용.
function _weekRange() {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7;  // 월=0
  const mon = new Date(now); mon.setDate(now.getDate() - dow); mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23, 59, 59, 0);
  return [mon, sun];
}
/* 실적발표 시장 필터. 기본이 "kr"이라 미국 종목(META 등)이 안 보여 "왜 없냐"는 혼선이 있었다
   → 기본을 'all'(한·미 통합)로 두고 선택을 브라우저에 기억한다. */
let schEarnMk = localStorage.getItem("cp_sch_mk") || "all";
function renderHomeSchedule() {
  const eHost = $("#home-earnings"), cHost = $("#home-econ");
  if (!eHost || !cHost) return;
  const esc = (s) => String(s ?? "").replace(/</g, "&lt;");
  const [mon, sun] = _weekRange();
  const inWeek = (ds) => { const d = new Date(ds + "T00:00:00"); return d >= mon && d <= sun; };
  const today = localDay(new Date());
  const md = (ds) => ds.slice(5).replace("-", "/");
  const yo = (ds) => "일월화수목금토"[new Date(ds + "T00:00:00").getDay()];

  // 실적발표 — 상단 한국/미국 토글로 구분
  const mks = schEarnMk === "all" ? ["kr", "us"] : [schEarnMk];
  const er = mks.flatMap((m) => (CAL?.earnings?.[m] || []).map((e) => ({ ...e, mk: m })))
    .filter((e) => inWeek(e.date))
    .sort((a, b) => a.date.localeCompare(b.date) || a.mk.localeCompare(b.mk) ||
      (a.time || "").localeCompare(b.time || ""));
  eHost.innerHTML = er.length ? er.slice(0, 60).map((e) => `
    <div class="sch-row${e.t ? " clickable" : ""}${e.date === today ? " today" : ""}" ${e.t ? `data-t="${e.mk}_${e.t}"` : ""}>
      <span class="sch-date">${md(e.date)}<span class="sub-note">(${yo(e.date)})</span></span>
      ${e.t ? `<img class="sch-logo" src="${logoUrl(e.mk, e.t)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="sch-logo"></span>`}
      <span class="sch-name">${schEarnMk === "all" ? (e.mk === "kr" ? "🇰🇷 " : "🇺🇸 ") : ""}<b>${esc(e.name)}</b></span>
      <span class="sch-info sub-note">${e.mk === "kr" ? esc((e.event || "").slice(0, 16)) : (e.eps_est != null ? "EPS $" + e.eps_est : "")}</span>
    </div>`).join("") : `<p class="mini-note">이번 주 예정된 ${schEarnMk === "all" ? "" : schEarnMk === "kr" ? "국내 " : "미국 "}실적발표가 없습니다.</p>`;
  eHost.querySelectorAll(".sch-row.clickable").forEach((el) => el.onclick = () => {
    gotoTabFull("lookup"); if (!lookupRendered) initLookup(); loadLookup(el.dataset.t);
  });
  $("#sch-earn-mk").querySelectorAll("button").forEach((b) => {
    b.classList.toggle("active", b.dataset.m === schEarnMk);
    b.onclick = () => { schEarnMk = b.dataset.m; localStorage.setItem("cp_sch_mk", schEarnMk); renderHomeSchedule(); };
  });

  // 경제지표 — 이번 주 중요도 중·상(글로벌 매크로라 시장 토글과 무관, 모든 국가)
  const ec = (CAL?.econ || []).filter((e) => inWeek(e.d))
    .sort((a, b) => a.d.localeCompare(b.d) || (b.imp - a.imp) || a.tm.localeCompare(b.tm));
  const flag = { US: "🇺🇸", KR: "🇰🇷", CN: "🇨🇳", JP: "🇯🇵", EU: "🇪🇺" };
  cHost.innerHTML = ec.length ? ec.slice(0, 40).map((e) => `
    <div class="sch-row${e.d === today ? " today" : ""}">
      <span class="sch-date">${md(e.d)}<span class="sub-note">(${yo(e.d)})</span></span>
      <span class="sch-flag">${flag[e.c] || e.c}</span>
      <span class="sch-name">${e.imp >= 1 ? "⭐ " : ""}${esc(ecKo ? ecKo(e.t) : e.t)}</span>
      <span class="sch-info sub-note">${e.a != null ? e.a + (e.u || "") : (e.f != null ? "예상 " + e.f + (e.u || "") : "")}</span>
    </div>`).join("") : `<p class="mini-note">이번 주 예정된 주요 지표가 없습니다.</p>`;
}

// 주요 뉴스 미리보기 (뉴스 탭 데이터 재사용, 상위 5건)
// 실시간 랭킹 (toss_market.json) — 홈 시장 토글(homeMk)에 연동. TOSSM 없으면 섹션 숨김.
const RANK_CATS = [["amount", "거래대금"], ["volume", "거래량"], ["gainers", "급등"],
                   ["losers", "급락"], ["frgn_buy", "외국인 순매수"], ["frgn_sell", "외국인 순매도"],
                   ["toss", "🟦 토스 고객"]];
let rankCat = "amount";

// movers(market.json, 30분 클라우드 갱신) 카테고리 → 랭킹 카테고리 매핑
const RANK_MV = { amount: "value", volume: "volume", gainers: "gainers", losers: "losers" };

function rankRows(cat) {
  if (cat === "toss") {
    const g = TOSSM?.rankings?.[`${homeMk}_toss`];
    return g?.rows ? { src: "toss", rows: g.rows } : null;
  }
  if (cat === "frgn_buy" || cat === "frgn_sell") {
    if (homeMk !== "kr") return null;  // 외국인 순매수 랭킹은 국내만(자체 수급 집계)
    const arr = INVESTOR?.rank?.[cat === "frgn_buy" ? "foreign_buy" : "foreign_sell"];
    return arr?.length ? { src: "investor", rows: arr.map((r, i) => ({
      t: r.code, name: r.name, last: r.last, chg: null, rank: i + 1,
      netbuy: r.net, dir: cat === "frgn_buy" ? "buy" : "sell" })) } : null;
  }
  const mv = MARKET?.movers?.[homeMk]?.[RANK_MV[cat]];
  if (!mv?.length) return null;
  // movers 필드(t,name,last,chg,value,vol) → 랭킹 행 표준화(amount/volume/rank)
  return { src: "movers", rows: mv.map((r, i) => ({
    t: r.t, name: r.name, last: r.last, chg: r.chg, rank: i + 1,
    amount: r.value, volume: r.vol, halted: r.halted })) };
}

function renderRankings() {
  const wrap = $("#rank-wrap");
  if (!wrap) return;
  // 거래대금·거래량·급등·급락 = movers(30분 클라우드) / 토스 고객 = toss(체결, IP제한 배치)
  const cats = RANK_CATS.filter(([k]) => rankRows(k)?.rows?.length);
  if (!cats.length) { wrap.style.display = "none"; return; }
  wrap.style.display = "";
  if (!cats.some(([k]) => k === rankCat)) rankCat = cats[0][0];

  const g = rankRows(rankCat);
  if (g.src === "movers") {
    $("#rank-note").innerHTML = `(거래소 30분 갱신 · ${relTime(MARKET.generated)})`;
  } else if (g.src === "investor") {
    $("#rank-note").innerHTML = `(외국인 20일 누적 ${rankCat === "frgn_buy" ? "순매수" : "순매도"} 상위 · 억원 · ${INVESTOR.generated ? relTime(INVESTOR.generated) : ""})`;
  } else {
    const ageH = TOSSM.generated
      ? (Date.now() - new Date(TOSSM.generated.replace(" ", "T") + "+09:00").getTime()) / 3.6e6 : null;
    const stale = ageH != null && ageH >= 12;
    $("#rank-note").innerHTML = `(토스증권 체결 기준 · ${relTime(TOSSM.generated)} 수집)`
      + (stale ? ` <span class="rank-stale">⚠ ${Math.floor(ageH)}시간 전 스냅샷 (IP제한 배치라 노트북 가동 시만 갱신)</span>` : "");
  }

  $("#rank-chips").innerHTML = cats.map(([k, lab]) =>
    `<button class="chip${k === rankCat ? " active" : ""}" data-cat="${k}">${lab}</button>`).join("");
  $("#rank-chips").querySelectorAll(".chip").forEach((b) => {
    b.onclick = () => { rankCat = b.dataset.cat; renderRankings(); };
  });

  $("#rank-list").innerHTML = g.rows.map((r) => {
    const up = (r.chg ?? 0) >= 0;
    const sub = r.dir
      // netbuy 단위=억원(자체 수급 집계). 1조 이상만 '조' 표기 — fmtMcap(원 단위)에 넣으면 자릿수가 어긋남
      ? `외국인 ${r.dir === "buy" ? "순매수" : "순매도"}${r.netbuy != null
          ? " " + (Math.abs(r.netbuy) >= 10000 ? (Math.abs(r.netbuy) / 10000).toFixed(1) + "조원"
                                               : Math.round(Math.abs(r.netbuy)).toLocaleString() + "억원") : ""}`
      : rankCat === "volume"
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
  // 홈의 각 2단 그리드(상=히트맵|뉴스딜, 하=랭킹|일정)에서 우측을 좌측 높이에 맞춤
  document.querySelectorAll("#tab-heatmap .home-grid2").forEach((grid) => {
    const left = grid.firstElementChild, right = grid.querySelector(".home-right");
    if (!left || !right) return;
    if (window.innerWidth <= 1100) { right.style.height = ""; return; }
    const h = left.offsetHeight;
    if (h > 100) right.style.height = h + "px";   // 패널 숨김(offsetHeight≈0) 땐 건드리지 않음
  });
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
    `${MARKET.generated} 기준 · ${relTime(MARKET.generated)} 갱신(30분 주기) · 카드 클릭 = 5년 차트 ·
     홈 전광판은 실시간이라 최대 30분 시차`;
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
  loadSentiment();     // 시장 심리(공포·탐욕·풋콜) — lazy 1회
}

/* ---------- 😨 시장 심리 — 미국 CNN 공포·탐욕 + 풋콜(5일평균) / 한국 자체 합성 ---------- */
let SENT = null, sentMk = "us";
function loadSentiment() {
  if (SENT !== null) { renderSentiment(); return; }
  fetch("data/sentiment.json" + _cb).then((r) => (r.ok ? r.json() : null)).then((d) => {
    SENT = d || false;
    renderSentiment();
  }).catch(() => { SENT = false; });
}
const SENT_KO = { "extreme fear": "극단적 공포", fear: "공포", neutral: "중립",
                  greed: "탐욕", "extreme greed": "극단적 탐욕" };
const sentColor = (v) => v < 25 ? "#4391ff" : v < 45 ? "#6ba7ff" : v < 55 ? "#9aa4b2"
  : v < 75 ? "#f0b34c" : "#f5445a";

function sentLine(series, W, H, color, fmt) {
  if (!series?.length) return "";
  const P = { l: 40, r: 14, t: 10, b: 18 };
  const v = series.map((p) => p.v);
  const lo = Math.min(...v), hi = Math.max(...v), pad = (hi - lo) * 0.1 || 1;
  const X = (i) => P.l + (W - P.l - P.r) * (i / Math.max(1, series.length - 1));
  const Y = (x) => P.t + (H - P.t - P.b) * (1 - (x - (lo - pad)) / ((hi + pad) - (lo - pad)));
  const grid = [0, .5, 1].map((r) => {
    const val = (lo - pad) + ((hi + pad) - (lo - pad)) * r;
    return `<line x1="${P.l}" y1="${Y(val)}" x2="${W - P.r}" y2="${Y(val)}" stroke="var(--line)"/>
      <text x="${P.l - 4}" y="${Y(val) + 3}" text-anchor="end" class="cr-ax">${fmt(val)}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="fin-svg">${grid}
    <polyline points="${series.map((p, i) => `${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ")}"
      fill="none" stroke="${color}" stroke-width="2"/>
    <text x="${P.l}" y="${H - 4}" class="cr-ax">${series[0].t}</text>
    <text x="${W - P.r}" y="${H - 4}" text-anchor="end" class="cr-ax">${series[series.length - 1].t}</text>
  </svg>`;
}

function renderSentiment() {
  const host = $("#sent-wrap");
  if (!host || !SENT) return;
  const d = SENT[sentMk];
  if (!d) { host.style.display = "none"; return; }
  host.style.display = "";
  const score = d.score ?? 0;
  const parts = (d.parts || []).map((p) => `<div class="sent-part">
      <div class="sp-h"><b>${p.label}</b><span class="sp-score" style="color:${sentColor(p.score ?? 50)}">${
        p.score == null ? "-" : Math.round(p.score)}</span></div>
      <div class="sub-note">${p.note}</div></div>`).join("");
  const pc = SENT.us?.putcall;
  const pcBlock = sentMk === "us" && pc?.last ? `<div class="card-flat" style="margin-top:12px">
      <h3 class="lk-h3">⚖️ 풋콜 비율 <span class="sub-note">(CBOE · <b>5일 이동평균</b> — 하루치는 튀어서)</span></h3>
      <div class="sent-now"><b>${pc.last}</b>
        <span class="sub-note">당일 ${pc.last_raw} · 1보다 크면 풋(하락 베팅)이 많다는 뜻 = 공포</span></div>
      ${sentLine(pc.series, 940, 170, "#f0b34c", (v) => v.toFixed(2))}
      <p class="mini-note">풋옵션 거래량 ÷ 콜옵션 거래량. <b>높을수록 공포</b>(하락 대비 수요),
        낮을수록 낙관. 과도하게 높으면 오히려 바닥 신호로 보기도 합니다.</p></div>` : "";
  host.innerHTML = `<div class="card-flat">
      <h3 class="lk-h3">😨 시장 심리 — 공포·탐욕 지수
        <span class="sub-note">${sentMk === "us" ? "CNN Fear &amp; Greed (미국 증시)"
          : "자체 합성 (한국 — 공식 지수 없음)"}</span>
        <span style="flex:1"></span>
        <span class="mk-toggle" id="sent-mk">
          <button data-m="us" class="${sentMk === "us" ? "active" : ""}">🇺🇸 미국</button>
          <button data-m="kr" class="${sentMk === "kr" ? "active" : ""}">🇰🇷 한국</button>
        </span></h3>
      <div class="sent-now"><b style="color:${sentColor(score)}">${Math.round(score)}</b>
        <span class="sent-rate" style="color:${sentColor(score)}">${SENT_KO[d.rating] || d.rating || ""}</span>
        <span class="sent-gauge"><span style="left:${Math.min(100, Math.max(0, score))}%"></span></span>
        <span class="sub-note">0 = 극단적 공포 · 100 = 극단적 탐욕</span></div>
      ${sentLine(d.hist, 940, 200, sentColor(score), (v) => v.toFixed(0))}
      <div class="sent-parts">${parts}</div>
      <p class="mini-note">${sentMk === "us"
        ? "CNN이 7개 지표(모멘텀·신고가·거래량폭·풋콜·VIX·정크본드·안전자산)를 합성한 <b>미국 증시</b> 지수입니다. 크립토 탭의 공포·탐욕과는 <b>다른 지표</b>(그쪽은 암호화폐 전용)."
        : "⚠한국은 <b>공식 공포·탐욕 지수가 없습니다</b>(KOSPI200 옵션 풋콜은 KRX 로그인벽으로 수집 불가). 그래서 우리가 이미 계산하는 시장폭·변동성 지표 7종을 CNN과 같은 방식(각 지표의 1년 백분위 평균)으로 합성했습니다 — <b>CNN 지수와 구성이 다르므로 직접 비교는 하지 마세요.</b>"}</p>
    </div>${pcBlock}`;
  host.querySelectorAll("#sent-mk button").forEach((b) => b.onclick = () => {
    sentMk = b.dataset.m; renderSentiment();
  });
}

// 국채 금리 커브 — 한국(토스)/미국(야후) 토글 + 주요국 비교. 데이터 없으면 섹션 숨김.
let curveMk = "kr";
function renderBondCurve() {
  const wrap = $("#bond-curve-wrap");
  if (!wrap) return;
  const hasKr = !!TOSSM?.bonds?.curve?.length;
  if (!hasKr) curveMk = "us";
  wrap.style.display = "";
  $("#curve-mk").querySelectorAll("button").forEach((b) => {
    b.classList.toggle("active", b.dataset.m === curveMk);
    b.onclick = () => { curveMk = b.dataset.m; drawCurve(); };
  });
  drawCurve();
  renderGlobalRates();   // 주요국 비교(sector_metrics lazy)
}

// 만기별 수익률 막대 + 스프레드 — 선택 시장(kr/us) 기준
function drawCurve() {
  const isKr = curveMk === "kr";
  const done = (curve, spreads, inverted, note, src) => {
    if (!curve?.length) {
      $("#bond-curve").innerHTML = `<p class="mini-note">데이터 없음</p>`;
      $("#bond-spreads").innerHTML = ""; $("#bond-curve-note").textContent = "";
      return;
    }
    $("#bond-curve-note").textContent = note;
    $("#bond-curve-src").innerHTML = src;
    $("#bond-spreads").innerHTML = Object.entries(spreads).map(([k, v]) =>
      `<span class="bond-sp ${v < 0 ? "neg" : ""}">${k} <b>${v >= 0 ? "+" : ""}${v.toFixed(3)}%p</b>${v < 0 ? " 역전" : ""}</span>`).join("")
      + (inverted ? `<span class="bond-warn">⚠ 장단기 금리 역전 — 경기침체 신호</span>`
                  : `<span class="sub-note">정상 우상향 커브</span>`);
    const ys = curve.map((c) => c.yield);
    const lo = Math.min(...ys), hi = Math.max(...ys), span = Math.max(0.001, hi - lo);
    $("#bond-curve").innerHTML = curve.map((c) => {
      const h = 24 + ((c.yield - lo) / span) * 76;
      return `<div class="bond-bar"><span class="bond-val">${c.yield.toFixed(3)}</span>
        <div class="bond-fill" style="height:${h}%"></div>
        <span class="bond-lbl">${c.label}</span></div>`;
    }).join("");
  };
  if (isKr) {
    const b = TOSSM?.bonds || {};
    done(b.curve, b.spreads || {}, b.inverted,
      `(${TOSSM?.generated} 기준 · 만기별 수익률)`,
      `출처: 토스증권 Open API · 장단기 스프레드가 <b>마이너스(역전)</b>면 경기침체 신호로 해석됩니다`);
  } else {
    loadSecMet().then((d) => {
      if (curveMk !== "us") return;
      const us = d?.us_curve || [];
      const y = (n) => us.find((c) => c.years === n)?.yield;
      const sp = {};
      if (y(10) != null && y(0.25) != null) sp["10Y−3M"] = +(y(10) - y(0.25)).toFixed(3);
      if (y(30) != null && y(10) != null) sp["30Y−10Y"] = +(y(30) - y(10)).toFixed(3);
      done(us, sp, Object.values(sp).some((v) => v < 0),
        `(${d?.generated} 기준 · 실시간 시장금리)`,
        `출처: 야후 파이낸스(실시간) · 아래 <b>주요국 비교</b>는 ECOS <b>월평균</b>이라 값이 다를 수 있습니다`);
    });
  }
}

// 🌏 주요국 장·단기 금리 비교(ECOS 월평균 — 기준 월 명시)
function renderGlobalRates() {
  loadSecMet().then((d) => {
    const gl = d?.global_rates || [];
    // 기준 월: 시계열 마지막 라벨(예: 2026-06) — 실시간 커브와 값이 다른 이유를 명확히
    const asof = gl.find((r) => r.long_series?.length)?.long_series?.slice(-1)[0]?.[0];
    const noteEl = $("#global-rates-note");
    if (noteEl) noteEl.textContent = `(${asof ? asof + " 월평균" : "월간"} · 한국은행 ECOS · 장기−단기)`;
    if (gl.length) {
      const maxR = Math.max(...gl.flatMap((r) => [r.long || 0, r.short || 0]), 1);
      $("#global-rates").innerHTML = gl.map((r) => {
        const bar = (v, c) => v == null ? "" :
          `<div class="gr-bar"><span style="width:${(v / maxR * 100).toFixed(1)}%;background:${c}"></span></div><b>${v.toFixed(2)}%</b>`;
        const sp = r.spread;
        return `<div class="gr-row"><span class="gr-name">${r.country}</span>
          <div class="gr-bars">
            <div class="gr-line"><span class="sub-note">장기</span>${bar(r.long, "#4391ff")}</div>
            <div class="gr-line"><span class="sub-note">단기</span>${bar(r.short, "#9aa4b2")}</div>
          </div>
          <span class="gr-sp ${sp != null && sp < 0 ? "neg" : ""}">${sp != null ? (sp >= 0 ? "+" : "") + sp.toFixed(2) + "%p" : "-"}</span></div>`;
      }).join("") + `<p class="sub-note" style="margin-top:6px">장기=10년물 성격 · 단기=3개월 은행간 · 우측=장단기 스프레드(마이너스=역전)</p>`;
    }
  });
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

/* ---------- ₿ 크립토 마켓 overview (crypto.json) ---------- */
let cryptoRendered = false, CRYPTO = null, crRange = 1825, crPRange = 1825, crOff = new Set();
const CR_COLORS = ["#f7931a", "#8a7dff", "#f0b90b", "#4391ff", "#14f195", "#e6007a",
                   "#c2a633", "#26a17b", "#2775ca", "#ff6b7d", "#00d4aa", "#a0a0aa"];
const crC = (i) => CR_COLORS[i % CR_COLORS.length];

function crFmtUsd(v) {
  if (v == null) return "-";
  const a = Math.abs(v);
  if (a >= 1e12) return "$" + (v / 1e12).toFixed(2) + "T";
  if (a >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (a >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  if (a >= 1) return "$" + v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return "$" + v.toFixed(v < 0.01 ? 6 : 4);
}
const crPct = (v) => (v == null ? "-" : `<b class="${v >= 0 ? "kup" : "kdn"}">${v >= 0 ? "+" : ""}${v.toFixed(2)}%</b>`);

function renderCrypto() {
  cryptoRendered = true;
  fetch("data/crypto.json" + _cb).then((r) => (r.ok ? r.json() : null)).then((d) => {
    CRYPTO = d;
    const ctx = $("#cr-context");
    if (!d) { ctx.textContent = "crypto.json 없음 — python analysis\\crypto.py 실행 필요"; return; }
    ctx.innerHTML = `<b>₿ 크립토</b> — 코인 시장 전체 규모와 주요 코인의 상대 성과를 <b>5년</b> 기준으로 봅니다. ` +
      `시세·시가총액은 <b>CoinGecko</b>, 일봉은 <b>yfinance</b>(24시간 거래라 주말도 포함), ` +
      `공포·탐욕은 <b>alternative.me</b>, 김치 프리미엄은 <b>업비트</b> 원화가와 글로벌 달러가×환율의 차이입니다. ` +
      `<span class="sub-note">${d.generated} 갱신 · 주식과 달리 24시간 거래되므로 갱신 시점과 현재 시세가 다를 수 있습니다.</span>`;
    crCards(d); crMcap(); crFng(d); crLines(); crTable(d); crCorr();
    $("#cr-corr-win")?.querySelectorAll("button").forEach((b) => b.onclick = () => {
      crCorrWin = b.dataset.w;
      $("#cr-corr-win").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      crCorr();
    });
    $("#cr-corr-lag")?.querySelectorAll("button").forEach((b) => b.onclick = () => {
      crCorrLag = b.dataset.l;
      $("#cr-corr-lag").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      crCorr();
    });
    $("#cr-range").querySelectorAll("button").forEach((b) => b.onclick = () => {
      crRange = +b.dataset.d;
      $("#cr-range").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      crMcap();
    });
    $("#cr-prange").querySelectorAll("button").forEach((b) => b.onclick = () => {
      crPRange = +b.dataset.d;
      $("#cr-prange").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      crLines();
    });
  });
}

function crCards(d) {
  const g = d.global || {}, f = d.fng || {}, k = d.kimchi || {};
  const fngColor = f.now == null ? "" : f.now < 25 ? "kdn" : f.now < 45 ? "" : f.now < 55 ? "" : f.now < 75 ? "kup" : "kup";
  const fngKo = { "Extreme Fear": "극단적 공포", "Fear": "공포", "Neutral": "중립",
                  "Greed": "탐욕", "Extreme Greed": "극단적 탐욕" }[f.label] || f.label || "";
  const card = (t, v, sub, cls) => `<div class="cr-card"><div class="sub-note">${t}</div>
    <b class="${cls || ""}">${v}</b><span class="sub-note">${sub}</span></div>`;
  $("#cr-cards").innerHTML =
    card("전체 시가총액", crFmtUsd(g.mcap), `24시간 ${g.chg24 == null ? "-" : (g.chg24 >= 0 ? "+" : "") + g.chg24.toFixed(2) + "%"} · 거래대금 ${crFmtUsd(g.vol24)}`,
         g.chg24 >= 0 ? "kup" : "kdn") +
    card("비트코인 점유율", g.btc_dom == null ? "-" : g.btc_dom.toFixed(1) + "%",
         `이더리움 ${g.eth_dom == null ? "-" : g.eth_dom.toFixed(1) + "%"} · 활성 코인 ${(g.coins || 0).toLocaleString()}종`) +
    card("공포·탐욕 지수", f.now ?? "-", fngKo, fngColor) +
    card("김치 프리미엄", k.premium == null ? "-" : (k.premium >= 0 ? "+" : "") + k.premium.toFixed(2) + "%",
         k.krw ? `업비트 ${(k.krw / 1e4).toFixed(0)}만원 · 환율 ${k.fx}` : "업비트 원화가 vs 글로벌",
         k.premium >= 0 ? "kup" : "kdn");
}

// 공용 미니 SVG — 면적/라인 1개
function crArea(host, ts, vs, color, fmt, h = 190) {
  const el = $(host); if (!el) return;
  const W = Math.max(320, el.clientWidth || 560), P = { l: 54, r: 10, t: 12, b: 20 };
  const n = vs.length;
  if (n < 2) { el.innerHTML = `<p class="sub-note">데이터 부족</p>`; return; }
  const mn = Math.min(...vs), mx = Math.max(...vs), pad = (mx - mn) * 0.12 || 1;
  const lo = mn - pad, hi = mx + pad;
  const X = (i) => P.l + (W - P.l - P.r) * (i / (n - 1));
  const Y = (v) => P.t + (h - P.t - P.b) * (1 - (v - lo) / (hi - lo));
  const pts = vs.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const grid = [0, 0.5, 1].map((r) => {
    const v = lo + (hi - lo) * r, y = Y(v);
    return `<line x1="${P.l}" y1="${y}" x2="${W - P.r}" y2="${y}" stroke="var(--line)"/>
      <text x="${P.l - 6}" y="${y + 3}" text-anchor="end" class="cr-ax">${fmt(v)}</text>`;
  }).join("");
  const lbl = [0, Math.floor(n / 2), n - 1].map((i) =>
    `<text x="${X(i)}" y="${h - 5}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}" class="cr-ax">${ts[i].slice(2)}</text>`).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${h}" width="100%" height="${h}">
    <defs><linearGradient id="crg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity=".34"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    ${grid}<polygon points="${P.l},${h - P.b} ${pts} ${W - P.r},${h - P.b}" fill="url(#crg)"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"/>${lbl}</svg>`;
}

/* 총 시총 — 1년 이하는 CoinGecko **실측**, 그 이상은 '가격×현재 유통량' 환산(무료로는 5년 실측이 없음).
   두 계열은 기준이 달라(스테이블 포함/제외) 값이 다르므로 어느 쪽인지 항상 표기한다. */
function crMcap() {
  const act = CRYPTO?.mcap_hist, ap = CRYPTO?.mcap_5y;
  const useApprox = crRange > 365 && ap?.t?.length;
  const m = useApprox ? ap : act;
  if (!m?.t?.length) return;
  const k = Math.min(crRange, m.t.length);
  crArea("#cr-mcap", m.t.slice(-k), m.v.slice(-k), "#f7931a", (v) => "$" + (v / 1e12).toFixed(2) + "T");
  const note = $("#cr-mcap-note");
  if (note) {
    note.innerHTML = useApprox
      ? `주요 코인 ${ap.n}종 · <b>스테이블코인 제외</b> · 가격 × <b>현재</b> 유통량으로 환산` +
        (ap.err_med != null ? ` <span class="sub-note">(실측 대비 ${ap.err_med >= 0 ? "+" : ""}${ap.err_med}%)</span>` : "")
      : `상위 ${act.n || 12}개 코인 합산(≈전체의 90%) · 스테이블코인 포함 · <b>실측</b>`;
  }
}

function crFng(d) {
  const f = d.fng; if (!f?.t?.length) return;
  crArea("#cr-fng", f.t, f.v, "#8a7dff", (v) => v.toFixed(0), 190);
}

// 주요 코인 상대 수익률(시작=100) 멀티라인
function crLines() {
  const s = CRYPTO?.series, coins = CRYPTO?.coins || [];
  const el = $("#cr-lines"); if (!s || !el) return;
  const k = Math.min(crPRange, s.t.length), ts = s.t.slice(-k);
  const W = Math.max(360, el.clientWidth || 900), h = 320, P = { l: 46, r: 92, t: 12, b: 22 };
  const use = coins.filter((c) => s.c[c.sym] && !crOff.has(c.sym));
  const norm = {};
  use.forEach((c) => {
    const raw = s.c[c.sym].slice(-k);
    const base = raw.find((v) => v != null);
    if (base) norm[c.sym] = raw.map((v) => (v == null ? null : (v / base) * 100));
  });
  const all = Object.values(norm).flat().filter((v) => v != null);
  if (!all.length) { el.innerHTML = `<p class="sub-note">표시할 코인을 선택하세요</p>`; return; }
  const mn = Math.min(...all), mx = Math.max(...all), pad = (mx - mn) * 0.08 || 1;
  const lo = mn - pad, hi = mx + pad;
  const X = (i) => P.l + (W - P.l - P.r) * (i / (ts.length - 1));
  const Y = (v) => P.t + (h - P.t - P.b) * (1 - (v - lo) / (hi - lo));
  const grid = [0, .25, .5, .75, 1].map((r) => {
    const v = lo + (hi - lo) * r, y = Y(v);
    return `<line x1="${P.l}" y1="${y}" x2="${W - P.r}" y2="${y}" stroke="var(--line)"/>
      <text x="${P.l - 6}" y="${y + 3}" text-anchor="end" class="cr-ax">${v.toFixed(0)}</text>`;
  }).join("");
  const base100 = (lo <= 100 && hi >= 100)
    ? `<line x1="${P.l}" y1="${Y(100)}" x2="${W - P.r}" y2="${Y(100)}" stroke="#8b8b93" stroke-dasharray="4 4"/>` : "";
  // 끝 라벨 겹침 방지 — y 순으로 최소 간격 13px 확보
  const ends = use.map((c) => {
    const a = norm[c.sym]; if (!a) return null;
    for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return { c, v: a[i], y: Y(a[i]) };
    return null;
  }).filter(Boolean).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 13);
  const paths = use.map((c) => {
    const a = norm[c.sym]; if (!a) return "";
    const i0 = coins.findIndex((x) => x.sym === c.sym);
    const pts = a.map((v, i) => (v == null ? null : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`)).filter(Boolean).join(" ");
    return `<polyline points="${pts}" fill="none" stroke="${crC(i0)}" stroke-width="1.8" opacity=".92"/>`;
  }).join("");
  const labels = ends.map((e) => {
    const i0 = coins.findIndex((x) => x.sym === e.c.sym);
    return `<text x="${W - P.r + 6}" y="${e.y + 3}" class="cr-end" fill="${crC(i0)}">${e.c.sym.toUpperCase()} ${e.v.toFixed(0)}</text>`;
  }).join("");
  const lbl = [0, Math.floor(ts.length / 2), ts.length - 1].map((i) =>
    `<text x="${X(i)}" y="${h - 5}" text-anchor="${i === 0 ? "start" : i === ts.length - 1 ? "end" : "middle"}" class="cr-ax">${ts[i].slice(2)}</text>`).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${h}" width="100%" height="${h}">${grid}${base100}${paths}${labels}${lbl}</svg>`;
}

/* 🔗 코인 ↔ 증시 상관 — 코인이 증시를 움직이는지 실측
   ⚠세션 구조를 반드시 함께 설명해야 한다. 코스피는 미국 마감 뒤 열려서 **같은 날 종가끼리는
     상관이 0에 가깝지만 하루 밀면 유의**해진다(실측 BTC-코스피 0일 +0.00 / 1일 +0.15). */
let crCorrWin = "y5", crCorrLag = "0";
function crCorr() {
  const mc = CRYPTO?.market_corr, host = $("#cr-corr"), note = $("#cr-corr-note");
  if (!mc) { if (host) host.innerHTML = ""; return; }
  const IDX = mc.idx, tks = Object.keys(IDX);
  const coins = (CRYPTO.coins || []).map((c) => c.sym).filter((s) => mc.coins[s]);
  const cell = (rec) => {
    if (!rec) return `<td class="num">-</td>`;
    const r = crCorrLag === "0" ? rec[`${crCorrWin}_r0`] : rec[`${crCorrWin}_lag_r`];
    const p = crCorrLag === "0" ? rec[`${crCorrWin}_p0`] : rec[`${crCorrWin}_lag_p`];
    const lag = rec[`${crCorrWin}_lag`];
    if (r == null) return `<td class="num">-</td>`;
    const a = Math.abs(r);
    // 상관 강도를 배경 진하기로 — 0.4↑ 진함, 0.2~0.4 중간, 0.1 미만은 사실상 무관
    const bg = a >= 0.4 ? ".34" : a >= 0.25 ? ".22" : a >= 0.12 ? ".12" : ".04";
    const col = r >= 0 ? "34,192,122" : "245,68,90";
    const sig = p != null && p < 0.05;
    return `<td class="num" style="background:rgba(${col},${bg})"
      title="r=${r.toFixed(3)} · p=${p == null ? "-" : p.toFixed(4)}${
        crCorrLag !== "0" && lag != null ? ` · 시차 ${lag > 0 ? `코인이 ${lag}일 앞섬` : lag < 0 ? `증시가 ${-lag}일 앞섬` : "같은 날"}` : ""}">
      <b style="${sig ? "" : "opacity:.45"}">${r >= 0 ? "+" : ""}${r.toFixed(2)}</b>${
        crCorrLag !== "0" && lag ? `<i class="cr-lag">${lag > 0 ? "+" : ""}${lag}d</i>` : ""}</td>`;
  };
  host.innerHTML = `<thead><tr><th>코인</th>${tks.map((t) => `<th class="num">${IDX[t]}</th>`).join("")}</tr></thead><tbody>` +
    coins.map((s) => `<tr><td><b>${s.toUpperCase()}</b></td>
      ${tks.map((t) => cell(mc.coins[s][t])).join("")}</tr>`).join("") + "</tbody>";
  const btcKs = mc.coins.btc?.["^KS11"] || {};
  note.innerHTML = `<p class="mini-note">
    숫자는 <b>일간 수익률의 상관계수</b>(+1=완전 동행, 0=무관). 진한 칸일수록 관계가 강하고,
    <b>흐린 숫자는 통계적으로 유의하지 않음</b>(p≥0.05).<br>
    ⚠ <b>세션 시차에 주의하세요.</b> 코스피는 미국 증시가 끝난 뒤 열립니다. 그래서 BTC와 코스피는
    <b>같은 날 종가끼리는 ${(btcKs.y5_r0 ?? 0).toFixed(2)}로 사실상 무관</b>이지만,
    <b>코인을 하루 앞세우면 ${(btcKs.y5_lag_r ?? 0).toFixed(2)}</b>(최근 1년 ${(btcKs.y1_lag_r ?? 0).toFixed(2)},
    p=${(btcKs.y1_lag_p ?? 1).toFixed(3)})로 유의해집니다 —
    <b>밤사이 코인이 오르면 다음날 코스피가 강한 경향</b>이 있다는 뜻입니다.
    '최적 시차' 탭에서 코인별로 몇 일 앞서는지 확인하세요.<br>
    ⚠ 상관은 인과가 아닙니다. 코인·주식이 <b>같은 위험선호에 함께 반응</b>하는 것일 가능성이 큽니다.</p>`;
}

function crTable(d) {
  const coins = d.coins || [];
  const host = $("#cr-legend");
  // v216: 코인이 12개라 하나씩 끄는 게 번거롭다 → 전체 선택/해제 버튼 추가(사용자 요청)
  host.innerHTML = `<span class="cr-bulk">
      <button class="today-chart-btn" data-bulk="all">전체 선택</button>
      <button class="today-chart-btn" data-bulk="none">전체 해제</button></span>` +
    coins.map((c, i) =>
    `<button class="cr-chip ${crOff.has(c.sym) ? "off" : ""}" data-s="${c.sym}">
      <i style="background:${crC(i)}"></i>${c.sym.toUpperCase()}</button>`).join("");
  host.querySelectorAll(".cr-chip").forEach((b) => b.onclick = () => {
    const s = b.dataset.s;
    crOff.has(s) ? crOff.delete(s) : crOff.add(s);
    b.classList.toggle("off", crOff.has(s));
    crLines();
  });
  host.querySelectorAll("[data-bulk]").forEach((b) => b.onclick = () => {
    crOff.clear();
    if (b.dataset.bulk === "none") coins.forEach((c) => crOff.add(c.sym));
    host.querySelectorAll(".cr-chip").forEach((x) => x.classList.toggle("off", crOff.has(x.dataset.s)));
    crLines();
  });
  $("#cr-table").innerHTML =
    `<thead><tr><th>#</th><th>코인</th><th class="num">가격</th><th class="num">24시간</th>
      <th class="num">7일</th><th class="num">30일</th><th class="num">1년</th>
      <th class="num">시가총액</th><th class="num">거래대금</th><th class="num">최고가 대비</th></tr></thead><tbody>` +
    coins.map((c, i) => `<tr>
      <td>${c.rank ?? i + 1}</td>
      <td><i class="cr-dot" style="background:${crC(i)}"></i> <b>${c.sym.toUpperCase()}</b>
        <span class="sub-note">${c.name}</span></td>
      <td class="num">${crFmtUsd(c.price)}</td>
      <td class="num">${crPct(c.c24)}</td><td class="num">${crPct(c.c7)}</td>
      <td class="num">${crPct(c.c30)}</td><td class="num">${crPct(c.c1y)}</td>
      <td class="num">${crFmtUsd(c.mcap)}</td><td class="num">${crFmtUsd(c.vol)}</td>
      <td class="num">${crPct(c.hi_off)}</td></tr>`).join("") + "</tbody>";
}

/* ---------- ⭐ 관심종목 (localStorage `cp_watch_v1` — 브라우저에만 저장) ---------- */
const WATCH_KEY = "cp_watch_v1";
let _watch = null;
function watchLoad() {
  if (_watch === null) {
    try { _watch = JSON.parse(localStorage.getItem(WATCH_KEY)) || {}; } catch (e) { _watch = {}; }
  }
  return _watch;
}
function watchSave(w) { _watch = w; localStorage.setItem(WATCH_KEY, JSON.stringify(w)); }
const watchHas = (key) => !!watchLoad()[key];
function watchToggle(key, meta) {
  const w = watchLoad();
  if (w[key]) delete w[key];
  else w[key] = { mk: key.slice(0, 2), t: key.slice(3), name: meta?.name || key.slice(3),
                  added: new Date().toISOString().slice(0, 10), memo: "" };
  watchSave(w);
  syncWatchStars();
  if (watchRendered) renderWatch();
  return !!w[key];
}
// 화면 곳곳의 ⭐ 버튼 상태를 한 번에 맞춘다(같은 종목이 여러 곳에 나올 수 있음)
function syncWatchStars() {
  document.querySelectorAll("[data-watch]").forEach((b) => {
    const on = watchHas(b.dataset.watch);
    b.classList.toggle("on", on);
    b.textContent = on ? "★" : "☆";
    b.title = on ? "관심종목에서 빼기" : "관심종목에 담기";
  });
}
function starBtn(key, name) {
  return `<button class="watch-star ${watchHas(key) ? "on" : ""}" data-watch="${key}"
    data-name="${String(name || "").replace(/"/g, "&quot;")}"
    title="${watchHas(key) ? "관심종목에서 빼기" : "관심종목에 담기"}">${watchHas(key) ? "★" : "☆"}</button>`;
}
// 위임 바인딩 — 동적으로 그려지는 버튼도 한 번의 등록으로 동작
document.addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-watch]");
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  watchToggle(b.dataset.watch, { name: b.dataset.name });
});

/* ---------- 📢 공시 스캐너 — 하루치 시장 전체 공시를 날짜별로 ----------
   데이터: disclosure_scan.py → data/disclosures/{날짜}.json (+ index.json).
   날짜별 파일이라 **선택한 날만 lazy 로드**한다(전체를 한 번에 받으면 수 MB). */
let discRendered = false, discIdx = null, discDate = null, discCat = "", discMk = "", discQ = "";
// v215: 전 시장 수집 — 코스피/코스닥 외에 코넥스(N)·기타(E, 비상장 지주·SPC 등)도 포함
const DISC_MK_KO = { Y: "코스피", K: "코스닥", N: "코넥스", E: "기타" };
// 정렬: time=접수순(DART 기본) · mcap/price/chg=헤더 클릭 정렬(첫 클릭 내림차순 → 다시 클릭 오름차순)
let discSortKey = "time", discSortDir = "desc";
const DISC_SORTABLE = { mcap: "시가총액", price: "주가", chg: "변동" };
const DISC_CACHE = {};
const discLink = (rcp) => `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcp}`;

/* 종목코드 → {시총, 주가, 등락률} — heatmap(시총)과 quotes(30분 시세)를 한 번만 인덱싱.
   공시는 유니버스(1,200) 밖 소형주도 나오므로 없으면 null(표엔 '-'). */
let _DISC_MKT = null;
function discMkt(code) {
  if (!code) return null;
  if (!_DISC_MKT) {
    _DISC_MKT = {};
    (MARKET?.heatmap || []).forEach((t) => {
      // mcap_est=시총 스크랩 실패로 '거래대금'이 들어간 대용값 → 시총으로 보여주면 안 되므로 제외
      if (t.m === "kr") _DISC_MKT[t.t] = { mcap: t.mcap_est ? null : t.mcap };
    });
    Object.entries(MARKET?.quotes || {}).forEach(([k, v]) => {
      if (!k.startsWith("kr_")) return;
      const c = k.slice(3);
      (_DISC_MKT[c] = _DISC_MKT[c] || {}).price = v[0];
      _DISC_MKT[c].chg = v[1];
    });
  }
  return _DISC_MKT[code] || null;
}

function initDisc() {
  discRendered = true;
  const tb = $("#dsc-table");
  tb.innerHTML = `<tbody><tr><td class="sub-note">공시 목록 불러오는 중…</td></tr></tbody>`;
  fetch("data/disclosures/index.json" + _cb).then((r) => (r.ok ? r.json() : null)).then((idx) => {
    if (!idx?.days?.length) {
      tb.innerHTML = `<tbody><tr><td class="sub-note">공시 데이터가 아직 없습니다.</td></tr></tbody>`;
      return;
    }
    discIdx = idx;
    discDate = idx.days[0].d;                     // 최신 영업일
    $("#dsc-date").innerHTML = idx.days.map((d) =>
      `<option value="${d.d}">${d.d} (${discDow(d.d)}) · ${d.n}건</option>`).join("");
    bindDiscUI();
    loadDiscDay(discDate);
  }).catch(() => {
    tb.innerHTML = `<tbody><tr><td class="sub-note">공시 목록을 불러오지 못했습니다.</td></tr></tbody>`;
  });
}

function discDow(ds) { return "일월화수목금토"[new Date(ds + "T00:00:00").getDay()]; }

function bindDiscUI() {
  $("#dsc-date").onchange = (e) => { discDate = e.target.value; loadDiscDay(discDate); };
  $("#dsc-nav").querySelectorAll("button").forEach((b) => b.onclick = () => {
    const days = discIdx.days.map((x) => x.d);     // ⚠최신순 정렬 — 인덱스가 클수록 과거
    const mv = +b.dataset.mv;                       // -1=이전(과거) · +1=다음(최근)
    let i = days.indexOf(discDate);
    if (mv === 0) i = 0;
    else i = Math.min(days.length - 1, Math.max(0, i - mv));  // 과거로 가려면 인덱스를 키운다
    discDate = days[i];
    $("#dsc-date").value = discDate;
    loadDiscDay(discDate);
  });
  $("#dsc-mk").querySelectorAll("button").forEach((b) => b.onclick = () => {
    discMk = b.dataset.m;
    $("#dsc-mk").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
    renderDiscTable();
  });
  // 토글과 헤더 클릭이 같은 상태를 공유한다(어느 쪽으로 바꿔도 서로 반영)
  $("#dsc-sort").querySelectorAll("button").forEach((b) => b.onclick = () => {
    discSortKey = b.dataset.s;
    discSortDir = "desc";
    renderDiscTable();
  });
  const q = $("#dsc-q");
  q.oninput = () => { discQ = q.value.trim(); renderDiscTable(); };
}

function loadDiscDay(ds) {
  const tb = $("#dsc-table");
  if (DISC_CACHE[ds]) { renderDiscDay(DISC_CACHE[ds]); return; }
  tb.innerHTML = `<tbody><tr><td class="sub-note">${ds} 공시 불러오는 중…</td></tr></tbody>`;
  fetch(`data/disclosures/${ds}.json` + _cb).then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d) { tb.innerHTML = `<tbody><tr><td class="sub-note">그날 공시가 없습니다.</td></tr></tbody>`; return; }
    DISC_CACHE[ds] = d;
    renderDiscDay(d);
  });
}

function renderDiscDay(d) {
  discCat = "";                                    // 날짜 바뀌면 카테고리 필터 초기화
  const cats = discIdx.cats, order = discIdx.order;
  $("#dsc-summary").innerHTML = `<b>${d.n}건</b> · 갱신 ${d.generated}`;
  $("#dsc-cats").innerHTML = [`<button class="dsc-cat active" data-c="">전체 <b>${d.n}</b></button>`]
    .concat(order.filter((c) => d.counts[c]).map((c) =>
      `<button class="dsc-cat" data-c="${c}">${cats[c].icon} ${cats[c].name} <b>${d.counts[c]}</b></button>`)).join("");
  $("#dsc-cats").querySelectorAll(".dsc-cat").forEach((b) => b.onclick = () => {
    discCat = b.dataset.c;
    $("#dsc-cats").querySelectorAll(".dsc-cat").forEach((x) => x.classList.toggle("active", x === b));
    renderDiscTable();
  });
  renderDiscTable();
}

function renderDiscTable() {
  const d = DISC_CACHE[discDate];
  if (!d) return;
  const cats = discIdx.cats;
  const q = discQ.toLowerCase();
  let rows = d.items.filter((it) =>
    (!discCat || it[6] === discCat) && (!discMk || it[2] === discMk) &&
    (!q || it[0].toLowerCase().includes(q) || it[3].toLowerCase().includes(q)));
  if (DISC_SORTABLE[discSortKey]) {
    // 변동은 '변동액'(현재가 − 전일종가) 기준. 값이 없는 종목(유니버스 밖)은 방향과 무관하게 항상 뒤로.
    const val = (it) => {
      const m = discMkt(it[1]);
      if (!m) return null;
      if (discSortKey === "mcap") return m.mcap ?? null;
      if (discSortKey === "price") return m.price ?? null;
      return m.price != null && m.chg != null ? m.price - m.price / (1 + m.chg) : null;
    };
    const sgn = discSortDir === "desc" ? -1 : 1;
    rows = rows.slice().sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * sgn;
    });
  }
  const th = (k, label) => {                       // 클릭 = 내림차순 → 다시 클릭하면 오름차순
    const on = discSortKey === k;
    return `<th class="num sortable${on ? " on" : ""}" data-k="${k}"
      title="${label} 기준 정렬">${label}<span class="sort-ar">${on ? (discSortDir === "desc" ? "▼" : "▲") : "↕"}</span></th>`;
  };
  $("#dsc-table").innerHTML = `<thead><tr>
      <th>회사</th>${th("mcap", "시가총액")}${th("price", "주가")}${th("chg", "변동")}
      <th>구분</th><th>공시 내용</th><th class="num">반응</th><th>원본</th>
    </tr></thead><tbody>` + (rows.length ? rows.map((it) => {
    const [name, code, mk, nm, rcp, flr, cid, fix, vr] = it;
    const c = cats[cid] || { icon: "📄", name: "기타" };
    const q2 = discMkt(code);
    // 변동액 = 현재가 − 전일종가 (전일종가 = 현재가 / (1+등락률))
    const dAmt = q2?.price != null && q2?.chg != null ? q2.price - q2.price / (1 + q2.chg) : null;
    const up = (q2?.chg || 0) >= 0;
    const col = up ? "var(--kup)" : "var(--kdn)";
    return `<tr>
      <td class="hld-name">${code ? `<img class="mv-logo" src="${logoUrl("kr", code)}" onerror="this.style.visibility='hidden'">` : ""}
        <span>${code ? `<b class="dsc-go" data-goto="kr_${code}">${name}</b>` : `<b>${name}</b>`}
        <span class="sub-note">${DISC_MK_KO[mk] || mk || ""}</span></span></td>
      <td class="num">${q2?.mcap != null ? fmtMcap(q2.mcap, "kr") : "-"}</td>
      <td class="num">${q2?.price != null ? Math.round(q2.price).toLocaleString() : "-"}</td>
      <td class="num" style="color:${dAmt == null ? "inherit" : col}">${dAmt == null ? "-"
        : `${up ? "+" : "−"}${Math.abs(Math.round(dAmt)).toLocaleString()}
           <span class="dsc-pct">${up ? "+" : "−"}${Math.abs(q2.chg * 100).toFixed(2)}%</span>`}</td>
      <td><span class="dsc-badge c-${cid}">${c.icon} ${c.name}</span></td>
      <td class="dsc-title" title="${nm.replace(/"/g, "&quot;")}">${fix ? `<span class="dsc-fix">정정</span>` : ""}${nm}</td>
      <td class="num">${vr == null ? `<span class="sub-note">-</span>`
        : `<span class="dsc-vr${vr >= 3 ? " hot" : vr >= 1.8 ? " warm" : ""}"
             title="공시일(또는 익일) 거래량이 직전 20일 평균의 ${vr}배">×${vr.toFixed(1)}</span>`}</td>
      <td><a class="dsc-src" href="${discLink(rcp)}" target="_blank" rel="noopener">DART ↗</a></td>
    </tr>`;
  }).join("") : `<tr><td colspan="8" class="sub-note">조건에 맞는 공시가 없습니다.</td></tr>`) + `</tbody>`;
  const noMkt = rows.filter((it) => !discMkt(it[1])).length;
  $("#dsc-note").innerHTML = `${rows.length.toLocaleString()}건 표시 · 출처 <b>DART 전자공시</b>(코스피·코스닥) ·
    회사명을 누르면 종목조회로, <b>DART ↗</b>는 공시 원문으로 이동합니다.<br>
    시가총액·주가·변동은 <b>공시일이 아니라 현재 시세</b>(30분 갱신) 기준입니다` +
    (noMkt ? ` · ${noMkt}건은 수집 유니버스(시총 상위 1,200) 밖이라 시세가 '-'입니다.` : `.`);
  $("#dsc-table").querySelectorAll(".dsc-go").forEach((el) => el.onclick = () => {
    if (!lookupRendered) initLookup();
    gotoTabFull("lookup");
    loadLookup(el.dataset.goto);
  });
  // 헤더 클릭 정렬: 같은 열이면 방향만 뒤집고, 다른 열이면 내림차순으로 시작
  $("#dsc-table").querySelectorAll("th.sortable").forEach((h) => h.onclick = () => {
    const k = h.dataset.k;
    if (discSortKey === k) discSortDir = discSortDir === "desc" ? "asc" : "desc";
    else { discSortKey = k; discSortDir = "desc"; }
    renderDiscTable();
  });
  // 상단 토글도 현재 정렬 상태를 따라간다(헤더로 바꿔도 어긋나지 않게)
  $("#dsc-sort")?.querySelectorAll("button").forEach((b) =>
    b.classList.toggle("active", b.dataset.s === discSortKey));
}

/* ⭐ 관심종목 탭 — 시세·산업·오늘 신호·메모를 한 표로 */
let watchRendered = false, watchGroup = "none";
/* ── 관심종목 워크스페이스(v211) — 좌 목록 + 우 8카드(사이트 전 탭의 그 종목 정보를 한 화면에) ── */
let wsSel = localStorage.getItem("cp_ws_sel") || null;
let wsSort = "added";
const WS_ST = {}, WS_FIN = {};   // stocks/·financials/ 캐시(lookup과 독립)

function wsRows() {
  const w = watchLoad();
  const sigByKey = {};
  (TODAY?.signals || []).forEach((s) => {
    const k = `${s.market}_${s.ticker}`;
    if (!sigByKey[k] || s.date > sigByKey[k].date) sigByKey[k] = s;
  });
  const rows = Object.keys(w).map((k) => {
    const it = w[k];
    const tile = (MARKET?.heatmap || []).find((t) => `${t.m}_${t.t}` === k);
    const q = MARKET?.quotes?.[k];
    return { k, ...it, name: tile?.name || it.name, grp: tile?.grp || "etc", sector: tile?.sector,
             mcap: tile?.mcap, price: q ? q[0] : null, chg: q ? q[1] : (tile?.chg ?? null),
             sig: sigByKey[k], rep: !!REPORTS_IDX?.reports?.[k] };
  });
  const by = { added: (a, b) => (a.added || "").localeCompare(b.added || ""),
               chg: (a, b) => (b.chg ?? -9) - (a.chg ?? -9),
               mcap: (a, b) => (b.mcap || 0) - (a.mcap || 0),
               sig: (a, b) => (!!b.sig - !!a.sig) || (b.chg ?? -9) - (a.chg ?? -9) };
  return rows.sort(by[wsSort] || by.added);
}

function renderWatch() {
  watchRendered = true;
  const rows = wsRows();
  const ctx = $("#watch-context");
  if (ctx) ctx.innerHTML = `⭐는 종목조회 헤더·주식찾기 표·오늘의 신호 어디서든 누르면 담깁니다.
    각 카드의 <b>→</b>는 해당 탭의 상세 화면으로 이동합니다. 로그인하면 기기 간 자동 동기화됩니다.`;
  const list = $("#ws-list"), sum = $("#watch-summary"), cnt = $("#watch-count"), main = $("#ws-main");
  bindWatchIO();
  if (!rows.length) {
    if (sum) sum.innerHTML = "";
    if (cnt) cnt.textContent = "";
    if (list) list.innerHTML = "";
    if (main) main.innerHTML = `<p class="mini-note" style="padding:40px 0;text-align:center">
      아직 담은 종목이 없습니다 — 종목조회나 주식찾기에서 <b>☆</b>를 눌러 담아보세요.</p>`;
    return;
  }
  const up = rows.filter((r) => (r.chg ?? 0) > 0).length;
  const buys = rows.filter((r) => r.sig?.side === "buy").length;
  const sells = rows.filter((r) => r.sig?.side === "sell").length;
  if (sum) sum.innerHTML = [["관심종목", `${rows.length}`, "담은 종목"],
    ["오늘 상승", `${up} / ${rows.length}`, rows.length ? `${Math.round(up / rows.length * 100)}%` : ""],
    ["🟢 매수 신호", `${buys}`, "최근 3영업일"], ["🔴 매도 신호", `${sells}`, "최근 3영업일"]]
    .map(([t, v, s2]) => `<div class="idx-card"><div class="sub-note">${t}</div>
      <b>${v}</b><span class="sub-note">${s2}</span></div>`).join("");
  if (cnt) cnt.textContent = `${rows.length}종목`;
  // 좌 목록 — 카드형(등락·최근 신호·보고서 보유 배지)
  if (!rows.some((r) => r.k === wsSel)) wsSel = rows[0].k;
  list.innerHTML = rows.map((r) => {
    const col = (r.chg ?? 0) >= 0 ? "kup" : "kdn";
    return `<button class="ws-item ${r.k === wsSel ? "on" : ""}" data-key="${r.k}">
      <img class="mv-logo" src="${logoUrl(r.mk, r.t)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <span class="ws-item-body"><b>${r.name}</b>
        <span class="ws-item-sub">${r.price != null ? fmtPrice(r.price, r.mk) : ""}
          <span class="${col}">${r.chg != null ? pct(r.chg, 2) : "-"}</span></span></span>
      <span class="ws-item-badges">${r.sig ? (r.sig.side === "buy" ? "🟢" : "🔴") : ""}${r.rep ? "📖" : ""}</span>
    </button>`;
  }).join("");
  list.querySelectorAll(".ws-item").forEach((b) => b.onclick = () => {
    wsSel = b.dataset.key;
    localStorage.setItem("cp_ws_sel", wsSel);
    list.querySelectorAll(".ws-item").forEach((x) => x.classList.toggle("on", x === b));
    wsShow(wsSel);
  });
  const sel = $("#ws-sort");
  if (sel && !sel.dataset.bound) {
    sel.dataset.bound = "1";
    sel.onchange = () => { wsSort = sel.value; renderWatch(); };
  }
  sel.value = wsSort;
  // 상대 주가 추이 — 접이식(펼칠 때 1회 렌더)
  const det = $("#watch-chart")?.closest("details");
  if (det && !det.dataset.bound) {
    det.dataset.bound = "1";
    det.addEventListener("toggle", () => {
      if (det.open) drawPeerChartInto("#watch-chart", wsRows().map((r) => ({ mk: r.mk, ticker: r.t, name: r.name })));
    });
  }
  loadReportsIdx().then(() => {   // 보고서 배지는 index 로드 후 갱신
    wsRows().forEach((r) => {
      const el = list.querySelector(`.ws-item[data-key="${r.k}"] .ws-item-badges`);
      if (el) el.textContent = `${r.sig ? (r.sig.side === "buy" ? "🟢" : "🔴") : ""}${r.rep ? "📖" : ""}`;
    });
    wsShow(wsSel);
  });
  wsShow(wsSel);
}

/* 동종업계 상대주가 추이(v272) — 산업 카드의 남는 오른쪽을 쓴다.
   같은 기간을 100에서 출발시켜 겹쳐 그리면 "업종이 오른 건지 이 종목만 오른 건지"가 바로 보인다.
   ⚠새 수집 없음: 이미 있는 stocks/{key}.json 시계열을 재사용(캐시). */
const WS_REL = {};
async function wsRelSeries(key) {
  if (WS_REL[key] !== undefined) return WS_REL[key];
  WS_REL[key] = await fetch(`data/stocks/${key}.json` + _cb)
    .then((r) => (r.ok ? r.json() : null)).then((j) => j?.series || null).catch(() => null);
  return WS_REL[key];
}

async function wsCons(key, mk, price) {
  /* 증권가 컨센서스 — 수급 카드 아래가 비어 있어 함께 둔다.
     ⚠#ws-cons는 수급 카드를 채운 뒤에야 생기므로 반드시 그 다음에 호출한다.
     ⚠컨센은 company.json에 있는데 수급(stocks/)과 로드 체인이 달라 순서가 보장되지 않는다
       → 여기서 기다린다(안 그러면 첫 진입에만 '데이터 없음'으로 뜬다). */
  await loadExtras();
  if (wsSel !== key) return;
  const co2 = EXTRAS.company?.map?.[key] || {};
    const cs = co2.cons || {};
  const px = price;
    const el = document.getElementById("ws-cons");
    if (el) {
      if (!cs.target && !cs.opinion) {
        el.innerHTML = `<div class="ws-kv-h">증권가 컨센서스</div>
          <p class="mini-note">컨센서스 데이터 없음(커버리지가 적은 종목)</p>`;
      } else {
        const gap = cs.target && px ? cs.target / px - 1 : null;
        // 네이버 투자의견은 1=매도 ~ 5=적극매수
        const opTxt = cs.opinion == null ? null
          : cs.opinion >= 4.3 ? "적극 매수" : cs.opinion >= 3.5 ? "매수"
          : cs.opinion >= 2.5 ? "중립" : "비중 축소";
        el.innerHTML = `<div class="ws-kv-h">증권가 컨센서스 <span class="sub-note">${cs.at || ""} 기준</span></div>
          ${cs.target ? `<div class="ws-kv-row"><span>목표주가</span><b>${fmtPrice(cs.target, mk)}</b>
            ${gap != null ? `<i class="${gap >= 0 ? "kup" : "kdn"}">현재가 대비 ${pct(gap, 1)}</i>` : "<i></i>"}</div>` : ""}
          ${opTxt ? `<div class="ws-kv-row"><span>투자의견</span><b>${opTxt}</b>
            <i class="sub-note">${cs.opinion.toFixed(2)} / 5.0</i></div>` : ""}
          ${cs.target && px ? `<div class="ws-cons-bar">
            <i class="cur" style="left:${Math.max(2, Math.min(96, px / Math.max(cs.target, px) * 100))}%"></i>
            <span class="sub-note lo">현재 ${fmtPrice(px, mk)}</span>
            <span class="sub-note hi">목표 ${fmtPrice(cs.target, mk)}</span></div>` : ""}`;
      }
  }
}

/* 관심종목 재무 카드(v273) — 분기/연간 전환 + **각 점에 값 표기**.
   사용자 요청: 오른쪽 큰 숫자와 아래 기간 라벨은 빼고, 그래프 안에서 값이 읽히게. */
let wsFinMode = localStorage.getItem("cp_ws_fin") || "q";

function wsFinDraw(key, mk, co, m) {
  const fin = WS_FIN[key];
  let blk = fin;
  if (fin && (fin.cfs || fin.ofs))
    blk = [fin.cfs, fin.ofs].filter(Boolean).sort((a, b) =>
      Object.keys(b?.annual || {}).length - Object.keys(a?.annual || {}).length)[0];
  const src = wsFinMode === "y" ? (blk?.annual || {}) : (blk?.quarter || {});
  const rows = Object.entries(src).sort((a, b) => a[0].localeCompare(b[0]))
    .slice(wsFinMode === "y" ? -6 : -8);
  const hasY = Object.keys(blk?.annual || {}).length >= 2;
  const hasQ = Object.keys(blk?.quarter || {}).length >= 2;
  const u2 = mk === "kr" ? "억" : "M$";
  const short = (v) => {
    const a = Math.abs(v);
    if (mk === "kr" && a >= 10000) return (v / 10000).toFixed(a >= 100000 ? 0 : 1) + "조";
    return Math.round(v).toLocaleString();
  };
  const toggle = `<span class="mk-toggle ws-fin-tg" id="ws-fin-mode">
    ${hasQ ? `<button data-m="q" class="${wsFinMode === "q" ? "active" : ""}">분기</button>` : ""}
    ${hasY ? `<button data-m="y" class="${wsFinMode === "y" ? "active" : ""}">연간</button>` : ""}
    <i class="sub-note">${rows.length ? `${rows[0][0]} ~ ${rows[rows.length - 1][0]}` : ""}</i></span>`;

  let bars = "";
  if (rows.length >= 2) {
    const spark = (lab2, k2, color) => {
      const pts = rows.map(([lab3, r], i) => ({ i, lab: lab3, v: r[k2] })).filter((x) => Number.isFinite(x.v));
      if (pts.length < 2) return "";
      const vs = pts.map((x) => x.v);
      let lo = Math.min(...vs), hi = Math.max(...vs);
      if (lo > 0) lo = Math.min(lo * 0.92, lo);
      if (hi === lo) { hi += 1; lo -= 1; }
      const W = 300, H = 50;
      const X = (i) => 10 + (i / (rows.length - 1)) * (W - 20);
      const Y = (v) => 14 + (hi - v) / (hi - lo) * (H - 22);
      const line = pts.map((x) => `${X(x.i).toFixed(1)},${Y(x.v).toFixed(1)}`).join(" ");
      const area = `${X(pts[0].i).toFixed(1)},${H - 3} ${line} ${X(pts[pts.length - 1].i).toFixed(1)},${H - 3}`;
      const zero = (lo < 0 && hi > 0)
        ? `<line x1="0" x2="${W}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="#8b8b93" stroke-dasharray="3 3" stroke-width="0.8"/>` : "";
      // 점마다 값 — 위아래 번갈아 배치해 서로 겹치지 않게
      const labs = pts.map((x, j) => {
        const up = Y(x.v) > 24;                     // 위가 좁으면 아래로
        const ty = up ? Y(x.v) - 5 : Y(x.v) + 11;
        const anchor = j === 0 ? "start" : j === pts.length - 1 ? "end" : "middle";
        return `<text x="${X(x.i).toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${anchor}"
          class="ws-fin-val ${x.v < 0 ? "kdn" : ""}">${short(x.v)}</text>`;
      }).join("");
      return `<div class="ws-fin-row"><span class="ws-fin-lab">${lab2}</span>
        <svg viewBox="0 0 ${W} ${H}" class="ws-fin-spark" preserveAspectRatio="none">
          ${zero}
          <polygon points="${area}" fill="${color}" opacity="0.14"/>
          <polyline points="${line}" fill="none" stroke="${color}" stroke-width="1.8"/>
          ${pts.map((x) => `<circle cx="${X(x.i).toFixed(1)}" cy="${Y(x.v).toFixed(1)}" r="2"
             fill="${x.v < 0 ? "var(--kdn)" : color}"><title>${x.lab} ${lab2} ${Math.round(x.v).toLocaleString()}${u2}</title></circle>`).join("")}
          ${labs}
        </svg></div>`;
    };
    bars = spark("매출", "rev", "#4391ff") + spark("영업이익", "op", "#22c07a") + spark("순이익", "np", "#9d7bff");
  }
  // 최근 기간 3행(전년 대비)
  let tb = "";
  if (rows.length) {
    const [ll, lr] = rows[rows.length - 1];
    const prevY = wsFinMode === "y"
      ? rows[rows.length - 2]
      : rows.find(([l2]) => l2 === `${String(+ll.slice(0, 2) - 1).padStart(2, "0")}${ll.slice(2)}`);
    const rowf = (lab, cur, pv) => {
      if (cur == null) return "";
      let yTxt = "<i>-</i>";
      if (pv != null && isFinite(pv)) {
        if (pv < 0 && cur >= 0) yTxt = `<i class="pos">흑자전환</i>`;
        else if (pv >= 0 && cur < 0) yTxt = `<i class="neg">적자전환</i>`;
        else if (Math.abs(pv) > Math.abs(cur) * 0.02) {
          const yy = (cur / pv - 1) * 100;
          yTxt = `<i class="${yy >= 0 ? "pos" : "neg"}">${yy >= 0 ? "+" : ""}${yy.toFixed(1)}%</i>`;
        }
      }
      return `<div class="ws-kv-row"><span>${lab}</span><b>${Math.round(cur).toLocaleString()}${u2}</b>${yTxt}</div>`;
    };
    tb = `<div class="ws-kv-h">${ll} <span class="sub-note">(${wsFinMode === "y" ? "전년 대비" : "YoY"})</span></div>`
      + rowf("매출", lr.rev, prevY?.[1]?.rev) + rowf("영업이익", lr.op, prevY?.[1]?.op) + rowf("순이익", lr.np, prevY?.[1]?.np);
  }
  const caps = [m?.roe != null && `ROE ${m.roe}%`, m?.debtRatio != null && `부채비율 ${m.debtRatio}%`,
                m?.quickRatio != null && `당좌비율 ${m.quickRatio}%`].filter(Boolean).join(" · ");
  const host = document.querySelector(".ws-fin .ws-card-b");
  if (!host) return;
  host.innerHTML = toggle + (bars || `<p class="mini-note">${wsFinMode === "y" ? "연간" : "분기"} 재무 없음</p>`)
    + tb + `<div class="sub-note">${caps}</div>`;
  host.querySelectorAll("#ws-fin-mode button").forEach((b) => b.onclick = () => {
    wsFinMode = b.dataset.m;
    localStorage.setItem("cp_ws_fin", wsFinMode);
    wsFinDraw(key, mk, co, m);
  });
}

async function wsRelChart(key, mk) {
  // ⚠피어 목록은 company.json에 있다 — 산업 카드는 loadExtras() 밖에서 그려지므로
  //   여기서 직접 기다린다(안 그러면 peers가 비어 그래프가 통째로 안 나온다).
  await loadExtras();
  if (wsSel !== key) return;
  const peers = (EXTRAS.company?.map?.[key]?.peers || []).slice(0, 3);
  const nameOf = {};
  const keys = [key, ...peers.map((x) => {
    const k = `${x.mk || mk}_${x.ticker}`;
    nameOf[k] = x.name;                       // ⚠피어 이름은 peers가 갖고 있다(인덱스 매칭은 실패한다)
    return k;
  })].filter((k, i, a) => a.indexOf(k) === i);
  const ss = await Promise.all(keys.map(wsRelSeries));
  // ⚠await 사이에 카드가 다시 그려지면 먼저 잡아둔 el은 DOM에서 떨어진다 → 여기서 다시 조회
  const el = document.getElementById("ws-ind-rel");
  if (!el || wsSel !== key) return;
  const N = 126;                                   // 약 6개월(거래일)
  const defs = [];
  keys.forEach((k, i) => {
    const s = ss[i];
    if (!s || s.length < 30) return;
    // series 원본은 [날짜, 시, 고, 저, 종, 거래량] **배열**이다(객체 아님)
    const cl = (r) => (Array.isArray(r) ? r[4] : r.c);
    const cut = s.slice(-N).filter((r) => cl(r) != null);
    if (cut.length < 20) return;
    const base = cl(cut[0]);
    defs.push({ key: k, name: nameOf[k] || (LOOKUP_INDEX || []).find((x) => `${x.mk}_${x.ticker}` === k)?.name
                  || (MARKET?.heatmap || []).find((x) => `${x.m}_${x.t}` === k)?.name || k,
                v: cut.map((r) => cl(r) / base * 100) });
  });
  if (defs.length < 2) { el.innerHTML = ""; return; }
  const W = 300, H = 132, P = { l: 4, r: 60, t: 12, b: 14 };
  const n = Math.max(...defs.map((d) => d.v.length));
  const all = defs.flatMap((d) => d.v);
  const lo = Math.min(...all), hi = Math.max(...all);
  const X = (i, len) => P.l + (W - P.l - P.r) * (len < 2 ? 0 : i / (len - 1));
  const Y = (v) => P.t + (H - P.t - P.b) * (1 - (v - lo) / Math.max(1e-6, hi - lo));
  const C = ["#f5445a", "#4391ff", "#22c07a", "#f0b34c"];
  const ends = [];
  const paths = defs.map((d, i) => {
    const pts = d.v.map((v, j) => `${X(j, d.v.length).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
    ends.push({ name: d.name, v: d.v[d.v.length - 1], y: Y(d.v[d.v.length - 1]), c: C[i % 4] });
    return `<polyline points="${pts}" fill="none" stroke="${C[i % 4]}" stroke-width="${i === 0 ? 2 : 1.3}"/>`;
  }).join("");
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 11);
  const labs = ends.map((e) => `<text x="${W - P.r + 4}" y="${e.y + 3}" fill="${e.c}"
    style="font-size:8.5px">${dsEsc(e.name).slice(0, 7)} ${Math.round(e.v - 100) >= 0 ? "+" : ""}${Math.round(e.v - 100)}%</text>`).join("");
  el.innerHTML = `<div class="ws-kv-h">동종업계 상대주가 <span class="sub-note">(6개월 · 시작=100)</span></div>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
      <line x1="${P.l}" y1="${Y(100)}" x2="${W - P.r}" y2="${Y(100)}" stroke="#8b8b93" stroke-dasharray="3 3"/>
      ${paths}${labs}</svg>`;
}

const wsCard = (icon, title, act, body, cls = "") =>
  `<div class="ws-card ${cls}"><div class="ws-card-h">${icon} ${title}
    <span style="flex:1"></span>${act ? `<button class="ws-go" data-act="${act}">자세히 →</button>` : ""}</div>
    <div class="ws-card-b">${body}</div></div>`;

function wsSpark(series, sig) {
  const s = (series || []).slice(-126);
  if (s.length < 10) return `<p class="mini-note">차트 데이터 없음</p>`;
  const cs = s.map((x) => x.c), lo = Math.min(...cs), hi = Math.max(...cs);
  const W = 300, H = 46;
  const X = (i) => (i / (s.length - 1)) * W;
  const Y = (v) => H - 3 - (v - lo) / (hi - lo || 1) * (H - 8);
  const pts = cs.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const up = cs[cs.length - 1] >= cs[0];
  let dot = "";
  if (sig) {   // 최근 신호일을 차트 위에 점으로
    const i = s.findIndex((x) => x.t === sig.date);
    if (i >= 0) dot = `<circle cx="${X(i).toFixed(1)}" cy="${Y(cs[i]).toFixed(1)}" r="3.4"
      fill="${sig.side === "buy" ? "#22c07a" : "#f5445a"}"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="ws-spark" preserveAspectRatio="none">
    <polyline points="${pts}" fill="none" stroke="${up ? "var(--kup)" : "var(--kdn)"}" stroke-width="1.6"/>${dot}</svg>`;
}

function wsShow(key) {
  const main = $("#ws-main");
  if (!main || !key) return;
  const w = watchLoad()[key] || {};
  const [mk, tk] = [key.slice(0, 2), key.slice(3)];
  const tile = (MARKET?.heatmap || []).find((t) => `${t.m}_${t.t}` === key);
  const q = MARKET?.quotes?.[key];
  const price = q ? q[0] : null, chg = q ? q[1] : (tile?.chg ?? null);
  const gmeta = [...IND_GROUPS, SCR_GROUP_ETC].find((g) => g.key === (tile?.grp || "etc"));
  const col = (chg ?? 0) >= 0 ? "kup" : "kdn";
  main.innerHTML = `
    <div class="ws-head">
      <img class="lk-sticky-logo" src="${logoUrl(mk, tk)}" alt="" onerror="this.style.display='none'">
      <b class="ws-name">${w.name || tk}</b><span class="sub-note">${tk} · ${mk === "kr" ? "🇰🇷" : "🇺🇸"}
        ${gmeta ? `${gmeta.icon} ${gmeta.name}` : ""}${tile?.sector ? ` › ${tile.sector}` : ""}</span>
      ${price != null ? `<span class="ws-price ${col}">${fmtPrice(price, mk)} ${chg != null ? pct(chg, 2) : ""}</span>` : ""}
      <span style="flex:1"></span>
      <input class="ws-memo" id="ws-memo" placeholder="메모" value="${(w.memo || "").replace(/"/g, "&quot;")}">
      <button class="today-chart-btn ws-go" data-act="lookup">종목조회 →</button>
      <button class="today-chart-btn" id="ws-unstar" title="관심종목에서 빼기">★ 해제</button>
    </div>
    <div class="ws-grid" id="ws-grid">
      ${wsCard("📖", "심층 보고서", null, `<p class="mini-note">확인 중…</p>`, "ws-report")}
      ${wsCard("📈", "추이 · 신호 (6개월)", "lookup", `<p class="mini-note">불러오는 중…</p>`, "ws-trend")}
      ${wsCard("📊", "재무 (분기)", "lookup", `<p class="mini-note">불러오는 중…</p>`, "ws-fin")}
      ${wsCard("⚖️", "밸류에이션", "lookup", `<p class="mini-note">불러오는 중…</p>`, "ws-val")}
      ${wsCard("👥", "수급 · 컨센서스", "lookup", `<p class="mini-note">불러오는 중…</p>`, "ws-supply")}
      ${wsCard("🏭", "산업 맥락", "rotation", `<p class="mini-note">불러오는 중…</p>`, "ws-ind")}
      ${wsCard("📢", "공시 · 뉴스", "lookup", `<p class="mini-note">불러오는 중…</p>`, "ws-feed")}
      ${wsCard("📐", "원칙 성적 (이 종목 10년)", "rank", `<p class="mini-note">불러오는 중…</p>`, "ws-rules")}
    </div>`;
  const fill = (cls, html) => { const el = main.querySelector(`.${cls} .ws-card-b`); if (el) el.innerHTML = html; };
  // 헤더 바인딩
  $("#ws-memo").onchange = () => { const d = watchLoad(); if (d[key]) { d[key].memo = $("#ws-memo").value; watchSave(d); } };
  $("#ws-unstar").onclick = () => { watchToggle(key); };
  main.querySelectorAll(".ws-go").forEach((b) => b.onclick = () => {
    const act = b.dataset.act;
    if (act === "lookup") { gotoTabFull("lookup"); if (!lookupRendered) initLookup(); loadLookup(key); }
    else gotoTabFull(act);
  });

  // ① 심층 보고서 — 있으면 메타+열기, 없으면 요청 안내(T1 수동 작성 체제)
  loadReportsIdx().then((idx) => {
    if (wsSel !== key) return;
    const meta = idx.reports?.[key];
    if (meta) {
      const stale = meta.next_due && kstDay() > meta.next_due;
      fill("ws-report", `<div class="ws-rep-meta">기준일 <b>${meta.date}</b> · v${meta.version || 1} ·
          ${meta.tier === "deep" ? "심층(감사×투자 14장)" : "자동 골격"}
          ${stale ? `<span class="lk-stale">⚠ 분기 경과</span>` : ""}</div>
        <div id="ws-rep-sum" class="sub-note">요약 불러오는 중…</div>
        <button class="rep-btn" id="ws-rep-open">📖 전체 보고서 열기</button>`);
      const b = $("#ws-rep-open"); if (b) b.onclick = () => openReport(key);
      // 0장 신호등 3개 + '한 줄 결론'을 카드에 바로 보여준다(열지 않아도 판정이 보이게)
      fetch(`data/reports/${key}.json` + _cb).then((r) => (r.ok ? r.json() : null)).then((rep) => {
        if (wsSel !== key || !rep?.md) return;
        const el = document.getElementById("ws-rep-sum"); if (!el) return;
        const lights = [...rep.md.matchAll(/\|\s*([^|\n]+?)\s*\|\s*((?:🟢|🟡|🔴)[^|\n]*?)\s*\|/g)]
          .filter((m) => !/신호등|판정/.test(m[1])).slice(0, 3);
        const concl = rep.md.match(/\*\*한 줄 결론\*\*[:：]?\s*([^\n]+)/);
        el.className = "ws-rep-body";
        el.innerHTML = lights.map((m) => `<div class="ws-rep-light"><span>${m[1]}</span><b>${m[2].split("·")[0].trim()}</b></div>`).join("")
          + (concl ? `<p class="ws-rep-concl">${concl[1].replace(/\*\*/g, "").slice(0, 150)}</p>` : "");
      });
    } else {
      fill("ws-report", `<p class="ws-rep-none">아직 이 종목의 심층 보고서가 없습니다.<br>
        <span class="sub-note">Claude 세션에서 아래 문구로 요청하면 DART 검증 절차로 작성해 탑재합니다.</span></p>
        <button class="today-chart-btn" id="ws-rep-req">📋 "${w.name || tk} 이해 보고서 써줘" 복사</button>`);
      const b = $("#ws-rep-req");
      if (b) b.onclick = () => { navigator.clipboard?.writeText(`${w.name || tk} 이해 보고서 써줘`);
        b.textContent = "✅ 복사됨 — Claude에게 붙여넣으세요"; };
    }
    // 📚 사업 심층(v221) — 있으면 보고서 카드 하단에 접이식으로
    fetchBizDeep(key).then((d) => {
      if (wsSel !== key || !d) return;
      const card = document.querySelector("#ws-main .ws-report .ws-card-b");
      if (!card || card.querySelector(".ws-bizdeep")) return;
      const div = document.createElement("div");
      div.className = "ws-bizdeep";
      div.innerHTML = bizDeepHtml(d);
      div.querySelector(".bd-open").onclick = () => openBizDeep(d, w.name || tk);
      card.appendChild(div);
    });
  });

  // 종목 시계열(stocks/{key}.json) 기반 카드들
  const stP = WS_ST[key] ? Promise.resolve(WS_ST[key])
    : fetch(`data/stocks/${key}.json` + _cb).then((r) => (r.ok ? r.json() : null)).then(normStock).then((st) => (WS_ST[key] = st));
  stP.then((st) => {
    if (wsSel !== key) return;
    if (!st) { ["ws-trend", "ws-supply", "ws-rules"].forEach((c) => fill(c, `<p class="mini-note">데이터 준비 중</p>`)); return; }
    // ② 추이·신호
    const sigs = (TODAY?.signals || []).filter((s) => `${s.market}_${s.ticker}` === key)
      .sort((a, b) => b.date.localeCompare(a.date));
    const sig = sigs[0];
    const regime = TODAY?.regime?.[mk];
    const rgKo = { bull: "🚀 급등장", bear: "🐻 하락장", neutral: "일반" }[regime] || "-";
    const pr = st.profile || {};
    const cap = (lab, v) => v == null ? "" :
      `<span class="ws-cap"><i>${lab}</i><b class="${v >= 0 ? "kup" : "kdn"}">${pct(v, 1)}</b></span>`;
    // 마커(원칙 신호 이력)에서도 최근 2건 — TODAY(3영업일)보다 긴 맥락
    const mks = (st.markers || []).slice(-2).reverse();
    fill("ws-trend", `${wsSpark(st.series, sig)}
      <div class="ws-caps">${cap("1주", pr.ret_w1)}${cap("1개월", pr.ret_m1)}${cap("3개월", pr.ret_m3)}${cap("1년", pr.ret_y1)}</div>
      <div class="ws-kv">${sig ? `<div>최근 신호 <b>${sig.side === "buy" ? "🟢" : "🔴"} ${sig.rule}</b> <span class="sub-note">${sig.date.slice(5)}</span></div>`
        : `<div class="sub-note">최근 3영업일 신호 없음</div>`}
      ${mks.map((m2) => `<div class="sub-note">이력: ${m2.side === "buy" ? "🟢" : "🔴"} ${m2.name || m2.rule_id} (${String(m2.t).slice(5)})</div>`).join("")}
      <div class="sub-note">현재 국면 ${rgKo} · 베타 ${pr.beta ?? "-"} · 변동성 ${pr.vol20 != null ? pr.vol20 + "%" : "-"}</div></div>`);
    // ⑤ 수급
    const sup = st.supply_sum;
    const consSlot = `<div id="ws-cons"></div>`;
    if (mk !== "kr") fill("ws-supply", `<p class="mini-note">미국 종목은 투자자별 수급이 공개되지 않습니다.</p>${consSlot}`);
    else if (!sup) fill("ws-supply", `<p class="mini-note">수급 데이터 없음</p>${consSlot}`);
    else {
      const amt = (v) => v == null ? "-" : `<b class="${v >= 0 ? "kup" : "kdn"}">${v >= 0 ? "+" : ""}${Math.abs(v) >= 10000 ? (v / 10000).toFixed(1) + "조" : Math.round(v).toLocaleString() + "억"}</b>`;
      fill("ws-supply", `<table class="ws-sup-tb"><tr><th></th><th>외국인</th><th>기관</th><th>개인</th></tr>
        <tr><td>5일</td><td>${amt(sup.frgn_5)}</td><td>${amt(sup.inst_5)}</td><td>${amt(sup.indi_5)}</td></tr>
        <tr><td>20일</td><td>${amt(sup.frgn_20)}</td><td>${amt(sup.inst_20)}</td><td>${amt(sup.indi_20)}</td></tr></table>
        <div class="sub-note">${sup.frgn_ratio != null ? `외국인 보유율 <b>${sup.frgn_ratio}%</b>${sup.frgn_ratio_chg != null ? ` (20일 ${sup.frgn_ratio_chg >= 0 ? "+" : ""}${sup.frgn_ratio_chg}%p)` : ""}` : ""} · 순매수 대금 기준(순매매량×종가)
        · 기타법인 제외라 세 주체 합은 0이 아닙니다</div>${consSlot}`);
    }
    wsCons(key, mk, price);         // 수급 카드가 채워진 뒤 컨센서스 슬롯을 채운다
    // ⑧ 원칙 성적
    const stats = (st.stats || []).filter((s) => s.n >= 8);
    if (!stats.length) fill("ws-rules", `<p class="mini-note">신호 표본이 부족합니다(원칙당 8건 미만).</p>`);
    else {
      const ranked = [...stats].sort((a, b) => (b.win - a.win) || (b.avg_fwd20 - a.avg_fwd20));
      const row = (s, cls) => `<div class="ws-rule-row"><b class="${cls}">${s.side === "buy" ? "🟢" : "🔴"} ${s.name}</b>
        <span class="sub-note">승률 ${(s.win * 100).toFixed(0)}% · 20일 ${s.avg_fwd20 >= 0 ? "+" : ""}${(s.avg_fwd20 * 100).toFixed(1)}% · n=${s.n}</span></div>`;
      fill("ws-rules", ranked.slice(0, 3).map((s) => row(s, "pos")).join("")
        + `<div class="ws-rule-div sub-note">이 종목에서 안 통한 원칙</div>`
        + row(ranked[ranked.length - 1], "neg"));
    }
  });

  // ③ 재무 (financials lazy) — 분기 매출 막대 + 핵심지표 한 줄
  loadExtras().then(() => {
    if (wsSel !== key) return;
    const co = EXTRAS.company?.map?.[key] || {};
    const m = co.metrics || {};
    const finP = WS_FIN[key] ? Promise.resolve(WS_FIN[key])
      : fetch(`data/financials/${key}.json` + _cb).then((r) => (r.ok ? r.json() : null)).then((f) => (WS_FIN[key] = f));
    finP.then((fin) => {
      if (wsSel !== key) return;
      WS_FIN[key] = fin;
      wsFinDraw(key, mk, co, m);
    });
    // ④ 밸류에이션 — PER·PBR·선행PER + 참고 내재가치(RIM 기본가정)
    const est = finExtOk(co.fin_ext).filter((r) => r.est && r.eps).pop();
    const fwd = est && price ? price / est.eps : null;
    const rec = VAL?.map?.[key];
    let ivLine = "";
    if (rec) {
      let bps0 = null, roe0 = null;
      if (mk === "kr" && rec.bps?.length && rec.roe?.length) {
        const valid = rec.bps.filter((v) => v != null);
        bps0 = valid.length > 1 ? valid[valid.length - 2] : valid[valid.length - 1];
        roe0 = rec.roe.filter((v) => v != null).pop();
      } else if (mk === "us") { bps0 = rec.bps; roe0 = rec.roe; }
      if (bps0 && roe0 != null) {
        const iv = rimValue(bps0, roe0, 9, 0.7);
        const gap = rec.price ? iv / rec.price - 1 : null;
        ivLine = `<div class="sub-note">참고 내재가치(RIM) ${fmtPrice(iv, mk)}${gap != null ? ` — 현재가 대비 <b class="${gap >= 0 ? "pos" : "neg"}">${pct(gap, 0)}</b>` : ""}</div>`;
      }
    }
    const dy = m.dps && price ? (m.dps / price * 100) : null;
    const peerM = (co.peers || []).map((x) => EXTRAS.company?.map?.[`kr_${x.ticker}`]?.metrics || {});
    const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const peerPer = avg(peerM.map((x) => x.per).filter(Number.isFinite));
    const peerPbr = avg(peerM.map((x) => x.pbr).filter(Number.isFinite));
    // PSR = 시총 ÷ 최근 확정 연매출(fin의 est 아닌 마지막) — KR은 억원 단위 통일
    const lastFin = (co.fin || []).filter((r) => !r.est).pop();
    const tile2 = (MARKET?.heatmap || []).find((x) => `${x.m}_${x.t}` === key);
    const psr = tile2?.mcap && lastFin?.rev ? (tile2.mcap / 1e8) / lastFin.rev : null;
    // EPS 추이(확정+추정) 미니 막대 — 이익 성장의 방향을 카드에서 바로
    const epsRows = finExtOk(co.fin_ext).filter((r) => r.eps != null).slice(-4);
    let epsBar = "";
    if (epsRows.length >= 2) {
      const mx = Math.max(...epsRows.map((r) => Math.abs(r.eps)), 1);
      epsBar = `<div class="ws-fin-row"><span class="ws-fin-lab">EPS</span>
        <span class="ws-fin-bars eps">${epsRows.map((r) =>
          `<i class="${r.eps < 0 ? "neg" : ""}${r.est ? " est" : ""}" title="${r.y} EPS ${Math.round(r.eps).toLocaleString()}${r.est ? " (추정)" : ""}"
             style="height:${Math.max(8, Math.abs(r.eps) / mx * 100)}%"></i>`).join("")}</span>
        <i class="sub-note">${epsRows[0].y.slice(2, 4)}→${epsRows[epsRows.length - 1].y.slice(2, 4)}년${epsRows.some((r) => r.est) ? " · 빗금=추정" : ""}</i></div>`;
    }
    // 52주 위치(현재가가 1년 밴드의 어디쯤인가)
    const pr2 = WS_ST[key]?.profile || {};
    const w52 = pr2.pos52 != null ? pr2.pos52 : null;
    // 시가총액·기간수익률 — 카드 아래쪽이 비어 있어 '지금 이 종목의 크기와 성적'을 함께 둔다
    const mcapTxt = tile2?.mcap ? fmtMcap(tile2.mcap, mk) : null;
    const RETS = [["1주", "ret_w1", "rel_w1"], ["1개월", "ret_m1", "rel_m1"],
                  ["3개월", "ret_m3", "rel_m3"], ["1년", "ret_y1", "rel_y1"]];
    const rr = RETS.filter(([, k2]) => pr2[k2] != null);
    const retRow = rr.length ? `<div class="ws-kv-h">기간 수익률 <span class="sub-note">(괄호=시장 대비)</span></div>
      <div class="ws-rets">${rr.map(([lab, k2, k3]) => `<span class="ws-ret">
        <i class="sub-note">${lab}</i>
        <b class="${pr2[k2] >= 0 ? "kup" : "kdn"}">${pct(pr2[k2], 1)}</b>
        ${pr2[k3] != null ? `<i class="sub-note">(${pct(pr2[k3], 1)})</i>` : ""}</span>`).join("")}</div>` : "";
    fill("ws-val", `${mcapTxt ? `<div class="ws-kv-row"><span>시가총액</span><b>${mcapTxt}</b>
        <i class="sub-note">${pr2.sector_rank ? `${pr2.sector} ${pr2.sector_rank}/${pr2.sector_n}위` : ""}${
          w52 != null ? ` · 52주 위치 ${Math.round(w52 * 100)}%` : ""}</i></div>` : ""}
      <div class="ws-kv-row"><span>PER</span><b>${m.per ?? "-"}배</b>
        ${peerPer ? `<i class="sub-note">동종 평균 ${peerPer.toFixed(1)}배 — ${m.per != null ? (m.per < peerPer ? "낮음" : "높음") : "-"}</i>` : "<i></i>"}</div>
      <div class="ws-kv-row"><span>PBR</span><b>${m.pbr ?? "-"}배</b>
        <i class="sub-note">${peerPbr ? `동종 평균 ${peerPbr.toFixed(1)}배` : ""}${m.bps ? ` · BPS ${Math.round(m.bps).toLocaleString()}` : ""}</i></div>
      ${psr ? `<div class="ws-kv-row"><span>PSR</span><b>${psr.toFixed(2)}배</b><i class="sub-note">시총 ÷ ${lastFin.y.slice(0, 4)} 매출</i></div>` : ""}
      ${fwd ? `<div class="ws-kv-row"><span>선행 PER</span><b>${fwd.toFixed(1)}배</b><i class="sub-note">${est.y} 추정 EPS 기준</i></div>` : ""}
      ${dy ? `<div class="ws-kv-row"><span>배당수익률</span><b>${dy.toFixed(2)}%</b><i class="sub-note">DPS ${Math.round(m.dps).toLocaleString()}원</i></div>` : ""}
      ${epsBar}
      ${ivLine || `<div class="sub-note">내재가치 데이터 없음</div>`}
      ${retRow}`);
    // ⑦ 공시·뉴스
    const fe = EXTRAS.feed?.map?.[key] || EXTRAS.feed?.[key] || {};
    const disc = (fe.disc || []).slice(0, 4), news = (fe.news || []).slice(0, 3);
    if (!disc.length && !news.length) fill("ws-feed", `<p class="mini-note">최근 공시·뉴스 없음</p>`);
    else fill("ws-feed",
      disc.map((d) => `<div class="ws-feed-row">📄 <a href="${d.link}" target="_blank" rel="noopener">${d.title}</a>
        <span class="sub-note">${d.d?.slice(5) || ""}</span></div>`).join("") +
      news.map((n) => `<div class="ws-feed-row">📰 <a href="${n.link}" target="_blank" rel="noopener">${n.title}</a>
        <span class="sub-note">${n.t || ""}</span></div>`).join(""));
  });

  // ⑥ 산업 맥락 — 소속 산업군의 1개월 수익률·순위(시장 대비 초과 포함)
  {
    const rot = MPRO?.rotation?.[mk];
    const groups = rot?.groups || [];
    const g = groups.find((x) => x.grp === (tile?.grp || "etc"));
    if (!g) fill("ws-ind", `<p class="mini-note">산업 분류 없음</p>`);
    else {
      const rank = [...groups].sort((a, b) => (b.m1 ?? -9) - (a.m1 ?? -9)).findIndex((x) => x.grp === g.grp) + 1;
      const plist = (EXTRAS.company?.map?.[key]?.peers || []).slice(0, 3);
      fill("ws-ind", `${gmeta?.icon || ""} <b>${g.name}</b> — 1개월 <b class="${(g.m1 ?? 0) >= 0 ? "pos" : "neg"}">${pct(g.m1 ?? 0, 1)}</b>
        <span class="sub-note">(${groups.length}개 산업 중 ${rank}위 · 시장 대비 ${pct(g.rs_m1 ?? 0, 1)})</span>
        <div class="sub-note">1주 ${pct(g.w1 ?? 0, 1)} · 3개월 ${pct(g.m3 ?? 0, 1)} · 소속 ${g.n}종목</div>
        <div class="ws-ind-cols"><div id="ws-ind-met"></div><div id="ws-ind-rel"></div></div>
        ${plist.length ? `<div class="ws-kv-h">동종 상위</div>` + plist.map((x) =>
          `<div class="ws-kv-row"><span>${x.name}</span><b class="${(x.chg || 0) >= 0 ? "kup" : "kdn"}">${x.chg != null ? (x.chg >= 0 ? "+" : "") + x.chg.toFixed(1) + "%" : "-"}</b>
             <i class="sub-note">${x.price != null ? Math.round(x.price).toLocaleString() + "원" : ""}</i></div>`).join("") : ""}`);
      // 산업 진단과 같은 소스(sector_metrics) — 이 산업의 실물·프록시 지표 3개(3개월 전 대비)
      loadSecMet().then((sm) => {
        if (wsSel !== key) return;
        const el = document.getElementById("ws-ind-met");
        const spec = sm?.spec?.[tile?.grp];
        if (!el || !spec) return;
        const ids = [...(spec.ecos || []), ...(spec.yf || [])].slice(0, 3);
        const rows2 = ids.map((id) => {
          const ser = sm.series?.[id], meta2 = sm.meta?.[id];
          if (!ser?.length) return "";
          const lastV = ser[ser.length - 1][1];
          // ⚠주기 혼재: ECOS 수출지수=월간('2026-04') · 야후 프록시=주간('26-07-13').
          //   같은 인덱스로 되돌리면 월간이 14개월 전이 되어 "+229%" 같은 허수가 나온다(실측) → 라벨로 구분.
          const monthly = String(ser[0][0]).length === 7;
          const back = monthly ? 3 : 13;
          const ago = ser[Math.max(0, ser.length - 1 - back)][1];
          const chg2 = ago ? (lastV / ago - 1) * 100 : null;
          return `<div class="ws-kv-row"><span>${meta2?.name || id}</span>
            <b>${Math.abs(lastV) >= 1000 ? Math.round(lastV).toLocaleString() : lastV}</b>
            ${chg2 != null ? `<i class="${chg2 >= 0 ? "pos" : "neg"}">3개월 ${chg2 >= 0 ? "+" : ""}${chg2.toFixed(1)}%</i>` : "<i></i>"}</div>`;
        }).filter(Boolean).join("");
        if (rows2) el.innerHTML = `<div class="ws-kv-h">산업 지표 <span class="sub-note">(산업 진단과 동일 소스)</span></div>` + rows2;
      });
      wsRelChart(key, mk);                 // 동종업계 상대주가 추이
    }
  }
}
function bindWatchIO() {
  const ex = $("#watch-export"), im = $("#watch-import"), f = $("#watch-import-file");
  if (ex) ex.onclick = () => {
    const blob = new Blob([JSON.stringify(watchLoad(), null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `관심종목_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  if (im && f) {
    im.onclick = () => f.click();
    f.onchange = (e) => {
      const file = e.target.files[0]; if (!file) return;
      file.text().then((txt) => {
        try {
          const d = JSON.parse(txt);
          const w = watchLoad(), before = Object.keys(w).length;
          Object.entries(d).forEach(([k, v]) => { if (!w[k]) w[k] = v; });
          watchSave(w);
          alert(`가져오기 완료 — ${Object.keys(w).length - before}종목 추가`);
          renderWatch(); syncWatchStars();
        } catch (err) { alert("JSON 형식이 올바르지 않습니다."); }
        e.target.value = "";
      });
    };
  }
}

/* ---------- 🏙 자산시장 — 부동산·채권 + 로테이션 검증 (asset_rotation.json) ---------- */
let assetsRendered = false, ASSETS = null, asReMode = "index", asBondMode = "yield";
const AS_COLORS = ["#4391ff", "#f5445a", "#22c07a", "#f0b34c", "#9d7bff", "#38bdf8", "#fb923c"];

// 공통 멀티라인 SVG — 월간 시리즈 여러 개를 한 축에 그린다(끝 라벨 겹침 방지 포함)
function asLines(host, defs, opt = {}) {
  const el = $(host); if (!el) return;
  const use = defs.filter((d) => d.t?.length >= 2);
  if (!use.length) { el.innerHTML = `<p class="mini-note">데이터 없음</p>`; return; }
  const cut = opt.from || null;
  const series = use.map((d) => {
    const idx = d.t.map((x, i) => i).filter((i) => !cut || d.t[i] >= cut);
    return { ...d, tt: idx.map((i) => d.t[i]), vv: idx.map((i) => d.v[i]) };
  }).filter((d) => d.tt.length >= 2);
  const months = [...new Set(series.flatMap((d) => d.tt))].sort();
  const W = 900, H = opt.h || 300, P = { l: 52, r: 118, t: 14, b: 24 };
  const X = (m) => P.l + (W - P.l - P.r) * (months.indexOf(m) / Math.max(1, months.length - 1));
  const all = series.flatMap((d) => d.vv).filter((v) => v != null && isFinite(v));
  let mn = Math.min(...all), mx = Math.max(...all);
  if (opt.zero) { mn = Math.min(mn, 0); mx = Math.max(mx, 0); }
  const pad = (mx - mn) * 0.1 || 1;
  const lo = mn - pad, hi = mx + pad;
  const Y = (v) => P.t + (H - P.t - P.b) * (1 - (v - lo) / (hi - lo));
  const fmt = opt.fmt || ((v) => v.toFixed(1));
  const grid = [0, .25, .5, .75, 1].map((r) => {
    const v = lo + (hi - lo) * r;
    return `<line x1="${P.l}" y1="${Y(v)}" x2="${W - P.r}" y2="${Y(v)}" stroke="var(--line)"/>
      <text x="${P.l - 5}" y="${Y(v) + 3}" text-anchor="end" class="cr-ax">${fmt(v)}</text>`;
  }).join("");
  const zero = (lo <= 0 && hi >= 0)
    ? `<line x1="${P.l}" y1="${Y(0)}" x2="${W - P.r}" y2="${Y(0)}" stroke="#8b8b93" stroke-dasharray="4 4"/>` : "";
  const paths = series.map((d, i) => `<polyline points="${d.tt.map((m, j) =>
    `${X(m).toFixed(1)},${Y(d.vv[j]).toFixed(1)}`).join(" ")}" fill="none"
    stroke="${d.color || AS_COLORS[i % 7]}" stroke-width="${d.w || 1.9}"
    ${d.dash ? `stroke-dasharray="${d.dash}"` : ""}/>`).join("");
  const ends = series.map((d, i) => ({ name: d.name, color: d.color || AS_COLORS[i % 7],
    v: d.vv[d.vv.length - 1], y: Y(d.vv[d.vv.length - 1]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 14);
  const labels = ends.map((e) => `<text x="${W - P.r + 6}" y="${e.y + 3}" class="cr-end"
    fill="${e.color}">${e.name} ${fmt(e.v)}</text>`).join("");
  const step = Math.max(1, Math.ceil(months.length / 6));
  const xl = months.map((m, i) => (i % step === 0 || i === months.length - 1)
    ? `<text x="${X(m)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === months.length - 1 ? "end" : "middle"}"
        class="cr-ax">${m}</text>` : "").join("");
  // ⚠height를 픽셀로 고정하면 2열 배치에서 위아래 여백만 생긴다(viewBox가 letterbox됨)
  //   → 높이는 viewBox 비율이 정하게 두고 폭에만 맞춘다.
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="height:auto;display:block">`
    + `${grid}${zero}${paths}${labels}${xl}</svg>`;
}

const asS = (k) => ASSETS?.series?.[k];
const asLast = (k) => { const s = asS(k); return s ? s.v[s.v.length - 1] : null; };
const asPrev = (k, n = 1) => { const s = asS(k); return s && s.v.length > n ? s.v[s.v.length - 1 - n] : null; };

function renderAssets() {
  assetsRendered = true;
  fetch("data/asset_rotation.json" + _cb).then((r) => (r.ok ? r.json() : null)).then((d) => {
    ASSETS = d;
    const ctx = $("#as-context");
    if (!d) { ctx.textContent = "asset_rotation.json 없음 — python analysis\\asset_rotation.py 실행 필요"; return; }
    ctx.innerHTML = `<b>🏙 자산시장</b> — 주식만 보면 놓치는 <b>돈의 이동</b>을 봅니다.
      부동산·채권·환율은 <b>한국은행 ECOS</b>, 주가·코인은 yfinance. 2000년 이후 월간 데이터로
      19개 시장의 <b>교차상관(−12~+12개월)</b>을 전수 계산해 선행관계를 추렸습니다.
      <span class="sub-note">${d.generated} 갱신 · 상관은 인과가 아니며 표본이 월 단위라 참고 지표입니다.</span>`;
    asCards(); asPerf(); asLeadTable(); asRealEstate(); asBond(); asFx(); asGold(); asLiq();
    $("#as-liq-mode").querySelectorAll("button").forEach((b) => b.onclick = () => {
      asLiqMode = b.dataset.m;
      $("#as-liq-mode").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      asLiq();
    });
    $("#as-perf-cur").querySelectorAll("button").forEach((b) => b.onclick = () => {
      asPerfCur = b.dataset.c;
      $("#as-perf-cur").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      asPerf();
    });
    $("#as-perf-range").querySelectorAll("button").forEach((b) => b.onclick = () => {
      asPerfYears = +b.dataset.r;
      $("#as-perf-range").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      asPerf();
    });
    $("#as-fx-mode").querySelectorAll("button").forEach((b) => b.onclick = () => {
      asFxMode = b.dataset.m;
      $("#as-fx-mode").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      asFx();
    });
    $("#as-gold-mode").querySelectorAll("button").forEach((b) => b.onclick = () => {
      asGoldMode = b.dataset.m;
      $("#as-gold-mode").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      asGold();
    });
    $("#as-re-mode").querySelectorAll("button").forEach((b) => b.onclick = () => {
      asReMode = b.dataset.m;
      $("#as-re-mode").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      asRealEstate();
    });
    $("#as-bond-mode").querySelectorAll("button").forEach((b) => b.onclick = () => {
      asBondMode = b.dataset.m;
      $("#as-bond-mode").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      asBond();
    });
  });
}

/* 📊 자산군 성과 비교(v269) — "어느 시장이 어느 시장을 앞섰나"(로테이션)와 별개로,
   **실제로 어느 자산이 돈을 벌어줬나**를 같은 기간·같은 출발점(100)에서 비교한다.
   ⚠해외 자산을 현지 통화로 보면 한국 투자자의 실제 수익이 아니다 → 기본은 **원/달러로 환산**.
     (엔·유로 표시 자산은 없어 달러 환산만으로 충분하다. 부동산·코스피는 이미 원화.) */
let asPerfCur = "krw", asPerfYears = 5;
const AS_PERF = [
  { k: "kospi", ko: "코스피", usd: false, c: "#f5445a" },
  { k: "sp500", ko: "S&P500", usd: true, c: "#4391ff" },
  { k: "nasdaq", ko: "나스닥", usd: true, c: "#38bdf8" },
  { k: "apt_kr", ko: "전국 아파트", usd: false, c: "#22c07a" },
  { k: "apt_se", ko: "서울 아파트", usd: false, c: "#a3e635" },
  { k: "gold", ko: "금", usd: true, c: "#f0b34c" },
  { k: "btc", ko: "비트코인", usd: true, c: "#fb923c" },
  { k: "usdkrw", ko: "원/달러", usd: false, c: "#9d7bff" },
];

function asPerf() {
  const host = $("#as-perf"), tbl = $("#as-perf-tbl");
  if (!host) return;
  const fx = asS("usdkrw");
  const fxAt = fx ? Object.fromEntries(fx.t.map((m, i) => [m, fx.v[i]])) : {};
  const last = asS("kospi")?.t.slice(-1)[0] || "";
  // 기간 시작 월(0=전 구간)
  const from = asPerfYears
    ? `${(+last.slice(0, 4) - asPerfYears)}-${last.slice(5, 7)}` : "2000-01";

  const defs = [], rows = [];
  AS_PERF.forEach((a) => {
    const s = asS(a.k);
    if (!s) return;
    const idx = s.t.map((m, i) => i).filter((i) => s.t[i] >= from && s.v[i] != null);
    if (idx.length < 6) return;
    // 원화 환산: 달러 표시 자산 × 원/달러(해당 월). 환율이 없는 달은 건너뛴다.
    const conv = (i) => {
      const v = s.v[i];
      if (!(asPerfCur === "krw" && a.usd)) return v;
      const r = fxAt[s.t[i]];
      return r ? v * r : null;
    };
    const tt = [], vv = [];
    idx.forEach((i) => { const v = conv(i); if (v != null) { tt.push(s.t[i]); vv.push(v); } });
    if (vv.length < 6) return;
    const base = vv[0];
    defs.push({ name: a.ko, color: a.c, t: tt, v: vv.map((x) => x / base * 100) });
    const yrs = Math.max(0.5, (tt.length - 1) / 12);
    const tot = vv[vv.length - 1] / base - 1;
    rows.push({ ko: a.ko, c: a.c, tot, cagr: Math.pow(1 + tot, 1 / yrs) - 1,
                from: tt[0], to: tt[tt.length - 1] });
  });
  if (!defs.length) { host.innerHTML = `<p class="mini-note">데이터 없음</p>`; return; }
  asLines("#as-perf", defs, { fmt: (v) => v.toFixed(0), h: 330 });

  rows.sort((a, b) => b.tot - a.tot);
  const pc = (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
  const span = rows[0] ? `${rows[0].from} ~ ${rows[0].to}` : "";
  tbl.innerHTML = `<table class="as-perf-t"><thead><tr>
      <th>자산</th><th>누적</th><th>연평균</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td><i style="background:${r.c}"></i>${r.ko}</td>
      <td class="${r.tot >= 0 ? "kup" : "kdn"}">${pc(r.tot)}</td>
      <td class="${r.cagr >= 0 ? "kup" : "kdn"}">${pc(r.cagr)}</td></tr>`).join("")}
    </tbody></table>
    <p class="sub-note">${span} 월말 기준 ·
      ${asPerfCur === "krw" ? "해외 자산은 <b>원/달러 환산</b>(환차손익 포함)" : "각 자산의 <b>현지 통화</b> 기준"} ·
      배당·임대수익 제외한 <b>가격 수익</b>. 부동산은 KB 가격지수라 거래비용·보유세가 빠져 있습니다.</p>`;
}

/* 💧 유동성·물가(v269) — M2는 수집만 하고 화면에 없었다.
   증가율: 통화량이 자산가격보다 먼저 움직이는지 보기 위한 것(로테이션 표와 짝).
   실질금리 = 국고채 10년 − 소비자물가 상승률. **마이너스면 현금이 손해**라 위험자산·부동산으로 돈이 민다. */
let asLiqMode = "growth";
function asLiq() {
  const KO = ASSETS.names_ko || {}, leg = $("#as-liq-legend");
  const yoy = (k, ko, color) => {
    const s = asS(k);
    if (!s) return null;
    const v = s.v.map((x, i) => (i >= 12 && s.v[i - 12] ? (x / s.v[i - 12] - 1) * 100 : null));
    const keep = v.map((_, i) => i).filter((i) => v[i] != null);
    return { name: ko, color, t: keep.map((i) => s.t[i]), v: keep.map((i) => v[i]) };
  };
  let defs, opt = { zero: true, fmt: (v) => v.toFixed(1) + "%", from: "2005-01" }, note;
  if (asLiqMode === "growth") {
    defs = [yoy("m2", "M2 통화량", "#4391ff"), yoy("cpi", "소비자물가", "#f5445a"),
            yoy("apt_kr", "전국 아파트", "#22c07a")].filter(Boolean);
    note = "전년 같은 달 대비 증가율. <b>통화량이 물가·집값보다 먼저 방향을 트는지</b> 보는 그림입니다.";
  } else {
    const b = asS("bond10"), c = asS("cpi");
    if (!b || !c) { $("#as-liq").innerHTML = `<p class="mini-note">데이터 없음</p>`; return; }
    const cAt = Object.fromEntries(c.t.map((m, i) => [m, i]));
    const t = [], v = [];
    b.t.forEach((m, i) => {
      const ci = cAt[m];
      if (ci == null || ci < 12 || !c.v[ci - 12]) return;
      const infl = (c.v[ci] / c.v[ci - 12] - 1) * 100;
      t.push(m); v.push(b.v[i] - infl);
    });
    defs = [{ name: "실질금리(국고10년−물가)", color: "#f0b34c", t, v },
            { name: "국고채 10년", color: "#9aa4b2", t: b.t, v: b.v, dash: "3 3", w: 1.4 }];
    note = "실질금리가 <b>0 아래</b>면 예금·채권으로 물가를 못 이깁니다 — 돈이 주식·부동산·금으로 미는 국면입니다.";
  }
  leg.innerHTML = defs.map((d) => `<span class="cr-chip" style="cursor:default">
    <i style="background:${d.color}"></i>${d.name}</span>`).join("")
    + `<span class="sub-note">${note}</span>`;
  asLines("#as-liq", defs, { ...opt, h: 300 });
  void KO;
}

function asCards() {
  const card = (t, v, sub, cls) => `<div class="cr-card"><div class="sub-note">${t}</div>
    <b class="${cls || ""}">${v}</b><span class="sub-note">${sub}</span></div>`;
  const cs = asLast("credit_spread"), cs1 = asPrev("credit_spread");
  const ts = asLast("term_spread");
  const b3 = asLast("bond3"), b10 = asLast("bond10");
  const apt = asLast("apt_kr"), apt1 = asPrev("apt_kr"), aptY = asPrev("apt_kr", 12);
  const fx = asLast("usdkrw");
  const pc = (a, b) => (a == null || b == null ? "-" : `${a - b >= 0 ? "+" : ""}${((a / b - 1) * 100).toFixed(2)}%`);
  $("#as-cards").innerHTML =
    card("신용 스프레드", cs == null ? "-" : cs.toFixed(2) + "%p",
         `회사채 BBB− − 국고 3년 · 전월 ${cs1 == null ? "-" : (cs - cs1 >= 0 ? "+" : "") + (cs - cs1).toFixed(2) + "%p"}`,
         cs1 != null && cs > cs1 ? "kdn" : "kup") +
    card("장단기 스프레드", ts == null ? "-" : ts.toFixed(2) + "%p",
         `국고 10년 − 3년 ${ts < 0 ? "· ⚠ 역전" : ""}`, ts < 0 ? "kdn" : "") +
    card("국고채 3년 / 10년", b3 == null ? "-" : `${b3.toFixed(2)} / ${b10?.toFixed(2)}%`, "월말 기준") +
    card("전국 아파트", apt == null ? "-" : apt.toFixed(1),
         `전월 ${pc(apt, apt1)} · 전년 ${pc(apt, aptY)}`, apt > apt1 ? "kup" : "kdn") +
    card("원/달러", fx == null ? "-" : Math.round(fx).toLocaleString() + "원", "월말 기준");
}

/* 시장 간 관계 — 코스피를 종속변수로 고정한 뷰가 기본(주식에 영향을 주는 변수를 보려는 목적) */
let asLeadMode = "kospi";
const AS_KIND = { lead: ["선행", "#22c07a", "이 변수가 먼저 움직인 뒤 코스피가 따라옴 — 예측에 쓸 수 있는 신호"],
                  sync: ["동행", "#4391ff", "같은 달에 함께 움직임 — 같은 요인에 반응(예측이 아니라 확인용)"],
                  lag: ["후행", "#9aa4b2", "코스피가 먼저 움직인 뒤 이 변수가 따라옴"] };
function asLeadTable() {
  const KO = ASSETS.names_ko || {};
  const host = $("#as-lead");
  const src = asLeadMode === "kospi" ? (ASSETS.to_kospi || [])
    : asLeadMode === "from-kospi" ? (ASSETS.from_kospi || [])
    : (ASSETS.lead || []).map((x) => ({ ...x, kind: "lead" }));
  const rows = src.slice(0, 20);
  const bindMode = () => $("#as-lead-mode")?.querySelectorAll("button").forEach((b) => b.onclick = () => {
    asLeadMode = b.dataset.m;
    $("#as-lead-mode").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
    asLeadTable();
  });
  if (!rows.length) { host.innerHTML = `<p class="mini-note">유의한 관계 없음</p>`; bindMode(); return; }
  const note = asLeadMode === "kospi"
    ? `<b>코스피(종속변수)</b>에 유의한 관계가 있는 변수입니다. 주가는 정보를 빨리 반영해
       <b>선행하는 변수가 드물고</b>(4건) 대부분 <b>동행</b>합니다 — 동행 지표는 예측이 아니라
       <b>'지금 무슨 일이 벌어지는지' 확인</b>하는 데 씁니다.`
    : asLeadMode === "from-kospi"
    ? `<b>코스피(독립변수)</b>가 앞서 움직인 뒤 따라온 시장입니다. 주식이 다른 자산의 선행지표 역할을 합니다.`
    : `전체 시장 쌍 중 <b>선행관계</b>가 유의한 것만 상관 강한 순으로.`;
  host.innerHTML = `<p class="mini-note">${note}<br>
      막대가 길수록 관계가 강하고, <span style="color:#f5445a">붉은색</span>은 <b>반대 방향</b>(하나가 오르면 다른 하나는 내림)입니다.</p>
    <div class="as-lead">${rows.map((x) => {
      const neg = x.r < 0, w = Math.min(100, Math.abs(x.r) * 130);
      const [kLab, kCol, kTip] = AS_KIND[x.kind || "lead"];
      // 항상 '왼쪽(먼저) → 오른쪽(나중)' 순서로 읽히게 배치
      const nm = (k) => KO[k] || k;
      const [lft, rgt] = x.lag > 0 ? [nm(x.from), nm(x.to)]
        : x.lag < 0 ? [nm(x.to), nm(x.from)]          // 후행이면 실제로는 뒤쪽이 먼저 움직인 것
        : [nm(x.from), nm(x.to)];
      return `<div class="as-lrow" title="${kTip}">
        <span class="as-lfrom">${lft}</span>
        <span class="as-larrow"><i class="as-kind" style="color:${kCol}">${kLab}</i>
          ${x.lag ? `<b>${Math.abs(x.lag)}개월</b>` : ""}</span>
        <span class="as-lto">${rgt}</span>
        <span class="as-lbar"><i style="width:${w}%;background:${neg ? "#f5445a" : "#22c07a"}"></i></span>
        <span class="as-lr ${neg ? "neg" : "pos"}">${x.r >= 0 ? "+" : ""}${x.r.toFixed(2)}</span>
        <span class="as-ln sub-note">n=${x.n}</span>
      </div>`;
    }).join("")}</div>`;
  bindMode();
}

function asRealEstate() {
  const KO = ASSETS.names_ko || {};
  const leg = $("#as-re-legend");
  let defs = [], opt = { fmt: (v) => v.toFixed(1) };
  if (asReMode === "index") {
    defs = ["apt_kr", "apt_se", "jeonse_kr", "jeonse_se"].filter(asS)
      .map((k) => ({ name: KO[k], t: asS(k).t, v: asS(k).v }));
    opt.fmt = (v) => v.toFixed(0);
  } else if (asReMode === "yoy") {
    defs = ["apt_kr", "apt_se", "jeonse_kr"].filter(asS).map((k) => {
      const s = asS(k), v = s.v.map((x, i) => (i >= 12 && s.v[i - 12] ? (x / s.v[i - 12] - 1) * 100 : null));
      const keep = v.map((x, i) => i).filter((i) => v[i] != null);
      return { name: KO[k], t: keep.map((i) => s.t[i]), v: keep.map((i) => v[i]) };
    });
    defs.push(...["land_kr", "land_se"].filter(asS).map((k) => ({
      name: KO[k] + "(월)", t: asS(k).t, v: asS(k).v, dash: "3 3", w: 1.4 })));
    opt.zero = true; opt.fmt = (v) => v.toFixed(1) + "%";
  } else {
    defs = ["permit", "constr"].filter(asS).map((k) => {
      const s = asS(k);   // 수량 단위가 달라 12개월 이동평균으로 정규화(첫 값=100)
      const ma = s.v.map((_, i) => i < 11 ? null : s.v.slice(i - 11, i + 1).reduce((a, b) => a + b, 0) / 12);
      const base = ma.find((x) => x != null) || 1;
      const keep = ma.map((x, i) => i).filter((i) => ma[i] != null);
      return { name: KO[k] + " 12개월평균", t: keep.map((i) => s.t[i]), v: keep.map((i) => ma[i] / base * 100) };
    });
    opt.fmt = (v) => v.toFixed(0);
  }
  leg.innerHTML = defs.map((d, i) => `<span class="cr-chip" style="cursor:default">
    <i style="background:${AS_COLORS[i % 7]}"></i>${d.name}</span>`).join("") +
    (asReMode === "supply" ? `<span class="sub-note">첫 시점=100으로 맞춘 상대 추이(단위가 달라 직접 비교 불가)</span>` : "");
  asLines("#as-re", defs, { ...opt, from: "2005-01", h: 300 });
}

/* 💱 환율 — 원화 대비 통화 / 달러·유로 지수 / 원화 강약
   ⚠원/달러가 오르면 '원화 약세'다. 방향을 헷갈리기 쉬워 화면에 항상 병기한다. */
let asFxMode = "krw";
const AS_FX_KRW = ["usdkrw", "jpykrw", "eurkrw", "cnykrw", "gbpkrw", "audkrw", "chfkrw", "twdkrw"];
function asFx() {
  const KO = ASSETS.names_ko || {}, leg = $("#as-fx-legend");
  let defs, opt, note = "";
  if (asFxMode === "krw") {
    // 통화마다 자릿수가 달라(엔 900원대·달러 1,400원대) 같은 축에 그리면 안 보인다 → 지수화
    defs = AS_FX_KRW.filter(asS).map((k) => {
      const s = asS(k), i0 = s.t.findIndex((d) => d >= "2016-01");
      const base = s.v[i0 >= 0 ? i0 : 0] || 1;
      return { name: KO[k] || k, t: s.t.slice(i0), v: s.v.slice(i0).map((x) => x / base * 100) };
    });
    opt = { fmt: (v) => v.toFixed(0), from: "2016-01" };
    note = `2016년 1월=100으로 맞춘 지수. <b>선이 올라가면 그 통화가 비싸진 것 = 원화 약세</b>입니다.`;
  } else if (asFxMode === "index") {
    defs = ["dxy", "eurusd"].filter(asS).map((k) => {
      const s = asS(k), i0 = s.t.findIndex((d) => d >= "2016-01");
      const base = s.v[i0 >= 0 ? i0 : 0] || 1;
      return { name: KO[k] || k, t: s.t.slice(i0), v: s.v.slice(i0).map((x) => x / base * 100) };
    });
    opt = { fmt: (v) => v.toFixed(0), from: "2016-01" };
    note = `<b>달러인덱스</b>는 주요 6개 통화 대비 달러 가치. <b>유로/달러</b>는 유로 강세일수록 올라갑니다
      (자유롭게 받을 수 있는 '유로인덱스'가 없어 유로/달러로 대신합니다). 둘은 대체로 반대로 움직입니다.`;
  } else {
    // 원화 강약: 주요 통화 대비 원화 가치의 평균(원/X 지수의 역수) — 실효환율 근사
    const base = {}, ts = [];
    AS_FX_KRW.filter(asS).forEach((k) => {
      const s = asS(k), i0 = s.t.findIndex((d) => d >= "2016-01");
      const b0 = s.v[i0 >= 0 ? i0 : 0] || 1;
      s.t.slice(i0).forEach((d, i) => {
        (base[d] = base[d] || []).push(s.v[i0 + i] / b0);
      });
    });
    Object.keys(base).sort().forEach((d) => { if (base[d].length >= 4) ts.push(d); });
    // ⚠코스피를 같은 축에 얹으면 배율 차이(코스피 350 vs 원화 83)로 원화 선이 눌려 안 보인다 → 제외
    defs = [{ name: "원화 가치", t: ts, v: ts.map((d) => 100 / (base[d].reduce((a, b) => a + b, 0) / base[d].length)) }];
    opt = { fmt: (v) => v.toFixed(0), from: "2016-01" };
    note = `주요 8개 통화 대비 원화 가치의 평균(2016-01=100, <b>올라가면 원화 강세</b>) — 실효환율 근사.
      코스피를 겹쳐보면 <b>원화 강세 구간에 주가가 강한 경향</b>이 보입니다(원/달러 vs 코스피 동행 r=−0.34).`;
  }
  leg.innerHTML = defs.map((d, i) => `<span class="cr-chip" style="cursor:default">
    <i style="background:${AS_COLORS[i % 7]}"></i>${d.name}</span>`).join("") + `<span class="sub-note">${note}</span>`;
  asLines("#as-fx", defs, { ...opt, h: 300 });
}

/* 🥇 금·귀금속 ↔ 증시 */
let asGoldMode = "trend";
function asGold() {
  const KO = ASSETS.names_ko || {}, leg = $("#as-gold-legend"), host = $("#as-gold");
  if (asGoldMode === "trend") {
    const defs = ["gold", "silver", "kospi", "sp500"].filter(asS).map((k) => {
      const s = asS(k), i0 = s.t.findIndex((d) => d >= "2016-01"), b0 = s.v[i0] || 1;
      return { name: KO[k] || k, t: s.t.slice(i0), v: s.v.slice(i0).map((x) => x / b0 * 100),
               dash: (k === "kospi" || k === "sp500") ? "4 3" : null };
    });
    leg.innerHTML = defs.map((d, i) => `<span class="cr-chip" style="cursor:default">
      <i style="background:${AS_COLORS[i % 7]}"></i>${d.name}</span>`).join("") +
      `<span class="sub-note">2016-01=100. 점선=주가지수 — 금이 주식과 <b>같이 갈 때(유동성 장세)</b>와
       <b>엇갈릴 때(위험회피)</b>가 구분됩니다.</span>`;
    asLines("#as-gold", defs, { fmt: (v) => v.toFixed(0), from: "2016-01", h: 300 });
    return;
  }
  // 관계 표 — 금·은이 증시와 어떤 시차·방향으로 엮이는지
  leg.innerHTML = "";
  const KIND = { lead: ["선행", "#22c07a"], sync: ["동행", "#4391ff"], lag: ["후행", "#9aa4b2"] };
  const rows = [...(ASSETS.to_kospi || []), ...(ASSETS.from_kospi || []), ...(ASSETS.lead || [])]
    .filter((x) => x.from === "gold" || x.to === "gold" || x.from === "silver" || x.to === "silver");
  const seen = new Set();
  const uniq = rows.filter((x) => {
    const k = [x.from, x.to].sort().join("|");   // 양방향 중복(A>B, B>A) 제거
    if (seen.has(k)) return false; seen.add(k); return true;
  }).sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).slice(0, 14);
  host.innerHTML = uniq.length ? `<div class="as-lead">${uniq.map((x) => {
      const neg = x.r < 0, w = Math.min(100, Math.abs(x.r) * 130);
      const [kLab, kCol] = KIND[x.kind || "lead"];
      const [lft, rgt] = x.lag >= 0 ? [KO[x.from] || x.from, KO[x.to] || x.to]
                                    : [KO[x.to] || x.to, KO[x.from] || x.from];
      return `<div class="as-lrow">
        <span class="as-lfrom">${lft}</span>
        <span class="as-larrow"><i class="as-kind" style="color:${kCol}">${kLab}</i>
          ${x.lag ? `<b>${Math.abs(x.lag)}개월</b>` : ""}</span>
        <span class="as-lto">${rgt}</span>
        <span class="as-lbar"><i style="width:${w}%;background:${neg ? "#f5445a" : "#22c07a"}"></i></span>
        <span class="as-lr ${neg ? "neg" : "pos"}">${x.r >= 0 ? "+" : ""}${x.r.toFixed(2)}</span>
        <span class="as-ln sub-note">n=${x.n}</span></div>`;
    }).join("")}</div>
    <p class="mini-note">금은 <b>코스피와 동행(+0.18)</b>합니다 — 흔한 오해와 달리 '주식이 빠지면 금이 오른다'가
      항상 성립하지는 않습니다. 유동성이 풀리면 금·주식이 <b>같이</b> 오르고, 진짜 위기에는 금만 오릅니다.
      금이 국고채·비트코인을 몇 개월 선행하는 관계도 함께 보세요.</p>`
    : `<p class="mini-note">유의한 관계 없음</p>`;
}

function asBond() {
  const KO = ASSETS.names_ko || {};
  const leg = $("#as-bond-legend");
  let defs, opt = { fmt: (v) => v.toFixed(2) + "%" };
  if (asBondMode === "yield") {
    defs = ["bond1", "bond3", "bond10", "corp3"].filter(asS)
      .map((k) => ({ name: KO[k], t: asS(k).t, v: asS(k).v }));
  } else {
    defs = ["term_spread", "credit_spread"].filter(asS)
      .map((k) => ({ name: KO[k], t: asS(k).t, v: asS(k).v }));
    opt.zero = true; opt.fmt = (v) => v.toFixed(2) + "%p";
  }
  leg.innerHTML = defs.map((d, i) => `<span class="cr-chip" style="cursor:default">
    <i style="background:${AS_COLORS[i % 7]}"></i>${d.name}</span>`).join("") +
    (asBondMode === "spread"
      ? `<span class="sub-note">장단기 = 국고 10년−3년(경기) · 신용 = 회사채 BBB−−국고 3년(위험선호). 벌어지면 위험회피</span>` : "");
  asLines("#as-bond", defs, { ...opt, from: "2005-01", h: 300 });
}

/* ---------- 트렌드 레이더 (trends.json — 네이버 데이터랩+구글 급상승) ---------- */
let trendsRendered = false, TRENDS = null, trGeo = "kr";

function trGoto(code) {
  gotoTabFull("lookup");
  if (!lookupRendered) initLookup();
  loadLookup(`kr_${code}`);
}

function trSpark(weekly, d30, w, h) {
  // 주간(1년) + 최근 30일 일간 이어붙인 스파크라인
  const pts = (weekly || []).map((x) => x[1]).concat((d30 || []).map((x) => x[1]));
  if (pts.length < 5) return "";
  const max = Math.max(...pts, 1), min = Math.min(...pts, 0);
  const xs = (i) => (i / (pts.length - 1)) * w;
  const ys = (v) => h - 3 - ((v - min) / (max - min || 1)) * (h - 8);
  const line = pts.map((v, i) => `${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px">
    <polyline points="${line}" fill="none" stroke="#4391ff" stroke-width="1.6"/>
    <circle cx="${xs(pts.length - 1)}" cy="${ys(pts[pts.length - 1])}" r="2.5" fill="#f5445a"/></svg>`;
}

// 1·3개월 트렌드 변동 AI 큐레이션 — 헤드라인 + 부상/위축 테마 + 워치포인트
function renderTrCuration(t) {
  const host = $("#tr-curation");
  const c = t?.curation;
  if (!host) return;
  if (!c || (!c.headline && !c.rising?.length)) { host.style.display = "none"; return; }
  host.style.display = "";
  const esc = (s) => String(s ?? "").replace(/</g, "&lt;");
  const st = c.stats || {};
  const card = (r, kind) => `<div class="trc-item ${kind}">
    <div class="trc-theme">${kind === "up" ? "▲" : "▼"} ${esc(r.theme)}</div>
    <div class="trc-why">${esc(r.why)}</div>
    ${r.stocks ? `<div class="trc-stocks">관련: ${esc(r.stocks)}</div>` : ""}</div>`;
  host.innerHTML = `<div class="card-flat trc-wrap">
    <div class="trc-head"><b>🤖 이번 달 트렌드 큐레이션</b>
      <span class="sub-note">1·3개월 검색·쇼핑 변동을 AI가 요약 · ${c.generated || t.generated}
        ${st.arch_days ? ` · 누적 ${st.arch_days}일` : ""}</span></div>
    ${c.headline ? `<p class="trc-headline">${esc(c.headline)}</p>` : ""}
    <div class="trc-grid">
      ${(c.rising || []).map((r) => card(r, "up")).join("")}
      ${(c.fading || []).map((r) => card(r, "dn")).join("")}
    </div>
    ${c.watch ? `<p class="trc-watch">🔎 <b>주목</b> — ${esc(c.watch)}</p>` : ""}
    <p class="sub-note" style="margin:6px 0 0">배율=최근 30일 ÷ 직전 구간 평균 · AI 요약은 참고용(투자 권유 아님)</p>
  </div>`;
}

let trSrc = "naver", trBucket = "all";
let trSetWlTs = () => {};   // 워치리스트 갱신시각 표기(소스 토글 시 네이버↔위키 전환)
// 급등 구간(모집단=워치리스트 전체, r7 기준)
const TR_BUCKETS = [
  ["all", "전체", () => true],
  ["b15", "🔥 ×1.5 이상", (r) => r >= 1.5],
  ["b12", "×1.2~1.5", (r) => r >= 1.2 && r < 1.5],
  ["b10", "×1.0~1.2", (r) => r >= 1.0 && r < 1.2],
  ["b00", "×1.0 미만", (r) => r < 1.0],
];

function drawTrWatchlist() {
  const esc = (s) => String(s ?? "").replace(/</g, "&lt;");
  const t = TRENDS;
  const isWiki = trSrc === "wiki";
  const wl = (isWiki ? t.watchlist_g : t.watchlist) || [];
  $("#tr-wl-note").textContent = isWiki
    ? "(영문 위키 문서 일간 조회수 · 글로벌 관심 프록시 · 급등=최근 7일 ÷ 이전 8주)"
    : "(네이버 검색량 상대지수 1년 · 급등=최근 7일 ÷ 이전 8주)";
  if (!wl.length) {
    $("#tr-filter").innerHTML = "";
    $("#tr-watchlist").innerHTML = isWiki
      ? `<div class="card-flat"><p class="mini-note">글로벌(위키) 데이터 없음 — 다음 갱신을 기다려 주세요.</p></div>`
      : `<div class="card-flat"><p class="mini-note">
        네이버 데이터랩 미연결 — <b>developers.naver.com</b>의 내 애플리케이션에서
        <b>'데이터랩(검색어트렌드)'와 '데이터랩(쇼핑인사이트)' API를 추가</b>하면 다음 갱신부터 표시됩니다.<br>
        워치리스트 키워드 추가·수정은 <code>data\\trend_watchlist.json</code> 편집(Claude에게 "트렌드 키워드에 ○○ 추가해줘").</p></div>`;
    return;
  }
  // 구간 필터 칩(전체 모집단 기준 건수 병기)
  const r7 = (w) => w.surge?.r7 ?? -1;
  $("#tr-filter").innerHTML = TR_BUCKETS.map(([id, lab, fn]) => {
    const n = wl.filter((w) => fn(r7(w))).length;
    return `<button class="tr-bucket ${trBucket === id ? "active" : ""}" data-b="${id}">${lab} <span class="sub-note">${n}</span></button>`;
  }).join("");
  $("#tr-filter").querySelectorAll(".tr-bucket").forEach((b) => b.onclick = () => { trBucket = b.dataset.b; drawTrWatchlist(); });
  const fn = TR_BUCKETS.find(([id]) => id === trBucket)[2];
  const shown = wl.filter((w) => fn(r7(w))).sort((a, b) => r7(b) - r7(a));  // 급등 높은 순
  const badge = (r) => r == null ? "" : `<span class="tr-surge ${r >= 1.5 ? "hot" : r >= 1.1 ? "warm" : ""}">×${r.toFixed(1)}</span>`;
  $("#tr-watchlist").innerHTML = shown.length ? `<div class="tr-wgrid">` + shown.map((w0) => `
    <div class="card-flat tr-wcard">
      <div class="tr-whead"><b>${esc(w0.kw)}</b>${badge(w0.surge?.r7)}
        ${isWiki && w0.wiki ? `<a class="sub-note" href="https://en.wikipedia.org/wiki/${w0.wiki}" target="_blank" rel="noopener">${esc(w0.wiki.replace(/_/g, " "))}</a>` : ""}
        <span class="sub-note" style="margin-left:auto">${esc(w0.memo)}</span></div>
      ${trSpark(w0.w, w0.d30, 300, 54)}
      <div class="tr-wstocks">${(w0.stocks || []).map((s) =>
        `<button class="tr-stock" data-c="${s.code}">${esc(s.name)}</button>`).join("")}</div>
    </div>`).join("") + `</div>` : `<p class="mini-note">이 구간에 해당하는 키워드가 없습니다.</p>`;
  $("#tr-watchlist").querySelectorAll(".tr-stock").forEach((b) => b.onclick = () => trGoto(b.dataset.c));
}

function renderTrends() {
  trendsRendered = true;
  const esc = (s) => String(s ?? "").replace(/</g, "&lt;");
  fetch("data/trends.json" + _cb).then((r) => (r.ok ? r.json() : null)).then((t) => {
    TRENDS = t;
    if (!t) {
      $("#tr-context").textContent = "trends.json 없음 — python analysis\\trend_radar.py 실행 필요";
      return;
    }
    // 1·3개월 트렌드 변동 AI 큐레이션
    renderTrCuration(t);

    // 섹션별 갱신 시점(소스별 실제 수집 시각) — 없으면 파일 생성시각 폴백
    const tsOf = (k) => t.ts?.[k] || t.generated;
    const tsTxt = (k) => { const v = tsOf(k); return v ? `${relTime(v)} 갱신 · ${v}` : ""; };
    const setTs = (id, k) => { const el = document.getElementById(id); if (el) el.textContent = tsTxt(k); };
    setTs("tr-ts-google", "google");
    setTs("tr-ts-shop", "shopping");
    setTs("tr-ts-amz", "amazon");
    trSetWlTs = () => setTs("tr-ts-wl", trSrc === "wiki" ? "wiki" : "watchlist");
    trSetWlTs();

    $("#tr-context").innerHTML = `<b>트렌드 레이더</b> — 검색 데이터로 소비 트렌드를 선제 포착해 관련주와 연결합니다.
      ${t.generated} 갱신(하루 1회) · 네이버 지수는 <b>상대값</b>(기간 내 최대=100, 절대 검색량 아님) ·
      구글 급상승은 순위성 데이터 · 관련주 연결은 참고용(투자 판단 아님) · 틱톡·인스타는 공식 API 부재로 미지원`;

    // ① 구글 급상승
    const drawGoogle = () => {
      const list = t.google?.[trGeo] || [];
      $("#tr-google").innerHTML = list.length ? `<div class="tr-glist">` + list.map((g, i) => `
        <div class="tr-gitem">
          <span class="tr-rank">${i + 1}</span>
          <div class="tr-gbody">
            <div class="tr-gq">${esc(g.q)} <span class="tr-traffic">${esc(g.traffic)}</span>
              ${(g.stocks || []).map((s) => `<button class="tr-stock" data-c="${s.code}">📈 ${esc(s.name)}</button>`).join("")}</div>
            ${g.news ? `<a class="tr-gnews" href="${g.link}" target="_blank" rel="noopener">${esc(g.news)}</a>` : ""}
          </div>
        </div>`).join("") + `</div>`
        : `<p class="mini-note">급상승 데이터 없음</p>`;
      $("#tr-google").querySelectorAll(".tr-stock").forEach((b) => b.onclick = () => trGoto(b.dataset.c));
    };
    drawGoogle();
    $("#tr-geo").querySelectorAll("button").forEach((b) => b.onclick = () => {
      trGeo = b.dataset.g;
      $("#tr-geo").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      drawGoogle();
    });

    // ② 워치리스트 — 소스 토글(네이버/글로벌 위키) + 급등 구간 필터 + r7 내림차순
    drawTrWatchlist();
    $("#tr-src").querySelectorAll("button").forEach((b) => b.onclick = () => {
      trSrc = b.dataset.s;
      $("#tr-src").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      drawTrWatchlist();
      trSetWlTs();   // 네이버↔위키 전환 시 갱신시각도 해당 소스로
    });

    // ④ 아마존 베스트셀러
    const az = t.amazon || [];
    $("#tr-amazon").innerHTML = az.length ? `<div class="tr-azgrid">` + az.map((c) => `
      <div class="card-flat tr-azcard">
        <div class="tr-azhead"><b>${esc(c.cat)}</b></div>
        ${(c.items || []).slice(0, 8).map((it) =>
          `<a class="tr-azrow" href="${it.link}" target="_blank" rel="noopener">
            <span class="tr-azrank">${it.rank}</span><span class="tr-aztitle">${esc(it.title)}</span></a>`).join("")}
      </div>`).join("") + `</div>` : `<div class="card-flat"><p class="mini-note">아마존 데이터 없음 — 다음 갱신을 기다려 주세요.</p></div>`;

    // ③ 쇼핑 카테고리
    const sh = t.shopping || [];
    $("#tr-shopping").innerHTML = sh.length ? sh.map((c) => {
      const w = Math.min(100, Math.max(4, (c.r4 - 0.5) * 100));
      const kws = (c.top || []).map((k, i) =>
        `<span class="tr-shkw${i < 3 ? " top3" : ""}">${i + 1} ${esc(k)}</span>`).join("");
      return `<div class="tr-shrow"><span class="tr-shname">${esc(c.cat)}</span>
        <div class="tr-shbar"><span style="width:${w}%" class="${c.r4 >= 1.15 ? "hot" : c.r4 >= 1 ? "" : "cold"}"></span></div>
        <b class="${c.r4 >= 1.15 ? "pos" : c.r4 < 0.95 ? "neg" : ""}">×${c.r4?.toFixed(2)}</b></div>
        ${kws ? `<div class="tr-shkws">${kws}</div>` : ""}`;
    }).join("") : `<p class="mini-note">네이버 데이터랩 연결 후 표시됩니다.</p>`;
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
  { ks: ["frgn20", "inst20", "indi20"], cs: ["#4391ff", "#ea580c", "#22c07a"],
    labs: ["외국인", "기관", "개인"], base: 0, mk: "kr",
    t: "투자자별 20일 누적 순매수(억원)",
    n: "수급 주체 방향 — 셋의 합은 0에 가깝다(한쪽이 사면 다른 쪽이 판다). " +
       "<span class='sub-note'>네이버 수급 데이터 · <b>개인은 −(외국인+기관)으로 유도</b>(기타법인 제외, 오차 1~2%) · 노트북 배치라 갱신 주기가 김</span>" },
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
  // 대상 유니버스를 명시 — "한국이 코스피인가 코스닥인가"라는 질문이 나왔다(둘을 합친 거래대금 상위다)
  $("#int-context").innerHTML =
    `시장 내부(internals) — 지수가 아니라 <b>구성 종목 전체의 체력</b>을 봅니다.
     <b>🇰🇷 한국 = 코스피·코스닥을 합친 거래대금 상위 300종목</b>(특정 지수가 아님 · 거래가 거의 없는
     종목은 시장폭을 왜곡해 제외) · <b>🇺🇸 미국 = 수집 유니버스 전체</b>.
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
  /* 분류 기준 = **주식찾기와 동일한 12산업군**(rot.groups). 원천 업종은 산업군을 펼쳤을 때
     그 안의 세부로만 보여준다. (예전엔 여기만 업종 77개를 써서 주식찾기와 산업이 어긋났다) */
  const groups = rot.groups || [];
  const secByGrp = {};
  (rot.sectors || []).forEach((s) => (secByGrp[s.grp || "etc"] = secByGrp[s.grp || "etc"] || []).push(s));
  const mcapByGrp = {};
  (MARKET?.heatmap || []).filter((t) => t.m === mk).forEach((t) => {
    const g = t.grp || "etc";
    if (t.mcap) mcapByGrp[g] = (mcapByGrp[g] || 0) + t.mcap;
  });
  const totMcap = Object.values(mcapByGrp).reduce((a, b) => a + b, 0);
  const part = (v, warnLow) => v == null ? "<td>-</td>" :
    `<td class="${v >= 60 ? "pos" : v < (warnLow ?? 30) ? "neg" : ""}">${v}%</td>`;
  const row = (s, isGrp) => {
    const mc = isGrp ? (mcapByGrp[s.grp] ?? s.mcap) : null;
    const label = isGrp ? `${indLabel(s.grp)}` : `${s.sector}`;
    return `<tr class="${isGrp ? "rot-row rot-grp" : "rot-sub"}" data-grp="${s.grp || ""}"
        data-sector="${isGrp ? "" : s.sector}" title="${isGrp ? "클릭 = 세부 업종 펼치기" : "클릭 = 소속 종목·최신 기사"}">
      <td class="${isGrp ? "" : "rot-indent"}">${isGrp ? "▸ " : "└ "}${label}
        <span class="sub-note">(${s.n})</span></td>
      <td class="scr-r">${mc ? fmtMcap(mc, mk) : ""}</td>
      <td class="scr-r sub-note">${mc && totMcap ? (mc / totMcap * 100).toFixed(1) + "%" : ""}</td>
      ${rsCell(s.w1)}${rsCell(s.m1)}${rsCell(s.m3)}${rsCell(s.rs_w1)}${rsCell(s.rs_m1)}${rsCell(s.rs_m3)}
      ${part(s.up)}${part(s.ma20)}<td>${s.hi52 ?? "-"}</td></tr>`;
  };
  $("#rot-table").innerHTML =
    `<tr><th>산업군 (종목수)</th><th class="scr-r">시가총액</th><th class="scr-r">비중</th><th>1주</th><th>1개월</th><th>3개월</th>
       <th>RS 1주</th><th>RS 1개월</th><th>RS 3개월</th><th>오늘 상승</th><th>20일선 위</th><th>52주 신고</th></tr>
     <tr style="font-weight:700"><td>시장 전체</td><td class="scr-r">${totMcap ? fmtMcap(totMcap, mk) : "-"}</td><td class="scr-r">100%</td>
       ${rsCell(m.w1)}${rsCell(m.m1)}${rsCell(m.m3)}<td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td></tr>` +
    groups.map((g) => row(g, true)).join("");
  // 산업군 클릭 → 그 아래에 세부 업종 행 삽입/제거(다시 클릭하면 접힘)
  document.querySelectorAll("#rot-table .rot-grp").forEach((tr) => tr.addEventListener("click", () => {
    const g = tr.dataset.grp;
    const opened = tr.nextElementSibling?.classList.contains("rot-sub");
    while (tr.nextElementSibling?.classList.contains("rot-sub")) tr.nextElementSibling.remove();
    while (tr.nextElementSibling?.classList.contains("rot-members")) tr.nextElementSibling.remove();
    if (opened) return;
    const subs = (secByGrp[g] || []).slice().sort((a, b) => b.n - a.n);
    subs.reverse().forEach((s) => tr.insertAdjacentHTML("afterend", row(s, false)));
    tr.parentNode.querySelectorAll(".rot-sub").forEach((str) => {
      if (str.dataset.bound) return; str.dataset.bound = "1";
      str.addEventListener("click", (e) => { e.stopPropagation(); toggleRotMembers(str, str.dataset.sector, mk); });
    });
  }));
}

/* ---------- 섹터 산업지표 (sector_metrics.json — ECOS·야후 프록시·재무집계) ---------- */
let SECMET = null, secMetLoading = null;
function loadSecMet() {
  if (SECMET) return Promise.resolve(SECMET);
  if (secMetLoading) return secMetLoading;
  secMetLoading = fetch("data/sector_metrics.json" + _cb).then((r) => (r.ok ? r.json() : null))
    .then((j) => { SECMET = j; return j; }).catch(() => null);
  return secMetLoading;
}

// 지표별 "무슨 뜻인가" — 팝업 설명(투자 관점)
const SM_MEANING = {
  exp_semi: "한국 반도체 수출액 지수. 반도체 업황(가격×물량)의 가장 빠른 실물 확인 지표 — 상승=메모리 사이클 개선, 삼성전자·SK하이닉스 실적 선행.",
  exp_semieq: "반도체 장비 수출 지수. 팹 투자(CAPEX) 사이클을 반영 — 상승=국내 장비사(주성엔지니어링·원익IPS 등) 수주 환경 개선.",
  exp_disp: "디스플레이 수출 지수. 패널 가격·출하 사이클 — LG디스플레이·소재 업체 업황과 연동.",
  exp_auto: "자동차 수출 지수. 완성차 물량·단가 — 현대차·기아 실적의 직접 선행 지표.",
  exp_autoparts: "자동차 부품 수출 지수. 완성차보다 후행하지만 부품사(현대모비스 등) 매출과 직결.",
  exp_chem: "화학제품 수출 지수. 유가·중국 수요에 민감 — 롯데케미칼·LG화학 스프레드 환경.",
  exp_steel: "철강 수출 지수. 건설·조선·자동차 전방 수요의 합 — POSCO홀딩스·현대제철.",
  exp_ship: "운송장비(선박 포함) 수출 지수. 조선 인도량·단가 — HD현대중공업·한화오션.",
  exp_mach: "기계·장비 수출 지수. 설비투자 사이클 — 두산에너빌리티·기계주 전반.",
  exp_med: "의약품 수출 지수. 바이오시밀러·CDMO 수출 — 셀트리온·삼성바이오로직스.",
  exp_total: "전체 수출금액지수. 한국 경기·기업 이익의 큰 흐름 — 코스피 이익 추정의 기본 축.",
  bsi_mfg: "제조업 업황 BSI(실적). 100 초과=좋다는 기업이 더 많음 — 경기 국면 판단의 체감 지표.",
  csi_now: "현재 경기판단 소비자심리지수. 100 초과=낙관 — 내수·소비재·유통 수요의 선행 신호.",
  construct_order: "국내 건설수주액. 건설사 향후 매출의 선행 — 착공·분양 사이클 판단.",
  sox: "필라델피아 반도체지수. 글로벌 반도체 주가의 벤치마크 — 국내 반도체주와 높은 동행성.",
  mu: "마이크론 주가. 메모리 3사 중 실적을 가장 먼저 발표해 D램 사이클의 대리 지표로 쓰임.",
  krw: "원/달러 환율. 상승=수출 채산성 개선(반도체·자동차)이지만 외국인 자금 이탈 압력.",
  lit: "리튬·배터리 ETF. 리튬 가격과 2차전지 밸류체인 투자심리 — 양극재·셀 업체 선행.",
  copper: "구리 선물. '닥터 코퍼' — 글로벌 제조업·건설 경기의 실물 바로미터.",
  wti: "WTI 유가. 정유·화학 스프레드, 항공·해운 비용, 인플레이션 경로에 직접 영향.",
  sea: "해운 ETF. 컨테이너·벌크 운임 대리 — HMM·팬오션 실적과 연동.",
  hsi: "항셍지수. 중국 수요·정책 기대의 대리 — 화학·철강·소비재 수출에 영향.",
  tnx: "미국 10년물 금리. 성장주 할인율 — 급등 시 바이오·플랫폼 밸류에이션 압박.",
  vnq: "미국 리츠 ETF. 금리와 부동산 심리 — 국내 건설·리츠 투자심리와 방향 유사.",
  ita: "미국 방산·우주 ETF. 글로벌 국방예산 사이클 — 한화에어로스페이스·현대로템 수출 환경.",
  ura: "우라늄 ETF. 원전 확대 사이클 — 두산에너빌리티 등 원전 밸류체인.",
  ndx: "나스닥100. 글로벌 성장주 위험선호 — 국내 인터넷·게임·플랫폼과 동행.",
  ibb: "나스닥 바이오 ETF. 바이오 섹터 투자심리·자금 유입.",
  gold: "금. 안전자산 선호 — 위험자산(주식)과 역상관 경향.",
};

// 미니 라인차트(시계열 [[label,value],...]) — 기간 명시 + 클릭 시 큰 팝업
function secSpark(series, name, unit, src, key) {
  if (!series || series.length < 4) return "";
  const vals = series.map((d) => d[1]);
  const W = 300, H = 74, padT = 16, padB = 14;
  const max = Math.max(...vals), min = Math.min(...vals);
  const xS = (i) => (i / (vals.length - 1)) * W;
  const yS = (v) => padT + (max - v) / (max - min || 1) * (H - padT - padB);
  const last = vals[vals.length - 1];
  // ⚠구버전은 전 구간(2년) 시작점 대비라 "+741%"처럼 오해 소지 → 최근 3개월 기준으로 통일하고 라벨 명시
  const isMonthly = /^\d{4}-\d{2}$/.test(series[0][0]);   // ECOS=월간, 야후=주간
  const back = isMonthly ? 3 : 13;                        // 3개월분
  const baseIdx = Math.max(0, vals.length - 1 - back);
  const base = vals[baseIdx];
  const chg = base ? (last / base - 1) * 100 : 0;
  const line = vals.map((v, i) => `${xS(i).toFixed(1)},${yS(v).toFixed(1)}`).join(" ");
  const area = `${line} ${W},${H} 0,${H}`;
  const col = chg >= 0 ? "#f5445a" : "#4391ff";
  const fmt = (v) => v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(v >= 100 ? 0 : 2);
  return `<div class="sm-card clickable" data-k="${key}" title="클릭 = 크게 보기·설명">
    <div class="sm-head"><b>${name}</b><span class="sm-last">${fmt(last)}${unit}</span></div>
    <div class="sm-sub"><span class="${chg >= 0 ? "pos" : "neg"}">${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%</span>
      <span class="sub-note">3개월 전 대비 · ${src}</span></div>
    <svg viewBox="0 0 ${W} ${H}" class="sm-svg" preserveAspectRatio="none">
      <polygon points="${area}" fill="${col}" opacity=".10"/>
      <polyline points="${line}" fill="none" stroke="${col}" stroke-width="1.8"/>
      <circle cx="${xS(vals.length - 1)}" cy="${yS(last)}" r="2.6" fill="${col}"/></svg></div>`;
}

// 산업지표 카드 클릭 → 큰 차트 + 지표 의미 + 기간별 변화
function openSecMetDialog(key) {
  const s = SECMET?.series?.[key], m = SECMET?.meta?.[key];
  if (!s?.length || !m) return;
  const vals = s.map((d) => d[1]);
  const isMonthly = /^\d{4}-\d{2}$/.test(s[0][0]);
  const last = vals[vals.length - 1];
  const chgOf = (back) => {
    const i = vals.length - 1 - back;
    return i >= 0 && vals[i] ? (last / vals[i] - 1) * 100 : null;
  };
  const P = isMonthly ? [["1개월", 1], ["3개월", 3], ["1년", 12]] : [["1개월", 4], ["3개월", 13], ["1년", 52]];
  const fmt = (v) => v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(v >= 100 ? 0 : 2);
  const hi = Math.max(...vals), lo = Math.min(...vals);
  const stats = `현재 <b>${fmt(last)}${m.unit || ""}</b> · `
    + P.map(([lab, b]) => { const c = chgOf(b); return c == null ? "" :
        `${lab} <b class="${c >= 0 ? "pos" : "neg"}">${c >= 0 ? "+" : ""}${c.toFixed(1)}%</b>`; }).filter(Boolean).join(" · ")
    + `<br><span class="sub-note">구간 최고 ${fmt(hi)} · 최저 ${fmt(lo)} · 출처 ${m.src}${m.ticker ? ` (${m.ticker})` : ""}
        · 기간 ${s[0][0]} ~ ${s[s.length - 1][0]}</span>`
    + (SM_MEANING[key] ? `<br><span class="sm-mean">📌 ${SM_MEANING[key]}</span>` : "");
  // 월간(YYYY-MM)은 차트 라이브러리용으로 일자 보정
  const dates = s.map((d) => isMonthly ? `${d[0]}-01` : `20${d[0]}`);
  openChartDialog(m.name, stats, dates, vals);
}

// 섹터 펀더멘털(합산 CAPEX·매출·영업이익률) 막대+라인
function secFundChart(rows) {
  if (!rows || rows.length < 2) return `<p class="mini-note">이 산업군의 재무 집계 데이터가 없습니다.</p>`;
  const W = 620, H = 190, padL = 8, padR = 8, padT = 26, padB = 26;
  const n = rows.length, gw = (W - padL - padR) / n, plot = H - padT - padB;
  const maxV = Math.max(...rows.flatMap((r) => [r.rev, r.capex]), 1);
  const yS = (v) => padT + (1 - v / maxV) * plot;
  const eok = (v) => v >= 10000 ? (v / 10000).toFixed(1) + "조" : Math.round(v).toLocaleString();
  let bars = "", labels = "";
  rows.forEach((r, i) => {
    const cx = padL + gw * i + gw / 2, bw = Math.min(26, gw / 3);
    [[r.rev, "#4391ff", -0.55], [r.capex, "#f0b34c", 0.55]].forEach(([v, c, off]) => {
      if (!v) return;
      const y = yS(v);
      bars += `<rect x="${cx + off * bw - bw / 2}" y="${y}" width="${bw}" height="${Math.max(1, H - padB - y)}" fill="${c}" rx="1.5"/>`;
    });
    bars += `<text x="${cx}" y="${yS(r.rev) - 4}" font-size="8.5" text-anchor="middle" fill="#4391ff">${eok(r.rev)}</text>`;
    labels += `<text x="${cx}" y="${H - 8}" font-size="9.5" text-anchor="middle" fill="#8b8b93">${r.y}</text>`;
  });
  // 영업이익률 라인(우축 개념 — 상단 40% 영역)
  const oms = rows.map((r) => r.opm).filter((v) => v != null);
  let lineSvg = "";
  if (oms.length > 1) {
    const oMax = Math.max(...oms, 1), oMin = Math.min(...oms, 0);
    const yO = (v) => padT + (oMax - v) / (oMax - oMin || 1) * plot * 0.45;
    const pts = rows.map((r, i) => r.opm == null ? null : [padL + gw * i + gw / 2, yO(r.opm), r.opm]).filter(Boolean);
    lineSvg = `<polyline points="${pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ")}"
      fill="none" stroke="#22c07a" stroke-width="1.8"/>` +
      pts.map((p) => `<text x="${p[0]}" y="${p[1] - 5}" font-size="8" text-anchor="middle" fill="#22c07a">${p[2].toFixed(1)}%</text>`).join("");
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="fin-svg">${bars}${lineSvg}${labels}</svg>
    <p class="legend"><span style="color:#4391ff">■</span> 합산 매출 <span style="color:#f0b34c">■</span> 합산 CAPEX
      <span style="color:#22c07a">─</span> 영업이익률 <span class="sub-note">· 단위 억원 · 우리 DART 집계(${rows[rows.length - 1].n}개사)</span></p>`;
}

function secMetricsHtml(sector) {
  if (!SECMET) return "";
  const gk = SECMET.map?.[sector];
  if (!gk) return `<p class="mini-note" style="margin-top:8px">이 업종은 산업군 매핑이 없어 지표를 표시하지 않습니다.</p>`;
  const gname = SECMET.groups[gk], spec = SECMET.spec[gk] || { yf: [], ecos: [] };
  const cards = [...spec.ecos, ...spec.yf].map((k) => {
    const s = SECMET.series[k], m = SECMET.meta[k];
    return s && m ? secSpark(s, m.name, m.unit, m.src, k) : "";
  }).join("");
  return `<div class="sm-wrap">
    <div class="sm-block">
      <div class="perf-h">🏭 ${gname} 산업지표 <span class="sub-note">(수출·전방지표·원자재 — 하루 1회)</span></div>
      <div class="sm-grid">${cards || `<p class="mini-note">지표 없음</p>`}</div>
    </div>
    <div class="sm-block">
      <div class="perf-h">💰 ${gname} 펀더멘털 <span class="sub-note">(소속 상장사 합산 · 연간)</span></div>
      ${secFundChart(SECMET.fund?.[gk])}
    </div>
  </div>`;
}

// 섹터 행 클릭 → 소속 종목(히트맵 유니버스, 시총순) 펼침
function toggleRotMembers(tr, sector, mk) {
  const open = tr.nextElementSibling?.classList.contains("rot-members");
  document.querySelectorAll(".rot-members").forEach((r) => r.remove());
  document.querySelectorAll("#rot-table .rot-row td:first-child, #rot-table .rot-sub td:first-child").forEach((td) => {
    td.innerHTML = td.innerHTML.replace("▾", "▸");
  });
  if (open) return;
  tr.querySelector("td").innerHTML = tr.querySelector("td").innerHTML.replace("└", "▾");
  const members = (MARKET?.heatmap || [])
    .filter((t) => t.m === mk && t.sector === sector)
    .sort((a, b) => b.mcap - a.mcap);
  const row = document.createElement("tr");
  row.className = "rot-members";
  row.innerHTML = `<td colspan="12"><div class="rot-mem-grid">${   // 시총·비중 열 추가로 12열
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
  <div class="sm-host"></div>
  <p class="sub-note" style="margin:6px 0 2px">시총순 · 등락=당일 · 클릭 = 종목 조회로 이동 (분석 유니버스 내 종목만 표시)</p></td>`;
  tr.after(row);
  // 산업지표(ECOS·프록시·재무집계) — lazy 로드 후 삽입
  if (mk === "kr") {
    const host = row.querySelector(".sm-host");
    host.innerHTML = `<p class="mini-note" style="margin-top:8px">산업지표 불러오는 중…</p>`;
    loadSecMet().then(() => {
      host.innerHTML = secMetricsHtml(sector);
      host.querySelectorAll(".sm-card.clickable").forEach((c) =>
        c.onclick = () => openSecMetDialog(c.dataset.k));   // 클릭 = 큰 차트+의미 팝업
    });
  }
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
/* v282: 헤더의 '원칙' 드롭다운을 없앴다(사용자 요청).
   어떤 원칙만 볼지는 **원칙 목록 클릭**이 정하고, 그 상태를 여기에 담는다("" = 전체). */
let lookupRuleSel = "";
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
  // ── 성과: 기간별 절대/상대를 한 줄에(막대=절대, 점=시장대비) — 좁은 레일에서 한눈에 ──
  const PERIODS = [["1주", p.ret_w1, p.rel_w1], ["1개월", p.ret_m1, p.rel_m1],
                   ["3개월", p.ret_m3, p.rel_m3], ["1년", p.ret_y1, p.rel_y1]];
  const shown = PERIODS.filter(([, a, r]) => a != null || r != null);
  /* 눈금 상한을 60%로 **제한**한다. 데이터 최대값에 맞추면 1년 +222% 같은 값 하나가 눈금을 지배해
     1주·1개월 막대가 보이지 않는다(사용자 지적). 초과분은 끝까지 채우고 아래 안내로 명시. */
  const rawMax = Math.max(0.05, ...shown.flatMap(([, a, r]) => [Math.abs(a || 0), Math.abs(r || 0)]));
  const maxAbs = Math.min(rawMax, 0.6);
  const clipped = rawMax > maxAbs;
  const perfViz = shown.length ? `<div class="pf2-wrap">
    <div class="pf2-head"><span class="perf-h" style="margin:0">기간 수익률</span>
      <span class="sub-note"><span class="pf2-key bar"></span>절대 <span class="pf2-key dot"></span>시장 대비(초과수익)</span></div>
    ${shown.map(([lab, abs, rel]) => {
      const w = (v) => Math.min(50, Math.abs(v || 0) / maxAbs * 50);
      const dotPos = rel == null ? null : 50 + (rel >= 0 ? w(rel) : -w(rel));
      // 점 위치만으로는 '얼마나 이겼는지'를 못 읽는다 → 초과수익을 %p로 나란히 표기
      const relTxt = rel == null ? "" :
        `<b class="pf2-rel ${rel >= 0 ? "pos" : "neg"}" title="같은 기간 시장 지수보다 ${rel >= 0 ? "더" : "덜"} 오른 폭">${rel >= 0 ? "+" : ""}${(rel * 100).toFixed(1)}%p</b>`;
      return `<div class="pf2-row"><span class="pf2-lab">${lab}</span>
        <span class="pf2-track">
          <span class="pf2-zero"></span>
          ${abs == null ? "" : `<span class="pf2-fill ${abs >= 0 ? "up" : "dn"}"
            style="width:${w(abs)}%;${abs >= 0 ? "left:50%" : `right:50%`}"></span>`}
          ${dotPos == null ? "" : `<span class="pf2-dot ${rel >= 0 ? "up" : "dn"}" style="left:${dotPos}%"
            title="시장 대비 ${pct(rel, 1)}"></span>`}
        </span>
        <b class="pf2-val ${(abs ?? 0) >= 0 ? "pos" : "neg"}">${abs == null ? "-" : pct(abs, 1)}</b>
        ${relTxt}</div>`;
    }).join("")}
    <p class="sub-note pf2-note">막대 눈금 ±${(maxAbs * 100).toFixed(0)}%${clipped ? " — 이를 넘는 값은 끝까지 채워집니다(정확한 값은 오른쪽 숫자)" : ""}</p>
  </div>` : "";

  // ── 리스크 게이지: 베타·변동성을 막대 한 줄로(문구 대신 위치로 인지) ──
  const gauge = (label, v, max, fmt, warnAt, note) => {
    if (v == null) return "";
    const w = Math.max(2, Math.min(100, v / max * 100));
    const hot = warnAt != null && v >= warnAt;
    return `<div class="pf2-g"><span class="pf2-glab">${label}</span>
      <span class="pf2-gtrack"><span class="pf2-gfill ${hot ? "hot" : ""}" style="width:${w}%"></span></span>
      <b class="${hot ? "neg" : ""}">${fmt(v)}</b>${note ? `<span class="sub-note">${note}</span>` : ""}</div>`;
  };
  const riskViz = `<div class="pf2-gwrap">
    ${gauge("베타", p.beta, 2, (v) => v.toFixed(2), 1.3, p.beta == null ? "" : (p.beta > 1.3 ? "민감" : p.beta < 0.7 ? "방어적" : "중립"))}
    ${gauge("변동성", p.vol20, 100, (v) => v + "%", 60, p.vol20 > 60 ? "고변동" : "")}
  </div>`;

  // ── 수급: 외국인·기관 20일 순매수를 좌우 대비 막대로 ──
  const sup = st.supply_sum;
  let supViz = "";
  if (sup && (sup.frgn_20 != null || sup.inst_20 != null)) {
    const m = Math.max(1, Math.abs(sup.frgn_20 || 0), Math.abs(sup.inst_20 || 0), Math.abs(sup.indi_20 || 0));
    const amtTxt = (v) => v == null ? "-" : (v >= 0 ? "+" : "") +
      (Math.abs(v) >= 10000 ? (v / 10000).toFixed(1) + "조" : Math.round(v).toLocaleString() + "억");
    const srow = (label, v) => v == null ? "" : `<div class="pf2-row"><span class="pf2-lab">${label}</span>
      <span class="pf2-track"><span class="pf2-zero"></span>
        <span class="pf2-fill ${v >= 0 ? "up" : "dn"}" style="width:${Math.min(50, Math.abs(v) / m * 50)}%;${v >= 0 ? "left:50%" : "right:50%"}"></span></span>
      <b class="pf2-val ${v >= 0 ? "pos" : "neg"}">${amtTxt(v)}</b></div>`;
    supViz = `<div class="pf2-wrap">
      <div class="pf2-head"><span class="perf-h" style="margin:0">수급 (20일 누적)</span>
        ${sup.frgn_ratio != null ? `<span class="sub-note">외국인 보유율 ${sup.frgn_ratio}%${sup.frgn_ratio_chg != null ? ` (${sup.frgn_ratio_chg >= 0 ? "+" : ""}${sup.frgn_ratio_chg}%p)` : ""}</span>` : ""}</div>
      ${srow("외국인", sup.frgn_20)}${srow("기관", sup.inst_20)}${srow("개인", sup.indi_20)}</div>`;
  }

  const rows = [
    ["거래대금 (20일 평균)", p.val20 != null ? `<b>${st.market === "kr" ? (p.val20 / 1e8).toFixed(0) + "억원" : "$" + (p.val20 / 1e6).toFixed(0) + "M"}</b>` : "-"],
    ["섹터", p.sector ? `${p.sector}${p.sector_rank ? ` <span class="sub-note">(시총 ${p.sector_rank}/${p.sector_n}위)</span>` : ""}` : "-"],
  ];
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
  host.innerHTML = `<div class="fund-head">종목 프로파일 <span class="sub-note">(자체 계산)</span></div>
    ${perfViz}${riskViz}${supViz}
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
  const card = $("#lookup-supply-card");
  if (lookupSupply) { lookupSupply.remove(); lookupSupply = null; }
  const sup = st.supply;
  if (!sup || !sup.length) {  // US 또는 데이터 없음
    card.style.display = "none";
    return;
  }
  card.style.display = "";
  $("#lookup-supply-legend").style.display = "";
  const el = $("#lookup-supply");
  /* 옆 카드(종목 프로파일)와 높이를 맞춘다 — 그리드 stretch로 카드가 늘어나므로
     남는 공간만큼 차트를 키운다(최소 220px). 프로파일이 아직 없으면 기본 높이. */
  const peer = $("#lookup-profile");
  const peerH = peer && getComputedStyle(peer).display !== "none" ? peer.offsetHeight : 0;
  const chrome = 92;                     // 카드 제목 + 범례 + 패딩 몫
  const H = Math.max(220, Math.min(560, peerH ? peerH - chrome : 220));
  el.style.height = H + "px";
  lookupSupply = LightweightCharts.createChart(el, baseChartOpts(el, H));
  const line = (key, color, scale) => {
    const s = lookupSupply.addLineSeries({ color, lineWidth: 2, priceLineVisible: false,
      lastValueVisible: true, priceScaleId: scale });
    s.setData(sup.filter((x) => x[key] != null).map((x) => ({ time: x.t, value: x[key] })));
    return s;
  };
  line("fc", "#4391ff");   // 외국인 누적 (좌축)
  line("ic", "#f59e0b");   // 기관 누적 (좌축)
  const hasIndi = sup.some((x) => x.pc != null);
  if (hasIndi) line("pc", "#c084fc");   // 개인 누적 (좌축) — 옛 parquet엔 없어 조건부
  const fr = line("fr", "#22c07a", "right");  // 외국인 보유율 (우축)
  lookupSupply.priceScale("right").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
  // 0선
  lookupSupply.addLineSeries({ color: "#9ca3af", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false })
    .setData(sup.map((x) => ({ time: x.t, value: 0 })));
  lookupSupply.timeScale().fitContent();
  $("#lookup-supply-legend").innerHTML =
    `─ <span style="color:#4391ff">외국인</span> · <span style="color:#f59e0b">기관</span>${hasIndi ? ` · <span style="color:#c084fc">개인</span>` : ""} 누적 순매수 (좌축, 억원) ·
     <span style="color:#22c07a">외국인 보유율</span> (우축, %) · 출처: 네이버(순매매량×종가 추정)
     · ⚠<b>기타법인은 집계에서 빠져 세 주체의 합이 0이 되지 않습니다</b>
     (하루 기준 거래량의 0.3% 수준이지만 누적하면 금액이 커집니다)`;
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
  // v278: 축약어 칩(이격·BB·R30…)은 뜻을 알 수 없어 뺐다 — **이 종목에 실제로 걸린 원칙만**
  // 이름 + 판정 기준(results.json desc)으로 풀어 적는다. 채택 원칙(⭐)과 그 외를 구분 표기.
  // ①채택/미채택 ②그 안에서 매수/매도로 4구획 — 평면 목록은 무엇이 검증된 원칙인지 한눈에 안 들어온다
  const items = Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([rid, n]) => {
    const meta = (DATA?.rules || []).find((x) => x.rule_id === rid);
    const s = st.stats.find((x) => x.rule_id === rid);
    return { rid, n, meta, nm: meta?.name || s?.name || rid,
             side: (meta?.side || s?.side) === "buy" ? "buy" : "sell",
             sel: !!meta?.selected, on: ruleActive(rid, st.market) };
  });
  const li = (x) => `<li class="rl-item${x.on ? "" : " off"}" data-rid="${x.rid}">
      <span class="rl-ab ${x.side}">${RULE_ABBR[x.rid] || "•"}</span>
      <b>${x.nm}</b>
      ${x.meta?.desc ? `<span class="rl-desc">${x.meta.desc}</span>` : ""}
      <span class="rl-n">${x.n}회</span>${x.on ? "" : `<span class="rl-off">현 국면 꺼짐</span>`}</li>`;
  const sub = (arr, side) => {
    const list = arr.filter((x) => x.side === side);
    if (!list.length) return "";
    return `<div class="rl-sub ${side}"><div class="rl-sub-h">${
      side === "buy" ? "🟢 상승(매수) 신호" : "🔴 하락(매도) 신호"}
      <span class="sub-note">${list.length}종 · ${list.reduce((a, b) => a + b.n, 0)}회</span></div>
      <ul class="rule-legend">${list.map(li).join("")}</ul></div>`;
  };
  const block = (arr, title, note, cls) => arr.length ? `<div class="rl-block ${cls}">
      <div class="rl-block-h">${title}<span class="sub-note">${note}</span></div>
      ${sub(arr, "buy")}${sub(arr, "sell")}</div>` : "";
  const legend = block(items.filter((x) => x.sel), "⭐ 채택 원칙",
      "10년 검증 통과 — 이 종목에서 발생한 신호", "sel")
    + block(items.filter((x) => !x.sel), "참고 원칙 (미채택)",
      "검증 기준 미달 — 근거가 약하니 참고만", "unsel");
  const host = $("#lookup-chips");
  host.innerHTML = legend ? `<div class="rule-legend-wrap">${legend}</div>` : "";
  const mark = () => host.querySelectorAll(".rl-item").forEach((c) =>
    c.classList.toggle("on", !!lookupRuleSel && c.dataset.rid === lookupRuleSel));
  mark();
  host.querySelectorAll(".rl-item").forEach((c) => c.addEventListener("click", () => {
    lookupRuleSel = lookupRuleSel === c.dataset.rid ? "" : c.dataset.rid;  // 재클릭=해제
    mark();
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
  // v213: 위 sticky 바를 없애고 이 헤더를 고정 영역으로 씀 → 원칙 드롭다운도 여기로 합친다.
  host.innerHTML = `
    <img class="lk-logo" src="${logoUrl(st.market, st.ticker)}" alt="" onerror="this.style.display='none'">
    <div class="lk-title">
      <div class="lk-name">${st.name}<span class="sub-note"> ${st.ticker} · ${st.market === "kr" ? "KRX" : "US"}</span>
        ${starBtn(`${st.market}_${st.ticker}`, st.name)}${shortBadge}</div>
      <div class="lk-price"><span${col ? ` style="color:${col}"` : ""}>${fmtPrice(cur, st.market)}${chg != null ? ` ${up ? "▲" : "▼"} ${pct(chg, 2)}` : ""}</span>
        <span class="sub-note">${src}</span></div>
    </div>
    <span class="lk-head-gap"></span>`;
}

// 기업개요 카드
function renderLookupOverview(st) {
  const host = $("#lookup-overview");
  const co = EXTRAS.company?.map?.[`${st.market}_${st.ticker}`];
  const f = FUND?.map?.[`${st.market}_${st.ticker}`];
  if (!co || (!co.overview && !co.profile)) { host.style.display = "none"; return; }
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
  // 🪪 기업 정보 팩트(v221): KR=DART 개황·직원·배당 / US=yfinance 확장
  let pfHtml = "";
  const pr = co.profile;
  if (pr) {
    const facts = [];
    if (st.market === "kr") {
      if (pr.ceo) facts.push(["대표", pr.ceo]);
      if (pr.est) facts.push(["설립", pr.est.slice(0, 7)]);
      if (pr.emp) facts.push(["직원", pr.emp.toLocaleString() + "명" + (pr.tenure_y ? ` · 근속 ${pr.tenure_y}년` : "")]);
      if (pr.salary_mn) facts.push(["평균연봉", pr.salary_mn >= 100 ? (pr.salary_mn / 100).toFixed(2) + "억원" : pr.salary_mn + "백만원"]);
      if (pr.dps_y?.some((v) => v)) facts.push(["주당배당 3년", pr.dps_y.map((v) => (v ? v.toLocaleString() : "-")).join(" → ") + "원"]);
      if (pr.payout != null || pr.yld != null)
        facts.push(["배당", [pr.payout != null ? `성향 ${pr.payout}%` : "", pr.yld != null ? `시가배당률 ${pr.yld}%` : ""].filter(Boolean).join(" · ")]);
    } else {
      if (pr.hq) facts.push(["본사", pr.hq]);
      if (pr.emp) facts.push(["직원", pr.emp.toLocaleString() + "명"]);
      if (pr.sector) facts.push(["섹터", pr.sector]);
      if (pr.officers?.length)
        facts.push(["경영진", pr.officers.slice(0, 3).map((o) => `${o.name.replace(/^(Mr|Ms|Mrs|Dr)\.?\s+/, "")} (${(o.title || "").split(/,| and | & /)[0].slice(0, 28)})`).join(" · ")]);
    }
    if (facts.length)
      pfHtml = `<div class="ov-sec"><b>🪪 기업 정보</b><div class="ov-facts">${facts.map(([k, v]) =>
        `<span class="ov-fact"><span class="ov-fact-k">${k}</span>${v}</span>`).join("")}</div></div>`;
  }
  host.innerHTML = `<h3 class="lk-h3">🏢 기업 개요 ${ind ? `<span class="badge dim">${ind}</span>` : ""}
      ${co.website || pr?.url ? `<a class="ext-link" href="${co.website || pr.url}" target="_blank" rel="noopener">홈페이지 ↗</a>` : ""}
      <span style="flex:1"></span><span id="ov-deep"></span></h3>
    ${co.overview ? `<div class="ov-sec"><b>무엇을 하는 회사인가</b><p class="lk-ov-text">${intro}</p></div>` : ""}
    ${pfHtml}
    ${biz ? `<div class="ov-sec"><b>🧩 사업 구조·전략</b><ul class="ov-biz">${biz.map((x) => `<li>${x}</li>`).join("")}</ul></div>` : ""}
    ${mixHtml}${shHtml}
    <div id="ov-group"></div>
    <p class="sub-note">출처: ${st.market === "kr" ? "와이즈리포트(개요·매출구성) · DART(주주·기업정보)" : "Yahoo Finance"} · 주 1회 갱신 · 매출구성·지분율은 최근 보고서 기준</p>`;
  loadBizDeep(st);
  ovGroup(st);
}

/* 🏛 그룹 관계(v275) — 기업개요에서 "이 회사 위·아래에 누가 있나"를 바로 보여준다.
   소유지분도(app/data/ownership)를 재사용하므로 추가 수집이 없다. ★=상장사(클릭 시 그 종목으로 이동). */
async function ovGroup(st) {
  const el = document.getElementById("ov-group");
  if (!el) return;
  // ⚠LOOKUP_INDEX 항목의 시장 필드는 `mk`가 아니라 **`market`**이다(실측)
  const name = (LOOKUP_INDEX || []).find((x) => x.market === st.market && x.ticker === st.ticker)?.name
    || (MARKET?.heatmap || []).find((x) => x.m === st.market && x.t === st.ticker)?.name
    || st.name;
  if (st.market !== "kr" || !name) return;          // 지분도는 국내만
  const ctx = await dsOwnCtx(name);
  if (!ctx || (!ctx.parents.length && !ctx.kids.length)) return;
  const chip = (n) => `<span class="ov-rel${n.ticker ? " go" : ""}"${n.ticker ? ` data-go="kr_${n.ticker}"` : ""}>
    ${n.ticker ? "★" : ""}${dsEsc(n.name)}${n.rate != null ? `<i>${n.rate}%</i>` : ""}</span>`;
  el.innerHTML = `<div class="ov-sec"><b>🏛 그룹 관계</b>
    <span class="sub-note">${dsEsc(ctx.group)} 소유지분도 기준 · 지분율은 보유 비율</span>
    ${ctx.parents.length ? `<div class="ov-relrow"><span class="ov-rel-lab">상위(지배) 회사</span>
      ${ctx.parents.map(chip).join("")}</div>` : ""}
    ${ctx.kids.length ? `<div class="ov-relrow"><span class="ov-rel-lab">하위(자회사)</span>
      ${ctx.kids.map(chip).join("")}</div>` : ""}
    <div class="ov-relrow"><a class="ext-link" href="#" id="ov-own-go">소유지분도 전체 보기 →</a></div></div>`;
  el.querySelectorAll("[data-go]").forEach((b) => b.onclick = () => loadLookup(b.dataset.go));
  const go = document.getElementById("ov-own-go");
  if (go) go.onclick = (e) => {
    e.preventDefault();
    gotoTabFull("ownership");
    if (!ownRendered) initOwnership();
    // ⚠배열엔 `in`을 쓰면 인덱스 검사가 된다 — includes로 판정
    setTimeout(() => {
      const own = `kr_${st.ticker}`;
      ownLoad((OWN_IDX || []).includes(own) ? own : ownSel, dsOwnClean(name));
    }, 300);
  };
}

/* ---------- 📚 사업 심층 (v221) — 사업보고서 '사업의 내용'/10-K Item 1 발췌 ---------- */
const BIZDEEP = {};
/* 발췌 본문 렌더(v224): 표는 수집기가 '셀1 | 셀2 | …' 한 줄로 보존한다 —
   '|' 포함 연속 줄을 실제 <table>로 복원, 나머지는 문단으로 */
function bdRender(escaped) {
  const out = [];
  let tbl = null;
  const flush = () => {
    if (!tbl) return;
    out.push(`<div class="bd-tblwrap"><table class="bd-tbl">${tbl.map((r) =>
      `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table></div>`);
    tbl = null;
  };
  for (const ln of escaped.split("\n")) {
    if (ln.includes("|") && ln.split("|").length >= 2 && ln.trim()) {
      (tbl = tbl || []).push(ln.split("|").map((c) => c.trim()));
    } else {
      flush();
      if (ln.trim()) out.push(`<p>${ln}</p>`);
    }
  }
  flush();
  return out.join("");
}
const bdEsc = (x) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/* v225: 카드에는 한 줄 버튼만 — 클릭하면 보고서 뷰어와 같은 팝업으로 전체 섹션 열람 */
function bizDeepHtml(d) {
  return `<button class="today-chart-btn bd-open">📚 사업 심층 보기
    <span class="sub-note">${d.src.replace(/ \(/, "(")} · ${d.sections.length}개 섹션</span></button>`;
}
function openBizDeep(d, name) {
  let ov = document.getElementById("report-overlay");
  if (!ov) { ov = document.createElement("div"); ov.id = "report-overlay"; document.body.appendChild(ov); }
  const close = () => { ov.style.display = "none"; document.body.style.overflow = ""; };
  ov.innerHTML = `<div class="rep-doc">
    <div class="rep-head"><b>📚 ${bdEsc(name || d.name)} — 사업 심층</b>
      <span class="sub-note">${d.src} 원문 발췌 ·
        <a class="ext-link" href="${d.url}" target="_blank" rel="noopener">공시 원문 전체 ↗</a></span>
      <span style="flex:1"></span><button class="jr-x" id="bd-close">✕</button></div>
    <div class="rep-body bd-body">${d.sections.map((s) =>
      `<h3>${bdEsc(s.h)}</h3><div class="bizdeep-t">${bdRender(bdEsc(s.t))}</div>`).join("")}
    </div></div>`;
  ov.style.display = "block";
  document.body.style.overflow = "hidden";
  document.getElementById("bd-close").onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
}
async function fetchBizDeep(key) {
  if (!(key in BIZDEEP)) {
    try {
      BIZDEEP[key] = await fetch(`data/bizdeep/${key}.json` + _cb).then((r) => (r.ok ? r.json() : null));
    } catch (e) { BIZDEEP[key] = null; }
  }
  return BIZDEEP[key];
}
async function loadBizDeep(st) {
  const key = `${st.market}_${st.ticker}`;
  const d = await fetchBizDeep(key);
  const el = document.getElementById("ov-deep");   // v284: 카드 하단 → **헤더 우측**(사용자 요청)
  if (!d || !el || LOOKUP_ST !== st) return;
  el.innerHTML = bizDeepHtml(d);
  el.querySelector(".bd-open").onclick = () => openBizDeep(d, st.name);
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
// 분기·연간 실적 차트를 한 자리(토글)로 — 두 카드가 각자 렌더된 뒤 병합(기본=분기, 연간은 토글로)
function mergeFinCharts() {
  const q = $("#lookup-finq"), a = $("#lookup-fin");
  const hasQ = q && q.style.display !== "none" && q.innerHTML;
  const hasA = a && a.style.display !== "none" && a.innerHTML;
  if (!hasQ || !hasA) return;  // 한쪽뿐이면 그대로 단독 표시
  const mkToggle = (act) => {
    const s = document.createElement("span");
    s.className = "mk-toggle fc-toggle";
    s.style.marginLeft = "auto";
    s.innerHTML = `<button data-m="q" class="${act === "q" ? "active" : ""}">분기</button>
      <button data-m="a" class="${act === "a" ? "active" : ""}">연간</button>`;
    s.querySelectorAll("button").forEach((b) => b.onclick = () => {
      q.style.display = b.dataset.m === "q" ? "" : "none";
      a.style.display = b.dataset.m === "a" ? "" : "none";
    });
    return s;
  };
  q.querySelector(".lk-h3")?.appendChild(mkToggle("q"));
  a.querySelector(".lk-h3")?.appendChild(mkToggle("a"));
  a.style.display = "none";  // 기본 = 분기
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
    const pts = sq.map((r, i) => (Number.isFinite(r[k]) ? [padL + gw * i + gw / 2, yS(r[k]), r[k]] : null)).filter(Boolean);
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
/* ---------- 💰 배당 섹션 (v241) — 스냅샷 안, DPS 막대 + 배당수익률/배당성향 라인 ----------
   배당수익률은 저장값(최신 1개)뿐이라 추이를 못 봤다 → **그해 DPS ÷ 그해 평균 종가**로 직접 계산해
   "지금이 역사적으로 배당 매력이 높은 구간인가"를 볼 수 있게 한다.
   KR = fin_ext[].dps(연도별) + profile(배당성향·시가배당률) / US = dividend.history(분기 지급) 연 합계. */
/* 추정치 신뢰 가드(v274) — 소스(네이버 연간 컨센서스)가 간혹 **비정상적으로 큰 추정 EPS**를 준다.
   실측 2026-08-02: 삼성전자 2026 추정 EPS 47,929원(2025 실적 6,564원의 7.3배) · 2,685종목 중 93건.
   원본 API가 그대로 그 값을 주므로 우리 파싱 문제가 아니다 → **표시 단계에서 버린다**
   (그대로 두면 선행 PER 5.5배, 배당 추정 7,691원처럼 사실과 다른 숫자가 화면에 나간다). */
function finExtOk(list) {
  const rows = list || [];
  const act = rows.filter((r) => !r.est && Number.isFinite(r.eps) && r.eps !== 0);
  if (!act.length) return rows;
  const base = Math.abs(act[act.length - 1].eps);
  return rows.filter((r) => !r.est || !Number.isFinite(r.eps) || Math.abs(r.eps) <= base * 3);
}

function divRows(st, co) {
  const out = [];
  if (st.market === "kr") {
    finExtOk(co.fin_ext).forEach((r) => {
      if (r.dps == null || !r.dps) return;
      out.push({ y: String(r.y).slice(0, 4), dps: r.dps, est: !!r.est });
    });
  } else {
    const h = co.dividend?.history || [];
    const byY = {};
    h.forEach((x) => { const y = x.d.slice(0, 4); byY[y] = (byY[y] || 0) + (x.amt || 0); });
    const cntY = {};
    h.forEach((x) => { const y = x.d.slice(0, 4); cntY[y] = (cntY[y] || 0) + 1; });
    const years = Object.keys(byY).sort();
    // 지급 횟수가 그 종목의 최빈 횟수보다 적은 해 = 자료가 잘린 해 → 제외(연 배당을 과소 표시하지 않기 위해)
    const mode = Math.max(...Object.values(cntY));
    years.forEach((y) => { if (cntY[y] >= mode) out.push({ y, dps: +byY[y].toFixed(4), est: false }); });
  }
  return out.slice(-6);
}

/* 그해 평균 종가 — 배당수익률 계산용. 해당 연도 일봉이 20개 미만이면 null(부분 연도 왜곡 방지). */
function yearAvgClose(series, y) {
  const v = (series || []).filter((x) => x.t.startsWith(y)).map((x) => x.c);
  return v.length >= 20 ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/* 배당(v274) — 별도 섹션이 아니라 **Snapshot의 '배당' 뷰**로 들어간다(사용자 요청).
   HTML만 만들어 돌려주고, 어디에 붙일지는 부르는 쪽이 정한다. null이면 배당 데이터가 없는 종목. */
function divPanel(st) {
  const co = EXTRAS.company?.map?.[`${st.market}_${st.ticker}`] || {};
  const rows = divRows(st, co);
  const pr = co.profile || {};
  const curYld = st.market === "kr" ? pr.yld : null;
  const curPayout = st.market === "kr" ? pr.payout : (co.dividend?.payout ?? co.metrics?.payout);
  if (rows.length < 2 && curYld == null && !co.dividend?.dps) return null;
  const cur = st.market === "kr" ? "원" : "$";
  const fmtD = (v) => (st.market === "kr" ? Math.round(v).toLocaleString() : v.toFixed(2));

  // 연도별 배당수익률(그해 DPS ÷ 그해 평균 종가)
  rows.forEach((r) => {
    const avg = yearAvgClose(st.series, r.y);
    r.yld = avg && r.dps ? (r.dps / avg) * 100 : null;
  });
  const yldRows = rows.filter((r) => r.yld != null);
  const avgYld = yldRows.length ? yldRows.reduce((a, b) => a + b.yld, 0) / yldRows.length : null;

  // 연속 증액 연수(추정 연도 제외)
  const act = rows.filter((r) => !r.est);
  let streak = 0;
  for (let i = act.length - 1; i > 0; i--) { if (act[i].dps > act[i - 1].dps) streak++; else break; }

  // ---- SVG: DPS 막대 + 배당수익률 라인(우축) ----
  /* ⚠Snapshot의 다른 뷰는 viewBox 940×300인데 배당만 660×190이었다.
     둘 다 width:100%로 그려지므로 좌표계가 좁은 쪽이 **1.42배 확대**돼 글자만 커 보인다
     → 좌표계와 폰트를 다른 뷰와 동일하게 맞춘다. */
  const W = 940, H = 270, padL = 10, padB = 34, padT = 30;
  const n = rows.length, gw = (W - padL * 2) / Math.max(1, n);
  const maxD = Math.max(...rows.map((r) => r.dps), 1);
  const yB = (v) => padT + (1 - v / maxD) * (H - padT - padB);
  const yl = yldRows.map((r) => r.yld);
  const ylMin = Math.min(...yl, 0), ylMax = Math.max(...yl, 1);
  const yL = (v) => padT + 4 + (ylMax - v) / (ylMax - ylMin || 1) * (H - padT - padB - 30);
  let bars = "", labels = "", pts = [];
  rows.forEach((r, i) => {
    const cx = padL + gw * i + gw / 2, bw = Math.min(54, gw * 0.5);
    const y = yB(r.dps), h0 = padT + (H - padT - padB) - y;
    bars += `<rect x="${cx - bw / 2}" y="${y}" width="${bw}" height="${Math.max(1, h0)}"
      fill="${r.est ? "#c9b26a" : "#e0a93f"}" rx="2"/>
      <text x="${cx}" y="${y - 6}" font-size="10.5" text-anchor="middle" fill="#a37a1c">${fmtD(r.dps)}</text>`;
    if (r.yld != null) pts.push([cx, yL(r.yld), r.yld]);
    labels += `<text x="${cx}" y="${H - 9}" font-size="11.5" text-anchor="middle" fill="#8b8b93">${r.y}${r.est ? "(E)" : ""}</text>`;
  });
  const line = pts.length > 1
    ? `<polyline points="${pts.map((p) => p[0] + "," + p[1]).join(" ")}" fill="none" stroke="#4391ff" stroke-width="2"/>` +
      pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.4" fill="#4391ff"/>
        <text x="${p[0]}" y="${p[1] + (i % 2 ? 15 : -7)}" font-size="10.5" text-anchor="middle" fill="#4391ff">${p[2].toFixed(1)}%</text>`).join("")
    : "";

  // ---- 요약 타일 ----
  const lastYld = yldRows.length ? yldRows[yldRows.length - 1].yld : null;
  const vs = (lastYld != null && avgYld) ? lastYld - avgYld : null;
  const tiles = [
    ["시가배당률", curYld != null ? curYld.toFixed(1) + "%" : (lastYld != null ? lastYld.toFixed(1) + "%" : "-"),
      avgYld != null ? `${rows.length}년 평균 ${avgYld.toFixed(1)}%` : ""],
    ["배당성향", curPayout != null ? Number(curPayout).toFixed(1) + "%" : "-", "순이익 중 배당 비중"],
    ["연속 증액", streak > 0 ? streak + "년" : "없음",
      act.length >= 2 ? `직전 ${fmtD(act[act.length - 2].dps)} → ${fmtD(act[act.length - 1].dps)}${cur}` : ""],
  ];
  const verdict = vs == null ? "" :
    `<p class="sub-note" style="margin-top:6px">${vs >= 0.3
      ? `📌 현재 배당수익률이 최근 평균보다 <b class="pos">${vs.toFixed(1)}%p 높습니다</b> — 주가가 배당 대비 낮은 구간(배당 매력↑).`
      : vs <= -0.3
        ? `📌 현재 배당수익률이 최근 평균보다 <b class="neg">${Math.abs(vs).toFixed(1)}%p 낮습니다</b> — 주가 상승 또는 배당 축소로 배당 매력↓.`
        : `📌 현재 배당수익률은 최근 평균과 비슷한 수준입니다.`}</p>`;

  // 아래 금액 표 — Snapshot의 다른 뷰와 같은 형식(사용자 요청: 그래프만이 아니라 숫자도)
  const payoutOf = (r) => {
    const fx = (co.fin_ext || []).find((f) => String(f.y).slice(0, 4) === String(r.y));
    return fx?.eps ? (r.dps / fx.eps) * 100 : null;
  };
  const tbl = rows.length ? `<table class="fin-table"><thead><tr><th>항목</th>
      ${rows.map((r) => `<th class="num">${r.y}${r.est ? "(E)" : ""}</th>`).join("")}</tr></thead><tbody>
    <tr><td>주당배당금(${cur})</td>${rows.map((r) => `<td class="num">${fmtD(r.dps)}</td>`).join("")}</tr>
    <tr><td>배당수익률</td>${rows.map((r) => `<td class="num">${r.yld != null ? r.yld.toFixed(2) + "%" : "-"}</td>`).join("")}</tr>
    <tr><td>배당성향</td>${rows.map((r) => {
      const pv = payoutOf(r);
      return `<td class="num">${pv != null && isFinite(pv) ? pv.toFixed(1) + "%" : "-"}</td>`;
    }).join("")}</tr>
    <tr><td>전년 대비</td>${rows.map((r, i) => {
      const pv = i > 0 ? rows[i - 1].dps : null;
      const g = pv ? (r.dps / pv - 1) * 100 : null;
      return `<td class="num ${g == null ? "" : g >= 0 ? "pos" : "neg"}">${g == null ? "-" : (g >= 0 ? "+" : "") + g.toFixed(1) + "%"}</td>`;
    }).join("")}</tr></tbody></table>` : "";

  return `<div class="div-tiles">${tiles.map(([k, v, s]) =>
      `<div class="div-tile"><span class="sub-note">${k}</span><b>${v}</b>${s ? `<span class="sub-note">${s}</span>` : ""}</div>`).join("")}</div>
    ${rows.length >= 2 ? `<svg viewBox="0 0 ${W} ${H}" class="fin-svg">${bars}${line}${labels}</svg>
    <p class="legend" style="margin-top:2px"><span style="color:#e0a93f">■</span> 주당배당금 ·
      <span style="color:#4391ff">●─</span> 배당수익률(%) ·
      <span class="sub-note">배당수익률=그해 배당÷그해 평균주가${st.market === "kr" ? " · 출처 DART·네이버" : " · 출처 Yahoo"}</span></p>`
      : `<p class="mini-note">연도별 배당 이력이 부족해 추이 그래프는 생략했습니다.</p>`}
    ${verdict}${tbl}`;
}

/* 기존 별도 섹션은 숨긴다 — 내용이 Snapshot으로 옮겨갔다 */
function renderLookupDividend(st) {
  const host = $("#lookup-dividend");
  if (host) host.style.display = "none";
  void st;
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
/* 📈 동종업계 상대 주가 — 5년 전(또는 가장 이른 공통 시점)=100으로 맞춘 추이.
   ⚠종목마다 상장일이 달라 시작점이 제각각이면 비교가 무의미해진다 → **공통 시작일**을 잡고
     그 시점을 100으로 재정규화한다. 데이터가 없는 피어는 조용히 건너뛴다. */
function drawPeerChart(st, peers) {
  const self = { mk: st.market, ticker: st.ticker, name: st.name || st.ticker, self: true };
  drawPeerChartInto("#peer-chart", [self, ...peers.filter((p) => p.ticker !== st.ticker)]);
}

/* 여러 종목의 상대 주가를 한 축에 — 종목조회 동종업계·관심종목이 함께 쓴다 */
function drawPeerChartInto(sel, items) {
  const host = $(sel); if (!host) return;
  const list = (items || []).slice(0, 8);
  if (list.length < 2) { host.innerHTML = list.length ? `<p class="mini-note">2종목 이상이어야 비교할 수 있습니다.</p>` : ""; return; }
  host.innerHTML = `<p class="mini-note">상대 주가 불러오는 중…</p>`;
  Promise.all(list.map((p) => {
    const key = `${p.mk}_${p.ticker}`;
    if (HLD_SERIES[key] !== undefined) return Promise.resolve();
    return fetch(`data/stocks/${key}.json` + _cb).then((r) => (r.ok ? r.json() : null)).then(normStock)
      .then((s) => { HLD_SERIES[key] = s?.series || null; }).catch(() => { HLD_SERIES[key] = null; });
  })).then(() => {
    const got = list.map((p) => ({ ...p, s: HLD_SERIES[`${p.mk}_${p.ticker}`] })).filter((p) => p.s?.length > 30);
    const selfTk = (list.find((p) => p.self) || {}).ticker;
    if (got.length < 2) { host.innerHTML = ""; return; }
    // 공통 시작일 = 가장 늦게 시작하는 종목의 첫 날짜(그래야 전부 같은 기준)
    const start = got.map((p) => p.s[0].t).sort().pop();
    const defs = got.map((p) => {
      const cut = p.s.filter((b) => b.t >= start);
      const base = cut[0]?.c;
      if (!base) return null;
      return { name: p.name, t: cut.map((b) => b.t), v: cut.map((b) => b.c / base * 100),
               self: p.ticker === selfTk };
    }).filter(Boolean);
    if (defs.length < 2) { host.innerHTML = ""; return; }
    // 우측 좁은 레일(360px)에서 넓은 본문(~1,000px)으로 옮기며 SVG가 2배 이상 확대돼 글씨가 커졌다.
    // .cr-ax/.cr-end는 크립토 탭과 공유하는 클래스라 CSS를 건드리면 그쪽도 줄어든다
    // → 이 차트의 viewBox만 넓혀(640→1,020) 배율을 낮춘다(글씨 약 40% 작아짐).
    const W = 1020, H = 300, P = { l: 46, r: 128, t: 14, b: 24 };
    const days = defs[0].t;
    const idx = Object.fromEntries(days.map((d, i) => [d, i]));
    const all = defs.flatMap((d) => d.v);
    const mn = Math.min(...all), mx = Math.max(...all), pad = (mx - mn) * 0.08 || 1;
    const lo = mn - pad, hi = mx + pad;
    const X = (i) => P.l + (W - P.l - P.r) * (i / Math.max(1, days.length - 1));
    const Y = (v) => P.t + (H - P.t - P.b) * (1 - (v - lo) / (hi - lo));
    const grid = [0, .5, 1].map((r) => {
      const v = lo + (hi - lo) * r;
      return `<line x1="${P.l}" y1="${Y(v)}" x2="${W - P.r}" y2="${Y(v)}" stroke="var(--line)"/>
        <text x="${P.l - 5}" y="${Y(v) + 3}" text-anchor="end" class="cr-ax">${v.toFixed(0)}</text>`;
    }).join("");
    const base100 = (lo <= 100 && hi >= 100)
      ? `<line x1="${P.l}" y1="${Y(100)}" x2="${W - P.r}" y2="${Y(100)}" stroke="#8b8b93" stroke-dasharray="4 4"/>` : "";
    const paths = defs.map((d, i) => {
      const pts = d.t.map((t, j) => (idx[t] != null ? `${X(idx[t]).toFixed(1)},${Y(d.v[j]).toFixed(1)}` : null))
        .filter(Boolean).join(" ");
      return `<polyline points="${pts}" fill="none" stroke="${d.self ? "#f5445a" : HLD_COLORS[(i + 1) % 8]}"
        stroke-width="${d.self ? 2.6 : 1.5}" opacity="${d.self ? 1 : .85}"/>`;
    }).join("");
    const ends = defs.map((d, i) => ({ name: d.name, self: d.self, v: d.v[d.v.length - 1],
      y: Y(d.v[d.v.length - 1]), c: d.self ? "#f5445a" : HLD_COLORS[(i + 1) % 8] })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 13);
    const labels = ends.map((e) => `<text x="${W - P.r + 5}" y="${e.y + 3}" class="cr-end" fill="${e.c}"
      ${e.self ? 'font-weight="800"' : ""}>${String(e.name).slice(0, 8)} ${e.v.toFixed(0)}</text>`).join("");
    const xl = [0, Math.floor(days.length / 2), days.length - 1].map((i) =>
      `<text x="${X(i)}" y="${H - 5}" text-anchor="${i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"}"
        class="cr-ax">${days[i].slice(0, 7)}</text>`).join("");
    const yrs = ((new Date(days[days.length - 1]) - new Date(days[0])) / 3.156e10).toFixed(1);
    host.innerHTML = `${selfTk ? `<h3 class="lk-h3" style="margin-top:12px">📈 상대 주가 추이
        <span class="sub-note">(${days[0]}=100 · ${yrs}년 · <b style="color:#f5445a">굵은 선=조회 종목</b>)</span></h3>` : ""}
      <svg viewBox="0 0 ${W} ${H}" class="fin-svg">${grid}${base100}${paths}${labels}${xl}</svg>
      <p class="mini-note">같은 기간 <b>몇 배가 됐는지</b>를 비교합니다(100=출발점). 상장일이 달라 전 종목이
        공통으로 존재하는 <b>${days[0]}</b>부터 그렸습니다.</p>`;
  });
}

/* 우리 분류 기준 동종업계(v288) — 네이버 업종 피어는 우리 밸류체인과 따로 놀아서,
   분류를 고쳐도 동종업계가 그대로였다(실리콘투: 화장품 유통인데 예스24·미트박스와 비교).
   → **같은 밸류체인 단계**에서 시가총액이 가까운 종목을 뽑는다. 단계가 없으면 네이버 피어를 그대로 쓴다. */
function ourPeers(ticker, n = 5) {
  const tiles = MARKET?.heatmap || [];
  const self = tiles.find((x) => x.m === "kr" && x.t === ticker);
  if (!self) return null;
  const mine = stockChainLinks("kr", ticker, self.sector) || [];
  const link = mine.find((x) => x.stageKey !== "_etc");   // '그 외'는 동종업계로 쓰기엔 너무 넓다
  if (!link) return null;
  const stObj = (CHAINS[link.ind]?.stages || []).find((s) => s.key === link.stageKey);
  if (!stObj) return null;
  const codes = new Set(scrStageCodes(stObj));
  codes.delete(ticker);
  if (codes.size < 2) return null;
  const cand = tiles.filter((x) => x.m === "kr" && codes.has(x.t) && x.mcap);
  if (cand.length < 2) return null;
  cand.sort((a, b) => Math.abs(Math.log((a.mcap || 1) / (self.mcap || 1)))
                    - Math.abs(Math.log((b.mcap || 1) / (self.mcap || 1))));
  return { stage: link, list: cand.slice(0, n).map((x) => ({ ticker: x.t, name: x.name, mk: "kr",
    price: (MARKET?.quotes?.[`kr_${x.t}`] || [])[0] ?? null,
    chg: (MARKET?.quotes?.[`kr_${x.t}`] || [])[1] ?? x.chg, mcap: x.mcap })) };
}

function renderLookupPeers(st) {
  const host = $("#lookup-peers");
  const key = `${st.market}_${st.ticker}`;
  const co = EXTRAS.company?.map?.[key];
  const goto = (mk, tk) => `data-goto="${mk}_${tk}"`;
  if (st.market === "kr") {
    const ours = ourPeers(st.ticker);
    const peers = ours ? ours.list : co?.peers;
    if (!peers?.length) { host.style.display = "none"; return; }
    host.style.display = "";
    // 피어 API엔 PER/PBR이 없다 → 이미 전 종목 수집해 둔 company.metrics에서 끌어온다(파이프라인 무변경).
    // 비교 기준을 맞추려고 조회 종목(self) 행을 맨 위에 함께 넣는다.
    const met = (tk) => EXTRAS.company?.map?.[`kr_${tk}`]?.metrics || {};
    const nf1 = (v) => (v == null || !isFinite(v) ? "-" : v.toFixed(1) + "배");
    /* 🐞기준 종목(self) 행의 주가·등락률이 비어 있었다(사용자 제보).
       원인 2가지: ①freshQuote()의 반환 키는 `cur/chg`인데 `price`로 읽었고
                  ②등락률을 아예 null로 넣었다. 또 chg 단위가 다르다 —
                  freshQuote는 **비율**(0.0123), 피어 API는 **퍼센트**(1.23) → self만 ×100 해서 맞춘다. */
    const fq = freshQuote(st);
    const all = [{ ticker: st.ticker, name: st.name, self: true,
                   price: fq?.cur ?? null,
                   chg: fq?.chg != null ? +(fq.chg * 100).toFixed(2) : null }, ...peers];
    const rows = all.map((p) => {
      const m = met(p.ticker);
      return `<tr class="${p.self ? "peer-self" : ""}" ${p.self ? "" : goto("kr", p.ticker)}>
      <td class="hld-name"><img class="mv-logo" src="https://ssl.pstatic.net/imgstock/fn/real/logo/stock/Stock${p.ticker}.svg" onerror="this.style.visibility='hidden'">
        <span><b>${p.name}</b> <span class="sub-note">${p.ticker}</span></span></td>
      <td class="scr-r">${p.price != null ? Math.round(p.price).toLocaleString() + "원" : "-"}</td>
      <td class="scr-r ${p.chg == null ? "" : p.chg >= 0 ? "kup" : "kdn"}">${p.chg != null ? (p.chg >= 0 ? "+" : "") + p.chg.toFixed(2) + "%" : "-"}</td>
      <td class="scr-r">${nf1(m.per)}</td>
      <td class="scr-r">${nf1(m.pbr)}</td></tr>`;
    }).join("");
    host.innerHTML = `<h3 class="lk-h3">🏢 동종업계 비교
        <span class="sub-note">(네이버 동일업종 · PER·PBR은 최근 보고서 기준)</span></h3>
      <div class="tablewrap"><table class="hld-table peer-table">
        <thead><tr><th>종목</th><th class="scr-r">주가</th><th class="scr-r">등락률</th>
          <th class="scr-r">PER</th><th class="scr-r">PBR</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div id="peer-chart"></div>`;
    drawPeerChart(st, peers.map((x) => ({ mk: "kr", ticker: x.ticker, name: x.name })));
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
    // PBR은 FUND에 없어 company.metrics에서 보강(KR과 같은 소스 규칙)
    const met2 = (tk) => EXTRAS.company?.map?.[`us_${tk}`]?.metrics || {};
    const nf1 = (v) => (v == null || !isFinite(v) ? "-" : v.toFixed(1) + "배");
    const rows = list.map((p) => {
      const m = met2(p.ticker);
      return `<tr class="${p.self ? "peer-self" : ""}" ${p.self ? "" : goto("us", p.ticker)}>
      <td class="hld-name"><b>${p.name}</b> <span class="sub-note">${p.ticker}</span></td>
      <td class="scr-r">${p.price != null ? fmtPrice(p.price, "us") : "-"}</td>
      <td class="scr-r">${p.mcap != null ? fmtMcap(p.mcap, "us") : "-"}</td>
      <td class="scr-r">${nf1(p.per ?? m.per)}</td>
      <td class="scr-r">${nf1(m.pbr)}</td></tr>`;
    }).join("");
    host.innerHTML = `<h3 class="lk-h3">🏢 동종업계 비교 <span class="sub-note">(${ind} · 시총순)</span></h3>
      <div class="tablewrap"><table class="hld-table peer-table">
        <thead><tr><th>종목</th><th class="scr-r">주가</th><th class="scr-r">시가총액</th>
          <th class="scr-r">PER</th><th class="scr-r">PBR</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div id="peer-chart"></div>`;
    drawPeerChart(st, list.filter((x) => !x.self).map((x) => ({ mk: "us", ticker: x.ticker, name: x.name })));
  }
  host.querySelectorAll("tr[data-goto]").forEach((tr) => tr.onclick = () => {
    if (!lookupRendered) initLookup();
    loadLookup(tr.dataset.goto);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

// 공시(6개월)·뉴스(1주일) 피드
/* ---------- 상세 재무제표 (financials/{key}.json — DART/yfinance) + 엑셀 추출 ---------- */
const FIN_CACHE = {};
let finXlsxLoading = null;

// 표 행 정의 — [키, 라벨, 타입]. type: num=금액 / pct=비율(파생) / yoy=전년비(파생) / head=소제목
const FIN_ROWS_IS = [
  ["_h", "손익계산서", "head"],
  ["rev", "매출액", "num"], ["_yoy:rev", "전년比", "yoy"],
  ["gp", "매출총이익", "num"], ["_r:gp/rev", "매출총이익률", "pct"],
  ["op", "영업이익", "num"], ["_r:op/rev", "영업이익률", "pct"], ["_yoy:op", "전년比", "yoy"],
  ["ebitda", "EBITDA", "num"], ["_r:ebitda/rev", "EBITDA 마진", "pct"],
  ["pretax", "법인세차감전이익", "num"],
  ["np", "당기순이익", "num"], ["_r:np/rev", "순이익률", "pct"], ["_yoy:np", "전년比", "yoy"],
];
const FIN_ROWS_BS = [
  ["_h", "재무상태표", "head"],
  ["asset", "총자산", "num"], ["ca", "유동자산", "num"], ["nca", "비유동자산", "num"],
  ["liab", "총부채", "num"], ["cl", "유동부채", "num"], ["ncl", "비유동부채", "num"],
  ["equity", "자본총계", "num"], ["cash", "현금및현금성자산", "num"],
];
const FIN_ROWS_CF = [
  ["_h", "현금흐름표", "head"],
  ["cfo", "영업활동 현금흐름", "num"], ["cfi", "투자활동 현금흐름", "num"], ["cff", "재무활동 현금흐름", "num"],
  ["capex_ppe", "설비투자(유형자산취득)", "num"], ["capex_intan", "무형자산취득", "num"],
  ["_fcf", "잉여현금흐름(FCF)", "num"],
];

function finVal(row, key, prevRow) {
  // 파생값 계산: _yoy:x, _r:a/b, _fcf, _h는 별도 처리
  if (key === "_fcf") {
    if (row.fcf != null) return row.fcf;
    if (row.cfo != null) {
      const capex = (row.capex_ppe || 0) + (row.capex_intan || 0);
      return row.cfo - Math.abs(capex);  // KR capex=양수(취득), US capex_ppe=음수 → abs로 통일
    }
    return null;
  }
  if (key.startsWith("_r:")) {
    const [a, b] = key.slice(3).split("/");
    return row[a] != null && row[b] ? (row[a] / row[b]) * 100 : null;
  }
  if (key.startsWith("_yoy:")) {
    const k = key.slice(5);
    return prevRow && prevRow[k] && row[k] != null ? (row[k] / prevRow[k] - 1) * 100 : null;
  }
  return row[key];
}

let finMode = "annual", finFsSel = "cfs", finUnitSel = "mil";  // 기본 단위 = 백만원
// 단위 배율(저장: KR=억원, US=백만$)
// 저장 단위는 KR=억원 / US=백만$ — 표시 배율은 그 기준의 환산값
const FIN_UNITS_KR = { won: ["원", 1e8], mil: ["백만원", 100], bil: ["십억원", 0.1], eok: ["억원", 1] };
const FIN_UNITS_US = { musd: ["백만$", 1], busd: ["십억$", 1e-3], kusd: ["천$", 1e3] };

function finDataOf(fin) {
  // KR 새 포맷 {cfs, ofs} / 구 포맷·US {annual, quarter} 모두 지원
  if (fin.cfs || fin.ofs) {
    const sel = fin[finFsSel] || fin.cfs || fin.ofs;
    return sel || { annual: {} };
  }
  return fin;
}

function renderLookupFinancials(st) {
  const host = $("#lookup-financials");
  const key = `${st.market}_${st.ticker}`;
  host.style.display = "";
  host.innerHTML = `<h3 class="lk-h3">📊 상세 재무제표 <span class="sub-note">불러오는 중…</span></h3>`;
  fetch(`data/financials/${key}.json` + _cb).then((r) => (r.ok ? r.json() : null)).then((fin) => {
    const has = fin && ((fin.annual && Object.keys(fin.annual).length) ||
      (fin.cfs?.annual && Object.keys(fin.cfs.annual).length) ||
      (fin.ofs?.annual && Object.keys(fin.ofs.annual).length));
    if (!has) { host.style.display = "none"; return; }
    FIN_CACHE[key] = fin;
    finMode = "annual";
    // 연결(cfs)이 존재해도 연간 데이터가 별도(ofs)보다 짧으면(신규 연결 편입 등) 더 긴 쪽을 기본 선택
    const cfsN = Object.keys(fin.cfs?.annual || {}).length, ofsN = Object.keys(fin.ofs?.annual || {}).length;
    finFsSel = ofsN > cfsN ? "ofs" : fin.cfs ? "cfs" : "ofs";
    finUnitSel = st.market === "kr" ? "mil" : "musd";   // 한국·미국 모두 '백만' 단위 기본
    ftFs = null;  // Snapshot의 연결/별도 선택도 종목마다 새로 판단(이전 종목 선택이 남지 않게)
    finDraw(st);
    renderFinTrends(st);  // 실적·재무 추이 통합 카드(같은 financials 데이터)
    renderValueBand(st);  // PER/PBR 밴드(같은 financials + 주가 시계열)
  }).catch(() => { host.style.display = "none"; $("#lookup-finq").style.display = "none"; });
}

/* ---------- 📐 PER / PBR 밴드 ----------
   "지금 주가가 이 종목의 역사적 밸류에이션 범위 중 어디인가"를 본다.
   밴드 = 그 시점의 EPS(또는 BPS) × 배수. 실적이 늘면 같은 배수라도 밴드가 올라가므로,
   주가 선이 어느 밴드 사이에 있는지가 곧 그때의 PER/PBR이다.

   ⚠주식수는 financials에 없다 → `순이익 ÷ EPS`(같은 해)로 역산해 **일정하다고 가정**한다.
     밴드 차트의 통상적 근사이며, 대규모 증자·감자가 있었으면 과거 구간이 왜곡될 수 있다(화면에 명시). */
let bandMode = "per";
function renderValueBand(st) {
  const host = $("#lookup-band");
  if (!host) return;
  const key = `${st.market}_${st.ticker}`;
  const fin = FIN_CACHE[key];
  const co = EXTRAS.company?.map?.[key];
  // 연결(cfs) 우선하되 분기가 있는 쪽을 쓴다 — 별도만 공시하는 회사가 있다(두산테스나 등)
  const cand = [fin?.cfs, fin?.ofs, fin].filter((x) => x && (x.annual || x.quarter));
  const src = cand.find((x) => Object.keys(x.quarter || {}).length >= 4) || cand[0];
  const annual = src?.annual || {}, quarter = src?.quarter || {};
  const series = st.series || [];
  if (!Object.keys(annual).length || series.length < 60) { host.style.display = "none"; return; }

  // 주식수: **시가총액 ÷ 주가**가 정확하다(순이익÷EPS는 연결 순이익 vs 지배주주 EPS라 과대 추정).
  const unitMul = st.market === "kr" ? 1e8 : 1e6;      // 억원→원 / 백만$→$
  const tile = (MARKET?.heatmap || []).find((t) => t.m === st.market && t.t === st.ticker);
  const qp = (MARKET?.quotes?.[key] || [])[0];
  let shares = (tile?.mcap && !tile.mcap_est && qp) ? tile.mcap / qp : null;
  if (!shares) {
    const ex = (co?.fin_ext || []).filter((r) => !r.est && r.eps > 0 && r.net);
    if (ex.length) shares = (ex[ex.length - 1].net * unitMul) / ex[ex.length - 1].eps;
  }
  if (!isFinite(shares) || shares <= 0) { host.style.display = "none"; return; }

  const perShare = (v) => (v == null ? null : (v * unitMul) / shares);
  const fcfOf = (d) => (d?.fcf != null ? d.fcf
    : d?.cfo != null ? d.cfo - Math.abs((d.capex_ppe || 0) + (d.capex_intan || 0)) : null);

  /* ── 밴드 기준선의 '적용 시작일' ──────────────────────────────────────
     회계기간이 끝난 날이 아니라 **공시된 날부터** 적용해야 한다. 회기 중에 그 해 확정 실적을
     쓰면 미래 정보를 당겨쓰는 셈(look-ahead)이라 밴드가 실제보다 유리하게 보인다.
     실무 공시 시차: 분기 ~45일 / 연간(사업보고서) ~90일. */
  const asOf = (endY, endM, isAnnual) => {
    const d = new Date(Date.UTC(endY, endM, 1));
    d.setUTCDate(d.getUTCDate() + (isAnnual ? 90 : 45));
    return d.toISOString().slice(0, 10);
  };
  const pointsMap = {};
  Object.keys(annual).sort().forEach((y) => {
    const d = annual[y], yr = +String(y).slice(0, 4);
    if (!yr) return;
    pointsMap[asOf(yr, 12, true)] = {
      eps: perShare(d.np), bps: perShare(d.equity), sps: perShare(d.rev), fps: perShare(fcfOf(d)),
    };
  });
  // 분기 TTM(최근 구간) — 참조 차트처럼 **분기마다 계단**이 생긴다
  const qk = Object.keys(quarter).sort();
  qk.forEach((k, i) => {
    if (i < 3) return;                                    // TTM은 4개 분기가 모여야 성립
    const win = qk.slice(i - 3, i + 1).map((x) => quarter[x]);
    const sum = (f) => win.reduce((a, b) => a + (f(b) ?? NaN), 0);
    const m = /^(\d{2})Q(\d)$/.exec(k);
    if (!m) return;
    const yr = 2000 + +m[1], endM = +m[2] * 3;
    const curq = quarter[k];
    pointsMap[asOf(yr, endM, false)] = {
      eps: perShare(sum((d) => d.np)), bps: perShare(curq.equity),   // BPS는 잔액이라 시점값
      sps: perShare(sum((d) => d.rev)), fps: perShare(sum(fcfOf)),
    };
  });
  const basePts = Object.keys(pointsMap).sort().map((d) => ({ d, ...pointsMap[d] }));
  if (!basePts.length) { host.style.display = "none"; return; }

  const METRICS = [["per", "PER", "eps", "EPS"], ["pbr", "PBR", "bps", "BPS"],
                   ["psr", "PSR", "sps", "주당매출"], ["pfcf", "P/FCF", "fps", "주당FCF"]];
  const cur = METRICS.find((m) => m[0] === bandMode) || METRICS[0];
  const fld = cur[2];
  const tabs = `<span class="mk-toggle" id="band-mode">${METRICS.map(([id, label]) =>
    `<button data-b="${id}" class="${bandMode === id ? "active" : ""}">${label}</button>`).join("")}</span>`;
  // 각 봉 시점에 **그때 공시돼 있던** 최신 기준선을 쓴다(계단형)
  let bi = -1;
  const pts = [];
  series.forEach((b) => {
    while (bi + 1 < basePts.length && basePts[bi + 1].d <= b.t) bi++;
    const base = bi >= 0 ? basePts[bi][fld] : null;
    if (base != null && base > 0) pts.push({ t: b.t, c: b.c, base, mult: b.c / base });
  });
  host.style.display = "";
  if (pts.length < 40) {
    host.innerHTML = `<h3 class="lk-h3">📐 밸류에이션 밴드<span style="flex:1"></span>${tabs}</h3>
      <p class="mini-note">${cur[1]} 밴드를 그릴 데이터가 부족합니다 — ${cur[3]}가 음수이거나 이력이 짧습니다.</p>`;
    bandTabs(host, st);
    return;
  }
  const sorted = pts.map((p) => p.mult).sort((a, b) => a - b);
  const q = (r) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * r))];
  const mults = [...new Set([q(0.1), q(0.3), q(0.5), q(0.7), q(0.9)]
    .map((m) => +m.toFixed(m < 10 ? 2 : 1)))].sort((a, b) => a - b);
  const now = pts[pts.length - 1];
  const pctRank = sorted.filter((m) => m <= now.mult).length / sorted.length * 100;

  const W = 940, H = 320, P = { l: 52, r: 70, t: 14, b: 24 };
  const X = (i) => P.l + (W - P.l - P.r) * (i / Math.max(1, pts.length - 1));
  const all = pts.flatMap((p) => [p.c, ...mults.map((m) => p.base * m)]);
  const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.06 || 1;
  const Y = (v) => P.t + (H - P.t - P.b) * (1 - (v - (lo - pad)) / ((hi + pad) - (lo - pad)));
  const COLORS = ["#4391ff", "#22c07a", "#f0b34c", "#ff8a4c", "#f5445a"];
  // 계단형으로 그린다 — 기준선이 공시일에 점프하므로 직선 보간은 사실과 다르다
  const stepPath = (fn) => {
    let d = "", prev = null;
    pts.forEach((p, i) => {
      const v = fn(p), x = X(i), y = Y(v);
      if (prev === null) d += `${x.toFixed(1)},${y.toFixed(1)}`;
      else if (v !== prev) d += ` ${x.toFixed(1)},${Y(prev).toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`;
      else d += ` ${x.toFixed(1)},${y.toFixed(1)}`;
      prev = v;
    });
    return d;
  };
  const bandLines = mults.map((m, i) => `
      <polyline points="${stepPath((p) => p.base * m)}" fill="none" stroke="${COLORS[i % 5]}"
        stroke-width="1.3" opacity=".85"/>
      <text x="${W - P.r + 4}" y="${Y(pts[pts.length - 1].base * m) + 3.5}" class="cr-end"
        fill="${COLORS[i % 5]}">${m}배</text>`).join("");
  const price = `<polyline points="${pts.map((p, j) => `${X(j).toFixed(1)},${Y(p.c).toFixed(1)}`).join(" ")}"
    fill="none" stroke="#22c07a" stroke-width="2"/>`;
  const grid = [0, .5, 1].map((r) => {
    const v = (lo - pad) + ((hi + pad) - (lo - pad)) * r;
    return `<line x1="${P.l}" y1="${Y(v)}" x2="${W - P.r}" y2="${Y(v)}" stroke="var(--line)"/>
      <text x="${P.l - 5}" y="${Y(v) + 3}" text-anchor="end" class="cr-ax">${fmtPrice(v, st.market)}</text>`;
  }).join("");
  const xl = [0, Math.floor(pts.length / 2), pts.length - 1].map((i) =>
    `<text x="${X(i)}" y="${H - 5}" text-anchor="${i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle"}"
      class="cr-ax">${pts[i].t.slice(0, 7)}</text>`).join("");

  const estRow = finExtOk(co?.fin_ext).filter((r) => r.est && r.eps > 0).slice(-1)[0];
  const nowPx = freshQuote(st)?.price ?? now.c;
  const fwdPer = bandMode === "per" && estRow ? nowPx / estRow.eps : null;
  const fwdHtml = fwdPer && isFinite(fwdPer) && fwdPer > 0
    ? `<span class="band-fwd">선행 PER <b>${fwdPer.toFixed(fwdPer < 10 ? 2 : 1)}배</b>
        <span class="sub-note">(${String(estRow.y).slice(0, 4)} 추정 · 컨센서스)</span></span>` : "";
  const roeRows = Object.keys(annual).sort().map((y) => {
    const d0 = annual[y];
    return d0?.equity ? { y: String(y).slice(0, 4), v: (d0.np / d0.equity) * 100 } : null;
  }).filter((r) => r && isFinite(r.v)).slice(-10);
  let roeHtml = "";
  if (roeRows.length >= 3) {
    const RW = 940, RH = 150, RP = { l: 46, r: 24, t: 16, b: 20 };
    const rv = roeRows.map((r) => r.v);
    const rlo = Math.min(0, ...rv), rhi = Math.max(...rv), rpad = (rhi - rlo) * 0.15 || 1;
    const RX = (i) => RP.l + (RW - RP.l - RP.r) * (i / Math.max(1, roeRows.length - 1));
    const RY = (v) => RP.t + (RH - RP.t - RP.b) * (1 - (v - (rlo - rpad)) / ((rhi + rpad) - (rlo - rpad)));
    const zero = rlo < 0 ? `<line x1="${RP.l}" y1="${RY(0)}" x2="${RW - RP.r}" y2="${RY(0)}"
      stroke="#8b8b93" stroke-dasharray="3 3"/>` : "";
    roeHtml = `<div class="roe-wrap"><div class="lk-h3" style="font-size:.9rem;margin:10px 0 2px">
        📈 ROE 추이 <span class="sub-note">(순이익 ÷ 자본총계)</span></div>
      <svg viewBox="0 0 ${RW} ${RH}" class="fin-svg">${zero}
        <polyline points="${roeRows.map((r, i) => `${RX(i).toFixed(1)},${RY(r.v).toFixed(1)}`).join(" ")}"
          fill="none" stroke="#b79bff" stroke-width="2.2"/>
        ${roeRows.map((r, i) => `<circle cx="${RX(i).toFixed(1)}" cy="${RY(r.v).toFixed(1)}" r="3" fill="#b79bff"/>
          <text x="${RX(i).toFixed(1)}" y="${RY(r.v) - 8}" text-anchor="middle" class="cr-end"
            fill="${r.v >= 0 ? "#b79bff" : "#ff7c8c"}">${r.v.toFixed(1)}%</text>
          <text x="${RX(i).toFixed(1)}" y="${RH - 5}" text-anchor="middle" class="cr-ax">${r.y}</text>`).join("")}
      </svg></div>`;
  }
  const qn = qk.length;
  host.innerHTML = `<h3 class="lk-h3">📐 밸류에이션 밴드
      <span class="sub-note">(밴드 = 그 시점 ${cur[3]} × 배수 · 공시일마다 계단식)</span>
      <span style="flex:1"></span>${tabs}</h3>
    <div class="band-now">현재 <b>${cur[1]} ${now.mult.toFixed(now.mult < 10 ? 2 : 1)}배</b>
      <span class="sub-note">— 지난 ${(pts.length / 252).toFixed(1)}년 중 <b>하위 ${pctRank.toFixed(0)}%</b></span>
      <span class="band-gauge"><span style="width:${Math.min(100, Math.max(0, pctRank))}%"></span></span>
      ${fwdHtml}</div>
    <svg viewBox="0 0 ${W} ${H}" class="fin-svg">${grid}${bandLines}${price}${xl}</svg>
    ${roeHtml}
    <p class="mini-note">초록 선 = 주가 · 계단선 = ${cur[1]} 배수 밴드(이 종목 이력의 10·30·50·70·90 백분위).
      주가가 <b>아래쪽 밴드</b>면 과거 대비 싸고 <b>위쪽</b>이면 비쌉니다.
      기준선은 <b>실적이 공시된 시점부터</b> 반영합니다(분기 +45일·연간 +90일) — 회기 중에 확정 실적을
      쓰면 미래를 당겨쓰는 셈이라 밴드가 실제보다 유리해 보입니다.
      ${qn >= 4 ? `최근 구간은 <b>분기 TTM</b>(${qn}분기)이라 분기마다, 그 이전은 연간이라 해마다 계단이 생깁니다.`
        : `분기 데이터가 ${qn}개뿐이라 <b>연간 기준</b>으로만 계단이 생깁니다.`}
      ⚠주식수는 시가총액÷주가로 산출해 일정하다고 가정 — 증자·감자가 있었다면 과거 구간이 왜곡될 수 있습니다.</p>`;
  bandTabs(host, st);
}

function bandTabs(host, st) {
  host.querySelectorAll("#band-mode button").forEach((b) => b.onclick = () => {
    bandMode = b.dataset.b; renderValueBand(st);
  });
}

/* ---------- 실적·재무 추이 통합 카드 ([실적|성장·이익률|재무안정성|현금흐름] × [연간|분기]) ---------- */
let ftView = "perf", ftMode = "annual", ftFs = "cfs";
const FT_VIEWS = [["perf", "실적"], ["growth", "성장·이익률"], ["stability", "재무안정성"],
                  ["cash", "현금흐름"], ["div", "배당"]];
// Snapshot 표시 단위 — 저장값(KR 억원 / US 백만$) 기준 배율. 상세 재무제표와 동일 체계.
let ftUnitSel = null;
function ftUnits(mk) { return mk === "kr" ? FIN_UNITS_KR : FIN_UNITS_US; }

function ftRows(st) {
  // financials → 기간 오름차순 [{p, rev, op, np, opm, npm, revG, roe, cfo, cfi, cff, debt, cur, fcf}]
  const fin = FIN_CACHE[`${st.market}_${st.ticker}`];
  if (!fin) return [];
  // 연결(cfs)/별도(ofs) — 선택 우선, 없으면 있는 쪽. US는 단일이라 fin 루트 폴백.
  const src = fin[ftFs] || fin.cfs || fin.ofs || fin;
  const data = ftMode === "quarter" ? src.quarter : src.annual;
  if (!data || !Object.keys(data).length) return [];
  const ps = Object.keys(data).sort();
  return ps.map((p, i) => {
    const d = data[p], prev = i > 0 ? data[ps[i - 1]] : null;
    const r = { p: ftMode === "annual" ? p : p, ...d };
    // 🐞⚠분자도 반드시 확인할 것 — `undefined / 5`는 **NaN**이고 NaN은 `!= null` 필터를 통과해
    //   차트 축 계산(max/min)을 통째로 오염시킨다(실사고: 대한항공 순이익 1개년 결측 → 성장률 차트 전체 실종).
    r.opm = d.rev && d.op != null ? (d.op / d.rev) * 100 : null;
    r.npm = d.rev && d.np != null ? (d.np / d.rev) * 100 : null;
    r.revG = prev && prev.rev && d.rev != null ? (d.rev / prev.rev - 1) * 100 : null;  // 연간=전년比, 분기=직전분기比(QoQ)
    r.roe = d.equity && d.np != null ? (d.np * (ftMode === "quarter" ? 4 : 1)) / d.equity * 100 : null;  // 분기=연환산
    r.debt = d.equity && d.liab != null ? (d.liab / d.equity) * 100 : null;
    r.cur = d.cl && d.ca != null ? (d.ca / d.cl) * 100 : null;
    // FCF = 영업활동현금흐름 − CAPEX(유형+무형). US는 fcf 직접 제공, 없으면 계산.
    r.fcf = d.fcf != null ? d.fcf
      : d.cfo != null ? d.cfo - Math.abs((d.capex_ppe || 0) + (d.capex_intan || 0)) : null;
    return r;
  });
}

function renderFinTrends(st) {
  const host = $("#lookup-finq");
  const fin = FIN_CACHE[`${st.market}_${st.ticker}`];
  // 연결/별도 둘 다 데이터 있는지(KR) — 추이(그래프)엔 최소 2개 기간이 필요하므로 1개뿐이면 "없음" 취급하고
  // 다른 쪽(대개 더 긴 이력)으로 자동 전환한다(연결을 신규 편입한 회사가 연결 1개년뿐이라 전체가 숨던 버그 수정).
  const cfsLen = fin?.cfs ? Object.keys((ftMode === "quarter" ? fin.cfs.quarter : fin.cfs.annual) || {}).length : 0;
  const ofsLen = fin?.ofs ? Object.keys((ftMode === "quarter" ? fin.ofs.quarter : fin.ofs.annual) || {}).length : 0;
  const hasCfs = cfsLen >= 2, hasOfs = ofsLen >= 2;
  if (!fin?.[ftFs] || !(ftFs === "cfs" ? hasCfs : hasOfs))
    ftFs = hasCfs ? "cfs" : hasOfs ? "ofs" : (cfsLen >= ofsLen ? "cfs" : "ofs");
  const rows = ftRows(st);
  // 배당 뷰는 financials가 아니라 배당 이력을 쓰므로 rows 조건과 무관하게 먼저 처리한다
  if (ftView === "div") {
    const dv = divPanel(st);
    host.style.display = "";
    host.innerHTML = `<h3 class="lk-h3">📊 Snapshot <span class="sub-note">(배당)</span>
        <span style="flex:1"></span>
        <span class="mk-toggle ft-view">${FT_VIEWS.map(([id, lab]) =>
          `<button data-v="${id}" class="${ftView === id ? "active" : ""}">${lab}</button>`).join("")}</span></h3>
      ${dv || `<p class="mini-note">배당 이력이 없는 종목입니다.</p>`}`;
    host.querySelectorAll(".ft-view button").forEach((b) => b.onclick = () => { ftView = b.dataset.v; renderFinTrends(st); });
    return;
  }
  if (rows.length < 2) { host.style.display = "none"; return; }
  host.style.display = "";
  const _u = ftUnits(st.market);
  if (!ftUnitSel || !_u[ftUnitSel]) ftUnitSel = st.market === "kr" ? "mil" : "musd";  // 기본 백만원
  const [unit, uMul] = _u[ftUnitSel];
  const bothFs = st.market === "kr" && hasCfs && hasOfs;
  const fsNote = st.market === "kr" ? (ftFs === "cfs" ? "연결" : "별도") + " 기준 · " : "";
  const gLab = ftMode === "annual" ? "매출성장률(YoY)" : "매출성장률(QoQ)";
  const roeLab = ftMode === "quarter" ? "ROE(연환산)" : "ROE";

  host.innerHTML = `<h3 class="lk-h3">📊 Snapshot
      <span class="sub-note">(${fsNote}${st.market === "kr" ? "DART" : "yfinance"} · 단위 ${unit})</span>
      <span style="flex:1"></span>
      <span class="mk-toggle ft-view">${FT_VIEWS.map(([id, lab]) =>
        `<button data-v="${id}" class="${ftView === id ? "active" : ""}">${lab}</button>`).join("")}</span>
      ${bothFs ? `<span class="mk-toggle ft-fs">
        <button data-f="cfs" class="${ftFs === "cfs" ? "active" : ""}">연결</button>
        <button data-f="ofs" class="${ftFs === "ofs" ? "active" : ""}">별도</button>
      </span>` : ""}
      <span class="mk-toggle ft-mode">
        <button data-m="annual" class="${ftMode === "annual" ? "active" : ""}">연간</button>
        <button data-m="quarter" class="${ftMode === "quarter" ? "active" : ""}">분기</button>
      </span>
      <select id="ft-unit" title="단위">${Object.entries(_u).map(([k, [lab]]) =>
        `<option value="${k}"${k === ftUnitSel ? " selected" : ""}>${lab}</option>`).join("")}</select></h3>
    <div id="ft-chart"></div><div id="ft-table"></div>`;
  host.querySelectorAll(".ft-view button").forEach((b) => b.onclick = () => { ftView = b.dataset.v; renderFinTrends(st); });
  host.querySelectorAll(".ft-mode button").forEach((b) => b.onclick = () => { ftMode = b.dataset.m; renderFinTrends(st); });
  host.querySelectorAll(".ft-fs button").forEach((b) => b.onclick = () => { ftFs = b.dataset.f; renderFinTrends(st); });
  const ftu = document.getElementById("ft-unit");
  if (ftu) ftu.onchange = () => { ftUnitSel = ftu.value; renderFinTrends(st); };

  // 재무안정성은 라인 2개뿐이라 더 크게(사용자 요청) — 뷰별 높이
  const H = ftView === "stability" ? 360 : 300;
  const W = 940, padL = 10, padR = 46, padT = 30, padB = 30;
  const n = rows.length, gw = (W - padL - padR) / n;
  const plotH = H - padT - padB;
  // 표시 단위 적용 — 작은 단위(십억원 등)에선 소수 1자리까지 보여줘야 값이 0으로 죽지 않는다
  const nf = (v) => {
    if (v == null) return "-";
    const x = v * uMul;
    return Math.abs(x) < 100 && x !== 0 ? x.toFixed(1) : Math.round(x).toLocaleString();
  };
  const pf = (v, d = 1) => v == null ? "-" : (v >= 0 ? "+" : "") + v.toFixed(d) + "%";
  /* 차트 막대 라벨 — **선택한 단위의 숫자를 그대로** 쓴다.
     ⚠'만' 같은 임의 축약을 붙이면 아래 표의 값과 달라 보여 혼란스럽다(사용자 지적). */
  const ftNum = (x) => {
    if (x == null) return "";
    const a = Math.abs(x);
    return a >= 100 || a === 0 ? Math.round(x).toLocaleString()
      : a < 1 ? x.toFixed(2) : x.toFixed(1);
  };

  /* ---- 값 라벨 겹침 해소 ----
     막대·라인 라벨을 그리는 자리에서 바로 <text>를 뱉으면 서로 모르는 채 같은 자리에 찍힌다
     (사용자 제보: 매출 옆 이익률, 인접 막대의 값이 포개짐). → 전부 모아 두고 마지막에
     자리를 잡아 그린다. 세로로 밀어 피하고, 끝내 못 피하면 그 라벨만 생략(숫자는 아래 표에 있다). */
  const ftLbl = [];
  const pushLbl = (x, y, text, fill, size = 10.5, dir = -1, prio = 1) =>
    ftLbl.push({ x, y, text, fill, size, dir, prio });
  const placeLabels = () => {
    // 폭 추정이 실제보다 좁으면 겹침이 남는다 → 0.58 + 좌우 1px 여유(실측 후 조정한 값)
    const box = (l, x, y) => {
      const w = String(l.text).length * l.size * 0.58 + 2;
      return { x1: x - w / 2, x2: x + w / 2, y1: y - l.size + 1, y2: y + 1.5 };
    };
    const hit = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
    const placed = [];
    let svg = "";
    const emit = (l, x, y) => {
      placed.push(box(l, x, y));
      svg += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${l.size}" text-anchor="middle" fill="${l.fill}">${l.text}</text>`;
    };
    // 우선순위 높은 것(축 → 막대 값 → 라인 %)부터 자리를 잡고, 나머지가 비켜간다
    [...ftLbl].sort((a, b) => b.prio - a.prio).forEach((l) => {
      if (l.fixed) { emit(l, l.x, l.y); return; }   // 축 기간 라벨 — 자리만 선점하고 안 움직임
      const step = l.size * 0.9;
      // ①선호 방향으로 멀어지며 ②반대 방향도 시도 ③그래도 없으면 좌우로 조금 밀어본다
      for (let i = 0; i < 14; i++) {
        for (const dy of (i === 0 ? [0] : [l.dir * i * step, -l.dir * i * step])) {
          for (const dx of [0, -7, 7, -14, 14, -21, 21]) {
            const x = l.x + dx, y = l.y + dy;
            if (y < 9 || y > H - 21) continue;      // 위: 차트 밖 / 아래: 기간 축 라벨 침범 방지
            if (!placed.some((p) => hit(p, box(l, x, y)))) { emit(l, x, y); return; }
          }
        }
      }
      // 끝내 자리가 없을 때만 생략(숫자는 아래 표에 그대로 있다)
    });
    return svg;
  };

  // ---- 막대+라인 콤보 도우미 ----
  const barGroup = (keys, colors, labels, withLabel = false) => {
    // ⚠`!= null`만으로는 NaN이 통과해 max/min이 NaN이 되고 전 좌표가 깨진다 → 유한값만 남긴다
    const vals = rows.flatMap((r) => keys.map((k) => r[k])).filter((v) => Number.isFinite(v));
    if (!vals.length) return "";
    const maxV = Math.max(...vals, 0), minV = Math.min(...vals, 0);
    const yS = (v) => padT + (maxV - v) / (maxV - minV || 1) * plotH;
    const y0 = yS(0);
    const bw = Math.min(16, gw / (keys.length + 1.2));
    let svg = `<line x1="${padL}" y1="${y0}" x2="${W - padR}" y2="${y0}" stroke="#3a3a44"/>`;
    rows.forEach((r, i) => {
      const cx = padL + gw * i + gw / 2;
      keys.forEach((k, j) => {
        const v = r[k];
        if (!Number.isFinite(v)) return;   // NaN 방어(값 결측 연도)
        const x = cx + (j - (keys.length - 1) / 2) * (bw + 2) - bw / 2;
        const y = yS(Math.max(0, v)), h2 = Math.abs(yS(v) - y0);
        svg += `<rect x="${x}" y="${v >= 0 ? yS(v) : y0}" width="${bw}" height="${Math.max(1, h2)}" fill="${colors[j]}" rx="1.5"/>`;
        // 값 라벨 — 양수는 막대 위, 음수는 아래가 기본. 겹치면 placeLabels가 더 밀어낸다
        if (withLabel) pushLbl(x + bw / 2, v >= 0 ? yS(v) - 4 : yS(v) + 11,
          ftNum(v * uMul), colors[j], 10.5, v >= 0 ? -1 : 1, 2);
      });
      ftLbl.push({ x: cx, y: H - 9, text: r.p, fill: "#8b8b93", size: 11.5, dir: 0, prio: 9, fixed: true });
    });
    const legend = keys.map((k, j) => `<span style="color:${colors[j]}">■</span> ${labels[j]}`).join("  ");
    return { svg, legend, yS };
  };
  const lineOn = (keys, colors, labels, dash = []) => {
    // ⚠`!= null`만으로는 NaN이 통과해 max/min이 NaN이 되고 전 좌표가 깨진다 → 유한값만 남긴다
    const vals = rows.flatMap((r) => keys.map((k) => r[k])).filter((v) => Number.isFinite(v));
    if (!vals.length) return { svg: "", legend: "" };
    const maxV = Math.max(...vals), minV = Math.min(...vals, 0);
    const pad2 = (maxV - minV) * 0.15 || 5;
    const yS = (v) => padT + (maxV + pad2 - v) / (maxV - minV + pad2 * 2 || 1) * plotH;
    let svg = "";
    keys.forEach((k, j) => {
      const pts = rows.map((r, i) => (Number.isFinite(r[k]) ? [padL + gw * i + gw / 2, yS(r[k]), r[k]] : null)).filter(Boolean);
      if (pts.length < 2) return;
      svg += `<polyline points="${pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ")}"
        fill="none" stroke="${colors[j]}" stroke-width="2"${dash[j] ? ` stroke-dasharray="${dash[j]}"` : ""}/>`
        + pts.map((p) => {
          pushLbl(p[0], p[1] + (j % 2 ? 16 : -8),
            p[2].toFixed(Math.abs(p[2]) >= 100 ? 0 : 1) + "%", colors[j], 10.5, j % 2 ? 1 : -1, 1);
          return `<circle cx="${p[0]}" cy="${p[1]}" r="2.2" fill="${colors[j]}"/>`;
        }).join("");
    });
    // 기간 라벨(막대 없을 때) — 값 라벨이 피해가도록 고정 장애물로 등록
    rows.forEach((r, i) => ftLbl.push({ x: padL + gw * i + gw / 2, y: H - 10, text: r.p,
      fill: "#8b8b93", size: 9.5, dir: 0, prio: 9, fixed: true }));
    const legend = keys.map((k, j) => `<span style="color:${colors[j]}">●─</span> ${labels[j]}`).join("  ");
    return { svg, legend };
  };

  let chartSvg = "", legend = "";
  if (ftView === "perf") {
    // 매출·영업이익·순이익 막대 + 이익률 라인(우축 스케일 별도)
    const bg = barGroup(["rev", "op", "np"], ["#4391ff", "#22c07a", "#9d7bff"], ["매출", "영업이익", "순이익"], true);
    const mVals = rows.flatMap((r) => [r.opm, r.npm]).filter((v) => v != null);
    let lineSvg = "";
    if (mVals.length) {
      const mMax = Math.max(...mVals, 1), mMin = Math.min(...mVals, 0);
      const yM = (v) => padT + (mMax - v) / (mMax - mMin || 1) * plotH * 0.6;  // 위 60% 영역에 라인
      [["opm", "#f0b34c"], ["npm", "#ff8c9a"]].forEach(([k, c], j) => {
        const pts = rows.map((r, i) => (Number.isFinite(r[k]) ? [padL + gw * i + gw / 2, yM(r[k]), r[k]] : null)).filter(Boolean);
        if (pts.length < 2) return;
        lineSvg += `<polyline points="${pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ")}" fill="none" stroke="${c}" stroke-width="1.8" stroke-dasharray="${j ? "4 3" : ""}"/>`;
        pts.forEach((p) => pushLbl(p[0], p[1] - 5, p[2].toFixed(1) + "%", c, 9, j ? 1 : -1, 1));
      });
    }
    chartSvg = (bg.svg || "") + lineSvg;
    legend = (bg.legend || "") + `  <span style="color:#f0b34c">─</span> 영업이익률  <span style="color:#ff8c9a">┄</span> 순이익률`;
  } else if (ftView === "growth") {
    const r1 = lineOn(["revG", "opm", "npm"], ["#4391ff", "#f0b34c", "#ff8c9a"], [gLab, "영업이익률", "순이익률"]);
    chartSvg = r1.svg; legend = r1.legend;
  } else if (ftView === "stability") {
    const r1 = lineOn(["debt", "cur"], ["#e0912f", "#3f6fb5"], ["부채비율", "유동비율"]);
    chartSvg = r1.svg; legend = r1.legend;
  } else {
    // 영업·투자·재무 그룹막대 + FCF(잉여현금흐름) 라인 오버레이(같은 스케일)
    const bg = barGroup(["cfo", "cfi", "cff", "fcf"], ["#22c07a", "#5b8def", "#9aa4b2", "#f0b34c"],
      ["영업활동", "투자활동", "재무활동", "FCF"], true);
    let fcfLine = "";
    if (bg.yS) {
      const pts = rows.map((r, i) => (r.fcf != null ? [padL + gw * i + gw / 2, bg.yS(r.fcf)] : null)).filter(Boolean);
      if (pts.length > 1) fcfLine = `<polyline points="${pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ")}"
        fill="none" stroke="#f0b34c" stroke-width="2.2"/>` + pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.6" fill="#f0b34c"/>`).join("");
    }
    chartSvg = (bg.svg || "") + fcfLine;
    legend = `<span style="color:#22c07a">■</span> 영업활동  <span style="color:#5b8def">■</span> 투자활동  <span style="color:#9aa4b2">■</span> 재무활동  <span style="color:#f0b34c">●─</span> FCF(잉여현금흐름)  <span class="sub-note">(${unit})</span>`;
  }
  // 값 라벨은 도형을 전부 그린 뒤 겹치지 않게 배치해 맨 위에 얹는다
  $("#ft-chart").innerHTML = chartSvg
    ? `<svg viewBox="0 0 ${W} ${H}" class="fin-svg">${chartSvg}${placeLabels()}</svg><p class="legend">${legend}</p>`
    : `<p class="mini-note">이 분류의 데이터가 없습니다.</p>`;

  // ---- 뷰별 표(그래프 아래) — 각 분류의 데이터를 그대로 수치로 ----
  const PCT = new Set(["opm", "npm", "revG", "roe", "debt", "cur"]);
  const SPECS = {
    perf: [["rev", "매출액"], ["op", "영업이익"], ["np", "순이익"], ["opm", "영업이익률"], ["npm", "순이익률"], ["revG", gLab], ["roe", roeLab]],
    growth: [["revG", gLab], ["op", "영업이익"], ["opm", "영업이익률"], ["np", "순이익"], ["npm", "순이익률"], ["roe", roeLab]],
    stability: [["asset", "총자산"], ["liab", "총부채"], ["equity", "자본총계"], ["debt", "부채비율"], ["cur", "유동비율"], ["cash", "현금성자산"]],
    cash: [["cfo", "영업활동"], ["cfi", "투자활동"], ["cff", "재무활동"], ["fcf", "잉여현금흐름(FCF)"]],
  };
  const specs = SPECS[ftView] || SPECS.perf;
  $("#ft-table").innerHTML = `<div class="fin-wrap" style="margin-top:8px"><table class="fin-table"><thead><tr>
      <th class="fin-lab">지표</th>${rows.map((r) => `<th>${r.p}</th>`).join("")}</tr></thead><tbody>` +
    specs.map(([k, lab]) => {
      const isPct = PCT.has(k);
      const cells = rows.map((r) => {
        const v = r[k];
        const txt = isPct ? pf(v) : nf(v);
        return `<td>${v != null && (isPct || k === "cfi" || k === "cff" || k === "fcf")
          ? `<span class="${v >= 0 ? "pos" : "neg"}">${txt}</span>` : txt}</td>`;
      }).join("");
      return `<tr><td class="fin-lab">${lab}</td>${cells}</tr>`;
    }).join("") + `</tbody></table></div>`;
}

function finPeriods(fin, mode) {
  const data0 = finDataOf(fin);
  if (mode === "quarter" && data0.quarter && Object.keys(data0.quarter).length) {
    return { periods: Object.keys(data0.quarter).sort(), data: data0.quarter, mode };
  }
  const est = fin.est || {};
  const annual = data0.annual || {};
  const actualYrs = Object.keys(annual).sort();
  const estYrs = Object.keys(est).filter((y) => !annual[y]).sort();
  const data = { ...annual };
  estYrs.forEach((y) => (data[y] = { ...est[y], _est: true }));
  return { periods: [...actualYrs, ...estYrs], data, mode: "annual" };
}

function finDraw(st) {
  const host = $("#lookup-financials");
  const key = `${st.market}_${st.ticker}`;
  const fin = FIN_CACHE[key];
  if (!fin) return;
  const units = st.market === "kr" ? FIN_UNITS_KR : FIN_UNITS_US;
  // 시장을 옮기면 이전 단위(백만$ 등)가 안 맞는다 → 그 시장의 '백만' 단위로(첫 키 'won'이 아니라)
  if (!units[finUnitSel]) finUnitSel = st.market === "kr" ? "mil" : "musd";
  const [unitLab, unitMul] = units[finUnitSel];
  const src = st.market === "kr" ? "DART" : "yfinance";
  const { periods, data, mode } = finPeriods(fin, finMode);
  finMode = mode;
  const d0 = finDataOf(fin);
  const hasQuarter = d0.quarter && Object.keys(d0.quarter).length;
  const hasBothFs = fin.cfs && fin.ofs;

  const rowsDef = [...FIN_ROWS_IS, ...FIN_ROWS_BS, ...FIN_ROWS_CF];
  const nf = (v, isPct) => v == null ? "-" : isPct
    ? `<span class="${v >= 0 ? "pos" : "neg"}">${v >= 0 ? "+" : ""}${v.toFixed(1)}%</span>`
    : Math.round(v * unitMul).toLocaleString();
  let body = "";
  rowsDef.forEach(([k, lab, type]) => {
    if (type === "head") { body += `<tr class="fin-head"><td colspan="${periods.length + 1}">${lab}</td></tr>`; return; }
    const cells = periods.map((p, i) => {
      const row = data[p] || {};
      const prev = i > 0 ? data[periods[i - 1]] : null;
      const v = finVal(row, k, prev);
      if ((type === "pct" || type === "yoy") && row._est) return `<td>-</td>`;
      return `<td>${nf(v, type === "pct" || type === "yoy")}</td>`;
    });
    if (cells.every((c) => c === "<td>-</td>")) return;
    body += `<tr class="${type === "yoy" || type === "pct" ? "fin-sub" : ""}"><td class="fin-lab">${lab}</td>${cells.join("")}</tr>`;
  });
  const cols = periods.map((p) => {
    const isEst = data[p]?._est;
    return `<th class="${isEst ? "fin-est" : ""}">${mode === "annual" ? p + (isEst ? "(E)" : "") : p}</th>`;
  }).join("");
  host.innerHTML = `<h3 class="lk-h3">📊 상세 재무제표
      <span class="sub-note">(${src}${st.market === "kr" ? ` · ${finFsSel === "cfs" ? "연결" : "별도"} 기준 · 추정=네이버 컨센서스` : ""})</span>
      <span style="flex:1"></span>
      ${hasBothFs ? `<span class="mk-toggle fin-fs">
        <button data-fs="cfs" class="${finFsSel === "cfs" ? "active" : ""}">연결</button>
        <button data-fs="ofs" class="${finFsSel === "ofs" ? "active" : ""}">별도</button>
      </span>` : (st.market === "kr" ? `<span class="sub-note">${fin.cfs ? "연결만 공시" : "별도만 공시"}</span>` : "")}
      <span class="mk-toggle fin-mode">
        <button data-m="annual" class="${mode === "annual" ? "active" : ""}">연간</button>
        ${hasQuarter ? `<button data-m="quarter" class="${mode === "quarter" ? "active" : ""}">분기</button>` : ""}
      </span>
      <select id="fin-unit" title="단위">${Object.entries(units).map(([k, [lab]]) =>
        `<option value="${k}"${k === finUnitSel ? " selected" : ""}>${lab}</option>`).join("")}</select>
      <button class="today-chart-btn" id="fin-xlsx">⬇ 엑셀</button></h3>
    <div class="fin-wrap"><table class="fin-table">
      <thead><tr><th class="fin-lab">지표</th>${cols}</tr></thead><tbody>${body}</tbody></table></div>`;
  host.querySelectorAll(".fin-mode button").forEach((b) => b.onclick = () => { finMode = b.dataset.m; finDraw(st); });
  host.querySelectorAll(".fin-fs button").forEach((b) => b.onclick = () => { finFsSel = b.dataset.fs; finDraw(st); });
  const us = document.getElementById("fin-unit");
  if (us) us.onchange = () => { finUnitSel = us.value; finDraw(st); };
  $("#fin-xlsx").onclick = () => finExportXlsx(st, finMode);
}

function finExportXlsx(st, mode) {
  const btn = $("#fin-xlsx");
  btn.textContent = "생성 중…";
  finLoadXlsx().then(() => {
    const key = `${st.market}_${st.ticker}`, raw = FIN_CACHE[key];
    // ⚠KR 새 포맷은 {cfs:{annual,quarter}, ofs:{…}} — 화면과 같은 finDataOf를 거쳐야 한다
    // (여기서 raw.annual을 직접 읽어 undefined가 나면 아래 catch가 '라이브러리 로드 실패'로 오인해 표시했다)
    const fin = finDataOf(raw), est0 = raw.est || fin.est || {};
    const unit = st.market === "kr" ? "억원" : "백만$";
    let periods, data;
    if (mode === "quarter" && fin.quarter) { periods = Object.keys(fin.quarter).sort(); data = fin.quarter; }
    else {
      const est = est0, ann = fin.annual || {}, act = Object.keys(ann).sort();
      const ey = Object.keys(est).filter((y) => !ann[y]).sort();
      periods = [...act, ...ey]; data = { ...ann }; ey.forEach((y) => data[y] = { ...est[y], _est: true });
    }
    if (!periods.length) throw new Error("no-periods");
    const wb = XLSX.utils.book_new();
    const sheet = (rowsDef, name) => {
      const aoa = [["지표", ...periods.map((p) => p + (data[p]?._est ? "(E)" : ""))]];
      rowsDef.forEach(([k, lab, type]) => {
        if (type === "head") { aoa.push([lab]); return; }
        const cells = periods.map((p, i) => {
          const row = data[p] || {}, prev = i > 0 ? data[periods[i - 1]] : null;
          if ((type === "pct" || type === "yoy") && row._est) return null;
          const v = finVal(row, k, prev);
          return v == null ? null : (type === "pct" || type === "yoy" ? +v.toFixed(2) : Math.round(v));
        });
        if (cells.every((c) => c == null)) return;
        aoa.push([lab, ...cells]);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
    };
    sheet(FIN_ROWS_IS, "손익계산서");
    sheet(FIN_ROWS_BS, "재무상태표");
    sheet(FIN_ROWS_CF, "현금흐름표");
    const nm = st.market === "kr" ? st.name : st.ticker;
    XLSX.writeFile(wb, `${nm}_재무제표_${mode === "annual" ? "연간" : "분기"}_${unit}.xlsx`);
    btn.textContent = "⬇ 엑셀";
  }).catch((e) => {
    // ⚠원인을 구분해서 알린다 — 예전엔 표 생성 중 오류까지 '라이브러리 로드 실패'로 표시돼 엉뚱한 데를 봤다
    btn.textContent = "⬇ 엑셀";
    if (!window.XLSX) alert("엑셀 라이브러리를 불러오지 못했습니다 — 네트워크를 확인해 주세요.");
    else if (String(e?.message) === "no-periods") alert("내려받을 재무 데이터가 없습니다.");
    else { console.error("[xlsx]", e); alert("엑셀 생성 중 오류: " + (e?.message || e)); }
  });
}

function finLoadXlsx() {
  if (window.XLSX) return Promise.resolve();
  if (finXlsxLoading) return finXlsxLoading;
  finXlsxLoading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
  return finXlsxLoading;
}

function renderLookupReports(st) {
  const host = $("#lookup-reports");
  const fd = EXTRAS.feed?.map?.[`${st.market}_${st.ticker}`];
  const reps = fd?.reports || [];
  if (!reps.length) { host.style.display = "none"; return; }
  host.style.display = "";
  const esc = (s) => String(s ?? "").replace(/</g, "&lt;");
  if (st.market === "kr") {
    // 증권사 리서치 — 한경 컨센서스(목표가·투자의견·애널리스트·PDF) 우선, 네이버(미리보기) 폴백
    const isHankyung = reps.some((r) => r.target != null || r.opinion || r.analyst);
    const priceKo = (v) => v == null ? "" : v.toLocaleString() + "원";
    host.innerHTML = `<h3 class="lk-h3">📑 증권사 리포트 <span class="sub-note">(${isHankyung ? "한경 컨센서스 · 전 증권사" : "네이버 리서치"} · 최신순)</span></h3>
      <div class="lk-reports">` + reps.map((r) => `<a class="lk-rep" href="${r.link}" target="_blank" rel="noopener">
        <div class="lk-rep-top"><span class="lk-rep-broker">${esc(r.broker)}</span><span class="lk-rep-date">${esc(r.d)}</span></div>
        <div class="lk-rep-title">${esc(r.title)}</div>
        ${(r.target != null || r.opinion || r.analyst) ? `<div class="lk-rep-meta">
          ${r.opinion ? `<span class="lk-rep-op">${esc(r.opinion)}</span>` : ""}
          ${r.target != null ? `<span>목표 ${priceKo(r.target)}</span>` : ""}
          ${r.analyst ? `<span class="sub-note">${esc(r.analyst)}</span>` : ""}</div>` : ""}
        ${r.preview ? `<div class="lk-rep-prev">${esc(r.preview)}</div>` : ""}</a>`).join("") + `</div>
      <p class="sub-note" style="margin:6px 0 0">클릭 시 ${isHankyung ? "리포트 원문 PDF 다운로드" : "네이버 리서치 상세(PDF 가능)"}</p>`;
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

/* ---------- 🤔 AI 변동 사유 (v220) — 주가·공시·뉴스·수급을 근거로 Gemini가 설명 ----------
   키: localStorage 'gemini_key' — youtube-mentor(같은 origin)와 공유. 브라우저 밖으로 안 나감.
   원칙: **제공한 자료 안에서만** 답하게 강제하고, 일반 지식 추정은 [추정]으로 표시시킨다(환각 억제). */
let whyRange = "5";
// ⚠모델 은퇴 주의: gemini-2.5-flash·2.0-flash는 신규 발급 키에 제공 중단(404 "no longer available
//   to new users"). 2026-08-01 키 교체 때 사이트·봇·멘토가 동시에 멈춘 원인 — 바꿀 땐 실제 호출로 검증.
const GEMINI_MODEL = "gemini-3.5-flash";
function geminiKey() {
  return localStorage.getItem("gemini_key") || window.GEMINI_API_KEY || "";
}
/* 대화 스레드(v237) — 한 번 묻고 끝이 아니라 "그럼 그때 수급은?" 식 후속 질문을 이어간다.
   종목이 바뀌면 초기화. WHY_WIN은 직전에 사용한 구간이라, 기간을 안 적은 후속 질문도 같은 구간을 본다. */
let WHY_LOG = [];
let WHY_WIN = null;
function renderLookupWhy(st) {
  const host = $("#lookup-why");
  if (!host) return;
  host.style.display = "";
  WHY_LOG = []; WHY_WIN = null;
  $("#why-out").style.display = "none";
  $("#why-out").innerHTML = "";
  if (host.dataset.bound) return;
  host.dataset.bound = "1";
  document.querySelectorAll("#why-range button").forEach((b) => b.onclick = () => {
    whyRange = b.dataset.r;
    document.querySelectorAll("#why-range button").forEach((x) => x.classList.toggle("active", x === b));
  });
  $("#why-key").onclick = () => {
    const cur = geminiKey();
    const v = prompt("Gemini API 키 (aistudio.google.com/apikey 무료 발급 · 이 브라우저에만 저장)", cur || "");
    if (v != null && v.trim()) { localStorage.setItem("gemini_key", v.trim()); alert("저장됨"); }
  };
  $("#why-go").onclick = () => whyAsk();
  $("#why-q").addEventListener("keydown", (e) => { if (e.key === "Enter") whyAsk(); });
  const cl = $("#why-clear");
  if (cl) cl.onclick = () => { WHY_LOG = []; WHY_WIN = null; whyRenderThread(); };
}

/* 스레드 렌더 — 질문/답변을 순서대로 쌓아 보여준다 */
function whyRenderThread(pending) {
  const out = $("#why-out");
  if (!out) return;
  const esc = (x) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const md = (x) => esc(x).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/^[-*]\s+(.+)$/gm, "<li>$1</li>").replace(/\n/g, "<br>").replace(/<\/li><br>/g, "</li>");
  if (!WHY_LOG.length && !pending) { out.style.display = "none"; out.innerHTML = ""; return; }
  out.style.display = "";
  /* 본문의 [#n]을 클릭 가능한 근거 배지로, 실제 인용된 번호만 하단 목록에 싣는다 */
  const cite = (html, refs) => {
    if (!refs?.length) return { html, used: [] };
    const used = new Set();
    const out2 = html.replace(/\[#\s*(\d+(?:\s*#\s*\d+)*)\]/g, (mm, grp) => {
      const ns = grp.split("#").map((x) => parseInt(x.trim(), 10)).filter(Boolean);
      const links = ns.map((n) => {
        const r = refs.find((x) => x.n === n);
        if (!r) return "";
        used.add(n);
        return r.url ? `<a class="why-ref" href="${r.url}" target="_blank" rel="noopener" title="${esc(r.d + " " + r.src + " · " + r.title)}">#${n}</a>`
          : `<span class="why-ref off" title="${esc(r.d + " " + r.title)}">#${n}</span>`;
      }).filter(Boolean).join("");
      return links || "";
    });
    return { html: out2, used: refs.filter((r) => used.has(r.n)) };
  };
  out.innerHTML = WHY_LOG.map((m, i) => {
    const ct = cite(md(m.a), m.refs);
    return `
    <div class="why-turn">
      <div class="why-q">${i === 0 ? "" : "↳ "}${esc(m.q)}</div>
      <div class="lk-why-ans">${ct.html}</div>
      ${ct.used.length ? `<div class="why-refs"><b>근거 원문</b>${ct.used.map((r) =>
        `<div class="why-ref-row"><span class="why-ref-n">#${r.n}</span><span class="sub-note">${esc(r.d)} ${esc(r.src)}</span>
          ${r.url ? `<a href="${r.url}" target="_blank" rel="noopener">${esc(r.title)} ↗</a>` : `<span>${esc(r.title)}</span>`}</div>`).join("")}</div>` : ""}
      ${m.srcs?.length ? `<p class="sub-note">🔎 검색 출처: ${m.srcs.map((w) =>
        `<a class="ext-link" href="${w.uri}" target="_blank" rel="noopener">${esc((w.title || "링크").slice(0, 30))}</a>`).join(" · ")}</p>` : ""}
      ${m.foot ? `<p class="sub-note">${m.foot}</p>` : ""}
    </div>`; }).join("") +
    (pending ? `<div class="why-turn"><div class="why-q">${esc(pending)}</div>
      <p class="mini-note">자료 취합·분석 중…</p></div>` : "") +
    (WHY_LOG.length ? `<p class="sub-note why-hint">이어서 더 물어보세요 — 같은 구간을 기준으로 답합니다
      (예: 그때 수급은 어땠어? · 지금은 어때?)</p>` : "");
  out.scrollTop = out.scrollHeight;
}

/* 질문 속 기간("25년 11월"/"2025년 11월"/"2025년") 자동 인식 → 그 기간의 일봉으로 창을 좁힌다(v223).
   기간을 좁혀야 급락일 상세가 자료에 실려 과거 질문에 답할 수 있다(YG 2025-11 실사고). */
function whyParsePeriod(q, s) {
  if (!q) return null;
  let m = q.match(/(\d{2,4})\s*년\s*(\d{1,2})\s*월/);
  let pfx = null;
  if (m) {
    const y = +m[1] < 100 ? +m[1] + 2000 : +m[1];
    pfx = `${y}-${String(m[2]).padStart(2, "0")}`;
  } else if ((m = q.match(/(\d{4})\s*년(?!\s*\d{1,2}\s*월)/))) {
    pfx = m[1];
  }
  if (!pfx) return null;
  const win = s.filter((x) => x.t.startsWith(pfx));
  return win.length >= 2 ? win : null;
}

/* 같은 기간 동종업계 등락(v227) — "업종 전체가 빠졌나, 이 종목만 빠졌나"를 자료로 판별.
   피어 종목 JSON을 받아 동일 창의 수익률 계산(최대 4개, 캐시). */
const PEER_SERIES = {};
/* 과거 뉴스 아카이브(v228) — data/stocknews/{key}.json (네이버 종목뉴스 1년치 헤드라인).
   feed.json은 최근 1주뿐이고 무료 등급 Gemini는 검색이 막혀 있어(429), 과거 구간 질문의 유일한 근거다. */
const STOCK_NEWS = {};
async function loadStockNews(key) {
  if (!(key in STOCK_NEWS)) {
    try {
      const d = await fetch(`data/stocknews/${key}.json` + _cb).then((r) => (r.ok ? r.json() : null));
      STOCK_NEWS[key] = d?.news || null;
    } catch (e) { STOCK_NEWS[key] = null; }
  }
  return STOCK_NEWS[key];
}
async function whyPeerMoves(st, fromT, toT) {
  const co = EXTRAS.company?.map?.[`${st.market}_${st.ticker}`];
  const peers = (co?.peers || []).slice(0, 4);
  const out = [];
  for (const pr of peers) {
    const k = `${pr.mk || st.market}_${pr.ticker}`;
    if (!(k in PEER_SERIES)) {
      try {
        const d = await fetch(`data/stocks/${k}.json` + _cb).then((r) => (r.ok ? r.json() : null));
        PEER_SERIES[k] = normStock(d)?.series || null;
      } catch (e) { PEER_SERIES[k] = null; }
    }
    const s = PEER_SERIES[k];
    if (!s?.length) continue;
    const w = s.filter((x) => x.t >= fromT && x.t <= toT);
    if (w.length < 2) continue;
    const ch = (w[w.length - 1].c / w[0].c - 1) * 100;
    out.push(`${pr.name} ${ch >= 0 ? "+" : ""}${ch.toFixed(1)}%`);
  }
  return out;
}

/* 분기 실적 — 구간 직전·중·직후를 함께(v227). 발표 시점이 구간 안이면 그게 하락의 직접 원인 후보이고,
   구간 '이후' 분기는 시장이 무엇을 선반영했는지 사후 검증하는 근거가 된다. */
function whyQuarters(st, fromT, toT) {
  const co = EXTRAS.company?.map?.[`${st.market}_${st.ticker}`];
  const fq = co?.fin_q || [];
  if (!fq.length) return null;
  // '25Q3' → 그 분기 실적발표 대략 시점(분기말 +40일)으로 구간과의 전후 판정
  const endOf = (q) => {
    const m = /^(\d{2})Q(\d)$/.exec(q);
    if (!m) return null;
    const y = 2000 + +m[1], mo = +m[2] * 3;
    const d = new Date(Date.UTC(y, mo, 0));
    d.setUTCDate(d.getUTCDate() + 40);
    return d.toISOString().slice(0, 10);
  };
  const unit = co.fin_unit || "억원";
  const line = (q, i) => {
    const prev = fq[i - 1];
    const qoq = prev?.op != null && q.op != null && Math.abs(prev.op) > 1
      ? ` (전분기 영업익 ${prev.op.toLocaleString()}→${q.op.toLocaleString()}, ${((q.op / prev.op - 1) * 100).toFixed(0)}%)` : "";
    return `${q.q}${q.est ? "(추정)" : ""} 매출 ${q.rev?.toLocaleString() ?? "-"} · 영업익 ${q.op?.toLocaleString() ?? "-"}` +
      `${q.opm != null ? `(OPM ${q.opm}%)` : ""} · 순이익 ${q.np?.toLocaleString() ?? "-"}${qoq}`;
  };
  const before = [], during = [], after = [];
  fq.forEach((q, i) => {
    const d = endOf(q.q);
    if (!d) return;
    (d < fromT ? before : d <= toT ? during : after).push(line(q, i));
  });
  return { unit, before: before.slice(-2), during, after: after.slice(0, 2) };
}

function whyContext(st, qwin) {
  const s = st.series || [];
  let from, to = s.length ? s[s.length - 1].t : null;
  if (whyRange === "view" && lookupChart) {
    const r = lookupChart.timeScale().getVisibleRange();
    if (r) { from = typeof r.from === "string" ? r.from : null; to = typeof r.to === "string" ? r.to : to; }
  }
  const n = whyRange === "21" ? 21 : 5;
  const win = qwin || (from ? s.filter((x) => x.t >= from && x.t <= to) : s.slice(-n));
  if (win.length < 2) return null;
  const f = win[0], l = win[win.length - 1];
  const chg = (l.c / f.c - 1) * 100;
  const hi = win.reduce((a, x) => (x.h > a.h ? x : a), win[0]);
  const lo = win.reduce((a, x) => (x.l < a.l ? x : a), win[0]);
  // 거래량 급증일 상위 2 (구간 평균 대비)
  const avgV = win.reduce((a, x) => a + (x.v || 0), 0) / win.length || 1;
  const volDays = [...win].sort((a, b) => (b.v || 0) - (a.v || 0)).slice(0, 2)
    .map((x) => `${x.t}(평균의 ${((x.v || 0) / avgV).toFixed(1)}배, 종가 ${x.c >= (win[Math.max(0, win.indexOf(x) - 1)]?.c ?? x.c) ? "상승" : "하락"})`);
  const key = `${st.market}_${st.ticker}`;
  const fd = EXTRAS.feed?.map?.[key] || {};
  const disc = (fd.disc || []).filter((d) => d.d >= f.t && d.d <= l.t).slice(0, 25)
    .map((d) => `${d.d} ${d.title.trim()}`);
  const news = (fd.news || []).slice(0, 10).map((x) => `${x.t} ${x.title.replace(/&[a-z]+;/g, " ")}`);
  const sup = st.supply || [];
  const sw = sup.filter((x) => x.t >= f.t && x.t <= l.t);
  let supTxt = "";
  if (st.market === "kr" && sw.length >= 2) {
    const d0 = sw[0], d1 = sw[sw.length - 1];
    const dv = (a, b) => (a == null || b == null) ? null : Math.round(a - b);
    const fc = dv(d1.fc, d0.fc), ic = dv(d1.ic, d0.ic), pc = dv(d1.pc, d0.pc);
    supTxt = `외국인 ${fc != null ? (fc >= 0 ? "+" : "") + fc.toLocaleString() + "억" : "-"} · 기관 ${ic != null ? (ic >= 0 ? "+" : "") + ic.toLocaleString() + "억" : "-"}${pc != null ? ` · 개인 ${(pc >= 0 ? "+" : "") + pc.toLocaleString() + "억"}` : ""}`;
  }
  const sigs = (st.markers || []).filter((m) => m.t >= f.t && m.t <= l.t).slice(-6)
    .map((m) => `${m.t} ${m.side === "buy" ? "매수" : "매도"}신호(${m.rule_id})`);
  // 일별 등락 상세(v223): 구간 내 최대 급락 3일·급등 2일 — "그 달에 무슨 일이"의 핵심 자료
  const days = [];
  for (let i = 1; i < win.length; i++)
    days.push({ t: win[i].t, ch: (win[i].c / win[i - 1].c - 1) * 100, v: win[i].v || 0 });
  const fmtD = (d) => `${d.t}(${d.ch >= 0 ? "+" : ""}${d.ch.toFixed(1)}%)`;
  const drops = [...days].sort((a, b) => a.ch - b.ch).slice(0, 3).filter((d) => d.ch < -1).map(fmtD);
  const jumps = [...days].sort((a, b) => b.ch - a.ch).slice(0, 2).filter((d) => d.ch > 1).map(fmtD);
  // 구간이 오래된 과거면 최신 뉴스는 오히려 오답을 유도한다 → 자료에서 제외
  const isOld = s.length && l.t < s[s.length - 1].t.slice(0, 8) + "01" &&
    (new Date(s[s.length - 1].t) - new Date(l.t)) / 864e5 > 30;
  const co = EXTRAS.company?.map?.[key];
  return { f, l, chg, hi, lo, volDays, disc, news: isOld ? [] : news, isOld, drops, jumps, supTxt, sigs,
           quarters: whyQuarters(st, f.t, l.t), cons: co?.cons, metrics: co?.metrics,
           name: st.name, tk: st.ticker, mk: st.market };
}

/* 429(RATE_LIMIT) 응답의 권장 대기시간을 읽어낸다. 무료 등급은 분당 한도가 낮아 고정 4초 백오프로는
   연속 질문에서 계속 실패했다(실측) → 서버가 알려주는 retryDelay를 쓰고, 없으면 지수 백오프. */
async function gemRetryWait(res, attempt) {
  let sec = 0;
  try {
    const j = await res.clone().json();
    for (const d of j.error?.details || []) {
      const m = /^(\d+(?:\.\d+)?)s$/.exec(d.retryDelay || "");
      if (m) sec = Math.max(sec, parseFloat(m[1]));
    }
  } catch (e) { /* 본문 파싱 실패 시 기본 백오프 */ }
  if (!sec) sec = 6 * (attempt + 1);
  await new Promise((r) => setTimeout(r, Math.min(45, sec + 1) * 1000));
  return sec;
}

/* ⚠무료 등급은 **모델별로** 한도가 따로 걸린다(2026-08-01 실측: gemini-3.5-flash = 하루 20회,
   소진돼도 3.6-flash·flash-latest·3.1-flash-lite는 그대로 응답). 한 모델이 429면 다음 모델로 넘겨
   실질 사용량을 몇 배로 늘린다. 소진된 모델은 세션 동안 건너뛴다.
   think0=false 모델은 thinkingBudget 지정을 거부하므로 사고가 켜진 채로 돌고, 출력 한도를 넉넉히 준다. */
const GEMINI_CHAIN = [
  { id: "gemini-3.5-flash", think0: true },
  { id: "gemini-3.6-flash", think0: false },
  { id: "gemini-flash-latest", think0: false },
  { id: "gemini-3.1-flash-lite", think0: true },
  { id: "gemini-flash-lite-latest", think0: false },
];
const GEM_DEAD = new Set();          // 이번 세션에서 한도 소진이 확인된 모델

/* 프롬프트 1건을 체인으로 호출. {text, srcs, model} 반환. 모두 실패하면 예외. */
async function gemCall(prompt, opts = {}) {
  const key = geminiKey();
  if (!key) throw new Error("NO_KEY");
  const maxT = opts.maxTokens || 1600;
  let search = !!opts.search;
  let lastErr = null;
  for (const m of GEMINI_CHAIN) {
    if (GEM_DEAD.has(m.id)) continue;
    for (let attempt = 0; attempt < 2; attempt++) {
      const body = { contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: m.think0 ? maxT : Math.max(maxT, 3600) } };
      if (m.think0) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
      if (search) body.tools = [{ google_search: {} }];
      let res;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m.id}:generateContent?key=${key}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      } catch (e) { lastErr = e; break; }
      if (res.status === 429) {
        if (search) { search = false; continue; }   // 검색 그라운딩만 막힌 경우
        GEM_DEAD.add(m.id);                          // 이 모델 한도 소진 → 다음 모델로
        lastErr = new Error("RATE_LIMIT");
        if (opts.onSwitch) opts.onSwitch(m.id);
        break;
      }
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        lastErr = new Error(j?.error?.message || res.status);
        break;    // 400(파라미터 거부) 등 → 다음 모델
      }
      const cand = j?.candidates?.[0];
      const text = cand?.content?.parts?.map((x) => x.text || "").join("") || "";
      if (!text) { lastErr = new Error("빈 응답(" + (cand?.finishReason || "?") + ")"); break; }
      return { text, model: m.id,
        srcs: (cand?.groundingMetadata?.groundingChunks || []).map((g) => g.web).filter(Boolean).slice(0, 5) };
    }
  }
  throw lastErr || new Error("모든 모델 실패");
}

let WHY_BUSY = false;
async function whyAsk() {
  const st = LOOKUP_ST;
  if (!st || WHY_BUSY) return;   // 연타 방지(무료 등급 쿼터 보호)
  const out = $("#why-out");
  const key = geminiKey();
  if (!key) {
    out.style.display = "";
    out.innerHTML = `<p class="mini-note">🔑 버튼으로 Gemini API 키를 먼저 등록하세요 —
      <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>에서 무료 발급(1분).
      키는 이 브라우저에만 저장되며 서버로 전송되지 않습니다.</p>`;
    return;
  }
  WHY_BUSY = true;
  const q0 = ($("#why-q").value || "").trim();
  const q = q0 || `이 구간에서 주가가 움직인 사유를 자료 기반으로 설명해줘.`;
  $("#why-q").value = "";
  whyRenderThread(q);
  await loadExtras();                       // 공시·뉴스 컨텍스트
  // 기간: 질문에 명시가 있으면 그것, 없으면 **직전 질문에서 쓴 구간**을 이어 쓴다(후속 질문 대응)
  const qwin = whyParsePeriod(q, st.series || []) || (WHY_LOG.length ? WHY_WIN : null);
  const c = whyContext(st, qwin);
  if (!c) { WHY_LOG.push({ q, a: "구간 데이터가 부족합니다." }); whyRenderThread(); WHY_BUSY = false; return; }
  WHY_WIN = qwin;
  const peerMoves = await whyPeerMoves(st, c.f.t, c.l.t);   // 업종 동반 하락 여부
  // 구간 당시 뉴스 헤드라인(아카이브) — 급락일 ±1일 기사를 앞쪽에 배치해 인과 판단을 돕는다
  const arc = await loadStockNews(`${st.market}_${st.ticker}`);
  /* 출처(REF): 자료마다 번호를 매겨 모델에게 주고, 답변의 [#n]을 코드가 실제 링크로 바꾼다.
     모델이 URL을 직접 쓰게 하면 없는 주소를 지어낸다(deal-radar에서 검증된 패턴). */
  const refs = [];
  let arcNews = [];
  if (arc) {
    const inWin = arc.filter((x) => x[0] >= c.f.t && x[0] <= c.l.t);
    const keyDays = new Set(c.drops.concat(c.jumps).map((s) => s.slice(0, 10)));
    const near = (d) => { for (const k of keyDays) { const gap = Math.abs(new Date(d) - new Date(k)) / 864e5; if (gap <= 1) return true; } return false; };
    const hot = inWin.filter((x) => near(x[0])), rest = inWin.filter((x) => !near(x[0]));
    arcNews = hot.concat(rest).slice(0, 40).map((x) => {
      refs.push({ n: refs.length + 1, d: x[0], src: x[1], title: x[2],
        url: x[3] ? `https://n.news.naver.com/article/${x[3]}` : null });
      return `[#${refs.length}] ${x[0]} [${x[1]}] ${x[2]}`;
    });
  }
  // 공시도 같은 번호 체계에 넣는다(DART 원문 링크 보유)
  const fdRef = EXTRAS.feed?.map?.[`${st.market}_${st.ticker}`];
  const discRefs = (fdRef?.disc || []).filter((d) => d.d >= c.f.t && d.d <= c.l.t).slice(0, 15)
    .map((d) => {
      refs.push({ n: refs.length + 1, d: d.d, src: "공시", title: d.title.trim(), url: d.link || null });
      return `[#${refs.length}] ${d.d} ${d.title.trim()}`;
    });
  const hist = WHY_LOG.slice(-3).map((m) => `질문: ${m.q}\n답변요지: ${m.a.slice(0, 300)}`).join("\n---\n");
  const prompt = `당신은 한국 주식 리서치 어시스턴트다. 아래 [자료]를 1차 근거로 답하라.
${hist ? `\n[직전 대화] 아래는 같은 종목·구간에 대한 앞선 문답이다. 후속 질문이면 맥락을 이어서,\n이미 말한 내용은 반복하지 말고 새로 물은 것에 집중해 답하라.\n${hist}\n` : ""}
규칙: ①[자료]의 수치·날짜를 우선 인용할 것 ②자료에 없는 그 시기의 사건·원인을 보완할 때는 출처를 구분해 표시:
**실제 구글 검색 결과에 근거한 문장만 [검색]**, 검색 도구를 쓰지 않고 네 지식으로 서술하면 반드시 [추정]
(검색 도구가 제공되지 않은 요청에서는 [검색]을 절대 쓰지 말 것) ③확신이 없으면 단정 대신 [추정]
④결론 3~6문장 → 그 아래 "근거:" 불릿(자료·검색의 날짜·항목 인용) ⑤과장·투자권유 금지, 한국어.
${qwin ? `※질문의 기간(${c.f.t.slice(0, 7)})을 인식해 자료를 그 기간으로 좁혔다.` : ""}

[자료] ${c.name}(${c.tk}) ${c.f.t} ~ ${c.l.t}
- 주가: ${c.f.c.toLocaleString()} → ${c.l.c.toLocaleString()} (${c.chg >= 0 ? "+" : ""}${c.chg.toFixed(1)}%) · 구간 최고 ${c.hi.h.toLocaleString()}(${c.hi.t}) · 최저 ${c.lo.l.toLocaleString()}(${c.lo.t})
${c.drops.length ? `- 급락일: ${c.drops.join(" / ")}` : ""}
${c.jumps.length ? `- 급등일: ${c.jumps.join(" / ")}` : ""}
- 거래량 급증일: ${c.volDays.join(" / ") || "없음"}
${c.supTxt ? `- 수급(구간 누적): ${c.supTxt}` : ""}
${c.sigs.length ? `- 기술 신호: ${c.sigs.join(" / ")}` : ""}
${peerMoves.length ? `- 동종업계 같은 기간 등락: ${peerMoves.join(" · ")}` : ""}
${c.quarters ? `- 분기 실적(단위 ${c.quarters.unit}):
${c.quarters.before.map((x) => `    · 구간 직전 발표 — ${x}`).join("\n")}
${c.quarters.during.map((x) => `    · **구간 중 발표** — ${x}`).join("\n")}
${c.quarters.after.map((x) => `    · 구간 이후 발표(사후 확인용) — ${x}`).join("\n")}` : ""}
${c.cons ? `- 컨센서스(최신 ${c.cons.at || "-"} 기준, 구간 당시 값 아님): 목표주가 ${c.cons.target?.toLocaleString()} · 투자의견 ${c.cons.opinion ?? "-"}/5` : ""}
${c.metrics ? `- 밸류에이션(현재): PER ${c.metrics.per ?? "-"} · PBR ${c.metrics.pbr ?? "-"} · ROE ${c.metrics.roe ?? "-"}%` : ""}
${discRefs.length ? `- 공시(구간 내 ${discRefs.length}건):\n${discRefs.map((x) => `    · ${x}`).join("\n")}`
  : `- 공시(구간 내 ${c.disc.length}건): ${c.disc.join(" | ") || "없음"}`}
${arcNews.length ? `- **구간 당시 뉴스 헤드라인**(${arcNews.length}건, 급락·급등일 전후 우선):
${arcNews.map((x) => `    · ${x}`).join("\n")}` : `- ${c.isOld ? "구간 당시 뉴스 자료 없음" : `최근 뉴스 헤드라인: ${c.news.join(" | ") || "없음"}`}`}

[분석 지침]
- **근거로 쓴 뉴스·공시는 문장 끝에 그 항목의 번호를 [#3] 또는 [#7 #12] 형태로 반드시 표기하라.**
  자료에 실제로 있는 번호만 쓰고, 없는 번호를 지어내지 말 것(번호는 링크로 바뀐다).
- **뉴스 헤드라인이 있으면 그것이 1차 근거다.** 헤드라인에 드러난 사건·업종 분위기·증권사 코멘트를
  구체적으로 인용해 서술하라(날짜·매체 포함). 자료에 있는 내용을 [추정]으로 얼버무리지 말 것.
- **실적 수치가 좋아 보이는데 주가가 빠졌다면** 그 점을 먼저 짚고, 기대치(컨센서스) 대비 미달·향후 가이던스·
  일회성 요인·차익실현 같은 가능성을 자료 범위에서 따져라. 실적이 좋았다는 사실을 얼버무리지 말 것.
- **동종업계가 함께 빠졌으면 업종·시장 요인**, 이 종목만 빠졌으면 개별 요인으로 명확히 구분해 서술하라.
- **구간 이후 분기 실적**이 자료에 있으면, 당시 하락이 이후 실적 둔화를 선반영한 것인지 사후 평가하라.
- 급락일과 공시일이 일치하면 인과를 우선 검토하되, 공시 제목만으로 단정하지 말 것.

[질문] ${q || `이 구간에서 주가가 ${c.chg >= 0 ? "오른" : "내린"} 사유를 자료 기반으로 설명해줘.`}`;
  try {
    const r = await gemCall(prompt, { maxTokens: 2600, search: true,
      onSwitch: () => whyRenderThread(`${q}  (모델 한도 — 다른 모델로 전환 중…)`) });
    const ans = r.text, srcs = r.srcs;
    WHY_LOG.push({ q, a: ans, srcs, refs,
      foot: `${c.f.t}~${c.l.t} 구간 · 근거: 주가·공시·수급·분기실적·동종업계${arcNews.length ? ` · 당시 뉴스 ${arcNews.length}건` : ""}` });
    whyRenderThread();
  } catch (e) {
    WHY_LOG.push({ q, a: `분석 실패: ${String(e.message || e).slice(0, 140)}` });
    whyRenderThread();
  }
  WHY_BUSY = false;
}


function renderLookupFeed(st) {
  const wrap = $("#lookup-feed");
  const fd = EXTRAS.feed?.map?.[`${st.market}_${st.ticker}`];
  if (!fd || (!fd.disc?.length && !fd.news?.length)) { wrap.style.display = "none"; return; }
  wrap.style.display = "grid";
  // 공시는 1년 전량(최대 120건)을 담는다 → 기본 12건만 보이고 나머지는 '더 보기'로 펼친다
  const discRow = (d) => `<div class="lk-feed-row"><span class="lk-feed-date">${d.d.slice(2)}</span>
        ${d.link ? `<a href="${d.link}" target="_blank" rel="noopener">${d.title}</a>` : `<span>${d.title}</span>`}</div>`;
  const dl = fd.disc || [];
  $("#lookup-disc").innerHTML = dl.length
    ? dl.slice(0, 12).map(discRow).join("")
      + (dl.length > 12
        ? `<details class="lk-feed-more"><summary>+ ${dl.length - 12}건 더 보기 <span class="sub-note">(최근 1년)</span></summary>
             ${dl.slice(12).map(discRow).join("")}</details>`
        : "")
    : `<p class="mini-note">최근 1년 공시 없음</p>`;
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
        pfSnapshot();          // 가져올 때마다 그날 보유를 이력에 적재(시계열 차트 소스)
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

/* ── 📅 보유 시계열 — 스냅샷 누적 + 토스 체결 역산 ──────────────────────────
   cp_portfolio_v2는 '현재 시점 스냅샷'이라 과거가 없다. 두 갈래로 이력을 만든다.
   ① 앞으로: 가져오기·저장 때마다 그날 보유를 cp_pf_hist_v1에 적재(시간이 갈수록 정확해짐)
   ② 과거:  토스 체결내역(90일)으로 현재 보유에서 거꾸로 되감아 복원
   ⚠90일 이전 매매는 API가 주지 않으므로 복원 불가 — 그 구간은 '가장 오래된 복원 시점'이 시작선. */
const PFH_KEY = "cp_pf_hist_v1";
function pfHistLoad() {
  try { const d = JSON.parse(localStorage.getItem(PFH_KEY)); if (d && d.snaps) return d; } catch (e) {}
  return { snaps: {} };
}
function pfHistSave(d) { localStorage.setItem(PFH_KEY, JSON.stringify(d)); }
const pfDay = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
// 오늘 보유를 스냅샷으로 적재(같은 날 재저장은 덮어씀)
function pfSnapshot() {
  const hs = pfHoldings();
  if (!hs.length) return;
  const d = pfHistLoad();
  d.snaps[pfDay(new Date())] = hs.map((h) => ({ t: h.ticker, m: h.mk, n: h.name, q: +h.qty || 0 }));
  pfHistSave(d);
}
// 체결내역 역산 → {날짜: 보유맵} + 편입/제외 이벤트
function pfBackfill() {
  const orders = (tossLoad()?.orders || []).slice()
    .filter((o) => o.filledAt && o.ticker && +o.qty > 0)
    .sort((a, b) => String(b.filledAt).localeCompare(String(a.filledAt)));   // 최신 → 과거
  const cur = {}, meta = {};
  pfHoldings().forEach((h) => { cur[h.ticker] = +h.qty || 0; meta[h.ticker] = { mk: h.mk, name: h.name }; });
  const states = [{ d: pfDay(new Date()), q: { ...cur } }], events = [], trades = [];
  const q = { ...cur };
  orders.forEach((o) => {
    const t = String(o.ticker), day = String(o.filledAt).slice(0, 10);
    const after = q[t] || 0;                                     // 되감기 전 = 그 거래 '직후' 수량
    q[t] = after + (o.side === "BUY" ? -(+o.qty) : +(+o.qty));   // 주문 '직전' 상태로 되감기
    if (q[t] < 1e-9) delete q[t];
    const before = q[t] || 0;
    if (!meta[t]) meta[t] = { mk: /^\d{6}$/.test(t) ? "kr" : "us", name: t };
    // 편입 = 직전 보유 0에서 매수 / 제외 = 매도 후 보유 0
    const type = o.side === "BUY" ? (before > 0 ? "add" : "in") : (after > 0 ? "trim" : "out");
    if (type === "in") events.push({ d: day, t, type: "in", name: meta[t].name });
    if (type === "out") events.push({ d: day, t, type: "out", name: meta[t].name });
    trades.push({ d: day, t, name: meta[t].name, mk: meta[t].mk, side: o.side,
                  qty: +o.qty, price: +o.price || null, before, after, type });
    states.push({ d: day, q: { ...q } });      // 그날 거래 직전 상태
  });
  trades.sort((a, b) => a.d.localeCompare(b.d));
  return { states, events, trades, meta, from: states[states.length - 1]?.d };
}
// 날짜별 보유 수량 — 스냅샷(정확) 우선, 없으면 역산 상태를 계단식으로 채움
function pfHistDaily() {
  const bf = pfBackfill();
  const snaps = pfHistLoad().snaps;
  const marks = {};                       // 날짜 → 보유맵
  bf.states.forEach((s) => { marks[s.d] = s.q; });
  Object.entries(snaps).forEach(([d, arr]) => {
    marks[d] = arr.reduce((a, x) => { if (x.q > 0) a[x.t] = x.q; return a; }, {});
    arr.forEach((x) => { if (!bf.meta[x.t]) bf.meta[x.t] = { mk: x.m, name: x.n || x.t }; });
  });
  const days = Object.keys(marks).sort();
  return { marks, days, meta: bf.meta, events: bf.events, trades: bf.trades, from: days[0] };
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

/* ---------- 보유 포트폴리오 분석(상단): 수익추이·산업비중·구성 요약 ---------- */
const HLD_SERIES = {};   // 종목 시계열 캐시(수익추이용)
const HLD_COLORS = ["#4391ff", "#f5445a", "#22c07a", "#f0b34c", "#9d7bff", "#38bdf8", "#fb923c", "#a3e635"];

/* 세분 산업 분류 — 투자자 언어(빅테크·반도체 메모리 등).
   ①종목 오버라이드 → ②국내 밸류체인 단계 → ③미국 GICS 한글 → ④히트맵 업종 폴백 */
const HLD_FINE_TICKER = {
  // 미국 — 큐레이션(밸류체인 데이터가 국내 전용이라 미국은 직접 매핑)
  us_AAPL: "빅테크", us_MSFT: "빅테크", us_GOOGL: "빅테크", us_AMZN: "빅테크", us_META: "빅테크",
  us_NVDA: "AI 반도체", us_AMD: "AI 반도체", us_AVGO: "AI 반도체", us_MRVL: "AI 반도체", us_ARM: "AI 반도체",
  us_SMCI: "AI 서버·인프라", us_DELL: "AI 서버·인프라", us_ANET: "AI 서버·인프라",
  us_MU: "반도체 메모리", us_WDC: "반도체 메모리",
  us_INTC: "반도체 종합", us_QCOM: "반도체 종합", us_TXN: "반도체 종합", us_ADI: "반도체 종합", us_ON: "반도체 종합",
  us_AMAT: "반도체 장비", us_LRCX: "반도체 장비", us_KLAC: "반도체 장비",
  us_TSLA: "전기차", us_RIVN: "전기차", us_LCID: "전기차", us_F: "자동차", us_GM: "자동차",
  us_CRM: "소프트웨어·클라우드", us_ORCL: "소프트웨어·클라우드", us_ADBE: "소프트웨어·클라우드",
  us_NOW: "소프트웨어·클라우드", us_SNOW: "소프트웨어·클라우드", us_PLTR: "소프트웨어·클라우드",
  us_DDOG: "소프트웨어·클라우드", us_INTU: "소프트웨어·클라우드", us_SHOP: "소프트웨어·클라우드",
  us_CRWD: "사이버보안", us_PANW: "사이버보안", us_ZS: "사이버보안", us_NET: "사이버보안",
  us_PYPL: "핀테크·거래소", us_COIN: "핀테크·거래소", us_HOOD: "핀테크·거래소", us_SOFI: "핀테크·거래소",
  us_AFRM: "핀테크·거래소", us_MSTR: "핀테크·거래소", us_V: "결제 네트워크", us_MA: "결제 네트워크", us_AXP: "결제 네트워크",
  us_NFLX: "미디어·스트리밍", us_DIS: "미디어·스트리밍", us_CMCSA: "미디어·스트리밍", us_ROKU: "미디어·스트리밍",
  us_RBLX: "게임·메타버스", us_DKNG: "게임·베팅", us_PINS: "소셜·광고", us_SNAP: "소셜·광고", us_TTD: "소셜·광고",
  us_ABNB: "여행·플랫폼", us_BKNG: "여행·플랫폼", us_MAR: "여행·호텔", us_DAL: "항공", us_CCL: "여행·크루즈",
  us_UBER: "모빌리티 플랫폼", us_DASH: "배달 플랫폼", us_CVNA: "이커머스·리테일",
  us_ENPH: "신재생에너지", us_FSLR: "신재생에너지", us_PLUG: "신재생에너지", us_NEE: "유틸리티",
  us_LLY: "제약·비만치료제", us_ISRG: "의료기기", us_SYK: "의료기기", us_MDT: "의료기기", us_ABT: "의료기기",
  us_UNH: "헬스케어 보험", us_ELV: "헬스케어 보험", us_CI: "헬스케어 보험",
  us_LMT: "방산·우주", us_RTX: "방산·우주", us_BA: "항공우주",
  // 국내 — 대표 종목 직접 지정(밸류체인 단계보다 직관적인 라벨)
  kr_005930: "반도체 메모리", kr_000660: "반도체 메모리", kr_005935: "반도체 메모리",
  kr_035420: "인터넷 플랫폼", kr_035720: "인터넷 플랫폼",
  kr_005380: "완성차", kr_000270: "완성차", kr_012330: "자동차 부품",
  kr_207940: "바이오 CDMO", kr_068270: "바이오시밀러",
  kr_373220: "2차전지 셀", kr_006400: "2차전지 셀", kr_051910: "화학·소재",
  kr_105560: "은행", kr_055550: "은행", kr_086790: "은행", kr_316140: "은행",
  kr_032830: "보험", kr_000810: "보험",
  kr_352820: "엔터·K팝", kr_041510: "엔터·K팝", kr_035900: "엔터·K팝", kr_122870: "엔터·K팝",
  kr_012450: "방산·우주", kr_047810: "방산·우주", kr_064350: "방산·우주",
  kr_329180: "조선", kr_042660: "조선", kr_010140: "조선",
  kr_034020: "발전·원전 설비", kr_267260: "발전·전력기기", kr_010120: "전력기기",
};
// 국내 밸류체인 단계 key → 세분 라벨(오버라이드에 없는 종목). key는 CHAINS의 실제 stage.key.
const CHAIN_FINE = {
  design: "반도체 팹리스", fe_mat: "반도체 소재", fe_equip: "반도체 장비", foundry: "반도체 메모리",
  be_equip: "반도체 장비", osat: "반도체 후공정", substrate: "반도체 기판", semi_etc: "반도체 기타",
  disp_parts: "디스플레이 부품",
  mineral: "2차전지 소재", cathode: "2차전지 소재", bmat: "2차전지 소재", bequip: "2차전지 장비", cell: "2차전지 셀",
  parts: "자동차 부품", parts_etc: "자동차 부품", tire: "타이어", oem: "완성차", oem_etc: "완성차",
  biotech: "신약·바이오", bio_etc: "바이오 기타", cdmo: "바이오 CDMO", pharma: "제약", pharma_etc: "제약",
  device: "의료기기", device_etc: "의료기기", dx: "진단",
  dmat: "디스플레이 소재", dmod: "디스플레이 부품", panel: "디스플레이 패널", panel_etc: "디스플레이 기타",
  dparts: "방산 부품", system: "방산·우주", defense_etc: "방산 기타",
  sequip: "조선 기자재", yard: "조선", shipping: "해운", ship_etc: "조선·해운 기타",
  petro: "정유·석유화학", fine: "정밀화학", steel: "철강", nonferrous: "비철금속",
  chem_etc: "화학 기타", metal_etc: "금속 기타", packaging: "포장재",
  cmat: "건자재", cmat_etc: "건자재", build: "건설", build_etc: "건설", realestate: "부동산·리츠",
  platform: "인터넷 플랫폼", game: "게임", ent: "엔터·K팝", telecom: "통신", adcomm: "광고·미디어",
  itsvc: "IT 서비스", telecom_eq: "통신장비", media_etc: "미디어 기타",
  bank: "은행", sec: "증권", insure: "보험", vc: "벤처캐피탈",
  sec_etc: "증권", insure_etc: "보험", fin_etc: "기타 금융",
  food: "식음료", cosmetic: "화장품", retail: "유통", fashion: "패션",
  food_etc: "식음료", cosmetic_etc: "화장품", fashion_etc: "패션", retail_etc: "유통",
  oil: "에너지", eequip: "전력기기", util: "유틸리티",
  machine: "기계", elec: "전기·전자", indsvc: "산업 서비스", transport: "운송·물류",
};
// 미국 GICS(영문/한글) → 세분 폴백
const US_FINE_SECTOR = {
  "Information Technology": "IT·기술", "Health Care": "헬스케어", "Financials": "금융",
  "Consumer Discretionary": "임의소비재", "Consumer Staples": "필수소비재", "Communication Services": "커뮤니케이션",
  "Industrials": "산업재", "Energy": "에너지", "Materials": "소재", "Utilities": "유틸리티", "Real Estate": "부동산",
};

let _chainIndex = null;   // {code: stageKey} — CHAINS의 codes 배열에서 1회 구축
function chainStageOf(code) {
  if (!_chainIndex) {
    _chainIndex = {};
    Object.values(typeof CHAINS !== "undefined" ? CHAINS : {}).forEach((cfg) => {
      (cfg.stages || []).forEach((st) => (st.codes || []).forEach((c) => {
        if (!_chainIndex[c]) _chainIndex[c] = st.key;
      }));
    });
  }
  return _chainIndex[code];
}

function hldFineSector(h) {
  const key = `${h.mk}_${h.ticker}`;
  if (HLD_FINE_TICKER[key]) return HLD_FINE_TICKER[key];
  if (h.mk === "kr") {
    const st = chainStageOf(h.ticker);
    if (st && CHAIN_FINE[st]) return CHAIN_FINE[st];
  }
  const t = (MARKET?.heatmap || []).find((x) => x.m === h.mk && x.t === h.ticker);
  if (h.mk === "us" && t?.sector && US_FINE_SECTOR[t.sector]) return US_FINE_SECTOR[t.sector];
  return t?.sector || (h.lev ? "레버리지·ETF" : "기타");
}

/* 📅 보유 비중 변화 — 100% 누적 영역(종목별/산업별) + 편입▲·제외▼ 마커 */
/* 🧾 종목별 매매 추이 — 계단형 보유 수량 + 매매 마커(편입·증량·감량·전량매도) */
const HLD_TRADE_KO = { in: ["편입", "#22c07a"], add: ["증량", "#4391ff"],
                       trim: ["감량", "#f0b34c"], out: ["전량매도", "#f5445a"] };
function renderHldTrades(host) {
  const hist = pfHistDaily();
  const tr = hist.trades || [];
  if (!tr.length) {
    host.innerHTML = `<p class="mini-note">체결 이력이 없습니다 — 토스 동기화 파일(체결내역 포함)을 가져오면
      최근 90일 매매가 종목별로 표시됩니다.</p>`;
    return;
  }
  const start = hist.days[0], end = pfDay(new Date());
  const dayN = Math.max(1, (new Date(end) - new Date(start)) / 864e5);
  const X = (d) => (new Date(d) - new Date(start)) / 864e5 / dayN;   // 0~1
  // 종목별 수량 변화 경로 만들기(거래 시점마다 계단)
  const byT = {};
  tr.forEach((t) => (byT[t.t] = byT[t.t] || []).push(t));
  const cur = {};
  pfHoldings().forEach((h) => { cur[h.ticker] = +h.qty || 0; });
  const rows = Object.entries(byT).map(([t, ts]) => {
    const pts = [{ x: 0, q: ts[0].before }];
    ts.forEach((x) => { pts.push({ x: X(x.d), q: x.before }); pts.push({ x: X(x.d), q: x.after }); });
    pts.push({ x: 1, q: cur[t] != null ? cur[t] : ts[ts.length - 1].after });
    const mx = Math.max(...pts.map((p) => p.q), 1);
    return { t, ts, pts, mx, meta: hist.meta[t] || { mk: "kr", name: t },
             now: pts[pts.length - 1].q, first: ts[0].d };
  }).sort((a, b) => (b.now > 0 ? 1 : 0) - (a.now > 0 ? 1 : 0) || a.first.localeCompare(b.first));
  const W = 560, H = 34;
  host.innerHTML = `<div class="hld-tr-head sub-note">${start} ~ ${end} · 선 높이 = 그 종목의 보유 수량
      · ${Object.entries(HLD_TRADE_KO).map(([k, [ko, c]]) => `<i style="background:${c}"></i>${ko}`).join(" ")}</div>
    <div class="hld-trs">${rows.map((r) => {
      const Y = (q) => 4 + (H - 8) * (1 - q / r.mx);
      const line = r.pts.map((p, i) => `${(p.x * W).toFixed(1)},${Y(p.q).toFixed(1)}`).join(" ");
      const marks = r.ts.map((x) => {
        const [ko, c] = HLD_TRADE_KO[x.type];
        return `<g><circle cx="${(X(x.d) * W).toFixed(1)}" cy="${Y(x.after).toFixed(1)}" r="4" fill="${c}"
          stroke="var(--card)" stroke-width="1.2"/><title>${x.d} · ${ko} ${x.qty.toLocaleString()}주${
          x.price ? ` @ ${x.price.toLocaleString()}` : ""} → 보유 ${x.after.toLocaleString()}주</title></g>`;
      }).join("");
      const last = r.ts[r.ts.length - 1];
      return `<button class="hld-tr" data-key="${r.meta.mk}_${r.t}">
        <img src="${logoUrl(r.meta.mk, r.t)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <span class="hld-tr-nm">${r.meta.name}</span>
        <svg viewBox="0 0 ${W} ${H}" class="hld-tr-svg" preserveAspectRatio="none">
          <line x1="0" y1="${H - 4}" x2="${W}" y2="${H - 4}" stroke="var(--line)"/>
          <polyline points="${line}" fill="none" stroke="#8b8b93" stroke-width="1.6"/>${marks}</svg>
        <span class="hld-tr-now ${r.now > 0 ? "" : "gone"}">${r.now > 0
          ? r.now.toLocaleString() + "주" : "전량매도"}</span>
        <span class="hld-tr-last sub-note">${last.d.slice(5)} ${HLD_TRADE_KO[last.type][0]}</span>
      </button>`;
    }).join("")}</div>
    <p class="mini-note">⚠ ${start} 이전 매매는 토스가 체결내역을 90일까지만 제공해 복원할 수 없습니다.
      점에 마우스를 올리면 수량·단가가 나오고, 행을 누르면 종목조회로 이동합니다.</p>`;
  host.querySelectorAll(".hld-tr").forEach((b) => b.onclick = () => {
    document.querySelector('[data-tab="lookup"]').click();
    loadLookup(b.dataset.key);
  });
}

/* 종목/산업 비중을 각각 독립 카드에 그린다(토글 → 3영역 분리, v194).
   mode: "stock" | "sector" | "trade" · host: 그릴 컨테이너 */
function renderHldTimeline(all, mode, host) {
  mode = mode || "stock";
  host = host || $(mode === "trade" ? "#hld-tl-trade" : `#hld-tl-${mode}`);
  if (!host) return;
  if (mode === "trade") return renderHldTrades(host);
  const hist = pfHistDaily();
  if (hist.days.length < 2) {
    host.innerHTML = `<p class="mini-note">이력이 아직 1개 시점뿐입니다 — 토스 체결내역(최근 90일)이 있는 파일을 가져오면
      과거를 역산하고, 이후에는 가져올 때마다 시점이 쌓입니다.</p>`;
    return;
  }
  host.innerHTML = `<p class="mini-note">시계열 불러오는 중…</p>`;
  const tickers = [...new Set(hist.days.flatMap((d) => Object.keys(hist.marks[d])))];
  const fx = pfFxRate() || 1;
  Promise.all(tickers.map((t) => {
    const key = `${hist.meta[t]?.mk || "kr"}_${t}`;
    if (HLD_SERIES[key] !== undefined) return Promise.resolve();
    return fetch(`data/stocks/${key}.json` + _cb).then((r) => (r.ok ? r.json() : null)).then(normStock)
      .then((st) => { HLD_SERIES[key] = st?.series || null; }).catch(() => { HLD_SERIES[key] = null; });
  })).then(() => {
    // 종목별 날짜→종가 맵(원화 통일: 해외는 환율 적용)
    const px = {};
    tickers.forEach((t) => {
      const mk = hist.meta[t]?.mk || "kr";
      const s = HLD_SERIES[`${mk}_${t}`];
      if (!s) return;
      const m = {}; s.forEach((b) => { m[b.t] = b.c * (mk === "us" ? fx : 1); });
      px[t] = m;
    });
    // 날짜축: 첫 이력일 ~ 오늘, 영업일(가격이 있는 날)만
    const start = hist.days[0], end = pfDay(new Date());
    const anyPx = Object.values(px)[0] || {};
    const axis = Object.keys(anyPx).filter((d) => d >= start && d <= end).sort();
    if (axis.length < 3) { host.innerHTML = `<p class="mini-note">가격 시계열이 없어 그릴 수 없습니다(유니버스 밖 종목만 보유).</p>`; return; }
    // 이력일 → 축 인덱스 매핑. ⚠주말·휴장일(그리고 '오늘' 스냅샷이 마지막 거래일보다 뒤인 경우)은
    //   축에 없는 날짜라, 단순히 'd 이하의 최근 이력'을 고르면 **현재 보유가 영영 반영되지 않는다**
    //   (실측: 일요일에 열면 마지막 매수가 빠져 비중이 옛 상태로 굳음) → 축 끝으로 당겨 붙인다.
    const stepAt = new Array(axis.length).fill(null);
    hist.days.forEach((h) => {
      let i = axis.findIndex((d) => d >= h);
      if (i < 0) i = axis.length - 1;                        // 축 이후(주말·미래) → 마지막 거래일에 반영
      stepAt[i] = hist.marks[h];                             // 같은 인덱스면 나중 이력이 이김
    });
    let _cur = hist.marks[hist.days[0]] || {};
    const qtyByIdx = axis.map((_, i) => (stepAt[i] ? (_cur = stepAt[i]) : _cur));
    const qtyOn = (d) => qtyByIdx[axis.indexOf(d)] || {};
    const lastPx = (t, d) => {                              // 그 날짜 이하 마지막 종가(휴장·상장 공백 대응)
      const m = px[t]; if (!m) return null;
      if (m[d] != null) return m[d];
      for (let i = axis.indexOf(d); i >= 0; i--) if (m[axis[i]] != null) return m[axis[i]];
      return null;
    };
    // 그룹 키(종목 or 산업)별 일자 비중
    const groupOf = (t) => mode === "sector"
      ? hldFineSector({ ticker: t, mk: hist.meta[t]?.mk, name: hist.meta[t]?.name })
      : (hist.meta[t]?.name || t);
    const series = {}, totals = [];
    axis.forEach((d, i) => {
      const q = qtyByIdx[i];
      let tot = 0; const row = {};
      Object.entries(q).forEach(([t, n]) => {
        const p = lastPx(t, d);
        if (!p || !(n > 0)) return;
        const g = groupOf(t), v = p * n;
        row[g] = (row[g] || 0) + v; tot += v;
      });
      totals.push(tot);
      Object.entries(row).forEach(([g, v]) => {
        (series[g] = series[g] || new Array(axis.length).fill(0))[i] = tot ? v / tot : 0;
      });
    });
    const keys = Object.keys(series).sort((a, b) => series[b].at(-1) - series[a].at(-1));
    if (!keys.length) { host.innerHTML = `<p class="mini-note">평가금을 계산할 수 없습니다.</p>`; return; }
    // 좌우 2열(각 ~690px)로 쪼개져 viewBox가 크면 그만큼 축소돼 글씨가 작아진다 → W를 컨테이너에 맞춤
    // 라벨이 띠 안으로 들어가 우측 여백(구 118px)이 필요 없어졌다 → 그만큼 그래프가 넓어진다
    const W = 700, H = 300, P = { l: 34, r: 14, t: 16, b: 26 };
    const X = (i) => P.l + (W - P.l - P.r) * (i / (axis.length - 1));
    const Y = (v) => P.t + (H - P.t - P.b) * (1 - v);
    // 누적 영역
    let acc = new Array(axis.length).fill(0);
    const areas = keys.map((g, gi) => {
      const top = series[g].map((v, i) => acc[i] + v);
      const path = top.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ") + " " +
        acc.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).reverse().join(" ");
      acc = top;
      return `<polygon points="${path}" fill="${HLD_COLORS[gi % 8]}" fill-opacity=".78"
        stroke="var(--card)" stroke-width=".6"><title>${g}</title></polygon>`;
    }).join("");
    // 라벨을 **자기 색 띠 안**에 적는다(우측에 몰아 쓰면 어느 띠 것인지 알 수 없어 v195에서 이동).
    //  띠 높이가 글자보다 낮으면 생략 — 억지로 밀어내면 다시 남의 영역을 침범한다.
    let acc2 = 0;
    const labels = keys.map((g, gi) => {
      const v = series[g].at(-1), mid = acc2 + v / 2;
      acc2 += v;
      const bandPx = (H - P.t - P.b) * v;            // 이 띠의 실제 높이(px)
      if (bandPx < 12) return "";
      return `<text x="${W - P.r - 8}" y="${Y(mid) + 3.5}" text-anchor="end" class="hld-band-lb"
        >${String(g).slice(0, 11)} ${(v * 100).toFixed(0)}%</text>`;
    }).join("");
    const grid = [0, .25, .5, .75, 1].map((r) =>
      `<line x1="${P.l}" y1="${Y(r)}" x2="${W - P.r}" y2="${Y(r)}" stroke="var(--line)"/>
       <text x="${P.l - 5}" y="${Y(r) + 3}" text-anchor="end" class="cr-ax">${(r * 100).toFixed(0)}%</text>`).join("");
    // 편입/제외 마커
    const evs = hist.events.filter((e) => e.d >= start).map((e) => {
      let i = axis.findIndex((d) => d >= e.d); if (i < 0) i = axis.length - 1;
      const y = e.type === "in" ? H - P.b : P.t;
      return `<g><line x1="${X(i)}" y1="${P.t}" x2="${X(i)}" y2="${H - P.b}" stroke="#8b8b93"
        stroke-dasharray="2 3" opacity=".5"/>
        <text x="${X(i)}" y="${y + (e.type === "in" ? -3 : 10)}" text-anchor="middle" class="hld-ev ${e.type}"
          >${e.type === "in" ? "▲" : "▼"}<title>${e.d} ${e.name} ${e.type === "in" ? "편입" : "제외"}</title></text></g>`;
    }).join("");
    const xl = [0, Math.floor(axis.length / 2), axis.length - 1].map((i) =>
      `<text x="${X(i)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === axis.length - 1 ? "end" : "middle"}"
        class="cr-ax">${axis[i].slice(2)}</text>`).join("");
    const nSnap = Object.keys(pfHistLoad().snaps).length;
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}">${grid}${areas}${evs}${labels}${xl}</svg>
      <p class="mini-note">${axis[0]} ~ ${axis.at(-1)} · 평가금 기준 100% 비중 ·
        편입 ${hist.events.filter((e) => e.type === "in").length}건 · 제외 ${hist.events.filter((e) => e.type === "out").length}건
        <br>⚠ ${start} 이전은 토스가 체결내역을 90일까지만 제공해 복원할 수 없습니다.
        누적 스냅샷 ${nSnap}개 — 가져오기를 반복할수록 정확해집니다.</p>`;
  });
}

function renderHldAnalytics(all) {
  const esc = (s) => String(s ?? "").replace(/</g, "&lt;");
  const gVal = all.reduce((a, h) => a + (h.val || 0), 0) || 1;

  // ── ① 종목별 수익률 추이(평균단가 대비, 3개월) — 평가금 상위 8, 시계열 lazy fetch ──
  const top8 = all.slice().sort((a, b) => (b.val || 0) - (a.val || 0)).slice(0, 8);
  const chartHost = $("#hld-perf-chart");
  chartHost.innerHTML = `<p class="mini-note">시계열 불러오는 중…</p>`;
  Promise.all(top8.map((h) => {
    const key = `${h.mk}_${h.ticker}`;
    if (HLD_SERIES[key] !== undefined) return Promise.resolve();
    return fetch(`data/stocks/${key}.json` + _cb).then((r) => (r.ok ? r.json() : null)).then(normStock)
      .then((st) => { HLD_SERIES[key] = st?.series || null; }).catch(() => { HLD_SERIES[key] = null; });
  })).then(() => {
    const W = 680, H = 260, padL = 8, padR = 120, padT = 14, padB = 24;
    const lines = [];
    top8.forEach((h, i) => {
      const s = HLD_SERIES[`${h.mk}_${h.ticker}`];
      if (!s || s.length < 10 || !h.avg) return;
      const tail = s.slice(-63);   // ~3개월
      // 해외: series는 원통화(USD)·avg는 원화 환산 → 마지막 종가와 현재가(원)의 비율로 환산(환율 고정 근사)
      const fx = h.mk === "us" && h.price && tail[tail.length - 1].c ? h.price / tail[tail.length - 1].c : 1;
      const pts = tail.map((b) => (b.c * fx / h.avg - 1) * 100);
      lines.push({ name: h.name, color: HLD_COLORS[i % 8], pts, last: pts[pts.length - 1], t0: tail[0].t, t1: tail[tail.length - 1].t });
    });
    if (!lines.length) { chartHost.innerHTML = `<p class="mini-note">시계열 데이터가 없는 종목입니다(유니버스 밖 ETF 등).</p>`; return; }
    const allV = lines.flatMap((l) => l.pts);
    const maxV = Math.max(...allV, 5), minV = Math.min(...allV, -5);
    const n = Math.max(...lines.map((l) => l.pts.length));
    const xS = (i, len) => padL + (i / (len - 1)) * (W - padL - padR);
    const yS = (v) => padT + (maxV - v) / (maxV - minV || 1) * (H - padT - padB);
    const y0 = yS(0);
    let svg = `<line x1="${padL}" y1="${y0}" x2="${W - padR}" y2="${y0}" stroke="#3a3a44" stroke-dasharray="3 3"/>`;
    // 끝 라벨 겹침 방지: last 기준 정렬 후 최소 간격 배치
    const sorted = lines.slice().sort((a, b) => b.last - a.last);
    let prevY = -99;
    sorted.forEach((l) => {
      l.labY = Math.max(yS(l.last), prevY + 13);
      prevY = l.labY;
    });
    lines.forEach((l) => {
      svg += `<polyline points="${l.pts.map((v, i) => xS(i, l.pts.length).toFixed(1) + "," + yS(v).toFixed(1)).join(" ")}"
        fill="none" stroke="${l.color}" stroke-width="1.8"/>`;
    });
    sorted.forEach((l) => {
      svg += `<text x="${W - padR + 6}" y="${l.labY + 3}" font-size="9.5" fill="${l.color}">${esc(l.name.slice(0, 8))} ${l.last >= 0 ? "+" : ""}${l.last.toFixed(1)}%</text>`;
    });
    svg += `<text x="${padL}" y="${H - 8}" font-size="9" fill="#8b8b93">${lines[0].t0.slice(5)}</text>
      <text x="${W - padR}" y="${H - 8}" font-size="9" text-anchor="end" fill="#8b8b93">${lines[0].t1.slice(5)}</text>`;
    chartHost.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="fin-svg">${svg}</svg>
      <p class="sub-note" style="margin:4px 0 0">0% 기준선 = 내 평균단가 · 해외는 현재 환율 고정 환산 근사${all.length > 8 ? ` · 평가금 상위 8종목만 표시(전체 ${all.length})` : ""}</p>`;
  });

  // ── ② 산업별 보유 비중(도넛 + 리스트) ──
  const bySec = {}, memBySec = {};
  all.forEach((h) => {
    const s = hldFineSector(h);
    bySec[s] = (bySec[s] || 0) + (h.val || 0);
    (memBySec[s] = memBySec[s] || []).push(h);
  });
  const secs = Object.entries(bySec).sort((a, b) => b[1] - a[1]);
  const R = 78, SW = 34, CX = 110, C = 2 * Math.PI * R;   // 도넛 확대(반지름 56→78)
  let acc = 0;
  const segs = secs.map(([s, v], i) => {
    const frac = v / gVal, dash = frac * C;
    const el = `<circle class="hld-seg" data-sec="${esc(s)}" r="${R}" cx="${CX}" cy="${CX}" fill="none"
      stroke="${HLD_COLORS[i % 8]}" stroke-width="${SW}"
      stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-acc * C + C / 4}"/>`;
    acc += frac;
    return el;
  }).join("");
  $("#hld-sector").innerHTML = `<div class="hld-donut-wrap">
    <div class="hld-donut-box">
      <svg viewBox="0 0 ${CX * 2} ${CX * 2}" class="hld-donut">${segs}
        <text id="hld-donut-t1" x="${CX}" y="${CX - 4}" text-anchor="middle" font-size="13" fill="#8b8b93">산업</text>
        <text id="hld-donut-t2" x="${CX}" y="${CX + 15}" text-anchor="middle" font-size="15" fill="#e7e7ec">${secs.length}개</text></svg>
      <div class="hld-tip" id="hld-tip"></div>
    </div>
    <div class="hld-seclist">${secs.map(([s, v], i) => `<div class="hld-secrow" data-sec="${esc(s)}">
      <span class="hld-dot" style="background:${HLD_COLORS[i % 8]}"></span>
      <span class="hld-secname">${esc(s)}</span>
      <span class="hld-secpct">${(v / gVal * 100).toFixed(1)}%</span>
      <span class="sub-note">${won(v)}</span></div>`).join("")}</div></div>`;

  // 호버: 도넛 조각·리스트 행 → 해당 산업의 보유 종목 툴팁(평가금 순) + 가운데 라벨 교체
  const tip = $("#hld-tip"), t1 = $("#hld-donut-t1"), t2 = $("#hld-donut-t2");
  const showSec = (sec, ev) => {
    const mem = (memBySec[sec] || []).slice().sort((a, b) => (b.val || 0) - (a.val || 0));
    const secVal = bySec[sec] || 0;
    tip.innerHTML = `<div class="hld-tip-h">${esc(sec)} <span class="sub-note">${(secVal / gVal * 100).toFixed(1)}% · ${won(secVal)}</span></div>`
      + mem.map((h) => `<div class="hld-tip-r"><span>${esc(h.name)}</span>
        <span class="sub-note">${(( h.val || 0) / secVal * 100).toFixed(0)}%</span>
        <b>${won(h.val)}</b>
        <span class="${(h.plRate || 0) >= 0 ? "pos" : "neg"}">${pct(h.plRate, 1)}</span></div>`).join("");
    tip.style.display = "block";
    t1.textContent = sec.slice(0, 9);
    t2.textContent = `${(secVal / gVal * 100).toFixed(1)}%`;
    if (ev) {
      const box = tip.parentElement.getBoundingClientRect();
      tip.style.left = Math.min(Math.max(8, ev.clientX - box.left + 12), Math.max(8, box.width - 40)) + "px";
      tip.style.top = Math.max(4, ev.clientY - box.top - 10) + "px";
    }
  };
  const hideSec = () => {
    tip.style.display = "none";
    t1.textContent = "산업"; t2.textContent = `${secs.length}개`;
  };
  $("#hld-sector").querySelectorAll(".hld-seg").forEach((el) => {
    el.addEventListener("mousemove", (ev) => showSec(el.dataset.sec, ev));
    el.addEventListener("mouseleave", hideSec);
  });
  $("#hld-sector").querySelectorAll(".hld-secrow").forEach((el) => {
    el.addEventListener("mouseenter", () => showSec(el.dataset.sec, null));
    el.addEventListener("mouseleave", hideSec);
  });

  // ── ③ 국가·시장 / 시총 체급 / 수익 기여 ──
  const bar = (label, frac, color) => `<div class="hld-brow"><span class="hld-blab">${label}</span>
    <div class="hld-bbar"><span style="width:${(frac * 100).toFixed(1)}%;background:${color}"></span></div>
    <b>${(frac * 100).toFixed(1)}%</b></div>`;
  const krVal = all.filter((h) => h.mk === "kr").reduce((a, h) => a + (h.val || 0), 0);
  $("#hld-country").innerHTML = bar("🇰🇷 국내", krVal / gVal, "#4391ff") + bar("🇺🇸 해외", (gVal - krVal) / gVal, "#f5445a");

  const tierOf = (h) => {
    const t = (MARKET?.heatmap || []).find((x) => x.m === h.mk && x.t === h.ticker);
    if (!t?.mcap) return "기타·ETF";
    if (h.mk === "kr") return t.mcap >= 2e12 ? "대형(2조↑)" : t.mcap >= 3e11 ? "중형" : "소형";
    return t.mcap >= 1e10 ? "대형($10B↑)" : t.mcap >= 2e9 ? "중형" : "소형";
  };
  const byTier = {};
  all.forEach((h) => { const t = tierOf(h); byTier[t] = (byTier[t] || 0) + (h.val || 0); });
  $("#hld-tier").innerHTML = Object.entries(byTier).sort((a, b) => b[1] - a[1])
    .map(([t, v], i) => bar(t, v / gVal, HLD_COLORS[i % 8])).join("");

  const byPl = all.slice().sort((a, b) => (b.pl || 0) - (a.pl || 0));
  const chip = (h) => `<span class="hld-chip ${h.pl >= 0 ? "pos" : "neg"}" data-tk="${h.mk}_${h.ticker}">${esc(h.name)} ${won(h.pl, true)}</span>`;
  const winners = byPl.filter((h) => (h.pl || 0) > 0).slice(0, 3);
  const losers = byPl.filter((h) => (h.pl || 0) < 0).slice(-3).reverse();
  $("#hld-contrib").innerHTML = `<div class="sub-note" style="margin-bottom:4px">효자 TOP3</div>
    <div class="hld-chips">${winners.length ? winners.map(chip).join("") : `<span class="mini-note">수익 종목 없음</span>`}</div>
    <div class="sub-note" style="margin:8px 0 4px">아픈 손가락 TOP3</div>
    <div class="hld-chips">${losers.length ? losers.map(chip).join("") : `<span class="mini-note">손실 종목 없음 🎉</span>`}</div>`;
  $("#hld-contrib").querySelectorAll(".hld-chip").forEach((c) => c.onclick = () => {
    gotoTabFull("lookup"); if (!lookupRendered) initLookup(); loadLookup(c.dataset.tk);
  });
}

function hldRender() {
  const host = $("#hld-list"), sumEl = $("#hld-summary");
  const all = pfHoldingsLive();   // 현재가·평가금·수익률은 최신 시세로 재계산
  if (!all.length) {
    sumEl.style.display = "none";
    $("#hld-analytics").style.display = "none";
    $("#hld-table-h").style.display = "none";
    host.innerHTML = `<div class="card-flat" style="text-align:center;padding:40px 16px;color:var(--muted)">
      보유종목이 없습니다 — <b>＋ 종목 추가</b>로 입력하거나 <b>📂 파일 가져오기</b>로 토스 동기화 파일을 불러오세요.<br>
      <span class="sub-note">입력한 종목은 <b>포트폴리오 점검</b> 탭에서 산업·시장 흐름까지 진단됩니다.</span></div>`;
    return;
  }
  $("#hld-analytics").style.display = "";
  $("#hld-table-h").style.display = "";
  renderHldAnalytics(all);   // 상단 분석(수익추이·산업비중·구성) — 비동기(시계열 lazy)
  // 종목 비중 · 산업 비중 · 종목별 매매를 각각 독립 영역에 동시 렌더(토글 제거)
  renderHldTimeline(all, "stock");
  renderHldTimeline(all, "sector");
  renderHldTimeline(all, "trade");
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
    const mx = $("#pf-matrix"); if (mx) mx.style.display = "none";
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
    return fetch(`data/stocks/${key}.json` + _cb).then((r) => (r.ok ? r.json() : null)).then(normStock)
      .then((j) => pfStockCache.set(key, j));
  }));
  pfRenderStats(arr);
  pfRenderMatrix(arr);   // 판정 근거 도표(매트릭스·점수 막대)
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
  const all = inv?.[pfMkSel] ? [...inv[pfMkSel]].sort((a, b) => (a.d || "").localeCompare(b.d || "")) : [];
  const recs = all.slice(-20);                          // 20일 누적 기준
  const won = (v) => (v >= 0 ? "+" : "-") + (Math.abs(v) >= 1e12 ? (Math.abs(v) / 1e12).toFixed(2) + "조"
    : Math.round(Math.abs(v) / 1e8).toLocaleString() + "억");
  /* 일별 그룹막대 3세트 → **20일 누적 라인 1개**로 통합(사용자 요청).
     누적선은 "이 기간 동안 누가 얼마나 사고팔았나"가 한눈에 보이고, 일별 막대의 노이즈가 사라진다. */
  let svg = "";
  const KEYS = [["indiv", "개인", "#9aa4b2"], ["frgn", "외국인", "#f5445a"], ["inst", "기관", "#4391ff"]];
  const cum = {};
  if (recs.length) {
    KEYS.forEach(([k]) => {
      let s = 0;
      cum[k] = recs.map((r) => (s += r[k] || 0));
    });
    const W = 660, H = 220, P = { l: 60, r: 96, t: 14, b: 22 };
    const vals = KEYS.flatMap(([k]) => cum[k]).concat([0]);
    const mn = Math.min(...vals), mx = Math.max(...vals), pad = (mx - mn) * 0.1 || 1;
    const lo = mn - pad, hi = mx + pad;
    const X = (i) => P.l + (W - P.l - P.r) * (i / Math.max(1, recs.length - 1));
    const Y = (v) => P.t + (H - P.t - P.b) * (1 - (v - lo) / (hi - lo));
    const grid = [0, .25, .5, .75, 1].map((r) => {
      const v = lo + (hi - lo) * r;
      return `<line x1="${P.l}" y1="${Y(v)}" x2="${W - P.r}" y2="${Y(v)}" stroke="var(--line)"/>
        <text x="${P.l - 5}" y="${Y(v) + 3}" text-anchor="end" class="cr-ax">${won(v)}</text>`;
    }).join("");
    const zero = lo <= 0 && hi >= 0
      ? `<line x1="${P.l}" y1="${Y(0)}" x2="${W - P.r}" y2="${Y(0)}" stroke="#8b8b93" stroke-dasharray="4 4"/>` : "";
    // 끝 라벨 겹침 방지
    const ends = KEYS.map(([k, ko, c]) => ({ k, ko, c, v: cum[k].at(-1), y: Y(cum[k].at(-1)) }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 14);
    const lines = KEYS.map(([k, ko, c]) =>
      `<polyline points="${cum[k].map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")}"
        fill="none" stroke="${c}" stroke-width="2"/>`).join("");
    const labels = ends.map((e) =>
      `<text x="${W - P.r + 6}" y="${e.y + 3}" class="cr-end" fill="${e.c}">${e.ko} ${won(e.v)}</text>`).join("");
    const xl = [0, Math.floor(recs.length / 2), recs.length - 1].map((i) =>
      `<text x="${X(i)}" y="${H - 5}" text-anchor="${i === 0 ? "start" : i === recs.length - 1 ? "end" : "middle"}"
        class="cr-ax">${(recs[i].d || "").slice(5)}</text>`).join("");
    svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}">${grid}${zero}${lines}${labels}${xl}</svg>`;
  }
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
      <p class="legend"><span style="color:#9aa4b2">■</span> 개인 · <span style="color:#f5445a">■</span> 외국인 ·
        <span style="color:#4391ff">■</span> 기관 — <b>${recs.length}일 누적 순매수</b>(기간 첫날부터 더한 금액,
        선이 올라가면 계속 사들이는 중 · 0선 위=순매수)</p>
      <div class="prof-grid wide">
        ${KEYS.map(([k, ko]) => `<div class="prof-row"><span>${ko} ${recs.length}일 누적</span>
          <span><b class="${(cum[k]?.at(-1) || 0) >= 0 ? "pos" : "neg"}">${won(cum[k]?.at(-1) || 0)}</b></span></div>`).join("")}
        <div class="prof-row"><span>연기금 ${recs.length}일 누적</span>
          <span><b class="${pensionSum >= 0 ? "pos" : "neg"}">${won(pensionSum)}</b>
            <span class="sub-note">— 저점 분할매수 성향의 장기 자금</span></span></div>
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
  // checks: 감점된 항목뿐 아니라 **통과·제외 항목까지** 기록 → 판정 근거 전모를 스코어카드로 표시
  const checks = [];
  const eok = (v) => `${v > 0 ? "+" : ""}${Math.round(v).toLocaleString()}억`;

  // ① 원칙 매도신호(30일, 현 국면 유효)
  if (recentSell.length) {
    score -= 2; reasons.push(`검증된 매도신호 ${recentSell.length}건(30일)`);
    checks.push({ key: "sell", icon: "📉", name: "원칙 매도신호", pts: -2, ok: false,
      detail: `30일 내 ${recentSell.length}건 (${[...new Set(recentSell.map((m) => RULE_ABBR[m.rule_id] || m.rule_id))].join("·")})` });
  } else {
    checks.push({ key: "sell", icon: "📉", name: "원칙 매도신호", pts: 0, ok: true, detail: "30일 내 없음" });
  }
  // ② 섹터 상대강도(RS)
  if (!rs) {
    checks.push({ key: "rs", icon: "🏭", name: "섹터 상대강도", pts: 0, na: true, detail: `${sector || "섹터"} 데이터 없음 — 판정 제외` });
  } else if (rs.rs_w1 < 0 && rs.rs_m1 < 0 && rs.rs_m3 < 0) {
    score -= 1; reasons.push("섹터가 전 기간 시장 대비 약세");
    checks.push({ key: "rs", icon: "🏭", name: "섹터 상대강도", pts: -1, ok: false,
      detail: `${sector} 1주 ${pct(rs.rs_w1, 1)}·1M ${pct(rs.rs_m1, 1)}·3M ${pct(rs.rs_m3, 1)} — 전 기간 약세` });
  } else {
    checks.push({ key: "rs", icon: "🏭", name: "섹터 상대강도", pts: 0, ok: true,
      detail: `${sector} 1주 ${pct(rs.rs_w1, 1)}·1M ${pct(rs.rs_m1, 1)}·3M ${pct(rs.rs_m3, 1)}` });
  }
  // ③ 수급(외국인·기관 20일 누적) — 국내만
  if (!sup || sup.frgn_20 == null || sup.inst_20 == null) {
    checks.push({ key: "sup", icon: "💧", name: "수급(외인·기관)", pts: 0, na: true,
      detail: h.mk === "us" ? "미국 종목 미지원 — 판정 제외" : "데이터 없음 — 판정 제외" });
  } else if (sup.frgn_20 < 0 && sup.inst_20 < 0) {
    score -= 1; reasons.push("외국인·기관 20일 동반 순매도");
    checks.push({ key: "sup", icon: "💧", name: "수급(외인·기관)", pts: -1, ok: false,
      detail: `20일 외국인 ${eok(sup.frgn_20)}·기관 ${eok(sup.inst_20)} — 동반 순매도` });
  } else {
    checks.push({ key: "sup", icon: "💧", name: "수급(외인·기관)", pts: 0, ok: true,
      detail: `20일 외국인 ${eok(sup.frgn_20)}·기관 ${eok(sup.inst_20)}` });
  }
  // ④ 시장 대비 1개월 성과
  if (p.rel_m1 == null) {
    checks.push({ key: "rel", icon: "📊", name: "시장 대비(1M)", pts: 0, na: true, detail: "데이터 없음 — 판정 제외" });
  } else if (p.rel_m1 < -0.10) {
    score -= 1; reasons.push(`1개월 시장 대비 ${pct(p.rel_m1, 0)} 뒤처짐`);
    checks.push({ key: "rel", icon: "📊", name: "시장 대비(1M)", pts: -1, ok: false,
      detail: `${pct(p.rel_m1, 1)} 뒤처짐 (기준 -10%p)` });
  } else {
    checks.push({ key: "rel", icon: "📊", name: "시장 대비(1M)", pts: 0, ok: true, detail: `${pct(p.rel_m1, 1)}` });
  }
  // ⑤ 거래소 경고(정리매매·투자위험 -2 / 투자경고·단기과열 -1)
  const warns = tossActiveWarns(h.ticker);
  let warnPts = 0;
  const warnTxt = [];
  warns.forEach((w) => {
    const [label, , pen] = TOSS_WARN[w.type];
    if (pen) {
      score += pen; warnPts += pen;
      reasons.push(`거래소 ${label} 지정${w.end ? `(~${w.end.slice(5)})` : ""}`);
      warnTxt.push(`${label}${w.end ? `(~${w.end.slice(5)})` : ""}`);
    }
  });
  checks.push({ key: "warn", icon: "🚨", name: "거래소 경고", pts: warnPts, ok: warnPts === 0,
    detail: warnPts ? warnTxt.join(" · ") : "지정 없음" });
  // ⑥ 원칙 매수신호(참고 — 가점 없음)
  checks.push({ key: "buy", icon: "📈", name: "원칙 매수신호", pts: 0, ok: true, info: true,
    detail: recentBuy.length ? `30일 내 ${recentBuy.length}건 — 원칙상 우호적` : "30일 내 없음" });

  const toss = rich ? h : null;  // rich 항목이면 오늘손익·수수료 등을 그대로 사용
  const grade = score <= -3 ? "bad" : score < 0 ? "warn" : "good";
  const gradeTxt = grade === "bad" ? "🔴 논거 재점검" : grade === "warn" ? "🟡 점검 필요" : "🟢 흐름 양호";
  if (!reasons.length) reasons.push(recentBuy.length ? `매수신호 ${recentBuy.length}건(30일) — 원칙상 우호적` : "감점 요인 없음");
  return { st, cur, nativeCur, rich, sector, rs, p, sup, cons, recentSell, recentBuy, grade, gradeTxt, reasons, checks, score, warns, toss };
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

// 판정 스코어카드 — 감점·통과·제외 항목을 전부 표로(근거 상세)
function pfChecksTable(c) {
  const rows = c.checks.map((k) => {
    const res = k.na ? `<span class="pf-chk na">⚪ 제외</span>`
      : k.info ? `<span class="pf-chk info">참고</span>`
      : k.pts < 0 ? `<span class="pf-chk bad">🔴 감점</span>` : `<span class="pf-chk ok">🟢 통과</span>`;
    return `<tr><td>${k.icon} ${k.name}</td><td>${res}</td><td class="pf-chk-d">${k.detail}</td>
      <td class="pf-chk-p ${k.pts < 0 ? "neg" : ""}">${k.pts < 0 ? k.pts : "0"}</td></tr>`;
  }).join("");
  const rule = c.score <= -3 ? "-3점 이하 → 🔴" : c.score < 0 ? "-1~-2점 → 🟡" : "0점 → 🟢";
  return `<div class="pf-checks"><table>
    <thead><tr><th>판정 항목</th><th>결과</th><th>근거</th><th class="pf-chk-p">점수</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="2"><b>합계</b></td><td class="sub-note">${rule}</td>
      <td class="pf-chk-p ${c.score < 0 ? "neg" : ""}"><b>${c.score}</b></td></tr></tfoot>
  </table></div>`;
}

// 포트폴리오 레벨 도표 — 리스크 매트릭스(종목×항목) + 종목별 점검 점수 막대
function pfRenderMatrix(arr) {
  const el = $("#pf-matrix");
  if (!el) return;
  const rows = arr.map((h) => ({ h, c: pfCheck(h) }));
  if (!rows.length) { el.style.display = "none"; return; }
  el.style.display = "";
  const cols = rows[0].c.checks.filter((k) => !k.info);   // 참고(매수신호) 열 제외
  const esc = (s) => String(s ?? "").replace(/</g, "&lt;");
  // 항목별 감점 종목 수(리스크 쏠림 파악)
  const colBad = cols.map((_, ci) => rows.filter((r) => (r.c.checks.filter((k) => !k.info)[ci]?.pts || 0) < 0).length);

  const head = `<tr><th class="pf-mx-name">종목</th>${cols.map((k) => `<th title="${esc(k.name)}">${k.icon}<br><span class="sub-note">${esc(k.name)}</span></th>`).join("")}<th>점수</th></tr>`;
  const body = rows.map(({ h, c }) => {
    const cells = c.checks.filter((k) => !k.info).map((k) =>
      `<td class="${k.na ? "na" : k.pts < 0 ? "bad" : "ok"}" title="${esc(k.detail)}">${k.na ? "⚪" : k.pts < 0 ? `🔴${k.pts}` : "🟢"}</td>`).join("");
    return `<tr data-key="${h.mk}_${h.ticker}"><td class="pf-mx-name"><b>${esc(h.name)}</b></td>${cells}
      <td class="pf-chk-p ${c.score < 0 ? "neg" : ""}"><b>${c.score}</b></td></tr>`;
  }).join("");
  const foot = `<tr><td class="pf-mx-name sub-note">감점 종목 수</td>${colBad.map((n) =>
    `<td class="sub-note">${n ? `<b class="neg">${n}</b>` : "0"}</td>`).join("")}<td></td></tr>`;

  const sorted = rows.slice().sort((a, b) => a.c.score - b.c.score);
  const bars = sorted.map(({ h, c }) => {
    const w = Math.min(100, Math.abs(c.score) / 6 * 100);
    const col = c.grade === "bad" ? "#f5445a" : c.grade === "warn" ? "#f0b34c" : "#22c07a";
    return `<div class="pf-bar" data-key="${h.mk}_${h.ticker}">
      <span class="pf-bar-n">${esc(h.name)}</span>
      <div class="pf-bar-t"><span style="width:${w || 3}%;background:${col}"></span></div>
      <b style="color:${col}">${c.score}</b></div>`;
  }).join("");

  el.innerHTML = `<div class="hld-agrid">
    <div class="card-flat"><h3 class="lk-h3">🧭 리스크 매트릭스 <span class="sub-note">(종목 × 판정 항목 · 셀에 커서=근거)</span></h3>
      <div class="fin-wrap"><table class="pf-matrix">${`<thead>${head}</thead>`}<tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div></div>
    <div class="card-flat"><h3 class="lk-h3">📉 종목별 점검 점수 <span class="sub-note">(0=양호 · 낮을수록 재점검)</span></h3>
      <div class="pf-bars">${bars}</div></div>
  </div>`;
  el.querySelectorAll(".pf-bar, .pf-matrix tbody tr").forEach((r) => r.onclick = () => {
    const card = [...document.querySelectorAll("#pf-list .pf-card")]
      .find((d) => d.querySelector(".pf-goto")?.dataset.key === r.dataset.key);
    if (card) { card.open = true; card.scrollIntoView({ behavior: "smooth", block: "center" }); }
  });
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
      ${pfChecksTable(c)}
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

/* 📅 대가별 3년 보유 비중 시계열 (guru_history.json)
   US = 13F 13분기 소급 / KR = 대량보유(5%) 보고 이력을 분기말로 스냅샷 */
let GHIST = null;
// 원화 큰 금액 — 국내 대가 평가액은 원 단위라 fmtMcap($T)을 쓰면 "94조원"이 "$94.07T"로 나온다
function krwBig(v) {
  if (v == null || isNaN(v)) return "-";
  const a = Math.abs(v);
  if (a >= 1e12) return (v / 1e12).toFixed(1) + "조원";
  if (a >= 1e8) return Math.round(v / 1e8).toLocaleString() + "억원";
  return Math.round(v).toLocaleString() + "원";
}
function loadGuruHist() {
  if (GHIST !== null) return Promise.resolve(GHIST);
  return fetch("data/guru_history.json" + _cb).then((r) => (r.ok ? r.json() : null))
    .then((j) => { GHIST = j || false; return GHIST; }).catch(() => { GHIST = false; return false; });
}
function guruHistBlock(id, gh) {
  if (!gh?.quarters?.length || !Object.keys(gh.series || {}).length) return "";
  const qs = gh.quarters;
  const keys = Object.keys(gh.series).sort((a, b) => (gh.series[b].at(-1) || 0) - (gh.series[a].at(-1) || 0));
  // 라벨이 잘리지 않도록 우측 여백을 **가장 긴 종목명 기준**으로 잡고, 높이는 항목 수에 맞춰 늘린다
  const shown = keys.filter((k) => (gh.series[k].at(-1) || 0) >= 0.02);
  const nameW = Math.min(190, 60 + Math.max(...shown.map((k) => k.length), 6) * 6.4);
  const H = Math.max(290, 52 + shown.length * 16);   // 라벨 수만큼 세로를 확보(잘림 방지)
  const W = 760, P = { l: 40, r: nameW + 12, t: 16, b: 26 };
  const X = (i) => P.l + (W - P.l - P.r) * (i / Math.max(1, qs.length - 1));
  const Y = (v) => P.t + (H - P.t - P.b) * (1 - v);
  let acc = new Array(qs.length).fill(0);
  const bands = keys.map((k, gi) => {
    const s = gh.series[k].map((v) => v || 0);
    const top = s.map((v, i) => acc[i] + v);
    const path = top.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ") + " " +
      acc.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).reverse().join(" ");
    const mid = top.map((v, i) => (v + acc[i]) / 2);
    acc = top;
    return { k, gi, path, s, mid };
  });
  const areas = bands.map((b) => `<polygon points="${b.path}" fill="${HLD_COLORS[b.gi % 8]}"
    fill-opacity=".82" stroke="var(--card)" stroke-width=".7"><title>${b.k}</title></polygon>`).join("");
  // 종목이 처음 들어온/완전히 빠진 분기에 점을 찍어 '언제 바뀌었는지'가 보이게 한다
  const dots = bands.flatMap((b) => b.s.map((v, i) => {
    const prev = i ? b.s[i - 1] : 0;
    if (prev < 0.001 && v >= 0.005) return { i, y: Y(b.mid[i]), t: "in", k: b.k, w: v, d: qs[i] };
    if (prev >= 0.005 && v < 0.001) return { i, y: Y(b.mid[i - 1]), t: "out", k: b.k, w: prev, d: qs[i] };
    return null;
  }).filter(Boolean)).map((p) => `<g class="gh-dot">
      <circle cx="${X(p.i)}" cy="${p.y}" r="4.5" fill="${p.t === "in" ? "#22c07a" : "#f5445a"}"
        stroke="#fff" stroke-width="1.2"/>
      <title>${p.d} · ${p.k} ${p.t === "in" ? "편입" : "전량 처분"} (${(p.w * 100).toFixed(1)}%)</title></g>`).join("");
  /* 라벨 배치 — ⚠누적 영역은 **첫 키가 맨 아래**라 keys 순서로 가면 y가 '감소'한다.
     증가를 가정하고 `max(y, prev+gap)`로 밀면 라벨이 아래로 계속 밀려 차트 밖으로 나간다(실측 14개 이탈).
     → y 오름차순(화면 위→아래)으로 정렬한 뒤 아래로 밀고, 마지막에 위로 되밀어 안쪽에 가둔다. */
  let acc2 = 0;
  const lab = [];
  keys.forEach((k, gi) => {
    const v = gh.series[k].at(-1) || 0, mid = acc2 + v / 2; acc2 += v;
    if (v >= 0.02) lab.push({ k, gi, v, y: Y(mid) });
  });
  lab.sort((a, b) => a.y - b.y);
  const GAP = 16, top = P.t + 4, bot = H - P.b - 2;
  for (let i = 0; i < lab.length; i++) lab[i].y = Math.max(lab[i].y, i ? lab[i - 1].y + GAP : top);
  for (let i = lab.length - 1; i >= 0; i--) {
    lab[i].y = Math.min(lab[i].y, i === lab.length - 1 ? bot : lab[i + 1].y - GAP);
  }
  const labels = lab.map((l) =>
    `<g><rect x="${W - P.r + 2}" y="${(l.y - 7).toFixed(1)}" width="9" height="9" rx="2" fill="${HLD_COLORS[l.gi % 8]}"/>
      <text x="${W - P.r + 15}" y="${(l.y + 1).toFixed(1)}" class="gh-lb">${l.k}</text>
      <text x="${W - 4}" y="${(l.y + 1).toFixed(1)}" text-anchor="end" class="gh-lb pct">${(l.v * 100).toFixed(0)}%</text></g>`).join("");
  const grid = [0, .25, .5, .75, 1].map((r) =>
    `<line x1="${P.l}" y1="${Y(r)}" x2="${W - P.r}" y2="${Y(r)}" stroke="var(--line)"/>
     <text x="${P.l - 5}" y="${Y(r) + 3}" text-anchor="end" class="cr-ax">${r * 100}%</text>`).join("");
  const step = Math.max(1, Math.ceil(qs.length / 6));
  const xl = qs.map((q, i) => (i % step === 0 || i === qs.length - 1)
    ? `<text x="${X(i)}" y="${H - 7}" text-anchor="${i === 0 ? "start" : i === qs.length - 1 ? "end" : "middle"}"
        class="cr-ax">${q.slice(2, 7)}</text>` : "").join("");
  return `<div class="guru-hist">
    <b>📅 보유 비중 변화 <span class="sub-note">(${qs[0]} ~ ${qs.at(-1)} · ${qs.length}개 분기 ·
      <span style="color:#22c07a">●</span> 편입 <span style="color:#f5445a">●</span> 전량 처분)</span></b>
    <svg viewBox="0 0 ${W} ${H}" class="fin-svg">${grid}${areas}${dots}${labels}${xl}</svg>
    ${guruFlowBlock(gh)}
    ${guruNewsBlock(gh)}</div>`;
}

/* 🔀 최근 1년 편입·제외 — 로고 + 종목조회 링크 */
function guruFlowBlock(gh) {
  const evs = gh?.events || [];
  if (!evs.length) return "";
  const cut = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const recent = evs.filter((e) => e.d >= cut);
  if (!recent.length) return `<p class="mini-note">최근 1년간 편입·제외 없음</p>`;
  const mk = gh.country === "kr" ? "kr" : "us";
  const card = (e) => {
    const key = e.tk ? `${mk}_${e.tk}` : null;
    const logo = e.tk ? logoUrl(mk, e.tk) : "";
    return `<${key ? "button" : "div"} class="gf-item ${e.type}" ${key ? `data-key="${key}"` : ""}
        title="${e.d} · ${e.issuer}${e.w ? ` · 비중 ${(e.w * 100).toFixed(1)}%` : ""}">
      ${logo ? `<img src="${logo}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
             : `<span class="gf-noimg">${e.type === "in" ? "▲" : "▼"}</span>`}
      <span class="gf-name">${e.issuer}</span>
      <span class="gf-meta">${e.d.slice(2)}${e.w ? ` · ${(e.w * 100).toFixed(1)}%` : ""}</span>
    </${key ? "button" : "div"}>`;
  };
  const ins = recent.filter((e) => e.type === "in"), outs = recent.filter((e) => e.type === "out");
  return `<div class="guru-flow">
    <div class="gf-col in"><b>🟢 신규 편입 <span class="sub-note">최근 1년 · ${ins.length}건</span></b>
      <div class="gf-list">${ins.length ? ins.slice(0, 12).map(card).join("") : `<span class="sub-note">없음</span>`}</div></div>
    <div class="gf-col out"><b>🔴 전량 처분 <span class="sub-note">최근 1년 · ${outs.length}건</span></b>
      <div class="gf-list">${outs.length ? outs.slice(0, 12).map(card).join("") : `<span class="sub-note">없음</span>`}</div></div>
  </div>`;
}

/* 📰 공시 이후 변동 — 마지막 공시일 뒤에 나온 기사(사실 확인 필요) */
function guruNewsBlock(gh) {
  const ns = gh?.news || [];
  const since = gh?.news_since;
  if (!ns.length) {
    return since ? `<p class="mini-note">📰 ${since} 공시 이후 관련 기사가 아직 없습니다.</p>` : "";
  }
  return `<div class="guru-news"><b class="sub-note">📰 공시 이후 보도
      <span class="sub-note">(${since || "-"} 이후 · 13F는 분기말+45일 지연이라 이 사이 매매는 공시에 없음)</span></b>
    ${ns.map((n) => `<a class="guru-nrow" href="${n.url}" target="_blank" rel="noopener">
      <span class="guru-nd">${n.d.slice(5)}</span><span class="guru-nt">${n.title}</span>
      ${n.src ? `<span class="sub-note">${n.src}</span>` : ""}</a>`).join("")}
    <p class="mini-note">⚠ 기사는 <b>공시가 아닙니다</b> — 실제 편입·처분 여부는 다음 공시로 확인하세요.</p></div>`;
}

function renderGurus() {
  if (!GURUS) { $("#gurus-context").textContent = "gurus.json 없음 — python analysis\\gurus.py 실행 필요"; return; }
  if (GHIST === null) { loadGuruHist().then(renderGurus); return; }   // 이력 1회 lazy 로드 후 재렌더
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
        <text x="${cx}" y="${y - 4}" font-size="7.5" text-anchor="middle" fill="#9aa4b2">$${r.cash}B</text>`;
      pts.push([cx, yR(r.ratio), r.ratio, y]);   // y=막대 상단(라벨 충돌 판정용)
      labels += `<text x="${cx}" y="${H - 12}" font-size="8.5" text-anchor="middle" fill="#8b8b93">${r.d.slice(2, 7).replace("-", ".")}</text>`;
    });
    // ⚠라인 %라벨이 막대 $라벨과 같은 x에서 겹침 → 폰트 축소 + 막대 상단 근처면 위로 더 띄움
    const line = `<polyline points="${pts.map((p) => p[0] + "," + p[1]).join(" ")}" fill="none" stroke="#f5445a" stroke-width="2"/>` +
      pts.map((p, i) => {
        const dot = `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="#f5445a"/>`;
        if (!(i === pts.length - 1 || i % 2 === 0)) return dot;
        const near = Math.abs(p[1] - p[3]) < 16;   // 막대 상단 라벨과 근접
        return dot + `<text x="${p[0]}" y="${p[1] - (near ? 14 : 7)}" font-size="7.5" text-anchor="middle" fill="#ff8c9a">${p[2]}%</text>`;
      }).join("");
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
    const gh = GHIST?.managers?.[m.id];
    // 13F 비대상(트럼프 등) + 국내 대량보유 공시형 — guru_history가 있으면 비중·시계열을 붙인다
    if (m.type === "disclosure") {
      const lat = gh?.latest || {};
      const ws = Object.entries(lat).sort((a, b) => b[1].w - a[1].w);
      const wTable = ws.length ? `<div class="tablewrap"><table class="guru-table">
          <tr><th>보유 종목</th><th>비중</th><th>지분율</th><th>평가액</th></tr>
          ${ws.map(([k, v]) => `<tr><td>${k}</td>
            <td><div class="wbar"><div style="width:${Math.min(100, v.w * 200)}%"></div></div>
                ${(v.w * 100).toFixed(1)}%</td>
            <td>${v.rt == null ? "-" : v.rt.toFixed(2) + "%"}</td>
            <td>${v.value == null ? "-" : krwBig(v.value)}</td></tr>`).join("")}</table></div>
        <p class="mini-note">⚠ 비중은 <b>공시된 보유분(5% 이상) 안에서의 비중</b>입니다 —
          5% 미만 보유는 공시 의무가 없어 실제 포트폴리오 전체와 다릅니다.
          평가액 = 최근 보고 보유주식수 × 최근 종가.</p>`
        : `<div class="tablewrap"><table class="guru-table"><tr><th>주요 자산</th></tr>
            ${m.holdings.map((h) => `<tr><td>${h.issuer}</td></tr>`).join("")}</table></div>`;
      return `<details class="stock-block guru-block">
        <summary><b>${m.name}</b> <span class="sub-note">${m.fund}</span>
          <span class="badge dim">${ws.length ? "대량보유(5%) 공시 기반" : "13F 비대상 · 공개 신고 기반"}</span>
          <span class="badge dim">${m.report_date}</span></summary>
        <div class="guru-body">
          <p class="guru-style">투자 스타일: ${m.style}</p>
          ${m.thesis ? `<div class="commentary guru-thesis"><b>구성 해설</b><br>${m.thesis}</div>` : ""}
          ${guruHistBlock(m.id, gh)}
          ${wTable}
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
        ${guruHistBlock(m.id, gh)}
        <div class="tablewrap"><table class="guru-table">
          <tr><th>보유 종목 (상위 15)</th><th>비중</th><th>분기 변화</th></tr>${rows}</table></div>
        ${exits}
      </div>
    </details>`;
  }).join("");
  // 편입·처분 카드 → 종목조회 이동(유니버스에 있는 종목만 버튼으로 렌더됨)
  $("#gurus-list").querySelectorAll(".gf-item[data-key]").forEach((b) => b.onclick = () => {
    document.querySelector('[data-tab="lookup"]').click();
    loadLookup(b.dataset.key);
  });
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
  getJSON("investor.json"),
])
  .then(([j, a, cm, rg, rcm, td, sm, mk, nw, mp, fd, gu, vl, dl, nb, db, na, da, cal, sn, tm, iv]) => {
    DATA = j; APPLY = a; COMMENT = cm; REGIME = rg; RCOMMENT = rcm; TODAY = td; SIM = sm;
    MARKET = mk; NEWS = nw; MPRO = mp; FUND = fd; GURUS = gu; VAL = vl; DEALS = dl;
    NEWS_BRIEFS = nb; DEALS_BRIEFS = db; NEWS_ARCH = na; DEALS_ARCH = da; CAL = cal; SECNEWS = sn;
    TOSSM = tm; INVESTOR = iv;
    SELECTED_RULES = new Set((DATA?.rules || []).filter((r) => r.selected).map((r) => r.rule_id));
    renderMetaFooter();   // 최하단 데이터 출처(탭 무관 전역)
    initAiPanel();        // 🤖 전역 AI 어시스턴트(플로팅)
    initHeaderSearch();   // 🔍 제목 라인 종목 조회(어느 탭에서든)
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

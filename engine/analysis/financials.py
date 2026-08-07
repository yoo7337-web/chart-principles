# -*- coding: utf-8 -*-
r"""종목별 상세 재무제표(손익·재무상태·현금흐름) → app\data\financials\{key}.json

- KR: DART fnlttSinglAcntAll(전체계정) — 최근 10년 연간(사업보고서 11011, CFS 우선·없으면 OFS) +
      company.json fin_q(최근 분기 손익) 재활용. 표준 IFRS account_id로 안정 파싱.
- US: yfinance income_stmt / balance_sheet / cashflow(연간 4년 + 분기) — EBITDA 포함.
- 추정치(E): company.json cons/analyst의 매출·영업이익·순이익만(DART/yfinance엔 추정 없음).
- age 가드 6일(재무는 분기 1회 갱신이라 주기 김). 종목당 별도 파일(lazy 로드) → 용량·속도 관리.

사용법:
    python analysis\financials.py                 # 전 종목(age 가드)
    python analysis\financials.py --force
    python analysis\financials.py --only 005930   # 특정 종목만(검증)
    python analysis\financials.py --kr-only | --us-only
    python analysis\financials.py --limit 30      # 상위 N종목(검증)
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from collect import US_TICKERS
from common import APP_DATA

KST = timezone(timedelta(hours=9))
OUTDIR = APP_DATA / "financials"
INDEX = OUTDIR / "index.json"
MAX_AGE_D = 6
YEARS = 10  # 연간 소급 연수

# DART 표준 account_id → 우리 키 (account_id 우선, 없으면 account_nm 폴백)
ACCT_ID = {
    "ifrs-full_Revenue": "rev", "ifrs_Revenue": "rev",
    "ifrs-full_GrossProfit": "gp",
    "dart_OperatingIncomeLoss": "op", "ifrs-full_ProfitLossFromOperatingActivities": "op",
    "ifrs-full_ProfitLossBeforeTax": "pretax",
    "ifrs-full_ProfitLoss": "np",
    "ifrs-full_Assets": "asset", "ifrs-full_CurrentAssets": "ca", "ifrs-full_NoncurrentAssets": "nca",
    "ifrs-full_Liabilities": "liab", "ifrs-full_CurrentLiabilities": "cl", "ifrs-full_NoncurrentLiabilities": "ncl",
    "ifrs-full_Equity": "equity", "ifrs-full_EquityAttributableToOwnersOfParent": "equity_owner",
    "ifrs-full_CashAndCashEquivalents": "cash",
    "ifrs-full_CashFlowsFromUsedInOperatingActivities": "cfo",
    "ifrs-full_CashFlowsFromUsedInInvestingActivities": "cfi",
    "ifrs-full_CashFlowsFromUsedInFinancingActivities": "cff",
    "ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities": "capex_ppe",
    "ifrs-full_PurchaseOfIntangibleAssetsClassifiedAsInvestingActivities": "capex_intan",
}
ACCT_NM = {  # account_id가 '-표준계정코드 미사용-'인 회사 폴백
    "매출액": "rev", "수익(매출액)": "rev", "매출총이익": "gp", "영업이익": "op",
    "영업이익(손실)": "op", "법인세비용차감전순이익": "pretax", "법인세비용차감전순이익(손실)": "pretax",
    "당기순이익": "np", "당기순이익(손실)": "np", "자산총계": "asset", "유동자산": "ca", "비유동자산": "nca",
    "부채총계": "liab", "유동부채": "cl", "비유동부채": "ncl", "자본총계": "equity",
    "현금및현금성자산": "cash", "영업활동현금흐름": "cfo", "영업활동으로 인한 현금흐름": "cfo",
    "투자활동현금흐름": "cfi", "투자활동으로 인한 현금흐름": "cfi",
    "재무활동현금흐름": "cff", "재무활동으로 인한 현금흐름": "cff",
    "유형자산의 취득": "capex_ppe", "무형자산의 취득": "capex_intan",
}
IS_KEYS = ["rev", "gp", "op", "pretax", "np"]
BS_KEYS = ["asset", "ca", "nca", "liab", "cl", "ncl", "equity", "cash"]
CF_KEYS = ["cfo", "cfi", "cff", "capex_ppe", "capex_intan"]


def _dart_key() -> str | None:
    for p in (Path(__file__).resolve().parent.parent / ".env",
              Path.home() / "fs-doctor" / ".env"):
        if p.exists():
            for ln in p.read_text(encoding="utf-8").splitlines():
                if ln.startswith("DART_API_KEY="):
                    return ln.split("=", 1)[1].strip()
    return os.environ.get("DART_API_KEY")


def _getj(url: str, timeout: int = 15, tries: int = 4):
    """DART는 간헐적으로 SSL EOF를 던진다 → 재시도. 마지막까지 실패하면 예외를 그대로 올린다
    (호출자가 '데이터 없음'과 구분해야 하므로 여기서 삼키면 안 된다)."""
    req = urllib.request.Request(url, headers={"User-Agent": "chart-principles fin yoo7337@gmail.com"})
    for i in range(tries):
        try:
            return json.loads(urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8"))
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(0.6 * (i + 1))


def _num(s):
    if s in (None, "", "-"):
        return None
    try:
        return float(str(s).replace(",", ""))
    except Exception:
        return None


def _corp_codes(key: str) -> dict:
    """stock_code(6) → corp_code(8)."""
    import io
    import zipfile
    url = f"https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key={key}"
    raw = urllib.request.urlopen(urllib.request.Request(
        url, headers={"User-Agent": "cp"}), timeout=30).read()
    z = zipfile.ZipFile(io.BytesIO(raw))
    import xml.etree.ElementTree as ET
    root = ET.fromstring(z.read(z.namelist()[0]).decode("utf-8"))
    out = {}
    for c in root.iter("list"):
        sc = (c.findtext("stock_code") or "").strip()
        cc = (c.findtext("corp_code") or "").strip()
        if sc and cc and sc != " ":
            out[sc] = cc
    return out


def _extract(rows: list) -> dict:
    """fnlttSinglAcntAll list → {우리키: 금액}. account_id 우선, nm 폴백."""
    out = {}
    for r in rows:
        aid = (r.get("account_id") or "").strip()
        key = ACCT_ID.get(aid)
        if not key:
            key = ACCT_NM.get((r.get("account_nm") or "").strip())
        if not key or key in out:
            continue
        v = _num(r.get("thstrm_amount"))
        if v is not None:
            out[key] = v
    # 자본총계 폴백: 지배지분만 있는 경우
    if "equity" not in out and "equity_owner" in out:
        out["equity"] = out["equity_owner"]
    out.pop("equity_owner", None)
    return out


_CALLS = {"n": 0, "max": 18000}  # DART 일일 한도(20,000) 보호 — 도달 시 중단, 다음 실행이 이어받음
_PARTIAL = set()  # 이번 수집에서 네트워크 실패가 섞인 (corp/fs) — 기존 데이터를 지우지 않게 표시
_CUR = {}         # corp_code → 공시 통화(KRW/USD) — 외국주권은 USD로 신고한다


def _dart_call(url: str):
    if _CALLS["n"] >= _CALLS["max"]:
        raise RuntimeError("call-budget")
    _CALLS["n"] += 1
    time.sleep(0.07)  # 분당 1000회 제한 보호
    return _getj(url)


def _extract_full(rows: list) -> dict:
    """전체계정 → {키: {v: thstrm, add: 누적}} — 분기 차감용으로 누적도 보존."""
    out = {}
    for r in rows:
        aid = (r.get("account_id") or "").strip()
        key = ACCT_ID.get(aid) or ACCT_NM.get((r.get("account_nm") or "").strip())
        if not key or key in out:
            continue
        v = _num(r.get("thstrm_amount"))
        if v is None:
            continue
        out[key] = {"v": v, "add": _num(r.get("thstrm_add_amount"))}
    if "equity" not in out and "equity_owner" in out:
        out["equity"] = out["equity_owner"]
    out.pop("equity_owner", None)
    return out


def _fetch_report(corp: str, key: str, year: int, rc: str, fs: str) -> dict | None:
    """단일 보고서 조회 → _extract_full 결과.
    ⚠반환은 3값: dict=데이터 / None=정말 없음(status 013) / False=조회 실패(네트워크).
    실패를 None(없음)으로 뭉개면 '연속 2년 없음 → 중단' 휴리스틱이 걸려 **이력이 통째로 잘린다**."""
    try:
        d = _dart_call(f"https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?crtfc_key={key}"
                       f"&corp_code={corp}&bsns_year={year}&reprt_code={rc}&fs_div={fs}")
    except RuntimeError:
        raise
    except Exception:
        return False
    if d.get("status") == "000" and d.get("list"):
        rows = d["list"]
        c = next((r.get("currency") for r in rows if r.get("currency")), None)
        if c:
            _CUR[corp] = c.strip().upper()   # 환산은 fetch_kr_fs가 연도별 환율로 수행
        return _extract_full(rows)
    return None


def _eok(d: dict, fx: float = 1.0) -> dict:
    """{k:{v,add}} → 억원 단순값. fx=통화 환산율(USD 공시면 원/달러, KRW면 1)."""
    return {k: round(x["v"] * fx / 1e8, 1) for k, x in d.items()}


# ⚠**외국주권은 USD로 공시한다**(2026-08-07 실사고): 코오롱티슈진(950160) 등 21개 종목의 DART 응답은
#   currency=USD인데 원화로 간주해 ÷1e8 하고 있었다 → 매출 362만USD가 '0억원', 순손실 1.35억USD가
#   '-1.4억원'으로 약 1,400배 축소돼 화면에 나갔다(사용자 제보).
#   → currency를 읽어 **그 연도 기말 원/달러**로 환산한다(연도별로 환율이 30% 넘게 달라 최신 환율
#     일괄 적용은 과거를 왜곡한다). 환율을 못 구하면 **저장을 건너뛴다**(틀린 값보다 없는 게 낫다).
#   ⚠외국주권은 USD만이 아니다 — **CNY 9사·JPY·HKD**도 있다(실측 21사: 중국계가 가장 많다).
#     yfinance 직행 티커는 JPYKRW=X·HKDKRW=X만 이력이 있고 **CNYKRW=X는 최근 1점뿐** →
#     CNY는 `KRW=X ÷ CNY=X`(원/달러 ÷ 위안/달러)로 도출한다(검산: 2025년 205.5원/위안).
_FX_CACHE = {}                         # {통화: {연도: 기말 원화환율}}
_FX_FILE = None                        # 연도별 환율 캐시 파일(재실행 시 네트워크 재조회 회피)
_FX_DIRECT = {"JPY": "JPYKRW=X", "HKD": "HKDKRW=X", "EUR": "EURKRW=X", "GBP": "GBPKRW=X"}


def _yearly_last(series) -> dict:
    return {int(y): round(float(v), 4) for y, v in series.groupby(series.index.year).last().items()}


def _fx_table(cur: str) -> dict:
    """{연도: 기말 '원/해당통화'} — USD는 macro.parquet, 그 외는 yfinance(캐시)."""
    cur = cur.upper()
    if cur in _FX_CACHE:
        return _FX_CACHE[cur]
    global _FX_FILE
    root = APP_DATA.parent.parent
    if _FX_FILE is None:
        _FX_FILE = root / "data" / "fx_by_year.json"
        if _FX_FILE.exists():
            try:
                _FX_CACHE.update({k: {int(y): v for y, v in t.items()}
                                  for k, t in json.loads(_FX_FILE.read_text(encoding="utf-8")).items()})
            except Exception:
                pass
        if cur in _FX_CACHE:
            return _FX_CACHE[cur]
    tbl = {}
    try:
        import pandas as pd
        krw = _yearly_last(pd.read_parquet(root / "data" / "macro.parquet")["KRW=X"].dropna())
        if cur == "USD":
            tbl = krw
        else:
            import yfinance as yf

            def _dl(t):
                s = yf.download(t, start="2014-01-01", progress=False, auto_adjust=True)["Close"].dropna()
                return _yearly_last(s.iloc[:, 0] if getattr(s, "ndim", 1) > 1 else s)

            if cur in _FX_DIRECT:
                tbl = _dl(_FX_DIRECT[cur])
            else:                                   # CNY 등 — 원/달러 ÷ (해당통화/달러)
                per_usd = _dl(f"{cur}=X")
                tbl = {y: round(krw[y] / per_usd[y], 4) for y in per_usd if y in krw and per_usd[y]}
            if len(tbl) < 3:                        # 이력이 사실상 없으면 신뢰 불가 → 미지원 처리
                tbl = {}
    except Exception as e:
        print(f"  환율({cur}) 로드 실패({e})", file=sys.stderr)
    _FX_CACHE[cur] = tbl
    if tbl and _FX_FILE:
        try:
            _FX_FILE.write_text(json.dumps(_FX_CACHE, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass
    return tbl


def _fx_for(year, cur: str) -> float | None:
    """원화 외 공시면 그 연도 기말환율(이력 밖이면 최근접 연도), KRW면 1.0. 못 구하면 None."""
    cur = (cur or "KRW").upper()
    if cur == "KRW":
        return 1.0
    tbl = _fx_table(cur)
    if not tbl:
        return None
    y = int(str(year)[:4])
    return tbl.get(y) or tbl[min(tbl, key=lambda k: abs(k - y))]


def fetch_kr_fs(corp: str, key: str, fs: str) -> dict | None:
    """한 재무제표 구분(CFS=연결/OFS=별도)의 연간 10년 + 최근 분기.
    분기 손익=thstrm(3개월분), 현금흐름=누적 차감, 4Q=연간-3Q누적."""
    this_year = datetime.now(KST).year
    annual_raw = {}   # {year:int → full dict}
    fail = errs = 0
    for yr in range(this_year - 1, this_year - 1 - YEARS, -1):
        got = _fetch_report(corp, key, yr, "11011", fs)
        if got:
            annual_raw[yr] = got
            fail = 0
        elif got is False:   # 조회 실패(네트워크) — '없음'이 아니므로 중단 카운트에서 제외
            errs += 1
        else:
            fail += 1
            if fail >= 2:  # 연속 2년 '없음' → 상장 이전/미작성 → 중단
                break
    if not annual_raw:
        return None
    if errs:   # 실패가 섞였으면 이력이 잘렸을 수 있다 → 호출자가 덮어쓰기를 보류하도록 표시
        _PARTIAL.add(f"{corp}/{fs}")
    # 공시 통화 확인 — USD(외국주권)면 연도별 기말환율로 원화 환산해 억원 스케일을 맞춘다
    cur_code = _CUR.get(corp, "KRW")
    if cur_code != "KRW" and _fx_for(this_year, cur_code) is None:
        print(f"  {corp}: {cur_code} 공시인데 환율을 못 구해 건너뜀", file=sys.stderr)
        return None
    annual = {str(y): _eok(d, _fx_for(y, cur_code)) for y, d in annual_raw.items()}

    # ---- 분기: 최근 2년치(~9분기). 금년+전년만 받으면 연초엔 5분기밖에 안 나와 그래프가 1년치로 보인다 ----
    QRC = [("11013", 1), ("11012", 2), ("11014", 3), ("11011", 4)]
    reports = {}  # {(year, qn): full dict}
    for yr in (this_year, this_year - 1, this_year - 2):
        for rc, qn in QRC:
            if yr == this_year and rc == "11011":
                continue  # 금년 사업보고서는 아직 없음
            if rc == "11011" and yr in annual_raw:
                reports[(yr, 4)] = annual_raw[yr]  # 이미 수집한 연간 재활용(호출 절약)
                continue
            got = _fetch_report(corp, key, yr, rc, fs)
            if got:
                reports[(yr, qn)] = got
    quarter = {}
    IS_SET = set(IS_KEYS)
    for (yr, qn), cur in sorted(reports.items()):
        prev = reports.get((yr, qn - 1))  # 같은 해 직전 분기(누적 차감용)
        q = {}
        for k, x in cur.items():
            if k in IS_SET:  # 손익: thstrm=3개월분(사업보고서만 연간→4Q 차감)
                if qn == 4:
                    p = prev.get(k) if prev else None
                    pcum = (p.get("add") or p.get("v")) if p else None
                    q[k] = x["v"] - pcum if pcum is not None else None
                else:
                    q[k] = x["v"]
            elif k in ("cfo", "cfi", "cff", "capex_ppe", "capex_intan"):  # 현금흐름: 누적 → 차감
                if qn == 1:
                    q[k] = x["v"]
                else:
                    p = prev.get(k) if prev else None
                    q[k] = x["v"] - p["v"] if p else None
            else:  # 재무상태: 시점값
                q[k] = x["v"]
        qfx = _fx_for(yr, cur_code)
        q = {k: round(v * qfx / 1e8, 1) for k, v in q.items() if v is not None}
        if q:
            quarter[f"{str(yr)[2:]}Q{qn}"] = q
    out = {"annual": annual, "quarter": quarter}
    if cur_code != "KRW":
        out["cur_src"] = cur_code   # 프런트가 "USD 공시 → 원화 환산" 각주를 띄우게
    return out


def fetch_kr(code: str, corp: str, key: str) -> dict | None:
    """연결(CFS)+별도(OFS) 각각 수집 — 없는 쪽은 생략(두산테스나처럼 별도만 내는 회사 대응)."""
    out = {}
    for fs, name in (("CFS", "cfs"), ("OFS", "ofs")):
        d = fetch_kr_fs(corp, key, fs)
        if d:
            cur = d.pop("cur_src", None)
            out[name] = d
            if cur:
                out["cur_src"] = cur    # 최상위로 올린다 — 프런트가 각주를 띄우는 자리
    return out or None


def _merge_fs(new: dict | None, old: dict | None) -> dict | None:
    """재무 이력은 **줄어들 수 없다** — 새 수집이 일부만 받아왔어도 기존 연도/분기를 지우지 않는다.
    (DART SSL EOF 한 번에 10년치가 날아가던 사고 방지. 값이 겹치면 새 수집이 이긴다.)"""
    if not old:
        return new
    if not new:
        return old
    out = dict(new)
    for name in ("cfs", "ofs"):
        o, n = old.get(name), new.get(name)
        if not o:
            continue
        if not n:
            out[name] = o          # 통째로 실패한 구분은 기존 것을 유지
            continue
        out[name] = {k: {**(o.get(k) or {}), **(n.get(k) or {})} for k in ("annual", "quarter")}
    return out


def _yf_frame(df, mapping: dict, quarterly: bool = False) -> dict:
    """yfinance 재무 DataFrame(index=계정, columns=날짜) → {연도/분기: {키:값}}."""
    out = {}
    if df is None or df.empty:
        return out
    for col in df.columns:
        try:
            if quarterly and hasattr(col, "month"):
                label = f"{col.strftime('%y')}Q{(col.month - 1) // 3 + 1}"  # 분기말월 기준 캘린더 분기
            else:
                label = col.strftime("%Y") if hasattr(col, "strftime") else str(col)[:4]
        except Exception:
            label = str(col)[:4]
        d = {}
        for acct, k in mapping.items():
            if acct in df.index:
                v = df.loc[acct, col]
                try:
                    if v == v:  # not NaN
                        d[k] = float(v)
                except Exception:
                    pass
        if d:
            out[label] = {k: round(v / 1e6, 1) for k, v in d.items()}  # 달러 → 백만달러
    return out


US_IS = {"Total Revenue": "rev", "Gross Profit": "gp", "Operating Income": "op",
         "Pretax Income": "pretax", "Net Income": "np", "EBITDA": "ebitda"}
US_BS = {"Total Assets": "asset", "Current Assets": "ca", "Total Non Current Assets": "nca",
         "Total Liabilities Net Minority Interest": "liab", "Current Liabilities": "cl",
         "Total Non Current Liabilities Net Minority Interest": "ncl",
         "Stockholders Equity": "equity", "Cash And Cash Equivalents": "cash"}
US_CF = {"Operating Cash Flow": "cfo", "Investing Cash Flow": "cfi", "Financing Cash Flow": "cff",
         "Capital Expenditure": "capex_ppe", "Free Cash Flow": "fcf"}


def fetch_us(tk: str) -> dict | None:
    import yfinance as yf
    t = yf.Ticker(tk)
    try:
        annual, quarter = {}, {}
        for lab, is_df, bs_df, cf_df in [
            ("annual", t.income_stmt, t.balance_sheet, t.cashflow),
            ("quarter", t.quarterly_income_stmt, t.quarterly_balance_sheet, t.quarterly_cashflow)]:
            merged = {}
            for df, mp in [(is_df, US_IS), (bs_df, US_BS), (cf_df, US_CF)]:
                for per, d in _yf_frame(df, mp, lab == "quarter").items():
                    merged.setdefault(per, {}).update(d)
            if lab == "annual":
                annual = merged
            else:
                quarter = merged
        if not annual:
            return None
        return {"annual": annual, "quarter": quarter}
    except Exception:
        return None


def _est_from_company(key: str) -> dict:
    """company.json 컨센서스 → 추정 매출/영업이익/순이익(있으면)."""
    try:
        cmap = json.loads((APP_DATA / "company.json").read_text(encoding="utf-8"))["map"]
    except Exception:
        return {}
    co = cmap.get(key) or {}
    # company.json fin(추정 매출·영업이익) + fin_ext(추정 순이익) — 단위 억원(KR)/동일 통화
    est = {}
    for row in (co.get("fin") or []):
        if row.get("est") and row.get("y"):
            yr = str(row["y"])[:4]
            for kk in ("rev", "op"):
                if row.get(kk) is not None:
                    est.setdefault(yr, {})[kk] = row[kk]
    for row in (co.get("fin_ext") or []):
        if row.get("est") and row.get("y") and row.get("net") is not None:
            est.setdefault(str(row["y"])[:4], {})["np"] = row["net"]
    return est


def _load_index() -> dict:
    if INDEX.exists():
        try:
            return json.loads(INDEX.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _fresh(key: str, idx: dict, age_days: int = MAX_AGE_D) -> bool:
    stamp = idx.get(key)
    if not stamp:
        return False
    try:
        return (datetime.now(KST) - datetime.strptime(stamp, "%Y-%m-%d %H:%M").replace(tzinfo=KST)) < timedelta(days=age_days)
    except Exception:
        return False


_PERIODIC_RE = re.compile(r"(사업보고서|반기보고서|분기보고서)")


def codes_from_disclosures(days: int) -> set:
    """최근 N일 공시에서 **정기보고서를 낸 종목코드**만 뽑는다.

    재무제표는 매일 바뀌지 않고 정기보고서 공시일에만 바뀐다 → 전 종목을 훑을 이유가 없다.
    (실측: 하루 평균 6.3건 · 최대 24건 → 종목당 ~70콜이어도 하루 수백 콜이면 끝난다.)
    ⚠정정([기재정정] 등)도 수치가 바뀌므로 포함한다 — 공시명에 태그가 붙어도 정규식이 본문을 잡는다.
    """
    out = set()
    ddir = APP_DATA / "disclosures"
    if not ddir.is_dir():
        return out
    for p in sorted(ddir.glob("20*.json"), reverse=True)[:max(1, days)]:
        try:
            items = (json.loads(p.read_text(encoding="utf-8")) or {}).get("items") or []
        except Exception:
            continue
        for it in items:
            # 압축 배열: [회사명, 종목코드, 시장, 공시명, 접수번호, 제출인, 카테고리, 정정, 반응]
            if len(it) > 3 and it[1] and _PERIODIC_RE.search(it[3] or ""):
                out.add(str(it[1]).zfill(6))
    return out


def _read(key: str) -> dict | None:
    p = OUTDIR / f"{key}.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def _write(key: str, payload: dict):
    OUTDIR.mkdir(parents=True, exist_ok=True)
    (OUTDIR / f"{key}.json").write_text(
        json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", help="특정 KR 종목코드 또는 US 티커")
    ap.add_argument("--kr-only", action="store_true")
    ap.add_argument("--us-only", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--max-calls", type=int, default=0,
                    help="이번 실행의 DART 호출 상한(같은 날 여러 번 돌릴 때 20,000 한도 분할용)")
    ap.add_argument("--from-disclosures", type=int, metavar="DAYS", default=0,
                    help="KR: 최근 N일 공시에서 정기보고서를 낸 종목만 갱신(일일 배치용). US엔 영향 없음")
    ap.add_argument("--us-age", type=int, metavar="DAYS", default=0,
                    help="US age 가드 일수 override(기본 6). 미국은 yfinance라 호출 한도가 없어 1로 매일 돌려도 된다")
    args = ap.parse_args()
    if args.max_calls:
        _CALLS["max"] = args.max_calls
    now = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    idx = _load_index()

    kr_names = json.loads((Path(__file__).resolve().parent.parent / "data" / "kr_names.json").read_text(encoding="utf-8")) \
        if (Path(__file__).resolve().parent.parent / "data" / "kr_names.json").exists() else {}

    only_kr = args.only and args.only.isdigit()
    only_us = args.only and not args.only.isdigit()

    # ---------- KR ----------
    if not args.us_only and not only_us:
        key = _dart_key()
        if not key:
            print("DART_API_KEY 없음 — KR 스킵", file=sys.stderr)
        else:
            cmap = _corp_codes(key)
            codes = [args.only] if args.only and args.only.isdigit() else list(kr_names.keys() or cmap.keys())
            if args.from_disclosures:
                filed = codes_from_disclosures(args.from_disclosures)
                codes = [c for c in codes if c in filed]
                print(f"  [KR fin] 최근 {args.from_disclosures}일 정기보고서 제출 {len(filed)}종목 → 유니버스 내 {len(codes)}종목만 갱신")
                for c in codes:      # age 가드를 넘겨 반드시 다시 받게 한다(수치가 바뀐 종목이므로)
                    idx.pop(f"kr_{c}", None)
            done = wrote = 0
            for code in codes:
                k = f"kr_{code}"
                if not args.force and _fresh(k, idx):
                    continue
                corp = cmap.get(code)
                if not corp:
                    continue
                try:
                    data = fetch_kr(code, corp, key)
                except RuntimeError:  # 일일 호출 한도 도달 — 다음 실행이 index 가드로 이어받음
                    print(f"  [KR fin] 호출 한도 도달({_CALLS['n']}) — 중단, 다음 실행이 이어서 수집")
                    break
                done += 1
                if data:
                    data = _merge_fs(data, _read(k))   # 기존 이력 보존(수집 실패로 줄어들지 않게)
                    data["market"] = "kr"
                    data["est"] = _est_from_company(k)
                    _write(k, data)
                    idx[k] = now
                    wrote += 1
                if done % 50 == 0:
                    print(f"  [KR fin] {done} (저장 {wrote}, 호출 {_CALLS['n']})")
                    INDEX.write_text(json.dumps(idx, ensure_ascii=False), encoding="utf-8")
            print(f"  KR 재무 {wrote}종목 저장 (DART 호출 {_CALLS['n']})")

    # ---------- US ----------
    if not args.kr_only and not only_kr:
        tickers = [args.only] if only_us else US_TICKERS
        if args.limit:
            tickers = tickers[:args.limit]
        wrote = 0
        # ⚠미국 실적은 분기말 3주 뒤에 몰려 발표된다(TSLA·GOOGL 7/22). 가드가 6일이면 그만큼 늦게 반영된다.
        #   yfinance는 DART 같은 일일 한도가 없으니 --us-age 1로 매일 확인해도 부담이 없다.
        us_age = args.us_age or MAX_AGE_D
        for i, tk in enumerate(tickers, 1):
            k = f"us_{tk}"
            if not args.force and _fresh(k, idx, us_age):
                continue
            data = fetch_us(tk)
            if data:
                data["market"] = "us"
                data["est"] = _est_from_company(k)
                _write(k, data)
                idx[k] = now
                wrote += 1
            if i % 25 == 0:
                print(f"  [US fin] {i}/{len(tickers)} (저장 {wrote})")
                INDEX.write_text(json.dumps(idx, ensure_ascii=False), encoding="utf-8")
            time.sleep(0.15)
        print(f"  US 재무 {wrote}종목 저장")

    INDEX.write_text(json.dumps(idx, ensure_ascii=False), encoding="utf-8")
    print(f"완료: financials/ (index {len(idx)}종목)")


if __name__ == "__main__":
    main()

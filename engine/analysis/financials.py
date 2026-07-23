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


def _getj(url: str, timeout: int = 15):
    req = urllib.request.Request(url, headers={"User-Agent": "chart-principles fin yoo7337@gmail.com"})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8"))


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
    """단일 보고서 조회 → _extract_full 결과 (없으면 None)."""
    try:
        d = _dart_call(f"https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?crtfc_key={key}"
                       f"&corp_code={corp}&bsns_year={year}&reprt_code={rc}&fs_div={fs}")
    except RuntimeError:
        raise
    except Exception:
        return None
    if d.get("status") == "000" and d.get("list"):
        return _extract_full(d["list"])
    return None


def _eok(d: dict) -> dict:
    """{k:{v,add}} → 억원 단순값."""
    return {k: round(x["v"] / 1e8, 1) for k, x in d.items()}


def fetch_kr_fs(corp: str, key: str, fs: str) -> dict | None:
    """한 재무제표 구분(CFS=연결/OFS=별도)의 연간 10년 + 최근 분기.
    분기 손익=thstrm(3개월분), 현금흐름=누적 차감, 4Q=연간-3Q누적."""
    this_year = datetime.now(KST).year
    annual_raw = {}   # {year:int → full dict}
    fail = 0
    for yr in range(this_year - 1, this_year - 1 - YEARS, -1):
        got = _fetch_report(corp, key, yr, "11011", fs)
        if got:
            annual_raw[yr] = got
            fail = 0
        else:
            fail += 1
            if fail >= 2:  # 연속 2년 없음 → 상장 이전/미작성 → 중단
                break
    if not annual_raw:
        return None
    annual = {str(y): _eok(d) for y, d in annual_raw.items()}

    # ---- 분기: 최근 ~6분기 (금년 + 전년 보고서) ----
    QRC = [("11013", 1), ("11012", 2), ("11014", 3), ("11011", 4)]
    reports = {}  # {(year, qn): full dict}
    for yr in (this_year, this_year - 1):
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
        q = {k: round(v / 1e8, 1) for k, v in q.items() if v is not None}
        if q:
            quarter[f"{str(yr)[2:]}Q{qn}"] = q
    return {"annual": annual, "quarter": quarter}


def fetch_kr(code: str, corp: str, key: str) -> dict | None:
    """연결(CFS)+별도(OFS) 각각 수집 — 없는 쪽은 생략(두산테스나처럼 별도만 내는 회사 대응)."""
    out = {}
    for fs, name in (("CFS", "cfs"), ("OFS", "ofs")):
        d = fetch_kr_fs(corp, key, fs)
        if d:
            out[name] = d
    return out or None


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


def _fresh(key: str, idx: dict) -> bool:
    stamp = idx.get(key)
    if not stamp:
        return False
    try:
        return (datetime.now(KST) - datetime.strptime(stamp, "%Y-%m-%d %H:%M").replace(tzinfo=KST)) < timedelta(days=MAX_AGE_D)
    except Exception:
        return False


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
    args = ap.parse_args()
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
            if args.limit:
                codes = codes[:args.limit]
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
        for i, tk in enumerate(tickers, 1):
            k = f"us_{tk}"
            if not args.force and _fresh(k, idx):
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

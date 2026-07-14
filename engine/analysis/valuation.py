# -*- coding: utf-8 -*-
r"""내재가치 입력 데이터 수집 → app\data\valuation.json (주 1회 가드)

계산은 웹(브라우저 JS)에서 슬라이더로 실시간 수행 — 이 스크립트는 입력만 공급.
- US(yfinance): FCF 이력(영업CF−CAPEX)·주식수·순부채·베타·BPS·ROE·성장추정 → DCF+RIM
- KR(네이버 기업실적분석 연간 테이블): EPS/BPS/ROE 실적+추정 → RIM (DCF는 DART 연동 2단계)
- 현재가: 종목 캐시 마지막 종가

사용법: python analysis\valuation.py [--force]
"""
import argparse
import io
import json
import re
import sys
import time
from datetime import date
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from collect import load_all
from common import APP_DATA, ROOT
from fundamentals import _get, _num

OUT = APP_DATA / "valuation.json"
MAX_AGE_DAYS = 7


def fv(v, nd=4):
    try:
        v = float(v)
        return None if v != v else round(v, nd)
    except (TypeError, ValueError):
        return None


def kr_annuals(code: str) -> dict:
    """네이버 기업실적분석 연간 테이블 → EPS/BPS/ROE 리스트(실적 3 + 추정 1, 오래된→최신)."""
    html = _get(f"https://finance.naver.com/item/main.naver?code={code}")
    tables = pd.read_html(io.StringIO(html))
    perf = next((t for t in tables if any("ROE" in str(x) for x in t.iloc[:, 0].astype(str))), None)
    if perf is None:
        return {}
    perf = perf.set_index(perf.columns[0])

    def row_vals(key, n=4):  # 연간 컬럼은 앞 4개(실적3+추정1)
        row = next((perf.loc[i] for i in perf.index if key in str(i)), None)
        if row is None:
            return []
        vals = [_num(v) for v in row.tolist()[:n]]
        return [v for v in vals]  # None 유지(연도 정렬 보존)

    out = {"eps": row_vals("EPS"), "bps": row_vals("BPS"), "roe": row_vals("ROE")}
    # 연도 라벨
    try:
        cols = [str(c[1] if isinstance(c, tuple) else c) for c in perf.columns[:4]]
        out["years"] = [re.sub(r"[^\d.]", "", c)[:7] for c in cols]
    except Exception:
        pass
    return out if any(out.get(k) for k in ("bps", "roe")) else {}


def us_inputs(ticker: str) -> dict:
    import yfinance as yf
    tk = yf.Ticker(ticker)
    out = {}
    try:
        cf = tk.cashflow
        ocf_row = next((r for r in cf.index if "Operating Cash Flow" in r), None)
        capex_row = next((r for r in cf.index if "Capital Expenditure" in r), None)
        if ocf_row and capex_row is not None:
            ocf = cf.loc[ocf_row].dropna()
            capex = cf.loc[capex_row].reindex(ocf.index).fillna(0)
            fcf = (ocf + capex).tolist()[:4]  # capex는 음수로 옴
            out["fcf"] = [fv(x, 0) for x in fcf if fv(x, 0) is not None]  # 최신→과거
    except Exception:
        pass
    try:
        info = tk.info
        out["shares"] = fv(info.get("sharesOutstanding"), 0)
        cash = info.get("totalCash") or 0
        debt = info.get("totalDebt") or 0
        out["net_debt"] = fv(debt - cash, 0)
        out["beta"] = fv(info.get("beta"), 2)
        out["growth_est"] = fv(info.get("earningsGrowth") or info.get("revenueGrowth"), 3)
        out["bps"] = fv(info.get("bookValue"), 2)
        out["roe"] = fv((info.get("returnOnEquity") or 0) * 100, 2) or None
        out["eps"] = fv(info.get("trailingEps"), 2)
    except Exception:
        pass
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    if OUT.exists() and not args.force:
        gen = date.fromisoformat(json.loads(OUT.read_text(encoding="utf-8"))["generated"])
        if (date.today() - gen).days < MAX_AGE_DAYS:
            print(f"valuation 스냅샷 {gen} — {MAX_AGE_DAYS}일 미경과, 스킵")
            return

    data = load_all()
    vmap, fail = {}, 0
    for i, ((mk, tk), df) in enumerate(sorted(data.items()), 1):
        try:
            rec = {"price": fv(df["close"].iloc[-1], 2),
                   "price_date": df.index[-1].strftime("%Y-%m-%d")}
            if mk == "kr":
                rec.update(kr_annuals(tk))
            else:
                rec.update(us_inputs(tk))
            vmap[f"{mk}_{tk}"] = rec
        except Exception:
            fail += 1
        if i % 50 == 0:
            print(f"  {i}/{len(data)}")
        time.sleep(0.15)

    # NaN 이중 차단
    clean = {}
    for k, v in vmap.items():
        clean[k] = {kk: ([x for x in vv if not (isinstance(x, float) and x != x)] if isinstance(vv, list)
                         else vv) for kk, vv in v.items()
                    if not (isinstance(vv, float) and vv != vv)}
    OUT.write_text(json.dumps({"generated": date.today().isoformat(), "map": clean},
                              ensure_ascii=False, allow_nan=False), encoding="utf-8")
    kr_ok = sum(1 for k, v in clean.items() if k.startswith("kr_") and v.get("roe"))
    us_ok = sum(1 for k, v in clean.items() if k.startswith("us_") and v.get("fcf"))
    print(f"완료: valuation.json — KR RIM 가능 {kr_ok} / US DCF 가능 {us_ok} (실패 {fail})")


if __name__ == "__main__":
    main()

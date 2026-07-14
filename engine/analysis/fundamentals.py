# -*- coding: utf-8 -*-
r"""종목 재무·기본정보 스냅샷 → app\data\fundamentals.json (주 1회 내부 가드)

- US: yfinance .info — PER(t/f)·PBR·ROE·배당률·시총·베타·52주고저·매출성장·이익률
- KR: 네이버 금융 종목 메인 — PER·PBR·배당률·시총·52주고저·외국인소진율·ROE(실적 테이블)
- 실패 종목은 필드 생략(부분 데이터 허용). daily 배치에 포함되나 7일 미경과 시 스킵.

사용법: python analysis\fundamentals.py [--force]
"""
import argparse
import io
import json
import re
import sys
import time
import urllib.request
from datetime import date
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from collect import DATA_DIR, load_all
from common import APP_DATA

OUT = APP_DATA / "fundamentals.json"
MAX_AGE_DAYS = 7


def _get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    raw = urllib.request.urlopen(req, timeout=15).read()
    try:  # 네이버 페이지별로 UTF-8/euc-kr 혼재 → 자동 감지
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("euc-kr", "ignore")


def _num(s) -> float | None:
    try:
        v = float(str(s).replace(",", "").replace("%", "").strip())
        return None if v != v else v  # NaN 차단 (JSON에 NaN이 들어가면 브라우저 파싱 실패)
    except (ValueError, TypeError):
        return None


def kr_fundamentals(code: str) -> dict:
    """네이버 종목 메인 페이지에서 핵심 지표 파싱."""
    html = _get(f"https://finance.naver.com/item/main.naver?code={code}")
    f = {}

    def rx(pattern, group=1):
        m = re.search(pattern, html, re.S)
        return m.group(group).strip() if m else None

    # 투자정보 박스: PER/PBR/배당수익률 — id 기반 (52주 고저는 웹이 차트 시계열에서 직접 계산)
    f["per"] = _num(rx(r'id="_per"[^>]*>([\d,.\-]+)'))
    f["pbr"] = _num(rx(r'id="_pbr"[^>]*>([\d,.\-]+)'))
    f["div_yield"] = _num(rx(r'id="_dvr"[^>]*>([\d,.\-]+)'))
    # 시가총액: <em id="_market_sum">1,666조 1,894</em>억원 형태
    ms = rx(r'id="_market_sum"[^>]*>(.*?)</em>')
    if ms:
        ms = re.sub(r"\s+", " ", ms).strip()
        m = re.match(r"(?:([\d,]+)조)?\s*([\d,]+)?", ms)
        if m and (m.group(1) or m.group(2)):
            f["mcap"] = (_num(m.group(1)) or 0) * 1e12 + (_num(m.group(2)) or 0) * 1e8

    # 기업실적분석 테이블(read_html) — ROE·영업이익률 최근 연간
    try:
        tables = pd.read_html(io.StringIO(html))
        perf = next((t for t in tables if any("ROE" in str(x) for x in t.iloc[:, 0].astype(str))), None)
        if perf is not None:
            perf = perf.set_index(perf.columns[0])
            def last_val(row_key):
                row = next((perf.loc[i] for i in perf.index if row_key in str(i)), None)
                if row is None:
                    return None
                vals = [(_num(v)) for v in row.tolist() if _num(v) is not None]
                return vals[3] if len(vals) > 3 else (vals[-1] if vals else None)  # 최근 연간(4번째=전년)
            f["roe"] = last_val("ROE")
            f["op_margin"] = last_val("영업이익률")
    except Exception:
        pass
    return {k: v for k, v in f.items() if v is not None}


def us_fundamentals(ticker: str) -> dict:
    import yfinance as yf
    info = yf.Ticker(ticker).info
    pick = {
        "per": info.get("trailingPE"), "per_fwd": info.get("forwardPE"),
        "pbr": info.get("priceToBook"),
        "roe": (info.get("returnOnEquity") or 0) * 100 or None,
        "div_yield": (info.get("dividendYield") or 0) or None,
        "mcap": info.get("marketCap"), "beta": info.get("beta"),
        "hi52": info.get("fiftyTwoWeekHigh"), "lo52": info.get("fiftyTwoWeekLow"),
        "rev_growth": (info.get("revenueGrowth") or 0) * 100 or None,
        "profit_margin": (info.get("profitMargins") or 0) * 100 or None,
        "name_full": info.get("shortName"),
        "industry": info.get("industry"),
    }
    return {k: (round(v, 2) if isinstance(v, float) else v) for k, v in pick.items() if v is not None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    if OUT.exists() and not args.force:
        gen = date.fromisoformat(json.loads(OUT.read_text(encoding="utf-8"))["generated"])
        if (date.today() - gen).days < MAX_AGE_DAYS:
            print(f"재무 스냅샷 {gen} ({(date.today()-gen).days}일 전) — {MAX_AGE_DAYS}일 미경과, 스킵")
            return

    data = load_all()
    fmap, fail = {}, 0
    for i, (mk, tk) in enumerate(sorted(data), 1):
        try:
            fmap[f"{mk}_{tk}"] = kr_fundamentals(tk) if mk == "kr" else us_fundamentals(tk)
        except Exception:
            fail += 1
        if i % 50 == 0:
            print(f"  {i}/{len(data)}")
        time.sleep(0.2)

    # NaN/inf 최종 차단 후 저장 (allow_nan=False로 이중 안전)
    clean = {k: {kk: vv for kk, vv in v.items()
                 if not (isinstance(vv, float) and (vv != vv or vv in (float("inf"), float("-inf"))))}
             for k, v in fmap.items()}
    OUT.write_text(json.dumps({"generated": date.today().isoformat(), "map": clean},
                              ensure_ascii=False, allow_nan=False), encoding="utf-8")
    got = sum(1 for v in fmap.values() if v)
    print(f"완료: fundamentals.json — {got}/{len(data)}종목 (실패 {fail})")


if __name__ == "__main__":
    main()

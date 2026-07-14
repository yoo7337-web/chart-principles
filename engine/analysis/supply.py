# -*- coding: utf-8 -*-
r"""종목별 수급(외국인·기관 순매수) 수집 → data\flow_{code}.parquet 캐시

pykrx 투자자 데이터는 KRX 로그인 벽으로 막힘 → 네이버 frgn 페이지 스크래핑 우회.
컬럼: inst_net_vol(기관 순매매량) · frgn_net_vol(외국인 순매매량) · frgn_ratio(외국인 보유율 %)
한국 종목 한정(미국은 투자자별 수급 공개 데이터 없음).

사용법:
    python analysis\supply.py            # 전체(최초 ~10분, 3페이지≈90일)
    python analysis\supply.py --refresh  # 증분(1페이지≈30일 병합, 일일 배치용)
"""
import argparse
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from collect import DATA_DIR

PAGES_FULL = 3   # ~90일
PAGES_INCR = 1   # ~30일


def _fetch_page(code: str, page: int) -> pd.DataFrame | None:
    url = f"https://finance.naver.com/item/frgn.naver?code={code}&page={page}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    html = urllib.request.urlopen(req, timeout=15).read().decode("euc-kr", "ignore")
    for t in pd.read_html(io.StringIO(html)):
        cols = [str(c) for c in t.columns.tolist()]
        if any("순매매량" in c for c in cols) and t.shape[1] == 9:
            t = t.copy()
            t.columns = ["date", "close", "diff", "chg", "vol",
                         "inst_net_vol", "frgn_net_vol", "frgn_shares", "frgn_ratio"]
            t = t.dropna(subset=["date"])
            return t
    return None


def _num(s):
    try:
        return float(str(s).replace(",", "").replace("%", "").strip())
    except (ValueError, TypeError):
        return None


def fetch_flow(code: str, pages: int) -> pd.DataFrame | None:
    rows = []
    for p in range(1, pages + 1):
        try:
            df = _fetch_page(code, p)
        except Exception:
            break
        if df is None or df.empty:
            break
        for _, r in df.iterrows():
            d = str(r["date"]).replace(".", "-").strip()
            inst, frgn, ratio = _num(r["inst_net_vol"]), _num(r["frgn_net_vol"]), _num(r["frgn_ratio"])
            if len(d) == 10 and (inst is not None or frgn is not None):
                rows.append({"date": d, "inst_net_vol": inst, "frgn_net_vol": frgn, "frgn_ratio": ratio})
        time.sleep(0.2)
    if not rows:
        return None
    out = pd.DataFrame(rows).drop_duplicates("date").set_index("date").sort_index()
    out.index = pd.to_datetime(out.index)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="증분(1페이지≈30일 병합)")
    ap.add_argument("--quick", action="store_true", help="소수 종목만(검증)")
    args = ap.parse_args()

    names_path = DATA_DIR / "kr_names.json"
    if not names_path.exists():
        print("kr_names.json 없음 — collect.py 먼저", file=sys.stderr)
        sys.exit(1)
    codes = list(json.loads(names_path.read_text(encoding="utf-8")))
    if args.quick:
        codes = codes[:10]
    pages = PAGES_INCR if args.refresh else PAGES_FULL
    print(f"[수급] {len(codes)}종목 × {pages}페이지 수집 시작")

    ok, fail = 0, 0
    for i, code in enumerate(codes, 1):
        path = DATA_DIR / f"flow_{code}.parquet"
        try:
            new = fetch_flow(code, pages)
            if new is None:
                fail += 1
                continue
            if args.refresh and path.exists():
                old = pd.read_parquet(path)
                merged = pd.concat([old[~old.index.isin(new.index)], new]).sort_index()
            else:
                merged = new
            merged.to_parquet(path)
            ok += 1
        except Exception as e:
            fail += 1
            print(f"  {code} 실패: {e}", file=sys.stderr)
        if i % 100 == 0:
            print(f"  {i}/{len(codes)}")
        time.sleep(0.15)
    print(f"[수급] 완료: {ok}종목 (실패 {fail})")


if __name__ == "__main__":
    main()

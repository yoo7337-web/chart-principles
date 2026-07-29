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


"""네이버 모바일 API — frgn HTML엔 없는 **개인 순매매량**까지 준다(근사 유도가 아닌 실측).
`/api/stock/{code}/trend?page=N&pageSize=50` (pageSize 100은 400 · 50이 상한). 실패 시 HTML 스크래핑 폴백."""
_TREND = "https://m.stock.naver.com/api/stock/{code}/trend?page={page}&pageSize=50"
_TREND_HDRS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/122.0 Safari/537.36",
    "Referer": "https://m.stock.naver.com/",
}


def _fetch_trend(code: str, pages: int) -> list:
    """⚠이 API엔 **페이지네이션이 없다** — page를 늘려도 같은 최근 50거래일을 준다(실측 page 1/2/3 동일).
    그래서 한 번에 받는 건 50일이 최대이고, 그 이상은 main의 병합으로 누적된다."""
    rows = []
    for p in (1,):
        req = urllib.request.Request(_TREND.format(code=code, page=p), headers=_TREND_HDRS)
        try:
            arr = json.loads(urllib.request.urlopen(req, timeout=15).read().decode("utf-8"))
        except Exception:
            break
        if not arr:
            break
        for r in arr:
            d = str(r.get("bizdate") or "")
            if len(d) != 8:
                continue
            rows.append({"date": f"{d[:4]}-{d[4:6]}-{d[6:]}",
                         "inst_net_vol": _num(r.get("organPureBuyQuant")),
                         "frgn_net_vol": _num(r.get("foreignerPureBuyQuant")),
                         "indi_net_vol": _num(r.get("individualPureBuyQuant")),
                         "frgn_ratio": _num(r.get("foreignerHoldRatio"))})
        time.sleep(0.15)
    return rows


def fetch_flow(code: str, pages: int) -> pd.DataFrame | None:
    rows = _fetch_trend(code, pages)
    if not rows:   # API 실패 시에만 구 HTML 경로(개인 없음)
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
            # ⚠**항상 병합**한다(--refresh 여부 무관). 소스가 한 번에 주는 건 최근 50거래일뿐이라
            #   덮어쓰면 이력이 영원히 50일에 묶인다. 병합해야 실행할수록 과거가 쌓인다.
            if path.exists():
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

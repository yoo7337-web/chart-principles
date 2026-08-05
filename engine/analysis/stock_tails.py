# -*- coding: utf-8 -*-
r"""종목조회 차트(app\data\stocks\*.json)의 시계열 꼬리만 최신 종가로 갱신.

배경(2026-07-23): stocks/*.json은 update_rules.py(원칙 재검증, **90일 텀 가드**)에서만 생성돼
차트가 최대 90일까지 뒤처졌다. 헤더 가격은 market.json quotes(30분 갱신)를 쓰는 탓에
"헤더 260,500원 / 차트 마지막 봉 243,000원"처럼 같은 화면에서 숫자가 어긋났다.

이 스크립트는 무거운 원칙 재검증 없이 **series 꼬리 + asof만** parquet에서 이어붙인다
(markers/stats/profile은 원칙 산출물이라 건드리지 않음 — 신호는 scan_today가 별도 담당).

사용법: python analysis\stock_tails.py [--limit N]
"""
import argparse
import json
import sys
from datetime import date
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from collect import DATA_DIR
from common import APP_DATA

STOCKS = APP_DATA / "stocks"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="앞 N개만(테스트용)")
    args = ap.parse_args()

    files = sorted(STOCKS.glob("*.json"))
    files = [f for f in files if f.name != "index.json"]
    if args.limit:
        files = files[: args.limit]

    updated = added_rows = skipped = missing = 0
    newest = ""
    for f in files:
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        s = d.get("series") or []
        if not s:
            continue
        mk, tk = d.get("market"), d.get("ticker")
        p = DATA_DIR / f"{mk}_{tk.replace('-', '_')}.parquet"
        if not p.exists():
            missing += 1
            continue
        # v214: series는 압축 배열 [t,o,h,l,c,v]. 구 dict 형식 파일도 그대로 읽히도록 접근자를 통일한다.
        arr = isinstance(s[0], list)
        gT = (lambda r: r[0]) if arr else (lambda r: r["t"])
        gC = (lambda r: r[4]) if arr else (lambda r: r["c"])
        last = gT(s[-1])
        try:
            df = pd.read_parquet(p)
        except Exception:
            continue
        # 마지막 봉 날짜(>=)부터 교체 — 12:30 장중 스냅샷이 17:40 확정치(pykrx)로 덮이도록.
        # (구 로직 `>`는 이미 있는 날짜를 안 고쳐 장중 종가 267,250이 확정 270,000으로 교정 안 되던 버그)
        tail = df[df.index >= pd.Timestamp(last)]
        if tail.empty:
            skipped += 1
            continue
        rows = [[i.strftime("%Y-%m-%d"), round(float(r["open"]), 4), round(float(r["high"]), 4),
                 round(float(r["low"]), 4), round(float(r["close"]), 4), float(r["volume"])]
                for i, r in tail.iterrows() if pd.notna(r["close"])]
        if not rows:
            skipped += 1
            continue
        base = s[:-1] if rows[0][0] == last else s  # 같은 날짜면 기존 마지막 봉 제거 후 교체
        if base and rows[0][0] == gT(base[-1]):
            skipped += 1
            continue
        # 변화 없으면(같은 날짜·같은 종가 1행뿐) 불필요한 재기록 생략
        if len(rows) == 1 and rows[0][0] == last and abs(rows[0][4] - gC(s[-1])) < 1e-9:
            skipped += 1
            continue
        # 구 dict 기록이 남아 있으면 이번 기회에 배열로 통일(혼합 방지)
        if not arr:
            base = [[gT(r), r["o"], r["h"], r["l"], r["c"], r["v"]] for r in base]
        d["series"] = base + rows
        d["asof"] = rows[-1][0]
        d["tail_updated"] = date.today().isoformat()   # 꼬리만 갱신된 날(원칙 재검증일과 구분)
        f.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
        updated += 1
        added_rows += len(rows)
        # 🐞💀v214에서 rows를 배열로 바꾸며 이 줄만 dict 접근(["t"])으로 남아 **첫 갱신 직후 크래시**했다.
        #   위치가 루프 안·write 다음이라 "매일 1종목만 갱신하고 전체 중단" — 차트가 조용히 낡아갔다
        #   (실측 2026-08-05: 전 종목 asof 07-31에 정지, 사용자 감사 요청으로 발견).
        newest = max(newest, rows[-1][0])

    print(f"완료: {updated}종목 갱신(+{added_rows}행, 최신 {newest or '-'}) · "
          f"이미최신 {skipped} · parquet없음 {missing} / 전체 {len(files)}")


if __name__ == "__main__":
    main()

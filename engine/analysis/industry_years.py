# -*- coding: utf-8 -*-
r"""연도별 산업 수익률 — 어떤 산업이 그 해를 주도했나 → app\data\industry_years.json

"연도별로 어떤 산업의 주가 상승률이 높았는지"를 한 표로 본다(사용자 요청).
로테이션(1주·1개월·3개월)은 지금 흐름만 보여주고, 장기 주도권 이동은 안 보였다.

방법:
 ·종목별 연간 수익률 = 그 해 마지막 종가 ÷ 전년 마지막 종가 − 1
 ·산업군 대표값 = **중앙값**(시총가중이 아니다 — 과거 시총이 없어 현재 시총을 쓰면 생존·성장 편향이 생긴다.
   중앙값은 대형주 1~2개가 산업 전체를 대표해 버리는 왜곡도 막는다)
 ·평균과 상위/하위도 함께 담아 화면이 분포를 보여줄 수 있게 한다
 ⚠'etc'(미분류)는 산업이 아니라 잔여 묶음이라 **제외**한다(실측: 여러 해 1위로 올라와 표를 망친다)
 ⚠종목 수가 적은 산업·연도(<5)는 대표값을 만들지 않는다(우연이 순위를 지배한다)

사용법: python analysis\industry_years.py [--years 10]
"""
import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from collect import load_all  # noqa: E402
from common import APP_DATA  # noqa: E402

KST = timezone(timedelta(hours=9))
OUT = APP_DATA / "industry_years.json"
MIN_N = 5          # 산업·연도별 최소 종목 수
SKIP_GRP = {"etc"}  # 미분류는 산업이 아니다


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, default=10)
    a = ap.parse_args()

    mk_json = json.loads((APP_DATA / "market.json").read_text(encoding="utf-8"))
    hm = mk_json.get("heatmap") or []
    grp = {f"{t['m']}_{t['t']}": t.get("grp") for t in hm if t.get("grp") and t["grp"] not in SKIP_GRP}
    names = {t.get("grp"): t.get("grp") for t in hm}          # 표시명은 프런트의 IND_GROUPS가 가진다
    data = load_all()

    recs = []
    for key, g in grp.items():
        mk, tk = key.split("_", 1)
        df = data.get((mk, tk))
        if df is None or len(df) < 300:
            continue
        y = df["close"].resample("YE").last()
        r = y.pct_change(fill_method=None).dropna() * 100
        for ts, v in r.items():
            if np.isfinite(v):
                recs.append((ts.year, mk, g, float(v)))
    if not recs:
        raise SystemExit("연간 수익률을 계산할 데이터가 없습니다")

    P = pd.DataFrame(recs, columns=["yr", "mk", "grp", "ret"])
    this_year = datetime.now(KST).year
    yrs = [y for y in sorted(P.yr.unique()) if y > this_year - a.years]

    out = {}
    for mk in ("kr", "us"):
        Q = P[P.mk == mk]
        if Q.empty:
            continue
        cells, tops = {}, {}
        for y in yrs:
            g = Q[Q.yr == y]
            if g.empty:
                continue
            agg = g.groupby("grp")["ret"].agg(["median", "mean", "size"])
            agg = agg[agg["size"] >= MIN_N]
            if agg.empty:
                continue
            for gk, row in agg.iterrows():
                cells.setdefault(gk, {})[str(y)] = {
                    "med": round(float(row["median"]), 1),
                    "avg": round(float(row["mean"]), 1),
                    "n": int(row["size"])}
            best = agg["median"].idxmax()
            worst = agg["median"].idxmin()
            tops[str(y)] = {"best": best, "best_v": round(float(agg["median"].max()), 1),
                            "worst": worst, "worst_v": round(float(agg["median"].min()), 1),
                            "mkt": round(float(g["ret"].median()), 1), "n": int(agg["size"].sum())}
        # 산업별 요약(기간 내 1위 횟수·평균)
        summary = {}
        for gk, per in cells.items():
            vs = [v["med"] for v in per.values()]
            summary[gk] = {"avg": round(float(np.mean(vs)), 1),
                           "wins": sum(1 for y, t in tops.items() if t["best"] == gk),
                           "years": len(vs)}
        out[mk] = {"years": [str(y) for y in yrs], "cells": cells, "tops": tops, "summary": summary}

    payload = {"generated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"),
               "note": "산업 대표값=소속 종목 연간수익률의 중앙값(시총가중 아님 — 과거 시총이 없어 편향을 피함)",
               "min_n": MIN_N, **out}
    OUT.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    kr = out.get("kr", {})
    print(f"완료: industry_years.json — 연도 {len(kr.get('years') or [])} · 산업 {len(kr.get('cells') or {})}")
    for y, t in list((kr.get("tops") or {}).items())[-5:]:
        print(f"  {y}: 1위 {t['best']} {t['best_v']:+.0f}% · 최하 {t['worst']} {t['worst_v']:+.0f}% · 시장 {t['mkt']:+.0f}%")


if __name__ == "__main__":
    main()

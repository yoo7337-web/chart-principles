# -*- coding: utf-8 -*-
"""시장 국면(레짐) 분류 — 시장별 동일가중 종합지수의 '과거 120영업일 수익률'로 판정 (선견편향 없음).

  급등장(bull):   직전 120영업일 수익률 ≥ +20%
  하락장(bear):   직전 120영업일 수익률 ≤ -10%
  일반장(neutral): 그 사이
"""
import pandas as pd

WIN = 120
UP, DN = 0.20, -0.10


def composite_index(data: dict, market: str) -> pd.Series:
    """시장별 동일가중 종합지수 (일별 평균수익률 누적)."""
    rets = {t: df["close"].pct_change() for (m, t), df in data.items() if m == market}
    mean_ret = pd.DataFrame(rets).mean(axis=1)
    return (1 + mean_ret.fillna(0)).cumprod()


def classify(idx: pd.Series) -> pd.Series:
    r = idx / idx.shift(WIN) - 1
    reg = pd.Series("neutral", index=idx.index)
    reg[r >= UP] = "bull"
    reg[r <= DN] = "bear"
    reg[r.isna()] = "na"
    return reg


def regime_map(data: dict) -> dict:
    return {mk: classify(composite_index(data, mk)) for mk in ("kr", "us")}


def periods(reg: pd.Series, min_days: int = 20) -> list:
    """연속 구간 목록 [{regime, start, end, days}] — min_days 미만 구간은 제외(표시용)."""
    out = []
    cur, start = None, None
    for dt, v in reg.items():
        if v != cur:
            if cur is not None:
                out.append({"regime": cur, "start": start, "end": prev, "days": ndays})
            cur, start, ndays = v, dt, 0
        ndays += 1
        prev = dt
    out.append({"regime": cur, "start": start, "end": prev, "days": ndays})
    return [{**p, "start": p["start"].strftime("%Y-%m-%d"), "end": p["end"].strftime("%Y-%m-%d")}
            for p in out if p["regime"] in ("bull", "bear") and p["days"] >= min_days]


if __name__ == "__main__":
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from collect import load_research

    data = load_research()  # 국면 분류 ≥750일 유지
    for mk, reg in regime_map(data).items():
        share = reg.value_counts(normalize=True).round(3).to_dict()
        print(f"[{mk}] 비중: {share}")
        for p in periods(reg):
            print(f"   {p['regime']:7} {p['start']} ~ {p['end']} ({p['days']}일)")

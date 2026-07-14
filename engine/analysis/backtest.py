# -*- coding: utf-8 -*-
"""이벤트 스터디: 전 종목에 후보 원칙을 적용해 신호 발생 후 t+5/20/60 수익률을 수집.

- 같은 종목에서 5영업일 내 중복 신호는 1건으로 (자기상관에 의한 표본 부풀림 방지)
- 베이스라인: 전 종목 '모든 날'의 미래수익 분포 (시장·기간 구분) → 초과수익의 비교 기준
"""
import numpy as np
import pandas as pd

from indicators import add_indicators
from rules import ALL_RULES

HORIZONS = (5, 20, 60)
SPLIT = pd.Timestamp("2021-07-01")  # 전반(2016~2021H1) / 후반(2021H2~) 분할


def _half(idx: pd.DatetimeIndex) -> np.ndarray:
    return np.where(idx < SPLIT, "H1", "H2")


def _dedupe(positions: np.ndarray, gap: int = 5) -> np.ndarray:
    """정수 위치 배열에서 gap 미만 간격의 후속 신호 제거."""
    kept = []
    last = -10**9
    for p in positions:
        if p - last >= gap:
            kept.append(p)
            last = p
    return np.array(kept, dtype=int)


def run(data: dict) -> tuple[pd.DataFrame, pd.DataFrame]:
    """data: {(market, ticker): OHLCV df} → (events, baseline)

    events: rule_id, side, market, ticker, date, half, fwd5, fwd20, fwd60
    baseline: market, half, horizon, n, mean, var  (전 종목 모든 날 풀링)
    """
    ev_rows = []
    base_acc = {}  # (market, half, horizon) -> [n, sum, sumsq]

    for (market, ticker), raw in data.items():
        d = add_indicators(raw)
        for n in HORIZONS:
            d[f"fwd{n}"] = d["close"].shift(-n) / d["close"] - 1

        halves = _half(d.index)
        for n in HORIZONS:
            f = d[f"fwd{n}"].to_numpy()
            for h in ("H1", "H2"):
                x = f[(halves == h) & ~np.isnan(f)]
                if len(x) == 0:
                    continue
                k = (market, h, n)
                acc = base_acc.setdefault(k, [0, 0.0, 0.0])
                acc[0] += len(x)
                acc[1] += x.sum()
                acc[2] += (x**2).sum()

        for rule in ALL_RULES:
            try:
                sig = rule.fn(d).to_numpy()
            except Exception:
                continue
            pos = _dedupe(np.flatnonzero(sig))
            for p in pos:
                fwd = {f"fwd{n}": d[f"fwd{n}"].iloc[p] for n in HORIZONS}
                if all(np.isnan(v) for v in fwd.values()):
                    continue
                ev_rows.append({
                    "rule_id": rule.id, "side": rule.side, "market": market,
                    "ticker": ticker, "date": d.index[p], "half": halves[p], **fwd,
                })

    events = pd.DataFrame(ev_rows)
    base_rows = []
    for (market, h, n), (cnt, s, ss) in base_acc.items():
        mean = s / cnt
        var = ss / cnt - mean**2
        base_rows.append({"market": market, "half": h, "horizon": n,
                          "n": cnt, "mean": mean, "var": var})
    baseline = pd.DataFrame(base_rows)
    return events, baseline

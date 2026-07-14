# -*- coding: utf-8 -*-
"""보조지표 계산 — OHLCV DataFrame에 지표 컬럼을 추가해 반환. 전부 pandas 벡터 연산 직접 구현."""
import numpy as np
import pandas as pd


def add_indicators(df: pd.DataFrame) -> pd.DataFrame:
    d = df.copy()
    c, h, l, v = d["close"], d["high"], d["low"], d["volume"]

    # --- 이동평균 ---
    for n in (5, 20, 60, 120):
        d[f"ma{n}"] = c.rolling(n).mean()
    d["disparity20"] = c / d["ma20"] - 1          # 20일 이격도
    d["disparity60"] = c / d["ma60"] - 1
    d["aligned_up"] = (d["ma5"] > d["ma20"]) & (d["ma20"] > d["ma60"])   # 정배열
    d["aligned_down"] = (d["ma5"] < d["ma20"]) & (d["ma20"] < d["ma60"])  # 역배열
    d["ma20_slope"] = d["ma20"].pct_change(5)     # 20일선 기울기(5일 변화율)

    # --- 볼린저밴드 (20, 2σ) ---
    sd = c.rolling(20).std(ddof=0)
    d["bb_up"] = d["ma20"] + 2 * sd
    d["bb_dn"] = d["ma20"] - 2 * sd
    d["bb_pctb"] = (c - d["bb_dn"]) / (d["bb_up"] - d["bb_dn"])
    d["bb_width"] = (d["bb_up"] - d["bb_dn"]) / d["ma20"]
    d["bb_squeeze"] = d["bb_width"] <= d["bb_width"].rolling(120).quantile(0.15)

    # --- RSI(14) (Wilder) ---
    diff = c.diff()
    gain = diff.clip(lower=0).ewm(alpha=1 / 14, min_periods=14).mean()
    loss = (-diff.clip(upper=0)).ewm(alpha=1 / 14, min_periods=14).mean()
    d["rsi"] = 100 - 100 / (1 + gain / loss.replace(0, np.nan))

    # --- MACD(12,26,9) ---
    ema12 = c.ewm(span=12, min_periods=12).mean()
    ema26 = c.ewm(span=26, min_periods=26).mean()
    d["macd"] = ema12 - ema26
    d["macd_sig"] = d["macd"].ewm(span=9, min_periods=9).mean()
    d["macd_hist"] = d["macd"] - d["macd_sig"]

    # --- 스토캐스틱(14,3) ---
    ll, hh = l.rolling(14).min(), h.rolling(14).max()
    d["stoch_k"] = ((c - ll) / (hh - ll) * 100).rolling(3).mean()

    # --- 거래량 ---
    d["vol_ma20"] = v.rolling(20).mean()
    d["vol_ratio"] = v / d["vol_ma20"]            # 20일 평균 대비 배율
    obv = (np.sign(c.diff()).fillna(0) * v).cumsum()
    d["obv"] = obv
    d["obv_ma20"] = obv.rolling(20).mean()

    # --- 가격 구조 ---
    d["hi52"] = h.rolling(252).max()
    d["lo52"] = l.rolling(252).min()
    d["new_hi52"] = c >= d["hi52"].shift(1)       # 52주 신고가 경신
    d["new_lo52"] = c <= d["lo52"].shift(1)
    d["box_hi60"] = h.shift(1).rolling(60).max()  # 직전 60일 박스 상단
    d["box_lo60"] = l.shift(1).rolling(60).min()
    d["ret1"] = c.pct_change()
    d["ret5"] = c.pct_change(5)
    d["ret20"] = c.pct_change(20)
    d["gap"] = d["open"] / c.shift(1) - 1         # 시가 갭
    rng = (h - l).replace(0, np.nan)
    body = (c - d["open"]) / rng                  # 몸통 비율(양수=양봉)
    d["long_bull"] = (body > 0.6) & ((h - l) / c.shift(1) > 0.03)   # 장대양봉
    d["long_bear"] = (body < -0.6) & ((h - l) / c.shift(1) > 0.03)  # 장대음봉

    return d


def cross_up(a: pd.Series, b: pd.Series) -> pd.Series:
    """a가 b를 상향 돌파한 날."""
    return (a > b) & (a.shift(1) <= b.shift(1))


def cross_dn(a: pd.Series, b: pd.Series) -> pd.Series:
    return (a < b) & (a.shift(1) >= b.shift(1))

# -*- coding: utf-8 -*-
"""후보 원칙(가설) 라이브러리 — 각 원칙은 지표 DataFrame → 신호(불리언 시리즈) 함수.

매수 원칙: 신호 후 주가 '상승'을 기대. 매도 원칙: 신호 후 주가 '하락'(=매도로 회피)을 기대.
"""
from dataclasses import dataclass
from typing import Callable

import pandas as pd

from indicators import cross_dn, cross_up


@dataclass
class Rule:
    id: str
    side: str  # "buy" | "sell"
    name: str
    desc: str
    fn: Callable[[pd.DataFrame], pd.Series]


def _s(x: pd.Series) -> pd.Series:
    return x.fillna(False).astype(bool)


# ============================== 매수 후보 ==============================
BUY = [
    Rule("bb_lower_rsi", "buy", "BB하단+RSI과매도",
         "종가가 볼린저 하단 이하 + RSI<30",
         lambda d: _s((d["close"] <= d["bb_dn"]) & (d["rsi"] < 30))),
    Rule("bb_lower_touch", "buy", "BB하단 터치",
         "종가가 볼린저 하단 이하 (단독)",
         lambda d: _s(d["close"] <= d["bb_dn"])),
    Rule("golden_cross_20_60", "buy", "골든크로스(20·60)",
         "MA20이 MA60을 상향 돌파",
         lambda d: _s(cross_up(d["ma20"], d["ma60"]))),
    Rule("golden_cross_5_20", "buy", "골든크로스(5·20)",
         "MA5가 MA20을 상향 돌파",
         lambda d: _s(cross_up(d["ma5"], d["ma20"]))),
    Rule("vol3_box_break", "buy", "거래량3배+박스돌파",
         "종가가 60일 박스 상단 돌파 + 거래량 20일 평균의 3배",
         lambda d: _s((d["close"] > d["box_hi60"]) & (d["close"].shift(1) <= d["box_hi60"].shift(1))
                      & (d["vol_ratio"] >= 3))),
    Rule("box_break", "buy", "박스 상향돌파",
         "종가가 60일 박스 상단 돌파 (거래량 무관)",
         lambda d: _s((d["close"] > d["box_hi60"]) & (d["close"].shift(1) <= d["box_hi60"].shift(1)))),
    Rule("ma60_support_bounce", "buy", "60일선 지지 반등",
         "저가가 우상향 MA60을 ±2%내 터치 후 양봉 마감",
         lambda d: _s((abs(d["low"] / d["ma60"] - 1) < 0.02) & (d["ma60"].pct_change(5) > 0)
                      & (d["close"] > d["open"]) & (d["close"] > d["ma60"]))),
    Rule("macd_cross_up", "buy", "MACD 상향교차",
         "MACD가 시그널선을 상향 교차",
         lambda d: _s(cross_up(d["macd"], d["macd_sig"]))),
    Rule("macd_cross_up_below0", "buy", "MACD 상향교차(0 이하)",
         "0선 아래에서 MACD가 시그널선 상향 교차 (바닥 전환)",
         lambda d: _s(cross_up(d["macd"], d["macd_sig"]) & (d["macd"] < 0))),
    Rule("new_hi52", "buy", "52주 신고가",
         "종가가 52주 최고가 경신",
         lambda d: _s(d["new_hi52"])),
    Rule("new_hi52_vol", "buy", "52주 신고가+거래량2배",
         "52주 신고가 경신 + 거래량 2배 이상",
         lambda d: _s(d["new_hi52"] & (d["vol_ratio"] >= 2))),
    Rule("capitulation", "buy", "투매 후 반등(낙폭과대+거래량)",
         "20일 수익률 -20% 이하 + 거래량 3배 + 양봉",
         lambda d: _s((d["ret20"] < -0.20) & (d["vol_ratio"] >= 3) & (d["close"] > d["open"]))),
    Rule("aligned_up_first", "buy", "정배열 전환 첫날",
         "MA5>MA20>MA60 정배열이 시작된 날",
         lambda d: _s(d["aligned_up"] & ~d["aligned_up"].shift(1, fill_value=False))),
    Rule("rsi_oversold_exit", "buy", "RSI 30 상향 이탈",
         "RSI가 30을 아래에서 위로 돌파 (과매도 탈출)",
         lambda d: _s(cross_up(d["rsi"], pd.Series(30, index=d.index)))),
    Rule("stoch_oversold_turn", "buy", "스토캐스틱 과매도 반전",
         "스토캐스틱 K<20에서 상승 전환",
         lambda d: _s((d["stoch_k"].shift(1) < 20) & (d["stoch_k"] > d["stoch_k"].shift(1)))),
    Rule("squeeze_break_up", "buy", "스퀴즈 후 상단돌파+거래량",
         "밴드폭 하위 15% 스퀴즈에서 BB 상단 돌파 + 거래량 2배",
         lambda d: _s(d["bb_squeeze"].shift(1, fill_value=False) & (d["close"] > d["bb_up"])
                      & (d["vol_ratio"] >= 2))),
    Rule("long_bull_vol", "buy", "장대양봉+거래량3배",
         "몸통 60%+ 장대양봉 + 거래량 3배",
         lambda d: _s(d["long_bull"] & (d["vol_ratio"] >= 3))),
    Rule("gap_up_vol", "buy", "갭상승+거래량",
         "시가 갭 +3% 이상 + 거래량 2배 + 양봉 마감",
         lambda d: _s((d["gap"] > 0.03) & (d["vol_ratio"] >= 2) & (d["close"] >= d["open"]))),
    Rule("disparity_low", "buy", "이격도 과대낙폭",
         "20일선 이격도 -15% 이하",
         lambda d: _s(d["disparity20"] < -0.15)),
    Rule("obv_breakout", "buy", "OBV 돌파(수급 선행)",
         "OBV가 OBV 20일선 상향 돌파 + 주가는 MA20 위",
         lambda d: _s(cross_up(d["obv"], d["obv_ma20"]) & (d["close"] > d["ma20"]))),
    Rule("pullback_ma20", "buy", "정배열 눌림목(20일선)",
         "정배열 유지 중 저가가 MA20 터치(±1.5%) 후 양봉",
         lambda d: _s(d["aligned_up"] & (abs(d["low"] / d["ma20"] - 1) < 0.015)
                      & (d["close"] > d["open"]))),
]

# ============================== 매도 후보 ==============================
SELL = [
    Rule("ma60_break_dn", "sell", "60일선 하향돌파",
         "종가가 MA60을 하향 돌파",
         lambda d: _s(cross_dn(d["close"], d["ma60"]))),
    Rule("ma120_break_dn", "sell", "120일선 하향돌파",
         "종가가 MA120을 하향 돌파 (장기추세 이탈)",
         lambda d: _s(cross_dn(d["close"], d["ma120"]))),
    Rule("bb_upper_rsi", "sell", "BB상단+RSI과열",
         "종가가 볼린저 상단 이상 + RSI>70",
         lambda d: _s((d["close"] >= d["bb_up"]) & (d["rsi"] > 70))),
    Rule("bb_upper_touch", "sell", "BB상단 터치",
         "종가가 볼린저 상단 이상 (단독)",
         lambda d: _s(d["close"] >= d["bb_up"])),
    Rule("dead_cross_20_60", "sell", "데드크로스(20·60)",
         "MA20이 MA60을 하향 돌파",
         lambda d: _s(cross_dn(d["ma20"], d["ma60"]))),
    Rule("dead_cross_5_20", "sell", "데드크로스(5·20)",
         "MA5가 MA20을 하향 돌파",
         lambda d: _s(cross_dn(d["ma5"], d["ma20"]))),
    Rule("long_bear_vol", "sell", "장대음봉+거래량3배",
         "몸통 60%+ 장대음봉 + 거래량 3배 (세력 이탈)",
         lambda d: _s(d["long_bear"] & (d["vol_ratio"] >= 3))),
    Rule("gap_dn_ma20", "sell", "갭하락+20일선 이탈",
         "시가 갭 -3% 이하 + 종가 MA20 아래",
         lambda d: _s((d["gap"] < -0.03) & (d["close"] < d["ma20"]))),
    Rule("hi52_obv_fade", "sell", "신고가 후 수급이탈",
         "최근 20일 내 52주 신고가였으나 OBV가 OBV 20일선 하향 돌파",
         lambda d: _s(d["new_hi52"].rolling(20).max().astype(bool)
                      & cross_dn(d["obv"], d["obv_ma20"]))),
    Rule("rsi_overbought_exit", "sell", "RSI 70 하향 이탈",
         "RSI가 70을 위에서 아래로 이탈 (과열 꺾임)",
         lambda d: _s(cross_dn(d["rsi"], pd.Series(70, index=d.index)))),
    Rule("macd_cross_dn", "sell", "MACD 하향교차",
         "MACD가 시그널선을 하향 교차",
         lambda d: _s(cross_dn(d["macd"], d["macd_sig"]))),
    Rule("macd_cross_dn_above0", "sell", "MACD 하향교차(0 이상)",
         "0선 위에서 MACD가 시그널선 하향 교차 (고점 전환)",
         lambda d: _s(cross_dn(d["macd"], d["macd_sig"]) & (d["macd"] > 0))),
    Rule("ma20_break_dn_vol", "sell", "20일선 이탈+거래량2배",
         "종가가 MA20 하향 돌파 + 거래량 2배",
         lambda d: _s(cross_dn(d["close"], d["ma20"]) & (d["vol_ratio"] >= 2))),
    Rule("aligned_down_first", "sell", "역배열 전환 첫날",
         "MA5<MA20<MA60 역배열이 시작된 날",
         lambda d: _s(d["aligned_down"] & ~d["aligned_down"].shift(1, fill_value=False))),
    Rule("stoch_overbought_turn", "sell", "스토캐스틱 과열 반전",
         "스토캐스틱 K>80에서 하락 전환",
         lambda d: _s((d["stoch_k"].shift(1) > 80) & (d["stoch_k"] < d["stoch_k"].shift(1)))),
    Rule("disparity_high", "sell", "이격도 과열",
         "20일선 이격도 +15% 이상",
         lambda d: _s(d["disparity20"] > 0.15)),
    Rule("box_break_dn", "sell", "박스 하향이탈",
         "종가가 60일 박스 하단 이탈",
         lambda d: _s((d["close"] < d["box_lo60"]) & (d["close"].shift(1) >= d["box_lo60"].shift(1)))),
    Rule("box_break_dn_vol", "sell", "박스 하향이탈+거래량2배",
         "60일 박스 하단 이탈 + 거래량 2배",
         lambda d: _s((d["close"] < d["box_lo60"]) & (d["close"].shift(1) >= d["box_lo60"].shift(1))
                      & (d["vol_ratio"] >= 2))),
    Rule("bear_after_rally", "sell", "급등 후 장대음봉",
         "20일 수익률 +20% 이상 상태에서 장대음봉",
         lambda d: _s((d["ret20"] > 0.20) & d["long_bear"])),
    Rule("new_lo52", "sell", "52주 신저가",
         "종가가 52주 최저가 경신",
         lambda d: _s(d["new_lo52"])),
]

ALL_RULES = BUY + SELL

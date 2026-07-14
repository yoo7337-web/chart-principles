# -*- coding: utf-8 -*-
"""강건성 검증 & 최종 원칙 선별.

edge(우위) 정의: 매수원칙 = 신호 후 수익률 - 베이스라인 / 매도원칙 = 베이스라인 - 신호 후 수익률.
(매도원칙은 '팔았더니 그 뒤 시장 평균보다 더 빠졌다'가 성공)

생존 조건(전부 통과):
  1) 표본 ≥ 300건   2) 전·후반기 모두 edge>0   3) 한·미 모두 edge>0 (아니면 단일시장 표기)
  4) t-검정 p < 0.01 (기준 지평 t+20)
→ 생존 원칙을 score = edge20 × 승률 로 정렬, 매수/매도 각 상위 5개 채택.
"""
import numpy as np
import pandas as pd
from scipy import stats as sps

from rules import ALL_RULES

PRIMARY = 20
MIN_N = 300
P_CUT = 0.01
TOP_K = 5


def evaluate(events: pd.DataFrame, baseline: pd.DataFrame) -> pd.DataFrame:
    base_mean = {(r.market, r.half, r.horizon): r.mean for r in baseline.itertuples()}
    rows = []
    for rule in ALL_RULES:
        ev = events[events["rule_id"] == rule.id].copy()
        if ev.empty:
            continue
        sign = 1.0 if rule.side == "buy" else -1.0
        for n in (5, 20, 60):
            bm = ev.apply(lambda r: base_mean.get((r["market"], r["half"], n), np.nan), axis=1)
            ev[f"edge{n}"] = sign * (ev[f"fwd{n}"] - bm)

        e = ev.dropna(subset=[f"edge{PRIMARY}"])
        if len(e) < 30:
            continue
        x = e[f"edge{PRIMARY}"]
        t, p = sps.ttest_1samp(x, 0.0, alternative="greater")
        win = float((x > 0).mean())

        def bucket(mask):
            v = e.loc[mask, f"edge{PRIMARY}"]
            return float(v.mean()) if len(v) >= 30 else np.nan

        eh1, eh2 = bucket(e["half"] == "H1"), bucket(e["half"] == "H2")
        ekr, eus = bucket(e["market"] == "kr"), bucket(e["market"] == "us")

        both_halves = bool(eh1 > 0 and eh2 > 0) if not (np.isnan(eh1) or np.isnan(eh2)) else False
        kr_ok = (not np.isnan(ekr)) and ekr > 0
        us_ok = (not np.isnan(eus)) and eus > 0
        both_markets = kr_ok and us_ok
        single_market = "kr" if (kr_ok and not us_ok) else ("us" if (us_ok and not kr_ok) else "")

        passed = (len(e) >= MIN_N) and both_halves and both_markets and (p < P_CUT)
        rows.append({
            "rule_id": rule.id, "side": rule.side, "name": rule.name, "desc": rule.desc,
            "n": int(len(e)), "win_rate": win,
            "edge5": float(e["edge5"].mean()), "edge20": float(x.mean()),
            "edge60": float(e["edge60"].mean()),
            "p20": float(p), "edge_h1": eh1, "edge_h2": eh2,
            "edge_kr": ekr, "edge_us": eus,
            "pass_n": len(e) >= MIN_N, "pass_halves": both_halves,
            "pass_markets": both_markets, "pass_p": bool(p < P_CUT),
            "single_market": single_market, "passed": passed,
            "score": float(x.mean()) * win,
        })

    res = pd.DataFrame(rows)
    res["selected"] = False
    for side in ("buy", "sell"):
        top = res[(res["side"] == side) & res["passed"]].nlargest(TOP_K, "score").index
        res.loc[top, "selected"] = True
    return res.sort_values(["side", "score"], ascending=[True, False]).reset_index(drop=True)

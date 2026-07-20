# -*- coding: utf-8 -*-
r"""국면별(급등장/일반장/하락장) 원칙 재검증.

- 41개 후보 원칙 전체를 국면별로 이벤트 스터디 (edge는 '같은 시장·같은 국면' 베이스라인 대비)
- 기존 일반 원칙 10개의 국면별 프로파일 → 전천후/국면의존 재분류
- 급등장 전용 / 하락장 전용 원칙 top3(매수·매도 각) 선별
  생존 조건(국면판): 표본≥150 · p<0.01 · 한/미 방향 일치(각 시장 표본≥30일 때, 아니면 단일시장 표기)

사용법: python analysis\regime_report.py   (선행: report.py)
출력: app\data\regimes.json (웹 '국면별 원칙' 탭 데이터)
"""
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats as sps

sys.path.insert(0, str(Path(__file__).resolve().parent))

import backtest
from collect import load_all, load_research
from regimes import DN, UP, WIN, periods, regime_map
from rules import ALL_RULES

ROOT = Path(__file__).resolve().parent.parent
MIN_N, P_CUT, TOP_K = 150, 0.01, 3
REGIMES = ("bull", "neutral", "bear")


def regime_baselines(data: dict, reg: dict) -> dict:
    """(market, regime) → 전 종목 모든 날 fwd20 평균."""
    acc = {}
    for (mk, tk), df in data.items():
        f = (df["close"].shift(-20) / df["close"] - 1).dropna()
        r = reg[mk].reindex(f.index)
        for rg in REGIMES:
            x = f[r == rg]
            if len(x) == 0:
                continue
            a = acc.setdefault((mk, rg), [0, 0.0])
            a[0] += len(x)
            a[1] += x.sum()
    return {k: v[1] / v[0] for k, v in acc.items()}


def evaluate_regime(events: pd.DataFrame, base: dict) -> pd.DataFrame:
    rows = []
    for rule in ALL_RULES:
        ev_all = events[events["rule_id"] == rule.id]
        sign = 1.0 if rule.side == "buy" else -1.0
        for rg in REGIMES:
            ev = ev_all[ev_all["regime"] == rg].dropna(subset=["fwd20"]).copy()
            if len(ev) < 30:
                continue
            bm = ev.apply(lambda r: base.get((r["market"], rg), np.nan), axis=1)
            ev["edge"] = sign * (ev["fwd20"] - bm)
            x = ev["edge"].dropna()
            if len(x) < 30:
                continue
            t, p = sps.ttest_1samp(x, 0.0, alternative="greater")
            win = float((x > 0).mean())

            def mstat(mk):
                v = ev.loc[ev["market"] == mk, "edge"].dropna()
                return (float(v.mean()) if len(v) >= 30 else np.nan, int(len(v)))

            ekr, nkr = mstat("kr")
            eus, nus = mstat("us")
            kr_ok, us_ok = (not np.isnan(ekr)) and ekr > 0, (not np.isnan(eus)) and eus > 0
            if not np.isnan(ekr) and not np.isnan(eus):
                markets_ok, single = kr_ok and us_ok, ""
            else:  # 한쪽 표본 부족 → 단일시장 판정 허용하되 표기
                markets_ok = kr_ok or us_ok
                single = "kr" if not np.isnan(ekr) else ("us" if not np.isnan(eus) else "")
            passed = (len(x) >= MIN_N) and markets_ok and (p < P_CUT)
            rows.append({
                "rule_id": rule.id, "side": rule.side, "name": rule.name, "desc": rule.desc,
                "regime": rg, "n": int(len(x)), "win_rate": win, "edge20": float(x.mean()),
                "p20": float(p), "edge_kr": None if np.isnan(ekr) else ekr,
                "edge_us": None if np.isnan(eus) else eus, "n_kr": nkr, "n_us": nus,
                "single_market": single, "passed": bool(passed),
                "score": float(x.mean()) * win,
            })
    return pd.DataFrame(rows)


def pct(x, d=2):
    return "-" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{x*100:+.{d}f}%"


def main():
    print("[1/4] 데이터 로드 & 레짐 분류...")
    data = load_research()  # 국면 리포트 ≥750일 유지
    reg = regime_map(data)
    shares = {mk: reg[mk].value_counts(normalize=True).round(3).to_dict() for mk in reg}
    print(f"  국면 비중: {shares}")

    print("[2/4] 이벤트 스터디 (전 원칙)...")
    events, _ = backtest.run(data)
    events["regime"] = [reg[mk].get(dt, "na") for mk, dt in zip(events["market"], events["date"])]
    base = regime_baselines(data, reg)
    print(f"  이벤트 {len(events):,}건 · 국면 베이스라인: "
          + ", ".join(f"{k[0]}/{k[1]} {v*100:+.2f}%" for k, v in sorted(base.items())))

    print("[3/4] 국면별 평가...")
    res = evaluate_regime(events, base)

    # 국면별 top 선별 (급등장/하락장 × 매수/매도)
    picks = {}
    for rg in ("bull", "bear"):
        for side in ("buy", "sell"):
            sub = res[(res["regime"] == rg) & (res["side"] == side) & res["passed"]]
            picks[f"{rg}_{side}"] = sub.nlargest(TOP_K, "score")["rule_id"].tolist()

    # 기존 일반 원칙 10개의 국면별 프로파일 + 재분류
    results = json.loads((ROOT / "app" / "data" / "results.json").read_text(encoding="utf-8"))
    general = [r for r in results["rules"] if r["selected"]]
    profile = []
    for g in general:
        e = {rg: None for rg in REGIMES}
        w = {rg: None for rg in REGIMES}
        for rg in REGIMES:
            row = res[(res["rule_id"] == g["rule_id"]) & (res["regime"] == rg)]
            if not row.empty:
                e[rg] = float(row.iloc[0]["edge20"])
                w[rg] = float(row.iloc[0]["win_rate"])
        vals = [v for v in e.values() if v is not None]
        if all(v > 0 for v in vals) and len(vals) == 3:
            verdict = "전천후"
        elif e["bull"] is not None and e["bull"] <= 0:
            verdict = "일반·하락장용 (급등장 회피)"
        elif e["bear"] is not None and e["bear"] <= 0:
            verdict = "일반·급등장용 (하락장 회피)"
        else:
            verdict = "일반장 중심"
        profile.append({
            "rule_id": g["rule_id"], "side": g["side"], "name": g["name"], "desc": g["desc"],
            "overall_edge": g["edge20"],
            "edge_bull": e["bull"], "edge_neutral": e["neutral"], "edge_bear": e["bear"],
            "win_bull": w["bull"], "win_neutral": w["neutral"], "win_bear": w["bear"],
            "verdict": verdict,
        })

    print("[4/4] 저장...")
    payload = {
        "generated": date.today().isoformat(),
        "def": {"window": WIN, "up": UP, "dn": DN,
                "text": f"시장별 동일가중 지수의 직전 {WIN}영업일 수익률 ≥ +{UP*100:.0f}% → 급등장, "
                        f"≤ {DN*100:.0f}% → 하락장, 그 외 일반장 (선견편향 없음)"},
        "shares": shares,
        "timeline": {mk: periods(reg[mk]) for mk in reg},
        "baselines": {f"{k[0]}_{k[1]}": v for k, v in base.items()},
        "criteria": f"국면판 생존 조건: 표본≥{MIN_N} · p<{P_CUT} · 한/미 방향 일치(표본≥30 시장 기준)",
        "table": res.replace({np.nan: None}).to_dict(orient="records"),
        "picks": picks,
        "general_profile": profile,
    }
    (ROOT / "app" / "data" / "regimes.json").write_text(
        json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    # 콘솔 요약
    name_of = {r.id: r.name for r in ALL_RULES}
    for k, ids in picks.items():
        print(f"  {k}: " + (", ".join(name_of[i] for i in ids) or "(생존 없음)"))
    for p in profile:
        print(f"  [일반] {p['name']}: bull {pct(p['edge_bull'])} / neutral {pct(p['edge_neutral'])}"
              f" / bear {pct(p['edge_bear'])} → {p['verdict']}")
    print("완료: app\\data\\regimes.json")


if __name__ == "__main__":
    main()

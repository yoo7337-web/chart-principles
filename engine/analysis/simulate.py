# -*- coding: utf-8 -*-
r"""전략 시뮬레이션: 원칙대로 10년 기계 매매 시 누적수익 곡선 → app\data\strategy.json

방법론(단순·정직):
- 매수원칙 신호일 종가 매수 → 20영업일 후 종가 매도 (노출 = 신호 다음날부터 20일간의 일수익률)
- 동시 보유 동일가중, 포지션 없으면 현금(수익 0)
- 거래비용 왕복 0.5% → 보유일당 0.025%p 차감 근사
- 곡선: 매수원칙별 / 통합 / 통합+국면필터 / 통합+매도신호 조기청산 / 벤치마크(동일가중 보유)
한계: 종가 체결 가정, 환율 무시(수익률만), 생존 편향 유니버스.

사용법: python analysis\simulate.py   (선행: report.py, regime_report.py)
"""
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from collect import load_all
from common import APP_DATA, dedupe_positions, is_active, load_ruleset
from indicators import add_indicators
from regimes import regime_map

H = 20
COST_PER_DAY = 0.005 / H  # 왕복 0.5% 근사


def nav_stats(nav: pd.Series, n_trades: int, wins: int) -> dict:
    years = len(nav) / 252
    cagr = float(nav.iloc[-1] ** (1 / years) - 1) if years > 0 else 0.0
    mdd = float((nav / nav.cummax() - 1).min())
    return {"final": round(float(nav.iloc[-1]), 3), "cagr": round(cagr, 4),
            "mdd": round(mdd, 4), "trades": n_trades,
            "win_rate": round(wins / n_trades, 3) if n_trades else None}


def curve_points(nav: pd.Series) -> list:
    m = nav.resample("ME").last().dropna()
    return [{"t": ts.strftime("%Y-%m-%d"), "v": round(float(v), 4)} for ts, v in m.items()]


def main():
    ruleset = load_ruleset()
    buy_ids = [rid for rid, e in ruleset.items() if e["rule"].side == "buy" and e["scope"] == "general"]
    sell_ids = [rid for rid, e in ruleset.items() if e["rule"].side == "sell" and e["scope"] == "general"]

    data = load_all()
    keys = sorted(data)
    print(f"[1/3] 신호·수익률 준비 ({len(keys)}종목)...")

    R = pd.DataFrame({f"{m}_{t}": data[(m, t)]["close"].pct_change() for m, t in keys}).sort_index()
    dates = R.index
    Rv = R.to_numpy()  # (T, S) NaN 포함
    reg = regime_map(data)

    # 종목별 신호 수집: trades[rule_id] = [(stock_col, entry_local→global 노출 구간, fwd20, regime_at_entry, sell_exit_day)]
    trades = {rid: [] for rid in buy_ids}
    for col, (mk, tk) in enumerate(keys):
        d = add_indicators(data[(mk, tk)])
        gidx = dates.get_indexer(d.index)  # 로컬→글로벌 행 매핑
        fwd = (d["close"].shift(-H) / d["close"] - 1).to_numpy()
        rmk = reg[mk].reindex(d.index).fillna("na").to_numpy()

        sell_mask = np.zeros(len(d), dtype=bool)
        for rid in sell_ids:
            try:
                sell_mask |= ruleset[rid]["rule"].fn(d).to_numpy()
            except Exception:
                pass

        for rid in buy_ids:
            try:
                sig = ruleset[rid]["rule"].fn(d).to_numpy()
            except Exception:
                continue
            for p in dedupe_positions(sig):
                lo, hi = p + 1, min(p + H, len(d) - 1)  # 노출: 신호 다음날 ~ +20일
                if lo > hi:
                    continue
                # 매도신호 조기청산일 (노출 구간 내 첫 매도신호, 그날 수익까지 포함)
                exit_early = next((q for q in range(lo, hi + 1) if sell_mask[q]), None)
                trades[rid].append({
                    "col": col, "g_lo": int(gidx[lo]), "g_hi": int(gidx[hi]),
                    "g_exit": int(gidx[exit_early]) if exit_early is not None else None,
                    "fwd": None if np.isnan(fwd[p]) else float(fwd[p]),
                    "regime": str(rmk[p]),
                })

    print(f"[2/3] 곡선 계산...")

    def run_nav(trade_list, regime_filter=False, sell_exit=False):
        cnt = np.zeros((len(dates), len(R.columns)), dtype=np.int16)
        used, wins = 0, 0
        for t in trade_list:
            if regime_filter:
                rid = t["_rid"]
                if not is_active(ruleset[rid], t["regime"]):
                    continue
            hi = t["g_exit"] if (sell_exit and t["g_exit"] is not None) else t["g_hi"]
            cnt[t["g_lo"]:hi + 1, t["col"]] += 1
            used += 1
            if t["fwd"] is not None:
                wins += t["fwd"] > 0
        w = cnt.astype(np.float64)
        tot = w.sum(axis=1)
        ret = np.zeros(len(dates))
        act = tot > 0
        contrib = np.where(np.isnan(Rv), 0.0, Rv) * w
        ret[act] = contrib[act].sum(axis=1) / tot[act] - COST_PER_DAY
        return pd.Series(1 + ret, index=dates).cumprod(), used, wins

    curves = []
    for rid in buy_ids:
        for t in trades[rid]:
            t["_rid"] = rid
        nav, n, wins = run_nav(trades[rid])
        curves.append({"id": rid, "name": ruleset[rid]["rule"].name, "kind": "rule",
                       "points": curve_points(nav), "stats": nav_stats(nav, n, wins)})

    all_trades = [t for rid in buy_ids for t in trades[rid]]
    for name, kid, kw in (("매수원칙 통합", "combo", {}),
                          ("통합+국면필터", "combo_regime", {"regime_filter": True}),
                          ("통합+매도신호 청산", "combo_sellexit", {"sell_exit": True})):
        nav, n, wins = run_nav(all_trades, **kw)
        curves.append({"id": kid, "name": name, "kind": "combo",
                       "points": curve_points(nav), "stats": nav_stats(nav, n, wins)})

    bench_ret = np.nanmean(Rv, axis=1)
    bench = pd.Series(1 + np.nan_to_num(bench_ret), index=dates).cumprod()
    curves.append({"id": "bench", "name": "벤치마크(동일가중 보유)", "kind": "bench",
                   "points": curve_points(bench), "stats": nav_stats(bench, 0, 0)})

    print(f"[3/3] 저장...")
    payload = {
        "generated": date.today().isoformat(),
        "method": f"신호일 종가 매수→{H}영업일 후 종가 매도, 동일가중, 왕복 비용 0.5%, "
                  "포지션 없으면 현금. 종가 체결 가정·환율 무시·생존 편향 유니버스(한계).",
        "curves": curves,
    }
    (APP_DATA / "strategy.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    for c in curves:
        s = c["stats"]
        print(f"  {c['name']:24} 최종 {s['final']:8.2f}x CAGR {s['cagr']*100:+6.2f}% "
              f"MDD {s['mdd']*100:6.1f}% 거래 {s['trades']:,}")
    print("완료: app\\data\\strategy.json")


if __name__ == "__main__":
    main()

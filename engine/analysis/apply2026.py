# -*- coding: utf-8 -*-
r"""2026년(1월~현재) 적용 검증: 최종 선정 원칙이 최근 거래대금 상위 한/미 종목에서
실제로 어떻게 작동했는지 신호별로 추적 → app\data\apply2026.json

사용법: python analysis\apply2026.py   (선행: report.py로 results.json 생성)
"""
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from collect import load_all
from indicators import add_indicators
from rules import ALL_RULES

ROOT = Path(__file__).resolve().parent.parent
START = pd.Timestamp("2026-01-01")
H = 20          # 판정 지평(영업일)
TOP_N = 10      # 시장별 거래대금 상위 종목 수


def main():
    results = json.loads((ROOT / "app" / "data" / "results.json").read_text(encoding="utf-8"))
    sel_ids = {r["rule_id"] for r in results["rules"] if r["selected"]}
    rules = [r for r in ALL_RULES if r.id in sel_ids]
    hist = {r["rule_id"]: r for r in results["rules"]}
    kr_names = results.get("kr_names", {})

    data = load_all()

    # --- 대상 선정: 2026년 평균 거래대금 상위 TOP_N (시장별) ---
    liq = {}
    for key, df in data.items():
        w = df[df.index >= START]
        if len(w) < 60:
            continue
        liq[key] = float((w["close"] * w["volume"]).mean())
    picks = []
    for mk in ("kr", "us"):
        keys = sorted((k for k in liq if k[0] == mk), key=liq.get, reverse=True)
        picks += keys[:TOP_N]

    # --- 2026 시장 컨텍스트: 전 종목 기준 20일 수익률 베이스라인 + 동일가중 YTD ---
    base26, ctx = {}, {}
    for mk in ("kr", "us"):
        fwd_all, ytds = [], []
        for (m, t), df in data.items():
            if m != mk:
                continue
            f = (df["close"].shift(-H) / df["close"] - 1)
            fwd_all.append(f[f.index >= START].dropna())
            w = df[df.index >= START]
            if len(w) > 1:
                ytds.append(w["close"].iloc[-1] / w["close"].iloc[0] - 1)
        allf = pd.concat(fwd_all)
        base26[mk] = float(allf.mean())
        ctx[mk] = {"base20": base26[mk], "ew_ytd": float(np.mean(ytds)),
                   "fwd20_std": float(allf.std()), "n_stocks": len(ytds)}

    # --- 종목별 신호 추적 ---
    stocks, per_rule = [], {r.id: [] for r in rules}
    last_date = None
    for (mk, tk) in picks:
        d = add_indicators(data[(mk, tk)])
        fwd = d["close"].shift(-H) / d["close"] - 1
        last_close = float(d["close"].iloc[-1])
        last_date = max(last_date or d.index[-1], d.index[-1])
        w26 = d[d.index >= START]
        sigs = []
        for rule in rules:
            s = rule.fn(d).to_numpy()
            pos_all = np.flatnonzero(s & (d.index >= START))
            kept, lastp = [], -10**9
            for p in pos_all:
                if p - lastp >= 5:
                    kept.append(p)
                    lastp = p
            for p in kept:
                f = fwd.iloc[p]
                done = not np.isnan(f)
                ret = float(f) if done else last_close / float(d["close"].iloc[p]) - 1
                sign = 1 if rule.side == "buy" else -1
                rec = {
                    "rule_id": rule.id, "side": rule.side,
                    "date": d.index[p].strftime("%Y-%m-%d"),
                    "price": round(float(d["close"].iloc[p]), 2),
                    "ret": round(ret, 4), "done": done,
                    "edge": round(sign * (ret - base26[mk]), 4) if done else None,
                    "success": bool(ret > 0 if rule.side == "buy" else ret < 0) if done else None,
                }
                sigs.append(rec)
                per_rule[rule.id].append({**rec, "market": mk, "ticker": tk})
        # 차트용 시계열: 2025-12부터(맥락 확보) 현재까지 캔들 + 20일선
        wchart = d[d.index >= (START - pd.Timedelta(days=45))]
        series = [{
            "t": ts.strftime("%Y-%m-%d"),
            "o": round(float(x.open), 2), "h": round(float(x.high), 2),
            "l": round(float(x.low), 2), "c": round(float(x.close), 2),
            "v": float(x.volume),
            "ma20": None if np.isnan(x.ma20) else round(float(x.ma20), 2),
        } for ts, x in zip(wchart.index, wchart.itertuples())]
        stocks.append({
            "market": mk, "ticker": tk,
            "name": kr_names.get(tk, tk) if mk == "kr" else tk,
            "ytd": round(float(w26["close"].iloc[-1] / w26["close"].iloc[0] - 1), 4),
            "avg_trading_value": liq[(mk, tk)],
            "signals": sorted(sigs, key=lambda x: x["date"]),
            "series": series,
        })

    # --- 원칙별 2026 성적 요약 ---
    rule_summary = []
    for rule in rules:
        recs = per_rule[rule.id]
        donev = [r for r in recs if r["done"]]
        hits = sum(1 for r in donev if r["success"])
        edges = [r["edge"] for r in donev]
        avg_edge = float(np.mean(edges)) if edges else None
        avg_ret = float(np.mean([r["ret"] for r in donev])) if donev else None
        hit_rate = hits / len(donev) if donev else None
        if not recs:
            verdict = "신호 없음"
        elif not donev:
            verdict = "진행중"
        elif avg_edge > 0 and hit_rate >= 0.5:
            verdict = "적용됨"
        elif avg_edge > 0:
            verdict = "부분 적용"
        else:
            verdict = "적용 안됨"
        rule_summary.append({
            "rule_id": rule.id, "side": rule.side,
            "name": hist[rule.id]["name"], "desc": hist[rule.id]["desc"],
            "n": len(recs), "n_done": len(donev), "hits": hits,
            "hit_rate": hit_rate, "avg_ret": avg_ret, "avg_edge": avg_edge,
            "hist_edge20": hist[rule.id]["edge20"], "hist_win": hist[rule.id]["win_rate"],
            "verdict": verdict,
        })

    payload = {
        "generated": date.today().isoformat(),
        "period": f"2026-01-02 ~ {last_date.strftime('%Y-%m-%d')}",
        "horizon": H,
        "context": ctx,
        "rules": rule_summary,
        "stocks": stocks,
    }
    out = ROOT / "app" / "data" / "apply2026.json"
    out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(f"대상 {len(stocks)}종목 / 신호 {sum(len(s['signals']) for s in stocks)}건")
    for r in rule_summary:
        hr = f"{r['hit_rate']*100:.0f}%" if r["hit_rate"] is not None else "-"
        ae = f"{r['avg_edge']*100:+.2f}%" if r["avg_edge"] is not None else "-"
        print(f"  [{r['side']}] {r['name']}: 신호 {r['n']} (판정완료 {r['n_done']}) "
              f"적중 {hr} edge {ae} → {r['verdict']}")
    print(f"완료: {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

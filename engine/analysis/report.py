# -*- coding: utf-8 -*-
"""전체 파이프라인 실행: 데이터 로드 → 백테스트 → 검증 → report.md + app/data/results.json 생성.

사용법: python analysis\report.py
"""
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

import backtest
import validate
from collect import load_all
from indicators import add_indicators

ROOT = Path(__file__).resolve().parent.parent
OVERUSED = {("kr", "005930"), ("kr", "000660"), ("us", "AAPL")}  # 사례 다양성 위해 제외
WIN_BEFORE, WIN_AFTER = 90, 60  # 사례 차트 윈도우(영업일)
N_EXAMPLES = 5  # 원칙당 사례 수(한/미 섞어서)


def pct(x, digits=2):
    return "-" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{x*100:+.{digits}f}%"


def liquid_set(data: dict, top_n: int = 50) -> set:
    """시장별 최근 120영업일 평균 거래대금 상위 top_n 종목 집합."""
    liq = {k: float((df["close"] * df["volume"]).tail(120).mean()) for k, df in data.items()}
    out = set()
    for mk in ("kr", "us"):
        keys = sorted((k for k in liq if k[0] == mk), key=liq.get, reverse=True)
        out.update(keys[:top_n])
    return out


def build_examples(res: pd.DataFrame, events: pd.DataFrame, data: dict) -> dict:
    """선정 원칙별 대표 사례 — 거래대금 상위 종목에서 한/미 섞어 다양하게 추출."""
    out = {}
    cache = {}
    liquid = liquid_set(data)
    for r in res[res["selected"]].itertuples():
        ev = events[events["rule_id"] == r.rule_id].dropna(subset=["fwd20"]).copy()
        keys = list(zip(ev["market"], ev["ticker"]))
        ev = ev[[k in liquid and k not in OVERUSED for k in keys]]
        sign = 1 if r.side == "buy" else -1
        ev["good"] = sign * ev["fwd20"]
        # 시장별로 잘 맞은 순 정렬 후 종목 중복 없이 kr/us 교차 선발
        picks, used = [], set()
        ranked = {mk: ev[ev["market"] == mk].sort_values("good", ascending=False)
                  for mk in ("kr", "us")}
        idx = {"kr": 0, "us": 0}
        order = ["kr", "us", "kr", "us", "kr"]
        for mk in order:
            sub = ranked[mk]
            while idx[mk] < len(sub):
                row = sub.iloc[idx[mk]]
                idx[mk] += 1
                key = (row["market"], row["ticker"])
                if key not in used:
                    picks.append(row)
                    used.add(key)
                    break
            if len(picks) >= N_EXAMPLES:
                break

        ex_list = []
        for row in picks:
            key = (row["market"], row["ticker"])
            if key not in cache:
                cache[key] = add_indicators(data[key])
            d = cache[key]
            try:
                pos = d.index.get_loc(row["date"])
            except KeyError:
                continue
            lo, hi = max(0, pos - WIN_BEFORE), min(len(d), pos + WIN_AFTER)
            w = d.iloc[lo:hi]

            def fv(v, nd=4):
                return None if v is None or (isinstance(v, float) and np.isnan(v)) else round(float(v), nd)

            series = [{
                "t": ts.strftime("%Y-%m-%d"),
                "o": fv(x.open), "h": fv(x.high), "l": fv(x.low), "c": fv(x.close),
                "v": float(x.volume),
                "ma20": fv(x.ma20), "ma60": fv(x.ma60),
                "bbu": fv(x.bb_up), "bbd": fv(x.bb_dn),
                # 원칙별 보조지표 패널용
                "rsi": fv(x.rsi, 2), "macd": fv(x.macd), "macds": fv(x.macd_sig),
                "disp": fv(x.disparity20), "obv": fv(x.obv, 0), "obvm": fv(x.obv_ma20, 0),
                "stoch": fv(x.stoch_k, 2),
            } for ts, x in zip(w.index, w.itertuples())]
            ex_list.append({
                "market": row["market"], "ticker": row["ticker"],
                "date": row["date"].strftime("%Y-%m-%d"),
                "fwd20": None if np.isnan(row["fwd20"]) else round(float(row["fwd20"]), 4),
                "series": series,
            })
        out[r.rule_id] = ex_list
    return out


def write_report(res: pd.DataFrame, n_kr: int, n_us: int, n_events: int):
    lines = [
        "# 차트 원칙 귀납 검증 리포트",
        f"\n> 생성일 {date.today().isoformat()} · 대상 한국 {n_kr}종목 + 미국 {n_us}종목 · 2016~2026 일봉 · "
        f"신호 표본 총 {n_events:,}건",
        "\n**edge(우위)** = 신호 후 20영업일 수익률이 같은 시장·기간의 '아무 날' 평균 대비 얼마나 유리했는가. "
        "매도원칙은 '팔았더니 평균보다 더 빠졌다'가 성공.",
        "\n**생존 조건**: 표본≥300 · 전/후반기 모두 우위 · 한/미 모두 우위 · p<0.01 — 전부 통과한 것 중 "
        "score(edge×승률) 상위만 채택.\n",
    ]
    for side, title in (("buy", "🟢 최종 매수 원칙"), ("sell", "🔴 최종 매도 원칙")):
        lines.append(f"\n## {title}\n")
        sel = res[(res["side"] == side) & res["selected"]]
        if sel.empty:
            lines.append("_생존 조건을 전부 통과한 원칙 없음._\n")
        for i, r in enumerate(sel.itertuples(), 1):
            lines += [
                f"### {i}. {r.name}",
                f"- **조건**: {r.desc}",
                f"- **우위(edge)**: t+5 {pct(r.edge5)} / t+20 **{pct(r.edge20)}** / t+60 {pct(r.edge60)}",
                f"- **승률(베이스라인 대비)**: {r.win_rate*100:.1f}% · 표본 {r.n:,}건 · p={r.p20:.2e}",
                f"- **강건성**: 전반기 {pct(r.edge_h1)} · 후반기 {pct(r.edge_h2)} · "
                f"한국 {pct(r.edge_kr)} · 미국 {pct(r.edge_us)}\n",
            ]

    lines.append("\n## ⚪ 검증 결과 근거 없음 (탈락 원칙)\n")
    lines.append("유명한 격언이라도 데이터가 지지하지 않으면 여기 기록 — 이것도 귀납의 성과.\n")
    lines.append("| 원칙 | 방향 | 표본 | edge(t+20) | 승률 | 탈락 사유 |")
    lines.append("|---|---|---|---|---|---|")
    for r in res[~res["passed"]].itertuples():
        why = []
        if not r.pass_n:
            why.append("표본 부족")
        if not r.pass_halves:
            why.append("기간 불안정")
        if not r.pass_markets:
            why.append(f"시장 편중({r.single_market or '양쪽 모두 무의미'})")
        if not r.pass_p:
            why.append("유의성 부족")
        lines.append(f"| {r.name} | {'매수' if r.side=='buy' else '매도'} | {r.n:,} | "
                     f"{pct(r.edge20)} | {r.win_rate*100:.0f}% | {', '.join(why)} |")

    passed_not_sel = res[res["passed"] & ~res["selected"]]
    if not passed_not_sel.empty:
        lines.append("\n## 통과했으나 상위권 밖 (참고)\n")
        for r in passed_not_sel.itertuples():
            lines.append(f"- {r.name}: edge {pct(r.edge20)}, 승률 {r.win_rate*100:.0f}%, 표본 {r.n:,}")

    lines += [
        "\n## 한계",
        "- 현재 구성종목 기준 수집 → 생존 편향 존재(우량주 편중). 방향성 참고용이며 수익률 그 자체를 보장하지 않음.",
        "- 거래비용·슬리피지·호가 미반영, 일봉 종가 체결 가정.",
        "- 과거 10년 패턴이며 미래 시장 구조 변화 시 무효화될 수 있음.",
    ]
    (ROOT / "report.md").write_text("\n".join(lines), encoding="utf-8")


def main():
    print("[1/4] 데이터 로드...")
    from common import core_data
    data = core_data(load_all())  # 원칙 검증은 대형주 코어만(메서드론 유지)
    n_kr = sum(1 for k in data if k[0] == "kr")
    n_us = sum(1 for k in data if k[0] == "us")
    print(f"  한국 {n_kr} + 미국 {n_us} = {len(data)}종목")
    if not data:
        print("data\\ 비어있음 — 먼저 python analysis\\collect.py 실행", file=sys.stderr)
        sys.exit(1)

    print("[2/4] 이벤트 스터디 백테스트...")
    events, baseline = backtest.run(data)
    print(f"  신호 이벤트 {len(events):,}건 수집")

    print("[3/4] 강건성 검증 & 선별...")
    res = validate.evaluate(events, baseline)
    n_sel = int(res["selected"].sum())
    print(f"  후보 {len(res)}개 중 생존 {int(res['passed'].sum())}개 → 최종 채택 {n_sel}개")

    print("[4/4] 리포트 & JSON 생성...")
    write_report(res, n_kr, n_us, len(events))
    examples = build_examples(res, events, data)

    names_path = ROOT / "data" / "kr_names.json"
    kr_names = json.loads(names_path.read_text(encoding="utf-8")) if names_path.exists() else {}

    res_json = res.replace({np.nan: None}).to_dict(orient="records")
    payload = {
        "generated": date.today().isoformat(),
        "meta": {"n_kr": n_kr, "n_us": n_us, "n_events": int(len(events)),
                 "period": "2016~2026", "split": "2021-07-01",
                 "criteria": "표본≥300 · 전/후반 모두 우위 · 한/미 모두 우위 · p<0.01"},
        "rules": res_json,
        "examples": examples,
        "kr_names": kr_names,
    }
    out = ROOT / "app" / "data" / "results.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(f"완료: report.md / {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

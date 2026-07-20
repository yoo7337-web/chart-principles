# -*- coding: utf-8 -*-
r"""종목 조회 모드 사전 생성: 캐시된 전 종목 각각에 대해
최근 1.5년 차트 + 활성 원칙 신호 + 그 종목 10년 원칙별 성적 → app\data\stocks\{mk}_{tk}.json

사용법: python analysis\stock_pages.py   (선행: report.py, regime_report.py)
"""
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from collect import DATA_DIR, load_all
from common import APP_DATA, ROOT, dedupe_positions, load_ruleset
from indicators import add_indicators

OUT_DIR = APP_DATA / "stocks"
CHART_BARS = 1250  # 최근 약 5년 (지표는 프런트 taEnrich()가 계산 — OHLCV만 저장해 용량 유지)
SUPPLY_BARS = 120  # 수급 표시 구간
H = 20


def build_supply(mk: str, tk: str, df) -> tuple:
    """수급(외국인·기관) 누적 순매수 대금 + 요약. KR만, 없으면 (None, None)."""
    if mk != "kr":
        return None, None
    path = DATA_DIR / f"flow_{tk}.parquet"
    if not path.exists():
        return None, None
    import pandas as pd
    flow = pd.read_parquet(path).sort_index()
    close = df["close"].reindex(flow.index).ffill()
    # 일별 순매수 대금(억원) ≈ 순매매량 × 종가
    frgn_val = (flow["frgn_net_vol"].fillna(0) * close / 1e8)
    inst_val = (flow["inst_net_vol"].fillna(0) * close / 1e8)
    w = flow.tail(SUPPLY_BARS)
    frgn_cum = frgn_val.tail(SUPPLY_BARS).cumsum()
    inst_cum = inst_val.tail(SUPPLY_BARS).cumsum()
    series = [{
        "t": ts.strftime("%Y-%m-%d"),
        "fc": round(float(frgn_cum.loc[ts]), 1), "ic": round(float(inst_cum.loc[ts]), 1),
        "fr": None if pd.isna(w.loc[ts, "frgn_ratio"]) else round(float(w.loc[ts, "frgn_ratio"]), 2),
    } for ts in w.index]

    def net(vals, n):
        return round(float(vals.tail(n).sum()), 1)
    ratio = flow["frgn_ratio"].dropna()
    summary = {
        "frgn_5": net(frgn_val, 5), "frgn_20": net(frgn_val, 20),
        "inst_5": net(inst_val, 5), "inst_20": net(inst_val, 20),
        "frgn_ratio": round(float(ratio.iloc[-1]), 2) if len(ratio) else None,
        "frgn_ratio_chg": round(float(ratio.iloc[-1] - ratio.iloc[-21]), 2) if len(ratio) > 21 else None,
        "asof": w.index[-1].strftime("%Y-%m-%d") if len(w) else None,
    }
    return series, summary


def fv(v, nd=4):
    return None if v is None or (isinstance(v, float) and np.isnan(v)) else round(float(v), nd)


def build_profile_ctx(data: dict) -> dict:
    """시장별 동일가중 지수 수익률 + 섹터맵 + 섹터 내 시총순위 사전 계산."""
    import numpy as np
    ctx = {"comp_ret": {}, "sector": {}, "sector_rank": {}}
    for mk in ("kr", "us"):
        import pandas as pd
        C = pd.DataFrame({tk: df["close"] for (m, tk), df in data.items() if m == mk}).sort_index()
        ctx["comp_ret"][mk] = C.pct_change().mean(axis=1)  # 동일가중 일수익률
    smap_path = ROOT / "data" / "sector_map.json"
    if smap_path.exists():
        smap = json.loads(smap_path.read_text(encoding="utf-8"))["map"]
        by_sec = {}
        for key, meta in smap.items():
            sec = meta.get("sector", "기타")
            ctx["sector"][key] = sec
            by_sec.setdefault((key.split("_")[0], sec), []).append((key, float(meta.get("mcap") or 0)))
        for (mk, sec), arr in by_sec.items():
            for rank, (key, _) in enumerate(sorted(arr, key=lambda x: -x[1]), 1):
                ctx["sector_rank"][key] = (rank, len(arr))
    return ctx


def stock_profile(mk: str, tk: str, df, ctx: dict) -> dict:
    """상대성과·베타·변동성·거래대금 — 종목 이해용 프로파일."""
    import numpy as np
    c = df["close"]
    ret = c.pct_change()
    comp = ctx["comp_ret"][mk].reindex(c.index)
    out = {}
    for label, nd in (("w1", 5), ("m1", 21), ("m3", 63), ("y1", 252)):
        if len(c) > nd:
            stock_r = float(c.iloc[-1] / c.iloc[-1 - nd] - 1)
            comp_r = float((1 + comp.iloc[-nd:]).prod() - 1)
            out[f"ret_{label}"] = round(stock_r, 4)
            out[f"rel_{label}"] = round(stock_r - comp_r, 4)  # 시장 대비
    both = np.column_stack([ret.iloc[-252:].fillna(0), comp.iloc[-252:].fillna(0)])
    var = both[:, 1].var()
    if var > 0:
        out["beta"] = round(float(np.cov(both.T)[0, 1] / var), 2)  # vs 시장 동일가중(1년)
    out["vol20"] = round(float(ret.iloc[-20:].std() * np.sqrt(252) * 100), 1)  # 연율 %
    out["val20"] = float((df["close"] * df["volume"]).iloc[-20:].mean())        # 거래대금 20일 평균
    key = f"{mk}_{tk}"
    if key in ctx["sector"]:
        out["sector"] = ctx["sector"][key]
        if key in ctx["sector_rank"]:
            out["sector_rank"], out["sector_n"] = ctx["sector_rank"][key]
    return out


def main():
    ruleset = load_ruleset()
    data = load_all()
    names_path = ROOT / "data" / "kr_names.json"
    kr_names = json.loads(names_path.read_text(encoding="utf-8")) if names_path.exists() else {}
    profile_ctx = build_profile_ctx(data)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    index = []
    for n_done, ((mk, tk), raw) in enumerate(sorted(data.items()), 1):
        d = add_indicators(raw)
        fwd = d["close"].shift(-H) / d["close"] - 1
        w = d.iloc[-CHART_BARS:]
        cut = len(d) - len(w)  # 차트 시작 위치

        series = [{
            "t": ts.strftime("%Y-%m-%d"),
            "o": fv(x.open, 2), "h": fv(x.high, 2), "l": fv(x.low, 2), "c": fv(x.close, 2),
            "v": float(x.volume),
        } for ts, x in zip(w.index, w.itertuples())]  # 지표 컬럼은 프런트 taEnrich()가 재계산

        markers, stats = [], []
        short_history = len(d) < 750  # 이력 3년 미만 → 원칙 검증 제외(배열은 항상 [] 방출)
        if not short_history:
            for rid, entry in ruleset.items():
                rule = entry["rule"]
                try:
                    sig = rule.fn(d).to_numpy()
                except Exception:
                    continue
                pos = dedupe_positions(sig)
                # 10년 성적 (판정 가능한 신호만)
                rets = [float(fwd.iloc[p]) for p in pos if not np.isnan(fwd.iloc[p])]
                if rets:
                    wins = sum(1 for r in rets if (r > 0 if rule.side == "buy" else r < 0))
                    stats.append({"rule_id": rid, "name": rule.name, "side": rule.side,
                                  "scope": entry["scope"], "n": len(rets),
                                  "win": round(wins / len(rets), 3),
                                  "avg_fwd20": round(float(np.mean(rets)), 4)})
                # 차트 구간 신호 마커
                for p in pos:
                    if p >= cut:
                        markers.append({"t": d.index[p].strftime("%Y-%m-%d"),
                                        "rule_id": rid, "name": rule.name, "side": rule.side})

        supply_series, supply_sum = build_supply(mk, tk, raw)
        payload = {
            "market": mk, "ticker": tk,
            "name": kr_names.get(tk, tk) if mk == "kr" else tk,
            "asof": d.index[-1].strftime("%Y-%m-%d"),
            "profile": stock_profile(mk, tk, raw, profile_ctx),
            "series": series, "markers": sorted(markers, key=lambda x: x["t"]),
            "stats": sorted(stats, key=lambda x: -x["n"]),
            "supply": supply_series, "supply_sum": supply_sum,
            "short_history": short_history,  # True면 종목조회에 '이력 부족·원칙 검증 제외' 배지
        }
        (OUT_DIR / f"{mk}_{tk}.json").write_text(
            json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        index.append({"market": mk, "ticker": tk, "name": payload["name"]})
        if n_done % 50 == 0:
            print(f"  {n_done}/{len(data)}")

    (OUT_DIR / "index.json").write_text(
        json.dumps({"generated": date.today().isoformat(), "stocks": index},
                   ensure_ascii=False), encoding="utf-8")
    print(f"완료: {len(index)}종목 → app\\data\\stocks\\")


if __name__ == "__main__":
    main()

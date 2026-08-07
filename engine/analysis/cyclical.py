# -*- coding: utf-8 -*-
r"""순환성(cyclical) 분석 — 종목이 '경기 순환주'인 정도를 점수화 → app\data\cyclical.json

왜 필요한가: 같은 하락 -30%가 반도체에선 사이클의 일부고 소비재에선 구조적 악화일 수 있다.
종목의 **순환성 강도**를 알면 지표(PER 저평가 등)를 어떻게 읽어야 하는지가 달라진다.

⚠**예측하지 않는다.** 10년이면 월별 관측이 달마다 10개뿐이라 "몇 월에 오른다"는 통계적 근거가 없다
  (이 프로젝트 생존조건 표본≥300에 한참 미달). 그래서 두 가지만 계산한다:
   ①순환성 **강도**(정석 지표 — 표본이 충분해 신뢰 가능)
   ②지난 10년 **같은 시기의 실제 경로**(중앙값·사분위) — 예측선이 아니라 '과거에 이랬다'는 기록.
     표본 수·상승 적중률·부호검정 p값을 함께 실어 화면이 근거의 세기를 밝히게 한다.

순환성 점수(0~100) = 아래 4축 백분위 평균:
  ·연간 수익률 변동성(사이클 진폭)   ·매출 YoY 변동성
  ·영업이익 YoY 변동성(+적자 전환 횟수)  ·시장 베타
실적이 없는 종목(신규상장 등)은 가격 축만으로 계산하고 partial 플래그를 남긴다.

사용법: python analysis\cyclical.py [--top N] [--force]
"""
import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from collect import load_all  # noqa: E402
from common import APP_DATA, ROOT  # noqa: E402

KST = timezone(timedelta(hours=9))
OUT = APP_DATA / "cyclical.json"
FIN_DIR = APP_DATA / "financials"
MIN_ROWS = 1000          # 순환성은 최소 4년 이상 있어야 의미(10년 권장)
FWD_MONTHS = 3           # 과거 경로 창(향후 3개월)


def _yoy(vals: list) -> list:
    out = []
    for i in range(1, len(vals)):
        p, c = vals[i - 1], vals[i]
        if p is None or c is None or abs(p) <= 1:
            continue
        out.append((c / p - 1) * 100)
    return out


def fin_metrics(key: str) -> dict:
    """financials에서 매출·영업이익 YoY 변동성과 적자 연도 수."""
    p = FIN_DIR / f"{key}.json"
    if not p.exists():
        return {}
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}
    src = d.get("cfs") or d.get("ofs") or {}
    a = src.get("annual") or {}
    ys = sorted(a)
    if len(ys) < 4:
        return {}
    rev = [a[y].get("rev") for y in ys]
    op = [a[y].get("op") for y in ys]
    ry, oy = _yoy(rev), _yoy(op)
    out = {"n_year": len(ys)}
    if ry:
        out["rev_vol"] = round(float(np.std(ry)), 1)
    if oy:
        out["op_vol"] = round(float(np.std(oy)), 1)
    out["op_loss_years"] = sum(1 for v in op if v is not None and v < 0)
    return out


def price_metrics(df: pd.DataFrame, mkt: pd.Series | None) -> dict:
    """연간 수익률 변동성·주기(자기상관)·베타 — 가격만으로 계산."""
    c = df["close"].dropna()
    yr = c.resample("YE").last().pct_change().dropna() * 100
    m = c.resample("ME").last().pct_change().dropna()
    out = {"n_row": len(c)}
    if len(yr) >= 4:
        out["yr_vol"] = round(float(yr.std()), 1)
    # 지배 주기: 6~24개월 랙 중 자기상관이 가장 큰 지점(있으면 '몇 개월 주기'로 보인다)
    if len(m) >= 48:
        acs = [(k, m.autocorr(lag=k)) for k in range(6, 25)]
        acs = [(k, v) for k, v in acs if v is not None and np.isfinite(v)]
        if acs:
            k, v = max(acs, key=lambda x: x[1])
            if v >= 0.15:                      # 약한 상관은 주기라 부르지 않는다
                out["cycle_m"] = k
                out["cycle_rho"] = round(float(v), 2)
    if mkt is not None and len(m) >= 36:
        mm = mkt.resample("ME").last().pct_change().dropna()
        j = m.index.intersection(mm.index)
        if len(j) >= 36:
            cov = np.cov(m.loc[j], mm.loc[j])
            if cov[1, 1] > 0:
                out["beta"] = round(float(cov[0, 1] / cov[1, 1]), 2)
    return out


def fwd_paths(df: pd.DataFrame, month: int) -> dict:
    """지난 10년, **이 달 말에 진입했다면** 이후 3개월 경로가 어땠는지.
    반환: {n, med[], q1[], q3[], win(3개월 후 상승 비율), p(부호검정)}
    ⚠예측이 아니다 — 같은 시기의 과거 실적 분포다. 표본이 10개뿐이라 화면에 n과 p를 반드시 밝힌다."""
    c = df["close"].dropna()
    m = c.resample("ME").last()
    idx = [i for i, ts in enumerate(m.index) if ts.month == month and i + FWD_MONTHS < len(m)]
    if len(idx) < 5:
        return {}
    paths = []
    for i in idx:
        base = m.iloc[i]
        if not base or base <= 0:
            continue
        paths.append([float(m.iloc[i + k] / base - 1) * 100 for k in range(1, FWD_MONTHS + 1)])
    if len(paths) < 5:
        return {}
    arr = np.array(paths)
    finals = arr[:, -1]
    wins = int((finals > 0).sum())
    n = len(finals)
    # 부호검정(양측) — 동전 던지기 대비 유의한가
    from math import comb
    k = max(wins, n - wins)
    p = min(1.0, 2 * sum(comb(n, i) for i in range(k, n + 1)) / (2 ** n))
    return {"n": n, "month": month,
            "med": [round(float(v), 1) for v in np.median(arr, axis=0)],
            "q1": [round(float(v), 1) for v in np.percentile(arr, 25, axis=0)],
            "q3": [round(float(v), 1) for v in np.percentile(arr, 75, axis=0)],
            "win": round(wins / n * 100), "p": round(float(p), 3)}


"""── 향후 6개월 방향 확률(v371) ──────────────────────────────────────────
개별 종목 계절성은 표본이 10개뿐이라 못 쓴다. 대신 **전 종목 10년을 풀링**해
(순환성 등급 × 사이클 위치)별로 6개월 후 **초과수익**(같은 시점·시장의 전 종목 중앙값 대비) 분포를 만든다.
표본이 구간당 1,500~9,900개라 이 프로젝트 생존조건(≥300)을 넘는다.

⚠**초과수익으로 봐야 한다** — 원수익 기준이면 2016~2026 강세장이 승률을 밀어올려 전부 좋아 보인다.
⚠전·후반을 갈라 방향이 일치하는지 함께 저장한다(한쪽 기간에만 통하는 패턴을 걸러내려고).
실측 결론: 순환성 강한 종목은 **낙폭이 클 때보다 고점권에서** 이후 6개월이 좋았다(모멘텀).
  high+고점권 승률 56.3%·초과 중앙 +5.6%(전후반 56.9/55.4) ↔ high+낙폭40%↑ 51.2%·+0.6%.
  '떨어지는 칼날' 연구(v202)와 같은 방향이다.
"""
CYC_BANDS_EDGE = [0, 55, 75, 101]
CYC_BAND_NAME = ["low", "mid", "high"]
DD_EDGE = [-101, -40, -25, -12, -4, 1]
DD_NAME = ["dd40+", "dd25_40", "dd12_25", "dd4_12", "peak"]
DD_LABEL = {"dd40+": "고점 -40% 이하", "dd25_40": "고점 -25~-40%", "dd12_25": "고점 -12~-25%",
            "dd4_12": "고점 -4~-12%", "peak": "고점권(-4% 이내)"}


def _band(v, edges, names):
    for i in range(len(edges) - 1):
        if edges[i] < v <= edges[i + 1]:
            return names[i]
    return names[0] if v <= edges[0] else names[-1]


def phase_table(data: dict, scores: dict) -> tuple:
    """(순환성 등급 × 낙폭 구간) → 6개월 초과수익 통계 + 종목별 현재 위상."""
    recs, cur_phase = [], {}
    for key, sc in scores.items():
        mk, tk = key.split("_", 1)
        df = data.get((mk, tk))
        if df is None or len(df) < 1200:
            continue
        m = df["close"].resample("ME").last().dropna()
        if len(m) < 40:
            continue
        hi52 = m.rolling(12, min_periods=6).max()
        dd = (m / hi52 - 1) * 100
        fwd6 = (m.shift(-6) / m - 1) * 100
        cb = _band(sc, CYC_BANDS_EDGE, CYC_BAND_NAME)
        for ts in m.index:
            d, f = dd.get(ts), fwd6.get(ts)
            if d is None or not np.isfinite(d):
                continue
            if f is not None and np.isfinite(f):
                recs.append((ts, mk, cb, _band(float(d), DD_EDGE, DD_NAME), float(f)))
        last_dd = dd.iloc[-1]
        if np.isfinite(last_dd):
            cur_phase[key] = {"dd": round(float(last_dd), 1),
                              "band": _band(float(last_dd), DD_EDGE, DD_NAME), "cband": cb}
    if not recs:
        return {}, cur_phase
    P = pd.DataFrame(recs, columns=["ts", "mk", "cband", "dband", "fwd6"])
    P["ex"] = P.fwd6 - P.groupby(["ts", "mk"])["fwd6"].transform("median")   # 시장 효과 제거
    half = P.ts.median()
    from math import comb, erf, sqrt
    tbl = {}
    for (cb, db), g in P.groupby(["cband", "dband"], observed=True):
        n = len(g)
        if n < 300:                     # 생존조건 미달 구간은 저장하지 않는다(가짜 확률 방지)
            continue
        wins = int((g.ex > 0).sum())
        h1, h2 = g[g.ts <= half], g[g.ts > half]
        w1 = (h1.ex > 0).mean() * 100 if len(h1) > 50 else None
        w2 = (h2.ex > 0).mean() * 100 if len(h2) > 50 else None
        k = max(wins, n - wins)
        # 표본이 크면 정확 이항검정이 느리다 → 정규근사(부호검정의 표준 근사)
        p = (min(1.0, 2 * sum(comb(n, i) for i in range(k, n + 1)) / (2 ** n)) if n <= 1200
             else min(1.0, 2 * (1 - 0.5 * (1 + erf(abs(wins - n / 2) / (sqrt(n) / 2) / sqrt(2))))))
        tbl[f"{cb}|{db}"] = {
            "n": n, "win": round(wins / n * 100, 1), "ex_med": round(float(g.ex.median()), 2),
            "h1": None if w1 is None else round(w1, 1), "h2": None if w2 is None else round(w2, 1),
            "consistent": bool(w1 is not None and w2 is not None and (w1 - 50) * (w2 - 50) > 0),
            "p": round(float(p), 4)}
    return tbl, cur_phase


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=0, help="시총 상위 N만(0=전체)")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()

    data = load_all()
    # 시장 지수(베타용): 동일가중 지수 대신 코스피/나스닥 대용으로 macro 사용
    try:
        mac = pd.read_parquet(ROOT / "data" / "macro.parquet")
        mkt_kr, mkt_us = mac.get("^KS11"), mac.get("^IXIC")
    except Exception:
        mkt_kr = mkt_us = None

    mcap = {}
    try:
        hm = json.loads((APP_DATA / "market.json").read_text(encoding="utf-8")).get("heatmap") or []
        mcap = {f"{x['m']}_{x['t']}": (x.get("mcap") or 0) for x in hm if not x.get("mcap_est")}
    except Exception:
        pass

    keys = [f"{mk}_{tk}" for (mk, tk) in data if len(data[(mk, tk)]) >= MIN_ROWS]
    if a.top:
        keys = sorted(keys, key=lambda k: -(mcap.get(k) or 0))[:a.top]
    print(f"순환성 분석 대상 {len(keys)}종목 (10년 이력 {MIN_ROWS}행+)")

    now_month = datetime.now(KST).month
    raw = {}
    for i, key in enumerate(keys, 1):
        mk, tk = key.split("_", 1)
        df = data[(mk, tk)]
        pm = price_metrics(df, mkt_kr if mk == "kr" else mkt_us)
        fm = fin_metrics(key)
        rec = {**pm, **fm}
        fp = fwd_paths(df, now_month)
        if fp:
            rec["fwd"] = fp
        raw[key] = rec
        if i % 300 == 0:
            print(f"  {i}/{len(keys)}")

    # ── 점수화: 4축을 **백분위**로 환산해 평균(절대값은 시장·업종마다 스케일이 달라 비교가 안 된다) ──
    def pct_rank(vals: dict) -> dict:
        ks = [k for k, v in vals.items() if v is not None]
        if len(ks) < 10:
            return {}
        s = pd.Series({k: vals[k] for k in ks}).rank(pct=True) * 100
        return s.round(1).to_dict()

    axes = {
        "yr_vol": pct_rank({k: v.get("yr_vol") for k, v in raw.items()}),
        "rev_vol": pct_rank({k: v.get("rev_vol") for k, v in raw.items()}),
        "op_vol": pct_rank({k: v.get("op_vol") for k, v in raw.items()}),
        "beta": pct_rank({k: v.get("beta") for k, v in raw.items()}),
    }
    out = {}
    for key, v in raw.items():
        parts = {ax: tbl.get(key) for ax, tbl in axes.items()}
        got = [p for p in parts.values() if p is not None]
        if not got:
            continue
        score = round(float(np.mean(got)), 1)
        # 적자 전환이 있으면 순환성 가산(사이클 저점에서 적자를 내는 것이 순환주의 특징)
        if v.get("op_loss_years"):
            score = min(100.0, score + min(8, v["op_loss_years"] * 4))
        rec = {"score": score, "axes": {k2: p for k2, p in parts.items() if p is not None},
               "partial": len(got) < 4}
        for f in ("yr_vol", "rev_vol", "op_vol", "beta", "cycle_m", "cycle_rho", "op_loss_years", "n_year"):
            if v.get(f) is not None:
                rec[f] = v[f]
        if v.get("fwd"):
            rec["fwd"] = v["fwd"]
        out[key] = rec

    # 향후 6개월 방향 확률 — (순환성 등급 × 낙폭 구간) 풀링 통계 + 종목별 현재 위상
    ptbl, cur = phase_table(data, {k: v["score"] for k, v in out.items()})
    for key, ph in cur.items():
        if key in out:
            out[key]["phase"] = ph
    print(f"  6개월 방향 표: {len(ptbl)}구간(표본 300+ 만 채택) · 위상 산출 {len(cur)}종목")

    payload = {"generated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"),
               "fwd_month": now_month, "fwd_months": FWD_MONTHS,
               "phase_tbl": ptbl, "dd_label": DD_LABEL,
               "n": len(out), "map": out}
    OUT.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    top = sorted(out.items(), key=lambda x: -x[1]["score"])[:8]
    low = sorted(out.items(), key=lambda x: x[1]["score"])[:5]
    print(f"완료: cyclical.json — {len(out)}종목")
    print("  순환성 최고:", ", ".join(f"{k}({v['score']:.0f})" for k, v in top))
    print("  순환성 최저:", ", ".join(f"{k}({v['score']:.0f})" for k, v in low))


if __name__ == "__main__":
    main()

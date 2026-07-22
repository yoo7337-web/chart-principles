# -*- coding: utf-8 -*-
r"""마켓 전문 분석 → app\data\market_pro.json

A. Breadth 시계열(5년, 시장별): ADR(20일 등락비율), 신고-신저 지수(누적), MA50/200 상회 비율
   ⚠클라우드는 2년 캐시(hi52 워밍업 252일 차감 → 실질 ~1년)라 매 실행 새로 계산하면 5년이 무너짐.
   → 기존 published 시계열과 **날짜 키 병합**(신규 우선) + 1년 이전 구간은 주1회로 솎아 용량 억제.
   누적 지표(nhnl)는 시작점이 창(window)마다 달라지므로 겹치는 마지막 날짜에 **레벨 리베이스** 후 병합.
B. 섹터 로테이션: 섹터 시총가중 수익률 1주/1M/3M + 시장 대비 상대강도
C. 리스크 게이지: 코스피↔달러/미10Y/VIX 60일 상관, 실현변동성 vs VIX, 리스크온/오프 점수(0~100)
D. AI 마켓 브리핑: Gemini — 매크로+breadth+오늘의 신호+뉴스 헤드라인 종합

사용법: python analysis\market_pro.py   (market_dash 선행 — sector_map·macro.parquet 사용)
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from collect import DATA_DIR, load_all, load_research
from common import APP_DATA, ROOT

KST = timezone(timedelta(hours=9))  # 클라우드 러너=UTC 대응

HIST_DAYS = 1300      # 5년치 거래일(252×5≈1260) + 여유
DAILY_DAYS = 400      # 최근 이 일수까지는 일별 유지, 그 이전은 주1회로 솎음


def close_matrix(data: dict, mk: str) -> pd.DataFrame:
    return pd.DataFrame({tk: df["close"] for (m, tk), df in data.items() if m == mk}).sort_index()


def _thin(points: list) -> list:
    """1년(DAILY_DAYS) 이전 구간은 주당 1개(그 주의 마지막)만 남김.
    ⚠멱등(idempotent)이어야 함 — 매 실행 재적용되므로 '매 5번째' 같은 인덱스 방식은 점점 성겨져 금지."""
    if not points:
        return points
    cutoff = (datetime.now(KST).date() - timedelta(days=DAILY_DAYS)).strftime("%Y-%m-%d")
    recent = [p for p in points if p["t"] >= cutoff]
    older = [p for p in points if p["t"] < cutoff]
    by_week = {}
    for p in older:                      # 같은 ISO주면 뒤 날짜가 덮어씀 → 그 주의 마지막만 생존(멱등)
        y, w, _ = datetime.strptime(p["t"], "%Y-%m-%d").isocalendar()
        by_week[(y, w)] = p
    return sorted(by_week.values(), key=lambda p: p["t"]) + recent


def _merge_series(old: list, new: list, cumulative: bool = False) -> list:
    """published 시계열(old)과 이번 계산분(new)을 날짜 키로 병합 — 클라우드 짧은 창이 과거를 잘라먹지 않게.
    cumulative=True면 겹치는 마지막 날짜 기준으로 new의 레벨을 old에 맞춰 평행이동(누적 지표의 원점 차이 보정)."""
    if not old:
        return _thin(new)
    if not new:
        return _thin(old)
    omap = {p["t"]: p["v"] for p in old}
    if cumulative:
        common = [p["t"] for p in new if p["t"] in omap]
        if common:
            anchor = common[-1]
            nmap = {p["t"]: p["v"] for p in new}
            off = omap[anchor] - nmap[anchor]
            new = [{"t": p["t"], "v": round(p["v"] + off, 2)} for p in new]
        else:
            return _thin(old)          # 겹침 없음 → 레벨 보정 불가, 과거 보존 우선
    omap.update({p["t"]: p["v"] for p in new})
    merged = [{"t": t, "v": omap[t]} for t in sorted(omap)]
    return _thin(merged[-(HIST_DAYS + 300):])   # 5년 + 솎임 여유까지만 보관


# 시계열 키 — nhnl만 누적(원점 보정 필요). frgn20/inst20은 KR 전용(수급 parquet이 로컬에만 있음)
BREADTH_KEYS = ("adr", "nhnl", "ma50", "ma200", "hi52", "lo52", "mcc", "ddmed",
                "corr60", "rv20", "ewcw", "conc10", "frgn20", "inst20")
CUMULATIVE_KEYS = ("nhnl",)


def _pack(hist_mk: dict) -> dict:
    """{키: [{t,v},…]} → {t:[날짜…], 키:[값…]} 공유 날짜축 포맷(용량 1/3). 결측은 null."""
    dates = sorted({p["t"] for s in hist_mk.values() for p in s})
    idx = {t: i for i, t in enumerate(dates)}
    out = {"t": dates}
    for k, s in hist_mk.items():
        col = [None] * len(dates)
        for p in s:
            col[idx[p["t"]]] = p["v"]
        out[k] = col
    return out


def _unpack(hist_mk: dict) -> dict:
    """_pack 역변환. 구(舊) [{t,v},…] 포맷도 그대로 통과(하위호환)."""
    if not hist_mk or "t" not in hist_mk:
        return hist_mk or {}
    dates = hist_mk["t"]
    return {k: [{"t": dates[i], "v": v} for i, v in enumerate(col) if v is not None]
            for k, col in hist_mk.items() if k != "t"}


def merge_breadth(old_hist: dict, new_hist: dict) -> dict:
    """시장×지표별 병합 후 압축 저장. 새 계산분이 비면(클라우드 미보유 지표) 기존 이력 보존."""
    out = {}
    for mk in ("kr", "us"):
        o = _unpack((old_hist or {}).get(mk, {}))
        n = new_hist.get(mk, {})
        merged = {k: _merge_series(o.get(k, []), n.get(k, []), cumulative=(k in CUMULATIVE_KEYS))
                  for k in BREADTH_KEYS}
        out[mk] = _pack({k: v for k, v in merged.items() if v})
    return out


def _avg_pair_corr(R: pd.DataFrame, win: int = 60) -> pd.Series:
    """종목 간 평균 상관계수(rolling) — 전 쌍 계산(O(n²))은 불가능하므로 항등식으로 O(n).
       Σ_{i<j}cov = (Var(Σr) − Σvar)/2,  Σ_{i<j}sd_i·sd_j = ((Σsd)² − Σsd²)/2
       ⇒ 평균상관 = (Var(Σr) − Σvar) / ((Σsd)² − Σsd²)"""
    S = R.sum(axis=1)
    sd = R.rolling(win).std()
    sum_sd = sd.sum(axis=1)
    sum_var = (sd ** 2).sum(axis=1)
    num = S.rolling(win).var() - sum_var
    den = sum_sd ** 2 - sum_var
    return (num / den.replace(0, np.nan)).clip(-1, 1)


def breadth_series(data: dict, macro: pd.DataFrame | None = None) -> dict:
    """시장별 시장내부 지표 14종 — 최근 HIST_DAYS."""
    out = {}
    IDX_COL = {"kr": "^KS11", "us": "^GSPC"}
    for mk in ("kr", "us"):
        C = close_matrix(data, mk)
        V = pd.DataFrame({tk: df["volume"] for (m, tk), df in data.items() if m == mk}).sort_index()
        n_valid = C.notna().sum(axis=1)
        chg = C.diff()
        up = (chg > 0).sum(axis=1)
        dn = (chg < 0).sum(axis=1)
        adr = (up.rolling(20).sum() / dn.rolling(20).sum().replace(0, np.nan) * 100)
        hi52c = (C >= C.rolling(252).max()).sum(axis=1)
        lo52c = (C <= C.rolling(252).min()).sum(axis=1)
        nhnl = (hi52c - lo52c).cumsum()
        ma50 = (C > C.rolling(50).mean()).sum(axis=1) / n_valid * 100
        ma200 = (C > C.rolling(200).mean()).sum(axis=1) / n_valid * 100

        # 신고가/신저가 '비율' 분리 — 둘 다 높으면 시장 분열(Hindenburg류 경고)
        hi52 = hi52c / n_valid * 100
        lo52 = lo52c / n_valid * 100

        # McClellan 오실레이터 — RANA(등락 정규화)의 EMA19 − EMA39. breadth 모멘텀(변곡 선행)
        rana = ((up - dn) / (up + dn).replace(0, np.nan) * 1000)
        mcc = rana.ewm(span=19, adjust=False).mean() - rana.ewm(span=39, adjust=False).mean()

        # 52주 고점 대비 낙폭 중앙값(%) — '체감 하락률'
        ddmed = ((C / C.rolling(252).max() - 1) * 100).median(axis=1)

        # 종목 간 평균 상관계수(60일) — 급등=시스템 리스크/패닉, 하락=종목장
        R = C.pct_change()
        R = R.loc[:, R.notna().mean() >= 0.95].fillna(0)   # 상장 짧은 종목 제외 후 결측 0
        corr60 = _avg_pair_corr(R, 60) if R.shape[1] >= 20 else pd.Series(dtype=float)

        # 거래대금 상위 10종목 집중도(%) — 유동성 쏠림(5일 평균으로 평활)
        A = (C * V).values
        tot = np.nansum(A, axis=1)
        k = min(10, A.shape[1])
        top = np.sort(np.nan_to_num(A, nan=0.0), axis=1)[:, -k:].sum(axis=1)
        conc10 = pd.Series(np.where(tot > 0, top / np.where(tot > 0, tot, 1) * 100, np.nan),
                           index=C.index).rolling(5).mean()

        # 동일가중 − 시총가중(지수) 60일 수익률 차(%p) — 양수=확산, 음수=대형주 쏠림
        ew = (1 + R.mean(axis=1)).cumprod()
        ew60 = ew / ew.shift(60) - 1
        ewcw = rv20 = pd.Series(dtype=float)
        col = IDX_COL[mk]
        if macro is not None and col in macro.columns:
            ix = macro[col].reindex(C.index).ffill()
            ewcw = (ew60 - (ix / ix.shift(60) - 1)) * 100
            rv20 = ix.pct_change().rolling(20).std() * np.sqrt(252) * 100  # 지수 실현변동성(연율 %)

        def ser(s):
            if s is None or not len(s):
                return []
            t = s.replace([np.inf, -np.inf], np.nan).dropna().tail(HIST_DAYS)
            return [{"t": d.strftime("%Y-%m-%d"), "v": round(float(v), 2)} for d, v in t.items()]
        out[mk] = {"adr": ser(adr), "nhnl": ser(nhnl), "ma50": ser(ma50), "ma200": ser(ma200),
                   "hi52": ser(hi52), "lo52": ser(lo52), "mcc": ser(mcc), "ddmed": ser(ddmed),
                   "corr60": ser(corr60), "rv20": ser(rv20), "ewcw": ser(ewcw), "conc10": ser(conc10)}
    flow = supply_series(data)
    for mk, v in flow.items():
        out[mk].update(v)
    return out


def supply_series(data: dict) -> dict:
    """시장 전체 외국인·기관 20일 누적 순매수(억원) — data\\flow_*.parquet(네이버, 국내 전용·로컬 전용).
    클라우드엔 flow parquet이 없어 빈 결과 → merge가 기존 이력을 보존한다."""
    files = list(DATA_DIR.glob("flow_*.parquet"))
    if not files:
        return {}
    frgn, inst = {}, {}
    for f in files:
        code = f.stem.replace("flow_", "")
        px = data.get(("kr", code))
        if px is None:
            continue
        try:
            fl = pd.read_parquet(f)
        except Exception:
            continue
        c = px["close"].reindex(fl.index).ffill()
        for col, acc in (("frgn_net_vol", frgn), ("inst_net_vol", inst)):
            if col not in fl.columns:
                continue
            amt = (fl[col] * c) / 1e8            # 순매매량×종가 → 억원
            for d, v in amt.dropna().items():
                acc[d] = acc.get(d, 0.0) + float(v)
    if not frgn and not inst:
        return {}

    def ser(acc):
        s = pd.Series(acc).sort_index().rolling(20, min_periods=5).sum()
        return [{"t": d.strftime("%Y-%m-%d"), "v": round(float(v), 1)}
                for d, v in s.dropna().tail(HIST_DAYS).items()]
    return {"kr": {"frgn20": ser(frgn), "inst20": ser(inst)}}


def sector_rotation(data: dict) -> dict:
    """섹터 시총가중 수익률(1주/1M/3M) + 시장 대비 상대강도."""
    smap_path = DATA_DIR / "sector_map.json"
    if not smap_path.exists():
        return {}
    smap = json.loads(smap_path.read_text(encoding="utf-8"))["map"]
    names_path = ROOT / "data" / "kr_names.json"
    _ = names_path  # (섹터 단위라 종목명 불필요)

    US_KO = {"Technology": "기술", "Communication Services": "커뮤니케이션", "Consumer Cyclical": "임의소비재",
             "Consumer Defensive": "필수소비재", "Financial Services": "금융", "Healthcare": "헬스케어",
             "Industrials": "산업재", "Energy": "에너지", "Utilities": "유틸리티",
             "Real Estate": "부동산", "Basic Materials": "소재"}
    out = {}
    for mk in ("kr", "us"):
        C = close_matrix(data, mk)
        rows, mkt_ret = {}, {}
        # 시장 전체(시총가중) 수익률
        weights = {tk: float(smap.get(f"{mk}_{tk}", {}).get("mcap") or 0) for tk in C.columns}
        for label, nd in (("w1", 5), ("m1", 21), ("m3", 63)):
            r = C.iloc[-1] / C.iloc[-1 - nd] - 1
            w = pd.Series(weights).reindex(r.index).fillna(0)
            mkt_ret[label] = float((r * w).sum() / w.sum()) if w.sum() > 0 else float(r.mean())
        last, prev = C.iloc[-1], C.iloc[-2]
        ma20_last = C.rolling(20).mean().iloc[-1]
        hi52_max = C.iloc[-252:].max()
        by_sec = {}
        for tk in C.columns:
            sec = smap.get(f"{mk}_{tk}", {}).get("sector", "기타")
            if mk == "us":
                sec = US_KO.get(sec, sec)
            by_sec.setdefault(sec, []).append(tk)
        recs = []
        for sec, tks in by_sec.items():
            if len(tks) < 2:
                continue
            rec = {"sector": sec, "n": len(tks)}
            w = pd.Series({t: weights.get(t, 0) for t in tks})
            if w.sum() <= 0:
                w[:] = 1
            for label, nd in (("w1", 5), ("m1", 21), ("m3", 63)):
                r = (C[tks].iloc[-1] / C[tks].iloc[-1 - nd] - 1).fillna(0)
                sec_ret = float((r * w).sum() / w.sum())
                rec[label] = round(sec_ret, 4)
                rec[f"rs_{label}"] = round(sec_ret - mkt_ret[label], 4)  # 시장 대비 초과
            # 참여도: 당일 상승 비율 / 20일선 위 비율 / 52주 신고가 수 — RS의 '속'을 보는 지표
            rec["up"] = round(float((last[tks] > prev[tks]).mean() * 100))
            rec["ma20"] = round(float((last[tks] > ma20_last[tks]).mean() * 100))
            rec["hi52"] = int((last[tks] >= hi52_max[tks] * 0.999).sum())
            recs.append(rec)
        recs.sort(key=lambda x: -x["rs_m1"])
        out[mk] = {"sectors": recs, "market": {k: round(v, 4) for k, v in mkt_ret.items()}}
    return out


def risk_gauge() -> dict:
    """macro.parquet 기반 상관·변동성·리스크온오프 점수."""
    mp = DATA_DIR / "macro.parquet"
    if not mp.exists():
        return {}
    M = pd.read_parquet(mp).sort_index()
    ks, ret = M.get("^KS11"), None
    if ks is None:
        return {}
    ret = ks.pct_change()

    def roll_corr(col):
        if col not in M.columns:
            return None
        c = ret.rolling(60).corr(M[col].pct_change()).dropna()
        return round(float(c.iloc[-1]), 3) if len(c) else None

    corr = {"dollar": roll_corr("DX-Y.NYB"), "us10y": roll_corr("^TNX"), "vix": roll_corr("^VIX")}
    rv20 = float(ret.rolling(20).std().iloc[-1] * np.sqrt(252) * 100)  # 실현변동성(연율 %)
    vix = float(M["^VIX"].dropna().iloc[-1]) if "^VIX" in M.columns else None

    # 리스크온/오프 점수(0~100, 높을수록 리스크온): 구성요소 z-score(6개월) 합성
    comps, notes = [], []
    def z(col, invert=False, name=""):
        if col not in M.columns:
            return
        s = M[col].dropna().tail(126)
        if len(s) < 30 or s.std() == 0:
            return
        zv = float((s.iloc[-1] - s.mean()) / s.std())
        if invert:
            zv = -zv
        comps.append(zv)
        notes.append(f"{name} z={zv:+.2f}")
    z("^VIX", invert=True, name="VIX(역)")          # VIX 낮을수록 리스크온
    z("DX-Y.NYB", invert=True, name="달러(역)")      # 달러 약세=리스크온
    z("^KS11", name="코스피")                        # 주가 강세
    z("GC=F", invert=True, name="금(역)")            # 금 선호=리스크오프
    score = max(0.0, min(100.0, 50 + 12.5 * float(np.mean(comps)))) if comps else None

    return {
        "corr60": corr,
        "rv20": round(rv20, 1), "vix": round(vix, 1) if vix else None,
        "vix_gap": round(vix - rv20, 1) if vix else None,  # +면 시장이 미래를 더 불안해함
        "score": round(score) if score is not None else None,
        "score_note": " · ".join(notes),
        "formula": "리스크 점수 = 50 + 12.5×mean(z) — z: VIX(역)·달러(역)·코스피·금(역), 최근 6개월 기준. 높을수록 리스크온",
    }


def ai_brief(macro_summary: str, breadth_summary: str, signals_summary: str, headlines: str) -> str | None:
    from gemini_util import generate, sanitize
    prompt = f"""당신은 증권사 데스크의 시황 요약 담당입니다. 아래 데이터로 브리핑을 작성하세요.

[매크로] {macro_summary}
[시장 내부] {breadth_summary}
[오늘의 원칙 신호] {signals_summary}
[뉴스 헤드라인] {headlines}

형식(총 4줄, 한국어, <b>만 허용, URL 금지):
1~3줄: 오늘 시장의 핵심 3가지 (각 1문장, 데이터 근거 포함)
4줄: <b>원칙 관점</b>: 현재 국면에서 검증된 매매원칙 사용자에게 주는 시사점 1문장"""
    raw = generate(prompt, max_tokens=1024)
    return sanitize(raw) if raw else None


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-brief", action="store_true",
                    help="AI 브리핑 생략(장중 30분 배치용) — 기존 brief 보존")
    args = ap.parse_args()

    print("[1/4] Breadth 시계열...")
    from common import core_data
    # ⚠load_research()는 클라우드(2년 캐시)에서 항상 빈 결과 → 크래시(2026-07-20 사고). 이 스크립트는
    # refresh.yml 30분 클라우드 루프에 포함되므로 market_dash와 동일하게 유동성 코어만 사용.
    data = core_data(load_all())
    out_path = APP_DATA / "market_pro.json"
    prev = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else {}
    # 기존 published 시계열과 병합 — 클라우드(2년 캐시)가 로컬 백필한 5년 이력을 잘라먹지 않게
    _mp = DATA_DIR / "macro.parquet"
    macro = pd.read_parquet(_mp).sort_index() if _mp.exists() else None
    breadth = merge_breadth(prev.get("breadth_hist"), breadth_series(data, macro))
    _t = breadth.get("kr", {}).get("t", [])
    _keys = [k for k in breadth.get("kr", {}) if k != "t"]
    print(f"      breadth KR {len(_t)}p ({_t[0] if _t else '-'} ~) · 지표 {len(_keys)}종: {','.join(_keys)}")

    print("[2/4] 섹터 로테이션...")
    rotation = sector_rotation(data)

    print("[3/4] 리스크 게이지...")
    risk = risk_gauge()

    if args.no_brief:
        print("[4/4] AI 브리핑 생략(--no-brief) — 기존 브리핑 보존")
        brief = prev.get("brief")
        brief_at = prev.get("brief_at")
        payload = {
            "generated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"),
            "breadth_hist": breadth, "rotation": rotation, "risk": risk,
            "brief": brief, "brief_at": brief_at,
        }
        out_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        print(f"완료: market_pro.json — 리스크점수 {risk.get('score')} (브리핑 유지)")
        return

    print("[4/4] AI 브리핑...")
    mj = json.loads((APP_DATA / "market.json").read_text(encoding="utf-8")) if (APP_DATA / "market.json").exists() else {}
    tj = json.loads((APP_DATA / "today_signals.json").read_text(encoding="utf-8")) if (APP_DATA / "today_signals.json").exists() else {}
    nj = json.loads((APP_DATA / "news.json").read_text(encoding="utf-8")) if (APP_DATA / "news.json").exists() else {}
    macro_s = ", ".join(f"{m['name']} {m['last']}({m['chg']*100:+.1f}%)" for m in mj.get("macro", [])[:8])
    b = mj.get("breadth", {})
    breadth_s = (f"KR 상승{b.get('kr',{}).get('up','?')}/하락{b.get('kr',{}).get('down','?')}, "
                 f"US 상승{b.get('us',{}).get('up','?')}/하락{b.get('us',{}).get('down','?')}, "
                 f"국면 KR={mj.get('regime',{}).get('kr','?')} US={mj.get('regime',{}).get('us','?')}, "
                 f"리스크점수 {risk.get('score','?')}/100, VIX-실현변동성 갭 {risk.get('vix_gap','?')}")
    sig = [s for s in tj.get("signals", []) if s.get("active")][:8]
    signals_s = ", ".join(f"{s['name']} {s['rule']}({'매수' if s['side']=='buy' else '매도'})" for s in sig) or "없음"
    heads = "; ".join(n["title"] for n in nj.get("market", [])[:10])
    brief = ai_brief(macro_s, breadth_s, signals_s, heads)

    payload = {
        "generated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"),
        "breadth_hist": breadth, "rotation": rotation, "risk": risk,
        "brief": brief, "brief_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M") if brief else None,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(f"완료: market_pro.json — 리스크점수 {risk.get('score')}, 브리핑 {'OK' if brief else '없음'}")


if __name__ == "__main__":
    main()

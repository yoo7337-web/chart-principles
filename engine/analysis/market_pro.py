# -*- coding: utf-8 -*-
r"""마켓 전문 분석 → app\data\market_pro.json

A. Breadth 시계열(120일, 시장별): ADR(20일 등락비율), 신고-신저 지수(누적), MA50/200 상회 비율
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

from collect import DATA_DIR, load_all
from common import APP_DATA, ROOT

KST = timezone(timedelta(hours=9))  # 클라우드 러너=UTC 대응

HIST_DAYS = 120


def close_matrix(data: dict, mk: str) -> pd.DataFrame:
    return pd.DataFrame({tk: df["close"] for (m, tk), df in data.items() if m == mk}).sort_index()


def breadth_series(data: dict) -> dict:
    """시장별 ADR·신고-신저 누적·MA50/200 상회 비율 — 최근 HIST_DAYS."""
    out = {}
    for mk in ("kr", "us"):
        C = close_matrix(data, mk)
        chg = C.diff()
        up = (chg > 0).sum(axis=1)
        dn = (chg < 0).sum(axis=1)
        adr = (up.rolling(20).sum() / dn.rolling(20).sum().replace(0, np.nan) * 100)
        hi52 = (C >= C.rolling(252).max()).sum(axis=1)
        lo52 = (C <= C.rolling(252).min()).sum(axis=1)
        nhnl = (hi52 - lo52).cumsum()
        ma50 = (C > C.rolling(50).mean()).sum(axis=1) / C.notna().sum(axis=1) * 100
        ma200 = (C > C.rolling(200).mean()).sum(axis=1) / C.notna().sum(axis=1) * 100

        def ser(s):
            t = s.dropna().tail(HIST_DAYS)
            return [{"t": d.strftime("%Y-%m-%d"), "v": round(float(v), 2)} for d, v in t.items()]
        out[mk] = {"adr": ser(adr), "nhnl": ser(nhnl), "ma50": ser(ma50), "ma200": ser(ma200)}
    return out


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
    data = core_data(load_all())  # 분석은 대형주 코어만
    breadth = breadth_series(data)

    print("[2/4] 섹터 로테이션...")
    rotation = sector_rotation(data)

    print("[3/4] 리스크 게이지...")
    risk = risk_gauge()

    out_path = APP_DATA / "market_pro.json"
    if args.no_brief:
        print("[4/4] AI 브리핑 생략(--no-brief) — 기존 브리핑 보존")
        old = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else {}
        brief = old.get("brief")
        brief_at = old.get("brief_at")
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

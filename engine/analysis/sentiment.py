# -*- coding: utf-8 -*-
r"""시장 심리 지표 — 미국 공포·탐욕(CNN) / 풋콜 비율(CBOE) + 한국 자체 합성 지표

왜 필요한가: 크립토 탭의 공포·탐욕은 **암호화폐 전용**(alternative.me)이라 증시 심리와 무관하다.
증시용은 CNN Fear&Greed가 표준이고, 그 원자료 안에 **CBOE 풋콜 비율**도 함께 들어 있다.

⚠한국은 공식 공포·탐욕 지수가 없다(KOSPI200 옵션 풋콜은 KRX 로그인벽으로 수집 불가).
  → 우리가 이미 만든 시장폭·변동성 지표로 **같은 방식(구성지표별 백분위 평균)** 의 합성 지표를 만든다.
  CNN과 구성이 다르므로 '동일 지수'가 아님을 화면에 명시할 것.

출력: app/data/sentiment.json
"""
import json
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "data" / "sentiment.json"
KST = timezone(timedelta(hours=9))

# CNN dataviz는 봇을 막아 기본 UA로는 418을 준다 → 브라우저 헤더 필수
CNN_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
HDRS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/122.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://edition.cnn.com/",
}
# CNN 구성지표 7종 — 한글 라벨과 의미(화면 툴팁용)
CNN_PARTS = [
    ("market_momentum_sp500", "주가 모멘텀", "S&P500이 125일 이평 위/아래 얼마나 떨어져 있는지"),
    ("stock_price_strength", "신고가 강도", "52주 신고가 종목이 신저가보다 얼마나 많은지"),
    ("stock_price_breadth", "거래량 폭", "상승 종목 거래량 vs 하락 종목 거래량"),
    ("put_call_options", "풋콜 비율", "풋옵션/콜옵션 거래량 — 높을수록 하락 베팅(공포)"),
    ("market_volatility_vix", "변동성(VIX)", "VIX가 50일 평균 대비 어디인지"),
    ("junk_bond_demand", "정크본드 수요", "투기등급 회사채 스프레드 — 좁을수록 위험선호"),
    ("safe_haven_demand", "안전자산 수요", "주식 대비 채권 수익률 차 — 클수록 위험선호"),
]


def _get(url: str) -> bytes:
    return urllib.request.urlopen(urllib.request.Request(url, headers=HDRS), timeout=25).read()


def _ms_to_day(ms) -> str:
    return datetime.fromtimestamp(float(ms) / 1000, timezone.utc).strftime("%Y-%m-%d")


def fetch_us() -> dict:
    """CNN Fear&Greed 본지수 + 구성지표 7종(풋콜 비율 포함). 1년 일별."""
    d = json.loads(_get(CNN_URL))
    fg = d.get("fear_and_greed") or {}
    hist = [{"t": _ms_to_day(p["x"]), "v": round(float(p["y"]), 1)}
            for p in (d.get("fear_and_greed_historical") or {}).get("data") or []]
    parts = []
    for pid, label, note in CNN_PARTS:
        p = d.get(pid) or {}
        if p.get("score") is None:
            continue
        series = [{"t": _ms_to_day(x["x"]), "v": round(float(x["y"]), 4)}
                  for x in (p.get("data") or [])][-260:]
        parts.append({"id": pid, "label": label, "note": note,
                      "score": round(float(p["score"]), 1), "rating": p.get("rating"),
                      "series": series})
    # 풋콜 비율은 하루치가 튄다(장중 이벤트에 민감) → **5일 이동평균**을 대표값으로 쓴다.
    pc = d.get("put_call_options") or {}
    raw = [{"t": _ms_to_day(x["x"]), "v": round(float(x["y"]), 3)} for x in (pc.get("data") or [])]
    ma5 = []
    for i, p in enumerate(raw):
        w = [q["v"] for q in raw[max(0, i - 4):i + 1]]
        ma5.append({"t": p["t"], "v": round(sum(w) / len(w), 3), "raw": p["v"]})
    putcall = {"last": ma5[-1]["v"] if ma5 else None,           # 5일 평균(대표값)
               "last_raw": raw[-1]["v"] if raw else None,       # 당일 원값(참고)
               "score": round(float(pc["score"]), 1) if pc.get("score") is not None else None,
               "rating": pc.get("rating"), "window": 5, "series": ma5[-260:]}
    return {"score": round(float(fg.get("score", 0)), 1), "rating": fg.get("rating"),
            "hist": hist, "parts": parts, "putcall": putcall}


def _pctile(series: list, win: int = 252) -> list:
    """각 시점 값이 '직전 win일 분포에서 몇 %'인지 → 0~100. CNN과 같은 표준화 방식."""
    out = []
    for i, v in enumerate(series):
        if v is None:
            out.append(None)
            continue
        lo = max(0, i - win + 1)
        hist = [x for x in series[lo:i + 1] if x is not None]
        out.append(round(sum(1 for x in hist if x <= v) / len(hist) * 100, 1) if hist else None)
    return out


# 한국 합성 — (지표, 라벨, 방향). 방향 -1 = 값이 클수록 공포(뒤집어 점수화)
KR_PARTS = [
    ("adr", "등락 비율(ADR)", "오른 종목이 내린 종목보다 많은가", +1),
    ("ma50", "50일선 상회 비율", "50일 이평 위에 있는 종목 비율", +1),
    ("hi52", "52주 신고가 비율", "신고가를 새로 쓴 종목 비율", +1),
    ("lo52", "52주 신저가 비율", "신저가로 떨어진 종목 비율(많을수록 공포)", -1),
    ("rv20", "실현 변동성", "지수 20일 변동성(클수록 공포)", -1),
    ("ddmed", "체감 낙폭", "52주 고점 대비 낙폭 중앙값(깊을수록 공포)", +1),
    ("mcc", "시장폭 모멘텀", "McClellan — 확산이 개선되는가", +1),
]


def build_kr() -> dict:
    """우리 breadth 지표로 만든 한국판 공포·탐욕(0=극단적 공포 · 100=극단적 탐욕)."""
    mp_path = ROOT / "app" / "data" / "market_pro.json"
    if not mp_path.exists():
        return {}
    bh = (json.loads(mp_path.read_text(encoding="utf-8")).get("breadth_hist") or {}).get("kr") or {}
    t = bh.get("t") or []
    if len(t) < 60:
        return {}
    parts, stacks = [], []
    for kid, label, note, sign in KR_PARTS:
        raw = bh.get(kid)
        if not raw:
            continue
        vals = [(v * sign if v is not None else None) for v in raw]
        pct = _pctile(vals)
        stacks.append(pct)
        parts.append({"id": kid, "label": label, "note": note,
                      "score": pct[-1], "raw": raw[-1],
                      "series": [{"t": t[i], "v": pct[i]} for i in range(len(t)) if pct[i] is not None][-260:]})
    if not stacks:
        return {}
    comp = []
    for i in range(len(t)):
        got = [s[i] for s in stacks if s[i] is not None]
        comp.append(round(sum(got) / len(got), 1) if got else None)
    last = next((c for c in reversed(comp) if c is not None), None)
    rating = ("extreme fear" if last < 25 else "fear" if last < 45 else
              "neutral" if last < 55 else "greed" if last < 75 else "extreme greed")
    return {"score": last, "rating": rating, "parts": parts,
            "hist": [{"t": t[i], "v": comp[i]} for i in range(len(t)) if comp[i] is not None][-500:]}


def main() -> None:
    out = {"generated": datetime.now(KST).strftime("%Y-%m-%d %H:%M")}
    prev = {}
    if OUT.exists():
        try:
            prev = json.loads(OUT.read_text(encoding="utf-8"))
        except Exception:
            prev = {}
    try:
        out["us"] = fetch_us()
        print(f"  US 공포·탐욕 {out['us']['score']} ({out['us']['rating']}) · "
              f"풋콜 {out['us']['putcall']['last']} · 구성 {len(out['us']['parts'])}종")
    except Exception as e:
        print(f"  CNN 실패({e}) — 기존 값 보존", file=sys.stderr)
        if prev.get("us"):
            out["us"] = prev["us"]
    try:
        kr = build_kr()
        if kr:
            out["kr"] = kr
            print(f"  KR 합성 심리 {kr['score']} ({kr['rating']}) · 구성 {len(kr['parts'])}종")
        elif prev.get("kr"):
            out["kr"] = prev["kr"]
    except Exception as e:
        print(f"  KR 합성 실패({e})", file=sys.stderr)
        if prev.get("kr"):
            out["kr"] = prev["kr"]
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"완료: sentiment.json ({OUT.stat().st_size // 1024}KB)")


if __name__ == "__main__":
    main()

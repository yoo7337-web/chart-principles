# -*- coding: utf-8 -*-
"""실전 기능 공통 헬퍼: 활성 원칙 세트(최종 선정 + 국면 전용) 로드, 국면 게이팅, 신호 중복 제거."""
import json
from pathlib import Path

import numpy as np

from rules import ALL_RULES

ROOT = Path(__file__).resolve().parent.parent
APP_DATA = ROOT / "app" / "data"

# 분석 코어 유니버스 크기 (KR 대형주 상위) — 히트맵·시장폭·로테이션·원칙은 코어만,
# 종목조회·내재가치·오늘의신호는 전체(코스피+코스닥 ~800) 사용
ANALYSIS_KR = 300


def core_keys(data: dict, n_kr: int = ANALYSIS_KR) -> set:
    """분석 코어 = KR 거래대금(20일) 상위 n_kr + US 전체. data={(mk,tk):df}."""
    liq = {}
    for (mk, tk), df in data.items():
        if mk == "kr":
            liq[(mk, tk)] = float((df["close"] * df["volume"]).tail(20).mean())
    top_kr = sorted(liq, key=liq.get, reverse=True)[:n_kr]
    return set(top_kr) | {k for k in data if k[0] == "us"}


def core_data(data: dict, n_kr: int = ANALYSIS_KR) -> dict:
    """load_all() 결과를 분석 코어로 필터."""
    keep = core_keys(data, n_kr)
    return {k: v for k, v in data.items() if k in keep}

# 국면 게이팅: regimes.json general_profile의 재분류 문자열 → 꺼야 할 국면
_VERDICT_OFF = {
    "일반·하락장용 (급등장 회피)": "bull",
    "일반·급등장용 (하락장 회피)": "bear",
}


def load_ruleset() -> dict:
    """활성 원칙 로드 → {rule_id: {"rule": Rule, "scope": "general"|"bull"|"bear", "off_in": str|None}}

    - general: results.json의 selected 10개 (off_in = 국면 재분류상 회피해야 할 국면)
    - bull/bear: regimes.json picks의 국면 전용 원칙 (해당 국면에서만 active)
    """
    by_id = {r.id: r for r in ALL_RULES}
    out = {}

    results = json.loads((APP_DATA / "results.json").read_text(encoding="utf-8"))
    regimes_path = APP_DATA / "regimes.json"
    regimes = json.loads(regimes_path.read_text(encoding="utf-8")) if regimes_path.exists() else None

    off_map = {}
    if regimes:
        for p in regimes.get("general_profile", []):
            off_map[p["rule_id"]] = _VERDICT_OFF.get(p["verdict"])

    for r in results["rules"]:
        if r.get("selected") and r["rule_id"] in by_id:
            out[r["rule_id"]] = {"rule": by_id[r["rule_id"]], "scope": "general",
                                 "off_in": off_map.get(r["rule_id"])}

    if regimes:
        for key, scope in (("bull_buy", "bull"), ("bull_sell", "bull"),
                           ("bear_buy", "bear"), ("bear_sell", "bear")):
            for rid in regimes.get("picks", {}).get(key, []):
                if rid not in out and rid in by_id:
                    out[rid] = {"rule": by_id[rid], "scope": scope, "off_in": None}
    return out


def is_active(entry: dict, regime: str) -> bool:
    """해당 국면(bull/neutral/bear)에서 이 원칙을 켜야 하는가."""
    if entry["scope"] == "general":
        return entry["off_in"] != regime
    return entry["scope"] == regime


def dedupe_positions(mask: np.ndarray, gap: int = 5) -> list:
    """불리언 신호 배열에서 gap 미만 간격의 후속 신호 제거 (backtest와 동일 규칙)."""
    kept, last = [], -10**9
    for p in np.flatnonzero(mask):
        if p - last >= gap:
            kept.append(int(p))
            last = p
    return kept

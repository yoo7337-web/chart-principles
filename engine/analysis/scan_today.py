# -*- coding: utf-8 -*-
r"""오늘의 신호 스캐너: 캐시된 전 종목에서 최근 3영업일 신호 + 현재 국면 → app\data\today_signals.json

사용법:
    python analysis\collect.py --refresh   # 먼저 최신 데이터로 갱신
    python analysis\scan_today.py
"""
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from collect import load_all
from common import APP_DATA, ROOT, dedupe_positions, is_active, load_ruleset
from indicators import add_indicators
from regimes import regime_map

LOOKBACK = 3  # 최근 N영업일 신호만


def main():
    ruleset = load_ruleset()
    data = load_all()
    names_path = ROOT / "data" / "kr_names.json"
    kr_names = json.loads(names_path.read_text(encoding="utf-8")) if names_path.exists() else {}

    reg = regime_map(data)
    cur_regime = {}
    for mk, r in reg.items():
        valid = r[r != "na"]
        cur_regime[mk] = str(valid.iloc[-1]) if len(valid) else "neutral"
    print(f"현재 국면: {cur_regime}")

    # 원칙 패널: 현재 국면에서의 on/off (시장별)
    rule_panel = []
    for rid, entry in ruleset.items():
        rule_panel.append({
            "rule_id": rid, "name": entry["rule"].name, "side": entry["rule"].side,
            "desc": entry["rule"].desc, "scope": entry["scope"],
            "active_kr": is_active(entry, cur_regime["kr"]),
            "active_us": is_active(entry, cur_regime["us"]),
        })

    signals = []
    asof = None
    for (mk, tk), raw in data.items():
        d = add_indicators(raw)
        asof = max(asof or d.index[-1], d.index[-1])
        n = len(d)
        for rid, entry in ruleset.items():
            try:
                sig = entry["rule"].fn(d).to_numpy()
            except Exception:
                continue
            for p in dedupe_positions(sig):
                if p >= n - LOOKBACK:
                    signals.append({
                        "market": mk, "ticker": tk,
                        "name": kr_names.get(tk, tk) if mk == "kr" else tk,
                        "rule_id": rid, "rule": entry["rule"].name,
                        "side": entry["rule"].side,
                        "date": d.index[p].strftime("%Y-%m-%d"),
                        "price": round(float(d["close"].iloc[p]), 2),
                        "active": bool(is_active(entry, cur_regime[mk])),
                    })

    signals.sort(key=lambda x: (x["date"], x["market"], x["ticker"]), reverse=True)
    payload = {
        "generated": date.today().isoformat(),
        "asof": asof.strftime("%Y-%m-%d") if asof is not None else None,
        "lookback_days": LOOKBACK,
        "regime": cur_regime,
        "rules": rule_panel,
        "signals": signals,
    }
    out = APP_DATA / "today_signals.json"
    out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    n_act = sum(1 for s in signals if s["active"])
    print(f"신호 {len(signals)}건 (국면상 유효 {n_act}) → {out.name}")


if __name__ == "__main__":
    main()

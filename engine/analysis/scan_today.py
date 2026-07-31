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

from collect import load_all, load_research

MIN_STOCKS = 100   # 이 수보다 적으면 '수집이 덜 된 상태'로 보고 기존 결과를 보존한다
from common import APP_DATA, ROOT, dedupe_positions, is_active, load_ruleset
from indicators import add_indicators
from regimes import regime_map

LOOKBACK = 3     # 최근 N영업일 신호만 (화면에 뜨는 신호)
HIST_DAYS = 120  # 신호 상태(반전/최초/지속) 판정을 위해 되짚어 볼 기간


def main():
    ruleset = load_ruleset()
    data = load_research()  # 오늘의 신호 ≥750일 유지
    # 🐞⚠**데이터가 없으면 아무것도 쓰지 않는다.** 클라우드 캐시는 2년(≈520행)이라 ≥750행 게이트를
    #   통과하는 종목이 0개가 될 수 있는데(실사고 2026-07-31), 그대로 진행하면 '신호 0건' 빈 파일이
    #   기존 결과(1,192건)를 덮어써 화면이 텅 빈다. 수집 실패와 '신호가 없음'은 전혀 다른 상태다.
    if len(data) < MIN_STOCKS:
        print(f"[scan_today] 검증 가능 종목 {len(data)}개(<{MIN_STOCKS}) — 이력 부족으로 중단. "
              f"기존 today_signals.json을 보존합니다.", file=sys.stderr)
        return
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
        hist = []      # 이 종목의 최근 HIST_DAYS 신호 전부 (방향 판정용)
        for rid, entry in ruleset.items():
            try:
                sig = entry["rule"].fn(d).to_numpy()
            except Exception:
                continue
            act = bool(is_active(entry, cur_regime[mk]))
            for p in dedupe_positions(sig):
                if p < n - HIST_DAYS:
                    continue
                rec = {"pos": p, "side": entry["rule"].side, "rule": entry["rule"].name,
                       "date": d.index[p].strftime("%Y-%m-%d"), "active": act}
                hist.append(rec)
                if p >= n - LOOKBACK:
                    signals.append({
                        "market": mk, "ticker": tk,
                        "name": kr_names.get(tk, tk) if mk == "kr" else tk,
                        "rule_id": rid, "rule": entry["rule"].name,
                        "side": entry["rule"].side,
                        "date": rec["date"],
                        "price": round(float(d["close"].iloc[p]), 2),
                        "active": act,
                        "_pos": p,
                    })
        # ── 신호 상태 판정: 이번에 방향이 뒤집혔나 / 처음인가 / 계속 같은 방향인가 ──
        # ⚠**바(날짜) 단위 방향**으로 판정한다. 같은 날 여러 원칙이 매수·매도를 동시에 낼 수 있어
        #   (실측: WDC 07-15에 '이격도 과대낙폭' 매수 + '60일선 하향돌파' 매도 동시 발생)
        #   개별 신호를 그대로 이어 붙이면 정렬 순서에 따라 판정이 뒤집힌다.
        bars = {}
        for h in hist:
            b = bars.setdefault(h["pos"], {"buy": 0, "sell": 0, "date": h["date"]})
            b[h["side"]] += 1
        def bar_dir(p):
            b = bars[p]
            return "buy" if b["buy"] > b["sell"] else "sell" if b["sell"] > b["buy"] else "mixed"
        ordered = sorted(bars)
        for s in signals:
            if s["market"] != mk or s["ticker"] != tk:
                continue
            prior = [p for p in ordered if p < s["_pos"] and bar_dir(p) != "mixed"]
            last = prior[-1] if prior else None
            if last is None:
                s["status"] = "first"                    # 관측 기간 내 첫 신호
            elif bar_dir(last) != s["side"]:
                s["status"] = "flip"                     # 직전 신호일과 반대 → 방향 전환
            else:
                s["status"] = "repeat"                   # 같은 방향 반복
            s["prev_side"] = bar_dir(last) if last is not None else None
            s["prev_date"] = bars[last]["date"] if last is not None else None
            s["days_since"] = int(s["_pos"] - last) if last is not None else None
            # 같은 방향이 며칠(몇 회) 연속인지 — 반대 방향 바를 만나면 중단
            streak = 1
            for p in reversed(prior):
                if bar_dir(p) == s["side"]:
                    streak += 1
                else:
                    break
            s["streak"] = streak
            # 이 날짜에 매수·매도가 동시에 나왔는지(엇갈리는 신호 = 판단 유보 신호)
            s["conflict"] = bar_dir(s["_pos"]) == "mixed"
    for s in signals:
        s.pop("_pos", None)

    signals.sort(key=lambda x: (x["date"], x["market"], x["ticker"]), reverse=True)
    payload = {
        "generated": date.today().isoformat(),
        "asof": asof.strftime("%Y-%m-%d") if asof is not None else None,
        "lookback_days": LOOKBACK,
        "hist_days": HIST_DAYS,
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

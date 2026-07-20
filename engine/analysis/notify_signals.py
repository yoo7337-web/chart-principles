# -*- coding: utf-8 -*-
r"""보유종목 신호 알림: stock-radar의 holdings.yaml 종목에 최근 2영업일 신호가 있으면 텔레그램 발송.

사용법:
    python analysis\notify_signals.py --dry-run   # 콘솔 출력만
    python analysis\notify_signals.py             # 텔레그램 발송

환경변수: TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID (stock-radar와 동일 —
없으면 C:\Users\yoo73\stock-radar\.env 에서 자동 로드 시도)
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from collect import load_all, load_research, norm_ohlcv
from common import dedupe_positions, is_active, load_ruleset
from indicators import add_indicators
from regimes import regime_map

HOLDINGS = Path(r"C:\Users\yoo73\stock-radar\holdings.yaml")
ENV_FALLBACK = Path(r"C:\Users\yoo73\stock-radar\.env")
LOOKBACK = 2      # 최근 N영업일 신호
FETCH_DAYS = 400  # 지표 계산에 필요한 이력(MA120·52주 대비 여유)
REGIME_KO = {"bull": "🚀 급등장", "neutral": "일반장", "bear": "🐻 하락장"}


def load_env_fallback():
    if ENV_FALLBACK.exists():
        for line in ENV_FALLBACK.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def tg_send(text: str) -> bool:
    """텔레그램 발송 (stock-radar telegram.py 패턴: 4000자 분할 + 429 재시도)."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat = os.environ.get("TELEGRAM_CHANNEL_ID")
    if not token or not chat:
        print("TELEGRAM_BOT_TOKEN/TELEGRAM_CHANNEL_ID 없음 — 발송 불가", file=sys.stderr)
        return False
    chunks, cur = [], ""
    for line in text.split("\n"):
        if len(cur) + len(line) + 1 > 4000:
            chunks.append(cur)
            cur = line
        else:
            cur = f"{cur}\n{line}" if cur else line
    chunks.append(cur)
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    for chunk in chunks:
        body = urllib.parse.urlencode({"chat_id": chat, "text": chunk,
                                       "parse_mode": "HTML",
                                       "disable_web_page_preview": "true"}).encode()
        for attempt in range(3):
            try:
                urllib.request.urlopen(urllib.request.Request(url, data=body), timeout=20)
                break
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    time.sleep(int(e.headers.get("Retry-After", 5)) + 1)
                    continue
                print(f"텔레그램 실패: {e}", file=sys.stderr)
                return False
        time.sleep(0.5)
    return True


def fetch_holding(mk: str, tk: str) -> pd.DataFrame | None:
    start = (date.today() - timedelta(days=FETCH_DAYS * 2)).strftime("%Y%m%d")
    today = date.today().strftime("%Y%m%d")
    try:
        if mk == "kr":
            from pykrx import stock
            raw = stock.get_market_ohlcv(start, today, tk)
            if raw is None or raw.empty:
                return None
            raw = raw.rename(columns={"시가": "open", "고가": "high", "저가": "low",
                                      "종가": "close", "거래량": "volume"})
            return norm_ohlcv(raw)
        import yfinance as yf
        raw = yf.download(tk, period="2y", auto_adjust=True, progress=False)
        if raw is None or raw.empty:
            return None
        if isinstance(raw.columns, pd.MultiIndex):
            raw.columns = raw.columns.get_level_values(0)
        return norm_ohlcv(raw.rename(columns=str.lower).dropna(subset=["close"]))
    except Exception as e:
        print(f"  {mk}/{tk} 수집 실패: {e}", file=sys.stderr)
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="콘솔 출력만, 발송 안 함")
    args = ap.parse_args()

    import yaml
    if not HOLDINGS.exists():
        print(f"보유종목 파일 없음: {HOLDINGS} — stock-radar 프로젝트 확인", file=sys.stderr)
        sys.exit(1)
    holdings = yaml.safe_load(HOLDINGS.read_text(encoding="utf-8"))["holdings"]
    print(f"보유종목 {len(holdings)}개 로드")

    # 현재 국면은 유니버스 캐시로 판정 (보유종목 데이터와 무관)
    reg = regime_map(load_research())  # 국면 판정 ≥750일 유지
    cur = {mk: (str(r[r != "na"].iloc[-1]) if len(r[r != "na"]) else "neutral")
           for mk, r in reg.items()}

    ruleset = load_ruleset()
    lines_by_stock = []
    for h in holdings:
        mk = h["market"].lower()
        tk = str(h["ticker"])
        df = fetch_holding(mk, tk)
        if df is None or len(df) < 150:
            continue
        d = add_indicators(df)
        hits = []
        for rid, entry in ruleset.items():
            try:
                sig = entry["rule"].fn(d).to_numpy()
            except Exception:
                continue
            for p in dedupe_positions(sig):
                if p >= len(d) - LOOKBACK:
                    on = is_active(entry, cur[mk])
                    icon = "🟢" if entry["rule"].side == "buy" else "🔴"
                    gate = "" if on else " (현 국면에선 참고만)"
                    hits.append(f"  {icon} {entry['rule'].name} · {d.index[p].strftime('%m/%d')} "
                                f"종가 {d['close'].iloc[p]:,.0f}{gate}")
        if hits:
            lines_by_stock.append(f"<b>{h['name']}</b> ({tk})\n" + "\n".join(hits))
        time.sleep(0.3)

    if not lines_by_stock:
        print("최근 2영업일 신호 없음 — 발송 생략")
        return

    msg = (f"📈 <b>[차트신호] 보유종목 알림</b> · {date.today().strftime('%m/%d')}\n"
           f"국면: 🇰🇷 {REGIME_KO[cur['kr']]} · 🇺🇸 {REGIME_KO[cur['us']]}\n\n"
           + "\n\n".join(lines_by_stock)
           + "\n\n<i>검증 원칙 기반 참고 신호이며 매매 권유가 아님</i>")

    if args.dry_run:
        print("--- DRY RUN (발송 안 함) ---")
        print(msg)
        return
    load_env_fallback()
    if tg_send(msg):
        print(f"텔레그램 발송 완료 ({len(lines_by_stock)}종목)")


if __name__ == "__main__":
    main()

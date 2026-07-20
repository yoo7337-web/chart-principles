# -*- coding: utf-8 -*-
r"""데이터 수집: 한국(KOSPI 시총상위 200, pykrx) + 미국(대형주 100, yfinance) 일봉 10년 → data\*.parquet 캐시.

사용법:
    python analysis\collect.py           # 전체 수집 (캐시 있으면 최신분만 확인 후 스킵)
    python analysis\collect.py --quick   # 파이프라인 검증용 소수 종목(KR 10 + US 10)
    python analysis\collect.py --force   # 캐시 무시 전체 재수집
"""
import argparse
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
START = "2016-01-01"
MIN_ROWS = 750  # 원칙 연구 게이트(≥3년) — load_research()에서 적용
MIN_ROWS_COLLECT = 20  # 수집 바닥값 — 신규상장·소형주도 수집(주식찾기·마켓현황·종목조회용). c5는 ≥6행 필요

# 미국 대형주 100 (S&P500 시총 상위 + 나스닥 대표주, 2026 기준 고정 리스트)
US_TICKERS = [
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "AVGO", "TSLA", "BRK-B", "LLY",
    "JPM", "V", "XOM", "UNH", "MA", "COST", "HD", "PG", "WMT", "NFLX",
    "JNJ", "CRM", "BAC", "ORCL", "ABBV", "CVX", "MRK", "KO", "AMD", "PEP",
    "ADBE", "TMO", "LIN", "WFC", "CSCO", "ACN", "MCD", "ABT", "PM", "IBM",
    "GE", "TXN", "QCOM", "INTU", "DHR", "AMGN", "VZ", "CAT", "NOW", "DIS",
    "PFE", "SPGI", "NEE", "UBER", "RTX", "CMCSA", "AMAT", "UNP", "LOW", "GS",
    "HON", "T", "BKNG", "ISRG", "ELV", "AXP", "SYK", "LMT", "TJX", "BLK",
    "MS", "COP", "VRTX", "MDT", "REGN", "PLD", "SBUX", "CB", "ETN", "ADP",
    "MMC", "CI", "LRCX", "BA", "MU", "PANW", "ADI", "GILD", "DE", "BMY",
    "SO", "KLAC", "MDLZ", "SCHW", "ANET", "DUK", "TMUS", "INTC", "SHOP", "PYPL",
]


def norm_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    """컬럼을 open/high/low/close/volume 소문자로 표준화, date 인덱스."""
    df = df.copy()
    df.index = pd.to_datetime(df.index).tz_localize(None)
    df.index.name = "date"
    df = df[["open", "high", "low", "close", "volume"]].astype("float64")
    df = df[(df["close"] > 0) & (df["volume"] >= 0)].sort_index()
    return df[~df.index.duplicated(keep="last")]


def cache_fresh(path: Path, days: int = 7) -> bool:
    if not path.exists():
        return False
    try:
        idx = pd.read_parquet(path, columns=[]).index
        return len(idx) > 0 and idx.max() >= pd.Timestamp(date.today() - timedelta(days=days))
    except Exception:
        return False


ETF_PAT = ("KODEX", "TIGER", "PLUS ", "ACE ", "SOL ", "RISE ", "HANARO", "KIWOOM",
           "KOSEF", "WON ", "ETN", "레버리지", "인버스", "선물", "채권", "액티브")


def _scrape_sise(sosok: int, want: int) -> list:
    """네이버 시총 페이지에서 (code, name) 상위 want개 (ETF 제외). sosok=0 코스피/1 코스닥."""
    import re
    import urllib.request

    out = []
    seen = set()
    for page in range(1, 40):  # 50종목/페이지
        url = f"https://finance.naver.com/sise/sise_market_sum.naver?sosok={sosok}&page={page}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        html = urllib.request.urlopen(req, timeout=15).read().decode("euc-kr", "ignore")
        found = re.findall(r'/item/main\.naver\?code=(\d{6})"[^>]*>([^<]+)</a>', html)
        if not found:
            break
        for code, name in found:
            name = name.strip()
            if code in seen or any(p in name for p in ETF_PAT):
                continue
            seen.add(code)
            out.append((code, name))
        if len(out) >= want:
            break
        time.sleep(0.25)
    return out[:want]


def kr_universe(kospi_n: int = 500, kosdaq_n: int = 300) -> dict:
    """코스피 상위 kospi_n + 코스닥 상위 kosdaq_n 종목 → {code: name}.
    kr_names.json(전체) + kr_universe.json(market·mcap_rank 티어) 저장.
    (KRX 목록 API가 로그인 요구로 차단되어 네이버 시총 페이지 스크래핑으로 우회)"""
    import json

    kospi = _scrape_sise(0, kospi_n)
    kosdaq = _scrape_sise(1, kosdaq_n)
    names, universe = {}, {}
    for market, rows in (("KOSPI", kospi), ("KOSDAQ", kosdaq)):
        for rank, (code, name) in enumerate(rows, 1):
            names[code] = name
            universe[code] = {"name": name, "market": market, "mcap_rank": rank}
    (DATA_DIR / "kr_names.json").write_text(
        json.dumps(names, ensure_ascii=False, indent=1), encoding="utf-8")
    (DATA_DIR / "kr_universe.json").write_text(
        json.dumps(universe, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[KR] 유니버스: 코스피 {len(kospi)} + 코스닥 {len(kosdaq)} = {len(names)}종목")
    return names


def collect_kr(quick: bool, force: bool) -> int:
    from pykrx import stock

    today = date.today().strftime("%Y%m%d")
    names = kr_universe()
    tickers = list(names)
    if quick:
        tickers = tickers[:10]
    print(f"[KR] 코스피+코스닥 {len(tickers)}종목 수집 시작")
    ok = 0
    for i, t in enumerate(tickers, 1):
        path = DATA_DIR / f"kr_{t}.parquet"
        if not force and cache_fresh(path):
            ok += 1
            continue
        try:
            raw = stock.get_market_ohlcv("20160101", today, t)
            if raw is None or raw.empty:
                continue
            raw = raw.rename(columns={"시가": "open", "고가": "high", "저가": "low",
                                      "종가": "close", "거래량": "volume"})
            df = norm_ohlcv(raw)
            if len(df) < MIN_ROWS_COLLECT:  # 수집 바닥값(원칙 게이트는 load_research에서)
                continue
            df.to_parquet(path)
            ok += 1
        except Exception as e:
            print(f"  [KR] {t} 실패: {e}", file=sys.stderr)
        if i % 20 == 0:
            print(f"  [KR] {i}/{len(tickers)}")
        time.sleep(0.3)  # pykrx 서버 부하 방지
    print(f"[KR] 완료: {ok}종목")
    return ok


def collect_us(quick: bool, force: bool) -> int:
    import yfinance as yf

    tickers = US_TICKERS[:10] if quick else US_TICKERS
    todo = [t for t in tickers if force or not cache_fresh(DATA_DIR / f"us_{t.replace('-', '_')}.parquet")]
    done = len(tickers) - len(todo)
    print(f"[US] {len(tickers)}종목 중 {len(todo)}종목 수집 (캐시 {done})")
    ok = done
    if not todo:
        return ok
    raw = yf.download(todo, start=START, group_by="ticker", auto_adjust=True,
                      threads=True, progress=False)
    for t in todo:
        try:
            sub = raw[t] if len(todo) > 1 else raw
            sub = sub.rename(columns=str.lower)
            df = norm_ohlcv(sub.dropna(subset=["close"]))
            if len(df) < MIN_ROWS:
                print(f"  [US] {t} 데이터 부족({len(df)}행) 제외")
                continue
            df.to_parquet(DATA_DIR / f"us_{t.replace('-', '_')}.parquet")
            ok += 1
        except Exception as e:
            print(f"  [US] {t} 실패: {e}", file=sys.stderr)
    print(f"[US] 완료: {ok}종목")
    return ok


def load_all() -> dict:
    """캐시된 전 종목 로드 → {(market, ticker): DataFrame}. 다른 모듈에서 사용.
    (macro.parquet 등 비종목 캐시는 제외 — kr_/us_ 접두사만)"""
    out = {}
    for p in sorted(DATA_DIR.glob("kr_*.parquet")) + sorted(DATA_DIR.glob("us_*.parquet")):
        market, ticker = p.stem.split("_", 1)
        out[(market, ticker)] = pd.read_parquet(p)
    return out


def load_research(min_rows: int = MIN_ROWS) -> dict:
    """원칙 연구용 로드 — 이력 부족(<750행) 종목 제외. load_all()의 부분집합.
    (results/regimes/apply/simulation/오늘의신호 등 10년 귀납검증은 이 게이트 유지)"""
    return {k: v for k, v in load_all().items() if len(v) >= min_rows}


def _append_new(path: Path, new: pd.DataFrame) -> int:
    """캐시 parquet 병합 — 겹치는 날짜는 새 데이터로 갱신(잠정 장중 봉의 확정치 보정).

    ⚠append-only였을 때의 실사고(2026-07-17): 24시간 클라우드가 장중에 처음 잡은 봉이
    영구 동결됨(GOOGL 07-16 372.11 vs 실제 종가 354.46). 겹침 구간은 항상 새 fetch가 이김.
    """
    if new.empty:
        return 0
    old = pd.read_parquet(path)
    kept = old[old.index < new.index.min()]
    merged = pd.concat([kept, new]).sort_index()
    merged = merged[~merged.index.duplicated(keep="last")]
    changed = len(merged) - len(old)
    merged.to_parquet(path)
    return max(changed, 0)


def refresh_all() -> None:
    """일일 증분 갱신(~2분): 캐시된 전 종목의 마지막 날짜 이후만 fetch·append.

    주의: US는 auto_adjust 가격이라 분할/배당 발생 종목은 과거와 어긋날 수 있음 →
    주 1회 `--force` 전체 재수집 권장(CLAUDE.md).
    """
    import yfinance as yf
    from pykrx import stock

    today = date.today().strftime("%Y%m%d")

    us_paths = sorted(DATA_DIR.glob("us_*.parquet"))
    if us_paths:
        tickers = [p.stem[3:].replace("_", "-") for p in us_paths]
        raw = yf.download(tickers, period="1mo", group_by="ticker", auto_adjust=True,
                          threads=True, progress=False)
        added = 0
        for p, t in zip(us_paths, tickers):
            try:
                sub = raw[t] if len(tickers) > 1 else raw
                new = norm_ohlcv(sub.rename(columns=str.lower).dropna(subset=["close"]))
                added += _append_new(p, new)
            except Exception as e:
                print(f"  [US] {t} 갱신 실패: {e}", file=sys.stderr)
        print(f"[US] 증분 갱신 완료: +{added}행")

    kr_paths = sorted(DATA_DIR.glob("kr_*.parquet"))
    added, fail = 0, 0
    for i, p in enumerate(kr_paths, 1):
        t = p.stem[3:]
        try:
            last = pd.read_parquet(p, columns=[]).index.max()
            frm = (last - pd.Timedelta(days=3)).strftime("%Y%m%d")
            raw = stock.get_market_ohlcv(frm, today, t)
            if raw is None or raw.empty:
                continue
            raw = raw.rename(columns={"시가": "open", "고가": "high", "저가": "low",
                                      "종가": "close", "거래량": "volume"})
            added += _append_new(p, norm_ohlcv(raw))
        except Exception as e:
            fail += 1
            print(f"  [KR] {t} 갱신 실패: {e}", file=sys.stderr)
        if i % 50 == 0:
            print(f"  [KR] {i}/{len(kr_paths)}")
        time.sleep(0.2)
    print(f"[KR] 증분 갱신 완료: +{added}행 (실패 {fail})")


def collect_cloud() -> None:
    """클라우드(GitHub Actions)용 경량 수집 — 코어 유니버스(코스피300+코스닥150+US) × 최근 2년.
    캐시(actions/cache) 있으면 refresh만, 없으면 2년치 신규 수집. 마켓 대시보드용(히트맵·시장폭)."""
    from datetime import date as _date

    import yfinance as yf
    from pykrx import stock

    start_kr = (_date.today() - timedelta(days=760)).strftime("%Y%m%d")  # ~2년(지표 여유)
    start_us = (_date.today() - timedelta(days=760)).strftime("%Y-%m-%d")
    today = _date.today().strftime("%Y%m%d")
    names = kr_universe(kospi_n=500, kosdaq_n=300)  # 1단계 800 전체(주식찾기·마켓현황용)

    # US
    todo = [t for t in US_TICKERS if not cache_fresh(DATA_DIR / f"us_{t.replace('-', '_')}.parquet")]
    if todo:
        raw = yf.download(todo, start=start_us,
                          group_by="ticker", auto_adjust=True, threads=True, progress=False)
        for t in todo:
            try:
                sub = raw[t] if len(todo) > 1 else raw
                df = norm_ohlcv(sub.rename(columns=str.lower).dropna(subset=["close"]))
                if len(df) >= 200:
                    df.to_parquet(DATA_DIR / f"us_{t.replace('-', '_')}.parquet")
            except Exception:
                pass
    # KR
    ok = 0
    for i, t in enumerate(names, 1):
        path = DATA_DIR / f"kr_{t}.parquet"
        if cache_fresh(path):
            ok += 1
            continue
        try:
            raw = stock.get_market_ohlcv(start_kr, today, t)
            if raw is None or raw.empty:
                continue
            raw = raw.rename(columns={"시가": "open", "고가": "high", "저가": "low",
                                      "종가": "close", "거래량": "volume"})
            df = norm_ohlcv(raw)
            if len(df) >= MIN_ROWS_COLLECT:  # 수집 바닥값(신규상장 포함)
                df.to_parquet(path)
                ok += 1
        except Exception as e:
            print(f"  [KR] {t} 실패: {e}", file=sys.stderr)
        if i % 50 == 0:
            print(f"  [cloud KR] {i}/{len(names)}")
        time.sleep(0.2)
    print(f"[cloud] 수집 완료: US + KR {ok}종목 (2년)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true", help="소수 종목만(파이프라인 검증용)")
    ap.add_argument("--force", action="store_true", help="캐시 무시 재수집")
    ap.add_argument("--us-only", action="store_true")
    ap.add_argument("--kr-only", action="store_true")
    ap.add_argument("--refresh", action="store_true", help="일일 증분 갱신(마지막 날짜 이후만, ~2분)")
    ap.add_argument("--cloud", action="store_true", help="클라우드용 경량(코어 2년) 수집+증분")
    args = ap.parse_args()

    DATA_DIR.mkdir(exist_ok=True)
    if args.cloud:
        collect_cloud()
        refresh_all()  # 캐시가 오래됐으면 마지막 날짜 이후 채움
        return
    if args.refresh:
        refresh_all()
        return
    if not args.kr_only:
        collect_us(args.quick, args.force)
    if not args.us_only:
        collect_kr(args.quick, args.force)
    print(f"총 캐시 파일: {len(list(DATA_DIR.glob('*.parquet')))}개")


if __name__ == "__main__":
    main()

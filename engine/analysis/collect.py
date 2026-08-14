# -*- coding: utf-8 -*-
r"""데이터 수집: 한국(KOSPI 시총상위 200, pykrx) + 미국(대형주 100, yfinance) 일봉 10년 → data\*.parquet 캐시.

사용법:
    python analysis\collect.py           # 전체 수집 (캐시 있으면 최신분만 확인 후 스킵)
    python analysis\collect.py --quick   # 파이프라인 검증용 소수 종목(KR 10 + US 10)
    python analysis\collect.py --force   # 캐시 무시 전체 재수집
"""
import argparse
import json
import os
import sys
import re
import time
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
START = "2016-01-01"
MIN_ROWS = 750  # 원칙 연구 게이트(≥3년) — load_research()에서 적용
MIN_ROWS_COLLECT = 20  # 수집 바닥값 — 신규상장·소형주도 수집(주식찾기·마켓현황·종목조회용). c5는 ≥6행 필요

# 미국 대형·인기주 큐레이션 — **US_CORE**(무거운 소비자 전용) 겸 유니버스 폴백.
#  ⚠v358에서 유니버스를 S&P500+나스닥100(~600)으로 넓혔지만, 아래 소비자는 종목당 비용이 커서
#    전체로 돌리면 안 된다 → `US_CORE`를 쓴다:
#    ·intraday(분봉): 138종목에 일 4.7MB — 600이면 연 4GB대로 repo가 무너진다
#    ·biz_deep(SEC 10-K 발췌): 종목당 수 MB 파싱 + UA 제한
#  전체 유니버스가 필요한 곳(가격·히트맵·종목조회·주식찾기·company/feed/financials)은 US_TICKERS.
US_CURATED = [
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
    # 확장(2026-07): 인기 성장·테마·중형주
    "PLTR", "COIN", "MSTR", "SMCI", "MRVL", "SNOW", "CRWD", "DDOG", "NET", "ABNB",
    "RBLX", "HOOD", "SOFI", "DASH", "RIVN", "LCID", "AFRM", "ROKU", "PINS", "SNAP",
    "PLUG", "F", "GM", "NKE", "CMG", "MAR", "DAL", "CCL", "ARM", "DELL",
    "WDC", "ON", "ENPH", "FSLR", "CVNA", "DKNG", "ZS", "TTD",
]
US_CURATED = list(dict.fromkeys(US_CURATED))  # 중복 제거(순서 보존)
US_UNIVERSE_FILE = DATA_DIR / "us_universe.json"


def us_universe(refresh: bool = False) -> dict:
    """미국 유니버스 = S&P500 + 나스닥100 + 큐레이션 → {ticker: {name, src}} (v358).

    ⚠미국엔 pykrx 같은 목록 API가 없다 → 위키피디아 구성종목 표를 읽는다(무키·안정적).
      나스닥100은 본문 페이지에서 표가 빠졌고 `List_of_NASDAQ-100_companies`에 있다(실측).
    ⚠**실패 시 기존 파일을 보존**한다(네트워크 결과로 덮어쓸 때는 병합이 기본 — CLAUDE.md 교훈).
      두 소스가 다 실패하고 캐시도 없으면 큐레이션만으로 돌아간다(사이트가 죽지 않게)."""
    old = {}
    if US_UNIVERSE_FILE.exists():
        try:
            old = json.loads(US_UNIVERSE_FILE.read_text(encoding="utf-8")).get("map", {})
        except Exception:
            old = {}
    if old and not refresh:
        return old

    import io
    import urllib.request

    def wiki_table(url: str, sym_cols=("symbol", "ticker"), name_cols=("security", "company", "name")):
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"})
        html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "ignore")
        tables = pd.read_html(io.StringIO(html))
        cands = [t for t in tables if any(str(c).lower() in sym_cols for c in t.columns)]
        if not cands:
            raise RuntimeError("구성종목 표를 찾지 못함(위키 구조 변경 가능)")
        t = max(cands, key=len)
        scol = [c for c in t.columns if str(c).lower() in sym_cols][0]
        ncol = next((c for c in t.columns if str(c).lower() in name_cols), None)
        out = {}
        for _, row in t.iterrows():
            tk = str(row[scol]).strip().upper()
            if not re.fullmatch(r"[A-Z][A-Z.\-]{0,6}", tk):
                continue
            out[tk.replace(".", "-")] = str(row[ncol]).strip() if ncol else tk   # BRK.B → BRK-B(yfinance 표기)
        return out

    new = {}
    for src, url in (("sp500", "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"),
                     ("ndx100", "https://en.wikipedia.org/wiki/List_of_NASDAQ-100_companies")):
        try:
            got = wiki_table(url)
            for tk, nm in got.items():
                new.setdefault(tk, {"name": nm, "src": []})["src"].append(src)
            print(f"  [US uni] {src} {len(got)}종목")
        except Exception as e:
            print(f"  [US uni] {src} 실패({e}) — 이 소스 생략", file=sys.stderr)
    for tk in US_CURATED:
        new.setdefault(tk, {"name": tk, "src": []})["src"].append("curated")

    # 지수 소스가 전부 실패하면 기존 캐시(또는 큐레이션)를 그대로 쓴다 — 유니버스가 줄어드는 사고 방지
    if not any("sp500" in v["src"] or "ndx100" in v["src"] for v in new.values()):
        if old:
            print("  [US uni] 지수 소스 실패 — 기존 캐시 유지", file=sys.stderr)
            return old
        print("  [US uni] 지수 소스 실패 — 큐레이션만 사용", file=sys.stderr)
        return new
    # 기존 유니버스는 **지우지 않는다**(상장폐지·지수 편출도 이력을 유지 — 종목조회에서 계속 조회 가능)
    merged = {**old, **new}
    US_UNIVERSE_FILE.write_text(json.dumps(
        {"generated": date.today().isoformat(), "map": merged}, ensure_ascii=False), encoding="utf-8")
    print(f"  [US uni] 총 {len(merged)}종목 (신규 {len(set(new) - set(old))})")
    return merged


US_TICKERS = list(us_universe().keys()) or US_CURATED   # 전체 유니버스(가격·화면용)
US_CORE = US_CURATED                                    # 무거운 소비자용(분봉·SEC 발췌)


def norm_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    """컬럼을 open/high/low/close/volume 소문자로 표준화, date 인덱스.

    🐞💀**거래정지·무거래일 보정(2026-08-08)**: 국내 소스(pykrx·FDR 모두 네이버 기반)는 거래가 없는 날을
      `시가=고가=저가=0 · 거래량=0 · 종가=전일 종가`로 준다. 이걸 그대로 두면 캔들이 **0에서 종가까지
      그려져 화면을 가로지르는 긴 막대**가 된다(사용자 제보 — 실측 749종목·최다 1,433행).
      더 나쁜 것은 **지표 오염**이다: 저가 0이 스토캐스틱·고저 기반 계산에 그대로 들어간다.
    → 종가는 살아 있으므로 **시가·고가·저가를 종가로 맞춘다**(거래가 없었으니 가격 변동도 없다).
      결과는 위아래 꼬리가 없는 평평한 봉 = 화면에서 점처럼 보인다.
    ⚠종가까지 0인 행은 기존처럼 버린다(가격을 만들어낼 근거가 없다).
    """
    df = df.copy()
    df.index = pd.to_datetime(df.index).tz_localize(None)
    df.index.name = "date"
    df = df[["open", "high", "low", "close", "volume"]].astype("float64")
    df = df[(df["close"] > 0) & (df["volume"] >= 0)].sort_index()
    flat = df[["open", "high", "low"]].le(0).any(axis=1) | df[["open", "high", "low"]].isna().any(axis=1)
    if flat.any():
        for c in ("open", "high", "low"):
            df.loc[flat, c] = df.loc[flat, "close"]
    return df[~df.index.duplicated(keep="last")]


def save_parquet(df: pd.DataFrame, path: Path) -> None:
    """임시 파일에 쓴 뒤 원자적 교체 — 배치 강제종료·동시 실행이 파일을 반토막 내지 않게.
    (2026-08-07 실사고: 잘린 parquet 5개가 load_all()을 크래시시켜 market_dash가 24시간 정지)"""
    tmp = path.with_name(path.name + ".tmp")
    df.to_parquet(tmp)
    os.replace(tmp, path)


def _limit_viol(df: pd.DataFrame, lim: float = 0.31,
                start: str = "2015-06-15") -> int:
    """KR 가격제한폭(±30%, 2015-06-15 시행)을 넘는 일간 변동 행 수.

    실제로 제한폭을 넘을 수 있는 건 신규상장·거래재개·액면분할 기준일뿐이라 **정상 종목은 한 자릿수**다
    (실측: 정상 61종목의 위반 합계가 76일, 최다 4일). 두 자릿수를 넘으면 조정 기준이 섞인 것이다.
    """
    try:
        c = df.loc[df.index >= pd.Timestamp(start), "close"].astype("float64")
        return int((c.pct_change().abs() > lim).sum())
    except Exception:
        return 0


def save_merge(df: pd.DataFrame, path: Path) -> None:
    """기존 parquet과 **병합** 후 원자적 저장(겹치는 날짜는 새 수집이 이김).

    ⚠전체 재수집(`--force`)이 `save_parquet`으로 통째로 덮어쓰면 **수집 시작일(START) 이전 이력이
      영구히 사라진다**. 2026-08-08에 US를 상장일부터(J&J 1962년) 재수집해 놓고 보니, 주 1회 권장인
      `--force`가 다음 실행에서 그걸 2016년으로 잘라낼 구조였다.
    ⚠겹치는 구간은 새 값이 이겨야 한다 — `--force`의 목적 자체가 **미국 수정주가 드리프트 교정**이다.
      (financials·supply·ECOS·오늘의신호에서 반복해 배운 규칙: **네트워크 결과로 덮어쓸 땐 병합이 기본값**)
    """
    if path.exists():
        try:
            old = pd.read_parquet(path)
            merged = pd.concat([old, df]).sort_index()
            merged = merged[~merged.index.duplicated(keep="last")]
            # 🐞💀**병합이 조정 기준을 섞는다**(2026-08-14 실사고): 부분 수집이 반복되면 새 수집에 없는
            #   날짜의 옛 행이 **옛 조정 기준 그대로** 살아남아, 한 파일 안에 액면분할 전/후 가격이
            #   무작위로 섞인다(실측 16종목 · 동성제약은 3,005행 중 972행이 ±30% 제한폭 위반).
            #   거래량은 정상이라 눈에 안 띄고, 이벤트 스터디의 **평균을 통째로 왜곡**했다
            #   (KR 초과수익 +9% → +28%가 이 꼬리 때문이었다).
            # → 병합본이 새 수집본보다 제한폭 위반이 많으면 **병합을 포기하고 새 수집만** 쓴다.
            if path.name.startswith("kr_"):
                v_new, v_mrg = _limit_viol(df), _limit_viol(merged)
                if v_mrg > max(5, v_new + 5):
                    print(f"  ⚠{path.name}: 병합 시 제한폭 위반 {v_new}→{v_mrg}일 — 조정 기준 혼입으로 보고 "
                          f"병합 포기(새 수집 {len(df)}행만 사용)", file=sys.stderr)
                    merged = df
            df = merged
        except Exception as e:                      # 손상 파일이면 새 수집으로 대체(자가 치유)
            print(f"  기존 파일 병합 실패({path.name}: {e}) — 새 수집으로 대체", file=sys.stderr)
    save_parquet(df, path)


def cache_fresh(path: Path, days: int = 7) -> bool:
    if not path.exists():
        return False
    try:
        idx = pd.read_parquet(path, columns=[]).index
        return len(idx) > 0 and idx.max() >= pd.Timestamp(date.today() - timedelta(days=days))
    except Exception:
        return False


# 스팩(SPAC)·우선주 판별 — 이름 기준(코드 체계로는 구분이 어렵다)
SKIP_RE = re.compile(r"스팩|제\d+호|우[BC]?$|\d우$")

ETF_PAT = ("KODEX", "TIGER", "PLUS ", "ACE ", "SOL ", "RISE ", "HANARO", "KIWOOM",
           "KOSEF", "WON ", "ETN", "레버리지", "인버스", "선물", "채권", "액티브")


def _scrape_sise(sosok: int, want: int) -> list:
    """네이버 시총 페이지에서 (code, name) 상위 want개 (ETF 제외). sosok=0 코스피/1 코스닥."""
    import re
    import urllib.request

    out = []
    seen = set()
    for page in range(1, 60):  # 50종목/페이지 (전 상장 ~1,800종목 → 코스닥 37p 필요)
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
            # v216 전 상장 확장: 스팩(합병 전 껍데기)·우선주는 분석 대상이 아니라 제외한다.
            #   실측 미포함 1,449종목 중 스팩 41 + 우선주 24 = 65종목(4.5%)뿐이라 손실은 작고
            #   대신 신호·수급·재무 분석이 무의미한 종목이 유니버스를 오염시키는 것을 막는다.
            if SKIP_RE.search(name):
                continue
            seen.add(code)
            out.append((code, name))
        if len(out) >= want:
            break
        time.sleep(0.25)
    return out[:want]


def kr_universe(kospi_n: int = 1200, kosdaq_n: int = 2200) -> dict:
    """코스피 상위 kospi_n + 코스닥 상위 kosdaq_n 종목 → {code: name}.
    v216: **전 상장 종목**(스팩·우선주·ETF 제외 ≈2,580)으로 확장 — 기본값을 실제 상장수보다 크게 잡아
    스크래핑이 끝까지 훑게 한다(신규 상장이 늘어도 자동 포함).
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
            save_merge(df, path)   # ⚠병합 — 무료 소스 상한(3,000행) 이전 이력을 지우지 않는다
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
    # v380: START(2016) 대신 **상장일부터 전부**(period="max") — 차트를 전기간으로 늘렸으므로
    #   재수집도 같은 범위로 받아야 한다(J&J·P&G 1962년~, 최대 16,258행).
    raw = yf.download(todo, period="max", group_by="ticker", auto_adjust=True,
                      threads=True, progress=False)
    for t in todo:
        try:
            sub = raw[t] if len(todo) > 1 else raw
            sub = sub.rename(columns=str.lower)
            df = norm_ohlcv(sub.dropna(subset=["close"]))
            # ⚠국내는 MIN_ROWS_COLLECT(20)인데 미국만 750이라 **신규상장이 통째로 빠졌다**
            #   (실측 v358: ARM·GEV·SOLV·VLTO·ALAB 등 12종목). 원칙 검증 게이트는 load_research가
            #   따로 걸므로 수집 바닥값은 양 시장을 통일한다.
            if len(df) < MIN_ROWS_COLLECT:
                print(f"  [US] {t} 데이터 부족({len(df)}행) 제외")
                continue
            save_merge(df, DATA_DIR / f"us_{t.replace('-', '_')}.parquet")   # ⚠병합(과거 이력 보존)
            ok += 1
        except Exception as e:
            print(f"  [US] {t} 실패: {e}", file=sys.stderr)
    print(f"[US] 완료: {ok}종목")
    return ok


def _fix_flat_bars(df: pd.DataFrame) -> pd.DataFrame:
    """거래정지·무거래일의 `시가=고가=저가=0`을 종가로 맞춘다(norm_ohlcv와 같은 규칙).

    ⚠**로드 시점에도 거는 안전망**이다: 이미 쌓인 캐시나 옛 코드로 갱신된 행이 남아 있으면
      ①차트에 0에서 종가까지 뻗는 긴 막대가 생기고 ②저가 0이 고저 기반 지표·백테스트를 오염시킨다.
      수집 단계(norm_ohlcv)에서 막고 있지만, **모든 소비자가 지나는 이 문에서 한 번 더** 막는다.
    """
    if df is None or df.empty or not {"open", "high", "low", "close"}.issubset(df.columns):
        return df
    cols = ["open", "high", "low"]
    bad = (df[cols].le(0).any(axis=1) | df[cols].isna().any(axis=1)) & (df["close"] > 0)
    if not bad.any():
        return df
    df = df.copy()
    for c in cols:
        df.loc[bad, c] = df.loc[bad, "close"]
    return df


def load_all() -> dict:
    """캐시된 전 종목 로드 → {(market, ticker): DataFrame}. 다른 모듈에서 사용.
    (macro.parquet 등 비종목 캐시는 제외 — kr_/us_ 접두사만)"""
    out = {}
    for p in sorted(DATA_DIR.glob("kr_*.parquet")) + sorted(DATA_DIR.glob("us_*.parquet")):
        market, ticker = p.stem.split("_", 1)
        try:
            out[(market, ticker)] = _fix_flat_bars(pd.read_parquet(p))
        except Exception as e:
            # ⚠손상 캐시 하나가 전체를 죽이면 안 된다(2026-08-07: 잘린 parquet 5개 →
            #   market_dash 24시간 정지). 건너뛰고 경고만 — 파일 삭제 후 재수집으로 복구.
            print(f"  [load_all] {p.name} 읽기 실패(손상 캐시, 건너뜀): {e}", file=sys.stderr)
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
    save_parquet(merged, path)
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
    """클라우드(GitHub Actions)용 수집 — 유니버스 1,200 × **최근 약 4.3년**.

    ⚠기간이 2년(≈520거래일)이던 시절 `load_research()`(≥750행)를 쓰는 소비자가 **0종목**을 받아
      오늘의 신호가 '0건'으로 생성되는 사고가 있었다(2026-07-31). 원칙 게이트를 넘으려면 3년+가 필요하다.
    ⚠기존 캐시는 얕으므로(≈520행) **한 런에 DEEPEN_BUDGET개씩만 소급**해 여러 런에 걸쳐 채운다
      (한꺼번에 1,200종목을 다시 받으면 30분 주기 워크플로가 못 끝낸다).
    """
    from datetime import date as _date

    import yfinance as yf
    from pykrx import stock

    start_kr = (_date.today() - timedelta(days=1560)).strftime("%Y%m%d")   # ~4.3년(원칙 게이트 750행 확보)
    start_us = (_date.today() - timedelta(days=1560)).strftime("%Y-%m-%d")
    today = _date.today().strftime("%Y%m%d")
    names = kr_universe()  # v216: 전 상장(스팩·우선주 제외 ≈2,580) — 클라우드도 동일 유니버스

    def _rows(p: Path) -> int:      # 캐시 깊이(행 수) — 얕으면 소급 대상
        try:
            return len(pd.read_parquet(p, columns=[]).index)
        except Exception:
            return 0

    DEEPEN_BUDGET = 150             # 한 런에서 소급 재수집할 최대 종목 수
    # v216 유니버스 2배 확장(1,200→2,566) — 신규 종목을 한 런에 다 받으면 30분 주기를 넘긴다.
    #   런당 상한을 두고 여러 런에 나눠 채운다(캐시가 남으므로 다음 런이 이어받는다).
    NEW_BUDGET = 300
    deepened = added = 0

    # US (138종목뿐이라 한 번에 소급해도 부담 없음)
    todo = [t for t in US_TICKERS
            if not cache_fresh(DATA_DIR / f"us_{t.replace('-', '_')}.parquet")
            or _rows(DATA_DIR / f"us_{t.replace('-', '_')}.parquet") < MIN_ROWS]
    if todo:
        raw = yf.download(todo, start=start_us,
                          group_by="ticker", auto_adjust=True, threads=True, progress=False)
        for t in todo:
            try:
                sub = raw[t] if len(todo) > 1 else raw
                df = norm_ohlcv(sub.rename(columns=str.lower).dropna(subset=["close"]))
                if len(df) >= 200:
                    # ⚠KR 경로는 병합인데 여기만 덮어쓰고 있었다 — 매 런이 US 캐시를 start_us(약 4.3년)로
                    #   잘라 **소급 적립(DEEPEN)을 되돌린다**. 병합으로 통일한다(겹치면 새 fetch가 이김).
                    save_merge(df, DATA_DIR / f"us_{t.replace('-', '_')}.parquet")
            except Exception:
                pass
    # KR
    ok = 0
    for i, t in enumerate(names, 1):
        path = DATA_DIR / f"kr_{t}.parquet"
        if cache_fresh(path):
            # 최신이긴 한데 이력이 얕으면(구 2년 캐시) 예산 안에서 과거를 소급해 채운다
            if _rows(path) >= MIN_ROWS or deepened >= DEEPEN_BUDGET:
                ok += 1
                continue
            deepened += 1
        elif not path.exists():
            if added >= NEW_BUDGET:      # 신규 종목은 런당 상한까지만(나머지는 다음 런)
                continue
            added += 1
        try:
            raw = stock.get_market_ohlcv(start_kr, today, t)
            if raw is None or raw.empty:
                continue
            raw = raw.rename(columns={"시가": "open", "고가": "high", "저가": "low",
                                      "종가": "close", "거래량": "volume"})
            df = norm_ohlcv(raw)
            if len(df) >= MIN_ROWS_COLLECT:  # 수집 바닥값(신규상장 포함)
                # ⚠기존 캐시가 더 길 수 있으므로 **병합**한다(덮어쓰면 쌓아둔 과거가 날아간다).
                if path.exists():
                    old = pd.read_parquet(path)
                    df = pd.concat([old, df]).sort_index()
                    df = df[~df.index.duplicated(keep="last")]   # 겹치면 새 fetch가 이김
                save_parquet(df, path)
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

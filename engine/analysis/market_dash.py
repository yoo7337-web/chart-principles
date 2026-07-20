# -*- coding: utf-8 -*-
r"""마켓 현황 데이터 생성 → app\data\market.json

- 매크로 지표(yfinance): 지수·VIX·미10Y·달러·환율·유가·금 — data\macro.parquet 증분 캐시
- Breadth(자체 캐시 287종목): 상승/하락, 52주 신고/신저, 거래대금 급증 상위
- 섹터 히트맵: data\sector_map.json 캐시(US=yfinance info, KR=네이버 업종 스크래핑) + 일간 등락

사용법: python analysis\market_dash.py  (하루 3회 배치에 포함)
"""
import json
import re
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from collect import DATA_DIR, load_all
from common import APP_DATA, ROOT
from regimes import regime_map

KST = timezone(timedelta(hours=9))  # 클라우드 러너=UTC → naive now()는 9시간 낡아 보임

MACRO_PARQUET = DATA_DIR / "macro.parquet"
SECTOR_MAP = DATA_DIR / "sector_map.json"
SECTOR_MAX_AGE_DAYS = 30

# (yahoo ticker) -> (표시명, 그룹, 단위, 트레이더 관점 한 줄)
MACRO = {
    "^KS11":    ("코스피", "지수", "", "한국 시장 전체 방향 — 보유 KR 종목의 베타"),
    "^KQ11":    ("코스닥", "지수", "", "국내 성장주·개인 수급 심리"),
    "^GSPC":    ("S&P 500", "지수", "", "글로벌 위험자산의 기준점"),
    "^IXIC":    ("나스닥", "지수", "", "기술주·성장주 방향 — 반도체 보유 시 필수"),
    "^SOX":     ("필라델피아 반도체", "지수", "", "삼성전자·하이닉스·NVDA의 선행 지표"),
    "^VIX":     ("VIX (공포지수)", "리스크", "", "20↑ 불안, 30↑ 공포 — 역발상 매수원칙의 사냥터"),
    "IPO":      ("IPO ETF (신규상장·미국)", "리스크", "$", "Renaissance IPO ETF — 위험선호·유동성의 척도. 상승=유동성 풀림·낙관(리스크온), 하락=신규자금 위축·비관(리스크오프)"),
    "^TNX":     ("미국 10년물 금리", "금리", "%", "주식 밸류에이션의 할인율 — 급등 시 성장주 압박"),
    "DX-Y.NYB": ("달러인덱스", "통화", "", "달러 강세 = 위험자산·신흥국(한국) 자금 이탈 압력"),
    "KRW=X":    ("원/달러 환율", "통화", "원", "1,400↑ 외국인 순매도 압력·수출주 실적엔 우호"),
    "CL=F":     ("WTI 유가", "원자재", "$", "인플레이션·에너지 비용 — 금리 경로에 영향"),
    "GC=F":     ("금", "원자재", "$", "안전자산 선호도 — 주식과 역상관 경향"),
}
SPARK_DAYS = 60


MACRO5Y_CACHE = DATA_DIR / "macro5y_cache.json"


def _macro_5y(tickers: list) -> dict:
    """매크로 티커 5년 주봉(카드 클릭 시 팝업 차트용). 20h 가드 캐시."""
    if MACRO5Y_CACHE.exists():
        try:
            c = json.loads(MACRO5Y_CACHE.read_text(encoding="utf-8"))
            age_h = (datetime.now(KST) - datetime.fromisoformat(c["at"]).replace(tzinfo=KST)).total_seconds() / 3600
            if age_h < 20:
                return c["weekly"]
        except Exception:
            pass
    import yfinance as yf
    weekly = {}
    try:
        w = yf.download(tickers, period="5y", interval="1wk", progress=False, threads=True)["Close"]
        for t in tickers:
            try:
                s = (w[t] if len(tickers) > 1 else w).dropna()
                weekly[t] = {"d": [d.strftime("%Y-%m-%d") for d in s.index],
                             "c": [round(float(v), 2) for v in s]}
            except Exception:
                pass
        MACRO5Y_CACHE.write_text(json.dumps(
            {"at": datetime.now(KST).strftime("%Y-%m-%dT%H:%M:%S"), "weekly": weekly}), encoding="utf-8")
    except Exception as e:
        print(f"  macro 5y 실패({e})", file=sys.stderr)
    return weekly


def fetch_macro() -> list:
    import yfinance as yf

    tickers = list(MACRO)
    raw = yf.download(tickers, period="6mo", group_by="ticker", auto_adjust=True,
                      threads=True, progress=False)
    closes = {}
    for t in tickers:
        try:
            sub = raw[t] if len(tickers) > 1 else raw
            closes[t] = sub["Close"].dropna()
        except Exception:
            pass
    new = pd.DataFrame(closes)
    if MACRO_PARQUET.exists():  # 증분 병합(과거 보존) — 기존 값 우선, 신규 티커 컬럼·신규 날짜는 new로 채움
        old = pd.read_parquet(MACRO_PARQUET)
        merged = old.combine_first(new).sort_index()  # combine_first: 겹치면 old, 결측(신규 컬럼/날짜)은 new
    else:
        merged = new
    merged = merged[~merged.index.duplicated(keep="last")]
    merged.to_parquet(MACRO_PARQUET)

    weekly = _macro_5y(tickers)
    out = []
    for t, (name, group, unit, note) in MACRO.items():
        if t not in merged.columns:
            continue
        s = merged[t].dropna()
        if len(s) < 2:
            continue
        spark = s.tail(SPARK_DAYS)
        wk = weekly.get(t) or {}
        out.append({
            "id": t, "name": name, "group": group, "unit": unit, "note": note,
            "last": round(float(s.iloc[-1]), 2),
            "chg": round(float(s.iloc[-1] / s.iloc[-2] - 1), 4),
            "spark": [round(float(v), 2) for v in spark],
            "asof": s.index[-1].strftime("%Y-%m-%d"),
            "w5": wk.get("c", []), "w5d": wk.get("d", []),
        })
    return out


def compute_breadth(data: dict, kr_names: dict) -> tuple:
    breadth = {"kr": {"up": 0, "down": 0, "flat": 0, "hi52": 0, "lo52": 0},
               "us": {"up": 0, "down": 0, "flat": 0, "hi52": 0, "lo52": 0}}
    hot, chg_map = [], {}
    for (mk, tk), df in data.items():
        c = df["close"]
        if len(c) < 260:
            continue
        chg = float(c.iloc[-1] / c.iloc[-2] - 1)
        chg_map[(mk, tk)] = chg
        b = breadth[mk]
        b["up" if chg > 0.0005 else "down" if chg < -0.0005 else "flat"] += 1
        if c.iloc[-1] >= c.iloc[-252:].max():
            b["hi52"] += 1
        if c.iloc[-1] <= c.iloc[-252:].min():
            b["lo52"] += 1
        val = df["close"] * df["volume"]
        base = float(val.iloc[-21:-1].mean())
        if base > 0:
            hot.append({"market": mk, "ticker": tk,
                        "name": kr_names.get(tk, tk) if mk == "kr" else tk,
                        "volx": round(float(val.iloc[-1]) / base, 2), "chg": round(chg, 4)})
    hot = sorted(hot, key=lambda x: -x["volx"])[:10]
    return breadth, hot, chg_map


def build_sector_map(data: dict, kr_names: dict) -> dict:
    """{f"{mk}_{tk}": {"sector": str, "mcap": float}} — 30일 캐시."""
    if SECTOR_MAP.exists():
        cached = json.loads(SECTOR_MAP.read_text(encoding="utf-8"))
        age = (date.today() - date.fromisoformat(cached.get("generated", "2000-01-01"))).days
        if age <= SECTOR_MAX_AGE_DAYS:
            return cached["map"]

    print("  섹터맵 재생성(월 1회)...")
    smap = {}

    # --- KR: 네이버 업종 페이지 (업종 목록 → 각 업종의 종목 코드) ---
    def get(url):
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        return urllib.request.urlopen(req, timeout=15).read().decode("euc-kr", "ignore")

    try:
        html = get("https://finance.naver.com/sise/sise_group.naver?type=upjong")
        groups = re.findall(r'sise_group_detail\.naver\?type=upjong&no=(\d+)"[^>]*>([^<]+)<', html)
        for no, gname in groups:
            try:
                detail = get(f"https://finance.naver.com/sise/sise_group_detail.naver?type=upjong&no={no}")
                for code in re.findall(r'/item/main\.naver\?code=(\d{6})', detail):
                    smap.setdefault(f"kr_{code}", {})["sector"] = gname.strip()
                time.sleep(0.15)
            except Exception:
                continue
        print(f"  KR 업종 {len(groups)}개 매핑")
    except Exception as e:
        print(f"  KR 업종 스크래핑 실패({e}) — '기타' 폴백", file=sys.stderr)

    # --- KR 시총: 네이버 시가총액 페이지 read_html (코스피 1~10p ≈500 + 코스닥 1~6p ≈300) ---
    for sosok, pages in ((0, 10), (1, 6)):  # sosok=0 코스피 / 1 코스닥
        try:
            for page in range(1, pages + 1):
                url = f"https://finance.naver.com/sise/sise_market_sum.naver?sosok={sosok}&page={page}"
                html = get(url)
                codes = re.findall(r'/item/main\.naver\?code=(\d{6})', html)
                tables = pd.read_html(__import__("io").StringIO(html))
                df = max(tables, key=len)
                mcaps = df["시가총액"].dropna().tolist() if "시가총액" in df.columns else []
                seen = list(dict.fromkeys(codes))
                for code, mc in zip(seen, mcaps):
                    try:
                        smap.setdefault(f"kr_{code}", {})["mcap"] = float(mc) * 1e8  # 억원→원
                    except Exception:
                        pass
                time.sleep(0.2)
        except Exception as e:
            print(f"  KR 시총 파싱 실패(sosok={sosok}, {e}) — 거래대금 폴백", file=sys.stderr)

    # --- US: yfinance info (99종목, 1회성) ---
    import yfinance as yf
    us = [tk for (mk, tk) in data if mk == "us"]
    for i, tk in enumerate(us, 1):
        try:
            info = yf.Ticker(tk).info
            smap[f"us_{tk}"] = {"sector": info.get("sector") or "기타",
                                "mcap": float(info.get("marketCap") or 0)}
        except Exception:
            smap[f"us_{tk}"] = {"sector": "기타", "mcap": 0}
        if i % 25 == 0:
            print(f"  US info {i}/{len(us)}")
        time.sleep(0.2)

    SECTOR_MAP.write_text(json.dumps({"generated": date.today().isoformat(), "map": smap},
                                     ensure_ascii=False), encoding="utf-8")
    return smap


US_SECTOR_KO = {
    "Technology": "기술", "Communication Services": "커뮤니케이션", "Consumer Cyclical": "임의소비재",
    "Consumer Defensive": "필수소비재", "Financial Services": "금융", "Healthcare": "헬스케어",
    "Industrials": "산업재", "Energy": "에너지", "Utilities": "유틸리티",
    "Real Estate": "부동산", "Basic Materials": "소재",
}


def build_heatmap(data: dict, kr_names: dict, smap: dict, chg_map: dict) -> list:
    tiles = []
    for (mk, tk), df in data.items():
        key = f"{mk}_{tk}"
        meta = smap.get(key, {})
        sector = meta.get("sector", "기타")
        if mk == "us":
            sector = US_SECTOR_KO.get(sector, sector)
        mcap = float(meta.get("mcap") or 0)
        if mcap <= 0:  # 폴백: 최근 거래대금 규모
            mcap = float((df["close"] * df["volume"]).tail(20).mean())
        # 모멘텀: c5=5거래일(≈1주) 수익률, up=최근 연속 상승일 수 (주식찾기 테마용)
        c5, up = None, 0
        try:
            cl = df["close"].dropna().tolist()
            if len(cl) >= 6 and cl[-6]:
                c5 = round(cl[-1] / cl[-6] - 1, 4)
            for i in range(len(cl) - 1, 0, -1):
                if cl[i] > cl[i - 1]:
                    up += 1
                else:
                    break
        except Exception:
            pass
        tiles.append({
            "m": mk, "t": tk, "name": kr_names.get(tk, tk) if mk == "kr" else tk,
            "sector": sector, "mcap": mcap, "chg": round(chg_map.get((mk, tk), 0.0), 4),
            "c5": c5, "up": up,
        })
    return tiles


def build_home_extras(data: dict, kr_names: dict, smap: dict, chg_map: dict) -> tuple:
    """홈 탭용 featured(시총 상위 대표종목 2/시장) + movers(거래대금·거래량·급등·급락 상위 10)."""
    # 로고: KR=네이버 패턴 / US=company.json(clearbit) — 홈 오늘의종목·지수카드용
    try:
        comap = json.loads((APP_DATA / "company.json").read_text(encoding="utf-8"))["map"]
    except Exception:
        comap = {}

    def logo_of(mk, tk):
        if mk == "kr":
            return f"https://ssl.pstatic.net/imgstock/fn/real/logo/stock/Stock{tk}.svg"
        return f"https://assets.parqet.com/logos/symbol/{tk}?format=png"  # parqet(티커) — clearbit 종료 대체

    LIQ_MIN = {"kr": 1e10, "us": 5e7}  # 급등/급락 유동성 컷: 당일 거래대금 KR 100억 / US $50M
    snaps = {"kr": [], "us": []}
    for (mk, tk), df in data.items():
        c = df["close"]
        if len(c) < 21:
            continue
        last = float(c.iloc[-1])
        chg = chg_map.get((mk, tk))
        if chg is None:
            chg = float(c.iloc[-1] / c.iloc[-2] - 1)
        snaps[mk].append({
            "t": tk, "name": kr_names.get(tk, tk) if mk == "kr" else tk,
            "logo": logo_of(mk, tk),
            "last": round(last, 2), "chg": round(chg, 4),
            "value": round(float(last * df["volume"].iloc[-1])),
            "vol": round(float(df["volume"].iloc[-1])),
            "_mcap": float(smap.get(f"{mk}_{tk}", {}).get("mcap") or 0),
        })

    # 전 종목 최신 시세 맵 — 종목조회 헤더가 히트맵과 같은 소스를 쓰도록(주1 stocks/*.json 지연 보정)
    quotes = {f"{mk}_{r['t']}": [r["last"], r["chg"]] for mk in snaps for r in snaps[mk]}


    featured, movers = {}, {}
    for mk, rows in snaps.items():
        top2 = sorted([r for r in rows if r["_mcap"] > 0], key=lambda r: -r["_mcap"])[:2]
        feats = []
        for r in top2:
            spark = [round(float(v), 2) for v in data[(mk, r["t"])]["close"].tail(30)]
            feats.append({k: v for k, v in r.items() if k != "_mcap"} | {"spark": spark})
        featured[mk] = feats

        liq = [r for r in rows if r["value"] >= LIQ_MIN[mk]]
        if len(liq) < 10:  # 필터가 과하면 절반으로 완화
            liq = [r for r in rows if r["value"] >= LIQ_MIN[mk] / 2]
        strip = lambda rs: [{k: v for k, v in r.items() if k != "_mcap"} for r in rs[:10]]
        movers[mk] = {
            "value": strip(sorted(rows, key=lambda r: -r["value"])),
            "volume": strip(sorted(rows, key=lambda r: -r["vol"])),
            "gainers": strip(sorted(liq, key=lambda r: -r["chg"])),
            "losers": strip(sorted(liq, key=lambda r: r["chg"])),
        }
    return featured, movers, quotes


# ---------- 중앙은행 정책금리 (BIS 무키 API) + 시장 내재 기대 (US=Fed선물, KR=국고1년 스프레드) ----------
CBANKS = [  # (BIS 코드, 이름, 국기)
    ("US", "미국 연준 (Fed)", "🇺🇸"), ("KR", "한국은행 (BOK)", "🇰🇷"), ("XM", "유럽 ECB", "🇪🇺"),
    ("JP", "일본은행 (BOJ)", "🇯🇵"), ("GB", "영란은행 (BOE)", "🇬🇧"), ("CN", "중국 인민은행", "🇨🇳"),
    ("CA", "캐나다 BOC", "🇨🇦"), ("AU", "호주 RBA", "🇦🇺"),
]
# 2026 남은 금리결정일 (결정 발표일 기준, 공식 일정 — 연 1회 수동 갱신)
CB_MEETINGS = {
    "US": ["2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09"],   # FOMC (2일차)
    "KR": ["2026-08-27", "2026-10-22", "2026-11-26"],                  # 금통위
    "XM": ["2026-07-23", "2026-09-10", "2026-10-29", "2026-12-17"],   # ECB
    "JP": ["2026-07-31", "2026-09-18", "2026-10-30", "2026-12-18"],   # BOJ (2일차)
    "GB": ["2026-07-30"],                                              # BOE (이후 일정은 확정분만)
}
CBANKS_CACHE = DATA_DIR / "cbanks_cache.json"


def fetch_cbanks() -> list:
    """BIS 정책금리 + 최근 변경 + 다음 회의 + 시장 내재 기대(US·KR). 20h 가드·실패 시 캐시."""
    from datetime import date as _date
    if CBANKS_CACHE.exists():
        try:
            c = json.loads(CBANKS_CACHE.read_text(encoding="utf-8"))
            age_h = (datetime.now(KST) - datetime.fromisoformat(c["at"]).replace(tzinfo=KST)).total_seconds() / 3600
            if age_h < 20:
                return c["rows"]
        except Exception:
            pass
    try:
        import io
        import urllib.request
        codes = "+".join(c[0] for c in CBANKS)
        url = (f"https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/D.{codes}"
               f"?lastNObservations=400&format=csv")
        raw = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}),
                                     timeout=30).read().decode("utf-8", "ignore")
        df = pd.read_csv(io.StringIO(raw))[["REF_AREA", "TIME_PERIOD", "OBS_VALUE"]].dropna()
        rows = []
        today = _date.today().isoformat()
        for code, name, flag in CBANKS:
            s = df[df.REF_AREA == code].sort_values("TIME_PERIOD")
            if not len(s):
                continue
            rate = float(s.OBS_VALUE.iloc[-1])
            # 최근 변경: 값이 바뀐 마지막 시점
            chg_d, chg_bp = None, None
            vals = s.OBS_VALUE.values
            for i in range(len(vals) - 1, 0, -1):
                if vals[i] != vals[i - 1]:
                    chg_d = str(s.TIME_PERIOD.iloc[i])
                    chg_bp = round((float(vals[i]) - float(vals[i - 1])) * 100)
                    break
            nxt = next((d for d in CB_MEETINGS.get(code, []) if d >= today), None)
            # 금리 이력(팝업 스텝차트용) — 다운샘플 ~90포인트, 마지막 관측 포함
            step = max(1, len(s) // 90)
            rh = s.iloc[::step]
            rhistd = [str(x)[:10] for x in rh.TIME_PERIOD]
            rhist = [round(float(v), 3) for v in rh.OBS_VALUE]
            if rhistd and rhistd[-1] != str(s.TIME_PERIOD.iloc[-1])[:10]:
                rhistd.append(str(s.TIME_PERIOD.iloc[-1])[:10]); rhist.append(round(rate, 3))
            rows.append({"code": code, "name": name, "flag": flag, "rate": round(rate, 3),
                         "changed": ({"d": chg_d, "bp": chg_bp} if chg_d else None),
                         "next": nxt, "asof": str(s.TIME_PERIOD.iloc[-1]),
                         "rhist": rhist, "rhistd": rhistd})
        # --- 시장 내재 기대 ---
        by = {r["code"]: r for r in rows}
        try:  # US: 30일 Fed Funds 선물(front) 내재금리 vs 현재 목표 midpoint
            import yfinance as yf
            zq = yf.Ticker("ZQ=F").history(period="5d")["Close"].dropna()
            if len(zq) and "US" in by:
                implied = round(100 - float(zq.iloc[-1]), 3)
                diff = round((implied - by["US"]["rate"]) * 100)  # bp
                prob = min(100, max(0, round(abs(diff) / 25 * 100)))
                lab = ("동결 우세" if abs(diff) < 5 else
                       f"25bp {'인하' if diff < 0 else '인상'} 확률 ~{prob}%")
                by["US"]["implied"] = {"rate": implied, "diff_bp": diff, "label": lab,
                                       "src": "Fed Funds 선물(ZQ) 내재금리"}
        except Exception:
            pass
        try:  # KR: 국고채 3년 − 기준금리 스프레드 (네이버 시장지표 메인, euc-kr)
            raw_kr = urllib.request.urlopen(urllib.request.Request(
                "https://finance.naver.com/marketindex/",
                headers={"User-Agent": "Mozilla/5.0"}), timeout=15).read()
            html = raw_kr.decode("euc-kr", "ignore")
            i = html.find("국고채 (3년)")
            m = re.search(r"([0-9]+\.[0-9]+)", re.sub(r"<[^>]+>", " ", html[i:i + 300])) if i > 0 else None
            if m and "KR" in by:
                y3 = float(m.group(1))
                diff = round((y3 - by["KR"]["rate"]) * 100)  # bp (기간프리미엄 포함 → ±50bp 임계)
                lab = ("동결 기대 우세" if abs(diff) < 50 else
                       f"시장금리가 {'인상' if diff > 0 else '인하'} 기대 반영 ({diff:+d}bp)")
                by["KR"]["implied"] = {"rate": y3, "diff_bp": diff, "label": lab,
                                       "src": "국고채 3년 − 기준금리 (기간프리미엄 포함 참고치)"}
        except Exception:
            pass
        CBANKS_CACHE.write_text(json.dumps(
            {"at": datetime.now(KST).strftime("%Y-%m-%dT%H:%M:%S"), "rows": rows},
            ensure_ascii=False), encoding="utf-8")
        return rows
    except Exception as e:
        print(f"  cbanks 실패({e}) — 캐시 재사용", file=sys.stderr)
        try:
            return json.loads(CBANKS_CACHE.read_text(encoding="utf-8"))["rows"]
        except Exception:
            return []


# ---------- 세계 지수 (지도용) — 당일 등락 매 실행 + 5년 주봉 20h 가드 ----------
WORLD_IDX = [  # (야후티커, 국가, 지수명, 국기, 지도 x%, y%)
    ("^GSPC",     "미국",   "S&P 500",    "🇺🇸", 18, 42),
    ("^GSPTSE",   "캐나다", "TSX",        "🇨🇦", 17, 30),
    ("^BVSP",     "브라질", "Bovespa",    "🇧🇷", 32, 68),
    ("^FTSE",     "영국",   "FTSE 100",   "🇬🇧", 45, 30),
    ("^FCHI",     "프랑스", "CAC 40",     "🇫🇷", 47, 36),
    ("^GDAXI",    "독일",   "DAX",        "🇩🇪", 50, 32),
    ("^STOXX50E", "유럽",   "STOXX 50",   "🇪🇺", 52, 39),
    ("^BSESN",    "인도",   "SENSEX",     "🇮🇳", 67, 52),
    ("000001.SS", "중국",   "상해종합",    "🇨🇳", 76, 42),
    ("^HSI",      "홍콩",   "항셍",       "🇭🇰", 78, 49),
    ("^TWII",     "대만",   "가권",       "🇹🇼", 81, 47),
    ("^KS11",     "한국",   "코스피",     "🇰🇷", 81.5, 40),
    ("^N225",     "일본",   "닛케이 225", "🇯🇵", 86, 41),
    ("^AXJO",     "호주",   "ASX 200",    "🇦🇺", 85, 72),
]
WORLD_CACHE = DATA_DIR / "world_cache.json"


def fetch_world() -> list:
    """세계 지수: last/chg는 매 실행(2d), 5년 주봉 시리즈는 20h 가드 캐시."""
    import yfinance as yf
    tickers = [w[0] for w in WORLD_IDX]
    # 5년 주봉 (20h 가드)
    weekly = None
    if WORLD_CACHE.exists():
        try:
            c = json.loads(WORLD_CACHE.read_text(encoding="utf-8"))
            age_h = (datetime.now(KST) - datetime.fromisoformat(c["at"]).replace(tzinfo=KST)).total_seconds() / 3600
            if age_h < 20:
                weekly = c["weekly"]
        except Exception:
            pass
    if weekly is None:
        try:
            w = yf.download(tickers, period="5y", interval="1wk", progress=False, threads=True)["Close"]
            weekly = {}
            for t in tickers:
                try:
                    s = w[t].dropna()
                    weekly[t] = {"d": [d.strftime("%Y-%m-%d") for d in s.index],
                                 "c": [round(float(v), 2) for v in s]}
                except Exception:
                    pass
            WORLD_CACHE.write_text(json.dumps(
                {"at": datetime.now(KST).strftime("%Y-%m-%dT%H:%M:%S"), "weekly": weekly}), encoding="utf-8")
        except Exception as e:
            print(f"  world weekly 실패({e})", file=sys.stderr)
            weekly = {}
    # 당일 등락 (매 실행)
    last_chg = {}
    try:
        d2 = yf.download(tickers, period="5d", interval="1d", progress=False, threads=True)["Close"]
        for t in tickers:
            try:
                s = d2[t].dropna()
                if len(s) >= 2:
                    last_chg[t] = (round(float(s.iloc[-1]), 2), round(float(s.iloc[-1] / s.iloc[-2] - 1), 4))
            except Exception:
                pass
    except Exception:
        pass
    out = []
    for t, country, name, flag, x, y in WORLD_IDX:
        wk = weekly.get(t)
        lc = last_chg.get(t)
        if not wk and not lc:
            continue
        last = lc[0] if lc else (wk["c"][-1] if wk and wk["c"] else None)
        chg = lc[1] if lc else None
        out.append({"id": t, "country": country, "name": name, "flag": flag, "x": x, "y": y,
                    "last": last, "chg": chg,
                    "w5d": wk["d"] if wk else [], "w5": wk["c"] if wk else []})
    return out


def main():
    print("[1/4] 매크로 지표 (yfinance)...")
    macro = fetch_macro()
    print(f"  {len(macro)}개 지표")

    print("[2/4] Breadth + 거래대금 급증...")
    from common import core_data
    wide = load_all()  # 전체 확보분(주식찾기·마켓현황·종목조회) — 신규상장·소형주 포함
    core = core_data({k: v for k, v in wide.items() if len(v) >= 750})  # 시장폭·국면은 대표성(≥750)
    names_path = ROOT / "data" / "kr_names.json"
    kr_names = json.loads(names_path.read_text(encoding="utf-8")) if names_path.exists() else {}
    breadth, hot, _ = compute_breadth(core, kr_names)  # 시장폭·급증은 코어 대상
    reg = regime_map(core)
    regime = {mk: (str(r[r != "na"].iloc[-1]) if len(r[r != "na"]) else "neutral") for mk, r in reg.items()}
    # 히트맵/홈 타일용 등락률은 전 종목 계산(단기이력 포함, ≥2행)
    chg_wide = {}
    for (mk, tk), df in wide.items():
        c = df["close"]
        if len(c) >= 2:
            chg_wide[(mk, tk)] = float(c.iloc[-1] / c.iloc[-2] - 1)

    print("[3/4] 섹터 히트맵 + 홈(featured/movers) + 중앙은행/세계지수...")
    smap = build_sector_map(wide, kr_names)
    heatmap = build_heatmap(wide, kr_names, smap, chg_wide)
    featured, movers, quotes = build_home_extras(wide, kr_names, smap, chg_wide)
    cbanks = fetch_cbanks()
    world = fetch_world()
    print(f"  cbanks {len(cbanks)}행 · world {len(world)}지수")

    print("[4/4] 저장...")
    asof = max(df.index[-1] for df in core.values()).strftime("%Y-%m-%d")
    payload = {
        "generated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"),
        "asof": asof, "regime": regime,
        "macro": macro, "breadth": breadth, "hot": hot, "heatmap": heatmap,
        "featured": featured, "movers": movers, "quotes": quotes,
        "cbanks": cbanks, "world": world,
    }
    (APP_DATA / "market.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    ks = breadth["kr"]
    print(f"완료: market.json — KR 상승 {ks['up']}/하락 {ks['down']}, 히트맵 타일 {len(heatmap)}개")


if __name__ == "__main__":
    main()

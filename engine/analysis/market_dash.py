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
    "^TNX":     ("미국 10년물 금리", "금리", "%", "주식 밸류에이션의 할인율 — 급등 시 성장주 압박"),
    "DX-Y.NYB": ("달러인덱스", "통화", "", "달러 강세 = 위험자산·신흥국(한국) 자금 이탈 압력"),
    "KRW=X":    ("원/달러 환율", "통화", "원", "1,400↑ 외국인 순매도 압력·수출주 실적엔 우호"),
    "CL=F":     ("WTI 유가", "원자재", "$", "인플레이션·에너지 비용 — 금리 경로에 영향"),
    "GC=F":     ("금", "원자재", "$", "안전자산 선호도 — 주식과 역상관 경향"),
}
SPARK_DAYS = 60


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
    if MACRO_PARQUET.exists():  # 증분 병합(과거 보존)
        old = pd.read_parquet(MACRO_PARQUET)
        merged = pd.concat([old, new[~new.index.isin(old.index)]]).sort_index()
    else:
        merged = new
    merged = merged[~merged.index.duplicated(keep="last")]
    merged.to_parquet(MACRO_PARQUET)

    out = []
    for t, (name, group, unit, note) in MACRO.items():
        if t not in merged.columns:
            continue
        s = merged[t].dropna()
        if len(s) < 2:
            continue
        spark = s.tail(SPARK_DAYS)
        out.append({
            "id": t, "name": name, "group": group, "unit": unit, "note": note,
            "last": round(float(s.iloc[-1]), 2),
            "chg": round(float(s.iloc[-1] / s.iloc[-2] - 1), 4),
            "spark": [round(float(v), 2) for v in spark],
            "asof": s.index[-1].strftime("%Y-%m-%d"),
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

    # --- KR 시총: 네이버 시가총액 페이지 read_html ---
    try:
        for page in range(1, 7):
            url = f"https://finance.naver.com/sise/sise_market_sum.naver?sosok=0&page={page}"
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
        print(f"  KR 시총 파싱 실패({e}) — 거래대금 폴백", file=sys.stderr)

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
        tiles.append({
            "m": mk, "t": tk, "name": kr_names.get(tk, tk) if mk == "kr" else tk,
            "sector": sector, "mcap": mcap, "chg": round(chg_map.get((mk, tk), 0.0), 4),
        })
    return tiles


def build_home_extras(data: dict, kr_names: dict, smap: dict, chg_map: dict) -> tuple:
    """홈 탭용 featured(시총 상위 대표종목 2/시장) + movers(거래대금·거래량·급등·급락 상위 10)."""
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
            "last": round(last, 2), "chg": round(chg, 4),
            "value": round(float(last * df["volume"].iloc[-1])),
            "vol": round(float(df["volume"].iloc[-1])),
            "_mcap": float(smap.get(f"{mk}_{tk}", {}).get("mcap") or 0),
        })

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
    return featured, movers


def main():
    print("[1/4] 매크로 지표 (yfinance)...")
    macro = fetch_macro()
    print(f"  {len(macro)}개 지표")

    print("[2/4] Breadth + 거래대금 급증...")
    from common import core_data
    data = core_data(load_all())  # 분석은 대형주 코어만(히트맵 가독성·시장폭 대표성)
    names_path = ROOT / "data" / "kr_names.json"
    kr_names = json.loads(names_path.read_text(encoding="utf-8")) if names_path.exists() else {}
    breadth, hot, chg_map = compute_breadth(data, kr_names)
    reg = regime_map(data)
    regime = {mk: (str(r[r != "na"].iloc[-1]) if len(r[r != "na"]) else "neutral") for mk, r in reg.items()}

    print("[3/4] 섹터 히트맵 + 홈(featured/movers)...")
    smap = build_sector_map(data, kr_names)
    heatmap = build_heatmap(data, kr_names, smap, chg_map)
    featured, movers = build_home_extras(data, kr_names, smap, chg_map)

    print("[4/4] 저장...")
    asof = max(df.index[-1] for df in data.values()).strftime("%Y-%m-%d")
    payload = {
        "generated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"),
        "asof": asof, "regime": regime,
        "macro": macro, "breadth": breadth, "hot": hot, "heatmap": heatmap,
        "featured": featured, "movers": movers,
    }
    (APP_DATA / "market.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    ks = breadth["kr"]
    print(f"완료: market.json — KR 상승 {ks['up']}/하락 {ks['down']}, 히트맵 타일 {len(heatmap)}개")


if __name__ == "__main__":
    main()

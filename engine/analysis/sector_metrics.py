# -*- coding: utf-8 -*-
r"""섹터(산업) 지표 → app\data\sector_metrics.json

섹터 로테이션에서 산업을 클릭했을 때 "이 산업이 지금 어떤 국면인가"를 보여주는 지표 3종:
  A. 펀더멘털  — 우리 financials(753종목) 섹터 합산: CAPEX·매출·영업이익률 추이(연간)
  B. 산업지표  — 산업군별 큐레이션
       · ECOS(한국은행): 산업별 수출금액지수, 제조업 BSI, 소비자심리, 건설수주
       · 야후: SOX·리튬(LIT)·구리·유가·환율·금리·해운(SEA) 등 프록시 시계열
  C. 수급·모멘텀 — market/market_pro에 이미 있는 값을 프런트가 조합(여기선 수집 안 함)

사용법: python analysis\sector_metrics.py [--force]
20h age 가드. ECOS 키는 .env의 ECOS_API_KEY(없으면 ECOS 파트만 생략).
"""
import argparse
import json
import os
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import APP_DATA

KST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parent.parent
OUT = APP_DATA / "sector_metrics.json"
MAX_AGE_H = 20
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

# ── 12개 산업군: 네이버 업종(77개) → 산업군 매핑 ─────────────────────────────
GROUPS = {
    "semi": ("반도체·IT", ["반도체와반도체장비", "디스플레이장비및부품", "디스플레이패널", "전자장비와기기",
                         "전자제품", "컴퓨터와주변기기", "통신장비", "핸드셋", "사무용전자제품"]),
    "battery": ("2차전지·소재", ["전기장비", "전기제품", "비철금속"]),
    "auto": ("자동차", ["자동차", "자동차부품"]),
    "bio": ("바이오·헬스", ["제약", "생물공학", "생명과학도구및서비스", "건강관리업체및서비스",
                        "건강관리장비와용품", "건강관리기술"]),
    "ship": ("조선·해운", ["조선", "해운사", "항공화물운송과물류", "운송인프라", "도로와철도운송", "항공사"]),
    "chem": ("화학·철강", ["화학", "철강", "종이와목재", "포장재"]),
    "construct": ("건설·부동산", ["건설", "건축자재", "건축제품", "부동산", "가구"]),
    "finance": ("금융", ["은행", "증권", "생명보험", "손해보험", "카드", "기타금융", "창업투자"]),
    "consumer": ("소비재·유통", ["식품", "음료", "담배", "화장품", "섬유,의류,신발,호화품", "백화점과일반상점",
                             "전문소매", "식품과기본식료품소매", "인터넷과카탈로그소매", "무역회사와판매업체",
                             "판매업체", "가정용기기와용품", "가정용품", "레저용장비와제품",
                             "호텔,레스토랑,레저", "교육서비스"]),
    "internet": ("인터넷·게임·미디어", ["소프트웨어", "IT서비스", "게임엔터테인먼트", "양방향미디어와서비스",
                                 "방송과엔터테인먼트", "광고", "출판", "다각화된통신서비스", "무선통신서비스"]),
    "defense": ("방산·기계", ["우주항공과국방", "기계", "상업서비스와공급품", "복합기업"]),
    "energy": ("에너지·유틸리티", ["석유와가스", "에너지장비및서비스", "전기유틸리티", "가스유틸리티",
                              "복합유틸리티"]),
}

# ── B. 산업군별 지표 큐레이션 ────────────────────────────────────────────────
# yahoo: (티커, 표시명, 단위힌트) / ecos: (통계표, 항목코드, 표시명, 주기)
YF = {
    "sox": ("^SOX", "필라델피아 반도체지수", ""),
    "mu": ("MU", "마이크론 (D램 사이클 대리)", "$"),
    "krw": ("KRW=X", "원/달러 환율", "원"),
    "lit": ("LIT", "리튬·배터리 ETF", "$"),
    "copper": ("HG=F", "구리 선물", "$"),
    "wti": ("CL=F", "WTI 유가", "$"),
    "sea": ("SEA", "해운 ETF", "$"),
    "hsi": ("^HSI", "항셍 (중국 수요)", ""),
    "tnx": ("^TNX", "미 10년물 금리", "%"),
    "vnq": ("VNQ", "리츠 ETF", "$"),
    "ita": ("ITA", "방산·우주 ETF", "$"),
    "ura": ("URA", "우라늄 ETF", "$"),
    "ndx": ("^NDX", "나스닥 100", ""),
    "ibb": ("IBB", "나스닥 바이오 ETF", "$"),
    "gold": ("GC=F", "금", "$"),
}
ECOS = {  # key: (통계표, 항목, 표시명)
    "exp_semi": ("403Y001", "30911AA", "반도체 수출금액지수"),
    "exp_semieq": ("403Y001", "311241AA", "반도체장비 수출금액지수"),
    "exp_disp": ("403Y001", "309211AA", "디스플레이 수출금액지수"),
    "exp_auto": ("403Y001", "31211AA", "자동차 수출금액지수"),
    "exp_autoparts": ("403Y001", "31213AA", "자동차부품 수출금액지수"),
    "exp_chem": ("403Y001", "305AA", "화학제품 수출금액지수"),
    "exp_steel": ("403Y001", "3071AA", "철강 수출금액지수"),
    "exp_ship": ("403Y001", "312AA", "운송장비(선박 포함) 수출금액지수"),
    "exp_mach": ("403Y001", "311AA", "기계·장비 수출금액지수"),
    "exp_med": ("403Y001", "305411AA", "의약품 수출금액지수"),
    "exp_total": ("403Y001", "*AA", "전체 수출금액지수"),
    "bsi_mfg": ("512Y013", "C0000", "제조업 업황BSI(실적)"),
    "csi_now": ("511Y002", "FMAB", "현재경기판단 CSI"),
    "construct_order": ("901Y020", "I42A", "국내건설수주액"),
}
# 산업군 → 지표 구성(순서=표시순)
SPEC = {
    "semi":      {"yf": ["sox", "mu", "krw"], "ecos": ["exp_semi", "exp_semieq"]},
    "battery":   {"yf": ["lit", "copper", "krw"], "ecos": ["exp_total"]},
    "auto":      {"yf": ["krw", "wti", "tnx"], "ecos": ["exp_auto", "exp_autoparts"]},
    "bio":       {"yf": ["ibb", "tnx"], "ecos": ["exp_med"]},
    "ship":      {"yf": ["sea", "wti", "krw"], "ecos": ["exp_ship"]},
    "chem":      {"yf": ["wti", "copper", "hsi"], "ecos": ["exp_chem", "exp_steel"]},
    "construct": {"yf": ["vnq", "tnx"], "ecos": ["construct_order"]},
    "finance":   {"yf": ["tnx", "krw"], "ecos": ["bsi_mfg", "csi_now"]},
    "consumer":  {"yf": ["krw", "wti"], "ecos": ["csi_now"]},
    "internet":  {"yf": ["ndx", "tnx"], "ecos": ["csi_now"]},
    "defense":   {"yf": ["ita", "krw"], "ecos": ["exp_mach", "bsi_mfg"]},
    "energy":    {"yf": ["wti", "ura", "gold"], "ecos": ["bsi_mfg"]},
}


def _ecos_key():
    p = ROOT / ".env"
    if p.exists():
        for ln in p.read_text(encoding="utf-8").splitlines():
            if ln.startswith("ECOS_API_KEY="):
                return ln.split("=", 1)[1].strip()
    return os.environ.get("ECOS_API_KEY")


def _getj(url, timeout=20):
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read().decode("utf-8"))


def fetch_yahoo(ticker: str, rng="2y", interval="1wk") -> list:
    """야후 차트 → [[YY-MM-DD, 값], ...] 주간."""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?range={rng}&interval={interval}"
    d = _getj(url)
    res = (d.get("chart", {}).get("result") or [None])[0]
    if not res:
        return []
    ts = res.get("timestamp") or []
    cl = ((res.get("indicators", {}).get("quote") or [{}])[0]).get("close") or []
    out = []
    for t, c in zip(ts, cl):
        if c is None:
            continue
        out.append([datetime.fromtimestamp(t, tz=timezone.utc).strftime("%y-%m-%d"), round(float(c), 2)])
    return out[-110:]


def fetch_ecos(key: str, stat: str, item: str, months: int = 36) -> list:
    """ECOS 월간 시계열 → [[YYYY-MM, 값], ...]. 항목 중복(주기별)은 M만."""
    end = date.today()
    start = end - timedelta(days=31 * months)
    s, e = start.strftime("%Y%m"), end.strftime("%Y%m")
    url = (f"https://ecos.bok.or.kr/api/StatisticSearch/{key}/json/kr/1/{months + 6}/"
           f"{stat}/M/{s}/{e}/{item}")
    d = _getj(url).get("StatisticSearch", {})
    out = []
    for r in d.get("row", []):
        v = r.get("DATA_VALUE")
        if v in (None, ""):
            continue
        t = r["TIME"]
        out.append([f"{t[:4]}-{t[4:6]}", round(float(v), 1)])
    # 같은 달 중복(세부항목 합쳐진 응답) 제거 — 마지막 값 사용
    dedup = {}
    for t, v in out:
        dedup[t] = v
    return [[t, dedup[t]] for t in sorted(dedup)]


# ── 글로벌 금리커브 ────────────────────────────────────────────────────────
# 미국: 야후 실시간 만기별(13주·5년·10년·30년) / 주요국: ECOS 902Y023 장·단기(월간)
US_CURVE = [("^IRX", "3개월", 0.25), ("^FVX", "5년", 5), ("^TNX", "10년", 10), ("^TYX", "30년", 30)]
ECOS_RATE_COUNTRIES = [("USA", "🇺🇸 미국"), ("KOR", "🇰🇷 한국"), ("DEU", "🇩🇪 독일"),
                       ("JPN", "🇯🇵 일본"), ("CHN", "🇨🇳 중국"), ("IND", "🇮🇳 인도")]


def fetch_us_curve() -> list:
    """미국 국채 만기별 수익률(야후 실시간) → [{label, years, yield}]."""
    out = []
    for tk, label, yrs in US_CURVE:
        try:
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{tk}?range=5d&interval=1d"
            meta = _getj(url)["chart"]["result"][0]["meta"]
            v = meta.get("regularMarketPrice")
            if v is not None:
                out.append({"label": label, "years": yrs, "yield": round(float(v), 3)})
        except Exception:
            pass
        time.sleep(0.2)
    out.sort(key=lambda c: c["years"])
    print(f"  미국 국채 커브 {len(out)}구간")
    return out


def fetch_global_rates(key: str) -> list:
    """주요국 장기(10년물 성격)·단기 금리 — ECOS 902Y023(월간). 최근값 + 12개월 시계열."""
    end = date.today()
    start = end - timedelta(days=400)
    s, e = start.strftime("%Y%m"), end.strftime("%Y%m")
    out = []
    for code, name in ECOS_RATE_COUNTRIES:
        row = {"country": name}
        for item1, k in (("IRLT", "long"), ("IR3TIB", "short")):
            try:
                url = (f"https://ecos.bok.or.kr/api/StatisticSearch/{key}/json/kr/1/24/"
                       f"902Y023/M/{s}/{e}/{item1}/{code}")
                d = _getj(url).get("StatisticSearch", {})
                pts = [[r["TIME"][:4] + "-" + r["TIME"][4:6], round(float(r["DATA_VALUE"]), 2)]
                       for r in d.get("row", []) if r.get("DATA_VALUE") not in (None, "")]
                if pts:
                    row[k] = pts[-1][1]
                    row[k + "_series"] = pts[-12:]
            except Exception:
                pass
            time.sleep(0.25)
        if row.get("long") is not None or row.get("short") is not None:
            if row.get("long") is not None and row.get("short") is not None:
                row["spread"] = round(row["long"] - row["short"], 2)   # 장단기차(+정상 / −역전)
            out.append(row)
    print(f"  주요국 금리 {len(out)}개국")
    return out


def sector_fundamentals() -> dict:
    """financials(KR) 섹터 합산 — CAPEX·매출·영업이익률(연간, 최근 6년)."""
    try:
        market = json.loads((APP_DATA / "market.json").read_text(encoding="utf-8"))
    except Exception:
        return {}
    sec_of = {f"{t['m']}_{t['t']}": t.get("sector") for t in market.get("heatmap", []) if t["m"] == "kr"}
    # 업종 → 산업군
    g_of = {}
    for gk, (_, secs) in GROUPS.items():
        for s in secs:
            g_of[s] = gk
    agg = {}   # gk → {year: {rev, op, capex, n}}
    fdir = APP_DATA / "financials"
    for key, sec in sec_of.items():
        gk = g_of.get(sec)
        if not gk:
            continue
        p = fdir / f"{key}.json"
        if not p.exists():
            continue
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        src = d.get("cfs") or d.get("ofs") or d
        annual = src.get("annual") or {}
        for y, row in annual.items():
            if not y.isdigit():
                continue
            a = agg.setdefault(gk, {}).setdefault(y, {"rev": 0, "op": 0, "capex": 0, "n": 0})
            if row.get("rev"):
                a["rev"] += row["rev"]
            if row.get("op") is not None:
                a["op"] += row["op"]
            cap = (row.get("capex_ppe") or 0)
            if cap:
                a["capex"] += abs(cap)
            a["n"] += 1
    out = {}
    for gk, years in agg.items():
        ys = sorted(years)[-6:]
        out[gk] = [{"y": y, "rev": round(years[y]["rev"]), "op": round(years[y]["op"]),
                    "capex": round(years[y]["capex"]),
                    "opm": round(years[y]["op"] / years[y]["rev"] * 100, 1) if years[y]["rev"] else None,
                    "n": years[y]["n"]} for y in ys]
    print(f"  섹터 펀더멘털 {len(out)}개 산업군")
    return out


def _fresh(stamp) -> bool:
    if not stamp:
        return False
    try:
        t = datetime.strptime(stamp, "%Y-%m-%d %H:%M").replace(tzinfo=KST)
        return (datetime.now(KST) - t) < timedelta(hours=MAX_AGE_H)
    except Exception:
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    if OUT.exists() and not args.force:
        try:
            if _fresh(json.loads(OUT.read_text(encoding="utf-8")).get("generated")):
                print("sector_metrics 스킵 (20h 이내)")
                return
        except Exception:
            pass

    now = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    payload = {"generated": now, "groups": {k: v[0] for k, v in GROUPS.items()},
               "map": {s: k for k, (_, secs) in GROUPS.items() for s in secs},
               "spec": SPEC, "series": {}, "meta": {}, "fund": {}}

    # 야후 프록시 — SPEC에서 실제 쓰는 키만
    used_yf = sorted({k for sp in SPEC.values() for k in sp["yf"]})
    for k in used_yf:
        tk, name, unit = YF[k]
        try:
            s = fetch_yahoo(tk)
            if s:
                payload["series"][k] = s
                payload["meta"][k] = {"name": name, "unit": unit, "src": "yfinance", "ticker": tk}
        except Exception as e:
            print(f"  야후 {k} 실패({e})", file=sys.stderr)
        time.sleep(0.25)
    print(f"  야후 프록시 {len([k for k in used_yf if k in payload['series']])}/{len(used_yf)}")

    # ECOS
    key = _ecos_key()
    if key:
        used_ec = sorted({k for sp in SPEC.values() for k in sp["ecos"]})
        for k in used_ec:
            stat, item, name = ECOS[k]
            try:
                s = fetch_ecos(key, stat, item)
                if s:
                    payload["series"][k] = s
                    payload["meta"][k] = {"name": name, "unit": "", "src": "한국은행 ECOS", "stat": stat}
            except Exception as e:
                print(f"  ECOS {k} 실패({e})", file=sys.stderr)
            time.sleep(0.3)
        print(f"  ECOS {len([k for k in used_ec if k in payload['series']])}/{len(used_ec)}")
    else:
        print("  ECOS 키 없음 — 생략")

    # 글로벌 금리커브(미국 만기별 실시간 + 주요국 장·단기)
    try:
        payload["us_curve"] = fetch_us_curve()
    except Exception as e:
        print(f"  미국 커브 실패({e})", file=sys.stderr)
    if key:
        try:
            payload["global_rates"] = fetch_global_rates(key)
        except Exception as e:
            print(f"  주요국 금리 실패({e})", file=sys.stderr)

    payload["fund"] = sector_fundamentals()
    OUT.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(f"완료: sector_metrics.json (시계열 {len(payload['series'])}종 · 펀더멘털 {len(payload['fund'])}군)")


if __name__ == "__main__":
    main()

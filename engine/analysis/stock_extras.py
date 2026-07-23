# -*- coding: utf-8 -*-
r"""종목조회 심화 데이터 → app\data\company.json(주1) + feed.json(일1)

- company.json: 기업개요(KR=wisereport/US=yfinance)·로고·컨센서스(목표가·투자의견)·연간 재무(매출/영업이익/이익률)
- feed.json: 종목별 최근 1주 뉴스 + 최근 6개월 공시 (KR=네이버 모바일 API / US=yfinance news+SEC EDGAR)
- 모든 소스 무료·무키. age 가드(company 6일/feed 20h)라 30분 파이프라인에 넣어도 실호출은 주기적.

사용법: python analysis\stock_extras.py [--force] [--company-only|--feed-only] [--quick]
"""
import argparse
import html as html_mod
import json
import re
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from collect import US_TICKERS
from common import APP_DATA, ROOT

KST = timezone(timedelta(hours=9))
COMPANY, FEED = APP_DATA / "company.json", APP_DATA / "feed.json"
UA = {"User-Agent": "Mozilla/5.0"}


def _get(url: str, timeout: int = 12) -> str:
    req = urllib.request.Request(url, headers=UA)
    raw = urllib.request.urlopen(req, timeout=timeout).read()
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("euc-kr", "ignore")


def _getj(url: str):
    return json.loads(_get(url))


def _num(s) -> float | None:
    try:
        v = float(str(s).replace(",", "").replace("%", ""))
        return v if v == v else None  # NaN 차단
    except (ValueError, TypeError):
        return None


def _scrub(o):
    """NaN/Inf 등 JSON 비호환 float → None 재귀 치환 (allow_nan=False 보호)."""
    if isinstance(o, dict):
        return {k: _scrub(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_scrub(v) for v in o]
    if isinstance(o, float) and o != o:  # NaN
        return None
    if isinstance(o, float) and o in (float("inf"), float("-inf")):
        return None
    return o


def _load(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"map": {}}


def _fresh(stamp: str | None, hours: float) -> bool:
    if not stamp:
        return False
    try:
        t = datetime.strptime(stamp, "%Y-%m-%d %H:%M").replace(tzinfo=KST)
        return (datetime.now(KST) - t) < timedelta(hours=hours)
    except Exception:
        return False


def kr_codes() -> dict:
    p = ROOT / "data" / "kr_names.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


# ---------- DART (전자공시) 재무 — 매출·영업이익·순이익 5개년 실적 ----------

def _dart_key() -> str | None:
    import os
    k = os.getenv("DART_API_KEY", "").strip()
    if k:
        return k
    for env in (Path(r"C:\Users\yoo73\fs-doctor\.env"), Path(r"C:\Users\yoo73\dart-scanner\.env")):
        if env.exists():
            m = re.search(r"^DART_API_KEY=(.+)$", env.read_text(encoding="utf-8"), re.M)
            if m:
                return m.group(1).strip().strip('"')
    return None


def _corp_codes(key: str) -> dict:
    """{6자리 종목코드: corp_code} — corpCode.xml 1회 다운로드 후 캐시."""
    cache = ROOT / "data" / "corp_codes.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    import io
    import zipfile
    raw = urllib.request.urlopen(
        f"https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key={key}", timeout=30).read()
    xml = zipfile.ZipFile(io.BytesIO(raw)).read("CORPCODE.xml").decode("utf-8")
    out = {}
    for m in re.finditer(r"<corp_code>(\d+)</corp_code>.*?<stock_code>(\d{6})</stock_code>", xml, re.S):
        out[m.group(2)] = m.group(1)
    cache.write_text(json.dumps(out), encoding="utf-8")
    return out


_DART = (None, {})  # (key, {code: corp_code}) — build_company가 세팅
_DART_ROWS = {"매출액": "rev", "영업이익": "op", "당기순이익": "net"}


def kr_fin_dart(corp_code: str, key: str) -> list:
    """연간 실적 5개년 (fnlttSinglAcnt — 사업보고서, 연결 우선). 단위: 억원."""
    from datetime import date as _date
    years = {}
    for by in (_date.today().year - 1, _date.today().year - 4):  # 각 호출이 3개년 반환 → 최대 6개년
        try:
            d = _getj(f"https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?crtfc_key={key}"
                      f"&corp_code={corp_code}&bsns_year={by}&reprt_code=11011")
            if d.get("status") != "000":
                continue
            rows = d["list"]
            fs = "CFS" if any(r["fs_div"] == "CFS" for r in rows) else "OFS"
            for r in rows:
                if r["fs_div"] != fs or r["account_nm"] not in _DART_ROWS:
                    continue
                k2 = _DART_ROWS[r["account_nm"]]
                for term, ycol in (("thstrm", by), ("frmtrm", by - 1), ("bfefrmtrm", by - 2)):
                    amt = _num(str(r.get(f"{term}_amount", "")).replace(",", ""))
                    if amt is not None:
                        years.setdefault(ycol, {})[k2] = round(amt / 1e8)  # 원→억원
        except Exception:
            pass
    fin = []
    for y in sorted(years):
        v = years[y]
        if v.get("rev") is None:
            continue
        opm = round(v["op"] / v["rev"] * 100, 1) if v.get("op") and v["rev"] else None
        fin.append({"y": str(y), "rev": v.get("rev"), "op": v.get("op"), "opm": opm, "est": False})
    return fin[-5:]


# ---------- company.json (주 1회) ----------

def _qlabel(yyyymm: str) -> str:
    """202509 → 25Q3"""
    y, m = int(yyyymm[:4]), int(yyyymm[4:6])
    return f"{y % 100:02d}Q{(m + 2) // 3}"


def _qlabel_dt(ts) -> str:
    y, m = ts.year, ts.month
    return f"{y % 100:02d}Q{(m + 2) // 3}"


def kr_quarter(code: str) -> tuple:
    """네이버 분기 재무 → (fin_q, metrics, stability_q). 매출/영업이익/순이익 분기 + 투자지표 스냅샷."""
    f = _getj(f"https://m.stock.naver.com/api/stock/{code}/finance/quarter")["financeInfo"]
    titles = {t["key"]: t for t in f["trTitleList"]}
    rows = {r["title"]: r["columns"] for r in f["rowList"]}

    def val(title, key):
        return _num((rows.get(title) or {}).get(key, {}).get("value"))

    keys = sorted(titles)  # YYYYMM 오름차순
    fin_q, stab = [], []
    for k in keys:
        rev, op, np = val("매출액", k), val("영업이익", k), val("당기순이익", k)
        est = titles[k].get("isConsensus") == "Y"
        if rev is not None or op is not None or np is not None:
            fin_q.append({"q": _qlabel(k), "rev": rev, "op": op, "np": np,
                          "opm": val("영업이익률", k), "npm": val("순이익률", k), "est": est})
        dr, qr = val("부채비율", k), val("당좌비율", k)
        if dr is not None or qr is not None:
            row = {"q": _qlabel(k), "est": est}
            if dr is not None:
                row["debtRatio"] = dr
            if qr is not None:
                row["quickRatio"] = qr
            stab.append(row)
    # 투자지표 스냅샷 — 최신 실적 분기(추정 제외) 기준
    latest = next((k for k in reversed(keys) if titles[k].get("isConsensus") != "Y"), keys[-1] if keys else None)
    metrics = {}
    if latest:
        for kor, en in [("PER", "per"), ("PBR", "pbr"), ("EPS", "eps"), ("BPS", "bps"),
                        ("ROE", "roe"), ("부채비율", "debtRatio"), ("당좌비율", "quickRatio"),
                        ("주당배당금", "dps")]:
            v = val(kor, latest)
            if v is not None:
                metrics[en] = v
    return fin_q[-8:], metrics, stab[-8:]


def kr_peers(integ: dict, self_code: str) -> list:
    """integration industryCompareInfo → 동종업계 비교 (시총·주가·등락·3개월수익률)."""
    out = []
    for x in (integ.get("industryCompareInfo") or [])[:6]:
        code = x.get("itemCode")
        if not code or code == self_code:
            continue
        out.append({"ticker": code, "name": x.get("stockName"), "mk": "kr",
                    "price": _num(x.get("closePrice")), "mcap": _num(x.get("marketValue")),
                    "chg": _num(x.get("fluctuationsRatio")), "ret3m": _num(x.get("threeMonthEarningRate"))})
    return out[:5]


def kr_company(code: str) -> dict:
    out = {}
    try:  # 로고 + 컨센서스
        b = _getj(f"https://m.stock.naver.com/api/stock/{code}/basic")
        if b.get("itemLogoUrl"):
            out["logo"] = b["itemLogoUrl"]
        integ = _getj(f"https://m.stock.naver.com/api/stock/{code}/integration")
        c = integ.get("consensusInfo") or {}
        tgt, rec = _num(c.get("priceTargetMean")), _num(c.get("recommMean"))
        if tgt or rec:
            out["cons"] = {"target": tgt, "opinion": rec, "at": c.get("createDate")}
        peers = kr_peers(integ, code)
        if peers:
            out["peers"] = peers
    except Exception:
        pass
    try:  # 분기 재무 + 투자지표 스냅샷 + 분기 안정성
        fq, metrics, stab = kr_quarter(code)
        if fq:
            out["fin_q"] = fq
        if metrics:
            out["metrics"] = metrics
        if stab:
            out["stability_q"] = stab
    except Exception:
        pass
    try:  # 연간 재무: 매출액·영업이익·영업이익률 (실적 3~4 + 추정)
        f = _getj(f"https://m.stock.naver.com/api/stock/{code}/finance/annual")["financeInfo"]
        titles = {t["key"]: t for t in f["trTitleList"]}
        rows = {r["title"]: r["columns"] for r in f["rowList"]}
        fin = []
        for key, t in sorted(titles.items()):
            rev = _num((rows.get("매출액") or {}).get(key, {}).get("value"))
            op = _num((rows.get("영업이익") or {}).get(key, {}).get("value"))
            opm = _num((rows.get("영업이익률") or {}).get(key, {}).get("value"))
            if rev is None and op is None:
                continue
            fin.append({"y": t["title"].rstrip("."), "rev": rev, "op": op, "opm": opm,
                        "est": t.get("isConsensus") == "Y"})
        if fin:
            out["fin"] = fin[-5:]
            out["fin_unit"] = "억원"
        # 확장 지표: 순이익·순이익률·ROE·부채비율·EPS·주당배당금 (연도 조인용 y 동일 포맷)
        _EXT = {"당기순이익": "net", "순이익률": "npm", "ROE": "roe",
                "부채비율": "debt", "EPS": "eps", "주당배당금": "dps"}
        ext = []
        for key, t in sorted(titles.items()):
            row = {"y": t["title"].rstrip("."), "est": t.get("isConsensus") == "Y"}
            has = False
            for kor, en in _EXT.items():
                v = _num((rows.get(kor) or {}).get(key, {}).get("value"))
                if v is not None:
                    row[en] = v
                    has = True
            if has:
                ext.append(row)
        if ext:
            out["fin_ext"] = ext[-6:]
    except Exception:
        pass
    try:  # 기업개요 (wisereport 스냅샷 — 회사 소개·사업구조 서술)
        html = _get(f"https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd={code}")
        m = re.search(r'<ul class="dot_cmp"(.*?)</ul>', html, re.S)
        if m:
            lines = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", li)).strip().lstrip("> ").strip()
                     for li in re.findall(r"<li[^>]*>(.*?)</li>", m.group(1), re.S)]
            lines = [x for x in lines if len(x) > 10]
            if lines:
                out["overview"] = " ".join(lines)[:900]
                out["biz_lines"] = lines[:4]  # 불릿 단위(회사/사업/전략 서술)
    except Exception:
        pass
    try:  # 매출구성 (wisereport 기업개요 상세 — 제품명·구성비%)
        html2 = _get(f"https://navercomp.wisereport.co.kr/v2/company/c1020001.aspx?cmp_cd={code}&cn=")
        i = html2.find("주요제품 매출구성")
        if i > 0:
            txt = re.sub(r"[|\s]+", "|", re.sub(r"<[^>]+>", "|", html2[i:i + 5000]))
            m2 = re.search(r"제품명\|구성비\|(.*?)(?:&nbsp;|차트\|건너뛰기|$)", txt)
            if m2:
                toks = [t for t in m2.group(1).split("|") if t]
                mix = []
                for a, b in zip(toks[::2], toks[1::2]):
                    v = _num(b)
                    if v is not None and -100 <= v <= 100 and not re.match(r"^[-0-9.,]+$", a):
                        mix.append({"name": a.strip(), "pct": v})
                if mix:
                    out["sales_mix"] = mix[:8]
    except Exception:
        pass
    return out


def us_company(tk: str) -> dict:
    import yfinance as yf
    out = {}
    t = yf.Ticker(tk)
    try:
        i = t.info
        if i.get("longBusinessSummary"):
            out["overview"] = i["longBusinessSummary"][:1200]
        ins, inst = i.get("heldPercentInsiders"), i.get("heldPercentInstitutions")
        if ins is not None or inst is not None:
            out["holders_pct"] = {"insider": round((ins or 0) * 100, 2), "inst": round((inst or 0) * 100, 2)}
        if i.get("website"):
            out["website"] = i["website"]
        # 로고: parqet(티커 기반) — clearbit 종료 대체
        out["logo"] = f"https://assets.parqet.com/logos/symbol/{tk}?format=png"
        if i.get("industry"):
            out["industry"] = i["industry"]
        tgt = i.get("targetMeanPrice")
        if tgt:
            out["cons"] = {"target": _num(tgt), "opinion_key": i.get("recommendationKey"),
                           "n": i.get("numberOfAnalystOpinions")}
    except Exception:
        pass
    try:
        fin = t.financials
        rev = fin.loc["Total Revenue"] if "Total Revenue" in fin.index else None
        op = fin.loc["Operating Income"] if "Operating Income" in fin.index else None
        if rev is not None:
            rows = []
            for col in sorted(fin.columns):
                r = _num(rev.get(col))
                o = _num(op.get(col)) if op is not None else None
                if r is None:
                    continue
                rows.append({"y": str(col)[:4], "rev": round(r / 1e6), "op": round(o / 1e6) if o else None,
                             "opm": round(o / r * 100, 1) if (o and r) else None, "est": False})
            if rows:
                out["fin"] = rows[-5:]
                out["fin_unit"] = "$M"
        # 확장 지표: 순이익·순이익률·EPS·ROE·부채비율 (연도 조인)
        ni = fin.loc["Net Income"] if "Net Income" in fin.index else None
        eps_row = None
        for nm in ("Basic EPS", "Diluted EPS"):
            if nm in fin.index:
                eps_row = fin.loc[nm]
                break
        try:
            bs = t.balance_sheet
        except Exception:
            bs = None
        eq = liab = None
        if bs is not None:
            for nm in ("Stockholders Equity", "Common Stock Equity", "Total Equity Gross Minority Interest"):
                if nm in bs.index:
                    eq = bs.loc[nm]
                    break
            for nm in ("Total Liabilities Net Minority Interest", "Total Liab"):
                if nm in bs.index:
                    liab = bs.loc[nm]
                    break
        ext = []
        for col in sorted(fin.columns):
            r = _num(rev.get(col)) if rev is not None else None
            n = _num(ni.get(col)) if ni is not None else None
            e = _num(eps_row.get(col)) if eps_row is not None else None
            q = _num(eq.get(col)) if eq is not None else None
            lb = _num(liab.get(col)) if liab is not None else None
            row = {"y": str(col)[:4], "est": False}
            if n is not None:
                row["net"] = round(n / 1e6)
                if r:
                    row["npm"] = round(n / r * 100, 1)
                if q:
                    row["roe"] = round(n / q * 100, 1)
            if e is not None:
                row["eps"] = round(e, 2)
            if q and lb is not None:
                row["debt"] = round(lb / q * 100, 1)
            if len(row) > 2:
                ext.append(row)
        if ext:
            out["fin_ext"] = ext[-5:]
    except Exception:
        pass
    try:  # 투자지표 스냅샷 (info) — PER/PSR/PBR/EPS/BPS/ROE/EV/유동비율/이자보상/배당
        i = t.info
        m = {}
        for src, en, mul in [("trailingPE", "per", 1), ("priceToSalesTrailing12Months", "psr", 1),
                             ("priceToBook", "pbr", 1), ("trailingEps", "eps", 1), ("bookValue", "bps", 1),
                             ("returnOnEquity", "roe", 100), ("currentRatio", "currentRatio", 100),
                             ("payoutRatio", "payout", 100)]:
            v = _num(i.get(src))
            if v is not None:
                m[en] = round(v * mul, 2)
        if i.get("enterpriseValue"):
            m["ev"] = int(i["enterpriseValue"])
        if i.get("dividendRate"):
            m["dps"] = _num(i["dividendRate"])
        # 이자보상비율 = EBIT / 이자비용 (연간)
        try:
            fin2 = t.financials
            ebit = next((_num(fin2.loc[r].iloc[0]) for r in ("EBIT", "Operating Income") if r in fin2.index), None)
            ie = next((_num(fin2.loc[r].iloc[0]) for r in ("Interest Expense", "Interest Expense Non Operating") if r in fin2.index), None)
            if ebit is not None and ie:
                m["interestCoverage"] = round(ebit / abs(ie) * 100, 1)
        except Exception:
            pass
        if m:
            out["metrics"] = m
    except Exception:
        pass
    try:  # 분기 손익 → fin_q (매출/영업이익/순이익 + 이익률)
        qi = t.quarterly_income_stmt
        rev = next((qi.loc[r] for r in ("Total Revenue", "Operating Revenue") if r in qi.index), None)
        op = qi.loc["Operating Income"] if "Operating Income" in qi.index else None
        ni = next((qi.loc[r] for r in ("Net Income", "Net Income Common Stockholders") if r in qi.index), None)
        if rev is not None:
            fq = []
            for col in sorted(qi.columns):
                r = _num(rev.get(col))
                if r is None:
                    continue
                o = _num(op.get(col)) if op is not None else None
                n = _num(ni.get(col)) if ni is not None else None
                fq.append({"q": _qlabel_dt(col), "rev": round(r / 1e6), "op": round(o / 1e6) if o is not None else None,
                           "np": round(n / 1e6) if n is not None else None,
                           "opm": round(o / r * 100, 1) if o else None, "npm": round(n / r * 100, 1) if n else None,
                           "est": False})
            if fq:
                out["fin_q"] = fq[-8:]
    except Exception:
        pass
    try:  # 분기 재무상태 → stability_q (부채비율·유동비율)
        qb = t.quarterly_balance_sheet
        eq = next((qb.loc[r] for r in ("Stockholders Equity", "Common Stock Equity") if r in qb.index), None)
        lb = next((qb.loc[r] for r in ("Total Liabilities Net Minority Interest",) if r in qb.index), None)
        ca = qb.loc["Current Assets"] if "Current Assets" in qb.index else None
        cl = qb.loc["Current Liabilities"] if "Current Liabilities" in qb.index else None
        stab = []
        for col in sorted(qb.columns):
            q = _num(eq.get(col)) if eq is not None else None
            row = {"q": _qlabel_dt(col), "est": False}
            l = _num(lb.get(col)) if lb is not None else None
            if q and l is not None:
                row["debtRatio"] = round(l / q * 100, 1)
            if q is not None:
                row["equity"] = round(q / 1e6)
            if l is not None:
                row["debt"] = round(l / 1e6)
            a, c = (_num(ca.get(col)) if ca is not None else None), (_num(cl.get(col)) if cl is not None else None)
            if a and c:
                row["currentRatio"] = round(a / c * 100, 1)
            if len(row) > 2:
                stab.append(row)
        if stab:
            out["stability_q"] = stab[-8:]
            if out.get("metrics") is not None and stab[-1].get("debtRatio") is not None:
                out["metrics"].setdefault("debtRatio", stab[-1]["debtRatio"])
    except Exception:
        pass
    try:  # 애널리스트 목표주가(최고/최저/평균) + 의견 분포
        i = t.info
        an = {}
        for src, en in [("targetHighPrice", "targetHigh"), ("targetLowPrice", "targetLow"),
                        ("targetMeanPrice", "targetMean"), ("targetMedianPrice", "targetMedian"),
                        ("numberOfAnalystOpinions", "n")]:
            v = i.get(src)
            if v is not None:
                an[en] = _num(v)
        try:
            rc = t.recommendations
            if rc is not None and len(rc):
                r0 = rc.iloc[0]
                an["opinion"] = {k: int(r0[k]) for k in ("strongBuy", "buy", "hold", "sell", "strongSell") if k in r0}
        except Exception:
            pass
        if an:
            out["analyst"] = an
    except Exception:
        pass
    try:  # 실적 서프라이즈 (EPS 발표 vs 예상)
        ed = t.get_earnings_dates(limit=12)
        if ed is not None and len(ed):
            eps = []
            for idx, r in ed.iterrows():
                act, est = _num(r.get("Reported EPS")), _num(r.get("EPS Estimate"))
                if act is None or est is None:
                    continue
                eps.append({"q": _qlabel_dt(idx), "actual": round(act, 2), "est": round(est, 2),
                            "pct": round((act - est) / abs(est) * 100, 1) if est else None})
            eps = list(reversed(eps))[-8:]
            if eps:
                out["surprise"] = {"eps": eps}
    except Exception:
        pass
    try:  # 배당 이력 (최근 3년)
        i = t.info
        dv = {}
        if i.get("dividendRate"):
            dv["dps"] = _num(i["dividendRate"])
        if _num(i.get("payoutRatio")) is not None:
            dv["payout"] = round(_num(i["payoutRatio"]) * 100, 1)
        try:
            ds = t.dividends
            if ds is not None and len(ds):
                cut = datetime.now(timezone.utc) - timedelta(days=1100)
                hist = [{"d": idx.strftime("%Y-%m-%d"), "amt": round(float(v), 4)}
                        for idx, v in ds.items() if idx.to_pydatetime().replace(tzinfo=timezone.utc) >= cut]
                if hist:
                    dv["history"] = hist[-12:]
        except Exception:
            pass
        if dv:
            out["dividend"] = dv
    except Exception:
        pass
    try:  # 상위 기관 주주 5
        ih = t.institutional_holders
        if ih is not None and len(ih):
            cols = {c.lower(): c for c in ih.columns}
            hc, pc = cols.get("holder"), (cols.get("pctheld") or cols.get("% out"))
            if hc and pc:
                out["holders"] = [{"name": str(r[hc])[:40], "pct": round(float(r[pc]) * (100 if float(r[pc]) < 1 else 1), 2), "rel": "기관"}
                                  for _, r in ih.head(5).iterrows() if r[pc] == r[pc]]
    except Exception:
        pass
    return out


def _kr_parallel(codes: list, fn, label: str, workers: int = 6) -> dict:
    """KR 종목 병렬 수집 (US 러너의 네이버 왕복 지연 상쇄 — 순차 50분→병렬 ~8분)."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    out, done = {}, 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(fn, c): c for c in codes}
        for f in as_completed(futs):
            code = futs[f]
            try:
                d = f.result()
                if d:
                    out[code] = d
            except Exception:
                pass
            done += 1
            if done % 100 == 0:
                print(f"  [{label}] {done}/{len(codes)}")
    return out


def build_company(quick: bool = False, prev: dict | None = None) -> dict:
    global _DART
    key = _dart_key()
    if key:
        try:
            _DART = (key, _corp_codes(key))
            print(f"  DART 연동: corp_code {len(_DART[1])}개")
        except Exception as e:
            print(f"  DART corp_code 실패({e}) — 네이버 재무만", file=sys.stderr)
    else:
        print("  DART_API_KEY 없음 — 네이버 재무만")
    names = kr_codes()
    codes = list(names)[:20] if quick else list(names)
    tickers = US_TICKERS[:5] if quick else US_TICKERS
    cmap = {}
    for code, d in _kr_parallel(codes, kr_company, "KR company").items():
        d.setdefault("logo", f"https://ssl.pstatic.net/imgstock/fn/real/logo/stock/Stock{code}.svg")
        cmap[f"kr_{code}"] = d
    for i, tk in enumerate(tickers, 1):
        d = us_company(tk)
        if d:
            cmap[f"us_{tk}"] = d
        if i % 25 == 0:
            print(f"  [US company] {i}/{len(tickers)}")
        time.sleep(0.2)

    # DART 실적 보강 — 반드시 순차·저속(병렬 시 IP 차단 실사고). 기존 DART 데이터는 재사용.
    if _DART[0]:
        prev = prev or {}
        target_year = str(__import__("datetime").date.today().year - 1)
        done = fail_streak = fetched = 0
        for code in codes:
            k = f"kr_{code}"
            if k not in cmap or code not in _DART[1]:
                continue
            old = prev.get(k, {})
            est = [r for r in cmap[k].get("fin", []) if r.get("est")]
            if old.get("fin_src") == "DART" and any(r["y"] == target_year for r in old.get("fin", [])):
                cmap[k]["fin"] = ([r for r in old["fin"] if not r.get("est")] + est)[-6:]
                cmap[k]["fin_src"] = "DART"
                if old.get("holders"):  # 주주구성도 연 1회 변화 — 재사용
                    cmap[k]["holders"] = old["holders"]
                    if old.get("minor_pct") is not None:
                        cmap[k]["minor_pct"] = old["minor_pct"]
                    continue  # 최신 사업연도 fin+주주 모두 보유
            if fail_streak >= 5:
                continue  # 쿨다운 감지 — 남은 종목은 다음 실행에서
            try:
                if not (old.get("fin_src") == "DART" and any(r["y"] == target_year for r in old.get("fin", []))):
                    dart = kr_fin_dart(_DART[1][code], _DART[0])
                    if dart:
                        cmap[k]["fin"] = (dart + est)[-6:]
                        cmap[k]["fin_src"] = "DART"
                        fetched += 1
                    time.sleep(0.25)
                # 주주구성 (최대주주+특수관계인 상위 / 소액주주 비율)
                hy = _getj(f"https://opendart.fss.or.kr/api/hyslrSttus.json?crtfc_key={_DART[0]}"
                           f"&corp_code={_DART[1][code]}&bsns_year={target_year}&reprt_code=11011")
                if hy.get("status") == "000":
                    rows = {}
                    for r in hy["list"]:
                        pctv = _num(r.get("trmend_posesn_stock_qota_rt"))
                        nm = (r.get("nm") or "").strip()
                        if pctv and nm and nm != "계":
                            rows[nm] = rows.get(nm, 0) + pctv
                    top = sorted(rows.items(), key=lambda x: -x[1])[:6]
                    if top:
                        cmap[k]["holders"] = [{"name": n, "pct": round(v, 2), "rel": "최대주주측"} for n, v in top]
                time.sleep(0.25)
                mr = _getj(f"https://opendart.fss.or.kr/api/mrhlSttus.json?crtfc_key={_DART[0]}"
                           f"&corp_code={_DART[1][code]}&bsns_year={target_year}&reprt_code=11011")
                if mr.get("status") == "000" and mr.get("list"):
                    mp = _num(str(mr["list"][0].get("hold_stock_rate", "")).replace("%", ""))
                    if mp is not None:
                        cmap[k]["minor_pct"] = round(mp, 2)
                fail_streak = 0
            except Exception:
                fail_streak += 1
            done += 1
            if done % 100 == 0:
                print(f"  [DART] {done} 처리 (신규 {fetched})")
            time.sleep(0.3)
        print(f"  DART 보강: 신규 {fetched} (누적은 prev 재사용)")
    print(f"  company {len(cmap)}종목")
    return cmap


# ---------- feed.json (하루 1회) ----------

def _cik_map() -> dict:
    try:
        d = json.loads(urllib.request.urlopen(urllib.request.Request(
            "https://www.sec.gov/files/company_tickers.json",
            headers={"User-Agent": "chart-principles research yoo7337@gmail.com"}), timeout=20).read())
        return {v["ticker"]: str(v["cik_str"]).zfill(10) for v in d.values()}
    except Exception:
        return {}


def kr_reports(code: str) -> list:
    """네이버 증권사 리서치 리포트 최근 5건(무키·미리보기 있음). 한경에 없는 종목 폴백용."""
    out = []
    try:
        arr = _getj(f"https://m.stock.naver.com/api/research/stock/{code}?pageSize=6&page=1")
        for r in (arr or [])[:5]:
            out.append({
                "d": r.get("writeDate", ""), "broker": (r.get("brokerName") or "")[:20],
                "title": re.sub(r"<[^>]+>", "", r.get("title") or "")[:70],
                "preview": re.sub(r"<[^>]+>", "", r.get("previewContent") or "")[:110],
                "link": f"https://finance.naver.com/research/company_read.naver?nid={r.get('researchId')}&itemCode={code}"})
    except Exception:
        pass
    return out


HK_URL = "https://consensus.hankyung.com/analysis/list"


def _hankyung_parse(html_text: str) -> list:
    """한경 컨센서스 기업분석 리스트 HTML → 리포트 리스트(제목의 종목코드 포함)."""
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html_text, re.S):
        tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
        if len(tds) < 6:
            continue
        txt = lambda t: html_mod.unescape(re.sub(r"<[^>]+>", " ", t)).strip()
        date = txt(tds[0])
        if not re.match(r"\d{4}-\d{2}-\d{2}", date):
            continue
        a = re.search(r"<a[^>]*>(.*?)</a>", tds[1], re.S)
        atext = html_mod.unescape(re.sub(r"<[^>]+>", "", a.group(1))).strip() if a else ""
        m = re.match(r"(.+?)\((\d{6})\)\s*(.*)", atext)
        if not m:
            continue
        code, title = m.group(2), re.sub(r"\s+", " ", m.group(3)).strip()[:70]
        tgt = txt(tds[2]).replace(",", "")
        rid = re.search(r"report_idx=(\d+)", tds[1])
        rows.append({
            "d": date, "code": code, "broker": txt(tds[5])[:20], "analyst": txt(tds[4])[:30],
            "title": title, "target": int(tgt) if tgt.isdigit() and tgt != "0" else None,
            "opinion": txt(tds[3])[:20],
            "link": f"https://consensus.hankyung.com/analysis/downpdf?report_idx={rid.group(1)}" if rid else None})
    return rows


def hankyung_reports(days: int = 30, max_pages: int = 60) -> dict:
    """한경 컨센서스 기업분석(CO) 최근 days일 전체 → {종목코드: [리포트 최신5]}.
    전 증권사(유안타·iM·IBK 등 네이버 미제공 포함) + 목표가·투자의견·PDF 직링크."""
    frm = (date.today() - timedelta(days=days)).isoformat()
    to = date.today().isoformat()
    by_code: dict = {}
    seen = set()
    for pg in range(1, max_pages + 1):
        url = (f"{HK_URL}?skinType=business&sdate={frm}&edate={to}"
               f"&now_page={pg}&report_type=CO&pagenum=80")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            html_text = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", "ignore")
        except Exception:
            break
        rows = _hankyung_parse(html_text)
        fresh = [r for r in rows if r.get("link") and r["link"] not in seen]
        if not fresh:  # 새 리포트 없음 = 마지막 페이지 이후(내용 반복) → 중단
            break
        for r in fresh:
            seen.add(r["link"])
            by_code.setdefault(r["code"], []).append(r)
        time.sleep(0.2)
    # 종목별 최신순 5건
    for code in by_code:
        by_code[code].sort(key=lambda r: r["d"], reverse=True)
        by_code[code] = by_code[code][:5]
    print(f"  한경 컨센서스: {len(by_code)}종목 리포트 수집")
    return by_code


def kr_feed(code: str) -> dict:
    out = {"news": [], "disc": [], "reports": kr_reports(code)}
    cut_news = datetime.now(KST) - timedelta(days=7)
    cut_disc = datetime.now(KST) - timedelta(days=183)
    try:
        arr = _getj(f"https://m.stock.naver.com/api/news/stock/{code}?pageSize=12")
        for grp in arr:
            for it in grp.get("items", []):
                try:
                    ts = datetime.strptime(it["datetime"], "%Y%m%d%H%M").replace(tzinfo=KST)
                except Exception:
                    continue
                if ts < cut_news:
                    continue
                out["news"].append({
                    "t": ts.strftime("%m-%d %H:%M"), "title": re.sub(r"<[^>]+>", "", it["title"])[:90],
                    "link": f"https://n.news.naver.com/article/{it['officeId']}/{it['articleId']}",
                    "src": it.get("officeName", "")})
        out["news"] = out["news"][:5]
    except Exception:
        pass
    try:
        arr = _getj(f"https://m.stock.naver.com/api/stock/{code}/disclosure?pageSize=30")
        for it in arr:
            try:
                ts = datetime.fromisoformat(it["datetime"]).replace(tzinfo=KST)
            except Exception:
                continue
            if ts < cut_disc:
                continue
            out["disc"].append({"d": ts.strftime("%Y-%m-%d"), "title": it["title"][:80],
                                "link": f"https://finance.naver.com/item/news_notice.naver?code={code}"})
        out["disc"] = out["disc"][:8]
    except Exception:
        pass
    return out


def us_reports(t) -> list:
    """미국은 리서치 원문이 유료 → yfinance 애널리스트 등급변경(증권사·등급·목표가 변화) 최근 6건을 리포트 대용."""
    out = []
    try:
        u = t.upgrades_downgrades
        if u is None or not len(u):
            return out
        u = u.sort_index(ascending=False).head(6)
        for idx, row in u.iterrows():
            try:
                d = idx.strftime("%Y-%m-%d")
            except Exception:
                d = str(idx)[:10]
            firm = str(row.get("Firm") or "")[:24]
            to_g, from_g = str(row.get("ToGrade") or ""), str(row.get("FromGrade") or "")
            pt, ppt = row.get("currentPriceTarget"), row.get("priorPriceTarget")
            action = str(row.get("Action") or "")
            grade = to_g if not from_g or from_g == to_g else f"{from_g} → {to_g}"
            tgt = ""
            if pt and not (isinstance(pt, float) and pt != pt) and pt > 0:
                tgt = f"목표가 ${pt:.0f}" + (f" (이전 ${ppt:.0f})" if ppt and ppt > 0 and ppt != pt else "")
            act_ko = {"up": "상향", "down": "하향", "init": "신규", "main": "유지", "reit": "유지"}.get(action, action)
            out.append({"d": d, "broker": firm, "grade": grade, "action": act_ko, "target": tgt})
    except Exception:
        pass
    return out


def us_feed(tk: str, cik: str | None) -> dict:
    import yfinance as yf
    tobj = yf.Ticker(tk)
    out = {"news": [], "disc": [], "reports": us_reports(tobj)}
    cut = datetime.now(timezone.utc) - timedelta(days=7)
    try:
        for n in (tobj.news or [])[:12]:
            c = n.get("content") or n
            ts_raw = c.get("pubDate") or n.get("providerPublishTime")
            try:
                ts = (datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00")) if isinstance(ts_raw, str)
                      else datetime.fromtimestamp(ts_raw, tz=timezone.utc))
            except Exception:
                continue
            if ts < cut:
                continue
            link = (c.get("canonicalUrl") or {}).get("url") or n.get("link") or ""
            title = c.get("title") or n.get("title") or ""
            if title and link:
                out["news"].append({"t": ts.astimezone(KST).strftime("%m-%d %H:%M"),
                                    "title": title[:90], "link": link,
                                    "src": (c.get("provider") or {}).get("displayName", "")})
        out["news"] = out["news"][:5]
    except Exception:
        pass
    if cik:
        try:
            d = json.loads(urllib.request.urlopen(urllib.request.Request(
                f"https://data.sec.gov/submissions/CIK{cik}.json",
                headers={"User-Agent": "chart-principles research yoo7337@gmail.com"}), timeout=15).read())
            rec = d["filings"]["recent"]
            cut_d = (date.today() - timedelta(days=183)).isoformat()
            for form, fdate, acc, doc in zip(rec["form"], rec["filingDate"],
                                             rec["accessionNumber"], rec["primaryDocument"]):
                if fdate < cut_d or form not in ("8-K", "10-Q", "10-K", "DEF 14A", "S-1", "4"):
                    continue
                if form == "4" and len(out["disc"]) >= 3:  # 임원거래(Form4)는 과다라 3건 제한
                    continue
                out["disc"].append({"d": fdate, "title": form,
                                    "link": f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc.replace('-', '')}/{doc}"})
                if len(out["disc"]) >= 8:
                    break
        except Exception:
            pass
    return out


def build_feed(quick: bool = False) -> dict:
    names = kr_codes()
    codes = list(names)[:20] if quick else list(names)
    tickers = US_TICKERS[:5] if quick else US_TICKERS
    fmap = {}
    for code, d in _kr_parallel(codes, kr_feed, "KR feed").items():
        if d["news"] or d["disc"] or d.get("reports"):
            fmap[f"kr_{code}"] = d

    # 리포트: 한경 컨센서스(전 증권사·목표가·PDF) 우선, 없으면 네이버(kr_feed에서 이미 수집) 유지
    try:
        hk = hankyung_reports(days=35)
        for code, reps in hk.items():
            k = f"kr_{code}"
            fmap.setdefault(k, {"news": [], "disc": []})["reports"] = reps
    except Exception as e:
        print(f"  한경 리포트 실패({e}) — 네이버 리포트 유지", file=sys.stderr)

    # DART 공시로 교체(원문 딥링크 rcptNo) — 반드시 순차·저속. 실패 시 네이버 공시(목록 링크) 유지.
    key = _dart_key()
    if key:
        try:
            cmap = _corp_codes(key)
        except Exception:
            cmap = {}
        cut = (date.today() - timedelta(days=183)).strftime("%Y%m%d")
        today_s = date.today().strftime("%Y%m%d")
        done = fetched = fail_streak = 0
        for code in codes:
            k = f"kr_{code}"
            cc = cmap.get(code)
            if not cc or fail_streak >= 5:
                continue
            try:
                d = _getj(f"https://opendart.fss.or.kr/api/list.json?crtfc_key={key}&corp_code={cc}"
                          f"&bgn_de={cut}&end_de={today_s}&page_count=8")
                fail_streak = 0
                if d.get("status") == "000" and d.get("list"):
                    disc = [{"d": f"{r['rcept_dt'][:4]}-{r['rcept_dt'][4:6]}-{r['rcept_dt'][6:]}",
                             "title": r["report_nm"][:80],
                             "link": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={r['rcept_no']}"}
                            for r in d["list"][:8]]
                    if disc:
                        fmap.setdefault(k, {"news": [], "disc": []})["disc"] = disc
                        fetched += 1
            except Exception:
                fail_streak += 1
            done += 1
            if done % 150 == 0:
                print(f"  [DART disc] {done} (교체 {fetched})")
            time.sleep(0.25)
        print(f"  DART 공시 딥링크: {fetched}종목 교체 (실패 시 네이버 목록 링크 유지)")
    ciks = _cik_map()
    for i, tk in enumerate(tickers, 1):
        d = us_feed(tk, ciks.get(tk.replace("-", "")))
        if d["news"] or d["disc"]:
            fmap[f"us_{tk}"] = d
        if i % 25 == 0:
            print(f"  [US feed] {i}/{len(tickers)}")
        time.sleep(0.25)
    print(f"  feed {len(fmap)}종목")
    return fmap


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--company-only", action="store_true")
    ap.add_argument("--feed-only", action="store_true")
    ap.add_argument("--quick", action="store_true", help="KR 20 + US 5 (검증용)")
    args = ap.parse_args()
    now = datetime.now(KST).strftime("%Y-%m-%d %H:%M")

    if not args.feed_only:
        cur = _load(COMPANY)
        if args.force or args.quick or not _fresh(cur.get("generated"), 24 * 6):
            print("[1/2] company.json (주 1회)...")
            cmap = build_company(args.quick, cur.get("map"))
            if args.quick:
                cur.get("map", {}).update(cmap)
                cmap = cur["map"]
            elif not _DART[0]:  # DART 키 없는 환경(클라우드)에서 기존 DART 실적 보존
                kept = 0
                for k, old in cur.get("map", {}).items():
                    if old.get("fin_src") == "DART" and k in cmap and cmap[k].get("fin_src") != "DART":
                        cmap[k]["fin"], cmap[k]["fin_src"] = old["fin"], "DART"
                        kept += 1
                if kept:
                    print(f"  DART 실적 보존: {kept}종목 (키 없음 — 추정행만 갱신됨)")
            COMPANY.write_text(json.dumps({"generated": now, "map": _scrub(cmap)},
                                          ensure_ascii=False, allow_nan=False), encoding="utf-8")
        else:
            print("[1/2] company 스킵 (6일 이내)")
    if not args.company_only:
        cur = _load(FEED)
        if args.force or args.quick or not _fresh(cur.get("generated"), 20):
            print("[2/2] feed.json (하루 1회)...")
            fmap = build_feed(args.quick)
            if args.quick:
                cur.get("map", {}).update(fmap)
                fmap = cur["map"]
            FEED.write_text(json.dumps({"generated": now, "map": fmap},
                                       ensure_ascii=False, allow_nan=False), encoding="utf-8")
        else:
            print("[2/2] feed 스킵 (20h 이내)")
    print("완료: stock_extras")


if __name__ == "__main__":
    main()

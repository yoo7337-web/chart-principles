# -*- coding: utf-8 -*-
r"""종목조회 심화 데이터 → app\data\company.json(주1) + feed.json(일1)

- company.json: 기업개요(KR=wisereport/US=yfinance)·로고·컨센서스(목표가·투자의견)·연간 재무(매출/영업이익/이익률)
- feed.json: 종목별 최근 1주 뉴스 + 최근 6개월 공시 (KR=네이버 모바일 API / US=yfinance news+SEC EDGAR)
- 모든 소스 무료·무키. age 가드(company 6일/feed 20h)라 30분 파이프라인에 넣어도 실호출은 주기적.

사용법: python analysis\stock_extras.py [--force] [--company-only|--feed-only] [--quick]
"""
import argparse
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
    try:  # 기업개요 (wisereport)
        html = _get(f"https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd={code}")
        m = re.search(r'<ul class="dot_cmp"(.*?)</ul>', html, re.S)
        if m:
            txt = re.sub(r"<[^>]+>", " ", m.group(1))
            txt = re.sub(r"\s+", " ", txt).strip().lstrip("> ").strip()
            if len(txt) > 30:
                out["overview"] = txt[:600]
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
            out["overview"] = i["longBusinessSummary"][:600]
        if i.get("website"):
            dom = re.sub(r"^https?://(www\.)?", "", i["website"]).split("/")[0]
            out["website"] = i["website"]
            out["logo"] = f"https://logo.clearbit.com/{dom}"
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
                continue  # 최신 사업연도 이미 보유 — 재호출 불필요
            if fail_streak >= 5:
                continue  # 쿨다운 감지 — 남은 종목은 다음 실행에서
            try:
                dart = kr_fin_dart(_DART[1][code], _DART[0])
                fail_streak = 0
                if dart:
                    cmap[k]["fin"] = (dart + est)[-6:]
                    cmap[k]["fin_src"] = "DART"
                    fetched += 1
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


def kr_feed(code: str) -> dict:
    out = {"news": [], "disc": []}
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


def us_feed(tk: str, cik: str | None) -> dict:
    import yfinance as yf
    out = {"news": [], "disc": []}
    cut = datetime.now(timezone.utc) - timedelta(days=7)
    try:
        for n in (yf.Ticker(tk).news or [])[:12]:
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
        if d["news"] or d["disc"]:
            fmap[f"kr_{code}"] = d

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
            COMPANY.write_text(json.dumps({"generated": now, "map": cmap},
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

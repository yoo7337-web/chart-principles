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
    except Exception:
        pass
    return out


def build_company(quick: bool = False) -> dict:
    names = kr_codes()
    codes = list(names)[:20] if quick else list(names)
    tickers = US_TICKERS[:5] if quick else US_TICKERS
    cmap = {}
    for i, code in enumerate(codes, 1):
        d = kr_company(code)
        if d:
            d.setdefault("logo", f"https://ssl.pstatic.net/imgstock/fn/real/logo/stock/Stock{code}.svg")
            cmap[f"kr_{code}"] = d
        if i % 50 == 0:
            print(f"  [KR company] {i}/{len(codes)}")
        time.sleep(0.12)
    for i, tk in enumerate(tickers, 1):
        d = us_company(tk)
        if d:
            cmap[f"us_{tk}"] = d
        if i % 25 == 0:
            print(f"  [US company] {i}/{len(tickers)}")
        time.sleep(0.2)
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
            out["disc"].append({"d": ts.strftime("%Y-%m-%d"), "title": it["title"][:80]})
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
    for i, code in enumerate(codes, 1):
        d = kr_feed(code)
        if d["news"] or d["disc"]:
            fmap[f"kr_{code}"] = d
        if i % 50 == 0:
            print(f"  [KR feed] {i}/{len(codes)}")
        time.sleep(0.12)
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
            cmap = build_company(args.quick)
            if args.quick:
                cur.get("map", {}).update(cmap)
                cmap = cur["map"]
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

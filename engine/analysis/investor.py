# -*- coding: utf-8 -*-
r"""투자자 매매동향 → app\data\investor.json

- 시장별(KOSPI/KOSDAQ) 일별 투자자(개인·외국인·기관) 순매수 — 네이버 investorDealTrendDay(무키).
  최근 ~60거래일 수집(bizdate 페이지네이션). 프런트에서 일간/주간/월간 집계.
- 외국인·기관 순매수/순매도 상위 종목 랭킹 — 네이버 sise_deal_rank(무키).
- ⚠미국은 개인/기관/외국인 구분 미공개(SEC 미보고) → KR 전용.

사용법: python analysis\investor.py [--force]
20h age 가드.
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
from common import APP_DATA

KST = timezone(timedelta(hours=9))
OUT = APP_DATA / "investor.json"
MAX_AGE_H = 20
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}


def _get(url: str, enc: str = "euc-kr") -> str:
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=15).read().decode(enc, "ignore")


def _num(s):
    s = re.sub(r"[^\d\-]", "", s or "")
    return int(s) if s not in ("", "-") else None


def fetch_trend(sosok: str) -> list:
    """investorDealTrendDay — [date, 개인, 외국인, 기관계, ...]. 최근 ~60일(3페이지 병합)."""
    seen, out = set(), []
    biz = date.today()
    for _ in range(4):  # 페이지당 ~20일 → 4회 ~60일 확보
        url = f"https://finance.naver.com/sise/investorDealTrendDay.naver?bizdate={biz.strftime('%Y%m%d')}&sosok={sosok}"
        try:
            html = _get(url)
        except Exception:
            break
        got = 0
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
            tds = [re.sub(r"<[^>]+>|&nbsp;|\s+", " ", t).strip()
                   for t in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
            if len(tds) < 4 or not re.match(r"\d{2}\.\d{2}\.\d{2}", tds[0]):
                continue
            d = "20" + tds[0].replace(".", "-")
            if d in seen:
                continue
            seen.add(d)
            out.append({"d": d, "indi": _num(tds[1]), "foreign": _num(tds[2]), "inst": _num(tds[3])})
            got += 1
        if got == 0:
            break
        oldest = min(seen)
        biz = datetime.strptime(oldest, "%Y-%m-%d").date() - timedelta(days=1)
        time.sleep(0.3)
    out.sort(key=lambda r: r["d"])
    return out[-60:]


def fetch_rank(gubun: str, typ: str) -> list:
    """sise_deal_rank — 외국인(9000)/기관(3000) 순매수(buy)/순매도(sell) 상위."""
    url = f"https://finance.naver.com/sise/sise_deal_rank.naver?investor_gubun={gubun}&type={typ}&page=1"
    try:
        html = _get(url)
    except Exception:
        return []
    out = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        code = re.search(r"code=(\d{6})", tr)
        if not code:
            continue
        tds = [re.sub(r"<[^>]+>|&nbsp;", "", t).strip()
               for t in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        # [순위, 종목명, 현재가, 순매매량, 순매매대금 ...] — 대금은 마지막 숫자열
        nums = [t for t in tds if re.search(r"\d", t)]
        name_m = re.search(r"code=\d{6}[^>]*>([^<]+)</a>", tr)
        name = name_m.group(1).strip() if name_m else ""
        vals = [_num(t) for t in tds if _num(t) is not None]
        out.append({"code": code.group(1), "name": name,
                    "last": vals[0] if vals else None,
                    "net": vals[-1] if len(vals) > 1 else None})
        if len(out) >= 10:
            break
    return out


def _fresh(stamp) -> bool:
    if not stamp:
        return False
    try:
        return (datetime.now(KST) - datetime.strptime(stamp, "%Y-%m-%d %H:%M").replace(tzinfo=KST)) < timedelta(hours=MAX_AGE_H)
    except Exception:
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    if OUT.exists() and not args.force:
        try:
            if _fresh(json.loads(OUT.read_text(encoding="utf-8")).get("generated")):
                print("investor 스킵 (20h 이내)")
                return
        except Exception:
            pass
    now = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    payload = {"generated": now, "trend": {}, "rank": {}}
    for sosok, key in (("01", "kospi"), ("02", "kosdaq")):
        payload["trend"][key] = fetch_trend(sosok)
        print(f"  {key} 투자자 동향 {len(payload['trend'][key])}일")
        time.sleep(0.3)
    for gubun, gk in (("9000", "foreign"), ("3000", "inst")):
        for typ in ("buy", "sell"):
            payload["rank"][f"{gk}_{typ}"] = fetch_rank(gubun, typ)
            time.sleep(0.3)
    print(f"  랭킹 외국인매수 {len(payload['rank'].get('foreign_buy', []))}·매도 {len(payload['rank'].get('foreign_sell', []))}")
    OUT.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(f"완료: investor.json")


if __name__ == "__main__":
    main()

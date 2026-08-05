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


def build_rank_from_supply(top: int = 10) -> dict:
    """외국인·기관 20일 누적 순매수 랭킹 — 우리 stocks/*.json supply_sum 기반(자체 계산).

    ⚠구 fetch_rank(네이버 sise_deal_rank)는 **순매수/순매도가 동일 결과**였다(실사고):
      · 페이지가 `type` 파라미터를 무시하고 같은 화면 반환
      · 심지어 본문 랭킹표가 JS 렌더라 우리가 긁던 <table>은 사이드바 위젯("기관순매수상위7"·"인기검색어")
    → 자체 수급(supply_sum.frgn_20/inst_20, 단위 억원)으로 상·하위를 직접 산출해 정확도 확보.
    """
    stocks = APP_DATA / "stocks"
    rows = []
    for p in stocks.glob("kr_*.json"):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        ss = d.get("supply_sum") or {}
        f20, i20 = ss.get("frgn_20"), ss.get("inst_20")
        if f20 is None and i20 is None:
            continue
        # ⚠series는 v214부터 압축 배열 [t,o,h,l,c,v]다(구 dict 형식도 허용) — .get("c")로 읽으면 크래시
        sl = (d.get("series") or [None])[-1]
        last = (sl[4] if isinstance(sl, list) else (sl or {}).get("c")) if sl else None
        rows.append({"code": d.get("ticker"), "name": d.get("name"), "last": last,
                     "f20": f20, "i20": i20})
    out = {}
    for gk, key in (("foreign", "f20"), ("inst", "i20")):
        vals = [r for r in rows if r.get(key) is not None]
        buy = sorted(vals, key=lambda r: -r[key])[:top]
        sell = sorted(vals, key=lambda r: r[key])[:top]
        fmt = lambda r: {"code": r["code"], "name": r["name"], "last": r["last"], "net": round(r[key], 1)}
        out[f"{gk}_buy"] = [fmt(r) for r in buy]
        out[f"{gk}_sell"] = [fmt(r) for r in sell]
    print(f"  랭킹(자체 수급 {len(rows)}종목): 외국인 매수 1위 "
          f"{out['foreign_buy'][0]['name'] if out.get('foreign_buy') else '-'} · 매도 1위 "
          f"{out['foreign_sell'][0]['name'] if out.get('foreign_sell') else '-'}")
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
    payload["rank"] = build_rank_from_supply()
    OUT.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(f"완료: investor.json")


if __name__ == "__main__":
    main()

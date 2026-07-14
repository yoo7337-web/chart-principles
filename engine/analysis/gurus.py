# -*- coding: utf-8 -*-
r"""투자 대가 13F 포트폴리오 → app\data\gurus.json (주 1회 가드 — 13F는 분기 공시)

- SEC EDGAR 공개 API(무료): submissions JSON → 최근 13F-HR 2건 → infotable XML 파싱
- 산출: 매니저별 상위 15 보유(비중) + 전분기 대비 변화(신규/증액/축소/청산)
- Thesis: Gemini가 보유·변화로 추정한 투자 논지(AI 추정임을 UI에 명시)
- 참고: 13F는 분기말 기준 45일 지연 공시. 트럼프 등 정치인은 13F 비대상이라 제외.

사용법: python analysis\gurus.py [--force]
"""
import argparse
import json
import re
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import APP_DATA

OUT = APP_DATA / "gurus.json"
MAX_AGE_DAYS = 7
UA = {"User-Agent": "chart-principles personal research yoo7337@gmail.com"}  # SEC 요구사항

GURUS = [
    {"id": "buffett", "name": "워런 버핏", "fund": "Berkshire Hathaway", "cik": 1067983,
     "style": "초장기 가치투자 — 경제적 해자·현금창출력"},
    {"id": "marks", "name": "하워드 막스", "fund": "Oaktree Capital", "cik": 949509,
     "style": "부실채권·역발상 — 사이클과 심리의 극단에서 매수"},
    {"id": "ackman", "name": "빌 애크먼", "fund": "Pershing Square", "cik": 1336528,
     "style": "집중 행동주의 — 소수 종목에 대규모 베팅"},
    {"id": "burry", "name": "마이클 버리", "fund": "Scion Asset Management", "cik": 1649339,
     "style": "딥밸류·역발상 — 빅쇼트의 주인공, 극단적 집중"},
    {"id": "druckenmiller", "name": "스탠리 드러켄밀러", "fund": "Duquesne Family Office", "cik": 1536411,
     "style": "매크로 톱다운 — 추세에 크게, 틀리면 빨리 손절"},
    {"id": "tepper", "name": "데이비드 테퍼", "fund": "Appaloosa Management", "cik": 1656456,
     "style": "위기 매수 전문 — 공포 국면의 신용·주식에 공격적"},
]


def get_json(url: str):
    req = urllib.request.Request(url, headers=UA)
    return json.loads(urllib.request.urlopen(req, timeout=30).read().decode("utf-8"))


def get_text(url: str) -> str:
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "ignore")


def latest_13f_accessions(cik: int, n: int = 2) -> list:
    """최근 13F-HR n건 → [(accession, report_date, filing_date)]"""
    sub = get_json(f"https://data.sec.gov/submissions/CIK{cik:010d}.json")
    rec = sub["filings"]["recent"]
    out = []
    for form, acc, rdate, fdate in zip(rec["form"], rec["accessionNumber"],
                                       rec["reportDate"], rec["filingDate"]):
        if form in ("13F-HR", "13F-HR/A") and len(out) < n:
            if out and out[-1][1] == rdate:  # 같은 분기 수정공시(A)는 최신 것만
                continue
            out.append((acc, rdate, fdate))
    return out


def parse_infotable(cik: int, accession: str) -> dict:
    """13F infotable XML → {issuer: {"value": $합계, "shares": 합계}} (옵션 포지션 제외)"""
    acc = accession.replace("-", "")
    idx = get_json(f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/index.json")
    xml_files = [f["name"] for f in idx["directory"]["item"]
                 if f["name"].lower().endswith(".xml") and "primary_doc" not in f["name"].lower()]
    if not xml_files:
        return {}
    xml = get_text(f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/{xml_files[0]}")

    holdings = defaultdict(lambda: {"value": 0.0, "shares": 0.0})
    for block in re.findall(r"<(?:\w+:)?infoTable>(.*?)</(?:\w+:)?infoTable>", xml, re.S):
        def tag(name):
            m = re.search(rf"<(?:\w+:)?{name}>(.*?)</(?:\w+:)?{name}>", block, re.S)
            return m.group(1).strip() if m else ""
        if tag("putCall"):  # 옵션은 별도 성격이라 제외
            continue
        issuer = re.sub(r"\s+", " ", tag("nameOfIssuer")).upper()
        try:
            value = float(tag("value").replace(",", ""))
            shares = float(re.sub(r"<.*?>", " ", tag("shrsOrPrnAmt")).split()[0].replace(",", ""))
        except (ValueError, IndexError):
            continue
        holdings[issuer]["value"] += value
        holdings[issuer]["shares"] += shares
    return dict(holdings)


def diff_holdings(cur: dict, prev: dict) -> list:
    """상위 15 보유 + 변화 태그. 청산된 대형 포지션도 별도 포함."""
    total = sum(h["value"] for h in cur.values()) or 1
    rows = []
    for issuer, h in sorted(cur.items(), key=lambda x: -x[1]["value"])[:15]:
        p = prev.get(issuer)
        if p is None:
            change = "new"
        else:
            d = (h["shares"] - p["shares"]) / p["shares"] if p["shares"] else 0
            change = "add" if d > 0.03 else "trim" if d < -0.03 else "hold"
        rows.append({"issuer": issuer.title(), "weight": round(h["value"] / total, 4),
                     "value": h["value"], "change": change,
                     "chg_shares": round((h["shares"] - p["shares"]) / p["shares"], 3) if p and p["shares"] else None})
    prev_total = sum(h["value"] for h in prev.values()) or 1
    sold = [{"issuer": k.title(), "weight_prev": round(v["value"] / prev_total, 4), "change": "exit"}
            for k, v in sorted(prev.items(), key=lambda x: -x[1]["value"])[:15] if k not in cur]
    return rows, sold[:5], total


def gen_thesis(g: dict, rows: list, sold: list) -> str | None:
    from gemini_util import generate, sanitize
    top = ", ".join(f"{r['issuer']}({r['weight']*100:.1f}%{'·신규' if r['change']=='new' else '·증액' if r['change']=='add' else '·축소' if r['change']=='trim' else ''})" for r in rows[:10])
    exits = ", ".join(s["issuer"] for s in sold) or "없음"
    prompt = f"""당신은 헤지펀드 13F 공시 분석가입니다. 아래 최신 분기 공시를 바탕으로
{g['name']}({g['fund']})의 현재 포트폴리오가 시사하는 투자 논지를 추정하세요.
알려진 투자 스타일: {g['style']}

상위 보유(비중·변화): {top}
전분기 대비 청산: {exits}

형식(한국어, 3~4문장, <b>만 허용, URL 금지):
- 포트폴리오가 말하는 핵심 테마/베팅 1~2가지
- 이번 분기 변화(신규/증액/청산)가 시사하는 것
- 마지막 문장은 이 스타일 투자자의 관점 요약"""
    raw = generate(prompt, max_tokens=1024)
    return sanitize(raw) if raw else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    if OUT.exists() and not args.force:
        gen = date.fromisoformat(json.loads(OUT.read_text(encoding="utf-8"))["generated"])
        if (date.today() - gen).days < MAX_AGE_DAYS:
            print(f"gurus 스냅샷 {gen} — {MAX_AGE_DAYS}일 미경과, 스킵")
            return

    managers = []
    for g in GURUS:
        try:
            accs = latest_13f_accessions(g["cik"])
            if not accs:
                print(f"  {g['fund']}: 13F 없음", file=sys.stderr)
                continue
            cur = parse_infotable(g["cik"], accs[0][0])
            time.sleep(0.3)
            prev = parse_infotable(g["cik"], accs[1][0]) if len(accs) > 1 else {}
            rows, sold, total = diff_holdings(cur, prev)
            thesis = gen_thesis(g, rows, sold)
            managers.append({
                **{k: g[k] for k in ("id", "name", "fund", "style")},
                "report_date": accs[0][1], "filing_date": accs[0][2],
                "total_value": total, "n_positions": len(cur),
                "holdings": rows, "exits": sold, "thesis": thesis,
            })
            print(f"  {g['fund']}: {accs[0][1]} 분기, {len(cur)}종목, "
                  f"상위 {rows[0]['issuer']}({rows[0]['weight']*100:.0f}%), Thesis {'OK' if thesis else '없음'}")
            time.sleep(0.4)
        except Exception as e:
            print(f"  {g['fund']} 실패: {e}", file=sys.stderr)

    OUT.write_text(json.dumps({"generated": date.today().isoformat(), "managers": managers},
                              ensure_ascii=False), encoding="utf-8")
    print(f"완료: gurus.json — {len(managers)}/{len(GURUS)}명")


if __name__ == "__main__":
    main()

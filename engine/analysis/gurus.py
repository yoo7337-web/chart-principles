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
    {"id": "dalio", "name": "레이 달리오", "fund": "Bridgewater Associates", "cik": 1350694,
     "style": "매크로 분산 — 세계 최대 헤지펀드, 전천후(All Weather) 관점"},
    {"id": "klarman", "name": "세스 클라만", "fund": "Baupost Group", "cik": 1061768,
     "style": "딥밸류 교과서 — 안전마진과 비유동 자산의 절대수익 추구"},
    {"id": "liLu", "name": "리 루", "fund": "Himalaya Capital", "cik": 1709323,
     "style": "멍거가 인정한 집중 가치투자 — 극소수 종목 장기 보유"},
    {"id": "wood", "name": "캐시 우드", "fund": "ARK Invest", "cik": 1697748,
     "style": "파괴적 혁신 성장주 — ETF라 보유내역 공개 투명성 최상위"},
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


def brk_liquidity() -> dict | None:
    """버크셔 유동성 추이 (SEC XBRL companyconcept, 분기 10-Q/10-K).

    현금성 = CashCashEquivalentsRestrictedCash... + 채권AFS / 주식 = EquitySecuritiesFvNi.
    ⚠단기 T-bill은 이 세계 XBRL에 별도 태그가 없어 미포함 — 라벨에 명시(현금·현금성+채권 기준).
    현금비중 = 현금성 / (현금성 + 주식포트폴리오).
    """
    tags = {"cash": "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
            "debt": "AvailableForSaleSecuritiesDebtSecurities",
            "eq": "EquitySecuritiesFvNi"}
    series = {}
    for k, tag in tags.items():
        d = get_json(f"https://data.sec.gov/api/xbrl/companyconcept/CIK0001067983/us-gaap/{tag}.json")
        for x in d["units"]["USD"]:
            if x.get("form") in ("10-Q", "10-K"):
                series.setdefault(x["end"], {})[k] = x["val"]
        time.sleep(0.3)
    rows = []
    for end in sorted(series):
        v = series[end]
        if "cash" not in v or "eq" not in v:
            continue
        liq = v["cash"] + v.get("debt", 0)
        rows.append({"d": end, "cash": round(liq / 1e9, 1),
                     "ratio": round(liq / (liq + v["eq"]) * 100, 1)})
    return {"series": rows[-10:], "note": "현금·현금성(제한 포함)+채권AFS 기준, 단기 T-bill 별도태그 없음"} if rows else None


# 트럼프 — 13F 비대상(기관 운용역 아님) → 공개 재산신고(OGE Form 278e)·공시·언론보도 기반 정적 큐레이션.
# ⚠비중·평가액은 추정이며 부정기 갱신(13F처럼 분기 자동 갱신 불가). 갱신 시 이 블록을 수동 수정.
TRUMP_STATIC = {
    "id": "trump", "name": "도널드 트럼프", "fund": "개인 자산 (Trump Organization 외)",
    "style": "브랜드·부동산 제국 + 미디어·암호화폐 — 레버리지와 브랜드 라이선스 중심",
    "type": "disclosure",
    "source": "OGE 공개 재산신고(Form 278e)·SEC 공시(DJT)·언론 보도 종합 — 추정치, 부정기 갱신",
    "report_date": "2025-06 신고분", "filing_date": None,
    "total_value": None, "n_positions": None,
    "holdings": [
        {"issuer": "Trump Media & Technology(DJT) 지분 — 약 1.15억주(신탁 보유)", "weight": None, "change": "hold", "chg_shares": None},
        {"issuer": "암호화폐 — $TRUMP 밈코인 지분·World Liberty Financial($WLFI)·비트코인 채굴(American Bitcoin)", "weight": None, "change": "hold", "chg_shares": None},
        {"issuer": "부동산 — 마러라고·트럼프타워 등 상업·리조트 (Trump Organization)", "weight": None, "change": "hold", "chg_shares": None},
        {"issuer": "현금·채권 — 신고 기준 수억 달러 유동자산(라이선스·행사 수입 포함)", "weight": None, "change": "hold", "chg_shares": None},
        {"issuer": "브랜드 라이선스·상품 — 시계·스니커즈·서적 등 로열티", "weight": None, "change": "hold", "chg_shares": None},
    ],
    "exits": [],
    "thesis": "상장 미디어 지분(DJT)과 암호화폐 프로젝트가 자산 변동성의 대부분을 차지하며, 전통 자산(부동산·현금)은"
              " 안정 축. 13F 의무가 없어 분기 추적이 불가능하므로 여기 수치는 공개 신고·보도 기반 추정으로만 볼 것.",
}


# 한국 — 13F 제도 부재: 5% 대량보유 공시(DART)·펀드 운용보고서·국민연금 공시로만 일부 공개.
# ⚠전체 포트폴리오가 아닌 "공개된 일부"임을 카드마다 명시. 갱신은 수동 큐레이션.
KR_SOURCE = "DART 대량보유(5%) 공시 자동 수집(최근 6개월) — 5% 미만 보유는 비공시라 전체 포트폴리오 아님"

# 제출인명(flr_nm) 매칭 키워드 — DART D001(대량보유상황보고서) 스캔용
KR_MATCH = {
    "nps": ["국민연금"], "parkyo": ["박영옥"], "vip": ["브이아이피자산운용"],
    "kang": ["에셋플러스자산운용"], "lcw": ["라이프자산운용"], "heo": ["신영자산운용"],
    "truston": ["트러스톤자산운용"], "align": ["얼라인파트너스"], "kcgi": ["케이씨지아이"],
    "timefolio": ["타임폴리오자산운용"],
}


def kr_dart_holdings() -> dict:
    """최근 6개월 DART D001 전수 스캔 → 관심 제출인별 실보유(공시) 종목. {id: [(corp, 최근일, 건수)]}"""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from stock_extras import _dart_key, _getj
    key = _dart_key()
    if not key:
        return {}
    from datetime import timedelta
    today = date.today()
    windows = [((today - timedelta(days=180)).strftime("%Y%m%d"), (today - timedelta(days=91)).strftime("%Y%m%d")),
               ((today - timedelta(days=90)).strftime("%Y%m%d"), today.strftime("%Y%m%d"))]
    raw = defaultdict(dict)  # id -> corp -> {"d": 최근일, "n": 건수}
    for b, e in windows:
        pg = 1
        while True:
            try:
                d = get_json(f"https://opendart.fss.or.kr/api/list.json?crtfc_key={key}&pblntf_ty=D"
                             f"&pblntf_detail_ty=D001&bgn_de={b}&end_de={e}&page_count=100&page_no={pg}")
            except Exception:
                break
            if d.get("status") != "000":
                break
            for r in d["list"]:
                for gid, keys in KR_MATCH.items():
                    if any(k in r["flr_nm"] for k in keys):
                        c = raw[gid].setdefault(r["corp_name"], {"d": r["rcept_dt"], "n": 0})
                        c["n"] += 1
                        c["d"] = max(c["d"], r["rcept_dt"])
            if pg >= int(d.get("total_page", 1)):
                break
            pg += 1
            time.sleep(0.12)
    out = {}
    for gid, corps in raw.items():
        rows = sorted(corps.items(), key=lambda x: -int(x[1]["d"]))
        out[gid] = [(c, v["d"], v["n"]) for c, v in rows]
    return out
KR_STATIC = [
    {"id": "nps", "name": "국민연금", "fund": "국민연금공단 기금운용본부",
     "style": "국내 최대 큰손 — 지분 공시 자체가 수급 이벤트",
     "holdings": ["국내 주식 약 150조원 운용 — 삼성전자·SK하이닉스 등 대형주 전반 5~10% 보유",
                  "분기별 국내주식 대량보유 내역 공시(기금운용본부 홈페이지·DART)",
                  "지분율 변동(특히 10% 룰 관련 매도)이 대형주 수급의 주요 변수"]},
    {"id": "parkyo", "name": "박영옥 (주식농부)", "fund": "개인 투자자",
     "style": "농심(農心) 투자 — 기업과 동행하는 장기 집중, 농업·중소형 가치주",
     "holdings": ["5% 이상 보유로 공시된 종목만 확인 가능(대표적 슈퍼개미 공시 사례)",
                  "농업·식품·중소형 제조 가치주 위주 — 조광피혁 등 장기 보유 이력",
                  "DART '대량보유상황보고서'로 추적"]},
    {"id": "vip", "name": "VIP자산운용 (김민국·최준철)", "fund": "VIP자산운용",
     "style": "국내 가치투자 대표 하우스 — 저평가 우량주 장기",
     "holdings": ["운용보고서·기고를 통해 종목 논리를 공개하는 드문 하우스",
                  "5% 공시 종목 다수(중소형 가치주) — DART 추적 가능"]},
    {"id": "kang", "name": "강방천", "fund": "에셋플러스자산운용",
     "style": "1등 기업론 — 산업 내 지배력 있는 기업 장기 보유",
     "holdings": ["'코리아리치투게더' 등 공모펀드 보고서로 보유 종목 확인 가능",
                  "모바일·플랫폼·소비 1등주 선호로 알려짐"]},
    {"id": "lcw", "name": "이채원", "fund": "라이프자산운용",
     "style": "한국 가치투자 1세대 — 최근 행동주의 결합",
     "holdings": ["한국투자밸류 시절부터 저PBR·자산주 중심",
                  "라이프운용의 행동주의 캠페인(SK 등)으로 지분·의도 공시"]},
    {"id": "heo", "name": "허남권", "fund": "신영자산운용",
     "style": "정통 장기 가치투자 — 배당·자산가치 중시",
     "holdings": ["'신영밸류' 시리즈 운용보고서로 보유 종목 공개",
                  "저평가 대형·중형 가치주 장기 보유 스타일"]},
    {"id": "truston", "name": "트러스톤자산운용", "fund": "트러스톤자산운용",
     "style": "행동주의 — 지배구조 개선 캠페인",
     "holdings": ["태광산업·BYC 등 캠페인으로 지분·주주서한 공개",
                  "캠페인 종목은 5% 공시 + 언론으로 의도까지 드러남"]},
    {"id": "align", "name": "얼라인파트너스 (이창환)", "fund": "얼라인파트너스자산운용",
     "style": "행동주의 — 은행주 밸류업 캠페인 주도",
     "holdings": ["JB금융 등 은행 지주 캠페인 — 투자 논리를 가장 적극 공개",
                  "공개 주주서한·프레젠테이션으로 목표 지분·논리 확인 가능"]},
    {"id": "kcgi", "name": "KCGI (강성부)", "fund": "KCGI",
     "style": "지배구조 투자 — 승계·지배구조 이벤트 드리븐",
     "holdings": ["한진칼 사태로 유명 — 지배구조 관련 지분 공시 다수",
                  "DART 대량보유 공시로 캠페인 종목 추적"]},
    {"id": "timefolio", "name": "타임폴리오자산운용", "fund": "타임폴리오자산운용",
     "style": "국내 대표 헤지펀드 하우스 — 롱숏·이벤트 드리븐",
     "holdings": ["사모 중심이라 비공개가 원칙이나 ETF 라인업(TIMEFOLIO 액티브)은 보유내역 매일 공개",
                  "ETF 보유내역이 하우스 뷰의 힌트"]},
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    if OUT.exists() and not args.force:
        gen = date.fromisoformat(json.loads(OUT.read_text(encoding="utf-8"))["generated"])
        if (date.today() - gen).days < MAX_AGE_DAYS:
            print(f"gurus 스냅샷 {gen} — {MAX_AGE_DAYS}일 미경과, 스킵")
            return

    prev_thesis = {}
    if OUT.exists():
        try:
            for m in json.loads(OUT.read_text(encoding="utf-8"))["managers"]:
                if m.get("thesis"):
                    prev_thesis[(m["id"], m.get("report_date"))] = m["thesis"]
        except Exception:
            pass

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
            thesis = gen_thesis(g, rows, sold) or prev_thesis.get((g["id"], accs[0][1]))
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

    # 버핏 현금(유동성) 추이 부착
    try:
        liq = brk_liquidity()
        if liq:
            for m in managers:
                if m["id"] == "buffett":
                    m["cash"] = liq
                    print(f"  버크셔 유동성: {len(liq['series'])}분기, 최근 현금비중 {liq['series'][-1]['ratio']}%")
    except Exception as e:
        print(f"  버크셔 유동성 실패: {e}", file=sys.stderr)

    for m in managers:
        m["country"] = "us"
    TRUMP_STATIC["country"] = "us"
    managers.append(TRUMP_STATIC)  # 13F 비대상 — 공개 신고 기반 정적 카드
    try:
        kr_hold = kr_dart_holdings()
        print(f"  KR 대량보유 공시 스캔: {sum(len(v) for v in kr_hold.values())}종목 "
              f"({', '.join(f'{k}:{len(v)}' for k, v in kr_hold.items())})")
    except Exception as e:
        kr_hold = {}
        print(f"  KR 공시 스캔 실패({e}) — 서술 카드만", file=sys.stderr)
    for k in KR_STATIC:  # 한국 — DART 대량보유 공시 자동 수집 + 스타일 서술
        real = kr_hold.get(k["id"], [])
        fmt_d = lambda d: f"{d[4:6]}/{d[6:8]}"
        if real:
            shown = real[:15]
            holds = [f"{c} — 최근 보고 {fmt_d(d)}{f' · 공시 {n}건' if n > 1 else ''}" for c, d, n in shown]
            if len(real) > 15:
                holds.append(f"… 외 {len(real) - 15}종목 (최근 6개월 공시 기준)")
        else:
            holds = k["holdings"] + ["(최근 6개월 내 5% 신규·변동 공시 없음)"]
        managers.append({**k, "country": "kr", "type": "disclosure", "source": KR_SOURCE,
                         "corps": [[c, d, n] for c, d, n in real],  # 전체(집계용) — 카드 표시는 상위 15
                         "report_date": f"최근 6개월 공시 {len(real)}종목" if real else "공시 없음",
                         "filing_date": None, "total_value": None, "n_positions": len(real) or None,
                         "holdings": [{"issuer": h, "weight": None, "change": "hold", "chg_shares": None}
                                      for h in holds],
                         "exits": [], "thesis": "스타일: " + k["style"] + " · " +
                                    " / ".join(k["holdings"][:2])})

    OUT.write_text(json.dumps({"generated": date.today().isoformat(), "managers": managers},
                              ensure_ascii=False), encoding="utf-8")
    print(f"완료: gurus.json — {len(managers)}명 (13F {len(managers)-1} + 공개신고 1)")


if __name__ == "__main__":
    main()

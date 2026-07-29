# -*- coding: utf-8 -*-
r"""공시 스캐너 — DART 전체 공시를 **날짜별로 누적** 저장한다.

종목조회의 공시(feed.json)는 '그 종목의 최근 1년'이라 시장 전체를 훑을 수 없다.
이 스크립트는 반대로 **하루치 시장 전체 공시**를 모아 날짜별 파일로 쌓는다.

출력
  app/data/disclosures/{YYYY-MM-DD}.json  — 그날 공시 전량(압축 배열)
  app/data/disclosures/index.json         — 보유 날짜 목록 + 건수(달력·네비게이션용)

⚠하루 700~900건이라 **필드를 배열로 압축**해 저장한다(객체로 두면 용량 3배).
⚠오래된 날짜는 RETENTION_DAYS로 정리한다(무한 증가 방지 — repo 비대화).
"""
import argparse
import json
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "app" / "data" / "disclosures"
KST = timezone(timedelta(hours=9))
RETENTION_DAYS = 180          # 보관 상한(약 6개월 ≈ 16MB)
MARKETS = ("Y", "K")          # 유가증권·코스닥만(코넥스 N·기타 E는 노이즈라 제외)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from stock_extras import _dart_key, _getj  # noqa: E402

MK_KO = {"Y": "코스피", "K": "코스닥", "N": "코넥스", "E": "기타"}

# ── 카테고리 ───────────────────────────────────────────────────────────
# 위에서부터 먼저 맞는 것을 채택(순서가 곧 우선순위). 실적·계약처럼 투자 판단에
# 직결되는 것을 위에 둬서 '보고서' 같은 범용어에 먹히지 않게 한다.
CATS = [
    ("earnings",  "실적·재무", "📊",
     r"영업\(?잠정\)?실적|매출액또는손익구조|결산실적|현금흐름표|재무제표|감사보고서|사업보고서"
     r"|분기보고서|반기보고서"),
    ("contract",  "계약·수주", "📝",
     r"공급계약|수주|계약체결|납품|수출계약|판매계약|기술이전|라이선스"),
    ("alert",     "시장조치·제재", "⚠️",
     r"불성실공시|관리종목|상장폐지|거래정지|투자주의|투자경고|투자위험|매매거래정지|조회공시|풍문"
     r"|소송|횡령|배임|중대재해|파산|회생|감사의견|시장위원회|기타시장안내|상장적격성"),
    ("dividend",  "배당", "💵", r"배당"),
    ("treasury",  "자기주식", "🔁",
     # 소각·신탁(자사주 신탁)·주식병합은 주주환원/주식수 조정이라 같은 묶음이 읽기 좋다
     r"자기주식|자사주|주식소각|신탁계약|주식병합"),
    ("ma",        "M&A·구조개편", "🤝",
     r"합병|분할|영업양수|영업양도|주식교환|주식이전|타법인주식|자산양수|자산양도|현물출자|자회사편입"),
    ("capital",   "자본조달", "💰",
     # 증권신고서·발행실적·일괄신고·파생결합증권까지 모두 '자금조달' 흐름
     r"유상증자|무상증자|전환사채|신주인수권|교환사채|전환가액|행사가액|유상감자|무상감자|감자결정"
     r"|사채권|출자|증권신고서|투자설명서|증권발행|일괄신고|파생결합|조건부자본증권|소액공모"
     r"|전환청구권|차입|채무보증|주식매수선택권"),
    ("stake",     "지분·주주", "👥",
     r"대량보유상황|소유상황보고서|최대주주|주식담보|의결권|공개매수|특별관계자|특수관계인"
     r"|주주명부|기준일설정"),
    ("ir",        "IR·안내공시", "📢",
     r"기업설명회|IR개최|투자판단관련|자율준수프로그램|대규모기업집단현황|지속가능경영|안내공시"
     r"|약관에의한금융거래"),
    ("govern",    "지배구조·주총", "🏛️",
     r"주주총회|이사회|임원|대표이사|사외이사|독립이사|감사위원|정관"),
    ("facility",  "투자·설비", "🏭",
     r"신규시설투자|유형자산|공장|증설|취득결정|처분결정"),
]
CAT_ETC = ("etc", "기타", "📄")
CAT_META = {c[0]: {"name": c[1], "icon": c[2]} for c in CATS}
CAT_META[CAT_ETC[0]] = {"name": CAT_ETC[1], "icon": CAT_ETC[2]}
CAT_ORDER = [c[0] for c in CATS] + [CAT_ETC[0]]

_CATS_RE = [(cid, re.compile(pat)) for cid, _n, _i, pat in CATS]
_FIX_RE = re.compile(r"\[(기재정정|정정|첨부정정|첨부추가|연장결정|변경)\]")


def categorize(report_nm: str) -> str:
    """공시명 → 카테고리 id. 정정 태그는 제거하고 본문으로 판정한다."""
    base = _FIX_RE.sub("", report_nm)
    for cid, rx in _CATS_RE:
        if rx.search(base):
            return cid
    return CAT_ETC[0]


def fetch_day(key: str, d: date) -> list:
    """하루치 공시 전량(페이지네이션). DART는 page_count 최대 100."""
    ymd = d.strftime("%Y%m%d")
    out, page = [], 1
    while page <= 30:                       # 안전 상한(3,000건)
        url = (f"https://opendart.fss.or.kr/api/list.json?crtfc_key={key}"
               f"&bgn_de={ymd}&end_de={ymd}&page_no={page}&page_count=100")
        js = None
        for attempt in range(4):            # DART는 간헐적 SSL EOF가 난다 → 재시도 필수
            try:
                js = _getj(url)
                break
            except Exception:
                time.sleep(1.5 * (attempt + 1))
        if js is None:
            print(f"  {d} page{page} 실패 — 중단", file=sys.stderr)
            break
        st = js.get("status")
        if st == "013":                     # 조회 결과 없음(휴일)
            break
        if st != "000":
            print(f"  {d} DART status={st} {js.get('message')}", file=sys.stderr)
            break
        out.extend(js.get("list") or [])
        if page >= int(js.get("total_page") or 1):
            break
        page += 1
        time.sleep(0.2)
    return out


_PX = None


def _vol_ratio(code: str, d: date):
    """공시일 거래량 급증 배율 = max(당일, 익일) ÷ 직전 20일 평균.

    DART엔 조회수가 없어(응답 필드 9개뿐) '시장이 이 공시에 반응했나'를 거래량으로 대신 본다.
    ⚠익일까지 보는 이유: 장 마감 후 공시는 당일 거래량에 반영되지 않는다.
    """
    global _PX
    if _PX is None:
        try:
            sys.path.insert(0, str(Path(__file__).resolve().parent))
            from collect import load_all
            _PX = {t: df for (mk, t), df in load_all().items() if mk == "kr"}
            print(f"  거래량 참조 {len(_PX)}종목 로드")
        except Exception as e:
            print(f"  거래량 로드 실패({e}) — 배율 생략", file=sys.stderr)
            _PX = {}
    df = _PX.get(code)
    if df is None or len(df) < 25:
        return None
    try:
        v = df["volume"]
        idx = v.index.searchsorted(pd.Timestamp(d))     # 공시일 위치(휴장이면 다음 거래일)
        if idx >= len(v) or idx < 21:
            return None
        base = float(v.iloc[idx - 20:idx].mean())
        if not base or base <= 0:
            return None
        cur = float(v.iloc[idx:idx + 2].max())          # 당일·익일 중 큰 쪽
        r = cur / base
        return round(r, 1) if r == r and r < 200 else None
    except Exception:
        return None


def build_day(key: str, d: date) -> dict | None:
    rows = fetch_day(key, d)
    if not rows:
        return None
    items, counts = [], {}
    for r in rows:
        if r.get("corp_cls") not in MARKETS:
            continue
        nm = re.sub(r"\s+", " ", (r.get("report_nm") or "")).strip()
        cid = categorize(nm)
        counts[cid] = counts.get(cid, 0) + 1
        flr = (r.get("flr_nm") or "").strip()
        corp = (r.get("corp_name") or "").strip()
        items.append([
            corp,                                  # 0 회사명
            (r.get("stock_code") or "").strip(),    # 1 종목코드(종목조회 링크)
            r.get("corp_cls"),                      # 2 시장
            nm,                                     # 3 공시명
            (r.get("rcept_no") or "").strip(),      # 4 접수번호(원문 링크)
            "" if flr == corp else flr,             # 5 제출인(회사와 다를 때만)
            cid,                                    # 6 카테고리
            1 if _FIX_RE.search(nm) else 0,         # 7 정정 여부
            _vol_ratio((r.get("stock_code") or "").strip(), d),  # 8 거래량 급증 배율(반응도)
        ])
    if not items:
        return None
    return {"date": d.isoformat(), "n": len(items), "counts": counts,
            "generated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"),
            "items": items}


def save_day(day: dict) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / f"{day['date']}.json").write_text(
        json.dumps(day, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def rebuild_index() -> dict:
    """보관 파일을 훑어 index.json 재생성 + 보관기간 초과분 삭제(멱등)."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cutoff = (date.today() - timedelta(days=RETENTION_DAYS)).isoformat()
    days = []
    for p in sorted(OUT_DIR.glob("20*.json")):
        ds = p.stem
        if ds < cutoff:
            p.unlink()
            continue
        try:
            j = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        days.append({"d": ds, "n": j.get("n", 0), "counts": j.get("counts", {})})
    days.sort(key=lambda x: x["d"], reverse=True)
    idx = {"generated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"),
           "cats": {c: CAT_META[c] for c in CAT_ORDER}, "order": CAT_ORDER, "days": days}
    (OUT_DIR / "index.json").write_text(
        json.dumps(idx, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return idx


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=3, help="오늘부터 거슬러 수집할 일수")
    ap.add_argument("--since", help="YYYY-MM-DD 부터 오늘까지(백필)")
    ap.add_argument("--force", action="store_true", help="이미 있는 날짜도 다시 수집")
    args = ap.parse_args()

    key = _dart_key()
    if not key:
        print("DART_API_KEY 없음 — 공시 스캔 건너뜀", file=sys.stderr)
        return

    today = datetime.now(KST).date()
    if args.since:
        start = date.fromisoformat(args.since)
        targets = [start + timedelta(days=i) for i in range((today - start).days + 1)]
    else:
        targets = [today - timedelta(days=i) for i in range(args.days)]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    new = skip = empty = 0
    for d in targets:
        if d > today:
            continue
        f = OUT_DIR / f"{d.isoformat()}.json"
        # 오늘은 장중에도 계속 쌓이므로 항상 갱신, 과거는 이미 있으면 건너뜀(재실행 비용 0)
        if f.exists() and d != today and not args.force:
            skip += 1
            continue
        day = build_day(key, d)
        if not day:
            empty += 1
            continue
        save_day(day)
        new += 1
        print(f"  {d} {day['n']}건")
    idx = rebuild_index()
    print(f"공시 스캔 완료: 갱신 {new} · 스킵 {skip} · 공시없음(휴일) {empty} "
          f"→ 보유 {len(idx['days'])}일")


if __name__ == "__main__":
    main()

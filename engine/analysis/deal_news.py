# -*- coding: utf-8 -*-
r"""M&A·자본거래 딜 뉴스 → app\data\deals.json

deal-radar 프로젝트의 수집 계층만 재사용(load_sources→fetch_all→filter_relevant —
소스 7개: 더벨·딜사이트 site: 색인 포함). 추적 DB·텔레그램 발송은 사용하지 않음(독립 스냅샷).

사용법:
    python analysis\deal_news.py                # 수집 + Gemini 딜 브리핑 (하루 3회 배치)
    python analysis\deal_news.py --no-curation  # 수집만, 기존 브리핑 보존 (30분 배치)
"""
import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, r"C:\Users\yoo73\deal-radar")  # deal_radar 패키지 재사용

from common import APP_DATA

KST = timezone(timedelta(hours=9))
MAX_AGE_H = 24
OUT = APP_DATA / "deals.json"

DEAL_BRIEF_PROMPT = """당신은 기업금융(M&A·자본시장) 데스크의 에디터입니다.
아래 최근 24시간 딜 뉴스 제목들을 읽고 핵심 딜/테마 3~5개로 묶어 브리핑을 작성하세요.

규칙:
- 제목·인사말·날짜 헤더 없이 바로 <b>1. 테마명</b>부터 시작 (날짜를 지어내지 말 것)
- 각 항목: <b>딜/테마명</b> 뒤 1~2문장(거래 주체·규모·의미), 끝에 [근거 #n] 인용 필수
- 한국어 400~700자, 마크다운·URL 금지, <b>만 허용, 확인된 사실만

뉴스 목록:
{articles}"""


def norm_title(t: str) -> str:
    return re.sub(r"[\s\[\]()'\"…·,.]+", "", t)[:30]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-curation", action="store_true")
    args = ap.parse_args()

    from deal_radar.collect import filter_relevant
    from deal_radar.config import load_sources
    from deal_radar.sources import fetch_all

    arts = filter_relevant(fetch_all(load_sources()))
    cutoff = datetime.now(timezone.utc) - timedelta(hours=MAX_AGE_H)
    seen, items = set(), []
    for a in arts:
        try:
            pub = datetime.fromisoformat(str(a.published))  # ISO 문자열
            if pub.tzinfo is None:
                pub = pub.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            continue
        if pub < cutoff:
            continue
        title = re.sub(r"\s+-\s+[^-]+$", "", a.title).strip()
        # site: 색인 노이즈 제거(매체명만 있는 항목 등)
        if len(title) < 10 or title.lower().startswith(("thebell", "dealsite", "-", "더벨")):
            continue
        k = norm_title(title)
        if k in seen:
            continue
        seen.add(k)
        items.append({"t": pub.astimezone(KST).strftime("%m-%d %H:%M"), "ts": pub.timestamp(),
                      "title": title,
                      "link": a.url, "src": a.source, "region": a.region,
                      "priority": bool(getattr(a, "priority", False))})
    items.sort(key=lambda x: -x["ts"])

    premium = [x for x in items if x["priority"]][:15]
    kr = [x for x in items if not x["priority"] and x["region"] == "KR"][:20]
    glob = [x for x in items if not x["priority"] and x["region"] != "KR"][:15]

    if args.no_curation:
        old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
        brief, brief_at = old.get("brief"), old.get("brief_at")
        print("딜 브리핑 생략(--no-curation) — 기존 보존")
    else:
        pool = (premium + kr + glob)[:40]
        if not pool:  # 빈 목록에 브리핑 생성 금지(환각 방지)
            brief, brief_at = None, None
        else:
            from gemini_util import attach_refs, generate, sanitize
            listing = "\n".join(f"[{i+1}] ({'⭐' if a['priority'] else a['region']}) {a['title']}"
                                for i, a in enumerate(pool))
            raw = generate(DEAL_BRIEF_PROMPT.format(articles=listing))
            brief = attach_refs(sanitize(raw), pool) if raw else None
            brief_at = datetime.now(KST).strftime("%Y-%m-%d %H:%M") if brief else None

    strip = lambda arr: [{k: v for k, v in x.items() if k not in ("ts", "priority", "region")} for x in arr]
    generated = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    OUT.write_text(json.dumps({
        "generated": generated,
        "brief": brief, "brief_at": brief_at,
        "premium": strip(premium), "kr": strip(kr), "global": strip(glob),
    }, ensure_ascii=False), encoding="utf-8")

    # 누적 아카이브 (덮어써도 과거 보존)
    from archive_util import append_articles, append_briefing
    n_add = append_articles("deals", strip(premium) + strip(kr) + strip(glob))
    append_briefing("deals", generated, brief)
    print(f"  아카이브: +{n_add}건 신규")

    print(f"완료: deals.json — ⭐{len(premium)} / 🇰🇷{len(kr)} / 🌐{len(glob)}, "
          f"브리핑 {'OK' if brief else '없음'}")


if __name__ == "__main__":
    main()

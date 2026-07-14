# -*- coding: utf-8 -*-
r"""시장 뉴스 + 보유종목 속보 수집(Google News RSS) → app\data\news.json

- 시장 키워드 + stock-radar holdings.yaml 종목명, 최근 24시간, 제목 중복 제거
- 정적 사이트 특성상 실시간이 아님(하루 3회 배치) — 웹에 갱신시각 표시

사용법: python analysis\market_news.py
"""
import json
import re
import sys
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import APP_DATA

HOLDINGS = Path(r"C:\Users\yoo73\stock-radar\holdings.yaml")
MARKET_QUERIES = ["코스피 증시", "미국 증시 마감", "연준 금리", "원달러 환율", "반도체 업황"]
MAX_AGE_H = 24
KST = timezone(timedelta(hours=9))


def fetch_rss(query: str) -> list:
    import feedparser
    url = ("https://news.google.com/rss/search?q=" + urllib.parse.quote(query)
           + "&hl=ko&gl=KR&ceid=KR:ko")
    feed = feedparser.parse(url)
    out = []
    cutoff = datetime.now(timezone.utc) - timedelta(hours=MAX_AGE_H)
    for e in feed.entries[:20]:
        try:
            pub = datetime(*e.published_parsed[:6], tzinfo=timezone.utc)
        except Exception:
            continue
        if pub < cutoff:
            continue
        title = re.sub(r"\s+-\s+[^-]+$", "", e.title).strip()  # 꼬리 매체명 제거
        src = getattr(getattr(e, "source", None), "title", "") or ""
        out.append({"t": pub.astimezone(KST).strftime("%m-%d %H:%M"),
                    "ts": pub.timestamp(), "title": title, "link": e.link, "src": src})
    return out


def norm_title(t: str) -> str:
    return re.sub(r"[\s\[\]()'\"…·,.]+", "", t)[:30]


def dedupe(items: list) -> list:
    seen, out = set(), []
    for it in sorted(items, key=lambda x: -x["ts"]):
        k = norm_title(it["title"])
        if k in seen:
            continue
        seen.add(k)
        out.append(it)
    return out


MARKET_BRIEF_PROMPT = """당신은 개인 투자자를 위한 시장 뉴스 에디터입니다.
아래 번호 매긴 최근 24시간 뉴스 제목들을 읽고, 핵심 테마 3~5개로 묶어 브리핑을 작성하세요.

규칙:
- 각 테마: <b>테마명</b> 뒤에 1~2문장 요약, 문장 끝에 [근거 #n #m] 형식으로 근거 기사 번호를 반드시 인용
- 한국어 400~700자, 마크다운·URL 금지, <b> 태그만 허용
- 과장 없이 사실만, 숫자가 있으면 포함

뉴스 목록:
{articles}"""

HOLDINGS_BRIEF_PROMPT = """아래는 개인 투자자의 보유 종목 관련 최근 24시간 뉴스입니다.
종목별로 1줄씩(핵심만) 요약하세요. 형식: <b>종목명</b>: 요약 [근거 #n]
한국어, 종목당 1줄, 마크다운·URL 금지, <b> 태그만 허용. 뉴스 없는 종목은 생략.

뉴스 목록:
{articles}"""


def curate(market: list, holdings: list) -> dict | None:
    """Gemini 큐레이션 — 실패 시 None(수집 뉴스는 그대로 유지)."""
    from gemini_util import attach_refs, generate, sanitize

    out = {}
    if market:
        arts = "\n".join(f"[{i+1}] {a['title']} ({a['src']})" for i, a in enumerate(market))
        raw = generate(MARKET_BRIEF_PROMPT.format(articles=arts))
        if raw:
            out["market"] = attach_refs(sanitize(raw), market)
    if holdings:
        arts = "\n".join(f"[{i+1}] ({a.get('stock','')}) {a['title']}" for i, a in enumerate(holdings))
        raw = generate(HOLDINGS_BRIEF_PROMPT.format(articles=arts), max_tokens=1024)
        if raw:
            out["holdings"] = attach_refs(sanitize(raw), holdings)
    return out or None


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-curation", action="store_true",
                    help="Gemini 큐레이션 생략(장중 30분 배치용) — 기존 큐레이션 보존")
    args = ap.parse_args()

    market = []
    for q in MARKET_QUERIES:
        try:
            market += fetch_rss(q)
        except Exception as e:
            print(f"  '{q}' 실패: {e}", file=sys.stderr)
        time.sleep(0.3)
    market = dedupe(market)[:30]

    holdings_news = []
    if HOLDINGS.exists():
        import yaml
        holdings = yaml.safe_load(HOLDINGS.read_text(encoding="utf-8"))["holdings"]
        for h in holdings:
            q = h.get("query") or re.sub(r"\(.*?\)", "", h["name"]).strip()
            try:
                for it in fetch_rss(f"{q} 주가")[:3]:
                    holdings_news.append({**it, "stock": h["name"]})
            except Exception:
                pass
            time.sleep(0.3)
    holdings_news = dedupe(holdings_news)[:20]

    out_path = APP_DATA / "news.json"
    if args.no_curation:
        old = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else {}
        curation = old.get("curation")
        curation_at = old.get("curation_at")
        print("큐레이션 생략(--no-curation) — 기존 보존")
    else:
        curation = curate(market, holdings_news)
        curation_at = datetime.now(KST).strftime("%Y-%m-%d %H:%M") if curation else None

    payload = {
        "generated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"),
        "curation": curation, "curation_at": curation_at,
        "market": [{k: v for k, v in it.items() if k != "ts"} for it in market],
        "holdings": [{k: v for k, v in it.items() if k != "ts"} for it in holdings_news],
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    # 누적 아카이브 (덮어써도 과거 보존)
    from archive_util import append_articles, append_briefing
    n_add = append_articles("news", market + holdings_news)
    append_briefing("news", payload["generated"], curation)
    print(f"  아카이브: +{n_add}건 신규")

    print(f"완료: news.json — 시장 {len(market)}건, 보유종목 {len(holdings_news)}건, "
          f"큐레이션 {'OK' if curation else '없음'}")


if __name__ == "__main__":
    main()

"""RSS / Google News 피드에서 기사 수집."""
from __future__ import annotations

import time
import urllib.parse
from dataclasses import dataclass
from datetime import datetime, timezone

import feedparser


@dataclass
class Article:
    title: str
    url: str
    source: str          # 소스(피드) 이름
    region: str          # KR | GLOBAL
    published: str       # ISO8601 문자열 (없으면 수집시각)
    summary: str = ""
    priority: bool = False   # 더벨·딜사이트 등 전용 섹션으로 분리할 우선 출처


def _google_news_url(spec: dict) -> str:
    """sources.yaml 의 google_news 항목을 Google News RSS URL로 변환."""
    query = spec["query"]
    when = spec.get("when")
    if when:
        query = f"{query} when:{when}"
    lang = spec.get("lang", "ko")
    country = spec.get("country", "KR")
    params = {
        "q": query,
        "hl": lang,
        "gl": country,
        "ceid": f"{country}:{lang.split('-')[0]}",
    }
    return "https://news.google.com/rss/search?" + urllib.parse.urlencode(params)


def _clean_google_title(title: str) -> str:
    """Google News 제목 끝의 ' - 매체명' 접미사 제거(엔티티 오매칭 방지)."""
    idx = title.rfind(" - ")
    if idx > 0 and len(title) - idx <= 40:  # 끝부분의 매체명만 제거
        return title[:idx].strip()
    return title


def _entry_published(entry) -> str:
    for key in ("published_parsed", "updated_parsed"):
        val = getattr(entry, key, None)
        if val:
            return datetime.fromtimestamp(time.mktime(val), tz=timezone.utc).isoformat()
    return datetime.now(timezone.utc).isoformat()


def fetch_source(spec: dict) -> list[Article]:
    """단일 소스에서 기사 리스트 수집. 실패해도 예외 전파하지 않음."""
    name = spec.get("name", "unknown")
    region = spec.get("region", "GLOBAL")
    priority = bool(spec.get("priority", False))
    is_google = spec["type"] == "google_news"
    if is_google:
        url = _google_news_url(spec)
    else:
        url = spec["url"]

    try:
        feed = feedparser.parse(url)
    except Exception as exc:  # 네트워크/파싱 오류는 건너뜀
        print(f"  ! 소스 실패 [{name}]: {exc}")
        return []

    articles: list[Article] = []
    for entry in feed.entries:
        title = (getattr(entry, "title", "") or "").strip()
        link = (getattr(entry, "link", "") or "").strip()
        if not title or not link:
            continue
        if is_google:
            title = _clean_google_title(title)
        articles.append(
            Article(
                title=title,
                url=link,
                source=name,
                region=region,
                published=_entry_published(entry),
                summary=(getattr(entry, "summary", "") or "")[:500],
                priority=priority,
            )
        )
    print(f"  · {name}: {len(articles)}건")
    return articles


def fetch_all(sources: list[dict]) -> list[Article]:
    """모든 소스 수집 후 합쳐 반환."""
    out: list[Article] = []
    for spec in sources:
        out.extend(fetch_source(spec))
    return out

"""기업금융 관련성 필터링 및 딜 엔티티 추출(키워드 기반, AI 미사용)."""
from __future__ import annotations

import re

from .config import KEYWORDS, STOPWORDS
from .sources import Article

_KW_LOWER = [k.lower() for k in KEYWORDS]
# 한글 2자 이상 또는 영문 대문자로 시작하는 토큰을 엔티티 후보로 봄
_TOKEN_RE = re.compile(r"[가-힣]{2,}|[A-Z][A-Za-z0-9&.]+")


def is_relevant(article: Article) -> bool:
    """제목 또는 요약에 기업금융 키워드가 포함되면 True."""
    text = f"{article.title} {article.summary}".lower()
    return any(kw in text for kw in _KW_LOWER)


def extract_entities(title: str) -> list[str]:
    """제목에서 회사/주체로 보이는 엔티티 토큰 추출 (딜 그룹핑용)."""
    candidates = _TOKEN_RE.findall(title)
    out: list[str] = []
    seen: set[str] = set()
    for tok in candidates:
        norm = tok.strip(".&").lower()
        if len(norm) < 2 or norm in STOPWORDS:
            continue
        if norm in seen:
            continue
        seen.add(norm)
        out.append(norm)
    return out


def filter_relevant(articles: list[Article]) -> list[Article]:
    return [a for a in articles if is_relevant(a)]

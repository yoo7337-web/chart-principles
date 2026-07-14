# -*- coding: utf-8 -*-
r"""뉴스·딜 누적 아카이브 유틸 — 매 배치가 덮어써도 과거를 남기기 위함.

- append_articles: 제목 정규화 dedup → 신규만 first_seen 스탬프로 추가, 30일 초과 prune (매 실행)
- append_briefing: 시점별 AI 브리핑 스냅샷 누적, 30일·60개 상한 (큐레이션 생성 시에만)

용량: 중복 제거 + 30일 상한이라 정상상태 ~2MB. (매 실행 통째 저장은 연 600MB+라 금지)
"""
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

APP_DATA = Path(__file__).resolve().parent.parent / "app" / "data"
KST = timezone(timedelta(hours=9))
KEEP_DAYS = 30
MAX_BRIEFINGS = 60


def _now() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d %H:%M")


def _norm(title: str) -> str:
    return re.sub(r"[\s\[\]()'\"…·,.]+", "", title or "")[:40]


def _fresh(ts: str) -> bool:
    """ts('YYYY-MM-DD HH:MM')가 최근 KEEP_DAYS 이내인가."""
    try:
        d = datetime.strptime(ts[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return True  # 파싱 실패 시 보존(안전)
    return (datetime.now(KST).date() - d).days <= KEEP_DAYS


def append_articles(kind: str, articles: list) -> int:
    """{kind}_archive.json에 신규 기사만 first_seen 스탬프로 추가. 추가 건수 반환."""
    path = APP_DATA / f"{kind}_archive.json"
    arch = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"items": []}
    seen = {_norm(it["title"]) for it in arch["items"]}
    now = _now()
    added = 0
    for a in articles:
        key = _norm(a.get("title", ""))
        if not key or key in seen:
            continue
        seen.add(key)
        rec = {k: a[k] for k in ("title", "link", "src", "stock", "t") if k in a and a[k]}
        rec["first_seen"] = now
        arch["items"].append(rec)
        added += 1
    arch["items"] = [it for it in arch["items"] if _fresh(it.get("first_seen", now))]
    arch["items"].sort(key=lambda x: x.get("first_seen", ""), reverse=True)
    arch["generated"] = now
    path.write_text(json.dumps(arch, ensure_ascii=False), encoding="utf-8")
    return added


def append_briefing(kind: str, generated: str, curation) -> None:
    """{kind}_briefings.json에 시점별 브리핑 스냅샷 누적 (curation truthy일 때만)."""
    if not curation:
        return
    path = APP_DATA / f"{kind}_briefings.json"
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"entries": []}
    entries = [e for e in data["entries"] if e.get("ts") != generated]  # 같은 시각은 갱신
    entries.append({"ts": generated, "curation": curation})
    entries = [e for e in entries if _fresh(e.get("ts", ""))]
    entries.sort(key=lambda x: x.get("ts", ""), reverse=True)
    data["entries"] = entries[:MAX_BRIEFINGS]
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

# -*- coding: utf-8 -*-
r"""섹터별 최신 기사 → app\data\sector_news.json (하루 1회 가드)

- 대상: KR 시총 상위 12개 섹터(market.json heatmap 합산) + US 11개 GICS 섹터
- 소스: Google News RSS ("{섹터} 업황" / "미국 {섹터}주"), 섹터당 4건
- 섹터로테이션 탭의 섹터 펼침에서 표시 — 산업 동향 정성 파악용
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import feedparser

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import APP_DATA

KST = timezone(timedelta(hours=9))
OUT = APP_DATA / "sector_news.json"
GUARD_H = 20
PER_SECTOR = 4
US_SECTORS = ["기술", "커뮤니케이션", "임의소비재", "필수소비재", "금융", "헬스케어",
              "산업재", "에너지", "유틸리티", "부동산", "소재"]


def _fresh() -> bool:
    if not OUT.exists():
        return False
    try:
        g = json.loads(OUT.read_text(encoding="utf-8"))["generated"]
        t = datetime.strptime(g, "%Y-%m-%d %H:%M").replace(tzinfo=KST)
        return (datetime.now(KST) - t) < timedelta(hours=GUARD_H)
    except Exception:
        return False


def top_kr_sectors(n: int = 12) -> list:
    """market.json 히트맵에서 섹터별 시총 합산 상위 n."""
    p = APP_DATA / "market.json"
    if not p.exists():
        return []
    tiles = json.loads(p.read_text(encoding="utf-8")).get("heatmap", [])
    agg = {}
    for t in tiles:
        if t.get("m") == "kr" and t.get("sector"):
            agg[t["sector"]] = agg.get(t["sector"], 0) + (t.get("mcap") or 0)
    return [s for s, _ in sorted(agg.items(), key=lambda x: -x[1])[:n]]


def fetch(query: str) -> list:
    url = ("https://news.google.com/rss/search?q=" +
           __import__("urllib.parse", fromlist=["quote"]).quote(f"{query} when:7d") +
           "&hl=ko&gl=KR&ceid=KR:ko")
    feed = feedparser.parse(url)
    items = []
    for e in feed.entries[:PER_SECTOR * 2]:
        try:
            ts = datetime(*e.published_parsed[:6], tzinfo=timezone.utc).astimezone(KST)
        except Exception:
            continue
        src = e.source.title if hasattr(e, "source") else ""
        title = e.title.rsplit(" - ", 1)[0] if " - " in e.title else e.title
        items.append({"t": ts.strftime("%m-%d %H:%M"), "title": title[:90],
                      "link": e.link, "src": src})
        if len(items) >= PER_SECTOR:
            break
    return items


def main():
    force = "--force" in sys.argv
    if not force and _fresh():
        print("sector_news 스킵 (20h 이내)")
        return
    out = {"kr": {}, "us": {}}
    for sec in top_kr_sectors():
        out["kr"][sec] = fetch(f"{sec} 업황 OR {sec} 산업 동향")
    for sec in US_SECTORS:
        out["us"][sec] = fetch(f"미국 {sec} 섹터 OR 미국 {sec}주")
    n = sum(len(v) for d in out.values() for v in d.values())
    OUT.write_text(json.dumps({"generated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"),
                               **out}, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(f"완료: sector_news.json — KR {len(out['kr'])}섹터 + US {len(out['us'])}섹터, 기사 {n}건")


if __name__ == "__main__":
    main()

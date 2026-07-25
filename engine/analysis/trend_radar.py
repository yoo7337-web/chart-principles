# -*- coding: utf-8 -*-
r"""트렌드 레이더 — 검색어 순위·트래픽으로 소비 트렌드 탐지 → app\data\trends.json

목적: 소비재 등에서 대중 관심이 급등하는 제품·브랜드를 검색 데이터로 선제 포착 → 관련주 연결.

소스(전부 무료):
- 네이버 데이터랩 검색어트렌드(공식 API): data\trend_watchlist.json 키워드 1년 일간 상대지수
  → 급등 판정(최근 7일 평균 ÷ 이전 8주 평균). ⚠앱에 '데이터랩' API 권한(Scope) 등록 필요 —
  미등록이면 해당 파트 생략(구글 파트는 독립 동작).
- 네이버 데이터랩 쇼핑인사이트: 소비재 카테고리 ~10개 3개월 검색 트렌드 + 급등률.
- 구글 트렌드 일간 급상승 RSS(geo=KR/US): 오늘 뜨는 검색어 + 대략 트래픽 + 관련 기사.
  (pytrends는 2025-04 아카이브·429 차단으로 미사용)
- Gemini(옵션): 급상승 검색어 → 우리 유니버스 내 관련 상장사 추정("AI 추정" 라벨, 실패 시 생략).

사용법: python analysis\trend_radar.py [--force] [--no-gemini]
20h age 가드 — daily_signals.bat 편입용.
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import APP_DATA

KST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parent.parent
OUT = APP_DATA / "trends.json"
WATCHLIST = ROOT / "data" / "trend_watchlist.json"
MAX_AGE_H = 20

# 쇼핑인사이트 카테고리(네이버 쇼핑 대분류 cat_id)
SHOP_CATS = [
    ("50000000", "패션의류"), ("50000001", "패션잡화"), ("50000002", "화장품/미용"),
    ("50000003", "디지털/가전"), ("50000004", "가구/인테리어"), ("50000005", "출산/육아"),
    ("50000006", "식품"), ("50000007", "스포츠/레저"), ("50000008", "생활/건강"),
    ("50000010", "여가/생활편의"),
]


def _naver_keys():
    for p in (ROOT / ".env", Path.home() / "stock-review" / ".env"):
        if p.exists():
            kv = {}
            for ln in p.read_text(encoding="utf-8").splitlines():
                if "=" in ln:
                    k, v = ln.split("=", 1)
                    kv[k.strip()] = v.strip()
            if kv.get("NAVER_CLIENT_ID") and kv.get("NAVER_CLIENT_SECRET"):
                return kv["NAVER_CLIENT_ID"], kv["NAVER_CLIENT_SECRET"]
    return os.environ.get("NAVER_CLIENT_ID"), os.environ.get("NAVER_CLIENT_SECRET")


def _naver_post(path: str, body: dict, cid: str, sec: str):
    req = urllib.request.Request(
        f"https://openapi.naver.com{path}", data=json.dumps(body).encode(),
        headers={"X-Naver-Client-Id": cid, "X-Naver-Client-Secret": sec,
                 "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=15).read().decode("utf-8"))


def _surge(daily: list) -> dict:
    """[{period,ratio}] → 급등 지표: 최근 7일 평균 ÷ 이전 8주 평균, 30일 대비도."""
    vals = [d["ratio"] for d in daily]
    if len(vals) < 70:
        return {}
    last7 = sum(vals[-7:]) / 7
    prev56 = sum(vals[-63:-7]) / 56
    last30 = sum(vals[-30:]) / 30
    prev_yr = sum(vals[:-30]) / max(1, len(vals) - 30)
    return {"r7": round(last7 / prev56, 2) if prev56 > 0.01 else None,
            "r30": round(last30 / prev_yr, 2) if prev_yr > 0.01 else None}


def fetch_watchlist(cid: str, sec: str) -> list:
    """워치리스트 키워드 1년 일간 상대지수 + 급등 지표. 5그룹/호출 배치."""
    wl = json.loads(WATCHLIST.read_text(encoding="utf-8"))
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=365)).isoformat()
    out = []
    for i in range(0, len(wl), 5):
        batch = wl[i:i + 5]
        body = {"startDate": start, "endDate": end, "timeUnit": "date",
                "keywordGroups": [{"groupName": w["kw"], "keywords": [w["kw"]] + w.get("alt", [])}
                                  for w in batch]}
        try:
            res = _naver_post("/v1/datalab/search", body, cid, sec)
        except Exception as e:
            print(f"  검색어트렌드 실패({e}) — 이후 배치 중단", file=sys.stderr)
            break
        # ⚠데이터 없는 그룹은 응답에서 빠짐 — zip 매칭 금지, 그룹명으로 매칭
        by_name = {r.get("title"): r for r in res.get("results", [])}
        for w in batch:
            r = by_name.get(w["kw"])
            if not r:
                print(f"    (데이터 없음: {w['kw']})")
                continue
            daily = r.get("data", [])
            # 용량 절약: 주 단위 다운샘플(각 주 마지막) + 최근 30일은 일간 유지
            slim = [[d["period"][5:], round(d["ratio"], 1)] for d in daily[-30:]]
            weekly = [[d["period"][2:], round(d["ratio"], 1)] for j, d in enumerate(daily[:-30])
                      if j % 7 == 6]
            out.append({"kw": w["kw"], "stocks": w.get("stocks", []), "memo": w.get("memo", ""),
                        "surge": _surge(daily), "w": weekly, "d30": slim})
    print(f"  워치리스트 {len(out)}/{len(wl)} 키워드")
    return out


def _shop_top_keywords(cat_id: str, count: int = 10) -> list:
    """카테고리 인기 검색어 TOP N — 데이터랩 웹 내부 엔드포인트(무키·Referer 필수, 비공식이라 실패 허용)."""
    import urllib.parse
    end = date.today() - timedelta(days=1)
    start = end - timedelta(days=6)
    body = urllib.parse.urlencode({
        "cid": cat_id, "timeUnit": "date", "count": count,
        "startDate": start.isoformat(), "endDate": end.isoformat()}).encode()
    # ⚠연속 호출 시 네이버가 301→notfound로 일시 차단(실사고: 뒤쪽 카테고리 누락) — 저속 + 1회 재시도
    for attempt in range(2):
        time.sleep(1.5 if attempt == 0 else 5)
        req = urllib.request.Request(
            "https://datalab.naver.com/shoppingInsight/getCategoryKeywordRank.naver", data=body,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                     "Referer": "https://datalab.naver.com/shoppingInsight/sCategory.naver",
                     "Content-Type": "application/x-www-form-urlencoded"})
        raw = urllib.request.urlopen(req, timeout=12).read().decode("utf-8", "ignore")
        if raw.lstrip().startswith("{"):
            d = json.loads(raw)
            return [r["keyword"] for r in (d.get("ranks") or [])[:count]]
    return []


def fetch_shopping(cid: str, sec: str) -> list:
    """쇼핑인사이트 — 카테고리별 3개월 검색 트렌드(주간) + 최근 급등률 + 인기 검색어 TOP10."""
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=180)).isoformat()
    out = []
    for i in range(0, len(SHOP_CATS), 3):  # 3카테고리/호출
        batch = SHOP_CATS[i:i + 3]
        body = {"startDate": start, "endDate": end, "timeUnit": "week",
                "category": [{"name": nm, "param": [cid_]} for cid_, nm in batch]}
        try:
            res = _naver_post("/v1/datalab/shopping/categories", body, cid, sec)
        except Exception as e:
            print(f"  쇼핑인사이트 실패({e})", file=sys.stderr)
            break
        for (cid_, nm), r in zip(batch, res.get("results", [])):
            data = r.get("data", [])
            vals = [d["ratio"] for d in data]
            if len(vals) < 8:
                continue
            r4 = sum(vals[-4:]) / 4 / (sum(vals[:-4]) / max(1, len(vals) - 4) or 1)
            try:
                top = _shop_top_keywords(cid_)
            except Exception:
                top = []
            out.append({"cat": nm, "r4": round(r4, 2), "top": top,
                        "w": [[d["period"][5:], round(d["ratio"], 1)] for d in data]})
    out.sort(key=lambda x: -(x["r4"] or 0))
    print(f"  쇼핑 카테고리 {len(out)}개")
    return out


def fetch_wiki_watchlist() -> list:
    """글로벌(위키 페이지뷰) 워치리스트 — 네이버와 같은 포맷.
    구글 트렌드 시계열 API는 IP 레벨 차단(429 고정, 2026-07 실측)이라 위키 페이지뷰가 글로벌 관심 프록시.
    watchlist의 wiki 필드(영문 canonical 문서명) 있는 키워드만, 404는 자동 생략."""
    wl = json.loads(WATCHLIST.read_text(encoding="utf-8"))
    end = (date.today() - timedelta(days=1)).strftime("%Y%m%d")
    start = (date.today() - timedelta(days=365)).strftime("%Y%m%d")
    out = []
    import urllib.parse as up
    for w in wl:
        title = w.get("wiki")
        if not title:
            continue
        url = (f"https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/"
               f"en.wikipedia/all-access/user/{up.quote(title, safe='')}/daily/{start}/{end}")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "chart-principles trends yoo7337@gmail.com"})
            items = json.loads(urllib.request.urlopen(req, timeout=15).read()).get("items", [])
        except Exception:
            continue
        if len(items) < 70:
            continue
        daily = [{"period": f"{x['timestamp'][:4]}-{x['timestamp'][4:6]}-{x['timestamp'][6:8]}",
                  "ratio": x["views"]} for x in items]
        slim = [[d["period"][5:], d["ratio"]] for d in daily[-30:]]
        weekly = [[d["period"][2:], d["ratio"]] for j, d in enumerate(daily[:-30]) if j % 7 == 6]
        out.append({"kw": w["kw"], "stocks": w.get("stocks", []), "memo": w.get("memo", ""),
                    "wiki": title, "surge": _surge(daily), "w": weekly, "d30": slim})
        time.sleep(0.15)
    print(f"  글로벌(위키) 워치리스트 {len(out)}건")
    return out


AMZ_CATS = [
    ("electronics", "전자·가전"), ("hpc", "건강·생활"), ("beauty", "뷰티"),
    ("videogames", "비디오게임"), ("toys-and-games", "완구"), ("home-garden", "홈·가든"),
    ("sporting-goods", "스포츠"), ("pet-supplies", "반려동물"),
]


def fetch_amazon() -> list:
    """아마존 미국 베스트셀러 — 카테고리별 상위 10(무키 스크랩, 서버렌더 gridItem).
    ⚠쿠팡은 봇 차단(403)으로 스크랩 불가 → 미지원. 상품→상장사 매핑은 약해 '소비 트렌드' 참고용."""
    out = []
    for cat, nm in AMZ_CATS:
        url = f"https://www.amazon.com/gp/bestsellers/{cat}"
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
                "Accept-Language": "en-US,en;q=0.9"})
            html = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", "ignore")
        except Exception:
            continue
        blocks = re.findall(r'(<div id="gridItemRoot".*?)(?=<div id="gridItemRoot"|</ol>|\Z)', html, re.S)
        items = []
        for b in blocks[:10]:
            rk = re.search(r"#(\d+)", b)
            alt = re.search(r'<img[^>]*alt="([^"]{4,})"', b)
            asin = re.search(r"/dp/([A-Z0-9]{10})", b)
            if not alt or not asin:
                continue
            items.append({"rank": int(rk.group(1)) if rk else len(items) + 1,
                          "title": alt.group(1).strip()[:70],
                          "link": f"https://www.amazon.com/dp/{asin.group(1)}"})
        if items:
            out.append({"cat": nm, "items": items})
        time.sleep(0.4)
    print(f"  아마존 베스트셀러 {len(out)}개 카테고리")
    return out


def fetch_google_rss(geo: str) -> list:
    """구글 트렌드 일간 급상승 RSS — 검색어·대략 트래픽·관련 기사."""
    url = f"https://trends.google.com/trending/rss?geo={geo}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    xml = urllib.request.urlopen(req, timeout=15).read().decode("utf-8", "ignore")
    out = []
    for item in re.findall(r"<item>(.*?)</item>", xml, re.S):
        tag = lambda t: (re.findall(rf"<{t}>(.*?)</{t}>", item, re.S) or [""])[0].strip()
        title = tag("title")
        if not title:
            continue
        news = re.findall(r"<ht:news_item_title>(.*?)</ht:news_item_title>", item, re.S)
        urls = re.findall(r"<ht:news_item_url>(.*?)</ht:news_item_url>", item, re.S)
        out.append({"q": title, "traffic": tag("ht:approx_traffic"),
                    "news": news[0].strip()[:80] if news else "",
                    "link": urls[0].strip() if urls else ""})
    print(f"  구글 급상승({geo}) {len(out)}건")
    return out


def gemini_stocks(terms: list) -> dict:
    """급상승 검색어 → 유니버스 내 관련 상장사 추정(환각 방지: 유니버스 목록 제공)."""
    try:
        from gemini_util import generate
    except Exception:
        return {}
    names_path = ROOT / "data" / "kr_names.json"
    names = json.loads(names_path.read_text(encoding="utf-8")) if names_path.exists() else {}
    name2code = {v: k for k, v in names.items()}
    uni = ", ".join(list(name2code.keys())[:800])
    qlist = "\n".join(f"- {t}" for t in terms)
    prompt = f"""다음은 오늘 검색량이 급등한 검색어들이다. 각 검색어가 아래 한국 상장사 목록 중 어느 회사의
매출·주가와 직접 관련될 수 있는지 판단하라. 관련이 명확한 경우만 회사명을 적고, 불명확하면 "없음"이라고 하라.
반드시 JSON만 출력: {{"검색어": ["회사명", ...] 또는 []}}

검색어:
{qlist}

상장사 목록: {uni}"""
    try:
        raw = generate(prompt)
        if not raw:  # 키 없음/응답 실패 — 조용히 생략
            return {}
        m = re.search(r"\{.*\}", raw, re.S)
        parsed = json.loads(m.group(0)) if m else {}
        out = {}
        for q, comps in parsed.items():
            if not isinstance(comps, list):
                continue
            codes = [{"name": c, "code": name2code[c]} for c in comps if c in name2code]
            if codes:
                out[q] = codes
        print(f"  Gemini 관련주 추정 {len(out)}건")
        return out
    except Exception as e:
        print(f"  Gemini 생략({e})", file=sys.stderr)
        return {}


ARCH = APP_DATA / "trends_archive.json"
ARCH_KEEP_DAYS = 120


def archive_snapshot(payload: dict) -> dict:
    """일자별 누적 아카이브 — 구글 급상승·아마존은 스냅샷뿐이라 소급 불가 → 오늘부터 매일 적재.
    (워치리스트·쇼핑은 네이버가 시계열을 주므로 아카이브 없이도 1년/6개월 소급 가능)
    구조: {days: {YYYY-MM-DD: {google_kr:[검색어...], google_us:[...], amazon:{cat:[상품...]}}}}
    120일 보관(용량 관리)."""
    try:
        arch = json.loads(ARCH.read_text(encoding="utf-8")) if ARCH.exists() else {}
    except Exception:
        arch = {}
    days = arch.get("days") or {}
    today = datetime.now(KST).strftime("%Y-%m-%d")
    days[today] = {
        "google_kr": [g["q"] for g in payload.get("google", {}).get("kr", [])],
        "google_us": [g["q"] for g in payload.get("google", {}).get("us", [])],
        "amazon": {c["cat"]: [it["title"] for it in c.get("items", [])[:5]]
                   for c in payload.get("amazon", [])},
        "shop_top": {s["cat"]: (s.get("top") or [])[:5] for s in payload.get("shopping", [])},
    }
    cut = (date.today() - timedelta(days=ARCH_KEEP_DAYS)).isoformat()
    days = {d: v for d, v in days.items() if d >= cut}
    out = {"updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "days": days}
    ARCH.write_text(json.dumps(out, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(f"  아카이브 {len(days)}일치 누적")
    return out


def _win_avg(series: list, days: int, offset: int = 0) -> float | None:
    """[[label,value],...]의 최근 구간 평균(offset일 전부터 days일)."""
    if not series:
        return None
    end = len(series) - offset
    seg = series[max(0, end - days):end]
    vals = [v for _, v in seg if v is not None]
    return sum(vals) / len(vals) if vals else None


def build_curation(payload: dict, arch: dict) -> dict:
    """1·3개월 트렌드 변동 → Gemini 큐레이션.
    입력 근거: ①워치리스트 1개월/3개월 변화율(네이버 1년 시계열) ②쇼핑 카테고리 추세
    ③구글 급상승 신규/반복 검색어(아카이브 있을 때). 실패 시 빈 dict(섹션 자동 숨김)."""
    # ── 계산: 워치리스트 1M/3M 변화 ──
    moves = []
    for w in payload.get("watchlist", []):
        d30, wk = w.get("d30") or [], w.get("w") or []
        recent = _win_avg(d30, 30)                      # 최근 30일 평균(일간)
        m1_base = _win_avg(wk, 4)                       # 직전 4주(=1개월 전 구간)
        m3_base = _win_avg(wk, 13)                      # 직전 13주(=3개월)
        if recent and m1_base:
            moves.append({"kw": w["kw"], "stocks": [s["name"] for s in w.get("stocks", [])],
                          "m1": round(recent / m1_base, 2),
                          "m3": round(recent / m3_base, 2) if m3_base else None})
    moves.sort(key=lambda x: -(x["m1"] or 0))
    top_up = moves[:8]
    top_dn = [m for m in moves if (m["m1"] or 9) < 0.8][-5:]
    # ── 쇼핑 카테고리 추세 ──
    shop = [{"cat": s["cat"], "r4": s.get("r4"),
             "top": (s.get("top") or [])[:5]} for s in payload.get("shopping", [])]
    shop_hot = sorted([s for s in shop if s["r4"] is not None], key=lambda s: -s["r4"])[:5]
    # ── 구글 급상승: 최근 7일 반복 등장 검색어(아카이브 필요) ──
    days = (arch or {}).get("days") or {}
    recent_days = sorted(days)[-7:]
    freq = {}
    for d in recent_days:
        for q in days[d].get("google_kr", []):
            freq[q] = freq.get(q, 0) + 1
    repeat = sorted([(q, n) for q, n in freq.items() if n >= 2], key=lambda x: -x[1])[:8]

    stats = {"watch_up": top_up, "watch_down": top_dn, "shop_hot": shop_hot,
             "google_repeat": [{"q": q, "days": n} for q, n in repeat],
             "arch_days": len(days)}
    if not top_up and not shop_hot:
        return {}
    # ── Gemini 요약 ──
    try:
        from gemini_util import generate
    except Exception:
        return {"stats": stats}
    fmt = lambda m: f"{m['kw']}(1M ×{m['m1']}{', 3M ×' + str(m['m3']) if m.get('m3') else ''}{', 관련주 ' + '·'.join(m['stocks'][:2]) if m.get('stocks') else ''})"
    prompt = f"""너는 소비 트렌드를 주식 투자 관점에서 해석하는 애널리스트다. 아래는 실제 검색·쇼핑 데이터의 최근 변동이다.

[검색 급등 키워드(1M=최근 30일÷직전 4주, 3M=÷직전 13주)]
{chr(10).join('- ' + fmt(m) for m in top_up) or '- 없음'}

[검색 위축 키워드]
{chr(10).join('- ' + fmt(m) for m in top_dn) or '- 없음'}

[쇼핑 카테고리 수요(최근 4주÷이전 평균)와 인기검색어]
{chr(10).join(f"- {s['cat']} ×{s['r4']} : {', '.join(s['top'][:4])}" for s in shop_hot) or '- 없음'}

[구글 급상승 반복 등장(최근 7일)]
{', '.join(f"{r['q']}({r['days']}일)" for r in stats['google_repeat']) or '없음'}

다음 형식의 JSON만 출력(각 항목 한국어, 과장 금지, 데이터에 없는 사실 추측 금지):
{{"headline": "이번 달 소비 트렌드를 한 문장으로",
  "rising": [{{"theme":"테마명","why":"근거(수치 포함)","stocks":"관련 상장사(있으면)"}}],
  "fading": [{{"theme":"테마명","why":"근거"}}],
  "watch": "투자자가 다음 1개월 주목할 포인트 1~2문장"}}"""
    try:
        raw = generate(prompt, max_tokens=1400)
        if not raw:
            return {"stats": stats}
        m = re.search(r"\{.*\}", raw, re.S)
        parsed = json.loads(m.group(0)) if m else {}
        parsed["stats"] = stats
        parsed["generated"] = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
        print(f"  AI 큐레이션 생성(급등 {len(top_up)}·쇼핑 {len(shop_hot)}·아카이브 {len(days)}일)")
        return parsed
    except Exception as e:
        print(f"  큐레이션 실패({e})", file=sys.stderr)
        return {"stats": stats}


def _fresh(stamp) -> bool:
    if not stamp:
        return False
    try:
        t = datetime.strptime(stamp, "%Y-%m-%d %H:%M").replace(tzinfo=KST)
        return (datetime.now(KST) - t) < timedelta(hours=MAX_AGE_H)
    except Exception:
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--no-gemini", action="store_true")
    args = ap.parse_args()

    if OUT.exists() and not args.force:
        try:
            if _fresh(json.loads(OUT.read_text(encoding="utf-8")).get("generated")):
                print("trends 스킵 (20h 이내 갱신됨)")
                return
        except Exception:
            pass

    now = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    # ts = 소스별 실제 수집 시각(각 fetch 성공 시점) — 화면에 섹션별 갱신 시점 표기용.
    # 한 소스가 실패해도 다른 소스 표기가 오염되지 않도록 개별 기록.
    payload = {"generated": now, "watchlist": [], "watchlist_g": [], "shopping": [],
               "amazon": [], "google": {}, "naver_ok": False, "ts": {}}
    stamp = lambda: datetime.now(KST).strftime("%Y-%m-%d %H:%M")

    # 아마존 미국 베스트셀러(무키 스크랩)
    try:
        payload["amazon"] = fetch_amazon()
        if payload["amazon"]:
            payload["ts"]["amazon"] = stamp()
    except Exception as e:
        print(f"  아마존 실패({e})", file=sys.stderr)

    # 글로벌(위키 페이지뷰) 워치리스트 — 네이버·구글과 독립
    try:
        payload["watchlist_g"] = fetch_wiki_watchlist()
        if payload["watchlist_g"]:
            payload["ts"]["wiki"] = stamp()
    except Exception as e:
        print(f"  위키 워치리스트 실패({e})", file=sys.stderr)

    # 구글 급상승(독립 — 네이버 권한과 무관)
    for geo in ("KR", "US"):
        try:
            payload["google"][geo.lower()] = fetch_google_rss(geo)
        except Exception as e:
            print(f"  구글 RSS({geo}) 실패({e})", file=sys.stderr)
            payload["google"][geo.lower()] = []
    if payload["google"].get("kr") or payload["google"].get("us"):
        payload["ts"]["google"] = stamp()

    # Gemini 관련주 추정(한국 급상승어만)
    if not args.no_gemini and payload["google"].get("kr"):
        terms = [g["q"] for g in payload["google"]["kr"]]
        rel = gemini_stocks(terms)
        for g in payload["google"]["kr"]:
            g["stocks"] = rel.get(g["q"], [])

    # 네이버 데이터랩(권한 필요 — 실패 시 생략)
    cid, sec = _naver_keys()
    if cid and sec:
        try:
            payload["watchlist"] = fetch_watchlist(cid, sec)
            if payload["watchlist"]:
                payload["ts"]["watchlist"] = stamp()
            payload["shopping"] = fetch_shopping(cid, sec)
            if payload["shopping"]:
                payload["ts"]["shopping"] = stamp()
            payload["naver_ok"] = bool(payload["watchlist"])
        except Exception as e:
            print(f"  네이버 데이터랩 생략({e})", file=sys.stderr)
    else:
        print("  네이버 키 없음 — 데이터랩 생략")

    # 일자별 아카이브 누적(구글·아마존은 소급 불가 → 오늘부터) + 1·3개월 AI 큐레이션
    arch = archive_snapshot(payload)
    if not args.no_gemini:
        payload["curation"] = build_curation(payload, arch)

    OUT.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(f"완료: trends.json (워치리스트 {len(payload['watchlist'])} · 쇼핑 {len(payload['shopping'])} · "
          f"구글 KR {len(payload['google'].get('kr', []))}/US {len(payload['google'].get('us', []))})")


if __name__ == "__main__":
    main()

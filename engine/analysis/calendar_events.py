# -*- coding: utf-8 -*-
r"""경제일정 데이터 → app\data\calendar.json

- US 실적발표: yfinance Ticker.calendar (99종목, Earnings Date + EPS 추정)
- KR 실적발표·IR: KIND 기업설명회(IR) 일정 (irschedule.do searchIRScheduleSub POST)
- 경제지표 캘린더는 프런트의 TradingView events 위젯이 담당(수집 없음)

부분-머지: us/kr 파트를 독립 갱신(기존 파일의 상대 파트 보존) — 클라우드/노트북 분업 대응.
age 가드: 각 파트 20시간 이내 갱신이면 스킵 → 30분 파이프라인에 넣어도 실호출은 하루 1회.

사용법:
    python analysis\calendar_events.py             # us+kr (age 가드 적용)
    python analysis\calendar_events.py --force     # 가드 무시
    python analysis\calendar_events.py --probe-kr  # KIND 접근성만 확인(클라우드 프로브)
"""
import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from collect import US_TICKERS
from common import APP_DATA

KST = timezone(timedelta(hours=9))
OUT = APP_DATA / "calendar.json"
MAX_AGE_H = 20
LOOKBACK_D, LOOKAHEAD_D = 3, 30
KIND_URL = "https://kind.krx.co.kr/corpgeneral/irschedule.do"


def _load_existing() -> dict:
    if OUT.exists():
        try:
            return json.loads(OUT.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"earnings": {"us": [], "kr": []}}


def _fresh(stamp: str | None) -> bool:
    if not stamp:
        return False
    try:
        t = datetime.strptime(stamp, "%Y-%m-%d %H:%M").replace(tzinfo=KST)
        return (datetime.now(KST) - t) < timedelta(hours=MAX_AGE_H)
    except Exception:
        return False


def fetch_us() -> list:
    """yfinance calendar — 향후 30일 이내 실적발표 예정."""
    import yfinance as yf

    lo = date.today() - timedelta(days=LOOKBACK_D)
    hi = date.today() + timedelta(days=LOOKAHEAD_D)
    out = []
    for i, t in enumerate(US_TICKERS, 1):
        try:
            cal = yf.Ticker(t).calendar or {}
            dates = cal.get("Earnings Date") or []
            if not dates:
                continue
            d = min(dates)  # 가장 가까운 발표일
            if not (lo <= d <= hi):
                continue
            eps = cal.get("Earnings Average")
            out.append({"t": t, "name": t, "date": d.isoformat(),
                        "eps_est": round(float(eps), 2) if eps is not None else None,
                        "src": "yfinance"})
        except Exception:
            pass
        if i % 25 == 0:
            print(f"  [US cal] {i}/{len(US_TICKERS)}")
        time.sleep(0.2)
    out.sort(key=lambda r: r["date"])
    print(f"  US 실적일정 {len(out)}건")
    return out


def fetch_kr(probe: bool = False):
    """KIND IR일정 — 최근 3일~향후 30일. probe=True면 접근성만 출력."""
    frm = (date.today() - timedelta(days=LOOKBACK_D)).isoformat()
    to = (date.today() + timedelta(days=LOOKAHEAD_D)).isoformat()
    body = urllib.parse.urlencode({
        "method": "searchIRScheduleSub", "currentPageSize": "100", "pageIndex": "1",
        "gubun": "iRSchedule", "fromDate": frm, "toDate": to,
    }).encode()
    req = urllib.request.Request(KIND_URL, data=body, headers={
        "User-Agent": "Mozilla/5.0",
        "Content-Type": "application/x-www-form-urlencoded"})
    html = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", "ignore")
    if probe:
        rows = len(re.findall(r"<tr", html))
        print(f"PROBE kind: OK -> {len(html)} bytes, {rows} tr")
        return []
    if "잠시 후 다시" in html:
        raise RuntimeError("KIND 차단/과부하 응답")

    # 역방향 이름→코드 (우리 유니버스와 연결, 없으면 코드 공란)
    names_path = Path(__file__).resolve().parent.parent / "data" / "kr_names.json"
    name2code = {}
    if names_path.exists():
        name2code = {v: k for k, v in json.loads(names_path.read_text(encoding="utf-8")).items()}

    out, seen = [], set()
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        tds = [re.sub(r"<[^>]+>|\s+", " ", td).strip()
               for td in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if len(tds) < 6 or not re.match(r"\d{4}-\d{2}-\d{2}", tds[4]):
            continue
        name, event, d, tm = tds[1], tds[2], tds[4], tds[5]
        key = (name, d)
        if key in seen:
            continue
        seen.add(key)
        out.append({"t": name2code.get(name, ""), "name": name, "date": d, "time": tm,
                    "event": event[:60], "src": "KIND"})
    out.sort(key=lambda r: (r["date"], r.get("time", "")))
    print(f"  KR IR일정 {len(out)}건")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--probe-kr", action="store_true")
    ap.add_argument("--us-only", action="store_true")
    ap.add_argument("--kr-only", action="store_true")
    args = ap.parse_args()

    if args.probe_kr:
        fetch_kr(probe=True)
        return

    cur = _load_existing()
    earnings = cur.get("earnings", {"us": [], "kr": []})
    now = datetime.now(KST).strftime("%Y-%m-%d %H:%M")

    if not args.kr_only:
        if args.force or not _fresh(cur.get("us_updated")):
            print("[1/2] US 실적일정 (yfinance)...")
            earnings["us"] = fetch_us()
            cur["us_updated"] = now
        else:
            print("[1/2] US 스킵 (20h 이내 갱신됨)")
    if not args.us_only:
        if args.force or not _fresh(cur.get("kr_updated")):
            print("[2/2] KR IR일정 (KIND)...")
            try:
                earnings["kr"] = fetch_kr()
                cur["kr_updated"] = now
            except Exception as e:
                print(f"  KR 실패({e}) — 기존 데이터 보존", file=sys.stderr)
        else:
            print("[2/2] KR 스킵 (20h 이내 갱신됨)")

    payload = {"generated": now,
               "us_updated": cur.get("us_updated"), "kr_updated": cur.get("kr_updated"),
               "earnings": earnings}
    OUT.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(f"완료: calendar.json (US {len(earnings['us'])} / KR {len(earnings['kr'])})")


if __name__ == "__main__":
    main()

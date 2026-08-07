r"""소유지분도 — DART 타법인출자현황으로 그룹 지배구조 그래프를 만든다 (v261)

왜 DART인가: 공정위 소유지분도는 PDF/이미지라 기계가 읽기 어렵다. 그런데 **타법인 출자현황**
(정기보고서 주요정보)에 자회사별 지분율이 필드로 들어 있어 같은 그림을 데이터로 재현할 수 있다.
2026-08-02 실측: 하림지주 → 제일사료 88.11% · 팬오션 54.72% · 동림 100.0 — 공정위 지분도와 일치.

- 간선: /api/otrCprInvstmntSttus.json (출자 대상·지분율·장부가·취득일·목적)
- 상단: /api/hyslrSttus.json (최대주주 및 특수관계인) — 누가 이 회사를 지배하는지
- 깊이 2까지 재귀(자회사가 사업보고서를 내는 경우에만 더 내려간다 — 비상장 대부분은 미제출)
- 상장 여부는 kr_universe 이름 매칭 → 프런트에서 ★ + 종목조회 링크

출력: app\data\ownership\{code}.json  {name, code, at, nodes:[...], edges:[...]}
사용법: python analysis\ownership.py --codes 003380
        python analysis\ownership.py --top 300        (시총 상위 N, 증분)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from stock_extras import _dart_key, _getj, _corp_codes  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "data" / "ownership"
FRESH_DAYS = 90


def _num(v):
    if v is None:
        return None
    s = re.sub(r"[^\d.\-]", "", str(v))
    try:
        return float(s) if s not in ("", "-", ".") else None
    except ValueError:
        return None


def corp_by_name(key: str) -> dict:
    """회사명 → [corp_code, stock_code] (비상장 포함 11만 건). 캐시 파일로 1회만 받는다.

    두 가지를 동시에 푼다.
    ①상장사만 재귀하면 **비상장 중간지주에서 끊긴다**(두산 → 두산포트폴리오홀딩스 → 두산테스나 누락).
    ②공시의 **정식 법인명과 거래소 종목명이 다르다** — '한국전력기술' vs '한전기술', '한화솔루션' vs …
      이름을 아무리 정제해도 안 붙는다. corpCode.xml은 두 이름을 같은 레코드에 갖고 있으므로
      **stock_code로 상장 여부를 판정**하면 이름 문제를 통째로 우회한다.
    """
    cache = ROOT / "data" / "corp_names2.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    import io
    import urllib.request
    import xml.etree.ElementTree as ET
    import zipfile
    raw = urllib.request.urlopen(
        f"https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key={key}", timeout=90).read()
    z = zipfile.ZipFile(io.BytesIO(raw))
    root = ET.fromstring(z.read(z.namelist()[0]).decode("utf-8"))
    out = {}
    for c in root.iter("list"):          # ⚠정규식으로 짝지으면 항목 경계를 넘는다 — 반드시 항목 단위 파싱
        nm = (c.findtext("corp_name") or "").strip()
        cc = (c.findtext("corp_code") or "").strip()
        sc = (c.findtext("stock_code") or "").strip()
        if not nm or not cc:
            continue
        k = _clean(nm)
        prev = out.get(k)
        # 같은 이름이 여러 건이면 **상장사 레코드를 우선**한다(비상장 동명이인에 밀리지 않게)
        if prev is None or (sc and not prev[1]):
            out[k] = [cc, sc]
    cache.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    return out


# 공시엔 같은 회사가 한글 음차와 영문 약자로 섞여 나온다("에스케이하이닉스㈜" vs "SK하이닉스").
# 정규화하지 않으면 **같은 회사가 두 노드로 갈라진다**(실측: SK 그래프에 하이닉스가 2개).
_ALIAS = [("에스케이", "SK"), ("에스에이치", "SH"), ("엘지", "LG"), ("지에스", "GS"), ("케이티앤지", "KT&G"),
          ("케이티", "KT"), ("씨제이", "CJ"), ("에이치디현대", "HD현대"), ("에이치디", "HD"), ("엘엑스", "LX"),
          ("디엘", "DL"), ("오씨아이", "OCI"), ("케이씨씨", "KCC"), ("에스엘", "SL"), ("한화", "한화"),
          ("에이치엘", "HL"), ("비지에프", "BGF"), ("에이피알", "APR"), ("에스디바이오센서", "에스디바이오센서")]


# 공시에 옛 사명·정식명이 적혀 corpCode에도 없는 경우 — 자동 매칭이 불가능해 확인된 것만 등록한다.
# ⚠부분수열 같은 자동 추정은 쓰지 않는다(실측 오탐: HLB셀→HLB · HMMAL→HMM · GS바이오→지에스이).
_NAME_FIX = {
    "한국전력기술": "한전기술",
    "한전케이피에스": "한전KPS",
    "한국전력공사": "한국전력",
}


# 공시 회사명에는 표 각주가 붙어 나온다 — (주1)(주2) · (계열회사) · (*1) · (상장) 등.
# 회사 이름의 일부가 아니므로 **표시명에서도** 떼어낸다(사용자 요청).
_NOTE = re.compile(r"\s*\(\s*(주\s*\d+|주석\s*\d*|\*+\d*|계열\s*회사|관계\s*회사|비상장|상장|"
                   r"연결|종속\s*회사|공동\s*기업|관계\s*기업)\s*\)")


def _disp(nm: str) -> str:
    """화면에 쓸 회사명 — 각주만 떼고 법인격 표기((주)·㈜)는 남긴다."""
    s = _NOTE.sub("", str(nm or ""))
    s = re.sub(r"\s*주\s*\d+\s*\)", "", s)      # 여는 괄호가 빠진 '두산로보틱스주1)' 형태
    return re.sub(r"\s{2,}", " ", s).strip(" ,·")


def _clean(nm: str) -> str:
    """'(주)하림지주' '하림지주(주)' → '하림지주' (상장 여부 매칭·중복 제거용)"""
    s = re.sub(r"\(주\)|㈜|주식회사|\(유\)|유한회사", "", str(nm or ""))
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"\((주\d+|계열회사|관계회사|비상장|상장|주\d*\)?)\)", "", s)   # 각주·분류 꼬리
    s = re.sub(r"주\d+\)", "", s)
    s = s.strip()
    for a, b in _ALIAS:                                # 한글 음차 → 영문 약자
        if s.startswith(a):
            s = b + s[len(a):]
            break
    return _NAME_FIX.get(s, s)


# ⚠출자현황 표의 **마지막 합계 행**이 회사명 자리에 '합계'로 들어온다 → 계열사로 잡히면 안 된다
#   (실측: 신세계 도식에 '합계'라는 회사가 그려졌다). 총계·소계·기타 표기까지 함께 막는다.
_NOT_COMPANY = re.compile(r"^\s*(합\s*계|총\s*계|소\s*계|계|-|기\s*타|합계\(.*\))\s*$")


def invest_rows(key: str, corp_code: str, year: int) -> list:
    """타법인 출자현황 — 최근 사업연도부터 역순으로 시도(직전 연도 보고서가 없을 수 있다)."""
    for y in (year, year - 1):
        try:
            r = _getj(f"https://opendart.fss.or.kr/api/otrCprInvstmntSttus.json?crtfc_key={key}"
                      f"&corp_code={corp_code}&bsns_year={y}&reprt_code=11011")
        except Exception:
            return []
        if r.get("status") == "020":
            raise RuntimeError("DART_LIMIT")
        if r.get("status") == "000" and r.get("list"):
            return [x for x in r["list"] if _num(x.get("trmend_blce_qota_rt")) is not None]
        time.sleep(0.2)
    return []


def top_holders(key: str, corp_code: str, year: int) -> list:
    try:
        r = _getj(f"https://opendart.fss.or.kr/api/hyslrSttus.json?crtfc_key={key}"
                  f"&corp_code={corp_code}&bsns_year={year}&reprt_code=11011")
    except Exception:
        return []
    if r.get("status") != "000":
        return []
    agg = {}
    for x in r.get("list", []):
        nm, rt = (x.get("nm") or "").strip(), _num(x.get("trmend_posesn_stock_qota_rt"))
        if not nm or _NOT_COMPANY.match(nm) or not rt:
            continue
        agg[nm] = agg.get(nm, 0) + rt
    return [{"name": n, "rate": round(v, 2)} for n, v in sorted(agg.items(), key=lambda x: -x[1])[:6]]


def build(code: str, name: str, key: str, codes: dict, listed: dict,
          names: dict | None = None, rev: dict | None = None, disp: dict | None = None,
          uni_names: dict | None = None, depth: int = 3) -> dict:
    """code(6자리 상장사)를 루트로 소유 그래프 생성."""
    year = date.today().year - 1
    nodes, edges, seen = {}, [], set()
    names = names or {}

    def stock_of(k):
        """정제명 → 종목코드. **이름이 달라도**(한국전력기술=한전기술) corpCode의 stock_code로 잇는다.
        단 우리 유니버스에 없는 종목은 종목조회로 못 가므로 상장 취급하지 않는다."""
        v = names.get(k)
        sc = v[1] if isinstance(v, list) and len(v) > 1 else None
        return sc if sc and sc in (uni_names or {}) else None

    def add_node(nm, lvl, **kw):
        k = _clean(nm)
        if k not in nodes:
            tk = listed.get(k) or stock_of(k)
            # 상장사는 공시 표기(한국전력기술) 대신 **유니버스 표기**(한전기술)로 통일
            label = (uni_names or {}).get(tk) or (disp or {}).get(k) or _disp(nm)
            nodes[k] = {"id": k, "name": label, "lvl": lvl, "listed": bool(tk), "ticker": tk, **kw}
        else:
            nodes[k]["lvl"] = min(nodes[k]["lvl"], lvl)
        return k

    root = add_node(name, 0)
    nodes[root]["listed"] = True
    nodes[root]["ticker"] = code

    # 상단: 최대주주
    for h in top_holders(key, codes[code], year):
        if _clean(h["name"]) == root:
            continue                                    # 자기주식은 지배구조가 아니다
        hk = add_node(_disp(h["name"]), -1, kind="holder")
        edges.append({"f": hk, "t": root, "rate": h["rate"]})
    time.sleep(0.25)

    # 하단: 출자 관계 BFS — 큐에는 corp_code(8자리)를 담아 **비상장 중간지주도** 내려간다
    queue = [(codes[code], root, 1)]
    while queue:
        cc, pk, lvl = queue.pop(0)
        if not cc or (cc, lvl) in seen:
            continue
        seen.add((cc, lvl))
        rows = invest_rows(key, cc, year)
        time.sleep(0.3)
        for x in rows:
            nm = (x.get("inv_prm") or "").strip()
            rt = _num(x.get("trmend_blce_qota_rt"))
            if not nm or rt is None or _NOT_COMPANY.match(nm):
                continue
            if _clean(nm) == pk:
                continue                                # 자기 자신에게 출자한 것처럼 보이는 행
            k = add_node(nm, lvl,
                         purpose=(x.get("invstmnt_purps") or "").strip() or None,
                         book=_num(x.get("trmend_blce_acntbk_amount")),
                         since=(x.get("frst_acqs_de") or "").strip() or None)
            edges.append({"f": pk, "t": k, "rate": rt})
            # 지배 관계(경영참여·과반)만 더 내려간다 — 단순투자까지 파면 그래프가 폭발한다
            ctrl = (rt >= 30) or bool(re.search(r"경영\s*(참여|참가)|지배", str(x.get("invstmnt_purps") or "")))
            _v = names.get(_clean(nm))
            sub_cc = (_v[0] if isinstance(_v, list) else _v) or codes.get(listed.get(_clean(nm), ""))
            if lvl < depth and ctrl and sub_cc:
                queue.append((sub_cc, k, lvl + 1))
    # ── 역방향 보강 ──────────────────────────────────────────────
    # 비상장 중간지주는 사업보고서를 안 내므로 아래로 못 내려간다(두산포트폴리오홀딩스 실측).
    # 대신 **상장사가 신고한 최대주주**를 뒤집으면 그 아래 상장 계열사를 붙일 수 있다.
    # (두산포트폴리오홀딩스 → 두산테스나 38.69% 가 이 경로로 복원된다.)
    for owner_name, subs in (rev or {}).items():
        if owner_name not in nodes:
            continue
        for s in subs:
            sk = _clean(s["name"])
            if sk == root or sk == owner_name or any(e["t"] == sk and e["f"] == owner_name for e in edges):
                continue
            add_node(s["name"], nodes[owner_name]["lvl"] + 1)
            edges.append({"f": owner_name, "t": sk, "rate": s["rate"], "via": "holder"})
    # 루트는 항상 lvl 0 — add_node의 min()이 **자기주식·자기 이름 주주** 때문에 -1로 낮출 수 있다
    # (실측: 두산테스나 그래프의 루트가 lvl -1이 되어 '이 회사가 속한 그룹' 색인에서 빠졌다)
    nodes[root]["lvl"] = 0
    nodes[root].pop("kind", None)
    return {"name": name, "code": code, "at": datetime.now().strftime("%Y-%m-%d"),
            "year": year, "nodes": list(nodes.values()), "edges": edges}


def rev_holders() -> dict:
    """company.json의 최대주주(holders)를 뒤집어 {주주 정제명: [{name, rate}...]} 로.
    추가 API 호출이 없다(이미 수집해 둔 값)."""
    f = ROOT / "app" / "data" / "company.json"
    if not f.exists():
        return {}
    try:
        m = json.loads(f.read_text(encoding="utf-8")).get("map") or {}
    except Exception:
        return {}
    uni = json.loads((ROOT / "data" / "kr_universe.json").read_text(encoding="utf-8"))
    out = {}
    for k, v in m.items():
        if not k.startswith("kr_"):
            continue
        nm = (uni.get(k[3:]) or {}).get("name")
        if not nm:
            continue
        hs = [h for h in (v.get("holders") or []) if h.get("pct") is not None]
        if not hs:
            continue
        top = max(hs, key=lambda h: h["pct"])           # 1순위 최대주주만
        raw = str(top.get("name") or "")
        # ⚠개인 이름으로 이으면 **동명이인이 무관한 그룹을 끌어온다**
        # (실측: 가비아 창업자 '김홍국' = 하림 회장 동명이인 → 하림 지분도에 가비아·KINX가 붙었다)
        if not re.search(r"\(주\)|㈜|주식회사|\(유\)|유한회사|홀딩스|지주|Ltd|Inc|Corp|Co\.|"
                         r"펀드|조합|재단|공사|은행|투자|캐피탈|파트너스", raw, re.I):
            continue
        hn = _clean(raw)
        if len(hn) < 3:
            continue
        out.setdefault(hn, []).append({"name": nm, "rate": top["pct"]})
    return out


def fresh(p: Path) -> bool:
    if not p.exists():
        return False
    try:
        at = json.loads(p.read_text(encoding="utf-8")).get("at", "")
        return datetime.strptime(at, "%Y-%m-%d") > datetime.now() - timedelta(days=FRESH_DAYS)
    except Exception:
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--codes", default=None, help="쉼표 구분 종목코드")
    ap.add_argument("--top", type=int, default=0, help="시총 상위 N")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    key = _dart_key()
    if not key:
        raise SystemExit("DART_API_KEY 없음")
    codes = _corp_codes(key)
    uni = json.loads((ROOT / "data" / "kr_universe.json").read_text(encoding="utf-8"))
    listed = {_clean(v["name"]): c for c, v in uni.items()}      # 정제명 → 종목코드
    disp = {_clean(v["name"]): v["name"] for v in uni.values()}  # 정제명 → 표시명(상장사 표기 통일)
    uni_names = {c: v["name"] for c, v in uni.items()}           # 종목코드 → 표시명
    names = corp_by_name(key)                                    # 정제명 → corp_code(비상장 포함)
    rev = rev_holders()                                          # 주주명 → 그 주주가 최대주주인 상장사
    if a.codes:
        targets = [c.strip() for c in a.codes.split(",") if c.strip()]
    else:
        # ⚠kr_universe의 mcap_rank는 **시장별 순위**다(코스피 1~844 · 코스닥 1~1722).
        #   그대로 정렬하면 '상위 300'이 코스피 150 + 코스닥 150이 되어 코스피 중견주가 통째로 빠진다
        #   (실측: 이마트 코스피 154위 → 누락). → 실제 시가총액(market.json)으로 통합 정렬한다.
        mcap, grp = {}, {}
        try:
            hm = json.loads((ROOT / "app" / "data" / "market.json").read_text(encoding="utf-8")).get("heatmap") or []
            mcap = {x["t"]: x.get("mcap") or 0 for x in hm if x.get("m") == "kr"}
            grp = {x["t"]: x.get("grp") for x in hm if x.get("m") == "kr"}
        except Exception:
            pass
        targets = sorted(uni, key=lambda c: (-(mcap.get(c) or 0), uni[c].get("mcap_rank") or 9e9))[:a.top]
        # ⚠**지주회사는 시총으로 자르면 안 된다** — 지주는 자회사보다 시총이 작은 게 정상이라
        #   상위 N 컷에 걸려 통째로 빠진다(실측 v362: 코오롱 599위·한솔홀딩스·세아홀딩스 등 60사 누락).
        #   그런데 지주회사가 바로 **그룹 구조의 뿌리**여서, 빠지면 그 그룹 지분도를 아예 볼 수 없다
        #   (코오롱인더 지분도는 있는데 그룹 최상위 코오롱이 없어 계보가 끊겼다).
        #   → 12산업군 분류(grp=holding) + 사명(홀딩스·지주)로 **시총 무관 편입**한다.
        #   여기선 오탐이 무해하다(지분도 파일이 하나 더 생길 뿐).
        sel = set(targets)
        extra = [c for c, v in uni.items()
                 if c not in sel and (grp.get(c) == "holding" or re.search(r"홀딩스|지주", v["name"]))]
        if extra:
            print(f"  지주회사 {len(extra)}사 추가 편입(시총 컷 무관): "
                  f"{', '.join(uni[c]['name'] for c in extra[:6])}{' …' if len(extra) > 6 else ''}")
            targets = targets + sorted(extra, key=lambda c: -(mcap.get(c) or 0))
    OUT.mkdir(parents=True, exist_ok=True)
    n = 0
    for i, c in enumerate(targets, 1):
        p = OUT / f"kr_{c}.json"
        if not a.force and fresh(p):
            continue
        if c not in codes:
            continue
        try:
            g = build(c, uni[c]["name"], key, codes, listed, names, rev, disp, uni_names)
        except RuntimeError:
            print(f"  DART 일일 한도 — {i - 1}까지 저장 후 중단")
            break
        except Exception as e:
            print(f"  {uni[c]['name']} 실패({str(e)[:40]})")
            continue
        if len(g["edges"]) >= 1:
            p.write_text(json.dumps(g, ensure_ascii=False), encoding="utf-8")
            n += 1
        if i % 20 == 0:
            print(f"  {i}/{len(targets)} (저장 {n})", flush=True)
    keys = sorted(x.stem for x in OUT.glob("kr_*.json"))
    (OUT / "index.json").write_text(json.dumps(keys), encoding="utf-8")
    build_search(uni)
    print(f"완료: 신규 {n} · 총 {len(keys)}사 → {OUT}")


def _is_ctrl(node: dict, rate) -> bool:
    """프런트 ownIsCtrl과 같은 기준 — 지배관계만 계열로 본다(단순투자 제외)."""
    p = str(node.get("purpose") or "")
    if re.search(r"단순|일반\s*투자|스타트업|벤처|재무", p):   # ⚠단순 판정을 먼저(문구에 '출자'가 같이 들어간다)
        return False
    if re.search(r"경영\s*(참여|참가)|지배|출자|설립", p):
        return True
    return (rate or 0) >= 20


def build_search(uni: dict) -> None:
    """계열사 이름 → 그 계열사가 속한 그룹. "호텔신라"를 치면 어느 지분도에 있는지 알려준다.

    ⚠**지배 계열만** 담는다. 보험·지주는 단순투자 지분이 수백 건이라 전부 담으면
      호텔신라를 검색했을 때 그 주식을 조금 들고 있는 보험사가 줄줄이 나온다(실측 8개 중 6개가 그랬다).
    """
    rank = {v["name"]: (v.get("mcap_rank") or 9999) for v in uni.values()}
    search, groups = {}, {}
    for k in sorted(x.stem for x in OUT.glob("kr_*.json")):
        try:
            g = json.loads((OUT / f"{k}.json").read_text(encoding="utf-8"))
        except Exception:
            continue
        byid = {n["id"]: n for n in g.get("nodes") or []}
        root = next((n["id"] for n in g.get("nodes") or [] if n.get("lvl") == 0),
                    _clean(g.get("name") or ""))          # 옛 파일 방어(루트 lvl이 -1인 경우)
        ctrl = {root: (0, 100.0)}
        for e in g.get("edges") or []:
            nd = byid.get(e["t"])
            if nd and nd.get("lvl", 0) > 0 and _is_ctrl(nd, e.get("rate")):
                cur = ctrl.get(e["t"])
                cand = (nd.get("lvl", 9), e.get("rate") or 0)
                if not cur or cand[0] < cur[0] or (cand[0] == cur[0] and cand[1] > cur[1]):
                    ctrl[e["t"]] = cand
        groups[k] = {"name": g.get("name"), "n": len(ctrl), "all": len(byid),
                     "rank": rank.get(g.get("name"), 9999)}
        for cid, (lvl, rt) in ctrl.items():
            if byid.get(cid):
                search.setdefault(cid, []).append((lvl, -rt, groups[k]["rank"], k))
    # ⚠같은 회사가 여러 그래프에 걸친다(현대해상이 삼성물산 지분을 들고 있어 호텔신라까지 딸려옴).
    #   **루트에 가까운 쪽이 그 회사의 실제 소속**이므로 lvl 오름차순 → 지분율 내림차순으로 정렬해 앞에 둔다.
    (OUT / "search.json").write_text(json.dumps(
        {"groups": groups,
         "members": {kk: [x[3] for x in sorted(set(vv))[:5]] for kk, vv in search.items()}},
        ensure_ascii=False), encoding="utf-8")
    print(f"  검색 인덱스: 지배 계열사 {len(search):,}개 / 그룹 {len(groups)}")


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
r"""산업 분류 단일 기준표 — 한국·미국을 같은 30개 산업군으로 통일 (v396 전면 재편)

v396 재편(사용자 승인): 기존 15개 중분류는 크기가 극단적으로 불균형했다 — 상위 6개(반도체 482·
바이오 435·소비재 430·인터넷 365·화학 262·산업재 241)가 전체의 70%. 반면 조선(40)·방산(34)처럼
작아도 성격이 뚜렷한 그룹이 로테이션 판단에 더 유용했다 → 같은 기준으로 30개로 세분화.
  · 반도체에서 IT부품·통신장비 분리(핸드셋·통신장비는 반도체가 아니라 휴대폰 부품·네트워크 장비)
  · 바이오 → 제약·바이오 / 의료기기·헬스케어 (신약 사이클 vs 실적주 사이클)
  · 소비재 → 음식료 / 화장품·뷰티 / 패션·의류 / 유통·상사 / 레저·교육·여행
  · 인터넷 → 인터넷·SW / 게임 / 미디어·엔터 / 통신
  · 화학·소재 → 화학 / 철강·금속 · 산업재 → 기계·산업재 / 운송·물류
  · 건설 → 건설·건자재 / 부동산·리츠 · 에너지 → 에너지 / 유틸리티 / 전력기기·전선
  · 금융 → 금융(은행·보험) / 증권·창투

설계 결정(기존 유지)
  · 밸류체인(CHAINS)은 대체하지 않는다 — 산업군 아래의 별도 축으로 병존(프런트 CHAIN_OF_GRP가 연결).
  · 산업지표(sector_metrics)는 지표 큐레이션 단위(12그룹)를 유지 — 프런트 SECMET_OF가 30→12로 매핑.
  · 미국은 company.json `industry`(yfinance 세부 업종) 우선, 없으면 GICS 대분류 폴백(거칠다).
"""
import re

# id: (한글명, 아이콘) — 30개 산업군. ⚠키를 바꾸면 market.json·market_pro.json 재생성 +
# app.js IND_GROUPS/CHAIN_OF_GRP/SECMET_OF + engine 동기화가 한 세트다(CLAUDE.md v396).
GROUPS = {
    "semi": ("반도체", "🔌"),
    "itparts": ("IT부품·통신장비", "📡"),
    "display": ("디스플레이", "🖥️"),
    "battery": ("2차전지", "🔋"),
    "auto": ("자동차", "🚗"),
    "pharma": ("제약·바이오", "💊"),
    "meddev": ("의료기기·헬스케어", "🩺"),
    "food": ("음식료", "🍜"),
    "beauty": ("화장품·뷰티", "💄"),
    "apparel": ("패션·의류", "👕"),
    "retail": ("유통·상사", "🛒"),
    "leisure": ("레저·교육·여행", "🎡"),
    "internet": ("인터넷·SW", "📱"),
    "game": ("게임", "🎮"),
    "media": ("미디어·엔터", "🎬"),
    "telecom": ("통신", "📶"),
    "chem": ("화학", "⚗️"),
    "steel": ("철강·금속", "🔩"),
    "machinery": ("기계·산업재", "🏭"),
    "transport": ("운송·물류", "🚚"),
    "construction": ("건설·건자재", "🏗️"),
    "realestate": ("부동산·리츠", "🏢"),
    "defense": ("방산·우주항공", "🛡️"),
    "ship": ("조선·해운", "🚢"),
    "energy": ("에너지", "⛽"),
    "utility": ("유틸리티", "💡"),
    "electric": ("전력기기·전선", "⚡"),
    "finance": ("금융(은행·보험)", "🏦"),
    "securities": ("증권·창투", "📈"),
    "holding": ("지주회사", "🏛️"),
}
ETC = ("기타", "🏢")

# ── 한국: 네이버 업종(77) → 산업 ───────────────────────────────────────
KR_SECTORS = {
    "semi": ["반도체와반도체장비", "전자장비와기기", "전자제품", "컴퓨터와주변기기", "사무용전자제품"],
    # 핸드셋(스마트폰 부품)·통신장비(네트워크)는 반도체 사이클과 겹치지만 별개 수주 구조 — v396 분리
    "itparts": ["통신장비", "핸드셋"],
    "display": ["디스플레이장비및부품", "디스플레이패널"],
    # ⚠"전기장비·비철금속"을 여기 두면 안 된다(2026-07-26 감사): 전선·전력기기·제련사가 통째로
    #   2차전지로 잡혀 72종목 중 46종목(64%)이 전지와 무관했다. electric/steel 참조.
    "battery": ["전기제품"],
    "auto": ["자동차", "자동차부품"],
    # 신약 사이클(제약·바이오) vs 실적주(의료기기·서비스) — v396 분리
    "pharma": ["제약", "생물공학", "생명과학도구및서비스"],
    "meddev": ["건강관리장비와용품", "건강관리업체및서비스", "건강관리기술"],
    "food": ["식품", "음료", "담배", "식품과기본식료품소매"],
    "beauty": ["화장품"],
    "apparel": ["섬유,의류,신발,호화품"],
    "retail": ["백화점과일반상점", "전문소매", "인터넷과카탈로그소매", "무역회사와판매업체",
               "판매업체", "가정용기기와용품", "가정용품", "문구류"],
    "leisure": ["호텔,레스토랑,레저", "레저용장비와제품", "교육서비스", "다각화된소비자서비스"],
    "internet": ["소프트웨어", "IT서비스", "양방향미디어와서비스"],
    "game": ["게임엔터테인먼트"],
    "media": ["방송과엔터테인먼트", "광고", "출판"],
    "telecom": ["무선통신서비스", "다각화된통신서비스"],
    "chem": ["화학", "종이와목재", "포장재"],
    # 제련·압연(고려아연·풍산)은 금속 사이클 — 화학과 분리(v396)
    "steel": ["철강", "비철금속"],
    "machinery": ["기계", "상업서비스와공급품"],
    "transport": ["항공화물운송과물류", "운송인프라", "도로와철도운송", "항공사"],
    "defense": ["우주항공과국방"],
    "ship": ["조선", "해운사"],
    "construction": ["건설", "건축자재", "건축제품", "가구"],
    "realestate": ["부동산"],
    "energy": ["석유와가스", "에너지장비및서비스"],
    "utility": ["전기유틸리티", "가스유틸리티", "복합유틸리티"],
    # 전선·변압기·차단기 — 전력망(그리드) 투자 사이클(v396 단독 승격, HD일렉트릭·효성중공업·대한전선)
    "electric": ["전기장비"],
    "finance": ["은행", "생명보험", "손해보험", "카드", "기타금융"],
    "securities": ["증권", "창업투자"],
    # 지주회사: 사업이 여러 산업에 걸쳐 하나로 묶을 수 없는 '복합기업'.
    # (POSCO홀딩스=철강, HD한국조선해양=조선처럼 자회사가 한 산업에 몰린 지주는 그 산업에 그대로 둔다)
    "holding": ["복합기업"],
}
_KR = {s: g for g, arr in KR_SECTORS.items() for s in arr}

# ── 종목 단위 교정 ────────────────────────────────────────────────────
# 네이버 업종이 실제 사업과 다른 종목만 최소한으로. 근거는 company.json 사업 설명문.
KR_TICKER = {
    # 네이버 업종이 실제 사업과 전혀 다른 경우
    "140410": "pharma",     # 메지온 — 업종'식품'이나 폰탄수술 치료제 등 신약개발
    "048410": "pharma",     # 현대바이오 — 업종'화장품'이나 항바이러스·항암 신약
    "005690": "pharma",     # 파미셀 — 업종'화학'이나 줄기세포치료제 본업
    "052020": "pharma",     # 에스티큐브 — 업종'판매업체'이나 면역항암 신약
    "000670": "steel",      # 영풍 — 업종'핸드셋'이나 아연 제련이 본업
    "041020": "internet",   # 폴라리스오피스 — 업종'자동차부품'이나 오피스 소프트웨어
    "121800": "itparts",    # 비덴트 — 업종'디스플레이패널'이나 HD 방송장비(하드웨어)
    # '전기제품'(기본 2차전지) 중 전지와 무관한 전자부품·기계
    "001820": "itparts",    # 삼화콘덴서 — MLCC·필름콘덴서(전자부품)
    "005680": "itparts",    # 삼영전자 — 알루미늄 전해콘덴서
    "009470": "itparts",    # 삼화전기 — 전해·하이브리드 콘덴서
    "043260": "itparts",    # 성호전자 — 필름콘덴서·전원공급장치
    "079960": "itparts",    # 동양이엔피 — SMPS·전원공급장치
    "058610": "machinery",  # 에스피지 — 정밀 기어드 모터
    # 순수지주회사(자체 사업 없이 여러 산업의 자회사 보유)
    "036830": "holding",    # 솔브레인홀딩스
    "042370": "holding",    # 비츠로테크
    "006260": "holding",    # LS
    "015860": "holding",    # 일진홀딩스
}

# ── 미국: yfinance 세부 업종 → 산업군 (키워드 규칙, 위에서부터 우선) ──
# ⚠순서가 곧 우선순위다: 구체적 패턴을 앞에(게임→미디어보다, IT부품→유통 distribution보다).
US_RULES = [
    ("display", r"display|panel"),
    ("game", r"electronic gaming"),
    ("telecom", r"telecom"),
    ("media", r"entertainment|internet content|advertis|broadcast|publish|media"),
    ("internet", r"software|information technology services"),
    ("semi", r"semiconductor"),
    ("itparts", r"communication equipment|electronic component|consumer electronic|"
                r"computer hardware|electronics & computer distribution|scientific & technical"),
    ("pharma", r"drug manufactur|biotechnolog|pharmaceutical|therapeut"),
    ("meddev", r"medical|diagnostics|health information|dental|healthcare"),
    ("auto", r"auto manufactur|auto parts|auto & truck|recreational vehicle|auto dealer"),
    ("battery", r"solar|batter"),
    ("electric", r"electrical equipment"),
    ("securities", r"capital markets|asset management|financial data"),
    ("finance", r"bank|credit services|insurance|financial conglomerate|mortgage|shell compan"),
    ("realestate", r"reit|real estate"),
    ("construction", r"engineering & construction|building products|residential construction"),
    ("ship", r"marine shipping|shipbuilding"),
    ("transport", r"railroad|airlines|integrated freight|trucking|airport"),
    ("machinery", r"farm & heavy construction machinery|specialty industrial|"
                  r"industrial distribution|conglomerates|business equipment|staffing|"
                  r"consulting|security & protection|waste management|rental & leasing|tools & accessor"),
    ("steel", r"steel|copper|aluminum|gold|silver|other industrial metals"),
    ("chem", r"chemical|paper|packaging|lumber"),
    ("utility", r"utilities"),
    ("energy", r"oil & gas|coal|uranium|renewable"),
    ("defense", r"aerospace & defense"),
    ("food", r"beverage|tobacco|food|confectioner|packaged|grocer|agricultur|farm products"),
    ("beauty", r"household & personal"),
    ("apparel", r"apparel|footwear|luxury|textile"),
    ("leisure", r"restaurant|leisure|lodging|resort|travel|gambling|casino|education"),
    ("retail", r"retail|stores|furnishing|department|home improvement"),
]
# 세부 업종이 없을 때 쓰는 GICS 대분류(한글) 폴백 — 입도가 거칠어 정확도 낮음
US_SECTOR_FALLBACK = {
    "기술": "semi", "헬스케어": "pharma", "금융": "finance", "산업재": "machinery",
    "임의소비재": "retail", "필수소비재": "food", "커뮤니케이션": "internet",
    "에너지": "energy", "유틸리티": "utility", "소재": "chem", "부동산": "realestate",
}


_US_EXTRA = None


def _us_extra() -> dict:
    """company.json에 아직 없는 미국 종목의 세부 업종(data/us_industry.json).
    유니버스 확장으로 새로 들어온 종목은 company.json이 주1회 가드라 한동안 비어 있다."""
    global _US_EXTRA
    if _US_EXTRA is None:
        from pathlib import Path
        p = Path(__file__).resolve().parent.parent / "data" / "us_industry.json"
        try:
            import json as _j
            _US_EXTRA = _j.loads(p.read_text(encoding="utf-8"))
        except Exception:
            _US_EXTRA = {}
    return _US_EXTRA


def group_of(market: str, sector: str | None, industry: str | None = None,
             ticker: str | None = None) -> str:
    """(시장, 업종, 세부업종) → 산업군 id. 못 찾으면 'etc'."""
    if market == "kr":
        if ticker and ticker in KR_TICKER:   # 종목 교정이 업종 매핑보다 우선
            return KR_TICKER[ticker]
        return _KR.get((sector or "").strip(), "etc")
    if not industry and ticker:
        industry = _us_extra().get(ticker)
    ind = (industry or "").lower()
    if ind:
        for gid, pat in US_RULES:
            if re.search(pat, ind):
                return gid
    return US_SECTOR_FALLBACK.get((sector or "").strip(), "etc")


def label(gid: str) -> str:
    ko, ico = GROUPS.get(gid, ETC)
    return f"{ico} {ko}"


def name(gid: str) -> str:
    return GROUPS.get(gid, ETC)[0]

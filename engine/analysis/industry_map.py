# -*- coding: utf-8 -*-
r"""산업 분류 단일 기준표 — 한국·미국을 같은 12개 산업군으로 통일

이 프로젝트에는 화면마다 다른 분류가 5개 있었다(주식찾기 KR=밸류체인 / 주식찾기 US=GICS 10대분류 /
산업 진단 지표=12산업군 / 섹터 로테이션=원천 업종 / 보유 비중=세분류).
**종목조회에서 산업 지표를 그대로 끌어 쓰려면** 지표가 붙어 있는 단위로 통일해야 하므로
`sector_metrics.GROUPS`(12산업군)를 표준으로 삼고, 여기에 **미국 매핑을 추가**한다.

설계 결정
  · 소프트웨어·IT서비스 → **인터넷·SW·미디어**(반도체·IT가 아니라). 산업지표가 이미 그 단위로
    큐레이션돼 있어 지표 연결이 깨지지 않는다.
  · 밸류체인(CHAINS)은 **대체하지 않는다** — 한 종목이 여러 체인에 속하고(솔브레인=반도체 소재
    +2차전지 소재) 공정 순서를 담기 때문에, 산업군 아래의 별도 축으로 병존시킨다.

미국은 heatmap의 sector가 GICS 대분류 12개뿐이고 '기타'가 38종목이라 그것만으로는 못 쪼갠다
→ **company.json의 `industry`(yfinance 세부 업종) 우선**, 없으면 sector로 폴백한다.
"""
import re

# id: (한글명, 아이콘) — **주식찾기 밸류체인(CHAINS)과 동일한 14산업**이 표준이다.
# (앞서 12산업군을 따로 두었더니 밸류체인과 이름이 겹쳐 중복이었다 → 밸류체인 체계로 일원화)
GROUPS = {
    "semi": ("반도체", "🔌"),
    "battery": ("2차전지", "🔋"),
    "auto": ("자동차", "🚗"),
    "bio": ("바이오·헬스", "💊"),
    "display": ("디스플레이", "🖥️"),
    "defense": ("방산·우주항공", "🛡️"),
    "ship": ("조선·해운", "🚢"),
    "chem": ("화학·소재", "⚗️"),
    "energy": ("에너지·유틸리티", "⛽"),
    "machinery": ("산업재·기계·운송", "🏭"),
    "construction": ("건설·건자재", "🏗️"),
    "internet": ("인터넷·게임·엔터", "📱"),
    "finance": ("금융", "🏦"),
    "consumer": ("소비재·유통", "🛒"),
    "holding": ("지주회사", "🏛️"),
}
ETC = ("기타", "🏢")

# ── 한국: 네이버 업종(77) → 산업 ───────────────────────────────────────
KR_SECTORS = {
    "semi": ["반도체와반도체장비", "전자장비와기기", "전자제품", "컴퓨터와주변기기",
             "통신장비", "핸드셋", "사무용전자제품"],
    "display": ["디스플레이장비및부품", "디스플레이패널"],
    # ⚠"전기장비·비철금속"을 여기 두면 안 된다(2026-07-26 감사): 전선·전력기기·제련사가 통째로
    #   2차전지로 잡혀 72종목 중 46종목(64%)이 전지와 무관했다. 아래 energy/chem으로 이관.
    #   전기제품은 삼성SDI·에코프로비엠·LG에너지솔루션 등 실제 전지가 다수라 유지하고,
    #   콘덴서 등 전자부품은 KR_TICKER에서 개별 교정한다.
    "battery": ["전기제품"],
    "auto": ["자동차", "자동차부품"],
    "bio": ["제약", "생물공학", "생명과학도구및서비스", "건강관리업체및서비스",
            "건강관리장비와용품", "건강관리기술"],
    "ship": ["조선", "해운사"],
    "machinery": ["기계", "상업서비스와공급품", "항공화물운송과물류",
                  "운송인프라", "도로와철도운송", "항공사"],
    "defense": ["우주항공과국방"],
    # 제련·압연(고려아연·풍산·영풍·삼아알미늄)은 소재업 — 구 매핑에선 2차전지였다.
    "chem": ["화학", "철강", "종이와목재", "포장재", "비철금속"],
    # 지주회사: 사업이 여러 산업에 걸쳐 하나로 묶을 수 없는 '복합기업'을 별도 산업으로 분리.
    # (POSCO홀딩스=철강, HD한국조선해양=조선처럼 자회사가 한 산업에 몰린 지주는 그 산업에 그대로 둔다)
    "holding": ["복합기업"],
    "construction": ["건설", "건축자재", "건축제품", "부동산", "가구"],
    "finance": ["은행", "증권", "생명보험", "손해보험", "카드", "기타금융", "창업투자"],
    "consumer": ["식품", "음료", "담배", "화장품", "섬유,의류,신발,호화품", "백화점과일반상점",
                 "전문소매", "식품과기본식료품소매", "인터넷과카탈로그소매", "무역회사와판매업체",
                 "판매업체", "가정용기기와용품", "가정용품", "레저용장비와제품",
                 "호텔,레스토랑,레저", "교육서비스"],
    "internet": ["소프트웨어", "IT서비스", "게임엔터테인먼트", "양방향미디어와서비스",
                 "방송과엔터테인먼트", "광고", "출판", "다각화된통신서비스", "무선통신서비스"],
    # 전선·변압기·차단기 등 전력기기는 전력망(그리드) 투자 사이클을 따른다 — 2차전지가 아니다.
    "energy": ["석유와가스", "에너지장비및서비스", "전기유틸리티", "가스유틸리티", "복합유틸리티",
               "전기장비"],
}
_KR = {s: g for g, arr in KR_SECTORS.items() for s in arr}

# ── 종목 단위 교정 ────────────────────────────────────────────────────
# 네이버 업종이 실제 사업과 다른 종목(업종 자체가 오분류)과, 한 업종에 성격이 섞여 있어
# 업종 단위로는 못 가르는 종목만 최소한으로 지정한다. 근거는 company.json 사업 설명문.
KR_TICKER = {
    # 네이버 업종이 실제 사업과 전혀 다른 경우
    "140410": "bio",        # 메지온 — 업종'식품'이나 폰탄수술 치료제 등 신약개발
    "048410": "bio",        # 현대바이오 — 업종'화장품'이나 항바이러스·항암 신약
    "005690": "bio",        # 파미셀 — 업종'화학'이나 줄기세포치료제 본업
    "052020": "bio",        # 에스티큐브 — 업종'판매업체'이나 면역항암 신약
    "000670": "chem",       # 영풍 — 업종'핸드셋'이나 아연 제련이 본업
    "041020": "internet",   # 폴라리스오피스 — 업종'자동차부품'이나 오피스 소프트웨어
    "121800": "internet",   # 비덴트 — 업종'디스플레이패널'이나 HD 방송장비
    # '전기제품'(기본 2차전지) 중 전지와 무관한 전자부품·기계
    "001820": "semi",       # 삼화콘덴서 — MLCC·필름콘덴서
    "005680": "semi",       # 삼영전자 — 알루미늄 전해콘덴서
    "009470": "semi",       # 삼화전기 — 전해·하이브리드 콘덴서
    "043260": "semi",       # 성호전자 — 필름콘덴서·전원공급장치
    "079960": "semi",       # 동양이엔피 — SMPS·전원공급장치
    "058610": "machinery",  # 에스피지 — 정밀 기어드 모터
    # 순수지주회사(자체 사업 없이 여러 산업의 자회사 보유)
    "036830": "holding",    # 솔브레인홀딩스
    "042370": "holding",    # 비츠로테크
    "006260": "holding",    # LS
    "015860": "holding",    # 일진홀딩스
}

# ── 미국: yfinance 세부 업종 → 산업군 (키워드 규칙, 위에서부터 우선) ──
# 46개 실측 업종을 덮되, 새 업종이 나와도 키워드로 흡수되게 한다.
US_RULES = [
    ("display", r"display|panel"),
    ("semi", r"semiconductor|electronic component|consumer electronic|computer hardware|"
             r"communication equipment|electronics & computer distribution|scientific & technical"),
    ("internet", r"software|information technology services|internet content|internet retail|"
                 r"electronic gaming|entertainment|advertis|broadcast|publish|telecom|media"),
    ("bio", r"drug manufactur|biotechnolog|medical|healthcare|health information|diagnostics|"
            r"pharmaceutical|dental|therapeut"),
    ("auto", r"auto manufactur|auto parts|auto & truck|recreational vehicle|auto dealer"),
    ("battery", r"solar|electrical equipment|batter"),
    ("finance", r"bank|capital markets|credit services|insurance|asset management|"
                r"financial data|financial conglomerate|mortgage|shell compan"),
    ("construction", r"reit|real estate|engineering & construction|building products|"
                     r"residential construction|home improvement"),
    ("ship", r"marine shipping|shipbuilding"),
    ("machinery", r"railroad|airlines|integrated freight|trucking|airport|"
                  r"farm & heavy construction machinery|specialty industrial|"
                  r"industrial distribution|conglomerates|business equipment|staffing|"
                  r"consulting|security & protection|waste management|rental & leasing|tools & accessor"),
    ("chem", r"chemical|steel|copper|aluminum|paper|packaging|gold|silver|"
             r"other industrial metals|lumber"),
    ("energy", r"oil & gas|utilities|coal|uranium|renewable"),
    ("defense", r"aerospace & defense"),
    ("consumer", r"retail|stores|restaurant|beverage|tobacco|household|personal|apparel|footwear|"
                 r"food|confectioner|packaged|leisure|lodging|resort|travel|education|gambling|"
                 r"casino|furnishing|luxury|department|grocer|agricultur"),
]
# 세부 업종이 없을 때 쓰는 GICS 대분류(한글) 폴백 — 입도가 거칠어 정확도 낮음
US_SECTOR_FALLBACK = {
    "기술": "semi", "헬스케어": "bio", "금융": "finance", "산업재": "machinery",
    "임의소비재": "consumer", "필수소비재": "consumer", "커뮤니케이션": "internet",
    "에너지": "energy", "유틸리티": "energy", "소재": "chem", "부동산": "construction",
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

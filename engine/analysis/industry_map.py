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
}
ETC = ("기타", "🏢")

# ── 한국: 네이버 업종(77) → 산업 ───────────────────────────────────────
KR_SECTORS = {
    "semi": ["반도체와반도체장비", "전자장비와기기", "전자제품", "컴퓨터와주변기기",
             "통신장비", "핸드셋", "사무용전자제품"],
    "display": ["디스플레이장비및부품", "디스플레이패널"],
    "battery": ["전기장비", "전기제품", "비철금속"],
    "auto": ["자동차", "자동차부품"],
    "bio": ["제약", "생물공학", "생명과학도구및서비스", "건강관리업체및서비스",
            "건강관리장비와용품", "건강관리기술"],
    "ship": ["조선", "해운사"],
    "machinery": ["기계", "상업서비스와공급품", "복합기업", "항공화물운송과물류",
                  "운송인프라", "도로와철도운송", "항공사"],
    "defense": ["우주항공과국방"],
    "chem": ["화학", "철강", "종이와목재", "포장재"],
    "construction": ["건설", "건축자재", "건축제품", "부동산", "가구"],
    "finance": ["은행", "증권", "생명보험", "손해보험", "카드", "기타금융", "창업투자"],
    "consumer": ["식품", "음료", "담배", "화장품", "섬유,의류,신발,호화품", "백화점과일반상점",
                 "전문소매", "식품과기본식료품소매", "인터넷과카탈로그소매", "무역회사와판매업체",
                 "판매업체", "가정용기기와용품", "가정용품", "레저용장비와제품",
                 "호텔,레스토랑,레저", "교육서비스"],
    "internet": ["소프트웨어", "IT서비스", "게임엔터테인먼트", "양방향미디어와서비스",
                 "방송과엔터테인먼트", "광고", "출판", "다각화된통신서비스", "무선통신서비스"],
    "energy": ["석유와가스", "에너지장비및서비스", "전기유틸리티", "가스유틸리티", "복합유틸리티"],
}
_KR = {s: g for g, arr in KR_SECTORS.items() for s in arr}

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

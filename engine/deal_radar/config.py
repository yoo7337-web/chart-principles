"""설정 로딩 및 기업금융 키워드 사전."""
from __future__ import annotations

import os
from pathlib import Path

import yaml
from dotenv import load_dotenv

# 프로젝트 루트 (deal_radar/ 의 상위)
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "deals.db"
SOURCES_PATH = ROOT / "sources.yaml"

load_dotenv(ROOT / ".env")

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_CHANNEL_ID = os.getenv("TELEGRAM_CHANNEL_ID", "").strip()

# ── 이메일(Gmail SMTP) 동시 발송 ──────────────────────────────
EMAIL_ENABLED = os.getenv("EMAIL_ENABLED", "false").strip().lower() in ("1", "true", "yes")
EMAIL_FROM = os.getenv("EMAIL_FROM", "").strip()            # 보내는 Gmail 주소
EMAIL_TO = os.getenv("EMAIL_TO", "").strip()               # 받는 주소(쉼표로 여러 명)
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "").strip()  # 16자리 앱 비밀번호

# ── Gemini AI 큐레이션(선택) ──────────────────────────────────
# GEMINI_API_KEY 가 있으면 발송 전 수집 기사 목록을 AI가 요약·정리해
# 다이제스트 상단에 '오늘의 큐레이션'으로 덧붙인다. 키가 없거나 실패하면
# 조용히 건너뛰고 기존 기사 목록만 발송(파이프라인을 막지 않음).
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
CURATION_ENABLED = os.getenv("CURATION_ENABLED", "true").strip().lower() in ("1", "true", "yes")

# 한 통의 텔레그램 메시지 최대 길이(여유분 포함)
TELEGRAM_MAX_LEN = 3800

# 다이제스트 1회 표시 상한(가독성·rate limit 보호). 초과분은 "외 N건"으로 요약.
MAX_PRIORITY = 30   # 더벨·딜사이트 등 우선 출처 전용 섹션
MAX_NEW_DEALS = 30
MAX_FOLLOWUPS = 20

# ── 기업금융 관련성 필터 키워드 ───────────────────────────────
# 제목/요약에 아래 중 하나라도 포함되면 "기업금융 뉴스"로 채택.
KEYWORDS = [
    # M&A / 경영권
    "인수", "합병", "인수합병", "M&A", "경영권", "지분", "매각", "피인수",
    "바이아웃", "콜옵션", "풋옵션", "공개매수", "주식양수도",
    "merger", "acquisition", "acquire", "takeover", "buyout", "stake",
    "divestiture", "divest", "tender offer", "spin-off", "spinoff",
    # 자본 / 금융거래
    "유상증자", "무상증자", "회사채", "전환사채", "신주인수권", "BW", "CB",
    "상장", "IPO", "투자유치", "출자", "프리IPO", "메자닌", "유동화",
    "사모펀드", "PEF", "벤처투자", "리캡", "배당",
    "equity offering", "bond issuance", "capital raise", "private equity",
    "venture capital", "recapitalization", "rights issue", "convertible",
]

# 딜 그룹핑에서 제외할 불용어(엔티티 후보에서 제거)
STOPWORDS = set(KEYWORDS) | {
    "the", "and", "for", "with", "from", "into", "deal", "billion", "million",
    "company", "group", "inc", "corp", "ltd", "co", "news", "report", "says",
    "그룹", "기업", "회사", "지분율", "관련", "추진", "검토", "완료", "발표",
}


def load_sources() -> list[dict]:
    """sources.yaml 의 소스 목록 반환."""
    with open(SOURCES_PATH, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return data.get("sources", [])


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

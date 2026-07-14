# -*- coding: utf-8 -*-
"""공용 Gemini 헬퍼 — stock-radar curator.py 패턴 이식 + 토큰 잘림 대응 보강.

- REST 직접 호출(gemini-2.5-flash, 무료 티어), 실패 시 None 반환(파이프라인 안 막음)
- 키: env GEMINI_API_KEY → 없으면 stock-radar\\.env 폴백
- maxOutputTokens 지정 + finishReason 체크(잘림 이력 대응)
- sanitize: 코드블록/마크다운 제거, <b>/<i>만 허용
- attach_refs: 모델이 쓴 [근거 #n] 마커를 코드가 실제 링크로 치환(URL 환각 방지)
"""
import html
import os
import re
import sys
from pathlib import Path

MODEL = "gemini-2.5-flash"  # 2.0-flash는 이 키에서 무료 limit 0 (stock-radar 이력)
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
TIMEOUT = 90
ENV_FALLBACK = Path(r"C:\Users\yoo73\stock-radar\.env")


def _load_key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if key:
        return key
    if ENV_FALLBACK.exists():
        for line in ENV_FALLBACK.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("GEMINI_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def generate(prompt: str, max_tokens: int = 2048) -> str | None:
    """Gemini 호출 — 실패/키 없음/잘림 심각 시 None."""
    import requests

    key = _load_key()
    if not key:
        print("[gemini] GEMINI_API_KEY 없음 — 큐레이션 건너뜀", file=sys.stderr)
        return None
    try:
        r = requests.post(URL, params={"key": key}, timeout=TIMEOUT, json={
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.4,
                                 # 2.5-flash는 기본 thinking이 출력 토큰을 소모 → 비활성화
                                 "thinkingConfig": {"thinkingBudget": 0}},
        })
        r.raise_for_status()
        cand = r.json()["candidates"][0]
        text = cand["content"]["parts"][0]["text"]
        if cand.get("finishReason") not in (None, "STOP"):
            # 잘림 — 마지막 미완성 문장 제거 후 사용
            text = re.sub(r"[^.!?다요음됨\n]*$", "", text).strip()
            print(f"[gemini] 출력 잘림(finishReason={cand.get('finishReason')}) — 말단 정리 후 사용",
                  file=sys.stderr)
        return text if text.strip() else None
    except Exception as e:
        print(f"[gemini] 호출 실패(무시): {e}", file=sys.stderr)
        return None


def sanitize(text: str) -> str:
    """마크다운/코드블록 제거 → HTML escape → <b>/<i>만 복원."""
    t = re.sub(r"```.*?```", "", text, flags=re.S)
    t = re.sub(r"^#+\s*", "", t, flags=re.M)
    t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
    t = re.sub(r"(?<!\w)\*(.+?)\*(?!\w)", r"<i>\1</i>", t)
    t = html.escape(t, quote=False)
    t = t.replace("&lt;b&gt;", "<b>").replace("&lt;/b&gt;", "</b>")
    t = t.replace("&lt;i&gt;", "<i>").replace("&lt;/i&gt;", "</i>")
    for tag in ("b", "i"):  # 태그 불균형 시 해당 태그 제거
        if t.count(f"<{tag}>") != t.count(f"</{tag}>"):
            t = t.replace(f"<{tag}>", "").replace(f"</{tag}>", "")
    return t.strip()


def attach_refs(body: str, articles: list) -> str:
    """[근거 #1 #3] → 실제 기사 링크 <a> 치환. articles[i]에 'link' 필요(1-base 번호)."""
    def repl(m):
        nums = re.findall(r"\d+", m.group(0))
        links = []
        for n in nums:
            i = int(n) - 1
            if 0 <= i < len(articles):
                links.append(f'<a href="{articles[i]["link"]}" target="_blank" rel="noopener">#{n}</a>')
        return (" [" + " ".join(links) + "]") if links else ""
    return re.sub(r"\s*\[근거[^\]]*\]", repl, body)

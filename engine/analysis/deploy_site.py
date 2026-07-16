# -*- coding: utf-8 -*-
r"""GitHub Pages 배포: app\ 전체(gitignore된 stocks/ 포함)를 배포 전용 repo로 복사 → amend+force push.

- 배포 repo: C:\Users\yoo73\chart-principles-site (원격 yoo7337-web/chart-principles, main)
- 매일 15MB JSON이 바뀌므로 단일 커밋 유지(--amend + --force) → repo 비대 방지
- URL: https://yoo7337-web.github.io/chart-principles/

사용법: python analysis\deploy_site.py
"""
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "app"
SITE = Path.home() / "chart-principles-site"
REMOTE = "https://github.com/yoo7337-web/chart-principles.git"

# 클라우드(refresh.yml)가 24시간 갱신하는 파일 — 노트북 배포는 이들을 덮어쓰지 않고 원격본 보존
CLOUD_OWNED = [
    "data/market.json", "data/market_pro.json", "data/news.json",
    "data/news_archive.json", "data/news_briefings.json",
    "data/deals.json", "data/deals_archive.json", "data/deals_briefings.json",
    "data/calendar.json",  # KIND 클라우드 접근 프로브 OK(2026-07-17) → 완전 클라우드 소유
]


def git(*args, check=True):
    return subprocess.run(["git", *args], cwd=SITE, capture_output=True, text=True, check=check)


WORKFLOW = """\
name: Deploy Pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: '.'
      - id: deployment
        uses: actions/deploy-pages@v4
"""


def _ensure_workflow() -> None:
    """Actions 기반 Pages 배포 워크플로를 site repo에 유지 (레거시 빌드 끼임 방지)."""
    wf = SITE / ".github" / "workflows" / "deploy.yml"
    wf.parent.mkdir(parents=True, exist_ok=True)
    if not wf.exists() or wf.read_text(encoding="utf-8") != WORKFLOW:
        wf.write_text(WORKFLOW, encoding="utf-8")


def main():
    # --- 배포 repo 준비 ---
    if not (SITE / ".git").exists():
        SITE.mkdir(exist_ok=True)
        subprocess.run(["git", "init", "-b", "main"], cwd=SITE, check=True)
        git("remote", "add", "origin", REMOTE)
        print(f"배포 repo 초기화: {SITE}")

    # --- app\ → site 동기화 (삭제 반영, .git·.github·engine 보존) ---
    #  engine/ = 클라우드 갱신 엔진(refresh.yml이 돌리는 분석 코드) — 노트북 배포가 지우면 안 됨
    for item in SITE.iterdir():
        if item.name in (".git", ".github", "engine"):
            continue
        shutil.rmtree(item) if item.is_dir() else item.unlink()
    for item in APP.iterdir():
        dst = SITE / item.name
        shutil.copytree(item, dst) if item.is_dir() else shutil.copy2(item, dst)
    (SITE / ".nojekyll").write_text("")
    _ensure_workflow()

    # --- 클라우드 소유 파일은 원격(클라우드가 방금 갱신한 최신)을 우선 보존 ---
    #  노트북 로컬본이 오래됐어도 이 파일들은 클라우드가 24시간 갱신 → 덮어쓰지 않음.
    #  (macro/heatmap/breadth=market.json, market_pro, news 계열. 나머지는 노트북 소유.)
    git("fetch", "origin", "main", check=False)
    for f in CLOUD_OWNED:
        r = git("checkout", "origin/main", "--", f, check=False)  # 원격에 있으면 그 버전으로
        if r.returncode == 0:
            print(f"  클라우드 소유 보존: {f}")

    # --- 일반 커밋 + rebase push (클라우드 cron 커밋과 공존, force-push 안 함) ---
    git("add", "-A")
    if git("status", "--porcelain").stdout.strip() == "":
        print("변경 없음 — push 생략")
        return
    msg = f"deploy(laptop) {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    git("commit", "-m", msg)
    # 원격의 클라우드 커밋을 먼저 당겨오기(있으면 rebase), 그 위에 push
    git("fetch", "origin", "main", check=False)
    rb = git("rebase", "origin/main", check=False)
    if rb.returncode != 0:
        git("rebase", "--abort", check=False)
        # 충돌 시: 원격 우선(클라우드 최신 데이터 보존), 로컬 변경만 다시 얹기 위해 merge -X ours 대신 재시도
        git("reset", "--soft", "origin/main", check=False)
        git("commit", "-m", msg, check=False)
    r = git("push", "-u", "origin", "main", check=False)
    if r.returncode != 0:
        print("push 실패:", r.stderr.strip()[:500], file=sys.stderr)
        sys.exit(1)
    n = len(list(SITE.rglob("*")))
    print(f"배포 완료 ({msg}, 파일 {n}개) → https://yoo7337-web.github.io/chart-principles/")


if __name__ == "__main__":
    main()

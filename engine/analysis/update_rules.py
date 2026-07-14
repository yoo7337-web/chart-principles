# -*- coding: utf-8 -*-
r"""원칙 재검증 오케스트레이터 — 수동 트리거 전용, 최소 텀 가드 포함.

원칙(순위표)이 갱신되면 의존 탭 전부를 한 체인으로 재생성:
  collect(증분) → report(원칙+사례차트) → apply2026 → regime_report(국면별)
  → stock_pages(종목조회) → simulate(시뮬레이션) → scan_today(오늘의 신호)

⚠ 재검증 텀: 최소 90일. 너무 자주 재검증하면 원칙이 최근 데이터에 과최적화되어
  '검증'이 아니라 '커브 피팅'이 된다. 예외적으로 --force로 무시 가능.

사용법:
    python analysis\update_rules.py            # 텀 확인 후 전체 체인 실행 (~15분)
    python analysis\update_rules.py --force    # 텀 무시 (비권장)
    python analysis\update_rules.py --full-collect  # 증분 대신 전체 재수집(주가 조정 반영)
"""
import argparse
import json
import shutil
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
RESULTS = ROOT / "app" / "data" / "results.json"
MIN_DAYS = 90  # 재검증 최소 텀


def archive_snapshot() -> None:
    """검증 결과를 history\에 보존 + rule_history.json에 원칙별 성적 시계열 append.

    → 재검증 때마다 results.json이 덮어써져도 '원칙이 시간에 따라 어떻게 변했나'를 추적 가능.
    """
    res = json.loads(RESULTS.read_text(encoding="utf-8"))
    day = res["generated"]

    hist_dir = ROOT / "history" / day
    hist_dir.mkdir(parents=True, exist_ok=True)
    for name in ("results.json", "regimes.json", "apply2026.json"):
        src = ROOT / "app" / "data" / name
        if src.exists():
            shutil.copy2(src, hist_dir / name)

    rh_path = ROOT / "app" / "data" / "rule_history.json"
    rh = json.loads(rh_path.read_text(encoding="utf-8")) if rh_path.exists() else {"entries": []}
    entry = {
        "date": day,
        "universe": {"kr": res["meta"]["n_kr"], "us": res["meta"]["n_us"]},
        "rules": [{"rule_id": r["rule_id"], "name": r["name"], "side": r["side"],
                   "edge20": r["edge20"], "win_rate": r["win_rate"], "n": r["n"],
                   "passed": r["passed"], "selected": r["selected"]} for r in res["rules"]],
    }
    rh["entries"] = [e for e in rh["entries"] if e["date"] != day] + [entry]
    rh["entries"].sort(key=lambda e: e["date"])
    rh_path.write_text(json.dumps(rh, ensure_ascii=False), encoding="utf-8")
    print(f"이력 아카이브: history\\{day}\\ + rule_history.json ({len(rh['entries'])}개 스냅샷)")


def selected_rules() -> dict:
    if not RESULTS.exists():
        return {}
    r = json.loads(RESULTS.read_text(encoding="utf-8"))
    return {x["rule_id"]: x["name"] for x in r["rules"] if x.get("selected")}


def run_step(name: str, script: str, *args) -> None:
    print(f"\n=== {name} ===")
    res = subprocess.run([sys.executable, "-X", "utf8", str(HERE / script), *args],
                         cwd=ROOT)
    if res.returncode != 0:
        print(f"[중단] {script} 실패(exit {res.returncode}) — 이후 단계 실행 안 함", file=sys.stderr)
        sys.exit(res.returncode)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="재검증 텀(90일) 무시 — 과최적화 위험, 비권장")
    ap.add_argument("--full-collect", action="store_true", help="증분 대신 전체 재수집(~10분 추가)")
    ap.add_argument("--archive-only", action="store_true", help="체인 없이 현재 결과만 이력에 보존")
    args = ap.parse_args()

    if args.archive_only:
        archive_snapshot()
        return

    # --- 텀 가드 ---
    if RESULTS.exists():
        gen = datetime.strptime(
            json.loads(RESULTS.read_text(encoding="utf-8"))["generated"], "%Y-%m-%d").date()
        elapsed = (date.today() - gen).days
        if elapsed < MIN_DAYS and not args.force:
            nxt = gen + timedelta(days=MIN_DAYS)
            print(f"⛔ 재검증 텀 미충족: 마지막 검증 {gen} ({elapsed}일 전) — 최소 {MIN_DAYS}일 필요.")
            print(f"   다음 재검증 가능일: {nxt}")
            print(f"   (너무 잦은 재검증은 원칙을 최근 데이터에 과최적화시킴. 정말 필요하면 --force)")
            sys.exit(1)
        print(f"마지막 검증 {gen} ({elapsed}일 전) → 재검증 진행"
              + (" [--force]" if args.force and elapsed < MIN_DAYS else ""))

    old = selected_rules()

    run_step("1/8 데이터 수집", "collect.py", *([] if args.full_collect else ["--refresh"]))
    run_step("2/8 원칙 검증 + 사례차트 (report)", "report.py")
    run_step("3/8 2026 적용 (apply2026)", "apply2026.py")
    run_step("4/8 국면별 원칙 (regime_report)", "regime_report.py")
    run_step("5/8 종목 조회 사전생성 (stock_pages)", "stock_pages.py")
    run_step("6/8 전략 시뮬레이션 (simulate)", "simulate.py")
    run_step("7/8 오늘의 신호 (scan_today)", "scan_today.py")
    run_step("8/8 사이트 배포 (deploy_site)", "deploy_site.py")

    # --- 원칙 변경 diff ---
    new = selected_rules()
    dropped = {k: v for k, v in old.items() if k not in new}
    added = {k: v for k, v in new.items() if k not in old}
    print("\n===== 재검증 완료 =====")
    if not dropped and not added:
        print("최종 원칙 변동 없음 — commentary(해설) 갱신 불필요.")
    else:
        for k, v in dropped.items():
            print(f"  ➖ 탈락: {v} ({k})")
        for k, v in added.items():
            print(f"  ➕ 진입: {v} ({k})")
        print("⚠ 원칙이 바뀌었습니다 — Claude에게 apply_commentary.json / regime_commentary.json")
        print("  해설 갱신을 요청하세요 (\"원칙 해설 갱신해줘\").")
    archive_snapshot()


if __name__ == "__main__":
    main()

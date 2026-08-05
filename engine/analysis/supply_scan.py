r"""외국인·기관 수급 스크리닝 지표 → app\data\supply_scan.json (v339)

주식찾기에서 "최근 외국인 순매수 비중이 커진 종목"을 거르기 위한 종목별 수급 지표.

⚠**매수 신호로 검증되지 않았다.** 1,188종목·26만 관측(2025-07~2026-07) 이벤트 스터디 결과:
  · 날짜별 횡단면 순위로 보면 어떤 정의도 t+20 초과수익이 ±1%p 수준(승률 50~52%)
  · **모멘텀을 고정하면 부호가 뒤집힌다** — 약한 종목에선 (−), 강한 종목에선 (+).
    즉 외국인 매수는 '이미 가는 종목을 확인해 주는' 신호이지 반전 신호가 아니다.
  · 전 기간 공통 임계값(풀링 분위)을 쓰면 -7%p 같은 큰 수치가 나오는데, 이는 **종목이 아니라
    시점을 고른 것**(시장 전체에 외국인 자금이 몰린 = 고점 부근). 반드시 날짜별 순위로 볼 것.
따라서 화면에는 **정보 열·참고 필터**로만 제공하고 근거를 함께 표기한다.

⚠CLOUD_OWNED 금지: flow_*.parquet은 로컬에만 있어(네이버 스크래핑) 클라우드가 이 파일을 만들면
  빈 결과가 된다 → market.json에 넣지 않고 **별도 로컬 소유 파일**로 분리한다.

사용법: python analysis\supply_scan.py
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "app" / "data" / "supply_scan.json"
KST = timezone(timedelta(hours=9))

MIN_ROWS = 25          # 20일 지표를 만들려면 최소 이 정도는 있어야 한다
W = 20


def _mcaps() -> dict:
    """⚠`mcap_est`(시총 스크랩 실패 → 거래대금 대용값)는 **제외**한다.
    그대로 쓰면 '20일 순매수 ÷ 시총'이 217% 같은 값이 나온다(실측)."""
    try:
        hm = json.loads((ROOT / "app" / "data" / "market.json").read_text(encoding="utf-8")).get("heatmap") or []
        return {x["t"]: (x.get("mcap") or 0) for x in hm
                if x.get("m") == "kr" and not x.get("mcap_est")}
    except Exception:
        return {}


def build() -> dict:
    mcaps = _mcaps()
    out, skipped = {}, 0
    for fp in sorted(DATA.glob("flow_*.parquet")):
        code = fp.stem[5:]
        try:
            fl = pd.read_parquet(fp)
        except Exception:
            continue
        if len(fl) < MIN_ROWS:
            skipped += 1
            continue
        pp = DATA / f"kr_{code}.parquet"
        if not pp.exists():
            skipped += 1
            continue
        try:
            d = pd.read_parquet(pp).join(fl, how="inner").sort_index()
        except Exception:
            continue
        if len(d) < MIN_ROWS:
            skipped += 1
            continue
        c = d["close"]
        val = (c * d["volume"]).tail(W)
        fnet = (d["frgn_net_vol"] * c).tail(W)
        inet = (d["inst_net_vol"] * c).tail(W) if "inst_net_vol" in d else None
        mc = mcaps.get(code) or 0
        r = {}

        ratio = d.get("frgn_ratio")
        if ratio is not None and ratio.notna().sum() >= 2:
            rr = ratio.dropna()
            r["fr"] = round(float(rr.iloc[-1]), 2)                       # 외국인 보유율(%)
            if len(rr) > W:
                r["fdr20"] = round(float(rr.iloc[-1] - rr.iloc[-1 - W]), 3)   # 20일 변화(%p)
                # ⚠보유율은 **매매 이외 사유로도 점프**한다(증자·주식수 변동·외국인 등록 정정).
                #   실측: SK하이닉스 2026-07-15에 49.88 → 52.44(+2.56%p)인데 그날 순매수는 33만주로
                #   시총 대비 미미했다. 이런 날이 창 안에 있으면 '20일 변화'가 매매를 뜻하지 않는다.
                jump = float(rr.diff().tail(W).abs().max() or 0)
                if jump >= 1.0:
                    r["fdr_adj"] = round(jump, 2)     # 기준 변경 의심 — UI가 주의 표시
            # 보유율이 1년(=보유 이력) 최고치인가 — '추세적 축적' 여부
            if len(rr) >= 60:
                r["frhi"] = 1 if float(rr.iloc[-1]) >= float(rr.max()) - 1e-9 else 0

        fs = float(fnet.sum())
        r["fnet20"] = round(fs / 1e8, 1)                                 # 20일 누적 순매수(억원)
        if mc > 0:
            r["fmcap20"] = round(fs / mc * 100, 3)                       # 시총 대비(%)
        vs = float(val.sum())
        if vs > 0:
            r["fshare20"] = round(fs / vs * 100, 2)                      # 거래대금 대비(%)
        r["fdays20"] = round(float((fnet > 0).mean()) * 100, 1)          # 순매수일 비율(%)
        if inet is not None and mc > 0:
            r["imcap20"] = round(float(inet.sum()) / mc * 100, 3)        # 기관 시총 대비(%)
        r["n"] = int(min(len(d), W))
        out[code] = r
    return {"generated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"),
            "window": W, "map": out, "skipped": skipped}


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    res = build()
    OUT.write_text(json.dumps(res, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    m = res["map"]
    have = sum(1 for v in m.values() if v.get("fdr20") is not None)
    print(f"수급 지표 {len(m)}종목 (20일 변화 보유 {have} · 제외 {res['skipped']}) → {OUT.name}")


if __name__ == "__main__":
    main()

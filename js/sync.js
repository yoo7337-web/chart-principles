/* 기기 간 자동 동기화 — Firestore(career-board-fc111, To-Do 앱과 같은 프로젝트)
 *
 * 왜 필요한가: 관심종목·개발일지·포트폴리오 등은 전부 localStorage에 있고, localStorage는
 * **브라우저+도메인에 묶여** 서버로 가지 않는다 → 노트북을 바꾸면 빈 화면이 된다.
 * 개인 금융정보라 공개 repo엔 못 올리므로, **로그인 계정별 비공개 Firestore 문서**에 저장한다.
 *
 * 동작
 *   1) 로그인 직후 원격을 읽어 **키별 타임스탬프가 더 최신인 쪽**을 채택(원격이 새로우면 로컬에 반영)
 *   2) 이후 localStorage.setItem을 가로채 변경분만 디바운스 업로드
 *   3) 실패는 조용히 넘기지 않고 개발일지 탭 상태줄에 노출(보안 규칙 미설정 등을 바로 알 수 있게)
 *
 * ⚠키마다 문서를 나눈다(marketApp/{uid}/keys/{키}) — 한 문서에 몰면 1MB 상한에 걸리고,
 *   관심종목 하나 바꿔도 포트폴리오까지 다시 쓰게 된다.
 */
(() => {
  const KEYS = ["cp_watch_v1", "cp_devlog_v1", "cp_memo_v1", "cp_journal_v1",
                "cp_portfolio_v2", "cp_portfolio_v1", "cp_toss_v1", "cp_pf_hist_v1", "cp_draw_v1"];
  const META = "cp_sync_meta_v1";      // {키: 로컬 최종수정 ms}
  const COL = "marketApp";             // To-Do의 boards/backups와 분리된 컬렉션
  const RELOAD_FLAG = "cp_sync_reloaded";
  const DEBOUNCE = 1200;
  const MAX_BYTES = 900_000;           // Firestore 문서 1MB 상한 여유

  const state = { on: false, uid: null, db: null, applying: false, timers: {}, last: null, err: null };
  window.__cpSync = state;

  const metaLoad = () => { try { return JSON.parse(localStorage.getItem(META)) || {}; } catch (e) { return {}; } };
  const metaSave = (m) => localStorage.setItem(META, JSON.stringify(m));

  function setStatus(msg, kind) {
    state.msg = msg; state.kind = kind || "";
    window.dispatchEvent(new CustomEvent("cpsync", { detail: { msg, kind } }));
  }

  /* localStorage.setItem 가로채기 — 저장 함수가 곳곳에 흩어져 있어 여기 한 곳만 잡으면 전부 걸린다 */
  const rawSet = localStorage.setItem.bind(localStorage);
  const rawRemove = localStorage.removeItem.bind(localStorage);
  const touch = (k) => {
    if (!KEYS.includes(k) || state.applying) return;   // 원격 반영 중 발생한 쓰기는 되돌려 올리지 않는다
    const m = metaLoad(); m[k] = Date.now(); metaSave(m);
    if (state.on) schedulePush(k);
  };
  localStorage.setItem = function (k, v) { rawSet(k, v); touch(k); };
  localStorage.removeItem = function (k) { rawRemove(k); touch(k); };

  function schedulePush(k) {
    clearTimeout(state.timers[k]);
    state.timers[k] = setTimeout(() => pushKey(k), DEBOUNCE);
  }

  async function pushKey(k) {
    if (!state.on) return;
    const v = localStorage.getItem(k);
    const ts = metaLoad()[k] || Date.now();
    try {
      const ref = state.db.collection(COL).doc(state.uid).collection("keys").doc(k);
      if (v == null) { await ref.delete(); }
      else {
        if (v.length > MAX_BYTES) { setStatus(`⚠ ${k}가 너무 커서(${Math.round(v.length / 1024)}KB) 동기화에서 제외됐습니다`, "warn"); return; }
        await ref.set({ v, ts });
      }
      state.last = new Date(); state.err = null;
      setStatus(`동기화됨 · ${state.last.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`, "ok");
    } catch (e) {
      state.err = e;
      setStatus(`⚠ 업로드 실패: ${e.message || e}`, "err");
    }
  }

  async function pullAll() {
    const snap = await state.db.collection(COL).doc(state.uid).collection("keys").get();
    const remote = {};
    snap.forEach((d) => (remote[d.id] = d.data()));
    const m = metaLoad();
    let applied = 0, pushed = 0;
    for (const k of KEYS) {
      const r = remote[k];
      const localV = localStorage.getItem(k);
      const localTs = m[k] || 0;
      if (r && (r.ts || 0) > localTs) {
        // 원격이 더 최신 → 로컬에 반영(이때의 setItem은 다시 업로드하지 않도록 applying으로 차단)
        state.applying = true;
        if (r.v == null) rawRemove(k); else rawSet(k, r.v);
        state.applying = false;
        m[k] = r.ts; applied++;
      } else if (localV != null && localTs > (r?.ts || 0)) {
        pushed++; pushKey(k);
      } else if (localV != null && !r) {
        // 최초 업로드(메타가 없던 기존 사용자) — 로컬을 원본으로 삼는다
        m[k] = m[k] || Date.now(); metaSave(m);
        pushed++; pushKey(k);
      }
    }
    metaSave(m);
    return { applied, pushed };
  }

  const loadScript = (src) => new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });

  async function start(uid) {
    try {
      if (!firebase.firestore) {
        await loadScript("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js");
      }
      state.db = firebase.firestore();
      state.uid = uid;
      state.on = true;
      setStatus("동기화 확인 중…", "");
      const { applied, pushed } = await pullAll();
      state.last = new Date();
      if (applied && !sessionStorage.getItem(RELOAD_FLAG)) {
        // 원격 데이터를 새로 받았으면 화면을 다시 그려야 한다. 렌더러마다 캐시가 있어
        // 부분 갱신보다 새로고침이 확실하다(세션당 1회로 제한해 무한 새로고침 방지).
        sessionStorage.setItem(RELOAD_FLAG, "1");
        setStatus(`다른 기기 데이터 ${applied}건 받음 — 새로고침합니다`, "ok");
        setTimeout(() => location.reload(), 300);
        return;
      }
      setStatus(`동기화 켜짐 · 받음 ${applied} · 보냄 ${pushed}`, "ok");
    } catch (e) {
      state.on = false; state.err = e;
      setStatus(`⚠ 동기화 불가: ${e.message || e}`, "err");
    }
  }

  // auth.js가 로그인 성공 시 authuser 이벤트를 쏜다 → 그때 uid로 시작
  window.addEventListener("authuser", () => {
    const u = window.firebase?.auth?.().currentUser;
    if (u?.uid) start(u.uid);
  });
  // 이미 로그인된 상태로 늦게 로드된 경우 대비
  setTimeout(() => {
    if (state.on) return;
    const u = window.firebase?.auth?.().currentUser;
    if (u?.uid) start(u.uid);
    else if (["localhost", "127.0.0.1"].includes(location.hostname)) {
      setStatus("로컬 미리보기 — 로그인이 없어 동기화 비활성(배포 사이트에서 동작)", "");
    }
  }, 2500);
})();

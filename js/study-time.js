// 쉐도잉 공부 시간 재기 — 피드백 · 교재 · 영상 쉐도잉별로 하루 공부한 시간을 서버(/api/member-study-time)에 모아요.
// StudyTime.start({ getKind, getToken, onChange })
// getKind(): 지금 연습 중인 쉐도잉 종류 'feedback' | 'book' | 'video' (연습 중이 아니면 null)
// getToken(): 회원 토큰 (없으면 재지 않아요)
// onChange(times, month): 공부한 시간이 바뀔 때마다 오늘 · 이번 달 누적 { feedback, book, video } (초)
// 화면을 보고 있을 때만 5초마다 재고, 1분마다(그리고 화면을 떠날 때) 서버에 보내요.
(function (global) {
  const ENDPOINT = '/api/member-study-time';
  const KINDS = ['feedback', 'book', 'video'];
  let opts = null, server = { feedback: 0, book: 0, video: 0 }, serverMonth = { feedback: 0, book: 0, video: 0 }, pending = { feedback: 0, book: 0, video: 0 };
  let lastTick = Date.now(), sending = false, started = false;

  const totals = () => Object.fromEntries(KINDS.map(k => [k, Math.floor((server[k] || 0) + pending[k])]));
  const monthTotals = () => Object.fromEntries(KINDS.map(k => [k, Math.floor((serverMonth[k] || 0) + pending[k])]));
  const notify = () => { try { opts && opts.onChange && opts.onChange(totals(), monthTotals()); } catch (e) {} };
  const take = d => { server = d.times || server; serverMonth = d.month || serverMonth; };
  const headers = () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + opts.getToken() });

  async function load() {
    if (!opts.getToken()) return;
    try {
      const r = await fetch(ENDPOINT, { headers: headers() });
      if (r.ok) { take(await r.json()); notify(); }
    } catch (e) {}
  }
  async function flush(keepalive) {
    const add = {}; let any = false;
    KINDS.forEach(k => { const n = Math.floor(pending[k]); if (n > 0) { add[k] = n; any = true; } });
    if (!any || sending || !opts.getToken()) return;
    sending = true;
    KINDS.forEach(k => { pending[k] -= add[k] || 0; }); // 보내는 동안 더 잰 시간은 그대로 남겨요
    try {
      const r = await fetch(ENDPOINT, { method: 'POST', headers: headers(), body: JSON.stringify({ add }), keepalive: !!keepalive });
      if (r.ok) take(await r.json());
      else KINDS.forEach(k => { pending[k] += add[k] || 0; }); // 실패하면 다음에 다시
    } catch (e) { KINDS.forEach(k => { pending[k] += add[k] || 0; }); }
    sending = false; notify();
  }
  function tick() {
    const now = Date.now(), dt = Math.min(10, (now - lastTick) / 1000); // 컴퓨터가 잠들었다 깨어나도 한 번에 10초까지만
    lastTick = now;
    if (document.visibilityState !== 'visible' || !opts.getToken()) return;
    let kind = null; try { kind = opts.getKind(); } catch (e) {}
    if (!KINDS.includes(kind)) return;
    pending[kind] += dt; notify();
  }
  function start(o) {
    if (started) return; started = true; opts = o;
    notify(); // 서버 답을 기다리지 않고 바로 0초부터 보여줘요
    load();
    setInterval(tick, 5000);
    setInterval(() => flush(false), 60000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); else lastTick = Date.now(); });
    global.addEventListener('pagehide', () => flush(true));
  }
  // 공부 시간 글자: 40초 / 12분 / 1시간 5분
  function format(sec) {
    sec = Math.floor(sec || 0);
    if (sec < 60) return `${sec}초`;
    const m = Math.floor(sec / 60), h = Math.floor(m / 60);
    return h ? `${h}시간${m % 60 ? ' ' + (m % 60) + '분' : ''}` : `${m}분`;
  }
  global.StudyTime = { start, flush, reload: load, totals, monthTotals, format };
})(window);

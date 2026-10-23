/* 공부 시간 기록 + 표시 (member.html · video.html 공용)
 *   StudyTime.track('feedback' | 'video', () => 지금 공부 중인지)
 *     - 1초마다 확인해서, 화면이 보이고 공부 중이면 1초씩 쌓아 30초마다 서버(/api/member-time)에 보내요.
 *     - 공부 중 = 연습이 돌아가거나 영상이 재생 중이거나, 최근 60초 안에 화면을 누른 경우 (페이지가 판단해서 알려줌)
 *   StudyTime.load()        : 서버에서 오늘 · 이번 달 · 지금까지 횟수 가져오기
 *   StudyTime.barHtml()     : "⏱ 오늘 쉐도잉한 시간" 막대
 *   StudyTime.goalHtml()    : "듣기 1000번, 따라 말하기 1000번" 목표 배너
 *   StudyTime.onChange(fn)  : 시간이 바뀔 때마다 다시 그리기
 */
(function (root) {
  const TOKEN = 'shadowing_member_token';
  const token = () => { try { return localStorage.getItem(TOKEN); } catch (e) { return null; } };
  const CAT_LABEL = { feedback: '피드백', book: '교재', video: '영상' };
  let cat = null, isActive = null, pending = 0, lastAct = 0, base = null;
  const local = { feedback: 0, book: 0, video: 0 };
  const listeners = [];

  function fmt(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    if (sec < 60) return sec + '초';
    const m = Math.floor(sec / 60);
    if (m < 60) return m + '분';
    return Math.floor(m / 60) + '시간' + (m % 60 ? ' ' + (m % 60) + '분' : '');
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(ev => document.addEventListener(ev, () => { lastAct = Date.now(); }, { passive: true, capture: true }));
  const recent = (ms = 60000) => Date.now() - lastAct < ms;

  function emit() { listeners.forEach(fn => { try { fn(); } catch (e) {} }); }

  setInterval(() => {
    if (!cat || !token() || document.visibilityState !== 'visible') return;
    let on = false; try { on = !!(isActive && isActive()); } catch (e) {}
    if (!on) return;
    pending++; local[cat]++;
    if (local[cat] % 5 === 0 || local[cat] < 5) emit();
    if (pending >= 30) flush();
  }, 1000);

  function flush(keepalive) {
    if (!pending || !cat || !token()) return;
    const sec = pending; pending = 0;
    fetch('/api/member-time', {
      method: 'POST', keepalive: !!keepalive,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
      body: JSON.stringify({ cat, sec }),
    }).then(r => { if (!r.ok && r.status >= 500) pending += sec; }).catch(() => { pending += sec; });
  }
  window.addEventListener('pagehide', () => flush(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });

  async function load() {
    if (!token()) return null;
    try {
      const r = await fetch('/api/member-time', { headers: { Authorization: 'Bearer ' + token() } });
      if (!r.ok) return null;
      base = await r.json();
      local.feedback = 0; local.book = 0; local.video = 0; // 서버 값에 이미 들어간 만큼은 다시 세지 않게 (보내지 않은 pending만 남김)
      if (cat) local[cat] = pending;
      emit();
      return base;
    } catch (e) { return null; }
  }

  const today = c => ((base && base.today && base.today[c]) || 0) + (local[c] || 0);
  const month = c => ((base && base.month && base.month[c]) || 0) + (local[c] || 0);

  function barHtml() {
    const t = today('feedback') + today('book') + today('video');
    return `<div class="st-bar">⏱ 오늘 쉐도잉한 시간 <b>${fmt(t)}</b> <span>피드백 ${fmt(today('feedback'))} · 📖 교재 ${fmt(today('book'))} · 🎬 영상 ${fmt(today('video'))}</span>`
      + (base ? ` <span class="st-month">· 📅 이번 달 ${fmt(month('feedback') + month('book') + month('video'))}</span>` : '') + `</div>`;
  }

  // 듣기 · 따라 말하기 1000번 목표 (1000번을 넘으면 다음 목표 2000번 …)
  function goalHtml() {
    const tot = (base && base.totals) || { listen: 0, speak: 0 };
    const goal = n => Math.max(1000, Math.ceil((n + 1) / 1000) * 1000);
    const gl = goal(tot.listen), gs = goal(tot.speak);
    const pl = tot.listen / gl, ps = tot.speak / gs, p = Math.min(pl, ps);
    const done = gl > 1000 || gs > 1000;
    const msg = p >= 0.85 ? '🚀 거의 다 왔어요! 지금 멈추면 아까워요. 끝까지 가요!'
      : p >= 0.5 ? '💪 절반을 넘었어요! 매일 조금씩, 입이 점점 열리고 있어요.'
      : p >= 0.15 ? '👍 좋아요! 꾸준히 하는 사람이 결국 말이 트여요.'
      : '🌱 오늘 한 문장부터 시작해요. 시작이 반이에요!';
    const row = (icon, label, n, g) => `<div class="st-g-row"><span class="st-g-l">${icon} ${label}</span><span class="st-g-track"><i style="width:${Math.min(100, n / g * 100).toFixed(1)}%"></i></span><span class="st-g-n">${n.toLocaleString()} / ${g.toLocaleString()}</span></div>`;
    return `<div class="st-goal">
      <div class="st-g-head">🎧 듣기 <b>${gl.toLocaleString()}번</b>, 🗣️ 따라 말하기 <b>${gs.toLocaleString()}번</b>.<br>그래야 <span class="st-g-pill">0.1초</span> 만에 입이 열린다.</div>
      <div class="st-g-cta">${done ? '🏆 목표 달성! 다음 단계로' : '🔥 멈추지 마!'}</div>
      <div class="st-g-box">${row('🎧', '듣기', tot.listen, gl)}${row('🗣️', '따라 말하기', tot.speak, gs)}<div class="st-g-msg">${esc(msg)}</div></div>
    </div>`;
  }

  // 화면 꾸밈 (한 번만)
  const css = document.createElement('style');
  css.textContent = `
  .st-bar{display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:4px 8px; padding:9px 14px; border-radius:12px; background:#D7F5DC; border:1px solid #9FDBA9; color:#14532D; font-size:0.9rem; font-weight:700;}
  .st-bar b{font-size:1rem;} .st-bar span{font-weight:600; color:#1F6B3A; font-size:0.84rem;}
  .st-goal{position:relative; overflow:hidden; border-radius:18px; padding:20px 20px 16px; color:#fff; background:linear-gradient(135deg,#FF6B6B 0%,#FF8E53 55%,#FFB547 100%); box-shadow:0 12px 28px rgba(255,107,107,0.28); margin-bottom:16px;}
  .st-g-head{font-size:1.22rem; font-weight:900; line-height:1.5; letter-spacing:-0.01em;}
  .st-g-head b{color:#FFF6C9;}
  .st-g-pill{display:inline-block; background:#fff; color:#E8533F; padding:0 8px; border-radius:8px;}
  .st-g-cta{display:inline-block; margin:12px 0 12px; padding:8px 16px; border-radius:12px; background:#1B2A4E; font-weight:900; font-size:1.05rem;}
  .st-g-box{background:rgba(255,255,255,0.92); border-radius:14px; padding:12px 14px; color:#1B2A4E;}
  .st-g-row{display:grid; grid-template-columns:110px 1fr auto; align-items:center; gap:10px; margin:4px 0; font-size:0.86rem; font-weight:700;}
  .st-g-track{height:10px; border-radius:6px; background:#FFE1D6; overflow:hidden;}
  .st-g-track i{display:block; height:100%; border-radius:6px; background:linear-gradient(90deg,#FF6B6B,#FF8E53);}
  .st-g-n{font-variant-numeric:tabular-nums; color:#5B6478; font-size:0.8rem;}
  .st-g-msg{margin-top:6px; font-size:0.84rem; font-weight:800; color:#D9480F;}
  @media (max-width:520px){ .st-g-head{font-size:1.05rem;} .st-g-row{grid-template-columns:92px 1fr; } .st-g-n{grid-column:2; justify-self:end; margin-top:-2px;} }`;
  document.head.appendChild(css);

  root.StudyTime = {
    // 종류를 바꾸면(피드백 → 교재) 그때까지 센 시간은 원래 종류로 먼저 보내요
    track(c, fn) { if (cat && cat !== c && pending) flush(); cat = c; if (fn) isActive = fn; },
    get cat() { return cat; },
    recent, load, fmt, today, month, barHtml, goalHtml, flush,
    onChange(fn) { listeners.push(fn); },
    get data() { return base; },
  };
})(window);

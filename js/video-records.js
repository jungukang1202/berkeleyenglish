/* 관리자 — 🎞️ 영상쉐도잉 기록 · 학생별 영상 넣어주기 (admin.html의 apiFetch · membersCache를 씀) */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = sec => {
    sec = Math.round(sec || 0);
    if (sec < 60) return sec + '초';
    const m = Math.floor(sec / 60);
    return m < 60 ? m + '분' : Math.floor(m / 60) + '시간' + (m % 60 ? ' ' + (m % 60) + '분' : '');
  };
  const VIS = { draft: '🔒 비공개', members: '👥 모든 회원', public: '🌐 전체 공개', assigned: '🎯 선택한 학생만' };
  const members = () => { try { return membersCache || []; } catch (e) { return []; } };

  window.fillVrecUsers = () => {
    const sel = $('vrecUser'); if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">-- 회원을 선택하세요 --</option>'
      + members().map(m => `<option value="${esc(m.username)}">${esc(m.username)}${m.name ? ' (' + esc(m.name) + ')' : ''}</option>`).join('');
    if (cur) sel.value = cur;
  };

  async function load() {
    const user = $('vrecUser').value, st = $('vrecStatus'), view = $('vrecView');
    if (!user) { view.innerHTML = ''; st.textContent = ''; return; }
    st.textContent = '불러오는 중…'; st.className = 'status';
    try {
      const d = await apiFetch('/api/admin-video-records?user=' + encodeURIComponent(user));
      st.textContent = '';
      const t = d.time;
      const days = Object.entries(t.days || {}).sort((a, b) => a[0].localeCompare(b[0]));
      const maxV = Math.max(60, ...days.map(([, r]) => r.video || 0));
      const studied = d.videos.filter(v => v.lastAt || v.done);
      view.innerHTML = `
        <div class="vr-tiles">
          <div class="vr-tile"><div class="k">🎬 오늘 영상 쉐도잉</div><div class="v">${fmt(t.today.video)}</div><div class="s">피드백 ${fmt(t.today.feedback)}</div></div>
          <div class="vr-tile"><div class="k">📅 이번 달 영상</div><div class="v">${fmt(t.month.video)}</div><div class="s">피드백 ${fmt(t.month.feedback)}</div></div>
          <div class="vr-tile"><div class="k">🗓️ 최근 7일 영상</div><div class="v">${fmt(t.week.video)}</div><div class="s">하루 평균 ${fmt(t.week.video / 7)}</div></div>
          <div class="vr-tile"><div class="k">🎞️ 공부한 영상</div><div class="v">${studied.length}개</div><div class="s">볼 수 있는 영상 ${d.videos.filter(v => v.canSee).length}개</div></div>
          <div class="vr-tile"><div class="k">🎧 듣기 · 🗣️ 따라 말하기</div><div class="v">${d.totals.listen.toLocaleString()} · ${d.totals.speak.toLocaleString()}</div><div class="s">지금까지 (피드백 포함)</div></div>
        </div>
        <div class="card-desc" style="margin:0;">최근 7일 영상 쉐도잉 시간</div>
        <div class="vr-week">${days.map(([dt, r]) => `<div title="${dt} · ${fmt(r.video)}"><i style="height:${Math.round((r.video || 0) / maxV * 52) + 2}px"></i>${Number(dt.slice(8))}일</div>`).join('')}</div>
        ${d.videos.length ? `<div class="vr-wrap"><table class="vr-table">
          <thead><tr><th>영상</th><th>공개</th><th>공부한 문장</th><th>듣기</th><th>따라 말하기</th><th>평균 일치도</th><th>마지막 연습</th><th>🎯 넣어주기</th></tr></thead>
          <tbody>${d.videos.map(v => {
            const pct = v.sentenceCount ? Math.round(v.done / v.sentenceCount * 100) : 0;
            const canAssign = v.visibility === 'assigned' || v.visibility === 'draft';
            return `<tr class="${v.canSee ? '' : 'vr-dim'}">
              <td class="t">${v.level ? `<span class="lv-badge">Lv ${esc(v.level)}</span>` : ''}${esc(v.title)}</td>
              <td class="num">${VIS[v.visibility] || ''}</td>
              <td class="num">${v.done} / ${v.sentenceCount} (${pct}%)<div class="vr-bar"><i style="width:${pct}%"></i></div></td>
              <td class="num">${v.listen}</td>
              <td class="num">${v.spoke + v.failed}${v.failed ? ` <span style="color:var(--muted)">(인식 실패 ${v.failed})</span>` : ''}</td>
              <td class="num">${v.avg == null ? '-' : v.avg + '%'}</td>
              <td class="num">${v.lastAt ? new Date(v.lastAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : '-'}</td>
              <td class="num">${canAssign
                ? `<label style="display:flex; gap:6px; align-items:center; cursor:pointer;"><input type="checkbox" data-assign="${esc(v.id)}" ${v.assigned ? 'checked' : ''}> ${v.assigned ? '넣어줌' : '넣어주기'}</label>`
                : '<span style="color:var(--muted)">이미 보임</span>'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>` : '<div class="empty">아직 만든 영상 쉐도잉이 없어요.</div>'}`;
    } catch (e) { st.textContent = '⚠️ ' + e.message; st.className = 'status error'; }
  }

  document.addEventListener('DOMContentLoaded', () => {});
  $('vrecUser').addEventListener('change', load);
  $('vrecView').addEventListener('change', async e => {
    const cb = e.target.closest('[data-assign]'); if (!cb) return;
    cb.disabled = true;
    try {
      await apiFetch('/api/admin-video-records', { method: 'POST', body: JSON.stringify({ user: $('vrecUser').value, id: cb.dataset.assign, assign: cb.checked }) });
      await load();
      const r = $('vidRefresh'); if (r) r.click(); // 영상 목록의 공개 범위 표시도 새로
    } catch (err) { alert(err.message); cb.checked = !cb.checked; cb.disabled = false; }
  });
  window.addEventListener('admintab', e => { if (e.detail === 'vrec') { window.fillVrecUsers(); if ($('vrecUser').value) load(); } });
})();

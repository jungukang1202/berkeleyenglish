/* 관리자 — 📱 학원 휴대폰으로 문자 보내기 (admin.html 「👤 회원 관리」 아래 칸, 운영자 지시 2026-11-28)
 *  - 학원 안드로이드 휴대폰의 「SMS Gateway」 앱이 진짜 문자로 보내요(학원 휴대폰 번호로 감)
 *  - 학생 전화번호 · 받기 켜고 끄기 / 매일 공부 안내 문자(시각 · 요일 · 문구) / 시험 문자 / 지금 보내기 / 보낸 기록
 * admin.html의 apiFetch · membersCache · memberLabel · getToken 을 써요.
 */
(function () {
  const API = '/api/admin-sms';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const members = () => { try { return (membersCache || []).slice(); } catch (e) { return []; } };
  const md = d => d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '';
  const pretty = e => { const d = String(e || '').replace(/^\+82/, '0'); return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : d; };
  const KIND = { daily: '⏰ 자동', manual: '▶️ 지금 보내기', test: '🧪 시험', done: '🔔 과제 완료' };
  const STATE = { Pending: '⏳ 기다리는 중', Processed: '📤 휴대폰이 받음', Sent: '✅ 보냄', Delivered: '✅ 받음', Failed: '⚠️ 실패' };
  const status = (el, msg, kind) => { el.textContent = msg; el.className = 'status' + (kind ? ' ' + kind : ''); };
  let data = null;

  const card = $('smsCard'); if (!card) return;
  card.innerHTML = `
    <h2>📱 공부 안내 문자</h2>
    <div class="card-desc">학원 휴대폰(안드로이드)의 <b>SMS Gateway</b> 앱이 학생에게 <b>진짜 문자</b>를 보내요. 학생 휴대폰은 아이폰·갤럭시 모두 받아요.
      학원 휴대폰은 <b>켜 두고 인터넷에 연결</b>해 두세요(충전기에 꽂아 두면 좋아요).</div>
    <div id="smsState" style="margin:8px 0; font-weight:700;"></div>

    <h3 class="sub-h">📇 학생 전화번호</h3>
    <div class="card-desc" style="margin-top:0;">번호를 넣고 「받기」를 켠 학생에게만 자동 문자가 가요. 학부모 번호를 넣어도 돼요.</div>
    <div id="smsPhones" style="display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:6px; margin:8px 0;"></div>
    <div class="row"><button class="btn-ghost btn-small" id="smsSavePhones">💾 전화번호 저장</button><span class="status" id="smsPhonesStatus" style="margin:0;"></span></div>

    <h3 class="sub-h">⏰ 매일 공부 안내 문자</h3>
    <div class="row" style="align-items:center; gap:10px; flex-wrap:wrap;">
      <label style="display:flex; gap:6px; align-items:center; font-weight:700;"><input type="checkbox" id="smsDailyOn"> 자동으로 보내기</label>
      <select id="smsDailyHour" style="width:auto;"></select>
      <select id="smsDailyDays" style="width:auto;"><option value="all">매일</option><option value="mon-sat">월~토</option><option value="weekdays">평일(월~금)</option></select>
      <span style="color:var(--muted); font-size:0.85rem;">최근 7일 안에 수업이 있었는데 그 수업 피드백쉐도잉을 아직 안 한 학생에게만, 하루 한 번 (수업이 없었으면 안 보내요)</span>
    </div>
    <div class="field" style="margin:6px 0;"><textarea id="smsDailyText" rows="2" maxlength="300"></textarea>
      <div style="color:var(--muted); font-size:0.8rem; margin-top:4px;"><code>#{이름}</code> 자리에 학생 이름, <code>#{수업날짜}</code> 자리에 아직 복습 안 한 수업 날짜(예: 11/27)가 들어가요. <span id="smsLen"></span></div></div>
    <div class="row" style="gap:8px; flex-wrap:wrap;">
      <button class="btn-ghost btn-small" id="smsSaveSettings">💾 자동 문자 저장</button>
      <button class="btn-ghost btn-small" id="smsPreview">👀 지금 보내면 받을 학생 보기</button>
      <button class="btn-ghost btn-small" id="smsSendNow">▶️ 복습 안 한 학생에게 지금 보내기</button>
      <span class="status" id="smsSettingsStatus" style="margin:0;"></span>
    </div>
    <div id="smsPreviewBox" style="margin:6px 0;"></div>

    <h3 class="sub-h">🔔 과제 완료 알림 (원장님 휴대폰으로)</h3>
    <div class="row" style="align-items:center; gap:10px; flex-wrap:wrap;">
      <label style="display:flex; gap:6px; align-items:center; font-weight:700;"><input type="checkbox" id="smsNotifyOn"> 학생이 과제를 하면 알려 주기</label>
      <input type="tel" id="smsNotifyPhone" placeholder="원장님 번호 (예: 010-1234-5678)" style="width:220px;">
      <button class="btn-ghost btn-small" id="smsSaveNotify">💾 저장</button>
      <span class="status" id="smsNotifyStatus" style="margin:0;"></span>
    </div>
    <div style="color:var(--muted); font-size:0.8rem; margin:4px 0 0;">최근 7일 안 수업의 피드백쉐도잉을 학생이 처음 연습하면 30분 안에 문자가 와요. 여러 명이면 한 통으로 묶어요. 밤(오후 10시~오전 9시)에 한 것은 아침 9시에 보내요.</div>

    <h3 class="sub-h">🧪 시험 문자</h3>
    <div class="row" style="gap:8px; align-items:center; flex-wrap:wrap;">
      <input type="tel" id="smsTestPhone" placeholder="받을 번호 (예: 010-1234-5678)" style="width:220px;">
      <button class="btn-primary btn-small" id="smsTestBtn">📱 시험 문자 보내기</button>
      <span class="status" id="smsTestStatus" style="margin:0;"></span>
    </div>

    <h3 class="sub-h">📜 보낸 문자</h3>
    <div id="smsLog" style="font-size:0.85rem;"></div>
    <div class="row"><button class="btn-ghost btn-small" id="smsRefresh">🔄 결과 새로 보기</button></div>`;

  $('smsDailyHour').innerHTML = Array.from({ length: 18 }, (_, k) => k + 6).map(h => `<option value="${h}">${h < 12 ? '오전' : '오후'} ${h <= 12 ? h : h - 12}시</option>`).join('');

  function renderState() {
    const s = data.status || {};
    let html;
    if (!s.configured) html = `<span style="color:#C62828;">⚠️ 아직 휴대폰과 연결되지 않았어요.</span> <span style="font-weight:400; color:var(--muted);">Netlify → 사이트 설정 → 환경 변수에 <code>SMSGATE_USER</code> · <code>SMSGATE_PASS</code>(앱의 Username · Password)를 넣고 다시 배포해 주세요.</span>`;
    else if (!s.ok) html = `<span style="color:#C62828;">⚠️ ${esc(s.error || '휴대폰 연결을 확인하지 못했어요.')}</span>`;
    else {
      const seen = s.device && s.device.lastSeen ? new Date(s.device.lastSeen) : null;
      const mins = seen ? Math.round((Date.now() - seen) / 60000) : null;
      const fresh = mins != null && mins < 60;
      html = `<span style="color:${fresh ? '#2E7D32' : '#E65100'};">${fresh ? '✅' : '⚠️'} 학원 휴대폰 연결됨${s.device && s.device.name ? ' (' + esc(s.device.name) + ')' : ''}</span>
        <span style="font-weight:400; color:var(--muted);">· 마지막 신호 ${seen ? (mins < 1 ? '방금' : mins < 60 ? mins + '분 전' : seen.toLocaleString('ko-KR')) : '없음'}${fresh ? '' : ' — 휴대폰이 꺼져 있거나 앱이 멈췄을 수 있어요'}${s.encrypted ? ' · 🔒 암호화' : ''}</span>`;
    }
    $('smsState').innerHTML = html;
  }
  function renderPhones() {
    const phones = data.phones || {};
    const list = [...new Set(members().map(m => m.username).concat(Object.keys(phones)))].sort();
    const nameOf = u => { const m = members().find(x => x.username === u); return m && m.name ? m.name : ''; };
    $('smsPhones').innerHTML = list.map(u => {
      const p = phones[u] || {};
      return `<div style="display:flex; gap:6px; align-items:center; padding:6px 8px; border:1px solid #e3e3e3; border-radius:10px;">
        <span style="flex:1; font-weight:700; font-size:0.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(u)}">${esc(u)}${nameOf(u) ? ` <span style="font-weight:400; color:var(--muted);">${esc(nameOf(u))}</span>` : ''}</span>
        <input type="tel" data-u="${esc(u)}" class="smsPhone" value="${esc(pretty(p.phone))}" placeholder="010-0000-0000" style="width:130px; margin:0; padding:6px 8px;">
        <label style="display:flex; gap:3px; align-items:center; font-size:0.8rem;" title="자동 문자 받기"><input type="checkbox" class="smsOn" data-u="${esc(u)}" ${p.phone && p.on === false ? '' : 'checked'}> 받기</label></div>`;
    }).join('') || '<div class="empty">등록된 회원이 없어요.</div>';
  }
  function renderSettings() {
    const d = data.settings.daily;
    $('smsDailyOn').checked = !!d.on; $('smsDailyHour').value = String(d.hour); $('smsDailyDays').value = d.days || 'all'; $('smsDailyText').value = d.text;
    updateLen();
    const n = data.settings.notify || {};
    $('smsNotifyOn').checked = !!n.on; $('smsNotifyPhone').value = pretty(n.phone || '');
  }
  function updateLen() {
    const t = $('smsDailyText').value.replace(/#\{이름\}/g, '홍길동').replace(/#\{수업날짜\}/g, '11/27');
    const n = [...t].length;
    $('smsLen').textContent = `지금 ${n}자 ${n > 70 ? '— 70자가 넘으면 긴 문자(여러 통)로 가요' : ''}`;
  }
  function renderLog() {
    const log = data.log || [];
    const label = u => { try { return memberLabel(u); } catch (e) { return u; } };
    $('smsLog').innerHTML = log.length ? `<table><thead><tr><th>보낸 때</th><th>종류</th><th>받는 사람</th><th>내용</th><th>결과</th></tr></thead><tbody>${log.slice(0, 40).map(x => `
      <tr><td style="white-space:nowrap;">${esc(new Date(x.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</td>
      <td style="white-space:nowrap;">${esc(KIND[x.kind] || x.kind)}</td>
      <td style="white-space:nowrap;">${esc(x.to ? label(x.to) : '')}<br><span style="color:var(--muted);">${esc(pretty(x.phone))}</span></td>
      <td style="min-width:240px;">${esc(x.text)}</td>
      <td style="white-space:nowrap;" title="${esc(x.error || '')}">${esc(STATE[x.state] || x.state || '')}${x.error ? '<br><span style="color:#C62828; font-size:0.75rem;">' + esc(String(x.error).replace(/^sendSMS: Sending SMS message: /, '').slice(0, 80)) + '</span>' : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">아직 보낸 문자가 없어요.</div>';
  }
  async function load() {
    try {
      data = await apiFetch(API);
      renderState(); renderPhones(); renderSettings(); renderLog();
    } catch (e) { $('smsState').innerHTML = `<span style="color:#C62828;">⚠️ ${esc(e.message)}</span>`; }
  }

  $('smsDailyText').addEventListener('input', updateLen);
  $('smsSavePhones').onclick = async () => {
    const st = $('smsPhonesStatus'); status(st, '저장 중…');
    const phones = {};
    card.querySelectorAll('.smsPhone').forEach(i => { if (i.value.trim()) phones[i.dataset.u] = { phone: i.value.trim(), on: card.querySelector(`.smsOn[data-u="${CSS.escape(i.dataset.u)}"]`).checked }; });
    try { const r = await apiFetch(API, { method: 'POST', body: JSON.stringify({ action: 'phones', phones }) }); data.phones = r.phones; renderPhones(); status(st, `✅ ${Object.keys(r.phones).length}명 저장했어요`, 'success'); }
    catch (e) { status(st, '⚠️ ' + e.message, 'error'); }
  };
  $('smsSaveSettings').onclick = async () => {
    const st = $('smsSettingsStatus'); status(st, '저장 중…');
    try {
      const r = await apiFetch(API, { method: 'POST', body: JSON.stringify({ action: 'settings', daily: { on: $('smsDailyOn').checked, hour: Number($('smsDailyHour').value), days: $('smsDailyDays').value, text: $('smsDailyText').value } }) });
      data.settings = r.settings; renderSettings();
      status(st, r.settings.daily.on ? `✅ 저장했어요 — ${$('smsDailyHour').selectedOptions[0].textContent}에 자동으로 보내요` : '✅ 저장했어요 (자동 문자 꺼짐)', 'success');
    } catch (e) { status(st, '⚠️ ' + e.message, 'error'); }
  };
  async function preview() {
    const r = await apiFetch(API, { method: 'POST', body: JSON.stringify({ action: 'preview' }) });
    const t = r.targets || [], go = t.filter(x => x.send);
    const label = u => { try { return memberLabel(u); } catch (e) { return u; } };
    $('smsPreviewBox').innerHTML = !t.length ? '<div class="empty">번호를 넣고 「받기」를 켠 학생이 아직 없어요.</div>' : `
      <div style="font-size:0.85rem; margin-bottom:4px;"><b>${go.length}명</b>에게 보내요 (번호 넣은 학생 ${t.length}명 중)</div>
      <table><thead><tr><th>학생</th><th>최근 수업 · 복습</th><th>문자</th></tr></thead><tbody>${t.map(x => `
        <tr><td style="white-space:nowrap;">${esc(label(x.username))}</td>
        <td style="white-space:nowrap;">${!x.lesson ? '— 최근 7일 수업 없음' : x.todo ? '❌ ' + esc(md(x.todo.date)) + ' 수업 복습 안 함' + (x.todoCount > 1 ? ` (${x.todoCount}회차)` : '') : '✅ ' + esc(md(x.lesson.date)) + ' 수업 복습함'}${x.already ? ' · 오늘 이미 보냄' : ''}</td>
        <td>${x.send ? esc(x.text) : '<span style="color:var(--muted);">안 보내요</span>'}</td></tr>`).join('')}</tbody></table>`;
    return go.length;
  }
  $('smsPreview').onclick = async () => { const st = $('smsSettingsStatus'); status(st, '확인 중…'); try { await preview(); status(st, ''); } catch (e) { status(st, '⚠️ ' + e.message, 'error'); } };
  $('smsSendNow').onclick = async () => {
    const st = $('smsSettingsStatus'), b = $('smsSendNow');
    try {
      status(st, '확인 중…');
      const n = await preview();
      if (!n) { status(st, '지금 보낼 학생이 없어요 (최근 수업을 모두 복습했거나, 수업이 없었거나, 오늘 이미 보냈어요).'); return; }
      if (!confirm(`수업 피드백쉐도잉을 아직 안 한 ${n}명에게 지금 문자를 보낼까요?\n(아래 표의 내용 그대로 학원 휴대폰 번호로 가요)`)) { status(st, ''); return; }
      b.disabled = true; status(st, '보내는 중…');
      const r = await apiFetch(API, { method: 'POST', body: JSON.stringify({ action: 'send-now' }) });
      status(st, `✅ ${r.ok}명에게 보냈어요${r.fail.length ? ` · ⚠️ ${r.fail.length}명 실패` : ''}`, r.fail.length ? 'error' : 'success');
      load(); preview().catch(() => {});
    } catch (e) { status(st, '⚠️ ' + e.message, 'error'); }
    b.disabled = false;
  };
  $('smsSaveNotify').onclick = async () => {
    const st = $('smsNotifyStatus'); status(st, '저장 중…');
    try {
      const r = await apiFetch(API, { method: 'POST', body: JSON.stringify({ action: 'settings', notify: { on: $('smsNotifyOn').checked, phone: $('smsNotifyPhone').value } }) });
      data.settings = r.settings; renderSettings();
      status(st, r.settings.notify.on ? '✅ 저장했어요 — 과제를 하면 알려 드려요' : '✅ 저장했어요 (알림 꺼짐)', 'success');
    } catch (e) { status(st, '⚠️ ' + e.message, 'error'); }
  };
  $('smsTestBtn').onclick = async () => {
    const st = $('smsTestStatus'), b = $('smsTestBtn');
    if (!$('smsTestPhone').value.trim()) { status(st, '⚠️ 받을 번호를 넣어 주세요.', 'error'); return; }
    b.disabled = true; status(st, '보내는 중…');
    try {
      const r = await apiFetch(API, { method: 'POST', body: JSON.stringify({ action: 'test', phone: $('smsTestPhone').value }) });
      status(st, r.ok ? '✅ 학원 휴대폰에 보내라고 했어요. 1분 안에 오는지 확인해 주세요.' : '⚠️ ' + ((r.fail[0] && r.fail[0].error) || '보내지 못했어요'), r.ok ? 'success' : 'error');
      load(); setTimeout(() => $('smsRefresh').click(), 20000);
    } catch (e) { status(st, '⚠️ ' + e.message, 'error'); }
    b.disabled = false;
  };
  $('smsRefresh').onclick = async () => {
    try { const r = await apiFetch(API, { method: 'POST', body: JSON.stringify({ action: 'refresh' }) }); data.log = r.log; renderLog(); } catch (e) {}
  };

  // 「👤 회원 관리」를 열 때마다 새로 불러와요
  document.addEventListener('click', e => { if (e.target.closest('#adminMenu [data-go="members"]')) setTimeout(load, 400); });
  window.addEventListener('hashchange', () => { if (location.hash === '#members') setTimeout(load, 400); });
  const first = () => { try { if (getToken() && (location.hash === '#members' || (!location.hash && localStorage.getItem('admin_view') === 'members'))) load(); } catch (e) {} };
  setTimeout(first, 1500);
})();

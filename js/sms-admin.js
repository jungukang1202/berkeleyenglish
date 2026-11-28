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
  const vs = (has, today, icon) => !has ? `${icon} 없음` : today ? `${icon} ✅` : `${icon} ❌`;
  const md = d => d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '';
  const pretty = e => { const d = String(e || '').replace(/^\+82/, '0'); return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : d; };
  const KIND = { daily: '⏰ 자동', manual: '▶️ 지금 보내기', test: '🧪 시험', done: '🔔 공부 알림' };
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
    <div class="card-desc" style="margin-top:0;"><b>학생 번호</b>: 「받기」를 켜면 공부 안내 문자가 가요. <b>학부모 번호(선택)</b>: 아이가 쉐도잉을 하면 학부모님께 알려 드려요(자기 아이 것만).</div>
    <div id="smsPhones" style="display:grid; grid-template-columns:repeat(auto-fill,minmax(440px,1fr)); gap:6px; margin:8px 0;"></div>
    <details style="margin:4px 0 8px;"><summary style="cursor:pointer; font-weight:700; font-size:0.85rem;">📋 여러 명 한꺼번에 넣기</summary>
      <div style="color:var(--muted); font-size:0.8rem; margin:4px 0;">한 줄에 한 명씩 「아이디 또는 이름 + 학생 번호 (+ 학부모 번호)」를 붙여 넣고 「칸에 채우기」 → 「💾 전화번호 저장」. 엑셀에서 두 칸을 복사해 붙여도 돼요.<br>예: <code>kim01 010-1234-5678</code> · <code>김철수 010-1111-2222 010-3333-4444</code>(학생 · 학부모) · <code>이영희 학부모 010-5555-6666</code></div>
      <textarea id="smsBulk" rows="4" style="width:100%;" placeholder="kim01 010-1234-5678&#10;이영희 010-2222-3333"></textarea>
      <div class="row"><button class="btn-ghost btn-small" id="smsBulkFill">⬇️ 칸에 채우기</button><span class="status" id="smsBulkStatus" style="margin:0;"></span></div>
    </details>
    <div class="row"><button class="btn-ghost btn-small" id="smsSavePhones">💾 전화번호 저장</button><span class="status" id="smsPhonesStatus" style="margin:0;"></span></div>

    <h3 class="sub-h">⏰ 매일 공부 안내 문자</h3>
    <div class="row" style="align-items:center; gap:10px; flex-wrap:wrap;">
      <label style="display:flex; gap:6px; align-items:center; font-weight:700;"><input type="checkbox" id="smsDailyOn"> 자동으로 보내기</label>
      <select id="smsDailyHour" style="width:auto;"></select>
      <select id="smsDailyDays" style="width:auto;"><option value="all">매일</option><option value="mon-sat">월~토</option><option value="weekdays">평일(월~금)</option></select>
      <span style="color:var(--muted); font-size:0.85rem;">하루 한 번 · 피드백을 안 했을 때만 보내요(최근 7일 수업이 없으면 안 보내요)</span>
    </div>
    <div style="font-size:0.85rem; margin:6px 0; line-height:1.7;">
      💬 <b>[필수]</b> 수업 피드백쉐도잉을 아직 안 했으면 → <b>꼭 하라고</b> 안내해요<br>
      <label style="display:inline-flex; gap:6px; align-items:center;"><input type="checkbox" id="smsRecVideo"> 🎬 <b>[선택]</b> 영상쉐도잉을 오늘 안 했으면 → 해 보라고 권장</label><br>
      <label style="display:inline-flex; gap:6px; align-items:center;"><input type="checkbox" id="smsRecLesson"> 🎥 <b>[선택]</b> 수업영상쉐도잉을 오늘 안 했으면 → 해 보라고 권장</label>
      <span style="color:var(--muted);">(피드백 안내 문자에 덧붙이기만 · 넣어 준 영상이 있는 학생만)</span>
    </div>
    <div class="field" style="margin:6px 0;"><textarea id="smsDailyText" rows="2" maxlength="300"></textarea>
      <div style="color:var(--muted); font-size:0.8rem; margin-top:4px;"><code>#{인사}</code> 인사말 · <code>#{안내}</code> 할 일(피드백 꼭 하기 · 영상 권장). 인사말과 안내는 날마다 표현이 바뀌어요. (학생 이름을 넣고 싶으면 <code>#{이름}</code>) <span id="smsLen"></span></div></div>
    <div class="row" style="gap:8px; flex-wrap:wrap;">
      <button class="btn-ghost btn-small" id="smsSaveSettings">💾 자동 문자 저장</button>
      <button class="btn-ghost btn-small" id="smsPreview">👀 지금 보내면 받을 학생 보기</button>
      <button class="btn-ghost btn-small" id="smsSendNow">▶️ 지금 보내기</button>
      <span class="status" id="smsSettingsStatus" style="margin:0;"></span>
    </div>
    <div id="smsPreviewBox" style="margin:6px 0;"></div>

    <h3 class="sub-h">🔔 공부 알림 (원장님 휴대폰으로)</h3>
    <div class="row" style="align-items:center; gap:10px; flex-wrap:wrap;">
      <label style="display:flex; gap:6px; align-items:center; font-weight:700;"><input type="checkbox" id="smsNotifyOn"> 학생이 쉐도잉을 하면 알려 주기</label>
      <input type="tel" id="smsNotifyPhone" placeholder="원장님 번호 (예: 010-1234-5678)" style="width:220px;">
      <label style="display:flex; gap:6px; align-items:center; font-weight:700;"><input type="checkbox" id="smsNotifyParents"> 👪 학부모 번호가 있으면 학부모님께도</label>
      <button class="btn-ghost btn-small" id="smsSaveNotify">💾 저장</button>
      <span class="status" id="smsNotifyStatus" style="margin:0;"></span>
    </div>
    <div style="color:var(--muted); font-size:0.8rem; margin:4px 0 0;">모든 학생이 💬 수업 피드백 · 📖 교재 · 🎬 영상 · 🎥 수업영상 쉐도잉을 하면 30분 안에 문자가 와요(같은 회차·교재 단원·영상은 하루 한 번). 여러 명이면 한 통으로 묶어요. 밤(오후 10시~오전 9시)에 한 것은 아침 9시에 보내요.</div>

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
        <input type="tel" data-u="${esc(u)}" class="smsPhone" value="${esc(pretty(p.phone))}" placeholder="학생 010-…" title="학생 번호 — 공부 안내 문자" style="width:122px; margin:0; padding:6px 8px;">
        <label style="display:flex; gap:3px; align-items:center; font-size:0.8rem;" title="공부 안내 문자 받기"><input type="checkbox" class="smsOn" data-u="${esc(u)}" ${p.phone && p.on === false ? '' : 'checked'}> 받기</label>
        <input type="tel" data-u="${esc(u)}" class="smsParent" value="${esc(pretty(p.parent))}" placeholder="학부모(선택)" title="학부모 번호(선택) — 아이가 공부하면 알림" style="width:122px; margin:0; padding:6px 8px;"></div>`;
    }).join('') || '<div class="empty">등록된 회원이 없어요.</div>';
  }
  function renderSettings() {
    const d = data.settings.daily;
    $('smsDailyOn').checked = !!d.on; $('smsRecVideo').checked = d.video !== false; $('smsRecLesson').checked = d.lessonVideo !== false; $('smsDailyHour').value = String(d.hour); $('smsDailyDays').value = d.days || 'all'; $('smsDailyText').value = d.text;
    updateLen();
    const n = data.settings.notify || {};
    $('smsNotifyOn').checked = !!n.on; $('smsNotifyPhone').value = pretty(n.phone || ''); $('smsNotifyParents').checked = n.parents !== false;
  }
  function updateLen() {
    const t = $('smsDailyText').value.replace(/#\{인사\}/g, '오늘 하루 잘 보내고 있나요? 🙂').replace(/#\{이름\}/g, '홍길동').replace(/#\{수업날짜\}/g, '11/27').replace(/#\{안내\}/g, '11/27 수업 피드백 쉐도잉이 아직 남아 있어요. 오늘 꼭 한 번 해 주세요! 시간 여유가 있으면 영상 쉐도잉이랑 수업영상 쉐도잉도 같이 해 보면 더 좋아요 🙂');
    const n = [...t].length;
    $('smsLen').textContent = `지금 ${n}자 ${n > 70 ? '(가장 긴 경우 예시) — 70자가 넘으면 긴 문자로 가요(문자 무제한 요금제면 괜찮아요)' : ''}`;
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
  $('smsBulkFill').onclick = () => {
    const ms = members(); let ok = 0; const bad = [];
    $('smsBulk').value.split(/\n/).map(l => l.trim()).filter(Boolean).forEach(line => {
      const re = /(\+?82[\s-]?1\d[\d\s-]{7,10}\d|01\d[\d\s-]{7,10}\d)/g;
      const nums = [...line.matchAll(re)];
      const m = nums[0];
      const who = m ? line.slice(0, m.index).replace(/[\t,;:]+/g, ' ').trim() : '';
      const whoName = who.replace(/학부모|부모|엄마|아빠|어머니|아버지/g, '').trim();
      const mem = whoName && (ms.find(x => x.username.toLowerCase() === whoName.toLowerCase()) || ms.find(x => x.name && x.name.replace(/\s/g, '') === whoName.replace(/\s/g, '')));
      const inp = mem && card.querySelector(`.smsPhone[data-u="${CSS.escape(mem.username)}"]`);
      if (!m || !inp) { bad.push(who || line.slice(0, 12)); return; }
      // 번호가 하나면 학생 번호, 둘이면 「학생 번호 학부모 번호」 — 줄에 '학부모'·'부모'·'엄마'·'아빠'가 있고 번호가 하나면 학부모 번호
      const par = card.querySelector(`.smsParent[data-u="${CSS.escape(mem.username)}"]`);
      if (nums.length >= 2) { inp.value = nums[0][1].trim(); par.value = nums[1][1].trim(); par.style.background = '#FFF9C4'; }
      else if (/학부모|부모|엄마|아빠|어머니|아버지/.test(line)) { par.value = m[1].trim(); par.style.background = '#FFF9C4'; ok++; return; }
      else inp.value = m[1].trim();
      inp.style.background = '#FFF9C4'; ok++;
    });
    status($('smsBulkStatus'), `${ok}명 채웠어요${bad.length ? ` · ⚠️ 못 찾음: ${bad.join(', ')}` : ''} — 「💾 전화번호 저장」을 눌러야 저장돼요`, bad.length ? 'error' : 'success');
  };
  $('smsSavePhones').onclick = async () => {
    const st = $('smsPhonesStatus'); status(st, '저장 중…');
    const phones = {};
    card.querySelectorAll('.smsPhone').forEach(i => {
      const u = i.dataset.u, q = CSS.escape(u);
      const parent = card.querySelector(`.smsParent[data-u="${q}"]`).value.trim();
      if (i.value.trim() || parent) phones[u] = { phone: i.value.trim(), parent, on: card.querySelector(`.smsOn[data-u="${q}"]`).checked };
    });
    try { const r = await apiFetch(API, { method: 'POST', body: JSON.stringify({ action: 'phones', phones }) }); data.phones = r.phones; renderPhones(); status(st, `✅ ${Object.keys(r.phones).length}명 저장했어요`, 'success'); }
    catch (e) { status(st, '⚠️ ' + e.message, 'error'); }
  };
  $('smsSaveSettings').onclick = async () => {
    const st = $('smsSettingsStatus'); status(st, '저장 중…');
    try {
      const r = await apiFetch(API, { method: 'POST', body: JSON.stringify({ action: 'settings', daily: { on: $('smsDailyOn').checked, hour: Number($('smsDailyHour').value), days: $('smsDailyDays').value, text: $('smsDailyText').value, video: $('smsRecVideo').checked, lessonVideo: $('smsRecLesson').checked } }) });
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
      <table><thead><tr><th>학생</th><th>💬 피드백 (필수)</th><th>🎬 영상 · 🎥 수업영상 (선택, 오늘)</th><th>문자</th></tr></thead><tbody>${t.map(x => `
        <tr><td style="white-space:nowrap;">${esc(label(x.username))}</td>
        <td style="white-space:nowrap;">${!x.lesson ? '— 최근 7일 수업 없음' : x.todo ? '❌ ' + esc(md(x.todo.date)) + ' 수업 복습 안 함' + (x.todoCount > 1 ? ` (${x.todoCount}회차)` : '') : '✅ ' + esc(md(x.lesson.date)) + ' 수업 복습함'}${x.already ? ' · 오늘 이미 보냄' : ''}</td>
        <td style="white-space:nowrap;">${!x.lesson ? '' : vs(x.video.hasVideo, x.video.videoToday, '🎬') + ' ' + vs(x.video.hasLessonVideo, x.video.lessonVideoToday, '🎥')}</td>
        <td>${x.send ? esc(x.text) : '<span style="color:var(--muted);">안 보내요</span>'}</td></tr>`).join('')}</tbody></table>`;
    return go.length;
  }
  $('smsPreview').onclick = async () => { const st = $('smsSettingsStatus'); status(st, '확인 중…'); try { await preview(); status(st, ''); } catch (e) { status(st, '⚠️ ' + e.message, 'error'); } };
  $('smsSendNow').onclick = async () => {
    const st = $('smsSettingsStatus'), b = $('smsSendNow');
    try {
      status(st, '확인 중…');
      const n = await preview();
      if (!n) { status(st, '지금 보낼 학생이 없어요 (할 일을 다 했거나, 최근 수업이 없었거나, 오늘 이미 보냈어요).'); return; }
      if (!confirm(`할 일이 남은 ${n}명에게 지금 문자를 보낼까요?\n(아래 표의 내용 그대로 학원 휴대폰 번호로 가요)`)) { status(st, ''); return; }
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
      const r = await apiFetch(API, { method: 'POST', body: JSON.stringify({ action: 'settings', notify: { on: $('smsNotifyOn').checked, phone: $('smsNotifyPhone').value, parents: $('smsNotifyParents').checked } }) });
      data.settings = r.settings; renderSettings();
      status(st, r.settings.notify.on ? '✅ 저장했어요 — 학생이 공부하면 알려 드려요' : '✅ 저장했어요 (알림 꺼짐)', 'success');
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

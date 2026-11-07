/* 관리자 페이지 — 🎥 엔보임 수업영상 자동 가져오기
 *  1) 서버(/api/admin-nvoim-video)가 등록된 엔보임 계정으로 로그인해 수강생 상세 페이지에서 녹화 파일을 찾아요.
 *  2) 녹화를 고르면 서버가 3.5MB씩 받아 영상 쉐도잉 조각으로 저장하고, 같은 조각을 이 창에도 돌려줘요.
 *  3) 이 창에서 소리를 뽑아(VideoTranscript.extractAudio) Whisper로 받아쓰고(/api/admin-transcribe) 한 문장씩 정리 → AI로 고치기 → 번역
 *  4) /api/admin-videos 'update'로 저장하면 직접 올린 영상과 똑같은 영상 쉐도잉이 돼요(video.html 재생·채점·기록 그대로).
 *     연결된 학생에게는 바로 넣어 줘요.
 * admin.html의 getToken()/apiFetch()/membersCache/memberLabel()을 사용합니다.
 */
(function () {
  const VT = window.VideoTranscript;
  const $ = id => document.getElementById(id);
  // 「⚙️ 만들 때 설정」 칸이 없는 카드(🎥 엔보임 수업영상 자동 가져오기)는 기본값: 1문장 · 회원 공개 · 번역 · AI 고치기
  const optVal = (id, def) => ($(id) ? $(id).value : def);
  const optOn = id => ($(id) ? $(id).checked : true);
  const API = '/api/admin-nvoim-video';
  const VAPI = { videos: '/api/admin-videos', transcribe: '/api/admin-transcribe', translate: '/api/admin-translate', fix: '/api/admin-fix-sentences', lesson: '/api/admin-lesson-transcribe', turns: '/api/admin-lesson-turns' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fmtSize = b => (b > 1e9 ? (b / 1e9).toFixed(2) + 'GB' : (b / 1e6).toFixed(1) + 'MB');
  const auth = () => ({ Authorization: 'Bearer ' + getToken() });

  let data = { accounts: [], students: [] };
  let found = [];        // 찾은 녹화 [{ studentId, username, url, kind, date, label, key, done }]
  let lastScan = null;   // 진단용 마지막 찾기 결과
  let busy = false, cancelled = false, ctl = null;
  let P = 'nvv';         // 지금 만들고 있는 카드의 화면 칸 앞글자 (nvv: 엔보임 수업영상 자동 가져오기 · lvm: 🎥 수업영상쉐도잉 만들기)

  function setStatus(id, msg, cls = '') { const el = $(id); el.textContent = msg; el.className = 'status ' + cls; }
  function setBar(which, frac, label) {
    $(which + 'Bar').style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
    if (label != null) $(which + 'Label').textContent = label;
  }
  class Cancelled extends Error { constructor() { super('중지했어요.'); this.cancelled = true; } }
  const check = () => { if (cancelled) throw new Cancelled(); };

  async function post(body) {
    return apiFetch(API, { method: 'POST', body: JSON.stringify(body) });
  }

  /* ---------------- 처음 불러오기 ---------------- */
  async function load() {
    try {
      data = await apiFetch(API);
      $('nvvAccount').innerHTML = data.accounts.length
        ? data.accounts.map(a => `<option value="${esc(a.id)}">${esc(a.label)} (${esc(a.userId)})</option>`).join('')
        : '<option value="">등록된 계정 없음 — 「📥 엔보임 피드백」에서 추가</option>';
      $('nvvStudentList').innerHTML = data.students.map(s => `<option value="${esc(s.nvoimId)}">${esc(memberLabel(s.username))}</option>`).join('');
      renderMembers();
      renderRun();
      // 자동으로 찾아 둔 새 녹화: 지금 다른 목록을 보고 있지 않으면 보여 줘요
      if (!found.length && (data.found || []).length) { found = data.found.map(x => Object.assign({}, x, { done: null })); renderFound(); }
    } catch (e) { setStatus('nvvScanStatus', '⚠️ ' + e.message, 'error'); }
  }

  /* ---------------- 지금 바로 가져오기 · 자동 실행 기록 (📥 엔보임 피드백과 같은 모양) ---------------- */
  const fmtAt = iso => (iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
  function renderRun() {
    const lr = data.lastRun, log = data.autoLog || [];
    $('nvvLastRun').textContent = lr ? `마지막 실행: ${fmtAt(lr.at)}${lr.source === 'auto' ? ' (자동)' : ''}` : '';
    const now = Date.now(), last = log[log.length - 1];
    const nextText = new Date(Math.ceil((now + 1000) / 1800000) * 1800000).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    let head;
    if (!last) head = `<div class="status error" style="margin:0;">⚠️ 아직 자동 실행 기록이 없어요. 배포한 뒤 다음 정각/30분(${nextText})이 지나면 여기에 기록이 생겨요. 1시간이 지나도 안 생기면 Netlify 화면의 Functions → <b>nvoim-video-sync</b>를 확인해주세요.</div>`;
    else {
      const ago = Math.round((now - new Date(last.at).getTime()) / 60000), late = ago > 75;
      head = `<div class="status ${late ? 'error' : 'success'}" style="margin:0;">${late ? '⚠️' : '✅'} 마지막 자동 실행: ${fmtAt(last.at)} (${ago < 1 ? '방금' : ago + '분 전'}) · 다음 자동 실행: ${nextText}${late ? ' — 자동 실행이 1시간 넘게 멈춰 있어요. Netlify 화면의 Functions → nvoim-video-sync를 확인해주세요.' : ''}</div>`;
    }
    const rows = log.slice(-10).reverse().map(r => `<tr><td style="white-space:nowrap">${fmtAt(r.at)}</td><td>${r.crashed ? '<span style="color:var(--bad)">실행 오류</span>' : `${r.days ? `수업일 ${r.checked}/${r.days}일 · 수업 ${r.students}개` : `학생 ${r.checked}/${r.students}명`} 확인 · 새 녹화 ${r.found}개${r.finished === false ? ' · 다음 실행에 이어서' : ''}`}</td><td style="color:var(--bad)">${(r.errors || []).length ? esc(r.errors.join(' / ')) : ''}</td></tr>`).join('');
    $('nvvAutoLog').innerHTML = head + (rows ? `<details style="margin-top:6px;"><summary style="cursor:pointer; font-size:0.82rem; color:var(--muted);">자동 실행 기록 보기 (최근 10번)</summary><table style="margin-top:6px; font-size:0.8rem;"><thead><tr><th>시각</th><th>결과</th><th>오류</th></tr></thead><tbody>${rows}</tbody></table></details>` : '');
  }

  $('nvvRunBtn').addEventListener('click', async () => {
    if (busy) return;
    const btn = $('nvvRunBtn');
    btn.disabled = true;
    let last = null;
    try {
      // 서버 함수 한 번에 약 8초까지만 찾으므로, 다 끝날 때까지 이어서 호출합니다.
      for (let round = 1; round <= 30; round++) {
        setStatus('nvvRunStatus', `엔보임에서 새 수업 녹화를 찾는 중...${round > 1 ? ` (${round}번째)` : ''}`);
        last = (await post({ action: 'run' })).summary;
        if (last.finished) break;
      }
      found = []; await load();
      const fresh = found.filter(x => !x.done && !x.saved && x.kind === 'file');
      const err = last.errors.length ? `\n⚠️ ${last.errors.join('\n⚠️ ')}` : '';
      if (!fresh.length) setStatus('nvvRunStatus', `✅ ${last.days ? `최근 ${last.days}일 수강회원 수업 ${last.students}개` : `학생 ${last.students}명`} 확인 — 새 녹화가 없어요.` + err, last.errors.length ? 'error' : 'success');
      else {
        setStatus('nvvRunStatus', `✅ 새 녹화 ${fresh.length}개를 찾았어요. 「💾 저장」을 누르면 「🎥 수업영상 쉐도잉 만들기」에서 그 학생을 골랐을 때 보여요.` + err, 'success');
      }
    } catch (e) { setStatus('nvvRunStatus', '⚠️ ' + e.message, 'error'); }
    btn.disabled = false;
  });
  function renderMembers() {
    const sel = $('nvvMember'), cur = sel.value;
    sel.innerHTML = '<option value="">(넣어 주지 않음)</option>' + (typeof membersCache !== 'undefined' ? membersCache : []).map(m => `<option value="${esc(m.username)}">${esc(memberLabel(m.username))}</option>`).join('');
    sel.value = cur;
  }
  // 학생 아이디를 넣으면 연결된 회원을 자동으로 골라요
  $('nvvStudent').addEventListener('change', () => {
    const id = $('nvvStudent').value.trim().toLowerCase();
    const s = data.students.find(x => x.nvoimId.toLowerCase() === id);
    renderMembers();
    if (s) $('nvvMember').value = s.username;
  });
  $('nvvMember').addEventListener('focus', renderMembers);

  /* ---------------- 녹화 찾기 ---------------- */
  async function scanOne(studentId, username, withHtml) {
    const r = await post({ action: 'scan', studentId, accountId: $('nvvAccount').value || undefined, html: !!withHtml });
    r.recordings.forEach(x => Object.assign(x, { studentId, username }));
    return r;
  }
  function showDiag(r) {
    lastScan = r;
    const d = r.diag || {};
    const lines = [
      `학생: ${r.studentId} · 계정: ${r.account} · HTTP ${r.status} · 페이지 ${d.bytes || 0}자 · 제목: ${d.title || '-'}`,
      ...(d.oneStop ? [`▶ ${d.oneStop}`, ...(d.oneStopErrors || []).map(x => '  ⚠️ ' + x)] : []),
      '',
      `▶ 녹화 후보 ${r.recordings.length}개`, ...r.recordings.map(x => `  [${x.kind}] ${x.date || '날짜?'} ${x.url}`),
      '', `▶ 녹화·재생 관련 링크 ${(d.links || []).length}개`, ...(d.links || []).map(x => '  ' + x),
      '', `▶ 녹화·재생 관련 onclick ${(d.onclicks || []).length}개`, ...(d.onclicks || []).map(x => '  ' + x),
      '', `▶ iframe·video ${(d.frames || []).length}개`, ...(d.frames || []).map(x => '  ' + x),
    ];
    if ($('nvvDiag')) $('nvvDiag').textContent = lines.join('\n');
  }
  function renderFound() {
    const box = $('nvvList');
    if (!found.length) { box.innerHTML = ''; return; }
    const KIND = { file: '🎞️ 녹화 파일', hls: '📡 스트리밍(아직 못 가져와요)', page: '🔗 녹화 보기 링크(파일인지 확인 필요)' };
    box.innerHTML = found.map((x, i) => `
      <div class="set-item set-stack">
        <div>
          <div class="title">${esc(x.date || '날짜 모름')} · ${esc(x.username ? memberLabel(x.username) : x.studentId)} ${x.done ? '<span class="pill">✅ 만든 영상</span>' : '<span class="pill">🆕 새 녹화</span>'}</div>
          <div class="meta">${KIND[x.kind] || x.kind} · ${esc(x.label || '')} · ${esc(x.url)}</div>
        </div>
        <div class="set-btns">
          ${x.kind === 'hls' || x.done ? '' : x.saved ? `<span class="pill">✅ 저장함${x.savedFor ? ' · ' + esc(memberLabel(x.savedFor)) : ''}</span>` : `${x.username ? '' : `<select data-nvvu="${i}" style="max-width:170px;">${memberOpts()}</select>`}<button class="btn-primary btn-small" data-nvvsave="${i}">💾 저장</button>`}
          ${x.done ? `<button class="btn-primary btn-small" data-nvvplay="${esc(x.done.lessonId)}" data-title="${esc(titleFor(x))}">▶ 위에서 연습</button><a class="btn-ghost btn-small" style="text-decoration:none; border-radius:10px; font-weight:700;" href="video.html?id=${encodeURIComponent(x.done.lessonId)}&admin=1" target="_blank" rel="noopener">↗ 새 창</a>` : ''}
        </div>
      </div>`).join('') + (savable().length > 1 ? `<div class="row"><button class="btn-primary" id="nvvAllBtn">💾 새 녹화 모두 저장 (${savable().length}개)</button></div>` : '');
  }
  // 💾 저장: 저장할 수 있는 녹화(회원이 연결된 새 녹화 파일) · 회원 고르기 칸
  const savable = () => found.filter(x => !x.done && !x.saved && x.kind === 'file' && x.username);
  const memberOpts = () => '<option value="">-- 회원 고르기 --</option>' + (typeof membersCache !== 'undefined' ? membersCache : []).map(m => `<option value="${esc(m.username)}">${esc(memberLabel(m.username))}</option>`).join('');
  async function saveFound(list, pick) {
    let ok = 0; const errors = [];
    for (const x of list) {
      const u = x.username || pick || '';
      if (!u) { errors.push(`${x.date || ''} ${x.studentId}: 저장할 회원을 골라 주세요.`); continue; }
      try { await post({ action: 'save', recording: x, username: u }); x.saved = true; x.savedFor = u; ok++; }
      catch (e) { errors.push(`${x.date || ''} ${x.studentId}: ${e.message}`); }
    }
    renderFound();
    setStatus('nvvRunStatus', (ok ? `✅ 녹화 ${ok}개를 저장했어요. 「🎥 수업영상 쉐도잉 만들기」에서 그 학생을 고르면 보여요 — 거기서 「🎬 쉐도잉 만들기」를 누르세요.` : '') + (errors.length ? `\n⚠️ ${errors.join('\n⚠️ ')}` : ''), errors.length ? 'error' : 'success');
  }

  $('nvvScanBtn').addEventListener('click', async () => {
    const id = $('nvvStudent').value.trim();
    if (!id) { setStatus('nvvScanStatus', '⚠️ 엔보임 학생 아이디를 넣어 주세요.', 'error'); return; }
    $('nvvScanBtn').disabled = true;
    setStatus('nvvScanStatus', `🔍 ${id} 학생의 녹화를 찾는 중…`);
    try {
      const r = await scanOne(id, $('nvvMember').value);
      found = r.recordings; showDiag(r); renderFound();
      setStatus('nvvScanStatus', r.recordings.length
        ? `✅ 녹화 후보 ${r.recordings.length}개를 찾았어요 (새 녹화 ${r.recordings.filter(x => !x.done).length}개).`
        : '⚠️ 최근 7일 수업에서 이 학생의 녹화를 찾지 못했어요.', r.recordings.length ? 'success' : 'error');
      if (!r.recordings.length && $('nvvDiagBox')) $('nvvDiagBox').open = true;
    } catch (e) { setStatus('nvvScanStatus', '⚠️ ' + e.message, 'error'); }
    $('nvvScanBtn').disabled = false;
  });

  $('nvvScanAllBtn').addEventListener('click', async () => {
    if (!data.students.length) await load();
    const list = data.students;
    if (!list.length) { setStatus('nvvScanStatus', '⚠️ 연결된 학생이 없어요.', 'error'); return; }
    $('nvvScanAllBtn').disabled = true;
    found = []; const errors = [];
    for (let i = 0; i < list.length; i++) {
      setStatus('nvvScanStatus', `🔍 녹화를 찾는 중… ${i + 1}/${list.length} ${memberLabel(list[i].username)}`);
      try { const r = await scanOne(list[i].nvoimId, list[i].username); found.push(...r.recordings); if (r.recordings.length || i === 0) showDiag(r); }
      catch (e) { if (!list[i].guess) errors.push(`${list[i].nvoimId}: ${e.message}`); }
      renderFound();
    }
    setStatus('nvvScanStatus', `✅ ${list.length}명 확인 — 녹화 ${found.length}개 (새 녹화 ${found.filter(x => !x.done).length}개)` + (errors.length ? `\n⚠️ ${errors.slice(0, 3).join('\n')}` : ''), found.length ? 'success' : 'error');
    $('nvvScanAllBtn').disabled = false;
  });

  if ($('nvvHtmlBtn')) $('nvvHtmlBtn').addEventListener('click', async () => {
    const id = $('nvvStudent').value.trim() || (lastScan && lastScan.studentId);
    if (!id) { alert('엔보임 학생 아이디를 넣어 주세요.'); return; }
    $('nvvHtmlBtn').disabled = true;
    try {
      const r = await scanOne(id, '', true);
      showDiag(r);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([r.html || ''], { type: 'text/html' }));
      a.download = `nvoim-student-${id}.html`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { alert(e.message); }
    $('nvvHtmlBtn').disabled = false;
  });

  $('nvvList').addEventListener('click', e => {
    if (e.target.id === 'nvvAllBtn') { saveFound(savable()); return; }
    const pl = e.target.closest('[data-nvvplay]'); if (pl) { openPlayer('nvv', pl.dataset.nvvplay, pl.dataset.title); return; }
    const b = e.target.closest('[data-nvvsave]'); if (!b) return;
    const i = Number(b.dataset.nvvsave), sel = $('nvvList').querySelector(`[data-nvvu="${i}"]`);
    saveFound([found[i]], sel ? sel.value : '');
  });
  $('nvvUrlBtn').addEventListener('click', () => {
    const url = $('nvvUrl').value.trim();
    if (!/^https?:\/\//i.test(url)) { setStatus('nvvStatus', '⚠️ https://로 시작하는 녹화 파일 주소를 넣어 주세요.', 'error'); return; }
    makeMany([{ url, kind: 'file', date: '', studentId: $('nvvStudent').value.trim(), username: $('nvvMember').value, label: '' }]);
  });
  $('nvvCancelBtn').addEventListener('click', () => {
    if (!busy || !confirm('만들기를 중지할까요? 만들던 영상은 지워요.')) return;
    cancelled = true; try { ctl && ctl.abort(); } catch (e) {}
    setStatus('nvvStatus', '⏹ 중지하는 중…');
  });

  /* ---------------- 만들기 ---------------- */
  function titleFor(x) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(x.date || '');
    const who = x.username ? memberLabel(x.username) : (x.studentId || '');
    return `${m ? `${Number(m[2])}/${Number(m[3])} ` : ''}엔보임 수업 녹화${who ? ' · ' + who : ''}`;
  }

  async function makeMany(list, prefix = 'nvv') {
    if (busy || !list.length) return;
    P = prefix;
    // 레벨 없이 누르면 바로 만들어요(학생은 「🎥 수업영상쉐도잉」에서 연습)
    busy = true; cancelled = false;
    $(P + 'CancelBtn').classList.remove('hidden'); $(P + 'Progress').classList.remove('hidden');
    try { $(P + 'Progress').scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    let ok = 0; const errors = [];
    for (let i = 0; i < list.length; i++) {
      try {
        const r = await makeOne(list[i], list.length > 1 ? `(${i + 1}/${list.length}) ` : '');
        list[i].done = { lessonId: r.id }; ok++;
        if (P === 'nvv') renderFound(); else renderLvm();
      } catch (e) {
        if (e.cancelled || cancelled) { setStatus(P + 'Status', '⏹ 중지했어요. 만들던 영상은 지웠어요.'); break; }
        errors.push(`${titleFor(list[i])}: ${e.message}`);
      }
    }
    busy = false; ctl = null;
    $(P + 'CancelBtn').classList.add('hidden');
    if (P === 'lvm') loadLvmRecords();
    // 어느 카드에서 만들든 만든 수업영상이 카드 맨 위에서 재생되며 바로 쉐도잉 연습
    { const made = list.filter(x => x.done && x.done.lessonId).pop(); if (made && !cancelled) openPlayer(P, made.done.lessonId, titleFor(made)); }
    if (!cancelled) setStatus(P + 'Status', (ok ? `✅ 수업영상 쉐도잉 ${ok}개를 만들었어요${list[0].username ? ` — ${memberLabel(list[0].username)} 학생에게 넣어 줬어요` : ''}. ${faceNote ? faceNote + ' ' : ''}「🎬 영상 쉐도잉 만들기」 목록에서 문장을 확인·수정할 수 있어요.` : '') + (errors.length ? `\n⚠️ ${errors.join('\n⚠️ ')}` : ''), errors.length ? 'error' : 'success');
  }

  async function makeOne(x, prefix) {
    ctl = new AbortController();
    setBar(P + 'Up', 0, '준비 중'); setBar(P + 'Tr', 0, '대기 중');
    const title = titleFor(x);
    setStatus(P + 'Status', `${prefix}「${title}」 녹화를 ${x.file ? '올리는' : '가져오는'} 중이에요. 이 창을 닫지 마세요.`);
    if (x.file) return makeFromFile(x, title);
    const start = await post({ action: 'start', url: x.url, conf: x.conf || '', part: x.part || 0, studentId: x.studentId, title, date: x.date || '', accountId: $('nvvAccount').value || undefined });
    const id = start.lesson.id;
    try {
      // 나눠 받기를 지원하지 않는 녹화: 서버(백그라운드)가 처음부터 끝까지 받아 조각으로 저장해요
      if (start.stream) {
        const r = await fetch('/.netlify/functions/nvoim-video-fetch-background', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, auth()), body: JSON.stringify({ id }) });
        if (r.status === 401) throw new Error('세션이 만료됐어요. 다시 로그인해주세요.');
      }
      const parts = await download(id, start.chunks, start.size);
      const file = new File(parts, 'nvoim-recording', { type: start.mime });
      check();
      const localUrl = URL.createObjectURL(file);
      const duration = await probeDuration(localUrl);
      URL.revokeObjectURL(localUrl);
      const tr = await transcribe(file, duration, (f, l) => setBar(P + 'Tr', f * 0.8, l), title);
      let sents = tr.sentences;
      if (!sents.length) throw new Error('영어 대사를 찾지 못했어요. 말소리가 있는 녹화인지 확인해 주세요.');
      if (optOn(P + 'Fix') && !tr.fixed) sents = await fixSentences(sents, f => setBar(P + 'Tr', 0.8 + f * 0.1, `AI가 틀린 문장을 고치는 중… ${Math.round(f * 100)}%`), title);
      if (optOn(P + 'Translate')) await translateAll(sents, title, f => setBar(P + 'Tr', 0.9 + f * 0.1, `한국어 번역 중… ${Math.round(f * 100)}%`));
      check();
      const pv = optVal(P + 'Parts', '1');
      await apiFetch(VAPI.videos, { method: 'POST', body: JSON.stringify({
        action: 'update', id, sentences: sents, duration: tr.duration, status: 'ready',
        partSentences: Number(pv), partMinutes: 0, visibility: optVal(P + 'Visibility', 'assigned'), assigned: x.username ? [x.username] : [], level: '',
      }) });
      await post({ action: 'finish', id, username: x.username || '', date: x.date || '', studentId: x.studentId || '' });
      setBar(P + 'Tr', 1, `완료 — 문장 ${sents.length}개 ${faceNote}`);
      return { id };
    } catch (e) {
      try { await post({ action: 'cancel', id }); } catch (_) {}
      throw e;
    }
  }

  // 📁 녹화 파일로 만들기: 「📁 내 영상 파일 올리기」처럼 조각을 올리면서 받아써요 → 수업영상으로 표시 · 학생에게 넣어주기
  async function makeFromFile(x, title) {
    const file = x.file;
    const localUrl = URL.createObjectURL(file);
    const duration = await probeDuration(localUrl);
    URL.revokeObjectURL(localUrl);
    const lesson = (await apiFetch(VAPI.videos, { method: 'POST', body: JSON.stringify({ action: 'create', title, mime: file.type || 'video/mp4', size: file.size, duration }) })).lesson;
    const id = lesson.id;
    try {
      const up = uploadChunks(file, id);
      const tr = (async () => {
        const r = await transcribe(file, duration, (f, l) => setBar(P + 'Tr', f * 0.8, l), title);
        if (!r.sentences.length) throw new Error('영어 대사를 찾지 못했어요. 말소리가 있는 녹화인지 확인해 주세요.');
        if (optOn(P + 'Fix') && !r.fixed) r.sentences = await fixSentences(r.sentences, f => setBar(P + 'Tr', 0.8 + f * 0.1, `AI가 틀린 문장을 고치는 중… ${Math.round(f * 100)}%`), title);
        if (optOn(P + 'Translate')) await translateAll(r.sentences, title, f => setBar(P + 'Tr', 0.9 + f * 0.1, `한국어 번역 중… ${Math.round(f * 100)}%`));
        return r;
      })();
      const [, r] = await Promise.all([up, tr]);
      check();
      await apiFetch(VAPI.videos, { method: 'POST', body: JSON.stringify({
        action: 'update', id, sentences: r.sentences, duration: r.duration, status: 'ready',
        partSentences: Number(optVal(P + 'Parts', '1')), partMinutes: 0, visibility: optVal(P + 'Visibility', 'assigned'), assigned: x.username ? [x.username] : [], level: '',
      }) });
      await post({ action: 'finish', id, username: x.username || '', date: x.date || '', studentId: x.studentId || '' });
      setBar(P + 'Tr', 1, `완료 — 문장 ${r.sentences.length}개 ${faceNote}`);
      return { id };
    } catch (e) {
      try { await apiFetch(VAPI.videos, { method: 'POST', body: JSON.stringify({ action: 'delete', id }) }); } catch (_) {}
      throw e;
    }
  }
  async function uploadChunks(file, id) {
    const CH = 3.5 * 1024 * 1024, total = Math.ceil(file.size / CH);
    let next = 0, done = 0;
    async function worker() {
      while (next < total) {
        const n = next++;
        for (let attempt = 1; ; attempt++) {
          check();
          try {
            const r = await fetch(`${VAPI.videos}?id=${id}&n=${n}`, { method: 'PUT', signal: ctl.signal, headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, auth()), body: file.slice(n * CH, Math.min(file.size, (n + 1) * CH)) });
            if (r.status === 401) throw Object.assign(new Error('세션이 만료됐어요. 다시 로그인해주세요.'), { fatal: true });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            break;
          } catch (e) {
            if (cancelled || e.name === 'AbortError') throw new Cancelled();
            if (e.fatal || attempt >= 4) throw new Error(`녹화 조각 ${n + 1}/${total} 올리기 실패: ${e.message}`);
            await sleep(1500 * attempt);
          }
        }
        done++;
        setBar(P + 'Up', done / total, `${done}/${total} 조각 (${fmtSize(Math.min(file.size, done * CH))} / ${fmtSize(file.size)})`);
      }
    }
    await Promise.all([worker(), worker(), worker()]);
  }

  // 서버가 엔보임에서 받아 저장한 조각을 그대로 받아요(3개씩 동시에)
  async function download(id, total, size) {
    const parts = new Array(total);
    let next = 0, done = 0;
    async function worker() {
      while (next < total) {
        const n = next++;
        for (let attempt = 1; ; attempt++) {
          check();
          try {
            const r = await fetch(API, { method: 'POST', signal: ctl.signal, headers: Object.assign({ 'Content-Type': 'application/json' }, auth()), body: JSON.stringify({ action: 'chunk', id, n }) });
            if (r.status === 401) throw Object.assign(new Error('세션이 만료됐어요. 다시 로그인해주세요.'), { fatal: true });
            if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.message || d.error || 'HTTP ' + r.status); }
            if (r.status === 202) { // 서버가 아직 이 조각까지 받지 못했어요 — 기다렸다가 다시
              const d = await r.json().catch(() => ({}));
              setBar(P + 'Up', (d.got || 0) / total, `엔보임에서 녹화를 받는 중… ${d.got || 0}/${total} 조각`);
              attempt = 0; await sleep(2500); continue;
            }
            parts[n] = await r.blob();
            break;
          } catch (e) {
            if (cancelled || e.name === 'AbortError') throw new Cancelled();
            if (e.fatal || attempt >= 4) throw new Error(`녹화 조각 ${n + 1}/${total} 가져오기 실패: ${e.message}`);
            await sleep(1500 * attempt);
          }
        }
        done++;
        setBar(P + 'Up', done / total, `${done}/${total} 조각 (${fmtSize(Math.min(size, done * 3.5 * 1024 * 1024))} / ${fmtSize(size)})`);
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    return parts;
  }

  function probeDuration(url) {
    return new Promise(res => {
      const v = document.createElement('video');
      v.preload = 'metadata'; v.muted = true; v.src = url;
      v.onloadedmetadata = () => res(isFinite(v.duration) ? v.duration : 0);
      v.onerror = () => res(0);
      setTimeout(() => res(0), 15000);
    });
  }

  // 「📁 내 영상 파일 올리기」와 같은 받아쓰기: 약 100초씩 잘라 Whisper → 한 문장씩
  // 브라우저가 소리를 바로 읽지 못하는 녹화(엔보임 녹화 형식 · 아주 긴 녹화): ffmpeg(웹 버전)로 16kHz 모노 WAV로 바꿔서 읽어요
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('ffmpeg를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.')); document.head.appendChild(s); });
  }
  async function loadFfmpeg(onProg) {
    const FF = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd', CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
    if (!window.FFmpegWASM) await loadScript(FF + '/ffmpeg.js');
    const blobURL = async (url, type) => URL.createObjectURL(new Blob([await (await fetch(url)).arrayBuffer()], { type }));
    const ff = new FFmpegWASM.FFmpeg();
    onProg(0.02, '녹화를 여는 도구를 불러오는 중… (처음엔 30초쯤)');
    await ff.load({ classWorkerURL: await blobURL(FF + '/814.ffmpeg.js', 'text/javascript'), coreURL: await blobURL(CORE + '/ffmpeg-core.js', 'text/javascript'), wasmURL: await blobURL(CORE + '/ffmpeg-core.wasm', 'application/wasm') });
    check();
    return ff;
  }
  async function toWavWithFfmpeg(file, onProg) {
    const ff = await loadFfmpeg(onProg);
    const logs = [];
    ff.on('log', ({ message }) => { logs.push(message); if (logs.length > 200) logs.shift(); });
    ff.on('progress', ({ progress }) => { if (progress > 0 && progress <= 1) onProg(0.02 + progress * 0.03, `녹화에서 소리를 꺼내는 중… ${Math.round(progress * 100)}%`); });
    try {
      await ff.writeFile('in', new Uint8Array(await file.arrayBuffer()));
      await ff.exec(['-i', 'in', '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', 'out.wav']);
      let out;
      try { out = await ff.readFile('out.wav'); } catch (e) { out = null; }
      const streams = logs.filter(l => /Stream #0|Input #0/.test(l)).slice(0, 4).join(' / ');
      console.log('[수업 녹화 ffmpeg]', logs.join('\n'));
      if (!out || out.length < 1000) throw new Error(/Audio:/.test(streams) ? `녹화에서 소리를 꺼내지 못했어요. (${streams})` : `이 녹화 파일에는 소리가 없어요. (${streams || '형식을 알 수 없음'})`);
      return new File([out.buffer], 'recording.wav', { type: 'audio/wav' });
    } finally { try { ff.terminate(); } catch (e) {} }
  }

  /* 선생님 얼굴이 나오는 곳부터(운영자 지시 2026-11-03, 모든 수업영상 쉐도잉): 선생님이 들어오기 전 앞부분은 빼고,
     학생·선생님 얼굴이 함께 보이기 시작한 곳부터 받아써요. 5초마다 화면을 보고 얼굴이 2개 이상인 화면이 두 번 이어지는 첫 곳.
     얼굴을 찾지 못하면 처음부터 만들어요. */
  const FACE_STEP = 5, FACE_MAX = 30 * 60;
  let faceDet = null, faceNote = '';
  async function faceDetector() {
    if (faceDet) return faceDet;
    const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
    const v = await import(MP + '/vision_bundle.mjs');
    const files = await v.FilesetResolver.forVisionTasks(MP + '/wasm');
    faceDet = await v.FaceDetector.createFromOptions(files, {
      baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite' },
      runningMode: 'IMAGE', minDetectionConfidence: 0.5,
    });
    return faceDet;
  }
  // counts: [{ t, n }] → 얼굴 2개 이상이 두 번 이어지는 첫 시각(마지막 한 장만 2개면 그 시각)
  function bothFacesAt(counts, final) {
    for (let i = 0; i < counts.length; i++) {
      if (counts[i].n < 2) continue;
      if (i + 1 < counts.length ? counts[i + 1].n >= 2 : final) return counts[i].t;
    }
    return null;
  }
  const faceProg = (onProg, t) => onProg(0.01, `👥 선생님 얼굴이 나오는 곳을 찾는 중… ${VT.fmt(t)}`);
  // 브라우저가 녹화 화면을 바로 열 수 있으면 <video>로, 아니면 null
  async function facesByVideo(file, det, onProg) {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.src = url;
    try {
      const ok = await new Promise(res => { v.onloadeddata = () => res(v.videoWidth > 0); v.onerror = () => res(false); setTimeout(() => res(false), 20000); });
      if (!ok) return null;
      const end = Math.min(isFinite(v.duration) ? v.duration : 0, FACE_MAX);
      const c = document.createElement('canvas'), g = c.getContext('2d');
      c.width = 640; c.height = Math.round(640 * v.videoHeight / v.videoWidth) || 360;
      const counts = [];
      for (let t = 0; t < end; t += FACE_STEP) {
        check(); faceProg(onProg, t);
        await new Promise(res => { let fin = false; const done = () => { if (fin) return; fin = true; v.removeEventListener('seeked', done); res(); }; v.addEventListener('seeked', done); v.currentTime = t; setTimeout(done, 5000); });
        g.drawImage(v, 0, 0, c.width, c.height);
        counts.push({ t, n: det.detect(c).detections.length });
        const hit = bothFacesAt(counts, false);
        if (hit != null) return hit;
      }
      const last = bothFacesAt(counts, true);
      return last == null ? -1 : last;
    } finally { URL.revokeObjectURL(url); v.removeAttribute('src'); try { v.load(); } catch (e) {} }
  }
  // 브라우저가 화면을 못 여는 녹화: ffmpeg로 5초마다 화면 한 장씩 꺼내서 봐요
  async function facesByFfmpeg(file, det, onProg) {
    const ff = await loadFfmpeg(onProg);
    try {
      faceProg(onProg, 0);
      await ff.writeFile('in', new Uint8Array(await file.arrayBuffer()));
      await ff.exec(['-i', 'in', '-t', String(FACE_MAX), '-an', '-vf', `fps=1/${FACE_STEP},scale=640:-2`, '-q:v', '5', 'f%04d.jpg']);
      const counts = [];
      for (let k = 1; ; k++) {
        check();
        let d;
        try { d = await ff.readFile(`f${String(k).padStart(4, '0')}.jpg`); } catch (e) { break; }
        const t = (k - 1) * FACE_STEP;
        faceProg(onProg, t);
        const img = await createImageBitmap(new Blob([d.buffer], { type: 'image/jpeg' }));
        counts.push({ t, n: det.detect(img).detections.length });
        img.close();
        const hit = bothFacesAt(counts, false);
        if (hit != null) return hit;
      }
      if (!counts.length) return null;
      const last = bothFacesAt(counts, true);
      return last == null ? -1 : last;
    } finally { try { ff.terminate(); } catch (e) {} }
  }
  // → 쉐도잉을 시작할 초(얼굴을 못 찾으면 0)
  async function teacherStart(file, onProg) {
    faceNote = '';
    let at = null;
    try {
      onProg(0.01, '👥 선생님 얼굴이 나오는 곳을 찾는 도구를 불러오는 중…');
      const det = await faceDetector();
      at = await facesByVideo(file, det, onProg);
      if (at == null) at = await facesByFfmpeg(file, det, onProg);
    } catch (e) {
      if (e.cancelled || cancelled) throw e;
      console.warn('[수업 녹화 얼굴 찾기]', e);
    }
    if (at > 0) { faceNote = `👥 선생님 얼굴이 나온 ${VT.fmt(at)}부터 만들었어요.`; return at; }
    faceNote = at === 0 ? '' : '⚠️ 선생님 얼굴이 나오는 곳을 찾지 못해 처음부터 만들었어요.';
    return 0;
  }

  /* 대사가 빠지지 않게 받아쓰기(운영자 지시 2026-11-03):
     ① 소리를 키워(작은 학생 목소리도) ② 약 30초씩 짧게 받아쓰고(Whisper가 긴 조각에서 대사를 건너뛰지 않게, 앞 조각 힌트는 짧게)
     ③ 한국어로 잘못 알아들은 조각은 영어로 다시 받아써서 또렷한 영어 문장은 살리고
     ④ 다 받아쓴 뒤 목소리가 있는데 받아적힌 단어가 없는 곳을 찾아 그 부분만 다시 받아써서 채워요. */
  const LESSON_PIECE = 25;
  function louder(pcm) {
    // 큰 소리 0.1%를 뺀 가장 큰 소리가 0.9가 되게(최대 8배) 키워요
    const step = Math.max(1, Math.floor(pcm.length / 200000)), sample = [];
    for (let i = 0; i < pcm.length; i += step) sample.push(Math.abs(pcm[i]));
    sample.sort((a, b) => a - b);
    const peak = sample[Math.floor(sample.length * 0.999)] || 0;
    const gain = peak > 0 ? Math.min(8, 0.9 / peak) : 1;
    if (gain <= 1.05) return pcm;
    const out = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) out[i] = Math.max(-1, Math.min(1, pcm[i] * gain));
    return out;
  }
  async function askLesson(pcm, prompt, lang, label) {
    const wav = VT.encodeWav(pcm);
    for (let attempt = 1; ; attempt++) {
      check();
      const r = await fetch(VAPI.lesson + '?prompt=' + encodeURIComponent(prompt) + (lang ? '&lang=' + lang : ''), { method: 'POST', signal: ctl.signal, headers: Object.assign({ 'Content-Type': 'audio/wav' }, auth()), body: wav });
      const d = await r.json().catch(() => null);
      if (r.ok) return d || { segments: [], words: [] };
      if (r.status === 401) throw new Error('세션이 만료됐어요. 다시 로그인해주세요.');
      if (attempt >= 6) throw new Error('받아쓰기 실패: ' + ((d && (d.detail || d.error)) || r.status));
      const wait = r.status === 429 ? Math.min(65, (d && d.retryAfter) || 20) : 3 * attempt;
      label(`음성 인식 사용량 한도 — ${wait}초 기다렸다 계속해요…`);
      await sleep(wait * 1000);
    }
  }
  const hangulShare = segs => { const t = segs.map(s => s.text).join(''); const h = (t.match(/[가-힣]/g) || []).length, a = (t.match(/[A-Za-z]/g) || []).length; return h + a ? h / (h + a) : 0; };
  // ③ 한국어로 받아쓴 조각: 영어로 다시 받아써서, 한글 줄이 있던 시간에 또렷한(lp > -0.5) 영어 줄만 바꿔 넣어요
  //   한글만 있는 줄(정말 한국어로 한 말)은 바꾸지 않아요 — 영어로 받아쓰면 한국어 말이 영어로 번역돼 쉐도잉에 섞여요(운영자 지시 2026-11-03)
  function mergeEnglish(d, en) {
    const hs = d.segments.filter(s => HANGUL.test(s.text) && hangulShare([s]) < 0.7);
    const inH = s => hs.some(h => s.s < h.e - 0.2 && s.e > h.s + 0.2);
    const good = (en.segments || []).filter(s => inH(s) && typeof s.lp === 'number' && s.lp > -0.5 && !HANGUL.test(s.text));
    if (!good.length) return d;
    const covered = h => good.some(s => s.s < h.e - 0.2 && s.e > h.s + 0.2);
    const inGood = w => good.some(s => w.s >= s.s - 0.2 && w.e <= s.e + 0.2);
    return {
      segments: d.segments.filter(s => !(HANGUL.test(s.text) && covered(s))).concat(good).sort((a, b) => a.s - b.s),
      words: (d.words || []).filter(w => !hs.some(h => covered(h) && w.s >= h.s - 0.2 && w.e <= h.e + 0.2)).concat((en.words || []).filter(inGood)).sort((a, b) => a.s - b.s),
    };
  }
  // ④ 목소리가 있는데 단어가 없는 곳(0.6초 넘게): 20ms마다 소리 크기를 보고 찾아요
  function missedSpeech(pcm, offset, results) {
    const SR = VT.SR, fr = Math.floor(SR * 0.02), n = Math.floor(pcm.length / fr);
    const rms = new Float32Array(n);
    for (let k = 0; k < n; k++) { let e = 0; for (let i = k * fr; i < (k + 1) * fr; i++) e += pcm[i] * pcm[i]; rms[k] = Math.sqrt(e / fr); }
    const sorted = Array.from(rms).sort((a, b) => a - b);
    const thr = Math.max(0.02, (sorted[Math.floor(n * 0.2)] || 0) * 4); // 조용한 곳의 4배보다 큰 소리
    const spans = [];
    results.forEach(r => (r.words || []).forEach(w => spans.push([w.s + r.offset - 0.3, w.e + r.offset + 0.3])));
    spans.sort((a, b) => a[0] - b[0]);
    const said = t => { for (const [a, b] of spans) { if (a > t) return false; if (t <= b) return true; } return false; };
    const runs = [];
    let st = -1, gap = 0;
    for (let k = 0; k <= n; k++) {
      const t = offset + k * 0.02, on = k < n && rms[k] > thr && !said(t);
      if (on) { if (st < 0) st = k; gap = 0; }
      else if (st >= 0 && ++gap > 25) { const en = k - gap; if ((en - st) * 0.02 >= 0.6) runs.push([st * 0.02, en * 0.02]); st = -1; gap = 0; }
    }
    return runs.slice(0, 60).map(([a, b]) => [Math.max(0, a - 0.5), Math.min(pcm.length / SR, b + 0.5)]);
  }
  const HALLUCINATION = /^(thank you\.?|thanks for watching.*|you\.?|bye\.?|\.+)$/i;

  async function transcribe(file, duration, onProg, title) {
    const from = await teacherStart(file, onProg);
    check();
    onProg(0.02, '소리 추출 중… (긴 녹화는 수십 초 걸려요)');
    let ex;
    try { ex = await VT.extractAudio(file); }
    catch (e) { check(); ex = await VT.extractAudio(await toWavWithFfmpeg(file, onProg)); }
    const { pcm: whole, duration: aDur } = ex;
    const raw = whole.subarray(Math.min(whole.length, Math.floor(from * VT.SR)));
    if (raw.length < VT.SR) throw new Error('선생님 얼굴이 나온 뒤의 소리가 없어요.');
    const pcm = louder(raw);
    const pieces = VT.splitAudio(pcm, LESSON_PIECE).map(p => Object.assign(p, { offset: p.offset + from }));
    const results = [];
    let prompt = '';
    for (let i = 0; i < pieces.length; i++) {
      check();
      const label = l => onProg((i + 0.3) / pieces.length * 0.65, `${l} (${i + 1}/${pieces.length})`);
      label(`받아쓰는 중… ${VT.fmt(pieces[i].offset)}~`);
      let d = await askLesson(pieces[i].pcm, prompt, '', label);
      d = { segments: d.segments || [], words: d.words || [] };
      if (hangulShare(d.segments) > 0.3) d = mergeEnglish(d, await askLesson(pieces[i].pcm, prompt, 'en', label));
      results.push({ offset: pieces[i].offset, segments: d.segments, words: d.words });
      const last = d.segments.filter(s => !HANGUL.test(s.text)).slice(-1)[0];
      prompt = last ? last.text.slice(-120) : '';
    }
    // ④ 빠진 대사 다시 받아쓰기
    const gaps = missedSpeech(pcm, from, results);
    for (let g = 0; g < gaps.length; g++) {
      const [a, b] = gaps[g];
      const label = l => onProg(0.65 + (g + 0.5) / gaps.length * 0.1, `${l} (${g + 1}/${gaps.length})`);
      label(`🔎 빠진 대사 다시 받아쓰는 중… ${VT.fmt(from + a)}`);
      const d = await askLesson(pcm.subarray(Math.floor(a * VT.SR), Math.floor(b * VT.SR)), '', '', label);
      // 앞뒤로 이미 받아쓴 말과 겹치는 줄은 빼요(같은 말이 두 번 들어가지 않게)
      const known = t => results.some(r => (r.words || []).some(w => t >= w.s + r.offset - 0.1 && t <= w.e + r.offset + 0.1));
      // 단어 시간이 틀려도 걸러지게: 앞뒤 4초 안에 이미 받아쓴 글에 그 줄 단어가 60% 넘게 있으면 같은 말이에요
      const nearText = (t0, t1) => new Set(results.flatMap(r => (r.segments || []).filter(x => x.e + r.offset > t0 - 4 && x.s + r.offset < t1 + 4).flatMap(x => wordsOf(x.text))));
      const sameAsKnown = s => { const w = wordsOf(s.text), near = nearText(from + a + s.s, from + a + s.e); return w.length > 0 && w.filter(x => near.has(x)).length / w.length >= 0.6; };
      const segs = (d.segments || []).filter(s => !HALLUCINATION.test(String(s.text || '').trim()) && !HANGUL.test(s.text) && !known(from + a + (s.s + s.e) / 2) && !sameAsKnown(s));
      if (!segs.length) continue;
      const inSeg = w => segs.some(s => w.s >= s.s - 0.3 && w.e <= s.e + 0.3);
      results.push({ offset: from + a, segments: segs, words: (d.words || []).filter(inSeg) });
    }
    const dur = duration || aDur;
    const sentences = await lessonSentences(results, f => onProg(0.75 + f * 0.25, `👥 선생님·학생 말을 한 사람씩, 한 문장씩 나누는 중… ${Math.round(f * 100)}%`), title);
    return { sentences: sentences.length ? sentences : dropRepeats(VT.buildSentences(results, dur)), duration: dur, fixed: sentences.length > 0 };
  }


  /* 선생님·학생이 번갈아 말하는 줄은 각각 따로, 한 문장씩(운영자 지시 2026-11-03):
     ① 받아쓴 조각 글(문장부호가 있는 segment)을 단어 시간에 맞춰 단어마다 시간을 붙여요(빠지는 단어 없이).
     ② 약 100단어씩 더 똑똑한 AI(깊게 생각하기)(/api/admin-lesson-turns)가 말하는 사람이 바뀌는 곳·문장 끝에서 나누고 잘못 들린 단어를 고쳐요.
        AI가 단어를 빼먹은 줄은 받아쓴 글 그대로 써요.
     ③ 어느 줄이든 . ? ! 뒤에 이어지는 문장은 다음 문장으로 내려요(한 줄 = 한 사람의 한 문장).
     AI 답이 이상한 묶음은 문장부호·1.2초 넘게 쉬는 곳에서 나눠요. */
  const capFirst = t => t.charAt(0).toUpperCase() + t.slice(1);
  const HANGUL = /[\u3131-\u318E\uAC00-\uD7A3]/;
  const normW = t => String(t || '').toLowerCase().replace(/[^a-z0-9']/g, '');
  const endsSent = t => /[.?!]["')\]]*$/.test(t);
  // ① 조각 글의 단어 ↔ 받아쓴 단어 시간 맞추기(같은 단어끼리 순서대로 짝짓고, 짝이 없는 단어는 앞뒤 사이에 고르게)
  function lessonTokens(results) {
    const out = [];
    for (const r of results) {
      const raw = (r.words || []).filter(w => w && w.w).map(w => ({ n: normW(w.w), s: w.s, e: w.e }));
      let used = 0;
      for (const seg of r.segments || []) {
        const toks = String(seg.text || '').split(/\s+/).filter(Boolean);
        if (!toks.length) continue;
        let a = used; while (a < raw.length && raw[a].e < seg.s - 0.3) a++;
        let b = a; while (b < raw.length && raw[b].s <= seg.e + 0.3) b++;
        const rw = raw.slice(a, b); used = b;
        const T = toks.map(normW), n = T.length, m = rw.length;
        const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
        for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = T[i] && T[i] === rw[j].n ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        const times = new Array(n).fill(null);
        for (let i = 0, j = 0; i < n && j < m;) {
          if (T[i] && T[i] === rw[j].n) { times[i] = { s: rw[j].s, e: rw[j].e }; i++; j++; }
          else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
        }
        // 영상과 문장이 어긋나지 않게: 받아쓰기가 준 단어 시간이 이상하면(0.03초도 안 되는 단어 · 뒤로 가는 시간 · 조각 밖)
        // 그 시간은 버리고, 조각 전체가 너무 빠르면(단어당 0.08초 미만) 조각 시간 안에 고르게 나눠요
        let last = seg.s - 1;
        for (let k = 0; k < n; k++) {
          const t = times[k]; if (!t) continue;
          if (t.e - t.s < 0.03 || t.s < last - 0.05 || t.s < seg.s - 1 || t.e > seg.e + 1) times[k] = null; else last = t.e;
        }
        const got = times.filter(Boolean);
        if (got.length > 1 && (got[got.length - 1].e - got[0].s) / got.length < 0.08) times.fill(null);
        for (let k = 0; k < n;) {
          if (times[k]) { k++; continue; }
          let q = k; while (q < n && !times[q]) q++;
          const from = k > 0 ? times[k - 1].e : seg.s, to = q < n ? times[q].s : seg.e;
          const step = Math.max(0.05, (to - from) / (q - k));
          for (let z = k; z < q; z++) times[z] = { s: from + step * (z - k), e: from + step * (z - k + 1) };
          k = q;
        }
        toks.forEach((w, k) => out.push({ w, s: times[k].s + r.offset, e: Math.max(times[k].e, times[k].s + 0.05) + r.offset }));
      }
    }
    return out.sort((x, y) => x.s - y.s);
  }
  // ③ 한 줄(단어들 + 글) → . ? ! 마다 한 문장씩. 문장 시간은 단어 수 비율로 그 줄의 단어 경계에서 잘라요
  function toSentences(toks, text) {
    // 한글 단어도 한 단어로 세요(시간이 밀리지 않게) — 한글 줄은 나중에 빼요
    const nW = p => p.split(/\s+/).filter(Boolean).length;
    const parts = String(text).split(/(?<=[.?!]["')\]]*)\s+/).map(p => p.trim()).filter(p => nW(p));
    if (!parts.length) return [];
    const counts = parts.map(nW), total = counts.reduce((x, c) => x + c, 0);
    const out = [];
    let acc = 0, idx = 0;
    parts.forEach((p, i) => {
      acc += counts[i];
      const left = parts.length - 1 - i;
      const end = i === parts.length - 1 ? toks.length : Math.max(idx + 1, Math.min(toks.length - left, Math.round(acc / total * toks.length)));
      if (idx >= toks.length) return;
      const en = capFirst(p) + (endsSent(p) ? '' : '.');
      out.push({ s: +toks[idx].s.toFixed(2), e: +toks[Math.max(idx, end - 1)].e.toFixed(2), en });
      idx = end;
    });
    return out;
  }
  /* 문장 조각 합치기(운영자 지시 2026-11-03): 말이 잠깐 끊겨 「Are.」 + 「You ready?」처럼 나뉜 조각은 다음 문장과 한 문장으로.
     조각 = 한 단어뿐인 의문사·조동사(Are. Do. What.) 이거나, 문장이 끝날 수 없는 단어(the · a · to · for · and · my …)로 끝난 줄.
     같은 사람이 1.5초 안에 이어서 말한 다음 줄과만 합쳐요(선생님·학생 말은 붙이지 않아요). */
  const LEAD_ONLY = /^(are|is|am|was|were|do|does|did|can|could|will|would|should|have|has|what|where|when|why|who|how|which|so|and|but|because|if|then|let's|let)$/;
  const NO_END = /^(the|a|an|to|for|of|in|on|at|with|from|by|about|into|and|but|or|because|so|if|my|your|his|her|our|their|its|this|that's|i|we|they|he|she|very|really|some|any|more)$/;
  function isFragment(en) {
    const w = wordsOf(en);
    if (!w.length) return false;
    if (/\?\s*$/.test(en) && w.length > 1) return false;
    return (w.length === 1 && LEAD_ONLY.test(w[0])) || NO_END.test(w[w.length - 1]);
  }
  // 같은 문장이 두 번 넘게 나오면 처음 한 문장만 남기고 나머지는 빼요(운영자 지시 2026-11-03) — 문장부호·대소문자는 무시하고 비교
  const sentKey = t => String(t || '').toLowerCase().split(/\s+/).map(normW).filter(Boolean).join(' ');
  // 한국어를 영어 글자로 받아쓴 줄(ne · aniyo · geurae …)도 한국어로 한 말이라 빼요(운영자 지시 2026-11-03)
  const ROMAN_KO = /^(ne|nae|ye|aniyo|anio|ani|geurae|geuraeseo|geureom|geureomyeon|geunde|geuchi|mwo|mwoya|mwoyo|majayo|maja|majeo|eotteoke|eottae|jeongmal|jinjja|arasseo|arasseoyo|algesseoyo|molla|mollayo|gamsahamnida|gomawo|gomapseumnida|annyeong|annyeonghaseyo|juseyo|isseoyo|eopseoyo|haseyo|haeyo|jom|igeo|jeogeo|geugeo|seonsaengnim|ssaem|mianhae|joesonghamnida|gwaenchana|gwaenchanayo|daebak|hana|dul|daeum|dasi|ppalli|jalhaesseoyo|eung|eo)$/;
  function romanKorean(en) { const w = wordsOf(en); return w.length > 0 && w.filter(x => ROMAN_KO.test(x)).length / w.length >= 0.6; }
  // 영상과 문장 시간 맞추기: 말한 단어 수에 비해 너무 짧은 문장(단어당 0.18초 미만)은 다음 문장이 시작하기 전까지 늘려요
  function fitTimes(list) {
    const out = list.slice().sort((a, b) => a.s - b.s);
    out.forEach((x, i) => {
      const need = Math.max(0.5, 0.18 * wordsOf(x.en).length), next = out[i + 1];
      if (x.e - x.s >= need) return;
      x.e = +Math.max(x.e, Math.min(x.s + need, next && next.s > x.s + 0.2 ? next.s : x.s + need)).toFixed(2);
    });
    return out;
  }
  function dropRepeats(list) {
    const seen = new Set();
    return list.filter(x => { const k = sentKey(x.en); if (!k) return true; if (seen.has(k)) return false; seen.add(k); return true; });
  }
  function joinFragments(list) {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      let cur = Object.assign({}, list[i]);
      while (isFragment(cur.en) && list[i + 1] && list[i + 1].s - cur.e <= 1.5 && (!cur.sp || !list[i + 1].sp || cur.sp === list[i + 1].sp)) {
        const nx = list[++i];
        const head = cur.en.replace(/[.,!?]+$/, ''), tail = nx.en.replace(/^(\w)/, (m, c) => (/^I\b/.test(nx.en) ? c : c.toLowerCase()));
        cur = { s: cur.s, e: nx.e, en: head + ' ' + tail, sp: cur.sp || nx.sp };
      }
      out.push(cur);
    }
    return out;
  }
  // AI 답이 없거나 이상할 때: 문장부호 · 1.2초 넘게 쉬는 곳 · 30단어에서 나눠요
  function splitByPauses(ws) {
    const out = []; let cur = [];
    ws.forEach((w, i) => {
      cur.push(w);
      const nx = ws[i + 1], gap = nx ? nx.s - w.e : 99;
      if (gap >= 1.2 || endsSent(w.w) || cur.length >= 30) { out.push(...toSentences(cur, cur.map(x => x.w).join(' '))); cur = []; }
    });
    return out;
  }
  function turnBatches(ws, size = 100) {
    const out = [];
    let i = 0;
    while (i < ws.length) {
      if (ws.length - i <= size * 1.3) { out.push(ws.slice(i)); break; }
      // 묶음 끝은 size 근처에서 문장이 끝나고 가장 길게 쉬는 곳 (문장·말 차례가 묶음 사이에 끊기지 않게)
      let cut = i + size, best = -1;
      for (let k = i + Math.floor(size * 0.7); k < Math.min(ws.length - 1, i + Math.floor(size * 1.3)); k++) {
        const g = ws[k + 1].s - ws[k].e + (endsSent(ws[k].w) ? 5 : 0);
        if (g > best) { best = g; cut = k + 1; }
      }
      out.push(ws.slice(i, cut)); i = cut;
    }
    return out;
  }
  // AI가 고친 글을 써도 되는지: 원래 단어와 60% 이상 같고, 단어를 끼워 넣거나 빼먹지 않았을 때만
  function keepsAllWords(orig, text) {
    const ow = wordsOf(orig).length, tw = wordsOf(text).length;
    if (overlap(orig, text) < 0.6 || onlyInserted(orig, text)) return false;
    if (tw >= ow) return true;
    const contractions = (String(text).match(/\b\w+'(m|re|s|ve|ll|d|t)\b/gi) || []).length; // I am → I'm 처럼 줄인 말만 허용
    return ow - tw <= contractions;
  }
  async function lessonSentences(results, onProg, title) {
    const ws = lessonTokens(results);
    if (!ws.length) return [];
    const batches = turnBatches(ws), result = new Array(batches.length);
    let done = 0;
    await pool(batches, 3, async (b, bi) => {
      const d = await askJSON(VAPI.turns, { words: b.map(w => w.w), pauses: b.map((w, k) => (b[k + 1] ? +(b[k + 1].s - w.e).toFixed(2) : 0)), title });
      const items = (d && Array.isArray(d.items) ? d.items : []).slice().sort((x, y) => x.from - y.from);
      const out = [];
      let next = 0, ok = items.length > 0;
      for (const it of items) {
        if (it.from < next || it.to >= b.length) { ok = false; break; }
        if (it.from > next) out.push(...splitByPauses(b.slice(next, it.from))); // AI가 빠뜨린 단어
        const toks = b.slice(it.from, it.to + 1), orig = toks.map(w => w.w).join(' ');
        if (it.sp === 'K') { next = it.to + 1; continue; } // 한국어로 한 말은 쉐도잉으로 만들지 않아요
        out.push(...toSentences(toks, it.text && keepsAllWords(orig, it.text) ? it.text : orig).map(x => Object.assign(x, { sp: it.sp })));
        next = it.to + 1;
      }
      if (ok && next < b.length) out.push(...splitByPauses(b.slice(next)));
      result[bi] = ok ? out : splitByPauses(b);
      done++; onProg(done / batches.length);
    });
    // 한국어로 한 말(한글이 섞인 줄)과 아주 짧은 잡음 줄(um, uh)은 빼요(운영자 지시 2026-11-03)
    const kept = result.flat().filter(x => !HANGUL.test(x.en) && wordsOf(x.en).some(w => !/^(um+|uh+|hmm+|mm+|ah+|er+)$/.test(w)));
    return fitTimes(dropRepeats(joinFragments(kept.filter(x => !romanKorean(x.en))))).map(({ s, e, en }) => ({ s, e, en }));
  }

  // 「✨ 틀린 문장은 AI가 고쳐서 만들기」와 같은 규칙: 원래 문장과 60% 미만 일치하거나 단어를 끼워 넣기만 했으면 원래 문장
  const wordsOf = t => String(t || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
  function lcs(a, b) {
    const A = wordsOf(a), B = wordsOf(b), dp = Array(B.length + 1).fill(0);
    for (let i = 1; i <= A.length; i++) { let prev = 0; for (let j = 1; j <= B.length; j++) { const t = dp[j]; dp[j] = A[i - 1] === B[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]); prev = t; } }
    return { n: dp[B.length], a: A.length, b: B.length };
  }
  const overlap = (a, b) => { const r = lcs(a, b); return r.a ? r.n / Math.max(r.a, r.b) : 1; };
  const onlyInserted = (a, b) => { const r = lcs(a, b); return r.n === r.a && r.b > r.a; };
  async function pool(items, n, fn) {
    let next = 0;
    async function worker() { while (next < items.length) { const k = next++; await fn(items[k], k); } }
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  }
  async function askJSON(url, body) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      check();
      try {
        const r = await fetch(url, { method: 'POST', signal: ctl.signal, headers: Object.assign({ 'Content-Type': 'application/json' }, auth()), body: JSON.stringify(body) });
        const d = await r.json().catch(() => ({}));
        if (r.ok) return d;
        if (r.status === 401) throw Object.assign(new Error('세션이 만료됐어요. 다시 로그인해주세요.'), { fatal: true });
        await sleep(r.status === 429 ? Math.min(30, d.retryAfter || 10) * 1000 : 1500 * attempt);
      } catch (e) { if (e.fatal) throw e; if (cancelled || e.name === 'AbortError') throw new Cancelled(); await sleep(1500 * attempt); }
    }
    return null;
  }
  async function fixSentences(sents, onProg, title) {
    const B = 25, batches = [];
    for (let i = 0; i < sents.length; i += B) batches.push(sents.slice(i, i + B));
    const result = new Array(batches.length);
    let done = 0;
    await pool(batches, 3, async (batch, bi) => {
      const d = await askJSON(VAPI.fix, { sentences: batch.map(x => x.en), title, first: false });
      const lines = d && Array.isArray(d.lines) ? d.lines : null;
      const out = [];
      batch.forEach((x, k) => {
        const pieces = (lines && Array.isArray(lines[k]) ? lines[k] : [x.en]).map(t => String(t || '').trim()).filter(Boolean);
        const joined = pieces.join(' ');
        if (!pieces.length || joined === x.en || overlap(x.en, joined) < 0.6 || onlyInserted(x.en, joined)) { out.push(x); return; }
        const counts = pieces.map(p => Math.max(1, wordsOf(p).length));
        const total = counts.reduce((a, c) => a + c, 0);
        let t = x.s;
        pieces.forEach((p, i) => {
          const e = i === pieces.length - 1 ? x.e : +(t + (x.e - x.s) * counts[i] / total).toFixed(2);
          out.push(Object.assign({}, x, { s: +t.toFixed(2), e: +Math.max(e, t + 0.4).toFixed(2), en: p, ko: '' }));
          t = e;
        });
      });
      result[bi] = out;
      done += batch.length; onProg(Math.min(0.99, done / sents.length));
    });
    onProg(1);
    return result.flat();
  }
  async function translateAll(sents, title, onProg) {
    const todo = sents.filter(x => !x.ko && x.en), B = 30, batches = [];
    for (let i = 0; i < todo.length; i += B) batches.push(todo.slice(i, i + B));
    let done = 0;
    await pool(batches, 3, async batch => {
      const d = await askJSON(VAPI.translate, { sentences: batch.map(x => x.en), title });
      if (d && Array.isArray(d.ko)) batch.forEach((x, k) => { if (d.ko[k]) x.ko = d.ko[k]; });
      done += batch.length; onProg(Math.min(0.95, done / Math.max(1, todo.length)));
    });
    for (const x of todo.filter(y => !y.ko)) { check(); x.ko = (await VT.translate(x.en)) || ''; await sleep(150); }
    onProg(1);
  }

  /* ================= 🎥 수업영상쉐도잉 만들기 (학생을 고르면 그 학생의 수업 녹화로) ================= */
  let lvmFound = [];
  function renderLvmMembers() {
    const sel = $('lvmMember'), cur = sel.value;
    sel.innerHTML = '<option value="">-- 학생을 선택하세요 --</option>' + (typeof membersCache !== 'undefined' ? membersCache : []).map(m => `<option value="${esc(m.username)}">${esc(memberLabel(m.username))}</option>`).join('');
    sel.value = cur;
  }
  const lvmNvoimIds = u => {
    const ids = (data.students || []).filter(s => s.username === u).map(s => s.nvoimId);
    return ids.length ? ids : (u ? [u] : []);
  };
  function renderLvm() {
    const u = $('lvmMember').value, box = $('lvmFound');
    if (!u) { box.innerHTML = ''; return; }
    if (!lvmFound.length) { box.innerHTML = ''; return; }
    box.innerHTML = lvmFound.map((x, i) => `
      <div class="set-item set-stack">
        <div>
          <div class="title">${esc(x.date || '날짜 모름')} 수업 녹화 ${x.done ? '<span class="pill">✅ 만든 영상</span>' : x.saved ? '<span class="pill">💾 저장한 녹화</span>' : '<span class="pill">🆕 새 녹화</span>'}</div>
          <div class="meta">${esc(x.label || '')} · ${esc(x.url)}</div>
        </div>
        <div class="set-btns">${x.done ? `<button class="btn-primary btn-small" data-lvmplay="${esc(x.done.lessonId)}" data-title="${esc(x.date || '')} 수업 녹화">▶ 위에서 연습</button>` : ''}${x.kind !== 'hls' ? `<button class="btn-primary btn-small" data-lvm="${i}">${x.done ? '🔁 다시 만들기' : '🎬 쉐도잉 만들기'}</button>` : ''}</div>
      </div>`).join('');
  }
  async function loadLvmRecords() {
    const u = $('lvmMember').value, box = $('lvmMine');
    if (!u) { box.innerHTML = ''; return; }
    try {
      const { recordings } = await apiFetch(`${API}?records=${encodeURIComponent(u)}`);
      box.innerHTML = recordings.length ? recordings.map(v => `
        <div class="set-item set-stack">
          <div><div class="title">${esc(v.title)}</div><div class="meta">${v.date ? `📅 수업일 ${esc(v.date)} · ` : ''}문장 ${v.sentenceCount}개${v.assigned ? '' : ' · <span style="color:var(--bad)">학생에게 안 넣어 줌</span>'}</div></div>
          <div class="set-btns"><button class="btn-primary btn-small" data-lvmplay="${esc(v.id)}" data-title="${esc(v.title)}">▶ 위에서 연습</button><a class="btn-ghost btn-small" style="text-decoration:none; border-radius:10px; font-weight:700;" href="video.html?id=${encodeURIComponent(v.id)}&admin=1" target="_blank" rel="noopener">↗ 새 창</a></div>
        </div>`).join('') : '<div class="empty">아직 이 학생의 수업영상 쉐도잉이 없어요.</div>';
    } catch (e) { box.innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`; }
  }
  $('lvmMember').addEventListener('focus', renderLvmMembers);
  $('lvmMember').addEventListener('change', async () => {
    const u = $('lvmMember').value;
    lvmFound = []; renderLvm(); loadLvmRecords();
    $('lvmPlayerFrame').src = 'about:blank'; $('lvmPlayer').classList.add('hidden');
    if (!u) { setStatus('lvmFindStatus', ''); return; }
    if (!data.accounts.length) await load();
    const ids = lvmNvoimIds(u);
    // 🎥 수업영상 자동 가져오기에서 「💾 저장」한 녹화를 먼저 보여 줘요
    try { lvmFound = (await apiFetch(`${API}?saved=${encodeURIComponent(u)}`)).recordings || []; } catch (e) {}
    if ($('lvmMember').value !== u) return;
    renderLvm();
    setStatus('lvmFindStatus', `${lvmFound.length ? `💾 저장한 녹화 ${lvmFound.length}개 · ` : ''}🔍 엔보임에서 ${memberLabel(u)} 학생의 수업 녹화를 찾는 중…`);
    const errors = [];
    for (const id of ids) {
      try { const r = await scanOne(id, u); r.recordings.filter(x => x.kind !== 'page' && !lvmFound.some(f => f.key === x.key || f.url === x.url)).forEach(x => lvmFound.push(x)); }
      catch (e) { errors.push(e.message); }
    }
    if ($('lvmMember').value !== u) return;
    renderLvm();
    setStatus('lvmFindStatus', lvmFound.length
      ? `✅ 엔보임 수업 녹화 ${lvmFound.length}개를 찾았어요. 「🎬 쉐도잉 만들기」를 누르세요.`
      : `⚠️ 엔보임에서 이 학생의 수업 녹화를 아직 찾지 못했어요${errors.length ? ' (' + errors[0] + ')' : ''}. 아래 「📁 녹화 파일로 만들기」로 녹화 파일을 올려 주세요.`, lvmFound.length ? 'success' : 'error');
  });
  // ▶ 위에서 연습: 카드 맨 위에서 수업영상이 재생되며 쉐도잉 연습(학생과 같은 연습 화면)
  function openPlayer(p, id, title) {
    if (!$(p + 'Player')) return;
    const src = `video.html?id=${encodeURIComponent(id)}&admin=1&lesson=1`;
    $(p + 'PlayerTitle').textContent = '▶ ' + (title || '수업영상 쉐도잉 연습');
    $(p + 'PlayerNew').href = src;
    $(p + 'PlayerFrame').src = src;
    $(p + 'Player').classList.remove('hidden');
    try { $(p + 'Player').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
  }
  const openLvmPlayer = (id, title) => openPlayer('lvm', id, title);
  ['lvm', 'nvv'].forEach(p => $(p + 'PlayerClose').addEventListener('click', () => { $(p + 'PlayerFrame').src = 'about:blank'; $(p + 'Player').classList.add('hidden'); }));
  $('lvMakeCard').addEventListener('click', e => {
    const b = e.target.closest('[data-lvmplay]'); if (!b) return;
    openLvmPlayer(b.dataset.lvmplay, b.dataset.title);
  });
  $('lvmFound').addEventListener('click', e => {
    const b = e.target.closest('[data-lvm]'); if (!b) return;
    makeMany([lvmFound[Number(b.dataset.lvm)]], 'lvm');
  });
  $('lvmFileBtn').addEventListener('click', () => {
    const u = $('lvmMember').value, file = $('lvmFile').files[0];
    if (!u) { setStatus('lvmStatus', '⚠️ 먼저 학생을 선택해 주세요.', 'error'); return; }
    if (!file) { setStatus('lvmStatus', '⚠️ 수업 녹화 파일을 골라 주세요.', 'error'); return; }
    if (!/^(video|audio)\//.test(file.type || 'video/mp4')) { setStatus('lvmStatus', '⚠️ 영상 또는 음성 파일만 올릴 수 있어요.', 'error'); return; }
    if (file.size > 1024 * 1024 * 1024) { setStatus('lvmStatus', '⚠️ 1GB 이하 파일만 올릴 수 있어요.', 'error'); return; }
    makeMany([{ file, kind: 'file', url: '', date: $('lvmDate').value || '', studentId: lvmNvoimIds(u)[0] || '', username: u, label: file.name }], 'lvm');
  });
  $('lvmCancelBtn').addEventListener('click', () => {
    if (!busy || !confirm('만들기를 중지할까요? 만들던 영상은 지워요.')) return;
    cancelled = true; try { ctl && ctl.abort(); } catch (e) {}
    setStatus('lvmStatus', '⏹ 중지하는 중…');
  });
  try { $('lvmDate').value = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); } catch (e) {}

  window.addEventListener('beforeunload', e => { if (busy) { e.preventDefault(); e.returnValue = ''; } });

  // 메뉴를 누르거나 이 화면으로 열었을 때 불러와요
  document.getElementById('adminMenu').addEventListener('click', e => {
    const t = e.target.closest('[data-go="nvvideo"], [data-go="lvmake"]');
    if (t && getToken()) { load(); renderLvmMembers(); }
  });
  if (getToken() && (location.hash === '#nvvideo' || location.hash === '#lvmake')) { load(); setTimeout(renderLvmMembers, 1500); }
})();

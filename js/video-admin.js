/* 관리자 페이지 — 🎬 영상 쉐도잉 카드
 *  🔗 YouTube 링크: 링크만 붙여넣으면 → 영어 자막 가져오기 → 문장 정리 → 번역 → 파트 나누기 → 저장 (영상은 YouTube로 재생)
 *                   자막을 못 가져오면 YouTube의 「스크립트 표시」를 복사해 붙여넣는 방법으로 이어서 만듭니다.
 *  📁 파일 올리기:  영상을 3.5MB 조각으로 올리면서, 브라우저에서 소리를 뽑아 Whisper로 받아쓰기
 * admin.html의 getToken()/apiFetch()를 사용합니다.
 */
(function () {
  const VT = window.VideoTranscript;
  const $ = id => document.getElementById(id);
  const VAPI = { videos: '/api/admin-videos', transcribe: '/api/admin-transcribe', youtube: '/api/admin-youtube', punctuate: '/api/admin-punctuate', translate: '/api/admin-translate' };
  const CHUNK = 3.5 * 1024 * 1024;
  const VIS_LABEL = { draft: '🔒 비공개(임시)', members: '👥 회원 공개', public: '🌐 전체 공개' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  /* ---- 자동 만들기 일시정지 · 중지 ----
   * job.paused  : 다음 단계로 넘어가기 전에 멈춰 기다림 (▶ 계속을 누르면 이어서)
   * job.cancelled: 진행 중인 요청까지 끊고 중지 */
  let job = null;
  class Cancelled extends Error { constructor() { super('중지했어요.'); this.cancelled = true; } }
  const isCancelled = e => (e && (e.cancelled || e.name === 'AbortError')) || (job && job.cancelled);
  const sig = () => (job ? job.ctl.signal : undefined);
  // 기다리는 중에도 중지하면 바로 깨어나도록
  const sleep = ms => new Promise(r => {
    const t = setTimeout(r, ms);
    if (job) job.ctl.signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true });
  });
  async function checkpoint() {
    if (!job) return;
    if (job.cancelled) throw new Cancelled();
    while (job && job.paused) {
      await new Promise(r => { job.wake = r; });
      if (job && job.cancelled) throw new Cancelled();
    }
  }

  let lessons = [];
  let editing = null;
  let busy = false;
  let src = 'youtube';

  function setStatus(msg, cls = '') { const el = $('vidStatus'); el.textContent = msg; el.className = 'status ' + cls; }
  function setBar(which, frac, label) {
    $(which + 'Bar').style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
    if (label != null) $(which + 'Label').textContent = label;
  }
  function fmtSize(b) { return b > 1e9 ? (b / 1e9).toFixed(2) + 'GB' : (b / 1e6).toFixed(1) + 'MB'; }

  /* ---------------- 자막 종류 ----------------
   *  human : 사람이 만든 자막(문장부호가 제대로 있음) → 그대로 사용
   *  auto  : YouTube 자동 자막(문장부호 없음·이름 오인식) → AI로 문장부호를 붙여 나눔, 검토 필요
   *  ai    : 영어 자막이 없어 AI가 음성을 받아씀
   * Supadata는 어떤 자막인지 알려주지 않아서, 문장부호가 있는지로 판단합니다. */
  function captionKind(track, punctuated) {
    const k = (track && track.kind) || '';
    if (k === 'ai') return 'ai';
    if (k === 'manual' || k === 'human') return 'human';
    if (k === 'auto') return 'auto';
    return punctuated ? 'human' : 'auto';
  }
  const CAPTION_INFO = {
    human: { tag: '✅ 사람 자막', note: '✅ 사람이 만든 자막(문장부호 있음)을 그대로 사용했어요.' },
    auto: { tag: '⚠️ 자동 자막', note: '⚠️ YouTube 자동 자막이라 AI로 문장부호를 붙여 문장을 나눴어요. 이름·문장 나눔을 한 번 확인해 주세요.\n   이 영상에 사람이 만든 자막이 있다면, 편집 화면의 「📋 스크립트 붙여넣어 다시 만들기」로 더 정확하게 만들 수 있어요.' },
    ai: { tag: '🤖 AI 받아쓰기', note: '🤖 이 영상에는 영어 자막이 없어 AI가 음성을 듣고 받아썼어요. 이름·문장을 한 번 확인해 주세요.' },
  };
  const captionNote = k => (CAPTION_INFO[k] ? '\n' + CAPTION_INFO[k].note : '');

  /* ---------------- 탭 ---------------- */
  $('srcTabs').addEventListener('click', e => {
    const b = e.target.closest('[data-src]'); if (!b || busy) return;
    src = b.dataset.src;
    $('srcTabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    $('srcYoutube').classList.toggle('hidden', src !== 'youtube');
    $('srcFile').classList.toggle('hidden', src !== 'file');
    setStatus('');
  });

  /* ---------------- 목록 ---------------- */
  async function loadLessons() {
    try {
      const d = await apiFetch(VAPI.videos);
      lessons = d.lessons || [];
      renderLessons();
    } catch (e) { $('vidList').innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`; }
  }
  function lessonLen(v) { return (v.clipEnd || v.duration || 0) - (v.clipStart || 0); }
  function renderLessons() {
    const box = $('vidList');
    if (!lessons.length) { box.innerHTML = '<div class="empty">아직 만든 영상 쉐도잉이 없어요.</div>'; return; }
    box.innerHTML = lessons.map(v => `
      <div class="set-item set-stack">
        <div>
          <div class="title">${v.level === 'kids' ? '<span class="lv-badge kids">👶 유아</span>' : v.level ? `<span class="lv-badge">Lv ${esc(v.level)}</span>` : '<span class="lv-badge none">레벨 없음</span>'}${v.youtubeId ? '🔗 ' : '📁 '}${esc(v.title)}</div>
          ${v.watchOnly ? `<div class="meta">📺 영상만 보기 (쉐도잉 없음)${v.clipStart || v.clipEnd ? ` · 구간 ${VT.fmt(v.clipStart)}~${v.clipEnd ? VT.fmt(v.clipEnd) : '끝'}` : ''} · ${v.youtubeId ? 'YouTube' : fmtSize(v.size)} ·
            ${v.status === 'ready' ? VIS_LABEL[v.visibility] : '<b style="color:var(--bad)">⚠️ 업로드 미완료</b>'} · ${new Date(v.createdAt).toLocaleDateString('ko-KR')}</div>` : `
          <div class="meta">${VT.fmt(lessonLen(v))}${v.clipStart || v.clipEnd ? ` (${VT.fmt(v.clipStart)}~${VT.fmt(v.clipEnd || v.duration)})` : ''} · 문장 ${v.sentenceCount}개 ·
            ${v.youtubeId ? 'YouTube' + (CAPTION_INFO[v.caption] ? ` (${CAPTION_INFO[v.caption].tag})` : '') : fmtSize(v.size)} · ${v.partMinutes ? v.partMinutes + '분 단위' : '나누지 않음'} ·
            ${v.status === 'ready' ? VIS_LABEL[v.visibility] : '<b style="color:var(--bad)">⚠️ 업로드 미완료</b>'}
            · ${new Date(v.createdAt).toLocaleDateString('ko-KR')}</div>`}
        </div>
        <div class="set-btns">
          ${v.status === 'ready' ? `<button class="btn-ghost btn-small" data-vact="edit" data-id="${v.id}">${v.watchOnly ? '✏️ 정보 수정' : '✏️ 문장 편집'}</button>
          <a class="btn-ghost btn-small" style="text-decoration:none; border-radius:10px; font-weight:700;" href="video.html?id=${v.id}&admin=1" target="_blank" rel="noopener">${v.watchOnly ? '▶ 보기 화면' : '▶ 연습 화면'}</a>` : ''}
          <button class="btn-danger btn-small" data-vact="del" data-id="${v.id}">삭제</button>
        </div>
      </div>`).join('');
  }
  $('vidList').addEventListener('click', async e => {
    const b = e.target.closest('[data-vact]'); if (!b) return;
    const v = lessons.find(x => x.id === b.dataset.id); if (!v) return;
    if (b.dataset.vact === 'del') {
      if (!confirm(`"${v.title}" 쉐도잉을 삭제할까요? 되돌릴 수 없어요.`)) return;
      b.disabled = true;
      try { await apiFetch(VAPI.videos, { method: 'POST', body: JSON.stringify({ action: 'delete', id: v.id }) }); if (editing && editing.id === v.id) closeEditor(); loadLessons(); }
      catch (err) { alert(err.message); b.disabled = false; }
    }
    if (b.dataset.vact === 'edit') {
      b.disabled = true;
      try {
        const d = await apiFetch(VAPI.videos + '?id=' + encodeURIComponent(v.id));
        openEditor(Object.assign({}, d.lesson, { src: d.streamUrl }));
      } catch (err) { alert(err.message); }
      b.disabled = false;
    }
  });

  /* ---------------- 공통: AI 문장부호 복원 ---------------- */
  let punctTitle = ''; // 영상 제목 — AI가 잘못 들린 이름(예: Louis → Bluey)을 고칠 때 참고
  async function askPunctuate(text) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      await checkpoint();
      const r = await fetch(VAPI.punctuate, { method: 'POST', signal: sig(), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() }, body: JSON.stringify({ text, title: punctTitle }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.text) return d.text;
      if (r.status === 401) throw new Error('세션이 만료됐어요. 다시 로그인해주세요.');
      await sleep(r.status === 429 ? Math.min(30, d.retryAfter || 10) * 1000 : 2000 * attempt);
    }
    return null;
  }
  // 문장부호가 없는 자막이면 AI로 복원 → 문장 끝에서만 나누기
  async function smartSentences(words, endTime, punctuated, onProg, title) {
    let pauseCut = false;
    if (!punctuated) {
      punctTitle = title || '';
      const r = await VT.restorePunctuation(words, askPunctuate, onProg);
      words = r.words; punctuated = r.ok; pauseCut = r.ok;
    }
    return VT.wordsToSentences(words, endTime, punctuated, { pauseCut });
  }

  /* ---------------- 공통: 번역 ---------------- */
  // 번역: ① 서버(Groq AI)에서 30문장씩 문맥과 함께 번역 → ② 그래도 빈 문장만 구글 번역으로 천천히 다시 시도
  //       돌려주는 값 = 끝내 번역하지 못한 문장 수
  const trTitle = () => (editing && $('vedTitle').value) || $('vidTitle').value || punctTitle || '';
  async function translateAll(sents, onProg) {
    const todo = sents.filter(x => !x.ko && x.en);
    if (!todo.length) { onProg && onProg(1); return 0; }
    const B = 30;
    let done = 0;
    for (let i = 0; i < todo.length; i += B) {
      const batch = todo.slice(i, i + B);
      for (let attempt = 1; attempt <= 3; attempt++) {
        await checkpoint();
        try {
          const r = await fetch(VAPI.translate, { method: 'POST', signal: sig(), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
            body: JSON.stringify({ sentences: batch.map(x => x.en), title: trTitle() }) });
          const d = await r.json().catch(() => ({}));
          if (r.ok && Array.isArray(d.ko)) { batch.forEach((x, k) => { if (d.ko[k]) x.ko = d.ko[k]; }); break; }
          if (r.status === 401) throw new Error('세션이 만료됐어요. 다시 로그인해주세요.');
          await sleep(r.status === 429 ? Math.min(30, d.retryAfter || 10) * 1000 : 1500 * attempt);
        } catch (e) { if (/세션/.test(e.message)) throw e; if (isCancelled(e)) throw new Cancelled(); await sleep(1500 * attempt); }
      }
      done += batch.length; onProg && onProg(Math.min(0.95, done / todo.length));
    }
    // 서버 번역에서 빠진 문장 → 구글 번역 (한꺼번에 몰리지 않게 2개씩)
    const left = todo.filter(x => !x.ko);
    let j = 0;
    async function worker() { while (j < left.length) { await checkpoint(); const x = left[j++]; x.ko = (await VT.translate(x.en)) || ''; await sleep(150); } }
    await Promise.all([worker(), worker()]);
    onProg && onProg(1);
    return todo.filter(x => !x.ko).length;
  }
  function trWarn(n) { return n ? `\n⚠️ ${n}문장은 번역하지 못했어요. 편집 화면의 「🌐 빈 번역 채우기」를 다시 눌러 주세요.` : ''; }

  function startBusy(showUpload, trTitle) {
    job = { paused: false, cancelled: false, ctl: new AbortController(), wake: null };
    $('vidJobBtns').classList.remove('hidden');
    $('vidPauseBtn').textContent = '⏸ 일시정지'; $('vidPauseBtn').disabled = false; $('vidCancelBtn').disabled = false;
    busy = true; $('vidStartBtn').disabled = true; $('vidProgress').classList.remove('hidden');
    $('vidUpRow').classList.toggle('hidden', !showUpload);
    $('vidTrTitle').textContent = trTitle;
    setBar('vidUp', 0, '대기 중'); setBar('vidTr', 0, '대기 중');
  }
  function endBusy() {
    busy = false; $('vidStartBtn').disabled = false;
    job = null; $('vidJobBtns').classList.add('hidden'); $('vidProgress').classList.remove('paused');
  }
  let statusBeforePause = null;
  $('vidPauseBtn').addEventListener('click', () => {
    if (!job || job.cancelled) return;
    job.paused = !job.paused;
    $('vidPauseBtn').textContent = job.paused ? '▶ 계속' : '⏸ 일시정지';
    $('vidProgress').classList.toggle('paused', job.paused);
    if (job.paused) {
      statusBeforePause = [$('vidStatus').textContent, $('vidStatus').className];
      setStatus('⏸ 일시정지했어요. 지금 하던 요청 하나는 마저 끝나고 멈춰요. ▶ 계속을 누르면 이어서 진행해요.');
    } else {
      if (statusBeforePause) { $('vidStatus').textContent = statusBeforePause[0]; $('vidStatus').className = statusBeforePause[1]; }
      if (job.wake) { const w = job.wake; job.wake = null; w(); }
    }
  });
  $('vidCancelBtn').addEventListener('click', () => {
    if (!job || job.cancelled) return;
    if (!confirm('자동 만들기를 중지할까요? 지금까지 한 작업은 저장되지 않아요.')) return;
    job.cancelled = true; job.paused = false;
    $('vidPauseBtn').disabled = true; $('vidCancelBtn').disabled = true;
    setStatus('⏹ 중지하는 중…');
    try { job.ctl.abort(); } catch (e) {}
    if (job.wake) { const w = job.wake; job.wake = null; w(); }
  });

  $('vidStartBtn').addEventListener('click', () => { if (!busy) (src === 'youtube' ? startYoutube() : startFile()); });

  /* 👶 유아 레벨: 쉐도잉 없이 영상만 올리기 */
  const isKids = () => $('vidLevel').value === 'kids';
  function syncKidsUI() {
    const k = isKids();
    $('vidKidsNote').classList.toggle('hidden', !k);
    $('vidParts').closest('.field').classList.toggle('hidden', k);
    $('vidTranslateRow').classList.toggle('hidden', k);
    if (k) $('ytPasteBox').classList.add('hidden');
    $('vidStartBtn').textContent = k ? '📺 유아 영상 올리기' : '🚀 쉐도잉 자동으로 만들기';
  }
  $('vidLevel').addEventListener('change', syncKidsUI);
  syncKidsUI();

  async function startYoutubeKids(videoId, clipStart, clipEndIn) {
    startBusy(false, '② 영상 확인 · 저장');
    try {
      setStatus('YouTube 영상을 확인하는 중…');
      setBar('vidTr', 0.3, '영상 정보 확인 중…');
      const r = await fetch(VAPI.youtube, { method: 'POST', signal: sig(), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() }, body: JSON.stringify({ url: videoId, infoOnly: true }) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) { clearToken(); showLogin(); throw new Error('세션이 만료됐어요. 다시 로그인해주세요.'); }
      if (!r.ok) throw new Error(d.message || d.error || ('HTTP ' + r.status));
      await checkpoint();
      setBar('vidTr', 0.8, '저장 중…');
      const lesson = (await apiFetch(VAPI.videos, { method: 'POST', body: JSON.stringify({
        action: 'create_youtube', youtubeId: videoId, title: $('vidTitle').value.trim() || d.title, duration: 0,
        clipStart, clipEnd: clipEndIn || 0, watchOnly: true, visibility: $('vidVisibility').value, level: 'kids',
      }) })).lesson;
      setBar('vidTr', 1, '완료');
      setStatus(`✅ 완료! 👶 유아 영상 "${lesson.title}"을(를) 올렸어요. 회원 화면의 「유아」 탭에서 볼 수 있어요.`, 'success');
      $('ytUrl').value = ''; $('ytStart').value = ''; $('ytEnd').value = ''; $('vidTitle').value = '';
      await loadLessons();
    } catch (e) {
      if (isCancelled(e)) setStatus('⏹ 중지했어요. 아무것도 저장되지 않았어요.', '');
      else setStatus('⚠️ ' + e.message, 'error');
    } finally { endBusy(); }
  }

  /* ================= 🔗 YouTube 링크 ================= */
  function parseYoutubeId(s) {
    s = String(s || '').trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([\w-]{11})/);
    return m ? m[1] : null;
  }
  // 링크에 붙은 시작 시간(&t=90, ?t=1m30s)을 시작 칸에 자동으로
  function timeFromUrl(s) {
    const m = String(s).match(/[?&#]t=(?:(\d+)h)?(?:(\d+)m)?(\d+)s?\b/);
    return m ? (Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) : 0;
  }
  let lastYt = null; // 붙여넣기 대체 경로에서 다시 쓰려고 기억 { videoId, title, duration }

  $('ytUrl').addEventListener('change', () => {
    const t = timeFromUrl($('ytUrl').value);
    if (t && !$('ytStart').value) $('ytStart').value = VT.fmt(t);
    const id = parseYoutubeId($('ytUrl').value);
    if (!lastYt || lastYt.videoId !== id) { $('ytPasteBox').classList.add('hidden'); $('ytPaste').value = ''; }
  });

  // 서버에서 YouTube 영어 자막(단어별 시간) 가져오기. 자동으로 못 가져오면 { needPaste:true }
  async function fetchYoutubeCaptions(videoId, onBar) {
    onBar(0.15, '자막 찾는 중…');
    const ask = jobId => fetch(VAPI.youtube, { method: 'POST', signal: sig(), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() }, body: JSON.stringify({ url: videoId, jobId }) });
    let r = await ask();
    let d = await r.json().catch(() => ({}));
    // 자막이 없는 영상: 자막 서비스가 AI로 받아쓰는 동안 몇 초마다 다시 확인
    for (let k = 0; r.status === 202 && d.jobId && k < 90; k++) {
      onBar(0.15 + Math.min(0.3, k * 0.01), `${d.message || 'AI가 받아쓰는 중…'} (${(k + 1) * 4}초)`);
      await sleep(4000);
      await checkpoint();
      r = await ask(d.jobId);
      d = await r.json().catch(() => ({}));
    }
    if (r.status === 202) throw new Error('받아쓰기가 너무 오래 걸려요. 잠시 뒤 다시 시도해 주세요.');
    if (r.status === 401) { clearToken(); showLogin(); throw new Error('세션이 만료됐어요. 다시 로그인해주세요.'); }
    if (!r.ok) {
      if (['blocked', 'no_captions'].includes(d.error)) return Object.assign(d, { needPaste: true });
      throw new Error(d.message || d.error || ('HTTP ' + r.status));
    }
    return d;
  }

  async function startYoutube() {
    const videoId = parseYoutubeId($('ytUrl').value);
    if (!videoId) { setStatus('⚠️ YouTube 링크를 붙여넣어 주세요. (예: https://www.youtube.com/watch?v=...)', 'error'); return; }
    const clipStart = VT.parseTime($('ytStart').value), clipEndIn = VT.parseTime($('ytEnd').value);
    if (Number.isNaN(clipStart) || Number.isNaN(clipEndIn)) { setStatus('⚠️ 시작/끝 시간은 1:30 처럼 입력해주세요.', 'error'); return; }
    if (clipEndIn && clipEndIn <= clipStart) { setStatus('⚠️ 끝 시간이 시작 시간보다 뒤여야 해요.', 'error'); return; }
    if (isKids()) return startYoutubeKids(videoId, clipStart, clipEndIn);
    const pasted = $('ytPaste').value.trim();
    startBusy(false, '② 자막 가져오기 · 문장 정리');
    try {
      let words, punctuated, info, track = null;
      if (pasted && lastYt && lastYt.videoId === videoId) {
        // 붙여넣은 스크립트로 만들기
        setBar('vidTr', 0.3, '붙여넣은 스크립트 읽는 중…');
        const p = VT.parsePastedTranscript(pasted);
        if (!p.words.length) throw new Error('붙여넣은 내용에서 시간(0:00)과 대사를 찾지 못했어요. 「스크립트 표시」의 내용을 시간까지 함께 복사해 주세요.');
        words = p.words; punctuated = p.punctuated; info = lastYt; track = { lang: 'en', kind: punctuated ? 'human' : 'auto' };
      } else {
        setStatus('YouTube에서 영어 자막을 가져오는 중…');
        const d = await fetchYoutubeCaptions(videoId, (f, l) => setBar('vidTr', f, l));
        lastYt = { videoId, title: d.title || '', duration: d.duration || 0 };
        if (d.needPaste) {
          $('ytPasteBox').classList.remove('hidden');
          $('ytWhy').textContent = `(${d.message || ''}${d.attempts ? ' · ' + d.attempts.join(', ') : ''})`;
          setBar('vidTr', 0, '붙여넣기 대기');
          setStatus(`📋 "${d.title || '영상'}"의 자막을 자동으로 못 가져왔어요. 아래 안내대로 스크립트를 붙여넣고 🚀 버튼을 다시 눌러주세요.`, 'error');
          $('ytPaste').focus();
          return;
        }
        words = d.words; punctuated = d.punctuated; info = lastYt; track = d.track;
        track = { lang: (d.track && d.track.lang) || 'en', kind: captionKind(d.track, punctuated) };
        setBar('vidTr', 0.5, `${{ human: '사람이 만든 영어 자막', auto: '자동 생성 영어 자막', ai: 'AI 받아쓰기' }[track.kind]} ${words.length}단어`);
      }
      await checkpoint();
      // 구간 자르기
      const duration = info.duration || (words.length ? words[words.length - 1].e + 1 : 0);
      const clipEnd = clipEndIn && clipEndIn < duration ? clipEndIn : 0;
      const inClip = words.filter(w => w.s >= clipStart - 0.05 && (!clipEnd || w.s < clipEnd));
      if (!inClip.length) throw new Error('선택한 구간에 대사가 없어요. 시작/끝 시간을 확인해주세요.');
      let trFail = 0;
      let sentences = await smartSentences(inClip, clipEnd || duration, punctuated,
        f => setBar('vidTr', 0.5 + f * 0.1, `AI가 문장부호를 붙이는 중… ${Math.round(f * 100)}%`), $('vidTitle').value.trim() || info.title);
      sentences = sentences.filter(s => s.s >= clipStart - 0.5);
      if (clipStart) sentences.forEach(s => { s.s = Math.max(s.s, clipStart); });
      setBar('vidTr', 0.6, `문장 ${sentences.length}개로 정리`);
      await checkpoint();
      if ($('vidTranslate').checked) {
        trFail = await translateAll(sentences, f => setBar('vidTr', 0.6 + f * 0.35, `한국어 번역 중… ${Math.round(f * 100)}%`));
      }
      await checkpoint();
      setBar('vidTr', 0.97, '저장 중…');
      const lesson = (await apiFetch(VAPI.videos, { method: 'POST', body: JSON.stringify({
        action: 'create_youtube', youtubeId: videoId, title: $('vidTitle').value.trim() || info.title, duration,
        clipStart, clipEnd, sentences, partMinutes: Number($('vidParts').value), visibility: $('vidVisibility').value, track, level: $('vidLevel').value,
      }) })).lesson;
      setBar('vidTr', 1, `완료 — 문장 ${sentences.length}개`);
      setStatus(`✅ 완료! "${lesson.title}" — 문장 ${sentences.length}개로 쉐도잉을 만들었어요. 아래에서 확인·수정하세요.` + captionNote(track.kind) + trWarn(trFail), track.kind === 'human' ? 'success' : '');
      $('ytUrl').value = ''; $('ytStart').value = ''; $('ytEnd').value = ''; $('ytPaste').value = ''; $('vidTitle').value = '';
      $('ytPasteBox').classList.add('hidden');
      await loadLessons();
      openEditor(lesson);
    } catch (e) {
      if (isCancelled(e)) setStatus('⏹ 자동 만들기를 중지했어요. 아무것도 저장되지 않았어요.', '');
      else setStatus('⚠️ ' + e.message, 'error');
    } finally { endBusy(); }
  }

  /* ================= 📁 파일 올리기 ================= */
  function probeDuration(url) {
    return new Promise(res => {
      const v = document.createElement('video');
      v.preload = 'metadata'; v.muted = true; v.src = url;
      v.onloadedmetadata = () => res(isFinite(v.duration) ? v.duration : 0);
      v.onerror = () => res(0);
      setTimeout(() => res(0), 15000);
    });
  }

  async function uploadChunks(file, id, onProg) {
    const total = Math.ceil(file.size / CHUNK);
    let done = 0, next = 0;
    async function worker() {
      while (next < total) {
        await checkpoint();
        const n = next++;
        const blob = file.slice(n * CHUNK, Math.min(file.size, (n + 1) * CHUNK));
        for (let attempt = 1; ; attempt++) {
          try {
            const r = await fetch(`${VAPI.videos}?id=${id}&n=${n}`, {
              method: 'PUT', signal: sig(), headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'application/octet-stream' }, body: blob,
            });
            if (r.status === 401) throw Object.assign(new Error('세션이 만료됐어요. 다시 로그인해주세요.'), { fatal: true });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            break;
          } catch (e) {
            if (isCancelled(e)) throw new Cancelled();
            if (e.fatal || attempt >= 4) throw new Error(`영상 조각 ${n + 1}/${total} 업로드 실패: ${e.message}`);
            await sleep(1500 * attempt);
          }
        }
        done++; onProg(done / total, `${done}/${total} 조각 (${fmtSize(Math.min(file.size, done * CHUNK))} / ${fmtSize(file.size)})`);
      }
    }
    await Promise.all([worker(), worker(), worker()]);
  }

  async function transcribe(file, duration, onProg) {
    onProg(0.02, '소리 추출 중… (긴 영상은 수십 초 걸려요)');
    const { pcm, duration: aDur } = await VT.extractAudio(file);
    const pieces = VT.splitAudio(pcm, 100);
    const results = [];
    let prompt = '';
    for (let i = 0; i < pieces.length; i++) {
      await checkpoint();
      onProg((i + 0.3) / pieces.length, `받아쓰는 중… ${i + 1}/${pieces.length} (${VT.fmt(pieces[i].offset)}~)`);
      const wav = VT.encodeWav(pieces[i].pcm);
      let data;
      for (let attempt = 1; ; attempt++) {
        const r = await fetch(VAPI.transcribe + '?prompt=' + encodeURIComponent(prompt), {
          method: 'POST', signal: sig(), headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'audio/wav' }, body: wav,
        });
        let d = null; try { d = await r.json(); } catch (e) {}
        if (r.ok) { data = d; break; }
        if (r.status === 401) throw new Error('세션이 만료됐어요. 다시 로그인해주세요.');
        if (attempt >= 6) throw new Error('받아쓰기 실패: ' + ((d && (d.detail || d.error)) || r.status));
        const wait = r.status === 429 ? Math.min(65, (d && d.retryAfter) || 20) : 3 * attempt;
        onProg((i + 0.3) / pieces.length, `음성 인식 사용량 한도 — ${wait}초 기다렸다 계속해요… (${i + 1}/${pieces.length})`);
        await sleep(wait * 1000);
        await checkpoint();
      }
      results.push({ offset: pieces[i].offset, segments: data.segments || [], words: data.words || [] });
      prompt = (data.segments || []).slice(-2).map(s => s.text).join(' ').slice(-300);
    }
    return { sentences: VT.buildSentences(results, duration || aDur), duration: duration || aDur };
  }

  async function startFile() {
    const file = $('vidFile').files[0];
    if (!file) { setStatus('⚠️ 영상(또는 음성) 파일을 골라주세요.', 'error'); return; }
    if (!/^(video|audio)\//.test(file.type || 'video/mp4')) { setStatus('⚠️ 영상 또는 음성 파일만 올릴 수 있어요.', 'error'); return; }
    if (file.size > 1024 * 1024 * 1024) { setStatus('⚠️ 1GB 이하 파일만 올릴 수 있어요. 해상도를 720p로 줄여서 올려주세요.', 'error'); return; }
    if (/quicktime|x-matroska|avi/.test(file.type)) {
      if (!confirm('MOV/MKV/AVI 파일은 일부 브라우저(특히 Chrome·Windows)에서 재생되지 않을 수 있어요.\nMP4(H.264)로 변환해서 올리는 걸 권장해요. 그래도 올릴까요?')) return;
    }
    const kids = isKids();
    startBusy(true, kids ? '② 저장' : '② 대사 받아쓰기 · 문장 정리');
    const localUrl = URL.createObjectURL(file);
    const title = $('vidTitle').value.trim() || file.name.replace(/\.[^.]+$/, '');
    let lesson = null;
    try {
      setStatus('준비 중…');
      const duration = await probeDuration(localUrl);
      lesson = (await apiFetch(VAPI.videos, { method: 'POST', body: JSON.stringify({
        action: 'create', title, mime: file.type || 'video/mp4', size: file.size, duration,
      }) })).lesson;
      setStatus(kids ? '👶 유아 영상을 올리는 중이에요. 이 창을 닫지 마세요.' : '업로드와 받아쓰기를 함께 진행해요. 이 창을 닫지 마세요.');
      const up = uploadChunks(file, lesson.id, (f, l) => setBar('vidUp', f, l));
      if (kids) {
        setBar('vidTr', 0, '업로드가 끝나면 저장해요');
        await up; await checkpoint();
        await apiFetch(VAPI.videos, { method: 'POST', body: JSON.stringify({
          action: 'update', id: lesson.id, watchOnly: true, sentences: [], partMinutes: 0, status: 'ready',
          visibility: $('vidVisibility').value, level: 'kids',
        }) });
        setBar('vidTr', 1, '완료');
        setStatus(`✅ 완료! 👶 유아 영상 "${title}"을(를) 올렸어요. 회원 화면의 「유아」 탭에서 볼 수 있어요.`, 'success');
        $('vidFile').value = ''; $('vidTitle').value = '';
        await loadLessons();
        return;
      }
      const tr = (async () => {
        const r = await transcribe(file, duration, (f, l) => setBar('vidTr', f * 0.9, l));
        if ($('vidTranslate').checked) {
          await translateAll(r.sentences, f => setBar('vidTr', 0.9 + f * 0.1, `한국어 번역 중… ${Math.round(f * 100)}%`));
        }
        setBar('vidTr', 1, `완료 — 문장 ${r.sentences.length}개`);
        return r;
      })();
      const [, r] = await Promise.all([up, tr]);
      await checkpoint();
      if (!r.sentences.length) throw new Error('영어 대사를 찾지 못했어요. 말소리가 있는 영상인지 확인해주세요.');
      const saved = (await apiFetch(VAPI.videos, { method: 'POST', body: JSON.stringify({
        action: 'update', id: lesson.id, sentences: r.sentences, duration: r.duration, status: 'ready',
        partMinutes: Number($('vidParts').value), visibility: $('vidVisibility').value, level: $('vidLevel').value,
      }) })).lesson;
      setStatus(`✅ 완료! 문장 ${r.sentences.length}개로 쉐도잉을 만들었어요. 아래에서 문장을 확인·수정하세요.`, 'success');
      $('vidFile').value = ''; $('vidTitle').value = '';
      await loadLessons();
      openEditor(Object.assign({}, saved, { sentences: r.sentences, src: localUrl }));
    } catch (e) {
      if (isCancelled(e)) {
        if (job) { job.ctl = new AbortController(); } // 정리 요청은 끊기지 않게
        if (lesson) { try { await apiFetch(VAPI.videos, { method: 'POST', body: JSON.stringify({ action: 'delete', id: lesson.id }) }); } catch (_) {} }
        setStatus('⏹ 자동 만들기를 중지했어요. 올리던 영상 조각도 지웠어요.', '');
      } else setStatus('⚠️ ' + e.message + (lesson ? '\n(목록의 "업로드 미완료" 항목은 삭제 후 다시 올려주세요.)' : ''), 'error');
      loadLessons();
    } finally { endBusy(); }
  }
  window.addEventListener('beforeunload', e => { if (busy) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------------- 문장 편집기 ---------------- */
  let media = null;     // <video> 또는 YTMedia
  let stopAt = null;
  setInterval(() => { if (media && stopAt != null && media.currentTime >= stopAt) { media.pause(); stopAt = null; } }, 80);

  async function setupPreview(l) {
    if (media && media.destroy) media.destroy();
    media = null;
    const box = $('vidPreviewBox');
    if (l.youtubeId) {
      box.innerHTML = '<div class="yt-frame"></div>';
      try { media = await YTMedia.create(box.firstChild, l.youtubeId, { start: l.clipStart || 0 }); }
      catch (e) { box.firstChild.innerHTML = `<div class="empty" style="color:#fff; padding:20px;">⚠️ ${esc(e.message)}</div>`; }
    } else {
      box.innerHTML = '<video controls playsinline preload="metadata"></video>';
      media = box.firstChild;
      media.src = l.src;
    }
  }

  function openEditor(l) {
    editing = {
      id: l.id, title: l.title, visibility: l.visibility || 'draft', partMinutes: l.partMinutes ?? 1,
      description: l.description || '', level: l.level || '', duration: l.duration || 0, youtubeId: l.youtubeId || null,
      clipStart: l.clipStart || 0, clipEnd: l.clipEnd || 0,
      caption: (l.captionTrack && l.captionTrack.kind) || l.caption || '', captionChanged: false,
      sentences: (l.sentences || []).map(s => Object.assign({}, s)), watchOnly: !!l.watchOnly,
    };
    const wo = editing.watchOnly;
    [$('vedParts').closest('.field'), $('vedCount').closest('.row'), $('vedList')].forEach(el => el.classList.toggle('hidden', wo));
    $('vedLevel').disabled = wo;
    $('vidEditor').classList.remove('hidden');
    $('vedTitle').value = editing.title;
    $('vedVisibility').value = editing.visibility;
    $('vedParts').value = String(editing.partMinutes);
    $('vedDesc').value = editing.description;
    $('vedLevel').value = editing.level;
    $('vedRefetch').classList.toggle('hidden', !editing.youtubeId);
    showCaptionInfo();
    $('vedPasteBtn').classList.toggle('hidden', !editing.youtubeId);
    $('vedPasteBox').classList.add('hidden'); $('vedPaste').value = '';
    $('vedClip').textContent = wo ? `👶 유아 영상 — 쉐도잉 없이 영상만 보여줘요. 제목·설명·공개 범위만 바꿀 수 있어요.`
      : editing.youtubeId
      ? `🔗 YouTube 영상 · 사용 구간 ${VT.fmt(editing.clipStart)} ~ ${VT.fmt(editing.clipEnd || editing.duration)}`
      : '';
    setupPreview(l);
    renderSentences();
    $('vidEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function closeEditor() {
    editing = null; stopAt = null;
    if (media && media.destroy) media.destroy();
    media = null; $('vidPreviewBox').innerHTML = '';
    $('vidEditor').classList.add('hidden');
  }

  function renderSentences() {
    const end = editing.clipEnd || editing.duration || (editing.sentences.at(-1) || {}).e || 0;
    const startT = editing.clipStart || 0;
    const rel = editing.sentences.map(s => ({ s: s.s - startT, e: s.e - startT }));
    const parts = VT.planParts(end - startT, rel, Number($('vedParts').value)).map(x => x + startT);
    let p = 1;
    const rows = [];
    editing.sentences.forEach((s, i) => {
      while (p < parts.length - 1 && s.s >= parts[p]) { rows.push(`<div class="ved-part">── Part ${p + 1} · ${VT.fmt(parts[p])}~</div>`); p++; }
      rows.push(`
      <div class="ved-row" data-i="${i}">
        <div class="ved-time">${VT.fmt(s.s)}<br><span>${(s.e - s.s).toFixed(1)}초</span></div>
        <div class="ved-text">
          <textarea class="ved-en" rows="1">${esc(s.en)}</textarea>
          <textarea class="ved-ko" rows="1" placeholder="${s._tr ? '🌐 번역 중…' : '(번역)'}">${esc(s.ko)}</textarea>
          <div class="ved-adj hidden">
            <span>시작 ${s.s.toFixed(2)}초</span>
            <button class="btn-ghost btn-small" data-sact="s-">◀ 0.25</button><button class="btn-ghost btn-small" data-sact="s+">0.25 ▶</button>
            <span style="margin-left:8px;">끝 ${s.e.toFixed(2)}초</span>
            <button class="btn-ghost btn-small" data-sact="e-">◀ 0.25</button><button class="btn-ghost btn-small" data-sact="e+">0.25 ▶</button>
          </div>
        </div>
        <div class="ved-btns">
          <button class="btn-ghost btn-small" data-sact="play" title="이 문장 듣기">▶</button>
          <button class="btn-ghost btn-small" data-sact="adj" title="소리와 글이 안 맞으면 시작·끝 시간을 조금씩 옮겨요">⏱ 시간</button>
          <button class="btn-ghost btn-small" data-sact="split" title="영어 문장에서 나눌 곳에 커서를 두고 누르세요">✂ 나누기</button>
          <button class="btn-ghost btn-small" data-sact="merge" title="다음 문장과 합치기" ${i === editing.sentences.length - 1 ? 'disabled' : ''}>⤵ 합치기</button>
          <button class="btn-danger btn-small" data-sact="del" title="삭제">✕</button>
        </div>
      </div>`);
    });
    if (parts.length > 2) rows.unshift(`<div class="ved-part">── Part 1 · ${VT.fmt(parts[0])}~</div>`);
    $('vedList').innerHTML = rows.join('') || '<div class="empty">문장이 없어요.</div>';
    $('vedCount').textContent = `문장 ${editing.sentences.length}개 · 파트 ${parts.length - 1}개`;
    $('vedList').querySelectorAll('textarea').forEach(autoGrow);
  }
  function autoGrow(t) { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; }
  function syncFromInputs(keepNewKo) {
    $('vedList').querySelectorAll('.ved-row').forEach(row => {
      const s = editing.sentences[+row.dataset.i]; if (!s) return;
      s.en = row.querySelector('.ved-en').value.trim();
      const ko = row.querySelector('.ved-ko').value.trim();
      if (!(keepNewKo && !ko && s.ko)) s.ko = ko; // 방금 번역이 도착한 칸은 빈 입력칸으로 덮어쓰지 않기
    });
  }
  async function retranslate(items) {
    items.forEach(x => { x.ko = ''; x._tr = 1; });
    renderSentences();
    try { await translateAll(items); } catch (e) {}
    items.forEach(x => { delete x._tr; });
    if (!editing) return;
    syncFromInputs(true);
    renderSentences();
  }
  $('vedList').addEventListener('input', e => { if (e.target.tagName === 'TEXTAREA') autoGrow(e.target); });
  // ✂ 나누기용: 영어 칸에서 마지막 커서 위치 기억 (버튼을 누르면 포커스가 버튼으로 옮겨가서)
  let lastCaret = { row: -1, pos: -1 };
  ['keyup', 'click', 'select'].forEach(ev => $('vedList').addEventListener(ev, e => {
    if (e.target.classList && e.target.classList.contains('ved-en')) lastCaret = { row: +e.target.closest('.ved-row').dataset.i, pos: e.target.selectionStart };
  }));
  $('vedList').addEventListener('click', e => {
    const b = e.target.closest('[data-sact]'); if (!b) return;
    const i = +b.closest('.ved-row').dataset.i;
    syncFromInputs();
    const S = editing.sentences;
    const playIt = k => { if (!media) return; media.currentTime = S[k].s; stopAt = S[k].e; const p = media.play(); if (p && p.catch) p.catch(() => {}); };
    if (b.dataset.sact === 'play') { playIt(i); return; }
    if (b.dataset.sact === 'adj') { b.closest('.ved-row').querySelector('.ved-adj').classList.toggle('hidden'); return; }
    if (/^[se][+-]$/.test(b.dataset.sact)) {
      const key = b.dataset.sact[0], d = b.dataset.sact[1] === '+' ? 0.25 : -0.25;
      const x = S[i];
      if (key === 's') x.s = Math.max(0, Math.min(x.e - 0.3, +(x.s + d).toFixed(2)));
      else x.e = Math.max(x.s + 0.3, +(x.e + d).toFixed(2));
      const row = b.closest('.ved-row');
      row.querySelector('.ved-time').innerHTML = `${VT.fmt(x.s)}<br><span>${(x.e - x.s).toFixed(1)}초</span>`;
      const spans = row.querySelectorAll('.ved-adj > span');
      spans[0].textContent = `시작 ${x.s.toFixed(2)}초`; spans[1].textContent = `끝 ${x.e.toFixed(2)}초`;
      playIt(i);
      return;
    }
    if (b.dataset.sact === 'split') {
      const x = S[i], text = x.en;
      let pos = lastCaret.row === i ? lastCaret.pos : -1;
      // 커서를 안 뒀으면: 첫 번째 ! ? . , 뒤에서 나누기 (예: "Oh Banana, dad, ..." → "Oh Banana," | "dad, ...")
      if (pos <= 0 || pos >= text.length) { const m = /[!?.,](?=\s+\S)/.exec(text); pos = m ? m.index + 1 : -1; }
      if (pos <= 0 || pos >= text.length) { alert('영어 문장 안에서 나눌 곳을 클릭해 커서를 두고 ✂ 나누기를 눌러주세요.'); return; }
      let a = text.slice(0, pos).trim(), c = text.slice(pos).trim();
      if (!a || !c) return;
      a = a.replace(/[,;:]$/, '');
      if (!/[.?!]$/.test(a)) a += /^(oh|wow|hooray|yay|no|yes|hey|whoa|ah|oops|uh oh)\b/i.test(a) ? '!' : '.';
      c = c.charAt(0).toUpperCase() + c.slice(1);
      const t = +(x.s + (x.e - x.s) * (pos / text.length)).toFixed(2); // 글자 비율로 시간 나누기 (⏱로 미세 조정)
      S.splice(i, 1, { s: x.s, e: t, en: a, ko: '' }, { s: t, e: x.e, en: c, ko: '' });
      lastCaret = { row: -1, pos: -1 };
      renderSentences();
      retranslate([S[i], S[i + 1]]);
      return;
    }
    if (b.dataset.sact === 'merge' && S[i + 1]) {
      S[i] = { s: S[i].s, e: S[i + 1].e, en: (S[i].en + ' ' + S[i + 1].en).trim(), ko: '' };
      S.splice(i + 1, 1);
      retranslate([S[i]]);
      return;
    }
    if (b.dataset.sact === 'del') S.splice(i, 1);
    renderSentences();
  });
  $('vedParts').addEventListener('change', () => { syncFromInputs(); renderSentences(); });
  $('vedRetranslate').addEventListener('click', async () => {
    syncFromInputs();
    const b = $('vedRetranslate'); b.disabled = true;
    const empty = editing.sentences.filter(s => !s.ko);
    const target = empty.length ? empty : editing.sentences;
    if (!empty.length && !confirm('모든 문장의 번역을 새로 만들까요? (직접 고친 번역도 바뀌어요)')) { b.disabled = false; return; }
    target.forEach(s => { s.ko = ''; });
    let fail = 0;
    try { fail = await translateAll(target, f => { b.textContent = `번역 중… ${Math.round(f * 100)}%`; }); } catch (e) { alert(e.message); }
    $('vedStatus').textContent = fail ? `⚠️ ${fail}문장은 번역하지 못했어요. 잠시 뒤 다시 눌러 주세요.` : '✅ 번역을 채웠어요. 💾 저장을 눌러주세요.';
    $('vedStatus').className = 'status ' + (fail ? 'error' : 'success');
    b.textContent = '🌐 빈 번역 채우기'; b.disabled = false;
    renderSentences();
  });
  $('vedResplit').addEventListener('click', async () => {
    syncFromInputs();
    if (!editing.sentences.length) return;
    if (!confirm('문장이 중간에 끊긴 곳을 AI로 다시 이어 붙여 문장 단위로 나눌까요?\n(직접 고친 내용은 유지되지만, 번역은 새로 만들어져요)')) return;
    const b = $('vedResplit'); b.disabled = true;
    const st = $('vedStatus'); st.className = 'status';
    try {
      const hadKo = editing.sentences.some(s => s.ko);
      const words = VT.sentencesToWords(editing.sentences);
      const end = editing.clipEnd || editing.duration || editing.sentences.at(-1).e;
      const next = await smartSentences(words, end, false, f => { st.textContent = `AI가 문장을 다시 나누는 중… ${Math.round(f * 100)}%`; }, $('vedTitle').value);
      const before = editing.sentences.length;
      editing.sentences = next;
      await translateAll(editing.sentences, f => { st.textContent = `번역 중… ${Math.round(f * 100)}%`; });
      renderSentences();
      st.textContent = `✅ ${before}개 → ${next.length}개 문장으로 다시 나눴어요. 확인 후 💾 저장을 눌러주세요.`; st.className = 'status success';
    } catch (e) { st.textContent = '⚠️ ' + e.message; st.className = 'status error'; }
    b.disabled = false;
  });
  // YouTube 영상: 자막을 처음부터 다시 가져와 문장을 새로 만들기 (예전 방식으로 시간이 어긋난 쉐도잉 고치기)
  $('vedRefetch').addEventListener('click', async () => {
    if (!editing || !editing.youtubeId) return;
    if (!confirm('YouTube에서 자막을 다시 가져와 문장과 시간을 새로 만들까요?\n(직접 고친 문장은 사라지고, 번역도 새로 만들어져요)')) return;
    const b = $('vedRefetch'); b.disabled = true;
    const st = $('vedStatus'); st.className = 'status';
    try {
      const hadKo = editing.sentences.some(s => s.ko);
      const d = await fetchYoutubeCaptions(editing.youtubeId, (f, l) => { st.textContent = l; });
      if (d.needPaste) throw new Error('자막을 자동으로 가져오지 못했어요. 이 영상을 삭제하고, 위에서 링크와 「스크립트 표시」 붙여넣기로 다시 만들어 주세요.');
      const cs = editing.clipStart || 0, ce = editing.clipEnd || 0;
      const inClip = d.words.filter(w => w.s >= cs - 0.05 && (!ce || w.s < ce));
      let next = await smartSentences(inClip, ce || d.duration || editing.duration, d.punctuated, f => { st.textContent = `AI가 문장부호를 붙이는 중… ${Math.round(f * 100)}%`; }, $('vedTitle').value || d.title);
      next = next.filter(s => s.s >= cs - 0.5);
      if (cs) next.forEach(s => { s.s = Math.max(s.s, cs); });
      await translateAll(next, f => { st.textContent = `번역 중… ${Math.round(f * 100)}%`; });
      editing.sentences = next;
      editing.caption = captionKind(d.track, d.punctuated); editing.captionChanged = true; showCaptionInfo();
      renderSentences();
      st.textContent = `✅ 문장 ${next.length}개로 새로 만들었어요. ▶로 몇 문장 들어보고 💾 저장을 눌러주세요.` + captionNote(editing.caption); st.className = 'status success';
    } catch (e) { st.textContent = '⚠️ ' + e.message; st.className = 'status error'; }
    b.disabled = false;
  });
  function showCaptionInfo() {
    const box = $('vedCaption');
    const info = editing && editing.youtubeId && !editing.watchOnly && CAPTION_INFO[editing.caption];
    box.classList.toggle('hidden', !info);
    if (!info) return;
    box.className = 'ved-caption ' + editing.caption;
    box.textContent = info.note;
  }
  // 📋 YouTube 「스크립트 표시」를 붙여넣어 다시 만들기 (사람이 만든 자막이 있으면 이게 가장 정확해요)
  $('vedPasteBtn').addEventListener('click', () => { $('vedPasteBox').classList.toggle('hidden'); $('vedPaste').focus(); });
  $('vedPasteGo').addEventListener('click', async () => {
    const text = $('vedPaste').value.trim();
    const st = $('vedStatus'); st.className = 'status';
    const p = VT.parsePastedTranscript(text);
    if (!p.words.length) { st.textContent = '⚠️ 붙여넣은 내용에서 시간(0:00)과 대사를 찾지 못했어요. 「스크립트 표시」의 내용을 시간까지 함께 복사해 주세요.'; st.className = 'status error'; return; }
    if (!confirm('붙여넣은 스크립트로 문장을 새로 만들까요? (지금 문장과 번역은 바뀌어요)')) return;
    const b = $('vedPasteGo'); b.disabled = true;
    try {
      const cs = editing.clipStart || 0, ce = editing.clipEnd || 0;
      const inClip = p.words.filter(w => w.s >= cs - 0.05 && (!ce || w.s < ce));
      if (!inClip.length) throw new Error('이 영상의 사용 구간에 해당하는 대사가 없어요. 시간이 맞는 스크립트인지 확인해 주세요.');
      let next = await smartSentences(inClip, ce || editing.duration || inClip[inClip.length - 1].e + 1, p.punctuated,
        f => { st.textContent = `AI가 문장부호를 붙이는 중… ${Math.round(f * 100)}%`; }, $('vedTitle').value);
      next = next.filter(x => x.s >= cs - 0.5);
      if (cs) next.forEach(x => { x.s = Math.max(x.s, cs); });
      const fail = await translateAll(next, f => { st.textContent = `번역 중… ${Math.round(f * 100)}%`; });
      editing.sentences = next;
      editing.caption = p.punctuated ? 'human' : 'auto'; editing.captionChanged = true; showCaptionInfo();
      $('vedPasteBox').classList.add('hidden');
      renderSentences();
      st.textContent = `✅ 붙여넣은 스크립트로 문장 ${next.length}개를 만들었어요. 확인 후 💾 저장을 눌러주세요.` + trWarn(fail); st.className = 'status success';
    } catch (e) { st.textContent = '⚠️ ' + e.message; st.className = 'status error'; }
    b.disabled = false;
  });
  $('vedCancel').addEventListener('click', closeEditor);
  $('vedSave').addEventListener('click', async () => {
    syncFromInputs();
    const b = $('vedSave'); b.disabled = true;
    const st = $('vedStatus'); st.textContent = '저장 중…'; st.className = 'status';
    try {
      await apiFetch(VAPI.videos, { method: 'POST', body: JSON.stringify({
        action: 'update', id: editing.id, title: $('vedTitle').value, description: $('vedDesc').value, level: $('vedLevel').value,
        visibility: $('vedVisibility').value, partMinutes: Number($('vedParts').value),
        sentences: editing.sentences.filter(s => s.en),
        ...(editing.captionChanged && editing.caption ? { track: { lang: 'en', kind: editing.caption } } : {}),
      }) });
      st.textContent = '✅ 저장했어요.'; st.className = 'status success';
      loadLessons();
    } catch (e) { st.textContent = '⚠️ ' + e.message; st.className = 'status error'; }
    b.disabled = false;
  });

  // 관리자 로그인 후 목록 불러오기
  const main = $('mainArea');
  const tryLoad = () => { if (!main.classList.contains('hidden')) loadLessons(); };
  new MutationObserver(tryLoad).observe(main, { attributes: true, attributeFilter: ['class'] });
  tryLoad();
  $('vidRefresh').addEventListener('click', loadLessons);
})();

/* 관리자 페이지 — 🎬 영상 쉐도잉 카드
 *  🔗 YouTube 링크: 링크만 붙여넣으면 → 영어 자막 가져오기 → 문장 정리 → 번역 → 파트 나누기 → 저장 (영상은 YouTube로 재생)
 *                   자막을 못 가져오면 YouTube의 「스크립트 표시」를 복사해 붙여넣는 방법으로 이어서 만듭니다.
 *  📁 파일 올리기:  영상을 3.5MB 조각으로 올리면서, 브라우저에서 소리를 뽑아 Whisper로 받아쓰기
 * admin.html의 getToken()/apiFetch()를 사용합니다.
 */
(function () {
  const VT = window.VideoTranscript;
  const $ = id => document.getElementById(id);
  const VAPI = { videos: '/api/admin-videos', transcribe: '/api/admin-transcribe', youtube: '/api/admin-youtube' };
  const CHUNK = 3.5 * 1024 * 1024;
  const VIS_LABEL = { draft: '🔒 비공개(임시)', members: '👥 회원 공개', public: '🌐 전체 공개' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

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
          <div class="title">${v.youtubeId ? '🔗 ' : '📁 '}${esc(v.title)}</div>
          <div class="meta">${VT.fmt(lessonLen(v))}${v.clipStart || v.clipEnd ? ` (${VT.fmt(v.clipStart)}~${VT.fmt(v.clipEnd || v.duration)})` : ''} · 문장 ${v.sentenceCount}개 ·
            ${v.youtubeId ? 'YouTube' : fmtSize(v.size)} · ${v.partMinutes ? v.partMinutes + '분 단위' : '나누지 않음'} ·
            ${v.status === 'ready' ? VIS_LABEL[v.visibility] : '<b style="color:var(--bad)">⚠️ 업로드 미완료</b>'}
            · ${new Date(v.createdAt).toLocaleDateString('ko-KR')}</div>
        </div>
        <div class="set-btns">
          ${v.status === 'ready' ? `<button class="btn-ghost btn-small" data-vact="edit" data-id="${v.id}">✏️ 문장 편집</button>
          <a class="btn-ghost btn-small" style="text-decoration:none; border-radius:10px; font-weight:700;" href="video.html?id=${v.id}&admin=1" target="_blank" rel="noopener">▶ 연습 화면</a>` : ''}
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

  /* ---------------- 공통: 번역 ---------------- */
  async function translateAll(sents, onProg) {
    let i = 0, done = 0;
    async function worker() {
      while (i < sents.length) {
        const k = i++;
        if (!sents[k].ko) sents[k].ko = await VT.translate(sents[k].en);
        done++; onProg && onProg(done / sents.length);
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  function startBusy(showUpload, trTitle) {
    busy = true; $('vidStartBtn').disabled = true; $('vidProgress').classList.remove('hidden');
    $('vidUpRow').classList.toggle('hidden', !showUpload);
    $('vidTrTitle').textContent = trTitle;
    setBar('vidUp', 0, '대기 중'); setBar('vidTr', 0, '대기 중');
  }
  function endBusy() { busy = false; $('vidStartBtn').disabled = false; }

  $('vidStartBtn').addEventListener('click', () => { if (!busy) (src === 'youtube' ? startYoutube() : startFile()); });

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

  async function startYoutube() {
    const videoId = parseYoutubeId($('ytUrl').value);
    if (!videoId) { setStatus('⚠️ YouTube 링크를 붙여넣어 주세요. (예: https://www.youtube.com/watch?v=...)', 'error'); return; }
    const clipStart = VT.parseTime($('ytStart').value), clipEndIn = VT.parseTime($('ytEnd').value);
    if (Number.isNaN(clipStart) || Number.isNaN(clipEndIn)) { setStatus('⚠️ 시작/끝 시간은 1:30 처럼 입력해주세요.', 'error'); return; }
    if (clipEndIn && clipEndIn <= clipStart) { setStatus('⚠️ 끝 시간이 시작 시간보다 뒤여야 해요.', 'error'); return; }
    const pasted = $('ytPaste').value.trim();
    startBusy(false, '② 자막 가져오기 · 문장 정리');
    try {
      let words, punctuated, info, track = null;
      if (pasted && lastYt && lastYt.videoId === videoId) {
        // 붙여넣은 스크립트로 만들기
        setBar('vidTr', 0.3, '붙여넣은 스크립트 읽는 중…');
        const p = VT.parsePastedTranscript(pasted);
        if (!p.words.length) throw new Error('붙여넣은 내용에서 시간(0:00)과 대사를 찾지 못했어요. 「스크립트 표시」의 내용을 시간까지 함께 복사해 주세요.');
        words = p.words; punctuated = p.punctuated; info = lastYt; track = { lang: 'en', kind: 'pasted' };
      } else {
        setStatus('YouTube에서 영어 자막을 가져오는 중…');
        setBar('vidTr', 0.15, '자막 찾는 중…');
        const r = await fetch(VAPI.youtube, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() }, body: JSON.stringify({ url: videoId }) });
        const d = await r.json().catch(() => ({}));
        if (r.status === 401) { clearToken(); showLogin(); throw new Error('세션이 만료됐어요. 다시 로그인해주세요.'); }
        lastYt = { videoId, title: d.title || '', duration: d.duration || 0 };
        if (!r.ok) {
          if (['blocked', 'no_captions'].includes(d.error)) {
            $('ytPasteBox').classList.remove('hidden');
            $('ytWhy').textContent = `(${d.message || ''}${d.attempts ? ' · ' + d.attempts.join(', ') : ''})`;
            setBar('vidTr', 0, '붙여넣기 대기');
            setStatus(`📋 "${d.title || '영상'}"의 자막을 자동으로 못 가져왔어요. 아래 안내대로 스크립트를 붙여넣고 🚀 버튼을 다시 눌러주세요.`, 'error');
            $('ytPaste').focus();
            return;
          }
          throw new Error(d.message || d.error || ('HTTP ' + r.status));
        }
        words = d.words; punctuated = d.punctuated; info = lastYt; track = d.track;
        setBar('vidTr', 0.5, `${d.track.kind === 'manual' ? '사람이 만든' : '자동 생성'} 영어 자막 ${words.length}단어`);
      }
      // 구간 자르기
      const duration = info.duration || (words.length ? words[words.length - 1].e + 1 : 0);
      const clipEnd = clipEndIn && clipEndIn < duration ? clipEndIn : 0;
      const inClip = words.filter(w => w.s >= clipStart - 0.05 && (!clipEnd || w.s < clipEnd));
      if (!inClip.length) throw new Error('선택한 구간에 대사가 없어요. 시작/끝 시간을 확인해주세요.');
      let sentences = VT.wordsToSentences(inClip, clipEnd || duration, punctuated);
      sentences = sentences.filter(s => s.s >= clipStart - 0.5);
      if (clipStart) sentences.forEach(s => { s.s = Math.max(s.s, clipStart); });
      setBar('vidTr', 0.6, `문장 ${sentences.length}개로 정리`);
      if ($('vidTranslate').checked) {
        await translateAll(sentences, f => setBar('vidTr', 0.6 + f * 0.35, `한국어 번역 중… ${Math.round(f * 100)}%`));
      }
      setBar('vidTr', 0.97, '저장 중…');
      const lesson = (await apiFetch(VAPI.videos, { method: 'POST', body: JSON.stringify({
        action: 'create_youtube', youtubeId: videoId, title: $('vidTitle').value.trim() || info.title, duration,
        clipStart, clipEnd, sentences, partMinutes: Number($('vidParts').value), visibility: $('vidVisibility').value, track,
      }) })).lesson;
      setBar('vidTr', 1, `완료 — 문장 ${sentences.length}개`);
      setStatus(`✅ 완료! "${lesson.title}" — 문장 ${sentences.length}개로 쉐도잉을 만들었어요. 아래에서 확인·수정하세요.`, 'success');
      $('ytUrl').value = ''; $('ytStart').value = ''; $('ytEnd').value = ''; $('ytPaste').value = ''; $('vidTitle').value = '';
      $('ytPasteBox').classList.add('hidden');
      await loadLessons();
      openEditor(lesson);
    } catch (e) {
      setStatus('⚠️ ' + e.message, 'error');
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
        const n = next++;
        const blob = file.slice(n * CHUNK, Math.min(file.size, (n + 1) * CHUNK));
        for (let attempt = 1; ; attempt++) {
          try {
            const r = await fetch(`${VAPI.videos}?id=${id}&n=${n}`, {
              method: 'PUT', headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'application/octet-stream' }, body: blob,
            });
            if (r.status === 401) throw Object.assign(new Error('세션이 만료됐어요. 다시 로그인해주세요.'), { fatal: true });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            break;
          } catch (e) {
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
      onProg((i + 0.3) / pieces.length, `받아쓰는 중… ${i + 1}/${pieces.length} (${VT.fmt(pieces[i].offset)}~)`);
      const wav = VT.encodeWav(pieces[i].pcm);
      let data;
      for (let attempt = 1; ; attempt++) {
        const r = await fetch(VAPI.transcribe + '?prompt=' + encodeURIComponent(prompt), {
          method: 'POST', headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'audio/wav' }, body: wav,
        });
        let d = null; try { d = await r.json(); } catch (e) {}
        if (r.ok) { data = d; break; }
        if (r.status === 401) throw new Error('세션이 만료됐어요. 다시 로그인해주세요.');
        if (attempt >= 6) throw new Error('받아쓰기 실패: ' + ((d && (d.detail || d.error)) || r.status));
        const wait = r.status === 429 ? Math.min(65, (d && d.retryAfter) || 20) : 3 * attempt;
        onProg((i + 0.3) / pieces.length, `음성 인식 사용량 한도 — ${wait}초 기다렸다 계속해요… (${i + 1}/${pieces.length})`);
        await sleep(wait * 1000);
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
    startBusy(true, '② 대사 받아쓰기 · 문장 정리');
    const localUrl = URL.createObjectURL(file);
    const title = $('vidTitle').value.trim() || file.name.replace(/\.[^.]+$/, '');
    let lesson = null;
    try {
      setStatus('준비 중…');
      const duration = await probeDuration(localUrl);
      lesson = (await apiFetch(VAPI.videos, { method: 'POST', body: JSON.stringify({
        action: 'create', title, mime: file.type || 'video/mp4', size: file.size, duration,
      }) })).lesson;
      setStatus('업로드와 받아쓰기를 함께 진행해요. 이 창을 닫지 마세요.');
      const up = uploadChunks(file, lesson.id, (f, l) => setBar('vidUp', f, l));
      const tr = (async () => {
        const r = await transcribe(file, duration, (f, l) => setBar('vidTr', f * 0.9, l));
        if ($('vidTranslate').checked) {
          await translateAll(r.sentences, f => setBar('vidTr', 0.9 + f * 0.1, `한국어 번역 중… ${Math.round(f * 100)}%`));
        }
        setBar('vidTr', 1, `완료 — 문장 ${r.sentences.length}개`);
        return r;
      })();
      const [, r] = await Promise.all([up, tr]);
      if (!r.sentences.length) throw new Error('영어 대사를 찾지 못했어요. 말소리가 있는 영상인지 확인해주세요.');
      const saved = (await apiFetch(VAPI.videos, { method: 'POST', body: JSON.stringify({
        action: 'update', id: lesson.id, sentences: r.sentences, duration: r.duration, status: 'ready',
        partMinutes: Number($('vidParts').value), visibility: $('vidVisibility').value,
      }) })).lesson;
      setStatus(`✅ 완료! 문장 ${r.sentences.length}개로 쉐도잉을 만들었어요. 아래에서 문장을 확인·수정하세요.`, 'success');
      $('vidFile').value = ''; $('vidTitle').value = '';
      await loadLessons();
      openEditor(Object.assign({}, saved, { sentences: r.sentences, src: localUrl }));
    } catch (e) {
      setStatus('⚠️ ' + e.message + (lesson ? '\n(목록의 "업로드 미완료" 항목은 삭제 후 다시 올려주세요.)' : ''), 'error');
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
      description: l.description || '', duration: l.duration || 0, youtubeId: l.youtubeId || null,
      clipStart: l.clipStart || 0, clipEnd: l.clipEnd || 0,
      sentences: (l.sentences || []).map(s => Object.assign({}, s)),
    };
    $('vidEditor').classList.remove('hidden');
    $('vedTitle').value = editing.title;
    $('vedVisibility').value = editing.visibility;
    $('vedParts').value = String(editing.partMinutes);
    $('vedDesc').value = editing.description;
    $('vedClip').textContent = editing.youtubeId
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
          <textarea class="ved-ko" rows="1" placeholder="(번역)">${esc(s.ko)}</textarea>
        </div>
        <div class="ved-btns">
          <button class="btn-ghost btn-small" data-sact="play" title="이 문장 듣기">▶</button>
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
  function syncFromInputs() {
    $('vedList').querySelectorAll('.ved-row').forEach(row => {
      const s = editing.sentences[+row.dataset.i]; if (!s) return;
      s.en = row.querySelector('.ved-en').value.trim();
      s.ko = row.querySelector('.ved-ko').value.trim();
    });
  }
  $('vedList').addEventListener('input', e => { if (e.target.tagName === 'TEXTAREA') autoGrow(e.target); });
  $('vedList').addEventListener('click', e => {
    const b = e.target.closest('[data-sact]'); if (!b) return;
    const i = +b.closest('.ved-row').dataset.i;
    syncFromInputs();
    const S = editing.sentences;
    if (b.dataset.sact === 'play') {
      if (!media) return;
      media.currentTime = S[i].s; stopAt = S[i].e;
      const p = media.play(); if (p && p.catch) p.catch(() => {});
      return;
    }
    if (b.dataset.sact === 'merge' && S[i + 1]) {
      S[i] = { s: S[i].s, e: S[i + 1].e, en: (S[i].en + ' ' + S[i + 1].en).trim(), ko: [S[i].ko, S[i + 1].ko].filter(Boolean).join(' ') };
      S.splice(i + 1, 1);
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
    await translateAll(target, f => { b.textContent = `번역 중… ${Math.round(f * 100)}%`; });
    b.textContent = '🌐 빈 번역 채우기'; b.disabled = false;
    renderSentences();
  });
  $('vedCancel').addEventListener('click', closeEditor);
  $('vedSave').addEventListener('click', async () => {
    syncFromInputs();
    const b = $('vedSave'); b.disabled = true;
    const st = $('vedStatus'); st.textContent = '저장 중…'; st.className = 'status';
    try {
      await apiFetch(VAPI.videos, { method: 'POST', body: JSON.stringify({
        action: 'update', id: editing.id, title: $('vedTitle').value, description: $('vedDesc').value,
        visibility: $('vedVisibility').value, partMinutes: Number($('vedParts').value),
        sentences: editing.sentences.filter(s => s.en),
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

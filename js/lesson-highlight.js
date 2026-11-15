/* 관리자 페이지 — ✂️ 수업영상 하이라이트 (영클 연세점 운영자 지시 2026-11-06 · 버클리로 옮겨 옴 2026-11-13, 🛠️ 만들기 안)
 * 학생을 고르면 「🎥 수업영상 자동 가져오기」에서 💾 저장한 녹화와 이미 만든 수업영상이 보여요.
 * 「✂️ 하이라이트 만들기」: 녹화 전체를 분석해 학생 참여도가 높고 선생님과 즐겁게 수업한 부분을 3~6분으로 편집 → 미리 보기 · 내려받기
 * ① 녹화 받기(만든 수업영상: 저장된 조각 / 저장한 녹화: 엔보임에서 받아 오고 끝나면 임시 레슨은 지워요)
 * ② 소리 꺼내기(ffmpeg 웹 버전) → 대사: 만든 수업영상은 저장된 문장(선생님·학생 sp 포함), 저장한 녹화는 받아쓰기(/api/admin-lesson-transcribe) + 목소리로 선생님·학생(LessonVoice)
 * ③ 5초마다 점수(학생 말한 시간 · 말 주고받기 · 웃음·칭찬 말 · 목소리 크기) → 활발한 구간을 힌트로
 * ④ AI(/api/admin-lesson-highlight)가 대사 전체를 보고 2~4구간(합쳐서 3~6분)을 골라요 — 못 고르면 점수로 골라요(scorePick)
 * ⑤ 영어·한글 자막: 고른 구간의 문장마다 위 줄 영어(흰색) · 아래 줄 한국어(노란색)를 영상에 새겨요
 *    한국어 뜻이 없는 문장은 번역(/api/admin-translate)으로 채워요. 글꼴은 나눔고딕 굵게(한글이 보이게)
 * ⑥ ffmpeg로 구간마다 자막을 새기며 잘라(정확한 시간) 한 파일(mp4)로 이어 붙여요 — 자막을 못 새기면 자막 없이 잘라요
 * ⑦ 만든 하이라이트는 그 학생 이름으로 저장(/api/admin-highlights) — 「🎁 학생별 쉐도잉 넣어주기」에서 넣어 줘야 학생 화면에 보여요
 * admin.html의 getToken()/apiFetch()/membersCache/memberLabel()을 사용합니다. */
(function () {
  const $ = id => document.getElementById(id);
  if (!$('hlCard')) return;
  const VT = window.VideoTranscript;
  const API = '/api/admin-nvoim-video';
  const MIN_SEC = 180, MAX_SEC = 360, AIM_SEC = 270; // 3분 ~ 6분
  const FIT_MAX = 335; // 자르는 곳이 영상 키프레임에 맞춰 조금 앞당겨져도 6분을 넘지 않게
  const BIN = 5;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const auth = () => ({ Authorization: 'Bearer ' + getToken() });
  const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const HANGUL = /[ㄱ-ㆎ가-힣]/;
  const FUN = /\b(ha(ha)+|hehe+|lol|laugh\w*|wow+|yay|great|awesome|amazing|excellent|fantastic|perfect|good job|well done|very good|so good|nice|cool|funny|fun|love|happy|exciting|interesting|bravo|congratulations)\b/gi;

  let items = [], busy = false, cancelled = false, ctl = null, ff = null, outUrl = null, onEncode = null;
  class Cancelled extends Error { constructor() { super('중지했어요.'); this.cancelled = true; } }
  const check = () => { if (cancelled) throw new Cancelled(); };
  function setStatus(id, msg, cls = '') { const el = $(id); el.textContent = msg; el.className = 'status ' + cls; }
  function prog(f, label) { $('hlBar').style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; if (label != null) $('hlLabel').textContent = label; }

  /* ---------------- 학생 · 녹화 목록 ---------------- */
  function renderMembers() {
    const sel = $('hlMember'), cur = sel.value;
    sel.innerHTML = '<option value="">-- 학생을 선택하세요 --</option>' + (typeof membersCache !== 'undefined' ? membersCache : []).map(m => `<option value="${esc(m.username)}">${esc(memberLabel(m.username))}</option>`).join('');
    sel.value = cur;
  }
  function renderList() {
    const box = $('hlList');
    if (!$('hlMember').value) { box.innerHTML = ''; return; }
    box.innerHTML = items.length ? items.map((x, i) => `
      <div class="set-item set-stack">
        <div>
          <div class="title">${esc(x.date || '날짜 모름')} 수업 녹화 ${x.lessonId ? '<span class="pill">🎥 만든 수업영상</span>' : '<span class="pill">💾 저장한 녹화</span>'}</div>
          <div class="meta">${esc(x.title || x.label || '')}${x.sentenceCount ? ` · 문장 ${x.sentenceCount}개` : ''}</div>
        </div>
        <div class="set-btns"><button class="btn-primary btn-small" data-hl="${i}">✂️ 하이라이트 만들기</button></div>
      </div>`).join('') : '<div class="empty">이 학생의 녹화가 없어요. 「🎥 수업영상 자동 가져오기」에서 녹화를 「💾 저장」해 주세요.</div>';
  }
  async function loadList() {
    const u = $('hlMember').value;
    items = []; renderList();
    if (!u) { setStatus('hlListStatus', ''); return; }
    setStatus('hlListStatus', '🔍 저장한 녹화와 만든 수업영상을 찾는 중…');
    let made = [], saved = [];
    try { made = (await apiFetch(`${API}?records=${encodeURIComponent(u)}`)).recordings || []; } catch (e) {}
    try { saved = (await apiFetch(`${API}?saved=${encodeURIComponent(u)}`)).recordings || []; } catch (e) {}
    if ($('hlMember').value !== u) return;
    items = made.map(v => ({ lessonId: v.id, title: v.title, date: v.date, sentenceCount: v.sentenceCount }));
    saved.forEach(x => {
      const lid = x.done && x.done.lessonId;
      if (lid && items.some(y => y.lessonId === lid)) return; // 이미 만든 수업영상이면 그쪽(문장·선생님/학생이 있어서 빨라요)
      if (x.kind === 'hls' || x.kind === 'page') return;
      items.push(Object.assign({}, x, { lessonId: lid || '', saved: !lid, title: x.label }));
    });
    items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    renderList();
    setStatus('hlListStatus', items.length ? `✅ 녹화 ${items.length}개 — 「✂️ 하이라이트 만들기」를 누르세요.` : '', items.length ? 'success' : '');
  }

  /* ---------------- ① 녹화 받기 ---------------- */
  async function lessonFile(id) {
    const { lesson, streamUrl } = await apiFetch('/api/admin-videos?id=' + encodeURIComponent(id));
    if (!lesson || !streamUrl || !lesson.size) throw new Error('저장된 녹화가 없어요.');
    const CH = 3670016, n = Math.ceil(lesson.size / CH), parts = new Array(n);
    let next = 0, got = 0;
    const worker = async () => {
      while (next < n) {
        const k = next++;
        for (let t = 1; ; t++) {
          check();
          try {
            const r = await fetch(streamUrl, { headers: { Range: `bytes=${k * CH}-${Math.min(lesson.size, (k + 1) * CH) - 1}` }, signal: ctl.signal });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            parts[k] = await r.arrayBuffer(); break;
          } catch (e) { if (cancelled || e.name === 'AbortError') throw new Cancelled(); if (t >= 4) throw new Error('녹화를 받지 못했어요: ' + e.message); await sleep(1500 * t); }
        }
        got++; prog(got / n * 0.35, `🎥 녹화 받는 중… ${Math.round(got / n * 100)}%`);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return { file: new File(parts, 'lesson.mp4', { type: lesson.mime || 'video/mp4' }), lesson };
  }
  // 💾 저장한 녹화: 쉐도잉 만들기와 같은 길(start → chunk)로 엔보임에서 받고, 다 받으면 임시 레슨은 지워요(cancel)
  async function savedFile(x) {
    const acc = $('nvvAccount') && $('nvvAccount').value;
    const start = await apiFetch(API, { method: 'POST', body: JSON.stringify({ action: 'start', url: x.url, conf: x.conf || '', part: x.part || 0, studentId: x.studentId, title: `하이라이트 임시 ${x.date || ''}`, date: x.date || '', accountId: acc || undefined }) });
    const id = start.lesson.id, total = start.chunks;
    try {
      if (start.stream) {
        const r = await fetch('/.netlify/functions/nvoim-video-fetch-background', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, auth()), body: JSON.stringify({ id }) });
        if (r.status === 401) throw new Error('세션이 만료됐어요. 다시 로그인해주세요.');
      }
      const parts = new Array(total);
      let next = 0, done = 0;
      const worker = async () => {
        while (next < total) {
          const n = next++;
          for (let attempt = 1; ; attempt++) {
            check();
            try {
              const r = await fetch(API, { method: 'POST', signal: ctl.signal, headers: Object.assign({ 'Content-Type': 'application/json' }, auth()), body: JSON.stringify({ action: 'chunk', id, n }) });
              if (r.status === 401) throw Object.assign(new Error('세션이 만료됐어요. 다시 로그인해주세요.'), { fatal: true });
              if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.message || d.error || 'HTTP ' + r.status); }
              if (r.status === 202) { const d = await r.json().catch(() => ({})); prog((d.got || 0) / total * 0.35, `엔보임에서 녹화를 받는 중… ${d.got || 0}/${total} 조각`); attempt = 0; await sleep(2500); continue; }
              parts[n] = await r.blob(); break;
            } catch (e) {
              if (cancelled || e.name === 'AbortError') throw new Cancelled();
              if (e.fatal || attempt >= 4) throw new Error(`녹화 조각 ${n + 1}/${total} 가져오기 실패: ${e.message}`);
              await sleep(1500 * attempt);
            }
          }
          done++; prog(done / total * 0.35, `🎥 녹화 받는 중… ${done}/${total} 조각`);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      return { file: new File(parts, 'lesson.mp4', { type: start.mime || 'video/mp4' }), lesson: null };
    } finally {
      try { await apiFetch(API, { method: 'POST', body: JSON.stringify({ action: 'cancel', id }) }); } catch (e) {}
    }
  }

  /* ---------------- ② ffmpeg · 소리 · 대사 ---------------- */
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('편집 도구(ffmpeg)를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.')); document.head.appendChild(s); }); }
  async function openFfmpeg(file) {
    const FF = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd', CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
    if (!window.FFmpegWASM) await loadScript(FF + '/ffmpeg.js');
    const blobURL = async (url, type) => URL.createObjectURL(new Blob([await (await fetch(url)).arrayBuffer()], { type }));
    prog(0.36, '✂️ 편집 도구를 불러오는 중… (처음엔 30초쯤)');
    ff = new FFmpegWASM.FFmpeg();
    ff.on('progress', ({ time }) => { if (onEncode && time > 0) onEncode(time / 1e6); }); // 지금까지 만든 영상의 초
    await ff.load({ classWorkerURL: await blobURL(FF + '/814.ffmpeg.js', 'text/javascript'), coreURL: await blobURL(CORE + '/ffmpeg-core.js', 'text/javascript'), wasmURL: await blobURL(CORE + '/ffmpeg-core.wasm', 'application/wasm') });
    check();
    await ff.writeFile('in.mp4', new Uint8Array(await file.arrayBuffer()));
  }
  async function audioPcm() {
    prog(0.38, '🎧 녹화에서 소리를 꺼내는 중…');
    await ff.exec(['-i', 'in.mp4', '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', 'a.wav']);
    const wav = await ff.readFile('a.wav');
    try { await ff.deleteFile('a.wav'); } catch (e) {}
    check();
    return (await VT.extractAudio(new File([wav.buffer], 'a.wav', { type: 'audio/wav' }))).pcm;
  }
  function louder(pcm) {
    const step = Math.max(1, Math.floor(pcm.length / 200000)), sample = [];
    for (let i = 0; i < pcm.length; i += step) sample.push(Math.abs(pcm[i]));
    sample.sort((a, b) => a - b);
    const peak = sample[Math.floor(sample.length * 0.999)] || 0, gain = peak > 0 ? Math.min(8, 0.9 / peak) : 1;
    if (gain <= 1.05) return pcm;
    const out = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) out[i] = Math.max(-1, Math.min(1, pcm[i] * gain));
    return out;
  }
  async function askStt(pcm, label) {
    const wav = VT.encodeWav(pcm);
    for (let attempt = 1; ; attempt++) {
      check();
      let r = null, d = null;
      try {
        r = await fetch('/api/admin-lesson-transcribe', { method: 'POST', signal: ctl.signal, headers: Object.assign({ 'Content-Type': 'audio/wav' }, auth()), body: wav });
        d = await r.json().catch(() => null);
      } catch (e) { if (cancelled || e.name === 'AbortError') throw new Cancelled(); }
      if (r && r.ok) return d || { segments: [] };
      if (r && r.status === 401) throw new Error('세션이 만료됐어요. 다시 로그인해주세요.');
      const limited = r && r.status === 429;
      if (!limited && attempt >= 8) throw new Error('받아쓰기 실패: ' + ((d && (d.detail || d.error)) || (r ? r.status : '인터넷 연결')));
      if (limited && attempt >= 60) throw new Error('음성 인식 사용량 한도가 풀리지 않았어요. 잠시 뒤 다시 해 주세요.');
      const wait = limited ? Math.min(60, Math.max(Number(d && d.retryAfter) || 0, 15)) : Math.min(20, 2 * attempt);
      label(limited ? `음성 인식 사용량 한도 — ${wait}초 기다렸다 계속해요…` : `음성 인식이 잠깐 느려요 — ${wait}초 뒤 이어서 해요…`);
      await sleep(wait * 1000);
    }
  }
  // 저장한 녹화(아직 쉐도잉을 만들지 않은 녹화): 약 25초씩 받아써서 대사를 얻고, 목소리로 선생님·학생을 나눠요
  async function transcribeAll(pcm) {
    const pieces = VT.splitAudio(louder(pcm), 25), out = new Array(pieces.length);
    let next = 0, done = 0;
    const worker = async () => {
      while (next < pieces.length) {
        const i = next++;
        const label = l => prog(0.42 + done / pieces.length * 0.38, `${l} (${done + 1}/${pieces.length})`);
        label(`📝 대사 받아쓰는 중… ${mmss(pieces[i].offset)}~`);
        const d = await askStt(pieces[i].pcm, label);
        out[i] = (d.segments || []).map(s => ({ s: +(s.s + pieces[i].offset).toFixed(2), e: +(s.e + pieces[i].offset).toFixed(2), en: String(s.text || '').trim() })).filter(s => s.en && s.e > s.s);
        done++;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    const sents = out.flat().sort((a, b) => a.s - b.s);
    try {
      const r = window.LessonVoice ? LessonVoice.speakers(sents, pcm, VT.SR) : null;
      if (r && r.ok) sents.forEach((x, i) => { x.sp = r.labels[i] || ''; });
    } catch (e) { console.warn('[하이라이트 목소리 나누기]', e); }
    return sents;
  }

  /* ---------------- ③ 5초마다 점수 ---------------- */
  function binScores(sents, pcm, dur) {
    const n = Math.ceil(dur / BIN), B = Array.from({ length: n }, () => ({ s: 0, t: 0, k: 0, turns: 0, fun: 0, loud: 0, skill: 0 }));
    const SR = VT.SR, fr = Math.floor(SR * 0.1), rms = [];
    for (let k = 0; k * fr < pcm.length; k++) { let e = 0; const a = k * fr, b = Math.min(pcm.length, a + fr); for (let i = a; i < b; i++) e += pcm[i] * pcm[i]; rms.push(Math.sqrt(e / Math.max(1, b - a))); }
    const voiced = rms.filter(v => v > 0.003).sort((a, b) => a - b), med = voiced[Math.floor(voiced.length / 2)] || 0.01;
    rms.forEach((v, k) => { const b = Math.floor(k * 0.1 / BIN); if (B[b]) B[b].loud += Math.min(3, v / med) / (BIN * 10); });
    sents.forEach((x, i) => {
      for (let t = Math.floor(x.s / BIN); t <= Math.floor(Math.max(x.s, x.e - 0.01) / BIN) && t < n; t++) {
        const ov = Math.max(0, Math.min(x.e, (t + 1) * BIN) - Math.max(x.s, t * BIN));
        if (HANGUL.test(x.en)) B[t].k += ov; else if (x.sp === 'S') B[t].s += ov; else B[t].t += ov;
      }
      const b = B[Math.floor(x.s / BIN)];
      if (!b) return;
      b.fun += (x.en.match(FUN) || []).length;
      // 말하기 실력: 학생이 영어로 길게(4단어 이상) 말한 문장일수록 더해요
      if (x.sp === 'S' && !HANGUL.test(x.en)) { const w = (x.en.match(/[A-Za-z']+/g) || []).length; if (w >= 4) b.skill += Math.min(12, w) / 4; }
      const p = sents[i - 1];
      if (p && p.sp && x.sp && p.sp !== x.sp && x.s - p.e < 3) b.turns++;
    });
    return B.map(b => 1.2 * b.s / BIN + 0.35 * Math.min(b.t, 3) / BIN + 0.8 * b.turns + 0.7 * Math.min(b.skill, 4) + 1.5 * Math.min(b.fun, 3) + 0.4 * Math.max(0, b.loud - 0.8) - 0.6 * b.k / BIN - (b.s + b.t < 1 ? 0.8 : 0));
  }
  const winScore = (sc, a, b) => { let s = 0; for (let k = Math.floor(a / BIN); k < Math.ceil(b / BIN) && k < sc.length; k++) s += sc[k]; return s; };
  // 활발한 60초 구간(겹치지 않게) — AI 힌트와, AI가 못 고를 때 쓰는 골라내기
  function topWindows(sc, from, to, len, count) {
    const out = [];
    for (let c = 0; c < count; c++) {
      let best = null;
      for (let a = from; a + len <= to; a += BIN) {
        if (out.some(w => a < w.to + 10 && a + len > w.from - 10)) continue;
        const s = winScore(sc, a, a + len) / (len / BIN);
        if (!best || s > best.score) best = { from: a, to: a + len, score: s };
      }
      if (!best) break;
      out.push(best);
    }
    return out;
  }
  // 문장 경계에 맞추기: 시작은 그 시간에 걸친 문장의 시작, 끝은 그 시간에 걸친 문장의 끝
  function snapToLines(seg, sents, dur) {
    let a = seg.from, b = seg.to;
    const sa = sents.find(x => x.e > a); if (sa && sa.s <= a + 3) a = sa.s;
    const sb = sents.filter(x => x.s < b).pop(); if (sb && sb.e >= b - 3) b = sb.e;
    return Object.assign({}, seg, { from: Math.max(0, a - 0.6), to: Math.min(dur, b + 0.8) });
  }
  function mergeSegs(list) {
    const out = [];
    list.slice().sort((x, y) => x.from - y.from).forEach(s => { const p = out[out.length - 1]; if (p && s.from <= p.to + 2) { p.to = Math.max(p.to, s.to); p.why = [p.why, s.why].filter(Boolean).join(' · '); } else out.push(Object.assign({}, s)); });
    return out;
  }
  const total = segs => segs.reduce((a, s) => a + (s.to - s.from), 0);
  // 합쳐서 3~6분이 되게: 짧으면 점수 높은 구간을 더하거나 넓히고, 길면 점수 낮은 구간부터 줄여요
  function fitTotal(segs, sc, sents, from, to, dur) {
    segs = mergeSegs(segs);
    for (let guard = 0; total(segs) < MIN_SEC && guard < 12; guard++) {
      const need = Math.min(150, Math.max(40, AIM_SEC - total(segs)));
      const add = topWindows(sc.map((v, k) => (segs.some(s => k * BIN < s.to + 5 && (k + 1) * BIN > s.from - 5) ? -99 : v)), from, to, Math.min(need, Math.max(40, to - from)), 1)[0];
      if (add && add.score > -50) { segs = mergeSegs(segs.concat([snapToLines(Object.assign(add, { why: '' }), sents, dur)])); continue; }
      segs.forEach(s => { s.from = Math.max(from, s.from - 10); s.to = Math.min(to, s.to + 10); }); // 더할 곳이 없으면 넓혀요
      segs = mergeSegs(segs);
    }
    while (total(segs) > FIT_MAX && segs.length) {
      const over = total(segs) - FIT_MAX;
      const worst = segs.slice().sort((x, y) => winScore(sc, x.from, x.to) / (x.to - x.from) - winScore(sc, y.from, y.to) / (y.to - y.from))[0];
      if (segs.length > 2 && worst.to - worst.from <= over + 20) { segs = segs.filter(s => s !== worst); continue; }
      const longest = segs.slice().sort((x, y) => (y.to - y.from) - (x.to - x.from))[0];
      const cut = Math.min(over, longest.to - longest.from - 30);
      const end = longest.to - cut, sb = sents.filter(x => x.e <= end + 0.5 && x.e > longest.from + 20).pop();
      longest.to = sb ? Math.min(end, sb.e + 0.8) : end;
      if (cut <= 0) break;
    }
    return segs.filter(s => s.to - s.from >= 8);
  }
  function scorePick(sc, sents, from, to, dur) {
    const wins = topWindows(sc, from, to, 75, 4).sort((a, b) => a.from - b.from).map(w => snapToLines(Object.assign(w, { why: '' }), sents, dur));
    return fitTotal(wins, sc, sents, from, to, dur);
  }

  /* ---------------- ④ AI로 고르기 ---------------- */
  async function aiPick(sents, sc, title, from, to, dur) {
    const lines = sents.filter(x => x.s >= from - 1 && x.e <= to + 1);
    if (lines.length < 8) return null;
    const hints = topWindows(sc, from, to, 60, 6);
    let d = null;
    for (let t = 1; t <= 3 && !d; t++) {
      check();
      try { d = await apiFetch('/api/admin-lesson-highlight', { method: 'POST', body: JSON.stringify({ title, minSec: MIN_SEC, maxSec: MAX_SEC, hints, lines: lines.slice(0, 900).map(x => ({ t: x.s, sp: x.sp || '', en: x.en })) }) }); }
      catch (e) { if (/세션/.test(e.message)) throw e; await sleep(4000 * t); }
    }
    const segs = (d && d.segments || []).map(s => {
      const a = lines[s.from], b = lines[s.to], nx = lines[s.to + 1];
      if (!a || !b) return null;
      return { from: Math.max(0, a.s - 0.6), to: Math.min(dur, nx ? Math.min(b.e + 0.8, Math.max(b.e, nx.s - 0.1)) : b.e + 0.8), why: s.why || '' };
    }).filter(s => s && s.to - s.from >= 10);
    if (!segs.length) return null;
    return fitTotal(segs, sc, sents, from, to, dur);
  }

  /* ---------------- ⑤ 영어·한글 자막 ---------------- */
  // 고른 구간에 나오는 문장 중 한국어 뜻이 없는 문장만 번역해요
  // 한글 자막은 꼭 넣어요: 묶음마다 세 번까지 묻고(사용량 한도면 기다렸다가), 그래도 빈 문장은 10문장씩 다시, 마지막엔 한 문장씩 번역해요.
  const inSegs = (segs, x) => segs.some(s => x.e > s.from && x.s < s.to);
  const needKo = x => x.en && !HANGUL.test(x.en) && !HANGUL.test(x.ko || '');
  async function askKo(batch, sents, title) {
    const at = sents.indexOf(batch[0]);
    const before = sents.slice(Math.max(0, at - 4), Math.max(0, at)).map(x => (x.sp === 'S' ? 'S: ' : x.sp === 'T' ? 'T: ' : '') + x.en);
    for (let attempt = 1; attempt <= 3; attempt++) {
      check();
      try {
        const d = await apiFetch('/api/admin-translate', { method: 'POST', body: JSON.stringify({ lesson: true, sentences: batch.map(x => x.en), sp: batch.map(x => x.sp || ''), before, title }) });
        if (d && Array.isArray(d.ko)) batch.forEach((x, k) => { if (d.ko[k] && HANGUL.test(d.ko[k])) x.ko = d.ko[k]; });
        if (!batch.some(needKo)) return;
      } catch (e) {
        if (/세션/.test(e.message) || e.cancelled) throw e;
        console.warn('[하이라이트 번역]', e);
        await sleep((/한도|429|rate/i.test(e.message) ? 10000 : 1500) * attempt);
      }
    }
  }
  async function fillKorean(segs, sents, title) {
    const todo = () => sents.filter(x => needKo(x) && inSegs(segs, x));
    const all = todo().length;
    for (const B of [20, 10]) {
      const list = todo();
      for (let i = 0; i < list.length; i += B) {
        prog(0.87, `🇰🇷 자막 한국어 번역 중… ${all - todo().length}/${all}`);
        await askKo(list.slice(i, i + B), sents, title);
      }
    }
    for (const x of todo()) { check(); const t = (VT && VT.translate && await VT.translate(x.en)) || ''; if (HANGUL.test(t)) x.ko = t; await sleep(150); }
    const shown = sents.filter(x => x.en && !HANGUL.test(x.en) && inSegs(segs, x));
    return { ko: shown.filter(x => HANGUL.test(x.ko || '')).length, total: shown.length };
  }
  const assTime = t => { t = Math.max(0, t); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60; return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`; };
  const assText = t => String(t || '').replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();
  // 한 구간의 자막 파일(ASS): 위 줄 영어(흰색 큰 글씨) · 아래 줄 한국어(노란색) — 시간은 구간 안에서의 초
  function segAss(seg, sents) {
    const head = '[Script Info]\nScriptType: v4.00+\nPlayResX: 1280\nPlayResY: 720\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\n'
      + 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
      // 글자 뒤에 반투명 검은 상자(BorderStyle 3) — 흰 교재 화면 위에서도 잘 읽히게
      + 'Style: En,NanumGothic,42,&H00FFFFFF,&H00FFFFFF,&H60000000,&H60000000,-1,0,0,0,100,100,0,0,3,5,0,2,40,40,82,1\n'
      + 'Style: Ko,NanumGothic,36,&H0066E5FF,&H0066E5FF,&H60000000,&H60000000,-1,0,0,0,100,100,0,0,3,5,0,2,40,40,30,1\n\n'
      + '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
    const dur = seg.to - seg.from, rows = [];
    const list = sents.filter(x => x.e > seg.from && x.s < seg.to);
    list.forEach((x, i) => {
      const nx = list[i + 1];
      const a = x.s - seg.from, z = Math.min(dur, Math.max(x.e - seg.from + 0.3, a + 1.2), nx ? Math.max(x.e - seg.from, nx.s - seg.from) : dur);
      if (z <= 0 || a >= dur) return;
      const en = assText(x.en), ko = assText(x.ko);
      if (HANGUL.test(en)) rows.push(`Dialogue: 0,${assTime(a)},${assTime(z)},Ko,,0,0,0,,${en}`);
      else {
        if (en) rows.push(`Dialogue: 0,${assTime(a)},${assTime(z)},En,,0,0,0,,${en}`);
        if (ko) rows.push(`Dialogue: 0,${assTime(a)},${assTime(z)},Ko,,0,0,0,,${ko}`);
      }
    });
    return head + rows.join('\n') + '\n';
  }
  async function loadFont() {
    try {
      const r = await fetch('https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumgothic/NanumGothic-Bold.ttf');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      await ff.createDir('/fonts');
      await ff.writeFile('/fonts/NanumGothic-Bold.ttf', new Uint8Array(await r.arrayBuffer()));
      return true;
    } catch (e) { console.warn('[하이라이트 글꼴]', e); return false; }
  }

  /* ---------------- ⑥ 자막을 새기며 자르고 이어 붙이기 ---------------- */
  async function cutOne(seg, k, subs) {
    const len = (seg.to - seg.from).toFixed(2), nm = `p${k}.mp4`;
    if (!subs) return { nm, rc: await ff.exec(['-ss', seg.from.toFixed(2), '-i', 'in.mp4', '-t', len, '-c', 'copy', '-avoid_negative_ts', 'make_zero', nm]) };
    return { nm, rc: await ff.exec(['-ss', seg.from.toFixed(2), '-i', 'in.mp4', '-t', len, '-vf', `subtitles=s${k}.ass:fontsdir=/fonts`, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', '-pix_fmt', 'yuv420p', '-r', '25', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', nm]) };
  }
  async function cutAndJoin(segs, sents) {
    prog(0.88, '🔤 자막 글꼴을 불러오는 중…');
    let subs = await loadFont();
    const all = total(segs);
    for (let pass = 0; pass < 2; pass++) {
      const names = [];
      let doneSec = 0, ok = true;
      for (let k = 0; k < segs.length; k++) {
        check();
        const seg = segs[k], len = seg.to - seg.from;
        const label = `✂️ ${k + 1}/${segs.length}번째 구간${subs ? '에 영어·한글 자막을 넣는 중' : ' 자르는 중'}… ${mmss(seg.from)}~${mmss(seg.to)}`;
        prog(0.9 + doneSec / all * 0.08, label);
        if (subs) await ff.writeFile(`s${k}.ass`, segAss(seg, sents));
        onEncode = sec => { const p = Math.min(1, sec / len); prog(0.9 + (doneSec + p * len) / all * 0.08, `${label} ${Math.round(p * 100)}%`); };
        const { nm, rc } = await cutOne(seg, k, subs);
        onEncode = null;
        if (rc !== 0) { ok = false; break; }
        names.push(nm); doneSec += len;
      }
      if (!ok) {
        if (!subs) throw new Error('녹화를 자르지 못했어요.');
        console.warn('[하이라이트 자막] 자막을 넣지 못해 자막 없이 잘라요');
        subs = false; continue;
      }
      prog(0.98, '🎬 구간을 한 영상으로 이어 붙이는 중…');
      await ff.writeFile('list.txt', names.map(n => `file '${n}'`).join('\n'));
      await ff.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', '-movflags', '+faststart', 'out.mp4']);
      const out = await ff.readFile('out.mp4');
      if (!out || out.length < 10000) throw new Error('편집한 영상이 비어 있어요.');
      return { blob: new Blob([out.buffer], { type: 'video/mp4' }), subs };
    }
    throw new Error('녹화를 자르지 못했어요.');
  }

  /* ---------------- 💾 그 학생 이름으로 저장 ---------------- */
  // 만든 하이라이트는 그 학생 이름으로 저장만 해요 — 학생 화면에 바로 나오지 않고,
  // 「🎁 학생별 쉐도잉 넣어주기」의 「✂️ 수업영상 하이라이트」에서 넣어 준 학생에게만 보여요. 3.5MB 조각으로 올려요
  const HAPI = '/api/admin-highlights', HL_CHUNK = 3.5 * 1024 * 1024; // _lib/highlights.mjs의 HL_CHUNK와 같아야 해요
  async function saveToStudent(u, info, blob) {
    const { highlight: h } = await apiFetch(HAPI, { method: 'POST', body: JSON.stringify(Object.assign({ action: 'start', u, size: blob.size }, info)) });
    const total = Math.ceil(blob.size / HL_CHUNK);
    let next = 0, done = 0;
    const worker = async () => {
      while (next < total) {
        const n = next++;
        for (let attempt = 1; ; attempt++) {
          try {
            const r = await fetch(`${HAPI}?u=${encodeURIComponent(u)}&id=${h.id}&n=${n}`, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, auth()), body: blob.slice(n * HL_CHUNK, Math.min(blob.size, (n + 1) * HL_CHUNK)) });
            if (r.status === 401) throw Object.assign(new Error('세션이 만료됐어요. 다시 로그인해주세요.'), { fatal: true });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            break;
          } catch (e) { if (e.fatal || attempt >= 5) throw e; await sleep(1500 * attempt); }
        }
        done++; prog(done / total, `💾 저장 중… ${Math.round(done / total * 100)}%`);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return (await apiFetch(HAPI, { method: 'POST', body: JSON.stringify({ action: 'finish', u, id: h.id }) })).highlight;
  }
  async function loadSaved() {
    const u = $('hlMember').value, box = $('hlSaved');
    if (!u) { box.innerHTML = ''; return; }
    let list = [];
    try { list = (await apiFetch(`${HAPI}?u=${encodeURIComponent(u)}`)).highlights || []; } catch (e) {}
    if ($('hlMember').value !== u) return;
    box.innerHTML = `<h3 style="margin:18px 0 8px; color:#AD1457;">💾 ${esc(memberLabel(u))} 학생 이름으로 저장한 수업영상 하이라이트</h3><div class="meta" style="margin:-4px 0 8px;">학생 화면에는 「🎁 학생별 쉐도잉 넣어주기 → ✂️ 수업영상 하이라이트」에서 넣어 줘야 보여요.</div>` + (list.length ? list.map(h => `
      <div class="set-item set-stack">
        <div>
          <div class="title">✂️ ${esc(h.title)} 하이라이트${h.status === 'ready' ? '' : ' <span class="pill">⚠️ 저장 중 멈춤</span>'}</div>
          <div class="meta">${h.duration ? mmss(h.duration) + ' · ' : ''}${(h.size / 1e6).toFixed(1)}MB${h.subs ? ' · ' + esc(h.subs) : ''} · ${esc(String(h.createdAt || '').slice(0, 10))} 저장 · ${(h.to || []).length ? '🎓 넣어 줌: ' + (h.to || []).map(x => esc(memberLabel(x))).join(', ') : '<span style="color:var(--bad)">학생 화면에 아직 안 넣어 줌</span>'}</div>
        </div>
        <div class="set-btns">${h.url && h.status === 'ready' ? `<a class="btn-ghost btn-small" href="${esc(h.url)}" target="_blank" rel="noopener">▶ 보기</a>` : ''}<button class="btn-danger btn-small" data-hldel="${esc(h.id)}">🗑 지우기</button></div>
      </div>`).join('') : '<div class="empty">아직 이 학생 이름으로 저장한 하이라이트가 없어요. 하이라이트를 만들면 바로 저장돼요.</div>');
  }

  // 관리자 창이 배포 전에 열려 있으면 예전 코드로 만들어질 수 있어서 —
  // 만들기·올리기 전에 서버의 최신 코드인지 보고, 아니면 새로고침해요. (배포할 때 HL_BUILD를 올려요)
  const HL_BUILD = '20261113b';
  async function stale() {
    try {
      const t = await (await fetch('/js/lesson-highlight.js?t=' + Date.now(), { cache: 'no-store' })).text();
      const m = /const HL_BUILD = '(\w+)'/.exec(t);
      if (m && m[1] !== HL_BUILD) { alert('관리자 화면이 새 버전으로 바뀌었어요. 새로고침한 뒤 다시 눌러 주세요.'); location.reload(); return true; }
    } catch (e) {}
    return false;
  }

  // 📁 내려받아 둔 하이라이트 파일(mp4)을 그 학생 이름으로 저장해요 — 다시 만들지 않아도 돼요
  const videoDuration = file => new Promise(res => {
    const v = document.createElement('video'), url = URL.createObjectURL(file);
    const done = d => { URL.revokeObjectURL(url); res(isFinite(d) ? d : 0); };
    v.preload = 'metadata'; v.onloadedmetadata = () => done(v.duration); v.onerror = () => done(0);
    setTimeout(() => done(0), 15000); v.src = url;
  });
  async function uploadFile() {
    const u = $('hlMember').value, file = $('hlFile').files && $('hlFile').files[0];
    if (!u) { alert('먼저 학생을 선택하세요.'); return; }
    if (!file) { alert('올릴 하이라이트 파일(mp4)을 고르세요.'); return; }
    const fileUser = (/^([^\s(]+)\(/.exec(file.name) || [])[1];
    if (fileUser && fileUser.toLowerCase() !== u.toLowerCase() && !confirm(`파일 이름은 ${fileUser} 학생 것인데, ${memberLabel(u)} 학생 이름으로 저장할까요?`)) return;
    if (busy || await stale()) return;
    busy = true; cancelled = false;
    $('hlProgress').classList.remove('hidden');
    const title = file.name.replace(/\.[^.]+$/, '').replace(/\s*하이라이트\s*$/, '').trim() || `${memberLabel(u)} 수업`;
    const date = (/(\d{4}-\d{2}-\d{2})/.exec(file.name) || [])[1] || '';
    setStatus('hlStatus', `💾 「${title}」 하이라이트를 ${memberLabel(u)} 학생 이름으로 저장하는 중이에요…`);
    try {
      await saveToStudent(u, { title, date, duration: await videoDuration(file), subs: '' }, file);
      prog(1, '완료');
      setStatus('hlStatus', `✅ ${memberLabel(u)} 학생 이름으로 저장했어요. 「🎁 학생별 쉐도잉 넣어주기」에서 넣어 주면 학생 화면에 보여요.`, 'success');
      $('hlFile').value = '';
    } catch (e) {
      setStatus('hlStatus', '⚠️ 올리지 못했어요: ' + e.message, 'error');
    } finally { busy = false; loadSaved(); }
  }

  /* ---------------- 하이라이트 만들기 ---------------- */
  async function make(x) {
    if (busy || await stale()) return;
    busy = true; cancelled = false; ctl = new AbortController();
    $('hlCancelBtn').classList.remove('hidden'); $('hlProgress').classList.remove('hidden');
    $('hlResult').innerHTML = ''; if (outUrl) { URL.revokeObjectURL(outUrl); outUrl = null; }
    const u = $('hlMember').value, who = memberLabel(u);
    const title = `${who} ${x.date || ''} 수업`.trim();
    setStatus('hlStatus', `✂️ ${title} 하이라이트를 만드는 중이에요. 이 창을 닫지 마세요.`);
    try {
      prog(0, '🎥 녹화 받는 중…');
      const got = x.lessonId ? await lessonFile(x.lessonId) : await savedFile(x);
      check();
      await openFfmpeg(got.file);
      const pcm = await audioPcm();
      const dur = pcm.length / VT.SR;
      let sents = ((got.lesson && got.lesson.sentences) || []).filter(s => s && s.en && s.e > s.s).map(s => ({ s: s.s, e: s.e, en: s.en, ko: s.ko || '', sp: s.sp || '' }));
      if (sents.length < 10) sents = await transcribeAll(pcm);
      if (sents.length < 8) throw new Error('녹화에서 대사를 거의 찾지 못했어요.');
      check();
      prog(0.82, '📊 학생 참여도 · 즐거운 순간을 분석하는 중…');
      const sc = binScores(sents, pcm, dur);
      // 수업 앞뒤(기다리기 · 인사)는 빼고 첫 대사 ~ 마지막 대사 사이에서 골라요
      const from = Math.max(0, sents[0].s - 1), to = Math.min(dur, sents[sents.length - 1].e + 1);
      prog(0.85, '🤖 AI가 하이라이트 구간을 고르는 중…');
      let segs = null, how = 'AI';
      try { segs = await aiPick(sents, sc, title, from, to, dur); } catch (e) { if (e.cancelled || /세션/.test(e.message)) throw e; console.warn('[하이라이트 AI]', e); }
      if (!segs || !segs.length) { segs = scorePick(sc, sents, from, to, dur); how = '점수'; }
      if (!segs.length) throw new Error('하이라이트로 고를 구간을 찾지 못했어요.');
      const kr = await fillKorean(segs, sents, title);
      const { blob, subs } = await cutAndJoin(segs, sents);
      outUrl = URL.createObjectURL(blob);
      const fname = `${title.replace(/[\\/:*?"<>|]+/g, '')} 하이라이트.mp4`;
      $('hlResult').innerHTML = `
        <div style="border:3px solid #AD1457; border-radius:14px; padding:12px; background:#FFF; margin-top:10px;">
          <b style="color:#AD1457;">✂️ ${esc(title)} 하이라이트 · ${mmss(total(segs))}</b> <span class="pill">${subs ? `🔤 영어·한글 자막 (한글 ${kr.ko}/${kr.total}문장)` : '⚠️ 자막 없이'}</span>
          <video src="${outUrl}" controls playsinline style="display:block; width:100%; max-height:60vh; margin:10px 0; background:#000; border-radius:10px;"></video>
          <a class="btn-primary" href="${outUrl}" download="${esc(fname)}" style="display:inline-block; text-decoration:none;">⬇️ 하이라이트 파일 내려받기 (${(blob.size / 1e6).toFixed(1)}MB)</a>
          <div class="meta" style="margin-top:10px;">고른 구간(녹화 시간 · ${how === 'AI' ? 'AI가 대사를 보고 고름' : '학생 말한 시간 · 말 주고받기 · 웃음/칭찬 점수로 고름'}):</div>
          <ol style="margin:6px 0 0 18px; font-size:0.88rem;">${segs.map(s => `<li>${mmss(s.from)} ~ ${mmss(s.to)} (${Math.round(s.to - s.from)}초)${s.why ? ' — ' + esc(s.why) : ''}</li>`).join('')}</ol>
        </div>`;
      // 만든 하이라이트를 그 학생 이름으로 저장해요 — 학생 화면에는 넣어주기에서 넣어 줘야 보여요
      let savedMsg = '';
      try {
        await saveToStudent(u, { title, date: x.date || '', duration: total(segs), subs: subs ? `영어·한글 자막 (한글 ${kr.ko}/${kr.total}문장)` : '자막 없이' }, blob);
        savedMsg = ` 💾 ${who} 학생 이름으로 저장했어요 — 「🎁 학생별 쉐도잉 넣어주기 → ✂️ 수업영상 하이라이트」에서 넣어 주면 학생 화면에 보여요.`;
      } catch (e) {
        if (/세션/.test(e.message)) throw e;
        savedMsg = ` ⚠️ 저장하지 못했어요(${e.message}) — 내려받은 파일을 「📁 만든 하이라이트 파일 올리기」로 올려 주세요.`;
      }
      loadSaved();
      prog(1, `완료 — ${mmss(total(segs))}`);
      setStatus('hlStatus', `✅ ${title} 하이라이트(${mmss(total(segs))}, ${segs.length}구간)를 만들었어요.${savedMsg} 「⬇️ 하이라이트 파일 내려받기」로 내려받을 수도 있어요.`, /⚠️/.test(savedMsg) ? 'error' : 'success');
    } catch (e) {
      setStatus('hlStatus', (e.cancelled || cancelled) ? '⏹ 중지했어요.' : '⚠️ 하이라이트 만들기 실패: ' + e.message, (e.cancelled || cancelled) ? '' : 'error');
    } finally {
      try { ff && ff.terminate(); } catch (e) {}
      ff = null; busy = false; ctl = null;
      $('hlCancelBtn').classList.add('hidden');
    }
  }

  $('hlMember').addEventListener('focus', renderMembers);
  $('hlMember').addEventListener('change', () => { loadList(); loadSaved(); });
  $('hlUploadBtn').addEventListener('click', uploadFile);
  $('hlSaved').addEventListener('click', async e => {
    const b = e.target.closest('[data-hldel]'); if (!b) return;
    if (!confirm('이 하이라이트를 지울까요? 학생 화면에서도 사라져요.')) return;
    b.disabled = true;
    try { await apiFetch(`${HAPI}?u=${encodeURIComponent($('hlMember').value)}&id=${encodeURIComponent(b.dataset.hldel)}`, { method: 'DELETE' }); } catch (err) { alert('지우지 못했어요: ' + err.message); }
    loadSaved();
  });
  $('hlList').addEventListener('click', e => { const b = e.target.closest('[data-hl]'); if (b) make(items[Number(b.dataset.hl)]); });
  $('hlCancelBtn').addEventListener('click', () => {
    if (!busy || !confirm('하이라이트 만들기를 중지할까요?')) return;
    cancelled = true; try { ctl && ctl.abort(); } catch (e) {} try { ff && ff.terminate(); } catch (e) {}
  });
  // 테스트용(관리자 화면 밖에서 쓰지 않아요)
  window.LessonHighlight = { saveToStudent, loadSaved, fillKorean, segAss, binScores, topWindows, scorePick, fitTotal, snapToLines, mergeSegs };
})();

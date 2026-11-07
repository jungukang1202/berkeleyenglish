/* 영상 쉐도잉 — 받아쓰기 결과를 쉐도잉용 문장으로 정리하는 공용 함수 (관리자 페이지에서 사용)
 *  - extractAudio(file)            : 영상/음성 파일 → 16kHz 모노 Float32Array
 *  - splitAudio(pcm, sec)          : 말이 끊긴 조용한 지점에서 약 sec초씩 자르기
 *  - encodeWav(pcm)                : WAV 바이너리
 *  - buildSentences(results, dur)  : 조각별 받아쓰기 결과 → [{s,e,en}]
 *  - planParts(dur, sents, min)    : N분 단위 파트 경계(문장 사이 쉼에서 자름)
 */
(function (root) {
  const SR = 16000;
  const ABBREV = new Set(['mr.', 'mrs.', 'ms.', 'dr.', 'st.', 'vs.', 'etc.', 'e.g.', 'i.e.', 'jr.', 'sr.', 'prof.', 'inc.', 'no.', 'u.s.', 'u.k.', 'a.m.', 'p.m.', 'approx.']);

  async function extractAudio(file, onProgress) {
    const buf = await file.arrayBuffer();
    onProgress && onProgress('소리 추출 중…');
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    // OfflineAudioContext의 sampleRate(16kHz)로 자동 변환되어 디코딩됩니다.
    const ctx = new Ctx(1, SR, SR);
    let audio;
    try {
      audio = await ctx.decodeAudioData(buf);
    } catch (e) {
      throw new Error('이 파일의 소리를 읽지 못했어요. MP4(H.264/AAC)·MP3·M4A·WebM 파일을 Chrome에서 올려주세요.');
    }
    const len = audio.length;
    const out = new Float32Array(len);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const d = audio.getChannelData(c);
      for (let i = 0; i < len; i++) out[i] += d[i] / audio.numberOfChannels;
    }
    return { pcm: out, duration: len / SR };
  }

  // 약 targetSec초마다, 앞뒤 8초 안에서 가장 조용한 0.2초 지점을 찾아 자릅니다(단어가 잘리지 않게).
  function splitAudio(pcm, targetSec = 100) {
    const win = Math.floor(SR * 0.2);
    const pieces = [];
    let start = 0;
    while (start < pcm.length) {
      let end = start + targetSec * SR;
      if (end >= pcm.length - SR * 15) { pieces.push([start, pcm.length]); break; }
      const from = Math.max(start + SR * 30, end - SR * 8), to = Math.min(pcm.length - win, end + SR * 8);
      let best = end, bestE = Infinity;
      for (let p = from; p < to; p += Math.floor(win / 2)) {
        let e = 0;
        for (let i = p; i < p + win; i += 4) e += pcm[i] * pcm[i];
        if (e < bestE) { bestE = e; best = p + Math.floor(win / 2); }
      }
      pieces.push([start, best]);
      start = best;
    }
    return pieces.map(([a, b]) => ({ offset: a / SR, pcm: pcm.subarray(a, b) }));
  }

  function encodeWav(pcm) {
    const buf = new ArrayBuffer(44 + pcm.length * 2);
    const v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    let o = 44;
    for (let i = 0; i < pcm.length; i++, o += 2) {
      const s = Math.max(-1, Math.min(1, pcm[i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  const norm = t => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');

  // 구간(segment) 문장부호가 붙은 글자들에 단어별 시간(words)을 맞춰 붙입니다.
  function alignSegment(seg, words) {
    const toks = seg.text.split(/\s+/).filter(Boolean);
    const out = [];
    let j = 0;
    for (const tok of toks) {
      const nt = norm(tok);
      if (!nt) { // 기호만 있는 토큰("-", "…")은 앞 단어에 붙임
        if (out.length) out[out.length - 1].w += ' ' + tok;
        continue;
      }
      let k = j, acc = '', hit = -1;
      while (k < words.length && k < j + 6) {
        acc += norm(words[k].w);
        if (acc === nt) { hit = k; break; }
        if (!nt.startsWith(acc)) break;
        k++;
      }
      if (hit < 0) { // 한 단어 건너뛰어 다시 맞춰보기
        for (let t = j; t < Math.min(words.length, j + 4); t++) if (norm(words[t].w) === nt) { j = t; hit = t; break; }
      }
      if (hit >= 0) { out.push({ w: tok, s: words[j].s, e: words[hit].e }); j = hit + 1; }
      else out.push({ w: tok, s: null, e: null });
    }
    // 시간이 비는 단어는 구간 안에서 앞뒤 단어 사이로 채워 넣기
    for (let i = 0; i < out.length; i++) {
      if (out[i].s != null) continue;
      const prev = i ? out[i - 1].e : seg.s;
      let n = i; while (n < out.length && out[n].s == null) n++;
      const next = n < out.length ? out[n].s : seg.e;
      const step = Math.max(0.05, (next - prev) / (n - i + 1));
      for (let t = i; t < n; t++) { out[t].s = prev + step * (t - i + 0.2); out[t].e = prev + step * (t - i + 1); }
      i = n - 1;
    }
    return out;
  }

  function endsSentence(w) {
    const lw = w.toLowerCase();
    if (ABBREV.has(lw) || /^(?:[a-z]\.){2,}$/.test(lw)) return false;
    return /[.?!…]["'”’)\]]*$/.test(w);
  }

  // results: [{ offset, segments:[{s,e,text}], words:[{w,s,e}] }]  (조각 순서대로)
  function buildSentences(results, duration) {
    const all = [];
    for (const r of results) {
      const ws = (r.words || []).slice();
      for (const seg of r.segments || []) {
        const inSeg = ws.filter(w => w.s >= seg.s - 0.3 && w.e <= seg.e + 0.3);
        const aligned = inSeg.length ? alignSegment(seg, inSeg) : alignSegment(seg, []);
        aligned.forEach(w => all.push({ w: w.w, s: w.s + r.offset, e: w.e + r.offset }));
      }
    }
    all.sort((a, b) => a.s - b.s);
    return wordsToSentences(all, duration, true);
  }

  // 붙여넣은 스크립트는 자막 한 줄의 시작 시간만 정확해요. 줄 가운데서 끝나는 문장의 경계가 맞도록,
  // 말이 쉬는 곳(. ! ? 뒤 0.4초쯤, 쉼표 뒤 0.2초쯤)까지 계산해서 줄 안의 단어 시간을 다시 나눠요.
  function spreadWithPauses(all) {
    const out = all.map(w => Object.assign({}, w));
    for (let i = 0; i < out.length;) {
      let n = i; while (n + 1 < out.length && out[i].cue != null && out[n + 1].cue === out[i].cue) n++;
      if (out[i].cue != null && n > i) {
        const from = out[i].s, to = out[n].e;
        const pause = k => (k === n ? 0 : endsSentence(out[k].w) ? 7 : /[,;:]$/.test(out[k].w) ? 3 : 0);
        const len = k => out[k].w.length + 1;
        let total = 0; for (let k = i; k <= n; k++) total += len(k) + pause(k);
        const unit = (to - from) / (total || 1);
        let t = from;
        for (let k = i; k <= n; k++) { out[k].s = t; t += len(k) * unit; out[k].e = t; t += pause(k) * unit; }
      }
      i = n + 1;
    }
    return out;
  }

  // 단어 목록 → 문장. punctuated=false(YouTube 자동 자막처럼 문장부호가 없음)면 말이 쉬는 곳에서 나눕니다.
  // opts.pauseCut: AI로 문장부호를 복원한 자막이면, AI가 마침표를 놓친 곳이라도 1.2초 넘게 말이 끊기면 문장을 나눕니다.
  function wordsToSentences(all, duration, punctuated, opts = {}) {
    all = spreadWithPauses(all);
    const groups = []; let cur = [];
    all.forEach((w, i) => {
      cur.push(w);
      const nx = all[i + 1];
      const gap = nx ? nx.s - w.e : 99;
      const n = cur.length;
      const cut = punctuated
        // 문장부호가 있으면 문장 끝(. ? !)에서만 자릅니다 — 긴 문장도 한 문장으로 유지
        // (5초 넘게 말이 없거나, 문장부호 없이 60단어를 넘는 경우만 예외)
        ? (!nx || endsSentence(w.w) || w.spk || gap > 5 || n >= 60 || (opts.pauseCut && gap >= 1.2 && n >= 2 && !/[,;:]$/.test(w.w)))
        : (!nx || (gap > 0.65 && n >= 3) || gap > 1.5 || (n >= 13 && gap > 0.25) || (w.brk && n >= 8) || n >= 20);
      if (cut) { groups.push(cur); cur = []; }
    });
    // 한두 단어짜리 조각("Okay.", "So,")은 붙어 있는 문장에 합치기
    const merged = [];
    groups.forEach(g => {
      const last = merged[merged.length - 1];
      if (last && g.length <= 2 && !endsSentence(last[last.length - 1].w) && g[0].s - last[last.length - 1].e < 0.8) last.push(...g);
      else merged.push(g);
    });
    return merged.map((g, k) => {
      let s = Math.max(0, g[0].s - 0.15);
      let e = g[g.length - 1].e + 0.3;
      const nx = merged[k + 1];
      if (nx) e = Math.min(e, nx[0].s + 0.05);
      e = Math.min(e, duration || e);
      let en = g.map(w => w.w).join(' ').replace(/\s+([,.?!;:])/g, '$1').trim();
      en = en.replace(/\bi\b/g, 'I').replace(/\bi'(m|ll|ve|d)\b/g, "I'$1");
      en = en.charAt(0).toUpperCase() + en.slice(1);
      if ((!punctuated || opts.pauseCut || g[g.length - 1].spk) && /[A-Za-z0-9'"]$/.test(en)) en += '.';
      return { s: +s.toFixed(2), e: +Math.max(e, s + 0.4).toFixed(2), en, ko: '' };
    });
  }

  // AI가 문장부호를 붙여 돌려준 글을 원래 단어(시간 포함)에 하나씩 맞춰 옮깁니다. 단어가 다르면 그 단어는 그대로 둡니다.
  function applyPunctuation(words, punctText) {
    const toks = String(punctText || '').replace(/[‖|»]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(t => norm(t));
    const out = words.map(w => Object.assign({}, w));
    let j = 0, hit = 0;
    for (let i = 0; i < out.length; i++) {
      const nw = norm(out[i].w);
      if (!nw) continue;
      let found = false;
      for (let t = j; t < Math.min(toks.length, j + 4); t++) {
        if (norm(toks[t]) === nw) { out[i].w = toks[t]; j = t + 1; hit++; found = true; break; }
      }
      // 앞뒤 단어는 맞는데 이 단어만 다르면 → AI가 잘못 들린 단어(이름 등)를 고친 것으로 보고 바꿔 씀
      if (!found && j < toks.length && i + 1 < out.length && toks[j + 1] && norm(toks[j + 1]) === norm(out[i + 1].w)) {
        out[i].w = toks[j]; out[i].fixed = 1; j += 1; hit++;
      }
    }
    return { words: out, ratio: out.length ? hit / out.length : 0 };
  }

  // AI에 보낼 글: 말이 0.6초 이상 끊긴 곳에 ‖ 표시 (문장이 끝났을 가능성이 높은 곳)
  function textWithPauses(ws) {
    return ws.map((w, k) => {
      const nx = ws[k + 1];
      const gap = nx ? nx.s - w.e : 0;
      return w.w + (nx && w.spk ? ' »' : nx && gap >= 0.6 ? ' ‖' : '');
    }).join(' ');
  }

  // 문장부호가 없는 자막 → AI로 문장부호 복원. ask(text)는 서버(/api/admin-punctuate)를 불러 글을 돌려주는 함수.
  // 250단어씩 보내되 뒤에 40단어를 더 붙여 보내서, 조각 끝에서 문장이 잘못 끊기지 않게 합니다.
  async function restorePunctuation(words, ask, onProg) {
    const STEP = 250, EXTRA = 40, LEAD = 20; // 앞뒤로 문맥을 조금 더 보내서 조각 경계에서 문장이 잘못 시작·끝나지 않게
    const out = words.map(w => Object.assign({}, w, { w: String(w.w).replace(/[.?!…]+$/, '') }));
    const base = out.map(w => Object.assign({}, w)); // 조각마다 같은 원본을 보고 (동시에 보내도 서로 섞이지 않게)
    const starts = [];
    for (let i = 0; i < out.length; i += STEP) starts.push(i);
    let okChunks = 0, fails = 0, done = 0, next = 0;
    // 빨리 만들기: 조각을 3개씩 동시에 AI에 보내요 (예전엔 하나씩 차례로)
    async function worker() {
      while (next < starts.length) {
        if (fails >= 3) return; // AI가 계속 응답하지 않으면 그만두고 예전 방식(말 쉬는 곳)으로 나눔
        const i = starts[next++];
        const from = Math.max(0, i - LEAD);
        const slice = base.slice(from, Math.min(base.length, i + STEP + EXTRA));
        let text = null;
        try { text = await ask(textWithPauses(slice)); } catch (e) { text = null; }
        done++; onProg && onProg(done / starts.length);
        if (!text) { fails++; continue; }
        const r = applyPunctuation(slice, text);
        if (r.ratio < 0.85) continue; // AI가 단어를 너무 많이 바꿨으면 이 조각은 쓰지 않음
        okChunks++;
        const lead = i - from;
        const keep = i + STEP >= out.length ? r.words.length - lead : STEP;
        for (let k = 0; k < keep; k++) out[i + k] = r.words[lead + k];
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    const total = starts.length;
    onProg && onProg(1);
    return { words: out, ok: okChunks > 0 && okChunks >= total * 0.6 };
  }

  // 저장된 문장들 → 대략적인 단어별 시간 (문장 다시 나누기용)
  function sentencesToWords(sents) {
    const words = [];
    sents.forEach(s => {
      const ws = String(s.en || '').split(/\s+/).filter(Boolean);
      const total = ws.reduce((a, w) => a + w.length + 1, 0) || 1;
      let t = s.s;
      // 예전에 문장 첫 글자라서 대문자가 된 단어는 소문자로 돌려 AI에 보냅니다 (이름은 AI가 다시 대문자로 써요)
      if (ws.length && !/^I('|$)/.test(ws[0])) ws[0] = ws[0].charAt(0).toLowerCase() + ws[0].slice(1);
      ws.forEach(w => { const d = Math.max(0.05, (s.e - s.s) * (w.length + 1) / total); words.push({ w, s: t, e: t + d * 0.95, ko: s.ko }); t += d; });
    });
    return words;
  }

  // YouTube "스크립트 표시"에서 복사한 글 → 단어별 시간. 이런 모양을 모두 읽어요:
  // 0:00 / 0:00 hi everyone welcome back / 0:000초[Music] / 0:1717초it was a chilly morning
  // hi everyone (한국어 화면은 시간 · 읽기용 시간(17초) · 대사가 붙어서 복사돼요)
  // 챕터 2: … / Chapter 2: … 같은 챕터 제목 줄은 대사가 아니라서 빼요
  const SPOKEN = '(?:\\d+\\s*(?:시간|분|초)\\s*)+|\\d+\\s*(?:hours?|minutes?|seconds?)(?:,?\\s*\\d+\\s*(?:hours?|minutes?|seconds?))*';
  const LEAD_TIME = new RegExp('^((?:\\d{1,2}:)?\\d{1,2}:\\d{2})(?:\\.\\d+)?\\s*(?:' + SPOKEN + ')?\\s*', 'i');
  function parsePastedTranscript(text) {
    let raw = String(text || '').replace(/\r/g, '').replace(/ /g, ' ');
    // 줄바꿈 없이 한 줄로 붙어서 복사된 경우: 시간(0:00)이 나올 때마다 줄을 나눠요
    // (시간 바로 뒤에 '1초' 같은 숫자가 붙어 와도 시간으로 봐요: "0:011초little fox")
    // (옛 Safari는 뒤돌아보기 정규식(?<!…)을 몰라서 앞 글자를 함께 잡아요)
    const STAMP = /(^|[^\d:])((?:\d{1,2}:)?\d{1,2}:\d{2})(?!:)/g;
    const stamps = (raw.match(STAMP) || []).length;
    if (stamps >= 3 && raw.split('\n').filter(l => l.trim()).length < stamps / 2) raw = raw.replace(STAMP, '$1\n$2');
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const TS = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.\d+)?$/;
    const toSec = m => (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]);
    const cues = [];
    // 한국어 YouTube 화면에서 복사하면 시간 아래에 "0초", "1분 5초", "1시간 2분" 같은 읽기용 줄이 함께 와요 → 대사가 아니라서 빼요
    const SPOKEN_TIME = new RegExp('^(?:' + SPOKEN + ')$', 'i');
    for (const line of lines) {
      if (SPOKEN_TIME.test(line)) continue;
      if (/^(?:챕터|chapter)\s*\d+\s*[:.]/i.test(line)) continue; // 챕터 제목
      const m = line.match(LEAD_TIME);
      if (m) { cues.push({ s: toSec(m[1].match(TS)), text: line.slice(m[0].length).trim() }); continue; }
      if (cues.length) cues[cues.length - 1].text += ' ' + line;
    }
    const words = [];
    cues.forEach((c, i) => {
      const t = c.text.replace(/\[[^\]]*\]/g, ' ').replace(/[♪♫]+/g, ' ').replace(/>>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!t) return;
      const n = t.split(' ').length;
      const natural = c.s + 1 + n * 0.45; // 한 줄을 말하는 데 걸릴 만한 시간 (다음 줄이 없을 때)
      // 자막 줄의 시작 시간은 정확해요. 다음 줄(또는 [Music])이 시작할 때까지 이 줄을 말하고 있다고 보고 그 사이에 단어를 고르게 나눠요.
      // (예전엔 '단어당 0.45초'로 줄여 잡아서, 천천히 말하는 영상은 문장 끝이 잘리고 다음 문장이 앞 문장 단어부터 시작했어요)
      // 다음 줄까지 너무 멀면(단어당 0.9초 + 1.5초 넘게) 중간에 쉬는 시간이 있다고 보고 예전처럼 잡아요.
      const nextS = cues[i + 1] ? cues[i + 1].s : null;
      const end = nextS == null ? natural : (nextS - c.s <= 1.5 + n * 0.9 ? Math.max(c.s + 0.3, nextS - 0.1) : Math.min(nextS, natural));
      const ws = t.split(' ');
      const total = ws.reduce((a, w) => a + w.length + 1, 0);
      let tt = c.s;
      ws.forEach(w => { const d = Math.max(0.05, (end - c.s) * (w.length + 1) / total); words.push({ w, s: tt, e: tt + d * 0.9, cue: i }); tt += d; });
      words[words.length - 1].brk = true; // 자막 한 줄의 끝 → 문장 나눌 후보
    });
    const punctuated = words.length ? words.filter(w => /[.?!]$/.test(w.w)).length / words.length > 0.02 : false;
    return { words, punctuated, cues: cues.length };
  }

  // YouTube 자막 파일(json3) → 말소리 단어 시간 [{ n: 소문자 단어, s: 시작 }]. [Music] 같은 소리 표시는 빼요.
  const spokenNorm = t => String(t).toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9']/g, '').replace(/^'+|'+$/g, '').replace(/'s$/, 's');
  const spokenToks = en => String(en).replace(/[—–/-]+/g, ' ').replace(/\.(?=[a-z])/g, ' ').split(/\s+/).map(spokenNorm).filter(Boolean);
  function captionWords(events, asr) {
    const W = [];
    (events || []).forEach(e => {
      const segs = (e.segs || []).filter(x => x.utf8 && x.utf8.trim());
      if (!asr) { // 사람 자막: 줄 단위 시간뿐이라 줄 안에 단어를 고르게 나눠요
        const ts = spokenToks(segs.map(x => x.utf8).join(' ').replace(/\[[^\]]*\]/g, ' ').replace(/[♪♫]+/g, ' ').replace(/>>/g, ' '));
        const d = (e.dDurationMs || 0) / 1000 / (ts.length || 1);
        ts.forEach((n, k) => W.push({ n, s: e.tStartMs / 1000 + d * k }));
        return;
      }
      segs.forEach(x => {
        const s = (e.tStartMs + (x.tOffsetMs || 0)) / 1000;
        x.utf8.replace(/\[[^\]]*\]/g, ' ').replace(/>>/g, ' ').replace(/[♪♫]+/g, ' ').replace(/[—–-]+/g, ' ').trim().split(/\s+/).filter(Boolean).forEach(t => { const n = spokenNorm(t); if (n) W.push({ n, s }); });
      });
    });
    return W.sort((a, b) => a.s - b.s);
  }

  const editDist = (a, b) => {
    if (Math.abs(a.length - b.length) > 2) return 9;
    let p = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) { const c = [i]; for (let j = 1; j <= b.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; }
    return p[b.length];
  };
  const wordScore = (a, b) => (a === b ? 4 : (a.length > 3 && editDist(a, b) <= 1) || (a.length > 5 && editDist(a, b) <= 2) ? 2 : -3);

  // 스크립트 문장을 영상의 실제 말소리 단어에 하나씩 맞춰 문장마다 시작·끝을 다시 계산해요. 글은 그대로 두고 시간만 바꿔요.
  // 지금 시간이 조금 틀려도 앞뒤 90초 안에서 찾아요. 말소리에서 찾지 못한 문장은 시간을 그대로 두되 앞뒤 문장을 넘지 않게 해요.
  // 반환: { sentences, matched(찾은 문장 수), missed(못 찾은 문장의 글) }
  function alignToSpeech(sents, words, BAND = 90) {
    const W = words, T = [];
    sents.forEach((x, i) => spokenToks(x.en).forEach(n => T.push({ n, line: i })));
    const A = T.length, B = W.length, GAP = -2;
    if (!A || !B) return { sentences: sents, matched: 0, missed: sents.map(x => x.en) };
    const lo = new Int32Array(A + 2), hi = new Int32Array(A + 2);
    for (let i = 0, a = 0, b = 0; i < A; i++) {
      const l = sents[T[i].line];
      while (a < B && W[a].s < l.s - BAND) a++;
      while (b < B && W[b].s <= l.e + BAND) b++;
      lo[i + 1] = a; hi[i + 1] = Math.max(a, b);
    }
    hi[0] = lo[1];
    let prev = new Int32Array(hi[0] + 2), R = prev;
    const back = [new Uint8Array(prev.length).fill(2)];
    const pv = (i, j) => (j < lo[i] || j > hi[i] ? -1e8 : prev[j - lo[i]]);
    for (let i = 1; i <= A; i++) {
      const n = hi[i] - lo[i] + 1, Bt = new Uint8Array(n + 1);
      R = new Int32Array(n + 1); back[i] = Bt;
      const lineEnd = !T[i] || T[i].line !== T[i - 1].line; // 문장과 문장 사이의 건너뛴 말소리는 깎지 않아요
      for (let x = 0; x < n; x++) {
        const j = lo[i] + x;
        const d = j > 0 ? pv(i - 1, j - 1) + wordScore(T[i - 1].n, W[j - 1].n) : -1e8, u = pv(i - 1, j) + GAP, l = x > 0 ? R[x - 1] + (lineEnd ? 0 : GAP) : -1e8;
        if (d >= u && d >= l) { R[x] = d; Bt[x] = 0; } else if (u >= l) { R[x] = u; Bt[x] = 1; } else { R[x] = l; Bt[x] = 2; }
      }
      prev = R;
    }
    let i = A, j = lo[A], best = -1e9;
    for (let x = lo[A]; x <= hi[A]; x++) if (R[x - lo[A]] > best) { best = R[x - lo[A]]; j = x; }
    const map = new Array(A).fill(-1);
    while (i > 0) {
      const x = j - lo[i], c = x >= 0 && x < back[i].length ? back[i][x] : 1;
      if (c === 0) { if (wordScore(T[i - 1].n, W[j - 1].n) > 0) map[i - 1] = j - 1; i--; j--; } else if (c === 1) i--; else j--;
    }
    const per = sents.map(() => ({ n: 0, m: [] }));
    T.forEach((t, k) => { const p = per[t.line]; if (map[k] >= 0) p.m.push({ w: map[k], at: p.n }); p.n++; });
    const WORD = 0.3; // 맞추지 못한 앞뒤 단어 하나의 길이 어림
    const lastLen = n => Math.min(1, Math.max(0.3, 0.2 + 0.06 * n.length)); // 문장 마지막 단어의 길이는 글자 수로 어림
    const res = sents.map((x, k) => {
      const p = per[k];
      if (!p.m.length || p.m.length / p.n < 0.34) return Object.assign({}, x, { hit: false });
      const a = p.m[0], z = p.m[p.m.length - 1], first = W[a.w], last = W[z.w], nxt = W[z.w + 1];
      const before = p.m.length > 1 ? W[p.m[p.m.length - 2].w].s : first.s;
      let e = last.s + lastLen(last.n) + (p.n - 1 - z.at) * WORD;
      if (nxt) e = Math.min(e, nxt.s);
      // 자막이 마지막 단어를 뒤 음악 속으로 밀어 둔 경우: 줄 끝 시간이 더 믿을 만해요
      if (last.s - before > 2.2 && x.e > before && x.e < e) e = Math.max(x.e, before + 0.6);
      return Object.assign({}, x, { s: first.s - a.at * WORD, e, hit: true });
    });
    res.forEach((r, k) => { // 못 찾은 문장이 앞뒤 문장을 넘지 않게
      if (r.hit) return;
      let p = k - 1; while (p >= 0 && !res[p].hit) p--;
      let n = k + 1; while (n < res.length && !res[n].hit) n++;
      const from = p >= 0 ? res[p].e : 0, to = n < res.length ? res[n].s : Infinity;
      r.s = Math.max(r.s, from); r.e = Math.min(r.e, to);
      if (r.e - r.s < 0.3) { r.e = Math.min(to, r.s + 0.5); if (r.e - r.s < 0.2) r.s = Math.max(from, r.e - 0.3); }
    });
    const LEAD = 0.12; // 첫 소리가 잘리지 않게 조금 앞에서 시작
    const out = res.map((r, k) => {
      const p = res[k - 1];
      let s = r.s - LEAD;
      if (p && s < p.e) s = Math.min(r.s, Math.max(p.e, r.s - 0.06));
      return { s: Math.max(0, s), e: r.e, en: r.en, ko: r.ko };
    });
    out.forEach((r, k) => {
      const n = out[k + 1];
      if (n && r.e > n.s) r.e = n.s;
      if (r.e - r.s < 0.15) r.e = r.s + 0.15;
      r.s = +r.s.toFixed(2); r.e = +r.e.toFixed(2);
    });
    return { sentences: out, matched: res.filter(r => r.hit).length, missed: res.filter(r => !r.hit).map(r => r.en) };
  }

  function planParts(duration, sents, minutes) {
    if (!minutes || minutes <= 0) return [0, duration];
    const L = minutes * 60;
    const gaps = [];
    for (let i = 0; i + 1 < sents.length; i++) gaps.push(Math.min((sents[i].e + sents[i + 1].s) / 2, sents[i + 1].s));
    const cuts = [0]; let pos = 0;
    for (;;) {
      const target = pos + L;
      if (target >= duration - L * 0.25) break;
      const win = Math.min(20, L * 0.3);
      const c = gaps.filter(g => Math.abs(g - target) <= win && g > pos + L * 0.5);
      const best = c.length ? c.reduce((a, b) => (Math.abs(a - target) <= Math.abs(b - target) ? a : b)) : target;
      cuts.push(+best.toFixed(2)); pos = best;
    }
    cuts.push(duration);
    return cuts;
  }

  // "1:23", "01:02:03", "83" → 초
  function parseTime(str) {
    const t = String(str || '').trim();
    if (!t) return 0;
    if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
    const p = t.split(':').map(Number);
    if (p.some(x => !Number.isFinite(x))) return NaN;
    return p.reduce((a, x) => a * 60 + x, 0);
  }

  function fmt(t) {
    t = Math.max(0, t || 0);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
    return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  // 구글 번역(무료) → 실패하면 MyMemory. shadowing.html과 같은 방식
  async function translate(text) {
    try {
      const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&q=${encodeURIComponent(text)}`);
      if (!r.ok) throw new Error();
      const d = await r.json();
      const t = d[0].map(x => x[0]).join('');
      if (t) return t;
    } catch (e) {}
    try {
      const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|ko`);
      const d = await r.json();
      const t = d && d.responseData && d.responseData.translatedText;
      if (t && !/mymemory warning|quota/i.test(t)) return t;
    } catch (e) {}
    return '';
  }

  root.VideoTranscript = { SR, extractAudio, splitAudio, encodeWav, buildSentences, wordsToSentences, parsePastedTranscript, captionWords, alignToSpeech, applyPunctuation, restorePunctuation, sentencesToWords, planParts, fmt, parseTime, translate };
})(window);

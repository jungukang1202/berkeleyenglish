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
    // 문장 나누기: 문장부호 > 긴 쉼 > 너무 길면 쉼표에서
    const groups = []; let cur = [];
    all.forEach((w, i) => {
      cur.push(w);
      const nx = all[i + 1];
      const gap = nx ? nx.s - w.e : 99;
      const n = cur.length;
      const cut = !nx || endsSentence(w.w) || gap > 1.8
        || (n >= 20 && (/[,;:]$/.test(w.w) || gap > 0.35)) || n >= 32;
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
      en = en.charAt(0).toUpperCase() + en.slice(1);
      return { s: +s.toFixed(2), e: +Math.max(e, s + 0.4).toFixed(2), en, ko: '' };
    });
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

  root.VideoTranscript = { SR, extractAudio, splitAudio, encodeWav, buildSentences, planParts, fmt, translate };
})(window);

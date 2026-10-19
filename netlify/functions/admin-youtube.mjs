// YouTube 링크로 영상 쉐도잉 만들기 — 관리자 토큰 필요.
// POST /api/admin-youtube  { url }  →  { videoId, title, author, duration, track:{lang,kind,name}, words:[{w,s,e}], punctuated }
//   - 영상은 받지 않고, YouTube에 올라와 있는 영어 자막(사람이 만든 자막 > 자동 자막)을 단어별 시간과 함께 가져옵니다.
//   - Netlify 서버(AWS)는 YouTube가 자주 막아서, 환경변수 SUPADATA_API_KEY가 있으면 자막 전문 서비스(supadata.ai)로 먼저 가져옵니다.
//     (자막이 없는 영상은 Supadata가 AI로 받아쓰는 동안 { pending:true, jobId } → 브라우저가 몇 초마다 { url, jobId }로 다시 물어봅니다)
//   - 자막을 못 가져오면 { error:'no_captions' | 'blocked', title, duration } → 관리자 화면이 "스크립트 붙여넣기"로 안내합니다.
import { requireAuth, jsonResponse } from './_lib/auth.mjs';

const UA_WEB = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
// YouTube 내부 API에 접속할 때 쓰는 앱 정보 — 하나가 막히면 다음 것으로 시도합니다.
const CLIENTS = [
  { name: 'ANDROID', body: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30 }, ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip' },
  { name: 'IOS', body: { clientName: 'IOS', clientVersion: '20.10.4', deviceModel: 'iPhone16,2' }, ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3 like Mac OS X)' },
  { name: 'WEB', body: { clientName: 'WEB', clientVersion: '2.20240313.05.00' }, ua: UA_WEB },
];

export function parseVideoId(input) {
  const s = String(input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

async function timed(url, opts = {}, ms = 9000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opts, signal: c.signal }); } finally { clearTimeout(t); }
}

async function playerResponse(videoId, client) {
  const r = await timed('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': client.ua, 'Accept-Language': 'en-US,en;q=0.9' },
    body: JSON.stringify({ context: { client: { ...client.body, hl: 'en', gl: 'US' } }, videoId }),
  });
  if (!r.ok) throw new Error('player ' + r.status);
  return r.json();
}

async function watchPageResponse(videoId) {
  const r = await timed(`https://www.youtube.com/watch?v=${videoId}&hl=en`, { headers: { 'User-Agent': UA_WEB, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1' } });
  if (!r.ok) throw new Error('watch ' + r.status);
  const html = await r.text();
  const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var\s|<\/script>)/s);
  if (!m) throw new Error('no player response');
  return JSON.parse(m[1]);
}

// 영어 자막 고르기: 사람이 만든 영어 자막 > 자동 생성 영어 자막
function pickTrack(tracks) {
  const en = tracks.filter(t => /^en/i.test(t.languageCode || ''));
  return en.find(t => t.kind !== 'asr' && /^en(-US|-GB)?$/i.test(t.languageCode)) || en.find(t => t.kind !== 'asr') || en.find(t => t.kind === 'asr') || null;
}

function cleanText(t) {
  return String(t || '')
    .replace(/\[[^\]]*\]/g, ' ')   // [Music] [Applause]
    .replace(/[♪♫]+/g, ' ')
    .replace(/&gt;&gt;|>>/g, ' ')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

// json3 자막 → 단어별 시간
export function json3ToWords(json) {
  const words = [];
  const manualLines = [];
  for (const ev of (json && json.events) || []) {
    if (!ev.segs || ev.aAppend) continue;
    const t0 = (ev.tStartMs || 0) / 1000;
    const dur = (ev.dDurationMs || 0) / 1000;
    const hasOffsets = ev.segs.some(sg => sg.tOffsetMs != null);
    if (hasOffsets) { // 자동 자막: 조각마다 시작 시간이 있음
      ev.segs.forEach(sg => {
        cleanText(sg.utf8).split(' ').filter(Boolean).forEach(w => words.push({ w, s: t0 + (sg.tOffsetMs || 0) / 1000, e: null }));
      });
    } else { // 사람 자막: 한 줄씩 모아 두었다가 linesToWords로 (겹침 방지)
      manualLines.push({ text: ev.segs.map(sg => sg.utf8).join(''), start: t0, dur });
      continue;
    }
    if (words.length && words[words.length - 1].s >= t0) words[words.length - 1].brk = true; // 자막 한 줄의 끝
  }
  if (manualLines.length && !words.length) return linesToWords(manualLines);
  // 자동 자막 중 한 단어짜리 줄(시간 조각이 없음)도 빠뜨리지 않고 넣기
  if (manualLines.length) linesToWords(manualLines).forEach(w => words.push({ w: w.w, s: w.s, e: null, brk: w.brk }));
  words.sort((a, b) => a.s - b.s);
  for (let i = 0; i < words.length; i++) {
    if (words[i].e != null) continue;
    const nx = words[i + 1] ? words[i + 1].s : words[i].s + 0.6;
    words[i].e = nx > words[i].s ? Math.min(nx, words[i].s + 1.0) : words[i].s + 0.3;
  }
  return words.map(w => { const o = { w: w.w, s: Math.round(w.s * 100) / 100, e: Math.round(w.e * 100) / 100 }; if (w.brk) o.brk = 1; return o; });
}

async function fetchTrack(track, ua) {
  const base = track.baseUrl.replace(/&fmt=[^&]*/g, '');
  const r = await timed(base + '&fmt=json3', { headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9' } });
  if (!r.ok) throw new Error('timedtext ' + r.status);
  const text = await r.text();
  if (!text.trim()) throw new Error('timedtext empty');
  return JSON.parse(text);
}

// ---- Supadata (자막 전문 API, https://supadata.ai — 무료 키: 월 100건) ----
const SUPA = 'https://api.supadata.ai/v1/transcript';
// 자막 한 줄(시작·길이) 안에서 단어마다 시간을 나눠 줍니다.
// ⚠️ YouTube 자동 자막은 한 줄이 다음 줄이 나온 뒤에도 화면에 남아 있어서 "길이"가 다음 줄과 겹쳐요.
//    그대로 나누면 두 줄의 단어가 시간 순서로 섞이므로, 다음 줄이 시작되는 시점까지만 쓰고 단어 순서는 절대 바꾸지 않습니다.
export function linesToWords(lines) {
  const L = lines.filter(x => x.text).sort((a, b) => a.start - b.start);
  const words = [];
  L.forEach((ln, i) => {
    const ws = cleanText(ln.text).split(' ').filter(Boolean);
    if (!ws.length) return;
    const next = L[i + 1];
    let dur = ln.dur > 0 ? ln.dur : 2;
    if (next && next.start > ln.start) dur = Math.min(dur, next.start - ln.start);
    dur = Math.min(dur, 0.6 + ws.length * 0.45); // 말하는 데 걸릴 만한 시간 이상으로 늘리지 않기
    const total = ws.reduce((a, w) => a + w.length + 1, 0);
    let t = Math.max(ln.start, words.length ? words[words.length - 1].s + 0.02 : 0);
    ws.forEach(w => { const d = Math.max(0.05, dur * (w.length + 1) / total); words.push({ w, s: t, e: t + d * 0.95 }); t += d; });
    words[words.length - 1].brk = 1;
  });
  return words.map(w => ({ ...w, s: Math.round(w.s * 100) / 100, e: Math.round(w.e * 100) / 100 }));
}
function supaToWords(content) {
  return linesToWords((content || []).map(seg => ({ text: seg.text, start: Number(seg.offset || 0) / 1000, dur: Number(seg.duration || 0) / 1000 })));
}
async function supadata(videoId, key, jobId) {
  const headers = { 'x-api-key': key };
  let r;
  if (jobId) r = await timed(`${SUPA}/${encodeURIComponent(jobId)}`, { headers }, 15000);
  else r = await timed(`${SUPA}?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)}&lang=en&mode=auto`, { headers }, 25000);
  const d = await r.json().catch(() => ({}));
  if (r.status === 202 || (d.jobId && !d.content)) return { pending: true, jobId: d.jobId || jobId };
  if (jobId && d.status && d.status !== 'completed') {
    if (d.status === 'failed') throw new Error('supadata job failed');
    return { pending: true, jobId };
  }
  if (!r.ok) throw new Error('supadata ' + r.status + (d.message ? ' ' + String(d.message).slice(0, 80) : ''));
  const content = Array.isArray(d.content) ? d.content : (d.result && d.result.content) || [];
  const lang = d.lang || (content[0] && content[0].lang) || 'en';
  if (!/^en/i.test(lang)) throw Object.assign(new Error('not english: ' + lang), { notEnglish: true });
  return { words: supaToWords(content), lang };
}

async function oembed(videoId) {
  try {
    const r = await timed(`https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)}&format=json`, {}, 6000);
    if (r.ok) return await r.json();
  } catch (e) {}
  return null;
}

export default async (req) => {
  if (!requireAuth(req, 'admin')) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  let body; try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
  const videoId = parseVideoId(body && body.url);
  if (!videoId) return jsonResponse({ error: 'bad_url', message: 'YouTube 링크를 확인해주세요.' }, 400);

  const info = { videoId, title: '', author: '', duration: 0 };
  const oe = await oembed(videoId);
  if (oe) { info.title = oe.title || ''; info.author = oe.author_name || ''; }
  else return jsonResponse({ ...info, error: 'not_found', message: '영상을 찾을 수 없어요. 비공개이거나 삭제된 영상인지, 퍼가기가 허용된 영상인지 확인해주세요.' }, 404);

  const attempts = [];
  const supaKey = process.env.SUPADATA_API_KEY;
  if (supaKey) {
    try {
      const r = await supadata(videoId, supaKey, body.jobId ? String(body.jobId).slice(0, 100) : null);
      if (r.pending) return jsonResponse({ ...info, pending: true, jobId: r.jobId, message: '자막이 없는 영상이라 AI가 받아쓰는 중이에요…' }, 202);
      if (r.words.length) {
        const punct = r.words.filter(w => /[.?!]$/.test(w.w)).length / r.words.length;
        return jsonResponse({ ...info, track: { lang: r.lang, kind: 'supadata', name: 'Supadata' }, punctuated: punct > 0.02, words: r.words });
      }
      attempts.push('SUPADATA:empty');
    } catch (e) {
      if (e.notEnglish) return jsonResponse({ ...info, error: 'no_english', message: '이 영상은 영어 영상이 아닌 것 같아요.' }, 422);
      attempts.push('SUPADATA:' + e.message);
    }
  } else attempts.push('SUPADATA:키 없음');
  let sawTracks = false;
  const sources = [...CLIENTS.map(c => ({ name: c.name, ua: c.ua, get: () => playerResponse(videoId, c) })),
    { name: 'WATCH', ua: UA_WEB, get: () => watchPageResponse(videoId) }];
  for (const src of sources) {
    try {
      const pr = await src.get();
      const vd = pr.videoDetails || {};
      if (vd.lengthSeconds) info.duration = Number(vd.lengthSeconds);
      if (!info.title && vd.title) info.title = vd.title;
      const tracks = (((pr.captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks) || [];
      if (!tracks.length) { attempts.push(src.name + ':no-tracks(' + ((pr.playabilityStatus || {}).status || '?') + ')'); continue; }
      sawTracks = true;
      const track = pickTrack(tracks);
      if (!track) { attempts.push(src.name + ':no-english'); return jsonResponse({ ...info, error: 'no_english', message: '이 영상에는 영어 자막이 없어요.' }, 422); }
      const json = await fetchTrack(track, src.ua);
      const words = json3ToWords(json);
      if (!words.length) { attempts.push(src.name + ':empty'); continue; }
      const punct = words.filter(w => /[.?!]$/.test(w.w)).length / words.length;
      return jsonResponse({
        ...info,
        track: { lang: track.languageCode, kind: track.kind === 'asr' ? 'auto' : 'manual', name: ((track.name || {}).simpleText) || ((track.name || {}).runs || [{}])[0].text || '' },
        punctuated: punct > 0.02, words,
      });
    } catch (e) {
      attempts.push(src.name + ':' + (e && e.message ? e.message : 'error'));
    }
  }
  return jsonResponse({
    ...info,
    error: 'blocked',
    message: supaKey ? '자막을 자동으로 가져오지 못했어요.' : 'YouTube가 서버의 자막 요청을 막았어요. (Netlify 환경변수 SUPADATA_API_KEY를 넣으면 자동으로 가져올 수 있어요)',
    attempts,
  }, 422);
};

export const config = { path: '/api/admin-youtube' };

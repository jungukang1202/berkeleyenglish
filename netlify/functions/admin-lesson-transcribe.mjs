// 🎥 수업영상 쉐도잉 — 엔보임 수업 녹화 소리 조각(WAV, 약 100초)을 받아씁니다. 관리자 전용. (js/nvoim-video.js가 사용)
// POST /api/admin-lesson-transcribe?prompt=앞 조각 마지막 말&lang=en(영어로 다시 받아쓸 때만)   (본문: audio/wav, 약 30초)
//   → { segments:[{ s, e, text, lp }], words:[{ w, s, e }] }   lp = 받아쓰기 자신감(avg_logprob, 0에 가까울수록 또렷)   (시간은 이 조각 안에서의 초)
// 영상 쉐도잉(/api/admin-transcribe)과 같은 모양이지만, 선생님·학생 대화를 정확하게 받아쓰도록
// 더 정확한 Whisper 모델(whisper-large-v3)을 써요. 화상수업 녹화는 소리가 작아서, 말소리가 없다고 보면서 알아들은 말도
// 자신 없을 때(avg_logprob < -1)만 버려요(실제 대사가 빠지지 않게).
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { transcribe, groqErrorResponse, GroqError } from './_lib/groq.mjs';

const MAX_BYTES = 5.5 * 1024 * 1024;
const NO_SPEECH_PROB = 0.6; // 말소리가 없는 구간에서 지어낸 문장은 버려요
// 영어·한국어가 섞인 수업: 언어를 영어로 정해 두면 한국어로 한 말이 영어로 번역돼 들어와요.
// 언어를 정하지 않고 두 언어가 섞인 예를 앞에 주면, 영어는 영어로·한국어는 한글로 받아써요(한글 줄은 화면이 쉐도잉에서 빼요).
const LESSON_PROMPT = 'An online English lesson. A teacher and a student take turns talking. Hello, how are you today? 네, 좋아요. I am fine, thank you. 이거 뭐라고 해요? That is a good question.';

export default async (req) => {
  if (!requireAuth(req, 'admin')) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) return jsonResponse({ error: 'empty audio' }, 400);
  if (buf.byteLength > MAX_BYTES) return jsonResponse({ error: 'audio too large' }, 413);
  const q = new URL(req.url).searchParams;
  const prev = q.get('prompt') || '';
  const lang = q.get('lang') === 'en' ? 'en' : null;
  const prompt = (lang ? 'An online English lesson. A teacher and a student take turns talking.' : LESSON_PROMPT) + (prev ? ' ' + prev : '');
  const type = req.headers.get('content-type') || 'audio/wav';

  try {
    let d;
    try { d = await transcribe(buf, type, prompt, 'whisper-large-v3', lang); }
    catch (e) { if (e instanceof GroqError && (e.status === 429 || e.status === 500)) throw e; d = await transcribe(buf, type, prompt, undefined, lang); }
    // 조용한 곳에서 앞에 준 예문을 그대로 따라 쓴 줄(I am fine, thank you. 등)도 버려요
    const norm = t => String(t || '').toLowerCase().replace(/[^a-z가-힣 ]+/g, '').replace(/\s+/g, ' ').trim();
    const promptLines = new Set(LESSON_PROMPT.split(/(?<=[.?!])\s+/).map(norm).filter(Boolean));
    const echo = x => promptLines.has(norm(x.text)) && typeof x.no_speech_prob === 'number' && x.no_speech_prob > 0.2;
    const silent = x => echo(x) || (typeof x.no_speech_prob === 'number' && x.no_speech_prob > NO_SPEECH_PROB && !(typeof x.avg_logprob === 'number' && x.avg_logprob > -1));
    const dropped = (d.segments || []).filter(silent);
    const segments = (d.segments || []).filter(x => !silent(x)).map(x => ({ s: x.start, e: x.end, text: String(x.text || '').trim(), lp: typeof x.avg_logprob === 'number' ? +x.avg_logprob.toFixed(3) : null })).filter(x => x.text);
    const inDropped = w => dropped.some(g => w.start >= g.start - 0.05 && w.end <= g.end + 0.05) && !segments.some(g => w.start >= g.s - 0.05 && w.end <= g.e + 0.05);
    const words = (d.words || []).filter(w => !inDropped(w)).map(x => ({ w: String(x.word || '').trim(), s: x.start, e: x.end })).filter(x => x.w);
    return jsonResponse({ segments, words });
  } catch (e) {
    return groqErrorResponse(e, jsonResponse);
  }
};

export const config = { path: '/api/admin-lesson-transcribe' };
